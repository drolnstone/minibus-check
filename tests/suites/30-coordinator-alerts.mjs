/* EVERY COORDINATOR'S PHONE, NOT ONE INBOX.

   Until w2.23.0 / v1.86.0 every alert meant for a coordinator was an email
   to COORDINATOR_EMAIL, and nothing else. A stopped bus on a Sunday morning
   waited on one person reading one inbox. Now each of those emails has a
   phone alert beside it, for everybody holding a coordinator title who has
   alerts on in the driver app.

   The live server's half: who is woken, what they are told, once each, and
   held through the quiet hours unless a bus has been stopped. The sheet's
   half: an alert handed over beside each email, even with no email address
   set at all. */

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
  const s = new Suite("coordinator alerts reach every coordinator's phone");
  const G = installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  async function fresh(roles) {
    G.reset();
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    for (const d of [["Bro Arthur", "Coordinator"], ["Pst Kenneth", "Minister in Charge"],
                     ["Bro Trevor", "Driver"], ["Sis Lead", "Transport Lead"]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind(d[0], d[1], "North", await W.pinHashOf(env, d[0], "1234")).run();
    }
    await W.cachePut(env, "auth_rules",
      { roles: roles || ["Coordinator", "Minister in Charge"], sameHandBothWays: true }).run();
    const sub = (endpoint, role, driver) => db.prepare(
      "INSERT INTO push_subs (endpoint, p256dh, auth, role, driver, made) VALUES (?,?,?,?,?,?)")
      .bind(endpoint, "p", "a", role, driver, Date.now()).run();
    await sub(EP("arthur"), "driver", "Bro Arthur");
    await sub(EP("kenneth"), "driver", "pst kenneth ");          /* typed loosely, still his */
    await sub(EP("trevor"), "driver", "Bro Trevor");
    await sub(EP("lead"), "driver", "Sis Lead");
    await sub(EP("passenger"), "passenger", "");
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const alert = (over) => Object.assign({ id: "a1", kind: "stopped", urgent: true,
    title: "BUS STOPPED: " + REG, body: "Critical defect.", reg: REG }, over || {});
  const pushedTo = () => G.calls.map((c) => c.url).filter((u) => u.indexOf("https://push.test/") === 0).sort();

  /* ---- the live server -------------------------------------------------- */

  s.test("an alert wakes every coordinator's phone, and nobody else's", async (a) => {
    const { env } = await fresh();
    const out = await J(await post(env, { action: "coordAlert", alert: alert() }));
    a.ok(out.ok, JSON.stringify(out));
    a.eq(JSON.stringify(pushedTo()), JSON.stringify([EP("arthur"), EP("kenneth")].sort()));
  });

  s.test("whoever the alert is about is left out", async (a) => {
    const { env } = await fresh();
    await J(await post(env, { action: "coordAlert", alert: alert({ not: ["BRO ARTHUR"] }) }));
    a.eq(JSON.stringify(pushedTo()), JSON.stringify([EP("kenneth")]));
  });

  s.test("the titles are COORDINATOR_ROLES: a church's own title is who is woken", async (a) => {
    const { env } = await fresh(["Transport Lead"]);
    await J(await post(env, { action: "coordAlert", alert: alert() }));
    a.eq(JSON.stringify(pushedTo()), JSON.stringify([EP("lead")]));
  });

  s.test("the same alert twice wakes nobody the second time", async (a) => {
    const { env } = await fresh();
    await post(env, { action: "coordAlert", alert: alert() });
    G.reset();
    const out = await J(await post(env, { action: "coordAlert", alert: alert() }));
    a.ok(out.duplicate);
    a.eq(pushedTo().length, 0);
  });

  s.test("it needs the token, like the sync", async (a) => {
    const { env } = await fresh();
    const out = await J(await W.default.fetch(new Request("https://worker.test/", {
      method: "POST", body: JSON.stringify({ action: "coordAlert", alert: alert() }) }), env, {}));
    a.eq(out.error, "bad token");
    a.eq(pushedTo().length, 0);
  });

  s.test("the phone is told the alert, opens the coordinator's app, and then hears the ordinary answer", async (a) => {
    const { env } = await fresh();
    /* At a daytime hour: the rota request is not urgent, and in the quiet
       hours it would rightly be held for the morning (the test below). Run
       on the real clock this passed by day and failed after nine at night. */
    let one, two, three;
    await atTime("2026-10-07T14:00:00+01:00", async () => {
      await post(env, { action: "coordAlert", alert: alert() });
      await post(env, { action: "coordAlert", alert: alert({ id: "a2", kind: "request", urgent: false,
        title: "Rota request from Bro Trevor", body: "Cover for Sunday.", reg: "" }) });
      one = await W.pushWhat(env, EP("kenneth"));
      two = await W.pushWhat(env, EP("kenneth"));
      three = await W.pushWhat(env, EP("kenneth"));
    });
    a.eq(one.title, "BUS STOPPED: " + REG);
    a.eq(one.url, "coord/");
    a.eq(two.title, "Rota request from Bro Trevor", "the second alert was lost behind the first");
    a.ok(three.title !== one.title && three.title !== two.title, "an alert was handed out twice");
  });

  s.test("a stopped bus authorised since says so when the phone reads it", async (a) => {
    const { env } = await fresh();
    await W.handleCheck(env, { id: "chk-9", reg: REG, level: "stop", driver: "Bro Trevor", age: 0 });
    await post(env, { action: "coordAlert", alert: alert() });
    const r = await J(await W.handleAuthorise(env, { authorise: { reg: REG, who: "Bro Arthur", pin: "1234" } }));
    a.ok(r.ok, JSON.stringify(r));
    const told = await W.pushWhat(env, EP("kenneth"));
    a.eq(told.title, REG + " is authorised to run");
    a.has(told.body, "Bro Arthur");
  });

  s.test("a coordinator alert does not touch the driver's own alert record", async (a) => {
    const { db, env } = await fresh();
    await db.prepare("UPDATE push_subs SET last='stopped|x|y' WHERE endpoint=?").bind(EP("arthur")).run();
    await post(env, { action: "coordAlert", alert: alert() });
    a.eq(db._one("SELECT last FROM push_subs WHERE endpoint=?", EP("arthur")).last, "stopped|x|y",
         "his driver alert would be sent again on the next sweep");
  });

  s.test("in the quiet hours a stopped bus goes at once and anything else waits for the morning", async (a) => {
    const { env } = await fresh();
    await atTime("2026-10-07T23:10:00+01:00", async () => {
      await post(env, { action: "coordAlert", alert: alert({ id: "night-req", kind: "request", urgent: false,
        title: "Rota request from Bro Trevor", reg: "" }) });
      a.eq(pushedTo().length, 0, "a rota request woke a coordinator at ten past eleven at night");
      await post(env, { action: "coordAlert", alert: alert({ id: "night-stop" }) });
      a.eq(pushedTo().length, 2, "a stopped bus was held until the morning");
    });
    G.reset();
    await atTime("2026-10-08T07:30:00+01:00", () => W.clockTick(env));
    a.eq(pushedTo().filter((u) => u !== EP("trevor")).length, 0, "released before 08:00");
    await atTime("2026-10-08T08:01:00+01:00", () => W.clockTick(env));
    a.eq(JSON.stringify(pushedTo().filter((u) => u !== EP("trevor"))), JSON.stringify([EP("arthur"), EP("kenneth")].sort()));
    G.reset();
    await atTime("2026-10-08T08:02:00+01:00", () => W.clockTick(env));
    a.eq(pushedTo().filter((u) => u !== EP("trevor")).length, 0, "the held alert went twice");
  });

  /* ---- the sheet -------------------------------------------------------- */

  const SUN = new Date(2026, 9, 4);
  function sheet(props) {
    const tabs = {
      "Bus Stops": tab("Bus Stops", [
        { Route: "North", "Stop ID": "N00", Time: "09:52", Stop: "Church", Postcode: "L6 4DY", Active: "YES", Type: "Depart" }]),
      "Drivers": tab("Drivers", [
        { Name: "Bro Arthur", Role: "Coordinator", Active: "YES", "Primary order": 1, PIN: "1234", Email: "arthur@b.c", Route: "North" },
        { Name: "Bro Trevor", Role: "Driver", Active: "YES", "Primary order": 2, PIN: "4321", Email: "t@b.c", Route: "South" }]),
      "Buses": tab("Buses", [{ Registration: REG, "Seats for passengers": 16, Active: "YES" }]),
      "Rota": tab("Rota", [{ Sunday: SUN, "North Liverpool scheduled": "Bro Arthur", Status: "Confirmed",
        "South Liverpool scheduled": "Bro Trevor" }]),
      "Rota Requests": [TABS["Rota Requests"]],
      "Checks": [TABS["Checks"]], "Defects": [TABS["Defects"]], "Trip Events": [TABS["Trip Events"]],
      "Bus Bookings": [TABS["Bus Bookings"]]
    };
    const L = loadCodeGs(root, { tabs, props: Object.assign({ PIN_SALT: "salt", WORKER_URL: "https://worker.test" }, props || {}) });
    const sent = [];
    L.ctx.UrlFetchApp = { fetch(url, opts) {
      const body = JSON.parse((opts && opts.payload) || "{}");
      sent.push(body);
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true }), getAllHeaders: () => ({}) };
    } };
    return { L, alerts: () => sent.filter((b) => b.action === "coordAlert").map((b) => b.alert) };
  }
  const CHECK = { id: "chk-1", reg: REG, vehicle: "Ford Transit", driver: "Bro Trevor", role: "Driver",
                  date: "4 October 2026", time: "09:40", miles: 48213, sign: "Bro Trevor",
                  advisories: [], jobs: [] };

  s.test("the sheet's five cases each become a short phone alert, a stopped bus the only urgent one", (a) => {
    const { L } = sheet();
    const one = (c, outcome, text) => call(L, "checkPhoneAlert", Object.assign({}, CHECK, c), outcome, text);
    const stop = one({ level: "stop", defects: [{ name: "Tyres", crit: true }] }, "Stopped", "Tyres: bald");
    a.eq(stop.kind, "stopped"); a.ok(stop.urgent); a.has(stop.title, REG); a.has(stop.body, "Tyres");
    a.eq(JSON.stringify(stop.not), JSON.stringify(["Bro Trevor"]));
    const auth = one({ level: "stop", authorisedBy: "Bro Arthur" }, "Authorised to run", "Tyres");
    a.eq(auth.kind, "authorised"); a.not(auth.urgent);
    a.eq(one({ level: "warn" }, "Defects", "Wiper split").kind, "defect");
    a.eq(one({ level: "ok", advisories: [{ name: "Tyres" }] }, "Advisory", "").kind, "advisory");
    a.eq(one({ level: "ok", jobs: ["Fuel"] }, "Clear", "").kind, "arrange");
  });

  s.test("with no COORDINATOR_EMAIL at all, the phones are still told", (a) => {
    const { L, alerts } = sheet();
    call(L, "notifyAuthorised", { reg: REG, by: "Bro Arthur", at: 123, inspector: "Bro Trevor" });
    a.eq(L.gas.mail.length, 0);
    a.eq(alerts().length, 1);
    a.eq(alerts()[0].kind, "authorised");
    a.eq(JSON.stringify(alerts()[0].not), JSON.stringify(["Bro Arthur"]));
  });

  s.test("a rota request from the drain tells the phones as well as the inbox", async (a) => {
    /* On the Saturday before SUN, so the Sunday is still to come. */
    await atTime("2026-10-03T12:00:00+01:00", () => {
      const { L, alerts } = sheet({ COORDINATOR_EMAIL: "coord@b.c" });
      L.ctx.UrlFetchApp = { fetch(url, opts) {
        const body = JSON.parse((opts && opts.payload) || "{}");
        (L._sent = L._sent || []).push(body);
        const out = body.action === "drain"
          ? { ok: true, claim: -9, bookings: [], trips: [], checks: [], auths: [], decisions: [],
              requests: [{ id: "rq1", date: "2026-10-04", driver: "Bro Trevor", type: "Request cover",
                           reason: "Away", swapWith: "", swapDate: "", agreed: false }] }
          : { ok: true };
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(out), getAllHeaders: () => ({}) };
      } };
      call(L, "drainFromWorker");
      const got = (L._sent || []).filter((b) => b.action === "coordAlert").map((b) => b.alert);
      a.eq(got.length, 1, "no phone alert for the request");
      a.eq(got[0].kind, "request");
      a.has(got[0].title, "Bro Trevor");
      a.hasnt(got[0].body, "Away", "the reason went to a phone that joined the list without a PIN");
      a.ok(L.gas.mail.some((m) => String(m.to).indexOf("coord@") === 0), "the email stopped");
      void alerts;
    });
  });

  s.test("with SENDER_NAME set, every email says it is from that name, and replies go to the coordinator", (a) => {
    const { L } = sheet({ COORDINATOR_EMAIL: "coord@b.c", SENDER_NAME: " Dominion Transport " });
    call(L, "sendTestEmail");
    call(L, "notifyAuthorised", { reg: REG, by: "Bro Arthur", at: 1, inspector: "Bro Trevor" });
    a.eq(L.gas.mail.length, 2);
    for (const m of L.gas.mail) {
      a.eq(m.name, "Dominion Transport");
      a.eq(m.replyTo, "coord@b.c");
    }
  });

  s.test("with no SENDER_NAME, the emails are as they were", (a) => {
    const { L } = sheet({ COORDINATOR_EMAIL: "coord@b.c" });
    call(L, "sendTestEmail");
    a.eq(L.gas.mail[0].name, undefined);
    a.eq(L.gas.mail[0].to, "coord@b.c");
  });

  /* ---- where the live server knocks ------------------------------------ */

  const HERE = "https://script.google.com/macros/s/AKfyHEREabc123/exec";
  const ELSEWHERE = "https://script.google.com/macros/s/AKfyOLDxyz789/exec";
  const liveReport = (props, knockTo) => {
    const { L } = sheet(props);
    L.ctx.UrlFetchApp = { fetch() {
      return { getResponseCode: () => 200, getAllHeaders: () => ({}),
        getContentText: () => JSON.stringify({ ok: true, bookings: [], trips: [], clockAgoSec: 10,
          poke: { agoSec: 60, ok: false }, cacheAgeMin: { rota: 5, last: 5 }, pinSalt: true, knockTo }) };
    } };
    call(L, "liveCheck");
    const al = L.gas.logs.filter((x) => x[0] === "alert").pop();
    return al ? al.slice(1).join("\n") : "";
  };

  s.test("WEB_APP_URL is the address the sheet sends, when it is a web app address", (a) => {
    a.eq(call(sheet({ WEB_APP_URL: HERE }).L, "sheetReturnUrl"), HERE);
    a.not(call(sheet({ WEB_APP_URL: "https://example.com/x" }).L, "sheetReturnUrl") === "https://example.com/x");
  });

  s.test("the live-server report says when it is knocking on another deployment", (a) => {
    const text = liveReport({ WEB_APP_URL: HERE }, ELSEWHERE);
    a.has(text, "knocks on the web app ending \u2026xyz789");
    a.has(text, "deployed at the one ending \u2026abc123");
  });

  s.test("and names the address when it is the same one, so it can be compared by eye", (a) => {
    const text = liveReport({ WEB_APP_URL: HERE }, HERE);
    a.has(text, "It knocks on the web app ending \u2026abc123");
    a.has(text, "Who has access: Anyone");
  });

  s.test("the menu's test email tests the phones too", (a) => {
    const { L, alerts } = sheet({ COORDINATOR_EMAIL: "coord@b.c" });
    call(L, "sendTestEmail");
    a.eq(alerts().length, 1);
    a.ok(alerts()[0].urgent, "a test at night would be held until the morning");
  });

  return s;
}
