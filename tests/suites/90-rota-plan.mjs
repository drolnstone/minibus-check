/* PLAN THE ROTA. 19 November 2026. pages v1.179.0 · server w2.100.0 ·
   sheet v1.146.0.

   Asim: Bro Adesina stands down, Bro Adebola drives every other Sunday on
   alternate runs, and it will change again. So the Coordinator App holds a
   list of names for each route, repeated from a first Sunday, with any Sunday
   swapped by hand on top. One Save writes every Sunday that changes; a
   covered, asked-about, called-off or PROTECTED Sunday is left as it is. The
   sheet keeps the plan for the Sundays it adds and rebuilds. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab, TABS } from "../lib/tabs.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const THU = "2026-11-19T22:00:00Z";
const PIN = "1234";
const SUNS = ["2026-11-22", "2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27", "2027-01-03", "2027-01-10"];
const OLD_S = ["Bro Adesina", "Bro Tunde", "Pst Obamakinwa"];
const OLD_N = ["Bro Adebola", "Bro Abiodun", "Bro Moses", "Bro Asim"];

export default async function (root) {
  const s = new Suite("plan the rota");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());
  const PEOPLE = [["Bro Asim", "Coordinator", "North"], ["Bro Adebola", "Driver", "North"], ["Bro Abiodun", "Driver", "North"],
                  ["Bro Moses", "Driver", "North"], ["Bro Tunde", "Driver", "South"], ["Pst Obamakinwa", "Driver", "South"],
                  ["Bro Adesina", "Driver", "South"]];

  async function fresh(over) {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, SUNS[0]);
    await db.prepare("DELETE FROM drivers").run();
    for (const d of PEOPLE) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,?,?)")
        .bind(d[0], d[1], d[2], d[0] === "Bro Adesina" ? 0 : 1, await W.pinHashOf(env, d[0], PIN)).run();
    }
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    const rows = SUNS.map((k, i) => Object.assign({ date: k, primary: OLD_N[i % 4], actual: OLD_N[i % 4], status: "Confirmed",
      primary2: OLD_S[i % 3], actual2: "", notes: "", northBus: "YS70 PWE", southBus: "NH56 FWP", requests: [] }, (over || {})[k] || {}));
    for (const r of rows) {
      await db.prepare("INSERT OR REPLACE INTO rota (sunday, north, north_cover, north_bus, south, south_cover, south_bus, status, notes) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(r.date, r.primary, r.actual !== r.primary ? r.actual : "", "YS70 PWE", r.primary2, r.actual2, "NH56 FWP", r.status, r.notes).run();
    }
    await W.cachePut(env, "cache_rota", { builtAt: Date.now() - 60000, from: "2026-07-12", to: "2028-09-24",
      payload: { ok: true, rows: rows } }).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  let n = 0;
  const act = async (env, a) => J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN, op: "act",
    act: Object.assign({ id: "plan-act-" + (++n), kind: "rotaplan" }, a) }));
  const SOUTH = ["Bro Tunde", "Bro Adebola", "Pst Obamakinwa", "Bro Tunde", "Pst Obamakinwa", "Bro Adebola", "Pst Obamakinwa", "Bro Tunde"];
  const NORTH = ["Bro Abiodun", "Bro Moses", "Bro Asim", "Bro Adebola"];

  s.test("saved from Sun 29 Nov: every phone has the new names at once; the covered Sunday before stays", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh({ "2026-11-22": { actual2: "Pst Kehinde", status: "Covered" } });
      const out = await act(env, { start: "2026-11-29", north: NORTH, south: SOUTH });
      a.ok(out.ok, JSON.stringify(out));
      a.has(out.action.words, "Rota from Sun 29 Nov: ");
      const r = (await W.cachedRota(env, "2026-11-22", 10)).rows;
      a.eq(r[0].primary2, "Bro Adesina");
      a.eq(r.slice(1).map((x) => x.primary2).join(","), SOUTH.slice(0, 7).join(","));
      a.eq(r.slice(1).map((x) => x.primary).join(","), NORTH.concat(NORTH).slice(0, 7).join(","));
      a.eq((await W.getRotaRow(env, "2026-12-06")).south, "Bro Adebola");
      const plan = await W.cacheGet(env, "rota_plan");
      a.eq(plan.start, "2026-11-29");
      a.eq(plan.south.length, 8);
      const body = JSON.parse(db._one("SELECT body FROM coord_actions ORDER BY seq DESC LIMIT 1").body);
      a.ok(body.changes.every((c) => c.sunday >= "2026-11-29"), JSON.stringify(body.changes));
    });
  });

  s.test("a Sunday with a request or PROTECTED is kept; a clash or a driver not active is refused", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh({ "2026-12-06": { status: "Change requested" }, "2026-12-13": { notes: "PROTECTED: carol service" } });
      const out = await act(env, { start: "2026-11-29", north: NORTH, south: SOUTH });
      a.ok(out.ok, JSON.stringify(out));
      const r = (await W.cachedRota(env, "2026-12-06", 2)).rows;
      a.eq(r[0].primary2, "Pst Obamakinwa");
      a.eq(r[1].primary2, "Bro Adesina");
      a.has(String((await act(env, { start: "2026-11-29", north: ["Bro Tunde"], south: ["Bro Tunde"] })).error), "on both routes on Sun 29 Nov");
      a.has(String((await act(env, { start: "2026-11-29", north: NORTH, south: ["Bro Adesina"] })).error), "not an active driver");
      a.has(String((await act(env, { start: "2026-11-29", north: NORTH, south: [] })).error), "Add a driver to South");
    });
  });

  s.test("a swap by hand stands over the list", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { start: "2026-11-29", north: NORTH, south: SOUTH,
        over: { "2026-11-29": { South: "Pst Obamakinwa" }, "2026-12-27": { South: "Bro Tunde" } } });
      a.ok(out.ok, JSON.stringify(out));
      const r = (await W.cachedRota(env, "2026-11-29", 5)).rows;
      a.eq(r[0].primary2, "Pst Obamakinwa");
      a.eq(r[4].primary2, "Bro Tunde");
      a.has(String((await act(env, { id: "again-1", start: "2026-11-29", north: NORTH, south: SOUTH,
        over: { "2026-11-29": { South: "Pst Obamakinwa" }, "2026-12-27": { South: "Bro Tunde" } } })).error), "Nothing to change");
    });
  });

  s.test("the sheet writes the Sundays, keeps the plan, and adds later Sundays from it", async (a) => {
    await atTime(THU, async () => {
      const rows = SUNS.slice(0, 3).map((k, i) => ({ Sunday: new Date(k + "T00:00:00Z"), "North Liverpool scheduled": OLD_N[i],
        Status: "Confirmed", "South Liverpool scheduled": OLD_S[i] }));
      rows[0]["South Liverpool actual / cover"] = "Pst Kehinde"; rows[0].Status = "Covered";
      const L = loadCodeGs(root, { tabs: {
        "Rota": tab("Rota", rows),
        "Drivers": tab("Drivers", PEOPLE.map((d, i) => ({ Name: d[0], Role: d[1], Active: d[0] === "Bro Adesina" ? "NO" : "YES",
                                                       Route: d[2], "Primary order": i + 1 }))) }, props: {} });
      const ss = L.gas.ss;
      const plan = { start: "2026-11-29", north: NORTH, south: SOUTH, over: {} };
      const res = call(L, "applyCoordAction", ss, { id: "p1", kind: "rotaplan", sunday: "2026-11-29", by: "Bro Asim", made: Date.now(),
        body: { sunday: "2026-11-29", plan: plan, changes: [
          { sunday: "2026-11-22", set: { south: "Bro Tunde" } },
          { sunday: "2026-11-29", set: { north: "Bro Abiodun", south: "Bro Tunde" } },
          { sunday: "2026-12-06", set: { north: "Bro Moses", south: "Bro Adebola" } }] } }, {});
      a.ok(res.done && res.ok, JSON.stringify(res));
      a.has(res.result, "left as they were");
      const sh = ss.getSheetByName("Rota");
      const col = (h) => TABS["Rota"].indexOf(h) + 1;
      a.eq(String(sh.getRange(2, col("South Liverpool scheduled")).getValue()), "Bro Adesina");
      a.eq(String(sh.getRange(4, col("South Liverpool scheduled")).getValue()), "Bro Adebola");
      a.has(String(sh.getRange(4, col("Updated by")).getValue()), "(rota plan)");
      const d = (k) => new Date(k + "T12:00:00Z");
      const P = call(L, "bothPatterns", ss);
      a.eq(call(L, "southDriver", d("2026-12-20"), P.south), "Bro Tunde");
      a.eq(call(L, "southDriver", d("2027-01-03"), P.south), "Bro Adebola");
      a.eq(call(L, "patternDriver", d("2027-01-03"), P.north), "Bro Moses");
      a.eq(call(L, "patternDriver", d("2026-11-22"), P.north), call(L, "patternDriver", d("2026-11-22"), P.north.slice()));
    });
  });

  return s;
}
