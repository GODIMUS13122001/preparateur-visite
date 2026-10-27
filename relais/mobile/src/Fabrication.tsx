import { useEffect, useRef, useState } from 'react'
import { animate, AnimatePresence, motion, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react'
import { Check, ChevronDown, Loader2, WifiOff } from 'lucide-react'
import type { Rdv } from './api'
import { TextMorph } from '@/components/motion-primitives/text-morph'
import { TextShimmer } from '@/components/motion-primitives/text-shimmer'
import { SlidingNumber } from '@/components/motion-primitives/sliding-number'
import { Jauge } from './Instruments'
import { cn } from '@/lib/utils'

/* La fabrication d'une nouvelle carte, demandée depuis le téléphone : une carte miniature s'assemble
   au rythme des vraies étapes de la préparation (publiées par le Mac), puis la carte rejoint le paquet. */

const EASE = [0.23, 1, 0.32, 1] as const
const SHIMMER = '[--base-color:#B8ACD9] [--base-gradient-color:#FFFFFF]'
const DEMANDE = [{ libelle: 'Je transmets la demande à votre Mac', etat: 'en_cours' as const }]

function quandLong(r: Rdv) {
  const t = new Date(r.debut).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  return `${t} à ${r.heure}`
}

export function Fabrication({ r, depuis, onReduire, onTermine }: { r: Rdv; depuis: number; onReduire: () => void; onTermine: () => void }) {
  const reduit = useReducedMotion()
  const prete = r.fiche_prete
  const etapes = r.preparation?.length ? r.preparation : prete ? [] : DEMANDE
  const faites = prete ? etapes.length : etapes.filter((e) => e.etat === 'fait' || e.etat === 'saute').length
  const total = Math.max(1, etapes.length)

  // avancement continu : entre deux étapes réelles, la jauge progresse doucement vers la suivante (jamais figée, jamais en avance)
  const p = useMotionValue(0.03)
  const changement = useRef({ faites, t: Date.now() })
  if (changement.current.faites !== faites) changement.current = { faites, t: Date.now() }
  useEffect(() => {
    const viser = () => {
      const lent = 0.85 * (1 - Math.exp(-(Date.now() - changement.current.t) / 14000))
      const cible = prete ? 1 : Math.min(0.97, Math.max(0.03, (faites + lent) / total))
      animate(p, Math.max(p.get(), cible), { duration: reduit ? 0 : prete ? 0.6 : 0.9, ease: [0.23, 1, 0.32, 1] })
    }
    viser()
    const t = setInterval(viser, 700)
    return () => clearInterval(t)
  }, [faites, total, prete, p, reduit])
  const [pct, setPct] = useState(3)
  useMotionValueEvent(p, 'change', (v) => { const n = Math.round(v * 100); if (n !== pct) setPct(n) })

  const [muet, setMuet] = useState(false)
  useEffect(() => {
    if (r.preparation?.length || prete) { setMuet(false); return }
    const t = setTimeout(() => setMuet(true), Math.max(0, 90000 - (Date.now() - depuis)))
    return () => clearTimeout(t)
  }, [r.preparation, prete, depuis])
  useEffect(() => { if (!prete) return; const t = setTimeout(onTermine, 1700); return () => clearTimeout(t) }, [prete, onTermine])
  const enCours = etapes.find((e) => e.etat === 'en_cours')
  // le fantôme tiré depuis la dernière carte vient se poser au centre de la jauge, puis laisse place au pourcentage
  const [fantome, setFantome] = useState(!reduit)
  useEffect(() => { if (!fantome) return; const t = setTimeout(() => setFantome(false), 1300); return () => clearTimeout(t) }, [fantome])

  return (
    <motion.div role="status" aria-live="polite" className="sombre absolute inset-0 z-20 flex flex-col overflow-hidden rounded-t-[30px] bg-encre px-6 pt-7 text-white"
      style={{ backgroundImage: 'radial-gradient(420px 340px at 50% 30%, rgba(87,35,243,0.45), transparent 70%), radial-gradient(420px 360px at 0% 100%, rgba(49,20,138,0.8), transparent 70%)' }}
      initial={reduit ? { opacity: 0 } : { clipPath: 'circle(0% at 76% 40%)' }} animate={reduit ? { opacity: 1 } : { clipPath: 'circle(150% at 76% 40%)' }}
      exit={{ opacity: 0, transform: 'translateY(16px) scale(0.98)', transition: { duration: 0.22 } }} transition={{ duration: 0.65, ease: EASE }}>
      <TextMorph as="h2" className="titre text-[30px] leading-tight">{prete ? 'Votre carte est prête' : 'Je prépare votre carte'}</TextMorph>
      <p className="mt-1 text-[15px] text-lilas first-letter:uppercase">{r.entreprise} · {quandLong(r)}</p>

      {/* la jauge circulaire : 56 crans qui s'allument en continu, le pourcentage qui roule au centre */}
      <div className="relative mx-auto mt-6 grid place-items-center">
        <div aria-hidden className={cn('anime-halo absolute inset-6 rounded-full', prete ? 'bg-[radial-gradient(circle,rgba(91,216,138,0.45),transparent_70%)]' : 'bg-[radial-gradient(circle,rgba(130,87,245,0.6),transparent_70%)]')} />
        <Jauge valeur={pct / 100} crans={56} debut={-90} balayage={360} taille={232} longueur={11} epaisseur={3.4} ton={prete ? 'ok' : 'violet'}>
          <AnimatePresence mode="popLayout" initial={false}>
            {prete ? (
              <motion.span key="ok" className="grid size-20 place-items-center rounded-full bg-ok text-white shadow-[0_14px_30px_-10px_#146B33]"
                initial={{ transform: 'scale(0.6)', opacity: 0 }} animate={{ transform: 'scale(1)', opacity: 1 }} transition={{ type: 'spring', duration: 0.5, bounce: 0.4 }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.15, ease: EASE }} />
                </svg>
              </motion.span>
            ) : fantome ? (
              <motion.div key="fantome" layoutId="fantome" className="grid size-24 place-items-center" exit={{ opacity: 0, transform: 'scale(0.8)', filter: 'blur(6px)', transition: { duration: 0.25 } }}
                transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}>
                <motion.img src="/logo-icone.svg" alt="" className="size-20 invert" animate={{ transform: ['rotate(0deg)', 'rotate(-8deg)', 'rotate(6deg)', 'rotate(0deg)'] }} transition={{ duration: 0.7, delay: 0.5, ease: 'easeInOut' }} />
              </motion.div>
            ) : (
              <motion.span key="pct" className="flex flex-col items-center" initial={{ opacity: 0, transform: 'scale(0.92)', filter: 'blur(6px)' }} animate={{ opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }} exit={{ opacity: 0, transform: 'scale(0.9)' }} transition={{ duration: 0.35, ease: EASE }}>
                <span className="chiffre flex items-baseline text-[54px] leading-none"><SlidingNumber value={pct} /><span className="ml-1 text-2xl text-lilas">%</span></span>
                <span className="mt-2 text-xs text-lilas">{faites} étape{faites > 1 ? 's' : ''} sur {total}</span>
              </motion.span>
            )}
          </AnimatePresence>
        </Jauge>
      </div>

      {/* l'étape en cours, puis la liste */}
      <div className="mt-5 h-6 text-center">
        <AnimatePresence mode="popLayout" initial={false}>
          {enCours && (
            <motion.div key={enCours.libelle} initial={{ opacity: 0, transform: 'translateY(8px)', filter: 'blur(4px)' }} animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }}
              exit={{ opacity: 0, transform: 'translateY(-8px)', filter: 'blur(4px)' }} transition={{ duration: 0.3, ease: EASE }}>
              <TextShimmer className={cn('text-[15px] font-semibold', SHIMMER)} duration={1.6}>{enCours.libelle}</TextShimmer>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <ol className="mt-3 grid min-h-0 flex-1 grid-cols-2 content-start gap-x-3 gap-y-2 overflow-hidden">
        {etapes.map((e) => (
          <li key={e.libelle} className={cn('flex items-center gap-2 text-[12.5px] leading-tight transition-opacity duration-300', e.etat === 'fait' ? 'text-white' : 'text-lilas/60')}>
            <span className={cn('grid size-5 shrink-0 place-items-center rounded-full transition-colors duration-300', e.etat === 'fait' ? 'bg-ok text-white' : e.etat === 'en_cours' ? 'bg-violet text-white' : 'bg-white/10')}>
              {e.etat === 'fait' ? <Check size={11} strokeWidth={3.4} /> : e.etat === 'en_cours' ? <Loader2 size={11} className="animate-spin" /> : null}
            </span>
            <span className={cn('line-clamp-2', e.etat === 'saute' && 'line-through')}>{e.libelle.replace(/^Je |^J’/, (m) => (m === 'J’' ? 'J’' : 'Je '))}</span>
          </li>
        ))}
      </ol>

      <div className="bas-sur pt-3 pb-2">
        {muet && <p className="mb-2 flex items-start gap-2 rounded-2xl bg-white/10 p-3 text-sm text-lilas"><WifiOff size={16} className="mt-0.5 shrink-0" /> Votre Mac ne répond pas encore. Il doit être allumé, avec l’application ouverte : la carte se préparera dès qu’il reçoit la demande.</p>}
        {!prete && (
          <button onClick={onReduire} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white/10 font-semibold text-white ring-1 ring-white/15">
            <ChevronDown size={17} /> Continuer à parcourir mes cartes
          </button>
        )}
      </div>
    </motion.div>
  )
}

/** Version réduite : une pastille en haut du paquet, qui rouvre la fabrication. */
export function PastilleFabrication({ r, onOuvrir }: { r: Rdv; onOuvrir: () => void }) {
  const etapes = r.preparation ?? []
  const faites = etapes.filter((e) => e.etat === 'fait' || e.etat === 'saute').length
  return (
    <motion.button onClick={onOuvrir} className="absolute top-2 left-0 right-0 z-30 mx-auto flex w-fit items-center gap-2 rounded-full bg-encre py-2 pr-4 pl-3 text-sm font-semibold text-white shadow-[0_12px_30px_-12px_rgba(18,10,41,0.6)]"
      initial={{ opacity: 0, transform: 'translateY(-8px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} exit={{ opacity: 0, transform: 'translateY(-8px)' }} transition={{ duration: 0.25, ease: EASE }}>
      {r.fiche_prete ? <span className="size-2 rounded-full bg-ok" /> : <Loader2 size={14} className="animate-spin text-lavande" />}
      {r.fiche_prete ? `${r.entreprise} : carte prête` : `${r.entreprise} en préparation${etapes.length ? ` · ${faites}/${etapes.length}` : ''}`}
    </motion.button>
  )
}
