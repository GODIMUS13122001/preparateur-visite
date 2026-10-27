// Coque de l'appli hors réseau, notifications, et écoute hors connexion des fiches.
// La liste COQUE est injectée au build (vite.config.ts) : index.html et fichiers hashés.
const COQUE = /*__COQUE__*/[]
const VERSION = /*__VERSION__*/'dev'
const CACHE_COQUE = `coque-${VERSION}`
const CACHE = 'prep-v2' // fiches et audios
const CACHE_META = 'prep-meta' // dates d'accès (éviction)
const CACHE_CLE = 'prep-cle' // clé du téléphone, lisible ici pour se réabonner aux notifications
const MAX_FICHIERS = 40
const enCours = new Map()
const majLe = new Map()
const DELAI_MAJ = 10 * 60 * 1000

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const cache = await caches.open(CACHE_COQUE)
  // index.html est obligatoire ; le reste est gardé au mieux
  const accueil = await fetch('/', { cache: 'reload' })
  if (!accueil.ok) throw new Error('coque')
  await cache.put('/index.html', accueil)
  await Promise.all(COQUE.filter((u) => u !== '/index.html' && u !== '/').map((u) => fetch(u, { cache: 'reload' }).then((r) => (r.ok ? cache.put(u, r) : null)).catch(() => {})))
  await self.skipWaiting()
})()))
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((noms) => Promise.all(noms.filter((n) => ![CACHE, CACHE_COQUE, CACHE_META, CACHE_CLE].includes(n)).map((n) => caches.delete(n)))).then(() => self.clients.claim()),
))

// Dates d'accès : on évince la fiche la moins récemment consultée, pas la plus anciennement insérée.
async function lireAcces() {
  try { const r = await (await caches.open(CACHE_META)).match('/acces'); return r ? await r.json() : {} } catch { return {} }
}
async function noterAcces(url) {
  const m = await lireAcces()
  m[url] = Date.now()
  await (await caches.open(CACHE_META)).put('/acces', new Response(JSON.stringify(m), { headers: { 'content-type': 'application/json' } }))
}
async function evincer(cache) {
  const cles = await cache.keys()
  if (cles.length <= MAX_FICHIERS) return
  const m = await lireAcces()
  const tri = cles.slice().sort((x, y) => (m[x.url] || 0) - (m[y.url] || 0))
  for (const k of tri.slice(0, cles.length - MAX_FICHIERS)) { await cache.delete(k); delete m[k.url] }
  await (await caches.open(CACHE_META)).put('/acces', new Response(JSON.stringify(m), { headers: { 'content-type': 'application/json' } }))
}

// Fiches (.html) et audio (.m4a) : le fichier entier est gardé une fois, sans dépendre des requêtes partielles.
function visee(req) {
  if (req.method !== 'GET') return null
  const u = new URL(req.url)
  if (u.origin !== location.origin || u.pathname !== '/api/fichier') return null
  const chemin = u.searchParams.get('chemin') || ''
  if (!/^fiches\/[\w.\-]+\.(m4a|html)$/.test(chemin)) return null
  return { chemin, audio: chemin.endsWith('.m4a'), cle: new Request(`${u.origin}/api/fichier?chemin=${encodeURIComponent(chemin)}`) }
}

async function recuperer(req, cle) {
  if (enCours.has(cle.url)) return enCours.get(cle.url)
  const p = (async () => {
    const r = await fetch(new Request(req.url, { cache: 'reload', headers: req.headers.has('x-cle') ? { 'x-cle': req.headers.get('x-cle') } : undefined }))
    if (!r.ok) return r
    const cache = await caches.open(CACHE)
    await cache.put(cle, r.clone())
    await noterAcces(cle.url)
    await evincer(cache)
    return r
  })().finally(() => enCours.delete(cle.url))
  enCours.set(cle.url, p)
  return p
}

// iOS exige des réponses partielles (206) pour lire un son : on découpe le fichier gardé.
async function partielle(rep, entete) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(entete)
  const blob = await rep.blob()
  if (!m || (m[1] === '' && m[2] === '')) return new Response(blob, { status: 200, headers: { 'content-type': blob.type || 'audio/mp4', 'content-length': String(blob.size), 'accept-ranges': 'bytes' } })
  const total = blob.size
  let debut = m[1] === '' ? Math.max(0, total - Number(m[2])) : Number(m[1])
  let fin = m[1] === '' || m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1)
  if (debut >= total) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } })
  return new Response(blob.slice(debut, fin + 1), {
    status: 206,
    headers: { 'content-type': blob.type || 'audio/mp4', 'content-length': String(fin - debut + 1), 'content-range': `bytes ${debut}-${fin}/${total}`, 'accept-ranges': 'bytes' },
  })
}

// Coque : navigation et fichiers de l'appli servis depuis le cache d'abord.
// index.html n'est jamais remplacé en douce dans le cache d'une version : il irait chercher des fichiers que ce cache n'a pas.
// C'est l'installation de la version suivante (sw.js change à chaque publication) qui renouvelle toute la coque d'un coup.
// Exception : un lien de notification (?rdv=) prend d'abord la page fraîche (3 s au plus), pour être lu par la dernière version.
async function coque(e) {
  const req = e.request
  const cache = await caches.open(CACHE_COQUE)
  const navigation = req.mode === 'navigate'
  const cle = navigation ? '/index.html' : req
  if (navigation) {
    e.waitUntil(self.registration.update().catch(() => {}))
    if (new URL(req.url).searchParams.has('rdv')) {
      try {
        const r = await Promise.race([fetch('/', { cache: 'no-store' }), new Promise((_, ko) => setTimeout(() => ko(new Error('lent')), 3000))])
        if (r.ok) return r
      } catch { /* réseau absent ou lent : la coque gardée */ }
    }
  }
  const trouve = await cache.match(cle)
  if (trouve) return trouve
  try {
    const r = await fetch(navigation ? '/' : req)
    if (r.ok && !navigation) cache.put(cle, r.clone())
    return r
  } catch {
    const repli = await cache.match('/index.html')
    if (navigation && repli) return repli
    return Response.error()
  }
}

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url)
  const v = visee(e.request)
  if (!v) {
    if (e.request.method === 'GET' && u.origin === location.origin && !u.pathname.startsWith('/api/') && u.pathname !== '/sw.js') e.respondWith(coque(e))
    return
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE)
    let rep = await cache.match(v.cle)
    const entete = e.request.headers.get('range')
    const revalider = e.request.headers.has('x-revalider')
    if (revalider) {
      // fiche régénérée : on remplace la copie gardée
      try { const r = await recuperer(e.request, v.cle); majLe.set(v.cle.url, Date.now()); return r.ok ? new Response('ok') : r } catch { return Response.error() }
    }
    if (rep) {
      noterAcces(v.cle.url).catch(() => {})
      // on met la copie à jour en douce, sauf pendant une lecture par morceaux
      if (!entete && Date.now() - (majLe.get(v.cle.url) || 0) > DELAI_MAJ) {
        majLe.set(v.cle.url, Date.now())
        e.waitUntil(recuperer(e.request, v.cle).catch(() => {}))
      }
    } else {
      try { rep = await recuperer(e.request, v.cle); majLe.set(v.cle.url, Date.now()) } catch { return Response.error() }
      if (!rep.ok) return rep
      rep = (await cache.match(v.cle)) || rep
    }
    return v.audio && entete ? partielle(rep.clone(), entete) : v.audio ? partielle(rep.clone(), '') : rep
  })())
})

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data.json() } catch { d = { titre: 'Préparateur de visite', corps: e.data && e.data.text() } }
  e.waitUntil(self.registration.showNotification(d.titre || 'Préparateur de visite', {
    body: d.corps || '', icon: '/icones/icone-192.png', badge: '/icones/icone-192.png', data: { lien: d.lien || '/' },
  }))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const lien = (e.notification.data && e.notification.data.lien) || '/'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((liste) => {
    for (const c of liste) { if ('focus' in c) { c.postMessage({ lien }); return c.focus() } }
    return self.clients.openWindow(lien)
  }))
})

// Si le navigateur renouvelle l'abonnement aux notifications, on se réabonne et on prévient le relais.
function cleAppli(b64) {
  const brut = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4))
  return Uint8Array.from(brut, (c) => c.charCodeAt(0))
}
self.addEventListener('pushsubscriptionchange', (e) => e.waitUntil((async () => {
  const r = await (await caches.open(CACHE_CLE)).match('/cle')
  const cle = r ? await r.text() : ''
  if (!cle) return
  const entetes = { 'x-cle': cle }
  const { cle_publique } = await (await fetch('/api/push', { headers: entetes })).json()
  const sub = e.newSubscription || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleAppli(cle_publique) })
  await fetch('/api/push?action=abonner', { method: 'POST', headers: { ...entetes, 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) })
})().catch(() => {})))
