/* ONE ALERT FOR A PERSON WITH BOTH APPS.

   From w2.43.0 / v1.97.1 (Asim). The driver app and the coordinator app each
   sign a phone up under the same name; installed apart they are two
   endpoints, and a coordinator was woken twice for everything. push_subs.app
   says which app holds an endpoint. A coordinator alert goes to the
   coordinator app's endpoints when the person has one; a driver's own
   reminders skip the coordinator app's. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const EP = (x) => "https://push.test/" + x;

export default async function (root) {
  const s = new Suite("one alert for a person with both apps");
  const G = installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});

  async function fresh() {
    G.reset();
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    for (const d of [["Bro Arthur", "Coordinator"], ["Pst Kenneth", "Minister in Charge"], ["Bro Trevor", "Driver"]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind(d[0], d[1], "North", await W.pinHashOf(env, d[0], "1234")).run();
    }
    await W.cachePut(env, "auth_rules",
      { roles: ["Coordinator", "Minister in Charge"], sameHandBothWays: true }).run();
    return { db, env };
  }
  const sub = (env, endpoint, driver, app) => post(env, { action: "subscribe", endpoint,
    keys: { p256dh: "p", auth: "a" }, role: "driver", driver, route: "", app });
  const appOf = (db, ep) => (db._rows("SELECT app FROM push_subs WHERE endpoint = '" + ep + "'")[0] || {}).app;
  const pushedTo = () => G.calls.map((c) => c.url).filter((u) => u.indexOf("https://push.test/") === 0).sort();
  const alert = { id: "a1", kind: "stopped", urgent: true, title: "BUS STOPPED: YS70 PWE", body: "Critical defect.", reg: "YS70 PWE" };

  s.test("each app's sign-up is recorded, and one endpoint used by both reads both", async (a) => {
    const { db, env } = await fresh();
    await sub(env, EP("d"), "Bro Arthur", "driver");
    await sub(env, EP("c"), "Bro Arthur", "coord");
    await sub(env, EP("s"), "Bro Arthur", "driver");
    await sub(env, EP("s"), "Bro Arthur", "coord");
    a.eq(appOf(db, EP("d")), "driver");
    a.eq(appOf(db, EP("c")), "coord");
    a.eq(appOf(db, EP("s")), "both");
    await J(await post(env, { action: "pushapp", endpoint: EP("s"), app: "driver" }));
    a.eq(appOf(db, EP("s")), "both", "the driver app opening again does not take the coordinator app off");
    await J(await post(env, { action: "pushapp", endpoint: EP("d"), app: "nonsense" }));
    a.eq(appOf(db, EP("d")), "driver");
  });

  s.test("a coordinator with both apps apart gets a coordinator alert once, in the coordinator app", async (a) => {
    const { env } = await fresh();
    await sub(env, EP("arthur-driver"), "Bro Arthur", "driver");
    await sub(env, EP("arthur-coord"), "Bro Arthur", "coord");
    await sub(env, EP("kenneth"), "Pst Kenneth", "driver");
    G.reset();
    const out = await J(await post(env, { action: "coordAlert", alert }));
    a.ok(out.ok, JSON.stringify(out));
    a.eq(JSON.stringify(pushedTo()), JSON.stringify([EP("arthur-coord"), EP("kenneth")].sort()),
         "a coordinator with only the driver app still gets it there");
  });

  s.test("a phone signed up before this, with nothing known, still gets coordinator alerts", async (a) => {
    const { db, env } = await fresh();
    await db.prepare("INSERT INTO push_subs (endpoint, p256dh, auth, role, driver, made) VALUES (?,?,?,?,?,?)")
      .bind(EP("old"), "p", "a", "driver", "Bro Arthur", Date.now()).run();
    await J(await post(env, { action: "coordAlert", alert }));
    a.eq(JSON.stringify(pushedTo()), JSON.stringify([EP("old")]));
  });

  s.test("a driver's own reminder skips the coordinator app's endpoint", async (a) => {
    await atTime("2026-09-27T09:52:00+01:00", async () => {
      const { db, env } = await fresh();
      await seedSunday(db, W.runSunday(), {});
      await sub(env, EP("drv"), "Bro Adrian", "driver");
      await sub(env, EP("crd"), "Bro Adrian", "coord");
      await sub(env, EP("shared"), "Bro Adrian", "driver");
      await sub(env, EP("shared"), "Bro Adrian", "coord");
      G.reset();
      await W.wakeDrivers(env);
      a.eq(JSON.stringify(pushedTo()), JSON.stringify([EP("drv"), EP("shared")].sort()));
    });
  });

  return s;
}
