// FBC Hymns & Spiritual Songs — Service Worker v15
const CACHE_NAME = 'ifb-hymns-v15';
const SHELL = ['/Hymns/','/Hymns/index.html','/Hymns/manifest.json','/Hymns/icons/icon-192.png','/Hymns/icons/icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok)caches.open(CACHE_NAME).then(c=>c.put(e.request,r.clone()));return r;}).catch(()=>caches.match(e.request).then(c=>c||caches.match('/Hymns/index.html'))));
});
