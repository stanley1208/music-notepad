import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Music Notepad',
        short_name: 'Music Notepad',
        description: 'Type music. See it as sheet music. Hear it played.',
        // relative to the manifest, so the GitHub Pages base path is respected
        start_url: './',
        scope: './',
        display: 'standalone',
        theme_color: '#ffffff',
        background_color: '#f5f5f4',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg}'],
        // piano soundfont notes: cache after first online playback so audio
        // works offline afterwards
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/paulrosen\.github\.io\/midi-js-soundfonts\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'soundfonts',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
