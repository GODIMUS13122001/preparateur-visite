import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { CalendarDays, CalendarRange, Loader2, Moon, Sun, UserRound, Workflow } from 'lucide-react'
import { agenda, creerApi, compte, type EtatClaude, type InfoCRM, type Mode, type RdvAgenda, type Telephone } from './api'
import { FournisseurMode } from './mode'
import { AnimatedBackground } from '@/components/motion-primitives/animated-background'

/* Chaque écran est un morceau à part, chargé à la demande : le premier affichage ne lit que le nécessaire.
   Ma journée est demandée dès l'accueil (c'est l'écran suivant) ; Workflow et Mon compte au premier clic ou au survol. */
const chargerAccueil = () => import('./pages/Accueil')
const chargerJournee = () => import('./pages/Journee')
const chargerCoulisses = () => import('./pages/Coulisses')
const chargerCompte = () => import('./pages/Compte')
const chargerAgenda = () => import('./pages/Agenda')
const Accueil = lazy(chargerAccueil)
const Journee = lazy(chargerJournee)
const Coulisses = lazy(chargerCoulisses)
const Compte = lazy(chargerCompte)
const Agenda = lazy(chargerAgenda)
const PRECHARGER: Record<string, () => Promise<unknown>> = { journee: chargerJournee, coulisses: chargerCoulisses, compte: chargerCompte, agenda: chargerAgenda }

/** Repli discret pendant le chargement d'un écran (en pratique quelques dizaines de millisecondes). */
function Repli() {
  return (
    <div role="status" className="grid min-h-[60vh] place-items-center text-brume">
      <Loader2 size={20} className="animate-spin opacity-60 [animation-delay:200ms]" aria-hidden />
      <span className="sr-only">Chargement...</span>
    </div>
  )
}
import { useTheme } from './theme'
import { cn } from '@/lib/utils'

type Onglet = 'journee' | 'coulisses' | 'compte' | 'agenda'
/** Ma journée ouverte sur un jour précis, avec un rendez-vous déjà sélectionné (depuis l'agenda). */
export type CibleJournee = { jour: string; rid: string }
const CLE_MODE = 'preparateur-mode'
function modeInitial(): Mode {
  let m: Mode = 'qualifie'
  try { if (localStorage.getItem(CLE_MODE) === 'prospection') m = 'prospection' } catch { /* rien */ }
  document.documentElement.dataset.mode = m
  return m
}
const ONGLETS: { id: Onglet; libelle: string; icone: typeof Workflow }[] = [
  { id: 'journee', libelle: 'Ma journée', icone: CalendarDays },
  { id: 'coulisses', libelle: 'Workflow', icone: Workflow },
]

export default function App() {
  const [accueil, setAccueil] = useState(true)
  const [onglet, setOnglet] = useState<Onglet>('journee')
  const [rdvCoulisses, setRdvCoulisses] = useState<string | null>(null)
  const [crm, setCrm] = useState<InfoCRM | null>(null)
  const [tel, setTel] = useState<Telephone | null>(null)
  const [claude, setClaude] = useState<EtatClaude | null>(null)
  const [prenom, setPrenom] = useState('')
  const [mode, setMode] = useState<Mode>(modeInitial)
  const [cibleJournee, setCibleJournee] = useState<CibleJournee | null>(null)
  const [jourAgenda, setJourAgenda] = useState<string | null>(null)
  const [rdvAujourdhui, setRdvAujourdhui] = useState(0)

  const [annonce, setAnnonce] = useState('')

  const changerMode = (m: Mode) => {
    if (m === mode) return
    document.documentElement.dataset.mode = m
    try { localStorage.setItem(CLE_MODE, m) } catch { /* rien */ }
    setMode(m)
    setRdvCoulisses(null)
    if (onglet === 'compte') setOnglet('journee')
    setAnnonce(m === 'prospection' ? 'Espace Prospection : les nouveaux clients à conquérir.' : 'Espace Qualifiés : les clients déjà dans votre CRM.')
  }

  // le CRM dépend du mode : on le relit à chaque changement, et on abandonne la requête de l'ancien mode
  useEffect(() => {
    const c = new AbortController()
    creerApi(mode).api.crm(c.signal).then(setCrm).catch(() => {})
    return () => c.abort()
  }, [mode])

  useEffect(() => {
    const c = new AbortController()
    creerApi('qualifie').api.telephone(c.signal).then(setTel).catch(() => {})
    compte.etat(c.signal).then(setClaude).catch(() => {})
    compte.profil(c.signal).then((p) => setPrenom(p.prenom)).catch(() => {})
    return () => c.abort()
  }, [])

  // pastille du bouton agenda : les rendez-vous d'aujourd'hui, tous types confondus (jour du serveur, qui peut être simulé)
  useEffect(() => {
    if (accueil) return
    let c = new AbortController()
    const lire = () => {
      c.abort(); c = new AbortController()
      const d = new Date(), j = (n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
      agenda.complet(j(-3), j(3), c.signal).then((r) => {
        if (r.aujourdhui < j(-3) || r.aujourdhui > j(3)) return agenda.complet(r.aujourdhui, r.aujourdhui, c.signal)
        return r
      }).then((r) => setRdvAujourdhui(r.rendez_vous.filter((x) => x.jour === r.aujourdhui).length)).catch(() => {})
    }
    lire()
    const t = window.setInterval(lire, 60000)
    const auRetour = () => { if (document.visibilityState === 'visible') lire() }
    window.addEventListener('focus', auRetour)
    return () => { window.clearInterval(t); window.removeEventListener('focus', auRetour); c.abort() }
  }, [accueil])

  const ouvrirAgenda = (jour: string | null = null) => { setJourAgenda(jour); setOnglet('agenda'); window.scrollTo(0, 0) }
  // depuis l'agenda : le bon espace (Qualifiés ou Prospection), Ma journée sur ce jour, ce rendez-vous sélectionné
  const ouvrirDansJournee = (r: RdvAgenda) => {
    const m: Mode = r.type === 'prospect' ? 'prospection' : 'qualifie'
    if (m !== mode) {
      document.documentElement.dataset.mode = m
      try { localStorage.setItem(CLE_MODE, m) } catch { /* rien */ }
      setMode(m)
      setRdvCoulisses(null)
    }
    setCibleJournee({ jour: r.jour, rid: r.id })
    setOnglet('journee')
    setAnnonce(`Ma journée, ${r.entreprise} à ${r.heure}.`)
    window.scrollTo(0, 0)
  }

  const entrer = () => {
    setAccueil(false)
    window.scrollTo(0, 0)
    // première ouverture sur un ordinateur sans compte Claude connecté : on va directement à « Mon compte »
    if (claude && !claude.connecte) setOnglet('compte')
  }

  // pendant l'accueil, Ma journée se charge en arrière-plan, puis le reste quand le navigateur est libre
  useEffect(() => {
    if (!accueil) return
    chargerJournee().catch(() => {})
    const ric = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const plus_tard = () => { chargerCoulisses().catch(() => {}); chargerCompte().catch(() => {}); chargerAgenda().catch(() => {}) }
    const t = ric ? ric(plus_tard, { timeout: 6000 }) : window.setTimeout(plus_tard, 4000)
    return () => { if (!ric) window.clearTimeout(t) }
  }, [accueil])

  if (accueil) return (
    <FournisseurMode value={mode}>
      <Suspense fallback={<div className="min-h-screen bg-encre" />}><Accueil onEntrer={entrer} /></Suspense>
    </FournisseurMode>
  )

  return (
    // Pas de filter ni de transform ici ni sur l'onglet : ils casseraient les éléments en position fixe (fenêtres, barre du bas).
    <MotionConfig reducedMotion="user">
    <FournisseurMode value={mode}>
    <motion.div className="min-h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
      <div role="status" aria-live="polite" className="sr-only">{annonce}</div>
      <header className="sticky top-0 z-30 border-b border-white/60 bg-white/45 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-4 py-3 sm:px-6">
          <button onClick={() => setAccueil(true)} title="Revenir à l’accueil" className="group flex items-center gap-4">
            <img src="/logo-noir.svg" alt="Préparateur" className="logo-clair h-6 w-auto transition group-hover:scale-105 group-hover:opacity-70" />
            <img src="/logo-blanc.svg" alt="" aria-hidden className="logo-sombre h-6 w-auto transition group-hover:scale-105 group-hover:opacity-70" />
            <span className="hidden h-5 w-px bg-nuage md:block" />
            <span className="hidden text-[15px] font-semibold tracking-tight text-encre md:block">Préparateur de visite</span>
          </button>
          <BasculeMode mode={mode} onChanger={changerMode} />
          <nav className="mx-auto flex rounded-full border border-nuage bg-white p-1">
            <AnimatedBackground defaultValue={onglet === 'compte' || onglet === 'agenda' ? '' : onglet} onValueChange={(v) => v && setOnglet(v as Onglet)}
              className="rounded-full bg-encre" transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}>
              {ONGLETS.map((o) => (
                <button key={o.id} data-id={o.id} type="button" aria-current={onglet === o.id ? 'page' : undefined}
                  onPointerEnter={() => PRECHARGER[o.id]?.().catch(() => {})}
                  className="flex items-center gap-2 px-4 py-1.5 text-sm text-ardoise transition-colors data-[checked=true]:text-white">
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <o.icone size={15} /> {o.libelle}
                  </span>
                </button>
              ))}
            </AnimatedBackground>
          </nav>
          <BoutonAgenda actif={onglet === 'agenda'} nombre={rdvAujourdhui} onOuvrir={() => ouvrirAgenda()} />
          <BoutonTheme />
          <button onClick={() => setOnglet('compte')} onPointerEnter={() => chargerCompte().catch(() => {})} title="Mon compte" className="flex items-center gap-2 rounded-full border border-white/70 bg-white/60 py-1 pr-3.5 pl-1 text-[13px] text-encre transition hover:border-lavande">
            <span className="relative grid size-7 place-items-center rounded-full bg-gradient-to-br from-violet-vif to-violet-profond text-xs font-semibold text-white">
              {prenom ? prenom.charAt(0).toUpperCase() : <UserRound size={14} />}
              <span className={cn('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-white', claude?.connecte && crm?.ok ? 'bg-ok' : 'bg-alerte')} />
            </span>
            <span className="hidden font-semibold sm:inline">{prenom || 'Mon compte'}</span>
          </button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        <motion.div key={onglet === 'agenda' ? 'agenda' : `${mode}-${onglet}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <FournisseurMode value={mode}>
          <Suspense fallback={<Repli />}>
          {onglet === 'journee' && <Journee crm={crm} onCrm={setCrm} versCompte={() => setOnglet('compte')} versCoulisses={(rid) => { setRdvCoulisses(rid); setOnglet('coulisses') }}
            cible={cibleJournee} onCibleLue={() => setCibleJournee(null)} versAgenda={(jour) => ouvrirAgenda(jour)} />}
          {onglet === 'agenda' && <Agenda jourInitial={jourAgenda} onOuvrirJournee={ouvrirDansJournee} />}
          {onglet === 'coulisses' && <Coulisses rdvCible={rdvCoulisses} />}
          {onglet === 'compte' && <Compte tel={tel} crm={crm} onCrm={setCrm} onPrenom={setPrenom} />}
          </Suspense>
          </FournisseurMode>
        </motion.div>
      </AnimatePresence>

    </motion.div>
    </FournisseurMode>
    </MotionConfig>
  )
}

/** Qualifiés (clients déjà dans le CRM) ou Prospection (CRM de prospection) : toute l'appli suit ce choix.
    Groupe de boutons radio : une seule tabulation, puis les flèches pour passer de l'un à l'autre. */
function BasculeMode({ mode, onChanger }: { mode: Mode; onChanger: (m: Mode) => void }) {
  const choix: { id: Mode; libelle: string; aide: string }[] = [
    { id: 'qualifie', libelle: 'Qualifiés', aide: 'Les clients déjà dans votre CRM' },
    { id: 'prospection', libelle: 'Prospection', aide: 'Les nouveaux clients à conquérir' },
  ]
  const groupe = useRef<HTMLDivElement>(null)
  const clavier = (e: React.KeyboardEvent) => {
    const i = choix.findIndex((c) => c.id === mode)
    const pas = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    const cible = e.key === 'Home' ? 0 : e.key === 'End' ? choix.length - 1 : pas ? (i + pas + choix.length) % choix.length : -1
    if (cible < 0) return
    e.preventDefault()
    onChanger(choix[cible].id)
    requestAnimationFrame(() => groupe.current?.querySelector<HTMLElement>(`[data-id="${choix[cible].id}"]`)?.focus())
  }
  return (
    <div ref={groupe} role="radiogroup" aria-label="Type de rendez-vous" onKeyDown={clavier} className="flex shrink-0 rounded-full border border-nuage bg-white p-1">
      <AnimatedBackground defaultValue={mode} onValueChange={(v) => v && onChanger(v as Mode)}
        className="rounded-full bg-violet" transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}>
        {choix.map((c) => (
          <button key={c.id} data-id={c.id} type="button" role="radio" aria-checked={mode === c.id} tabIndex={mode === c.id ? 0 : -1}
            aria-label={`${c.libelle} : ${c.aide}`} title={c.aide}
            className="px-3.5 py-1.5 text-[13px] font-semibold text-ardoise transition-colors data-[checked=true]:text-white">
            {c.libelle}
          </button>
        ))}
      </AnimatedBackground>
    </div>
  )
}

/** Mon agenda : bouton rond comme le soleil-lune, avec le nombre de rendez-vous du jour. */
function BoutonAgenda({ actif, nombre, onOuvrir }: { actif: boolean; nombre: number; onOuvrir: () => void }) {
  const libelle = `Mon agenda${nombre ? `, ${nombre} rendez-vous aujourd’hui` : ''}`
  return (
    <button type="button" onClick={onOuvrir} onPointerEnter={() => chargerAgenda().catch(() => {})}
      aria-label={libelle} title="Mon agenda" aria-current={actif ? 'page' : undefined}
      className={cn('relative grid size-9 shrink-0 place-items-center rounded-full border transition',
        actif ? 'border-encre bg-encre text-white' : 'border-white/70 bg-white/60 text-encre hover:border-lavande')}>
      <CalendarRange size={16} />
      <AnimatePresence initial={false}>
        {nombre > 0 && (
          <motion.span key="pastille" aria-hidden initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="absolute -top-1.5 -right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#5723F3] px-1 text-[12px] leading-none font-semibold text-white ring-2 ring-white tabular-nums">
            {nombre}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  )
}

/** Bascule clair / sombre : le soleil et la lune tournent l'un dans l'autre ; l'écran change en cercle depuis le bouton. */
function BoutonTheme() {
  const { theme, basculer } = useTheme()
  const sombre = theme === 'sombre'
  return (
    <button type="button" role="switch" aria-checked={sombre} aria-label="Mode sombre" title={sombre ? 'Passer en mode clair' : 'Passer en mode sombre'}
      onClick={(e) => basculer(e.currentTarget)}
      className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-white/70 bg-white/60 text-encre transition hover:border-lavande">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={theme} className="grid"
          initial={{ opacity: 0, transform: 'rotate(-90deg) scale(0.6)'}}
          animate={{ opacity: 1, transform: 'rotate(0deg) scale(1)'}}
          exit={{ opacity: 0, transform: 'rotate(90deg) scale(0.6)'}}
          transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}>
          {sombre ? <Moon size={16} /> : <Sun size={16} />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}
