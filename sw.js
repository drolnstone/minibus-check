/* Offline shell for the minibus check.
   BUMP THIS after editing index.html or config.js, or phones keep the old copy. */
const CACHE_PREFIX = "minibus-check-";
const CACHE = CACHE_PREFIX + "v1.45.0";

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
  "./icon-sunday-512.png"
  /* The passenger page used to be cached here as well. It is not any more.
     It has its own worker at ./sunday/sw.js, and two workers holding two
     copies of one file is how a phone ends up serving last week's page from
     a cache nobody thought to look in. The icons above stay: they are the
     home screen tiles for BOTH apps and they are served from this folder. */
];

/* Precache a file WITHOUT letting the browser answer from its own cache.

   A new CACHE name above is supposed to mean phones take the new copy. It
   did not quite. Pages serves these files with a ten minute freshness, and
   cache.add goes through the browser's ordinary HTTP cache like any other
   fetch, so a new worker installing within ten minutes of a deploy would
   dutifully build a brand new cache out of the old files — and then serve
   them for as long as that version lasted. Bumping the number appeared to do
   nothing, which is worse than not bumping it, because it looks like the
   deploy that failed rather than the cache that lied.

   cache:"reload" bypasses the HTTP cache for the fetch and refreshes it on
   the way past. Wrapped, because constructing a Request with a cache mode is
   not universal and a phone that cannot do it should still get a cached app,
   ten minutes stale at worst, rather than no app at all. */
function shellRequest(u) {
  try { return new Request(u, { cache: "reload" }); }
  catch (err) { return u; }
}

self.addEventListener("install", (e) => {
  /* One missing file used to fail addAll outright, which left the whole app
     uncached rather than nearly cached. Add them one at a time so a stray
     404 costs one file instead of everything. */
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(shellRequest(u)).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

/* Only ever this app's OWN old caches.

   caches.keys() answers for the whole site, not for this worker. Filtering on
   "anything that is not my current name" therefore deleted the OTHER app's
   cache every time this worker activated — and the other app's worker
   returned the favour on its next activation. Two apps on one phone, each
   quietly wiping the other, and neither of them working offline afterwards.
   Nothing visible would have gone wrong until somebody lost signal.

   Match the prefix. Delete only our own. */
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((k) => Promise.all(k
        .filter((x) => x !== CACHE && x.indexOf(CACHE_PREFIX) === 0)
        .map((x) => caches.delete(x))))
      .then(() => self.clients.claim())
  );
});

/* How long the network gets before the cache answers instead.

   Network first is right and it stays: a driver opening the app on Sunday
   morning must not be reading last month's rota out of a cache. But this
   worker had no timeout of any kind. callFetch's twenty five second race
   lives in index.html; this file calls bare fetch, so a phone on a network
   that goes nowhere — which is the car park, not the middle of nowhere —
   held the socket until the browser gave up. A minute or more on iOS, with
   a perfect copy of the app sitting in the cache the whole time. And it
   happened twice in series: once for the page, then again for config.js,
   which blocks the entire app script behind it.

   No signal at all was never the problem. fetch rejects in milliseconds and
   the cache answers instantly, which is what everything below was written
   for. It is the network that opens a socket and then says nothing that
   this exists for.

   Three seconds keeps network first in every normal case and gives it up
   only where the network was not going to answer anyway. */
const SHELL_WAIT = 3000;

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

  const net = fetch(request)
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

  /* The cached copy answers if the network has not spoken by SHELL_WAIT.

     It deliberately never resolves when there is nothing cached. With no copy
     to fall back on, waiting for the network is the only thing left to do,
     and the race below simply runs as long as it has to — which is the old
     behaviour, kept exactly, for the one case where it was the right answer.

     The fetch above is NOT abandoned and NOT cancelled. It runs on and still
     writes the fresh copy into the cache, so a phone handed the cached app at
     eight on Sunday morning is running the new one by its next launch. That
     is the whole trade: the driver waits three seconds instead of a minute,
     and pays for it by being one launch behind on a morning when the network
     was failing anyway. */
  const waited = new Promise((resolve) => {
    setTimeout(() => {
      caches.match(request)
        .then((hit) => hit || (fallback ? caches.match(fallback) : null))
        .then((hit) => { if (hit) resolve(hit); })
        .catch(() => {});
    }, SHELL_WAIT);
  });

  return Promise.race([net, waited]);
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

  // The passenger booking page is a different app with its own worker, and
  // this one keeps its hands off it entirely. Answering here would put a
  // second copy of the passenger page in a second cache, at whatever version
  // this worker happened to be built at, and the phone would then serve
  // whichever of the two answered first.
  //
  // Returning without responding is not a gap. A phone that has opened the
  // passenger page is controlled by that page's own worker, which never sees
  // this handler at all. A phone that has not is a driver's phone reaching
  // for a page it does not use, and the plain network is the right answer.
  if (url.pathname.indexOf("/sunday/") !== -1) return;

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
