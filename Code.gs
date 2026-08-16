/**
 * Minibus check recorder + driving rota.
 *
 * Receives completed checks from the phone app and writes them to this
 * spreadsheet. Emails the coordinator whenever a bus is stopped or a defect
 * is reported. Also serves and records the Sunday driving rota.
 *
 * THIS SPREADSHEET IS THE OFFICIAL ROTA. The app lets drivers look at the
 * rota and ask for a change. It does not let them alter it. Every real
 * change is made here, by the coordinator, in the Rota tab.
 *
 * Setup:
 *   1. Extensions > Apps Script, paste this in, Save
 *   2. Check TOKEN and COORDINATOR_EMAIL below
 *   3. Run  setUpEverything  once from the editor and grant permissions
 *   4. Deploy > New deployment > Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *   5. Copy the /exec URL into config.js
 *
 * After ANY later edit to this file: Deploy > Manage deployments > edit >
 * Version: New version. Saving alone does not update the live app.
 */

/* ---- settings ---------------------------------------------------------- */

var TOKEN = "minibusapp";                   // must match config.js

/* ---- passenger bookings -------------------------------------------------

   The driver app's token sits in config.js on a public web host, so anyone
   who views source has it. Bookings do not use TOKEN at all, and do not need
   to: there is nothing on the Bus Bookings tab that names anybody. A stop, a
   headcount, and a random handle the passenger's own phone made up.

   There used to be a per-Sunday code on the link, worked out from a secret
   held in Script Properties, plus a menu item to set that secret and a
   BUS_REQUIRE_CODE switch to bring the whole thing back. All of it has gone.

   The code came out of the link in v1.8 so that a family did not have to
   chase a new address every week. What was left behind only looked like a
   safety valve: the passenger page never read a code and never sent one, so
   turning the switch on would not have restored a gate, it would have
   answered every passenger with "That link is not valid" and left somebody
   reading the script on a Sunday morning to find out why. A switch that
   cannot be thrown safely is worse than no switch. */

/* Where the passenger page is hosted. Used only to build the link the menu
   gives you, so it just needs to match where the bus folder actually sits.
   The trailing slash matters: the page is sunday/index.html. */
var BUS_PAGE_URL = "https://drolnstone.github.io/minibus-check/sunday/";


/* When bookings close. Day 0 is Sunday itself, 6 is Saturday.

   Sunday 09:30, because North's first pickup is 10:05 and the driver leaves
   before that. Closing any later would have him already on the road while
   the list was still moving. After the cut-off the page still opens and still
   shows the times, it just will not take a change. */
/* The backstop for rolling the booking page on to next Sunday.

   Next week opens when this Sunday's runs have ENDED, not at the booking
   cutoff, because between 09:30 and the bus getting back the list a driver is
   working from is today's and so is the one a passenger is watching. Rolling
   at the cutoff put two different Sundays on one screen for the whole morning.

   The backstop exists because the roll would otherwise depend on a driver
   remembering End trip, which is the last tap of the morning, made after the
   bus is parked and everybody is getting off. Forget it and nobody could book
   for next Sunday at all until somebody noticed. Two routes make that worse:
   one forgotten tap would hold up the other route's passengers too.

   Two in the afternoon. Church finishes around one, both buses are long back,
   and nobody is booking before then anyway.

   It deliberately does not invent an end time for a trip nobody ended. A
   three and a half hour journey on the record is worse than a blank, so Who
   is tapping goes on saying started, never ended. */
var RUN_BACKSTOP_HOUR = 14;
var RUN_BACKSTOP_MIN  = 0;

var BOOKING_CUTOFF_DAY = 0;
var BOOKING_CUTOFF_HOUR = 9;
var BOOKING_CUTOFF_MIN = 30;

var BOOKINGS_SHEET = "Bus Bookings";

/* ---- movement tracking -------------------------------------------------
   Append-only. Every event of every run, kept rather than a status column on
   the timetable, because the timetable is reused each week and a status would
   be gone by the following Sunday. Events give journey time, tapping record
   and offset history for nothing. */
var TRIP_SHEET = "Trip Events";

/* How long a run may go without a tap before the passenger page stops giving
   times and says only what it last knew. Stops are four to six minutes apart,
   so this is roughly three missed ones: long enough to absorb a wheelchair, a
   slow family and a bad set of lights, short enough that somebody standing in
   the rain is not reading a stale promise.

   This is a GUESS. Nothing derives it. Trip Events records the gap between
   every tap on both routes, so after four or five Sundays the real spread can
   be read off the tab and this set from data instead. */
var TRIP_QUIET_MINUTES = 15;

/* Beyond this many minutes behind or ahead, the app stops projecting. That is
   no longer a late bus, it is something else, and a confident wrong number is
   worse than silence.

   Also a guess, and set long on purpose. A diversion on a match morning eats
   thirty minutes without anything being wrong, and the two mistakes cost
   differently: cutting off early leaves people with nothing at the moment
   they most want something, while projecting a little too long leaves them
   with a soft number, which still beats a blank screen. */
var TRIP_MAX_OFFSET = 45;

/* Under this, the page says "any moment now" rather than a number. Counting
   down the last thirty seconds to somebody who is already looking up the road
   is false precision. */
var TRIP_IMMINENT_MINUTES = 1;
/* Where defect and stopped-bus alerts are sent.
   Set it in Script Properties as COORDINATOR_EMAIL. The line below stays
   blank on purpose: a personal address does not belong in a file.
   Minibus > Check scheduled emails confirms which address is in use, and
   warns you if neither is set. */
var COORDINATOR_EMAIL = (function () {
  try {
    var p = PropertiesService.getScriptProperties().getProperty("COORDINATOR_EMAIL");
    if (p) return p;
  } catch (err) {}
  return "";                                     // set COORDINATOR_EMAIL instead
})();

var CHECKS_SHEET   = "Checks";
var DEFECTS_SHEET  = "Defects";
var ROTA_SHEET     = "Rota";
var REQUESTS_SHEET = "Rota Requests";
var DRIVERS_SHEET  = "Drivers";
var STOPS_SHEET    = "Bus Stops";

/* The Sunday timetable, so it stops living only in a WhatsApp message.

   Type is Pickup or Arrival. Church is where the run ends, not somewhere
   anybody boards, and keeping that distinction here means nothing later can
   offer it as a place to be picked up.

   Family names are deliberately not in the stop labels. "Bellamy and
   Cromwell families at Church Lane" is fine among people who know each
   other. Written down it pairs a surname with a street and the exact minute
   those people stand outside, and this tab is read by the app.

   South is five junctions off Molyneux Road, taken Patton first, then in to
   Tudor and back out. They used to be one line on a timetable because one
   bus did both runs and there was no point separating them. */
var STOPS_HEADERS = ["Route", "Stop ID", "Time", "Stop", "Postcode", "Active", "Type"];

var SEED_STOPS = [
  ["North", "N01", "10:05", "Scarisbrick Drive by Ardville Road",               "L11 7DD", "YES", "Pickup"],
  ["North", "N02", "10:14", "Cedar Road at Walton Vale, by Grace Road bus stop","L9 2BU",  "YES", "Pickup"],
  ["North", "N03", "10:20", "Church Lane bus stop, County Road",                "L4 5PQ",  "YES", "Pickup"],
  ["North", "N04", "10:23", "County Road by Ireton Street",                     "L4 5TR",  "YES", "Pickup"],
  ["North", "N05", "10:29", "Fountains Road by Stanley Close",                  "L4 1QL",  "YES", "Pickup"],
  ["North", "N06", "10:40", "The Lutine Bell",                                  "L5 6PT",  "YES", "Pickup"],
  ["North", "N07", "10:41", "Grasmere Street bus stop, in front of the mosque",  "L5 6PU",  "YES", "Pickup"],
  ["North", "N08", "10:44", "Sedley Street bus stop",                           "L6 5AF",  "YES", "Pickup"],
  ["North", "N09", "10:50", "Dewsbury Road by Lynholme Road",                   "L4 2XF",  "YES", "Pickup"],
  ["North", "N10", "10:54", "Townsend Road by Vicar Road bus stop, in front of the GP practice", "L6 0BB", "YES", "Pickup"],
  ["North", "N11", "11:00", "Church",                                           "L6 4DS",  "YES", "Arrival"],

  ["South", "S01", "10:40", "Parton Street, at the Molyneux Road junction",     "",        "YES", "Pickup"],
  ["South", "S02", "10:42", "Tudor Street, at the Molyneux Road junction",      "",        "YES", "Pickup"],
  ["South", "S03", "10:44", "North Cumbria, at the Molyneux Road junction",     "",        "YES", "Pickup"],
  ["South", "S04", "10:46", "Hannan, at the Molyneux Road junction",            "",        "YES", "Pickup"],
  ["South", "S05", "10:48", "Halsbury, at the Molyneux Road junction",          "",        "YES", "Pickup"],
  ["South", "S06", "11:00", "Church",                                           "L6 4DS",  "YES", "Arrival"]
];

/* Column headings on the Rota tab. The two slots are named after the routes
   rather than the vehicles, because which bus runs which route can change on
   the day, and the driver is rostered to a route. Defined once here: they
   used to be written out twice, which is how a rename goes half done.

   The script reads this tab by position, never by heading, so renaming these
   is purely cosmetic and cannot break anything. */
var ROTA_HEADERS = [
  "Sunday",
  "North Liverpool scheduled", "North Liverpool actual / cover", "Status",
  "South Liverpool scheduled", "South Liverpool actual / cover",
  "Notes", "Updated", "Updated by"
];

var STATUS_OPTIONS = ["Open", "Booked in", "Parts on order", "Fixed", "Monitoring", "Not a defect"];
var ROTA_STATUS    = ["Confirmed", "Change requested", "Covered", "Cancelled/declined", "No driver assigned"];
var REQ_STATUS     = ["Pending", "Approved", "Rejected"];

/* The Sunday the repeating pattern is measured from. It must be a Sunday and
   it must match the anchor in config.js. Do not move it: moving it changes
   who drives on every future Sunday that has not been written down yet. */
var PATTERN_ANCHOR = "2026-08-02";

/* South Liverpool started later, so it counts from its own first Sunday.

   Sharing North's anchor looked tidier and was wrong: the pattern counted
   weeks the South route was not running, so it arrived at its first real
   Sunday already two turns in and put the third name on it. Each route
   counts from the day it actually began.

   Before this date the South column stays blank, because there was no
   South run to record. Do not move it once the route is going: moving it
   changes who drives on every future Sunday not yet written down. */
var PATTERN_ANCHOR_SOUTH = "2026-08-16";

/* How far ahead the Rota tab is kept filled in. Sundays past this still show
   in the app, worked out from the pattern, and get written down here as the
   horizon rolls forward or the moment you change one by hand.

   Sixteen weeks is deliberately short. The rows exist so you have a cell to
   click, and in practice you only ever change a Sunday in the next month or
   two. Filling eighteen months made a long sheet that mostly restated what
   the app already works out for itself. For anything further ahead, use
   Minibus > Add a Sunday to the rota. */
var ROTA_FILL_WEEKS = 16;

/* The register the sheet starts from if the Drivers tab is empty. After the
   first run the Drivers tab IS the register, not this list. */
var SEED_DRIVERS = [
  { name: "Pst Kehinde",     role: "Minister in Charge", route: "",      order: "" },

  /* North Liverpool, the established route. Four in the pattern. */
  { name: "Bro Adebola",     role: "Driver",      route: "North", order: 1 },
  { name: "Bro Abiodun",     role: "Driver",      route: "North", order: 2 },
  { name: "Bro Moses",       role: "Driver",      route: "North", order: 3 },
  { name: "Bro Asim",        role: "Coordinator", route: "North", order: 4 },

  /* South Liverpool, the new route. Three in the pattern, so it turns over
     every three Sundays where North turns over every four. The two patterns
     run independently and are not meant to line up.

     Bro Tunde is first because he already knows the road. The other two
     shadow him on the opening Sunday and then take their turns. */
  { name: "Bro Tunde",       role: "Driver",      route: "South", order: 1 },
  { name: "Pst Obamakinwa",  role: "Driver",      route: "South", order: 2 },
  { name: "Bro Adesina",     role: "Driver",      route: "South", order: 3 },

  { name: "Bro Calvin",      role: "Backup",      route: "",      order: "" }
];

/* ---- entry points ------------------------------------------------------ */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return reply({ ok: false, error: "empty request" });
    }

    var body = JSON.parse(e.postData.contents);

    /* Passenger bookings are checked against that Sunday's own code, not
       against TOKEN, and are handled before the token test so a passenger
       page never needs the driver token in it. */
    if (String(body.action || "") === "booking") {
      return handleBooking(body.booking);
    }

    if (String(body.token || "") !== TOKEN) {
      return reply({ ok: false, error: "bad token" });
    }

    /* Answers yes or no about one PIN and nothing else. Before the token
       test on purpose: it is its own gate, it reveals nothing on a wrong
       answer, and it counts its own failures. */
    if (String(body.action || "") === "pin") {
      return handlePinCheck(body.pin);
    }

    if (String(body.action || "") === "rotaRequest") {
      return handleRotaRequest(body.request);
    }

    if (String(body.action || "") === "trip") {
      return handleTrip(body.trip);
    }

    return handleCheck(body.check);

  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};

  if (p.rota) {
    try { return reply(rotaPayload(p.from, Number(p.weeks) || 52)); }
    catch (err) { return reply({ ok: false, error: String(err) }); }
  }

  if (p.last) {
    try { return reply(lastMileagePayload()); }
    catch (err) { return reply({ ok: false, error: String(err) }); }
  }

  /* What the passenger page loads: the stops for that Sunday, how many are
     booked at each, and this device's own booking if it has one. */
  if (p.bus) {
    try { return reply(busPayload(p.d, p.ref)); }
    catch (err) { return reply({ ok: false, error: String(err) }); }
  }

  /* Booking counts on their own, for the driver app's Stops and bookings
     screen. Small enough to poll while that screen is open. */
  if (p.counts) {
    try { return reply(countsPayload()); }
    catch (err) { return reply({ ok: false, error: String(err) }); }
  }

  /* Everything the driver's Stops and bookings screen needs, in one answer.

     It used to ask twice, every thirty seconds, for two things it always
     wanted together and always for the same screen. Each ask carries its own
     redirect and cold start, so the second one was pure waiting. */
  if (p.board) {
    try { return reply(boardPayload(p.route)); }
    catch (err) { return reply({ ok: false, error: String(err) }); }
  }

  /* Where the bus has got to. With a ref it answers for one passenger and
     applies the gate; with a route it answers for a driver's own screen. */
  if (p.trip) {
    try {
      return reply(p.route ? tripDriverPayload(p.route) : tripPayload(p.ref, p.r));
    } catch (err) { return reply({ ok: false, error: String(err) }); }
  }

  return reply({ ok: true, service: "minibus check recorder" });
}

/* ---- checks ------------------------------------------------------------ */

function handleCheck(c) {
  if (!c || !c.id) {
    return reply({ ok: false, error: "no check in request" });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var checks = sheet(ss, CHECKS_SHEET, [
    "Received", "Check ID", "Date", "Time", "Vehicle", "Registration",
    "Driver", "Role", "Mileage", "Mileage flag", "Outcome",
    "Items checked", "Defect count", "Defects", "Renewals due", "Signed",
    "Not applicable", "Check type", "Where checked", "Accuracy (yd)",
    "Distance from base (yd)", "Location note", "Fuel", "To arrange", "PIN check"
  ]);
  ensureChecksColumns(checks);

  // Never write the same check twice, even if the phone retries.
  if (alreadyHave(checks, c.id)) {
    return reply({ ok: true, duplicate: true });
  }

  var outcome = c.level === "stop" ? "STOPPED"
              : c.level === "warn" ? "Defects"
              : "Clear";

  var defectText = (c.defects || []).map(function (d) {
    return d.name + (d.crit ? " (critical)" : "") + (d.note ? ": " + d.note : "");
  }).join(" | ");

  /* Only a genuine pair of coordinates may become a link. Anything else goes
     in as plain text: this is built by the app, but the endpoint is open, and
     a hand-made post could otherwise choose the formula that lands in the
     coordinator's spreadsheet. */
  var locCell = "";
  if (c.loc) {
    var coords = String(c.loc).replace(/\s/g, "");
    locCell = /^-?\d{1,3}\.\d+,-?\d{1,3}\.\d+$/.test(coords)
      ? '=HYPERLINK("https://maps.google.com/?q=' + coords + '","' + coords + '")'
      : safeText(c.loc);
  }

  checks.appendRow([
    new Date(), c.id, safeText(c.date), safeText(c.time), safeText(c.vehicle),
    safeText(c.reg), safeText(c.driver), safeText(c.role),
    c.miles || "", safeText(c.milesFlag), outcome,
    (c.checked || "") + "/" + (c.total || ""),
    (c.defects || []).length, safeText(defectText), safeText(c.renewals),
    safeText(c.sign), safeText((c.na || []).join(", ")),
    safeText(c.kind || "Pre-drive"),
    locCell,
    c.locAcc === 0 || c.locAcc ? c.locAcc : "",
    c.locDist === 0 || c.locDist ? c.locDist : "",
    safeText(c.locNote), safeText(c.fuel), safeText((c.jobs || []).join(", ")),
    pinWords(c)
  ]);

  // One row per defect as well, so the coordinator can filter and chase them.
  if ((c.defects || []).length) {
    var defs = sheet(ss, DEFECTS_SHEET, [
      "Received", "Check ID", "Date", "Registration", "Driver",
      "Item", "Critical", "What the driver found", "Status", "Action taken", "Closed on"
    ]);
    c.defects.forEach(function (d) {
      defs.appendRow([
        new Date(), c.id, safeText(c.date), safeText(c.reg), safeText(c.driver),
        safeText(d.name), d.crit ? "YES" : "", safeText(d.note), "Open", "", ""
      ]);
      applyStatusDropdown(defs, defs.getLastRow());
    });
  }

  /* Also when the bus is fine but wants something doing.

     This used to send only when there was a defect, and the arrange list was
     not in the email at all, so "needs fuel" and "tyres need air" on an
     otherwise clean check reached nobody until the weekly summary, days
     later. Those are the two things most worth knowing before the next run,
     and they are the ordinary jobs a driver will not ring anybody about. */
  var wantsSomething = (c.jobs || []).length > 0;
  if (COORDINATOR_EMAIL && (c.level !== "ok" || wantsSomething)) {
    notifyCheck(c, outcome, defectText);
  }

  return reply({ ok: true });
}

/**
 * What the record says about the PIN, and only when it says anything.
 *
 * Blank when no PIN was asked for, which is most rows and always was.
 * Verified when the sheet itself checked it. The third case is the one worth
 * having: the phone had never seen that driver and had no signal to ask, so
 * it let him through on purpose. A driver locked out at the kerb does not go
 * and do the check another way, he drives with nothing recorded at all.
 * Written down beats blocked, and this is where it is written down.
 */
function pinWords(c) {
  var s = String((c && c.pinState) || "");
  return s === "ok" ? "Verified"
       : s === "offline" ? "Not verified (no signal)"
       : "";
}

/* ---- structure checks, at most once an hour ----------------------------

   ensureRotaSheets and ensureChecksColumns exist for a handful of moments in
   this app's life: the day a tab is missing, or the day a new version adds a
   column. They were running on live requests, so every driver opening the
   rota waited while the spreadsheet was inspected first, and every check that
   landed paid for a column audit before it was written.

   One flag in the cache now. The first request in an hour does the work and
   the rest walk past it. Three things make that safe. If the cache is ever
   dropped, the only cost is the work happening once more than it needed to.
   If the work throws, the flag is never set, so a genuinely broken sheet is
   repaired on the next request rather than left for an hour. And the flag
   carries STRUCT_VERSION, so the day you add a column here you bump that and
   every script instance rechecks at once instead of waiting the hour out. */
/* Bumped when a column is added anywhere below, so every running instance
   rechecks its sheet at once instead of waiting the hour out.
   2: Reg on Trip Events. */
var STRUCT_VERSION = "2";

function structKey(tag) { return "struct_" + STRUCT_VERSION + "_" + tag; }

function structFresh(tag) {
  try { return !!CacheService.getScriptCache().get(structKey(tag)); }
  catch (err) { return false; }
}

function structDone(tag) {
  try { CacheService.getScriptCache().put(structKey(tag), "1", 3600); }
  catch (err) { /* it will simply be checked again */ }
}

/* Forget the flags, so the next call checks for real.

   A menu item is the moment somebody has decided the sheet needs looking at,
   and it must never be answered with "checked that within the hour". A
   coordinator running Set up everything because a tab has gone missing should
   not be quietly skipped because a driver's phone set a flag at nine o'clock. */
function structReset() {
  try {
    stopsMemo = null;
    CacheService.getScriptCache().removeAll([structKey("rota"), structKey("checks"),
                                            structKey("trip"), STOPS_CACHE_KEY]);
  } catch (err) { /* nothing to do: the flags expire by themselves */ }
}

/**
 * Adds any column this version writes that an older sheet does not have yet.
 * Only ever appends on the right, so every existing row keeps its meaning and
 * nothing already recorded moves.
 */
function ensureChecksColumns(sh) {
  if (structFresh("checks")) return;

  /* Older sheets carry these in metres. Rename in place rather than adding a
     second column for the same measurement. Anything recorded before the
     change is still in metres, so treat early rows with that in mind. */
  var RENAMED = { "Accuracy (m)": "Accuracy (yd)",
                  "Distance from base (m)": "Distance from base (yd)" };

  var want = ["Not applicable", "Check type", "Where checked",
              "Accuracy (yd)", "Distance from base (yd)", "Location note",
              "Fuel", "To arrange", "PIN check"];
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return;
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h || "").trim();
  });
  head.forEach(function (name, i) {
    if (RENAMED[name]) {
      sh.getRange(1, i + 1).setValue(RENAMED[name]);
      head[i] = RENAMED[name];
    }
  });
  want.forEach(function (name) {
    if (head.indexOf(name) !== -1) return;
    lastCol++;
    sh.getRange(1, lastCol).setValue(name).setFontWeight("bold");
    head.push(name);
  });

  structDone("checks");
}

/**
 * When a check row actually happened, in ms, for sorting.
 *
 * Received is stamped by the server the instant a check arrives, so it is the
 * right answer whenever it is present and sane. Two cases where it is not.
 *
 * A Received in the FUTURE is always wrong, because the server cannot have
 * received something that has not been sent. One row on the Checks tab was
 * carrying 8/9/2026 where the script had written 09/08/2026, almost certainly
 * typed or pasted by hand: in a UK sheet that reads as 8 September, four weeks
 * ahead, so that row won every comparison and went on winning. The mileage
 * shown to drivers stayed frozen on it while newer checks were ignored.
 *
 * A Received that is MISSING scored zero, which lost to everything, so a row
 * added by hand sank to the bottom regardless of when the check was really
 * done.
 *
 * Both fall back to the row's own Date and Time, which is the driver's record
 * of when he did it and is what a human would read the row by anyway.
 *
 * The tolerance is a couple of minutes rather than nothing, so ordinary clock
 * drift between the sheet and the script never trips it.
 */
function checkMoment(received, dateCell, timeCell) {
  var now = Date.now();
  if (isDateLike(received)) {
    var t = received.getTime();
    if (t <= now + 120000) return t;      /* sane: use it */
  }

  /* Fall back to the day and time the check itself records. */
  var key = anyToKey(dateCell);
  if (!key) return 0;
  var d = keyToDate(key);

  var hh = 0, mm = 0;
  if (isDateLike(timeCell)) {
    hh = timeCell.getHours(); mm = timeCell.getMinutes();
  } else {
    var m = String(timeCell || "").match(/^(\d{1,2}):(\d{2})/);
    if (m) { hh = Number(m[1]); mm = Number(m[2]); }
  }
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

/* How far back the mileage reader looks. Rows, not weeks, because rows are
   what cost time to fetch. */
var MILEAGE_SCAN_ROWS = 400;

function lastMileagePayload() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CHECKS_SHEET);
  if (!sh || sh.getLastRow() < 2) return { ok: true, last: {} };

  /* Only the recent end of the tab.

     This wants one number per bus, the newest, and it used to fetch every row
     ever written to find it. A few hundred rows today and nobody notices; a
     thousand by Christmas, more every week after that, and the app quietly
     gets heavier for the rest of its life with nothing on screen to say why.

     Two buses at roughly two checks a week is a hundred rows a year, so the
     window below holds about four years. A bus would have to go unchecked for
     longer than that before its last reading fell off the end, and a bus
     unchecked for four years has a bigger problem than a stale odometer. */
  // Columns: 1 Received, 2 Check ID, 3 Date, 4 Time, 5 Vehicle,
  //          6 Registration, 7 Driver, 8 Role, 9 Mileage ...
  var lastRow  = sh.getLastRow();
  var firstRow = Math.max(2, lastRow - MILEAGE_SCAN_ROWS + 1);
  var rows = sh.getRange(firstRow, 1, lastRow - firstRow + 1, 9).getValues();
  var last = {};

  rows.forEach(function (r) {
    var reg = String(r[5] || "").trim();
    var miles = Number(r[8]);
    if (!reg || !miles) return;
    /* See checkMoment: Received is used when it is present and not in the
       future, and the row's own Date and Time carry it otherwise. */
    var when = checkMoment(r[0], r[2], r[3]);
    if (!last[reg] || when >= last[reg]._t) {
      last[reg] = { miles: miles, date: dayWords(r[2]), time: timeWords(r[3]),
                    driver: String(r[6] || ""), _t: when };
    }
  });

  Object.keys(last).forEach(function (k) { delete last[k]._t; });
  return { ok: true, last: last };
}

/* ---- rota: reading ----------------------------------------------------- */

/**
 * Everything the app needs to draw the rota for a window of Sundays.
 *
 * Rows already written in the Rota tab always win. Sundays inside the window
 * that have never been written down are worked out from the pattern, so the
 * app can scroll years ahead without this sheet holding thousands of rows.
 * An override you set for 2029 still comes back, because every written row
 * inside the window is returned whether or not it is inside the filled range.
 */
function rotaPayload(fromKey, weeks) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  /* Reads used to run the full maintenance pass every time: re-reading the
     driver register, re-reading every rota row, and occasionally rewriting
     every dropdown across 3000 rows. That is what made the app feel slow.
     The pass now belongs to nightlyMaintenance on a 3am timer, and the call
     below is only a safety net for when that timer is missing or has
     stopped. On a healthy installation it returns immediately. */
  ensureRotaSheets(ss);

  var props = PropertiesService.getScriptProperties();
  maintainIfDue(ss, props);

  var from = sundayOf(fromKey ? keyToDate(fromKey) : new Date());
  if (weeks < 1) weeks = 1;
  if (weeks > 520) weeks = 520;                 // ten years is plenty per call
  var to = addWeeks(from, weeks);

  /* A rota that has not changed does not need building twice. The version
     number is bumped whenever anything is written, so an edit in the sheet
     normally shows up on the next read rather than waiting for a timer.

     That bump happens inside a simple onEdit trigger, which runs with
     restricted permissions and may not be allowed to write a script
     property. If it fails, this copy is what a driver sees until it ages
     out. Sixty seconds is the worst case, and it comfortably absorbs seven
     drivers opening the app at the same time on a Sunday morning. */
  var version = props.getProperty("rotaVersion") || "1";
  var cacheKey = "rota_" + version + "_" + dateToKey(from) + "_" + weeks;
  var cache = CacheService.getScriptCache();
  var hit = cache.get(cacheKey);
  if (hit) {
    try { return JSON.parse(hit); } catch (err) { /* rebuild below */ }
  }

  var drivers = readDrivers(ss);
  var pattern = { north: primaryPattern(drivers, "North"),
                  south: primaryPattern(drivers, "South") };
  var requests = readLatestRequests(ss);
  var stops = readBusStops(ss);
  var written = readRotaRows(ss);

  var rows = [];
  var seen = {};

  written.forEach(function (r) {
    var d = keyToDate(r.date);
    if (d < from || d > to) return;
    seen[r.date] = true;
    rows.push(decorate(r, requests));
  });

  // Fill the gaps from the pattern so the app never shows a hole.
  for (var d = new Date(from); d <= to; d = addWeeks(d, 1)) {
    var key = dateToKey(d);
    if (seen[key]) continue;
    rows.push(decorate({
      date: key, primary: patternDriver(d, pattern.north), actual: "",
      status: "Confirmed",
      primary2: southDriver(d, pattern.south), actual2: "", notes: ""
    }, requests));
  }

  rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

  var payload = {
    ok: true,
    from: dateToKey(from),
    weeks: weeks,
    pattern: pattern,
    /* hasPin, never the fingerprint.

       This used to send pinHash(name, pin) for every driver. doGet takes no
       token, and the /exec address is in config.js on a public web host, so
       the whole set could be read by anybody who looked. Four digits salted
       with a name that is sitting in the same payload is seconds of work for
       a computer, which made the gate open to anyone who thought to try.

       The app only ever needed to know WHETHER to ask a man for a PIN.
       Whether the one he typed is right is answered by the POST below, and
       the fingerprint never leaves this project. */
    drivers: drivers.filter(function (d) { return d.active; })
                     .map(function (d) {
                       return { name: d.name, role: d.role, hasPin: !!d.pin };
                     }),
    /* So the next driver sees what the last one reported and still open. */
    openDefects: openDefectsByReg(ss),
    /* The Sunday timetable. Sent with the rota because that is when a driver
       looks, and because a new driver learning a route needs it in front of
       him rather than in a WhatsApp message from three weeks ago. */
    stops: stops,
    /* Seats booked at each stop for the coming Sunday, so the driver sees
       who is waiting where. Counts only: this carries no names. */
    stopCounts: bookingCounts(ss, dateToKey(sundayOf(new Date()))),
    stopCountsFor: dateToKey(sundayOf(new Date())),
    rows: rows
  };

  try { cache.put(cacheKey, JSON.stringify(payload), 60); } catch (err) { /* too big, no matter */ }
  return payload;
}

/** Makes sure the tabs exist. Cheap: no reading, no writing, no formatting. */
function ensureRotaSheets(ss) {
  if (structFresh("rota")) return;

  sheet(ss, ROTA_SHEET, ROTA_HEADERS);
  var drivers = sheet(ss, DRIVERS_SHEET, DRIVERS_HEADERS);
  sheet(ss, REQUESTS_SHEET, [
    "Received", "Request ID", "Sunday", "Driver", "Type", "Reason",
    "Swap with", "Status", "Decided on", "Replacement assigned",
    "Their Sunday", "Both agreed"
  ]);

  /* Seed the register here rather than only in setUpEverything. Whichever
     path reaches the sheet first must leave it usable: an empty Drivers tab
     means no dropdowns and no pattern to fill the rota from. */
  /* Route included. This used to seed six columns and leave Route empty, and
     blank counts as North, so every ordered driver collapsed into a single
     seven-name North pattern and the North rota ran through the South
     drivers. ensureDrivers had it right and this did not, and either of them
     can be the first to reach an empty tab. */
  if (drivers.getLastRow() < 2) {
    SEED_DRIVERS.forEach(function (d) {
      drivers.appendRow([d.name, d.role, "YES", d.order, "", "", d.route]);
    });
  }

  structDone("rota");
}

/**
 * Rolls the filled horizon forward.
 *
 * This is the expensive pass: it re-reads the register, adds any missing
 * Sundays, and rewrites every dropdown across 3000 rows. It used to run here,
 * in the middle of a driver's rota request, roughly once a week when the
 * horizon rolled forward. That put a multi-second wait on one unlucky person,
 * and Sunday morning is exactly when it landed.
 *
 * It now belongs to nightlyMaintenance, on a timer at 3am. This function is
 * only the safety net. It does nothing while the nightly job is healthy, and
 * takes over if the job was never installed (permission refused at setup) or
 * has stopped running for three days.
 */
function maintainIfDue(ss, props) {
  try {
    var nightlyOn = props.getProperty("nightlyMaintenanceOn") === "1";
    if (nightlyOn) {
      var ran = Number(props.getProperty("nightlyRanAt") || 0);
      /* Three days, not one. A single missed night is normal: Google moves
         timed triggers around and can skip one entirely. Three consecutive
         misses means it has actually stopped, and a rota that stops growing
         is worse than one slow read. */
      if (Date.now() - ran < 3 * 86400000) return;
    }

    var last = Number(props.getProperty("rotaFilledAt") || 0);
    if (Date.now() - last < 86400000) return;
    fillRotaAhead(ss);
    /* Stamped only after it worked. Stamping first meant one silent failure
       switched the fill off for a whole day, and the stamp outlives every
       redeploy, so the Rota tab stayed empty and nothing said why. */
    props.setProperty("rotaFilledAt", String(Date.now()));
  } catch (err) { /* a slow tidy-up must never break a read */ }
}

/**
 * The nightly tidy-up, run by a timer at 3am. Everything slow lives here so
 * that nothing slow lives in front of a driver.
 */
function nightlyMaintenance() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  /* The nightly pass is the one that is supposed to find a broken sheet, so
     it does the real check rather than trusting the hour's flag. */
  structReset();
  ensureRotaSheets(ss);
  fillRotaAhead(ss);

  /* Reading it is what expires it. Belt and braces: the apps call it often
     enough on any normal day, but a week with nobody opening anything should
     not leave a rehearsal standing. */
  try {
    var wasOn = !!rehearsalOn();
    /* Nothing running, so any seeded booking still on the tab is a leftover
       from one that timed out. Safe here: no booking is being written. */
    if (!wasOn) rehearsalDropSeeds(ss);
  } catch (err) {}

  /* The heartbeat is what maintainIfDue watches. Written last, so a run that
     failed halfway does not claim to have succeeded. */
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty("nightlyRanAt", String(Date.now()));
    props.setProperty("rotaFilledAt", String(Date.now()));
  } catch (err) {}
}

function installNightlyMaintenance() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "nightlyMaintenance") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("nightlyMaintenance").timeBased().everyDays(1).atHour(3).create();

  /* Only set once the trigger genuinely exists. maintainIfDue stands down on
     the strength of this flag, so a flag without a trigger would leave the
     rota with nobody filling it at all. */
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty("nightlyMaintenanceOn", "1");
    if (!props.getProperty("nightlyRanAt")) {
      props.setProperty("nightlyRanAt", String(Date.now()));
    }
  } catch (err) {}
}

/**
 * Call after anything is written. Bumping the number makes every cached
 * copy unreachable at once, so the next read rebuilds from the sheet.
 */
function bumpRotaVersion() {
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty("rotaVersion", String(Number(props.getProperty("rotaVersion") || 1) + 1));
  } catch (err) {}
}

/**
 * Pulls swap pairings out of a Notes cell.
 *
 * applySwap writes "Swapped: Bro Moses in for Bro Tunde (with 2026-09-06)".
 * This reads them back so a card can say "Swapped with Bro Moses" under the
 * right name. Anything else in Notes is left alone.
 */
/**
 * Whether a Sunday is protected, and why.
 *
 * Written by the coordinator in the Notes column as
 *   PROTECTED: first South run, Tunde leads
 * The reason after the colon is optional but worth writing, because it is
 * shown to a driver who tries to swap and would otherwise just be refused.
 *
 * Protection stops SWAPS, not covers. A swap is a convenience and can wait.
 * A cover is somebody saying they cannot come, and refusing that could leave
 * a bus with nobody to drive it on the very Sunday being protected. Covers
 * go through and arrive flagged instead.
 */
function parseProtected(notes) {
  var lines = String(notes || "").split("\n");
  for (var i = 0; i < lines.length; i++) {
    var m = /^PROTECTED\s*:?\s*(.*)$/i.exec(lines[i].trim());
    if (m) return { on: true, reason: m[1].trim() };
  }
  return { on: false, reason: "" };
}

function parseSwaps(notes) {
  var out = [];
  String(notes || "").split("\n").forEach(function (line) {
    var m = /^Swapped:\s*(.+?)\s+in for\s+(.+?)\s*\(with\s+([0-9-]+)\)\s*$/.exec(line.trim());
    if (m) out.push({ a: m[1].trim(), b: m[2].trim(), other: m[3] });
  });
  return out;
}

function decorate(r, requests) {
  var out = {
    date: r.date,
    primary: r.primary || "",
    actual: r.actual || r.primary || "",
    status: r.status || "Confirmed",
    primary2: r.primary2 || "",
    actual2: r.actual2 || "",
    notes: r.notes || "",
    /* Read back off the Notes column rather than kept in a separate list.
       One place holds the fact, so the sheet and the app cannot disagree,
       and a coordinator editing Notes by hand sees exactly what the app
       sees. */
    swaps: parseSwaps(r.notes),

    /* Sent to the app so the swap picker can leave protected Sundays out
       and say why, rather than offering something that will be refused. */
    locked: parseProtected(r.notes).on,
    lockNote: parseProtected(r.notes).reason
  };
  if (!out.primary && !out.actual) out.status = "No driver assigned";
  /* requests is the whole list for that Sunday. request stays as the first
     one purely so an older copy of the app, cached on somebody's phone
     before this went out, still shows something sensible rather than
     nothing at all. */
  var reqs = requests[r.date];
  if (reqs && reqs.length) { out.requests = reqs; out.request = reqs[0]; }
  return out;
}

/**
 * The repeating running order for one route.
 *
 * route is "North" or "South". Each route keeps its own numbering, so both
 * start at 1: North runs 1 to 4 and South runs 1 to 3. They are separate
 * cycles from the same anchor Sunday and are not intended to line up. Trying
 * to make a four and a three meet is what makes this look hard, and nothing
 * anywhere needs them to.
 */
function primaryPattern(drivers, route) {
  route = route || "North";
  var p = drivers.filter(function (d) { return d.active && d.order && d.route === route; })
                 .sort(function (a, b) { return a.order - b.order; })
                 .map(function (d) { return d.name; });
  if (p.length) return p;
  return SEED_DRIVERS.filter(function (d) { return d.order && (d.route || "North") === route; })
                     .sort(function (a, b) { return a.order - b.order; })
                     .map(function (d) { return d.name; });
}

/**
 * The South name for a Sunday, or blank before the route began.
 *
 * Blank matters. A name against a Sunday when no South bus ran would read
 * as a missed duty to anyone looking back through the rota later.
 */
function southDriver(d, pattern) {
  if (!pattern || !pattern.length) return "";
  if (d < keyToDate(PATTERN_ANCHOR_SOUTH)) return "";
  return patternDriver(d, pattern, PATTERN_ANCHOR_SOUTH);
}

/**
 * Which pair of Rota columns a named driver sits in on a given row.
 *
 * Decided by the row first, because who is actually written against that
 * Sunday beats any general rule about which route someone belongs to. Only
 * if the name is nowhere on the row does it fall back to their Route column,
 * and to North if even that is unset.
 */
function routeColumns(ss, rota, rRow, driver) {
  var NORTH = { scheduled: 2, cover: 3 };
  var SOUTH = { scheduled: 5, cover: 6 };
  var who = String(driver || "").trim();
  if (!who) return NORTH;

  try {
    var vals = rota.getRange(rRow, 1, 1, 6).getValues()[0];
    if (String(vals[4] || "").trim() === who || String(vals[5] || "").trim() === who) return SOUTH;
    if (String(vals[1] || "").trim() === who || String(vals[2] || "").trim() === who) return NORTH;
  } catch (err) {}

  var found = null;
  readDrivers(ss).forEach(function (d) { if (d.name === who) found = d; });
  return (found && found.route === "South") ? SOUTH : NORTH;
}

/**
 * Exchanges two drivers between two Sundays.
 *
 * Returns "" on success, or a plain sentence saying why it did not happen.
 * Nothing is written unless BOTH sides can be written, because a half
 * applied swap leaves no trace of being half applied.
 *
 * The guards are checked here, at approval, and not only when the request
 * was sent. A request can sit for days, and a Sunday can pick up a cover in
 * between. Checking only at the point of asking would let a stale request
 * through.
 */
function applySwap(ss, rota, keyA, driverA, keyB, driverB) {
  if (keyA === keyB) return "Both halves of that swap are the same Sunday.";

  var rowA = findRotaRow(rota, keyA) || appendRotaRow(ss, rota, keyToDate(keyA));
  var rowB = findRotaRow(rota, keyB) || appendRotaRow(ss, rota, keyToDate(keyB));

  var a = rota.getRange(rowA, 1, 1, 6).getValues()[0];
  var b = rota.getRange(rowB, 1, 1, 6).getValues()[0];

  function slotOf(vals, who) {
    if (String(vals[1] || "").trim() === who) return { sched: 2, cover: 3, covering: false };
    if (String(vals[4] || "").trim() === who) return { sched: 5, cover: 6, covering: false };
    if (String(vals[2] || "").trim() === who) return { sched: 2, cover: 3, covering: true };
    if (String(vals[5] || "").trim() === who) return { sched: 5, cover: 6, covering: true };
    return null;
  }

  var sA = slotOf(a, driverA), sB = slotOf(b, driverB);
  if (!sA) return driverA + " is not on the rota for " + keyA + " any more, so there is nothing to swap.";
  if (!sB) return driverB + " is not on the rota for " + keyB + " any more, so there is nothing to swap.";

  /* A Sunday you are only covering is not yours to trade: it already has two
     people attached, and swapping would make three. Same reason a covered
     Sunday cannot be swapped into. */
  if (sA.covering) return driverA + " is only covering " + keyA + ", so that Sunday is not theirs to swap.";
  if (sB.covering) return driverB + " is only covering " + keyB + ", so that Sunday is not theirs to swap.";
  if (String(a[sA.cover - 1] || "").trim()) return keyA + " already has a cover on it. Clear that first, or handle this one by hand.";
  if (String(b[sB.cover - 1] || "").trim()) return keyB + " already has a cover on it. Clear that first, or handle this one by hand.";

  /* A protected Sunday is not available to trade. Checked here as well as
     in the app, because the app can be an old cached copy and this is the
     only place that actually moves anybody. */
  var pA = parseProtected(String(rota.getRange(rowA, 7).getValue() || ""));
  var pB = parseProtected(String(rota.getRange(rowB, 7).getValue() || ""));
  if (pA.on) return keyA + " is a protected Sunday" + (pA.reason ? " (" + pA.reason + ")" : "") + ", so it cannot be swapped.";
  if (pB.on) return keyB + " is a protected Sunday" + (pB.reason ? " (" + pB.reason + ")" : "") + ", so it cannot be swapped.";

  /* Nobody can drive both routes on the same morning. If the incoming driver
     is already down for the other route that Sunday, the swap would put one
     person behind two wheels at once, and the rota would look perfectly
     normal while being impossible. */
  if (slotOf(a, driverB)) return driverB + " is already driving on " + keyA + ", so they cannot take that Sunday as well.";
  if (slotOf(b, driverA)) return driverA + " is already driving on " + keyB + ", so they cannot take that Sunday as well.";

  rota.getRange(rowA, sA.sched).setValue(driverB);
  rota.getRange(rowB, sB.sched).setValue(driverA);
  rota.getRange(rowA, 4).setValue("Confirmed");
  rota.getRange(rowB, 4).setValue("Confirmed");

  appendNote(rota, rowA, "Swapped: " + driverB + " in for " + driverA + " (with " + keyB + ")");
  appendNote(rota, rowB, "Swapped: " + driverA + " in for " + driverB + " (with " + keyA + ")");
  stamp(rota, rowB, "Approved swap");

  notifyDutyChange(ss, keyA, driverA, driverB, sA.sched === 5 ? "South Liverpool" : "North Liverpool");
  notifyDutyChange(ss, keyB, driverB, driverA, sB.sched === 5 ? "South Liverpool" : "North Liverpool");
  return "";
}

/* Adds a line to the Notes column without wiping what is already there. */
function appendNote(sh, row, text) {
  var cell = sh.getRange(row, 7);
  var had = String(cell.getValue() || "").trim();
  cell.setValue(had ? had + "\n" + text : text);
}

/* Both routes at once, since almost every caller wants the pair. */
function bothPatterns(ss) {
  var drivers = readDrivers(ss);
  return { north: primaryPattern(drivers, "North"),
           south: primaryPattern(drivers, "South") };
}

/** Which driver the repeating pattern puts on a given Sunday. */
function patternDriver(d, pattern, anchorKey) {
  if (!pattern.length) return "";
  var anchor = keyToDate(anchorKey || PATTERN_ANCHOR);
  var weeks = Math.round((d.getTime() - anchor.getTime()) / 604800000);
  var n = pattern.length;
  return pattern[((weeks % n) + n) % n];
}

function readRotaRows(ss) {
  var sh = ss.getSheetByName(ROTA_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
  var out = [];
  values.forEach(function (r) {
    var key = anyToKey(r[0]);
    if (!key) return;
    out.push({
      date: key,
      primary: String(r[1] || "").trim(),
      actual: String(r[2] || "").trim(),
      status: String(r[3] || "").trim(),
      primary2: String(r[4] || "").trim(),
      actual2: String(r[5] || "").trim(),
      notes: String(r[6] || "").trim()
    });
  });
  return out;
}

/** The newest request per Sunday, so the app can show "change requested". */
/**
 * The latest request per driver per Sunday.
 *
 * This used to keep one request per Sunday, which was right when a Sunday
 * had one driver. With two routes a Sunday has two, and they can each ask
 * for something independently. Keeping one meant whichever row was read
 * last won, so a South driver's request could appear on the card under the
 * North driver's name, and the card said "Asked by" somebody who had asked
 * for nothing. Worse, it silently used up the other driver's one ask.
 *
 * Now a list per Sunday. Later rows still replace earlier ones FOR THE SAME
 * PERSON, so a driver who asks twice still shows only their latest.
 */
function readLatestRequests(ss) {
  var sh = ss.getSheetByName(REQUESTS_SHEET);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues();
  values.forEach(function (r) {
    var key = anyToKey(r[2]);
    if (!key) return;
    var one = {
      driver: String(r[3] || "").trim(),
      type: String(r[4] || "").trim(),
      status: String(r[7] || "Pending").trim()
    };
    if (!out[key]) out[key] = [];
    var at = -1;
    for (var i = 0; i < out[key].length; i++) {
      if (out[key][i].driver === one.driver) { at = i; break; }
    }
    if (at === -1) out[key].push(one); else out[key][at] = one;
  });
  return out;
}

function readDrivers(ss) {
  var sh = ss.getSheetByName(DRIVERS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  /* Eight columns, not seven, and the eighth is the whole point of the change.
     Phone is column H and this used to fetch as far as G, so r[7] below was
     always undefined and every driver read back with no number. Nothing said
     so: driverOnDuty simply found nobody with a phone and returned null, which
     is exactly what it returns when the column is genuinely empty. Filling the
     column in would have done nothing at all, and the note on the heading tells
     you it will work.

     If a column is ever added here, this number moves with it.

     Clamped to the grid, the same way tripState reads Trip Events. A sheet
     trimmed down to seven columns would otherwise throw on a request for eight,
     and it would throw inside readDrivers, which nearly everything calls. A
     short row leaves phone undefined, which reads as blank, which is the
     truth. */
  var width = Math.min(DRIVERS_HEADERS.length, sh.getMaxColumns());
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();
  var out = [];
  values.forEach(function (r) {
    var name = String(r[0] || "").trim();
    if (!name) return;
    out.push({
      name: name,
      role: String(r[1] || "").trim(),
      active: yes(r[2]),
      order: Number(r[3]) || 0,
      pin: String(r[4] || "").replace(/\D/g, ""),
      email: String(r[5] || "").trim(),
      /* Blank counts as North. The route column did not exist until the South
         run started, so every row written before then is a North row, and
         reading blank as North means nobody has to go back and fill it in. */
      route: (String(r[6] || "").trim().toUpperCase().charAt(0) === "S") ? "South" : "North",
      /* Set in the sheet, never in a file, exactly as the PIN is. A driver
         with no number simply has no WhatsApp button on the passenger page,
         so leaving this blank is a working answer rather than a fault. */
      phone: String(r[7] || "").trim()
    });
  });
  return out;
}

/**
 * A one-way fingerprint of a PIN. Salted with the name, so two people who
 * happen to pick the same four digits do not produce the same fingerprint.
 *
 * Both sides of the comparison in handlePinCheck are made here, so the two
 * are never compared as plain digits and nothing that resembles a PIN is
 * held in a variable any longer than it takes to hash it.
 */
function pinHash(name, pin) {
  if (!pin) return "";
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
                                    name + ":" + pin, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ("0" + (b & 0xFF).toString(16)).slice(-2); }).join("");
}

/* ---- checking a PIN -----------------------------------------------------

   The phone sends a name and four digits and is told yes or no. Nothing
   about the PIN goes back, and no fingerprint is published with the rota any
   more, which is what lets the endpoint stay open and the PIN still mean
   something.

   Ten wrong tries in ten minutes and that name pauses for ten minutes.
   Guessing here is the only attack left once the fingerprints stop being
   handed out, and ten thousand combinations at one round trip each is slow
   rather than impossible. Held per NAME, because the device is whatever the
   guesser says it is.

   Counted in the cache rather than in a script property, deliberately. It
   expires by itself and costs nothing to write, and if the cache is ever
   dropped the worst case is that a guesser gets their ten tries back. A
   lockout that outlived a real driver's fumble would be the worse failure:
   he is standing at a bus with people waiting to get on it. */
var PIN_MAX_TRIES = 10;
var PIN_LOCK_MINUTES = 10;

function pinTriesKey(name) {
  return "pinfail_" + String(name || "").replace(/[^A-Za-z0-9]/g, "").substring(0, 40);
}

function handlePinCheck(p) {
  var name = String((p && p.driver) || "").trim();
  var pin  = String((p && p.pin) || "").replace(/\D/g, "");
  if (!name) return reply({ ok: false, error: "no driver" });

  var cache = CacheService.getScriptCache();
  var key = pinTriesKey(name);
  var tries = 0;
  try { tries = Number(cache.get(key)) || 0; } catch (err) { tries = 0; }

  if (tries >= PIN_MAX_TRIES) {
    return reply({ ok: true, valid: false, locked: true, minutes: PIN_LOCK_MINUTES });
  }

  var found = null;
  readDrivers(SpreadsheetApp.getActiveSpreadsheet()).forEach(function (d) {
    if (d.name === name) found = d;
  });

  /* No PIN against that name is not a failure. It is how somebody without
     one gets in, exactly as before. */
  if (!found || !found.pin) return reply({ ok: true, valid: true, noPin: true });

  if (pin && pinHash(name, pin) === pinHash(name, found.pin)) {
    try { cache.remove(key); } catch (err) {}
    return reply({ ok: true, valid: true });
  }

  try { cache.put(key, String(tries + 1), PIN_LOCK_MINUTES * 60); } catch (err) {}
  return reply({ ok: true, valid: false, left: Math.max(0, PIN_MAX_TRIES - tries - 1) });
}

function yes(v) {
  if (v === true) return true;
  var s = String(v || "").trim().toUpperCase();
  return s === "YES" || s === "Y" || s === "TRUE" || s === "1";
}

/* ---- rota: driver requests --------------------------------------------- */

function handleRotaRequest(rq) {
  if (!rq || !rq.date || !rq.driver) {
    return reply({ ok: false, error: "incomplete request" });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  /* Tabs only. The driver is standing there waiting for this to come back,
     so the horizon-filling and dropdown pass stays out of the way. */
  ensureRotaSheets(ss);

  var sh = sheet(ss, REQUESTS_SHEET, [
    "Received", "Request ID", "Sunday", "Driver", "Type", "Reason",
    "Swap with", "Status", "Decided on", "Replacement assigned",
    "Their Sunday", "Both agreed"
  ]);

  if (alreadyHaveRequest(sh, rq.id)) {
    return reply({ ok: true, duplicate: true });
  }

  var sunday = keyToDate(rq.date);
  if (sunday < sundayOf(new Date())) {
    return reply({ ok: false, error: "that Sunday has already passed" });
  }

  /* safeText for the same reason as on a check: the reason box is free text
     from a phone, and the token that guards this endpoint is in config.js on
     a public host. Nothing here should be able to arrive as a formula. */
  sh.appendRow([
    new Date(), safeText(rq.id), sunday, safeText(rq.driver), safeText(rq.type),
    safeText(rq.reason), safeText(rq.swapWith), "Pending", "", "",
    rq.swapDate ? keyToDate(rq.swapDate) : "", rq.agreed ? "YES" : ""
  ]);
  var row = sh.getLastRow();
  sh.getRange(row, 3).setNumberFormat("dd/mm/yyyy");
  applyRequestValidation(sh, row);

  // Flag it on the official rota so the Sunday visibly needs attention, but
  // do NOT change the driver. Only the coordinator does that.
  markRotaStatus(ss, rq.date, "Change requested");

  bumpRotaVersion();
  if (COORDINATOR_EMAIL) notifyRotaRequest(rq, sunday);

  return reply({ ok: true });
}

function alreadyHaveRequest(sh, id) {
  if (!id) return false;
  var last = sh.getLastRow();
  if (last < 2) return false;
  var ids = sh.getRange(2, 2, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return true;
  }
  return false;
}

/** Writes a status onto a Sunday, creating the row if it is not there yet. */
function markRotaStatus(ss, key, status) {
  var sh = ss.getSheetByName(ROTA_SHEET);
  if (!sh) return;
  var row = findRotaRow(sh, key);
  if (!row) row = appendRotaRow(ss, sh, keyToDate(key));
  sh.getRange(row, 4).setValue(status);
  stamp(sh, row, "App");
}

function findRotaRow(sh, key) {
  if (sh.getLastRow() < 2) return 0;
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (anyToKey(values[i][0]) === key) return i + 2;
  }
  return 0;
}

function appendRotaRow(ss, sh, d) {
  var pattern = bothPatterns(ss);
  sh.appendRow([d, patternDriver(d, pattern.north), "", "Confirmed",
                southDriver(d, pattern.south), "", "", "", ""]);
  var row = sh.getLastRow();
  sh.getRange(row, 1).setNumberFormat("dd/mm/yyyy");
  applyRotaValidation(sh, row);
  return row;
}

function stamp(sh, row, who) {
  sh.getRange(row, 8).setValue(new Date()).setNumberFormat("dd/mm/yyyy hh:mm");
  sh.getRange(row, 9).setValue(who || "Coordinator");
}

/* ---- rota: setup and maintenance --------------------------------------- */

/** Run this once by hand after pasting the script in. Safe to run again. */
/* The Drivers tab is read by position, not by header name: column 5 is the
   PIN, column 6 is the email, and so on. That is fine until somebody inserts
   a column in the middle years from now. Nothing would break loudly. Duty
   reminders would simply stop going out, because the script would be reading
   an empty column where the addresses used to be, and no message would say
   so. This is the smoke alarm. It changes nothing and repairs nothing: it
   only tells a human that the shape has drifted. */
var DRIVERS_HEADERS = ["Name", "Role", "Active", "Primary order", "PIN", "Email", "Route", "Phone"];

/* Two time columns on purpose. Logged is when the sheet received it, Happened
   is when the driver's phone recorded the tap. They differ whenever there was
   no signal, and keeping both is the only way to tell a late tap from a late
   bus. There is no event id column: one live row per trip, stop and event is
   already unique, so a retry has nothing to duplicate. */
/* Reg is on the END, not next to Route where it reads better, because this
   sheet is read by column position in three places and every row already
   written would change meaning if anything moved. Appending on the right is
   the same rule ensureChecksColumns follows, and for the same reason. */
var TRIP_HEADERS = ["Logged", "Trip", "Sunday", "Route", "Driver", "Event",
                    "Stop ID", "Stop", "Scheduled", "Happened", "Offset", "Status",
                    "Reg"];

function driversHeaderWarning(ss) {
  try {
    var sh = ss.getSheetByName(DRIVERS_SHEET);
    if (!sh) return "";
    var got = sh.getRange(1, 1, 1, DRIVERS_HEADERS.length).getValues()[0]
                .map(function (v) { return String(v || "").trim(); });
    var wrong = [];
    DRIVERS_HEADERS.forEach(function (want, i) {
      if (got[i].toLowerCase() !== want.toLowerCase()) {
        wrong.push("column " + String.fromCharCode(65 + i) + " should be \"" + want +
                   "\" but reads \"" + (got[i] || "(empty)") + "\"");
      }
    });
    if (!wrong.length) return "";
    return "The Drivers tab columns are not where the script expects:\n  " +
           wrong.join("\n  ") +
           "\n\nPut them back in this order and nothing else needs doing:\n  " +
           DRIVERS_HEADERS.join(" | ");
  } catch (err) { return ""; }
}

/**
 * Fills in Route for drivers we already know about, and only where the cell
 * is empty.
 *
 * Writing the heading without the values was a real fault, not a cosmetic
 * one. Blank counts as North, so every ordered driver collapsed into one
 * seven name North pattern and the North rota ran through the South drivers.
 * A heading with nothing under it is worse than no heading at all, because
 * everything downstream reads it as a deliberate answer.
 *
 * Anyone not in the built-in list is left blank on purpose. Guessing at a
 * name we do not recognise would be inventing a fact about a person.
 */
function backfillRoutes(sh) {
  var last = sh.getLastRow();
  if (last < 2) return 0;

  var known = {};
  SEED_DRIVERS.forEach(function (d) { if (d.route) known[d.name] = d.route; });

  var names  = sh.getRange(2, 1, last - 1, 1).getValues();
  var routes = sh.getRange(2, 7, last - 1, 1).getValues();
  var filled = 0;

  for (var i = 0; i < names.length; i++) {
    if (String(routes[i][0] || "").trim()) continue;      // already answered
    var r = known[String(names[i][0] || "").trim()];
    if (!r) continue;                                     // not ours to guess
    routes[i][0] = r;
    filled++;
  }
  if (filled) sh.getRange(2, 7, last - 1, 1).setValues(routes);
  return filled;
}

/**
 * Puts the scheduled names back where the pattern says they should be, for
 * Sundays still to come.
 *
 * Needed once, because rows were written while the Route column was empty
 * and the North pattern was running through all seven drivers.
 *
 * It will not touch a Sunday that anybody has already worked on: not the
 * past, not a row with a cover filled in, and not a row whose Status has
 * been moved off Confirmed. Those are decisions somebody made, and a repair
 * that quietly overwrites decisions is worse than the fault it fixes.
 */
function rebuildFutureRota() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  ensureDrivers(ss);                       // make sure Route is filled first
  var pattern = bothPatterns(ss);

  if (pattern.north.length !== 4 || !pattern.south.length) {
    ui.alert("Check the Drivers tab first.\n\n" +
             "North pattern: " + (pattern.north.join(", ") || "(empty)") + "\n" +
             "South pattern: " + (pattern.south.join(", ") || "(empty)") + "\n\n" +
             "If the North list is not the four North drivers, the Route column " +
             "is not filled in and rebuilding now would just write the same " +
             "wrong names back.");
    return;
  }

  var sh = ss.getSheetByName(ROTA_SHEET);
  if (!sh || sh.getLastRow() < 2) { ui.alert("No rota rows to rebuild."); return; }

  var n = sh.getLastRow() - 1;
  var vals = sh.getRange(2, 1, n, 6).getValues();
  var today = sundayOf(new Date());
  var changes = [], skipped = 0;

  for (var i = 0; i < n; i++) {
    var key = anyToKey(vals[i][0]);
    if (!key) continue;
    var d = keyToDate(key);
    if (d < today) continue;                                  // been and gone

    var status = String(vals[i][3] || "").trim();
    var hasCover = String(vals[i][2] || "").trim() || String(vals[i][5] || "").trim();
    if (hasCover || (status && status !== "Confirmed")) { skipped++; continue; }

    var wantN = patternDriver(d, pattern.north);
    var wantS = southDriver(d, pattern.south);
    if (String(vals[i][1] || "").trim() === wantN &&
        String(vals[i][4] || "").trim() === wantS) continue;   // already right

    changes.push({ row: i + 2, key: key,
                   fromN: String(vals[i][1] || "").trim(), toN: wantN,
                   fromS: String(vals[i][4] || "").trim(), toS: wantS });
  }

  if (!changes.length) {
    ui.alert("Nothing to rebuild. Every future Sunday already matches the pattern." +
             (skipped ? "\n\n" + skipped + " were left alone because they have a cover " +
                        "or a status you set by hand." : ""));
    return;
  }

  var preview = changes.slice(0, 8).map(function (c) {
    return "  " + c.key + "   " + (c.fromN || "(blank)") + " -> " + c.toN;
  }).join("\n");

  var answer = ui.alert(
    "Rebuild " + changes.length + " Sunday" + (changes.length === 1 ? "" : "s") + "?",
    preview + (changes.length > 8 ? "\n  ...and " + (changes.length - 8) + " more" : "") +
    (skipped ? "\n\n" + skipped + " Sundays will be left alone because they have a " +
               "cover or a status you set by hand." : "") +
    "\n\nThis cannot be undone from the menu.",
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;

  changes.forEach(function (c) {
    sh.getRange(c.row, 2).setValue(c.toN);
    sh.getRange(c.row, 5).setValue(c.toS);
    stamp(sh, c.row, "Pattern rebuild");
  });
  bumpRotaVersion();

  ui.alert(changes.length + " Sundays rebuilt." +
           (skipped ? "\n" + skipped + " left alone." : ""));
}

/**
 * Who has been carrying the load.
 *
 * The point of keeping covers and swaps as separate things was so this could
 * be answered. A cover leaves a debt: whoever said yes has driven an extra
 * Sunday and the person they covered has driven one fewer. A swap is even,
 * both drive the same number in the end. A rota can look perfectly tidy
 * while the same two or three people absorb every gap in it, and nothing on
 * the sheet says so.
 *
 * Counted over the last 26 Sundays that have actually happened. Future
 * Sundays are left out: nobody has driven them yet.
 */
function coverBalance() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var rows = readRotaRows(ss);
  if (!rows.length) { ui.alert("No rota rows yet."); return; }

  var today = sundayOf(new Date());
  var past = rows.filter(function (r) { return keyToDate(r.date) < today; })
                 .sort(function (a, b) { return a.date < b.date ? 1 : -1; })
                 .slice(0, 26);
  if (!past.length) {
    ui.alert("No Sundays have been and gone yet, so there is nothing to count.");
    return;
  }

  var t = {};
  function row(name) {
    if (!name) return null;
    if (!t[name]) t[name] = { drove: 0, gave: 0, got: 0, swapped: 0 };
    return t[name];
  }

  past.forEach(function (r) {
    [[r.primary, r.actual], [r.primary2, r.actual2]].forEach(function (pair) {
      var sched = String(pair[0] || "").trim();
      var cover = String(pair[1] || "").trim();
      if (!sched && !cover) return;

      var drove = cover || sched;
      var d = row(drove); if (d) d.drove++;

      if (cover && sched && cover !== sched) {
        var g = row(cover); if (g) g.gave++;
        var s2 = row(sched); if (s2) s2.got++;
      }
    });
    parseSwaps(r.notes).forEach(function (sw) {
      var a = row(sw.a); if (a) a.swapped++;
    });
  });

  var names = Object.keys(t).sort(function (a, b) { return t[b].drove - t[a].drove; });
  var lines = names.map(function (n) {
    var v = t[n];
    return n + "\n     drove " + v.drove +
           "   covered for others " + v.gave +
           "   was covered " + v.got +
           "   swaps " + v.swapped;
  });

  var owed = names.filter(function (n) { return t[n].gave - t[n].got >= 2; });
  var tail = owed.length
    ? "\n\nCarrying the most: " + owed.join(", ") +
      ".\nEach has covered at least two more Sundays than they have been covered."
    : "\n\nNobody is more than one cover out of step.";

  ui.alert("Last " + past.length + " Sundays\n\n" + lines.join("\n\n") + tail);
}

/* ---- protecting the sheet ------------------------------------------------

   Most of this spreadsheet is a record, not a control. Checks are what was
   inspected and signed. Requests are what a driver typed on their phone.
   Defect descriptions are what somebody found on a bus. None of it should be
   edited afterwards, and an accidental keystroke in any of it is silent: no
   error, no warning, just a changed record that nobody notices.

   IMPORTANT, so nobody is surprised by it: Google Sheets cannot lock the
   OWNER out of their own sheet. Strict protection stops other people and is
   invisible to you. What does work for the owner is warning protection: edit
   a locked cell and Sheets stops you with "you are trying to edit a
   protected cell". You can still go ahead deliberately. That is the point.
   The risk here is the accidental keystroke, not the considered decision.

   Left live, because they are edited as a matter of course:
     Rota            the two scheduled columns, the two cover columns,
                     Status and Notes
     Rota Requests   Status and Replacement assigned, which is the whole job
     Defects         Status, Action taken, Closed on
     Drivers         everything below the header, since the register grows

   Locked everywhere: the header row. That is where the quiet damage happens.
   Rename or shift a heading and things break without saying so, which is
   exactly what the empty Route column did.
*/
var LOCK_TAG = "Minibus lock";

function sheetLocks(ss) {
  var out = [];
  function add(name, ranges, note) {
    var sh = ss.getSheetByName(name);
    if (sh) out.push({ sh: sh, ranges: ranges(sh), note: note });
  }
  var last = function (sh) { return sh.getMaxRows(); };

  add(ROTA_SHEET, function (sh) {
    /* B to G: scheduled, cover, status, scheduled, cover, notes. The Sunday
       itself and the two Updated columns are the script's. */
    return [sh.getRange(2, 2, last(sh) - 1, 6)];
  }, "Rota: dates and the Updated columns are written by the app");

  add(REQUESTS_SHEET, function (sh) {
    return [sh.getRange(2, 8, last(sh) - 1, 1),      // Status
            sh.getRange(2, 10, last(sh) - 1, 1)];    // Replacement assigned
  }, "Requests: everything except Status and Replacement came from a driver's phone");

  add(DEFECTS_SHEET, function (sh) {
    return [sh.getRange(2, 9, last(sh) - 1, 3)];     // Status, Action taken, Closed on
  }, "Defects: what the driver reported is not editable");

  add(CHECKS_SHEET, function () { return []; },
      "Checks: a signed record of what was inspected");

  add(BOOKINGS_SHEET, function (sh) {
    /* Status only, so a booking can be struck out by hand if somebody rings
       you after the cut-off. Everything else came from a passenger's phone
       and editing it would put words in their mouth, the same reasoning as
       the Requests tab.

       The Device column matters most here. It is how somebody's own phone
       finds their booking to change it, so altering one silently detaches a
       person from the row they made. */
    return [sh.getRange(2, 8, last(sh) - 1, 1)];
  }, "Bus Bookings: written by passengers, only Status is yours");

  add(TRIP_SHEET, function () { return []; },
      "Trip Events: what a driver tapped, and when. Nothing here is yours to edit");

  add(STOPS_SHEET, function (sh) {
    /* Left live below the header. Times and stops do change, and this is the
       one place they should be changed. */
    return [sh.getRange(2, 1, last(sh) - 1, 7)];
  }, "Bus Stops: the header row is fixed, the timetable below it is yours");

  add(DRIVERS_SHEET, function (sh) {
    /* All eight columns, so Phone is editable like the rest of the register.
       This stopped at G, which left the one column a coordinator is most
       likely to be filling in for the first time as the only cell on the tab
       that argues back. */
    return [sh.getRange(2, 1, last(sh) - 1, DRIVERS_HEADERS.length)];
  }, "Drivers: the header row is fixed, the register below it is yours");

  return out;
}

function lockSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  applyLocks(ss);
  SpreadsheetApp.getUi().alert(
    "\u2713  The sheet is protected.\n\n" +
    "Editing anything the app writes now asks you to confirm first. You can " +
    "still go ahead when you mean to: this stops the accidental keystroke, " +
    "not you.\n\n" +
    "Still edited freely:\n" +
    "  Rota: drivers, covers, Status, Notes\n" +
    "  Rota Requests: Status and Replacement assigned\n" +
    "  Defects: Status, Action taken, Closed on\n" +
    "  Drivers: the whole register\n\n" +
    "Header rows are locked everywhere. Minibus \u203a Unlock the sheet " +
    "removes all of this if you ever need to work freely.");
}

function applyLocks(ss) {
  removeLocks(ss);
  sheetLocks(ss).forEach(function (item) {
    var p = item.sh.protect().setDescription(LOCK_TAG + ": " + item.note);
    if (item.ranges.length) p.setUnprotectedRanges(item.ranges);
    /* Warning, not refusal. See the note above: strict protection would be
       invisible to the owner and would lock out anyone you later share the
       sheet with, which is not what is wanted. */
    p.setWarningOnly(true);
  });
}

function removeLocks(ss) {
  ss.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) {
    if (String(p.getDescription() || "").indexOf(LOCK_TAG) === 0) p.remove();
  });
  ss.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (String(p.getDescription() || "").indexOf(LOCK_TAG) === 0) p.remove();
  });
}

function unlockSheet() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert("Unlock the sheet?",
    "Every cell becomes editable with no warning, including the Checks tab " +
    "and the header rows.\n\nRun Minibus \u203a Lock the sheet when you are " +
    "finished.", ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  removeLocks(SpreadsheetApp.getActiveSpreadsheet());
  ui.alert("Unlocked. Nothing will warn you now. Lock it again when you are done.");
}

function checkDriversTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var warn = driversHeaderWarning(ss);
  if (warn) { ui.alert(warn); return; }

  var drivers = readDrivers(ss);
  var active = drivers.filter(function (d) { return d.active; });
  var withEmail = active.filter(function (d) { return d.email; }).length;
  var withPin = active.filter(function (d) { return d.pin; }).length;

  ui.alert(
    "\u2713  Columns are in the right order.\n\n" +
    active.length + " active drivers.\n" +
    withEmail + " have an email address (needed for duty reminders).\n" +
    withPin + " have a PIN (the rest are not asked for one)."
  );
}

/* ---- one-off repair ---------------------------------------------------- */

/**
 * Puts right the Fuel column on checks recorded before the app started
 * writing "1/2 tank" instead of "1/2".
 *
 * A bare "1/2" written into a cell is not text to Google Sheets, it is the
 * 1st of February. "3/8" became the 3rd of August. Every fuel reading except
 * Full was quietly stored as a date, and the Sunday summary printed one.
 *
 * The damage is reversible because the reading survives inside the date:
 * Sheets took the first number as the day and the second as the month, so a
 * cell holding 1 February came from "1/2". Only seven values were ever
 * possible, and none of them can be read two ways, so there is no guessing.
 *
 * Safe to run twice. Rows already holding text are left alone.
 */
function repairFuelColumn() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var sh = ss.getSheetByName(CHECKS_SHEET);
  if (!sh || sh.getLastRow() < 2) { ui.alert("No checks recorded yet, so nothing to repair."); return; }

  var FUEL_COL = 23;
  var n = sh.getLastRow() - 1;
  var range = sh.getRange(2, FUEL_COL, n, 1);
  var vals = range.getValues();

  var fixed = 0, skipped = 0, unclear = [];

  for (var i = 0; i < n; i++) {
    var v = vals[i][0];
    if (v === "" || v === null) continue;
    /* Duck-typed rather than "instanceof Date". instanceof compares against
       one particular Date constructor, and a value that arrived from another
       context is a real date that fails the test. Getting this wrong here
       would mean the repair quietly reported nothing to fix. */
    var isDate = v && typeof v.getMonth === "function" && typeof v.getDate === "function";
    if (!isDate) { skipped++; continue; }

    var day = v.getDate();
    var month = v.getMonth() + 1;
    var num = 0, den = 0;

    /* Day/month is how a UK sheet reads it, month/day how a US one does.
       Both are checked, and they cannot both fit: one needs the numerator
       first and the other the denominator first. */
    if (month === 2 || month === 4 || month === 8) {
      if (day < month) { num = day; den = month; }
    }
    if (!den && (day === 2 || day === 4 || day === 8)) {
      if (month < day) { num = month; den = day; }
    }

    if (!den) {
      unclear.push("row " + (i + 2) + ": " +
                   Utilities.formatDate(v, Session.getScriptTimeZone(), "dd/MM/yyyy"));
      continue;
    }
    vals[i][0] = num + "/" + den + " tank";
    fixed++;
  }

  /* Plain text first, or the write puts the dates straight back. */
  range.setNumberFormat("@");
  range.setValues(vals);

  var msg = fixed + " fuel readings put back to text.";
  if (skipped) msg += "\n" + skipped + " were already fine and were left alone.";
  if (unclear.length) {
    msg += "\n\n" + unclear.length + " could not be worked out and were left as they are:\n  " +
           unclear.slice(0, 10).join("\n  ");
    if (unclear.length > 10) msg += "\n  ...and " + (unclear.length - 10) + " more";
  }
  ui.alert(msg);
}

/* ------------------------------------------------------------------------ */

function setUpEverything() {
  structReset();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureRotaSheets(ss);
  ensureBusStops(ss);
  ensureBookings(ss);
  ensureTripEvents(ss);
  ensureDrivers(ss);
  ensureRota(ss);

  /* Run by hand means fill now, whatever the once-a-day stamp says. */
  try { PropertiesService.getScriptProperties().deleteProperty("rotaFilledAt"); }
  catch (err) {}
  fillRotaAhead(ss);

  /* Guarded, and guarded for a reason. This used to be a bare call, so a
     failure inside it skipped everything below: the rota version, all five
     scheduled jobs, and the sheet protection. A cosmetic step was taking down
     the parts that actually matter. */
  var dropSkips = [];
  try { dropSkips = refreshDropdowns() || []; }
  catch (err) { dropSkips = ["dropdowns and colours (" + String(err.message || err) + ")"]; }

  bumpRotaVersion();
  try { installWeeklyDigest(); } catch (err) { /* triggers need permission; never block setup */ }
  try { installDutyReminders(); } catch (err) { /* same */ }
  try { installChangeAlerts(); } catch (err) { /* same */ }
  try { installNightlyMaintenance(); } catch (err) { /* same. maintainIfDue covers it. */ }
  try { installMissingCheckAlert(); } catch (err) { /* same */ }
  /* Re-applied every setup, because adding a tab or columns leaves the old
     protection covering the wrong range. */
  try { applyLocks(ss); } catch (err) { /* never block setup over this */ }

  var n = ss.getSheetByName(ROTA_SHEET).getLastRow() - 1;
  var tz = timeZoneWarning();
  var dh = driversHeaderWarning(ss);

  /* Said in a dialog rather than a toast. A toast is gone in six seconds and
     this one needs reading, because the fix is on the sheet and not in here. */
  var coloursOnly = dropSkips.length === 1 &&
                    String(dropSkips[0]).indexOf("Rota status colours") === 0;
  if (coloursOnly) {
    ss.toast("Set up. The status colours are left to the dropdown's own chips, " +
             "which is fine and needs nothing from you.", "Ready", 8);
    return;
  }

  if (dropSkips.length) {
    var ui2 = SpreadsheetApp.getUi();
    ui2.alert("Set up, with " + dropSkips.length + " step" +
      (dropSkips.length > 1 ? "s" : "") + " skipped",
      "Everything else is done: the rota, the tabs, the scheduled emails and " +
      "the sheet protection.\n\nThese could not be applied:\n\n  \u2022  " +
      dropSkips.join("\n\n  \u2022  ") + "\n\n" + typedColumnAdvice(),
      ui2.ButtonSet.OK);
    return;
  }

  if (tz || dh) {
    /* Folded into this toast, not fired as separate ones: a second toast
       replaces the first straight away, so the warning would never be read. */
    var note = tz
      ? tz + " Run Minibus \u203a Check time zone for the fix, then run this again."
      : "The Drivers tab columns have moved. Run Minibus \u203a Check the Drivers tab.";
    ss.toast(note, "Ready, but check this first", 12);
  } else {
    ss.toast("Ready. " + n + " Sundays on the rota.", "Minibus", 6);
  }
}

/* The rota is worked out from timestamps and matched against phones on UK
   time. If this sheet's time zone is something else, the two can disagree
   about which day it is. Returns a warning, or "" if it looks right. */
function timeZoneWarning() {
  try {
    var tz = Session.getScriptTimeZone();
    if (tz === "Europe/London") return "";
    return "Time zone is set to " + tz + ", not Europe/London.";
  } catch (err) {
    return "";
  }
}

function checkTimeZoneMenu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = timeZoneWarning();
  if (tz) {
    ss.toast(tz + " Go to File \u203a Settings \u203a Time zone, change it to " +
             "United Kingdom, then run Set up / refresh rota again.",
             "Check the time zone", 15);
  } else {
    ss.toast("Time zone looks right: " + Session.getScriptTimeZone() + ".", "Minibus", 6);
  }
}

function ensureBusStops(ss) {
  var existing = ss.getSheetByName(STOPS_SHEET);
  var sh = sheet(ss, STOPS_SHEET, STOPS_HEADERS);
  if (!existing) {
    SEED_STOPS.forEach(function (r) { sh.appendRow(r); });
    sh.setColumnWidth(4, 340);
    sh.getRange(1, 3).setNote("Written as text, 09:50, not a time value.");
    sh.getRange(1, 6).setNote("NO takes a stop out of the app without deleting it.");
    sh.getRange(1, 7).setNote("Pickup or Arrival. Arrival is where the run ends, " +
                              "not somewhere anybody boards.");
    sh.getRange("F2:F400").setDataValidation(listRule(["YES", "NO"]));
    sh.getRange("G2:G400").setDataValidation(listRule(["Pickup", "Arrival"]));
    sh.setFrozenRows(1);
  }
  return sh;
}

/* Held for a minute, and for this execution.

   The timetable is the least changeable thing on the spreadsheet and it was
   being read in full on every request that touched it. runningRegs made that
   worse by adding one more read to a call every driver's phone makes twice a
   minute, which is exactly the sort of weight that turns into "the screen
   feels slow" and is never traced back.

   A minute of staleness on a stop list costs nothing. Set up everything
   clears it, so a coordinator who has just edited the tab is not told to
   wait. */
var STOPS_CACHE_KEY = "busstops_v1";
var stopsMemo = null;

function readBusStops(ss) {
  if (stopsMemo) return stopsMemo;
  try {
    var hit = CacheService.getScriptCache().get(STOPS_CACHE_KEY);
    if (hit) { stopsMemo = JSON.parse(hit); return stopsMemo; }
  } catch (err) { /* read it properly below */ }
  stopsMemo = readBusStopsFresh(ss);
  try {
    CacheService.getScriptCache().put(STOPS_CACHE_KEY, JSON.stringify(stopsMemo), 60);
  } catch (err) { /* it just gets read again */ }
  return stopsMemo;
}

function readBusStopsFresh(ss) {
  var sh = ss.getSheetByName(STOPS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
  var out = [];
  vals.forEach(function (r) {
    var stop = String(r[3] || "").trim();
    if (!stop) return;
    if (String(r[5] || "YES").trim().toUpperCase() === "NO") return;
    out.push({
      route: (String(r[0] || "").trim().toUpperCase().charAt(0) === "S") ? "South" : "North",
      id: String(r[1] || "").trim(),
      /* Read as text. A cell holding 09:50 as a real time comes back as a
         Date, and the fuel column already taught us what that does. */
      time: (r[2] && typeof r[2].getHours === "function")
        ? Utilities.formatDate(r[2], Session.getScriptTimeZone(), "HH:mm")
        : String(r[2] || "").trim(),
      stop: stop,
      postcode: String(r[4] || "").trim(),
      arrival: String(r[6] || "").trim().toLowerCase().indexOf("arriv") === 0
    });
  });
  return out;
}

/* ---- passenger bookings ------------------------------------------------ */

/* The Sunday a link is for has to be this Sunday or the next one. An old
   link is dead, and nobody can book six months out by editing a date. */
function busDateAllowed(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ""))) return false;
  var d = keyToDate(key);
  if (d.getDay() !== 0) return false;
  var thisSunday = sundayOf(new Date());
  var next = addWeeks(thisSunday, 1);
  return dateToKey(d) === dateToKey(thisSunday) || dateToKey(d) === dateToKey(next);
}

function bookingsClosed(key) {
  var sunday = keyToDate(key);
  var cutoff = new Date(sunday);
  /* Day 0 is the Sunday itself. Anything else counts back to the weekday
     before it, so Saturday is 6 and lands one day earlier. */
  if (BOOKING_CUTOFF_DAY !== 0) cutoff.setDate(cutoff.getDate() - (7 - BOOKING_CUTOFF_DAY));
  cutoff.setHours(BOOKING_CUTOFF_HOUR, BOOKING_CUTOFF_MIN || 0, 0, 0);
  return new Date() > cutoff;
}

/* For telling somebody when to book by, in words. */
function cutoffWords() {
  var day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][BOOKING_CUTOFF_DAY];
  return day + " " + p2(BOOKING_CUTOFF_HOUR) + ":" + p2(BOOKING_CUTOFF_MIN || 0);
}

function ensureBookings(ss) {
  var existing = ss.getSheetByName(BOOKINGS_SHEET);
  var sh = sheet(ss, BOOKINGS_SHEET,
    ["Received", "Sunday", "Route", "Stop ID", "Stop", "Seats", "Device", "Status"]);
  if (!existing) {
    sh.getRange(1, 6).setNote("How many people are boarding there, not who.");
    sh.getRange(1, 7).setNote(
      "A random handle the passenger's own phone made up, so somebody can " +
      "change their own booking later.\n\n" +
      "It is NOT a name, a number or anything that identifies a person. " +
      "Nothing on this tab does, and nothing should be added that does.");
    sh.setFrozenRows(1);
    sh.setColumnWidth(5, 300);
  }
  return sh;
}

function readBookings(ss, key) {
  var rehearsing = !!rehearsalOn();
  var sh = ss.getSheetByName(BOOKINGS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
  var out = [];
  vals.forEach(function (r, i) {
    if (anyToKey(r[1]) !== key) return;
    var status = String(r[7] || "").trim().toLowerCase();
    if (status === "cancelled") return;
    /* Seeded test bookings. Inert unless a rehearsal is actually running, so
       a row left behind by a crash cannot quietly inflate a real Sunday. */
    if (status === "rehearsal" && !rehearsing) return;
    out.push({ row: i + 2, stopId: String(r[3] || "").trim(),
               seats: Number(r[5]) || 0, device: String(r[6] || "").trim() });
  });
  return out;
}

/* Seats booked per stop for one Sunday. What the driver actually needs. */
function bookingCounts(ss, key) {
  var out = {};
  readBookings(ss, key).forEach(function (b) {
    out[b.stopId] = (out[b.stopId] || 0) + b.seats;
  });
  return out;
}

/* ---- booking counts on their own ---------------------------------------
   The driver app's Stops and bookings screen needs one thing: how many are
   booked at each stop this Sunday. It used to get that by asking for the
   whole rota payload, which drags down the driver register, PIN hashes, open
   defects and up to fifty-two weeks of rota rows to answer a question about
   two numbers. This is the small version, and it is cheap enough that the
   screen can poll it while a driver has it open on a Sunday morning.

   Cached, because several drivers polling at once on a Sunday morning is
   exactly the case worth absorbing. Cleared the moment a booking is written,
   so a passenger tap shows up on the next poll rather than whenever the
   cache happens to lapse. The short life is only there for edits made by
   hand in the sheet that the trigger below might miss. */
function countsCacheKey(key) {
  return "counts_" + key;
}

function dropCountsCache(key) {
  try { CacheService.getScriptCache().remove(countsCacheKey(key)); }
  catch (err) { /* a stale count for twenty seconds is not worth an error */ }
}

function countsPayload() {
  var key = dateToKey(sundayOf(new Date()));
  var cache = CacheService.getScriptCache();

  var hit = null;
  try { hit = cache.get(countsCacheKey(key)); } catch (err) { hit = null; }
  if (hit) {
    try { return JSON.parse(hit); } catch (err) { /* rebuild below */ }
  }

  var payload = {
    ok: true,
    date: key,
    counts: bookingCounts(SpreadsheetApp.getActiveSpreadsheet(), key)
  };

  try { cache.put(countsCacheKey(key), JSON.stringify(payload), 20); }
  catch (err) { /* no matter: it just gets built again */ }
  return payload;
}



/* ==========================================================================
   REHEARSAL

   Sunday is the only time the tracking can be exercised, and it is the worst
   possible time to find out something is wrong. This turns the gates off for
   a couple of hours so the whole thing can be walked through on a Tuesday.

   It deliberately does NOT make bookingsClosed() return true. That function
   decides which Sunday a bare link is for and whether a real passenger may
   still book, so forcing it would roll the booking page to next Sunday and
   turn away anybody trying to book for this one. The gate below is separate
   and touches only the tracking.

   Everything a rehearsal writes is tagged Rehearsal and is invisible to the
   real thing, in both directions: a real run never counts rehearsal rows, and
   a rehearsal never counts real ones.
   ========================================================================== */

/* Two hours, or the next booking cutoff, whichever comes first. A flat number
   has a hole in it: rehearse at eight on a Sunday morning, forget, and three
   hours later it is still on during the real run. Expiring at the cutoff
   means a rehearsal can never survive into a live morning. */
var REHEARSAL_HOURS = 2;

function rehearsalState() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty("rehearsal");
    return raw ? JSON.parse(raw) : null;
  } catch (err) { return null; }
}

/**
 * On, or null. Clears itself when it has run out, so the expiry is real
 * rather than merely calculated: the seeded bookings go with it.
 */
function rehearsalOn() {
  var st = rehearsalState();
  if (!st || !st.at) return null;

  var ends = st.at + REHEARSAL_HOURS * 3600000;
  var cutoff = nextCutoffMs();
  if (cutoff && cutoff < ends) ends = cutoff;

  if (Date.now() >= ends) { rehearsalClear(); return null; }
  st.ends = ends;
  return st;
}

/* When bookings next close, in ms. */
function nextCutoffMs() {
  var sunday = sundayOf(new Date());
  var c = new Date(sunday);
  if (BOOKING_CUTOFF_DAY !== 0) c.setDate(c.getDate() - (7 - BOOKING_CUTOFF_DAY));
  c.setHours(BOOKING_CUTOFF_HOUR, BOOKING_CUTOFF_MIN || 0, 0, 0);
  return c.getTime() > Date.now() ? c.getTime() : 0;
}

/* The gate the tracking uses. Never bookingsClosed() on its own again. */
function trackingOpen(key) {
  return rehearsalOn() ? true : bookingsClosed(key);
}

/* Only the flag. Deliberately does not touch the sheet.

   rehearsalOn() is called from inside readBookings, and readBookings is called
   by handleBooking while it is working out which row to update. Deleting rows
   from in there meant an expiry landing mid-booking could shift every row
   index under the write that was about to happen, and overwrite somebody
   else's booking. The seeded rows are already inert once the flag is gone,
   because readBookings skips them unless a rehearsal is running, so there is
   nothing to gain by deleting them in a hurry. Stop rehearsing tidies them,
   and so does the next rehearsal. */
function rehearsalClear() {
  try { PropertiesService.getScriptProperties().deleteProperty("rehearsal"); }
  catch (err) {}
}

/* Test bookings, on both routes, so either can be walked through. Two stops
   per route rather than every stop: enough to exercise the sequence, the
   empty-stop case and the gone-past case, without a wall of green. */
function rehearsalSeed(ss, key) {
  var sh = ensureBookings(ss);
  var stops = readBusStops(ss).filter(function (s) { return !s.arrival; });
  var byRoute = {};
  stops.forEach(function (s) {
    if (!byRoute[s.route]) byRoute[s.route] = [];
    byRoute[s.route].push(s);
  });

  var rows = [];
  Object.keys(byRoute).forEach(function (route) {
    var list = byRoute[route];
    /* First and last-but-one, so there is an untouched stop between them and
       one after: the shape a real morning has. */
    var picks = [];
    if (list.length) picks.push({ s: list[0], n: 2 });
    if (list.length > 2) picks.push({ s: list[list.length - 2], n: 1 });
    picks.forEach(function (p, i) {
      rows.push([new Date(), key, route, p.s.id, p.s.stop, p.n,
                 "rehearsal-" + route.toLowerCase() + "-" + i, "Rehearsal"]);
    });
  });

  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
  return rows.length;
}

function rehearsalDropSeeds(ss) {
  var sh = ss.getSheetByName(BOOKINGS_SHEET);
  if (!sh || sh.getLastRow() < 2) return 0;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
  var gone = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][7] || "").trim().toLowerCase() === "rehearsal") {
      sh.deleteRow(i + 2); gone++;
    }
  }
  return gone;
}

function startRehearsal() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var running = rehearsalOn();
  if (running) {
    ui.alert("Already rehearsing",
      "A rehearsal is running until " +
      Utilities.formatDate(new Date(running.ends), Session.getScriptTimeZone(), "HH:mm") +
      ".\n\nUse Stop rehearsing, just below this item, to end it now.",
      ui.ButtonSet.OK);
    return;
  }

  var ok = ui.alert("Rehearse this Sunday",
    "For the next " + REHEARSAL_HOURS + " hours, or until bookings next " +
    "close, whichever comes first:\n\n" +
    "  \u2022  the tracking behaves as though bookings had closed\n" +
    "  \u2022  test bookings appear on both routes\n" +
    "  \u2022  you can tap either route, rostered or not\n" +
    "  \u2022  both apps carry a rehearsal banner\n\n" +
    "Nothing a rehearsal writes touches the real record. Drivers who open " +
    "the app will see the banner and know not to rely on it.\n\nStart?",
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  var key = runSunday();
  rehearsalDropSeeds(ss);
  var n = rehearsalSeed(ss, key);

  try {
    PropertiesService.getScriptProperties().setProperty("rehearsal",
      JSON.stringify({ at: Date.now(), key: key }));
  } catch (err) {
    ui.alert("Could not start: " + err);
    return;
  }
  dropCountsCache(key);

  ui.alert("Rehearsal running",
    n + " test bookings added for " +
    Utilities.formatDate(keyToDate(key), Session.getScriptTimeZone(), "EEEE d MMMM") +
    ".\n\nOpen the app, go to Stops and bookings, and Start trip. " +
    "Use a second phone on the booking link to watch the passenger side.\n\n" +
    "It switches itself off at " +
    Utilities.formatDate(new Date(Date.now() + REHEARSAL_HOURS * 3600000),
                         Session.getScriptTimeZone(), "HH:mm") +
    " at the latest, so forgetting is not a problem. To end it now, " +
    "use Stop rehearsing directly below this item in the menu.",
    ui.ButtonSet.OK);
}

function stopRehearsal() {
  var ui = SpreadsheetApp.getUi();
  if (!rehearsalOn()) {
    /* Sweep anyway. If one timed out rather than being stopped, the seeded
       rows are still on the tab, inert but visible, and somebody pressing
       this is entitled to have them gone. */
    var swept = 0;
    try { swept = rehearsalDropSeeds(SpreadsheetApp.getActiveSpreadsheet()); } catch (err) {}
    ui.alert("No rehearsal is running." +
             (swept ? "\n\n" + swept + " leftover test booking" + (swept > 1 ? "s" : "") +
                      " from an earlier one has been cleared." : ""));
    return;
  }
  var key = runSunday();
  rehearsalClear();
  try { rehearsalDropSeeds(SpreadsheetApp.getActiveSpreadsheet()); } catch (err) {}
  dropCountsCache(key);
  dropTripCache(key, "North");
  dropTripCache(key, "South");
  ui.alert("Rehearsal stopped",
    "Test bookings removed. The Trip Events rows are kept and tagged " +
    "Rehearsal, so you can see it happened, and they are ignored by " +
    "Who is tapping and by the real run.",
    ui.ButtonSet.OK);
}

/**
 * Sends you the real duty email for the next Sunday that has a driver,
 * ignoring the sent-once stamps. This is the test that was being reached for
 * when "Send duty reminders now" appeared to do nothing.
 */
function sampleDutyReminder() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  if (!COORDINATOR_EMAIL) { ui.alert("COORDINATOR_EMAIL is blank in Code.gs."); return; }

  var drivers = readDrivers(ss);
  var byDate = {};
  readRotaRows(ss).forEach(function (r) { byDate[r.date] = r; });
  var north = primaryPattern(drivers, "North");

  var sunday = sundayOf(new Date());
  var row = byDate[dateToKey(sunday)];
  var who = String((row ? (row.actual || row.primary) : patternDriver(sunday, north)) || "").trim() ||
            "Bro Sample";

  var days = Math.round((sunday - new Date()) / 86400000) || 1;
  sendDutyEmail(COORDINATOR_EMAIL, who, sunday, days, "", "North Liverpool");

  ui.alert("Sample sent",
    "The duty email for " +
    Utilities.formatDate(sunday, Session.getScriptTimeZone(), "EEEE d MMMM") +
    " has gone to " + COORDINATOR_EMAIL + ", made out to " + who + ".\n\n" +
    "This is the same email a driver receives. It ignores the sent-once " +
    "record, so it can be run as often as you like, and it never goes to a " +
    "driver.",
    ui.ButtonSet.OK);
}

/* ==========================================================================
   MOVEMENT TRACKING

   The driver taps a stop as he leaves it. That one tap says two things: the
   people there have been collected, and the bus is running n minutes off the
   timetable. The first is what the passenger sees. The second is what makes
   it worth anything, because "the bus has done Molyneux Road" is a fact and
   "your 10:20 is about 10:26" is an answer.

   Only stops with somebody booked need a tap. An empty stop needs nothing,
   because one tap sets the offset for every stop after it and nobody is
   watching a stop nobody booked. The driver still drives the road he always
   drove: the app is saying where a tap is required, never where to stop.
   ========================================================================== */

/**
 * Adds any Trip Events column this version writes that an older sheet has
 * not got. Appends on the right only, so every row already recorded keeps
 * its meaning.
 *
 * It widens the grid as well as writing the heading. A sheet trimmed down to
 * exactly twelve columns would otherwise throw on the first read of thirteen,
 * and it would throw inside the Sunday morning path, which is the one place
 * nothing may fail.
 */
function ensureTripColumns(sh) {
  if (structFresh("trip")) return;

  if (sh.getMaxColumns() < TRIP_HEADERS.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(),
                          TRIP_HEADERS.length - sh.getMaxColumns());
  }
  var lastCol = sh.getLastColumn();
  var head = lastCol
    ? sh.getRange(1, 1, 1, lastCol).getValues()[0]
        .map(function (h) { return String(h || "").trim(); })
    : [];
  TRIP_HEADERS.forEach(function (name, i) {
    if (head.indexOf(name) !== -1) return;
    sh.getRange(1, i + 1).setValue(name).setFontWeight("bold");
  });

  structDone("trip");
}

function ensureTripEvents(ss) {
  var existing = ss.getSheetByName(TRIP_SHEET);
  var sh = sheet(ss, TRIP_SHEET, TRIP_HEADERS);
  ensureTripColumns(sh);
  if (!existing) {
    sh.getRange(1, 13).setNote(
      "Which bus ran it. Recorded from the driver's own start tap, because " +
      "which bus takes which route is decided on the day and nothing else " +
      "on this spreadsheet knows it.");
    sh.getRange(1, 1).setNote(
      "When the sheet received it. Compare with Happened: a gap means the " +
      "phone had no signal, not that the bus was late.");
    sh.getRange(1, 10).setNote(
      "When the driver's own phone recorded the tap. This is the one the " +
      "times are worked out from. Never overwritten by the server.");
    sh.getRange(1, 11).setNote(
      "Minutes off the timetable at that stop. Positive is behind.");
    sh.getRange(1, 12).setNote(
      "Undone means the driver tapped and took it back. The row is kept " +
      "rather than deleted, because the record is the point.");
    sh.setFrozenRows(1);
    sh.setColumnWidth(8, 260);
  }
  return sh;
}

/* The timetable time of a stop, as a real moment on that Sunday. */
function stopMomentOn(key, hhmm) {
  var d = keyToDate(key);
  var p = String(hhmm || "").split(":");
  if (p.length < 2) return null;
  d.setHours(Number(p[0]) || 0, Number(p[1]) || 0, 0, 0);
  return d;
}

function tripCacheKey(key, route) {
  /* Rehearsal state is cached apart from the real thing. Sharing one key
     would hand a real driver the rehearsal's progress for ten seconds after
     it was switched off. */
  return "trip_" + key + "_" + route + (rehearsalOn() ? "_r" : "");
}

function dropTripCache(key, route) {
  try { CacheService.getScriptCache().remove(tripCacheKey(key, route)); }
  catch (err) { /* ten seconds of stale is not worth an error */ }
}

/**
 * Where one route has got to, this Sunday.
 *
 * Cached for ten seconds per route, so fifteen people watching North cost the
 * same sheet read as one. Cleared whenever a tap is written.
 */
function tripState(ss, key, route) {
  var rehearsing = !!rehearsalOn();
  var cache = CacheService.getScriptCache();
  var hit = null;
  try { hit = cache.get(tripCacheKey(key, route)); } catch (err) { hit = null; }
  if (hit) { try { return JSON.parse(hit); } catch (err) { /* rebuild */ } }

  var state = { trip: "", driver: "", reg: "", started: 0, ended: 0,
                lastAt: 0, lastStop: "", offset: null, served: {} };

  var sh = ss.getSheetByName(TRIP_SHEET);
  if (sh && sh.getLastRow() > 1) {
    /* Clamped to the grid. This one reads the tab directly rather than
       through ensureTripEvents, so on a sheet that predates the Reg column it
       would be asking for a column that is not there. A short row leaves reg
       undefined, which reads as blank, which is the truth. */
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1,
                           Math.min(TRIP_HEADERS.length, sh.getMaxColumns())).getValues();
    vals.forEach(function (r) {
      if (anyToKey(r[2]) !== key) return;
      if (String(r[3] || "").trim() !== route) return;
      var status = String(r[11] || "").trim().toLowerCase();
      if (status === "undone") return;
      /* Both ways round: a real run never counts rehearsal rows, and a
         rehearsal never counts real ones. */
      if ((status === "rehearsal") !== rehearsing) return;

      var ev  = String(r[5] || "").trim().toLowerCase();
      var at  = r[9] instanceof Date ? r[9].getTime() : 0;
      if (!at) return;

      state.trip   = String(r[1] || "").trim() || state.trip;
      state.driver = String(r[4] || "").trim() || state.driver;
      state.reg    = String(r[12] || "").trim() || state.reg;

      if (ev === "start") { state.started = at; return; }
      if (ev === "end")   { state.ended   = at; return; }

      var id = String(r[6] || "").trim();
      if (id) state.served[id] = { at: at, event: ev };

      /* The freshest stop event is what the offset comes from. Not an
         average: traffic is local, and smoothing would lag at exactly the
         moment it matters. */
      if (at >= state.lastAt) {
        state.lastAt   = at;
        state.lastStop = String(r[7] || "").trim();
        var off = Number(r[10]);
        state.offset = isNaN(off) ? null : off;
      }
    });
  }

  try { cache.put(tripCacheKey(key, route), JSON.stringify(state), 10); }
  catch (err) { /* it just gets built again */ }
  return state;
}

/**
 * Whether the offset may be used to project a time, and why not when it
 * cannot. Four refusals, and all four end with the page saying the last thing
 * it actually knows instead of a number it has invented.
 */
function tripProjectable(state) {
  if (!state.started)      return { ok: false, why: "notstarted" };
  if (state.ended)         return { ok: false, why: "ended" };
  if (!state.lastAt)       return { ok: false, why: "noevents" };
  if (state.offset === null) return { ok: false, why: "noevents" };

  var quiet = (Date.now() - state.lastAt) / 60000;
  if (quiet > TRIP_QUIET_MINUTES) return { ok: false, why: "quiet" };
  if (Math.abs(state.offset) > TRIP_MAX_OFFSET) return { ok: false, why: "wild" };
  return { ok: true };
}

/**
 * What one passenger's phone is told.
 *
 * The gate: tracking is visible only to a device with a booking for this
 * Sunday, and only once bookings have closed. Both halves are one lookup the
 * endpoint has to do anyway to know which stop to give a time for.
 */
function tripPayload(ref, want) {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var key = runSunday();

  if (!trackingOpen(key)) {
    return { ok: true, live: false, why: "open", date: key, cutoff: cutoffWords() };
  }

  ref = String(ref || "").trim();
  var rows = readBookings(ss, key);
  var mine = null;
  if (ref) {
    rows.forEach(function (b) { if (b.device === ref && b.stopId) mine = b; });
  }

  var stops = readBusStops(ss);
  var stopById = {};
  stops.forEach(function (s) { stopById[s.id] = s; });

  /* Rehearsing. The live view is only ever shown to a phone with a booking,
     which meant the person running the rehearsal saw nothing at all unless
     they first made a real booking and then remembered to cancel it. So a
     phone with no booking of its own is lent a seeded one and can walk the
     passenger side straight from the link. The banner says what it is.

     WHICH seed matters, and taking the first one was wrong. The seeds are
     built by walking the stops, the stops are listed North first, so the
     first seed is always a North one. A rehearsal therefore always watched
     North: the South bus could run the whole morning and this page would
     never move, which is exactly what happened on the 13th and looked like a
     South fault when nothing about South was broken.

     So: the route asked for, if the page asked for one. Failing that, a
     route with a bus actually out, because that is the one worth watching.
     Failing that, the first, as before. */
  /* An explicit route asked for by the page wins, even when this phone holds
     a booking of its own.

     It did not, and that is why switching the tester's page to South showed
     nothing at all: the block below only ran when the phone had NO booking,
     so a phone that had booked a seat during testing — which is the first
     thing anybody does — was pinned to its own stop's route for good, and the
     North/South switch above it did nothing whatsoever. A control that cannot
     work should not be on screen; the cheaper fix of the two is to make it
     work.

     Rehearsal only, and only when the page actually sends r. A real passenger
     never sets it, so their own booking still decides what they watch. */
  var askedRoute = String(want || "").trim();
  if (rehearsalOn() && (askedRoute || !mine)) {
    var seeds = rows.filter(function (b) {
      return b.stopId && String(b.device || "").indexOf("rehearsal-") === 0;
    });
    var wantRoute = askedRoute;
    if (wantRoute) {
      /* Asked for by name, so let the seed replace whatever this phone had. */
      mine = null;
      seeds.forEach(function (b) {
        var s = stopById[b.stopId];
        if (!mine && s && s.route === wantRoute) mine = b;
      });
    }
    if (!mine) {
      seeds.forEach(function (b) {
        if (mine) return;
        var s = stopById[b.stopId];
        if (!s) return;
        var t = tripState(ss, key, s.route);
        if (t.started && !t.ended) mine = b;
      });
    }
    if (!mine && seeds.length) mine = seeds[0];
  }

  if (!mine) return { ok: true, live: false, why: "nobooking", date: key };

  var myStop = stopById[mine.stopId] || null;
  if (!myStop) return { ok: true, live: false, why: "nobooking", date: key };

  var state = tripState(ss, key, myStop.route);
  var out = {
    ok: true, live: true, date: key, now: Date.now(), route: myStop.route,
    rehearsal: !!rehearsalOn(),
    /* Only during a rehearsal, and only so the tester can switch to the bus
       he is actually driving. A real passenger watches their own stop and is
       never offered somebody else's route. */
    routes: rehearsalOn() ? routeNames(stops) : [],
    stop: myStop.stop, stopId: myStop.id, scheduled: myStop.time,
    started: !!state.started, ended: !!state.ended,
    lastStop: state.lastStop,
    lastAgo: state.lastAt ? Math.round((Date.now() - state.lastAt) / 60000) : null,
    lastAtWords: state.lastAt
      ? Utilities.formatDate(new Date(state.lastAt), Session.getScriptTimeZone(), "HH:mm")
      : ""
  };

  /* Already collected. Said plainly and before anything else, because a
     projected time for a stop the bus has left is nonsense. */
  if (state.served[myStop.id]) {
    out.mine = "served";
    out.servedAt = Utilities.formatDate(new Date(state.served[myStop.id].at),
                                        Session.getScriptTimeZone(), "HH:mm");
    return out;
  }

  var can = tripProjectable(state);
  if (!can.ok) { out.mine = can.why; return out; }

  var sched = stopMomentOn(key, myStop.time);
  if (!sched) { out.mine = "noevents"; return out; }

  var eta  = new Date(sched.getTime() + state.offset * 60000);
  var mins = Math.round((eta.getTime() - Date.now()) / 60000);

  out.mine    = "eta";
  out.offset  = state.offset;
  out.etaWords = Utilities.formatDate(eta, Session.getScriptTimeZone(), "HH:mm");
  out.minutes = mins;
  out.imminent = mins <= TRIP_IMMINENT_MINUTES;
  return out;
}

/**
 * What a driver's phone is told: the whole route, so it can draw the list.
 * No gate, because a driver who can already see the rota and the bookings is
 * not being protected from knowing where his own bus is.
 */
function tripDriverPayload(route) {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var key = runSunday();
  var state = tripState(ss, key, String(route || "").trim() || "North");
  return {
    ok: true, date: key, route: route, now: Date.now(),
    closed: trackingOpen(key), cutoff: cutoffWords(),
    rehearsal: !!rehearsalOn(),
    trip: state.trip, driver: state.driver, reg: state.reg,
    started: state.started || 0, ended: state.ended || 0,
    lastAt: state.lastAt || 0, lastStop: state.lastStop,
    offset: state.offset, served: state.served
  };
}

/**
 * Taps arriving from a driver's phone, one or many.
 *
 * Many, because a phone in a blackspot queues them and sends the lot on
 * reconnect. Each carries the time it was MADE, and that is what goes in
 * Happened. The server writes Logged itself and never touches Happened, or
 * every time downstream of a signal blackspot would drift by however long the
 * phone was out of touch.
 *
 * Sorted by Happened before writing, because arrival order is not the order
 * things occurred.
 *
 * Ignoring a repeat: one live row per trip, stop and event. A send that timed
 * out and was retried therefore costs nothing.
 */
function handleTrip(payload) {
  if (!payload) return reply({ ok: false, error: "no trip data" });

  /* One writer at a time. This walks the sheet by row number, and two phones
     on the same route, or one phone retrying while another is mid-write,
     would otherwise stamp each other's rows. Ten seconds is longer than this
     has ever taken and shorter than a driver notices. */
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (err) { return reply({ ok: false, error: "busy, try again" }); }
  try {
    return handleTripLocked(payload);
  } finally {
    try { lock.releaseLock(); } catch (err) {}
  }
}

function handleTripLocked(payload) {
  var rehearsing = !!rehearsalOn();
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sh    = ensureTripEvents(ss);
  var key   = anyToKey(payload.sunday) || runSunday();
  var route = String(payload.route || "").trim() || "North";
  var trip  = String(payload.trip || "").trim();
  var who   = String(payload.driver || "").trim();

  if (!trip) return reply({ ok: false, error: "no trip id" });

  var events = (payload.events || []).slice().sort(function (a, b) {
    return (Number(a.at) || 0) - (Number(b.at) || 0);
  });
  if (!events.length) return reply({ ok: true, written: 0 });

  /* Which bus. Sent on the envelope, and carried on the start event too, so a
     phone that lost its trip state between the start and a later flush still
     puts the registration on the row it belongs to. */
  var reg = String(payload.reg || "").trim();
  if (!reg) {
    events.forEach(function (ev) {
      if (!reg && String(ev.event || "").trim().toLowerCase() === "start") {
        reg = String(ev.reg || "").trim();
      }
    });
  }
  /* Last resort is the sheet: a row already written for this trip knows the
     bus, so a phone that lost everything still lands its later taps on the
     right registration rather than blank. Picked up in the scan below, which
     walks these rows anyway. */

  /* What is already down for this trip, so a retry is quietly ignored. */
  var seen = {}, undone = {};
  if (sh.getLastRow() > 1) {
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, TRIP_HEADERS.length).getValues();
    vals.forEach(function (r, i) {
      if (String(r[1] || "").trim() !== trip) return;
      if (!reg) reg = String(r[12] || "").trim();
      var k = String(r[5] || "").trim().toLowerCase() + "|" + String(r[6] || "").trim();
      if (String(r[11] || "").trim().toLowerCase() === "undone") { undone[k] = true; return; }
      seen[k] = i + 2;
    });
  }

  var stops = {}, order = readBusStops(ss);
  order.forEach(function (s) { stops[s.id] = s; });

  var rows = [], pending = {}, undoneNow = 0;
  events.forEach(function (ev) {
    var kind   = String(ev.event || "").trim().toLowerCase();
    var stopId = String(ev.stopId || "").trim();
    var at     = Number(ev.at) || 0;
    var k      = kind + "|" + stopId;

    if (!at) return;

    /* An undo names the event it takes back. The row stays and is marked,
       because a driver who taps and untaps four times should leave a trace.

       Two places to look, and missing the second one was a real fault. A row
       already on the sheet is marked where it sits. A row queued in THIS
       batch has no sheet row yet: a phone in a blackspot holds the tap and
       the undo and sends the pair together, and seen[target] is then the
       value true rather than a row number. getRange(true, 12) throws, the
       whole batch is refused, and the queue retries the same failure for
       ever. One undo with no signal therefore lost every tap of the morning,
       the start included, and nothing on the phone said so. */
    if (kind === "undo") {
      var target = String(ev.undoes || "").trim().toLowerCase() + "|" + stopId;
      if (typeof seen[target] === "number") {
        sh.getRange(seen[target], 12).setValue("Undone");
        delete seen[target];
        undoneNow++;
      } else if (pending[target] !== undefined) {
        rows[pending[target]][11] = "Undone";
        delete pending[target];
        delete seen[target];
        undoneNow++;
      }
      return;
    }

    if (seen[k]) return;                       /* already down: a retry */

    var stop  = stops[stopId] || null;
    var sched = stop ? stopMomentOn(key, stop.time) : null;
    var off   = sched ? Math.round((at - sched.getTime()) / 60000) : "";

    /* A run started with no check on record is marked here rather than
       refused there. Status carries it, and the value still fails every
       filter that matters: it is not Undone and it is not Rehearsal.

       Two flavours of it now. The driver saw identical words either way, on
       purpose, because the instruction is identical either way. The
       difference is a question for whoever reads this tab on Monday:
         Unchecked            the sheet was asked and had no check for that bus
         Unchecked (offline)  the phone could not reach the sheet to ask
       The second is often not the driver's fault at all, and treating the two
       the same would have somebody answering for a blackspot. */
    var status = rehearsing ? "Rehearsal"
               : (kind === "start" && Number(ev.unchecked) === 2) ? "Unchecked (offline)"
               : (kind === "start" && ev.unchecked) ? "Unchecked"
               : "Logged";

    /* The stop name comes off the Bus Stops tab and is already ours. The
       trip id, route, driver name, registration and event all came up from a
       phone, so they go through safeText like everything else a phone sends.

       The reg goes on every row of the trip rather than the start row alone.
       Filtering this tab to one bus is the whole point of having it, and a
       filter that returns one row per morning is not a filter. */
    pending[k] = rows.push([
      new Date(), safeText(trip), key, safeText(route), safeText(who),
      safeText(kind), safeText(stopId), stop ? stop.stop : "",
      sched || "", new Date(at), off, status, safeText(reg)
    ]) - 1;
    seen[k] = true;
  });

  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, TRIP_HEADERS.length).setValues(rows);
  }
  if (rows.length || undoneNow) dropTripCache(key, route);

  return reply({ ok: true, written: rows.length, undone: undoneNow });
}

/**
 * Who is tapping. The evidence, per driver, per Sunday.
 *
 * Shown to the drivers once, at the start, because being told it is recorded
 * does more work than any nudge inside the app.
 */
function whoIsTapping() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var sh = ss.getSheetByName(TRIP_SHEET);

  if (!sh || sh.getLastRow() < 2) {
    ui.alert("Nothing recorded yet. Trip Events fills up as drivers tap.");
    return;
  }

  var vals = sh.getRange(2, 1, sh.getLastRow() - 1,
                         Math.min(TRIP_HEADERS.length, sh.getMaxColumns())).getValues();
  var runs = {};

  vals.forEach(function (r) {
    var status = String(r[11] || "").trim().toLowerCase();
    if (status === "undone" || status === "rehearsal") return;
    var key = anyToKey(r[2]); if (!key) return;
    var id  = key + "|" + String(r[3] || "").trim();
    if (!runs[id]) {
      runs[id] = { key: key, route: String(r[3] || "").trim(),
                   driver: String(r[4] || "").trim(),
                   taps: 0, started: 0, ended: 0 };
    }
    var ev = String(r[5] || "").trim().toLowerCase();
    var at = r[9] instanceof Date ? r[9].getTime() : 0;
    if (ev === "start") {
      runs[id].started = at;
      /* Anything beginning "unchecked", not the bare word.
         The status column holds either "Unchecked" or "Unchecked (offline)",
         and the second one is the whole reason the two were separated: a run
         started in a blackspot is often nobody's fault. Testing for equality
         meant precisely those runs were left out of this report, so the number
         at the bottom quietly under-counted the thing it exists to count. */
      if (status.indexOf("unchecked") === 0) runs[id].unchecked = true;
    }
    else if (ev === "end") runs[id].ended = at;
    else runs[id].taps++;
    if (String(r[4] || "").trim()) runs[id].driver = String(r[4] || "").trim();
  });

  /* How many taps that run SHOULD have had: stops on the route with somebody
     booked. That is the whole comparison. */
  var stops = readBusStops(ss).filter(function (s) { return !s.arrival; });

  var lines = Object.keys(runs).sort().reverse().slice(0, 12).map(function (id) {
    var r = runs[id];
    var counts = bookingCounts(ss, r.key);
    var due = stops.filter(function (s) {
      return s.route === r.route && (counts[s.id] || 0) > 0;
    }).length;

    var mins = (r.started && r.ended) ? Math.round((r.ended - r.started) / 60000) : null;
    return Utilities.formatDate(keyToDate(r.key), Session.getScriptTimeZone(), "d MMM") +
           "  " + r.route +
           "\n    " + (r.driver || "unnamed") +
           "\n    " + r.taps + " of " + due + " stops tapped" +
           (due && r.taps >= due ? "  \u2713" : "") +
           (mins !== null ? "\n    " + mins + " minutes end to end" :
            r.started ? "\n    started, never ended" : "\n    never started") +
           (r.unchecked ? "\n    STARTED WITH NO CHECK RECORDED" : "");
  });

  var unchecked = Object.keys(runs).filter(function (k) { return runs[k].unchecked; }).length;

  ui.alert("Who is tapping",
    "Most recent runs first.\n\n" + lines.join("\n\n") +
    "\n\nStops tapped counts only stops that had somebody booked. " +
    "Empty stops need no tap." +
    (unchecked
      ? "\n\n" + unchecked + " run" + (unchecked > 1 ? "s were" : " was") +
        " started with no walkaround recorded on that phone. Worth asking " +
        "about: if that number climbs, the check is being skipped rather " +
        "than the record being lost."
      : "\n\nEvery run had a check recorded first."),
    ui.ButtonSet.OK);
}

/* Counts and trip state together, for the driver's screen. Both halves keep
   their own cache and their own life, so merging the request does not merge
   how fresh they are: counts still last twenty seconds and trip state ten. */
/**
 * Everything the driver's Stops and bookings screen needs, in one answer.
 *
 * Each part is fenced off from the others. This request is the whole of that
 * screen: the counts, the run, and whether the bus was checked. It used to be
 * one expression, so a fault anywhere in it failed the lot, and the phone
 * swallows a failed board silently by design — the screen simply stops
 * updating with nothing on it to say why. Two of these parts were new and
 * had never run against a real sheet when they were put in that position,
 * which was the wrong thing to do with the one call Sunday morning rests on.
 *
 * A part that fails now costs its own feature and nothing else: no check
 * state means the warning falls back to what the phone itself knows, and no
 * others means the driver picks his bus from an unordered pair, which is
 * where he was a week ago.
 */
function boardPayload(route) {
  var r = String(route || "").trim() || "North";
  /* Nothing is pre-filled. An empty object here would be indistinguishable
     from a real answer of "nobody booked anywhere", and the phone would
     dutifully wipe good numbers off the screen because a part it could not
     see had failed. A part that fails is ABSENT, and absent is the one thing
     the phone can safely tell from a fact. */
  var out = { ok: true };

  try {
    var counts = countsPayload();
    out.date = counts.date;
    out.counts = counts.counts;
  } catch (err) { out.countsError = String(err); }

  try { out.checks = checksToday(); }
  catch (err) { out.checksError = String(err); }

  try { out.others = runningRegs(r); }
  catch (err) { out.othersError = String(err); }

  try { out.trip = tripDriverPayload(r); }
  catch (err) { out.tripError = String(err); }

  return out;
}

/* The route names in the order the timetable lists them, without repeats. */
function routeNames(stops) {
  var seen = {}, out = [];
  (stops || []).forEach(function (s) {
    if (s.route && !seen[s.route]) { seen[s.route] = true; out.push(s.route); }
  });
  return out;
}

/**
 * Which bus every OTHER route currently has out.
 *
 *   { "North": "YS70 PWE" }
 *
 * With two buses this settles the second driver's choice by arithmetic: if
 * North has taken one, South is on the other. It is offered to him as the
 * obvious button and never as a decision already made on his behalf. He may
 * have swapped at the gate, and a registration the app assumed rather than
 * one he tapped would put a bus on the record that never ran that route,
 * which is the very hole the registration was added to close.
 *
 * Runs in progress only. A route that has finished tells you nothing about
 * which bus is standing free now.
 */
function runningRegs(exceptRoute) {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var key = runSunday();
  var out = {};
  routeNames(readBusStops(ss)).forEach(function (rt) {
    if (rt === exceptRoute) return;
    var t = tripState(ss, key, rt);
    if (t.started && !t.ended && t.reg) out[rt] = t.reg;
  });
  return out;
}

/**
 * Has anyone checked this bus today, and did the check stop it.
 *
 * The question the app could never ask. A driver's phone knows only what that
 * driver signed on that phone, so a walkaround done by the coordinator, done
 * on the tablet, or done before a reinstall all read as no check at all. The
 * warning fired at honest men often enough that it stopped meaning anything.
 *
 * Answered per registration, because "was there a check today" is the wrong
 * question the moment two buses go out: on a two-route Sunday it would tell
 * the South driver his unchecked bus was fine on the strength of somebody
 * else's walkaround on the North one.
 *
 *   { "NH56 FWP": { state: "ok"|"stopped", at: ms, driver: "" }, ... }
 *
 * The newest check for each bus wins, so a stop that has since been fixed and
 * re-checked clears, and a clear check followed by a stop does not.
 *
 * Cached for thirty seconds. Every phone on the trip screen asks every thirty
 * seconds, and this is a tail read of the Checks tab, not a full one.
 */
function checksToday() {
  var cache = CacheService.getScriptCache();
  var hit = null;
  try { hit = cache.get("checkstoday"); } catch (err) { hit = null; }
  if (hit) { try { return JSON.parse(hit); } catch (err) { /* rebuild */ } }

  var out = {};
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CHECKS_SHEET);
  if (sh && sh.getLastRow() > 1) {
    var now  = new Date();
    var from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var to   = from + 86400000;

    /* Same tail window as the mileage read, and for the same reason: this
       wants today, and walking four years of rows to find it would make the
       app heavier every week with nothing on screen to say why. */
    // Columns: 1 Received, 2 Check ID, 3 Date, 4 Time, 5 Vehicle,
    //          6 Registration, 7 Driver ... 11 Outcome
    var lastRow  = sh.getLastRow();
    var firstRow = Math.max(2, lastRow - MILEAGE_SCAN_ROWS + 1);
    var rows = sh.getRange(firstRow, 1, lastRow - firstRow + 1, 11).getValues();

    rows.forEach(function (r) {
      var reg = String(r[5] || "").trim();
      if (!reg) return;
      /* See checkMoment: Received when it is present and not in the future,
         and the row's own Date and Time otherwise. */
      var when = checkMoment(r[0], r[2], r[3]);
      if (!when || when < from || when >= to) return;
      if (out[reg] && out[reg].at >= when) return;
      out[reg] = {
        state: String(r[10] || "").trim().toUpperCase() === "STOPPED" ? "stopped" : "ok",
        at: when,
        driver: String(r[6] || "").trim()
      };
    });
  }

  try { cache.put("checkstoday", JSON.stringify(out), 30); }
  catch (err) { /* it just gets built again */ }
  return out;
}

/* Which Sunday a bare link is for. This Sunday until bookings close on the
   morning, then next Sunday. Somebody opening the link at ten past ten on a
   Sunday is not booking the bus that has already left. */
/**
 * The Sunday being DRIVEN. Today if today is Sunday, otherwise the next one.
 *
 * Not the same question as busCurrentSunday below, and confusing the two was a
 * real fault. That one rolls forward the moment bookings close, which is right
 * for the booking form: somebody opening the link at ten past ten on a Sunday
 * is booking for next week, not for the bus that has already left.
 *
 * It is wrong for everything else. The run, the counts, the taps and the
 * passenger's live view are all about the bus that is out NOW. Keying those to
 * busCurrentSunday meant that at 09:30 on a Sunday, at the exact minute the
 * run begins, the whole of the tracking jumped a week: the driver's board
 * showed no run in progress, every passenger was told bookings were still
 * open and shown nothing, and any tap he made was filed against the following
 * Sunday. The rehearsal never caught it because a rehearsal forces that gate
 * open and hides the roll.
 *
 * The client has always used this definition. It was only the server that
 * disagreed.
 */
function runSunday() {
  return dateToKey(sundayOf(new Date()));
}

/**
 * Has this Sunday's service finished, so that next week may be booked?
 *
 * Three answers, in order.
 *   Before the cutoff, no. Today is still being booked.
 *   After the backstop, yes, whatever the driver did or did not tap.
 *   Between the two, yes only once every run that started has ended.
 *
 * A Sunday where nobody starts a run at all therefore waits for the backstop,
 * which is correct: the bus may still be out with an app that was never
 * opened, and nobody is booking at that hour regardless.
 */
function runComplete() {
  var key = runSunday();
  if (!bookingsClosed(key)) return false;

  var backstop = keyToDate(key);
  backstop.setHours(RUN_BACKSTOP_HOUR, RUN_BACKSTOP_MIN || 0, 0, 0);
  if (new Date() >= backstop) return true;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var routes = [];
  readBusStops(ss).forEach(function (st) {
    if (!st.arrival && routes.indexOf(st.route) < 0) routes.push(st.route);
  });
  if (!routes.length) return true;

  var started = 0, ended = 0;
  routes.forEach(function (r) {
    var t = tripState(ss, key, r);
    if (t.started) { started++; if (t.ended) ended++; }
  });
  return started > 0 && started === ended;
}

/**
 * Which Sunday the booking page is offering. Today's until the service is
 * over, then next week's.
 */
function busCurrentSunday() {
  var sunday = sundayOf(new Date());
  if (runComplete()) sunday = addWeeks(sunday, 1);
  return dateToKey(sunday);
}

/* Who is actually driving one route this Sunday, with a number a phone can
   open WhatsApp on — or null, which is the ordinary answer and not a fault.

   Cover first, pattern last: actual beats primary beats the repeating
   pattern, so a swap the coordinator has written on the Rota tab is the name
   that reaches the passenger, not the man who was originally down for it.

   Names are matched with the ends trimmed and the case ignored, because the
   name here has come round through the Rota tab and the one it is matched
   against sits on the Drivers tab. Two spellings of one man is a silent miss
   otherwise, and a silent miss here looks exactly like a driver who never
   gave a number. */
function driverOnDuty(ss, key, route) {
  var flat = function (s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); };

  /* The Phone column first, and out at once if it is empty.

     This whole lookup only ever produces something when somebody has a
     number against their name, and by decision nobody does — the WhatsApp
     button is deliberately dormant. It was still reading the Rota tab and
     the Drivers tab twice over on every passenger page load after 09:30,
     doing three reads to arrive at nothing, on the one morning of the week
     the sheet is busiest. One read now answers it. */
  var drivers = readDrivers(ss);
  var anyPhone = false;
  for (var i = 0; i < drivers.length; i++) { if (drivers[i].phone) { anyPhone = true; break; } }
  if (!anyPhone) return null;

  var d = keyToDate(key);
  var row = null;
  readRotaRows(ss).forEach(function (r) { if (r.date === key) row = r; });
  var pattern = bothPatterns(ss);

  var who;
  if (route === "South") {
    who = (row && (row.actual2 || row.primary2)) || southDriver(d, pattern.south);
  } else {
    who = (row && (row.actual || row.primary)) || patternDriver(d, pattern.north);
  }
  if (!who) return null;

  var hit = null;
  drivers.forEach(function (x) { if (!hit && flat(x.name) === flat(who)) hit = x; });
  if (!hit || !hit.phone) return null;

  /* wa.me wants digits only, in international form. A UK mobile written the
     way anybody actually writes it starts 07, so the leading nought becomes
     44. Anything already carrying a country code is left alone. Too short to
     be a real number and nothing is sent, because a WhatsApp button that
     opens a chat with a stranger is worse than no button. */
  var digits = String(hit.phone).replace(/\D/g, "");
  if (digits.charAt(0) === "0") digits = "44" + digits.substring(1);
  if (digits.length < 11) return null;

  return { name: hit.name, wa: digits, route: route };
}

function busPayload(key, ref) {
  /* No date in the link is the normal case now. Work it out here. */
  var rolled = false;
  if (!key) {
    var todaySunday = dateToKey(sundayOf(new Date()));
    key = busCurrentSunday();
    rolled = (key !== todaySunday);
  }
  if (!busDateAllowed(key)) return { ok: false, error: "That link is out of date. Ask for the current one." };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var counts = bookingCounts(ss, key);
  var mine = null;
  if (ref) {
    readBookings(ss, key).forEach(function (b) { if (b.device === ref) mine = b; });
  }

  /* The driver's number goes out under four conditions at once, and it is the
     conjunction that keeps this proportionate: only once bookings have shut,
     only to a phone holding a booking, only for the route that booking is on,
     and only the one driver on duty. A passenger with no booking, or any
     stranger who finds the address, gets nothing.

     Wrapped, and deliberately. Everything else in this payload is what the
     page needs to function; this is a convenience button. If the rota, the
     Drivers tab or the phone column is in a state this cannot read, the
     button is absent and the page works exactly as it did before. A new
     convenience must not be able to take Sunday morning down with it. */
  var driver = null;
  try {
    if (mine && bookingsClosed(key)) {
      var myRoute = "";
      readBusStops(ss).forEach(function (s) {
        if (s.id === mine.stopId) myRoute = s.route;
      });
      if (myRoute) driver = driverOnDuty(ss, key, myRoute);
    }
  } catch (err) { driver = null; }

  return {
    ok: true,
    date: key,
    closed: bookingsClosed(key),
    /* Separate from closed on purpose. A rehearsal must not tell the page
       that bookings have shut, or a church member booking on a Tuesday would
       be turned away by a test. It only tells the page to start watching. */
    rehearsal: !!rehearsalOn(),
    rolled: rolled,
    cutoff: cutoffWords(),
    stops: readBusStops(ss).filter(function (s) { return !s.arrival; }),
    arrivals: readBusStops(ss).filter(function (s) { return s.arrival; }),
    counts: counts,
    driver: driver,
    mine: mine ? { stopId: mine.stopId, seats: mine.seats } : null
  };
}

/**
 * One booking per device per Sunday. Sending again replaces it, so changing
 * your mind or cancelling is the same action rather than a second row.
 */
function handleBooking(b) {
  if (!b) return reply({ ok: false, error: "empty booking" });

  /* One at a time. This reads the tab to find the row belonging to a device
     and then writes to that row by number, so two people confirming in the
     same second could each be writing where the other has just looked. Rare,
     and silent when it happens, which is the sort of thing worth six lines. */
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (err) { return reply({ ok: false, error: "The record is busy. Tap Confirm again." }); }
  try {
    return handleBookingLocked(b);
  } finally {
    try { lock.releaseLock(); } catch (err) {}
  }
}

function handleBookingLocked(b) {
  var key = String(b.date || "") || busCurrentSunday();
  if (!busDateAllowed(key)) return reply({ ok: false, error: "That link is out of date. Ask for the current one." });

  var ref = String(b.ref || "").replace(/[^A-Za-z0-9]/g, "").substring(0, 32);
  if (!ref) return reply({ ok: false, error: "no device handle" });

  var seats = Math.max(0, Math.min(12, Number(b.seats) || 0));
  var stopId = String(b.stopId || "").trim();

  /* Closed, and exactly one thing is still allowed: withdrawing.
     A seat cannot be taken, moved or resized once the driver is working from
     the list — that list is fixed at the cutoff and he is reading it at the
     kerb. But somebody who is no longer coming is worth hearing at any hour,
     because the alternative is a driver waiting at a stop for nobody, and the
     only route they had was a message in a group he is not reading while
     driving. */
  var late = false;
  if (bookingsClosed(key)) {
    /* The page may also have been open in a pocket since before the cutoff,
       so name the Sunday that shut rather than failing mute. */
    if (seats > 0) {
      return reply({ ok: false, error: "Bookings for that Sunday have closed. Reopen the page for the next one." });
    }
    /* And only while the bus is still out. Once the run is over the list is
       history, and a withdrawal written into it afterwards would quietly
       disagree with what the driver actually worked from that morning. */
    if (key !== runSunday() || runComplete()) {
      return reply({ ok: false, error: "That Sunday is over. Reopen the page for the next one." });
    }
    late = true;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stop = null;
  readBusStops(ss).forEach(function (s) { if (s.id === stopId && !s.arrival) stop = s; });
  if (seats > 0 && !stop) return reply({ ok: false, error: "unknown stop" });

  var sh = ensureBookings(ss);
  var existing = null;
  readBookings(ss, key).forEach(function (x) { if (x.device === ref) existing = x; });

  /* Nothing booked, or cancelling. Both end the same way: no live row. */
  if (!seats) {
    if (existing) {
      sh.getRange(existing.row, 8).setValue("Cancelled");
      /* Exactly "Cancelled", never a status of its own. readBookings drops
         that one word and counts EVERYTHING ELSE as booked, so a tidy-looking
         "Cancelled late" would leave the seat sitting on the driver's screen:
         the precise opposite of what the passenger just asked for. The
         lateness goes in a note instead, which no code reads and anybody
         opening the tab can see. */
      if (late) {
        try {
          sh.getRange(existing.row, 8).setNote(
            "Withdrew at " +
            Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HH:mm") +
            ", after bookings closed. The driver may already have been on the road.");
        } catch (err) { /* the withdrawal matters, the note does not */ }
      }
    }
    dropCountsCache(key);
    return reply({ ok: true, cancelled: true, late: late, mine: null,
                   counts: bookingCounts(ss, key) });
  }

  if (existing) {
    sh.getRange(existing.row, 3, 1, 4)
      .setValues([[stop.route, stop.id, stop.stop, seats]]);
    sh.getRange(existing.row, 8).setValue("Booked");
    sh.getRange(existing.row, 1).setValue(new Date());
  } else {
    sh.appendRow([new Date(), key, stop.route, stop.id, stop.stop, seats, ref, "Booked"]);
  }

  /* The driver's screen is polling this. Clear it now rather than leaving a
     booking invisible until the cache lapses. */
  dropCountsCache(key);

  /* The counts go back with the answer.

     The page used to take this reply, throw it away, and fetch the whole
     payload again to find out what it already knew: every stop, every count,
     the arrival list, a second redirect and a second cold start. Two calls to
     move one booking. Reading the counts here costs one more read inside a
     call that is already open, which is nothing beside a whole round trip. */
  return reply({ ok: true, stopId: stop.id, seats: seats,
                 mine: { stopId: stop.id, seats: seats },
                 counts: bookingCounts(ss, key) });
}

/* There is nothing to generate any more, but the menu item stays: it is where
   somebody goes when they want the address, and it is the only place that
   says out loud which Sunday the page is currently offering. */
function busLinkForSunday() {
  var ui = SpreadsheetApp.getUi();
  var key = busCurrentSunday();
  var when = Utilities.formatDate(keyToDate(key), Session.getScriptTimeZone(), "EEEE d MMMM");
  var link = BUS_PAGE_URL;
  var note = "This address never changes. Pin it in the group once and it stays " +
             "right: the page works out which Sunday it is by itself.\n\n";

  ui.alert("The bus booking page",
    link + "\n\n" +
    note +
    "It is currently taking bookings for " + when + ".\n" +
    "Bookings close " + cutoffWords() + ".",
    ui.ButtonSet.OK);
}

function ensureDrivers(ss) {
  var existing = ss.getSheetByName(DRIVERS_SHEET);
  var sh = sheet(ss, DRIVERS_SHEET, DRIVERS_HEADERS);

  /* Route arrived after this tab was already in use, so a sheet in service
     has six columns and no seventh heading. Written in here rather than by
     hand, but ONLY when column G is genuinely empty. If somebody has put
     something of their own there, leave it alone and let the Drivers tab
     check report it: silently relabelling a column that already holds data
     is how you lose data without anyone noticing. */
  if (existing) {
    var g1 = String(sh.getRange(1, 7).getValue() || "").trim();
    if (!g1) {
      sh.getRange(1, 7).setValue("Route").setFontWeight("bold");
      backfillRoutes(sh);
      sh.getRange(1, 7).setNote(
        "North or South. Blank counts as North, so rows written before the\n" +
        "South route started keep working without being edited.");
      sh.getRange("G2:G200").setDataValidation(listRule(["North", "South"]));
    }
    /* Phone arrived later still, and gets the same treatment: written only
       into a column that is genuinely empty, so nothing of anybody's is
       relabelled out from under them. */
    var h1 = String(sh.getRange(1, 8).getValue() || "").trim();
    if (!h1) {
      sh.getRange(1, 8).setValue("Phone").setFontWeight("bold");
      sh.getRange(1, 8).setNote(
        "Mobile number, for the WhatsApp button a passenger sees on Sunday\n" +
        "morning once bookings have closed.\n\n" +
        "READ THIS BEFORE FILLING IT IN. The number of whoever is driving\n" +
        "that Sunday is sent to the passenger page, which is public and has\n" +
        "no login. It goes out only on the day, only after 09:30, only to a\n" +
        "passenger holding a booking, and only for that one route — but it\n" +
        "does go out. Ask the driver first.\n\n" +
        "Leave blank and that driver simply has no button. Nothing breaks.");
    }
  }

  if (!existing) {
    SEED_DRIVERS.forEach(function (d) {
      sh.appendRow([d.name, d.role, "YES", d.order, "", "", d.route]);
    });
    sh.getRange("G2:G200").setDataValidation(listRule(["North", "South"]));
    sh.setColumnWidth(1, 150);
    sh.setColumnWidth(2, 160);
    sh.getRange("C2:C200").setDataValidation(listRule(["YES", "NO"]));
    sh.getRange(1, 4).setNote(
      "Number the repeating pattern here: 1, 2, 3, 4...\n" +
      "Each route is numbered separately, so both start at 1.\n" +
      "Leave blank for anyone who is not in the normal rotation.\n" +
      "Anyone marked Active can still be picked to cover a Sunday.");
    sh.getRange(1, 3).setNote(
      "NO removes someone from the app and from every dropdown.\n" +
      "Sundays they have already driven are left alone.");
  }
  return sh;
}

function ensureRota(ss) {
  var existing = ss.getSheetByName(ROTA_SHEET);
  var sh = sheet(ss, ROTA_SHEET, ROTA_HEADERS);

  /* sheet() only writes headings when it creates the tab, so a tab that
     already exists keeps whatever it was first given. Written again here so
     a rename actually reaches a sheet already in use. Safe to repeat: it is
     one write of one row, and nothing reads this tab by heading. */
  sh.getRange(1, 1, 1, ROTA_HEADERS.length).setValues([ROTA_HEADERS]).setFontWeight("bold");

  if (!existing) {
    sh.setColumnWidth(1, 110);
    sh.setColumnWidth(2, 150);
    sh.setColumnWidth(3, 160);
    sh.setColumnWidth(4, 145);
    sh.setColumnWidth(5, 150);
    sh.setColumnWidth(6, 160);
    sh.setColumnWidth(7, 240);
    sh.getRange(1, 3).setNote(
      "Leave blank when the scheduled driver is driving.\n" +
      "Fill it in only when somebody else is covering. The scheduled name\n" +
      "stays put, so you never lose sight of whose Sunday it was.");
    sh.getRange(1, 5).setNote("South Liverpool route. Leave these two columns blank until you run both routes.");
    rotaColours(sh);
  }

  fillRotaAhead(ss, sh);
  return sh;
}

/** Keeps the Rota tab filled from this Sunday out to the horizon. */
function fillRotaAhead(ss, sh) {
  sh = sh || ss.getSheetByName(ROTA_SHEET);
  if (!sh) return;

  var pattern = bothPatterns(ss);
  var have = {};
  readRotaRows(ss).forEach(function (r) { have[r.date] = true; });

  var start = sundayOf(new Date());
  var rows = [];
  for (var i = 0; i < ROTA_FILL_WEEKS; i++) {
    var d = addWeeks(start, i);
    var key = dateToKey(d);
    if (have[key]) continue;
    rows.push([d, patternDriver(d, pattern.north), "", "Confirmed",
               southDriver(d, pattern.south), "", "", "", ""]);
  }
  if (!rows.length) return;

  var first = sh.getLastRow() + 1;
  sh.getRange(first, 1, rows.length, 9).setValues(rows);
  sh.getRange(first, 1, rows.length, 1).setNumberFormat("dd/mm/yyyy");
  if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, 9).sort(1);
  refreshDropdowns();
}

/**
 * Status colours on column D.
 *
 * It used to read the existing rules, append five more, and write the lot
 * back, without ever removing the five it added last time. Every run of
 * Set up / refresh rota therefore left five more rules on the tab, all
 * identical, all on the same range, for ever. Nobody would notice until the
 * sheet started behaving oddly, which is roughly where this ended up.
 *
 * Its own rules are stripped first now, matched by the range and by the five
 * words it writes. Rules somebody added by hand are left alone.
 */
function rotaColours(sh) {
  var range = sh.getRange("D2:D3000");
  var a1 = range.getA1Notation();

  var mine = {};
  ROTA_STATUS.forEach(function (v) { mine[v] = true; });

  var kept = sh.getConditionalFormatRules().filter(function (r) {
    var ranges = r.getRanges() || [];
    var here = ranges.length === 1 && ranges[0].getA1Notation() === a1;
    if (!here) return true;                      // not ours: leave it

    var cond = r.getBooleanCondition && r.getBooleanCondition();
    if (!cond) return true;
    var vals = cond.getCriteriaValues() || [];
    return !(vals.length && mine[String(vals[0])]);
  });

  function rule(value, bg, fg) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(value).setBackground(bg).setFontColor(fg)
      .setRanges([range]).build();
  }
  kept.push(rule("Confirmed", "#E6F2EB", "#146B41"));
  kept.push(rule("Change requested", "#FDF3E2", "#8A5300"));
  kept.push(rule("Covered", "#EEF3F8", "#1B3A57"));
  kept.push(rule("Cancelled/declined", "#F1F1F1", "#666666"));
  kept.push(rule("No driver assigned", "#FBE9E7", "#A8231B"));
  sh.setConditionalFormatRules(kept);
}

/**
 * Rebuilds every dropdown from the Drivers tab. Run it after adding someone
 * to the register, or use the Minibus menu.
 */
/**
 * Dropdown lists and the status colours.
 *
 * Every step here is guarded separately and returns what it could not do,
 * rather than throwing. None of it is load bearing: a missing dropdown costs
 * you a tap and a missing colour costs you nothing, while the things that run
 * AFTER this in setUpEverything are the scheduled emails, the rota version
 * and the sheet protection. Letting a colour take those down was the wrong
 * trade by a wide margin.
 *
 * The failure that prompted this: "This operation is not allowed on cells in
 * typed columns". A column on the Rota tab had become a typed column, which
 * happens when a sheet is converted to a Table or a dropdown is added through
 * the Insert menu rather than by this script. Conditional formatting is not
 * allowed on those, so the colours failed and took the whole setup with them.
 */
function refreshDropdowns() {
  var skipped = [];
  function step(what, fn) {
    try { fn(); }
    catch (err) { skipped.push(what + " (" + String(err.message || err) + ")"); }
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var drivers = readDrivers(ss);
  if (!drivers.length) {
    drivers = SEED_DRIVERS.map(function (d) {
      return { name: d.name, active: true, order: Number(d.order) || 0,
               route: d.route || "North" };
    });
  }

  var active = drivers.filter(function (d) { return d.active; }).map(function (d) { return d.name; });
  var north  = primaryPattern(drivers, "North");
  var south  = primaryPattern(drivers, "South");

  var rota = ss.getSheetByName(ROTA_SHEET);
  if (rota) {
    /* Scheduled columns list that route's own rotation, so the usual name is
       one tap away. Column E used to be handed the North list, which offered
       the wrong four names for the South route.

       Cover columns list EVERYONE active, both routes and backups included.
       Anybody can cover for anybody: a driver off on holiday should never be
       stuck because the only people offered were on their own route.

       None of these lists is a restriction. Every one of them allows a value
       typed in by hand, so you can always put a name in a scheduled column
       that the pattern does not expect. The list is a convenience, not a
       gate. */
    step("Rota scheduled North list", function () {
      rota.getRange("B2:B3000").setDataValidation(listRule(north.length ? north : active)); });
    step("Rota scheduled South list", function () {
      rota.getRange("E2:E3000").setDataValidation(listRule(south.length ? south : active)); });
    step("Rota cover lists", function () {
      rota.getRange("C2:C3000").setDataValidation(listRule(active));
      rota.getRange("F2:F3000").setDataValidation(listRule(active)); });
    /* Colours BEFORE the dropdown, deliberately.

       The dropdown is what makes column D a typed column, and conditional
       formatting is refused on one of those. Applying the colours while the
       column is still plain is the only order that has a chance of working.
       If it still fails, nothing is lost: a modern dropdown draws its own
       coloured chips, so the status stays perfectly readable. */
    step("Rota status colours", function () { rotaColours(rota); });
    step("Rota status list", function () {
      rota.getRange("D2:D3000").setDataValidation(listRule(ROTA_STATUS)); });
  }

  var reqs = ss.getSheetByName(REQUESTS_SHEET);
  if (reqs) {
    step("Requests lists", function () {
      reqs.getRange("H2:H2000").setDataValidation(listRule(REQ_STATUS));
      reqs.getRange("J2:J2000").setDataValidation(listRule(active)); });
    step("Requests column widths", function () {
      reqs.setColumnWidth(6, 300);
      reqs.setColumnWidth(8, 120);
      reqs.setColumnWidth(10, 180); });
  }

  try { PropertiesService.getScriptProperties()
          .setProperty("dropdownsSkipped", JSON.stringify(skipped)); }
  catch (err) {}
  return skipped;
}

/* What to tell somebody who has hit the typed column problem. The colours and
   the lists are conveniences; the sheet works without them. What matters is
   that they know why, and that it is undoable. */
function typedColumnAdvice() {
  return "A typed column is one Google has given a type of its own, which a " +
         "dropdown does. Conditional formatting is refused on those.\n\n" +
         "If the skipped step is the Rota status colours, there is nothing to " +
         "do and nothing to fix. The dropdown on that column draws its own " +
         "coloured chips, so the status reads perfectly well without them. " +
         "Converting the column back to a range would not help, because this " +
         "app puts the dropdown back the next time you run Set up.\n\n" +
         "If a step other than the colours was skipped, that is worth looking " +
         "at: check whether the tab has been turned into a Table, under " +
         "Format > Convert to range.\n\n" +
         "Nothing here is data. These are lists and colours.";
}

/* The menu version, which says what happened. refreshDropdowns itself stays
   silent because it is also called from setUpEverything and from ensureRota,
   and neither wants a dialog. */
function refreshDropdownsMenu() {
  var ui = SpreadsheetApp.getUi();
  var skipped = refreshDropdowns();
  if (!skipped.length) {
    SpreadsheetApp.getActiveSpreadsheet().toast("Dropdowns and colours refreshed.", "Minibus", 5);
    return;
  }
  ui.alert("Refreshed, with " + skipped.length + " skipped",
    "These could not be applied:\n\n  \u2022  " + skipped.join("\n\n  \u2022  ") +
    "\n\n" + typedColumnAdvice(), ui.ButtonSet.OK);
}

function listRule(values) {
  var clean = values.filter(function (v) { return String(v || "").length; });
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(clean, true)
    .setAllowInvalid(true)
    .build();
}

function applyRotaValidation(sh, row) {
  var drivers = readDrivers(SpreadsheetApp.getActiveSpreadsheet());
  var active = drivers.filter(function (d) { return d.active; }).map(function (d) { return d.name; });
  if (!active.length) active = SEED_DRIVERS.map(function (d) { return d.name; });
  sh.getRange(row, 3).setDataValidation(listRule(active));
  sh.getRange(row, 4).setDataValidation(listRule(ROTA_STATUS));
}

function applyRequestValidation(sh, row) {
  var drivers = readDrivers(SpreadsheetApp.getActiveSpreadsheet());
  var active = drivers.filter(function (d) { return d.active; }).map(function (d) { return d.name; });
  if (!active.length) active = SEED_DRIVERS.map(function (d) { return d.name; });
  sh.getRange(row, 8).setDataValidation(listRule(REQ_STATUS));
  sh.getRange(row, 10).setDataValidation(listRule(active));
}

/** Pushes the filled horizon another 26 weeks out. Menu item. */
/**
 * Creates a row for one Sunday, however far ahead, so you have a cell to
 * click. The rota only holds Sundays, so anything else is refused rather
 * than quietly written to a row the app will never look at.
 */
function addSunday() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt("Add a Sunday to the rota",
    "Which Sunday? Type it as dd/mm/yyyy.", ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var key = anyToKey(res.getResponseText().trim());
  if (!key) { ui.alert("That did not look like a date. Use dd/mm/yyyy."); return; }

  var d = keyToDate(key);
  if (d.getDay() !== 0) {
    ui.alert(Utilities.formatDate(d, Session.getScriptTimeZone(), "d MMMM yyyy") +
             " is a " + Utilities.formatDate(d, Session.getScriptTimeZone(), "EEEE") +
             ". The rota only holds Sundays.");
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureRotaSheets(ss);
  var sh = ss.getSheetByName(ROTA_SHEET);
  if (findRotaRow(sh, key)) { ui.alert("That Sunday is already on the rota."); return; }

  appendRotaRow(ss, sh, d);
  if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, 9).sort(1);
  bumpRotaVersion();
  ui.alert(Utilities.formatDate(d, Session.getScriptTimeZone(), "d MMMM yyyy") +
           " added, with the driver the pattern gives. Change it in the Rota tab.");
}

function extendRota() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ROTA_FILL_WEEKS = 52;
  fillRotaAhead(ss);
  var n = ss.getSheetByName(ROTA_SHEET).getLastRow() - 1;
  ss.toast("Rota now runs a year ahead. " + n + " Sundays.", "Minibus", 6);
}

/**
 * Sends one test email and tells you exactly what happened. Run it from the
 * Minibus menu whenever notifications stop arriving, instead of guessing.
 *
 * Worth knowing before you do: a CLEAR check never sends an email. Only a
 * defect or a stopped bus does. If every recent check came back clean, the
 * silence is the app working, not failing.
 */
function sendTestEmail() {
  var msg;
  var left = -1;
  try { left = MailApp.getRemainingDailyQuota(); } catch (err) { left = -1; }

  if (!COORDINATOR_EMAIL) {
    msg = "COORDINATOR_EMAIL is blank at the top of Code.gs, so nothing is ever sent.";
  } else if (left === 0) {
    msg = "Google's daily email allowance for this account is used up. It frees up " +
          "again about 24 hours after the first one went out. Nothing is wrong " +
          "with the script.";
  } else {
    MailApp.sendEmail({
      to: COORDINATOR_EMAIL,
      subject: "Minibus app test",
      body: "Test from the minibus app. If you can read this, notifications are working.\n\n" +
            sheetUrl(),
      htmlBody: htmlShell("Minibus app test", "#1B3A57",
        ["If you can read this, notifications are working.",
         "&nbsp;",
         "Emails this account can still send today: <b>" + (left < 0 ? "unknown" : left - 1) + "</b>"],
        "Open spreadsheet", CHECKS_SHEET)
    });
    msg = "Sent to " + COORDINATOR_EMAIL + ".\n\n" +
          "Emails left today: " + (left < 0 ? "unknown" : left - 1) + "\n\n" +
          "If it has not arrived in a few minutes, look in spam. Apps Script mail " +
          "to Yahoo often lands there the first time.";
  }

  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { Logger.log(msg); }
  return msg;
}

/* ---- weekly digest ----------------------------------------------------- */

/* The Sunday just gone, or today if today is Sunday. */
function lastSunday(now) {
  var x = new Date((now || new Date()).getTime());
  x = new Date(x.getFullYear(), x.getMonth(), x.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}

/* Registrations the sheet has ever seen, so there is no second fleet list to
   keep in step with config.js. */
function knownRegs(ss) {
  var sh = ss.getSheetByName(CHECKS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(2, 6, sh.getLastRow() - 1, 1).getValues();
  var seen = {}, out = [];
  vals.forEach(function (r) {
    var reg = String(r[0] || "").trim();
    if (reg && !seen[reg]) { seen[reg] = true; out.push(reg); }
  });
  return out.sort();
}

/* Every check recorded against a given Sunday, newest first. */
function checksOn(ss, key) {
  var sh = ss.getSheetByName(CHECKS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var width = Math.max(18, Math.min(sh.getLastColumn(), 24));
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();
  var out = [];
  vals.forEach(function (r) {
    if (anyToKey(r[2]) !== key) return;
    out.push({ reg: String(r[5] || "").trim(), driver: String(r[6] || ""),
               outcome: String(r[10] || ""), type: String(r[17] || ""),
               time: String(r[3] || ""),
               fuel: String(r[22] || ""), jobs: String(r[23] || "") });
  });
  return out;
}

/* Open defects per registration. Anything not Fixed or Not a defect. */
function openDefectsByReg(ss) {
  var sh = ss.getSheetByName(DEFECTS_SHEET);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues();
  vals.forEach(function (r) {
    var status = String(r[8] || "");
    if (status === "Fixed" || status === "Not a defect") return;
    var reg = String(r[3] || "").trim();
    if (!reg) return;
    if (!out[reg]) out[reg] = [];
    out[reg].push({ reg: reg, item: String(r[5] || ""), crit: String(r[6] || "") === "YES",
                    note: String(r[7] || ""), date: anyToKey(r[2]) });
  });
  return out;
}

/**
 * One email a week, whether or not anything happened. Defect emails only fire
 * when there is a defect, so silence is ambiguous: it means a clean week, or
 * it means the mail never arrived. This makes silence mean something. If the
 * digest stops turning up, the email path itself is broken.
 */
/**
 * Sunday 10:45. Tells you which bus went out without an inspection.
 *
 * Note what this is NOT. At 10:45 North left around 09:50 and South around
 * 10:35, so both are already carrying people. Nobody is going to be caught
 * before they pull out, and an email pretending otherwise would send you
 * chasing a bus that has gone.
 *
 * It is a record that a vehicle went out unchecked, and a prompt to inspect
 * it on return, while whatever it did that morning is still findable. That
 * is worth having even though it is late, and it is worth reading as what it
 * is rather than as a warning.
 *
 * Deliberately silent when both are checked. Emailing every clean check would
 * put two messages a Sunday in front of you that both say nothing is wrong,
 * and within a month you would skim them, including the one that mattered.
 */
function missingCheckAlert() {
  if (!COORDINATOR_EMAIL) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  if (now.getDay() !== 0) return;                  // Sundays only

  var key = dateToKey(now);
  var done = {};
  checksOn(ss, key).forEach(function (c) { if (c.reg) done[c.reg] = c; });

  /* Every bus the app has ever recorded a check for. Reading it from history
     rather than a list here means adding a bus needs no code change: its
     first check puts it on the list from then on. */
  var expected = knownRegs(ss).filter(function (reg) { return !done[reg]; });
  if (!expected.length) return;                    // all checked, say nothing

  /* Who is down to drive, so you know whose phone to pick up rather than
     working it out from the rota yourself. */
  var row = null;
  readRotaRows(ss).forEach(function (r) { if (r.date === key) row = r; });
  var north = row ? String(row.actual || row.primary || "").trim() : "";
  var south = row ? String(row.actual2 || row.primary2 || "").trim() : "";

  var when = Utilities.formatDate(now, tz, "EEEE d MMMM");
  var many = expected.length > 1;
  var lines = [
    "<b>" + (many ? "These buses went out" : "This bus went out") +
      " with no pre-drive check</b> this morning, " + esc(when) + ".",
    "&nbsp;"
  ];
  expected.forEach(function (reg) { lines.push("\u2022 <b>" + esc(reg) + "</b>"); });

  lines.push("&nbsp;");
  if (north || south) {
    lines.push("Down to drive today:");
    if (north) lines.push("\u2022 North Liverpool: <b>" + esc(north) + "</b>");
    if (south) lines.push("\u2022 South Liverpool: <b>" + esc(south) + "</b>");
    lines.push("&nbsp;");
  }
  if (Object.keys(done).length) {
    lines.push("Checked this morning: " + Object.keys(done).join(", ") + ".");
    lines.push("&nbsp;");
  }
  lines.push("<b>Please have " + (many ? "them" : "it") + " inspected on return</b>, " +
             "while anything that happened this morning can still be found. " +
             "Both routes are already out by now, so this is not a bus to catch " +
             "before it leaves.");
  lines.push("&nbsp;");
  lines.push("Sent once. If a check is recorded later you will not hear again " +
             "either way.");

  var plain = [(many ? "These buses" : "This bus") +
               " went out with no pre-drive check on " + when + ".", ""]
    .concat(expected.map(function (r) { return "  " + r; }));
  if (north) plain.push("", "North Liverpool: " + north);
  if (south) plain.push("South Liverpool: " + south);
  plain.push("", "Please have " + (many ? "them" : "it") + " inspected on return.");

  MailApp.sendEmail({
    to: COORDINATOR_EMAIL,
    subject: "Minibus: " + expected.join(", ") + " went out unchecked",
    body: plain.join("\n"),
    /* Amber, not red. A late check is usually a late check, not a crisis,
       and the red shell belongs to a bus that has been stopped. */
    htmlBody: htmlShell("Went out unchecked", "#8A6116", lines, "Open the checks", CHECKS_SHEET)
  });
}

function installMissingCheckAlert() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "missingCheckAlert") ScriptApp.deleteTrigger(t);
  });
  /* 10:45. Both buses are out by then, so this reports rather than warns. */
  ScriptApp.newTrigger("missingCheckAlert")
    .timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(10).nearMinute(45).create();
}

function weeklyDigest() {
  if (!COORDINATOR_EMAIL) return "COORDINATOR_EMAIL is blank, so nothing was sent.";

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sunday = lastSunday(new Date());
  var key = dateToKey(sunday);
  var pretty = Utilities.formatDate(sunday, Session.getScriptTimeZone(), "d MMMM yyyy");

  var regs = knownRegs(ss);
  var done = checksOn(ss, key);
  var open = openDefectsByReg(ss);

  var byReg = {};
  done.forEach(function (c) { if (!byReg[c.reg]) byReg[c.reg] = c; });

  var missed = [], lines = [];

  regs.forEach(function (reg) {
    var c = byReg[reg];
    var n = (open[reg] || []).length;
    var tail = n ? " &middot; <b>" + n + " open defect" + (n > 1 ? "s" : "") + "</b>" : "";
    if (c) {
      lines.push("<b>" + reg + "</b> &mdash; checked by " + (c.driver || "someone") +
                 (c.outcome ? " (" + c.outcome + ")" : "") +
                 (c.fuel ? " &middot; fuel " + esc(c.fuel) : "") + tail);
    } else {
      missed.push(reg);
      lines.push("<b>" + reg + "</b> &mdash; <span style=\"color:#A8231B\"><b>no check recorded</b></span>" + tail);
    }
  });

  if (!regs.length) lines.push("No checks have ever been recorded, so there is nothing to report yet.");

  var colour = missed.length ? "#A8231B" : "#146B41";
  var title = missed.length
    ? "Sunday " + pretty + ": " + missed.length + " bus" + (missed.length > 1 ? "es" : "") + " not checked"
    : "Sunday " + pretty + ": all checked";

  /* The ordinary jobs nobody records: a wash, a fill, air in the tyres.
     They are not defects and never will be, so this digest is the only place
     they surface anywhere you would act on them. */
  var jobs = [];
  done.forEach(function (c) {
    if (!c.jobs) return;
    c.jobs.split(",").forEach(function (j) {
      j = j.trim();
      if (j) jobs.push(c.reg + ": " + j);
    });
  });
  if (jobs.length) {
    lines.push("&nbsp;");
    lines.push("<b>To arrange</b>");
    jobs.forEach(function (j) { lines.push("&bull; " + esc(j)); });
  }

  var all = [];
  Object.keys(open).forEach(function (reg) { all = all.concat(open[reg]); });
  if (all.length) {
    lines.push("&nbsp;");
    lines.push("<b>Open defects</b>");
    all.slice(0, 15).forEach(function (d) {
      lines.push("&bull; " + esc(d.reg) + ": " + esc(d.item) + (d.crit ? " (critical)" : "") +
                 (d.note ? " &mdash; " + esc(d.note) : ""));
    });
    if (all.length > 15) lines.push("&bull; and " + (all.length - 15) + " more");
  }

  MailApp.sendEmail({
    to: COORDINATOR_EMAIL,
    subject: "Minibus weekly summary \u2014 " + pretty,
    body: title + "\n\n" + lines.join("\n").replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " "),
    htmlBody: htmlShell(title, colour, lines, "Open spreadsheet", CHECKS_SHEET)
  });

  return title;
}

/** Sunday evening, once a week. Safe to run again: it clears its own old one. */
/**
 * Says whether the Sunday summary is really scheduled, and schedules it if
 * not. It is installed inside a try/catch during setup, so that a refused
 * permission cannot stop the rota being built. The cost of that is it can
 * quietly fail and nothing would ever tell you, which would mean no Sunday
 * summary and no wash or fuel reaching you. This tells you.
 */
function checkDigestScheduled() {
  var ui = SpreadsheetApp.getUi();
  var want = [
    { fn: "weeklyDigest",   label: "Weekly summary, Sunday evenings", install: installWeeklyDigest },
    { fn: "dutyReminders",  label: "Duty reminders, every morning",   install: installDutyReminders },
    { fn: "onRotaEditNotify", label: "Alerts when a Sunday changes",   install: installChangeAlerts },
    { fn: "nightlyMaintenance", label: "Nightly rota tidy-up, 3am",     install: installNightlyMaintenance },
    { fn: "missingCheckAlert",  label: "Sunday 10:45, went out unchecked", install: installMissingCheckAlert }
  ];
  var have = {};
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) { have[t.getHandlerFunction()] = true; });
  } catch (err) {
    ui.alert("Could not read the triggers:\n\n" + err);
    return;
  }

  var report = [];
  want.forEach(function (w) {
    if (have[w.fn]) { report.push("\u2713  " + w.label); return; }
    try { w.install(); report.push("\u2713  " + w.label + "  (was missing, now set up)"); }
    catch (err) { report.push("\u2717  " + w.label + "  COULD NOT BE SET UP"); }
  });

  var drivers = readDrivers(SpreadsheetApp.getActiveSpreadsheet());
  var withEmail = drivers.filter(function (d) { return d.active && d.email; }).length;
  report.push("");
  report.push(withEmail + " of " + drivers.filter(function (d) { return d.active; }).length +
              " drivers have an email address.");
  if (!withEmail) report.push("Fill the Email column on the Drivers tab or no reminders go out.");

  ui.alert(report.join("\n"));
}

/* ---- duty reminders ----------------------------------------------------
   Emails whoever is down to drive, ahead of the day, with a calendar file
   attached. The email is the delivery; the calendar file is what actually
   does the reminding, because once it is in the driver's own calendar their
   phone alerts them on their own terms, offline, without this script being
   involved at all.

   Text messages would land more reliably than email, but Apps Script cannot
   send them without a paid third party account. Push notifications are worse
   again: on an iPhone they only work if the app has been added to the Home
   Screen and permission granted, and they fail silently otherwise. Email
   plus a calendar file needs nothing set up on the driver's side.

   How many days before to send. The week gives somebody time to ask for a
   swap; the day before is the one that gets them out of bed. */
var REMIND_DAYS = [7, 1];

var BUS_ADDRESS = "3-5 Chester Road, Liverpool L6 4DY";

function dutyReminders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureRotaSheets(ss);

  var drivers = readDrivers(ss);
  var emails = {};
  drivers.forEach(function (d) { if (d.active && d.email) emails[d.name] = d.email; });
  if (!Object.keys(emails).length) return { sent: [], already: [] };

  var byDate = {};
  readRotaRows(ss).forEach(function (r) { byDate[r.date] = r; });
  var pattern = { north: primaryPattern(drivers, "North"),
                  south: primaryPattern(drivers, "South") };

  var props = PropertiesService.getScriptProperties();
  var sent = {};
  try { sent = JSON.parse(props.getProperty("remindersSent") || "{}"); } catch (err) {}
  var report = { sent: [], already: [] };

  var today = new Date();
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  REMIND_DAYS.forEach(function (days) {
    var target = new Date(today);
    target.setDate(target.getDate() + days);
    if (target.getDay() !== 0) return;          // only Sundays carry a duty

    var key = dateToKey(target);
    var row = byDate[key];

    /* Both routes. A South driver has exactly the same need to be reminded
       as a North one, and reminding only one route would have been a quiet
       way of treating the new route as second class. */
    [
      { route: "North Liverpool",
        who: String((row ? (row.actual  || row.primary)  : patternDriver(target, pattern.north)) || "").trim(),
        was: (row && row.actual  && row.primary  && row.actual  !== row.primary)  ? row.primary  : "" },
      { route: "South Liverpool",
        who: String((row ? (row.actual2 || row.primary2) : southDriver(target, pattern.south)) || "").trim(),
        was: (row && row.actual2 && row.primary2 && row.actual2 !== row.primary2) ? row.primary2 : "" }
    ].forEach(function (slot) {
      if (!slot.who || !emails[slot.who]) return;   // nobody assigned, or no address

      /* Sent once. The trigger runs daily, but somebody may also run it by
         hand, and nobody wants the same reminder twice. */
      var stamp = key + "|" + days + "|" + slot.who;
      if (sent[stamp]) { report.already.push(slot.who + ", " + slot.route); return; }

      sendDutyEmail(emails[slot.who], slot.who, target, days, slot.was, slot.route);
      sent[stamp] = true;
      report.sent.push(slot.who + ", " + slot.route);
    });
  });

  var keys = Object.keys(sent).sort();
  while (keys.length > 300) { delete sent[keys.shift()]; }
  props.setProperty("remindersSent", JSON.stringify(sent));
  return report;
}

/**
 * When the next reminders are actually due.
 *
 * REMIND_DAYS is [7, 1], and a reminder only goes when today plus one of
 * those lands on a Sunday. So the two days that ever send anything are the
 * Sunday a week before, and the Saturday. Every other day of the week sends
 * nothing and is supposed to.
 */
function nextReminderDay() {
  var today = new Date();
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (var i = 0; i <= 14; i++) {
    var d = new Date(today); d.setDate(d.getDate() + i);
    for (var j = 0; j < REMIND_DAYS.length; j++) {
      var t = new Date(d); t.setDate(t.getDate() + REMIND_DAYS[j]);
      if (t.getDay() === 0) {
        return { when: d, days: REMIND_DAYS[j], sunday: t, today: i === 0 };
      }
    }
  }
  return null;
}

function sendDutyEmail(to, who, sunday, daysAhead, covering, route) {
  var tz = Session.getScriptTimeZone();
  var when = Utilities.formatDate(sunday, tz, "EEEE d MMMM yyyy");
  var lead = daysAhead === 1 ? "tomorrow" : "in " + daysAhead + " days";

  /* Which route. With one route "drive the minibus" was enough. With two it
     leaves a driver to guess, and guessing wrong means a bus at the wrong end
     of the city with people waiting at the other. */
  var on = route ? " on <b>" + esc(route) + "</b>" : "";
  var onPlain = route ? " on " + route : "";

  var lines = [
    "You are down to drive the minibus" + on + " <b>" + esc(lead) + "</b>.",
    "&nbsp;",
    "<b>" + esc(when) + "</b>"
  ];
  if (covering) lines.push("Covering for " + esc(covering) + ".");
  lines.push("&nbsp;");
  lines.push("Put it in your own phone calendar and it will remind you the " +
             "evening before, even with no signal. Either open the attached " +
             "file, or use the button.");
  lines.push(bigLink(calendarLink(sunday, covering, route), "Add to my calendar"));
  lines.push("If you cannot make it, open the app, find the Sunday and tap " +
             "Request change.");

  var plain = [
    "You are down to drive the minibus" + onPlain + " " + lead + ".", "",
    when,
    covering ? "Covering for " + covering + "." : "",
    "", "The attached file adds it to your phone calendar.",
    "", "If you cannot make it, open the app, find the Sunday and tap Request change."
  ].join("\n");

  MailApp.sendEmail({
    to: to,
    subject: "Minibus duty" + (route ? ": " + route : "") + " " +
             (daysAhead === 1 ? "tomorrow" : "on " + when),
    body: plain,
    htmlBody: htmlShell("Your minibus duty", "#1B3A57", lines, ""),
    attachments: [{
      fileName: "minibus-duty.ics",
      mimeType: "text/calendar",
      content: dutyIcs(sunday, who, covering, route)
    }]
  });
}

/** An all day event on the Sunday, with an alert the day before. */
function dutyIcs(sunday, who, covering, route) {
  var tz = Session.getScriptTimeZone();
  var day = Utilities.formatDate(sunday, tz, "yyyyMMdd");
  var after = new Date(sunday); after.setDate(after.getDate() + 1);
  var dayAfter = Utilities.formatDate(after, tz, "yyyyMMdd");
  var stamp = Utilities.formatDate(new Date(), "UTC", "yyyyMMdd'T'HHmmss'Z'");

  var desc = "You are down to drive the church minibus" +
             (route ? " on " + route : "") + "." +
             (covering ? " Covering for " + covering + "." : "");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Minibus//Rota//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:minibus-" + day + "-" + String(who).replace(/[^A-Za-z0-9]/g, "") + "@minibus",
    "DTSTAMP:" + stamp,
    "DTSTART;VALUE=DATE:" + day,
    "DTEND;VALUE=DATE:" + dayAfter,
    "TRANSP:TRANSPARENT",
    "SUMMARY:" + icsEscape(route ? "Minibus duty: " + route : "Minibus driving duty"),
    "DESCRIPTION:" + icsEscape(desc),
    "LOCATION:" + icsEscape(BUS_ADDRESS),
    "BEGIN:VALARM",
    "TRIGGER:-PT12H",
    "ACTION:DISPLAY",
    "DESCRIPTION:" + icsEscape("Minibus duty tomorrow"),
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ].map(icsFold).join("\r\n");
}

/**
 * The calendar format allows 75 characters to a line. Longer ones are
 * continued on the next line starting with a space. Most calendars forgive
 * an over-long line; some quietly refuse the whole file, and a file that
 * does nothing when tapped gives the driver no clue why.
 */
function icsFold(line) {
  if (line.length <= 75) return line;
  var out = line.slice(0, 75);
  var rest = line.slice(75);
  while (rest.length) {
    out += "\r\n " + rest.slice(0, 74);
    rest = rest.slice(74);
  }
  return out;
}

function icsEscape(s) {
  return String(s).replace(/\\/g, "\\\\")
                  .replace(/;/g, "\\;")
                  .replace(/,/g, "\\,")
                  .replace(/\r?\n/g, "\\n");
}

function installDutyReminders() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "dutyReminders") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("dutyReminders").timeBased().everyDays(1).atHour(8).create();
}

/** Menu item, for testing without waiting for the morning. */
function sendRemindersNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var withEmail = readDrivers(ss).filter(function (d) { return d.active && d.email; }).length;
  if (!withEmail) {
    SpreadsheetApp.getUi().alert(
      "Nobody has an email address yet.\n\nFill the Email column on the " +
      "Drivers tab. Anyone left blank simply gets no reminder.");
    return;
  }
  /* This used to run and then toast "Reminders checked", which read as "mail
     has gone out" on the six days a week when nothing is due. Nothing was
     wrong; the reporting was. */
  var out = dutyReminders() || { sent: [], already: [] };
  var next = nextReminderDay();
  var tz = Session.getScriptTimeZone();

  var msg = "";
  if (out.sent.length) {
    msg += "Sent now:\n  \u2022  " + out.sent.join("\n  \u2022  ") + "\n\n";
  }
  if (out.already.length) {
    msg += "Already sent earlier, so not sent again:\n  \u2022  " +
           out.already.join("\n  \u2022  ") + "\n\n";
  }
  if (!out.sent.length && !out.already.length) {
    msg += "Nothing was due today.\n\nReminders go out a week before a " +
           "Sunday and again the day before. On any other day there is " +
           "nothing to send, which is what has just happened.\n\n";
  }
  if (next) {
    msg += "Next: " + Utilities.formatDate(next.when, tz, "EEEE d MMMM") +
           (next.today ? " (today)" : "") + ", for Sunday " +
           Utilities.formatDate(next.sunday, tz, "d MMMM") + ".\n\n";
  }
  var noAddress = readDrivers(ss).filter(function (d) {
    return d.active && !d.email && (d.route || d.order);
  }).map(function (d) { return d.name; });

  msg += withEmail + " driver" + (withEmail > 1 ? "s have" : " has") +
         " an email address.";
  if (noAddress.length) {
    msg += "\n\nNo address, so never reminded: " + noAddress.join(", ") +
           ".\nFill the Email column on the Drivers tab.";
  }
  msg += "\n\nTo see the email itself, use Send me a sample duty reminder.";

  SpreadsheetApp.getUi().alert("Duty reminders", msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ---- when a Sunday changes after people have been told ----------------
   A reminder that has already gone out is worse than none if the rota then
   moves. This tells the person coming off and the person coming on.

   It only fires for Sundays inside the reminder window. Change something a
   month out and nobody has been told yet, so the normal reminder will carry
   the right name and there is nothing to correct.

   This cannot live in the ordinary onEdit. That is a simple trigger, it runs
   with restricted permissions, and it is not allowed to send email. It has
   its own installable trigger instead, so if that one fails to install only
   these alerts are lost and every other thing onEdit does carries on. */

function onRotaEditNotify(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    var name = sh.getName();
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (name === ROTA_SHEET) {
      var row = e.range.getRow(), col = e.range.getColumn();
      /* Columns 2 and 3 are North, 5 and 6 are South. South used to be left
         out, so a South driver could be taken off a Sunday and never told. */
      if (row < 2 || [2, 3, 5, 6].indexOf(col) === -1) return;
      if (typeof e.oldValue === "undefined" && typeof e.value === "undefined") return;

      var key = anyToKey(sh.getRange(row, 1).getValue());
      if (!key) return;

      var schedCol = (col === 5 || col === 6) ? 5 : 2;
      var coverCol = schedCol + 1;
      var scheduled = String(sh.getRange(row, schedCol).getValue() || "").trim();
      var cover     = String(sh.getRange(row, coverCol).getValue() || "").trim();
      var was       = String(e.oldValue || "").trim();

      /* Who was actually driving before this edit, and who is now. */
      var before = (col === schedCol) ? (cover || was) : (was || scheduled);
      var after  = cover || scheduled;
      notifyDutyChange(ss, key, before, after,
                       schedCol === 5 ? "South Liverpool" : "North Liverpool");
      return;
    }

    if (name === REQUESTS_SHEET) {
      var r = e.range.getRow(), c = e.range.getColumn();
      if (r < 2 || (c !== 8 && c !== 10)) return;
      if (String(sh.getRange(r, 8).getValue() || "") !== "Approved") return;
      var replacement = String(sh.getRange(r, 10).getValue() || "").trim();
      if (!replacement) return;
      var k = anyToKey(sh.getRange(r, 3).getValue());
      if (!k) return;
      var reqDriver = String(sh.getRange(r, 4).getValue() || "").trim();
      var rota2 = ss.getSheetByName(ROTA_SHEET);
      var rRow2 = rota2 ? findRotaRow(rota2, k) : 0;
      var rt = (rota2 && rRow2 && routeColumns(ss, rota2, rRow2, reqDriver).scheduled === 5)
        ? "South Liverpool" : "North Liverpool";
      notifyDutyChange(ss, k, reqDriver, replacement, rt);
    }
  } catch (err) { /* an alert must never block somebody editing the sheet */ }
}

function notifyDutyChange(ss, key, before, after, route) {
  before = String(before || "").trim();
  after  = String(after  || "").trim();
  if (before === after) return;

  var sunday = keyToDate(key);
  var today = new Date();
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (sunday < today) return;                                  // been and gone

  var horizon = Math.max.apply(null, REMIND_DAYS);
  if (Math.round((sunday - today) / 86400000) > horizon) return;  // nobody told yet

  var emails = {};
  readDrivers(ss).forEach(function (d) { if (d.active && d.email) emails[d.name] = d.email; });

  var when = Utilities.formatDate(sunday, Session.getScriptTimeZone(), "EEEE d MMMM yyyy");
  var on = route ? " (" + esc(route) + ")" : "";
  var onPlain = route ? " (" + route + ")" : "";

  if (before && emails[before]) {
    var offLines = [
      "You were down to drive on <b>" + esc(when) + "</b>" + on + ".",
      "&nbsp;",
      after ? ("That has changed. " + esc(after) + " is driving instead.")
            : "That has changed and somebody else will be driving.",
      "&nbsp;",
      "Nothing is needed from you. If you put it in your calendar, you can " +
      "delete that entry."
    ];
    MailApp.sendEmail({
      to: emails[before],
      subject: "Minibus: you are no longer driving on " + when,
      body: "You were down to drive on " + when + onPlain + ".\n\n" +
            (after ? after + " is driving instead." : "Somebody else is driving instead.") +
            "\n\nNothing is needed from you.",
      htmlBody: htmlShell("Duty changed", "#5C6672", offLines, "")
    });
  }

  if (after && emails[after]) {
    var onLines = [
      "You are now down to drive the minibus on <b>" + esc(when) + "</b>" + on + ".",
      "&nbsp;",
      before ? ("Covering for " + esc(before) + ".") : "",
      "&nbsp;",
      "Put it in your own phone calendar and it will remind you the evening " +
      "before. Either open the attached file, or use the button.",
      bigLink(calendarLink(sunday, before, route), "Add to my calendar"),
      "If you cannot make it, open the app, find the Sunday and tap Request change."
    ].filter(function (l) { return l !== ""; });

    MailApp.sendEmail({
      to: emails[after],
      subject: "Minibus duty" + (route ? ": " + route : "") + " on " + when,
      body: "You are now down to drive the minibus on " + when + onPlain + ".\n\n" +
            (before ? "Covering for " + before + ".\n\n" : "") +
            "The attached file adds it to your phone calendar.",
      htmlBody: htmlShell("You are now driving", "#1B3A57", onLines, ""),
      attachments: [{
        fileName: "minibus-duty.ics",
        mimeType: "text/calendar",
        content: dutyIcs(sunday, after, before, route)
      }]
    });
  }
}

function installChangeAlerts() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "onRotaEditNotify") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("onRotaEditNotify")
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
}

function installWeeklyDigest() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "weeklyDigest") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("weeklyDigest")
    .timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(19).create();
}

function sendDigestNow() {
  var msg = weeklyDigest();
  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { Logger.log(msg); }
}

/**
 * The menu, grouped by what a thing does to you rather than by what it is
 * about.
 *
 * It used to be seventeen items in one flat list, which put "Rebuild future
 * Sundays" three rows below "Check time zone" with nothing to say that one
 * of them rewrites the rota and the other only looks. Coordinators are not
 * supposed to have to remember which is which.
 *
 * So: the two things reached most often sit at the top. Everything else is
 * behind a submenu whose name says what happens if you press something in
 * it. Fewer things visible means fewer things to press by mistake.
 *
 * One item is gone from here and the function is left in the file:
 *
 *   Repair old fuel readings   a migration that ran once, long ago. Harmless
 *                              to run again, since repaired readings are text
 *                              and get skipped, but it has nothing left to do.
 *
 * Still callable from the Apps Script editor if an old sheet ever turns up
 * with date-shaped fuel readings in it.
 *
 * "Set the bus link secret" was listed here too. That function has now gone
 * from the file altogether, along with the per-Sunday code it existed for.
 */
/* ---- have a look ------------------------------------------------------- */

/**
 * One button that answers "is anything wrong", instead of four separate
 * checks a coordinator has to remember to run and then interpret.
 *
 * Reads only. It reports what it finds and repairs nothing, so it can be
 * pressed at any time by anybody, including on a Sunday morning by somebody
 * who is only trying to find out why an email did not arrive.
 *
 * The one thing it deliberately does not do is install missing triggers.
 * "Check scheduled emails" already does that, and a look-only item that
 * quietly changes the project would be exactly the sort of surprise this
 * menu is now arranged to avoid. It names what is missing and sends you
 * there.
 */
function healthCheck() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var good = [], bad = [];

  /* Time zone. Everything dated depends on this and it is invisible until
     something lands on the wrong Sunday. */
  var tz = timeZoneWarning();
  if (tz) bad.push(tz + "\n     File > Settings > Time zone, set United Kingdom.");
  else good.push("Time zone is " + Session.getScriptTimeZone() + ".");

  /* Drivers tab. */
  var warn = driversHeaderWarning(ss);
  if (warn) {
    bad.push("The Drivers tab columns are out of order. Run Check the Drivers tab for the detail.");
  } else {
    var drivers = readDrivers(ss);
    var active = drivers.filter(function (d) { return d.active; });
    var withEmail = active.filter(function (d) { return d.email; }).length;

    var north = primaryPattern(drivers, "North");
    var south = primaryPattern(drivers, "South");
    if (!north.length) bad.push("No North rotation. The Route column on the Drivers tab is not filled in.");
    if (!south.length) bad.push("No South rotation. The Route column on the Drivers tab is not filled in.");
    if (north.length && south.length) {
      good.push("Rotations: North " + north.length + ", South " + south.length + ".");
    }

    /* Who is actually on a rotation, and can they be reached.
       
       This used to read "9 active drivers, 2 with an email address" and sit
       under Fine, which is how it went unnoticed for weeks. A count is not
       the question. The question is whether the person driving next Sunday
       will be reminded, and that is answered by names, not by a total.
       Somebody on the Backup list with no address costs nothing. The man
       rostered for North a fortnight on Sunday costs a bus. */
    var byName = {};
    drivers.forEach(function (d) { byName[d.name] = d; });

    var rostered = {};
    north.concat(south).forEach(function (n) { if (n) rostered[n] = true; });

    var silent = Object.keys(rostered).filter(function (n) {
      var d = byName[n];
      return !d || !d.email;
    }).sort();

    if (!withEmail) {
      bad.push("Nobody has an email address, so no duty reminder can ever be sent. " +
               "Fill the Email column on the Drivers tab.");
    } else if (silent.length) {
      bad.push(silent.length + " of the " + Object.keys(rostered).length +
               " drivers on a rotation have no email address, so they are never " +
               "reminded of their Sunday: " + silent.join(", ") + ".\n     " +
               "Fill the Email column on the Drivers tab. Nothing else needs changing.");
    } else {
      good.push("All " + Object.keys(rostered).length +
                " rostered drivers have an email address.");
    }

    /* The rest of the register, said separately and quietly. Somebody on
       Backup without an address is not a problem to solve today. */
    var others = active.length - Object.keys(rostered).length;
    if (others > 0) {
      good.push(active.length + " active drivers, " + withEmail +
                " with an email address (" + others + " not on a rotation).");
    } else {
      good.push(active.length + " active drivers, " + withEmail + " with an email address.");
    }
  }

  /* Triggers. Named, not installed: see the note above. */
  var want = [
    { fn: "weeklyDigest",       label: "Weekly summary" },
    { fn: "dutyReminders",      label: "Duty reminders" },
    { fn: "onRotaEditNotify",   label: "Alerts when a Sunday changes" },
    { fn: "nightlyMaintenance", label: "Nightly rota tidy-up" },
    { fn: "missingCheckAlert",  label: "Sunday 10:45, went out unchecked" }
  ];
  try {
    var have = {};
    ScriptApp.getProjectTriggers().forEach(function (t) { have[t.getHandlerFunction()] = true; });
    var missing = want.filter(function (w) { return !have[w.fn]; })
                      .map(function (w) { return w.label; });
    if (missing.length) {
      bad.push("Not scheduled: " + missing.join(", ") +
               ".\n     Run Rota and setup > Check scheduled emails to put them back.");
    } else {
      good.push("All five scheduled jobs are installed.");
    }
  } catch (err) {
    bad.push("Could not read the scheduled jobs: " + err);
  }

  /* Email allowance. A silent day of no reminders is usually this. */
  try {
    var left = MailApp.getRemainingDailyQuota();
    if (left === 0) bad.push("This account's daily email allowance is used up. It frees up about 24 hours after the first one went out.");
    else good.push(left + " emails can still go out today.");
  } catch (err) { /* not worth reporting */ }

  if (!COORDINATOR_EMAIL) bad.push("COORDINATOR_EMAIL is blank in Code.gs, so nothing is ever sent to you.");

  /* Not an error, but the single most useful thing to be told, because a
     rehearsal left running is the one state that makes everything else on
     this screen mean something different. */
  try {
    var skips = JSON.parse(PropertiesService.getScriptProperties()
                  .getProperty("dropdownsSkipped") || "[]");
    var onlyColours = skips.length === 1 &&
                      String(skips[0]).indexOf("Rota status colours") === 0;
    if (onlyColours) {
      /* Not a fault, and it should stop reading like one. The dropdown on
         that column colours itself. */
      good.push("Rota status colours are left to the dropdown's own chips.");
    } else if (skips.length) {
      bad.push(skips.length + " dropdown or colour step" + (skips.length > 1 ? "s" : "") +
               " could not be applied to the sheet, most likely a typed column. " +
               "Run Refresh dropdowns from Drivers tab for the detail. " +
               "Nothing is broken by it.");
    }
  } catch (err) {}

  var reh = rehearsalOn();
  if (reh) {
    bad.push("A REHEARSAL is running, until " +
             Utilities.formatDate(new Date(reh.ends), Session.getScriptTimeZone(), "HH:mm") +
             ". Tracking is behaving as though bookings had closed, and test " +
             "bookings are on the tab. Stop it from the Minibus menu.");
  }

  /* The passenger side. */
  var stops = readBusStops(ss);
  var pickups = stops.filter(function (s) { return !s.arrival; }).length;
  if (!pickups) bad.push("No pickup stops on the Bus Stops tab, so the booking page has nothing to show.");
  else good.push(pickups + " pickup stops on the timetable.");

  var msg = bad.length
    ? "Needs attention:\n\n  \u2717  " + bad.join("\n\n  \u2717  ") +
      (good.length ? "\n\n\nFine:\n\n  \u2713  " + good.join("\n  \u2713  ") : "")
    : "\u2713  Everything looks right.\n\n  " + good.join("\n  ");

  ui.alert(bad.length ? "Minibus: " + bad.length + " thing" + (bad.length === 1 ? "" : "s") + " to look at"
                      : "Minibus: all well", msg, ui.ButtonSet.OK);
}

/**
 * Who is booked where this Sunday, as a total per stop.
 *
 * The Bus Bookings tab holds one row per phone, which is the right shape for
 * storing it and the wrong shape for reading it. This is the same summing the
 * driver's app does, for whoever is sitting at the spreadsheet instead, and
 * it is what you want in front of you when somebody rings to cancel.
 *
 * Counts only, like everywhere else. Nothing here knows a name.
 */
function bookingsThisSunday() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  /* The Sunday being driven, not the one now open for booking. On a Sunday
     morning during the run this is the list you actually want in front of
     you, and busCurrentSunday would have handed you next week's. */
  var key = runSunday();
  var when = Utilities.formatDate(keyToDate(key), Session.getScriptTimeZone(), "EEEE d MMMM");
  var counts = bookingCounts(ss, key);
  var stops = readBusStops(ss).filter(function (s) { return !s.arrival; });

  if (!stops.length) { ui.alert("No pickup stops on the Bus Stops tab yet."); return; }

  var lines = [], totals = {}, grand = 0;
  var lastRoute = "";

  stops.forEach(function (s) {
    var n = counts[s.id] || 0;
    grand += n;
    totals[s.route] = (totals[s.route] || 0) + n;
    if (s.route !== lastRoute) {
      lines.push((lastRoute ? "\n" : "") + s.route + " Liverpool");
      lastRoute = s.route;
    }
    lines.push("  " + s.time + "  " + s.stop + "   " +
               (n ? n + (n === 1 ? " person" : " people") : "nobody"));
  });

  var head = grand
    ? grand + (grand === 1 ? " person" : " people") + " booked for " + when + "."
    : "Nobody booked yet for " + when + ".";

  var byRoute = Object.keys(totals).map(function (r) { return r + " " + totals[r]; }).join(", ");

  ui.alert("Bookings for this Sunday",
    head + (grand ? "\n" + byRoute + "." : "") +
    "\n\nBookings close " + cutoffWords() + ".\n\n" + lines.join("\n") +
    "\n\nA count is what somebody said they would do, not a promise. " +
    "Nobody is ever driven past on the strength of it.",
    ui.ButtonSet.OK);
}

function onOpen() {
  var ui = SpreadsheetApp.getUi();

  /* Both rehearsal items are always here.

     They used to be one item that changed according to whether a rehearsal
     was running, which does not work: a menu is built once when the
     spreadsheet is opened and never rebuilt. Start a rehearsal and the menu
     still said "Rehearse this Sunday", so there was no way to stop one
     without closing and reopening the whole sheet. Two plain items that are
     always present cannot get out of step with anything. */
  var menu = ui.createMenu("Minibus")

    /* The two you actually want most weeks. */
    .addItem("Bus link for this Sunday", "busLinkForSunday")
    .addItem("Bookings for this Sunday", "bookingsThisSunday")
    .addSeparator()

    .addSubMenu(ui.createMenu("Have a look (nothing changes)")
      .addItem("Is everything working?", "healthCheck")
      .addItem("Who is carrying the load", "coverBalance")
      .addItem("Who is tapping", "whoIsTapping")
      .addItem("Check the Drivers tab", "checkDriversTab")
      .addItem("Check time zone", "checkTimeZoneMenu"))

    .addSubMenu(ui.createMenu("Rota and setup (safe to re-run)")
      .addItem("Set up / refresh rota", "setUpEverything")
      .addItem("Refresh dropdowns from Drivers tab", "refreshDropdownsMenu")
      .addItem("Add a Sunday to the rota", "addSunday")
      .addItem("Extend rota further ahead", "extendRota")
      .addItem("Check scheduled emails, set up any missing", "checkDigestScheduled")
      .addSeparator()
      .addItem("Rebuild future Sundays from the pattern (asks first)", "rebuildFutureRota"))

    .addSubMenu(ui.createMenu("Send an email now")
      .addItem("Test email, to you only", "sendTestEmail")
      .addItem("Weekly summary, to you only", "sendDigestNow")
      .addItem("Send me a sample duty reminder", "sampleDutyReminder")
      .addSeparator()
      .addItem("Duty reminders, to the drivers", "sendRemindersNow"))

    .addSeparator()

    .addSubMenu(ui.createMenu("Sheet protection")
      .addItem("Lock the sheet", "lockSheet")
      .addItem("Unlock the sheet (asks first)", "unlockSheet"));

  menu.addSeparator()
      .addItem("Rehearse this Sunday", "startRehearsal")
      .addItem("Stop rehearsing", "stopRehearsal");

  menu.addToUi();
}

/* ---- sheet edits ------------------------------------------------------- */

function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    var name = sh.getName();
    if (name === DEFECTS_SHEET)  return onEditDefects(e, sh);
    if (name === ROTA_SHEET)     return onEditRota(e, sh);
    if (name === REQUESTS_SHEET) return onEditRequests(e, sh);
    if (name === BOOKINGS_SHEET) return onEditBookings(e, sh);
  } catch (err) {
    // Never let a trigger error block someone editing the sheet.
  }
}

/**
 * Striking a booking out by hand, when somebody rings to say they are not
 * coming, has to reach the driver's screen the same way a passenger
 * cancelling on the page does. Nothing is written here: this only clears the
 * cached counts so the next poll rebuilds them.
 */
function onEditBookings(e, sh) {
  var topRow = Math.max(e.range.getRow(), 2);
  var lastRow = e.range.getRow() + e.range.getNumRows() - 1;
  if (lastRow < 2) return;

  var seen = {};
  for (var row = topRow; row <= lastRow; row++) {
    var key = anyToKey(sh.getRange(row, 2).getValue());
    if (key && !seen[key]) { seen[key] = true; dropCountsCache(key); }
  }
}

/**
 * Approving a request with a replacement named writes the cover onto the
 * official rota, so you do not have to do it in two places. The scheduled
 * driver is left alone and the repeating pattern is untouched.
 */
function onEditRequests(e, sh) {
  var topRow = e.range.getRow();
  var topCol = e.range.getColumn();
  var numRows = e.range.getNumRows();
  var numCols = e.range.getNumColumns();
  var lastCol = topCol + numCols - 1;

  var touches8  = topCol <= 8  && lastCol >= 8;
  var touches10 = topCol <= 10 && lastCol >= 10;
  if (!touches8 && !touches10) return;

  var firstRow = Math.max(topRow, 2);
  var lastRow = topRow + numRows - 1;
  if (lastRow < 2) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rota = ss.getSheetByName(ROTA_SHEET);
  var touched = false;

  for (var row = firstRow; row <= lastRow; row++) {
    var status = String(sh.getRange(row, 8).getValue() || "");
    var replacement = String(sh.getRange(row, 10).getValue() || "").trim();
    var key = anyToKey(sh.getRange(row, 3).getValue());
    if (!key) continue;

    if (status === "Approved" || status === "Rejected") {
      if (!sh.getRange(row, 9).getValue()) {
        sh.getRange(row, 9).setValue(new Date()).setNumberFormat("dd/mm/yyyy");
      }
    } else {
      sh.getRange(row, 9).clearContent();
    }

    if (!rota) continue;
    var rRow = findRotaRow(rota, key) || appendRotaRow(ss, rota, keyToDate(key));

    /* Which route the request belongs to. Approving used to write every
       cover into the North column, so approving a South driver's holiday
       put a stranger against the North slot and left South uncovered. */
    var requester = String(sh.getRange(row, 4).getValue() || "").trim();
    var cols = routeColumns(ss, rota, rRow, requester);

    var type     = String(sh.getRange(row, 5).getValue() || "").trim();
    var swapWith = String(sh.getRange(row, 7).getValue() || "").trim();
    var swapKey  = anyToKey(sh.getRange(row, 11).getValue());

    /* A swap is an exchange, so approving it moves TWO Sundays. Approving it
       as a cover would move one, leaving the other driver a Sunday up and
       the requester a Sunday down, which is precisely the thing a swap is
       not. */
    if (status === "Approved" && type === "Request a swap" && swapWith && swapKey) {
      var problem = applySwap(ss, rota, key, requester, swapKey, swapWith);
      if (problem) {
        /* Put the decision back rather than half doing it. A swap that
           applied to one Sunday and not the other is worse than one that
           did not apply at all, because nothing on the sheet would show it. */
        sh.getRange(row, 8).setValue("Pending");
        sh.getRange(row, 9).clearContent();
        sh.getRange(row, 8).setNote(problem);
        SpreadsheetApp.getActiveSpreadsheet().toast(problem, "Swap not applied", 12);
      } else {
        sh.getRange(row, 8).clearNote();
        stamp(rota, rRow, "Approved swap");
      }
      touched = true;
      continue;
    }

    if (status === "Approved" && replacement) {
      rota.getRange(rRow, cols.cover).setValue(replacement);
      rota.getRange(rRow, 4).setValue("Covered");
      stamp(rota, rRow, "Approved request");
    } else if (status === "Approved" && !replacement) {
      rota.getRange(rRow, 4).setValue("No driver assigned");
      stamp(rota, rRow, "Approved, needs cover");
    } else if (status === "Rejected") {
      rota.getRange(rRow, 4).setValue("Confirmed");
      stamp(rota, rRow, "Request rejected");
    }
    touched = true;
  }
  if (touched) bumpRotaVersion();
}

/** Keeps the Status column honest when you edit the rota directly. */
function onEditRota(e, sh) {
  var topRow = e.range.getRow();
  var topCol = e.range.getColumn();
  var numRows = e.range.getNumRows();
  var numCols = e.range.getNumColumns();
  var lastCol = topCol + numCols - 1;

  if (topCol > 7) return;                       // edit is entirely right of Notes
  var firstRow = Math.max(topRow, 2);
  var lastRow = topRow + numRows - 1;
  if (lastRow < 2) return;                       // edit is entirely in the header
  var count = lastRow - firstRow + 1;

  // True only when this specific edit touched the scheduled or cover column,
  // so a direct edit to Status or Notes still leaves a manually set status
  // alone, exactly as a single-cell edit always has.
  var touchesDriverCols = topCol <= 3 && lastCol >= 2;

  /* Everything below reads once and writes twice, whatever the size of the
     edit. Row by row, this did three reads and up to three writes each, so
     pasting a few hundred rows meant well over a thousand separate calls and
     the thirty second limit on a simple trigger would cut it off partway
     through, leaving some rows stamped and some not. */
  var block = sh.getRange(firstRow, 2, count, 3).getValues();   // B, C, D
  var statuses = [];
  var changed = false;

  for (var i = 0; i < count; i++) {
    var scheduled = String(block[i][0] || "").trim();
    var cover     = String(block[i][1] || "").trim();
    var status    = String(block[i][2] || "");
    var next      = status;

    if (!scheduled && !cover) {
      // A Sunday can be legitimately driverless on purpose (cancelled) as
      // well as by oversight (nobody assigned yet). Do not clobber a
      // deliberate "Cancelled/declined" just because some other column on
      // the same row was touched.
      if (status !== "Cancelled/declined") next = "No driver assigned";
    } else if (touchesDriverCols) {
      if (cover && cover !== scheduled) {
        next = "Covered";
      } else if (status === "Covered" || status === "No driver assigned") {
        next = "Confirmed";
      }
    }
    if (next !== status) changed = true;
    statuses.push([next]);
  }

  if (changed) sh.getRange(firstRow, 4, count, 1).setValues(statuses);
  stampRows(sh, firstRow, count, "Coordinator");
  bumpRotaVersion();
}

/* The batched form of stamp(), for when a whole block has been touched. */
function stampRows(sh, firstRow, count, who) {
  var now = new Date();
  var who2 = who || "Coordinator";
  var out = [];
  for (var i = 0; i < count; i++) out.push([now, who2]);
  sh.getRange(firstRow, 8, count, 2).setValues(out);
  sh.getRange(firstRow, 8, count, 1).setNumberFormat("dd/mm/yyyy hh:mm");
}

function onEditDefects(e, sh) {
  var topRow = e.range.getRow();
  var topCol = e.range.getColumn();
  var numRows = e.range.getNumRows();
  var numCols = e.range.getNumColumns();
  var lastCol = topCol + numCols - 1;

  var firstRow = Math.max(topRow, 2);
  var lastRow = topRow + numRows - 1;
  if (lastRow < 2) return;

  var touchesStatus = topCol <= 9  && lastCol >= 9;
  var touchesClosed = topCol <= 11 && lastCol >= 11;
  if (!touchesStatus && !touchesClosed) return;

  var CLOSED_STATES = ["Fixed", "Not a defect"];
  var changed = false;

  for (var row = firstRow; row <= lastRow; row++) {
    if (touchesStatus) {
      var status = String(sh.getRange(row, 9).getValue() || "");
      var closedCell = sh.getRange(row, 11);
      var isClosed = CLOSED_STATES.indexOf(status) !== -1;
      if (isClosed && !closedCell.getValue()) {
        closedCell.setValue(new Date());
      } else if (!isClosed && closedCell.getValue()) {
        closedCell.clearContent();
      }
      changed = true;
      continue; // Status is authoritative for this row; do not also run the
                // Closed-on branch below even if the same paste touched both.
    }
    if (touchesClosed) {
      var cell = sh.getRange(row, 11);
      var val = cell.getValue();
      if (!val) continue;
      if (!(val instanceof Date)) { cell.setNote("That is not a date. Use dd/mm/yyyy."); continue; }
      var today = new Date(); today.setHours(23, 59, 59, 999);
      var raised = sh.getRange(row, 1).getValue();
      if (val > today) {
        cell.setNote("A defect cannot be closed on a future date.");
        cell.setBackground("#FBE9E7");
        continue;
      }
      if (raised instanceof Date && val < new Date(raised.getFullYear(), raised.getMonth(), raised.getDate())) {
        cell.setNote("This is before the defect was reported on " +
          Utilities.formatDate(raised, Session.getScriptTimeZone(), "dd/MM/yyyy") + ".");
        cell.setBackground("#FBE9E7");
        continue;
      }
      cell.clearNote();
      cell.setBackground(null);
      var st = String(sh.getRange(row, 9).getValue() || "");
      if (CLOSED_STATES.indexOf(st) === -1) {
        sh.getRange(row, 9).setValue("Fixed");
      }
      changed = true;
    }
  }
  /* The open-defect list rides on the rota payload, which is cached. */
  if (changed) bumpRotaVersion();
}

/* ---- emails ------------------------------------------------------------ */

/**
 * The link that appears in coordinator emails.
 *
 * The script asks the spreadsheet it is attached to for its own address, so
 * the link cannot go stale even if the sheet is renamed or moved.
 *
 * Deliberately left blank. It used to hold the address written out in full,
 * which put the spreadsheet's id into a file, and a file can be copied,
 * shared or published in ways nobody intended. The live lookup below is not
 * a fallback for that line, it is the whole mechanism: a container-bound
 * script always knows its own sheet.
 *
 * If you ever need a backstop, put the address in Script Properties as
 * SHEET_URL rather than typing it here.
 */
var SHEET_URL = (function () {
  try {
    return PropertiesService.getScriptProperties().getProperty("SHEET_URL") || "";
  } catch (err) { return ""; }
})();

function sheetUrl() {
  try {
    var live = SpreadsheetApp.getActiveSpreadsheet().getUrl();
    if (live) return live;
  } catch (err) { /* fall through */ }
  return SHEET_URL;
}

/**
 * Links straight to one tab, so the button lands on the work rather than on
 * whichever tab happened to be open last. The tab's id is read live, so it
 * stays right even if you reorder the tabs.
 */
function tabUrl(tabName) {
  var url = sheetUrl();
  if (!url) return "";
  url = url.split("#")[0].split("?")[0];
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
    if (sh) return url + "#gid=" + sh.getSheetId();
  } catch (err) { /* fall back to the plain sheet link */ }
  return url;
}

function bigLink(url, label, colour) {
  if (!url) return "";
  return '<p style="margin:22px 0 6px"><a href="' + url + '" ' +
    'style="background:' + (colour || "#1B222C") + ';color:#ffffff;text-decoration:none;' +
    'font-family:Helvetica,Arial,sans-serif;font-weight:bold;font-size:16px;' +
    'padding:13px 22px;border-radius:8px;display:inline-block">' + label + '</a></p>';
}

function openButton(label, tabName) {
  return bigLink(tabName ? tabUrl(tabName) : sheetUrl(), label);
}

/**
 * A second way into the calendar, for phones where the attached file does
 * not open cleanly. Gmail on Android in particular is happier with a link
 * than with a .ics attachment, and this needs no file handling at all: it
 * opens a prefilled event in the browser.
 */
function calendarLink(sunday, covering, route) {
  var tz = Session.getScriptTimeZone();
  var day = Utilities.formatDate(sunday, tz, "yyyyMMdd");
  var after = new Date(sunday); after.setDate(after.getDate() + 1);
  var dayAfter = Utilities.formatDate(after, tz, "yyyyMMdd");
  var details = "You are down to drive the church minibus" +
                (route ? " on " + route : "") + "." +
                (covering ? " Covering for " + covering + "." : "");
  return "https://calendar.google.com/calendar/render?action=TEMPLATE" +
         "&text=" + encodeURIComponent(route ? "Minibus duty: " + route : "Minibus driving duty") +
         "&dates=" + day + "/" + dayAfter +
         "&details=" + encodeURIComponent(details) +
         "&location=" + encodeURIComponent(BUS_ADDRESS);
}

function htmlShell(title, colour, lines, buttonLabel, tabName) {
  return '<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#16191F;line-height:1.5">' +
    '<p style="font-size:19px;font-weight:bold;color:' + colour + ';margin:0 0 14px">' + title + '</p>' +
    lines.map(function (l) { return '<p style="margin:0 0 6px">' + l + '</p>'; }).join("") +
    (buttonLabel ? openButton(buttonLabel, tabName) : "") +
    '<p style="color:#5C6672;font-size:13px;margin-top:18px">Sent by the minibus app.</p></div>';
}

function notifyCheck(c, outcome, defectText) {
  var stopped = c.level === "stop";
  var defects = defectText ? defectText.split(" | ") : [];
  var jobs = (c.jobs || []).slice();
  var clean = !stopped && !defects.length;

  /* Three things this email can be about, and the subject should say which
     rather than always claiming a defect. A clean bus that wants fuel is not
     a defect report and should not read like one. */
  var subject = stopped ? "BUS STOPPED: " + c.reg + ", " + c.date
              : clean   ? "To arrange: " + c.reg + ", " + c.date
              :           "Defect reported: " + c.reg + ", " + c.date;

  var lines = [
    stopped
      ? "<b>A driver has stopped this vehicle after a safety critical defect.</b>"
      : clean
      ? "No defects. The driver has asked for something to be arranged."
      : "A driver has reported a defect. The vehicle was safe to drive.",
    "&nbsp;",
    "<b>Vehicle:</b> " + esc(c.reg) + " (" + esc(c.vehicle || "") + ")",
    "<b>Driver:</b> " + esc(c.driver) + (c.role ? " (" + esc(c.role) + ")" : ""),
    "<b>When:</b> " + esc(c.date) + " at " + esc(c.time),
    "<b>Mileage:</b> " + esc(c.miles) + (c.milesFlag ? " [" + esc(c.milesFlag) + "]" : ""),
    "<b>Outcome:</b> " + esc(outcome),
    "&nbsp;"
  ].concat(defects.length
      ? ["<b>Defects</b>"].concat(defects.map(function (d) { return "&bull; " + esc(d); }))
      : [])
   .concat(jobs.length
      ? (defects.length ? ["&nbsp;"] : [])
        .concat(["<b>To arrange</b>"])
        .concat(jobs.map(function (j) { return "&bull; " + esc(j); }))
      : [])
   .concat(c.loc ? ["&nbsp;", "<b>Checked at:</b> " +
       '<a href="https://maps.google.com/?q=' + esc(c.loc.replace(/\s/g, "")) + '">' +
       esc(c.loc) + "</a> (to within " + esc(c.locAcc) + " yd)" +
       (c.locNote ? " \u2014 " + esc(c.locNote) : "")]
     : (c.locNote ? ["&nbsp;", "<b>Location:</b> " + esc(c.locNote)] : []))
   .concat(["&nbsp;", "<b>Signed:</b> " + esc(c.sign)]);

  var plain = [
    stopped ? "A driver has stopped this vehicle after a safety critical defect."
            : "A driver has reported a defect. The vehicle was safe to drive.",
    "", "Vehicle:  " + c.reg + " (" + (c.vehicle || "") + ")",
    "Driver:   " + c.driver + (c.role ? " (" + c.role + ")" : ""),
    "When:     " + c.date + " at " + c.time,
    "Mileage:  " + c.miles + (c.milesFlag ? "   [" + c.milesFlag + "]" : ""),
    "Outcome:  " + outcome, ""
  ].concat(defects.length
      ? ["Defects:"].concat(defects.map(function (d) { return "  - " + d; }))
      : [])
   .concat(jobs.length
      ? ["", "To arrange:"].concat(jobs.map(function (j) { return "  - " + j; }))
      : [])
   .concat(["", "Signed: " + c.sign, "", tabUrl(DEFECTS_SHEET)])
   .join("\n");

  MailApp.sendEmail({
    to: COORDINATOR_EMAIL,
    subject: subject,
    body: plain,
    htmlBody: htmlShell(stopped ? "Bus stopped, critical defect"
                        : clean ? "Nothing wrong, something to arrange"
                        : "Defect reported",
                        stopped ? "#A8231B" : clean ? "#146B41" : "#B26B00",
                        lines, "Open the defect record", DEFECTS_SHEET)
  });
}

/* The protection note for a Sunday, read straight off the Rota tab. */
function protectedNoteFor(key) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var rota = ss.getSheetByName(ROTA_SHEET);
    if (!rota) return { on: false, reason: "" };
    var row = findRotaRow(rota, key);
    if (!row) return { on: false, reason: "" };
    return parseProtected(String(rota.getRange(row, 7).getValue() || ""));
  } catch (err) { return { on: false, reason: "" }; }
}

function notifyRotaRequest(rq, sunday) {
  var when = Utilities.formatDate(sunday, Session.getScriptTimeZone(), "EEEE d MMMM yyyy");

  var lines = [
    "<b>" + esc(rq.driver) + "</b> has asked for a change to the driving rota.",
    "&nbsp;",
    "<b>Sunday:</b> " + esc(when),
    "<b>Request:</b> " + esc(rq.type || ""),
    "<b>Reason:</b> " + esc(rq.reason || "")
  ];
  var prot = protectedNoteFor(rq.date);
  if (prot.on) {
    lines.push("&nbsp;");
    lines.push("<b>This is a protected Sunday" +
               (prot.reason ? ": " + esc(prot.reason) : "") + ".</b> " +
               "Swaps are refused on it. A cover is still possible, but " +
               "think about who takes it.");
  }
  if (rq.swapWith) lines.push("<b>Swap with:</b> " + esc(rq.swapWith));
  if (rq.swapDate) lines.push("<b>Taking their Sunday:</b> " + esc(rq.swapDate));
  if (rq.swapWith) lines.push(rq.agreed
    ? "They have already agreed this between themselves."
    : "<b>Not marked as agreed.</b> Check with both before approving.");
  lines.push("&nbsp;");
  lines.push("The rota has <b>not</b> changed. Open the Rota Requests tab, set the status " +
             "and pick a replacement, and the Rota tab updates itself.");

  var plain = [
    rq.driver + " has asked for a change to the driving rota.", "",
    "Sunday:  " + when,
    "Request: " + (rq.type || ""),
    "Reason:  " + (rq.reason || ""),
    rq.swapWith ? "Swap with: " + rq.swapWith : "",
    rq.swapDate ? "Taking their Sunday: " + rq.swapDate : "",
    "", "The rota has not changed until you approve it.", "", tabUrl(REQUESTS_SHEET)
  ].join("\n");

  MailApp.sendEmail({
    to: COORDINATOR_EMAIL,
    subject: "Rota request: " + rq.driver + " \u2014 " + when,
    body: plain,
    htmlBody: htmlShell("Minibus rota change request", "#B26B00", lines,
                        "Open the request", REQUESTS_SHEET)
  });
}

/* ---- helpers ----------------------------------------------------------- */

function reply(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Anything a phone typed, made safe to put in a cell.
 *
 * A leading =, +, - or @ makes Google Sheets treat a value as a formula, and
 * the driver app's token is public, so text arriving here did not
 * necessarily come from a driver. A defect note beginning =IMPORTRANGE would
 * be evaluated by the spreadsheet the moment the coordinator opened it. The
 * leading quote makes it text and does not show in the cell.
 */
function safeText(s) {
  var t = String(s == null ? "" : s);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sheet(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sh.setFrozenRows(1);
    if (name === DEFECTS_SHEET) setUpDefectsSheet(sh);
  }
  return sh;
}

/* --- dates. Every rota date is a Sunday at local midnight. --- */

function sundayOf(d) {
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var day = x.getDay();
  if (day !== 0) x.setDate(x.getDate() + (7 - day));
  return x;
}

function addWeeks(d, n) {
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n * 7);
  return x;
}

function dateToKey(d) {
  return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
}

function keyToDate(key) {
  var p = String(key).split("-");
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

/** Cells may hold a real Date or text. Accept both, return YYYY-MM-DD. */
/* Duck-typed rather than "instanceof Date", to match repairFuelColumn.
   instanceof tests against one particular Date constructor, so a real date
   that arrived from anywhere else fails it and this returns "" instead of a
   key. Silently returning "" from a date parser makes whatever called it
   quietly skip the row and report success. */
function isDateLike(v) {
  return !!v && typeof v.getMonth === "function" && typeof v.getDate === "function";
}

function anyToKey(v) {
  if (isDateLike(v)) return dateToKey(v);
  var s = String(v || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    var p = s.split("/");
    return p[2] + "-" + p2(Number(p[1])) + "-" + p2(Number(p[0]));
  }
  return "";
}

function p2(n) { return (n < 10 ? "0" : "") + n; }

/**
 * The Date column of a check, as a person writes it.
 *
 * The app posts the date as text, 09/08/2026, and Sheets converts it to a
 * real date on the way in. String() on that gives the whole JavaScript
 * rendering, "Sun Aug 09 2026 00:00:00 GMT+0100 (British Summer Time)", which
 * is exactly what a driver was reading under the mileage box. The midnight in
 * it was never wrong data: this column holds a date and nothing else. The
 * time of the check sits in the column beside it, and was never sent.
 */
function dayWords(v) {
  var key = anyToKey(v);
  if (key) { var p = key.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
  return String(v || "").trim();
}

/* The Time column. Text on the way in, but Sheets will make 09:42 a real time
   just as readily, and that renders as a date in 1899 if you let it. */
function timeWords(v) {
  if (isDateLike(v)) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "HH:mm");
  }
  return String(v || "").trim();
}

/* ---- defects sheet formatting (unchanged) ------------------------------ */

function setUpDefectsSheet(sh) {
  applyStatusDropdown(sh, null);

  var range = sh.getRange("I2:I1000");
  var rules = sh.getConditionalFormatRules();

  function colourRule(value, bg, fg) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(value).setBackground(bg).setFontColor(fg)
      .setRanges([range]).build();
  }

  rules.push(colourRule("Open", "#FBE9E7", "#A8231B"));
  rules.push(colourRule("Booked in", "#FDF3E2", "#8A5300"));
  rules.push(colourRule("Parts on order", "#FDF3E2", "#8A5300"));
  rules.push(colourRule("Monitoring", "#FDF3E2", "#8A5300"));
  rules.push(colourRule("Fixed", "#E6F2EB", "#146B41"));
  rules.push(colourRule("Not a defect", "#F1F1F1", "#666666"));
  sh.setConditionalFormatRules(rules);

  sh.setColumnWidth(8, 320);
  sh.setColumnWidth(9, 130);
  sh.setColumnWidth(10, 300);
  sh.setColumnWidth(11, 110);

  applyClosedOnRules(sh);
}

function applyClosedOnRules(sh) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireDateBetween(new Date(2026, 0, 1), new Date(2100, 0, 1))
    .setAllowInvalid(false)
    .setHelpText("Enter the date the defect was actually put right. It cannot be a future date.")
    .build();
  var range = sh.getRange("K2:K1000");
  range.setDataValidation(rule);
  range.setNumberFormat("dd/mm/yyyy");
}

function applyStatusDropdown(sh, row) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_OPTIONS, true)
    .setAllowInvalid(false)
    .setHelpText("Pick a status: " + STATUS_OPTIONS.join(", "))
    .build();

  var range = row ? sh.getRange(row, 9) : sh.getRange("I2:I1000");
  range.setDataValidation(rule);
}

function addDropdownToExistingSheet() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DEFECTS_SHEET);
  if (!sh) throw new Error("No sheet named " + DEFECTS_SHEET);
  setUpDefectsSheet(sh);
}

function alreadyHave(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return false;
  var ids = sh.getRange(2, 2, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return true;
  }
  return false;
}
