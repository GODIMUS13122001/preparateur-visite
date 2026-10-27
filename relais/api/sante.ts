// Vérification rapide : le relais répond, et la clé présentée est-elle reconnue ?
import { json, role } from '../lib/commun.js'

export async function GET(req: Request) {
  return json({ ok: true, acces: (await role(req)) ?? 'aucun', heure: new Date().toISOString() })
}
