/* BUS DATES AND THE MONTHLY PAIRING LIVE ON THE BUSES TAB.

   Before v1.87.0 / w2.24.0 / app v1.85.0 the MOT, service, insurance and
   permit dates were in config.js and which bus takes North in odd months was
   a constant in both Code.gs and the Worker: a renewal meant a code change
   and three deploys. Now they are five columns on the Buses tab, filled once
   from what the code used to say, and carried to phones by the sync. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { TABS } from "../lib/tabs.mjs";

export default async function (root) {
  const s = new Suite("bus dates and the monthly pairing come from the Buses tab");
  const G = installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  /* ---- the sheet -------------------------------------------------------- */

  /* The tab as it was before v1.87.0: its first four columns. */
  const oldTab = () => [TABS["Buses"].slice(0, 4),
                        ["YS70 PWE", 16, "YES", ""], ["NH56 FWP", 14, "YES", ""]];
  /* Code.gs ships the seeds and the fallback pairing empty from v1.88.0. The
     one-time fill is tested with the values this church's v1.87.0 shipped,
     put back in after loading; the empty ones are tested at the end. */
  const SEEDS = {
    BUS_ROTATION_ODD: { north: "NH56 FWP", south: "YS70 PWE" },
    BUS_DATES_SEED: {
      "YS70 PWE": { mot: "2027-06-17", service: "2027-06-17", insurance: "2027-06-26", permit: "2027-01-31" },
      "NH56 FWP": { mot: "2027-04-28", service: "2027-07-01", insurance: "2027-07-08", permit: "2027-01-31" } }
  };
  const load = (buses, bare) => {
    const L = loadCodeGs(root, { tabs: { "Buses": buses }, props: { PIN_SALT: "salt" } });
    if (!bare) Object.assign(L.ctx, JSON.parse(JSON.stringify(SEEDS)));
    return L;
  };
  const ss = (L) => L.ctx.SpreadsheetApp.getActiveSpreadsheet();
  const cells = (L) => ss(L).getSheetByName("Buses").getDataRange().getValues();

  s.test("an old four-column Buses tab gains the five columns, filled from what the code said", (a) => {
    const L = load(oldTab());
    call(L, "ensureBuses", ss(L));
    const v = cells(L), h = v[0];
    for (const c of TABS["Buses"].slice(4))
      a.ok(h.includes(c), "no " + c + " column");
    const col = (n) => h.indexOf(n);
    const ys = v.find((r) => r[0] === "YS70 PWE"), nh = v.find((r) => r[0] === "NH56 FWP");
    a.eq(ys[col("Route in odd months")], "South");
    a.eq(nh[col("Route in odd months")], "North");
    a.eq(call(L, "isoDay", ys[col("MOT due")]), "2027-06-17");
    a.eq(call(L, "isoDay", nh[col("Insurance due")]), "2027-07-08");
  });

  s.test("and only once: a coordinator's edit survives the next Set up", (a) => {
    const L = load(oldTab());
    call(L, "ensureBuses", ss(L));
    const sh = ss(L).getSheetByName("Buses");
    const h = sh.getDataRange().getValues()[0];
    sh.getRange(2, h.indexOf("MOT due") + 1).setValue("");
    sh.getRange(2, h.indexOf("Route in odd months") + 1).setValue("North");
    call(L, "memoDrop", "buses");
    call(L, "ensureBuses", ss(L));
    const v = sh.getDataRange().getValues();
    a.eq(v[1][h.indexOf("MOT due")], "");
    a.eq(v[1][h.indexOf("Route in odd months")], "North");
  });

  s.test("isoDay reads a date, yyyy-m-d and d/m/yyyy, and nothing else", (a) => {
    const L = load(oldTab());
    a.eq(call(L, "isoDay", new Date(2027, 0, 5)), "2027-01-05");
    a.eq(call(L, "isoDay", "2027-1-5"), "2027-01-05");
    a.eq(call(L, "isoDay", "5/1/2027"), "2027-01-05");
    a.eq(call(L, "isoDay", "soon"), "");
    a.eq(call(L, "isoDay", ""), "");
  });

  const swapped = () => {
    const L = load(oldTab());
    call(L, "ensureBuses", ss(L));
    const sh = ss(L).getSheetByName("Buses");
    const c = sh.getDataRange().getValues()[0].indexOf("Route in odd months") + 1;
    sh.getRange(2, c).setValue("North"); sh.getRange(3, c).setValue("South");
    call(L, "memoDrop", "buses");
    return L;
  };

  s.test("the rotation follows the tab: swap North and South and odd months swap", (a) => {
    const L = swapped();
    const odd = call(L, "busRule", "2026-11-01"), even = call(L, "busRule", "2026-10-04");
    a.eq(odd.North, "YS70 PWE"); a.eq(odd.South, "NH56 FWP");
    a.eq(even.North, "NH56 FWP"); a.eq(even.South, "YS70 PWE");
  });

  s.test("with only one route marked, the pairing falls back to the code's rather than guess", (a) => {
    const L = load(oldTab());
    call(L, "ensureBuses", ss(L));
    const sh = ss(L).getSheetByName("Buses");
    sh.getRange(2, sh.getDataRange().getValues()[0].indexOf("Route in odd months") + 1).setValue("");
    call(L, "memoDrop", "buses");
    const p = call(L, "busPairing");
    a.eq(p.north, "NH56 FWP"); a.eq(p.south, "YS70 PWE");
  });

  s.test("the sync carries each bus's dates and route to the live server", (a) => {
    const L = swapped();
    const b = call(L, "readBuses", ss(L)).find((x) => x.reg === "YS70 PWE");
    a.eq(b.dates.mot, "2027-06-17");
    a.eq(b.oddRoute, "North");
    a.has(readFileSync(join(root, "Code.gs"), "utf8"), "oddRoute: b.oddRoute");
  });

  /* ---- the live server -------------------------------------------------- */

  const fresh = () => { G.reset(); return makeEnv(makeDB(join(root, "server", "schema.sql"))); };
  const sync = (env, buses) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify({ token: "minibusapp", action: "sync", buses }) }), env, {});

  s.test("the live server keeps each bus's dates and route, and hands them back", async (a) => {
    const env = fresh();
    a.ok((await J(await sync(env, [
      { reg: "YS70 PWE", seats: 16, active: true, dates: { mot: "2027-06-17", service: "nonsense" }, oddRoute: "North" },
      { reg: "NH56 FWP", seats: 14, active: true, dates: {}, oddRoute: "South" }]))).ok);
    const buses = await W.getBuses(env);
    const ys = buses.find((b) => b.reg === "YS70 PWE");
    a.eq(ys.dates.mot, "2027-06-17");
    a.eq(ys.dates.service, "", "a date that is not a date is dropped");
    a.eq(ys.oddRoute, "North");
  });

  s.test("and the rotation follows them", async (a) => {
    const env = fresh();
    await sync(env, [{ reg: "YS70 PWE", seats: 16, active: true, oddRoute: "North" },
                     { reg: "NH56 FWP", seats: 14, active: true, oddRoute: "South" }]);
    const buses = await W.getBuses(env);
    a.eq(W.busRule("2026-11-01", buses).North, "YS70 PWE");
    a.eq(W.busRule("2026-10-04", buses).North, "NH56 FWP");
  });

  s.test("an inactive bus, or no pairing at all, names no bus rather than guess", async (a) => {
    a.eq(W.busRule("2026-11-01").North, "");
    a.eq(W.busRule("2026-11-01", [{ reg: "YS70 PWE", active: false, oddRoute: "North" },
                                  { reg: "NH56 FWP", active: true, oddRoute: "South" }]).North, "");
  });

  s.test("a sync from an older sheet, with no dates, keeps the last ones", async (a) => {
    const env = fresh();
    await sync(env, [{ reg: "YS70 PWE", seats: 16, active: true, dates: { mot: "2027-06-17" }, oddRoute: "North" }]);
    await sync(env, [{ reg: "YS70 PWE", seats: 16, active: true }]);
    a.eq((await W.getBuses(env))[0].dates.mot, "2027-06-17");
  });

  /* ---- the driver app --------------------------------------------------- */

  s.test("config.js no longer carries renewal dates, and the app reads them from the board", (a) => {
    const cfg = readFileSync(join(root, "config.js"), "utf8");
    a.not(/dates:\s*\{/.test(cfg), "config.js still has a dates block");
    const app = readFileSync(join(root, "index.html"), "utf8");
    a.has(app, "var dates = busDates(v);");
  });

  /* ---- a copy for another church ---------------------------------------- */

  s.test("the code ships no church's buses, stops, kerbs, dates or pairing", (a) => {
    const L = load([TABS["Buses"]], true);
    a.eq(JSON.stringify(L.ctx.SEED_BUSES), "[]");
    a.eq(JSON.stringify(L.ctx.SEED_STOPS), "[]");
    a.eq(JSON.stringify(L.ctx.STOP_PINS), "{}");
    a.eq(JSON.stringify(L.ctx.BUS_DATES_SEED), "{}");
    a.eq(L.ctx.BUS_ROTATION_ODD.north + L.ctx.BUS_ROTATION_ODD.south, "");
    const w = readFileSync(join(root, "server", "worker.js"), "utf8");
    a.has(w, 'const BUS_ROTATION_ODD = { north: "", south: "" };');
  });

  s.test("a new spreadsheet sets up with empty Buses and Bus Stops tabs, and no bus on any Sunday", (a) => {
    const L = loadCodeGs(root, { tabs: {}, props: { PIN_SALT: "salt" } });
    call(L, "ensureBuses", ss(L));
    a.eq(ss(L).getSheetByName("Buses").getLastRow(), 1);
    a.eq(JSON.stringify(call(L, "readBuses", ss(L))), "[]");
    const r = call(L, "busRule", "2026-11-01");
    a.eq(r.North, ""); a.eq(r.South, "");
  });

  return s;
}
