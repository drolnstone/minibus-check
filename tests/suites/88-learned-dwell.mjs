/* HOW LONG THE BUS STANDS AT EACH STOP, LEARNED FROM REAL RUNS, 19 Nov 2026.
   server w2.97.0.

   Asim: the live estimate assumed 75 seconds at every stop. Each stop's own
   history should make "Be at your stop in about N min" more accurate. The
   stand is measured from the driving phone's fixes (first one at the pin,
   first one away from it), kept only at stops marked Picked up, and used
   once a stop has three sure stands; 75 s until then. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday, seedBookings } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-10-04";
const ME = "Bro Adrian";
const EXEC = "https://script.google.com/macros/s/LIVE/exec";
const at = (hhmm) => KEY + "T" + hhmm + "+01:00";
const T = (hhmm) => Date.parse(at(hhmm));
const FAR = { lat: 53.455, lng: -2.975, acc: 20, age: 0 };           /* on the road, half a kilometre from Litherland Rd */
const AT_N03 = { lat: 53.450731, lng: -2.987178, acc: 15, age: 0 };  /* Litherland Rd's pin */

export default async function (root) {
  const s = new Suite("learned stop stands");
  const G = installGlobals();
  const { mod: W } = await loadWorker(root);

  /* Past runs, written as the record would hold them: a stand at Litherland
     Rd and a Picked up there, unless said otherwise. */
  async function history(db, stands, event) {
    let n = 0;
    for (const sec of stands) {
      n++;
      const trip = "past" + n, arrived = T("10:20:00") - n * 7 * 86400000;
      await db.prepare("INSERT INTO stop_dwell (trip, stop_id, route, name, arrived, sure_in, last_in, left_at, sure_out)" +
        " VALUES (?,?,?,?,?,1,?,?,1)").bind(trip, "N07", "North", "Litherland Rd", arrived, arrived, arrived + sec * 1000).run();
      await db.prepare("INSERT INTO trip_events (trip, sunday, route, event, stop_id, stop, happened, status, logged)" +
        " VALUES (?,?,?,?,?,?,?,?,?)").bind(trip, "2026-09-27", "North", event || "pickup", "N07", "Litherland Rd",
        arrived + 60000, "Logged", arrived + 60000).run();
    }
  }

  async function fresh(before) {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await seedBookings(db, KEY, [{ route: "North", stopId: "N03", stop: "Litherland Rd" },
                                 { route: "North", stopId: "N08", stop: "Stanley Pk" }]);
    await W.cachePut(env, "sheet_url", { url: EXEC }).run();
    if (before) await before(db);
    await atTime(at("09:52:00"), () => W.handleTrip(env, { trip: "t1", route: "North", driver: ME,
      reg: "YS70 PWE", sunday: KEY, phone: "phoneA", events: [{ event: "start", at: T("09:52:00") }] }));
    return { db, env };
  }
  const board = (env, fix, hhmmss) => atTime(at(hhmmss), () => W.boardPayload(env, "North", "phoneA", ME, fix));
  function sheetSays(next, legs) {
    G.reset();
    G.reply((url, opts) => {
      const q = JSON.parse(opts.body);
      const back = {};
      for (const l of q.legs || []) if (legs[l.key] !== undefined) back[l.key] = { sec: legs[l.key], traffic: true };
      return new Response(JSON.stringify({ ok: true, next: { sec: next, traffic: true }, legs: back }), { status: 200 });
    });
  }

  s.test("no history: 75 s at the stop, as before", async (a) => {
    const { env } = await fresh();
    sheetSays(600, { "N03>N08": 900 });
    const out = await board(env, FAR, "10:10:00");
    a.eq(out.etas.N08, T("10:36:00"), "10:20 + 75 s + 15 min");
  });

  s.test("three sure stands at a stop: the middle one is used, matched by name", async (a) => {
    const { env } = await fresh((db) => history(db, [150, 200, 400]));
    sheetSays(600, { "N03>N08": 900 });
    const out = await board(env, FAR, "10:10:00");
    a.eq(out.etas.N03, T("10:20:00"), "the stop itself is unchanged");
    a.eq(out.etas.N08, T("10:38:00"), "10:20 + 200 s + 15 min");
  });

  s.test("two stands are not enough", async (a) => {
    const { env } = await fresh((db) => history(db, [300, 300]));
    sheetSays(600, { "N03>N08": 900 });
    a.eq((await board(env, FAR, "10:10:00")).etas.N08, T("10:36:00"));
  });

  s.test("a Nobody here stand is not counted", async (a) => {
    const { env } = await fresh((db) => history(db, [300, 300, 300], "empty"));
    sheetSays(600, { "N03>N08": 900 });
    a.eq((await board(env, FAR, "10:10:00")).etas.N08, T("10:36:00"));
  });

  s.test("the tap estimate, with no fix, is unchanged by history", async (a) => {
    const plain = await fresh();
    const want = (await board(plain.env, null, "10:10:00")).etas;
    const { env } = await fresh((db) => history(db, [300, 300, 300]));
    const got = (await board(env, null, "10:10:00")).etas;
    a.eq(JSON.stringify(got), JSON.stringify(want));
  });

  s.test("a stand is measured from the driving phone's fixes, on the server's clock", async (a) => {
    const { env, db } = await fresh();
    sheetSays(600, {});
    await board(env, FAR, "10:18:00");
    await board(env, AT_N03, "10:18:30");
    await board(env, AT_N03, "10:19:00");
    await board(env, AT_N03, "10:19:30");
    await board(env, AT_N03, "10:20:00");
    await atTime(at("10:20:10"), () => W.handleTrip(env, { trip: "t1", route: "North", driver: ME,
      reg: "YS70 PWE", sunday: KEY, phone: "phoneA", events: [{ event: "pickup", stopId: "N03", at: T("10:20:10") }] }));
    await board(env, AT_N03, "10:20:20");
    await board(env, FAR, "10:20:45");
    const r = await db.prepare("SELECT * FROM stop_dwell WHERE trip='t1'").all();
    a.eq(r.results.length, 1, "one stand, at Litherland Rd");
    const d = r.results[0];
    a.eq(d.stop_id, "N03"); a.eq(d.name, "Litherland Rd");
    a.eq(d.arrived, T("10:18:30")); a.eq(d.left_at, T("10:20:45"));
    a.eq(d.sure_in, 1); a.eq(d.sure_out, 1);
  });

  s.test("a phone silent on the way in or out: the stand is not sure", async (a) => {
    const { env, db } = await fresh();
    sheetSays(600, {});
    await board(env, FAR, "10:15:00");
    await board(env, AT_N03, "10:18:30");     /* three and a half minutes since the last fix */
    await board(env, AT_N03, "10:19:00");
    await board(env, FAR, "10:22:00");        /* three minutes without one */
    const d = await db.prepare("SELECT * FROM stop_dwell WHERE trip='t1'").first();
    a.eq(d.sure_in, 0); a.eq(d.sure_out, 0);
  });

  s.test("a vague fix does not start a stand", async (a) => {
    const { env, db } = await fresh();
    sheetSays(600, {});
    await board(env, FAR, "10:18:00");
    await board(env, Object.assign({}, AT_N03, { acc: 150 }), "10:18:30");
    const r = await db.prepare("SELECT * FROM stop_dwell WHERE trip='t1'").all();
    a.eq(r.results.length, 0);
  });

  s.test("the server says w2.97.0", async (a) => {
    a.eq(W.SCRIPT_VERSION || (await import("node:fs")).readFileSync(join(root, "server", "worker.js"), "utf8").match(/SCRIPT_VERSION = "([^"]+)"/)[1], "w2.97.0");
  });

  return s;
}
