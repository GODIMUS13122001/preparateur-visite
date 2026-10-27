import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from 'motion/react'
import { Archive, Check, ChevronsUpDown, Coins, Info, Newspaper, PenLine, Users } from 'lucide-react'
import { useApi } from '../mode'
import { type Conso, type ConsoEffacee, type Execution, type ResumeExecution } from '../api'
import { AnimatedBackground } from '@/components/motion-primitives/animated-background'
import { Portail } from '@/pages/Journee'
import { cn } from '@/lib/utils'
import { Fleche } from './Repli'

/* Compteur de consommation d'une préparation : volume de texte lu et écrit (compté en pages), coût au tarif public de Claude, et projection pour une équipe.
   Le commercial ne voit jamais le mot « token » : 500 tokens font environ une page de texte.
   Le détail n'est gardé que pour les trois dernières fiches ; au-delà, seul le total reste. */

type Devise = 'eur' | 'usd'
const TAUX_DEFAUT = 0.86 // 1 $ en euros, modifiable par l'utilisateur
const EASE = [0.23, 1, 0.32, 1] as const
const TOKENS_PAR_PAGE = 500 // ordre de grandeur pour une page de texte en français
const lire = <T,>(cle: string, defaut: T): T => { try { const v = localStorage.getItem(cle); return v ? (JSON.parse(v) as T) : defaut } catch { return defaut } }
const ecrire = (cle: string, v: unknown) => { try { localStorage.setItem(cle, JSON.stringify(v)) } catch { /* stockage indisponible */ } }

/** Nombre de pages de texte (arrondi lisible) pour un volume compté par Claude. */
const nbPages = (n: number) => { const p = n / TOKENS_PAR_PAGE; return p >= 1000 ? Math.round(p / 100) * 100 : p >= 100 ? Math.round(p / 10) * 10 : Math.max(1, Math.round(p)) }
const fmtNbPages = (p: number) => Math.round(p).toLocaleString('fr-FR')
const fmtPages = (n: number) => { const p = nbPages(n); return `${fmtNbPages(p)} page${p > 1 ? 's' : ''}` }
const fmtDate = (t: number) => new Date(t * 1000).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(':', 'h')
const estEfface = (c: Conso | ConsoEffacee | null | undefined): c is ConsoEffacee => !!c && 'efface' in c && c.efface

/** Nombre qui glisse vers sa nouvelle valeur (ressort court, sans rebond). */
function Anime({ valeur, format, className }: { valeur: number; format: (n: number) => string; className?: string }) {
  const reduit = useReducedMotion()
  const ressort = useSpring(valeur, { duration: reduit ? 0 : 0.6, bounce: 0 })
  const texte = useTransform(ressort, format)
  useEffect(() => { ressort.set(valeur) }, [ressort, valeur])
  return <motion.span className={cn('tabular-nums', className)}>{texte}</motion.span>
}

/* Tarifs relatifs publics de Claude : relire coûte 10 fois moins qu'une première lecture, mettre de côté 25 % de plus, écrire 5 fois plus. */
const CATEGORIES = [
  { cle: 'cache_lu', nom: 'Relu en mémoire', facteur: 0.1, couleur: '#AC8FF9',
    quoi: 'Avant chaque nouvelle étape, Claude relit tout ce qu’il a déjà sous la main : vos consignes, le dossier client, ce qu’il a trouvé. Ce sont les mêmes pages, relues encore et encore.',
    image: 'Comme un commercial qui relit ses notes avant chaque appel.',
    prix: 'Tarif réduit : 10 fois moins cher qu’une première lecture. C’est le gros du volume, pas le gros de la facture.' },
  { cle: 'cache_ecrit', nom: 'Mis en mémoire', facteur: 1.25, couleur: '#8257F5',
    quoi: 'Quand Claude découvre un document qu’il va réutiliser (le dossier du CRM, les articles trouvés), il le range de côté pour les étapes suivantes.',
    image: 'Comme classer un dossier pour le retrouver vite ensuite.',
    prix: 'Un quart plus cher qu’une lecture simple, mais c’est ce qui rend les relectures presque gratuites.' },
  { cle: 'entree', nom: 'Lu une fois', facteur: 1, couleur: '#5723F3',
    quoi: 'Ce que Claude lit une seule fois sans le garder : une consigne du moment, une réponse courte, une page parcourue.',
    image: 'Comme un e-mail lu puis archivé.',
    prix: 'Le tarif de base, qui sert de référence aux autres.' },
  { cle: 'sortie', nom: 'Écrit', facteur: 5, couleur: '#FFFFFF',
    quoi: 'Tout ce que Claude rédige : la fiche, le texte à écouter, et ses notes pour s’organiser entre deux étapes.',
    image: 'Écrire prend plus d’effort que lire, ici aussi.',
    prix: 'Le plus cher : 5 fois le prix de la lecture. Petit volume, mais il pèse lourd dans le total.' },
] as const
type CleCat = (typeof CATEGORIES)[number]['cle']

const ROLES: Record<string, { quoi: string; image: string }> = {
  Recherches: { quoi: 'Un assistant plus léger, et moins cher, part chercher l’actualité de l’entreprise sur le web, sur trois sujets en même temps : finances, dirigeants, usines et produits.',
    image: 'Comme trois stagiaires qui font la revue de presse en parallèle.' },
  Lecture: { quoi: 'L’assistant principal lit le CRM, trie ce que la presse a rapporté, écrit la fiche d’une page et le texte à écouter en voiture.',
    image: 'C’est lui qui tient le stylo.' },
}

/** Coût de chaque type de token, réparti à partir du coût réel de chaque modèle et des tarifs relatifs (recherches web à part). */
function coutParCategorie(c: Conso): Record<CleCat, number> | null {
  if (!c.modeles.length) return null
  const r = { cache_lu: 0, cache_ecrit: 0, entree: 0, sortie: 0 }
  for (const m of c.modeles) {
    const base = Math.max(0, m.cout_usd - m.recherches_web * 0.01)
    const poids = CATEGORIES.reduce((a, k) => a + m[k.cle] * k.facteur, 0)
    if (!poids) continue
    for (const k of CATEGORIES) r[k.cle] += (base * m[k.cle] * k.facteur) / poids
  }
  return r
}

/* --------------------------------------------------------------------------- bulle d'explication */

type Bulle = { id: string; ancre: DOMRect; carte: DOMRect; contenu: React.ReactNode }

function BulleExplication({ bulle }: { bulle: Bulle | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; cote: 'gauche' | 'dessous' } | null>(null)
  useLayoutEffect(() => {
    if (!bulle) return
    const L = 300, h = ref.current?.offsetHeight ?? 200
    const aGauche = bulle.carte.left - L - 14 >= 8
    const left = aGauche ? bulle.carte.left - L - 14 : Math.min(Math.max(8, bulle.ancre.left), window.innerWidth - L - 8)
    const top = aGauche ? Math.min(Math.max(8, bulle.ancre.top + bulle.ancre.height / 2 - h / 2), window.innerHeight - h - 8) : bulle.ancre.bottom + 8
    setPos({ left, top, cote: aGauche ? 'gauche' : 'dessous' })
  }, [bulle])
  return (
    <Portail>
      <AnimatePresence>
        {bulle && (
          <motion.div ref={ref} key="bulle" role="tooltip" id="bulle-conso"
            className="pointer-events-none fixed z-50 w-[300px] rounded-2xl bg-white p-4 text-encre shadow-[0_24px_48px_-20px_rgba(18,10,41,0.45)] ring-1 ring-encre/10"
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, transformOrigin: pos?.cote === 'dessous' ? 'top center' : 'right center' }}
            initial={{ opacity: 0, transform: 'scale(0.97)' }} animate={{ opacity: 1, transform: 'scale(1)' }} exit={{ opacity: 0, transform: 'scale(0.97)', transition: { duration: 0.1 } }}
            transition={{ duration: 0.15, ease: EASE }}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={bulle.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                {bulle.contenu}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </Portail>
  )
}

function useBulle(carte: React.RefObject<HTMLElement | null>) {
  const [bulle, setBulle] = useState<Bulle | null>(null)
  const minuterie = useRef<number>(0)
  const ouverte = useRef(false)
  const montrer = (id: string, el: HTMLElement, contenu: React.ReactNode) => {
    window.clearTimeout(minuterie.current)
    const go = () => { ouverte.current = true; setBulle({ id, ancre: el.getBoundingClientRect(), carte: carte.current!.getBoundingClientRect(), contenu }) }
    if (ouverte.current) go() // une bulle est déjà ouverte : la suivante s'affiche sans attendre
    else minuterie.current = window.setTimeout(go, 140)
  }
  const cacher = () => {
    window.clearTimeout(minuterie.current)
    minuterie.current = window.setTimeout(() => { ouverte.current = false; setBulle(null) }, 80)
  }
  useEffect(() => () => window.clearTimeout(minuterie.current), [])
  return { bulle, montrer, cacher }
}

function ContenuBulle({ titre, couleur, quoi, image, chiffres, prix }: { titre: string; couleur?: string; quoi: string; image: string; chiffres?: React.ReactNode; prix?: string }) {
  return (
    <div className="text-[13px] leading-snug">
      <p className="flex items-center gap-2 font-semibold">{couleur && <span className="size-2.5 rounded-full ring-1 ring-encre/15" style={{ background: couleur }} />}{titre}</p>
      <p className="mt-2 text-ardoise">{quoi}</p>
      <p className="mt-1.5 text-brume italic">{image}</p>
      {chiffres && <div className="mt-3 rounded-xl bg-violet/[0.06] p-2.5 text-xs">{chiffres}</div>}
      {prix && <p className="mt-2 text-xs text-ardoise">{prix}</p>}
    </div>
  )
}

/* --------------------------------------------------------------------------- choix de la fiche */

function ChoixFiche({ fiches, choix, onChoix, fmtCout }: { fiches: ResumeExecution[]; choix: string; onChoix: (id: string) => void; fmtCout: (usd: number) => string }) {
  const [ouvert, setOuvert] = useState(false)
  const boite = useRef<HTMLDivElement>(null)
  const actuelle = fiches.find((f) => f.id === choix)
  useEffect(() => {
    if (!ouvert) return
    const clic = (e: MouseEvent) => { if (!boite.current?.contains(e.target as Node)) setOuvert(false) }
    const touche = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(false) }
    document.addEventListener('mousedown', clic); document.addEventListener('keydown', touche)
    return () => { document.removeEventListener('mousedown', clic); document.removeEventListener('keydown', touche) }
  }, [ouvert])
  if (fiches.length < 2) return null
  return (
    <div ref={boite} className="relative mt-3">
      <button type="button" onClick={() => setOuvert((o) => !o)} aria-haspopup="listbox" aria-expanded={ouvert}
        className="flex w-full items-center gap-2 rounded-xl bg-white/[0.07] px-3 py-2 text-left text-sm ring-1 ring-white/10 hover:bg-white/10">
        <span className="min-w-0 flex-1 truncate">{actuelle ? <>{actuelle.entreprise}<span className="text-lilas"> · {fmtDate(actuelle.debut)}</span></> : 'Choisir une fiche'}</span>
        <ChevronsUpDown size={14} className="shrink-0 text-lilas" />
      </button>
      <AnimatePresence>
        {ouvert && (
          <motion.ul role="listbox" aria-label="Fiche à détailler"
            className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-72 overflow-auto rounded-xl bg-[#1d1440] p-1 shadow-[0_20px_40px_-16px_rgba(0,0,0,0.6)] ring-1 ring-white/10"
            style={{ transformOrigin: 'top center' }}
            initial={{ opacity: 0, transform: 'scale(0.97) translateY(-4px)' }} animate={{ opacity: 1, transform: 'scale(1) translateY(0px)' }}
            exit={{ opacity: 0, transform: 'scale(0.97) translateY(-4px)', transition: { duration: 0.12 } }} transition={{ duration: 0.18, ease: EASE }}>
            {fiches.map((f) => (
              <li key={f.id} role="option" aria-selected={f.id === choix}>
                <button type="button" onClick={() => { onChoix(f.id); setOuvert(false) }}
                  className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm', f.id === choix ? 'bg-white/10' : 'hover:bg-white/[0.06]')}>
                  <span className="grid size-4 shrink-0 place-items-center">{f.id === choix ? <Check size={14} className="text-lavande" /> : !f.detail && f.statut !== 'en_cours' ? <Archive size={13} className="text-lilas/60" /> : null}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate', !f.detail && f.statut !== 'en_cours' && 'text-lilas')}>{f.entreprise}</span>
                    <span className="block text-xs text-lilas/80">{f.statut === 'en_cours' ? 'En cours' : fmtDate(f.debut)}{!f.detail && f.statut !== 'en_cours' ? ' · total seul' : ''}</span>
                  </span>
                  {f.cout_usd != null && <span className="chiffre text-xs text-lilas tabular-nums">{fmtCout(f.cout_usd)}</span>}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

/* --------------------------------------------------------------------------- détail effacé */

function DetailEfface({ conso, fmtCout }: { conso: ConsoEffacee; fmtCout: (usd: number) => string }) {
  const reduit = useReducedMotion()
  const couleurs = CATEGORIES.map((c) => c.couleur)
  const parts = [0.62, 0.2, 0.08, 0.1]
  return (
    <div className="mt-4" aria-live="polite">
      {/* la barre de répartition se vide, couleur par couleur, puis s'efface */}
      <div className="relative h-3 overflow-hidden rounded-full bg-white/10">
        {parts.map((p, i) => {
          const debut = parts.slice(0, i).reduce((a, b) => a + b, 0)
          return (
            <motion.div key={i} className="absolute inset-y-0 left-0 w-full origin-left"
              style={{ transform: `translateX(${debut * 100}%) scaleX(${p})` }}
              initial={{ backgroundColor: couleurs[i], opacity: 1 }}
              animate={{ backgroundColor: 'rgba(255,255,255,0.18)', opacity: reduit ? 1 : 0.35 }}
              transition={{ duration: reduit ? 0 : 0.5, delay: reduit ? 0 : 0.15 + i * 0.09, ease: EASE }} />
          )
        })}
      </div>
      <motion.div className="mt-4 flex gap-3"
        initial={{ opacity: 0, filter: reduit ? 'none' : 'blur(4px)', transform: reduit ? 'none' : 'translateY(4px)' }}
        animate={{ opacity: 1, filter: 'blur(0px)', transform: 'translateY(0px)' }}
        transition={{ duration: 0.35, delay: reduit ? 0 : 0.55, ease: EASE }}>
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.08] text-lavande"><Archive size={16} /></span>
        <div className="text-sm">
          <p className="font-semibold">Le détail n’est plus disponible</p>
          <p className="mt-1 text-xs leading-relaxed text-lilas">
            Une fiche plus récente a pris sa place. Je ne garde le détail que des trois dernières fiches produites.
            {conso.cout_usd != null && <> Il reste le total : <b className="font-semibold text-white">{fmtCout(conso.cout_usd)}</b>{conso.total ? <> pour environ {fmtPages(conso.total)} de texte lues et écrites</> : null}.</>}
          </p>
        </div>
      </motion.div>
    </div>
  )
}

/* --------------------------------------------------------------------------- compteur */

export default function CompteurConso({ exec, historique }: { exec: Execution; historique: ResumeExecution[] }) {
  const [devise, setDevise] = useState<Devise>(() => lire('conso.devise', 'eur'))
  const [taux, setTaux] = useState<number>(() => lire('conso.taux', TAUX_DEFAUT))
  const [visites, setVisites] = useState<number>(() => lire('conso.visites', 10))
  const [commerciaux, setCommerciaux] = useState<number>(() => lire('conso.commerciaux', 1))
  const [survol, setSurvol] = useState<CleCat | null>(null)
  const [ouvert, setOuvert] = useState<boolean>(() => lire('conso.ouvert', true))
  useEffect(() => ecrire('conso.ouvert', ouvert), [ouvert])
  useEffect(() => ecrire('conso.devise', devise), [devise])
  useEffect(() => ecrire('conso.taux', taux), [taux])
  useEffect(() => ecrire('conso.visites', visites), [visites])
  useEffect(() => ecrire('conso.commerciaux', commerciaux), [commerciaux])

  // fiche détaillée : celle affichée dans le Workflow, sauf si l'on en choisit une autre
  const { coulisses } = useApi()
  const [choix, setChoix] = useState(exec.id)
  const [autre, setAutre] = useState<Execution['conso'] | undefined>(undefined)
  useEffect(() => { setChoix(exec.id) }, [exec.id])
  useEffect(() => {
    if (choix === exec.id) { setAutre(undefined); return }
    let actif = true
    setAutre(undefined)
    const ctl = new AbortController()
    coulisses.detail(choix, ctl.signal).then((e) => actif && setAutre(e.conso ?? null)).catch(() => actif && setAutre(null))
    return () => { actif = false; ctl.abort() }
  }, [choix, exec.id, coulisses])
  const brut = choix === exec.id ? exec.conso : autre
  const chargement = choix !== exec.id && autre === undefined
  const efface = estEfface(brut) ? brut : null
  const conso = brut && !estEfface(brut) ? brut : null
  const enCours = choix === exec.id && exec.statut === 'en_cours'

  const fiches = useMemo(() => {
    const l = historique.filter((h) => h.statut === 'termine' || h.id === exec.id)
    return l.some((h) => h.id === exec.id) ? l : [{ id: exec.id, rid: exec.rid, entreprise: exec.entreprise, statut: exec.statut, debut: exec.debut, fin: exec.fin, declencheur: exec.declencheur, faits: 0, lectures: 0, detail: true }, ...l]
  }, [historique, exec])

  const carte = useRef<HTMLElement>(null)
  const { bulle, montrer, cacher } = useBulle(carte)

  const enDevise = (usd: number) => (devise === 'eur' ? usd * taux : usd)
  const fmtArgent = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: devise === 'eur' ? 'EUR' : 'USD', minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 })
  const fmtCout = (usd: number) => fmtArgent(enDevise(usd))

  // moyenne des fiches terminées : sert à estimer le coût en direct et à projeter
  const reference = useMemo(() => {
    const ok = historique.filter((h) => h.statut === 'termine' && h.cout_usd && h.tokens)
    if (!ok.length) return null
    const cout = ok.reduce((a, h) => a + h.cout_usd!, 0), tokens = ok.reduce((a, h) => a + h.tokens!, 0)
    return { parFiche: cout / ok.length, parMillion: (cout / tokens) * 1e6, n: ok.length }
  }, [historique])

  const total = conso ? conso.entree + conso.sortie + conso.cache_lu + conso.cache_ecrit : 0
  const coutUsd = conso?.cout_usd ?? (reference && total ? (total / 1e6) * reference.parMillion : null)
  const estime = !!conso && conso.cout_usd == null
  const parCat = conso ? coutParCategorie(conso) : null
  const parFiche = conso?.cout_usd && !conso.provisoire ? conso.cout_usd : efface?.cout_usd ?? reference?.parFiche ?? null
  const fichesMois = visites * commerciaux * 4.33
  const mois = parFiche != null ? parFiche * fichesMois : null

  const bulleCategorie = (c: (typeof CATEGORIES)[number], el: HTMLElement) => {
    if (!conso) return
    const n = conso[c.cle], cout = parCat?.[c.cle]
    montrer(c.cle, el, (
      <ContenuBulle titre={c.nom} couleur={c.couleur} quoi={c.quoi} image={c.image} prix={c.prix}
        chiffres={<>
          <p>Environ <b className="font-semibold">{fmtPages(n)}</b> de texte.</p>
          {cout != null && conso.cout_usd ? <p className="mt-1">Environ <b className="font-semibold">{fmtCout(cout)}</b>, soit {Math.round((cout / conso.cout_usd) * 100)} % du coût de la fiche.</p> : null}
        </>} />
    ))
    setSurvol(c.cle)
  }
  const quitter = () => { cacher(); setSurvol(null) }
  const survolable = (onEntrer: (el: HTMLElement) => void) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => onEntrer(e.currentTarget),
    onMouseLeave: quitter,
    onFocus: (e: React.FocusEvent<HTMLElement>) => onEntrer(e.currentTarget),
    onBlur: quitter,
    'aria-describedby': bulle ? 'bulle-conso' : undefined,
  })

  return (
    <section ref={carte} aria-label="Consommation de la préparation" className="relative rounded-[24px] bg-encre p-5 text-white shadow-panneau">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[24px]"><div className="halo absolute -top-32 -right-28 size-80 [--halo:color-mix(in_srgb,var(--color-deco)_40%,transparent)]" /></div>
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg">
            <button type="button" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert} aria-controls="section-couts"
              className="group flex items-center gap-2 rounded-lg text-left">
              <Coins size={17} className="text-lavande" /> Ce que coûte cette fiche
              <Fleche ouvert={ouvert} sombre />
            </button>
          </h2>
          {ouvert && <div className="flex rounded-full bg-white/[0.08] p-0.5 ring-1 ring-white/10">
            <AnimatedBackground defaultValue={devise} onValueChange={(v) => v && setDevise(v as Devise)} className="rounded-full bg-[#FAF9F6]" transition={{ type: 'spring', bounce: 0, duration: 0.25 }}>
              {(['eur', 'usd'] as const).map((d) => (
                <button key={d} data-id={d} type="button" aria-pressed={devise === d} className="px-2.5 py-1 text-xs font-semibold text-lilas transition-colors data-[checked=true]:text-[#120A29]">{d === 'eur' ? '€' : '$'}</button>
              ))}
            </AnimatedBackground>
          </div>}
        </div>

        <AnimatePresence initial={false}>
        {ouvert && (
        <motion.div id="section-couts" key="couts"
          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }} exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
          style={{ overflow: 'hidden' }}
          transition={{ duration: 0.25, ease: EASE }}>
        <ChoixFiche fiches={fiches} choix={choix} onChoix={setChoix} fmtCout={fmtCout} />

        <AnimatePresence mode="wait" initial={false}>
        <motion.div key={choix} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
        {chargement ? (
          <div className="mt-4 h-24 animate-pulse rounded-2xl bg-white/[0.05]" />
        ) : efface ? (
          <DetailEfface conso={efface} fmtCout={fmtCout} />
        ) : !conso ? (
          <p className="mt-4 text-sm text-lilas">{enCours ? 'Je compte dès la première réponse...' : 'Pas de mesure pour cette préparation : elle date d’avant le compteur.'}</p>
        ) : (
          <>
            <div className="mt-4 flex items-end justify-between gap-4">
              <div>
                <div className="chiffre text-[44px] leading-none font-medium">
                  {coutUsd != null ? <>{estime && <span className="mr-1 text-2xl text-lavande">≈</span>}<Anime valeur={enDevise(coutUsd)} format={fmtArgent} /></> : '-'}
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-lilas" aria-live="polite">
                  {enCours && conso.provisoire && <span className="size-1.5 animate-pulse rounded-full bg-lavande" />}
                  {enCours && conso.provisoire ? 'En direct, estimation au tarif moyen de vos fiches' : 'Au tarif public de Claude, facturé à l’usage'}
                </p>
              </div>
              <div className="text-right">
                <div className="chiffre text-2xl font-medium"><Anime valeur={nbPages(total)} format={fmtNbPages} /></div>
                <p className="text-xs text-lilas">pages de texte<br />lues et écrites</p>
              </div>
            </div>

            {/* répartition par type de token : un seul élément par couche, animé en transform */}
            <div className="mt-5">
              <div className="relative h-3 overflow-hidden rounded-full bg-white/10">
                {CATEGORIES.map((c, i) => {
                  const debut = total ? CATEGORIES.slice(0, i).reduce((x, y) => x + conso[y.cle], 0) / total : 0
                  const part = total ? conso[c.cle] / total : 0
                  return (
                    <div key={c.cle} onMouseEnter={(e) => bulleCategorie(c, e.currentTarget)} onMouseLeave={quitter}
                      className="absolute inset-y-0 left-0 w-full origin-left transition-[transform,opacity] duration-500 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
                      style={{ background: c.couleur, transform: `translateX(${debut * 100}%) scaleX(${part})`, opacity: survol && survol !== c.cle ? 0.3 : 1 }} />
                  )
                })}
              </div>
              <ul className="mt-3 grid gap-0.5">
                {CATEGORIES.map((c) => {
                  const part = total ? Math.round((conso[c.cle] / total) * 100) : 0
                  return (
                    <li key={c.cle}>
                      <button type="button" {...survolable((el) => bulleCategorie(c, el))}
                        className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors', survol === c.cle ? 'bg-white/10' : 'hover:bg-white/[0.06]')}>
                        <span className="size-2.5 shrink-0 rounded-full ring-1 ring-white/20" style={{ background: c.couleur }} />
                        <span className="min-w-0 flex-1 truncate text-lilas">{c.nom}</span>
                        <span className="tabular-nums whitespace-nowrap">{fmtPages(conso[c.cle])}</span>
                        <span className="w-8 text-right text-lilas tabular-nums">{part} %</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-lilas"><Info size={12} /> Survolez une ligne : je vous explique à quoi elle correspond.</p>
            </div>

            {conso.modeles.length > 0 && (
              <div className="mt-4 space-y-1 border-t border-white/10 pt-4">
                {conso.modeles.map((m) => {
                  const t = m.entree + m.sortie + m.cache_lu + m.cache_ecrit
                  const recherche = m.role.startsWith('Recherches')
                  const Icone = recherche ? Newspaper : PenLine
                  const texte = ROLES[recherche ? 'Recherches' : 'Lecture']
                  return (
                    <div key={m.modele} tabIndex={0} {...survolable((el) => montrer(m.modele, el, (
                      <ContenuBulle titre={m.role} quoi={texte.quoi} image={texte.image}
                        chiffres={<>
                          <p>Environ <b className="font-semibold">{fmtPages(t)}</b> de texte, pour <b className="font-semibold">{fmtCout(m.cout_usd)}</b>{conso.cout_usd ? <> ({Math.round((m.cout_usd / conso.cout_usd) * 100)} % de la fiche)</> : null}.</p>
                          {m.recherches_web > 0 && <p className="mt-1">{m.recherches_web} recherches sur le web, à environ un centime chacune.</p>}
                        </>} />
                    )))}
                      className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm outline-none transition-colors hover:bg-white/[0.06] focus-visible:bg-white/10">
                      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/[0.08] text-lavande"><Icone size={15} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{m.role}</div>
                        <div className="text-xs text-lilas">{fmtPages(t)} de texte{m.recherches_web ? ` · ${m.recherches_web} recherches sur internet` : ''}</div>
                      </div>
                      <span className="chiffre tabular-nums">{fmtCout(m.cout_usd)}</span>
                    </div>
                  )
                })}
                {conso.cout_usd != null && total > 0 && (
                  <p className="pt-2 text-xs text-lilas">Soit <b className="font-semibold text-white">{fmtCout((conso.cout_usd / total) * TOKENS_PAR_PAGE * 1000)}</b> les 1 000 pages de texte, en moyenne.</p>
                )}
              </div>
            )}
          </>
        )}
        </motion.div>
        </AnimatePresence>

        {/* projection : combien pour une équipe */}
        <div className="mt-4 rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
          <p className="flex items-center gap-2 text-sm font-semibold"><Users size={15} className="text-lavande" /> Et pour un mois ?</p>
          <label className="mt-3 block text-xs text-lilas">
            <span className="flex justify-between"><span>Visites par semaine et par commercial</span><b className="text-white tabular-nums">{visites}</b></span>
            <input type="range" min={1} max={40} value={visites} onChange={(e) => setVisites(+e.target.value)} className="curseur-clair mt-1.5 w-full" />
          </label>
          <label className="mt-2 block text-xs text-lilas">
            <span className="flex justify-between"><span>Commerciaux</span><b className="text-white tabular-nums">{commerciaux}</b></span>
            <input type="range" min={1} max={200} value={commerciaux} onChange={(e) => setCommerciaux(+e.target.value)} className="curseur-clair mt-1.5 w-full" />
          </label>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="text-xs text-lilas">{Math.round(fichesMois).toLocaleString('fr-FR')} fiches par mois<br />{parFiche != null && <>à {fmtCout(parFiche)} la fiche{reference && (!conso || conso.provisoire) && !efface ? ` (moyenne de ${reference.n})` : ''}</>}</div>
            <div className="chiffre text-3xl font-medium">{mois != null ? <Anime valeur={enDevise(mois)} format={fmtArgent} /> : '-'}</div>
          </div>
        </div>

        <details className="group mt-3 text-xs text-lilas">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 hover:text-white"><Info size={13} /> D’où viennent ces chiffres ?</summary>
          <div className="mt-2 space-y-2 leading-relaxed">
            <p>Le volume de texte est compté par Claude lui-même à chaque préparation, puis converti en pages (une page fait environ 500 morceaux de mots). Le coût est celui de Claude facturé à l’usage, aux prix publics. Avec un abonnement Claude Pro ou Max, ces fiches sont comprises dans l’abonnement : ce montant sert à estimer le coût d’un déploiement à l’usage.</p>
            <p>La répartition par type est une estimation, faite à partir des tarifs relatifs publiés par Anthropic. Le détail n’est gardé que pour les trois dernières fiches.</p>
            {devise === 'eur' && (
              <label className="flex items-center gap-2">1 $ =
                <input type="number" step="0.01" min="0.5" max="1.5" value={taux} aria-label="Taux de conversion dollar vers euro"
                  onChange={(e) => setTaux(Math.min(1.5, Math.max(0.5, +e.target.value || TAUX_DEFAUT)))} className="w-16 rounded-md bg-white/10 px-2 py-1 text-white tabular-nums" /> €
              </label>
            )}
          </div>
        </details>
        </motion.div>
        )}
        </AnimatePresence>
      </div>
      <BulleExplication bulle={bulle} />
    </section>
  )
}
