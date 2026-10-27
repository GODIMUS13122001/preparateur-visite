// Le téléphone valide (ou corrige puis valide) un compte rendu : on transmet la décision au Mac.
import { ecrireJson, injoignable, json, refuse, role, sonnerMoteur } from '../lib/commun.js'

export async function POST(req: Request) {
  if (await role(req) !== 'telephone') return refuse()
  const d = await req.json() as { rdv: string; id: string; texte?: string; maj?: unknown }
  if (!d?.rdv || !/^[\w-]{8,64}$/.test(d?.id ?? '')) return json({ erreur: 'Demande incomplète' }, 400)
  const chemin = `cr/${d.id.replace(/[^\w-]/g, '')}-validation.json`
  await ecrireJson(chemin, { ...d, valide_le: new Date().toISOString() })
  try { await sonnerMoteur({ evenement: 'validation', rdv: d.rdv, id: d.id, chemin }) } catch { return injoignable() }
  return json({ ok: true })
}
