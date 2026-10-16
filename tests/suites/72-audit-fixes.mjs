/* THE AUDIT FIXES, 16 October 2026. pages v1.123.0 · server w2.64.0 ·
   sheet v1.121.0.

   - Wrong PINs are counted per phone, so a stranger cannot lock a driver
     out; a ceiling per name stops guessing from many phones, and one phone
     alone cannot reach it.
   - A right PIN gets the driver app a key. Runs, rota requests and MOT runs
     need it (a phone still on the old app is taken for a fortnight); a
     walkaround without it is filed as not confirmed and cannot lift a stop.
   - A time typed on the Trip Events tab reaches the live server.
   - Passengers' numbers go six weeks after their Sunday, on both sides.
   - The knock cross shows only while something is waiting.
   - A monthly summary that did not go out is a cross on the health check.
   - An open critical defect asks "Has this been fixed?" on its check item.

   Written for w2.64.0 / v1.121.0 / v1.123.0. */

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
      a.eq((await J(await post(env, { action: "rotaRequest", request: rq, key: "" }))).error, "pin");
      const key = (await signIn(env, TREVOR)).key;
      a.ok((await J(await post(env, { action: "rotaRequest", request: rq, key }))).ok);
      a.eq((await J(await post(env, { action: "motrun", key: "", motrun: { reg: REG, step: "start", who: "Bro Trevor" } }))).error, "pin");
    });
  });

  s.test("a phone still on the old app is taken for a fortnight, then refused", async (a) => {
    const { db, env } = await fresh();
    const old = (id) => post(env, { action: "trip", trip: { trip: id, route: "North", driver: "Bro Trevor",
      sunday: KEY, events: [{ event: "start", at: Date.now() - 60000 }] } });
    await atTime(SUN, async () => {
      a.ok((await J(await old("t1"))).ok, "an old phone's run was refused on the first Sunday");
      const rq = { id: "rq2", date: "2026-10-25", driver: "Bro Trevor", type: "Request cover", reason: "Away" };
      a.ok((await J(await post(env, { action: "rotaRequest", request: rq }))).ok, "an old phone's request was refused");
      a.has(JSON.parse(db._one("SELECT body FROM requests").body).reason, "Not confirmed by PIN.");
      a.eq((await J(await post(env, { action: "keyok", driver: "Bro Trevor", key: "", keyless: true }))).allowed, true);
    });
    await atTime("2026-11-01T09:30:00+00:00", async () => {
      a.eq((await J(await old("t2"))).error, "pin", "an old phone was still taken after two weeks");
      a.eq((await J(await post(env, { action: "keyok", driver: "Bro Trevor", key: "", keyless: true }))).allowed, false);
    });
  });

  s.test("a name with no PIN can run, but cannot lift a stop, and an inactive one cannot run", async (a) => {
    await atTime(SUN, async () => {
      const { db, env } = await fresh();
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES ('Bro Gone','Driver','North',2,0,'')").run();
      const run = (who, id) => post(env, { action: "trip", key: "", trip: { trip: id, route: "South", driver: who,
        sunday: KEY, events: [{ event: "start", at: Date.now() }] } });
      a.eq((await J(await run("Bro Gone", "t8"))).error, "pin", "an inactive name ran");
      a.ok((await J(await run("Sis Ama", "t9"))).ok, "a name with no PIN could not run");
      const key = (await signIn(env, TREVOR)).key;
      await check(env, "c1", "stop", key);
      const out = await J(await post(env, { action: "check", key: "", check: { id: "c2", reg: REG, level: "ok", driver: "Sis Ama" } }));
      a.eq(out.stopHeld, true, "a name with no PIN lifted a stop");
      a.eq(db._one("SELECT * FROM checks_today WHERE reg=?", REG).state, "stopped");
    });
  });

  s.test("the sheet's copy of a held check, saying nothing, does not lift the stop", async (a) => {
    await atTime(SUN, async () => {
      const { db, env } = await fresh();
      const key = (await signIn(env, TREVOR)).key;
      await check(env, "c1", "stop", key);
      await check(env, "c2", "ok", "");
      /* As a sheet from before v1.121.0 sends it: no confirmed at all. */
      await W.handleSync(env, { checks: [{ reg: REG, day: KEY, state: "ok", at: Date.now(), driver: "Bro Trevor", id: "c2" }] });
      a.eq(db._one("SELECT * FROM checks_today WHERE reg=?", REG).state, "stopped", "the echo lifted the stop");
    });
  });

  s.test("a stop sent late beats an all-clear nobody confirmed", async (a) => {
    await atTime(SUN, async () => {
      const { db, env } = await fresh();
      const key = (await signIn(env, TREVOR)).key;
      await check(env, "c9", "ok", "");
      a.eq(db._one("SELECT * FROM checks_today WHERE reg=?", REG).state, "ok");
      /* Made ten minutes before the fake all-clear, sent after it. */
      await post(env, { action: "check", key, check: { id: "c1", reg: REG, level: "stop", driver: "Bro Trevor", age: 600000 } });
      a.eq(db._one("SELECT * FROM checks_today WHERE reg=?", REG).state, "stopped", "the fake all-clear kept the bus out");
      /* His own confirmed all-clear after that still lets it go. */
      await check(env, "c3", "ok", key);
      a.eq(db._one("SELECT * FROM checks_today WHERE reg=?", REG).state, "ok");
    });
  });

  s.test("one stranger alone cannot reach the name's ceiling", async (a) => {
    const { env } = await fresh();
    const t0 = new Date(SUN).getTime();
    for (let i = 0; i < 12; i++) {
      await atTime(new Date(t0 + i * 6 * 60000).toISOString(), async () => {
        for (let j = 0; j < 3; j++) await signIn(env, "0000", "203.0.113.9");
      });
    }
    await atTime(new Date(t0 + 72 * 60000 - 60000).toISOString(), async () => {
      const own = await signIn(env, TREVOR, "198.51.100.4");
      a.eq(own.valid, true, "one address locked the name: " + JSON.stringify(own));
    });
  });

  s.test("a coordinator's reset ends every phone's key", async (a) => {
    await atTime(SUN, async () => {
      const { env } = await fresh();
      const key = (await signIn(env, TREVOR)).key;
      const r = await W.actPinReset(env, {}, { name: "Bro Trevor" });
      a.ok(r.ok, JSON.stringify(r));
      await env.DB.batch(r.stmts);
      a.eq((await J(await trip(env, key))).error, "pin", "a key outlived the reset");
    });
  });

  s.test("the sheet asks the live server about a post sent straight to it", async (a) => {
    await atTime(SUN, () => {
      const L = sheet({ WORKER_URL: "https://example.invalid", SHEET_TOKEN: "s" });
      L.gas.setFetchReply({ code: 200, body: JSON.stringify({ ok: true, confirmed: false, allowed: false, sure: "" }) });
      const out = JSON.parse(call(L, "doPost", { postData: { contents: JSON.stringify({ token: "minibusapp", action: "trip", key: "",
        trip: { trip: "t1", route: "North", driver: "Bro Trevor", events: [] } }) } }).getContent());
      a.eq(out.error, "pin", "a run the live server refused was taken");
      a.eq(JSON.parse(L.gas.fetched[0].opts.payload).keyless, false);
      L.gas.setFetchReply({ code: 500, body: "down" });
      const v = call(L, "keyVerdict", "Bro Trevor", { key: "" });
      a.eq(v.allowed, true, "a run is lost while the live server is down");
      a.eq(v.confirmed, false);
      L.gas.setFetchReply({ code: 200, body: JSON.stringify({ ok: true, confirmed: false, allowed: true, sure: "old" }) });
      a.eq(call(L, "keyVerdict", "Bro Trevor", {}).sure, "old");
      a.eq(JSON.parse(L.gas.fetched[L.gas.fetched.length - 1].opts.payload).keyless, true);
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
    a.ok(/d\.status!=="Monitoring"/.test(app), "a defect the coordinator is watching is asked about");
    a.ok(/keyAsked===tried/.test(app), "a refused PIN is sent again on every timer");
    a.ok(/if\(out\.locked\) return;/.test(app), "a lock reads as a changed PIN");
  });

  return s;
}
