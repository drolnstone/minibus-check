/* MADE-UP STOPS AND REGISTRATIONS IN EVERY PHOTOGRAPH, for the showcase videos.

     node --import ./video/mask.mjs video/shots.mjs            (build.sh does this)

   The people in the videos are invented already and the passenger and driver
   pictures run on fake-stops.json, but the two buses' registrations are
   real (config.js, the test stand-ins and the coordinator checks all name
   them), and the coordinator checks need the real stop names they look for.
   So every page screenshot is taken with each registration, real stop name
   and postcode swapped for its made-up one, and the page put back straight
   after, so nothing the scripts click or read ever sees the swap. Any word
   of a real stop name still showing is printed as REAL WORDS LEFT. Loaded
   before the scripts, it wraps playwright-core's launch, so it reaches the
   browser tests/browser/lib.mjs starts too. */
const pw = await import(process.env.PLAYWRIGHT_CORE || "playwright-core");
import { readFileSync } from "node:fs";

/* The two registrations, and every real stop name and postcode against its
   made-up one in fake-stops.json (the coordinator checks run on the real
   timetable, whose names they look for, so their pictures are swapped here),
   longest first so a whole name goes before any part of it. */
const real = JSON.parse(readFileSync(new URL("../tests/browser/real.json", import.meta.url), "utf8")).stops;
const fake = JSON.parse(readFileSync(new URL("./fake-stops.json", import.meta.url), "utf8")).stops;
const pairs = { "NH56 FWP": "AB12 CDE", "YS70 PWE": "CD34 EFG", "NH56FWP": "AB12CDE", "YS70PWE": "CD34EFG",
                /* the garage the coordinator checks type in */
                "Walton": "Maple" };
const SEP = /( by | bus stop, | bus stop|, | \(|\) )/;
for (const r of real) {
  const f = fake.find((x) => x.id === r.id);
  if (!f) continue;
  pairs[r.stop] = f.stop;
  pairs[r.postcode] = f.postcode;
  const a = r.stop.split(SEP), b = f.stop.split(SEP);
  if (a.length === b.length) a.forEach((w, i) => { if (!SEP.test(w) && w !== b[i] && w.length > 3) pairs[w] = b[i]; });
}
export const SWAP = Object.fromEntries(Object.entries(pairs).sort((x, y) => y[0].length - x[0].length));
/* Words of the real names that no made-up name uses: none may be left in a
   picture. */
const fakeWords = new Set(fake.flatMap((s) => s.stop.split(/[^A-Za-z]+/)));
const LEAK = [...new Set(real.flatMap((s) => s.stop.split(/[^A-Za-z]+/)).filter((w) => w.length > 3 && !fakeWords.has(w)))]
  .concat([...new Set(real.map((s) => s.postcode))]);

function hide([swap, leak]) {
  const undo = [];
  const each = (s) => { for (const k in swap) if (s.indexOf(k) !== -1) s = s.split(k).join(swap[k]); return s; };
  const walk = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const v = each(n.data);
      if (v !== n.data) { undo.push([n, "data", n.data]); n.data = v; }
    }
    for (const el of root.querySelectorAll("input, textarea")) {
      const v = each(el.value || "");
      if (v !== (el.value || "")) { undo.push([el, "value", el.value]); el.value = v; }
    }
  };
  walk(document.body || document.documentElement);
  window.__unswap = () => { for (let i = undo.length - 1; i >= 0; i--) undo[i][0][undo[i][1]] = undo[i][2]; window.__unswap = null; };
  const shown = (document.body && document.body.innerText) || "";
  return { n: undo.length, left: leak.filter((w) => new RegExp("\\b" + w + "\\b").test(shown)) };
}

let done = false;
function patch(page) {
  if (done) return;
  done = true;
  const P = Object.getPrototypeOf(page);
  const shot = P.screenshot;
  P.screenshot = async function (o) {
    const r = await this.evaluate(hide, [SWAP, LEAK]).catch(() => ({ n: 0, left: [] }));
    if (r.left.length) console.log("  REAL WORDS LEFT in " + ((o && o.path) || "a picture") + ": " + r.left.join(", "));
    try { return await shot.call(this, o); }
    finally { if (r.n) await this.evaluate(() => window.__unswap && window.__unswap()).catch(() => {}); }
  };
}

/* A British phone: a date box reads 19/11/2026, not 11/19/2026. Chromium
   takes that from its language settings, not from a page's locale. */
const GB = { LANG: "en_GB.UTF-8", LANGUAGE: "en_GB:en", LC_ALL: "en_GB.UTF-8" };
const launch = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = async (o, ...a) => {
  o = Object.assign({}, o || {});
  o.env = Object.assign({}, process.env, o.env || {}, GB);
  const b = await launch(o, ...a);
  const bp = b.newPage.bind(b), bc = b.newContext.bind(b);
  b.newPage = async (...x) => { const p = await bp(...x); patch(p); return p; };
  b.newContext = async (...x) => {
    const c = await bc(...x);
    const cp = c.newPage.bind(c);
    c.newPage = async (...y) => { const p = await cp(...y); patch(p); return p; };
    return c;
  };
  return b;
};
