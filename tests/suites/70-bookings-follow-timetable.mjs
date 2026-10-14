/* BOOKINGS FOLLOW THE TIMETABLE, and the 07:30 message is watched.
   server w2.61.0, pages v1.118.0, sheet v1.119.0 (Asim, 14 Oct 2026).

   On 12 Oct the Bus Stops tab was reshuffled after bookings for the next
   Sunday were already in. A booking at a renumbered stop pointed at nothing,
   and one whose time moved measured "late" from the old time. Now a sweep
   moves the first to the stop with the same name and gives the second the
   new time, telling the passenger once; a stop with no namesake is listed in
   the coordinator app. And the sheet emails the coordinators if Sunday's
   07:30 message has not gone by 07:40. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-10-18";
const WED = (hhmm) => "2026-10-14T" + hhmm + ":00+01:00";
const SUN = (hhmm) => "2026-10-18T" + hhmm + ":00+01:00";

export default async function (root) {
  const s = new Suite("bookings follow the timetable");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());
  const EP = (w) => "https://push.test/" + w;

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    for (const p of ["A", "B", "C"]) {
      await db.prepare("INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, made) VALUES (?,?,?,?,?,?,?)")
        .bind(EP(p), "p", "a", "passenger", "dev" + p, "", Date.now()).run();
    }
    return { db, env };
  }
  let phoneN = 100;
  const book = async (env, ref, stopId, seats) =>
    J(await W.handleBooking(env, { date: KEY, ref, stopId, seats, phone: "07700900" + (++phoneN) }));
  const row = (db, ref) => db._rows("SELECT route, stop_id, stop, sched FROM bookings WHERE device=?", ref)[0] || {};
  const box = async (env, p) => ((await W.cacheGet(env, "calert:" + EP(p))) || []).filter((m) => m.kind === "message");
  /* 12 Oct's shape: Breck Rd leaves South for North under a new number, and
     Dewsbury Rd's time moves by twenty minutes. */
  const reshuffle = async (db) => {
    await db.prepare("DELETE FROM stops WHERE stop_id='S04'").run();
    await db.prepare("INSERT INTO stops (stop_id, route, time, stop, kind, seq) VALUES ('N10','North','10:53','Breck Rd','pickup',8.5)").run();
    await db.prepare("UPDATE stops SET time='10:49' WHERE stop_id='S01'").run();
  };
  const sweep = (env, when) => atTime(when, () => W.fitBookingsToStops(env));

  s.test("a renumbered stop's bookings move by name, a moved time is taken, each passenger told once", async (a) => {
    const { db, env } = await fresh();
    await atTime(WED("09:00"), async () => {
      a.ok((await book(env, "devA", "S04", 2)).ok, "booking at S04 refused");
      a.ok((await book(env, "devB", "S01", 1)).ok, "booking at S01 refused");
      a.ok((await book(env, "devC", "N02", 1)).ok, "booking at N02 refused");
    });
    a.eq(row(db, "devA").sched, "10:40");
    await reshuffle(db);

    a.eq(await sweep(env, WED("12:00")), 0, "acted on a timetable it had only just seen");
    a.eq(await sweep(env, WED("12:05")), 0, "acted before the timetable had settled");
    a.eq(await sweep(env, WED("12:11")), 2, "two bookings should have changed");

    const A = row(db, "devA");
    a.eq(A.route + " " + A.stop_id + " " + A.sched, "North N10 10:53", "the Breck Rd booking did not follow its stop");
    a.eq(row(db, "devB").sched, "10:49", "the Dewsbury Rd booking kept the old time");
    a.eq(row(db, "devC").sched, "10:15", "an untouched booking was changed");

    const b = await box(env, "B");
    a.eq(b.length, 1, "Dewsbury Rd's passenger was not told once");
    a.eq(b[0].title, "New time at Dewsbury Rd");
    a.eq(b[0].body, "Sun 18 Oct: 10:49.");
    a.eq((await box(env, "A")).length, 1, "Breck Rd's passenger was not told the new time");
    a.eq((await box(env, "C")).length, 0, "a passenger whose time did not change was told");

    a.eq(await sweep(env, WED("12:20")), 0, "a second sweep changed something again");
    a.eq((await box(env, "B")).length, 1, "a second sweep told the passenger twice");
    const what = await W.pushWhat(env, EP("B"));
    a.eq(what.title, "New time at Dewsbury Rd");
  });

  s.test("a stop with no namesake stays put and the coordinator app lists it", async (a) => {
    const { db, env } = await fresh();
    await atTime(WED("09:00"), () => book(env, "devA", "S05", 3));
    await db.prepare("DELETE FROM stops WHERE stop_id='S05'").run();
    await sweep(env, WED("12:00"));
    a.eq(await sweep(env, WED("12:11")), 0);
    a.eq(row(db, "devA").stop_id, "S05", "a booking was moved to a stop with another name");
    const out = await atTime(WED("12:12"), () => W.coordBookings(env, { name: "Bro Asim" }, KEY));
    a.eq((out.gone || []).length, 1, "the stranded booking is not listed");
    a.eq(out.gone[0].stopId + " " + out.gone[0].seats, "S05 3");
  });

  s.test("not in quiet hours, and not once Sunday's bookings have closed", async (a) => {
    const { db, env } = await fresh();
    await atTime(WED("09:00"), () => book(env, "devB", "S01", 1));
    await db.prepare("UPDATE stops SET time='10:49' WHERE stop_id='S01'").run();
    await sweep(env, WED("22:00"));
    a.eq(await sweep(env, WED("22:30")), 0, "a new time was sent at half past ten at night");
    a.eq(row(db, "devB").sched, "10:29");
    a.eq(await sweep(env, "2026-10-15T08:05:00+01:00"), 1, "the new time did not go in the morning");

    await db.prepare("UPDATE stops SET time='10:55' WHERE stop_id='S01'").run();
    await sweep(env, SUN("09:35"));
    a.eq(await sweep(env, SUN("09:50")), 0, "a booking changed after bookings closed");
    a.eq(row(db, "devB").sched, "10:49");
  });

  s.test("the 07:30 message is recorded and the drain says so", async (a) => {
    const { env } = await fresh();
    await atTime(SUN("07:31"), () => W.wakeMorning(env));
    const out = await atTime(SUN("07:35"), async () => J(await W.handleDrain(env, {})));
    a.eq(out.morning && out.morning.key, KEY, "the drain does not carry the morning");
    a.eq(out.morning.off, false);
  });

  s.test("the sheet emails the coordinators once if the 07:30 message has not gone", async (a) => {
    const watch = (when, morning, props) => atTime(when, () => {
      const g = loadCodeGs(root, { props: Object.assign({ COORDINATOR_EMAIL: "c1@test, c2@test",
        workerMorning: JSON.stringify(Object.assign({ seen: Date.now() }, morning)) }, props || {}) });
      call(g, "morningWatch");
      call(g, "morningWatch");
      return g.gas;
    });
    let g = await watch(SUN("07:45"), { m: { key: "2026-10-11" } });
    a.eq(g.mail.length, 1, "not emailed exactly once");
    a.eq(g.mail[0].subject, "07:30 message not sent");
    a.ok(/had not gone to passengers by 07:45, Sun 18 Oct\./.test(g.mail[0].body), g.mail[0].body);
    a.ok(/c1@test/.test(g.mail[0].to) && /c2@test/.test(g.mail[0].to), "not every coordinator");

    a.eq((await watch(SUN("07:45"), { m: { key: KEY } })).mail.length, 0, "emailed though it went");
    a.eq((await watch(SUN("07:45"), { m: { key: "", off: true } })).mail.length, 0, "emailed though it is switched off");
    a.eq((await watch(SUN("07:35"), { m: { key: "" } })).mail.length, 0, "emailed before 07:40");
    a.eq((await watch(WED("07:45"), { m: { key: "" } })).mail.length, 0, "emailed on a Wednesday");
    g = await watch(SUN("07:50"), { seen: Date.parse(SUN("07:20")), m: { key: KEY } });
    a.eq(g.mail.length, 1, "a server that stopped answering was not reported");
    a.ok(/last answered at 07:20/.test(g.mail[0].body), g.mail[0].body);
  });

  return s;
}
