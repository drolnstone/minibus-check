/* EVERY ALERT — AND ESPECIALLY THE ONES THAT ONLY FIRE ON A BAD MORNING.

   This suite exists because of a measurement rather than a hunch. Each alert
   in the app was silenced in turn and the whole suite re-run, and thirteen of
   twenty-three could be deleted outright without a single check going red.
   Test NAMES mentioning an email prove nothing; only breaking the email does.

   THE SPLIT THAT MATTERS. Four of the thirteen fire on any ordinary Sunday, so
   they announce their own health every week — if the walkaround email stops
   arriving, somebody notices by lunchtime. The other nine only fire when
   something has gone wrong: a bus stopped, a route called off, a run twenty
   minutes late, a morning left open, a stop passed unmarked.

   That is the dangerous shape. An alert whose whole job is a bad morning, with
   nothing proving it works, looks perfectly healthy every week that nothing
   happens — and is discovered broken on the one day it was the only thing
   standing between a driver and a bus he should not be in.

   So the order here is worst first: the three where silence puts somebody in
   the wrong vehicle, then the rest. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";
import { TABS, tab } from "../lib/tabs.mjs";

/* OFF THE REAL TAB, NOT TYPED HERE. Every header in this file used to be its
   own copy, and two of the three were wrong: Checks said "When" where the tab
   says "Date", so nothing matched and every bus read as unchecked; Bus Bookings
   said "Passenger" and invented a "Note" column the tab does not have. See
   tests/lib/tabs.mjs for the whole list and why it exists. */
const ROTA_H = TABS["Rota"], CHK_H = TABS["Checks"], BOOK_H = TABS["Bus Bookings"];

export default async function (root) {
  const s = new Suite("alerts, and the ones that only fire on a bad morning");

  /* ---------------------------------------------------------------- the sheet */

  const SUN = new Date(2026, 9, 4);

  function sheet(over) {
    const tabs = {
      "Bus Stops": tab("Bus Stops", [
        { Route: "North", "Stop ID": "N00", Time: "09:52", Stop: "Church, Chester Road",
          Postcode: "L6 4DY", Active: "YES", Type: "Depart" },
        { Route: "North", "Stop ID": "N01", Time: "10:00", Stop: "Scarisbrick Drive",
          Postcode: "L11 7DD", Active: "YES", Type: "Pickup", Lat: 53.4, Lng: -2.9 },
        { Route: "North", "Stop ID": "N99", Time: "10:40", Stop: "Church, Chester Road",
          Postcode: "L6 4DY", Active: "YES", Type: "Arrival" }]),
      "Drivers": tab("Drivers", [
        { Name: "Bro Asim", Role: "Coordinator", Active: "YES", "Primary order": 1,
          PIN: "1234", Email: "asim@b.c", Route: "North" },
        { Name: "Bro Adebola", Role: "Driver", Active: "YES", "Primary order": 2,
          PIN: "4321", Email: "ade@b.c", Route: "North" },
        { Name: "Bro Kayode", Role: "Driver", Active: "YES", "Primary order": 3,
          PIN: "8765", Email: "kayode@b.c", Route: "South" }]),
      "Buses": tab("Buses", [
        { Registration: "YS70 PWE", "Seats for passengers": 16, Active: "YES" },
        { Registration: "NH56 FWP", "Seats for passengers": 14, Active: "YES" }]),
      "Rota": tab("Rota", [
        { Sunday: SUN, "North Liverpool scheduled": "Bro Adebola", "North bus": "YS70 PWE",
          Status: "Confirmed", "South Liverpool scheduled": "Bro Kayode",
          "South bus": "NH56 FWP" }]),
      "Checks": [CHK_H], "Defects": [["When"]], "Trip Events": [["When"]],
      "Bus Bookings": [BOOK_H], "Rota Requests": [["When"]]
    };
    return loadCodeGs(root, { tabs: Object.assign(tabs, over || {}),
      props: { COORDINATOR_EMAIL: "coord@b.c", PIN_SALT: "salt",
               WORKER_URL: "https://example.invalid" } });
  }

  const toCoord = (L) => L.gas.mail.filter((m) => String(m.to).indexOf("coord@") === 0);
  /* Both bodies, every time. A fact that reaches the HTML and not the plain
     text reaches whoever reads mail in a preview pane and nobody else.

     TAGS COME OUT FIRST. The HTML half writes "The rota has <b>not</b>
     changed", so a plain substring search finds the sentence in the plain
     text and misses it in the HTML — which would have failed this suite over
     a bold tag and taught whoever met it to loosen the check. */
  const words = (h) => String(h || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");
  const bothSay = (m, text) => words(m.htmlBody).indexOf(text) > -1 &&
                               String(m.body || "").indexOf(text) > -1;

  const CHECK = {
    id: "chk-1", reg: "YS70 PWE", vehicle: "Ford Transit", driver: "Bro Adebola",
    role: "Driver", date: "4 October 2026", time: "09:40", miles: 48213,
    sign: "Bro Adebola", advisories: [], jobs: []
  };

  /* ---- 1. A BUS IS OFF THE ROAD ----------------------------------------
     The most important message the app sends, and until now deleting the line
     that sent it broke nothing at all. */

  s.test("A STOPPED BUS EMAILS THE COORDINATOR, AND SAYS WHICH BUS AND WHY", (a) => {
    const L = sheet();
    call(L, "notifyCheck", Object.assign({}, CHECK, { level: "stop" }),
         "Stopped", "Nearside mirror cracked");
    const got = toCoord(L);
    a.eq(got.length, 1, "nothing was sent about a bus going off the road");
    a.has(got[0].subject, "BUS STOPPED", "got: " + got[0].subject);
    a.has(got[0].subject, "YS70 PWE", "the subject does not say which bus");
    a.ok(bothSay(got[0], "YS70 PWE"), "one of the two bodies omits the bus");
    a.ok(bothSay(got[0], "Nearside mirror cracked"), "it does not say what stopped it");
    a.ok(bothSay(got[0], "Bro Adebola"), "it does not say who found it");
  });

  s.test("and a driveable defect is told apart from a stopped bus", (a) => {
    /* Same email, different urgency. Reading one as the other is either a
       panic or a bus quietly left on the road. */
    const L = sheet();
    call(L, "notifyCheck", Object.assign({}, CHECK, { level: "defect" }),
         "Defect", "Offside wiper smearing");
    const got = toCoord(L);
    a.eq(got.length, 1);
    a.hasnt(got[0].subject, "BUS STOPPED", "a wiper took a bus off the road");
    a.ok(bothSay(got[0], "Offside wiper smearing"));
  });

  s.test("an advisory still reaches him, and does not read as a defect", (a) => {
    const L = sheet();
    call(L, "notifyCheck", Object.assign({}, CHECK, {
      level: "ok", advisories: [{ name: "Nearside tyre", crit: false, note: "wearing" }]
    }), "Advisory", "");
    const got = toCoord(L);
    a.eq(got.length, 1, "a driver noted something to watch and nobody heard");
    a.ok(bothSay(got[0], "Nearside tyre"));
    a.hasnt(got[0].subject, "BUS STOPPED");
  });

  s.test("a clean check with a job to arrange is not silence", (a) => {
    const L = sheet();
    call(L, "notifyCheck", Object.assign({}, CHECK, {
      level: "ok", jobs: ["Book the 12,000 mile service"]
    }), "Cleared", "");
    const got = toCoord(L);
    a.eq(got.length, 1, "he asked for something to be arranged and nobody was told");
    a.ok(bothSay(got[0], "Book the 12,000 mile service"));
  });

  /* ---- 2. A BUS RELEASED BACK ONTO THE ROAD ---------------------------- */

  s.test("AUTHORISING A BUS EMAILS THE COORDINATOR, NAMING WHO DID IT", (a) => {
    /* The other half of the pair above. A bus can go off the road and come
       back on it, and the record of who decided it may run is the whole
       point of the authorisation. */
    const L = sheet();
    call(L, "notifyAuthorised", { reg: "YS70 PWE", by: "Bro Asim",
      inspector: "Bro Adebola", at: Date.now(), via: "app" });
    const got = toCoord(L);
    a.eq(got.length, 1, "a bus was let back out and nothing was recorded by email");
    a.has(got[0].subject, "YS70 PWE");
    a.ok(bothSay(got[0], "Bro Asim"), "it does not say who authorised it");
    a.ok(bothSay(got[0], "Bro Adebola"), "it does not say who did the walkaround");
    a.ok(bothSay(got[0], "The defect stays open"),
         "the one sentence that stops a fault being forgotten");
  });

  s.test("and it says whether it came from the app or the spreadsheet", (a) => {
    const L = sheet();
    call(L, "notifyAuthorised", { reg: "YS70 PWE", by: "Bro Asim",
      inspector: "Bro Adebola", at: Date.now(), via: "sheet" });
    a.has(String(toCoord(L)[0].htmlBody), "on the spreadsheet");
  });

  /* ---- 3. A DRIVER ASKS FOR A CHANGE ----------------------------------- */

  s.test("A ROTA REQUEST EMAILS THE COORDINATOR, WITH WHAT WAS ASKED", (a) => {
    const L = sheet();
    call(L, "notifyRotaRequest", { id: "REQ-1", date: SUN, driver: "Bro Adebola",
      type: "Request cover", reason: "away that weekend", swapWith: "", swapDate: "",
      agreed: false }, SUN);
    const got = toCoord(L);
    a.eq(got.length, 1, "a driver asked a question and nobody was told");
    a.has(got[0].subject, "Bro Adebola");
    a.ok(bothSay(got[0], "Request cover"));
    a.ok(bothSay(got[0], "away that weekend"), "the reason is the whole of the decision");
    a.ok(bothSay(got[0], "The rota has not changed"),
         "he must not think approving has already happened");
  });

  s.test("a swap names its partner and the Sunday being taken", (a) => {
    const L = sheet();
    call(L, "notifyRotaRequest", { id: "REQ-2", date: SUN, driver: "Bro Adebola",
      type: "Request a swap", reason: "family visiting", swapWith: "Bro Kayode",
      swapDate: "2026-10-11", agreed: true }, SUN);
    const m = toCoord(L)[0];
    a.ok(bothSay(m, "Bro Kayode"), "a swap that does not say with whom");
    a.ok(bothSay(m, "2026-10-11"), "or which Sunday is being taken");
  });

  /* ---- 4. A BUS WENT OUT WITH NOBODY CHECKING IT -----------------------

     Sunday 10:45, by which time both routes are already out. It is not a
     prompt to catch a bus; it is a record and a request to inspect on return,
     while whatever happened this morning can still be found. */

  const SUNDAY_1045 = "2026-10-04T10:45:00+01:00";
  const SUNDAY_1900 = "2026-10-04T19:00:00+01:00";

  /* Buses only count as expected once the app has seen a check for them, so
     the history is what puts them on the list at all. */
  function withHistory(over) {
    return sheet(Object.assign({
      "Checks": tab("Checks", [
        { Received: new Date(2026, 8, 27, 9, 30), Date: new Date(2026, 8, 27), Time: "09:30",
          "Check ID": "old-1", Registration: "YS70 PWE", Driver: "Bro Adebola", Role: "Driver",
          Mileage: 48000, Outcome: "Cleared" },
        { Received: new Date(2026, 8, 27, 9, 35), Date: new Date(2026, 8, 27), Time: "09:35",
          "Check ID": "old-2", Registration: "NH56 FWP", Driver: "Bro Kayode", Role: "Driver",
          Mileage: 31000, Outcome: "Cleared" }])
    }, over || {}));
  }

  s.test("A BUS THAT WENT OUT UNCHECKED IS REPORTED, AND NAMED", async (a) => {
    await atTime(SUNDAY_1045, () => {
      const L = withHistory();
      call(L, "missingCheckAlert");
      const got = toCoord(L);
      a.eq(got.length, 1, "two buses went out unchecked and nobody was told");
      a.has(got[0].subject, "went out unchecked");
      a.ok(bothSay(got[0], "YS70 PWE"), "it does not say which bus");
      a.ok(bothSay(got[0], "NH56 FWP"), "or the other one");
      a.ok(bothSay(got[0], "inspected on return"), "the thing it is actually asking for");
    });
  });

  s.test("and it says who was down to drive, so there is a phone to pick up", async (a) => {
    await atTime(SUNDAY_1045, () => {
      const L = withHistory();
      call(L, "missingCheckAlert");
      const m = toCoord(L)[0];
      a.ok(bothSay(m, "Bro Adebola"), "it leaves him to work out whose morning it was");
      a.ok(bothSay(m, "Bro Kayode"));
    });
  });

  s.test("a bus that WAS checked is not on the list", async (a) => {
    /* The half that makes it worth reading. An alert that names every bus
       every week is an alert nobody opens. */
    await atTime(SUNDAY_1045, () => {
      const L = withHistory({
        "Checks": tab("Checks", [
          { Received: new Date(2026, 8, 27, 9, 30), Date: new Date(2026, 8, 27), Time: "09:30",
            "Check ID": "old-1", Registration: "YS70 PWE", Driver: "Bro Adebola", Mileage: 48000, Outcome: "Cleared" },
          { Received: new Date(2026, 8, 27, 9, 35), Date: new Date(2026, 8, 27), Time: "09:35",
            "Check ID": "old-2", Registration: "NH56 FWP", Driver: "Bro Kayode", Mileage: 31000, Outcome: "Cleared" },
          { Received: new Date(2026, 9, 4, 9, 30), Date: new Date(2026, 9, 4), Time: "09:30",
            "Check ID": "today-1", Registration: "YS70 PWE", Driver: "Bro Adebola", Mileage: 48200, Outcome: "Cleared" }])
      });
      call(L, "missingCheckAlert");
      const got = toCoord(L);
      a.eq(got.length, 1, "got " + got.length);
      a.hasnt(String(got[0].htmlBody), "\u2022 <b>YS70 PWE",
              "a bus that was checked this morning was reported as unchecked");
      a.ok(bothSay(got[0], "NH56 FWP"), "and the one that was not is still named");
    });
  });

  s.test("every bus checked means no email at all", async (a) => {
    await atTime(SUNDAY_1045, () => {
      const L = withHistory({
        "Checks": tab("Checks", [
          { Received: new Date(2026, 8, 27, 9, 30), Date: new Date(2026, 8, 27), Time: "09:30",
            "Check ID": "old-1", Registration: "YS70 PWE", Driver: "Bro Adebola", Mileage: 48000, Outcome: "Cleared" },
          { Received: new Date(2026, 8, 27, 9, 35), Date: new Date(2026, 8, 27), Time: "09:35",
            "Check ID": "old-2", Registration: "NH56 FWP", Driver: "Bro Kayode", Mileage: 31000, Outcome: "Cleared" },
          { Received: new Date(2026, 9, 4, 9, 30), Date: new Date(2026, 9, 4), Time: "09:30",
            "Check ID": "t1", Registration: "YS70 PWE", Driver: "Bro Adebola", Mileage: 48200, Outcome: "Cleared" },
          { Received: new Date(2026, 9, 4, 9, 35), Date: new Date(2026, 9, 4), Time: "09:35",
            "Check ID": "t2", Registration: "NH56 FWP", Driver: "Bro Kayode", Mileage: 31200, Outcome: "Cleared" }])
      });
      call(L, "missingCheckAlert");
      a.eq(toCoord(L).length, 0, "it wrote to say nothing was wrong");
    });
  });

  s.test("it is a Sunday sweep and stays quiet on a weekday", async (a) => {
    await atTime("2026-10-07T10:45:00+01:00", () => {
      const L = withHistory();
      call(L, "missingCheckAlert");
      a.eq(toCoord(L).length, 0, "it reported a Wednesday for having no minibus check");
    });
  });

  /* ---- 5. MORE BOOKED THAN THE BUS HOLDS ------------------------------- */

  /* THE SWEEP LOOKS AT sundayOf(now), NOT AT A DATE IT IS HANDED. So the
     clock has to be pinned to the week the fixture is about, or the bookings
     are for a Sunday nobody is asking about and the check passes for being
     empty rather than for being right. */
  const SATURDAY_BEFORE = "2026-10-03T18:00:00+01:00";

  function booked(n, status) {
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push({ Received: new Date(), "Live ID": "L" + i, Sunday: SUN, Route: "North",
                  "Stop ID": "N01", Stop: "Scarisbrick Drive", Seats: 1,
                  Device: "d" + i, "Passenger ID": "p" + i,
                  Status: status ? status(i) : "Booked" });
    }
    return { "Bus Bookings": tab("Bus Bookings", rows) };
  }

  s.test("A ROUTE OVER ITS SEATS IS REPORTED WITH THE NUMBERS", async (a) => {
    const got = await atTime(SATURDAY_BEFORE, () => {
      const L = sheet(booked(20));
      call(L, "overbookingAlert", true);
      return toCoord(L);
    });
    a.eq(got.length, 1, "twenty people booked onto sixteen seats and nobody was told");
    a.has(got[0].subject, "overbooked");
    a.ok(bothSay(got[0], "YS70 PWE"), "it does not say which bus");
    a.ok(bothSay(got[0], "16"), "or how many it seats");
    a.ok(bothSay(got[0], "20"), "or how many are booked");
    a.ok(bothSay(got[0], "4"), "or how many will not fit");
  });

  s.test("a route inside its seats says nothing", async (a) => {
    /* The reason this one can be trusted when it does arrive. */
    await atTime(SATURDAY_BEFORE, () => {
      const L = sheet(booked(9));
      call(L, "overbookingAlert", true);
      a.eq(toCoord(L).length, 0, "nine people on a sixteen seater is not an emergency");
    });
  });

  s.test("a cancelled seat does not count towards the bus being full", async (a) => {
    await atTime(SATURDAY_BEFORE, () => {
      const L = sheet(booked(20, (i) => (i < 6 ? "Cancelled" : "Booked")));
      call(L, "overbookingAlert", true);
      a.eq(toCoord(L).length, 0, "six people who cancelled were still on the bus");
    });
  });

  /* ---- 6. THE WEEK, UNASKED -------------------------------------------- */

  s.test("THE WEEKLY SUMMARY GOES OUT ON SUNDAY EVENING", async (a) => {
    await atTime(SUNDAY_1900, () => {
      const L = withHistory();
      call(L, "weeklyDigest");
      const got = toCoord(L);
      a.eq(got.length, 1, "the week went by and nothing summarised it");
      a.has(got[0].subject, "weekly summary");
    });
  });

  /* ================ THE DRIVER'S PHONE ==================================

     Four messages, none of which had a test, and every one of which only
     exists because a morning went wrong. The first two are the ones where
     silence has a man in a vehicle he should not be in. */

  const { mod: W } = await loadWorker(root);
  installGlobals();

  /* Sunday 27 September 2026. North departs 09:52 on the seeded timetable. */
  const SUN_0800 = "2026-09-27T08:00:00+01:00";   /* before departure     */
  const SUN_1010 = "2026-09-27T10:10:00+01:00";   /* 18 min past it       */
  const SUN_1230 = "2026-09-27T12:30:00+01:00";   /* long past arrival    */

  async function live(over) {
    const o = over || {};
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    const key = W.runSunday();
    await seedSunday(db, key, o.rota || {});
    await W.cachePut(env, "passenger_rules",
      { resendMinutes: 3, morningMessage: true, quietFrom: 21, quietTo: 8 }).run();
    return { db, env, key };
  }

  /* A driver's handset. Matched to the Rota by name, loosely — see
     DRIVER_SUB_MATCH in the Worker for why that is not a bare equals. */
  async function driverPhone(db, name, route) {
    await db.prepare(
      "INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, driver, route, made, seen, fails, last) " +
      "VALUES (?,?,?,?,?,?,?,?,?,0,0,'')"
    ).bind("https://push.example/drv-" + name.replace(/\W/g, ""), "p", "a", "driver",
           "d-" + name, "", name, route || "", Date.now()).run();
    return "https://push.example/drv-" + name.replace(/\W/g, "");
  }

  const woken = (db) => db._rows("SELECT driver, last FROM push_subs WHERE last <> ''");

  /* ---- 7. HIS ROUTE IS NOT RUNNING AT ALL ------------------------------- */

  s.test("A CALLED-OFF ROUTE TELLS ITS DRIVER, BEFORE HE SETS OFF", async (a) => {
    /* Silence here is a man who gets up at seven, drives to church and finds
       there is no morning. It outranks every other driver message for that
       reason, and nothing was proving it fired at all. */
    await atTime(SUN_0800, async () => {
      const { db, env } = await live({ rota: { status: "North cancelled" } });
      await driverPhone(db, "Bro Adebola", "North");
      await W.wakeDrivers(env);
      const got = woken(db);
      a.eq(got.length, 1, "his route was called off and his phone stayed silent");
      a.has(got[0].last, "off|", "woken, but not about the cancellation: " + got[0].last);
    });
  });

  s.test("and the words say the route by name, not just that something is off", async (a) => {
    await atTime(SUN_0800, async () => {
      const { db, env } = await live({ rota: { status: "North cancelled" } });
      const ep = await driverPhone(db, "Bro Adebola", "North");
      const out = await W.pushWhat(env, ep);
      a.has(out.title + " " + out.body, "North", "it does not say which route: " + out.title);
      a.has(out.title, "not running");
    });
  });

  s.test("THE OTHER ROUTE'S DRIVER IS NOT TOLD HIS MORNING IS OFF", async (a) => {
    /* One cancelled route must not read as both. Telling the South driver to
       stay at home is the same fault in the other direction. */
    await atTime(SUN_0800, async () => {
      const { db, env } = await live({ rota: { status: "North cancelled" } });
      const ep = await driverPhone(db, "Bro Tunde", "South");
      const out = await W.pushWhat(env, ep);
      a.hasnt(out.title, "not running",
              "the South driver was told his route was cancelled: " + out.title);
    });
  });

  /* ---- 8. THE BUS THAT NEVER LEFT -------------------------------------- */

  s.test("A RUN THAT HAS NOT STARTED WAKES ITS DRIVER", async (a) => {
    /* Ten minutes past departure with no start tap. Either he has forgotten
       to tap, or he is not there — and the second one is a bus full of people
       waiting at a kerb for something that is not coming. */
    await atTime(SUN_1010, async () => {
      const { db, env } = await live();
      await driverPhone(db, "Bro Adebola", "North");
      await W.wakeDrivers(env);
      const got = woken(db);
      a.eq(got.length, 1, "eighteen minutes late and nobody asked him anything");
      a.has(got[0].last, "start", "woken about something else: " + got[0].last);
    });
  });

  s.test("and a run already out wakes nobody about starting", async (a) => {
    await atTime(SUN_1010, async () => {
      const { db, env, key } = await live();
      await driverPhone(db, "Bro Adebola", "North");
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adebola",
        reg: "YS70 PWE", sunday: key, events: [{ event: "start", at: Date.now() - 1200000 }] });
      await W.wakeDrivers(env);
      const got = woken(db).filter((r) => String(r.last).indexOf("start") === 0);
      a.eq(got.length, 0, "he was asked why he had not set off, from a moving bus");
    });
  });

  /* ---- 9. THE MORNING, SAID ON THE MORNING ----------------------------- */

  s.test("THE ROSTERED DRIVER IS TOLD HE IS DRIVING TODAY", async (a) => {
    await atTime(SUN_0800, async () => {
      const { db, env } = await live();
      const ep = await driverPhone(db, "Bro Adebola", "North");
      await W.wakeDrivers(env);
      const got = woken(db);
      a.eq(got.length, 1, "nobody told the man it was his morning");
      a.has(got[0].last, "duty|", "got: " + got[0].last);

      const out = await W.pushWhat(env, ep);
      a.has(out.title, "driving today");
      a.has(out.body, "North", "it does not say which route");
      a.has(out.body, "09:52", "or when it leaves: " + out.body);
    });
  });

  s.test("a man not on the rota is told nothing at all", async (a) => {
    await atTime(SUN_0800, async () => {
      const { db, env } = await live();
      await driverPhone(db, "Bro Nobody", "North");
      await W.wakeDrivers(env);
      a.eq(woken(db).length, 0, "somebody who is not driving was told he was");
    });
  });

  /* ---- 10. THE RUN NOBODY CLOSED --------------------------------------- */

  s.test("A RUN LEFT OPEN LONG AFTER THE LAST STOP ASKS HIM TO END IT", async (a) => {
    /* It never closes itself. An open run holds the route against the next
       driver and leaves the morning unfinished in the record. */
    await atTime(SUN_1230, async () => {
      const { db, env, key } = await live();
      await driverPhone(db, "Bro Adebola", "North");
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adebola",
        reg: "YS70 PWE", sunday: key,
        events: [{ event: "start", at: Date.parse("2026-09-27T09:52:00+01:00") }] });
      await W.wakeDrivers(env);
      const got = woken(db);
      a.eq(got.length, 1, "the run sat open and nobody was asked to close it");
      a.has(got[0].last, "end", "got: " + got[0].last);
    });
  });

  s.test("a run he has already ended asks him nothing", async (a) => {
    await atTime(SUN_1230, async () => {
      const { db, env, key } = await live();
      await driverPhone(db, "Bro Adebola", "North");
      const t0 = Date.parse("2026-09-27T09:52:00+01:00");
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adebola",
        reg: "YS70 PWE", sunday: key, events: [{ event: "start", at: t0 }] });
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adebola",
        reg: "YS70 PWE", sunday: key, events: [{ event: "end", at: t0 + 3600000 }] });
      await W.wakeDrivers(env);
      const got = woken(db).filter((r) => String(r.last).indexOf("end") === 0);
      a.eq(got.length, 0, "he was chased to close a run he had closed");
    });
  });

  /* ================ THE PASSENGER'S PHONE ===============================

     The stop-by-stop estimates were already well covered. These three were
     not, and they are the bookends: the message that says there is no bus at
     all, the one that says it has set off, and the one that admits it has
     gone past without him. */

  async function passengerPhone(db, stopId, over) {
    const o = over || {};
    await db.prepare(
      "INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, driver, route, made, seen, fails, last) " +
      "VALUES (?,?,?,?,?,?,?,?,?,0,0,'')"
    ).bind("https://push.example/pax-" + stopId, "p", "a", "passenger",
           "dev-" + stopId, "pid-" + stopId, "", "", Date.now()).run();
    return "https://push.example/pax-" + stopId;
  }

  async function withSeat(db, key, stopId, route) {
    await db.prepare(
      "INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received, synced) " +
      "VALUES (?,?,?,?,?,?,?,?,'Booked',?,0)"
    ).bind(key, route || "North", stopId, stopId, 2, "dev-" + stopId,
           "pid-" + stopId, "07700900001", Date.now()).run();
  }

  /* ---- 11. THERE IS NO BUS TODAY --------------------------------------- */

  s.test("A CALLED-OFF ROUTE TELLS THE PEOPLE WAITING FOR IT", async (a) => {
    /* The passenger half of the cancellation. Without it somebody stands at a
       kerb in the rain for a bus that was called off on Friday. */
    await atTime(SUN_0800, async () => {
      const { db, env, key } = await live({ rota: { status: "North cancelled" } });
      await withSeat(db, key, "N01");
      const ep = await passengerPhone(db, "N01");
      await W.wakeCancelled(env);
      const got = db._rows("SELECT ref, last FROM push_subs WHERE last <> ''");
      a.eq(got.length, 1, "the route was called off and nobody at the stop was told");
      a.has(got[0].last, "off|", "got: " + got[0].last);

      const out = await W.pushWhat(env, ep);
      a.has(out.title, "No bus", "got: " + out.title);
    });
  });

  s.test("and a passenger on the route that IS running is left alone", async (a) => {
    await atTime(SUN_0800, async () => {
      const { db, env, key } = await live({ rota: { status: "North cancelled" } });
      await withSeat(db, key, "S01", "South");
      await passengerPhone(db, "S01");
      await W.wakeCancelled(env);
      a.eq(db._rows("SELECT id FROM push_subs WHERE last <> ''").length, 0,
           "a South passenger was told the North cancellation");
    });
  });

  s.test("it goes once, not on every sweep that morning", async (a) => {
    await atTime(SUN_0800, async () => {
      const { db, env, key } = await live({ rota: { status: "North cancelled" } });
      await withSeat(db, key, "N01");
      await passengerPhone(db, "N01");
      const first = await W.wakeCancelled(env);
      const again = await W.wakeCancelled(env);
      a.eq(first, 1, "the first sweep told nobody");
      a.eq(again, 0, "it told them again five minutes later");
    });
  });

  /* ---- 12. THE BUS HAS SET OFF ----------------------------------------- */

  s.test("THE START TAP TELLS EVERY BOOKED STOP THE BUS IS MOVING", async (a) => {
    /* The first thing a passenger actually wants: not the timetable, which he
       has had since the morning message, but confirmation that it is real. */
    await atTime("2026-09-27T09:52:00+01:00", async () => {
      const { db, env, key } = await live();
      await withSeat(db, key, "N01");
      await withSeat(db, key, "N02");
      const ep = await passengerPhone(db, "N01");
      await passengerPhone(db, "N02");
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adebola",
        reg: "YS70 PWE", sunday: key, events: [{ event: "start", at: Date.now() }] });
      const got = db._rows("SELECT ref, last FROM push_subs WHERE last <> ''");
      a.eq(got.length, 2, "the bus set off and " + got.length + " of 2 stops heard");

      const out = await W.pushWhat(env, ep);
      a.has(out.title + " " + out.body, "left", "got: " + out.title);
    });
  });

  s.test("a stop nobody has booked is not woken by the departure", async (a) => {
    await atTime("2026-09-27T09:52:00+01:00", async () => {
      const { db, env, key } = await live();
      await passengerPhone(db, "N03");        /* a phone, but no seat */
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adebola",
        reg: "YS70 PWE", sunday: key, events: [{ event: "start", at: Date.now() }] });
      a.eq(db._rows("SELECT id FROM push_subs WHERE last <> ''").length, 0,
           "somebody with no seat was told his bus had left");
    });
  });

  /* ---- 13. IT WENT PAST WITHOUT HIM ------------------------------------ */

  s.test("A STOP THE BUS PASSED UNMARKED IS TOLD IT HAS GONE", async (a) => {
    /* The hardest message in the app to send and the one most worth sending.
       The driver taps a stop further down the line; everybody behind that
       point has been passed, and whether it was a missed kerb or an empty one,
       standing there any longer is pointless. */
    await atTime("2026-09-27T10:20:00+01:00", async () => {
      const { db, env, key } = await live();
      await withSeat(db, key, "N01");      /* passed, never tapped */
      await withSeat(db, key, "N03");      /* the one he does tap  */
      const ep = await passengerPhone(db, "N01");
      await passengerPhone(db, "N03");

      const t0 = Date.parse("2026-09-27T09:52:00+01:00");
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adebola",
        reg: "YS70 PWE", sunday: key, events: [{ event: "start", at: t0 }] });
      db.prepare("UPDATE push_subs SET last=''").run();   /* clear the departure */

      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adebola",
        reg: "YS70 PWE", sunday: key,
        events: [{ event: "picked", stopId: "N03", at: Date.now() }] });

      const skipped = db._rows("SELECT last FROM push_subs WHERE ref='dev-N01'")[0];
      a.ok(String(skipped.last || ""), "the bus went past him and his phone said nothing");
      const out = await W.pushWhat(env, ep);
      a.has(out.title, "gone past", "got: " + out.title);
    });
  });

  s.test("and the stop he actually picked up at is told he is aboard", async (a) => {
    await atTime("2026-09-27T10:20:00+01:00", async () => {
      const { db, env, key } = await live();
      await withSeat(db, key, "N03");
      const ep = await passengerPhone(db, "N03");
      const t0 = Date.parse("2026-09-27T09:52:00+01:00");
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adebola",
        reg: "YS70 PWE", sunday: key, events: [{ event: "start", at: t0 }] });
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adebola",
        reg: "YS70 PWE", sunday: key,
        events: [{ event: "picked", stopId: "N03", at: Date.now() }] });
      const out = await W.pushWhat(env, ep);
      a.has(out.title, "Picked up", "got: " + out.title);
      a.hasnt(out.title, "gone past", "the man who got on was told he had been missed");
    });
  });

  /* ---- 14. the diagnostic, for completeness ---------------------------- */

  s.test("the test email says what it is for and how much quota is left", (a) => {
    const L = sheet();
    call(L, "sendTestEmail");
    const got = toCoord(L);
    a.eq(got.length, 1, "the one email whose entire job is to arrive did not");
    a.ok(bothSay(got[0], "notifications are working"));
  });

  /* ---- THE ONE THIS SUITE WAS WORTH WRITING FOR ------------------------

     Found by writing the cancellation test above and watching it fail with
     "You are booked for Sunday". Not a fixture fault — the app's worst live
     bug, hidden because it needed two things at once: a route called off, and
     the phone looked at before bookings closed at 09:30 on the day.

     wakeCancelled runs on every five minute sync, all week, so calling a route
     off on the Friday pushed everybody there and then. The words come from the
     record when the phone asks — and tripPayload used to return "open" before
     it had looked at the Rota at all. So the cancellation arrived dressed as
     the booking message, telling a man his seat was fine on a morning that was
     not running. The tag burned on that send, so the correct message never
     came. He was reassured, once, and never corrected.

     Three checks, one per part of it. */

  const FRIDAY_BEFORE = "2026-09-25T14:00:00+01:00";

  async function cancelledSeat(db, env, key) {
    await withSeat(db, key, "N01");
    return await passengerPhone(db, "N01");
  }

  s.test("A CANCELLATION NEVER ARRIVES DRESSED AS A BOOKING CONFIRMATION", async (a) => {
    /* The bug itself, at the hour it appeared: Sunday morning, bookings still
       open, route called off. */
    await atTime(SUN_0800, async () => {
      const { db, env, key } = await live({ rota: { status: "North cancelled" } });
      const ep = await cancelledSeat(db, env, key);
      const out = await W.pushWhat(env, ep);
      a.hasnt(out.title, "booked",
              "it told him his seat was fine on a morning with no bus: " + out.title);
      a.has(out.title, "No bus", "got: " + out.title);
    });
  });

  s.test("and it is right on a weekday too, because that is when it is sent", async (a) => {
    /* Call a route off on the Friday and the next sync pushes it. Every part
       of that message has to be true on a Friday. */
    await atTime(FRIDAY_BEFORE, async () => {
      const { db, env, key } = await live({ rota: { status: "North cancelled" } });
      const ep = await cancelledSeat(db, env, key);
      a.eq(await W.wakeCancelled(env), 1, "calling it off on Friday told nobody");
      const out = await W.pushWhat(env, ep);
      a.hasnt(out.title, "booked", "got: " + out.title);
      a.has(out.title, "No bus");
      a.hasnt(out.title + " " + out.body, "today",
              "it said TODAY on a Friday about a Sunday: " + out.title);
      a.has(out.title + " " + out.body, "Sunday", "and it does not say which day");
    });
  });

  s.test("on the Sunday itself it does say today", async (a) => {
    /* The other half of the same rule. "On Sunday" read at ten past ten on
       Sunday is the app failing to notice what day it is. */
    await atTime("2026-09-27T10:10:00+01:00", async () => {
      const { db, env, key } = await live({ rota: { status: "North cancelled" } });
      const ep = await cancelledSeat(db, env, key);
      const out = await W.pushWhat(env, ep);
      a.has(out.title, "today", "got: " + out.title);
    });
  });

  s.test("and the gate still hides live tracking before bookings close", async (a) => {
    /* The gate was moved, not removed. It exists so a passenger cannot watch
       the bus before the morning is settled, and that must still hold — the
       fix was to stop it hiding the Rota, not to stop it hiding the bus.

       WHAT THE GATE PROTECTS IS TRACKING, NOT A FORM OF WORDS. The first
       version of this check asserted the title contained "booked", which was
       me pinning the sentence that happened to be there rather than the
       property that matters. It then failed, correctly, the moment the morning
       message was fixed to say something better. */
    await atTime(SUN_0800, async () => {
      const { db, env, key } = await live();          /* nothing cancelled */
      const ep = await cancelledSeat(db, env, key);
      const out = await W.pushWhat(env, ep);
      const all = out.title + " " + out.body;
      a.hasnt(out.title, "No bus", "it invented a cancellation");
      /* "min" was the first thing I checked for, and it matched "a few
         minutes early" in the perfectly correct morning message. The estimate
         has a shape of its own — "in about 16 min" — and that is what must not
         appear before the cutoff. */
      a.hasnt(all, "in about", "it gave him a live estimate before bookings closed: " + all);
      a.hasnt(all, "left church", "or told him the bus was moving");
      a.hasnt(all, "gone past");
    });
  });

  /* ---- THE MORNING MESSAGE, SAYING THE MORNING -------------------------

     Found by the same sweep that caught the cancellation: fire each alert,
     then ask the phone what it says, and see whether the two are about the
     same thing. The morning message fires 07:30–08:30 and bookings close at
     09:30, so this branch is what a passenger actually read — and it said
     "You are booked for Sunday" on a Sunday morning.

     The wording it wanted already existed forty lines lower and was simply
     unreachable before the cutoff. The only people who ever saw it were the
     ones who left the notification unopened for two hours. */

  s.test("ON THE MORNING ITSELF IT SAYS TODAY, AND TO BE THERE EARLY", async (a) => {
    await atTime(SUN_0800, async () => {
      const { db, env, key } = await live();
      await withSeat(db, key, "N02");
      const ep = await passengerPhone(db, "N02");
      await W.wakeMorning(env);
      const out = await W.pushWhat(env, ep);
      a.has(out.title, "today", "the morning message does not mention the morning: " + out.title);
      a.has(out.title, "10:15", "or when his bus comes");
      a.has(out.body, "early", "or the one thing it is sent to say: " + out.body);
    });
  });

  s.test("but midweek it still says Sunday, because Sunday is not today", async (a) => {
    await atTime("2026-09-30T18:30:00+01:00", async () => {
      const { db, env, key } = await live();
      await withSeat(db, key, "N02");
      const ep = await passengerPhone(db, "N02");
      const out = await W.pushWhat(env, ep);
      a.hasnt(out.title, "today", "it told him on Wednesday that his bus was today");
      a.has(out.title, "Sunday");
    });
  });

  s.test("A SUNDAY AFTERNOON NUDGE NOW READS LIKE A NUDGE", async (a) => {
    /* Was known-and-not-fixed for a day, with a check pinning the stale
       wording and a note telling whoever fixed it to come back here. This is
       that. At three o'clock the morning is closed off, so the record is
       history and the only thing worth saying is that next Sunday is open. */
    await atTime("2026-09-27T15:20:00+01:00", async () => {
      const { db, env, key } = await live();
      await W.cachePut(env, "booking_rules", { on: true, oncePerWeek: false,
        windows: [{ day: 0, from: 15, to: 16 }, { day: 3, from: 18, to: 19 },
                  { day: 6, from: 18, to: 19 }] }).run();
      await withSeat(db, key, "N02");
      const ep = await passengerPhone(db, "N02");
      const t0 = Date.parse("2026-09-27T09:52:00+01:00");
      await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adebola",
        reg: "YS70 PWE", sunday: key,
        events: [{ event: "start", at: t0 },
                 { event: "picked", stopId: "N02", at: t0 + 1380000 },
                 { event: "end", at: t0 + 4080000 }] });

      a.eq(await W.wakeBookingReminders(env), 1,
           "he has no seat for next Sunday and was not asked to book one");
      const out = await W.pushWhat(env, ep);
      a.hasnt(out.title, "Picked up",
              "five hours after he got off: " + out.title);
      a.has(out.title, "Book your seat", "and it should invite him back: " + out.title);
    });
  });

  /* ---- WHAT THE FIX COSTS, PINNED ---------------------------------------

     Reading the Rota before the gate means a read that was not there before,
     on the busiest path in the app: bookings still open, which is every
     passenger tap all week and every phone asking what a notification says.

     The first version of the fix read the whole of that Sunday's bookings
     there too — three extra reads, every tap, to answer a question whose
     answer is no in forty-nine weeks out of fifty. It now asks the Rota for
     one indexed row and only looks at the seats if that row says something.

       w2.12.0   2 reads   stops, settings
       first try 5 reads   stops, settings x2, rota, BOOKINGS
       w2.13.1   3 reads   stops, settings, rota

     Counted rather than reasoned about, and pinned here because the cheap
     version and the expensive version are four lines apart and behave
     identically. Nothing but a count can tell them apart. */

  async function readsFor(when, cancelled) {
    return await atTime(when, async () => {
      const { db, env, key } = await live(cancelled ? { rota: { status: "North cancelled" } } : {});
      for (let i = 0; i < 20; i++) await withSeat(db, key, "N01");
      const tally = {};
      const real = env.DB.prepare.bind(env.DB);
      env.DB.prepare = (sql) => {
        const t = /FROM\s+(\w+)/i.exec(sql);
        tally[t ? t[1] : "other"] = (tally[t ? t[1] : "other"] || 0) + 1;
        return real(sql);
      };
      await W.tripPayload(env, "dev-N01", "", "", "pid-N01");
      env.DB.prepare = real;
      return tally;
    });
  }

  s.test("THE BUSY PATH NEVER READS THE BOOKINGS TABLE", async (a) => {
    /* The whole point. An ordinary weekday tap asks the Rota one question and
       stops. If this check ever goes red, somebody has put a full bookings
       scan back onto every tap of every phone, all week. */
    const t = await readsFor(FRIDAY_BEFORE, false);
    a.eq(t.bookings || 0, 0, "the busy path is reading every booking: " + JSON.stringify(t));
    a.eq(t.rota || 0, 1, "and it should ask the Rota exactly once: " + JSON.stringify(t));
  });

  s.test("and it does read them once a route is actually off", async (a) => {
    /* The other half: cheap is no good if it is cheap by not working. */
    const t = await readsFor(FRIDAY_BEFORE, true);
    a.eq(t.bookings || 0, 1, "it decided a cancellation without looking for his seat");
  });

  return s;
}
