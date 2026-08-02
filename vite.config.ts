import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Source static files (favicon etc). Built site goes to public/ for Forge.
  publicDir: 'static',
  build: {
    outDir: 'public',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/deezer': {
        target: 'https://api.deezer.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/deezer/, ''),
      },
    },
  },
})
