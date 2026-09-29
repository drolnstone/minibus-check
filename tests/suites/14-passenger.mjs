/* WHAT A PASSENGER IS TOLD, AND HOW OFTEN.

   The ruling is that he hears at every booked pickup before his own — the
   first with the drivers, one at each stop in front of him, his own last — so
   that he can watch the bus coming down the line rather than being tapped on
   the shoulder once and hoping.

   The cost of that ruling is volume, and the coordinates show exactly where
   it lands: North has eight pickups, South seven, and on both routes three of
   them sit inside half a kilometre of each other. Most of this suite is about
   the threshold that keeps the last man on the route from being buzzed three
   times in four minutes with the same sentence. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday, seedBookings } from "../lib/seed.mjs";
import { atTime, WHEN } from "../lib/clock.mjs";

export default async function (root) {
  const s = new Suite("what a passenger is told");
  const { mod: W } = await loadWorker(root);
  const net = installGlobals();

  async function fresh(opts) {
    const o = opts || {};
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    /* The Sunday is the one the sweep will look at. A test that runs the
       sweep on the fixed clock says which moment with o.at, and the Sunday
       comes from that moment. Taken from the real clock instead, the morning
       checks seeded this Sunday and swept 27 September: the same day until
       the Sunday was over, then a week apart, and from Monday 28 September
       three of them failed and three passed for the wrong reason. */
    const key = o.at ? await atTime(o.at, () => W.runSunday()) : W.runSunday();
    await seedSunday(db, key);
    if (o.passenger !== false) await W.cachePut(env, "passenger_rules",
      Object.assign({ resendMinutes: 3, morningMessage: true, quietFrom: 21, quietTo: 8 }, o.passenger || {})).run();
    if (o.booking) await W.cachePut(env, "booking_rules", o.booking).run();
    return { db, env, key };
  }

  /* A phone that has asked to be told things, tied to a booking's device. */
  async function sub(db, stopId, over) {
    const o = over || {};
    await db.prepare(
      "INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, driver, route, made, seen, fails, last) " +
      "VALUES (?,?,?,?,?,?,?,?,?,0,0,'')"
    ).bind("https://push.example/" + stopId + (o.suffix || ""), "p", "a", "passenger",
           o.ref || ("dev-" + stopId), o.pid || ("pid-" + stopId), "", "", Date.now()).run();
    return db._one("SELECT * FROM push_subs WHERE ref=?", o.ref || ("dev-" + stopId));
  }

  async function aRunIsOut(env, key, at) {
    await W.handleTrip(env, {
      trip: "t1", route: "North", driver: "Bro Adebola", reg: "YS70 PWE", sunday: key,
      events: [{ event: "start", at: at || (Date.now() - 900000) }]
    });
  }

  const sent = (db) => db._rows("SELECT * FROM push_subs WHERE last <> ''").length;

  /* ---- a message at every booked stop in front ------------------------- */

  s.test("every booked stop ahead is woken, not only the next one", async (a) => {
    const { db, env, key } = await fresh();
    await seedBookings(db, key, ["N03", "N05", "N07"].map((id) => ({ route: "North", stopId: id })));
    for (const id of ["N03", "N05", "N07"]) await sub(db, id);
    await aRunIsOut(env, key);

    net.reset();
    await W.wakeAfterTap(env, key, "North", await W.getStops(env),
                         W.pickupsAndArrivals(await W.getStops(env)), "N02", {});
    a.eq(net.calls.length, 3,
         "N03, N05 and N07 are all in front of N02 and all have somebody on them");
  });

  s.test("a stop behind the bus is not woken by a tap in front of it", async (a) => {
    const { db, env, key } = await fresh();
    await seedBookings(db, key, [{ route: "North", stopId: "N01" }, { route: "North", stopId: "N07" }]);
    await sub(db, "N01"); await sub(db, "N07");
    await aRunIsOut(env, key);
    net.reset();
    const all = await W.getStops(env);
    /* N01 marked, so it is behind and done. */
    await W.wakeAfterTap(env, key, "North", all, W.pickupsAndArrivals(all), "N05", { N01: 1 });
    a.eq(net.calls.length, 1, "only N07 is ahead");
  });

  s.test("a stop the bus went past unmarked is still told", async (a) => {
    const { db, env, key } = await fresh();
    await seedBookings(db, key, [{ route: "North", stopId: "N02" }]);
    await sub(db, "N02");
    await aRunIsOut(env, key);
    net.reset();
    const all = await W.getStops(env);
    await W.wakeAfterTap(env, key, "North", all, W.pickupsAndArrivals(all), "N05", {});
    a.eq(net.calls.length, 1,
         "somebody standing at a kerb the bus has driven past is not receiving an update");
  });

  /* ---- the threshold ---------------------------------------------------- */

  s.test("a message that would say the same thing again is held back", async (a) => {
    const { db, env, key } = await fresh({ passenger: { resendMinutes: 3 } });
    await seedBookings(db, key, ["N02", "N03", "N08"].map((id) => ({ route: "North", stopId: id })));
    await sub(db, "N08");
    await aRunIsOut(env, key);
    const all = await W.getStops(env), line = W.pickupsAndArrivals(all);

    net.reset();
    await W.wakeAfterTap(env, key, "North", all, line, "N02", {});
    const first = net.calls.length;
    a.eq(first, 1, "the first tap tells him");

    /* The estimate for N08 has barely moved between these two taps. */
    net.reset();
    await W.wakeAfterTap(env, key, "North", all, line, "N03", {});
    a.eq(net.calls.length, 0,
         "\"about nine minutes\" followed by \"about eight minutes\" is not news");
  });

  s.test("the stop immediately before his always sends, threshold or not", async (a) => {
    const { db, env, key } = await fresh({ passenger: { resendMinutes: 999 } });
    await seedBookings(db, key, [{ route: "North", stopId: "N06" }, { route: "North", stopId: "N07" }]);
    await sub(db, "N07");
    await aRunIsOut(env, key);
    const all = await W.getStops(env), line = W.pickupsAndArrivals(all);

    net.reset();
    await W.wakeAfterTap(env, key, "North", all, line, "N05", {});
    net.reset();
    /* N06 is the stop before his. Even with the threshold turned up as far as
       it goes, this one is his cue to start walking. */
    await W.wakeAfterTap(env, key, "North", all, line, "N06", {});
    a.eq(net.calls.length, 1, "an instruction is never redundant");
  });

  s.test("the threshold is a number of minutes, and it is obeyed exactly", async (a) => {
    /* Driven off a KNOWN last_eta rather than off two real taps, because the
       thing under test is the comparison and not the arithmetic that feeds
       it. Two minutes of movement against a three minute threshold is held;
       against a one minute threshold it goes. */
    async function moved(threshold, drift) {
      const { db, env, key } = await fresh({ passenger: { resendMinutes: threshold } });
      await seedBookings(db, key, [{ route: "North", stopId: "N08" }]);
      await sub(db, "N08");
      await aRunIsOut(env, key);
      const all = await W.getStops(env), line = W.pickupsAndArrivals(all);
      const state = await W.tripState(env, key, "North");
      const mins = await W.minutesToStop(env, key, "North", all, state, "N08");
      await db.prepare("UPDATE push_subs SET last_eta=? WHERE ref='dev-N08'")
        .bind(Math.round(mins) + drift).run();
      net.reset();
      await W.wakeAfterTap(env, key, "North", all, line, "N02", {});
      return net.calls.length;
    }
    a.eq(await moved(3, 2), 0, "two minutes of drift against a three minute threshold is held");
    a.eq(await moved(1, 2), 1, "the same drift against a one minute threshold goes");
    a.eq(await moved(3, 0), 0, "no movement at all is never news");
  });

  s.test("what he was last told is remembered on his own row", async (a) => {
    const { db, env, key } = await fresh();
    await seedBookings(db, key, [{ route: "North", stopId: "N08" }]);
    await sub(db, "N08");
    await aRunIsOut(env, key);
    const all = await W.getStops(env);
    await W.wakeAfterTap(env, key, "North", all, W.pickupsAndArrivals(all), "N02", {});
    const row = db._one("SELECT * FROM push_subs WHERE ref=?", "dev-N08");
    a.ok(row.last_eta !== null && row.last_eta !== undefined,
         "the threshold needs a number to compare against and the tag cannot carry one");
  });

  /* ---- the first message of the morning --------------------------------- */

  s.test("the morning message goes in the same window the drivers are told in", async (a) => {
    const { db, env, key } = await fresh({ at: WHEN.sundayMorning });
    await seedBookings(db, key, [{ route: "North", stopId: "N03" }]);
    await sub(db, "N03");
    net.reset();
    await atTime(WHEN.sundayMorning, () => W.wakeMorning(env));
    a.eq(net.calls.length, 1);
  });

  s.test("and not before it, or after it, or on a weekday", async (a) => {
    for (const when of [WHEN.sundayEarly, WHEN.sundayLate, WHEN.thursdayEvening]) {
      const { db, env, key } = await fresh({ at: when });
      await seedBookings(db, key, [{ route: "North", stopId: "N03" }]);
      await sub(db, "N03");
      net.reset();
      await atTime(when, () => W.wakeMorning(env));
      a.eq(net.calls.length, 0, "nothing should go out at " + when);
    }
  });

  s.test("it goes once, however many times the sweep runs", async (a) => {
    const { db, env, key } = await fresh({ at: WHEN.sundayMorning });
    await seedBookings(db, key, [{ route: "North", stopId: "N03" }]);
    await sub(db, "N03");
    net.reset();
    await atTime(WHEN.sundayMorning, async () => {
      await W.wakeMorning(env);
      await W.wakeMorning(env);
      await W.wakeMorning(env);
    });
    a.eq(net.calls.length, 1, "Apps Script calls in every five minutes; the tag is what stops it");
  });

  s.test("nobody on a route the Rota has called off is told their bus is coming", async (a) => {
    const { db, env, key } = await fresh({ at: WHEN.sundayMorning });
    await db.prepare("UPDATE rota SET status='North cancelled' WHERE sunday=?").bind(key).run();
    await seedBookings(db, key, [{ route: "North", stopId: "N03" }, { route: "South", stopId: "S02" }]);
    await sub(db, "N03"); await sub(db, "S02");
    net.reset();
    await atTime(WHEN.sundayMorning, () => W.wakeMorning(env));
    a.eq(net.calls.length, 1, "South hears; North has already been told it is not running");
  });

  s.test("morningMessage false turns it off", async (a) => {
    const { db, env, key } = await fresh({ passenger: { morningMessage: false }, at: WHEN.sundayMorning });
    await seedBookings(db, key, [{ route: "North", stopId: "N03" }]);
    await sub(db, "N03");
    net.reset();
    await atTime(WHEN.sundayMorning, () => W.wakeMorning(env));
    a.eq(net.calls.length, 0);
  });

  s.test("a rehearsal wakes nobody, here as everywhere", async (a) => {
    const { db, env, key } = await fresh({ at: WHEN.sundayMorning });
    await seedBookings(db, key, [{ route: "North", stopId: "N03" }]);
    await sub(db, "N03");
    net.reset();
    await atTime(WHEN.sundayMorning, async () => {
      /* Started a minute ago on the fixed clock. A rehearsal stamped with the
         real time would already have expired by the time the sweep looked. */
      await W.cachePut(env, "rehearsal", { at: Date.now() - 60000, key: key }).run();
      await W.wakeMorning(env);
    });
    a.eq(net.calls.length, 0, "a guarantee with one exception in it is not a guarantee");
  });

  /* ---- asking people to book -------------------------------------------- */

  const THREE = ["sundayAfternoon", "wednesdayEvening", "saturdayEvening"];

  for (const day of THREE) {
    s.test("the " + day.replace(/([A-Z])/g, " $1").toLowerCase() +
           " nudge goes to somebody with no seat", async (a) => {
      const { db, env } = await fresh();
      await sub(db, "N03");
      net.reset();
      await atTime(WHEN[day], () => W.wakeBookingReminders(env));
      a.eq(net.calls.length, 1);
    });
  }

  s.test("Thursday is not a nudge any more", async (a) => {
    /* It was, and it was the one that never fired: oncePerWeek tagged the
       whole week, and the Sunday window runs first. Left in the list it
       would now be a fourth nudge nobody asked for. */
    const { db, env } = await fresh();
    await sub(db, "N03");
    net.reset();
    await atTime(WHEN.thursdayEvening, () => W.wakeBookingReminders(env));
    a.eq(net.calls.length, 0);
  });

  s.test("somebody who has already booked is not chased", async (a) => {
    const { db, env } = await fresh();
    await sub(db, "N03");
    net.reset();
    await atTime(WHEN.wednesdayEvening, async () => {
      /* The Sunday bookings are ACTUALLY open for, asked of the same cutoff
         the booking page obeys. Seeding "this week" would be testing the
         wrong Sunday and would pass for the wrong reason. */
      const now = W.runSunday();
      const target = W.bookingsClosed(now) ? W.keyAddWeeks(now, 1) : now;
      await seedBookings(db, target, [{ route: "North", stopId: "N03" }]);
      await W.wakeBookingReminders(env);
    });
    a.eq(net.calls.length, 0, "that is the whole point of the later windows");
  });

  s.test("all three windows point at the same Sunday", async (a) => {
    /* On a Sunday afternoon the coming Sunday has closed, so that nudge is
       about the week after — which is the same Sunday the Wednesday and
       Saturday ones are about. If it were not, "once a week" would mean
       nothing and the Saturday deadline would be about a different morning
       from the one closing. */
    const seen = [];
    for (const day of THREE) {
      await atTime(WHEN[day], () => {
        const now = W.runSunday();
        seen.push(W.bookingsClosed(now) ? W.keyAddWeeks(now, 1) : now);
      });
    }
    a.eq(seen[1], seen[0], "Wednesday points at " + seen[1] + ", Sunday at " + seen[0]);
    a.eq(seen[2], seen[0], "Saturday points at " + seen[2] + ", Sunday at " + seen[0]);
  });

  s.test("a man who never books hears all three", async (a) => {
    /* THE CHANGE ITSELF. Two windows and oncePerWeek true was one nudge
       wearing two names: the Sunday window runs first, tags the week, and
       the midweek one found nothing left to tell. */
    const { db, env } = await fresh();
    await sub(db, "N03");
    net.reset();
    for (const day of THREE) await atTime(WHEN[day], () => W.wakeBookingReminders(env));
    a.eq(net.calls.length, 3);
  });

  s.test("and each one is a different tag, not the same push sent thrice", async (a) => {
    const { db, env } = await fresh();
    const one = await sub(db, "N03");
    net.reset();
    const tags = [];
    for (const day of THREE) {
      await atTime(WHEN[day], () => W.wakeBookingReminders(env));
      tags.push(db._one("SELECT last FROM push_subs WHERE endpoint=?", one.endpoint).last);
    }
    a.eq(new Set(tags).size, 3, "got " + tags.join(" / "));
    for (const t of tags) a.has(t, "book|", "got " + t);
  });

  s.test("with oncePerWeek back on he hears once, however many windows there are", async (a) => {
    const { db, env } = await fresh({ booking: {
      on: true, oncePerWeek: true,
      windows: [{ day: 0, from: 15, to: 16 }, { day: 3, from: 18, to: 19 },
                { day: 6, from: 18, to: 19 }] } });
    await sub(db, "N03");
    net.reset();
    for (const day of THREE) await atTime(WHEN[day], () => W.wakeBookingReminders(env));
    a.eq(net.calls.length, 1, "the first window he is caught by is the only one");
  });

  s.test("the old two-window settings are still understood", async (a) => {
    /* THE DEPLOY GAP IS REAL. The Worker goes up before the spreadsheet, so
       for the minutes in between this reads settings the OLD script pushed.
       Not understanding them would silently swap the schedule for the
       built-in one, which is a different schedule again. */
    const { db, env } = await fresh({ booking: {
      on: true, oncePerWeek: true,
      after: { day: 0, from: 15, to: 16 }, mid: { day: 4, from: 18, to: 19 } } });
    await sub(db, "N03");

    net.reset();
    await atTime(WHEN.thursdayEvening, () => W.wakeBookingReminders(env));
    a.eq(net.calls.length, 1, "Thursday is still a nudge while the old settings stand");

    net.reset();
    await atTime(WHEN.saturdayEvening, () => W.wakeBookingReminders(env));
    a.eq(net.calls.length, 0, "and Saturday is not one yet");
  });

  s.test("a window with no day at all is dropped, not read as Sunday midnight", async (a) => {
    const { db, env } = await fresh({ booking: {
      on: true, oncePerWeek: false,
      windows: [{ from: 15, to: 16 }, { day: 3, from: 18, to: 19 }] } });
    await sub(db, "N03");
    net.reset();
    await atTime(WHEN.sundayAfternoon, () => W.wakeBookingReminders(env));
    a.eq(net.calls.length, 0, "a day nobody wrote down is a typo, not midnight on Sunday");
    await atTime(WHEN.wednesdayEvening, () => W.wakeBookingReminders(env));
    a.eq(net.calls.length, 1, "the window either side of it still works");
  });

  s.test("the same hour on the wrong day sends nothing", async (a) => {
    const { db, env } = await fresh();
    await sub(db, "N03");
    net.reset();
    await atTime(WHEN.mondayAfternoon, () => W.wakeBookingReminders(env));
    a.eq(net.calls.length, 0);
  });

  s.test("nothing is sent in the middle of the night", async (a) => {
    const { db, env } = await fresh({ booking: {
      on: true, oncePerWeek: false,
      /* Somebody has moved the Saturday nudge to half eleven at night. */
      windows: [{ day: 6, from: 23, to: 23 }] } });
    await sub(db, "N03");
    net.reset();
    await atTime(WHEN.saturdayNight, () => W.wakeBookingReminders(env));
    a.eq(net.calls.length, 0, "a reminder to book a seat does not get to wake anybody up");
  });

  s.test("booking reminders can be switched off entirely", async (a) => {
    const { db, env } = await fresh({ booking: {
      on: false, oncePerWeek: false,
      windows: [{ day: 0, from: 15, to: 16 }, { day: 3, from: 18, to: 19 },
                { day: 6, from: 18, to: 19 }] } });
    await sub(db, "N03");
    net.reset();
    for (const day of THREE) await atTime(WHEN[day], () => W.wakeBookingReminders(env));
    a.eq(net.calls.length, 0);
  });

  s.test("a driver's phone is never asked to book a seat", async (a) => {
    const { db, env } = await fresh();
    await db.prepare(
      "INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, driver, route, made, seen, fails, last) " +
      "VALUES ('https://push.example/drv','p','a','driver','','','Bro Adebola','North',?,0,0,'')"
    ).bind(Date.now()).run();
    net.reset();
    for (const day of THREE) await atTime(WHEN[day], () => W.wakeBookingReminders(env));
    a.eq(net.calls.length, 0);
  });

  /* ---- and once for a man with a seat ------------------------------------

     Ruled 28 September 2026: somebody who has booked hears what he booked
     once before the morning. Before it, the run skipped him every time and
     his only reminder was the Sunday morning message. The Saturday window is
     the one marked, so the last word he has is his own booking, while he can
     still change it or give the seat back. */

  /* Booked for the Sunday the sweep is about, asked under the sweep's own
     clock, the way "somebody who has already booked" does it above. */
  async function bookedFor(db, when, stopId, seats) {
    await atTime(when, async () => {
      const now = W.runSunday();
      const target = W.bookingsClosed(now) ? W.keyAddWeeks(now, 1) : now;
      await seedBookings(db, target, [{ route: "North", stopId: stopId, seats: seats }]);
    });
  }

  s.test("a man with a seat is told on Saturday evening what he has booked", async (a) => {
    const { db, env } = await fresh();
    await sub(db, "N03");
    await bookedFor(db, WHEN.saturdayEvening, "N03", 2);
    net.reset();
    await atTime(WHEN.saturdayEvening, () => W.wakeBookingReminders(env));
    a.eq(net.calls.length, 1, "his only reminder used to be the Sunday morning message");
  });

  s.test("once, however many times the sweep runs in the window", async (a) => {
    const { db, env } = await fresh();
    await sub(db, "N03");
    await bookedFor(db, WHEN.saturdayEvening, "N03", 2);
    net.reset();
    await atTime(WHEN.saturdayEvening, async () => {
      await W.wakeBookingReminders(env);
      await W.wakeBookingReminders(env);
      await W.wakeBookingReminders(env);
    });
    a.eq(net.calls.length, 1, "the clock calls in every minute; the tag is what stops it");
  });

  s.test("and only in a window marked booked", async (a) => {
    for (const day of ["sundayAfternoon", "wednesdayEvening"]) {
      const { db, env } = await fresh();
      await sub(db, "N03");
      await bookedFor(db, WHEN[day], "N03", 2);
      net.reset();
      await atTime(WHEN[day], () => W.wakeBookingReminders(env));
      a.eq(net.calls.length, 0, "a man with a seat is not chased on " + day);
    }
  });

  s.test("a nudge he had earlier in the week does not stop it", async (a) => {
    /* Unbooked on Wednesday, so he is nudged; booked by Saturday, so he is
       told what he booked. Two tags, and the second is not the first. */
    const { db, env } = await fresh();
    await sub(db, "N03");
    net.reset();
    await atTime(WHEN.wednesdayEvening, () => W.wakeBookingReminders(env));
    a.eq(net.calls.length, 1, "the Wednesday nudge");
    await bookedFor(db, WHEN.saturdayEvening, "N03", 1);
    await atTime(WHEN.saturdayEvening, () => W.wakeBookingReminders(env));
    a.eq(net.calls.length, 2, "and the Saturday reminder of what he booked");
  });

  s.test("with no window marked booked, a man with a seat hears nothing before the morning", async (a) => {
    const { db, env } = await fresh({ booking: {
      on: true, oncePerWeek: false,
      windows: [{ day: 0, from: 15, to: 16 }, { day: 3, from: 18, to: 19 },
                { day: 6, from: 18, to: 19 }] } });
    await sub(db, "N03");
    await bookedFor(db, WHEN.saturdayEvening, "N03", 2);
    net.reset();
    await atTime(WHEN.saturdayEvening, () => W.wakeBookingReminders(env));
    a.eq(net.calls.length, 0, "the setting is the whole of it");
  });

  s.test("the reminder says his stop, his time and his seats, and how to change it", async (a) => {
    const out = await words(WHEN.saturdayEvening, async (db) => {
      const now = W.runSunday();
      const target = W.bookingsClosed(now) ? W.keyAddWeeks(now, 1) : now;
      await seedBookings(db, target, [{ route: "North", stopId: "N08", seats: 2 }]);
    });
    a.eq(out.title, "You are booked for Sunday", "got: " + out.title);
    a.has(out.body, "Stanley Pk");
    a.has(out.body, "10:52");
    a.has(out.body, "2 seats");
    a.has(out.body, "Tap to change or cancel", "got: " + out.body);
  });

  /* ---- the words themselves ---------------------------------------------

     The title is the only part of a notification that is certainly read: it
     is what shows on a locked screen, in a banner that lasts three seconds,
     and in the list of things that arrived during a service. So the title
     carries the INSTRUCTION and the body carries the facts. */

  /* TRACKING IS GATED UNTIL BOOKINGS CLOSE, which means none of the running
     wordings can be reached on a Tuesday. So these run on a fixed Sunday
     morning with the bus already out, and the ones about booking run midweek,
     where they belong. */
  async function words(when, build) {
    const ep = "https://push.example/words";
    let out = null;
    await atTime(when, async () => {
      const { db, env, key } = await fresh();
      await db.prepare(
        "INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, driver, route, made, seen, fails, last) " +
        "VALUES (?,'p','a','passenger','dev-N08','pid-N08','','',?,0,0,'')"
      ).bind(ep, Date.now()).run();
      await build(db, env, key);
      out = await W.pushWhat(env, ep);
    });
    return out;
  }

  s.test("the bold line tells him what to do, not what the bus is doing", async (a) => {
    const out = await words(WHEN.sundayRunning, async (db, env, key) => {
      await seedBookings(db, key, [{ route: "North", stopId: "N08" }]);
      await aRunIsOut(env, key, Date.now() - 900000);
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adebola",
        reg: "YS70 PWE", sunday: key,
        /* At five past ten the bus has just marked N01, which is timetabled
           for ten. A tap on a stop further down the line at this hour would
           be twenty minutes early, and the payload rightly refuses to
           project from a stop marked before the bus could have reached it. */
        events: [{ event: "picked", stopId: "N01", at: Date.now() - 60000 }] });
    });
    a.has(out.title, "Be at your stop", "got: " + out.title + " / " + out.body);
    a.hasnt(out.title, "About ", "the fact belongs in the body");
  });

  s.test("the stop name is in the body, where it is not competing for the first line", async (a) => {
    const out = await words(WHEN.sundayRunning, async (db, env, key) => {
      await seedBookings(db, key, [{ route: "North", stopId: "N08" }]);
      await aRunIsOut(env, key, Date.now() - 900000);
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adebola",
        reg: "YS70 PWE", sunday: key,
        events: [{ event: "picked", stopId: "N01", at: Date.now() - 60000 }] });
    });
    a.has(out.body, "Stanley Pk",
          "he knows which stop is his; the words that tell him what to do come first");
  });

  s.test("somebody with no seat is asked to book one", async (a) => {
    const out = await words(WHEN.wednesdayEvening, async () => {});
    a.eq(out.title, "Book your seat for Sunday");
    a.has(out.body, "Tap");
  });

  s.test("and told when it closes", async (a) => {
    /* A nudge to book that does not say by when is a nudge to do it later,
       and later is a morning where the list has already gone to the driver. */
    const out = await words(WHEN.wednesdayEvening, async () => {});
    a.has(out.body, "09:30", "got: " + out.body);
    a.has(out.body, "Sunday", "got: " + out.body);
  });

  s.test("the cutoff in the words is the cutoff the page obeys", async (a) => {
    /* Typed, these drift, and the one that drifts is always the sentence
       rather than the rule — so the phone promises a deadline the server
       does not keep. */
    const out = await words(WHEN.wednesdayEvening, async () => {});
    a.has(out.body, W.cutoffWords(), "got: " + out.body);
  });

  s.test("on Saturday evening it is a deadline, not a fact about Sundays", async (a) => {
    /* The last window that can do anything. "Bookings close Sunday 09:30" is
       true all week and reads as a detail; inside the final day the same
       information is the whole message. */
    const out = await words(WHEN.saturdayEvening, async () => {});
    a.eq(out.title, "Last chance to book for Sunday", "got: " + out.title);
    a.has(out.body, "09:30", "got: " + out.body);
    a.has(out.body, "tomorrow", "got: " + out.body);
  });

  s.test("read on Sunday morning, the same push says today", async (a) => {
    /* From the record, never from the tag. A Saturday push that sat in a
       tunnel until eight on Sunday must not still be saying tomorrow. */
    const out = await words("2026-10-04T08:10:00+01:00", async () => {});
    a.eq(out.title, "Last chance to book for Sunday", "got: " + out.title);
    a.has(out.body, "today", "got: " + out.body);
    a.hasnt(out.body, "tomorrow", "got: " + out.body);
  });

  s.test("midweek it is not a last chance", async (a) => {
    /* Every message being urgent is the same as none of them being urgent. */
    const out = await words(WHEN.wednesdayEvening, async () => {});
    a.hasnt(out.title, "Last chance", "got: " + out.title);
  });

  s.test("somebody who booked in the four minutes since the nudge is not asked again", async (a) => {
    /* The words come from the record, never from the tag. This is that rule
       doing something useful rather than just being true. */
    const out = await words(WHEN.thursdayEvening, async (db) => {
      const now = W.runSunday();
      const target = W.bookingsClosed(now) ? W.keyAddWeeks(now, 1) : now;
      await seedBookings(db, target, [{ route: "North", stopId: "N08" }]);
    });
    a.eq(out.title, "You are booked for Sunday", "got: " + out.title);
    a.has(out.body, "Stanley Pk");
  });

  s.test("before the bus sets off he is told when it comes and to be early", async (a) => {
    const out = await words(WHEN.sundayRunning, async (db, env, key) => {
      await seedBookings(db, key, [{ route: "North", stopId: "N08" }]);
    });
    a.has(out.title, "10:52", "his own timetabled time: " + out.title);
    a.has(out.body, "early");
    a.has(out.body, "Stanley Pk");
  });

  /* ---- quiet hours, on their own ---------------------------------------- */

  s.test("quiet hours understand a window that crosses midnight", (a) => {
    const rules = { quietFrom: 21, quietTo: 8 };
    a.ok(W.quietNow(rules, new Date("2026-10-01T23:30:00+01:00")), "half eleven at night is quiet");
    a.ok(W.quietNow(rules, new Date("2026-10-02T03:00:00+01:00")), "three in the morning is quiet");
    a.not(W.quietNow(rules, new Date("2026-10-01T18:30:00+01:00")), "half six in the evening is not");
    a.not(W.quietNow(rules, new Date("2026-10-01T08:30:00+01:00")), "half eight in the morning is not");
  });

  s.test("quiet hours switched off are switched off, not on all day", (a) => {
    a.not(W.quietNow({ quietFrom: 0, quietTo: 0 }, new Date("2026-10-01T03:00:00+01:00")),
          "equal hours mean no quiet time, not a whole day of it");
  });

  return s;
}
