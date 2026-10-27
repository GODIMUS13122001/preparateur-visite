import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowUpRight, CalendarDays, Check, ChevronDown, Copy, FileSpreadsheet, Loader2, LogIn, LogOut, Pencil, Send, Settings2,
  Clock, Smartphone, Sparkles, Zap,
} from 'lucide-react'
import { compte, type EtatClaude, type InfoCRM, type Telephone } from '../api'
import { AnimatedGroup } from '@/components/motion-primitives/animated-group'
import { BorderTrail } from '@/components/motion-primitives/border-trail'
import { TextShimmer } from '@/components/motion-primitives/text-shimmer'
import { DepotCRM } from './Journee'
import { ReglagesAuto } from './Coulisses'
import QRCode from 'qrcode'
import { cn } from '@/lib/utils'
import { useMode } from '../mode'

type Declencheur = Awaited<ReturnType<typeof compte.declencheur>>
type Niveau = 'ok' | 'partiel' | 'manquant' | 'attente'

const VERRE = 'border border-white/80 bg-white/90 shadow-verre'

/* ------------------------------------------------------------------ petits éléments */

function Pastille({ niveau }: { niveau: Niveau }) {
  const styles: Record<Niveau, [string, string]> = {
    ok: ['bg-ok-fond text-ok', 'Connecté'],
    partiel: ['bg-alerte-fond text-alerte', 'À compléter'],
    manquant: ['bg-erreur-fond text-erreur', 'À connecter'],
    attente: ['bg-voile text-violet', 'En cours...'],
  }
  const [c, l] = styles[niveau]
  return (
    <span className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', c)}>
      {niveau === 'ok' ? <Check size={12} strokeWidth={3} /> : niveau === 'attente' ? <Loader2 size={12} className="animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
      {l}
    </span>
  )
}

function Action({ children, onClick, principal, petit, disabled }: { children: React.ReactNode; onClick: () => void; principal?: boolean; petit?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn('flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold transition disabled:opacity-50',
        petit ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
        principal ? 'bg-violet text-white shadow-bouton-petit hover:bg-violet-vif' : 'border border-nuage bg-white text-encre hover:border-lavande')}>
      {children}
    </button>
  )
}

function Connexion({ icone: Icone, couleur, nom, role, niveau, statut, action, children, ouvert }: {
  icone: typeof Zap; couleur: string; nom: string; role: string; niveau: Niveau; statut: React.ReactNode
  action?: React.ReactNode; children?: React.ReactNode; ouvert?: boolean
}) {
  return (
    <div className={cn('relative overflow-hidden rounded-[22px] p-5', VERRE, niveau === 'attente' && 'ring-2 ring-violet/40')}>
      {niveau === 'attente' && <BorderTrail size={90} className="bg-gradient-to-l from-violet via-violet-vif to-transparent" />}
      <div className="flex flex-wrap items-center gap-4">
        <span className={cn('grid size-12 shrink-0 place-items-center rounded-2xl text-white shadow-lg', couleur)}><Icone size={22} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg text-encre">{nom}</h2>
            <span className="text-xs text-brume">{role}</span>
          </div>
          <div className="mt-0.5 text-sm text-ardoise">{statut}</div>
        </div>
        <Pastille niveau={niveau} />
        {action && <div className="flex w-full justify-end gap-2 sm:w-auto">{action}</div>}
      </div>
      <AnimatePresence initial={false}>
        {ouvert && children && (
          <motion.div initial={{ opacity: 0, transform: 'translateY(-4px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}>
            <div className="mt-5 border-t border-nuage pt-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Anneau({ fait, total }: { fait: number; total: number }) {
  const r = 34, c = 2 * Math.PI * r
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" className="-rotate-90">
      <circle cx="42" cy="42" r={r} fill="none" strokeWidth="7" className="stroke-nuage" />
      <motion.circle cx="42" cy="42" r={r} fill="none" strokeWidth="7" strokeLinecap="round" className={fait === total ? 'stroke-ok' : 'stroke-violet'}
        strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - fait / total) }} transition={{ duration: 1.1, ease: 'easeOut' }} />
    </svg>
  )
}

/* ------------------------------------------------------------------ guide du déclencheur Google */

function GuideDeclencheur({ decl }: { decl: Declencheur }) {
  const [copie, setCopie] = useState(false)
  const [ouvert, setOuvert] = useState(false)
  const [code, setCode] = useState(false)
  const actif = !!decl.dernier_signal
  const etapes = [
    { titre: 'Copiez le texte d’activation', fait: copie || actif, action: <Action petit principal={!copie && !actif} onClick={() => { navigator.clipboard?.writeText(decl.code); setCopie(true) }}>{copie ? <><Check size={13} /> Copié</> : <><Copy size={13} /> Copier</>}</Action> },
    { titre: 'Ouvrez Google Apps Script avec le compte de votre agenda', fait: ouvert || actif, action: <a href="https://script.new" target="_blank" rel="noreferrer" onClick={() => setOuvert(true)} className="flex items-center gap-1.5 rounded-full border border-nuage bg-white px-3 py-1.5 text-xs font-semibold text-encre hover:border-lavande">Ouvrir <ArrowUpRight size={13} /></a> },
    { titre: 'Collez le texte copié, enregistrez, puis cliquez sur Exécuter', fait: actif, aide: 'Google demande votre accord : cliquez sur « Paramètres avancés », « Accéder au projet », puis « Autoriser ». C’est votre propre agenda, rien ne sort de votre compte.' },
  ]
  return (
    <div>
      <p className="text-sm text-ardoise">Une fois activée, chaque rendez-vous créé ou modifié dans votre agenda apparaît ici en quelques secondes, sans rien consommer sur votre abonnement Claude.</p>
      <ol className="mt-4 space-y-3">
        {etapes.map((e, i) => (
          <li key={i} className="flex items-center gap-3">
            <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition-colors', e.fait ? 'bg-ok text-white' : 'bg-voile text-violet')}>
              {e.fait ? <Check size={14} strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-encre">{e.titre}</p>
              {e.aide && <p className="text-xs text-brume">{e.aide}</p>}
            </div>
            {e.action}
          </li>
        ))}
        <li className="flex items-center gap-3">
          <span className={cn('grid size-7 shrink-0 place-items-center rounded-full', actif ? 'bg-ok text-white' : 'bg-voile text-violet')}>
            {actif ? <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', bounce: 0.6 }}><Check size={14} strokeWidth={3} /></motion.span> : <Loader2 size={14} className="animate-spin" />}
          </span>
          {actif
            ? <p className="text-sm font-semibold text-ok">C’est actif : signal reçu de Google le {decl.dernier_signal}.</p>
            : <TextShimmer className="text-sm font-semibold [--base-color:var(--color-ardoise)] [--base-gradient-color:var(--color-violet)]">J’attends le premier signal de Google...</TextShimmer>}
        </li>
      </ol>
      <button onClick={() => setCode(!code)} className="mt-4 flex items-center gap-1 text-xs text-brume hover:text-violet">
        <ChevronDown size={13} className={cn('transition', code && 'rotate-180')} /> {code ? 'Masquer le texte' : 'Voir le texte'}
      </button>
      {code && <pre className="mt-2 max-h-56 overflow-auto rounded-xl bg-encre p-4 text-xs leading-relaxed text-lilas">{decl.code}</pre>}
    </div>
  )
}

/* ------------------------------------------------------------------ page */

export default function Compte({ crm, onCrm, onPrenom }: {
  tel: Telephone | null; crm: InfoCRM | null; onCrm: (c: InfoCRM) => void; onPrenom: (p: string) => void
}) {
  const prospection = useMode() === 'prospection'
  const [claude, setClaude] = useState<EtatClaude | null>(null)
  const [decl, setDecl] = useState<Declencheur | null>(null)
  const [prenom, setPrenom] = useState('')
  const [edition, setEdition] = useState(false)
  const [connexion, setConnexion] = useState(false)
  const [guide, setGuide] = useState(false)
  const [depot, setDepot] = useState(false)
  const [test, setTest] = useState<'' | 'envoi' | 'ok' | 'ko'>('')
  const [verif, setVerif] = useState<'' | 'envoi' | 'ok' | 'ko'>('')
  const [mobile, setMobile] = useState<Awaited<ReturnType<typeof compte.relais>> | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [voirQr, setVoirQr] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const [qrEtat, setQrEtat] = useState<'' | 'envoi' | 'ko'>('')
  const nouveauCode = async () => {
    setQrEtat('envoi')
    try {
      const c = await compte.codeAppairage()
      const image = await QRCode.toDataURL(c.lien, { margin: 2, width: 400, errorCorrectionLevel: 'M', color: { dark: '#120A29', light: '#FFFFFF' } })
      setCode(c.code)
      setQr(image)
      setQrEtat('')
      return true
    } catch {
      setQrEtat('ko')
      return false
    }
  }
  const basculerQr = async () => {
    if (voirQr) { setVoirQr(false); return }
    setQr(null)
    if (await nouveauCode()) setVoirQr(true)
  }
  // toutes les lectures répétées sont abandonnées quand on quitte la page
  useEffect(() => {
    const c = new AbortController()
    const lire = () => compte.relais(c.signal).then(setMobile).catch(() => {})
    lire()
    const t = setInterval(lire, 10000)
    return () => { clearInterval(t); c.abort() }
  }, [])

  useEffect(() => {
    const c = new AbortController()
    compte.etat(c.signal).then(setClaude).catch(() => {})
    compte.profil(c.signal).then((p) => setPrenom(p.prenom)).catch(() => {})
    const lireD = () => compte.declencheur(c.signal).then(setDecl).catch(() => {})
    lireD()
    const t = setInterval(lireD, 4000)
    return () => { clearInterval(t); c.abort() }
  }, [])

  // pendant une connexion à Claude : on vérifie toutes les 2 secondes
  useEffect(() => {
    if (!connexion) return
    const c = new AbortController()
    const t = setInterval(async () => {
      try {
        const e = await compte.etat(c.signal)
        setClaude(e)
        if (e.connecte) { setConnexion(false); compte.profil(c.signal).then((p) => { setPrenom(p.prenom); onPrenom(p.prenom) }).catch(() => {}) }
      } catch { /* abandonné ou serveur occupé : on réessaie au prochain tour */ }
    }, 2000)
    return () => { clearInterval(t); c.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connexion])

  const etats = useMemo(() => ({
    claude: (connexion || !claude ? 'attente' : claude.connecte ? 'ok' : 'manquant') as Niveau,
    crm: (crm?.ok ? 'ok' : 'manquant') as Niveau,
    agenda: (decl?.dernier_signal ? 'ok' : decl?.source === 'claude' || verif === 'ok' ? 'partiel' : 'manquant') as Niveau,
    tel: (mobile?.configure && !mobile.erreur ? 'ok' : 'manquant') as Niveau,
  }), [claude, crm, decl, mobile, verif, connexion])
  const faits = Object.values(etats).filter((x) => x === 'ok').length
  const manque = [claude && !claude.connecte && 'Claude', !crm?.ok && 'le CRM', etats.agenda !== 'ok' && 'Google Agenda', etats.tel !== 'ok' && 'l’appli mobile'].filter(Boolean) as string[]

  const seConnecter = async () => {
    if (claude && !claude.installe) await compte.installer()
    await compte.connecter()
    setConnexion(true)
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pt-10 pb-20 sm:px-6">
      <h1 className="text-4xl text-encre">Mon compte</h1>
      <p className="mt-2 text-lg text-ardoise">Ce dont j’ai besoin pour travailler pour vous.</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* ---------------------------------------------------------- profil */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className={cn('rounded-[24px] p-6 text-center', VERRE)}>
            <div className="relative mx-auto w-fit">
              <Anneau fait={faits} total={4} />
              <span className="absolute inset-0 m-auto grid size-14 place-items-center rounded-full bg-gradient-to-br from-violet-vif to-violet-profond text-xl font-semibold text-white">
                {prenom ? prenom.charAt(0).toUpperCase() : '·'}
              </span>
            </div>
            {edition ? (
              <form className="mt-4 flex gap-2" onSubmit={async (e) => { e.preventDefault(); const r = await compte.enregistrerProfil(prenom); setPrenom(r.prenom); onPrenom(r.prenom); setEdition(false) }}>
                <input autoFocus aria-label="Votre prénom" value={prenom} onChange={(e) => setPrenom(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-lavande bg-white px-3 py-1.5 text-center text-sm" />
                <button className="rounded-full bg-violet px-3 text-xs font-semibold text-white">OK</button>
              </form>
            ) : (
              <button onClick={() => setEdition(true)} title="Modifier le prénom" className="group titre mx-auto mt-4 flex items-center gap-1.5 text-2xl text-encre">
                {prenom || 'Votre prénom'} <Pencil size={13} className="text-brume opacity-40 transition group-hover:opacity-100" />
              </button>
            )}
            {/* l'adresse e-mail sur sa ligne (coupée au besoin entre deux caractères, jamais tronquée), l'abonnement en dessous */}
            {!claude ? <p className="mt-1 text-sm text-ardoise">Vérification du compte Claude...</p>
              : claude.connecte ? (
                <div className="mt-1 text-sm text-ardoise">
                  <p className="[overflow-wrap:anywhere]">{claude.email}</p>
                  <p className="text-xs text-brume">{claude.plan ?? 'Claude'}</p>
                </div>
              ) : <p className="mt-1 text-sm text-ardoise">Compte Claude non connecté</p>}
            <div className={cn('mt-5 rounded-2xl px-4 py-3 text-sm', manque.length === 0 ? 'bg-ok-fond text-ok' : 'bg-voile text-violet-profond')}>
              {manque.length === 0 ? <><b className="font-semibold">Tout est prêt.</b> Je travaille pour vous.</> : <><b className="font-semibold">{faits} sur 4 connectés.</b> Il reste {manque.join(', ')}.</>}
            </div>
          </div>
          <details className={cn('group rounded-[20px] p-5 text-sm', VERRE)}>
            <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-encre">
              <Sparkles size={15} className="text-violet" /> Confier l’application à quelqu’un
              <ChevronDown size={15} className="ml-auto text-brume transition group-open:rotate-180" />
            </summary>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-ardoise">
              <li>Envoyez-lui le fichier <b className="text-encre">Préparateur de visite.dmg</b>.</li>
              <li>Il glisse l’application dans Applications et l’ouvre (la première fois : clic droit, puis Ouvrir).</li>
              <li>Il clique sur « Se connecter » avec son compte Claude. C’est tout.</li>
            </ol>
          </details>
        </aside>

        {/* ---------------------------------------------------------- connexions */}
        <AnimatedGroup preset="blur-slide" className="space-y-3">
          <Connexion icone={Sparkles} couleur="bg-gradient-to-br from-violet-vif to-violet-profond" nom="Claude" role="Le moteur · indispensable" niveau={etats.claude}
            statut={!claude ? 'Vérification...' : connexion ? 'Terminez la connexion dans la page qui s’est ouverte dans votre navigateur.'
              : claude.connecte ? <>Connecté avec <b className="font-semibold text-encre">{claude.email}</b> · {claude.plan}</>
              : !claude.installe ? 'Claude n’est pas encore installé sur cet ordinateur.' : 'Il faut un abonnement Claude Pro, Max, Team ou Enterprise.'}
            action={claude?.connecte
              ? <Action petit onClick={async () => { setClaude(await compte.deconnecter()); compte.profil().then((p) => { setPrenom(p.prenom); onPrenom(p.prenom) }) }}><LogOut size={13} /> Se déconnecter</Action>
              : <Action principal disabled={connexion || !claude} onClick={seConnecter}><LogIn size={15} /> {claude && !claude.installe ? 'Installer et se connecter' : 'Se connecter'}</Action>} />

          <Connexion icone={FileSpreadsheet} couleur="bg-gradient-to-br from-[#2E9E62] to-[#17803D]" nom={prospection ? 'CRM de prospection' : 'CRM'} role={prospection ? 'Vos prospects · indispensable' : 'Vos clients · indispensable'} niveau={etats.crm}
            statut={crm?.ok ? <>Export du <b className="font-semibold text-encre">{crm.date_export}</b> · {crm.entreprises} {prospection ? 'prospects' : 'clients'} · {crm.rendez_vous} rendez-vous</> : prospection ? 'Déposez le fichier Excel de votre CRM de prospection.' : 'Déposez l’export Excel de votre CRM.'}
            action={<Action principal={!crm?.ok} petit={!!crm?.ok} onClick={() => setDepot(true)}>{crm?.ok ? 'Changer de fichier' : 'Déposer mon export'}</Action>} />

          <Connexion icone={CalendarDays} couleur="bg-gradient-to-br from-[#4C8BF5] to-[#1A5FD1]" nom="Google Agenda" role="Vos rendez-vous · recommandé" niveau={etats.agenda} ouvert={guide}
            statut={decl?.dernier_signal ? <>Mise à jour instantanée active · {decl.evenements} rendez-vous à venir</>
              : etats.agenda === 'partiel' ? 'Lu par Claude. Activez la mise à jour instantanée pour voir chaque nouveau rendez-vous tout de suite.'
              : 'Reliez votre agenda pour que les fiches se préparent et partent toutes seules.'}
            action={<>
              {etats.agenda !== 'ok' && verif !== 'ok' && (
                <Action petit onClick={async () => { setVerif('envoi'); const r = await compte.agenda().catch(() => ({ ok: false })); setVerif(r.ok ? 'ok' : 'ko') }} disabled={verif === 'envoi'}>
                  {verif === 'envoi' ? <Loader2 size={13} className="animate-spin" /> : null} Vérifier l’accès
                </Action>
              )}
              <Action principal={etats.agenda !== 'ok'} petit={etats.agenda === 'ok'} onClick={() => setGuide(!guide)}><Zap size={14} /> {etats.agenda === 'ok' ? 'Réglage' : 'Activer'}</Action>
            </>}>
            {decl && <GuideDeclencheur decl={decl} />}
            {verif === 'ko' && (
              <p className="mt-4 rounded-xl bg-alerte-fond p-3 text-sm text-alerte">Claude n’a pas accès à votre agenda. Sur claude.ai, Réglages → Connecteurs, activez « Google Calendar », puis réessayez.</p>
            )}
          </Connexion>

          <Connexion icone={Smartphone} couleur="bg-gradient-to-br from-encre to-[#2B1E5C]" nom="Appli mobile" role="Fiches à écouter, comptes rendus dictés · recommandé" niveau={etats.tel} ouvert={voirQr}
            statut={mobile?.configure
              ? <>Votre journée est sur le téléphone{mobile.derniere_publication ? `, mise à jour à ${mobile.derniere_publication}` : ''}. Dictez vos comptes rendus après chaque rendez-vous.</>
              : 'L’appli mobile n’est pas encore déployée pour ce Mac.'}
            action={mobile?.lien ? <Action principal={!voirQr && etats.tel !== 'ok'} petit={voirQr || etats.tel === 'ok'} onClick={basculerQr}><Smartphone size={14} /> {qrEtat === 'envoi' && !voirQr ? 'Je prépare le code...' : qrEtat === 'ko' && !voirQr ? 'Réessayer' : voirQr ? 'Masquer le QR code' : etats.tel === 'ok' ? 'Relier un autre téléphone' : 'Relier mon téléphone'}</Action> : undefined}>
            {qr && (
              <div className="flex flex-wrap items-center gap-6">
                <img src={qr} alt="QR code d’appairage" width={176} height={176} className="size-44 shrink-0 rounded-2xl bg-white p-2 shadow-lg [image-rendering:pixelated]" />
                <div className="min-w-0 flex-1">
                  <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ardoise">
                    <li>Scannez le QR code avec l’appareil photo de l’iPhone.</li>
                    <li>Dans Safari : Partager, puis <b className="text-encre">Sur l’écran d’accueil</b>.</li>
                    <li>Ouvrez l’appli depuis son icône et tapez ce code :</li>
                  </ol>
                  <div className="mt-3 flex items-center gap-3">
                    <span className="rounded-2xl bg-encre px-5 py-3 chiffre text-3xl font-semibold tracking-[0.3em] text-white" aria-label={code ? `Code : ${code.split('').join(' ')}` : undefined}>{code ?? '······'}</span>
                    <button onClick={nouveauCode} className="text-xs font-semibold text-violet hover:underline">Nouveau code</button>
                  </div>
                  <p className="mt-2 text-xs text-brume">Valable 15 minutes, une seule fois. Ne le montrez qu’à vos propres appareils.</p>
                </div>
              </div>
            )}
          </Connexion>

          <div className={cn('rounded-[22px] p-5', VERRE)}>
            <div className="mb-3 flex items-center gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-voile text-violet"><Clock size={22} /></span>
              <div>
                <h2 className="text-lg text-encre">Envoi automatique</h2>
                <p className="text-sm text-ardoise">Quand je prépare la fiche, quand je l’envoie, et avec quel soin je l’écris.</p>
              </div>
            </div>
            <ReglagesAuto />
          </div>
        </AnimatedGroup>
      </div>

      <AnimatePresence>
        {depot && <DepotCRM crm={crm} onFermer={() => setDepot(false)} onCharge={(c) => { onCrm(c); setDepot(false) }} />}
      </AnimatePresence>
    </div>
  )
}
