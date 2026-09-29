/* ROTA REQUESTS GO TO THE LIVE SERVER FIRST.

   The first stage of the coordinator's app: a driver's swap or cover
   request was the last thing a phone wrote that went to Apps Script first.
   From w2.17.0 / v1.81.0 / v1.76.0 it is taken by the Worker, knocks, and is
   filed on the Rota Requests tab by the same function as before.

   Every check here fails on w2.16.0 / v1.80.0. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { TABS, tab } from "../lib/tabs.mjs";

const KEY = "2026-10-04";
const SAT = "2026-09-26T11:00:00+01:00";
const SHEET = "https://script.google.com/macros/s/TEST/exec";

export default async function (root) {
  const s = new Suite("rota requests reach the live server first");
  const net = installGlobals();
  const { mod } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    return { db, env };
  }
  const setting = (db, k, v) =>
    db.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
      .bind(k, JSON.stringify(v)).run();
  const ask = (over) => Object.assign({ id: "rq1", date: KEY, driver: "Bro Tunde",
    type: "Request cover", reason: "Away that weekend", swapWith: "", swapDate: "", agreed: false }, over || {});
  const post = (env, ctx, body) => mod.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, ctx);

  s.test("a request from a phone is taken by the live server and knocks on the sheet's door", async (a) => {
    await atTime(SAT, async () => {
      const { db, env } = await fresh();
      await setting(db, "sheet_url", { url: SHEET });
      net.reset();
      const waits = [];
      const out = await J(await post(env, { waitUntil: (p) => waits.push(p) },
                                     { action: "rotaRequest", request: ask() }));
      a.ok(out.ok, "the live server refused a good request: " + JSON.stringify(out));
      a.eq(waits.length, 1, "the sheet was not asked to collect it");
      await Promise.all(waits);
      const d = await J(await mod.handleDrain(env, { limit: 300 }));
      a.eq((d.requests || []).length, 1, "the drain does not carry it");
      a.eq(d.requests[0].id, "rq1");
      a.eq(d.requests[0].reason, "Away that weekend");
    });
  });

  s.test("the same request sent twice is one request", async (a) => {
    await atTime(SAT, async () => {
      const { db, env } = await fresh();
      await J(await mod.handleRotaRequest(env, ask()));
      const again = await J(await mod.handleRotaRequest(env, ask()));
      a.ok(again.ok && again.duplicate);
      const n = await db.prepare("SELECT COUNT(*) AS n FROM requests").first();
      a.eq(Number(n.n), 1);
    });
  });

  s.test("a request for a Sunday that has passed is refused", async (a) => {
    await atTime(SAT, async () => {
      const { env } = await fresh();
      const out = await J(await mod.handleRotaRequest(env, ask({ date: "2026-09-20" })));
      a.not(out.ok);
    });
  });

  s.test("a request is marked done only with the drain's stamp", async (a) => {
    await atTime(SAT, async () => {
      const { env } = await fresh();
      await mod.handleRotaRequest(env, ask());
      const d = await J(await mod.handleDrain(env, { limit: 300 }));
      await mod.handleDrained(env, { claim: d.claim, requests: ["rq1"] });
      const again = await J(await mod.handleDrain(env, { limit: 300 }));
      a.eq((again.requests || []).length, 0, "a filed request came round again");
    });
  });

  s.test("the rota on the live server shows a request the sheet has not filed yet", async (a) => {
    await atTime(SAT, async () => {
      const { db, env } = await fresh();
      await setting(db, "cache_rota", { builtAt: Date.now() - 60000, from: "2026-09-20", to: "2027-09-20",
        payload: { ok: true, rows: [
          { date: KEY, primary: "Bro Adebola", actual: "Bro Adebola", status: "Confirmed",
            primary2: "Bro Tunde", actual2: "Bro Tunde" },
          { date: "2026-10-11", primary: "Bro Moses", status: "North cancelled", primary2: "Bro Adesina" }] } });
      await mod.handleRotaRequest(env, ask());
      await mod.handleRotaRequest(env, ask({ id: "rq2", date: "2026-10-11", driver: "Bro Adesina" }));
      const r = await mod.cachedRota(env, "2026-09-27", 4);
      a.ok(r.ok);
      const row = r.rows.find((x) => x.date === KEY);
      a.ok((row.requests || []).some((x) => x.driver === "Bro Tunde" && x.status === "Pending"),
           "the driver's own rota screen would show no request, and he could ask twice");
      a.eq(row.status, "Change requested");
      const off = r.rows.find((x) => x.date === "2026-10-11");
      a.eq(off.status, "North cancelled", "a request put a called-off route back on");
    });
  });

  /* ------------------------------------------------ the sheet's side */

  const SUN = new Date(2026, 9, 4);
  function sheet(status) {
    const tabs = {
      "Bus Stops": tab("Bus Stops", [
        { Route: "South", "Stop ID": "S03", Time: "10:37", Stop: "Sedley Street", Postcode: "L4 2RB", Active: "YES", Type: "Pickup" }]),
      "Drivers": tab("Drivers", [
        { Name: "Bro Asim", Role: "Coordinator", Active: "YES", "Primary order": 1, PIN: "1234", Email: "asim@b.c", Route: "North" },
        { Name: "Bro Tunde", Role: "Driver", Active: "YES", "Primary order": 2, PIN: "4321", Email: "t@b.c", Route: "South" }]),
      "Buses": tab("Buses", [{ Registration: "YS70 PWE", "Seats for passengers": 16, Active: "YES" }]),
      "Rota": tab("Rota", [{ Sunday: SUN, "North Liverpool scheduled": "Bro Asim", Status: status || "Confirmed",
        "South Liverpool scheduled": "Bro Tunde" }]),
      "Rota Requests": [TABS["Rota Requests"]],
      "Checks": [TABS["Checks"]], "Defects": [TABS["Defects"]], "Trip Events": [TABS["Trip Events"]],
      "Bus Bookings": [TABS["Bus Bookings"]]
    };
    return loadCodeGs(root, { tabs, props: { COORDINATOR_EMAIL: "coord@b.c", PIN_SALT: "salt",
                                             WORKER_URL: "https://worker.test" } });
  }
  function worker(L, answers) {
    const sent = [];
    L.ctx.UrlFetchApp = { fetch(url, opts) {
      const body = JSON.parse((opts && opts.payload) || "{}");
      sent.push(body);
      const fn = answers[body.action];
      const out = typeof fn === "function" ? fn(body) : (fn || { ok: true });
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(out), getAllHeaders: () => ({}) };
    } };
    return sent;
  }
  const drainWith = (reqs) => ({ ok: true, claim: -9, bookings: [], trips: [], checks: [], auths: [],
                                 decisions: [], requests: reqs });

  s.test("the drain files a live-server request on the tab, tells the coordinator, and reports it done", (a) => {
    const L = sheet();
    const sent = worker(L, { drain: drainWith([ask()]) });
    call(L, "drainFromWorker");
    const rsh = L.gas.ss.getSheetByName("Rota Requests");
    a.eq(rsh.getLastRow(), 2, "no row on the Rota Requests tab");
    a.eq(rsh.getRange(2, TABS["Rota Requests"].indexOf("Request ID") + 1).getValue(), "rq1");
    a.ok(L.gas.mail.some((m) => String(m.to).indexOf("coord@") === 0), "the coordinator was not told");
    const done = sent.find((b) => b.action === "drained");
    a.ok(done && (done.requests || []).indexOf("rq1") > -1, "the request was not reported done");
    a.eq(done.claim, -9);
  });

  s.test("a request the tab already holds is reported done without a second row", (a) => {
    const L = sheet();
    const sent = worker(L, { drain: drainWith([ask()]) });
    call(L, "drainFromWorker");
    call(L, "drainFromWorker");
    const rsh = L.gas.ss.getSheetByName("Rota Requests");
    a.eq(rsh.getLastRow(), 2, "the same request was filed twice");
    const dones = sent.filter((b) => b.action === "drained");
    a.eq(dones.length, 2);
    a.ok((dones[1].requests || []).indexOf("rq1") > -1);
  });

  s.test("a request on a Sunday that has been called off leaves the Status as it is", (a) => {
    const L = sheet("North cancelled");
    worker(L, {});
    /* The same function, whichever way the request arrived. */
    call(L, "handleRotaRequest", ask());
    /* By date: the push after filing fills the rota ahead, which can put
       other Sundays above this one. */
    const rota = L.gas.ss.getSheetByName("Rota");
    const at = call(L, "findRotaRow", rota, KEY);
    a.ok(at > 0);
    a.eq(rota.getRange(at, TABS["Rota"].indexOf("Status") + 1).getValue(), "North cancelled",
         "the request put the North route back on for the passengers");
  });

  return s;
}
