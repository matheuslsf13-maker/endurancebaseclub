import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Ruling 26: 'prompt', never 'autoUpdate' — a timekeeper mid-race must never be reloaded by an
      // incoming deploy. No workbox.skipWaiting/clientsClaim either: a new service worker waits until
      // every tab closes, then takes over on the next launch. main.tsx drives the prompt manually.
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.png', 'logo.png', 'icon-192.png'],
      manifest: {
        name: 'EnduranceBaseClub',
        short_name: 'EBC',
        lang: 'pt-BR',
        theme_color: '#191513',
        background_color: '#191513',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/logo.png', sizes: '150x150', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
