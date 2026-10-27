import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { creerApi, type ApiMode, type Mode } from './api'

/* Le mode (Qualifiés / Prospection) vient d'un contexte React, jamais d'une variable globale.
   Chaque page est montée DANS son propre fournisseur : pendant la transition de sortie, l'ancienne page
   garde l'ancien mode, même si le nouveau est déjà choisi. */

const ModeContext = createContext<Mode>('qualifie')
export const FournisseurMode = ModeContext.Provider
export const useMode = () => useContext(ModeContext)

/** Appels de l'application déjà liés au mode courant. */
export function useApi(): ApiMode {
  const mode = useMode()
  return useMemo(() => creerApi(mode), [mode])
}

/** Signal d'annulation valable tant que le composant est monté (renouvelé si React remonte le composant). */
export function useSignal() {
  const ref = useRef<AbortController>(new AbortController())
  useEffect(() => {
    if (ref.current.signal.aborted) ref.current = new AbortController()
    return () => ref.current.abort()
  }, [])
  return useCallback(() => ref.current.signal, [])
}

/** Couleurs d'accent du mode courant, lues dans les variables CSS (pour les dégradés animés qui ne savent pas lire var()). */
export function useCouleursAccent(): string[] {
  const mode = useMode()
  return useMemo(() => {
    const st = getComputedStyle(document.documentElement)
    return ['--color-violet', '--color-violet-vif', '--color-lavande', '--color-violet-profond'].map((v) => st.getPropertyValue(v).trim() || '#5723F3')
  }, [mode])
}
