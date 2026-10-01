/* THE TIME THE PASSENGER WAS GIVEN.

   Up to w2.32.0 early or late was measured from the Bus Stops tab as it
   stood when the bus got there. A timetable changed during the week moved
   the yardstick under every seat already taken. From w2.32.0 each booking
   keeps its stop's time as it was when booked (bookings.sched, and the
   Scheduled column on Bus Bookings), and a tap at a booked stop is measured
   from that. A stop nobody booked still goes by the timetable. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-10-04";
const SATURDAY = "2026-10-03T12:00:00+01:00";
const ON_THE_ROAD = "2026-10-04T10:40:00+01:00";

export default async function (root) {
  const s = new Suite("the time the passenger was given");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    return { db, env };
  }
  const book = async (env, stopId, seats) =>
    J(await W.handleBooking(env, { date: KEY, ref: "devA", phone: "07700900123", stopId, seats }));
  const sched = (db) => String((db._rows("SELECT sched FROM bookings")[0] || {}).sched || "");
  const retime = (db, id, t) => db.prepare("UPDATE stops SET time=? WHERE stop_id=?").bind(t, id).run();
  const tap = (env, events) => W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian",
    reg: "YS70 PWE", sunday: KEY, events });
  const rowFor = (db, stopId) => db._rows("SELECT scheduled, off_min FROM trip_events WHERE stop_id=?", stopId)[0] || {};

  s.test("a booking keeps its stop's time; more seats keep it, another stop takes the new one", async (a) => {
    const { db, env } = await fresh();
    await atTime(SATURDAY, async () => {
      a.ok((await book(env, "N02", 2)).ok, "the booking was refused");
      a.eq(sched(db), "10:15", "the time given was not kept");
      await retime(db, "N02", "10:30");
      await book(env, "N02", 3);
      a.eq(sched(db), "10:15", "changing the seats moved the time the passenger was given");
      await book(env, "N03", 3);
      a.eq(sched(db), "10:24", "a new stop kept the old stop's time");
    });
  });

  s.test("early or late at a booked stop is from the booked time, not today's timetable", async (a) => {
    const { db, env } = await fresh();
    await atTime(SATURDAY, async () => { await book(env, "N02", 2); });
    await retime(db, "N02", "10:30");
    await retime(db, "N04", "10:40");
    await atTime(ON_THE_ROAD, async () => {
      await tap(env, [{ event: "start", at: Date.parse("2026-10-04T09:52:00+01:00") },
                      { event: "pickup", stopId: "N02", at: Date.parse("2026-10-04T10:20:00+01:00") },
                      { event: "empty", stopId: "N04", at: Date.parse("2026-10-04T10:35:00+01:00") }]);
    });
    a.eq(rowFor(db, "N02").scheduled, "10:15");
    a.eq(Number(rowFor(db, "N02").off_min), 5, "measured from today's 10:30 instead of the booked 10:15");
    a.eq(rowFor(db, "N04").scheduled, "10:40", "a stop nobody booked goes by the timetable");
    a.eq(Number(rowFor(db, "N04").off_min), -5);
  });

  s.test("a cancelled seat's time no longer counts", async (a) => {
    const { db, env } = await fresh();
    await atTime(SATURDAY, async () => {
      await book(env, "N02", 2);
      await retime(db, "N02", "10:30");
      await book(env, "N02", 0);
    });
    a.eq(JSON.stringify(await W.bookedTimes(env, KEY, "North")), "{}");
  });

  s.test("the drain carries the booked time to the sheet", async (a) => {
    const { db, env } = await fresh();
    await atTime(SATURDAY, async () => { await book(env, "N02", 2); });
    const out = await J(await W.handleDrain(env, {}));
    a.eq(String(out.bookings[0].sched), "10:15");
  });

  return s;
}
