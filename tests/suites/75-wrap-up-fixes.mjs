/* THE WRAP UP AUDIT FIXES, 16 October 2026. server w2.66.0 · sheet v1.123.0.

   - A phone on an app from before keys, refused once its fortnight is up,
     is named on both health checks, until a key comes for that name.
   - An address that has keyed the right PIN goes on past the name's
     ceiling of wrong PINs, so guessing from many phones cannot lock the
     coordinator app or a driver out for the hour.
   - A parked reading corrected by hand on the Checks tab reaches the live
     server, and the next walkaround's Since parked is worked out again.
   - The health check's line about a missed summary is facts only. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { TABS, tab } from "../lib/tabs.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const SUN = "2026-10-18T09:30:00+01:00";
const LATER = "2026-11-01T09:30:00+00:00";
const KEY = "2026-10-18";
const TREVOR = "4321";
const REG = "YS70 PWE";

const NEW_CHECKS = (() => {
  const h = TABS["Checks"].slice();
  h.splice(h.indexOf("Mileage flag") + 1, 0, "Parked mileage", "Since parked");
  return h;
})();
const newRow = (v) => NEW_CHECKS.map((h) => (h in v ? v[h] : ""));
const col = (h) => NEW_CHECKS.indexOf(h) + 1;

export default async function (root) {
  const s = new Suite("the wrap up audit fixes");
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
    return { db, env };
  }
  const post = (env, body, ip) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", headers: ip ? { "cf-connecting-ip": ip } : {},
    body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const signIn = async (env, pin, ip) =>
    J(await post(env, { action: "pin", pin: { driver: "Bro Trevor", pin } }, ip));
  /* As a phone on the app from before keys sends it: no key field at all. */
  const oldTrip = (env, id, driver) => post(env, { action: "trip", trip: { trip: id, route: "North",
    driver: driver || "Bro Trevor", sunday: KEY, events: [{ event: "start", at: Date.now() - 60000 }] } });

  /* ------------------------------------------- 2: the old phone, named */

  s.test("an old phone refused after its fortnight is named on the health checks, until a key comes", async (a) => {
    const { env } = await fresh();
    await atTime(SUN, async () => {
      a.ok((await J(await oldTrip(env, "t1"))).ok, "an old phone was refused inside the fortnight");
      a.eq((await W.keyRefusedLines(env)).length, 0, "named while it was still taken");
    });
    await atTime(LATER, async () => {
      a.eq((await J(await oldTrip(env, "t2"))).error, "pin");
      await post(env, { action: "rotaRequest", request: { id: "rq1", date: "2026-11-08", driver: "Bro Trevor",
        type: "Request cover", reason: "Away" } });
      const lines = await W.keyRefusedLines(env);
      a.eq(lines.length, 1, "one line per name: " + JSON.stringify(lines));
      a.has(lines[0], "Bro Trevor: rota request, 09:30 on");
      const health = await W.liveHealthLines(env);
      a.ok(health.bad.some((l) => /^Refused from a phone on an app older than v1\.123\.0, with no PIN key: Bro Trevor/.test(l)),
           "not on the coordinator app's health check: " + JSON.stringify(health.bad));
      const drain = await J(await post(env, { action: "drain", limit: 1 }));
      a.eq((drain.keyRefused || []).length, 1, "not sent to the sheet");
      /* A new-app phone with no key yet is asked for his PIN by the app: not news. */
      await post(env, { action: "trip", key: "", trip: { trip: "t3", route: "North", driver: "Bro Trevor",
        sunday: KEY, events: [] } });
      a.eq((await W.keyRefusedLines(env))[0].indexOf("stop taps"), -1, "a new phone's refusal was named");
      /* A name nobody knows names nobody. */
      await oldTrip(env, "t4", "Bro Nobody");
      a.eq((await W.keyRefusedLines(env)).length, 1);
      await signIn(env, TREVOR);
      a.eq((await W.keyRefusedLines(env)).length, 0, "still named once his PIN was keyed");
    });
  });

  s.test("a refusal is named for a week, then no longer", async (a) => {
    const { env } = await fresh();
    await atTime(SUN, async () => { await oldTrip(env, "t1"); });
    await atTime(LATER, async () => { await oldTrip(env, "t2"); });
    await atTime("2026-11-09T09:00:00+00:00", async () => {
      a.eq((await W.keyRefusedLines(env)).length, 0);
    });
  });

  s.test("the sheet's health check names it, facts only", async (a) => {
    await atTime(LATER, () => {
      const L = loadCodeGs(root, { props: { WORKER_URL: "https://worker.test", PIN_SALT: "salt" } });
      L.ctx.UrlFetchApp = { fetch() {
        return { getResponseCode: () => 200, getAllHeaders: () => ({}), getContentText: () => JSON.stringify({
          ok: true, script: "w2.66.0", bookings: [], trips: [], clockAgoSec: 10, pinSalt: true,
          keyRefused: ["Bro Trevor: stop taps, 09:30 on Sun 1 Nov"] }) };
      } };
      const lines = call(L, "liveCheckLines");
      a.ok(lines.some((l) => l === "✗  Refused from a phone on an app older than v1.123.0, with no PIN key: " +
                                    "Bro Trevor: stop taps, 09:30 on Sun 1 Nov."), "no line: " + JSON.stringify(lines));
    });
  });

  /* ------------------------------------------- 3: the ceiling */

  s.test("guessing from many phones locks strangers, not a phone that has had the right PIN", async (a) => {
    await atTime(SUN, async () => {
      const { env } = await fresh();
      a.eq((await signIn(env, TREVOR, "198.51.100.4")).valid, true);
      for (let i = 0; i < 30; i++) await signIn(env, "0000", "192.0.2." + i);
      a.eq((await signIn(env, TREVOR, "203.0.113.50")).locked, true, "a new address went past the ceiling");
      const own = await signIn(env, TREVOR, "198.51.100.4");
      a.eq(own.valid, true, "his own phone was locked out: " + JSON.stringify(own));
      /* His own three tries still hold on that address. */
      for (let i = 0; i < 3; i++) await signIn(env, "0000", "198.51.100.4");
      a.eq((await signIn(env, TREVOR, "198.51.100.4")).locked, true, "a known address had endless tries");
    });
  });

  s.test("an address known by a PIN that has since changed is not known any more", async (a) => {
    await atTime(SUN, async () => {
      const { env } = await fresh();
      await signIn(env, TREVOR, "198.51.100.4");
      const r = await W.actPinReset(env, {}, { name: "Bro Trevor" });
      await env.DB.batch(r.stmts);
      await env.DB.prepare("UPDATE drivers SET pin_hash=? WHERE name='Bro Trevor'")
        .bind(await W.pinHashOf(env, "Bro Trevor", "8642")).run();
      for (let i = 0; i < 30; i++) await signIn(env, "0000", "192.0.2." + i);
      a.eq((await signIn(env, "8642", "198.51.100.4")).locked, true, "the old PIN's address went past the ceiling");
    });
  });

  s.test("a known address is written once a day, not on every coordinator app call", async (a) => {
    const { db, env } = await fresh();
    await atTime(SUN, async () => {
      await signIn(env, TREVOR, "198.51.100.4");
      const at = db._one("SELECT v FROM settings WHERE k LIKE 'pinknown:%'").v;
      await signIn(env, TREVOR, "198.51.100.4");
      a.eq(db._one("SELECT v FROM settings WHERE k LIKE 'pinknown:%'").v, at);
    });
  });

  s.test("known addresses and old refusals are cleared once a day when their time is up", async (a) => {
    const { db, env } = await fresh();
    await atTime(SUN, async () => { await signIn(env, TREVOR, "198.51.100.4"); });
    await atTime(LATER, async () => {
      await oldTrip(env, "t1");
      await signIn(env, TREVOR, "198.51.100.5");
      await oldTrip(env, "t2");
    });
    await atTime("2026-11-20T09:00:00+00:00", async () => {
      await W.forgetOldNumbers(env);
      a.eq(db._rows("SELECT k FROM settings WHERE k LIKE 'pinknown:%'").length, 1, "an old address was kept, or a new one went");
      a.eq(db._rows("SELECT k FROM settings WHERE k LIKE 'keyrefused:%'").length, 0);
    });
  });

  /* ------------------------------------------- 4: a parked reading put right */

  s.test("the live server takes a parked reading corrected on the sheet, and one taken away", async (a) => {
    await atTime(SUN, async () => {
      const { db, env } = await fresh();
      await env.DB.prepare("INSERT INTO parked (check_id, reg, miles, driver, made, got, confirmed, synced) " +
        "VALUES ('c1', ?, 45312, 'Bro Trevor', 1, 1, 1, 9)").bind(REG).run();
      const out = await J(await post(env, { action: "sheetparked", edits: [
        { checkId: "c1", reg: REG, miles: 45213 }, { checkId: "c2", reg: REG, miles: 50000 }, { checkId: "c3", reg: REG, miles: "lots" }] }));
      a.eq(out.results.map((r) => r.applied).join(), "true,true,false");
      const r1 = db._one("SELECT * FROM parked WHERE check_id='c1'");
      a.eq(r1.miles, 45213);
      a.eq(r1.driver, "Bro Trevor", "who keyed it was lost");
      a.eq(r1.synced, 1, "a drain would write it back over the cell");
      a.eq(db._one("SELECT synced FROM parked WHERE check_id='c2'").synced, 1);
      await post(env, { action: "sheetparked", edits: [{ checkId: "c1", reg: REG, miles: "" }] });
      a.eq(db._rows("SELECT * FROM parked WHERE check_id='c1'").length, 0, "an emptied cell kept the reading");
    });
  });

  s.test("a Parked mileage cell typed over is sent, keeps who keyed it, and puts the next walkaround right", async (a) => {
    await atTime("2026-10-25T09:00:00+00:00", () => {
      const walkRow = (id, when, miles, parked) => ({
        Received: new Date(when), "Check ID": id, Date: when.slice(8, 10) + "/" + when.slice(5, 7) + "/" + when.slice(0, 4),
        Time: when.slice(11, 16), Vehicle: "Minibus", Registration: REG, Driver: "Bro Trevor", Mileage: miles,
        "Parked mileage": parked === undefined ? "" : parked, Outcome: "Clear" });
      const L = loadCodeGs(root, { tabs: {
        "Checks": [NEW_CHECKS].concat([walkRow("c1", "2026-10-18T08:00:00+01:00", 45180, 45312),
                                       walkRow("c2", "2026-10-25T08:00:00+00:00", 45213)].map(newRow)),
        "Drivers": tab("Drivers", [{ Name: "Bro Arthur", Role: "Coordinator", Active: "YES", "Primary order": 1, PIN: "1234", Route: "North" }])
      }, props: { WORKER_URL: "https://worker.test", PIN_SALT: "salt" } });
      const sent = [];
      L.ctx.UrlFetchApp = { fetch(url, opts) {
        sent.push(JSON.parse((opts && opts.payload) || "{}"));
        return { getResponseCode: () => 200, getAllHeaders: () => ({}), getContentText: () => JSON.stringify({ ok: true, results: [] }) };
      } };
      const sh = L.gas.ss.getSheetByName("Checks");
      sh.getRange(2, col("Parked mileage")).setNote("Keyed by Bro Trevor on 18/10/2026 at 15:00.");
      sh.getRange(3, col("Since parked")).setValue(-99);
      sh.getRange(2, col("Parked mileage")).setValue(45213);
      call(L, "onEditLive", { range: sh.getRange(2, col("Parked mileage")) });
      const p = sent.find((b) => b.action === "sheetparked");
      a.ok(p, "not sent to the live server");
      a.eq(JSON.stringify(p.edits), JSON.stringify([{ checkId: "c1", reg: REG, miles: 45213 }]));
      a.eq(sh.getRange(3, col("Since parked")).getValue(), 0, "the next walkaround still says -99");
      const note = sh.getRange(2, col("Parked mileage")).getNote();
      a.ok(/^Keyed by Bro Trevor on 18\/10\/2026 at 15:00\.\nCorrected on the sheet on 25\/10\/2026 at 09:00\.$/.test(note), note);
      /* Another column on the row sends nothing. */
      sent.length = 0;
      call(L, "onEditLive", { range: sh.getRange(2, col("Outcome")) });
      a.eq(sent.length, 0);
    });
  });

  /* ------------------------------------------- 5: facts only */

  s.test("a missed summary is said as a fact, with no instruction", async (a) => {
    await atTime("2026-10-26T09:00:00+00:00", () => {
      const L = loadCodeGs(root, { props: { COORDINATOR_EMAIL: "coord@b.c" } });
      a.eq(call(L, "periodHealthLine", new L.ctx.Date()), "The monthly summary for October 2026 did not go out.");
    });
  });

  return s;
}
