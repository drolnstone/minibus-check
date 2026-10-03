/* THE DRIVERS TAB FROM THE COORDINATOR'S APP. pages v1.92.0 · server
   w2.34.0 · sheet v1.97.0.

   - A driver's Role, Route, Active, Primary order, Email and Phone are
     changed, and a driver is added, from the coordinator's app.
   - The drivers table has it at once, and keeps it through a push from the
     sheet until the sheet has filed it.
   - The sheet writes the cells and a History line for each. The PIN is never
     sent and never touched.

   Everything here fails on w2.33.0 / v1.96.0. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab, TABS } from "../lib/tabs.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const THU = "2026-10-01T12:00:00+01:00";
const KEY = "2026-10-04";
const PIN = "1234";

export default async function (root) {
  const s = new Suite("the Drivers tab from the coordinator's app");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  const REGISTER = [
    { name: "Bro Arthur", role: "Coordinator", active: true, order: 1, route: "North", email: "a@x.org", phone: "07700 900001", hasPin: true },
    { name: "Bro Trevor", role: "Driver", active: true, order: 2, route: "North", email: "", phone: "", hasPin: true }];

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await db.prepare("DELETE FROM drivers").run();
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
      .bind("Bro Arthur", "Coordinator", "North", 1, await W.pinHashOf(env, "Bro Arthur", PIN)).run();
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
      .bind("Bro Trevor", "Driver", "North", 2, "x").run();
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    await W.cachePut(env, "coord_shelf", { builtAt: Date.now(), readAt: Date.now(), requests: [], defects: [],
      drivers: REGISTER.map((d) => Object.assign({}, d)), driverRoles: ["Driver", "Coordinator", "Minister in Charge"] }).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const coord = async (env, body) => J(await post(env, Object.assign({ action: "coord", who: "Bro Arthur", pin: PIN }, body)));
  let n = 0;
  const act = (env, a) => coord(env, { op: "act", act: Object.assign({ id: "drv-act-" + (++n) }, a) });
  const row = (db, name) => db._one("SELECT * FROM drivers WHERE name=?", name);

  s.test("a driver changed: the drivers table at once, the register, and the words", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      const out = await act(env, { kind: "driver", name: "Bro Trevor",
        set: { route: "South", active: false, order: 3, email: "t@x.org", phone: "07700 900002" } });
      a.ok(out.ok, JSON.stringify(out));
      a.has(out.action.words, "South");
      a.has(out.action.words, "not active");
      const r = row(db, "Bro Trevor");
      a.eq(r.route, "South");
      a.eq(Number(r.active), 0);
      a.eq(Number(r.ord), 3);
      a.eq(r.pin_hash, "x", "the PIN was touched");
      const reg = (await coord(env, { op: "load" })).register;
      const t = reg.drivers.find((d) => d.name === "Bro Trevor");
      a.eq(t.email, "t@x.org");
      a.eq(t.phone, "07700 900002");
      a.ok(t.waiting);
      const body = JSON.parse(db._one("SELECT body FROM coord_actions ORDER BY seq DESC LIMIT 1").body);
      a.not("pin" in (body.set || {}), "a PIN went to the live server");
    });
  });

  s.test("a driver added, with no PIN; a name already there is refused", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      const out = await act(env, { kind: "driver", add: true, name: "Sis  Ama ", set: { route: "South", role: "Driver", order: 1 } });
      a.ok(out.ok, JSON.stringify(out));
      const r = row(db, "Sis Ama");
      a.ok(r, "not in the drivers table");
      a.eq(r.route, "South");
      a.eq(r.pin_hash, "");
      const again = await act(env, { kind: "driver", add: true, name: "bro trevor", set: { route: "North" } });
      a.not(again.ok);
      a.has(String(again.error), "already");
    });
  });

  s.test("nothing changed, a role off the list, a bad email: each refused", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      a.has(String((await act(env, { kind: "driver", name: "Bro Trevor", set: { route: "North", order: 2 } })).error), "Nothing to change");
      a.not((await act(env, { kind: "driver", name: "Bro Trevor", set: { role: "Bishop" } })).ok);
      a.not((await act(env, { kind: "driver", name: "Bro Trevor", set: { email: "not an email" } })).ok);
      a.not((await act(env, { kind: "driver", name: "Bro Nobody", set: { route: "South" } })).ok);
      const ok = await act(env, { kind: "driver", name: "Bro Trevor", set: { role: "minister in charge" } });
      a.ok(ok.ok, "a role in another case was refused");
    });
  });

  s.test("a push from the sheet before it has filed the change does not undo it", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      await act(env, { kind: "driver", name: "Bro Trevor", set: { route: "South" } });
      await act(env, { kind: "driver", add: true, name: "Sis Ama", set: { route: "South" } });
      /* What a push does: the table rewritten from the sheet. */
      await db.prepare("DELETE FROM drivers").run();
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES ('Bro Trevor','Driver','North',2,1,'x')").run();
      await W.reapplyDrivers(env);
      a.eq(row(db, "Bro Trevor").route, "South");
      a.ok(row(db, "Sis Ama"), "the new driver went with the push");
    });
  });

  s.test("the sheet writes the cells and a History line each, adds a row, and a phone is a default PIN", async (a) => {
    await atTime(THU, async () => {
      const L = loadCodeGs(root, { tabs: { "Drivers": tab("Drivers", [
        { Name: "Bro Trevor", Role: "Driver", Active: "YES", "Primary order": 2, Email: "", Route: "North", Phone: "07700 904321" }]) },
        props: { PIN_SALT: "salt" } });
      const ss = L.gas.ss;
      const A = (id, body) => ({ id, kind: "driver", sunday: "", by: "Bro Arthur", made: Date.now(), body });
      const r1 = call(L, "applyCoordAction", ss, A("d1", { name: "Bro Trevor", set: { route: "South", active: false, email: "t@x.org" } }), {});
      a.ok(r1.done && r1.ok, JSON.stringify(r1));
      const r2 = call(L, "applyCoordAction", ss, A("d2", { name: "Sis Ama", add: true, set: { route: "South", role: "Driver", active: true, order: 1 } }), {});
      a.ok(r2.done && r2.ok, JSON.stringify(r2));
      const g = ss.getSheetByName("Drivers").getDataRange().getValues();
      const objs = g.slice(1).map((r) => { const o = {}; g[0].forEach((h, i) => { o[h] = r[i]; }); return o; });
      const t = objs.find((x) => x.Name === "Bro Trevor"), m = objs.find((x) => x.Name === "Sis Ama");
      a.eq([t.Route, t.Active, t.Email, t.Phone].join("|"), "South|NO|t@x.org|07700 904321");
      a.ok(m, "no row for the new driver");
      const ORDER = TABS["Drivers"][TABS["Drivers"].indexOf("Primary order")];
      a.eq([m.Route, m.Active, m.Role, m[ORDER]].join("|"), "South|YES|Driver|1");
      const hg = ss.getSheetByName("History").getDataRange().getValues();
      const what = hg.slice(1).map((r) => r[hg[0].indexOf("What changed")]);
      a.ok(what.indexOf("Driver: Bro Trevor — Route") !== -1 && what.indexOf("Driver: Bro Trevor — Active") !== -1 &&
           what.indexOf("Driver added: Sis Ama") !== -1, what.join(" | "));
      const r3 = call(L, "applyCoordAction", ss, A("d3", { name: "sis ama", add: true, set: { route: "North" } }), {});
      a.not(r3.ok, "a second Sis Ama was added");
      const shelf = call(L, "coordDriversList", ss);
      a.ok(shelf.every((d) => !("pin" in d)), "a PIN in the shelf");
      /* A phone number is a default PIN; none, none. */
      a.eq(shelf.find((d) => d.name === "Bro Trevor").hasPin, true);
      a.eq(shelf.find((d) => d.name === "Sis Ama").hasPin, false);
    });
  });

  return s;
}
