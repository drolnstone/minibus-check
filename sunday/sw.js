/* Offline shell for the SUNDAY BUS page (the passenger app).

   This is a SEPARATE worker from the driver app's sw.js, and it lives in the
   /sunday/ folder on purpose.

   A service worker can only take charge of pages at or below its own folder.
   Put this file at the site root and it would fight the driver app for the
   same name; put it here and it takes charge of exactly one page, which is
   the whole of what a passenger ever sees.

   The two workers must never cache the same file. The driver app's shell used
   to include ./sunday/index.html, which meant a phone with both apps could
   hold two copies of the passenger page at two different versions and serve
   whichever worker answered first. That entry has been removed from the
   driver's sw.js in the same release that added this file. If you are
   deploying this on its own, deploy that change with it.

   BUMP CACHE below after editing index.html in this folder, or phones keep
   the old copy. */
const CACHE_PREFIX = "minibus-sunday-";
const CACHE = CACHE_PREFIX + "v1.38.0";

/* What a passenger needs to see a page at all.

   ../logo.png sits at the site root, outside this worker's folder. It is
   still cached and still served: a worker's folder decides which PAGES it
   takes charge of, not which files those pages are allowed to ask for. Once
   this worker is in charge of the passenger page, it sees every request that
   page makes, wherever the file lives.

   The icons are deliberately not here. A phone fetches those once, when the
   page is added to the home screen, and the operating system keeps them from
   then on. Caching them again would cost space and buy nothing. */
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "../logo.png"
];

/* Precache a file WITHOUT letting the browser answer from its own cache.

   Pages serves these files with a ten minute freshness, and cache.add goes
   through the browser's ordinary HTTP cache like any other fetch. Without
   this, a worker installing within ten minutes of a deploy would build a
   brand new cache out of the OLD files and then serve them for as long as
   that version lasted — so bumping the number above would appear to do
   nothing, which is worse than not bumping it, because it looks like the
   deploy failed rather than the cache.

   Wrapped, because constructing a Request with a cache mode is not universal.
   A phone that cannot do it should still get a cached page, ten minutes stale
   at worst, rather than no page at all. */
function shellRequest(u) {
  try { return new Request(u, { cache: "reload" }); }
  catch (err) { return u; }
}

self.addEventListener("install", (e) => {
  /* One at a time. A single missing file used to fail addAll outright, which
     left the page uncached rather than nearly cached. */
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

/* Whatever we cached, when the network cannot better it. Still fully offline:
   the cached copy answers the moment the network fails. */
function freshFirst(request, fallback) {
  const settle = (res) => caches.match(request).then((hit) => {
    if (hit) return hit;
    if (!fallback) return res || Response.error();
    return caches.match(fallback).then((f) => f || res || Response.error());
  });

  return fetch(request)
    .then((res) => {
      /* Only keep an answer worth keeping. Storing whatever came back meant a
         404 during an upload, or a Pages error page served for a second while
         a deploy settled, was written into the cache and handed out from then
         on. One transient miss became a permanent one, and reloading could
         not fix it because the reload was answered from the cache. */
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      }
      /* A server that answers badly has not answered. Same path as a failure:
         a passenger at a bus stop should get the page he had yesterday, not
         an error page, when the good copy is sitting in the cache. */
      return settle(res);
    })
    .catch(() => settle(null));
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  /* Never cache Apps Script. Bookings, identifying a phone, and where the bus
     has got to must always go to the real network. A cached booking reply
     would tell somebody their seat was booked when it never left the phone,
     and a cached bus position is worse than none: it is a wrong answer
     wearing the clothes of a right one. */
  if (url.hostname.indexOf("script.google") !== -1 ||
      url.hostname.indexOf("googleusercontent") !== -1) {
    return;
  }
  if (e.request.method !== "GET") return;

  /* The page itself: network first, so a passenger who opens the link on
     Sunday morning is never reading last week's timetable out of a cache. */
  if (e.request.mode === "navigate" || url.pathname.endsWith("/index.html")) {
    e.respondWith(freshFirst(e.request, "./index.html"));
    return;
  }

  /* Everything else the page asks for: the logo, the manifest. Cache first,
     it rarely changes, and it keeps the page instant. */
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
