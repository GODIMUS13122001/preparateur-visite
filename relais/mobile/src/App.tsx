import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  Bell, CalendarX2, Car, Check, ChevronDown, ChevronLeft, FileText, Headphones, Loader2, Mic, Pause, Play, RotateCcw,
  Send, Share, Square, WifiOff, X,
} from 'lucide-react'
import { abonnerPush, api, appairer, cle, etatLocal, oublier, partagerCle, precharger, type CompteRendu, type Etat, type Rdv } from './api'
import { ajouterMorceau, commencerNote, enDictee, marquerDictee, nettoyerOrphelins, notesEnAttente, nouvelIdem, reconstituerNote, supprimerNote, type NoteEnAttente } from './notes'
import { envoyerEnAttente, envoyerNote, envoyerToutesEnAttente } from './envoi'
import { Voiture } from './Voiture'
import { Plan } from './Plan'
import { Accueil } from './Accueil'
import { RdvContexte } from './Instruments'
import { Fabrication, PastilleFabrication } from './Fabrication'
import { Calendrier, EnTeteCarte, Paquet, estGeneree, debutMs, estPasse, isoJour, useDefilement, type ControleCalendrier } from './Pile'
import { TextShimmer } from '@/components/motion-primitives/text-shimmer'
import { BorderTrail } from '@/components/motion-primitives/border-trail'
import { cn } from '@/lib/utils'

const SHIMMER = '[--base-color:#6A647A] [--base-gradient-color:var(--color-violet)]'
const VERRE = 'bg-fond ring-1 ring-encre/[0.06]'
const autonome = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

/* Filtre Tous / Clients / Prospects, mémorisé sur le téléphone */
type Filtre = 'tous' | 'clients' | 'prospects'
const CLE_FILTRE = 'preparateur-filtre'
const filtreMemorise = (): Filtre => { try { const v = localStorage.getItem(CLE_FILTRE); return v === 'clients' || v === 'prospects' ? v : 'tous' } catch { return 'tous' } }
const memoriserFiltre = (f: Filtre) => { try { localStorage.setItem(CLE_FILTRE, f) } catch { /* stockage indisponible */ } }
/** Les rendez-vous ajoutés seulement à l'agenda ne comptent que dans « Tous ». */
const dansFiltre = (r: Rdv, f: Filtre) => f === 'tous' || (f === 'clients' ? r.source === 'crm' : r.source === 'prospect')
const OPTIONS_FILTRE: { id: Filtre; libelle: string; actif: string }[] = [
  { id: 'tous', libelle: 'Tous', actif: 'bg-encre text-white' },
  { id: 'clients', libelle: 'Clients', actif: 'bg-violet text-white' },
  { id: 'prospects', libelle: 'Prospects', actif: 'bg-corail text-white' },
]
function FiltreType({ valeur, onChange }: { valeur: Filtre; onChange: (f: Filtre) => void }) {
  return (
    <div role="group" aria-label="Type de rendez-vous" className="relative z-10 px-4 pb-1">
      <div className="flex rounded-full bg-white/70 p-0.5 ring-1 ring-encre/[0.06]">
        {OPTIONS_FILTRE.map((o) => (
          <button key={o.id} type="button" aria-pressed={valeur === o.id} onClick={() => onChange(o.id)}
            className={cn('min-h-11 flex-1 rounded-full text-sm font-semibold transition-colors duration-200', valeur === o.id ? o.actif : 'text-ardoise')}>{o.libelle}</button>
        ))}
      </div>
    </div>
  )
}

const heureCourte = (d: Date) => `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`
/** Heure de la dernière mise à jour du Mac si elle a plus de 40 minutes, sinon rien. */
function macInjoignable(etat: Etat | null, maintenant: number): string | null {
  const g = etat?.genere ? new Date(etat.genere) : null
  if (!g || Number.isNaN(g.getTime()) || maintenant - g.getTime() < 40 * 60000) return null
  return heureCourte(g)
}

/* ==================================================================== application */

export default function App() {
  const [appaire, setAppaire] = useState(() => !!cle())
  // le dernier état reçu est affiché tout de suite, même sans réseau
  const [etat, setEtat] = useState<Etat | null>(() => (cle() ? etatLocal() : null))
  const etatRef = useRef(etat)
  etatRef.current = etat
  const [reseau, setReseau] = useState(false) // au moins un état frais reçu depuis l'ouverture
  // empreinte du dernier état affiché : un état identique ne redessine rien
  const empreinte = useRef<string | null>(null)
  if (empreinte.current === null) empreinte.current = etat ? JSON.stringify(etat) : ''
  // réseau absent (navigateur hors ligne, ou dernière demande sans réponse du réseau)
  const [horsLigne, setHorsLigne] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const lienInitial = () => { const q = new URLSearchParams(location.search); const id = q.get('rdv'); return id ? { id, ecouter: q.get('ecouter') === '1' } : null }
  // lien de notification : carte à ouvrir (et écoute directe si demandée)
  const [ouvert, setOuvert] = useState<{ id: string; ecouter: boolean } | null>(lienInitial)
  const [erreur, setErreur] = useState<string | null>(null)
  const [rapide, setRapide] = useState(false)
  // carte en fabrication (demandée depuis le téléphone) : on suit son avancement de près
  const [fabrication, setFabrication] = useState<{ rid: string; depuis: number; reduit: boolean } | null>(null)
  const [voiture, setVoiture] = useState<{ liste: Rdv[]; debut: number } | null>(null)
  const [enAttente, setEnAttente] = useState<NoteEnAttente[]>([])
  const majNotes = useCallback(() => { notesEnAttente().then((l) => setEnAttente(l.filter((n) => !enDictee(n.rdv)))) }, [])
  useEffect(() => { nettoyerOrphelins().then(majNotes) }, [majNotes])

  // renvoi automatique des notes en attente : à l'ouverture, au retour du réseau, au retour au premier plan, avec attente croissante
  const minuteur = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const envoiAuto = useCallback(async (force = false) => {
    clearTimeout(minuteur.current)
    const { parties, prochain } = await envoyerToutesEnAttente(force).catch(() => ({ parties: 0, prochain: null }))
    majNotes()
    if (parties) setRapide(true)
    if (prochain !== null) minuteur.current = setTimeout(() => { if (document.visibilityState === 'visible') envoiAuto() }, Math.max(3000, prochain - Date.now()))
  }, [majNotes])
  useEffect(() => {
    if (!appaire) return
    envoiAuto()
    const retour = () => envoiAuto(true)
    const visible = () => { if (document.visibilityState === 'visible') envoiAuto() }
    window.addEventListener('online', retour)
    document.addEventListener('visibilitychange', visible)
    return () => { clearTimeout(minuteur.current); window.removeEventListener('online', retour); document.removeEventListener('visibilitychange', visible) }
  }, [appaire, envoiAuto])

  useEffect(() => {
    const hors = () => setHorsLigne(true)
    const en = () => setHorsLigne(false)
    window.addEventListener('offline', hors)
    window.addEventListener('online', en)
    return () => { window.removeEventListener('offline', hors); window.removeEventListener('online', en) }
  }, [])

  // notifications : réabonnement discret si la permission est accordée ; la clé est partagée avec le service worker
  useEffect(() => {
    if (!appaire) return
    partagerCle(cle())
    abonnerPush().catch(() => {})
  }, [appaire])

  const charger = useCallback(async () => {
    try {
      const e = await api.etat()
      const s = JSON.stringify(e)
      if (s !== empreinte.current) { empreinte.current = s; setEtat(e) }
      setReseau(true)
      setErreur(null)
      setHorsLigne(false)
    } catch (e) {
      const nom = (e as Error).name
      if (nom === 'TypeError' || nom === 'TimeoutError' || nom === 'AbortError' || !navigator.onLine) setHorsLigne(true)
      if ((e as Error).message === 'appairage') { oublier(); empreinte.current = ''; setEtat(null); setAppaire(false) } // téléphone délié : on efface les fiches et l'état gardés
      else {
        const maj = etatRef.current?.maj ? new Date(etatRef.current.maj) : null
        setErreur(maj && !Number.isNaN(maj.getTime()) ? `Hors connexion, mise à jour à ${heureCourte(maj)}` : etatRef.current ? 'Hors connexion.' : 'Pas de connexion pour l’instant.')
      }
    }
  }, [])

  // rafraîchissement : rapide quand un compte rendu est en cours, lent sinon, jamais en arrière-plan
  useEffect(() => {
    if (!appaire) return
    charger()
    const t = setInterval(() => { if (document.visibilityState === 'visible') charger() }, rapide || fabrication ? 3000 : 20000)
    const v = () => document.visibilityState === 'visible' && charger()
    document.addEventListener('visibilitychange', v)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', v) }
  }, [appaire, rapide, fabrication, charger])

  useEffect(() => {
    const m = (e: MessageEvent) => { const q = new URL(e.data?.lien ?? '/', location.origin).searchParams; const r = q.get('rdv'); if (r) { setOuvert({ id: r, ecouter: q.get('ecouter') === '1' }); setAccueil(false) } }
    navigator.serviceWorker?.addEventListener('message', m)
    return () => navigator.serviceWorker?.removeEventListener('message', m)
  }, [])

  const tous = useMemo(() => etat?.journees?.flatMap((j) => j.rendez_vous) ?? [], [etat])
  useEffect(() => {
    setRapide(tous.some((r) => r.compte_rendu && !['a_valider', 'valide', 'erreur'].includes(r.compte_rendu.statut)))
  }, [tous])

  // toutes les fiches prêtes d'aujourd'hui et des jours suivants sont chargées d'avance : fiche et audio restent disponibles sans réseau.
  // Une fiche régénérée (preparee_le qui change) est rechargée dès la mise à jour de l'état.
  // Rien ne part avant le premier affichage : d'abord le prochain rendez-vous (fiche et audio), puis les autres fiches,
  // puis les autres audios, un fichier à la fois quand le téléphone est libre.
  const premierAffichage = useRef(Date.now())
  useEffect(() => {
    const aujourdhui = isoJour(new Date())
    const prets = tous.filter((r) => r.fiche_prete && r.source !== 'agenda' && r.debut.slice(0, 10) >= aujourdhui)
    if (!prets.length) return
    const prochain = prets.find((r) => debutMs(r) >= Date.now() - 30 * 60000) ?? prets[0]
    const autres = prets.filter((r) => r !== prochain)
    const file: (() => void)[] = [() => precharger(prochain), ...autres.map((r) => () => precharger(r, 'fiche')), ...autres.map((r) => () => precharger(r, 'audio'))]
    type Ric = (f: () => void, o?: { timeout: number }) => number
    const ric = (window as unknown as { requestIdleCallback?: Ric }).requestIdleCallback
    let t: ReturnType<typeof setTimeout> | undefined
    let fini = false
    const suivant = () => {
      if (fini) return
      const f = file.shift()
      if (!f) return
      const lancer = () => { if (!fini) { f(); t = setTimeout(suivant, 1200) } }
      if (ric) ric(lancer, { timeout: 2000 }); else lancer()
    }
    // attendre la fin de l'accueil et le premier affichage de la journée (au moins 3,5 s après l'ouverture)
    t = setTimeout(suivant, Math.max(500, 3500 - (Date.now() - premierAffichage.current)))
    return () => { fini = true; clearTimeout(t) }
  }, [tous])

  // un seul paquet pour tous les jours, dans l'ordre ; on démarre sur le prochain rendez-vous
  const [index, setIndex] = useState(0)
  const [accueil, setAccueil] = useState(() => !lienInitial()) // jamais d'accueil animé derrière un lien de notification
  const [parametres, setParametres] = useState(false)
  const [maintenant, setMaintenant] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setMaintenant(Date.now()), 30000); return () => clearInterval(t) }, [])
  const place = useRef(false)
  const [filtre, setFiltre] = useState<Filtre>(filtreMemorise)
  // changer de filtre : on se replace sur la carte courante si elle reste, sinon sur la prochaine du nouveau paquet
  const choisirFiltre = (f: Filtre) => { if (f === filtre) return; place.current = false; setFiltre(f); memoriserFiltre(f) }
  const journeesBrutes = useMemo(() => etat?.journees ?? [], [etat])
  const journees = useMemo(() => journeesBrutes.map((j) => ({ ...j, rendez_vous: j.rendez_vous.filter((r) => dansFiltre(r, filtre)) })), [journeesBrutes, filtre])
  const etatFiltre = useMemo(() => (etat ? { ...etat, journees: etat.journees ? journees : null } : null), [etat, journees])
  // fiches demandées depuis le téléphone : affichées « en préparation » sans attendre le Mac
  const [demandes, setDemandes] = useState<Set<string>>(() => new Set())
  const tousRdv = useMemo(() => journees.flatMap((j) => j.rendez_vous.map((r) => (demandes.has(r.id) && !r.fiche_prete ? { ...r, en_preparation: true } : r))), [journees, demandes])
  // le paquet ne contient que les cartes générées ; la suivante se fabrique en poussant la dernière
  const paquet = useMemo(() => tousRdv.filter((r) => estGeneree(r) || r.source === 'agenda'), [tousRdv])
  const enFabrication = fabrication ? tousRdv.find((r) => r.id === fabrication.rid) ?? null : null
  const prochaine = fabrication ? null : tousRdv.find((r) => r.source !== 'agenda' && !estGeneree(r) && debutMs(r) >= Date.now() - 30 * 60000) ?? null
  useEffect(() => {
    if (!etat || place.current) return
    place.current = true
    const i = paquet.findIndex((r) => debutMs(r) >= Date.now() - 30 * 60000)
    setIndex(i >= 0 ? i : Math.max(0, paquet.length - 1))
  }, [etat, paquet])
  // la carte affichée, gardée d'un état à l'autre (déclarée ici : le lien de notification s'en sert)
  const vue = useRef<string | null>(null)
  // jour choisi dans la semaine sans aucune carte : état vide à la place de l'ancienne carte
  const [jourVide, setJourVide] = useState<{ jour: string; message: string } | null>(null)
  // lien de notification : on va directement à la bonne carte
  useEffect(() => {
    if (!ouvert) return
    // le lien vise un rendez-vous que le filtre cache : on revient à « Tous »
    if (filtre !== 'tous' && !tousRdv.some((r) => r.id === ouvert.id) && journeesBrutes.some((j) => j.rendez_vous.some((r) => r.id === ouvert.id))) { choisirFiltre('tous'); return }
    if (!paquet.length) return
    const i = paquet.findIndex((r) => r.id === ouvert.id)
    // l'état gardé sur le téléphone peut être ancien : on attend un état frais avant de renoncer (sauf hors connexion)
    if (i < 0 && !reseau && !erreur) return
    if (i >= 0) {
      place.current = true; vue.current = paquet[i].id; setIndex(i); setAccueil(false); setJourVide(null)
      if (ouvert.ecouter) { const r = paquet[i]; const l = (journees.find((j) => j.rendez_vous.some((y) => y.id === r.id))?.rendez_vous ?? []).filter((y) => y.source !== 'agenda' && y.fiche_audio); if (l.some((y) => y.id === r.id)) setVoiture({ liste: l, debut: l.findIndex((y) => y.id === r.id) }) }
    }
    else {
      // carte absente du paquet (pas de fiche) : on ouvre au moins sa journée, sans planter
      const r = tousRdv.find((x) => x.id === ouvert.id)
      if (r) { const j = r.debut.slice(0, 10); setJourVu(j); const k = paquet.findIndex((x) => x.debut.slice(0, 10) >= j); if (k >= 0) { place.current = true; vue.current = paquet[k].id; setIndex(k) } }
      setAccueil(false)
    }
    setOuvert(null); history.replaceState(null, '', '/')
  }, [ouvert, paquet, reseau, erreur, journees, journeesBrutes, tousRdv, filtre]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (paquet.some((r) => r.en_preparation)) setRapide(true) }, [paquet])
  const commande = useRef<((sens: 1 | -1) => void) | null>(null)
  const controle = useRef<ControleCalendrier | null>(null)
  const idx = Math.min(index, Math.max(0, paquet.length - 1))
  const courant = paquet[idx]
  // une carte qui s'insère dans le paquet (fiche fraîchement prête) ne doit pas faire changer la carte affichée
  useEffect(() => {
    const i = vue.current ? paquet.findIndex((r) => r.id === vue.current) : -1
    if (i >= 0 && i !== index) setIndex(i)
  }, [paquet]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { vue.current = courant?.id ?? null }, [courant])
  useEffect(() => setJourVide(null), [idx, filtre])
  const jourCourant = (courant && journees.find((j) => j.rendez_vous.some((r) => r.id === courant.id))?.jour) ?? journees[0]?.jour ?? isoJour(new Date(maintenant))
  const [jourVu, setJourVu] = useState<string | null>(null)
  useEffect(() => setJourVu(null), [jourCourant])

  // actions des cartes : fonctions stables (les cartes mémoïsées ne se redessinent pas pour rien)
  const actions = useRef<{ voiture: (r: Rdv) => void; preparer: (r: Rdv) => void; envoye: () => void }>({ voiture: () => {}, preparer: () => {}, envoye: () => {} })
  const surVoiture = useCallback((r: Rdv) => actions.current.voiture(r), [])
  const surPreparer = useCallback((r: Rdv) => actions.current.preparer(r), [])
  const surEnvoye = useCallback(() => actions.current.envoye(), [])
  const rendre = useCallback((r: Rdv, actif: boolean) => (
    <ContenuCarte key={r.id} r={r} actif={actif} maintenant={maintenant} controle={controle} onVoiture={surVoiture} onPreparer={surPreparer} onEnvoye={surEnvoye} />
  ), [maintenant, surVoiture, surPreparer, surEnvoye])
  const allerAuProchain = () => {
    setJourVide(null); setJourVu(null)
    const i = paquet.findIndex((r) => debutMs(r) >= Date.now() - 30 * 60000)
    setIndex(i >= 0 ? i : Math.max(0, paquet.length - 1))
  }

  if (!appaire) return <Appairage onRelie={() => setAppaire(true)} />
  const ouvrirVoiture = (depuis: Rdv) => {
    const j = journees.find((x) => x.rendez_vous.some((y) => y.id === depuis.id))
    const l = (j?.rendez_vous ?? []).filter((r) => r.source !== 'agenda' && r.fiche_audio)
    if (!l.length) return
    setVoiture({ liste: l, debut: Math.max(0, l.findIndex((r) => r.id === depuis.id)) })
  }
  const preparer = (r: Rdv) => {
    setFabrication({ rid: r.id, depuis: Date.now(), reduit: false })
    setDemandes((d) => new Set(d).add(r.id))
    setRapide(true)
    api.preparer(r.id).catch(() => { setDemandes((d) => { const n = new Set(d); n.delete(r.id); return n }); setErreur('La demande de fiche n’est pas passée. Réessayez dans un instant.') })
  }
  actions.current = { voiture: ouvrirVoiture, preparer, envoye: () => { setRapide(true); charger(); majNotes() } }

  return (
    <RdvContexte.Provider value={tousRdv}>
    <div aria-hidden className="barre-etat" />
    <div className="flex h-dvh flex-col overflow-hidden">
      <Calendrier etat={etatFiltre} jour={jourVu ?? jourCourant} maintenant={maintenant} controle={controle}
        onJour={(j) => {
          // première carte du jour touché (dans le filtre) ; sinon un vrai état vide prend la place de la carte
          const duJour = journees.find((x) => x.jour === j)?.rendez_vous ?? []
          const i = paquet.findIndex((r) => duJour.some((y) => y.id === r.id))
          if (i >= 0) { setJourVu(null); setJourVide(null); setIndex(i); return null }
          const quand = new Date(`${j}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
          const ailleurs = journeesBrutes.find((x) => x.jour === j)?.rendez_vous.length
          const genre = filtre === 'clients' ? ' client' : filtre === 'prospects' ? ' prospect' : ''
          setJourVu(j)
          setJourVide({ jour: j, message: duJour.length ? `Pas encore de fiche prête pour le ${quand}.` : `Aucun rendez-vous${genre} le ${quand}.${ailleurs ? ' Choisissez « Tous » pour voir les autres.' : ''}` })
          return null
        }}
        onLogo={() => setAccueil(true)} onParametres={() => setParametres(true)} alerte={enAttente.length > 0 || !!erreur || !!macInjoignable(etat, maintenant)}>
 {!erreur && macInjoignable(etat, maintenant) && (
          <div role="status" className="flex items-center gap-2 rounded-2xl bg-alerte-fond p-3 text-sm text-alerte"><WifiOff size={16} className="shrink-0" /> Mac injoignable depuis {macInjoignable(etat, maintenant)}. Les informations affichées peuvent dater.</div>
        )}
        {erreur && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-alerte-fond p-3 text-sm text-alerte">
            <span className="flex items-center gap-2"><WifiOff size={16} /> {erreur}</span>
            <button onClick={charger} className="min-h-11 rounded-full bg-alerte px-5 font-semibold text-white">Réessayer</button>
          </div>
        )}
      </Calendrier>

      {/* hors connexion : dit en permanence, en haut, tant que le réseau manque */}
      {horsLigne && (
        <div role="status" className="relative z-10 mx-4 mb-1.5 flex min-h-11 items-center gap-2 rounded-2xl bg-alerte-fond px-3 text-sm text-alerte">
          <WifiOff size={16} className="shrink-0" /> <span><b className="font-semibold">Hors connexion</b> : vos fiches et leur audio restent disponibles.</span>
        </div>
      )}

      <FiltreType valeur={filtre} onChange={choisirFiltre} />

      {enAttente.length > 0 && <div className="relative z-10 space-y-2 px-4 pb-2">{enAttente.map((n) => <NoteEnAttenteBandeau key={n.rdv} n={n} onFait={() => { majNotes(); setRapide(true); charger() }} onEssai={majNotes} />)}</div>}

      <main className="relative min-h-0 flex-1 pt-1">
        {!etat && !erreur ? (
          <div className="grid h-full place-items-center"><TextShimmer className={SHIMMER}>Je récupère votre journée...</TextShimmer></div>
        ) : jourVide ? (
          <div className="flex h-full flex-col items-center justify-center rounded-t-[30px] bg-white px-8 text-center">
            <span className="grid size-16 place-items-center rounded-3xl bg-voile text-violet"><CalendarX2 size={30} /></span>
            <p className="titre mt-4 text-[28px] leading-tight text-encre">{jourVide.message.startsWith('Pas encore') ? 'Pas encore de fiche ce jour-là' : 'Rien de prévu ce jour-là'}</p>
            <p className="mt-2 text-sm text-ardoise">{jourVide.message}</p>
            {paquet.length > 0 && <button onClick={allerAuProchain} className="mt-5 min-h-12 rounded-full bg-encre px-6 font-semibold text-white">Voir le prochain rendez-vous</button>}
            {filtre !== 'tous' && <button onClick={() => { setJourVide(null); choisirFiltre('tous') }} className="mt-2 min-h-11 px-4 text-sm font-semibold text-ardoise underline underline-offset-4">Voir tous les rendez-vous</button>}
          </div>
        ) : (
          <Paquet rdvs={paquet} index={idx} onIndex={setIndex} maintenant={maintenant} commande={commande} prochaine={prochaine} onPreparer={preparer}
            rendre={rendre}
            vide={filtre !== 'tous' && !prochaine && journeesBrutes.some((j) => j.rendez_vous.length) ? (
              <div className="flex h-full flex-col items-center justify-center rounded-t-[30px] bg-white px-8 text-center">
                <p className="titre text-[28px] text-encre">{filtre === 'clients' ? 'Aucun rendez-vous client' : 'Aucun rendez-vous prospect'}</p>
                <p className="mt-2 text-sm text-ardoise">Ce filtre ne laisse aucune carte.</p>
                <button onClick={() => choisirFiltre('tous')} className="mt-5 min-h-12 rounded-full bg-encre px-6 font-semibold text-white">Voir tous les rendez-vous</button>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center rounded-t-[30px] bg-white px-8 text-center">
                <p className="titre text-[28px] text-encre">{prochaine ? 'Aucune fiche prête pour l’instant' : 'Aucun rendez-vous à venir'}</p>
                {prochaine ? (
                  <button onClick={() => preparer(prochaine)} className="mt-5 min-h-12 rounded-full bg-violet px-6 font-semibold text-white">Préparer la fiche {prochaine.entreprise}</button>
                ) : <p className="mt-2 text-sm text-ardoise">Les prochains rendez-vous de votre agenda apparaîtront ici.</p>}
              </div>
            )} />
        )}
        <AnimatePresence>
          {enFabrication && fabrication && !fabrication.reduit && (
            <Fabrication key="fabrication" r={enFabrication} depuis={fabrication.depuis}
              onReduire={() => setFabrication((f) => f && { ...f, reduit: true })}
              onTermine={() => { const i = paquet.findIndex((x) => x.id === fabrication.rid); if (i >= 0) setIndex(i); setFabrication(null) }} />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {enFabrication && fabrication?.reduit && (
            <PastilleFabrication key="pastille" r={enFabrication} onOuvrir={() => setFabrication((f) => f && { ...f, reduit: false })} />
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {parametres && <Parametres key="parametres" etat={etat} onFermer={() => setParametres(false)} onDelier={() => { oublier(); setEtat(null); setParametres(false); setAppaire(false) }} />}
      </AnimatePresence>
      <AnimatePresence>
        {voiture && <Voiture key="voiture" rdvs={voiture.liste} debut={voiture.debut} onFermer={() => setVoiture(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {accueil && <Accueil key="accueil" etat={etat} onEntrer={() => setAccueil(false)} />}
      </AnimatePresence>
    </div>
    </RdvContexte.Provider>
  )
}

function NoteEnAttenteBandeau({ n, onFait, onEssai }: { n: NoteEnAttente; onFait: () => void; onEssai: () => void }) {
  const [envoi, setEnvoi] = useState(false)
  const [confirmer, setConfirmer] = useState(false)
  const envoyer = async () => {
    setEnvoi(true)
    const ok = await envoyerEnAttente(n, true).catch(() => false)
    setEnvoi(false)
    if (ok) onFait(); else onEssai() // le bandeau se met à jour après chaque échec
  }
  const prochain = n.prochain && n.prochain > Date.now() ? heureCourte(new Date(n.prochain)) : null
  return (
    <div className="rounded-[22px] border border-alerte/40 bg-alerte-fond p-4 text-sm">
      <p className="flex items-start gap-2 font-semibold text-alerte"><Mic size={16} className="mt-0.5 shrink-0" /> Une note non envoyée pour {n.entreprise}</p>
      <div aria-live="polite">{n.erreur && <p role="alert" className="mt-2 text-alerte">{n.erreur} Votre note reste sur ce téléphone{prochain ? `, nouvel essai automatique vers ${prochain}` : ', nouvel essai automatique dès le retour du réseau'}.</p>}</div>
      {confirmer ? (
        <div role="group" aria-label="Effacer cette note ?" className="mt-3 flex flex-wrap items-center gap-x-5">
          <span className="font-semibold text-encre">Effacer cette note ?</span>
          <button onClick={() => { supprimerNote(n.rdv).then(onFait) }} className="min-h-11 font-semibold text-erreur underline underline-offset-4">Effacer</button>
          <button onClick={() => setConfirmer(false)} className="min-h-11 font-semibold text-ardoise underline underline-offset-4">Garder</button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-4">
          <button onClick={envoyer} disabled={envoi} className="flex min-h-11 items-center gap-2 rounded-full bg-violet px-6 font-semibold text-white disabled:opacity-70">{envoi ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {n.erreur ? 'Réessayer' : 'Envoyer'}</button>
          <button onClick={() => setConfirmer(true)} disabled={envoi} className="min-h-11 px-2 font-semibold text-ardoise underline underline-offset-4">Supprimer</button>
        </div>
      )}
    </div>
  )
}

/* ==================================================================== paramètres (comme « Mon compte » sur le Mac) */

function Parametres({ etat, onFermer, onDelier }: { etat: Etat | null; onFermer: () => void; onDelier: () => void }) {
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'denied'))
  const [occupe, setOccupe] = useState(false)
  const [confirmer, setConfirmer] = useState(false)
  const installee = autonome()
  const iphone = /iPhone|iPad/.test(navigator.userAgent)
  const possible = 'PushManager' in window && 'Notification' in window
  const activer = async () => {
    setOccupe(true)
    try {
      const p = await Notification.requestPermission()
      setPerm(p)
      if (p !== 'granted') return
      await abonnerPush(true)
    } finally { setOccupe(false) }
  }
  const maj = etat?.maj ? heureCourte(new Date(etat.maj)) : null
  const Ligne = ({ titre, children }: { titre: string; children: React.ReactNode }) => (
    <section className="rounded-[22px] bg-white p-5 ring-1 ring-encre/[0.05]">
      <h2 className="text-[19px] text-encre">{titre}</h2>
      <div className="mt-2 text-sm text-ardoise">{children}</div>
    </section>
  )
  return (
    <motion.div role="dialog" aria-label="Paramètres" className="fixed inset-0 z-[45] overflow-y-auto bg-fond"
      initial={{ transform: 'translateX(100%)' }} animate={{ transform: 'translateX(0%)' }} exit={{ transform: 'translateX(100%)' }}
      transition={{ duration: 0.38, ease: [0.32, 0.72, 0, 1] }}>
      <div className="haut-sur bas-sur px-4">
        <div className="flex items-center gap-2 pb-2">
          <button onClick={onFermer} aria-label="Retour" className="grid size-11 place-items-center rounded-full text-encre active:bg-encre/5"><ChevronLeft size={22} /></button>
          <h1 className="text-[26px] text-encre">Paramètres</h1>
        </div>
        <div className="mt-2 space-y-3">
          <Ligne titre="Notifications">
            {!possible || (iphone && !installee) ? <p>Installez d’abord l’application sur l’écran d’accueil : les notifications ne marchent qu’une fois l’appli installée.</p>
              : perm === 'granted' ? <p className="flex items-center gap-2 font-semibold text-ok"><Check size={16} /> Activées : votre fiche 30 minutes avant, votre compte rendu dès qu’il est prêt.</p>
              : perm === 'denied' ? <p>Refusées. Pour les réactiver : Réglages de l’iPhone, puis Notifications, puis Préparateur de visite.</p>
              : (
                <>
                  <p>Votre fiche 30 minutes avant, votre compte rendu dès qu’il est prêt.</p>
                  <button onClick={activer} disabled={occupe} className="mt-3 flex min-h-12 items-center gap-2 rounded-full bg-violet px-5 font-semibold text-white disabled:opacity-70">
                    {occupe ? <Loader2 size={16} className="animate-spin" /> : <Bell size={16} />} Activer les notifications
                  </button>
                </>
              )}
          </Ligne>
          <Ligne titre="Application">
            {installee ? <p className="flex items-center gap-2 font-semibold text-ok"><Check size={16} /> Installée sur l’écran d’accueil.</p>
              : <p>Touchez <Share size={14} className="inline -translate-y-0.5" /> en bas de Safari, puis « Sur l’écran d’accueil ».</p>}
            <p className="mt-2">La prochaine fiche et son audio restent sur le téléphone : vous pouvez les écouter sans réseau.</p>
          </Ligne>
          <Ligne titre="Téléphone relié">
            <p>Relié à l’application du Mac{etat?.prenom ? (/^[aeiouyhàâéèêëîïôûü]/i.test(etat.prenom) ? ` d’${etat.prenom}` : ` de ${etat.prenom}`) : ''}.{maj ? ` Dernière mise à jour à ${maj}.` : ''}</p>
            {confirmer ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-5">
                <span className="font-semibold text-encre">Délier ce téléphone ?</span>
                <button onClick={onDelier} className="min-h-11 font-semibold text-erreur underline underline-offset-4">Délier</button>
                <button onClick={() => setConfirmer(false)} className="min-h-11 font-semibold text-ardoise underline underline-offset-4">Annuler</button>
              </div>
            ) : (
              <button onClick={() => setConfirmer(true)} className="mt-3 min-h-11 rounded-full bg-erreur-fond px-5 font-semibold text-erreur">Délier ce téléphone</button>
            )}
          </Ligne>
        </div>
      </div>
    </motion.div>
  )
}

/* ==================================================================== une carte : l'en-tête, puis on descend */

/** Une carte : mémoïsée, elle ne se redessine que si son rendez-vous, l'heure ou sa place (dessus / voisine) changent. */
const ContenuCarte = memo(function ContenuCarte({ r, actif, maintenant, onVoiture, onEnvoye, onPreparer, controle }: { r: Rdv; actif: boolean; maintenant: number; onVoiture: (r: Rdv) => void; onEnvoye: () => void; onPreparer: (r: Rdv) => void; controle: React.MutableRefObject<ControleCalendrier | null> }) {
  const { ref, y } = useDefilement()
  // tout en haut de la carte, tirer vers le bas ouvre la semaine (le geste suit le doigt)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let x0 = 0, y0: number | null = null, tire = false, prec = { y: 0, t: 0 }, vitesse = 0
    const debut = (e: TouchEvent) => { if (el.scrollTop > 0) { y0 = null; return } x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; tire = false; prec = { y: y0, t: e.timeStamp } }
    const bouge = (e: TouchEvent) => {
      if (y0 === null) return
      const t = e.touches[0], dy = t.clientY - y0, dx = t.clientX - x0
      // tout en haut, aucun rebond : un geste vers le bas (même en diagonale) appartient à la semaine
      if (dy > 0) e.preventDefault()
      if (!tire) { if (dy > 8 && dy > Math.abs(dx) * 0.6) tire = true; else if (dy < -4 || Math.abs(dx) > dy + 14) { y0 = null; return } else return }
      e.preventDefault()
      if (e.timeStamp > prec.t) vitesse = ((t.clientY - prec.y) / (e.timeStamp - prec.t)) * 1000
      prec = { y: t.clientY, t: e.timeStamp }
      controle.current?.suivre(dy)
    }
    const fin = () => { if (tire) controle.current?.relacher(vitesse); y0 = null; tire = false; vitesse = 0 }
    el.addEventListener('touchstart', debut, { passive: true })
    el.addEventListener('touchmove', bouge, { passive: false })
    el.addEventListener('touchend', fin)
    el.addEventListener('touchcancel', fin)
    return () => { el.removeEventListener('touchstart', debut); el.removeEventListener('touchmove', bouge); el.removeEventListener('touchend', fin); el.removeEventListener('touchcancel', fin) }
  }, [ref, controle])
  const [lire, setLire] = useState(false)
  const passe = estPasse(r, maintenant)
  const crm = r.source !== 'agenda' // fiche possible : CRM ou prospect
  const agenda = !crm
  return (
    <>
      {/* le cadre ne bouge que verticalement : aucun débordement latéral, même en glissant de côté */}
      <div ref={ref} data-carte-defile className={cn('h-full touch-pan-y overflow-x-hidden overflow-y-auto overscroll-none bg-white [scrollbar-width:none]', r.source === 'prospect' && 'theme-prospect')}>
        <div className="flex min-h-full flex-col">
          <EnTeteCarte r={r} maintenant={maintenant} defilement={y} />
          {/* l'action n° 1 : écouter la fiche, visible sans défiler (au-dessus du plan) */}
          {crm && r.fiche_audio && (
            <div className="space-y-2 px-4 pt-5">
              <Lecteur src={api.fichier(`fiches/${r.id}.m4a`)} actif={actif} />
              <button onClick={() => onVoiture(r)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-voile font-semibold text-encre ring-1 ring-encre/[0.06]"><Car size={17} className="text-violet" /> Mode voiture</button>
            </div>
          )}
          {agenda && (
            <div className="px-6 pt-5"><p className="rounded-2xl bg-voile p-4 text-sm text-violet"><b className="font-semibold">Ajouté à votre agenda{r.nouveau ? ' (nouveau)' : ''}.</b> Ce rendez-vous est absent de votre CRM, pas de fiche possible.</p></div>
          )}
          {r.source === 'prospect' && r.prospect && (
            <div className="px-6 pt-5"><p className="rounded-2xl bg-voile p-4 text-sm text-encre"><b className="font-semibold">Prospect.</b>{r.prospect.decouverte ? ` Informations obtenues : ${r.prospect.decouverte.obtenus} sur ${r.prospect.decouverte.total}.` : ''}</p></div>
          )}
          {(crm || r.adresse || r.geo) && <div className="px-6 pt-5"><Plan adresse={r.adresse ?? null} geo={r.geo} visio={r.visio} entreprise={r.entreprise} /></div>}
          {crm && (
            <div className="mt-auto flex justify-center px-6 pt-4 pb-3">
              <button onClick={() => ref.current?.querySelector('[data-actions]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} aria-label="Descendre vers la fiche et le compte rendu"
                className="grid size-11 place-items-center rounded-full text-brume"><ChevronDown size={22} /></button>
            </div>
          )}
        </div>
        {crm && <Actions r={r} passe={passe} onLire={() => setLire(true)} onEnvoye={onEnvoye} onPreparer={() => onPreparer(r)} />}
      </div>
      {createPortal(<AnimatePresence>{lire && <FicheEcran r={r} onFermer={() => setLire(false)} />}</AnimatePresence>, document.body)}
    </>
  )
})

/** Sous la carte, directement : la fiche à écouter, la fiche à lire, le compte rendu. Pas de volet à déplier. */
function Actions({ r, onLire, onEnvoye, onPreparer }: { r: Rdv; passe: boolean; onLire: () => void; onEnvoye: () => void; onPreparer: () => void }) {
  const cr = r.compte_rendu
  const prete = r.fiche_prete
  const enPrepa = !!r.en_preparation && !prete
  return (
    <div data-actions className="space-y-3 px-4 pt-4 pb-[max(env(safe-area-inset-bottom),28px)]">
      {r.fiche_audio ? null : !prete ? (
        <Tuile icone={Headphones} libelle={enPrepa ? 'Fiche en préparation' : 'Préparer la fiche'} teinte="violet" desactive={enPrepa} info={enPrepa ? <Loader2 size={15} className="animate-spin" /> : undefined}
          onClick={() => { if (!enPrepa) onPreparer() }} />
      ) : null}
      <Tuile icone={FileText} libelle="Lire la fiche" teinte="encre" desactive={!prete} info={prete ? 'Une page' : undefined} onClick={() => { if (prete) onLire() }} />
      {cr && cr.statut !== 'erreur' ? <RubriqueCR r={r} onEnvoye={onEnvoye} /> : <RubriqueNote r={r} onEnvoye={onEnvoye} />}
    </div>
  )
}

const TEINTES = { violet: 'bg-violet text-white', encre: 'bg-encre text-white', ok: 'bg-ok text-white' }

function Tuile({ icone: Icone, libelle, info, teinte, ouvert, desactive, onClick, children }: {
  icone: typeof Mic; libelle: string; info?: React.ReactNode; teinte: keyof typeof TEINTES; ouvert?: boolean; desactive?: boolean; onClick: () => void; children?: React.ReactNode
}) {
  const [coups, setCoups] = useState(0)
  const depliable = !!children
  return (
    <motion.div layout="position" transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
      className={cn('overflow-hidden rounded-[24px] transition-[background-color,box-shadow] duration-300', ouvert ? 'bg-white shadow-[0_18px_40px_-24px_rgba(18,10,41,0.45)] ring-1 ring-violet/25' : 'bg-fond ring-1 ring-encre/[0.05]')}>
      <motion.button type="button" aria-expanded={depliable ? !!ouvert : undefined} onClick={() => { setCoups((c) => c + 1); onClick() }}
        whileTap={{ transform: 'scale(0.97)' }} transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
        className="sans-pression flex min-h-[76px] w-full items-center gap-4 px-4 text-left">
        <motion.span key={coups} className={cn('grid size-12 shrink-0 place-items-center rounded-2xl', desactive ? 'bg-nuage text-ardoise' : TEINTES[teinte])}
          initial={coups ? { transform: 'scale(0.82)' } : false} animate={{ transform: 'scale(1)' }} transition={{ type: 'spring', duration: 0.45, bounce: 0.45 }}>
          <Icone size={21} />
        </motion.span>
        <span className={cn('titre min-w-0 flex-1 text-[19px] leading-tight', desactive ? 'text-ardoise' : 'text-encre')}>{libelle}</span>
        {info && <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', desactive ? 'bg-white text-ardoise' : 'bg-voile text-violet')}>{info}</span>}
        {depliable && !desactive && (
          <motion.span className="grid shrink-0 text-brume" animate={{ transform: ouvert ? 'rotate(180deg)' : 'rotate(0deg)' }} transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}><ChevronDown size={19} /></motion.span>
        )}
      </motion.button>
      <AnimatePresence initial={false}>
        {ouvert && children && (
          <motion.div key="contenu" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0, transition: { duration: 0.2 } }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}>
            <motion.div className="px-4 pb-4" initial={{ transform: 'translateY(6px)' }} animate={{ transform: 'translateY(0px)' }} transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}>
              {children}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function FicheEcran({ r, onFermer }: { r: Rdv; onFermer: () => void }) {
  return (
    <motion.div className="fixed inset-0 z-50 flex flex-col bg-white" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
      <div className="haut-sur flex items-center justify-between border-b border-nuage px-4 pb-2">
        <span className="font-semibold text-encre">Fiche {r.entreprise}</span>
        <button onClick={onFermer} aria-label="Fermer" className="grid size-11 place-items-center rounded-full text-ardoise"><X size={20} /></button>
      </div>
      <iframe title={`Fiche ${r.entreprise}`} src={api.fichier(`fiches/${r.id}.html`)} sandbox="allow-popups" className="w-full flex-1" />
    </motion.div>
  )
}

function Lecteur({ src, actif }: { src: string; actif: boolean }) {
  const ref = useRef<HTMLAudioElement>(null)
  // seule la carte du dessus prépare son audio, et seulement après le premier affichage (hors du démarrage) ;
  // une carte qui quitte le dessus se tait. Un toucher sur « Écouter » lit tout de suite, quoi qu'il arrive.
  useEffect(() => {
    const a = ref.current
    if (!a) return
    if (!actif) { a.pause(); return }
    const t = setTimeout(() => { if (a.readyState === 0 && a.preload === 'none') { a.preload = 'metadata'; a.load() } }, Math.max(300, 3500 - performance.now()))
    return () => clearTimeout(t)
  }, [actif])
  const [lecture, setLecture] = useState(false)
  const [pos, setPos] = useState(0)
  const [duree, setDuree] = useState(0)
  const [horsLigne, setHorsLigne] = useState(false)
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  return (
    <div className="relative">
      <div className="sombre relative flex items-center gap-4 overflow-hidden rounded-[24px] bg-encre p-4 text-white">
        <button onClick={() => (lecture ? ref.current?.pause() : ref.current?.play().catch(() => setHorsLigne(true)))} aria-label={lecture ? 'Pause' : 'Écouter'}
          className="grid size-16 shrink-0 place-items-center rounded-full bg-violet shadow-[0_0_0_6px_color-mix(in_oklab,var(--color-violet-vif)_25%,transparent)] active:scale-95">
          {lecture ? <Pause size={26} /> : <Play size={26} className="ml-1" />}
        </button>
        <div className="min-w-0 flex-1">
          <div role="progressbar" aria-label="Avancement de la fiche audio" aria-valuemin={0} aria-valuemax={100} aria-valuenow={duree ? Math.round((pos / duree) * 100) : 0} className="mt-2 h-1.5 rounded-full bg-white/[0.42]"><div className="h-full rounded-full bg-gradient-to-r from-lavande to-white" style={{ width: duree ? `${(pos / duree) * 100}%` : '0%' }} /></div>
          <div className="mt-1.5 text-xs text-lilas tabular-nums">{fmt(pos)} / {duree ? fmt(duree) : '-:--'}</div>
          <div aria-live="polite">
            {horsLigne && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#FFB4B4]"><WifiOff size={14} /> Pas de connexion pour l’instant.
                <button onClick={() => { setHorsLigne(false); ref.current?.load() }} className="min-h-11 rounded-full bg-white px-4 font-semibold text-encre">Réessayer</button>
              </p>
            )}
          </div>
        </div>
        <audio ref={ref} src={src} preload="none" onError={() => setHorsLigne(true)} onCanPlay={() => setHorsLigne(false)}
          onPlay={(e) => { setLecture(true); const moi = e.currentTarget; document.querySelectorAll('audio').forEach((a) => { if (a !== moi) a.pause() }) }} onPause={() => setLecture(false)} onEnded={() => setLecture(false)}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDuree(e.currentTarget.duration)} />
      </div>
    </div>
  )
}

/* ==================================================================== compte rendu : dicter, suivre, valider */

const ETAPES_CR: [CompteRendu['statut'], string][] = [
  ['note_recue', 'Note reçue sur votre Mac'],
  ['transcription', 'Je transcris votre note'],
  ['redaction', 'Je rédige le compte rendu avec votre CRM'],
]

function RubriqueNote({ r, onEnvoye }: { r: Rdv; onEnvoye: () => void }) {
  const cr = r.compte_rendu
  const [envoiLocal, setEnvoiLocal] = useState(false)
  if ((cr && cr.statut !== 'erreur') || envoiLocal) {
    return (
      <p className="flex items-center gap-2.5 rounded-2xl bg-ok-fond p-4 text-sm text-ok">
        <Check size={18} strokeWidth={3} className="shrink-0" />
        <span><b className="font-semibold">Note envoyée.</b> {cr?.statut === 'valide' ? 'Le compte rendu est enregistré.' : 'Le compte rendu se prépare juste en dessous.'}</span>
      </p>
    )
  }
  return (
    <div>
      {cr?.statut === 'erreur' && <p role="alert" className="mb-3 rounded-2xl bg-alerte-fond p-3 text-sm text-alerte">{cr.message ?? 'Le compte rendu n’a pas pu être préparé.'} Vous pouvez redicter votre note.</p>}
      <Enregistreur rdv={r.id} entreprise={r.entreprise} onEnvoye={() => { setEnvoiLocal(true); onEnvoye() }} />
    </div>
  )
}

function RubriqueCR({ r, onEnvoye }: { r: Rdv; onEnvoye: () => void }) {
  const cr = r.compte_rendu
  if (cr?.statut === 'valide') {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-ok-fond p-4 text-ok">
        <motion.span initial={{ transform: 'scale(0.6)' }} animate={{ transform: 'scale(1)' }} transition={{ type: 'spring', bounce: 0.4, duration: 0.5 }} className="grid size-10 shrink-0 place-items-center rounded-full bg-ok text-white"><Check size={20} strokeWidth={3} /></motion.span>
        <span className="text-sm"><b className="font-semibold">Enregistré dans le CRM{!Number.isNaN(new Date(cr.maj).getTime()) ? ` à ${heure(new Date(cr.maj))}` : ''}</b><br />{cr.synthese}</span>
      </div>
    )
  }
  if (cr?.statut === 'a_valider' || cr?.statut === 'enregistrement') return <Validation r={r} cr={cr} onEnvoye={onEnvoye} />
  if (cr && cr.statut !== 'erreur') {
    const idx = ETAPES_CR.findIndex(([s]) => s === cr.statut)
    return (
      <div role="status" aria-live="polite" className={cn('relative overflow-hidden rounded-2xl p-4', VERRE)}>
        <BorderTrail size={70} className="bg-gradient-to-l from-violet via-violet-vif to-transparent" />
        <ol className="space-y-3">
          {ETAPES_CR.map(([s, l], i) => (
            <li key={s} className="flex items-center gap-3 text-sm">
              <span className={cn('grid size-7 place-items-center rounded-full', i < idx ? 'bg-ok text-white' : i === idx || (idx < 0 && i === 0) ? 'bg-voile text-violet' : 'bg-nuage text-ardoise')}>
                {i < idx ? <Check size={14} strokeWidth={3} /> : i === idx || (idx < 0 && i === 0) ? <Loader2 size={14} className="animate-spin" /> : <span className="size-1.5 rounded-full bg-ardoise" />}
              </span>
              {i === idx || (idx < 0 && i === 0) ? <TextShimmer className={cn('font-semibold', SHIMMER)}>{l}</TextShimmer> : <span className={i < idx ? 'text-encre' : 'text-ardoise'}>{l}</span>}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-ardoise">Vous pouvez fermer l’appli : une notification vous préviendra.</p>
      </div>
    )
  }
  return <p className="rounded-2xl border-2 border-dashed border-nuage p-4 text-sm text-ardoise">Dès que votre note vocale est envoyée, le compte rendu apparaît ici. Rien n’entre dans le CRM sans votre validation.</p>
}

function Enregistreur({ rdv, entreprise, onEnvoye }: { rdv: string; entreprise: string; onEnvoye: () => void }) {
  const [phase, setPhase] = useState<'pret' | 'enreg' | 'fini' | 'envoi'>('pret')
  const [duree, setDuree] = useState(0)
  const barres = useRef<(HTMLSpanElement | null)[]>([])
  const [audio, setAudio] = useState<Blob | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirmer, setConfirmer] = useState(false)
  const rec = useRef<MediaRecorder | null>(null)
  const flux = useRef<MediaStream | null>(null)
  const anim = useRef(0)
  const idem = useRef<string>('')
  const verrou = useRef<{ release: () => Promise<void> } | null>(null)
  const [interrompu, setInterrompu] = useState<string | null>(null)

  useEffect(() => () => { cancelAnimationFrame(anim.current); flux.current?.getTracks().forEach((t) => t.stop()); verrou.current?.release().catch(() => {}); marquerDictee(null) }, [])
  useEffect(() => {
    if (!audio) { setUrl(null); return }
    const u = URL.createObjectURL(audio)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [audio])

  // une note commencée puis interrompue (appli fermée, appel reçu...) est reprise telle quelle
  useEffect(() => {
    let vivant = true
    notesEnAttente().then(async (liste) => {
      const n = liste.find((x) => x.rdv === rdv)
      const b = n && await reconstituerNote(n)
      if (vivant && b && n) { idem.current = n.idem; setAudio(b); setPhase('fini') }
    })
    return () => { vivant = false }
  }, [rdv])

  const demarrer = async () => {
    setErr(null); setInterrompu(null)
    try {
      // première dictée : on demande au téléphone de ne pas purger nos notes quand il manque de place
      navigator.storage?.persist?.().catch(() => {})
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      flux.current = s
      const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
      const m = new MediaRecorder(s, type ? { mimeType: type } : undefined)
      const mime = m.mimeType || type || 'audio/mp4'
      const morceaux: Blob[] = []
      idem.current = nouvelIdem()
      marquerDictee(rdv)
      await commencerNote({ rdv, entreprise, type: mime, debut: Date.now(), idem: idem.current }).catch(() => {})
      // l'écran reste allumé pendant la dictée ; si le micro est coupé (écran verrouillé, appel), on prévient
      try { verrou.current = await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null } catch { /* refusé */ }
      const piste = s.getAudioTracks()[0]
      const prevenir = () => setInterrompu('L’enregistrement a été interrompu (écran verrouillé ou appel). Ce qui a été dicté est gardé : réécoutez votre note avant de l’envoyer.')
      if (piste) { piste.onmute = prevenir; piste.onended = () => { prevenir(); if (m.state !== 'inactive') m.stop() } }
      m.onerror = () => { prevenir(); if (m.state !== 'inactive') m.stop() }
      // chaque seconde enregistrée est aussi gardée dans la mémoire du téléphone
      m.ondataavailable = (e) => { if (e.data.size) { morceaux.push(e.data); ajouterMorceau(rdv, e.data).catch(() => {}) } }
      m.onstop = () => {
        cancelAnimationFrame(anim.current)
        s.getTracks().forEach((t) => t.stop())
        marquerDictee(null)
        verrou.current?.release().catch(() => {}); verrou.current = null
        setAudio(new Blob(morceaux, { type: mime }))
        setPhase((p) => (p === 'enreg' ? 'fini' : p))
      }
      m.start(1000)
      rec.current = m
      // niveaux sonores pour l'animation
      const ctx = new AudioContext()
      const an = ctx.createAnalyser()
      an.fftSize = 64
      ctx.createMediaStreamSource(s).connect(an)
      const buf = new Uint8Array(an.frequencyBinCount)
      const debut = Date.now()
      const boucle = () => {
        an.getByteFrequencyData(buf)
        for (let i = 0; i < 28; i++) {
          const b = barres.current[i]
          if (b) b.style.transform = `scaleY(${Math.max(0.08, (buf[Math.floor((i / 28) * buf.length)] ?? 0) / 255)})`
        }
        const sec = Math.floor((Date.now() - debut) / 1000)
        setDuree((d) => (d === sec ? d : sec))
        anim.current = requestAnimationFrame(boucle)
      }
      boucle()
      setPhase('enreg')
    } catch {
      marquerDictee(null)
      setErr('Je n’ai pas accès au micro. Autorisez-le dans les réglages de l’iPhone, puis réessayez.')
    }
  }
  const arreter = () => { cancelAnimationFrame(anim.current); if (rec.current?.state !== 'inactive') rec.current?.stop() }
  const envoyer = async () => {
    if (!audio) return
    setPhase('envoi'); setErr(null)
    try {
      await envoyerNote({ rdv, entreprise, type: audio.type, debut: Date.now(), idem: idem.current || (idem.current = nouvelIdem()) }, audio, duree)
      await supprimerNote(rdv).catch(() => {}); onEnvoye()
    } catch { setErr('L’envoi n’est pas passé. Votre note est gardée sur ce téléphone et repartira toute seule dès que le réseau revient.'); setPhase('fini'); onEnvoye() }
  }
  const effacer = () => { idem.current = ''; supprimerNote(rdv).catch(() => {}); setAudio(null); setDuree(0); setErr(null); setConfirmer(false); setPhase('pret') }
  const mmss = `${Math.floor(duree / 60)}:${String(duree % 60).padStart(2, '0')}`

  return (
    <div className={cn('rounded-[24px] p-5 text-center', VERRE)}>
      {phase === 'pret' && (
        <>
          <button onClick={demarrer} aria-label="Dicter mon compte rendu" className="relative mx-auto grid size-24 place-items-center rounded-full bg-violet text-white shadow-[0_16px_40px_-12px_var(--color-violet)] active:scale-95">
            <span className="absolute inset-0 animate-ping rounded-full bg-violet/30" />
            <Mic size={36} className="relative" />
          </button>
          <p className="mt-4 font-semibold text-encre">Dicter mon compte rendu</p>
        </>
      )}
      {phase === 'enreg' && (
        <>
          <div aria-hidden className="flex h-20 items-center justify-center gap-1">
            {Array.from({ length: 28 }, (_, i) => <span key={i} ref={(el) => { barres.current[i] = el }} className="h-full w-1.5 origin-center rounded-full bg-violet" style={{ transform: 'scaleY(0.08)' }} />)}
          </div>
          <p className="mt-2 text-2xl font-semibold text-encre tabular-nums" role="timer" aria-label="Durée de la note">{mmss}</p>
          <p className="mt-1 text-xs text-ardoise">Gardez l’écran allumé pendant la dictée.</p>
          {interrompu && <p role="alert" className="mt-3 rounded-xl bg-alerte-fond p-3 text-sm text-alerte">{interrompu}</p>}
          <button onClick={arreter} className="mx-auto mt-4 flex min-h-12 items-center gap-2 rounded-full bg-encre px-6 font-semibold text-white active:scale-95"><Square size={16} fill="currentColor" /> Terminer</button>
        </>
      )}
      {(phase === 'fini' || phase === 'envoi') && audio && (
        <>
          <p className="font-semibold text-encre">{duree ? `Note de ${mmss}` : 'Votre note'}</p>
          {interrompu && <p role="alert" className="mt-3 rounded-xl bg-alerte-fond p-3 text-sm text-alerte">{interrompu}</p>}
          {url && <audio src={url} controls className="mt-3 w-full" />}
          <button onClick={envoyer} disabled={phase === 'envoi'} className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-violet text-base font-semibold text-white shadow-[0_16px_40px_-14px_var(--color-violet)] active:scale-[0.98] disabled:opacity-70">
            {phase === 'envoi' ? <><Loader2 size={17} className="animate-spin" /> J’envoie votre note...</> : <><Send size={17} /> {err ? 'Réessayer l’envoi' : 'Envoyer'}</>}
          </button>
          {phase === 'fini' && (
            confirmer ? (
              <div role="group" aria-label="Effacer cette note ?" className="mt-4 flex flex-wrap items-center justify-center gap-x-5 text-sm">
                <span className="font-semibold text-encre">Effacer cette note ?</span>
                <button onClick={effacer} className="min-h-11 font-semibold text-erreur underline underline-offset-4">Effacer</button>
                <button onClick={() => setConfirmer(false)} className="min-h-11 font-semibold text-ardoise underline underline-offset-4">Garder</button>
              </div>
            ) : (
              <button onClick={() => setConfirmer(true)} className="mt-3 inline-flex min-h-11 items-center gap-1.5 px-3 text-sm text-ardoise underline underline-offset-4"><RotateCcw size={14} /> Recommencer</button>
            )
          )}
        </>
      )}
      <div aria-live="polite">{err && <p role="alert" className="mt-3 text-sm text-alerte">{err}</p>}</div>
    </div>
  )
}

function Markdown({ texte }: { texte: string }) {
  const gras = (t: string) => t.split(/(\*\*[^*]+\*\*)/).map((m, i) => m.startsWith('**') ? <b key={i} className="font-semibold text-encre">{m.slice(2, -2)}</b> : m)
  return (
    <div className="space-y-2 text-[15px] leading-relaxed text-texte">
      {texte.split('\n').map((l, i) => {
        if (/^#{1,3} /.test(l)) return <h4 key={i} className="pt-2 font-semibold text-encre">{l.replace(/^#+ /, '')}</h4>
        if (/^[-*] /.test(l)) return <p key={i} className="flex gap-2"><span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-violet" /><span>{gras(l.slice(2))}</span></p>
        return l.trim() ? <p key={i}>{gras(l)}</p> : null
      })}
    </div>
  )
}

/** Le compte rendu écrit en Markdown devient du texte simple : plus de # ni de **, un paragraphe par ligne. */
const enTexteSimple = (md: string) => md.split('\n')
  .map((l) => l.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*[-*]\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|\s)\*(\S.*?)\*/g, '$1$2').replace(/`/g, '').trim())
  .filter(Boolean).join('\n\n')
const heure = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

function Validation({ r, cr, onEnvoye }: { r: Rdv; cr: CompteRendu; onEnvoye: () => void }) {
  const [edition, setEdition] = useState(false)
  const [texte, setTexte] = useState(() => enTexteSimple(cr.texte ?? ''))
  const [modifie, setModifie] = useState(false)
  const [envoi, setEnvoi] = useState(cr.statut === 'enregistrement')
  const [echec, setEchec] = useState(false)
  const [fait, setFait] = useState<string | null>(null)
  const m = cr.maj_crm ?? {}
  const valider = async () => {
    setEnvoi(true); setEchec(false)
    try {
      await api.valider({ rdv: r.id, id: cr.id, texte: modifie ? texte : undefined, maj: m })
      setFait(heure(new Date()))
      onEnvoye()
    } catch { setEnvoi(false); setEchec(true) }
  }
  const lignes: [string, string][] = []
  if (m.resultat) lignes.push(['Résultat', m.resultat])
  if (m.prochaine_action) lignes.push(['Prochaine action', m.prochaine_action])
  if (m.echeance) lignes.push(['À faire avant le', new Date(m.echeance).toLocaleDateString('fr-FR')])
  if (m.phase) lignes.push(['Étape de l’affaire', m.phase])
  return (
    <div className="space-y-3">
      <div className={cn('rounded-[22px] p-4', VERRE)}>
        <div className="mb-3 flex items-center justify-between">
          <span />
          <button onClick={() => setEdition(!edition)} disabled={envoi} className="min-h-11 px-2 text-sm font-semibold text-violet">{edition ? 'Terminer la correction' : 'Corriger'}</button>
        </div>
        {edition ? (
          <>
            <label htmlFor="cr-texte" className="mb-1.5 block text-sm font-semibold text-encre">Votre compte rendu</label>
            <textarea id="cr-texte" value={texte} onChange={(e) => { setTexte(e.target.value); setModifie(true) }} rows={14}
              className="w-full rounded-xl border border-ardoise/50 bg-white p-3 text-base leading-relaxed" />
          </>
        ) : modifie ? (
          <div className="space-y-3 text-[15px] leading-relaxed whitespace-pre-line text-texte">{texte.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}</div>
        ) : <Markdown texte={cr.texte ?? ''} />}
      </div>
      {lignes.length > 0 && (
        <div className={cn('rounded-[22px] p-4 text-sm', VERRE)}>
          <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-ardoise uppercase">Ce qui sera mis à jour dans le CRM</p>
          <dl className="space-y-2">
            {lignes.map(([k, v]) => <div key={k}><dt className="text-xs text-ardoise">{k}</dt><dd className="font-semibold text-encre">{v}</dd></div>)}
          </dl>
        </div>
      )}
      <div aria-live="polite">
        {echec && (
          <div role="alert" className="mb-3 rounded-2xl bg-erreur-fond p-3 text-sm text-erreur">
            L’enregistrement n’a pas abouti. Vérifiez la connexion : votre compte rendu est conservé.
          </div>
        )}
        {fait && <p className="mb-3 flex items-center gap-2 rounded-2xl bg-ok-fond p-3 text-sm font-semibold text-ok"><Check size={16} /> Enregistré dans le CRM à {fait}</p>}
      </div>
      {!fait && <button onClick={valider} disabled={envoi} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-violet font-semibold text-white shadow-[0_16px_40px_-14px_var(--color-violet)] active:scale-[0.98] disabled:opacity-70">
        {envoi ? <><Loader2 size={17} className="animate-spin" /> J’enregistre dans le CRM...</> : echec ? <><RotateCcw size={17} /> Réessayer</> : <><Check size={17} /> Valider et enregistrer dans le CRM</>}
      </button>}
    </div>
  )
}

/* ==================================================================== appairage */

function Appairage({ onRelie }: { onRelie: () => void }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const bouton = useRef<HTMLButtonElement>(null)
  const installee = autonome()
  const iphone = /iPhone|iPad/.test(navigator.userAgent)
  // lien du QR code (#code=...) : on tente directement
  useEffect(() => {
    const c = new URLSearchParams(location.hash.slice(1)).get('code')
    if (c && /^(\d{6}|[A-Za-z2-9]{8})$/.test(c)) { setCode(c.toUpperCase()); history.replaceState(null, '', location.pathname) }
  }, [])
  const valider = async (c: string) => {
    setEnvoi(true); setErr(null)
    const e = await appairer(c)
    setEnvoi(false)
    if (e) { setErr(e); setCode('') } else onRelie()
  }
  useEffect(() => { if ((code.length === 6 && /^\d+$/.test(code) || code.length === 8) && !envoi && (installee || !iphone)) valider(code) }, [code]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="haut-sur bas-sur sombre flex h-dvh flex-col justify-start overflow-y-auto bg-encre px-7 pt-8 text-white">
      <div aria-hidden className="pointer-events-none fixed -top-40 -right-36 size-[28rem] rounded-full bg-[radial-gradient(circle,rgba(87,35,243,0.45)_0%,transparent_65%)]" />
      <img src="/logo-blanc.svg" alt="Préparateur" className="relative h-6 w-fit" />
      <h1 className="relative mt-8 text-4xl font-semibold tracking-tight">Préparateur de visite</h1>
      {iphone && !installee ? (
        <div className="relative mt-5 space-y-4 text-lilas">
          <p className="text-lg text-white">Première étape : installez l’appli.</p>
          <p>Touchez <Share size={16} className="inline -translate-y-0.5" /> <b className="text-white">Partager</b> en bas de Safari, puis <b className="text-white">Sur l’écran d’accueil</b>, puis <b className="text-white">Ajouter</b>.</p>
          <p>Ouvrez ensuite l’appli depuis son icône : elle vous demandera le code affiché sur votre Mac.</p>
        </div>
      ) : (
        <div className="relative mt-5">
          <p className="text-lilas">Tapez le code affiché sur votre Mac (votre prénom en haut à droite, puis « Appli mobile »).</p>
          <label htmlFor="code-appairage" className="sr-only">Code affiché sur votre Mac</label>
          <input id="code-appairage" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} inputMode="text" autoCapitalize="characters" autoComplete="one-time-code" autoFocus
            onFocus={() => setTimeout(() => bouton.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 350)}
            placeholder="Code" className="mt-5 w-full rounded-2xl bg-white/[0.08] px-4 py-4 text-center text-4xl font-semibold tracking-[0.4em] text-white ring-1 ring-white/30 placeholder:text-white/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lavande" />
          <button ref={bouton} onClick={() => valider(code)} disabled={(code.length !== 6 && code.length !== 8) || envoi}
            className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-white font-semibold text-encre disabled:opacity-40">
            {envoi ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />} Relier ce téléphone
          </button>
          <div aria-live="polite">{err && <p role="alert" className="mt-3 text-center text-sm text-[#FF9A9A]">{err}</p>}</div>
        </div>
      )}
    </div>
  )
}
