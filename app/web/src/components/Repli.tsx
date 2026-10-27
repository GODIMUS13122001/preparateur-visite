import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/* Sections repliables du Workflow : une petite flèche ouvre ou ferme le contenu, et le choix est retenu. */

export function useOuvert(cle: string, defaut = true) {
  const [ouvert, setOuvert] = useState<boolean>(() => {
    try { const v = localStorage.getItem(`repli.${cle}`); return v === null ? defaut : v === '1' } catch { return defaut }
  })
  useEffect(() => { try { localStorage.setItem(`repli.${cle}`, ouvert ? '1' : '0') } catch { /* stockage indisponible */ } }, [cle, ouvert])
  return [ouvert, () => setOuvert((o) => !o)] as const
}

export function Fleche({ ouvert, sombre }: { ouvert: boolean; sombre?: boolean }) {
  return (
    <span className={cn('grid size-7 shrink-0 place-items-center rounded-full transition-colors',
      sombre ? 'bg-white/[0.08] ring-1 ring-white/10 group-hover:bg-white/15' : 'bg-creme ring-1 ring-nuage group-hover:bg-voile group-hover:text-violet')}>
      <ChevronDown size={15} className={cn('transition-transform duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]', !ouvert && '-rotate-90')} />
    </span>
  )
}

export function Contenu({ ouvert, id, children }: { ouvert: boolean; id: string; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {ouvert && (
        <motion.div id={id} key={id} className="overflow-hidden"
          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
