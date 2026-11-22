/* A STOP ON THE OTHER ROUTE FOR ONE SUNDAY. 22 November 2026. server w2.103.0.

   Asim: one route overbooked, the other with room. From the Coordinator App
   a whole stop, bookings and all, goes to the other route's bus for the
   coming Sunday and comes back by itself after it. The stop's passengers,
   the driver it goes to and the driver it leaves are each told once; the
   passengers are told which bus takes them home. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const THU = "2026-11-19T12:00:00Z";
const KEY = "2026-11-22", NEXT = "2026-11-29";
const PIN = "1234";
const PH = "07700900111";

export default async function (root) {
  const s = new Suite("stop moved for one Sunday");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    for (const d of [["Bro Asim", "Coordinator", "North"], ["Bro Adrian", "Driver", "North"], ["Bro Trevor", "Driver", "South"]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind(d[0], d[1], d[2], await W.pinHashOf(env, d[0], PIN)).run();
    }
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    const pid = await W.passengerId(env, PH);
    await db.prepare("INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, made) VALUES (?,?,?,?,?,?,?)")
      .bind("https://push.test/p", "p", "a", "passenger", "dev", pid, Date.now()).run();
    for (const k of [KEY, NEXT]) {
      await db.prepare("INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received, synced) " +
                       "VALUES (?,?,?,?,?,?,?,?,?,?,1)").bind(k, "North", "N05", "Bedford Rd", 3, "dev", pid, PH, "Booked", Date.now()).run();
    }
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  let n = 0;
  const act = async (env, a) => J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN, op: "act",
    act: Object.assign({ id: "move-act-" + (++n), kind: "stopmove" }, a) }));
  const mails = (db) => db._rows("SELECT body FROM coord_actions WHERE kind='mail'").map((r) => JSON.parse(r.body));
  const ids = (list, rt) => W.pickupsAndArrivals(list).filter((x) => x.route === rt && !x.arrival).map((x) => x.id).join(",");
  const seats = async (env, key, rt) => (await W.seatsFor(env, key, rt, W.pickupsAndArrivals(await W.getStops(env, key)),
    await W.getBuses(env), await W.getRotaRow(env, key), await W.liveBookings(env, key))).booked;

  s.test("Bedford Rd to South after Vicar Rd: bookings go with it, this Sunday only", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      const out = await act(env, { op: "move", stopId: "N05", after: "S02", time: "10:35" });
      a.ok(out.ok, JSON.stringify(out));
      a.has(out.action.words, "Bedford Rd moved to the South bus at 10:35, after Vicar Rd, 3 seats booked.");
      const now = await W.getStops(env);
      a.eq(ids(now, "South"), "S01,S02,N05,S03,S04,S05,S06,S07");
      a.hasnt(ids(now, "North"), "N05");
      a.eq(await seats(env, KEY, "South"), 3);
      a.eq(await seats(env, KEY, "North"), 0);
      /* The Sunday after keeps its own timetable. */
      a.has(ids(await W.getStops(env, NEXT), "North"), "N05");
      a.eq(await seats(env, NEXT, "North"), 3);
      const row = db._one("SELECT synced, ok FROM coord_actions WHERE kind='stopmove'");
      a.eq(row.synced, 1, "the sheet has nothing to file for a move");
    });
  });

  s.test("the passenger is told once, with the bus home; both drivers told", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      const out = await act(env, { op: "move", stopId: "N05", after: "S02", time: "10:35" });
      a.ok(out.ok, JSON.stringify(out));
      const box = (await W.cacheGet(env, W.coordBoxKey("https://push.test/p"))) || [];
      a.eq(box.length, 1, JSON.stringify(box));
      a.eq(box[0].title, "South bus at Bedford Rd");
      a.eq(box[0].body, "Sun 22 Nov: the South bus picks you up at 10:35. After service, the North bus home.");
      const m = mails(db);
      const by = {};
      for (const x of m) for (const nm of x.names) by[nm] = x;
      a.eq(Object.keys(by).sort().join(","), "Bro Adrian,Bro Trevor");
      a.eq(by["Bro Trevor"].title, "Stop added");
      a.eq(by["Bro Trevor"].body, "Sun 22 Nov South: Bedford Rd at 10:35, after Vicar Rd, 3 seats. This Sunday only.");
      a.eq(by["Bro Adrian"].title, "Stop moved");
      a.eq(by["Bro Adrian"].body, "Sun 22 Nov North: Bedford Rd is on the South bus. This Sunday only.");
    });
  });

  s.test("back by itself on the Monday; first pickup when none is chosen", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { op: "move", stopId: "N05", after: "", time: "10:25" });
      a.ok(out.ok, JSON.stringify(out));
      a.eq(ids(await W.getStops(env), "South"), "N05,S01,S02,S03,S04,S05,S06,S07");
      const again = await act(env, { op: "move", stopId: "N05", after: "S02", time: "10:35" });
      a.not(again.ok);
      a.has(again.error, "already");
      await atTime("2026-11-23T08:00:00Z", async () => {
        a.has(ids(await W.getStops(env), "North"), "N05");
        a.hasnt(ids(await W.getStops(env), "South"), "N05");
      });
    });
  });

  s.test("Put back: on its own route again, everybody told once more", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      a.ok((await act(env, { op: "move", stopId: "N05", after: "S02", time: "10:35" })).ok);
      const out = await act(env, { op: "back", stopId: "N05" });
      a.ok(out.ok, JSON.stringify(out));
      a.has(ids(await W.getStops(env), "North"), "N05");
      const box = (await W.cacheGet(env, W.coordBoxKey("https://push.test/p"))) || [];
      a.eq(box.length, 2);
      a.eq(box[1].title, "North bus at Bedford Rd");
      a.eq(box[1].body, "Sun 22 Nov: the North bus picks you up at 10:39, as usual.");
      const m = mails(db);
      const by = {};
      for (const x of m) for (const nm of x.names) by[nm] = x;
      a.eq(by["Bro Adrian"].title, "Stop back");
      a.eq(by["Bro Trevor"].title, "Stop taken off");
      const twice = await act(env, { op: "back", stopId: "N05" });
      a.not(twice.ok);
    });
  });

  s.test("refused once the bus has been to the stop, or for a route called off", async (a) => {
    await atTime("2026-11-22T10:45:00Z", async () => {
      const { db, env } = await fresh();
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian", reg: "YS70 PWE", sunday: KEY,
                                events: [{ event: "start", at: Date.now() - 1800000 },
                                         { event: "picked", stopId: "N05", at: Date.now() - 300000 }] });
      const out = await act(env, { op: "move", stopId: "N05", after: "S02", time: "10:35" });
      a.not(out.ok);
      a.has(out.error, "already been");
      await db.prepare("UPDATE rota SET status='South cancelled' WHERE sunday=?").bind(KEY).run();
      const off = await act(env, { op: "move", stopId: "N04", after: "S02", time: "10:35" });
      a.not(off.ok);
      a.has(off.error, "not running");
    });
  });

  s.test("a time that does not fit between the stops either side is refused", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { op: "move", stopId: "N05", after: "S02", time: "10:39" });
      a.not(out.ok);
      a.eq(out.error, "Pick a time from 10:33 to 10:37.");
      const none = await act(env, { op: "move", stopId: "N05", after: "S02" });
      a.not(none.ok);
      a.has(none.error, "10:35");
    });
  });

  s.test("the time given moves with the booking, so no New time alert follows", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      await W.ensureBookSched(env);
      db._exec("UPDATE bookings SET sched='10:39'");
      a.ok((await act(env, { op: "move", stopId: "N05", after: "S02", time: "10:35" })).ok);
      a.eq(db._one("SELECT sched FROM bookings WHERE sunday=?", KEY).sched, "10:35");
      a.eq(db._one("SELECT sched FROM bookings WHERE sunday=?", NEXT).sched, "10:39");
      const st = (await W.getStops(env)).find((x) => x.id === "N05");
      a.eq(st.time, "10:35");
      a.eq(st.route, "South");
    });
  });

  s.test("live ETA: the moved stop is the South bus's next call after Vicar Rd, Google legs and dwell as any stop", async (a) => {
    await atTime("2026-11-22T10:34:00Z", async () => {
      const { env } = await fresh();
      a.ok((await act(env, { op: "move", stopId: "N05", after: "S02", time: "10:35" })).ok);
      const all = await W.getStops(env);
      const ordered = W.stopsOnRoute(all, "South");
      const now = Date.now();
      const N05 = ordered.find((x) => x.id === "N05"), S03 = ordered.find((x) => x.id === "S03");
      const live = { next_id: "N05", next_ms: now + 240000, fix_at: now, routed_fix_at: now,
                     legs: { [W.liveLegKey(N05, S03)]: { sec: 300 } } };
      const set = await W.etaSettings(env);
      const map = W.liveEtaMapFrom(KEY, ordered, "S02", new Set(["N05", "S03"]), set, live, now);
      a.ok(map, "no live estimate");
      a.eq(map.N05, now + 240000);
      a.eq(map.S03, now + 240000 + W.dwellAt(set, N05) * 1000 + 300000);
      /* Without the phone's location: the time typed for the day, after Vicar Rd. */
      const state = { trip: "t", started: now - 600000, ended: 0, lastStopId: "S02", offset: 0 };
      const eta = await W.stopEtaMs(env, KEY, "South", all, state, "N05", new Set(["N05", "S03"]), set, null);
      a.eq(new Date(eta).toISOString().slice(11, 16), "10:35");
    });
  });

  s.test("the Driver App's timetable (?rota=1) has the moved stop on South, in its place", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const { STOPS } = await import("../lib/seed.mjs");
      const sheetStops = STOPS.filter((x) => x.kind !== "depart").map((x) => ({ route: x.route, id: x.id, time: x.time, stop: x.stop,
        arrival: x.kind === "arrival", depart: false }));
      await W.cachePut(env, "cache_rota", { builtAt: Date.now(), from: "2026-11-01", to: "2027-06-01",
        payload: { ok: true, rows: [], stops: sheetStops } }).run();
      a.ok((await act(env, { op: "move", stopId: "N05", after: "S02", time: "10:35" })).ok);
      const out = await J(await W.default.fetch(new Request("https://worker.test/?rota=1&from=2026-11-22&weeks=4"), env, {}));
      a.ok(out.ok, JSON.stringify(out).slice(0, 200));
      const south = out.stops.filter((x) => x.route === "South" && !x.arrival).map((x) => x.id).join(",");
      a.eq(south, "S01,S02,N05,S03,S04,S05,S06,S07");
      a.eq(out.stops.find((x) => x.id === "N05").time, "10:35");
      a.hasnt(out.stops.filter((x) => x.route === "North").map((x) => x.id).join(","), "N05");
    });
  });

  return s;
}
