/* COVER REQUEST, 8 November 2026. pages v1.153.0 · server w2.85.0 · sheet v1.134.0.

   Asim: a Swap needs the other driver's Sunday, and Unavailable is for
   planned absence. On a morning emergency the rostered driver asks for
   Cover, names the driver covering him (anybody active), and may tick
   Morning only: once the run is over the parked mileage goes back to him. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-10-18";
const PIN = "1234";
const REG = "YS70 PWE";
const T = (hhmm) => "2026-10-18T" + hhmm + ":00+01:00";
const at = (hhmm) => Date.parse(T(hhmm));

export default async function (root) {
  const s = new Suite("driver Cover request, morning only");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  const PEOPLE = [["Bro Asim", "Coordinator", "North"], ["Bro Moses", "Driver", "North"],
                  ["Bro Adesina", "Driver", ""], ["Bro Tunde", "Driver", "South"]];
  const EP = (w) => "https://push.test/" + w;

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY, { north: "Bro Moses", south: "Bro Tunde" });
    await db.prepare("DELETE FROM drivers").run();
    for (const d of PEOPLE) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind(d[0], d[1], d[2], await W.pinHashOf(env, d[0], PIN)).run();
      await db.prepare("INSERT INTO push_subs (endpoint, p256dh, auth, role, driver, made) VALUES (?,?,?,?,?,?)")
        .bind(EP(d[0]), "p", "a", "driver", d[0], Date.now()).run();
    }
    await W.handleSync(env, { authRules: { roles: ["Coordinator"], sameHandBothWays: true } });
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  let n = 0;
  const act = async (env, a) => J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN,
    op: "act", act: Object.assign({ id: "action-" + (++n) }, a) }));
  const ask = async (env, over) => J(await W.handleRotaRequest(env, Object.assign({
    id: "rq-cover", date: KEY, driver: "Bro Moses", type: "Request cover", reason: "Delayed",
    coverBy: "Bro Adesina", morning: true }, over || {})));
  const tap = (env, driver, phone, events) => W.handleTrip(env, {
    trip: "t1", route: "North", driver, reg: REG, sunday: KEY, phone, events });

  s.test("the request keeps who covers and morning only; the coordinator sees both", async (a) => {
    const { env } = await fresh();
    const out = await atTime(T("09:30"), () => ask(env));
    a.ok(out.ok, JSON.stringify(out));
    const v = await atTime(T("09:31"), () => W.coordRequestsView(env, { noCandidates: true }));
    const q = v.find((r) => r.id === "rq-cover");
    a.eq(q.coverBy, "Bro Adesina");
    a.eq(q.morning, true);
  });

  s.test("refused naming himself or somebody not on the Drivers tab", async (a) => {
    const { env } = await fresh();
    let out = await atTime(T("09:30"), () => ask(env, { coverBy: "Bro Nobody" }));
    a.eq(out.error, "Choose who covers.");
    out = await atTime(T("09:30"), () => ask(env, { coverBy: "Bro Moses" }));
    a.eq(out.error, "Choose who covers.");
  });

  s.test("approved, the cover drives; once the run is over the run goes back for the parked mileage", async (a) => {
    const { db, env } = await fresh();
    await atTime(T("09:30"), () => ask(env));
    const d = await atTime(T("09:32"), () => act(env, { kind: "decide", requestId: "rq-cover", choice: "Approved", cover: "Bro Adesina" }));
    a.ok(d.ok, JSON.stringify(d));
    a.eq(d.action.words, "Approved Bro Moses's request for Sun 18 Oct, Bro Adesina covering the morning.");
    const r1 = await atTime(T("09:33"), () => W.currentRota(env, KEY));
    a.eq(r1.northCover, "Bro Adesina");

    await db.prepare("INSERT INTO checks_in (check_id, reg, driver, received, body) VALUES ('c1',?,?,?,?)")
      .bind(REG, "Bro Moses", at("09:20"), JSON.stringify({ miles: 57363 })).run();
    await atTime(T("09:58"), () => tap(env, "Bro Adesina", "p2", [{ event: "start", at: at("09:58") }]));
    /* Not while the run is open. */
    a.eq(await atTime(T("10:30"), () => W.wakeMorningCover(env)), 0, "handed back mid-run");
    await atTime(T("10:58"), () => tap(env, "Bro Adesina", "p2", [{ event: "end", at: at("10:58") }]));

    a.eq(await atTime(T("10:59"), () => W.wakeMorningCover(env)), 1, "not handed back");
    const st = await atTime(T("11:00"), () => W.tripState(env, KEY, "North"));
    a.eq(st.driver, "Bro Moses");
    const r2 = await atTime(T("11:00"), () => W.currentRota(env, KEY));
    a.eq(r2.northCover, "Bro Moses");
    const said = await atTime(T("11:00"), () => W.pushWhat(env, EP("Bro Moses")));
    a.eq(said.title, "North run handed to you");
    /* Once only. */
    a.eq(await atTime(T("11:01"), () => W.wakeMorningCover(env)), 0, "handed back twice");
    const park = await atTime(T("15:00"), () => W.handleParked(env,
      { reg: REG, checkId: "c1", miles: 57410, driver: "Bro Moses" }, true));
    a.ok(park.ok, "the rostered driver could not key it: " + JSON.stringify(park));
  });

  s.test("without Morning only the parked mileage stays with the cover", async (a) => {
    const { db, env } = await fresh();
    await atTime(T("09:30"), () => ask(env, { morning: false }));
    await atTime(T("09:32"), () => act(env, { kind: "decide", requestId: "rq-cover", choice: "Approved", cover: "Bro Adesina" }));
    await db.prepare("INSERT INTO checks_in (check_id, reg, driver, received, body) VALUES ('c1',?,?,?,?)")
      .bind(REG, "Bro Moses", at("09:20"), JSON.stringify({ miles: 57363 })).run();
    await atTime(T("09:58"), () => tap(env, "Bro Adesina", "p2", [{ event: "start", at: at("09:58") }]));
    await atTime(T("10:58"), () => tap(env, "Bro Adesina", "p2", [{ event: "end", at: at("10:58") }]));
    a.eq(await atTime(T("10:59"), () => W.wakeMorningCover(env)), 0);
    const st = await atTime(T("11:00"), () => W.tripState(env, KEY, "North"));
    a.eq(st.driver, "Bro Adesina");
  });

  return s;
}
