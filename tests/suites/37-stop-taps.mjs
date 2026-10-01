/* A STOP TAP, IN THE DRIVER APP'S OWN WORDS.

   The driver app sends "pickup" for Picked up and "empty" for Nobody there,
   and always has. Up to w2.30.0 the tap alerts, the Run record and the
   coordinator's Add looked for "picked" and "none" instead, which were the
   words the other suites sent, so every one of those passed while not one
   real tap woke the next stop's passengers or reached the Run record.

   So nothing here is typed: the words are read out of index.html, from the
   buttons a driver presses, and sent to the live server as the phone sends
   them. Every check fails on w2.30.0. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-10-04";
const ON_THE_ROAD = "2026-10-04T10:20:00+01:00";
const AFTER = "2026-10-04T11:40:00+01:00";
const PIN = "1234";

export default async function (root) {
  const s = new Suite("a stop tap, in the driver app's own words");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  /* What the driver's buttons say, straight off the page. */
  const app = readFileSync(join(root, "index.html"), "utf8");
  const said = [...new Set([...app.matchAll(/data-tripkind="([a-z]+)"/g)].map((m) => m[1]))];
  const PICKED = said.find((k) => /pick/.test(k));
  const EMPTY = said.find((k) => !/pick/.test(k));

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await W.cachePut(env, "passenger_rules",
      { resendMinutes: 3, morningMessage: true, quietFrom: 21, quietTo: 8 }).run();
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
      .bind("Bro Arthur", "Coordinator", "North", 1, await W.pinHashOf(env, "Bro Arthur", PIN)).run();
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    return { db, env };
  }

  async function seat(db, stopId) {
    await db.prepare(
      "INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received, synced) " +
      "VALUES (?,?,?,?,?,?,?,?,'Booked',?,0)"
    ).bind(KEY, "North", stopId, stopId, 2, "dev-" + stopId, "pid-" + stopId, "07700900001", Date.now()).run();
  }
  async function phone(db, stopId) {
    const ep = "https://push.example/pax-" + stopId;
    await db.prepare(
      "INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, driver, route, made, seen, fails, last) " +
      "VALUES (?,?,?,?,?,?,?,?,?,0,0,'')"
    ).bind(ep, "p", "a", "passenger", "dev-" + stopId, "pid-" + stopId, "", "", Date.now()).run();
    return ep;
  }
  const lastOf = (db, stopId) =>
    String((db._rows("SELECT last FROM push_subs WHERE ref=?", "dev-" + stopId)[0] || {}).last || "");

  const trip = (env, events) => W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian",
    reg: "YS70 PWE", sunday: KEY, events: events });
  async function setOff(db, env) {
    await trip(env, [{ event: "start", at: Date.parse("2026-10-04T09:52:00+01:00") }]);
    db.prepare("UPDATE push_subs SET last=''").run();     /* the departure's own message, cleared */
  }

  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const coord = async (env, body) =>
    J(await post(env, Object.assign({ action: "coord", who: "Bro Arthur", pin: PIN }, body)));
  let n = 0;
  const act = (env, a) => coord(env, { op: "act", act: Object.assign({ id: "tap-act-" + (++n) }, a) });

  /* ---- the words ---------------------------------------------------------- */

  s.test("every tap a driver's button can send is read by the live server as a stop tap", (a) => {
    a.ok(PICKED && EMPTY, "the driver app's Picked up and Nobody there buttons were not found: " + said.join(", "));
    for (const k of said) a.ok(W.isStopTap(k), "the driver app sends \"" + k + "\" and the live server does not know it");
    /* And the older words, which the coordinator's Add wrote before w2.30.1. */
    a.ok(W.isStopTap("picked") && W.isStopTap("none"), "rows already on the record stopped counting");
    a.not(W.isStopTap("start") || W.isStopTap("end") || W.isStopTap("undo"), "a start or an end was read as a stop");
  });

  /* ---- the passengers ----------------------------------------------------- */

  s.test("Picked up, as the phone sends it, wakes the next stop's passengers", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      await seat(db, "N04"); await phone(db, "N04");
      await setOff(db, env);
      await trip(env, [{ event: PICKED, stopId: "N03", at: Date.now() }]);
      a.has(lastOf(db, "N04"), "next|", "the stop after the one just marked was not woken");
    });
  });

  s.test("Nobody there, as the phone sends it, wakes them too", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      await seat(db, "N04"); await phone(db, "N04");
      await setOff(db, env);
      await trip(env, [{ event: EMPTY, stopId: "N03", at: Date.now() }]);
      a.has(lastOf(db, "N04"), "next|", "an empty kerb is still the stop before theirs being done");
    });
  });

  s.test("a stop the bus went past unmarked is told so, from a real tap further on", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      await seat(db, "N01"); const ep = await phone(db, "N01");
      await setOff(db, env);
      await trip(env, [{ event: PICKED, stopId: "N03", at: Date.now() }]);
      a.has(lastOf(db, "N01"), "past|", "the bus went past him and his phone said nothing");
      a.has((await W.pushWhat(env, ep)).title, "gone past");
    });
  });

  s.test("a stop marked Nobody there is not told it was picked up", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      await seat(db, "N03"); const ep = await phone(db, "N03");
      await setOff(db, env);
      await trip(env, [{ event: EMPTY, stopId: "N03", at: Date.now() }]);
      const out = await W.pushWhat(env, ep);
      a.has(out.title, "Nobody there", "got: " + out.title);
      a.hasnt(out.title, "Picked up", "somebody still at the kerb was told he was on the bus");
      /* And Picked up still says Picked up. */
      const { db: db2, env: env2 } = await fresh();
      await seat(db2, "N03"); const ep2 = await phone(db2, "N03");
      await setOff(db2, env2);
      await trip(env2, [{ event: PICKED, stopId: "N03", at: Date.now() }]);
      a.has((await W.pushWhat(env2, ep2)).title, "Picked up");
    });
  });

  /* ---- the Run record ----------------------------------------------------- */

  s.test("the Run record shows the driver's taps, and which were Nobody there", async (a) => {
    await atTime(AFTER, async () => {
      const { env } = await fresh();
      const t0 = Date.parse("2026-10-04T09:52:00+01:00");
      await trip(env, [{ event: "start", at: t0 },
                       { event: PICKED, stopId: "N01", at: t0 + 11 * 60000 },
                       { event: EMPTY, stopId: "N02", at: t0 + 22 * 60000 },
                       { event: "end", at: t0 + 70 * 60000 }]);
      const runs = await coord(env, { op: "runs", sunday: KEY });
      a.ok(runs.ok, JSON.stringify(runs).slice(0, 200));
      const stops = runs.routes.find((r) => r.route === "North").runs[0].stops;
      const n01 = stops.find((x) => x.id === "N01"), n02 = stops.find((x) => x.id === "N02");
      a.ok(n01.ev, "a stop the driver marked Picked up shows as not marked");
      a.ok(n02.ev, "a stop the driver marked Nobody there shows as not marked");
      a.eq(n02.ev.event, EMPTY);
      a.eq(stops.find((x) => x.id === "N03").ev, null, "a stop nobody tapped was given a time");
    });
  });

  s.test("Add will not put a second time beside a driver's real tap, and writes the driver app's word", async (a) => {
    await atTime(AFTER, async () => {
      const { db, env } = await fresh();
      const t0 = Date.parse("2026-10-04T09:52:00+01:00");
      await trip(env, [{ event: "start", at: t0 },
                       { event: PICKED, stopId: "N01", at: t0 + 11 * 60000 },
                       { event: EMPTY, stopId: "N02", at: t0 + 22 * 60000 }]);
      for (const stopId of ["N01", "N02"]) {
        const out = await act(env, { kind: "fix", sunday: KEY, trip: "t1", stopId: stopId, time: "10:30" });
        a.not(out.ok, stopId + " was added again beside the driver's tap");
        a.has(String(out.error || ""), "already has a time");
      }
      a.eq(db._rows("SELECT id FROM trip_events WHERE stop_id IN ('N01','N02')").length, 2);

      const added = await act(env, { kind: "fix", sunday: KEY, trip: "t1", stopId: "N03", time: "10:30" });
      a.ok(added.ok, JSON.stringify(added));
      const row = db._one("SELECT * FROM trip_events WHERE trip='t1' AND stop_id='N03'");
      a.eq(row.event, PICKED, "the Trip Events tab would carry two words for one thing");
      const again = await act(env, { kind: "fix", sunday: KEY, trip: "t1", stopId: "N03", time: "10:31" });
      a.not(again.ok, "a stop already added could be added a second time");
    });
  });

  return s;
}
