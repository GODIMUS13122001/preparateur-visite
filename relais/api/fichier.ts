// Fichiers privés (page de fiche, audio, note vocale) : écrits par le Mac, lus par le téléphone et le Mac.
import { get, put } from '@vercel/blob'
import { json, refuse, role } from '../lib/commun.js'

const autorise = (chemin: string) => /^(fiches|notes|cr)\/[\w.\-]+$/.test(chemin)

export async function GET(req: Request) {
  if (!await role(req)) return refuse()
  const chemin = new URL(req.url).searchParams.get('chemin') ?? ''
  if (!autorise(chemin)) return json({ erreur: 'Chemin invalide' }, 400)
  const r = await get(chemin, { access: 'private', useCache: false })
  if (!r || r.statusCode !== 200 || !r.stream) return json({ erreur: 'Introuvable' }, 404)
  return new Response(r.stream, { headers: { 'content-type': r.blob.contentType ?? 'application/octet-stream', 'cache-control': 'private, max-age=60',
    // la fiche est rédigée à partir de pages web : aucun script ne doit pouvoir s'y exécuter
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; media-src 'self'; sandbox allow-popups", 'x-content-type-options': 'nosniff' } })
}

export async function PUT(req: Request) {
  if (await role(req) !== 'moteur') return refuse()
  const chemin = new URL(req.url).searchParams.get('chemin') ?? ''
  if (!autorise(chemin)) return json({ erreur: 'Chemin invalide' }, 400)
  await put(chemin, req.body!, { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: req.headers.get('content-type') ?? undefined })
  return json({ ok: true })
}
