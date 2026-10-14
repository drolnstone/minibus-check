/* THE VEHICLE CHECK'S TIME. server w2.60.0, driver app v1.117.0, sheet
   v1.118.0 (Asim, 14 Oct 2026).

   Every driver reminder says when the check is and when the bus departs:
   departure less 20 minutes, 30 for a coordinator. On the day, "Time for the
   vehicle check" at the check time and "Vehicle check not started" ten
   minutes on, never once a check is in or has started.

   Everything here fails on w2.59.0. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-10-18";
const at = (hhmm) => KEY + "T" + hhmm + ":00+01:00";
const EP = "https://push.test/adrian";

export default async function (root) {
  const s = new Suite("the vehicle check's time");
  const G = installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});

  async function fresh(o) {
    G.reset();
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    for (const d of [["Bro Arthur", "Coordinator"], ["Bro Adrian", "Driver"], ["Bro Trevor", "Driver"]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind(d[0], d[1], "North", "x").run();
    }
    await W.cachePut(env, "auth_rules", { roles: ["Coordinator"], sameHandBothWays: true }).run();
    await seedSunday(db, KEY, { north: (o && o.north) || "Bro Adrian" });
    await db.prepare(
      "INSERT INTO push_subs (endpoint, p256dh, auth, role, driver, route, made, last, app) " +
      "VALUES (?,?,?,?,?,?,?,'',?)")
      .bind(EP, "p", "a", "driver", (o && o.north) || "Bro Adrian", "North", Date.now(), "driver").run();
    return { db, env };
  }
  /* What the sweep would send the North driver at a time, and what the phone reads. */
  const nudge = async (env, hhmm) => atTime(at(hhmm), async () => {
    const all = await W.getStops(env);
    const n = await W.driverNudgeFor(env, KEY, "North", all, W.pickupsAndArrivals(all),
                                     await W.getRotaRow(env, KEY), await W.getBuses(env));
    return n ? n.tag.split("|")[0] : "";
  });
  const reads = (env, hhmm, extra) => atTime(at(hhmm), async () =>
    J(await post(env, Object.assign({ action: "pushwhat", endpoint: EP }, extra || {}))));

  s.test("the morning push gives both times", async (a) => {
    const { env } = await fresh();
    const r = await reads(env, "07:31");
    a.eq(r.title, "You are driving today");
    a.eq(r.body, "North. Vehicle check 09:32. Depart 09:52.");
  });

  s.test("check due at its time, not started ten minutes on, then the departure", async (a) => {
    const { env } = await fresh();
    a.eq(await nudge(env, "09:31"), "");
    a.eq(await nudge(env, "09:32"), "chk");
    a.eq((await reads(env, "09:33")).title, "Time for the vehicle check");
    a.eq((await reads(env, "09:33")).body, "North. Depart 09:52.");
    a.eq(await nudge(env, "09:42"), "chkl");
    a.eq((await reads(env, "09:43")).title, "Vehicle check not started");
    a.eq(await nudge(env, "09:52"), "go");
  });

  s.test("a check started on the phone stops both", async (a) => {
    const { env } = await fresh();
    await atTime(at("09:20"), () => post(env, { action: "checkgo", checkgo: { driver: "Bro Adrian", reg: "YS70 PWE" } }));
    a.eq(await nudge(env, "09:33"), "");
    a.eq(await nudge(env, "09:45"), "");
    a.eq((await reads(env, "09:45")).title, "You are driving today");
  });

  s.test("a check started on the same bus by somebody else stops both", async (a) => {
    const { env } = await fresh();
    await atTime(at("09:20"), () => post(env, { action: "checkgo", checkgo: { driver: "Bro Trevor", reg: "YS70 PWE" } }));
    a.eq(await nudge(env, "09:45"), "");
  });

  s.test("a check already in stops both", async (a) => {
    const { env } = await fresh();
    await atTime(at("09:25"), () => W.handleCheck(env,
      { id: "c1", reg: "YS70 PWE", level: "ok", driver: "Bro Adrian", age: 0 }));
    a.eq(await nudge(env, "09:45"), "");
  });

  s.test("a phone with a check open says so when it is woken", async (a) => {
    const { env } = await fresh();
    a.eq((await reads(env, "09:45", { checking: true })).title, "You are driving today");
    a.eq(await nudge(env, "09:46"), "");
  });

  s.test("yesterday's start does not count today", async (a) => {
    const { env } = await fresh();
    await atTime("2026-10-17T19:00:00+01:00", () =>
      post(env, { action: "checkgo", checkgo: { driver: "Bro Adrian", reg: "YS70 PWE" } }));
    a.eq(await nudge(env, "09:33"), "chk");
  });

  s.test("a coordinator driving gets 30 minutes", async (a) => {
    const { env } = await fresh({ north: "Bro Arthur" });
    a.eq((await reads(env, "07:40")).body, "North. Vehicle check 09:22. Depart 09:52.");
    a.eq(await nudge(env, "09:22"), "chk");
    a.eq(await nudge(env, "09:32"), "chkl");
  });

  s.test("the duty card: the coming Sunday, then where the check stands", async (a) => {
    const { env } = await fresh();
    const wed = await atTime("2026-10-14T12:00:00+01:00", async () =>
      J(await post(env, { action: "duty", driver: "bro adrian" })));
    a.eq(wed.route, "North"); a.eq(wed.check, "09:32"); a.eq(wed.depart, "09:52"); a.eq(wed.state, "");
    const due = await atTime(at("09:35"), async () => J(await post(env, { action: "duty", driver: "Bro Adrian" })));
    a.eq(due.state, "due");
    const late = await atTime(at("09:43"), async () => J(await post(env, { action: "duty", driver: "Bro Adrian" })));
    a.eq(late.state, "late");
    await atTime(at("09:44"), () => post(env, { action: "checkgo", checkgo: { driver: "Bro Adrian" } }));
    const going = await atTime(at("09:45"), async () => J(await post(env, { action: "duty", driver: "Bro Adrian" })));
    a.eq(going.state, "going");
    const none = await atTime(at("09:45"), async () => J(await post(env, { action: "duty", driver: "Bro Keith" })));
    a.eq(none.route, "", "Bro Keith is not on the rota");
  });

  s.test("the coordinators' trail names the check pushes", async (a) => {
    a.eq(W.sentTitle("chk|" + KEY + "|North", true), "North: Time for the vehicle check");
    a.eq(W.sentTitle("chkl|" + KEY + "|North", true), "North: Vehicle check not started");
  });

  return s;
}
