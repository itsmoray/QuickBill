// Minimal service worker: caches the app shell (HTML/CSS/JS/icons) for fast loading
// and installability. Live data (billing, reports) always goes over the network to
// the Apps Script backend — nothing about sales data is cached here.
//
// IMPORTANT: index.html is served NETWORK-FIRST so that edits you push to GitHub
// show up immediately on next app open, instead of being stuck on an old cached
// copy until the user deletes and re-adds the app.

const CACHE_NAME = 'grocery-billing-shell-v7'; // bump this string whenever you change SHELL_FILES
const SHELL_FILES = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache calls to the Apps Script backend — always go live.
  if (url.hostname.indexOf('script.google.com') >= 0 || url.hostname.indexOf('googleusercontent.com') >= 0) {
    return;
  }

  // The HTML shell (the page itself): NETWORK-FIRST.
  // Always try to fetch the latest index.html from GitHub Pages first.
  // Only fall back to the cached copy if the network request fails (offline).
  const isDocumentRequest = event.request.mode === 'navigate' || event.request.destination === 'document';
  if (isDocumentRequest) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else (css/js/icons): CACHE-FIRST for speed, network fallback.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
