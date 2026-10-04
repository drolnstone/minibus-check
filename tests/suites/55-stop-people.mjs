/* WHO IS BOOKED AT HIS STOPS, for the driver app's pickup pop-up.
   pages v1.101.0 · server w2.46.0 (Asim, 4 October 2026).

   Call passenger needs the number behind each booking. It goes to one phone
   only: the driver of the run out on that route now, with his PIN. A wrong
   PIN, another driver, the other route, no run or an ended run get nothing,
   and the board every phone reads still carries no number.

   Everything here fails on w2.45.0, which has no stoppeople action. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday, seedBookings } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-10-04";
const AT = "2026-10-04T10:20:00+01:00";
/* Bro Adrian drives North on the seeded rota; his phone ends 2468. */
const ADRIAN = "2468", TREVOR = "4321";

export default async function (root) {
  const s = new Suite("who is booked at the driver's stops");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  async function fresh(started, ended) {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await db.prepare("DELETE FROM drivers").run();
    for (const [name, pin] of [["Bro Adrian", ADRIAN], ["Bro Trevor", TREVOR]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind(name, "Driver", "North", await W.pinHashOf(env, name, pin)).run();
    }
    await seedBookings(db, KEY, [
      { route: "North", stopId: "N02", seats: 2, phone: "07700 900123" },
      { route: "North", stopId: "N02", seats: 1, phone: "", device: "coord-1", pid: "" },
      { route: "North", stopId: "N04", seats: 1, phone: "07700 900456", device: "dev-n4b", pid: "pid-n4b" },
      { route: "North", stopId: "N05", seats: 1, phone: "07700 900999", status: "Cancelled", device: "dev-n5", pid: "pid-n5" },
      { route: "South", stopId: "S03", seats: 1, phone: "07700 900777" }
    ]);
    if (started) {
      await atTime(AT, async () => {
        const events = [{ event: "start", at: Date.now() - 900000 }];
        if (ended) events.push({ event: "end", at: Date.now() - 60000 });
        await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian", reg: "YS70 PWE",
          sunday: KEY, events });
      });
    }
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const ask = (env, driver, pin, route) => atTime(AT, async () =>
    J(await post(env, { action: "stoppeople", who: { driver, pin, route: route || "North" } })));

  s.test("the driver of the run, with his PIN, gets each booking's number on his route", async (a) => {
    const { env } = await fresh(true);
    const out = await ask(env, "Bro Adrian", ADRIAN);
    a.eq(out.ok, true, JSON.stringify(out));
    const n02 = (out.people.N02 || []).map((p) => p.phone + "/" + p.seats).sort();
    a.eq(JSON.stringify(n02), JSON.stringify(["/1", "07700 900123/2"]));
    a.eq(JSON.stringify(out.people.N04), JSON.stringify([{ phone: "07700 900456", seats: 1 }]));
    a.ok(!out.people.N05, "a cancelled booking was handed over");
    a.ok(!out.people.S03, "the other route's passengers were handed over");
  });

  s.test("a wrong PIN, another driver or the other route gets no number", async (a) => {
    const { env } = await fresh(true);
    const bad = await ask(env, "Bro Adrian", "9999");
    a.eq(bad.ok, false); a.ok(!bad.people, "numbers on a wrong PIN");
    const other = await ask(env, "Bro Trevor", TREVOR);
    a.eq(other.ok, false); a.eq(other.error, "not your run");
    const south = await ask(env, "Bro Adrian", ADRIAN, "South");
    a.eq(south.ok, false); a.ok(!south.people, "numbers for a route he is not driving");
  });

  s.test("no run out, or a run ended, gets no number", async (a) => {
    const none = await fresh(false);
    a.eq((await ask(none.env, "Bro Adrian", ADRIAN)).error, "not your run");
    const ended = await fresh(true, true);
    a.eq((await ask(ended.env, "Bro Adrian", ADRIAN)).error, "not your run");
  });

  s.test("the board every phone reads still carries no number", async (a) => {
    const { env } = await fresh(true);
    const board = await atTime(AT, async () => W.boardPayload(env, "North"));
    a.hasnt(JSON.stringify(board), "900123", "a passenger's number is on the public board");
  });

  return s;
}
