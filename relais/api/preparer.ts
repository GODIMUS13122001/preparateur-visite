// Le téléphone demande la fiche d'un rendez-vous qui n'en a pas encore : on transmet la demande au Mac.
import { injoignable, json, refuse, role, sonnerMoteur } from '../lib/commun.js'

export async function POST(req: Request) {
  if (await role(req) !== 'telephone') return refuse()
  const rdv = new URL(req.url).searchParams.get('rdv')?.replace(/[^\w-]/g, '')
  if (!rdv) return json({ erreur: 'Rendez-vous manquant' }, 400)
  try { await sonnerMoteur({ evenement: 'preparer', rdv }) } catch { return injoignable() }
  return json({ ok: true })
}
