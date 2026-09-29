/* THE ESTIMATE, OVER BOOKED STOPS ONLY.

   Until v1.71.0 a passenger's estimate was his timetabled time plus the run's
   offset, which charges the bus for every stop on the tab including the ones
   nobody booked. On a morning where four of seven North stops are empty the
   bus arrives several minutes early and the passenger who trusted the number
   is still walking.

   THE DIRECTION OF THE ERROR IS THE DESIGN, and most of this suite is about
   that rather than about arithmetic: an estimate that is too late loses
   somebody the bus, and an estimate that is too early costs them a wait at a
   kerb they were standing at anyway. So the tests that matter assert the
   SIGN, not the value. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv } from "../lib/worker.mjs";
import { seedSunday, seedBookings, NORTH, SOUTH, STOPS } from "../lib/seed.mjs";

export default async function (root) {
  const s = new Suite("the estimate over booked stops");
  const { mod: W } = await loadWorker(root);

  const key = W.runSunday();
  const SET = { dwellSeconds: 75, skipSaves: 0.8, speedMph: 18, maxSkipMinutes: 6 };
  const NOPIN = NORTH.map((x) => ({ ...x, lat: null, lng: null }));

  const saved = (ordered, last, mine, bookedIds, set) =>
    W.etaSavedMinutes(key, ordered, last, mine, new Set(bookedIds), set || SET);

  /* ---- nothing to save ------------------------------------------------- */

  s.test("with every stop booked the estimate is the timetable, exactly as before", (a) => {
    const all = NORTH.filter((x) => x.kind === "pickup").map((x) => x.id);
    a.eq(saved(NORTH, "N01", "N07", all), 0);
  });

  s.test("a stop the bus has already passed is not counted", (a) => {
    a.eq(saved(NORTH, "N05", "N07", ["N07"]) > 0, true, "N06 is ahead and unbooked");
    const behind = saved(NORTH, "N05", "N06", ["N06"]);
    a.eq(behind, 0, "N01 to N04 are behind the bus and cannot be saved twice");
  });

  s.test("the passenger's own stop is never skipped", (a) => {
    /* His own stop is booked by definition — he booked it — but the guard is
       worth having explicitly, because a withdrawal could empty it while his
       page is still open. */
    a.eq(saved(NORTH, "N01", "N03", []), saved(NORTH, "N01", "N03", ["N03"]),
         "whether his own stop is in the booked set must make no difference");
  });

  s.test("the arrival and departure rows are not skippable stops", (a) => {
    a.eq(saved(NORTH, "N08", "N99", []), 0, "there is nothing between the last pickup and church");
  });

  s.test("a stop id nobody has heard of saves nothing rather than throwing", (a) => {
    a.eq(saved(NORTH, "N01", "NOPE", []), 0);
  });

  /* ---- the sign ---------------------------------------------------------- */

  s.test("the saving is never negative, on any pair of stops, booked or not", (a) => {
    for (const src of [NORTH, SOUTH, NOPIN]) {
      for (const from of src) for (const to of src) {
        for (const booked of [[], src.map((x) => x.id)]) {
          const v = saved(src, from.id, to.id, booked);
          a.ok(v >= 0, "saving went negative between " + from.id + " and " + to.id + ": " + v);
        }
      }
    }
  });

  s.test("the saving never exceeds the timetable gap it is taken from", (a) => {
    const mine = "N07";
    const gap = (a1, b1) => (W.londonMoment(key, b1.time) - W.londonMoment(key, a1.time)) / 60000;
    const whole = gap(NORTH.find((x) => x.id === "N01"), NORTH.find((x) => x.id === mine));
    a.ok(saved(NORTH, "N01", mine, []) <= whole,
         "an estimate cannot arrive before the bus has left");
  });

  /* ---- what a skip is worth --------------------------------------------- */

  s.test("skipping one stop saves at least the time the bus would stand there", (a) => {
    const one = saved(NORTH, "N04", "N07", ["N07", "N06"]);   /* only N05 skipped */
    a.ok(one >= SET.dwellSeconds / 60 - 0.001,
         "a skip must always be worth at least the dwell, coordinates or not: got " + one);
  });

  s.test("skipping two stops saves more than skipping one", (a) => {
    const one = saved(NORTH, "N04", "N07", ["N07", "N06"]);
    const two = saved(NORTH, "N04", "N07", ["N07"]);
    a.ok(two > one, "one skip " + one + ", two skips " + two);
  });

  s.test("in a cluster, a skip is worth nearly the whole gap", (a) => {
    /* S03 and S04 are 195 metres apart with three minutes between them, so
       the driving is about twenty seconds and the rest is standing about.
       This is the case a distance-led model gets wrong. */
    const v = saved(SOUTH, "S03", "S05", ["S05"]);   /* S04 skipped */
    a.ok(v >= 1.5, "a skip in a 195 metre cluster should be worth most of the three minutes, got " + v);
  });

  s.test("skipping the middle of the North cluster is almost pure standing time", (a) => {
    /* N05 to N07 direct is 543 metres and via N06 it is 556, so going past
       N06 saves thirteen metres of driving and a whole stop's worth of
       standing. A model that priced this by distance would move the estimate
       by about a second and a half. */
    const v = saved(NORTH, "N05", "N07", ["N07"]);
    a.ok(v >= 1, "got " + v + " minutes for a stop that costs 13 metres to pass");
  });

  s.test("a skip on a long leg is worth less than a skip in a cluster", (a) => {
    /* Not because the gap is smaller — it is much bigger — but because
       almost all of a district gap is driving the bus still has to do. */
    const cluster = saved(SOUTH, "S03", "S05", ["S05"]);         /* S04, 195 m out of the way */
    const perMinuteCluster = cluster / 3;                         /* over a three minute gap */
    const long = saved(NORTH, "N02", "N04", ["N04"]);             /* N03, 2.3 km out of the way */
    const perMinuteLong = long / 12;                              /* over a twelve minute stretch */
    a.ok(perMinuteCluster > perMinuteLong,
         "a cluster skip should give back more of its gap than a district skip: "
         + perMinuteCluster.toFixed(2) + " vs " + perMinuteLong.toFixed(2));
  });

  s.test("no coordinates still beats the timetable", (a) => {
    const v = saved(NOPIN, "N04", "N07", ["N07"]);
    a.ok(v > 0, "with no pins the dwell is still real and must still come off");
  });

  s.test("coordinates do not make the estimate worse than no coordinates", (a) => {
    const withPins = saved(NORTH, "N04", "N07", ["N07"]);
    const without = saved(NOPIN, "N04", "N07", ["N07"]);
    a.ok(withPins >= without - 0.5,
         "adding the six coordinates must not make the bus predicted later: " + withPins + " vs " + without);
  });

  s.test("the cap holds however absurd the timetable is", (a) => {
    const silly = [
      { id: "X0", route: "X", time: "09:00", stop: "a", kind: "depart", seq: 0, lat: null, lng: null },
      { id: "X1", route: "X", time: "10:00", stop: "b", kind: "pickup", seq: 1, lat: null, lng: null },
      { id: "X2", route: "X", time: "11:00", stop: "c", kind: "pickup", seq: 2, lat: null, lng: null }
    ];
    a.ok(saved(silly, "X0", "X2", ["X2"]) <= SET.maxSkipMinutes + 0.001);
  });

  s.test("a timetable typed out of order does not run the bus backwards", (a) => {
    const muddled = [
      { id: "M0", route: "M", time: "10:00", stop: "a", kind: "depart", seq: 0, lat: null, lng: null },
      { id: "M1", route: "M", time: "09:30", stop: "b", kind: "pickup", seq: 1, lat: null, lng: null },
      { id: "M2", route: "M", time: "10:20", stop: "c", kind: "pickup", seq: 2, lat: null, lng: null }
    ];
    const v = saved(muddled, "M0", "M2", ["M2"]);
    a.ok(v >= 0 && isFinite(v), "got " + v);
  });

  /* ---- the settings ------------------------------------------------------ */

  s.test("a longer dwell saves more", (a) => {
    const small = saved(NOPIN, "N04", "N07", ["N07"], { ...SET, dwellSeconds: 30, skipSaves: 0 });
    const big = saved(NOPIN, "N04", "N07", ["N07"], { ...SET, dwellSeconds: 150, skipSaves: 0 });
    a.ok(big > small);
  });

  s.test("the settings come off the sheet, and fall back when nothing has been pushed", async (a) => {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    const fallback = await W.etaSettings(env);
    a.eq(fallback.dwellSeconds, 75);
    await W.cachePut(env, "eta_rules", { dwellSeconds: 120, skipSaves: 0.5, speedMph: 22, maxSkipMinutes: 4 }).run();
    const pushed = await W.etaSettings(env);
    a.eq(pushed.dwellSeconds, 120);
    a.eq(pushed.maxSkipMinutes, 4);
  });

  s.test("a nonsense setting is ignored rather than believed", async (a) => {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await W.cachePut(env, "eta_rules",
      { dwellSeconds: -5, skipSaves: 9, speedMph: 0, maxSkipMinutes: "soon" }).run();
    const set = await W.etaSettings(env);
    a.eq(set.dwellSeconds, 75, "a negative dwell is not a dwell");
    a.eq(set.skipSaves, 1, "a fraction cannot be more than all of it");
    a.ok(set.speedMph >= 4, "a bus that does nought miles an hour never arrives");
    a.eq(set.maxSkipMinutes, 6);
  });

  /* ---- geometry ---------------------------------------------------------- */

  s.test("the geometry agrees with distances measured outside this code", (a) => {
    /* The only two figures in this project that came from somewhere other
       than this function. If a change to metresBetween leaves these alone it
       has not changed much; if it moves them it has. */
    const by = (id) => STOPS.find((x) => x.id === id);
    a.near(W.metresBetween(by("S03"), by("S04")), 195, 5, "S03 to S04 was measured at 195 metres");
    const cluster = W.metresBetween(by("N05"), by("N06")) + W.metresBetween(by("N06"), by("N07"));
    a.near(cluster, 556, 8, "N05 through N07 was measured at 556 metres");
  });

  s.test("going past the middle of the North cluster saves almost no driving", (a) => {
    const by = (id) => STOPS.find((x) => x.id === id);
    const viaN06 = W.metresBetween(by("N05"), by("N06")) + W.metresBetween(by("N06"), by("N07"));
    const direct = W.metresBetween(by("N05"), by("N07"));
    a.ok(viaN06 - direct < 30,
         "the detour to call at N06 is " + Math.round(viaN06 - direct) + " metres, so the saving "
         + "has to come from the standing time or it does not exist");
  });

  s.test("a stop with no pin has no distance to anywhere", (a) => {
    a.eq(W.driveMinutes({ lat: null, lng: null }, SOUTH[1], SET), 0);
  });

  s.test("a coordinate of exactly zero is a place, not a blank", (a) => {
    /* Zero is in the Gulf of Guinea. Treating it as "unfilled" would be a
       guess; treating it as Liverpool would be a bug. It is simply a pin,
       and the six real ones are what get typed in. */
    a.ok(W.metresBetween({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) > 100000);
  });

  /* ---- end to end -------------------------------------------------------- */

  s.test("a passenger's estimate moves earlier when the stops ahead of him empty out", async (a) => {
    async function ask(bookings) {
      const db = makeDB(join(root, "server", "schema.sql"));
      const env = makeEnv(db);
      await seedSunday(db, key);
      await seedBookings(db, key, bookings);
      const set = await W.etaSettings(env);
      const booked = await W.bookedStopIds(env, key, "North");
      return W.etaSavedMinutes(key, W.stopsOnRoute(await W.getStops(env), "North"),
                               "N02", "N07", booked, set);
    }
    const busy = await ask([
      { route: "North", stopId: "N03" }, { route: "North", stopId: "N04" },
      { route: "North", stopId: "N05" }, { route: "North", stopId: "N06" },
      { route: "North", stopId: "N07" }
    ]);
    const quiet = await ask([{ route: "North", stopId: "N07" }]);
    a.eq(busy, 0, "with everybody booked there is nothing to skip");
    a.ok(quiet > busy, "with four stops empty the bus is ahead of the timetable: " + quiet + " minutes");
  });

  s.test("the walk starts from a stop ID, never a stop NAME", async (a) => {
    /* lastStop is the stop's NAME, because that is what gets read out to a
       passenger. The walk needs the id. Passing the name fails SILENTLY —
       the lookup misses, the walk starts at the departure row, and every stop
       the bus has already passed is counted as a saving — so the only way to
       catch it is to assert the two give different answers. */
    const byName = W.etaSavedMinutes(key, NORTH, "Litherland Rd", "N07", new Set(["N07"]), SET);
    const byId = W.etaSavedMinutes(key, NORTH, "N03", "N07", new Set(["N07"]), SET);
    a.ne(byId, byName, "if these agree, the id lookup is not doing anything");
    a.ok(byId < byName, "a name that matches nothing starts the walk at the depot and over-saves");
  });

  s.test("the run's state carries the last stop's id alongside its name", async (a) => {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, key);
    await W.handleTrip(env, {
      trip: "t1", route: "North", driver: "Bro Adebola", reg: "YS70 PWE", sunday: key,
      events: [{ event: "start", at: Date.now() - 600000 },
               { event: "picked", stopId: "N03", at: Date.now() - 60000 }]
    });
    const st = await W.tripState(env, key, "North");
    a.eq(st.lastStopId, "N03");
    a.eq(st.lastStop, "Litherland Rd", "the name is what gets read out to a passenger");
  });

  s.test("two stops on two routes can share a name without confusing the walk", async (a) => {
    /* Both routes end at "Church". A name lookup would find whichever came
       first in the list. */
    const churches = [...NORTH, ...SOUTH].filter((x) => x.stop === "Church");
    a.ok(churches.length > 2, "the fixture should have a Church on both routes");
    const ids = new Set(churches.map((x) => x.id));
    a.eq(ids.size, churches.length, "and they should all have their own id");
  });

  s.test("a withdrawn booking stops holding the bus up", async (a) => {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, key);
    await seedBookings(db, key, [
      { route: "North", stopId: "N05", status: "Cancelled" },
      { route: "North", stopId: "N07" }
    ]);
    const booked = await W.bookedStopIds(env, key, "North");
    a.not(booked.has("N05"), "a cancelled seat is not somebody waiting");
  });

  s.test("a booking for nought seats is not somebody waiting", async (a) => {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, key);
    await seedBookings(db, key, [{ route: "North", stopId: "N05", seats: 0 }]);
    a.not((await W.bookedStopIds(env, key, "North")).has("N05"));
  });

  return s;
}
