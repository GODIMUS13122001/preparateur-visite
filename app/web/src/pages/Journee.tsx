import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  AlertTriangle, ArrowRight, CalendarCheck, CalendarPlus, CalendarRange, Car, SearchX, Check, ChevronLeft, ChevronRight, Clock, FileSpreadsheet,
  Headphones, Loader2, MapPin, Minus, Pause, Play, Printer, RefreshCw, RotateCcw, RotateCw, Send, Sparkles, Upload, Video, X,
} from 'lucide-react'
import { compte, type Avancement, type InfoCRM, type Jour, type Journee, type Preparation, type RendezVous } from '../api'
import { AnimatedBackground } from '@/components/motion-primitives/animated-background'
import { AnimatedGroup } from '@/components/motion-primitives/animated-group'
import { BorderTrail } from '@/components/motion-primitives/border-trail'
import { GlowEffect } from '@/components/motion-primitives/glow-effect'
import { InView } from '@/components/motion-primitives/in-view'
import { Magnetic } from '@/components/motion-primitives/magnetic'
import { SlidingNumber } from '@/components/motion-primitives/sliding-number'
import { Spotlight } from '@/components/motion-primitives/spotlight'
import { TextEffect } from '@/components/motion-primitives/text-effect'
import { TextShimmer } from '@/components/motion-primitives/text-shimmer'
import { TransitionPanel } from '@/components/motion-primitives/transition-panel'
import { useApi, useCouleursAccent, useMode, useSignal } from '../mode'
import { cn } from '@/lib/utils'
import { lisible } from '@/lib/enClair'

const SHIMMER = '[--base-color:var(--color-ardoise)] [--base-gradient-color:var(--color-violet)]'
const SHIMMER_SOMBRE = '[--base-color:var(--color-lavande)] [--base-gradient-color:#FFFFFF]'

/** Rend les éléments flottants directement dans <body> : aucune animation d'un parent ne peut les décaler. */
export function Portail({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body)
}

export default function Journee({ crm, onCrm, versCompte, versCoulisses, cible, onCibleLue, versAgenda }: {
  crm: InfoCRM | null; onCrm: (c: InfoCRM) => void; versCompte: () => void; versCoulisses: (rid: string) => void
  /** Ouverture depuis l'agenda : ce jour, avec ce rendez-vous sélectionné (facultatif). */
  cible?: { jour: string; rid: string } | null; onCibleLue?: () => void
  versAgenda?: (jour: string | null) => void
}) {
  const [journee, setJournee] = useState<Journee | null>(null)
  const [jours, setJours] = useState<Jour[]>([])
  const jourRef = useRef<string | null>(cible?.jour ?? null)
  const [jour, setJour] = useState<string | null>(cible?.jour ?? null)
  const [selection, setSelection] = useState<string | null>(cible?.rid ?? null)
  // le rendez-vous visé reste attendu tant qu'il n'est pas arrivé (ceux de l'agenda Google arrivent au second chargement)
  const ridCible = useRef<string | null>(cible?.rid ?? null)
  useEffect(() => {
    if (!cible) return
    onCibleLue?.()
    // rendez-vous introuvable (supprimé entre-temps) : au bout de 5 s, on reprend le choix habituel
    const t = setTimeout(() => { if (ridCible.current) { ridCible.current = null; setSelection(null) } }, 5000)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [preps, setPreps] = useState<Record<string, Preparation>>({})
  const [depotOuvert, setDepotOuvert] = useState(false)
  const [demoOuvert, setDemoOuvert] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const suivis = useRef<Record<string, () => void>>({})
  const mode = useMode()
  const { api } = useApi()
  const signal = useSignal() // les requêtes en cours sont abandonnées quand on quitte la page ou qu'on change de mode

  // les suivis en direct sont fermés au démontage
  useEffect(() => () => { Object.values(suivis.current).forEach((fermer) => fermer()); suivis.current = {} }, [])

  const charger = useCallback(async (avecAgenda = true) => {
    const sig = signal()
    try {
      const demande = jourRef.current
      const j = await api.journee(demande, avecAgenda, sig)
      if (sig.aborted || demande !== jourRef.current) return
      setJournee((ancien) =>
        avecAgenda || !ancien || ancien.jour !== j.jour
          ? j
          : { ...j, rendez_vous: j.rendez_vous.map((r) => ({ ...r, dans_agenda: ancien.rendez_vous.find((x) => x.id === r.id)?.dans_agenda ?? r.dans_agenda })) },
      )
      setErreur(null)
      j.rendez_vous.forEach((r) => r.preparation?.statut === 'en_cours' && suivre(r.id))
    } catch (e) {
      if (!sig.aborted) setErreur((e as Error).message)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, signal])

  const suivre = useCallback((id: string) => {
    if (suivis.current[id]) return
    suivis.current[id] = api.flux(id, (p) => {
      setPreps((s) => ({ ...s, [id]: p }))
      if (p.statut !== 'en_cours') {
        delete suivis.current[id]
        charger(false)
        if (p.statut === 'termine') setToast('Votre fiche est prête.')
      }
    })
  }, [charger])

  useEffect(() => {
    const lireJours = () => api.jours(signal()).then((r) => setJours(r.jours)).catch(() => {})
    charger(false).then(() => charger(true))
    lireJours()
    const t = setInterval(() => { charger(true); lireJours() }, 30000)
    return () => clearInterval(t)
  }, [charger, api, signal])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // le jour affiché reste visible dans le ruban des jours (seulement quand il change : la page ne bouge pas toute seule)
  const rubanJours = useRef<HTMLDivElement>(null)
  const jourVisible = jour ?? journee?.jour ?? null
  useEffect(() => {
    const ruban = rubanJours.current
    const puce = ruban?.querySelector<HTMLElement>(`[data-id="${jourVisible}"]`)
    if (ruban && puce) ruban.scrollTo({ left: puce.offsetLeft - ruban.clientWidth / 2 + puce.clientWidth / 2, behavior: 'smooth' })
  }, [jourVisible, jours.length])

  const changerJour = (d: string) => {
    if (d === (jour ?? journee?.jour)) return
    jourRef.current = d
    ridCible.current = null
    setJour(d)
    setSelection(null)
    charger(false).then(() => charger(true))
  }

  const prospection = mode === 'prospection'
  const rdvs = journee?.rendez_vous ?? []
  const actif = rdvs.find((r) => r.id === selection) ?? null
  const prepActive = actif ? preps[actif.id] ?? actif.preparation : null
  const jourCourant = jour ?? journee?.jour ?? null
  const indexJour = jours.findIndex((x) => x.jour === jourCourant)
  const prets = rdvs.filter((r) => r.fiche.prete).length
  const rdvsCrm = rdvs.filter((r) => r.source === 'crm').length
  const prochain = useMemo(() => {
    const maintenant = journee ? new Date(journee.horloge) : new Date()
    return rdvs.find((r) => new Date(r.debut) > maintenant) ?? null
  }, [rdvs, journee])
  // au chargement (et à chaque changement de jour), le prochain rendez-vous est choisi d'office : le panneau de droite n'est jamais vide
  useEffect(() => {
    if (ridCible.current) {
      if (rdvs.some((r) => r.id === ridCible.current)) { setSelection(ridCible.current); ridCible.current = null; return }
      return
    }
    // aussi quand la sélection appartient au jour précédent (les rendez-vous du nouveau jour arrivent après le changement)
    if (rdvs.length > 0 && (selection === null || !rdvs.some((r) => r.id === selection))) setSelection((prochain ?? rdvs[0]).id)
  }, [rdvs, prochain, selection])
  const aujourdhui = journee?.horloge.slice(0, 10) ?? null
  const estAujourdhui = !!jourCourant && jourCourant === aujourdhui
  const jourSuivant = jours.find((x) => jourCourant && x.jour > jourCourant && x.rendez_vous > 0) ?? null
  const resume = !journee ? ''
    : rdvs.length === 0 ? (estAujourdhui ? 'Aucun rendez-vous aujourd’hui.' : 'Aucun rendez-vous ce jour-là.')
    : prochain ? `Prochain : ${prochain.entreprise} à ${prochain.heure}${prochain.source === 'agenda' ? ', absent du CRM' : prochain.fiche.prete ? ', fiche prête' : ', fiche pas encore préparée'}.`
    : estAujourdhui ? 'Journée terminée : pensez à dicter vos comptes rendus.' : `${rdvs.length} rendez-vous ce jour-là.`

  const preparer = async (r: RendezVous) => {
    setSelection(r.id)
    try {
      const p = await api.preparer(r.id)
      setPreps((s) => ({ ...s, [r.id]: p }))
      suivre(r.id)
    } catch (e) {
      setToast((e as Error).message)
    }
  }

  const panneau = actif?.source === 'agenda' ? 3 : !actif ? 0 : prepActive?.statut === 'en_cours' || prepActive?.statut === 'echec' ? 1 : actif.fiche.prete ? 2 : 0

  return (
    <div className="min-h-full">
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-28 sm:px-6">
        {/* ------------------------------------------------------------ bandeau d'accueil */}
        <section className="relative overflow-hidden rounded-[28px] bg-encre px-6 pt-8 pb-6 text-white sm:px-10 sm:pt-10">
          <Spotlight size={420} className="from-deco/40 via-deco/15 to-transparent blur-none" />
          <div aria-hidden className="halo pointer-events-none absolute -top-48 -right-40 size-[34rem] [--halo:color-mix(in_srgb,var(--color-deco)_40%,transparent)]" />
          <div aria-hidden className="halo pointer-events-none absolute -bottom-56 left-[28%] size-[30rem] [--halo:color-mix(in_srgb,var(--color-violet-profond)_60%,transparent)]" />

          <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-[0.18em] text-lavande uppercase">{journee?.jour_long ?? 'Votre journée'}</p>
              {journee ? (
                <TextEffect key={journee.prenom} as="h1" preset="fade" per="word" className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
                  {`Bonjour${journee.prenom ? ' ' + journee.prenom : ''},`}
                </TextEffect>
              ) : (
                <div className="mt-2 h-12">{erreur ? <p className="text-lilas">{erreur}</p> : <TextShimmer className={cn('text-2xl', SHIMMER_SOMBRE)}>Je consulte votre CRM...</TextShimmer>}</div>
              )}
              <AnimatePresence mode="wait" initial={false}>
                <motion.p key={resume} className="mt-3 text-base text-lilas sm:text-lg"
                  initial={{ opacity: 0, transform: 'translateY(4px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}>
                  {resume}
                </motion.p>
              </AnimatePresence>
            </div>

            <div className="grid min-w-0 grid-cols-2 gap-2 sm:min-w-[300px] sm:gap-3">
              <Chiffre libelle="rendez-vous" valeur={rdvs.length} />
              <Chiffre libelle={`fiche${prets > 1 ? 's' : ''} prête${prets > 1 ? 's' : ''}`} valeur={prets} total={rdvsCrm} />
            </div>
          </div>

          {jours.length > 1 && (
            <nav aria-label="Choisir un jour" className="relative mt-8 flex items-center gap-2">
              <BoutonRond sombre label="Jour précédent" disabled={indexJour <= 0} onClick={() => changerJour(jours[indexJour - 1].jour)}><ChevronLeft size={17} /></BoutonRond>
              <div ref={rubanJours} className="ruban-fondu flex gap-1 overflow-x-auto rounded-full bg-white/[0.06] p-1 ring-1 ring-white/10 [scrollbar-width:none]">
                <AnimatedBackground defaultValue={jourCourant ?? undefined} onValueChange={(v) => v && changerJour(v)}
                  className="rounded-full bg-[#FAF9F6]" transition={{ type: 'spring', bounce: 0.18, duration: 0.35 }}>
                  {jours.map((x) => (
                    <button key={x.jour} data-id={x.jour} type="button" aria-current={x.jour === jourCourant ? 'date' : undefined}
                      className="shrink-0 px-4 py-1.5 text-sm whitespace-nowrap text-lilas transition-colors data-[checked=true]:font-semibold data-[checked=true]:text-[#120A29]">
                      <span className="capitalize">{x.jour === aujourdhui ? 'Aujourd’hui' : x.court}</span>
                      <span className="ml-1.5 text-xs opacity-60">{x.rendez_vous}</span>
                    </button>
                  ))}
                </AnimatedBackground>
              </div>
              <BoutonRond sombre label="Jour suivant" disabled={indexJour < 0 || indexJour >= jours.length - 1} onClick={() => changerJour(jours[indexJour + 1].jour)}><ChevronRight size={17} /></BoutonRond>
              {versAgenda && (
                <button type="button" onClick={() => versAgenda(jourCourant)}
                  className="ml-1 flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] whitespace-nowrap text-lilas transition-colors hover:bg-white/10 hover:text-white">
                  <CalendarRange size={15} /> Voir tout l’agenda
                </button>
              )}
            </nav>
          )}
        </section>

        {/* ------------------------------------------------------------ frise + panneau */}
        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="relative">
            <div aria-hidden className="absolute top-3 bottom-3 left-[27px] w-px bg-gradient-to-b from-lilas via-nuage to-transparent" />
            <AnimatedGroup key={jourCourant ?? 'jour'} preset="blur-slide" className="flex flex-col gap-5">
              {rdvs.map((r) => r.source === 'agenda' ? (
                <CarteAgenda key={r.id} r={r} active={selection === r.id} onChoisir={() => setSelection(r.id)} />
              ) : (
                <CarteRdv key={r.id} r={r} prep={preps[r.id] ?? r.preparation} active={selection === r.id} prochain={prochain?.id === r.id}
                  onChoisir={() => setSelection(r.id)} onPreparer={() => preparer(r)} />
              ))}
            </AnimatedGroup>
            {journee?.crm_absent && (
              <div className="ml-16 rounded-2xl border border-dashed border-lilas bg-white/70 p-6">
                <p className="titre text-xl text-encre">Déposez votre CRM de prospection</p>
                <p className="mt-1 text-sm text-ardoise">Vos prospects, leurs interlocuteurs et vos premiers rendez-vous vivent dans un fichier Excel à part. Déposez-le pour voir vos rendez-vous de prospection ici.</p>
                <button onClick={() => setDepotOuvert(true)} className="mt-4 flex items-center gap-2 rounded-full bg-encre px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-profond">
                  <Upload size={15} /> Déposer le fichier
                </button>
              </div>
            )}
            {journee && !journee.crm_absent && rdvs.length === 0 && (
              <div className="ml-16 rounded-2xl border border-dashed border-lilas bg-white/70 p-6">
                <p className="titre text-xl text-encre">{estAujourdhui ? 'Rien de prévu aujourd’hui' : 'Rien de prévu ce jour-là'}</p>
                <p className="mt-1 text-sm text-ardoise">Les rendez-vous ajoutés dans votre agenda Google apparaissent ici en quelques secondes.</p>
                {jourSuivant && (
                  <button onClick={() => changerJour(jourSuivant.jour)} className="mt-4 flex items-center gap-2 rounded-full bg-encre px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-profond">
                    Voir {jourSuivant.court} ({jourSuivant.rendez_vous} rendez-vous) <ArrowRight size={15} />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <TransitionPanel activeIndex={panneau} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
              variants={{ enter: { opacity: 0, transform: 'translateY(8px)'}, center: { opacity: 1, transform: 'translateY(0px)'}, exit: { opacity: 0, transform: 'translateY(-6px)'} }}>
              {[
                <PanneauAccueil key="accueil" r={actif} onPreparer={() => actif && preparer(actif)} />,
                <PanneauPreparation key="prep" r={actif} p={prepActive} onRelancer={() => actif && preparer(actif)} onCoulisses={() => actif && versCoulisses(actif.id)} />,
                <PanneauFiche key="fiche" r={actif} onRefaire={() => actif && preparer(actif)}
                  onEnvoye={(m) => { setToast(m); charger(false) }} />,
                <PanneauHorsCRM key="hors" r={actif} />,
              ]}
            </TransitionPanel>
          </div>
        </div>
      </main>

      {/* ------------------------------------------------------------ pied de page */}
      <Portail>
      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-nuage bg-white/90">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 text-[13px] text-ardoise sm:px-6">
          {journee?.agenda_ok ? (
            <>
              <span className="flex items-center gap-2">
                <span className="relative flex size-2.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-violet opacity-50" /><span className="relative inline-flex size-2.5 rounded-full bg-violet" /></span>
                Envoi automatique <b className="font-semibold text-encre">30 min avant</b> chaque rendez-vous de votre agenda
              </span>
              <span className="flex items-center gap-1.5"><CalendarCheck size={14} className="text-ok" /> Agenda Google relié</span>
            </>
          ) : journee ? (
            <button onClick={versCompte} className="flex flex-wrap items-center gap-x-2 rounded-full border border-alerte/40 bg-alerte-fond px-3 py-1.5 text-left font-semibold text-alerte transition hover:border-alerte">
              <CalendarPlus size={14} className="shrink-0" /> Relier mon agenda Google
              <span className="font-normal">L’envoi automatique est en pause.</span>
            </button>
          ) : (
            <span className="flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" /> Je consulte votre agenda...</span>
          )}
          {prospection && crm?.ok && (
            <button onClick={() => setDepotOuvert(true)} title="Remplacer le CRM de prospection" className="flex items-center gap-1.5 rounded-full px-1 hover:text-violet">
              <FileSpreadsheet size={14} /> CRM de prospection du {crm.date_export}
            </button>
          )}
          <button onClick={() => setDemoOuvert((v) => !v)} className={cn('ml-auto rounded-full px-3 py-1 text-[12px] transition', journee?.horloge_simulee ? 'bg-violet text-white' : 'text-brume hover:bg-voile hover:text-violet')}>
            {journee?.horloge_simulee ? `Démo : il est ${journee.horloge.slice(11).replace(':', 'h')}` : 'Mode démo'}
          </button>
        </div>
      </footer>
      </Portail>

      <AnimatePresence>
        {depotOuvert && <DepotCRM crm={crm} onFermer={() => setDepotOuvert(false)} onCharge={(c) => { onCrm(c); setDepotOuvert(false); setToast(`${prospection ? 'CRM de prospection chargé' : 'CRM chargé'} : ${c.entreprises} ${prospection ? 'prospects' : 'clients'}, ${c.rendez_vous} rendez-vous.`); api.jours(signal()).then((r) => setJours(r.jours)).catch(() => {}); charger(true) }} />}
        {demoOuvert && journee && <PanneauDemo journee={journee} onFermer={() => setDemoOuvert(false)} onChange={() => charger(false)} />}
      </AnimatePresence>

      <Portail>
      <div role="status" aria-live="polite" className="sr-only">{toast}</div>
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, transform: 'translate(-50%, 16px) scale(0.96)' }} animate={{ opacity: 1, transform: 'translate(-50%, 0px) scale(1)', transition: { duration: 0.25, ease: [0.23, 1, 0.32, 1] } }}
            exit={{ opacity: 0, transform: 'translate(-50%, 16px) scale(0.98)', transition: { duration: 0.15 } }}
            className="fixed bottom-20 left-1/2 z-50 flex items-center gap-2 rounded-full bg-encre px-5 py-2.5 text-sm text-white shadow-xl">
            <Check size={15} className="text-lavande" /> {toast}
          </motion.div>
        )}
      </AnimatePresence>
      </Portail>
    </div>
  )
}

/* ================================================================== petits éléments */

/* ================================================================== prospection : sales funnel et critères */

/** Libellés lisibles par un commercial (le CRM garde « Lead »). */
const LIBELLE_ETAPE: Record<string, string> = { Lead: 'Contact repéré' }
const libEtape = (e: string) => LIBELLE_ETAPE[e] ?? e

/** Barres de la jauge : le gris pâle d'avant était invisible, « à obtenir » est maintenant lilas avec un trait fin. */
const BARRE_CRITERE: Record<string, string> = {
  Obtenu: 'border-ok bg-ok',
  'Sans objet': 'border-brume/50 bg-brume/40',
  Partiel: 'border-lavande bg-[linear-gradient(90deg,var(--color-lavande)_50%,var(--color-lilas)_50%)]',
  'À obtenir': 'border-lavande bg-lilas',
}

/** Sur la carte d'un prospect : son étape dans le suivi et les questions du premier rendez-vous déjà éclaircies. */
function JaugeProspect({ a }: { a: Avancement }) {
  const premiers = a.criteres.filter((c) => c.n <= a.decouverte.total)
  const faits = a.decouverte.obtenus
  const acquis = premiers.filter((c) => c.statut === 'Obtenu' || c.statut === 'Sans objet').map((c) => c.critere)
  const reste = premiers.filter((c) => c.statut === 'À obtenir' || c.statut === 'Partiel').map((c) => c.critere)
  return (
    <div className="mt-3 rounded-xl bg-voile/70 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-violet-profond">{libEtape(a.etape)}</span>
        <span className="text-ardoise">{faits} question{faits > 1 ? 's' : ''} sur {a.decouverte.total} déjà éclaircie{faits > 1 ? 's' : ''}</span>
      </div>
      <div className="mt-2 flex gap-1" aria-hidden>
        {premiers.map((c) => <span key={c.n} title={`${c.critere} : ${c.statut}`} className={cn('h-2 flex-1 rounded-full border', BARRE_CRITERE[c.statut] ?? BARRE_CRITERE['À obtenir'])} />)}
      </div>
      <p className="sr-only">
        {acquis.length > 0 ? `Déjà éclaircies : ${acquis.join(', ')}. ` : 'Rien d’éclairci pour l’instant. '}
        {reste.length > 0 ? `Il reste à obtenir : ${reste.join(', ')}.` : ''}
      </p>
    </div>
  )
}

/** Une forme par état, pour ne pas dépendre de la couleur seule : coche, demi-disque, cercle vide. */
function IconeCritere({ statut }: { statut: string }) {
  if (statut === 'Obtenu') return <span aria-hidden className="grid size-4 shrink-0 place-items-center rounded-full bg-ok text-white"><Check size={11} strokeWidth={3.5} /></span>
  if (statut === 'Partiel') return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0 text-violet">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M8 1.5a6.5 6.5 0 0 0 0 13z" fill="currentColor" />
    </svg>
  )
  if (statut === 'Sans objet') return <span aria-hidden className="grid size-4 shrink-0 place-items-center rounded-full border-2 border-brume text-brume"><Minus size={9} strokeWidth={3} /></span>
  return <span aria-hidden className="size-4 shrink-0 rounded-full border-2 border-violet" />
}

/** Avant de préparer : le suivi du prospect et ce qu'il faut obtenir pendant ce rendez-vous. */
function CriteresProspect({ a }: { a: Avancement }) {
  const visibles = a.criteres.filter((c) => c.n <= a.decouverte.total + 2)
  const etapeIdx = a.etapes.indexOf(a.etape)
  return (
    <div className="mt-7 border-t border-nuage pt-5">
      <ol aria-label="Étapes du suivi" className="flex gap-1.5">
        {a.etapes.map((e, i) => (
          <li key={e} aria-current={i === etapeIdx ? 'step' : undefined}
            className={cn('flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-center text-xs font-semibold',
              i < etapeIdx ? 'bg-ok-fond text-ok' : i === etapeIdx ? 'bg-violet text-white' : 'bg-creme text-brume')}>
            {i < etapeIdx && <Check size={12} strokeWidth={3} aria-hidden />}
            {libEtape(e)}
            {i < etapeIdx && <span className="sr-only"> (faite)</span>}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm font-semibold text-encre">À obtenir pendant ce rendez-vous</p>
      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
        {visibles.map((c) => {
          const acquis = c.statut === 'Obtenu' || c.statut === 'Sans objet'
          return (
            <li key={c.n} title={c.preuve ?? undefined} className="flex items-center gap-2">
              <IconeCritere statut={c.statut} />
              <span className={acquis ? 'text-ardoise' : 'font-semibold text-encre'}>
                <span className="sr-only">{c.statut} : </span>{c.critere}
              </span>
              {c.statut === 'Partiel' && <span className="text-xs text-ardoise">en partie</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Chiffre({ libelle, valeur, total }: { libelle: string; valeur: number; total?: number }) {
  return (
    <div className="rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
      <div className="chiffre flex items-baseline text-3xl font-medium">
        <SlidingNumber value={valeur} />
        {total !== undefined && <span className="ml-1 text-base text-lavande">/{total}</span>}
      </div>
      <div className="mt-1 text-xs text-lilas">{libelle}</div>
    </div>
  )
}

function BoutonRond({ children, label, disabled, onClick, sombre }: { children: React.ReactNode; label: string; disabled?: boolean; onClick: () => void; sombre?: boolean }) {
  return (
    <button aria-label={label} disabled={disabled} onClick={onClick}
      className={cn('grid size-9 shrink-0 place-items-center rounded-full transition disabled:opacity-30',
        sombre ? 'bg-white/[0.06] text-lilas ring-1 ring-white/10 hover:bg-white/15 hover:text-white' : 'border border-nuage bg-white text-ardoise hover:border-lavande hover:text-violet')}>
      {children}
    </button>
  )
}

export function BoutonPrincipal({ children, onClick, grand }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; grand?: boolean }) {
  const couleurs = useCouleursAccent()
  return (
    <Magnetic intensity={0.25} range={120}>
      <div className="relative w-fit">
        <GlowEffect colors={couleurs} mode="colorShift" blur="soft" duration={4} scale={0.92} className="rounded-full opacity-70" />
        <button onClick={onClick}
          className={cn('relative flex items-center gap-2 rounded-full bg-violet font-semibold text-white ring-1 ring-white/20 transition hover:bg-violet-vif',
            grand ? 'px-6 py-3 text-[15px]' : 'px-4 py-2 text-sm')}>
          <Sparkles size={grand ? 17 : 15} /> {children}
        </button>
      </div>
    </Magnetic>
  )
}

/* ================================================================== carte rendez-vous */

function CarteRdv({ r, prep, active, prochain, onChoisir, onPreparer }: {
  r: RendezVous; prep: Preparation | null; active: boolean; prochain: boolean; onChoisir: () => void; onPreparer: () => void
}) {
  const enCours = prep?.statut === 'en_cours'
  return (
    <div className="relative flex gap-4">
      {/* repère sur la frise */}
      <div className="relative z-10 flex w-14 shrink-0 flex-col items-center pt-5">
        <span className={cn('grid size-3.5 place-items-center rounded-full ring-4 ring-white/80',
          r.fiche.prete ? 'bg-violet' : enCours ? 'bg-violet-vif' : 'bg-lilas')}>
          {enCours && <span className="size-3.5 animate-ping rounded-full bg-violet-vif" />}
        </span>
        <span className="chiffre mt-2 rounded-md bg-white/80 px-1 text-[17px] font-semibold text-encre">{r.heure}</span>
        <span className="rounded-md bg-white/80 px-1 text-xs text-ardoise tabular-nums">{r.heure_fin}</span>
      </div>

      <div className="min-w-0 flex-1">
        {/* la carte n'est plus un bouton qui en contient d'autres : le nom de l'entreprise est le bouton, et il s'étend sur toute la carte */}
        <div className={cn('group relative cursor-pointer overflow-hidden rounded-2xl border bg-white/90 p-5 text-left shadow-carte transition-[border-color,box-shadow] duration-200',
            active ? 'border-violet shadow-halo' : 'border-nuage hover:border-lavande hover:shadow-carte-survol')}>
          <Spotlight size={220} className="from-voile via-lilas/40 to-transparent blur-none" />
          {enCours && <BorderTrail size={90} className="bg-gradient-to-l from-violet via-violet-vif to-transparent" />}

          <div className="relative">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-semibold text-encre">
                    <button type="button" onClick={onChoisir} aria-current={active ? 'true' : undefined}
                      className="max-w-full truncate text-left after:absolute after:-inset-5 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-violet">
                      {r.entreprise}<span className="sr-only"> : rendez-vous de {r.heure}</span>
                    </button>
                  </h2>
                  {prochain && <span className="rounded-full bg-violet px-2 py-0.5 text-xs font-semibold tracking-wider text-white uppercase">Prochain</span>}
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 text-sm whitespace-nowrap text-ardoise">
                  {r.visio ? <Video size={14} /> : <MapPin size={14} />} {r.visio ? 'En visio' : `Sur site · ${r.ville}`}
                </p>
              </div>
              {r.dans_agenda && <span title="Dans votre agenda Google" role="img" aria-label="Dans votre agenda Google" className="mt-1 rounded-full bg-voile p-1.5 text-violet"><CalendarCheck size={14} /></span>}
            </div>

            <p className="mt-3 text-[15px] text-texte">avec <b className="font-semibold">{r.contact}</b>, <span className="lowercase">{r.poste}</span></p>
            <p className="mt-1 text-sm leading-relaxed text-ardoise">{r.objet}</p>
            {r.prospect && <JaugeProspect a={r.prospect} />}

            {(r.affaire || r.alertes.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {r.affaire && <span className="rounded-full bg-voile px-2.5 py-1 text-xs text-violet-profond">{r.affaire} · <b className="font-semibold">{r.montant}</b></span>}
                {r.alertes.map((a) => (
                  <span key={a} className="flex items-center gap-1 rounded-full bg-alerte-fond px-2.5 py-1 text-xs text-alerte"><AlertTriangle size={12} /> {a}</span>
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-nuage pt-4">
              {enCours ? (
                <TextShimmer className={cn('text-sm font-semibold', SHIMMER)} duration={1.6}>Je prépare votre fiche...</TextShimmer>
              ) : r.fiche.prete ? (
                <>
                  <button onClick={onChoisir} className="relative flex items-center gap-2 rounded-full bg-encre px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-profond">
                    <Headphones size={15} /> Lire ou écouter ma fiche
                  </button>
                  <span className={cn('flex items-center gap-1.5 text-xs', r.compte_rendu?.statut === 'a_valider' ? 'text-violet font-semibold' : 'text-ok')}>
                    <Check size={14} /> {r.compte_rendu?.statut === 'valide' ? 'Compte rendu enregistré dans le CRM' : r.compte_rendu?.statut === 'a_valider' ? 'Compte rendu à valider' : r.compte_rendu && r.compte_rendu.statut !== 'erreur' ? 'Compte rendu en préparation...' : r.envoi ? `Envoyée sur votre téléphone à ${r.envoi.le}` : `Prête depuis le ${r.fiche.preparee_le}`}
                  </span>
                </>
              ) : (
                <BoutonPrincipal onClick={() => onPreparer()}>Préparer ma visite</BoutonPrincipal>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ================================================================== rendez-vous vu seulement dans l'agenda */

function CarteAgenda({ r, active, onChoisir }: { r: RendezVous; active: boolean; onChoisir: () => void }) {
  // petite mise en scène : je cherche dans le CRM... puis le constat
  const [cherche, setCherche] = useState(true)
  useEffect(() => { const t = setTimeout(() => setCherche(false), 2200); return () => clearTimeout(t) }, [])
  return (
    <div className="relative flex gap-4">
      <div className="relative z-10 flex w-14 shrink-0 flex-col items-center pt-5">
        <span className="relative grid size-3.5 place-items-center rounded-full bg-alerte ring-4 ring-white/80" />
        <span className="chiffre mt-2 rounded-md bg-white/80 px-1 text-[17px] font-semibold text-encre">{r.heure}</span>
        <span className="rounded-md bg-white/80 px-1 text-xs text-ardoise tabular-nums">{r.heure_fin}</span>
      </div>
      <motion.div onClick={onChoisir} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onChoisir()}
        initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', bounce: 0.25, duration: 0.6 }}
        className={cn('relative min-w-0 flex-1 cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed bg-white p-5 transition-[border-color,box-shadow]',
          active ? 'border-alerte shadow-[0_0_0_4px_var(--color-alerte-fond)]' : 'border-alerte/40 hover:border-alerte/70')}>
        {cherche && <BorderTrail size={80} className="bg-gradient-to-l from-alerte via-[#F59E0B] to-transparent" />}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-encre">{r.entreprise}</h2>
              {r.nouveau && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: [0, 1.15, 1] }} transition={{ duration: 0.5 }}
                  className="rounded-full bg-violet px-2 py-0.5 text-xs font-semibold tracking-wider text-white uppercase">Nouveau</motion.span>
              )}
            </div>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ardoise"><CalendarPlus size={14} /> Ajouté dans votre agenda : « {r.titre_agenda} »</p>
          </div>
        </div>
        <div className="mt-4 min-h-[52px]">
          <AnimatePresence mode="wait">
            {cherche ? (
              <motion.div key="cherche" exit={{ opacity: 0, y: -6}} className="flex items-center gap-2 text-sm">
                <Loader2 size={15} className="animate-spin text-alerte" />
                <TextShimmer className="[--base-color:var(--color-alerte)] [--base-gradient-color:#FDE68A] text-sm font-semibold" duration={1.2}>{`Je cherche ${r.entreprise} dans votre CRM...`}</TextShimmer>
              </motion.div>
            ) : (
              <motion.div key="vide" initial={{ opacity: 0, y: 8}} animate={{ opacity: 1, y: 0, x: [0, -6, 6, -3, 3, 0] }}
                transition={{ duration: 0.5, x: { duration: 0.45, delay: 0.15 } }}
                className="flex items-start gap-3 rounded-xl bg-alerte-fond p-3 text-sm text-alerte">
                <motion.span initial={{ rotate: -20, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', bounce: 0.6 }}><SearchX size={18} /></motion.span>
                <span><b className="font-semibold">Aucune information dans le CRM</b> pour ce rendez-vous{r.entreprise_connue ? ' (le client existe, mais aucun rendez-vous n’y est prévu à cette heure)' : ''}. Pas de fiche possible pour l’instant.</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}

function PanneauHorsCRM({ r }: { r: RendezVous | null }) {
  if (!r) return <Carte className="min-h-[460px]">{null}</Carte>
  return (
    <Carte className="flex min-h-[460px] flex-col justify-center">
      <div aria-hidden className="halo pointer-events-none absolute -top-40 -right-32 size-[26rem] [--halo:var(--color-alerte-fond)]" />
      <div className="relative">
        <motion.span initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', bounce: 0.5 }}
          className="grid size-14 place-items-center rounded-2xl bg-alerte-fond text-alerte"><SearchX size={26} /></motion.span>
        <h2 className="mt-5 text-2xl font-semibold tracking-tight text-encre">{r.entreprise} : rien dans le CRM</h2>
        <p className="mt-2 text-ardoise">Ce rendez-vous est dans votre agenda Google (« {r.titre_agenda} », {r.heure}), mais je n’ai trouvé ni client, ni contact, ni rendez-vous correspondant dans le CRM.</p>
        <AnimatedGroup preset="blur-slide" className="mt-6 space-y-3 text-[15px]">
          {['Créez le rendez-vous dans le CRM (client, contact, objet)', 'Exportez le CRM et déposez le nouveau fichier ici', 'Je relie alors l’agenda au CRM et je prépare la fiche'].map((t, i) => (
            <div key={t} className="flex items-center gap-3"><Puce n={i + 1} />{t}</div>
          ))}
        </AnimatedGroup>
        <p className="mt-6 text-xs text-brume">L’agenda est relu toutes les 2 minutes : tout rendez-vous ajouté apparaît ici sans rien faire.</p>
      </div>
    </Carte>
  )
}

/* ================================================================== panneaux de droite */

function Carte({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('relative overflow-hidden rounded-[24px] border border-white/80 bg-white/90 p-7 shadow-panneau', className)}>{children}</div>
}

function PanneauAccueil({ r, onPreparer }: { r: RendezVous | null; onPreparer: () => void }) {
  const mode = useMode()
  if (!r) {
    return (
      <Carte className="flex min-h-[460px] flex-col items-center justify-center text-center">
        <div aria-hidden className="halo pointer-events-none absolute inset-x-0 -top-40 mx-auto size-[26rem] [--halo:var(--color-voile)]" />
        <div className="relative">
          <img src="/logo-icone.svg" alt="" className="mx-auto size-14" />
          <TextEffect as="h2" preset="fade-in-blur" per="word" className="mt-5 text-2xl font-semibold text-encre">Choisissez un rendez-vous</TextEffect>
          <p className="mx-auto mt-3 max-w-sm text-ardoise">{mode === 'prospection'
            ? 'Pour un premier rendez-vous, je cherche ce qui se passe chez le prospect, je prépare vos questions pour trouver son vrai problème et la phrase pour décrocher le rendez-vous suivant. Vous pouvez lire la fiche, ou l’écouter en voiture.'
            : 'En deux minutes, je rassemble ce que dit votre CRM, le cours de bourse, la page LinkedIn et l’actualité du client, puis je vous écris une fiche d’une page. Vous pouvez la lire, ou l’écouter en voiture.'}</p>
          <div className="mt-7 flex justify-center gap-6 text-sm text-ardoise">
            <span className="flex items-center gap-2"><FileSpreadsheet size={16} className="text-violet" /> CRM</span>
            <span className="flex items-center gap-2"><Sparkles size={16} className="text-violet" /> Actualité</span>
            <span className="flex items-center gap-2"><Car size={16} className="text-violet" /> Audio</span>
          </div>
        </div>
      </Carte>
    )
  }
  const etapes = r.prospect ? [] : [
    'Je lis tout ce que votre CRM sait de ce client', r.cotee ? 'Je regarde son cours de bourse' : 'Société non cotée : je passe directement à la presse',
    'Je lis ses dernières publications LinkedIn', 'Je cherche son actualité des trois derniers mois', 'Je vous écris une fiche d’une page, et je l’enregistre en audio']
  return (
    // le bouton est dans un pied de carte qui reste visible, même quand la liste des critères est longue
    <Carte className="flex min-h-[460px] flex-col p-0 lg:max-h-[calc(100vh-11rem)]">
      <div aria-hidden className="halo pointer-events-none absolute -top-40 -right-32 size-[26rem] [--halo:var(--color-voile)]" />
      <div className="relative min-h-0 flex-1 overflow-y-auto p-7">
        <p className="text-sm text-ardoise">{r.heure} · {r.visio ? 'en visio' : r.ville}</p>
        <h2 className="mt-1 text-3xl font-semibold tracking-tight text-encre">{r.entreprise}</h2>
        <p className="mt-1 text-ardoise">avec {r.contact}, <span className="lowercase">{r.poste}</span></p>
        {r.prospect ? (
          <p className="mt-6 text-[15px] text-encre">Profil de {r.contact || 'votre interlocuteur'}, actualité de l’entreprise et de son secteur, fournisseur en place : je prépare vos questions et la phrase pour décrocher la suite, en une page à lire ou à écouter.</p>
        ) : (
          <AnimatedGroup preset="blur-slide" className="mt-7 space-y-3.5 text-[15px]">
            {etapes.map((t, i) => (
              <div key={t} className="flex items-center gap-3"><Puce n={i + 1} />{t}</div>
            ))}
          </AnimatedGroup>
        )}
        {r.prospect && <CriteresProspect a={r.prospect} />}
      </div>
      <div className="relative shrink-0 border-t border-nuage bg-white/90 px-7 py-5"><BoutonPrincipal grand onClick={onPreparer}>Préparer ma visite</BoutonPrincipal></div>
    </Carte>
  )
}

function Chrono({ debut, fin }: { debut: number; fin: number | null }) {
  const [now, setNow] = useState(Date.now() / 1000)
  useEffect(() => {
    if (fin) return
    const t = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(t)
  }, [fin])
  const s = Math.max(0, Math.round((fin ?? now) - debut))
  return <span className="tabular-nums">{Math.floor(s / 60)} min {String(s % 60).padStart(2, '0')}</span>
}

function PanneauPreparation({ r, p, onRelancer, onCoulisses }: { r: RendezVous | null; p: Preparation | null; onRelancer: () => void; onCoulisses: () => void }) {
  if (!r || !p) return <Carte className="min-h-[460px]">{null}</Carte>
  const details = p.details.slice(-6)
  const faites = p.etapes.filter((e) => e.etat === 'fait' || e.etat === 'saute').length
  return (
    <Carte className="min-h-[460px]">
      {p.statut === 'en_cours' && <BorderTrail size={140} className="bg-gradient-to-l from-violet via-violet-vif to-transparent" transition={{ repeat: Infinity, duration: 6, ease: 'linear' }} />}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-violet uppercase">Préparation en cours</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-encre">Votre visite chez {r.entreprise}</h2>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-creme px-3 py-1 text-sm text-ardoise"><Clock size={14} /><Chrono debut={p.debut} fin={p.fin} /></span>
      </div>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-nuage">
        <motion.div className="h-full rounded-full bg-gradient-to-r from-violet to-violet-vif" animate={{ width: `${(faites / p.etapes.length) * 100}%` }} transition={{ type: 'spring', bounce: 0, duration: 0.8 }} />
      </div>
      <ol className="relative mt-6 space-y-4">
        <div aria-hidden className="absolute top-3 bottom-3 left-[13px] w-px bg-nuage" />
        {p.etapes.map((e) => (
          <li key={e.cle} className="relative flex items-center gap-3 text-[15px]">
            <motion.span layout className={cn('grid size-7 shrink-0 place-items-center rounded-full ring-4 ring-white',
              e.etat === 'fait' && 'bg-violet text-white', e.etat === 'en_cours' && 'bg-voile text-violet',
              (e.etat === 'a_faire' || e.etat === 'saute') && 'bg-nuage text-brume')}>
              {e.etat === 'fait' ? <Check size={15} /> : e.etat === 'en_cours' ? <Loader2 size={15} className="animate-spin" /> : e.etat === 'saute' ? <Minus size={15} /> : <span className="size-1.5 rounded-full bg-brume" />}
            </motion.span>
            {e.etat === 'en_cours'
              ? <TextShimmer className={cn('font-semibold', SHIMMER)} duration={1.8}>{e.libelle}</TextShimmer>
              : <span className={cn(e.etat === 'fait' ? 'text-encre' : 'text-brume')}>{e.libelle}</span>}
          </li>
        ))}
      </ol>
      <div className="mt-7 rounded-2xl bg-encre p-4 text-white">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-lavande uppercase">
          <span className="size-1.5 animate-pulse rounded-full bg-lavande" /> En direct
        </div>
        <ul className="space-y-1.5 text-sm text-lilas">
          <AnimatePresence initial={false}>
            {details.map((d) => (
              <motion.li key={`${d.t}-${d.texte}`} layout initial={{ opacity: 0, x: -8}} animate={{ opacity: 1, x: 0}} exit={{ opacity: 0 }} className="truncate">
                {lisible(d.texte)}
              </motion.li>
            ))}
          </AnimatePresence>
          {details.length === 0 && <li className="text-lilas">Je démarre...</li>}
        </ul>
      </div>
      <button onClick={onCoulisses} className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-violet hover:underline">
        Voir tout le détail dans le workflow <ArrowRight size={14} />
      </button>
      {p.statut === 'echec' && (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-xl bg-alerte-fond p-4 text-sm text-alerte">
          <span>La préparation s’est arrêtée avant la fin. {p.message && !/[`{}/\\]|error|exception/i.test(p.message) ? p.message : 'Relancez-la, cela prend deux minutes.'}</span>
          <button onClick={onRelancer} className="flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 font-semibold"><RefreshCw size={14} /> Relancer</button>
        </div>
      )}
    </Carte>
  )
}

function Lecteur({ src, entreprise }: { src: string; entreprise: string }) {
  const couleurs = useCouleursAccent()
  const ref = useRef<HTMLAudioElement>(null)
  const [lecture, setLecture] = useState(false)
  const [pos, setPos] = useState(0)
  const [duree, setDuree] = useState(0)
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const sauter = (d: number) => { if (ref.current) ref.current.currentTime = Math.min(Math.max(0, ref.current.currentTime + d), duree || ref.current.duration || 0) }
  return (
    <div className="relative">
      <GlowEffect colors={couleurs} mode="breathe" blur="strong" duration={5} scale={0.97} className={cn('rounded-[24px] transition-opacity', lecture ? 'opacity-70' : 'opacity-30')} />
      <div className="relative flex items-center gap-5 overflow-hidden rounded-[24px] bg-encre p-5 text-white">
        <div aria-hidden className="halo pointer-events-none absolute -right-24 -bottom-28 size-80 [--halo:color-mix(in_srgb,var(--color-deco)_40%,transparent)]" />
        <button aria-label={lecture ? 'Pause' : 'Écouter ma fiche'} onClick={() => (lecture ? ref.current?.pause() : ref.current?.play())}
          className="relative grid size-16 shrink-0 place-items-center rounded-full bg-violet shadow-lecture transition hover:scale-105 hover:bg-violet-vif">
          {lecture ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
        </button>
        <div className="relative min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-lavande uppercase"><Car size={14} /> À écouter en voiture</div>
          <div className="titre mt-1 text-xl">Votre fiche {entreprise}</div>
          <div className="mt-3 flex items-center gap-2">
            <button aria-label="Reculer de 15 secondes" onClick={() => sauter(-15)} className="grid size-8 shrink-0 place-items-center rounded-full text-lilas transition hover:bg-white/10 hover:text-white"><RotateCcw size={16} /></button>
            <input type="range" min={0} max={duree || 0} step={0.1} value={pos} disabled={!duree} aria-label="Position dans la fiche audio" aria-valuetext={`${fmt(pos)} sur ${duree ? fmt(duree) : 'durée inconnue'}`}
              onChange={(e) => { const t = Number(e.target.value); setPos(t); if (ref.current) ref.current.currentTime = t }}
              style={{ ['--p' as string]: duree ? `${(pos / duree) * 100}%` : '0%' }}
              className="curseur-audio h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/15" />
            <button aria-label="Avancer de 15 secondes" onClick={() => sauter(15)} className="grid size-8 shrink-0 place-items-center rounded-full text-lilas transition hover:bg-white/10 hover:text-white"><RotateCw size={16} /></button>
            <span className="text-xs text-lilas tabular-nums">{fmt(pos)} / {duree ? fmt(duree) : '-:--'}</span>
          </div>
        </div>
        <audio ref={ref} src={src} preload="metadata" onPlay={() => setLecture(true)} onPause={() => setLecture(false)} onEnded={() => setLecture(false)}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDuree(e.currentTarget.duration)} />
      </div>
    </div>
  )
}

function PanneauFiche({ r, onRefaire, onEnvoye }: { r: RendezVous | null; onRefaire: () => void; onEnvoye: (m: string) => void }) {
  const [hauteur, setHauteur] = useState(900)
  const [envoi, setEnvoi] = useState(false)
  const [confirmer, setConfirmer] = useState(false)
  const { api } = useApi()
  if (!r || !r.fiche.page) return <Carte className="min-h-[460px]">{null}</Carte>
  const v = encodeURIComponent(r.fiche.preparee_le ?? '')
  const envoyer = async () => {
    setEnvoi(true)
    try {
      const res = await api.envoyer(r.id)
      onEnvoye(res.ok ? 'Fiche envoyée sur votre téléphone.' : res.message ?? 'L’envoi n’est pas passé.')
    } catch {
      onEnvoye('L’envoi n’est pas passé. Vérifiez que votre téléphone est relié dans Mon compte.')
    } finally {
      setEnvoi(false)
    }
  }
  return (
    <div className="space-y-4">
      {r.compte_rendu && <BlocCompteRendu r={r} onValide={onEnvoye} />}
      {r.fiche.son && <Lecteur key={r.fiche.son + v} src={`${r.fiche.son}?v=${v}`} entreprise={r.entreprise} />}
      <div className="flex flex-wrap items-center gap-2">
        <a href={r.fiche.page} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-full border border-nuage bg-white px-4 py-2 text-sm text-encre transition hover:border-lavande">
          <Printer size={15} /> Imprimer
        </a>
        <button onClick={envoyer} disabled={envoi}
          className="flex items-center gap-2 rounded-full border border-nuage bg-white px-4 py-2 text-sm text-encre transition hover:border-lavande disabled:opacity-50">
          {envoi ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Envoyer sur mon téléphone
        </button>
        {confirmer ? (
          <span className="ml-auto flex items-center gap-2 rounded-full bg-voile py-1 pr-1 pl-4 text-sm text-encre">
            Remplacer la fiche actuelle ?
            <button onClick={() => { setConfirmer(false); onRefaire() }} className="rounded-full bg-violet px-3 py-1.5 font-semibold text-white hover:bg-violet-vif">Oui, la refaire</button>
            <button onClick={() => setConfirmer(false)} className="rounded-full px-3 py-1.5 text-ardoise hover:bg-white">Non</button>
          </span>
        ) : (
          <button onClick={() => setConfirmer(true)} className="ml-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm text-ardoise transition hover:bg-voile hover:text-violet">
            <RefreshCw size={15} /> Refaire la fiche
          </button>
        )}
      </div>
      <InView variants={{ hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0 } }} transition={{ duration: 0.4 }} once>
        <div className="overflow-hidden rounded-[24px] border border-nuage bg-white shadow-panneau">
          <iframe key={r.fiche.page + v} title={`Fiche ${r.entreprise}`} src={`${r.fiche.page}?v=${v}`} className="w-full" style={{ height: hauteur }}
            onLoad={(e) => { const d = e.currentTarget.contentDocument; if (d) setHauteur(d.documentElement.scrollHeight + 8) }} />
        </div>
      </InView>
    </div>
  )
}

/* ================================================================== compte rendu (dicté sur le téléphone) */

function BlocCompteRendu({ r, onValide }: { r: RendezVous; onValide: (m: string) => void }) {
  const cr = r.compte_rendu!
  const [ouvert, setOuvert] = useState(cr.statut === 'a_valider')
  const [envoi, setEnvoi] = useState(false)
  const [erreurCR, setErreurCR] = useState<string | null>(null)
  const [recu, setRecu] = useState<string | null>(null)
  const enCours = !['a_valider', 'valide', 'erreur'].includes(cr.statut)
  const valider = async () => {
    setEnvoi(true)
    setErreurCR(null)
    try {
      const res = await compte.validerCR(r.id)
      if (res.ok === false) throw new Error()
      setRecu(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h'))
      onValide('Compte rendu validé : je l’enregistre dans le CRM.')
    } catch {
      setErreurCR('L’enregistrement n’est pas passé. Rien n’a été modifié dans le CRM : vous pouvez réessayer.')
    } finally {
      setEnvoi(false)
    }
  }
  const libelles: Record<string, string> = { note_recue: 'Note vocale reçue', transcription: 'Je transcris votre note', redaction: 'Je rédige le compte rendu', enregistrement: 'J’enregistre dans le CRM' }
  const gras = (t: string) => t.split(/(\*\*[^*]+\*\*)/).map((m, i) => m.startsWith('**') ? <b key={i} className="font-semibold text-encre">{m.slice(2, -2)}</b> : m)
  return (
    <div className={cn('relative overflow-hidden rounded-[24px] border p-5', cr.statut === 'valide' ? 'border-ok/40 bg-ok-fond' : 'border-white/80 bg-white/90')}>
      {enCours && <BorderTrail size={90} className="bg-gradient-to-l from-violet via-violet-vif to-transparent" />}
      <div className="flex items-center gap-3">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-2xl', cr.statut === 'valide' ? 'bg-ok text-white' : 'bg-voile text-violet')}>{cr.statut === 'valide' ? <Check size={18} /> : enCours ? <Loader2 size={18} className="animate-spin" /> : <Headphones size={18} />}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-[0.16em] text-ardoise uppercase">Compte rendu dicté sur le téléphone</p>
          {enCours ? <TextShimmer className={cn('font-semibold', SHIMMER)}>{libelles[cr.statut] ?? 'En préparation...'}</TextShimmer>
            : <p className="font-semibold text-encre">{cr.statut === 'valide' ? 'Enregistré dans le CRM' : cr.statut === 'erreur' ? (cr.message ?? 'Le compte rendu n’a pas pu être préparé') : 'Prêt à valider'}</p>}
        </div>
        {cr.texte && <button onClick={() => setOuvert(!ouvert)} className="text-sm font-semibold text-violet">{ouvert ? 'Masquer' : 'Lire'}</button>}
      </div>
      {ouvert && cr.texte && (
        <div className="mt-4 space-y-1.5 border-t border-nuage pt-4 text-sm leading-relaxed">
          {cr.texte.split('\n').map((l, i) => /^#{1,3} /.test(l) ? <p key={i} className="pt-2 font-semibold text-encre">{l.replace(/^#+ /, '')}</p>
            : /^[-*] /.test(l) ? <p key={i} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-violet" />{gras(l.slice(2))}</p>
            : l.trim() ? <p key={i}>{gras(l)}</p> : null)}
        </div>
      )}
      {cr.statut === 'a_valider' && cr.maj_crm && (cr.maj_crm.resultat || cr.maj_crm.prochaine_action) && (
        <div className="mt-4 rounded-2xl bg-voile p-4 text-sm">
          <p className="font-semibold text-encre">Ce qui sera mis à jour dans le CRM</p>
          <dl className="mt-2 space-y-1.5 text-texte">
            <div className="flex gap-2"><dt className="shrink-0 text-ardoise">Rendez-vous :</dt><dd>passe à « Réalisé », avec ce compte rendu</dd></div>
            {cr.maj_crm.resultat && <div className="flex gap-2"><dt className="shrink-0 text-ardoise">Résultat :</dt><dd>{cr.maj_crm.resultat}</dd></div>}
            {cr.maj_crm.prochaine_action && <div className="flex gap-2"><dt className="shrink-0 text-ardoise">Prochaine action :</dt><dd>{cr.maj_crm.prochaine_action}{cr.maj_crm.echeance ? `, pour le ${cr.maj_crm.echeance}` : ''}</dd></div>}
          </dl>
        </div>
      )}
      {cr.statut === 'a_valider' && (
        <>
          <button disabled={envoi} onClick={valider}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-violet py-2.5 text-sm font-semibold text-white hover:bg-violet-vif disabled:opacity-60">
            {envoi ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {erreurCR ? 'Réessayer' : 'Valider et enregistrer dans le CRM'}
          </button>
          {erreurCR && <p role="alert" className="mt-2 rounded-xl bg-erreur-fond p-3 text-sm text-erreur">{erreurCR}</p>}
        </>
      )}
      {cr.statut === 'valide' && recu && <p className="mt-3 text-sm text-ok">Enregistré dans le CRM à {recu}.</p>}
    </div>
  )
}

/* ================================================================== fenêtres */

export function Fenetre({ children, onFermer }: { children: React.ReactNode; onFermer: () => void }) {
  return (
    <Portail>
    <motion.div role="dialog" aria-modal="true" className="fixed inset-0 z-40 grid place-items-center bg-encre/50 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onFermer}>
      <motion.div initial={{ opacity: 0, transform: 'translateY(16px) scale(0.97)'}} animate={{ opacity: 1, transform: 'translateY(0px) scale(1)'}}
        exit={{ opacity: 0, transform: 'translateY(8px) scale(0.98)', transition: { duration: 0.15 } }}
        transition={{ type: 'spring', bounce: 0.1, duration: 0.35 }}
        className="relative w-full max-w-lg rounded-[24px] bg-white p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onFermer} aria-label="Fermer" className="absolute top-4 right-4 rounded-full p-1.5 text-brume hover:bg-voile hover:text-violet"><X size={18} /></button>
        {children}
      </motion.div>
    </motion.div>
    </Portail>
  )
}

export function Puce({ n }: { n: number }) {
  return <span className="grid size-7 shrink-0 place-items-center rounded-full bg-voile text-xs font-semibold text-violet">{String(n).padStart(2, '0')}</span>
}

export function DepotCRM({ crm, onFermer, onCharge }: { crm: InfoCRM | null; onFermer: () => void; onCharge: (c: InfoCRM) => void }) {
  const [survol, setSurvol] = useState(false)
  const [phase, setPhase] = useState<'choix' | 'lecture' | 'preuve'>('choix')
  const [etape, setEtape] = useState(0)
  const [nomFichier, setNomFichier] = useState('')
  const [res, setRes] = useState<InfoCRM | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const prospection = useMode() === 'prospection'
  const { api } = useApi()
  const ETAPES = prospection
    ? ['Je reçois le fichier', 'Je vérifie les onglets du CRM de prospection', 'Je relie prospects, interlocuteurs, rendez-vous et critères']
    : ['Je reçois le fichier', 'Je vérifie les onglets du CRM', 'Je relie clients, contacts et rendez-vous']

  const deposer = async (f?: File) => {
    if (!f) return
    setNomFichier(f.name)
    setErr(null)
    setPhase('lecture')
    setEtape(0)
    const t1 = setTimeout(() => setEtape(1), 700)
    const t2 = setTimeout(() => setEtape(2), 1400)
    try {
      const [r] = await Promise.all([api.deposerCRM(f), new Promise((ok) => setTimeout(ok, 2100))])
      setRes(r)
      setPhase('preuve')
    } catch (e) {
      clearTimeout(t1); clearTimeout(t2)
      setErr((e as Error).message)
      setPhase('choix')
    }
  }
  const terminer = () => (res ? onCharge(res) : onFermer())

  return (
    <Fenetre onFermer={phase === 'preuve' ? terminer : onFermer}>
      <AnimatePresence mode="wait">
        {phase === 'choix' && (
          <motion.div key="choix" exit={{ opacity: 0, y: -8 }}>
            <h2 className="text-xl font-semibold text-encre">{prospection ? 'Déposer votre CRM de prospection' : 'Déposer votre CRM'}</h2>
            {crm?.ok && <p className="mt-1 text-sm text-ardoise">Fichier actuel : export du {crm.date_export}, {crm.entreprises} {prospection ? 'prospects' : 'clients'}, {crm.rendez_vous} rendez-vous.</p>}
            <div onDragOver={(e) => { e.preventDefault(); setSurvol(true) }} onDragLeave={() => setSurvol(false)}
              onDrop={(e) => { e.preventDefault(); setSurvol(false); deposer(e.dataTransfer.files[0]) }} onClick={() => input.current?.click()}
              className={cn('relative mt-5 grid cursor-pointer place-items-center overflow-hidden rounded-2xl border-2 border-dashed px-6 py-10 text-center transition',
                survol ? 'scale-[1.02] border-violet bg-voile' : 'border-lilas hover:border-lavande hover:bg-creme')}>
              <motion.span animate={survol ? { y: [-2, -8, -2] } : { y: 0 }} transition={{ repeat: survol ? Infinity : 0, duration: 0.8 }}
                className="grid size-14 place-items-center rounded-2xl bg-voile text-violet"><Upload size={24} /></motion.span>
              <p className="mt-3 font-semibold text-encre">{survol ? 'Lâchez le fichier ici' : prospection ? 'Glissez votre CRM de prospection ici' : 'Glissez votre export CRM ici'}</p>
              <p className="mt-1 text-sm text-ardoise">Fichier Excel (.xlsx), ou cliquez pour le choisir</p>
              <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => deposer(e.target.files?.[0])} />
            </div>
            {err && <motion.p initial={{ x: -6 }} animate={{ x: [0, -6, 6, -3, 3, 0] }} className="mt-3 rounded-xl bg-alerte-fond p-3 text-sm text-alerte">{err}</motion.p>}
            <p className="mt-4 text-xs text-brume">Le fichier reste sur cet ordinateur. L’ancien est gardé en sauvegarde.</p>
          </motion.div>
        )}

        {phase === 'lecture' && (
          <motion.div key="lecture" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="py-4">
            <div className="flex items-center gap-3">
              <span className="relative grid size-12 place-items-center overflow-hidden rounded-2xl bg-voile text-violet">
                <FileSpreadsheet size={22} />
                <motion.span className="absolute inset-x-0 h-1 bg-violet/60" animate={{ top: ['0%', '100%', '0%'] }} transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }} />
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold text-encre">{nomFichier}</p>
                <p className="text-sm text-ardoise">Lecture en cours...</p>
              </div>
            </div>
            <ol className="mt-6 space-y-3">
              {ETAPES.map((t, i) => (
                <li key={t} className="flex items-center gap-3 text-sm">
                  <span className={cn('grid size-6 place-items-center rounded-full transition-colors', i < etape ? 'bg-ok text-white' : i === etape ? 'bg-voile text-violet' : 'bg-nuage text-brume')}>
                    {i < etape ? <Check size={13} strokeWidth={3} /> : i === etape ? <Loader2 size={13} className="animate-spin" /> : <span className="size-1.5 rounded-full bg-brume" />}
                  </span>
                  {i === etape ? <TextShimmer className={cn('font-semibold', SHIMMER)} duration={1.4}>{t}</TextShimmer> : <span className={i < etape ? 'text-encre' : 'text-brume'}>{t}</span>}
                </li>
              ))}
            </ol>
          </motion.div>
        )}

        {phase === 'preuve' && res && (
          <motion.div key="preuve" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
            <div className="relative mx-auto mt-2 grid size-20 place-items-center">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="absolute inset-0 rounded-full bg-ok/30" initial={{ scale: 0.6, opacity: 0.8 }} animate={{ scale: 2, opacity: 0 }} transition={{ duration: 1.4, delay: 0.25 + i * 0.25 }} />
              ))}
              <motion.span initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', bounce: 0.55, duration: 0.7 }}
                className="relative grid size-20 place-items-center rounded-full bg-ok text-white shadow-[0_12px_30px_-10px_#17803D]">
                <Check size={38} strokeWidth={3} />
              </motion.span>
            </div>
            <h2 className="mt-5 text-xl font-semibold text-encre">{prospection ? 'CRM de prospection bien reçu' : 'CRM bien reçu'}</h2>
            <p className="mt-1 text-sm text-ardoise"><b className="text-encre">{res.fichier}</b> · {res.taille_ko} Ko · export du {res.date_export}</p>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {[[res.entreprises, prospection ? 'prospects' : 'clients'], [res.contacts, prospection ? 'interlocuteurs' : 'contacts'], [res.rendez_vous, 'rendez-vous']].map(([n, l]) => (
                <motion.div key={l as string} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="rounded-xl bg-ok-fond p-3">
                  <div className="text-2xl font-semibold text-ok">{n}</div><div className="text-xs text-ardoise">{l}</div>
                </motion.div>
              ))}
            </div>
            <AnimatedGroup className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-left text-sm"
              variants={{ container: { visible: { transition: { staggerChildren: 0.07, delayChildren: 0.7 } } }, item: { hidden: { opacity: 0, x: -6 }, visible: { opacity: 1, x: 0 } } }}>
              {(res.onglets ?? []).map((o) => (
                <div key={o.nom} className="flex items-center gap-2">
                  <Check size={14} strokeWidth={3} className="shrink-0 text-ok" />
                  <span className="text-encre">{o.nom}</span><span className="ml-auto text-xs text-brume">{o.lignes} lignes</span>
                </div>
              ))}
            </AnimatedGroup>
            <p className="mt-4 text-xs text-brume">Enregistré le {res.depose_le}. Tous les onglets attendus sont présents et lisibles.</p>
            <button onClick={terminer} className="mt-5 w-full rounded-full bg-violet py-2.5 text-sm font-semibold text-white hover:bg-violet-vif">Terminé</button>
          </motion.div>
        )}
      </AnimatePresence>
    </Fenetre>
  )
}

function PanneauDemo({ journee, onFermer, onChange }: { journee: Journee; onFermer: () => void; onChange: () => void }) {
  const { api } = useApi()
  const choix = useMemo(() => journee.rendez_vous.map((r) => {
    const d = new Date(r.debut)
    d.setMinutes(d.getMinutes() - 31)
    const iso = `${journee.jour}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    return { libelle: `31 min avant ${r.entreprise} (${r.heure})`, iso }
  }), [journee])
  const regler = async (iso: string | null) => {
    await api.horloge(iso)
    onChange()
  }
  return (
    <Fenetre onFermer={onFermer}>
      <h2 className="text-xl font-semibold text-encre">Mode démo</h2>
      <p className="mt-1 text-sm text-ardoise">Pour montrer l’envoi automatique sans attendre : je fais comme s’il était l’heure choisie. La fiche part sur le téléphone dans la minute.</p>
      <div className="mt-5 flex flex-col gap-2">
        {choix.map((c) => (
          <button key={c.iso} onClick={() => regler(c.iso)} className="group flex items-center justify-between rounded-xl border border-nuage px-4 py-3 text-left text-sm transition hover:border-lavande hover:bg-creme">
            {c.libelle} <ArrowRight size={15} className="text-violet transition group-hover:translate-x-0.5" />
          </button>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <button onClick={() => regler(null)} className="rounded-full bg-violet px-4 py-2 text-sm font-semibold text-white hover:bg-violet-vif">Revenir à l’heure réelle</button>
        <button onClick={async () => { await api.reinitialiserEnvois(); onChange() }} className="rounded-full border border-nuage px-4 py-2 text-sm text-ardoise hover:border-lavande">Oublier les envois déjà faits</button>
      </div>
      <p className="mt-4 text-xs text-brume">{journee.horloge_simulee ? `Heure simulée : ${journee.horloge.replace('T', ' à ')}` : 'Heure réelle.'}</p>
    </Fenetre>
  )
}
