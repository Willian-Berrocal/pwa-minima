const CACHE_NAME = "pwa-cache-v7";
const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./styles.css",
  "./app.js",
  "./icon.png"
];

self.addEventListener('install', evt => {
  evt.waitUntil(
      caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', evt => {
  evt.waitUntil(
      caches.keys().then(keys => Promise.all(
          keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', evt => {
  evt.respondWith(
      caches.match(evt.request).then(resp => resp || fetch(evt.request))
  );
});
