import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the app from /<repo>/ — every asset 404s without this.
export default defineConfig({
  base: '/gaditor/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
      },
      manifest: {
        name: 'gaditor',
        short_name: 'gaditor',
        description: 'Recipes as flow tables',
        start_url: '.',
        display: 'standalone',
        background_color: '#12100e',
        theme_color: '#12100e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
