/* A RENEWAL BOOKED IN IS SAID BESIDE ITS DUE DATE. server w2.58.0 (Asim,
   11 Oct 2026).

   NH56 FWP's service read "Overdue by 165 days" on the driver's Before you
   start, and nothing said whether it was booked in. Now each bus the driver
   app is given carries { item: day } for every renewal with a standing
   Booked entry in the Vehicle Log for today or later.

   Everything here fails on w2.57.0. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { atTime } from "../lib/clock.mjs";

const SUN = "2026-10-11T21:00:00+01:00";

export default async function (root) {
  const s = new Suite("a renewal booked in is said beside its due date");
  installGlobals();
  const { mod: W } = await loadWorker(root);

  const row = (o) => Object.assign({ id: "L-" + Math.random(), what: "Service", status: "Booked", done: "", bookedFor: "",
                                     recorded: Date.now(), correctedBy: "" }, o);
  async function fresh(log) {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await db.prepare("INSERT INTO buses (reg, seats, active) VALUES (?,?,?)").bind("NH56 FWP", 16, 1).run();
    await W.cachePut(env, "bus_extra", { "NH56 FWP": { dates: { mot: "2027-04-28", service: "2026-04-29" } } }).run();
    await W.cachePut(env, "coord_shelf", { builtAt: Date.now(), readAt: Date.now(), requests: [], defects: [],
                                           vehicles: { log: { "NH56 FWP": log }, jobs: {} } }).run();
    await W.cachePut(env, "cache_last", { builtAt: Date.now(), payload: { ok: true, last: {} } }).run();
    return env;
  }

  s.test("a service booked for a day ahead reaches the driver app with the bus", async (a) => {
    await atTime(SUN, async () => {
      const env = await fresh([row({ bookedFor: "2026-10-20" })]);
      const out = await W.cachedLast(env);
      const bus = (out.buses || []).find((b) => b.reg === "NH56 FWP") || {};
      a.eq(JSON.stringify(bus.booked), JSON.stringify({ service: "2026-10-20" }), "the booking rides with the bus");
      a.eq(bus.dates && bus.dates.service, "2026-04-29", "the due date is left as it is");
    });
  });

  s.test("today counts; a day gone, a corrected entry or a Done entry do not; the soonest wins", async (a) => {
    await atTime(SUN, async () => {
      const env = await fresh([
        row({ bookedFor: "2026-10-10" }),
        row({ what: "MOT", bookedFor: "2026-11-02", correctedBy: "L-x" }),
        row({ what: "Parking permit", status: "Done", done: "2026-10-01" }),
        row({ what: "Insurance", bookedFor: "2026-10-11" }),
        row({ bookedFor: "2026-10-30" }), row({ bookedFor: "2026-10-25" })]);
      const b = (await W.busBookings(env))["NH56 FWP"] || {};
      a.eq(JSON.stringify(Object.keys(b).sort()), JSON.stringify(["insurance", "service"]), "only the standing bookings ahead");
      a.eq(b.insurance, "2026-10-11", "a booking for today counts");
      a.eq(b.service, "2026-10-25", "the soonest booking wins");
    });
  });

  s.test("no Vehicle Log: every bus has an empty booking list", async (a) => {
    await atTime(SUN, async () => {
      const env = await fresh([]);
      const out = await W.cachedLast(env);
      const bus = (out.buses || []).find((b) => b.reg === "NH56 FWP") || {};
      a.eq(JSON.stringify(bus.booked), "{}", "nothing booked");
    });
  });

  return s;
}
