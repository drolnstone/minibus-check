/* WHOSE RUN IS IT TO END.

   On 20 September a driver's run was ended from another driver's phone. The
   phone was not misbehaving: it had adopted the run off the board, and once
   it held the run every test that asked "is this yours" answered yes.

   Two halves to the fix and this suite is the server half — the half that
   matters, because the app can be a version behind and the record cannot. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";

export default async function (root) {
  const s = new Suite("ending a run: whose it is, and the coordinator's way in");
  const { mod: W } = await loadWorker(root);
  const body = async (r) => JSON.parse(await r.text());

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    const key = W.runSunday();
    await seedSunday(db, key);
    for (const d of [
      ["Bro Arthur", "Coordinator"], ["Bro Adrian", "Driver"],
      ["Bro Martin", "Driver"], ["Pst Kenneth", "Minister in Charge"]
    ]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind(d[0], d[1], "North", await W.pinHashOf(env, d[0], "1234")).run();
    }
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,'')")
      .bind("Bro Cedric", "Coordinator", "North").run();
    await W.cachePut(env, "auth_rules",
      { roles: ["coordinator", "minister in charge"], sameHandBothWays: true }).run();
    return { db, env, key };
  }

  const started = (over) => Object.assign({
    trip: "t1", route: "North", driver: "Bro Adrian", reg: "YS70 PWE", events: []
  }, over || {});

  async function aRunIsOut(env, key) {
    await W.handleTrip(env, started({ sunday: key, events: [{ event: "start", at: Date.now() - 600000 }] }));
  }

  /* ---- the fault itself ------------------------------------------------ */

  s.test("another driver's phone cannot end this run", async (a) => {
    const { env, key } = await fresh();
    await aRunIsOut(env, key);
    const r = await body(await W.handleTrip(env, started({
      driver: "Bro Martin", sunday: key, events: [{ event: "end", at: Date.now() }]
    })));
    a.not(r.ok, "this is the 20 September fault and it must be refused outright");
    a.eq(r.error, "not your run");
    a.eq(r.run.driver, "Bro Adrian", "the refusal should name whose run it is");
  });

  s.test("and the run is still open afterwards", async (a) => {
    const { db, env, key } = await fresh();
    await aRunIsOut(env, key);
    await W.handleTrip(env, started({ driver: "Bro Martin", sunday: key, events: [{ event: "end", at: Date.now() }] }));
    a.eq(db._rows("SELECT * FROM trip_events WHERE event='end'").length, 0, "nothing at all should have been written");
    a.not((await W.tripState(env, key, "North")).ended);
  });

  s.test("a coordinator's phone cannot end it the ordinary way either", async (a) => {
    const { env, key } = await fresh();
    await aRunIsOut(env, key);
    const r = await body(await W.handleTrip(env, started({
      driver: "Bro Arthur", sunday: key, events: [{ event: "end", at: Date.now() }]
    })));
    a.not(r.ok, "his way in is endrun, behind his PIN, so the record says he did it");
    a.eq(r.error, "not your run");
  });

  s.test("the run's own driver ends it as he always did", async (a) => {
    const { env, key } = await fresh();
    await aRunIsOut(env, key);
    const r = await body(await W.handleTrip(env, started({
      sunday: key, events: [{ event: "end", at: Date.now() }]
    })));
    a.ok(r.ok, JSON.stringify(r));
    a.ok((await W.tripState(env, key, "North")).ended);
  });

  s.test("a name typed with different spacing or case is still the same man", async (a) => {
    const { env, key } = await fresh();
    await aRunIsOut(env, key);
    const r = await body(await W.handleTrip(env, started({
      driver: "  bro adrian ", sunday: key, events: [{ event: "end", at: Date.now() }]
    })));
    a.ok(r.ok, "both ends of every name here are typed by hand");
  });

  s.test("a wholly offline morning arriving at once is not refused", async (a) => {
    const { env, key } = await fresh();
    const r = await body(await W.handleTrip(env, started({
      sunday: key, events: [
        { event: "start", at: Date.now() - 3600000 },
        { event: "picked", stopId: "N01", at: Date.now() - 3000000 },
        { event: "end", at: Date.now() - 1800000 }
      ]
    })));
    a.ok(r.ok, "the batch carries its own start, so it is its own owner");
  });

  /* ---- a second end ---------------------------------------------------- */

  s.test("a second end is ignored rather than written as a second row", async (a) => {
    const { db, env, key } = await fresh();
    await aRunIsOut(env, key);
    const first = Date.now();
    await W.handleTrip(env, started({ sunday: key, events: [{ event: "end", at: first }] }));
    const r = await body(await W.handleTrip(env, started({ sunday: key, events: [{ event: "end", at: first + 300000 }] })));
    a.ok(r.ok);
    a.eq(r.endIgnored, 1);
    const rows = db._rows("SELECT * FROM trip_events WHERE event='end'");
    a.eq(rows.length, 1);
    a.eq(rows[0].happened, first, "the arrival time must stay the one he tapped, not creep with each retry");
  });

  /* ---- the coordinator's way in ---------------------------------------- */

  s.test("a coordinator closes another man's run with his PIN", async (a) => {
    const { env, key } = await fresh();
    await aRunIsOut(env, key);
    const r = await body(await W.handleEndRun(env, { endrun: { route: "North", who: "Bro Arthur", pin: "1234" } }));
    a.ok(r.ok, JSON.stringify(r));
    a.eq(r.by, "Bro Arthur");
    a.eq(r.driver, "Bro Adrian");
    a.ok((await W.tripState(env, key, "North")).ended);
  });

  s.test("the end row says who ended it, and still says whose run it was", async (a) => {
    const { db, env, key } = await fresh();
    await aRunIsOut(env, key);
    await W.handleEndRun(env, { endrun: { route: "North", who: "Bro Arthur", pin: "1234" } });
    const row = db._one("SELECT * FROM trip_events WHERE event='end'");
    a.eq(row.driver, "Bro Adrian", "it was his run and the record should go on saying so");
    a.eq(row.ended_by, "Bro Arthur");
  });

  s.test("an ordinary end records the driver as having ended it himself", async (a) => {
    const { db, env, key } = await fresh();
    await aRunIsOut(env, key);
    await W.handleTrip(env, started({ sunday: key, events: [{ event: "end", at: Date.now() }] }));
    const row = db._one("SELECT * FROM trip_events WHERE event='end'");
    a.eq(row.ended_by, "Bro Adrian", "so a run somebody else closed is visible by the two names differing");
  });

  s.test("an ordinary driver cannot use the coordinator's way in", async (a) => {
    const { env, key } = await fresh();
    await aRunIsOut(env, key);
    const r = await body(await W.handleEndRun(env, { endrun: { route: "North", who: "Bro Martin", pin: "1234" } }));
    a.not(r.ok);
    a.eq(r.error, "not authorised");
  });

  s.test("a wrong PIN does not close it, and three lock the gate", async (a) => {
    const { env, key } = await fresh();
    await aRunIsOut(env, key);
    for (let i = 0; i < 3; i++) {
      const r = await body(await W.handleEndRun(env, { endrun: { route: "North", who: "Bro Arthur", pin: "0000" } }));
      a.not(r.ok);
    }
    const r = await body(await W.handleEndRun(env, { endrun: { route: "North", who: "Bro Arthur", pin: "1234" } }));
    a.ok(r.locked);
    a.not((await W.tripState(env, key, "North")).ended);
  });

  s.test("a coordinator with no PIN on the register cannot close a run", async (a) => {
    const { env, key } = await fresh();
    await aRunIsOut(env, key);
    const r = await body(await W.handleEndRun(env, { endrun: { route: "North", who: "Bro Cedric", pin: "" } }));
    a.not(r.ok);
    a.eq(r.error, "no pin");
  });

  s.test("a coordinator ending HIS OWN run is sent back to the ordinary button", async (a) => {
    const { env, key } = await fresh();
    await W.handleTrip(env, started({ driver: "Bro Arthur", sunday: key, events: [{ event: "start", at: Date.now() }] }));
    const r = await body(await W.handleEndRun(env, { endrun: { route: "North", who: "Bro Arthur", pin: "1234" } }));
    a.not(r.ok);
    a.eq(r.error, "your own run",
         "he must not learn that ending his own run costs four digits, or he will not notice the day it does");
  });

  s.test("there is nothing to close when no run is out", async (a) => {
    const { env } = await fresh();
    const r = await body(await W.handleEndRun(env, { endrun: { route: "North", who: "Bro Arthur", pin: "1234" } }));
    a.not(r.ok);
    a.eq(r.error, "no run");
  });

  s.test("closing an already closed run is reported, not written again", async (a) => {
    const { db, env, key } = await fresh();
    await aRunIsOut(env, key);
    await W.handleTrip(env, started({ sunday: key, events: [{ event: "end", at: Date.now() }] }));
    const r = await body(await W.handleEndRun(env, { endrun: { route: "North", who: "Bro Arthur", pin: "1234" } }));
    a.ok(r.already);
    a.eq(db._rows("SELECT * FROM trip_events WHERE event='end'").length, 1);
  });

  s.test("closing a run on one route leaves the other alone", async (a) => {
    const { env, key } = await fresh();
    await aRunIsOut(env, key);
    await W.handleTrip(env, started({
      trip: "s1", route: "South", driver: "Bro Trevor", reg: "NH56 FWP",
      sunday: key, events: [{ event: "start", at: Date.now() }]
    }));
    await W.handleEndRun(env, { endrun: { route: "North", who: "Bro Arthur", pin: "1234" } });
    a.ok((await W.tripState(env, key, "North")).ended);
    a.not((await W.tripState(env, key, "South")).ended);
  });

  /* ---- and the answer, when a stopped bus is let out ---------------------

     He was told his bus was stopped and told to ring the coordinator. Until
     v1.73.0 the answer came back only if he thought to open Stops and
     bookings again, so a man who had been told not to drive had no way of
     hearing that he could. */

  s.test("a driver whose bus is authorised is told so", async (a) => {
    const { db, env, key } = await fresh();
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,'')")
      .bind("Bro Trevor", "Driver", "South").run();
    await W.handleCheck(env, { id: "c1", reg: "YS70 PWE", level: "stop", driver: "Bro Trevor", age: 0 });

    const all = await W.getStops(env);
    const stops = W.pickupsAndArrivals(all);
    const rotaRow = await W.getRotaRow(env, key);
    const buses = await W.getBuses(env);

    const stopped = await W.driverNudgeFor(env, key, "North", all, stops, rotaRow, buses);
    a.ok(stopped, "he should be told his bus was stopped");
    a.has(stopped.tag, "stopped|");

    await W.handleAuthorise(env, { authorise: { reg: "YS70 PWE", who: "Bro Arthur", pin: "1234" } });
    const cleared = await W.driverNudgeFor(env, key, "North", all, stops, rotaRow, buses);
    a.ok(cleared, "and he should be told when it is let out again");
    a.has(cleared.tag, "clear|");
    a.ne(cleared.tag, stopped.tag, "a different thing to say is a different tag");
  });

  s.test("the authorised message names the bus and who signed it out", async (a) => {
    const { db, env, key } = await fresh();
    const ep = "https://push.example/drv";
    await db.prepare(
      "INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, driver, route, made, seen, fails, last) " +
      "VALUES (?,'p','a','driver','','','Bro Adrian','North',?,0,0,'')"
    ).bind(ep, Date.now()).run();
    await W.handleCheck(env, { id: "c1", reg: "YS70 PWE", level: "stop", driver: "Bro Trevor", age: 0 });
    await W.handleAuthorise(env, { authorise: { reg: "YS70 PWE", who: "Bro Arthur", pin: "1234" } });

    const out = await W.pushWhat(env, ep);
    a.has(out.title, "YS70 PWE");
    a.has(out.title, "authorised");
    a.has(out.body, "Bro Arthur");
    a.has(out.body, "defect stays open");
  });

  s.test("a second walkaround that stops it again says so, not the old answer", async (a) => {
    const { db, env, key } = await fresh();
    const ep = "https://push.example/drv2";
    await db.prepare(
      "INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, driver, route, made, seen, fails, last) " +
      "VALUES (?,'p','a','driver','','','Bro Adrian','North',?,0,0,'')"
    ).bind(ep, Date.now()).run();
    await W.handleCheck(env, { id: "c1", reg: "YS70 PWE", level: "stop", driver: "Bro Trevor", age: 0 });
    await W.handleAuthorise(env, { authorise: { reg: "YS70 PWE", who: "Bro Arthur", pin: "1234" } });
    await new Promise((r) => setTimeout(r, 12));
    await W.handleCheck(env, { id: "c2", reg: "YS70 PWE", level: "stop", driver: "Bro Trevor", age: 0 });

    const out = await W.pushWhat(env, ep);
    a.has(out.title, "stopped",
          "the words come from the record, never from the tag: " + out.title);
  });

  s.test("a bus nobody stopped produces neither message", async (a) => {
    const { env, key } = await fresh();
    await W.handleCheck(env, { id: "c1", reg: "YS70 PWE", level: "ok", driver: "Bro Trevor", age: 0 });
    const all = await W.getStops(env);
    const n = await W.driverNudgeFor(env, key, "North", all, W.pickupsAndArrivals(all),
                                     await W.getRotaRow(env, key), await W.getBuses(env));
    a.not(n && /stopped\||clear\|/.test(n.tag), "nothing to say about a bus that is fine");
  });

  return s;
}
