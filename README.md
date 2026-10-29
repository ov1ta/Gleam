[index.html](https://github.com/user-attachments/files/34155218/index.html)
<img width="512" height="512" alt="icon-maskable-512" src="https://github.com/user-attachments/assets/570fb566-3ae9-492d-a6aa-ab8b0c6e59dd" />
<img width="192" height="192" alt="icon-maskable-192" src="https://github.com/user-attachments/assets/5b7b4e0e-0661-4669-b996-eb2fbe8611c8" />
<img width="512" height="512" alt="icon-512" src="https://github.com/user-attachments/assets/2173b9d9-e223-42fc-bf69-0296f3749770" />
<img width="192" height="192" alt="icon-192" src="https://github.com/user-attachments/assets/f7c54b9b-5d59-4123-9a0f-2fe61377c090" />
<img width="32" height="32" alt="favicon-32" src="https://github.com/user-attachments/assets/79a7e348-64aa-4a63-931c-c0b20b3884ba" />
<img width="16" height="16" alt="favicon-16" src="https://github.com/user-attachments/assets/a85bf7a8-3b1b-4bb6-abb4-bbcb1a8401a7" />
<img width=[script.js](https://github.com/user-attachments/files/34155227/script.js)"180" height="180" alt="apple-touch-icon" src="https://github.com/user-attachments/assets/ac68623f-a8aa-4739-be5c-be7184824d75" />
[manifest.json](https://github.com/user-attachments/files/34155221/manifest.json)[manifest.json](https://github.com/user-attachments/files/34155224/manifest.json)[style.css](https://github.com/user-attachments/files/34155230/style.css)[sw.js](https://github.com/user-attachments/files/34155238/sw.js)/* =========================================================
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
