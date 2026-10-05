import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // CRITICAL for Electron to resolve static assets relatively via file://
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/api/spicylyrics': {
        target: 'https://api.spicylyrics.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/spicylyrics/, '')
      },
      '/api/spotify-embed': {
        target: 'https://open.spotify.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/spotify-embed/, '')
      },
      '/api/spotify-partner': {
        target: 'https://api-partner.spotify.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/spotify-partner/, '')
      },
      '/api/spotify-api': {
        target: 'https://api.spotify.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/spotify-api/, '')
      }
    }
  }
})
