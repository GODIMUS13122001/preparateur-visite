// État partagé : la journée, les fiches et les comptes rendus, publiés par le Mac et lus par le téléphone.
import { ecrireJson, json, lireJson, refuse, role } from '../lib/commun.js'

export async function GET(req: Request) {
  if (!await role(req)) return refuse()
  return json(await lireJson('etat/etat.json', { journee: null, maj: null }))
}

export async function PUT(req: Request) {
  if (await role(req) !== 'moteur') return refuse()
  const etat = await req.json()
  await ecrireJson('etat/etat.json', { ...etat, maj: new Date().toISOString() })
  return json({ ok: true })
}
