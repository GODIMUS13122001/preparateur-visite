// Le script Google Agenda dépose ici la liste à jour des rendez-vous, puis on sonne le Mac qui vient la chercher.
// (Les serveurs Google sont refusés par le service de notification gratuit : ils passent donc par ce relais.)
import { egal, injoignable, json, lireJson, ecrireJson, refuse, role, sonnerMoteur } from '../lib/commun.js'

const CHEMIN = 'agenda/dernier.json'

export async function POST(req: Request) {
  // clé propre au script Google (en-tête de préférence ; l'adresse reste admise pour l'ancien script)
  const cle = req.headers.get('x-cle') ?? new URL(req.url).searchParams.get('cle') ?? ''
  if (!process.env.CLE_AGENDA || !cle || !egal(cle, process.env.CLE_AGENDA)) return refuse()
  let donnees: { type?: string; evenements?: unknown[] }
  try {
    donnees = JSON.parse(await req.text())
  } catch {
    return json({ erreur: 'Liste illisible' }, 400)
  }
  if (donnees.type !== 'agenda' || !Array.isArray(donnees.evenements)) return json({ erreur: 'Ce n’est pas une liste d’agenda' }, 400)
  await ecrireJson(CHEMIN, { ...donnees, recu: Date.now() })
  try { await sonnerMoteur({ evenement: 'agenda' }) } catch { return injoignable() }
  return json({ ok: true, evenements: donnees.evenements.length })
}

export async function GET(req: Request) {
  if (await role(req) !== 'moteur') return refuse()
  return json(await lireJson(CHEMIN, null))
}
