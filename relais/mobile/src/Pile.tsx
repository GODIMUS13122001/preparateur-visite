import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { animate, AnimatePresence, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform, type MotionValue, type PanInfo } from 'motion/react'
import { AlertTriangle, ChevronDown, MapPin, SearchX, Settings2, Video } from 'lucide-react'
import type { Etat, Rdv } from './api'
import { AnimatedBackground } from '@/components/motion-primitives/animated-background'
import { SlidingNumber } from '@/components/motion-primitives/sliding-number'
import { bornes, Jauge, LigneJournee } from './Instruments'
import { cn } from '@/lib/utils'

/* Le paquet de cartes : un rendez-vous par carte, sur toute la largeur de l'écran.
   Gauche : carte suivante. Droite : carte précédente. On descend dans la carte : note vocale, fiche, compte rendu.
   La journée se tire depuis le haut. Seuls transform et opacity bougent pendant un geste. */

export const EASE = [0.23, 1, 0.32, 1] as const
const VITESSE = 300 // px/s : un geste vif suffit, même court
export const debutMs = (r: Rdv) => new Date(r.debut).getTime()
export const estPasse = (r: Rdv, maintenant: number) => debutMs(r) < maintenant - 30 * 60000

/* ==================================================================== en-tête d'une carte (partagé par la carte du dessus et le paquet) */

/** Le compte à rebours dans une jauge à crans : elle se remplit dans les deux heures qui précèdent, puis pendant le rendez-vous. */
function Rebours({ r, maintenant }: { r: Rdv; maintenant: number }) {
  const { debut, fin } = bornes(r)
  const m = Math.round((debut - maintenant) / 60000)
  const avant = maintenant < debut, pendant = maintenant >= debut && maintenant < fin
  const valeur = avant ? 1 - Math.min(m, 120) / 120 : pendant ? (maintenant - debut) / (fin - debut) : 1
  const jours = Math.round((new Date(debut).setHours(0, 0, 0, 0) - new Date(maintenant).setHours(0, 0, 0, 0)) / 86400000)
  return (
    <Jauge valeur={valeur} taille={104} crans={28} ton={pendant ? 'ok' : avant ? (r.source === 'prospect' ? 'corail' : 'violet') : 'gris'} className="-mt-1 -mr-2 shrink-0">
      {avant && m < 60 ? (<><div className="text-xs leading-none text-lilas">dans</div><div className="chiffre mt-0.5 flex justify-center text-[28px] leading-none"><SlidingNumber value={m} /></div><div className="mt-0.5 text-xs leading-none text-lilas">min</div></>)
        : avant && jours === 0 ? (<><div className="text-xs leading-none text-lilas">dans</div><div className="chiffre mt-0.5 text-[22px] leading-none">{Math.floor(m / 60)}h{String(m % 60).padStart(2, '0')}</div></>)
        : avant && jours === 1 ? <div className="chiffre text-[22px] leading-none">demain</div>
        : avant ? (<><div className="text-xs leading-none text-lilas">dans</div><div className="chiffre mt-0.5 text-[26px] leading-none">{jours}</div><div className="mt-0.5 text-xs leading-none text-lilas">jours</div></>)
        : pendant ? (<><div className="text-[13px] font-semibold">en cours</div><div className="mt-0.5 text-xs leading-tight text-lilas tabular-nums">encore {Math.round((fin - maintenant) / 60000)} min</div></>)
        : <div className="text-[13px] font-semibold text-lilas">terminé</div>}
    </Jauge>
  )
}

function Statut({ r }: { r: Rdv }) {
  const cr = r.compte_rendu
  const [txt, ton] =
    cr?.statut === 'valide' ? ['Compte rendu enregistré', 'ok']
    : cr?.statut === 'a_valider' ? ['Compte rendu à valider', 'violet']
    : cr && cr.statut !== 'erreur' ? ['Compte rendu en préparation', 'violet']
    : r.en_preparation && !r.fiche_prete ? ['Je prépare la fiche...', 'violet']
    : r.fiche_prete ? [r.fiche_audio ? 'Fiche prête à écouter' : 'Fiche prête', 'ok']
    : r.source !== 'agenda' ? ['Fiche pas encore prête', 'neutre'] : ['Absent du CRM', 'alerte']
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
      ton === 'ok' && 'bg-ok-fond text-ok', ton === 'violet' && 'bg-voile text-violet', ton === 'neutre' && 'bg-nuage text-ardoise', ton === 'alerte' && 'bg-alerte-fond text-alerte')}>
      <span className="size-1.5 rounded-full bg-current" />{txt}
    </span>
  )
}

/** Le type de rendez-vous, tout en haut de la carte : Client (violet), Prospect (corail) avec son étape et son rang, ou Agenda. */
/** Étapes de prospection : libellés lisibles, jamais le code brut du fichier. */
const ETAPES: Record<string, string> = {
  lead: 'Contact repéré', contact_repere: 'Contact repéré', premier_contact: 'Premier contact', rdv_obtenu: 'Rendez-vous obtenu',
  rendez_vous_obtenu: 'Rendez-vous obtenu', decouverte: 'Découverte', decouverte_faite: 'Découverte faite', proposition: 'Proposition envoyée',
  negociation: 'Négociation', gagne: 'Gagné', perdu: 'Perdu',
}
const libelleEtape = (e: unknown) => {
  const brut = String(e ?? '').trim()
  if (!brut) return ''
  const cle = brut.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s-]+/g, '_')
  const t = ETAPES[cle] ?? brut.replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
/** « 1er rendez-vous », 1, « 2e »... deviennent « Premier rendez-vous », « 2e rendez-vous ». */
const libelleRang = (v: unknown) => {
  const brut = String(v ?? '').trim()
  if (!brut) return ''
  const n = /^(\d+)/.exec(brut)?.[1]
  if (n) return n === '1' ? 'Premier rendez-vous' : `${n}e rendez-vous`
  return brut.charAt(0).toUpperCase() + brut.slice(1)
}

export function EtiquetteType({ r }: { r: Rdv }) {
  const p = r.source === 'prospect' ? r.prospect : null
  const etape = libelleEtape(p?.etape)
  const rang = libelleRang(p?.rang)
  const base = 'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold text-white'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {r.source === 'crm' && <span className={cn(base, 'bg-violet')}>Client</span>}
      {r.source === 'prospect' && <span className={cn(base, 'bg-violet')}>Prospect</span>}
      {r.source === 'agenda' && <span className={cn(base, 'bg-white/15')}>Agenda</span>}
      {etape && <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-lilas">{etape}</span>}
      {rang && <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-lilas">{rang}</span>}
    </div>
  )
}

/** Haut de la carte : l'heure sur un bandeau marine, comme un billet, puis le client. */
export function EnTeteCarte({ r, maintenant, defilement }: { r: Rdv; maintenant: number; defilement?: MotionValue<number> }) {
  const agenda = r.source === 'agenda'
  const prospect = r.source === 'prospect'
  const zero = useMotionValue(0)
  const d = defilement ?? zero
  // en descendant dans la carte, le bandeau glisse moins vite que le texte : la carte se prolonge au lieu de changer
  const decalage = useTransform(d, (v) => `translateY(${Math.round(Math.min(Math.max(0, v), 320) * 0.35)}px)`)
  const fondu = useTransform(d, [0, 220], [1, 0.35])
  return (
    <>
      <div className="sombre relative overflow-hidden bg-encre px-6 pt-5 pb-5 text-white [contain:paint]" style={{ backgroundImage: `radial-gradient(260px 200px at 92% -10%, ${prospect ? 'rgba(217,72,43,0.7)' : 'rgba(87,35,243,0.7)'}, transparent 70%)` }}>
        <motion.div className="will-change-transform" style={{ transform: decalage, opacity: fondu }}>
        <EtiquetteType r={r} />
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="pt-1">
            <div className="chiffre text-[64px] leading-[0.88] font-medium tracking-tight">{r.heure}</div>
            <div className="mt-2.5 text-sm text-lilas">jusqu’à {r.heure_fin} · {(() => { const { debut, fin } = bornes(r); const d = Math.round((fin - debut) / 60000); return d >= 60 ? `${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60}` : ''}` : `${d} min` })()}</div>
            <div className="mt-1 flex items-center gap-1.5 text-sm text-lilas">{r.visio ? <Video size={14} /> : <MapPin size={14} />}{r.visio ? 'En visio' : r.ville || r.lieu}</div>
          </div>
          <Rebours r={r} maintenant={maintenant} />
        </div>
        <div className="mt-4"><LigneJournee r={r} maintenant={maintenant} /></div>
        </motion.div>
      </div>
      {/* talon du billet */}
      <div aria-hidden className="relative h-0 border-t-2 border-dashed border-nuage">
        <span className="absolute -top-3 -left-3 size-6 rounded-full bg-fond" /><span className="absolute -top-3 -right-3 size-6 rounded-full bg-fond" />
      </div>
      <div className="px-6 pt-6">
        <h2 className="text-[38px] leading-[1.02] text-encre">{r.entreprise}</h2>
        {agenda ? (
          <p className="mt-3 flex gap-2 text-sm text-alerte"><SearchX size={17} className="shrink-0" /> « {r.titre_agenda} » est dans votre agenda, mais pas dans le CRM : pas de fiche ni de compte rendu possible.</p>
        ) : (
          <>
            {r.contact && <p className="mt-2.5 text-[15px] text-ardoise">avec <b className="font-semibold text-encre">{r.contact}</b>{r.poste && <span className="lowercase">, {r.poste}</span>}</p>}
            {r.objet && <p className="mt-4 text-[15px] leading-snug text-texte">{r.objet}</p>}
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Statut r={r} />
              {r.alertes.map((a) => <span key={a} className="inline-flex items-center gap-1 rounded-full bg-alerte-fond px-2.5 py-1 text-xs text-alerte"><AlertTriangle size={12} /> {a}</span>)}
            </div>
          </>
        )}
      </div>
    </>
  )
}

/* ==================================================================== le paquet */

/** Une carte « générée » a sa fiche (ou déjà un compte rendu) : seules celles-là sont dans le paquet. */
export const estGeneree = (r: Rdv) => r.fiche_prete || !!r.compte_rendu

export function Paquet({ rdvs, index, onIndex, maintenant, rendre, vide, commande, prochaine, onPreparer }: {
  rdvs: Rdv[]; index: number; onIndex: (i: number) => void; maintenant: number
  rendre: (r: Rdv, actif: boolean) => React.ReactNode; vide: React.ReactNode
  commande?: React.MutableRefObject<((sens: 1 | -1) => void) | null>
  /** le prochain rendez-vous sans fiche : au bout du paquet, pousser la dernière carte le fait préparer */
  prochaine: Rdv | null; onPreparer: (r: Rdv) => void
}) {
  const reduit = useReducedMotion()
  const boite = useRef<HTMLDivElement>(null)
  const [largeur, setLargeur] = useState(390)
  useLayoutEffect(() => {
    const el = boite.current
    if (!el) return
    const ro = new ResizeObserver(() => setLargeur(el.clientWidth || 390))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const x = useMotionValue(0)
  const rotation = useTransform(x, [-largeur, largeur], reduit ? [0, 0] : [-11, 11])
  const n = rdvs.length
  const r = rdvs[index]
  // la carte qu'on découvre dépend du sens : à gauche la suivante, à droite la précédente
  const [sens, setSens] = useState<1 | -1>(1)
  useMotionValueEvent(x, 'change', (v) => { const s = v > 0 ? -1 : 1; if (v !== 0 && s !== sens) setSens(s) })
  const cible = rdvs[index + sens] ?? (sens === 1 ? prochaine ?? undefined : undefined)
  // transformations en une seule chaîne (accélérées par le navigateur), pas de raccourcis x / rotate / scale
  const transformHaut = useTransform([x, rotation] as MotionValue<number>[], ([v, r]) => `translateX(${v}px) rotate(${r}deg)`)
  const transformDessous = useTransform(x, (v) => `scale(${0.94 + 0.06 * Math.min(1, Math.abs(v) / (largeur * 0.6))})`)
  const opaciteSuivante = useTransform(x, (v) => 0.5 + 0.5 * Math.min(1, Math.abs(v) / (largeur * 0.5)))
  const tamponSuivant = useTransform(x, [-largeur * 0.35, -30], [1, 0])
  const tamponPrecedent = useTransform(x, [30, largeur * 0.35], [0, 1])
  // cran de résistance devant une carte sans fiche : poussé jusqu'au bout, il lance la préparation
  const CRAN = largeur * 0.3, ARME = largeur * 0.7
  const charge = useMotionValue(0) // 0..1, avancement de la poussée au-delà du cran
  const [arme, setArme] = useState(false)
  const bloquee = (s: 1 | -1) => (rdvs[index + s] ? null : s === 1 && prochaine ? 'preparer' : 'fin')
  const axe = useRef<'x' | 'y' | null>(null)
  const enVol = useRef(false)

  const passer = async (s: 1 | -1, vitesse = 0) => {
    if (enVol.current || !rdvs[index + s]) { animate(x, 0, { type: 'spring', bounce: 0.2, duration: 0.4 }); return }
    enVol.current = true
    await animate(x, s === 1 ? -largeur * 1.25 : largeur * 1.25, reduit ? { duration: 0.12 } : { type: 'spring', velocity: vitesse, bounce: 0, duration: 0.32 })
    // la remise à zéro attend que la nouvelle carte soit en place (voir l'effet plus bas) : sinon l'ancienne réapparaît une image
    onIndex(index + s)
  }
  useLayoutEffect(() => { x.set(0); charge.set(0); setArme(false); enVol.current = false }, [index]) // eslint-disable-line react-hooks/exhaustive-deps
  if (commande) commande.current = (s) => passer(s, s === 1 ? -800 : 800)

  const pan = {
    onPanStart: (_: unknown, i: PanInfo) => {
      // une fois descendu dans la carte (note, fiche, compte rendu), on ne change plus de carte
      const defile = boite.current?.querySelector<HTMLElement>('[data-haut] [data-carte-defile]')?.scrollTop ?? 0
      axe.current = defile <= 24 && Math.abs(i.offset.x) > Math.abs(i.offset.y) * 1.4 ? 'x' : 'y'
    },
    onPan: (_: unknown, i: PanInfo) => {
      if (axe.current !== 'x' || enVol.current) return
      if (boite.current && !boite.current.dataset.glisse) boite.current.dataset.glisse = '1'
      const o = i.offset.x, s: 1 | -1 = o < 0 ? 1 : -1, b = bloquee(s), a = Math.abs(o)
      if (!b) { x.set(o); return }
      // au bout du paquet : la carte suit avec retenue (élastique). Devant une fiche manquante : libre jusqu'au cran, puis freinée
      const v = b === 'preparer' ? (a <= CRAN ? a : CRAN + (a - CRAN) * 0.28) : CRAN * 0.9 * (1 - Math.exp(-a / (CRAN * 1.4)))
      x.set(-s * v)
      const c = b === 'preparer' ? Math.max(0, Math.min(1, (a - CRAN) / (ARME - CRAN))) : 0
      charge.set(c)
      if ((c >= 1) !== arme) setArme(c >= 1)
    },
    onPanEnd: (_: unknown, i: PanInfo) => {
      if (axe.current !== 'x') return
      axe.current = null
      if (boite.current) delete boite.current.dataset.glisse
      const o = i.offset.x, v = i.velocity.x, s: 1 | -1 = o < 0 ? 1 : -1, b = bloquee(s)
      if (b === 'preparer' && charge.get() >= 1 && prochaine) {
        // la carte du dessus revient en place : la fabrication de la nouvelle prend le relais
        onPreparer(prochaine); charge.set(0); setArme(false)
        animate(x, 0, { type: 'spring', bounce: 0.2, duration: 0.5, velocity: v }); return
      }
      if (!b && (Math.abs(o) > largeur * 0.28 || (Math.abs(v) > VITESSE && Math.sign(v) === Math.sign(o)))) { passer(s, v); return }
      charge.set(0); setArme(false)
      animate(x, 0, { type: 'spring', bounce: 0.15, duration: 0.45, velocity: v })
    },
  }
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea')) return
      if (e.key === 'ArrowLeft') passer(-1, 800)
      if (e.key === 'ArrowRight') passer(1, -800)
    }
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  })
  const b = bloquee(sens)
  const remplissage = useTransform(charge, (c) => `scaleX(${c})`)
  // le fantôme grossit en même temps qu'on tire, et se dandine un peu (comme le fantôme de Snapchat au rafraîchissement)
  const transformFantome = useTransform(x, (v) => `scale(${0.25 + 0.75 * Math.min(1, Math.abs(v) / (CRAN * 1.15))}) rotate(${Math.sin(Math.abs(v) / 14) * 10 * Math.max(0, 1 - Math.abs(v) / (largeur * 0.5))}deg)`)
  const opaciteCran = useTransform(x, (v) => Math.min(1, Math.max(0, (Math.abs(v) - CRAN * 0.35) / (CRAN * 0.4))))

  return (
    <div ref={boite} className="relative h-full" role="region" aria-roledescription="paquet de cartes" aria-label={r ? `Rendez-vous ${index + 1} sur ${n}` : 'Aucun rendez-vous'}>
      {!r ? vide : (
        <>
          {!cible && (
            <motion.div aria-hidden className="absolute inset-0 z-[2] flex flex-col items-center justify-center rounded-t-[30px] border-2 border-dashed border-encre/10 bg-white/70 px-10 text-center"
              style={{ opacity: opaciteCran }}>
              <p className="titre text-2xl text-encre">{sens === 1 ? 'Plus de rendez-vous à venir' : 'C’est le premier rendez-vous'}</p>
              <p className="mt-2 text-sm text-ardoise">{sens === 1 ? 'Les prochains rendez-vous de votre agenda viendront s’ajouter ici, avec leur fiche.' : 'Glissez vers la gauche pour les suivants.'}</p>
            </motion.div>
          )}
          {b === 'preparer' && prochaine && (
            <div aria-hidden className="sombre absolute inset-0 z-[2] overflow-hidden rounded-t-[30px] bg-encre text-white"
              style={{ backgroundImage: 'radial-gradient(320px 300px at 76% 40%, rgba(87,35,243,0.55), transparent 70%)' }}>
              <motion.div layoutId="fantome" className="absolute top-[34%] left-[76%] -ml-12 grid size-24 place-items-center"
                style={{ transform: transformFantome }} transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}>
                <motion.img src="/logo-icone.svg" alt="" className="size-24 invert" draggable={false}
                  animate={arme ? { transform: ['scale(1)', 'scale(1.18)', 'scale(0.94)', 'scale(1.06)', 'scale(1)'] } : { transform: 'scale(1)' }}
                  transition={{ duration: 0.55, ease: [0.23, 1, 0.32, 1] }} />
              </motion.div>
              <motion.div className="absolute inset-x-6 top-[58%] pl-[38%] text-right" style={{ opacity: opaciteCran }}>
                <p className="titre text-[22px] leading-tight">{arme ? 'Relâchez' : 'Encore un peu'}</p>
                <p className="mt-1 text-sm text-lilas">{arme ? `Je prépare la fiche ${prochaine.entreprise}` : `pour préparer ${prochaine.entreprise}`}</p>
                <div className="mt-3 ml-auto h-1.5 w-32 overflow-hidden rounded-full bg-white/15"><motion.div className="h-full origin-left rounded-full bg-lavande" style={{ transform: remplissage }} /></div>
              </motion.div>
            </div>
          )}
          {/* l'ombre du paquet est posée une fois pour toutes, à côté de la carte : rien à recalculer pendant le glissé */}
          <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] rounded-t-[30px] shadow-[0_-12px_40px_-24px_rgba(18,10,41,0.45)]" />
          {/* trois cartes montées : celle du dessus et ses deux voisines (dans l'ordre du paquet, jamais déplacées).
              Une carte qui passe dessus n'est pas reconstruite ; seule la voisine du côté du geste se montre dessous. */}
          {[index - 1, index, index + 1].filter((k) => k >= 0 && k < n).map((k) => {
            const c = rdvs[k]
            const haut = k === index
            const dessous = !haut && b !== 'preparer' && cible?.id === c.id
            const coupe = '[clip-path:inset(0_round_30px_30px_0_0)]'
            return (
              <motion.div key={c.id} data-haut={haut ? '' : undefined} aria-hidden={haut ? undefined : true} inert={!haut}
                className={haut ? cn('carte-haut absolute inset-0 z-[3] bg-[linear-gradient(#120A29_0_50%,#fff_50%)] select-none', coupe)
                  : cn('en-pause pointer-events-none absolute inset-0 bg-white', coupe, dessous ? 'z-[2]' : 'invisible z-0')}
                style={haut ? { transform: transformHaut, transformOrigin: '50% 110%', touchAction: 'pan-y' }
                  : dessous ? { transform: transformDessous, opacity: opaciteSuivante, transformOrigin: '50% 30%' } : { transform: 'none', opacity: 1 }}
                {...(haut ? pan : {})}>
                {rendre(c, haut)}
                {haut && !b && <motion.span aria-hidden style={{ opacity: tamponSuivant }} className="pointer-events-none absolute top-32 right-5 z-30 rotate-12 rounded-xl border-[3px] border-violet bg-white px-4 py-1.5 text-lg font-bold tracking-wider text-violet uppercase">Suivant</motion.span>}
                {haut && !b && <motion.span aria-hidden style={{ opacity: tamponPrecedent }} className="pointer-events-none absolute top-32 left-5 z-30 -rotate-12 rounded-xl border-[3px] border-encre bg-white px-4 py-1.5 text-lg font-bold tracking-wider text-encre uppercase">Précédent</motion.span>}
              </motion.div>
            )
          })}
        </>
      )}
    </div>
  )
}

/** Défilement dans la carte : valeur suivie hors rendu React (pas de re-rendu à chaque image). */
export function useDefilement() {
  const ref = useRef<HTMLDivElement>(null)
  const y = useMotionValue(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const maj = () => y.set(el.scrollTop)
    el.addEventListener('scroll', maj, { passive: true })
    return () => el.removeEventListener('scroll', maj)
  }, [y])
  return { ref, y }
}

/** Changement de jour en glissant : la date s'affiche un instant sous l'en-tête. */
export function RappelDate({ jour }: { jour: string | null }) {
  const [vu, setVu] = useState<string | null>(null)
  const premier = useRef(true)
  useEffect(() => {
    if (!jour) return
    if (premier.current) { premier.current = false; return }
    setVu(jour)
    const t = setTimeout(() => setVu(null), 1500)
    return () => clearTimeout(t)
  }, [jour])
  const texte = vu ? new Date(`${vu}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : ''
  return (
    <div aria-live="polite" className="pointer-events-none absolute inset-x-0 top-[46%] z-40 flex justify-center">
      <AnimatePresence>
        {vu && (
          <motion.span key={vu} className="titre rounded-full bg-encre px-4 py-2 text-[15px] text-white shadow-[0_12px_30px_-12px_rgba(18,10,41,0.6)]"
            initial={{ opacity: 0, transform: 'translateY(-8px) scale(0.96)', filter: 'blur(4px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px) scale(1)', filter: 'blur(0px)' }}
            exit={{ opacity: 0, transform: 'translateY(-6px) scale(0.98)', filter: 'blur(2px)', transition: { duration: 0.2 } }}
            transition={{ duration: 0.28, ease: EASE }}>
            {texte.charAt(0).toUpperCase() + texte.slice(1)}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ==================================================================== la journée, tirée depuis le haut */

const JOURS_COURTS = ['D', 'L', 'M', 'M', 'J', 'V', 'S']
export const isoJour = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function titreDuJour(jour: string | null, aujourdhui: string) {
  if (!jour || jour === aujourdhui) return 'Aujourd’hui'
  const d = new Date(`${jour}T12:00:00`), demain = new Date(`${aujourdhui}T12:00:00`)
  demain.setDate(demain.getDate() + 1)
  if (isoJour(d) === isoJour(demain)) return 'Demain'
  const ecart = Math.round((d.getTime() - new Date(`${aujourdhui}T12:00:00`).getTime()) / 86400000)
  const t = d.toLocaleDateString('fr-FR', ecart >= 0 && ecart < 7 ? { weekday: 'long', day: 'numeric' } : { weekday: 'long', day: 'numeric', month: 'short' })
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export type ControleCalendrier = { suivre: (dy: number) => void; relacher: (vitesse: number) => void }

export function Calendrier({ etat, jour, onJour, maintenant, onLogo, onParametres, controle, alerte, children }: {
  etat: Etat | null; jour: string; /** renvoie un message si le jour n'a rien à montrer (le volet reste alors ouvert) */ onJour: (j: string) => string | null; maintenant: number
  onLogo: () => void; onParametres: () => void; controle: React.MutableRefObject<ControleCalendrier | null>; alerte: boolean; children?: React.ReactNode
}) {
  const reduit = useReducedMotion()
  const volet = useRef<HTMLDivElement>(null)
  const p = useMotionValue(0) // 0 fermé, 1 ouvert : suit le doigt
  const [ouvert, setOuvert] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const depart = useRef(0)
  const hauteur = () => volet.current?.offsetHeight || 480
  const regler = (cible: 0 | 1, vitesse = 0) => {
    setOuvert(cible === 1)
    if (cible === 0) setInfo(null)
    animate(p, cible, reduit ? { duration: 0.15 } : { type: 'spring', bounce: 0, duration: 0.42, velocity: vitesse / hauteur() })
  }
  const pan = {
    onPanStart: () => { depart.current = p.get() },
    onPan: (_: unknown, i: PanInfo) => p.set(Math.min(1.04, Math.max(0, depart.current + i.offset.y / hauteur()))),
    onPanEnd: (_: unknown, i: PanInfo) => regler(i.velocity.y > 250 ? 1 : i.velocity.y < -250 ? 0 : p.get() > 0.5 ? 1 : 0, i.velocity.y),
  }
  // la carte peut aussi tirer le volet : glisser vers le bas depuis le haut de la carte
  controle.current = {
    suivre: (dy) => p.set(Math.min(1.04, Math.max(0, dy / hauteur()))),
    relacher: (vy) => regler(vy > 250 ? 1 : vy < -250 ? 0 : p.get() > 0.35 ? 1 : 0, vy),
  }
  const transformVolet = useTransform(p, (v) => `translateY(${(v - 1) * 100}%)`)
  // l'en-tête et le volet ne font qu'une surface : l'en-tête blanchit, le volet se déroule depuis son bord
  const fondEntete = useTransform(p, [0, 0.25], ['rgba(255,255,255,0)', 'rgba(255,255,255,1)'])
  const entete = useRef<HTMLElement>(null)
  const [hautEntete, setHautEntete] = useState(64)
  useLayoutEffect(() => { const el = entete.current; if (!el) return; const ro = new ResizeObserver(() => setHautEntete(el.offsetHeight)); ro.observe(el); return () => ro.disconnect() }, [])
  const voile = useTransform(p, [0, 1], [0, 0.42])
  const fleche = useTransform(p, [0, 1], ['rotate(0deg)', 'rotate(180deg)'])
  const [visible, setVisible] = useState(false)
  useMotionValueEvent(p, 'change', (v) => { if ((v > 0.001) !== visible) setVisible(v > 0.001) })

  const journees = useMemo(() => etat?.journees ?? [], [etat])
  const parJour = useMemo(() => Object.fromEntries(journees.map((j) => [j.jour, j.rendez_vous])), [journees])
  const aujourdhui = isoJour(new Date(maintenant))
  const debutSemaine = aujourdhui
  const semaine = useMemo(() => Array.from({ length: 7 }, (_, k) => { const d = new Date(`${debutSemaine}T12:00:00`); d.setDate(d.getDate() + k); return d }), [debutSemaine])
  const mois = new Date(`${jour}T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

  return (
    <>
      {/* en-tête : on le tire vers le bas, ou on le touche */}
      <motion.header ref={entete} className="haut-sur relative z-30 flex touch-none items-center justify-between gap-2 px-4 pb-2" style={{ backgroundColor: fondEntete }} {...pan}>
        <button onClick={onLogo} aria-label="Retour à l’accueil" className="flex h-11 w-[78px] items-center"><img src="/logo-noir.svg" alt="Préparateur" className="h-[17px] w-[78px] object-contain object-left" /></button>
        <button onClick={() => regler(ouvert ? 0 : 1)} aria-expanded={ouvert} aria-controls="volet-journee"
          className="flex min-h-11 items-center gap-1 rounded-full px-3 text-[17px] text-encre">
          <span className="relative grid">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={titreDuJour(jour, aujourdhui)} className="titre col-start-1 row-start-1 whitespace-nowrap"
                initial={{ opacity: 0, transform: 'translateY(6px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }}
                exit={{ opacity: 0, transform: 'translateY(-6px)', transition: { duration: 0.12 } }} transition={{ duration: 0.2, ease: EASE }}>
                {titreDuJour(jour, aujourdhui)}
              </motion.span>
            </AnimatePresence>
          </span>
          {alerte && <span className="ml-0.5 size-2 rounded-full bg-alerte" aria-label="À voir" />}
          <motion.span style={{ transform: fleche }} className="grid"><ChevronDown size={18} /></motion.span>
        </button>
        <div className="flex w-[78px] items-center justify-end">
          <button onClick={onParametres} aria-label="Paramètres" className="grid size-11 place-items-center rounded-full text-encre active:bg-encre/5"><Settings2 size={20} /></button>
        </div>
      </motion.header>

      <motion.div aria-hidden className="fixed inset-0 z-20 touch-none bg-encre" style={{ opacity: voile, pointerEvents: ouvert ? 'auto' : 'none', visibility: visible ? 'visible' : 'hidden' }} onClick={() => regler(0)} {...pan} />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[25] overflow-hidden" style={{ top: hautEntete - 1 }}>
      <motion.div ref={volet} id="volet-journee" role="dialog" aria-label="Ma journée" aria-hidden={!ouvert}
        className="pointer-events-auto touch-none rounded-b-[30px] bg-white shadow-[0_24px_60px_-24px_rgba(18,10,41,0.5)]"
        style={{ transform: transformVolet, visibility: visible ? 'visible' : 'hidden' }} {...pan}>
        <div className="px-5 pt-1">
          <div>
            <p className="text-sm text-ardoise first-letter:uppercase">{mois}</p>
            <div className="mt-2 grid grid-cols-7 gap-1">
              <AnimatedBackground defaultValue={jour} onValueChange={(v) => { if (!v) return; const m = onJour(v); setInfo(m); if (!m) setTimeout(() => regler(0), 280) }} className="rounded-2xl bg-encre" transition={{ type: 'spring', bounce: 0, duration: 0.32 }}>
                {semaine.map((d) => {
                  const id = isoJour(d), nb = parJour[id]?.length ?? 0
                  return (
                    <button key={id} data-id={id} type="button" aria-pressed={id === jour} aria-label={`${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })}, ${nb} rendez-vous`}
                      className="h-[68px] w-full justify-center rounded-2xl text-encre transition-colors duration-200 data-[checked=true]:text-white">
                      <span className="flex h-full flex-col items-center justify-center">
                        <span className="text-xs font-semibold opacity-60">{JOURS_COURTS[d.getDay()]}</span>
                        <span className={cn('chiffre mt-0.5 text-xl leading-none', id === aujourdhui && 'underline decoration-violet decoration-2 underline-offset-4')}>{d.getDate()}</span>
                        <span className="mt-1.5 flex h-1.5 gap-0.5">{(parJour[id] ?? []).slice(0, 3).map((x, k) => <span key={k} className={cn('size-1.5 rounded-full', x.source === 'prospect' ? 'bg-corail-vif' : x.source === 'crm' ? 'bg-violet-vif' : 'bg-current opacity-60')} />)}</span>
                      </span>
                    </button>
                  )
                })}
              </AnimatedBackground>
            </div>
          </div>

          <div aria-live="polite">{info && <p className="mt-2 rounded-2xl bg-nuage p-3 text-sm text-encre">{info}</p>}</div>
          {children && <div className="mt-2 space-y-2">{children}</div>}
        </div>
        <div className="flex justify-center pb-0.5">
          <button onClick={() => regler(0)} aria-label="Fermer ma journée" className="grid h-11 w-24 place-items-center"><span className="h-1.5 w-10 rounded-full bg-encre/20" /></button>
        </div>
      </motion.div>
      </div>
    </>
  )
}

