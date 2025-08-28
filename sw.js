/* Service Worker: предзагрузка и кэширование статики */
const CACHE_VER = 'v1.0.1';            // ↑ подними версию
const STATIC_CACHE = `static-${CACHE_VER}`;

const PRECACHE = [
  'index.html',
  'splash.css',
  'splash.js',
  'player-core.bundle.v3.3.js',
  'views/portrait.css',
  'views/landscape.css',
  'fonts/BebasNeuePro_Regular.woff2',
  'fonts/BebasNeuePro_Bold.woff2',
  'fonts/BebasNeuePro_Light.woff2',
  'img/cover.jpg',
  // 'favicon.ico',
  // 'apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res.clone());
      } catch (_) { /* пропускаем отсутствующие */ }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => (k.startsWith('static-') && k !== STATIC_CACHE) ? caches.delete(k) : null)
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) Игнорируем всё, что не http/https (chrome-extension:, moz-extension:, data:, chrome:, about:, blob:, ws:, wss:)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 2) Разрешаем кэшировать только same-origin (ресурсы твоего сайта)
  const sameOrigin = url.origin === self.location.origin;

  const acceptsHTML = (req.headers.get('accept') || '').includes('text/html');
  const isFont  = req.destination === 'font' || /\.woff2?$/.test(url.pathname);
  const isStatic = (
    req.destination === 'style' ||
    req.destination === 'script' ||
    req.destination === 'image' ||
    isFont
  );

  // Статика: Cache-First (только same-origin)
  if (isStatic && sameOrigin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        // Если ответ ок и same-origin — кладём в кэш
        if (res && res.ok) {
          const cache = await caches.open(STATIC_CACHE);
          await cache.put(req, res.clone());
        }
        return res;
      } catch (_) {
        return cached || caches.match('index.html');
      }
    })());
    return;
  }

  // HTML: Network-First (same-origin), с fallback в кэш
  if (sameOrigin && (req.mode === 'navigate' || acceptsHTML)) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(STATIC_CACHE);
          await cache.put(req, res.clone());
        }
        return res;
      } catch (_) {
        const fallback = await caches.match(req);
        return fallback || caches.match('index.html');
      }
    })());
    return;
  }

  // Всё прочее (включая чужие домены) — не кэшируем, просто проксируем
  // (это устранит любые ошибки от расширений)
  // Можно добавить простую стратегию: вернуть из кэша если есть
  event.respondWith(caches.match(req).then(r => r || fetch(req)));
});
