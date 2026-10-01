/* THE COORDINATOR'S TIDY-UP, AND THE STOP BEHIND A NUMBER.
   pages v1.90.0 · server w2.31.0 · sheet v1.93.0.

   - One card per fault on the Defects screen, and one Close for every report
     of it, on the live server and on the sheet.
   - The DVSA tag, held to the driver app's own list.
   - The Run record tells "booked, not marked" from "nobody booked", by stop
     number, and says what a number was called that morning if it is called
     something else now.
   - A stop is its number. When the place behind a number changes after a
     seat was taken there, History says so, the sheet says so at once, Is
     everything working? lists it, and the passenger's page asks.

   Everything here fails on w2.30.1 / v1.92.0. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab } from "../lib/tabs.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const THU = "2026-10-01T12:00:00+01:00";          /* the Sunday ahead is 4 October */
const AFTER = "2026-10-04T11:40:00+01:00";        /* after the runs */
const KEY = "2026-10-04", LAST = "2026-09-27", EARLIER = "2026-09-13";
const PIN = "1234";

function cutBlock(src, at, file, name) {
  if (at === -1) throw new Error(file + " has no " + name);
  let depth = 0;
  for (let j = src.indexOf("{", at); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (!depth) return src.slice(at, j + 1); }
  }
  throw new Error(name + " in " + file + " has no closing brace");
}
/* Named functions and vars cut out of the coordinator's page as it ships. */
function fromCoord(root, vars, fns) {
  const file = "coord/index.html";
  const src = readFileSync(join(root, file), "utf8");
  const parts = vars.map((v) => {
    const at = src.indexOf("var " + v + " = ");
    const open = src[src.indexOf("=", at) + 2];
    const close = open === "[" ? "];" : "};";
    return src.slice(at, src.indexOf(close, at) + 2);
  }).concat(fns.map((n) => cutBlock(src, src.indexOf("function " + n + "("), file, n)));
  const ctx = vm.createContext({ String, Number, Math, Date, JSON, Object, Array });
  new vm.Script(parts.join("\n"), { filename: file }).runInContext(ctx);
  return ctx;
}

export default async function (root) {
  const s = new Suite("the coordinator's tidy-up, and the stop behind a number");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());
  const C = fromCoord(root, ["DVSA_ITEMS", "DEF_RANK"], ["isDvsa", "defectGroups"]);

  /* ---- the live server ---------------------------------------------------- */

  async function fresh(defects) {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
      .bind("Bro Arthur", "Coordinator", "North", 1, await W.pinHashOf(env, "Bro Arthur", PIN)).run();
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    if (defects) {
      for (const d of defects) d.key = W.defectKeyOf(d);
      const openDefects = {};
      for (const d of defects) (openDefects[d.reg] = openDefects[d.reg] || []).push(
        { reg: d.reg, item: d.item, crit: d.crit, note: d.found, kind: d.kind, date: d.date, checkId: d.checkId, status: d.status });
      await W.cachePut(env, "coord_shelf", { builtAt: Date.now(), readAt: Date.now(), requests: [], defects }).run();
      await W.cachePut(env, "cache_rota", { builtAt: Date.now(), from: "2026-07-12", to: "2028-09-24",
        payload: { ok: true, rows: [], openDefects } }).run();
    }
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const coord = async (env, body) => J(await post(env, Object.assign({ action: "coord", who: "Bro Arthur", pin: PIN }, body)));
  let n = 0;
  const act = (env, a) => coord(env, { op: "act", act: Object.assign({ id: "tidy-act-" + (++n) }, a) });
  const seat = (db, key, stopId, stop, seats, status) => db.prepare(
    "INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received, synced) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,1)").bind(key, stopId.charAt(0) === "S" ? "South" : "North", stopId, stop, seats,
    "dev-" + stopId + "-" + seats, "", "", status || "Booked", Date.now()).run();

  const TYRES = () => [
    { checkId: "chk-0", reg: "YS70 PWE", date: EARLIER, driver: "Bro Trevor", item: "Tyres", crit: true,
      found: "Nearside front wearing fast", status: "Monitoring", action: "", kind: "Defect" },
    { checkId: "chk-1", reg: "YS70 PWE", date: LAST, driver: "Bro Adrian", item: "Tyres", crit: false,
      found: "Nearside front tread low", status: "Open", action: "", kind: "Defect" },
    { checkId: "chk-1", reg: "YS70 PWE", date: LAST, driver: "Bro Adrian", item: "First aid kit", crit: false,
      found: "Not on board", status: "Open", action: "", kind: "Defect" }];

  /* ---- one card per fault ------------------------------------------------- */

  s.test("the coordinator's DVSA list is the driver app's, item for item", (a) => {
    const app = readFileSync(join(root, "index.html"), "utf8");
    const ids = Object.keys(vm.runInNewContext("(" + /var DVSA_DAILY = (\{[\s\S]*?\});/.exec(app)[1] + ")"));
    const names = ids.map((id) => (new RegExp("\\{ id:\"" + id + "\"[^}]*?name:\"([^\"]+)\"").exec(app) || [])[1]);
    a.ok(names.length > 20 && names.every(Boolean), "the driver app's DVSA items could not be read: " + names.join(", "));
    a.eq(JSON.stringify([...C.DVSA_ITEMS].sort()), JSON.stringify(names.slice().sort()),
         "the coordinator's DVSA tag and the driver app's checklist disagree");
    a.ok(C.isDvsa(" first aid KIT ") && !C.isDvsa("Radio and dash display"));
  });

  s.test("repeated reports of one fault are one card: the heaviest weight, the newest words, the least settled status", (a) => {
    const d = TYRES().map((x) => Object.assign(x, { key: W.defectKeyOf(x) }));
    d.push({ checkId: "chk-2", reg: "NH56 FWP", date: LAST, item: "tyres ", crit: false, found: "Other bus", status: "Open",
             kind: "Defect", key: "other" });
    const g = C.defectGroups(d);
    a.eq(g.length, 3, "a fault on another bus, or another fault, was folded in");
    const t = g.find((x) => x.reg === "YS70 PWE" && x.item === "Tyres");
    a.eq(t.reports.length, 2);
    a.eq(t.keys.length, 2);
    a.ok(t.crit, "a critical report two weeks old was hidden behind this week's");
    a.eq(t.status, "Open", "Monitoring and Open together must read as Open");
    a.eq(t.found, "Nearside front tread low", "not the newest words");
    a.eq(t.oldest, EARLIER);
    a.ok(t.dvsa, "Tyres is on DVSA's daily walkaround");
  });

  s.test("one Close on the live server closes every report named, and every phone loses them at once", async (a) => {
    await atTime(THU, async () => {
      const defs = TYRES();
      const { db, env } = await fresh(defs);
      const keys = [defs[0].key, defs[1].key];
      const out = await act(env, { kind: "defect", key: keys[0], keys, status: "Fixed", action: "Both front tyres replaced" });
      a.ok(out.ok, JSON.stringify(out));
      a.has(out.action.words, "(2 reports)");
      const row = db._one("SELECT body FROM coord_actions ORDER BY seq DESC LIMIT 1");
      a.eq(JSON.parse(row.body).keys.length, 2, "the sheet would be told about one of them");
      const left = await W.coordDefectsView(env);
      a.eq(left.map((x) => x.item).join(","), "First aid kit", "a report of the closed fault is still open");
      const pub = (await W.cachedRota(env, KEY, 1)).openDefects || {};
      a.eq((pub["YS70 PWE"] || []).map((x) => x.item).join(","), "First aid kit",
           "the driver app would still say Still open on this bus");
    });
  });

  s.test("a report that is not open is refused, and nothing is closed", async (a) => {
    await atTime(THU, async () => {
      const defs = TYRES();
      const { env } = await fresh(defs);
      const out = await act(env, { kind: "defect", keys: [defs[0].key, "chk-9|YS70 PWE|Tyres|2026-09-06"],
                                   status: "Fixed", action: "Replaced" });
      a.not(out.ok);
      a.eq((await W.coordDefectsView(env)).length, 3);
      const mixed = await act(env, { kind: "defect", keys: [defs[0].key, defs[2].key], status: "Monitoring", action: "" });
      a.ok(mixed.ok, "two faults on one bus can still be set together if he ticks them: " + JSON.stringify(mixed));
    });
  });

  /* ---- the sheet: every report, its own History line ------------------------ */

  function sheet(o) {
    o = o || {};
    const day = (y, m, d) => new Date(y, m - 1, d);
    const tabs = {
      "Bus Stops": tab("Bus Stops", o.stops || [
        { Route: "North", "Stop ID": "N00", Time: "09:52", Stop: "Church", Active: "YES", Type: "Depart" },
        { Route: "North", "Stop ID": "N01", Time: "10:03", Stop: "Scarisbrick Drive", Active: "YES", Type: "Pickup" },
        { Route: "North", "Stop ID": "N02", Time: "10:15", Stop: "Grace Road", Active: "YES", Type: "Pickup" },
        { Route: "North", "Stop ID": "N03", Time: "10:24", Stop: "Bedford Road by Stuart Hotel", Active: "YES", Type: "Pickup" },
        { Route: "North", "Stop ID": "N09", Time: "11:00", Stop: "Church", Active: "YES", Type: "Arrival" }]),
      "Bus Bookings": tab("Bus Bookings", o.bookings || [
        { Received: day(2026, 9, 29), Sunday: day(2026, 10, 4), Route: "North", "Stop ID": "N03",
          Stop: "Bedford Road by Stuart Hotel", Seats: 2, Device: "dev-a", Status: "Booked", Phone: "", "Passenger ID": "p-a" },
        { Received: day(2026, 9, 20), Sunday: day(2026, 9, 27), Route: "North", "Stop ID": "N03",
          Stop: "Bedford Road by Stuart Hotel", Seats: 1, Device: "dev-b", Status: "Booked", Phone: "", "Passenger ID": "p-b" }]),
      "Defects": tab("Defects", [
        { Received: day(2026, 9, 13), "Check ID": "chk-0", Date: day(2026, 9, 13), Registration: "YS70 PWE", Driver: "Bro Trevor",
          Item: "Tyres", Critical: "YES", "What the driver found": "Nearside front wearing fast", Status: "Monitoring", Kind: "Defect" },
        { Received: day(2026, 9, 27), "Check ID": "chk-1", Date: day(2026, 9, 27), Registration: "YS70 PWE", Driver: "Bro Adrian",
          Item: "Tyres", Critical: "NO", "What the driver found": "Nearside front tread low", Status: "Open", Kind: "Defect" }])
    };
    const L = loadCodeGs(root, { tabs, props: { PIN_SALT: "salt" } });
    L.toasts = [];
    L.gas.ss.toast = (m, t) => { L.toasts.push(String(t || "") + ": " + String(m || "")); };
    return L;
  }
  const ss = (L) => L.gas.ss;
  const objs = (L, name) => {
    const sh = ss(L).getSheetByName(name);
    const g = sh ? sh.getDataRange().getValues() : [];
    return g.slice(1).map((r) => { const o = {}; g[0].forEach((h, i) => { o[h] = r[i]; }); return o; });
  };
  const A = (id, kind, body) => ({ id, kind, sunday: "", by: "Bro Arthur", made: Date.now(), body });

  s.test("the sheet closes every report named, each with its own History line", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      const k0 = "chk-0|YS70 PWE|Tyres|2026-09-13", k1 = "chk-1|YS70 PWE|Tyres|2026-09-27";
      const out = call(L, "applyCoordAction", ss(L),
        A("d1", "defect", { key: k0, keys: [k0, k1], reg: "YS70 PWE", item: "Tyres", status: "Fixed", action: "Both replaced" }), {});
      a.ok(out.done && out.ok, JSON.stringify(out));
      a.eq(objs(L, "Defects").map((d) => d.Status).join(","), "Fixed,Fixed");
      const h = objs(L, "History").filter((x) => /^Defect: Tyres/.test(x["What changed"]) && x.To === "Fixed");
      a.eq(h.length, 2, "one History line for two reports: " + JSON.stringify(objs(L, "History")));
      a.eq(h.map((x) => x.From).sort().join(","), "Monitoring,Open", "each line says what that report was");
    });
  });

  s.test("one report gone from the sheet is said, and the rest are still closed", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      const k1 = "chk-1|YS70 PWE|Tyres|2026-09-27";
      const out = call(L, "coordDefect", ss(L), A("d2", "defect", {}),
        { keys: [k1, "chk-x|YS70 PWE|Tyres|2026-09-06"], status: "Fixed", action: "Replaced" }, "Bro Arthur");
      a.not(out.ok);
      a.has(out.result, "1 of 2");
      a.eq(objs(L, "Defects")[1].Status, "Fixed");
    });
  });

  /* ---- the Run record ----------------------------------------------------- */

  s.test("the Run record says what was booked at each stop number, and an untapped stop with seats stands out", async (a) => {
    await atTime(AFTER, async () => {
      const { db, env } = await fresh();
      await seat(db, KEY, "N02", "Grace Rd", 2);
      await seat(db, KEY, "N02", "Grace Rd", 1);
      await seat(db, KEY, "N03", "Litherland Rd", 3, "Cancelled");
      await seat(db, KEY, "N04", "Fountains Rd", 4, "rehearsal");
      const t0 = Date.parse("2026-10-04T09:52:00+01:00");
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian", reg: "YS70 PWE", sunday: KEY,
        events: [{ event: "start", at: t0 }, { event: "pickup", stopId: "N01", at: t0 + 11 * 60000 }] });
      const runs = await coord(env, { op: "runs", sunday: KEY });
      const st = runs.routes.find((r) => r.route === "North").runs[0].stops;
      const by = (id) => st.find((x) => x.id === id);
      a.ok(by("N01").ev, "the tapped stop lost its tap");
      a.eq(by("N02").booked, 3, "two bookings at N02 are three seats");
      a.eq(by("N02").ev, null);
      a.eq(by("N03").booked, 0, "a cancelled seat was counted");
      a.eq(by("N04").booked, 0, "a rehearsal seat was counted on a real run");
    });
  });

  s.test("a stop number that was another place that morning says what it was then", async (a) => {
    await atTime(AFTER, async () => {
      const { db, env } = await fresh();
      await seat(db, KEY, "N04", "Old Fountains Road", 1);
      const t0 = Date.parse("2026-10-04T09:52:00+01:00");
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian", reg: "YS70 PWE", sunday: KEY,
        events: [{ event: "start", at: t0 }, { event: "pickup", stopId: "N05", at: t0 + 40 * 60000 }] });
      /* The coordinator then edits the place behind N05. */
      db._exec("UPDATE stops SET stop='Westminster Rd' WHERE stop_id='N05'");
      const runs = await coord(env, { op: "runs", sunday: KEY });
      const st = runs.routes.find((r) => r.route === "North").runs[0].stops;
      a.eq(st.find((x) => x.id === "N05").then, "Bedford Rd", "the tap's own place was lost");
      a.eq(st.find((x) => x.id === "N05").stop, "Westminster Rd");
      a.eq(st.find((x) => x.id === "N04").then, "Old Fountains Road", "the seat's own place was lost");
      a.eq(st.find((x) => x.id === "N03").then, "", "a stop with nothing that morning was given a past");
    });
  });

  /* ---- the passenger's page ------------------------------------------------ */

  s.test("a seat at a number whose place has changed is told so, and keeping it clears it", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      const phone = "07700900123";
      const made = await J(await W.handleBooking(env, { date: KEY, ref: "dev1", phone, stopId: "N03", seats: 2 }));
      a.ok(made.ok, JSON.stringify(made));
      const pid = await W.passengerId(env, phone);
      const before = await W.busPayload(env, KEY, "dev1", pid);
      a.eq(before.stopMoved, null, "a seat at an unchanged stop was told it had moved");
      db._exec("UPDATE stops SET stop='Westminster Road' WHERE stop_id='N03'");
      const after = await W.busPayload(env, KEY, "dev1", pid);
      a.ok(after.stopMoved, "nothing told him his stop is another place now");
      a.eq(after.stopMoved && after.stopMoved.id, "N03");
      a.eq(after.stopMoved && after.stopMoved.was, "Litherland Rd");
      a.eq(after.stopMoved && after.stopMoved.now, "Westminster Road");
      a.eq(after.mine && after.mine.stopId, "N03", "the seat itself must stay, by number");
      /* Only spacing and capitals: not a change. */
      db._exec("UPDATE stops SET stop='  litherland   RD ' WHERE stop_id='N03'");
      a.eq((await W.busPayload(env, KEY, "dev1", pid)).stopMoved, null, "a tidied name read as a new place");
      db._exec("UPDATE stops SET stop='Westminster Road' WHERE stop_id='N03'");
      const kept = await J(await W.handleBooking(env, { date: KEY, ref: "dev1", phone, stopId: "N03", seats: 2 }));
      a.ok(kept.ok, JSON.stringify(kept));
      a.eq((await W.busPayload(env, KEY, "dev1", pid)).stopMoved, null, "keeping it did not take the notice away");
    });
  });

  /* ---- the sheet: History, the toast, Is everything working? ----------------- */

  s.test("the place behind a number edited on the sheet goes on History, and seats booked at the old place are said at once", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      a.eq(call(L, "stopsAudit", ss(L), "On the Bus Stops tab", "").length, 0, "the first look should only take a copy");
      const sh = ss(L).getSheetByName("Bus Stops");
      const head = sh.getDataRange().getValues()[0];
      const row = 1 + sh.getDataRange().getValues().findIndex((r) => r[head.indexOf("Stop ID")] === "N03");
      const cell = sh.getRange(row, head.indexOf("Stop") + 1);
      cell.setValue("Westminster Road by Leighton Street");
      call(L, "onEdit", { range: cell, oldValue: "Bedford Road by Stuart Hotel", value: "Westminster Road by Leighton Street" });
      const h = objs(L, "History").find((x) => x["What changed"] === "Stop N03: the place");
      a.ok(h, "no History line: " + JSON.stringify(objs(L, "History")));
      a.eq(h && h.From, "Bedford Road by Stuart Hotel");
      a.eq(h && h.To, "Westminster Road by Leighton Street");
      a.has(h && h.Why, "2 seats booked when it was Bedford Road by Stuart Hotel");
      a.hasnt(h && h.Why, "27/09/2026", "a Sunday that has gone was counted");
      a.eq(L.toasts.length, 1, "the person editing was not told");
      a.has(L.toasts[0] || "", "N03");
      /* A time moved is written down too, and says nothing about seats. */
      const tcell = sh.getRange(row, head.indexOf("Time") + 1);
      tcell.setValue("10:27");
      call(L, "onEdit", { range: tcell, oldValue: "10:24", value: "10:27" });
      const t = objs(L, "History").find((x) => x["What changed"] === "Stop N03: time");
      a.eq(t && t.From, "10:24");
      a.eq(L.toasts.length, 1, "a time change raised the seats again");
    });
  });

  s.test("Is everything working? lists a seat at an old place until it is dealt with", async (a) => {
    await atTime(THU, async () => {
      const L = sheet({ stops: [
        { Route: "North", "Stop ID": "N03", Time: "10:24", Stop: "Westminster Road by Leighton Street", Active: "YES", Type: "Pickup" }] });
      const good = [], bad = [], todo = [];
      call(L, "stopsHealth", ss(L), good, bad, todo);
      a.eq(todo.length, 1, JSON.stringify(todo));
      a.has(todo[0] || "", "04/10/2026, N03: 2 seats booked when it was Bedford Road by Stuart Hotel");
      const ok = sheet();
      const g2 = [], b2 = [], t2 = [];
      call(ok, "stopsHealth", ss(ok), g2, b2, t2);
      a.eq(t2.length, 0);
      a.has(g2.join(" "), "every seat for the coming Sundays is at the place its stop number names");
    });
  });

  s.test("the sheet's own answer to the passenger page carries the same notice", async (a) => {
    await atTime(THU, async () => {
      const L = sheet({ stops: [
        { Route: "North", "Stop ID": "N03", Time: "10:24", Stop: "Westminster Road by Leighton Street", Active: "YES", Type: "Pickup" }] });
      const out = call(L, "busPayload", KEY, "dev-a", "p-a");
      a.ok(out.mine, "the seat went: " + JSON.stringify(out).slice(0, 300));
      a.eq(out.stopMoved && out.stopMoved.was, "Bedford Road by Stuart Hotel");
      a.eq(out.stopMoved && out.stopMoved.now, "Westminster Road by Leighton Street");
    });
  });

  return s;
}
