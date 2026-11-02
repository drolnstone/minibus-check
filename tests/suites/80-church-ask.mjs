/* ARE YOU AT CHURCH, 2 November 2026. pages v1.142.0 · server w2.75.0.

   Asim, after 1 Nov: one driver went to WhatsApp after his last pickup, the
   other left his last booked stop unmarked, and neither run ended at Church.
   Five minutes after the run is due at Church, and ten after that, the
   driver of a run still open is woken unless the driving phone is still
   talking. The push asks about the first booked stop unanswered, else "Are
   you at Church?". A stop answered from that ask is noted "Marked at
   Church.", tells nobody, and shows no time on the passenger page. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday, seedBookings } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-10-18";
const T = (hhmm) => Date.parse(KEY + "T" + hhmm + ":00+01:00");
const AT = (hhmm) => KEY + "T" + hhmm + ":00+01:00";
const EP = "https://push.example/adrian";

export default async function (root) {
  const s = new Suite("are you at Church");
  installGlobals();
  const { mod: W } = await loadWorker(root);

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await seedBookings(db, KEY, [{ route: "North", stopId: "N08", stop: "Stanley Pk" }]);
    await db.prepare("INSERT INTO push_subs (endpoint, role, driver, route, made) VALUES (?, 'driver', 'Bro Adrian', 'North', ?)")
      .bind(EP, Date.now()).run();
    return { db, env };
  }
  const start = (env) => W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian",
    reg: "YS70 PWE", sunday: KEY, events: [{ event: "start", at: T("09:52") }] });
  const last = (db) => db._one("SELECT last FROM push_subs WHERE endpoint=?", EP).last;

  s.test("last booked stop unmarked: asked about it at 11:05, again at 11:15, once each", async (a) => {
    const { db, env } = await fresh();
    await atTime(AT("09:53"), () => start(env));
    await atTime(AT("11:04"), () => W.wakeChurchAsk(env));
    a.eq(last(db), "", "woken before five past");
    await atTime(AT("11:05"), () => W.wakeChurchAsk(env));
    a.eq(last(db), "church|" + KEY + "|North|t1|0");
    const said = await atTime(AT("11:05"), () => W.pushWhat(env, EP));
    a.eq(said.title, "🔴 North: Church 11:00");
    a.eq(said.body, "Did you pick up at Stanley Pk?");
    await db.prepare("UPDATE push_subs SET last=''").run();
    await atTime(AT("11:06"), () => W.wakeChurchAsk(env));
    a.eq(last(db), "", "woken twice for the first ask");
    await atTime(AT("11:15"), () => W.wakeChurchAsk(env));
    a.eq(last(db), "church|" + KEY + "|North|t1|1");
  });

  s.test("every stop answered: Are you at Church?; ended: nothing", async (a) => {
    const { db, env } = await fresh();
    await atTime(AT("10:53"), () => W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian",
      reg: "YS70 PWE", sunday: KEY, events: [{ event: "start", at: T("09:52") },
                                              { event: "pickup", stopId: "N08", at: T("10:52") }] }));
    await atTime(AT("11:05"), () => W.wakeChurchAsk(env));
    const said = await atTime(AT("11:05"), () => W.pushWhat(env, EP));
    a.eq(said.body, "Are you at Church?");
    await atTime(AT("11:06"), () => W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian",
      reg: "YS70 PWE", sunday: KEY, events: [{ event: "end", at: T("11:06"), auto: 1 }] }));
    const after = await atTime(AT("11:07"), () => W.pushWhat(env, EP));
    a.ok(after.title.indexOf("Church") === -1, "an ended run was still asked about: " + after.title);
  });

  s.test("not while the driving phone is still talking", async (a) => {
    const { db, env } = await fresh();
    await atTime(AT("09:53"), () => start(env));
    await db.prepare("INSERT INTO run_phones (trip, phone, seen) VALUES ('t1', 'ph1', ?)").bind(T("11:04")).run();
    await atTime(AT("11:05"), () => W.wakeChurchAsk(env));
    a.eq(last(db), "", "woken with the app on screen");
  });

  s.test("answered at Church: noted, nobody told, no time on the passenger page", async (a) => {
    const { db, env } = await fresh();
    await atTime(AT("09:53"), () => start(env));
    await atTime(AT("11:08"), () => W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian",
      reg: "YS70 PWE", sunday: KEY, events: [{ event: "pickup", stopId: "N08", at: T("11:08"), late: 1 }] }));
    const row = db._one("SELECT fix_note FROM trip_events WHERE trip='t1' AND event='pickup'");
    a.ok(String(row.fix_note).indexOf("Marked at Church.") !== -1, JSON.stringify(row));
    const p = await atTime(AT("11:09"), () => W.tripPayload(env, "dev-N08", "", "", "pid-N08"));
    a.eq(p.mine, "served");
    a.eq(p.servedAt, "");
  });

  const driver = readFileSync(join(root, "index.html"), "utf8");
  const sunday = readFileSync(join(root, "sunday", "index.html"), "utf8");
  s.test("the pages: red ask, Yes only inside the fence, Picked up without a time", (a) => {
    a.ok(driver.includes("'Did you pick up at '+esc(s.stop)+'?'"));
    a.ok(driver.includes('<h2 id="churchTitle">Are you at Church?</h2>'));
    a.ok(driver.includes('if(!(tripAwayEver && tripHomeSince)){ toast("Not at Church.", true); return; }'));
    a.ok(driver.includes(".pick-modal.is-alert .pick-sheet{background:var(--stop);color:var(--stop-on)}"));
    a.ok(driver.includes('<p class="park-due">Parked mileage not received</p>'));
    a.ok(sunday.includes('(live.servedAt ? " at "+esc(live.servedAt) : "")'));
  });

  return s;
}
