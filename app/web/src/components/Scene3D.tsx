import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/**
 * Fond 3D de la page d'accueil : une sphère de particules aux couleurs de la charte, entourée de deux
 * anneaux, qui tourne lentement et suit la souris. Image fixe si l'utilisateur préfère réduire les animations.
 */
export default function Scene3D({ className }: { className?: string }) {
  const hote = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = hote.current
    if (!el) return
    const reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 100)
    camera.position.set(0, 0, 9)
    // des points flous n'ont pas besoin d'anti-crénelage ; 1,5 pixel par point d'écran suffit (moins de pixels à calculer)
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(el.clientWidth, el.clientHeight)
    el.appendChild(renderer.domElement)

    const groupe = new THREE.Group()
    scene.add(groupe)

    // sphère : répartition de Fibonacci, couleur du violet profond (bas) au lavande (haut)
    const N = 2600
    const pos = new Float32Array(N * 3)
    const col = new Float32Array(N * 3)
    const profond = new THREE.Color('#5723F3'), clair = new THREE.Color('#D8CCFB')
    const or = Math.PI * (3 - Math.sqrt(5))
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2
      const r = Math.sqrt(1 - y * y)
      const t = or * i
      const R = 2.6 + (Math.random() - 0.5) * 0.08
      pos.set([Math.cos(t) * r * R, y * R, Math.sin(t) * r * R], i * 3)
      const c = profond.clone().lerp(clair, (y + 1) / 2)
      col.set([c.r, c.g, c.b], i * 3)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const disque = (() => {
      const c = document.createElement('canvas')
      c.width = c.height = 64
      const g = c.getContext('2d')!
      const d = g.createRadialGradient(32, 32, 0, 32, 32, 32)
      d.addColorStop(0, 'rgba(255,255,255,1)')
      d.addColorStop(0.4, 'rgba(255,255,255,0.6)')
      d.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = d
      g.fillRect(0, 0, 64, 64)
      return new THREE.CanvasTexture(c)
    })()
    const mat = new THREE.PointsMaterial({ size: 0.075, vertexColors: true, map: disque, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    const sphere = new THREE.Points(geo, mat)
    groupe.add(sphere)

    // deux anneaux de particules inclinés, comme des orbites de données
    const anneaux: THREE.Points[] = []
    ;[[3.6, 0.5, '#8257F5'], [4.3, -0.35, '#AC8FF9']].forEach(([rayon, incl, couleur]) => {
      const M = 420
      const p = new Float32Array(M * 3)
      for (let i = 0; i < M; i++) {
        const a = (i / M) * Math.PI * 2
        p.set([Math.cos(a) * (rayon as number), (Math.random() - 0.5) * 0.06, Math.sin(a) * (rayon as number)], i * 3)
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(p, 3))
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.055, color: couleur as string, map: disque, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }))
      pts.rotation.x = incl as number
      groupe.add(pts)
      anneaux.push(pts)
    })

    // coeur lumineux
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: disque, color: '#5723F3', transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }))
    halo.scale.set(6, 6, 1)
    groupe.add(halo)

    const souris = { x: 0, y: 0 }
    const surMouvement = (e: PointerEvent) => {
      souris.x = (e.clientX / window.innerWidth - 0.5) * 2
      souris.y = (e.clientY / window.innerHeight - 0.5) * 2
    }
    window.addEventListener('pointermove', surMouvement)
    const surTaille = () => {
      camera.aspect = el.clientWidth / el.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(el.clientWidth, el.clientHeight)
    }
    window.addEventListener('resize', surTaille)

    // la boucle ne tourne que si la scène est à l'écran et la fenêtre visible
    let id = 0
    let aLEcran = true
    const horloge = new THREE.Timer()
    horloge.connect(document)
    const boucle = (maintenant?: number) => {
      id = 0
      horloge.update(maintenant)
      const t = horloge.getElapsed()
      sphere.rotation.y = t * 0.08
      anneaux[0].rotation.y = t * 0.12
      anneaux[1].rotation.y = -t * 0.09
      groupe.rotation.x += (souris.y * 0.25 - groupe.rotation.x) * 0.04
      groupe.rotation.z += (-souris.x * 0.15 - groupe.rotation.z) * 0.04
      halo.material.opacity = 0.3 + Math.sin(t * 1.4) * 0.06
      renderer.render(scene, camera)
      if (!reduit && aLEcran && !document.hidden) id = requestAnimationFrame(boucle)
    }
    // à la reprise, l'horloge repart d'ici : la sphère continue sans sauter
    const relancer = () => { if (!reduit && !id && aLEcran && !document.hidden) { horloge.reset(); id = requestAnimationFrame(boucle) } }
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([e]) => { aLEcran = e.isIntersecting; relancer() }) : null
    io?.observe(el)
    document.addEventListener('visibilitychange', relancer)
    boucle()

    return () => {
      cancelAnimationFrame(id)
      io?.disconnect()
      document.removeEventListener('visibilitychange', relancer)
      horloge.dispose()
      window.removeEventListener('pointermove', surMouvement)
      window.removeEventListener('resize', surTaille)
      scene.traverse((o) => {
        const m = o as THREE.Points
        m.geometry?.dispose()
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
        mats.forEach((x) => x.dispose())
      })
      disque.dispose()
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={hote} className={className} aria-hidden />
}
