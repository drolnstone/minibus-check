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

/* Which copy of THIS FILE is deployed.

   The two pages have carried a version in their footers for a long time,
   because a morning was once lost to not knowing whether the file that had
   gone up was the file being served. The script never carried one — and the
   script is the worst place for that gap, because its deploy is the step
   that silently does nothing.

   Pasting Code.gs into the editor and saving changes NOTHING that a phone can
   see. The Web App keeps serving the last DEPLOYED version until somebody
   does Deploy > Manage deployments > New version. Miss that and the site
   files are live, the script is a release behind, and whatever moved in here
   is quietly inert until a Sunday finds it.

   This number moves only when this file changes, so it will often sit behind
   the pages, and that is correct. What it answers is one question: is the
   script the copy I last pasted? Both apps print it beside their own.

   Reported by "Is everything working?" and stamped on every reply. */
var SCRIPT_VERSION = "v1.42.1";

var TOKEN = "minibusapp";                   // must match config.js

/* ---- passenger bookings -------------------------------------------------

   The driver app's token sits in config.js on a public web host, so anyone
   who views source has it. Bookings do not use TOKEN at all, and do not need
   to: there is nothing on the Bus Bookings tab that names anybody. A stop, a
   headcount, and a random handle the passenger's own phone made up.

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


/* When bookings close. Day 0 is Sunday itself, 6 is Saturday. */
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

/* The tab as this version writes it. Phone and Passenger ID are the two new
   ones; everything to their left is exactly where it always was, because
   ensureBookingColumns only ever appends on the right. */
var BOOKINGS_HEADERS = ["Received", "Sunday", "Route", "Stop ID", "Stop",
                        "Seats", "Device", "Status", "Phone", "Passenger ID"];

/* ==========================================================================
   WHOSE BOOKING IT IS

   Two columns, doing two different jobs:

   Phone the number itself, in plain sight, because the coordinator ringing
   round on a Sunday morning needs to be able to. Passenger ID a one-way
   fingerprint of that number. It is what the page sends on every poll from then
   on, so the number itself travels once, in one POST, and never again sits in a
   web address or in a log line.

   The fingerprint cannot be turned back into a number. It exists so the lookups
   are cheap and quiet, not to hide anything from the person who owns this
   spreadsheet: the number is in the next column along.
   ========================================================================== */

/* Fixed, and it must stay fixed. Change this and every fingerprint already
   on the tab stops matching the number that made it, which orphans every
   live booking at once. There is nothing secret in it: it is here so a
   fingerprint from this spreadsheet cannot be compared against one from
   anywhere else. */
var PHONE_SALT = "rccg dominion liverpool minibus v1";

/* Eleven digits, starting with a zero, and nothing else accepted.

   Forgiving about how it is typed and strict about what it becomes: spaces,
   dashes and brackets are thrown away, +44 and 0044 are folded back to the 0
   they stand for, and what is left either is an eleven digit UK number or it
   is not. Returning "" means no, and every caller treats "" as no.

   Deliberately not clever beyond that. A number that fails this is a number
   somebody mistyped, and the page says so plainly rather than guessing. */
function normalisePhone(raw) {
  var d = String(raw == null ? "" : raw).replace(/[^0-9+]/g, "");
  if (d.indexOf("+44") === 0) d = "0" + d.substring(3);
  else if (d.indexOf("0044") === 0) d = "0" + d.substring(4);
  else if (d.indexOf("44") === 0 && d.length === 12) d = "0" + d.substring(2);
  d = d.replace(/[^0-9]/g, "");
  if (d.length !== 11) return "";
  if (d.charAt(0) !== "0") return "";
  return d;
}

/* The fingerprint. Twenty four hex characters is far more than enough to keep
   a congregation apart and short enough to read in a cell. */
function passengerId(phone) {
  if (!phone) return "";
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
                                    PHONE_SALT + ":" + phone,
                                    Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ("0" + (b & 0xFF).toString(16)).slice(-2); })
            .join("").substring(0, 24);
}

/* The row this person owns, out of one Sunday's rows.

   The number comes first and the old device handle second, and the second
   half is the whole of the migration. A booking made before numbers existed
   has no fingerprint on it, so it is still found by the handle the browser
   made up, and an update landing on a Thursday strands nobody who booked on
   the Tuesday. A row that already has an owner is never handed over on a
   handle match, whoever is asking. */
function bookingFor(rows, pid, ref) {
  var mine = null;
  if (pid) rows.forEach(function (b) { if (b.pid && b.pid === pid) mine = b; });
  if (!mine && ref) rows.forEach(function (b) { if (!b.pid && b.device === ref) mine = b; });
  return mine;
}

/* Somebody sitting there trying numbers to see whose booking they can find.

   There is no address to count against in Apps Script, so this counts the
   handle the browser made up for itself. It is not a wall — a handle is
   whatever the asker says it is — and it is not pretending to be one. It is
   enough to make the idle version of that tedious, and nowhere near tight
   enough to trouble a family sharing one phone between four people.

   What it is really protecting is small, and worth saying out loud: somebody
   who knows a church member's mobile number can find out which stop they
   booked and could give the seat up in their name. No name, no other number
   and nothing else about them comes back. The remedy for that is the same as
   for anything else on this tab: the Bookings sheet says who did what. */
var IDENTIFY_MAX_TRIES = 25;
var IDENTIFY_WINDOW_MINUTES = 15;

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

/* How far AHEAD of the timetable a run may claim to be before the app stops
   believing it.

   Kept far tighter than the late side, and deliberately so: the two are not
   the same kind of event. A bus can honestly be three quarters of an hour
   late — traffic, a breakdown, a stop that took ten minutes to load. It
   cannot be half an hour early on a route timetabled to take an hour, because
   the road does not shrink. A large negative offset therefore does not mean a
   fast morning; it means a stop was marked that the bus had not reached, and
   every projection built on it is nonsense in the same direction.

   That is not theoretical. On the 30th a stop timetabled 10:21 was marked at
   09:45, the run read as 36 minutes ahead, and every passenger watching was
   shown an arrival time that had already gone past. */
var TRIP_MAX_EARLY = 12;

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

/* It is not enough now. A dropdown of buses on the rota has to read from
   somewhere, and a seat count has to come from somewhere, and the one place
   it must NOT come from is a second copy typed into this file — config.js
   already holds one and two lists that must agree is one list that will not.

   So: a tab, like the drivers and the stops. Whoever takes this over adds a
   bus by adding a row, not by asking somebody to edit code. */
var BUSES_SHEET    = "Buses";
var BUSES_HEADERS  = ["Registration", "Seats for passengers", "Active", "Notes"];

/* Seats are PASSENGER seats. The driver's seat is not one of them: a bus
   described as 17 seats carries 16 people plus whoever is driving. Getting
   that wrong by one would show somebody a seat that does not exist. */
/* Which bus goes where in ODD-numbered months. Even months are the reverse.
   September is odd, so this is September's pairing: South on the newer bus.
   Swap the two values to flip the whole cycle. */
var BUS_ROTATION_ODD = { north: "NH56 FWP", south: "YS70 PWE" };

var SEED_BUSES = [
  ["YS70 PWE", 16, "YES", "Ford Transit 460 Trend. 17 seats including the driver."],
  ["NH56 FWP", 14, "YES", "Ford Transit 100 RWD. 15 seats including the driver."]
];

/* The Sunday timetable, so it stops living only in a WhatsApp message.

   Type is Pickup or Arrival. Church is where the run ends, not somewhere
   anybody boards, and keeping that distinction here means nothing later can
   offer it as a place to be picked up.

   Family names are deliberately not in the stop labels. "Bellamy and
   Cromwell families at Church Lane" is fine among people who know each
   other. Written down it pairs a surname with a street and the exact minute
   those people stand outside, and this tab is read by the app. */
var STOPS_HEADERS = ["Route", "Stop ID", "Time", "Stop", "Postcode", "Active", "Type"];

/* Written out here rather than inline at the one place each tab is created,
   so the health check has something to compare a live sheet against. Three
   tabs had their headings buried in a call, and they were exactly the three
   the check could not cover. */
var CHECK_HEADERS = [
  "Received", "Check ID", "Date", "Time", "Vehicle", "Registration",
  "Driver", "Role", "Mileage", "Mileage flag", "Outcome",
  "Items checked", "Defect count", "Defects", "Renewals due", "Signed",
  "Not applicable", "Check type", "Where checked", "Accuracy (yd)",
  "Distance from base (yd)", "Location note", "Fuel", "To arrange", "PIN check"
];
var DEFECT_HEADERS = [
  "Received", "Check ID", "Date", "Registration", "Driver",
  "Item", "Critical", "What the driver found", "Status", "Action taken", "Closed on"
];
/* "Preferred swap", not "Swap with". */
var REQUEST_HEADERS = [
  "Received", "Request ID", "Sunday", "Driver", "Type", "Reason",
  "Preferred swap", "Status", "Decided on", "Replacement assigned",
  "Their Sunday", "Both agreed"
];

/* The requests tab's columns, by name. */
function requestCols(sh) {
  var m = headerMap(sh), T = REQUESTS_SHEET;
  return {
    received:    colOf(m, "Received", T),
    id:          colOf(m, "Request ID", T),
    sunday:      colOf(m, "Sunday", T),
    driver:      colOf(m, "Driver", T),
    type:        colOf(m, "Type", T),
    reason:      colOf(m, "Reason", T),
    swapWith:    colOf(m, "Preferred swap", T),
    status:      colOf(m, "Status", T),
    decidedOn:   colOf(m, "Decided on", T),
    replacement: colOf(m, "Replacement assigned", T),
    theirSunday: colOf(m, "Their Sunday", T),
    bothAgreed:  colOf(m, "Both agreed", T)
  };
}

/* Two headings this tab never gained.

   sheet() writes headings only when it CREATES a tab, so columns added to
   this file after a spreadsheet was set up never reached it. "Their Sunday"
   and "Both agreed" have been absent on the live sheet ever since, and
   approving a swap reads the first of them — it would have come back empty
   the first time anybody tried, and nothing would have said why.

   These two are at the END, so appending is safe even while this tab is
   still read by position elsewhere. */
function ensureRequestColumns(sh) {
  if (!sh) return false;
  var m = headerMap(sh), did = false;
  var at = sh.getLastColumn();
  REQUEST_HEADERS.forEach(function (h) {
    if (m[h]) return;
    at += 1;
    sh.getRange(1, at).setValue(h).setFontWeight("bold");
    sh.setColumnWidth(at, 130);
    did = true;
  });
  return did;
}

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

/* The script reads this tab by position, never by heading, so renaming these
   is purely cosmetic and cannot break anything. */
/* Beside the route they belong to, not appended to the end.

   Appending was the only safe option while this tab was read by position:
   anything else shifted every column after it and every getRange(row, n) in
   the file with it. Reading by name removed that constraint, so the column
   can go where somebody looking for it would look. */
var ROTA_HEADERS = [
  "Sunday",
  "North Liverpool scheduled", "North Liverpool actual / cover", "North bus",
  "Status",
  "South Liverpool scheduled", "South Liverpool actual / cover", "South bus",
  "Notes", "Updated", "Updated by"
];

/* The rota's columns, by name. Every read and write of this tab goes through
   here. */
function rotaCols(sh) {
  var m = headerMap(sh), T = ROTA_SHEET;
  return {
    date:       colOf(m, "Sunday", T),
    north:      colOf(m, "North Liverpool scheduled", T),
    northCover: colOf(m, "North Liverpool actual / cover", T),
    northBus:   colOf(m, "North bus", T),
    status:     colOf(m, "Status", T),
    south:      colOf(m, "South Liverpool scheduled", T),
    southCover: colOf(m, "South Liverpool actual / cover", T),
    southBus:   colOf(m, "South bus", T),
    notes:      colOf(m, "Notes", T),
    updated:    colOf(m, "Updated", T),
    updatedBy:  colOf(m, "Updated by", T)
  };
}

/* Put the two bus columns on a rota that predates them. */
/* An A1 range down one named column, for the dropdowns and the colouring.
   Beats "C2:C3000" for the same reason everything else here does. */
/* ---- the buses -------------------------------------------------------- */

/* Creates the tab and seeds it once. Never rewrites a row afterwards: the
   seats and the notes belong to whoever is running the transport, not to
   this file. */
function ensureBuses(ss) {
  var existing = ss.getSheetByName(BUSES_SHEET);
  var sh = sheet(ss, BUSES_SHEET, BUSES_HEADERS);
  /* Was: rewrite the whole heading row whenever it was wide enough, which
     relabelled anything a coordinator had put on this tab. */
  ensureCols(sh, BUSES_HEADERS);
  var bc = colsHard(sh, BUSES_SHEET);
  if (!existing) {
    sh.setColumnWidth(bc.reg, 130);
    sh.setColumnWidth(bc.seats, 160);
    sh.setColumnWidth(bc.active, 80);
    sh.setColumnWidth(bc.notes, 380);
    sh.setFrozenRows(1);
    sh.getRange(1, bc.seats).setNote(
      "PASSENGER seats. Not counting the driver.\n" +
      "A bus described as 17 seats carries 16 people plus whoever is driving.");
  }
  if (sh.getLastRow() < 2) {
    var wide = Math.max(sh.getLastColumn(), BUSES_HEADERS.length);
    sh.getRange(2, 1, SEED_BUSES.length, wide).setValues(SEED_BUSES.map(function (b) {
      var row = [];
      for (var i = 0; i < wide; i++) row.push("");
      row[bc.reg - 1] = b[0]; row[bc.seats - 1] = b[1];
      row[bc.active - 1] = b[2]; row[bc.notes - 1] = b[3];
      return row;
    }));
  }
  pretty("Buses dropdown", function () {
    sh.getRange(2, bc.active, 2000, 1).setDataValidation(listRule(["YES", "NO"]));
  });
  return sh;
}

function readBuses(ss) {
  var sh = ss.getSheetByName(BUSES_SHEET);
  if (!sh || sh.getLastRow() < 2) {
    /* Before the tab exists, the seeds are the answer. Nothing here should
       fall over on a spreadsheet that has not been set up yet. */
    return SEED_BUSES.map(function (b) {
      return { reg: b[0], seats: b[1], active: true, notes: b[3] };
    });
  }
  var c = colsSoft(sh, BUSES_SHEET);
  if (!c.reg) return [];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var out = [];
  vals.forEach(function (r) {
    var v = String(at1(r, c.reg) || "").trim();
    if (!v) return;
    out.push({
      reg: v,
      seats: Number(at1(r, c.seats)) || 0,
      /* Anything but a clear no counts as yes, so a blank cell on a bus
         somebody has just added does not quietly take it off the road. */
      active: String(at1(r, c.active) || "YES").trim().toUpperCase() !== "NO",
      notes: String(at1(r, c.notes) || "").trim()
    });
  });
  return out;
}

function busSeats(ss, reg) {
  var want = String(reg || "").trim().toUpperCase();
  var found = 0;
  readBuses(ss).forEach(function (b) {
    if (b.reg.toUpperCase() === want) found = b.seats;
  });
  return found;
}

/* ---- which bus is on which route --------------------------------------
   The rotation swaps by CALENDAR MONTH, and that is deliberate rather than
   convenient. A month is four or five Sundays, so it never falls into step
   with a three-driver rota or a four-driver one. A fixed four-week swap
   would have left all four North drivers in the same bus for good.

   Odd-numbered months follow config; even months are the other way round.
   September is odd, so the pairing set below is September's.

   An entry in the rota's own bus column beats all of this, for that Sunday
   only. Blank there means nobody has overruled anything. */
function busRule(key) {
  var d = keyToDate(key);
  if (!d) return null;
  var odd = ((d.getMonth() + 1) % 2) === 1;
  var pair = { North: BUS_ROTATION_ODD.north, South: BUS_ROTATION_ODD.south };
  if (!odd) pair = { North: BUS_ROTATION_ODD.south, South: BUS_ROTATION_ODD.north };
  return pair;
}

/* The bus for one route on one Sunday, and where the answer came from.
   Returns { reg, from: "rota"|"rotation", seats } — reg is "" when nothing
   can be resolved, and an empty answer must always be preferred to a guess. */
function busFor(ss, key, route) {
  var want = String(route || "").trim().toUpperCase().charAt(0) === "S" ? "South" : "North";
  var known = {};
  readBuses(ss).forEach(function (b) { known[b.reg.toUpperCase()] = b.reg; });

  var over = "";
  readRotaRows(ss).forEach(function (r) {
    if (r.date !== key) return;
    over = want === "South" ? r.southBus : r.northBus;
  });
  over = String(over || "").trim();
  if (over) {
    var hit = known[over.toUpperCase()];
    /* A registration nobody recognises is not an answer. Better to fall back
       to the rotation than to price a bus that does not exist. */
    if (hit) return { reg: hit, from: "rota", seats: busSeats(ss, hit) };
  }

  var pair = busRule(key);
  if (!pair) return { reg: "", from: "", seats: 0 };
  var reg = known[String(pair[want] || "").toUpperCase()] || "";
  return { reg: reg, from: reg ? "rotation" : "", seats: reg ? busSeats(ss, reg) : 0 };
}

/* ---- how full each bus is ---------------------------------------------

   Seats are known a week ahead because the bus is: the rotation names one for
   every Sunday, and the rota column can overrule it. Without that this could
   only ever have been answered at ten on Sunday morning, when the driver
   picks a vehicle — long after everybody has booked.

   What comes back is a count of BOOKINGS against seats, and those are not the
   same as bodies. People turn up without booking and booked people stay at
   home. The page has to be careful how it says this; the arithmetic here is
   honest about what it counted. */
function seatsFor(ss, key, route) {
  var want = String(route || "").trim().toUpperCase().charAt(0) === "S" ? "South" : "North";
  var bus = busFor(ss, key, want);

  var byStop = {};
  readBusStops(ss).forEach(function (s) { byStop[s.id] = s; });

  var booked = 0;
  readBookings(ss, key).forEach(function (b) {
    var s = byStop[b.stopId];
    if (!s || s.route !== want) return;
    booked += Number(b.seats) || 0;
  });

  var seats = bus.seats || 0;
  return {
    route: want,
    reg: bus.reg,
    from: bus.from,
    seats: seats,
    booked: booked,
    /* Negative when more are booked than the bus holds. The page says "full"
       either way; the number is for the coordinator, who can still do
       something about it. */
    left: seats ? (seats - booked) : null
  };
}

function rotaColRange(sh, col, rows) {
  return sh.getRange(2, col, (rows || 3000) - 1, 1);
}

function ensureRotaBusColumns(sh) {
  if (!sh) return false;
  var did = false;
  [["North bus", "North Liverpool actual / cover"],
   ["South bus", "South Liverpool actual / cover"]].forEach(function (pair) {
    var m = headerMap(sh);
    if (m[pair[0]]) return;                       /* already there */
    var after = m[pair[1]];
    if (!after) return;                           /* nothing to hang it on */
    sh.insertColumnAfter(after);
    sh.getRange(1, after + 1).setValue(pair[0]).setFontWeight("bold");
    sh.setColumnWidth(after + 1, 120);
    did = true;
  });
  return did;
}

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

    /* A passenger saying who they are. Handled before the token test for the
       same reason bookings are: the booking page must never need to carry
       the driver token.

       A POST rather than a query string on purpose. This is the one call in
       the whole app that carries somebody's phone number, and a POST body
       does not end up in an address bar, a browser history, a referrer or a
       line of Google's own request log. Everything after it goes by the
       fingerprint that comes back. */
    if (String(body.action || "") === "identify") {
      return handleIdentify(body);
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
    try {
      var lastOut = lastMileagePayload();
      /* The day's buses ride along on the one call the driver app makes at
         launch. Without this the phone only learns which bus is whose when
         the Stops screen is opened — which is AFTER the vehicle picker, the
         screen where a driver actually chooses one. The information was
         arriving after the moment it was for. */
      try {
        var ssL = SpreadsheetApp.getActiveSpreadsheet();
        var kL = dateToKey(sundayOf(new Date())), seatsL = {};
        routeNames(readBusStops(ssL)).forEach(function (rt) { seatsL[rt] = seatsFor(ssL, kL, rt); });
        lastOut.seats = seatsL;
        lastOut.buses = readBuses(ssL).map(function (b) { return { reg: b.reg, seats: b.seats }; });
      } catch (err2) { lastOut.seatsError = String(err2); }
      return reply(lastOut);
    }
    catch (err) { return reply({ ok: false, error: String(err) }); }
  }

  /* What the passenger page loads: the stops for that Sunday, how many are
     booked at each, and this device's own booking if it has one. */
  if (p.bus) {
    try { return reply(busPayload(p.d, p.ref, p.pid)); }
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
      /* s is the stop a passenger has said they are waiting at, for a phone
         that holds no booking of its own. See tripPayload. */
      return reply(p.route ? tripDriverPayload(p.route)
                           : tripPayload(p.ref, p.r, p.s, p.pid));
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
  var checks = sheet(ss, CHECKS_SHEET, CHECK_HEADERS);
  ensureChecksColumns(checks);

  /* What the location columns mean, written where somebody looking at a blank
     cell will find it. Location note is empty on a good check and that is the
     whole design — it speaks only when there is something to say — but an
     empty column with a name like that reads as a column that has failed. */
  if (!structFresh("checknotes")) {
    pretty("Checks location column notes", function () {
      var cn = colsHard(checks, CHECKS_SHEET);
      checks.getRange(1, cn.away).setNote(
        "How far the phone was from where the buses are kept, in yards. " +
        "Under the radius set in config.js and the check counts as done at " +
        "the bus.");
      checks.getRange(1, cn.locNote).setNote(
        "Blank on a good check, and that is normal \u2014 it is not a column " +
        "that failed to fill.\n\n" +
        "It only speaks when something is worth saying:\n" +
        "  Away from the buses         a fix, but further out than the radius\n" +
        "  Driver did not allow location\n" +
        "  No fix in time\n" +
        "  Phone cannot give a location\n" +
        "  Not recorded                turned off in config.js\n\n" +
        "A blank here with a link in Where checked means the walkaround " +
        "happened at the bus, which is the thing this column exists to be " +
        "able to show.");
    });
    structDone("checknotes");
  }

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

  /* Each value at its own column, on a row as wide as the tab. Hard map:
     this has just run ensureChecksColumns, so every heading exists, and a
     walkaround written into the wrong columns is worse than one refused —
     the phone keeps it queued and sends it again. */
  var kc = colsHard(checks, CHECKS_SHEET);
  var kw = Math.max(checks.getLastColumn(), CHECK_HEADERS.length);
  var krow = [];
  for (var ki = 0; ki < kw; ki++) krow.push("");
  var kput = function (col, v) { if (col) krow[col - 1] = v; };

  kput(kc.received,    new Date());
  kput(kc.id,          c.id);
  kput(kc.date,        safeText(c.date));
  kput(kc.time,        safeText(c.time));
  kput(kc.vehicle,     safeText(c.vehicle));
  kput(kc.reg,         safeText(c.reg));
  kput(kc.driver,      safeText(c.driver));
  kput(kc.role,        safeText(c.role));
  kput(kc.mileage,     c.miles || "");
  kput(kc.mileageFlag, safeText(c.milesFlag));
  kput(kc.outcome,     outcome);
  kput(kc.items,       (c.checked || "") + "/" + (c.total || ""));
  kput(kc.defectCount, (c.defects || []).length);
  kput(kc.defects,     safeText(defectText));
  kput(kc.renewals,    safeText(c.renewals));
  kput(kc.signed,      safeText(c.sign));
  kput(kc.na,          safeText((c.na || []).join(", ")));
  kput(kc.type,        safeText(c.kind || "Pre-drive"));
  kput(kc.where,       locCell);
  kput(kc.acc,         (c.locAcc === 0 || c.locAcc) ? c.locAcc : "");
  kput(kc.away,        (c.locDist === 0 || c.locDist) ? c.locDist : "");
  kput(kc.locNote,     safeText(c.locNote));
  kput(kc.fuel,        safeText(c.fuel));
  kput(kc.arrange,     safeText((c.jobs || []).join(", ")));
  kput(kc.pinCheck,    pinWords(c));

  checks.getRange(checks.getLastRow() + 1, 1, 1, kw).setValues([krow]);

  // One row per defect as well, so the coordinator can filter and chase them.
  if ((c.defects || []).length) {
    var defs = sheet(ss, DEFECTS_SHEET, DEFECT_HEADERS);
    ensureCols(defs, DEFECT_HEADERS);
    var dfc = colsHard(defs, DEFECTS_SHEET);
    var dfw = Math.max(defs.getLastColumn(), DEFECT_HEADERS.length);
    c.defects.forEach(function (d) {
      var drow = [];
      for (var di = 0; di < dfw; di++) drow.push("");
      var dput = function (col, v) { if (col) drow[col - 1] = v; };
      dput(dfc.received, new Date());
      dput(dfc.id,       c.id);
      dput(dfc.date,     safeText(c.date));
      dput(dfc.reg,      safeText(c.reg));
      dput(dfc.driver,   safeText(c.driver));
      dput(dfc.item,     safeText(d.name));
      dput(dfc.critical, d.crit ? "YES" : "");
      dput(dfc.found,    safeText(d.note));
      dput(dfc.status,   "Open");
      defs.getRange(defs.getLastRow() + 1, 1, 1, dfw).setValues([drow]);
      applyStatusDropdown(defs, defs.getLastRow());
    });
  }

  /* Also when the bus is fine but wants something doing. */
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

/* ---- a convenience that must never break a write ------------------------

   Dropdowns, colours, column widths and header notes are all in one class:
   worth having, never the point. A tab converted to a Google Sheets Table
   refuses every one of them outright — "This operation is not allowed on
   cells in typed columns" — because a Table gives its columns types of its
   own and will not have a script setting validation over the top.

   Until now that exception travelled all the way out. It stopped Set up dead
   at the Drivers tab, which meant the rota fill, the scheduled emails and the
   sheet protection below it never ran either. And had the Defects tab ever
   been made a Table, applyStatusDropdown would have failed a driver's defect
   report on its way in — a cosmetic dropdown losing a fault report.

   Recorded rather than swallowed, so the health check can say what was
   skipped instead of the sheet quietly doing less than it says. */
var PRETTY_SKIPS = [];

function pretty(what, fn) {
  try { fn(); return true; }
  catch (err) {
    PRETTY_SKIPS.push(what + " \u2014 " + String((err && err.message) || err));
    return false;
  }
}

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
                                            structKey("trip"), structKey("bookings"),
                                            structKey("stoptypes"),
                                            structKey("tripvalid"),
                                            structKey("checknotes"),
                                            STOPS_CACHE_KEY]);
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

  var head = headerRow(sh);
  if (!head.length) return;
  head.forEach(function (name, i) {
    if (RENAMED[name]) sh.getRange(1, i + 1).setValue(RENAMED[name]);
  });

  /* Anything missing goes in beside its neighbour, not on the end and never
     over the top of a column somebody added. */
  ensureCols(sh, CHECK_HEADERS);

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

  /* Only the recent end of the tab. */
  var c = colsSoft(sh, CHECKS_SHEET);
  var lastRow  = sh.getLastRow();
  var firstRow = Math.max(2, lastRow - MILEAGE_SCAN_ROWS + 1);
  var rows = sh.getRange(firstRow, 1, lastRow - firstRow + 1, sh.getLastColumn()).getValues();
  var last = {};

  rows.forEach(function (r) {
    var reg = String(at1(r, c.reg) || "").trim();
    var miles = Number(at1(r, c.mileage));
    if (!reg || !miles) return;
    /* See checkMoment: Received is used when it is present and not in the
       future, and the row's own Date and Time carry it otherwise. */
    var when = checkMoment(at1(r, c.received), at1(r, c.date), at1(r, c.time));
    if (!last[reg] || when >= last[reg]._t) {
      last[reg] = { miles: miles,
                    date: dayWords(at1(r, c.date)),
                    time: timeWords(at1(r, c.time)),
                    driver: String(at1(r, c.driver) || ""), _t: when };
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
    /* Which bus the rota says, and how many seats it has, for both routes.
       The app never stops him taking a different one — it only tells him what
       that costs, which is a thing he can act on. */

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
  sheet(ss, REQUESTS_SHEET, REQUEST_HEADERS);

  /* Seed the register here rather than only in setUpEverything. Whichever
     path reaches the sheet first must leave it usable: an empty Drivers tab
     means no dropdowns and no pattern to fill the rota from. */
  /* Route must go in with the rest. Blank counts as North, so a seeded row
     with no route puts a South driver on the North pattern. Either this or
     ensureDrivers can be the first to reach an empty tab, so both seed the
     same way. */
  if (drivers.getLastRow() < 2) {
    ensureCols(drivers, DRIVERS_HEADERS);
    var dc0 = colsHard(drivers, DRIVERS_SHEET);
    var w0 = Math.max(drivers.getLastColumn(), DRIVERS_HEADERS.length);
    SEED_DRIVERS.forEach(function (d) { drivers.appendRow(driverRow(dc0, w0, d)); });
  }

  structDone("rota");
}

/* Rolls the filled horizon forward.

   It now belongs to nightlyMaintenance, on a timer at 3am. This function is
   only the safety net. It does nothing while the nightly job is healthy, and
   takes over if the job was never installed (permission refused at setup) or
   has stopped running for three days. */
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
  try { fillBusesAhead(ss); } catch (err) { /* never block the rota on this */ }
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
  try { fillBusesAhead(ss); } catch (err) { /* never block the rota on this */ }

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
  var cell = sh.getRange(row, rotaCols(sh).notes);
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
  var c = rotaCols(sh);
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var at = function (r, col) { return String(r[col - 1] == null ? "" : r[col - 1]).trim(); };
  var out = [];
  values.forEach(function (r) {
    var key = anyToKey(r[c.date - 1]);
    if (!key) return;
    out.push({
      date: key,
      primary:  at(r, c.north),
      actual:   at(r, c.northCover),
      status:   at(r, c.status),
      primary2: at(r, c.south),
      actual2:  at(r, c.southCover),
      notes:    at(r, c.notes),
      /* Blank means nobody has overruled the rotation for that Sunday. */
      northBus: at(r, c.northBus),
      southBus: at(r, c.southBus)
    });
  });
  return out;
}

/** The newest request per Sunday, so the app can show "change requested". */
/* The latest request per driver per Sunday.

   Now a list per Sunday. Later rows still replace earlier ones FOR THE SAME
   PERSON, so a driver who asks twice still shows only their latest. */
function readLatestRequests(ss) {
  var sh = ss.getSheetByName(REQUESTS_SHEET);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var rq = requestCols(sh);
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  values.forEach(function (r) {
    var key = anyToKey(r[rq.sunday - 1]);
    if (!key) return;
    var one = {
      driver: String(r[rq.driver - 1] || "").trim(),
      type: String(r[rq.type - 1] || "").trim(),
      status: String(r[rq.status - 1] || "Pending").trim()
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
  /* By heading. This function is called by nearly everything, so it must not
     throw on a tab that is merely out of date: a heading that is not there
     resolves to column 0 and reads blank, which is what a sheet without that
     column knows. */
  var c = colsSoft(sh, DRIVERS_SHEET);
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var out = [];
  values.forEach(function (r) {
    var name = String(at1(r, c.name) || "").trim();
    if (!name) return;
    out.push({
      name: name,
      role: String(at1(r, c.role) || "").trim(),
      active: yes(at1(r, c.active)),
      order: Number(at1(r, c.order)) || 0,
      pin: String(at1(r, c.pin) || "").replace(/\D/g, ""),
      email: String(at1(r, c.email) || "").trim(),
      /* Blank counts as North. The route column did not exist until the South
         run started, so every row written before then is a North row, and
         reading blank as North means nobody has to go back and fill it in. */
      route: (String(at1(r, c.route) || "").trim().toUpperCase().charAt(0) === "S")
        ? "South" : "North",
      /* Set in the sheet, never in a file, exactly as the PIN is. A driver
         with no number simply has no WhatsApp button on the passenger page,
         so leaving this blank is a working answer rather than a fault. */
      phone: String(at1(r, c.phone) || "").trim()
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

  var sh = sheet(ss, REQUESTS_SHEET, REQUEST_HEADERS);

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
  var qc = requestCols(sh);
  var qw = Math.max(sh.getLastColumn(), REQUEST_HEADERS.length);
  var qrow = [];
  for (var qi = 0; qi < qw; qi++) qrow.push("");
  var qput = function (col, v) { if (col) qrow[col - 1] = v; };
  qput(qc.received,    new Date());
  qput(qc.id,          safeText(rq.id));
  qput(qc.sunday,      sunday);
  qput(qc.driver,      safeText(rq.driver));
  qput(qc.type,        safeText(rq.type));
  qput(qc.reason,      safeText(rq.reason));
  qput(qc.swapWith,    safeText(rq.swapWith));
  qput(qc.status,      "Pending");
  qput(qc.theirSunday, rq.swapDate ? keyToDate(rq.swapDate) : "");
  qput(qc.bothAgreed,  rq.agreed ? "YES" : "");
  sh.getRange(sh.getLastRow() + 1, 1, 1, qw).setValues([qrow]);

  var row = sh.getLastRow();
  sh.getRange(row, qc.sunday).setNumberFormat("dd/mm/yyyy");
  applyRequestValidation(sh, row);

  // Flag it on the official rota so the Sunday visibly needs attention, but
  // do NOT change the driver. Only the coordinator does that.
  markRotaStatus(ss, rq.date, "Change requested");

  bumpRotaVersion();
  if (COORDINATOR_EMAIL) notifyRotaRequest(rq, sunday);

  return reply({ ok: true });
}

/* By name. Request ID is the second column today and there is no reason it
   has to stay that way. */
function alreadyHaveRequest(sh, id) {
  if (!id) return false;
  var last = sh.getLastRow();
  if (last < 2) return false;
  var ids = sh.getRange(2, requestCols(sh).id, last - 1, 1).getValues();
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
  sh.getRange(row, rotaCols(sh).status).setValue(status);
  stamp(sh, row, "App");
}

function findRotaRow(sh, key) {
  if (sh.getLastRow() < 2) return 0;
  var values = sh.getRange(2, rotaCols(sh).date, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (anyToKey(values[i][0]) === key) return i + 2;
  }
  return 0;
}

function appendRotaRow(ss, sh, d) {
  var pattern = bothPatterns(ss);
  var c = rotaCols(sh);
  /* By name. The positional version wrote a nine-item list into a tab that
     is now eleven columns wide, so "Confirmed" would have landed in the
     North bus column and the South driver in Status. */
  var row0 = new Array(Math.max(sh.getLastColumn(), ROTA_HEADERS.length)).fill("");
  row0[c.date - 1]   = d;
  row0[c.north - 1]  = patternDriver(d, pattern.north);
  row0[c.status - 1] = "Confirmed";
  row0[c.south - 1]  = southDriver(d, pattern.south);
  sh.appendRow(row0);
  var row = sh.getLastRow();
  sh.getRange(row, c.date).setNumberFormat("dd/mm/yyyy");
  applyRotaValidation(sh, row);
  return row;
}

/* Columns 8 and 9 for as long as the rota was nine columns wide. It is
   eleven now, and 8 and 9 are the South bus and the Notes — so this would
   have quietly written a timestamp over a bus and the word "Coordinator"
   over somebody's note, every time a swap was approved. Nothing would have
   complained. This is the whole argument for reading by name in one
   function. */
function stamp(sh, row, who) {
  var c = rotaCols(sh);
  sh.getRange(row, c.updated).setValue(new Date()).setNumberFormat("dd/mm/yyyy hh:mm");
  sh.getRange(row, c.updatedBy).setValue(who || "Coordinator");
}

/* ---- rota: setup and maintenance --------------------------------------- */

/** Run this once by hand after pasting the script in. Safe to run again. */
/* Read by heading, like every tab. A column inserted anywhere on this one is
   read past; a heading renamed or deleted stops the script with a sentence
   naming it. driversHeaderWarning is the smoke alarm beside that: it repairs
   nothing, it only tells a human which heading has gone missing. */
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
/* Rota bus sits beside Reg on purpose: Reg is the bus that went, Rota bus is
   the one the rota gave that route, and a start row where the two differ is a
   deviation you can see without cross-referencing anything.

   The three location columns follow. They are filled on the START row only —
   a fix per tap would be tracking, which this app does not do. What they
   answer is one question: where was the bus when the run began. It may have
   left church after its inspection, or been on the road already. */
var TRIP_HEADERS = ["Logged", "Trip", "Sunday", "Route", "Driver", "Event",
                    "Stop ID", "Stop", "Scheduled", "Happened", "Offset", "Status",
                    "Reg", "Rota bus",
                    "Where started", "Accuracy (yd)", "Distance from base (yd)"];

function driversHeaderWarning(ss) {
  try {
    var sh = ss.getSheetByName(DRIVERS_SHEET);
    if (!sh) return "";
    /* Missing, not misplaced. The app finds these columns by heading now, so
       the order they sit in is the coordinator's business and only a heading
       that is not there at all is a problem. This used to complain about
       every column to the right of an inserted one, which was noise about a
       sheet that was working perfectly well. */
    var map = headerMap(sh);
    var gone = DRIVERS_HEADERS.filter(function (want) { return !map[want]; });
    if (!gone.length) return "";
    return "The Drivers tab is missing " +
           (gone.length > 1 ? "these columns" : "this column") + ":\n  " +
           gone.join("\n  ") +
           "\n\nRun Minibus > Rota > Set up / refresh rota to put " +
           (gone.length > 1 ? "them" : "it") + " back.";
  } catch (err) { return ""; }
}

/* Fills in Route for drivers we already know about, and only where the cell
   is empty.

   Anyone not in the built-in list is left blank on purpose. Guessing at a
   name we do not recognise would be inventing a fact about a person. */
function backfillRoutes(sh) {
  var last = sh.getLastRow();
  if (last < 2) return 0;

  var known = {};
  SEED_DRIVERS.forEach(function (d) { if (d.route) known[d.name] = d.route; });

  var dc = colsSoft(sh, DRIVERS_SHEET);
  if (!dc.name || !dc.route) return 0;
  var names  = sh.getRange(2, dc.name, last - 1, 1).getValues();
  var routes = sh.getRange(2, dc.route, last - 1, 1).getValues();
  var filled = 0;

  for (var i = 0; i < names.length; i++) {
    if (String(routes[i][0] || "").trim()) continue;      // already answered
    var r = known[String(names[i][0] || "").trim()];
    if (!r) continue;                                     // not ours to guess
    routes[i][0] = r;
    filled++;
  }
  if (filled) sh.getRange(2, dc.route, last - 1, 1).setValues(routes);
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
  var rbc = rotaCols(sh);
  var vals = sh.getRange(2, 1, n, sh.getLastColumn()).getValues();
  var today = sundayOf(new Date());
  var changes = [], skipped = 0;

  for (var i = 0; i < n; i++) {
    var key = anyToKey(vals[i][rbc.date - 1]);
    if (!key) continue;
    var d = keyToDate(key);
    if (d < today) continue;                                  // been and gone

    var status = String(vals[i][rbc.status - 1] || "").trim();
    var hasCover = String(vals[i][rbc.northCover - 1] || "").trim() ||
                   String(vals[i][rbc.southCover - 1] || "").trim();
    if (hasCover || (status && status !== "Confirmed")) { skipped++; continue; }

    var wantN = patternDriver(d, pattern.north);
    var wantS = southDriver(d, pattern.south);
    if (String(vals[i][rbc.north - 1] || "").trim() === wantN &&
        String(vals[i][rbc.south - 1] || "").trim() === wantS) continue;   // already right

    changes.push({ row: i + 2, key: key,
                   fromN: String(vals[i][rbc.north - 1] || "").trim(), toN: wantN,
                   fromS: String(vals[i][rbc.south - 1] || "").trim(), toS: wantS });
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
    sh.getRange(c.row, rbc.north).setValue(c.toN);
    sh.getRange(c.row, rbc.south).setValue(c.toS);
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
    /* Everything a person is meant to edit: the two scheduled names, the two
       cover names, the status, the two buses and the notes. The Sunday itself
       and the two Updated columns belong to the script.

       Worked out from the headings rather than written down as "B to G",
       which stopped being true the moment a bus column went in between. */
    var c = rotaCols(sh);
    var from = Math.min(c.north, c.northCover, c.northBus, c.status,
                        c.south, c.southCover, c.southBus, c.notes);
    var to   = Math.max(c.north, c.northCover, c.northBus, c.status,
                        c.south, c.southCover, c.southBus, c.notes);
    return [sh.getRange(2, from, last(sh) - 1, to - from + 1)];
  }, "Rota: dates and the Updated columns are written by the app");

  add(REQUESTS_SHEET, function (sh) {
    var rq = requestCols(sh);
    return [sh.getRange(2, rq.status,      last(sh) - 1, 1),
            sh.getRange(2, rq.replacement, last(sh) - 1, 1)];
  }, "Requests: everything except Status and Replacement came from a driver's phone");

  add(DEFECTS_SHEET, function (sh) {
    /* Status, Action taken and Closed on, found by heading. As three columns
       from position 9 this unlocked whatever happened to sit there. */
    var d = colsSoft(sh, DEFECTS_SHEET), out = [];
    [d.status, d.action, d.closed].forEach(function (col) {
      if (col) out.push(sh.getRange(2, col, last(sh) - 1, 1));
    });
    return out;
  }, "Defects: what the driver reported is not editable");

  add(CHECKS_SHEET, function () { return []; },
      "Checks: a signed record of what was inspected");

  /* Seats, Active and Notes are the editable part: a coordinator changes
     those. The registration is not, because every other tab refers to a bus
     by it — the rota's two columns, the Checks tab, Trip Events — so
     retyping it here would silently detach a bus from its own history. Add a
     bus by adding a row; never rename an existing one. */
  add(BUSES_SHEET, function (sh) {
    var b = colsSoft(sh, BUSES_SHEET), out = [];
    [b.seats, b.active, b.notes].forEach(function (col) {
      if (col) out.push(sh.getRange(2, col, last(sh) - 1, 1));
    });
    return out;
  }, "Buses: the registration is how every other tab refers to a bus");

  add(BOOKINGS_SHEET, function (sh) {
    /* Status only, so a booking can be struck out by hand if somebody rings
       you after the cut-off. Everything else came from a passenger's phone
       and editing it would put words in their mouth, the same reasoning as
       the Requests tab.

       Phone and Passenger ID matter most here. Together they are how
       somebody's own booking is found again on any device they pick up, so
       altering either one silently detaches a person from the row they made
       — and the fingerprint cannot be typed back in by hand, because it is
       worked out from the number rather than chosen. Correct a mistyped
       number by asking the passenger to enter it again on the page. */
    var b = colsSoft(sh, BOOKINGS_SHEET);
    return b.status ? [sh.getRange(2, b.status, last(sh) - 1, 1)] : [];
  }, "Bus Bookings: written by passengers, only Status is yours");

  add(TRIP_SHEET, function () { return []; },
      "Trip Events: what a driver tapped, and when. Nothing here is yours to edit");

  add(STOPS_SHEET, function (sh) {
    /* Left live below the header. Times and stops do change, and this is the
       one place they should be changed. */
    return [sh.getRange(2, 1, last(sh) - 1,
                        Math.max(sh.getLastColumn(), STOPS_HEADERS.length))];
  }, "Bus Stops: the header row is fixed, the timetable below it is yours");

  add(DRIVERS_SHEET, function (sh) {
    /* The whole width of the tab, so every column of the register is
       editable — including any the coordinator has added himself. */
    return [sh.getRange(2, 1, last(sh) - 1,
                        Math.max(sh.getLastColumn(), DRIVERS_HEADERS.length))];
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

  var FUEL_COL = colsSoft(sh, CHECKS_SHEET).fuel;
  if (!FUEL_COL) { ui.alert("The Checks tab has no Fuel column, so there is nothing to repair."); return; }
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
  PRETTY_SKIPS = [];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  /* Each tab on its own. One of them refusing a dropdown — which is all a
     Table ever does — used to end the whole run where it stood, so the rota
     fill, the scheduled emails and the sheet protection underneath never
     happened and nothing said so. */
  pretty("Rota tabs",   function () { ensureRotaSheets(ss); });
  pretty("Bus Stops",   function () { ensureBusStops(ss); });
  pretty("Bus Bookings",function () { ensureBookings(ss); });
  pretty("Trip Events", function () { ensureTripEvents(ss); });
  pretty("Drivers",     function () { ensureDrivers(ss); });
  pretty("Buses",       function () { ensureBuses(ss); });
  pretty("Rota Requests", function () {
    ensureRequestColumns(ss.getSheetByName(REQUESTS_SHEET));
  });
  pretty("Rota",        function () { ensureRota(ss); });

  /* Run by hand means fill now, whatever the once-a-day stamp says. */
  try { PropertiesService.getScriptProperties().deleteProperty("rotaFilledAt"); }
  catch (err) {}
  fillRotaAhead(ss);
  try { fillBusesAhead(ss); } catch (err) { /* never block the rota on this */ }

  /* Guarded, and guarded for a reason. This used to be a bare call, so a
     failure inside it skipped everything below: the rota version, all five
     scheduled jobs, and the sheet protection. A cosmetic step was taking down
     the parts that actually matter. */
  var dropSkips = [];
  try { dropSkips = refreshDropdowns() || []; }
  catch (err) { dropSkips = ["dropdowns and colours (" + String(err.message || err) + ")"]; }
  /* Everything the tabs above refused, said in the same breath as the
     dropdowns, because to whoever is reading it they are the same problem. */
  dropSkips = PRETTY_SKIPS.concat(dropSkips);
  try { PropertiesService.getScriptProperties()
          .setProperty("setupSkipped", JSON.stringify(dropSkips)); }
  catch (err) {}

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

var STOP_TYPES = ["Pickup", "Arrival", "Depart"];

var STOP_TYPE_NOTE =
  "Pickup, Arrival or Depart.\n\n" +
  "Pickup  somewhere people wait.\n" +
  "Arrival where the run ends. Nobody boards there.\n" +
  "Depart  when the bus leaves church. One row per route, and it is a time " +
  "rather than a place \u2014 it is what lets the app say how many minutes " +
  "behind or ahead the run is before the first stop has been reached. " +
  "Nobody can book it and no driver taps it.";

function ensureBusStops(ss) {
  var existing = ss.getSheetByName(STOPS_SHEET);
  var sh = sheet(ss, STOPS_SHEET, STOPS_HEADERS);
  ensureCols(sh, STOPS_HEADERS);
  var sc = colsHard(sh, STOPS_SHEET);
  if (!existing) {
    SEED_STOPS.forEach(function (r) { sh.appendRow(r); });
    sh.setColumnWidth(sc.stop, 340);
    sh.getRange(1, sc.time).setNote("Written as text, 09:50, not a time value.");
    sh.getRange(1, sc.active).setNote("NO takes a stop out of the app without deleting it.");
    sh.setFrozenRows(1);
  }
  /* The Type dropdown, applied to sheets that already exist as well as new
     ones.

     It used to be set once, when the tab was first created, from a list of
     two words. Adding a third to the code therefore did nothing at all to any
     spreadsheet already in use: the sheet went on refusing "Depart" with
     "Input must be an item on the specified list", and the only clue was a
     validation rule written months earlier that nothing in the code was ever
     going to revisit.

     Guarded so it is written once an hour at most rather than on every read,
     and keyed on the list itself, so the next word added here fixes every
     sheet by itself instead of waiting to be noticed. */
  if (!structFresh("stoptypes")) {
    pretty("Bus Stops Type dropdown (Pickup / Arrival / Depart)", function () {
      /* Down the named columns, not down F and G. Those two letters were
         only ever "Active" and "Type" because nothing had been inserted to
         the left of them. */
      sh.getRange(2, sc.active, 399, 1).setDataValidation(listRule(["YES", "NO"]));
      sh.getRange(2, sc.type, 399, 1).setDataValidation(listRule(STOP_TYPES));
      sh.getRange(1, sc.type).setNote(STOP_TYPE_NOTE);
    });
    structDone("stoptypes");
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

/* Every row on the tab, departures included. Only the departure lookup and
   the trip writer want this; everything else wants readBusStops below, which
   is the list of places a passenger can be picked up from. */
function readBusStopsAll(ss) {
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

/* ---- the stops, as everything except the timing code means them ---------

   A Depart row is a timing point, not a place anybody waits. It exists so the
   moment the bus pulls out of church can be measured against a timetable the
   same way every pickup already is — and for no other reason.

   Filtered out here rather than at each of the dozen call sites, so it cannot
   leak into a booking list, a driver's tap list, a seat count or the "every
   booked stop is done" test by somebody forgetting one of them. Nothing that
   existed before this row can see it. */
function readBusStops(ss) {
  var all = readBusStopsAll(ss);
  var out = [];
  for (var i = 0; i < all.length; i++) if (!all[i].depart) out.push(all[i]);
  return out;
}

/* Where a route is timetabled to leave from, if the tab says. One row per
   route, or none, and none is a perfectly good answer: without it the run
   simply has no offset until the first stop is marked, which is exactly how
   it behaved before. */
function departStopFor(ss, route) {
  var all = readBusStopsAll(ss);
  for (var i = 0; i < all.length; i++) {
    if (all[i].depart && all[i].route === route && all[i].time) return all[i];
  }
  return null;
}

function readBusStopsFresh(ss) {
  var sh = ss.getSheetByName(STOPS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var c = colsSoft(sh, STOPS_SHEET);
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var out = [];
  vals.forEach(function (r) {
    var stop = String(at1(r, c.stop) || "").trim();
    if (!stop) return;
    if (String(at1(r, c.active) || "YES").trim().toUpperCase() === "NO") return;
    var t = at1(r, c.time), type = String(at1(r, c.type) || "").trim().toLowerCase();
    out.push({
      route: (String(at1(r, c.route) || "").trim().toUpperCase().charAt(0) === "S")
        ? "South" : "North",
      id: String(at1(r, c.id) || "").trim(),
      /* Read as text. A cell holding 09:50 as a real time comes back as a
         Date, and the fuel column already taught us what that does. */
      time: (t && typeof t.getHours === "function")
        ? Utilities.formatDate(t, Session.getScriptTimeZone(), "HH:mm")
        : String(t || "").trim(),
      stop: stop,
      postcode: String(at1(r, c.postcode) || "").trim(),
      arrival: type.indexOf("arriv") === 0,
      /* Type "Depart": where the run begins, and the only row on this tab
         that is a time rather than a place to stand. */
      depart: type.indexOf("depart") === 0
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

/**
 * Adds any column this version writes that an older sheet does not have yet,
 * by inserting it beside its neighbour rather than stamping a heading over
 * whatever occupies that position. See ensureCols.
 */
function ensureBookingColumns(sh) {
  if (structFresh("bookings")) return;

  ensureCols(sh, BOOKINGS_HEADERS);

  /* Plain text down the Phone column, or Sheets reads 07377634214 as a
     number, eats the leading zero and shows 7377634214. Every write also
     goes in with a leading apostrophe, because a format set here does not
     help a row appended by a passenger before anybody opened the tab. Belt
     and braces on purpose: a number with its first digit missing is not a
     number anybody can ring. */
  var c = colsSoft(sh, BOOKINGS_SHEET);
  if (c.phone) {
    try { sh.getRange(2, c.phone, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat("@"); }
    catch (err) { /* the apostrophe below is the one that actually matters */ }
  }

  structDone("bookings");
}

function ensureBookings(ss) {
  var existing = ss.getSheetByName(BOOKINGS_SHEET);
  var sh = sheet(ss, BOOKINGS_SHEET, BOOKINGS_HEADERS);
  ensureBookingColumns(sh);
  if (!existing) {
    var c = colsHard(sh, BOOKINGS_SHEET);
    sh.getRange(1, c.seats).setNote("How many people are boarding there, not who.");
    sh.getRange(1, c.device).setNote(
      "A random handle the passenger's own browser made up.\n\n" +
      "It used to be the whole identity, which is why one family could end " +
      "up with two bookings. The phone number two columns along does that " +
      "job now. This is kept because it still finds a booking made before " +
      "numbers existed, and because it says which device last touched a row.");
    sh.getRange(1, c.phone).setNote(
      "The passenger's own phone number, given on the booking page and kept " +
      "here so somebody can be rung on a Sunday morning.\n\n" +
      "This is the only personal thing on this tab. It is not in the app, " +
      "not on the website and not in the code: it exists here and nowhere " +
      "else. Treat the tab accordingly.");
    sh.getRange(1, c.passenger).setNote(
      "A one-way fingerprint of the number beside it, so the booking page " +
      "can find somebody's booking again without sending their number every " +
      "time it asks.\n\n" +
      "Written by the script. Editing it detaches the person from their row.");
    sh.setFrozenRows(1);
    sh.setColumnWidth(c.stop, 300);
  }
  return sh;
}

/* One Bus Bookings row, as wide as the tab actually is, each value at its own
   column. A coordinator's own column in the middle keeps its place and is
   left empty by us rather than written over. */
function bookingRow(c, wide, v) {
  var row = [];
  for (var i = 0; i < wide; i++) row.push("");
  var put = function (col, val) { if (col && val !== undefined) row[col - 1] = val; };
  put(c.received,  v.received);
  put(c.sunday,    v.sunday);
  put(c.route,     v.route);
  put(c.stopId,    v.stopId);
  put(c.stop,      v.stop);
  put(c.seats,     v.seats);
  put(c.device,    v.device);
  put(c.status,    v.status);
  put(c.phone,     v.phone);
  put(c.passenger, v.passenger);
  return row;
}

function readBookings(ss, key) {
  var rehearsing = !!rehearsalOn();
  var sh = ss.getSheetByName(BOOKINGS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  /* By heading, and the whole width of the tab. A sheet still on the old
     eight columns resolves those eight and returns the two newer fields
     empty, which is exactly what an old row means — the same tolerance the
     width clamp used to give, now per column instead of per tab. This call
     loads the page for the whole congregation, so it must never throw on a
     sheet that is merely out of date. */
  var c = colsSoft(sh, BOOKINGS_SHEET);
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var out = [];
  vals.forEach(function (r, i) {
    if (anyToKey(at1(r, c.sunday)) !== key) return;
    var status = String(at1(r, c.status) || "").trim().toLowerCase();
    if (status === "cancelled") return;
    /* Seeded test bookings. Inert unless a rehearsal is actually running, so
       a row left behind by a crash cannot quietly inflate a real Sunday. */
    if (status === "rehearsal" && !rehearsing) return;
    /* The apostrophe that keeps the leading zero is a formatting mark and
       does not come back with the value, but a number typed in by hand may
       carry one for real. Strip it either way. */
    var raw = at1(r, c.phone);
    var phone = String(raw == null ? "" : raw).trim().replace(/^'/, "");
    var pid = at1(r, c.passenger);
    out.push({ row: i + 2, stopId: String(at1(r, c.stopId) || "").trim(),
               seats: Number(at1(r, c.seats)) || 0,
               device: String(at1(r, c.device) || "").trim(),
               phone: phone,
               pid: String(pid == null ? "" : pid).trim() });
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

/* Cached, because several drivers polling at once on a Sunday morning is
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

/* Only the flag. Deliberately does not touch the sheet. */
function rehearsalClear() {
  try { PropertiesService.getScriptProperties().deleteProperty("rehearsal"); }
  catch (err) {}
}

/* Test bookings, on both routes, so either can be walked through. Two stops
   per route rather than every stop: enough to exercise the sequence, the
   empty-stop case and the gone-past case, without a wall of green. */
function rehearsalSeed(ss, key) {
  var sh = ensureBookings(ss);
  var bc = colsHard(sh, BOOKINGS_SHEET);
  var wide = Math.max(sh.getLastColumn(), BOOKINGS_HEADERS.length);
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
      rows.push(bookingRow(bc, wide, {
        received: new Date(), sunday: key, route: route, stopId: p.s.id,
        stop: p.s.stop, seats: p.n,
        device: "rehearsal-" + route.toLowerCase() + "-" + i,
        status: "Rehearsal"
      }));
    });
  });

  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, wide).setValues(rows);
  }
  return rows.length;
}

function rehearsalDropSeeds(ss) {
  var sh = ss.getSheetByName(BOOKINGS_SHEET);
  if (!sh || sh.getLastRow() < 2) return 0;
  var c = colsSoft(sh, BOOKINGS_SHEET);
  if (!c.status) return 0;          /* no Status column: nothing to identify */
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var gone = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(at1(vals[i], c.status) || "").trim().toLowerCase() === "rehearsal") {
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
/* Trip Events, by heading. The tab is the record: read on every poll,
   written by every tap, and the one a coordinator is most likely to add a
   column to, because it is the one he looks at on a Monday. Both forms come
   from the shared machinery near the bottom of this file. */
function tripCols(sh)     { return colsHard(sh, TRIP_SHEET); }
function tripColsSoft(sh) { return colsSoft(sh, TRIP_SHEET); }

function ensureTripColumns(sh) {
  if (structFresh("trip")) return;
  ensureCols(sh, TRIP_HEADERS);
  structDone("trip");
}

function ensureTripEvents(ss) {
  var existing = ss.getSheetByName(TRIP_SHEET);
  var sh = sheet(ss, TRIP_SHEET, TRIP_HEADERS);
  ensureTripColumns(sh);

  /* No dropdowns on this tab. Ever.

     This one is written by phones and read by people; the protection scheme a
     few hundred lines down already says so in as many words — "Nothing here
     is yours to edit". A dropdown therefore protects nobody and can only be
     wrong, because it is a list of the drivers who happened to have rows on
     the tab the day somebody made it. Add a driver to the register, roster
     him, and every row he ever taps is flagged red with "Input must be an
     item on the specified list" — a warning about perfectly good data,
     pointing at a list nothing in this file maintains. */
  if (!structFresh("tripvalid")) {
    pretty("Clearing the Trip Events dropdowns", function () {
      sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2),
                  Math.max(sh.getLastColumn(), TRIP_HEADERS.length))
        .setDataValidation(null);
    });
    structDone("tripvalid");
  }
  if (!existing) {
    /* By heading, like everything else on this tab now. A note stuck to the
       wrong column is a small fault, but it is the same fault as writing a
       value to the wrong column and it would have survived the conversion
       unnoticed. */
    var tc = tripCols(sh);
    sh.getRange(1, tc.reg).setNote(
      "Which bus ran it. Recorded from the driver's own start tap, because " +
      "which bus takes which route is decided on the day and nothing else " +
      "on this spreadsheet knows it.");
    sh.getRange(1, tc.logged).setNote(
      "When the sheet received it. Compare with Happened: a gap means the " +
      "phone had no signal, not that the bus was late.");
    sh.getRange(1, tc.happened).setNote(
      "When the driver's own phone recorded the tap. This is the one the " +
      "times are worked out from. Never overwritten by the server.");
    sh.getRange(1, tc.offset).setNote(
      "Minutes off the timetable at that stop. Positive is behind.");
    sh.getRange(1, tc.status).setNote(
      "Undone means the driver tapped and took it back. The row is kept " +
      "rather than deleted, because the record is the point.");
    sh.setFrozenRows(1);
    sh.setColumnWidth(tc.stop, 260);
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

/* ---- the last time this route's rows changed ---------------------------

   Dropping the cache on a write was not enough, and the first two-route
   Sunday is where that showed.

   A tap arrives as a POST and a phone polls the board every thirty seconds,
   so the two overlap constantly. If a poll starts reading the tab a moment
   BEFORE the tap is committed, it builds a state without the tap — and then
   writes that state into the cache, which may well be after the POST has just
   cleared it. The cache is poisoned for another ten seconds by a reader
   rather than a writer, and every phone asking in that window is told the
   stop was never marked.

   So writes leave a mark. A build knows when it started; a cached state
   carries the same stamp; and anything built before the last write is neither
   served nor stored. */
function tripStampKey(key, route) {
  return "tripw_" + key + "_" + route + (rehearsalOn() ? "_r" : "");
}

function stampTripWrite(key, route) {
  try { CacheService.getScriptCache().put(tripStampKey(key, route), String(Date.now()), 900); }
  catch (err) { /* the drop above still did most of the job */ }
}

function tripWriteStamp(key, route) {
  try { return Number(CacheService.getScriptCache().get(tripStampKey(key, route))) || 0; }
  catch (err) { return 0; }
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

  /* Taken before a single row is read, so it is honestly the age of what is
     about to be built. */
  var builtAt = Date.now();
  var stamp   = tripWriteStamp(key, route);

  var hit = null;
  try { hit = cache.get(tripCacheKey(key, route)); } catch (err) { hit = null; }
  if (hit) {
    try {
      var was = JSON.parse(hit);
      /* Older than the last write to this route: it cannot know about that
         write, so it is not an answer. Fall through and rebuild. */
      if (Number(was.builtAt || 0) >= stamp) return was;
    } catch (err) { /* rebuild */ }
  }

  var state = { trip: "", driver: "", reg: "", started: 0, ended: 0,
                lastAt: 0, lastStop: "", offset: null, served: {},
                builtAt: builtAt };

  var sh = ss.getSheetByName(TRIP_SHEET);
  if (sh && sh.getLastRow() > 1) {
    /* By heading, and the whole width of the tab rather than the first
       seventeen columns. A coordinator's own column sitting in the middle is
       now read past instead of read as ours.

       Soft, because this reads the tab directly rather than through
       ensureTripEvents: on a sheet that predates a heading, a refusal here
       would take down the passenger page and the driver's screen at once. No
       map means every cell reads blank, which is what a sheet with no such
       column actually knows. */
    var c = tripColsSoft(sh);
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    vals.forEach(function (r) {
      if (anyToKey(at1(r, c.sunday)) !== key) return;
      if (String(at1(r, c.route) || "").trim() !== route) return;
      var status = String(at1(r, c.status) || "").trim().toLowerCase();
      if (status === "undone") return;
      /* Both ways round: a real run never counts rehearsal rows, and a
         rehearsal never counts real ones. */
      if ((status === "rehearsal") !== rehearsing) return;

      var ev  = String(at1(r, c.event) || "").trim().toLowerCase();
      var hap = at1(r, c.happened);
      var at  = hap instanceof Date ? hap.getTime() : 0;
      if (!at) return;

      state.trip   = String(at1(r, c.trip) || "").trim() || state.trip;
      state.driver = String(at1(r, c.driver) || "").trim() || state.driver;
      state.reg    = String(at1(r, c.reg) || "").trim() || state.reg;

      if (ev === "start") {
        state.started = at;
        /* A departure row gives the run an offset before a single stop has
           been marked, so the first stop can be projected instead of the page
           saying only that the bus is on its way. Guarded on the offset cell
           actually holding a number: a route with no Depart row writes a
           blank there, and blank must not read as "exactly on time". */
        var doff = at1(r, c.offset);
        if (doff !== "" && doff !== null && doff !== undefined &&
            !isNaN(Number(doff)) && at >= state.lastAt) {
          state.lastAt = at;
          state.offset = Number(doff);
          /* lastStop is deliberately NOT set. It means "the last stop the bus
             was seen at", and leaving church is not that — nobody was waiting
             there and nobody was collected. Setting it would have the page
             announce the bus had been to a stop it never called at, and would
             put a countdown on the screen built from nothing but a departure
             time. The offset is the useful part and it is taken; where the bus
             has got to is still unknown until a real stop is marked. */
        }
        return;
      }
      if (ev === "end")   { state.ended   = at; return; }

      var id = String(at1(r, c.stopId) || "").trim();
      if (id) state.served[id] = { at: at, event: ev };

      /* The freshest stop event is what the offset comes from. Not an
         average: traffic is local, and smoothing would lag at exactly the
         moment it matters. */
      if (at >= state.lastAt) {
        state.lastAt   = at;
        state.lastStop = String(at1(r, c.stop) || "").trim();
        var off = Number(at1(r, c.offset));
        state.offset = isNaN(off) ? null : off;
      }
    });
  }

  /* Asked again, because a write may have landed while this was reading. If
     one did, this state is already out of date and must not be left behind
     for the next fifteen people to be handed. Returned to the caller who
     asked for it — they will poll again in thirty seconds — but not stored. */
  if (tripWriteStamp(key, route) <= builtAt) {
    try { cache.put(tripCacheKey(key, route), JSON.stringify(state), 10); }
    catch (err) { /* it just gets built again */ }
  }
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

  /* It set off and has not been heard from since.

     Tested on lastStop, NOT on lastAt. The departure stamps lastAt with the
     time the bus pulled out — that is how the run gets an honest offset
     before any stop is marked, and it is what lets the page say "on its way,
     three minutes behind". So lastAt is never empty on a run that has
     started, and a test on it would never fire.

     What is empty is lastStop: no kerb has been marked. That is the truth of
     a run that has just pulled out, and the page rightly answers it with "On
     its way" — the bus HAS set off, and that is the fact somebody standing
     at a stop is waiting for.

     It stops being the truth after a while. Without this, a run where the
     driver never tapped anything said "On its way, left church at 10:05" at
     half past twelve, with the bus back at church and the service half over:
     one fact from an hour ago, worn as though it were current. It needed no
     fault to produce — a Sunday where nobody booked left the driver with no
     stops the app thought were worth tapping.

     The quiet test below cannot catch it either. It measures staleness from
     lastAt, which the departure keeps fresh-looking for exactly as long as
     the run lasts. */
  if (!state.lastStop &&
      (Date.now() - state.started) / 60000 > TRIP_QUIET_MINUTES) {
    return { ok: false, why: "silent" };
  }

  if (!state.lastAt)       return { ok: false, why: "noevents" };
  if (state.offset === null) return { ok: false, why: "noevents" };

  var quiet = (Date.now() - state.lastAt) / 60000;
  if (quiet > TRIP_QUIET_MINUTES) return { ok: false, why: "quiet" };
  if (state.offset >  TRIP_MAX_OFFSET) return { ok: false, why: "wild" };
  if (state.offset < -TRIP_MAX_EARLY)  return { ok: false, why: "wild" };
  return { ok: true };
}

/**
 * What one passenger's phone is told.
 *
 * The gate: tracking is visible only to a device with a booking for this
 * Sunday, and only once bookings have closed. Both halves are one lookup the
 * endpoint has to do anyway to know which stop to give a time for.
 */
function tripPayload(ref, want, askedStop, pid) {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var key = runSunday();

  if (!trackingOpen(key)) {
    return { ok: true, live: false, why: "open", date: key, cutoff: cutoffWords() };
  }

  ref = String(ref || "").trim();
  pid = String(pid || "").trim();
  var rows = readBookings(ss, key);
  /* Same rule as everywhere else: the number finds it, and the old browser
     handle is the fallback for a booking made before numbers existed. This
     is what lets a man who booked on his laptop watch the bus from his
     phone, which is the whole reason any of this changed. */
  var mine = bookingFor(rows, pid, ref);
  if (mine && !mine.stopId) mine = null;

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

  /* No booking on this phone, but the passenger has said which kerb they are
     standing at. Watch that stop.

     The handle was doing two jobs: finding your booking again, and proving you
     were allowed to look. Only the first needs an identity. A man who booked on
     his laptop and walked out with his phone had neither, and was told there
     was nothing to see — which is what he reported. So were the phone whose
     browser cleared its storage, the one that reinstalled, and the person who
     never booked but is deciding whether to walk down to the stop in the rain.

     Nothing is revealed by this. Everything below is a fact about the STOP —
     when the bus is due there, how far off it is running, whether it has been.
     Three households booked at one kerb already receive one identical answer,
     because the driver taps the stop and never the people.

     WHAT THIS MUST NOT DO is hand out the driver's number. That lives in
     busPayload and stays behind a real booking for that route. Tracking is
     untied from the booking here; the phone number is not. */
  var watching = false;
  if (!mine) {
    var wantStop = String(askedStop || "").trim();
    if (wantStop && stopById[wantStop] && !stopById[wantStop].arrival) {
      mine = { stopId: wantStop, seats: 0, device: "" };
      watching = true;
    }
  }

  if (!mine) return { ok: true, live: false, why: "nobooking", date: key };

  var myStop = stopById[mine.stopId] || null;
  if (!myStop) return { ok: true, live: false, why: "nobooking", date: key };

  var state = tripState(ss, key, myStop.route);
  var out = {
    ok: true, live: true, date: key, now: Date.now(), route: myStop.route,
    /* So the page knows this is a stop somebody chose rather than one they
       booked, and can say so rather than implying a seat is held. */
    watching: watching,
    rehearsal: !!rehearsalOn(),
    /* Only during a rehearsal, and only so the tester can switch to the bus
       he is actually driving. A real passenger watches their own stop and is
       never offered somebody else's route. */
    routes: rehearsalOn() ? routeNames(stops) : [],
    stop: myStop.stop, stopId: myStop.id, scheduled: myStop.time,
    started: !!state.started, ended: !!state.ended,
    /* When it set off. The page had the flag and not the time, so the most
       it could say to somebody waiting at ten past was that nothing had
       happened yet. */
    startedAtWords: state.started
      ? Utilities.formatDate(new Date(state.started), Session.getScriptTimeZone(), "HH:mm")
      : "",
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
    /* Both were collapsed into "served" and the page rendered both as "Picked
       up at 11:14". So a family who booked at a shared stop and was thirty
       seconds up the road was told they were on a bus they were not on. The
       driver taps the stop, never the people: after "Nobody there" nobody at
       that kerb was collected, and after "Picked up" he collected whoever he
       saw. Those are different facts and the page can only say so if it is
       told which one happened. */
    out.servedEvent = String(state.served[myStop.id].event || "").toLowerCase();
    return out;
  }

  /* The bus has gone by without this stop being marked.

     A passenger watching a stop NOBODY booked will never see it marked, and
     that is correct: the driver does not stop where there is no one, so he
     has nothing to tap. But until now the page went on projecting an arrival
     for a bus that was already two stops up the road, and then fell quiet.
     Somebody could stand at that kerb waiting for a bus that had passed them
     twenty minutes before.

     It answers for a booked passenger too, and for the same reason. Marked
     "Nobody there" is already handled above and says so plainly; a stop the
     driver never touched at all had nothing to say for itself until now.

     The proof is a LATER stop being marked, and nothing else is proof. A bus
     merely running late has marked nothing beyond this stop. A bus that has
     been past has. Order is the order of the tab, which is the same order the
     driver taps his way down.

     Deliberately AFTER the served test above: if the driver taps this stop
     late — out of order, after a diversion — the next poll finds it served
     and this screen corrects itself. */
  var mineOrder = stops.filter(function (s) { return s.route === myStop.route; });
  var mineAt = -1;
  for (var mi = 0; mi < mineOrder.length; mi++) {
    if (mineOrder[mi].id === myStop.id) { mineAt = mi; break; }
  }
  if (mineAt >= 0) {
    for (var pi = mineAt + 1; pi < mineOrder.length; pi++) {
      var beyond = state.served[mineOrder[pi].id];
      if (!beyond) continue;
      out.mine = "passed";
      out.passedStop = mineOrder[pi].stop;
      out.passedAtWords = Utilities.formatDate(new Date(beyond.at),
                                               Session.getScriptTimeZone(), "HH:mm");
      return out;
    }
  }

  var can = tripProjectable(state);
  if (!can.ok) { out.mine = can.why; return out; }

  var sched = stopMomentOn(key, myStop.time);
  if (!sched) { out.mine = "noevents"; return out; }

  var eta  = new Date(sched.getTime() + state.offset * 60000);
  var mins = Math.round((eta.getTime() - Date.now()) / 60000);

  /* An arrival time that has already gone past is not an estimate.

     The offset test above catches the impossible ones; this catches the
     merely stale — a stop timetabled 09:50, a bus running three minutes
     behind, and somebody opening the page at ten past. The arithmetic gives
     09:53 and the page would announce it as though the bus were still to
     come. Somebody standing at that kerb reads it as a promise.

     Two minutes of grace, because a bus pulling in as the page loads is
     genuinely "due now" and saying so is right. Beyond that the page falls
     back to the last thing actually known, which is where it belongs. */
  if (mins < -2) { out.mine = "quiet"; return out; }

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
    offset: state.offset, served: state.served,
    /* When this route is timetabled to leave church, so the phone can work
       out how long a leg is meant to take and refuse a stop the bus cannot
       have reached yet. The Depart row is filtered out of the stop list the
       driver's app receives — it is a timing point, not a place — so the time
       has to travel separately or the phone cannot see it at all. */
    departWords: (function () {
      var d = departStopFor(ss, String(route || "").trim() || "North");
      return d ? d.time : "";
    })()
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
  /* Hard here, not soft. This is the write path: it has just been through
     ensureTripEvents, so every heading exists, and if one somehow does not
     then refusing the write is right. Writing a tap into the wrong column is
     worse than not writing it — the phone keeps the tap queued and sends it
     again once the sheet is put right. */
  var c   = tripCols(sh);
  var wide = Math.max(sh.getLastColumn(), TRIP_HEADERS.length);

  var seen = {}, undone = {};
  if (sh.getLastRow() > 1) {
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    vals.forEach(function (r, i) {
      if (String(at1(r, c.trip) || "").trim() !== trip) return;
      if (!reg) reg = String(at1(r, c.reg) || "").trim();
      var k = String(at1(r, c.event) || "").trim().toLowerCase() + "|" +
              String(at1(r, c.stopId) || "").trim();
      if (String(at1(r, c.status) || "").trim().toLowerCase() === "undone") {
        undone[k] = true; return;
      }
      seen[k] = i + 2;
    });
  }

  var stops = {}, order = readBusStops(ss);
  order.forEach(function (s) { stops[s.id] = s; });
  /* The departure, if this route has one. A start event carries no stop, so
     it used to be written with no scheduled time and no offset beside it —
     which is why the first stop of every run had nothing to project from. */
  var depart = departStopFor(ss, route);

  var rows = [], pending = {}, undoneNow = 0;
  events.forEach(function (ev) {
    var kind   = String(ev.event || "").trim().toLowerCase();
    var stopId = String(ev.stopId || "").trim();
    var at     = Number(ev.at) || 0;
    var k      = kind + "|" + stopId;

    if (!at) return;

    /* An undo names the event it takes back. The row stays and is marked,
       because a driver who taps and untaps four times should leave a trace. */
    if (kind === "undo") {
      var target = String(ev.undoes || "").trim().toLowerCase() + "|" + stopId;
      if (typeof seen[target] === "number") {
        sh.getRange(seen[target], c.status).setValue("Undone");
        delete seen[target];
        undoneNow++;
      } else if (pending[target] !== undefined) {
        rows[pending[target]][c.status - 1] = "Undone";
        delete pending[target];
        delete seen[target];
        undoneNow++;
      }
      return;
    }

    if (seen[k]) return;                       /* already down: a retry */

    var stop  = stops[stopId] || null;
    /* Leaving church is a timing point like any other. Filled in here rather
       than asked of the phone, so a handset running an older build still
       lands a proper departure row, and so the times come from the tab the
       coordinator edits rather than from anything a phone was told. */
    if (!stop && kind === "start" && depart) {
      stop   = depart;
      stopId = depart.id;
    }
    var sched = stop ? stopMomentOn(key, stop.time) : null;
    var off   = sched ? Math.round((at - sched.getTime()) / 60000) : "";

    /* A run started with no check on record is marked here rather than refused
       there. Status carries it, and the value still fails every filter that
       matters: it is not Undone and it is not Rehearsal. */
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
    /* Only the start row carries a bus assignment and a position. Every
       other row would be repeating the first or tracking the bus, and
       neither is wanted. */
    var wantBus = "", where = "", acc = "", away = "";
    if (kind === "start") {
      try { wantBus = busFor(ss, key, route).reg || ""; } catch (errB) { wantBus = ""; }
      var g = ev.geo || null;
      if (g && typeof g.lat === "number" && typeof g.lng === "number") {
        where = g.lat.toFixed(6) + ", " + g.lng.toFixed(6);
        acc   = (typeof g.acc === "number") ? g.acc : "";
        /* Worked out on the phone, where the base coordinates actually live.
           config.js holds them and this file does not; computing it here
           would mean a second copy of the yard's position that somebody has
           to keep in step with the first. */
        away  = (typeof g.away === "number") ? g.away : "";
      } else if (g && g.why) {
        /* Why there is no fix, in the cell where the fix would have been.
           A blank cell and a refused one are different facts. */
        where = String(g.why);
      }
    }

    /* Built as wide as the tab actually is, then each value placed at its own
       column. A row is no longer a list in TRIP_HEADERS order: a coordinator's
       own column in the middle keeps its place and is left empty by us rather
       than being written over.

       Every cell starts as "" rather than undefined, because setValues on an
       undefined clears formatting as well as content on some rows and not
       others, and a tab that looks different row to row invites somebody to
       "tidy" it. */
    var row = [];
    for (var w = 0; w < wide; w++) row.push("");
    var put = function (col, v) { if (col) row[col - 1] = v; };

    put(c.logged,    new Date());
    put(c.trip,      safeText(trip));
    put(c.sunday,    key);
    put(c.route,     safeText(route));
    put(c.driver,    safeText(who));
    put(c.event,     safeText(kind));
    put(c.stopId,    safeText(stopId));
    put(c.stop,      stop ? stop.stop : "");
    put(c.scheduled, sched || "");
    put(c.happened,  new Date(at));
    put(c.offset,    off);
    put(c.status,    status);
    put(c.reg,       safeText(reg));
    put(c.rotaBus,   safeText(wantBus));
    put(c.where,     safeText(where));
    put(c.acc,       acc);
    put(c.away,      away);

    pending[k] = rows.push(row) - 1;
    seen[k] = true;
  });

  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, wide).setValues(rows);
  }
  if (rows.length || undoneNow) {
    /* Committed first, then marked, then dropped. In that order, or a reader
       that starts between the mark and the commit would see the old tab and
       still believe itself current. */
    SpreadsheetApp.flush();
    stampTripWrite(key, route);
    dropTripCache(key, route);
  }

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

  /* The report needs these four to mean anything at all. Missing any of them
     is a tab this file has never migrated, and a report built from blanks
     would read as "nobody tapped anything", which is a lie. */
  var c = tripColsSoft(sh);
  var needs = ["sunday", "route", "event", "happened"].filter(function (k) { return !c[k]; });
  if (needs.length) {
    ui.alert("Trip Events is missing its " + needs.join(", ") + " column" +
             (needs.length > 1 ? "s" : "") +
             ", so this report cannot be built. " +
             "Run Minibus > Rota > Set up / refresh rota.");
    return;
  }
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var runs = {};

  vals.forEach(function (r) {
    var status = String(at1(r, c.status) || "").trim().toLowerCase();
    if (status === "undone" || status === "rehearsal") return;
    var key = anyToKey(at1(r, c.sunday)); if (!key) return;
    var id  = key + "|" + String(at1(r, c.route) || "").trim();
    if (!runs[id]) {
      runs[id] = { key: key, route: String(at1(r, c.route) || "").trim(),
                   driver: String(at1(r, c.driver) || "").trim(),
                   taps: 0, started: 0, ended: 0 };
    }
    var ev = String(at1(r, c.event) || "").trim().toLowerCase();
    var hap = at1(r, c.happened);
    var at = hap instanceof Date ? hap.getTime() : 0;
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
    var nm = String(at1(r, c.driver) || "").trim();
    if (nm) runs[id].driver = nm;
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

  /* Which bus the rota names for each route today, how many seats it has and
     how many are booked against it — and every bus with its seats, so the
     phone can also price the one the rota did NOT name.

     On the board rather than the rota payload because the board is what the
     stops screen polls, and the rota payload is the heavy one. Guarded like
     everything else here: a spreadsheet without a Buses tab yet must still
     give a driver his screen. */
  try {
    var k0 = dateToKey(sundayOf(new Date())), ss0 = SpreadsheetApp.getActiveSpreadsheet();
    var seats = {};
    routeNames(readBusStops(ss0)).forEach(function (rt) { seats[rt] = seatsFor(ss0, k0, rt); });
    out.seats = seats;
    out.buses = readBuses(ss0).map(function (b) { return { reg: b.reg, seats: b.seats }; });
  } catch (err) { out.seatsError = String(err); }

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
    var c = colsSoft(sh, CHECKS_SHEET);
    var lastRow  = sh.getLastRow();
    var firstRow = Math.max(2, lastRow - MILEAGE_SCAN_ROWS + 1);
    var rows = sh.getRange(firstRow, 1, lastRow - firstRow + 1, sh.getLastColumn()).getValues();

    rows.forEach(function (r) {
      var reg = String(at1(r, c.reg) || "").trim();
      if (!reg) return;
      /* See checkMoment: Received when it is present and not in the future,
         and the row's own Date and Time otherwise. */
      var when = checkMoment(at1(r, c.received), at1(r, c.date), at1(r, c.time));
      if (!when || when < from || when >= to) return;
      if (out[reg] && out[reg].at >= when) return;
      out[reg] = {
        state: String(at1(r, c.outcome) || "").trim().toUpperCase() === "STOPPED"
          ? "stopped" : "ok",
        at: when,
        driver: String(at1(r, c.driver) || "").trim()
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
/* The Sunday being DRIVEN. Today if today is Sunday, otherwise the next one.

   It is wrong for everything else. The run, the counts, the taps and the
   passenger's live view are all about the bus that is out NOW. Keying those to
   busCurrentSunday meant that at 09:30 on a Sunday, at the exact minute the
   run begins, the whole of the tracking jumped a week: the driver's board
   showed no run in progress, every passenger was told bookings were still open
   and shown nothing, and any tap he made was filed against the following
   Sunday. The rehearsal never caught it because a rehearsal forces that gate
   open and hides the roll.

   The client has always used this definition. It was only the server that
   disagreed. */
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

  /* Every route with somebody booked on it must have started AND ended.
     Anything short of that waits for the backstop.

     This used to count only the runs that BEGAN, and then ask whether they had
     all finished. A route whose driver never tapped Start therefore counted
     for nothing at all, so on 16 August — North did its checks and never
     started; South ran properly and tapped End at church — South's last tap
     rolled the whole page. North's passengers, some of them still at a kerb,
     were shown next Sunday's booking form under the words "Today's buses are
     back", lost the stop list the driver was working from, and could no longer
     say they were not coming. One route's driver decided the other route's
     morning was over.

     A route nobody booked is left out on purpose: there is no one waiting on
     it, nothing to watch, and no reason for it to hold up next week. */
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var counts = bookingCounts(ss, key);
  var routes = [];
  readBusStops(ss).forEach(function (st) {
    if (st.arrival) return;
    if (!(Number(counts[st.id]) > 0)) return;
    if (routes.indexOf(st.route) < 0) routes.push(st.route);
  });
  if (!routes.length) return true;

  for (var i = 0; i < routes.length; i++) {
    var t = tripState(ss, key, routes[i]);
    if (!t.started || !t.ended) return false;
  }
  return true;
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

  /* The Phone column first, and out at once if it is empty. */
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

function busPayload(key, ref, pid) {
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
  /* The number first, the old browser handle second. See bookingFor. */
  var mine = bookingFor(readBookings(ss, key), pid, ref);

  /* A seat at a stop that is no longer on the timetable.

     It can only happen when a stop is withdrawn or renumbered after somebody
     has booked, which is a thing that will happen every time the routes are
     reworked. Left alone it is the worst kind of quiet failure: the page says
     "Booked", no stop is ticked because none matches, the driver's list never
     shows the seat because it hangs off an id that no longer exists, and the
     passenger stands at a kerb no bus is coming to.

     So it is not returned as a booking. The row stays on the sheet — it is a
     record and somebody may want to ring them — but this phone is told
     plainly that its stop has gone, and is put back to an empty screen where
     it can book again. */
  var stopGone = "";
  if (mine && mine.stopId) {
    var stillThere = false;
    readBusStops(ss).forEach(function (s) { if (s.id === mine.stopId) stillThere = true; });
    if (!stillThere) { stopGone = mine.stopId; mine = null; }
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
    /* So the page can say "booked as 07377 634214" rather than leaving
       somebody guessing which number is holding their seat. It is the
       passenger's own number going back to the passenger's own phone, and it
       goes nowhere without the fingerprint that only they have. */
    phone: mine && mine.phone ? mine.phone : "",
    mine: mine ? { stopId: mine.stopId, seats: mine.seats } : null,
    /* Set only when a booking was dropped because its stop has gone. */
    stopGone: stopGone,
    /* One entry per route: which bus, how many seats, how many booked. The
       page decides when that is worth saying out loud — mostly it is not. */
    seats: (function () {
      var out = {};
      routeNames(readBusStops(ss)).forEach(function (rt) {
        out[rt] = seatsFor(ss, key, rt);
      });
      return out;
    })()
  };
}

/* One booking per PERSON per Sunday, a person being a phone number. Sending
   again replaces it, so changing your mind, moving kerb and cancelling are
   all the same action rather than a second row. */
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

  /* Who this is. The number is authoritative when it is sent, because the
     fingerprint is worked out from it here rather than trusted from the
     page; the fingerprint on its own is accepted for the polls and saves
     that follow, where the number has no business being sent again. */
  var phone = normalisePhone(b.phone);
  var pid = phone ? passengerId(phone)
                  : String(b.pid || "").replace(/[^a-f0-9]/g, "").substring(0, 24);

  if (!ref && !pid) return reply({ ok: false, error: "no device handle" });

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
  var existing = bookingFor(readBookings(ss, key), pid, ref);

  /* Changing or cancelling one that already exists is allowed on the handle
     alone, so a page cached before this existed can still take a seat OFF
     the driver's list. Refusing that would be refusing the one message that
     is always worth hearing. */
  if (seats > 0 && !existing && !pid) {
    /* Flagged, not just worded. A page that asks for a number can never send
       one without it, so what actually lands here is a phone still holding a
       copy from before numbers existed \u2014 out of a cache, off a home screen
       tile, out of a tab that has been open since last Sunday. A newer page
       reads the flag and asks; an older one has no idea what the flag means
       and shows the sentence, which is the one instruction that fixes it. */
    return reply({ ok: false, needPhone: true,
                   error: "This page is out of date. Reload it and book again." });
  }

  /* Nothing booked, or cancelling. Both end the same way: no live row. */
  if (!seats) {
    if (existing) {
      sh.getRange(existing.row, colsHard(sh, BOOKINGS_SHEET).status).setValue("Cancelled");
      /* Exactly "Cancelled", never a status of its own. readBookings drops
         that one word and counts EVERYTHING ELSE as booked, so a tidy-looking
         "Cancelled late" would leave the seat sitting on the driver's screen:
         the precise opposite of what the passenger just asked for. The
         lateness goes in a note instead, which no code reads and anybody
         opening the tab can see. */
      if (late) {
        try {
          sh.getRange(existing.row, colsHard(sh, BOOKINGS_SHEET).status).setNote(
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

  var bc = colsHard(sh, BOOKINGS_SHEET);
  if (existing) {
    /* One cell at a time now, by heading. It used to be a four-wide block
       from column 3, which assumed Route, Stop ID, Stop and Seats sat in that
       order with nothing between them — true until somebody inserts a
       column, and then it writes a stop name into whatever is there. */
    sh.getRange(existing.row, bc.route).setValue(stop.route);
    sh.getRange(existing.row, bc.stopId).setValue(stop.id);
    sh.getRange(existing.row, bc.stop).setValue(stop.stop);
    sh.getRange(existing.row, bc.seats).setValue(seats);
    sh.getRange(existing.row, bc.status).setValue("Booked");
    sh.getRange(existing.row, bc.received).setValue(new Date());
    /* Which device last touched it. Useful when somebody rings to say their
       booking has gone odd, and harmless otherwise. */
    if (ref) sh.getRange(existing.row, bc.device).setValue(ref);
    /* A booking made before numbers existed, being changed by somebody who
       has now given one. Put the owner on the row so the next device to ask
       finds it by the number rather than by the handle. */
    if (pid && !existing.pid) {
      sh.getRange(existing.row, bc.phone).setValue(phone ? "'" + phone : "");
      sh.getRange(existing.row, bc.passenger).setValue(pid);
    }
  } else {
    var wide = Math.max(sh.getLastColumn(), BOOKINGS_HEADERS.length);
    sh.getRange(sh.getLastRow() + 1, 1, 1, wide).setValues([bookingRow(bc, wide, {
      received: new Date(), sunday: key, route: stop.route, stopId: stop.id,
      stop: stop.stop, seats: seats, device: ref, status: "Booked",
      phone: phone ? "'" + phone : "", passenger: pid
    })]);
  }

  /* The driver's screen is polling this. Clear it now rather than leaving a
     booking invisible until the cache lapses. */
  dropCountsCache(key);

  /* The counts go back with the answer. */
  return reply({ ok: true, stopId: stop.id, seats: seats,
                 mine: { stopId: stop.id, seats: seats },
                 counts: bookingCounts(ss, key) });
}

/* ---- saying who you are -------------------------------------------------

   The passenger gives their number once, on whichever device they happen to
   have in their hand, and this answers with everything the booking page
   loads plus the fingerprint to use from then on.

   The answer is deliberately the SAME SHAPE as ?bus=1. The page has one
   function that takes that payload and paints from it, and this being the
   same thing means identifying on a second device and loading the page for
   the first time run through exactly one piece of code. There is no second
   path to keep in step, and no way for the two to drift.

   What it does NOT do is create anything. Giving a number books no seat and
   holds no place; it only says which row, if any, is already yours. The
   booking is still the Confirm button, as it always was.
   ------------------------------------------------------------------------ */
function handleIdentify(body) {
  var phone = normalisePhone(body && body.phone);
  if (!phone) return reply({ ok: false, error: "Eleven digits, starting with 0." });

  var ref = String((body && body.ref) || "").replace(/[^A-Za-z0-9]/g, "").substring(0, 32);

  if (ref) {
    var cache = CacheService.getScriptCache();
    var tryKey = "idtry_" + ref;
    var tries = 0;
    try { tries = Number(cache.get(tryKey)) || 0; } catch (err) { tries = 0; }
    if (tries >= IDENTIFY_MAX_TRIES) {
      return reply({ ok: false,
        error: "Too many tries. Wait " + IDENTIFY_WINDOW_MINUTES + " minutes." });
    }
    try { cache.put(tryKey, String(tries + 1), IDENTIFY_WINDOW_MINUTES * 60); }
    catch (err) { /* a missing count is not worth turning somebody away for */ }
  }

  var pid = passengerId(phone);
  var key = busCurrentSunday();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  /* Adopting a booking made before this person had given a number.

     Under the lock because it writes, and written before the payload is
     built so the payload finds it by the number like any other. Failing to
     take the lock is not fatal: the read below still works and the row is
     adopted the next time something writes, which is the first Confirm. */
  var lock = LockService.getScriptLock();
  var locked = false;
  try { lock.waitLock(10000); locked = true; } catch (err) { locked = false; }
  try {
    var rows = readBookings(ss, key);
    var owned = null, orphan = null;
    rows.forEach(function (b) {
      if (b.pid && b.pid === pid) owned = b;
      if (!orphan && !b.pid && ref && b.device === ref) orphan = b;
    });
    if (locked && !owned && orphan) {
      var sh = ensureBookings(ss);
      sh.getRange(orphan.row, 9, 1, 2).setValues([["'" + phone, pid]]);
    }
  } catch (err) {
    /* Nothing here is worth failing the call for. The worst case is that the
       old row is found by the handle for one more round trip. */
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (err) {} }
  }

  var out = busPayload(key, ref, pid);
  out.pid = pid;
  out.phone = phone;
  return reply(out);
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

  /* Route and Phone both arrived after this tab was already in service, so a
     sheet in use may be missing either. They are now added by ensureCols,
     which INSERTS a column beside its neighbour rather than writing a heading
     at a fixed letter — the old version tested whether G and H happened to be
     empty, which is only ever true because nobody had put anything of their
     own there yet. */
  var hadRoute = !!headerMap(sh)["Route"];
  var hadPhone = !!headerMap(sh)["Phone"];
  ensureCols(sh, DRIVERS_HEADERS);
  var dc = colsHard(sh, DRIVERS_SHEET);

  if (existing) {
    if (!hadRoute) {
      backfillRoutes(sh);
      sh.getRange(1, dc.route).setNote(
        "North or South. Blank counts as North, so rows written before the\n" +
        "South route started keep working without being edited.");
      pretty("Drivers Route dropdown", function () {
        sh.getRange(2, dc.route, 199, 1).setDataValidation(listRule(["North", "South"])); });
    }
    if (!hadPhone) {
      sh.getRange(1, dc.phone).setNote(
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
      sh.appendRow(driverRow(dc, Math.max(sh.getLastColumn(), DRIVERS_HEADERS.length), d));
    });
    pretty("Drivers Route dropdown", function () {
      sh.getRange(2, dc.route, 199, 1).setDataValidation(listRule(["North", "South"])); });
    sh.setColumnWidth(dc.name, 150);
    sh.setColumnWidth(dc.role, 160);
    pretty("Drivers Active dropdown", function () {
      sh.getRange(2, dc.active, 199, 1).setDataValidation(listRule(["YES", "NO"])); });
    sh.getRange(1, dc.order).setNote(
      "Number the repeating pattern here: 1, 2, 3, 4...\n" +
      "Each route is numbered separately, so both start at 1.\n" +
      "Leave blank for anyone who is not in the normal rotation.\n" +
      "Anyone marked Active can still be picked to cover a Sunday.");
    sh.getRange(1, dc.active).setNote(
      "NO removes someone from the app and from every dropdown.\n" +
      "Sundays they have already driven are left alone.");
  }
  return sh;
}

/* One Drivers row, as wide as the tab is, each value at its own column. */
function driverRow(c, wide, d) {
  var row = [];
  for (var i = 0; i < wide; i++) row.push("");
  var put = function (col, v) { if (col) row[col - 1] = v; };
  put(c.name,   d.name);
  put(c.role,   d.role);
  put(c.active, "YES");
  put(c.order,  d.order);
  put(c.route,  d.route);
  return row;
}

function ensureRota(ss) {
  var existing = ss.getSheetByName(ROTA_SHEET);
  var sh = sheet(ss, ROTA_SHEET, ROTA_HEADERS);

  /* sheet() only writes headings when it creates the tab, so a tab that
     already exists keeps whatever it was first given. Written again here so
     a rename actually reaches a sheet already in use. Safe to repeat: it is
     one write of one row, and nothing reads this tab by heading. */
  /* Insert any missing columns FIRST. Writing the wider heading row over a
     narrower tab would relabel columns without moving the values under them:
     "North bus" would appear over the Status column and every status in the
     sheet would read as a bus. Inserting moves the data across with its own
     heading, which is the whole reason it is done this way round. */
  ensureRotaBusColumns(sh);

  /* Now safe: the tab is at least as wide as the headings. */
  if (sh.getLastColumn() >= ROTA_HEADERS.length) {
    sh.getRange(1, 1, 1, ROTA_HEADERS.length).setValues([ROTA_HEADERS]).setFontWeight("bold");
  }

  if (!existing) {
    /* Widths and notes hung off column numbers, which is the same brittleness
       as everything else on this tab. By name, so a column added later moves
       them rather than leaving a note on the wrong heading. */
    var rc0 = rotaCols(sh);
    var wide = {};
    wide[rc0.date] = 110;       wide[rc0.north] = 150;
    wide[rc0.northCover] = 160; wide[rc0.northBus] = 120;
    wide[rc0.status] = 145;     wide[rc0.south] = 150;
    wide[rc0.southCover] = 160; wide[rc0.southBus] = 120;
    wide[rc0.notes] = 240;
    Object.keys(wide).forEach(function (c) { sh.setColumnWidth(Number(c), wide[c]); });

    sh.getRange(1, rc0.northCover).setNote(
      "Leave blank when the scheduled driver is driving.\n" +
      "Fill it in only when somebody else is covering. The scheduled name\n" +
      "stays put, so you never lose sight of whose Sunday it was.");
    sh.getRange(1, rc0.south).setNote("South Liverpool route. Leave these two columns blank until you run both routes.");
    var busNote =
      "Leave blank and the monthly rotation decides.\n" +
      "Put a registration here only to overrule it, for this Sunday alone.\n" +
      "The app never writes in this column, so anything here is somebody's decision.";
    sh.getRange(1, rc0.northBus).setNote(busNote);
    sh.getRange(1, rc0.southBus).setNote(busNote);
    rotaColours(sh);
  }

  fillRotaAhead(ss, sh);
  /* After the rows exist, never before: it can only fill a Sunday that is
     already on the tab. */
  try { fillBusesAhead(ss, sh); } catch (err) { /* a sheet with no Buses tab yet */ }
  return sh;
}

/* Writes the rotation's answer into the two bus columns.

   So the rotation fills them. The property that replaces the old one is
   simpler and easier to keep in your head: THIS ONLY EVER WRITES INTO AN
   EMPTY CELL. Anything already there is somebody's decision and is left
   exactly as it is.

   Future Sundays only. A bus written against a Sunday already gone would be
   an assertion about something that happened, and what actually went out is
   recorded in Trip Events, not here. */
function fillBusesAhead(ss, sh, force) {
  sh = sh || ss.getSheetByName(ROTA_SHEET);
  if (!sh || sh.getLastRow() < 2) return 0;
  var c = rotaCols(sh);
  var known = {};
  readBuses(ss).forEach(function (b) { known[b.reg.toUpperCase()] = b.reg; });
  if (!Object.keys(known).length) return 0;

  var from = dateToKey(sundayOf(new Date()));
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var colN = [], colS = [], n = 0;

  vals.forEach(function (r) {
    var nowN = String(r[c.northBus - 1] || "").trim();
    var nowS = String(r[c.southBus - 1] || "").trim();
    var key  = anyToKey(r[c.date - 1]);
    var pair = (key && key >= from) ? busRule(key) : null;
    if (pair) {
      if (force || !nowN) {
        var wantN = known[String(pair.North || "").toUpperCase()] || "";
        if (wantN && wantN !== nowN) { nowN = wantN; n++; }
      }
      if (force || !nowS) {
        var wantS = known[String(pair.South || "").toUpperCase()] || "";
        if (wantS && wantS !== nowS) { nowS = wantS; n++; }
      }
    }
    colN.push([nowN]); colS.push([nowS]);
  });

  if (!n) return 0;
  sh.getRange(2, c.northBus, colN.length, 1).setValues(colN);
  sh.getRange(2, c.southBus, colS.length, 1).setValues(colS);
  return n;
}

/** Keeps the Rota tab filled from this Sunday out to the horizon. */
function fillRotaAhead(ss, sh) {
  sh = sh || ss.getSheetByName(ROTA_SHEET);
  if (!sh) return;

  var c = rotaCols(sh);
  var width = Math.max(sh.getLastColumn(), ROTA_HEADERS.length);
  var pattern = bothPatterns(ss);
  var have = {};
  readRotaRows(ss).forEach(function (r) { have[r.date] = true; });

  var start = sundayOf(new Date());
  var rows = [];
  for (var i = 0; i < ROTA_FILL_WEEKS; i++) {
    var d = addWeeks(start, i);
    var key = dateToKey(d);
    if (have[key]) continue;
    /* Built by NAME, not as a positional list. The old version wrote a
       nine-item array and trusted the order; adding a column anywhere would
       have shifted a driver's name into the status column without a word. */
    var row = new Array(width).fill("");
    row[c.date - 1]   = d;
    row[c.north - 1]  = patternDriver(d, pattern.north);
    row[c.status - 1] = "Confirmed";
    row[c.south - 1]  = southDriver(d, pattern.south);
    /* The bus columns are left EMPTY on purpose. Blank means "the rotation
       decides"; a value means a person overruled it. Filling them in here
       would erase that distinction on the first refresh. */
    rows.push(row);
  }
  if (!rows.length) return;

  var first = sh.getLastRow() + 1;
  sh.getRange(first, 1, rows.length, width).setValues(rows);
  sh.getRange(first, 1, rows.length, 1).setNumberFormat("dd/mm/yyyy");
  if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, width).sort(c.date);
  refreshDropdowns();
}

/* Status colours, down whatever column is headed Status.

   Its own rules are stripped first, matched by the range and by the five
   words it writes. Rules somebody added by hand are left alone. */
function rotaColours(sh) {
  var range = rotaColRange(sh, rotaCols(sh).status);
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
    /* Cover columns list EVERYONE active, both routes and backups included.
       Anybody can cover for anybody: a driver off on holiday should never be
       stuck because the only people offered were on their own route.

       None of these lists is a restriction. Every one of them allows a value
       typed in by hand, so you can always put a name in a scheduled column
       that the pattern does not expect. The list is a convenience, not a
       gate. */
    step("Rota scheduled North list", function () {
      rotaColRange(rota, rotaCols(rota).north)
        .setDataValidation(listRule(north.length ? north : active)); });
    step("Rota scheduled South list", function () {
      rotaColRange(rota, rotaCols(rota).south)
        .setDataValidation(listRule(south.length ? south : active)); });
    step("Rota cover lists", function () {
      var rc = rotaCols(rota);
      rotaColRange(rota, rc.northCover).setDataValidation(listRule(active));
      rotaColRange(rota, rc.southCover).setDataValidation(listRule(active));
      /* The buses. Blank stays valid — it is what "the rotation decides"
         looks like — so the rule allows an empty cell. */
      var regs = readBuses(SpreadsheetApp.getActiveSpreadsheet())
                   .filter(function (b) { return b.active; })
                   .map(function (b) { return b.reg; });
      if (regs.length) {
        rotaColRange(rota, rc.northBus).setDataValidation(listRule(regs));
        rotaColRange(rota, rc.southBus).setDataValidation(listRule(regs));
      } });
    /* Colours BEFORE the dropdown, deliberately.

       The dropdown is what makes column D a typed column, and conditional
       formatting is refused on one of those. Applying the colours while the
       column is still plain is the only order that has a chance of working.
       If it still fails, nothing is lost: a modern dropdown draws its own
       coloured chips, so the status stays perfectly readable. */
    step("Rota status colours", function () { rotaColours(rota); });
    step("Rota status list", function () {
      rotaColRange(rota, rotaCols(rota).status).setDataValidation(listRule(ROTA_STATUS)); });
  }

  var reqs = ss.getSheetByName(REQUESTS_SHEET);
  if (reqs) {
    step("Requests lists", function () {
      var qc = requestCols(reqs);
      reqs.getRange(2, qc.status, 1999, 1).setDataValidation(listRule(REQ_STATUS));
      reqs.getRange(2, qc.replacement, 1999, 1).setDataValidation(listRule(active)); });
    step("Requests column widths", function () {
      var qc2 = requestCols(reqs);
      reqs.setColumnWidth(qc2.reason, 300);
      reqs.setColumnWidth(qc2.status, 120);
      reqs.setColumnWidth(qc2.replacement, 180); });
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

/* ---- helpers that are safe to press Run on ------------------------------

   The Apps Script editor lists every function in this file in one dropdown,
   with nothing to say which of them expect arguments. Press Run on one that
   does and it is handed nothing, so the first thing it touches is undefined
   and you get "Cannot read properties of undefined (reading 'getRange')" —
   a message about a missing sheet, from a function whose whole job is to
   decorate one particular sheet it could perfectly well have found itself.

   So they find it themselves. Called normally, from the code that already has
   the sheet in its hand, nothing changes. Called from the editor with nothing
   at all, each one now does the sensible whole-column version of its job
   rather than throwing. */
function tabOr(sh, name) {
  if (sh) return sh;
  var found = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!found) throw new Error("No tab named " + name + " on this spreadsheet.");
  return found;
}

function applyRotaValidation(sh, row) {
  sh = tabOr(sh, ROTA_SHEET);
  var drivers = readDrivers(SpreadsheetApp.getActiveSpreadsheet());
  var active = drivers.filter(function (d) { return d.active; }).map(function (d) { return d.name; });
  if (!active.length) active = SEED_DRIVERS.map(function (d) { return d.name; });
  pretty("Rota row dropdowns", function () {
    /* No row means every row: the same thing refreshDropdowns does. */
    var c = rotaCols(sh);
    (row ? sh.getRange(row, c.northCover) : rotaColRange(sh, c.northCover))
      .setDataValidation(listRule(active));
    (row ? sh.getRange(row, c.status) : rotaColRange(sh, c.status))
      .setDataValidation(listRule(ROTA_STATUS));
  });
}

function applyRequestValidation(sh, row) {
  sh = tabOr(sh, REQUESTS_SHEET);
  var drivers = readDrivers(SpreadsheetApp.getActiveSpreadsheet());
  var active = drivers.filter(function (d) { return d.active; }).map(function (d) { return d.name; });
  if (!active.length) active = SEED_DRIVERS.map(function (d) { return d.name; });
  pretty("Request row dropdowns", function () {
    var rq = requestCols(sh);
    (row ? sh.getRange(row, rq.status) : sh.getRange(2, rq.status, 1999, 1))
      .setDataValidation(listRule(REQ_STATUS));
    (row ? sh.getRange(row, rq.replacement) : sh.getRange(2, rq.replacement, 1999, 1))
      .setDataValidation(listRule(active));
  });
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
  if (sh.getLastRow() > 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn())
      .sort(rotaCols(sh).date);
  }
  bumpRotaVersion();
  ui.alert(Utilities.formatDate(d, Session.getScriptTimeZone(), "d MMMM yyyy") +
           " added, with the driver the pattern gives. Change it in the Rota tab.");
}

function extendRota() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ROTA_FILL_WEEKS = 52;
  fillRotaAhead(ss);
  try { fillBusesAhead(ss); } catch (err) { /* never block the rota on this */ }
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
  var rc = colsSoft(sh, CHECKS_SHEET);
  if (!rc.reg) return [];
  var vals = sh.getRange(2, rc.reg, sh.getLastRow() - 1, 1).getValues();
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
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var c = colsSoft(sh, CHECKS_SHEET);
  var out = [];
  vals.forEach(function (r) {
    if (anyToKey(at1(r, c.date)) !== key) return;
    out.push({ reg: String(at1(r, c.reg) || "").trim(),
               driver: String(at1(r, c.driver) || ""),
               outcome: String(at1(r, c.outcome) || ""),
               type: String(at1(r, c.type) || ""),
               time: String(at1(r, c.time) || ""),
               fuel: String(at1(r, c.fuel) || ""),
               jobs: String(at1(r, c.arrange) || "") });
  });
  return out;
}

/* Open defects per registration. Anything not Fixed or Not a defect. */
function openDefectsByReg(ss) {
  var sh = ss.getSheetByName(DEFECTS_SHEET);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var c = colsSoft(sh, DEFECTS_SHEET);
  vals.forEach(function (r) {
    var status = String(at1(r, c.status) || "");
    if (status === "Fixed" || status === "Not a defect") return;
    var reg = String(at1(r, c.reg) || "").trim();
    if (!reg) return;
    if (!out[reg]) out[reg] = [];
    out[reg].push({ reg: reg,
                    item: String(at1(r, c.item) || ""),
                    crit: String(at1(r, c.critical) || "") === "YES",
                    note: String(at1(r, c.found) || ""),
                    date: anyToKey(at1(r, c.date)) });
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
      var rc = rotaCols(sh);
      if (row < 2 || [rc.north, rc.northCover, rc.south, rc.southCover].indexOf(col) === -1) return;
      if (typeof e.oldValue === "undefined" && typeof e.value === "undefined") return;

      var key = anyToKey(sh.getRange(row, 1).getValue());
      if (!key) return;

      var south = (col === rc.south || col === rc.southCover);
      var schedCol = south ? rc.south : rc.north;
      var coverCol = south ? rc.southCover : rc.northCover;
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

/* The menu, grouped by what a thing does to you rather than by what it is
   about.

   So: the two things reached most often sit at the top. Everything else is
   behind a submenu whose name says what happens if you press something in it.
   Fewer things visible means fewer things to press by mistake.

   One item is gone from here and the function is left in the file:

   Repair old fuel readings a migration that ran once, long ago. Harmless to
   run again, since repaired readings are text and get skipped, but it has
   nothing left to do.

   Still callable from the Apps Script editor if an old sheet ever turns up
   with date-shaped fuel readings in it.

   "Set the bus link secret" was listed here too. That function has now gone
   from the file altogether, along with the per-Sunday code it existed for. */
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
/* The next eight Sundays, the bus on each route, and where that answer came
   from. Nothing here writes anything: it exists so the rotation can be read
   and disagreed with before a single passenger sees a seat count. */
/* Overwrites the bus columns on future Sundays with what the rotation says,
   including cells somebody set by hand.

   The everyday fill never does this — it only writes into empty cells — so
   this is the one way to undo an override, and the way to bring the sheet
   into line after the pairing in BUS_ROTATION_ODD has been swapped. It asks
   first because it throws away decisions, which is the same reason the rota's
   own pattern rebuild asks. */
function rebuildBuses() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), ui = SpreadsheetApp.getUi();
  var ok = ui.alert("Rebuild the bus rotation",
    "This sets the bus on every FUTURE Sunday back to what the monthly " +
    "rotation says.\n\nAnything you put in by hand on those Sundays is " +
    "replaced. Past Sundays are left alone.\n\nGo ahead?",
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  var n = 0;
  try { n = fillBusesAhead(ss, null, true); }
  catch (err) { ui.alert("Could not do it", String(err.message || err), ui.ButtonSet.OK); return; }
  ui.alert("Bus rotation", n ? (n + " changed.") : "Nothing needed changing.", ui.ButtonSet.OK);
}

function busSchedule() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lines = [];
  var d = sundayOf(new Date());
  for (var i = 0; i < 8; i++) {
    var key = dateToKey(addWeeks(d, i));
    var nb = busFor(ss, key, "North");
    var sb = busFor(ss, key, "South");
    var mark = function (b) {
      if (!b.reg) return "not known";
      return b.reg + (b.from === "rota" ? "  (set by hand)" : "");
    };
    lines.push(dayWords(keyToDate(key)) +
               "\n     North  " + mark(nb) +
               "\n     South  " + mark(sb));
  }
  SpreadsheetApp.getUi().alert(
    "Which bus is on which route",
    lines.join("\n\n") +
    "\n\n\nThe rotation swaps every calendar month. A month is four or five " +
    "Sundays, so it never falls into step with a three or four driver rota " +
    "and nobody stays in one bus.\n\n" +
    "The North bus and South bus columns on the Rota are filled in for you as " +
    "far ahead as the rota goes. Change one and it stays changed: the app " +
    "only ever writes into an empty cell, so it will not undo you.\n\n" +
    "To put a Sunday back the way the rotation wants it, clear the cell and " +
    "run Set up / refresh rota, or use Rebuild the bus rotation to reset them " +
    "all at once.",
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function healthCheck() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var good = [], bad = [];

  /* First line, because it is the first thing to doubt after a deploy. If
     this is not the version just pasted, nothing else in this report is
     about the code that was meant to be running. */
  good.push("Script is " + SCRIPT_VERSION + ".");

  /* Every tab's headings, against what the code expects to find.

     Most tabs are still read by position, so a renamed or reordered column
     there does not throw — it quietly reads the wrong cell, which is the
     worst way for a spreadsheet to be wrong. Until they are all converted,
     this is the thing that notices. It reports rather than stops, because
     whoever is reading wants the whole list, not the first problem. */
  var headerTrouble = [];
  [[CHECKS_SHEET,   CHECK_HEADERS],
   [DEFECTS_SHEET,  DEFECT_HEADERS],
   [ROTA_SHEET,     ROTA_HEADERS],
   [REQUESTS_SHEET, REQUEST_HEADERS],
   [DRIVERS_SHEET,  DRIVERS_HEADERS],
   [STOPS_SHEET,    STOPS_HEADERS],
   [BOOKINGS_SHEET, BOOKINGS_HEADERS],
   [TRIP_SHEET,     TRIP_HEADERS],
   [BUSES_SHEET,    BUSES_HEADERS]].forEach(function (pair) {
    if (!pair[1]) return;                         /* no list to check against */
    var sh = ss.getSheetByName(pair[0]);
    if (!sh) { headerTrouble.push(pair[0] + " tab is missing"); return; }
    var gone = headersMissing(sh, pair[1]);
    if (gone.length) {
      /* What IS there, not only what is not.

         "No column headed Swap with" sent two people hunting for a missing
         column that was sitting in its right place under a better name. The
         headings a tab carries that the code does not know about are almost
         always the answer, so they are printed beside the question. */
      var want = {};
      pair[1].forEach(function (h) { want[h] = true; });
      var extra = headerRow(sh).filter(function (h) { return h && !want[h]; });
      headerTrouble.push(pair[0] + ": no column headed " +
        gone.map(function (g) { return "\u201C" + g + "\u201D"; }).join(", ") +
        (extra.length
          ? "\n        it does have " +
            extra.map(function (g) { return "\u201C" + g + "\u201D"; }).join(", ") +
            " \u2014 a renamed column reads as a missing one"
          : ""));
    }
  });
  if (headerTrouble.length) {
    bad.push("Column headings are not what the app expects:\n     " +
             headerTrouble.join("\n     ") +
             "\n     Put the heading back exactly, or run Set up / refresh rota.");
  } else {
    good.push("Every tab has the columns the app expects.");
  }

  /* Which bus is where, and whether anything impossible has been asked for. */
  var clash = [];
  readRotaRows(ss).forEach(function (r) {
    var a = String(r.northBus || "").trim().toUpperCase();
    var b = String(r.southBus || "").trim().toUpperCase();
    if (a && b && a === b) clash.push(r.date);
  });
  if (clash.length) {
    bad.push("The same bus is set on both routes on " + clash.join(", ") +
             ".\n     One bus cannot be in two places at ten o'clock.");
  }

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

    /* Who is actually on a rotation, and can they be reached. */
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

  /* Departure rows, said out loud.

     A Depart row is the one row on the tab whose Type has to be exactly
     right, and getting it wrong is silent in the worst way: the row simply
     becomes an ordinary stop, church appears on the booking page as a place
     to wait, and people book a seat at a kerb that is not one. Nothing
     anywhere says so.

     So this names what the app actually sees, per route. A route listed as
     missing is not a fault — it just has no departure time and its first stop
     will say only that the bus is on its way, as it did before. A route
     appearing under pickups when it should be a departure is the fault, and
     the numbers here are what make it visible. */
  /* Anything the last Set up was refused. This is how a tab turned into a
     Google Sheets Table becomes visible: the dropdowns quietly stop being
     managed, the app goes on working, and nothing anywhere says why the Type
     column will not take a new word. */
  var refused = [];
  try { refused = JSON.parse(PropertiesService.getScriptProperties()
                              .getProperty("setupSkipped") || "[]") || []; }
  catch (err) { refused = []; }
  if (refused.length) {
    bad.push(refused.length + " thing" + (refused.length > 1 ? "s were" : " was") +
             " refused the last time Set up ran:\n     \u2022  " +
             refused.join("\n     \u2022  ") + "\n\n     " +
             "\"Not allowed on cells in typed columns\" means that tab has been " +
             "made into a Table. Click any cell on it, then Format > Convert to " +
             "range, and run Set up / refresh rota again. No data is touched \u2014 " +
             "a Table is only a way of looking at rows.");
  }

  var allStops = readBusStopsAll(ss);
  var routesSeen = [];
  allStops.forEach(function (s) {
    if (!s.arrival && !s.depart && routesSeen.indexOf(s.route) < 0) routesSeen.push(s.route);
  });
  var haveDepart = [], missingDepart = [];
  routesSeen.forEach(function (rt) {
    var d = departStopFor(ss, rt);
    if (d) haveDepart.push(rt + " " + d.time);
    else missingDepart.push(rt);
  });
  if (haveDepart.length) {
    good.push("Departure times: " + haveDepart.join(", ") + ".");
  }
  if (missingDepart.length) {
    good.push("No departure time for " + missingDepart.join(" or ") +
              ". Not a fault: those routes simply say the bus is on its way " +
              "until the first stop is marked.\n     " +
              "To add one, put a row on the Bus Stops tab with Type set to " +
              "Depart and the time the bus is due to leave church.");
  }

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
      .addItem("Which bus is on which route", "busSchedule")
      .addItem("Check the Drivers tab", "checkDriversTab")
      .addItem("Check time zone", "checkTimeZoneMenu"))

    .addSubMenu(ui.createMenu("Rota and setup (safe to re-run)")
      .addItem("Set up / refresh rota", "setUpEverything")
      .addItem("Refresh dropdowns from Drivers tab", "refreshDropdownsMenu")
      .addItem("Add a Sunday to the rota", "addSunday")
      .addItem("Extend rota further ahead", "extendRota")
      .addItem("Check scheduled emails, set up any missing", "checkDigestScheduled")
      .addSeparator()
      .addItem("Rebuild future Sundays from the pattern (asks first)", "rebuildFutureRota")
      .addItem("Rebuild the bus rotation (asks first)", "rebuildBuses"))

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

  var c = colsSoft(sh, BOOKINGS_SHEET);
  if (!c.sunday) return;
  var seen = {};
  for (var row = topRow; row <= lastRow; row++) {
    var key = anyToKey(sh.getRange(row, c.sunday).getValue());
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

  var rq = requestCols(sh);
  var touches8  = topCol <= rq.status && lastCol >= rq.status;
  var touches10 = topCol <= rq.replacement && lastCol >= rq.replacement;
  if (!touches8 && !touches10) return;

  var firstRow = Math.max(topRow, 2);
  var lastRow = topRow + numRows - 1;
  if (lastRow < 2) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rota = ss.getSheetByName(ROTA_SHEET);
  var touched = false;

  for (var row = firstRow; row <= lastRow; row++) {
    var status = String(sh.getRange(row, rq.status).getValue() || "");
    var replacement = String(sh.getRange(row, rq.replacement).getValue() || "").trim();
    var key = anyToKey(sh.getRange(row, rq.sunday).getValue());
    if (!key) continue;

    if (status === "Approved" || status === "Rejected") {
      if (!sh.getRange(row, rq.decidedOn).getValue()) {
        sh.getRange(row, rq.decidedOn).setValue(new Date()).setNumberFormat("dd/mm/yyyy");
      }
    } else {
      sh.getRange(row, rq.decidedOn).clearContent();
    }

    if (!rota) continue;
    var rRow = findRotaRow(rota, key) || appendRotaRow(ss, rota, keyToDate(key));

    /* Which route the request belongs to. Approving used to write every
       cover into the North column, so approving a South driver's holiday
       put a stranger against the North slot and left South uncovered. */
    var requester = String(sh.getRange(row, rq.driver).getValue() || "").trim();
    var cols = routeColumns(ss, rota, rRow, requester);

    var type     = String(sh.getRange(row, rq.type).getValue() || "").trim();
    var swapWith = String(sh.getRange(row, rq.swapWith).getValue() || "").trim();
    var swapKey  = anyToKey(sh.getRange(row, rq.theirSunday).getValue());

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
        sh.getRange(row, rq.status).setValue("Pending");
        sh.getRange(row, rq.decidedOn).clearContent();
        sh.getRange(row, rq.status).setNote(problem);
        SpreadsheetApp.getActiveSpreadsheet().toast(problem, "Swap not applied", 12);
      } else {
        sh.getRange(row, rq.status).clearNote();
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

  var rc = rotaCols(sh);
  if (topCol > rc.notes) return;                // edit is entirely right of Notes
  var firstRow = Math.max(topRow, 2);
  var lastRow = topRow + numRows - 1;
  if (lastRow < 2) return;                       // edit is entirely in the header
  var count = lastRow - firstRow + 1;

  // True only when this specific edit touched the scheduled or cover column,
  // so a direct edit to Status, a bus or Notes still leaves a manually set
  // status alone, exactly as a single-cell edit always has.
  var touchesDriverCols = topCol <= rc.northCover && lastCol >= rc.north;

  /* Everything below reads once and writes twice, whatever the size of the
     edit. Row by row, this did three reads and up to three writes each, so
     pasting a few hundred rows meant well over a thousand separate calls and
     the thirty second limit on a simple trigger would cut it off partway
     through, leaving some rows stamped and some not. */
  /* Scheduled, cover and status, read as three named columns rather than one
     three-wide block starting at B. A bus column now sits between the cover
     and the status, so "B, C, D" is no longer those three things. */
  var sched  = sh.getRange(firstRow, rc.north,      count, 1).getValues();
  var covers = sh.getRange(firstRow, rc.northCover, count, 1).getValues();
  var stats  = sh.getRange(firstRow, rc.status,     count, 1).getValues();
  var block = [];
  for (var b = 0; b < count; b++) block.push([sched[b][0], covers[b][0], stats[b][0]]);
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

  if (changed) sh.getRange(firstRow, rotaCols(sh).status, count, 1).setValues(statuses);
  stampRows(sh, firstRow, count, "Coordinator");
  bumpRotaVersion();
}

/* The batched form of stamp(), for when a whole block has been touched. */
function stampRows(sh, firstRow, count, who) {
  var c = rotaCols(sh);
  var now = new Date();
  var who2 = who || "Coordinator";
  var out = [];
  for (var i = 0; i < count; i++) out.push([now, who2]);
  /* Written as two single columns rather than one two-wide block: Updated
     and Updated by are adjacent today, and nothing should depend on their
     staying that way. */
  var when = [], byWho = [];
  for (var j = 0; j < count; j++) { when.push([now]); byWho.push([who2]); }
  sh.getRange(firstRow, c.updated, count, 1).setValues(when)
    .setNumberFormat("dd/mm/yyyy hh:mm");
  sh.getRange(firstRow, c.updatedBy, count, 1).setValues(byWho);
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

  var dc = colsSoft(sh, DEFECTS_SHEET);
  if (!dc.status || !dc.closed) return;
  var touchesStatus = topCol <= dc.status && lastCol >= dc.status;
  var touchesClosed = topCol <= dc.closed && lastCol >= dc.closed;
  if (!touchesStatus && !touchesClosed) return;

  var CLOSED_STATES = ["Fixed", "Not a defect"];
  var changed = false;

  for (var row = firstRow; row <= lastRow; row++) {
    if (touchesStatus) {
      var status = String(sh.getRange(row, dc.status).getValue() || "");
      var closedCell = sh.getRange(row, dc.closed);
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
      var cell = sh.getRange(row, dc.closed);
      var val = cell.getValue();
      if (!val) continue;
      if (!(val instanceof Date)) { cell.setNote("That is not a date. Use dd/mm/yyyy."); continue; }
      var today = new Date(); today.setHours(23, 59, 59, 999);
      var raised = sh.getRange(row, dc.received).getValue();
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
      var st = String(sh.getRange(row, dc.status).getValue() || "");
      if (CLOSED_STATES.indexOf(st) === -1) {
        sh.getRange(row, dc.status).setValue("Fixed");
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
    return parseProtected(String(rota.getRange(row, rotaCols(rota).notes).getValue() || ""));
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
  /* Every payload carries it, so whichever call a page makes first is enough
     and no page needs a request of its own to find out. Added here rather
     than at each return, so a payload added later cannot forget it. */
  if (obj && typeof obj === "object" && obj.script === undefined) {
    obj.script = SCRIPT_VERSION;
  }
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

/* ==========================================================================
   COLUMNS BY NAME

   Read by name and the coupling goes. A column can be inserted where a human
   would want to find it rather than appended to the end for safety, and a tab
   that has been reorganised still reads correctly.

   The one rule these must keep: FAIL LOUDLY. An index of -1 quietly read as a
   column is worse than the positional code it replaces, because it returns a
   value that looks like an answer. A missing column stops the read and says
   which tab and which heading.
   ========================================================================== */

/* Row one, trimmed. Empty when the tab has no rows at all. */
function headerRow(sh) {
  if (!sh || sh.getLastColumn() < 1) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
           .map(function (h) { return String(h == null ? "" : h).trim(); });
}

/* { heading: 1-based column }. Later duplicates do not overwrite earlier
   ones: if a tab somehow carries the same heading twice, the first is the
   one the data was written under. */
function headerMap(sh) {
  var map = {};
  headerRow(sh).forEach(function (h, i) {
    if (h && map[h] === undefined) map[h] = i + 1;
  });
  return map;
}

/* The column, or a refusal naming what is missing. */
function colOf(map, heading, tabName) {
  var c = map[heading];
  if (!c) {
    throw new Error("The " + tabName + " tab has no \u201C" + heading +
                    "\u201D column. Run Minibus > Rota > Set up / refresh rota, " +
                    "or put the heading back exactly as it was.");
  }
  return c;
}

/* ---- column maps, one shape for every tab ------------------------------

   Nine tabs, one rule: find a column by its heading, never by counting to it.
   A coordinator who inserts a column in the middle of any tab now has the app
   read straight past it instead of writing real values one column across.

   Two forms of every map, and the difference matters:

     colsHard   every heading must be there, or it throws with a sentence
                naming the column and the menu item that restores it. For
                writers, which have just run their ensure function and so
                know the headings exist. Refusing a write beats writing it
                into the wrong column: the phone keeps the tap and sends it
                again once the sheet is put right.

     colsSoft   headings that exist resolve, headings that do not resolve to
                0, and column 0 reads as blank. For readers, which run against
                the tab as they find it — including on the Sunday morning
                between a script being deployed and the migration menu item
                being run. An all-or-nothing reader would black out the whole
                service in that window, which is a worse fault than the one
                being fixed.

   FIELDS maps a short name to the exact heading. The short name is what the
   code uses, so a heading can be renamed here in one place. */
var FIELDS = {};

FIELDS[TRIP_SHEET] = {
  logged: "Logged", trip: "Trip", sunday: "Sunday", route: "Route",
  driver: "Driver", event: "Event", stopId: "Stop ID", stop: "Stop",
  scheduled: "Scheduled", happened: "Happened", offset: "Offset",
  status: "Status", reg: "Reg", rotaBus: "Rota bus",
  where: "Where started", acc: "Accuracy (yd)", away: "Distance from base (yd)"
};
FIELDS[STOPS_SHEET] = {
  route: "Route", id: "Stop ID", time: "Time", stop: "Stop",
  postcode: "Postcode", active: "Active", type: "Type"
};
FIELDS[BOOKINGS_SHEET] = {
  received: "Received", sunday: "Sunday", route: "Route", stopId: "Stop ID",
  stop: "Stop", seats: "Seats", device: "Device", status: "Status",
  phone: "Phone", passenger: "Passenger ID"
};
FIELDS[DRIVERS_SHEET] = {
  name: "Name", role: "Role", active: "Active", order: "Primary order",
  pin: "PIN", email: "Email", route: "Route", phone: "Phone"
};
FIELDS[BUSES_SHEET] = {
  reg: "Registration", seats: "Seats for passengers",
  active: "Active", notes: "Notes"
};
FIELDS[CHECKS_SHEET] = {
  received: "Received", id: "Check ID", date: "Date", time: "Time",
  vehicle: "Vehicle", reg: "Registration", driver: "Driver", role: "Role",
  mileage: "Mileage", mileageFlag: "Mileage flag", outcome: "Outcome",
  items: "Items checked", defectCount: "Defect count", defects: "Defects",
  renewals: "Renewals due", signed: "Signed", na: "Not applicable",
  type: "Check type", where: "Where checked", acc: "Accuracy (yd)",
  away: "Distance from base (yd)", locNote: "Location note", fuel: "Fuel",
  arrange: "To arrange", pinCheck: "PIN check"
};
FIELDS[DEFECTS_SHEET] = {
  received: "Received", id: "Check ID", date: "Date", reg: "Registration",
  driver: "Driver", item: "Item", critical: "Critical",
  found: "What the driver found", status: "Status",
  action: "Action taken", closed: "Closed on"
};

/* Strict: throws on the first heading that is not there. */
function colsHard(sh, tabName) {
  var m = headerMap(sh), want = FIELDS[tabName], out = {};
  Object.keys(want).forEach(function (k) { out[k] = colOf(m, want[k], tabName); });
  return out;
}

/* Tolerant: a missing heading is column 0, and at1 reads column 0 as blank. */
function colsSoft(sh, tabName) {
  var m = headerMap(sh), want = FIELDS[tabName], out = {};
  Object.keys(want).forEach(function (k) { out[k] = m[want[k]] || 0; });
  return out;
}

/* One row value, by mapped column. Column 0 — a heading this sheet has not
   got — reads blank, which is what a sheet without that column knows. */
function at1(r, col) { return col ? r[col - 1] : ""; }

/* Put any missing heading on a tab, WITHOUT relabelling a column somebody
   else added.

   insertColumnAfter is the only safe primitive: the spreadsheet moves every
   existing value across with its own heading. Writing a heading at its
   expected position instead relabels whatever is sitting there and leaves the
   old values underneath the new name — which is the exact fault this whole
   change exists to remove, so doing it during the migration would be a poor
   joke.

   Each missing heading goes after the nearest earlier heading that does
   exist, so new columns land beside their neighbours rather than all at the
   end, and a hand-added column keeps its place. */
function ensureCols(sh, headers) {
  var head = headerRow(sh);
  if (!head.length || !head.join("")) {
    if (sh.getMaxColumns() < headers.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    }
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    return;
  }
  headers.forEach(function (name, i) {
    var map = headerMap(sh);
    if (map[name]) return;
    var at = 0;
    for (var j = i - 1; j >= 0; j--) {
      if (map[headers[j]]) { at = map[headers[j]]; break; }
    }
    if (at) sh.insertColumnAfter(at); else sh.insertColumnBefore(1);
    sh.getRange(1, at + 1).setValue(name).setFontWeight("bold");
  });
}

/* Which of the headings a tab is supposed to have are missing. Used by the
   health check, which reports rather than throws: a coordinator wants the
   whole list of what is wrong, not the first thing that stopped it. */
function headersMissing(sh, headers) {
  if (!sh) return headers.slice();
  var map = headerMap(sh);
  return headers.filter(function (h) { return !map[h]; });
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

  var dc = colsSoft(sh, DEFECTS_SHEET);
  if (!dc.status) return;
  var range = sh.getRange(2, dc.status, 999, 1);
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
  sh = tabOr(sh, DEFECTS_SHEET);
  var rule = SpreadsheetApp.newDataValidation()
    .requireDateBetween(new Date(2026, 0, 1), new Date(2100, 0, 1))
    .setAllowInvalid(false)
    .setHelpText("Enter the date the defect was actually put right. It cannot be a future date.")
    .build();
  var cc = colsSoft(sh, DEFECTS_SHEET);
  if (!cc.closed) return;
  var range = sh.getRange(2, cc.closed, 999, 1);
  pretty("Defects Closed on date rule", function () {
    range.setDataValidation(rule);
    range.setNumberFormat("dd/mm/yyyy");
  });
}

function applyStatusDropdown(sh, row) {
  /* The one that actually caught somebody out. Run from the editor it was
     handed no sheet at all; there is only ever one tab this belongs to. */
  sh = tabOr(sh, DEFECTS_SHEET);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_OPTIONS, true)
    .setAllowInvalid(false)
    .setHelpText("Pick a status: " + STATUS_OPTIONS.join(", "))
    .build();

  var col = colsSoft(sh, DEFECTS_SHEET).status;
  if (!col) return;
  var range = row ? sh.getRange(row, col) : sh.getRange(2, col, 999, 1);
  /* Guarded hardest of all: this runs inside handleCheck, while a defect
     report is being written. A dropdown is not worth a fault report. */
  pretty("Defects status dropdown", function () { range.setDataValidation(rule); });
}

function addDropdownToExistingSheet() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DEFECTS_SHEET);
  if (!sh) throw new Error("No sheet named " + DEFECTS_SHEET);
  setUpDefectsSheet(sh);
}

function alreadyHave(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return false;
  var col = colsSoft(sh, CHECKS_SHEET).id;
  if (!col) return false;
  var ids = sh.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return true;
  }
  return false;
}
