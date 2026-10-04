/* COORDINATOR ALERTS, LISTED, COUNTED AND EMAILED. From v1.96.6 · w2.40.0 ·
   v1.104.0, after the Ushers app's PR #18.

   The live server keeps the last two days of coordinator alerts and when
   each coordinator last opened Alerts, so the coordinator's app can show an
   unread count and a list. It answers each new alert with the coordinators
   it could not wake, and the sheet emails them. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { atTime } from "../lib/clock.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { TABS, tab } from "../lib/tabs.mjs";

const REG = "YS70 PWE";
const EP = (who) => "https://push.test/" + who;

export default async function (root) {
  const s = new Suite("coordinator alerts listed, counted and emailed");
  const G = installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  async function fresh() {
    G.reset();
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    for (const d of [["Bro Arthur", "Coordinator"], ["Pst Kenneth", "Minister in Charge"],
                     ["Bro Trevor", "Driver"]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind(d[0], d[1], "North", await W.pinHashOf(env, d[0], "1234")).run();
    }
    await W.cachePut(env, "auth_rules", { roles: ["Coordinator", "Minister in Charge"], sameHandBothWays: true }).run();
    /* Bro Arthur has alerts on; Pst Kenneth has none on any phone. */
    await db.prepare("INSERT INTO push_subs (endpoint, p256dh, auth, role, driver, made) VALUES (?,?,?,?,?,?)")
      .bind(EP("arthur"), "p", "a", "driver", "Bro Arthur", Date.now()).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const coord = (env, who, op, extra) => post(env, Object.assign({ action: "coord", who, pin: "1234", op }, extra || {}));
  const alert = (over) => Object.assign({ id: "a1", kind: "stopped", urgent: true,
    title: "BUS STOPPED: " + REG, body: "Critical defect.", reg: REG }, over || {});

  s.test("the server names the coordinators it could not wake, once, and never whoever it is about", async (a) => {
    const { env } = await fresh();
    const one = await J(await post(env, { action: "coordAlert", alert: alert() }));
    a.eq(JSON.stringify(one.unalerted), JSON.stringify(["Pst Kenneth"]));
    const again = await J(await post(env, { action: "coordAlert", alert: alert() }));
    a.ok(again.duplicate); a.eq(again.unalerted, undefined, "the same alert would be emailed twice");
    const about = await J(await post(env, { action: "coordAlert", alert: alert({ id: "a2", not: ["pst kenneth"] }) }));
    a.eq(JSON.stringify(about.unalerted), "[]");
    const test = await J(await post(env, { action: "coordAlert", alert: alert({ id: "a3", kind: "test" }) }));
    a.eq(JSON.stringify(test.unalerted), "[]", "the menu's test would email people");
  });

  s.test("a held alert in the quiet hours still names them", async (a) => {
    const { env } = await fresh();
    await atTime("2026-10-07T23:10:00+01:00", async () => {
      const out = await J(await post(env, { action: "coordAlert",
        alert: alert({ id: "n1", kind: "request", urgent: false, title: "Rota request from Bro Trevor", reg: "" }) }));
      a.ok(out.held);
      a.eq(JSON.stringify(out.unalerted), JSON.stringify(["Pst Kenneth"]));
    });
  });

  s.test("every load carries the unread count and the list, newest first", async (a) => {
    const { env } = await fresh();
    await post(env, { action: "coordAlert", alert: alert() });
    await new Promise((r) => setTimeout(r, 5));
    await post(env, { action: "coordAlert", alert: alert({ id: "a2", kind: "authorised", urgent: false,
      title: "Authorised to run: " + REG, not: ["Bro Arthur"] }) });
    await post(env, { action: "coordAlert", alert: alert({ id: "t1", kind: "test" }) });
    const k = await J(await coord(env, "Pst Kenneth", "load"));
    a.ok(k.ok, JSON.stringify(k).slice(0, 200));
    a.eq(k.alerts.unread, 2);
    a.eq(k.alerts.list[0].title, "Authorised to run: " + REG);
    a.ok(k.alerts.list.every((m) => m.kind !== "test"), "the test alert was listed");
    const ar = await J(await coord(env, "Bro Arthur", "load"));
    a.eq(ar.alerts.unread, 1, "Bro Arthur was counted an alert about himself");
  });

  s.test("opening Alerts reads them, for that coordinator only, and a new one counts again", async (a) => {
    const { env } = await fresh();
    await post(env, { action: "coordAlert", alert: alert() });
    const read = await J(await coord(env, "Pst Kenneth", "alerts", { read: true }));
    a.eq(read.alerts.unread, 0);
    a.eq((await J(await coord(env, "Bro Arthur", "load"))).alerts.unread, 1);
    await new Promise((r) => setTimeout(r, 5));
    await post(env, { action: "coordAlert", alert: alert({ id: "a9" }) });
    a.eq((await J(await coord(env, "Pst Kenneth", "load"))).alerts.unread, 1);
  });

  s.test("the list needs the PIN", async (a) => {
    const { env } = await fresh();
    const out = await J(await post(env, { action: "coord", who: "Pst Kenneth", pin: "9999", op: "alerts" }));
    a.not(out.ok); a.eq(out.alerts, undefined);
  });

  s.test("the phone is told the unread count with the alert, for the icon", async (a) => {
    const { env } = await fresh();
    await post(env, { action: "coordAlert", alert: alert() });
    const told = await W.pushWhat(env, EP("arthur"));
    a.eq(told.url, "coord/");
    a.eq(told.unread, 1);
  });

  s.test("only the last two days are kept", async (a) => {
    const { env } = await fresh();
    await atTime("2026-10-01T10:00:00+01:00", () => post(env, { action: "coordAlert", alert: alert({ id: "old" }) }));
    await post(env, { action: "coordAlert", alert: alert({ id: "new" }) });
    const k = await J(await coord(env, "Pst Kenneth", "load"));
    a.eq(k.alerts.list.length, 1);
  });

  /* ---- the sheet -------------------------------------------------------- */

  function sheet(props, unalerted) {
    const tabs = {
      "Drivers": tab("Drivers", [
        { Name: "Bro Arthur", Role: "Coordinator", Active: "YES", "Primary order": 1, Email: "coord@b.c", Route: "North" },
        { Name: "Pst Kenneth", Role: "Minister in Charge", Active: "YES", "Primary order": 2, Email: "kenneth@b.c", Route: "North" },
        { Name: "Sis Nomail", Role: "Coordinator", Active: "YES", "Primary order": 3, Email: "", Route: "North" }]),
      "Bus Stops": [TABS["Bus Stops"]], "Buses": [TABS["Buses"]], "Rota": [TABS["Rota"]],
      "Rota Requests": [TABS["Rota Requests"]], "Checks": [TABS["Checks"]], "Defects": [TABS["Defects"]],
      "Trip Events": [TABS["Trip Events"]], "Bus Bookings": [TABS["Bus Bookings"]]
    };
    const L = loadCodeGs(root, { tabs, props: Object.assign({ PIN_SALT: "salt", WORKER_URL: "https://worker.test" }, props || {}) });
    L.ctx.UrlFetchApp = { fetch() {
      return { getResponseCode: () => 200, getAllHeaders: () => ({}),
               getContentText: () => JSON.stringify({ ok: true, sent: 0, unalerted }) };
    } };
    return L;
  }

  s.test("the sheet emails each coordinator the server could not wake, but not COORDINATOR_EMAIL again", (a) => {
    const L = sheet({ COORDINATOR_EMAIL: "coord@b.c" }, ["Bro Arthur", "Pst Kenneth", "Sis Nomail"]);
    call(L, "tellCoordinatorPhones", alert());
    a.eq(L.gas.mail.length, 1, JSON.stringify(L.gas.mail.map((m) => m.to)));
    a.eq(L.gas.mail[0].to, "kenneth@b.c");
    a.eq(L.gas.mail[0].subject, "BUS STOPPED: " + REG);
    a.has(L.gas.mail[0].body, "tap the bell");
  });

  s.test("a COORDINATOR_EMAIL listing several addresses skips each of them", (a) => {
    const L = sheet({ COORDINATOR_EMAIL: "coord@b.c, Kenneth@b.c; x@y.z" }, ["Bro Arthur", "Pst Kenneth", "Sis Nomail"]);
    call(L, "tellCoordinatorPhones", alert());
    a.eq(L.gas.mail.length, 0, JSON.stringify(L.gas.mail.map((m) => m.to)));
  });

  s.test("nobody is emailed when everyone has alerts on", (a) => {
    const L = sheet({ COORDINATOR_EMAIL: "coord@b.c" }, []);
    call(L, "tellCoordinatorPhones", alert());
    a.eq(L.gas.mail.length, 0);
  });

  return s;
}
