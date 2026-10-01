/* THE SPREADSHEET SIDE.

   Code.gs is loaded into a sandbox with the Apps Script services faked, which
   is not an approximation of how Apps Script works — it IS how it works. Every
   top level var and function in that file is a property of one global object,
   so running it in a context and reading that context is the real loading
   model, and every function comes out reachable without a line being added to
   the file that ships.

   What this is for: the tab shapes, the columns v1.71.0 adds, and the payload
   that carries them to the live server. The behaviour the Worker owns is
   tested against the Worker. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { loadCodeGs as loadBare, call } from "../lib/codegs.mjs";
import { KERBS } from "../lib/kerbs.mjs";

/* Code.gs ships STOP_PINS empty from v1.88.0. The kerb filling is tested
   against this church's kerbs, put back in after loading. */
function loadCodeGs(root, opts) {
  const L = loadBare(root, opts);
  L.ctx.STOP_PINS = JSON.parse(JSON.stringify(KERBS));
  return L;
}
import { STOPS } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";
import { loadWorker, installGlobals } from "../lib/worker.mjs";
import { TABS } from "../lib/tabs.mjs";

function tabs() {
  return {
    "Bus Stops": [
      ["Route", "Stop ID", "Time", "Stop", "Postcode", "Active", "Type", "Where", "Lat", "Lng"],
      /* A tab part way through being filled in, which is the state this
         actually meets: one row pinned by hand, one blank, a church at each
         end with nothing on it, and a stop nobody has coordinates for. */
      /* NAMES AND POSTCODES AS THE TAB REALLY CARRIES THEM. They used to be
         the short ones — "Grace Rd", "Sedley St" — which is where fillStopPins
         got its idea of what a stop is called, and why it filled nothing at
         all on the real thing. A fixture written to match the code agrees
         with it about everything, including being wrong. */
      ["North", "N00", "09:52", "Church, Chester Road", "L6 4DY", "YES", "Depart", "", "", ""],
      ["North", "N01", "10:00", "Scarisbrick Drive by Ardville Road", "L11 7DD", "YES", "Pickup", "1 Vale Rd", 53.111111, -2.222222],
      ["North", "N02", "10:06", "Grace Road bus stop, Walton Vale", "L9 2BU", "YES", "Pickup", "", "", ""],
      ["North", "N99", "10:40", "Church, Chester Road", "L6 4DY", "YES", "Arrival", "", "", ""],
      ["South", "S03", "10:08", "Sedley Street (St Andrew Road) bus stop, Breck Road", "L4 2RB", "YES", "Pickup", "", "", ""],
      ["South", "SXX", "10:12", "Somewhere new", "", "YES", "Pickup", "", "", ""],
      ["South", "S07", "10:03", "Halsbury Road by Molyneux Road", "L6 6AW", "NO", "Pickup", "", "", ""]
    ],
    "Drivers": [TABS["Drivers"],
                ["Pst Kenneth", "Minister in Charge", "YES", 1, "1111", "", "North", ""],
                ["Bro Arthur", "Coordinator", "YES", 2, "1234", "a@b.c", "North", ""],
                ["Bro Adrian", "Driver", "YES", 3, "4321", "", "North", ""],
                ["Bro Retired", "Coordinator", "NO", 9, "9999", "old@b.c", "North", ""]],
    "Buses": [TABS["Buses"],
              ["YS70 PWE", 16, "YES", ""], ["NH56 FWP", 14, "YES", ""]],
    "Rota": [["Date"]],
    "Checks": [["When"]],
    "Defects": [["When"]],
    "Bus Bookings": [["Received"]],
    "Trip Events": [["Logged"]],
    "Rota Requests": [["When"]]
  };
}

export default function (root) {
  const s = new Suite("the spreadsheet side");
  const L = loadCodeGs(root, { tabs: tabs(), props: { COORDINATOR_EMAIL: "a@b.c", PIN_SALT: "salt", WORKER_URL: "https://example.invalid" } });
  const ctx = L.ctx;

  /* ---- the tab shape ---------------------------------------------------- */

  s.test("the Bus Stops tab carries Lat and Lng", (a) => {
    a.has(JSON.stringify(ctx.STOPS_HEADERS), "Lat");
    a.has(JSON.stringify(ctx.STOPS_HEADERS), "Lng");
  });

  s.test("the new columns are at the END of the tab", (a) => {
    const h = ctx.STOPS_HEADERS;
    a.eq(h[h.length - 2], "Lat");
    a.eq(h[h.length - 1], "Lng");
    a.eq(h[0], "Route", "nothing that was already there may move: a sorted, "
       + "filtered or coloured tab has to survive the upgrade");
    a.eq(h[7], "Where");
  });

  s.test("Trip Events carries Ended by", (a) => {
    a.has(JSON.stringify(ctx.TRIP_HEADERS), "Ended by");
  });

  s.test("Ended by is before Live ID, which stays last", (a) => {
    const h = ctx.TRIP_HEADERS;
    a.eq(h[h.length - 1], "Live ID");
    a.eq(h[h.length - 2], "Ended by");
  });

  s.test("every header a field map names is really on its tab", (a) => {
    const pairs = [
      [ctx.STOPS_SHEET, ctx.STOPS_HEADERS],
      [ctx.TRIP_SHEET, ctx.TRIP_HEADERS]
    ];
    for (const [tab, headers] of pairs) {
      const map = ctx.FIELDS[tab] || {};
      for (const key of Object.keys(map)) {
        a.ok(headers.indexOf(map[key]) !== -1,
             "FIELDS[" + tab + "]." + key + ' points at "' + map[key] + '", which is not a column on that tab');
      }
    }
  });

  /* ---- reading a pin off the tab ---------------------------------------- */

  s.test("a stop with coordinates comes back with them as numbers", (a) => {
    const stops = call(L, "readBusStopsAll", ctx.SpreadsheetApp.getActiveSpreadsheet());
    const n01 = stops.find((x) => x.id === "N01");
    a.eq(typeof n01.lat, "number");
    a.near(n01.lat, 53.111111, 0.0001);
    a.near(n01.lng, -2.222222, 0.0001);
  });

  s.test("a stop with empty coordinate cells comes back blank, never zero", (a) => {
    const stops = call(L, "readBusStopsAll", ctx.SpreadsheetApp.getActiveSpreadsheet());
    const n02 = stops.find((x) => x.id === "N02");
    a.eq(n02.lat, "", "zero is a real coordinate in the Gulf of Guinea and it is not Rice Lane");
    a.eq(n02.lng, "");
  });

  s.test("a coordinate somebody has typed words into is blank, not NaN", (a) => {
    a.eq(call(L, "numOrBlank", "about here"), "");
    a.eq(call(L, "numOrBlank", ""), "");
    a.eq(call(L, "numOrBlank", null), "");
    a.eq(call(L, "numOrBlank", "53.4"), 53.4);
    a.eq(call(L, "numOrBlank", 0), 0, "a typed zero is a decision and is kept");
  });

  s.test("an inactive stop is still not read", (a) => {
    const stops = call(L, "readBusStopsAll", ctx.SpreadsheetApp.getActiveSpreadsheet());
    a.not(stops.some((x) => x.id === "S07"), "Active NO means not on the timetable");
  });

  /* ---- filling the kerbs in ---------------------------------------------

     Typing fifteen pairs of six-decimal numbers into a spreadsheet by hand is
     how a digit gets transposed, and a transposed digit in a coordinate does
     not look wrong — the stop quietly moves half a mile and the estimate is
     confidently incorrect about it. So the script writes them, and these are
     the checks that it writes only what it should. */

  function pinned() {
    const L2 = loadCodeGs(root, { tabs: tabs(), props: { COORDINATOR_EMAIL: "a@b.c" } });
    const ss = L2.ctx.SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(L2.ctx.STOPS_SHEET);
    const sc = call(L2, "colsHard", sh, L2.ctx.STOPS_SHEET);
    const wrote = call(L2, "fillStopPins", sh, sc);
    const rows = sh.getDataRange().getValues();
    const head = rows[0];
    const byId = {};
    for (const r of rows.slice(1)) {
      byId[String(r[head.indexOf("Stop ID")]).trim()] =
        { lat: r[head.indexOf("Lat")], lng: r[head.indexOf("Lng")],
          stop: r[head.indexOf("Stop")], type: r[head.indexOf("Type")] };
    }
    return { L2, sh, sc, wrote, byId };
  }

  s.test("a blank coordinate is filled from the supplied list", (a) => {
    const { byId } = pinned();
    a.near(byId.N02.lat, 53.463563, 0.000001, "Grace Rd");
    a.near(byId.N02.lng, -2.959062, 0.000001);
    a.near(byId.S03.lat, 53.425937, 0.000001, "Sedley St");
  });

  s.test("a coordinate somebody typed by hand is never overwritten", (a) => {
    const { byId } = pinned();
    a.near(byId.N01.lat, 53.111111, 0.000001,
           "a coordinate corrected by hand is a decision; this is an observation");
    a.near(byId.N01.lng, -2.222222, 0.000001);
  });

  s.test("the church rows are filled, at both ends of the route", (a) => {
    const { byId } = pinned();
    a.near(byId.N00.lat, 53.424169, 0.000001, "the departure row");
    a.near(byId.N99.lat, 53.424169, 0.000001, "the arrival row");
    a.near(byId.N99.lng, -2.936799, 0.000001);
  });

  s.test("a stop nobody has a coordinate for stays blank", (a) => {
    const { byId } = pinned();
    a.eq(byId.SXX.lat, "", "blank is a state everything downstream already handles");
    a.eq(byId.SXX.lng, "");
  });

  s.test("an inactive stop is still given its kerb", (a) => {
    /* Active NO takes a stop out of the app without deleting it, and it may
       come back. Leaving its coordinate blank would mean the estimate is
       wrong for one Sunday after somebody switches it on again. */
    const { byId } = pinned();
    a.near(byId.S07.lat, 53.414732, 0.000001);
  });

  s.test("running it a second time writes nothing at all", (a) => {
    const { L2, sh, sc, wrote } = pinned();
    a.ok(wrote > 0, "the first run should have written something");
    a.eq(call(L2, "fillStopPins", sh, sc), 0,
         "running the setup twice has to change nothing the second time, or the "
       + "revision history stops being useful for finding the edit that mattered");
  });

  s.test("every supplied kerb is a real pair of numbers in Liverpool", (a) => {
    const pins = ctx.STOP_PINS;
    a.eq(Object.keys(pins).length, 12,
         "three are withheld on purpose: N04, S02 and S05");
    for (const id of Object.keys(pins)) {
      const [lat, lng] = pins[id].at;
      a.eq(typeof lat, "number", id);
      a.eq(typeof lng, "number", id);
      a.ok(lat > 53.3 && lat < 53.5, id + " is not in Liverpool: " + lat);
      a.ok(lng > -3.1 && lng < -2.8, id + " is not in Liverpool: " + lng);
    }
    a.near(ctx.CHURCH_PIN.at[0], 53.424169, 0.000001);
    a.near(ctx.CHURCH_PIN.at[1], -2.936799, 0.000001);
  });

  s.test("the kerbs fixture and the stops the suites test against are the same kerbs", (a) => {
    /* Two copies of fifteen coordinates is two things to keep in step, and
       the failure if they drift is the nastiest kind: every test goes on
       passing, against a set of coordinates that is no longer what the
       spreadsheet will be given. So they are compared rather than trusted.

       If a corrected coordinate arrives, both have to move, and this is what
       says so. */
    const pins = ctx.STOP_PINS;
    for (const id of Object.keys(pins)) {
      const fixture = STOPS.find((x) => x.id === id);
      a.ok(fixture, "kerbs.mjs has a kerb for " + id + " and the stops fixture has no such stop");
      a.near(fixture.lat, pins[id].at[0], 0.0000001, id + " latitude");
      a.near(fixture.lng, pins[id].at[1], 0.0000001, id + " longitude");
      /* Compared by ROAD, not by string. The fixtures say "Scarisbrick Dr"
         and the table says "Scarisbrick Drive", and the whole reason
         fillStopPins filled nothing was somebody deciding those were
         different places. They are the same road, and the function the
         spreadsheet uses to say so is the one asked here. */
      a.eq(call(L, "roadKey", fixture.stop), call(L, "roadKey", pins[id].stop),
           id + ": the name the kerb was supplied against");
    }
    /* A KERB CAN BE WITHHELD, and exactly one is: see the note on Fountains
       Road in Code.gs. Listed here rather than skipped quietly, so that a pin
       going missing by accident still fails and this one has to be argued for
       in writing. */
    const WITHHELD = ["N04", "S02", "S05"];
    const missing = STOPS.filter((x) => x.kind === "pickup" && !pins[x.id]).map((x) => x.id);
    a.eq(missing.sort().join(","), WITHHELD.sort().join(","),
         "kerbs.mjs has no kerb for: " + (missing.join(", ") || "none"));
  });

  /* ---- whose PIN an email link will ask for ------------------------------

     Not a new setting, deliberately. The Drivers tab already has an Email
     column and COORDINATOR_EMAIL is already where these messages go, so the
     name is the one the two agree on — and changing who gets the emails
     changes whose PIN the link wants, with nothing to keep in step by hand. */

  s.test("the link asks for the PIN of whoever the emails go to", (a) => {
    a.eq(call(L, "coordinatorName"), "Bro Arthur",
         "matched on the Email column against COORDINATOR_EMAIL");
  });

  s.test("with no Email filled in, it falls back to the first active coordinator", (a) => {
    const L2 = loadCodeGs(root, { tabs: tabs(), props: { COORDINATOR_EMAIL: "nobody@nowhere" } });
    a.eq(call(L2, "coordinatorName"), "Pst Kenneth",
         "a tab nobody has filled in should still produce a working link");
  });

  s.test("a retired coordinator is never the one asked", (a) => {
    const L2 = loadCodeGs(root, { tabs: tabs(), props: { COORDINATOR_EMAIL: "old@b.c" } });
    a.ne(call(L2, "coordinatorName"), "Bro Retired",
         "Active NO means he is on the tab for his history and nothing else");
  });

  s.test("an ordinary driver is never the one asked", (a) => {
    const t = tabs();
    t.Drivers = [t.Drivers[0], ["Bro Adrian", "Driver", "YES", 1, "4321", "a@b.c", "North", ""]];
    const L2 = loadCodeGs(root, { tabs: t, props: { COORDINATOR_EMAIL: "a@b.c" } });
    a.eq(call(L2, "coordinatorName"), "",
         "and an empty name makes actionLink hand back no link, which puts the "
       + "email back to \"open the spreadsheet\"");
  });

  s.test("an email without a link says what to do instead", (a) => {
    a.has(call(L, "decideHtml", "", "Authorise", 60), "Open the spreadsheet",
          "a live server that is down must not cost anybody the message");
    a.eq(call(L, "decidePlain", "", 60), "");
  });

  s.test("an email's button is a button and says nothing else", (a) => {
    /* It used to carry a line under it explaining that it would ask for a
       PIN and last about an hour. Both are true and neither is news: the
       page asks for the PIN when he gets there, and an expired link says so
       itself. The two running apps never explain themselves this way, and
       this is the one message that was doing it in a coordinator's inbox. */
    const html = call(L, "decideHtml", "https://example.invalid/do/?t=" + "a".repeat(32),
                      "Authorise this bus to run", 60);
    a.has(html, "Authorise this bus to run", "the button lost its words");
    a.has(html, "do/?t=", "and its link");
    a.hasnt(html, "asks for your PIN");
    a.hasnt(html, "Good once");
    a.hasnt(html, "60 minutes");
  });

  s.test("the link is built from the published address plus do/", (a) => {
    a.has(ctx.LINK_RULES.pagesUrl, "http");
    a.ok(ctx.LINK_RULES.ttlMinutes > 0);
    a.eq(typeof ctx.LINK_RULES.on, "boolean");
  });

  /* ---- the two questions: by name, and never altered ------------------- */

  s.test("the columns are found BY NAME, whatever order they are in", (a) => {
    /* Every column on every tab in this spreadsheet is resolved through the
       header row, and these two are no different. Proved by shuffling the tab
       into an order nothing in the code has ever seen. */
    const t = tabs();
    const rows = t["Bus Stops"];
    const order = [9, 3, 1, 8, 0, 5, 2, 6, 4, 7];      /* Lng, Stop, Stop ID, Lat, Route, ... */
    t["Bus Stops"] = rows.map((r) => order.map((i) => r[i]));

    const L2 = loadCodeGs(root, { tabs: t, props: { COORDINATOR_EMAIL: "a@b.c" } });
    const ss = L2.ctx.SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(L2.ctx.STOPS_SHEET);
    const sc = call(L2, "colsHard", sh, L2.ctx.STOPS_SHEET);

    a.eq(sc.lng, 1, "Lng is the first column on this shuffled tab");
    a.eq(sc.lat, 4, "Lat is the fourth");
    a.ne(sc.lat, 9, "if this is 9 the code is counting positions, not reading headings");

    call(L2, "fillStopPins", sh, sc);
    const stops = call(L2, "readBusStopsAll", ss);
    const n02 = stops.find((x) => x.id === "N02");
    a.near(n02.lat, 53.463563, 0.000001, "and the right value still lands in the right column");
    a.near(n02.lng, -2.959062, 0.000001);
  });

  s.test("a column heading with stray spacing still matches", (a) => {
    const t = tabs();
    t["Bus Stops"][0] = t["Bus Stops"][0].map((h) => (h === "Lat" ? " Lat " : h));
    const L2 = loadCodeGs(root, { tabs: t, props: { COORDINATOR_EMAIL: "a@b.c" } });
    const sh = L2.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName(L2.ctx.STOPS_SHEET);
    a.ok(call(L2, "colsHard", sh, L2.ctx.STOPS_SHEET).lat > 0,
         "headings are trimmed before they are matched");
  });

  s.test("a pickup point that has MOVED is left alone, not helpfully refilled", (a) => {
    /* The case that will actually happen: a stop moves, the row is reused for
       the new place, and the coordinates are left blank to be filled in later.
       Matching on the id alone would fill them with the OLD kerb — half a mile
       away, entirely plausible, and wrong in a way nothing on the tab shows.

       MOVED MEANS A NEW POSTCODE, which is the change this now watches for.
       It used to watch the NAME, and that rule was both too strict and
       useless: too strict because a cafe closing renamed a kerb that had not
       budged, and useless because it never matched a real tab at all. A stop
       that moves far enough to matter takes a new postcode with it; one that
       moves within its own postcode has gone a few doors down, and a pin a
       few doors down is still the right street. */
    const t = tabs();
    const head = t["Bus Stops"][0];
    const idC = head.indexOf("Stop ID"), stopC = head.indexOf("Stop");
    const postC = head.indexOf("Postcode");
    for (const r of t["Bus Stops"].slice(1)) {
      if (String(r[idC]).trim() === "S03") {
        r[stopC] = "Fernhill Road by Cedar Grove";
        r[postC] = "L20 9AB";
      }
    }
    const L2 = loadCodeGs(root, { tabs: t, props: { COORDINATOR_EMAIL: "a@b.c" } });
    const sh = L2.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName(L2.ctx.STOPS_SHEET);
    const sc = call(L2, "colsHard", sh, L2.ctx.STOPS_SHEET);
    call(L2, "fillStopPins", sh, sc);
    const s03 = call(L2, "readBusStopsAll", L2.ctx.SpreadsheetApp.getActiveSpreadsheet())
                  .find((x) => x.id === "S03");
    a.eq(s03.lat, "", "a renamed stop stays blank, and blank is safe");
  });

  s.test("a stop added by hand is never complained about", (a) => {
    const t = tabs();
    t["Bus Stops"].push(["North", "N20", "10:37", "A new corner", "L5 1AA", "YES", "Pickup", "", "", ""]);
    const L2 = loadCodeGs(root, { tabs: t, props: { COORDINATOR_EMAIL: "a@b.c" } });
    const ss = L2.ctx.SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(L2.ctx.STOPS_SHEET);
    const sc = call(L2, "colsHard", sh, L2.ctx.STOPS_SHEET);
    call(L2, "fillStopPins", sh, sc);
    const stops = call(L2, "readBusStopsAll", ss);
    const added = stops.find((x) => x.id === "N20");
    a.ok(added, "it should simply be on the timetable");
    a.eq(added.lat, "", "with no kerb, which is a state everything already handles");
  });

  s.test("a stop taken off the tab is not missed", (a) => {
    const t = tabs();
    t["Bus Stops"] = t["Bus Stops"].filter((r) => String(r[1]).trim() !== "S03");
    const L2 = loadCodeGs(root, { tabs: t, props: { COORDINATOR_EMAIL: "a@b.c" } });
    const ss = L2.ctx.SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(L2.ctx.STOPS_SHEET);
    call(L2, "fillStopPins", sh, call(L2, "colsHard", sh, L2.ctx.STOPS_SHEET));
    a.not(call(L2, "readBusStopsAll", ss).some((x) => x.id === "S03"),
          "a deleted stop is deleted; nothing puts it back and nothing complains");
  });

  s.test("a name off the list is warned about, never refused", (a) => {
    /* setAllowInvalid(true) for names and buses, where a value off the list
       can be right. A fixed word (Type, Status, YES) takes pickRule from
       v1.94.0, which refuses anything else: see 39-dropdowns.mjs. */
    const rule = call(L, "listRule", ["Bro Trevor", "Sis Ama"]);
    a.eq(rule._allowInvalid, true);
    a.eq(call(L, "pickRule", ["Pickup", "Arrival", "Depart"])._allowInvalid, false);
  });

  /* ---- the duty calendar entry -------------------------------------------

     It was an all-day event, and that is where the twelve hour alarm went
     wrong: a client fires that from the start of the day, so the reminder
     landed around midday on SATURDAY — a full day early, when there is
     nothing to do about it. Timed at the real departure the same alarm lands
     at about ten on Saturday night, which is the last hour he can ring
     somebody if he cannot make it. */

  function ics(tabsOver, sunday) {
    const L2 = loadCodeGs(root, { tabs: tabsOver || tabs(),
                                  props: { COORDINATOR_EMAIL: "a@b.c" } });
    return call(L2, "dutyIcs", sunday || new Date(2026, 8, 27), "Bro Adrian", "", "North", "YS70 PWE");
  }

  s.test("the duty entry is timed to the real departure", (a) => {
    const out = ics();
    a.has(out, "DTSTART:2026", "it should carry a time, not a bare date: " +
          (/DTSTART[^\r\n]*/.exec(out) || [""])[0]);
    a.hasnt(out, "DTSTART;VALUE=DATE");
  });

  s.test("the reminder is a day before he leaves, in the morning", (a) => {
    /* Twelve hours was tried and was wrong: twelve hours before 09:52 is ten
       o'clock on Saturday NIGHT, which is when he is least able to act on it
       and most likely to silence it. Twenty-four lands on Saturday morning at
       the hour he would be leaving, and Sunday itself is already covered by
       the "You are driving today" push. */
    const out = ics();
    a.has(out, "TRIGGER:-PT24H");
    a.hasnt(out, "TRIGGER:-PT12H");
    a.has(out, "Minibus duty tomorrow morning");
  });

  s.test("the email says the same thing the alarm does", (a) => {
    /* An email promising a reminder "the evening before" beside a file that
       fires in the morning is the documentation lying about the code, in the
       one place the driver can check it. */
    const L2 = loadCodeGs(root, { tabs: tabs(), props: { COORDINATOR_EMAIL: "a@b.c" } });
    a.eq(L2.ctx.DUTY_ALARM_HOURS, 24);
    const src = readFileSync(join(root, "Code.gs"), "utf8");
    a.hasnt(src, "remind you the evening", "the wording still promises an evening alarm");
  });

  s.test("the emails are a week out and two days out, not the day before", (a) => {
    /* The day before stopped making sense the moment the alarm became
       twenty-four hours: the alarm now fires Saturday morning and a Saturday
       email would land about two hours before it. Two notices about one duty
       inside two hours is one of them being ignored.

       Friday is also a working day with the whole weekend still in front of
       him, which is when finding cover is easiest. */
    const L2 = loadCodeGs(root, { tabs: tabs(), props: { COORDINATOR_EMAIL: "a@b.c" } });
    a.eq(L2.ctx.REMIND_DAYS.join(","), "7,2");
  });

  s.test("the report's cadence sentence is built from REMIND_DAYS, not typed beside it", (a) => {
    /* This has already happened once. REMIND_DAYS moved from [7, 1] to
       [7, 2] and the "Is everything working?" report went on saying "a week
       before a Sunday and again the day before" — a confident sentence, in
       the one place the coordinator would ever think to check, describing a
       schedule the code had stopped keeping.

       So the sentence is generated, and this is the test that it still is:
       move the array underneath it and the words have to move too. */
    const L2 = loadCodeGs(root, { tabs: tabs(), props: { COORDINATOR_EMAIL: "a@b.c" } });

    a.eq(call(L2, "remindDaysPhrase"), "a week before and again two days before");

    L2.ctx.REMIND_DAYS = [7, 1];
    a.eq(call(L2, "remindDaysPhrase"), "a week before and again the day before");

    L2.ctx.REMIND_DAYS = [3];
    a.eq(call(L2, "remindDaysPhrase"), "three days before");

    L2.ctx.REMIND_DAYS = [14, 7, 2];
    a.eq(call(L2, "remindDaysPhrase"),
         "14 days before, a week before and again two days before");

    const src = readFileSync(join(root, "Code.gs"), "utf8");
    a.hasnt(src, "Sunday and again the day before",
            "a cadence has been typed into the report again");
  });

  s.test("the time in the file is UTC, and British Summer Time is taken off", (a) => {
    /* 27 September is BST, so a 09:52 departure is 08:52 Zulu. An hour out
       here is an hour out on a driver's lock screen, in a file whose entire
       job is to say when to turn up — and it would look perfectly well
       formed. */
    const line = (/DTSTART:[^\r\n]*/.exec(ics()) || [""])[0];
    a.has(line, "Z", "a Z on the end means no client has to guess the zone: " + line);
    a.has(line, "20260927T0852", "09:52 British Summer Time is 08:52 UTC, got " + line);
  });

  s.test("after the clocks go back, 09:52 is 09:52 UTC", (a) => {
    const line = (/DTSTART:[^\r\n]*/.exec(ics(null, new Date(2026, 10, 1))) || [""])[0];
    a.has(line, "20261101T0952", "09:52 on 1 November is 09:52 UTC, got " + line);
  });

  s.test("a timed duty is time he is not free", (a) => {
    a.has(ics(), "TRANSP:OPAQUE");
  });

  s.test("with no Depart row it stays an all-day entry, exactly as before", (a) => {
    const t = tabs();
    t["Bus Stops"] = t["Bus Stops"].filter((r) => String(r[6]).toLowerCase().indexOf("depart") !== 0);
    const out = ics(t);
    a.has(out, "DTSTART;VALUE=DATE:",
          "a route whose departure nobody has written down has no time to put in a calendar");
    a.has(out, "TRANSP:TRANSPARENT");
    a.has(out, "Minibus duty tomorrow");
  });

  s.test("the entry still says which bus, and still updates when one changes", (a) => {
    const out = ics();
    a.has(out, "YS70 PWE");
    a.has(out, "SEQUENCE:", "a stable UID with no sequence keeps the old bus on his lock screen");
  });


  /* ---- telling the drivers what was decided ------------------------------

     A request is a question a driver asked. Every other message in Code.gs
     exists so that nobody has to remember to pass something on; these are the
     answers, and two of the three shapes of answer used to reach nobody. */

  /* Off the real tab — see tests/lib/tabs.mjs. These two were right; the Bus
     Bookings one below them was right too, and then got typed out again, wrong,
     in another suite. That is the whole argument for one copy. */
  const REQ_H = TABS["Rota Requests"];
  const ROTA_H = TABS["Rota"];

  const SUN = new Date(2026, 9, 4);        /* Sunday 4 October, still ahead   */
  const FAR = new Date(2026, 11, 6);       /* Sunday 6 December, ten weeks on */
  const GONE = new Date(2026, 8, 13);      /* Sunday 13 September, been and gone */

  /* The next Sunday from whenever this is actually run, so the tests about
     the seven day horizon keep testing the horizon rather than slowly
     drifting outside it and passing for the wrong reason. */
  const SOON = (() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
    return d;
  })();

  /* o.on is who the rota has against North that morning; o.type and o.status
     are the request itself. */
  function deciding(o) {
    const c = o || {};
    const day = c.sunday || SUN;
    const t = tabs();
    t["Drivers"] = [TABS["Drivers"],
                    ["Bro Arthur", "Coordinator", "YES", 1, "1234", "arthur@b.c", "North", ""],
                    ["Bro Adrian", "Driver", "YES", 2, "4321", "ade@b.c", "North", ""],
                    ["Bro Trevor", "Driver", "YES", 3, "5678", "trevor@b.c", "North", ""],
                    ["Bro Keith", "Driver", "YES", 4, "8765", "keith@b.c", "South", ""]];
    t["Rota"] = [ROTA_H,
                 [day, "on" in c ? c.on : "Bro Adrian", "", "YS70 PWE", "Confirmed",
                  "Bro Keith", "", "NH56 FWP", "", "", ""]];
    t["Rota Requests"] = [REQ_H,
                          [new Date(), "REQ-1", day, "Bro Adrian",
                           c.type || "Request cover", "away that weekend", c.swapWith || "",
                           c.status || "Pending", "", c.replacement || "",
                           c.theirSunday || "", ""]];
    return loadCodeGs(root, { tabs: t, props: {
      COORDINATOR_EMAIL: "a@b.c", PIN_SALT: "salt", WORKER_URL: "https://example.invalid" } });
  }

  /* Decide it the way a person at the spreadsheet does: write the cell, then
     let the two installed triggers run, which is what Apps Script does. */
  function byHand(L2, choice, replacement) {
    const sh = L2.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Rota Requests");
    const qc = call(L2, "requestCols", sh);
    if (replacement) sh.getRange(2, qc.replacement).setValue(replacement);
    sh.getRange(2, qc.status).setValue(choice);
    call(L2, "onEditRequests", { range: sh.getRange(2, qc.status) }, sh);
    call(L2, "onRotaEditNotify", { range: sh.getRange(2, qc.status) });
    return L2.gas.mail;
  }

  /* Decide it the way the coordinator on his phone does: the answer comes
     back down the drain from the live server. */
  function byLink(L2, choice, cover) {
    L2.gas.setFetchReply({ code: 200, body: JSON.stringify({
      ok: true, bookings: [], trips: [], checks: [], auths: [],
      decisions: [{ token: "t".repeat(32), id: "REQ-1", choice: choice,
                    cover: cover || "", by: "Bro Arthur", at: Date.now() }] }) });
    call(L2, "drainFromWorker");
    return L2.gas.mail;
  }

  /* Decide it the third way: the live server knocking on the door the moment
     a PIN is keyed, rather than waiting to be asked on the next tick. Same
     decision, same shape, arriving five minutes earlier. */
  function byPush(L2, choice, cover, over) {
    const out = JSON.parse(call(L2, "doPost", { postData: { contents: JSON.stringify(
      Object.assign({ token: "minibusapp", action: "decision", decision: {
        id: "REQ-1", choice: choice, cover: cover || "",
        by: "Bro Arthur", at: Date.now() } }, over || {})) } }).getContent());
    return { out: out, mail: L2.gas.mail };
  }

  const cellOf = (L2, tab, row, col) =>
    L2.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab)
      .getRange(row, col).getValue();

  const to = (mail, who) => mail.filter((m) => String(m.to || "").indexOf(who) === 0);

  s.test("turning a request down tells the man who asked", (a) => {
    const mail = byHand(deciding(), "Rejected");
    const his = to(mail, "ade@b.c");
    a.eq(his.length, 1, "got " + mail.length + " emails, " + his.length + " to him");
    a.has(his[0].subject, "not approved");
    a.has(his[0].body, "still down to drive",
          "the sentence he actually wants: " + his[0].body);
  });

  s.test("and the same decision from the email link tells him too", (a) => {
    /* THE WHOLE POINT OF THE FIX. An Apps Script write fires no installed
       trigger, so the drain has to call both by name. It called one. */
    const his = to(byLink(deciding(), "Rejected"), "ade@b.c");
    a.eq(his.length, 1, "a decision made on a phone has to reach him too");
    a.has(his[0].subject, "not approved");
  });

  s.test("approving with nobody assigned yet still answers him", (a) => {
    /* No longer every approval from the link — the page can name a cover
       now — but still the one that has to be said out loud, because
       "approved" on its own reads as "sorted". */
    const his = to(byLink(deciding(), "Approved"), "ade@b.c");
    a.eq(his.length, 1, "approved and told nobody is the same silence");
    a.has(his[0].subject, "has been approved");
    a.has(his[0].body, "Nobody is covering it yet", "got: " + his[0].body);
    a.hasnt(his[0].body, "You will get an email",
            "a promise about our own plumbing, in a message to a driver");
  });

  s.test("an approval that names a cover emails both men, by either route", (a) => {
    /* Inside the seven day horizon, which is where a duty change email is
       sent at all — see the test below for why, and note that it is computed
       from the real today so this cannot rot into passing for the wrong
       reason next month. */
    for (const how of ["the sheet", "the link"]) {
      const L2 = deciding({ sunday: SOON, replacement: "Bro Trevor" });
      const mail = how === "the sheet"
        ? byHand(L2, "Approved", "Bro Trevor")
        : byLink(L2, "Approved");
      a.eq(to(mail, "ade@b.c").length, 1, how + ": the man coming off");
      a.eq(to(mail, "trevor@b.c").length, 1, how + ": the man coming on");
    }
  });

  s.test("a cover assigned more than a week out is not emailed, and that is the rule", (a) => {
    /* NOT A BUG, and worth a test so it stops looking like one. Duty
       reminders start seven days before a Sunday, so past that nobody has
       been told who is driving and there is nothing to correct — the ordinary
       reminder will carry the right name when it goes.

       The answer to the REQUEST is a different thing and has no horizon: the
       driver who asked is waiting for it however far off the Sunday is. This
       pair of tests is the line between the two. */
    const L2 = deciding({ sunday: FAR, replacement: "Bro Trevor" });
    const mail = byHand(L2, "Approved", "Bro Trevor");
    a.eq(to(mail, "trevor@b.c").length, 0, "ten weeks out, nobody has been told anything yet");
  });

  s.test("a rejection does not tell the other driver in a swap", (a) => {
    /* He was never told it had been proposed, so a note saying it had been
       refused would be the first he heard of the whole thing. */
    const mail = byHand(deciding({ type: "Request a swap", swapWith: "Bro Trevor",
                                   theirSunday: new Date(2026, 9, 18) }), "Rejected");
    a.eq(to(mail, "trevor@b.c").length, 0, "got " + JSON.stringify(mail.map((m) => m.to)));
    a.eq(to(mail, "ade@b.c").length, 1);
  });

  s.test("an approved swap is not also told cover is being arranged", (a) => {
    /* A swap has no replacement either, and applySwap has already emailed
       both men. A second note would contradict the first. */
    const mail = byHand(deciding({ type: "Request a swap", swapWith: "Bro Trevor",
                                   theirSunday: new Date(2026, 9, 18) }), "Approved");
    a.not(mail.some((m) => String(m.subject || "").indexOf("has been approved") !== -1),
          "got " + JSON.stringify(mail.map((m) => m.subject)));
  });

  s.test("it does not say he is still driving when the rota says otherwise", (a) => {
    /* Refused on a Sunday somebody else has since picked up. Telling him to
       turn up to a morning he is not on is worse than sending nothing. */
    const his = to(byHand(deciding({ on: "Bro Trevor" }), "Rejected"), "ade@b.c");
    a.eq(his.length, 1);
    a.hasnt(his[0].body, "still down to drive", "got: " + his[0].body);
    a.has(his[0].body, "Open the app");
  });

  s.test("an answer is sent however far away the Sunday is", (a) => {
    /* notifyDutyChange stays quiet past seven days because nobody has been
       told who is driving yet, so there is nothing to correct. This is the
       answer to a question he asked, and he is waiting for it whether the
       Sunday is next week or in ten. */
    const his = to(byHand(deciding({ sunday: FAR }), "Rejected"), "ade@b.c");
    a.eq(his.length, 1, "ten weeks out is still an answer he is owed");
  });

  s.test("nothing is sent about a Sunday that has been and gone", (a) => {
    const his = to(byHand(deciding({ sunday: GONE }), "Rejected"), "ade@b.c");
    a.eq(his.length, 0);
  });

  s.test("filling in a cover later does not answer the same request twice", (a) => {
    const L2 = deciding();
    byHand(L2, "Rejected");
    const before = to(L2.gas.mail, "ade@b.c").length;

    const sh = L2.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Rota Requests");
    const qc = call(L2, "requestCols", sh);
    sh.getRange(2, qc.replacement).setValue("Bro Trevor");
    call(L2, "onRotaEditNotify", { range: sh.getRange(2, qc.replacement) });

    a.eq(to(L2.gas.mail, "ade@b.c").length, before,
         "an edit to the cover column is not the decision being made again");
  });

  s.test("swapping a name on the Rota itself still tells both men", (a) => {
    /* The other half of onRotaEditNotify, and until the fake learned to say
       which sheet a range is on, no test in this project could reach either
       half. This is the commonest edit there is: a coordinator typing a
       different name into a Sunday.

       South is the one worth asserting. It used to be left out entirely, so a
       South driver could be taken off a morning and never told. */
    for (const side of ["North", "South"]) {
      const L2 = deciding({ sunday: SOON });
      const ss = L2.ctx.SpreadsheetApp.getActiveSpreadsheet();
      const rota = ss.getSheetByName("Rota");
      const rc = call(L2, "rotaCols", rota);
      const col = side === "North" ? rc.north : rc.south;
      const was = side === "North" ? "Bro Adrian" : "Bro Keith";

      rota.getRange(2, col).setValue("Bro Trevor");
      call(L2, "onRotaEditNotify",
           { range: rota.getRange(2, col), oldValue: was, value: "Bro Trevor" });

      const subs = L2.gas.mail.map((m) => String(m.to));
      a.ok(subs.indexOf("trevor@b.c") !== -1, side + ": the man coming on, got " + subs.join());
      if (side === "North") {
        a.ok(subs.indexOf("ade@b.c") !== -1, side + ": the man coming off, got " + subs.join());
      }
      const off = L2.gas.mail.filter((m) => String(m.subject || "").indexOf("no longer") !== -1);
      a.eq(off.length, 1, side + ": exactly one 'you are no longer driving'");
      a.has(off[0].body, side + " Liverpool",
            side + ": every one of these used to say North whatever the route");
    }
  });

  s.test("a driver with no email address costs nobody an error", (a) => {
    const t = tabs();
    t["Drivers"] = [TABS["Drivers"],
                    ["Bro Adrian", "Driver", "YES", 2, "4321", "", "North", ""]];
    t["Rota"] = [ROTA_H, [SUN, "Bro Adrian", "", "YS70 PWE", "Confirmed",
                          "Bro Keith", "", "NH56 FWP", "", "", ""]];
    t["Rota Requests"] = [REQ_H, [new Date(), "REQ-1", SUN, "Bro Adrian",
                                  "Request cover", "away", "", "Pending", "", "", "", ""]];
    const L2 = loadCodeGs(root, { tabs: t, props: { COORDINATOR_EMAIL: "a@b.c" } });
    const sh = L2.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Rota Requests");
    const qc = call(L2, "requestCols", sh);
    sh.getRange(2, qc.status).setValue("Rejected");
    call(L2, "onRotaEditNotify", { range: sh.getRange(2, qc.status) });
    a.eq(L2.gas.mail.length, 0, "no address is a quiet skip, not a throw");
  });


  /* ---- a reminder for a morning that is not his --------------------------

     dutyReminders read the driver's name out of the Rota and never asked the
     Status column what had happened to the Sunday. So a morning marked
     Cancelled/declined still emailed its driver "You are down to drive", a
     week out and again on the Friday, with a calendar file that alarmed him
     on the Saturday. The passenger side has always read that column. The one
     person who has to physically turn up was the one nobody told. */

  const ALL_STATUS = ["Confirmed", "Change requested", "Covered",
                      "North cancelled", "South cancelled",
                      "Cancelled/declined", "No driver assigned"];

  /* Seven days on from a Sunday is a Sunday, so this is a day the reminders
     actually do something. Both drivers are named and both have addresses. */
  const REMIND_FROM = "2026-09-27T14:00:00+01:00";
  const REMIND_FOR = new Date(2026, 9, 4);

  function remindWith(status) {
    const t = tabs();
    t["Drivers"] = [TABS["Drivers"],
                    ["Bro Adrian", "Driver", "YES", 2, "4321", "ade@b.c", "North", ""],
                    ["Bro Keith", "Driver", "YES", 3, "8765", "keith@b.c", "South", ""]];
    t["Rota"] = [ROTA_H, [REMIND_FOR, "Bro Adrian", "", "YS70 PWE", status,
                          "Bro Keith", "", "NH56 FWP", "", "", ""]];
    const L2 = loadCodeGs(root, { tabs: t, props: { COORDINATOR_EMAIL: "a@b.c" } });
    const out = call(L2, "dutyReminders");
    return { mail: L2.gas.mail, out: out };
  }



  /* ---- THE SAME DECISION, HANDED OVER AT ONCE ----------------------------

     Approving a cover from a phone wrote the rota and sent the emails, and
     then said "within five minutes", because that is how long the sheet took
     to ask for it. Which is our plumbing showing through: a man who has just
     keyed his PIN in a car park wants to see that it took.

     So the live server now knocks on this door the moment the PIN lands, and
     the drain stays underneath as the thing that catches a push that did not
     come off. TWO WAYS IN, ONE WRITER — applyRotaDecision — because a
     decision must not be able to mean one thing at two seconds and another at
     five minutes. These tests are that claim. */

  s.test("a decision pushed straight here lands exactly as the drain's does", (a) => {
    const pushedL2 = deciding({ sunday: SOON });
    const pushed = byPush(pushedL2, "Approved", "Bro Trevor");
    a.eq(pushed.out.ok, true, JSON.stringify(pushed.out));

    const drained = deciding({ sunday: SOON });
    byLink(drained, "Approved", "Bro Trevor");

    /* Read both tabs and compare the cells that matter: the request's own
       status and cover, and the two cells on the Rota that approving one is
       actually for. */
    const cells = (L2) => {
      const sh = L2.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Rota Requests");
      const qc = call(L2, "requestCols", sh);
      return [String(cellOf(L2, "Rota Requests", 2, qc.status)),
              String(cellOf(L2, "Rota Requests", 2, qc.replacement)),
              String(cellOf(L2, "Rota", 2, 3)),
              String(cellOf(L2, "Rota", 2, 5))];
    };
    a.eq(cells(pushedL2).join(" | "), cells(drained).join(" | "),
         "the two ways in disagree about what the decision meant");
  });

  s.test("and it tells the same people", (a) => {
    /* The bug that cost two emails once already: an Apps Script write fires
       no installed trigger, so both handlers have to be called by name. The
       push path goes through the same function, and this is what proves it
       rather than assuming it. */
    const pushed = byPush(deciding({ sunday: SOON }), "Approved", "Bro Trevor");
    const drained = byLink(deciding({ sunday: SOON }), "Approved", "Bro Trevor");
    const sort = (m) => m.map((x) => String(x.to) + " :: " + String(x.subject)).sort();
    a.eq(sort(pushed.mail).join("\n"), sort(drained).join("\n"),
         "a decision made on a phone reached different people depending on the route");
    a.ok(pushed.mail.length > 0, "the fixture sent nothing, so this proves nothing");
  });

  s.test("A SECOND DELIVERY OF THE SAME DECISION CHANGES NOTHING", (a) => {
    /* The safety the whole design rests on. The server pushes, and if it does
       not hear back it marks nothing and lets the drain carry it again. So
       the same decision arriving twice must be a no-op on the second — not
       two emails, not a second Sunday moved, not a note rewritten. */
    const L2 = deciding({ sunday: SOON });
    byPush(L2, "Approved", "Bro Trevor");
    const after = L2.gas.mail.length;
    const sh = L2.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Rota Requests");
    const qc = call(L2, "requestCols", sh);
    const was = String(cellOf(L2, "Rota Requests", 2, qc.status));

    const again = byPush(L2, "Rejected", "");
    a.eq(again.out.ok, true, "it should still say yes: there is nothing left to do");
    a.eq(L2.gas.mail.length, after, "it told everybody twice");
    a.eq(String(cellOf(L2, "Rota Requests", 2, qc.status)), was,
         "a queued answer overruled a decision already made");
  });

  s.test("a push with no token is not a push", (a) => {
    const L2 = deciding({ sunday: SOON });
    const out = byPush(L2, "Approved", "Bro Trevor", { token: "wrong" });
    a.eq(out.out.ok, false, "anybody who found the address could move the rota");
    const sh = L2.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Rota Requests");
    const qc = call(L2, "requestCols", sh);
    a.eq(String(cellOf(L2, "Rota Requests", 2, qc.status)), "Pending");
  });

  s.test("a push naming a request that is not there is answered yes, not held", (a) => {
    /* Yes means "stop carrying this", not "it worked". A row that has been
       archived or deleted since the email went is finished with, and holding
       the queue open for it would mean carrying it for ever. */
    const L2 = deciding({ sunday: SOON });
    const out = byPush(L2, "Approved", "", { decision: {
      id: "REQ-NOPE", choice: "Approved", cover: "", by: "Bro Arthur", at: Date.now() } });
    a.eq(out.out.ok, true, JSON.stringify(out.out));
  });

  s.test("a push carrying no request at all is refused", (a) => {
    const L2 = deciding({ sunday: SOON });
    const out = byPush(L2, "Approved", "", { decision: {} });
    a.eq(out.out.ok, false);
  });

  s.test("the sheet sends the live server its own address, and only a real one", (a) => {
    /* Without this the server has no way back and every decision waits for
       the tick. With a /dev address — which is what getUrl answers when this
       is run from the editor — it would have a way back that nothing outside
       the account can use, which is worse than none because it fails
       silently. */
    const L2 = deciding({ sunday: SOON });
    L2.ctx.ScriptApp.getService = () => ({ getUrl: () => "https://script.google.com/macros/s/AAA/exec" });
    a.eq(call(L2, "sheetReturnUrl"), "https://script.google.com/macros/s/AAA/exec");

    L2.ctx.ScriptApp.getService = () => ({ getUrl: () => "https://script.google.com/macros/s/AAA/dev" });
    a.eq(call(L2, "sheetReturnUrl"), "", "a /dev address is no address");

    L2.ctx.ScriptApp.getService = () => { throw new Error("not deployed"); };
    a.eq(call(L2, "sheetReturnUrl"), "", "a script with no web app must not fail the sync");
  });


  s.test("A DECISION IS CLAIMED UNDER A LOCK, and a lost race is said so", (a) => {
    /* There are two ways into this function now, and the window between the
       live server writing a decision down and hearing that the sheet has it
       is a window in which the drain can fetch the same decision. Both would
       read Pending and both would write, and two drivers would be told
       twice.

       The lock makes the read and the write one act. The interesting half is
       what happens to the caller that does not get it: it must not say yes.
       Saying yes has the live server mark the decision delivered, and then
       nobody ever applies it — a driver turning up to a bus that is not his,
       traded for a second or two of speed. */
    const L2 = deciding({ sunday: SOON });
    L2.gas.holdTheLock(true);

    const out = byPush(L2, "Approved", "Bro Trevor");
    a.eq(out.out.ok, false, "it claimed a row it never touched");

    const sh = L2.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Rota Requests");
    const qc = call(L2, "requestCols", sh);
    a.eq(String(cellOf(L2, "Rota Requests", 2, qc.status)), "Pending",
         "it wrote the cell anyway");
    a.eq(L2.gas.mail.length, 0, "and it told people about a decision it did not apply");

    /* And the drain, finding the same thing, keeps it rather than dropping
       it — which is what makes the tick a backstop and not a bin. */
    L2.gas.holdTheLock(false);
    byLink(L2, "Approved", "Bro Trevor");
    a.eq(String(cellOf(L2, "Rota Requests", 2, qc.status)), "Approved",
         "the decision was lost between the two of them");
    a.ok(L2.gas.mail.length > 0, "and nobody was told even then");
  });

  s.test("the drain holds on to a decision it could not get the lock for", (a) => {
    /* The drain tells the live server which decisions to stop carrying, and
       that list is the ONLY thing standing between a decision and oblivion:
       once a token is in it the server marks it delivered and never offers
       it again. A decision that was not applied must not be in it.

       Run twice, contended and free, because "the list was empty" proves
       nothing on its own — a drain that reported nothing either way would
       pass it. */
    const forgotten = (L2) => {
      const sent = L2.gas.fetched
        .map((f) => { try { return JSON.parse(f.opts.payload || "{}"); } catch (e) { return {}; } })
        .filter((b) => b.action === "drained");
      return [].concat.apply([], sent.map((b) => b.decisions || []));
    };

    const held = deciding({ sunday: SOON });
    held.gas.holdTheLock(true);
    byLink(held, "Approved", "Bro Trevor");
    a.eq(forgotten(held).length, 0, "it told the server to forget one it had not applied");

    const free = deciding({ sunday: SOON });
    byLink(free, "Approved", "Bro Trevor");
    a.eq(forgotten(free).length, 1, "and it never reports one it DID apply, so this proves nothing");
  });

  /* ---- a cover chosen on the phone --------------------------------------- */

  s.test("a cover picked from the email lands in the Replacement cell", async (a) => {
    const L2 = deciding({ sunday: SOON });
    byLink(L2, "Approved", "Bro Trevor");
    const sh = L2.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Rota Requests");
    const qc = call(L2, "requestCols", sh);
    a.eq(String(cellOf(L2, "Rota Requests", 2, qc.replacement)), "Bro Trevor");
    a.eq(String(cellOf(L2, "Rota Requests", 2, qc.status)), "Approved");
  });

  s.test("and the Sunday comes out Covered, with his name on it", async (a) => {
    /* onEditRequests reads the Replacement cell to decide what approving
       MEANS: with a name it writes that name into the Sunday and marks the
       morning Covered; without one it marks it No driver assigned.

       I WROTE THIS TEST CLAIMING THE WRITE ORDER WAS LOAD-BEARING, AND IT IS
       NOT. Both cells are set before the handler is called by hand, and the
       handler reads the tab fresh, so it sees the pair whichever went down
       first — swapping them changes nothing and this test went on passing,
       which is how I found out. The cover is still written first because
       that is the order a person would use, not because anything depends on
       it. What this test is actually for is the outcome below. */
    const L2 = deciding({ sunday: SOON });
    byLink(L2, "Approved", "Bro Trevor");
    const rota = L2.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Rota");
    const rc = call(L2, "rotaCols", rota);
    a.eq(String(rota.getRange(2, rc.northCover).getValue()), "Bro Trevor",
         "the Sunday was not covered");
    a.eq(String(rota.getRange(2, rc.status).getValue()), "Covered");
  });

  s.test("and both men are told, without anybody opening the spreadsheet", async (a) => {
    const L2 = deciding({ sunday: SOON });
    const mail = byLink(L2, "Approved", "Bro Trevor").map((m) => String(m.to));
    a.ok(mail.indexOf("ade@b.c") !== -1, "the man coming off: " + mail.join());
    a.ok(mail.indexOf("trevor@b.c") !== -1, "the man coming on: " + mail.join());
  });

  s.test("with no cover it behaves exactly as it always did", async (a) => {
    /* Leaving it alone is a real answer, not a half-finished one. */
    const L2 = deciding({ sunday: SOON });
    byLink(L2, "Approved");
    const rota = L2.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Rota");
    const rc = call(L2, "rotaCols", rota);
    a.eq(String(rota.getRange(2, rc.status).getValue()), "No driver assigned");
    const his = to(L2.gas.mail, "ade@b.c");
    a.eq(his.length, 1, "and the man who asked is still answered");
    a.has(his[0].subject, "has been approved");
  });

  s.test("a cover on a refusal is ignored here too", async (a) => {
    /* The live server drops it, and this end does not act on one either:
       two implementations of the same rule is one of them drifting. */
    const L2 = deciding({ sunday: SOON });
    byLink(L2, "Rejected", "Bro Trevor");
    const sh = L2.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Rota Requests");
    const qc = call(L2, "requestCols", sh);
    a.eq(String(cellOf(L2, "Rota Requests", 2, qc.replacement)), "");
  });

  s.test("the note on the cell says who decided and who is covering", async (a) => {
    const L2 = deciding({ sunday: SOON });
    byLink(L2, "Approved", "Bro Trevor");
    const sh = L2.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Rota Requests");
    const qc = call(L2, "requestCols", sh);
    const note = String(sh.getRange(2, qc.status).getNote() || "");
    a.has(note, "Bro Arthur");
    a.has(note, "cover Bro Trevor", "got: " + note);
  });

  s.test("a cancelled Sunday does not tell its drivers to turn up", async (a) => {
    await atTime(REMIND_FROM, () => {
      const r = remindWith("Cancelled/declined");
      a.eq(r.mail.length, 0,
           "got " + JSON.stringify(r.mail.map((m) => m.subject)));
      a.eq(r.out.off.length, 2, "both routes, and both said so out loud");
    });
  });

  s.test("one route cancelled stops that route and only that route", async (a) => {
    await atTime(REMIND_FROM, () => {
      const north = remindWith("North cancelled").mail.map((m) => String(m.to));
      a.eq(north.indexOf("ade@b.c"), -1, "North is off: " + north.join());
      a.ok(north.indexOf("keith@b.c") !== -1, "South still runs: " + north.join());

      const south = remindWith("South cancelled").mail.map((m) => String(m.to));
      a.ok(south.indexOf("ade@b.c") !== -1, "North still runs: " + south.join());
      a.eq(south.indexOf("keith@b.c"), -1, "South is off: " + south.join());
    });
  });

  s.test("a Sunday somebody has been excused from stops reminding him", async (a) => {
    /* Approving a cover sets the morning to "No driver assigned" and leaves
       his name in the scheduled column on purpose: that name is how you know
       whose Sunday you are covering, and how you put it back if the request
       is reversed. Clearing it would destroy the record to silence a
       reminder. Reading the status silences the reminder and keeps it. */
    await atTime(REMIND_FROM, () => {
      a.eq(remindWith("No driver assigned").mail.length, 0);
    });
  });

  s.test("an ordinary Sunday still reminds both drivers", async (a) => {
    /* The guard has to be narrow. A reminder wrongly withheld is a man who
       does not turn up, which is worse than the bug it is fixing. */
    await atTime(REMIND_FROM, () => {
      for (const st of ["Confirmed", "Covered", "Change requested"]) {
        const who = remindWith(st).mail.map((m) => String(m.to)).sort();
        a.eq(who.join(), "ade@b.c,keith@b.c", st + " sent to " + who.join());
      }
    });
  });

  s.test("every status this project knows about is decided, none left to chance", async (a) => {
    await atTime(REMIND_FROM, () => {
      const L2 = loadCodeGs(root, { tabs: tabs(), props: { COORDINATOR_EMAIL: "a@b.c" } });
      a.same(L2.ctx.ROTA_STATUS.slice().sort(), ALL_STATUS.slice().sort(),
             "a status has been added or renamed and this suite has not been told");
      for (const st of ALL_STATUS) {
        const r = remindWith(st);
        a.eq(r.mail.length + r.out.off.length, 2,
             st + ": each route is either reminded or recorded as off, never neither");
      }
    });
  });

  s.test("the spreadsheet and the Worker agree on what cancelled means", async (a) => {
    /* Two implementations of one rule, in two languages, on two machines.
       If they drift, a Sunday is off for the passengers and on for the
       driver — the worst of the three possible answers, and one nobody would
       notice until somebody stood at a kerb.

       Compared by BEHAVIOUR over the whole vocabulary rather than by reading
       both and deciding they look alike. */
    installGlobals();
    const { mod: W } = await loadWorker(root);
    const L2 = loadCodeGs(root, { tabs: tabs(), props: { COORDINATOR_EMAIL: "a@b.c" } });

    for (const st of ALL_STATUS.concat(["", "  ", "CANCELLED/DECLINED", "north cancelled"])) {
      for (const route of ["North", "South"]) {
        a.eq(call(L2, "routeCalledOff", st, route + " Liverpool"),
             W.routeCancelled({ status: st }, route),
             JSON.stringify(st) + " on " + route + ": the sheet and the Worker disagree");
      }
    }
  });

  s.test("a cancelled morning has no duty to hand over", async (a) => {
    /* Swapping a name on a Sunday that is not running would otherwise tell
       somebody he is "now down to drive" a bus that is not going anywhere,
       with a calendar file to match. */
    const L2 = deciding({ sunday: SOON });
    const ss = L2.ctx.SpreadsheetApp.getActiveSpreadsheet();
    const rota = ss.getSheetByName("Rota");
    const rc = call(L2, "rotaCols", rota);
    rota.getRange(2, rc.status).setValue("Cancelled/declined");
    rota.getRange(2, rc.north).setValue("Bro Trevor");
    call(L2, "onRotaEditNotify",
         { range: rota.getRange(2, rc.north), oldValue: "Bro Adrian", value: "Bro Trevor" });
    a.eq(L2.gas.mail.length, 0, "got " + JSON.stringify(L2.gas.mail.map((m) => m.subject)));
  });

  s.test("but a half-typed Sunday still hands it over", async (a) => {
    /* "No driver assigned" is a state a row passes THROUGH while it is being
       edited: clear a name and it lands there until the next one is typed.
       The duty change alert runs inside that edit, so reading it as "this
       morning is off" would swallow the email telling the new man he is on.
       That is why the alert asks only whether the route was CALLED OFF, and
       the daily reminders — which run against a sheet nobody is typing into
       — ask the wider question. */
    const L2 = deciding({ sunday: SOON });
    const ss = L2.ctx.SpreadsheetApp.getActiveSpreadsheet();
    const rota = ss.getSheetByName("Rota");
    const rc = call(L2, "rotaCols", rota);
    rota.getRange(2, rc.status).setValue("No driver assigned");
    rota.getRange(2, rc.north).setValue("Bro Trevor");
    call(L2, "onRotaEditNotify",
         { range: rota.getRange(2, rc.north), oldValue: "Bro Adrian", value: "Bro Trevor" });
    const to = L2.gas.mail.map((m) => String(m.to));
    a.ok(to.indexOf("trevor@b.c") !== -1, "the new driver must still be told: " + to.join());
  });


  /* ---- the real Bus Stops tab --------------------------------------------

     Pasted off the live spreadsheet on 22 September 2026, after "Set up /
     refresh rota" had been run and every Lat and Lng on all nineteen rows
     came out blank.

     The rule was `name === known.stop`, exact string equality, and the names
     in STOP_PINS were the SHORT ones out of these very fixtures. A real tab
     does not say "Grace Rd". It says "Grace Road bus stop, Walton Vale".
     Not one of the fifteen could ever have matched, and the church rows say
     "Church, Chester Road" rather than "Church", so those failed too.

     THE FIXTURE ABOVE IS WHY IT SHIPPED. A test built from the same short
     names the code was written against agrees with it about everything,
     including being wrong. So this tab is kept verbatim — long names,
     brackets, the nursery, the cafe, the renumbered arrival rows — and it is
     the one that has to pass. */

  const REAL_TAB = [
    ["Route", "Stop ID", "Time", "Stop", "Postcode", "Active", "Type", "Where", "Lat", "Lng"],
    ["North", "N00", "09:52", "Church, Chester Road", "L6 4DY", "YES", "Depart", "", "", ""],
    ["North", "N01", "10:03", "Scarisbrick Drive by Ardville Road", "L11 7DD", "YES", "Pickup", "12 Ardville Rd, Liverpool L11 7DA", "", ""],
    ["North", "N02", "10:15", "Grace Road bus stop, Walton Vale", "L9 2BU", "YES", "Pickup", "53.463563, -2.959062", "", ""],
    ["North", "N03", "10:24", "Little Kings & Queens Nursery, Litherland Road", "L20 3HZ", "YES", "Pickup", "74 Litherland Rd, Bootle L20 3HZ", "", ""],
    ["North", "N04", "10:32", "Fountains Road by Stanley Close", "L4 1QL", "YES", "Pickup", "Stanley Cl, Kirkdale, Liverpool", "", ""],
    ["North", "N05", "10:39", "Bedford Road by Stuart Hotel", "L4 5PU", "YES", "Pickup", "62 Bedford Rd, Liverpool L4 5PU", "", ""],
    ["North", "N06", "10:42", "Pym Street bus stop, County Road", "L4 5PH", "YES", "Pickup", "53.444062, -2.969688", "", ""],
    ["North", "N07", "10:45", "Wilburn Street bus stop, County Road", "L4 3QN", "YES", "Pickup", "53.441187, -2.970688", "", ""],
    ["North", "N08", "10:52", "Stanley Park Market (Car Park) bus stop, Priory Road", "L4 0TQ", "YES", "Pickup", "53.432312, -2.956937", "", ""],
    ["North", "N09", "11:00", "Church, Chester Road", "L6 4DY", "YES", "Arrival", "", "", ""],
    ["South", "S00", "10:21", "Church, Chester Road", "L6 4DY", "YES", "Depart", "", "", ""],
    ["South", "S01", "10:29", "Dewsbury Road by Lynholme Road", "L4 2XF", "YES", "Pickup", "67 Dewsbury Rd, Anfield, Liverpool L4 2XF", "", ""],
    ["South", "S02", "10:33", "Vicar Road bus stop, Townsend Road", "L6 0BB", "YES", "Pickup", "53.429938, -2.944937", "", ""],
    ["South", "S03", "10:37", "Sedley Street (St Andrew Road) bus stop, Breck Road", "L4 2RB", "YES", "Pickup", "53.425937, -2.952438", "", ""],
    ["South", "S04", "10:40", "Breck Road (Sprucewood Close) bus stop, Belmont Road", "L6 5BJ", "YES", "Pickup", "53.424312, -2.953563", "", ""],
    ["South", "S05", "10:46", "Parton Street off Sheil Road", "L6 3AW", "YES", "Pickup", "53.414062, -2.944937", "", ""],
    ["South", "S06", "10:50", "Hannan Road by Molyneux Road (The Molly Cafe)", "L6 6AN", "YES", "Pickup", "53.414313, -2.949187", "", ""],
    ["South", "S07", "10:53", "Halsbury Road by Molyneux Road", "L6 6AW", "YES", "Pickup", "194 Molyneux Rd, Kensington, Liverpool L6 6AW", "", ""],
    ["South", "S08", "11:00", "Church, Chester Road", "L6 4DY", "YES", "Arrival", "", "", ""]
  ];

  function fillReal(rows) {
    const t = tabs();
    t["Bus Stops"] = (rows || REAL_TAB).map((r) => r.slice());
    const L2 = loadCodeGs(root, { tabs: t, props: { COORDINATOR_EMAIL: "a@b.c" } });
    const ss = L2.ctx.SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(L2.ctx.STOPS_SHEET);
    const sc = call(L2, "colsHard", sh, L2.ctx.STOPS_SHEET);
    call(L2, "fillStopPins", sh, sc);
    const out = sh.getDataRange().getValues();
    const head = out[0];
    const byId = {};
    for (const r of out.slice(1)) {
      byId[String(r[head.indexOf("Stop ID")]).trim()] =
        { lat: r[head.indexOf("Lat")], lng: r[head.indexOf("Lng")] };
    }
    return byId;
  }

  s.test("every row on the real tab gets its kerb", (a) => {
    /* N04 excepted, and deliberately: see the note on Fountains Road in
       Code.gs. A coordinate nobody trusts is not shipped. */
    const byId = fillReal();
    const blank = Object.keys(byId).filter((id) => byId[id].lat === "" || byId[id].lat == null);
    a.eq(blank.sort().join(", "), "N04, S02, S05",
         "still blank: " + (blank.join(", ") || "none"));
  });


  /* ---- a rehearsal, owned by the live server from v1.84.0 ----------------

     This file used to own it: the flag in Script Properties, the seats drawn
     onto the Bus Bookings tab, both carried to the live server on the next
     push. A sheet whose copy said "none" then ended a rehearsal started
     anywhere else on its next sync, and ending one left its taps on the Trip
     Events tab on purpose. Now the two menu items ask the live server, the
     drain tells this file what happened, and this file keeps a copy of the
     flag and takes the rows off its tabs.

     Every check here fails on v1.83.0. */

  const BOOK_H = TABS["Bus Bookings"], TRIP_H = TABS["Trip Events"];

  /* Two rounds: one that is over, and one that began five minutes ago and
     whose first tap and seat the drain has already written. */
  function withRehearsalRows(on) {
    const now = Date.now();
    const OLD = now - 20 * 60000, NEW = now - 5 * 60000;
    const key = "2026-10-04";
    const t = tabs();
    const trip = (logged, id, status, live) =>
      [new Date(logged), id, key, "North", "Bro Adrian", "picked", "N02", "Grace Road bus stop, Walton Vale",
       "", new Date(logged), 0, status, "YS70 PWE", "", "", "", "", "", live];
    t["Trip Events"] = [TRIP_H,
      trip(OLD + 1000, "t-old", "Rehearsal", "1"),
      trip(OLD + 2000, "t-old", "Undone", "2"),        /* taken back: lost the word */
      trip(OLD + 3000, "t-real", "Logged", "3"),       /* a real tap */
      trip(NEW + 2000, "t-new", "Rehearsal", "4")];    /* the new round's */
    t["Bus Bookings"] = [BOOK_H,
      [new Date(OLD), key, "North", "N02", "Grace Road bus stop, Walton Vale", 3, "rehearsal-north-0-a", "Rehearsal", "", "", "11"],
      [new Date(NEW + 10), key, "North", "N01", "Scarisbrick Drive by Ardville Road", 2, "rehearsal-north-0-b", "Rehearsal", "", "", "12"],
      [new Date(OLD - 86400000), key, "North", "N01", "Scarisbrick Drive by Ardville Road", 1, "d-real", "Booked", "07700900001", "p1", "13"]];
    const props = { COORDINATOR_EMAIL: "a@b.c", WORKER_URL: "https://example.invalid", rotaVersion: "7" };
    if (on) props.rehearsal = JSON.stringify({ at: on === "new" ? NEW : OLD, key: key, shape: "normal" });
    return { L2: loadCodeGs(root, { tabs: t, props: props }), OLD, NEW, key };
  }
  const liveIds = (L2, tab) => {
    const v = L2.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab).getDataRange().getValues();
    const i = v[0].indexOf("Live ID");
    return v.slice(1).map((r) => String(r[i]));
  };
  const mirror = (L2) => {
    const raw = L2.ctx.PropertiesService.getScriptProperties().getProperty("rehearsal");
    return raw ? JSON.parse(raw) : null;
  };
  const lastAlert = (L2) => L2.gas.logs.filter((l) => l[0] === "alert").pop() || [];
  const asked = (L2, action) => L2.gas.fetched.map((f) => {
    try { return JSON.parse(String(f.opts.payload || "{}")); } catch (e) { return {}; }
  }).filter((b) => b.action === action);
  const ssOf = (L2) => L2.ctx.SpreadsheetApp.getActiveSpreadsheet();

  const sent = (L2) => {
    const hit = asked(L2, "sync");
    return hit.length ? hit[hit.length - 1] : null;
  };

  s.test("the push no longer carries a rehearsal, running or not", (a) => {
    /* On v1.83.0 it did, and a copy that said "none" ended the one the
       coordinator had just started on his phone. */
    for (const on of [true, false]) {
      const { L2 } = withRehearsalRows(on);
      call(L2, "pushToWorker");
      const body = sent(L2);
      a.ok(body, "no sync was sent at all");
      a.not("rehearsal" in body, "the push still says whether one is running");
      a.not("rehearsalSeeds" in body, "the push still carries test seats");
    }
  });

  s.test("starting over takes the last round's rows off both tabs and keeps the new round's", (a) => {
    const { L2, NEW, key } = withRehearsalRows(true);
    const res = call(L2, "applyCoordAction", ssOf(L2), { id: "act-1-over", kind: "rehearsal", made: NEW,
      by: "Bro Arthur", body: { op: "over", sunday: key, round: NEW, ends: NEW + 7200000, shape: "full", trips: ["t-old"] } }, {});
    a.ok(res.done && res.ok !== false, JSON.stringify(res));
    a.same(liveIds(L2, "Trip Events"), ["3", "4"], "the taken-back tap is found by its trip, and the new round's is kept");
    a.same(liveIds(L2, "Bus Bookings"), ["12", "13"]);
    a.eq(mirror(L2).at, NEW, "the copy of the flag is not the new round");
    a.eq(mirror(L2).shape, "full");
    a.eq(res.result, "Taken off the tabs: 2 taps and 1 test seat.");
  });

  s.test("ending one clears the copy and every test row made before the end", (a) => {
    const { L2, OLD, key } = withRehearsalRows(true);
    call(L2, "applyCoordAction", ssOf(L2), { id: "act-2-end", kind: "rehearsal", made: Date.now(),
      by: "the clock", body: { op: "end", sunday: key, round: OLD, trips: ["t-old"] } }, {});
    a.eq(mirror(L2), null, "this file still thinks one is running");
    a.same(liveIds(L2, "Trip Events"), ["3"], "only the real tap should be left");
    a.same(liveIds(L2, "Bus Bookings"), ["13"], "only the real seat should be left");
  });

  s.test("an end made before the round this file holds leaves that round alone", (a) => {
    /* The clock's end of the last round, drained after the menu has
       already started the next. */
    const { L2, NEW, key } = withRehearsalRows("new");
    call(L2, "applyCoordAction", ssOf(L2), { id: "act-3-end", kind: "rehearsal", made: NEW - 60000,
      by: "the clock", body: { op: "end", sunday: key, round: NEW - 900000, trips: ["t-old"] } }, {});
    a.eq(mirror(L2) && mirror(L2).at, NEW, "a late end cleared the round after it");
    a.same(liveIds(L2, "Trip Events"), ["3", "4"]);
    a.same(liveIds(L2, "Bus Bookings"), ["12", "13"]);
  });

  /* The live server as the two menu items meet it: the rehearsal call, then
     the drain that brings the same change back to be applied in the drain's
     own turn, then the drain's receipt. */
  const liveServer = (answer, made) => (url, opts) => {
    let b = {}; try { b = JSON.parse(String(opts.payload || "{}")); } catch (e) {}
    const said = b.action === "rehearsal" ? answer
               : b.action === "drain" ? { ok: true, bookings: [], trips: [], checks: [], auths: [], requests: [],
                   decisions: [], coord: answer.ok && !drained.done
                     ? [{ id: answer.id, seq: 1, kind: "rehearsal", sunday: answer.body.sunday, by: "the spreadsheet",
                          made: made, body: answer.body }] : [] }
               : { ok: true };
    if (b.action === "drained") drained.done = true;
    return { code: 200, body: JSON.stringify(said) };
  };
  const drained = { done: false };

  s.test("Rehearse this Sunday asks the live server, and applies its answer here", (a) => {
    const { L2, key } = withRehearsalRows(true);
    const round = Date.now();
    drained.done = false;
    L2.gas.setFetchReply(liveServer({
      ok: true, id: "sheet-abc-1", words: "Rehearsal started over: a nearly full bus, until 22:00.",
      body: { op: "over", sunday: key, round: round, ends: round + 7200000, shape: "full", trips: ["t-old"] },
      rehearsal: { round: round, ends: round + 7200000, shape: "full" },
      summary: ["North: 15 booked at 6 of 8 stops, on a 16-seat bus."] }, round));
    call(L2, "startRehearsal");
    const q = asked(L2, "rehearsal");
    a.eq(q.length, 1, "the live server was not asked");
    a.eq(q[0].do, "start");
    a.eq(q[0].shape, "normal", "a blank answer is an ordinary morning");
    a.eq(mirror(L2).at, round);
    const said = lastAlert(L2);
    a.eq(said[1], "Rehearsal started over");
    a.has(said[2], "a nearly full bus");
    a.has(said[2], "15 booked at 6 of 8 stops");
    a.has(said[2], "The Bus Bookings and Trip Events tabs are up to date.");
    a.same(liveIds(L2, "Trip Events"), ["3"], "the last round's rows are still on the tab");
    a.ok(call(L2, "coordAppliedFind", "sheet-abc-1"), "the drain would apply it a second time");
  });

  s.test("Stop rehearsing clears the copy and the tabs on the live server's word", (a) => {
    const { L2, OLD, key } = withRehearsalRows(true);
    drained.done = false;
    L2.gas.setFetchReply(liveServer({
      ok: true, id: "sheet-end-1", words: "Rehearsal ended.",
      body: { op: "end", sunday: key, round: OLD, trips: ["t-old"] }, rehearsal: false }, Date.now()));
    call(L2, "stopRehearsal");
    a.eq(asked(L2, "rehearsal")[0].do, "end");
    a.eq(mirror(L2), null);
    a.eq(lastAlert(L2)[1], "Rehearsal ended");
    a.same(liveIds(L2, "Trip Events"), ["3"]);
    a.same(liveIds(L2, "Bus Bookings"), ["13"]);
  });

  s.test("no row is taken off a tab while a drain is filing, from the menu or at night", (a) => {
    /* A drain keeps the row numbers it has read. A row deleted under it from
       another run of the script puts its next write on somebody else's row. */
    const { L2, OLD, key } = withRehearsalRows(true);
    const props = L2.ctx.PropertiesService.getScriptProperties();
    props.setProperty("drainBusy", String(Date.now()));
    drained.done = false;
    L2.gas.setFetchReply(liveServer({
      ok: true, id: "sheet-end-2", words: "Rehearsal ended.",
      body: { op: "end", sunday: key, round: OLD, trips: ["t-old"] }, rehearsal: false }, Date.now()));
    call(L2, "stopRehearsal");
    a.eq(liveIds(L2, "Trip Events").length, 4, "rows were deleted under a running drain");
    a.eq(mirror(L2), null, "the copy of the flag waits for nothing");
    a.has(lastAlert(L2)[2], "catch up within a minute");
    let ran = false;
    a.eq(call(L2, "tabsTurn", () => { ran = true; return 1; }), null);
    a.not(ran, "the night's tidy-up ran under a drain");
    a.eq(props.getProperty("drainAgain"), "1", "and the running drain was not asked to go round again");
  });

  s.test("the copy of the flag ends by the live server's rule: two hours, the cutoff, or Sunday midnight", (a) => {
    /* Local times, because Apps Script's are. Until v1.84.1 the cutoff was
       reckoned from now, and one started at 08:30 on a Sunday ran on through
       the real morning. */
    const L2 = withRehearsalRows(false).L2;
    const at = (d, h, m) => new Date(2026, 9, d, h, m).getTime();
    a.eq(call(L2, "rehearsalEnds", at(1, 20, 0)), at(1, 22, 0), "a Thursday evening");
    a.eq(call(L2, "rehearsalEnds", at(3, 23, 0)), at(4, 0, 0), "late on Saturday");
    a.eq(call(L2, "rehearsalEnds", at(4, 8, 30)), at(4, 9, 30), "a Sunday morning, as an older version may have left it");
    a.eq(call(L2, "rehearsalEnds", at(4, 13, 0)), at(4, 15, 0), "a Sunday afternoon");
  });

  s.test("a real run stays on the tab whole, even with one of its taps stored as a test", (a) => {
    /* A page from before v1.79.0 could store the End of a real run as a test.
       The run is never taken for one of its rows. */
    const { L2, key } = withRehearsalRows(false);
    const sh = ssOf(L2).getSheetByName("Trip Events");
    const t0 = Date.now() - 3 * 3600000;
    const row = (ev, off, status, live) => [new Date(t0 + off), "REAL-1", key, "North", "Bro Adrian", ev, ev === "picked" ? "N01" : "",
      "", "", new Date(t0 + off), 0, status, "YS70 PWE", "", "", "", "", "", live];
    sh.appendRow(row("start", 0, "Logged", "21"));
    sh.appendRow(row("picked", 60000, "Logged", "22"));
    sh.appendRow(row("end", 120000, "Rehearsal", "23"));
    call(L2, "applyCoordAction", ssOf(L2), { id: "act-5-end", kind: "rehearsal", made: Date.now(),
      by: "the clock", body: { op: "end", sunday: key, round: 0, trips: ["t-old"] } }, {});
    const ids = liveIds(L2, "Trip Events");
    a.ok(["21", "22", "23"].every((x) => ids.indexOf(x) !== -1), "a real run lost rows: " + JSON.stringify(ids));
  });

  s.test("the menu's end, reckoned by the live server's clock, leaves a round started after it", (a) => {
    /* Stop rehearsing ends round 1; the coordinator's app starts round 2 a
       moment later, and the knock's drain has already set this file's copy
       to it. The menu's own clock must not clear round 2. */
    const { L2, NEW, key } = withRehearsalRows("new");
    L2.gas.setFetchReply({ code: 500, body: "the drain is not answering" });
    call(L2, "rehearsalHere", { id: "sheet-end-3", made: NEW - 60000,
      body: { op: "end", sunday: key, round: NEW - 900000, trips: [] } });
    a.eq(mirror(L2) && mirror(L2).at, NEW, "the newer round was cleared by the menu");
  });

  s.test("a Sunday's test run is not cleared once its cutoff has passed", async (a) => {
    /* On a Sunday afternoon the coming Sunday is today, and its morning is the
       record. The live server refuses it as well; this refuses before asking.
       The sandbox is made on a Sunday evening, so its clock stays there. */
    const L3 = await atTime("2026-10-04T20:00:00+01:00", () => withRehearsalRows(false).L2);
    const today = call(L3, "dateToKey", call(L3, "sundayOf", new L3.ctx.Date()));
    a.eq(today, "2026-10-04", "the sandbox is not on the Sunday");
    a.ok(call(L3, "bookingsClosed", today), "the cutoff has not passed in the sandbox");
    call(L3, "clearTestRun");
    a.eq(lastAlert(L3)[1], "That Sunday has been and gone", "it offered to clear the Sunday just driven");
    a.eq(asked(L3, "cleartrips").length, 0, "and it asked the live server to");
  });

  s.test("a test row inside a real Sunday morning, from before, stays on the tab", (a) => {
    const { L2, key } = withRehearsalRows(false);
    const sh = ssOf(L2).getSheetByName("Trip Events");
    const when = new Date(2026, 8, 27, 10, 12);
    sh.appendRow([when, "t-then", "2026-09-27", "North", "Bro Adrian", "picked", "N02", "Grace Road bus stop, Walton Vale",
                  "", when, 0, "Rehearsal", "YS70 PWE", "", "", "", "", "", "9"]);
    call(L2, "applyCoordAction", ssOf(L2), { id: "act-4-end", kind: "rehearsal", made: Date.now(),
      by: "the clock", body: { op: "end", sunday: key, round: 0, trips: ["t-old"] } }, {});
    a.ok(liveIds(L2, "Trip Events").indexOf("9") !== -1, "a run inside a real morning was deleted");
    a.same(liveIds(L2, "Trip Events"), ["3", "9"], "and the ordinary test rows should have gone");
  });

  s.test("when the live server does not answer, nothing changes here and it says so", (a) => {
    const { L2 } = withRehearsalRows(true);
    L2.gas.setFetchReply({ code: 500, body: "nope" });
    call(L2, "stopRehearsal");
    const said = lastAlert(L2);
    a.eq(said[1], "Not ended");
    a.has(said[2], "The live server did not answer.");
    a.has(said[2], "Nothing was changed.");
    a.ok(mirror(L2), "the copy was cleared anyway");
    a.eq(liveIds(L2, "Trip Events").length, 4, "rows were taken off anyway");
  });

  s.test("a live server older than this file is named as the reason", (a) => {
    const { L2 } = withRehearsalRows(false);
    L2.gas.setFetchReply({ code: 200, body: JSON.stringify({ ok: false, error: "unknown action" }) });
    call(L2, "startRehearsal");
    const said = lastAlert(L2);
    a.eq(said[1], "Not started");
    a.has(said[2], "older than this spreadsheet");
    a.eq(mirror(L2), null);
  });

  s.test("the pages are told the round, in the live server's shape", (a) => {
    const { L2, OLD } = withRehearsalRows(true);
    const info = call(L2, "rehearsalInfo");
    a.eq(info.round, OLD);
    a.eq(info.shape, "normal");
    a.ok(info.ends > Date.now(), JSON.stringify(info));
    a.eq(call(L2, "tripDriverPayload", "North").rehearsal.round, OLD, "the driver's board from this file");
    a.eq(call(withRehearsalRows(false).L2, "rehearsalInfo"), false);
  });

  s.test("a tap from a round that is over is not written here either", (a) => {
    const { L2, OLD, key } = withRehearsalRows(true);
    const out = JSON.parse(call(L2, "handleTrip", { trip: "t-late", route: "North", driver: "Bro Adrian",
      sunday: key, rehearsal: OLD - 60000, events: [{ event: "picked", stopId: "N02", at: Date.now() }] }).getContent());
    a.ok(out.ok && out.rehearsalOver, JSON.stringify(out));
    a.eq(liveIds(L2, "Trip Events").length, 4, "it was written");
  });


  /* ---- the one button in the message that does something ----------------- */

  s.test("a decision button wears its own subject's colour, not the same grey as the rest", (a) => {
    /* Three near-black rectangles in one email makes a coordinator read all
       three to find the one that acts, which is the opposite of what a button
       is for. The colour is taken from the band at the top of the same
       message, so the eye follows one thread down the page. */
    const bus = call(L, "decideHtml", "https://x/do/?t=" + "a".repeat(32),
                     "Authorise this bus to run", 60, "#A8231B");
    a.has(bus, "#A8231B", "got: " + bus);
    a.hasnt(bus, "#1B222C", "still the old grey");

    const rota = call(L, "decideHtml", "https://x/do/?t=" + "b".repeat(32),
                      "Approve or turn it down", 60, "#B26B00");
    a.has(rota, "#B26B00");
  });

  s.test("with no link it still says how to decide, and offers no button", (a) => {
    /* The live server being down must never be able to stop a coordinator
       finding out that a bus is off the road, or acting on it. */
    const out = call(L, "decideHtml", "", "Authorise this bus to run", 60, "#A8231B");
    a.has(out, "Open the spreadsheet");
    a.hasnt(out, "<a href");
  });

  s.test("the colour the stopped bus email uses is the one its own band uses", (a) => {
    /* Typed in two places, so this is the thing that says they still agree. */
    const src = readFileSync(join(root, "Code.gs"), "utf8");
    a.has(src, 'htmlShell("Authorised to run, defect open", "#A8231B"',
          "the band's colour has moved");
    a.has(src, '"Authorise this bus to run",\n                                               LINK_RULES.ttlMinutes, "#A8231B")',
          "the button no longer matches the band");
  });

  s.test("no two kerbs share a latitude or a longitude", (a) => {
    /* THE CHECK THAT WOULD HAVE CAUGHT FOUNTAINS ROAD, and the one that is
       worth keeping.

       Its latitude was 53.432320. Stanley Park's is 53.432312 — EIGHT METRES
       apart, for two stops a mile and an eighth apart. That is not a
       coincidence, it is a row read off the wrong line, and it is the shape
       almost every hand-copied coordinate error takes: one number carried
       over, the other one right.

       I tried measuring how far each stop bends the route instead, and threw
       it away. Fountains Road bent it by 3.1x — and so does Dewsbury Road,
       which is perfectly correct: the South route goes out to its furthest
       stop first and works back. A test that cannot tell those apart would
       have cried wolf on a good route, and a check nobody trusts is worse
       than no check. This one has no opinion about routes at all. */
    const pins = ctx.STOP_PINS;
    const ids = Object.keys(pins);
    const SAME = 0.00002;                    /* about two metres */
    const NEAR = 0.0009;                     /* about a hundred */

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const p = pins[ids[i]].at, q = pins[ids[j]].at;
        const dLat = Math.abs(p[0] - q[0]), dLng = Math.abs(p[1] - q[1]);
        const pair = ids[i] + " and " + ids[j];
        a.not(dLat < SAME && dLng > NEAR,
              pair + " share a latitude but are nowhere near each other");
        a.not(dLng < SAME && dLat > NEAR,
              pair + " share a longitude but are nowhere near each other");
      }
    }
  });

  s.test("no two kerbs are the same spot, or nearly", (a) => {
    /* The old version compared the two strings, so it only ever caught a row
       copied EXACTLY. Fountains Road was copied off Stanley Park's latitude
       and then had its own longitude, which that could not see. Distance
       catches both, and twenty metres apart is two different kerbs. */
    installGlobals();
    const pins = ctx.STOP_PINS;
    const ids = Object.keys(pins);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const p = pins[ids[i]].at, q = pins[ids[j]].at;
        const dLat = Math.abs(p[0] - q[0]), dLng = Math.abs(p[1] - q[1]);
        a.not(dLat < 0.00002 && dLng < 0.00002,
              ids[i] + " and " + ids[j] + " are on the same spot");
      }
    }
  });

  s.test("including the church at both ends of both routes", (a) => {
    /* Matched on being a Depart or an Arrival at the church's postcode. The
       name is not used: the tab says "Church, Chester Road", it has said
       other things, and none of that moves the building. */
    const byId = fillReal();
    for (const id of ["N00", "N09", "S00", "S08"]) {
      a.near(byId[id].lat, 53.424169, 0.000001, id);
      a.near(byId[id].lng, -2.936799, 0.000001, id);
    }
  });

  s.test("the kerbs are the ones already written into Where by hand", (a) => {
    /* Nine rows carry a coordinate in the Where column, typed there before
       Lat and Lng existed. They are independent of STOP_PINS and they agree
       with it to six decimal places, which is the only outside check this
       project has on those numbers. */
    const byId = fillReal();
    let checked = 0;
    for (const row of REAL_TAB.slice(1)) {
      const where = String(row[7] || "").trim();
      const m = /^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/.exec(where);
      if (!m) continue;
      /* A withheld kerb has nothing to compare against. That is the point of
         withholding it: the Where cell and STOP_PINS came from the same
         survey, so agreeing with each other would prove nothing about the
         two that are suspect. */
      if (byId[row[1]].lat === "" || byId[row[1]].lat == null) continue;
      checked++;
      a.near(byId[row[1]].lat, Number(m[1]), 0.000001, row[1] + " lat");
      a.near(byId[row[1]].lng, Number(m[2]), 0.000001, row[1] + " lng");
    }
    a.eq(checked, 7, "seven of the nine belong to a kerb still shipped; found " + checked);
  });

  s.test("a stop with no postcode still fills off the road name", (a) => {
    const rows = REAL_TAB.map((r) => r.slice());
    rows[7][4] = "";                       /* N06, Pym Street bus stop */
    a.near(fillReal(rows)["N06"].lat, 53.444062, 0.000001);
  });

  s.test("a moved stop stays blank, which is the whole reason for the check", (a) => {
    /* The row is reused for somewhere else: same Stop ID, new place, new
       postcode. Filling it from the id alone would write the OLD kerb — half
       a mile away, entirely plausible, and wrong in a way nothing on the tab
       would show. */
    const rows = REAL_TAB.map((r) => r.slice());
    rows[6][3] = "Fernhill Road by Cedar Grove";
    rows[6][4] = "L20 9AB";
    const byId = fillReal(rows);
    a.eq(byId["N05"].lat, "", "a stop that has moved must wait for a coordinate");
    a.near(byId["N06"].lat, 53.444062, 0.000001, "and its neighbours still fill");
  });

  s.test("a stop renamed but not moved still fills", (a) => {
    /* The postcode is the signal precisely so that renaming the landmark —
       which happens, cafes close — does not cost the kerb. */
    const rows = REAL_TAB.map((r) => r.slice());
    rows[18][3] = "Hannan Road by Molyneux Road (the old Molly Cafe)";
    a.near(fillReal(rows)["S06"].lat, 53.414313, 0.000001);
  });

  s.test("every pin carries the postcode it was surveyed at", (a) => {
    /* Without one it falls back to comparing names, which is the rule that
       filled nothing at all. */
    const L2 = loadCodeGs(root, { tabs: tabs(), props: { COORDINATOR_EMAIL: "a@b.c" } });
    for (const id of Object.keys(L2.ctx.STOP_PINS)) {
      a.ok(/^[A-Z]{1,2}\d/.test(String(L2.ctx.STOP_PINS[id].postcode || "")),
           id + " has no postcode against it");
    }
    a.ok(/^[A-Z]{1,2}\d/.test(String(L2.ctx.CHURCH_PIN.postcode || "")), "the church");
  });

  s.test("no two stops share a kerb", (a) => {
    /* A transposed digit usually lands somewhere plausible. Two stops on the
       exact same spot is the one shape of that mistake this can catch from
       here. */
    const seen = {};
    for (const id of Object.keys(ctx.STOP_PINS)) {
      const k = ctx.STOP_PINS[id].at.join(",");
      a.not(seen[k], id + " has the same coordinates as " + seen[k]);
      seen[k] = id;
    }
  });

  /* ---- what reaches the live server ------------------------------------- */

  s.test("the estimate settings exist and are all numbers", (a) => {
    const r = ctx.ETA_RULES;
    a.ok(r, "Code.gs has no ETA_RULES");
    for (const k of ["dwellSeconds", "skipSaves", "speedMph", "maxSkipMinutes"]) {
      a.eq(typeof r[k], "number", k + " should be a number");
    }
  });

  s.test("a passenger is sent the pin but never the doorstep address", (a) => {
    const out = call(L, "publicStops", [
      { route: "North", id: "N01", time: "10:00", stop: "Walton Vale", postcode: "L9 4RY",
        where: "1 Vale Road, Liverpool", arrival: false, depart: false, lat: 53.4642, lng: -2.9719 }
    ]);
    a.eq(out[0].lat, 53.4642, "the kerb is what the passenger page already shows anybody");
    a.eq(out[0].where, undefined, "the doorstep address is a driver's fact and some of these are houses");
  });

  s.test("the authoriser roles are the ones config.js offers the full inspection to", (a) => {
    a.ok(Array.isArray(ctx.AUTHORISER_ROLES));
    a.ok(ctx.AUTHORISER_ROLES.length > 0);
  });

  s.test("the sheet's own version is a version string", (a) => {
    a.ok(/^v\d+\.\d+\.\d+$/.test(ctx.SCRIPT_VERSION), "got " + ctx.SCRIPT_VERSION);
  });

  /* ---- the tabs the app depends on -------------------------------------- */

  s.test("every tab the script expects is named in one list", (a) => {
    for (const name of [ctx.STOPS_SHEET, ctx.DRIVERS_SHEET, ctx.BUSES_SHEET,
                        ctx.CHECKS_SHEET, ctx.DEFECTS_SHEET, ctx.TRIP_SHEET]) {
      a.ok(typeof name === "string" && name.length > 0);
    }
  });

  return s;
}
