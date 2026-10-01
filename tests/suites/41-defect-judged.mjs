/* CRITICAL AND KIND FROM THE COORDINATOR'S APP. pages v1.91.0 · server
   w2.33.0 · sheet v1.96.0.

   - Update on a defect card sets Critical and Kind, for every report ticked.
   - The live server takes it, the coordinator's list and the driver app show
     it at once, and a change of Critical or Kind alone is a change.
   - The sheet writes the two cells and a History line for each.

   Everything here fails on w2.32.0 / v1.95.1. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab } from "../lib/tabs.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const THU = "2026-10-01T12:00:00+01:00";
const KEY = "2026-10-04", LAST = "2026-09-27", EARLIER = "2026-09-20";
const PIN = "1234";

export default async function (root) {
  const s = new Suite("Critical and Kind from the coordinator's app");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  async function fresh(defects) {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
      .bind("Bro Arthur", "Coordinator", "North", 1, await W.pinHashOf(env, "Bro Arthur", PIN)).run();
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    for (const d of defects) d.key = W.defectKeyOf(d);
    const openDefects = {};
    for (const d of defects) (openDefects[d.reg] = openDefects[d.reg] || []).push(
      { reg: d.reg, item: d.item, crit: d.crit, note: d.found, kind: d.kind, date: d.date, checkId: d.checkId, status: d.status });
    await W.cachePut(env, "coord_shelf", { builtAt: Date.now(), readAt: Date.now(), requests: [], defects }).run();
    await W.cachePut(env, "cache_rota", { builtAt: Date.now(), from: "2026-07-12", to: "2028-09-24",
      payload: { ok: true, rows: [], openDefects } }).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const coord = async (env, body) => J(await post(env, Object.assign({ action: "coord", who: "Bro Arthur", pin: PIN }, body)));
  let n = 0;
  const act = (env, a) => coord(env, { op: "act", act: Object.assign({ id: "judge-act-" + (++n) }, a) });

  /* The 20 September tyre: two reports, both called critical. */
  const TYRE = () => [
    { checkId: "chk-0", reg: "NH56 FWP", date: EARLIER, driver: "Bro Trevor", item: "Tyres", crit: true,
      found: "Sidewall scuff", status: "Open", action: "", kind: "Defect" },
    { checkId: "chk-1", reg: "NH56 FWP", date: LAST, driver: "Bro Adrian", item: "Tyres", crit: true,
      found: "Sidewall scuff", status: "Open", action: "", kind: "Defect" }];

  s.test("Critical and Kind alone are a change, for every report ticked", async (a) => {
    await atTime(THU, async () => {
      const defs = TYRE();
      const { db, env } = await fresh(defs);
      const keys = defs.map((d) => d.key);
      const out = await act(env, { kind: "defect", key: keys[0], keys, status: "Open", action: "", crit: "NO", type: "Advisory" });
      a.ok(out.ok, JSON.stringify(out));
      a.has(out.action.words, "not critical");
      a.has(out.action.words, "an advisory");
      const body = JSON.parse(db._one("SELECT body FROM coord_actions ORDER BY seq DESC LIMIT 1").body);
      a.eq(body.crit, "NO");
      a.eq(body.type, "Advisory");
      const view = await W.coordDefectsView(env);
      a.ok(view.every((d) => d.crit === false && d.kind === "Advisory"), "the coordinator's list: " + JSON.stringify(view));
      const pub = ((await W.cachedRota(env, KEY, 1)).openDefects || {})["NH56 FWP"] || [];
      a.eq(pub.length, 2);
      a.ok(pub.every((d) => d.crit === false && d.kind === "Advisory"), "the driver app: " + JSON.stringify(pub));
    });
  });

  s.test("the same Critical and Kind again is nothing to change, and a wrong word is refused", async (a) => {
    await atTime(THU, async () => {
      const defs = TYRE();
      const { env } = await fresh(defs);
      const same = await act(env, { kind: "defect", key: defs[0].key, status: "Open", action: "", crit: "YES", type: "Defect" });
      a.not(same.ok);
      a.has(String(same.error), "Nothing to change");
      const bad = await act(env, { kind: "defect", key: defs[0].key, status: "Open", action: "", crit: "yes please" });
      a.not(bad.ok);
    });
  });

  s.test("the sheet writes both cells and a History line for each, with no status line", async (a) => {
    await atTime(THU, async () => {
      const day = (y, m, d) => new Date(y, m - 1, d);
      const L = loadCodeGs(root, { tabs: {
        "Defects": tab("Defects", [
          { Received: day(2026, 9, 20), "Check ID": "chk-0", Date: day(2026, 9, 20), Registration: "NH56 FWP", Driver: "Bro Trevor",
            Item: "Tyres", Critical: "YES", "What the driver found": "Sidewall scuff", Status: "Open", Kind: "Defect" }]) },
        props: { PIN_SALT: "salt" } });
      const ss = L.gas.ss;
      const k = "chk-0|NH56 FWP|Tyres|2026-09-20";
      const out = call(L, "applyCoordAction", ss, { id: "j1", kind: "defect", sunday: "", by: "Bro Arthur", made: Date.now(),
        body: { key: k, keys: [k], reg: "NH56 FWP", item: "Tyres", status: "Open", action: "", crit: "NO", type: "Advisory" } }, {});
      a.ok(out.done && out.ok, JSON.stringify(out));
      const g = ss.getSheetByName("Defects").getDataRange().getValues();
      const row = {}; g[0].forEach((h, i) => { row[h] = g[1][i]; });
      a.eq(row.Critical, "NO");
      a.eq(row.Kind, "Advisory");
      a.eq(row.Status, "Open");
      const hg = ss.getSheetByName("History").getDataRange().getValues();
      const h = hg.slice(1).map((r) => { const o = {}; hg[0].forEach((x, i) => { o[x] = r[i]; }); return o; });
      a.eq(h.map((x) => x["What changed"]).sort().join(" | "), "Defect: Tyres — Critical | Defect: Tyres — Kind");
      a.eq(h.find((x) => /Critical$/.test(x["What changed"])).To, "NO");
      a.eq(h.find((x) => /Kind$/.test(x["What changed"])).From, "Defect");
    });
  });

  return s;
}
