/* THE REAL APP ON A STAGED MORNING.

   Serves the deployed release byte for byte, stands in for the Worker and the
   spreadsheet with answers built from the live export, and hands back a phone
   to drive. Every stop, time, bus and registration is the real one; the
   people are not. */
/* playwright-core and a Chromium: PLAYWRIGHT_CORE may name the module file,
   CHROMIUM the browser binary. */
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || "playwright-core");
import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const ROOT = process.env.MINIBUS_ROOT || fileURLToPath(new URL("../..", import.meta.url));
/* The spreadsheet export the stand-in servers answer from: the real stops and
   buses, and the drivers and rota with invented names in place of the real
   ones, because this repository is public. No PINs, emails or phone numbers
   either. MINIBUS_REAL names another, as manual/ does with a fresh download of
   the spreadsheet that is never committed. */
export const REAL = JSON.parse(readFileSync(process.env.MINIBUS_REAL || new URL("./real.json", import.meta.url), "utf8"));
export const KEY = "2026-09-27";
export const SAMPLE = "Bro Sample";
/* Everybody the stand-in names comes out of REAL, never from here, so a
   picture shows whoever the export has: the invented cast in the tests, the
   real drivers when manual/ builds from a download. onRoute is the people
   on a route in the Drivers tab's order. */
export const onRoute = (r) => REAL.drivers.filter((d) => d.route === r && d.active !== false)
  .sort((a, b) => (Number(a.ord) || 99) - (Number(b.ord) || 99)).map((d) => d.name);
const COORDINATOR = (REAL.drivers.find((d) => d.role === "Coordinator") || { name: SAMPLE }).name;
/* Who took each bus's last mileage reading: the third driver on its route. */
const lastBy = (reg) => reg === "NH56 FWP" ? onRoute("North")[2] : onRoute("South")[2];
export const OUT = process.env.SHOTS || join(tmpdir(), "minibus-shots");
const marks = existsSync(OUT + "/marks.json") ? JSON.parse(readFileSync(OUT + "/marks.json", "utf8")) : {};

const T = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
            ".webmanifest": "application/manifest+json", ".png": "image/png", ".css": "text/css" };

/* config.js is the only file that changes, and only by adding the sample
   driver to the register. Nothing about PINs, routes or buses is touched. */
let sampleRole = "Driver";
const srv = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let rel = u.pathname.slice(1);
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const f = join(ROOT, rel);
  if (!existsSync(f)) { res.statusCode = 404; return res.end("no"); }
  res.setHeader("content-type", T[extname(f)] || "text/plain");
  res.setHeader("cache-control", "no-store");
  let out = readFileSync(f);
  if (rel === "config.js") {
    out = Buffer.from(String(out).replace(
      '{ name: "Bro Cedric",     role: "Backup" }',
      '{ name: "Bro Cedric",     role: "Backup" },\n    { name: "Bro Sample",     role: "' + sampleRole + '" }'));
  }
  res.end(out);
});
const PORT = Number(process.env.MINIBUS_PORT || 8113);
await new Promise(r => srv.listen(PORT, r));
export const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
export async function done() { await browser.close(); srv.close(); }

/* The Rota tab as the server sends it: one row per Sunday, both routes. */
export function realRows(edit) {
  const rows = REAL.rota.map(r => ({
    date: r.sunday, primary: r.north, actual: r.northCover || "", northBus: r.northBus,
    primary2: r.south, actual2: r.southCover || "", southBus: r.southBus, status: r.status,
    swaps: [], requests: [], locked: false, lockNote: ""
  }));
  const k = rows.find(r => r.date === KEY);
  if (k) k.primary = SAMPLE;          /* the one invented thing */
  return edit ? edit(rows) : rows;
}

export function register() {
  return REAL.drivers.map(d => ({ name: d.name, role: d.role, hasPin: true }))
    .concat([{ name: SAMPLE, role: sampleRole, hasPin: true }]);
}

/* The shape the Worker and Apps Script send: arrival and depart as flags. */
const stops = REAL.stops.filter(s => s.active).map(s => ({
  route: s.route, id: s.id, time: s.time, stop: s.stop, postcode: s.postcode,
  arrival: s.kind === "arrival", depart: s.kind === "depart", lat: s.lat, lng: s.lng }));

/* A phone. Everything a scenario might vary is in opts. */
export async function phone(opts = {}) {
  sampleRole = opts.role || "Driver";
  /* The phone's clock and the server's agree, as they do on a real Sunday.
     A server "now" from this machine's own Saturday evening made the app
     correct every time it recorded by thirteen hours, and then throw its own
     run away as yesterday's. */
  const at = Date.parse(opts.clock || "2026-09-27T09:55:00+01:00");
  const clk = { shift: at - Date.now() };
  const sNow = () => Date.now() + clk.shift;
  const world = Object.assign({
    closed: true, cutoff: "09:30", rehearsal: false,
    counts: { North: { N01: 2, N02: 3, N04: 1, N06: 2, N07: 1 },
              South: { S01: 2, S03: 1, S05: 2, S07: 1 } },
    etas: { North: {}, South: {} },
    checks: {},
    trips: { North: null, South: null },
    others: {},
    rows: realRows(),
    pin: () => ({ ok: true, valid: true }),
    departWords: { North: "10:05", South: "10:16" },
    lastMiles: { "NH56 FWP": 48213, "YS70 PWE": 31544 },
    openDefects: [],
    requestOk: true
  }, opts.world || {});

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    /* Unset leaves this machine's own zone and language, as before. */
    timezoneId: opts.timezoneId, locale: opts.locale,
    permissions: opts.permissions || [],
    userAgent: opts.ua || undefined,
    hasTouch: true, isMobile: true
  });
  const pg = await ctx.newPage();
  const asked = [], errs = [], posted = [];
  pg.on("pageerror", e => errs.push(String(e.message)));

  async function answer(route) {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.searchParams;
    let body = { ok: true };
    let post = {};
    try { post = JSON.parse(req.postData() || "{}"); } catch (e) {}
    asked.push((u.search || "(post " + (post.action || (post.check ? "check" : "?")) + ")"));
    if (req.method() === "POST") posted.push(post);
    if (world.down) return route.abort();
    const row = world.rows.find(r => r.date === KEY) || {};
    /* The round running now: world.rehearsal is false, true (a live server
       from before w2.20.0, round 1) or { round, ends, shape }. */
    const roundNow = () => !world.rehearsal ? 0
      : (typeof world.rehearsal === "object" ? (Number(world.rehearsal.round) || 1) : 1);
    /* The versions the stand-in claims, and each bus's renewal dates as the
       Buses tab gives them from w2.24.0. */
    const stamp = Object.assign({ sheet: "v1.79.0", server: "w2.15.0" }, world.stamps || {});
    const datesOf = b => (world.dates || {})[b.reg] || b.dates || {};
    const seatsOf = reg => (REAL.buses.find(b => b.reg === reg) || {}).seats || 0;
    const booked = rt => Object.values(world.counts[rt] || {}).reduce((a, b) => a + b, 0);
    const seats = {
      North: { route: "North", reg: row.northBus || "NH56 FWP", from: "rota", seats: seatsOf(row.northBus || "NH56 FWP"), booked: booked("North") },
      South: { route: "South", reg: row.southBus || "YS70 PWE", from: "rota", seats: seatsOf(row.southBus || "YS70 PWE"), booked: booked("South") }
    };
    for (const rt of ["North", "South"]) seats[rt].left = seats[rt].seats - seats[rt].booked;
    if (world.seats) Object.assign(seats, world.seats);
    if (post.action === "pin") body = world.pin(post);
    /* A driver's own PIN, from v1.96.0. */
    else if (post.action === "pinchange") body = world.pinchange ? world.pinchange(post) : { ok: true, valid: true, changed: true };
    else if (post.action === "pinkeep") body = { ok: true, valid: true, kept: true };
    else if (post.action === "trip") {
      /* Echoed back the way the Worker does, so the board and the phone agree
         about the run and the board can carry the timetable offset. A tap
         names its rehearsal round from v1.79.0, and w2.20.0 keeps the
         rehearsal's runs apart from the real ones and throws away a tap from
         a round that is over. A tap that names none is judged by whether a
         rehearsal is on, as before. */
      const tr = post.trip || {}, rt = tr.route || "North";
      const claimed = tr.rehearsal;
      const inRound = (claimed === undefined || claimed === null) ? !!roundNow()
                    : !Number(claimed) ? false
                    : Number(claimed) === roundNow() ? true : null;
      const store = inRound ? (world.rehTrips = world.rehTrips || { North: null, South: null }) : world.trips;
      if (inRound === null) { world.dropped = (world.dropped || 0) + (tr.events || []).length; }
      else if (!world.noEcho) {
        const cur = store[rt] && store[rt].trip === tr.trip ? store[rt]
          : { trip: tr.trip, route: rt, reg: tr.reg, driver: tr.driver, started: 0, ended: 0, served: {}, lastStop: "", lastAt: 0, offset: null };
        for (const ev of tr.events || []) {
          if (ev.event === "start") cur.started = ev.at;
          else if (ev.event === "end") cur.ended = ev.at;
          else if (ev.event === "reopen" || ev.event === "unend") cur.ended = 0;
          else if (ev.event === "undo") {
            /* An undone end reopens the run, as the Worker does by marking the
               end row Undone. staleEndMs keeps the old answer on the board for
               a while, the way the Worker's short cache does. */
            if (ev.undoes === "end") {
              if (world.staleEndMs) { const t = cur; setTimeout(() => { t.ended = 0; }, world.staleEndMs); }
              else cur.ended = 0;
            } else delete cur.served[ev.stopId];
          }
          else if (ev.stopId) { cur.served[ev.stopId] = { at: ev.at, event: ev.event };
            cur.lastStop = (stops.find(s => s.id === ev.stopId) || {}).stop || ""; cur.lastAt = ev.at; }
        }
        if (world.offset && world.offset[rt] !== undefined) cur.offset = world.offset[rt];
        store[rt] = cur;
      }
      body = world.tripFails ? { ok: false }
           : inRound === null ? { ok: true, written: 0, rehearsalOver: true } : { ok: true };
      /* Taken at once, answered slowly, as on a weak signal. */
      if (world.tripDelayMs) await new Promise((r) => setTimeout(r, world.tripDelayMs));
    }
    else if (post.action === "authorise") body = world.authorise ? world.authorise(post)
      : { ok: true, authorised: true, by: (post.authorise || {}).who || COORDINATOR, checkId: "", at: sNow() };
    else if (post.action === "endrun") body = world.endrun ? world.endrun(post) : { ok: true };
    /* The numbers behind the pickup pop-up's Call passenger, from v1.101.0. */
    else if (post.action === "stoppeople") body = world.people ? world.people(post) : { ok: false, error: "not your run" };
    else if (post.action === "rotaRequest" || post.request) {
      if (world.requestOk) {
        const q = post.request || {};
        let row = world.rows.find(r => r.date === q.date);
        if (!row) { row = { date: q.date, primary: "", actual: "", primary2: "", actual2: "", swaps: [], requests: [] }; world.rows.push(row); }
        row.requests = (row.requests || []).concat([{ driver: q.driver, type: q.type, status: "Pending" }]);
        body = { ok: true };
      } else body = { ok: false, error: world.requestError || "rejected" };
    }
    else if (post.check || post.action === "check") body = world.checkFails ? { ok: false } : { ok: true, id: "chk-" + posted.length };
    else if (post.action === "subscribe" || post.action === "testpush") body = { ok: true };
    else if (p.get("vapid")) body = { ok: true, key: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" };
    else if (p.get("last")) {
      body = {
        ok: true, cache: "fresh", ageMin: 1, sheet: stamp.sheet, server: stamp.server,
        buses: REAL.buses.map(b => ({ reg: b.reg, seats: b.seats, active: b.active, dates: datesOf(b),
          miles: world.lastMiles[b.reg], date: "20/09/2026", time: "09:41",
          driver: lastBy(b.reg) })),
        last: Object.fromEntries(REAL.buses.map(b => [b.reg, { miles: world.lastMiles[b.reg],
          date: "20/09/2026", time: "09:41", driver: lastBy(b.reg) }])),
        seats
      };
    }
    /* The passenger's stop answer, which the driver app also asks for a stop
       it is following (v1.99.0). world.watch(stopId) gives the answer. */
    else if (p.get("trip") && world.watch) {
      body = world.watch(p.get("s") || "");
    }
    else if (p.get("board")) {
      const r = String(p.get("route") || "North");
      /* The rehearsal's run while one is on, the real one otherwise. */
      const t = roundNow() ? (world.rehTrips || {})[r] : world.trips[r];
      body = {
        ok: true, date: KEY, sheet: stamp.sheet, server: stamp.server,
        counts: world.counts[r] || {}, etas: world.etas[r] || {},
        checks: world.checks, others: world.others, seats,
        buses: REAL.buses.map(b => ({ reg: b.reg, seats: b.seats, active: true, dates: datesOf(b) })),
        trip: Object.assign({ ok: true, now: sNow(), closed: world.closed, cutoff: world.cutoff,
          rehearsal: world.rehearsal, departWords: world.departWords[r] || "",
          trip: "", route: r, reg: "", driver: "", started: 0, ended: 0, served: {},
          lastAt: 0, lastStop: "", offset: null }, t || {})
      };
    }
    /* A phone that has never had the rota: the name list has not come. */
    else if (p.get("rota") && world.noRota) return route.abort();
    else if (p.get("rota")) {
      body = { ok: true, sheet: stamp.sheet, server: stamp.server, rows: world.rows,
               pattern: { north: onRoute("North"), south: onRoute("South") },
               drivers: register(), stops, openDefects: world.openDefects };
    }
    /* Who to ring and whose titles make a coordinator, as a live server from
       w2.21.0 stamps them on every answer. Only when a scenario gives them. */
    if (body && typeof body === "object" && !Array.isArray(body)) {
      if (world.coordinator) body.coordinator = world.coordinator;
      if (world.leadRoles) body.leadRoles = world.leadRoles;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  }
  await pg.route("**://*.workers.dev/**", answer);
  await pg.route("**://script.google.com/**", answer);

  /* The phone's clock, shifted rather than frozen, so time passes. The shift
     is kept in the page's own storage, so a reload carries on from the time
     the scenario has jumped to rather than going back to where it began. */
  await pg.addInitScript(`(() => {
    const Real = Date;
    let kept = 0;
    try { kept = Number(localStorage.getItem("__shift")) || 0; } catch (e) {}
    window.__shift = kept || (${at} - Real.now());
    try { localStorage.setItem("__shift", String(window.__shift)); } catch (e) {}
    function Shifted(...a) { if (a.length === 0) return new Real(Real.now() + window.__shift); return new Real(...a); }
    Shifted.prototype = Real.prototype;
    Shifted.now = () => Real.now() + window.__shift;
    Shifted.parse = Real.parse; Shifted.UTC = Real.UTC;
    window.Date = Shifted;
  })()`);

  /* A GPS the scenario drives. Positions go to every live watch; watches are
     counted so a test can see whether the app is still listening. */
  await pg.addInitScript(`(() => {
    const g = window.__geo = { watches: {}, next: 1, pos: null, log: [], deny: false };
    function mk(p) { return { coords: { latitude: p.lat, longitude: p.lng, accuracy: p.acc || 8,
      speed: (p.speed === undefined ? null : p.speed), heading: null, altitude: null, altitudeAccuracy: null },
      timestamp: Date.now() }; }
    const fake = {
      getCurrentPosition(ok, err) { g.log.push("get");
        setTimeout(() => { if (g.deny) err && err({ code: 1, message: "denied" });
          else if (g.pos) ok(mk(g.pos)); else err && err({ code: 3, message: "timeout" }); }, 60); },
      watchPosition(ok, err) { const id = g.next++; g.watches[id] = { ok, err }; g.log.push("watch" + id); return id; },
      clearWatch(id) { if (g.watches[id]) g.log.push("clear" + id); delete g.watches[id]; }
    };
    Object.defineProperty(navigator, "geolocation", { value: fake, configurable: true });
    window.__emit = (p) => { g.pos = p; for (const w of Object.values(g.watches)) try { w.ok(mk(p)); } catch (e) {} };
    window.__live = () => Object.keys(g.watches).length;
  })()`);

  /* Push, as a phone that can receive it. Headless Chromium answers every
     permission with "denied", which hides the offer entirely; a phone that
     has never been asked says "default". The subscription is faked because
     there is no push service to register with from here. */
  if (opts.pushOn || opts.pushFake) {
    await pg.addInitScript(`(() => {
      try { Object.defineProperty(Notification, "permission", { get: () => window.__perm || "default", configurable: true }); } catch (e) {}
      Notification.requestPermission = async () => { window.__perm = window.__permAnswer || "granted"; return window.__perm; };
      const fake = { endpoint: "https://push.example/x", toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "x", auth: "y" } }; }, unsubscribe: async () => true };
      window.__sub = ${opts.pushOn ? "fake" : "null"};
      if (window.PushManager) {
        PushManager.prototype.getSubscription = async function () { return window.__sub; };
        PushManager.prototype.subscribe = async function () { window.__sub = fake; return fake; };
      }
      ${opts.pushOn ? 'window.__perm = "granted";' : ""}
    })()`);
  }
  if (opts.noPush) {
    await pg.addInitScript(`(() => {
      try { delete window.PushManager; } catch (e) {}
      try { Object.defineProperty(Notification, "permission", { get: () => "default", configurable: true }); } catch (e) {}
    })()`);
  }
  if (opts.init) await pg.addInitScript(opts.init);

  const me = { pg, ctx, world, asked, posted, errs };

  me.load = async (path = "/") => {
    await pg.goto("http://127.0.0.1:" + PORT + path, { waitUntil: "networkidle" });
    await pg.waitForTimeout(700);
    await pg.addStyleTag({ content: 'img { visibility: hidden } img[src*="icon"] { display: none }' });
    await pg.waitForTimeout(200);
  };
  me.jump = async (mins) => {
    clk.shift += mins * 60000;
    await pg.evaluate(m => { window.__shift += m * 60000; try { localStorage.setItem("__shift", String(window.__shift)); } catch (e) {} }, mins);
    await pg.waitForTimeout(500);
  };
  me.now = sNow;
  me.wait = (ms) => pg.waitForTimeout(ms);
  me.where = () => pg.$$eval("section.screen", ss => (ss.find(s => s.classList.contains("is-on")) || {}).id || "?");
  me.sheetsUp = () => pg.$$eval(".rota-modal", ms => ms.filter(m => m.classList.contains("is-on")).map(m => m.id));
  me.close = async (ids = ["alertAskNot", "howDone", "pinModalNot"]) => {
    for (const id of ids) {
      await pg.evaluate(i => { const b = document.getElementById(i); const m = b && b.closest(".rota-modal");
        if (b && m && m.classList.contains("is-on")) b.click(); }, id);
      await pg.waitForTimeout(250);
    }
  };
  me.click = async (text, within = "body", exact = false) => {
    const ok = await pg.evaluate(([t, w, ex]) => {
      const root = document.querySelector(w) || document.body;
      const bs = [...root.querySelectorAll("button, a")].filter(b => b.offsetParent || b.getClientRects().length);
      const hit = bs.find(b => { const s = (b.textContent || "").trim(); return ex ? s === t : s.indexOf(t) === 0; });
      if (hit) { hit.click(); return true; } return false;
    }, [text, within, exact]);
    await pg.waitForTimeout(500);
    return ok;
  };
  me.clickId = async (id) => { const ok = await pg.evaluate(i => { const e = document.getElementById(i); if (e) { e.click(); return true; } return false; }, id);
    await pg.waitForTimeout(500); return ok; };
  me.foot = () => pg.$$eval("#footbar button", b => b.filter(x => x.offsetParent).map(x => (x.textContent || "").trim()));
  me.onward = async () => {
    const w = await pg.evaluate(() => {
      const bs = [...document.querySelectorAll("#footbar button")].filter(b => b.offsetParent);
      const go = bs[bs.length - 1]; if (!go) return null; go.click(); return (go.textContent || "").trim();
    });
    await pg.waitForTimeout(700);
    return w;
  };
  me.setInput = async (id, v) => {
    await pg.evaluate(([i, val]) => {
      const m = document.getElementById(i); if (!m) return;
      const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(m), "value").set;
      set.call(m, val); m.dispatchEvent(new Event("input", { bubbles: true })); m.dispatchEvent(new Event("change", { bubbles: true }));
    }, [id, v]);
    await pg.waitForTimeout(400);
  };
  me.toast = () => pg.$eval("#toast", t => t.classList.contains("is-on") ? t.textContent : "");
  me.text = (sel) => pg.$eval(sel, n => (n.innerText || n.textContent || "").replace(/\s+\n/g, "\n").trim()).catch(() => "");
  me.emit = async (p) => { await pg.evaluate(q => window.__emit(q), p); };
  me.liveWatches = () => pg.evaluate(() => window.__live());
  me.geoLog = () => pg.evaluate(() => window.__geo.log.slice());
  /* No signal: the browser says offline AND the stand-in servers stop
     answering. Routed requests are fulfilled even with the context offline,
     so the first alone let a check "send" from a phone with no signal. */
  me.offline = async (on) => { world.down = !!on; await ctx.setOffline(!!on); await pg.waitForTimeout(300); };

  /* A picture. To the top unless told otherwise. */
  me.shot = async (name, o = {}) => {
    if (o.top !== false) { await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(200); }
    if (o.scrollTo) {
      await pg.evaluate(sel => { const e = document.querySelector(sel); if (e) e.scrollIntoView({ block: "center" }); }, o.scrollTo);
      await pg.waitForTimeout(300);
    }
    if (o.scrollToTop) {
      await pg.evaluate(([sel, off]) => { const e = document.querySelector(sel);
        if (e) window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - off); }, o.scrollToTop);
      await pg.waitForTimeout(300);
    }
    if (o.scrollBy) { await pg.evaluate(y => window.scrollBy(0, y), o.scrollBy); await pg.waitForTimeout(300); }
    if (o.marks) {
      /* Where each numbered callout points, in CSS pixels of this viewport. */
      const rects = await pg.evaluate((ms) => ms.map(m => {
        let els = [...document.querySelectorAll(m.sel || "*")].filter(e => e.getClientRects().length);
        if (m.text) els = els.filter(e => (e.textContent || "").trim().indexOf(m.text) === 0);
        const e = els[m.nth || 0];
        if (!e) return { n: m.n, miss: m.sel + "|" + (m.text || "") };
        const r = e.getBoundingClientRect();
        return { n: m.n, x: r.x, y: r.y, w: r.width, h: r.height, side: m.side || "" };
      }), o.marks);
      const miss = rects.filter(r => r.miss);
      if (miss.length) console.log("   MISSING MARKS " + name + ": " + JSON.stringify(miss));
      marks[name] = rects;
      writeFileSync(`${OUT}/marks.json`, JSON.stringify(marks, null, 1));
    }
    await pg.screenshot({ path: `${OUT}/${name}.png`, fullPage: !!o.full });
    const scr = await me.where();
    console.log("  shot " + name.padEnd(26) + scr);
    return name;
  };

  /* ---- the ordinary moves --------------------------------------------- */
  me.pick = async (name) => {
    await pg.selectOption("#driverPick", { label: name });
    await pg.waitForTimeout(500);
  };
  me.pin = async (digits = "1234") => {
    await pg.fill("#pin", digits);
    await pg.waitForTimeout(900);
  };
  me.signIn = async (name = SAMPLE, digits = "1234", keepSheets = false) => {
    await me.close();
    await me.pick(name);
    if (digits) await me.pin(digits);
    await pg.waitForTimeout(700);
    if ((await me.where()) === "s-driver") await me.onward();
    await pg.waitForTimeout(600);
    if (!keepSheets) await me.close();
  };
  me.pickBus = async (reg) => {
    await pg.evaluate(r => { const b = [...document.querySelectorAll("#vehList button")].find(x => (x.textContent || "").indexOf(r) > -1); if (b) b.click(); }, reg);
    await pg.waitForTimeout(500);
  };
  me.fuel = async (eighths) => {
    await pg.evaluate(n => { const b = document.querySelectorAll("#fuelBar button")[n - 1]; if (b) b.click(); }, eighths);
    await pg.waitForTimeout(300);
  };
  /* Answer every item on the screen: answers maps item name prefix to
     "Fine" | "Advisory" | "Defect" | "Not on this bus", with an optional note. */
  me.answerStage = async (answers = {}, onlyListed = false) => {
    await pg.evaluate(([ans, only]) => {
      const cards = [...document.querySelectorAll("#itemList > *")];
      for (const c of cards) {
        const nm = (c.querySelector(".item-name, h3, b, strong") || c).textContent.trim();
        const key = Object.keys(ans).find(k => nm.indexOf(k) === 0);
        if (only && !key) continue;
        const want = key ? ans[key].a : "Fine";
        const b = [...c.querySelectorAll("button")].find(x => (x.textContent || "").trim().toLowerCase() === want.toLowerCase());
        if (b) b.click();
        if (key && ans[key].note) {
          const t = c.querySelector("textarea, input[type=text]");
          if (t) { t.value = ans[key].note; t.dispatchEvent(new Event("input", { bubbles: true })); }
        }
      }
    }, [answers, onlyListed]);
    await pg.waitForTimeout(400);
  };
  me.walkaround = async (answers = {}) => {
    for (let i = 0; i < 8; i++) {
      if ((await me.where()) !== "s-stage") break;
      await me.answerStage(answers);
      await me.onward();
    }
  };
  me.fullCheck = async (o = {}) => {
    await me.click("Vehicle check", "#s-hub");
    await me.pickBus(o.bus || "NH56 FWP");
    await me.onward();
    await me.close(["busAskStay"]);
    await me.setInput("miles", String(o.miles || 48262));
    await me.fuel(o.fuel || 6);
    await me.onward();
    await me.walkaround(o.answers || {});
    await pg.evaluate((jobs) => {
      for (const j of jobs) { const b = [...document.querySelectorAll("#jobChips button")].find(x => (x.textContent || "").trim() === j); if (b) b.click(); }
    }, o.jobs || ["Nothing needed"]);
    await me.setInput("sign", o.sign || SAMPLE);
    if (o.stopAtReview) return;
    await me.onward();
    await pg.waitForTimeout(1200);
  };
  me.toStops = async () => {
    const s = await me.where();
    if (s !== "s-hub") { await pg.evaluate(() => { try { goHome(); } catch (e) {} }); await pg.waitForTimeout(400); }
    await me.click("Stops and bookings", "#s-hub");
    await pg.waitForTimeout(1200);
  };
  return me;
}
