/* Offline shell for the COORDINATOR'S APP.

   A SEPARATE worker from the driver app's sw.js and the passenger page's
   sunday/sw.js, living in the /coord/ folder so it takes charge of this one
   page and nothing else. The driver app's worker keeps its hands off /coord/
   entirely, and this one never answers for anything outside the coordinator's
   own requests, so the three never hold a copy of each other's page.

   Until v1.96.4 this app had no worker at all, on the reasoning that a page
   which changes the record should only ever be the network's copy. That was
   right about the record and wrong about the page. The record never comes
   out of a cache: every call to the live server goes to another origin and is
   handed straight to the network below. Only the page itself is kept, and
   only so that it OPENS without a signal: says there is no connection, and
   carries on by itself when there is one, instead of the phone showing
   nothing at all. Signing in still needs the live server, every time.

   BUMP CACHE below after editing index.html in this folder, or phones keep
   the old copy. */
const CACHE_PREFIX = "minibus-coord-";
const CACHE = CACHE_PREFIX + "v1.103.2";

/* What the coordinator needs to see the page at all.

   ../config.js and ../logo.png sit at the site root, outside this folder. They
   are still cached and served from here: a worker's folder decides which PAGES
   it takes charge of, not which files those pages may ask for. config.js
   matters most. Without it the page has no live server to talk to and says
   so, which is the wrong thing to tell somebody who simply has no signal.

   The PDF scripts are not here. They are fetched only when a report is made,
   which needs the live server anyway, and are kept by the cache-first branch
   below the first time they are. */
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "../config.js",
  "../logo.png"
];

/* Precache a file WITHOUT letting the browser answer from its own cache.
   Pages serves these with a ten minute freshness, so without "reload" a
   worker installing just after a deploy would cache the OLD files under the
   NEW name. Wrapped, because not every phone can build a Request with a
   cache mode, and a ten minute stale page beats no page. */
function shellRequest(u) {
  try { return new Request(u, { cache: "reload" }); }
  catch (err) { return u; }
}

self.addEventListener("install", (e) => {
  /* One at a time, so a stray 404 costs one file instead of everything. */
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(shellRequest(u)).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

/* Only ever this app's OWN old caches. caches.keys() answers for the whole
   site, so anything wider would wipe the driver app's or the passenger
   page's cache. Match the prefix. Delete only our own. */
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((k) => Promise.all(k
        .filter((x) => x !== CACHE && x.indexOf(CACHE_PREFIX) === 0)
        .map((x) => caches.delete(x))))
      .then(() => self.clients.claim())
  );
});

/* How long the network gets before the cached page answers instead. Network
   first in every normal case, so a coordinator with a signal always runs the
   newest page; the cache only answers where the network was not going to.
   See the same constant in the driver app's sw.js for the long story. */
const SHELL_WAIT = 3000;

function freshFirst(request, fallback) {
  const settle = (res) => caches.match(request).then((hit) => {
    if (hit) return hit;
    if (!fallback) return res || Response.error();
    return caches.match(fallback).then((f) => f || res || Response.error());
  });

  const net = fetch(request)
    .then((res) => {
      /* Only keep an answer worth keeping, and treat a bad answer (a 404
         mid-upload, a Pages error page while a deploy settles) as no answer:
         the good copy in the cache is better than an error page. */
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      }
      return settle(res);
    })
    .catch(() => settle(null));

  /* Never resolves when nothing is cached: then waiting for the network is
     all there is. The fetch above runs on regardless and refreshes the cache. */
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

  /* The live server, and anything else not on this site, goes straight to
     the network, untouched. This is what keeps the record out of the cache:
     a cached answer from the live server would be a wrong answer wearing
     the clothes of a right one. */
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== "GET") return;

  /* The page, and config.js: network first, the cached copy only when the
     network cannot do better. The page falls back to this folder's own
     index.html and never to the driver app's. */
  if (e.request.mode === "navigate" || url.pathname.endsWith("/coord/index.html")) {
    e.respondWith(freshFirst(e.request, "./index.html"));
    return;
  }
  if (url.pathname.endsWith("/config.js")) {
    e.respondWith(freshFirst(e.request, null));
    return;
  }

  /* Everything else the page asks for (the logo, the manifest, the PDF
     scripts) is cache first. The PDF scripts carry the version in their
     address, so a new release fetches its own. */
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => Response.error());
    })
  );
});

/* No push here. The coordinator's alerts belong to the driver app's worker
   at the site root (see pushReg in index.html), and stay there. */
