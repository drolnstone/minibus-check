/* THE VEHICLE LOG AND THE HISTORY.

   Until v1.92.0 (sheet) / w2.30.0 (live server) / v1.89.0 (pages) the Buses
   tab held one date per renewal, and a new date was typed over the old one:
   the day an MOT was actually done, the date it had been due, and anything
   about the service before were all lost. From this release:

     - every MOT, service, renewal, repair, tyres or booking recorded in the
       coordinator's app is a row of its own on the Vehicle Log;
     - the next due date is worked out by one set of rules, kept in three
       places (worker.js, Code.gs, coord/index.html) and held together here;
     - the Buses tab's date moves with a History row saying what it was, and
       a date typed straight onto the tab is written on History too;
     - a mistake is put right with a new row that names the old one;
     - a defect keeps every status it has been given, a reopening included;
     - a job the walkaround asked for can be marked done.

   Every check here fails on the release before: none of it existed. */

import vm from "node:vm";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { TABS, tab } from "../lib/tabs.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const THU = "2026-10-01T12:00:00+01:00";        /* today is 1 October 2026 */
const KEY = "2026-10-04", LAST = "2026-09-27";
const PIN = "1234";
const SHEET = "https://script.google.com/macros/s/TEST/exec";
const TYRE = "chk-1|YS70 PWE|Nearside rear tyre|" + LAST;

/* The coordinator's page, as it ships: the named functions cut out of it by
   brace matching, and RENEWALS with them. */
function cutBlock(src, at, file, name) {
  if (at === -1) throw new Error(file + " has no " + name);
  let depth = 0;
  for (let j = src.indexOf("{", at); j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (!depth) return src.slice(at, j + 1); }
  }
  throw new Error(name + " in " + file + " has no closing brace");
}
function fromCoord(root, names) {
  const file = "coord/index.html";
  const src = readFileSync(join(root, file), "utf8");
  const code = [cutBlock(src, src.indexOf("var RENEWALS = {"), file, "RENEWALS") + ";"]
    .concat(names.map((n) => cutBlock(src, src.indexOf("function " + n + "("), file, n))).join("\n");
  const ctx = vm.createContext({ String, Number, Math, Date, JSON, Object, Array });
  new vm.Script(code, { filename: file }).runInContext(ctx);
  return ctx;
}

export default async function (root) {
  const s = new Suite("the vehicle log, the History tab and the next due dates");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());
  const RN = ["rnParts", "rnKey", "rnAddMonths", "rnAddDays", "rnYearLessDay", "rnDays", "rnNextDue", "lineUpOk"];
  const C = fromCoord(root, RN);
  const G = loadCodeGs(root, { tabs: {}, props: { PIN_SALT: "salt" } });

  /* ---- the rules --------------------------------------------------------- */

  /* [item, done, was due, date typed from the paperwork, next due, how (part)] */
  const CASES = [
    ["service", "2026-10-14", "2026-09-30", "", "2027-10-14", "twelve months from the day it was done"],
    ["service", "2026-08-01", "2026-09-30", "", "2027-08-01", "twelve months from the day it was done"],
    ["mot", "2026-04-20", "2026-05-15", "", "2027-05-15", "kept its date"],
    ["mot", "2026-04-16", "2026-05-15", "", "2027-05-15", "kept its date"],
    ["mot", "2026-04-15", "2026-05-15", "", "2027-04-14", "more than a month early"],
    ["mot", "2026-05-15", "2026-05-15", "", "2027-05-15", "kept its date"],
    ["mot", "2026-05-20", "2026-05-15", "", "2027-05-19", "tested after it ran out"],
    ["mot", "2026-06-10", "", "", "2027-06-09", "a year from the test, less a day"],
    ["mot", "2028-02-29", "", "", "2029-02-28", "a year from the test, less a day"],
    ["mot", "2028-02-10", "2028-02-29", "", "2029-02-28", "kept its date"],
    ["mot", "2026-03-01", "2026-03-31", "", "2027-03-31", "kept its date"],
    ["mot", "2026-02-28", "2026-03-31", "", "2027-02-27", "more than a month early"],
    ["mot", "2026-04-20", "2026-05-15", "2027-05-16", "2027-05-16", "the date on the certificate"],
    ["insurance", "2026-07-01", "2026-07-08", "", "2027-07-08", "a year on from the old expiry"],
    ["insurance", "2026-07-08", "2026-07-08", "", "2027-07-08", "a year on from the old expiry"],
    ["insurance", "2026-07-20", "2026-07-08", "", "2027-07-19", "it had lapsed"],
    ["insurance", "2026-07-20", "", "", "2027-07-19", "a year from the renewal, less a day"],
    ["insurance", "2026-05-08", "2026-07-08", "", "2027-07-08", "a year on from the old expiry"],
    ["insurance", "2026-05-07", "2026-07-08", "", "2027-05-06", "more than two months before"],
    ["insurance", "2026-03-01", "2026-07-08", "", "2027-02-28", "more than two months before"],
    ["permit", "2026-01-15", "2026-01-31", "", "2027-01-31", "a year on from the old expiry"],
    ["permit", "2026-02-03", "2026-01-31", "", "2027-02-02", "it had lapsed"],
    ["permit", "2026-01-15", "2026-01-31", "2026-12-31", "2026-12-31", "the date given"]
  ];

  s.test("the next due date, case by case, as the three copies of the rules give it", (a) => {
    for (const [item, done, was, given, next, how] of CASES) {
      for (const [who, fn] of [["worker.js", W.rnNextDue], ["Code.gs", (...x) => call(G, "rnNextDue", ...x)],
                               ["coord/index.html", C.rnNextDue]]) {
        const got = fn(item, done, was, given);
        const tag = who + " " + item + " done " + done + (was ? " due " + was : "") + (given ? " given " + given : "");
        a.eq(got.next, next, tag);
        a.has(got.how, how, tag);
      }
    }
  });

  s.test("an MOT test keeps its date from a month less a day before, and not a day earlier", (a) => {
    /* The DVSA's own example: runs out 15 May, tested from 16 April keeps 15 May. */
    a.eq(W.rnNextDue("mot", "2026-04-16", "2026-05-15", "").next, "2027-05-15");
    a.eq(W.rnNextDue("mot", "2026-04-15", "2026-05-15", "").next, "2027-04-14");
  });

  s.test("insurance is never shown running later than it does: an early new policy runs a year from its start, less a day", (a) => {
    const x = W.rnNextDue("insurance", "2026-10-01", "2027-07-08", "");
    a.eq(x.next, "2027-09-30");
    a.ok(x.next < "2028-07-08");
  });

  s.test("nothing that is not a renewal, or not a date, is given a next due date", (a) => {
    a.eq(W.rnNextDue("tyres", "2026-10-01", "", "").next, "");
    a.eq(W.rnNextDue("mot", "", "2026-10-20", "").next, "");
    a.eq(W.rnNextDue("mot", "01/10/2026", "2026-10-20", "").next, "");
    a.eq(call(G, "rnNextDue", "mot", "", "", "").next, "");
    a.eq(C.rnNextDue("service", "soon", "", "").next, "");
  });

  s.test("the three copies agree on every day for three years, against every kind of due date", (a) => {
    const WAS = ["", "2026-05-15", "2026-03-31", "2028-02-29", "2026-12-31", "2027-01-31", "2026-10-20"];
    let n = 0, bad = [];
    for (let i = 0; i < 1250 && bad.length < 5; i++) {
      const done = W.rnAddDays("2025-12-01", i);
      for (const item of ["mot", "service", "insurance", "permit"]) {
        for (const was of WAS) {
          const given = i % 97 === 0 ? W.rnAddMonths(done, 11) : "";
          const w = W.rnNextDue(item, done, was, given);
          const g = call(G, "rnNextDue", item, done, was, given);
          const c = C.rnNextDue(item, done, was, given);
          n++;
          if (w.next !== g.next || w.next !== c.next || w.how !== g.how || w.how !== c.how) {
            bad.push(item + " " + done + " " + was + ": " + [w.next, g.next, c.next].join(" / "));
          }
        }
      }
    }
    a.eq(bad.length, 0, bad.join("; "));
    a.ok(n > 30000, "only " + n + " compared");
    for (const [x, y] of [["2026-10-01", "2027-06-01"], ["2026-10-01", "2026-10-20"], ["2026-10-01", "2027-11-02"]]) {
      a.eq(C.lineUpOk(x, y), W.lineUpOk(x, y), "lineUpOk " + x + " " + y);
    }
  });

  s.test("the tabs' header rows in the tests are the sheet's own", (a) => {
    a.eq(JSON.stringify(TABS["Vehicle Log"]), JSON.stringify(Array.from(G.ctx.VLOG_HEADERS)));
    a.eq(JSON.stringify(TABS["History"]), JSON.stringify(Array.from(G.ctx.HISTORY_HEADERS)));
  });

  /* ---- the live server ---------------------------------------------------- */

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    for (const d of [["Bro Arthur", "Coordinator", "North", 1], ["Bro Adrian", "Driver", "North", 3],
                     ["Bro Trevor", "Driver", "South", 5]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
        .bind(d[0], d[1], d[2], d[3], await W.pinHashOf(env, d[0], PIN)).run();
    }
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    await W.cachePut(env, "sheet_url", { url: SHEET }).run();
    await W.cachePut(env, "bus_extra", {
      "YS70 PWE": { dates: { mot: "2026-10-20", service: "2026-09-30", insurance: "2027-06-26", permit: "2027-01-31" }, oddRoute: "South" },
      "NH56 FWP": { dates: { mot: "2027-04-28", service: "2027-07-01", insurance: "2027-07-08", permit: "2027-01-31" }, oddRoute: "North" }
    }).run();
    await W.cachePut(env, "coord_shelf", {
      builtAt: Date.now() - 60000, readAt: Date.now() - 60000, requests: [],
      defects: [{ key: TYRE, checkId: "chk-1", reg: "YS70 PWE", date: LAST, driver: "Bro Trevor",
                  item: "Nearside rear tyre", crit: false, found: "Worn edge", status: "Open", action: "",
                  kind: "Defect", received: Date.now() - 4 * 86400000, trail: [] }],
      vehicles: {
        log: { "YS70 PWE": [{ id: "S-YS70PWE-mot", what: "MOT", status: "Estimated", done: "2025-10-21", next: "2026-10-20",
                              how: "estimated", was: "", recorded: Date.now() - 86400000, correctedBy: "" }] },
        jobs: { "YS70 PWE": { checkId: "chk-9", date: LAST, driver: "Bro Trevor", jobs: ["Screenwash", "Tyre pressures"] } }
      }
    }).run();
    await W.cachePut(env, "cache_last", { builtAt: Date.now(), payload: { ok: true,
      last: { "YS70 PWE": { miles: 45120, date: "Sun 27 Sep", time: "09:10", driver: "Bro Trevor" } } } }).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const coord = async (env, body) => J(await post(env, Object.assign({ action: "coord", who: "Bro Arthur", pin: PIN }, body)));
  let n = 0;
  const act = (env, x) => coord(env, { op: "act", act: Object.assign({ id: "act-" + (++n) + "-vl" }, x) });
  const busOf = (out, reg) => (out.buses || []).find((b) => b.reg === reg) || {};
  const acts = async (db) => (await db.prepare("SELECT id, kind FROM coord_actions").all()).results || [];

  s.test("an MOT recorded in the app: the date is worked out and every phone has it at once", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "vlog", reg: "YS70 PWE", what: "MOT", status: "Done", done: "2026-09-28",
                                   miles: "45,180", garage: "Walton Garage", cost: 54.85 });
      a.ok(out.ok, JSON.stringify(out));
      a.has(out.action && out.action.words, "Next due 20/10/2027");
      const load = await coord(env, { op: "load" });
      a.eq(busOf(load, "YS70 PWE").dates.mot, "2027-10-20", "the coordinator's app still shows the old date");
      const board = await W.boardPayload(env, "South");
      a.eq((board.buses || []).find((b) => b.reg === "YS70 PWE").dates.mot, "2027-10-20", "the driver's board still shows the old date");
      const e = load.vehicles.log["YS70 PWE"][0];
      a.eq(e.what, "MOT");
      a.eq(e.done, "2026-09-28");
      a.eq(e.was, "2026-10-20");
      a.eq(e.early, -22, "22 days before it was due");
      a.has(e.how, "kept its date");
      a.eq(e.garage, "Walton Garage");
      a.eq(e.cost, 54.85);
      a.ok(e.waiting, "not marked as still on its way to the sheet");
      a.eq(load.lastMiles["YS70 PWE"].miles, 45120, "the last mileage a walkaround read is not offered");
    });
  });

  s.test("only what it was is needed: the day done is today when none is given", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "vlog", reg: "NH56 FWP", what: "Tyres" });
      a.ok(out.ok, JSON.stringify(out));
      const e = (await coord(env, { op: "load" })).vehicles.log["NH56 FWP"][0];
      a.eq(e.done, "2026-10-01");
      a.eq(e.next, "", "tyres have no due date");
      a.eq(e.miles, null);
      a.eq(e.cost, null);
    });
  });

  s.test("the sheet's log and jobs reach the app through the sync itself", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const L = sheet();
      call(L, "applyCoordAction", ss(L), A("a1", "vlog", vlogBody()), {});
      const shelf = { readAt: Date.now(), requests: [], defects: [], vehicles: call(L, "vlogShelf", ss(L)) };
      await W.handleSync(env, { coordShelf: JSON.parse(JSON.stringify(shelf)) });
      const load = await coord(env, { op: "load" });
      const e = (load.vehicles.log["YS70 PWE"] || [])[0] || {};
      a.eq(e.id, "L-a1", "the sheet's own row did not reach the app");
      a.eq(e.next, "2027-10-20");
      a.eq(JSON.stringify(load.vehicles.jobs["YS70 PWE"] && load.vehicles.jobs["YS70 PWE"].jobs),
           JSON.stringify(["Screenwash", "Tyre pressures"]), "the jobs did not reach the app");
      await W.handleSync(env, { coordShelf: { readAt: Date.now(), requests: [], defects: [],
                                              vehicles: { log: { "YS70 PWE": "nonsense" }, jobs: [1, 2] } } });
      const junk = await coord(env, { op: "load" });
      a.eq(JSON.stringify(junk.vehicles), JSON.stringify({ log: {}, jobs: {} }), "a malformed shelf was kept");
    });
  });

  s.test("what the live server refuses, and none of it is kept", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      const no = async (x, words) => {
        const out = await act(env, Object.assign({ kind: "vlog", reg: "YS70 PWE", what: "Service" }, x));
        a.not(out.ok, "took " + JSON.stringify(x));
        a.has(String(out.error || ""), words);
      };
      await no({ done: "2026-10-02" }, "has not come yet");
      await no({ status: "Booked" }, "the day it is booked for");
      await no({ status: "Booked", bookedFor: "2026-09-30" }, "a day ahead");
      await no({ miles: "lots" }, "not a number of miles");
      await no({ cost: "-4" }, "not an amount in pounds");
      await no({ reg: "AB12 CDE" }, "not on the Buses tab");
      await no({ what: "Wash" }, "Choose what was done");
      await no({ defects: ["chk-2|NH56 FWP|Wiper|" + LAST] }, "not open on this bus");
      a.eq((await acts(db)).length, 0, "a refused entry was kept");
    });
  });

  s.test("a booking goes on the log and moves no date", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "vlog", reg: "YS70 PWE", what: "MOT", status: "Booked", bookedFor: "2026-10-15" });
      a.ok(out.ok, JSON.stringify(out));
      a.has(out.action.words, "booked for 15/10/2026");
      const load = await coord(env, { op: "load" });
      a.eq(busOf(load, "YS70 PWE").dates.mot, "2026-10-20");
      a.eq(load.vehicles.log["YS70 PWE"][0].status, "Booked");
    });
  });

  s.test("a defect ticked as put right leaves the open list at once, and is named on the entry", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "vlog", reg: "YS70 PWE", what: "Tyres", defects: [TYRE] });
      a.ok(out.ok, JSON.stringify(out));
      a.has(out.action.words, "Put right: Nearside rear tyre");
      const load = await coord(env, { op: "load" });
      a.eq(load.defects.length, 0, "the defect is still shown open");
      a.eq(load.vehicles.log["YS70 PWE"][0].defects, "Nearside rear tyre");
    });
  });

  s.test("until the sheet names it applied the app's date stands; then the sheet's own copy does", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "vlog", reg: "YS70 PWE", what: "MOT", done: "2026-09-28" });
      const id = out.action.id;
      const buses = (mot) => [{ reg: "YS70 PWE", seats: 16, active: true, dates: { mot: mot, service: "2026-09-30" } },
                              { reg: "NH56 FWP", seats: 14, active: true, dates: { mot: "2027-04-28" } }];
      await W.handleSync(env, { buses: buses("2026-10-20") });
      a.eq(busOf(await coord(env, { op: "load" }), "YS70 PWE").dates.mot, "2027-10-20", "an older copy of the tab won");
      await W.handleSync(env, { buses: buses("2027-10-19"), coordApplied: [id] });
      a.eq(busOf(await coord(env, { op: "load" }), "YS70 PWE").dates.mot, "2027-10-19", "the sheet's word did not take over");
    });
  });

  s.test("a service is lined up with the MOT only when the MOT is six to thirteen months off", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const near = await act(env, { kind: "vlog", reg: "YS70 PWE", what: "Service", done: "2026-09-28", withMot: true });
      a.has(near.action.words, "Next due 28/09/2027", "lined up with an MOT due in three weeks");
      const { env: env2 } = await fresh();
      await act(env2, { kind: "vlog", reg: "YS70 PWE", what: "MOT", done: "2026-09-28" });
      const svc = await act(env2, { kind: "vlog", reg: "YS70 PWE", what: "Service", done: "2026-09-28", withMot: true });
      a.has(svc.action.words, "Next due 20/10/2027");
      const e = (await coord(env2, { op: "load" })).vehicles.log["YS70 PWE"].find((x) => x.what === "Service");
      a.eq(e.how, "lined up with the MOT");
    });
  });

  s.test("a correction works the date out again from the date the bus had before it", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const first = await act(env, { kind: "vlog", reg: "YS70 PWE", what: "MOT", done: "2026-09-28" });
      const orig = "L-" + first.action.id;
      const fix = await act(env, { kind: "vfix", corrects: orig, done: "2026-09-10", why: "Wrong day typed" });
      a.ok(fix.ok, JSON.stringify(fix));
      a.has(fix.action.words, "Next due 09/09/2027");
      const load = await coord(env, { op: "load" });
      a.eq(busOf(load, "YS70 PWE").dates.mot, "2027-09-09");
      const log = load.vehicles.log["YS70 PWE"];
      const was = log.find((x) => x.id === orig), now = log.find((x) => x.corrects === orig);
      a.ok(was, "the entry it corrects is gone from the log");
      a.eq(was && was.correctedBy, now && now.id, "the old entry does not say what corrected it");
      a.eq(now && now.status, "Correction");
      a.has(now && now.how, "more than a month early");
      const again = await act(env, { kind: "vfix", corrects: orig, done: "2026-09-12" });
      a.not(again.ok, "corrected twice");
      a.has(String(again.error), "Correct the correction instead");
    });
  });

  s.test("withdrawn: the bus goes back to the date it had", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const first = await act(env, { kind: "vlog", reg: "YS70 PWE", what: "MOT", done: "2026-09-28" });
      const out = await act(env, { kind: "vfix", corrects: "L-" + first.action.id, withdraw: true, why: "Wrong bus" });
      a.ok(out.ok, JSON.stringify(out));
      a.has(out.action.words, "withdrawn");
      a.eq(busOf(await coord(env, { op: "load" }), "YS70 PWE").dates.mot, "2026-10-20");
    });
  });

  s.test("a job the walkaround asked for, marked done, leaves the list; once", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "job", reg: "YS70 PWE", job: "Screenwash", checkId: "chk-9" });
      a.ok(out.ok, JSON.stringify(out));
      const jobs = (await coord(env, { op: "load" })).vehicles.jobs["YS70 PWE"];
      a.eq(JSON.stringify(jobs.jobs), JSON.stringify(["Tyre pressures"]));
      const again = await act(env, { kind: "job", reg: "YS70 PWE", job: "Screenwash", checkId: "chk-9" });
      a.not(again.ok, "marked done twice");
      const stale = await act(env, { kind: "job", reg: "YS70 PWE", job: "Tyre pressures", checkId: "chk-8" });
      a.not(stale.ok, "a job from an older walkaround was taken");
    });
  });

  /* ---- the sheet -------------------------------------------------------- */

  const day = (y, m, d) => new Date(y, m - 1, d);
  function sheet(o) {
    o = o || {};
    const tabs = {
      "Buses": tab("Buses", [
        { Registration: "YS70 PWE", "Seats for passengers": 16, Active: "YES", "MOT due": day(2026, 10, 20),
          "Service due": day(2026, 9, 30), "Insurance due": day(2027, 6, 26), "Permit due": day(2027, 1, 31),
          "Route in odd months": "South" },
        { Registration: "NH56 FWP", "Seats for passengers": 14, Active: "YES", "MOT due": day(2027, 4, 28),
          "Service due": day(2027, 7, 1), "Insurance due": day(2027, 7, 8), "Permit due": day(2027, 1, 31),
          "Route in odd months": "North" }]),
      "Defects": tab("Defects", [
        { Received: day(2026, 9, 27), "Check ID": "chk-1", Date: day(2026, 9, 27), Registration: "YS70 PWE",
          Driver: "Bro Trevor", Item: "Nearside rear tyre", Critical: "NO", "What the driver found": "Worn edge",
          Status: "Open", Kind: "Defect" }]),
      "Checks": tab("Checks", [
        { Received: new Date(2026, 8, 20, 9, 5), "Check ID": "chk-8", Date: day(2026, 9, 20), Registration: "YS70 PWE",
          Driver: "Bro Adrian", "To arrange": "Oil" },
        { Received: new Date(2026, 8, 27, 9, 10), "Check ID": "chk-9", Date: day(2026, 9, 27), Registration: "YS70 PWE",
          Driver: "Bro Trevor", "To arrange": "Screenwash, Tyre pressures" }])
    };
    if (o.vlog) tabs["Vehicle Log"] = tab("Vehicle Log", o.vlog);
    const L = loadCodeGs(root, { tabs, props: Object.assign({ PIN_SALT: "salt", WORKER_URL: "https://worker.test" }, o.props || {}) });
    L.ctx.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getContentText: () => "{\"ok\":true}", getAllHeaders: () => ({}) }) };
    return L;
  }
  const ss = (L) => L.gas.ss;
  const grid = (L, name) => { const sh = ss(L).getSheetByName(name); return sh ? sh.getDataRange().getValues() : []; };
  const objs = (L, name) => {
    const g = grid(L, name);
    return g.slice(1).map((r) => { const o = {}; g[0].forEach((h, i) => { o[h] = r[i]; }); return o; });
  };
  const busCell = (L, reg, col) => {
    const g = grid(L, "Buses");
    return g.find((r) => r[0] === reg)[g[0].indexOf(col)];
  };
  const iso = (L, v) => call(L, "anyToKey", v);
  const A = (id, kind, body) => ({ id: id, kind: kind, sunday: "", by: "Bro Arthur", made: Date.now(), body: body });
  const vlogBody = (o) => Object.assign({ logId: "L-a1", reg: "YS70 PWE", what: "MOT", status: "Done", done: "2026-09-28",
    bookedFor: "", was: "2026-10-20", early: -22, next: "2027-10-20", how: "kept its date: tested within a month of running out",
    given: "", miles: 45180, garage: "Walton Garage", cost: 54.85, defects: [], defectNames: [], notes: "" }, o || {});

  s.test("the sheet writes the entry, moves the Buses tab's date and says on History what it was", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      const out = call(L, "applyCoordAction", ss(L), A("a1", "vlog", vlogBody()), {});
      a.ok(out.done && out.ok, JSON.stringify(out));
      const row = objs(L, "Vehicle Log")[0];
      a.eq(row["Log ID"], "L-a1");
      a.eq(iso(L, row["Date done"]), "2026-09-28");
      a.eq(iso(L, row["Was due"]), "2026-10-20");
      a.eq(row["Days early (-) or late (+)"], -22);
      a.eq(iso(L, row["Next due"]), "2027-10-20");
      a.eq(row["Mileage"], 45180);
      a.eq(row["Recorded by"], "Bro Arthur");
      a.eq(iso(L, busCell(L, "YS70 PWE", "MOT due")), "2027-10-20");
      const h = objs(L, "History");
      const moved = h.find((x) => x["What changed"] === "MOT due");
      a.ok(moved, "no History row for the date: " + JSON.stringify(h));
      a.eq(moved && moved.From, "20/10/2026");
      a.eq(moved && moved.To, "20/10/2027");
      a.eq(moved && moved.Ref, "L-a1");
      a.ok(h.some((x) => x["What changed"] === "Vehicle Log: MOT"), "the entry itself is not on History");
    });
  });

  s.test("the same entry sent twice is written once", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      call(L, "coordVlog", ss(L), A("a1", "vlog", vlogBody()), vlogBody(), "Bro Arthur");
      const again = call(L, "coordVlog", ss(L), A("a1", "vlog", vlogBody()), vlogBody(), "Bro Arthur");
      a.ok(again.ok, JSON.stringify(again));
      a.eq(objs(L, "Vehicle Log").length, 1);
    });
  });

  s.test("a defect ticked on the entry is closed with what put it right, on its trail", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      call(L, "applyCoordAction", ss(L), A("a2", "vlog", vlogBody({ logId: "L-a2", what: "Tyres", next: "", was: "", early: null,
        how: "", defects: [TYRE], defectNames: ["Nearside rear tyre"] })), {});
      const d = objs(L, "Defects")[0];
      a.eq(d.Status, "Fixed");
      a.has(d["Action taken"], "Put right: Tyres");
      a.ok(d["Closed on"], "Closed on was not filled");
      const trail = objs(L, "History").filter((x) => x.Ref === TYRE);
      a.ok(trail.some((x) => x.From === "Open" && x.To === "Fixed"), "the trail does not show it closed");
    });
  });

  s.test("a correction is a new row; the old one stays, and the date follows the standing row", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      call(L, "applyCoordAction", ss(L), A("a1", "vlog", vlogBody()), {});
      const out = call(L, "applyCoordAction", ss(L), A("a3", "vfix", { logId: "C-a3", corrects: "L-a1", reg: "YS70 PWE",
        what: "MOT", withdraw: false, why: "Wrong day typed", status: "Done", done: "2026-09-10", bookedFor: "",
        was: "2026-10-20", early: -40, next: "2027-09-09", how: "a year from the test, less a day: tested more than a month early",
        given: "", miles: 45180, cost: 54.85, garage: "Walton Garage", notes: "" }), {});
      a.ok(out.ok, JSON.stringify(out));
      const rows = objs(L, "Vehicle Log");
      a.eq(rows.length, 2, "the wrong row was taken away");
      a.eq(rows[1].Corrects, "L-a1");
      a.eq(rows[1].Status, "Correction");
      a.eq(iso(L, busCell(L, "YS70 PWE", "MOT due")), "2027-09-09");
      a.ok(objs(L, "History").some((x) => x["What changed"] === "Vehicle Log entry corrected" && x.Why === "Wrong day typed"));
      const again = call(L, "applyCoordAction", ss(L), A("a4", "vfix", { logId: "C-a4", corrects: "L-a1", withdraw: true }), {});
      a.not(again.ok, "a corrected row was corrected again");
    });
  });

  s.test("a withdrawal puts the bus back to the date it had before", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      call(L, "applyCoordAction", ss(L), A("a1", "vlog", vlogBody()), {});
      call(L, "applyCoordAction", ss(L), A("a5", "vfix", { logId: "C-a5", corrects: "L-a1", reg: "YS70 PWE", withdraw: true, why: "Wrong bus" }), {});
      a.eq(iso(L, busCell(L, "YS70 PWE", "MOT due")), "2026-10-20");
      a.eq(objs(L, "Vehicle Log")[1].Status, "Withdrawn");
    });
  });

  s.test("jobs to arrange come from the last walkaround, less those marked done", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      const before = call(L, "jobsOutstanding", ss(L));
      a.eq(JSON.stringify(Array.from(before["YS70 PWE"].jobs)), JSON.stringify(["Screenwash", "Tyre pressures"]),
           "the older walkaround's Oil is still asked for, or the last one's jobs are missing");
      call(L, "applyCoordAction", ss(L), A("a6", "job", { reg: "YS70 PWE", job: "Screenwash", checkId: "chk-9", note: "" }), {});
      const after = call(L, "jobsOutstanding", ss(L));
      a.eq(JSON.stringify(Array.from(after["YS70 PWE"].jobs)), JSON.stringify(["Tyre pressures"]));
    });
  });

  s.test("a date typed straight onto the Buses tab is written on History; the first look only takes its bearings", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      a.eq(call(L, "busDatesAudit", ss(L), "On the Buses tab", "arthur@example.org"), 0, "the first look wrote rows");
      const sh = ss(L).getSheetByName("Buses");
      const col = TABS["Buses"].indexOf("Service due") + 1;
      sh.getRange(2, col).setValue(day(2027, 9, 30));
      call(L, "onEdit", { range: sh.getRange(2, col), oldValue: "", value: "30/09/2027" });
      const h = objs(L, "History").filter((x) => x["What changed"] === "Service due");
      a.eq(h.length, 1, JSON.stringify(objs(L, "History")));
      a.eq(h[0] && h[0].From, "30/09/2026");
      a.eq(h[0] && h[0].To, "30/09/2027");
      a.has(h[0] && h[0].Why, "not through the app");
      a.eq(call(L, "busDatesAudit", ss(L), "On the Buses tab", ""), 0, "the same change written twice");
    });
  });

  s.test("text that is not a date is said to be unreadable, not taken as blank", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      call(L, "busDatesAudit", ss(L), "x", "");
      const sh = ss(L).getSheetByName("Buses");
      sh.getRange(3, TABS["Buses"].indexOf("Permit due") + 1).setValue("end of Jan");
      call(L, "busDatesAudit", ss(L), "Every five minutes", "");
      const h = objs(L, "History").find((x) => x["What changed"] === "Permit due");
      a.ok(h, "nothing written");
      a.eq(h && h.To, "end of Jan");
      a.has(h && h.Why, "cannot read this as a date");
    });
  });

  s.test("the app's own change is not written twice by the audit after it", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      call(L, "busDatesAudit", ss(L), "x", "");
      call(L, "applyCoordAction", ss(L), A("a1", "vlog", vlogBody()), {});
      a.eq(call(L, "busDatesAudit", ss(L), "Every five minutes", ""), 0);
    });
  });

  s.test("the Buses tab's due dates take a date and nothing else", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      call(L, "ensureBuses", ss(L));
      const rule = ss(L).getSheetByName("Buses").getRange(2, TABS["Buses"].indexOf("MOT due") + 1).getDataValidation();
      a.ok(rule && rule._date, "no date rule on MOT due");
      a.eq(rule && rule._allowInvalid, false, "anything else is let in");
    });
  });

  s.test("and from the first sync after the upgrade, without anybody running Set up", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      call(L, "vlogBoot", ss(L));
      const rule = ss(L).getSheetByName("Buses").getRange(5, TABS["Buses"].indexOf("Permit due") + 1).getDataValidation();
      a.ok(rule && rule._date, "no date rule after the first sync");
      a.ok(ss(L).getSheetByName("History"), "no History tab");
      a.ok(objs(L, "Vehicle Log").length === 8, "the log was not started");
      a.eq(L.gas.props.vlogReady, L.ctx.SCRIPT_VERSION, "not marked done, so it would all run again");
    });
  });

  s.test("the log starts once from the Buses tab: estimated rows, the service pegged to the MOT, nothing moved", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      const n = call(L, "vlogSeed", ss(L));
      a.eq(n, 8);
      const rows = objs(L, "Vehicle Log");
      const mot = rows.find((x) => x["Log ID"] === "S-YS70PWE-mot");
      const svc = rows.find((x) => x["Log ID"] === "S-YS70PWE-service");
      a.eq(mot && mot.Status, "Estimated");
      a.eq(iso(L, mot && mot["Date done"]), "2025-10-21", "an MOT due 20/10/2026 was tested 21/10/2025");
      a.eq(iso(L, svc && svc["Date done"]), "2025-10-21", "the service was not taken as done with the MOT");
      a.eq(iso(L, svc && svc["Next due"]), "2026-09-30", "the Buses tab's own service date was not kept");
      a.eq(iso(L, busCell(L, "YS70 PWE", "Service due")), "2026-09-30");
      a.eq(call(L, "vlogSeed", ss(L)), 0, "started twice");
    });
  });

  s.test("a row typed on the Vehicle Log is completed like one from the app", async (a) => {
    await atTime(THU, async () => {
      const L = sheet({ vlog: [{ Registration: "NH56 FWP", What: "Insurance", "Date done": day(2026, 9, 29) }] });
      call(L, "busDatesAudit", ss(L), "x", "");
      const sh = ss(L).getSheetByName("Vehicle Log");
      call(L, "onEdit", { range: sh.getRange(2, TABS["Vehicle Log"].indexOf("Date done") + 1), value: "29/09/2026" });
      const r = objs(L, "Vehicle Log")[0];
      a.ok(/^H-/.test(r["Log ID"]), "no Log ID: " + r["Log ID"]);
      a.eq(r.Status, "Done");
      a.eq(iso(L, r["Next due"]), "2027-09-28", "a new policy nine months early runs a year from its start, less a day");
      a.eq(iso(L, r["Was due"]), "2027-07-08");
      a.eq(r.Source, "Typed on the sheet");
      a.eq(iso(L, busCell(L, "NH56 FWP", "Insurance due")), "2027-09-28");
      /* And a row that is already a record: the edit is written down. */
      const cell = sh.getRange(2, TABS["Vehicle Log"].indexOf("Garage") + 1);
      cell.setValue("Another garage");
      call(L, "onEdit", { range: cell, oldValue: "", value: "Another garage" });
      a.ok(objs(L, "History").some((x) => x["What changed"] === "Vehicle Log row edited: Garage"));
    });
  });

  s.test("an edit on History is itself written down", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      call(L, "historyAdd", ss(L), [{ who: "x", where: "y", reg: "YS70 PWE", what: "MOT due", from: "a", to: "b" }]);
      const sh = ss(L).getSheetByName("History");
      const cell = sh.getRange(2, TABS["History"].indexOf("To") + 1);
      cell.setValue("c");
      call(L, "onEdit", { range: cell, oldValue: "b", value: "c" });
      const h = objs(L, "History");
      a.eq(h.length, 2);
      a.has(h[1]["What changed"], "History edited by hand");
      a.eq(h[1].From, "b");
    });
  });

  s.test("a defect reopened by hand keeps the day it was first closed", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      call(L, "applyCoordAction", ss(L), A("a7", "defect", { key: TYRE, status: "Fixed", action: "New tyre" }), {});
      const sh = ss(L).getSheetByName("Defects");
      const st = sh.getRange(2, TABS["Defects"].indexOf("Status") + 1);
      st.setValue("Open");
      call(L, "onEdit", { range: st, oldValue: "Fixed", value: "Open" });
      const trail = objs(L, "History").filter((x) => x.Ref === TYRE);
      a.ok(trail.some((x) => x.From === "Open" && x.To === "Fixed"), "the closure is not on the trail");
      const re = trail.find((x) => /^Defect reopened/.test(x["What changed"]));
      a.ok(re, "the reopening is not on the trail");
      a.has(re && re.From, "Closed on 01/10/2026");
      a.eq(objs(L, "Defects")[0]["Closed on"], "", "Closed on was not cleared");
      const listed = call(L, "coordDefectsList", ss(L))[0];
      a.ok(listed && listed.trail.length >= 2, "the app is not sent the trail");
    });
  });

  s.test("the push carries each bus's log and jobs for the coordinator's app", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      call(L, "applyCoordAction", ss(L), A("a1", "vlog", vlogBody()), {});
      const shelf = call(L, "vlogShelf", ss(L));
      a.eq(shelf.log["YS70 PWE"][0].id, "L-a1");
      a.eq(shelf.log["YS70 PWE"][0].next, "2027-10-20");
      a.ok(shelf.jobs["YS70 PWE"], "no jobs");
    });
  });

  /* ---- is everything working? -----------------------------------------
     The Message button went dark for weeks with nothing to say so. The same
     must not happen to the due dates or the log: the live server says what
     it holds, and the sheet holds it against its own tabs. */

  s.test("the live server says what it holds about each bus: due dates and how many log entries", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await J(await post(env, { action: "ping" }));
      a.eq(out.busDates && out.busDates["YS70 PWE"] && out.busDates["YS70 PWE"].mot, "2026-10-20");
      a.eq(out.vlogHeld && out.vlogHeld["YS70 PWE"], 1);
      a.hasnt(JSON.stringify(out.vlogHeld), "Estimated", "more than a count came back");
    });
  });

  const health = (L, lv) => {
    const good = [], bad = [], todo = [];
    call(L, "vehicleHealth", ss(L), lv, good, bad, todo);
    return { good: good.join(" | "), bad: bad.join(" | "), todo: todo.join(" | ") };
  };
  const liveOf = (L) => {
    const dates = call(L, "busDatesNow", ss(L)), held = {};
    call(L, "vlogRows", ss(L)).forEach((x) => { held[x.reg] = (held[x.reg] || 0) + 1; });
    return { busDates: JSON.parse(JSON.stringify(dates)), vlogHeld: held };
  };

  s.test("Is everything working? says the phones have every bus's dates and log when they do", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      call(L, "vlogBoot", ss(L));
      const r = health(L, liveOf(L));
      a.eq(r.bad, "", r.bad);
      a.has(r.good, "the phones have every bus's due dates and the Vehicle Log (8 entries)");
    });
  });

  s.test("and says so when the log has not reached the coordinator's app", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      call(L, "vlogBoot", ss(L));
      const lv = liveOf(L);
      lv.vlogHeld = {};
      const r = health(L, lv);
      a.has(r.bad, "shows no Vehicle Log for");
      a.has(r.bad, "YS70 PWE");
      a.has(r.bad, "Send everything");
      a.hasnt(r.good, "Bus records");
    });
  });

  s.test("and when the drivers are warned from a different date than the Buses tab", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      const lv = liveOf(L);
      lv.busDates["YS70 PWE"].mot = "2026-10-19";
      const r = health(L, lv);
      a.has(r.bad, "YS70 PWE MOT (the tab says 20/10/2026, the phones 19/10/2026)");
    });
  });

  s.test("a date cell that cannot be read is a thing to do, and an old live server is named", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      ss(L).getSheetByName("Buses").getRange(3, TABS["Buses"].indexOf("Permit due") + 1).setValue("end of Jan");
      const lv = liveOf(L);
      const r = health(L, lv);
      a.has(r.todo, "NH56 FWP Permit due cannot be read as a date");
      a.has(health(L, { waHeld: [] }).bad, "older than w2.30.0");
      a.has(health(L, { vlogHeld: null, busDates: {} }).bad, "could not read");
    });
  });

  s.test("the whole way round: the sheet's push, the live server's answer, the report", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const L = sheet();
      call(L, "vlogBoot", ss(L));
      const sent = [];
      L.ctx.UrlFetchApp = { fetch(url, o) { try { sent.push(JSON.parse(o.payload)); } catch (e) {}
        return { getResponseCode: () => 200, getAllHeaders: () => ({}), getContentText: () => "{\"ok\":true}" }; } };
      call(L, "pushToWorker");
      const sync = sent.filter((b) => b && b.action === "sync").pop();
      a.ok(sync, "no sync was sent");
      await W.handleSync(env, sync);
      const ping = await J(await post(env, { action: "ping" }));
      L.ctx.UrlFetchApp = { fetch() { return { getResponseCode: () => 200, getAllHeaders: () => ({}),
        getContentText: () => JSON.stringify(ping) }; } };
      const r = call(L, "healthReport");
      const bad = [].concat(r.bad || []).join(" | ");
      a.hasnt(bad, "Bus records", bad);
      a.has([].concat(r.good || []).join(" | "), "the phones have every bus's due dates and the Vehicle Log");
    });
  });

  /* ---- from w2.38.0 / v1.102.0 / v1.95.3: three gaps closed ------------- */

  s.test("an older job recorded late goes on the log without moving the bus's date, on the live server", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      /* Last year's MOT, recorded as new when the Estimated row says 21/10/2025. */
      const old = await act(env, { kind: "vlog", reg: "YS70 PWE", what: "MOT", status: "Done", done: "2024-10-18" });
      a.ok(old.ok, JSON.stringify(old));
      a.has(old.action && old.action.words, "a later entry stands");
      const load = await coord(env, { op: "load" });
      a.eq(busOf(load, "YS70 PWE").dates.mot, "2026-10-20", "an older entry moved the bus's MOT date");
      a.ok(load.vehicles.log["YS70 PWE"].some((x) => x.done === "2024-10-18"), "the older entry is not on the log");
      /* A newer one still moves it. */
      const now = await act(env, { kind: "vlog", reg: "YS70 PWE", what: "MOT", status: "Done", done: "2026-09-28" });
      a.ok(now.ok, JSON.stringify(now));
      a.hasnt(now.action && now.action.words, "a later entry stands");
      a.eq(busOf(await coord(env, { op: "load" }), "YS70 PWE").dates.mot, "2027-10-20");
    });
  });

  s.test("and on the sheet: the older entry is written, the Buses tab keeps its date, History says why", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      call(L, "vlogBoot", ss(L));
      const out = call(L, "applyCoordAction", ss(L), A("a9", "vlog",
        vlogBody({ logId: "L-a9", done: "2024-10-18", next: "2025-10-17", how: "a year from the test, less a day" })), {});
      a.ok(out.done && out.ok, JSON.stringify(out));
      a.ok(objs(L, "Vehicle Log").some((r) => r["Log ID"] === "L-a9"), "the older entry is not on the tab");
      a.eq(iso(L, busCell(L, "YS70 PWE", "MOT due")), "2026-10-20", "an older entry moved the Buses tab's date");
      a.ok(objs(L, "History").some((x) => /later entry stands/.test(String(x.Why || x["Why"] || JSON.stringify(x)))),
           "History does not say why the date stayed");
      /* The latest one still moves it. */
      call(L, "applyCoordAction", ss(L), A("a10", "vlog", vlogBody({ logId: "L-a10" })), {});
      a.eq(iso(L, busCell(L, "YS70 PWE", "MOT due")), "2027-10-20");
    });
  });

  s.test("a row typed on the Vehicle Log for an older job leaves the Buses tab's date", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      call(L, "vlogBoot", ss(L));
      call(L, "busDatesAudit", ss(L), "x", "");
      const sh = ss(L).getSheetByName("Vehicle Log");
      const row = sh.getLastRow() + 1;
      const col = (h) => TABS["Vehicle Log"].indexOf(h) + 1;
      sh.getRange(row, col("Registration")).setValue("NH56 FWP");
      sh.getRange(row, col("What")).setValue("Insurance");
      sh.getRange(row, col("Date done")).setValue(day(2025, 3, 1));
      call(L, "onEdit", { range: sh.getRange(row, col("Date done")), value: "01/03/2025" });
      a.eq(iso(L, busCell(L, "NH56 FWP", "Insurance due")), "2027-07-08", "an older typed row moved the date");
    });
  });

  s.test("Is everything working? names a bus in use with no MOT or insurance date the app can read", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      const sh = ss(L).getSheetByName("Buses");
      sh.getRange(2, TABS["Buses"].indexOf("Insurance due") + 1).setValue("");
      sh.getRange(3, TABS["Buses"].indexOf("MOT due") + 1).setValue("April");
      const r = health(L, liveOf(L));
      a.has(r.bad, "YS70 PWE Insurance due (blank)");
      a.has(r.bad, "NH56 FWP MOT due (it reads");
      a.has(r.bad, "never stopped");
      a.hasnt(r.todo, "NH56 FWP MOT due", "said twice, once as a thing to do");
      a.hasnt(r.good, "Bus records");
      /* A bus out of use is not named. */
      sh.getRange(2, TABS["Buses"].indexOf("Active") + 1).setValue("NO");
      a.hasnt(health(L, liveOf(L)).bad, "YS70 PWE");
    });
  });

  s.test("the coordinator's home says so too, for a bus in use with no MOT or insurance date", (a) => {
    const file = "coord/index.html";
    const src = readFileSync(join(root, file), "utf8");
    const code = [cutBlock(src, src.indexOf("var RENEWALS = {"), file, "RENEWALS") + ";",
                  cutBlock(src, src.indexOf("function rnParts("), file, "rnParts"),
                  cutBlock(src, src.indexOf("function needs("), file, "needs")].join("\n");
    const ctx = vm.createContext({ String, Number, Math, Date, JSON, Object, Array, encodeURIComponent,
      D: { buses: [{ reg: "YS70 PWE", active: true, dates: { mot: "2027-10-20" } },
                   { reg: "NH56 FWP", active: true, dates: { mot: "2027-04-28", insurance: "2027-07-08" } },
                   { reg: "AB12 CDE", active: false, dates: {} }] },
      busList: () => ctx.D.buses, esc: (x) => String(x), defectGroups: () => [] });
    new vm.Script(code, { filename: file }).runInContext(ctx);
    const out = JSON.stringify(ctx.needs());
    a.has(out, "YS70 PWE: no Insurance date");
    a.hasnt(out, "NH56 FWP", "a bus with both dates is named");
    a.hasnt(out, "AB12 CDE", "a bus out of use is named");
  });

  return s;
}
