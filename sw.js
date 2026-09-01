// Minimal service worker: caches the app shell (HTML/CSS/JS/icons) for fast loading
// and installability. Live data (billing, reports) always goes over the network to
// the Apps Script backend — nothing about sales data is cached here.
//
// IMPORTANT: index.html is served NETWORK-FIRST so that edits you push to GitHub
// show up immediately on next app open, instead of being stuck on an old cached
// copy until the user deletes and re-adds the app.

const CACHE_NAME = 'grocery-billing-shell-v10'; // bump this string whenever you change SHELL_FILES
const SHELL_FILES = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

self.addEventListener('install', (event) => {
  // cache.addAll() is all-or-nothing: if even one file 404s, the whole
  // precache silently fails and you get zero caching benefit with no error
  // visible to the user. Caching files individually means one bad path
  // (e.g. a renamed icon) doesn't take down caching for everything else.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        SHELL_FILES.map((file) =>
          cache.add(file).catch((err) => console.warn('SW precache failed for', file, err))
        )
      )
    )
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

  // Everything else (css/js/icons/CDN libs like jsPDF): CACHE-FIRST for speed,
  // network fallback — and whatever we fetch from network gets stored for next
  // time, so libraries loaded from a CDN (not listed in SHELL_FILES) still end
  // up cached after their first successful load instead of being re-downloaded
  // on every single app open.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
