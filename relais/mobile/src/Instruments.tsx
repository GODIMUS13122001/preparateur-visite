import { createContext, useContext } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { Rdv } from './api'
import { cn } from '@/lib/utils'

/* Instruments partagés : jauge à crans (inspirée des « notch gauges » de bklit-ui), ligne de la journée, bandeau défilant.
   Tout bouge en transform / opacity ; les crans changent de couleur en transition CSS, décalée cran par cran. */

/** Tous les rendez-vous connus, pour qu'une carte puisse situer le sien dans sa journée. */
export const RdvContexte = createContext<Rdv[]>([])
export const useTousRdv = () => useContext(RdvContexte)

const minutes = (h: string) => { const [a, b] = h.replace('h', ':').split(':'); return Number(a) * 60 + (Number(b) || 0) }
export function bornes(r: Rdv) {
  const debut = new Date(r.debut)
  const fin = new Date(debut)
  const m = minutes(r.heure_fin || r.heure)
  fin.setHours(Math.floor(m / 60), m % 60, 0, 0)
  if (fin <= debut) fin.setTime(debut.getTime() + 60 * 60000)
  return { debut: debut.getTime(), fin: fin.getTime() }
}

/** Jauge en arc faite de crans : `valeur` entre 0 et 1. */
export function Jauge({ valeur, crans = 30, debut = 135, balayage = 270, taille = 112, ton = 'violet', eteinte = 'rgba(255,255,255,0.14)', epaisseur = 3.2, longueur = 9, children, className }: {
  valeur: number; crans?: number; debut?: number; balayage?: number; taille?: number; ton?: 'violet' | 'corail' | 'ok' | 'gris'; eteinte?: string
  epaisseur?: number; longueur?: number; children?: React.ReactNode; className?: string
}) {
  const reduit = useReducedMotion()
  const actifs = Math.round(Math.max(0, Math.min(1, valeur)) * crans)
  const couleur = (i: number) => {
    if (ton === 'ok') return '#5BD88A'
    if (ton === 'gris') return 'rgba(255,255,255,0.55)'
    if (ton === 'corail') { const t = crans > 1 ? i / (crans - 1) : 1; return t < 0.6 ? `color-mix(in oklab, #D9482B ${100 - t * 100}%, #F0A28F)` : `color-mix(in oklab, #F0A28F ${100 - (t - 0.6) * 250}%, #FFFFFF)` }
    const t = crans > 1 ? i / (crans - 1) : 1 // dégradé violet → lavande → blanc le long de l'arc
    return t < 0.6 ? `color-mix(in oklab, #8257F5 ${100 - t * 100}%, #AC8FF9)` : `color-mix(in oklab, #AC8FF9 ${100 - (t - 0.6) * 250}%, #FFFFFF)`
  }
  const r = 50 - longueur / 2 - 1
  return (
    <div className={cn('relative grid place-items-center', className)} style={{ width: taille, height: taille }}>
      <svg viewBox="0 0 100 100" width={taille} height={taille} className="absolute inset-0" aria-hidden>
        {Array.from({ length: crans }, (_, i) => {
          const angle = debut + (balayage * (i + 0.5)) / crans
          const allume = i < actifs
          return (
            <rect key={i} x={50 - epaisseur / 2} y={50 - r - longueur / 2} width={epaisseur} height={longueur} rx={epaisseur / 2}
              transform={`rotate(${angle + 90} 50 50)`}
              style={{ fill: allume ? couleur(i) : eteinte, transition: reduit ? undefined : `fill 280ms cubic-bezier(0.23,1,0.32,1) ${Math.abs(i - actifs) * 14}ms` }} />
          )
        })}
      </svg>
      <div className="relative text-center">{children}</div>
    </div>
  )
}

/** La journée en une ligne : chaque rendez-vous est un segment, celui de la carte ressort, l'aiguille marque maintenant. */
export function LigneJournee({ r, maintenant, sombre = true, grande = false }: { r?: Rdv; jour?: string; maintenant: number; sombre?: boolean; grande?: boolean }) {
  const tous = useTousRdv()
  const reduit = useReducedMotion()
  const ref = r ?? tous.find((x) => new Date(x.debut).toDateString() === new Date(maintenant).toDateString())
  if (!ref) return null
  const jour = new Date(ref.debut).toDateString()
  const liste = tous.filter((x) => new Date(x.debut).toDateString() === jour)
  if (!liste.length) return null
  const segs = liste.map((x) => ({ x, ...bornes(x) }))
  const base = new Date(segs[0].debut); base.setHours(0, 0, 0, 0)
  const h0 = Math.min(8 * 60, Math.floor((segs[0].debut - base.getTime()) / 60000 / 60) * 60)
  const h1 = Math.max(19 * 60, Math.ceil((segs[segs.length - 1].fin - base.getTime()) / 60000 / 60) * 60)
  const pos = (t: number) => ((t - base.getTime()) / 60000 - h0) / (h1 - h0)
  const ici = pos(maintenant)
  const auj = new Date(maintenant).toDateString() === jour
  return (
    <div className={cn('relative w-full', grande ? 'h-10' : 'h-6')} aria-hidden>
      <motion.div className={cn('absolute inset-x-0 top-1/2 h-px origin-left', sombre ? 'bg-white/20' : 'bg-encre/15')}
        initial={reduit ? false : { transform: 'scaleX(0)' }} animate={{ transform: 'scaleX(1)' }} transition={{ duration: 0.7, ease: [0.23, 1, 0.32, 1] }} />
      {segs.map(({ x, debut, fin }, i) => {
        const actif = r && x.id === r.id
        return (
          <motion.span key={x.id} className={cn('absolute top-1/2 -translate-y-1/2 rounded-full', actif ? (grande ? 'h-3' : 'h-2') : 'h-1.5',
            actif ? 'bg-lavande shadow-[0_0_12px_rgba(172,143,249,0.8)]' : sombre ? 'bg-white/45' : 'bg-encre/30')}
            style={{ left: `${pos(debut) * 100}%`, width: `max(6px, ${(pos(fin) - pos(debut)) * 100}%)` }}
            initial={reduit ? false : { opacity: 0, transform: 'translateY(-50%) scaleX(0.3)' }} animate={{ opacity: 1, transform: 'translateY(-50%) scaleX(1)' }}
            transition={{ duration: 0.45, delay: 0.25 + i * 0.07, ease: [0.23, 1, 0.32, 1] }} />
        )
      })}
      {auj && ici > 0 && ici < 1 && (
        <span className="absolute top-0 bottom-0 w-px bg-white" style={{ left: `${ici * 100}%` }}>
          <span className="absolute -top-1 -left-[3px] size-[7px] rounded-full bg-white anime-pouls" />
        </span>
      )}
      <span className={cn('absolute -bottom-1 left-0 text-xs leading-none tabular-nums', sombre ? 'text-lilas/70' : 'text-ardoise')}>{h0 / 60}h</span>
      <span className={cn('absolute right-0 -bottom-1 text-xs leading-none tabular-nums', sombre ? 'text-lilas/70' : 'text-ardoise')}>{h1 / 60}h</span>
    </div>
  )
}

/** Bandeau qui défile en continu (animation CSS, hors du fil JavaScript). */
export function Defilant({ children, duree = 40, inverse = false, className }: { children: React.ReactNode; duree?: number; inverse?: boolean; className?: string }) {
  return (
    <div className={cn('relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]', className)}>
      <div className="anime-defile flex w-max gap-8" style={{ animationDuration: `${duree}s`, animationDirection: inverse ? 'reverse' : 'normal' }}>
        <div className="flex shrink-0 gap-8">{children}</div>
        <div className="flex shrink-0 gap-8" aria-hidden>{children}</div>
      </div>
    </div>
  )
}
