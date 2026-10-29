import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// In development the sync server runs separately (npm run server); the app reaches it through /api.
const api = { '/api': 'http://localhost:8787' }

export default defineConfig({
  server: { proxy: api },
  preview: { proxy: api },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.svg'],
      manifest: {
        name: 'Ledgerly Accounting',
        short_name: 'Ledgerly',
        description: 'Offline-first double-entry accounting for any business, on any device.',
        theme_color: '#4f46e5',
        background_color: '#f8f9fc',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['business', 'finance', 'productivity'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        // Sync calls must always reach the server, never an offline copy.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
})
