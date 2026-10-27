// Garde la note vocale sur le téléphone pendant qu'on dicte : si l'appli se ferme ou plante, rien n'est perdu.
export type NoteEnAttente = {
  rdv: string; entreprise: string; type: string; debut: number
  /** identifiant unique de la note, créé à la première seconde : le Mac ignore une note déjà reçue */
  idem: string
  duree?: number
  /** l'audio est déjà dans le stockage : au prochain essai, seule la déclaration est refaite */
  televerse?: boolean
  essais?: number; prochain?: number; erreur?: string
}

/** Identifiant unique (repli si crypto.randomUUID est absent). */
export function nouvelIdem(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  if (c) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

/** Note en cours de dictée dans cette page : on ne l'envoie pas automatiquement. */
let dicteeActive: string | null = null
export const marquerDictee = (rdv: string | null) => { dicteeActive = rdv }
export const enDictee = (rdv: string) => dicteeActive === rdv

const BASE = 'preparateur-notes'

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    const q = indexedDB.open(BASE, 1)
    q.onupgradeneeded = () => {
      q.result.createObjectStore('notes', { keyPath: 'rdv' })
      q.result.createObjectStore('morceaux', { autoIncrement: true }).createIndex('rdv', 'rdv')
    }
    q.onsuccess = () => ok(q.result)
    q.onerror = () => ko(q.error)
  })
}

const fin = (t: IDBTransaction) => new Promise<void>((ok, ko) => { t.oncomplete = () => ok(); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error) })
const lire = <T,>(q: IDBRequest<T>) => new Promise<T>((ok, ko) => { q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error) })

/** Efface l'éventuelle note précédente de ce rendez-vous puis en ouvre une nouvelle. */
export async function commencerNote(n: NoteEnAttente) {
  await supprimerNote(n.rdv)
  const db = await ouvrir()
  const t = db.transaction('notes', 'readwrite')
  t.objectStore('notes').put(n)
  await fin(t)
}

export async function ajouterMorceau(rdv: string, data: Blob) {
  const db = await ouvrir()
  const t = db.transaction('morceaux', 'readwrite')
  t.objectStore('morceaux').add({ rdv, data })
  await fin(t)
}

export async function supprimerNote(rdv: string) {
  const db = await ouvrir()
  const t = db.transaction(['notes', 'morceaux'], 'readwrite')
  t.objectStore('notes').delete(rdv)
  const idx = t.objectStore('morceaux').index('rdv')
  const c = idx.openKeyCursor(IDBKeyRange.only(rdv))
  c.onsuccess = () => { const cur = c.result; if (cur) { t.objectStore('morceaux').delete(cur.primaryKey); cur.continue() } }
  await fin(t)
}

/** Met à jour l'état d'envoi d'une note (essais, prochain essai, erreur). */
export async function majNote(rdv: string, patch: Partial<NoteEnAttente>) {
  const db = await ouvrir()
  const t = db.transaction('notes', 'readwrite')
  const st = t.objectStore('notes')
  const cur = await lire(st.get(rdv) as IDBRequest<NoteEnAttente | undefined>)
  if (cur) st.put({ ...cur, ...patch })
  await fin(t)
}

/** Morceaux sans note (appli fermée en pleine suppression...) : on les efface. */
export async function nettoyerOrphelins() {
  try {
    const db = await ouvrir()
    const rdvs = new Set((await lire(db.transaction('notes').objectStore('notes').getAllKeys())) as string[])
    const t = db.transaction('morceaux', 'readwrite')
    const c = t.objectStore('morceaux').openCursor()
    c.onsuccess = () => { const cur = c.result; if (cur) { if (!rdvs.has((cur.value as { rdv: string }).rdv)) cur.delete(); cur.continue() } }
    await fin(t)
  } catch { /* rien */ }
}

/** Notes enregistrées au moins en partie et jamais envoyées. */
export async function notesEnAttente(): Promise<NoteEnAttente[]> {
  try {
    const db = await ouvrir()
    const toutes = await lire(db.transaction('notes').objectStore('notes').getAll() as IDBRequest<NoteEnAttente[]>)
    const avecSon: NoteEnAttente[] = []
    for (const n of toutes) {
      const nb = await lire(db.transaction('morceaux').objectStore('morceaux').index('rdv').count(IDBKeyRange.only(n.rdv)))
      if (nb > 0) avecSon.push(n.idem ? n : { ...n, idem: `${n.rdv}-${n.debut}` }); else if (!enDictee(n.rdv)) await supprimerNote(n.rdv)
    }
    return avecSon
  } catch { return [] }
}

export async function reconstituerNote(n: NoteEnAttente): Promise<Blob | null> {
  try {
    const db = await ouvrir()
    const m = await lire(db.transaction('morceaux').objectStore('morceaux').index('rdv').getAll(IDBKeyRange.only(n.rdv)) as IDBRequest<{ data: Blob }[]>)
    return m.length ? new Blob(m.map((x) => x.data), { type: n.type }) : null
  } catch { return null }
}
