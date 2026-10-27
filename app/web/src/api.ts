/* Deux espaces : les clients déjà dans le CRM (« qualifiés ») et la prospection (CRM de prospection séparé).
   Le mode n'est plus une variable globale : il est fourni par un contexte React (voir mode.tsx) et passé à
   `creerApi(mode)`, qui renvoie des appels déjà liés à ce mode. */
export type Mode = 'qualifie' | 'prospection'
const avecMode = (mode: Mode, url: string) => `${url}${url.includes('?') ? '&' : '?'}mode=${mode}`

/** Toute requête qui modifie quelque chose porte l'en-tête X-Preparateur : le serveur refuse les autres (page web étrangère). */
function req(url: string, init: RequestInit = {}) {
  const methode = (init.method ?? 'GET').toUpperCase()
  if (methode === 'GET' || methode === 'HEAD') return fetch(url, init)
  const h = new Headers(init.headers)
  h.set('X-Preparateur', '1')
  return fetch(url, { ...init, headers: h })
}

export type Etape = { cle: string; libelle: string; etat: 'a_faire' | 'en_cours' | 'fait' | 'saute' }
export type Detail = { etape: string; texte: string; t: number }
export type Preparation = {
  id?: string
  statut: 'en_cours' | 'termine' | 'echec'
  etapes: Etape[]
  details: Detail[]
  debut: number
  fin: number | null
  message: string | null
}
export type EtatFiche = { prete: boolean; audio: boolean; preparee_le: string | null; page: string | null; son: string | null }
export type RendezVous = {
  id: string
  source: 'crm' | 'agenda'
  titre_agenda?: string
  entreprise_connue?: boolean
  nouveau: boolean
  heure: string
  heure_fin: string
  debut: string
  entreprise: string
  ville: string
  type: string
  visio: boolean
  lieu: string
  objet: string
  contact: string
  poste: string
  affaire: string | null
  montant: string | null
  secteur: string
  cotee: boolean
  alertes: string[]
  fiche: EtatFiche
  dans_agenda: boolean
  envoi: { le: string; audio: boolean } | null
  preparation: Preparation | null
  compte_rendu: { id: string; statut: string; texte?: string; synthese?: string; message?: string; maj_crm?: { resultat?: string; prochaine_action?: string; echeance?: string } } | null
  prospect?: Avancement
}
export type Critere = { n: number; critere: string; statut: 'À obtenir' | 'Partiel' | 'Obtenu' | 'Sans objet'; quand: string; preuve: string | null }
export type Avancement = {
  etape: string; etapes: string[]; rang: string | null; origine: string | null
  decouverte: { obtenus: number; partiels: number; total: number }; qualification: { obtenus: number; total: number }; criteres: Critere[]
}
export type Journee = {
  jour: string
  jour_long: string
  commercial: string
  prenom: string
  agenda_ok: boolean
  rendez_vous: RendezVous[]
  horloge: string
  horloge_simulee: boolean
  crm_absent?: boolean
}
export type Jour = { jour: string; libelle: string; court: string; rendez_vous: number }
export type InfoCRM = { ok: boolean; absent?: boolean; fichier?: string; date_export?: string; entreprises?: number; rendez_vous?: number; contacts?: number; taille_ko?: number; depose_le?: string; onglets?: { nom: string; lignes: number }[]; message?: string }
export type Telephone = { relie: boolean; canal: string | null; serveur: string; veille_active: boolean; avance_minutes: number }

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `Erreur ${r.status}`
    try {
      msg = (await r.json()).detail ?? msg
    } catch {
      /* réponse non JSON */
    }
    throw new Error(msg)
  }
  return r.json()
}


/* ------------------------------------------------------------------ coulisses */
export type EtatBloc = 'attente' | 'en_cours' | 'fait' | 'saute' | 'erreur' | 'arrete'
export type DetailBloc = { type: 'recherche' | 'lecture' | 'fait' | 'source' | 'chiffre' | 'texte'; texte: string; url?: string; source?: string; date?: string; interet?: string; t: number }
export type Bloc = { id: string; titre: string; colonne: number; source: string | null; modele: string | null; etat: EtatBloc; debut: number | null; fin: number | null; resume: string | null; details: DetailBloc[] }
export type Options = { bourse: boolean; linkedin?: boolean; angles: string; audio: boolean }
export type Execution = {
  id: string; rid: string; entreprise: string; statut: 'en_cours' | 'termine' | 'echec' | 'arrete'; debut: number; fin: number | null
  message: string | null; options: Options; declencheur: { type: string; libelle: string }; modele: string | null; duree_api_ms: number | null
  blocs: Bloc[]; liens: [string, string][]; journal: { t: number; texte: string }[]; type?: 'client' | 'prospect'
  quota?: { utilise: number | null; reinitialise: number | null; statut: string } | null
  conso?: Conso | ConsoEffacee | null
}
export type ConsoModele = { modele: string; role: string; entree: number; sortie: number; cache_lu: number; cache_ecrit: number; recherches_web: number; cout_usd: number }
export type Conso = { cout_usd: number | null; entree: number; sortie: number; cache_lu: number; cache_ecrit: number; recherches_web: number; modeles: ConsoModele[]; provisoire: boolean }
/** Préparation plus ancienne que les trois dernières fiches : seul le total reste. */
export type ConsoEffacee = { efface: true; cout_usd: number | null; total: number | null }
export type ResumeExecution = { id: string; rid: string; entreprise: string; statut: Execution['statut']; debut: number; fin: number | null; declencheur: { type: string; libelle: string }; faits: number; lectures: number; cout_usd?: number | null; tokens?: number | null; detail?: boolean }
export type Reglages = { modele: 'sonnet' | 'opus'; surveillance: boolean; avance_envoi: number; avance_preparation: number; options: Options }
export type EtatClaude = { installe: boolean; connecte: boolean; version?: string; email?: string; plan?: string; organisation?: string; connexion_en_cours?: boolean; message?: string }
export type Accueil = {
  prenom: string; jour_long: string; rendez_vous: number; fiches_pretes: number; prochain: { heure: string; entreprise: string; contact: string } | null
  titres: { entreprise: string; titre: string; source: string; date: string }[]; bourses: { entreprise: string; cours: number; variation: number; date: string }[]
  clients: number; executions: number
}

const post = (url: string, body?: unknown) =>
  req(url, { method: 'POST', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })

export type Prochain = {
  cle: string; rid: string | null; titre: string; entreprise: string; jour: string; heure: string; maintenant: boolean; passe?: boolean; nouveau: boolean; crm: boolean
  execution: { id: string; statut: Execution['statut']; debut: number; faits: number } | null
}

export type RdvMenu = { id: string; jour: string; jour_long: string; heure: string; entreprise: string; passe: boolean }



/** Ferme proprement un flux de suivi en direct (EventSource) : l'appelant garde la fonction pour le démontage. */
function ouvrirFlux<T extends { statut: string }>(url: string, onEtat: (e: T) => void) {
  const es = new EventSource(url)
  es.onmessage = (ev) => {
    const e = JSON.parse(ev.data) as T
    onEtat(e)
    if (e.statut !== 'en_cours') es.close()
  }
  es.onerror = () => es.close()
  return () => es.close()
}

type Sig = AbortSignal | undefined

/** Appels de l'application Mac liés à un mode. Les appels périodiques acceptent un signal d'annulation. */
export function creerApi(mode: Mode) {
  const api = {
    journee: (jour: string | null, avecAgenda = true, signal?: Sig) =>
      req(avecMode(mode, `/api/journee?avec_agenda=${avecAgenda}${jour ? `&jour=${jour}` : ''}`), { signal }).then((r) => json<Journee>(r)),
    jours: (signal?: Sig) => req(avecMode(mode, '/api/jours'), { signal }).then((r) => json<{ jours: Jour[]; par_defaut: string }>(r)),
    crm: (signal?: Sig) => req(avecMode(mode, '/api/crm'), { signal }).then((r) => json<InfoCRM>(r)),
    deposerCRM: (f: File) => {
      const fd = new FormData()
      fd.append('fichier', f)
      return req(avecMode(mode, '/api/crm'), { method: 'POST', body: fd }).then((r) => json<InfoCRM>(r))
    },
    preparer: (id: string) => req(`/api/preparer/${id}`, { method: 'POST' }).then((r) => json<Preparation>(r)),
    flux: (id: string, onEtat: (p: Preparation) => void) => ouvrirFlux<Preparation>(`/api/preparer/${id}/flux`, onEtat),
    envoyer: (id: string) => req(`/api/envoyer/${id}`, { method: 'POST' }).then((r) => json<{ ok: boolean; le?: string; message?: string }>(r)),
    testerTelephone: () => req('/api/telephone/test', { method: 'POST' }).then((r) => json<{ ok: boolean; message?: string }>(r)),
    telephone: (signal?: Sig) => req('/api/telephone', { signal }).then((r) => json<Telephone>(r)),
    horloge: (h: string | null) =>
      req(`/api/horloge${h ? `?heure_simulee=${encodeURIComponent(h)}` : ''}`, { method: 'POST' }).then((r) => json<{ horloge: string; simulee: boolean }>(r)),
    reinitialiserEnvois: () => req('/api/envois/reinitialiser', { method: 'POST' }).then((r) => json<{ ok: boolean }>(r)),
  }

  const coulisses = {
    rendezVous: (signal?: Sig) => req(avecMode(mode, '/api/rendez-vous'), { signal }).then((r) => json<{ rendez_vous: RdvMenu[] }>(r)),
    prochains: (signal?: Sig) => req(avecMode(mode, '/api/coulisses/prochains'), { signal }).then((r) => json<{ ok: boolean; prochains: Prochain[]; lu_a: string | null }>(r)),
    parRdv: (rid: string, signal?: Sig) => req(`/api/executions/rdv/${rid}`, { signal }).then((r) => json<{ execution: Prochain['execution'] }>(r)),
    modele: (signal?: Sig) => req(avecMode(mode, '/api/workflow'), { signal }).then((r) => json<{ blocs: Omit<Bloc, 'etat' | 'debut' | 'fin' | 'resume' | 'details'>[]; liens: [string, string][] }>(r)),
    rafraichirAgenda: () => post('/api/agenda/rafraichir').then((r) => json<{ ok: boolean; evenements: number }>(r)),
    liste: (signal?: Sig) => req(avecMode(mode, '/api/executions'), { signal }).then((r) => json<{ executions: ResumeExecution[]; en_cours: string[] }>(r)),
    detail: (id: string, signal?: Sig) => req(`/api/executions/${id}`, { signal }).then((r) => json<Execution>(r)),
    flux: (id: string, onEtat: (e: Execution) => void) => ouvrirFlux<Execution>(`/api/executions/${id}/flux`, onEtat),
    arreter: (id: string) => post(`/api/executions/${id}/arreter`).then((r) => json<{ ok: boolean; message?: string }>(r)),
    relancer: (id: string, options?: Options) => post(`/api/executions/${id}/relancer`, options).then((r) => json<{ id: string }>(r)),
    lancer: (rid: string, options: Options) => post(`/api/preparer/${rid}`, options).then((r) => json<{ id: string }>(r)),
    reglages: (signal?: Sig) => req('/api/reglages', { signal }).then((r) => json<Reglages>(r)),
    enregistrer: (r: Partial<Reglages>) => post('/api/reglages', r).then((x) => json<Reglages>(x)),
  }

  return { api, coulisses }
}

export type ApiMode = ReturnType<typeof creerApi>


export const compte = {
  etat: (signal?: Sig) => req('/api/claude', { signal }).then((r) => json<EtatClaude>(r)),
  connecter: () => post('/api/claude/connexion').then((r) => json<{ ok: boolean; message: string }>(r)),
  deconnecter: () => post('/api/claude/deconnexion').then((r) => json<EtatClaude>(r)),
  installer: () => post('/api/claude/installer').then((r) => json<{ ok: boolean; message: string }>(r)),
  agenda: () => req('/api/claude/agenda').then((r) => json<{ ok: boolean; evenements: number; message?: string }>(r)),
  declencheur: (signal?: Sig) => req('/api/agenda/declencheur', { signal }).then((r) => json<{ canal: string | null; ecoute: boolean; dernier_signal: string | null; evenements: number; source: string | null; code: string }>(r)),
  relais: (signal?: Sig) => req('/api/relais', { signal }).then((r) => json<{ configure: boolean; url: string | null; lien: string | null; ecoute: boolean; derniere_publication: string | null; erreur: string | null }>(r)),
  codeAppairage: () => post('/api/relais/code').then((r) => json<{ code: string; minutes: number; lien: string }>(r)),
  validerCR: (rid: string, texte?: string) => post(`/api/compte-rendu/${rid}/valider`, texte ? { texte } : {}).then((r) => json<{ ok: boolean }>(r)),
  profil: (signal?: Sig) => req('/api/profil', { signal }).then((r) => json<{ prenom: string }>(r)),
  enregistrerProfil: (prenom: string) => post('/api/profil', { prenom }).then((r) => json<{ prenom: string }>(r)),
  accueil: (signal?: Sig) => req('/api/accueil', { signal }).then((r) => json<Accueil>(r)),
}

/* ------------------------------------------------------------------ agenda complet (tous types, indépendant du mode) */
export type TypeRdv = 'qualifie' | 'prospect' | 'agenda'
export type RdvAgenda = {
  id: string; jour: string; debut: string; heure: string; heure_fin: string; type: TypeRdv
  entreprise: string; contact: string; poste: string; lieu: string; visio: boolean; objet: string
  fiche: EtatFiche; en_preparation: boolean; etape: string | null; rang: string | null; alertes: string[]
  affaire: string | null; montant: string | null; passe: boolean; nouveau: boolean
}
export type AgendaComplet = {
  debut: string; fin: string; aujourdhui: string; horloge: string
  compte: { qualifie: number; prospect: number; agenda: number }; rendez_vous: RdvAgenda[]
}
export const agenda = {
  complet: (debut: string, fin: string, signal?: Sig) =>
    req(`/api/agenda/complet?debut=${debut}&fin=${fin}`, { signal }).then((r) => json<AgendaComplet>(r)),
}
