/* A DRIVER'S OWN PIN, copied from the Ushers app. pages v1.96.0 · server
   w2.39.0 · sheet v1.103.0.

   - The default PIN is the last four digits of the Phone on the Drivers tab.
     There is no PIN column; the sheet sends only the default's salted hash.
   - Right after the default the sign-in answer asks once whether to keep it.
   - A driver changes his own PIN: current PIN first, four digits, never the
     one he has, never his default. Kept on the live server only, and it
     outlives a push of the Drivers tab.
   - The coordinator's Reset PIN puts him back on the default, asked again,
     lockout cleared.
   - Each change, keep and reset is a History line, never the PIN.

   Everything here fails on w2.38.0 / v1.102.0. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { TABS } from "../lib/tabs.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const THU = "2026-10-01T12:00:00+01:00";
const KEY = "2026-10-04";
/* Bro Arthur's phone ends 0001, Bro Trevor's 4321, Sis Ama has none. */
const ARTHUR = "0001", TREVOR = "4321";

export default async function (root) {
  const s = new Suite("a driver's own PIN, and the default from the phone");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await db.prepare("DELETE FROM drivers").run();
    for (const [name, role, pin] of [["Bro Arthur", "Coordinator", ARTHUR], ["Bro Trevor", "Driver", TREVOR], ["Sis Ama", "Driver", ""]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind(name, role, "North", pin ? await W.pinHashOf(env, name, pin) : "").run();
    }
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const signIn = async (env, driver, pin) => J(await post(env, { action: "pin", pin: { driver, pin } }));
  const change = async (env, driver, pin, newPin) => J(await post(env, { action: "pinchange", pin: { driver, pin, newPin } }));
  const keep = async (env, driver, pin) => J(await post(env, { action: "pinkeep", pin: { driver, pin } }));
  let n = 0;
  const reset = async (env, name, pin) => J(await post(env, { action: "coord", who: "Bro Arthur", pin: pin || ARTHUR,
    op: "act", act: { id: "pin-act-" + (++n), kind: "pin", name } }));
  const pinRows = (db) => db._rows("SELECT * FROM coord_actions WHERE kind='pin' ORDER BY seq");

  s.test("the default PIN signs in, and asks once whether to keep it", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const ok = await signIn(env, "Bro Trevor", TREVOR);
      a.eq(ok.valid, true, JSON.stringify(ok));
      a.eq(ok.askPinChange, true, "not asked about the default");
      const bad = await signIn(env, "Bro Trevor", "9999");
      a.eq(bad.valid, false);
      a.eq(bad.askPinChange, undefined, "a wrong PIN was told anything more");
      const none = await signIn(env, "Sis Ama", "");
      a.eq(none.noPin, true, "no phone and no PIN of her own: not asked");
    });
  });

  s.test("kept: not asked again, and a History line with no PIN in it", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      a.eq((await keep(env, "Bro Trevor", "9999")).valid, false, "kept on a wrong PIN");
      const k = await keep(env, "Bro Trevor", TREVOR);
      a.eq(k.kept, true, JSON.stringify(k));
      a.eq((await signIn(env, "Bro Trevor", TREVOR)).askPinChange, false);
      const rows = pinRows(db);
      a.eq(rows.length, 1);
      a.eq(JSON.parse(rows[0].body).what, "kept");
      a.eq(rows[0].by_name, "Bro Trevor");
      a.not(rows[0].body.indexOf(TREVOR) !== -1, "the PIN went on the record");
    });
  });

  s.test("a change needs the current PIN, four digits, and a PIN he does not have", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      const wrong = await change(env, "Bro Trevor", "9999", "2580");
      a.eq(wrong.valid, false);
      a.eq(wrong.left, 2);
      a.eq((await change(env, "Bro Trevor", TREVOR, "25")).error, "pin shape");
      a.eq((await change(env, "Bro Trevor", TREVOR, "25801")).error, "pin shape");
      a.eq((await change(env, "Bro Trevor", TREVOR, TREVOR)).error, "same pin");
      const none = await change(env, "Sis Ama", "", "2580");
      a.eq(none.error, "no pin", "a PIN set with nothing to prove who she is");
      a.eq(db._rows("SELECT * FROM driver_pins").filter((r) => r.pin_hash).length, 0, "something was set");
    });
  });

  s.test("changed: the new PIN works, the default no longer does, and it is never stored plain", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      const out = await change(env, "Bro Trevor", TREVOR, "2580");
      a.eq(out.changed, true, JSON.stringify(out));
      const now = await signIn(env, "Bro Trevor", "2580");
      a.eq(now.valid, true);
      a.eq(now.askPinChange, false, "asked about a default he no longer has");
      a.eq((await signIn(env, "Bro Trevor", TREVOR)).valid, false, "the default still works");
      const r = db._one("SELECT * FROM driver_pins WHERE name='bro trevor'");
      a.ok(/^[0-9a-f]{64}$/.test(r.pin_hash), "not a hash");
      a.ok(/^[0-9a-f]{32}$/.test(r.pin_salt), "no salt of its own");
      a.eq(JSON.stringify(r).indexOf("2580"), -1, "the PIN is stored");
      a.eq((await change(env, "Bro Trevor", "2580", TREVOR)).error, "same pin", "back onto the default by hand");
      const rows = pinRows(db);
      a.eq(JSON.parse(rows[rows.length - 1].body).what, "changed");
      a.eq(rows.map((x) => x.body + x.words).join("").indexOf("2580"), -1, "the PIN went on the record");
    });
  });

  s.test("his own PIN outlives a push of the Drivers tab, and opens every gate", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      await change(env, "Bro Arthur", ARTHUR, "7531");
      /* What a push does: the table rewritten from the sheet. */
      await db.prepare("DELETE FROM drivers").run();
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind("Bro Arthur", "Coordinator", "North", await W.pinHashOf(env, "Bro Arthur", ARTHUR)).run();
      a.eq((await signIn(env, "Bro Arthur", "7531")).valid, true);
      const load = await J(await post(env, { action: "coord", who: "Bro Arthur", pin: "7531", op: "load" }));
      a.ok(load.ok !== false && !load.error, "the coordinator's app: " + JSON.stringify(load).slice(0, 120));
      const old = await J(await post(env, { action: "coord", who: "Bro Arthur", pin: ARTHUR, op: "load" }));
      a.eq(old.error, "bad pin", "the coordinator's app took the default");
    });
  });

  s.test("reset: back on the default, asked again, the lockout gone", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      await change(env, "Bro Trevor", TREVOR, "2580");
      for (let i = 0; i < 3; i++) await signIn(env, "Bro Trevor", "0000");
      a.eq((await signIn(env, "Bro Trevor", "2580")).locked, true, "three wrong did not lock it");
      const r = await reset(env, "Bro Trevor");
      a.ok(r.ok, JSON.stringify(r));
      a.has(r.action.words, "default");
      const back = await signIn(env, "Bro Trevor", TREVOR);
      a.eq(back.valid, true, "the default does not work after a reset");
      a.eq(back.askPinChange, true, "not asked again after a reset");
      a.eq((await signIn(env, "Bro Trevor", "2580")).valid, false, "his own PIN survived the reset");
      a.eq(JSON.parse(pinRows(db).pop().body).what, "reset");
      const none = await reset(env, "Sis Ama");
      a.not(none.ok, "reset to a default she does not have");
      a.has(String(none.error), "phone number");
    });
  });

  s.test("the register counts his own PIN, phone number or not", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      await W.cachePut(env, "coord_shelf", { builtAt: Date.now(), readAt: Date.now(), requests: [], defects: [],
        drivers: [{ name: "Sis Ama", role: "Driver", active: true, order: 1, route: "North", email: "", phone: "", hasPin: false }],
        driverRoles: ["Driver", "Coordinator"] }).run();
      const before = await J(await post(env, { action: "coord", who: "Bro Arthur", pin: ARTHUR, op: "load" }));
      a.eq(before.register.drivers.find((d) => d.name === "Sis Ama").hasPin, false);
      /* Set for her as the live server would have, before her phone was taken off. */
      await env.DB.prepare("INSERT INTO driver_pins (name, pin_salt, pin_hash, pin_iter, set_at) VALUES ('sis ama','00','ab',1,0)").run();
      const after = await J(await post(env, { action: "coord", who: "Bro Arthur", pin: ARTHUR, op: "load" }));
      a.eq(after.register.drivers.find((d) => d.name === "Sis Ama").hasPin, true);
    });
  });

  /* ---- the sheet -------------------------------------------------------- */

  /* The tab as it is once the PIN column has been deleted. */
  const NOPIN = TABS["Drivers"].filter((h) => h !== "PIN");
  const drv = (o) => NOPIN.map((h) => (h in o ? o[h] : ""));
  const sheet = () => loadCodeGs(root, { tabs: { "Drivers": [NOPIN,
    drv({ Name: "Bro Trevor", Role: "Driver", Active: "YES", Route: "North", Phone: "07700 904321" }),
    drv({ Name: "Sis Ama", Role: "Driver", Active: "YES", Route: "South", Phone: "" }),
    drv({ Name: "Bro Dele", Role: "Driver", Active: "YES", Route: "South", Phone: 7700901234 })] },
    props: { PIN_SALT: "test-pin-salt" } });

  s.test("the default is the phone's last four digits, with no PIN column on the tab", (a) => {
    const L = sheet();
    const ds = call(L, "readDrivers", L.ctx.SpreadsheetApp.getActive());
    a.eq(ds.map((d) => d.name + ":" + d.pin).join(","), "Bro Trevor:4321,Sis Ama:,Bro Dele:1234");
    a.eq(call(L, "phoneDefaultPin", "+44 (0)7700 900-123"), "0123");
    a.eq(call(L, "phoneDefaultPin", "123"), "");
    /* What the push sends is the default's hash. */
    a.eq(call(L, "pinHashLive", ds[0].name, ds[0].pin), call(L, "pinHashLive", "Bro Trevor", "4321"));
    a.eq(call(L, "pinHashLive", ds[1].name, ds[1].pin), "", "no phone, no default: nothing pushed");
    a.eq(call(L, "driversHeaderWarning", L.ctx.SpreadsheetApp.getActive()), "", "asks for the PIN column back");
  });

  s.test("the sheet never answers a PIN, and files each change on History", (a) => {
    const L = sheet();
    const out = JSON.parse(call(L, "handlePinCheck", { driver: "Bro Trevor", pin: "4321" }).getContent());
    a.eq(out.ok, false, "the sheet still answers a PIN it cannot know");
    const ss = L.gas.ss;
    const A = (id, by, body) => ({ id, kind: "pin", sunday: "", by, made: Date.now(), body });
    for (const [id, by, what] of [["p1", "Bro Trevor", "changed"], ["p2", "Sis Ama", "kept"], ["p3", "Bro Arthur", "reset"]]) {
      const r = call(L, "applyCoordAction", ss, A(id, by, { name: by === "Bro Arthur" ? "Bro Trevor" : by, what }), {});
      a.ok(r.done && r.ok, JSON.stringify(r));
    }
    const hg = ss.getSheetByName("History").getDataRange().getValues();
    const col = (h) => hg[0].indexOf(h);
    const lines = hg.slice(1).map((r) => [r[col("Who")], r[col("What changed")], r[col("To")], r[col("Why")]].join("|"));
    a.eq(lines.join(" / "),
      "Bro Trevor|PIN changed|Own PIN| / Sis Ama|Default PIN kept|Default PIN| / Bro Arthur|PIN reset|Default PIN|Bro Trevor");
  });

  return s;
}
