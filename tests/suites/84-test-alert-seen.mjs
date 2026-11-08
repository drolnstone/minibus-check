/* DID THE TEST ALERT ARRIVE? 8 November 2026. pages v1.154.0 · server w2.86.0.

   Asim: an Android passenger was told "Sent. Give it a few seconds." and saw
   nothing. The test now asks whether the phone's own service worker woke for
   it, so the screen says "This phone received it." or that it did not. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";

export default async function (root) {
  const s = new Suite("test alert: did the phone wake");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());
  const EP = "https://push.test/android-1";

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await db.prepare("INSERT INTO push_subs (endpoint, p256dh, auth, role, made) VALUES (?,?,?,?,?)")
      .bind(EP, "p", "a", "passenger", Date.now()).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(body) }), env, {});
  const testOut = (db) => db.prepare("INSERT INTO settings (k,v) VALUES (?,?)")
    .bind("test:" + EP, JSON.stringify({ at: Date.now() })).run();

  s.test("no wake yet: woke false", async (a) => {
    const { db, env } = await fresh();
    await testOut(db);
    const out = await J(await post(env, { action: "testseen", endpoint: EP }));
    a.ok(out.ok && out.woke === false, JSON.stringify(out));
  });

  s.test("the phone asks what the push means: woke true, once", async (a) => {
    const { db, env } = await fresh();
    await testOut(db);
    const what = await J(await post(env, { action: "pushwhat", endpoint: EP }));
    a.ok(what.title === "Alerts are working", JSON.stringify(what));
    const out = await J(await post(env, { action: "testseen", endpoint: EP }));
    a.ok(out.woke === true, JSON.stringify(out));
    const again = await J(await post(env, { action: "testseen", endpoint: EP }));
    a.ok(again.woke === false, "cleared once read");
  });

  s.test("an ordinary push does not count as the test", async (a) => {
    const { env } = await fresh();
    await post(env, { action: "pushwhat", endpoint: EP });
    const out = await J(await post(env, { action: "testseen", endpoint: EP }));
    a.ok(out.woke === false, JSON.stringify(out));
  });

  return s;
}
