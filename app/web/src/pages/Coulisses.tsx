import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  AlertTriangle, AudioLines, Check, CheckSquare, Clock, CornerDownRight, ExternalLink, FileSpreadsheet, Globe,
  CalendarClock, History, Layers, SearchX, Loader2, Mic, Newspaper, PenLine, Search, SlidersHorizontal, Sparkles, Smartphone, Square, TrendingUp, X, Zap, Target, UserSearch, Radar, Factory, Handshake } from 'lucide-react'
import { type Prochain, type Bloc, type DetailBloc, type EtatBloc, type Execution, type Options, type Reglages, type RdvMenu, type ResumeExecution } from '../api'
import { BorderTrail } from '@/components/motion-primitives/border-trail'
import { TextShimmer } from '@/components/motion-primitives/text-shimmer'
import { AnimatedGroup } from '@/components/motion-primitives/animated-group'
import CompteurConso from '@/components/CompteurConso'
import { Contenu, Fleche, useOuvert } from '@/components/Repli'
import { useApi, useMode, useSignal } from '../mode'
import { cn } from '@/lib/utils'
import { lisible, requeteLisible } from '@/lib/enClair'

/** Logo LinkedIn (absent de la bibliothèque d'icônes), même gabarit que les autres icônes. */
function Linkedin({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" /><rect width="4" height="12" x="2" y="9" /><circle cx="4" cy="4" r="2" />
    </svg>
  )
}

const ICONES: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  declencheur: Zap, crm: FileSpreadsheet, bourse: TrendingUp, linkedin: Linkedin, veille_a: Newspaper, veille_b: Newspaper, veille_c: Newspaper,
  profil: UserSearch, signal: Radar, secteur: Factory, fournisseurs: Handshake,
  compilation: Layers, strategie: Target, redaction: PenLine, audio_texte: Mic, rendu: AudioLines, crm_coche: CheckSquare, envoi: Smartphone,
}
const LIBELLE_ETAT: Record<EtatBloc, string> = { attente: 'En attente', en_cours: 'En cours', fait: 'Exécutée', saute: 'Non exécutée', erreur: 'Échec', arrete: 'Arrêtée' }
const STATUT: Record<Execution['statut'], { libelle: string; classe: string }> = {
  en_cours: { libelle: 'En cours', classe: 'bg-voile text-violet' },
  termine: { libelle: 'Terminée', classe: 'bg-ok-fond text-ok' },
  echec: { libelle: 'Échec', classe: 'bg-erreur-fond text-erreur' },
  arrete: { libelle: 'Arrêtée', classe: 'bg-alerte-fond text-alerte' },
}

// Géométrie du schéma (vertical, comme un flux Copilot Studio / Power Automate)
// Briques assez larges pour lire leur titre en entier (deux lignes au plus) et « Exécutée · 53 s » sur une ligne.
const NW = 166, NH = 100, GX = 12, RANG = 128
// au-delà de quatre recherches côte à côte, la rangée passe sur deux lignes décalées d'une demi-brique :
// chaque lien descend entre deux briques de la ligne du dessus, rien n'est caché, et le texte reste à taille réelle
const MAX_RANGEE = 4, GX_MUR = 28, DEMI = (NW + GX_MUR) / 2, ECART_MUR = 30
const largeurRangee = (n: number, gx = GX) => n * NW + (n - 1) * gx
function decoupe(n: number): number[] { return n <= MAX_RANGEE ? [n] : [Math.ceil(n / 2), Math.floor(n / 2)] }
function largeurSchema(blocs: Bloc[]) {
  const parRang: Record<number, number> = {}
  blocs.forEach((b) => (parRang[b.colonne] = (parRang[b.colonne] ?? 0) + 1))
  return Math.max(NW, ...Object.values(parRang).map((n) => {
    const d = decoupe(n)
    return d.length === 1 ? largeurRangee(n) : largeurRangee(d[0], GX_MUR) + (d[0] === d[1] ? DEMI : 0)
  }))
}
const SHIMMER = '[--base-color:var(--color-ardoise)] [--base-gradient-color:var(--color-violet)]'
// lignes du journal trop techniques pour un commercial : on ne les montre pas
const TECHNIQUE = /`|\$\(|\.py\b|\.json\b|\bbash\b|\bscript\b|\bcommande\b|\bredirection\b|\btool\b|\boutil|\berror\b|\bexception\b|\bquota\b|\btoken/i

/** Une rangée par étape. Autour d'une rangée en éventail (les recherches côte à côte), l'écart vertical est agrandi :
    sinon les liens, trop plats, passent derrière les cases et on ne voit plus qui est relié à qui. */
const ECART = RANG - NH, ECART_EVENTAIL = 84
function positions(blocs: Bloc[], largeur: number) {
  const parRang: Record<number, Bloc[]> = {}
  blocs.forEach((b) => (parRang[b.colonne] ??= []).push(b))
  const rangs = Object.keys(parRang).map(Number).sort((a, b) => a - b)
  const pos: Record<string, { x: number; y: number }> = {}
  let y = 8
  rangs.forEach((rang, k) => {
    const liste = parRang[rang]
    const lignes = decoupe(liste.length)
    if (lignes.length === 1) {
      const total = largeurRangee(liste.length)
      liste.forEach((b, i) => (pos[b.id] = { x: (largeur - total) / 2 + i * (NW + GX), y }))
    } else {
      // deux lignes en quinconce : la seconde est décalée d'une demi-brique
      const [n1] = lignes
      const haut = liste.slice(0, n1), bas = liste.slice(n1)
      const l1 = largeurRangee(haut.length, GX_MUR), decal = bas.length === haut.length ? DEMI : 0
      const x0 = (largeur - l1 - decal) / 2
      haut.forEach((b, i) => (pos[b.id] = { x: x0 + i * (NW + GX_MUR), y }))
      const x1 = decal ? x0 + DEMI : x0 + (l1 - largeurRangee(bas.length, GX_MUR)) / 2
      bas.forEach((b, i) => (pos[b.id] = { x: x1 + i * (NW + GX_MUR), y: y + NH + ECART_MUR }))
      y += NH + ECART_MUR
    }
    const suivante = parRang[rangs[k + 1]]
    y += NH + (liste.length > 1 || (suivante?.length ?? 0) > 1 ? ECART_EVENTAIL : ECART)
  })
  return pos
}

function formaterDuree(debut: number, fin: number | null, maintenant: number) {
  const s = Math.max(0, Math.round((fin ?? maintenant) - debut))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`
}

/** Durée d'une étape ou d'une préparation. L'horloge d'une seconde vit ici, dans ce petit composant : le reste de la page ne se redessine pas. */
function Duree({ debut, fin, avant = '' }: { debut: number | null; fin: number | null; avant?: string }) {
  const [maintenant, setMaintenant] = useState(() => Date.now() / 1000)
  useEffect(() => {
    if (!debut || fin) return
    setMaintenant(Date.now() / 1000)
    const t = setInterval(() => setMaintenant(Date.now() / 1000), 1000)
    return () => clearInterval(t)
  }, [debut, fin])
  if (!debut) return null
  return <>{avant}{formaterDuree(debut, fin, maintenant)}</>
}

function heure(t: number) {
  const d = new Date(t * 1000)
  return `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`
}

/** Anciennes préparations : remplace le vocabulaire technique par des mots de commercial. */
function enClair(t: string) {
  return lisible(t).replace(/\bUn agent\b/g, 'Une recherche').replace(/\bun agent\b/g, 'une recherche').replace(/\bDeux agents\b/g, 'Deux recherches')
    .replace(/\bagents de veille\b/gi, 'recherches').replace(/\bagents?\b/gi, (m) => (m.toLowerCase() === 'agents' ? 'recherches' : 'recherche'))
    .replace(/\brecherches web\b/gi, 'recherches sur internet')
}

export default function Coulisses({ rdvCible }: { rdvCible: string | null }) {
  const mode = useMode()
  const { api, coulisses } = useApi()
  const signal = useSignal() // les requêtes périodiques sont abandonnées quand on quitte la page ou qu'on change de mode
  const [liste, setListe] = useState<ResumeExecution[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [exec, setExec] = useState<Execution | null>(null)
  const [blocSel, setBlocSel] = useState<string | null>(null)
  const [vide, setVide] = useState<{ rid: string | null; entreprise: string; titre?: string; fichePrete?: boolean } | null>(null)
  const ridAffiche = vide?.rid ?? exec?.rid ?? null
  const [modele, setModele] = useState<{ blocs: Bloc[]; liens: [string, string][] } | null>(null)
  const [schemaOuvert, basculerSchema] = useOuvert('schema')
  // réussite vue en direct (pas en relisant une ancienne préparation) : on la fête une fois
  const [succes, setSucces] = useState<string | null>(null)
  useEffect(() => { if (!succes) return; const t = setTimeout(() => setSucces(null), 3600); return () => clearTimeout(t) }, [succes])

  const rafraichirListe = useCallback(async () => {
    const sig = signal()
    const r = await coulisses.liste(sig)
    if (!sig.aborted) setListe(r.executions)
    return r
  }, [coulisses, signal])

  useEffect(() => {
    coulisses.modele(signal()).then((m) => setModele({ liens: m.liens, blocs: m.blocs.map((b) => ({ ...b, etat: 'attente', debut: null, fin: null, resume: null, details: [] })) })).catch(() => {})
  }, [coulisses, signal])

  // choisir un rendez-vous (menu, liste des prochains) : sa dernière préparation, sinon le schéma vierge
  const demande = useRef(0)
  const choisirRdv = useCallback(async (rid: string | null, entreprise: string, titre?: string, jour?: string) => {
    const n = ++demande.current  // seul le dernier choix compte, même si les réponses arrivent dans le désordre
    setBlocSel(null)
    const sig = signal()
    const ex = rid ? (await coulisses.parRdv(rid, sig).catch(() => ({ execution: null }))).execution : null
    if (n !== demande.current || sig.aborted) return
    if (ex) {
      setVide(null)
      if (ex.id === selId) coulisses.detail(ex.id, sig).then(setExec).catch(() => {})  // même exécution : on la réaffiche quand même
      setSelId(ex.id)
    } else {
      const j = rid ? await api.journee(jour ?? null, false, sig).catch(() => null) : null
      const fichePrete = !!j?.rendez_vous.find((r) => r.id === rid)?.fiche.prete
      if (n !== demande.current) return
      setSelId(null); setExec(null); setVide({ rid, entreprise, titre, fichePrete })
    }
  }, [selId, coulisses, api, signal])

  // sélection initiale : la dernière exécution du rendez-vous demandé, sinon la plus récente
  useEffect(() => {
    rafraichirListe().then((r) => {
      const cible = rdvCible ? r.executions.find((x) => x.rid === rdvCible) : r.executions[0]
      if (cible) setSelId(cible.id)
    }).catch(() => {})
    const t = setInterval(() => rafraichirListe().catch(() => {}), 5000)
    return () => clearInterval(t)
  }, [rdvCible, rafraichirListe])

  // suivi en direct de la préparation affichée : fermé dès qu'on change de préparation ou de page
  useEffect(() => {
    if (!selId) return
    let annule = false
    let fermer: (() => void) | null = null
    coulisses.detail(selId, signal()).then((e) => {
      if (annule) return
      setExec(e)
      if (e.statut === 'en_cours') fermer = coulisses.flux(selId, (x) => {
        if (annule) return
        setExec(x)
        if (x.statut !== 'en_cours') { rafraichirListe().catch(() => {}); if (x.statut === 'termine') setSucces(x.id) }
      })
    }).catch(() => {})
    return () => { annule = true; fermer?.() }
  }, [selId, rafraichirListe, coulisses, signal])

  const blocsAffiches = exec?.blocs ?? []

  // paramètres choisis à gauche, bouton « Générer la fiche » dans l'en-tête du workflow
  const prospection = mode === 'prospection'
  const [opts, setOptsBrut] = useState<Options>({ bourse: true, linkedin: true, angles: prospection ? 'PSEF' : 'ABC', audio: true })
  // les réglages chargés ne remplacent jamais un choix fait entre-temps
  const modifie = useRef(false)
  const setOpts: React.Dispatch<React.SetStateAction<Options>> = useCallback((v) => { modifie.current = true; setOptsBrut(v) }, [])
  useEffect(() => {
    coulisses.reglages(signal()).then((r) => { if (!modifie.current) setOptsBrut(prospection ? { ...r.options, angles: 'PSEF' } : r.options) }).catch(() => {})
  }, [prospection, coulisses, signal])
  const [envoi, setEnvoi] = useState(false)
  const generer = async () => { if (!ridAffiche) return; setEnvoi(true); try { await lancer(ridAffiche, opts) } finally { setEnvoi(false) } }
  const bouton = <BoutonGenerer rid={ridAffiche} exec={exec} envoi={envoi} succes={!!succes && succes === exec?.id} onGenerer={generer} />

  const lancer = async (rid: string, options: Options) => {
    const r = await coulisses.lancer(rid, options)
    await rafraichirListe()
    setVide(null)
    setSelId(r.id)
    setBlocSel(null)
  }

  const droite = !vide && !!exec
  return (
    <div className={cn('mx-auto grid max-w-[1500px] gap-5 px-4 pt-6 pb-10 sm:px-6',
      droite ? 'xl:grid-cols-[256px_minmax(0,1fr)_330px]' : 'xl:grid-cols-[256px_minmax(0,1fr)]')}>
      {/* ---------------------------------------------------------------- colonne gauche */}
      <aside className="space-y-5">
        <Parametres opts={opts} setOpts={setOpts} onChoisir={choisirRdv} ridAffiche={ridAffiche} />
        <Prochains selId={selId} videRid={vide?.rid ?? vide?.entreprise ?? null} onChoisir={(p) => (p.execution ? (setVide(null), setSelId(p.execution.id), setBlocSel(null)) : choisirRdv(p.rid, p.entreprise, p.titre))} />
      </aside>

      {/* ---------------------------------------------------------------- schéma */}
      <section className="relative min-w-0 self-start rounded-[24px] border border-white/80 bg-white/85 shadow-panneau">
        {vide && modele ? (
          <SchemaVierge vide={vide} modele={modele} bouton={bouton} />
        ) : exec ? (
          <>
            <EnTeteExecution exec={exec} ouvert={schemaOuvert} onBasculer={basculerSchema} bouton={bouton}
              onArreter={async () => { await coulisses.arreter(exec.id).catch(() => null); setExec(await coulisses.detail(exec.id)); rafraichirListe() }} />
            <Contenu ouvert={schemaOuvert} id="schema-etapes">
              <div className="overflow-x-auto px-4 pb-8">
                <Schema key={exec.id} blocs={blocsAffiches} liens={exec.liens} blocSel={blocSel} onChoisir={setBlocSel} />
              </div>
            </Contenu>
          </>
        ) : (
          <div className="grid min-h-[420px] place-items-center p-10 text-center text-ardoise">
            <div>
              <Layers className="mx-auto text-lavande" size={36} />
              <p className="mt-3 font-semibold text-encre">Aucune préparation pour l’instant</p>
              <p className="mt-1 text-sm">Lancez-en une à gauche : vous verrez chaque étape s’allumer ici.</p>
            </div>
          </div>
        )}
        <AnimatePresence>{succes && exec && succes === exec.id && <Reussite key="reussite" entreprise={exec.entreprise} audio={exec.options.audio} />}</AnimatePresence>
      </section>

      {/* ---------------------------------------------------------------- panneau de détail */}
      {droite && <aside className="xl:self-start">
        <AnimatePresence mode="wait">
          {vide ? null : exec && blocSel ? (
            <DetailBlocPanneau key={blocSel} bloc={blocsAffiches.find((b) => b.id === blocSel)!} onFermer={() => setBlocSel(null)} />
          ) : exec ? (
            <motion.div key="journal" className="space-y-4">
              <CompteurConso exec={exec} historique={liste} />
              <Journal exec={exec} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </aside>}
    </div>
  )
}

/* ==================================================================== schéma du workflow */

/* Règle d'or : une étape exécutée est verte, une étape non exécutée (désactivée, sautée, en échec, arrêtée) est rouge.
   À l'ouverture d'une préparation, les briques s'allument une par une, de haut en bas. */
type Issue = 'vert' | 'rouge' | 'cours' | 'neutre'
const issue = (e: EtatBloc): Issue => (e === 'fait' ? 'vert' : e === 'en_cours' ? 'cours' : e === 'saute' || e === 'erreur' || e === 'arrete' ? 'rouge' : 'neutre')
const SORTIE = [0.23, 1, 0.32, 1] as const

/** Retarde l'affichage de l'état final d'une brique (ou d'un lien) jusqu'à son tour dans la cascade. */
function useRevele(final: Issue, delai: number) {
  const reduit = useReducedMotion()
  const [revele, setRevele] = useState(() => reduit || final === 'neutre' || final === 'cours')
  useEffect(() => {
    if (revele) return
    const t = setTimeout(() => setRevele(true), delai * 1000)
    return () => clearTimeout(t)
  }, [revele, delai])
  return revele
}

function Lien({ d, source, cible, delai }: { d: string; source: Bloc; cible: Bloc; delai: number }) {
  const a = issue(source.etat), b = issue(cible.etat)
  const revele = useRevele(b, delai)
  const reduit = useReducedMotion()
  const etat = !revele ? 'neutre' : b === 'rouge' || a === 'rouge' ? 'rouge' : a === 'vert' && b === 'vert' ? 'vert' : a === 'vert' && b === 'cours' ? 'actif' : 'neutre'
  return (
    <g>
      <path d={d} fill="none" strokeWidth={2} className="stroke-nuage" />
      {etat === 'vert' && (
        <motion.path key="vert" d={d} fill="none" strokeWidth={2.5} strokeLinecap="round" className="stroke-ok"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, ease: SORTIE }} />
      )}
      {etat === 'rouge' && (
        <motion.path key="rouge" d={d} fill="none" strokeWidth={2} strokeDasharray="3 5" className="stroke-erreur/60"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }} />
      )}
      {etat === 'actif' && (
        <>
          <path d={d} fill="none" strokeWidth={2} strokeDasharray="6 6" className="stroke-violet" style={{ animation: 'flux 0.6s linear infinite' }} />
          {!reduit && <circle r={4.5} className="fill-violet"><animateMotion dur="1.1s" repeatCount="indefinite" path={d} /></circle>}
        </>
      )}
    </g>
  )
}

/** Réduit le schéma pour qu'il tienne toujours dans la largeur de sa colonne (cinq sources côte à côte). */
function useEchelle(largeur: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [echelle, setEchelle] = useState(1)
  useEffect(() => {
    const el = ref.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(() => {
      const st = getComputedStyle(el)
      const dispo = el.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight)
      setEchelle(Math.min(1, dispo / largeur))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [largeur])
  return { ref, echelle }
}

function Schema({ blocs, liens, blocSel, onChoisir }: {
  blocs: Bloc[]; liens: [string, string][]; blocSel: string | null; onChoisir: (id: string) => void
}) {
  const LARGEUR = largeurSchema(blocs)
  const { ref, echelle } = useEchelle(LARGEUR)
  const pos = positions(blocs, LARGEUR)
  const parId = Object.fromEntries(blocs.map((b) => [b.id, b]))
  const hauteur = Math.max(...Object.values(pos).map((p) => p.y)) + NH + 16
  // ordre de la cascade : rangée par rangée, de gauche à droite
  const ordre = Object.fromEntries([...blocs].sort((a, b) => a.colonne - b.colonne || pos[a.id].x - pos[b.id].x).map((b, i) => [b.id, 0.15 + i * 0.12]))
  return (
    <div ref={ref} className="relative mx-auto" style={{ width: LARGEUR, height: hauteur, zoom: echelle }}>
      <svg className="absolute inset-0 overflow-visible" width={LARGEUR} height={hauteur} aria-hidden>
        {liens.map(([de, vers]) => {
          const a = parId[de], b = parId[vers]
          if (!a || !b) return null
          const p1 = { x: pos[de].x + NW / 2, y: pos[de].y + NH }, p2 = { x: pos[vers].x + NW / 2, y: pos[vers].y }
          const my = (p1.y + p2.y) / 2
          return <Lien key={de + vers} d={`M ${p1.x} ${p1.y} C ${p1.x} ${my}, ${p2.x} ${my}, ${p2.x} ${p2.y}`} source={a} cible={b} delai={ordre[vers] - 0.08} />
        })}
      </svg>
      {blocs.map((b) => (
        <Noeud key={b.id} b={b} x={pos[b.id].x} y={pos[b.id].y} actif={blocSel === b.id} onClick={() => onChoisir(b.id)} delai={ordre[b.id]} />
      ))}
    </div>
  )
}

function compteurs(b: Bloc) {
  const n = (t: DetailBloc['type']) => b.details.filter((d) => d.type === t).length
  const parts = []
  if (n('recherche')) parts.push(`${n('recherche')} recherche${n('recherche') > 1 ? 's' : ''}`)
  if (n('lecture')) parts.push(`${n('lecture')} site${n('lecture') > 1 ? 's' : ''}`)
  if (n('fait')) parts.push(`${n('fait')} fait${n('fait') > 1 ? 's' : ''}`)
  return parts.join(' · ')
}

function Noeud({ b, x, y, actif, onClick, delai }: { b: Bloc; x: number; y: number; actif: boolean; onClick: () => void; delai: number }) {
  const Icone = ICONES[b.id] ?? Layers
  const c = compteurs(b)
  const reduit = useReducedMotion()
  const revele = useRevele(issue(b.etat), delai)
  const etat: EtatBloc = revele ? b.etat : 'attente'
  const is = issue(etat)
  // chaque passage au vert ou au rouge déclenche son animation (cascade d'ouverture comme changement en direct)
  const precedent = useRef(is)
  const [coup, setCoup] = useState<{ type: 'vert' | 'rouge'; n: number } | null>(null)
  useEffect(() => {
    if (precedent.current === is) return
    precedent.current = is
    if (is === 'vert' || is === 'rouge') setCoup((k) => ({ type: is, n: (k?.n ?? 0) + 1 }))
  }, [is])
  const anim = reduit || !coup ? { transform: is === 'cours' ? 'scale(1.03)' : 'scale(1)' }
    : coup.type === 'vert' ? { transform: ['scale(1)', 'scale(1.08)', 'scale(0.985)', 'scale(1)'] }
    : { transform: ['translateX(0px)', 'translateX(-7px)', 'translateX(6px)', 'translateX(-4px)', 'translateX(2px)', 'translateX(0px)'] }
  const libelle = is === 'vert' ? 'Exécutée' : is === 'rouge' ? (etat === 'erreur' ? 'Échec' : etat === 'arrete' ? 'Arrêtée' : 'Non exécutée') : LIBELLE_ETAT[etat]
  return (
    <motion.button key={coup ? `${coup.type}${coup.n}` : 'repos'} onClick={onClick} initial={false} animate={anim}
      transition={coup ? { duration: coup.type === 'vert' ? 0.5 : 0.45, ease: SORTIE } : { type: 'spring', bounce: 0.3, duration: 0.5 }}
      className={cn('absolute rounded-2xl border text-left transition-[background-color,border-color,box-shadow] duration-300',
        is === 'neutre' && 'border-nuage bg-white',
        is === 'cours' && 'border-violet bg-white shadow-noeud',
        is === 'vert' && 'border-ok/50 bg-ok-fond',
        is === 'rouge' && 'border-erreur/40 bg-erreur-fond',
        actif && 'ring-2 ring-encre ring-offset-2 ring-offset-white')}
      style={{ left: x, top: y, width: NW, height: NH }}>
      {/* calque qui balaie la brique de gauche à droite, puis s'efface */}
      {coup && !reduit && (
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <motion.span className={cn('absolute inset-0 origin-left', coup.type === 'vert' ? 'bg-ok/30' : 'bg-erreur/25')}
            initial={{ transform: 'scaleX(0)', opacity: 1 }} animate={{ transform: 'scaleX(1)', opacity: [1, 1, 0] }} transition={{ duration: 0.6, ease: SORTIE }} />
        </span>
      )}
      {/* anneau qui s'ouvre autour de la brique */}
      {coup && !reduit && (
        <motion.span aria-hidden className={cn('pointer-events-none absolute -inset-px rounded-2xl border-2', coup.type === 'vert' ? 'border-ok' : 'border-erreur')}
          initial={{ transform: 'scale(1)', opacity: 0.9 }} animate={{ transform: 'scale(1.14)', opacity: 0 }} transition={{ duration: 0.7, ease: SORTIE }} />
      )}
      {is === 'cours' && <span className="absolute inset-0 overflow-hidden rounded-2xl"><BorderTrail size={70} className="bg-gradient-to-l from-violet via-violet-vif to-transparent" transition={{ repeat: Infinity, duration: 2.5, ease: 'linear' }} /></span>}
      <div className="relative flex h-full flex-col justify-between p-3">
        <div className="flex items-start gap-2" title={b.titre}>
          <span className={cn('relative grid size-6 shrink-0 place-items-center rounded-lg transition-colors duration-300',
            is === 'vert' ? 'bg-ok text-white' : is === 'cours' ? 'bg-violet text-white' : is === 'rouge' ? 'bg-erreur text-white' : 'bg-nuage text-ardoise')}>
            {is === 'vert' || is === 'rouge' ? (
              <svg key={`${is}${coup?.n ?? 0}`} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {is === 'vert'
                  ? <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={reduit ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.12, ease: SORTIE }} />
                  : <>
                      <motion.path d="M7 7l10 10" initial={reduit ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.2, delay: 0.1, ease: SORTIE }} />
                      <motion.path d="M17 7L7 17" initial={reduit ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.2, delay: 0.25, ease: SORTIE }} />
                    </>}
              </svg>
            ) : is === 'cours' ? <Loader2 size={14} className="animate-spin" /> : <Icone size={14} />}
          </span>
          <div className={cn('relative line-clamp-2 min-w-0 text-[13px] font-semibold leading-[1.2] hyphens-auto [overflow-wrap:break-word]', is === 'neutre' ? 'text-ardoise' : 'text-encre')}>{b.titre}</div>
        </div>
        <div className="min-w-0">
          <div className={cn('text-xs font-semibold whitespace-nowrap', is === 'vert' ? 'text-ok' : is === 'cours' ? 'text-violet' : is === 'rouge' ? 'text-erreur' : 'text-brume')}>
            {libelle}{(is === 'vert' || is === 'cours') && <Duree debut={b.debut} fin={b.fin} avant=" · " />}
          </div>
          <div className="truncate text-xs text-ardoise">
            {is === 'cours' && c ? <TextShimmer className={cn('text-xs', SHIMMER)} duration={1.6}>{c}</TextShimmer> : lisible(revele ? (c || b.resume || b.source || '') : (b.source || ''))}
          </div>
        </div>
      </div>
    </motion.button>
  )
}

/* ==================================================================== en-tête et panneaux */

/** Préparation réussie : une coche qui se dessine, un anneau qui s'ouvre, puis tout s'efface. */
function Reussite({ entreprise, audio }: { entreprise: string; audio: boolean }) {
  const ease = [0.23, 1, 0.32, 1] as const
  return (
    <motion.div role="status" className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-[24px] bg-white/55 backdrop-blur-[2px]"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }} transition={{ duration: 0.2 }}>
      <motion.div className="flex flex-col items-center rounded-[28px] bg-white px-10 py-8 text-center shadow-[0_30px_60px_-30px_rgba(18,10,41,0.45)] ring-1 ring-encre/5"
        initial={{ opacity: 0, transform: 'translateY(10px) scale(0.96)' }} animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }} transition={{ duration: 0.35, ease }}>
        <span className="relative grid size-20 place-items-center">
          <motion.span aria-hidden className="absolute inset-0 rounded-full bg-ok/25"
            initial={{ transform: 'scale(0.8)', opacity: 0.8 }} animate={{ transform: 'scale(1.9)', opacity: 0 }} transition={{ duration: 1.1, delay: 0.25, ease }} />
          <motion.span className="grid size-20 place-items-center rounded-full bg-ok text-white shadow-[0_14px_30px_-12px_#146B33]"
            initial={{ transform: 'scale(0.7)' }} animate={{ transform: 'scale(1)' }} transition={{ type: 'spring', duration: 0.5, bounce: 0.35 }}>
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, delay: 0.2, ease }} />
            </svg>
          </motion.span>
        </span>
        <motion.p className="titre mt-5 text-2xl text-encre" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35, duration: 0.3 }}>Fiche prête</motion.p>
        <motion.p className="mt-1 max-w-xs text-sm text-ardoise" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45, duration: 0.3 }}>
          La fiche de {entreprise}{audio ? ' et sa version à écouter sont prêtes' : ' est prête'}. Elle partira sur votre téléphone 30 minutes avant le rendez-vous.
        </motion.p>
      </motion.div>
    </motion.div>
  )
}

function EnTeteExecution({ exec, ouvert, onBasculer, onArreter, bouton }: {
  exec: Execution; ouvert: boolean; onBasculer: () => void; onArreter: () => Promise<void> | void; bouton: React.ReactNode
}) {
  const [arret, setArret] = useState(false)
  useEffect(() => { if (exec.statut !== 'en_cours') setArret(false) }, [exec.statut])
  const faits = exec.blocs.filter((b) => b.etat === 'fait' || b.etat === 'saute').length
  const st = STATUT[exec.statut]
  return (
    <div className="border-b border-nuage px-6 pt-5 pb-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight text-encre">
              <button type="button" onClick={onBasculer} aria-expanded={ouvert} aria-controls="schema-etapes" className="group flex items-center gap-2 text-left">
                <Fleche ouvert={ouvert} /> Préparation · {exec.entreprise}
              </button>
            </h2>
            <span className={cn('flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', st.classe)}>{exec.statut === 'echec' && <X size={12} strokeWidth={3} aria-hidden />}{st.libelle}</span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ardoise">
            <span className="flex items-center gap-1"><Zap size={13} /> {lisible(exec.declencheur.libelle)}</span>
            <span className="flex items-center gap-1"><Clock size={13} /> <Duree debut={exec.debut} fin={exec.fin} /></span>
            <span>{faits} étapes sur {exec.blocs.length}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {exec.statut === 'en_cours' && (
            <button onClick={async () => { setArret(true); try { await onArreter() } finally { setArret(false) } }} disabled={arret}
              className="flex h-11 items-center gap-1.5 rounded-full border border-erreur/40 bg-white px-4 text-sm text-erreur transition hover:bg-erreur-fond disabled:opacity-70">
              {arret ? <Loader2 size={13} className="animate-spin" /> : <Square size={13} fill="currentColor" />} {arret ? 'J’arrête...' : 'Arrêter'}
            </button>
          )}
          {bouton}
        </div>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-nuage">
        <motion.div className={cn('h-full origin-left rounded-full', exec.statut === 'termine' ? 'bg-ok' : exec.statut === 'echec' ? 'bg-erreur' : 'bg-gradient-to-r from-violet to-violet-vif')}
          initial={false} animate={{ transform: `scaleX(${faits / exec.blocs.length})` }} transition={{ type: 'spring', bounce: 0, duration: 0.6 }} />
      </div>
      <p className="mt-2.5 text-xs text-brume">{exec.statut === 'echec' ? `Interrompue à l’étape ${faits + 1} sur ${exec.blocs.length}. ` : ''}Cliquez sur une étape pour voir ce qu’elle a fait.</p>
    </div>
  )
}

function Panneau({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, x: 16}} animate={{ opacity: 1, x: 0}} exit={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.25 }} className="max-h-[calc(100vh-8rem)] overflow-y-auto rounded-[24px] border border-white/80 bg-white/90 p-5 shadow-panneau">
      {children}
    </motion.div>
  )
}

function Section({ titre, icone: Icone, children }: { titre: string; icone: typeof Zap; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-[0.12em] text-brume uppercase"><Icone size={13} /> {titre}</div>
      {children}
    </div>
  )
}

function DetailBlocPanneau({ bloc, onFermer }: { bloc: Bloc; onFermer: () => void }) {
  const Icone = ICONES[bloc.id] ?? Layers
  const de = (t: DetailBloc['type']) => bloc.details.filter((d) => d.type === t)
  return (
    <Panneau>
      <div className="flex items-start gap-3">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', bloc.etat === 'fait' ? 'bg-ok text-white' : bloc.etat === 'en_cours' ? 'bg-violet text-white' : 'bg-nuage text-ardoise')}><Icone size={18} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-encre">{bloc.titre}</h3>
          <p className="text-[13px] text-ardoise">{LIBELLE_ETAT[bloc.etat]}<Duree debut={bloc.debut} fin={bloc.fin} avant=" · " /></p>
        </div>
        <button onClick={onFermer} aria-label="Fermer" className="rounded-full p-1.5 text-brume hover:bg-voile hover:text-violet"><X size={16} /></button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        {bloc.source && <div className="rounded-xl bg-creme p-2.5"><div className="text-brume">Source</div><div className="mt-0.5 font-semibold text-encre">{lisible(bloc.source)}</div></div>}
      </div>
      {bloc.resume && <p className="mt-4 rounded-xl bg-voile p-3 text-sm text-violet-profond">{lisible(bloc.resume)}</p>}

      {de('recherche').length > 0 && (
        <Section titre="Recherches lancées" icone={Search}>
          <AnimatedGroup preset="fade" className="space-y-1.5">
            {de('recherche').map((d, i) => <p key={i} className="flex gap-2 text-sm text-encre"><CornerDownRight size={14} className="mt-0.5 shrink-0 text-lavande" />« {requeteLisible(d.texte)} »</p>)}
          </AnimatedGroup>
        </Section>
      )}
      {de('lecture').length > 0 && (
        <Section titre="Sites consultés" icone={Globe}>
          <div className="space-y-1.5">
            {de('lecture').map((d, i) => (
              <a key={i} href={d.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-encre hover:bg-creme">
                <span className="truncate">{lisible(d.texte)}</span><ExternalLink size={13} className="shrink-0 text-brume" />
              </a>
            ))}
          </div>
        </Section>
      )}
      {de('fait').length > 0 && (
        <Section titre="Faits retenus pour la fiche" icone={Newspaper}>
          <div className="space-y-2">
            {de('fait').map((d, i) => (
              <div key={i} className="rounded-xl border border-nuage p-3">
                <p className="text-sm font-semibold text-encre">{lisible(d.texte)}</p>
                <p className="mt-1 text-xs text-ardoise">{lisible(d.source)} · {d.date}</p>
                {d.interet && <p className="mt-1.5 text-xs text-violet-profond">Pour la visite : {lisible(d.interet)}</p>}
                {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-violet hover:underline">Ouvrir la source <ExternalLink size={11} /></a>}
              </div>
            ))}
          </div>
        </Section>
      )}
      {(de('chiffre').length > 0 || de('source').length > 0 || de('texte').length > 0) && (
        <Section titre="Ce qui a été lu et calculé" icone={FileSpreadsheet}>
          <ul className="space-y-1.5 text-sm text-encre">
            {[...de('source'), ...de('chiffre'), ...de('texte')].map((d, i) => (
              <li key={i} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-lavande" />
                {d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="hover:text-violet hover:underline">{lisible(d.texte)}</a> : lisible(d.texte)}</li>
            ))}
          </ul>
        </Section>
      )}
      {bloc.details.length === 0 && !bloc.resume && <p className="mt-6 text-sm text-brume">{bloc.etat === 'attente' ? 'Cette étape n’a pas encore commencé.' : 'Pas de détail pour cette étape.'}</p>}
    </Panneau>
  )
}

function Journal({ exec }: { exec: Execution }) {
  const sources = exec.blocs.flatMap((b) => b.details.filter((d) => d.type === 'fait'))
  const [ouvert, basculer] = useOuvert('journal')
  return (
    <Panneau>
      <h2 className="text-lg text-encre">
        <button type="button" onClick={basculer} aria-expanded={ouvert} aria-controls="fil-preparation" className="group flex w-full items-center justify-between gap-2 text-left">
          Le fil de la préparation <Fleche ouvert={ouvert} />
        </button>
      </h2>
      <Contenu ouvert={ouvert} id="fil-preparation">
      <p className="mt-1 text-[13px] text-ardoise">Ce que je fais, étape par étape, en direct.</p>
      <ol className="relative mt-4 space-y-3 border-l border-nuage pl-4">
        <AnimatePresence initial={false}>
          {exec.journal.filter((j) => !TECHNIQUE.test(j.texte)).map((j, i) => (
            <motion.li key={i} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="relative text-sm text-encre">
              <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-white bg-violet" />
              <span className="mr-2 text-xs text-brume">{heure(j.t)}</span>{enClair(j.texte)}
            </motion.li>
          ))}
        </AnimatePresence>
        {exec.statut === 'en_cours' && <li className="text-sm"><TextShimmer className={SHIMMER}>Je travaille...</TextShimmer></li>}
        {exec.message && exec.statut !== 'en_cours' && exec.journal.length === 0 && <li className="text-sm font-semibold text-encre">{TECHNIQUE.test(exec.message) ? 'La préparation s’est arrêtée avant la fin. Vous pouvez la refaire.' : exec.message.replace(/═+[^═]*═+/g, '').replace(/🗣️.*$/s, '').trim().slice(0, 500)}</li>}
      </ol>
      {sources.length > 0 && (
        <div className="mt-6 rounded-xl bg-creme p-3 text-xs text-ardoise">
          <b className="text-encre">{sources.length} faits</b> trouvés sur internet, chacun avec sa source et sa date. Cliquez sur une étape « Presse » pour les voir.
        </div>
      )}
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <Opt nom="Bourse" actif={exec.options.bourse} />
        <Opt nom="LinkedIn" actif={exec.options.linkedin !== false} />
        <Opt nom={exec.type === 'prospect' ? `Recherches : ${exec.options.angles.length} sur 4` : exec.options.angles ? `Presse : ${exec.options.angles.length} angle${exec.options.angles.length > 1 ? 's' : ''}` : 'Pas de presse'} actif={!!exec.options.angles} />
        <Opt nom="Audio" actif={exec.options.audio} />
      </div>
      </Contenu>
    </Panneau>
  )
}

function Opt({ nom, actif }: { nom: string; actif: boolean }) {
  return <div className={cn('rounded-lg px-2 py-1.5', actif ? 'bg-ok-fond text-ok' : 'bg-creme text-ardoise')}>{actif ? nom : `${nom} : non`}</div>
}

/* ==================================================================== colonne gauche */

function Carte({ titre, icone: Icone, children, ouvert = true }: { titre: string; icone: typeof Zap; children: React.ReactNode; ouvert?: boolean }) {
  const [o, basculer] = useOuvert(`carte.${titre}`, ouvert)
  return (
    <div className="rounded-[20px] border border-white/80 bg-white/85 shadow-carte">
      <button onClick={basculer} aria-expanded={o} className="group flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-encre">
        <Icone size={15} className="text-violet" /> {titre}
        <span className="ml-auto"><Fleche ouvert={o} /></span>
      </button>
      <AnimatePresence initial={false}>
        {o && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Interrupteur({ actif, onChange, libelle, icone: Icone }: { actif: boolean; onChange: (v: boolean) => void; libelle: string; icone?: React.ComponentType<{ size?: number; className?: string }> }) {
  const vert = useMode() === 'prospection'
  return (
    <button role="switch" aria-checked={actif} onClick={() => onChange(!actif)} className="flex w-full items-center justify-between gap-3 py-1.5 text-sm text-encre">
      <span className={cn('flex items-center gap-2 transition-colors', !actif && 'text-ardoise')}>{Icone && <Icone size={14} className={actif ? (vert ? 'text-ok' : 'text-violet') : 'text-brume'} />}{libelle}</span>
      <span className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', actif ? (vert ? 'bg-ok' : 'bg-violet') : 'bg-nuage')}>
        <motion.span layout transition={{ type: 'spring', bounce: 0.3, duration: 0.35 }} className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow', actif ? 'right-0.5' : 'left-0.5')} />
      </span>
    </button>
  )
}

/** Les recherches menées en parallèle, chacune activable. Clients : trois presses par « angles » (A, B, C).
    Prospection : profil (P), signal (S), enjeux du secteur (E), fournisseurs (F), plus LinkedIn et bourse. */
const AGENTS_PROSPECT: { cle: string; libelle: string; icone: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { cle: 'P', libelle: 'Profil de l’interlocuteur', icone: UserSearch },
  { cle: 'S', libelle: 'Signal déclencheur', icone: Radar },
  { cle: 'E', libelle: 'Enjeux du secteur', icone: Factory },
  { cle: 'F', libelle: 'Fournisseur en place', icone: Handshake },
  { cle: 'linkedin', libelle: 'Page LinkedIn', icone: Linkedin },
  { cle: 'bourse', libelle: 'Cours de bourse', icone: TrendingUp },
]
const AGENTS_CLIENT: { cle: string; libelle: string; icone: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { cle: 'bourse', libelle: 'Cours de bourse', icone: TrendingUp },
  { cle: 'linkedin', libelle: 'Page LinkedIn', icone: Linkedin },
  { cle: 'A', libelle: 'Presse : résultats', icone: Newspaper },
  { cle: 'B', libelle: 'Presse : dirigeants', icone: Newspaper },
  { cle: 'C', libelle: 'Presse : usines, RSE', icone: Newspaper },
]
const agentActif = (o: Options, cle: string) => (cle === 'bourse' ? o.bourse : cle === 'linkedin' ? o.linkedin !== false : o.angles.includes(cle))
const basculerAgent = (o: Options, cle: string, v: boolean): Options =>
  cle === 'bourse' ? { ...o, bourse: v } : cle === 'linkedin' ? { ...o, linkedin: v }
    : { ...o, angles: (v ? [...o.angles, cle] : [...o.angles].filter((l) => l !== cle)).filter((l, i, t) => t.indexOf(l) === i).sort().join('') }


/** Le prochain rendez-vous, les deux d'avant et les deux d'après. */
function rendezVousProches(rdvs: RdvMenu[]) {
  const i = rdvs.findIndex((r) => !r.passe)
  const prochain = i < 0 ? rdvs.length - 1 : i
  return rdvs.slice(Math.max(0, prochain - 2), prochain + 3)
}

function Parametres({ opts, setOpts, onChoisir, ridAffiche }: {
  opts: Options; setOpts: React.Dispatch<React.SetStateAction<Options>>
  onChoisir: (rid: string, entreprise: string, titre?: string, jour?: string) => void; ridAffiche: string | null
}) {
  const mode = useMode()
  const { coulisses } = useApi()
  const signal = useSignal()
  const [rdvs, setRdvs] = useState<RdvMenu[]>([])
  const [rid, setRid] = useState('')
  useEffect(() => { coulisses.rendezVous(signal()).then((r) => setRdvs(rendezVousProches(r.rendez_vous))).catch(() => {}) }, [coulisses, signal])
  useEffect(() => { if (ridAffiche && rdvs.some((r) => r.id === ridAffiche)) setRid(ridAffiche) }, [ridAffiche, rdvs])
  const prochain = rdvs.find((r) => !r.passe)?.id
  const AGENTS = mode === 'prospection' ? AGENTS_PROSPECT : AGENTS_CLIENT
  const actifs = AGENTS.filter((a) => agentActif(opts, a.cle)).length
  return (
    <Carte titre="Ma préparation" icone={SlidersHorizontal}>
      <label className="mb-1.5 block text-sm font-semibold text-encre" htmlFor="rdv-prepa">Rendez-vous</label>
      <select id="rdv-prepa" value={rid} onChange={(e) => { setRid(e.target.value); const r = rdvs.find((x) => x.id === e.target.value); if (r) onChoisir(r.id, r.entreprise, undefined, r.jour) }} className="w-full rounded-xl border border-nuage bg-creme px-3 py-2 text-sm text-encre focus:border-violet">
        <option value="" disabled>Choisir un rendez-vous...</option>
        {Object.entries(rdvs.reduce<Record<string, RdvMenu[]>>((g, r) => ((g[r.jour_long] ??= []).push(r), g), {})).map(([jour, liste]) => (
          <optgroup key={jour} label={jour.charAt(0).toUpperCase() + jour.slice(1)}>
            {liste.map((r) => <option key={r.id} value={r.id}>{r.heure} · {r.entreprise}{r.passe ? ' (passé)' : r.id === prochain ? ' (prochain)' : ' (à venir)'}</option>)}
          </optgroup>
        ))}
      </select>
      <div className="mt-4">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-sm font-semibold text-encre">Recherches</span>
          <span className="text-xs text-ardoise tabular-nums">{actifs} sur {AGENTS.length}</span>
        </div>
        <div className="divide-y divide-nuage">
          {AGENTS.map((a) => (
            <Interrupteur key={a.cle} libelle={a.libelle} icone={a.icone} actif={agentActif(opts, a.cle)} onChange={(v) => setOpts((o) => basculerAgent(o, a.cle, v))} />
          ))}
        </div>
        <div className="mt-2 border-t border-nuage pt-1">
          <Interrupteur libelle="Version à écouter" icone={AudioLines} actif={opts.audio} onChange={(v) => setOpts((o) => ({ ...o, audio: v }))} />
        </div>
      </div>
    </Carte>
  )
}

/** Un seul bouton, dans l'en-tête du workflow, qui raconte ce qui se passe : lancement, avancement, réussite. */
function BoutonGenerer({ rid, exec, envoi, succes, onGenerer }: { rid: string | null; exec: Execution | null; envoi: boolean; succes: boolean; onGenerer: () => void }) {
  const sienne = exec && exec.rid === rid ? exec : null
  const enCours = sienne?.statut === 'en_cours'
  const faits = sienne ? sienne.blocs.filter((b) => b.etat === 'fait' || b.etat === 'saute').length : 0
  const progression = enCours ? Math.max(0.06, faits / sienne!.blocs.length) : 0
  const etat: 'pret' | 'envoi' | 'cours' | 'fini' = envoi ? 'envoi' : enCours ? 'cours' : succes && sienne ? 'fini' : 'pret'
  const libelle = { pret: 'Générer la fiche', envoi: 'Je lance...', cours: `En cours · ${faits} sur ${sienne?.blocs.length ?? 0}`, fini: 'Fiche prête' }[etat]
  const Icone = { pret: Sparkles, envoi: Loader2, cours: Loader2, fini: Check }[etat]
  return (
    <button disabled={!rid || etat !== 'pret'} aria-live="polite" onClick={onGenerer}
      className={cn('relative flex h-11 min-w-[188px] items-center justify-center overflow-hidden rounded-full px-5 text-sm font-semibold text-white transition-[background-color,box-shadow] duration-300',
        etat === 'fini' ? 'bg-ok shadow-[0_10px_24px_-12px_#146B33]' : etat === 'pret' ? 'bg-violet shadow-bouton hover:bg-violet-vif' : 'bg-violet-profond',
        !rid && 'opacity-60')}>
      {/* le bouton se remplit au fil des étapes */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-full origin-left bg-violet transition-transform duration-700 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
        style={{ transform: `scaleX(${etat === 'cours' ? progression : 0})` }} />
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={etat} className="relative flex items-center gap-2"
          initial={{ opacity: 0, transform: 'translateY(6px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }}
          exit={{ opacity: 0, transform: 'translateY(-6px)' }} transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}>
          <Icone size={15} className={cn((etat === 'envoi' || etat === 'cours') && 'animate-spin')} />
          <span className="tabular-nums">{libelle}</span>
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

function Prochains({ selId, videRid, onChoisir }: { selId: string | null; videRid: string | null; onChoisir: (p: Prochain) => void }) {
  const [liste, setListe] = useState<Prochain[]>([])
  const [lu, setLu] = useState<string | null>(null)
  const { coulisses } = useApi()
  const signal = useSignal()
  useEffect(() => {
    const lire = () => coulisses.prochains(signal()).then((r) => { setListe(r.prochains); setLu(r.lu_a) }).catch(() => {})
    lire()
    const t = setInterval(lire, 30000)
    return () => clearInterval(t)
  }, [coulisses, signal])
  return (
    <Carte titre="Mes rendez-vous" icone={CalendarClock}>
      <p className="-mt-1 mb-2 text-xs text-brume">Le prochain rendez-vous et les deux derniers passés{lu ? `, agenda lu à ${lu}` : ''}. La liste avance au fil de la journée.</p>
      <div className="space-y-1.5">
        <AnimatePresence initial={false} mode="popLayout">
          {liste.map((p) => {
            const actif = (p.execution && p.execution.id === selId) || (!p.execution && (p.rid ?? p.entreprise) === videRid)
            return (
              <motion.button layout key={p.cle} onClick={() => onChoisir(p)}
                initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12, height: 0 }}
                className={cn('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition', actif ? 'bg-voile' : 'hover:bg-creme')}>
                <span className={cn('size-2.5 shrink-0 self-start mt-1.5 rounded-full', !p.passe && !p.maintenant && 'ring-4 ring-voile', !p.crm ? 'bg-alerte' : p.execution?.statut === 'termine' ? 'bg-ok' : p.execution?.statut === 'en_cours' ? 'animate-pulse bg-violet' : 'bg-brume')} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-encre">
                    <span className="truncate">{p.entreprise}</span>
                    {!p.passe && !p.maintenant && <span className="shrink-0 rounded-full bg-voile px-1.5 text-xs font-semibold text-violet">Prochain</span>}
                    {p.nouveau && <span className="shrink-0 rounded-full bg-violet px-1.5 text-xs font-semibold tracking-wider text-white uppercase">Nouveau</span>}
                  </div>
                  <div className="line-clamp-2 text-xs leading-snug text-ardoise">
                    {p.maintenant ? 'En ce moment' : `${p.jour.charAt(0).toUpperCase()}${p.jour.slice(1)} à ${p.heure}`}{p.passe ? ' · passé' : !p.maintenant ? ' · à venir' : ''} · {!p.crm ? 'absent du CRM' : p.execution ? (p.execution.statut === 'termine' ? `fiche prête, ${p.execution.faits} faits` : p.execution.statut === 'en_cours' ? 'en préparation' : 'à relancer') : 'pas encore préparée'}
                  </div>
                </div>
              </motion.button>
            )
          })}
        </AnimatePresence>
        {liste.length === 0 && <p className="text-sm text-brume">Aucun rendez-vous dans le CRM ni dans l’agenda.</p>}
      </div>
    </Carte>
  )
}

function SchemaVierge({ vide, modele, bouton }: { vide: { rid: string | null; entreprise: string; titre?: string; fichePrete?: boolean }; modele: { blocs: Bloc[]; liens: [string, string][] }; bouton: React.ReactNode }) {
  return (
    <>
      <div className="border-b border-nuage px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-encre">Préparation · {vide.entreprise}</h2>
              <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', !vide.rid ? 'bg-alerte-fond text-alerte' : vide.fichePrete ? 'bg-ok-fond text-ok' : 'bg-creme text-ardoise')}>
                {!vide.rid ? 'Absent du CRM' : vide.fichePrete ? 'Fiche prête' : 'Pas encore préparée'}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-ardoise">{!vide.rid ? `« ${vide.titre ?? vide.entreprise} » est dans votre agenda, mais le CRM ne connaît ni ce client ni ce rendez-vous.`
              : vide.fichePrete ? 'La fiche existe, mais elle a été préparée avant l’enregistrement des déroulés. Générez-la de nouveau pour voir chaque étape s’allumer.'
              : 'Voici les étapes que je vais suivre. Générez la fiche pour les voir s’allumer.'}</p>
          </div>
          {vide.rid && bouton}
        </div>
      </div>
      <div className="relative overflow-x-auto px-4 pb-8">
        <div className={cn(!vide.rid && 'pointer-events-none opacity-25')}>
          <Schema blocs={modele.blocs} liens={modele.liens} blocSel={null} onChoisir={() => {}} />
        </div>
        {!vide.rid && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', bounce: 0.35 }}
            className="absolute inset-x-0 top-24 mx-auto max-w-sm rounded-2xl border-2 border-dashed border-alerte/50 bg-white p-6 text-center shadow-xl">
            <motion.span animate={{ rotate: [0, -10, 10, -6, 6, 0] }} transition={{ duration: 0.6, delay: 0.3 }} className="mx-auto grid size-12 place-items-center rounded-2xl bg-alerte-fond text-alerte"><SearchX size={22} /></motion.span>
            <p className="mt-3 font-semibold text-encre">Aucune information dans le CRM</p>
            <p className="mt-1 text-sm text-ardoise">Sans client ni contact dans le CRM, je ne peux pas préparer de fiche. Ajoutez le rendez-vous dans le CRM et déposez le nouvel export.</p>
          </motion.div>
        )}
      </div>
    </>
  )
}

function Historique({ liste, selId, onChoisir }: { liste: ResumeExecution[]; selId: string | null; onChoisir: (id: string) => void }) {
  return (
    <Carte titre="Historique" icone={History}>
      <div className="max-h-[340px] space-y-1 overflow-y-auto pr-1">
        {liste.length === 0 && <p className="text-sm text-brume">Aucune préparation enregistrée.</p>}
        {liste.map((e) => (
          <button key={e.id} onClick={() => onChoisir(e.id)}
            className={cn('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition', selId === e.id ? 'bg-voile' : 'hover:bg-creme')}>
            <span className={cn('size-2.5 shrink-0 rounded-full', e.statut === 'termine' ? 'bg-ok' : e.statut === 'en_cours' ? 'animate-pulse bg-violet' : e.statut === 'arrete' ? 'bg-alerte' : 'bg-erreur')} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-encre">{e.entreprise}</div>
              <div className="truncate text-xs text-ardoise">{new Date(e.debut * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à {heure(e.debut)} · {e.declencheur.type === 'agenda' ? 'agenda' : e.declencheur.type === 'relance' ? 'relance' : 'clic'}</div>
            </div>
            {e.faits > 0 && <span className="shrink-0 rounded-full bg-creme px-2 py-0.5 text-xs text-ardoise">{e.faits} faits</span>}
          </button>
        ))}
      </div>
    </Carte>
  )
}

export function ReglagesAuto() {
  const [r, setR] = useState<Reglages | null>(null)
  const [sauve, setSauve] = useState(false)
  const { coulisses } = useApi()
  const signal = useSignal()
  const touche = useRef(false) // un réglage modifié pendant le chargement n'est pas écrasé par la réponse
  useEffect(() => { coulisses.reglages(signal()).then((x) => { if (!touche.current) setR(x) }).catch(() => {}) }, [coulisses, signal])
  const maj = async (n: Partial<Reglages>) => {
    touche.current = true
    const res = await coulisses.enregistrer(n)
    setR(res)
    setSauve(true)
    setTimeout(() => setSauve(false), 1500)
  }
  if (!r) return null
  return (
    <div>
      <div className="mb-2">
        <div className="mb-1.5 text-sm text-encre">Rédaction de la fiche</div>
        <div className="flex gap-1.5">
          {([['sonnet', 'Rapide (2 min)'], ['opus', 'Plus soignée (plus lente)']] as const).map(([m, l]) => (
            <button key={m} aria-pressed={r.modele === m} onClick={() => maj({ modele: m })} className={cn('flex-1 rounded-lg px-2 py-1.5 text-xs transition', r.modele === m ? 'bg-violet text-white' : 'bg-creme text-ardoise hover:text-encre')}>{l}</button>
          ))}
        </div>
      </div>
      <Interrupteur libelle="Surveiller mon agenda" actif={r.surveillance} onChange={(v) => maj({ surveillance: v })} />
      <label className="mt-2 block text-sm text-encre">Envoyer la fiche <b className="text-violet">{r.avance_envoi} min</b> avant
        <input type="range" min={10} max={90} step={5} value={r.avance_envoi} onChange={(e) => { touche.current = true; setR({ ...r, avance_envoi: +e.target.value }) }}
          onMouseUp={() => maj({ avance_envoi: r.avance_envoi })} onTouchEnd={() => maj({ avance_envoi: r.avance_envoi })} className="mt-1 w-full accent-violet" />
      </label>
      <label className="mt-2 block text-sm text-encre">Préparer <b className="text-violet">{r.avance_preparation} min</b> avant
        <input type="range" min={15} max={120} step={5} value={r.avance_preparation} onChange={(e) => { touche.current = true; setR({ ...r, avance_preparation: +e.target.value }) }}
          onMouseUp={() => maj({ avance_preparation: r.avance_preparation })} onTouchEnd={() => maj({ avance_preparation: r.avance_preparation })} className="mt-1 w-full accent-violet" />
      </label>
      <AnimatePresence>{sauve && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-2 flex items-center gap-1 text-xs text-ok"><Check size={13} /> Enregistré</motion.p>}</AnimatePresence>
      <p className="mt-3 flex gap-1.5 text-xs text-brume"><AlertTriangle size={13} className="shrink-0" /> L’envoi automatique ne fonctionne que lorsque l’application est ouverte.</p>
    </div>
  )
}
