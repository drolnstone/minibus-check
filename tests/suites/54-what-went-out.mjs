/* WHAT WENT OUT, ON THE ALERTS LIST.

   From v1.98.0 · w2.45.0 · v1.105.0 (Asim): every alert a passenger's or a
   driver's phone is sent, and every email the sheet sends, listed on the
   coordinator app's Alerts screen as it goes. One line per message; never
   unread, so never on the bell's count. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { TABS, tab } from "../lib/tabs.mjs";

const EP = (x) => "https://push.test/" + x;

export default async function (root) {
  const s = new Suite("what went out, on the Alerts list");
  const G = installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const coord = (env, who, op, extra) => post(env, Object.assign({ action: "coord", who, pin: "1234", op }, extra || {}));

  async function fresh() {
    G.reset();
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    for (const d of [["Bro Arthur", "Coordinator"], ["Bro Trevor", "Driver"]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind(d[0], d[1], "North", await W.pinHashOf(env, d[0], "1234")).run();
    }
    await W.cachePut(env, "auth_rules", { roles: ["Coordinator"], sameHandBothWays: true }).run();
    return { db, env };
  }
  const passenger = (db, ep) => db.prepare(
    "INSERT INTO push_subs (endpoint, p256dh, auth, role, made) VALUES (?,?,?,?,?)")
    .bind(EP(ep), "p", "a", "passenger", Date.now()).run();
  const sent = (out) => out.alerts.list.filter((m) => m.kind === "sent");

  s.test("passenger pushes are one line, with the phones and stops, and never unread", async (a) => {
    const { db, env } = await fresh();
    await passenger(db, "p1"); await passenger(db, "p2"); await passenger(db, "p3");
    const subs = (await db.prepare("SELECT * FROM push_subs ORDER BY id").all()).results;
    await W.wake(env, [subs[0], subs[1]], "left|2026-10-04|North", { route: "North", stop: "Hannan Road" });
    await W.wake(env, [subs[2]], "left|2026-10-04|North", { route: "North", stop: "Ottley Street" });
    await W.wake(env, [subs[2]], "left|2026-10-04|North", { route: "North", stop: "Ottley Street" });
    const k = await J(await coord(env, "Bro Arthur", "load"));
    const lines = sent(k);
    a.eq(lines.length, 1, JSON.stringify(lines));
    a.eq(lines[0].title, "North: The bus has left church");
    a.eq(lines[0].body, "To 3 passenger phones: Hannan Road, Ottley Street.");
    a.not(lines[0].unread);
    a.eq(k.alerts.unread, 0);
  });

  s.test("a phone the push service refused is not listed", async (a) => {
    const { db, env } = await fresh();
    await passenger(db, "gone");
    G.reply(new Response("", { status: 410 }));
    const subs = (await db.prepare("SELECT * FROM push_subs").all()).results;
    await W.wake(env, subs, "left|2026-10-04|North", { route: "North", stop: "Hannan Road" });
    a.eq(sent(await J(await coord(env, "Bro Arthur", "load"))).length, 0);
  });

  s.test("a driver's reminder names the driver", async (a) => {
    await atTime("2026-09-27T07:45:00+01:00", async () => {
      const { db, env } = await fresh();
      await seedSunday(db, W.runSunday(), {});
      await post(env, { action: "subscribe", endpoint: EP("drv"), keys: { p256dh: "p", auth: "a" },
                        role: "driver", driver: "Bro Adrian", route: "", app: "driver" });
      await W.wakeDrivers(env);
      const lines = sent(await J(await coord(env, "Bro Arthur", "load")));
      const mine = lines.find((m) => m.body === "To Bro Adrian.");
      a.ok(mine, JSON.stringify(lines));
      a.has(mine.title, "You are driving today");
    });
  });

  s.test("an email the sheet sent is listed, and the action needs the sheet", async (a) => {
    const { env } = await fresh();
    const ok = await J(await post(env, { action: "sentMail",
      mail: { subject: "You are driving on Sunday", to: ["Bro Trevor"] } }));
    a.ok(ok.ok, JSON.stringify(ok));
    await post(env, { action: "sentMail", mail: { subject: "You are driving on Sunday", to: ["Bro Adrian"] } });
    const lines = sent(await J(await coord(env, "Bro Arthur", "load")));
    a.eq(lines.length, 1);
    a.ok(lines[0].mail);
    a.eq(lines[0].body, "Email to Bro Trevor, Bro Adrian.");
    const env2 = Object.assign({}, env, { SHEET_TOKEN: "secret" });
    const no = await J(await post(env2, { action: "sentMail", mail: { subject: "x", to: [] } }));
    a.not(no.ok);
  });

  s.test("the sheet tells the server each email it sends, by name", (a) => {
    const tabs = {
      "Drivers": tab("Drivers", [
        { Name: "Bro Arthur", Role: "Coordinator", Active: "YES", "Primary order": 1, Email: "coord@b.c", Route: "North" }]),
      "Bus Stops": [TABS["Bus Stops"]], "Buses": [TABS["Buses"]], "Rota": [TABS["Rota"]],
      "Rota Requests": [TABS["Rota Requests"]], "Checks": [TABS["Checks"]], "Defects": [TABS["Defects"]],
      "Trip Events": [TABS["Trip Events"]], "Bus Bookings": [TABS["Bus Bookings"]]
    };
    const L = loadCodeGs(root, { tabs, props: { PIN_SALT: "salt", WORKER_URL: "https://worker.test" } });
    const told = [];
    L.ctx.UrlFetchApp = { fetch(url, o) {
      told.push(JSON.parse(o.payload));
      return { getResponseCode: () => 200, getAllHeaders: () => ({}), getContentText: () => "{\"ok\":true}" };
    } };
    call(L, "sendMail", { to: "coord@b.c, other@x.y", subject: "Hello", body: "Hi" });
    a.eq(L.gas.mail.length, 1);
    const m = told.find((t) => t.action === "sentMail");
    a.ok(m, JSON.stringify(told));
    a.eq(JSON.stringify(m.mail), JSON.stringify({ subject: "Hello", to: ["Bro Arthur", "other@x.y"] }));
  });

  return s;
}
