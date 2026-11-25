/* BUS USED, 25 November 2026. pages v1.191.0 · server w2.110.0 · sheet v1.153.0.

   Asim drove a bus on a Tuesday and had nowhere to put it. A weekday trip,
   no check: the Driver App's Bus used, under the signed-in name, or the
   Coordinator App's Record something, Bus used, with who drove. A Vehicle
   Log entry; nobody told; the next walkaround measured from the mileage
   left; the mileage when taken stands in for a Sunday parked reading still
   to come. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const SUN = "2026-11-22";
const SUN_0800 = "2026-11-22T08:00:00Z";
const TUE_1900 = "2026-11-24T19:00:00Z";
const PIN = "1234";
const REG = "YS70 PWE";

export default async function (root) {
  const s = new Suite("bus used on a weekday");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, SUN);
    await db.prepare("DELETE FROM drivers").run();
    for (const d of [["Bro Asim", "Coordinator", "North"], ["Pst Kehinde", "Driver", "South"]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind(d[0], d[1], d[2], await W.pinHashOf(env, d[0], PIN)).run();
    }
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    await W.cachePut(env, "bus_extra", {
      "YS70 PWE": { dates: { mot: "2027-10-20", service: "2027-09-30", insurance: "2027-06-26", permit: "2027-01-31" } },
      "NH56 FWP": { dates: { mot: "2027-04-28", service: "2027-07-01", insurance: "2027-07-08", permit: "2027-01-31" } }
    }).run();
    await W.cachePut(env, "coord_shelf", { builtAt: Date.now() - 60000, readAt: Date.now() - 60000, requests: [], defects: [],
      vehicles: { log: {}, jobs: {} } }).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const keyOf = async (env, who) => (await J(await post(env, { action: "pin", pin: { driver: who, pin: PIN } }))).key;
  const walk = (env, id, miles, key) => post(env, { action: "check", key,
    check: { id, reg: REG, level: "ok", driver: "Pst Kehinde", miles: String(miles) } });
  let n = 0;
  const coordAct = async (env, a) => J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN, op: "act",
    act: Object.assign({ id: "bu-act-" + (++n), kind: "vlog", reg: REG, what: "Bus used", status: "Done" }, a) }));

  s.test("Driver App: filed under his name, quiet, and the next walkaround counts from it", async (a) => {
    const { db, env } = await fresh();
    const kk = await atTime(SUN_0800, async () => { const k = await keyOf(env, "Pst Kehinde"); await walk(env, "c1", 31544, k); return k; });
    await atTime(TUE_1900, async () => {
      const key = await keyOf(env, "Bro Asim");
      const bare = await J(await post(env, { action: "busused", used: { id: "used-0001", reg: REG, day: "2026-11-24", miles: 31590,
        fuel: "3/8 tank", driver: "Bro Asim" } }));
      a.eq(bare.ok, false, "taken without a key");
      const out = await J(await post(env, { action: "busused", key, used: { id: "used-0001", reg: REG, day: "2026-11-24",
        taken: 31556, miles: 31590, fuel: "3/8 tank", driver: "Bro Asim" } }));
      a.ok(out.ok, JSON.stringify(out));
      const row = db._one("SELECT * FROM coord_actions WHERE id='used-0001'");
      const b = JSON.parse(row.body);
      a.eq(b.what, "Bus used"); a.eq(b.drove, "Bro Asim"); a.eq(b.source, "Driver App");
      a.eq(b.miles, 31590); a.eq(b.taken, 31556); a.eq(b.fuel, "3/8 tank");
      a.eq(row.by_name, "Bro Asim");
      a.eq(db._rows("SELECT id FROM coord_actions WHERE kind='mail'").length, 0, "somebody was told");
      const pk = await W.parkedLatest(env);
      a.eq(pk[REG].miles, 31590, "the next walkaround is not measured from the mileage left");
      a.eq(pk[REG].used, true);
      const p = db._one("SELECT * FROM parked WHERE check_id='c1'");
      a.eq(Number(p.miles), 31556, "the mileage when taken did not stand in for Sunday's parked reading");
      a.eq(p.src, "used");
      const again = await J(await post(env, { action: "busused", key, used: { id: "used-0001", reg: REG, day: "2026-11-24",
        taken: 31556, miles: 31590, fuel: "3/8 tank", driver: "Bro Asim" } }));
      a.ok(again.duplicate, "sent twice made two entries");
    });
  });

  s.test("Coordinator App: who drove is needed, and the checks hold", async (a) => {
    const { env } = await fresh();
    await atTime(TUE_1900, async () => {
      a.eq((await coordAct(env, { done: "2026-11-24", miles: 31590, fuel: "3/8 tank" })).error, "Say who drove.");
      a.eq((await coordAct(env, { done: "2026-11-24", drove: "Bro Solomon", miles: 31590 })).error, "Slide to the fuel showing.");
      a.eq((await coordAct(env, { done: "2026-11-24", drove: "Bro Solomon", taken: 31600, miles: 31590, fuel: "Full" })).error,
           "Mileage when left is lower than mileage when taken.");
      a.eq((await coordAct(env, { done: "2026-11-26", drove: "Bro Solomon", miles: 31590, fuel: "Full" })).error,
           "That day has not come yet.");
      const ok = await coordAct(env, { done: "2026-11-24", drove: "Bro Solomon", miles: 31590, fuel: "Full" });
      a.ok(ok.ok, JSON.stringify(ok));
      a.eq(ok.action.words, "YS70 PWE: used 24/11/2026 by Bro Solomon, left at 31,590, fuel Full.");
      const load = await J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN, op: "load" }));
      const e = load.vehicles.log[REG][0];
      a.eq(e.what, "Bus used"); a.eq(e.drove, "Bro Solomon"); a.eq(e.source, "Coordinator's app");
    });
  });

  s.test("the three lists of what can be recorded agree, Bus used first", (a) => {
    const lists = ["server/worker.js", "Code.gs", "coord/index.html"].map((f) =>
      (/VLOG_WHAT = (\[[^\]]+\])/.exec(readFileSync(join(root, f), "utf8")) || [])[1]);
    a.eq(lists[0], lists[1]); a.eq(lists[0], lists[2]);
    a.has(lists[0], '["Bus used", "MOT"');
  });

  s.test("the apps: Driver App button and screen, Record something on the coordinator's first screen", (a) => {
    const d = readFileSync(join(root, "index.html"), "utf8"), c = readFileSync(join(root, "coord/index.html"), "utf8");
    a.ok(/id="toUsed"[^>]*>Bus used</.test(d), "no Bus used button");
    a.ok(/action:"busused"/.test(d), "the Driver App does not send it");
    a.ok(/item\("bookings\/"[\s\S]{0,300}data-do="recordpick"[\s\S]{0,120}Record something[\s\S]{0,200}item\("runs"/.test(c),
         "Record something is not under Bookings");
  });

  return s;
}
