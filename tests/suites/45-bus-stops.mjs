/* THE BUS STOPS TAB FROM THE COORDINATOR'S APP. pages v1.93.0 · server
   w2.35.0 · sheet v1.98.0.

   - A stop's Time, place, Postcode, Where, Active and Type are changed, and a
     stop is added with the next number on its route, from the coordinator's
     app.
   - The stops table has it at once, in its place on the route, and keeps it
     through a push from the sheet until the sheet has filed it.
   - A time out of order, a second Depart, a stop with seats booked switched
     off: each refused. A new postcode clears the old kerb's pin.
   - The sheet writes the cells, the time as text, a new row in its place,
     and History.

   Everything here fails on w2.34.0 / v1.97.0. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab, TABS } from "../lib/tabs.mjs";
import { seedSunday, STOPS } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const THU = "2026-10-01T12:00:00+01:00";
const KEY = "2026-10-04";
const PIN = "1234";
const TYPE = { depart: "Depart", arrival: "Arrival", pickup: "Pickup" };

export default async function (root) {
  const s = new Suite("the Bus Stops tab from the coordinator's app");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  /* The shelf as a v1.98.0 sheet sends it: every row, in the tab's order,
     with one switched-off stop the stops table does not hold. */
  const SHELF = STOPS.map((x) => ({ id: x.id, route: x.route, time: x.time, stop: x.stop, postcode: "L4 1AA", where: "",
    active: true, type: TYPE[x.kind], lat: x.lat, lng: x.lng, hasPin: true }));
  SHELF.splice(SHELF.findIndex((x) => x.id === "N05"), 0,
    { id: "N11", route: "North", time: "10:36", stop: "Old Stop", postcode: "", where: "", active: false, type: "Pickup", lat: "", lng: "", hasPin: false });

  async function fresh(noShelf) {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await db.prepare("DELETE FROM drivers").run();
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
      .bind("Bro Arthur", "Coordinator", "North", 1, await W.pinHashOf(env, "Bro Arthur", PIN)).run();
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    await W.cachePut(env, "coord_shelf", Object.assign({ builtAt: Date.now(), readAt: Date.now(), requests: [], defects: [] },
      noShelf ? {} : { stops: SHELF.map((x) => Object.assign({}, x)) })).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const coord = async (env, body) => J(await post(env, Object.assign({ action: "coord", who: "Bro Arthur", pin: PIN }, body)));
  let n = 0;
  const act = (env, a) => coord(env, { op: "act", act: Object.assign({ id: "stop-act-" + (++n) }, a) });
  const order = async (env, rt) => (await W.getStops(env)).filter((x) => x.route === rt).map((x) => x.id);
  const stop = async (env, id) => (await W.getStops(env)).find((x) => x.id === id);

  s.test("a stop changed: the stops table at once, the pin cleared with a new postcode, and the words", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "stop", stopId: "n03", set: { time: "10:26", stop: "Litherland Road", postcode: "l20 3hz", where: "12 Litherland Rd" } });
      a.ok(out.ok, JSON.stringify(out));
      a.has(out.action.words, "N03: at 10:26, now Litherland Road, postcode L20 3HZ, where changed, pin cleared.");
      const x = await stop(env, "N03");
      a.eq([x.time, x.stop, x.postcode, x.where, x.lat].join("|"), "10:26|Litherland Road|L20 3HZ|12 Litherland Rd|");
      const reg = (await coord(env, { op: "load" })).stopsReg;
      const v = reg.stops.find((y) => y.id === "N03");
      a.ok(v.waiting && !v.hasPin, JSON.stringify(v));
      a.ok(reg.stops.find((y) => y.id === "N11" && !y.active), "the switched-off stop is not on the screen");
    });
  });

  s.test("a stop added takes the next number and its place by time, and a push does not undo it", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      const out = await act(env, { kind: "stop", add: true, set: { route: "North", time: "10:28", stop: "Bootle Village", postcode: "L20 4AA" } });
      a.ok(out.ok, JSON.stringify(out));
      a.has(out.action.words, "N12 added: 10:28, Bootle Village.");
      a.eq((await order(env, "North")).join(" "), "N00 N01 N02 N03 N12 N04 N05 N06 N07 N08 N09");
      const reg = (await coord(env, { op: "load" })).stopsReg.stops.map((x) => x.id);
      a.eq(reg.indexOf("N12"), reg.indexOf("N03") + 1);
      /* What a push does: the table rewritten from the sheet, which has not
         filed it yet. */
      await db.prepare("DELETE FROM stops").run();
      await seedSunday(db, KEY);
      await W.reapplyStops(env);
      a.eq((await order(env, "North")).join(" "), "N00 N01 N02 N03 N12 N04 N05 N06 N07 N08 N09");
      /* Switched back on: in its place too. */
      const on = await act(env, { kind: "stop", stopId: "N11", set: { active: true } });
      a.ok(on.ok, JSON.stringify(on));
      a.eq((await order(env, "North")).join(" "), "N00 N01 N02 N03 N12 N04 N11 N05 N06 N07 N08 N09");
    });
  });

  s.test("out of order, a second Depart, a bad postcode or time, seats booked: each refused", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      a.has(String((await act(env, { kind: "stop", stopId: "N03", set: { time: "10:40" } })).error), "from 10:15 to 10:32");
      a.has(String((await act(env, { kind: "stop", stopId: "N03", set: { type: "Depart" } })).error), "Depart");
      a.has(String((await act(env, { kind: "stop", add: true, set: { route: "South", time: "10:00", stop: "Church", type: "Depart" } })).error), "Depart");
      a.has(String((await act(env, { kind: "stop", add: true, set: { route: "South", time: "11:30", stop: "Late Rd" } })).error), "Pick a time");
      a.has(String((await act(env, { kind: "stop", stopId: "N03", set: { postcode: "L20" } })).error), "postcode");
      a.has(String((await act(env, { kind: "stop", stopId: "N03", set: { time: "25:00" } })).error), "10:35");
      a.has(String((await act(env, { kind: "stop", stopId: "N03", set: { time: "10:24" } })).error), "Nothing");
      a.not((await act(env, { kind: "stop", add: true, set: { time: "10:20", stop: "No Route" } })).ok);
      await db.prepare("INSERT INTO bookings (sunday, route, stop_id, stop, seats, status, received) VALUES (?,?,?,?,?,?,?)")
        .bind(KEY, "South", "S03", "Sedley St", 2, "Booked", Date.now()).run();
      a.has(String((await act(env, { kind: "stop", stopId: "S03", set: { active: false } })).error), "2 seats booked at S03");
      a.ok(await stop(env, "S03"), "S03 was taken off with seats booked");
      const off = await act(env, { kind: "stop", stopId: "S02", set: { active: false } });
      a.ok(off.ok, JSON.stringify(off));
      a.eq(await stop(env, "S02"), undefined);
    });
  });

  s.test("before the sheet has sent the Bus Stops tab, a change is refused and the screen is not offered", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh(true);
      a.not((await act(env, { kind: "stop", stopId: "N03", set: { time: "10:26" } })).ok);
      a.eq((await coord(env, { op: "load" })).stopsReg, null);
    });
  });

  s.test("the sheet writes the cells, the time as text, a new row in its place, and History", async (a) => {
    await atTime(THU, async () => {
      const rows = STOPS.filter((x) => x.route === "North").map((x) => ({ Route: x.route, "Stop ID": x.id, Time: x.time, Stop: x.stop,
        Postcode: "L4 1AA", Active: "YES", Type: TYPE[x.kind], Lat: x.lat, Lng: x.lng }));
      const L = loadCodeGs(root, { tabs: { "Bus Stops": tab("Bus Stops", rows) }, props: {} });
      const ss = L.gas.ss;
      call(L, "stopsAudit", ss, "setup", "");
      const A = (id, body) => ({ id, kind: "stop", sunday: "", by: "Bro Arthur", made: Date.now(), body });
      const r1 = call(L, "applyCoordAction", ss, A("s1", { id: "N03", set: { time: "10:26", stop: "Litherland Road", postcode: "L20 3HZ" }, pinCleared: true }), {});
      a.ok(r1.done && r1.ok, JSON.stringify(r1));
      const r2 = call(L, "applyCoordAction", ss, A("s2", { id: "N10", add: true,
        set: { route: "North", time: "10:28", stop: "Bootle Village", postcode: "L20 4AA", where: "", active: true, type: "Pickup" } }), {});
      a.ok(r2.done && r2.ok, JSON.stringify(r2));
      const g = ss.getSheetByName("Bus Stops").getDataRange().getValues();
      const H = g[0];
      const objs = g.slice(1).map((r) => { const o = {}; H.forEach((h, i) => { o[h] = r[i]; }); return o; });
      a.eq(objs.map((o) => o["Stop ID"]).join(" "), "N00 N01 N02 N03 N10 N04 N05 N06 N07 N08 N09");
      const n3 = objs.find((o) => o["Stop ID"] === "N03"), n10 = objs.find((o) => o["Stop ID"] === "N10");
      a.eq([n3.Time, n3.Stop, n3.Postcode, n3.Lat, n3.Lng].join("|"), "10:26|Litherland Road|L20 3HZ||");
      a.eq([n10.Route, n10.Time, n10.Stop, n10.Active, n10.Type].join("|"), "North|10:28|Bootle Village|YES|Pickup");
      const fmt = (L.gas.ss.getSheetByName("Bus Stops").cosmetic || []).filter((c) => c[0] === "format" && c[3] === "@");
      a.ok(fmt.length >= 2, "the time was not written as text");
      const hg = ss.getSheetByName("History").getDataRange().getValues();
      const what = hg.slice(1).map((r) => r[hg[0].indexOf("What changed")]);
      for (const w of ["Stop N03: the place", "Stop N03: time", "Stop N03: postcode", "Stop N03: pin cleared", "Stop N10 added"]) {
        a.ok(what.indexOf(w) !== -1, w + " not on History: " + what.join(" | "));
      }
      const r3 = call(L, "applyCoordAction", ss, A("s3", { id: "N04", set: { time: "10:50" } }), {});
      a.not(r3.ok, "a time out of order was written");
      a.has(r3.result, "Pick a time");
      const r4 = call(L, "applyCoordAction", ss, A("s4", { id: "n10", add: true, set: { route: "North", time: "10:29", stop: "Again" } }), {});
      a.not(r4.ok, "a second N10 was added");
      const shelf = call(L, "coordStopsList", ss);
      a.eq(shelf.find((x) => x.id === "N03").hasPin, false);
      a.eq(shelf.find((x) => x.id === "N04").hasPin, true);
    });
  });

  s.test("three stops added in one gap keep their order on the stops table, through a push", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      for (const t of ["10:26", "10:28", "10:30"]) {
        const out = await act(env, { kind: "stop", add: true, set: { route: "North", time: t, stop: "Stop at " + t } });
        a.ok(out.ok, JSON.stringify(out));
      }
      const want = "N00 N01 N02 N03 N12 N13 N14 N04 N05 N06 N07 N08 N09";
      a.eq((await order(env, "North")).join(" "), want);
      await db.prepare("DELETE FROM stops").run();
      await seedSunday(db, KEY);
      await W.reapplyStops(env);
      a.eq((await order(env, "North")).join(" "), want);
    });
  });

  s.test("a switched-off row's old time does not decide where a new stop goes", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const shelf = SHELF.map((x) => Object.assign({}, x, x.id === "N11" ? { time: "10:20" } : {}));
      await W.cachePut(env, "coord_shelf", { builtAt: Date.now(), readAt: Date.now(), requests: [], defects: [], stops: shelf }).run();
      const out = await act(env, { kind: "stop", add: true, set: { route: "North", time: "10:28", stop: "Bootle Village" } });
      a.ok(out.ok, JSON.stringify(out));
      const reg = (await coord(env, { op: "load" })).stopsReg.stops.map((x) => x.id);
      a.eq(reg.indexOf("N12"), reg.indexOf("N03") + 1, reg.join(" "));
    });
  });

  s.test("spacing and capitals in a postcode, or a line break in Where, are not a change: the pin stays", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const shelf = SHELF.map((x) => Object.assign({}, x, x.id === "N03" ? { postcode: "l41aa", where: "12 Litherland Rd\nBootle" } : {}));
      await W.cachePut(env, "coord_shelf", { builtAt: Date.now(), readAt: Date.now(), requests: [], defects: [], stops: shelf }).run();
      const out = await act(env, { kind: "stop", stopId: "N03", set: { time: "10:26", postcode: "L4 1AA", where: "12 Litherland Rd Bootle" } });
      a.ok(out.ok, JSON.stringify(out));
      a.eq(out.action.words, "N03: at 10:26.");
      a.ok((await stop(env, "N03")).lat, "the pin was cleared");
      a.has(String((await act(env, { kind: "stop", stopId: "N03", set: { postcode: "L41AA" } })).error), "Nothing");
    });
  });

  s.test("after this Sunday's run, a stop whose seats were used can be switched off; before it, not", async (a) => {
    const booked = async (db) => db.prepare("INSERT INTO bookings (sunday, route, stop_id, stop, seats, status, received) VALUES (?,?,?,?,?,?,?)")
      .bind(KEY, "South", "S03", "Sedley St", 2, "Booked", Date.now()).run();
    await atTime("2026-10-04T09:00:00+01:00", async () => {
      const { db, env } = await fresh();
      await booked(db);
      a.has(String((await act(env, { kind: "stop", stopId: "S03", set: { active: false } })).error), "2 seats booked at S03");
    });
    await atTime("2026-10-04T14:00:00+01:00", async () => {
      const { db, env } = await fresh();
      await booked(db);
      const off = await act(env, { kind: "stop", stopId: "S03", set: { active: false } });
      a.ok(off.ok, JSON.stringify(off));
    });
  });

  s.test("the sheet: the pin kept, a switched-off row passed over, a first row under the header, 9:52, a row with no stop", async (a) => {
    await atTime(THU, async () => {
      const rows = STOPS.filter((x) => x.route === "North").map((x) => ({ Route: x.route, "Stop ID": x.id, Time: x.time, Stop: x.stop,
        Postcode: x.id === "N03" ? "L41AA" : "L4 1AA", Active: "YES", Type: TYPE[x.kind], Lat: x.lat, Lng: x.lng }));
      rows[0].Time = "9:52";
      rows.splice(6, 0, { Route: "North", "Stop ID": "N11", Time: "10:20", Stop: "Old Stop", Active: "NO", Type: "Pickup" });
      rows.push({ Route: "North", "Stop ID": "N12" });
      rows.push({ Route: "North", "Stop ID": "N13", Time: "11:05", Stop: "Late Rd", Active: "NO", Type: "Pickup" });
      const L = loadCodeGs(root, { tabs: { "Bus Stops": tab("Bus Stops", rows) }, props: {} });
      const ss = L.gas.ss;
      call(L, "stopsAudit", ss, "setup", "");
      const A = (id, body) => ({ id, kind: "stop", sunday: "", by: "Bro Arthur", made: Date.now(), body });
      const ids = () => ss.getSheetByName("Bus Stops").getDataRange().getValues().slice(1).map((r) => r[TABS["Bus Stops"].indexOf("Stop ID")]);
      const list = call(L, "coordStopsList", ss);
      a.eq(list.find((x) => x.id === "N00").time, "09:52");
      a.eq(list.find((x) => x.id === "N12").active, false);
      a.eq(call(L, "readBusStopsFresh", ss).find((x) => x.id === "N00").time, "09:52");

      const r1 = call(L, "applyCoordAction", ss, A("s1", { id: "N03", set: { time: "10:26", postcode: "L4 1AA" } }), {});
      a.ok(r1.ok, JSON.stringify(r1));
      const n3 = call(L, "coordStopsList", ss).find((x) => x.id === "N03");
      a.ok(n3.hasPin, "the pin was cleared for spacing");
      const r2 = call(L, "applyCoordAction", ss, A("s2", { id: "N14", add: true,
        set: { route: "North", time: "10:28", stop: "Bootle Village", postcode: "", where: "", active: true, type: "Pickup" } }), {});
      a.ok(r2.ok, JSON.stringify(r2));
      a.eq(ids().indexOf("N14"), ids().indexOf("N03") + 1, ids().join(" "));
      const r3 = call(L, "applyCoordAction", ss, A("s3", { id: "N01", set: { where: "By the shop" } }), {});
      a.ok(r3.ok, JSON.stringify(r3));
      const r4 = call(L, "applyCoordAction", ss, A("s4", { id: "N09", set: { time: "11:02" } }), {});
      a.ok(r4.ok, JSON.stringify(r4));
      const r5 = call(L, "applyCoordAction", ss, A("s5", { id: "N13", set: { active: true } }), {});
      a.not(r5.ok, "a pickup below the Arrival was switched on");
      a.has(r5.result, "Move its row above the Arrival");
      const r6 = call(L, "applyCoordAction", ss, A("s6", { id: "N00", set: { time: "10:05" } }), {});
      a.has(r6.result, "Pick a time up to 10:03.");

      /* A new Depart, the old one switched off: first on the tab, in a data row. */
      a.ok(call(L, "applyCoordAction", ss, A("s7", { id: "N00", set: { active: false } }), {}).ok);
      const r8 = call(L, "applyCoordAction", ss, A("s8", { id: "N15", add: true,
        set: { route: "North", time: "09:50", stop: "Church Gate", postcode: "", where: "", active: true, type: "Depart" } }), {});
      a.ok(r8.ok, JSON.stringify(r8));
      a.eq(ids().slice(0, 3).join(" "), "N15 N00 N01");
      const sh = ss.getSheetByName("Bus Stops");
      const H = TABS["Bus Stops"];
      const row3 = sh.getRange(3, 1, 1, H.length).getValues()[0];
      a.eq([row3[H.indexOf("Stop")], row3[H.indexOf("Active")], row3[H.indexOf("Lat")]].join("|"), "Church|NO|" + STOPS[0].lat);
    });
  });

  return s;
}
