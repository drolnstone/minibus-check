/* A REHEARSAL, AS OFTEN AS YOU LIKE, AND CLEARED EVERY TIME.

   Until w2.20.0 a rehearsal belonged to the spreadsheet: a menu item only a
   computer could reach, a flag pushed over on the next sync, and test seats
   drawn onto the Bus Bookings tab. A phone that had made a run in one kept
   it after the rehearsal ended, so its screen stayed on a finished run and
   would not offer Start trip again; its taps stayed on the record; and a tap
   that arrived after the end was taken as real.

   From w2.20.0 the live server owns it. The coordinator's app starts one,
   starts it over and ends it; the sheet's menu asks for the same. Each start
   is a new round, and a tap says which round it was made in. Ending one, by
   hand or by the clock, deletes its seats and its taps here and tells the
   sheet to delete its own rows.

   Every check in the first part fails on w2.19.0, which had no such action,
   no rounds and no clearing up. The clear-a-Sunday checks at the end are
   older and still hold. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-10-04";                          /* the Sunday ahead of all of these */
const WED = "2026-09-30T20:00:00+01:00";           /* a Wednesday evening */
const WED_ON = "2026-09-30T20:10:00+01:00";        /* ten minutes into it */
const WED_LATE = "2026-09-30T22:01:00+01:00";      /* a minute past its two hours */
const SAT_LATE = "2026-10-03T23:00:00+01:00";      /* late on the Saturday */
const SUN_EARLY = "2026-10-04T08:30:00+01:00";     /* an hour before the cutoff */
const SUN_RUN = "2026-10-04T10:05:00+01:00";       /* the buses are out */
const SUN_AFTER = "2026-10-04T12:30:00+01:00";     /* after the backstop */
const PIN = "1234";

export default async function (root) {
  const s = new Suite("a rehearsal, owned by the live server");
  const { mod: W } = await loadWorker(root);
  const net = installGlobals();
  const SCHEMA = join(root, "server", "schema.sql");
  const J = async (r) => JSON.parse(await r.text());
  const ms = (iso) => new Date(iso).getTime();

  async function fresh() {
    const db = makeDB(SCHEMA);
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    /* A real seat, booked the ordinary way, present throughout. */
    await db.prepare(
      "INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received, synced) " +
      "VALUES (?, 'North', 'N01', 'Scarisbrick Dr', 2, 'd-real', 'p1', '07700900001', 'Booked', ?, 1)"
    ).bind(KEY, ms(WED) - 86400000).run();
    for (const d of [["Bro Asim", "Coordinator", "North", 1], ["Bro Adebola", "Driver", "North", 2],
                     ["Bro Tunde", "Driver", "South", 3]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
        .bind(d[0], d[1], d[2], d[3], await W.pinHashOf(env, d[0], PIN)).run();
    }
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    return { db, env };
  }

  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  let n = 0;
  const act = async (env, a, who, pin) => J(await post(env, {
    action: "coord", who: who || "Bro Asim", pin: pin || PIN, op: "act",
    act: Object.assign({ id: "act-" + (++n) + "-reh", kind: "rehearsal" }, a) }));
  const load = async (env) => J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN, op: "load" }));
  const tap = async (env, o) => J(await W.handleTrip(env, Object.assign(
    { route: "North", driver: "Bro Adebola", reg: "YS70 PWE", sunday: KEY }, o)));

  const seeds = (db) => db._rows("SELECT route, stop_id, seats, device FROM bookings WHERE status='Rehearsal' ORDER BY id");
  const flag = (db) => db._rows("SELECT v FROM settings WHERE k='rehearsal'");
  const notes = (db) => db._rows("SELECT * FROM coord_actions WHERE kind='rehearsal' ORDER BY seq")
    .map((r) => Object.assign({}, r, { body: JSON.parse(r.body) }));
  const stopsOn = (route) => db0Stops.filter((x) => x.route === route).length;
  const db0Stops = [];

  /* The pickup stops per route, read once from the fixture. */
  {
    const { db } = await fresh();
    for (const r of db._rows("SELECT stop_id, route, kind FROM stops WHERE kind='pickup'")) db0Stops.push(r);
  }

  /* ---- starting one ------------------------------------------------------ */

  s.test("starting one from the coordinator's app puts test seats on both routes", async (a) => {
    const { db, env } = await fresh();
    const out = await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    a.ok(out.ok, JSON.stringify(out));
    const rows = seeds(db);
    a.ok(rows.some((r) => r.route === "North"), "no test seats on North: " + JSON.stringify(rows));
    a.ok(rows.some((r) => r.route === "South"), "no test seats on South: " + JSON.stringify(rows));
    a.ok(rows.every((r) => /^rehearsal-/.test(r.device)), "a test seat that does not say so: " + JSON.stringify(rows));
    a.eq(db._rows("SELECT seats FROM bookings WHERE device='d-real'")[0].seats, 2, "the real seat was touched");
    a.eq(flag(db).length, 1, "the live server does not know a rehearsal is on");
    a.has(out.action.words, "Rehearsal started: an ordinary morning, until 22:00.");
  });

  s.test("the shape decides how full each bus is, on the bus the rota gave it", async (a) => {
    /* YS70 PWE is 16 seats on North, NH56 FWP 14 on South. */
    const band = { quiet: [0.20, 0.40], normal: [0.50, 0.80], full: [0.93, 1.00], over: [1.10, 1.35] };
    for (const shape of Object.keys(band)) {
      const { db, env } = await fresh();
      const out = await atTime(WED, () => act(env, { op: "start", shape: shape }));
      a.ok(out.ok, shape + ": " + JSON.stringify(out));
      for (const [route, bus] of [["North", 16], ["South", 14]]) {
        const got = seeds(db).filter((r) => r.route === route).reduce((t, r) => t + r.seats, 0);
        const lo = Math.round(bus * band[shape][0]), hi = Math.round(bus * band[shape][1]);
        a.ok(got >= lo && got <= hi, shape + " on " + route + ": " + got + " booked, wanted " + lo + " to " + hi);
      }
    }
  });

  s.test("every route keeps a stop nobody is booked at, so Nobody there can be rehearsed", async (a) => {
    for (const shape of ["quiet", "normal", "full", "over"]) {
      for (let i = 0; i < 4; i++) {
        const { db, env } = await fresh();
        await atTime(WED, () => act(env, { op: "start", shape: shape }));
        for (const route of ["North", "South"]) {
          const used = new Set(seeds(db).filter((r) => r.route === route).map((r) => r.stop_id)).size;
          a.ok(used > 0, shape + " booked nobody on " + route);
          a.ok(used < stopsOn(route), shape + " booked every stop on " + route);
        }
      }
    }
  });

  s.test("its seats and its start reach the sheet on the drain, like any booking", async (a) => {
    const { db, env } = await fresh();
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    const got = await atTime(WED_ON, async () => J(await W.handleDrain(env, { limit: 300 })));
    const test = (got.bookings || []).filter((b) => b.status === "Rehearsal");
    a.eq(test.length, seeds(db).length, "the Bus Bookings tab would not show the test morning");
    /* The sheet takes off what was made before a round began, so a seat
       stamped earlier than its own round would go with the last one. */
    a.ok(test.every((b) => Number(b.received) >= ms(WED)), JSON.stringify(test.map((b) => b.received)));
    const note = (got.coord || []).find((x) => x.kind === "rehearsal");
    a.ok(note, "the sheet is not told one has started");
    a.eq(note.body.op, "start");
    a.eq(note.body.round, ms(WED));
  });

  s.test("the phones are told the round and when it ends", async (a) => {
    const { env } = await fresh();
    await atTime(WED, () => act(env, { op: "start", shape: "quiet" }));
    const board = await atTime(WED_ON, () => W.tripDriverPayload(env, "North"));
    a.eq(board.rehearsal.round, ms(WED), "the driver's board: " + JSON.stringify(board.rehearsal));
    a.eq(board.rehearsal.ends, ms(WED) + 2 * 3600000);
    a.eq(board.rehearsal.shape, "quiet");
    const bus = await atTime(WED_ON, () => W.busPayload(env, KEY));
    a.eq(bus.rehearsal.round, ms(WED), "the passenger page: " + JSON.stringify(bus.rehearsal));
  });

  s.test("one started late on Saturday ends at midnight, and Sunday starts clean", async (a) => {
    const { db, env } = await fresh();
    const out = await atTime(SAT_LATE, () => act(env, { op: "start", shape: "normal" }));
    a.ok(out.ok, JSON.stringify(out));
    a.has(out.action.words, "until 00:00.");
    const board = await atTime(SAT_LATE, () => W.tripDriverPayload(env, "North"));
    a.eq(board.rehearsal.ends, ms("2026-10-04T00:00:00+01:00"), "it would run into the Sunday");
    await atTime("2026-10-04T00:01:00+01:00", () => W.clockTick(env));
    a.eq(flag(db).length, 0, "still running on the Sunday");
    a.eq(seeds(db).length, 0);
  });

  s.test("one left by an older version from a Sunday morning is over at the cutoff", async (a) => {
    /* Until w2.20.1 the cutoff was reckoned from "now", so once it had passed
       there was none left that week: a rehearsal started at 08:30 on a Sunday
       ran on to 10:30, through the real morning, holding back every
       passenger alert and tagging the real taps as a test. */
    const { db, env } = await fresh();
    await db.prepare("INSERT INTO settings (k,v) VALUES ('rehearsal',?)")
      .bind(JSON.stringify({ at: ms(SUN_EARLY), key: KEY })).run();
    const at931 = await atTime("2026-10-04T09:31:00+01:00", () => W.rehearsalOn(env));
    a.eq(at931, null, "still running at 09:31 on the Sunday");
    a.eq(flag(db).length, 0);
  });

  /* ---- a real morning is never interrupted ------------------------------- */

  s.test("none starts while a real bus is out", async (a) => {
    const { db, env } = await fresh();
    await atTime(WED, async () => {
      await tap(env, { trip: "real-1", rehearsal: 0, events: [{ event: "start", at: Date.now() - 60000 }] });
      const out = await act(env, { op: "start", shape: "normal" });
      a.eq(out.ok, false, "it started over a real run");
      a.has(out.error, "The North bus is out.");
    });
    a.eq(seeds(db).length, 0, "and drew seats anyway");
    a.eq(flag(db).length, 0);
  });

  s.test("none starts on a Sunday before noon, before the cutoff either", async (a) => {
    /* Before the cutoff is not safe: the morning message goes out then, and a
       rehearsal holds every passenger alert back. */
    const { db, env } = await fresh();
    for (const when of [SUN_EARLY, SUN_RUN]) {
      const out = await atTime(when, () => act(env, { op: "start", shape: "normal" }));
      a.eq(out.ok, false, "it started on a live morning, at " + when);
      a.has(out.error, "It is Sunday morning. A rehearsal can start from 12:00.");
    }
    a.eq(flag(db).length, 0);
    const later = await atTime(SUN_AFTER, () => act(env, { op: "start", shape: "normal" }));
    a.ok(later.ok, "and not after noon either: " + JSON.stringify(later));
  });

  s.test("a booking reminder still goes while a rehearsal runs", async (a) => {
    /* The Saturday evening one is the only reminder a booked passenger gets
       before Sunday, and Saturday evening is when a rehearsal gets run. */
    const { db, env } = await fresh();
    await db.prepare(
      "INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, driver, route, made, seen, fails, last) " +
      "VALUES ('https://push.example/x','p','a','passenger','dev-nobody','pid-nobody','','',?,0,0,'')").bind(Date.now()).run();
    await atTime("2026-10-03T18:20:00+01:00", () => act(env, { op: "start", shape: "normal" }));
    net.reset();
    const sent = await atTime("2026-10-03T18:30:00+01:00", () => W.wakeBookingReminders(env));
    a.eq(flag(db).length, 1, "no rehearsal is running, so this proves nothing");
    a.eq(sent, 1, "the reminder was held back by a test");
  });

  s.test("a real run nobody ended does not hold up the afternoon", async (a) => {
    const { env } = await fresh();
    await atTime(SUN_RUN, () => tap(env, { trip: "real-2", rehearsal: 0, events: [
      { event: "start", at: ms("2026-10-04T09:52:00+01:00") },
      { event: "picked", stopId: "N02", at: ms("2026-10-04T10:16:00+01:00") }] }));
    const out = await atTime(SUN_AFTER, () => act(env, { op: "start", shape: "normal" }));
    a.ok(out.ok, "a run forgotten at 10:16 still blocked it at 12:30: " + JSON.stringify(out));
  });

  s.test("the coordinator's first screen says why one cannot start", async (a) => {
    const { env } = await fresh();
    const out = await atTime(SUN_RUN, () => load(env));
    a.ok(out.ok, JSON.stringify(out).slice(0, 300));
    a.eq(out.rehearsal, false);
    a.has(out.rehearsalBlocked, "It is Sunday morning.");
    const wed = await atTime(WED, () => load(env));
    a.eq(wed.rehearsalBlocked, "", "blocked on a Wednesday: " + wed.rehearsalBlocked);
  });

  /* ---- rounds ------------------------------------------------------------ */

  s.test("a tap in the round that is running is a rehearsal tap", async (a) => {
    const { db, env } = await fresh();
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    const out = await atTime(WED_ON, () => tap(env, { trip: "reh-1", rehearsal: ms(WED),
      events: [{ event: "start", at: ms(WED_ON) - 60000 }, { event: "picked", stopId: "N02", at: ms(WED_ON) }] }));
    a.ok(out.ok, JSON.stringify(out));
    const rows = db._rows("SELECT status FROM trip_events WHERE trip='reh-1'");
    a.eq(rows.length, 2);
    a.ok(rows.every((r) => r.status === "Rehearsal"), JSON.stringify(rows));
  });

  s.test("a tap from a round that is over is not recorded at all", async (a) => {
    /* The phone that came back into signal after the rehearsal ended. On
       w2.19.0 its taps went on the record as a real morning. */
    const { db, env } = await fresh();
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    await atTime(WED_ON, () => act(env, { op: "end" }));
    const out = await atTime(WED_ON, () => tap(env, { trip: "reh-2", rehearsal: ms(WED),
      events: [{ event: "start", at: ms(WED) + 60000 }, { event: "picked", stopId: "N02", at: ms(WED) + 120000 }] }));
    a.ok(out.ok, "the phone must be told yes, or it will send them for ever: " + JSON.stringify(out));
    a.ok(out.rehearsalOver, "and told the round is over");
    a.eq(db._rows("SELECT id FROM trip_events").length, 0, "the taps were recorded");
  });

  s.test("a round that was started over is over too", async (a) => {
    const { db, env } = await fresh();
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    await atTime(WED_ON, () => act(env, { op: "over", shape: "full" }));
    const out = await atTime(WED_ON, () => tap(env, { trip: "reh-3", rehearsal: ms(WED),
      events: [{ event: "picked", stopId: "N02", at: ms(WED_ON) }] }));
    a.ok(out.rehearsalOver, JSON.stringify(out));
    a.eq(db._rows("SELECT id FROM trip_events").length, 0);
  });

  s.test("a real run's tap during a rehearsal is a real tap", async (a) => {
    /* The run nobody ended, closed during an afternoon rehearsal. */
    const { db, env } = await fresh();
    await atTime(SUN_RUN, () => tap(env, { trip: "real-3", rehearsal: 0, events: [
      { event: "start", at: ms("2026-10-04T09:52:00+01:00") },
      { event: "picked", stopId: "N02", at: ms("2026-10-04T10:16:00+01:00") }] }));
    /* Its last stop and its last tap are long past by 12:30, so a rehearsal may start. */
    await atTime(SUN_AFTER, () => act(env, { op: "start", shape: "normal" }));
    a.eq(flag(db).length, 1, "no rehearsal is running, so this proves nothing");
    for (const claimed of [0, undefined]) {
      await atTime(SUN_AFTER, () => tap(env, { trip: "real-3", rehearsal: claimed,
        events: [{ event: claimed === 0 ? "end" : "picked", stopId: claimed === 0 ? "" : "N04", at: ms(SUN_AFTER) + 60000 }] }));
    }
    const rows = db._rows("SELECT event, status FROM trip_events WHERE trip='real-3' ORDER BY id");
    a.not(rows.some((r) => r.status === "Rehearsal"), "a real run's tap was stored as a test: " + JSON.stringify(rows));
  });

  s.test("a start made after the rehearsal began is a test, whatever the page says", async (a) => {
    /* A phone that has not heard of the round yet, in the seconds before its
       next board answer. Its run must not land on the day's record as real. */
    const { db, env } = await fresh();
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    await atTime(WED_ON, () => tap(env, { trip: "gap-1", rehearsal: 0, events: [{ event: "start", at: ms(WED_ON) }] }));
    await atTime(WED_ON, () => tap(env, { trip: "gap-1", rehearsal: 0, events: [{ event: "picked", stopId: "N02", at: ms(WED_ON) + 60000 }] }));
    a.same(db._rows("SELECT status FROM trip_events WHERE trip='gap-1'").map((r) => r.status), ["Rehearsal", "Rehearsal"]);
    await atTime(WED_ON, () => act(env, { op: "end" }));
    a.eq(db._rows("SELECT id FROM trip_events WHERE trip='gap-1'").length, 0, "it was left on the record");
  });

  s.test("a real run is never swept, even when one of its taps was stored as a test", async (a) => {
    /* A page from before v1.79.0 names no round. Its End of a real run,
       tapped during a rehearsal, was stored as a test, and on w2.20.0 as
       first written the whole real run went with the rehearsal. */
    const { db, env } = await fresh();
    const put = (trip, event, stop, at, status) => db.prepare(
      "INSERT INTO trip_events (trip, sunday, route, driver, event, stop_id, happened, status, logged, synced) " +
      "VALUES (?, ?, 'North', 'Bro Adebola', ?, ?, ?, ?, ?, 1)").bind(trip, KEY, event, stop, at, status, at).run();
    await put("REAL-1", "start", "", ms("2026-09-30T19:00:00+01:00"), "Logged");
    await put("REAL-1", "picked", "N01", ms("2026-09-30T19:10:00+01:00"), "Logged");
    await put("REAL-1", "end", "", ms("2026-09-30T20:30:00+01:00"), "Rehearsal");
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    await atTime(WED_ON, () => act(env, { op: "end" }));
    a.eq(db._rows("SELECT id FROM trip_events WHERE trip='REAL-1'").length, 3, "a real run was deleted");
    a.not(notes(db).some((x) => (x.body.trips || []).indexOf("REAL-1") !== -1), "the sheet was told to delete it");
  });

  s.test("a tap of a test run already swept is thrown away, from any page", async (a) => {
    /* A phone out of signal when the rehearsal ended, on a page that names no
       round: its last taps would otherwise start a real run on the coming
       Sunday, shown to that morning's passengers. */
    const { db, env } = await fresh();
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    await atTime(WED_ON, () => tap(env, { trip: "old-page", events: [{ event: "start", at: ms(WED_ON) }] }));
    await atTime(WED_ON, () => act(env, { op: "end" }));
    const out = await atTime(WED_LATE, () => tap(env, { trip: "old-page",
      events: [{ event: "picked", stopId: "N02", at: ms(WED_ON) + 120000 }, { event: "picked", stopId: "N04", at: ms(WED_ON) + 240000 }] }));
    a.ok(out.ok && out.rehearsalOver, JSON.stringify(out));
    a.eq(db._rows("SELECT id FROM trip_events WHERE trip='old-page'").length, 0, "they became a real run");
    const sun = await atTime("2026-10-04T09:40:00+01:00", () => W.tripState(env, KEY, "North", "real"));
    a.eq(sun.started + Object.keys(sun.served).length, 0, "the real Sunday shows a bus that is not out: " + JSON.stringify(sun));
  });

  s.test("a page from before v1.79.0, which names no round, is judged the old way", async (a) => {
    const { db, env } = await fresh();
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    await atTime(WED_ON, () => tap(env, { trip: "old-1", events: [{ event: "start", at: ms(WED_ON) }] }));
    a.eq(db._rows("SELECT status FROM trip_events WHERE trip='old-1'")[0].status, "Rehearsal");
  });

  /* ---- starting over ----------------------------------------------------- */

  s.test("starting over is a new round, with fresh seats and none of the old taps", async (a) => {
    const { db, env } = await fresh();
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    const first = seeds(db).map((r) => r.device);
    await atTime(WED, () => tap(env, { trip: "reh-4", rehearsal: ms(WED), events: [
      { event: "start", at: ms(WED) + 60000 }, { event: "picked", stopId: "N02", at: ms(WED) + 120000 },
      { event: "end", at: ms(WED) + 300000 }] }));
    const out = await atTime(WED_ON, () => act(env, { op: "over", shape: "quiet" }));
    a.ok(out.ok, JSON.stringify(out));
    a.has(out.action.words, "Rehearsal started over: a quiet morning, until 22:10.");
    a.eq(db._rows("SELECT id FROM trip_events").length, 0, "the last round's run is still on the record");
    const now = seeds(db).map((r) => r.device);
    a.ok(now.length > 0, "no seats for the new round");
    a.not(now.some((d) => first.indexOf(d) !== -1), "the old round's seats are still there");
    a.eq(JSON.parse(flag(db)[0].v).at, ms(WED_ON));
    const board = await atTime(WED_ON, () => W.tripDriverPayload(env, "North"));
    a.eq(board.started, 0, "the driver's board still shows the old round's run");
  });

  s.test("as many rounds as you like, with no limit and nothing piling up", async (a) => {
    const { db, env } = await fresh();
    for (let i = 0; i < 6; i++) {
      const at = "2026-09-30T20:" + String(i * 5).padStart(2, "0") + ":00+01:00";
      const out = await atTime(at, () => act(env, { op: i ? "over" : "start", shape: "normal" }));
      a.ok(out.ok, "round " + (i + 1) + ": " + JSON.stringify(out));
      await atTime(at, () => tap(env, { trip: "reh-r" + i, rehearsal: ms(at), events: [
        { event: "start", at: ms(at) + 1000 }, { event: "picked", stopId: "N02", at: ms(at) + 2000 },
        { event: "end", at: ms(at) + 3000 }] }));
      const trips = db._rows("SELECT DISTINCT trip FROM trip_events").map((r) => r.trip);
      a.same(trips, ["reh-r" + i], "round " + (i + 1) + " sees another round's run");
    }
    const devices = seeds(db).map((r) => r.device.split("-").pop());
    a.eq(new Set(devices).size, 1, "seats from more than one round: " + devices.join(" "));
  });

  /* ---- ending ------------------------------------------------------------ */

  async function midRehearsal() {
    const { db, env } = await fresh();
    /* A real run on the same Sunday, over before the rehearsal began, which
       must survive everything. */
    await atTime(WED, () => tap(env, { trip: "real-9", rehearsal: 0, route: "South", driver: "Bro Tunde",
      events: [{ event: "start", at: ms(WED) - 1200000 }, { event: "end", at: ms(WED) - 600000 }] }));
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    await atTime(WED_ON, () => tap(env, { trip: "reh-9", rehearsal: ms(WED), events: [
      { event: "start", at: ms(WED) + 60000 }, { event: "picked", stopId: "N02", at: ms(WED) + 120000 },
      { event: "picked", stopId: "N03", at: ms(WED) + 180000 }] }));
    /* One stop tap taken back: the row loses the word Rehearsal. */
    await atTime(WED_ON, () => tap(env, { trip: "reh-9", rehearsal: ms(WED), events: [
      { event: "undo", undoes: "picked", stopId: "N03", at: ms(WED) + 200000 }] }));
    return { db, env };
  }

  s.test("ending one takes its seats and its taps off the live server, and nothing else", async (a) => {
    const { db, env } = await midRehearsal();
    a.eq(db._rows("SELECT id FROM trip_events WHERE trip='reh-9'").length, 3, "the fixture is wrong");
    const out = await atTime(WED_ON, () => act(env, { op: "end" }));
    a.ok(out.ok, JSON.stringify(out));
    a.eq(out.action.words, "Rehearsal ended.");
    a.eq(seeds(db).length, 0, "test seats left behind");
    a.eq(db._rows("SELECT id FROM trip_events WHERE trip='reh-9'").length, 0, "test taps left behind, the taken-back one included");
    a.eq(db._rows("SELECT id FROM trip_events WHERE trip='real-9'").length, 2, "a real tap went with them");
    a.eq(db._rows("SELECT id FROM bookings WHERE device='d-real'").length, 1, "a real seat went with them");
    a.eq(flag(db).length, 0);
    const board = await atTime(WED_ON, () => W.tripDriverPayload(env, "North"));
    a.eq(board.rehearsal, false, "the phones still think one is on");
  });

  s.test("and the sheet is told to clear its tabs, with the runs to take off by trip", async (a) => {
    const { db, env } = await midRehearsal();
    await atTime(WED_ON, () => act(env, { op: "end" }));
    const end = notes(db).filter((x) => x.body.op === "end");
    a.eq(end.length, 1, "got " + JSON.stringify(notes(db).map((x) => x.body.op)));
    a.same(end[0].body.trips, ["reh-9"]);
    a.eq(end[0].by_name, "Bro Asim");
    a.ok(Number(end[0].synced) < 1, "it is not waiting for the sheet");
  });

  /* A passenger with a real seat at Grace Rd, alerts on. */
  async function withPassenger(db) {
    await db.prepare(
      "INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received, synced) " +
      "VALUES (?, 'North', 'N02', 'Grace Rd', 2, 'dev-N02', 'pid-N02', '', 'Booked', ?, 1)").bind(KEY, ms(WED) - 3600000).run();
    for (const [end, ref, pid] of [["https://push.example/booked", "dev-N02", "pid-N02"],
                                   ["https://push.example/noseat", "dev-none", "pid-none"]]) {
      await db.prepare(
        "INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, driver, route, made, seen, fails, last) " +
        "VALUES (?,'p','a','passenger',?,?,'','',?,0,0,'')").bind(end, ref, pid, Date.now()).run();
    }
  }

  s.test("a passenger woken during a rehearsal is told about his real seat, never the test bus", async (a) => {
    /* tripPayload describes the test while one runs: the gate is open, and a
       phone with no seat is lent a test one. A booking reminder read then
       must not come out as the test bus being due. */
    const { db, env } = await fresh();
    await withPassenger(db);
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    await atTime(WED_ON, () => tap(env, { trip: "reh-p", rehearsal: ms(WED), events: [
      { event: "start", at: ms(WED_ON) - 120000 }, { event: "picked", stopId: "N01", at: ms(WED_ON) - 60000 }] }));
    const booked = await atTime(WED_ON, () => W.pushWhat(env, "https://push.example/booked"));
    a.eq(booked.title, "You are booked for Sunday", "got " + JSON.stringify(booked));
    const none = await atTime(WED_ON, () => W.pushWhat(env, "https://push.example/noseat"));
    a.eq(none.title, "Book your seat for Sunday", "got " + JSON.stringify(none));
  });

  s.test("a route called off during a rehearsal is told when it ends, and nothing says so before", async (a) => {
    /* The checklist calls a route off during one to watch the passenger page.
       Nobody is told while it runs, a Saturday reminder read then included.
       Nor is he told he is booked, which reads as if the bus runs, and the
       route may really be off. After it ends, a route still called off is
       told on the next tick. */
    const { db, env } = await fresh();
    await withPassenger(db);
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    await db.prepare("UPDATE rota SET status='North cancelled' WHERE sunday=?").bind(KEY).run();
    net.reset();
    a.eq(await atTime(WED_ON, () => W.wakeCancelled(env)), 0, "a rehearsal let a cancellation through");
    const during = await atTime(WED_ON, () => W.pushWhat(env, "https://push.example/booked"));
    a.ok(!/No bus|booked/i.test(during.title + " " + during.body) && during.tag !== "bus",
         "a push read during it said: " + JSON.stringify(during));
    await atTime(WED_ON, () => act(env, { op: "end" }));
    a.eq(await atTime(WED_ON, () => W.wakeCancelled(env)), 1, "and it was not told after the rehearsal ended");
    const after = await atTime(WED_ON, () => W.pushWhat(env, "https://push.example/booked"));
    a.eq(after.title, "No bus to Grace Rd on Sunday", "got " + JSON.stringify(after));
  });

  s.test("the Saturday reminder waits while a rehearsal runs for a seat on a route called off", async (a) => {
    /* Called off for real, or for the checklist: nothing here can tell which.
       So a man with a seat on it is not told he is booked, which reads as if
       the bus runs. Nothing claims his reminder, so it goes in the window
       once the rehearsal is over, saying what is true then. */
    const { db, env } = await fresh();
    await withPassenger(db);
    await db.prepare("UPDATE rota SET status='North cancelled' WHERE sunday=?").bind(KEY).run();
    await atTime("2026-10-03T18:05:00+01:00", () => act(env, { op: "start", shape: "normal" }));
    net.reset();
    const sent = await atTime("2026-10-03T18:30:00+01:00", () => W.wakeBookingReminders(env));
    a.eq(flag(db).length, 1, "no rehearsal is running, so this proves nothing");
    const last = () => db._rows("SELECT last FROM push_subs WHERE endpoint='https://push.example/booked'")[0].last;
    a.eq(last(), "", "the man with a seat on the route called off was woken: " + last() + ", " + sent + " sent");
    a.eq(sent, 1, "the reminder to book, for the phone with no seat, did not go");
    await atTime("2026-10-03T18:40:00+01:00", () => act(env, { op: "end" }));
    await atTime("2026-10-03T18:45:00+01:00", () => W.wakeCancelled(env));
    await atTime("2026-10-03T18:50:00+01:00", () => W.wakeBookingReminders(env));
    a.has(last(), "booked|", "his reminder never went once the rehearsal was over");
    const said = await atTime("2026-10-03T18:50:00+01:00", () => W.pushWhat(env, "https://push.example/booked"));
    a.eq(said.title, "No bus to Grace Rd on Sunday", "got " + JSON.stringify(said));
  });

  s.test("a man already told his route is off is told the same during a rehearsal", async (a) => {
    /* Told before it began, so it was real: a rehearsal holds that message
       back, and nothing else tags a phone with it. */
    const { db, env } = await fresh();
    await withPassenger(db);
    await db.prepare("UPDATE rota SET status='North cancelled' WHERE sunday=?").bind(KEY).run();
    await atTime("2026-10-02T19:00:00+01:00", () => W.wakeCancelled(env));
    await atTime(WED.replace("09-30", "10-03"), () => act(env, { op: "start", shape: "normal" }));
    const said = await atTime("2026-10-03T20:10:00+01:00", () => W.pushWhat(env, "https://push.example/booked"));
    a.eq(flag(db).length, 1, "no rehearsal is running, so this proves nothing");
    a.eq(said.title, "No bus to Grace Rd on Sunday", "got " + JSON.stringify(said));
  });

  s.test("a whole test run that reaches the server after its round is over is thrown away", async (a) => {
    /* Out of signal for all of it, and sent once the rehearsal had ended: none
       of it was here to sweep. From a page that names no round, and from one
       that started in the seconds before it heard of the round. */
    const { db, env } = await fresh();
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    await atTime(WED_ON, () => act(env, { op: "end" }));
    const old = await atTime(WED_LATE, () => tap(env, { trip: "late-old", events: [
      { event: "start", at: ms(WED) + 60000 }, { event: "picked", stopId: "N02", at: ms(WED) + 120000 },
      { event: "picked", stopId: "N04", at: ms(WED) + 180000 }] }));
    const gap = await atTime(WED_LATE, () => tap(env, { trip: "late-gap", rehearsal: 0, events: [
      { event: "start", at: ms(WED) + 30000 }, { event: "picked", stopId: "N02", at: ms(WED) + 90000 }] }));
    a.ok(old.rehearsalOver && gap.rehearsalOver, JSON.stringify([old, gap]));
    a.eq(db._rows("SELECT id FROM trip_events WHERE trip IN ('late-old','late-gap')").length, 0, "they were recorded as real");
    const sun = await atTime("2026-10-04T09:40:00+01:00", () => W.tripState(env, KEY, "North", "real"));
    a.eq(sun.started + Object.keys(sun.served).length, 0, "the real Sunday shows a bus that is not out: " + JSON.stringify(sun));
  });

  s.test("the real Sunday morning is never taken for a test, from any page", async (a) => {
    const { db, env } = await fresh();
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    await atTime(WED_ON, () => act(env, { op: "end" }));
    await atTime(SUN_RUN, () => tap(env, { trip: "sun-new", rehearsal: 0, events: [
      { event: "start", at: ms("2026-10-04T09:52:00+01:00") }, { event: "picked", stopId: "N01", at: ms(SUN_RUN) }] }));
    await atTime(SUN_RUN, () => tap(env, { trip: "sun-old", route: "South", driver: "Bro Tunde", events: [
      { event: "start", at: ms("2026-10-04T10:16:00+01:00") }] }));
    const rows = db._rows("SELECT trip, status FROM trip_events WHERE trip IN ('sun-new','sun-old')");
    a.eq(rows.length, 3, "a real tap was thrown away: " + JSON.stringify(rows));
    a.not(rows.some((r) => r.status === "Rehearsal"), "a real tap was stored as a test: " + JSON.stringify(rows));
  });

  s.test("the rostered driver is not told to end somebody's test run", async (a) => {
    /* Sunday afternoon: the real run ended at 11:05, a coordinator is
       rehearsing North and has left his test run open past the timetable's
       arrival. The reminder to end a run is about the real one. */
    const { db, env } = await fresh();
    await db.prepare(
      "INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, driver, route, made, seen, fails, last) " +
      "VALUES ('https://push.example/d','p','a','driver','','','Bro Adebola','North',?,0,0,'')").bind(Date.now()).run();
    await atTime(SUN_RUN, () => tap(env, { trip: "real-sun", rehearsal: 0, events: [
      { event: "start", at: ms("2026-10-04T09:52:00+01:00") },
      { event: "end", at: ms("2026-10-04T11:05:00+01:00") }] }));
    await atTime("2026-10-04T12:30:00+01:00", () => act(env, { op: "start", shape: "normal" }));
    await atTime("2026-10-04T12:40:00+01:00", () => tap(env, { trip: "reh-sun", driver: "Bro Asim",
      rehearsal: ms("2026-10-04T12:30:00+01:00"), events: [{ event: "start", at: ms("2026-10-04T12:40:00+01:00") }] }));
    net.reset();
    const sent = await atTime("2026-10-04T13:20:00+01:00", () => W.wakeDrivers(env));
    a.eq(flag(db).length, 1, "no rehearsal is running, so this proves nothing");
    a.eq(sent, 0, "he was woken about a test run");
  });

  s.test("a test run inside a real Sunday morning, from before, is never cleared away", async (a) => {
    /* It may be a real run an older rehearsal tagged. Left for a person. */
    const { db, env } = await fresh();
    const put = (trip, sunday, at) => db.prepare(
      "INSERT INTO trip_events (trip, sunday, route, driver, event, stop_id, happened, status, logged, synced) " +
      "VALUES (?, ?, 'North', 'Bro Adebola', 'picked', 'N02', ?, 'Rehearsal', ?, 1)").bind(trip, sunday, at, at).run();
    await put("then-real", "2026-09-27", ms("2026-09-27T10:12:00+01:00"));
    await put("then-test", "2026-09-27", ms("2026-09-23T21:40:00+01:00"));
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    await atTime(WED_ON, () => act(env, { op: "end" }));
    a.eq(db._rows("SELECT id FROM trip_events WHERE trip='then-real'").length, 1, "a run inside a real morning was deleted");
    a.eq(db._rows("SELECT id FROM trip_events WHERE trip='then-test'").length, 0, "an ordinary old test run was kept");
    const told = notes(db).map((x) => x.body.trips || []);
    a.not(told.some((t) => t.indexOf("then-real") !== -1), "the sheet was told to delete it: " + JSON.stringify(told));
  });

  s.test("ending one that is not running clears any leftovers and says so", async (a) => {
    const { db, env } = await fresh();
    /* Rows from a rehearsal run before this version, flag long gone. */
    await db.prepare("INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, status, received, synced) " +
      "VALUES (?, 'North', 'N02', 'Grace Rd', 3, 'rehearsal-north-0-x', 'Rehearsal', 1, 1)").bind(KEY).run();
    await db.prepare("INSERT INTO trip_events (trip, sunday, route, driver, event, happened, status, logged, synced) " +
      "VALUES ('old-reh', ?, 'North', 'Bro Adebola', 'start', 1, 'Rehearsal', 1, 1)").bind("2026-09-20").run();
    const out = await atTime(WED, () => act(env, { op: "end" }));
    a.ok(out.ok, JSON.stringify(out));
    a.eq(out.action.words, "No rehearsal was running. Anything left from one was cleared.");
    a.eq(seeds(db).length, 0);
    a.eq(db._rows("SELECT id FROM trip_events").length, 0, "an old Sunday's test taps were left");
  });

  /* ---- the clock --------------------------------------------------------- */

  s.test("the clock ends one after two hours, with nobody looking", async (a) => {
    const { db, env } = await midRehearsal();
    await atTime(WED_LATE, () => W.clockTick(env));
    a.eq(flag(db).length, 0, "still running at 22:01");
    a.eq(seeds(db).length, 0);
    a.eq(db._rows("SELECT id FROM trip_events WHERE trip='reh-9'").length, 0);
    const end = notes(db).filter((x) => x.body.op === "end");
    a.eq(end.length, 1);
    a.eq(end[0].by_name, "the clock");
    a.eq(end[0].words, "The rehearsal ran out and was cleared.");
  });

  s.test("two requests that find it run out together clear it once", async (a) => {
    const { db, env } = await midRehearsal();
    await atTime(WED_LATE, () => Promise.all([W.rehearsalOn(env), W.rehearsalOn(env), W.busPayload(env, KEY)]));
    a.eq(notes(db).filter((x) => x.body.op === "end").length, 1, "the sheet was told more than once");
  });

  s.test("a request holding the last round cannot end the one started over since", async (a) => {
    const { db, env } = await fresh();
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    const old = flag(db)[0].v;
    await atTime(WED_ON, () => act(env, { op: "over", shape: "normal" }));
    const done = await atTime(WED_ON, () => W.rehearsalClear(env, old, "the clock", true));
    a.eq(done, false);
    a.eq(flag(db).length, 1, "the new round was ended by a stale read");
    a.ok(seeds(db).length > 0);
  });

  /* ---- who may, and from where ------------------------------------------- */

  s.test("only a coordinator, with his PIN, can start or end one", async (a) => {
    const { db, env } = await fresh();
    const driver = await atTime(WED, () => act(env, { op: "start" }, "Bro Adebola"));
    a.eq(driver.ok, false);
    a.eq(driver.error, "not authorised");
    const bad = await atTime(WED, () => act(env, { op: "start" }, "Bro Asim", "9999"));
    a.eq(bad.ok, false);
    a.eq(bad.error, "bad pin");
    a.eq(flag(db).length, 0);
  });

  s.test("the same tap of Start sent twice starts one rehearsal", async (a) => {
    const { db, env } = await fresh();
    const one = { id: "act-twice-reh", kind: "rehearsal", op: "start", shape: "normal" };
    const send = () => post(env, { action: "coord", who: "Bro Asim", pin: PIN, op: "act", act: one }).then(J);
    await atTime(WED, send);
    const first = seeds(db).map((r) => r.device).join();
    const again = await atTime(WED_ON, send);
    a.ok(again.duplicate, JSON.stringify(again));
    a.eq(seeds(db).map((r) => r.device).join(), first, "the retry drew a second set");
    a.eq(JSON.parse(flag(db)[0].v).at, ms(WED));
  });

  s.test("the sheet's menu does the same under the token, and is told the words", async (a) => {
    const { db, env } = await fresh();
    const out = await atTime(WED, async () => J(await post(env, { action: "rehearsal", do: "start", shape: "full" })));
    a.ok(out.ok, JSON.stringify(out));
    a.eq(out.words, "Rehearsal started: a nearly full bus, until 22:00.");
    a.eq(out.rehearsal.round, ms(WED));
    a.eq(out.summary.length, 2, "a line per route: " + JSON.stringify(out.summary));
    a.eq(notes(db)[0].by_name, "the spreadsheet");
    const end = await atTime(WED_ON, async () => J(await post(env, { action: "rehearsal", do: "end" })));
    a.ok(end.ok);
    a.eq(end.rehearsal, false);
    const bad = await atTime(WED_ON, async () =>
      J(await post(env, { action: "rehearsal", do: "start", token: "wrong" })));
    a.eq(bad.ok, false);
    a.eq(flag(db).length, 0);
  });

  s.test("a sync from the spreadsheet no longer starts, ends or seeds one", async (a) => {
    /* A sheet a version behind says "no rehearsal" on every push, and on
       w2.19.0 that ended the one the coordinator had just started. */
    const { db, env } = await fresh();
    await atTime(WED, () => act(env, { op: "start", shape: "normal" }));
    const had = seeds(db).length;
    await atTime(WED_ON, () => W.handleSync(env, { rehearsal: false, rehearsalSeeds: [] }));
    a.eq(flag(db).length, 1, "a sync ended it");
    a.eq(seeds(db).length, had, "a sync swept its seats");
    await atTime(WED_ON, () => act(env, { op: "end" }));
    await atTime(WED_ON, () => W.handleSync(env, { rehearsal: { at: ms(WED_ON), key: KEY },
      rehearsalSeeds: [{ sunday: KEY, route: "North", stopId: "N02", stop: "Grace Rd", seats: 3,
                         device: "rehearsal-north-0-x", received: ms(WED_ON) }] }));
    a.eq(flag(db).length, 0, "a sync started one");
    a.eq(seeds(db).length, 0, "a sync seeded one");
  });

  s.test("the coordinator's first screen shows the one running, route by route", async (a) => {
    const { db, env } = await midRehearsal();
    const out = await atTime(WED_ON, () => load(env));
    a.ok(out.ok);
    a.eq(out.rehearsal.round, ms(WED));
    const north = out.rehearsalDetail.routes.find((r) => r.route === "North");
    const want = seeds(db).filter((r) => r.route === "North").reduce((t, r) => t + r.seats, 0);
    a.eq(north.booked, want);
    a.eq(north.seats, 16);
    a.ok(north.started > 0, "the test run is not shown");
    a.eq(north.marked, 1, "one stop marked, one taken back");
    const south = out.rehearsalDetail.routes.find((r) => r.route === "South");
    a.eq(south.started, 0, "the real South run is shown as the rehearsal's");
  });

  s.test("with none running, a test seat left behind is never counted", async (a) => {
    /* The older promise, still kept: a row left behind by a crash cannot
       inflate a real Sunday. */
    const { db, env } = await fresh();
    await db.prepare("INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, status, received, synced) " +
      "VALUES (?, 'North', 'N02', 'Grace Rd', 3, 'rehearsal-north-0-x', 'Rehearsal', 1, 1)").bind(KEY).run();
    const rows = await atTime(WED, () => W.liveBookings(env, KEY));
    a.not(rows.some((b) => b.stopId === "N02"), "a leftover test seat was counted for real");
    a.ok(rows.some((b) => b.stopId === "N01"), "and the real one is still there");
  });

  /* ---- clearing a Sunday that has not been driven ------------------------

     There was no way to do this, and at three in the morning on 23 September
     there needed to be: a rehearsal had gone in as a real run and the only
     way out was a SQL console. The guards below are the whole safety of the
     tool that replaced it. */

  async function withARun(key, when) {
    const { db, env } = await fresh();
    await db.prepare("INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, status, received, synced) " +
      "VALUES (?, 'North', 'N02', 'Grace Rd', 3, 'rehearsal-north-0-x', 'Rehearsal', 1, 1)").bind(KEY).run();
    /* Taps recorded as a REAL run, which is exactly what happened on the
       night: this server did not know a rehearsal was on. */
    await atTime(when || WED, async () => {
      const at = Date.now() - 3600000;
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adebola",
        reg: "NH56 FWP", sunday: key, events: [{ event: "start", at: at }] });
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adebola",
        reg: "NH56 FWP", sunday: key,
        events: [{ event: "picked", stopId: "N02", at: at + 600000 },
                 { event: "end", at: at + 1500000 }] });
    });
    return { db, env };
  }

  /* On a fixed Wednesday, so a run of the suite on a Sunday afternoon does
     not find "the Sunday still ahead" already driven. */
  const THIS = KEY;
  const clear = (env, body) => atTime(WED, () => W.handleClearTrips(env, body).then((r) => r.json()));

  s.test("it clears the taps for a Sunday still ahead", async (a) => {
    const { db, env } = await withARun(THIS);
    a.ok(db._rows("SELECT id FROM trip_events WHERE sunday=?", THIS).length > 0,
         "the fixture recorded nothing, so this proves nothing");
    const out = await clear(env, { sunday: THIS });
    a.ok(out.ok, JSON.stringify(out));
    a.eq(db._rows("SELECT id FROM trip_events WHERE sunday=?", THIS).length, 0);
    a.ok(out.trips > 0, "it should say how many it took: " + JSON.stringify(out));
  });

  s.test("it takes the rehearsal seats and leaves the real one", async (a) => {
    const { db, env } = await withARun(KEY);
    await db.prepare("UPDATE bookings SET sunday=? WHERE status='Rehearsal' OR device='d-real'").bind(THIS).run();
    await clear(env, { sunday: THIS });
    a.eq(db._rows("SELECT id FROM bookings WHERE lower(status)='rehearsal'").length, 0);
    a.eq(db._rows("SELECT id FROM bookings WHERE device='d-real'").length, 1,
         "a paying passenger lost their seat to a clear-up");
  });

  s.test("A SUNDAY THAT HAS BEEN AND GONE IS NEVER TOUCHED", async (a) => {
    /* The one that matters. A morning that has been driven is the record of
       people who were actually carried, and no mistyped date, stale menu or
       second thought may delete it. Guarded here as well as in the
       spreadsheet, because the spreadsheet is not the only thing that can
       hold this token. */
    const gone = W.keyAddWeeks(THIS, -1);
    const { db, env } = await withARun(gone);
    const had = db._rows("SELECT id FROM trip_events WHERE sunday=?", gone).length;
    a.ok(had > 0, "the fixture recorded nothing, so this proves nothing");

    const out = await clear(env, { sunday: gone });
    a.eq(out.ok, false, "it agreed to delete a morning that had been driven");
    a.has(String(out.error), "been and gone", "got: " + out.error);
    a.eq(db._rows("SELECT id FROM trip_events WHERE sunday=?", gone).length, had,
         "and it deleted some of it anyway");
  });

  s.test("nor the Sunday just driven, on its afternoon", async (a) => {
    /* On a Sunday afternoon the Sunday "still ahead" is today, and its
       morning is the record. Rehearsals are pitched for Sunday afternoons. */
    const { db, env } = await withARun(KEY, SUN_AFTER);
    const had = db._rows("SELECT id FROM trip_events WHERE sunday=?", KEY).length;
    a.ok(had > 0, "the fixture recorded nothing, so this proves nothing");
    const out = await atTime(SUN_AFTER, () => W.handleClearTrips(env, { sunday: KEY }).then((r) => r.json()));
    a.eq(out.ok, false, "it cleared the morning that had just been driven");
    a.eq(db._rows("SELECT id FROM trip_events WHERE sunday=?", KEY).length, had);
  });

  s.test("it refuses while a run is still open", async (a) => {
    /* Clearing the morning out from under a driver between two stops would
       leave him tapping into nothing. */
    const { db, env } = await fresh();
    await atTime(WED, () => W.handleTrip(env, { trip: "t9", route: "North", driver: "Bro Adebola",
      reg: "NH56 FWP", sunday: THIS, events: [{ event: "start", at: Date.now() - 600000 }] }));

    const out = await clear(env, { sunday: THIS });
    a.eq(out.ok, false, "it cleared a run that was still going");
    a.has(String(out.error), "still open", "got: " + out.error);
    a.ok(db._rows("SELECT id FROM trip_events WHERE sunday=?", THIS).length > 0);
  });

  s.test("a date it cannot read is refused rather than guessed at", async (a) => {
    const { env } = await withARun(THIS);
    for (const bad of ["", "last sunday", "27/09/2026", "2026-9-7"]) {
      const out = await clear(env, { sunday: bad });
      a.eq(out.ok, false, JSON.stringify(bad) + " was accepted");
    }
  });

  return s;
}
