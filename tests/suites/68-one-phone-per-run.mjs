/* ONE PHONE PER RUN. server w2.59.0, driver app v1.114.0 (Asim, 12 Oct 2026).

   A driver signed in on two phones could drive one live run from both. Now
   the run belongs to the phone that started it: another phone of his is
   refused at sign-in and its taps are refused, until the run's phone has
   been quiet for five minutes. Then the other phone takes the run over from
   where it stopped, and the first phone is refused.

   Everything here fails on w2.58.0. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-10-04";
const START = "2026-10-04T09:52:00+01:00";
const PIN = "1234";
const ME = "Bro Adrian";

export default async function (root) {
  const s = new Suite("one phone per run");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());
  const at = (hhmm) => "2026-10-04T" + hhmm + ":00+01:00";

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,?,?)")
      .bind(ME, "Driver", "North", 1, 1, await W.pinHashOf(env, ME, PIN)).run();
    return { db, env };
  }
  const tap = async (env, phone, events) => J(await W.handleTrip(env, { trip: "t1", route: "North", driver: ME,
    reg: "YS70 PWE", sunday: KEY, phone: phone, events: events }));
  const signIn = async (env, phone) => J(await W.handlePin(env, { driver: ME, pin: PIN, phone: phone }));
  const board = async (env, phone) => (await W.boardPayload(env, "North", phone, ME)).trip;

  s.test("the phone that started the run drives it; another phone is refused", async (a) => {
    const { env } = await fresh();
    await atTime(START, async () => {
      a.ok((await tap(env, "phoneA", [{ event: "start", at: Date.now() }])).ok);
    });
    await atTime(at("10:03"), async () => {
      a.ok((await tap(env, "phoneA", [{ event: "picked", stopId: "N01", at: Date.now() }])).ok);
      const b = await tap(env, "phoneB", [{ event: "picked", stopId: "N02", at: Date.now() }]);
      a.eq(b.error, "other phone", JSON.stringify(b));
      const pin = await signIn(env, "phoneB");
      a.eq(pin.valid, false); a.eq(pin.elsewhere, true);
      a.eq((await signIn(env, "phoneA")).valid, true, "the run's own phone");
      a.eq((await board(env, "phoneB")).phone.here, false);
      a.eq((await board(env, "phoneA")).phone.here, true);
    });
  });

  s.test("after five quiet minutes another phone takes the run over from where it stopped", async (a) => {
    const { env } = await fresh();
    await atTime(START, async () => { await tap(env, "phoneA", [{ event: "start", at: Date.now() }]); });
    await atTime(at("10:03"), async () => {
      await tap(env, "phoneA", [{ event: "picked", stopId: "N01", at: Date.now() }]);
    });
    await atTime(at("10:07"), async () => {
      a.eq((await signIn(env, "phoneB")).elsewhere, true, "four minutes is not quiet");
    });
    await atTime(at("10:09"), async () => {
      a.eq((await signIn(env, "phoneB")).valid, true, "six minutes is");
      const t = await board(env, "phoneB");
      a.eq(t.phone.here, true, "taken over");
      a.ok(t.served && t.served.N01, "N01 still marked");
      a.ok((await tap(env, "phoneB", [{ event: "picked", stopId: "N02", at: Date.now() }])).ok);
      const back = await tap(env, "phoneA", [{ event: "picked", stopId: "N03", at: Date.now() }]);
      a.eq(back.error, "other phone", "the first phone, back, is refused");
      a.eq((await board(env, "phoneA")).phone.here, false);
    });
  });

  s.test("a phone that sends no handle (an older app) is judged as before", async (a) => {
    const { env } = await fresh();
    await atTime(START, async () => { await tap(env, "phoneA", [{ event: "start", at: Date.now() }]); });
    await atTime(at("10:03"), async () => {
      a.ok((await tap(env, "", [{ event: "picked", stopId: "N01", at: Date.now() }])).ok);
      a.eq((await signIn(env, "")).valid, true);
    });
  });

  s.test("the driver app sends its handle with taps, the board poll and the PIN", async (a) => {
    const app = readFileSync(join(root, "index.html"), "utf8");
    a.ok(/phone: myPhone\(\),\s*events: batch/.test(app), "taps");
    a.ok(app.indexOf('"&phone="+encodeURIComponent(myPhone())') !== -1, "board poll");
    /* Three from v1.123.0: the sign-in key is fetched the same way. */
    a.eq((app.match(/pin: st\.pin, phone: myPhone\(\)/g) || []).length, 3, "every PIN call");
    a.ok(app.indexOf('error==="other phone"') !== -1, "a refused tap lets the run go");
  });

  return s;
}
