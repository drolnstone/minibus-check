/* THE BUSES TAB FROM THE COORDINATOR'S APP. pages v1.93.0 · server
   w2.35.0 · sheet v1.98.0.

   - A bus's Seats, Active, Route in odd months and Notes are changed, and a
     bus is added, from the coordinator's app.
   - The live server has it at once, the seat counts and the rotation
     included, and keeps it through a push from the sheet until the sheet
     has filed it.
   - Taking a route in odd months from another bus gives that bus this one's
     old route, or standby, so two buses never share one.
   - The sheet writes the cells and a History line for each.

   Everything here fails on w2.34.0 / v1.97.0. */

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
  const s = new Suite("the Buses tab from the coordinator's app");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await db.prepare("DELETE FROM drivers").run();
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
      .bind("Bro Arthur", "Coordinator", "North", 1, await W.pinHashOf(env, "Bro Arthur", PIN)).run();
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    /* What a v1.98.0 sheet sends: YS70 PWE North in odd months, NH56 FWP South. */
    await W.cachePut(env, "bus_extra", {
      "YS70 PWE": { dates: {}, oddRoute: "North", notes: "Tail lift" },
      "NH56 FWP": { dates: {}, oddRoute: "South", notes: "" } }).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const coord = async (env, body) => J(await post(env, Object.assign({ action: "coord", who: "Bro Arthur", pin: PIN }, body)));
  let n = 0;
  const act = (env, a) => coord(env, { op: "act", act: Object.assign({ id: "bus-act-" + (++n) }, a) });
  const bus = async (env, reg) => (await W.getBuses(env)).find((b) => b.reg === reg);

  s.test("a bus changed: the live server has it at once, and the words", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "bus", reg: "nh56 fwp", set: { seats: 12, notes: "Rear door sticks" } });
      a.ok(out.ok, JSON.stringify(out));
      a.has(out.action.words, "12 seats");
      a.has(out.action.words, "notes changed");
      const b = await bus(env, "NH56 FWP");
      a.eq(b.seats, 12);
      a.eq(b.notes, "Rear door sticks");
      a.ok(b.waiting);
      const load = await coord(env, { op: "load" });
      a.ok(load.busEdits);
      const l = load.buses.find((x) => x.reg === "NH56 FWP");
      a.eq([l.seats, l.notes, l.oddRoute, l.waiting].join("|"), "12|Rear door sticks|South|true");
      a.eq(load.buses.find((x) => x.reg === "YS70 PWE").notes, "Tail lift");
    });
  });

  s.test("the seat count follows at once", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const before = await W.busFor(env, KEY, "South", await W.getBuses(env), await W.getRotaRow(env, KEY));
      await act(env, { kind: "bus", reg: "NH56 FWP", set: { seats: 9 } });
      const after = await W.busFor(env, KEY, "South", await W.getBuses(env), await W.getRotaRow(env, KEY));
      a.eq(before.seats, 14);
      a.eq(after.seats, 9);
    });
  });

  s.test("taking the other bus's route swaps the two; from standby, the other goes standby", async (a) => {
    await atTime(THU, async () => {
      const { env, db } = await fresh();
      const out = await act(env, { kind: "bus", reg: "NH56 FWP", set: { oddRoute: "North" } });
      a.ok(out.ok, JSON.stringify(out));
      a.has(out.action.words, "YS70 PWE: South in odd months");
      a.eq((await bus(env, "NH56 FWP")).oddRoute, "North");
      a.eq((await bus(env, "YS70 PWE")).oddRoute, "South");
      const body = JSON.parse(db._one("SELECT body FROM coord_actions ORDER BY seq DESC LIMIT 1").body);
      a.eq(JSON.stringify(body.also), JSON.stringify([{ reg: "YS70 PWE", oddRoute: "South" }]));

      const add = await act(env, { kind: "bus", add: true, reg: "ab12 cde", set: { seats: 16, oddRoute: "South" } });
      a.ok(add.ok, JSON.stringify(add));
      a.has(add.action.words, "AB12 CDE added: 16 seats, South in odd months.");
      a.has(add.action.words, "YS70 PWE: standby.");
      const nb = await bus(env, "AB12 CDE");
      a.ok(nb && nb.active && nb.seats === 16 && nb.oddRoute === "South", JSON.stringify(nb));
      a.eq((await bus(env, "YS70 PWE")).oddRoute, "");
      /* October is even: South takes the odd-month North bus. */
      const r = await W.busFor(env, KEY, "South", await W.getBuses(env), null);
      a.eq(r.reg, "NH56 FWP");
    });
  });

  s.test("a bus already there, nothing changed, bad seats, an unknown bus: each refused", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      a.has(String((await act(env, { kind: "bus", add: true, reg: "YS70PWE", set: { seats: 16 } })).error), "already");
      a.has(String((await act(env, { kind: "bus", reg: "NH56 FWP", set: { seats: 14, oddRoute: "South" } })).error), "Nothing to change");
      a.not((await act(env, { kind: "bus", reg: "NH56 FWP", set: { seats: 0 } })).ok);
      a.not((await act(env, { kind: "bus", reg: "NH56 FWP", set: { seats: 2.5 } })).ok);
      a.not((await act(env, { kind: "bus", reg: "NH56 FWP", set: { oddRoute: "East" } })).ok);
      a.not((await act(env, { kind: "bus", reg: "ZZ99 ZZZ", set: { seats: 10 } })).ok);
      a.not((await act(env, { kind: "bus", add: true, reg: "AB12 CDE", set: {} })).ok, "a bus with no seats was added");
      a.not((await act(env, { kind: "bus", add: true, reg: "=SUM(A1)", set: { seats: 10 } })).ok);
    });
  });

  s.test("a push from the sheet before it has filed the change does not undo it", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      await act(env, { kind: "bus", reg: "NH56 FWP", set: { active: false } });
      await act(env, { kind: "bus", add: true, reg: "AB12 CDE", set: { seats: 16 } });
      /* What a push does: the table rewritten from the sheet. */
      await db.prepare("DELETE FROM buses").run();
      await db.prepare("INSERT INTO buses (reg, seats, active) VALUES ('NH56 FWP',14,1), ('YS70 PWE',16,1)").run();
      a.eq((await bus(env, "NH56 FWP")).active, false);
      a.ok(await bus(env, "AB12 CDE"), "the new bus went with the push");
      /* And once the sheet names them as filed, the tab's own copy stands. */
      await db.prepare("UPDATE coord_actions SET seen=1").run();
      a.eq((await bus(env, "NH56 FWP")).active, true);
      a.eq((await bus(env, "AB12 CDE")), undefined);
    });
  });

  s.test("an older sheet sends no notes: they are not offered, and not wiped", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      await W.cachePut(env, "bus_extra", { "NH56 FWP": { dates: {}, oddRoute: "South" } }).run();
      const l = (await coord(env, { op: "load" })).buses.find((x) => x.reg === "NH56 FWP");
      a.eq(l.noNotes, true);
    });
  });

  s.test("the sheet writes the cells and a History line each, adds a row, and moves the other bus", async (a) => {
    await atTime(THU, async () => {
      const L = loadCodeGs(root, { tabs: { "Buses": tab("Buses", [
        { Registration: "YS70 PWE", "Seats for passengers": 16, Active: "YES", Notes: "Tail lift", "Route in odd months": "North" },
        { Registration: "NH56 FWP", "Seats for passengers": 14, Active: "YES", Notes: "", "Route in odd months": "South" }]) },
        props: {} });
      const ss = L.gas.ss;
      const A = (id, body) => ({ id, kind: "bus", sunday: "", by: "Bro Arthur", made: Date.now(), body });
      const r1 = call(L, "applyCoordAction", ss, A("b1", { reg: "NH56 FWP", set: { seats: 12, oddRoute: "North", notes: "-Rear door" },
        also: [{ reg: "YS70 PWE", oddRoute: "South" }] }), {});
      a.ok(r1.done && r1.ok, JSON.stringify(r1));
      const r2 = call(L, "applyCoordAction", ss, A("b2", { reg: "ab12 cde", add: true, set: { seats: 16, active: true, oddRoute: "" } }), {});
      a.ok(r2.done && r2.ok, JSON.stringify(r2));
      const g = ss.getSheetByName("Buses").getDataRange().getValues();
      const objs = g.slice(1).map((r) => { const o = {}; g[0].forEach((h, i) => { o[h] = r[i]; }); return o; });
      const SEATS = TABS["Buses"][TABS["Buses"].indexOf("Seats for passengers")];
      const ODD = TABS["Buses"][TABS["Buses"].indexOf("Route in odd months")];
      const nh = objs.find((x) => x.Registration === "NH56 FWP"), ys = objs.find((x) => x.Registration === "YS70 PWE"),
            nb = objs.find((x) => x.Registration === "AB12 CDE");
      a.eq([nh[SEATS], nh[ODD], nh.Notes].join("|"), "12|North|'-Rear door");
      a.eq([ys[ODD], ys.Notes].join("|"), "South|Tail lift");
      a.ok(nb, "no row for the new bus");
      a.eq([nb[SEATS], nb.Active, nb[ODD]].join("|"), "16|YES|");
      const hg = ss.getSheetByName("History").getDataRange().getValues();
      const what = hg.slice(1).map((r) => r[hg[0].indexOf("What changed")]);
      a.ok(what.indexOf("Bus: NH56 FWP — Seats for passengers") !== -1 && what.indexOf("Bus: YS70 PWE — Route in odd months") !== -1 &&
           what.indexOf("Bus added: AB12 CDE") !== -1, what.join(" | "));
      const r3 = call(L, "applyCoordAction", ss, A("b3", { reg: "AB12CDE", add: true, set: { seats: 10 } }), {});
      a.not(r3.ok, "a second AB12 CDE was added");
      const shelf = call(L, "readBusesFresh", ss);
      a.eq(shelf.find((b) => b.reg === "NH56 FWP").seats, 12);
    });
  });

  return s;
}
