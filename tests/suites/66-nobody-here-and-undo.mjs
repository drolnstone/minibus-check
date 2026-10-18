/* NOBODY HERE IS TOLD, AND AN UNDO PUTS RIGHT WHAT IT TOLD.
   server w2.57.0 (Asim, 11 Oct 2026).

   A stop marked Nobody here now tells the people booked at it, in the words
   their phone already had for it ("Nobody there at ..."). And when a tap is
   taken back, any stop whose state it changes (gone past, Picked up, Nobody
   there) has its booked phones woken again and told what is true now, if a
   push reached them since that tap. Picked up still tells that stop nothing.

   Everything here except the Picked up checks fails on w2.56.0. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-10-04";
const ON_THE_ROAD = "2026-10-04T10:20:00+01:00";

export default async function (root) {
  const s = new Suite("Nobody here is told, and an Undo puts right what it told");
  const G = installGlobals();
  const { mod: W } = await loadWorker(root);

  /* The driver's own words, off his buttons, as suite 37 reads them. */
  const app = readFileSync(join(root, "index.html"), "utf8");
  const said = [...new Set([...app.matchAll(/data-tripkind="([a-z]+)"/g)].map((m) => m[1]))];
  const PICKED = said.find((k) => /pick/.test(k));
  const EMPTY = said.find((k) => !/pick/.test(k));

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await W.cachePut(env, "passenger_rules",
      { resendMinutes: 3, morningMessage: true, quietFrom: 21, quietTo: 8 }).run();
    return { db, env };
  }
  async function seat(db, stopId) {
    await db.prepare(
      "INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received, synced) " +
      "VALUES (?,?,?,?,?,?,?,?,'Booked',?,0)"
    ).bind(KEY, "North", stopId, stopId, 2, "dev-" + stopId, "pid-" + stopId, "07700900001", Date.now()).run();
  }
  async function phone(db, stopId) {
    const ep = "https://push.example/undo-" + stopId;
    await db.prepare(
      "INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, driver, route, made, seen, fails, last) " +
      "VALUES (?,?,?,?,?,?,?,?,?,0,0,'')"
    ).bind(ep, "p", "a", "passenger", "dev-" + stopId, "pid-" + stopId, "", "", Date.now()).run();
    return ep;
  }
  async function booked(db, stopId) { await seat(db, stopId); return phone(db, stopId); }
  const lastOf = (db, stopId) =>
    String((db._rows("SELECT last FROM push_subs WHERE ref=?", "dev-" + stopId)[0] || {}).last || "");
  const pushesTo = (ep) => G.calls.filter((c) => c.url === ep).length;

  const trip = (env, events) => W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian",
    reg: "YS70 PWE", sunday: KEY, events: events });
  async function setOff(db, env) {
    await trip(env, [{ event: "start", at: Date.parse("2026-10-04T09:52:00+01:00") }]);
    db.prepare("UPDATE push_subs SET last=''").run();     /* the departure's own message, cleared */
  }

  /* ---- Nobody here ---------------------------------------------------------- */

  s.test("Nobody here tells the people booked at that stop, in its own words", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      const ep = await booked(db, "N03");
      await setOff(db, env);
      G.reset();
      await trip(env, [{ event: EMPTY, stopId: "N03", at: Date.now() }]);
      a.eq(lastOf(db, "N03"), "empty|" + KEY + "|N03");
      a.eq(pushesTo(ep), 1, "the phone booked at the stop was not woken");
      const out = await W.pushWhat(env, ep);
      a.eq(out.title, "Nobody there at Litherland Rd");
    });
  });

  s.test("Picked up still tells that stop nothing", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      const ep = await booked(db, "N03");
      await setOff(db, env);
      G.reset();
      await trip(env, [{ event: PICKED, stopId: "N03", at: Date.now() }]);
      a.eq(lastOf(db, "N03"), "");
      a.eq(pushesTo(ep), 0);
    });
  });

  s.test("the same Nobody here sent again by the phone wakes nobody twice", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      const ep = await booked(db, "N03");
      await setOff(db, env);
      G.reset();
      const at = Date.now();
      await trip(env, [{ event: EMPTY, stopId: "N03", at: at }]);
      await trip(env, [{ event: EMPTY, stopId: "N03", at: at }]);
      a.eq(pushesTo(ep), 1);
    });
  });

  s.test("on the coordinators' Alerts list as Nobody there, with the stop", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      await booked(db, "N03");
      await setOff(db, env);
      await trip(env, [{ event: EMPTY, stopId: "N03", at: Date.now() }]);
      const line = (await W.sentList(env)).find((m) => m.title === "North: Nobody there");
      a.ok(line, JSON.stringify(await W.sentList(env)));
      a.eq(line.body, "To 1 passenger phone: Litherland Rd.");
    });
  });

  /* ---- an Undo -------------------------------------------------------------- */

  s.test("a wrong kerb taken back: the stop told 'gone past' is told the bus is still coming", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      const ep = await booked(db, "N01");
      await setOff(db, env);
      const at = Date.now();
      await trip(env, [{ event: PICKED, stopId: "N03", at: at }]);
      a.has(lastOf(db, "N01"), "past|");
      G.reset();
      await trip(env, [{ event: "undo", undoes: PICKED, stopId: "N03", at: at + 30000 }]);
      a.eq(lastOf(db, "N01"), "fix|" + KEY + "|N01|" + (at + 30000));
      a.eq(pushesTo(ep), 1, "the correction did not go");
      const out = await W.pushWhat(env, ep);
      a.ok(/^Be at your stop/.test(out.title), "after the Undo the phone still says gone past, got " + out.title);
      const line = (await W.sentList(env)).find((m) => m.title === "North: Corrected after an Undo");
      a.ok(line, "not on the Alerts list");
    });
  });

  s.test("Nobody here taken back: that stop is told it is no longer marked", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      const ep = await booked(db, "N03");
      await setOff(db, env);
      const at = Date.now();
      await trip(env, [{ event: EMPTY, stopId: "N03", at: at }]);
      G.reset();
      await trip(env, [{ event: "undo", undoes: EMPTY, stopId: "N03", at: at + 30000 }]);
      a.has(lastOf(db, "N03"), "fix|");
      a.eq(pushesTo(ep), 1);
      const t = (await W.pushWhat(env, ep)).title;
      a.ok(/^Be at your stop/.test(t), "expected the estimate back, got " + t);
    });
  });

  s.test("Nobody here changed to Picked up: that stop is told Picked up", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      const ep = await booked(db, "N03");
      await setOff(db, env);
      const at = Date.now();
      await trip(env, [{ event: EMPTY, stopId: "N03", at: at }]);
      G.reset();
      /* As the driver app sends a switch: the first answer taken back, then
         the other, at the same moment. */
      await trip(env, [{ event: "undo", undoes: EMPTY, stopId: "N03", at: at + 30000 },
                       { event: PICKED, stopId: "N03", at: at + 30000 }]);
      a.eq(pushesTo(ep), 1);
      a.eq((await W.pushWhat(env, ep)).title, "Picked up at Litherland Rd");
    });
  });

  s.test("Picked up changed to Nobody here: that stop is told Nobody there", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      const ep = await booked(db, "N03");
      await setOff(db, env);
      const at = Date.now();
      await trip(env, [{ event: PICKED, stopId: "N03", at: at }]);
      G.reset();
      await trip(env, [{ event: "undo", undoes: PICKED, stopId: "N03", at: at + 30000 },
                       { event: EMPTY, stopId: "N03", at: at + 30000 }]);
      a.eq(pushesTo(ep), 1);
      a.eq((await W.pushWhat(env, ep)).title, "Nobody there at Litherland Rd");
    });
  });

  s.test("an Undo that leaves 'gone past' still true sends nothing", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      const ep = await booked(db, "N01");
      await setOff(db, env);
      const at = Date.now();
      await trip(env, [{ event: PICKED, stopId: "N02", at: at }]);
      await trip(env, [{ event: PICKED, stopId: "N03", at: at + 60000 }]);
      G.reset();
      await trip(env, [{ event: "undo", undoes: PICKED, stopId: "N03", at: at + 90000 }]);
      a.eq(pushesTo(ep), 0, "N02 is still marked, so the bus has still gone past N01");
      a.has(lastOf(db, "N01"), "past|");
    });
  });

  s.test("a phone told nothing about its stop is not woken by an Undo", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      const ep = await booked(db, "N05");
      await setOff(db, env);
      const at = Date.now();
      await trip(env, [{ event: PICKED, stopId: "N01", at: at }]);
      db.prepare("UPDATE push_subs SET last=''").run();
      G.reset();
      await trip(env, [{ event: "undo", undoes: PICKED, stopId: "N01", at: at + 30000 }]);
      a.eq(pushesTo(ep), 0);
    });
  });

  s.test("the same Undo sent again by the phone corrects once", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      const ep = await booked(db, "N01");
      await setOff(db, env);
      const at = Date.now();
      await trip(env, [{ event: PICKED, stopId: "N03", at: at }]);
      G.reset();
      const undo = { event: "undo", undoes: PICKED, stopId: "N03", at: at + 30000 };
      await trip(env, [undo]);
      await trip(env, [undo]);
      a.eq(pushesTo(ep), 1);
    });
  });

  s.test("an Undo still corrects a phone that a later push has reached since", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      const ep = await booked(db, "N02");
      await setOff(db, env);
      const at = Date.now();
      await trip(env, [{ event: PICKED, stopId: "N04", at: at }]);          /* the wrong kerb */
      await trip(env, [{ event: PICKED, stopId: "N01", at: at + 30000 }]);  /* then a real stop */
      a.hasnt(lastOf(db, "N02"), "past|", "the later push did not reach the phone, so this proves nothing");
      G.reset();
      await trip(env, [{ event: "undo", undoes: PICKED, stopId: "N04", at: at + 60000 }]);
      a.eq(pushesTo(ep), 1, "the correction did not go");
      a.hasnt((await W.pushWhat(env, ep)).title, "gone past");
    });
  });

  s.test("a tap and its Undo in one send, from a phone out of signal, tell nobody", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      const past = await booked(db, "N01");
      const here = await booked(db, "N03");
      await setOff(db, env);
      G.reset();
      const at = Date.now();
      await trip(env, [{ event: EMPTY, stopId: "N03", at: at },
                       { event: "undo", undoes: EMPTY, stopId: "N03", at: at + 10000 }]);
      a.eq(pushesTo(past), 0, "the stop before was told about a tap taken back");
      a.eq(pushesTo(here), 0, "the stop itself was told Nobody there");
    });
  });

  s.test("a phone that signed up after the tap is not woken by its Undo", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      await seat(db, "N01");
      await setOff(db, env);
      const at = Date.now();
      await trip(env, [{ event: PICKED, stopId: "N03", at: at }]);
      const ep = await phone(db, "N01");     /* alerts turned on afterwards: told nothing yet */
      G.reset();
      await trip(env, [{ event: "undo", undoes: PICKED, stopId: "N03", at: at + 30000 }]);
      a.eq(pushesTo(ep), 0);
    });
  });

  s.test("once the run has ended, an Undo corrects nobody and Nobody here tells nobody", async (a) => {
    await atTime(ON_THE_ROAD, async () => {
      const { db, env } = await fresh();
      const past = await booked(db, "N01");
      const here = await booked(db, "N05");
      await setOff(db, env);
      const at = Date.now();
      await trip(env, [{ event: PICKED, stopId: "N03", at: at }]);
      a.has(lastOf(db, "N01"), "past|", "the stop before was never told gone past, so this proves nothing");
      await trip(env, [{ event: "end", stopId: "", at: at + 30000 }]);
      G.reset();
      await trip(env, [{ event: "undo", undoes: PICKED, stopId: "N03", at: at + 60000 }]);
      await trip(env, [{ event: EMPTY, stopId: "N05", at: at + 60000 }]);
      a.eq(pushesTo(past), 0, "corrected after the run had ended");
      a.eq(pushesTo(here), 0, "told Nobody there after the run had ended");
    });
  });

  return s;
}
