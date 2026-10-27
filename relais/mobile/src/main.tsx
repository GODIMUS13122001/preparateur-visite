import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
// Polices de la charte, embarquées (marchent hors connexion).
// Fraunces en version « opsz » : seul l'axe de taille optique sert ; la version complète (axes SOFT et WONK) pèse deux fois plus.
import '@fontsource-variable/geist'
import '@fontsource-variable/fraunces/opsz.css'
import '@fontsource-variable/fraunces/opsz-italic.css'
import './index.css'
import App from './App'

/* Service worker : la nouvelle version s'installe dès qu'elle est publiée (sw.js n'est jamais lu depuis le cache HTTP).
   Si elle prend la main pendant qu'un lien de notification (?rdv=) attend encore d'être ouvert, on recharge une fois :
   le lien est alors lu par la nouvelle version, avec son état, et non par l'ancienne coque. */
if ('serviceWorker' in navigator) {
  const avaitVersion = !!navigator.serviceWorker.controller
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}) })
  }).catch(() => {})
  let recharge = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!avaitVersion || recharge) return
    if (new URLSearchParams(location.search).has('rdv')) { recharge = true; location.reload() }
  })
}

// Onglet caché : les animations CSS continues se mettent en pause.
const visibilite = () => document.documentElement.toggleAttribute('data-cache', document.visibilityState === 'hidden')
document.addEventListener('visibilitychange', visibilite)
visibilite()

createRoot(document.getElementById('root')!).render(<StrictMode><MotionConfig reducedMotion="user"><App /></MotionConfig></StrictMode>)
