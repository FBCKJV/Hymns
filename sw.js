// IFB Hymns & Spiritual Songs — Service Worker v3.0
const CACHE_NAME = 'ifb-hymns-v3';

const SHELL_ASSETS = [
  '/Hymns/',
  '/Hymns/index.html',
  '/Hymns/manifest.json',
  '/Hymns/icons/icon-192.png',
  '/Hymns/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())   // ← take over immediately, don't wait
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())  // ← claim all open tabs right now
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Cross-origin (R2, S3, fonts, YouTube) — let browser handle it
  if (url.origin !== self.location.origin) return;

  // Own-origin audio — network first, cache on success
  if (url.pathname.endsWith('.mp3') || url.pathname.endsWith('.wav')) {
    e.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        try {
          const response = await fetch(e.request);
          if (response.ok) cache.put(e.request, response.clone());
          return response;
        } catch {
          return cached || new Response('Audio unavailable offline', { status: 503 });
        }
      })
    );
    return;
  }

  // App shell — network first so updates land immediately, cache as fallback
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(c => c.put(e.request, response.clone()));
        }
        return response;
      })
      .catch(() => caches.match(e.request)
        .then(cached => cached || caches.match('/Hymns/index.html'))
      )
  );
});
