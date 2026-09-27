## Task 27: PWA (offline app shell for timekeepers)

**Files:**
- Modify: `vite.config.ts`, `src/main.tsx`, `src/vite-env.d.ts`

**Interfaces:**
- Consumes: `vite-plugin-pwa`.

- [ ] **Step 1:** Add `VitePWA({ registerType: 'autoUpdate', injectRegister: null, includeAssets: ['favicon.png', 'logo.png', 'icon-192.png'], manifest: { name: 'EnduranceBaseClub', short_name: 'EBC', lang: 'pt-BR', theme_color: '#191513', background_color: '#191513', display: 'standalone', start_url: '/', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/logo.png', sizes: '150x150', type: 'image/png' }] }, workbox: { globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'], navigateFallback: '/index.html', cleanupOutdatedCaches: true, clientsClaim: true, skipWaiting: true } })` to `vite.config.ts` plugins; in `main.tsx` call `registerSW({ immediate: true })` from `virtual:pwa-register` only when `import.meta.env.PROD`; add `/// <reference types="vite-plugin-pwa/client" />` to `src/vite-env.d.ts`.
- [ ] **Step 2: Verify** `npm run build` → `dist/sw.js` and `dist/manifest.webmanifest` exist; `npx vitest run` still green; `npm run typecheck` clean.
- [ ] **Step 3: Commit** (`feat(pwa): offline app shell for the timekeeper link`).

---

