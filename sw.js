// Sacred Hymnody PWA Service Worker v1.1
// Works at any subpath — paths are relative to SW location
const CACHE_NAME = 'sacred-hymnody-v1';
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Merriweather:ital,wght@0,300;0,400;1,300&family=Inter:wght@300;400;500&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isAudio =
    url.pathname.endsWith('.mp3') ||
    url.pathname.endsWith('.wav') ||
    url.hostname.includes('s3.amazonaws') ||
    url.hostname.includes('baptistarchive') ||
    url.hostname.includes('smallchurchmusic') ||
    url.hostname.includes('archive.org') ||
    url.hostname.includes('thepsalmssung');

  if (isAudio) {
    // Network-first for audio; cache on success for offline replay
    e.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        try {
          const response = await fetch(e.request);
          if (response.ok && response.status === 200) {
            cache.put(e.request, response.clone());
          }
          return response;
        } catch {
          return cached || new Response('Audio unavailable offline', { status: 503 });
        }
      })
    );
    return;
  }

  // Shell assets — cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(c => c.put(e.request, response.clone()));
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
