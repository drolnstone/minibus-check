/* THE 27 SEPTEMBER RULINGS: THE RECORD, THE CLOCK AND THE ESTIMATE.

   One check per ruling, or per fault found while carrying one out. Every one
   of them fails on pages v1.74.10 / server w2.15.0 / sheet v1.79.0 and passes
   on this release. Run it against the old release with
   MINIBUS_ROOT=../v1.74.10-w2.15.0 to see them go red.

     2   the Sedley Street cancellation, and the rest of that race
     9   sheet edits reach the live server now
     10  phone activity knocks on the sheet's door
     11  the Worker's own clock
     4, 5 the estimate kept for a late bus and past its time
     1   alerts follow the number */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday, seedBookings } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { TABS, tab, row } from "../lib/tabs.mjs";

const KEY = "2026-09-27";
const SAT = "2026-09-26T11:00:00+01:00";
const SHEET = "https://script.google.com/macros/s/TEST/exec";

export default async function (root) {
  const s = new Suite("the 27 September rulings: the record, the clock and the estimate");
  const net = installGlobals();
  const { mod } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  async function fresh(over) {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY, over);
    return { db, env };
  }
  const setting = (db, k, v) =>
    db.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
      .bind(k, JSON.stringify(v)).run();
  const sub = (db, endpoint, ref, pid) =>
    db.prepare("INSERT INTO push_subs (endpoint, role, ref, pid, made) VALUES (?, 'passenger', ?, ?, 0)")
      .bind(endpoint, ref, pid || "").run();
  const pushesTo = (prefix) => net.calls.filter((c) => c.url.indexOf(prefix) === 0);
  const knocks = () => net.calls.filter((c) => c.url === SHEET);

  /* ================================================ 2. SEDLEY STREET */

  s.test("a cancellation made while a drain is writing reaches the next drain (Sedley Street)", async (a) => {
    await atTime(SAT, async () => {
      const { env } = await fresh();
      await mod.handleBooking(env, { date: KEY, ref: "dev1", phone: "07700900123", stopId: "S03", seats: 2 });
      const d = await J(await mod.handleDrain(env, { limit: 300 }));
      a.eq(d.bookings.length, 1);
      a.eq(d.bookings[0].status, "Booked");
      /* The passenger cancels while Apps Script is still writing that copy. */
      await mod.handleBooking(env, { date: KEY, ref: "dev1", phone: "07700900123", stopId: "", seats: 0 });
      await mod.handleDrained(env, { claim: d.claim, bookings: d.bookings.map((b) => b.id) });
      const again = await J(await mod.handleDrain(env, { limit: 300 }));
      a.eq(again.bookings.length, 1, "the cancelled row was marked done and would never reach the sheet");
      a.eq(again.bookings[0].status, "Cancelled");
    });
  });

  s.test("a row nothing has touched since the drain is marked done, stamp and all", async (a) => {
    await atTime(SAT, async () => {
      const { env } = await fresh();
      await mod.handleBooking(env, { date: KEY, ref: "dev1", phone: "07700900123", stopId: "S03", seats: 2 });
      const d = await J(await mod.handleDrain(env, { limit: 300 }));
      await mod.handleDrained(env, { claim: d.claim, bookings: d.bookings.map((b) => b.id) });
      const again = await J(await mod.handleDrain(env, { limit: 300 }));
      a.eq(again.bookings.length, 0, "an unchanged row came round again");
    });
  });

  s.test("a drain that never confirms leaves its rows for the next one", async (a) => {
    await atTime(SAT, async () => {
      const { env } = await fresh();
      await mod.handleBooking(env, { date: KEY, ref: "dev1", phone: "07700900123", stopId: "S03", seats: 2 });
      await J(await mod.handleDrain(env, { limit: 300 }));
      const again = await J(await mod.handleDrain(env, { limit: 300 }));
      a.eq(again.bookings.length, 1, "a claimed row that was never confirmed was lost");
    });
  });

  s.test("an Undo made while a drain is writing reaches the next drain", async (a) => {
    await atTime("2026-09-27T10:10:00+01:00", async () => {
      const { env } = await fresh();
      const at = Date.now();
      await mod.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian", reg: "YS70 PWE",
        sunday: KEY, events: [{ event: "start", at: at - 600000 }, { event: "picked", stopId: "N01", at: at - 60000 }] });
      const d = await J(await mod.handleDrain(env, { limit: 300 }));
      a.eq(d.trips.length, 2);
      await mod.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian", sunday: KEY,
        events: [{ event: "undo", undoes: "picked", stopId: "N01", at: at }] });
      await mod.handleDrained(env, { claim: d.claim, trips: d.trips.map((t) => t.id) });
      const again = await J(await mod.handleDrain(env, { limit: 300 }));
      const undone = again.trips.find((t) => t.stop_id === "N01");
      a.ok(undone && undone.status === "Undone", "the Undo was marked done without reaching the sheet");
    });
  });

  s.test("a second authorisation of the same bus is not marked filed on the first one's word", async (a) => {
    const { db, env } = await fresh();
    await setting(db, "auth:2026-09-27:YS70 PWE", { reg: "YS70 PWE", at: 2000, via: "app", checkId: "c2" });
    await mod.handleDrained(env, { claim: -1, auths: [{ key: "auth:2026-09-27:YS70 PWE", at: 1000 }] });
    const v = JSON.parse((await db.prepare("SELECT v FROM settings WHERE k=?").bind("auth:2026-09-27:YS70 PWE").first()).v);
    a.not(v.filed, "the newer authorisation was marked filed and the sheet will never show it");
  });

  /* ======================================== 9. BOOKINGS EDITED ON THE SHEET */

  s.test("a booking struck out by hand on the sheet leaves the driver's list", async (a) => {
    await atTime(SAT, async () => {
      const { db, env } = await fresh();
      await mod.handleBooking(env, { date: KEY, ref: "dev1", phone: "07700900123", stopId: "S03", seats: 2 });
      const id = (await db.prepare("SELECT id FROM bookings").first()).id;
      await db.prepare("UPDATE bookings SET synced=1").run();
      const out = await J(await mod.handleSheetBookings(env, { edits: [{ id, status: "Cancelled", seats: 2 }] }));
      a.ok(out.ok && out.results[0].applied);
      const board = await mod.boardPayload(env, "South");
      a.not(board.counts.S03, "the seat is still on the driver's list");
      const r = await db.prepare("SELECT status, synced FROM bookings WHERE id=?").bind(id).first();
      a.eq(r.status, "Cancelled");
      a.eq(Number(r.synced), 0, "left pending, so the drain writes the Worker's copy back onto the tab");
    });
  });

  s.test("a Status word of the coordinator's own is left alone", async (a) => {
    await atTime(SAT, async () => {
      const { db, env } = await fresh();
      await mod.handleBooking(env, { date: KEY, ref: "dev1", phone: "07700900123", stopId: "S03", seats: 2 });
      const id = (await db.prepare("SELECT id FROM bookings").first()).id;
      const out = await J(await mod.handleSheetBookings(env, { edits: [{ id, status: "Rang, running late", seats: 2 }] }));
      a.not(out.results[0].applied, "an unknown word was taken, and the drain would write Booked over it");
    });
  });

  /* ================================================ 10. THE KNOCK */

  s.test("a booking from a phone knocks on the sheet's door after the phone has its answer", async (a) => {
    await atTime(SAT, async () => {
      const { db, env } = await fresh();
      await setting(db, "sheet_url", { url: SHEET });
      net.reset();
      net.reply(new Response(JSON.stringify({ ok: true, ran: true }), { status: 200 }));
      const waits = [];
      const ctx = { waitUntil: (p) => waits.push(p) };
      const res = await mod.default.fetch(new Request("https://worker.test/", {
        method: "POST",
        body: JSON.stringify({ action: "booking", booking: { date: KEY, ref: "dev1", phone: "07700900123", stopId: "S03", seats: 2 } })
      }), env, ctx);
      a.ok((await J(res)).ok, "the booking itself failed");
      a.eq(waits.length, 1, "nothing was sent to the sheet after the booking");
      await Promise.all(waits);
      const k = knocks();
      a.eq(k.length, 1, "the sheet was not asked to drain");
      a.eq(JSON.parse(k[0].opts.body).action, "drainnow");
      const poke = JSON.parse((await db.prepare("SELECT v FROM settings WHERE k='poke'").first()).v);
      a.eq(poke.ok, true);
    });
  });

  s.test("a stop tap and a walkaround knock as well", async (a) => {
    await atTime("2026-09-27T10:10:00+01:00", async () => {
      const { db, env } = await fresh();
      await setting(db, "sheet_url", { url: SHEET });
      net.reset();
      const waits = [];
      const ctx = { waitUntil: (p) => waits.push(p) };
      const post = (body) => mod.default.fetch(new Request("https://worker.test/", {
        method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, ctx);
      await post({ action: "trip", trip: { trip: "t1", route: "North", driver: "Bro Adrian", sunday: KEY,
        events: [{ event: "start", at: Date.now() - 60000 }] } });
      await post({ action: "check", check: { id: "chk1", reg: "YS70 PWE", level: "ok", driver: "Bro Adrian" } });
      a.eq(waits.length, 2);
      await Promise.all(waits);
    });
  });

  s.test("the clock knocks again while something is still waiting, and backs off from a sheet that is not answering", async (a) => {
    await atTime(SAT, async () => {
      const { db, env } = await fresh();
      await setting(db, "sheet_url", { url: SHEET });
      net.reset();
      a.eq(await mod.pokeIfWaiting(env), false, "knocked with nothing waiting");
      a.eq(knocks().length, 0);

      await mod.handleBooking(env, { date: KEY, ref: "dev1", phone: "07700900123", stopId: "S03", seats: 2 });
      await setting(db, "poke", { at: Date.now() - 10000, ok: true });
      await mod.pokeIfWaiting(env);
      a.eq(knocks().length, 0, "knocked again ten seconds after a knock that was answered");

      await setting(db, "poke", { at: Date.now() - 120000, ok: false });
      await mod.pokeIfWaiting(env);
      a.eq(knocks().length, 0, "knocked two minutes after a knock that was not answered");

      await setting(db, "poke", { at: Date.now() - 6 * 60000, ok: false });
      net.reply(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      await mod.pokeIfWaiting(env);
      a.eq(knocks().length, 1, "never tried again after the back-off");

      await setting(db, "poke", { at: Date.now() - 60000, ok: true });
      net.reply(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      await mod.pokeIfWaiting(env);
      a.eq(knocks().length, 2, "a row still waiting a minute after an answered knock was left for the five minute drain");
    });
  });

  /* ================================================ 11. THE CLOCK */

  async function morning(db) {
    await seedBookings(db, KEY, [{ route: "North", stopId: "N01", seats: 2 }]);
    await sub(db, "https://push.test/a", "dev-N01", "pid-N01");
  }

  s.test("the Worker's own clock sends the morning message on the minute", async (a) => {
    await atTime("2026-09-27T07:30:00+01:00", async () => {
      const { db, env } = await fresh();
      await morning(db);
      net.reset();
      a.eq(typeof (mod.default && mod.default.scheduled), "function", "the Worker has no clock to be woken by");
      await mod.default.scheduled({ cron: "* * * * *", scheduledTime: Date.now() }, env, { waitUntil() {} });
      a.eq(pushesTo("https://push.test/").length, 1, "07:30 on the clock sent nothing");
      a.ok(await mod.clockAlive(env));
    });
  });

  s.test("with the clock running, the drain leaves the sweeps to it", async (a) => {
    await atTime("2026-09-27T07:31:00+01:00", async () => {
      const { db, env } = await fresh();
      await morning(db);
      await setting(db, "clock", { at: Date.now() - 20000 });
      net.reset();
      await mod.handleDrain(env, { limit: 300 });
      a.eq(pushesTo("https://push.test/").length, 0, "the drain swept while the clock was running");
    });
  });

  s.test("with no clock, the drain still sends the timed messages", async (a) => {
    await atTime("2026-09-27T07:31:00+01:00", async () => {
      const { db, env } = await fresh();
      await morning(db);
      net.reset();
      await mod.handleDrain(env, { limit: 300 });
      a.eq(pushesTo("https://push.test/").length, 1, "a Worker without its Cron Trigger went silent");
    });
  });

  s.test("two sweeps cannot both send the same tag", async (a) => {
    const { db, env } = await fresh();
    await sub(db, "https://push.test/b", "r", "p");
    const row = await db.prepare("SELECT * FROM push_subs WHERE endpoint=?").bind("https://push.test/b").first();
    await db.prepare("UPDATE push_subs SET last='morn|x' WHERE id=?").bind(row.id).run();
    net.reset();
    /* The row as a sweep read it before the other one claimed the tag. */
    const sent = await mod.wake(env, [Object.assign({}, row, { last: "" })], "morn|x");
    a.eq(sent, 0, "a tag another sweep had already claimed was sent again");
  });

  /* ================================================ 4, 5. THE ESTIMATE */

  async function passengerAt(db, stopId) {
    await seedBookings(db, KEY, [{ route: "North", stopId: stopId, seats: 1, device: "me", pid: "pid-me" }]);
  }

  s.test("a bus fifty minutes behind still gets an estimate", async (a) => {
    await atTime("2026-09-27T10:45:00+01:00", async () => {
      const { db, env } = await fresh();
      await passengerAt(db, "N02");
      /* Timetabled out of church at 09:52, out at 10:42. */
      await mod.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian", sunday: KEY,
        events: [{ event: "start", at: Date.parse("2026-09-27T10:42:00+01:00") }] });
      const p = await mod.tripPayload(env, "me", "", "", "pid-me");
      a.eq(p.mine, "eta", "no estimate for a bus fifty minutes behind, got " + p.mine);
      a.eq(p.offset, 50);
    });
  });

  s.test("a cap on how far behind comes back as a setting", async (a) => {
    await atTime("2026-09-27T10:45:00+01:00", async () => {
      const { db, env } = await fresh();
      await passengerAt(db, "N02");
      await setting(db, "eta_rules", { dwellSeconds: 75, skipSaves: 0.8, speedMph: 18, maxSkipMinutes: 6,
                                       maxBehindMinutes: 45, keepMinutes: 15 });
      await mod.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian", sunday: KEY,
        events: [{ event: "start", at: Date.parse("2026-09-27T10:42:00+01:00") }] });
      const p = await mod.tripPayload(env, "me", "", "", "pid-me");
      a.eq(p.mine, "wild");
    });
  });

  s.test("an estimate stays up after its time has passed with the stop unmarked", async (a) => {
    /* Grace Rd marked at 10:20, five behind. Litherland Rd is timetabled 10:24,
       so the estimate is 10:29, and at 10:34 it is five minutes gone. */
    await atTime("2026-09-27T10:34:00+01:00", async () => {
      const { db, env } = await fresh();
      await passengerAt(db, "N03");
      await mod.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian", sunday: KEY,
        events: [{ event: "start", at: Date.parse("2026-09-27T09:55:00+01:00") },
                 { event: "picked", stopId: "N02", at: Date.parse("2026-09-27T10:20:00+01:00") }] });
      const p = await mod.tripPayload(env, "me", "", "", "pid-me");
      a.eq(p.mine, "eta", "the estimate was dropped five minutes after its time, got " + p.mine);
      a.ok(p.minutes < -2);

      await setting(db, "eta_rules", { dwellSeconds: 75, skipSaves: 0.8, speedMph: 18, maxSkipMinutes: 6,
                                       maxBehindMinutes: 0, keepMinutes: 3 });
      const q = await mod.tripPayload(env, "me", "", "", "pid-me");
      a.eq(q.mine, "quiet", "keepMinutes is not the setting that decides it");
    });
  });

  /* ================================================ 1. ALERTS FOLLOW THE NUMBER */

  s.test("alerts turned on before a number was given follow that number to a booking made on another phone", async (a) => {
    await atTime(SAT, async () => {
      const { db, env } = await fresh();
      await sub(db, "https://push.test/phone", "devA", "");
      await mod.handleIdentify(env, { phone: "07700900999", ref: "devA" });
      await mod.handleBooking(env, { date: KEY, ref: "devB", phone: "07700900999", stopId: "N02", seats: 1 });
      const subs = await mod.subsAtStop(env, KEY, "N02");
      a.ok(subs.some((x) => x.endpoint === "https://push.test/phone"),
           "the phone with alerts on will not be told about the booking made for its number");
    });
  });

  s.test("a phone that books with a number moves its alerts to that number", async (a) => {
    await atTime(SAT, async () => {
      const { db, env } = await fresh();
      await sub(db, "https://push.test/p2", "devC", "old-pid");
      await mod.handleBooking(env, { date: KEY, ref: "devC", phone: "07700900555", stopId: "N02", seats: 1 });
      const pid = await mod.passengerId(env, "07700900555");
      const r = await db.prepare("SELECT pid FROM push_subs WHERE endpoint='https://push.test/p2'").first();
      a.eq(r.pid, pid);
    });
  });

  /* ================================================ THE SHEET'S SIDE */

  const SUN = new Date(2026, 8, 27);
  function sheet(over, props) {
    const tabs = {
      "Bus Stops": tab("Bus Stops", [
        { Route: "South", "Stop ID": "S00", Time: "10:21", Stop: "Church, Chester Road", Postcode: "L6 4DY", Active: "YES", Type: "Depart" },
        { Route: "South", "Stop ID": "S03", Time: "10:37", Stop: "Sedley Street (St Andrew Road) bus stop, Breck Road", Postcode: "L4 2RB", Active: "YES", Type: "Pickup" },
        { Route: "South", "Stop ID": "S08", Time: "11:00", Stop: "Church, Chester Road", Postcode: "L6 4DY", Active: "YES", Type: "Arrival" }]),
      "Drivers": tab("Drivers", [
        { Name: "Bro Arthur", Role: "Coordinator", Active: "YES", "Primary order": 1, PIN: "1234", Email: "arthur@b.c", Route: "North" },
        { Name: "Bro Trevor", Role: "Driver", Active: "YES", "Primary order": 2, PIN: "4321", Email: "t@b.c", Route: "South" }]),
      "Buses": tab("Buses", [
        { Registration: "YS70 PWE", "Seats for passengers": 16, Active: "YES" },
        { Registration: "NH56 FWP", "Seats for passengers": 14, Active: "YES" }]),
      "Rota": tab("Rota", [{ Sunday: SUN, "North Liverpool scheduled": "Bro Arthur", "North bus": "YS70 PWE",
        Status: "Confirmed", "South Liverpool scheduled": "Bro Trevor", "South bus": "NH56 FWP" }]),
      "Checks": [TABS["Checks"]], "Defects": [TABS["Defects"]], "Trip Events": [TABS["Trip Events"]],
      "Bus Bookings": [TABS["Bus Bookings"]], "Rota Requests": [TABS["Rota Requests"]]
    };
    return loadCodeGs(root, { tabs: Object.assign(tabs, over || {}),
      props: Object.assign({ COORDINATOR_EMAIL: "coord@b.c", PIN_SALT: "salt", WORKER_URL: "https://worker.test" }, props || {}) });
  }

  /* The live server, as Code.gs meets it: one answer per action. */
  function worker(L, answers) {
    const sent = [];
    L.ctx.UrlFetchApp = {
      fetch(url, opts) {
        const body = JSON.parse((opts && opts.payload) || "{}");
        sent.push(body);
        const fn = answers[body.action];
        const out = typeof fn === "function" ? fn(body) : (fn || { ok: true });
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(out), getAllHeaders: () => ({}) };
      }
    };
    return sent;
  }
  const oneBooking = (over) => Object.assign({ id: 7, sunday: KEY, route: "South", stop_id: "S03", stop: "Sedley Street",
    seats: 2, device: "dev1", pid: "pid1", phone: "07700900123", status: "Booked", received: Date.now(), note: "" }, over || {});
  const drainWith = (list, claim) => ({ ok: true, claim: claim, bookings: list, trips: [], checks: [], auths: [], decisions: [] });

  s.test("the drain sends its stamp back with the rows it wrote", (a) => {
    const L = sheet();
    const sent = worker(L, { drain: drainWith([oneBooking()], -55) });
    call(L, "drainFromWorker");
    const done = sent.find((b) => b.action === "drained");
    a.ok(done, "nothing was confirmed");
    a.eq(done.claim, -55, "the stamp did not go back, so a row changed mid-drain is marked done");
    a.same(done.bookings, [7]);
  });

  s.test("a new row is confirmed only once it is on the tab", (a) => {
    const L = sheet();
    const sh = L.gas.ss.getSheetByName("Bus Bookings");
    const orig = sh.getRange.bind(sh);
    sh.getRange = (r, c, nr, nc) => {
      const rg = orig(r, c, nr, nc);
      if (typeof r === "number" && r > sh.getLastRow()) rg.setValues = () => { throw new Error("Service Spreadsheets failed"); };
      return rg;
    };
    const sent = worker(L, { drain: drainWith([oneBooking()], -56) });
    call(L, "drainFromWorker");
    const done = sent.find((b) => b.action === "drained");
    a.ok(!done || (done.bookings || []).indexOf(7) === -1,
         "a row that never reached the tab was confirmed, so it is never sent again");
  });

  s.test("a column the coordinator added keeps its value when the drain rewrites the row", (a) => {
    const head = TABS["Bus Bookings"].concat(["My note"]);
    const r1 = row("Bus Bookings", { Sunday: KEY, Route: "South", "Stop ID": "S03", Stop: "Sedley Street",
      Seats: 2, Status: "Booked", "Live ID": 7 }).concat(["rang Saturday"]);
    const L = sheet({ "Bus Bookings": [head, r1] });
    worker(L, { drain: drainWith([oneBooking({ status: "Cancelled" })], -57) });
    call(L, "drainFromWorker");
    const sh = L.gas.ss.getSheetByName("Bus Bookings");
    a.eq(sh.getRange(2, head.indexOf("Status") + 1).getValue(), "Cancelled");
    a.eq(sh.getRange(2, head.indexOf("My note") + 1).getValue(), "rang Saturday", "his own column was emptied");
  });

  s.test("the knock runs the drain, and a knock during a drain sends it round again", (a) => {
    const L = sheet();
    let drains = 0;
    worker(L, { drain: () => { drains++; if (drains === 1) L.gas.props.drainAgain = "1"; return drainWith([], -58); } });
    const out = JSON.parse(call(L, "doPost", { postData: { contents: JSON.stringify({ action: "drainnow", token: "minibusapp" }) } }).getContent());
    a.ok(out.ok, "the sheet does not answer a knock");
    a.eq(drains, 2, "a knock that arrived during the drain was not collected");
    a.not(L.gas.props.drainBusy, "the drain left its flag up");

    L.gas.props.drainBusy = String(Date.now());
    const busy = JSON.parse(call(L, "doPost", { postData: { contents: JSON.stringify({ action: "drainnow", token: "minibusapp" }) } }).getContent());
    a.ok(busy.ok);
    a.eq(busy.ran, false);
    a.eq(L.gas.props.drainAgain, "1", "a knock while a drain ran was dropped");
  });

  s.test("an edit on the Drivers tab reaches the live server now", (a) => {
    const L = sheet();
    const sent = worker(L, {});
    const before = Number(L.gas.props.rotaVersion || 1);
    call(L, "onEditLive", { range: L.gas.ss.getSheetByName("Drivers").getRange(2, 5) });
    a.ok(sent.some((b) => b.action === "sync"), "the edit waits for the next sync");
    a.ok(Number(L.gas.props.rotaVersion) > before, "a push that failed would wait for the hourly one");
  });

  s.test("an edit on a tab the live server does not copy sends nothing", (a) => {
    const L = sheet();
    const sent = worker(L, {});
    call(L, "onEditLive", { range: L.gas.ss.getSheetByName("Checks").getRange(2, 3) });
    a.eq(sent.length, 0);
  });

  s.test("a hand edit to a booking's Status goes to the live server, and a hand-typed row does not", (a) => {
    const L = sheet({ "Bus Bookings": tab("Bus Bookings", [
      { Sunday: KEY, Route: "South", "Stop ID": "S03", Stop: "Sedley Street", Seats: 2, Status: "Cancelled", "Live ID": 7 },
      { Sunday: KEY, Route: "South", "Stop ID": "S03", Stop: "Sedley Street", Seats: 1, Status: "Cancelled" }]) });
    const sent = worker(L, {});
    const sh = L.gas.ss.getSheetByName("Bus Bookings");
    const col = TABS["Bus Bookings"].indexOf("Status") + 1;
    call(L, "onEditLive", { range: sh.getRange(2, col, 2, 1) });
    const edit = sent.find((b) => b.action === "sheetbookings");
    a.ok(edit, "the edit never left the sheet");
    a.same(edit.edits, [{ id: 7, status: "Cancelled", seats: 2 }]);
  });

  s.test("a push records the version it read before it built the payload", (a) => {
    const L = sheet(null, { rotaVersion: "5" });
    worker(L, { sync: () => { L.gas.props.rotaVersion = "6"; return { ok: true }; } });
    call(L, "pushToWorker");
    a.eq(L.gas.props.livePushedVersion, "5", "an edit made during the push was recorded as sent");
  });

  s.test("the two new estimate settings go to the live server", (a) => {
    const L = sheet();
    const sent = worker(L, {});
    call(L, "pushToWorker");
    const sync = sent.find((b) => b.action === "sync");
    a.eq(sync.etaRules.maxBehindMinutes, 0);
    a.eq(sync.etaRules.keepMinutes, 15);
  });

  s.test("setup installs the edit trigger, and both reports look for it", (a) => {
    const code = readFileSync(join(root, "Code.gs"), "utf8");
    a.ok(/try \{ installLivePush\(\); \}/.test(code), "Set up / refresh rota does not install it");
    a.eq((code.match(/fn: "onEditLive"/g) || []).length, 2, "one of the two reports does not look for it");
  });

  return s;
}
