import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { proxy: { '/api': 'http://127.0.0.1:8765', '/fichiers': 'http://127.0.0.1:8765' } },
  // la scène 3D de l'accueil (Three.js, ~530 ko) est un morceau à part, chargé après l'affichage : pas d'alerte de taille pour lui
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 600 },
})
