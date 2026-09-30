/* THE MORNING ITSELF: starting, tapping, taking a tap back, and ending.

   The two hard refusals in the whole system both live near here, and the
   second of them — one route, one run — is refused in two places on purpose,
   because the app judges it off a board answer a few seconds old and two
   thumbs inside that window would both be told yes. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";

export default async function (root) {
  const s = new Suite("the morning: start, tap, undo, end");
  const { mod: W } = await loadWorker(root);
  const body = async (r) => JSON.parse(await r.text());

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    const key = W.runSunday();
    await seedSunday(db, key);
    return { db, env, key };
  }

  const post = (over) => Object.assign({
    trip: "t1", route: "North", driver: "Bro Adrian", reg: "YS70 PWE", sunday: null, events: []
  }, over || {});

  s.test("a start is written, with the bus and the departure time on it", async (a) => {
    const { db, env, key } = await fresh();
    await W.handleTrip(env, post({ sunday: key, events: [{ event: "start", at: Date.now() }] }));
    const row = db._one("SELECT * FROM trip_events WHERE trip='t1' AND event='start'");
    a.ok(row, "no start row was written");
    a.eq(row.route, "North");
    a.eq(row.reg, "YS70 PWE");
    a.eq(row.scheduled, "09:52", "the departure row off the Bus Stops tab, not a guess");
  });

  s.test("a second driver cannot start a second run on the same route", async (a) => {
    const { env, key } = await fresh();
    await W.handleTrip(env, post({ sunday: key, events: [{ event: "start", at: Date.now() }] }));
    const r = await body(await W.handleTrip(env, post({
      trip: "t2", driver: "Bro Martin", sunday: key, events: [{ event: "start", at: Date.now() }]
    })));
    a.not(r.ok);
    a.eq(r.error, "route busy");
    a.eq(r.busy.driver, "Bro Adrian");
  });

  s.test("a phone retrying its OWN start is never refused", async (a) => {
    const { env, key } = await fresh();
    const p = post({ sunday: key, events: [{ event: "start", at: Date.now() }] });
    await W.handleTrip(env, p);
    const r = await body(await W.handleTrip(env, p));
    a.ok(r.ok, "judged on the trip id, not the name: his own retry is his own run");
  });

  s.test("the other route is unaffected by a run being out on this one", async (a) => {
    const { env, key } = await fresh();
    await W.handleTrip(env, post({ sunday: key, events: [{ event: "start", at: Date.now() }] }));
    const r = await body(await W.handleTrip(env, post({
      trip: "s1", route: "South", driver: "Bro Trevor", reg: "NH56 FWP",
      sunday: key, events: [{ event: "start", at: Date.now() }]
    })));
    a.ok(r.ok);
  });

  s.test("a stop tap records how far off the timetable it is", async (a) => {
    const { db, env, key } = await fresh();
    const sched = W.londonMoment(key, "10:03").getTime();   /* N01 on the real tab */
    await W.handleTrip(env, post({ sunday: key, events: [
      { event: "start", at: sched - 8 * 60000 },
      { event: "picked", stopId: "N01", at: sched + 6 * 60000 }
    ] }));
    const row = db._one("SELECT * FROM trip_events WHERE trip='t1' AND stop_id='N01'");
    a.eq(row.event, "picked");
    a.eq(row.off_min, 6, "six minutes behind the timetable");
  });

  s.test("a stop nobody was at is recorded as its own answer, not as a gap", async (a) => {
    const { db, env, key } = await fresh();
    await W.handleTrip(env, post({ sunday: key, events: [
      { event: "start", at: Date.now() }, { event: "none", stopId: "N02", at: Date.now() }
    ] }));
    a.eq(db._one("SELECT * FROM trip_events WHERE stop_id='N02'").event, "none");
  });

  s.test("the same tap sent five times leaves one row", async (a) => {
    const { db, env, key } = await fresh();
    const ev = { event: "picked", stopId: "N01", at: Date.now() };
    for (let i = 0; i < 5; i++) await W.handleTrip(env, post({ sunday: key, events: [ev] }));
    a.eq(db._rows("SELECT * FROM trip_events WHERE stop_id='N01'").length, 1);
  });

  s.test("an undo marks the row rather than deleting it", async (a) => {
    const { db, env, key } = await fresh();
    await W.handleTrip(env, post({ sunday: key, events: [{ event: "picked", stopId: "N01", at: Date.now() }] }));
    await W.handleTrip(env, post({ sunday: key, events: [{ event: "undo", undoes: "picked", stopId: "N01", at: Date.now() }] }));
    const row = db._one("SELECT * FROM trip_events WHERE stop_id='N01' AND event='picked'");
    a.eq(row.status, "Undone", "a driver who taps and untaps four times should leave a trace");
  });

  s.test("undo then mark again revives the row", async (a) => {
    const { db, env, key } = await fresh();
    await W.handleTrip(env, post({ sunday: key, events: [{ event: "picked", stopId: "N01", at: 1000 }] }));
    await W.handleTrip(env, post({ sunday: key, events: [{ event: "undo", undoes: "picked", stopId: "N01", at: 2000 }] }));
    await W.handleTrip(env, post({ sunday: key, events: [{ event: "picked", stopId: "N01", at: 3000 }] }));
    const row = db._one("SELECT * FROM trip_events WHERE stop_id='N01' AND event='picked'");
    a.ne(row.status, "Undone", "tapping the wrong kerb and fixing it is not a rare sequence");
    a.eq(row.happened, 3000);
    a.eq(db._rows("SELECT * FROM trip_events WHERE stop_id='N01' AND event='picked'").length, 1);
  });

  s.test("a run driven by somebody the rota does not name is marked Cover", async (a) => {
    const { db, env, key } = await fresh();
    await W.handleTrip(env, post({ sunday: key, driver: "Bro Cedric", events: [{ event: "start", at: Date.now() }] }));
    a.has(db._one("SELECT * FROM trip_events WHERE event='start'").status, "Cover");
  });

  s.test("a run that went out unchecked says so, and says Cover too when it is both", async (a) => {
    const { db, env, key } = await fresh();
    await W.handleTrip(env, post({ sunday: key, driver: "Bro Cedric",
      events: [{ event: "start", at: Date.now(), unchecked: 1 }] }));
    const st = db._one("SELECT * FROM trip_events WHERE event='start'").status;
    a.has(st, "Unchecked");
    a.has(st, "Cover", "a run can be two things at once and the ladder this replaced lost one of them");
  });

  s.test("only the start row carries a position", async (a) => {
    const { db, env, key } = await fresh();
    await W.handleTrip(env, post({ sunday: key, events: [
      { event: "start", at: Date.now(), geo: { lat: 53.4, lng: -2.9, acc: 12, away: 30 } },
      { event: "picked", stopId: "N01", at: Date.now(), geo: { lat: 53.5, lng: -2.8, acc: 9 } }
    ] }));
    a.ok(db._one("SELECT * FROM trip_events WHERE event='start'").geo, "the start should carry its fix");
    a.eq(db._one("SELECT * FROM trip_events WHERE stop_id='N01'").geo, "",
         "this app does not track a bus between checks and must not start now");
  });

  s.test("a refused fix is recorded as a reason, not as a blank", async (a) => {
    const { db, env, key } = await fresh();
    await W.handleTrip(env, post({ sunday: key, events: [
      { event: "start", at: Date.now(), geo: { why: "Location refused" } }
    ] }));
    a.eq(db._one("SELECT * FROM trip_events WHERE event='start'").geo, "Location refused",
         "a blank cell and a refused one are different facts");
  });

  return s;
}
