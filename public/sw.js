/* SmartCBT — PWA service worker (v2).
 * Strategy:
 *  - App shell (/, /student/dashboard, /login, /setup): network-first with cache
 *    fallback so an installed app opens offline into a useful page.
 *  - Static GET assets: stale-while-revalidate (fast on repeat visits).
 *  - NEVER intercept /api/* (exam answers/timers must hit the live server)
 *    and never cache non-GET requests.
 *
 *  Works on ALL pages because:
 *  - The fetch listener handles every same-origin GET navigation (req.mode === "navigate").
 *  - Each visited page is cached at runtime on first load, then served from cache offline.
 *  - If a page has never been visited and the network is down, the root "/" is the fallback.
 */
const CACHE = "smartcbt-shell-v2";
const SHELL = [
  "/",
  "/student/dashboard",
  "/login",
  "/setup",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => undefined).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle same-origin GET; everything else passes straight through.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first, fall back to cached shell, then to "/".
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match("/").then((root) => root || Response.error()))
        )
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
          }
          return res;
        })
        .catch(() => hit || Response.error());
      return hit || network;
    })
  );
});
