import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Copy, MapPin, MapPinOff, Navigation, Video, X } from 'lucide-react'

/* Le plan du client dans la carte du rendez-vous : un aperçu OpenStreetMap (gratuit), puis on choisit son GPS. */

const ZOOM = 15
const TUILE = 256

const HAUT = 144 // hauteur de l'aperçu (h-36)
const DEMI_LARGEUR = 200 // la moitié de l'aperçu sur le plus large des téléphones, avec de la marge

function tuile(lat: number, lon: number) {
  const n = 2 ** ZOOM
  const x = ((lon + 180) / 360) * n
  const r = (lat * Math.PI) / 180
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
  return { px: x * TUILE, py: y * TUILE, tx: Math.floor(x), ty: Math.floor(y) }
}

/** Les seules tuiles qui se voient : une rangée (deux si le point est tout en haut de sa tuile), deux ou trois colonnes.
   Le point reste centré en largeur ; en hauteur, l'aperçu se cale dans la rangée du point. Avant : 15 tuiles par carte. */
function cadrage(c: { px: number; py: number; tx: number; ty: number }) {
  const fx = c.px - c.tx * TUILE, fy = c.py - c.ty * TUILE
  // haut de l'aperçu, en pixels de carte : dans la rangée du point si le repère (environ 44 px au-dessus du point) y tient
  const haut = fy >= 44 ? Math.min(Math.max(0, fy - HAUT / 2), TUILE - HAUT) + c.ty * TUILE : c.py - HAUT / 2
  const lignes = [c.ty]
  if (haut < c.ty * TUILE) lignes.unshift(c.ty - 1)
  const colonnes = [c.tx]
  if (fx < DEMI_LARGEUR) colonnes.unshift(c.tx - 1)
  if (TUILE - fx < DEMI_LARGEUR) colonnes.push(c.tx + 1)
  return { haut, repereY: c.py - haut, tuiles: lignes.flatMap((ty) => colonnes.map((tx) => ({ tx, ty }))) }
}

export function Plan({ adresse, geo, entreprise, visio }: { adresse: string | null; geo: { lat: number; lon: number } | null | undefined; entreprise: string; visio: boolean }) {
  const [choix, setChoix] = useState(false)
  const c = geo ? tuile(geo.lat, geo.lon) : null
  const vue = c ? cadrage(c) : null
  // pas d'adresse (visio, ou CRM incomplet) : le cadre reste, et le dit
  if (!adresse) {
    return (
      <div className="overflow-hidden rounded-[22px] bg-fond ring-1 ring-encre/[0.06]">
        <div aria-hidden className="h-36 bg-[radial-gradient(circle_at_1px_1px,rgba(18,10,41,0.12)_1px,transparent_0)] [background-size:14px_14px]" />
        <div className="flex items-center gap-3 p-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white text-ardoise">{visio ? <Video size={18} /> : <MapPinOff size={18} />}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-encre">{visio ? 'Rendez-vous en visio' : 'Adresse non disponible'}</span>
            <span className="block text-xs text-ardoise">{visio ? 'Pas de trajet à prévoir.' : 'Elle n’est pas renseignée dans le CRM.'}</span>
          </span>
        </div>
      </div>
    )
  }
  return (
    <>
      <button type="button" onClick={() => setChoix(true)} aria-label={`Itinéraire vers ${entreprise}, ${adresse}`}
        className="group block w-full overflow-hidden rounded-[22px] bg-fond text-left ring-1 ring-encre/[0.06]">
        {c ? (
          <div aria-hidden className="relative h-36 overflow-hidden bg-[#ECE8F0]">
            {/* un seul filtre pour tout l'aperçu, pas un par tuile */}
            <div className="absolute inset-0 [filter:saturate(0.45)_contrast(1.05)]">
              {vue!.tuiles.map(({ tx, ty }) => (
                <img key={`${tx}-${ty}`} alt="" draggable={false} decoding="async" src={`https://tile.openstreetmap.org/${ZOOM}/${tx}/${ty}.png`}
                  onLoad={(e) => { e.currentTarget.style.opacity = '1' }}
                  className="tuile-osm absolute size-64 max-w-none opacity-0 transition-opacity duration-300"
                  style={{ left: `calc(50% + ${tx * TUILE - c.px}px)`, top: `${ty * TUILE - vue!.haut}px` }} />
              ))}
            </div>
            <span className="absolute left-1/2 grid size-9 place-items-center rounded-full rounded-br-none bg-violet text-white shadow-[0_8px_18px_-6px_var(--color-violet)]" style={{ top: vue!.repereY, transform: 'translate(-50%, -115%) rotate(45deg)' }}>
              <span className="size-3 rounded-full bg-white" />
            </span>
            <span className="absolute right-1.5 bottom-1 rounded bg-white/70 px-1 text-xs text-encre/80">©&nbsp;OpenStreetMap</span>
          </div>
        ) : (
          <div aria-hidden className="grid h-36 place-items-center bg-[radial-gradient(circle_at_1px_1px,rgba(18,10,41,0.12)_1px,transparent_0)] [background-size:14px_14px] text-xs font-semibold text-ardoise">Carte indisponible pour l’instant</div>
        )}
        <div className="flex items-center gap-3 p-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white text-violet"><MapPin size={18} /></span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-[15px] leading-snug font-semibold text-encre">{adresse}</span>
            <span className="block text-xs text-ardoise">Toucher pour lancer l’itinéraire</span>
          </span>
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-violet text-white"><Navigation size={17} /></span>
        </div>
      </button>
      {createPortal(<AnimatePresence>{choix && <ChoixGps key="gps" adresse={adresse} geo={geo} onFermer={() => setChoix(false)} />}</AnimatePresence>, document.body)}
    </>
  )
}

function ChoixGps({ adresse, geo, onFermer }: { adresse: string; geo: { lat: number; lon: number } | null | undefined; onFermer: () => void }) {
  const [copie, setCopie] = useState(false)
  const q = encodeURIComponent(adresse)
  const ll = geo ? `${geo.lat},${geo.lon}` : null
  const liens = [
    { nom: 'Plans', url: `https://maps.apple.com/?daddr=${ll ?? q}` },
    { nom: 'Google Maps', url: `https://www.google.com/maps/dir/?api=1&destination=${ll ?? q}` },
    { nom: 'Waze', url: ll ? `https://waze.com/ul?ll=${ll}&navigate=yes` : `https://waze.com/ul?q=${q}&navigate=yes` },
  ]
  return (
    <>
      <motion.button aria-label="Fermer" onClick={onFermer} className="fixed inset-0 z-[60] bg-encre/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
      <motion.div role="dialog" aria-label="Lancer l’itinéraire" className="bas-sur fixed inset-x-0 bottom-0 z-[61] rounded-t-[28px] bg-white px-5 pt-3"
        initial={{ transform: 'translateY(100%)' }} animate={{ transform: 'translateY(0%)' }} exit={{ transform: 'translateY(100%)' }}
        transition={{ duration: 0.36, ease: [0.32, 0.72, 0, 1] }}>
        <div className="flex items-center justify-between">
          <span className="w-11" /><span className="h-1.5 w-10 rounded-full bg-encre/20" aria-hidden />
          <button onClick={onFermer} aria-label="Fermer" className="grid size-11 place-items-center rounded-full text-ardoise"><X size={20} /></button>
        </div>
        <h2 className="text-[22px] text-encre">Itinéraire</h2>
        <p className="mt-1 text-sm text-ardoise">{adresse}</p>
        <div className="mt-4 space-y-2">
          {liens.map((l) => (
            <a key={l.nom} href={l.url} target="_blank" rel="noopener" onClick={() => setTimeout(onFermer, 300)}
              className="flex min-h-14 items-center justify-between rounded-2xl bg-fond px-4 font-semibold text-encre active:bg-voile">
              Ouvrir dans {l.nom}<Navigation size={17} className="text-violet" />
            </a>
          ))}
          <button onClick={() => { navigator.clipboard?.writeText(adresse).then(() => setCopie(true)).catch(() => {}) }}
            className="flex min-h-12 w-full items-center justify-center gap-2 text-sm font-semibold text-ardoise">
            <Copy size={15} /> {copie ? 'Adresse copiée' : 'Copier l’adresse'}
          </button>
        </div>
      </motion.div>
    </>
  )
}
