/* A MESSAGE FROM A COORDINATOR. server w2.56.0 · pages v1.109.0 (Asim, 11 Oct 2026).

   A message centre in the coordinator app: ready-made words or the
   coordinator's own, to coordinators, drivers (all, or the coming Sunday's
   rota) and passengers (all, booked or not booked).

   Everything here fails on w2.55.0. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday, seedBookings } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const SAT = "2026-10-10T19:00:00+01:00";
const KEY = "2026-10-11";
const PIN = "1234";

export default async function (root) {
  const s = new Suite("a message from a coordinator");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  const REGISTER = [
    { name: "Bro Asim", role: "Coordinator", active: true, order: 4, route: "North", email: "", phone: "447377634214", hasPin: true },
    { name: "Bro Calvin", role: "Assistant Coordinator", active: true, order: 0, route: "North", email: "", phone: "447399671575", hasPin: true },
    { name: "Bro Moses", role: "Driver", active: true, order: 3, route: "North", email: "", phone: "447395626955", hasPin: true },
    { name: "Bro Tunde", role: "Driver", active: true, order: 1, route: "South", email: "", phone: "447752221412", hasPin: true },
    { name: "Bro Adesina", role: "Driver", active: true, order: 3, route: "South", email: "", phone: "447717194643", hasPin: true }];
  const EP = (w) => "https://push.test/" + w;

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY, { north: "Bro Moses", south: "Bro Tunde" });
    await db.prepare("DELETE FROM drivers").run();
    for (const d of REGISTER) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,?,?)")
        .bind(d.name, d.role, d.route, d.order, d.active ? 1 : 0, await W.pinHashOf(env, d.name, PIN)).run();
      await db.prepare("INSERT INTO push_subs (endpoint, p256dh, auth, role, driver, made) VALUES (?,?,?,?,?,?)")
        .bind(EP(d.name), "p", "a", "driver", d.name, Date.now()).run();
    }
    for (const p of ["seat", "noseat"]) {
      await db.prepare("INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, made) VALUES (?,?,?,?,?,?,?)")
        .bind(EP(p), "p", "a", "passenger", "dev-" + p, "pid-" + p, Date.now()).run();
    }
    await seedBookings(db, KEY, [{ route: "North", stopId: "N01", device: "dev-seat", pid: "pid-seat" }]);
    await W.handleSync(env, { authRules: { roles: ["Coordinator", "Minister in Charge", "Assistant Coordinator"], sameHandBothWays: true } });
    await W.cachePut(env, "coord_shelf", { builtAt: Date.now(), readAt: Date.now(), requests: [], defects: [],
      drivers: REGISTER.map((d) => Object.assign({}, d)), driverRoles: ["Driver", "Coordinator", "Assistant Coordinator", "Minister in Charge"] }).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const coord = async (env, body, who) => J(await post(env, Object.assign({ action: "coord", who: who, pin: PIN }, body)));
  let n = 0;
  const act = (env, a, who) => coord(env, { op: "act", act: Object.assign({ id: "msg-act-" + (++n) }, a) }, who);
  const boxOf = async (env, who) => ((await W.cacheGet(env, "calert:" + EP(who))) || []).filter((m) => m.kind === "message");


  s.test("passengers not booked: only the phone with no seat, in the coordinator's words", async (a) => {
    await atTime(SAT, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "message", text: "Book your seat for Sun 11 Oct.", to: ["unbooked"] }, "Bro Asim");
      a.ok(out.ok, JSON.stringify(out));
      a.eq(out.message.phones, 1);
      a.eq((await boxOf(env, "noseat")).length, 1);
      a.eq((await boxOf(env, "seat")).length, 0, "a booked passenger was sent it");
      for (const d of ["Bro Calvin", "Bro Moses"]) a.eq((await boxOf(env, d)).length, 0, d + " was sent it");
      const what = await W.pushWhat(env, EP("noseat"));
      a.eq(what.title, "Message from Bro Asim");
      a.eq(what.body, "Book your seat for Sun 11 Oct.");
      a.eq(what.url, "./");
    });
  });

  s.test("drivers on Sunday's rota, and coordinators: each person once, never the sender", async (a) => {
    await atTime(SAT, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "message", text: "North leaves at 10:20.", to: ["coord", "rota"] }, "Bro Asim");
      a.ok(out.ok, JSON.stringify(out));
      for (const d of ["Bro Calvin", "Bro Moses", "Bro Tunde"]) a.eq((await boxOf(env, d)).length, 1, d);
      for (const d of ["Bro Asim", "Bro Adesina", "seat", "noseat"]) a.eq((await boxOf(env, d)).length, 0, d);
      const alerts = (await coord(env, { op: "alerts" }, "Bro Calvin")).alerts;
      a.ok(JSON.stringify(alerts).indexOf("North leaves at 10:20.") !== -1, "not on the Alerts list");
    });
  });

  s.test("everybody: every driver and every passenger", async (a) => {
    await atTime(SAT, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "message", text: "Service starts at 11.", to: ["drivers", "passengers"] }, "Bro Calvin");
      a.ok(out.ok, JSON.stringify(out));
      for (const d of ["Bro Asim", "Bro Moses", "Bro Tunde", "Bro Adesina", "seat", "noseat"]) a.eq((await boxOf(env, d)).length, 1, d);
      a.eq((await boxOf(env, "Bro Calvin")).length, 0);
      a.eq(out.message.phones, 6);
    });
  });

  s.test("refused: no words, too many words, nobody picked", async (a) => {
    await atTime(SAT, async () => {
      const { env } = await fresh();
      a.eq((await act(env, { kind: "message", text: "  ", to: ["coord"] }, "Bro Asim")).error, "Type the message.");
      a.eq((await act(env, { kind: "message", text: "x".repeat(201), to: ["coord"] }, "Bro Asim")).error, "The message is over 200 characters.");
      a.eq((await act(env, { kind: "message", text: "Hi.", to: ["everyone"] }, "Bro Asim")).error, "Pick who it goes to.");
    });
  });

  s.test("the coordinator app offers it", async (a) => {
    const fs = await import("node:fs");
    const html = fs.readFileSync(join(root, "coord", "index.html"), "utf8");
    a.ok(html.indexOf('data-do="message"') !== -1, "no Send a message on the menu");
    a.ok(html.indexOf('kind: "message"') !== -1, "the sheet does not send");
  });

  return s;
}
