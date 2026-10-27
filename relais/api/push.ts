// Notifications de l'appli mobile (Web Push) : le téléphone s'abonne, le Mac déclenche l'envoi.
import webpush from 'web-push'
import { ecrireJson, json, lireJson, refuse, role } from '../lib/commun.js'

type Abonnement = { endpoint: string; keys: { p256dh: string; auth: string } }

function initialiser() {
  const contact = process.env.VAPID_CONTACT || 'mailto:contact@example.com'
  webpush.setVapidDetails(/^(mailto:|https:)/.test(contact) ? contact : `mailto:${contact}`, process.env.VAPID_PUBLIQUE!, process.env.VAPID_PRIVEE!)
}

export async function GET(req: Request) {
  if (!await role(req)) return refuse()
  return json({ cle_publique: process.env.VAPID_PUBLIQUE })
}

export async function POST(req: Request) {
  const r = await role(req)
  if (!r) return refuse()
  const action = new URL(req.url).searchParams.get('action')
  const abonnements = await lireJson<Abonnement[]>('push/abonnements.json', [])
  if (action === 'abonner' && r === 'telephone') {
    const a = await req.json() as Abonnement
    if (!a?.endpoint || !a?.keys?.p256dh || !a?.keys?.auth) return json({ erreur: 'Abonnement incomplet' }, 400)
    if (abonnements.some((x) => x.endpoint === a.endpoint && x.keys.auth === a.keys.auth)) return json({ ok: true, abonnes: abonnements.length })
    const liste = [...abonnements.filter((x) => x.endpoint !== a.endpoint), a]
    await ecrireJson('push/abonnements.json', liste)
    return json({ ok: true, abonnes: liste.length })
  }
  if (action === 'envoyer' && r === 'moteur') {
    initialiser()
    const message = JSON.stringify(await req.json())
    const restants: Abonnement[] = []
    let envoyes = 0
    for (const a of abonnements) {
      try { await webpush.sendNotification(a, message); envoyes++; restants.push(a) }
      catch (e) { if (![404, 410].includes((e as { statusCode?: number }).statusCode ?? 0)) restants.push(a) }
    }
    if (restants.length !== abonnements.length) await ecrireJson('push/abonnements.json', restants)
    return json({ ok: true, envoyes })
  }
  return json({ erreur: 'Action inconnue' }, 400)
}
