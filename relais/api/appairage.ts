// Appairage par code court : sur iPhone, l'appli installée ne partage pas la mémoire de Safari, donc on relie le
// téléphone en tapant un code affiché par le Mac (6 chiffres aujourd'hui ; 8 caractères acceptés aussi).
// Un seul code actif à la fois, 5 essais erronés au plus, puis chaque téléphone reçoit sa propre clé (révocable).
import { randomBytes } from 'node:crypto'
import { del, get } from '@vercel/blob'
import { CHEMIN_APPAREIL, ecrireJson, egal, empreinte, json, refuse, role } from '../lib/commun.js'

const ACTIF = 'appairage/actif.json'
const FORMAT = /^(\d{6}|[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8})$/
const normaliser = (c: string) => c.toUpperCase().replace(/[\s-]/g, '')
type Actif = { hash: string; expire: number; essais: number }

async function lireActif(): Promise<Actif | null> {
  const r = await get(ACTIF, { access: 'private', useCache: false }).catch(() => null)
  if (!r || r.statusCode !== 200 || !r.stream) return null
  return JSON.parse(await new Response(r.stream).text()) as Actif
}

/** Le Mac crée un code valable 15 minutes (il remplace le précédent). */
export async function POST(req: Request) {
  if (await role(req) !== 'moteur') return refuse()
  const { code } = await req.json() as { code: string }
  const c = normaliser(code ?? '')
  if (!FORMAT.test(c)) return json({ erreur: 'Code invalide' }, 400)
  await ecrireJson(ACTIF, { hash: empreinte(c), expire: Date.now() + 15 * 60 * 1000, essais: 0 } satisfies Actif)
  return json({ ok: true })
}

/** Le téléphone échange le code contre la clé de son appareil (une seule fois). */
export async function GET(req: Request) {
  const code = normaliser(new URL(req.url).searchParams.get('code') ?? '')
  if (!FORMAT.test(code)) return json({ erreur: 'Code invalide' }, 400)
  const a = await lireActif()
  if (!a) return json({ erreur: 'Code inconnu ou déjà utilisé' }, 404)
  if (Date.now() > a.expire) { await del(ACTIF).catch(() => {}); return json({ erreur: 'Code expiré : affichez-en un nouveau sur le Mac' }, 410) }
  if (!egal(a.hash, empreinte(code))) {
    a.essais += 1
    if (a.essais >= 5) { await del(ACTIF).catch(() => {}); return json({ erreur: 'Trop d’essais : affichez un nouveau code sur le Mac' }, 429) }
    await ecrireJson(ACTIF, a)
    return json({ erreur: 'Code incorrect' }, 404)
  }
  await del(ACTIF).catch(() => {})
  const id = randomBytes(6).toString('hex')
  const secret = randomBytes(24).toString('base64url')
  await ecrireJson(CHEMIN_APPAREIL(id), { hash: empreinte(secret), cree: new Date().toISOString(), agent: (req.headers.get('user-agent') ?? '').slice(0, 120) })
  return json({ cle: `d${id}.${secret}`, appareil: id })
}

/** Le Mac révoque un appareil (?appareil=<id>). */
export async function DELETE(req: Request) {
  if (await role(req) !== 'moteur') return refuse()
  const id = new URL(req.url).searchParams.get('appareil') ?? ''
  if (!/^[a-f0-9]{12}$/.test(id)) return json({ erreur: 'Appareil inconnu' }, 400)
  await del(CHEMIN_APPAREIL(id)).catch(() => {})
  return json({ ok: true })
}
