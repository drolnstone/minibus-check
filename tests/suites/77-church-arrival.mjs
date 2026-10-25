/* THE TIME AT CHURCH, 17 October 2026. pages v1.127.0 · server w2.68.0.

   Asim: a passenger picked up sees "Church about 10:58" under "Picked up at
   10:42", "Due at church 10:58. Arrival not recorded." once that has passed,
   "At church at 10:57" when the driver app records the bus back inside the
   grounds, and "The bus has finished its run" when the server or End it
   closes the run. The driver app ends a run with the moment it came back
   inside the fence, not three minutes later. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday, seedBookings } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-10-18";
const T = (hhmm) => Date.parse(KEY + "T" + hhmm + ":00+01:00");

export default async function (root) {
  const s = new Suite("church arrival");
  installGlobals();
  const { mod: W } = await loadWorker(root);

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await seedBookings(db, KEY, [{ route: "North", stopId: "N08", stop: "Stanley Pk" }]);
    return { db, env };
  }
  /* North left on time and Stanley Pk, its only booked stop, was Picked up
     at 10:52, on time. */
  const run = (env, more) => W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian",
    reg: "YS70 PWE", sunday: KEY, events: [
      { event: "start", at: T("09:52") },
      { event: "pickup", stopId: "N08", at: T("10:52") }].concat(more || []) });
  const ask = (env) => W.tripPayload(env, "dev-N08", "", "", "pid-N08");

  s.test("picked up: Church about, then Due at church once it has passed", async (a) => {
    const { env } = await fresh();
    await atTime("2026-10-18T10:53:00+01:00", () => run(env));
    const p = await atTime("2026-10-18T10:55:00+01:00", () => ask(env));
    a.eq(p.mine, "served");
    a.eq(p.church && p.church.state, "eta");
    a.eq(p.church && p.church.words, "11:00");
    const q = await atTime("2026-10-18T11:01:00+01:00", () => ask(env));
    a.eq(q.church && q.church.state, "due");
    a.eq(q.church && q.church.words, "11:00");
  });

  s.test("back inside the fence: At church at the time it came back", async (a) => {
    const { env } = await fresh();
    await atTime("2026-10-18T11:01:00+01:00", () => run(env, [{ event: "end", at: T("10:57"), auto: 1 }]));
    const p = await atTime("2026-10-18T11:02:00+01:00", () => ask(env));
    a.eq(p.church && p.church.state, "at");
    a.eq(p.church && p.church.words, "10:57");
  });

  s.test("closed by the server: finished, no time", async (a) => {
    const { env } = await fresh();
    await atTime("2026-10-18T11:31:00+01:00", () => run(env, [{ event: "end", at: T("11:31"), auto: "server" }]));
    const p = await atTime("2026-10-18T11:32:00+01:00", () => ask(env));
    a.eq(p.church && p.church.state, "done");
    a.eq(p.church && p.church.words, undefined);
  });

  s.test("Nobody there carries no church line", async (a) => {
    const { env } = await fresh();
    await atTime("2026-10-18T10:53:00+01:00", () => W.handleTrip(env, { trip: "t1", route: "North",
      driver: "Bro Adrian", reg: "YS70 PWE", sunday: KEY, events: [
        { event: "start", at: T("09:52") }, { event: "empty", stopId: "N08", at: T("10:52") }] }));
    const p = await atTime("2026-10-18T10:55:00+01:00", () => ask(env));
    a.eq(p.servedEvent, "empty");
    a.eq(p.church, undefined);
  });

  /* ------------------------------------------------------------ the pages */
  const sunday = readFileSync(join(root, "sunday", "index.html"), "utf8");
  const driver = readFileSync(join(root, "index.html"), "utf8");

  s.test("the passenger page's words, and it keeps asking while riding", (a) => {
    a.ok(sunday.includes('"Church about <b>"'));
    a.ok(sunday.includes('"Due at Church "+esc(c.words)+". Arrival not recorded."'));
    a.ok(sunday.includes('"At Church at "+esc(c.words)'));
    a.ok(sunday.includes('out.mine==="served" && !liveRiding(out)'));
  });

  s.test("the driver pop-up has no buttons, and the end takes the time back inside", (a) => {
    const at = driver.indexOf('id="churchModal"');
    a.ok(at > 0);
    a.ok(driver.slice(at, driver.indexOf("</div>", at)).indexOf("<button") === -1);
    a.ok(driver.includes("'Due at Church '+esc(t)"));
    a.ok(driver.includes("'Church about <b>'+esc(t)+'</b>'"));
    a.ok(/trip\.ended = \(back && back <= tripNow\(\)\) \? back : tripNow\(\);/.test(driver));
  });

  return s;
}
