/* Service worker simples: guarda a "casca" do app para abrir sem sinal.
   Os dados vem do Supabase e nunca sao cacheados aqui -- quem cuida do
   offline dos dados e o cache/fila em localStorage. */
// a versao vem da URL de registro (sw.js?v=...), entao cada publicacao usa um
// cache novo e os arquivos da versao anterior sao apagados
const VERSAO = new URL(self.location.href).searchParams.get('v') || 'dev'
const CACHE = 'endurance-' + VERSAO

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // Supabase: sempre rede

  // navegacao: tenta a rede, cai para o cache quando esta sem sinal
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
          return res
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('index.html'))),
    )
    return
  }

  // assets com hash no nome: cache primeiro
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        }),
    ),
  )
})
