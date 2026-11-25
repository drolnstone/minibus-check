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

  /* RECEIPTS WAKE NOBODY, from w2.114.0 (Asim, 25 Nov 2026): a "Sent:"
     line stays on What went out; no coordinator phone is woken for it. */
  s.test("booking reminders: on What went out, no coordinator notice", async (a) => {
    const WED = "2026-10-07T18:30:00+01:00";
    const { db, env } = await fresh(WED);
    await passenger(db, "N03"); await passenger(db, "S05");
    await atTime(WED, () => W.wakeBookingReminders(env));
    a.eq((await trailOf(env)).length, 0, "a coordinator phone was woken for a receipt");
    const line = (await atTime(WED, () => W.sentList(env))).find((m) => m.title === "Book your seat(s) for Sunday");
    a.ok(line, "the line on What went out is gone");
    a.eq(line.body, "To 2 passenger phones.");
  });

  s.test("the Sunday morning reminders and each driver's: no coordinator notice", async (a) => {
    const SUN = "2026-10-11T07:35:00+01:00";
    const { db, env, key } = await fresh(SUN);
    await seedBookings(db, key, [{ route: "North", stopId: "N03" }]);
    await passenger(db, "N03");
    await atTime(SUN, () => W.wakeDrivers(env));
    await atTime(SUN, () => W.wakeMorning(env));
    a.eq((await trailOf(env)).length, 0, JSON.stringify(await trailOf(env)));
  });

  s.test("the bus gone past a booked stop: the passengers only", async (a) => {
    const { db, env, key } = await fresh();
    await seedBookings(db, key, [{ route: "North", stopId: "N05" }, { route: "North", stopId: "N02" },
                                 { route: "North", stopId: "N01" }]);
    await passenger(db, "N05"); await passenger(db, "N02");
    G.reset();
    await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian", reg: "YS70 PWE",
                              sunday: key, events: [{ event: "start", at: Date.now() - 900000 }] });
    const all = await W.getStops(env);
    const line = W.pickupsAndArrivals(all);
    await W.wakeAfterTap(env, key, "North", all, line, "N03", {});
    await W.wakeAfterTap(env, key, "North", all, line, "N04", { N03: 1 });
    a.ok(G.calls.length >= 1, "the passengers were told");
    a.eq((await trailOf(env)).length, 0, "the missed-stop coordinator alert was turned down");
  });

  /* From w2.97.0 (Asim, 19 Nov 2026): a coordinator alert of its own, in
     place of the "Sent:" line, so one push, on the Alerts list as new. */
  const lateBox = async (env) => (await W.cacheGet(env, "calert:" + COORD_EP)) || [];
  s.test("a bus not started 5 minutes after its time: the coordinators are told, once", async (a) => {
    const AT = "2026-10-11T09:57:00+01:00";
    const { db, env, key } = await fresh(AT);
    await seedBookings(db, key, [{ route: "North", stopId: "N03" }]);
    await passenger(db, "N03");
    await atTime("2026-10-11T09:56:00+01:00", () => W.wakeNotLeft(env));
    a.eq((await lateBox(env)).length, 0, "nothing before five minutes");
    await atTime(AT, () => W.wakeNotLeft(env));
    await atTime("2026-10-11T09:58:00+01:00", () => W.wakeNotLeft(env));
    const box = await lateBox(env);
    const t = box.filter((m) => m.title === "North: Not started yet");
    a.eq(t.length, 1, JSON.stringify(box));
    a.eq(t[0].kind, "late");
    a.ok(!t[0].urgent, "never urgent");
    a.eq(t[0].body, "Due 09:52. Driver: Bro Adrian. Passengers told: 1 phone.");
    a.eq(box.filter((m) => m.title.indexOf("Sent: North: No word yet") === 0).length, 0, "no second push");
    const list = await atTime(AT, () => W.coordAlertsFor(env, "Bro Arthur"));
    const it = list.list.find((m) => m.title === "North: Not started yet");
    a.ok(it && it.unread, "on the Alerts list as new");
    a.eq((await J(await atTime(AT, () => post(env, { action: "pushwhat", endpoint: COORD_EP })))).title,
         "North: Not started yet", "the coordinator's phone shows it");
  });

  s.test("not told once Start is tapped, and nobody booked still tells them", async (a) => {
    const AT = "2026-10-11T09:57:00+01:00";
    const { env, key } = await fresh(AT);
    await atTime(AT, () => W.wakeNotLeft(env));
    const t = (await lateBox(env)).filter((m) => m.title === "South: Not started yet" || m.title === "North: Not started yet");
    a.eq(t.length, 1, JSON.stringify(t));
    a.eq(t[0].body, "Due 09:52. Driver: Bro Adrian. Passengers told: 0 phones.");
    const { env: env2, key: key2 } = await fresh(AT);
    await atTime("2026-10-11T09:55:00+01:00", () => W.handleTrip(env2, { trip: "t-n", route: "North",
      driver: "Bro Adrian", reg: "YS70 PWE", sunday: key2, events: [{ event: "start", at: Date.now() }] }));
    await atTime(AT, () => W.wakeNotLeft(env2));
    a.eq((await lateBox(env2)).filter((m) => m.title === "North: Not started yet").length, 0);
  });

  s.test("a coordinator driving that route is not told of their own late start", async (a) => {
    const AT = "2026-10-11T09:57:00+01:00";
    const { db, env, key } = await fresh(AT);
    await db.prepare("UPDATE rota SET north='Bro Arthur' WHERE sunday=?").bind(key).run();
    await atTime(AT, () => W.wakeNotLeft(env));
    a.eq((await lateBox(env)).filter((m) => m.title === "North: Not started yet").length, 0);
  });

  s.test("an email to a driver or the duty emails: no coordinator notice", async (a) => {
    const { env } = await fresh();
    await post(env, { action: "sentMail",
                      mail: { subject: "Your request was approved", to: ["Bro Trevor"], outward: true } });
    const out = await J(await post(env, { action: "trail", trail: {
      title: "Duty emails", body: "None sent.", once: "mail|duty|x" } }));
    a.ok(out.ok, JSON.stringify(out));
    a.eq((await trailOf(env)).length, 0);
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

  /* From w2.70.0 (Asim, 21 Oct 2026): a notice his coordinator app never
     showed. Phones best first, a minute later once more, then email. */
  const DRIVER_EP = "https://push.test/driver-arthur";
  const refuse = (eps) => { for (let i = 0; i < 60; i++) G.reply((url) =>
    new Response("", { status: eps.some((e) => String(url) === e) ? 500 : 201 })); };
  const driverApp = (db) => db.prepare(
    "INSERT INTO push_subs (endpoint, p256dh, auth, role, driver, made, app) VALUES (?,?,?,?,?,?,?)")
    .bind(DRIVER_EP, "p", "a", "driver", "Bro Arthur", Date.now(), "driver").run();
  const boxOf = async (env, ep) => ((await W.cacheGet(env, "calert:" + ep)) || []).filter((m) => m.kind === "trail");
  /* A coordinator alert in its own words, the kind that still wakes them. */
  const notice = (env, at) => atTime(at, () => W.trail(env, { once: "n|1", plain: true, title: "North: Second trip", body: "x" }));

  s.test("a notice the coordinator app's push service refuses goes to the driver app", async (a) => {
    const WED = "2026-10-21T18:01:00+01:00";
    const { db, env } = await fresh(WED);
    await driverApp(db);
    refuse([COORD_EP]);
    await notice(env, WED);
    a.eq((await boxOf(env, COORD_EP)).length, 0, "not left waiting in the refused phone's box");
    const d = await boxOf(env, DRIVER_EP);
    a.eq(d.length, 1);
    a.eq(d[0].title, "North: Second trip");
    a.eq(((await W.cacheGet(env, "trail_retry")) || []).length, 0, "nothing to try again");
    G.reset();
  });

  s.test("only the coordinator app, while it takes it", async (a) => {
    const WED = "2026-10-21T18:01:00+01:00";
    const { db, env } = await fresh(WED);
    await driverApp(db);
    await notice(env, WED);
    a.eq((await boxOf(env, COORD_EP)).length, 1);
    a.eq((await boxOf(env, DRIVER_EP)).length, 0);
  });

  s.test("no phone took it: once more a minute later, then the sheet emails it", async (a) => {
    const WED = "2026-10-21T18:01:00+01:00";
    const LATER = "2026-10-21T18:03:00+01:00";
    const { db, env } = await fresh(WED);
    await driverApp(db);
    refuse([COORD_EP, DRIVER_EP]);
    await notice(env, WED);
    const held = (await W.cacheGet(env, "trail_retry")) || [];
    a.eq(held.length, 1);
    a.eq(JSON.stringify(held[0].names), JSON.stringify(["Bro Arthur"]));
    a.eq(await atTime("2026-10-21T18:01:30+01:00", () => W.retryTrails(env)), 0, "not yet a minute");
    await atTime("2026-10-21T18:02:10+01:00", () => W.retryTrails(env));
    a.eq(((await W.cacheGet(env, "trail_retry")) || []).length, 0, "tried once more only");
    a.eq((await J(await atTime(LATER, () => post(env, { action: "drain", limit: 1 })))).trailMail.length, 0,
         "the health check's drain does not take it");
    const mail = (await J(await atTime(LATER, () => post(env, { action: "drain", limit: 300, mail: true })))).trailMail;
    a.eq(mail.length, 1);
    a.eq(mail[0].title, "North: Second trip");
    a.eq((await J(await atTime(LATER, () => post(env, { action: "drain", limit: 300, mail: true })))).trailMail.length, 0, "once");
    G.reset();
  });

  s.test("the minute later reaches it", async (a) => {
    const WED = "2026-10-21T18:01:00+01:00";
    const { env } = await fresh(WED);
    refuse([COORD_EP]);
    await notice(env, WED);
    G.reset();
    a.eq(await atTime("2026-10-21T18:02:10+01:00", () => W.retryTrails(env)), 1);
    a.eq((await boxOf(env, COORD_EP)).length, 1);
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
