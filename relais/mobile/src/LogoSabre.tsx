import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'

/* Le logo de l'appli, dessiné par une lame de lumière (effet sabre) : un trait incandescent parcourt chaque contour,
   précédé d'une tête plus vive ; le remplissage blanc monte derrière, puis la lueur retombe en un léger halo. */

const EASE = [0.23, 1, 0.32, 1] as const
/** Même tracé, un peu plus rapide (environ 18 % de durée en moins), comme le reste de l'intro. */
const RYTHME = 0.82
let cache: string[] | null = null

export function useTraces() {
  const [d, setD] = useState<string[] | null>(cache)
  useEffect(() => {
    if (cache) return
    fetch('/logo-blanc.svg').then((r) => r.text()).then((t) => {
      cache = [...t.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1])
      setD(cache)
    }).catch(() => {})
  }, [])
  return d
}

function Trace({ d, delai: delaiScene, duree: dureeScene }: { d: string; delai: number; duree: number }) {
  const reduit = useReducedMotion()
  const delai = delaiScene * RYTHME, duree = dureeScene * RYTHME
  if (reduit) return <path d={d} fill="#fff" />
  const lame = { duration: duree, delay: delai, ease: [0.65, 0, 0.35, 1] as const }
  return (
    <g>
      {/* le remplissage arrive derrière la lame */}
      <motion.path d={d} fill="#fff" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 * RYTHME, delay: delai + duree * 0.75, ease: EASE }} />
      {/* lueur : un trait large et pâle sous la lame (pas de filtre, rien à recalculer à chaque image) */}
      <motion.path d={d} fill="none" stroke="#AC8FF9" strokeWidth={5} strokeLinecap="round" pathLength={1}
        initial={{ pathLength: 0, opacity: 0.55 }} animate={{ pathLength: 1, opacity: [0.55, 0.55, 0] }}
        transition={{ pathLength: lame, opacity: { duration: duree + 0.5 * RYTHME, delay: delai, times: [0, 0.75, 1] } }} />
      {/* la lame */}
      <motion.path d={d} fill="none" stroke="#fff" strokeWidth={1.2} pathLength={1}
        initial={{ pathLength: 0, opacity: 1 }} animate={{ pathLength: 1, opacity: [1, 1, 0.3] }}
        transition={{ pathLength: lame, opacity: { duration: duree + 0.5 * RYTHME, delay: delai, times: [0, 0.75, 1] } }} />
      {/* la tête, plus vive, qui court devant */}
      <motion.path d={d} fill="none" stroke="#fff" strokeWidth={3} pathLength={1} strokeLinecap="round" strokeDasharray="0.05 0.95"
        initial={{ strokeDashoffset: 0.05, opacity: 1 }} animate={{ strokeDashoffset: -0.95, opacity: [1, 1, 0] }}
        transition={{ strokeDashoffset: lame, opacity: { duration: duree, delay: delai, times: [0, 0.85, 1] } }} />
    </g>
  )
}

/** L'icône (le « e ») seule. */
export function IconeSabre({ taille, delai = 0, statique = false }: { taille: number; delai?: number; statique?: boolean }) {
  const d = useTraces()
  return (
    <svg viewBox="0 0 92 92" width={taille} height={taille} aria-hidden className="overflow-visible">
      {d && (statique ? <><path d={d[1]} fill="#fff" /><path d={d[0]} fill="#fff" /></>
        : <><Trace d={d[1]} delai={delai} duree={0.55} /><Trace d={d[0]} delai={delai + 0.15} duree={0.4} /></>)}
    </svg>
  )
}

/** Le mot « préparateur ». */
export function MotSabre({ largeur, delai = 0, statique = false }: { largeur: number; delai?: number; statique?: boolean }) {
  const d = useTraces()
  return (
    <svg viewBox="98 18 294 56" width={largeur} height={(largeur * 56) / 294} aria-hidden className="overflow-visible">
      {d && (statique ? <path d={d[2]} fill="#fff" /> : <Trace d={d[2]} delai={delai} duree={0.55} />)}
    </svg>
  )
}
