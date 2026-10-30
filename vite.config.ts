import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// In development the sync server runs separately (npm run server); the app reaches it through /api.
const api = { '/api': 'http://localhost:8787' }

const pwa = VitePWA({
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
})

/**
 * `vite build --mode file` makes offline/Ledgerly.html: the whole app (scripts, styles, fonts, icon) in one
 * file that opens with a double-click, no server needed. There is no service worker there, so it's stubbed.
 */
function singleFile(): Plugin {
  const logo = `data:image/svg+xml;base64,${readFileSync('public/logo.svg').toString('base64')}`
  return {
    name: 'ledgerly-single-file',
    enforce: 'post',
    resolveId: (id) => (id === 'virtual:pwa-register' ? '\0pwa-stub' : undefined),
    load: (id) => (id === '\0pwa-stub' ? 'export function registerSW() { return () => {} }' : undefined),
    transformIndexHtml: (html) =>
      html
        .replace(/\s*<link rel="(icon|apple-touch-icon)"[^>]*>/g, '')
        .replace('</title>', `</title>\n    <link rel="icon" href="${logo}" type="image/svg+xml" />`),
    generateBundle(_, bundle) {
      const page = bundle['index.html']
      if (!page || page.type !== 'asset') return
      let html = String(page.source)
      for (const [name, file] of Object.entries(bundle)) {
        const ref = new RegExp(`<script[^>]*src="[^"]*${name.replace(/[.]/g, '\\.')}"[^>]*></script>`)
        const css = new RegExp(`<link[^>]*href="[^"]*${name.replace(/[.]/g, '\\.')}"[^>]*>`)
        if (file.type === 'chunk' && ref.test(html)) {
          html = html.replace(ref, () => `<script type="module">${file.code.replace(/<\/script/gi, '<\\/script')}</script>`)
          delete bundle[name]
        } else if (file.type === 'asset' && name.endsWith('.css') && css.test(html)) {
          html = html.replace(css, () => `<style>${String(file.source)}</style>`)
          delete bundle[name]
        }
      }
      html = html.replace(/\s*<link rel="modulepreload"[^>]*>/g, '')
      delete bundle['index.html']
      this.emitFile({ type: 'asset', fileName: 'Ledgerly.html', source: html })
    },
  }
}

export default defineConfig(({ mode }) =>
  mode === 'file'
    ? {
        base: './',
        publicDir: false,
        plugins: [react(), tailwindcss(), singleFile()],
        build: {
          outDir: 'offline',
          assetsInlineLimit: 50_000_000,
          cssCodeSplit: false,
          modulePreload: false,
          rollupOptions: { output: { codeSplitting: false } },
        },
      }
    : {
        server: { proxy: api },
        preview: { proxy: api },
        plugins: [react(), tailwindcss(), pwa],
      },
)
