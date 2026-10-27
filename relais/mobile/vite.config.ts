import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'

/** Injecte dans sw.js la liste des fichiers de la coque (index.html, scripts, styles, polices latines, icônes). */
function coqueHorsLigne(): Plugin {
  let sortie = 'dist'
  return {
    name: 'coque-hors-ligne',
    apply: 'build',
    configResolved(c) { sortie = path.resolve(c.root, c.build.outDir) },
    closeBundle() {
      const liste: string[] = ['/']
      const parcourir = (dossier: string) => {
        for (const f of fs.readdirSync(dossier, { withFileTypes: true })) {
          const chemin = path.join(dossier, f.name)
          if (f.isDirectory()) { parcourir(chemin); continue }
          const rel = '/' + path.relative(sortie, chemin).split(path.sep).join('/')
          if (rel === '/sw.js' || rel === '/index.html' || rel.endsWith('.map')) continue
          // polices : seulement le latin (les autres alphabets se gardent à l'usage)
          if (rel.endsWith('.woff') || (rel.endsWith('.woff2') && !/latin(?!-ext)/.test(rel))) continue
          liste.push(rel)
        }
      }
      parcourir(sortie)
      const version = crypto.createHash('sha1').update(liste.join('|') + liste.map((u) => (u === '/' ? '' : fs.statSync(path.join(sortie, u)).size)).join(',')).digest('hex').slice(0, 10)
      const sw = path.join(sortie, 'sw.js')
      const texte = fs.readFileSync(sw, 'utf8').replace('/*__COQUE__*/[]', JSON.stringify(liste)).replace("/*__VERSION__*/'dev'", JSON.stringify(version))
      fs.writeFileSync(sw, texte)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), coqueHorsLigne()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: { outDir: 'dist', emptyOutDir: true },
})
