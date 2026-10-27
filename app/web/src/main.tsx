import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { appliquerTheme, themeInitial } from './theme'
// Polices de la charte, embarquées dans l'appli (fonctionnent hors connexion)
import '@fontsource-variable/fraunces/opsz.css'
import '@fontsource-variable/fraunces/opsz-italic.css'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import App from './App'

appliquerTheme(themeInitial()) // avant le premier affichage : pas de flash clair en mode sombre
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
