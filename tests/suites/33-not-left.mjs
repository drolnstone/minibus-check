/* SETTING OFF, AND NO WORD THAT IT HAS.

   From w2.27.0. On the departure time the rostered driver is told to set
   off. Five minutes past it with no Start tapped, everybody booked on that
   route is told, once, that nothing has recorded the bus leaving; the words
   go no further than that, because Start is the only thing that tells the
   live server a bus has gone.

   The seeded timetable: North leaves church at 09:52, South at 10:21. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday, seedBookings } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const AT = (hhmm) => "2026-09-27T" + hhmm + ":00+01:00";

export default async function (root) {
  const s = new Suite("setting off, and no word that it has");
  const G = installGlobals();
  const { mod: W } = await loadWorker(root);

  async function live(over) {
    const o = over || {};
    G.reset();
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    const key = W.runSunday();
    await seedSunday(db, key, o.rota || {});
    await W.cachePut(env, "passenger_rules",
      { resendMinutes: 3, morningMessage: true, quietFrom: 21, quietTo: 8 }).run();
    await seedBookings(db, key, [{ route: "North", stopId: "N08" }, { route: "South", stopId: "S03" }]);
    for (const id of ["N08", "S03"]) {
      await db.prepare(
        "INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, driver, route, made, seen, fails, last) " +
        "VALUES (?,'p','a','passenger',?,?,'','',?,0,0,'')"
      ).bind("https://push.example/pax-" + id, "dev-" + id, "pid-" + id, Date.now()).run();
    }
    await db.prepare(
      "INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, driver, route, made, seen, fails, last) " +
      "VALUES ('https://push.example/drv','p','a','driver','d-ade','','Bro Adrian','North',?,0,0,'')"
    ).bind(Date.now()).run();
    return { db, env, key };
  }
  const lastOf = (db, ep) => (db._rows("SELECT last FROM push_subs WHERE endpoint = '" + ep + "'")[0] || {}).last || "";
  const PAX_N = "https://push.example/pax-N08", PAX_S = "https://push.example/pax-S03";
  const DRV = "https://push.example/drv";
  const start = (env, key, route) => W.handleTrip(env, { trip: "t-" + route, route, driver: "Bro Adrian",
    reg: "YS70 PWE", sunday: key, events: [{ event: "start", at: Date.now() }] });

  /* ---- the driver ------------------------------------------------------- */

  s.test("on the departure time the driver is told to set off", async (a) => {
    await atTime(AT("09:52"), async () => {
      const { db, env } = await live();
      await W.wakeDrivers(env);
      a.has(lastOf(db, DRV), "go|", "the driver was not woken on the minute");
      const out = await W.pushWhat(env, DRV);
      a.eq(out.title, "Time to set off");
      a.has(out.body, "09:52");
      a.has(out.body, "Tap Start");
    });
  });

  s.test("not a minute before it", async (a) => {
    await atTime(AT("09:51"), async () => {
      const { db, env } = await live();
      await W.wakeDrivers(env);
      a.not(/^go\|/.test(lastOf(db, DRV)), "woken to set off before the bus was due");
    });
  });

  s.test("ten minutes on, the words become the ones they were before", async (a) => {
    await atTime(AT("10:02"), async () => {
      const { env } = await live();
      const out = await W.pushWhat(env, DRV);
      a.eq(out.title, "The bus has not gone out");
    });
  });

  /* ---- the passengers --------------------------------------------------- */

  s.test("five minutes past with no Start, everybody booked on that route is told, once", async (a) => {
    await atTime(AT("09:57"), async () => {
      const { db, env, key } = await live();
      const n = await W.wakeNotLeft(env);
      a.eq(n, 1, "one North passenger, one message");
      a.eq(lastOf(db, PAX_N), "late|" + key + "|North");
      a.eq(lastOf(db, PAX_S), "", "the South passenger was told about North, or South before it was due");
      a.eq(await W.wakeNotLeft(env), 0, "told twice");
      const out = await W.pushWhat(env, PAX_N);
      a.eq(out.title, "No word yet that your bus has left church");
      a.has(out.body, "09:52");
      a.has(out.body, "10:52", "his own time was lost");
      a.has(out.body, "as soon as it sets off");
      a.hasnt(out.title + out.body, "late", "it guesses at lateness, which the server cannot know");
      a.hasnt(out.title + out.body, "driver", "it blames the driver");
    });
  });

  s.test("not at four minutes past", async (a) => {
    await atTime(AT("09:56"), async () => {
      const { env } = await live();
      a.eq(await W.wakeNotLeft(env), 0);
    });
  });

  s.test("not once the bus has started, and he is told it has left instead", async (a) => {
    await atTime(AT("09:57"), async () => {
      const { env, key } = await live();
      await start(env, key, "North");
      a.eq(await W.wakeNotLeft(env), 0);
      const out = await W.pushWhat(env, PAX_N);
      a.hasnt(out.title, "No word yet", "told the bus had not left after Start was tapped");
    });
  });

  s.test("not on a route called off: that has its own words", async (a) => {
    await atTime(AT("09:57"), async () => {
      const { env } = await live({ rota: { status: "North cancelled" } });
      a.eq(await W.wakeNotLeft(env), 0);
    });
  });

  s.test("not past an hour", async (a) => {
    await atTime(AT("10:53"), async () => {
      const { db, env } = await live();
      await W.wakeNotLeft(env);
      a.eq(lastOf(db, PAX_N), "", "North, an hour and a minute past, still buzzed");
    });
  });

  s.test("South on its own time", async (a) => {
    await atTime(AT("10:26"), async () => {
      const { db, env, key } = await live();
      await start(env, key, "North");
      await W.wakeNotLeft(env);
      a.eq(lastOf(db, PAX_S), "late|" + key + "|South");
    });
  });

  s.test("the clock runs it every minute", async (a) => {
    await atTime(AT("09:57"), async () => {
      const { db, env, key } = await live();
      await W.clockTick(env);
      a.eq(lastOf(db, PAX_N), "late|" + key + "|North");
    });
  });

  return s;
}
