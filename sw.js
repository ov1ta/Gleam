/* =========================================================
   GLEAM COLOR: service worker
   Caches only the application shell (HTML/CSS/JS/manifest/icons)
   so the app keeps working offline once it has been loaded or
   installed. Uploaded images never pass through here: they're
   read locally via URL.createObjectURL(), not fetched over the
   network, so there is nothing of the user's to cache.
   ========================================================= */

// Bump this whenever a shell file changes so old caches get replaced.
const CACHE_VERSION = 'v3';
const SHELL_CACHE = `gleam-color-shell-${CACHE_VERSION}`;
const FONT_CACHE = 'gleam-color-fonts-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// Without these the app can't run, so install fails if any is missing.
const CORE = ['./', './index.html', './style.css', './script.js', './manifest.json'];
// Nice to have. A missing icon must never stop the app from installing.
const OPTIONAL = [
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-192.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon-32.png', './icons/favicon-16.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      await cache.addAll(CORE);
      await Promise.allSettled(OPTIONAL.map((url) => cache.add(url)));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('gleam-color-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Web fonts: serve the cached copy instantly, refresh it in the background,
  // so the app keeps its typography offline.
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const refresh = fetch(request).then((res) => { cache.put(request, res.clone()); return res; }).catch(() => cached);
        return cached || refresh;
      })
    );
    return;
  }

  // Everything else cross-origin is left alone. This also means blob:/data:
  // URLs (how uploaded images are read) are never intercepted.
  if (url.origin !== self.location.origin) return;

  // Same-origin app files: network first, so a redeploy shows up right away
  // for anyone who is online, with the cache as the offline fallback.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) =>
          cached || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error())
        )
      )
  );
});
