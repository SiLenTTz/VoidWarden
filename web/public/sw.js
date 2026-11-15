// PWA-Service-Worker (EPIC-P10 T10.4): Cache-first für die App-Shell,
// Netzwerk-für-alles-andere; bei Reconnect zieht der WS den Zustand nach (W6).
const CACHE = "nyx-shell-v20261113150815"; // build-stamp (BUG-0013): Deployments erreichen Clients beim naechsten Start
const SHELL = ["/", "/manifest.webmanifest", "/nyx-icon-192.png", "/nyx-icon-512.png", "/nyx/nyx-atlas.json", "/nyx/nyx-atlas.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/ws")) return;
  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ??
        fetch(event.request).then((res) => {
          if (res.ok && url.origin === location.origin) {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        }),
    ),
  );
});
