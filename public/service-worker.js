const CACHE = 'maneflow-v2-22-consolidated';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/assets/icon.svg', '/assets/card-placeholder.svg', '/privacy.html', '/terms.html', '/value.html'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() => new Response(JSON.stringify({ error: 'offline', message: 'The ManeFlow local API is unavailable. Start or restart ManeFlow services; local files remain safe.' }), { status: 503, headers: { 'content-type': 'application/json' } })));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
    return response;
  }).catch(() => caches.match('/index.html'))));
});
