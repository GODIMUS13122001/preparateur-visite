import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/* Intro de l'accueil (Three.js, skills threejs-shaders / threejs-animation) :
   1. un nuage de particules seul, qui dérive et scintille dans tout l'écran ;
   2. au bout de quelques secondes, il se reforme en tourbillon sur le logo, à sa place exacte ;
   3. quand le vrai logo apparaît (effet sabre), les particules se dissolvent.
   Tout le mouvement est calculé sur la carte graphique. */

const NUAGE = 0.7 // secondes (temps de la scène) de nuage seul, emporté par le vent
const RASSEMBLE = 1.05 // secondes (temps de la scène) de tourbillon jusqu'au logo
/** Toute l'intro est jouée un peu plus vite (environ 18 % de durée en moins), sans rien changer à la scène :
   le temps de la scène avance 1/RYTHME fois plus vite que l'horloge. */
const RYTHME = 0.82

const SOMMET = /* glsl */ `
uniform float uProgres;
uniform float uTemps;
uniform float uDissous;
uniform float uTaille;
uniform vec2 uCentre;
attribute vec3 aNuage;
attribute float aDelai;
attribute float aGraine;
varying float vAlpha;
varying float vTeinte;

// bruit de valeur 3D, assez pour un vent qui tourbillonne
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float bruit(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
vec2 vent(vec3 p, float t) {
  // un courant d'air : poussée générale vers la droite, rafales, et remous du bruit
  float rafale = 0.6 + 0.4 * sin(t * 1.7) * sin(t * 0.9 + 1.3);
  vec2 remous = vec2(bruit(p * 0.45 + vec3(0.0, 0.0, t * 0.6)) - 0.5, bruit(p * 0.45 + vec3(5.2, 1.3, t * 0.6)) - 0.5) * 2.2;
  return vec2(0.9 * rafale, 0.25 * sin(t * 1.1 + p.x * 0.4)) + remous;
}
float sortieForte(float t) { return 1.0 - pow(1.0 - t, 3.0); }

void main() {
  float t = clamp((uProgres - aDelai) / 0.7, 0.0, 1.0);
  float e = sortieForte(t);
  // 1. nuage soufflé par le vent, chaque particule à sa façon
  vec3 n = aNuage;
  n.xy += vent(aNuage, uTemps) * (0.5 + aGraine) * min(uTemps, 1.5) * 1.1;
  n.xy += vec2(sin(uTemps * (1.5 + aGraine * 2.0) + aGraine * 40.0), cos(uTemps * (1.2 + aGraine * 1.7) + aGraine * 23.0)) * 0.12;
  // 2. le tourbillon : la particule s'enroule autour du logo en se rapprochant, de plus en plus vite
  vec2 d = n.xy - uCentre;
  float r0 = length(d);
  float a0 = atan(d.y, d.x);
  float tours = (1.4 + aGraine * 1.2) * 6.2831;
  float angle = a0 + tours * e * e;
  float r = mix(r0, 0.35 + aGraine * 0.5, smoothstep(0.0, 0.85, e));
  vec3 spirale = vec3(uCentre + vec2(cos(angle), sin(angle)) * r, mix(n.z, 0.0, e));
  // 3. sortie du tourbillon : chaque particule se pose à sa place dans le « e »
  vec3 p = mix(n, spirale, smoothstep(0.0, 0.25, e));
  p = mix(p, position, smoothstep(0.62, 1.0, e));
  p.z += sin(uTemps * 1.3 + aGraine * 18.0) * 0.03 * e;
  p += vec3(position.xy - uCentre, 0.0) * uDissous * 0.3 * aGraine;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float scintille = mix(0.45 + 0.55 * abs(sin(uTemps * 2.1 + aGraine * 40.0)), 1.0, e);
  // traînée : les particules emportées s'étirent un peu plus pendant le tourbillon
  gl_PointSize = uTaille * mix(0.7 + aGraine * 1.1, 0.5 + aGraine * 0.6, e) * (1.0 + 0.5 * sin(e * 3.1416)) / -mv.z;
  vAlpha = scintille * (1.0 - uDissous);
  vTeinte = aGraine;
}`

const FRAGMENT = /* glsl */ `
varying float vAlpha;
varying float vTeinte;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float halo = smoothstep(0.5, 0.0, d);
  float coeur = smoothstep(0.16, 0.0, d);
  vec3 violet = vec3(0.341, 0.137, 0.953);
  vec3 lavande = vec3(0.675, 0.561, 0.976);
  vec3 c = mix(violet, lavande, smoothstep(0.05, 0.75, vTeinte));
  c = mix(c, vec3(1.0), smoothstep(0.86, 1.0, vTeinte) * 0.8 + coeur * 0.4);
  gl_FragColor = vec4(c, (halo * 0.5 + coeur * 0.65) * vAlpha);
}`

/** Échantillonne l'icône en points (coordonnées 0..1). */
async function pointsDuLogo(src: string, cible: number): Promise<number[]> {
  const img = new Image()
  await new Promise<void>((ok, ko) => { img.onload = () => ok(); img.onerror = () => ko(new Error('logo')); img.src = src })
  const T = 240
  const c = document.createElement('canvas')
  c.width = c.height = T
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0, T, T)
  const px = g.getImageData(0, 0, T, T).data
  const pleins: number[] = []
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (px[(y * T + x) * 4 + 3] > 120) pleins.push(x, y)
  const n = pleins.length / 2, pas = Math.max(1, n / cible), out: number[] = []
  for (let k = 0; k < n; k += pas) { const i = Math.floor(k) * 2; out.push((pleins[i] + Math.random()) / T, (pleins[i + 1] + Math.random()) / T) }
  return out
}

/** `cible` : centre et taille (en pixels, depuis le centre de l'écran) où le « e » doit se former. */
export default function LogoParticules({ cible, dissoudre, onForme, className }: {
  cible: { x: number; y: number; taille: number }; dissoudre: boolean; onForme: () => void; className?: string
}) {
  const boite = useRef<HTMLDivElement>(null)
  const etat = useRef({ dissoudre, onForme })
  etat.current = { dissoudre, onForme }

  useEffect(() => {
    const el = boite.current
    if (!el) return
    const rendu = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'high-performance' })
    const dpr = Math.min(window.devicePixelRatio, 2)
    rendu.setPixelRatio(dpr)
    el.appendChild(rendu.domElement)
    rendu.domElement.style.cssText = 'width:100%;height:100%;display:block'
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100)
    camera.position.z = 7
    const groupe = new THREE.Group()
    scene.add(groupe)
    const uniformes = { uProgres: { value: 0 }, uTemps: { value: 0 }, uDissous: { value: 0 }, uTaille: { value: 30 * dpr }, uCentre: { value: new THREE.Vector2(0, 0) } }
    let points: THREE.Points | null = null
    let vivant = true
    const w = el.clientWidth || 390, h = el.clientHeight || 844
    rendu.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    const hautVisible = 2 * camera.position.z * Math.tan((camera.fov * Math.PI) / 360) // hauteur de la scène visible à z = 0
    const parPixel = hautVisible / h
    uniformes.uCentre.value.set(cible.x * parPixel, -cible.y * parPixel)

    pointsDuLogo('/logo-icone.svg', 2800).then((uv) => {
      if (!vivant) return
      const n = uv.length / 2
      const pos = new Float32Array(n * 3), nuage = new Float32Array(n * 3), delai = new Float32Array(n), graine = new Float32Array(n)
      const larg = hautVisible * camera.aspect
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (cible.x + (uv[i * 2] - 0.5) * cible.taille) * parPixel
        pos[i * 3 + 1] = -(cible.y + (uv[i * 2 + 1] - 0.5) * cible.taille) * parPixel
        pos[i * 3 + 2] = (Math.random() - 0.5) * 0.08
        nuage[i * 3] = (Math.random() - 0.5) * larg * 1.3
        nuage[i * 3 + 1] = (Math.random() - 0.5) * hautVisible * 1.15
        nuage[i * 3 + 2] = -3 + Math.random() * 4.5
        delai[i] = Math.random() * 0.3
        graine[i] = Math.random()
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('aNuage', new THREE.BufferAttribute(nuage, 3))
      geo.setAttribute('aDelai', new THREE.BufferAttribute(delai, 1))
      geo.setAttribute('aGraine', new THREE.BufferAttribute(graine, 1))
      const mat = new THREE.ShaderMaterial({ vertexShader: SOMMET, fragmentShader: FRAGMENT, uniforms: uniformes, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
      points = new THREE.Points(geo, mat)
      groupe.add(points)
    }).catch(() => etat.current.onForme())

    const vise = { x: 0, y: 0 }
    const incline = (e: DeviceOrientationEvent) => { vise.x = Math.max(-1, Math.min(1, (e.gamma ?? 0) / 30)); vise.y = Math.max(-1, Math.min(1, ((e.beta ?? 45) - 45) / 30)) }
    window.addEventListener('deviceorientation', incline)

    let t0 = 0
    let forme = false, tDissous = 0, id = 0
    const boucle = (t: number) => {
      if (points && !t0) t0 = t
      const s = t0 ? (t - t0) / 1000 / RYTHME : 0
      uniformes.uTemps.value = s
      uniformes.uProgres.value = Math.max(0, Math.min(1, (s - NUAGE) / RASSEMBLE))
      if (!forme && s > NUAGE + RASSEMBLE * 0.95) { forme = true; etat.current.onForme() }
      if (etat.current.dissoudre) {
        if (!tDissous) tDissous = t
        uniformes.uDissous.value = Math.min(1, (t - tDissous) / (550 * RYTHME))
      }
      // le nuage pivote un peu avec le téléphone ; une fois le logo formé, il se remet de face
      const k = 1 - uniformes.uProgres.value
      groupe.rotation.y += (vise.x * 0.3 * k - groupe.rotation.y) * 0.05
      groupe.rotation.x += (vise.y * 0.2 * k - groupe.rotation.x) * 0.05
      rendu.render(scene, camera)
      if (uniformes.uDissous.value < 1) id = requestAnimationFrame(boucle)
    }
    id = requestAnimationFrame(boucle)

    return () => {
      vivant = false
      cancelAnimationFrame(id)
      window.removeEventListener('deviceorientation', incline)
      if (points) { points.geometry.dispose(); (points.material as THREE.Material).dispose() }
      rendu.dispose()
      rendu.domElement.remove()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={boite} className={className} aria-hidden />
}
