/* A SECOND TRIP FOR OVERFLOW. 22 November 2026. server w2.106.0.

   Asim: a route booked over its bus's seats when bookings close is split at
   09:31 into Trip 1 (farthest stops first, until the next would not fit) and
   Trip 2 (the rest), the same bus going back out once Trip 1 has ended at
   Church. Coordinators and the driver told at 09:31; a coordinator can call
   it off or move a stop until 09:45; Trip 2's passengers told at 09:45 with
   an estimated time; Trip 2 then runs like Trip 1. Also: a morning only hand
   over goes back after the morning's last trip. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday, seedBookings } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const KEY = "2026-11-22";
const T = (hhmm) => KEY + "T" + hhmm + ":00Z";          /* London is UTC in November */
const at = (hhmm) => new Date(T(hhmm)).getTime();
const PIN = "1234";
const PH = "07700900111";

export default async function (root) {
  const s = new Suite("second trip for overflow");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  /* North's bus seats 16. 22 booked: Scarisbrick 7, Grace 5, Litherland 3
     (15 on Trip 1), then Bedford 4 and Pym 3 on Trip 2. */
  async function fresh(over) {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    for (const d of [["Bro Asim", "Coordinator", "North"], ["Bro Adrian", "Driver", "North"], ["Bro Trevor", "Driver", "South"], ["Bro Moses", "Driver", "North"]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind(d[0], d[1], d[2], await W.pinHashOf(env, d[0], PIN)).run();
    }
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    const pid = await W.passengerId(env, PH);
    await db.prepare("INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, made) VALUES (?,?,?,?,?,?,?)")
      .bind("https://push.test/p", "p", "a", "passenger", "dev", pid, Date.now()).run();
    await seedBookings(db, KEY, (over || [
      { route: "North", stopId: "N01", seats: 7 }, { route: "North", stopId: "N02", seats: 5 },
      { route: "North", stopId: "N03", seats: 3 }, { route: "North", stopId: "N05", seats: 4, pid, device: "dev" },
      { route: "North", stopId: "N06", seats: 3 }, { route: "South", stopId: "S02", seats: 2 }
    ]));
    return { db, env, pid };
  }
  const ids = (list, rt) => list.filter((x) => x.route === rt && !x.depart && !x.arrival).map((x) => x.id).join(",");
  const tap = (env, events, trip, driver) => W.handleTrip(env, {
    trip: trip || "t1", route: "North", driver: driver || "Bro Adrian", reg: "YS70 PWE", sunday: KEY, phone: "p1", events });
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  let n = 0;
  const act = async (env, a) => J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN, op: "act",
    act: Object.assign({ id: "split-act-" + (++n), kind: "tripsplit" }, a) }));
  const box = async (env) => ((await W.cacheGet(env, W.coordBoxKey("https://push.test/p"))) || []);

  s.test("at 09:31 an overbooked route splits: Trip 1 the farthest stops until full, Trip 2 the rest", async (a) => {
    const { env } = await fresh();
    await atTime(T("09:30"), () => W.sweepTripSplit(env));
    a.eq((await W.splitDay(env, KEY)), null, "nothing before 09:31");
    await atTime(T("09:31"), () => W.sweepTripSplit(env));
    const day = await W.splitDay(env, KEY);
    a.ok(day && day.North && day.North.t2, JSON.stringify(day));
    a.eq(day.North.t1.join(","), "N01,N02,N03,N04");
    a.eq(day.North.t2.join(","), "N05,N06,N07,N08");
    a.eq(day.North.b1, 15); a.eq(day.North.b2, 7);
    a.eq(day.South.none, "fits", "South fits its bus");
    const list = await atTime(T("09:32"), () => W.getStops(env));
    a.eq(ids(list, "North"), "N01,N02,N03,N04", "Trip 1 is the run");
    a.eq(ids(list, "North~2"), "N05,N06,N07,N08");
    a.hasnt(W.routeNames(list).join(","), "~");
    a.ok(/^\d\d:\d\d$/.test(day.North.dep) && day.North.dep > "10:30", "Trip 2 leaves after Trip 1 is back: " + day.North.dep);
    a.ok(day.North.times.N05 > day.North.dep && day.North.times.N06 >= day.North.times.N05, JSON.stringify(day.North.times));
  });

  s.test("a passenger on Trip 2 is told at 09:45 with a time, and not before", async (a) => {
    const { env } = await fresh();
    await atTime(T("09:31"), () => W.sweepTripSplit(env));
    const before = await atTime(T("09:40"), async () => W.tripPayload(env, "dev", "", "", await W.passengerId(env, PH)));
    a.eq(before.trip, 0); a.eq(before.scheduled, "10:39", "the timetable time until told");
    a.eq(before.route, "North");
    a.eq((await box(env)).length, 0);
    await atTime(T("09:45"), () => W.sweepTripSplit(env));
    const m = await box(env);
    a.eq(m.length, 1, JSON.stringify(m));
    a.eq(m[0].title, "Second trip");
    a.has(m[0].body, "You are on the second trip. Your bus is due about ");
    const after = await atTime(T("09:46"), async () => W.tripPayload(env, "dev", "", "", await W.passengerId(env, PH)));
    a.eq(after.trip, 2);
    a.eq(after.scheduled, (await W.splitDay(env, KEY)).North.times.N05);
    await atTime(T("09:47"), () => W.sweepTripSplit(env));
    a.eq((await box(env)).length, 1, "told once");
  });

  s.test("Trip 1 ends at Church, then Trip 2 is the route's run on its own times", async (a) => {
    const { env } = await fresh();
    await atTime(T("09:31"), () => W.sweepTripSplit(env));
    await atTime(T("09:52"), () => tap(env, [{ event: "start", at: at("09:52") }]));
    await atTime(T("10:40"), () => tap(env, [{ event: "end", at: at("10:40"), auto: 1 }]));
    const gap = await atTime(T("10:41"), () => W.tripState(env, KEY, "North"));
    a.ok(!gap.started, "between the trips the route has no run");
    a.eq(gap.leg, 2);
    const one = await atTime(T("10:41"), () => W.tripState(env, KEY, "North~1"));
    a.eq(one.trip, "t1"); a.ok(one.ended);
    await atTime(T("10:41"), () => W.sweepTripSplit(env));
    const rec = (await W.splitDay(env, KEY)).North;
    a.eq(rec.dep, "10:45", "Trip 1's end plus five minutes");
    const list = await atTime(T("10:42"), () => W.getStops(env));
    a.eq(ids(list, "North"), "N05,N06,N07,N08");
    a.eq(ids(list, "North~1"), "N01,N02,N03,N04");
    a.eq(list.find((x) => x.route === "North" && x.depart).time, "10:45");
    const sv = await atTime(T("10:42"), async () => W.splitView(env, KEY, "North", await W.getStops(env, KEY, { noSplit: true })));
    a.ok(sv.ready, "Start trip 2 is offered");
    const started = await J(await atTime(T("10:46"), () => tap(env, [{ event: "start", at: at("10:46") }], "t2")));
    a.ok(started.ok, JSON.stringify(started));
    const two = await atTime(T("10:47"), () => W.tripState(env, KEY, "North"));
    a.eq(two.trip, "t2"); a.eq(two.leg, 2);
    a.eq(two.offset, 1, "late from Trip 2's own departure, not the timetable's");
  });

  s.test("the driver is reminded once, ten minutes after Trip 1 ended", async (a) => {
    const { env } = await fresh();
    await atTime(T("09:31"), () => W.sweepTripSplit(env));
    await atTime(T("09:52"), () => tap(env, [{ event: "start", at: at("09:52") }]));
    await atTime(T("10:40"), () => tap(env, [{ event: "end", at: at("10:40"), auto: 1 }]));
    await atTime(T("10:49"), () => W.sweepTripSplit(env));
    a.ok(!(await W.splitDay(env, KEY)).North.reminded);
    await atTime(T("10:50"), () => W.sweepTripSplit(env));
    a.ok((await W.splitDay(env, KEY)).North.reminded);
  });

  s.test("a coordinator calls it off before 09:45; after 09:45 it stands", async (a) => {
    const { env } = await fresh();
    await atTime(T("09:31"), () => W.sweepTripSplit(env));
    const moved = await atTime(T("09:35"), () => act(env, { route: "North", op: "move", stopId: "N05" }));
    a.ok(moved.ok, JSON.stringify(moved));
    a.eq((await W.splitDay(env, KEY)).North.t2.join(","), "N06,N07,N08");
    const off = await atTime(T("09:36"), () => act(env, { route: "North", op: "stop" }));
    a.ok(off.ok, JSON.stringify(off));
    const list = await atTime(T("09:37"), () => W.getStops(env));
    a.eq(ids(list, "North"), "N01,N02,N03,N04,N05,N06,N07,N08");
    await atTime(T("09:45"), () => W.sweepTripSplit(env));
    a.eq((await box(env)).length, 0, "nobody told of a split called off");
    const late = await atTime(T("09:46"), () => act(env, { route: "North", op: "split" }));
    a.ok(!late.ok); a.has(late.error, "Passengers were told at 09:45.");
  });

  s.test("morning only: the run goes back after the morning's last trip", async (a) => {
    const { db, env } = await fresh();
    await atTime(T("09:31"), () => W.sweepTripSplit(env));
    await atTime(T("09:52"), () => tap(env, [{ event: "start", at: at("09:52") }]));
    await W.handBackAdd(env, { sunday: KEY, route: "North", trip: "t1", to: "Bro Moses", back: "Bro Adrian",
                               cover: "", field: "northCover", by: "Bro Asim", at: at("10:00") });
    await atTime(T("10:40"), () => tap(env, [{ event: "end", at: at("10:40"), auto: 1 }]));
    await atTime(T("10:41"), () => W.sweepHandBack(env));
    a.ok(!(await W.handBackAll(env))[0].done, "not after Trip 1 of a split route");
    await atTime(T("10:46"), () => tap(env, [{ event: "start", at: at("10:46") }], "t2", "Bro Moses"));
    await atTime(T("11:20"), () => tap(env, [{ event: "end", at: at("11:20"), auto: 1 }], "t2", "Bro Moses"));
    await atTime(T("11:21"), () => W.sweepHandBack(env));
    a.ok((await W.handBackAll(env))[0].done, "after Trip 2");
    const h = db._one("SELECT to_driver FROM handovers WHERE trip='t2'");
    a.eq(h && h.to_driver, "Bro Adrian");
    const rota = db._rows("SELECT body FROM coord_actions WHERE kind='rota'").map((r) => JSON.parse(r.body));
    a.eq(rota.length, 1, JSON.stringify(rota));
    a.eq(rota[0].set.northCover, "");
  });

  /* w2.107.0: a stop moved onto a split route goes into the trip picked. */
  const southPid = async (env) => {
    const pid = await W.passengerId(env, PH);
    return [
      { route: "North", stopId: "N01", seats: 7 }, { route: "North", stopId: "N02", seats: 5 },
      { route: "North", stopId: "N03", seats: 3 }, { route: "North", stopId: "N05", seats: 4 },
      { route: "North", stopId: "N06", seats: 3 }, { route: "South", stopId: "S02", seats: 2, pid, device: "dev" }];
  };
  const freshSouth = async () => {
    const f = await fresh();
    await f.db.prepare("DELETE FROM bookings").run();
    await seedBookings(f.db, KEY, await southPid(f.env));
    return f;
  };
  const move = async (env, a) => J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN, op: "act",
    act: Object.assign({ id: "mv-act-" + (++n), kind: "stopmove", op: "move" }, a) }));

  s.test("moved onto a split route after 09:45: Trip 2 picked, its passengers told with a time", async (a) => {
    const { env } = await freshSouth();
    await atTime(T("09:31"), () => W.sweepTripSplit(env));
    await atTime(T("09:45"), () => W.sweepTripSplit(env));
    const none = await atTime(T("10:00"), () => move(env, { stopId: "S02", after: "N06", time: "10:43" }));
    a.ok(!none.ok); a.eq(none.error, "Pick Trip 1 or Trip 2.");
    const r = await atTime(T("10:00"), () => move(env, { stopId: "S02", after: "N06", trip: 2 }));
    a.ok(r.ok, JSON.stringify(r));
    const rec = (await W.splitDay(env, KEY)).North;
    a.eq(rec.t2.join(","), "N05,N06,S02,N07,N08");
    a.ok(/^\d\d:\d\d$/.test(rec.times.S02) && rec.times.S02 >= rec.times.N06, JSON.stringify(rec.times));
    const m = await box(env);
    a.eq(m.length, 1, JSON.stringify(m));
    a.eq(m[0].title, "North bus at Vicar Rd");
    a.has(m[0].body, "the North bus picks you up on its second trip, about " + rec.times.S02 + ". After service, the South bus home.");
    const list = await atTime(T("10:01"), () => W.getStops(env));
    a.eq(ids(list, "North~2"), "N05,N06,S02,N07,N08");
    const p = await atTime(T("10:01"), async () => W.tripPayload(env, "dev", "", "", await W.passengerId(env, PH)));
    a.eq(p.trip, 2); a.eq(p.route, "North"); a.eq(p.scheduled, rec.times.S02);
  });

  s.test("moved onto Trip 2 before 09:45: told once, at 09:45; the card cannot swap it", async (a) => {
    const { env } = await freshSouth();
    await atTime(T("09:31"), () => W.sweepTripSplit(env));
    const r = await atTime(T("09:35"), () => move(env, { stopId: "S02", after: "", trip: 2 }));
    a.ok(r.ok, JSON.stringify(r));
    a.eq((await box(env)).length, 0, "not before 09:45");
    const sw = await atTime(T("09:36"), () => act(env, { route: "North", op: "move", stopId: "S02" }));
    a.ok(!sw.ok); a.has(sw.error, "Put it back");
    await atTime(T("09:45"), () => W.sweepTripSplit(env));
    const m = await box(env);
    a.eq(m.length, 1, JSON.stringify(m));
    a.eq(m[0].title, "North bus at Vicar Rd");
    a.has(m[0].body, "on its second trip, about ");
    await atTime(T("09:46"), () => W.sweepTripSplit(env));
    a.eq((await box(env)).length, 1, "once");
  });

  s.test("moved onto Trip 1 of a split route: typed time, told at once; Put back takes it off", async (a) => {
    const { env } = await freshSouth();
    await atTime(T("09:31"), () => W.sweepTripSplit(env));
    const bad = await atTime(T("09:40"), () => move(env, { stopId: "S02", after: "N05", trip: 1, time: "10:40" }));
    a.ok(!bad.ok); a.eq(bad.error, "Pick a stop on Trip 1.");
    const r = await atTime(T("09:40"), () => move(env, { stopId: "S02", after: "N03", trip: 1, time: "10:28" }));
    a.ok(r.ok, JSON.stringify(r));
    const rec = (await W.splitDay(env, KEY)).North;
    a.eq(rec.t1.join(","), "N01,N02,N03,S02,N04"); a.eq(rec.b1, 17);
    const m = await box(env);
    a.eq(m.length, 1); a.has(m[0].body, "picks you up at 10:28");
    const back = await atTime(T("09:50"), async () => J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN, op: "act",
      act: { id: "mv-back-1", kind: "stopmove", op: "back", stopId: "S02" } })));
    a.ok(back.ok, JSON.stringify(back));
    a.eq((await W.splitDay(env, KEY)).North.t1.join(","), "N01,N02,N03,N04");
  });

  s.test("not onto a trip that is over", async (a) => {
    const { env } = await freshSouth();
    await atTime(T("09:31"), () => W.sweepTripSplit(env));
    await atTime(T("09:52"), () => tap(env, [{ event: "start", at: at("09:52") }]));
    await atTime(T("10:40"), () => tap(env, [{ event: "end", at: at("10:40"), auto: 1 }]));
    const r = await atTime(T("10:41"), () => move(env, { stopId: "S02", after: "N03", trip: 1, time: "10:28" }));
    a.ok(!r.ok); a.eq(r.error, "Trip 1 on North is over.");
    const ok2 = await atTime(T("10:41"), () => move(env, { stopId: "S02", after: "", trip: 2 }));
    a.ok(ok2.ok, JSON.stringify(ok2));
  });

  /* w2.109.0, the 22 Nov audit. */
  s.test("split day: Run record per trip, late Trip 1 tap kept, Fix on Trip 1, reports count both trips", async (a) => {
    const { env } = await fresh();
    await atTime(T("09:31"), () => W.sweepTripSplit(env));
    const rb = await atTime(T("09:32"), () => W.reportBookings(env));
    a.eq(rb.lead, "24 people booked.");
    a.eq(rb.sections[0].head, "North Liverpool, 22 booked, two trips");
    const rs = await atTime(T("09:32"), () => W.reportSeats(env));
    a.has(rs.sections[0].lines[0], "22 booked");
    a.has(rs.sections[0].lines[0], "Two trips: Trip 1 15, Trip 2 7.");
    a.eq(rs.lead, "Nobody is over.");
    await atTime(T("09:52"), () => tap(env, [{ event: "start", at: at("09:52") }]));
    await atTime(T("10:05"), () => tap(env, [{ event: "pickup", stopId: "N01", at: at("10:05") }]));
    await atTime(T("10:40"), () => tap(env, [{ event: "end", at: at("10:40"), auto: 1 }]));
    const late = await J(await atTime(T("10:41"), () => tap(env, [{ event: "pickup", stopId: "N02", at: at("10:15") }])));
    a.eq(late.written, 1, JSON.stringify(late));
    await atTime(T("10:46"), () => tap(env, [{ event: "start", at: at("10:46") }], "t2"));
    const runs = await atTime(T("10:50"), () => W.coordRuns(env, { name: "Bro Asim" }, KEY));
    const north = runs.routes.find((r) => r.route === "North").runs;
    a.eq(north[0].stops.map((x) => x.id).join(","), "N01,N02,N03,N04");
    a.ok(north[0].stops[0].ev && north[0].stops[1].ev, "Trip 1's taps show");
    a.eq(north[1].stops.map((x) => x.id).join(","), "N05,N06,N07,N08");
    const fx = await atTime(T("10:51"), () => W.actFix(env, { name: "Bro Asim" }, { sunday: KEY, trip: "t1", stopId: "N03", time: "10:20" }));
    a.ok(fx.ok, JSON.stringify(fx));
  });

  s.test("after 09:31 a second trip is made, and ended, until Trip 1 starts", async (a) => {
    const { db, env } = await fresh([{ route: "North", stopId: "N01", seats: 7 }, { route: "North", stopId: "N02", seats: 5 },
                                     { route: "North", stopId: "N03", seats: 3 }]);
    await atTime(T("09:31"), () => W.sweepTripSplit(env));
    a.eq((await W.splitDay(env, KEY)).North.none, "fits");
    await seedBookings(db, KEY, [{ route: "North", stopId: "N05", seats: 4 }]);
    await atTime(T("09:35"), () => W.sweepTripSplit(env));
    const rec = (await W.splitDay(env, KEY)).North;
    a.ok(W.splitOn(rec), JSON.stringify(rec));
    a.eq(rec.t2.join(","), "N05,N06,N07,N08");
    await db.prepare("DELETE FROM bookings WHERE stop_id='N05'").run();
    await atTime(T("09:38"), () => W.sweepTripSplit(env));
    a.eq((await W.splitDay(env, KEY)).North.none, "fits", "one trip again");
    await seedBookings(db, KEY, [{ route: "North", stopId: "N05", seats: 4 }]);
    await atTime(T("09:52"), () => tap(env, [{ event: "start", at: at("09:52") }]));
    await atTime(T("09:53"), () => W.sweepTripSplit(env));
    a.eq((await W.splitDay(env, KEY)).North.none, "fits", "not once Trip 1 has started");
  });

  s.test("hand back told to its two drivers; a cover between the trips can be morning only", async (a) => {
    const { env } = await fresh();
    const hb = await atTime(T("11:21"), () => W.actRota(env, { name: "Bro Asim" }, { sunday: KEY, set: { northCover: "" },
      note: "North handed back to Bro Adrian at 11:21 (morning only).", handBack: { route: "North", back: "Bro Adrian", from: "Bro Moses" } }));
    a.ok(hb.ok, JSON.stringify(hb));
    a.eq(hb.tell.join(","), "Bro Adrian,Bro Moses");
    a.eq(hb.title, "North handed back");
    await atTime(T("09:31"), () => W.sweepTripSplit(env));
    await atTime(T("09:52"), () => tap(env, [{ event: "start", at: at("09:52") }]));
    await atTime(T("10:40"), () => tap(env, [{ event: "end", at: at("10:40"), auto: 1 }]));
    const cv = await atTime(T("10:41"), () => W.actRota(env, { name: "Bro Asim" }, { sunday: KEY, set: { northCover: "Bro Moses" }, span: "morning" }));
    a.ok(cv.ok, JSON.stringify(cv));
    a.has(cv.words, "morning only");
    await atTime(T("10:41"), () => cv.after());
    const list = await W.handBackAll(env);
    a.eq(list.length, 1, JSON.stringify(list));
    a.eq(list[0].back, "Bro Adrian"); a.eq(list[0].to, "Bro Moses");
  });

  return s;
}
