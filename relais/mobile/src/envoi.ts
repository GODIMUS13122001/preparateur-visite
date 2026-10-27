// Envoi des notes vocales : téléversement direct dans le stockage, puis déclaration au relais.
// Chaque note a un identifiant unique (idem) : renvoyer la même note ne la duplique jamais côté Mac.
import { upload } from '@vercel/blob/client'
import { api, cle, DELAI_REQUETE } from './api'
import { majNote, notesEnAttente, reconstituerNote, supprimerNote, enDictee, type NoteEnAttente } from './notes'

const extension = (type: string) => (type.includes('webm') ? 'webm' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'm4a')
const enVol = new Set<string>()

/** Délai du téléversement : 30 s, plus 1 s par 60 Ko pour les longues notes, plafonné à 4 minutes. */
const delaiTeleversement = (octets: number) => Math.min(240000, DELAI_REQUETE + (octets / 60000) * 1000)

/** Envoie une note (l'audio est en mémoire). Lève une erreur si quelque chose échoue : la note reste sur le téléphone. */
export async function envoyerNote(n: NoteEnAttente, audio: Blob, duree = n.duree ?? 0) {
  if (enVol.has(n.idem)) throw new Error('deja en cours')
  enVol.add(n.idem)
  try {
    const chemin = `notes/${n.idem}.${extension(n.type || audio.type)}`
    if (!n.televerse) {
      await upload(chemin, audio, {
        access: 'private', handleUploadUrl: '/api/note-jeton', headers: { 'x-cle': cle() ?? '' },
        contentType: audio.type || n.type || 'audio/mp4', multipart: audio.size > 4 * 1024 * 1024,
        abortSignal: AbortSignal.timeout(delaiTeleversement(audio.size)),
      })
      await majNote(n.rdv, { televerse: true }).catch(() => {})
    }
    await api.declarerNote({ rdv: n.rdv, idem: n.idem, chemin, duree })
  } finally { enVol.delete(n.idem) }
}

/** Reprise d'une note gardée sur le téléphone. `force` ignore l'attente entre deux essais. */
export async function envoyerEnAttente(n: NoteEnAttente, force = false): Promise<boolean> {
  if (enDictee(n.rdv) || enVol.has(n.idem) || (!force && (n.prochain ?? 0) > Date.now())) return false
  const b = await reconstituerNote(n)
  if (!b) return false
  try {
    await envoyerNote(n, b)
    await supprimerNote(n.rdv)
    return true
  } catch (e) {
    if ((e as Error).message === 'appairage') throw e
    const essais = (n.essais ?? 0) + 1
    // attente croissante : 10 s, 20 s, 40 s... plafonnée à 5 minutes
    await majNote(n.rdv, { essais, prochain: Date.now() + Math.min(300000, 5000 * 2 ** essais), erreur: 'L’envoi n’est pas passé.' }).catch(() => {})
    return false
  }
}

/** Passe en revue les notes en attente. Renvoie le nombre de notes parties et la date du prochain essai prévu. */
export async function envoyerToutesEnAttente(force = false): Promise<{ parties: number; prochain: number | null }> {
  let parties = 0
  for (const n of await notesEnAttente()) {
    try { if (await envoyerEnAttente(n, force)) parties++ } catch { /* appairage perdu : l'appli s'en charge */ }
  }
  const reste = await notesEnAttente()
  const attente = reste.filter((n) => !enDictee(n.rdv)).map((n) => n.prochain ?? 0)
  return { parties, prochain: attente.length ? Math.min(...attente) : null }
}
