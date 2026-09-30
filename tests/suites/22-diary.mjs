/* ONE PASSENGER, ONE WHOLE SUNDAY, HOUR BY HOUR.

   Nothing else in this suite does this, and that is why four faults in a row
   got through. Every other passenger test picks an hour, pins the clock and
   asserts — so each branch came out right at the hour its author had in mind,
   and nobody ever asked what the OTHER hours say.

   All four were the same sentence: RIGHT ANSWER, WRONG HOUR.

     the cancellation   right after 09:30, and before it said "You are booked
                        for Sunday" over a morning that was not running
     the morning push   right after 09:30, and at 07:45 — when it is actually
                        sent — never once said "be there early"
     the stale pickup   right until the bus got back, and then went on saying
                        "Picked up at Grace Rd" until seven in the evening
     and mine, w2.13.2  I fixed the second one by reading the day off the
                        payload instead of off the seat, so a man booked for
                        the 4th was told on the 27th that his bus was today

   The last of those is the argument for this file. I had just finished
   explaining that exact trap, in writing, and then walked into it — because I
   checked my change at the hour I was thinking about. A diary cannot be
   written at one hour.

   It reads as a table on purpose. Anybody can look down the column and see
   whether a sentence belongs at that time of day, which is a thing no
   assertion is as good at as a person's eye. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

/* Sunday 27 September 2026. North departs 09:52, Grace Rd at 10:15, back at
   church 11:00. Bookings close 09:30. */
const TODAY = "2026-09-27";
const NEXT  = "2026-10-04";
const DEP   = "2026-09-27T09:52:00+01:00";

/* stage: 0 nothing yet · 1 departed · 2 picked up · 3 run ended */
const HOURS = [
  ["07:00 before anything",    "2026-09-27T07:00:00+01:00", 0],
  ["07:45 morning message",    "2026-09-27T07:45:00+01:00", 0],
  ["09:20 ten to the cutoff",  "2026-09-27T09:20:00+01:00", 0],
  ["09:40 bookings closed",    "2026-09-27T09:40:00+01:00", 0],
  ["09:53 just left church",   "2026-09-27T09:53:00+01:00", 1],
  ["10:10 on its way",         "2026-09-27T10:10:00+01:00", 1],
  ["10:16 just picked up",     "2026-09-27T10:16:00+01:00", 2],
  ["11:05 run ended",          "2026-09-27T11:05:00+01:00", 3],
  ["13:00 early afternoon",    "2026-09-27T13:00:00+01:00", 3],
  ["15:20 the nudge window",   "2026-09-27T15:20:00+01:00", 3],
  ["19:00 Sunday evening",     "2026-09-27T19:00:00+01:00", 3],
  ["Mon 09:00",                "2026-09-28T09:00:00+01:00", 3],
  ["Wed 18:30 nudge window",   "2026-09-30T18:30:00+01:00", 3]
];

export default async function (root) {
  const s = new Suite("one passenger, one whole Sunday");
  const { mod: W } = await loadWorker(root);
  installGlobals();

  async function at(when, stage, seatOn, off) {
    return await atTime(when, async () => {
      const db = makeDB(join(root, "server", "schema.sql"));
      const env = makeEnv(db);
      for (const k of [TODAY, NEXT]) {
        await seedSunday(db, k, off && k === TODAY ? { status: "North cancelled" } : {});
      }
      await W.cachePut(env, "passenger_rules",
        { resendMinutes: 3, morningMessage: true, quietFrom: 21, quietTo: 8 }).run();
      await W.cachePut(env, "booking_rules", { on: true, oncePerWeek: false,
        windows: [{ day: 0, from: 15, to: 16 }, { day: 3, from: 18, to: 19 },
                  { day: 6, from: 18, to: 19 }] }).run();
      if (seatOn) {
        await db.prepare(
          "INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received, synced) " +
          "VALUES (?,'North','N02','Grace Rd',2,'dev-1','pid-1','07700900001','Booked',?,0)"
        ).bind(seatOn, Date.now()).run();
      }
      await db.prepare(
        "INSERT INTO push_subs (endpoint,p256dh,auth,role,ref,pid,driver,route,made,seen,fails,last) " +
        "VALUES ('https://push.example/p','p','a','passenger','dev-1','pid-1','','',?,0,0,'')"
      ).bind(Date.now()).run();

      const t0 = Date.parse(DEP), ev = [];
      if (stage >= 1) ev.push({ event: "start", at: t0 });
      if (stage >= 2) ev.push({ event: "picked", stopId: "N02", at: t0 + 1380000 });
      if (stage >= 3) ev.push({ event: "end", at: t0 + 4080000 });
      if (ev.length) await W.handleTrip(env, { trip: "t1", route: "North",
        driver: "Bro Adrian", reg: "YS70 PWE", sunday: TODAY, events: ev });

      const out = await W.pushWhat(env, "https://push.example/p");
      return { title: String(out.title || ""), body: String(out.body || ""),
               all: String(out.title || "") + " " + String(out.body || "") };
    });
  }

  const day = async (seatOn, off) => {
    const rows = {};
    for (const [label, when, stage] of HOURS) rows[label] = await at(when, stage, seatOn, off);
    return rows;
  };

  /* ---- the regular, who travelled this morning -------------------------- */

  s.test("HE IS TOLD TO BE AT HIS STOP EARLY, ON THE MORNING ITSELF", async (a) => {
    const d = await day(TODAY);
    for (const h of ["07:00 before anything", "07:45 morning message",
                     "09:20 ten to the cutoff", "09:40 bookings closed"]) {
      a.has(d[h].title, "today", h + ": " + d[h].title);
      a.has(d[h].title, "10:15", h + ": " + d[h].title);
      a.has(d[h].body, "early", h + ": " + d[h].body);
    }
  });

  s.test("the bus moving replaces the timetable with where it actually is", async (a) => {
    const d = await day(TODAY);
    a.has(d["09:53 just left church"].all, "left church");
    a.ok(/\d+ min|stop now/.test(d["09:53 just left church"].title),
         "no estimate a minute after it set off: " + d["09:53 just left church"].title);
    a.has(d["10:16 just picked up"].title, "Picked up");
  });

  s.test("AND ONCE THE RUN IS CLOSED OFF, THIS MORNING STOPS BEING THE NEWS", async (a) => {
    /* He got off at twenty past ten. Until w2.14.0 he was still reading
       "Picked up at Grace Rd. Have a good service." at seven in the evening. */
    const d = await day(TODAY);
    for (const h of ["11:05 run ended", "13:00 early afternoon",
                     "15:20 the nudge window", "19:00 Sunday evening"]) {
      a.hasnt(d[h].all, "Picked up", h + ": " + d[h].title);
      a.hasnt(d[h].all, "left church", h + ": " + d[h].title);
      a.hasnt(d[h].all, "Be at your stop", h + ": " + d[h].all);
      a.has(d[h].title, "Book your seat", h + ": " + d[h].title);
    }
  });

  /* ---- the man booked for NEXT Sunday, not this one --------------------- */

  s.test("A MAN BOOKED FOR NEXT SUNDAY IS NEVER TOLD HIS BUS IS TODAY", async (a) => {
    /* The fault I introduced in w2.13.2 and found here an hour later. His seat
       is on the 4th. From half nine on the 27th he was told, all day, that his
       bus was today at 10:15 and to get to his stop — which is a person sent to
       a kerb for a bus that is a week away, and worse than the vagueness it
       replaced. */
    const d = await day(NEXT);
    for (const [h, r] of Object.entries(d)) {
      a.hasnt(r.title, "today", h + " told him his bus was today: " + r.title);
      a.hasnt(r.body, "Be at your stop", h + ": " + r.body);
    }
  });

  s.test("and he is never shown this morning's bus, which is not his", async (a) => {
    const d = await day(NEXT);
    for (const h of ["09:53 just left church", "10:10 on its way", "10:16 just picked up"]) {
      a.hasnt(d[h].all, "left church", h + ": " + d[h].all);
      a.hasnt(d[h].all, "Picked up", h + ": " + d[h].all);
    }
    a.has(d["11:05 run ended"].title, "booked", "his own seat is still his: " +
          d["11:05 run ended"].title);
  });

  /* ---- and the man who never books ------------------------------------- */

  s.test("somebody with no seat is asked to book, at every hour of the week", async (a) => {
    const d = await day(null);
    for (const [h, r] of Object.entries(d)) {
      a.ok(/Book your seat|Last chance/.test(r.title), h + ": " + r.title);
      a.hasnt(r.all, "Picked up", h + ": he was never on it");
      a.hasnt(r.all, "Be at your stop", h + ": " + r.all);
    }
  });

  s.test("and inside the last day it is a deadline, not a fact about Sundays", async (a) => {
    const d = await day(null);
    a.has(d["07:45 morning message"].title, "Last chance");
    a.has(d["07:45 morning message"].body, "today", "the cutoff is today by then");
    a.has(d["Wed 18:30 nudge window"].title, "Book your seat",
          "Wednesday is not a last chance: " + d["Wed 18:30 nudge window"].title);
  });

  /* ---- THE RULE THE WHOLE FILE IS FOR ---------------------------------- */

  s.test("NO HOUR OF THE WEEK SAYS TODAY ABOUT A DAY THAT IS NOT TODAY", async (a) => {
    /* One sweep over all three people and every hour. This is the check that
       would have caught all four, and it is deliberately blunt: the word
       "today" may only appear on the 27th, and only to somebody whose seat is
       on the 27th. */
    for (const [who, seatOn] of [["travelled", TODAY], ["next week", NEXT], ["no seat", null]]) {
      const d = await day(seatOn);
      for (const [h, r] of Object.entries(d)) {
        if (!/today/i.test(r.all)) continue;
        const onTheDay = h.indexOf("Mon") !== 0 && h.indexOf("Wed") !== 0;
        a.ok(onTheDay, who + ", " + h + " said today on another day: " + r.all);
        /* "bookings close at 09:30 today" is about the cutoff, not a bus. */
        if (/your bus today/i.test(r.title)) {
          a.eq(seatOn, TODAY, who + ", " + h + ": told his bus was today: " + r.title);
        }
      }
    }
  });

  /* ---- and the morning that was called off ------------------------------

     The first of the four faults, and the only one nothing in this file would
     have caught until now: the diary had no cancelled day in it. A whole-day
     test that only walks through days where everything works is half a test.

     No run is seeded here even at the later stages, because a cancelled route
     has no run — which is exactly why the wording below must never come from
     the bus. */

  s.test("A CALLED-OFF MORNING SAYS SO AT EVERY HOUR, NOT JUST AFTER 09:30", async (a) => {
    /* It said "You are booked for Sunday" until half nine, and the sweep that
       pushes it runs all week — so the notification arrived reassuring the very
       people it was sent to warn. */
    const d = await day(TODAY, true);
    for (const [h, r] of Object.entries(d)) {
      if (h.indexOf("Mon") === 0 || h.indexOf("Wed") === 0) continue;
      a.has(r.title, "No bus", h + ": " + r.title);
      a.hasnt(r.title, "booked", h + " reassured him: " + r.title);
      a.hasnt(r.body, "Be at your stop", h + " sent him to the kerb: " + r.body);
    }
  });

  s.test("and it says which day, on whichever day it is read", async (a) => {
    /* The sweep fires the moment the Rota is edited, so a route called off on
       the Friday is pushed on the Friday. "No bus today" is then a sentence
       about the wrong day. */
    const d = await day(TODAY, true);
    a.has(d["07:45 morning message"].title, "today", d["07:45 morning message"].title);
    a.has(d["19:00 Sunday evening"].title, "today");
  });

  s.test("once the week turns over, the cancelled morning is not mentioned again", async (a) => {
    /* It was last Sunday's problem. Monday is about the next one. */
    const d = await day(TODAY, true);
    for (const h of ["Mon 09:00", "Wed 18:30 nudge window"]) {
      a.hasnt(d[h].title, "No bus", h + " was still apologising: " + d[h].title);
      a.ok(/Book your seat|Last chance/.test(d[h].title), h + ": " + d[h].title);
    }
  });

  /* ================ AND THE DRIVER'S WHOLE SUNDAY =======================

     Swept the same way once the passenger side was clean, because "I reasoned
     the driver gates look tighter" is exactly the kind of sentence that has
     been wrong four times this week. It gave up one fault of its own.

     THE STAND-DOWN. driverRouteToday falls back to the route a phone
     REGISTERED with when the man's name matches nobody — right for a message
     about a route, wrong for every sentence that says "your". So: he is
     rostered, the sweep wakes him at eight, the coordinator swaps him off at
     ten past, he opens the notification at twenty past, and reads "You are
     driving today. North. Depart 09:52 after vehicle check."

     A man sent to a bus he had just been taken off — by the very design
     written to stop stale words arriving. Everything else in that section is
     computed from the record. That one sentence was not. */

  const DDEP = "2026-09-27T09:52:00+01:00";
  const DHOURS = [
    ["Fri 14:00",        "2026-09-25T14:00:00+01:00", 0],
    ["Sat 20:00",        "2026-09-26T20:00:00+01:00", 0],
    ["07:00",            "2026-09-27T07:00:00+01:00", 0],
    ["08:00 duty window","2026-09-27T08:00:00+01:00", 0],
    ["09:45",            "2026-09-27T09:45:00+01:00", 0],
    ["10:05 13 min late","2026-09-27T10:05:00+01:00", 0],
    ["09:55 just off",   "2026-09-27T09:55:00+01:00", 1],
    ["11:20 past due",   "2026-09-27T11:20:00+01:00", 1],
    ["11:05 ended",      "2026-09-27T11:05:00+01:00", 2],
    ["19:00",            "2026-09-27T19:00:00+01:00", 2],
    ["Mon 09:00",        "2026-09-28T09:00:00+01:00", 2]
  ];

  async function drvAt(when, stage, o) {
    return await atTime(when, async () => {
      const db = makeDB(join(root, "server", "schema.sql"));
      const env = makeEnv(db);
      /* SOUTH IS NAMED EXPLICITLY. seedSunday defaults it to Bro Trevor, so the
         "not on the rota" and "unnamed cover" columns had him rostered on the
         other route without meaning to — and the app was quite right to tell
         him he was driving. Two of my own assertions failed on that before I
         looked at what the fixture actually said. */
      await seedSunday(db, TODAY, { north: "Bro Adrian", south: o.south || "Bro Keith" });
      await W.cachePut(env, "passenger_rules",
        { resendMinutes: 3, morningMessage: true, quietFrom: 21, quietTo: 8 }).run();
      const ep = "https://push.example/drv";
      await db.prepare(
        "INSERT INTO push_subs (endpoint,p256dh,auth,role,ref,pid,driver,route,made,seen,fails,last) " +
        "VALUES (?,'p','a','driver','dv','',?,'North',?,0,0,'')"
      ).bind(ep, o.who, Date.now()).run();
      const t0 = Date.parse(DDEP), ev = [];
      if (stage >= 1) ev.push({ event: "start", at: t0 });
      if (stage >= 2) ev.push({ event: "end", at: t0 + 4080000 });
      if (ev.length) await W.handleTrip(env, { trip: "t1", route: "North",
        driver: o.drove || "Bro Adrian", reg: "YS70 PWE", sunday: TODAY, events: ev });
      if (o.standDown) {
        await db.prepare("UPDATE rota SET north=?, north_cover='' WHERE sunday=?")
          .bind("Bro Trevor", TODAY).run();
      }
      const out = await W.pushWhat(env, ep);
      return { title: String(out.title || ""), body: String(out.body || ""),
               all: String(out.title || "") + " " + String(out.body || "") };
    });
  }
  const drvDay = async (o) => {
    const rows = {};
    for (const [label, when, stage] of DHOURS) rows[label] = await drvAt(when, stage, o);
    return rows;
  };

  s.test("the rostered driver is told his morning, and only on the morning", async (a) => {
    const d = await drvDay({ who: "Bro Adrian" });
    for (const h of ["Fri 14:00", "Sat 20:00"]) {
      a.hasnt(d[h].title, "driving today", h + " woke him two days early: " + d[h].title);
    }
    for (const h of ["07:00", "08:00 duty window", "09:45"]) {
      a.has(d[h].title, "driving today", h + ": " + d[h].title);
      a.has(d[h].body, "09:52", h + ": " + d[h].body);
    }
    a.has(d["10:05 13 min late"].title, "not gone out");
    a.has(d["11:20 past due"].title, "End the trip");
    a.hasnt(d["11:05 ended"].all, "End the trip", "chased to close a closed run");
    a.hasnt(d["19:00"].all, "driving today", "still on duty at seven in the evening");
  });

  s.test("A DRIVER STOOD DOWN IS NOT STILL TOLD TO DRIVE", async (a) => {
    /* The fault this section found. The push has gone; the rota has changed;
       he opens it. */
    /* Only the hours BEFORE a run, which is the real shape of a stand-down: he
       is taken off in the morning and does not drive. The later rows in this
       fixture have him out on the road, where "your run is running" is simply
       true — my first version asserted across all of them and failed on a
       sentence that was correct. */
    const d = await drvDay({ who: "Bro Adrian", standDown: true });
    for (const h of ["Fri 14:00", "Sat 20:00", "07:00", "08:00 duty window",
                     "09:45", "10:05 13 min late"]) {
      const r = d[h];
      a.hasnt(r.title, "driving today", h + ": " + r.title);
      a.hasnt(r.body, "Depart", h + " sent him to a bus he is off: " + r.body);
      a.hasnt(r.all, "run was due", h + " called it his run: " + r.all);
    }
  });

  s.test("and a man who is nobody's driver today hears nothing all week", async (a) => {
    const d = await drvDay({ who: "Bro Nobody" });
    for (const [h, r] of Object.entries(d)) {
      a.has(r.body, "Nothing outstanding", h + ": " + r.all);
    }
  });

  s.test("BUT THE MAN ACTUALLY DRIVING IT IS STILL HIS RUN'S DRIVER", async (a) => {
    /* The case the gate had to not break. A morning can be driven by somebody
       the rota never named — the app records it as Cover and it is a real
       Sunday. He is as much that run's driver as anybody, and the one who has
       to close it. Gating on the rota alone would have silenced exactly the man
       holding the keys. */
    const d = await drvDay({ who: "Bro Trevor", drove: "Bro Trevor" });
    a.has(d["11:20 past due"].title, "End the trip",
          "the man driving was told nothing: " + d["11:20 past due"].title);
    a.hasnt(d["08:00 duty window"].title, "driving today",
            "before he set off the rota did not name him, and it should not pretend");
  });

  return s;
}
