import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import Lenis from 'lenis'
import { ArrowRight, ArrowDown, Car, FileSpreadsheet, Newspaper, Smartphone, TrendingDown, TrendingUp } from 'lucide-react'
import { compte, type Accueil as DonneesAccueil } from '../api'
import { useCouleursAccent } from '../mode'
// la scène 3D (Three.js) arrive après le texte : l'accueil s'affiche sans l'attendre
const Scene3D = lazy(() => import('@/components/Scene3D'))
import { GlowEffect } from '@/components/motion-primitives/glow-effect'
import { InfiniteSlider } from '@/components/motion-primitives/infinite-slider'
import { Magnetic } from '@/components/motion-primitives/magnetic'
import { TextLoop } from '@/components/motion-primitives/text-loop'

gsap.registerPlugin(useGSAP, ScrollTrigger)

const ETAPES = [
  { icone: FileSpreadsheet, titre: 'Votre CRM', texte: 'Contacts, commandes, affaires et réclamations du client.' },
  { icone: Newspaper, titre: 'La presse', texte: 'Résultats, dirigeants, usines : l’actualité des trois derniers mois, sourcée et datée.' },
  { icone: Car, titre: 'Votre fiche', texte: 'Une page à lire, et sa version à écouter en voiture.' },
  { icone: Smartphone, titre: 'Votre téléphone', texte: 'Elle arrive seule, 30 minutes avant le rendez-vous.' },
]
const TITRE = ['Préparez', 'chaque', 'visite', 'en', 'deux', 'minutes.']

export default function Accueil({ onEntrer }: { onEntrer: () => void }) {
  const racine = useRef<HTMLDivElement>(null)
  const ouverture = useRef<HTMLElement>(null)
  const [d, setD] = useState<DonneesAccueil | null>(null)

  // animations en boucle de l'écran d'ouverture (reflet, bandeau, flèche) : en pause dès qu'il sort de l'écran
  useEffect(() => {
    const el = ouverture.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => el.classList.toggle('hors-ecran', !e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const accent = useCouleursAccent()
  useEffect(() => {
    const c = new AbortController()
    compte.accueil(c.signal).then(setD).catch(() => {})
    return () => c.abort()
  }, [])

  // défilement fluide (Lenis) relié à ScrollTrigger
  useEffect(() => {
    const lenis = new Lenis({ duration: 1.1, smoothWheel: true })
    lenis.on('scroll', ScrollTrigger.update)
    const tick = (t: number) => lenis.raf(t * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    return () => { gsap.ticker.remove(tick); lenis.destroy() }
  }, [])

  const { contextSafe } = useGSAP(() => {
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out', duration: 0.9 } })
      tl.from('.a-logo', { y: -20, autoAlpha: 0, duration: 0.6 })
        .from('.a-surtitre', { y: 12, autoAlpha: 0, duration: 0.6 }, '-=0.2')
        .from('.a-mot', { yPercent: 120, rotate: 4, stagger: 0.07, duration: 1 }, '-=0.3')
        .from('.a-sous', { y: 16, autoAlpha: 0 }, '-=0.6')
        .from('.a-cta', { y: 24, autoAlpha: 0, scale: 0.94 }, '-=0.5')
        .from('.a-chiffres > *', { y: 16, autoAlpha: 0, stagger: 0.08 }, '-=0.8')
        .from('.a-defile', { autoAlpha: 0, duration: 1 }, '-=0.4')
      // invitation à défiler, en boucle
      gsap.to('.a-fleche', { y: 8, repeat: -1, yoyo: true, duration: 0.9, ease: 'sine.inOut',
        scrollTrigger: { trigger: '.a-fleche', start: 'top bottom', end: 'bottom top', toggleActions: 'play pause resume pause' } })
      // section « comment ça marche » : apparition au défilement
      gsap.utils.toArray<HTMLElement>('.a-carte').forEach((el, i) => {
        gsap.from(el, { y: 60, autoAlpha: 0, rotateX: -12, duration: 1, delay: i * 0.08, scrollTrigger: { trigger: el, start: 'top 85%' } })
      })
      gsap.from('.a-trait', { scaleX: 0, transformOrigin: 'left center', duration: 1.4, ease: 'power2.inOut', scrollTrigger: { trigger: '.a-trait', start: 'top 85%' } })
      gsap.from('.a-grand', { scale: 0.92, autoAlpha: 0, duration: 1.2, scrollTrigger: { trigger: '.a-grand', start: 'top 80%' } })
    })
  }, { scope: racine })

  // compteurs qui défilent jusqu'à leur valeur une fois les données arrivées
  useGSAP(() => {
    if (!d) return
    gsap.utils.toArray<HTMLElement>('.a-nombre').forEach((el) => {
      const cible = Number(el.dataset.valeur ?? 0)
      const o = { v: 0 }
      gsap.to(o, { v: cible, duration: 1.6, ease: 'power2.out', delay: 1.2, onUpdate: () => { el.textContent = String(Math.round(o.v)) } })
    })
  }, { scope: racine, dependencies: [d] })

  const entrer = contextSafe(() => {
    gsap.timeline({ onComplete: onEntrer })
      .to('.a-cta-bouton', { scale: 0.95, duration: 0.12 })
      .to('.a-cta-bouton', { scale: 1.08, duration: 0.25, ease: 'back.out(3)' })
      .to(racine.current, { autoAlpha: 0, scale: 1.04, duration: 0.55, ease: 'power2.in' }, '-=0.05')
  })

  return (
    <div ref={racine} className="relative min-h-screen overflow-x-hidden bg-encre text-white">
      {/* ------------------------------------------------------------ écran d'ouverture */}
      <section ref={ouverture} className="relative flex min-h-screen flex-col">
        <Suspense fallback={null}><Scene3D className="absolute inset-0 opacity-90 lg:left-[38%]" /></Suspense>
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_40%,rgba(18,10,41,0.95)_30%,rgba(18,10,41,0.4)_65%,transparent)]" />

        <header className="a-logo relative z-10 mx-auto flex w-full max-w-6xl items-center gap-4 px-6 pt-7">
          <img src="/logo-blanc.svg" alt="Préparateur" className="h-7 w-auto" />
          <span className="h-5 w-px bg-white/20" />
          <span className="text-sm text-lilas">Préparateur de visite</span>
        </header>

        <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-16">
          <p className="a-surtitre text-xs font-semibold tracking-[0.22em] text-lavande uppercase">
            {d ? <>Bonjour{d.prenom ? ` ${d.prenom}` : ''} · {d.jour_long}</> : 'Bonjour'}
          </p>
          <h1 className="mt-5 max-w-3xl text-5xl leading-[1.05] font-semibold tracking-tight sm:text-7xl">
            {TITRE.map((m, i) => (
              <span key={i} className="mr-[0.22em] inline-block overflow-hidden pb-[0.08em] align-bottom">
                <span className={`a-mot inline-block ${i >= 3 ? 'bg-gradient-to-r from-lavande via-white to-lilas bg-clip-text text-transparent' : ''}`}>{m}</span>
              </span>
            ))}
          </h1>
          <div className="a-sous mt-6 h-8 max-w-xl text-lg text-lilas">
            <TextLoop interval={3}>
              {['Le CRM, la bourse, la presse et LinkedIn, réunis en une page.', 'À lire au bureau, ou à écouter en voiture.', 'Prête et envoyée avant chaque rendez-vous.']
                .map((t) => <span key={t}>{t}</span>)}
            </TextLoop>
          </div>

          {/* bouton d'entrée animé */}
          <div className="a-cta mt-10 flex flex-wrap items-center gap-6">
            <Magnetic intensity={0.35} range={160}>
              <div className="relative">
                <GlowEffect colors={[accent[0], accent[1], accent[2], '#FFFFFF']} mode="rotate" blur="medium" duration={5} scale={1.04} className="rounded-full opacity-80" />
                <button onClick={entrer} className="a-cta-bouton group relative flex items-center gap-4 overflow-hidden rounded-full bg-[#FFFFFF] py-2.5 pr-2.5 pl-7 text-[17px] font-semibold text-[#120A29] shadow-2xl">
                  <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-lilas/70 to-transparent [animation:reflet_2.8s_ease-in-out_infinite]" />
                  <span className="relative">Entrer dans l’application</span>
                  <span className="relative grid size-11 place-items-center overflow-hidden rounded-full bg-violet text-white transition-colors group-hover:bg-violet-profond">
                    <ArrowRight size={20} className="transition-transform duration-300 group-hover:translate-x-8" />
                    <ArrowRight size={20} className="absolute -translate-x-8 transition-transform duration-300 group-hover:translate-x-0" />
                  </span>
                </button>
              </div>
            </Magnetic>
            {d?.prochain && (
              <p className="text-sm text-lilas">Prochain rendez-vous : <b className="text-white">{d.prochain.entreprise}</b> à {d.prochain.heure}, avec {d.prochain.contact}</p>
            )}
          </div>

          {/* chiffres du jour */}
          <div className="a-chiffres mt-14 grid max-w-2xl grid-cols-3 gap-4">
            {[
              { v: d?.rendez_vous ?? 0, l: 'rendez-vous aujourd’hui' },
              { v: d?.fiches_pretes ?? 0, l: 'fiches déjà prêtes' },
              { v: d?.clients ?? 0, l: 'clients dans le CRM' },
            ].map((c) => (
              <div key={c.l} className="rounded-2xl bg-white/[0.07] p-4 ring-1 ring-white/10">
                <div className="a-nombre text-4xl font-semibold tabular-nums" data-valeur={c.v}>{d ? 0 : '-'}</div>
                <div className="mt-1 text-[13px] text-lilas">{c.l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* bandeau défilant : l'actualité réellement trouvée et la bourse */}
        <div className="a-defile relative z-10 border-y border-white/10 bg-encre/60 py-3">
          <InfiniteSlider gap={40} speed={38} speedOnHover={12}>
            {[...(d?.bourses ?? []).map((b) => (
              <span key={'b' + b.entreprise} className="flex items-center gap-2 text-sm whitespace-nowrap">
                <b className="font-semibold">{b.entreprise}</b> {b.cours.toFixed(2).replace('.', ',')} €
                <span className={b.variation < 0 ? 'flex items-center gap-1 text-[#FF8A8A]' : 'flex items-center gap-1 text-[#7EE2A8]'}>
                  {b.variation < 0 ? <TrendingDown size={14} /> : <TrendingUp size={14} />}{b.variation > 0 ? '+' : ''}{String(b.variation).replace('.', ',')} % sur 12 mois
                </span>
              </span>
            )), ...(d?.titres ?? []).map((t, i) => (
              <span key={'t' + i} className="flex items-center gap-2 text-sm whitespace-nowrap text-lilas">
                <span className="size-1.5 rounded-full bg-lavande" /><b className="font-semibold text-white">{t.entreprise}</b> {t.titre}
                <span className="text-xs text-brume">{t.source?.split('(')[0].trim()}, {new Date(t.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
              </span>
            ))]}
          </InfiniteSlider>
        </div>
        <div className="relative z-10 flex justify-center py-5 text-lilas">
          <ArrowDown size={18} className="a-fleche" />
        </div>
      </section>

      {/* ------------------------------------------------------------ comment ça marche */}
      <section className="relative mx-auto max-w-6xl px-6 py-24 [perspective:1200px]">
        <p className="text-xs font-semibold tracking-[0.22em] text-lavande uppercase">Comment ça marche</p>
        <h2 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight">De votre CRM à votre téléphone, sans rien faire.</h2>
        <div className="relative mt-14 grid gap-5 md:grid-cols-4">
          <div aria-hidden className="a-trait absolute top-[52px] right-[12%] left-[12%] z-0 hidden h-0.5 bg-gradient-to-r from-violet via-lavande to-violet md:block" />
          {ETAPES.map((e, i) => (
            <div key={e.titre} className="a-carte relative z-10 rounded-[22px] bg-[#1B1336] p-6 ring-1 ring-white/10">
              <span className="relative grid size-14 place-items-center rounded-2xl bg-violet shadow-icone"><e.icone size={24} /></span>
              <p className="mt-5 text-xs text-lavande">0{i + 1}</p>
              <h3 className="mt-1 text-lg font-semibold">{e.titre}</h3>
              <p className="mt-2 text-sm text-lilas">{e.texte}</p>
            </div>
          ))}
        </div>
        <div className="a-grand mt-20 rounded-[28px] bg-gradient-to-br from-violet via-violet-profond to-encre p-10 text-center ring-1 ring-white/10">
          <p className="text-sm text-lilas">Chaque préparation est visible en direct, étape par étape, dans l’onglet <b className="text-white">Workflow</b>.</p>
          <p className="mt-3 text-3xl font-semibold">{d?.executions ? <>{d.executions} préparations déjà retracées.</> : 'Rien n’est caché : chaque source est citée et datée.'}</p>
          <button onClick={entrer} className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#FFFFFF] px-6 py-3 font-semibold text-[#120A29] transition hover:bg-lilas">
            Entrer dans l’application <ArrowRight size={18} />
          </button>
        </div>
      </section>
    </div>
  )
}
