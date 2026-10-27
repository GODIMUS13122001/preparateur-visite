// Jeton de téléversement direct d'une note vocale (jusqu'à 25 Mo, sans passer par la limite de 4,5 Mo des fonctions).
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { json, refuse, role } from '../lib/commun.js'

export async function POST(req: Request) {
  if (await role(req) !== 'telephone') return refuse()
  let body: HandleUploadBody
  try { body = await req.json() as HandleUploadBody } catch { return json({ erreur: 'Demande illisible' }, 400) }
  try {
    const rep = await handleUpload({
      request: req, body,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^notes\/[\w-]{8,64}\.(m4a|webm|ogg|wav)$/.test(pathname)) throw new Error('Chemin invalide')
        return { allowedContentTypes: ['audio/*', 'video/mp4', 'video/webm'], maximumSizeInBytes: 25 * 1024 * 1024, addRandomSuffix: false, allowOverwrite: true }
      },
    })
    return json(rep)
  } catch (e) {
    return json({ erreur: (e as Error).message }, 400)
  }
}
