export type CompteRendu = {
  id: string
  statut: 'note_recue' | 'transcription' | 'redaction' | 'a_valider' | 'enregistrement' | 'valide' | 'erreur'
  maj: string
  message?: string
  transcription?: string
  texte?: string
  synthese?: string
  maj_crm?: { resultat?: string; prochaine_action?: string; echeance?: string; phase?: string | null }
}
export type Rdv = {
  id: string; source: 'crm' | 'agenda' | 'prospect'; heure: string; heure_fin: string; debut: string; entreprise: string; ville: string; visio: boolean
  lieu: string; objet: string; contact: string; poste: string; affaire: string | null; montant: string | null; alertes: string[]; titre_agenda?: string
  fiche_prete: boolean; fiche_audio: boolean; preparee_le: string | null; compte_rendu: CompteRendu | null; en_preparation?: boolean
  adresse?: string | null; geo?: { lat: number; lon: number } | null
  nouveau?: boolean; prospect?: { etape?: string; rang?: string | number; decouverte?: { obtenus: number; total: number } } | null
  preparation?: { libelle: string; etat: 'a_faire' | 'en_cours' | 'fait' | 'saute' }[] | null
}
export type Etat = { prenom: string; genere: string; maj: string | null; journees: { jour: string; jour_long: string; rendez_vous: Rdv[] }[] | null
  titres?: { entreprise: string; titre: string; source: string; date: string }[]; bourses?: { entreprise: string; cours: number; variation: number; date: string }[] }

const CLE = 'preparateur-cle'
const ETAT_LOCAL = 'preparateur-etat'
const FICHES_LOCAL = 'preparateur-fiches'
export const DELAI_REQUETE = 30000

/** Dernier état reçu, gardé sur le téléphone pour démarrer sans réseau. */
export function etatLocal(): Etat | null {
  try { const t = localStorage.getItem(ETAT_LOCAL); return t ? JSON.parse(t) as Etat : null } catch { return null }
}
function garderEtat(e: Etat) { try { localStorage.setItem(ETAT_LOCAL, JSON.stringify(e)) } catch { /* mémoire pleine ou privée */ } }
export function effacerLocal() {
  try { localStorage.removeItem(ETAT_LOCAL); localStorage.removeItem(FICHES_LOCAL) } catch { /* rien */ }
  caches?.delete('prep-v2').catch(() => {}); caches?.delete('prep-cle').catch(() => {})
}

/** Le service worker lit la clé ici pour se réabonner aux notifications sans l'appli. */
export function partagerCle(k: string | null) {
  if (!k || !('caches' in window)) return
  caches.open('prep-cle').then((c) => c.put('/cle', new Response(k))).catch(() => {})
}

export function cle(): string | null {
  const h = new URLSearchParams(location.hash.slice(1)).get('cle')
  if (h) {
    try { localStorage.setItem(CLE, h) } catch { /* navigation privée */ }
    history.replaceState(null, '', location.pathname)
    return h
  }
  try { return localStorage.getItem(CLE) } catch { return null }
}

/** Relie ce téléphone avec le code affiché sur le Mac (6 chiffres, ou 8 caractères). */
export async function appairer(code: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/appairage?code=${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(DELAI_REQUETE) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || !d.cle) return d.erreur ?? 'Code incorrect'
    try { localStorage.setItem(CLE, d.cle) } catch { return 'Mémoire du téléphone indisponible' }
    partagerCle(d.cle)
    return null
  } catch { return 'Pas de connexion pour l’instant.' }
}

export function oublier() { try { localStorage.removeItem(CLE) } catch { /* rien */ } effacerLocal() }

export async function appel<T>(chemin: string, init?: RequestInit & { delai?: number }): Promise<T> {
  const { delai, ...reste } = init ?? {}
  const r = await fetch(chemin, { ...reste, signal: AbortSignal.timeout(delai ?? DELAI_REQUETE), headers: { ...(reste.headers ?? {}), 'x-cle': cle() ?? '' } })
  if (r.status === 401) throw new Error('appairage')
  if (!r.ok) throw new Error(`Erreur ${r.status}`)
  return r.json()
}

/**
 * Charge la fiche et/ou l'audio d'un rendez-vous à l'avance : ils passent par le cache hors connexion.
 * Une fiche régénérée (preparee_le différent de la copie gardée) est rechargée de force.
 * `quoi` permet d'étaler : la fiche écrite d'abord, les audios ensuite, sans tout lancer d'un coup.
 */
const dejaCharge = new Set<string>()
function lireVues(): Record<string, string> { try { return JSON.parse(localStorage.getItem(FICHES_LOCAL) ?? '{}') } catch { return {} } }
export function precharger(r: Rdv, quoi: 'tout' | 'fiche' | 'audio' = 'tout') {
  if (!r.fiche_prete || r.source === 'agenda') return
  const version = r.preparee_le ?? ''
  const parts: ['fiche' | 'audio', string][] = []
  if (quoi !== 'audio') parts.push(['fiche', api.fichier(`fiches/${r.id}.html`)])
  if (quoi !== 'fiche' && r.fiche_audio) parts.push(['audio', api.fichier(`fiches/${r.id}.m4a`)])
  for (const [type, u] of parts) {
    const k = `${u}|${version}`
    if (dejaCharge.has(k)) continue
    dejaCharge.add(k)
    const vues = lireVues()
    // ancienne mémoire : une seule entrée par rendez-vous, valable pour la fiche et l'audio
    const force = (vues[`${r.id}|${type}`] ?? vues[r.id]) !== version
    fetch(u, force ? { headers: { 'x-revalider': '1' } } : undefined).then((rep) => {
      if (!rep.ok) throw new Error('echec')
      if (force) { const v = lireVues(); v[`${r.id}|${type}`] = version; try { localStorage.setItem(FICHES_LOCAL, JSON.stringify(v)) } catch { /* rien */ } }
    }).catch(() => dejaCharge.delete(k))
  }
}

/** (Ré)abonne ce téléphone aux notifications si la permission est accordée ; renvoie l'abonnement. */
export async function abonnerPush(force = false): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window) || Notification.permission !== 'granted') return null
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    const { cle_publique } = await api.clePush()
    const brut = atob(cle_publique.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((cle_publique.length + 3) % 4))
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(brut, (c) => c.charCodeAt(0)) })
  }
  const marque = `${sub.endpoint}|${Math.floor(Date.now() / (7 * 24 * 3600 * 1000))}`
  let derniere: string | null = null
  try { derniere = localStorage.getItem('preparateur-push') } catch { /* rien */ }
  if (force || derniere !== marque) {
    await api.abonner(sub.toJSON())
    try { localStorage.setItem('preparateur-push', marque) } catch { /* rien */ }
  }
  return sub
}

export const api = {
  etat: async () => { const e = await appel<Etat>('/api/etat', { delai: 12000 }); garderEtat(e); return e },
  fichier: (chemin: string) => `/api/fichier?chemin=${encodeURIComponent(chemin)}&cle=${encodeURIComponent(cle() ?? '')}`,
  declarerNote: (d: { rdv: string; idem: string; chemin: string; duree: number }) => appel<{ ok: boolean; id: string }>('/api/note', { method: 'POST', body: JSON.stringify(d), headers: { 'content-type': 'application/json' } }),
  valider: (d: { rdv: string; id: string; texte?: string; maj?: unknown }) => appel<{ ok: boolean }>('/api/valider', { method: 'POST', body: JSON.stringify(d), headers: { 'content-type': 'application/json' } }),
  preparer: (rdv: string) => appel<{ ok: boolean }>(`/api/preparer?rdv=${encodeURIComponent(rdv)}`, { method: 'POST' }),
  clePush: () => appel<{ cle_publique: string }>('/api/push'),
  abonner: (a: PushSubscriptionJSON) => appel<{ ok: boolean }>('/api/push?action=abonner', { method: 'POST', body: JSON.stringify(a), headers: { 'content-type': 'application/json' } }),
}
