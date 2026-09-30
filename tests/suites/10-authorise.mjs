/* THE FOUR RULES A STOPPED BUS IS LET OUT BY.

   Three review passes found seventeen faults in this logic and every one of
   them was the same shape: the phone, the live server and the sheet each hold
   a copy of a bus's status, and they can disagree about which answer is
   newer. Some of those faults would have let a stopped bus out. Some would
   have kept an authorised bus stuck. Both are Sunday mornings.

   So the rules get their own suite, stated as sentences, tested through the
   real handlers against a real SQLite database:

     1.  Every check has one time: when it was DONE, worked out on the server.
     2.  An authorisation names the check it lifts and lifts no other.
     3.  An older check arriving late never overrules a newer one.
     4.  On the sheet, the latest decision about a bus stands, whichever
         arrives first.

   Nothing here mocks the thing under test. The statements go to SQLite
   exactly as the Worker wrote them, because half of these faults were SQL. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv } from "../lib/worker.mjs";

const REG = "YS70 PWE";
const OTHER = "NH56 FWP";

export default async function (root) {
  const s = new Suite("a stopped bus: the four rules");
  const { mod } = await loadWorker(root);
  const W = mod;

  const day = W.londonKey(new Date());

  /* A fresh database, a register with one coordinator and one ordinary
     driver, and the authorise rules the sheet would have pushed. */
  async function fresh(rules) {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    for (const d of [
      ["Bro Arthur", "Coordinator", "North", 1],
      ["Pst Kenneth", "Minister in Charge", "North", 2],
      ["Bro Trevor", "Driver", "South", 3]
    ]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
        .bind(d[0], d[1], d[2], d[3], await W.pinHashOf(env, d[0], "1234")).run();
    }
    /* No PIN at all, which must not be allowed to sign a bus out. */
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,'')")
      .bind("Bro Cedric", "Coordinator", "North", 4).run();

    await W.cachePut(env, "auth_rules", Object.assign(
      { roles: ["coordinator", "minister in charge"], sameHandBothWays: true }, rules || {})).run();
    return { db, env };
  }

  const check = (over) => Object.assign({
    id: "chk-" + Math.random().toString(36).slice(2),
    reg: REG, level: "stop", driver: "Bro Trevor", age: 0
  }, over || {});

  const body = async (res) => JSON.parse(await res.text());

  /* ---- the walkaround lands ------------------------------------------- */

  s.test("a stopping walkaround puts the bus down as stopped", async (a) => {
    const { db, env } = await fresh();
    await W.handleCheck(env, check());
    const row = db._one("SELECT * FROM checks_today WHERE reg=?", REG);
    a.eq(row.state, "stopped");
    a.eq(row.day, day);
  });

  s.test("a clean walkaround leaves the bus running", async (a) => {
    const { db, env } = await fresh();
    await W.handleCheck(env, check({ level: "ok" }));
    a.eq(db._one("SELECT * FROM checks_today WHERE reg=?", REG).state, "ok");
  });

  s.test("an advisory does not stop the bus", async (a) => {
    const { db, env } = await fresh();
    await W.handleCheck(env, check({ level: "warn" }));
    a.eq(db._one("SELECT * FROM checks_today WHERE reg=?", REG).state, "ok",
         "Advisory is worth watching, not a fault, and must never hold a bus");
  });

  /* ---- rule 1: one time per check, the server's ------------------------ */

  s.test("RULE 1 · a check is dated when it was done, not when it arrived", async (a) => {
    const { db, env } = await fresh();
    const c = check({ age: 40 * 60000 });          /* done forty minutes ago */
    const before = Date.now();
    await W.handleCheck(env, c);
    const row = db._one("SELECT * FROM checks_in WHERE check_id=?", c.id);
    a.near(row.received, before - 40 * 60000, 5000,
           "the walkaround was done forty minutes before it was sent and must be dated then");
  });

  s.test("RULE 1 · the same check told twice keeps its first time", async (a) => {
    const { db, env } = await fresh();
    const c = check();
    await W.handleCheck(env, c);
    const first = db._one("SELECT * FROM checks_in WHERE check_id=?", c.id).received;
    await new Promise((r) => setTimeout(r, 12));
    await W.handleCheck(env, c);                    /* the drain filing it, a phone retrying */
    a.eq(db._one("SELECT * FROM checks_in WHERE check_id=?", c.id).received, first,
         "a retry must not become a newer check, or it could undo a signature");
  });

  s.test("RULE 1 · a phone's own clock never sets the time", async (a) => {
    const { db, env } = await fresh();
    /* A handset a year fast. age is a DURATION, which a wrong clock still
       measures correctly, and it is the only thing that is believed. */
    const c = check({ at: Date.now() + 365 * 86400000, age: 0 });
    await W.handleCheck(env, c);
    const row = db._one("SELECT * FROM checks_in WHERE check_id=?", c.id);
    a.near(row.received, Date.now(), 5000, "a phone with the wrong date must not date the record");
  });

  /* ---- authorising in the app ------------------------------------------ */

  s.test("a coordinator with the right PIN authorises the bus", async (a) => {
    const { env } = await fresh();
    await W.handleCheck(env, check());
    const r = await body(await W.handleAuthorise(env, { authorise: { reg: REG, who: "Bro Arthur", pin: "1234" } }));
    a.ok(r.ok, JSON.stringify(r));
    a.eq(r.by, "Bro Arthur");
  });

  s.test("an ordinary driver is refused, whatever his PIN", async (a) => {
    const { env } = await fresh();
    await W.handleCheck(env, check());
    const r = await body(await W.handleAuthorise(env, { authorise: { reg: REG, who: "Bro Trevor", pin: "1234" } }));
    a.not(r.ok);
    a.eq(r.error, "not authorised");
  });

  s.test("a coordinator with no PIN on the register cannot sign a bus out", async (a) => {
    const { env } = await fresh();
    await W.handleCheck(env, check());
    const r = await body(await W.handleAuthorise(env, { authorise: { reg: REG, who: "Bro Cedric", pin: "" } }));
    a.not(r.ok);
    a.eq(r.error, "no pin",
         "a driver without a PIN is waved through every other gate; this one lets a bus out with a fault on it");
  });

  s.test("a bus nobody has stopped cannot be authorised", async (a) => {
    const { env } = await fresh();
    await W.handleCheck(env, check({ level: "ok" }));
    const r = await body(await W.handleAuthorise(env, { authorise: { reg: REG, who: "Bro Arthur", pin: "1234" } }));
    a.not(r.ok);
    a.eq(r.error, "no check");
  });

  s.test("a bus with no walkaround at all cannot be authorised", async (a) => {
    const { env } = await fresh();
    const r = await body(await W.handleAuthorise(env, { authorise: { reg: OTHER, who: "Bro Arthur", pin: "1234" } }));
    a.not(r.ok);
    a.eq(r.error, "no check", "signing off a walkaround that never happened is the worst record of all");
  });

  s.test("three wrong PINs lock the gate for five minutes", async (a) => {
    const { env } = await fresh();
    await W.handleCheck(env, check());
    let r;
    for (let i = 0; i < 3; i++) {
      r = await body(await W.handleAuthorise(env, { authorise: { reg: REG, who: "Bro Arthur", pin: "9999" } }));
      a.not(r.ok);
    }
    r = await body(await W.handleAuthorise(env, { authorise: { reg: REG, who: "Bro Arthur", pin: "1234" } }));
    a.ok(r.locked, "the fourth try must be refused even with the right PIN");
    a.eq(r.minutes, 5);
  });

  s.test("with sameHandBothWays off, the man who did the walkaround cannot authorise it", async (a) => {
    const { env } = await fresh({ sameHandBothWays: false });
    await W.handleCheck(env, check({ driver: "Bro Arthur" }));
    const r = await body(await W.handleAuthorise(env, { authorise: { reg: REG, who: "Bro Arthur", pin: "1234" } }));
    a.not(r.ok);
    a.eq(r.error, "same hand");
  });

  s.test("with sameHandBothWays on, he can", async (a) => {
    const { env } = await fresh({ sameHandBothWays: true });
    await W.handleCheck(env, check({ driver: "Bro Arthur" }));
    const r = await body(await W.handleAuthorise(env, { authorise: { reg: REG, who: "Bro Arthur", pin: "1234" } }));
    a.ok(r.ok, JSON.stringify(r));
  });

  /* ---- rule 2: it lifts the check it names, and no other ---------------- */

  s.test("RULE 2 · an authorised bus reads as authorised on the board", async (a) => {
    const { env } = await fresh();
    await W.handleCheck(env, check());
    await W.handleAuthorise(env, { authorise: { reg: REG, who: "Bro Arthur", pin: "1234" } });
    const now = await W.checksToday(env);
    a.eq(now[REG].state, "authorised");
    a.eq(now[REG].by, "Bro Arthur");
  });

  s.test("RULE 2 · a second walkaround that stops the bus again is NOT waved through", async (a) => {
    const { env } = await fresh();
    await W.handleCheck(env, check({ id: "first" }));
    await W.handleAuthorise(env, { authorise: { reg: REG, who: "Bro Arthur", pin: "1234" } });
    a.eq((await W.checksToday(env))[REG].state, "authorised");

    await new Promise((r) => setTimeout(r, 12));
    await W.handleCheck(env, check({ id: "second" }));
    a.eq((await W.checksToday(env))[REG].state, "stopped",
         "the first signature lifted the first check and must not reach the second");
  });

  s.test("RULE 2 · the second check can be authorised in its own right", async (a) => {
    const { env } = await fresh();
    await W.handleCheck(env, check({ id: "first" }));
    await W.handleAuthorise(env, { authorise: { reg: REG, who: "Bro Arthur", pin: "1234" } });
    await new Promise((r) => setTimeout(r, 12));
    await W.handleCheck(env, check({ id: "second" }));
    await W.handleAuthorise(env, { authorise: { reg: REG, who: "Bro Arthur", pin: "1234" } });
    a.eq((await W.checksToday(env))[REG].state, "authorised");
  });

  s.test("RULE 2 · one bus being authorised says nothing about the other", async (a) => {
    const { env } = await fresh();
    await W.handleCheck(env, check({ id: "a", reg: REG }));
    await W.handleCheck(env, check({ id: "b", reg: OTHER }));
    await W.handleAuthorise(env, { authorise: { reg: REG, who: "Bro Arthur", pin: "1234" } });
    const now = await W.checksToday(env);
    a.eq(now[REG].state, "authorised");
    a.eq(now[OTHER].state, "stopped");
  });

  /* ---- rule 3: an older check arriving late ----------------------------- */

  s.test("RULE 3 · a check done last night and sent this morning leaves today's bus alone", async (a) => {
    const { env } = await fresh();
    await W.handleCheck(env, check({ id: "todays", level: "ok" }));
    a.eq((await W.checksToday(env))[REG].state, "ok");
    /* The same handset, finally getting signal, sending last night's stop. */
    await W.handleCheck(env, check({ id: "lastnight", level: "stop", age: 14 * 3600000 }));
    a.eq((await W.checksToday(env))[REG].state, "ok",
         "an older walkaround arriving late must not stop a bus that has since been checked clean");
  });

  s.test("RULE 3 · a retry of an old check does not restate it as today's", async (a) => {
    const { env } = await fresh();
    const old = check({ id: "old", level: "stop", age: 3 * 3600000 });
    await W.handleCheck(env, old);
    await new Promise((r) => setTimeout(r, 12));
    await W.handleCheck(env, check({ id: "new", level: "ok" }));
    a.eq((await W.checksToday(env))[REG].state, "ok");
    await W.handleCheck(env, old);                  /* the drain files it, late */
    a.eq((await W.checksToday(env))[REG].state, "ok");
  });

  /* ---- rule 4: the sheet's latest decision stands ----------------------- */

  s.test("RULE 4 · the Outcome column authorises a stopped bus", async (a) => {
    const { env } = await fresh();
    await W.handleCheck(env, check({ id: "c1" }));
    const r = await body(await W.handleOutcome(env, { edits: [
      { reg: REG, day, checkId: "c1", outcome: "Authorised to run", by: "Bro Arthur", madeAt: Date.now() }
    ] }));
    a.ok(r.ok !== false);
    a.eq((await W.checksToday(env))[REG].state, "authorised");
  });

  s.test("RULE 4 · putting the cell back to STOPPED takes the authorisation off", async (a) => {
    const { env } = await fresh();
    await W.handleCheck(env, check({ id: "c1" }));
    const t = Date.now();
    await W.handleOutcome(env, { edits: [{ reg: REG, day, checkId: "c1", outcome: "Authorised to run", by: "Bro Arthur", madeAt: t }] });
    await W.handleOutcome(env, { edits: [{ reg: REG, day, checkId: "c1", outcome: "STOPPED", by: "Bro Arthur", madeAt: t + 1000 }] });
    a.eq((await W.checksToday(env))[REG].state, "stopped");
  });

  s.test("RULE 4 · an edit older than the last decision is refused", async (a) => {
    const { env } = await fresh();
    await W.handleCheck(env, check({ id: "c1" }));
    const t = Date.now();
    await W.handleOutcome(env, { edits: [{ reg: REG, day, checkId: "c1", outcome: "STOPPED", by: "Bro Arthur", madeAt: t }] });
    const r = await body(await W.handleOutcome(env, { edits: [
      { reg: REG, day, checkId: "c1", outcome: "Authorised to run", by: "Bro Arthur", madeAt: t - 60000 }
    ] }));
    a.eq(r.results[0].applied, false);
    a.eq(r.results[0].why, "superseded",
         "an edit held back because this server did not answer must not undo a decision made after it");
  });

  s.test("RULE 4 · an edit on an earlier check's row is refused and says so", async (a) => {
    const { env } = await fresh();
    await W.handleCheck(env, check({ id: "first" }));
    await new Promise((r) => setTimeout(r, 12));
    await W.handleCheck(env, check({ id: "second" }));
    const r = await body(await W.handleOutcome(env, { edits: [
      { reg: REG, day, checkId: "first", outcome: "Authorised to run", by: "Bro Arthur", madeAt: Date.now() }
    ] }));
    a.eq(r.results[0].applied, false);
    a.eq(r.results[0].why, "not current");
  });

  s.test("RULE 4 · a cleared cell is ignored", async (a) => {
    const { env } = await fresh();
    await W.handleCheck(env, check({ id: "c1" }));
    const r = await body(await W.handleOutcome(env, { edits: [
      { reg: REG, day, checkId: "c1", outcome: "", by: "Bro Arthur", madeAt: Date.now() }
    ] }));
    a.eq(r.results[0].applied, false);
    a.eq(r.results[0].why, "empty");
    a.eq((await W.checksToday(env))[REG].state, "stopped");
  });

  s.test("RULE 4 · an Outcome edit for a bus with no check is refused", async (a) => {
    const { env } = await fresh();
    const r = await body(await W.handleOutcome(env, { edits: [
      { reg: OTHER, day, outcome: "Authorised to run", by: "Bro Arthur", madeAt: Date.now() }
    ] }));
    a.eq(r.results[0].applied, false);
    a.eq(r.results[0].why, "no check");
  });

  /* ---- the two paths must agree ---------------------------------------- */

  s.test("the app and the sheet write the same authorisation", async (a) => {
    const viaApp = await fresh();
    await W.handleCheck(viaApp.env, check({ id: "c1" }));
    await W.handleAuthorise(viaApp.env, { authorise: { reg: REG, who: "Bro Arthur", pin: "1234" } });

    const viaSheet = await fresh();
    await W.handleCheck(viaSheet.env, check({ id: "c1" }));
    await W.handleOutcome(viaSheet.env, { edits: [
      { reg: REG, day, checkId: "c1", outcome: "Authorised to run", by: "Bro Arthur", madeAt: Date.now() }
    ] });

    const one = (await W.checksToday(viaApp.env))[REG];
    const two = (await W.checksToday(viaSheet.env))[REG];
    a.eq(one.state, two.state);
    a.eq(one.by, two.by);
    a.eq(one.id, two.id);
  });

  s.test("authorising never closes the defect", async (a) => {
    const { db, env } = await fresh();
    await W.handleCheck(env, check({ id: "c1" }));
    await W.handleAuthorise(env, { authorise: { reg: REG, who: "Bro Arthur", pin: "1234" } });
    /* The walkaround itself is untouched: the Defects tab is written from
       checks_in by Apps Script, and a signature must not edit the record of
       what was found. */
    const row = db._one("SELECT * FROM checks_in WHERE check_id=?", "c1");
    a.eq(row.level, "stop", "the check still says the bus was stopped");
  });

  return s;
}
