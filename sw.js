/* Offline shell for the minibus check.
   BUMP THIS after editing index.html or config.js, or phones keep the old copy. */
const CACHE = "minibus-check-v18";

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./logo.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x))))
      .then(() => self.clients.claim())
  );
});

/* Try the network, fall back to whatever we cached. Used for the files that
   must not go stale. Still fully offline: the cached copy answers instantly
   the moment the network fails. */
function freshFirst(request) {
  return fetch(request)
    .then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
      return res;
    })
    .catch(() => caches.match(request).then((hit) => hit || caches.match("./index.html")));
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Never cache submissions to Apps Script. Checks and rota requests must
  // always go to the real network, or a driver could believe a holiday
  // request was sent when it never left the phone.
  if (url.hostname.indexOf("script.google") !== -1 ||
      url.hostname.indexOf("googleusercontent") !== -1) {
    return;
  }
  if (e.request.method !== "GET") return;

  // config.js: always try the network first so endpoint and rota changes
  // land quickly.
  if (url.pathname.endsWith("/config.js")) {
    e.respondWith(freshFirst(e.request));
    return;
  }

  // The page itself: network first as well. A driver opening the app on
  // Sunday morning should not be reading last month's rota screen because
  // an old copy was sitting in the cache.
  if (e.request.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    e.respondWith(freshFirst(e.request));
    return;
  }

  // Everything else (icons, logo, manifest) is cache first: it rarely
  // changes and this keeps the app instant.
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
