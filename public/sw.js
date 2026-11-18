/* SmartCBT — PWA service worker (v3).
 * Strategy:
 *  - App shell (/, /student/dashboard, /login, /setup): network-first with cache
 *    fallback so an installed app opens offline into a useful page.
 *  - Static GET assets: stale-while-revalidate (fast on repeat visits).
 *  - NEVER intercept /api/*, /game-socket.io/*, or Vite dev-mode HMR paths
 *    (/src/*, /@vite/*, /@react-refresh, /node_modules/*).
 */
const CACHE = "smartcbt-shell-v3";
const SHELL = [
  "/",
  "/student/dashboard",
  "/login",
  "/setup",
  "/manifest.webmanifest",
  "/pwa-192x192.png",
  "/pwa-512x512.png",
  "/apple-touch-icon.png",
  "/icon.svg",
  "/icon-maskable.svg",
];

function isDevModulePath(url) {
  const p = url.pathname;
  return (
    p.startsWith("/@vite") ||
    p.startsWith("/@react-refresh") ||
    p.startsWith("/@fs/") ||
    p.startsWith("/@id/") ||
    p.startsWith("/src/") ||
    p.startsWith("/node_modules/") ||
    p.startsWith("/.figma/") ||
    url.searchParams.has("t") ||
    url.searchParams.has("v")
  );
}

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
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/game-socket.io/")) return;
  if (isDevModulePath(url)) return;

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
