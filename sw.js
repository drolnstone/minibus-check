/* Offline shell for the minibus check.
   BUMP THIS after editing index.html or config.js, or phones keep the old copy. */
const CACHE = "minibus-check-v1.19.27";

/* config.js is precached deliberately. Without it, a phone that had never
   fetched it successfully would fall through to the index.html fallback and
   receive a page of HTML where the settings file should be. That fails as a
   syntax error, window.CONFIG never gets set, and the app boots with no
   vehicles, no drivers and no endpoint: practice mode, silently. */
const SHELL = [
  "./",
  "./index.html",
  "./config.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./logo.png",
  "./icon-driver-180.png",
  "./icon-sunday-180.png",
  "./icon-sunday-512.png",
  "./sunday/",
  "./sunday/index.html"
];

self.addEventListener("install", (e) => {
  /* One missing file used to fail addAll outright, which left the whole app
     uncached rather than nearly cached. Add them one at a time so a stray
     404 costs one file instead of everything. */
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x))))
      .then(() => self.clients.claim())
  );
});

/* Whatever we cached, when the network cannot better it. Used for the files
   that must not go stale. Still fully offline: the cached copy answers
   instantly the moment the network fails.

   fallback is the page to hand back when there is nothing cached for this
   exact request. It must be the right app: see the bus branch below. */
function freshFirst(request, fallback) {
  /* Nothing cached for this request, and nothing cached for its fallback
     either. Hand back whatever the network gave us, even when that is an
     error: a real 404 from the server tells somebody more than a blank
     failure does, and there is nothing better to offer. */
  const settle = (res) => caches.match(request).then((hit) => {
    if (hit) return hit;
    if (!fallback) return res || Response.error();
    return caches.match(fallback).then((f) => f || res || Response.error());
  });

  return fetch(request)
    .then((res) => {
      /* Only keep an answer worth keeping. This used to store whatever came
         back, so a 404 during an upload, or a Pages error page served for a
         second while a deploy settled, was written into the cache and handed
         out from then on. One transient miss became a permanent one, and no
         amount of reloading fixed it because the reload was answered from the
         cache. */
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      }

      /* The server answered, and answered badly: the same 404 mid-upload, the
         same Pages error page while a deploy settles. Refusing to CACHE that
         was only half the job. It was still handed to the driver, so a phone
         opened at the wrong ten seconds showed an error page while a perfectly
         good copy of the app sat in the cache underneath it, and the app the
         cache exists to protect was the one thing he could not reach.

         A server that answers badly is a server that has not answered. Treated
         from here exactly like a failed fetch. */
      return settle(res);
    })
    .catch(() => settle(null));
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Never cache submissions to Apps Script. Checks, rota requests, PIN
  // checks and bookings must always go to the real network, or somebody
  // could believe a booking was sent when it never left the phone.
  if (url.hostname.indexOf("script.google") !== -1 ||
      url.hostname.indexOf("googleusercontent") !== -1) {
    return;
  }
  if (e.request.method !== "GET") return;

  // The passenger booking page sits inside this scope but is a different
  // app. Its fallback must never be the driver app: somebody tapping the
  // booking link with no signal should not be handed a vehicle inspection
  // screen, which is both baffling and none of their business.
  if (url.pathname.indexOf("/sunday/") !== -1) {
    e.respondWith(freshFirst(e.request, "./sunday/index.html"));
    return;
  }

  // config.js: always try the network first so endpoint and rota changes
  // land quickly.
  if (url.pathname.endsWith("/config.js")) {
    e.respondWith(freshFirst(e.request, null));
    return;
  }

  // The page itself: network first as well. A driver opening the app on
  // Sunday morning should not be reading last month's rota screen because
  // an old copy was sitting in the cache.
  if (e.request.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    e.respondWith(freshFirst(e.request, "./index.html"));
    return;
  }

  // Everything else (icons, logo, manifest) is cache first: it rarely
  // changes and this keeps the app instant.
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request)
        .then((res) => {
          if (res && res.ok) {                 /* see freshFirst above */
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => Response.error());
    })
  );
});
