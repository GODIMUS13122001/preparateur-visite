// Le téléphone a déposé sa note vocale directement dans le stockage (voir note-jeton.ts) puis déclare ici : `{ rdv, idem, chemin, duree }`.
// On vérifie que l'audio est bien là, puis on sonne le Mac UNE seule fois par idem (marqueur dans le stockage).
import { del, head, list, put } from '@vercel/blob'
import { injoignable, json, lireJson, refuse, role, sonnerMoteur } from '../lib/commun.js'

const SEPT_JOURS = 7 * 24 * 3600 * 1000
const MARQUEUR = (idem: string) => `notes-signalees/${idem}.json`

/** Purge des notes (audio et marqueurs) de plus de 7 jours. */
async function purger() {
  const limite = Date.now() - SEPT_JOURS
  for (const prefixe of ['notes/', 'notes-signalees/']) {
    const { blobs } = await list({ prefix: prefixe, limit: 200 })
    const vieux = blobs.filter((b) => new Date(b.uploadedAt).getTime() < limite).map((b) => b.pathname)
    if (vieux.length) await del(vieux)
  }
}

export async function POST(req: Request) {
  if (await role(req) !== 'telephone') return refuse()
  let d: { rdv?: string; idem?: string; chemin?: string; duree?: number }
  try { d = await req.json() } catch { return json({ erreur: 'Demande illisible' }, 400) }
  const rdv = (d.rdv ?? '').replace(/[^\w-]/g, '')
  const idem = d.idem ?? ''
  const chemin = d.chemin ?? ''
  if (!rdv) return json({ erreur: 'Rendez-vous manquant' }, 400)
  if (!/^[\w-]{8,64}$/.test(idem) || !new RegExp(`^notes/${idem}\\.(m4a|webm|ogg|wav)$`).test(chemin)) return json({ erreur: 'Note invalide' }, 400)

  // déjà signalée au Mac : on confirme sans le resonner
  const deja = await lireJson<{ rdv?: string } | null>(MARQUEUR(idem), null).catch(() => null)
  if (deja) return json({ ok: true, id: idem, deja: true })

  const info = await head(chemin).catch(() => null)
  if (!info) return json({ erreur: 'Audio introuvable, renvoyez la note' }, 409)

  try { await sonnerMoteur({ evenement: 'note', id: idem, rdv, chemin }) } catch { return injoignable() }
  await put(MARQUEUR(idem), JSON.stringify({ rdv, chemin, duree: d.duree ?? null, le: new Date().toISOString() }), { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' }).catch(() => {})
  await purger().catch(() => {})
  return json({ ok: true, id: idem })
}
