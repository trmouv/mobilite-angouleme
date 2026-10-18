const CACHE = 'mobilite-multireseaux-v19-pages';
const BASE = new URL('./', self.location.href);
const SHELL = [
  './',
  './styles.css',
  './app.js',
  './pages-config.js',
  './manifest.webmanifest',
  './train-logos/ter.svg',
  './train-logos/tgv-inoui.svg',
  './train-logos/intercites.svg',
  './train-logos/ouigo.svg'
].map(path => new URL(path, BASE).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.includes('/api/')) return;
  event.respondWith(fetch(event.request)
    .then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    })
    .catch(() => caches.match(event.request).then(r => r || caches.match(SHELL[0]))));
});
