// Outils communs du relais : contrôle d'accès, stockage privé (Vercel Blob), sonnette signée vers le Mac.
import { createHash, timingSafeEqual } from 'node:crypto'
import { get, put } from '@vercel/blob'

export type Role = 'moteur' | 'telephone'

/** Comparaison en temps constant (empreintes de même longueur). */
export function egal(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export const empreinte = (s: string) => createHash('sha256').update(s).digest('hex')

/** Clé d'appareil : « d<identifiant>.<secret> ». Seule l'empreinte du secret est gardée côté relais (révocable). */
export const CHEMIN_APPAREIL = (id: string) => `appareils/${id}.json`

async function appareilValide(cle: string): Promise<boolean> {
  const m = /^d([a-f0-9]{12})\.([A-Za-z0-9_-]{20,})$/.exec(cle)
  if (!m) return false
  const a = await lireJson<{ hash?: string } | null>(CHEMIN_APPAREIL(m[1]), null).catch(() => null)
  return !!a?.hash && egal(a.hash, empreinte(m[2]))
}

/**
 * Le Mac présente la clé moteur ; le téléphone, sa clé d'appareil (ou la clé d'accès globale historique).
 * La clé voyage dans l'en-tête x-cle ; elle n'est admise dans l'adresse que pour les fichiers (audio et fiche
 * chargés directement par le navigateur).
 */
export async function role(req: Request): Promise<Role | null> {
  const url = new URL(req.url)
  const viaAdresse = req.method === 'GET' && url.pathname === '/api/fichier'
  const cle = req.headers.get('x-cle') ?? (viaAdresse ? url.searchParams.get('cle') : null) ?? ''
  if (!cle) return null
  if (process.env.CLE_MOTEUR && egal(cle, process.env.CLE_MOTEUR)) return 'moteur'
  if (process.env.CLE_ACCES && egal(cle, process.env.CLE_ACCES)) return 'telephone'
  if (await appareilValide(cle)) return 'telephone'
  return null
}

export function json(donnees: unknown, statut = 200) {
  return new Response(JSON.stringify(donnees), { status: statut, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

export const refuse = () => json({ erreur: 'Accès refusé' }, 401)
export const injoignable = () => json({ erreur: 'Le Mac n’a pas pu être prévenu, réessayez' }, 502)

export async function lireJson<T>(chemin: string, defaut: T): Promise<T> {
  const r = await get(chemin, { access: 'private', useCache: false })
  if (!r || r.statusCode !== 200 || !r.stream) return defaut
  return JSON.parse(await new Response(r.stream).text()) as T
}

export async function ecrireJson(chemin: string, donnees: unknown) {
  await put(chemin, JSON.stringify(donnees), { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' })
}

/**
 * Sonne le Mac : un message sur son canal privé, qu'il écoute en continu (format inchangé).
 * LÈVE une erreur si le message n'est pas parti : la route répond 502 et le téléphone réessaiera.
 */
export async function sonnerMoteur(evenement: Record<string, unknown>) {
  const canal = process.env.CANAL_MOTEUR
  if (!canal) throw new Error('Canal du Mac non configuré')
  const r = await fetch(`https://ntfy.sh/${canal}`, { method: 'POST', body: JSON.stringify({ type: 'relais', ...evenement }), signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error(`ntfy ${r.status}`)
}
