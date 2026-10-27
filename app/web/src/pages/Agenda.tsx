import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import {
  AlertTriangle, ArrowRight, BookOpen, CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, ExternalLink,
  ChevronDown, Headphones, MapPin, Pause, Play, RotateCcw, RotateCw, Sparkles, UserRound, Video, X, Briefcase, CalendarX,
} from 'lucide-react'
import { agenda as apiAgenda, type AgendaComplet, type RdvAgenda, type TypeRdv } from '../api'
import { AnimatedBackground } from '@/components/motion-primitives/animated-background'
import { cn } from '@/lib/utils'

/* Mon agenda : tous les rendez-vous, clients qualifiés et prospects, sur une semaine ou un mois.
   Les couleurs ne suivent pas le bouton Qualifiés / Prospection : violet = client, corail = prospect (voir index.css, « Mon agenda »). */

type Vue = 'jour' | 'semaine' | 'mois'
type Filtre = 'tous' | 'qualifie' | 'prospect'
const CLE_FILTRE = 'preparateur-agenda-filtre'
const CLE_VUE = 'preparateur-agenda-vue'
const EASE = [0.23, 1, 0.32, 1] as const
const NBSP = ' '

function lire<T extends string>(cle: string, permis: readonly T[], defaut: T): T {
  try { const v = localStorage.getItem(cle) as T | null; return v && permis.includes(v) ? v : defaut } catch { return defaut }
}
function ecrire(cle: string, v: string) { try { localStorage.setItem(cle, v) } catch { /* rien */ } }

/* ------------------------------------------------------------------ dates (chaînes AAAA-MM-JJ, calcul en UTC : pas de piège d'heure d'été) */
const enDate = (s: string) => new Date(`${s}T00:00:00Z`)
const enTexte = (d: Date) => d.toISOString().slice(0, 10)
const plusJours = (s: string, n: number) => { const d = enDate(s); d.setUTCDate(d.getUTCDate() + n); return enTexte(d) }
const lundiDe = (s: string) => plusJours(s, -((enDate(s).getUTCDay() + 6) % 7))
const premierDuMois = (s: string) => `${s.slice(0, 7)}-01`
const dernierDuMois = (s: string) => { const d = enDate(premierDuMois(s)); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return enTexte(d) }
const plusMois = (s: string, n: number) => { const d = enDate(premierDuMois(s)); d.setUTCMonth(d.getUTCMonth() + n); return enTexte(d) }
const aujourdhuiLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
const numJour = (s: string) => { const n = enDate(s).getUTCDate(); return n === 1 ? '1er' : String(n) }
const moisDe = (s: string) => MOIS[enDate(s).getUTCMonth()]
const majuscule = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const jourLong = (s: string) => `${majuscule(JOURS[enDate(s).getUTCDay()])} ${numJour(s)} ${moisDe(s)}`

function libellePeriode(vue: Vue, debut: string, fin: string) {
  if (vue === 'mois') return `${majuscule(moisDe(debut))} ${debut.slice(0, 4)}`
  if (vue === 'jour') return jourLong(debut)
  const memeAn = debut.slice(0, 4) === fin.slice(0, 4)
  if (debut.slice(0, 7) === fin.slice(0, 7)) return `Semaine du ${numJour(debut)} au ${numJour(fin)} ${moisDe(fin)}`
  return `Semaine du ${numJour(debut)} ${moisDe(debut)}${memeAn ? '' : ` ${debut.slice(0, 4)}`} au ${numJour(fin)} ${moisDe(fin)}${memeAn ? '' : ` ${fin.slice(0, 4)}`}`
}

/** « 10h », « 17h45 » → heures décimales. */
const heureDe = (h: string) => { const m = /(\d{1,2})h(\d{0,2})/.exec(h); return m ? Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0) : NaN }
function plage(r: RdvAgenda) {
  const d = r.debut.slice(11, 16)
  const debut = Number(d.slice(0, 2)) + Number(d.slice(3, 5)) / 60
  let fin = heureDe(r.heure_fin)
  if (!Number.isFinite(fin) || fin <= debut) fin = debut + 1
  return { debut, fin }
}

const LIBELLE_TYPE: Record<TypeRdv, string> = { qualifie: 'Client qualifié', prospect: 'Prospect', agenda: 'Ajouté à votre agenda' }
const LIBELLE_ETAPE: Record<string, string> = { Lead: 'Contact repéré' }
const libEtape = (e: string | null) => (e ? LIBELLE_ETAPE[e] ?? e : '')

type Etat = 'prete' | 'preparation' | 'a_preparer' | 'passe' | 'hors_crm'
function etatDe(r: RdvAgenda): Etat {
  if (r.type === 'agenda') return 'hors_crm'
  if (r.fiche.prete) return 'prete'
  if (r.en_preparation) return 'preparation'
  return r.passe ? 'passe' : 'a_preparer'
}
const LIBELLE_ETAT: Record<Etat, string> = { prete: 'Fiche prête', preparation: 'En préparation', a_preparer: 'À préparer', passe: 'Sans fiche', hors_crm: 'Absent du CRM' }

function IconeEtat({ etat, taille = 12 }: { etat: Etat; taille?: number }) {
  if (etat === 'prete') return <span aria-hidden className="grid shrink-0 place-items-center rounded-full bg-ok text-white" style={{ width: taille + 2, height: taille + 2 }}><Check size={taille - 3} strokeWidth={3.5} /></span>
  if (etat === 'preparation') return (
    <span aria-hidden className="relative flex shrink-0" style={{ width: taille - 3, height: taille - 3 }}>
      <span className="ag-point absolute inline-flex size-full animate-ping rounded-full opacity-60" />
      <span className="ag-point relative inline-flex size-full rounded-full" />
    </span>
  )
  if (etat === 'hors_crm') return <CalendarPlus aria-hidden size={taille} className="shrink-0" />
  return <span aria-hidden className={cn('shrink-0 rounded-full border-[1.5px]', etat === 'passe' ? 'border-brume/70' : 'border-current')} style={{ width: taille - 1, height: taille - 1 }} />
}

/* ================================================================== écran */

export default function Agenda({ jourInitial, onOuvrirJournee }: {
  jourInitial?: string | null
  onOuvrirJournee: (r: RdvAgenda) => void
}) {
  const reduit = useReducedMotion()
  const [vue, setVue] = useState<Vue>(() => (jourInitial ? 'semaine' : lire(CLE_VUE, ['jour', 'semaine', 'mois'] as const, 'semaine')))
  const [filtre, setFiltre] = useState<Filtre>(() => lire(CLE_FILTRE, ['tous', 'qualifie', 'prospect'] as const, 'tous'))
  const [ancre, setAncre] = useState<string>(() => jourInitial ?? aujourdhuiLocal())
  const navigue = useRef(!!jourInitial)
  const [sens, setSens] = useState(0)
  const [donnees, setDonnees] = useState<Record<string, AgendaComplet>>({})
  const [erreur, setErreur] = useState<string | null>(null)
  const [selection, setSelection] = useState<string | null>(null)
  const [nouveaux, setNouveaux] = useState<Set<string>>(new Set())
  const connus = useRef<Record<string, Set<string>>>({})
  const [annonce, setAnnonce] = useState('')

  // période affichée, et période demandée au serveur (le mois va du lundi de la 1re semaine au dimanche de la dernière)
  const periode = useMemo(() => {
    if (vue === 'jour') return { debut: ancre, fin: ancre, grilleDebut: ancre, grilleFin: ancre }
    if (vue === 'semaine') { const d = lundiDe(ancre); return { debut: d, fin: plusJours(d, 6), grilleDebut: d, grilleFin: plusJours(d, 6) } }
    const d = premierDuMois(ancre), f = dernierDuMois(ancre)
    return { debut: d, fin: f, grilleDebut: lundiDe(d), grilleFin: plusJours(lundiDe(f), 6) }
  }, [vue, ancre])
  const cle = `${periode.grilleDebut}|${periode.grilleFin}`
  const courant = donnees[cle] ?? null
  const donneesRef = useRef(donnees)
  donneesRef.current = donnees
  const aujourdhui = courant?.aujourdhui ?? Object.values(donnees)[0]?.aujourdhui ?? aujourdhuiLocal()

  /* ---------------------------------------------------------------- chargement : à l'ouverture, toutes les 30 s, au retour sur la fenêtre */
  const controleur = useRef<AbortController | null>(null)
  const charger = useCallback(() => {
    controleur.current?.abort()
    const c = new AbortController()
    controleur.current = c
    apiAgenda.complet(periode.grilleDebut, periode.grilleFin, c.signal).then((d) => {
      if (c.signal.aborted) return
      const avant = connus.current[cle]
      const ids = new Set(d.rendez_vous.map((r) => r.id))
      if (avant) {
        const neufs = d.rendez_vous.filter((r) => !avant.has(r.id)).map((r) => r.id)
        if (neufs.length) {
          setNouveaux((s) => new Set([...s, ...neufs]))
          setAnnonce(neufs.length > 1 ? `${neufs.length} nouveaux rendez-vous dans votre agenda.` : 'Un nouveau rendez-vous dans votre agenda.')
          window.setTimeout(() => setNouveaux((s) => { const n = new Set(s); neufs.forEach((x) => n.delete(x)); return n }), 4500)
        }
      }
      connus.current[cle] = ids
      setDonnees((s) => ({ ...s, [cle]: d }))
      setErreur(null)
      // première ouverture : on se cale sur le jour du serveur (il peut être simulé pour la démonstration)
      if (!navigue.current) {
        navigue.current = true
        if (d.aujourdhui && (d.aujourdhui < periode.grilleDebut || d.aujourdhui > periode.grilleFin)) setAncre(d.aujourdhui)
      }
    }).catch((e: Error) => { if (!c.signal.aborted) setErreur(e.message) })
  }, [cle, periode.grilleDebut, periode.grilleFin])

  // périodes voisines lues d'avance : passer à la semaine suivante est immédiat
  const voisines = useMemo(() => {
    const grilleMois = (m: string) => [lundiDe(premierDuMois(m)), plusJours(lundiDe(dernierDuMois(m)), 6)]
    const l = [-1, 1].map((pas) => {
      if (vue === 'jour') { const d = plusJours(ancre, pas); return [d, d] }
      if (vue === 'semaine') { const d = plusJours(lundiDe(ancre), 7 * pas); return [d, plusJours(d, 6)] }
      return grilleMois(plusMois(ancre, pas))
    })
    if (vue === 'semaine') l.push(grilleMois(ancre)) // le mois aussi : passer en vue Mois est immédiat
    return l
  }, [vue, ancre])
  useEffect(() => {
    if (!courant) return
    const c = new AbortController()
    voisines.forEach(([d, f]) => {
      const k = `${d}|${f}`
      if (donneesRef.current[k]) return
      apiAgenda.complet(d, f, c.signal).then((x) => {
        connus.current[k] ??= new Set(x.rendez_vous.map((r) => r.id))
        setDonnees((s) => (s[k] ? s : { ...s, [k]: x }))
      }).catch(() => {})
    })
    return () => c.abort()
  }, [voisines, courant])

  useEffect(() => {
    charger()
    const t = window.setInterval(charger, 30000)
    const auRetour = () => { if (document.visibilityState === 'visible') charger() }
    window.addEventListener('focus', auRetour)
    document.addEventListener('visibilitychange', auRetour)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('focus', auRetour)
      document.removeEventListener('visibilitychange', auRetour)
      controleur.current?.abort()
    }
  }, [charger])

  /* ---------------------------------------------------------------- navigation */
  const aller = useCallback((pas: number) => {
    navigue.current = true
    setSens(pas)
    setAncre((a) => (vue === 'jour' ? plusJours(a, pas) : vue === 'semaine' ? plusJours(lundiDe(a), 7 * pas) : plusMois(a, pas)))
  }, [vue])
  const versAujourdhui = useCallback(() => {
    navigue.current = true
    setSens(aujourdhui > ancre ? 1 : aujourdhui < ancre ? -1 : 0)
    setAncre(aujourdhui)
  }, [aujourdhui, ancre])
  const changerVue = (v: Vue) => { if (v === vue) return; setSens(0); setVue(v); ecrire(CLE_VUE, v) }
  const changerFiltre = (f: Filtre) => { if (f === filtre) return; setFiltre(f); ecrire(CLE_FILTRE, f) }
  const ouvrirSemaine = (jour: string) => { navigue.current = true; setSens(0); setAncre(jour); setVue('semaine'); ecrire(CLE_VUE, 'semaine') }

  // raccourcis clavier : ← → période, T aujourd'hui (Échap est géré par le panneau)
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (selection || e.metaKey || e.ctrlKey || e.altKey) return
      const cible = e.target instanceof HTMLElement ? e.target : null
      if (cible && (cible.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName) || cible.closest('[role="radiogroup"]'))) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); aller(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); aller(1) }
      else if (e.key === 't' || e.key === 'T') { e.preventDefault(); versAujourdhui() }
    }
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [aller, versAujourdhui, selection])

  /* ---------------------------------------------------------------- données affichées */
  const tous = useMemo(() => courant?.rendez_vous ?? [], [courant])
  const dansPeriode = useMemo(() => tous.filter((r) => r.jour >= periode.debut && r.jour <= periode.fin), [tous, periode])
  const compte = useMemo(() => ({
    tous: dansPeriode.length,
    qualifie: dansPeriode.filter((r) => r.type === 'qualifie').length,
    prospect: dansPeriode.filter((r) => r.type === 'prospect').length,
  }), [dansPeriode])
  const garde = useCallback((r: RdvAgenda) => filtre === 'tous' || r.type === filtre, [filtre])
  const visibles = useMemo(() => tous.filter(garde), [tous, garde])
  const visiblesPeriode = useMemo(() => dansPeriode.filter(garde), [dansPeriode, garde])
  const actif = selection ? tous.find((r) => r.id === selection) ?? null : null
  // le rendez-vous ouvert reste affiché même si un rechargement le fait disparaître un instant
  const dernierActif = useRef<RdvAgenda | null>(null)
  if (actif) dernierActif.current = actif
  const panneauRdv = selection ? actif ?? dernierActif.current : null

  const libelle = libellePeriode(vue, periode.debut, periode.fin)
  const contientAujourdhui = aujourdhui >= periode.debut && aujourdhui <= periode.fin
  const motVide = filtre === 'prospect' ? ' prospect' : filtre === 'qualifie' ? ' client' : ''
  const quand = vue === 'jour' ? (contientAujourdhui ? 'aujourd’hui' : 'ce jour-là') : vue === 'semaine' ? (contientAujourdhui ? 'cette semaine' : 'cette semaine-là') : (contientAujourdhui ? 'ce mois-ci' : 'ce mois-là')

  const decalage = reduit ? 0 : 28
  const variantes = {
    entre: (s: number) => ({ opacity: 0, x: s * decalage }),
    centre: { opacity: 1, x: 0 },
    sort: (s: number) => ({ opacity: 0, x: -s * decalage }),
  }

  return (
    <main className="mx-auto max-w-[1500px] px-4 pt-6 pb-16 sm:px-6">
      <div role="status" aria-live="polite" className="sr-only">{annonce}</div>

      {/* ------------------------------------------------------------ barre du haut */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[28px] leading-none font-semibold tracking-tight text-encre">Mon agenda</h1>
        </div>
        <div className="flex items-center gap-1.5">
          <BoutonRond label={vue === 'jour' ? 'Jour précédent' : vue === 'semaine' ? 'Semaine précédente' : 'Mois précédent'} onClick={() => aller(-1)}><ChevronLeft size={17} /></BoutonRond>
          <BoutonRond label={vue === 'jour' ? 'Jour suivant' : vue === 'semaine' ? 'Semaine suivante' : 'Mois suivant'} onClick={() => aller(1)}><ChevronRight size={17} /></BoutonRond>
        </div>
        <div className="relative min-w-[16rem] flex-1 overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false} custom={sens}>
            <motion.p key={libelle} custom={sens} aria-live="polite"
              initial={{ opacity: 0, y: reduit ? 0 : sens === 0 ? 6 : 0, x: reduit ? 0 : sens * 12 }} animate={{ opacity: 1, y: 0, x: 0 }}
              exit={{ opacity: 0, x: reduit ? 0 : -sens * 12 }} transition={{ duration: 0.2, ease: EASE }}
              className="titre truncate text-[22px] text-encre">
              {libelle}
            </motion.p>
          </AnimatePresence>
        </div>
        <MenuVue valeur={vue} onChanger={changerVue} />
      </div>

      {/* ------------------------------------------------------------ le filtre et la légende */}
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Segmente<Filtre> etiquette="Rendez-vous affichés" valeur={filtre} onChanger={changerFiltre}
          fond={filtre === 'qualifie' ? 'bg-[#5723F3]' : filtre === 'prospect' ? 'bg-[#C23A1E]' : 'bg-encre'}
          choix={[
            { id: 'tous', libelle: 'Tous', compte: courant ? compte.tous : undefined },
            { id: 'qualifie', libelle: 'Qualifiés', compte: courant ? compte.qualifie : undefined, point: 'ag-qualifie' },
            { id: 'prospect', libelle: 'Prospects', compte: courant ? compte.prospect : undefined, point: 'ag-prospect' },
          ]} />
      </div>

      {/* ------------------------------------------------------------ la grille */}
      <div className="relative mt-4 overflow-hidden rounded-[24px] border border-white/80 bg-white/70 shadow-panneau">
        <AnimatePresence mode="wait" initial={false} custom={sens}>
          <motion.div key={`${vue}-${cle}`} custom={sens} variants={variantes} initial="entre" animate="centre" exit="sort"
            transition={{ duration: 0.18, ease: EASE }}>
            {!courant ? (
              erreur ? <ErreurChargement message={erreur} onReessayer={charger} /> : <Squelette vue={vue} />
            ) : vue !== 'mois' ? (
              <GrilleSemaine debut={periode.debut} nbJours={vue === 'jour' ? 1 : 7} rdvs={visibles} aujourdhui={aujourdhui} horloge={courant.horloge}
                nouveaux={nouveaux} selection={selection} onChoisir={setSelection} />
            ) : (
              <GrilleMois mois={periode.debut} debut={periode.grilleDebut} fin={periode.grilleFin} rdvs={visibles} aujourdhui={aujourdhui}
                nouveaux={nouveaux} onJour={ouvrirSemaine} onChoisir={setSelection} />
            )}
          </motion.div>
        </AnimatePresence>

        <AnimatePresence>
          {courant && visiblesPeriode.length === 0 && (
            <motion.div key={`vide-${filtre}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="pointer-events-none absolute inset-0 grid place-items-center p-6">
              <div className="pointer-events-auto max-w-md rounded-[20px] border border-white/80 bg-white/95 p-6 text-center shadow-panneau">
                <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-voile text-violet"><CalendarX size={20} /></span>
                <p className="titre mt-3 text-xl text-encre">Aucun rendez-vous{motVide} {quand}</p>
                {filtre !== 'tous' && compte.tous > 0 ? (
                  <button type="button" onClick={() => changerFiltre('tous')}
                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-encre px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-profond">
                    Voir tous les rendez-vous ({compte.tous}) <ArrowRight size={15} />
                  </button>
                ) : (
                  <p className="mt-1 text-sm text-ardoise">Les rendez-vous ajoutés dans votre agenda Google apparaissent ici en quelques secondes.</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <PanneauRdv r={panneauRdv} ouvert={!!selection} onFermer={() => setSelection(null)} onJournee={onOuvrirJournee} />
    </main>
  )
}

/* ================================================================== vue semaine */

const H = 56 // pixels par heure

function GrilleSemaine({ debut, nbJours = 7, rdvs, aujourdhui, horloge, nouveaux, selection, onChoisir }: {
  debut: string; nbJours?: number; rdvs: RdvAgenda[]; aujourdhui: string; horloge: string; nouveaux: Set<string>; selection: string | null; onChoisir: (id: string) => void
}) {
  const jours = useMemo(() => Array.from({ length: nbJours }, (_, i) => plusJours(debut, i)), [debut, nbJours])
  const parJour = useMemo(() => {
    const m: Record<string, RdvAgenda[]> = {}
    jours.forEach((j) => { m[j] = [] })
    rdvs.forEach((r) => { if (m[r.jour]) m[r.jour].push(r) })
    return m
  }, [jours, rdvs])

  // axe des heures de 8h à 19h, élargi si un rendez-vous déborde
  const { hDebut, hFin } = useMemo(() => {
    let a = 8, b = 19
    jours.forEach((j) => parJour[j].forEach((r) => { const p = plage(r); a = Math.min(a, Math.floor(p.debut)); b = Math.max(b, Math.ceil(p.fin)) }))
    return { hDebut: Math.max(0, a), hFin: Math.min(24, b) }
  }, [jours, parJour])
  const heures = Array.from({ length: hFin - hDebut }, (_, i) => hDebut + i)
  const hauteur = (hFin - hDebut) * H

  const colonnes = jours.map((j, i) => (i >= 5 && parJour[j].length === 0 ? 'minmax(0,0.5fr)' : 'minmax(0,1fr)')).join(' ')
  const gabarit = { gridTemplateColumns: `3.25rem ${colonnes}` }

  // l'heure actuelle avance d'elle-même entre deux rechargements (l'horloge du serveur peut être simulée)
  const [maintenant, setMaintenant] = useState(() => ({ base: horloge, lu: Date.now() }))
  const [, tic] = useState(0)
  useEffect(() => { setMaintenant({ base: horloge, lu: Date.now() }) }, [horloge])
  useEffect(() => { const t = window.setInterval(() => tic((n) => n + 1), 60000); return () => window.clearInterval(t) }, [])
  const hb = Number(maintenant.base.slice(11, 13)) + Number(maintenant.base.slice(14, 16)) / 60
  const heureMaintenant = hb + (Date.now() - maintenant.lu) / 3600000


  return (
    <div>
      {/* en-tête des jours */}
      <div className="grid border-b border-nuage" style={gabarit}>
        <div />
        {jours.map((j) => {
          const d = enDate(j)
          const auj = j === aujourdhui, passe = j < aujourdhui
          return (
            <div key={j} className={cn('flex items-baseline justify-center gap-1.5 border-l border-nuage/70 px-1 py-3', auj && 'bg-white/80', passe && 'opacity-55')}>
              <span className={cn('text-[12px] tracking-wide uppercase', auj ? 'font-semibold text-encre' : 'text-ardoise')}>{JOURS_COURTS[d.getUTCDay()]}</span>
              <span className={cn('chiffre grid min-w-8 place-items-center rounded-full text-[19px] leading-8', auj ? 'ag-pastille-jour px-1.5 font-semibold' : 'text-encre')}
                aria-current={auj ? 'date' : undefined}>
                {d.getUTCDate()}
              </span>
              {auj && <span className="sr-only">aujourd’hui</span>}
            </div>
          )
        })}
      </div>

      {/* corps : heures et rendez-vous */}
      <div className="grid" style={gabarit}>
        <div className="relative" style={{ height: hauteur }} aria-hidden>
          {heures.map((h, i) => (
            <span key={h} className="chiffre absolute right-2 -translate-y-1/2 text-[12px] text-brume tabular-nums" style={{ top: i * H }}>
              {i === 0 ? '' : `${h}h`}
            </span>
          ))}
        </div>
        <LayoutGroup>
          {jours.map((j) => {
            const auj = j === aujourdhui, passe = j < aujourdhui
            const places = placer(parJour[j])
            return (
              <div key={j} role="group" aria-label={jourLong(j)} className={cn('relative border-l border-nuage/70', auj && 'bg-white/80')} style={{ height: hauteur }}>
                {heures.map((h, i) => i > 0 && <div key={h} aria-hidden className="absolute inset-x-0 border-t border-nuage/70" style={{ top: i * H }} />)}
                {heures.map((h, i) => <div key={`d${h}`} aria-hidden className="absolute inset-x-0 border-t border-dashed border-nuage/40" style={{ top: i * H + H / 2 }} />)}
                <AnimatePresence initial={false}>
                  {places.map(({ r, col, cols }) => {
                    const p = plage(r)
                    return (
                      <CarteSemaine key={r.id} r={r} haut={(p.debut - hDebut) * H} haute={(p.fin - p.debut) * H}
                        gauche={col / cols} largeur={1 / cols} attenue={passe || r.passe} nouveau={r.nouveau || nouveaux.has(r.id)}
                        actif={selection === r.id} onChoisir={() => onChoisir(r.id)} />
                    )
                  })}
                </AnimatePresence>
                {auj && heureMaintenant >= hDebut && heureMaintenant <= hFin && (
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20" style={{ top: (heureMaintenant - hDebut) * H }}>
                    <div className="ag-maintenant h-[2px] w-full rounded-full" />
                    <div className="ag-maintenant absolute -top-[4px] -left-[5px] size-2.5 rounded-full ring-2 ring-white" />
                  </div>
                )}
              </div>
            )
          })}
        </LayoutGroup>
      </div>
    </div>
  )
}

/** Rendez-vous qui se chevauchent : ils se partagent la largeur de la colonne. */
function placer(rdvs: RdvAgenda[]) {
  const tries = [...rdvs].sort((a, b) => plage(a).debut - plage(b).debut || plage(b).fin - plage(a).fin)
  const sortie: { r: RdvAgenda; col: number; cols: number }[] = []
  let groupe: { r: RdvAgenda; col: number; fin: number }[] = []
  let finGroupe = -1
  const clore = () => {
    const cols = Math.max(1, ...groupe.map((g) => g.col + 1))
    groupe.forEach((g) => sortie.push({ r: g.r, col: g.col, cols }))
    groupe = []
  }
  for (const r of tries) {
    const p = plage(r)
    if (groupe.length && p.debut >= finGroupe) clore()
    const finsParCol: number[] = []
    groupe.forEach((g) => { finsParCol[g.col] = Math.max(finsParCol[g.col] ?? -1, g.fin) })
    let col = 0
    while (finsParCol[col] !== undefined && finsParCol[col] > p.debut) col++
    groupe.push({ r, col, fin: p.fin })
    finGroupe = Math.max(finGroupe, p.fin)
  }
  if (groupe.length) clore()
  return sortie
}

function CarteSemaine({ r, haut, haute, gauche, largeur, attenue, nouveau, actif, onChoisir }: {
  r: RdvAgenda; haut: number; haute: number; gauche: number; largeur: number; attenue: boolean; nouveau: boolean; actif: boolean; onChoisir: () => void
}) {
  const etat = etatDe(r)
  const h = Math.max(haute - 3, 24)
  const grand = h >= 74, moyen = h >= 40
  const detail = `${r.entreprise}, ${LIBELLE_TYPE[r.type].toLowerCase()}, ${jourLong(r.jour)} de ${r.heure} à ${r.heure_fin}${r.contact ? `, avec ${r.contact}` : ''}, ${LIBELLE_ETAT[etat].toLowerCase()}${r.type === 'prospect' && r.etape ? `, étape ${libEtape(r.etape)}` : ''}`
  return (
    <motion.button type="button" layout data-rdv={r.id} onClick={onChoisir} aria-label={detail} aria-haspopup="dialog"
      initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: attenue ? 0.62 : 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.24, ease: EASE, layout: { duration: 0.28, ease: EASE } }}
      className={cn(`ag-${r.type} ag-fond group absolute z-10 overflow-hidden rounded-[10px] text-left transition-colors hover:z-30 focus-visible:z-30`,
        nouveau && 'ag-nouveau', actif && 'ag-actif z-30')}
      style={{ top: haut + 1, height: h, left: `calc(${gauche * 100}% + 3px)`, width: `calc(${largeur * 100}% - 6px)` }}>
      {r.type !== 'agenda' && <span aria-hidden className="ag-point absolute inset-y-0 left-0 w-[3px]" />}
      <span className={cn('flex h-full min-w-0 flex-col pr-1.5 pl-2.5 *:shrink-0', grand ? 'py-1.5' : 'justify-center py-0.5')}>
        {moyen ? (
          <>
            <span className="flex min-w-0 items-baseline gap-1.5 leading-4">
              <span className="ag-texte shrink-0 text-[12px] font-semibold tabular-nums">{r.heure}</span>
              {!grand && <span className="truncate text-[13px] font-semibold text-encre">{r.entreprise}</span>}
              {nouveau && <span className="ag-point ml-auto shrink-0 rounded-full px-1.5 text-[12px] leading-[18px] font-semibold text-white">Nouveau</span>}
            </span>
            {grand && <span className="truncate text-[14px] leading-[19px] font-semibold text-encre">{r.entreprise}</span>}
            {grand && r.contact && h >= 78 && <span className="truncate text-[12px] leading-4 text-ardoise">{r.contact}</span>}
            <span className="ag-texte mt-auto flex min-w-0 items-center gap-1.5 text-[12px] leading-4">
              <IconeEtat etat={etat} />
              <span className="truncate">{LIBELLE_ETAT[etat]}{r.type === 'prospect' && r.etape && !(grand && h >= 96) ? ` · ${libEtape(r.etape)}` : ''}</span>
            </span>
            {grand && r.type === 'prospect' && r.etape && h >= 96 && (
              <span className="truncate text-[12px] text-ardoise">{libEtape(r.etape)}</span>
            )}
          </>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="ag-texte shrink-0 text-[12px] font-semibold tabular-nums">{r.heure}</span>
            <span className="truncate text-[12px] font-semibold text-encre">{r.entreprise}</span>
            <span className="ag-texte ml-auto"><IconeEtat etat={etat} /></span>
          </span>
        )}
      </span>
    </motion.button>
  )
}

/* ================================================================== vue mois */

function GrilleMois({ mois, debut, fin, rdvs, aujourdhui, nouveaux, onJour, onChoisir }: {
  mois: string; debut: string; fin: string; rdvs: RdvAgenda[]; aujourdhui: string; nouveaux: Set<string>
  onJour: (j: string) => void; onChoisir: (id: string) => void
}) {
  const jours = useMemo(() => {
    const t: string[] = []
    for (let j = debut; j <= fin; j = plusJours(j, 1)) t.push(j)
    return t
  }, [debut, fin])
  const parJour = useMemo(() => {
    const m: Record<string, RdvAgenda[]> = {}
    rdvs.forEach((r) => { (m[r.jour] ??= []).push(r) })
    Object.values(m).forEach((l) => l.sort((a, b) => a.debut.localeCompare(b.debut)))
    return m
  }, [rdvs])
  const moisCourant = mois.slice(0, 7)
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-nuage">
        {['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map((j) => (
          <div key={j} className="px-3 py-2.5 text-[12px] tracking-wide text-ardoise uppercase">{j}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {jours.map((j, i) => {
          const liste = parJour[j] ?? []
          const dehors = j.slice(0, 7) !== moisCourant
          const auj = j === aujourdhui, passe = j < aujourdhui
          const visibles = liste.slice(0, 3)
          return (
            <div key={j} className={cn('group relative min-h-[104px] border-nuage/70 p-1.5 transition-colors', i % 7 && 'border-l', i >= 7 && 'border-t',
              auj && 'bg-white/80', dehors && 'bg-nuage/25')}>
              <button type="button" onClick={() => onJour(j)}
                aria-label={`${jourLong(j)}${liste.length ? `, ${liste.length} rendez-vous` : ', aucun rendez-vous'}${NBSP}: voir la semaine`}
                className="absolute inset-0 rounded-none transition-colors hover:bg-voile/50 focus-visible:-outline-offset-2" />
              <div className={cn('pointer-events-none relative flex items-center justify-between px-1', (dehors || passe) && 'opacity-55')}>
                <span className={cn('chiffre grid min-w-7 place-items-center rounded-full text-[15px] leading-7', auj ? 'ag-pastille-jour px-1 font-semibold' : 'text-encre')}>
                  {enDate(j).getUTCDate() === 1 ? `1er` : enDate(j).getUTCDate()}
                </span>
                {enDate(j).getUTCDate() === 1 && <span className="text-[12px] text-ardoise">{MOIS_COURTS[enDate(j).getUTCMonth()]}</span>}
              </div>
              <ul className="relative mt-1 space-y-1">
                <AnimatePresence initial={false}>
                  {visibles.map((r) => (
                    <motion.li key={r.id} layout initial={{ opacity: 0, y: 3 }} animate={{ opacity: passe || dehors ? 0.62 : 1, y: 0 }} exit={{ opacity: 0 }}
                      transition={{ duration: 0.2, ease: EASE }}>
                      <button type="button" onClick={() => onChoisir(r.id)} aria-haspopup="dialog"
                        aria-label={`${r.entreprise}, ${LIBELLE_TYPE[r.type].toLowerCase()}, ${r.heure}, ${LIBELLE_ETAT[etatDe(r)].toLowerCase()}`}
                        className={cn(`ag-${r.type} ag-fond relative flex w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md py-0.5 pr-1.5 pl-2 text-left text-[12px]`,
                          (r.nouveau || nouveaux.has(r.id)) && 'ag-nouveau')}>
                        {r.type !== 'agenda' && <span aria-hidden className="ag-point absolute inset-y-0 left-0 w-[3px]" />}
                        <span className="ag-texte shrink-0 font-semibold tabular-nums">{r.heure}</span>
                        <span className="truncate font-medium text-encre">{r.entreprise}</span>
                        {r.fiche.prete && <Check aria-hidden size={12} strokeWidth={3} className="ml-auto shrink-0 text-ok" />}
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
                {liste.length > 3 && (
                  <li className="pointer-events-none px-2 text-[12px] font-semibold text-ardoise">+{liste.length - 3}</li>
                )}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ================================================================== panneau latéral */

function PanneauRdv({ r, ouvert, onFermer, onJournee }: { r: RdvAgenda | null; ouvert: boolean; onFermer: () => void; onJournee: (r: RdvAgenda) => void }) {
  const reduit = useReducedMotion()
  const [lecture, setLecture] = useState(false)
  const [ecoute, setEcoute] = useState(false)
  const boite = useRef<HTMLDivElement>(null)
  const retour = useRef<HTMLElement | null>(null)
  const rid = r?.id

  // nouveau rendez-vous : on revient aux informations
  useEffect(() => { setLecture(false); setEcoute(false) }, [rid])

  // focus : on le place dans le panneau à l'ouverture, on le rend à l'élément d'origine à la fermeture
  useLayoutEffect(() => {
    if (!ouvert) return
    retour.current = document.activeElement as HTMLElement | null
    const t = window.setTimeout(() => boite.current?.querySelector<HTMLElement>('[data-premier]')?.focus(), 30)
    return () => {
      window.clearTimeout(t)
      const el = retour.current
      // après la sortie du panneau : sinon le focus retombe sur la page quand le panneau disparaît
      const rendre = () => {
        if (el && el !== document.body && document.contains(el)) el.focus()
        else if (rid) document.querySelector<HTMLElement>(`[data-rdv="${rid}"]`)?.focus()
      }
      rendre()
      window.setTimeout(rendre, 360)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert])

  const clavier = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onFermer(); return }
    if (e.key !== 'Tab' || !boite.current) return
    const f = [...boite.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null || x.tagName === 'IFRAME')
    if (!f.length) return
    const premier = f[0], dernier = f[f.length - 1]
    if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus() }
    else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus() }
  }

  // Échap ferme aussi quand le focus est dans la fiche (iframe) ou ailleurs dans la page
  useEffect(() => {
    if (!ouvert) return
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') onFermer() }
    window.addEventListener('keydown', echap)
    return () => window.removeEventListener('keydown', echap)
  }, [ouvert, onFermer])

  return createPortal(
    <AnimatePresence>
      {ouvert && r && (
        <motion.div key="voile" className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <div aria-hidden className="absolute inset-0 bg-[#120A29]/25" onClick={onFermer} />
          <motion.div ref={boite} role="dialog" aria-modal="true" aria-labelledby="panneau-rdv-titre" onKeyDown={clavier}
            initial={{ x: reduit ? 0 : '100%' }} animate={{ x: 0, width: lecture ? 'min(940px, calc(100vw - 32px))' : 'min(480px, 100vw)' }} exit={{ x: reduit ? 0 : '100%' }}
            transition={{ x: { duration: 0.32, ease: [0.32, 0.72, 0, 1] }, width: { duration: 0.3, ease: EASE } }}
            className={cn(`ag-${r.type} absolute inset-y-0 right-0 flex flex-col border-l border-white/80 bg-white shadow-[-30px_0_60px_-40px_rgba(18,10,41,0.45)]`)}>
            {lecture && r.fiche.page ? (
              <LectureFiche r={r} onRetour={() => setLecture(false)} onFermer={onFermer} />
            ) : (
              <InfosRdv r={r} ecoute={ecoute} onEcouter={() => setEcoute(true)} onLire={() => setLecture(true)} onFermer={onFermer} onJournee={() => onJournee(r)} />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function EnteteType({ r }: { r: RdvAgenda }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold', r.type === 'agenda' ? 'border border-dashed border-brume/70 text-ardoise' : 'ag-fond ag-texte')}>
        {r.type !== 'agenda' && <span aria-hidden className="ag-point size-2 rounded-full" />}
        {LIBELLE_TYPE[r.type]}
      </span>
      {r.type === 'prospect' && r.etape && <span className="rounded-full bg-creme px-2.5 py-1 text-[12px] font-semibold text-encre">{libEtape(r.etape)}</span>}
      {r.type === 'prospect' && r.rang && <span className="rounded-full px-1 py-1 text-[12px] text-ardoise">{r.rang}</span>}
    </div>
  )
}

function InfosRdv({ r, ecoute, onEcouter, onLire, onFermer, onJournee }: {
  r: RdvAgenda; ecoute: boolean; onEcouter: () => void; onLire: () => void; onFermer: () => void; onJournee: () => void
}) {
  const etat = etatDe(r)
  return (
    <>
      <div className="flex items-start justify-between gap-3 px-7 pt-6">
        <EnteteType r={r} />
        <button type="button" data-premier onClick={onFermer} aria-label="Fermer (Échap)" title="Fermer (Échap)"
          className="-mt-1 -mr-2 grid size-9 shrink-0 place-items-center rounded-full text-ardoise transition hover:bg-voile hover:text-encre">
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-6">
        <h2 id="panneau-rdv-titre" className="mt-3 text-[30px] leading-tight font-semibold tracking-tight text-encre">{r.entreprise}</h2>
        <p className="ag-texte mt-1 text-[15px] font-semibold">{jourLong(r.jour)}, de {r.heure} à {r.heure_fin}</p>

        <dl className="mt-6 space-y-3.5 text-[14px]">
          <Ligne icone={r.visio ? Video : MapPin} titre={r.visio ? 'En visio' : 'Lieu'}>
            {r.visio ? (r.lieu && r.lieu.toLowerCase() !== 'visio' ? `En visio, sur ${r.lieu}` : 'En visio') : r.lieu || 'Lieu non précisé'}
          </Ligne>
          <Ligne icone={UserRound} titre="Interlocuteur">
            {r.contact ? <><b className="font-semibold text-encre">{r.contact}</b>{r.poste && <span className="text-ardoise">, <span className="lowercase">{r.poste}</span></span>}</> : <span className="text-ardoise">Interlocuteur non précisé</span>}
          </Ligne>
          {r.objet && <Ligne icone={BookOpen} titre="Objet">{r.objet}</Ligne>}
          {(r.affaire || r.montant) && (
            <Ligne icone={Briefcase} titre="Affaire en cours">
              {r.affaire}{r.montant && <> · <b className="chiffre font-semibold text-encre">{r.montant}</b></>}
            </Ligne>
          )}
        </dl>

        {r.alertes.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {r.alertes.map((a) => (
              <span key={a} className="flex items-center gap-1.5 rounded-full bg-alerte-fond px-3 py-1 text-[12px] font-semibold text-alerte"><AlertTriangle size={13} /> {a}</span>
            ))}
          </div>
        )}

        {/* état de la fiche et actions */}
        <div className="mt-7 border-t border-nuage pt-6">
          {etat === 'hors_crm' ? (
            <div className="rounded-2xl border border-dashed border-brume/60 p-4 text-[14px] text-ardoise">
              <p className="flex items-center gap-2 font-semibold text-encre"><CalendarPlus size={16} /> Ajouté à votre agenda, absent du CRM{NBSP}: pas de fiche possible</p>
              <p className="mt-1">Créez le rendez-vous dans le CRM, puis déposez le nouveau fichier{NBSP}: je prépare alors la fiche.</p>
            </div>
          ) : etat === 'prete' ? (
            <p className="flex items-center gap-2 text-[14px] text-ok"><IconeEtat etat="prete" taille={14} /> <span><b className="font-semibold">Fiche prête</b>{r.fiche.preparee_le && <span className="text-ardoise"> depuis le {r.fiche.preparee_le}</span>}</span></p>
          ) : etat === 'preparation' ? (
            <p className="ag-texte flex items-center gap-2 text-[14px] font-semibold"><IconeEtat etat="preparation" /> Je prépare la fiche en ce moment</p>
          ) : etat === 'passe' ? (
            <p className="flex items-center gap-2 text-[14px] text-ardoise"><Clock size={15} /> Rendez-vous passé, sans fiche</p>
          ) : (
            <p className="flex items-center gap-2 text-[14px] text-ardoise"><IconeEtat etat="a_preparer" /> Fiche pas encore préparée</p>
          )}

          {etat === 'prete' && (
            <div className="mt-4 flex flex-wrap gap-2">
              {r.fiche.page && (
                <button type="button" onClick={onLire}
                  className="ag-bouton flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110">
                  <BookOpen size={15} /> Lire la fiche
                </button>
              )}
              {r.fiche.son && !ecoute && (
                <button type="button" onClick={onEcouter}
                  className="flex items-center gap-2 rounded-full border border-nuage bg-white px-4 py-2.5 text-sm font-semibold text-encre transition hover:border-lavande">
                  <Headphones size={15} /> Écouter
                </button>
              )}
            </div>
          )}
          <AnimatePresence initial={false}>
            {etat === 'prete' && ecoute && r.fiche.son && (
              <motion.div key="lecteur" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: EASE }} className="overflow-hidden">
                <div className="pt-3"><MiniLecteur src={r.fiche.son} titre={`Votre fiche ${r.entreprise}`} /></div>
              </motion.div>
            )}
          </AnimatePresence>

          {(etat === 'a_preparer') && (
            <div className="mt-4">
              <button type="button" onClick={onJournee}
                className="ag-bouton flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110">
                <Sparkles size={15} /> Préparer ma visite
              </button>
              <p className="mt-2 text-[12px] text-ardoise">J’ouvre ce rendez-vous dans Ma journée, où la préparation se lance.</p>
            </div>
          )}

          <button type="button" onClick={onJournee}
            className={cn('mt-5 flex items-center gap-1.5 text-sm font-semibold text-encre underline-offset-4 hover:underline', etat === 'a_preparer' && 'hidden')}>
            <CalendarDays size={15} /> {etat === 'preparation' ? 'Suivre la préparation dans Ma journée' : 'Ouvrir dans Ma journée'} <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </>
  )
}

function Ligne({ icone: Icone, titre, children }: { icone: typeof MapPin; titre: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="mt-0.5 shrink-0 text-brume"><Icone size={16} aria-hidden /><span className="sr-only">{titre}</span></dt>
      <dd className="min-w-0 text-texte">{children}</dd>
    </div>
  )
}

function LectureFiche({ r, onRetour, onFermer }: { r: RdvAgenda; onRetour: () => void; onFermer: () => void }) {
  const v = encodeURIComponent(r.fiche.preparee_le ?? '')
  const url = `${r.fiche.page}?v=${v}`
  return (
    <>
      <div className="flex items-center gap-2 border-b border-nuage px-4 py-3">
        <button type="button" data-premier onClick={onRetour}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-ardoise transition hover:bg-voile hover:text-encre">
          <ChevronLeft size={16} /> Retour
        </button>
        <p id="panneau-rdv-titre" className="titre min-w-0 flex-1 truncate text-[17px] text-encre">Fiche {r.entreprise}</p>
        <a href={url} target="_blank" rel="noreferrer"
          className="flex items-center gap-1.5 rounded-full border border-nuage bg-white px-3.5 py-1.5 text-sm font-semibold text-encre transition hover:border-lavande">
          <ExternalLink size={14} /> Ouvrir en grand
        </a>
        <button type="button" onClick={onFermer} aria-label="Fermer (Échap)" title="Fermer (Échap)"
          className="grid size-9 shrink-0 place-items-center rounded-full text-ardoise transition hover:bg-voile hover:text-encre">
          <X size={18} />
        </button>
      </div>
      <iframe title={`Fiche de visite ${r.entreprise}`} src={url} className="min-h-0 w-full flex-1 bg-white" />
    </>
  )
}

function MiniLecteur({ src, titre }: { src: string; titre: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [lecture, setLecture] = useState(false)
  const [pos, setPos] = useState(0)
  const [duree, setDuree] = useState(0)
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const sauter = (d: number) => { if (ref.current) ref.current.currentTime = Math.min(Math.max(0, ref.current.currentTime + d), duree || ref.current.duration || 0) }
  useEffect(() => { ref.current?.play().catch(() => {}) }, [])
  return (
    <div className="flex items-center gap-4 rounded-[20px] bg-[#120A29] p-4 text-white">
      <button type="button" aria-label={lecture ? 'Pause' : 'Écouter la fiche'} onClick={() => (lecture ? ref.current?.pause() : ref.current?.play())}
        className="ag-bouton grid size-12 shrink-0 place-items-center rounded-full text-white transition hover:brightness-110">
        {lecture ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold">{titre}</p>
        <div className="mt-2 flex items-center gap-1.5">
          <button type="button" aria-label="Reculer de 15 secondes" onClick={() => sauter(-15)} className="grid size-7 shrink-0 place-items-center rounded-full text-[#D8CCFB] transition hover:bg-white/10 hover:text-white"><RotateCcw size={14} /></button>
          <input type="range" min={0} max={duree || 0} step={0.1} value={pos} disabled={!duree} aria-label="Position dans la fiche audio"
            aria-valuetext={`${fmt(pos)} sur ${duree ? fmt(duree) : 'durée inconnue'}`}
            onChange={(e) => { const t = Number(e.target.value); setPos(t); if (ref.current) ref.current.currentTime = t }}
            style={{ ['--p' as string]: duree ? `${(pos / duree) * 100}%` : '0%' }}
            className="curseur-audio h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/15" />
          <button type="button" aria-label="Avancer de 15 secondes" onClick={() => sauter(15)} className="grid size-7 shrink-0 place-items-center rounded-full text-[#D8CCFB] transition hover:bg-white/10 hover:text-white"><RotateCw size={14} /></button>
          <span className="w-[74px] shrink-0 text-right text-[12px] text-[#D8CCFB] tabular-nums">{fmt(pos)} / {duree ? fmt(duree) : '-:--'}</span>
        </div>
      </div>
      <audio ref={ref} src={src} preload="metadata" onPlay={() => setLecture(true)} onPause={() => setLecture(false)} onEnded={() => setLecture(false)}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDuree(e.currentTarget.duration)} />
    </div>
  )
}

/* ================================================================== petits éléments */

/** Choix de l'affichage : un menu déroulant compact (Jour, Semaine, Mois), animé, utilisable au clavier. */
const VUES: { id: Vue; libelle: string; aide: string }[] = [
  { id: 'jour', libelle: 'Jour', aide: 'Une journée, heure par heure' },
  { id: 'semaine', libelle: 'Semaine', aide: 'Du lundi au dimanche' },
  { id: 'mois', libelle: 'Mois', aide: 'Tout le mois en un coup d’œil' },
]
function MenuVue({ valeur, onChanger }: { valeur: Vue; onChanger: (v: Vue) => void }) {
  const [ouvert, setOuvert] = useState(false)
  const [focus, setFocus] = useState(0)
  const racine = useRef<HTMLDivElement>(null)
  const bouton = useRef<HTMLButtonElement>(null)
  const reduit = useReducedMotion()
  const actuel = VUES.find((v) => v.id === valeur) ?? VUES[1]
  useEffect(() => {
    if (!ouvert) return
    const dehors = (e: MouseEvent) => { if (!racine.current?.contains(e.target as Node)) setOuvert(false) }
    document.addEventListener('mousedown', dehors)
    return () => document.removeEventListener('mousedown', dehors)
  }, [ouvert])
  const choisir = (v: Vue) => { onChanger(v); setOuvert(false); bouton.current?.focus() }
  const clavier = (e: React.KeyboardEvent) => {
    if (!ouvert && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setFocus(VUES.findIndex((v) => v.id === valeur)); setOuvert(true); return }
    if (!ouvert) return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOuvert(false); bouton.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setFocus((f) => (f + 1) % VUES.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus((f) => (f - 1 + VUES.length) % VUES.length) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choisir(VUES[focus].id) }
  }
  return (
    <div ref={racine} className="relative" onKeyDown={clavier}>
      <button ref={bouton} type="button" aria-haspopup="listbox" aria-expanded={ouvert} aria-label={`Affichage : ${actuel.libelle}`}
        onClick={() => { setFocus(VUES.findIndex((v) => v.id === valeur)); setOuvert((o) => !o) }}
        className="flex items-center gap-2 rounded-full bg-encre py-2 pr-3 pl-4 text-[13px] font-semibold text-white transition hover:bg-violet-profond">
        <CalendarDays size={15} />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={actuel.id} initial={{ opacity: 0, y: reduit ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduit ? 0 : -6 }}
            transition={{ duration: 0.16, ease: EASE }} className="min-w-[3.6rem] text-left">{actuel.libelle}</motion.span>
        </AnimatePresence>
        <motion.span animate={{ rotate: ouvert ? 180 : 0 }} transition={{ duration: reduit ? 0 : 0.2, ease: EASE }} className="grid">
          <ChevronDown size={15} />
        </motion.span>
      </button>
      <AnimatePresence>
        {ouvert && (
          <motion.ul role="listbox" aria-label="Affichage" aria-activedescendant={`vue-${VUES[focus].id}`}
            initial={{ opacity: 0, scale: reduit ? 1 : 0.96, y: reduit ? 0 : -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: reduit ? 1 : 0.97 }}
            transition={{ duration: 0.16, ease: EASE }} style={{ transformOrigin: 'top right' }}
            className="absolute top-full right-0 z-40 mt-2 w-60 rounded-2xl border border-nuage bg-white p-1.5 shadow-panneau">
            {VUES.map((v, i) => {
              const choisi = v.id === valeur
              return (
                <li key={v.id} id={`vue-${v.id}`} role="option" aria-selected={choisi}
                  onMouseEnter={() => setFocus(i)} onClick={() => choisir(v.id)}
                  className={cn('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors', focus === i ? 'bg-voile' : '')}>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-[14px] font-semibold', choisi ? 'text-violet' : 'text-encre')}>{v.libelle}</span>
                    <span className="block text-[12px] text-ardoise">{v.aide}</span>
                  </span>
                  {choisi && <Check size={16} className="shrink-0 text-violet" />}
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

function Segmente<T extends string>({ etiquette, valeur, onChanger, choix, fond }: {
  etiquette: string; valeur: T; onChanger: (v: T) => void; fond: string
  choix: { id: T; libelle: string; compte?: number; point?: string }[]
}) {
  const groupe = useRef<HTMLDivElement>(null)
  const clavier = (e: React.KeyboardEvent) => {
    const i = choix.findIndex((c) => c.id === valeur)
    const pas = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    const cible = e.key === 'Home' ? 0 : e.key === 'End' ? choix.length - 1 : pas ? (i + pas + choix.length) % choix.length : -1
    if (cible < 0) return
    e.preventDefault()
    onChanger(choix[cible].id)
    requestAnimationFrame(() => groupe.current?.querySelector<HTMLElement>(`[data-id="${choix[cible].id}"]`)?.focus())
  }
  return (
    <div ref={groupe} role="radiogroup" aria-label={etiquette} onKeyDown={clavier} className="flex shrink-0 rounded-full border border-nuage bg-white p-1">
      <AnimatedBackground defaultValue={valeur} onValueChange={(v) => v && onChanger(v as T)}
        className={cn('rounded-full transition-colors duration-200', fond)} transition={{ type: 'spring', bounce: 0.15, duration: 0.32 }}>
        {choix.map((c) => (
          <button key={c.id} data-id={c.id} type="button" role="radio" aria-checked={valeur === c.id} tabIndex={valeur === c.id ? 0 : -1}
            className="group/seg px-3.5 py-1.5 text-[13px] font-semibold text-ardoise transition-colors data-[checked=true]:text-white">
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              {c.point && <span aria-hidden className={cn(c.point, 'ag-point size-2 rounded-full group-data-[checked=true]/seg:bg-white')} />}
              {c.libelle}
              {c.compte !== undefined && (
                <span className="chiffre min-w-[1.25rem] rounded-full bg-nuage/80 px-1.5 text-center text-[12px] leading-[18px] font-medium text-encre tabular-nums group-data-[checked=true]/seg:bg-white/20 group-data-[checked=true]/seg:text-white">
                  {c.compte}
                </span>
              )}
            </span>
          </button>
        ))}
      </AnimatedBackground>
    </div>
  )
}

function BoutonRond({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className="grid size-9 shrink-0 place-items-center rounded-full border border-nuage bg-white text-ardoise transition hover:border-lavande hover:text-encre">
      {children}
    </button>
  )
}

function Touche({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-[5px] border border-nuage bg-white px-1.5 py-px font-sans text-[12px] text-ardoise">{children}</kbd>
}

function Squelette({ vue }: { vue: Vue }) {
  return (
    <div role="status" aria-label="Je consulte votre agenda" className="p-4">
      {vue !== 'mois' ? (
        <div className="grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))] gap-x-2">
          <div />
          {Array.from({ length: 7 }, (_, i) => <div key={i} className="mx-auto mb-4 h-6 w-16 animate-pulse rounded-full bg-nuage/80" />)}
          <div />
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="relative" style={{ height: 11 * H - 40 }}>
              {i < 5 && <div className="absolute inset-x-1 animate-pulse rounded-[10px] bg-nuage/70" style={{ top: ((i * 2 + 1) % 7) * H, height: H * 1.3 }} />}
              {i % 2 === 0 && i < 5 && <div className="absolute inset-x-1 animate-pulse rounded-[10px] bg-nuage/50" style={{ top: ((i * 3 + 5) % 9) * H, height: H }} />}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 35 }, (_, i) => <div key={i} className="h-[92px] animate-pulse rounded-xl bg-nuage/50" />)}
        </div>
      )}
      <span className="sr-only">Je consulte votre agenda...</span>
    </div>
  )
}

function ErreurChargement({ message, onReessayer }: { message: string; onReessayer: () => void }) {
  return (
    <div className="grid min-h-[420px] place-items-center p-6 text-center">
      <div>
        <p className="titre text-xl text-encre">Je n’arrive pas à lire votre agenda</p>
        <p className="mt-1 text-sm text-ardoise">{/erreur \d+/i.test(message) ? 'Le service local ne répond pas pour l’instant.' : message}</p>
        <button type="button" onClick={onReessayer} className="mt-4 rounded-full bg-encre px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-profond">Réessayer</button>
      </div>
    </div>
  )
}
