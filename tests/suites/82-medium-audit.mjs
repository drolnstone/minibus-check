/* THE MEDIUM POINTS OF THE 4 NOV 2026 AUDIT. server w2.81.0, sheet v1.132.0.

   - One connection has 60 booking writes an hour; past that it is refused
     and the coordinators are told once a day.
   - A cancelled seat is told to the number's other phones.
   - Number lookups are counted per connection, not only per handle.
   - A stop sent without the driver's key still stops the bus, and the
     coordinators are told it is not confirmed by PIN. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-10-18";
const WED = "2026-10-14T12:00:00+01:00";

export default async function (root) {
  const s = new Suite("the medium audit fixes");
  const G = installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());
  const post = (env, body, ip) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", headers: ip ? { "cf-connecting-ip": ip } : {},
    body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const book = (env, ref, phone, seats, ip) => post(env, { action: "booking",
    booking: { date: KEY, ref, phone, stopId: "N01", seats } }, ip).then(J);

  async function fresh() {
    G.reset();
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    return { db, env };
  }

  s.test("one connection's bookings stop at 60 an hour, and coordinators hear once", async (a) => {
    await atTime(WED, async () => {
      const { db, env } = await fresh();
      for (let i = 0; i < 60; i++) {
        const r = await book(env, "d" + i, "077009" + String(10000 + i), 1, "203.0.113.5");
        if (!r.ok) { a.ok(false, "refused at " + i + ": " + JSON.stringify(r)); return; }
      }
      const over = await book(env, "dx", "07700999999", 1, "203.0.113.5");
      a.eq(over.ok, false);
      a.has(over.error, "Too many tries.");
      await book(env, "dy", "07700999998", 1, "203.0.113.5");
      const other = await book(env, "dz", "07700999997", 1, "198.51.100.8");
      a.eq(other.ok, true, "another connection was held: " + JSON.stringify(other));
      const told = (await env.DB.prepare("SELECT k FROM settings WHERE k LIKE 'bookflood:%'").all()).results;
      a.eq(told.length, 1, "the coordinators were told more than once a day");
    });
  });

  s.test("a cancelled seat is told to the number's other phones, not the one that cancelled", async (a) => {
    await atTime(WED, async () => {
      const { db, env } = await fresh();
      const PH = "07700900123";
      const r = await book(env, "mine", PH, 2);
      a.eq(r.ok, true, JSON.stringify(r));
      const pid = await W.passengerId(env, PH);
      for (const [ep, ref] of [["https://push.test/a", "mine"], ["https://push.test/b", "other"]]) {
        await db.prepare("INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, made) VALUES (?,?,?,?,?,?,?)")
          .bind(ep, "p", "a", "passenger", ref, pid, Date.now()).run();
      }
      const gone = await book(env, "stranger", PH, 0);
      a.eq(gone.cancelled, true);
      const boxA = (await W.cacheGet(env, W.coordBoxKey("https://push.test/a"))) || [];
      const boxB = (await W.cacheGet(env, W.coordBoxKey("https://push.test/b"))) || [];
      a.eq(boxA.length, 1, "the booking phone was not told");
      a.eq(boxA[0].title, "Seat cancelled");
      a.has(boxA[0].body, "Scarisbrick Dr");
      a.eq(boxB.length, 1);
      await book(env, "mine", PH, 1);
      const gone2 = await book(env, "mine", PH, 0);
      a.eq(gone2.cancelled, true);
      const boxA2 = (await W.cacheGet(env, W.coordBoxKey("https://push.test/a"))) || [];
      a.eq(boxA2.length, 1, "the phone that cancelled was told its own cancel");
    });
  });

  s.test("number lookups are counted per connection, whatever the handle", async (a) => {
    await atTime(WED, async () => {
      const { env } = await fresh();
      for (let i = 0; i < 40; i++) {
        await post(env, { action: "identify", ref: "h" + i, phone: "077009" + String(20000 + i) }, "203.0.113.7");
      }
      const over = await J(await post(env, { action: "identify", ref: "hnew", phone: "07700930000" }, "203.0.113.7"));
      a.eq(over.ok, false);
      a.has(over.error, "Too many tries.");
      const other = await J(await post(env, { action: "identify", ref: "hnew", phone: "07700930000" }, "198.51.100.9"));
      a.ok(other.ok !== false, "another connection was held: " + JSON.stringify(other));
    });
  });

  return s;
}
