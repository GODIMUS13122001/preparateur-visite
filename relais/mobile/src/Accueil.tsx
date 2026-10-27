import { createContext, lazy, Suspense, useContext, useEffect, useState } from 'react'
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, type PanInfo } from 'motion/react'
import type { Etat } from './api'
import { SlidingNumber } from '@/components/motion-primitives/sliding-number'
import { Defilant, LigneJournee } from './Instruments'
import { IconeSabre, MotSabre } from './LogoSabre'
import { cn } from '@/lib/utils'

/* L'accueil du téléphone : le logo se forme en particules, le prénom s'écrit lettre par lettre,
   la journée s'installe (prochain rendez-vous, compteurs, ligne du jour), l'actualité des clients défile.
   On glisse vers le haut : les particules s'envolent et la première carte apparaît. */

const chargement = import('./LogoParticules')
const LogoParticules = lazy(() => chargement)
const EASE = [0.23, 1, 0.32, 1] as const
/** L'intro entière (particules, sabre, arrivée de la journée) est jouée environ 18 % plus vite, même enchaînement. */
const RYTHME = 0.82
const debutMs = (d: string) => new Date(d).getTime()

const Pret = createContext(true)

function Lettres({ texte, delai, className }: { texte: string; delai: number; className?: string }) {
  const reduit = useReducedMotion()
  const pret = useContext(Pret)
  return (
    <span aria-label={texte} className={cn('inline-block', className)}>
      {[...texte].map((c, i) => (
        <motion.span key={i} aria-hidden className="inline-block"
          initial={reduit ? false : { opacity: 0, transform: 'translateY(0.4em)' }}
          animate={pret ? { opacity: 1, transform: 'translateY(0em)' } : { opacity: 0, transform: 'translateY(0.4em)' }}
          transition={{ duration: 0.35 * RYTHME, delay: (delai + i * 0.02) * RYTHME, ease: EASE }}>{c === ' ' ? ' ' : c}</motion.span>
      ))}
    </span>
  )
}

function Apparait({ delai, children, className }: { delai: number; children: React.ReactNode; className?: string }) {
  const reduit = useReducedMotion()
  const pret = useContext(Pret)
  return (
    <motion.div className={className} initial={reduit ? false : { opacity: 0, transform: 'translateY(10px)' }} animate={pret ? { opacity: 1, transform: 'translateY(0px)' } : { opacity: 0, transform: 'translateY(10px)' }}
      transition={{ duration: 0.35 * RYTHME, delay: delai * RYTHME, ease: EASE }}>{children}</motion.div>
  )
}

type Phase = 'nuage' | 'logo' | 'contenu'
const ICONE = 132 // taille du « e » au centre de l'écran, en pixels
const HAUT = -70 // le logo se forme un peu au-dessus du centre

export function Accueil({ etat, onEntrer }: { etat: Etat | null; onEntrer: () => void }) {
  const reduit = useReducedMotion()
  const [sortie, setSortie] = useState(false)
  // 1. nuage de particules seul ; 2. il se reforme et le vrai logo se trace au sabre ; 3. le logo monte, la journée arrive
  const [phase, setPhase] = useState<Phase>(reduit ? 'contenu' : 'nuage')
  const [dissoudre, setDissoudre] = useState(false)
  useEffect(() => {
    if (phase !== 'logo') return
    const a = setTimeout(() => setDissoudre(true), 200 * RYTHME)
    const b = setTimeout(() => setPhase('contenu'), 750 * RYTHME)
    return () => { clearTimeout(a); clearTimeout(b) }
  }, [phase])
  const passer = () => { if (phase !== 'contenu') setPhase('contenu') }
  // filet de sécurité : si les particules ne peuvent pas se lancer (3D indisponible...), la journée s'affiche quand même
  useEffect(() => { const t = setTimeout(() => setPhase((p) => (p === 'contenu' ? p : 'contenu')), 4500 * RYTHME); return () => clearTimeout(t) }, [])
  // sous la barre d'accueil de l'iPhone, c'est le fond de la page qui se voit : marine pendant l'accueil, pas de bande claire
  useEffect(() => {
    const html = document.documentElement, body = document.body
    html.style.backgroundColor = body.style.backgroundColor = '#120A29'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#120A29')
    return () => { html.style.backgroundColor = body.style.backgroundColor = '' }
  }, [])
  const maintenant = Date.now()
  const rdvs = etat?.journees?.[0]?.rendez_vous ?? []
  const prochain = rdvs.find((r) => debutMs(r.debut) >= maintenant - 30 * 60000)
  const aValider = rdvs.filter((r) => r.compte_rendu?.statut === 'a_valider').length
  const pretes = rdvs.filter((r) => r.fiche_prete).length
  const minutes = prochain ? Math.round((debutMs(prochain.debut) - maintenant) / 60000) : 0
  const d0 = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const salut = new Date().getHours() < 18 ? 'Bonjour' : 'Bonsoir'
  const titres = etat?.titres ?? []
  const bourses = etat?.bourses ?? []
  const y = useMotionValue(0)

  const entrer = () => {
    if (phase !== 'contenu') { passer(); return }
    if (sortie) return
    setSortie(true)
    setTimeout(onEntrer, reduit ? 0 : 220 * RYTHME)
  }
  const fin = (_: unknown, i: PanInfo) => {
    if (i.offset.y < -60 || i.velocity.y < -400) entrer()
    else animate(y, 0, { type: 'spring', bounce: 0.2, duration: 0.4 })
  }

  return (
    <motion.div className="sombre fixed inset-0 z-50 flex touch-none flex-col overflow-hidden bg-encre text-white"
      style={{ y, backgroundImage: 'radial-gradient(560px 460px at 50% 22%, rgba(87,35,243,0.42), transparent 70%), radial-gradient(600px 500px at 0% 105%, rgba(49,20,138,0.9), transparent 70%)' }}
      drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.5, bottom: 0.04 }} onDragEnd={fin}
      exit={{ transform: 'translateY(-100%)', transition: { duration: reduit ? 0 : 0.5 * RYTHME, ease: [0.32, 0.72, 0, 1] } }}>
      <div className="haut-sur flex items-center justify-between px-6 pt-2">
        <div className="flex h-7 items-center gap-1.5" aria-label="Préparateur">
          {phase === 'contenu' && (
            <>
              <motion.div initial={{ opacity: 0, transform: 'scale(1.6)' }} animate={{ opacity: 1, transform: 'scale(1)' }} transition={{ duration: 0.4 * RYTHME, ease: [0.23, 1, 0.32, 1] }}><IconeSabre taille={24} statique /></motion.div>
              <motion.div initial={{ opacity: 0, transform: 'translateX(-6px)' }} animate={{ opacity: 1, transform: 'translateX(0px)' }} transition={{ duration: 0.4 * RYTHME, delay: 0.08 * RYTHME, ease: [0.23, 1, 0.32, 1] }}><MotSabre largeur={84} statique /></motion.div>
            </>
          )}
        </div>
        {phase === 'contenu' && <Apparait delai={0.1} className="text-xs text-lilas first-letter:uppercase">{d0}</Apparait>}
      </div>

      {/* l'intro : nuage de particules plein écran, puis le vrai logo tracé au sabre */}
      <AnimatePresence>
        {phase !== 'contenu' && (
          <motion.div key="intro" className="absolute inset-0 z-10" onClick={passer} exit={{ opacity: 0, transform: 'translateY(-24px) scale(0.92)', transition: { duration: 0.35 * RYTHME, ease: [0.23, 1, 0.32, 1] } }}>
            <Suspense fallback={null}>
              <LogoParticules cible={{ x: 0, y: HAUT, taille: ICONE }} dissoudre={dissoudre} onForme={() => setPhase((p) => (p === 'nuage' ? 'logo' : p))} className="absolute inset-0" />
            </Suspense>
            {phase === 'logo' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ transform: `translateY(${HAUT + 34}px)` }}>
                <div aria-hidden className="anime-halo absolute size-72 rounded-full bg-[radial-gradient(circle,rgba(130,87,245,0.45),transparent_68%)]" style={{ transform: `translateY(-34px)` }} />
                <motion.div className="relative"><IconeSabre taille={ICONE} /></motion.div>
                <motion.div className="relative mt-6"><MotSabre largeur={196} delai={0.22} /></motion.div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <Pret.Provider value={phase === 'contenu'}>
      <div className={cn('relative mt-6 flex min-h-0 flex-1 flex-col px-6', phase !== 'contenu' && 'pointer-events-none')}>
        <h1 className="text-[46px] leading-[1.0]">
          <Lettres texte={salut} delai={0.05} /><br />
          {etat?.prenom && <Lettres texte={etat.prenom} delai={0.12} className="font-normal text-lavande italic" />}
        </h1>
        <Apparait delai={0.2} className="mt-3 flex items-baseline gap-1.5 text-lg text-lilas">
          {!etat ? 'Je récupère votre journée...'
            : prochain && minutes > 0 && minutes < 60 ? <><b className="font-semibold text-white">{prochain.entreprise}</b> dans <span className="chiffre text-white"><SlidingNumber value={minutes} /></span> min</>
            : prochain && minutes >= 60 ? <><b className="font-semibold text-white">{prochain.entreprise}</b> à {prochain.heure}</>
            : prochain ? <><b className="font-semibold text-white">{prochain.entreprise}</b> en ce moment</>
            : aValider ? `${aValider} compte${aValider > 1 ? 's' : ''} rendu${aValider > 1 ? 's' : ''} à valider`
            : rdvs.length ? 'Journée terminée' : 'Pas de rendez-vous aujourd’hui'}
        </Apparait>

        {/* les compteurs du jour */}
        <Apparait delai={0.24} className="mt-5 grid grid-cols-3 gap-2">
          {[[rdvs.length, 'rendez-vous'], [pretes, pretes > 1 ? 'fiches prêtes' : 'fiche prête'], [aValider, 'à valider']].map(([n, l]) => (
            <div key={l as string} className="rounded-2xl bg-white/[0.06] px-3 py-2.5 ring-1 ring-white/10">
              <div className="chiffre text-[26px] leading-none"><SlidingNumber value={n as number} /></div>
              <div className="mt-1 text-[13px] text-lilas">{l}</div>
            </div>
          ))}
        </Apparait>

        {rdvs.length > 0 && <Apparait delai={0.28} className="mt-5"><LigneJournee maintenant={maintenant} grande /></Apparait>}

        {/* l'actualité des clients et leurs cours, en continu */}
        <Apparait delai={0.3} className="mt-auto space-y-2.5 pb-2">
          {titres.length > 0 && (
            <Defilant duree={Math.max(30, titres.length * 9)} className="text-[13px]">
              {titres.map((t, i) => (
                <span key={i} className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                  <span className="rounded-full bg-violet px-2 py-0.5 text-xs font-semibold">{t.entreprise}</span>
                  <span className="text-lilas">{t.titre}</span>
                </span>
              ))}
            </Defilant>
          )}
          {bourses.length > 0 && (
            <Defilant duree={Math.max(20, bourses.length * 7)} inverse className="text-[13px]">
              {bourses.map((b) => (
                <span key={b.entreprise} className="flex shrink-0 items-center gap-2 whitespace-nowrap tabular-nums">
                  <span className="font-semibold">{b.entreprise}</span>
                  <span className="text-lilas">{b.cours.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €</span>
                  <span className={b.variation >= 0 ? 'text-[#7BE3A0]' : 'text-[#FF9AA2]'}>{b.variation >= 0 ? '▲' : '▼'} {Math.abs(b.variation).toLocaleString('fr-FR')} %</span>
                </span>
              ))}
            </Defilant>
          )}
        </Apparait>

        <button onClick={entrer} className="bas-sur mx-auto flex flex-col items-center px-8 pt-3 text-sm font-semibold text-white">
          <span className="relative h-7 w-6" aria-hidden>
            {[0, 1, 2].map((k) => (
              <svg key={k} width="22" height="12" viewBox="0 0 22 12" className="anime-monte absolute left-0.5" style={{ top: 14 - k * 7, animationDelay: `${k * 0.18}s` }}>
                <path d="M2 10l9-8 9 8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ))}
          </span>
          Glissez vers le haut
        </button>
      </div>
      </Pret.Provider>
    </motion.div>
  )
}
