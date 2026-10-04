/* AN EXPIRED MOT OR INSURANCE STOPS THE BUS. pages v1.94.0 · server w2.36.0
   · sheet v1.99.0.

   - Insurance past its date stops the bus with no way round it. An MOT past
     its date stops it too, except for one MOT run a coordinator authorises
     to a test booked on the Vehicle Log for that bus that day.
   - The MOT run is started and ended by the driver, once, and the bus is
     stopped again after it.
   - The coordinator's first screen has the stopped buses; the sheet writes
     "MOT run authorised" on History.
   - Renewal alerts at 60, 30 and 7 days and on the day, then weekly, once
     each, to every coordinator's address.

   Everything here fails on w2.35.0 / v1.98.0. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab } from "../lib/tabs.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const THU = "2026-10-01T12:00:00+01:00";
const KEY = "2026-10-04";
const PIN = "1234";

export default async function (root) {
  const s = new Suite("an expired MOT or insurance stops the bus");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  async function fresh(dates) {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await db.prepare("DELETE FROM drivers").run();
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
      .bind("Bro Arthur", "Coordinator", "North", 1, await W.pinHashOf(env, "Bro Arthur", PIN)).run();
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    await W.cachePut(env, "bus_extra", {
      "YS70 PWE": { dates: dates || {}, oddRoute: "North", notes: "" },
      "NH56 FWP": { dates: {}, oddRoute: "South", notes: "" } }).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const coord = async (env, body) => J(await post(env, Object.assign({ action: "coord", who: "Bro Arthur", pin: PIN }, body)));
  let n = 0;
  const act = (env, a) => coord(env, { op: "act", act: Object.assign({ id: "papers-act-" + (++n) }, a) });
  const motrun = async (env, step, who) => J(await post(env, { action: "motrun", motrun: { reg: "YS70 PWE", step, who } }));

  s.test("the rule: insurance first, good to the end of its day, service only warns", (a) => {
    a.eq(W.papersStop({ mot: "2026-10-01" }, "2026-10-01"), null);
    a.eq(W.papersStop({ mot: "2026-09-30" }, "2026-10-01").item, "mot");
    a.eq(W.papersStop({ mot: "2026-09-30", insurance: "2026-09-01" }, "2026-10-01").item, "insurance");
    a.eq(W.papersStop({ service: "2026-01-01", permit: "2026-01-01" }, "2026-10-01"), null);
    a.eq(W.papersStop({ mot: "" }, "2026-10-01"), null);
  });

  s.test("an MOT run: only to a test booked today, once, then stopped again", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh({ mot: "2026-09-30" });
      let load = await coord(env, { op: "load" });
      a.eq(load.papers["YS70 PWE"].item, "mot");
      a.eq(load.papers["NH56 FWP"], undefined);
      a.has(String((await act(env, { kind: "motrun", reg: "YS70 PWE", time: "10:30" })).error), "No MOT is booked");
      const bk = await act(env, { kind: "vlog", reg: "YS70 PWE", what: "MOT", status: "Booked", bookedFor: "2026-10-01",
                                  garage: "Kwik Fit Bootle", notes: "Test at 10:30" });
      a.ok(bk.ok, JSON.stringify(bk));
      a.has(String((await act(env, { kind: "motrun", reg: "YS70 PWE", time: "25:00" })).error), "test time");
      const out = await act(env, { kind: "motrun", reg: "YS70 PWE", time: "10:30" });
      a.ok(out.ok, JSON.stringify(out));
      a.eq(out.action.words, "YS70 PWE: MOT run authorised to Kwik Fit Bootle at 10:30.");
      a.has(String((await act(env, { kind: "motrun", reg: "YS70 PWE", time: "10:30" })).error), "already authorised");
      load = await coord(env, { op: "load" });
      const r = load.papers["YS70 PWE"].motRun;
      a.eq([r.by, r.garage, r.time, r.started].join("|"), "Bro Arthur|Kwik Fit Bootle|10:30|0");

      const board = await J(await W.default.fetch(new Request("https://worker.test/?board=1&route=North"), env, {}));
      a.eq(board.motRuns["YS70 PWE"].time, "10:30");

      a.eq((await motrun(env, "end", "Bro Ben")).error, "not started");
      const st = await motrun(env, "start", "Bro Ben");
      a.ok(st.ok && st.motRun.started && st.motRun.driver === "Bro Ben", JSON.stringify(st));
      a.eq((await motrun(env, "start", "Bro Carl")).error, "started");
      a.ok((await motrun(env, "end", "Bro Ben")).motRun.ended);
      a.eq((await motrun(env, "start", "Bro Ben")).error, "used");
      a.has(String((await act(env, { kind: "motrun", reg: "YS70 PWE", time: "11:00" })).error), "had its MOT run");
      load = await coord(env, { op: "load" });
      a.ok(load.papers["YS70 PWE"].motRun.ended, "the bus is not stopped again after its MOT run");
    });
  });

  s.test("insurance expired: no MOT run, no way round it; the renewal frees it", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh({ mot: "2026-09-30", insurance: "2026-09-29" });
      await act(env, { kind: "vlog", reg: "YS70 PWE", what: "MOT", status: "Booked", bookedFor: "2026-10-01" });
      a.has(String((await act(env, { kind: "motrun", reg: "YS70 PWE", time: "10:30" })).error), "insurance has expired");
      a.eq((await coord(env, { op: "load" })).papers["YS70 PWE"].item, "insurance");
      a.ok((await act(env, { kind: "vlog", reg: "YS70 PWE", what: "Insurance", status: "Done", done: "2026-10-01" })).ok);
      a.eq((await coord(env, { op: "load" })).papers["YS70 PWE"].item, "mot");
      a.ok((await act(env, { kind: "vlog", reg: "YS70 PWE", what: "MOT", status: "Done", done: "2026-10-01" })).ok);
      a.eq((await coord(env, { op: "load" })).papers["YS70 PWE"], undefined);
    });
  });

  function sheet(props) {
    return loadCodeGs(root, { tabs: {
      "Buses": tab("Buses", [
        { Registration: "YS70 PWE", "Seats for passengers": 16, Active: "YES", "MOT due": "31/10/2026", "Insurance due": "30/09/2026" },
        { Registration: "NH56 FWP", "Seats for passengers": 14, Active: "YES", "MOT due": "01/03/2027", "Service due": "soon" }]),
      "Drivers": tab("Drivers", [
        { Name: "Bro Arthur", Role: "Coordinator", Active: "YES", Email: "arthur@b.c" },
        { Name: "Pst Kenneth", Role: "Minister in Charge", Active: "YES", Email: "kenneth@b.c" },
        { Name: "Bro Ben", Role: "Driver", Active: "YES", Email: "ben@b.c" }]) },
      props: Object.assign({ COORDINATOR_EMAIL: "coord@b.c" }, props || {}) });
  }

  s.test("renewal alerts: each stage once, to every coordinator, unreadable dates too", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      const ss = L.gas.ss;
      a.eq(call(L, "renewalStage", 61), "");
      a.eq([60, 31, 30, 8, 7, 1, 0, -1, -7, -8].map((d) => call(L, "renewalStage", d)).join(","),
           "60,60,30,30,7,7,0,over0,over0,over1");
      a.eq(call(L, "safetyTo"), "coord@b.c", "a coordinator's driver address was added to COORDINATOR_EMAIL");
      a.eq(call(sheet({ COORDINATOR_EMAIL: "" }), "safetyTo"), "arthur@b.c,kenneth@b.c");
      call(L, "renewalAlerts", ss);
      const subj = L.gas.mail.map((m) => m.subject);
      a.ok(subj.some((x) => x === "Minibus: YS70 PWE: MOT due in 30 days"), subj.join(" / "));
      a.ok(subj.some((x) => x === "Minibus: BUS STOPPED: YS70 PWE: Insurance expired 30/09/2026"), subj.join(" / "));
      a.ok(subj.some((x) => /NH56 FWP: Service date unreadable/.test(x)), subj.join(" / "));
      a.not(subj.some((x) => /NH56 FWP: MOT/.test(x)), "an MOT five months off was sent");
      a.eq(L.gas.mail[0].to, "coord@b.c");
      const was = L.gas.mail.length;
      call(L, "renewalAlerts", ss);
      a.eq(L.gas.mail.length, was, "the same alerts went twice");
    });
  });

  s.test("the sheet writes MOT run authorised on History", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      const ss = L.gas.ss;
      const r = call(L, "applyCoordAction", ss, { id: "m1", kind: "motrun", sunday: "", by: "Bro Arthur", made: Date.now(),
        body: { reg: "YS70 PWE", day: "2026-10-01", logId: "L-x", garage: "Kwik Fit Bootle", time: "10:30" } }, {});
      a.ok(r.ok, JSON.stringify(r));
      const rows = ss.getSheetByName("History").getDataRange().getValues();
      const hit = rows.find((x) => x.indexOf("MOT run authorised") !== -1);
      a.ok(hit, JSON.stringify(rows.slice(-2)));
      a.ok(hit.indexOf("Kwik Fit Bootle at 10:30") !== -1, JSON.stringify(hit));
    });
  });

  return s;
}
