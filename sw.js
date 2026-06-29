// Sacred Hymnody PWA Service Worker v1.0
const CACHE_NAME = 'sacred-hymnody-v1';
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Merriweather:ital,wght@0,300;0,400;1,300&family=Inter:wght@300;400;500&display=swap'
];

// Install — cache shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - Shell assets: cache-first
// - Audio MP3s: network-first with cache fallback, cache up to 50MB of audio
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Audio files — network first, cache on success
  if (url.pathname.endsWith('.mp3') || url.pathname.endsWith('.wav') || url.hostname.includes('s3.amazonaws') || url.hostname.includes('baptistarchive') || url.hostname.includes('smallchurchmusic') || url.hostname.includes('archive.org')) {
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

  // Shell — cache first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(response => {
      if (response.ok) {
        caches.open(CACHE_NAME).then(c => c.put(e.request, response.clone()));
      }
      return response;
    }).catch(() => caches.match('./index.html')))
  );
});
