/* THE TRAIL OF WHAT WENT OUT, ON THE COORDINATORS' PHONES.

   From w2.48.0 · v1.108.0 (Asim): each batch sent to passengers or drivers
   puts one notification on every coordinator's phone, saying what went and
   how many it reached, a batch that reached nobody included. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday, seedBookings } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { TABS, tab } from "../lib/tabs.mjs";

const COORD_EP = "https://push.test/coord-arthur";

export default async function (root) {
  const s = new Suite("the coordinators' trail of what went out");
  const G = installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});

  async function fresh(at) {
    G.reset();
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    for (const d of [["Bro Arthur", "Coordinator"], ["Bro Adrian", "Driver"], ["Bro Trevor", "Driver"]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind(d[0], d[1], "North", "x").run();
    }
    await W.cachePut(env, "auth_rules", { roles: ["Coordinator"], sameHandBothWays: true }).run();
    await W.cachePut(env, "passenger_rules",
      { resendMinutes: 3, morningMessage: true, quietFrom: 21, quietTo: 8 }).run();
    await db.prepare(
      "INSERT INTO push_subs (endpoint, p256dh, auth, role, driver, made, app) VALUES (?,?,?,?,?,?,?)")
      .bind(COORD_EP, "p", "a", "driver", "Bro Arthur", Date.now(), "coord").run();
    const key = at ? await atTime(at, () => W.runSunday()) : W.runSunday();
    await seedSunday(db, key);
    return { db, env, key };
  }
  const passenger = (db, stopId) => db.prepare(
    "INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, driver, route, made, seen, fails, last) " +
    "VALUES (?,?,?,?,?,?,?,?,?,0,0,'')")
    .bind("https://push.test/p-" + stopId, "p", "a", "passenger", "dev-" + stopId, "pid-" + stopId,
          "", "", Date.now()).run();
  const trailOf = async (env) => ((await W.cacheGet(env, "calert:" + COORD_EP)) || [])
    .filter((m) => m.kind === "trail");

  s.test("a booking window is one notification, with the count, once", async (a) => {
    const WED = "2026-10-07T18:30:00+01:00";
    const { db, env } = await fresh(WED);
    await passenger(db, "N03"); await passenger(db, "S05");
    await atTime(WED, () => W.wakeBookingReminders(env));
    await atTime("2026-10-07T18:35:00+01:00", () => W.wakeBookingReminders(env));
    const t = await trailOf(env);
    a.eq(t.length, 1, JSON.stringify(t));
    a.eq(t[0].title, "Sent: Booking reminders");
    a.eq(t[0].body, "Book your seat: 2 passenger phones.");
    a.eq((await J(await post(env, { action: "pushwhat", endpoint: COORD_EP }))).title,
         "Sent: Booking reminders", "the coordinator's phone shows it");
  });

  s.test("a booking window that reached nobody still says so", async (a) => {
    const SAT = "2026-10-10T18:30:00+01:00";
    const { env } = await fresh(SAT);
    await atTime(SAT, () => W.wakeBookingReminders(env));
    const t = await trailOf(env);
    a.eq(t.length, 1);
    a.has(t[0].body, "Book your seat: 0 passenger phones.");
  });

  s.test("the Sunday morning reminders: passengers by route, and each driver", async (a) => {
    const SUN = "2026-10-11T07:35:00+01:00";
    const { db, env, key } = await fresh(SUN);
    await seedBookings(db, key, [{ route: "North", stopId: "N03" }]);
    await passenger(db, "N03");
    await post(env, { action: "subscribe", endpoint: "https://push.test/adrian",
                      keys: { p256dh: "p", auth: "a" }, role: "driver", driver: "Bro Adrian",
                      route: "", app: "driver" });
    await atTime(SUN, () => W.wakeDrivers(env));
    await atTime(SUN, () => W.wakeMorning(env));
    await atTime("2026-10-11T07:40:00+01:00", () => W.wakeDrivers(env));
    await atTime("2026-10-11T07:40:00+01:00", () => W.wakeMorning(env));
    const t = await trailOf(env);
    const morn = t.filter((m) => m.title === "Sent: Your bus today");
    a.eq(morn.length, 1, JSON.stringify(t));
    a.eq(morn[0].body, "North: 1 passenger phone. South: 0 passenger phones.");
    const north = t.find((m) => m.title === "Sent: North: You are driving today");
    a.ok(north, JSON.stringify(t));
    a.eq(north.body, "To Bro Adrian: 1 phone.");
    const south = t.find((m) => m.title === "Sent: South: You are driving today");
    a.ok(south, "a driver with no phone is still on the trail");
    a.eq(south.body, "To Bro Trevor: 0 phones.");
    a.eq(t.length, 3);
  });

  s.test("of the live updates, only the critical two reach the coordinators", async (a) => {
    const { db, env, key } = await fresh();
    await seedBookings(db, key, [{ route: "North", stopId: "N05" }, { route: "North", stopId: "N02" },
                                 { route: "North", stopId: "N01" }]);
    await passenger(db, "N05"); await passenger(db, "N02");
    G.reset();
    await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian", reg: "YS70 PWE",
                              sunday: key, events: [{ event: "start", at: Date.now() - 900000 }] });
    a.eq((await trailOf(env)).length, 0, "the bus leaving is the passengers' alone");
    const all = await W.getStops(env);
    const line = W.pickupsAndArrivals(all);
    await W.wakeAfterTap(env, key, "North", all, line, "N03", {});
    await W.wakeAfterTap(env, key, "North", all, line, "N04", { N03: 1 });
    a.ok(G.calls.length >= 3, "the passengers were told");
    const t = await trailOf(env);
    a.eq(t.map((m) => m.title).sort().join(" | "),
         "Sent: North: The bus has gone past Grace Rd | Sent: North: The bus has gone past Scarisbrick Dr",
         "each stop passed once, a booking with no app included; on its way is not sent");
    a.eq(t.find((m) => m.title.indexOf("Grace") !== -1).body, "To 1 passenger phone.");
    a.eq(t.find((m) => m.title.indexOf("Scarisbrick") !== -1).body, "To 0 passenger phones.");
  });

  s.test("no word that the bus has left reaches the coordinators", async (a) => {
    const AT = "2026-10-11T09:59:00+01:00";
    const { db, env, key } = await fresh(AT);
    await seedBookings(db, key, [{ route: "North", stopId: "N03" }]);
    await passenger(db, "N03");
    await atTime(AT, () => W.wakeNotLeft(env));
    await atTime("2026-10-11T10:00:00+01:00", () => W.wakeNotLeft(env));
    const t = (await trailOf(env)).filter((m) => m.title === "Sent: North: No word yet that the bus has left church");
    a.eq(t.length, 1, JSON.stringify(await trailOf(env)));
    a.eq(t[0].body, "To 1 passenger phone.");
  });

  s.test("a coordinator driving is not told of their own reminder", async (a) => {
    const SUN = "2026-10-11T07:35:00+01:00";
    const { db, env, key } = await fresh(SUN);
    await db.prepare("UPDATE rota SET north='Bro Arthur' WHERE sunday=?").bind(key).run();
    await atTime(SUN, () => W.wakeDrivers(env));
    const t = await trailOf(env);
    a.eq(t.filter((m) => m.title.indexOf("North") !== -1).length, 0, JSON.stringify(t));
    a.eq(t.filter((m) => m.title === "Sent: South: You are driving today").length, 1);
  });

  s.test("an email to a driver is on the trail, an email to coordinators is not", async (a) => {
    const { env } = await fresh();
    await post(env, { action: "sentMail", mail: { subject: "Defect reported", to: ["Bro Arthur"] } });
    a.eq((await trailOf(env)).length, 0);
    await post(env, { action: "sentMail",
                      mail: { subject: "Your request was approved", to: ["Bro Trevor"], outward: true } });
    const t = await trailOf(env);
    a.eq(t.length, 1);
    a.eq(t[0].title, "Sent: Your request was approved");
    a.eq(t[0].body, "Email to Bro Trevor.");
  });

  s.test("the duty emails come as one batch, and the action needs the sheet", async (a) => {
    const { env } = await fresh();
    const out = await J(await post(env, { action: "trail", trail: {
      title: "Duty emails", body: "None sent.", once: "mail|duty|x" } }));
    a.ok(out.ok, JSON.stringify(out));
    await post(env, { action: "trail", trail: { title: "Duty emails", body: "None sent.", once: "mail|duty|x" } });
    const t = await trailOf(env);
    a.eq(t.length, 1);
    a.eq(t[0].title, "Sent: Duty emails");
    const env2 = Object.assign({}, env, { SHEET_TOKEN: "secret" });
    a.not((await J(await post(env2, { action: "trail", trail: { title: "x" } }))).ok);
  });

  /* ---- the sheet ---------------------------------------------------------- */

  const sheet = () => {
    const tabs = {
      "Drivers": tab("Drivers", [
        { Name: "Bro Arthur", Role: "Coordinator", Active: "YES", "Primary order": 1, Email: "arthur@b.c", Route: "North" },
        { Name: "Bro Adrian", Role: "Driver", Active: "YES", "Primary order": 2, Email: "adrian@b.c", Route: "North" }]),
      "Bus Stops": [TABS["Bus Stops"]], "Buses": [TABS["Buses"]], "Rota": [TABS["Rota"]],
      "Rota Requests": [TABS["Rota Requests"]], "Checks": [TABS["Checks"]], "Defects": [TABS["Defects"]],
      "Trip Events": [TABS["Trip Events"]], "Bus Bookings": [TABS["Bus Bookings"]]
    };
    const L = loadCodeGs(root, { tabs, props: { PIN_SALT: "salt", WORKER_URL: "https://worker.test",
                                                COORDINATOR_EMAIL: "coord@b.c" } });
    const told = [];
    L.ctx.UrlFetchApp = { fetch(url, o) {
      told.push(JSON.parse(o.payload));
      return { getResponseCode: () => 200, getAllHeaders: () => ({}), getContentText: () => "{\"ok\":true}" };
    } };
    return { L, told };
  };

  s.test("the sheet marks an email to anybody but the coordinators as outward", (a) => {
    const { L, told } = sheet();
    call(L, "sendMail", { to: "coord@b.c", subject: "For coordinators", body: "x" });
    call(L, "sendMail", { to: "adrian@b.c", subject: "For a driver", body: "x" });
    const m = told.filter((t) => t.action === "sentMail").map((t) => t.mail);
    a.eq(m.length, 2);
    a.eq(m[0].outward, false);
    a.eq(m[1].outward, true);
    a.eq(JSON.stringify(m[1].to), JSON.stringify(["Bro Adrian"]));
  });

  s.test("the duty emails reach the trail as one batch", (a) => {
    const { L, told } = sheet();
    call(L, "dutyTrail", ["2026-10-11|2"], { sent: ["Bro Adrian, North Liverpool"], already: [], off: [] },
         ["South Liverpool: nobody on the rota"], ["Bro Adrian"]);
    const t = told.filter((x) => x.action === "trail");
    a.eq(t.length, 1);
    a.eq(t[0].trail.title, "Duty emails");
    a.eq(t[0].trail.body, "Bro Adrian, North Liverpool. South Liverpool: nobody on the rota.");
    a.eq(t[0].trail.once, "");
    call(L, "dutyTrail", ["2026-10-11|2"], { sent: [], already: ["Bro Adrian, North Liverpool"], off: [] }, [], []);
    a.eq(told.filter((x) => x.action === "trail").length, 1, "nothing new went, so nothing on the trail");
    call(L, "dutyTrail", [], { sent: [], already: [], off: [] }, [], []);
    a.eq(told.filter((x) => x.action === "trail").length, 1, "nothing was due");
    call(L, "dutyTrail", ["2026-10-11|2"], { sent: [], already: [], off: [] }, ["Bro Adrian, North Liverpool: no email address"], []);
    const last = told.filter((x) => x.action === "trail").pop();
    a.eq(last.trail.body, "None sent. Bro Adrian, North Liverpool: no email address.");
    a.eq(last.trail.once, "mail|duty|2026-10-11|2");
  });

  return s;
}
