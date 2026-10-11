/* A CHANGE THAT ALTERS THE RUNS IS TOLD. server w2.55.0 (Asim, 11 Oct 2026).

   That morning Bro Adesina's phone number was changed by mistake in the
   coordinator's app, which changed his default PIN, and nobody heard a thing
   until he could not sign in. Now the other coordinators are told on their
   phones and in Alerts, and so is the driver it touches, in the driver app.

   Everything here fails on w2.52.0. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const SAT = "2026-10-10T19:00:00+01:00";
const KEY = "2026-10-11";
const PIN = "1234";

export default async function (root) {
  const s = new Suite("a change that alters the runs is told");
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
    await W.handleSync(env, { authRules: { roles: ["Coordinator", "Minister in Charge", "Assistant Coordinator"], sameHandBothWays: true } });
    await W.cachePut(env, "coord_shelf", { builtAt: Date.now(), readAt: Date.now(), requests: [], defects: [],
      drivers: REGISTER.map((d) => Object.assign({}, d)), driverRoles: ["Driver", "Coordinator", "Assistant Coordinator", "Minister in Charge"] }).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const coord = async (env, body, who) => J(await post(env, Object.assign({ action: "coord", who: who, pin: PIN }, body)));
  let n = 0;
  const act = (env, a, who) => coord(env, { op: "act", act: Object.assign({ id: "chg-act-" + (++n) }, a) }, who);
  const boxOf = async (env, who) => ((await W.cacheGet(env, "calert:" + EP(who))) || []).filter((m) => m.kind === "change");

  s.test("a driver's phone changed: the other coordinators and that driver are told, nobody else", async (a) => {
    await atTime(SAT, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "driver", name: "Bro Adesina", set: { phone: "07717 194644" } }, "Bro Calvin");
      a.ok(out.ok, JSON.stringify(out));
      const asim = (await boxOf(env, "Bro Asim"))[0];
      a.ok(asim, "Bro Asim was not told");
      a.eq(asim.title, "Change by Bro Calvin");
      a.eq(asim.body, "Bro Adesina: phone changed.");
      const him = (await boxOf(env, "Bro Adesina"))[0];
      a.ok(him, "Bro Adesina was not told");
      a.eq(him.url, "./", "the driver's copy opens the driver app");
      a.eq((await boxOf(env, "Bro Calvin")).length, 0, "the one who made it was told");
      a.eq((await boxOf(env, "Bro Moses")).length, 0, "a driver it does not touch was told");
      const alerts = (await coord(env, { op: "alerts" }, "Bro Asim")).alerts;
      a.ok(JSON.stringify(alerts).indexOf("Bro Adesina: phone changed.") !== -1, "not on the Alerts list");
    });
  });

  s.test("a PIN reset is told to that driver", async (a) => {
    await atTime(SAT, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "pin", name: "Bro Tunde" }, "Bro Asim");
      a.ok(out.ok, JSON.stringify(out));
      a.has(((await boxOf(env, "Bro Tunde"))[0] || {}).body, "Bro Tunde: PIN reset");
      a.ok((await boxOf(env, "Bro Calvin")).length, "Bro Calvin was not told");
    });
  });

  s.test("a rota change is told to everybody down to drive that Sunday, before and after", async (a) => {
    await atTime(SAT, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "rota", sunday: KEY, set: { south: "Bro Adesina" } }, "Bro Asim");
      a.ok(out.ok, JSON.stringify(out));
      for (const who of ["Bro Tunde", "Bro Adesina", "Bro Moses", "Bro Calvin"]) {
        a.ok((await boxOf(env, who)).some((m) => /Bro Adesina drives/.test(m.body)), who + " was not told");
      }
      a.eq((await boxOf(env, "Bro Asim")).length, 0);
    });
  });
  return s;
}
