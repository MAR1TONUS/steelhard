// --- Service Worker: автообновления без ручных версий ---
// Стратегии:
// - HTML: network-first (всегда пытаемся взять свежий index.html, офлайн -> кэш)
// - CSS/JS: stale-while-revalidate (сразу из кэша, параллельно докачиваем свежее)
// - Остальная статика (картинки/шрифты/медиа): stale-while-revalidate
// ВАЖНО: никогда не подменяем .css/.js на index.html (иначе стили «ломаются»)

const CACHE_PREFIX = 'auto';
const STATIC_CACHE = `${CACHE_PREFIX}-static`;

self.addEventListener('install', (event) => {
  // Без предкэша — всё кладём в кэш «по мере обращения»
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Чистим кэши от других реализаций (если были с другими префиксами)
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => !k.startsWith(CACHE_PREFIX))
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// helpers
const isSameOrigin = (url) => url.origin === self.location.origin;
const isHTML = (req) =>
  req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

const isCSS = (url) => /\.css(\?|$)/i.test(url.pathname);
const isJS  = (url) => /\.m?js(\?|$)/i.test(url.pathname);
const isStatic = (url) =>
  isCSS(url) || isJS(url) ||
  /\.(png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|otf|mp3|mp4|wav|ogg)(\?|$)/i.test(url.pathname);

async function put(cacheName, req, res) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(req, res.clone());
  } catch (_) {}
}

// HTML: network-first (+ revalidate по ETag/Last-Modified); офлайн -> кэш
async function handleHTML(event, req) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const fresh = await fetch(req, { cache: 'no-cache' });
    await cache.put(req, fresh.clone());
    return fresh;
  } catch (_) {
    const cached = await cache.match(req);
    return cached || new Response('<!doctype html><title>offline</title>', { status: 503 });
  }
}

// stale-while-revalidate для CSS/JS/другой статики
async function handleSWR(event, req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);

  // Параллельно тянем свежак и обновляем кэш
  event.waitUntil((async () => {
    try {
      const fresh = await fetch(req, { cache: 'no-cache' });
      if (fresh && (fresh.ok || fresh.status === 304)) {
        await cache.put(req, fresh.clone());
      }
    } catch (_) {}
  })());

  if (cached) return cached;

  try {
    const fresh = await fetch(req, { cache: 'no-cache' });
    await cache.put(req, fresh.clone());
    return fresh;
  } catch (_) {
    return new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Работаем только со своим origin (чужие домены — как есть)
  if (!isSameOrigin(url)) return;

  // 1) HTML: network-first
  if (isHTML(req)) {
    event.respondWith(handleHTML(event, req));
    return;
  }

  // 2) JS: network-first (видим правки сразу), CSS: SWR (можно оставить)
if (isJS(url)) {
  event.respondWith(handleHTML(event, req)); // та же логика, что и для HTML
  return;
}
if (isCSS(url)) {
  event.respondWith(handleSWR(event, req));  // CSS пусть будет SWR
  return;
}


  // 3) Остальная статика: stale-while-revalidate
  if (isStatic(url)) {
    event.respondWith(handleSWR(event, req));
    return;
  }

  // Остальное — через сеть
});
