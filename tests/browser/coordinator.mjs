/* THE COORDINATOR'S APP, IN A BROWSER, AGAINST THE REAL LIVE SERVER.

   The real page, in Chromium at phone width. Every call it makes is answered
   by the real worker.js, loaded in this process over a real SQLite database
   seeded from the real export: the real stops, buses, drivers and rota
   pattern. Nothing between the page and the Worker is a stand-in; only the
   spreadsheet is absent, and where it would answer, the Worker is told what
   the sheet said through its own drain and drained calls.

     CHROMIUM=/opt/pw-browsers/chromium node tests/browser/coordinator.mjs [C1,C2,...]

   Photographs go to $SHOTS (default: the system temp folder). */
import { browser, done, REAL, OUT, ROOT } from "./lib.mjs";
import { join } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals, cleanup } from "../lib/worker.mjs";

const PORT = Number(process.env.MINIBUS_PORT || 8113);
const ONLY = (process.argv[2] || "").split(",").filter(Boolean);
const want = (id) => !ONLY.length || ONLY.includes(id);
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok });
  console.log((ok ? "  ✓ " : "  ✗ ") + id + "  " + name + (ok ? "" : "   [" + detail + "]"));
}
try { mkdirSync(OUT, { recursive: true }); } catch (e) {}

installGlobals();                     /* the Worker's own calls outwards go nowhere */
const { mod: W } = await loadWorker(ROOT);

/* The three numbers as this release's files carry them. */
const stampOf = (f, re) => (re.exec(readFileSync(join(ROOT, f), "utf8")) || [])[1] || "";
const PAGE_V = stampOf("coord/index.html", /PAGE_VERSION\s*=\s*"([^"]+)"/);
const WORKER_V = stampOf("server/worker.js", /SCRIPT_VERSION\s*=\s*"([^"]+)"/);
const SHEET_V = stampOf("Code.gs", /SCRIPT_VERSION\s*=\s*"([^"]+)"/);

const TODAY = W.runSunday();
const NEXT = W.keyAddWeeks(TODAY, 1);
const LAST = W.keyAddWeeks(TODAY, -1);
const PIN = "1234";
const NP = ["Bro Adrian", "Bro Abel", "Bro Martin", "Bro Arthur"], NA = "2026-08-02";
const SP = ["Bro Trevor", "Pst Oliver", "Bro Alfred"], SA = "2026-08-16";
const turn = (key, pat, anchor) => {
  const w = Math.round((Date.parse(key + "T12:00:00Z") - Date.parse(anchor + "T12:00:00Z")) / (7 * 86400000));
  return pat[((w % pat.length) + pat.length) % pat.length];
};
const northOf = (k) => turn(k, NP, NA), southOf = (k) => turn(k, SP, SA);
/* The monthly pairing, as the Buses tab's Route in odd months column says it
   and the sync leaves it on the live server (w2.25.0 has no pairing of its
   own to fall back on). */
const ODD_ROUTE = { "NH56 FWP": "North", "YS70 PWE": "South" };
const PAIRED = REAL.buses.map((b) => ({ reg: b.reg, active: true, oddRoute: ODD_ROUTE[b.reg] || "" }));
const busesOf = (k) => W.busRule(k, PAIRED);
const CAL = W.londonKey(new Date());
const DAY = (n) => W.rnAddDays(CAL, n);

async function world() {
  const db = makeDB(join(ROOT, "server", "schema.sql"));
  const env = makeEnv(db, { SHEET_PUSH_MS: 400 });
  let i = 0;
  for (const s of REAL.stops.filter((x) => x.active)) {
    await db.prepare("INSERT INTO stops (stop_id, route, time, stop, postcode, place, kind, seq, lat, lng) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(s.id, s.route, s.time, s.stop, s.postcode || "", "", s.kind, i++, s.lat, s.lng).run();
  }
  for (const b of REAL.buses) {
    await db.prepare("INSERT INTO buses (reg, seats, active) VALUES (?,?,1)").bind(b.reg, b.seats).run();
  }
  for (const d of REAL.drivers) {
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
      .bind(d.name, d.role, d.route || "North", d.ord, await W.pinHashOf(env, d.name, PIN)).run();
  }
  const extra = {};
  for (const b of PAIRED) extra[b.reg.toUpperCase()] = { dates: {}, oddRoute: b.oddRoute };
  /* From v1.89.0 the Buses screen: YS70 PWE's MOT due in ten days, its
     service a month overdue. */
  extra["YS70 PWE"].dates = { mot: DAY(10), service: DAY(-30), insurance: DAY(200), permit: DAY(120) };
  await W.cachePut(env, "bus_extra", extra).run();
  await W.cachePut(env, "auth_rules", { roles: ["coordinator", "minister in charge"], sameHandBothWays: true }).run();
  await W.cachePut(env, "sheet_url", { url: "https://script.google.com/macros/s/TEST/exec" }).run();
  /* What the sheet's own sync leaves behind, so all three numbers can be read. */
  await db.prepare("INSERT INTO settings (k, v) VALUES ('sheet_version', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
    .bind(SHEET_V).run();

  const rows = [];
  for (let w = -12; w <= 60; w++) {
    const k = W.keyAddWeeks(TODAY, w);
    const bus = busesOf(k);
    const row = { date: k, primary: northOf(k), actual: northOf(k), status: "Confirmed",
                  primary2: southOf(k), actual2: "", notes: "", northBus: bus.North, southBus: bus.South,
                  swaps: [], locked: false, lockNote: "", requests: [] };
    if (k === NEXT) { row.status = "Change requested"; row.requests = [{ driver: northOf(k), type: "Request cover", status: "Pending" }]; }
    rows.push(row);
    if (w >= 0 && w < 8) {
      await db.prepare("INSERT INTO rota (sunday, north, north_cover, north_bus, south, south_cover, south_bus, status, notes) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(k, row.primary, "", row.northBus, row.primary2, "", row.southBus, row.status, "").run();
    }
  }
  const defects = [
    { checkId: "chk-a", reg: "YS70 PWE", date: LAST, driver: southOf(LAST), item: "Nearside rear tyre", crit: false,
      found: "Worn on the inside edge", status: "Open", action: "", kind: "Defect" },
    { checkId: "chk-b", reg: "NH56 FWP", date: LAST, driver: northOf(LAST), item: "Brake fluid level", crit: true,
      found: "Below the minimum mark", status: "Booked in", action: "Booked into Kwik Fit for Tuesday", kind: "Defect" },
    { checkId: "chk-b", reg: "NH56 FWP", date: LAST, driver: northOf(LAST), item: "Wiper blades", crit: false,
      found: "Smearing on the driver's side", status: "Open", action: "", kind: "Advisory",
      /* Its trail, for C32. C8 closes the first defect on the screen, so the
         trail is on one no other check changes. */
      trail: [{ when: Date.now() - 5 * 86400000, who: "Bro Arthur", where: "Coordinator's app", from: "Open", to: "Monitoring",
                why: "Blades on order", what: "Defect: Wiper blades" },
              { when: Date.now() - 2 * 86400000, who: "", where: "On the Defects tab", from: "Monitoring", to: "Open",
                why: "Edited on the Defects tab", what: "Defect: Wiper blades \u2014 Status" }] }];
  /* From v1.90.0, C39: one fault reported on two walkarounds, critical the
     first time and on the DVSA daily list. One card, closed in one go. */
  defects.push(
    { checkId: "chk-0", reg: "YS70 PWE", date: W.keyAddWeeks(LAST, -2), driver: southOf(W.keyAddWeeks(LAST, -2)), item: "Tyres",
      crit: true, found: "Nearside front wearing fast", status: "Monitoring", action: "", kind: "Defect" },
    { checkId: "chk-a", reg: "YS70 PWE", date: LAST, driver: southOf(LAST), item: "Tyres", crit: false,
      found: "Nearside front tread low", status: "Open", action: "", kind: "Defect" });
  const openDefects = {};
  for (const d of defects) {
    d.key = W.defectKeyOf(d);
    (openDefects[d.reg] = openDefects[d.reg] || []).push({ reg: d.reg, item: d.item, crit: d.crit, note: d.found,
      kind: d.kind, date: d.date, checkId: d.checkId, status: d.status });
  }
  await W.cachePut(env, "cache_rota", { builtAt: Date.now(), from: W.keyAddWeeks(TODAY, -12), to: W.keyAddWeeks(TODAY, 104),
    payload: { ok: true, rows, openDefects, drivers: REAL.drivers.map((d) => ({ name: d.name, role: d.role, hasPin: true })) } }).run();
  await W.cachePut(env, "coord_shelf", { builtAt: Date.now(), readAt: Date.now(),
    requests: [{ id: "rq-real-1", sunday: NEXT, driver: northOf(NEXT), type: "Request cover",
                 reason: "Away at my sister's wedding in Leeds", swapWith: "", theirSunday: "", bothAgreed: "",
                 status: "Pending", received: Date.now() - 2 * 86400000, decidedOn: 0, replacement: "" },
               { id: "rq-real-0", sunday: TODAY, driver: southOf(TODAY), type: "Request cover", reason: "Working",
                 status: "Approved", received: Date.now() - 9 * 86400000, decidedOn: Date.now() - 6 * 86400000,
                 replacement: "Bro Alfred" }],
    defects,
    /* The Vehicle Log as the sheet starts it, and the jobs the last walkaround asked for. */
    vehicles: {
      log: { "YS70 PWE": [
        { id: "S-YS70PWE-mot", what: "MOT", status: "Estimated", done: W.rnAddDays(W.rnAddMonths(DAY(10), -12), 1), was: "",
          next: DAY(10), how: "estimated: a year back from the due date on the Buses tab", by: "", source: "Started from the Buses tab",
          recorded: Date.now() - 86400000, correctedBy: "" },
        { id: "S-YS70PWE-service", what: "Service", status: "Estimated", done: W.rnAddMonths(DAY(-30), -12), was: "",
          next: DAY(-30), how: "estimated: a year back from the due date on the Buses tab", by: "", source: "Started from the Buses tab",
          recorded: Date.now() - 86400000, correctedBy: "" }] },
      jobs: { "YS70 PWE": { checkId: "chk-a", date: LAST, driver: southOf(LAST), jobs: ["Screenwash", "Tyre pressures"] } }
    } }).run();

  /* name: what the stop was called when the seat was taken, when that is not
     what its number is called now (C38, C40). */
  const book = async (key, stopId, seats, phone, name) => {
    const s = REAL.stops.find((x) => x.id === stopId);
    const pid = phone ? await W.passengerId(env, phone) : "";
    await db.prepare("INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received, synced) VALUES (?,?,?,?,?,?,?,?,?,?,1)")
      .bind(key, s.route, s.id, name || s.stop, seats, "dev-" + stopId + seats, pid, phone || "", "Booked", Date.now() - 3600000).run();
  };
  await book(NEXT, "N02", 2, "07700900123");
  await book(NEXT, "N02", 1, "07700900456");
  await book(NEXT, "N06", 3, "07700900789");
  await book(NEXT, "S04", 2, "07700900321");
  await book(NEXT, "S07", 1, "");
  await book(TODAY, "N01", 2, "07700900111");
  /* C40: a seat taken when N06 was another place. */
  await book(NEXT, "N06", 1, "07700900654", "Old Place by the Park");
  /* C38: last Sunday's seats. S03 booked and never tapped; S05 booked when
     it was another place, and never tapped; S02 nobody booked. */
  await book(LAST, "S03", 2, "07700900222");
  await book(LAST, "S05", 1, "07700900333", "Old Place by the Park");

  /* Last Sunday's North run: left church three minutes late, Wilburn Street
     tapped seven minutes behind, Westminster Road never tapped, and nobody
     at Fountains Road. In the driver app's own words: pickup and empty, what
     its buttons send (the live server read neither before w2.30.1). */
  const at = (key, t, plus) => W.londonMoment(key, t).getTime() + (plus || 0) * 60000;
  const n = (id) => REAL.stops.find((x) => x.id === id);
  const events = [{ event: "start", at: at(LAST, "10:05", 3) }];
  for (const [id, plus] of [["N01", 2], ["N02", 3], ["N03", 2], ["N04", 4], ["N06", 5], ["N07", 6], ["N08", 7]]) {
    events.push({ event: id === "N04" ? "empty" : "pickup", stopId: id, at: at(LAST, n(id).time, plus) });
  }
  events.push({ event: "end", at: at(LAST, "11:00", 9) });
  const bus = busesOf(LAST);
  await W.handleTrip(env, { trip: "trip-last-n", route: "North", driver: northOf(LAST), reg: bus.North,
                            sunday: LAST, events });
  await W.handleTrip(env, { trip: "trip-last-s", route: "South", driver: southOf(LAST), reg: bus.South,
                            sunday: LAST, events: [{ event: "start", at: at(LAST, "10:16", 1) },
                                                   { event: "pickup", stopId: "S01", at: at(LAST, "10:24", 1) },
                                                   { event: "pickup", stopId: "S04", at: at(LAST, "10:36", 2) },
                                                   { event: "end", at: at(LAST, "11:00", 4) }] });
  db._exec("UPDATE trip_events SET synced=1");
  return { db, env };
}

async function page(env, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, serviceWorkers: "block", colorScheme: o.dark ? "dark" : "light" });
  const pg = await ctx.newPage();
  const errs = [], knocks = [];
  pg.on("pageerror", (e) => errs.push(String(e.message)));
  await pg.route("**://fonts.googleapis.com/**", (r) => r.abort());
  await pg.route("**://fonts.gstatic.com/**", (r) => r.abort());
  await pg.route("**://drolnstone.github.io/**", (r) => r.abort());
  await pg.route("**://*.workers.dev/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    const res = await W.default.fetch(new Request(req.url(), { method: req.method(),
      body: req.method() === "POST" ? req.postData() : undefined }), env, { waitUntil: (p) => knocks.push(p) });
    await route.fulfill({ status: res.status, contentType: "application/json", body: await res.text(),
                          headers: { "access-control-allow-origin": "*" } });
  });
  /* The install guide opens by itself on a first visit and would sit over
     the sign-in screen. Said no to, as a returning coordinator would have,
     unless a check is about the guide itself. */
  if (!o.install) await pg.addInitScript(`try { localStorage.setItem("coord.install.v1", "1"); } catch (e) {}`);
  if (o.theme) await pg.addInitScript(`try { localStorage.setItem("fleet.theme.v1", ${JSON.stringify(o.theme)}); } catch (e) {}`);
  if (o.name) await pg.addInitScript(`try { localStorage.setItem("coord.name.v1", ${JSON.stringify(o.name)}); } catch (e) {}`);
  /* What the driver app's Coordinator button leaves in the tab, as it leaves
     it: once, before this page's own script runs. */
  if (o.hand) await pg.addInitScript(`try {
      if (!window.name) { window.name = "handed";
        sessionStorage.setItem("coord.hand.v1", JSON.stringify({ name: ${JSON.stringify(o.hand.name)},
          pin: ${JSON.stringify(o.hand.pin)}, at: Date.now() - ${Number(o.hand.ageMs || 0)} })); }
    } catch (e) {}`);
  await pg.goto("http://127.0.0.1:" + PORT + "/coord/" + (o.hash || ""), { waitUntil: "domcontentloaded" });
  await pg.waitForTimeout(300);
  const me = { pg, ctx, errs, knocks };
  /* textContent, not innerText: the buttons are set in capitals by the
     stylesheet, and the words being checked are the ones the page wrote. */
  me.text = (sel) => pg.$eval(sel, (el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll("button, span, p, li, small, h1, h2, h3, div, b, a").forEach((n) => n.append(" "));
    return (c.textContent || "").replace(/\s+/g, " ").trim();
  }).catch(() => "");
  me.shot = (name) => pg.screenshot({ path: OUT + "/" + name + ".png" });
  me.wait = (ms) => pg.waitForTimeout(ms);
  me.tap = async (sel) => { await pg.click(sel); await pg.waitForTimeout(250); };
  me.tapText = async (text, within) => {
    const loc = pg.locator((within || "body") + " button", { hasText: text }).first();
    await loc.click(); await pg.waitForTimeout(250);
  };
  me.signIn = async (pin) => {
    await pg.selectOption("#signName", "Bro Arthur");
    await pg.fill("#signPin", "");
    await pg.type("#signPin", pin || PIN, { delay: 30 });
    await pg.waitForTimeout(1300);
  };
  me.on = (id) => pg.$eval("#s-" + id, (el) => el.classList.contains("is-on")).catch(() => false);
  me.sheetUp = () => pg.$eval("#sheet", (el) => el.classList.contains("is-on")).catch(() => false);
  me.go = async () => { await pg.click("#sheetGo"); await pg.waitForTimeout(900); };
  me.settle = async () => { await Promise.all(knocks.splice(0)); await pg.waitForTimeout(200); };
  return me;
}

const { db, env } = await world();
let me = null;

/* C1 — a wrong PIN says so, the right one opens it on the first screen */
if (want("C1") || true) {
  me = await page(env);
  await me.signIn("9999");
  const bad = await me.text("#signSay");
  await me.shot("C1a-wrong-pin");
  await me.signIn(PIN);
  const home = await me.on("home");
  const menu = await me.text("#homeBody .menu");
  await me.shot("C1-home");
  const onScreen = await me.pg.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 2);
  check("C1", "a wrong PIN says so; the right one opens the first screen, all of it on one screen",
        /not right/.test(bad) && /2 tries left/.test(bad) && home && /1 waiting/.test(menu) && /4 open/.test(menu) && onScreen,
        "bad '" + bad + "', home " + home + ", menu '" + menu.replace(/\n/g, " | ") + "', fits " + onScreen);
}

/* C2 — a cover on next Sunday, shown at once and taken by the live server */
if (want("C2")) {
  await me.pg.evaluate((k) => { location.hash = "sunday/" + k; }, NEXT);
  await me.wait(400);
  await me.shot("C2a-sunday");
  await me.pg.click('[data-do="driver"][data-slot="northCover"]');
  await me.wait(300);
  await me.shot("C2b-pick-cover");
  const free = await me.pg.$$eval('#sheetBody [data-pick]:not([disabled])', (els) => els.map((e) => e.getAttribute("data-pick")));
  const coverName = free[0];
  await me.pg.click('#sheetBody [data-pick="' + coverName + '"]');
  await me.wait(150);
  const label = await me.text("#sheetGo");
  await me.go();
  const knocked = me.knocks.length;
  await me.settle();
  const cover = await me.text("#sundayBody .route-card");
  const raw = db._one("SELECT north_cover, status FROM rota WHERE sunday=?", NEXT);
  const acts = db._rows("SELECT kind, words FROM coord_actions");
  await me.shot("C2-sunday-covered");
  check("C2", "a cover put on next Sunday shows at once and is taken by the live server",
        label === coverName + " covers North" && cover.indexOf(coverName) !== -1 && raw.north_cover === coverName &&
        acts.length === 1 && knocked === 1,
        "label '" + label + "', card '" + cover.slice(0, 80) + "', raw " + JSON.stringify(raw) + ", acts " + acts.length);
}

/* C3 — North called off, then put back */
if (want("C3")) {
  await me.pg.click('[data-do="status"][data-mode="North"]');
  await me.wait(300);
  const line = await me.text("#sheetBody .line");
  await me.shot("C3a-call-off");
  await me.go();
  const off = db._one("SELECT status FROM rota WHERE sunday=?", NEXT).status;
  const seg = await me.text(".seg button.on");
  await me.shot("C3-north-off");
  await me.pg.click('[data-do="status"][data-mode="on"]');
  await me.wait(300);
  await me.go();
  const back = db._one("SELECT status FROM rota WHERE sunday=?", NEXT).status;
  check("C3", "North called off for the passengers and put back on again",
        off === "North cancelled" && /North off/i.test(seg) && /told it is not running/.test(line) && back === "Change requested",
        "off '" + off + "', seg '" + seg + "', back '" + back + "', line '" + line + "'");
}

/* C4 — the two buses swapped in one change */
if (want("C4")) {
  const was = db._one("SELECT north_bus, south_bus FROM rota WHERE sunday=?", NEXT);
  await me.pg.click('[data-do="bus"][data-route="North"]');
  await me.wait(300);
  await me.pg.click('#sheetBody [data-pick="' + was.south_bus + '"]');
  await me.wait(150);
  const label = await me.text("#sheetGo");
  await me.shot("C4a-swap");
  await me.go();
  const now = db._one("SELECT north_bus, south_bus FROM rota WHERE sunday=?", NEXT);
  check("C4", "choosing the other route's bus swaps the two",
        label === "Swap the two buses" && now.north_bus === was.south_bus && now.south_bus === was.north_bus,
        "label '" + label + "', was " + JSON.stringify(was) + ", now " + JSON.stringify(now));
}

/* C5 — a note on the Sunday */
if (want("C5")) {
  await me.pg.click('[data-do="note"]');
  await me.wait(300);
  await me.pg.fill("#noteText", "Bus back by 12:30 for the youth trip.");
  await me.go();
  const notes = await me.text("#sundayBody .notes");
  await me.shot("C5-note");
  check("C5", "a note is added to the Sunday", /youth trip/.test(notes), "notes '" + notes + "'");
}

/* C6 — a rota request approved with a cover */
if (want("C6")) {
  await me.pg.evaluate(() => { location.hash = "requests"; });
  await me.wait(400);
  const card = await me.text("#requestsBody .req");
  await me.shot("C6a-requests");
  await me.pg.click('#requestsBody [data-do="approve"]');
  await me.wait(300);
  await me.shot("C6b-who-covers");
  const pickable = await me.pg.$$eval('#sheetBody [data-pick]:not([disabled])', (els) => els.map((e) => e.getAttribute("data-pick")));
  const who = pickable.find((n) => n !== "-") || "";
  await me.pg.click('#sheetBody [data-pick="' + who + '"]');
  await me.wait(150);
  const label = await me.text("#sheetGo");
  await me.go();
  const decided = await me.text("#requestsBody .list");
  await me.shot("C6-approved");
  check("C6", "a request is approved with a cover chosen from the people free that morning",
        /sister's wedding/.test(card) && label === "Approve, " + who + " covers" && /Approved/.test(decided) &&
        decided.indexOf(who) !== -1,
        "card '" + card.slice(0, 60) + "', label '" + label + "', decided '" + decided.slice(0, 120) + "'");
}

/* C7 — bookings with numbers to ring; one cancelled, one made */
if (want("C7")) {
  await me.pg.evaluate((k) => { location.hash = "bookings/" + k; }, NEXT);
  await me.wait(700);
  await me.shot("C7a-bookings");
  const tel = await me.pg.$$eval('#bookingsBody a[href^="tel:"]', (as) => as.map((a) => a.getAttribute("href")));
  const layout = await me.pg.evaluate(() => {
    const book = document.querySelector('#bookingsBody [data-do="book"]');
    const card = document.querySelector("#bookingsBody .card");
    return { bookFirst: !!(book && card && (book.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING)),
             empty: document.querySelectorAll("#bookingsBody .bs.nobody").length,
             shown: document.querySelectorAll("#bookingsBody .bs").length,
             more: (document.querySelector("#bookingsBody .bs-more") || {}).textContent || "" };
  });
  await me.pg.click("#bookingsBody .bs-more");
  await me.wait(200);
  const every = await me.pg.$$eval("#bookingsBody .bs.nobody", (els) => els.length);
  await me.shot("C7c-every-stop");
  await me.pg.click("#bookingsBody .bs-more");
  await me.wait(200);
  const again = await me.pg.$$eval("#bookingsBody .bs.nobody", (els) => els.length);
  await me.pg.click('#bookingsBody [data-do="cancel"]');
  await me.wait(300);
  await me.go();
  const left = db._rows("SELECT status FROM bookings WHERE sunday=? AND status='Cancelled'", NEXT).length;
  const toastAfterAct = await me.pg.$eval("#toast", (el) => el.classList.contains("is-on"));
  await me.pg.click('#bookingsBody [data-do="book"]');
  await me.wait(300);
  const toastOverSheet = await me.pg.$eval("#toast", (el) => el.classList.contains("is-on"));
  await me.pg.selectOption("#bkStop", "N04");
  await me.pg.click("#bkMore");
  await me.pg.fill("#bkPhone", "07700 900999");
  const label = await me.text("#sheetGo");
  const oneLine = await me.pg.$eval("#sheetGo", (el) => el.getBoundingClientRect().height < 60);
  await me.shot("C7b-book");
  await me.go();
  await me.wait(600);
  const made = db._one("SELECT seats, phone, note FROM bookings WHERE stop_id='N04' AND sunday=?", NEXT);
  const after = await me.text("#bookingsBody");
  await me.shot("C7-bookings-after");
  check("C7", "bookings show the numbers to ring; one is cancelled and one made for somebody who rang",
        tel.indexOf("tel:07700900123") !== -1 && left === 1 && made && made.seats === 2 && made.phone === "07700900999" &&
        /Bro Arthur/.test(made.note) && /By phone/i.test(after) && label === "Book 2 seats" && oneLine,
        "tel " + JSON.stringify(tel) + ", cancelled " + left + ", made " + JSON.stringify(made) + ", label '" + label + "'");
  check("C7a", "the booked stops come first, the empty ones a tap away, and the book button at the top",
        layout.bookFirst && layout.empty === 0 && layout.shown === 4 && /stops with nobody booked/.test(layout.more) &&
        every > 0 && again === 0,
        JSON.stringify(layout) + ", every stop " + every + ", folded again " + again);
  check("C7b", "a message from the last change goes when a sheet rises, so it never covers the sheet's buttons",
        toastAfterAct && !toastOverSheet, "after the change " + toastAfterAct + ", with the sheet up " + toastOverSheet);
}

/* C8 — a defect closed with what was done */
if (want("C8")) {
  await me.pg.evaluate(() => { location.hash = "defects"; });
  await me.wait(400);
  await me.shot("C8a-defects");
  const before = await me.pg.$$eval("#defectsBody .def", (els) => els.length);
  const pubOf = async () => { const m = (await W.cachedRota(env, TODAY, 1)).openDefects || {};
                              return Object.keys(m).reduce((n, k) => n + m[k].length, 0); };
  const pubBefore = await pubOf();
  await me.pg.click('#defectsBody [data-do="defect"]');
  await me.wait(300);
  await me.pg.click('#defStates [data-state="Fixed"]');
  const label = await me.text("#sheetGo");
  await me.pg.click("#sheetGo");
  await me.wait(300);
  const refusal = await me.text("#sheetSay");
  await me.pg.fill("#defDid", "Tyre replaced at Halfords, Walton");
  const cleared = await me.text("#sheetSay");
  await me.shot("C8b-close");
  await me.go();
  const after = await me.pg.$$eval("#defectsBody .def", (els) => els.length);
  const pubCount = await pubOf();
  await me.shot("C8-defects-after");
  check("C8", "a defect is closed only with what was done, and leaves every phone at once",
        label === "Close it" && /what was done/i.test(refusal) && cleared === "" && after === before - 1 && pubCount === pubBefore - 1,
        "label '" + label + "', refusal '" + refusal + "', then '" + cleared + "', " + before + " -> " + after + ", public " + pubBefore + " -> " + pubCount);
}

/* C9 — the Wilburn time put right, and a stop nobody tapped given its time */
if (want("C9")) {
  await me.pg.evaluate((k) => { location.hash = "runs/" + k; }, LAST);
  await me.wait(800);
  await me.shot("C9a-run-record");
  const wil = me.pg.locator("#runsBody .ev", { hasText: "Wilburn" }).first();
  const wasText = await wil.textContent();
  const emptyText = await me.pg.locator("#runsBody .ev", { hasText: "Fountains" }).first().textContent();
  await wil.locator("button").click();
  await me.wait(300);
  await me.pg.fill("#fixAt", "10:53");
  const label = await me.text("#sheetGo");
  await me.shot("C9b-fix");
  await me.go();
  await me.wait(700);
  const row = db._one("SELECT happened, status, fix_note, synced FROM trip_events WHERE trip='trip-last-n' AND stop_id='N08'");
  const nowText = await me.pg.locator("#runsBody .ev", { hasText: "Wilburn" }).first().textContent();
  const miss = me.pg.locator("#runsBody .ev", { hasText: "Westminster" }).first();
  await miss.locator("button").click();
  await me.wait(300);
  await me.pg.fill("#fixAt", "10:44");
  await me.go();
  await me.wait(700);
  const added = db._one("SELECT status, fix_note FROM trip_events WHERE trip='trip-last-n' AND stop_id='N05'");
  await me.shot("C9-run-record-after");
  check("C9", "the driver's taps are on the record, Nobody there said so; a stop time is put right and marked as a correction; a stop nobody tapped is given its time",
        /nobody there/i.test(emptyText) && !/not marked/i.test(wasText) &&
        /\+7/.test(wasText) && label === "Correct it to 10:53" && W.londonHHMM(new Date(row.happened)) === "10:53" &&
        /Corrected/.test(row.status) && /Recorded as 10:58/.test(row.fix_note) && row.synced === 0 &&
        /Corrected/.test(nowText) && added && added.status === "Corrected",
        "empty '" + emptyText.replace(/\n/g, " ") + "', was '" + wasText.replace(/\n/g, " ") + "', label '" + label + "', row " + JSON.stringify(row) +
        ", now '" + nowText.replace(/\n/g, " ") + "', added " + JSON.stringify(added));
}

/* C10 — the reports: from the live server, and from the sheet when it does not answer */
if (want("C10")) {
  await me.pg.evaluate(() => { location.hash = "look"; });
  await me.wait(300);
  await me.shot("C10a-look");
  await me.pg.evaluate(() => { location.hash = "report/seats"; });
  await me.wait(900);
  const seats = await me.text("#reportBody");
  await me.shot("C10b-seats");
  await me.pg.evaluate(() => { location.hash = "report/health"; });
  await me.wait(2500);
  const health = await me.text("#reportBody");
  await me.shot("C10-health-no-sheet");
  check("C10", "the reports answer from the live server, and say so when the sheet does not",
        /North: /.test(seats) && /booked/.test(seats) && /did not answer/.test(health) && /clock/.test(health),
        "seats '" + seats.slice(0, 120) + "', health '" + health.slice(0, 160) + "'");
}

/* C11 — what the sheet said about each change is what he sees */
if (want("C11")) {
  const d = await (await W.handleDrain(env, { limit: 300 })).json();
  const list = d.coord.map((a, i) => ({ id: a.id, ok: i !== 1, result: i !== 1 ? "On the Rota tab." : "The Rota tab has no Status column." }));
  await W.handleDrained(env, { claim: d.claim, coord: list });
  await me.pg.evaluate(() => { location.hash = "activity"; });
  await me.wait(300);
  await me.pg.evaluate(() => refresh());
  await me.wait(900);
  const body = await me.text("#activityBody");
  await me.shot("C11-activity");
  await me.pg.evaluate(() => { location.hash = "home"; });
  await me.wait(300);
  const home = await me.text("#homeBody");
  await me.shot("C11b-home-refused");
  check("C11", "each change says whether it is on the sheet, and one the sheet refused says why",
        /On the sheet/.test(body) && /Not taken/.test(body) && /no Status column/.test(body) &&
        /did not take a change/.test(home),
        "activity '" + body.slice(0, 200).replace(/\n/g, " | ") + "', home '" + home.slice(0, 120).replace(/\n/g, " | ") + "'");
}

/* C12 — left alone, it locks; keying the PIN goes back to where he was */
if (want("C12")) {
  await me.pg.evaluate(() => { location.hash = "defects"; });
  await me.wait(300);
  await me.pg.evaluate(() => { window.touched = 0; document.dispatchEvent(new Event("visibilitychange")); });
  await me.wait(300);
  const locked = await me.on("sign");
  const said = await me.text("#signSay");
  const pinGone = await me.pg.evaluate(() => pin === "");
  await me.shot("C12-locked");
  await me.signIn(PIN);
  const back = await me.on("defects");
  check("C12", "left alone it forgets the PIN, and keying it again goes back to the same screen",
        locked && /Locked after 15 minutes/.test(said) && pinGone && back,
        "locked " + locked + ", said '" + said + "', pin gone " + pinGone + ", back " + back);
}

/* C13 — a bus stopped at the walkaround this morning is on the first screen, and can be authorised */
if (want("C13")) {
  const day = W.londonKey(new Date());
  await db.prepare("INSERT OR REPLACE INTO checks_today (reg, day, state, at, driver, check_id) VALUES (?,?,?,?,?,?)")
    .bind("YS70 PWE", day, "stopped", Date.now() - 600000, "Bro Trevor", "chk-today").run();
  await me.pg.evaluate(() => { location.hash = "home"; refresh(); });
  await me.wait(900);
  const home = await me.text("#homeBody");
  await me.shot("C13a-stopped");
  await me.pg.click('#homeBody [data-do="authorise"]');
  await me.wait(300);
  await me.go();
  await me.wait(600);
  const state = (await W.checksToday(env))["YS70 PWE"].state;
  check("C13", "a stopped bus is on the first screen and is authorised from it with the same PIN",
        /YS70 PWE was stopped/.test(home) && state === "authorised",
        "home '" + home.slice(0, 100) + "', state " + state);
}

/* C14 — the same screens in the dark theme the driver app keeps */
if (want("C14")) {
  const dark = await page(env, { theme: "dark" });
  await dark.signIn(PIN);
  await dark.shot("C14-home-dark");
  await dark.pg.evaluate((k) => { location.hash = "sunday/" + k; }, NEXT);
  await dark.wait(400);
  await dark.shot("C14b-sunday-dark");
  const bg = await dark.pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check("C14", "the dark theme the driver app keeps is the one this page opens in",
        bg === "rgb(14, 18, 22)" && !dark.errs.length, "background " + bg + ", errors " + JSON.stringify(dark.errs));
  await dark.ctx.close();
}

/* C15 — from the driver app with the PIN it checked: no second PIN */
if (want("C15")) {
  const p = await page(env, { hand: { name: "Bro Arthur", pin: PIN } });
  await p.wait(1500);
  const home = await p.on("home");
  const left = await p.pg.evaluate(() => { try { return sessionStorage.getItem("coord.hand.v1"); } catch (e) { return "unreadable"; } });
  const who = await p.text("#barSub");
  await p.shot("C15-carried");
  check("C15", "opened from the driver app with the PIN checked there, it goes straight to the first screen and keeps no copy",
        home && left === null && who === "Bro Arthur" && !p.errs.length,
        "home " + home + ", left " + left + ", bar '" + who + "', errors " + JSON.stringify(p.errs));
  await p.ctx.close();
}

/* C16 — a stale copy is not used; the PIN box is where the cursor is */
if (want("C16")) {
  const p = await page(env, { name: "Bro Arthur", hand: { name: "Bro Arthur", pin: PIN, ageMs: 120000 } });
  await p.wait(900);
  const sign = await p.on("sign");
  const picked = await p.pg.$eval("#signName", (el) => el.value);
  const focus = await p.pg.evaluate(() => document.activeElement && document.activeElement.id);
  const left = await p.pg.evaluate(() => { try { return sessionStorage.getItem("coord.hand.v1"); } catch (e) { return "unreadable"; } });
  await p.shot("C16-asks");
  check("C16", "a PIN left more than a minute ago is not used: it asks, with his name in the box and the cursor in the PIN box",
        sign && picked === "Bro Arthur" && focus === "signPin" && left === null && !p.errs.length,
        "sign " + sign + ", name '" + picked + "', focus " + focus + ", left " + left);
  await p.ctx.close();
}

/* C17 — choosing a name moves the cursor to the PIN box */
if (want("C17")) {
  const p = await page(env);
  await p.wait(700);
  await p.pg.selectOption("#signName", "Bro Arthur");
  const focus = await p.pg.evaluate(() => document.activeElement && document.activeElement.id);
  check("C17", "choosing a name puts the cursor in the PIN box, as on the driver app",
        focus === "signPin" && !p.errs.length, "focus " + focus);
  await p.ctx.close();
}

/* C18 — the landing page: all three numbers, the report under them, the theme chips */
if (want("C18")) {
  const p = await page(env, { name: "Bro Arthur" });
  await p.wait(1200);
  const line = await p.text("#signVersion");
  const order = await p.pg.evaluate(() => {
    const v = document.getElementById("signVersion"), t = document.getElementById("themes");
    return !!(v && t && (v.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  await p.pg.click("#signVersion");
  await p.wait(300);
  const report = await p.text("#sheetBody");
  await p.shot("C18a-report");
  await p.pg.click("#sheetNot");
  await p.pg.click('#themes [data-theme-set="navy"]');
  await p.wait(150);
  const theme = await p.pg.evaluate(() => [document.documentElement.getAttribute("data-theme"),
                                           localStorage.getItem("fleet.theme.v1")]);
  await p.shot("C18b-landing-navy");
  await p.signIn(PIN);
  const homeLine = await p.pg.evaluate(() => !!document.querySelector("#homeBody .version"));
  check("C18", "the landing page carries all three numbers and, under a tap, what decides whether it opens; the first screen does not",
        line.indexOf("app " + PAGE_V) !== -1 && line.indexOf("server " + WORKER_V) !== -1 &&
        line.indexOf("sheet " + SHEET_V) !== -1 && /Who can open this/.test(report) && /has a PIN/.test(report) &&
        /answered at/.test(report) && !homeLine && !p.errs.length,
        "line '" + line + "', report '" + report.slice(0, 160) + "', on the first screen " + homeLine);
  check("C18a", "the theme chips sit under the numbers and set the driver app's own setting",
        order && theme[0] === "navy" && theme[1] === "navy", "order " + order + ", theme " + JSON.stringify(theme));
  await p.ctx.close();
}

/* C19 — a rehearsal, started, started over and ended from the coordinator's
   app, as often as he likes. The live server here runs on the real clock, so
   on a Sunday between the cutoff and noon the check is the refusal instead. */
if (want("C19")) {
  const flag = () => db._rows("SELECT v FROM settings WHERE k='rehearsal'").map((r) => JSON.parse(r.v))[0] || null;
  const seeds = () => db._rows("SELECT device FROM bookings WHERE status='Rehearsal'").map((r) => r.device);
  await me.pg.evaluate(() => { location.hash = "home"; refresh(); });
  await me.wait(900);
  const menu = await me.text("#homeBody .menu");
  const row = await me.pg.$('#homeBody [data-go="rehearsal"]');
  if (row) { await row.click(); await me.wait(400); }
  const none = row ? await me.text("#rehearsalBody") : "";
  if (row) await me.shot("C19a-none-running");
  const blocked = row ? await W.liveMorning(env) : "";
  if (!row) {
    check("C19", "Start a rehearsal: four mornings to choose from, the button says which, and it runs with test seats on both routes",
          false, "no Rehearsal on the first screen: menu '" + menu + "'");
  } else if (blocked) {
    const off = await me.pg.$eval('[data-do="rehstart"]', (b) => b.disabled).catch(() => false);
    check("C19", "on a Sunday morning the Rehearsal screen says why none can start, and Start is off",
          /Rehearsal/.test(menu) && none.indexOf(blocked) !== -1 && off, "menu '" + menu + "', screen '" + none.slice(0, 120) + "'");
  } else {
    await me.pg.click('[data-do="rehstart"]');
    await me.wait(300);
    const shapes = await me.pg.$$eval("#sheetBody [data-pick]", (b) => b.map((x) => x.getAttribute("data-pick")));
    await me.pg.click('#sheetBody [data-pick="full"]');
    await me.wait(150);
    const label = await me.text("#sheetGo");
    await me.shot("C19b-choose");
    await me.go();
    await me.settle();
    const first = flag(), firstSeeds = seeds();
    const running = await me.text("#rehearsalBody");
    await me.shot("C19c-running");
    const ends = W.rehearsalEnds(first ? first.at : 0);
    const endsWords = W.londonHHMM(new Date(ends));
    check("C19", "Start a rehearsal: four mornings to choose from, the button says which, and it runs with test seats on both routes",
          /Rehearsal/.test(menu) && /None running/.test(none) && shapes.join() === "quiet,normal,full,over" &&
          label === "Start: a nearly full bus" && first && first.shape === "full" && firstSeeds.length > 0 &&
          running.indexOf("Until " + endsWords) !== -1 && /North/.test(running) && /South/.test(running) &&
          /No test run yet/.test(running),
          "menu '" + menu + "', shapes " + shapes + ", label '" + label + "', flag " + JSON.stringify(first) +
          ", seats " + firstSeeds.length + ", screen '" + running.slice(0, 200) + "'");

    await me.pg.evaluate(() => { location.hash = "home"; });
    await me.wait(500);
    const home = await me.text("#homeBody");
    await me.shot("C19d-home");
    check("C19a", "while it runs, the first screen says so first, with its end time",
          home.indexOf("A rehearsal is running until " + endsWords + ".") === 0,
          "home '" + home.slice(0, 120) + "'");

    await me.pg.click('#homeBody [data-go="rehearsal"]');
    await me.wait(400);
    await new Promise((r) => setTimeout(r, 1100));        /* a new round is a new moment */
    await me.pg.click('[data-do="rehover"]');
    await me.wait(300);
    await me.pg.click('#sheetBody [data-pick="quiet"]');
    await me.wait(150);
    const label2 = await me.text("#sheetGo");
    await me.go();
    await me.settle();
    const second = flag(), secondSeeds = seeds();
    check("C19b", "Start over is a new round with new seats, and none of the last round's are left",
          label2 === "Start over: a quiet morning" && second && first && second.at > first.at && second.shape === "quiet" &&
          secondSeeds.length > 0 && !secondSeeds.some((d) => firstSeeds.indexOf(d) !== -1),
          "label '" + label2 + "', rounds " + (first && first.at) + " then " + (second && second.at) +
          ", seats " + firstSeeds.length + " then " + secondSeeds.length);

    await me.pg.click('[data-do="rehend"]');
    await me.wait(300);
    const endLine = await me.text("#sheetBody .line");
    await me.go();
    await me.settle();
    const after = await me.text("#rehearsalBody");
    await me.shot("C19e-ended");
    const acts = db._rows("SELECT words FROM coord_actions WHERE kind='rehearsal' ORDER BY seq").map((r) => r.words);
    check("C19c", "End it clears the live server, and the screen and What has been done say so; the sheet asks without a lesson",
          endLine === "" && !flag() && seeds().length === 0 &&
          /None running/.test(after) && acts.length === 3 && acts[2] === "Rehearsal ended." &&
          /^Rehearsal started over: a quiet morning/.test(acts[1]),
          "line '" + endLine + "', flag " + JSON.stringify(flag()) + ", seats " + seeds().length +
          ", screen '" + after.slice(0, 80) + "', actions " + JSON.stringify(acts));
  }
}

/* C20 — the other way: from here to the driver app's vehicle check, no second PIN */
if (want("C20")) {
  const p = await page(env);
  await p.signIn(PIN);
  await p.pg.click('#homeBody [data-do="check"]');
  await p.pg.waitForURL((u) => !/\/coord\//.test(String(u)), { timeout: 8000 }).catch(() => {});
  await p.wait(3500);
  const onVehicle = await p.pg.$eval("#s-vehicle", (el) => el.classList.contains("is-on")).catch(() => false);
  const driver = await p.pg.evaluate(() => (typeof st !== "undefined" && st.driver) || "");
  const left = await p.pg.evaluate(() => { try { return sessionStorage.getItem("fleet.hand.v1"); } catch (e) { return "unreadable"; } });
  await p.shot("C20-to-check");
  check("C20", "Vehicle check on the first screen opens the driver app on choosing the bus, signed in, with no PIN typed and no copy left",
        onVehicle && driver === "Bro Arthur" && left === null && !p.errs.length,
        "vehicle " + onVehicle + ", driver '" + driver + "', left " + left + ", errors " + JSON.stringify(p.errs));
  await p.ctx.close();
}

/* C21 — the Driver app link, signed in: to the hub, signed in, PIN taken */
if (want("C21")) {
  const p = await page(env);
  await p.signIn(PIN);
  await p.pg.click('#homeBody [data-do="driverapp"]');
  await p.pg.waitForURL((u) => !/\/coord\//.test(String(u)), { timeout: 8000 }).catch(() => {});
  await p.wait(3500);
  const onHub = await p.pg.$eval("#s-hub", (el) => el.classList.contains("is-on")).catch(() => false);
  const state = await p.pg.evaluate(() => typeof st !== "undefined" ? { driver: st.driver, pinOk: st.pinOk } : {});
  const left = await p.pg.evaluate(() => { try { return sessionStorage.getItem("fleet.hand.v1"); } catch (e) { return "unreadable"; } });
  await p.shot("C21-to-hub");
  check("C21", "the Driver app link on the first screen lands on the driver app's hub, signed in with the PIN taken, and no copy left",
        onHub && state.driver === "Bro Arthur" && state.pinOk === true && left === null && !p.errs.length,
        "hub " + onHub + ", state " + JSON.stringify(state) + ", left " + left + ", errors " + JSON.stringify(p.errs));
  await p.ctx.close();
}

/* C22 — the titles are the sheet's: change them there and the sign-in list follows */
if (want("C22")) {
  const names = async () => {
    const p = await page(env);
    await p.wait(1500);
    const list = await p.pg.$$eval("#signName option", (os) => os.map((o) => o.value).filter(Boolean));
    await p.ctx.close();
    return list;
  };
  const before = await names();
  await W.handleSync(env, { authRules: { roles: ["Coordinator"], sameHandBothWays: true } });
  const after = await names();
  await W.handleSync(env, { authRules: { roles: ["Coordinator", "Minister in Charge"], sameHandBothWays: true } });
  check("C22", "COORDINATOR_ROLES decides who may sign in: with Coordinator alone, the Minister in Charge is no longer offered",
        before.includes("Pst Kenneth") && before.includes("Bro Arthur") &&
        !after.includes("Pst Kenneth") && after.includes("Bro Arthur"),
        "before " + JSON.stringify(before) + ", after " + JSON.stringify(after));
}

/* C23 — the names are kept on the phone: no answer yet, and the name and the cursor are there */
if (want("C23")) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e.message)));
  await pg.route("**://fonts.googleapis.com/**", (r) => r.abort());
  await pg.route("**://fonts.gstatic.com/**", (r) => r.abort());
  await pg.route("**://*.workers.dev/**", () => {});          /* never answers */
  const reg = REAL.drivers.map((d) => ({ name: d.name, role: d.role, hasPin: true }));
  await pg.addInitScript(`try {
      localStorage.setItem("coord.register.v1", ${JSON.stringify(JSON.stringify(reg))});
      localStorage.setItem("coord.name.v1", "Bro Arthur");
    } catch (e) {}`);
  await pg.goto("http://127.0.0.1:" + PORT + "/coord/", { waitUntil: "domcontentloaded" });
  await pg.waitForTimeout(600);
  const picked = await pg.$eval("#signName", (el) => el.value).catch(() => "");
  const offered = await pg.$$eval("#signName option", (os) => os.map((o) => o.value).filter(Boolean));
  const focus = await pg.evaluate(() => document.activeElement && document.activeElement.id);
  check("C23", "with the live server silent, the kept Drivers tab gives the sign-in list, the remembered name and the cursor in the PIN box at once",
        picked === "Bro Arthur" && offered.includes("Pst Kenneth") && focus === "signPin" && !errs.length,
        "picked '" + picked + "', offered " + JSON.stringify(offered) + ", focus " + focus + ", errors " + JSON.stringify(errs));
  await ctx.close();
}

/* C24 — the install guide, as the other two apps have it */
if (want("C24")) {
  const p = await page(env, { install: true });
  await p.wait(1200);
  const up = await p.pg.$eval("#howModal", (el) => el.classList.contains("is-on"));
  const said = await p.text("#howModal");
  const button = await p.text("#howDone");
  await p.shot("C24-install");
  await p.pg.click("#howDone");
  await p.wait(200);
  const gone = !(await p.pg.$eval("#howModal", (el) => el.classList.contains("is-on")));
  await p.pg.click("#howLink");
  await p.wait(200);
  const again = await p.pg.$eval("#howModal", (el) => el.classList.contains("is-on"));
  const again2 = await p.text("#howDone");
  await p.ctx.close();
  const q = await page(env, { install: true });
  await q.wait(1200);
  const second = await q.pg.evaluate(() => { try { return localStorage.getItem("coord.install.v1"); } catch (e) { return "x"; } });
  await q.ctx.close();
  check("C24", "a first visit offers Add to your phone with the steps, Not now closes it, and the link under the appearance brings it back as Done",
        up && /Add to your phone/.test(said) && /Install|Add to Home Screen|Share/.test(said) &&
        button === "Not now" && gone && again && again2 === "Done" && !p.errs.length,
        "up " + up + ", button " + button + ", gone " + gone + ", again " + again + " (" + again2 + "), stored " + second);
}

/* C25 — the bell: coordinator alerts turned on from here, under the name signed in */
if (want("C25")) {
  const p = await page(env);
  /* A phone that can take alerts, and has never opened the driver app: no
     service worker yet, so the bell has to register one. */
  await p.pg.addInitScript(() => {
    const sub = { endpoint: "https://push.example/coord-phone",
                  toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "x", auth: "y" } }; } };
    let have = null;
    const reg = { active: {}, pushManager: { getSubscription: async () => have, subscribe: async () => { have = sub; return sub; } } };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
      getRegistration: async () => window.__reg || null,
      register: async (url, o) => { window.__registered = url + " " + (o && o.scope); window.__reg = reg; return reg; } } });
    if (!window.PushManager) window.PushManager = function () {};
    try { Object.defineProperty(Notification, "permission", { get: () => window.__perm || "default", configurable: true }); } catch (e) {}
    Notification.requestPermission = async () => { window.__perm = "granted"; return "granted"; };
  });
  await p.pg.reload({ waitUntil: "domcontentloaded" });
  await p.wait(400);
  const hiddenSignedOut = await p.pg.$eval("#barBell", (el) => el.hidden);
  await p.signIn(PIN);
  const shown = !(await p.pg.$eval("#barBell", (el) => el.hidden));
  await p.pg.click("#barBell");
  await p.wait(1500);
  const first = await p.text("#toast");
  const row = db._one("SELECT role, driver FROM push_subs WHERE endpoint=?", "https://push.example/coord-phone");
  const registered = await p.pg.evaluate(() => window.__registered || "");
  const on = await p.pg.$eval("#barBell", (el) => el.classList.contains("on"));
  await p.shot("C25-bell-on");
  await p.pg.click("#barBell");
  await p.wait(1500);
  const second = await p.text("#toast");
  const test = db._one("SELECT v FROM settings WHERE k=?", "test:https://push.example/coord-phone");
  await p.ctx.close();
  check("C25", "the bell is there once signed in, turns coordinator alerts on for this phone under the signed-in name, and a second tap sends a test",
        hiddenSignedOut && shown && /alerts are on/i.test(first) && row && row.role === "driver" && row.driver === "Bro Arthur" &&
        /^\.\.\/sw\.js \.\.\/$/.test(registered) && on && /test alert/i.test(second) && !!test && !p.errs.length,
        "hidden before sign-in " + hiddenSignedOut + ", shown " + shown + ", first '" + first + "', row " + JSON.stringify(row) +
        ", registered '" + registered + "', on " + on + ", second '" + second + "', test " + !!test + ", errors " + JSON.stringify(p.errs));
}

/* C20b — a PIN handed over that is wrong is still refused by the driver app */
if (want("C20b")) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e.message)));
  await pg.route("**://fonts.googleapis.com/**", (r) => r.abort());
  await pg.route("**://fonts.gstatic.com/**", (r) => r.abort());
  await pg.route("**://script.google.com/**", (r) => r.abort());
  await pg.route("**://*.workers.dev/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    const res = await W.default.fetch(new Request(req.url(), { method: req.method(),
      body: req.method() === "POST" ? req.postData() : undefined }), env, { waitUntil: () => {} });
    await route.fulfill({ status: res.status, contentType: "application/json", body: await res.text(),
                          headers: { "access-control-allow-origin": "*" } });
  });
  await pg.addInitScript(`try { if (!window.name) { window.name = "handed";
      sessionStorage.setItem("fleet.hand.v1", JSON.stringify({ name: "Bro Arthur", pin: "9999", at: Date.now() })); } } catch (e) {}`);
  await pg.goto("http://127.0.0.1:" + PORT + "/", { waitUntil: "domcontentloaded" });
  await pg.waitForTimeout(3500);
  const onDriver = await pg.$eval("#s-driver", (el) => el.classList.contains("is-on")).catch(() => false);
  const onVehicle = await pg.$eval("#s-vehicle", (el) => el.classList.contains("is-on")).catch(() => false);
  const pinOk = await pg.evaluate(() => typeof st !== "undefined" && st.pinOk);
  await pg.screenshot({ path: OUT + "/C20b-wrong-pin.png" });
  check("C20b", "a wrong PIN handed over is refused: the driver app stays on the name screen and does not open the check",
        onDriver && !onVehicle && !pinOk && !errs.length,
        "driver " + onDriver + ", vehicle " + onVehicle + ", pinOk " + pinOk + ", errors " + JSON.stringify(errs));
  await ctx.close();
}

/* C26 — turned on its side, it asks to be turned upright, as the driver app does */
if (want("C26")) {
  const p = await page(env);
  const shown = () => p.pg.$eval(".upright", (el) => getComputedStyle(el).display !== "none").catch(() => false);
  const upright = await shown();
  await p.pg.setViewportSize({ width: 844, height: 390 });
  await p.wait(300);
  const side = await shown();
  await p.shot("C26-sideways");
  check("C26", "on its side the page says Turn your phone upright; upright it does not",
        !upright && side && !p.errs.length, "upright " + upright + ", sideways " + side + ", errors " + JSON.stringify(p.errs));
  await p.ctx.close();
}

/* C27 — back from the driver app on a Home Screen iPhone, the bar clears the status bar.
   Safari says the top safe area is nothing on the way back; the page puts back
   the inset it measured when it was right. Chromium has no inset, so it stands
   in for the way back, and a page not on the Home Screen is left alone. */
if (want("C27")) {
  const run = async (standalone, kept) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on("pageerror", (e) => errs.push(String(e.message)));
    await pg.route("**://*.workers.dev/**", (r) => r.abort());
    await pg.route("**://fonts.g*/**", (r) => r.abort());
    await pg.addInitScript(`try { localStorage.setItem("coord.install.v1", "1"); } catch (e) {}`);
    if (standalone) await pg.addInitScript(`Object.defineProperty(Navigator.prototype, "standalone", { get: () => true });`);
    if (kept) await pg.addInitScript(`try { localStorage.setItem("coord.safeTop.v1", "${kept}"); } catch (e) {}`);
    await pg.goto("http://127.0.0.1:" + PORT + "/coord/", { waitUntil: "load" });
    await pg.waitForTimeout(300);
    const pad = await pg.$eval(".bar", (el) => getComputedStyle(el).paddingTop);
    await ctx.close();
    return { pad, errs };
  };
  const back = await run(true, 47), browserTab = await run(false, 47), never = await run(true, 0);
  check("C27", "on the Home Screen with the inset gone, the bar is pushed down by the one last measured; in a browser tab, or with none kept, it is not",
        back.pad === "47px" && browserTab.pad === "0px" && never.pad === "0px" && ![...back.errs, ...browserTab.errs, ...never.errs].length,
        "home screen " + back.pad + ", tab " + browserTab.pad + ", none kept " + never.pad);
}

/* C28 — Have a look: the bus link to send on WhatsApp, and reminders only after asking */
if (want("C28")) {
  const p = await page(env);
  await p.signIn(PIN);
  await p.pg.click('#homeBody [data-go="look"]');
  await p.wait(300);
  await p.pg.click('#lookBody [data-go="report/link"]');
  await p.wait(300);
  const wa = await p.pg.$eval('#reportBody a[href^="https://wa.me/"]', (el) => el.getAttribute("href")).catch(() => "");
  const shown = await p.pg.$eval("#reportBody", (el) => el.textContent).catch(() => "");
  await p.shot("C28-bus-link");
  const text = decodeURIComponent(wa.replace("https://wa.me/?text=", ""));
  await p.pg.goBack();
  await p.wait(300);
  const asked = [];
  p.pg.on("request", (r) => { if (/workers\.dev/.test(r.url()) && /"report"/.test(r.postData() || "")) asked.push(r.postData()); });
  await p.pg.click('#lookBody [data-do="remind"]');
  await p.wait(300);
  const title = await p.pg.$eval("#sheetTitle", (el) => el.textContent).catch(() => "");
  const beforeSend = asked.length;
  await p.shot("C28-remind-asks");
  await p.pg.click("#sheetNot");
  await p.wait(200);
  check("C28", "Bus link for this Sunday gives the passenger page to send on WhatsApp; Send duty reminders asks before anything is sent",
        /\/sunday\/$/.test(text.split(" ").pop()) && /Book your seat/.test(text) && shown.indexOf("/sunday/") !== -1 &&
        title === "Send the duty reminders due today?" && beforeSend === 0 && !p.errs.length,
        "whatsapp '" + text + "', sheet '" + title + "', asked " + beforeSend + ", errors " + JSON.stringify(p.errs));
  await p.ctx.close();
}

/* C29 — Buses: each bus's four dates, and an MOT recorded moves its date at once */
if (want("C29")) {
  const p = await page(env);
  await p.signIn(PIN);
  const menu = await p.text("#homeBody .menu");
  await p.pg.click('#homeBody [data-go="buses"]');
  await p.wait(300);
  const list = await p.text("#busesBody");
  await p.shot("C29a-buses");
  await p.pg.click('#busesBody [data-go="bus/YS70%20PWE"]');
  await p.wait(300);
  const before = await p.text("#busBody .card");
  await p.pg.click('#busBody [data-do="vlog"]');
  await p.wait(250);
  await p.tapText("MOT", "#vlWhat");
  const preview = await p.text("#vlNext");
  await p.pg.fill("#vlMiles", "45,180");
  await p.pg.fill("#vlGarage", "Walton Garage");
  await p.pg.locator("#vlDefs label", { hasText: "Nearside rear tyre" }).locator("input").click();
  await p.shot("C29b-record-mot");
  const expect = W.rnNextDue("mot", CAL, DAY(10), "");
  const uk = (k) => k.slice(8, 10) + "/" + k.slice(5, 7) + "/" + k.slice(0, 4);
  await p.go();
  await p.settle();
  await p.wait(400);
  const after = await p.text("#busBody .card");
  const acts = db._rows("SELECT kind, body FROM coord_actions WHERE kind='vlog'");
  const body = acts.length ? JSON.parse(acts[0].body) : {};
  const wide = await p.pg.evaluate(() => document.documentElement.scrollWidth);
  await p.shot("C29c-bus-after");
  check("C29", "Buses shows each bus's dates; an MOT recorded is worked out before Save, kept, and shown at once",
        /Buses/.test(menu) && /2 jobs to arrange/.test(menu) && /YS70 PWE/.test(list) && /overdue/.test(list) &&
        before.indexOf(uk(DAY(10))) !== -1 && preview.indexOf("Next due " + uk(expect.next)) !== -1 && !/kept its date/.test(preview) &&
        after.indexOf(uk(expect.next)) !== -1 && body.miles === 45180 && body.garage === "Walton Garage" &&
        (body.defects || []).length === 1 && wide <= 390 && !p.errs.length,
        "menu '" + menu + "', list '" + list.slice(0, 120) + "', preview '" + preview + "', after '" + after.slice(0, 120) +
        "', body " + JSON.stringify(body).slice(0, 200) + ", width " + wide + ", errors " + JSON.stringify(p.errs));
  await p.ctx.close();
}

/* C30 — an entry put right: a correction, with the date worked out again */
if (want("C30")) {
  const p = await page(env);
  await p.signIn(PIN);
  await p.pg.evaluate(() => { location.hash = "bus/YS70%20PWE"; });
  await p.wait(400);
  await p.pg.click('#busBody [data-do="vfix"][data-id="S-YS70PWE-service"]');
  await p.wait(250);
  const day = W.rnAddDays(CAL, -3);
  await p.pg.fill("#vfDay", day);
  await p.pg.dispatchEvent("#vfDay", "change");
  const preview = await p.text("#vfNext");
  await p.pg.fill("#vfWhy", "The real date from the invoice");
  await p.shot("C30a-correct");
  await p.go();
  await p.settle();
  await p.wait(400);
  const acts = db._rows("SELECT body FROM coord_actions WHERE kind='vfix'");
  const body = acts.length ? JSON.parse(acts[0].body) : {};
  const next = W.rnAddMonths(day, 12);
  const uk = (k) => k.slice(8, 10) + "/" + k.slice(5, 7) + "/" + k.slice(0, 4);
  const card = await p.text("#busBody .card");
  const struck = await p.pg.$$eval("#busBody .vlog.gone", (els) => els.length);
  await p.shot("C30b-corrected");
  check("C30", "Correct: the new day gives a new next due date, the old entry stays struck through",
        preview.indexOf(uk(next)) !== -1 && body.corrects === "S-YS70PWE-service" && body.next === next &&
        body.why === "The real date from the invoice" && card.indexOf(uk(next)) !== -1 && struck >= 1 && !p.errs.length,
        "preview '" + preview + "', body " + JSON.stringify(body).slice(0, 200) + ", card '" + card.slice(0, 160) + "', struck " + struck);
  await p.ctx.close();
}

/* C31 — a job from the walkaround, marked done */
if (want("C31")) {
  const p = await page(env);
  await p.signIn(PIN);
  await p.pg.evaluate(() => { location.hash = "bus/YS70%20PWE"; });
  await p.wait(400);
  await p.pg.click('#busBody [data-do="job"][data-job="Screenwash"]');
  await p.wait(250);
  const title = await p.pg.$eval("#sheetTitle", (el) => el.textContent).catch(() => "");
  await p.go();
  await p.settle();
  await p.wait(400);
  const left = await p.pg.$$eval('#busBody [data-do="job"]', (els) => els.map((e) => e.getAttribute("data-job")));
  const acts = db._rows("SELECT body FROM coord_actions WHERE kind='job'");
  await p.shot("C31-job-done");
  check("C31", "a job the walkaround asked for is marked done and leaves the list",
        title === "Screenwash" && JSON.stringify(left) === JSON.stringify(["Tyre pressures"]) && acts.length === 1 && !p.errs.length,
        "title '" + title + "', left " + JSON.stringify(left) + ", acts " + acts.length);
  await p.ctx.close();
}

/* C32 — a defect's trail: every status it has had, a reopening included */
if (want("C32")) {
  const p = await page(env);
  await p.signIn(PIN);
  await p.pg.evaluate(() => { location.hash = "defects"; });
  await p.wait(400);
  const summary = await p.text("#defectsBody details.trail summary");
  /* Opened only if it is there, so a page without it fails this check
     rather than stopping the run. */
  await p.pg.click("#defectsBody details.trail summary", { timeout: 3000 }).catch(() => {});
  await p.wait(200);
  const trail = await p.text("#defectsBody details.trail");
  await p.shot("C32-defect-trail");
  check("C32", "a defect shows every status it has been given, by whom and where",
        /What has happened to it \(2\)/.test(summary) && /Open → Monitoring/.test(trail) && /Status: Monitoring → Open/.test(trail) && /Blades on order/.test(trail) &&
        /Bro Arthur/.test(trail) && /On the Defects tab/.test(trail) && !p.errs.length,
        "summary '" + summary + "', trail '" + trail + "'");
  await p.ctx.close();
}

/* C33 — the sign-in opens on the logo with no bar, as the passenger page and
   the driver app do; signed in, the bar says Coordinator over who it is. */
if (want("C33")) {
  const p = await page(env);
  const look = () => p.pg.evaluate(() => {
    const bar = document.querySelector(".bar");
    const brand = document.querySelector("#s-sign .brand");
    return { bar: !!(bar && getComputedStyle(bar).display !== "none" && bar.getBoundingClientRect().height > 0),
             brand: !!(brand && brand.offsetParent !== null),
             eyebrow: (document.querySelector("#s-sign .eyebrow") || {}).textContent || "",
             title: document.getElementById("barTitle").textContent, sub: document.getElementById("barSub").textContent };
  });
  const signin = await look();
  await p.shot("C33a-sign-in");
  await p.signIn(PIN);
  const home = await look();
  await p.shot("C33b-home");
  check("C33", "the sign-in opens on the logo with no bar over it; signed in, the bar is Coordinator over who it is",
        !signin.bar && signin.brand && signin.eyebrow === "Coordinator" &&
        home.bar && home.title === "Coordinator" && home.sub === "Bro Arthur" && !p.errs.length,
        JSON.stringify({ signin, home, errors: p.errs }));
  await p.ctx.close();
}

/* ---- v1.90.0, the tidy-up ------------------------------------------------- */

const screenIs = (p) => p.pg.evaluate(() => (document.querySelector(".screen.is-on") || {}).id || "");
/* A check that cannot finish, because what it taps is not there, is a failed
   check and not a crashed run: the sabotages need to see it fail. */
const stopped = (id, e) => check(id, "could not finish", false, String((e && e.message) || e).split("\n")[0]);
const back = async (p) => { await p.pg.click("#barBack"); await p.wait(450); };

/* C34 — the row of Sundays stays under the bar while the list scrolls */
if (want("C34")) {
  const p = await page(env);
  await p.signIn(PIN);
  try {
    await p.pg.evaluate((k) => { location.hash = "runs/" + k; }, LAST);
    await p.wait(900);
    const pin = () => p.pg.evaluate(() => {
      const bar = document.querySelector(".bar").getBoundingClientRect();
      const chips = document.querySelector("#runsBody .chips");
      return chips ? { gap: Math.round(chips.getBoundingClientRect().top - bar.bottom), y: window.scrollY,
                       lit: (chips.querySelector(".on") || {}).textContent || "" } : null;
    });
    const top = await pin();
    await p.pg.evaluate(() => window.scrollTo(0, 700));
    await p.wait(300);
    const down = await pin();
    await p.shot("C34-dates-stay");
    await p.pg.evaluate((k) => { location.hash = "bookings/" + k; }, NEXT);
    await p.wait(900);
    const bk = await p.pg.evaluate(() => { const c = document.querySelector("#bookingsBody .chips");
                                           return c ? getComputedStyle(c).position : ""; });
    check("C34", "on the Run record and Bookings, the row of Sundays stays under the bar while the list scrolls",
          top && down && down.y > 300 && Math.abs(down.gap) <= 2 && down.lit && bk === "sticky" && !p.errs.length,
          JSON.stringify({ top, down, bookings: bk, errors: p.errs }));
  } catch (e) { stopped("C34", e); }
  await p.ctx.close();
}

/* C35 — however many Sundays were looked at, one Back leaves the screen */
if (want("C35")) {
  const p = await page(env);
  await p.signIn(PIN);
  try {
    await p.pg.click('#homeBody [data-go^="bookings/"]');
    await p.wait(700);
    for (const k of [TODAY, NEXT, TODAY, NEXT]) { await p.pg.click('#bookingsBody .chips [data-go="bookings/' + k + '"]'); await p.wait(500); }
    const lit = await p.pg.$eval("#bookingsBody .chips .on", (b) => b.getAttribute("data-go")).catch(() => "");
    await back(p);
    const afterBookings = await screenIs(p);
    await p.pg.click('#homeBody [data-go="runs"]');
    await p.wait(900);
    const dates = await p.pg.$$eval("#runsBody .chips button", (bs) => bs.map((b) => b.getAttribute("data-go")));
    for (let i = 0; i < 4; i++) { const g = dates[i % dates.length]; await p.pg.click('#runsBody .chips [data-go="' + g + '"]'); await p.wait(600); }
    /* And the phone's own back gesture, which is the browser's. */
    await p.pg.goBack(); await p.wait(450);
    const afterRuns = await screenIs(p);
    check("C35", "five Sundays looked at on Bookings or the Run record, and one Back still leaves the screen",
          lit === "bookings/" + NEXT &&
          afterBookings === "s-home" && dates.length >= 1 && afterRuns === "s-home" && !p.errs.length,
          JSON.stringify({ lit, afterBookings, dates, afterRuns, errors: p.errs }));
  } catch (e) { stopped("C35", e); }
  await p.ctx.close();
}

/* C36 — the Sunday card is the way into the Rota: Back goes to the list of
   Sundays, then home; and no Rota button of its own on the first screen */
if (want("C36")) {
  const p = await page(env);
  await p.signIn(PIN);
  try {
    const menu = await p.text("#homeBody .menu");
    const rotaItem = await p.pg.$$eval('#homeBody .menu [data-go="rota"]', (x) => x.length);
    const cue = await p.text("#homeBody .sun .sun-cue");
    await p.pg.click("#homeBody .sun");
    await p.wait(500);
    const first = await screenIs(p), firstTitle = await p.text("#barTitle");
    await back(p);
    const second = await screenIs(p), list = await p.pg.$$eval("#rotaBody .sun", (x) => x.length);
    await back(p);
    const third = await screenIs(p);
    await p.shot("C36-rota-way");
    check("C36", "the Sunday card opens the Sunday; Back is the Rota list, then home; no Rota button, and What has been done",
          rotaItem === 0 && /Rota/i.test(cue) && first === "s-sunday" && firstTitle === "Rota" && second === "s-rota" &&
          list > 2 && third === "s-home" && /What has been done/.test(menu) && !/What I have done/.test(menu) && !p.errs.length,
          JSON.stringify({ rotaItem, cue, first, firstTitle, second, list, third, menu, errors: p.errs }));
  } catch (e) { stopped("C36", e); }
  await p.ctx.close();
}

/* C37 — no screen says its own name twice */
if (want("C37")) {
  const p = await page(env);
  await p.signIn(PIN);
  try {
    const seen = [];
    for (const h of ["rota", "requests", "bookings/" + NEXT, "defects", "buses", "runs/" + LAST, "look", "activity", "rehearsal",
                     "sunday/" + NEXT, "bus/YS70%20PWE"]) {
      await p.pg.evaluate((x) => { location.hash = x; }, h);
      await p.wait(700);
      await p.shot("C37-" + h.split("/")[0]);
      seen.push(await p.pg.evaluate((x) => {
        const title = document.getElementById("barTitle").textContent.trim().toLowerCase();
        const scr = document.querySelector(".screen.is-on");
        const hs = Array.prototype.map.call(scr ? scr.querySelectorAll("h1") : [], (e) => e.textContent.trim().toLowerCase());
        return { at: x, title, twice: hs.filter((t) => t === title).length, h1: hs.length };
      }, h));
    }
    const twice = seen.filter((x) => x.twice);
    const sunday = seen.find((x) => /^sunday/.test(x.at)), bus = seen.find((x) => /^bus\//.test(x.at));
    check("C37", "no screen says its own name twice; the Sunday keeps its date and the bus its plate",
          !twice.length && sunday.h1 === 1 && bus.h1 === 1 && seen.find((x) => x.at === "activity").title === "what has been done" &&
          !p.errs.length, JSON.stringify({ twice, seen, errors: p.errs }));
  } catch (e) { stopped("C37", e); }
  await p.ctx.close();
}

/* C38 — the Run record: seats booked and no tap stand out; nobody booked does not */
if (want("C38")) {
  const p = await page(env);
  await p.signIn(PIN);
  try {
    await p.pg.evaluate((k) => { location.hash = "runs/" + k; }, LAST);
    await p.wait(900);
    const row = (id) => p.pg.evaluate((x) => {
      const r = Array.prototype.find.call(document.querySelectorAll("#runsBody .ev"),
        (e) => ((e.querySelector(".sid") || {}).textContent || "") === x);
      return r ? { cls: r.className, text: r.textContent.replace(/\s+/g, " ").trim(),
                   add: ((r.querySelector("button") || {}).textContent || "").trim() } : null;
    }, id);
    const s03 = await row("S03"), s02 = await row("S02"), s05 = await row("S05"), n01 = await row("N01");
    const numbered = await p.pg.$$eval("#runsBody .ev", (rs) => rs.filter((r) => r.querySelector(".sid")).length);
    await p.shot("C38-run-record-booked");
    check("C38", "on the Run record a booked stop with no tap says so in amber; a stop nobody booked is quiet; each by its number",
          s03 && /missed/.test(s03.cls) && /2 seats booked, not marked/.test(s03.text) && /add/i.test(s03.add) &&
          s02 && /quiet/.test(s02.cls) && /nobody booked/.test(s02.text) && !/missed/.test(s02.cls) && /add/i.test(s02.add) &&
          s05 && /then Old Place by the Park/.test(s05.text) && /1 seat booked, not marked/.test(s05.text) &&
          n01 && !/miss/.test(n01.cls) && numbered >= 14 && !p.errs.length,
          JSON.stringify({ s03, s02, s05, n01, numbered, errors: p.errs }));
  } catch (e) { stopped("C38", e); }
  await p.ctx.close();
}

/* C39 — one fault on two walkarounds is one card, closed in one go */
if (want("C39")) {
  const p = await page(env);
  await p.signIn(PIN);
  try {
    await p.pg.evaluate(() => { location.hash = "defects"; });
    await p.wait(600);
    const cards = await p.pg.$$eval("#defectsBody .def", (ds) => ds.map((d) => d.textContent.replace(/\s+/g, " ").trim()));
    const tyres = cards.filter((t) => /^Tyres/.test(t));
    await p.shot("C39a-defects-grouped");
    const card = p.pg.locator("#defectsBody .def", { hasText: "Nearside front tread low" }).first();
    await card.locator('[data-do="defect"]').click();
    await p.wait(300);
    const ticks = await p.pg.$$eval("#defReps input[data-rep]", (xs) => xs.map((x) => x.checked));
    await p.pg.click('#defStates [data-state="Fixed"]');
    const all = await p.text("#sheetGo");
    await p.pg.click("#defReps input[data-rep]");
    const one = await p.text("#sheetGo");
    await p.pg.click("#defReps input[data-rep]");
    await p.pg.fill("#defDid", "Both front tyres replaced at Walton Tyres");
    await p.shot("C39b-close-all");
    await p.go();
    await p.wait(600);
    const sent = JSON.parse(db._one("SELECT body FROM coord_actions WHERE kind='defect' ORDER BY seq DESC LIMIT 1").body);
    const left = await p.pg.$$eval("#defectsBody .def", (ds) => ds.filter((d) => /^Tyres/.test(d.textContent.trim())).length);
    check("C39", "one fault reported twice is one card, with the DVSA tag and how long it has been open; Close closes both",
          tyres.length === 1 && /2 reports since/.test(tyres[0]) && /DVSA daily check/.test(tyres[0]) && /Critical/.test(tyres[0]) &&
          /open \d+ days/.test(tyres[0]) && /tread low/.test(tyres[0]) &&
          ticks.length === 2 && ticks.every(Boolean) && all === "Close all 2" && one === "Close it" &&
          sent.keys && sent.keys.length === 2 && left === 0 && !p.errs.length,
          JSON.stringify({ tyres, ticks, all, one, keys: sent.keys, left, errors: p.errs }));
  } catch (e) { stopped("C39", e); }
  await p.ctx.close();
}

/* C40 — a seat taken when its stop number was another place is marked */
if (want("C40")) {
  const p = await page(env);
  await p.signIn(PIN);
  try {
    await p.pg.evaluate((k) => { location.hash = "bookings/" + k; }, NEXT);
    await p.wait(900);
    const n06 = await p.pg.evaluate(() => {
      const r = Array.prototype.find.call(document.querySelectorAll("#bookingsBody .bs"),
        (e) => ((e.querySelector(".sid") || {}).textContent || "") === "N06");
      return r ? r.textContent.replace(/\s+/g, " ").trim() : "";
    });
    const marks = await p.pg.$$eval("#bookingsBody .moved", (ts) => ts.map((t) => t.textContent));
    const wide = await p.pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await p.shot("C40-booked-at-old-place");
    check("C40", "on Bookings each stop shows its number, and a seat taken when the number was another place says so",
          /Booked when N06 was Old Place by the Park/.test(n06) && marks.filter((t) => /Booked when/.test(t)).length === 1 &&
          !wide && !p.errs.length, JSON.stringify({ n06, marks, wide, errors: p.errs }));
  } catch (e) { stopped("C40", e); }
  await p.ctx.close();
}

check("C0", "no script error on the page throughout", me && !me.errs.length, JSON.stringify(me && me.errs));
if (me) await me.ctx.close();
await done();
cleanup(ROOT);
const bad = results.filter((r) => !r.ok);
console.log("\n  " + results.length + " checks, " + (results.length - bad.length) + " passed, " + bad.length + " failed");
process.exit(bad.length ? 1 : 0);
