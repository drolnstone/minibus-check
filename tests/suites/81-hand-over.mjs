/* HAND OVER, 2 November 2026. pages v1.144.0 · server w2.76.0; the new driver's push from w2.77.0.

   Asim: a driver may do the morning run, or part of it, and somebody else
   finish it or do the afternoon. A coordinator hands the route's run to the
   other driver in the coordinator app. Mid-run he carries on from the next
   stop under his own name; after the run, the parked mileage is his to key.
   Nobody signs in as anybody else. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-10-18";
const PIN = "1234";
const REG = "YS70 PWE";
const T = (hhmm) => "2026-10-18T" + hhmm + ":00+01:00";
const at = (hhmm) => Date.parse(T(hhmm));

export default async function (root) {
  const s = new Suite("hand over a run to another driver");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  const PEOPLE = [["Bro Asim", "Coordinator", "North"], ["Bro Moses", "Driver", "North"],
                  ["Bro Adesina", "Driver", "North"], ["Bro Tunde", "Driver", "South"]];
  const EP = (w) => "https://push.test/" + w;

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY, { north: "Bro Moses", south: "Bro Tunde" });
    await db.prepare("DELETE FROM drivers").run();
    for (const d of PEOPLE) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind(d[0], d[1], d[2], await W.pinHashOf(env, d[0], PIN)).run();
      await db.prepare("INSERT INTO push_subs (endpoint, p256dh, auth, role, driver, made) VALUES (?,?,?,?,?,?)")
        .bind(EP(d[0]), "p", "a", "driver", d[0], Date.now()).run();
    }
    await W.handleSync(env, { authRules: { roles: ["Coordinator"], sameHandBothWays: true } });
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  let n = 0;
  const hand = async (env, route, to) => J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN,
    op: "act", act: { id: "hand-" + (++n), kind: "rota", sunday: KEY, handover: route,
                      set: { [route === "South" ? "southCover" : "northCover"]: to } } }));
  const tap = (env, driver, phone, events, trip, route) => W.handleTrip(env, {
    trip: trip || "t1", route: route || "North", driver, reg: route === "South" ? "YS70 PWF" : REG,
    sunday: KEY, phone, events });
  const boxOf = async (env, who) => ((await W.cacheGet(env, "calert:" + EP(who))) || []).filter((m) => m.kind === "change");

  async function morning(env) {
    await atTime(T("09:52"), () => tap(env, "Bro Moses", "p1", [{ event: "start", at: at("09:52") }]));
    await atTime(T("10:04"), () => tap(env, "Bro Moses", "p1", [{ event: "pickup", stopId: "N01", at: at("10:04") }]));
  }

  s.test("mid-run: the run is the new driver's, and the record says when it changed hands", async (a) => {
    const { db, env } = await fresh();
    await morning(env);
    const out = await atTime(T("10:10"), () => hand(env, "North", "Bro Adesina"));
    a.ok(out.ok, JSON.stringify(out));
    a.eq(out.action.words, "North: run handed to Bro Adesina (was Bro Moses).");
    const st = await atTime(T("10:11"), () => W.tripState(env, KEY, "North"));
    a.eq(st.driver, "Bro Adesina");
    a.eq(st.handed.from, "Bro Moses");
    a.ok(st.served.N01, "the stop already marked was lost");
    const start = db._rows("SELECT fix_note FROM trip_events WHERE event='start'")[0];
    a.ok(/North run handed to Bro Adesina at 10:10 by Bro Asim \(was Bro Moses\)\./.test(start.fix_note), start.fix_note);
    const rota = await atTime(T("10:11"), () => W.currentRota(env, KEY));
    a.eq(rota.northCover, "Bro Adesina", "the Rota's cover was not changed");
    a.ok(/North run handed to Bro Adesina/.test(rota.notes || ""), "no note on the Rota");
  });

  s.test("the old driver's phone is refused; the new one carries on under his own name", async (a) => {
    const { db, env } = await fresh();
    await morning(env);
    await atTime(T("10:10"), () => hand(env, "North", "Bro Adesina"));
    const old = await J(await atTime(T("10:15"), () => tap(env, "Bro Moses", "p1", [{ event: "pickup", stopId: "N02", at: at("10:15") }])));
    a.not(old.ok);
    a.eq(old.error, "handed over");
    a.eq(old.run.driver, "Bro Adesina");
    const nw = await J(await atTime(T("10:16"), () => tap(env, "Bro Adesina", "p2", [{ event: "pickup", stopId: "N02", at: at("10:16") }])));
    a.ok(nw.ok, JSON.stringify(nw));
    const row = db._rows("SELECT driver FROM trip_events WHERE stop_id='N02'")[0];
    a.eq(row.driver, "Bro Adesina");
    a.eq(db._rows("SELECT driver FROM trip_events WHERE stop_id='N01'")[0].driver, "Bro Moses", "the earlier stop changed name");
    const end = await J(await atTime(T("11:00"), () => tap(env, "Bro Adesina", "p2", [{ event: "end", at: at("11:00"), auto: true }])));
    a.ok(end.ok, "the new driver could not end it: " + JSON.stringify(end));
  });

  s.test("the old driver is told; the new one gets his own push with the next stop", async (a) => {
    const { db, env } = await fresh();
    await morning(env);
    await atTime(T("10:10"), () => hand(env, "North", "Bro Adesina"));
    a.eq((await boxOf(env, "Bro Moses")).length, 1, "the old driver was not told");
    a.eq((await boxOf(env, "Bro Adesina")).length, 0, "the new driver was sent Change by as well");
    a.eq((await boxOf(env, "Bro Tunde")).length, 0, "the South driver was told");
    const last = db._one("SELECT last FROM push_subs WHERE endpoint=?", EP("Bro Adesina")).last;
    a.ok(/^handed\|2026-10-18\|North\|t1/.test(last), "the new driver was not woken: " + last);
    const said = await atTime(T("10:11"), () => W.pushWhat(env, EP("Bro Adesina")));
    a.eq(said.title, "North run handed to you");
    a.eq(said.body, "Next stop Grace Rd.");
  });

  s.test("after the run, his push is the parked mileage line", async (a) => {
    const { db, env } = await fresh();
    await morning(env);
    await atTime(T("10:58"), () => tap(env, "Bro Moses", "p1", [{ event: "end", at: at("10:58") }]));
    await db.prepare("INSERT INTO checks_in (check_id, reg, driver, received, body) VALUES ('c1',?,?,?,?)")
      .bind(REG, "Bro Moses", at("08:00"), JSON.stringify({ miles: 57363 })).run().catch(() => {});
    const r = await atTime(T("13:00"), () => hand(env, "North", "Bro Adesina"));
    if (!r.ok) { a.eq(r.error, "", "refused"); return; }
    const said = await atTime(T("13:01"), () => W.pushWhat(env, EP("Bro Adesina")));
    a.eq(said.title, "North run handed to you");
    a.eq(said.body, "Record the bus parked mileage when you return from the afternoon run.");
  });

  s.test("his phone is told which route his run is on", async (a) => {
    const { env } = await fresh();
    await morning(env);
    await atTime(T("10:10"), () => hand(env, "North", "Bro Adesina"));
    const b = await J(await atTime(T("10:12"), () => W.default.fetch(new Request(
      "https://worker.test/?board=1&route=South&driver=Bro%20Adesina&phone=p2"), makeEnv(env.DB), {})));
    a.eq(b.myRun, "North");
  });

  s.test("refused: no run yet, the same driver, or a man out on the other route", async (a) => {
    const { env } = await fresh();
    let r = await atTime(T("09:40"), () => hand(env, "North", "Bro Adesina"));
    a.eq(r.error, "The North run has not started.");
    await morning(env);
    r = await atTime(T("10:10"), () => hand(env, "North", "Bro Moses"));
    a.eq(r.error, "Bro Moses has the North run already.");
    r = await atTime(T("10:10"), () => hand(env, "North", "Bro Tunde"));
    a.eq(r.error, "Bro Tunde is driving South this morning.");
    await atTime(T("10:21"), () => tap(env, "Bro Tunde", "p3", [{ event: "start", at: at("10:21") }], "t2", "South"));
    await atTime(T("10:50"), () => tap(env, "Bro Tunde", "p3", [{ event: "end", at: at("10:50") }], "t2", "South"));
    r = await atTime(T("10:52"), () => hand(env, "North", "Bro Tunde"));
    a.ok(r.ok, "the South driver, his run over, could not take North: " + JSON.stringify(r));
  });

  s.test("after the run: the parked mileage moves to the new driver", async (a) => {
    const { env } = await fresh();
    const key = await atTime(T("08:00"), async () => {
      await post(env, { action: "check", key: (await J(await post(env, { action: "pin", pin: { driver: "Bro Moses", pin: PIN } }))).key,
        check: { id: "c1", reg: REG, level: "ok", driver: "Bro Moses", miles: "57363" } });
      return (await J(await post(env, { action: "pin", pin: { driver: "Bro Adesina", pin: PIN } }))).key;
    });
    await morning(env);
    await atTime(T("10:58"), () => tap(env, "Bro Moses", "p1", [{ event: "end", at: at("10:58") }]));
    const r = await atTime(T("13:00"), () => hand(env, "North", "Bro Adesina"));
    a.ok(r.ok, JSON.stringify(r));
    const mine = await J(await atTime(T("15:30"), () => post(env, { action: "parked", key,
      parked: { reg: REG, checkId: "c1", miles: 57420, driver: "Bro Adesina" } })));
    a.ok(mine.ok, "the new driver could not key it: " + JSON.stringify(mine));
    const again = await atTime(T("15:40"), () => hand(env, "North", "Bro Moses"));
    a.eq(again.error, "The North run is over and its parked mileage is in.");
  });

  /* ---- a driver asks, a coordinator answers (w2.77.0) ---- */
  const keyFor = async (env, who) => (await J(await post(env, { action: "pin", pin: { driver: who, pin: PIN } }))).key;
  const ask = async (env, who, to, route) => J(await post(env, { action: "handask", driver: who,
    key: await keyFor(env, who), route: route || "North", to }));

  s.test("the driver asks; coordinators see it; one approval hands the run over", async (a) => {
    const { db, env } = await fresh();
    await morning(env);
    const out = await atTime(T("10:10"), () => ask(env, "Bro Moses", "Bro Adesina"));
    a.ok(out.ok, JSON.stringify(out));
    a.eq(out.ask.status, "pending");
    const load = await atTime(T("10:11"), async () => J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN, op: "load" })));
    a.eq((load.handAsks || []).length, 1, "the coordinator app does not show it");
    const id = load.handAsks[0].id;
    a.eq((await atTime(T("10:11"), () => W.tripState(env, KEY, "North"))).driver, "Bro Moses", "handed over before approval");
    const ok = await atTime(T("10:12"), async () => J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN,
      op: "act", act: { id: "hand-ask-1", kind: "rota", sunday: KEY, handover: "North", ask: id, set: { northCover: "Bro Adesina" } } })));
    a.ok(ok.ok, JSON.stringify(ok));
    a.eq(ok.action.words, "North: run handed to Bro Adesina (was Bro Moses), asked by Bro Moses.");
    a.eq((await atTime(T("10:13"), () => W.tripState(env, KEY, "North"))).driver, "Bro Adesina");
    a.eq(db._one("SELECT status FROM handasks WHERE id=?", id).status, "approved");
    const again = await atTime(T("10:13"), async () => J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN,
      op: "act", act: { id: "hand-ask-2", kind: "rota", sunday: KEY, handover: "North", ask: id, set: { northCover: "Bro Tunde" } } })));
    a.not(again.ok, "answered twice");
  });

  s.test("only the driver holding the run can ask, and only for a driver who may take it", async (a) => {
    const { env } = await fresh();
    await morning(env);
    let r = await atTime(T("10:10"), () => ask(env, "Bro Adesina", "Bro Tunde"));
    a.eq(r.error, "Nothing to hand over.");
    r = await atTime(T("10:10"), () => ask(env, "Bro Moses", "Bro Tunde"));
    a.eq(r.error, "Bro Tunde is driving South this morning.");
    r = await atTime(T("10:10"), () => post(env, { action: "handask", driver: "Bro Moses", key: "nope", route: "North", to: "Bro Adesina" }).then(J));
    a.eq(r.error, "pin");
  });

  s.test("turned down: nothing moves, and the driver is told", async (a) => {
    const { db, env } = await fresh();
    await morning(env);
    const out = await atTime(T("10:10"), () => ask(env, "Bro Moses", "Bro Adesina"));
    const no = await atTime(T("10:11"), async () => J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN,
      op: "act", act: { id: "hand-no-1", kind: "handno", ask: out.ask.id } })));
    a.ok(no.ok, JSON.stringify(no));
    a.eq((await atTime(T("10:12"), () => W.tripState(env, KEY, "North"))).driver, "Bro Moses");
    const last = db._one("SELECT last FROM push_subs WHERE endpoint=?", EP("Bro Moses")).last;
    a.ok(/^handno\|/.test(last), "the driver was not woken: " + last);
    const said = await atTime(T("10:12"), () => W.pushWhat(env, EP("Bro Moses")));
    a.eq(said.title, "North: hand over turned down");
    a.eq(said.body, "Hand over to Bro Adesina turned down.");
  });

  s.test("an ask nobody answers lapses after half an hour", async (a) => {
    const { env } = await fresh();
    await morning(env);
    const out = await atTime(T("10:10"), () => ask(env, "Bro Moses", "Bro Adesina"));
    const load = await atTime(T("10:41"), async () => J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN, op: "load" })));
    a.eq((load.handAsks || []).length, 0, "still shown to coordinators after 30 minutes");
    const late = await atTime(T("10:41"), async () => J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN,
      op: "act", act: { id: "hand-late-1", kind: "rota", sunday: KEY, handover: "North", ask: out.ask.id, set: { northCover: "Bro Adesina" } } })));
    a.eq(late.error, "That hand over was not answered in time.");
    const duty = await atTime(T("10:41"), async () => J(await post(env, { action: "duty", driver: "Bro Moses" })));
    a.eq(duty.hand && duty.hand.ask && duty.hand.ask.status, "lapsed", "the driver's card does not say so");
    const again = await atTime(T("10:42"), () => ask(env, "Bro Moses", "Bro Adesina"));
    a.ok(again.ok, "could not ask again: " + JSON.stringify(again));
  });

  return s;
}
