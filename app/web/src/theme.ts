import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'

/* Mode sombre de l'app Mac : choix gardé sur l'ordinateur (clair par défaut, la charte de l'appli).
   Le changement s'ouvre en cercle depuis le bouton : geste rare, l'animation peut se voir. */

export type Theme = 'clair' | 'sombre'
const CLE = 'preparateur-theme'

export function themeInitial(): Theme {
  try { return localStorage.getItem(CLE) === 'sombre' ? 'sombre' : 'clair' } catch { return 'clair' }
}

export function appliquerTheme(t: Theme) {
  document.documentElement.dataset.theme = t === 'sombre' ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'sombre' ? '#0F0B1D' : '#FAF9F6')
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(themeInitial)
  useEffect(() => { appliquerTheme(theme); try { localStorage.setItem(CLE, theme) } catch { /* rien */ } }, [theme])
  const basculer = useCallback((depuis?: HTMLElement | null) => {
    const suivant: Theme = theme === 'sombre' ? 'clair' : 'sombre'
    const reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const doc = document as Document & { startViewTransition?: (f: () => void) => { ready: Promise<void> } }
    if (!doc.startViewTransition || reduit) { setTheme(suivant); return }
    const b = depuis?.getBoundingClientRect()
    const x = b ? b.left + b.width / 2 : window.innerWidth, y = b ? b.top + b.height / 2 : 0
    const rayon = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const t = doc.startViewTransition(() => { flushSync(() => setTheme(suivant)); appliquerTheme(suivant) })
    t.ready.then(() => {
      document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${rayon}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', pseudoElement: '::view-transition-new(root)' })
    }).catch(() => {})
  }, [theme])
  return { theme, basculer }
}
