/* Textes venus du serveur (journal, détails des étapes) : on les rend lisibles par un commercial.
   Nombres au format français, plus de codes boursiers ni de noms d'outils techniques. */

/** 216.55 → 216,55 ; -29.8 → -29,8. Les dates (12.10.2026), les adresses web et les versions ne sont pas touchées. */
export function nombresFr(t: string): string {
  return t
    .split(/(\bhttps?:\/\/\S+|\bwww\.\S+)/)
    .map((part, i) => (i % 2 ? part : part.replace(/(?<![\d.,\w/])(-?\d+)\.(\d+)(?![.\d])/g, '$1,$2')))
    .join('')
}

/** Vocabulaire technique remplacé par des mots de commercial. */
export function sansJargon(t: string): string {
  return t
    .replace(/\s*\(\s*[A-Z0-9]{1,6}\.(?:PA|AS|BR|DE|L|MI|MC|SW|LS|VI|CO|ST|HE|OL|IR)\s*\)/g, '')
    .replace(/\b(?:code|symbole|ticker)\s+[A-Z0-9]{1,6}\.(?:PA|AS|BR|DE|L|MI|MC|SW|LS|VI|CO|ST|HE|OL|IR)\b/gi, '')
    .replace(/\b[A-Z0-9]{1,6}\.(?:PA|AS|BR|DE|L|MI|MC|SW|LS|VI|CO|ST|HE|OL|IR)\b/g, '')
    .replace(/\bnotification ntfy\b/gi, 'notification sur le téléphone')
    .replace(/\bvia ntfy\b/gi, 'sur le téléphone')
    .replace(/\bntfy\b/gi, 'notification')
    .replace(/\bl[’']API Claude\b/g, 'Claude')
    .replace(/\bl[’']API\b/g, 'le service')
    .replace(/\bAPI\b/g, 'service')
    .replace(/\btokens?\b/gi, 'mots')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .trim()
}

/** Les deux à la fois : à appliquer à tout texte libre affiché. */
export const lisible = (t: string | null | undefined) => (t ? nombresFr(sansJargon(t)) : '')

/** Requête de recherche affichée sans ses opérateurs (site:, guillemets, OR, parenthèses, signes moins). */
export function requeteLisible(q: string): string {
  const sites: string[] = []
  let t = q.replace(/\bsite:(\S+)/gi, (_, s: string) => { sites.push(s.replace(/^www\./, '')); return ' ' })
  t = t
    .replace(/\s+(?:OR|\|)\s+/g, ' ¦ ')
    .replace(/\b(?:intitle|inurl|intext|filetype|after|before|related|cache):\S+/gi, ' ')
    .replace(/["“”«»()[\]]/g, ' ')
    .replace(/\s+AND\s+/g, ' ')
    .replace(/(^|\s)-\S+/g, '$1')  // termes exclus : on ne les montre pas
    .replace(/(^|\s)\+(?=\S)/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/(\s*¦\s*)+/g, ' ¦ ')
    .replace(/^[\s¦]+|[\s¦]+$/g, '')
    .replace(/ ¦ /g, ', ')
  if (sites.length) t += `${t ? ' ' : ''}(sur ${sites.join(', ')})`
  return nombresFr(t)
}
