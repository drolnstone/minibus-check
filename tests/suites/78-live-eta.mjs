/* THE ESTIMATE FROM WHERE THE BUS IS, 25 October 2026.
   pages v1.130.0 · server w2.72.0 · sheet v1.128.0.

   Asim: the estimate should be as right as it can be, from the bus's
   location and a routing service, Google through his own Apps Script. The
   driving phone sends its fix with every board poll; once a minute the
   server asks the sheet for the drive to the next booked stop in traffic,
   and now and then each leg after it. No fix for two minutes, a tap since,
   or no answer from Google: the stop-tap estimate, as before.

   And the pickup pop-up fixes moved here from the church thread: the held
   estimates go on every tap until the server has it, the estimate raises a
   pop-up only within 1 km of the stop's pin, and one it raised goes back
   down when the stop moves more than a minute away. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday, seedBookings } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";

const KEY = "2026-10-04";
const ME = "Bro Adrian";
const EXEC = "https://script.google.com/macros/s/LIVE/exec";
const at = (hhmm) => KEY + "T" + hhmm + ":00+01:00";
const T = (hhmm) => Date.parse(at(hhmm));
/* Near Scarisbrick Dr, N01, which nobody booked. */
const FIX = { lat: 53.449, lng: -2.9363, acc: 20, age: 0 };

export default async function (root) {
  const s = new Suite("live estimate");
  const G = installGlobals();
  const { mod: W } = await loadWorker(root);

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await seedBookings(db, KEY, [{ route: "North", stopId: "N03", stop: "Litherland Rd" },
                                 { route: "North", stopId: "N08", stop: "Stanley Pk" }]);
    await W.cachePut(env, "sheet_url", { url: EXEC }).run();
    await atTime(at("09:52"), () => W.handleTrip(env, { trip: "t1", route: "North", driver: ME,
      reg: "YS70 PWE", sunday: KEY, phone: "phoneA", events: [{ event: "start", at: T("09:52") }] }));
    return { db, env };
  }
  const board = (env, phone, fix) => W.boardPayload(env, "North", phone, ME, fix);
  /* The sheet's answer to the next call out: the drive to the next stop and
     every leg asked for, from the table given. */
  function sheetSays(next, legs, traffic) {
    G.reset();
    G.reply((url, opts) => {
      const q = JSON.parse(opts.body);
      const back = {};
      for (const l of q.legs || []) if (legs && legs[l.key] !== undefined) back[l.key] = { sec: legs[l.key], traffic: traffic !== false };
      return new Response(JSON.stringify({ ok: true, next: { sec: next, traffic: traffic !== false }, legs: back }), { status: 200 });
    });
  }
  const sheetCalls = () => G.calls.filter((c) => c.url === EXEC).map((c) => JSON.parse(c.opts.body));

  s.test("a fix from the driving phone: the next booked stop from Google's drive time, the next from its leg", async (a) => {
    const { env } = await fresh();
    sheetSays(600, { "N03>N08": 900 });
    const out = await atTime(at("10:10"), () => board(env, "phoneA", FIX));
    const asked = sheetCalls();
    a.eq(asked.length, 1, "one ask of the sheet");
    a.eq(asked[0].action, "route");
    a.eq(asked[0].to.lat, 53.450731, "to Litherland Rd, the next booked stop");
    a.ok(asked[0].legs.some((l) => l.key === "N03>N08"), "and the leg after it");
    a.eq(out.etaLive, true);
    a.eq(out.etas.N03, T("10:20"), "10:10 plus ten minutes");
    /* 10:20 + 75 s at the kerb + 15 minutes = 10:36:15 */
    a.eq(out.etas.N08, T("10:36"));
    const p = await atTime(at("10:11"), () => W.tripPayload(env, "dev-N08", "", "", "pid-N08"));
    a.eq(p.mine, "eta");
    a.eq(p.etaWords, "10:36", "the passenger has the same time");
  });

  s.test("a fix from another phone is not used", async (a) => {
    const { env } = await fresh();
    /* The run's own phone heard from a minute ago, so it still holds it. */
    await atTime(at("10:09"), () => board(env, "phoneA", null));
    sheetSays(600, {});
    const out = await atTime(at("10:10"), () => board(env, "phoneB", FIX));
    a.eq(sheetCalls().length, 0);
    a.eq(out.etaLive, false);
  });

  s.test("asked at most once a minute", async (a) => {
    const { env } = await fresh();
    sheetSays(600, { "N03>N08": 900 });
    await atTime(at("10:10"), () => board(env, "phoneA", FIX));
    await atTime("2026-10-04T10:10:20+01:00", () => board(env, "phoneA", FIX));
    a.eq(sheetCalls().length, 1);
  });

  s.test("two minutes without a fix: the stop-tap estimate again", async (a) => {
    const { env } = await fresh();
    sheetSays(600, { "N03>N08": 900 });
    await atTime(at("10:10"), () => board(env, "phoneA", FIX));
    const still = await atTime("2026-10-04T10:11:30+01:00", () => board(env, "phoneA", null));
    a.eq(still.etaLive, true, "ninety seconds is still fresh");
    const gone = await atTime("2026-10-04T10:12:30+01:00", () => board(env, "phoneA", null));
    a.eq(gone.etaLive, false);
    a.ne(gone.etas.N03, T("10:20"));
  });

  s.test("a tap since: the stop-tap estimate until the route to the new next stop is in", async (a) => {
    const { env } = await fresh();
    sheetSays(600, {});
    await atTime(at("10:10"), () => board(env, "phoneA", FIX));
    await atTime(at("10:21"), () => W.handleTrip(env, { trip: "t1", route: "North", driver: ME,
      reg: "YS70 PWE", sunday: KEY, phone: "phoneA", events: [{ event: "picked", stopId: "N03", at: T("10:21") }] }));
    const after = await atTime("2026-10-04T10:21:10+01:00", () => board(env, "phoneA", null));
    a.eq(after.etaLive, false, "the route was to Litherland Rd");
    sheetSays(840, {});
    const fixN03 = { lat: 53.450731, lng: -2.987178, acc: 15, age: 0 };
    const back = await atTime("2026-10-04T10:21:20+01:00", () => board(env, "phoneA", fixN03));
    a.eq(sheetCalls()[0].to.lat, 53.432312, "asked at once, to Stanley Pk");
    a.eq(back.etaLive, true);
    a.eq(back.etas.N08, T("10:35"), "10:21:20 plus 14 minutes");
  });

  s.test("Google not answering: the stop-tap estimate, and why kept", async (a) => {
    const { env, db } = await fresh();
    G.reset();
    G.reply(new Response(JSON.stringify({ ok: false, error: "Service invoked too many times" }), { status: 200 }));
    const out = await atTime(at("10:10"), () => board(env, "phoneA", FIX));
    a.eq(out.etaLive, false);
    const row = await db.prepare("SELECT err FROM run_live WHERE trip='t1'").first();
    a.has(row && row.err, "too many times");
  });

  s.test("a vague or old fix is not taken", async (a) => {
    const { env } = await fresh();
    sheetSays(600, {});
    await atTime(at("10:10"), () => board(env, "phoneA", { lat: 53.449, lng: -2.9363, acc: 900, age: 0 }));
    await atTime(at("10:10"), () => board(env, "phoneA", { lat: 53.449, lng: -2.9363, acc: 20, age: 5 * 60000 }));
    a.eq(sheetCalls().length, 0);
  });

  /* ------------------------------------------------------------ the sheet */
  function sheet(reply) {
    const L = loadCodeGs(root, {});
    L.gas.setMapsReply(reply);
    return L;
  }
  const leg = (sec, traffic) => () => ({ routes: [{ legs: [Object.assign({ duration: { value: sec } },
    traffic ? { duration_in_traffic: { value: traffic } } : {})] }] });
  const ask = { from: { lat: 53.449, lng: -2.936 }, to: { lat: 53.45, lng: -2.98 }, depart: 0,
                legs: [{ key: "N03>N08", from: { lat: 53.45, lng: -2.98 }, to: { lat: 53.43, lng: -2.95 } }] };

  s.test("the sheet: Google's time in traffic, for the next stop and each leg", async (a) => {
    await atTime(at("10:10"), () => {
      const L = sheet(leg(500, 620));
      const out = call(L, "routeTimes", ask);
      a.eq(out.ok, true);
      a.eq(out.next.sec, 620); a.eq(out.next.traffic, true);
      a.eq(out.legs["N03>N08"].sec, 620);
      a.eq(L.gas.mapsAsked.length, 2, "one leg at a time");
      a.ok(L.gas.mapsAsked[0].depart instanceof L.ctx.Date || typeof L.gas.mapsAsked[0].depart.getTime === "function",
           "a departure time, which is what brings traffic");
      const r = call(L, "healthReport");
      a.has(r.good.join(" | "), "Traffic times from Google Maps: coming through, last Sun 4 Oct 10:10.");
    });
  });

  s.test("the sheet: no traffic given, road times used and said", async (a) => {
    await atTime(at("10:10"), () => {
      const L = sheet(leg(500));
      const out = call(L, "routeTimes", ask);
      a.eq(out.next.sec, 500); a.eq(out.next.traffic, false);
      a.has(call(L, "healthReport").bad.join(" | "), "Traffic times from Google Maps: not given");
    });
  });

  s.test("the sheet: Google failing is said in the health report", async (a) => {
    await atTime(at("10:10"), () => {
      const L = sheet(null);
      const out = call(L, "routeTimes", ask);
      a.eq(out.ok, false);
      a.has(call(L, "healthReport").bad.join(" | "), "Google Maps did not answer the live estimate at Sun 4 Oct 10:10");
    });
  });

  s.test("the sheet: route wants the sheet's own password", async (a) => {
    const src = readFileSync(join(root, "Code.gs"), "utf8");
    a.has(src, '"drainnow", "route"]');
  });

  /* ---------------------------------------------------- the driver app */
  const page = readFileSync(join(root, "index.html"), "utf8");
  const grab = (name) => {
    const i = page.indexOf("function " + name + "(");
    let depth = 0, j = page.indexOf("{", i);
    for (let k = j; k < page.length; k++) {
      if (page[k] === "{") depth++;
      else if (page[k] === "}") { depth--; if (!depth) return page.slice(i, k + 1); }
    }
    return "";
  };
  function pop(over) {
    const ctx = vm.createContext(Object.assign({
      Date, Math, Number, String, isFinite,
      PICK_CLOSE_MIN: 1, PICK_FAR_M: 1000, rotaStopEtas: {}, pickFix: null, pickEtaWait: null,
      pickLeft: () => true, pickHere: () => false, tripNow: () => Date.now(),
      geoTo: (lat, lng, b) => Math.hypot((lat - b.lat) * 111000, (lng - b.lng) * 66000)
    }, over || {}));
    vm.runInContext(["pickEta", "pickDueWhy", "pickFar", "pickEtaHold", "pickEtaHeard"].map(grab).join("\n"), ctx);
    return ctx;
  }
  const OTTLEY = { id: "S02", lat: 53.4140135, lng: -2.945019183 };

  s.test("the pop-up: a minute away by the estimate but 3 km off by GPS stays down", async (a) => {
    const now = Date.now();
    const c = pop({ rotaStopEtas: { S02: now + 50000 },
                    pickFix: { lat: 53.3894, lng: -2.8531, acc: 20, at: now } });
    a.eq(c.pickDueWhy(OTTLEY), "");
    c.pickFix = { lat: 53.4135, lng: -2.9455, acc: 20, at: now };
    a.eq(c.pickDueWhy(OTTLEY), "eta", "within 1 km");
    c.pickFix = null;
    a.eq(c.pickDueWhy(OTTLEY), "eta", "no fix: the estimate alone");
  });

  s.test("the pop-up: a tap drops the estimates until the server has it", async (a) => {
    const c = pop({ rotaStopEtas: { S02: 1 } });
    c.pickEtaHold("S01", "pickup");
    a.eq(Object.keys(c.rotaStopEtas).length, 0);
    a.eq(c.pickEtaHeard({}), false, "an answer without the tap");
    a.eq(c.pickEtaHeard({ S01: { event: "pickup" } }), true);
    a.eq(c.pickEtaWait, null);
    c.pickEtaHold("S01", "");
    a.eq(c.pickEtaHeard({ S01: { event: "pickup" } }), false, "an Undo the server has not had");
    a.eq(c.pickEtaHeard({}), true);
  });

  s.test("the driver app: taps, Undo, the drop back down and the fix on the board poll", async (a) => {
    a.has(grab("tripTap"), "pickEtaHold(stop.id, kind)");
    a.has(grab("tripUndo"), 'pickEtaHold(stop.id, "")');
    a.has(grab("pickSync"), 'pickWhy === "eta"');
    a.has(grab("rotaCountsFetch"), "boardFixPart(route)");
    a.has(grab("boardFixPart"), "fixAge=");
  });

  return s;
}
