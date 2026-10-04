/* THE DRIVER'S STOP LIST STAYS IN TIMETABLE ORDER WHILE A RUN IS OUT.

   From w2.44.0 (Asim, 4 October 2026). North, late, showed Pym Street 10:59
   above Wilburn Street 10:58. Neither was booked: Pym Street was timed as if
   the bus pulls in there, and Wilburn Street was timed with Pym Street
   skipped. An empty stop is now never later than the stop after it, and the
   church arrival is estimated too. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-09-27";
const SAT = "2026-09-26T11:00:00+01:00";

export default async function (root) {
  const s = new Suite("the driver's stop list stays in timetable order");
  installGlobals();
  const { mod } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  async function lateNorth() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await atTime(SAT, async () => {
      await mod.handleBooking(env, { date: KEY, ref: "dev1", phone: "07700900123", stopId: "N04", seats: 1 });
      await mod.handleBooking(env, { date: KEY, ref: "dev2", phone: "07700900124", stopId: "N05", seats: 2 });
    });
    let board = null;
    await atTime("2026-09-27T10:50:00+01:00", async () => {
      const at = Date.now();
      await mod.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian", reg: "YS70 PWE",
        sunday: KEY, events: [{ event: "start", at: at - 1800000 }, { event: "picked", stopId: "N04", at: at - 120000 }] });
      board = await mod.boardPayload(env, "North");
    });
    return board;
  }

  s.test("no empty stop is shown later than the stop after it", async (a) => {
    const board = await lateNorth();
    a.ok(board.etas, "no estimates on the board: " + (board.etaError || board.tripError || ""));
    const ids = ["N05", "N06", "N07", "N08", "N09"];
    for (let i = 1; i < ids.length; i++) {
      a.ok(board.etas[ids[i - 1]] <= board.etas[ids[i]],
           ids[i - 1] + " is shown after " + ids[i]);
    }
  });

  s.test("a booked stop's estimate is the same one the passenger is given", async (a) => {
    const board = await lateNorth();
    a.ok(board.etas.N05 > 0);
    /* Bedford Road is booked and comes straight after the last stop marked,
       so nothing is skipped on the way: timetable plus the run's offset. */
    const sched = mod.londonMoment(KEY, "10:39").getTime();
    a.eq(board.etas.N05, Math.round((sched + board.trip.offset * 60000) / 60000) * 60000);
  });

  s.test("the church arrival is estimated too, after every pickup", async (a) => {
    const board = await lateNorth();
    const sched = mod.londonMoment(KEY, "11:00").getTime();
    a.ok(board.etas.N09 > sched, "a late run still shows church at 11:00");
    a.ok(!("N00" in board.etas), "the departure row has no estimate");
  });

  return s;
}
