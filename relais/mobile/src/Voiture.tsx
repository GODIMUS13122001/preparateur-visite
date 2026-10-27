import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ChevronLeft, ChevronRight, ListChecks, MapPin, Pause, Play, RotateCcw, RotateCw, Video, WifiOff, X } from 'lucide-react'
import { api, precharger, type Rdv } from './api'
import { cn } from '@/lib/utils'

const VITESSES = [1, 1.25, 1.5]
const libelleVitesse = (v: number) => `${v.toLocaleString('fr-FR')}×`
const SORTIE = [0.23, 1, 0.32, 1] as const
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Reprend la partie « Questions à poser » de la fiche écrite (la fiche audio n'a pas de chapitres). */
function extraireQuestions(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const titre = [...doc.querySelectorAll('h2,h3')].find((e) => /questions/i.test(e.textContent ?? ''))
  if (!titre) return []
  const sortie: string[] = []
  for (let e = titre.nextElementSibling; e && !/^H[1-3]$/.test(e.tagName) && e.tagName !== 'HR'; e = e.nextElementSibling) {
    const lignes = e.matches('ul,ol') ? [...e.querySelectorAll('li')] : [e]
    for (const l of lignes) {
      const c = l.cloneNode(true) as Element
      c.querySelectorAll('.src').forEach((x) => x.remove())
      const t = (c.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (t) sortie.push(t)
    }
  }
  return sortie
}

export function Voiture({ rdvs, debut, onFermer }: { rdvs: Rdv[]; debut: number; onFermer: () => void }) {
  const [i, setI] = useState(debut)
  const r = rdvs[i]
  const ref = useRef<HTMLAudioElement>(null)
  const [lecture, setLecture] = useState(false)
  const [enchaine, setEnchaine] = useState(false)
  const [pos, setPos] = useState(0)
  const [duree, setDuree] = useState(0)
  const [vitesse, setVitesse] = useState(0)
  const [horsLigne, setHorsLigne] = useState(false)
  const [questions, setQuestions] = useState<string[]>([])
  const [voirQuestions, setVoirQuestions] = useState(false)
  const toucheX = useRef<number | null>(null)
  useEffect(() => { document.querySelectorAll('audio').forEach((a) => { if (a !== ref.current) a.pause() }) }, [])

  // fiche écrite : on en tire les questions, et on garde la suivante au chaud pour la route
  useEffect(() => {
    setQuestions([])
    let vivant = true
    fetch(api.fichier(`fiches/${r.id}.html`)).then((x) => (x.ok ? x.text() : '')).then((t) => { if (vivant) setQuestions(extraireQuestions(t)) }).catch(() => {})
    const suivant = rdvs[i + 1]
    if (suivant) precharger(suivant)
    return () => { vivant = false }
  }, [r.id, i, rdvs])

  const sauter = useCallback((d: number) => {
    const a = ref.current
    if (a) a.currentTime = Math.max(0, Math.min(a.duration || Infinity, a.currentTime + d))
  }, [])

  // écran de verrouillage et CarPlay
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms) return
    ms.metadata = new MediaMetadata({
      title: `Fiche ${r.entreprise}`, artist: 'Préparateur de visite',
      artwork: [{ src: '/icones/icone-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icones/icone-512.png', sizes: '512x512', type: 'image/png' }],
    })
    const regler = (a: MediaSessionAction, f: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, f) } catch { /* action non gérée */ } }
    regler('play', () => { ref.current?.play() })
    regler('pause', () => ref.current?.pause())
    regler('seekbackward', (d) => sauter(-(d.seekOffset ?? 15)))
    regler('seekforward', (d) => sauter(d.seekOffset ?? 15))
    regler('seekto', (d) => { if (ref.current && d.seekTime != null) ref.current.currentTime = d.seekTime })
    return () => { (['play', 'pause', 'seekbackward', 'seekforward', 'seekto'] as const).forEach((a) => regler(a, null)); ms.metadata = null; ms.playbackState = 'none' }
  }, [r.id, r.entreprise, sauter])

  const majPosition = (a: HTMLAudioElement) => {
    setPos(a.currentTime)
    if (navigator.mediaSession && Number.isFinite(a.duration)) {
      try { navigator.mediaSession.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate }) } catch { /* rien */ }
    }
  }
  const appliquerVitesse = (a: HTMLAudioElement | null, v: number) => { if (a) { a.defaultPlaybackRate = VITESSES[v]; a.playbackRate = VITESSES[v] } }
  const changerVitesse = () => { const v = (vitesse + 1) % VITESSES.length; setVitesse(v); appliquerVitesse(ref.current, v) }
  const aller = (n: number) => { setEnchaine(lecture); setPos(0); setDuree(0); setHorsLigne(false); setI(n) }
  const reessayer = () => { setHorsLigne(false); ref.current?.load(); ref.current?.play().catch(() => {}) }
  const lieu = r.visio ? 'En visio' : r.ville || r.lieu

  const bouton = 'grid place-items-center rounded-full transition-transform duration-[120ms] ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-95'

  return (
    <motion.div className={cn('sombre fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-encre text-white', r.source === 'prospect' && 'theme-prospect')} role="dialog" aria-label={`Mode voiture, fiche ${r.entreprise}`}
      initial={{ opacity: 0, transform: 'translateY(24px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} exit={{ opacity: 0, transform: 'translateY(24px)' }} transition={{ duration: 0.28, ease: SORTIE }}>
      <div aria-hidden className="pointer-events-none fixed -top-40 -right-36 size-[26rem] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-violet)_45%,transparent)_0%,transparent_65%)]" />
      <div className="haut-sur bas-sur relative flex min-h-dvh flex-col px-5">
        <div className="flex items-center justify-between py-2">
          <button onClick={onFermer} className="flex min-h-12 items-center gap-2 rounded-full bg-white/10 px-5 text-base font-semibold"><X size={20} /> Quitter</button>
          {rdvs.length > 1 && <span className="text-base text-lilas" aria-live="polite">Rendez-vous {i + 1} sur {rdvs.length}</span>}
        </div>

        {/* un seul rendez-vous occupe l'écran ; un glissement latéral passe au suivant */}
        <div className="mt-4 touch-pan-y" onTouchStart={(e) => { toucheX.current = e.touches[0].clientX }}
          onTouchEnd={(e) => {
            const d = e.changedTouches[0].clientX - (toucheX.current ?? e.changedTouches[0].clientX)
            toucheX.current = null
            if (d < -70 && i < rdvs.length - 1) aller(i + 1)
            else if (d > 70 && i > 0) aller(i - 1)
          }}>
          <div className="flex items-center gap-3">
            <p className="chiffre text-[40px] leading-none font-medium text-lavande">{r.heure}</p>
            {r.source !== 'agenda' && <span className="rounded-full bg-violet px-3 py-1 text-sm font-semibold text-white">{r.source === 'prospect' ? 'Prospect' : 'Client'}</span>}
          </div>
          <h2 className="mt-1 text-5xl leading-[1.05] font-semibold tracking-tight break-words">{r.entreprise}</h2>
          <p className="mt-3 flex items-center gap-2 text-xl text-lilas">{r.visio ? <Video size={22} /> : <MapPin size={22} />}{lieu}</p>
        </div>

        <div className="my-auto flex flex-col items-center py-6">
          <div className="flex w-full items-center justify-center gap-5">
            <button onClick={() => sauter(-15)} aria-label="Reculer de 15 secondes" className={`${bouton} size-20 shrink-0 bg-white/10`}>
              <span className="relative grid place-items-center"><RotateCcw size={44} strokeWidth={1.6} /><span className="absolute text-base font-bold">15</span></span>
            </button>
            <button onClick={() => (lecture ? ref.current?.pause() : ref.current?.play().catch(() => setHorsLigne(true)))} aria-label={lecture ? 'Pause' : 'Écouter la fiche'}
              className={`${bouton} size-36 shrink-0 bg-violet shadow-[0_0_0_10px_color-mix(in_srgb,var(--color-violet-vif)_25%,transparent)]`}>
              {lecture ? <Pause size={64} fill="currentColor" /> : <Play size={64} fill="currentColor" className="ml-2" />}
            </button>
            <button onClick={() => sauter(15)} aria-label="Avancer de 15 secondes" className={`${bouton} size-20 shrink-0 bg-white/10`}>
              <span className="relative grid place-items-center"><RotateCw size={44} strokeWidth={1.6} /><span className="absolute text-base font-bold">15</span></span>
            </button>
          </div>

          <div className="mt-8 w-full">
            <input type="range" className="curseur" min={0} max={duree || 1} step={1} value={Math.min(pos, duree || 1)} disabled={!duree}
              aria-label="Position dans la fiche audio" aria-valuetext={`${fmt(pos)} sur ${duree ? fmt(duree) : 'durée inconnue'}`}
              style={{ '--rempli': duree ? `${(pos / duree) * 100}%` : '0%' } as React.CSSProperties}
              onChange={(e) => { const a = ref.current; if (a) { a.currentTime = Number(e.target.value); setPos(a.currentTime) } }} />
            <div className="flex items-center justify-between text-lg text-lilas tabular-nums">
              <span className="w-16">{fmt(pos)}</span>
              <button onClick={changerVitesse} aria-label={`Vitesse de lecture ${VITESSES[vitesse].toLocaleString('fr-FR')} fois, toucher pour changer`} className={`${bouton} min-h-12 min-w-20 bg-white/10 px-4 text-xl font-semibold text-white`}>
                {libelleVitesse(VITESSES[vitesse])}
              </button>
              <span className="w-16 text-right">{duree ? fmt(duree) : '-:--'}</span>
            </div>
          </div>

          <div aria-live="polite" className="mt-3 min-h-7 text-center text-base">
            {horsLigne && (
              <div className="flex flex-wrap items-center justify-center gap-3 text-[#FFB4B4]">
                <span className="flex items-center gap-2"><WifiOff size={18} /> Pas de connexion pour l’instant.</span>
                <button onClick={reessayer} className="min-h-11 rounded-full bg-white px-5 font-semibold text-encre">Réessayer</button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3 pb-2">
          {questions.length > 0 && (
            <button onClick={() => setVoirQuestions(true)} className={`${bouton} min-h-20 w-full gap-3 rounded-[28px] bg-white text-2xl font-semibold text-encre`}>
              <span className="flex items-center gap-3"><ListChecks size={30} /> Questions à poser</span>
            </button>
          )}
          {rdvs.length > 1 && (
            <div className="flex gap-3">
              <button onClick={() => aller(i - 1)} disabled={i === 0} aria-label="Rendez-vous précédent" className={`${bouton} min-h-16 flex-1 bg-white/10 disabled:opacity-30`}><ChevronLeft size={32} /></button>
              <button onClick={() => aller(i + 1)} disabled={i === rdvs.length - 1} aria-label="Rendez-vous suivant" className={`${bouton} min-h-16 flex-1 bg-white/10 disabled:opacity-30`}><ChevronRight size={32} /></button>
            </div>
          )}
        </div>

        <audio key={r.id} ref={ref} src={api.fichier(`fiches/${r.id}.m4a`)} preload="auto" autoPlay={enchaine}
          onPlay={() => { setLecture(true); if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing' }}
          onPause={() => { setLecture(false); if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused' }}
          onEnded={() => { setLecture(false); if (i < rdvs.length - 1) aller(i + 1) }}
          onTimeUpdate={(e) => majPosition(e.currentTarget)} onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDuree(e.currentTarget.duration)}
          onLoadedMetadata={(e) => { appliquerVitesse(e.currentTarget, vitesse); setDuree(e.currentTarget.duration) }}
          onCanPlay={() => setHorsLigne(false)} onError={() => setHorsLigne(true)} />
      </div>

      {voirQuestions && (
        <motion.div className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-creme text-encre" role="dialog" aria-label={`Questions à poser chez ${r.entreprise}`}
          initial={{ opacity: 0, transform: 'translateY(24px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ duration: 0.25, ease: SORTIE }}>
          <div className="haut-sur bas-sur min-h-dvh px-5">
            <div className="flex items-center justify-between py-2">
              <button onClick={() => setVoirQuestions(false)} className="flex min-h-12 items-center gap-2 rounded-full bg-encre px-5 text-base font-semibold text-white"><ChevronLeft size={20} /> Retour à l’écoute</button>
              {lecture && <span className="flex items-center gap-2 text-base text-ardoise">La fiche continue</span>}
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">Questions à poser chez {r.entreprise}</h2>
            <ul className="mt-6 space-y-7 pb-6">
              {questions.map((q, n) => {
                const cut = /^([^:]{3,40}?)[\s\u00a0]:\s(.*)$/.exec(q)
                return (
                  <li key={n} className="text-3xl leading-snug">
                    {cut ? <><b className="block text-xl font-semibold tracking-wide text-violet uppercase">{cut[1]}</b>{cut[2]}</> : q}
                  </li>
                )
              })}
            </ul>
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}
