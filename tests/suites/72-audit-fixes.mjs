/* THE AUDIT FIXES, 16 October 2026. pages v1.123.0 · server w2.64.0 ·
   sheet v1.121.0.

   - Wrong PINs are counted per phone, so a stranger cannot lock a driver
     out; a ceiling per name stops guessing from many phones.
   - A right PIN gets the driver app a key. Runs, rota requests and MOT runs
     need it; a walkaround without it is filed as not confirmed and cannot
     lift a stop.
   - A time typed on the Trip Events tab reaches the live server.
   - Passengers' numbers go six weeks after their Sunday, on both sides.
   - The knock cross shows only while something is waiting.
   - A monthly summary that did not go out is a cross on the health check.
   - An open critical defect asks "Has this been fixed?" on its check item.

   Everything here fails on w2.63.0 / v1.120.0 / v1.122.0. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab } from "../lib/tabs.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const SUN = "2026-10-18T09:30:00+01:00";
const KEY = "2026-10-18";
const TREVOR = "4321";
const REG = "YS70 PWE";

export default async function (root) {
  const s = new Suite("the audit fixes");
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
  const post = (env, body, ip) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", headers: ip ? { "cf-connecting-ip": ip } : {},
    body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const signIn = async (env, pin, ip, key) =>
    J(await post(env, { action: "pin", pin: { driver: "Bro Trevor", pin, key } }, ip));
  const trip = (env, key, driver) => post(env, { action: "trip", key, trip: { trip: "t1", route: "North",
    driver: driver || "Bro Trevor", sunday: KEY, events: [{ event: "start", at: Date.now() - 60000 }] } });
  const check = (env, id, level, key) => post(env, { action: "check", key,
    check: { id, reg: REG, level, driver: "Bro Trevor" } });

  s.test("a stranger's wrong PINs lock his phone, not the driver's", async (a) => {
    await atTime(SUN, async () => {
      const { env } = await fresh();
      for (let i = 0; i < 3; i++) await signIn(env, "0000", "203.0.113.9");
      a.eq((await signIn(env, TREVOR, "203.0.113.9")).locked, true, "the stranger was not locked");
      const own = await signIn(env, TREVOR, "198.51.100.4");
      a.eq(own.valid, true, "the driver was locked out by somebody else: " + JSON.stringify(own));
    });
  });

  s.test("thirty wrong PINs in an hour from anywhere lock the name", async (a) => {
    await atTime(SUN, async () => {
      const { env } = await fresh();
      for (let i = 0; i < 30; i++) await signIn(env, "0000", "192.0.2." + i);
      const out = await signIn(env, TREVOR, "198.51.100.4");
      a.eq(out.locked, true, "guessing from many phones was not stopped");
    });
  });

  s.test("a right PIN gives a key, and a run needs it", async (a) => {
    await atTime(SUN, async () => {
      const { db, env } = await fresh();
      a.eq((await J(await trip(env, ""))).error, "pin", "a run was taken with no key");
      a.eq((await J(await trip(env, "", "Bro Nobody"))).error, "pin", "a name nobody knows was taken");
      const out = await signIn(env, TREVOR);
      a.ok(/^[0-9a-f]{32}$/.test(String(out.key)), "no key: " + JSON.stringify(out));
      a.eq((await signIn(env, TREVOR, "", out.key)).key, out.key, "the phone's own key was not handed back");
      a.ok((await J(await trip(env, out.key))).ok, "the run was refused with the key");
      a.eq(db._rows("SELECT * FROM driver_keys").length, 1);
      a.eq(JSON.stringify(db._rows("SELECT * FROM driver_keys")).indexOf(out.key), -1, "the key is stored plain");
      a.ok((await J(await post(env, { action: "trip", trip: { trip: "t2", route: "South", driver: "Sis Ama",
        sunday: KEY, events: [{ event: "start", at: Date.now() }] } }))).ok, "a name with no PIN needs no key");
    });
  });

  s.test("a rota request and an MOT run need the key too", async (a) => {
    await atTime(SUN, async () => {
      const { env } = await fresh();
      const rq = { id: "rq1", date: "2026-10-25", driver: "Bro Trevor", type: "Request cover", reason: "Away" };
      a.eq((await J(await post(env, { action: "rotaRequest", request: rq }))).error, "pin");
      const key = (await signIn(env, TREVOR)).key;
      a.ok((await J(await post(env, { action: "rotaRequest", request: rq, key }))).ok);
      a.eq((await J(await post(env, { action: "motrun", motrun: { reg: REG, step: "start", who: "Bro Trevor" } }))).error, "pin");
    });
  });

  s.test("a new PIN or a reset ends every phone's key", async (a) => {
    await atTime(SUN, async () => {
      const { env } = await fresh();
      const old = (await signIn(env, TREVOR)).key;
      const ch = await J(await post(env, { action: "pinchange", pin: { driver: "Bro Trevor", pin: TREVOR, newPin: "2580" } }));
      a.eq(ch.changed, true);
      a.eq((await J(await trip(env, old))).error, "pin", "the old key still works after a change");
      a.ok((await J(await trip(env, ch.key))).ok, "the new key does not work");
      a.eq(await W.keyNameOf(env, ch.key), "bro trevor");
    });
  });

  s.test("a walkaround with no key is filed, but cannot lift a stop", async (a) => {
    await atTime(SUN, async () => {
      const { db, env } = await fresh();
      const key = (await signIn(env, TREVOR)).key;
      a.ok((await J(await check(env, "c1", "stop", key))).ok);
      const fake = await J(await check(env, "c2", "ok", ""));
      a.ok(fake.ok, "a walkaround was refused");
      a.eq(fake.stopHeld, true);
      a.eq(db._one("SELECT * FROM checks_today WHERE reg=?", REG).state, "stopped", "the stop was lifted");
      a.eq(JSON.parse(db._one("SELECT body FROM checks_in WHERE check_id='c2'").body).pinState, "unconfirmed");
      await W.handleSync(env, { checks: [{ reg: REG, day: KEY, state: "ok", at: Date.now(), driver: "X", id: "c3", confirmed: false }] });
      a.eq(db._one("SELECT * FROM checks_today WHERE reg=?", REG).state, "stopped", "the sheet's copy lifted the stop");
      await check(env, "c4", "ok", key);
      a.eq(db._one("SELECT * FROM checks_today WHERE reg=?", REG).state, "ok", "his own check could not lift it");
      a.eq((await J(await post(env, { action: "keyok", driver: "Bro Trevor", key }))).confirmed, true);
    });
  });

  s.test("a time typed on Trip Events corrects the live server's row", async (a) => {
    await atTime(SUN, async () => {
      const { db, env } = await fresh();
      const key = (await signIn(env, TREVOR)).key;
      await trip(env, key);
      const row = db._one("SELECT * FROM trip_events WHERE trip='t1'");
      await db.prepare("UPDATE trip_events SET synced=1 WHERE id=?").bind(row.id).run();
      const out = await J(await post(env, { action: "sheettrips", edits: [{ id: row.id, time: "9:05" }, { id: 999, time: "09:00" }] }));
      a.eq(out.results[0].applied, true, JSON.stringify(out));
      a.eq(out.results[1].why, "not here");
      const now = db._one("SELECT * FROM trip_events WHERE id=?", row.id);
      a.eq(W.londonHHMM(new Date(now.happened)), "09:05");
      a.has(now.status, "Corrected");
      a.has(now.fix_note, "Corrected on the sheet");
      a.eq(now.synced, 0, "not sent back to the sheet");
    });
  });

  s.test("passengers' numbers go six weeks after their Sunday", async (a) => {
    await atTime(SUN, async () => {
      const { db, env } = await fresh();
      const add = (sun, synced) => db.prepare("INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received, synced) " +
        "VALUES (?, 'North', 'N01', 'Scarisbrick Dr', 1, 'd', 'pid1', '07700900123', 'Booked', 0, ?)").bind(sun, synced).run();
      await add("2026-08-30", 1);
      await add("2026-08-30", 0);
      await add("2026-09-13", 1);
      await W.forgetOldNumbers(env);
      const rows = db._rows("SELECT sunday, phone, pid, synced FROM bookings WHERE sunday < '2026-10-01' ORDER BY id");
      a.eq(rows[0].phone + rows[0].pid, "", "an old number was kept");
      a.eq(rows[1].phone, "07700900123", "a row the sheet has not taken was changed");
      a.eq(rows[2].phone, "07700900123", "a number inside six weeks went");
    });
  });

  s.test("the knock cross only while something is waiting", (a) => {
    const src = readFileSync(join(root, "Code.gs"), "utf8");
    a.ok(src.indexOf("out.poke.waiting === false") !== -1);
    a.ok(readFileSync(join(root, "server", "worker.js"), "utf8").indexOf("poke.waiting = await anythingWaiting(env)") !== -1);
  });

  function sheet(props) {
    return loadCodeGs(root, { tabs: {
      "Bus Bookings": tab("Bus Bookings", [
        { Sunday: "30/08/2026", Route: "North", "Stop ID": "N01", Seats: 1, Status: "Booked", Phone: "07700900123", "Passenger ID": "abc" },
        { Sunday: "11/10/2026", Route: "North", "Stop ID": "N01", Seats: 1, Status: "Booked", Phone: "07700900124", "Passenger ID": "abd" }])
    }, props: Object.assign({ COORDINATOR_EMAIL: "coord@b.c" }, props || {}) });
  }

  s.test("the sheet blanks old numbers and reads a typed time", async (a) => {
    await atTime(SUN, () => {
      const L = sheet();
      call(L, "forgetOldPhones");
      const v = L.gas.ss.getSheetByName("Bus Bookings").getDataRange().getValues();
      const h = v[0], P = h.indexOf("Phone"), I = h.indexOf("Passenger ID");
      a.eq(String(v[1][P]) + String(v[1][I]), "", "an old number was kept");
      a.eq(String(v[2][P]), "07700900124", "a recent number went");
      a.eq(call(L, "tripCellHHMM", "9:05"), "09:05");
      a.eq(call(L, "tripCellHHMM", "18/10/2026 10:41:00"), "10:41");
      a.eq(call(L, "tripCellHHMM", "late"), "");
    });
  });

  s.test("a monthly summary that did not go out is a cross", async (a) => {
    await atTime("2026-10-26T09:00:00+00:00", () => {
      const L = sheet();
      a.has(call(L, "periodHealthLine", new L.ctx.Date()), "monthly summary for October 2026 did not go out");
      const ok = sheet({ periodSent: JSON.stringify({ "month:2026-10-25": "x" }) });
      a.eq(call(ok, "periodHealthLine", new ok.ctx.Date()), "");
    });
    await atTime("2026-10-18T21:00:00+01:00", () => {
      a.eq(call(sheet(), "periodHealthLine", new (sheet().ctx.Date)()), "", "a cross before the first one is due");
    });
  });

  s.test("the driver app asks whether an open critical defect was fixed, and sends its key", (a) => {
    const app = readFileSync(join(root, "index.html"), "utf8");
    a.ok(app.indexOf("Has this been fixed?") !== -1);
    a.ok(app.indexOf('"Yes, fixed"') !== -1 && app.indexOf('"No, still there"') !== -1);
    a.ok(/action:"trip", key: key/.test(app), "taps go without the key");
    a.ok(/action: "check", check: sent, key: key/.test(app), "walkarounds go without the key");
  });

  return s;
}
