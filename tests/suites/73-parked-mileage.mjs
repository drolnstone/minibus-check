/* PARKED MILEAGE, 16 October 2026. pages v1.124.0 · server w2.65.0 ·
   sheet v1.122.0.

   Asim: the bus may be lent out during the week without his being told, and
   a difference in mileage is how he would know. A reading when the bus is
   put away after the afternoon return, keyed on the driver app's hub, and the
   next walkaround measured from it to the mile. Optional: offered only to
   the person who drove the bus that morning, from the end of the run to the
   end of the Sunday, and said in a "Trip ended" notification. With none
   keyed, the gap since the walkaround before is measured against a usual
   Sunday for that bus.

   Written for w2.65.0 / v1.122.0 / v1.124.0. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { TABS, tab } from "../lib/tabs.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-10-18";
const SUN_0800 = "2026-10-18T08:00:00+01:00";
const SUN_1100 = "2026-10-18T11:00:00+01:00";
const SUN_1500 = "2026-10-18T15:00:00+01:00";
const MON_2000 = "2026-10-19T20:00:00+01:00";
const TUE_0030 = "2026-10-20T00:30:00+01:00";
const WED_1000 = "2026-10-21T10:00:00+01:00";
const TREVOR = "4321";
const REG = "YS70 PWE";

/* The Checks tab once Set up has run on v1.125.0: the live export with the
   three new headings beside Mileage, spliced in rather than typed out. */
const NEW_CHECKS = (() => {
  const h = TABS["Checks"].slice();
  h.splice(h.indexOf("Mileage flag") + 1, 0, "Parked mileage", "Parked at", "Since parked");
  return h;
})();
const newRow = (v) => NEW_CHECKS.map((h) => (h in v ? v[h] : ""));

export default async function (root) {
  const s = new Suite("parked mileage");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await db.prepare("DELETE FROM drivers").run();
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
      .bind("Bro Trevor", "Driver", "North", await W.pinHashOf(env, "Bro Trevor", TREVOR)).run();
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES ('Sis Ama','Driver','South',1,1,'')").run();
    return { db, env };
  }
  const post = (env, body, ctx) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, ctx || {});
  const keyOf = async (env) =>
    (await J(await post(env, { action: "pin", pin: { driver: "Bro Trevor", pin: TREVOR } }))).key;
  const walk = (env, id, miles, key) => post(env, { action: "check", key,
    check: { id, reg: REG, level: "ok", driver: "Bro Trevor", miles: String(miles) } });
  /* The morning run on North in this bus, started at 09:50 and ended at
     the time given, by the driver given. */
  const run = (env, key, ended, driver) => post(env, { action: "trip", key, trip: { trip: "t1", route: "North",
    driver: driver || "Bro Trevor", reg: REG, sunday: KEY, events: [
      { event: "start", at: Date.parse("2026-10-18T09:50:00+01:00") }].concat(ended ?
      [{ event: "end", at: Date.parse(ended) }] : []) } });
  const park = (env, key, over) => post(env, Object.assign({ action: "parked", key,
    parked: Object.assign({ reg: REG, checkId: "c1", miles: 57410, driver: "Bro Trevor" }, (over && over.parked) || {}) },
    over && "key" in over ? { key: over.key } : {}));

  /* ---------------------------------------------------- the live server */

  s.test("offered to the morning's driver once his run has ended, to the end of the Sunday", async (a) => {
    const { env } = await fresh();
    const key = await atTime(SUN_0800, async () => { await walk(env, "c1", 57363); return keyOf(env); });
    const at = async (when) => atTime(when, () => W.parkedOpen(env));
    await atTime("2026-10-18T10:00:00+01:00", () => run(env, key));
    a.eq((await at("2026-10-18T10:30:00+01:00")).length, 0, "offered while the morning run was still going");
    await atTime("2026-10-18T10:50:00+01:00", () => run(env, key, "2026-10-18T10:50:00+01:00"));
    const open = await at(SUN_1100);
    a.eq(open.length, 1, "not offered once the run had ended");
    a.eq(open[0].reg, REG);
    a.eq(open[0].checkId, "c1");
    a.eq(open[0].miles, 57363, "the walkaround's reading is not given");
    a.eq(open[0].driver, "Bro Trevor", "not said whose it is");
    a.eq(open[0].parked, null);
    a.eq((await at("2026-10-18T23:50:00+01:00")).length, 1, "gone before the end of the Sunday");
    a.eq((await at("2026-10-19T00:10:00+01:00")).length, 0, "still offered on the Monday");
  });

  s.test("with no run recorded for the bus, offered to whoever did its walkaround, from noon", async (a) => {
    const { env } = await fresh();
    await atTime(SUN_0800, () => walk(env, "c1", 57363));
    const at = async (when) => atTime(when, () => W.parkedOpen(env));
    a.eq((await at(SUN_1100)).length, 0, "offered before noon");
    const open = await at(SUN_1500);
    a.eq(open.length, 1);
    a.eq(open[0].driver, "Bro Trevor");
  });

  s.test("a walkaround on a weekday opens nothing", async (a) => {
    const { env } = await fresh();
    await atTime(WED_1000, () => walk(env, "c9", 57400));
    a.eq((await atTime("2026-10-21T15:00:00+01:00", () => W.parkedOpen(env))).length, 0);
  });

  s.test("keyed with the driver's key, kept against its walkaround, and told to the sheet", async (a) => {
    const { db, env } = await fresh();
    const key = await atTime(SUN_0800, async () => { await walk(env, "c1", 57363); return keyOf(env); });
    await atTime(SUN_1500, async () => {
      const waits = [];
      const out = await J(await park(env, key, {}, null) );
      a.ok(out.ok, "a good parked reading was refused: " + JSON.stringify(out));
      const r = db._one("SELECT * FROM parked WHERE check_id='c1'");
      a.eq(Number(r.miles), 57410);
      a.eq(Number(r.confirmed), 1, "the key was not noted");
      a.eq(r.reg, REG);
      await post(env, { action: "parked", key, parked: { reg: REG, checkId: "c1", miles: 57411, driver: "Bro Trevor" } },
                 { waitUntil: (p) => waits.push(p) });
      a.eq(waits.length, 2, "the sheet was not asked to collect it, or he was not told it was received");
      await Promise.all(waits);
    });
  });

  s.test("refused without the key, from anybody else, lower than the walkaround, far too high, not a number, or closed", async (a) => {
    const { env } = await fresh();
    const key = await atTime(SUN_0800, async () => { await walk(env, "c1", 57363); return keyOf(env); });
    await atTime(SUN_1500, async () => {
      a.eq((await J(await park(env, "", { key: "" }))).error, "pin", "taken without his PIN");
      const other = await J(await park(env, "", { key: "", parked: { driver: "Sis Ama" } }));
      a.eq(other.error, "not yours", "taken from somebody who did not drive the bus that morning");
      a.eq(other.driver, "Bro Trevor");
      a.eq((await J(await park(env, key, { parked: { miles: 57300 } }))).error, "lower");
      a.eq((await J(await park(env, key, { parked: { miles: 57363 + 1501 } }))).error, "jump");
      a.eq((await J(await park(env, key, { parked: { miles: "lots" } }))).error, "number");
      a.eq((await J(await park(env, key, { parked: { checkId: "c0" } }))).error, "closed",
           "taken for a walkaround that is not this bus's newest");
    });
    await atTime("2026-10-19T00:10:00+01:00", async () => {
      a.eq((await J(await park(env, key, {}))).error, "closed", "taken on the Monday");
    });
  });

  s.test("keyed again, it replaces the first and goes to the sheet again", async (a) => {
    const { db, env } = await fresh();
    const key = await atTime(SUN_0800, async () => { await walk(env, "c1", 57363); return keyOf(env); });
    await atTime(SUN_1500, async () => {
      await park(env, key, {});
      const d = await J(await W.handleDrain(env, { limit: 300 }));
      a.eq((d.parked || []).length, 1, "the drain does not carry it");
      a.eq(d.parked[0].checkId, "c1");
      a.eq(d.parked[0].miles, 57410);
      await W.handleDrained(env, { claim: d.claim, parked: [d.parked[0].id] });
      a.eq(((await J(await W.handleDrain(env, { limit: 300 }))).parked || []).length, 0, "a filed reading came round again");
      await park(env, key, { parked: { miles: 57412 } });
      a.eq(Number(db._one("SELECT COUNT(*) AS n FROM parked").n), 1, "two readings for one walkaround");
      const again = await J(await W.handleDrain(env, { limit: 300 }));
      a.eq((again.parked || []).length, 1, "the corrected reading did not go to the sheet");
      a.eq(again.parked[0].miles, 57412);
    });
  });

  s.test("the driver app's mileage call carries it, refused shelf or not", async (a) => {
    const { db, env } = await fresh();
    const key = await atTime(SUN_0800, async () => { await walk(env, "c1", 57363); return keyOf(env); });
    await atTime(SUN_1500, async () => {
      await park(env, key, {});
      const none = await W.cachedLast(env);
      a.not(none.ok);
      a.eq((none.parkOpen || []).length, 1, "a refusal left out where a parked reading may be keyed");
      await db.prepare("INSERT INTO settings (k,v) VALUES ('cache_last',?)").bind(JSON.stringify({
        builtAt: Date.now() - 60000, payload: { ok: true, last: { [REG]: { miles: 57363, date: "18/10/2026", checkId: "c1" } } } })).run();
      const out = await W.cachedLast(env);
      a.ok(out.ok);
      a.eq(out.parked[REG].miles, 57410, "the parked reading is not handed to the phone");
      a.eq(out.parked[REG].checkId, "c1");
      a.eq(out.parked[REG].date, KEY);
      a.eq(out.parked[REG].time, "15:00");
      a.eq(out.parkOpen[0].parked.miles, 57410, "the hub would offer the box again");
    });
  });

  s.test("a parked reading stops counting once the bus has a newer walkaround", async (a) => {
    const { env } = await fresh();
    const key = await atTime(SUN_0800, async () => { await walk(env, "c1", 57363); return keyOf(env); });
    await atTime(SUN_1500, () => park(env, key, {}));
    await atTime("2026-10-25T08:00:00+00:00", () => walk(env, "c2", 57410, key));
    const p = await atTime("2026-10-25T08:05:00+00:00", () => W.parkedLatest(env));
    a.eq(p[REG], undefined, "last week's parked reading would be measured from again");
  });

  s.test("the end of his run is told to the driver once, with the parked mileage while it is owed", async (a) => {
    const { db, env } = await fresh();
    const key = await atTime(SUN_0800, async () => { await walk(env, "c1", 57363); return keyOf(env); });
    await db.prepare("INSERT INTO push_subs (endpoint, role, driver, route, made) VALUES (?, 'driver', 'Bro Trevor', 'North', ?)")
      .bind("https://push.example/trevor", Date.now()).run();
    await atTime("2026-10-18T10:50:00+01:00", () => run(env, key, "2026-10-18T10:50:00+01:00"));
    await atTime("2026-10-18T10:51:00+01:00", async () => {
      await W.wakeRunEnded(env);
      const ended = Date.parse("2026-10-18T10:50:00+01:00");
      a.ok(db._one("SELECT v FROM settings WHERE k='endtold:" + KEY + ":North:t1:" + ended + "'"), "the end was not told");
      const tag = "ended|" + KEY + "|North|" + ended;
      const sub = db._one("SELECT last FROM push_subs WHERE endpoint='https://push.example/trevor'");
      a.eq(sub.last, tag, "his phone was not woken for it");
      const said = await W.pushWhat(env, "https://push.example/trevor");
      a.eq(said.title, "Trip ended");
      a.eq(said.body, "North ended at 10:50. Record the bus parked mileage when you return from the afternoon run.");
      await db.prepare("UPDATE push_subs SET last='' WHERE endpoint='https://push.example/trevor'").run();
      await W.wakeRunEnded(env);
      a.eq(db._one("SELECT last FROM push_subs WHERE endpoint='https://push.example/trevor'").last, "",
           "told twice about one run");
      a.not((await W.pushWhat(env, "https://push.example/trevor")).title === "Trip ended",
            "the Trip ended words stand in for a push about something else");
      await db.prepare("UPDATE push_subs SET last=? WHERE endpoint='https://push.example/trevor'").bind(tag).run();
    });
    await atTime(SUN_1500, async () => {
      await park(env, key, {});
      const said = await W.pushWhat(env, "https://push.example/trevor");
      a.eq(said.body, "North ended at 10:50.", "still asked for once it was keyed");
    });
  });

  s.test("a run reopened after an early end, or a second run, is told when it ends again", async (a) => {
    const { db, env } = await fresh();
    const key = await atTime(SUN_0800, async () => { await walk(env, "c1", 57363); return keyOf(env); });
    await db.prepare("INSERT INTO push_subs (endpoint, role, driver, route, made) VALUES (?, 'driver', 'Bro Trevor', 'North', ?)")
      .bind("https://push.example/trevor", Date.now()).run();
    await atTime("2026-10-18T09:56:00+01:00", () => run(env, key, "2026-10-18T09:56:00+01:00"));
    await atTime("2026-10-18T09:57:00+01:00", () => W.wakeRunEnded(env));
    const first = db._one("SELECT last FROM push_subs WHERE endpoint='https://push.example/trevor'").last;
    await atTime("2026-10-18T09:58:00+01:00", () => post(env, { action: "trip", key, trip: { trip: "t2", route: "North",
      driver: "Bro Trevor", reg: REG, sunday: KEY, events: [{ event: "start", at: Date.parse("2026-10-18T09:58:00+01:00") },
        { event: "end", at: Date.parse("2026-10-18T11:05:00+01:00") }] } }));
    await atTime("2026-10-18T11:06:00+01:00", () => W.wakeRunEnded(env));
    const second = db._one("SELECT last FROM push_subs WHERE endpoint='https://push.example/trevor'").last;
    a.ok(first && second && first !== second, "the second end was not told: " + first + " / " + second);
  });

  s.test("a run that ended long ago wakes nobody", async (a) => {
    const { db, env } = await fresh();
    const key = await atTime(SUN_0800, async () => { await walk(env, "c1", 57363); return keyOf(env); });
    await atTime("2026-10-18T10:50:00+01:00", () => run(env, key, "2026-10-18T10:50:00+01:00"));
    await atTime("2026-10-18T12:00:00+01:00", () => W.wakeRunEnded(env));
    a.eq(db._one("SELECT v FROM settings WHERE k='endtold:" + KEY + ":North'"), null);
  });

  s.test("keyed with no signal, it is taken later as at the time it was keyed, until a newer walkaround or a week", async (a) => {
    const { db, env } = await fresh();
    const key = await atTime(SUN_0800, async () => { await walk(env, "c1", 57363); return keyOf(env); });
    const madeAt = Date.parse(SUN_1500);
    await atTime(MON_2000, async () => {
      a.eq((await J(await park(env, key, {}))).error, "closed", "taken on the Monday as if keyed then");
      const out = await J(await park(env, key, { parked: { made: madeAt } }));
      a.ok(out.ok, "a reading keyed on the Sunday with no signal was refused on the Monday: " + JSON.stringify(out));
      const r = db._one("SELECT made, got FROM parked WHERE check_id='c1'");
      a.eq(Number(r.made), madeAt, "not kept as keyed at the time the phone said");
      a.eq(Number(r.got), Date.parse(MON_2000), "when it came is not kept");
      a.eq((await W.parkedLatest(env))[REG].time, "15:00");
      a.eq((await J(await park(env, key, { parked: { made: Date.parse("2026-10-18T11:00:00+01:00") } }))).error, "closed",
           "taken as keyed before noon, with no run for the bus");
      a.eq((await J(await park(env, key, { parked: { made: Date.now() + 3600000 } }))).error, "closed",
           "a time still to come was believed");
    });
    await atTime("2026-10-26T15:01:00+00:00", async () => {
      a.eq((await J(await park(env, key, { parked: { made: madeAt } }))).error, "closed", "taken more than a week later");
    });
    await atTime(MON_2000, async () => {
      const bare = await J(await post(env, { action: "parked",
        parked: { reg: REG, checkId: "c1", miles: 57363, driver: "Bro Trevor", made: madeAt } }));
      a.eq(bare.error, "pin", "a post with no key at all was taken as an old phone's");
    });
    const { env: env2 } = await fresh();
    const key2 = await atTime(SUN_0800, async () => { await walk(env2, "c1", 57363); return keyOf(env2); });
    await atTime("2026-10-25T08:00:00+00:00", () => walk(env2, "c2", 57420, key2));
    await atTime("2026-10-25T09:00:00+00:00", async () => {
      a.eq((await J(await park(env2, key2, { parked: { made: madeAt } }))).error, "closed",
           "taken after the bus's next walkaround");
    });
  });

  s.test("the driver is told it was received, and the coordinators have their copy", async (a) => {
    const { db, env } = await fresh();
    const key = await atTime(SUN_0800, async () => { await walk(env, "c1", 57363); return keyOf(env); });
    await db.prepare("INSERT INTO push_subs (endpoint, role, driver, route, made) VALUES (?, 'driver', 'Bro Trevor', 'North', ?)")
      .bind("https://push.example/trevor", Date.now()).run();
    await atTime(MON_2000, async () => {
      const waits = [];
      const out = await J(await post(env, { action: "parked", key, parked: { reg: REG, checkId: "c1", miles: 57410,
        driver: "Bro Trevor", made: Date.parse(SUN_1500) } }, { waitUntil: (p) => waits.push(p) }));
      a.ok(out.ok);
      await Promise.all(waits);
      const last = db._one("SELECT last FROM push_subs WHERE endpoint='https://push.example/trevor'").last;
      a.ok(String(last).indexOf("parkok|" + KEY + "|" + REG + "|") === 0, "his phone was not woken: " + last);
      const said = await W.pushWhat(env, "https://push.example/trevor");
      a.eq(said.title, "Parked mileage received");
      a.eq(said.body, REG + ": 57,410, keyed at 15:00.");
      const trail = JSON.parse(db._one("SELECT v FROM settings WHERE k='trail_once'").v);
      a.ok(trail.some((t) => t.indexOf("d|parkok|c1|") === 0), "the coordinators were not sent their copy");
    });
    await atTime("2026-10-19T20:03:00+01:00", async () => {
      const waits = [];
      const again = await J(await post(env, { action: "parked", key, parked: { reg: REG, checkId: "c1", miles: 57410,
        driver: "Bro Trevor", made: Date.parse(SUN_1500) } }, { waitUntil: (p) => waits.push(p) }));
      a.ok(again.ok && again.again, "the same reading again was not taken as already in");
      a.eq(waits.length, 0, "the same reading, sent again for a lost answer, was told again");
      const older = await J(await post(env, { action: "parked", key, parked: { reg: REG, checkId: "c1", miles: 57402,
        driver: "Bro Trevor", made: Date.parse("2026-10-18T14:30:00+01:00") } }));
      a.ok(older.ok && older.again, JSON.stringify(older));
      a.eq(older.parked.miles, 57410, "the phone is not given the reading kept");
      a.eq(Number(db._one("SELECT miles FROM parked WHERE check_id='c1'").miles), 57410,
           "a reading keyed earlier replaced one keyed later");
    });
  });

  s.test("at 2pm, once, the morning's driver is reminded while it is still to be keyed", async (a) => {
    const subOf = async (db) => db.prepare("INSERT INTO push_subs (endpoint, role, driver, route, made) VALUES (?, 'driver', 'Bro Trevor', 'North', ?)")
      .bind("https://push.example/trevor", Date.now()).run();
    const lastOf = (db) => db._one("SELECT last FROM push_subs WHERE endpoint='https://push.example/trevor'").last;
    {
      const { db, env } = await fresh();
      await atTime(SUN_0800, () => walk(env, "c1", 57363));
      await subOf(db);
      await atTime("2026-10-18T13:59:00+01:00", () => W.wakeParkAsk(env));
      a.eq(lastOf(db), "", "reminded before two");
      await atTime("2026-10-18T14:00:00+01:00", () => W.wakeParkAsk(env));
      a.eq(lastOf(db), "parkask|" + KEY + "|" + REG, "not reminded at two");
      const said = await atTime("2026-10-18T14:00:00+01:00", () => W.pushWhat(env, "https://push.example/trevor"));
      a.eq(said.title, "Parked mileage not received");
      a.eq(said.body, REG + ".");
      await db.prepare("UPDATE push_subs SET last=''").run();
      await atTime("2026-10-18T14:05:00+01:00", () => W.wakeParkAsk(env));
      a.eq(lastOf(db), "", "reminded twice");
    }
    {
      const { db, env } = await fresh();
      const key = await atTime(SUN_0800, async () => { await walk(env, "c1", 57363); return keyOf(env); });
      await subOf(db);
      await atTime("2026-10-18T13:30:00+01:00", () => park(env, key, {}));
      await db.prepare("UPDATE push_subs SET last=''").run();
      await atTime("2026-10-18T14:00:00+01:00", () => W.wakeParkAsk(env));
      a.eq(lastOf(db), "", "reminded with it keyed already");
      const said = await atTime("2026-10-18T14:20:00+01:00", () => W.pushWhat(env, "https://push.example/trevor"));
      a.not(said.title === "Parked mileage", "his phone still reads the reminder once it is keyed");
    }
    {
      const { db, env } = await fresh();
      await atTime(SUN_0800, () => walk(env, "c1", 57363));
      await subOf(db);
      await atTime("2026-10-18T15:00:00+01:00", () => W.wakeParkAsk(env));
      a.eq(lastOf(db), "", "reminded after three");
    }
    {
      const { db, env } = await fresh();
      const key = await atTime(SUN_0800, async () => { await walk(env, "c1", 57363); return keyOf(env); });
      await subOf(db);
      await atTime("2026-10-18T13:45:00+01:00", () => run(env, key, "2026-10-18T13:45:00+01:00"));
      await atTime("2026-10-18T14:00:00+01:00", () => W.wakeParkAsk(env));
      a.eq(lastOf(db), "", "reminded a quarter of an hour after Trip ended said it");
      await atTime("2026-10-18T14:16:00+01:00", () => W.wakeParkAsk(env));
      a.eq(lastOf(db), "parkask|" + KEY + "|" + REG, "not reminded once the half hour had passed");
    }
    {
      const { db, env } = await fresh();
      await atTime(WED_1000, () => walk(env, "c9", 57400));
      await subOf(db);
      await atTime("2026-10-21T14:00:00+01:00", () => W.wakeParkAsk(env));
      a.eq(lastOf(db), "", "reminded on a weekday");
    }
    {
      const { db, env } = await fresh();
      await atTime(SUN_0800, async () => {
        await walk(env, "c1", 57363);
        await post(env, { action: "check", check: { id: "c5", reg: "NH56 FWP", level: "ok", driver: "Bro Trevor", miles: "81000" } });
      });
      await subOf(db);
      await atTime("2026-10-18T14:00:00+01:00", async () => {
        a.eq(await W.wakeParkAsk(env) >= 0, true);
        a.eq(lastOf(db), "parkask|" + KEY + "|NH56 FWP and " + REG, "not one reminder naming both buses");
        const said = await W.pushWhat(env, "https://push.example/trevor");
        a.eq(said.body, "NH56 FWP and " + REG + ".");
      });
    }
  });

  s.test("the coordinator's app is given each bus's parked reading", async (a) => {
    const src = readFileSync(join(root, "server", "worker.js"), "utf8");
    a.ok(/out\.parked = await parkedLatest\(env\)/.test(src), "coordLoad does not carry it");
    const page = readFileSync(join(root, "coord", "index.html"), "utf8");
    a.ok(page.indexOf("Parked mileage not reported since the last walkaround") > -1, "the bus screen does not say it");
  });

  /* ------------------------------------------------------- the sheet */

  function sheet(rows, props) {
    const tabs = {
      "Drivers": tab("Drivers", [
        { Name: "Bro Arthur", Role: "Coordinator", Active: "YES", "Primary order": 1, PIN: "1234", Email: "arthur@b.c", Route: "North" },
        { Name: "Bro Trevor", Role: "Driver", Active: "YES", "Primary order": 2, PIN: "4321", Email: "t@b.c", Route: "South" }]),
      "Buses": tab("Buses", [{ Registration: REG, "Seats for passengers": 16, Active: "YES" }]),
      "Checks": rows ? [NEW_CHECKS].concat(rows.map(newRow)) : [TABS["Checks"]],
      "Defects": [TABS["Defects"]], "Trip Events": [TABS["Trip Events"]],
      "Bus Bookings": [TABS["Bus Bookings"]]
    };
    return loadCodeGs(root, { tabs, props: Object.assign({ WORKER_URL: "https://worker.test", PIN_SALT: "salt",
                                                           parkedFrom: String(Date.parse("2026-09-01T00:00:00Z")) }, props || {}) });
  }
  function worker(L, answers) {
    const sent = [];
    L.ctx.UrlFetchApp = { fetch(url, opts) {
      const body = JSON.parse((opts && opts.payload) || "{}");
      sent.push(body);
      const fn = (answers || {})[body.action];
      const out = typeof fn === "function" ? fn(body) : (fn || { ok: true });
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(out), getAllHeaders: () => ({}) };
    } };
    return sent;
  }
  const col = (h) => NEW_CHECKS.indexOf(h) + 1;
  const walkRow = (id, when, miles, parked) => ({
    Received: new Date(when), "Check ID": id, Date: when.slice(8, 10) + "/" + when.slice(5, 7) + "/" + when.slice(0, 4),
    Time: when.slice(11, 16), Vehicle: "Minibus", Registration: REG, Driver: "Bro Trevor", Mileage: miles,
    "Parked mileage": parked === undefined ? "" : parked, Outcome: "Clear" });
  const chk = (miles, over) => Object.assign({ id: "c-new", reg: REG, vehicle: "Minibus", driver: "Bro Trevor",
    date: "25/10/2026", time: "08:00", level: "ok", miles: String(miles), checked: 10, total: 10, pinState: "ok" }, over || {});
  const lastRow = (L) => L.gas.ss.getSheetByName("Checks").getLastRow();
  const cell = (L, r, h) => L.gas.ss.getSheetByName("Checks").getRange(r, col(h)).getValue();
  const alerts = (sent) => sent.filter((b) => b.action === "coordAlert").map((b) => b.alert);
  const NEXT = "2026-10-25T08:00:00+00:00";

  s.test("the drain puts the reading on its walkaround's row, with who and when", async (a) => {
    await atTime(SUN_1500, () => {
      const L = sheet([walkRow("c1", "2026-10-18T08:00:00+01:00", 57363)]);
      const sent = worker(L, { drain: { ok: true, claim: -7, bookings: [], trips: [], checks: [], auths: [],
        decisions: [], requests: [],
        parked: [{ id: 3, checkId: "c1", reg: REG, miles: 57410, driver: "Bro Trevor", at: Date.now(), confirmed: true }] } });
      call(L, "drainFromWorker");
      a.eq(cell(L, 2, "Parked mileage"), 57410, "not on the walkaround's row");
      const note = L.gas.ss.getSheetByName("Checks").getRange(2, col("Parked mileage")).getNote();
      a.ok(/Keyed by Bro Trevor on 18\/10\/2026 at 15:00/.test(note), "no note of who and when: " + note);
      a.eq(cell(L, 2, "Parked at"), "15:00", "no Parked at time (Asim, 18 Oct 2026)");
      const done = sent.find((b) => b.action === "drained");
      a.ok(done && (done.parked || []).indexOf(3) > -1, "not reported done");
    });
  });

  s.test("the next walkaround is measured from it to the mile: none moved is 0, and nobody is told", async (a) => {
    await atTime(NEXT, () => {
      const L = sheet([walkRow("c1", "2026-10-18T08:00:00+01:00", 57363, 57410)]);
      const sent = worker(L, {});
      call(L, "handleCheck", chk(57410));
      a.eq(cell(L, lastRow(L), "Since parked"), 0);
      a.eq(alerts(sent).length, 0, "the coordinators were told about a bus that had not moved");
    });
  });

  s.test("one mile since it was parked is recorded and told", async (a) => {
    await atTime(NEXT, () => {
      const L = sheet([walkRow("c1", "2026-10-18T08:00:00+01:00", 57363, 57410)]);
      const sent = worker(L, {});
      call(L, "handleCheck", chk(57411));
      a.eq(cell(L, lastRow(L), "Since parked"), 1);
      const al = alerts(sent);
      a.eq(al.length, 1, "nobody was told");
      a.eq(al[0].title, REG + ": 1 mile since it was parked");
      a.ok(al[0].body.indexOf("Parked 57,410 after the walkaround on 18/10/2026.") === 0, al[0].body);
      a.ok(al[0].body.indexOf("Walkaround 57,411 on 25/10/2026 at 08:00.") > -1, al[0].body);
      a.eq(al[0].kind, "mileage");
    });
  });

  s.test("a reading lower than the parked one is said as lower", async (a) => {
    await atTime(NEXT, () => {
      const L = sheet([walkRow("c1", "2026-10-18T08:00:00+01:00", 57363, 57410)]);
      const sent = worker(L, {});
      call(L, "handleCheck", chk(57405));
      a.eq(cell(L, lastRow(L), "Since parked"), -5);
      a.eq(alerts(sent)[0].title, REG + ": 5 miles lower than when it was parked");
    });
  });

  /* Four Sundays a week apart, each 30 miles to the next: a usual Sunday is 30. */
  const usualRows = () => [
    walkRow("c-a", "2026-09-20T08:00:00+01:00", 57270),
    walkRow("c-b", "2026-09-27T08:00:00+01:00", 57300),
    walkRow("c-c", "2026-10-04T08:00:00+01:00", 57330),
    walkRow("c-d", "2026-10-11T08:00:00+01:00", 57360),
    walkRow("c1", "2026-10-18T08:00:00+01:00", 57390)];

  s.test("with no parked reading: Not reported, the gap and a usual Sunday in a note, and told only when well over", async (a) => {
    await atTime(NEXT, () => {
      const L = sheet(usualRows());
      const sent = worker(L, {});
      call(L, "handleCheck", chk(57420));
      const r = lastRow(L);
      a.eq(cell(L, r, "Since parked"), "Not reported");
      const note = L.gas.ss.getSheetByName("Checks").getRange(r, col("Since parked")).getNote();
      a.eq(note, "30 since the walkaround on 18/10/2026. A usual Sunday is 30.");
      a.eq(alerts(sent).length, 0, "a usual Sunday was told");
    });
    await atTime(NEXT, () => {
      const L = sheet(usualRows());
      const sent = worker(L, {});
      call(L, "handleCheck", chk(57390 + 46));
      const al = alerts(sent);
      a.eq(al.length, 1, "46 miles against a usual 30 was not told");
      a.eq(al[0].title, REG + ": 46 miles since 18/10/2026");
      a.ok(al[0].body.indexOf("Parked mileage not reported after that walkaround. A usual Sunday is 30 miles.") === 0, al[0].body);
    });
    await atTime(NEXT, () => {
      const L = sheet(usualRows());
      const sent = worker(L, {});
      call(L, "handleCheck", chk(57390 + 45));
      a.eq(alerts(sent).length, 0, "exactly half as much again is not more than it");
    });
  });

  s.test("a Sunday with its parked reading counts as that Sunday alone towards a usual Sunday", (a) => {
    const L = sheet([]);
    const t = (iso, miles, parked) => ({ t: Date.parse(iso), key: iso.slice(0, 10), miles, parked: parked === undefined ? null : parked });
    const usual = call(L, "usualSunday", [
      t("2026-09-27T08:00:00+01:00", 57300, 57320),   /* 20 on the Sunday */
      t("2026-10-04T08:00:00+01:00", 57400, 57424),   /* 24; the week before had 80 midweek */
      t("2026-10-11T08:00:00+01:00", 57424, 57446),   /* 22 */
      t("2026-10-18T08:00:00+01:00", 57446)]);
    a.eq(usual, 22, "the middle of 20, 24 and 22 is 22");
    a.eq(call(L, "usualSunday", [t("2026-10-11T08:00:00+01:00", 1, 21)]), 0, "a usual Sunday from one Sunday");
  });

  s.test("nothing to measure from: the first walkaround, a second the same day, one before the column", async (a) => {
    await atTime(NEXT, () => {
      const L = sheet([]);
      worker(L, {});
      call(L, "handleCheck", chk(57410));
      a.eq(cell(L, lastRow(L), "Since parked"), "");
    });
    await atTime("2026-10-25T09:00:00+00:00", () => {
      const L = sheet([walkRow("c1", "2026-10-25T08:00:00+00:00", 57400)]);
      worker(L, {});
      call(L, "handleCheck", chk(57401, { time: "09:00" }));
      a.eq(cell(L, lastRow(L), "Since parked"), "", "a second walkaround the same morning says Not reported");
    });
    await atTime(NEXT, () => {
      const L = sheet([walkRow("c1", "2026-10-18T08:00:00+01:00", 57363)],
                      { parkedFrom: String(Date.parse("2026-10-20T00:00:00Z")) });
      worker(L, {});
      call(L, "handleCheck", chk(57400));
      a.eq(cell(L, lastRow(L), "Since parked"), "", "Not reported about a walkaround from before there were parked readings");
    });
    await atTime(NEXT, () => {
      const L = sheet([walkRow("c1", "2026-10-18T08:00:00+01:00", 57363, 57410),
                       walkRow("c-wed", "2026-10-21T10:00:00+01:00", 57410)]);
      const sent = worker(L, {});
      call(L, "handleCheck", chk(57500));
      a.eq(cell(L, lastRow(L), "Since parked"), "", "Not reported after a weekday walkaround, when none could be keyed");
      a.eq(alerts(sent).length, 0);
    });
  });

  s.test("a reading filed after the next walkaround puts that walkaround right, and tells it", async (a) => {
    await atTime("2026-10-25T08:10:00+00:00", () => {
      const L = sheet([walkRow("c1", "2026-10-18T08:00:00+01:00", 57390),
                       walkRow("c2", "2026-10-25T08:00:00+00:00", 57460)]);
      L.gas.ss.getSheetByName("Checks").getRange(3, col("Since parked")).setValue("Not reported");
      const sent = worker(L, { drain: { ok: true, claim: -7, bookings: [], trips: [], checks: [], auths: [],
        decisions: [], requests: [],
        parked: [{ id: 4, checkId: "c1", reg: REG, miles: 57400, driver: "Bro Trevor",
                   at: Date.parse("2026-10-18T15:00:00+01:00"), confirmed: true }] } });
      call(L, "drainFromWorker");
      a.eq(cell(L, 2, "Parked mileage"), 57400);
      a.eq(cell(L, 3, "Since parked"), 60, "the next walkaround still says Not reported");
      const al = alerts(sent);
      a.eq(al.length, 1, "not told");
      a.eq(al[0].title, REG + ": 60 miles since it was parked");
    });
  });

  s.test("an older tab gains the three columns beside Mileage, and its rows keep their values", async (a) => {
    await atTime(NEXT, () => {
      const old = TABS["Checks"];
      const prev = old.map((h) => ({ Received: new Date("2026-10-18T07:00:00Z"), "Check ID": "c1", Date: "18/10/2026",
        Time: "08:00", Registration: REG, Mileage: 57363, Outcome: "Clear", "PIN check": "Verified" }[h] || ""));
      const tabs = { "Checks": [old, prev], "Defects": [TABS["Defects"]],
                     "Buses": tab("Buses", [{ Registration: REG, "Seats for passengers": 16, Active: "YES" }]) };
      const L = loadCodeGs(root, { tabs, props: { WORKER_URL: "https://worker.test", PIN_SALT: "salt" } });
      worker(L, {});
      call(L, "handleCheck", chk(57400));
      a.eq(L.ctx.PropertiesService.getScriptProperties().getProperty("parkedFrom"), null,
           "parked readings counted as begun before the live server could take one");
      worker(L, { drain: { ok: true, claim: -7, bookings: [], trips: [], checks: [], auths: [], decisions: [],
                           requests: [], parked: [] } });
      call(L, "drainFromWorker");
      a.eq(Number(L.ctx.PropertiesService.getScriptProperties().getProperty("parkedFrom")), Date.parse(NEXT),
           "the first drain from a server with parked readings does not mark when they began");
      const sh = L.gas.ss.getSheetByName("Checks");
      const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      a.eq(head.indexOf("Parked mileage"), head.indexOf("Mileage flag") + 1, "not beside Mileage");
      a.eq(head.indexOf("Parked at"), head.indexOf("Parked mileage") + 1);
      a.eq(head.indexOf("Since parked"), head.indexOf("Parked at") + 1);
      a.eq(sh.getRange(2, head.indexOf("Outcome") + 1).getValue(), "Clear", "an old row's Outcome moved");
      a.eq(sh.getRange(2, head.indexOf("PIN check") + 1).getValue(), "Verified", "an old row's PIN check moved");
      a.eq(sh.getRange(3, head.indexOf("Mileage") + 1).getValue(), "57400");
    });
  });

  s.test("the sheet's mileage answer names the walkaround and its parked reading", async (a) => {
    await atTime(SUN_1500, () => {
      const L = sheet([walkRow("c1", "2026-10-18T08:00:00+01:00", 57363, 57410)]);
      const out = call(L, "lastMileagePayload");
      a.eq(out.last[REG].checkId, "c1");
      a.eq(out.last[REG].parked.miles, 57410);
      a.eq(out.last[REG].parked.checkId, "c1");
    });
  });

  /* ------------------------------------------------------- the pages */

  s.test("the driver app offers it on the hub and measures the walkaround from it", (a) => {
    const src = readFileSync(join(root, "index.html"), "utf8");
    a.ok(src.indexOf('<div id="hubParked"></div>') > -1, "no place for it on the hub");
    a.ok(/action:"parked", key: key/.test(src), "it is not sent with the driver's key");
    a.ok(/!sameName\(o\.driver, st\.driver\)\) return;/.test(src), "shown to everybody, not only the morning's driver");
    a.ok(/var pk = parkedBase\(st\.veh\.reg\);/.test(src), "the walkaround's check is not measured from it");
    a.ok(/parkSeen\(out\)/.test(src), "the live server's answer is not read for it");
    a.ok(/delete PARKED\[/.test(src), "a walkaround leaves the old parked reading in place");
  });

  return s;
}
