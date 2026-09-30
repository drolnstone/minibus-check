/**
 * Minibus check recorder + driving rota.
 *
 * Receives completed checks from the phone app and writes them to this
 * spreadsheet. Emails the coordinator whenever a bus is stopped or a defect
 * is reported. Also serves and records the Sunday driving rota.
 *
 * THIS SPREADSHEET IS THE OFFICIAL ROTA. The app lets drivers look at the
 * rota and ask for a change. It does not let them alter it. Every real
 * change is made by the coordinator: here, in the Rota tab, or in the
 * coordinator's app, whose changes the live server brings here and this file
 * applies (see THE COORDINATOR'S APP).
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
var SCRIPT_VERSION = "v1.90.0";

var TOKEN = "minibusapp";                   // must match config.js

/* THE SHEET'S OWN PASSWORD, from v1.86.0. TOKEN above is in config.js, which
   every phone downloads, so it cannot keep anybody out of what only this
   spreadsheet and the live server should say to each other. SHEET_TOKEN in
   Script Properties is a second one: the same value as the Worker's Secret
   of that name. Every call to the live server carries it, and the three
   things the live server asks of this sheet (collect now, a decision, a
   report) are refused without it. Not set, nothing changes. */
function sheetToken() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty("SHEET_TOKEN") || "").trim();
  } catch (err) { return ""; }
}
function sheetTokenOk(body) {
  var want = sheetToken();
  return !want || String((body && body.sheetToken) || "") === want;
}

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
/* The hour the page gives up waiting for an End tap and rolls to next week
   regardless. Both routes are timetabled into church at 11:00, so this is an
   hour's grace on the whole morning. It used to be 14:00, which meant a
   forgotten End tap left every passenger reading a finished morning, and next
   week unbookable, until the middle of the afternoon. */
var RUN_BACKSTOP_HOUR = 12;
var RUN_BACKSTOP_MIN  = 0;

var BOOKING_CUTOFF_DAY = 0;
var BOOKING_CUTOFF_HOUR = 9;
var BOOKING_CUTOFF_MIN = 30;

var BOOKINGS_SHEET = "Bus Bookings";

/* The tab as this version writes it. Phone and Passenger ID are the two new
   ones; everything to their left is exactly where it always was, because
   ensureBookingColumns only ever appends on the right. */
/* Live ID is the row's id in the live server's database. It is how a copy
   coming back from the Worker finds the row it already wrote, instead of
   appending a second one every few minutes. Appended on the right like every
   other column this file has ever added. */
var BOOKINGS_HEADERS = ["Received", "Sunday", "Route", "Stop ID", "Stop",
                        "Seats", "Device", "Status", "Phone", "Passenger ID",
                        "Live ID"];

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

/* How far back the run reader looks. Trip Events is append-only and has
   never been trimmed, and tripState used to read all of it — on every
   passenger poll, every driver poll, and again for every watching phone at
   once each time a driver taps a stop.

   Two routes at roughly twenty rows a Sunday makes 400 about twenty Sundays,
   where the question being asked is only ever about today. Same reasoning
   and the same number as MILEAGE_SCAN_ROWS. */
var TRIP_SCAN_ROWS = 400;

/* How long a run may go without a tap before the passenger page stops giving
   times and says only what it last knew. Stops are four to six minutes apart,
   so this is roughly three missed ones: long enough to absorb a wheelchair, a
   slow family and a bad set of lights, short enough that somebody standing in
   the rain is not reading a stale promise.

   This is a GUESS. Nothing derives it. Trip Events records the gap between
   every tap on both routes, so after four or five Sundays the real spread can
   be read off the tab and this set from data instead. */
var TRIP_QUIET_MINUTES = 15;

/* How far BEHIND a run may be and still be given an estimate is a setting
   from v1.80.0: maxBehindMinutes in ETA_RULES, 0 for no limit. It was a fixed
   45 here, and on the ruling of 27 September a bus an hour late is still a
   bus somebody is waiting for. */

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

/* WHO THE EMAILS SAY THEY ARE FROM. From v1.86.0.

   Set SENDER_NAME in Script Properties, for example  Dominion Transport ,
   and every email this sheet sends shows that as the sender rather than the
   name on the Google account. The ADDRESS is still the account the script
   runs as: Apps Script cannot send as somebody else. For a church address as
   well, the spreadsheet and its scheduled jobs belong under a Google account
   of the church's own; see README.md.

   Replies go to COORDINATOR_EMAIL, so a driver who answers his duty
   reminder reaches the coordinator whichever account sent it. */
function senderName() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty("SENDER_NAME") || "").trim();
  } catch (err) { return ""; }
}

/* Every email goes through here, so the sender name and the reply address
   are on all of them and cannot be forgotten on the next one written. */
function sendMail(o) {
  var m = {};
  for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) m[k] = o[k];
  var name = senderName();
  if (name && !m.name) m.name = name;
  if (COORDINATOR_EMAIL && !m.replyTo) m.replyTo = COORDINATOR_EMAIL;
  return MailApp.sendEmail(m);
}

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
/* From v1.87.0 the tab also holds what used to be typed into code: each
   bus's renewal dates, which the driver app warns about, and which route it
   takes in odd-numbered months, which the monthly rotation is built from.
   At the END, so nothing a coordinator has sorted or coloured moves. */
var BUSES_HEADERS  = ["Registration", "Seats for passengers", "Active", "Notes",
                      "MOT due", "Service due", "Insurance due", "Permit due",
                      "Route in odd months"];
var BUS_DATE_KEYS = ["mot", "service", "insurance", "permit"];

/* Seats are PASSENGER seats. The driver's seat is not one of them: a bus
   described as 17 seats carries 16 people plus whoever is driving. Getting
   that wrong by one would show somebody a seat that does not exist. */
/* Which bus goes where in ODD-numbered months, when the Buses tab's "Route in
   odd months" column does not say. Blank from v1.88.0: the tab is the only
   place this church's pairing lives, and a copy of this project for another
   church must not quietly send buses it does not have. Blank means the bus
   cells stay empty until the tab says, which everything downstream handles. */
var BUS_ROTATION_ODD = { north: "", south: "" };

/* WHAT FILLS THE NEW BUSES COLUMNS, ONCE. From v1.87.0 the renewal dates and
   the odd-month pairing live on the Buses tab. The first Set up / refresh
   rota after the columns appear copies these in, and from then on the tab is
   the only place they are read from: a renewal is a cell, a new bus a row.
   BUS_ROTATION_ODD above is kept only as the answer for a tab that has no
   pairing at all. Empty from v1.88.0, once this church's had been copied in:
   a new church types its dates straight onto the tab. */
var BUS_DATES_SEED = {};

/* What a brand-new Buses tab starts with. Empty from v1.88.0: a new church
   types its own buses in. See "Setting up for a new church" in README.md. */
var SEED_BUSES = [];

/* The Sunday timetable, so it stops living only in a WhatsApp message.

   Type is Pickup or Arrival. Church is where the run ends, not somewhere
   anybody boards, and keeping that distinction here means nothing later can
   offer it as a place to be picked up.

   Family names are deliberately not in the stop labels. "Bellamy and
   Cromwell families at Church Lane" is fine among people who know each
   other. Written down it pairs a surname with a street and the exact minute
   those people stand outside, and this tab is read by the app. */
/* Lat and Lng joined this tab in v1.71.0, at the END, which is where every
   column added to this spreadsheet goes: ensureCols appends what is missing
   and never moves what is there, so a tab somebody has sorted, filtered or
   coloured survives the upgrade untouched.

   They are the kerb itself. Two things read them and nothing else does: the
   driver's map link, which sends him to the door rather than to the middle of
   a postcode district, and the part of the estimate that works out what
   passing a stop actually saves. Nothing tracks a bus with them.

   BLANK IS THE NORMAL STATE and stays correct: a stop with no pin falls back
   to the postcode for the map and to the timetable for the estimate, which is
   exactly what happened before these columns existed. */
var STOPS_HEADERS = ["Route", "Stop ID", "Time", "Stop", "Postcode", "Active", "Type", "Where",
                     "Lat", "Lng"];

/* Written out here rather than inline at the one place each tab is created,
   so the health check has something to compare a live sheet against. Three
   tabs had their headings buried in a call, and they were exactly the three
   the check could not cover. */
/* The four on the end are new in v1.62.0 and go on the END for the reason
   every other late column does: existing rows keep every value where it
   already was, and ensureCols adds the headings on the next write. */
var CHECK_HEADERS = [
  "Received", "Check ID", "Date", "Time", "Vehicle", "Registration",
  "Driver", "Role", "Mileage", "Mileage flag", "Outcome",
  "Items checked", "Defect count", "Defects", "Renewals due", "Signed",
  "Not applicable", "Check type", "Where checked", "Accuracy (yd)",
  "Distance from base (yd)", "Location note", "Fuel", "To arrange", "PIN check",
  "Advisory count", "Advisories", "Authorised by", "Authorised on"
];
/* Kind separates what a thing IS from what has been DONE about it. An
   advisory that has been looked at and left alone is Advisory/Open, which is
   a sentence the Status column alone could not say. */
var DEFECT_HEADERS = [
  "Received", "Check ID", "Date", "Registration", "Driver",
  "Item", "Critical", "What the driver found", "Status", "Action taken",
  "Closed on", "Kind"
];

/* ---- authorising a stopped bus -----------------------------------------
   Which roles on the Drivers tab may let a bus out with a fault on it, and
   whether the person who did the walkaround may also sign it off.

   SET IN SCRIPT PROPERTIES AS COORDINATOR_ROLES, from v1.85.4, the way
   COORDINATOR_EMAIL is: the titles as they appear in the Role column of the
   Drivers tab, separated by commas, the one people should ring FIRST. For
   example  Coordinator, Minister in Charge . Blank or missing, the default
   below is used. A church that calls the job something else changes that one
   setting, then Send everything to the live server now; no code is edited
   and nothing is redeployed.

   The same list goes to the live server on every push, and every page takes
   it from there: who may authorise, who is offered the full inspection, who
   may open the coordinator's app, and who people are told to ring.

   Keep AUTHORISER_ROLES_DEFAULT in step with fullInspectionRoles in
   config.js, which is what the pages use before the live server has
   answered. A test checks the two against each other.

   SAME_HAND_BOTH_WAYS false means a second coordinator has to authorise. With
   one coordinator that means nobody can, so think before changing it. */
var AUTHORISER_ROLES_DEFAULT = ["Coordinator", "Minister in Charge"];
var AUTHORISER_ROLES = (function () {
  try {
    var p = PropertiesService.getScriptProperties().getProperty("COORDINATOR_ROLES");
    var list = String(p || "").split(",")
      .map(function (r) { return r.replace(/\s+/g, " ").trim(); })
      .filter(function (r) { return r; });
    if (list.length) return list;
  } catch (err) {}
  return AUTHORISER_ROLES_DEFAULT.slice();
})();
var SAME_HAND_BOTH_WAYS = true;

/* Whether COORDINATOR_ROLES is set, for the status report. */
function hasRolesProperty() {
  try {
    return !!String(PropertiesService.getScriptProperties().getProperty("COORDINATOR_ROLES") || "").trim();
  } catch (err) { return false; }
}

/* When the coordinator is told a bus was authorised to run.
     "now"      an email as it happens
     "summary"  held for the Sunday evening summary, where it is listed
   Set here only: this is the file that sends the email. */
var TELL_COORDINATOR = "now";

/* ---- THE ESTIMATE -------------------------------------------------------

   Pushed to the live server on every sync, which is the only way it can get
   there: the Worker cannot see this file. Keep it equal to `eta` in
   config.js — the app draws the driver's list from that copy and the Worker
   answers the passenger from this one, and the two showing different numbers
   for the same bus is the one thing this must never do.

     dwellSeconds     how long the bus stands at a stop it calls at
     skipSaves        of a gap, the fraction a skip removes when there are no
                      coordinates to work it out properly
     speedMph         only used to turn a distance into a drive time
     maxSkipMinutes   a cap, so one absurd gap cannot swallow a whole leg

   The defaults lean towards predicting the bus EARLY. That is deliberate and
   it is the whole design: an estimate that is too late means the bus came and
   went while somebody was still walking to the kerb, and the next one is next
   week. An estimate that is too early costs them a wait at a stop they were
   standing at anyway. */
/* ---- WHEN A PASSENGER IS TOLD SOMETHING --------------------------------

   Pushed to the live server on every sync, which is the only way it gets
   there. Keep equal to `passenger` in config.js.

     resendMinutes    the estimate has to have moved by more than this before
                      somebody is told again. The stop just before his and his
                      own always send, whatever this says.
     morningMessage   the first message of the day, at the same time the
                      drivers are told they are driving.
     quietFrom/To     whole hours, London time, that nothing is sent between.
                      Booking reminders only: a bus that is coming is not a
                      convenience and is never held back.

   WHY resendMinutes EXISTS. The ruling is that a passenger hears at every
   booked pickup before his own. North has eight pickups and South seven, so
   the last man on a full morning is woken seven or eight times — and the
   coordinates show those stops are not evenly spread: S05, S06 and S07 sit
   inside 438 metres, N05 through N07 inside 556. Without a threshold he gets
   three buzzes in a few minutes all saying nearly the same thing, and the one
   that mattered is the one he has stopped reading. */
var PASSENGER_RULES = {
  resendMinutes: 3,
  morningMessage: true,
  quietFrom: 21,
  quietTo: 8
};

/* ---- DECIDING FROM THE EMAIL -------------------------------------------

   Two messages that used to end with "open the spreadsheet" now carry a link
   to a page where the decision can be made: a bus stopped by a critical
   defect, and a driver asking to swap or be covered.

   IT IS NEVER A ONE-CLICK LINK. Whatever opens a link acts on it, and mail
   providers, phone previews and corporate gateways all open links before a
   person does — any of them would otherwise authorise a bus with a fault on
   it while the email was still unread. The link opens a PAGE, the page asks
   for the coordinator's own PIN, and only the PIN acts.

   ONE USE, AND IT EXPIRES. ttlMinutes is how long. A mailbox is kept for
   years and a link that still works in March is a way into the record nobody
   is watching.

     on          false puts every email back to "open the spreadsheet"
     ttlMinutes  how long a link lasts
     pagesUrl    where the pages are published. The link is this plus
                 do/?t=<token>. Change it if the site ever moves.

   IF THE LIVE SERVER CANNOT BE REACHED the email still goes, without a link
   and saying so. A decision made on the spreadsheet is what everybody has
   today and nothing is lost by falling back to it. */
/* ---- WHEN THE CALENDAR ENTRY REMINDS HIM --------------------------------

   Hours before the departure time. Twenty-four, so it lands on SATURDAY
   MORNING at the hour he would be leaving.

   IT WAS TWELVE, AND TWELVE WAS WRONG. Twelve hours before a 09:52 departure
   is ten o'clock on Saturday night. The argument for it was that late is the
   last moment he can ring somebody — but a notice that arrives at bedtime is
   one he is least able to act on and most likely to silence, and it competes
   with sleep rather than with his Saturday.

   The argument against twenty-four used to be that a day is long enough to
   forget. It is not an argument any more: SUNDAY MORNING IS ALREADY COVERED,
   by the "You are driving today" push between half seven and half eight. The
   calendar alarm does not have to be the reminder on the day, so it should be
   the one that gives him a whole waking day to arrange cover.

   A second alarm nearer the time is one line below if it is ever wanted. */
var DUTY_ALARM_HOURS = 24;

var LINK_RULES = {
  on: true,
  ttlMinutes: 60,
  pagesUrl: "https://drolnstone.github.io/minibus-check/"
};

/* ---- ASKING PEOPLE TO BOOK ----------------------------------------------

   Nudges to anybody whose phone has asked to be told things and who has no
   seat for the Sunday bookings are currently open for. Somebody who has
   already booked is dropped from the list the moment he books, so the nudge
   only ever reaches people who still have no seat. The one thing a man with
   a seat hears is the reminder of what he booked, on a window marked booked.

   THREE WINDOWS, AND THEY ARE THE THREE MOMENTS A SEAT GETS DECIDED:

     Sunday afternoon    the run is over and next Sunday has just opened.
                         This is the one that catches somebody while the bus
                         is still on his mind.
     Wednesday evening   the middle of the week, for whoever has not got
                         round to it.
     Saturday evening    the last one that can do anything. Bookings close at
                         half past nine on Sunday morning, so this is the
                         final hour anybody can act, and the wording says so.

   IT WAS TWO, SUNDAY AND THURSDAY, and it was really one. oncePerWeek was
   true, which tags every window in a week the same, so a man nudged on the
   Sunday was silent on the Thursday whether he had booked or not — and since
   the Sunday window runs first, Thursday only ever reached people who had
   joined since. Three windows with oncePerWeek left true would have been the
   same single nudge with two more chances to be the one that got skipped.

     windows        each { day, from, to }. day is 0 for Sunday, from and to
                    are whole hours in London time. Add or remove one and
                    nothing else has to change.
     oncePerWeek    true means the FIRST window a man is caught by is the
                    only one he hears that week. False, as it is now, means
                    every window he is still unbooked at reaches him — so a
                    man who never books hears three times, and a man who
                    books on Sunday night hears once.
     booked         true on a window means it also tells everybody who HAS
                    booked what they booked: stop, time and seats, with the
                    way to change it or cancel. From v1.83.0, on Saturday
                    evening, so the last word before the morning is his own
                    booking. Once per window per Sunday. Leave it off every
                    window and a man with a seat hears nothing until the
                    Sunday morning message, as before.

   Nothing here can fire inside quiet hours: the test suite checks every
   window against PASSENGER_RULES and fails rather than shipping one. */
var BOOKING_RULES = {
  on: true,
  oncePerWeek: false,
  windows: [
    { day: 0, from: 15, to: 16 },
    { day: 3, from: 18, to: 19 },
    { day: 6, from: 18, to: 19, booked: true }
  ]
};

/* ---- THE KERBS ----------------------------------------------------------

   Supplied 21 September 2026, one per pickup, plus the church both routes
   start and end at.

   WHAT THIS DOES: on every "Set up / refresh rota" it fills any Lat or Lng
   cell that is EMPTY and whose Stop ID it recognises. It never overwrites a
   cell that has something in it, so a coordinate you correct by hand stays
   corrected, and running the setup twice changes nothing the second time.

   WHY IT IS HERE rather than being typed in once: because typing fifteen
   pairs of six-decimal numbers into a spreadsheet by hand is how a digit gets
   transposed, and a transposed digit in a coordinate is not a wrong answer
   that looks wrong — it is a stop that quietly moves half a mile and an
   estimate that is confidently incorrect about it.

   IT IS NOT THE AUTHORITY. The tab is. This only fills blanks, and a stop
   added later with no entry here simply stays blank, which is a state
   everything downstream already handles.

   Two of these were checked against figures measured independently: S03 to
   S04 comes out at 195 metres and N05 through N07 at 556, both exactly as
   reported. */
/* Empty from v1.88.0. Kerb positions are typed on the Bus Stops tab, which
   was always the authority; this only ever filled blanks. A church can list
   stops here by Stop ID ({ "N01": { stop, postcode, at: [lat, lng] } }) to
   have Set up fill them, but the tab is quicker. */
var STOP_PINS = {};

/* ---- IS THIS ROW THE STOP THAT WAS SURVEYED ----------------------------

   22 September 2026: every Lat and Lng on the tab came out blank, on all
   nineteen rows, and the reason was one line of mine.

   The match was `name === known.stop` — exact string equality — and the names
   in the table above were the SHORT ones out of the test fixtures. A real tab
   does not say "Grace Rd". It says "Grace Road bus stop, Walton Vale". Not one
   of the fifteen could ever have matched, and the church rows say "Church,
   Chester Road" rather than "Church", so those failed too. The guard was
   sound; what it was comparing was not.

   THE POSTCODE IS THE SIGNAL, and it is a better one than the name ever was.
   It is already on the tab, it is maintained beside the stop, and it is the
   thing that CHANGES WHEN A STOP MOVES — which is the whole reason a check
   exists here. A pickup point shifted to another road gets another postcode
   and the row quietly stays blank, exactly as intended.

   THE ROAD NAME IS THE FALLBACK, for a row whose postcode nobody has filled
   in. It compares the part of the name that does not move: everything before
   the first comma, bracket, "by", "at", "off" or "bus stop", with the usual
   Street and Road abbreviations flattened, so "Pym Street bus stop, County
   Road" and "Pym Street" are the same kerb and "Little Kings & Queens
   Nursery, Litherland Road" is honestly not comparable and waits for its
   postcode.

   Neither is guessing. When both are absent or disagree the cell stays blank,
   which is a state everything downstream already handles and which is visible
   to the person who moved the stop. */
var ROAD_CUT = /(,| \(| bus stop| by | at | off | near | outside | opposite ).*$/i;
var ROAD_WORDS = [[/\bstreet\b/g, "st"], [/\broad\b/g, "rd"], [/\bdrive\b/g, "dr"],
                  [/\bavenue\b/g, "ave"], [/\bpark\b/g, "pk"], [/\blane\b/g, "ln"],
                  [/\bclose\b/g, "cl"], [/\bsquare\b/g, "sq"], [/\bthe\b/g, ""]];

function roadKey(name) {
  var t = String(name == null ? "" : name).trim().toLowerCase().replace(ROAD_CUT, "");
  for (var i = 0; i < ROAD_WORDS.length; i++) t = t.replace(ROAD_WORDS[i][0], ROAD_WORDS[i][1]);
  return t.replace(/[^a-z0-9]/g, "");
}

function samePostcode(a, b) {
  var x = String(a || "").replace(/\s+/g, "").toUpperCase();
  var y = String(b || "").replace(/\s+/g, "").toUpperCase();
  return !!x && !!y && x === y;
}

/* True when this row is the place the coordinate was taken at. */
function pinFits(known, name, postcode) {
  if (!known) return false;
  var want = String(known.postcode || "").replace(/\s+/g, "");
  var got = String(postcode || "").replace(/\s+/g, "");
  if (want && got) return samePostcode(want, got);

  var a = roadKey(name), b = roadKey(known.stop);
  if (!a || !b) return false;
  if (a === b) return true;
  /* "Stanley Park Market" against "Stanley Park": one is the other with more
     of the address on it. Five characters, so a short key cannot swallow an
     unrelated longer one. */
  var shorter = a.length < b.length ? a : b;
  return shorter.length >= 5 && (a.indexOf(b) === 0 || b.indexOf(a) === 0);
}

var CHURCH_PIN = { at: [53.424169, -2.936799], postcode: "L6 4DY" };

/* Two more from v1.80.0, both about when the passenger page stops giving a
   time rather than how the time is worked out:

     maxBehindMinutes  how far behind the timetable a bus may be and still be
                       given an estimate. 0 is no limit. It was a fixed 45.
     keepMinutes       how long an estimate stays up once its time has passed
                       and the stop is still unmarked. It was two minutes.
                       Fifteen matches the quiet rule, so the estimate stays
                       until the bus is marked there or later, or goes quiet.

   Keep all six equal to `eta` in config.js. */
var ETA_RULES = {
  dwellSeconds: 75,
  skipSaves: 0.8,
  speedMph: 18,
  maxSkipMinutes: 6,
  maxBehindMinutes: 0,
  keepMinutes: 15
};

/* What the Outcome column may say. The last one is the only one a person
   picks by hand as a rule, and it is what the override writes from either
   direction. Advisory is what a check with advisories and no defects says. */
var OUTCOME_OPTIONS = ["Clear", "Advisory", "Defects", "STOPPED", "Authorised to run"];
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
  /* Received and Decided on are moments, and a moment shown as a bare date is
     half a record. */
  try {
    var qc = requestCols(sh);
    stampTimeFormats(sh, qc, ["received", "decidedOn"]);
  } catch (err) { /* a heading missing is the health check's problem, not this */ }
  return did;
}

/* What a brand-new Bus Stops tab starts with. Empty from v1.88.0: a new
   church types its own timetable in. */
var SEED_STOPS = [];

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
  var hadPairing = !!headerMap(sh)["Route in odd months"];
  /* Was: rewrite the whole heading row whenever it was wide enough, which
     relabelled anything a coordinator had put on this tab. */
  ensureCols(sh, BUSES_HEADERS);
  var bc = colsHard(sh, BUSES_SHEET);
  if (!hadPairing) busColumnsFirstFill(sh, bc);
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
  if (sh.getLastRow() < 2 && SEED_BUSES.length) {
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
  memoDrop("buses");                     /* this may have just seeded the tab */
  return sh;
}

/* Called five times in one ?board=1, to read the same two rows. */
function readBuses(ss) {
  return memo("buses", function () { return readBusesFresh(ss); });
}

/* The new columns, the first time they appear: notes on the headings, date
   formats, a North/South dropdown, and what the code used to hold copied in
   for any bus it knew. Never run again once the pairing column exists, so
   nothing typed on the tab is ever written over. */
function busColumnsFirstFill(sh, bc) {
  try {
    sh.getRange(1, bc.mot).setNote(
      "When each renewal is due. The driver app warns 30 days ahead and says\n" +
      "when one has passed. Leave blank for anything this bus does not have.");
    sh.getRange(1, bc.oddRoute).setNote(
      "North or South: the route this bus takes in odd-numbered months\n" +
      "(January, March...). Even months are the other way round. Blank for a\n" +
      "standby bus. A bus typed on a Sunday's Rota row still wins for that Sunday.");
    BUS_DATE_KEYS.forEach(function (k) {
      sh.getRange(2, bc[k], Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat("dd/mm/yyyy");
    });
  } catch (err) {}
  pretty("Buses route dropdown", function () {
    sh.getRange(2, bc.oddRoute, 199, 1).setDataValidation(listRule(["North", "South"]));
  });
  var last = sh.getLastRow();
  if (last < 2) return;
  var regs = sh.getRange(2, bc.reg, last - 1, 1).getValues();
  for (var i = 0; i < regs.length; i++) {
    var reg = String(regs[i][0] || "").trim().toUpperCase();
    if (!reg) continue;
    var row = i + 2;
    var route = reg === String(BUS_ROTATION_ODD.north).toUpperCase() ? "North"
              : reg === String(BUS_ROTATION_ODD.south).toUpperCase() ? "South" : "";
    if (route) sh.getRange(row, bc.oddRoute).setValue(route);
    var seed = null;
    Object.keys(BUS_DATES_SEED).forEach(function (k) { if (k.toUpperCase() === reg) seed = BUS_DATES_SEED[k]; });
    if (seed) BUS_DATE_KEYS.forEach(function (k) {
      if (seed[k]) sh.getRange(row, bc[k]).setValue(keyToDate(seed[k]));
    });
  }
  memoDrop("buses");
}

/* A date from a cell, as yyyy-mm-dd, or "". Sheets hands back a Date for a
   cell it recognises and the typed text for one it does not. */
function isoDay(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  var t = String(v || "").trim();
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  return "";
}

/* The odd-month pairing, off the Buses tab: the active bus marked North and
   the one marked South. Either missing, the code's BUS_ROTATION_ODD. */
function busPairing() {
  var north = "", south = "";
  try {
    readBuses(SpreadsheetApp.getActiveSpreadsheet()).forEach(function (b) {
      if (!b.active) return;
      if (b.oddRoute === "North" && !north) north = b.reg;
      if (b.oddRoute === "South" && !south) south = b.reg;
    });
  } catch (err) {}
  return (north && south) ? { north: north, south: south } : BUS_ROTATION_ODD;
}

function readBusesFresh(ss) {
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
      notes: String(at1(r, c.notes) || "").trim(),
      dates: { mot: isoDay(at1(r, c.mot)), service: isoDay(at1(r, c.service)),
               insurance: isoDay(at1(r, c.insurance)), permit: isoDay(at1(r, c.permit)) },
      oddRoute: (function (x) { return x === "N" ? "North" : x === "S" ? "South" : ""; })(
        String(at1(r, c.oddRoute) || "").trim().toUpperCase().charAt(0))
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
  var p = busPairing();
  return odd ? { North: p.north, South: p.south } : { North: p.south, South: p.north };
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
/* Cancelled/declined has always meant the whole Sunday is off. The two route
   entries are narrower and are the ones that actually get used: two buses, one
   per route, and when one of them cannot go that route stops while the other
   runs as normal.

   The passenger page reads these. A route marked off here tells the people who
   booked it, refuses any further seats on it, and replaces their live panel
   with a plain notice instead of a bus that never arrives. So the wording is
   load-bearing: the Worker matches the whole string, in lower case, and
   "<Route> cancelled" is the shape it looks for. */
var ROTA_STATUS    = ["Confirmed", "Change requested", "Covered",
                      "North cancelled", "South cancelled",
                      "Cancelled/declined", "No driver assigned"];
var REQ_STATUS     = ["Pending", "Approved", "Rejected"];

/* ---- IS THIS MORNING STILL HIS -----------------------------------------

   Two questions that look like one, and the difference between them is the
   whole reason they are separate functions.

   routeCalledOff   a person decided this route is not running. Deliberate,
                    stable, and it stays true until somebody changes it back.
   dutyIsOff        that, OR nobody is assigned to it.

   THE SECOND IS NOT SAFE EVERYWHERE THE FIRST IS. "No driver assigned" is a
   state a Sunday passes THROUGH while it is being edited: clear a name and it
   lands there for as long as it takes to type the next one. A rule that reads
   it mid-edit would suppress the email telling the new driver he is on. So
   the reminders, which run once a day against a sheet nobody is typing into,
   use dutyIsOff; the duty-change alert, which runs inside the edit itself,
   uses routeCalledOff and nothing more.

   THE WORDING IS THE WORKER'S. routeCancelled in worker.js matches the whole
   string in lower case and looks for "<Route> cancelled". This has to agree
   with it exactly or a Sunday is off for the passengers and on for the
   driver, which is the worst of the three possible answers. The test suite
   checks the two against every value in ROTA_STATUS rather than trusting
   that they were written on the same afternoon. */
function routeCalledOff(status, route) {
  var st = String(status || "").trim().toLowerCase();
  if (!st) return false;
  if (st === "cancelled/declined") return true;
  /* "North Liverpool" here, "North" there. The route's first word is the
     part both of them mean. */
  var short = String(route || "").trim().split(" ")[0].toLowerCase();
  return !!short && st === short + " cancelled";
}

function dutyIsOff(status, route) {
  if (routeCalledOff(status, route)) return true;
  return String(status || "").trim().toLowerCase() === "no driver assigned";
}

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
   first run the Drivers tab IS the register, not this list.

   Blank from v1.85.0, so a new church starts with nobody in it rather than
   with this one's. Type the people straight onto the Drivers tab: Name,
   Role, Route, Primary order, Active, and a Phone for whoever has the role
   Coordinator, which is the number every page tells people to ring. Each
   entry here, if ever used, is { name, role, route, order }. */
var SEED_DRIVERS = [];

/* ---- entry points ------------------------------------------------------ */

/* ONE DECISION, ARRIVING UNANNOUNCED.

   Answers ok:true when the decision has been dealt with and the live server
   may stop carrying it, which includes the cases where there was nothing to
   do. Anything else — a thrown error, no answer at all — leaves it queued,
   and the drain has it within five minutes. */
function handleDecisionNow(d) {
  if (!d || !String(d.id || "").trim()) {
    return reply({ ok: false, error: "no decision" });
  }
  var took = false;
  try {
    var ss = SpreadsheetApp.getActive();
    took = applyRotaDecision(ss, d);
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
  /* False means the row is being written by somebody else this second and
     this call did not touch it. Answering yes to that would have the live
     server mark it done and nobody would ever apply it. */
  if (!took) return reply({ ok: false, error: "busy, try again" });
  return reply({ ok: true, id: String(d.id) });
}

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
    /* Only the live server asks these, so they want the sheet's own password
       as well as the public one. */
    var fromServer = ["decision", "report", "drainnow"];
    if (fromServer.indexOf(String(body.action || "")) !== -1 && !sheetTokenOk(body)) {
      return reply({ ok: false, error: "bad sheet token" });
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

    /* A ROTA REQUEST DECIDED FROM AN EMAIL, BROUGHT STRAIGHT HERE.

       The same decision the drain would have fetched on its next tick, handed
       over by the live server the moment the PIN was accepted instead of
       waiting up to five minutes to be asked for. Same body writes it either
       way — see applyRotaDecision — so it cannot mean one thing when it
       arrives in two seconds and another when it arrives in five minutes.

       Safe to receive twice. The first thing that function does after finding
       the row is look at the status cell, and a decided request is left
       exactly as it is. So the live server is free to push, fail to hear the
       answer, and let the drain bring the same decision round again. */
    if (String(body.action || "") === "decision") {
      return handleDecisionNow(body.decision);
    }

    /* THE LIVE SERVER KNOCKING. A phone has just booked, tapped a stop, sent
       a walkaround or authorised a bus, and the live server is saying there
       is something to collect. This runs the ordinary drain, the one the five
       minute sync runs, so a row reaches the tab one way whichever way it was
       asked for. If a drain is already running, it goes round once more when
       it finishes, and this returns at once. */
    /* THE REPORTS THE COORDINATOR'S APP ASKS THIS SHEET FOR, by way of
       the live server, which has checked his PIN. The same code as the
       Minibus menu, handed back as parts instead of shown in a box. */
    if (String(body.action || "") === "report") {
      var rname = String(body.name || "");
      try {
        if (rname === "health") return reply({ ok: true, report: healthReport() });
        if (rname === "load") return reply({ ok: true, report: coverReport() });
        if (rname === "tapping") return reply({ ok: true, report: tappingReport() });
        if (rname === "live") return reply({ ok: true, report: liveReport() });
        if (rname === "remind") return reply({ ok: true, report: remindReport() });
      } catch (err) { return reply({ ok: false, error: String(err) }); }
      return reply({ ok: false, error: "no such report" });
    }

    if (String(body.action || "") === "drainnow") {
      var back = drainNow();
      if (back) { try { overbookAfter(back); } catch (err) {} }
      return reply({ ok: true, ran: !!back });
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

/* ONE WRITER AT A TIME, the same as a stop tap.

   A check now reaches this function two ways at once: the phone's own call,
   sent without waiting, and the five minute drain carrying the copy the live
   server took. Both could pass the duplicate test before either had written,
   and the tab would get the check twice, its defects twice and the
   coordinator two emails. Under the lock the second one finds the first and
   stops. */
function handleCheck(c) {
  if (!c || !c.id) {
    return reply({ ok: false, error: "no check in request" });
  }
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); }
  catch (err) { return reply({ ok: false, error: "busy, try again" }); }
  try {
    return handleCheckLocked(c);
  } finally {
    try { lock.releaseLock(); } catch (err) {}
  }
}

function handleCheckLocked(c) {

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

  /* A check that arrived already authorised. That happens when a coordinator
     signed it off on the handset between the walkaround and this row reaching
     the tab, which the live server makes possible and the old
     straight-to-here path did not. */
  var authBy = safeText(c.authorisedBy || "");
  var authOn = c.authorisedAt ? new Date(Number(c.authorisedAt)) : "";

  var outcome = authBy ? "Authorised to run"
              : c.level === "stop" ? "STOPPED"
              : c.level === "warn" ? (((c.defects || []).length) ? "Defects" : "Advisory")
              : "Clear";

  var defectText = (c.defects || []).map(function (d) {
    return d.name + (d.crit ? " (critical)" : "") + (d.note ? ": " + d.note : "");
  }).join(" | ");

  /* Kept apart from the defects all the way here. Folding them together would
     make Defect count the number of things a driver worried about rather than
     the number of things somebody has to book work against. */
  var advisoryText = (c.advisories || []).map(function (d) {
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
  kput(kc.advisoryCount, (c.advisories || []).length);
  kput(kc.advisories,  safeText(advisoryText));
  kput(kc.authBy,      authBy);
  kput(kc.authOn,      authOn);

  checks.getRange(checks.getLastRow() + 1, 1, 1, kw).setValues([krow]);
  applyOutcomeDropdown(checks, checks.getLastRow());

  /* One row per defect AND one per advisory, so nothing a driver wrote down
     is only findable by reading a check row end to end. The Kind column is
     what keeps them apart once they are on the same tab. */
  if ((c.defects || []).length || (c.advisories || []).length) {
    var defs = sheet(ss, DEFECTS_SHEET, DEFECT_HEADERS);
    ensureCols(defs, DEFECT_HEADERS);
    var dfc = colsHard(defs, DEFECTS_SHEET);
    if (!structFresh("defectfmt")) {
      stampTimeFormats(defs, dfc, ["received"]);
      structDone("defectfmt");
    }
    var dfw = Math.max(defs.getLastColumn(), DEFECT_HEADERS.length);
    var writeItem = function (d, kind) {
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
      dput(dfc.kind,     kind);
      defs.getRange(defs.getLastRow() + 1, 1, 1, dfw).setValues([drow]);
      applyStatusDropdown(defs, defs.getLastRow());
    };
    (c.defects    || []).forEach(function (d) { writeItem(d, "Defect"); });
    (c.advisories || []).forEach(function (d) { writeItem(d, "Advisory"); });
  }

  /* The driver's screen asks the live server "has anyone checked this bus
     today", so the answer has to get there. Guarded inside: a check must
     never fail because the live server is unreachable.

     Still called even though the Worker now writes its own copy when the
     phone posts there first: a check that arrived through the fallback path,
     or came back on a drain, reached this function without the Worker ever
     having seen it, and this is the only thing that would tell it. Writing
     the same state twice costs one upsert. */
  pushCheckToWorker(c);

  /* Also when the bus is fine but wants something doing, and whenever there
     is an advisory: a thing worth watching is worth being told about once,
     even on a bus that is otherwise clear. */
  var wantsSomething = (c.jobs || []).length > 0;
  var hasAdvisory = (c.advisories || []).length > 0;
  if (c.level !== "ok" || wantsSomething || hasAdvisory) {
    tellCoordinatorPhones(checkPhoneAlert(c, outcome, defectText));
    if (COORDINATOR_EMAIL) notifyCheck(c, outcome, defectText);
  }

  return reply({ ok: true });
}

/* Four words a person may put in the Outcome column, offered as a list so the
   override is a choice rather than a spelling test. That cell took free text
   until now, which is how "clear" came to be typed into it on a morning when
   the app was waiting for exactly one of these. */
function applyOutcomeDropdown(sh, row) {
  sh = tabOr(sh, CHECKS_SHEET);
  var col = colsSoft(sh, CHECKS_SHEET).outcome;
  if (!col) return;
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(OUTCOME_OPTIONS, true)
    .setAllowInvalid(false)
    .setHelpText("Pick one: " + OUTCOME_OPTIONS.join(", "))
    .build();
  var range = row ? sh.getRange(row, col) : sh.getRange(2, col, 999, 1);
  /* Guarded like the defect dropdown, and for the same reason: this runs
     while a walkaround is being written, and a dropdown is not worth a fault
     report. */
  pretty("Checks outcome dropdown", function () { range.setDataValidation(rule); });
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
   2: Reg on Trip Events.
   3: Advisory count, Advisories, Authorised by and Authorised on on Checks,
      and Kind on Defects. Without this bump the first hour after a deploy
      would skip the column check, colsHard would refuse the missing heading,
      and every walkaround sent in that hour would bounce. */
var STRUCT_VERSION = "3";

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
  /* A menu item is the moment somebody has decided the sheet needs looking
     at. Nothing read earlier in this execution should survive it. */
  memoDrop();
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
  stampTimeFormats(sh, colsSoft(sh, CHECKS_SHEET), ["received"]);

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

  /* Which bus each leg gets, by exactly the rule busFor uses: an entry in the
     rota's own bus column wins for that Sunday, and the standing month by
     month rotation answers everywhere else.

     Resolved here rather than by calling busFor per leg. busFor re-walks every
     rota row to find its override, and this window can be 520 Sundays with two
     legs each. The register is read once and the rest is arithmetic.

     regBook, not knownRegs: there is already a knownRegs(ss) in this file and
     shadowing it inside a function this large is how the next change breaks. */
  var regBook = {};
  readBuses(ss).forEach(function (b) { regBook[String(b.reg).toUpperCase()] = b.reg; });
  function busOn(key, route, over) {
    var o = String(over || "").trim();
    /* A registration nobody recognises is not an answer. Fall through to the
       rotation rather than print a bus that does not exist. */
    if (o && regBook[o.toUpperCase()]) return regBook[o.toUpperCase()];
    var pair = busRule(key);
    if (!pair) return "";
    return regBook[String(pair[route] || "").toUpperCase()] || "";
  }

  var rows = [];
  var seen = {};

  written.forEach(function (r) {
    var d = keyToDate(r.date);
    if (d < from || d > to) return;
    seen[r.date] = true;
    rows.push(decorate(r, requests, {
      north: busOn(r.date, "North", r.northBus),
      south: busOn(r.date, "South", r.southBus)
    }));
  });

  // Fill the gaps from the pattern so the app never shows a hole.
  for (var d = new Date(from); d <= to; d = addWeeks(d, 1)) {
    var key = dateToKey(d);
    if (seen[key]) continue;
    rows.push(decorate({
      date: key, primary: patternDriver(d, pattern.north), actual: "",
      status: "Confirmed",
      primary2: southDriver(d, pattern.south), actual2: "", notes: ""
    }, requests, {
      /* No written row means no override, so both legs take the rotation. */
      north: busOn(key, "North", ""),
      south: busOn(key, "South", "")
    }));
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
    /* Who people ring, for the driver app when this file answers it rather
       than the live server. The live server puts its own on every answer. */
    coordinator: coordinatorContact(drivers),
    /* And whose titles make somebody a coordinator, for the same reason. */
    leadRoles: AUTHORISER_ROLES,
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
    memoDrop("drivers");
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
    /* Nothing running, so any test seat or test tap still on a tab is a
       leftover: from one whose end never reached this file, or from a
       rehearsal run before v1.84.0, which left its taps on purpose. */
    if (!wasOn) tabsTurn(function () { return rehearsalOffTabs(ss, [], Date.now()); });
  } catch (err) {}

  /* The live server, refreshed whether or not anything changed. Cheap, and
     it means a push that failed quietly during the week is put right before
     Sunday without anybody noticing it had. */
  try { pushToWorker(); } catch (err) {}

  /* Backstop for the seat alert. liveSync carries it every five minutes and
     is the one that makes it timely; this is here so the alert survives a
     rollback that removes the live server and its trigger with it. Sending
     twice is impossible: both go through the same sent-once memory. */
  try { overbookingAlert(); } catch (err) {}

  /* Old records to their archive tabs. Guarded, and guarded in one specific
     direction: it must not be able to stop the heartbeat below being written.

     If a failing archive took the heartbeat down with it, maintainIfDue would
     decide after three nights that the nightly job had stopped and move the
     rota fill back in front of drivers on a Sunday morning — a slow read
     restored by a tidy-up nobody asked about. So the archive fails on its
     own, records why in its own property, and healthCheck is what tells
     somebody. */
  try { archiveRun(false); }
  catch (err) {
    try {
      PropertiesService.getScriptProperties()
        .setProperty("archiveError", String((err && err.message) || err));
    } catch (err2) {}
  }

  /* The heartbeat is what maintainIfDue watches. Written last, so a run that
     failed halfway does not claim to have succeeded. */
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty("nightlyRanAt", String(Date.now()));
    props.setProperty("rotaFilledAt", String(Date.now()));
  } catch (err) {}
}

/* ==========================================================================
   ARCHIVING

   The tabs this app writes to have never been trimmed. Trip Events and Bus
   Bookings gain about twenty rows each every Sunday, Checks two, and every
   one of them is read in full somewhere. v1.49.0 windowed the two reads that
   are on the Sunday morning path, which stops those two getting slower — but
   a window is only available to a read that wants recent rows.

   Six reads cannot have one, because they have to search history to be
   correct at all: alreadyHave must find a duplicate check of ANY age or it
   is not a duplicate guard, openDefectsByReg must find a defect open since
   March, and so on. The only way to bound a read that must see everything is
   to stop everything growing. That is this.

   IT IS THE ONLY CODE IN THIS FILE THAT DESTROYS ANYTHING. The protection
   scheme below calls the Checks tab "a signed record of what was inspected"
   and Trip Events "what a driver tapped, and when". So the order here is
   copy, prove the copy landed, and only then delete — never the other way
   round, and never on the strength of setValues not having thrown.

   What it is NOT is "move everything past". Six things in this app
   deliberately look backwards, and taking their rows would break each of
   them silently. Every retention figure below has a reason attached.
   ========================================================================== */

/* Archive tabs live in THIS spreadsheet by default: "Trip Events (archive)"
   beside "Trip Events". Apps Script reads a TAB, not a file, so a three
   thousand row archive next to a two hundred row live tab costs the live
   reads nothing whatever — which is the entire point — and it avoids a
   second file to lock down and a cross-file permission that can fail
   silently at three in the morning.

   Put a spreadsheet id in Script Properties as ARCHIVE_SHEET_ID and the same
   rows go to a separate file instead, with no other change anywhere. It is
   the same shape as BUS_REQUIRE_CODE: present, dormant, and there for the
   day the working file becomes uncomfortable to open. */
function archiveBook() {
  try {
    var id = PropertiesService.getScriptProperties().getProperty("ARCHIVE_SHEET_ID");
    if (id) return SpreadsheetApp.openById(id);
  } catch (err) { /* fall through to this spreadsheet */ }
  return SpreadsheetApp.getActiveSpreadsheet();
}

var ARCHIVE_SUFFIX = " (archive)";

/* Per tab, per run. The six minute execution limit is the reason: a backlog
   takes a few nights rather than one run that dies halfway and leaves rows
   copied but not deleted. Nothing is lost by being slow about it. */
var ARCHIVE_MAX_ROWS = 500;

/* What may go, and what may never go.

   keep       weeks of history that stay on the live tab
   dateField  the column that says how old a row is. A row this cannot read
              is never archived: unknown age is not old.
   hold       rows that stay whatever their age
   holdNewest keep the newest row per value of this column, whatever its age

   A function rather than a constant so the column maps are resolved against
   the sheet as it actually is, at the moment of running. */
function archivePlan() {
  return [
    /* whoIsTapping shows the last twelve runs. Thirteen weeks is that with
       a week to spare. */
    { tab: TRIP_SHEET, keep: 13, dateField: "sunday" },

    /* Nothing reads a booking past the current Sunday — busDateAllowed will
       not admit one. Six weeks is pure margin. */
    { tab: BOOKINGS_SHEET, keep: 6, dateField: "sunday" },

    /* An undecided request is live work whatever its date, so Pending never
       moves however old it is. */
    { tab: REQUESTS_SHEET, keep: 26, dateField: "sunday",
      hold: function (r, c) {
        return String(at1(r, c.status) || "").trim().toLowerCase() === "pending";
      } },

    /* A year, and the newest check per registration is pinned in place
       whatever its age.

       lastMileagePayload answers "what did this bus read last time", and for
       a bus that has been off the road since the spring that answer is an
       old row. Take it and mileProblem stops catching a mistyped odometer,
       which is a real fault introduced to make a read faster. It is also why
       Checks gets the longest window of the five: alreadyHave loses its
       ability to spot a duplicate older than this, and a year is longer than
       any phone has ever held a check in its queue. */
    { tab: CHECKS_SHEET, keep: 52, dateField: "date", holdNewest: "reg" },

    /* Anything not Fixed or Not a defect is still somebody's problem and
       must stay in front of the next driver, however long it has been
       open. */
    { tab: DEFECTS_SHEET, keep: 26, dateField: "date",
      hold: function (r, c) {
        var s = String(at1(r, c.status) || "").trim();
        return s !== "Fixed" && s !== "Not a defect";
      } }
  ];
}

/* The Rota tab is deliberately absent from that list. It gains about fifty
   rows a year, coverBalance counts the last twenty six Sundays off it, and
   it is the tab a coordinator actually works in. Nothing about it is worth
   the risk of a mover. */

/* A row, as a string, for comparing a copy against its original. Dates
   compare by their time value: a Date read back out of a cell is a different
   object with the same instant. */
function archiveSig(row) {
  return row.map(function (v) {
    if (v && typeof v.getTime === "function") return "d" + v.getTime();
    return String(v == null ? "" : v);
  }).join("");
}

/* One tab. Returns what it did rather than throwing, so one tab in trouble
   does not stop the other four. */
function archiveTab(spec, dryRun) {
  var out = { tab: spec.tab, scanned: 0, moved: 0, held: 0, note: "" };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(spec.tab);
  if (!sh || sh.getLastRow() < 2) { out.note = "no rows"; return out; }

  var c = colsSoft(sh, spec.tab);
  if (!c[spec.dateField]) { out.note = "no date column to age rows by"; return out; }

  var head = headerRow(sh);
  var wide = sh.getLastColumn();
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, wide).getValues();
  out.scanned = vals.length;

  var cutoff = dateToKey(addWeeks(sundayOf(new Date()), -spec.keep));

  /* The newest row per key, pinned wherever it sits. */
  var pinned = {};
  if (spec.holdNewest && c[spec.holdNewest]) {
    var newest = {};
    vals.forEach(function (r, i) {
      var k = String(at1(r, c[spec.holdNewest]) || "").trim();
      var d = anyToKey(at1(r, c[spec.dateField]));
      if (!k || !d) return;
      if (!newest[k] || d >= newest[k].date) newest[k] = { date: d, at: i };
    });
    Object.keys(newest).forEach(function (k) { pinned[newest[k].at] = true; });
  }

  var rows = [], take = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    var d = anyToKey(at1(r, c[spec.dateField]));
    if (!d) continue;                       /* unknown age is not old */
    if (d >= cutoff) continue;              /* inside the window */
    if (pinned[i]) { out.held++; continue; }
    if (spec.hold && spec.hold(r, c)) { out.held++; continue; }
    take.push(i + 2);
    rows.push(r);
    if (rows.length >= ARCHIVE_MAX_ROWS) break;
  }

  out.moved = rows.length;
  if (!rows.length || dryRun) return out;

  /* The destination, built from the LIVE tab's own heading row rather than
     from the constants in this file, so a column the coordinator added comes
     across with everything else. */
  var book = archiveBook();
  var name = spec.tab + ARCHIVE_SUFFIX;
  var dest = book.getSheetByName(name);
  if (!dest) {
    dest = book.insertSheet(name);
    dest.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight("bold");
    dest.setFrozenRows(1);
  }
  ensureCols(dest, head.filter(function (h) { return !!h; }));

  /* Refuse rather than misalign. ensureCols only ever inserts, so the orders
     should already agree; if they somehow do not, writing live rows into an
     archive laid out differently would file a driver's name under a stop and
     nothing would ever say so. */
  var destHead = headerRow(dest);
  for (var h = 0; h < head.length; h++) {
    if (!head[h]) continue;
    if (destHead[h] !== head[h]) {
      out.moved = 0;
      out.note = "archive columns do not line up with the live tab — nothing moved";
      return out;
    }
  }

  /* A new tab is 26 columns wide and a live tab can be wider — Checks is 25
     before anybody adds anything. setValues past the edge throws, and it
     would throw AFTER the rows had been selected and before anything was
     verified, which is the one place an exception is least welcome. */
  if (dest.getMaxColumns() < wide) {
    dest.insertColumnsAfter(dest.getMaxColumns(), wide - dest.getMaxColumns());
  }

  var at = dest.getLastRow() + 1;
  dest.getRange(at, 1, rows.length, wide).setValues(rows);

  /* Committed before it is checked, and checked before anything is deleted. */
  SpreadsheetApp.flush();

  var back = dest.getRange(at, 1, rows.length, wide).getValues();
  var same = back.length === rows.length;
  for (var v = 0; same && v < rows.length; v++) {
    same = archiveSig(rows[v]) === archiveSig(back[v]);
  }
  if (!same) {
    /* Duplicated history is recoverable by hand in a minute. Deleted and not
       copied is not recoverable at all. So: nothing is deleted, the run says
       so, and healthCheck repeats it until somebody looks. */
    out.moved = 0;
    out.note = "the copy did not verify — nothing deleted";
    return out;
  }

  /* Bottom-up, contiguous runs batched, so earlier row numbers stay valid as
     it works upwards. */
  take.sort(function (a, b) { return b - a; });
  var k2 = 0;
  while (k2 < take.length) {
    var end = take[k2], n = 1;
    while (k2 + n < take.length && take[k2 + n] === end - n) n++;
    sh.deleteRows(end - n + 1, n);
    k2 += n;
  }
  return out;
}

/* Every tab, with the guards. dryRun changes nothing and is what the menu's
   "What would be archived" runs. */
function archiveRun(dryRun) {
  var report = { when: new Date(), dry: !!dryRun, tabs: [], blocked: "" };

  /* A rehearsal writes rows that look like a Sunday and are not one. */
  if (rehearsalOn()) { report.blocked = "a rehearsal is running"; return report; }

  /* A bus still out is not history. runComplete only answers usefully ON a
     Sunday — on a weekday bookings for the coming Sunday are still open and
     it is false all day — so it is asked only when the day is Sunday. That
     also means the 3am pass stands down on Sunday mornings, which is right:
     nothing should be moving rows in the hours before a run. */
  if (new Date().getDay() === 0 && !runComplete()) {
    report.blocked = "this Sunday's run is not over";
    return report;
  }

  archivePlan().forEach(function (spec) {
    try { report.tabs.push(archiveTab(spec, dryRun)); }
    catch (err) {
      report.tabs.push({ tab: spec.tab, scanned: 0, moved: 0, held: 0,
                         note: String((err && err.message) || err) });
    }
  });

  if (dryRun) return report;

  var moved = 0, trouble = [];
  report.tabs.forEach(function (t) {
    moved += t.moved;
    if (t.note && t.note.indexOf("no rows") !== 0) trouble.push(t.tab + ": " + t.note);
  });

  /* openDefectsByReg rides on the cached rota payload, so a defect leaving
     the live tab has to reach the phones. */
  if (moved) { try { bumpRotaVersion(); } catch (err) {} }
  memoDrop();

  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty("archiveRanAt", String(Date.now()));
    props.setProperty("archiveLast", JSON.stringify(report.tabs).substring(0, 8000));
    if (trouble.length) props.setProperty("archiveError", trouble.join(" | "));
    else props.deleteProperty("archiveError");
  } catch (err) {}

  return report;
}

/* ---- the two menu items ------------------------------------------------ */

function archiveReportWords(report) {
  if (report.blocked) {
    return "Nothing was done, because " + report.blocked + ".\n\n" +
           "It will run by itself at 3am on any night when neither is true.";
  }
  var lines = report.tabs.map(function (t) {
    return t.tab +
           "\n     " + t.scanned + " rows on the tab" +
           "\n     " + t.moved + (report.dry ? " would move" : " moved") +
           (t.held ? "\n     " + t.held + " old but kept back" : "") +
           (t.note ? "\n     " + t.note : "");
  });
  var moved = 0;
  report.tabs.forEach(function (t) { moved += t.moved; });
  return lines.join("\n\n") +
         "\n\n" + (report.dry
           ? (moved ? moved + " rows would move to the archive tabs. Nothing has changed."
                    : "Nothing is old enough to move yet. Nothing has changed.")
           : (moved ? moved + " rows moved."
                    : "Nothing needed moving.")) +
         "\n\nUp to " + ARCHIVE_MAX_ROWS + " rows per tab per run, so a large " +
         "backlog clears over a few nights rather than in one go.";
}

function archivePreview() {
  SpreadsheetApp.getUi().alert("What would be archived",
    archiveReportWords(archiveRun(true)), SpreadsheetApp.getUi().ButtonSet.OK);
}

function archiveNow() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert("Archive old records now",
    "Rows older than each tab's window are COPIED to its archive tab and then " +
    "removed from the live one.\n\n" +
    "Nothing is deleted until the copy has been written, committed and read " +
    "back cell for cell. If that check fails, nothing is deleted at all.\n\n" +
    "Still, take a copy of this spreadsheet before the first time you do this: " +
    "File › Make a copy. It is five seconds and it is the only undo there " +
    "is.\n\nUse \"What would be archived\" first if you have not.\n\nGo ahead?",
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  ui.alert("Archived", archiveReportWords(archiveRun(false)), ui.ButtonSet.OK);
}

/* ==========================================================================
   THE LIVE SERVER

   From v1.51.0 the calls that happen DURING a Sunday are answered by a
   Cloudflare Worker rather than by this file: the passenger page's load, the
   bus position, bookings, and the driver's stop taps. Apps Script was never
   slow because of what it was doing — it was slow because every call was a
   forced redirect to a second host plus a container that had gone to sleep,
   which is one to two seconds before a line of this file runs. That is the
   platform, not the code, and no amount of tuning was going to move it.

   NOTHING ELSE MOVED. The rota, the checks, the PIN, every email, every menu
   item, the archiver, the health check: all still here, all unchanged.

   Two flows, one direction each, so the two halves can never disagree:

     PUSH   the Sheet owns the rota, stops, buses and drivers. It sends them
            to the live server whenever they change.
     PULL   the live server owns bookings and trip taps. This file brings
            copies back onto the tabs so the record, the reports, the emails
            and the archiver carry on working exactly as they do now.

   If the Worker is ever unreachable, nothing here throws: the push retries
   on the next pass and the pull leaves the rows on the server, which is
   holding them anyway. The Sheet cannot be corrupted by the live server
   being down; it can only be a few minutes behind.
   ========================================================================== */

/* The live server's address. In Script Properties as WORKER_URL if you ever
   move it; the line below is the current one. */
var WORKER_URL = (function () {
  try {
    var p = PropertiesService.getScriptProperties().getProperty("WORKER_URL");
    if (p) return p;
  } catch (err) {}
  return "https://minibus-api.asimbassey.workers.dev";
})();

/* Every call to the live server. Never throws: a tidy-up must not be able to
   break a driver's check or a coordinator's edit. */
function workerCall(action, body) {
  if (!WORKER_URL) return { ok: false, error: "no live server address" };
  try {
    var payload = body || {};
    payload.action = action;
    payload.token = TOKEN;
    if (sheetToken()) payload.sheetToken = sheetToken();
    var res = UrlFetchApp.fetch(WORKER_URL, {
      method: "post",
      /* text/plain on purpose, exactly as both pages send it: a JSON content
         type would trigger a CORS preflight and double every write. */
      contentType: "text/plain;charset=utf-8",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      followRedirects: true
    });
    var txt = res.getContentText();
    try { return JSON.parse(txt); }
    catch (err) { return { ok: false, error: "bad reply: " + txt.substring(0, 200) }; }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

/* ---- PUSH: what the Sheet owns ---------------------------------------- */

/* How many Sundays of rota to send. The live server only ever asks about
   this Sunday and next, so this is generous by an order of magnitude and
   costs one small payload. */
var LIVE_ROTA_WEEKS = 8;

/* How much rota to put on the Worker's shelf, in weeks, so the driver app can
   be answered from there instead of from here.

   Two different numbers because they answer two different questions.
   LIVE_ROTA_WEEKS above is how far ahead the Worker needs RAW rows to work
   out which bus is on which route for a booking. These are how much of the
   FINISHED rota screen to keep ready.

   104 forward because that is exactly what the app asks for on its first
   open, and 12 back because that is one tap of Earlier Sundays. Anything
   outside that window the Worker refuses and the app asks here instead,
   which is slow and correct and almost never happens. */
var LIVE_CACHE_BACK  = 12;
var LIVE_CACHE_AHEAD = 104;

function pushToWorker() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  /* THE VERSION THIS PUSH COVERS, taken before a single cell is read.

     It was read after the push had landed. An edit made while the push was
     building its payload bumped the version in between, the push was
     recorded as covering it, and the edit waited for the hourly push. */
  var coversVersion = "1";
  try {
    coversVersion = String(PropertiesService.getScriptProperties().getProperty("rotaVersion") || "1");
  } catch (err) {}
  /* THE COORDINATOR'S CHANGES THIS PUSH INCLUDES, read before any tab is, for
     the same reason: a change applied after this line may or may not be in
     what is read below, so it is not claimed. The live server stops laying a
     change over its copy once a push has named it. */
  var readAt = Date.now();
  var coordApplied = [];
  try { coordApplied = coordAppliedRead().map(function (e) { return String(e[0]); }); } catch (err) {}

  /* readBusStopsAll, not readBusStops: the live server needs the Depart rows
     too, because that is what gives a run an offset before the first stop is
     marked. It filters them out of anything a passenger sees, exactly as
     this file does. */
  var stops = readBusStopsAll(ss).map(function (s) {
    return { id: s.id, route: s.route, time: s.time, stop: s.stop,
             postcode: s.postcode, where: s.where,
             arrival: !!s.arrival, depart: !!s.depart,
             /* "" for a stop nobody has pinned, which the live server stores
                as NULL and its geometry reads as absent. */
             lat: s.lat, lng: s.lng };
  });

  var buses = readBuses(ss).map(function (b) {
    /* The dates and the pairing too, from v1.87.0: the live server hands the
       dates to the driver app and builds the rotation from the pairing. */
    return { reg: b.reg, seats: b.seats, active: b.active,
             dates: b.dates || {}, oddRoute: b.oddRoute || "" };
  });

  var drivers = readDrivers(ss).map(function (d) {
    return { name: d.name, role: d.role, route: d.route,
             order: d.order, active: d.active,
             /* The only thing about a PIN that ever leaves this spreadsheet,
                and it leaves one way and salted. Empty for a driver with no
                PIN, which the live server reads as "no PIN wanted" rather
                than as a failure, exactly as this file does. */
             pinHash: pinHashLive(d.name, d.pin) };
  });

  var from = sundayOf(new Date());
  var want = {};
  for (var i = 0; i < LIVE_ROTA_WEEKS; i++) want[dateToKey(addWeeks(from, i))] = true;
  var rota = readRotaRows(ss).filter(function (r) { return want[r.date]; })
    .map(function (r) {
      return { date: r.date, primary: r.primary, actual: r.actual,
               northBus: r.northBus, primary2: r.primary2, actual2: r.actual2,
               southBus: r.southBus, status: r.status, notes: r.notes };
    });

  /* THE EXPENSIVE ANSWERS, BUILT ONCE HERE AND KEPT THERE.

     ?rota=1 and ?last=1 were the two calls the driver app made on the way in,
     and between them they were most of the five to ten seconds it took to
     open. They are reads of things this project computes and nothing else
     can: a repeating pattern filled in for every Sunday nobody has written
     down, swaps read back out of a Notes cell, protected Sundays, the driver
     register. Reimplementing that on the Worker would mean two rotas kept in
     step by hand, and the morning they disagree they would both be confident.

     So it is built here, exactly as it always was, and posted over. This runs
     inside pushToWorker, which liveSync only calls when the rota version has
     changed or an hour has gone by — never on the five minute tick. A handful
     of times a day, for an answer served thousands of times.

     Guarded on its own and allowed to fail: a rota that will not build must
     not stop the stops, buses and drivers below it reaching the Worker, or
     one bad cell would take the passenger page down with it. */
  var cache = null;
  try {
    var cFrom  = addWeeks(sundayOf(new Date()), -LIVE_CACHE_BACK);
    var cWeeks = LIVE_CACHE_BACK + LIVE_CACHE_AHEAD;
    cache = {
      builtAt: Date.now(),
      from: dateToKey(cFrom),
      to:   dateToKey(addWeeks(cFrom, cWeeks)),
      rota: rotaPayload(dateToKey(cFrom), cWeeks),
      /* Mileage only. Which bus is on which route, and how full it is, the
         Worker works out live from its own booking table — fresher than
         anything that could be shipped from here. */
      last: lastMileagePayload()
    };
  } catch (err) {
    cache = null;
    try { PropertiesService.getScriptProperties()
            .setProperty("liveCacheError", String((err && err.message) || err)); } catch (e2) {}
  }

  /* A REHEARSAL IS NOT SENT FROM HERE. From v1.84.0 the live server owns it
     and draws its seats, and this file keeps a copy of the flag it is told
     about on the drain (see coordRehearsal). Until then this push carried the
     flag and the seats, and a sheet whose copy said "none" ended a rehearsal
     started anywhere else on the next sync. */

  /* The requests and defects as the coordinator's app shows them. Guarded on
     its own like the cache above: a tab that will not read must not stop the
     timetable going. */
  var coordShelf = null;
  try {
    coordShelf = { readAt: readAt, requests: coordRequestsList(ss), defects: coordDefectsList(ss) };
  } catch (err) { coordShelf = null; }

  var out = workerCall("sync", {
    stops: stops, buses: buses, drivers: drivers, rota: rota,
    /* Who people ring. The live server stamps it on every answer, so the
       pages take it from there rather than from a file. */
    coordinator: coordinatorContact(readDrivers(ss)),
    /* And every driver's WhatsApp number, for the passenger's Message button.
       See driverWhatsApp for who is ever handed one. */
    driverWa: driverWhatsApp(readDrivers(ss)),
    cache: cache,
    coordShelf: coordShelf || undefined,
    coordApplied: coordApplied,
    /* Who may let a bus out with a fault on it, so the live server can refuse
       a name this spreadsheet would refuse. The Worker holds its own copy of
       the settled default and only replaces it when this arrives, so a Worker
       deployed ahead of a sync is neither shut nor open to everybody. */
    authRules: { roles: AUTHORISER_ROLES, sameHandBothWays: SAME_HAND_BOTH_WAYS },
    /* How the estimate treats a stop the bus is passing. Sent for the same
       reason as the rules above: the number a passenger is shown and the
       number a driver is shown must come from one place. */
    etaRules: ETA_RULES,
    /* When a passenger is told something, and when he is asked to book. Same
       route and same reason as the two above: the Worker cannot see this
       file, and these decide what a hundred phones are sent. */
    passengerRules: PASSENGER_RULES,
    bookingRules: BOOKING_RULES,
    /* How long a decision link lasts, and whether they are made at all. */
    linkRules: { on: LINK_RULES.on, ttlMinutes: LINK_RULES.ttlMinutes },
    /* THE RETURN ADDRESS.

       Everything else in this payload goes one way: the sheet tells the live
       server what it knows. This one line is the live server being told how
       to get back, and it is what turns "somewhere in the next five minutes"
       into "now" for the one thing that cannot wait — a rota request decided
       from an email, where somebody is standing over the phone waiting to
       see that it took.

       Sent every time rather than set once by hand, because a web app gets a
       new address every time it is redeployed, and a stale one would fail
       silently forever. Sent only if it is the published address: run from
       the editor, getUrl() answers with the /dev one, which nothing outside
       this account can reach.

       Losing it costs nothing. The five minute drain is still there, still
       carries the same decisions, and is still what catches a push that
       failed. This only ever makes it sooner. */
    sheetUrl: sheetReturnUrl(),
    /* So the Worker can hand all three version numbers to the two apps and
       nobody has to open this spreadsheet to find the third. It is the only
       route: the Worker cannot see this file. */
    sheet: SCRIPT_VERSION
  });

  try {
    var props = PropertiesService.getScriptProperties();
    if (out && out.ok) {
      props.setProperty("livePushedAt", String(Date.now()));
      props.setProperty("livePushedVersion", coversVersion);
      props.deleteProperty("liveError");
    } else {
      props.setProperty("liveError", String((out && out.error) || "push failed"));
    }
  } catch (err) {}
  return out;
}

/* One check, the moment it is written, so the driver's screen can answer
   "has anyone checked this bus today" without the live server ever needing
   to see the Checks tab. Two rows a Sunday: the cheapest call in the file. */
function pushCheckToWorker(c) {
  try {
    if (!c || !c.reg) return;
    /* WHEN IT WAS MADE, by this server's clock: now, less how long the phone
       says it held the check. A phone can measure that correctly with its
       date set wrong, which its own timestamp cannot. The live server prefers
       its own record of the check when it has one. */
    var age = Number(c.age);
    age = age > 0 ? Math.min(age, 7 * 86400000) : 0;
    var made = new Date(Date.now() - age);
    workerCall("sync", { checks: [{
      reg: String(c.reg).trim(),
      day: dateToKey(made),
      state: (c.level === "stop") ? "stopped" : "ok",
      at: made.getTime(),
      driver: String(c.driver || "").trim(),
      /* Which walkaround this is. The live server keeps the time it first
         saw a check by, so filing it here minutes after a coordinator has
         authorised the bus does not put the bus back in the yard. */
      id: String(c.id || "")
    }] });
  } catch (err) { /* a check must never fail because the live server is down */ }
}

/* ---- PULL: what the live server owns ----------------------------------- */

/* How far up a tab to look for a row we have already written. Drains run
   every few minutes and rows arrive in order, so anything older than this is
   long since filed. */
var LIVE_MATCH_ROWS = 800;

/* { live id : sheet row } for the recent end of a tab. */
function liveIdMap(sh, col) {
  var out = {};
  if (!sh || !col || sh.getLastRow() < 2) return out;
  var last = sh.getLastRow();
  var first = Math.max(2, last - LIVE_MATCH_ROWS + 1);
  var vals = sh.getRange(first, col, last - first + 1, 1).getValues();
  vals.forEach(function (r, i) {
    var id = String(r[0] == null ? "" : r[0]).trim();
    if (id) out[id] = first + i;
  });
  return out;
}

/* APPLYING ONE DECISION MADE FROM AN EMAIL.

   Lifted out of the drain so that the live server can hand one straight here
   the moment a PIN is keyed, instead of it waiting for the next five minute
   tick. Two ways in, one body: a decision applied in two seconds and the same
   decision applied five minutes later must not be able to mean two different
   things.

   ALWAYS RETURNS TRUE, and that is deliberate. It means "stop sending me
   this", not "it worked". A request nobody can find, or one the tab has
   already decided, is finished with as far as the queue is concerned. */
function applyRotaDecision(ss, d, rshIn, rqIn) {
  var rsh = rshIn || ss.getSheetByName(REQUESTS_SHEET);
  if (!rsh || rsh.getLastRow() < 2) return true;
  var rq = rqIn || requestCols(rsh);
  var ids = rsh.getRange(2, rq.id, rsh.getLastRow() - 1, 1).getValues();

      var want = String(d.id || "").trim();
      if (!want) return true;

      var row = 0;
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0] || "").trim() === want) { row = i + 2; break; }
      }
      /* A request nobody can find is not an error worth holding the queue
         open for: the row may have been archived or deleted since the email
         went. Marked done so it stops coming round. */
      if (!row) return true;

      /* CLAIMED UNDER A LOCK, AND ONLY THE CLAIM.

         There are two ways in now — the live server handing this over the
         moment a PIN lands, and the five minute drain asking for it — and
         from the outside they are two scripts that can be inside this
         function at the same instant. The window is the second or so between
         the server writing the decision down and hearing that the sheet has
         it, and anything the drain fetches inside that window it also
         carries. Both would read Pending. Both would write. TWO DRIVERS GET
         TOLD TWICE, which is the one outcome the guard below exists to
         prevent and the one it cannot prevent by itself, because reading and
         writing are two separate calls with a gap in the middle.

         So the read and the two writes are one indivisible act, and nothing
         else is. The emails and the Rota are done after the lock is let go,
         by whichever call claimed it — the loser has already seen a decided
         cell and gone home. Holding the lock across the mail would block
         handleCheck, which waits fifteen seconds for the same script-wide
         lock and answers a driver standing at a bus.

         NOT GETTING THE LOCK IS NOT A FAILURE. It means somebody else is
         mid-write, and the honest answer is to leave the decision queued and
         let the next tick have it. That is the whole design in one line: the
         shortcut may always decline, the backstop may not. */
      var lock = LockService.getScriptLock();
      var locked = false;
      try { lock.waitLock(10000); locked = true; } catch (err) { locked = false; }
      if (!locked) return false;

      try {
        var now = String(rsh.getRange(row, rq.status).getValue() || "").trim();
        if (now === "Approved" || now === "Rejected") {
          /* Already decided on the tab, by hand, by an earlier drain, or by
             a push whose answer never came back. The sheet wins: somebody
             looking at the rota decided this, and a queued answer from an
             inbox must not overrule them. */
          return true;
        }

        /* THE COVER, WRITTEN BEFORE THE STATUS.

         onEditRequests reads the Replacement cell to decide what approving
         MEANS: with a name it writes that name into the Sunday and marks
         the morning Covered; without one it marks it No driver assigned.

         The order here is habit and not a requirement, and it is worth
         saying which: both cells are set before the handler is called on
         the line below, and the handler reads the tab rather than the
         event, so it sees the pair whichever went down first. It matters
         for a PERSON typing into the tab — status first fires the trigger
         against an empty Replacement — and that path corrects itself when
         the name lands. This one is simply written the way a person would.

         Only ever a name the live server has already checked against the
         register. Nothing here trusts the page. */
        if (d.cover && d.choice === "Approved" && rq.replacement) {
          rsh.getRange(row, rq.replacement).setValue(d.cover);
        }
        rsh.getRange(row, rq.status).setValue(d.choice);
        /* Flushed before the lock goes, or the next caller in can read a
           cell this one has only promised to write. */
        SpreadsheetApp.flush();
      } finally {
        try { lock.releaseLock(); } catch (err) {}
      }

      /* BOTH HALVES OF A HUMAN EDIT, IN ORDER.

         A person changing this cell by hand sets two installed triggers
         going: onEditRequests, which writes the Rota, and onRotaEditNotify,
         which tells the drivers. An Apps Script write fires neither, so both
         have to be called here by name.

         Only the first one was. The rota came out right and nobody was told
         — so approving a cover from the email sent no emails while the same
         decision made on this tab sent two. One decision, two different
         outcomes, and nothing on screen to show which you had just had.

         ORDER MATTERS AND IT IS THIS ONE. The notice names the bus and the
         route, both read off the Rota row, so the Rota has to be written
         before anybody is told what is on it.

         FENCED SEPARATELY. A mail quota is not a reason to leave a decision
         unapplied, and an unapplied decision is not a reason to withhold the
         email. Either can fail on its own and the token is still spent:
         running the whole thing again would write a rota that is already
         right and send a second copy of an email already sent. */
      try { onEditRequests({ range: rsh.getRange(row, rq.status) }, rsh); }
      catch (err) {
        try { PropertiesService.getScriptProperties()
                .setProperty("liveError", "rota decision: " +
                  String(err && err.message || err)); } catch (e2) {}
      }
      try { onRotaEditNotify({ range: rsh.getRange(row, rq.status) }); }
      catch (err2) {
        try { PropertiesService.getScriptProperties()
                .setProperty("liveError", "rota decision notice: " +
                  String(err2 && err2.message || err2)); } catch (e3) {}
      }
      /* WHO DECIDED, ON THE CELL, written after the rota rather than before
         it. onEditRequests clears the note on a swap it has applied and
         writes its reason there on one it could not, so a note written first
         was wiped by one and overwritten by the other. Only when the cell
         still holds the decision: a swap put back to Pending keeps the
         reason, which is the thing somebody needs to read. */
      if (d.by) {
        try {
          if (String(rsh.getRange(row, rq.status).getValue() || "").trim() === d.choice) {
            rsh.getRange(row, rq.status).setNote(
              (d.via === "app" ? "Decided in the coordinator's app by " : "Decided from the email link by ") +
              d.by +
              (d.at ? " on " + Utilities.formatDate(new Date(Number(d.at)),
                        Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm") : "") +
              (d.cover ? ", cover " + d.cover : "") + ".");
          }
        } catch (err3) {}
      }
  return true;
}

/* ==========================================================================
   THE COORDINATOR'S APP
   ==========================================================================
   From v1.82.0 the coordinator makes his changes on his phone: who drives or
   covers, which bus, a route called off or put back, a note, a request
   decided, a booking cancelled or made for somebody, a defect closed, a run
   time put right. The live server takes each one under his PIN and answers
   him at once. The drain brings it here.

   ONE WRITER, ONE CODE PATH, the same rule as the email decisions. A change
   to the rota writes the cell and then calls onEditRota and onRotaEditNotify
   with it, which is what a person typing into that cell sets going: the
   status rule, the stamp, the version, and the emails to the drivers. A
   request is decided by applyRotaDecision, the function the email link uses.
   A defect is written and then onEditDefects fills Closed on. A booking or a
   run time is the live server's own row and arrives on the ordinary drain;
   the change is confirmed once that row is on its tab.

   ONCE ONLY. Each change applied is noted, with its id, in a script property.
   A drain that runs twice over the same change (its answer lost on the way
   back) finds it there and does not write it again: a note is not added
   twice and nobody is emailed twice. The same list goes out with every push,
   and that is how the live server knows its copy now includes the change. */

var COORD_APPLIED_KEY = "coordApplied";
var COORD_APPLIED_KEEP = 120;          /* about six kilobytes; a property holds nine */
var COORD_APPLIED_DAYS = 3;
/* How long a decided request stays on the app's list, so the coordinator can
   see what he did last week. Pending ones stay until their Sunday passes. */
var COORD_REQUEST_DAYS = 14;

function coordAppliedRead() {
  try {
    var v = JSON.parse(PropertiesService.getScriptProperties().getProperty(COORD_APPLIED_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (err) { return []; }
}

/* [id, 1 applied or 0 refused, when] */
function coordAppliedNote(list) {
  var cut = Date.now() - COORD_APPLIED_DAYS * 86400000;
  var by = {};
  coordAppliedRead().concat(list || []).forEach(function (e) {
    if (!e || !e[0] || Number(e[2]) < cut) return;
    by[String(e[0])] = e;
  });
  var out = Object.keys(by).map(function (k) { return by[k]; })
    .sort(function (a, b) { return Number(a[2]) - Number(b[2]); });
  if (out.length > COORD_APPLIED_KEEP) out = out.slice(out.length - COORD_APPLIED_KEEP);
  try { PropertiesService.getScriptProperties().setProperty(COORD_APPLIED_KEY, JSON.stringify(out)); }
  catch (err) {}
}

function coordAppliedFind(id) {
  var list = coordAppliedRead();
  for (var i = 0; i < list.length; i++) if (String(list[i][0]) === String(id)) return list[i];
  return null;
}

/* One defect, one key. The live server works it out the same way
   (defectKeyOf in worker.js), so the two can name the same row. */
function defectKey(r, dc) {
  return [String(at1(r, dc.id) || "").trim(),
          String(at1(r, dc.reg) || "").trim().toUpperCase(),
          String(at1(r, dc.item) || "").trim(),
          anyToKey(at1(r, dc.date))].join("|");
}

/* What the coordinator's app reads that the public rota does not carry: the
   requests with their reasons, and the open defects with what has been done
   so far. Sent with every push and only ever handed out under a PIN. */
function coordRequestsList(ss) {
  var sh = ss.getSheetByName(REQUESTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var rq = requestCols(sh);
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var today = dateToKey(sundayOf(new Date()));
  var since = Date.now() - COORD_REQUEST_DAYS * 86400000;
  var out = [];
  vals.forEach(function (r) {
    var id = String(r[rq.id - 1] || "").trim();
    var key = anyToKey(r[rq.sunday - 1]);
    if (!id || !key) return;
    var st = String(r[rq.status - 1] || "").trim() || "Pending";
    var dec = r[rq.decidedOn - 1];
    var decAt = isDateLike(dec) ? dec.getTime() : 0;
    if (st === "Pending") { if (key < today) return; }
    else if (st === "Approved" || st === "Rejected") { if (!(decAt >= since)) return; }
    else return;
    var rec = r[rq.received - 1];
    out.push({
      id: id, sunday: key,
      driver: String(r[rq.driver - 1] || "").trim(),
      type: String(r[rq.type - 1] || "").trim(),
      reason: String(r[rq.reason - 1] || ""),
      swapWith: String(r[rq.swapWith - 1] || "").trim(),
      theirSunday: anyToKey(r[rq.theirSunday - 1]),
      bothAgreed: String(r[rq.bothAgreed - 1] || "").trim(),
      status: st,
      received: isDateLike(rec) ? rec.getTime() : 0,
      decidedOn: decAt,
      replacement: String(r[rq.replacement - 1] || "").trim()
    });
  });
  return out.length > 80 ? out.slice(out.length - 80) : out;
}

function coordDefectsList(ss) {
  var sh = ss.getSheetByName(DEFECTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var dc = colsSoft(sh, DEFECTS_SHEET);
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var out = [];
  vals.forEach(function (r) {
    var status = String(at1(r, dc.status) || "").trim() || "Open";
    if (status === "Fixed" || status === "Not a defect") return;
    var reg = String(at1(r, dc.reg) || "").trim();
    if (!reg) return;
    var rec = at1(r, dc.received);
    out.push({
      key: defectKey(r, dc),
      checkId: String(at1(r, dc.id) || "").trim(),
      reg: reg,
      date: anyToKey(at1(r, dc.date)),
      driver: String(at1(r, dc.driver) || "").trim(),
      item: String(at1(r, dc.item) || "").trim(),
      crit: String(at1(r, dc.critical) || "") === "YES",
      found: String(at1(r, dc.found) || ""),
      status: status,
      action: String(at1(r, dc.action) || ""),
      kind: String(at1(r, dc.kind) || "").trim() === "Advisory" ? "Advisory" : "Defect",
      received: isDateLike(rec) ? rec.getTime() : 0
    });
  });
  return out;
}

/* ---- applying one change ------------------------------------------------ */

/* { done, ok, result, push }. done false leaves it with the live server for
   the next drain: somebody else is writing that row, or the booking it is
   about has not reached its tab yet. */
function applyCoordAction(ss, a, ctx) {
  var b = (a && a.body) || {};
  var by = String((a && a.by) || "").trim() || "Coordinator";
  var id = String((a && a.id) || "");
  var had = coordAppliedFind(id);
  if (had) {
    return { done: true, ok: Number(had[1]) !== 0, again: true, push: true,
             result: Number(had[1]) !== 0 ? "On the sheet." : "The sheet did not take it." };
  }
  var kind = String((a && a.kind) || "");
  if (kind === "rota") return coordRota(ss, a, b, by);
  if (kind === "decide") return coordDecide(ss, a, b, by, ctx || {});
  if (kind === "defect") return coordDefect(ss, a, b, by);
  if (kind === "booking") {
    return coordOnTab(ss, BOOKINGS_SHEET, b.bookingId, a, ctx || {},
                      "On the Bus Bookings tab.", "That booking is not on the Bus Bookings tab.");
  }
  if (kind === "fix") {
    return coordOnTab(ss, TRIP_SHEET, b.eventId, a, ctx || {},
                      "On the Trip Events tab.", "That time is not on the Trip Events tab.");
  }
  /* See REHEARSAL. The live server has done the work; this keeps the copy of
     the flag and takes the rows off the tabs. */
  if (kind === "rehearsal") return coordRehearsal(ss, a, b);
  return { done: true, ok: false, result: "This copy of the spreadsheet does not know that kind of change." };
}

function coordRota(ss, a, b, by) {
  var sh = ss.getSheetByName(ROTA_SHEET);
  if (!sh) return { done: true, ok: false, push: true, result: "There is no Rota tab." };
  var key = anyToKey(b.sunday);
  if (!key) return { done: true, ok: false, push: true, result: "No Sunday was named." };
  if (keyToDate(key) < sundayOf(new Date())) {
    return { done: true, ok: false, push: true,
             result: "That Sunday has been and gone, so the Rota tab was left as it is." };
  }
  var row = findRotaRow(sh, key) || appendRotaRow(ss, sh, keyToDate(key));
  var rc = rotaCols(sh);
  var cols = { north: rc.north, northCover: rc.northCover, south: rc.south, southCover: rc.southCover,
               northBus: rc.northBus, southBus: rc.southBus, status: rc.status };
  var set = b.set || {};
  var did = 0;
  /* In this order, one cell at a time, each followed by what its edit would
     have set going. The status goes last, so a status set on purpose is not
     undone by the rule that runs after a driver cell. */
  ["north", "northCover", "south", "southCover", "northBus", "southBus", "status"].forEach(function (f) {
    if (!Object.prototype.hasOwnProperty.call(set, f) || !cols[f]) return;
    var cell = sh.getRange(row, cols[f]);
    var was = String(cell.getValue() == null ? "" : cell.getValue()).trim();
    var now = String(set[f] == null ? "" : set[f]).trim();
    cell.setValue(safeText(now));
    did++;
    onEditRota({ range: cell, oldValue: was, value: now }, sh);
    if (f === "north" || f === "northCover" || f === "south" || f === "southCover") {
      /* Fenced: a mail quota is not a reason to leave the rota half written. */
      try { onRotaEditNotify({ range: cell, oldValue: was, value: now }); } catch (err) {}
    }
  });
  var note = String(b.note || "").trim();
  if (note) {
    var lines = String(sh.getRange(row, rc.notes).getValue() || "").split("\n")
      .map(function (x) { return x.trim(); });
    if (lines.indexOf(note) === -1) appendNote(sh, row, safeText(note));
    onEditRota({ range: sh.getRange(row, rc.notes) }, sh);
    did++;
  }
  if (!did) return { done: true, ok: false, push: true, result: "There was nothing to change." };
  stamp(sh, row, by + " (app)");
  bumpRotaVersion();
  return { done: true, ok: true, push: true, result: "On the Rota tab." };
}

function coordDecide(ss, a, b, by, ctx) {
  var id = String(b.requestId || "").trim();
  var rsh = ss.getSheetByName(REQUESTS_SHEET);
  if (!rsh || !id) return { done: true, ok: false, push: true, result: "That request is not on the Rota Requests tab." };
  var rq = requestCols(rsh);
  var row = 0;
  if (rsh.getLastRow() >= 2) {
    var ids = rsh.getRange(2, rq.id, rsh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0] || "").trim() === id) { row = i + 2; break; }
    }
  }
  if (!row) {
    /* A request the live server took and this sheet has not filed yet: it
       failed to file in this same drain, or has not come round. Left for the
       next one, for an hour. */
    if (ctx.requestsWaiting && ctx.requestsWaiting[id]) return { done: false };
    if (Date.now() - (Number(a.made) || 0) < 3600000) return { done: false };
    return { done: true, ok: false, push: true, result: "That request is not on the Rota Requests tab." };
  }
  var now = String(rsh.getRange(row, rq.status).getValue() || "").trim();
  if (now === "Approved" || now === "Rejected") {
    return { done: true, ok: now === b.choice, push: true,
             result: "Already " + (now === "Approved" ? "approved" : "turned down") + " on the sheet." };
  }
  var took = applyRotaDecision(ss, { id: id, choice: b.choice, cover: b.cover || "", by: by,
                                     at: Number(a.made) || Date.now(), via: "app" }, rsh, rq);
  if (!took) return { done: false };
  var after = String(rsh.getRange(row, rq.status).getValue() || "").trim();
  if (after !== b.choice) {
    /* A swap that could not be applied: onEditRequests put it back to
       Pending and wrote why on the cell. */
    var why = "";
    try { why = String(rsh.getRange(row, rq.status).getNote() || ""); } catch (err) {}
    return { done: true, ok: false, push: true, result: why || "The sheet could not apply it." };
  }
  return { done: true, ok: true, push: true,
           result: after === "Approved" ? "Approved on the sheet." : "Turned down on the sheet." };
}

function coordDefect(ss, a, b, by) {
  var sh = ss.getSheetByName(DEFECTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return { done: true, ok: false, push: true, result: "That defect is not on the Defects tab." };
  var dc = colsSoft(sh, DEFECTS_SHEET);
  if (!dc.status) return { done: true, ok: false, push: true, result: "The Defects tab has no Status column." };
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var row = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    if (defectKey(vals[i], dc) === String(b.key || "")) { row = i + 2; break; }
  }
  if (!row) return { done: true, ok: false, push: true, result: "That defect is not on the Defects tab any more." };
  var cell = sh.getRange(row, dc.status);
  var was = String(cell.getValue() || "").trim();
  var closedAlready = was === "Fixed" || was === "Not a defect";
  var closing = b.status === "Fixed" || b.status === "Not a defect";
  if (closedAlready && closing) return { done: true, ok: true, push: true, result: "Already closed on the sheet." };
  var action = String(b.action || "").trim();
  if (action && dc.action) {
    var ac = sh.getRange(row, dc.action);
    var had = String(ac.getValue() || "").trim();
    var lines = had.split("\n").map(function (x) { return x.trim(); });
    if (lines.indexOf(action) === -1) ac.setValue(safeText(had ? had + "\n" + action : action));
  }
  cell.setValue(String(b.status || "Open"));
  try {
    cell.setNote("Set to " + b.status + " in the coordinator's app by " + by + " on " +
      Utilities.formatDate(new Date(Number(a.made) || Date.now()), Session.getScriptTimeZone(),
                           "yyyy-MM-dd HH:mm") + ".");
  } catch (err) {}
  /* Closed on, filled or cleared, exactly as for a person choosing it. */
  onEditDefects({ range: cell }, sh);
  bumpRotaVersion();
  return { done: true, ok: true, push: true, result: "On the Defects tab." };
}

/* A booking or a run time: the live server's own row, which the drain has
   just written or wrote earlier. Confirmed once its Live ID is on the tab. */
function coordOnTab(ss, tabName, liveId, a, ctx, yes, no) {
  var id = String(liveId == null ? "" : liveId).trim();
  if (!id) return { done: true, ok: false, result: no };
  ctx.liveIds = ctx.liveIds || {};
  if (!ctx.liveIds[tabName]) {
    var sh = ss.getSheetByName(tabName);
    var map = {};
    if (sh) {
      var c = colsSoft(sh, tabName);
      if (c.liveId) map = liveIdMap(sh, c.liveId);
    }
    ctx.liveIds[tabName] = map;
  }
  if (ctx.liveIds[tabName][id]) return { done: true, ok: true, result: yes };
  /* Not yet. The row goes out on the drain alongside this; a day is well
     past any drain that is going to bring it. */
  if (Date.now() - (Number(a.made) || 0) > 86400000) return { done: true, ok: false, result: no };
  return { done: false };
}

/* ---- the reports the app asks this sheet for ------------------------------

   The same two the Minibus menu has always shown, built by the same code.
   The menu items call these and show the words in a box; the app is sent
   the parts and lays them out itself. */
function coverReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rows = readRotaRows(ss);
  if (!rows.length) {
    return { title: "Who is carrying the load", lead: "No rota rows yet.", sections: [], text: "No rota rows yet." };
  }
  var today = sundayOf(new Date());
  var past = rows.filter(function (r) { return keyToDate(r.date) < today; })
                 .sort(function (a, b) { return a.date < b.date ? 1 : -1; })
                 .slice(0, 26);
  if (!past.length) {
    var none = "No Sundays have been and gone yet, so there is nothing to count.";
    return { title: "Who is carrying the load", lead: none, sections: [], text: none };
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
    ? "Carrying the most: " + owed.join(", ") +
      ".\nEach has covered at least two more Sundays than they have been covered."
    : "Nobody is more than one cover out of step.";

  return {
    title: "Who is carrying the load",
    lead: "The last " + past.length + " Sundays.",
    sections: [{ head: "Drove, covered for others, was covered, swaps",
                 lines: names.map(function (n) {
                   var v = t[n];
                   return n + ": drove " + v.drove + ", covered " + v.gave + ", was covered " +
                          v.got + ", swaps " + v.swapped;
                 }) }],
    foot: tail,
    tone: owed.length ? "todo" : "good",
    text: "Last " + past.length + " Sundays\n\n" + lines.join("\n\n") + "\n\n" + tail
  };
}

function drainFromWorker() {
  var got = workerCall("drain", { limit: 300 });
  if (!got || got.ok !== true) {
    try { PropertiesService.getScriptProperties()
            .setProperty("liveError", String((got && got.error) || "drain failed")); } catch (e) {}
    return { bookings: 0, trips: 0 };
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var doneB = [], doneT = [];

  /* ---- bookings ---- */
  try {
    var rows = got.bookings || [];
    if (rows.length) {
      var sh = ensureBookings(ss);
      var bc = colsHard(sh, BOOKINGS_SHEET);
      var wide = Math.max(sh.getLastColumn(), BOOKINGS_HEADERS.length);
      var seen = liveIdMap(sh, bc.liveId);
      var fresh = [], freshIds = [];

      rows.forEach(function (b) {
        var id = String(b.id);
        var vals = {
          received: b.received ? new Date(Number(b.received)) : new Date(),
          sunday: b.sunday, route: b.route, stopId: b.stop_id, stop: b.stop,
          seats: Number(b.seats) || 0, device: b.device || "",
          status: b.status || "Booked",
          /* The apostrophe keeps the leading zero, same as every other write
             to this column in this file. */
          phone: b.phone ? "'" + String(b.phone).replace(/^'/, "") : "",
          passenger: b.pid || ""
        };

        if (seen[id]) {
          var base = sh.getRange(seen[id], 1, 1, wide).getValues()[0];
          var row = bookingRow(bc, wide, vals, base);
          if (bc.liveId) row[bc.liveId - 1] = id;
          sh.getRange(seen[id], 1, 1, wide).setValues([row]);
          /* The late-withdrawal note, put back where a person will see it. */
          if (b.note && bc.status) {
            try { sh.getRange(seen[id], bc.status).setNote(b.note); } catch (e) {}
          }
          doneB.push(b.id);
        } else {
          var add = bookingRow(bc, wide, vals);
          if (bc.liveId) add[bc.liveId - 1] = id;
          fresh.push(add);
          freshIds.push(b.id);
        }
      });

      /* A new row is reported as filed only once it is on the tab. These ids
         went into the list before the append, so an append that threw was
         still confirmed to the live server and the rows were never sent
         again. */
      if (fresh.length) {
        sh.getRange(sh.getLastRow() + 1, 1, fresh.length, wide).setValues(fresh);
        doneB = doneB.concat(freshIds);
      }
      dropCountsCache(dateToKey(sundayOf(new Date())));
      memoDrop("bookings");
    }
  } catch (err) {
    try { PropertiesService.getScriptProperties()
            .setProperty("liveError", "bookings: " + String(err && err.message || err)); } catch (e) {}
  }

  /* ---- trip events ---- */
  try {
    var trips = got.trips || [];
    if (trips.length) {
      var tsh = ensureTripEvents(ss);
      var tc = colsHard(tsh, TRIP_SHEET);
      var twide = Math.max(tsh.getLastColumn(), TRIP_HEADERS.length);
      var tseen = liveIdMap(tsh, tc.liveId);
      var tfresh = [], tfreshIds = [], tfreshNotes = [];

      trips.forEach(function (t) {
        var id = String(t.id);
        /* Laid over the row as it stands, for the same reason as bookings:
           a column the coordinator added keeps its value. */
        var row = tseen[id] ? tsh.getRange(tseen[id], 1, 1, twide).getValues()[0] : [];
        for (var i = row.length; i < twide; i++) row.push("");
        var put = function (col, v) { if (col) row[col - 1] = v; };

        put(tc.logged,    t.logged ? new Date(Number(t.logged)) : new Date());
        put(tc.trip,      safeText(t.trip));
        put(tc.sunday,    t.sunday);
        put(tc.route,     safeText(t.route));
        put(tc.driver,    safeText(t.driver));
        put(tc.event,     safeText(t.event));
        put(tc.stopId,    safeText(t.stop_id));
        put(tc.stop,      t.stop || "");
        /* Rebuilt as a real moment from the Sunday and the timetable time, so
           the column holds what it has always held rather than a string. */
        put(tc.scheduled, t.scheduled ? (stopMomentOn(t.sunday, t.scheduled) || t.scheduled) : "");
        put(tc.happened,  t.happened ? new Date(Number(t.happened)) : "");
        put(tc.offset,    (t.off_min === null || t.off_min === undefined) ? "" : Number(t.off_min));
        put(tc.status,    safeText(t.status));
        put(tc.reg,       safeText(t.reg));
        put(tc.rotaBus,   safeText(t.rota_bus));
        put(tc.where,     safeText(t.geo));
        put(tc.acc,       (t.acc === null || t.acc === undefined) ? "" : Number(t.acc));
        put(tc.away,      (t.away === null || t.away === undefined) ? "" : Number(t.away));
        /* Only ever set on an end row. Blank everywhere else, which is the
           honest answer: no other row was ended by anybody. */
        put(tc.endedBy,   safeText(t.ended_by));
        put(tc.liveId,    id);

        if (tseen[id]) {
          tsh.getRange(tseen[id], 1, 1, twide).setValues([row]);
          /* A time put right in the coordinator's app says so on the cell. */
          if (t.fix_note && tc.happened) {
            try { tsh.getRange(tseen[id], tc.happened).setNote(String(t.fix_note)); } catch (e) {}
          }
          doneT.push(t.id);
        } else {
          tfresh.push(row);
          tfreshIds.push(t.id);
          tfreshNotes.push(String(t.fix_note || ""));
        }
      });

      /* Reported only once appended. See the bookings above. */
      if (tfresh.length) {
        var tfirst = tsh.getLastRow() + 1;
        tsh.getRange(tfirst, 1, tfresh.length, twide).setValues(tfresh);
        doneT = doneT.concat(tfreshIds);
        tfreshNotes.forEach(function (n, i) {
          if (n && tc.happened) { try { tsh.getRange(tfirst + i, tc.happened).setNote(n); } catch (e) {} }
        });
      }
    }
  } catch (err) {
    try { PropertiesService.getScriptProperties()
            .setProperty("liveError", "trips: " + String(err && err.message || err)); } catch (e) {}
  }

  /* ---- walkarounds ----

     New in v1.62.0. The check is posted to the live server now, so this is
     how it reaches the tab. handleCheck is the same function the direct post
     has always used, so the row, the defect rows, the advisory rows and the
     email are identical whichever way a check arrived, and its own duplicate
     guard means a check that also came in directly is written once.

     Fenced and taken one at a time: a check that throws must not cost the
     ones behind it, and it stays unmarked so it comes round again. */
  var doneK = [];
  try {
    (got.checks || []).forEach(function (c) {
      if (!c || !c.__row) return;
      var row = c.__row;
      try {
        delete c.__row;
        /* Only marked done when the tab has it, which includes finding it
           already there. A busy lock leaves it on the shelf for next time. */
        var got2 = JSON.parse(handleCheck(c).getContent());
        if (got2 && got2.ok === true) doneK.push(row);
      } catch (err) {
        try { PropertiesService.getScriptProperties()
                .setProperty("liveError", "check " + String(c.id || "") + ": " +
                             String(err && err.message || err)); } catch (e) {}
      }
    });
  } catch (err) {
    try { PropertiesService.getScriptProperties()
            .setProperty("liveError", "checks: " + String(err && err.message || err)); } catch (e) {}
  }

  /* ---- authorisations made on a handset ----

     After the checks, on purpose: the row an authorisation belongs to may
     have arrived in this same drain. One whose row is not on the tab yet is
     left unfiled and comes round on the next drain rather than being lost.

     A script writing a cell does not fire the edit trigger, so filing one
     here cannot bounce it straight back to the live server. */
  var doneA = [];
  try {
    var auths = got.auths || [];
    if (auths.length) {
      var ksh = ss.getSheetByName(CHECKS_SHEET);
      var kcc = ksh ? colsSoft(ksh, CHECKS_SHEET) : {};
      auths.forEach(function (a) {
        /* On the row of the check it lifted, found by its Check ID. The
           newest row for the bus is only a guess when there is no id: a
           second walkaround filed in between would otherwise have been
           marked as authorised when nobody authorised it. */
        var row = !ksh ? 0
                : a.checkId ? checkRowById(ksh, kcc, a.checkId)
                : todaysCheckRow(ksh, kcc, a.reg);
        if (!row) return;
        if (kcc.outcome) ksh.getRange(row, kcc.outcome).setValue("Authorised to run");
        if (kcc.authBy)  ksh.getRange(row, kcc.authBy).setValue(safeText(a.by || ""));
        if (kcc.authOn)  ksh.getRange(row, kcc.authOn)
                           .setValue(new Date(Number(a.at) || Date.now()))
                           .setNumberFormat("dd/mm/yyyy hh:mm");
        a.via = "app";
        notifyAuthorised(a);
        doneA.push({ key: a.key, at: a.at });
      });
    }
  } catch (err) {
    try { PropertiesService.getScriptProperties()
            .setProperty("liveError", "auths: " + String(err && err.message || err)); } catch (e) {}
  }

  /* ---- rota requests taken on the live server ----

     From v1.81.0 a driver's request lands there first and is filed here by
     the same function a direct post has always used, so the row, the status
     and the email are identical. Marked done when the tab has it, which
     includes finding it already there. The two refusals that can never
     succeed are marked done too, or they would come round for ever. */
  var doneR = [], filedR = 0;
  try {
    (got.requests || []).forEach(function (rq) {
      if (!rq || !rq.id) return;
      try {
        var outR = JSON.parse(handleRotaRequest(rq).getContent());
        if (outR && outR.ok === true) {
          doneR.push(String(rq.id));
          if (!outR.duplicate) filedR++;
        } else if (outR && /incomplete request|already passed/.test(String(outR.error || ""))) {
          doneR.push(String(rq.id));
        }
      } catch (err) {
        try { PropertiesService.getScriptProperties()
                .setProperty("liveError", "request " + String(rq.id || "") + ": " +
                             String(err && err.message || err)); } catch (e) {}
      }
    });
  } catch (err) {}

  /* Fenced off on its own. The record is what this call is for, and a fault
     filling a convenience column must never cost a morning's stop taps. */
  try {
    fillCoverFromRuns(ss, got.trips || []);
  } catch (err) {
    try { PropertiesService.getScriptProperties()
            .setProperty("liveError", "cover: " + String(err && err.message || err)); } catch (e) {}
  }

  /* ---- ROTA DECISIONS MADE FROM AN EMAIL --------------------------------

     The page the coordinator opened recorded his answer on the live server.
     This is where it reaches the spreadsheet, and the important part is HOW:
     the Status cell is written and then onEditRequests is called with that
     cell, which is the very function an installed edit trigger would call if
     a person had typed it.

     One writer, one code path. Approving a swap moves two Sundays, refuses a
     protected one, and picks its route from the requester — all of that lives
     in onEditRequests and none of it is reimplemented here. A second
     implementation of "what approving means" is exactly the thing that would
     quietly diverge and put a stranger against the North slot.

     Apps Script's own writes do NOT fire an installed edit trigger, which is
     why the call is explicit rather than hoped for. */
  var doneD = [];
  var decisions = (got && got.decisions) || [];
  if (decisions.length) {
    pretty("Rota decisions made from an email", function () {
      var rsh = ss.getSheetByName(REQUESTS_SHEET);
      if (!rsh || rsh.getLastRow() < 2) return;
      var rq = requestCols(rsh);
      var ids = rsh.getRange(2, rq.id, rsh.getLastRow() - 1, 1).getValues();

      decisions.forEach(function (d) {
        /* One body for both ways in: see applyRotaDecision. */
        if (applyRotaDecision(ss, d, rsh, rq)) doneD.push(d.token);
      });
    });
  }

  /* ---- THE COORDINATOR'S CHANGES ------------------------------------------

     Last, on purpose: a booking or a run time he changed is on its tab by
     now, and a request he decided has been filed above if it was only just
     taken. See THE COORDINATOR'S APP. One that throws is left with the live
     server for the next drain, and does not cost the ones behind it. */
  var doneC = [], coordPush = false, noted = [];
  var coordActs = (got && got.coord) || [];
  if (coordActs.length) {
    var reqWaiting = {};
    (got.requests || []).forEach(function (rq) {
      if (rq && rq.id && doneR.indexOf(String(rq.id)) === -1) reqWaiting[String(rq.id)] = true;
    });
    var cctx = { requestsWaiting: reqWaiting };
    coordActs.forEach(function (a) {
      var res = null;
      try { res = applyCoordAction(ss, a, cctx); }
      catch (err) {
        res = null;
        try { PropertiesService.getScriptProperties()
                .setProperty("liveError", "coordinator change " + String(a && a.id || "") + ": " +
                             String(err && err.message || err)); } catch (e) {}
      }
      if (!res || !res.done) return;
      doneC.push({ id: String(a.id), ok: res.ok !== false, result: String(res.result || "") });
      if (!res.again) noted.push([String(a.id), res.ok === false ? 0 : 1, Date.now()]);
      if (res.push) coordPush = true;
    });
    if (noted.length) { SpreadsheetApp.flush(); coordAppliedNote(noted); }
  }

  /* Marked done ONLY after they are on the tab. If this call never lands the
     rows come round again and match on their Live ID, so the worst case is
     writing the same row twice over itself — never losing one. */
  if (doneB.length || doneT.length || doneK.length || doneA.length || doneD.length || doneR.length ||
      doneC.length) {
    SpreadsheetApp.flush();
    /* THE STAMP GOES BACK WITH THE IDS. The live server marks a row done only
       if it has not changed since this drain copied it, which is what keeps a
       cancellation made while this was writing (Sedley Street, 27 September)
       from being marked done on the strength of the Booked copy.

       An older live server sends no stamp, and is sent bare keys for the
       authorisations, which is the only shape it understands. */
    var stamped = typeof got.claim === "number";
    workerCall("drained", { claim: stamped ? got.claim : undefined,
                            bookings: doneB, trips: doneT, checks: doneK, requests: doneR,
                            coord: doneC,
                            auths: stamped ? doneA : doneA.map(function (x) { return x.key; }),
                            decisions: doneD });
    try { PropertiesService.getScriptProperties()
            .setProperty("liveDrainedAt", String(Date.now())); } catch (e) {}
  }
  /* A request changes what the rota screen shows, and the live server's copy
     of that screen is built here. Pushed now so every phone sees the Sunday
     marked, in step with the request row. */
  /* A change from the coordinator's app to the rota, a request or a defect
     is on the tab now, and the live server's copy is built here. Pushed so
     its copy includes it, and so a change the sheet refused stops showing. */
  if (filedR || coordPush) { try { pushNow(); } catch (err) {} }

  return { bookings: doneB.length, trips: doneT.length, checks: doneK.length,
           auths: doneA.length, requests: doneR.length, coord: doneC.length };
}

/* The row holding this Check ID, looking back over the recent end of the
   tab, or 0. */
function checkRowById(sh, c, id) {
  if (!sh || !c.id || !id || sh.getLastRow() < 2) return 0;
  var last = sh.getLastRow();
  var first = Math.max(2, last - 200);
  var vals = sh.getRange(first, c.id, last - first + 1, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0] || "") === String(id)) return first + i;
  }
  return 0;
}

/* The newest row on the Checks tab for this bus today, or 0. Walks up from the
   bottom because today's rows are at the bottom, and stops at the first one
   that is older than today: this is asked about one Sunday morning. */
function todaysCheckRow(sh, c, reg) {
  if (!sh || !c.reg || sh.getLastRow() < 2) return 0;
  var want = String(reg || "").trim().toUpperCase();
  var today = dateToKey(new Date());
  var last = sh.getLastRow();
  var first = Math.max(2, last - 60);
  var vals = sh.getRange(first, 1, last - first + 1, sh.getLastColumn()).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    var r = vals[i];
    var when = checkMoment(at1(r, c.received), at1(r, c.date), at1(r, c.time));
    if (!when) continue;
    var k = dateToKey(new Date(when));   /* milliseconds, not a Date */
    if (k < today) break;
    if (k !== today) continue;
    if (String(at1(r, c.reg) || "").trim().toUpperCase() === want) return first + i;
  }
  return 0;
}

/* ---- filling the cover column from what actually happened ---------------

   A run started by somebody the rota does not name arrives here with "Cover"
   in its status. Until now that was the end of it: the row landed on Trip
   Events, the Rota's actual / cover column stayed blank, and somebody had to
   notice and type the name in. Nobody noticed. That is exactly the gap that
   started this: a driver covering, a column never filled, and an app that
   would not give him a Start trip because of it.

   FILLED ONLY WHEN THE CELL IS BLANK, and that is the rule that matters.

   A name a person typed is a decision. An observation is not. If the
   coordinator wrote Bro Martin and Bro Cedric actually drove, the useful fact
   is that the two disagree, and an app that quietly rewrote the column to
   match itself would destroy the only evidence of it. So a filled cell is
   never touched, whoever filled it and whoever drove. The disagreement stays
   visible: the Rota says one name, Trip Events says another, and a person
   decides which is right.

   Nothing here creates a rota row. A Sunday with no row is a Sunday nobody
   planned, and inventing one from a bus that went out would put a fabricated
   plan into the record. */
function fillCoverFromRuns(ss, trips) {
  var want = {};
  (trips || []).forEach(function (t) {
    if (String(t.event || "").trim().toLowerCase() !== "start") return;

    var st = String(t.status || "");
    var low = st.toLowerCase();
    /* Rehearsal runs are not real and Undone ones were taken back. Neither is
       evidence of anybody driving anywhere. */
    if (low.indexOf("rehearsal") >= 0 || low.indexOf("undone") >= 0) return;
    if (st.indexOf("Cover") < 0) return;

    var key = anyToKey(t.sunday);
    var who = String(t.driver || "").trim();
    var rt  = String(t.route || "").trim();
    if (!key || !who || !rt) return;

    if (!want[key]) want[key] = {};
    /* Last start on a route wins. A route can only have one open run at a
       time, so a second start means the first was undone or reopened, and the
       later one is the truer answer. */
    want[key][rt] = who;
  });

  var keys = Object.keys(want);
  if (!keys.length) return 0;

  var sh = ss.getSheetByName(ROTA_SHEET);
  if (!sh) return 0;
  var c = rotaCols(sh);
  var filled = 0;

  keys.forEach(function (key) {
    var row = findRotaRow(sh, key);
    if (!row) return;

    Object.keys(want[key]).forEach(function (rt) {
      /* Named explicitly. A ternary defaulting to North would put a third
         route, or a typo in the Bus Stops tab, into the North column. */
      var col = (rt === "North") ? c.northCover
              : (rt === "South") ? c.southCover
              : 0;
      if (!col) return;

      var cell = sh.getRange(row, col);
      if (String(cell.getValue() || "").trim()) return;   /* a decision. leave it */

      cell.setValue(want[key][rt]);
      stamp(sh, row, "App");
      filled++;
    });
  });

  /* So the live server's copy of the rota picks the name up, which is what
     makes the app stop refusing him next week. */
  if (filled) bumpRotaVersion();
  return filled;
}

/* ---- the timer --------------------------------------------------------- */

/* Push only when something has actually changed, pull every time.

   rotaVersion is already bumped by every write this file makes to the rota,
   the drivers or the defects, so it is a ready-made "has anything the live
   server cares about moved" flag. Nothing else needs to be watched, and no
   onEdit trigger is involved — a simple trigger is not allowed to reach the
   internet anyway, which is exactly the trap this avoids. */
/* The published address of this web app, or "" if there isn't one to give.

   Guarded rather than trusted: getService() throws for a script that has
   never been deployed, and answers with a /dev URL when this is running from
   the editor rather than from the trigger. Neither is any use to the live
   server, and neither is worth failing a sync over. */
function sheetReturnUrl() {
  /* WEB_APP_URL in Script Properties wins, from v1.86.0. getUrl() is Google's
     idea of this script's address, and in a project with more than one
     deployment it can name one that is not the live one, which leaves the
     live server knocking on a door nobody answers. Copy the Web app URL from
     Deploy, Manage deployments into WEB_APP_URL and that is the address sent. */
  try {
    var set = String(PropertiesService.getScriptProperties().getProperty("WEB_APP_URL") || "").trim();
    if (/^https:\/\/script\.google\.com\/.+\/exec$/.test(set)) return set;
  } catch (err) {}
  try {
    var u = String(ScriptApp.getService().getUrl() || "");
    return u.indexOf("/exec") > -1 ? u : "";
  } catch (err) { return ""; }
}

/* The last six characters of a web app's id, which is enough to tell two
   deployments apart on a phone screen without printing the whole address. */
function webAppTail(u) {
  var m = /\/s\/([^\/]+)\/exec/.exec(String(u || ""));
  return m ? "\u2026" + m[1].slice(-6) : "(none)";
}

function liveSync() {
  try {
    var props = PropertiesService.getScriptProperties();
    var now = String(props.getProperty("rotaVersion") || "1");
    var was = String(props.getProperty("livePushedVersion") || "");
    var age = Date.now() - Number(props.getProperty("livePushedAt") || 0);
    /* Also at least once an hour regardless, so a push that failed quietly
       is retried without anybody having to edit something. */
    if (now !== was || age > 3600000) pushToWorker();
  } catch (err) {}
  var back = null;
  try { back = drainNow(); } catch (err) {}
  /* An Outcome edit the live server did not answer when it was made. */
  try { outcomeRetry(); } catch (err) {}
  try { overbookAfter(back); } catch (err) {}
}

/* Whether to look at the seat counts after a drain, and doing it. */
function overbookAfter(back) {

  /* Only when a booking has actually landed, or once an hour anyway.

     It used to run on every tick. That is 288 ticks a day, and each one costs
     four full reads — the Buses tab, the WHOLE Rota tab (the one tab the
     archiver deliberately never trims), the Bus Stops tab, and the last 400
     bookings — to answer a question whose answer cannot have changed since the
     tick before. Six days a week of that, to send nothing.

     A drain that brought bookings back is the only thing that can move the
     count, so it is the only thing that needs checking. The hourly floor
     covers what the drain cannot see: a seat count edited on the Buses tab, or
     a bus swapped by hand on the Rota tab, either of which can put a route
     over without a single new booking.

     Run AFTER the drain either way, so it judges the bookings that have just
     landed rather than the ones it had five minutes ago. Guarded on its own:
     an email that cannot be sent must not stop the sync that feeds the app. */
  var props2 = PropertiesService.getScriptProperties();
  var ranAt  = Number(props2.getProperty("overbookRanAt") || 0);
  var landed = !!(back && back.bookings);
  if (landed || Date.now() - ranAt > 3600000) {
    overbookingAlert();
    props2.setProperty("overbookRanAt", String(Date.now()));
  }
}

/* ---- ONE DRAIN AT A TIME, AND NONE MISSED ---------------------------------

   From v1.80.0 the drain has two ways in: the five minute sync, and the live
   server knocking the moment a phone has done something. Two drains running
   side by side would each find the same new row missing from the tab and
   each append it.

   So a drain holds a flag while it runs. A knock that arrives meanwhile does
   not wait and does not drain: it leaves a note, and the running drain goes
   round once more when it finishes, which collects whatever the knock was
   about. The script lock is held only while the flag is read and written,
   never across the drain, because the drain files walkarounds and
   handleCheck waits on that same lock.

   A flag older than DRAIN_BUSY_MS belongs to a drain that died, and is taken
   over. */
var DRAIN_BUSY_MS = 5 * 60000;
var DRAIN_ROUNDS = 4;

function drainFlag(fn) {
  var lock = LockService.getScriptLock();
  var held = false;
  try { lock.waitLock(10000); held = true; } catch (err) { held = false; }
  try { return fn(PropertiesService.getScriptProperties(), held); }
  finally { if (held) { try { lock.releaseLock(); } catch (err) {} } }
}

/* True if this call may drain now. False if a drain is running, in which
   case it has been asked to go round again. */
function drainClaimTurn() {
  return drainFlag(function (props, held) {
    var busy = Number(props.getProperty("drainBusy") || 0);
    if (!held || (busy && Date.now() - busy < DRAIN_BUSY_MS)) {
      props.setProperty("drainAgain", "1");
      return false;
    }
    props.setProperty("drainBusy", String(Date.now()));
    props.deleteProperty("drainAgain");
    return true;
  });
}

/* True if somebody knocked while that drain ran, and another round is
   allowed. The flag is kept for that round, or put down. */
function drainEndTurn(mayGoAgain) {
  return drainFlag(function (props) {
    var again = !!mayGoAgain && props.getProperty("drainAgain") === "1";
    props.deleteProperty("drainAgain");
    if (again) props.setProperty("drainBusy", String(Date.now()));
    else props.deleteProperty("drainBusy");
    return again;
  });
}

/* The drain, taken in turn. Null if another drain has it, which is not a
   failure: that drain goes round again for this one. */
function drainNow() {
  if (!drainClaimTurn()) return null;
  var total = { bookings: 0, trips: 0, checks: 0, auths: 0 };
  var rounds = 0, again = true;
  while (again) {
    rounds++;
    try {
      var back = drainFromWorker();
      if (back) {
        total.bookings += back.bookings || 0;
        total.trips    += back.trips    || 0;
        total.checks   += back.checks   || 0;
        total.auths    += back.auths    || 0;
      }
    } catch (err) {
      try { PropertiesService.getScriptProperties()
              .setProperty("liveError", "drain: " + String(err && err.message || err)); } catch (e) {}
    }
    again = drainEndTurn(rounds < DRAIN_ROUNDS);
  }
  return total;
}

/* ---- SHEET EDITS REACH THE PHONES IN SECONDS ------------------------------

   The rota, the drivers, the buses and the stops used to reach the live
   server on the next five minute sync, and only if the change was one that
   bumped the rota version. A PIN changed on the Drivers tab, a stop time or a
   bus's seats waited for the hourly push.

   onEditLive is an installed edit trigger (a simple one may not reach the
   internet). An edit on one of those tabs is pushed now. An edit to Status
   or Seats on a Bus Bookings row the live server owns is sent to it now.

   Pushes are taken in turn like drains. An edit made while a push is
   building is caught by the version check at the end of each round: the
   version is read before the push reads the sheet, so a newer one means an
   edit the push may not have seen, and it goes again. */
var PUSH_ROUNDS = 3;
var LIVE_PUSH_TABS = [ROTA_SHEET, DRIVERS_SHEET, BUSES_SHEET, STOPS_SHEET,
                      REQUESTS_SHEET, DEFECTS_SHEET];

function pushNow() {
  var mine = drainFlag(function (props, held) {
    var busy = Number(props.getProperty("pushBusy") || 0);
    if (!held || (busy && Date.now() - busy < DRAIN_BUSY_MS)) return false;
    props.setProperty("pushBusy", String(Date.now()));
    return true;
  });
  /* A push is already building. It checks the version when it finishes and
     goes round again for this edit. */
  if (!mine) return false;
  try {
    for (var round = 0; round < PUSH_ROUNDS; round++) {
      var out = pushToWorker();
      if (!out || out.ok !== true) break;          /* liveSync retries within five minutes */
      var props = PropertiesService.getScriptProperties();
      if (String(props.getProperty("rotaVersion") || "1") ===
          String(props.getProperty("livePushedVersion") || "")) break;
    }
  } finally {
    drainFlag(function (props) { props.deleteProperty("pushBusy"); });
  }
  return true;
}

function onEditLive(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    var name = sh.getName();

    if (name === BOOKINGS_SHEET) { liveBookingEdits(e, sh); return; }
    if (LIVE_PUSH_TABS.indexOf(name) === -1) return;

    /* The stops are cached for a minute between executions, and this push
       must read the tab as it now is. */
    if (name === STOPS_SHEET) {
      try { CacheService.getScriptCache().remove(STOPS_CACHE_KEY); } catch (err) {}
      stopsMemo = null;
    }
    /* So a push that fails here is retried by the next five minute sync
       rather than the hourly one. */
    bumpRotaVersion();
    pushNow();
  } catch (err) {
    try { PropertiesService.getScriptProperties()
            .setProperty("liveError", "edit push: " + String(err && err.message || err)); } catch (e2) {}
  }
}

/* Status or Seats changed by hand on rows the live server owns. */
function liveBookingEdits(e, sh) {
  var c = colsSoft(sh, BOOKINGS_SHEET);
  if (!c.liveId || !c.status || !c.seats) return;
  var topRow = Math.max(e.range.getRow(), 2);
  var lastRow = e.range.getRow() + e.range.getNumRows() - 1;
  var topCol = e.range.getColumn();
  var lastCol = topCol + e.range.getNumColumns() - 1;
  if (lastRow < topRow) return;
  var touches = function (col) { return topCol <= col && lastCol >= col; };
  if (!touches(c.status) && !touches(c.seats)) return;

  var wide = sh.getLastColumn();
  var vals = sh.getRange(topRow, 1, lastRow - topRow + 1, wide).getValues();
  var edits = [];
  vals.forEach(function (r) {
    var id = Number(at1(r, c.liveId));
    if (!(id > 0)) return;                 /* typed in by hand: not the live server's row */
    edits.push({ id: id, status: String(at1(r, c.status) || "").trim(),
                 seats: Number(at1(r, c.seats)) || 0 });
  });
  if (!edits.length) return;
  var out = workerCall("sheetbookings", { edits: edits });
  if (!out || out.ok !== true) {
    try { PropertiesService.getScriptProperties()
            .setProperty("liveError", "booking edit: " + String((out && out.error) || "no answer")); } catch (err) {}
  }
}

function installLivePush() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "onEditLive") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("onEditLive")
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
}

function installLiveSync() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "liveSync") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("liveSync").timeBased().everyMinutes(5).create();
}

/* ---- the menu ---------------------------------------------------------- */

function liveSendNow() {
  var ui = SpreadsheetApp.getUi();
  var out = pushToWorker();
  if (!out || out.ok !== true) {
    ui.alert("Could not reach the live server",
      String((out && out.error) || "no answer") +
      "\n\nNothing is broken by this: the apps fall back to what they already " +
      "hold, and this will try again by itself within the hour.",
      ui.ButtonSet.OK);
    return;
  }
  /* In turn with any drain already running. If one is, it collects what
     would have come back here, so this reports none. */
  var back = drainNow() || { bookings: 0, trips: 0 };
  ui.alert("Sent to the live server",
    "The timetable, the buses, the drivers and the next " + LIVE_ROTA_WEEKS +
    " Sundays of rota are now on the live server.\n\n" +
    "Brought back: " + back.bookings + " booking" + (back.bookings === 1 ? "" : "s") +
    ", " + back.trips + " tap" + (back.trips === 1 ? "" : "s") + ".",
    ui.ButtonSet.OK);
}

function liveCheck() {
  var ui = SpreadsheetApp.getUi();
  var lines = liveCheckLines();
  if (lines.length === 1) { ui.alert(lines[0]); return; }
  ui.alert("The live server", lines.join("\n"), ui.ButtonSet.OK);
}

/* The same lines as parts, for the coordinator's app: what needs attention,
   what is fine, and the rest as it stands. */
function liveReport() {
  var lines = liveCheckLines();
  var bad = [], good = [], info = [], cur = null;
  lines.forEach(function (l) {
    var t = String(l || "");
    if (!t.trim()) { cur = null; return; }
    if (/^\u2717/.test(t)) { bad.push(t.replace(/^\u2717\s*/, "")); cur = bad; }
    else if (/^\u2713/.test(t)) { good.push(t.replace(/^\u2713\s*/, "")); cur = good; }
    /* An indented line belongs to the line above it. */
    else if (/^\s/.test(t) && cur && cur.length) cur[cur.length - 1] += " " + t.trim();
    else { info.push(t.trim()); cur = info; }
  });
  var sections = [];
  if (bad.length) sections.push({ head: "Needs attention", tone: "bad", lines: bad });
  if (good.length) sections.push({ head: "Fine", tone: "good", lines: good });
  if (info.length) sections.push({ head: "As it stands", lines: info });
  return { title: "Is the live server working?", tone: bad.length ? "bad" : "",
           lead: bad.length ? bad.length + " thing" + (bad.length === 1 ? " needs" : "s need") + " attention."
                            : "Everything checked is fine.",
           sections: sections, text: lines.join("\n") };
}

function liveCheckLines() {
  var lines = [];
  var props = null;
  try { props = PropertiesService.getScriptProperties(); } catch (err) {}

  if (!WORKER_URL) return ["No live server address is set."];
  lines.push("Address: " + WORKER_URL);

  var out = workerCall("drain", { limit: 1 });
  if (out && out.ok === true) {
    lines.push("✓  Answering, and it knows the token.");
    if (out.script) lines.push("    Its version: " + out.script);
    lines.push("    Waiting to come back: " +
               ((out.bookings || []).length + (out.trips || []).length ? "some rows" : "nothing"));

    /* How old the copies of the rota and the mileage are over there.

       This is the one thing that can go wrong quietly. Everything keeps
       answering; the answers just get older, until they pass six hours and
       the live server starts refusing them and the app goes back to being
       slow with nobody able to say why. Named in minutes so the number means
       something without arithmetic. */
    /* The Worker's own clock, from w2.16.0. Every timed message goes on
       the minute while it ticks; without it they ride this sync again. */
    if (out.clockAgoSec === null || out.clockAgoSec === undefined) {
      lines.push("\u2717  The live server's clock has never ticked. Add the Cron Trigger " +
                 "(every minute) to the Worker in Cloudflare.");
    } else if (out.clockAgoSec > 180) {
      lines.push("\u2717  The live server's clock last ticked " + agoWords(Date.now() - out.clockAgoSec * 1000) +
                 ". Check the Worker's Cron Trigger in Cloudflare.");
    } else {
      lines.push("\u2713  The live server's clock is ticking.");
    }
    /* The sheet's own password: set on both sides, or on neither yet. */
    if (out.sheetTokenSet === false && sheetToken()) {
      lines.push("\u2717  SHEET_TOKEN is set here but not on the live server. Add it in Cloudflare, " +
                 "Worker, Settings, Variables and Secrets, as a Secret, with the same value.");
    } else if (out.sheetTokenSet === false) {
      lines.push("\u2717  No SHEET_TOKEN yet. Messages between this sheet and the live server are " +
                 "guarded only by the public token in config.js. Set the same SHEET_TOKEN here and " +
                 "in the Worker to close that.");
    }
    /* Undefined from a live server older than w2.21.1, which had a fallback. */
    if (out.pinSalt === false) {
      lines.push("\u2717  PIN_SALT is not set on the live server, so every PIN is refused. " +
                 "Add it in Cloudflare, Worker, Settings, Variables and Secrets.");
    }
    /* Where it knocks, beside where this script says it is. A live server
       knocking on another deployment is the usual reason for the line below
       it reading "the sheet did not answer". Undefined from before w2.23.0. */
    if (typeof out.knockTo === "string") {
      var here = sheetReturnUrl();
      if (!out.knockTo) {
        lines.push("\u2717  The live server has no address for this sheet. Use Send everything to the live server now.");
      } else if (here && out.knockTo !== here) {
        lines.push("\u2717  The live server knocks on the web app ending " + webAppTail(out.knockTo) +
                   ", but this script is deployed at the one ending " + webAppTail(here) +
                   ". Use Send everything to the live server now.");
      } else {
        lines.push("    It knocks on the web app ending " + webAppTail(out.knockTo) +
                   ". Deploy, Manage deployments should show the same, with Who has access: Anyone." +
                   " If it does not, put the right Web app URL in the Script Property WEB_APP_URL.");
      }
    }
    if (out.poke) {
      lines.push((out.poke.ok ? "\u2713  " : "\u2717  ") + "It last asked this sheet to collect " +
                 agoWords(Date.now() - out.poke.agoSec * 1000) +
                 (out.poke.ok ? "." : ", and the sheet did not answer. Check the web app is deployed."));
    }

    var ages = out.cacheAgeMin || {};
    ["rota", "last"].forEach(function (which) {
      var m = ages[which];
      var label = which === "rota" ? "Rota" : "Last mileage";
      if (m === null || m === undefined) {
        lines.push("\u2717  " + label + " has never been sent over. The app is " +
                   "still asking the spreadsheet for it.");
      } else if (m > 360) {
        lines.push("\u2717  " + label + " copy is " + agoWords(Date.now() - m * 60000) +
                   " old, past the six hour limit, so it is being refused and " +
                   "the app is asking the spreadsheet instead. Use Send " +
                   "everything to the live server now.");
      } else {
        lines.push("\u2713  " + label + " copy is " + (m < 1 ? "less than a minute" :
                   m + " minute" + (m === 1 ? "" : "s")) + " old.");
      }
    });
  } else {
    if (out && out.error === "bad sheet token") {
      lines.push("\u2717  The live server refused this sheet's password. SHEET_TOKEN must be the same " +
                 "in Script Properties here and in the Worker's Variables and Secrets in Cloudflare.");
    }
    lines.push("✗  Not answering: " + String((out && out.error) || "no reply"));
    lines.push("    The apps fall back to what they hold. Nothing is lost.");
  }

  if (props) {
    var at = Number(props.getProperty("livePushedAt") || 0);
    var dr = Number(props.getProperty("liveDrainedAt") || 0);
    var er = props.getProperty("liveError") || "";
    lines.push("");
    lines.push("Last sent:      " + (at ? agoWords(at) : "never"));
    lines.push("Last brought back: " + (dr ? agoWords(dr) : "never"));
    lines.push("Coordinator titles: " + AUTHORISER_ROLES.join(", ") +
               (hasRolesProperty() ? "" : "  (the default; set COORDINATOR_ROLES to change them)"));
    if (!pinSalt()) {
      lines.push("\u2717  PIN_SALT is not set in Script Properties, so every PIN is refused. " +
                 "Add it, the same value as the live server's, then Send everything to the live server now.");
    }
    if (er) lines.push("Last trouble:   " + er);
  }
  return lines;
}

function agoWords(ms) {
  var m = Math.round((Date.now() - Number(ms)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " minute" + (m === 1 ? "" : "s") + " ago";
  var h = Math.round(m / 60);
  if (h < 24) return h + " hour" + (h === 1 ? "" : "s") + " ago";
  return Math.round(h / 24) + " day" + (Math.round(h / 24) === 1 ? "" : "s") + " ago";
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
  /* Called after every rota write by design, and its whole job already is
     "everything cached about the rota is now wrong". The per-execution memo
     is one more thing that is. */
  memoDrop("rota");
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty("rotaVersion", String(Number(props.getProperty("rotaVersion") || 1) + 1));
  } catch (err) {}
}

/**
 * Pulls swap pairings out of a Notes cell.
 *
 * applySwap writes "Swapped: Bro Martin in for Bro Trevor (with 2026-09-06)".
 * This reads them back so a card can say "Swapped with Bro Martin" under the
 * right name. Anything else in Notes is left alone.
 */
/**
 * Whether a Sunday is protected, and why.
 *
 * Written by the coordinator in the Notes column as
 *   PROTECTED: first South run, Trevor leads
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

/* buses is { north, south }: the registration each leg actually gets on that
   Sunday, already resolved by the caller. Passed in rather than worked out
   here because this runs once per Sunday in the window and busFor re-walks
   every rota row on every call.

   It is sent so a driver can see which bus is his BEFORE he signs in to start
   a check. Until now the app could not answer that at all: the only thing
   that knew was the board, the board only speaks about the coming Sunday, and
   the driver only reaches it after he has already picked up a key. A man
   taking the wrong key on an assumption and finding out at the walkaround is
   a fault of this app, not of him. */
function decorate(r, requests, buses) {
  var out = {
    date: r.date,
    primary: r.primary || "",
    actual: r.actual || r.primary || "",
    status: r.status || "Confirmed",
    primary2: r.primary2 || "",
    actual2: r.actual2 || "",
    notes: r.notes || "",
    /* Blank when nothing can be resolved. An app drawing nothing is better
       than an app naming a bus that is not the one in the yard. */
    northBus: (buses && buses.north) || "",
    southBus: (buses && buses.south) || "",
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
  /* By heading. These were fixed numbers — South at 5 and 6 — which were the
     right numbers only until the two bus columns were inserted. After that,
     column 5 is Status and column 6 is the scheduled South driver, so a South
     cover was written over the person it was covering for. */
  var rc = rotaCols(rota);
  var NORTH = { scheduled: rc.north, cover: rc.northCover, route: "North" };
  var SOUTH = { scheduled: rc.south, cover: rc.southCover, route: "South" };
  var who = String(driver || "").trim();
  if (!who) return NORTH;

  try {
    var row = rota.getRange(rRow, 1, 1, rota.getLastColumn()).getValues()[0];
    var at  = function (col) { return String(at1(row, col) || "").trim(); };
    if (at(rc.south) === who || at(rc.southCover) === who) return SOUTH;
    if (at(rc.north) === who || at(rc.northCover) === who) return NORTH;
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

  /* Every column on this tab is found by heading. The four fixed numbers that
     used to be here were correct only for the layout that existed before the
     bus columns were inserted; afterwards a South driver could never be
     matched at all, so no South swap could be approved. */
  var rc = rotaCols(rota);
  var wide = rota.getLastColumn();
  var a = rota.getRange(rowA, 1, 1, wide).getValues()[0];
  var b = rota.getRange(rowB, 1, 1, wide).getValues()[0];

  function slotOf(vals, who) {
    var at = function (col) { return String(at1(vals, col) || "").trim(); };
    if (at(rc.north)      === who) return { sched: rc.north, cover: rc.northCover, covering: false, route: "North" };
    if (at(rc.south)      === who) return { sched: rc.south, cover: rc.southCover, covering: false, route: "South" };
    if (at(rc.northCover) === who) return { sched: rc.north, cover: rc.northCover, covering: true,  route: "North" };
    if (at(rc.southCover) === who) return { sched: rc.south, cover: rc.southCover, covering: true,  route: "South" };
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
  var pA = parseProtected(String(rota.getRange(rowA, rc.notes).getValue() || ""));
  var pB = parseProtected(String(rota.getRange(rowB, rc.notes).getValue() || ""));
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
  /* Not over a Sunday that has been called off: see onEditRequests. */
  [rowA, rowB].forEach(function (rw) {
    var st = String(rota.getRange(rw, rc.status).getValue() || "");
    if (!routeCalledOff(st, "North") && !routeCalledOff(st, "South")) {
      rota.getRange(rw, rc.status).setValue("Confirmed");
    }
  });

  appendNote(rota, rowA, "Swapped: " + driverB + " in for " + driverA + " (with " + keyB + ")");
  appendNote(rota, rowB, "Swapped: " + driverA + " in for " + driverB + " (with " + keyA + ")");
  stamp(rota, rowB, "Approved swap");

  /* The slot carries its own route now. Comparing the column number against 5
     said "North Liverpool" on every email the moment the columns moved. */
  notifyDutyChange(ss, keyA, driverA, driverB, sA.route + " Liverpool");
  notifyDutyChange(ss, keyB, driverB, driverA, sB.route + " Liverpool");
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
  return memo("rota", function () { return readRotaRowsFresh(ss); });
}

function readRotaRowsFresh(ss) {
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
  return memo("drivers", function () { return readDriversFresh(ss); });
}

function readDriversFresh(ss) {
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
/* THE SALTED HASH THE LIVE SERVER COMPARES AGAINST.

   Separate from pinHash below, which stays exactly as it was for this file's
   own comparison. This one is the only thing about a PIN that ever leaves the
   spreadsheet, and it leaves as a one way hash with a salt on it.

   Why salted: a PIN is four digits, so ten thousand possibilities. An
   unsalted SHA-256 of a four digit number is looked up in a second, not
   cracked. The salt is what makes the copy held on the live server useless to
   anybody who gets hold of it.

   MUST MATCH the Worker's pinHashOf byte for byte: same salt, name trimmed
   and lowercased, digits only, joined with colons. Change one side and every
   PIN fails until the other is changed to match.

   Set PIN_SALT in Project Settings -> Script Properties. There is no fallback
   in this file from v1.85.2: it is public, and a salt printed in it protects
   nothing. With the property missing every PIN is refused on the live
   server, never waved through, and "Is everything working?" says so. */
function pinSalt() {
  try {
    var v = PropertiesService.getScriptProperties().getProperty("PIN_SALT");
    if (v && String(v).trim()) return String(v).trim();
  } catch (err) {}
  return "";
}

function pinHashLive(name, pin) {
  var digits = String(pin || "").replace(/\D/g, "");
  if (!digits) return "";
  /* Never "" for a driver who has a PIN: the live server reads "" as "no PIN
     wanted" and would let anybody through. With no salt to make a real one,
     this sends a value nothing can match, so his PIN is refused instead. */
  if (!pinSalt()) return "no PIN_SALT";
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    pinSalt() + ":" + String(name || "").trim().toLowerCase() + ":" + digits,
    Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ("0" + (b & 0xFF).toString(16)).slice(-2); }).join("");
}

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
/* Three, not ten. Ten is a number that suits a password; a PIN is four digits
   a man has known for months, and somebody who has got it wrong three times
   running is not close to remembering it — he is on the wrong name, or the
   sheet has the wrong number against him. The pause is what makes guessing
   slow, and it is the only thing that does, because the endpoint is open. */
var PIN_MAX_TRIES = 3;
var PIN_LOCK_MINUTES = 5;

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

  var sunday = keyToDate(rq.date);
  if (sunday < sundayOf(new Date())) {
    return reply({ ok: false, error: "that Sunday has already passed" });
  }

  /* ONE WRITER AT A TIME. From v1.81.0 a request reaches this function two
     ways: the drain carrying the copy the live server took, and the phone
     posting here itself when the live server did not answer it. Both could
     pass the duplicate test before either had written, and the coordinator
     would get the request twice. Held for the test and the row only. */
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); }
  catch (err) { return reply({ ok: false, error: "busy, try again" }); }
  try {
    if (alreadyHaveRequest(sh, rq.id)) {
      return reply({ ok: true, duplicate: true });
    }
    writeRequestRow(sh, rq, sunday);
  } finally {
    try { lock.releaseLock(); } catch (err) {}
  }

  /* Flag it on the official rota so the Sunday visibly needs attention, but
     do NOT change the driver. Only the coordinator does that.

     NOT OVER A SUNDAY THAT HAS BEEN CALLED OFF. This wrote Change requested
     whatever the Status said, so a request on a Sunday marked North
     cancelled put the route back on for the passengers: they read the same
     cell. The request is still filed and still emailed. */
  var rotaNow = rotaStatusOn(ss, rq.date);
  if (!routeCalledOff(rotaNow, "North") && !routeCalledOff(rotaNow, "South")) {
    markRotaStatus(ss, rq.date, "Change requested");
  }

  bumpRotaVersion();
  tellCoordinatorPhones({ id: "req|" + (rq.id || (rq.driver + "|" + rq.date)), kind: "request",
    title: "Rota request from " + rq.driver,
    body: (rq.type || "A change") + " for " +
          Utilities.formatDate(sunday, Session.getScriptTimeZone(), "EEEE d MMMM") +
          ". Decide it in the coordinator's app.",
    not: [rq.driver] });
  if (COORDINATOR_EMAIL) notifyRotaRequest(rq, sunday);

  return reply({ ok: true });
}

/* The row itself, as it has always been written. */
function writeRequestRow(sh, rq, sunday) {
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
}

/* The Rota's Status for one Sunday, or "". */
function rotaStatusOn(ss, key) {
  var sh = ss.getSheetByName(ROTA_SHEET);
  if (!sh) return "";
  var row = findRotaRow(sh, key);
  if (!row) return "";
  return String(sh.getRange(row, rotaCols(sh).status).getValue() || "");
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
                    "Where started", "Accuracy (yd)", "Distance from base (yd)",
                    /* WHO ENDED THE RUN, on the end row and nowhere else.

                       For an ordinary end it repeats the Driver column and
                       says nothing new. For a run a coordinator closed it is
                       his name against somebody else's run, and the two
                       columns differing is the whole fact. */
                    "Ended by",
                    /* See BOOKINGS_HEADERS: the row's id on the live server. */
                    "Live ID"];

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
  if (filled) { sh.getRange(2, dc.route, last - 1, 1).setValues(routes); memoDrop("drivers"); }
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
  /* The counting is coverReport, which the coordinator's app asks for too. */
  SpreadsheetApp.getUi().alert(coverReport().text);
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

  /* The archive tabs, locked whole. They hold rows that were records on the
     live tab a moment before they were moved, and moving them did not make
     them anybody's to edit. Named rather than listed, so a tab that does not
     exist yet simply is not added — add() already skips a missing one. */
  archivePlan().forEach(function (spec) {
    add(spec.tab + ARCHIVE_SUFFIX, function () { return []; },
        spec.tab + " archive: moved out of the live tab, still a record");
  });

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
  /* The columns a walkaround writes, added now rather than by the first check
     after a deploy, so a coordinator opening the tab straight after Set up
     sees Authorised by and Kind where they will be. Only if the tab exists:
     a sheet that has never had a check makes it on the first one, whole. */
  pretty("Checks and Defects columns", function () {
    var ck = ss.getSheetByName(CHECKS_SHEET);
    if (ck) ensureChecksColumns(ck);
    var df = ss.getSheetByName(DEFECTS_SHEET);
    if (df) ensureCols(df, DEFECT_HEADERS);
  });

  /* Every column that holds a moment, told to show the moment. Run here as
     well as inside each tab's own ensure, because those are guarded by a
     freshness stamp and a sheet already in service has that stamp set — so
     without this, a fix to the formatting would not reach the very sheets
     that need it until the stamp happened to lapse. */
  pretty("Date and time formats", function () {
    var jobs = [
      [ss.getSheetByName(BOOKINGS_SHEET), BOOKINGS_SHEET, ["received"]],
      [ss.getSheetByName(TRIP_SHEET),     TRIP_SHEET,     ["logged", "scheduled", "happened"]],
      [ss.getSheetByName(CHECKS_SHEET),   CHECKS_SHEET,   ["received"]],
      [ss.getSheetByName(DEFECTS_SHEET),  DEFECTS_SHEET,  ["received"]]
    ];
    jobs.forEach(function (j) {
      if (j[0]) stampTimeFormats(j[0], colsSoft(j[0], j[1]), j[2]);
    });
    var rq = ss.getSheetByName(REQUESTS_SHEET);
    if (rq) {
      try { stampTimeFormats(rq, requestCols(rq), ["received", "decidedOn"]); }
      catch (err) {}
    }
  });

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
  try { installCheckOverride(); } catch (err) { /* same. The app's own override still works. */ }
  try { installNightlyMaintenance(); } catch (err) { /* same. maintainIfDue covers it. */ }
  try { installMissingCheckAlert(); } catch (err) { /* same */ }
  try { installLiveSync(); } catch (err) { /* same. The menu can send by hand. */ }
  try { installLivePush(); } catch (err) { /* same. The five minute sync still pushes. */ }
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

/* Fills blank Lat and Lng cells on the Bus Stops tab from STOP_PINS.

   Returns how many cells it wrote, so the setup can say so rather than
   leaving a person to notice. Writes nothing and touches nothing when every
   cell it recognises is already filled, which is every run after the first. */
function fillStopPins(sh, sc) {
  if (!sc || !sc.lat || !sc.lng || !sc.id) return 0;
  var last = sh.getLastRow();
  if (last < 2) return 0;

  var wide = Math.max(sh.getLastColumn(), STOPS_HEADERS.length);
  var vals = sh.getRange(2, 1, last - 1, wide).getValues();
  var wrote = 0;

  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    var id = String(at1(r, sc.id) || "").trim().toUpperCase();
    var name = String(at1(r, sc.stop) || "").trim().toLowerCase();
    var known = STOP_PINS[id] || null;
    var pin = null;

    /* BOTH THE ID AND THE NAME HAVE TO MATCH.

       The id alone is not enough, and the case it fails is one that will
       happen: a pickup point moves, the old row is reused for the new place,
       and the coordinates are left blank to be filled in later. On the id
       alone this would helpfully fill them with the OLD kerb — half a mile
       away, looking entirely plausible, and wrong in a way nothing on the tab
       would show.

       A stop that has been renamed therefore stays blank. That is the right
       answer: blank is a state everything downstream already handles, it is
       visible in the cell, and a coordinate typed by the person who moved the
       stop is worth more than one guessed by this file. */
    var post = sc.postcode ? String(at1(r, sc.postcode) || "").trim() : "";
    if (pinFits(known, name, post)) pin = known.at;

    /* The church. Its rows carry their own ids per route — N00 and N09 today,
       S00 and S08, and they have been renumbered before — so it is matched on
       being a Depart or an Arrival at the church's own postcode. The name is
       not used at all: the tab says "Church, Chester Road", it has said other
       things, and none of that changes where the building is. */
    if (!pin && sc.type) {
      var type = String(at1(r, sc.type) || "").trim().toLowerCase();
      var isEnd = (type.indexOf("depart") === 0 || type.indexOf("arriv") === 0);
      if (isEnd && (samePostcode(post, CHURCH_PIN.postcode) ||
                    roadKey(name).indexOf("church") === 0)) {
        pin = CHURCH_PIN.at;
      }
    }
    if (!pin) continue;

    if (numOrBlank(at1(r, sc.lat)) === "") { r[sc.lat - 1] = pin[0]; wrote++; }
    if (numOrBlank(at1(r, sc.lng)) === "") { r[sc.lng - 1] = pin[1]; wrote++; }
  }

  if (wrote) sh.getRange(2, 1, vals.length, wide).setValues(vals);
  return wrote;
}

function ensureBusStops(ss) {
  var existing = ss.getSheetByName(STOPS_SHEET);
  var sh = sheet(ss, STOPS_SHEET, STOPS_HEADERS);
  /* Which headings the tab had BEFORE the migration ran, so a note explaining
     a new column is written once — when the column first appears — and not on
     every run. Running this twice is supposed to change nothing the second
     time, and a note that rewrites itself quietly took that away. */
  var had = existing ? headerMap(sh) : {};
  ensureCols(sh, STOPS_HEADERS);
  var sc = colsHard(sh, STOPS_SHEET);
  if (!existing) {
    SEED_STOPS.forEach(function (r) { sh.appendRow(r); });
    sh.setColumnWidth(sc.stop, 340);
    sh.getRange(1, sc.time).setNote("Written as text, 09:50, not a time value.");
    sh.getRange(1, sc.active).setNote("NO takes a stop out of the app without deleting it.");
    sh.setFrozenRows(1);
  }
  /* The repair, for a tab that met the fault above before it was fixed.

     Read first, write only if there is something to clear, so running the
     setup twice still writes nothing the second time. */
  if (sc.where) {
    try {
      if (sh.getRange(2, sc.where).getDataValidation()) {
        sh.getRange(1, sc.where, sh.getMaxRows(), 1).setDataValidation(null);
        pretty("Clearing the inherited dropdown from Where", function () {});
      }
    } catch (err) { /* nothing to clear */ }
  }

  /* Outside the block above on purpose: this column arrived long after most
     spreadsheets did, so the note has to reach a tab that already exists —
     but only on the run that adds it. */
  if (sc.where && !had["Where"]) {
    sh.getRange(1, sc.where).setNote(
      "Where the bus actually pulls in, as an address: 12 Ardville Road, " +
      "Liverpool L11 7DD. The driver taps the postcode on his next stop and " +
      "his phone opens it. Leave it blank and nothing changes.");
    sh.setColumnWidth(sc.where, 260);
  }
  /* THE KERBS, INTO ANY CELL NOBODY HAS FILLED.

     Read the whole block, decide, and write once — or not at all. Running the
     setup twice has to change nothing the second time, and a function that
     rewrites the same fifteen rows every run makes the revision history
     useless for spotting the edit that mattered.

     Blanks only. A coordinate somebody has corrected by hand is a decision
     and this is an observation; the same rule the Rota's actual/cover column
     already lives by. */
  fillStopPins(sh, sc);

  /* A note on each new column, on the run that adds it and not again. Same
     bargain the Where column already makes. */
  if (sc.lat && !had["Lat"]) {
    sh.getRange(1, sc.lat).setNote(
      "The kerb itself. Filled in for you where the Stop ID and the Stop name " +
      "are ones the script was given; type it in for any stop it does not know. " +
      "Nothing here is ever overwritten. Blank is fine: the map link falls back " +
      "to the address and the estimate falls back to the timetable.");
    sh.setColumnWidth(sc.lat, 110);
  }
  if (sc.lng && !had["Lng"]) sh.setColumnWidth(sc.lng, 110);

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
/* ==========================================================================
   ONE REQUEST, ONE READ OF EACH TAB

   readBusStopsAll below has done this since the timetable read started
   costing something. The other four readers never got it, and it showed. A
   single ?bus=1 — the call the whole congregation makes at the same minute
   on a Sunday morning — read Bus Bookings five times, the Buses tab four
   and the Rota three. Sixteen round trips to the Sheets backend for five
   tabs' worth of data, ten of them re-fetching rows that had been in memory
   a few frames earlier. At 150 to 300 milliseconds a read, that is two to
   four and a half seconds of nothing.

   Per EXECUTION, not per minute. This cannot serve a stale answer to a later
   request, because a later request is a new execution with an empty memo.
   That is the whole reason it is safe where a timed cache would need
   thinking about.

   There is exactly one rule: anything that WRITES to one of these tabs drops
   its memo, or it reads back the tab as it stood before its own write. The
   drops are marked "memoDrop" throughout this file. The one that would
   actually be noticed is the booking reply — a passenger confirms a seat and
   the count does not move, because the reply was built from rows read a
   moment before they changed them.
   ========================================================================== */
var MEMO = {};

function memo(key, fn) {
  if (MEMO[key] !== undefined) return MEMO[key];
  MEMO[key] = fn();
  return MEMO[key];
}

/* No key drops the lot. structReset calls it that way, beside the
   stopsMemo = null that is already there. */
function memoDrop(key) {
  if (key) delete MEMO[key]; else MEMO = {};
}

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
/* The same stops with Where taken off, for the page anybody can open.

   Where holds a doorstep — somebody's front garden, often enough — and the
   passenger link is public and unauthenticated. Passengers do not need it:
   they live at the stop. The man who needs it is the driver, who is asked to
   find a kerb that moved last week because a family moved house. So it goes
   to his phone and no further.

   Fields are listed rather than deleted, so a field added to a stop in future
   has to be let out deliberately instead of leaking the day it is written. */
/* WHAT A PASSENGER IS SENT.

   Deliberately not the whole row. `where` is the doorstep address and it
   stays on the driver's side of the wire: a passenger who has booked a stop
   knows where it is, and a public page listing the exact door each pickup
   happens at is a different thing from a timetable.

   The PIN IS SENT, and the line between the two is worth stating. A
   coordinate is the kerb the bus pulls up at, which is what the passenger
   page already tells anybody who opens it; an address is a building, and some
   of these are somebody's house. */
function publicStops(list) {
  return list.map(function (s) {
    return { route: s.route, id: s.id, time: s.time, stop: s.stop,
             postcode: s.postcode, arrival: s.arrival, depart: s.depart,
             lat: s.lat, lng: s.lng };
  });
}

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

/* A number off a cell, or "" when the cell is empty.

   Not Number(cell), which turns an empty cell into 0. For a coordinate that
   is the difference between "nobody has typed one in" and "this stop is in
   the Gulf of Guinea", and the second one is believed by everything
   downstream. */
function numOrBlank(v) {
  if (v === null || v === undefined) return "";
  var t = String(v).trim();
  if (!t) return "";
  var n = Number(t);
  return isFinite(n) ? n : "";
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
      /* Where the bus actually pulls in, written as an address a person could
         read out: "12 Ardville Road, Liverpool L11 7DD".

         The postcode above is for a passenger who already knows the kerb and
         wants to confirm it. This is for a driver who does not. A postcode
         covers a stretch of road, so a map sends him to the middle of a
         district and leaves him looking for a group of people; an address
         sends him to the door.

         Blank is fine and is the normal state of a new row — the driver's
         screen simply shows the postcode as plain text, exactly as it always
         has. It fills up one stop at a time. */
      where: String(at1(r, c.where) || "").trim(),
      arrival: type.indexOf("arriv") === 0,
      /* Type "Depart": where the run begins, and the only row on this tab
         that is a time rather than a place to stand. */
      depart: type.indexOf("depart") === 0,
      /* An EMPTY cell is null, never 0. Zero is a real coordinate, in the
         Gulf of Guinea, and reading every unfilled stop as the same place
         would put six stops on top of each other and make the estimate
         confidently wrong instead of quietly absent. */
      lat: numOrBlank(at1(r, c.lat)),
      lng: numOrBlank(at1(r, c.lng))
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

  /* Plain text down the Phone column, or Sheets reads 07700900123 as a
     number, eats the leading zero and shows 7700900123. Every write also
     goes in with a leading apostrophe, because a format set here does not
     help a row appended by a passenger before anybody opened the tab. Belt
     and braces on purpose: a number with its first digit missing is not a
     number anybody can ring. */
  var c = colsSoft(sh, BOOKINGS_SHEET);
  if (c.phone) {
    try { sh.getRange(2, c.phone, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat("@"); }
    catch (err) { /* the apostrophe below is the one that actually matters */ }
  }
  stampTimeFormats(sh, c, ["received"]);

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
function bookingRow(c, wide, v, base) {
  /* base is the row as it stands on the tab. With it, a column the
     coordinator added keeps its value; without it the row starts blank. The
     drain used to write every existing row from blank, which emptied any
     column of his own on that row each time a passenger changed a booking. */
  var row = [];
  for (var i = 0; i < wide; i++) row.push(base && base[i] !== undefined ? base[i] : "");
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

/* How far back the bookings reader looks.

   Bus Bookings grows by about twenty rows a Sunday and has never been
   trimmed, and this used to read the whole of it — several times per
   request, on the call the whole congregation makes on a Sunday morning. So
   it has been getting slower every week since the first booking, on a slope
   shallow enough that nothing was ever going to point at it.

   400 rows is twenty Sundays. Nothing live can ask for more than two:
   busDateAllowed admits this Sunday or next and nothing else. Twenty is ten
   times the margin that needs, and it is the same reasoning and the same
   number as MILEAGE_SCAN_ROWS, which has done this for the Checks tab for
   months. */
var BOOKING_SCAN_ROWS = 400;

/* Every row on the tab, live or not, read once per execution. */
function bookingRows(ss) {
  return memo("bookings", function () { return bookingRowsFresh(ss); });
}

function bookingRowsFresh(ss) {
  var sh = ss.getSheetByName(BOOKINGS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  /* By heading, and the whole width of the tab. A sheet still on the old
     eight columns resolves those eight and returns the two newer fields
     empty, which is exactly what an old row means — the same tolerance the
     width clamp used to give, now per column instead of per tab. This call
     loads the page for the whole congregation, so it must never throw on a
     sheet that is merely out of date. */
  var c = colsSoft(sh, BOOKINGS_SHEET);
  var lastRow  = sh.getLastRow();
  var firstRow = Math.max(2, lastRow - BOOKING_SCAN_ROWS + 1);
  var vals = sh.getRange(firstRow, 1, lastRow - firstRow + 1,
                         sh.getLastColumn()).getValues();
  var out = [];
  vals.forEach(function (r, i) {
    var sunday = anyToKey(at1(r, c.sunday));
    if (!sunday) return;
    /* The apostrophe that keeps the leading zero is a formatting mark and
       does not come back with the value, but a number typed in by hand may
       carry one for real. Strip it either way. */
    var raw = at1(r, c.phone);
    var pid = at1(r, c.passenger);
    out.push({
      /* firstRow + i, NOT i + 2.

         This number is what handleBookingLocked writes to. The moment the
         read stopped starting at row 2 it stopped being an offset from the
         top of the tab, and getting it wrong would not throw: it would
         quietly rewrite somebody else's booking. */
      row: firstRow + i,
      sunday: sunday,
      status: String(at1(r, c.status) || "").trim().toLowerCase(),
      stopId: String(at1(r, c.stopId) || "").trim(),
      seats: Number(at1(r, c.seats)) || 0,
      device: String(at1(r, c.device) || "").trim(),
      phone: String(raw == null ? "" : raw).trim().replace(/^'/, ""),
      pid: String(pid == null ? "" : pid).trim()
    });
  });
  return out;
}

/* One Sunday's live bookings. The filtering is what used to sit inside the
   read loop above and is unchanged. */
function readBookings(ss, key) {
  var rehearsing = !!rehearsalOn();
  return bookingRows(ss).filter(function (b) {
    if (b.sunday !== key) return false;
    if (b.status === "cancelled") return false;
    /* Seeded test bookings. Inert unless a rehearsal is actually running, so
       a row left behind by a crash cannot quietly inflate a real Sunday. */
    if (b.status === "rehearsal" && !rehearsing) return false;
    return true;
  });
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
   possible time to find out something is wrong. A rehearsal opens the
   tracking for a couple of hours so the whole thing can be walked through on
   a Tuesday.

   FROM v1.84.0 THE LIVE SERVER OWNS IT. The coordinator's app starts one,
   starts it over and ends it, and the two menu items below ask the live
   server to do the same. The live server draws the test seats, and they reach
   the Bus Bookings tab on the drain like any booking. Each start is a new
   round: a phone drops a run it made in a round that is over, and a tap from
   such a round is not recorded. When one ends, by hand or by the clock, the
   live server deletes its seats and its taps and tells this file on the
   drain, and coordRehearsal takes its rows off Bus Bookings and Trip Events.

   Until v1.84.0 the flag lived here, the seats were drawn here, and a phone
   kept a finished test run on its screen for the rest of the day, so one
   rehearsal a day per phone was the real limit. Its taps stayed on the Trip
   Events tab afterwards.

   What stays here is a COPY of the flag, kept by the drain, because the
   tracking gate, the archive and the overbooking check in this file read it.

   It deliberately does NOT make bookingsClosed() return true. That function
   decides which Sunday a bare link is for and whether a real passenger may
   still book, so forcing it would roll the booking page to next Sunday and
   turn away anybody trying to book for this one. The gate below is separate
   and touches only the tracking.

   Everything a rehearsal writes is tagged Rehearsal and is invisible to the
   real thing, in both directions: a real run never counts rehearsal rows, and
   a rehearsal never counts real ones.
   ========================================================================== */

/* Two hours, or the first booking cutoff or Sunday midnight after the start,
   whichever comes first: the live server's rule (rehearsalEnds in
   worker.js), so this copy runs out when the real one does. */
var REHEARSAL_HOURS = 2;

function rehearsalState() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty("rehearsal");
    return raw ? JSON.parse(raw) : null;
  } catch (err) { return null; }
}

/**
 * On, or null. The copy clears itself when it has run out; the live server
 * clears the real one, and its seats and taps, by the same clock.
 */
function rehearsalOn() {
  var st = rehearsalState();
  if (!st || !st.at) return null;

  var ends = rehearsalEnds(st.at);
  if (Date.now() >= ends) { rehearsalClear(); return null; }
  st.ends = ends;
  return st;
}

/* Reckoned from when it STARTED. Until v1.84.1 the cutoff was reckoned from
   now, and once it had passed there was none left that week, so one started
   at half past eight on a Sunday ran on through the real morning. */
function rehearsalEnds(at) {
  var t = Number(at) || 0;
  var ends = t + REHEARSAL_HOURS * 3600000;
  var cut = rehearsalFirstAfter(t, function (sun) {
    var c = new Date(sun);
    if (BOOKING_CUTOFF_DAY !== 0) c.setDate(c.getDate() - (7 - BOOKING_CUTOFF_DAY));
    c.setHours(BOOKING_CUTOFF_HOUR, BOOKING_CUTOFF_MIN || 0, 0, 0);
    return c;
  });
  var midnight = rehearsalFirstAfter(t, function (sun) { return new Date(sun); });
  if (cut && cut < ends) ends = cut;
  if (midnight && midnight < ends) ends = midnight;
  return ends;
}

/* The first moment after t that a rule gives for a Sunday: the Sunday of t
   first, then the one after. */
function rehearsalFirstAfter(t, rule) {
  var d = sundayOf(new Date(t));
  for (var i = 0; i < 2; i++) {
    var m = rule(d);
    if (m && m.getTime() > t) return m.getTime();
    d = addWeeks(d, 1);
  }
  return 0;
}

/* A test row made on its own Sunday between the cutoff and the backstop. None
   can be made there from v1.84.1; one from before may be a REAL run that an
   older rehearsal tagged, so it is never cleared away. See inLiveMorning in
   worker.js. */
function rehearsalInLiveMorning(sunday, at) {
  var key = anyToKey(sunday);
  if (!key) return false;
  var a = keyToDate(key);
  if (BOOKING_CUTOFF_DAY !== 0) a.setDate(a.getDate() - (7 - BOOKING_CUTOFF_DAY));
  a.setHours(BOOKING_CUTOFF_HOUR, BOOKING_CUTOFF_MIN || 0, 0, 0);
  var b = keyToDate(key);
  b.setHours(RUN_BACKSTOP_HOUR, RUN_BACKSTOP_MIN || 0, 0, 0);
  var t = rehearsalWhen(at);
  return t >= a.getTime() && t < b.getTime();
}

/* What a page is told, in the live server's shape. The round is the moment
   it started, and a phone that made a run in one round drops it once the
   round is over. */
function rehearsalInfo() {
  var st = rehearsalOn();
  return st ? { round: Number(st.at) || 0, ends: Number(st.ends) || 0, shape: String(st.shape || "") }
            : false;
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

/* ---- the rows a rehearsal leaves on the tabs ----------------------------

   Every row a rehearsal put on a tab before `cut`. On Trip Events, a row of
   one of the runs named in `trips`, or one whose Status says Rehearsal. On
   Bus Bookings, one whose Status is Rehearsal. A run is named by its trip as
   well as found by its Status because a tap taken back is marked Undone and
   loses the word.

   Only rows made before the cut, with a second's margin under it, because
   one drain can write a new round's first seats and taps and then apply the
   start of that round. Deleting by Status alone would take those as well.
   The Logged and Received columns hold the live server's own times, the same
   clock the cut comes from. */
function rehearsalOffTabs(ss, trips, cut) {
  var edge = (Number(cut) || Date.now()) - 1000;
  var want = {}, keep = {};
  (trips || []).forEach(function (t) { if (t) want[String(t)] = true; });
  var isTest = function (r, c) {
    return String(at1(r, c.status) || "").toLowerCase().indexOf("rehearsal") !== -1;
  };
  var taps = rehearsalDropRows(ss, TRIP_SHEET, function (r, c) {
    var trip = String(at1(r, c.trip) || "").trim();
    if (trip && keep[trip]) return false;
    if (trip && want[trip]) return true;
    return isTest(r, c) && !rehearsalInLiveMorning(at1(r, c.sunday), at1(r, c.happened)) &&
           rehearsalWhen(at1(r, c.logged)) < edge;
  }, function (vals, c) {
    /* Kept whole: a run with a test row inside a real morning, and a REAL
       run, one whose start was not a test. A page from before v1.79.0 could
       store the End of a real run as a test, and a real run is never taken
       for one of its rows. */
    vals.forEach(function (r) {
      var trip = String(at1(r, c.trip) || "").trim();
      if (!trip) return;
      if (isTest(r, c) && rehearsalInLiveMorning(at1(r, c.sunday), at1(r, c.happened))) keep[trip] = true;
      if (String(at1(r, c.event) || "").trim().toLowerCase() === "start" && !isTest(r, c)) keep[trip] = true;
    });
  });
  var seats = rehearsalDropRows(ss, BOOKINGS_SHEET, function (r, c) {
    return String(at1(r, c.status) || "").trim().toLowerCase() === "rehearsal" &&
           rehearsalWhen(at1(r, c.received)) < edge;
  });
  return { taps: taps, seats: seats };
}

/* A cell's moment in ms. A blank reads as 0, so a test row with no time on
   it is always taken. */
function rehearsalWhen(v) {
  if (v && typeof v.getTime === "function") return v.getTime();
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

/* Bottom up, and a block of neighbouring rows in one call rather than one
   call a row. Returns how many went. `first`, if given, sees every row
   before any is judged.

   ONLY EVER CALLED FROM INSIDE THE DRAIN'S TURN (see tabsTurn). A drain
   keeps the row numbers it has read, and a row deleted under it by another
   run of this script would put its next write on somebody else's row. */
function rehearsalDropRows(ss, tabName, hit, first) {
  var sh = ss.getSheetByName(tabName);
  if (!sh || sh.getLastRow() < 2) return 0;
  var c = colsSoft(sh, tabName);
  if (!c.status) return 0;          /* no Status column: nothing to identify */
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  if (first) first(vals, c);
  var gone = 0, i = vals.length - 1;
  while (i >= 0) {
    if (!hit(vals[i], c)) { i--; continue; }
    var top = i;
    while (top - 1 >= 0 && hit(vals[top - 1], c)) top--;
    sh.deleteRows(top + 2, i - top + 1);
    gone += i - top + 1;
    i = top - 1;
  }
  return gone;
}

/* A rehearsal started, started over or ended: on the coordinator's app, from
   the menu below, or by the clock on the live server. Keeps this file's copy
   of the flag, and takes the rehearsal's rows off the tabs.

   The copy is only ever moved forward. The drain can bring an end made by
   the clock after the menu has already started the next round, and that end
   is not allowed to clear the newer one. */
function coordRehearsal(ss, a, b) {
  var op = String(b.op || "");
  if (op !== "start" && op !== "over" && op !== "end") {
    return { done: true, ok: false, result: "Start, start over or end." };
  }
  var round = Number(b.round) || 0;
  var made = Number(a && a.made) || Date.now();
  var key = anyToKey(b.sunday) || runSunday();
  rehearsalMirror(b, made);

  var gone = rehearsalOffTabs(ss, b.trips || [], op === "end" ? made : (round || made));
  memoDrop("bookings");
  memoDrop("trips");
  dropCountsCache(key);
  dropTripCache(key, "North");
  dropTripCache(key, "South");

  var n = function (k, one) { return k + " " + one + (k === 1 ? "" : "s"); };
  return { done: true, ok: true,
           result: gone.taps || gone.seats
             ? "Taken off the tabs: " + n(gone.taps, "tap") + " and " + n(gone.seats, "test seat") + "."
             : "On the tabs." };
}

/* This file's copy of the flag, moved forward only. */
function rehearsalMirror(b, made) {
  var op = String((b && b.op) || "");
  var round = Number(b && b.round) || 0;
  var mine = rehearsalState();
  var held = mine ? Number(mine.at) || 0 : 0;
  if (op === "end") {
    if (!held || held <= (Number(made) || Date.now())) rehearsalClear();
  } else if ((op === "start" || op === "over") && round && round >= held) {
    try {
      PropertiesService.getScriptProperties().setProperty("rehearsal",
        JSON.stringify({ at: round, key: anyToKey(b.sunday) || runSunday(), shape: String(b.shape || "") }));
    } catch (err) {}
  }
}

/* Taking rows off a tab, in the drain's turn. A drain keeps the row numbers
   it has read, so a row deleted under it from another run of this script
   would put its next write on the wrong row. Null when a drain has the turn:
   that drain goes round once more when it finishes. A knock that comes in
   while this holds the turn is answered before it lets go. */
function tabsTurn(fn) {
  if (!drainClaimTurn()) return null;
  var out = null;
  try { out = fn(); }
  catch (err) {
    try { PropertiesService.getScriptProperties()
            .setProperty("liveError", "tabs: " + String(err && err.message || err)); } catch (e) {}
  }
  var rounds = 0;
  while (drainEndTurn(rounds < DRAIN_ROUNDS)) {
    rounds++;
    try { drainFromWorker(); } catch (err) {}
  }
  return out;
}

/* Which kind of morning to rehearse.

   A typed word rather than buttons, because Apps Script offers three buttons
   and there are four answers. Matched on the first letter, so "Full", "f" and
   "full bus" all land in the same place, and a blank answer is an ordinary
   morning, which is what somebody who just wants to see the app work is
   asking for. */
function rehearsalAskShape(ui) {
  var r = ui.prompt("How busy a morning?",
    "Type one word:\n\n" +
    "    quiet     a few people\n" +
    "    normal    an ordinary morning\n" +
    "    full      nearly every seat taken\n" +
    "    over      more booked than the bus holds\n\n" +
    "Leave it blank for an ordinary morning.",
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return null;
  var w = String(r.getResponseText() || "").trim().toLowerCase();
  if (!w) return "normal";
  var c = w.charAt(0);
  if (c === "q") return "quiet";
  if (c === "f") return "full";
  if (c === "o") return "over";
  return "normal";
}

/* ---- the two menu items -------------------------------------------------

   Each asks the live server, which does the work and answers with what it
   did. What it did is then applied here at once rather than on the next
   drain, so the tabs are clear by the time the box is closed, and it is noted
   as applied so the drain does not do it a second time. The same controls
   are on the coordinator's app, on the Rehearsal screen. */

/* The live server's refusal, or why there was no answer, as a sentence. */
function rehearsalRefused(out) {
  var e = String((out && out.error) || "");
  if (e === "unknown action") {
    return "The live server is older than this spreadsheet. Deploy worker.js " +
           "w2.20.1 or later on Cloudflare, then try again.";
  }
  if (e === "no live server address") return "This spreadsheet has no live server address (WORKER_URL).";
  if (!e || /^bad reply/.test(e)) return "The live server did not answer.";
  return e;
}

/* The live server's answer, applied here. The copy of the flag at once; the
   tabs through a drain, which brings this very change and applies it in the
   drain's own turn. Returns the words for the box. */
function rehearsalHere(out) {
  /* The live server's clock for when it ended, never this one: a round the
     coordinator's app started a moment later must not look older than it. */
  rehearsalMirror(out.body || {}, Number(out.made) || Date.now());
  try { drainNow(); } catch (err) {}
  return coordAppliedFind(String(out.id || ""))
    ? "The Bus Bookings and Trip Events tabs are up to date."
    : "The Bus Bookings and Trip Events tabs catch up within a minute.";
}

/* Rehearse this Sunday. With one running, it starts over: new seats, and
   every phone drops the run it made in the last round. */
function startRehearsal() {
  var ui = SpreadsheetApp.getUi();
  var shape = rehearsalAskShape(ui);
  if (!shape) return;

  var out = workerCall("rehearsal", { do: "start", shape: shape });
  if (!out || !out.ok) {
    ui.alert("Not started", rehearsalRefused(out) + "\n\nNothing was changed.", ui.ButtonSet.OK);
    return;
  }
  var here = rehearsalHere(out);
  ui.alert(out.body && out.body.op === "over" ? "Rehearsal started over" : "Rehearsal running",
    out.words + "\n\n" + (out.summary || []).join("\n") + "\n\n" + here + "\n\n" +
    "Open the driver app, go to Stops and bookings, and Start trip. A second " +
    "phone on the booking link shows the passenger side.\n\n" +
    "Rehearse this Sunday again starts it over. Stop rehearsing ends it and " +
    "clears it, on the phones and on the tabs.",
    ui.ButtonSet.OK);
}

/* Stop rehearsing. Also clears what an earlier one left, with none running. */
function stopRehearsal() {
  var ui = SpreadsheetApp.getUi();
  var out = workerCall("rehearsal", { do: "end" });
  if (!out || !out.ok) {
    var reh = rehearsalOn();
    ui.alert("Not ended", rehearsalRefused(out) + "\n\nNothing was changed." +
      (reh ? " It ends by itself at " +
             Utilities.formatDate(new Date(reh.ends), Session.getScriptTimeZone(), "HH:mm") + "." : ""),
      ui.ButtonSet.OK);
    return;
  }
  var here = rehearsalHere(out);
  var none = String(out.words || "").indexOf("No rehearsal") === 0;
  ui.alert(none ? "No rehearsal running" : "Rehearsal ended",
    out.words + "\n\n" + here +
    (none ? "" : "\n\nEach phone drops the test run the next time it hears from the live server."),
    ui.ButtonSet.OK);
}

/* CLEARING A SUNDAY THAT HAS NOT BEEN DRIVEN YET.

   There was no way to do this, and on 23 September at three in the morning
   there needed to be. A rehearsal had run while the live server still believed
   it was an ordinary night (the flag never reached it, which is fixed), so
   every tap went in as a REAL run on the real Sunday. The only way out was a
   SQL console at three in the morning, which is not a tool. It is the absence
   of one.

   IT SHOWS BEFORE IT ASKS, and the count on its own is not the useful fact.
   What matters is how many of those rows are NOT tagged Rehearsal, because
   those are the ones being read as a genuine morning: by Who is tapping, by
   the weekly summary, and by anybody looking at the tab in November.

   IT WILL NOT TOUCH A SUNDAY THAT HAS BEEN AND GONE, here and on the live
   server both. A morning that has been driven is the record of people who
   were actually carried. Nothing in either file may delete that, whatever
   gets typed into the box.

   THE LIVE SERVER GOES FIRST. If that call fails, nothing is deleted anywhere
   and the tab still matches it. A half-cleared Sunday, tidy here and intact
   there, is worse than one nobody touched, because the next drain would
   quietly put it all back and the tidying would look like it had failed for
   no reason. */
function clearTestRun() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var today = dateToKey(sundayOf(new Date()));

  var asked = ui.prompt("Clear a Sunday's test run",
    "Which Sunday? Leave it blank for the coming one, " + today + ".\n\n" +
    "This removes the taps (starts, stops, ends) from BOTH the live server " +
    "and the Trip Events tab, along with any seats a rehearsal drew. The rota " +
    "and real bookings are not touched.\n\n" +
    "A Sunday that has already been driven cannot be cleared.\n\n" +
    "yyyy-mm-dd:", ui.ButtonSet.OK_CANCEL);
  if (asked.getSelectedButton() !== ui.Button.OK) return;

  var key = String(asked.getResponseText() || "").trim() || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    ui.alert("That is not a date. Write it as " + today + ".");
    return;
  }
  /* Once its cutoff has passed as well: on a Sunday afternoon the coming
     Sunday is today, and its morning has been driven. */
  if (key < today || bookingsClosed(key)) {
    ui.alert("That Sunday has been and gone",
      "Its record is what actually happened, and it stays. Only a Sunday that " +
      "has not been driven yet can be cleared.", ui.ButtonSet.OK);
    return;
  }

  /* What is on the tab, and how much of it is pretending to be real. */
  var sh = ss.getSheetByName(TRIP_SHEET);
  var rows = [], untagged = 0;
  if (sh && sh.getLastRow() > 1) {
    var tc = colsSoft(sh, TRIP_SHEET);
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (anyToKey(at1(vals[i], tc.sunday)) !== key) continue;
      rows.push(i + 2);
      if (String(at1(vals[i], tc.status) || "").toLowerCase().indexOf("rehearsal") === -1) {
        untagged++;
      }
    }
  }

  var when = Utilities.formatDate(keyToDate(key), Session.getScriptTimeZone(), "EEEE d MMMM");
  var ok = ui.alert("Clear " + when + "?",
    rows.length + " row" + (rows.length === 1 ? "" : "s") + " on the Trip Events tab" +
    (untagged ? ", and " + untagged + " of them are NOT tagged Rehearsal. Those are " +
                "being read as a real morning"
              : rows.length ? ", all tagged Rehearsal" : "") + ".\n\n" +
    "The live server's copy goes as well, along with any seats a rehearsal " +
    "drew for that Sunday.\n\nThis cannot be undone. Clear it?",
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  /* In the drain's turn, both halves: a drain writing a row it read before
     this deleted the rows above it would write it onto the wrong one. The
     rows are found again inside the turn for the same reason. */
  var done = tabsTurn(function () {
    var o = null;
    try { o = workerCall("cleartrips", { sunday: key }); } catch (err) { o = null; }
    if (!o || !o.ok) return { out: o, cleared: 0 };
    var n = rehearsalDropRows(ss, TRIP_SHEET, function (r, c) { return anyToKey(at1(r, c.sunday)) === key; });
    return { out: o, cleared: n };
  });
  if (!done) {
    ui.alert("Nothing was cleared",
      "The sheet is filing from the live server just now. Try again in a minute.", ui.ButtonSet.OK);
    return;
  }
  var out = done.out;
  if (!out || !out.ok) {
    ui.alert("Nothing was cleared",
      "The live server " + (out && out.error ? "said: " + out.error
                                             : "could not be reached") + ".\n\n" +
      "The tab has been left exactly as it was, on purpose: clearing it here " +
      "while the live server still holds the run would put it all back on the " +
      "next sync.", ui.ButtonSet.OK);
    return;
  }

  memoDrop("trips");
  dropTripCache(key, "North");
  dropTripCache(key, "South");
  dropCountsCache(key);

  ui.alert("Cleared",
    when + " is clear.\n\n" +
    "Live server: " + out.trips + " tap" + (out.trips === 1 ? "" : "s") +
    (out.seats ? " and " + out.seats + " rehearsal seat" + (out.seats === 1 ? "" : "s") : "") + ".\n" +
    "Trip Events tab: " + done.cleared + " row" + (done.cleared === 1 ? "" : "s") + ".\n\n" +
    "Close and reopen the apps to see it.", ui.ButtonSet.OK);
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
  /* The real bus for that Sunday, so the sample is the email, not a version
     of it with a field missing. */
  var busNow = "";
  try { busNow = busFor(ss, dateToKey(sunday), "North Liverpool").reg || ""; } catch (err) {}
  sendDutyEmail(COORDINATOR_EMAIL, who, sunday, days, "", "North Liverpool", busNow);

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
  stampTimeFormats(sh, colsSoft(sh, TRIP_SHEET),
                   ["logged", "scheduled", "happened"]);
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
    /* The tail, not the whole tab: see TRIP_SCAN_ROWS. Row numbers are not
       used here — every row is matched on Sunday and route, and nothing is
       written back — so unlike the bookings read there is no offset to keep
       in step. */
    var tLast  = sh.getLastRow();
    var tFirst = Math.max(2, tLast - TRIP_SCAN_ROWS + 1);
    var vals = sh.getRange(tFirst, 1, tLast - tFirst + 1,
                           sh.getLastColumn()).getValues();
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
        /* The same guard the start branch above has, and for the same reason.
           Number("") is 0, not NaN, so a blank Offset cell read as "exactly
           on time" and the passenger page printed a countdown built from
           nothing. A blank cell knows nothing, and null is how this state
           says so. A missing Offset column reads blank too, which is why
           this matters more now than it did. */
        var raw = at1(r, c.offset);
        state.offset = (raw === "" || raw === null || raw === undefined ||
                        isNaN(Number(raw))) ? null : Number(raw);
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
  var behind = Number(ETA_RULES.maxBehindMinutes) || 0;
  if (behind > 0 && state.offset > behind) return { ok: false, why: "wild" };
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
    rehearsal: rehearsalInfo(),
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
  /* Kept for keepMinutes after its time, a setting from v1.80.0. It was two
     minutes, and the page dropped back to the timetable while the bus was
     still on its way to that kerb. The quiet rule above still ends it. */
  if (mins < -(Number(ETA_RULES.keepMinutes) || 0)) { out.mine = "quiet"; return out; }

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
    rehearsal: rehearsalInfo(),
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
  /* The live server's rule (handleTrip in worker.js): a tap says which round
     it was made in, 0 for a real run, and one from a round that is over is
     taken and not written. A page that says nothing is judged by whether a
     rehearsal is on as it arrives. */
  var reh = rehearsalOn();
  var claimed = payload.rehearsal;
  var rehearsing;
  if (claimed === undefined || claimed === null) rehearsing = !!reh;
  else if (!Number(claimed)) rehearsing = false;
  else if (reh && Number(reh.at) === Number(claimed)) rehearsing = true;
  else return reply({ ok: true, written: 0, dropped: (payload.events || []).length, rehearsalOver: true });
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
    /* The tail, not the whole tab — the same window tripState reads, and for
       a better reason than tripState has.

       This is the WRITE path. It runs on every tap a phone sends, it is held
       inside the script-wide lock the whole time, and it read every Trip
       Events row ever written in order to answer one question about the run
       happening this minute. Every Sunday it got longer, and every Sunday it
       held the lock longer for everybody else.

       Safe because the rows it is looking for belong to one trip id, and one
       trip's rows are always at the tail: the run started this morning. */
    var sLast  = sh.getLastRow();
    var sFirst = Math.max(2, sLast - TRIP_SCAN_ROWS + 1);
    var vals = sh.getRange(sFirst, 1, sLast - sFirst + 1,
                           sh.getLastColumn()).getValues();
    vals.forEach(function (r, i) {
      if (String(at1(r, c.trip) || "").trim() !== trip) return;
      if (!reg) reg = String(at1(r, c.reg) || "").trim();
      var k = String(at1(r, c.event) || "").trim().toLowerCase() + "|" +
              String(at1(r, c.stopId) || "").trim();
      if (String(at1(r, c.status) || "").trim().toLowerCase() === "undone") {
        undone[k] = true; return;
      }
      /* sFirst + i, NOT i + 2. This number is written to a few lines below,
         to mark a row Undone. Same trap as the bookings read: it would not
         throw, it would strike out the wrong tap. */
      seen[k] = sFirst + i;
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
  var r = tappingReport();
  SpreadsheetApp.getUi().alert(r.title, r.text, SpreadsheetApp.getUi().ButtonSet.OK);
}

/* The report itself, as parts for the coordinator's app and as text for the
   menu. One piece of code, so the two cannot come to disagree. */
function tappingReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TRIP_SHEET);
  var TITLE = "Who is tapping";
  function only(words, tone) {
    return { title: TITLE, lead: words, sections: [], tone: tone || "", text: words };
  }

  if (!sh || sh.getLastRow() < 2) {
    return only("Nothing recorded yet. Trip Events fills up as drivers tap.");
  }

  /* The report needs these four to mean anything at all. Missing any of them
     is a tab this file has never migrated, and a report built from blanks
     would read as "nobody tapped anything", which is a lie. */
  var c = tripColsSoft(sh);
  var needs = ["sunday", "route", "event", "happened"].filter(function (k) { return !c[k]; });
  if (needs.length) {
    return only("Trip Events is missing its " + needs.join(", ") + " column" +
                (needs.length > 1 ? "s" : "") +
                ", so this report cannot be built. " +
                "Run Minibus > Rota > Set up / refresh rota.", "bad");
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
      /* Anything CONTAINING "unchecked", wherever it sits in the string.

         This was equality once, and "Unchecked (offline)" was silently left
         out of the count. That was loosened to a prefix test, which fixed the
         offline case and left a narrower version of the same trap: the status
         column now carries more than one fact at a time, so a run that was
         both unchecked and driven by cover reads "Unchecked, Cover". A prefix
         test survives that only for as long as nothing is ever put in front of
         the word, which is a rule living in a different file on a different
         server and enforced by nobody.

         A contains test cannot be broken by reordering. No other status value
         has the word in it. */
      if (status.indexOf("unchecked") >= 0) runs[id].unchecked = true;
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
  var foot = "Stops tapped counts only stops that had somebody booked. Empty stops need no tap.";
  var tail = unchecked
    ? unchecked + " run" + (unchecked > 1 ? "s were" : " was") +
      " started with no walkaround recorded on that phone. Worth asking " +
      "about: if that number climbs, the check is being skipped rather " +
      "than the record being lost."
    : "Every run had a check recorded first.";

  return {
    title: TITLE,
    lead: tail,
    tone: unchecked ? "bad" : "",
    sections: [{ head: "Most recent runs first", lines: lines }],
    foot: foot,
    text: "Most recent runs first.\n\n" + lines.join("\n\n") + "\n\n" + foot + "\n\n" + tail
  };
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
    if (!routeOver(ss, key, routes[i])) return false;
  }
  return true;
}

/* How long past a route's timetabled arrival before a silent run counts as
   finished. An hour was the old answer by way of the backstop; half an hour
   past the arrival is the same grace measured from the thing that matters. */
var RUN_DONE_MARGIN_MIN = 30;

/* And how long it must have been silent. Deliberately NOT TRIP_QUIET_MINUTES.

   That fifteen minutes decides when the passenger page stops offering a
   countdown, which is a small claim to withdraw and easily made again on the
   next tap. This decides whether to take the whole morning off the screen,
   which cannot be undone for the person who was reading it. A bus fifty
   minutes late that has just gone fifteen minutes without a tap is genuinely
   ambiguous; at half an hour it is not. Two different questions, two
   thresholds, and the more destructive one gets the longer wait. */
var RUN_DONE_QUIET_MIN = 30;

/**
 * Is this route's morning over?
 *
 * The End tap is the real answer and always wins. But a driver who is home,
 * has put the keys back and never tapped End used to hold the page for every
 * passenger on both routes until the backstop — the app waiting for a message
 * from somebody who has gone.
 *
 * So, failing an End tap: BOTH of these, never one.
 *
 *   past its timetabled arrival by RUN_DONE_MARGIN_MIN
 *   nothing heard from it for RUN_DONE_QUIET_MIN
 *
 * Both, because either alone is wrong. A bus running badly late is still
 * tapping, so it is not silent and the page holds for it — which is the whole
 * lesson of 16 August. A bus in a blackspot IS silent, but its taps are
 * queued and the clock has not reached its arrival yet, so the schedule half
 * holds the page instead. It takes a run that is both overdue and quiet
 * before this says anything at all.
 *
 * And it says it only about WHEN NEXT WEEK OPENS. The record still shows no
 * End tap, because none was made, and the Sunday report still counts it as a
 * run that was never ended.
 */
function routeOver(ss, key, route) {
  var t = tripState(ss, key, route);
  if (t.ended)   return true;
  if (!t.started) return false;          /* never left: the backstop's job */

  var last = null;
  readBusStops(ss).forEach(function (s) {
    if (s.route !== route) return;
    var m = stopMomentOn(key, s.time);
    if (m && (!last || m.getTime() > last)) last = m.getTime();
  });
  if (!last) return false;               /* no timetable, nothing to measure */

  var now = Date.now();
  if (now < last + RUN_DONE_MARGIN_MIN * 60000) return false;

  /* Silence measured from the last thing it said, or from setting off when it
     has said nothing since. */
  var heard = t.lastAt || t.started;
  return (now - heard) >= RUN_DONE_QUIET_MIN * 60000;
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

  var digits = waNumber(hit.phone);
  if (!digits) return null;

  return { name: hit.name, wa: digits, route: route };
}

/* A phone number as wa.me wants it: digits only, in international form. A UK
   mobile written the way anybody actually writes it starts 07, so the leading
   nought becomes 44. Anything already carrying a country code is left alone.
   Too short to be a real number and the answer is "", because a WhatsApp
   button that opens a chat with a stranger is worse than no button. */
function waNumber(phone) {
  var digits = String(phone == null ? "" : phone).replace(/\D/g, "");
  if (digits.charAt(0) === "0") digits = "44" + digits.substring(1);
  return digits.length < 11 ? "" : digits;
}

/* EVERY ACTIVE DRIVER'S WHATSAPP NUMBER, FOR THE LIVE SERVER. From v1.90.0.

   The passenger page's Message button was built against this file, and when
   the page moved to the live server it went dark, because the live server
   had no numbers. They go on the sync now, beside the coordinator's, over the
   same guarded call. The live server hands one number to one phone only: a
   phone with a seat on that route, once that Sunday's bookings have closed,
   and the page drops the button when the run ends. Anybody else who opens
   the link sees nothing, exactly as before. */
function driverWhatsApp(drivers) {
  var out = {};
  (drivers || []).forEach(function (d) {
    if (!d || !d.active || !d.name) return;
    var wa = waNumber(d.phone);
    if (wa) out[String(d.name).trim()] = wa;
  });
  return out;
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
    rehearsal: rehearsalInfo(),
    rolled: rolled,
    cutoff: cutoffWords(),
    stops: publicStops(readBusStops(ss).filter(function (s) { return !s.arrival; })),
    arrivals: publicStops(readBusStops(ss).filter(function (s) { return s.arrival; })),
    counts: counts,
    driver: driver,
    /* So the page can say "booked as 07700 900123" rather than leaving
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
    /* And the per-execution memo, or bookingCounts below is built from the
       rows as they were before this cancellation. */
    memoDrop("bookings");
    return reply({ ok: true, cancelled: true, late: late, mine: null,
                   counts: bookingCounts(ss, key) });
  }

  var bc = colsHard(sh, BOOKINGS_SHEET);
  if (existing) {
    /* One read and one write, where there used to be eight writes.

       By heading, still, and for the original reason: it was once a
       four-wide block from column 3, which assumed Route, Stop ID, Stop and
       Seats sat in that order with nothing between them — true until
       somebody inserts a column, and then it writes a stop name into
       whatever is there.

       What changed is the count. Each setValue was its own round trip, about
       1.2 seconds for the eight of them, and every one was held inside
       LockService.getScriptLock(), which is script-wide. So the cost was
       never paid by this passenger. It was paid by everybody behind them,
       and at twenty past nine that is a queue: the twelfth person gets
       waitLock failure and "The record is busy. Tap Confirm again", which
       sends them to the back of the queue they just failed to enter.

       Reading the whole row and patching only our own cells keeps a
       coordinator's own column untouched, which is the same principle
       bookingRow already follows on the append path below. */
    var wide = Math.max(sh.getLastColumn(), BOOKINGS_HEADERS.length);
    var row = sh.getRange(existing.row, 1, 1, wide).getValues()[0];
    var put = function (col, v) { if (col) row[col - 1] = v; };

    put(bc.route,    stop.route);
    put(bc.stopId,   stop.id);
    put(bc.stop,     stop.stop);
    put(bc.seats,    seats);
    put(bc.status,   "Booked");
    put(bc.received, new Date());
    /* Which device last touched it. Useful when somebody rings to say their
       booking has gone odd, and harmless otherwise. */
    if (ref) put(bc.device, ref);
    /* A booking made before numbers existed, being changed by somebody who
       has now given one. Put the owner on the row so the next device to ask
       finds it by the number rather than by the handle. */
    if (pid && !existing.pid) {
      put(bc.phone, phone ? "'" + phone : "");
      put(bc.passenger, pid);
    }

    /* Re-quote a number we are NOT changing.

       getValues strips the apostrophe, because it is a formatting mark and
       not content. Writing the bare digits back into a column that never
       received its "@" format would let Sheets read 07700900123 as a number
       and eat the leading zero, and a number missing its first digit is not
       a number anybody can ring. Writing one cell at a time never had this
       exposure. Writing the row does. */
    if (bc.phone && row[bc.phone - 1]) {
      row[bc.phone - 1] = "'" + String(row[bc.phone - 1]).replace(/^'/, "");
    }

    sh.getRange(existing.row, 1, 1, wide).setValues([row]);
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
  /* And the per-execution memo. Without this the counts below are built from
     the tab as it stood a moment before this booking was written, so the
     passenger confirms a seat and the number does not move. */
  memoDrop("bookings");

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
      /* One cell each, by heading. As a two-wide block from column 9 this
         assumed Phone and Passenger ID were adjacent and in that order, which
         one inserted column would have made false — and the value it puts in
         the wrong cell is somebody's phone number. */
      var sh = ensureBookings(ss);
      var oc = colsHard(sh, BOOKINGS_SHEET);
      sh.getRange(orphan.row, oc.phone).setValue("'" + phone);
      sh.getRange(orphan.row, oc.passenger).setValue(pid);
      /* busPayload reads the tab again below, and it has to see the row it
         has just been given an owner for. */
      memoDrop("bookings");
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

/* What the Phone column on the Drivers tab is for, written on its heading. */
var DRIVERS_PHONE_NOTE =
  "Mobile number.\n\n" +
  "FOR THE COORDINATOR it is the number every page tells drivers and\n" +
  "passengers to ring, shown on the public passenger page at all times.\n\n" +
  "FOR A DRIVER it is the WhatsApp button a passenger sees on Sunday\n" +
  "morning once bookings have closed. READ THIS BEFORE FILLING IT IN. The\n" +
  "number of whoever is driving that Sunday is sent to the passenger page,\n" +
  "which is public and has no login. It goes out only on the day, only\n" +
  "after 09:30, only to a passenger holding a booking, and only for that\n" +
  "one route — but it does go out. Ask the driver first.\n\n" +
  "Leave blank and that driver simply has no button. Nothing breaks.";

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
    if (!hadPhone) sh.getRange(1, dc.phone).setNote(DRIVERS_PHONE_NOTE);
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
    sh.getRange(1, dc.role).setNote(
      "Coordinator is the person every page tells drivers and passengers\n" +
      "to ring, on the number in Phone. Change who has it here and the\n" +
      "apps follow within seconds.");
    sh.getRange(1, dc.phone).setNote(DRIVERS_PHONE_NOTE);
  }
  memoDrop("drivers");                   /* seeded, backfilled, or both */
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
  memoDrop("rota");                      /* does not go through bumpRotaVersion */
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
  /* This one matters more than the rest. maintainIfDue can run it in the
     MIDDLE of rotaPayload, which then reads the rota back to build its
     answer — and would miss the Sundays that had just been written, because
     it read the tab before they existed. */
  memoDrop("rota");
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

  /* The Outcome column on the Checks tab, whole. Today's rows need it as much
     as tomorrow's: the row a coordinator reaches for on a Sunday morning is
     the one the walkaround has just written, and it has to offer "Authorised
     to run" rather than wait for somebody to spell it. */
  var chk = ss.getSheetByName(CHECKS_SHEET);
  if (chk) step("Checks outcome list", function () { applyOutcomeDropdown(chk, 0); });

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
  /* The phones as well: the same menu item proves both. A fresh id each time,
     and urgent, so a test at night is not held until the morning. */
  tellCoordinatorPhones({ id: "test|" + Date.now(), kind: "test", urgent: true,
    title: "Coordinator alerts are working",
    body: "A test from the spreadsheet. Nothing has happened to a bus." });
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
    sendMail({
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

  if (WORKER_URL) {
    msg += "\n\nA test alert has also gone to the phone of every coordinator who has " +
           "alerts on in the driver app. Anybody who did not get it: open the driver " +
           "app on that phone, signed in as themselves, and turn alerts on.";
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
               jobs: String(at1(r, c.arrange) || ""),
               authBy: String(at1(r, c.authBy) || "") });
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
    /* Blank on every row written before v1.62.0, and every one of those is a
       defect, because there was nothing else a row could be. */
    var kind = String(at1(r, c.kind) || "").trim() === "Advisory" ? "Advisory" : "Defect";
    out[reg].push({ reg: reg,
                    item: String(at1(r, c.item) || ""),
                    crit: String(at1(r, c.critical) || "") === "YES",
                    note: String(at1(r, c.found) || ""),
                    kind: kind,
                    date: anyToKey(at1(r, c.date)),
                    /* So the live server can take a defect off every phone
                       the moment the coordinator closes it (defectKey). */
                    checkId: String(at1(r, c.id) || "").trim(),
                    status: status || "Open" });
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
  if (!COORDINATOR_EMAIL && !WORKER_URL) return;

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
  lines.push("<b>Please have " + (many ? "them" : "it") + " inspected on return.</b>");

  var plain = [(many ? "These buses" : "This bus") +
               " went out with no pre-drive check on " + when + ".", ""]
    .concat(expected.map(function (r) { return "  " + r; }));
  if (north) plain.push("", "North Liverpool: " + north);
  if (south) plain.push("South Liverpool: " + south);
  plain.push("", "Please have " + (many ? "them" : "it") + " inspected on return.");

  tellCoordinatorPhones({ id: "unchecked|" + key + "|" + expected.join(","), kind: "unchecked",
    title: expected.join(", ") + " went out unchecked",
    body: "No pre-drive check this morning. Please have " + (many ? "them" : "it") +
          " inspected on return." });
  if (!COORDINATOR_EMAIL) return;
  sendMail({
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

/* ==========================================================================
   MORE BOOKED THAN SEATS
   ==========================================================================

   The app has known this for months and told nobody who could act on it.

   It is written on the driver's stops screen, as a seat count, at the moment
   he is standing beside the bus. That is the wrong person at the wrong time:
   by then the only decision left is who gets left behind, and the driver is
   the one man on a Sunday with no authority to send for another vehicle. On
   13 September eighteen people were booked onto a fourteen seat bus and the
   only place that fact appeared was a line of amber text on a phone, read by
   a coordinator who happened to be checking, forty minutes before the run.

   So it is sent, to the one person who can still do something: put the other
   bus in the rota's bus column, arrange a second trip, or ring somebody. The
   window that matters is the days BEFORE Sunday, which is exactly when nobody
   is looking at the app.

   Deliberately quiet:
     - nothing at all while the bookings fit, which is most weeks;
     - once when it first goes over, not once per booking after that;
     - again only if it gets materially worse, so a Saturday trickle of ones
       and twos is one email and not five;
     - and the memory is cleared the moment it comes back under, so a booking
       withdrawn and re-made alerts properly the second time.

   Seats are BOOKINGS against seats, not bodies against seats. People turn up
   unbooked and booked people stay at home. The email says so, because a
   coordinator who moves a bus on this number twice and finds room both times
   will stop reading it. */

/* How much worse it has to get before saying so a second time. One more
   person on an already overbooked bus changes nothing a coordinator would
   act on differently. */
var OVERBOOK_AGAIN_BY = 2;

/* How far ahead to bother looking. Bookings for a Sunday arrive in the days
   before it, and running the arithmetic on a Monday costs a read and can
   never fire. */
var OVERBOOK_WITHIN_DAYS = 5;

function overbookingAlert(force) {
  if (!COORDINATOR_EMAIL && !WORKER_URL) return { ran: false, why: "no coordinator address", sent: 0 };

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  /* Not during a rehearsal, unless it was asked for by hand.

     A rehearsal's test seats reach the same tab against the same Sunday,
     so a route genuinely at 13 of 14 reads as 16, and left to itself this
     would send you chasing two passengers who do not exist. archiveRun
     refuses during one for the same reason.

     But a rehearsal is now the ONLY way to produce a full bus on demand, and
     an alert nobody can see before it matters is an alert nobody trusts. So
     the menu item passes force, and the email it produces is stamped in the
     subject and in its first line. The guard that matters is that it can
     never be mistaken for a real one, not that it can never be sent. */
  var rehearsing = false;
  try { rehearsing = !!rehearsalOn(); } catch (err) {}
  if (rehearsing && !force) return { ran: false, why: "rehearsing", sent: 0 };

  var now = new Date();
  var sunday = sundayOf(now);
  var days = Math.round((sunday - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  if (!force && days > OVERBOOK_WITHIN_DAYS) {
    return { ran: false, why: "still " + days + " days off", sent: 0, days: days };
  }

  var key = dateToKey(sunday);
  var props = PropertiesService.getScriptProperties();
  var sent = {};
  try { sent = JSON.parse(props.getProperty("overbookSent") || "{}") || {}; } catch (err) { sent = {}; }

  /* BOTH routes are read, whether or not either is over.

     Not for symmetry: with two buses and two routes running at the same time,
     the only move available on a Sunday morning is to SWAP them, and that is
     answerable only by knowing what the other leg is carrying. The first
     version of this named "the biggest bus that would fit" and, on a two bus
     fleet, that is always the bus already out on the other route — one
     actionable sentence in the whole email and it was an instruction that
     could not be carried out. */
  var legs = {};
  ["North", "South"].forEach(function (route) {
    var f = null;
    try { f = seatsFor(ss, key, route); } catch (err) { f = null; }
    if (f) legs[route] = f;
  });

  var tell = [];
  var stamps = {};                      /* what to write down IF the email goes */

  ["North", "South"].forEach(function (route) {
    var f = legs[route];
    if (!f) return;
    var stamp = key + "|" + route;

    /* No bus resolved, or no seat count for it. Nothing can be compared, and a
       guess here would either cry wolf or stay silent wrongly. */
    if (!f.seats) { if (sent[stamp] != null) stamps[stamp] = null; return; }

    var over = f.booked - f.seats;
    if (over <= 0) {
      /* Back under. Forget it, so a re-crossing is a fresh alert rather than a
         silence caused by a number sent a fortnight ago. */
      if (sent[stamp] != null) stamps[stamp] = null;
      return;
    }

    /* The OVERAGE is what is remembered, not the booking count.

       Remembering `booked` made this go quiet in the one case that matters
       most: told at 17 booked on a 16 seat bus, a coordinator who then put the
       WRONG registration in the bus column — 14 seats — turned 1 too many into
       3 too many while `booked` never moved, and heard nothing. The number he
       acts on is how many will not fit, so that is the number to watch. */
    var told = (sent[stamp] == null) ? null : Number(sent[stamp]);
    if (!force && told !== null && over < told + OVERBOOK_AGAIN_BY) return;

    stamps[stamp] = over;
    tell.push({ route: route, reg: f.reg, seats: f.seats, booked: f.booked,
                over: over, again: (told !== null) });
  });

  /* Nothing to say. Still write back any route that has come back under, so
     the next crossing is heard. */
  if (!tell.length) {
    overbookRemember(props, sent, stamps);
    return { ran: true, sent: 0, over: [] };
  }

  var tz = Session.getScriptTimeZone();
  var when = Utilities.formatDate(sunday, tz, "EEEE d MMMM");
  var lead = days === 0 ? "today" : days === 1 ? "tomorrow" : "on " + when;

  /* Every bus on the register that could carry anybody. active is honoured:
     a bus kept on the tab for its service history must not be offered as the
     answer to a full Sunday. */
  var fleet = [];
  try {
    readBuses(ss).forEach(function (b) {
      if (b && b.reg && b.active !== false && b.seats) fleet.push({ reg: b.reg, seats: b.seats });
    });
  } catch (err) {}
  fleet.sort(function (a, b) { return b.seats - a.seats; });

  var lines = [], plain = [];
  if (rehearsing) {
    lines.push("<b>REHEARSAL. These are test bookings and none of these people exist.</b>",
               "&nbsp;");
    plain.push("REHEARSAL. These are test bookings and none of these people exist.", "");
  }
  lines.push("<b>More people are booked than the bus holds</b> for " + esc(lead) + ".",
             "&nbsp;");
  plain.push("More people are booked than the bus holds for " + lead + ".", "");

  tell.forEach(function (t) {
    lines.push("• <b>" + esc(t.route) + "</b> is on <b>" + esc(t.reg) +
               "</b>, which seats <b>" + t.seats + "</b>. <b>" + t.booked +
               "</b> are booked — " + t.over + " too many." +
               (t.again ? " (Worse than when you were last told.)" : ""));
    plain.push("  " + t.route + ": " + t.reg + " seats " + t.seats +
               ", " + t.booked + " booked, " + t.over + " too many.");

    var other = legs[t.route === "North" ? "South" : "North"];
    var said = "";

    /* 1. Swapping the two routes' buses. The only move that needs no third
          vehicle, and on a two bus fleet it is usually the only move there is.
          Offered ONLY when it fixes both legs: moving the problem from one
          bus to the other is not a fix, it is a different email next week. */
    if (other && other.reg && other.seats &&
        String(other.reg).toUpperCase() !== String(t.reg).toUpperCase() &&
        other.seats >= t.booked && t.seats >= other.booked) {
      said = "Swapping the two buses fits both: " + other.reg + " on " + t.route +
             " (" + other.seats + " seats, " + t.booked + " booked) and " +
             t.reg + " on " + other.route +
             " (" + t.seats + " seats, " + other.booked + " booked).";
    }

    /* 2. A bus that is on neither route that day. Rare on this fleet, but it
          is the right answer when it exists and costs nothing to look for. */
    if (!said) {
      var spare = null;
      fleet.forEach(function (b) {
        if (spare) return;
        var R = String(b.reg).toUpperCase();
        if (R === String(t.reg).toUpperCase()) return;
        if (other && other.reg && R === String(other.reg).toUpperCase()) return;
        if (b.seats >= t.booked) spare = b;
      });
      if (spare) said = spare.reg + " is on neither route that day and seats " +
                        spare.seats + ", which would take them all.";
    }

    /* 3. Nothing in the register fits. Said out loud, because silence here
          reads as "no action needed" and the action is a second trip or a
          phone call, neither of which this app can make. */
    if (!said) {
      said = "No swap in the register fits them all. It needs a second trip, " +
             "another vehicle, or a word with the " + t.over +
             " who booked last.";
    }

    lines.push("&nbsp;&nbsp;&nbsp;" + esc(said));
    plain.push("    " + said);
  });

  lines.push("&nbsp;");


  /* WHAT WAS HERE AND IS NOT ANY MORE.

     A closing line reading "Booked is not boarded. Some will not turn up, and
     some who turn up did not book." It was kept for a real reason: without it
     a bus gets moved for four people who were never coming.

     It is still a lecture, and it went to the one person who already knows.
     Every email carried it whether or not it was needed, and a paragraph that
     is read past every time trains somebody to read past the paragraph above
     it as well.

     The fact it was standing in for is on the line that matters anyway: the
     count says "booked", never "travelling", and the number of people who
     will not fit is given as a number. Whoever inherits this can read the
     reasoning in README.md, which is where reasoning belongs. */


  /* SENT FIRST, remembered second.

     Writing the sent-once stamp before the send meant a single failed
     MailApp call — a daily quota, a transient service error — silenced this
     permanently: the next tick read the stamp, decided it had already been
     said, and returned. The most consequential alert in the file was the one
     least able to survive a bad minute at Google. If the send throws, nothing
     is written down and the next tick tries again.

     The phones first: their id is what was worked out, so if the email then
     throws and the next tick comes round again, the live server has already
     had this one and refuses it rather than buzzing everybody twice. A test
     from the menu or a rehearsal gets an id of its own every time. */
  tellCoordinatorPhones({
    id: "over|" + key + "|" + (force || rehearsing ? Date.now() + "|" : "") +
        tell.map(function (t) { return t.route + ":" + t.booked; }).join(","),
    kind: "overbooked",
    title: (rehearsing ? "REHEARSAL: " : "") +
           tell.map(function (t) { return t.route + " overbooked, " + t.booked + " of " + t.seats; }).join("; "),
    body: "For " + when + ". Move a bus or a booking in the coordinator's app." });
  if (!COORDINATOR_EMAIL) {
    if (!rehearsing) overbookRemember(props, sent, stamps);
    return { ran: true, sent: 0, over: tell, rehearsal: rehearsing, phones: true };
  }
  sendMail({
    to: COORDINATOR_EMAIL,
    subject: (rehearsing ? "REHEARSAL \u2014 " : "") + "Minibus: " +
             tell.map(function (t) {
               return t.route + " overbooked, " + t.booked + " of " + t.seats;
             }).join("; ") + ", " + when,
    body: plain.join("\n"),
    /* Amber. Something to arrange, not a bus that has been stopped. */
    htmlBody: htmlShell("More booked than seats", "#8A6116", lines,
                        "Open the rota", ROTA_SHEET)
  });

  /* A rehearsal's numbers are not remembered. Writing them down would let a
     test morning silence the real alert for the same Sunday afterwards, which
     is the one way this feature could do actual harm. */
  if (!rehearsing) overbookRemember(props, sent, stamps);
  return { ran: true, sent: 1, over: tell, rehearsal: rehearsing };
}

/* Writes the sent-once stamps back, pruned. Separated only so the two exits
   above cannot drift apart on the pruning rule. */
function overbookRemember(props, sent, stamps) {
  var any = false;
  Object.keys(stamps).forEach(function (k) {
    any = true;
    if (stamps[k] === null) delete sent[k]; else sent[k] = stamps[k];
  });
  if (!any) return;
  /* Two stamps a week. Kept to a few months so the property cannot grow
     without bound; oldest first, because the keys begin with the date. */
  var keys = Object.keys(sent).sort();
  while (keys.length > 60) { delete sent[keys.shift()]; }
  try { props.setProperty("overbookSent", JSON.stringify(sent)); } catch (err) {}
}

/* Run by hand from the menu. Ignores both the day window and the sent-once
   memory, so the wording can be seen without waiting for a full bus, and says
   plainly whether an email actually went rather than assuming one did. */
function overbookingCheckNow() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var key = dateToKey(sundayOf(new Date()));
  var say = [];
  ["North", "South"].forEach(function (route) {
    var f = null;
    try { f = seatsFor(ss, key, route); } catch (err) {}
    if (!f) { say.push(route + ": could not be worked out."); return; }
    say.push(route + ": " + (f.reg || "no bus set") +
             (f.seats ? ", seats " + f.seats : ", seats unknown") +
             ", booked " + f.booked +
             (f.seats && f.booked > f.seats ? "  ← OVER by " + (f.booked - f.seats) : ""));
  });

  var out = null;
  try { out = overbookingAlert(true); } catch (err) {
    ui.alert("Seats for " + key,
      say.join("\n") + "\n\nThe email could not be sent: " +
      String((err && err.message) || err),
      ui.ButtonSet.OK);
    return;
  }

  var tail;
  if (!out || out.ran === false) {
    tail = "No email: " + ((out && out.why) || "it did not run") + ".";
  } else if (out.sent) {
    tail = "An email has just gone to " + COORDINATOR_EMAIL + ".";
  } else {
    tail = "No email, because neither route is over.";
  }

  ui.alert("Seats for " + key, say.join("\n") + "\n\n" + tail, ui.ButtonSet.OK);
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
    /* Defects only. An advisory is on the same tab now, and counting it here
       would put a number in front of you that is not the number of things
       somebody has to book work against. */
    var n = (open[reg] || []).filter(function (d) { return d.kind !== "Advisory"; }).length;
    var tail = n ? " &middot; <b>" + n + " open defect" + (n > 1 ? "s" : "") + "</b>" : "";
    if (c) {
      lines.push("<b>" + reg + "</b> &mdash; checked by " + (c.driver || "someone") +
                 (c.outcome ? " (" + c.outcome +
                   (c.authBy ? " by " + esc(c.authBy) : "") + ")" : "") +
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
  var faults = all.filter(function (d) { return d.kind !== "Advisory"; });
  var watch  = all.filter(function (d) { return d.kind === "Advisory"; })
                  .sort(function (a, b) { return (b.crit ? 1 : 0) - (a.crit ? 1 : 0); });
  if (faults.length) {
    lines.push("&nbsp;");
    lines.push("<b>Open defects</b>");
    faults.slice(0, 15).forEach(function (d) {
      lines.push("&bull; " + esc(d.reg) + ": " + esc(d.item) + (d.crit ? " (critical)" : "") +
                 (d.note ? " &mdash; " + esc(d.note) : ""));
    });
    if (faults.length > 15) lines.push("&bull; and " + (faults.length - 15) + " more");
  }
  /* Critical ones first and in bold. They did not stop the bus, by the
     setting, and this list is where somebody decides whether they should. */
  if (watch.length) {
    lines.push("&nbsp;");
    lines.push("<b>Open advisories</b>");
    watch.slice(0, 15).forEach(function (d) {
      var text = esc(d.reg) + ": " + esc(d.item) + (d.crit ? " (critical)" : "") +
                 (d.note ? " &mdash; " + esc(d.note) : "");
      lines.push("&bull; " + (d.crit ? "<b>" + text + "</b>" : text));
    });
    if (watch.length > 15) lines.push("&bull; and " + (watch.length - 15) + " more");
  }

  sendMail({
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
    { fn: "onCheckEditPush",  label: "Outcome changes reach the buses", install: installCheckOverride },
    { fn: "nightlyMaintenance", label: "Nightly rota tidy-up, 3am",     install: installNightlyMaintenance },
    { fn: "missingCheckAlert",  label: "Sunday 10:45, went out unchecked", install: installMissingCheckAlert },
    { fn: "liveSync",           label: "Live server sync, every 5 minutes",  install: installLiveSync },
    { fn: "onEditLive",         label: "Sheet edits reach the live server",  install: installLivePush }
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

   How many days before to send.

   THE WEEK gives somebody time to ask for a swap while there is still a rota
   to change.

   TWO DAYS — Friday — is the one that catches a man who has forgotten, with a
   whole weekend still in hand to find cover.

   IT USED TO BE ONE DAY, and one day stopped making sense once the calendar
   alarm moved to twenty-four hours: that alarm now fires on SATURDAY MORNING,
   about two hours after a Saturday email would have landed, and two notices
   about the same duty within two hours is one of them being ignored. Moving
   the email to Friday spreads the four warnings across four separate moments
   instead of bunching two of them.

   Nothing here is the reminder ON the day. That is the "You are driving
   today" push, Sunday between half seven and half eight, and it is why none
   of these has to be. */
var REMIND_DAYS = [7, 2];

var BUS_ADDRESS = "3-5 Chester Road, Liverpool L6 4DY";

/* THE CADENCE IN WORDS, BUILT FROM REMIND_DAYS ITSELF.

   This was a sentence typed out by hand in the Is everything working? report,
   and the moment the array moved from [7, 1] to [7, 2] that sentence started
   telling the coordinator something the code had stopped doing. A menu that
   describes the schedule wrongly is worse than one that says nothing about
   it, because it is the only place he would ever think to check.

   Change the array and every sentence built from it changes with it. */
var REMIND_WORDS = ["", "the day", "two days", "three days", "four days",
                    "five days", "six days", "a week"];

function remindDaysPhrase() {
  var say = REMIND_DAYS.slice()
    .sort(function (a, b) { return b - a; })
    .map(function (n) { return (REMIND_WORDS[n] || n + " days") + " before"; });
  if (!say.length) return "never";
  if (say.length === 1) return say[0];
  return say.slice(0, -1).join(", ") + " and again " + say[say.length - 1];
}

function dutyReminders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureRotaSheets(ss);

  var drivers = readDrivers(ss);
  var emails = {};
  drivers.forEach(function (d) { if (d.active && d.email) emails[d.name] = d.email; });
  if (!Object.keys(emails).length) return { sent: [], already: [], off: [] };

  var byDate = {};
  readRotaRows(ss).forEach(function (r) { byDate[r.date] = r; });
  var pattern = { north: primaryPattern(drivers, "North"),
                  south: primaryPattern(drivers, "South") };

  var props = PropertiesService.getScriptProperties();
  var sent = {};
  try { sent = JSON.parse(props.getProperty("remindersSent") || "{}"); } catch (err) {}
  var report = { sent: [], already: [], off: [] };

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

      /* THE COLUMN SAID HIS NAME AND NOBODY ASKED THE STATUS.

         So a Sunday marked Cancelled/declined still emailed its driver "You
         are down to drive", a week out and again on the Friday, with a
         calendar file that alarmed him on the Saturday morning. The passenger
         side has always read this column — a cancelled route tells the people
         who booked it and refuses further seats — and the one person who has
         to physically turn up was the one nobody told.

         It also covers the Sunday somebody has been excused from. Approving a
         cover sets the morning to "No driver assigned" and leaves his name in
         the scheduled column on purpose, because that name is how you know
         whose Sunday you are covering and how you put it back if the request
         is reversed. Clearing it would destroy the record to silence a
         reminder; reading the status silences the reminder and keeps it. */
      if (row && dutyIsOff(row.status, slot.route)) {
        report.off.push(slot.who + ", " + slot.route + " (" + row.status + ")");
        return;
      }

      /* Sent once. The trigger runs daily, but somebody may also run it by
         hand, and nobody wants the same reminder twice. */
      var stamp = key + "|" + days + "|" + slot.who;
      if (sent[stamp]) { report.already.push(slot.who + ", " + slot.route); return; }

      /* Resolved at send time, from the same rule the app draws from. Two
         calls a reminder day, and only on the two days of the week that send
         anything at all. */
      var busNow = "";
      try { busNow = busFor(ss, key, slot.route).reg || ""; } catch (err) { busNow = ""; }
      sendDutyEmail(emails[slot.who], slot.who, target, days, slot.was, slot.route, busNow);
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
 * REMIND_DAYS is [7, 2], and a reminder only goes when today plus one of
 * those lands on a Sunday. So the two days that ever send anything are the
 * Sunday a week before, and the FRIDAY. Every other day of the week sends
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

/* bus is the registration that leg is down for, or "" when nothing can be
   resolved. Named because a driver had no way of knowing which vehicle was
   his until he had signed in and begun a walkaround — by which point he is
   standing at a bus holding a key he chose on an assumption.

   Said here AND on the rota screen, deliberately, and they are not redundant.
   This email is a photograph: it is right when it is sent and it does not
   change afterwards, so a bus swapped on the Rota tab on the Saturday leaves
   it quietly wrong. The screen re-reads the record every time it is opened.
   The line below says which of the two to believe, which is the only thing
   that makes it safe to send a registration in an email at all. */
function sendDutyEmail(to, who, sunday, daysAhead, covering, route, bus) {
  var tz = Session.getScriptTimeZone();
  var when = Utilities.formatDate(sunday, tz, "EEEE d MMMM yyyy");
  /* "in 7 days" is a machine counting. A week is how a man says it, and it is
     also how he hears it — "next Sunday" with a date beside it. The two day
     notice keeps the plain number, because "in a couple of days" is the one
     phrasing here that could be read as either. */
  var lead = daysAhead === 1 ? "tomorrow"
           : daysAhead === 7 ? "in a week"
           : "in " + daysAhead + " days";
  bus = String(bus || "").trim();

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
  if (bus) lines.push("Bus: <b>" + esc(bus) + "</b>");
  if (covering) lines.push("Covering for " + esc(covering) + ".");
  lines.push("&nbsp;");
  if (bus) {
    lines.push("Buses can change during the week \u2014 check the app on the day.");
    lines.push("&nbsp;");
  }
  lines.push(bigLink(calendarLink(sunday, covering, route, bus), "Add to my calendar"));
  lines.push("If you cannot make it, ask in the app or ring the coordinator.");

  /* Built by pushing rather than by a list of ternaries.

     The ternary version emitted "" for every field it skipped, so a driver
     with no cover recorded got a stray blank line where the cover would have
     been — and adding the bus line made it two. Blank lines in a plain text
     email are its only punctuation; they should mean a paragraph break and
     nothing else. */
  var rows = ["You are down to drive the minibus" + onPlain + " " + lead + ".",
              "", when];
  if (bus) rows.push("Bus: " + bus);
  if (covering) rows.push("Covering for " + covering + ".");
  if (bus) rows.push("", "Buses can change during the week \u2014 check the app on the day.");
  rows.push("", "If you cannot make it, ask in the app or ring the coordinator.");
  var plain = rows.join("\n");

  sendMail({
    to: to,
    subject: "Minibus duty" + (route ? ": " + route : "") + " " +
             (daysAhead === 1 ? "tomorrow" : "on " + when),
    body: plain,
    htmlBody: htmlShell("Your minibus duty", "#1B3A57", lines, ""),
    attachments: [{
      fileName: "minibus-duty.ics",
      mimeType: "text/calendar",
      content: dutyIcs(sunday, who, covering, route, bus)
    }]
  });
}

/**
 * The duty as a calendar file. Timed at the real departure when the Bus Stops
 * tab has one and all-day when it does not, with one alarm DUTY_ALARM_HOURS
 * ahead of whichever of those it turned out to be.
 */
function dutyIcs(sunday, who, covering, route, bus) {
  var tz = Session.getScriptTimeZone();
  bus = String(bus || "").trim();
  var day = Utilities.formatDate(sunday, tz, "yyyyMMdd");
  var after = new Date(sunday); after.setDate(after.getDate() + 1);
  var dayAfter = Utilities.formatDate(after, tz, "yyyyMMdd");
  var stamp = Utilities.formatDate(new Date(), "UTC", "yyyyMMdd'T'HHmmss'Z'");

  /* The calendar entry is the thing he actually sees on his lock screen, the
     morning before he leaves. The registration belongs here more than it
     belongs in the email. */
  var desc = "You are down to drive the church minibus" +
             (route ? " on " + route : "") + "." +
             (bus ? " Bus: " + bus + "." : "") +
             (covering ? " Covering for " + covering + "." : "") +
             (bus ? " Buses can change during the week: check the app on the day." : "");

  /* THE REAL DEPARTURE TIME, WHEN THE TAB HAS ONE.

     This was an all-day event, and an all-day event has no hour in it to
     count back from: a client fires the alarm from the START OF THE DAY, so
     twenty-four hours lands at midnight going into Saturday, in the middle of
     the night, a day and a half early. Timed at 09:52 the same alarm lands on
     SATURDAY MORNING at the hour he would be leaving, with a whole waking day
     in it to ring somebody if he cannot make it. DUTY_ALARM_HOURS, at the top
     of this file, is where that is set and why.

     It also puts the duty in the right place in his week rather than as a
     banner across the top of the day, and a phone that shows the next three
     events shows this one with a time against it.

     NO DEPART ROW ON THE BUS STOPS TAB MEANS NO TIME, and the entry stays
     all-day exactly as it was. That is not a fallback bolted on: a route
     whose departure nobody has written down has no departure time to put in
     somebody's calendar, and inventing 09:30 from the booking cutoff would be
     telling him a time that is not his. */
  var depart = null;
  try { depart = departStopFor(SpreadsheetApp.getActiveSpreadsheet(), route); }
  catch (err) { depart = null; }

  var from = depart && depart.time ? stopMomentOn(dateToKey(sunday), depart.time) : null;
  var till = null;
  if (from) {
    /* Until the route gets back, when the tab says so, and two hours
       otherwise. The length only decides how it draws in a week view;
       nothing depends on it. */
    var arr = null;
    try {
      var all = readBusStops(SpreadsheetApp.getActiveSpreadsheet());
      for (var i = 0; i < all.length; i++) {
        if (all[i].arrival && all[i].route === route && all[i].time) { arr = all[i]; break; }
      }
    } catch (err2) { arr = null; }
    till = arr ? stopMomentOn(dateToKey(sunday), arr.time) : null;
    if (!till || till.getTime() <= from.getTime()) {
      till = new Date(from.getTime() + 2 * 3600000);
    }
  }

  /* UTC with a Z on it, so no VTIMEZONE block is needed and no client has to
     be trusted to know what Europe/London was doing that week. */
  var utc = function (d) { return Utilities.formatDate(d, "UTC", "yyyyMMdd'T'HHmmss'Z'"); };

  var when = from
    ? ["DTSTART:" + utc(from), "DTEND:" + utc(till)]
    : ["DTSTART;VALUE=DATE:" + day, "DTEND;VALUE=DATE:" + dayAfter];

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Minibus//Rota//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:minibus-" + day + "-" + String(who).replace(/[^A-Za-z0-9]/g, "") + "@minibus",
    "DTSTAMP:" + stamp,
    /* The UID is deliberately stable — one duty, one calendar entry, however
       many times it is sent. That was harmless while the entry only ever said
       the date. It now carries the registration, which CAN change: a bus
       swapped on the Rota tab sends a fresh file through notifyDutyChange, and
       a client handed the same UID with no sequence number keeps the entry it
       already has. The driver's lock screen would then show the old bus, which
       is precisely the failure this was added to prevent.

       Minutes since the epoch: always higher than the last send, never large
       enough to overflow the 32 bit signed integer the format allows. */
    "SEQUENCE:" + Math.floor(Date.now() / 60000),
    "LAST-MODIFIED:" + stamp,
    when[0],
    when[1],
    /* A timed duty is time he is not free; an all-day one never was. */
    from ? "TRANSP:OPAQUE" : "TRANSP:TRANSPARENT",
    "SUMMARY:" + icsEscape((route ? "Minibus duty: " + route : "Minibus driving duty") +
                           (bus ? " (" + bus + ")" : "")),
    "DESCRIPTION:" + icsEscape(desc),
    "LOCATION:" + icsEscape(BUS_ADDRESS),
    "BEGIN:VALARM",
    "TRIGGER:-PT" + DUTY_ALARM_HOURS + "H",
    "ACTION:DISPLAY",
    "DESCRIPTION:" + icsEscape(
        DUTY_ALARM_HOURS >= 24 ? "Minibus duty tomorrow morning"
      : from ? "Minibus duty in the morning" : "Minibus duty tomorrow"),
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
  var r = remindReport();
  SpreadsheetApp.getUi().alert(r.title, r.text, SpreadsheetApp.getUi().ButtonSet.OK);
}

/* Sends whatever duty reminders are due today and says what happened. The
   menu shows the words; the coordinator's app shows the same as parts. */
function remindReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var TITLE = "Duty reminders";
  var withEmail = readDrivers(ss).filter(function (d) { return d.active && d.email; }).length;
  if (!withEmail) {
    var none = "Nobody has an email address yet.\n\nFill the Email column on the " +
               "Drivers tab. Anyone left blank simply gets no reminder.";
    return { title: TITLE, lead: none, sections: [], tone: "bad", text: none };
  }
  /* This used to run and then toast "Reminders checked", which read as "mail
     has gone out" on the six days a week when nothing is due. Nothing was
     wrong; the reporting was. */
  var out = dutyReminders() || { sent: [], already: [], off: [] };
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
  /* SAID OUT LOUD, because a reminder that is deliberately not sent looks
     exactly like one that failed. Anybody checking this screen because a
     driver says he heard nothing should find the answer here rather than
     working backwards from the Rota. */
  if (out.off && out.off.length) {
    msg += "Not sent, because the Rota says the morning is not theirs:\n  \u2022  " +
           out.off.join("\n  \u2022  ") + "\n\n";
  }
  if (!out.sent.length && !out.already.length && !(out.off && out.off.length)) {
    msg += "Nothing was due today.\n\nReminders go out " + remindDaysPhrase() +
           " a Sunday. On any other day there is nothing to send, which is " +
           "what has just happened.\n\n";
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

  var sections = [];
  if (out.sent.length) sections.push({ head: "Sent now", tone: "good", lines: out.sent });
  if (out.already.length) sections.push({ head: "Already sent earlier, so not sent again", lines: out.already });
  if (out.off && out.off.length) sections.push({ head: "Not sent: the Rota says the morning is not theirs", lines: out.off });
  if (noAddress.length) sections.push({ head: "No email address, so never reminded", tone: "bad", lines: noAddress });
  return {
    title: TITLE,
    lead: out.sent.length ? out.sent.length + " sent now." :
          (!out.already.length && !(out.off && out.off.length)) ?
            "Nothing was due today. Reminders go out " + remindDaysPhrase() + " a Sunday." :
            "Nothing new to send.",
    tone: "",
    sections: sections,
    foot: next ? "Next: " + Utilities.formatDate(next.when, tz, "EEEE d MMMM") +
                 (next.today ? " (today)" : "") + ", for Sunday " +
                 Utilities.formatDate(next.sunday, tz, "d MMMM") + "." : "",
    text: msg
  };
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

      var key = anyToKey(sh.getRange(row, rc.date).getValue());
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
      /* `south` is already the answer. Testing the column number against 5
         could never be true once the bus columns moved South to 6, so every
         duty-change email named North Liverpool whichever route it was. */
      notifyDutyChange(ss, key, before, after,
                       south ? "South Liverpool" : "North Liverpool");
      return;
    }

    if (name === REQUESTS_SHEET) {
      var r = e.range.getRow(), c = e.range.getColumn();
      var qc = requestCols(sh);
      if (r < 2 || (c !== qc.status && c !== qc.replacement)) return;

      var st = String(sh.getRange(r, qc.status).getValue() || "").trim();
      var k = anyToKey(sh.getRange(r, qc.sunday).getValue());
      if (!k) return;
      var reqDriver = String(sh.getRange(r, qc.driver).getValue() || "").trim();

      /* A TURNED DOWN REQUEST IS STILL AN ANSWER, AND HE IS WAITING FOR IT.

         This whole branch used to return unless the word was "Approved", so a
         driver who asked to be covered and was refused heard nothing at all.
         He could see it in the app — his row goes red — but that needs him to
         go and look, and the point of every other message in this file is
         that nobody has to remember to be told.

         Gated on the STATUS column alone. Filling in a replacement weeks
         later is a fact about the cover and has its own email below; it is
         not the decision being made again. */
      if (st === "Rejected") {
        if (c === qc.status) notifyRequestDecided(ss, k, reqDriver, sh, r, qc, "Rejected");
        return;
      }
      if (st !== "Approved") return;

      var replacement = String(sh.getRange(r, qc.replacement).getValue() || "").trim();
      if (!replacement) {
        /* APPROVED, WITH NOBODY ASSIGNED YET — and this is the ordinary case
           from the email link, not an edge. That page has two buttons and no
           box to name a cover in, deliberately: choosing a replacement is a
           decision about the whole rota and it belongs in front of the rota.
           So every approval that arrives from an inbox lands here.

           The duty change email below has nothing to say about it — there is
           no new driver to tell — but the man who ASKED is still waiting, and
           until now he got nothing at all. He is told when the cover is
           assigned too: filling that column in is an edit to this tab and
           comes back through this same function.

           NOT FOR A SWAP. An approved swap has no replacement either, and it
           has already emailed both drivers from inside applySwap. A second
           note saying cover is being arranged would contradict it. */
        var kind = String(sh.getRange(r, qc.type).getValue() || "").trim();
        if (c === qc.status && kind !== "Request a swap") {
          notifyRequestDecided(ss, k, reqDriver, sh, r, qc, "Approved");
        }
        return;
      }
      var rota2 = ss.getSheetByName(ROTA_SHEET);
      var rRow2 = rota2 ? findRotaRow(rota2, k) : 0;
      /* routeColumns says which route it found, rather than leaving the caller
         to infer it from a column number. */
      var rt = (rota2 && rRow2 &&
                routeColumns(ss, rota2, rRow2, reqDriver).route === "South")
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

  /* A CALLED-OFF MORNING HAS NO DUTY TO HAND OVER. Swapping a name on a
     Sunday that is not running would otherwise tell somebody he is "now down
     to drive" a bus that is not going anywhere, with a calendar file to match.

     routeCalledOff and not dutyIsOff, deliberately: this runs inside the edit
     that is being made, and "No driver assigned" is a state a row sits in for
     the second between clearing one name and typing the next. */
  try {
    var rr = null;
    readRotaRows(ss).forEach(function (x) { if (x.date === key) rr = x; });
    if (rr && routeCalledOff(rr.status, route)) return;
  } catch (err) {}

  var emails = {};
  readDrivers(ss).forEach(function (d) { if (d.active && d.email) emails[d.name] = d.email; });

  var when = Utilities.formatDate(sunday, Session.getScriptTimeZone(), "EEEE d MMMM yyyy");
  var on = route ? " (" + esc(route) + ")" : "";
  var onPlain = route ? " (" + route + ")" : "";

  /* A man picking up a cover needs to know which bus as much as the man who
     was rostered, and he has had less warning. */
  var busNow = "";
  try { busNow = busFor(ss, key, route).reg || ""; } catch (err) { busNow = ""; }

  if (before && emails[before]) {
    var offLines = [
      "You were down to drive on <b>" + esc(when) + "</b>" + on + ".",
      "&nbsp;",
      after ? ("That has changed. " + esc(after) + " is driving instead.")
            : "That has changed and somebody else will be driving.",
      "&nbsp;",
      "Nothing is needed from you."
    ];
    sendMail({
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
      busNow ? ("Bus: <b>" + esc(busNow) + "</b>") : "",
      /* The caveat goes wherever the registration goes: the man picking up a
         cover has had the least warning and the most chance of it moving. */
      busNow ? "Buses can change during the week \u2014 check the app on the day." : "",
      before ? ("Covering for " + esc(before) + ".") : "",
      "&nbsp;",
      bigLink(calendarLink(sunday, before, route, busNow), "Add to my calendar"),
      "If you cannot make it, ask in the app or ring the coordinator."
    ].filter(function (l) { return l !== ""; });

    sendMail({
      to: emails[after],
      subject: "Minibus duty" + (route ? ": " + route : "") + " on " + when,
      body: "You are now down to drive the minibus on " + when + onPlain + ".\n\n" +
            (busNow ? "Bus: " + busNow + ". Buses can change during the week \u2014 " +
                      "check the app on the day.\n\n" : "") +
            (before ? "Covering for " + before + ".\n\n" : "") +
            "If you cannot make it, ask in the app or ring the coordinator.",
      htmlBody: htmlShell("You are now driving", "#1B3A57", onLines, ""),
      attachments: [{
        fileName: "minibus-duty.ics",
        mimeType: "text/calendar",
        content: dutyIcs(sunday, after, before, route, busNow)
      }]
    });
  }
}

/**
 * THE ANSWER TO A QUESTION A DRIVER ASKED, sent to the man who asked it and
 * to nobody else.
 *
 * Two answers land here. "Rejected", which used to reach nobody at all. And
 * "Approved" with no cover assigned yet, which is what every approval made
 * from the email link looks like, and which the duty change email has nothing
 * to say about because there is no new driver in it to tell.
 *
 * NOT TO THE OTHER DRIVER IN A SWAP. He was never told it had been proposed,
 * so a note saying it had been refused would be the first he heard of the
 * whole thing, and the only action it suggests is asking somebody what it was
 * about.
 *
 * NO SEVEN DAY HORIZON, and that is the difference between this and
 * notifyDutyChange. That one stays quiet about a Sunday more than a week out
 * because nobody has been told who is driving it yet, so there is nothing to
 * correct. This is the answer to a question a driver actually asked. He is
 * waiting for it whether the Sunday is next week or in two months.
 */
function notifyRequestDecided(ss, key, who, sh, row, qc, decision) {
  var no = String(decision || "") !== "Approved";
  who = String(who || "").trim();
  if (!who) return;

  var sunday = keyToDate(key);
  var today = new Date();
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (sunday < today) return;                                  // been and gone

  var emails = {};
  readDrivers(ss).forEach(function (d) { if (d.active && d.email) emails[d.name] = d.email; });
  if (!emails[who]) return;

  var when = Utilities.formatDate(sunday, Session.getScriptTimeZone(), "EEEE d MMMM yyyy");

  var asked = "";
  try { asked = String(sh.getRange(row, qc.type).getValue() || "").trim(); } catch (err) {}

  /* ONLY SAY HE IS STILL DRIVING IF THE ROTA SAYS HE IS.
 
     "You are still down to drive" is the useful sentence and it is the one
     that must never be guessed at: a request can be refused on a Sunday that
     has since been covered by somebody else, or cancelled altogether, and
     telling a man to turn up to a morning he is not on would be worse than
     sending him nothing. So it is read back off the Rota, and when it does
     not say his name the email simply does not claim it. */
  var still = false, route = "", bus = "";
  try {
    var rota = ss.getSheetByName(ROTA_SHEET);
    var rRow = rota ? findRotaRow(rota, key) : 0;
    if (rota && rRow) {
      var cols = routeColumns(ss, rota, rRow, who);
      var sched = String(rota.getRange(rRow, cols.scheduled).getValue() || "").trim();
      var cover = String(rota.getRange(rRow, cols.cover).getValue() || "").trim();
      if ((cover || sched) === who) {
        still = true;
        route = cols.route + " Liverpool";
        try { bus = busFor(ss, key, route).reg || ""; } catch (e2) { bus = ""; }
      }
    }
  } catch (err) {}

  var what = "Your request" + (asked ? " (" + asked + ")" : "") + " for ";
  var verb = no ? " was not approved." : " has been approved.";

  var lines = [what + "<b>" + esc(when) + "</b>" + verb, "&nbsp;"];
  var plain = [what + when + verb, ""];

  if (no) {
    /* THE ONE SENTENCE HE ACTUALLY WANTS, and the one that must never be
       guessed at. A request can be refused on a Sunday somebody else has
       since picked up, or on one that has been cancelled outright, and
       telling a man to turn up to a morning he is not on would be worse than
       sending him nothing. So it is read back off the Rota, and when the
       Rota does not say his name the email does not claim it. */
    if (still) {
      lines.push("You are still down to drive" +
                 (route ? " on <b>" + esc(route) + "</b>" : "") + " that morning.");
      plain.push("You are still down to drive" + (route ? " on " + route : "") + " that morning.");
      if (bus) { lines.push("Bus: <b>" + esc(bus) + "</b>"); plain.push("Bus: " + bus + "."); }
      lines.push("&nbsp;");
      lines.push("If you still cannot make it, ring the coordinator.");
      plain.push("", "If you still cannot make it, ring the coordinator.");
    } else {
      lines.push("Open the app to see who is down for that morning.");
      plain.push("Open the app to see who is down for that morning.");
    }
  } else {
    lines.push("Nobody is covering it yet.");
    plain.push("Nobody is covering it yet.");
    /* SAID PLAINLY, BECAUSE APPROVING DOES NOT TAKE HIS NAME OFF THE ROTA.
       It sets the morning to "No driver assigned" and leaves him in the
       scheduled column, so the duty reminders still have his name until
       somebody replaces it. A man who reads "approved" and stops expecting
       them would be right to be annoyed on the Saturday. */
    if (still) {
      lines.push("&nbsp;");
      lines.push("Your name is still on that morning until somebody takes it.");
      plain.push("", "Your name is still on that morning until somebody takes it.");
    }
  }

  sendMail({
    to: emails[who],
    subject: "Minibus: your request for " + when +
             (no ? " was not approved" : " has been approved"),
    body: plain.join("\n"),
    htmlBody: htmlShell(no ? "Request not approved" : "Request approved",
                        no ? "#5C6672" : "#1B3A57", lines, "")
  });
}

/* ==========================================================================
   THE OUTCOME COLUMN IS A WAY OUT, AND UNTIL NOW IT REACHED NOTHING
   ==========================================================================
   20 September 2026. A coordinator whose own walkaround stopped the bus went
   to the Checks tab, changed the outcome by hand, and watched nothing happen.
   The reason was one line: pushCheckToWorker had exactly one caller, inside
   handleCheck, so the ONLY thing that ever told the live server about a check
   was the check itself. Editing the cell changed the spreadsheet and left
   every phone still looking at a stopped bus.

   THIS CANNOT LIVE IN THE ORDINARY onEdit. That is a simple trigger, it runs
   with restricted permissions, and it is not allowed to make an outbound
   call. So it has its own installable trigger, exactly like the rota change
   alerts above, and if that one fails to install only this is lost.

   AUTHORISING IS NOT CLOSING. Nothing here touches a defect row. The fault
   stays Open on the Defects tab and the garage still sees it. */
function onCheckEditPush(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== CHECKS_SHEET) return;

    var c = colsSoft(sh, CHECKS_SHEET);
    if (!c.outcome || !c.reg) return;

    var topRow = Math.max(e.range.getRow(), 2);
    var lastRow = e.range.getRow() + e.range.getNumRows() - 1;
    var topCol = e.range.getColumn();
    var lastCol = topCol + e.range.getNumColumns() - 1;
    if (lastRow < 2) return;
    if (topCol > c.outcome || lastCol < c.outcome) return;

    var who = "";
    try { who = String(Session.getActiveUser().getEmail() || ""); } catch (err) {}
    var day = dateToKey(new Date());
    var edits = [], rows = {}, blank = 0;

    for (var row = topRow; row <= lastRow; row++) {
      var reg = String(sh.getRange(row, c.reg).getValue() || "").trim();
      if (!reg) continue;

      /* Only today's rows. An outcome corrected on a check from three weeks
         ago is a correction to the record, not a decision about a bus that is
         standing in the yard now. */
      var when = checkMoment(sh.getRange(row, c.received).getValue(),
                             c.date ? sh.getRange(row, c.date).getValue() : "",
                             c.time ? sh.getRange(row, c.time).getValue() : "");
      /* checkMoment answers in milliseconds, not with a Date. */
      if (!when || dateToKey(new Date(when)) !== day) continue;

      var val = String(sh.getRange(row, c.outcome).getValue() || "").trim();
      /* A cleared cell is not a decision. Deleting STOPPED used to read as
         "ok" and release the bus. */
      if (!val) { blank++; continue; }

      var by = "";
      if (val.toUpperCase() === "AUTHORISED TO RUN") {
        by = c.authBy ? String(sh.getRange(row, c.authBy).getValue() || "").trim() : "";
        /* Nobody typed a name, so the sheet says who did it. An
           authorisation without a name on it is the one thing this must never
           produce. */
        if (!by) by = who || "Coordinator";
      }
      edits.push({ reg: reg, day: day, outcome: val, by: by, madeAt: Date.now(),
                   checkId: c.id ? String(sh.getRange(row, c.id).getValue() || "") : "",
                   inspector: c.driver ? String(sh.getRange(row, c.driver).getValue() || "").trim() : "" });
      rows[edits.length - 1] = row;
    }

    if (!edits.length) {
      if (blank) toastChecks(sh, "Not sent. Pick an outcome from the list.");
      return;
    }

    var out = null;
    try { out = workerCall("outcome", { edits: edits }); } catch (err) { out = null; }
    var answered = !!(out && out.ok === true && Array.isArray(out.results));

    /* Nothing came back. Held and sent again on the next five minute sync,
       so a decision made on the sheet is never simply lost. */
    if (!answered) {
      outcomePending(edits);
      edits.forEach(function (ed, i) { outcomeWriteRow(sh, c, rows[i], ed); });
      edits.forEach(function (ed) { if (ed.by) notifyAuthorised(outcomeMail(ed)); });
      toastChecks(sh, "The live server did not answer. It will be sent again within five minutes.");
      return;
    }

    /* An edit that was APPLIED replaces anything still waiting for that bus,
       because it is the later decision. One that was refused leaves a
       waiting edit alone: a refusal decides nothing. */
    var applied = [], stale = [], later = [], none = [];
    out.results.forEach(function (r, i) {
      var ed = edits[i];
      if (!ed) return;
      if (r && r.applied) {
        applied.push(ed.reg);
        outcomeWriteRow(sh, c, rows[i], ed);
        if (r.what === "authorised") notifyAuthorised(outcomeMail(ed));
      } else if (r && r.why === "not current") {
        stale.push(ed.reg);
      } else if (r && r.why === "superseded") {
        later.push(ed.reg);
      } else {
        /* No check for that bus on the live server yet. Held, like a call
           that got no answer, and tried again. */
        none.push(ed);
      }
    });
    if (applied.length) outcomeDropPending(applied);
    if (none.length) {
      outcomePending(none);
      none.forEach(function (ed) {
        for (var k in rows) if (edits[k] === ed) outcomeWriteRow(sh, c, rows[k], ed);
        if (ed.by) notifyAuthorised(outcomeMail(ed));
      });
    }
    toastChecks(sh,
        stale.length ? "Not sent for " + stale.join(", ") + ". A newer check for that bus is on the live server."
      : later.length ? "Not sent for " + later.join(", ") + ". A later decision about that bus is already on the live server."
      : none.length  ? "Not on the live server yet. It will be sent again within five minutes."
      :                "Sent. The drivers' phones will see it within a few seconds.");
  } catch (err) {
    /* Never let a trigger error block someone editing the sheet. */
  }
}

/* The name and time on the row, written once the decision has somewhere to
   go, and taken off again when the row stops saying Authorised to run. */
function outcomeWriteRow(sh, c, row, ed) {
  if (!row) return;
  if (ed.by) {
    if (c.authBy) sh.getRange(row, c.authBy).setValue(ed.by);
    if (c.authOn && !sh.getRange(row, c.authOn).getValue()) {
      sh.getRange(row, c.authOn).setValue(new Date()).setNumberFormat("dd/mm/yyyy hh:mm");
    }
  } else {
    if (c.authBy) sh.getRange(row, c.authBy).clearContent();
    if (c.authOn) sh.getRange(row, c.authOn).clearContent();
  }
}

function outcomeMail(ed) {
  return { reg: ed.reg, by: ed.by, inspector: ed.inspector, at: Date.now(), via: "sheet" };
}

function toastChecks(sh, text) {
  try { sh.getParent().toast(text, "Outcome", 6); } catch (err) {}
}

/* ---- outcome edits the live server did not answer ---------------------- */
var OUTCOME_PENDING = "outcomePending";

function outcomePendingRead() {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(OUTCOME_PENDING);
    var a = v ? JSON.parse(v) : [];
    return Array.isArray(a) ? a : [];
  } catch (err) { return []; }
}
function outcomePendingWrite(list) {
  try {
    var props = PropertiesService.getScriptProperties();
    if (list.length) props.setProperty(OUTCOME_PENDING, JSON.stringify(list));
    else props.deleteProperty(OUTCOME_PENDING);
  } catch (err) {}
}
/* Every change to the held list is a read and a write, and the edit trigger
   and the five minute sync can both be making one at the same moment.

   The DOCUMENT lock, not the script lock. The script lock is held by every
   check being filed, every stop tap and every booking that falls back to
   this file, and it is busiest exactly when the live server is not
   answering, which is the only time an edit is held at all. Waiting behind
   that queue and giving up would drop the edit.

   And if even this lock cannot be had, the change is made anyway. The risk
   without it is two writes crossing, rarely; the risk of giving up is a
   decision thrown away every time. */
function outcomeLocked(fn) {
  var lock = null;
  try { lock = LockService.getDocumentLock(); } catch (err) { lock = null; }
  var held = false;
  if (lock) { try { lock.waitLock(10000); held = true; } catch (err) { held = false; } }
  try { fn(); return true; }
  finally { if (held) { try { lock.releaseLock(); } catch (err) {} } }
}

/* One waiting edit per bus: the latest decision is the decision. */
function outcomePending(edits) {
  outcomeLocked(function () {
    var list = outcomePendingRead();
    edits.forEach(function (ed) {
      list = list.filter(function (x) {
        return String(x.reg).toUpperCase() !== String(ed.reg).toUpperCase();
      });
      list.push(ed);
    });
    outcomePendingWrite(list);
  });
}
function outcomeDropPending(regs) {
  var up = regs.map(function (r) { return String(r).toUpperCase(); });
  outcomeLocked(function () {
    outcomePendingWrite(outcomePendingRead().filter(function (x) {
      return up.indexOf(String(x.reg).toUpperCase()) === -1;
    }));
  });
}
/* From liveSync, every five minutes. Today's only: a decision about
   yesterday's bus has nothing left to decide.

   An edit is let go when it was applied, or refused for a reason that will
   not change (a newer check, a later signature). "No check yet" is tried
   again. And only the edits this call actually sent are let go: one held
   while it was waiting for an answer stays. */
function outcomeRetry() {
  var today = dateToKey(new Date());
  var list = outcomePendingRead().filter(function (x) { return x.day === today; });
  if (!list.length) {
    outcomeLocked(function () {
      outcomePendingWrite(outcomePendingRead().filter(function (x) { return x.day === today; }));
    });
    return;
  }
  var out = null;
  try { out = workerCall("outcome", { edits: list }); } catch (err) { out = null; }
  if (!out || out.ok !== true || !Array.isArray(out.results)) return;
  var done = {};
  out.results.forEach(function (r, i) {
    if (!r || !list[i]) return;
    if (r.applied || r.why === "not current" || r.why === "superseded" || r.why === "empty") {
      done[String(list[i].reg).toUpperCase() + "|" + list[i].madeAt] = true;
    }
  });
  outcomeLocked(function () {
    outcomePendingWrite(outcomePendingRead().filter(function (x) {
      return x.day === today && !done[String(x.reg).toUpperCase() + "|" + x.madeAt];
    }));
  });
}

function installCheckOverride() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "onCheckEditPush") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("onCheckEditPush")
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
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

/* The menu's box. The checking is healthReport, which the coordinator's app
   asks for as well, so there is one list of checks and two ways to read it.
   healthReport must not reach for getUi(): the app's request runs as a web
   app, where there is no screen to put a box on. */
function healthCheck() {
  var r = healthReport();
  var ui = SpreadsheetApp.getUi();
  ui.alert(r.title, r.msg, ui.ButtonSet.OK);
}

function healthReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  /* THREE BUCKETS, because two were not enough.

     bad   something is wrong and the system is not doing its job
     todo  nothing is broken, somebody has simply not done a thing yet
     good  fine

     A driver who has not turned alerts on belongs in todo. Put in bad, this
     report opened with "Minibus: 1 thing to look at" every single week until
     the last man tapped Turn on, and a report that cries every week stops
     being read. The comment lower down claimed it was "reported as work
     outstanding, not as a failure" while there was no such bucket to put it
     in, so it was a failure.

     Only bad counts in the title. */
  var good = [], bad = [], todo = [];

  /* First line, because it is the first thing to doubt after a deploy. If
     this is not the version just pasted, nothing else in this report is
     about the code that was meant to be running. */
  good.push("Script is " + SCRIPT_VERSION + ".");

  /* The other two, so this report and the line under the app's first screen
     say the same thing and a deploy can be checked from either end.

     The Worker names itself in the reply to any call, and ping is the one
     that carries the alerts roll call as well, so the two answers cost one
     round trip. It is no longer the cheapest call this file makes: the roll
     asks one small query per driver on the far side.

     A failure is reported as a failure rather than left blank, because a
     silent gap here would read as "no Worker configured", which is a
     different fault with a different fix. The app's own number can only come
     from a phone, so it is not claimed here.

     One thing this cannot see: the apps' own off switch is liveEndpoint in
     config.js, on the pages. Blank that and they stop using the Worker
     entirely while this still reports it up, because it is up. */
  try {
    if (!WORKER_URL) {
      good.push("Live server is not configured. Everything runs through here.");
    } else {
      var lv = workerCall("ping", {});
      if (lv && lv.server) good.push("Live server is " + lv.server + ".");
      else if (lv && lv.script) good.push("Live server is " + lv.script + ".");
      else bad.push("Live server did not answer. The apps fall back here, slowly.");

      /* WHO HAS NOT GOT ALERTS ON.

         Every alert depends on a driver having tapped Turn on, on that
         handset, and having let the phone ask. Until this line there was no
         way to find out except to take each phone and press the bell. Nine
         drivers trained, three of them never allowed notifications, and it
         looks identical to the alerts being broken.

         Named, not counted, because a count is not something anybody can act
         on and a name is. In the Drivers tab's own Order column, which is a
         stable order to read down and nothing more. It is deliberately NOT a
         claim about who drives next: that is worked out from the repeating
         pattern per route, so the man at the top here is next only one week
         in four, and North and South interleave.

         A driver with no alerts is not a fault in this system: he may have
         said no, and the group message still reaches him. So it goes in todo.
         Not being able to find out IS a fault, and so is an empty register.

         THREE DIFFERENT NOTHINGS, and they must not read alike:

           undefined  an older Worker that has no roll call. Say nothing.
           null       it tried and could not tell. Say that.
           []         it asked about every driver and none was missing.

         An empty list once meant all three at once, so a D1 outage and a
         wiped Drivers tab both came back as "alerts are on for every driver".
         The one thing this was built to catch was the one thing it hid. */
      if (lv && typeof lv.driversOff !== "undefined") {
        if (lv.driversOff === null) {
          /* AND NOTHING ELSE FROM THIS REPLY. driversOn, onRegister and
             passengers are counted inside the same try on the far side, so a
             throw part way through leaves them holding a partial answer. The
             tally sat outside this chain for an hour and printed a confident
             "Alerts on: 3 of 9 drivers" directly beneath "Could not read who
             has alerts on", which is two answers to one question. */
          bad.push("Could not read who has alerts on" +
                   (lv.rollError ? ": " + lv.rollError + "." : ".") +
                   " This says nothing about whether they are on.");
        } else if (!lv.onRegister) {
          /* Not "everybody has alerts". Nobody is on the register at all,
             which is a Drivers tab that has not reached the live server. */
          bad.push("No drivers on the live server's register. " +
                   "Run Rota and setup, Send everything to the live server now.");
        } else {
          if (lv.driversOff.length === 0) {
            good.push("Alerts are on for all " + lv.onRegister + " drivers on the register.");
          } else {
            todo.push("No alerts yet for: " + lv.driversOff.join(", ") +
                      ". Open the app on that phone and tap Turn on.");
          }
          good.push("Alerts on: " + lv.driversOn + " of " + lv.onRegister +
                    " drivers, " + lv.passengers + " passenger phone" +
                    (lv.passengers === 1 ? "" : "s") + ".");
        }
      }
    }
  } catch (err) {
    bad.push("Live server did not answer: " + ((err && err.message) || err));
  }

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
    { fn: "onCheckEditPush",    label: "Outcome changes reach the buses" },
    { fn: "nightlyMaintenance", label: "Nightly rota tidy-up" },
    { fn: "missingCheckAlert",  label: "Sunday 10:45, went out unchecked" },
    { fn: "liveSync",           label: "Live server sync" },
    { fn: "onEditLive",         label: "Sheet edits reach the live server" }
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
      good.push("All " + want.length + " scheduled jobs are installed.");
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

  /* Active drivers with no PIN.

     This was invisible, and it matters more than it looks. The PIN is what
     confirms a name on a record, and a driver without one is waved through
     every gate in the app — including, since a sign-in now survives a page
     reload, on a handset somebody else picks up later in the morning. One
     blank cell quietly turns that lock back into a suggestion. */
  try {
    var noPin = readDrivers(ss)
      .filter(function (d) { return d.active && !d.pin; })
      .map(function (d) { return d.name; });
    if (noPin.length) {
      bad.push("No PIN set for: " + noPin.join(", ") +
               ". They are not asked to confirm their name, so anything done " +
               "on a phone they are signed in on is recorded as them. Put a " +
               "four digit number in the PIN column on the Drivers tab.");
    } else {
      good.push("Every active driver has a PIN.");
    }
  } catch (err) { /* the Drivers tab has its own check above */ }

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
             ". The tracking is open for it, and its test seats are on the Bus " +
             "Bookings tab. End it on the Rehearsal screen of the coordinator's " +
             "app, or with Stop rehearsing on the Minibus menu.");
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

  /* ---- how big the tabs have got ---------------------------------------

     THIS IS THE GUARD, and it is the cheapest thing in this file.

     The app spent a long time getting slower every Sunday and nothing
     anywhere said so. Not one screen, not one menu item, not one email
     reported how many rows these tabs were carrying, so the only way the
     decay could ever have been found was for somebody to go looking through
     the code for it \u2014 which is not a plan, it is luck.

     A count per tab means the next time this starts happening it announces
     itself here, to whoever presses this button because something feels
     wrong. The thresholds are deliberately generous: this is a smoke alarm,
     not a rule. */
  try {
    var LIVE_TABS = [TRIP_SHEET, BOOKINGS_SHEET, CHECKS_SHEET,
                     DEFECTS_SHEET, REQUESTS_SHEET, ROTA_SHEET];
    var sizes = [], swollen = [];
    LIVE_TABS.forEach(function (name) {
      var t = ss.getSheetByName(name);
      if (!t) return;
      var n2 = Math.max(0, t.getLastRow() - 1);
      sizes.push(name + " " + n2);
      /* Roughly three times the biggest retention window in archivePlan. If
         a tab is past this, either the archiver is not running or its window
         is wrong for how this church actually uses the app. */
      if (n2 > 2000) swollen.push(name + " (" + n2 + " rows)");
    });
    if (sizes.length) good.push("Rows on each tab: " + sizes.join(", ") + ".");
    if (swollen.length) {
      bad.push("These tabs have grown large: " + swollen.join(", ") +
               ".\n     Every read of them costs more every week. Run " +
               "Have a look > What would be archived to see what can move.");
    }

    var props2 = PropertiesService.getScriptProperties();

    /* The live server answers the passenger page and the driver's taps now,
       so whether it is reachable belongs at the top of anybody's list. */
    var liveAt = Number(props2.getProperty("livePushedAt") || 0);
    var liveErr = props2.getProperty("liveError") || "";
    if (!WORKER_URL) {
      bad.push("No live server address is set, so the apps have nothing fast to talk to.");
    } else if (liveErr) {
      bad.push("The live server reported trouble: " + liveErr +
               "\n     Run Have a look > Is the live server working? for the detail. " +
               "Nothing is lost meanwhile — the apps fall back to what they hold.");
    } else if (liveAt) {
      good.push("Live server last sent to " + agoWords(liveAt) + ".");
    } else {
      good.push("Nothing has been sent to the live server yet. Run " +
                "Rota and setup > Send everything to the live server now.");
    }

    var ranAt = Number(props2.getProperty("archiveRanAt") || 0);
    var archErr = props2.getProperty("archiveError") || "";
    if (archErr) {
      bad.push("The last archive run had trouble: " + archErr +
               "\n     Nothing is lost by this \u2014 the mover never deletes a row " +
               "it has not first copied and read back. But it is not clearing " +
               "the tabs until it is put right.");
    } else if (ranAt) {
      var daysAgo = Math.round((Date.now() - ranAt) / 86400000);
      good.push("Records were last archived " +
                (daysAgo < 1 ? "today" : daysAgo + " day" + (daysAgo === 1 ? "" : "s") + " ago") + ".");
    } else {
      good.push("Nothing has been archived yet. It runs at 3am, or from " +
                "Rota and setup > Archive old records now.");
    }
  } catch (err) { /* a report about size must never break the report */ }

  var parts = [];
  if (bad.length)  parts.push("Needs attention:\n\n  \u2717  " + bad.join("\n\n  \u2717  "));
  if (todo.length) parts.push("Still to do:\n\n  \u2022  " + todo.join("\n\n  \u2022  "));
  if (good.length) parts.push("Fine:\n\n  \u2713  " + good.join("\n  \u2713  "));

  var msg = (bad.length || todo.length)
    ? parts.join("\n\n\n")
    : "\u2713  Everything looks right.\n\n  " + good.join("\n  ");

  var title = bad.length
    ? "Minibus: " + bad.length + " thing" + (bad.length === 1 ? "" : "s") + " to look at"
    : todo.length
      ? "Minibus: " + todo.length + " still to do"
      : "Minibus: all well";

  var sections = [];
  if (bad.length)  sections.push({ head: "Needs attention", tone: "bad", lines: bad });
  if (todo.length) sections.push({ head: "Still to do", tone: "todo", lines: todo });
  if (good.length) sections.push({ head: "Fine", tone: "good", lines: good });
  return { title: title, msg: msg, sections: sections,
           tone: bad.length ? "bad" : todo.length ? "todo" : "good",
           bad: bad, todo: todo, good: good };
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
      .addItem("Are we over on seats?", "overbookingCheckNow")
      .addItem("Check the Drivers tab", "checkDriversTab")
      .addItem("What would be archived", "archivePreview")
      .addItem("Is the live server working?", "liveCheck")
      .addItem("Check time zone", "checkTimeZoneMenu"))

    .addSubMenu(ui.createMenu("Rota and setup (safe to re-run)")
      .addItem("Set up / refresh rota", "setUpEverything")
      .addItem("Refresh dropdowns from Drivers tab", "refreshDropdownsMenu")
      .addItem("Add a Sunday to the rota", "addSunday")
      .addItem("Extend rota further ahead", "extendRota")
      .addItem("Check scheduled emails, set up any missing", "checkDigestScheduled")
      .addItem("Send everything to the live server now", "liveSendNow")
      .addSeparator()
      .addItem("Rebuild future Sundays from the pattern (asks first)", "rebuildFutureRota")
      .addItem("Rebuild the bus rotation (asks first)", "rebuildBuses")
      .addItem("Archive old records now (asks first)", "archiveNow"))

    .addSubMenu(ui.createMenu("Send an email now")
      .addItem("Test email and coordinators' phones", "sendTestEmail")
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
      .addItem("Stop rehearsing", "stopRehearsal")
      .addItem("Clear a Sunday's test run (asks first)", "clearTestRun");

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

    /* Status by heading. Column 4 is the North bus now, so every one of these
       wrote a status word over a registration. */
    var rcE = rotaCols(rota);
    /* A SUNDAY THAT HAS BEEN CALLED OFF KEEPS ITS STATUS. The passengers read
       that cell, and a refusal writing Confirmed over "North cancelled" put
       the route back on for them: the same fault v1.81.0 fixed for a request
       arriving. The cover's name is still written. */
    var offNow = String(rota.getRange(rRow, rcE.status).getValue() || "");
    var calledOff = routeCalledOff(offNow, "North") || routeCalledOff(offNow, "South");
    if (status === "Approved" && replacement) {
      rota.getRange(rRow, cols.cover).setValue(replacement);
      if (!calledOff) rota.getRange(rRow, rcE.status).setValue("Covered");
      stamp(rota, rRow, "Approved request");
    } else if (status === "Approved" && !replacement) {
      if (!calledOff) rota.getRange(rRow, rcE.status).setValue("No driver assigned");
      stamp(rota, rRow, "Approved, needs cover");
    } else if (status === "Rejected") {
      if (!calledOff) rota.getRange(rRow, rcE.status).setValue("Confirmed");
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
function calendarLink(sunday, covering, route, bus) {
  var tz = Session.getScriptTimeZone();
  var day = Utilities.formatDate(sunday, tz, "yyyyMMdd");
  var after = new Date(sunday); after.setDate(after.getDate() + 1);
  var dayAfter = Utilities.formatDate(after, tz, "yyyyMMdd");
  bus = String(bus || "").trim();
  /* The same words as the attached file. Two routes into a calendar that
     disagreed about which bus would be worse than neither. */
  var details = "You are down to drive the church minibus" +
                (route ? " on " + route : "") + "." +
                (bus ? " Bus: " + bus + "." : "") +
                (covering ? " Covering for " + covering + "." : "") +
                (bus ? " Buses can change during the week: check the app on the day." : "");
  return "https://calendar.google.com/calendar/render?action=TEMPLATE" +
         "&text=" + encodeURIComponent((route ? "Minibus duty: " + route : "Minibus driving duty") +
                                       (bus ? " (" + bus + ")" : "")) +
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

/* A LINK TO THE PAGE WHERE A DECISION CAN BE MADE, or "" when there is not
   one to be had.

   Empty is a perfectly good answer and the callers are all written for it: an
   email without a link says "open the spreadsheet", which is exactly what
   every one of these messages said until now. So a live server that is down,
   an older Worker that does not know the action, or LINK_RULES turned off all
   land in the same place, and none of them costs anybody the email.

   Fenced completely. The message is the thing that matters; the link is a
   convenience on top of it, and a convenience must never be able to stop a
   coordinator finding out that a bus is off the road. */
/* WHOSE PIN THE PAGE WILL ASK FOR.

   Not a new setting. The Drivers tab already has an Email column and
   COORDINATOR_EMAIL is already where these messages go, so the name is the
   one the two agree on — which also means that changing who gets the emails
   changes whose PIN the link wants, with nothing to keep in step by hand.

   Falls back to the first active driver in an authorising role, because a
   spreadsheet where nobody has filled in the Email column should still
   produce a working link rather than a dead one. Returns "" when there is no
   such person at all, and an empty name makes actionLink hand back no link,
   which puts the email back to "open the spreadsheet". */
function coordinatorName() {
  var want = String(COORDINATOR_EMAIL || "").trim().toLowerCase();
  var roles = (AUTHORISER_ROLES || []).map(function (r) {
    return String(r || "").trim().toLowerCase();
  });
  var list = [];
  try { list = readDrivers(SpreadsheetApp.getActiveSpreadsheet()) || []; }
  catch (err) { return ""; }

  var fallback = "";
  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    if (!d.active) continue;
    if (roles.indexOf(String(d.role || "").trim().toLowerCase()) === -1) continue;
    if (!fallback) fallback = d.name;
    if (want && String(d.email || "").trim().toLowerCase() === want) return d.name;
  }
  return fallback;
}

/* WHO PEOPLE RING, off the Drivers tab.

   One of the people AUTHORISER_ROLES names, and the number in their Phone
   column. Until v1.85.0 the name and number were typed into config.js and
   again into the passenger page, and a change of coordinator meant editing
   both files and remembering the second. Now it is cells on the Drivers tab.

   The same list as everything else a coordinator may do, so a church that
   calls the job something else sets its titles once, there and in
   fullInspectionRoles, and this follows. Until v1.85.3 this looked for the
   word Coordinator alone, and a church without one showed nobody.

   Whoever COORDINATOR_EMAIL names wins, so the person the alerts go to is the
   person people are told to ring. Otherwise the first active person holding
   the FIRST role in the list, then the second, and so on: here that is the
   Coordinator before the Minister in Charge. Nobody in any of them gives a
   blank name and a blank number, and every page then says "the bus
   coordinator" instead.

   Sent to the live server on every push and handed back on every answer it
   gives, which is how the pages learn it. Also carried on the rota, for the
   driver app when it is talking to this file directly. */
function coordinatorContact(drivers) {
  var want = String(COORDINATOR_EMAIL || "").trim().toLowerCase();
  var roles = (AUTHORISER_ROLES || []).map(function (r) { return String(r || "").trim().toLowerCase(); });
  var list = (drivers || []).filter(function (d) {
    return d && d.active && roles.indexOf(String(d.role || "").trim().toLowerCase()) !== -1;
  });
  var first = null;
  for (var i = 0; i < list.length && want && !first; i++) {
    if (String(list[i].email || "").trim().toLowerCase() === want) first = list[i];
  }
  for (var r = 0; r < roles.length && !first; r++) {
    for (var j = 0; j < list.length; j++) {
      if (String(list[j].role || "").trim().toLowerCase() === roles[r]) { first = list[j]; break; }
    }
  }
  if (!first) return { name: "", phone: "" };
  /* Tidied into the 07 form the pages dial and space out. Sheets turns a
     number typed as +44 7700 900123 into the plain number 447700900123, and
     sent like that the call button dialled 447700900123, which from a UK
     phone goes nowhere. A number that will not tidy (not a UK mobile) goes as
     typed rather than not at all. */
  var raw = String(first.phone || "").trim();
  return { name: String(first.name || "").trim(), phone: normalisePhone(raw) || raw };
}

function actionLink(kind, subject) {
  if (!LINK_RULES.on) return "";
  try {
    var out = workerCall("mint", {
      link: { kind: kind, subject: subject || {}, ttlMinutes: LINK_RULES.ttlMinutes }
    });
    if (!out || !out.ok || !out.token) return "";
    var base = String(LINK_RULES.pagesUrl || "");
    if (base && base.charAt(base.length - 1) !== "/") base += "/";
    return base + "do/?t=" + out.token;
  } catch (err) { return ""; }
}

/* The two halves of saying so, so every email that carries a link words it
   the same way and every email that cannot says the same thing instead. */
/* THE ONE BUTTON IN THE MESSAGE THAT DOES SOMETHING.

   It was the same near-black as the two beside it that only open a tab. An
   email carrying three grey rectangles makes a coordinator read all three to
   find the one that matters, which is the opposite of what a button is for.

   The colour is the SUBJECT'S, taken from the band at the top of the same
   message, so the eye is drawn down one thread rather than told a new thing:
   the deep red of a stopped bus, the amber of a rota request. Opening the
   spreadsheet stays quiet, because it is the way round, not the way. */
function decideHtml(url, words, minutes, colour) {
  if (!url) {
    return "<b>Open the spreadsheet to decide.</b>";
  }
  return '<a href="' + esc(url) + '" style="display:inline-block;padding:13px 22px;' +
         'background:' + (colour || "#1B222C") + ';color:#fff;text-decoration:none;' +
         'font-weight:bold;font-size:16px;border-radius:8px;' +
         'box-shadow:0 1px 0 rgba(0,0,0,.18)">' +
         esc(words) + "</a>";
}
function decidePlain(url, minutes) {
  return url ? ["", "Decide from here:", url].join("\n") : "";
}

/* THE SAME ALERT, TO EVERY COORDINATOR'S PHONE. From v1.86.0.

   Called beside each email the coordinator is sent, and whether or not
   COORDINATOR_EMAIL is set: the email reaches one inbox, this reaches the
   phone of everybody holding a coordinator title who has alerts on in the
   driver app. The live server works out who that is, holds anything that
   is not urgent through the quiet hours, and refuses the same id twice, so
   calling this again for something already sent is harmless.

   Short on purpose: what happened and to which bus or Sunday. The detail is
   in the email and the coordinator's app, behind a PIN.

   Never allowed to fail the thing that called it. */
function tellCoordinatorPhones(alert) {
  try {
    if (!WORKER_URL || !alert || !alert.id || !alert.title) return;
    workerCall("coordAlert", { alert: alert });
  } catch (err) {}
}

/* The phone's version of notifyCheck's subject, for the same five cases. */
function checkPhoneAlert(c, outcome, defectText) {
  var authorised = outcome === "Authorised to run";
  var stopped = c.level === "stop" && !authorised;
  var defects = defectText ? defectText.split(" | ") : [];
  var advs = c.advisories || [];
  var names = function (list) {
    return list.map(function (d) { return String((d && d.name) || d || "").split(":")[0].trim(); })
               .filter(function (x) { return x; }).slice(0, 3).join(", ");
  };
  var by = c.driver ? " on " + c.driver + "\u2019s check" : "";
  var a = stopped
    ? { kind: "stopped", urgent: true, title: "BUS STOPPED: " + c.reg,
        body: "Critical defect" + by + (names(c.defects || []) ? ": " + names(c.defects || []) : "") +
              ". Authorise it or arrange another bus." }
    : authorised
    ? { kind: "authorised", title: "Authorised to run: " + c.reg,
        body: "By " + (c.authorisedBy || "a coordinator") + ". The defect stays open." }
    : defects.length
    ? { kind: "defect", title: "Defect reported: " + c.reg,
        body: names(defects) + ". Safe to drive" + (by ? "," + by : "") + "." }
    : advs.length
    ? { kind: "advisory", title: "Advisory: " + c.reg, body: "To watch: " + names(advs) + "." }
    : { kind: "arrange", title: "To arrange: " + c.reg,
        body: (c.jobs || []).slice(0, 3).join(", ") + "." };
  a.id = "check|" + (c.id || (c.reg + "|" + c.date + "|" + c.time));
  a.reg = c.reg;
  a.not = [c.driver];
  return a;
}

function notifyCheck(c, outcome, defectText) {
  var authorised = outcome === "Authorised to run";
  var stopped = c.level === "stop" && !authorised;
  var defects = defectText ? defectText.split(" | ") : [];
  var jobs = (c.jobs || []).slice();
  /* Critical first, and those in bold below. An advisory on a critical item
     did not stop the bus, by the setting, and the email is where somebody
     decides whether it should have. */
  var advs = (c.advisories || []).slice()
    .sort(function (a, b) { return (b.crit ? 1 : 0) - (a.crit ? 1 : 0); });
  var advOnly = !stopped && !authorised && !defects.length && advs.length > 0;
  var clean = !stopped && !authorised && !defects.length && !advs.length;

  /* Five things this email can be about, and the subject says which rather
     than always claiming a defect. A clean bus that wants fuel is not a
     defect report and should not read like one, and a tyre to watch is not a
     fault. */
  var subject = stopped    ? "BUS STOPPED: " + c.reg + ", " + c.date
              : authorised ? "Authorised to run: " + c.reg + ", " + c.date
              : advOnly    ? "Advisory: " + c.reg + ", " + c.date
              : clean      ? "To arrange: " + c.reg + ", " + c.date
              :              "Defect reported: " + c.reg + ", " + c.date;

  var advLine = function (d) {
    var t = esc(d.name) + (d.crit ? " (critical)" : "") + (d.note ? ": " + esc(d.note) : "");
    return "&bull; " + (d.crit ? "<b>" + t + "</b>" : t);
  };

  var lines = [
    stopped
      ? "<b>A driver has stopped this vehicle after a safety critical defect.</b>"
      : authorised
      ? "<b>Authorised to run by " + esc(c.authorisedBy || "a coordinator") +
        ".</b> The defect stays open."
      : advOnly
      ? "No defects. The driver has noted something to watch."
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
   .concat(advs.length
      ? (defects.length ? ["&nbsp;"] : [])
        .concat(["<b>Advisory</b>"])
        .concat(advs.map(advLine))
      : [])
   .concat(jobs.length
      ? ((defects.length || advs.length) ? ["&nbsp;"] : [])
        .concat(["<b>To arrange</b>"])
        .concat(jobs.map(function (j) { return "&bull; " + esc(j); }))
      : [])
   .concat(c.loc ? ["&nbsp;", "<b>Checked at:</b> " +
       '<a href="https://maps.google.com/?q=' + esc(c.loc.replace(/\s/g, "")) + '">' +
       esc(c.loc) + "</a> (to within " + esc(c.locAcc) + " yd)" +
       (c.locNote ? " \u2014 " + esc(c.locNote) : "")]
     : (c.locNote ? ["&nbsp;", "<b>Location:</b> " + esc(c.locNote)] : []))
   .concat(["&nbsp;", "<b>Signed:</b> " + esc(c.sign)]);

  /* ONLY WHEN THE BUS IS STOPPED. Every other shape of this email is a
     record of something that has already happened and has no decision in it,
     and a button offering to authorise a bus nobody stopped is an invitation
     to a mistake. */
  var link = stopped
    ? actionLink("authorise", {
        reg: c.reg, checkId: c.id || "", inspector: c.driver || "",
        when: (c.date || "") + (c.time ? " at " + c.time : ""),
        defects: defects.join("; "), to: coordinatorName()
      })
    : "";
  if (stopped) {
    lines = lines.concat(["&nbsp;", decideHtml(link, "Authorise this bus to run",
                                               LINK_RULES.ttlMinutes, "#A8231B")]);
  }

  var plain = [
    stopped    ? "A driver has stopped this vehicle after a safety critical defect."
    : authorised ? "Authorised to run by " + (c.authorisedBy || "a coordinator") +
                   ". The defect stays open."
    : advOnly    ? "No defects. The driver has noted something to watch."
    : clean      ? "No defects. The driver has asked for something to be arranged."
    :              "A driver has reported a defect. The vehicle was safe to drive.",
    "", "Vehicle:  " + c.reg + " (" + (c.vehicle || "") + ")",
    "Driver:   " + c.driver + (c.role ? " (" + c.role + ")" : ""),
    "When:     " + c.date + " at " + c.time,
    "Mileage:  " + c.miles + (c.milesFlag ? "   [" + c.milesFlag + "]" : ""),
    "Outcome:  " + outcome, ""
  ].concat(defects.length
      ? ["Defects:"].concat(defects.map(function (d) { return "  - " + d; }))
      : [])
   .concat(advs.length
      ? ["", "Advisory:"].concat(advs.map(function (d) {
          return "  - " + d.name + (d.crit ? " (CRITICAL)" : "") + (d.note ? ": " + d.note : "");
        }))
      : [])
   .concat(jobs.length
      ? ["", "To arrange:"].concat(jobs.map(function (j) { return "  - " + j; }))
      : [])
   .concat(["", "Signed: " + c.sign, "", tabUrl(DEFECTS_SHEET)])
   .concat(stopped ? [decidePlain(link, LINK_RULES.ttlMinutes)] : [])
   .join("\n");

  sendMail({
    to: COORDINATOR_EMAIL,
    subject: subject,
    body: plain,
    htmlBody: htmlShell(stopped ? "Bus stopped, critical defect"
                        : authorised ? "Authorised to run, defect open"
                        : advOnly ? "Nothing wrong, something to watch"
                        : clean ? "Nothing wrong, something to arrange"
                        : "Defect reported",
                        stopped ? "#A8231B" : authorised ? "#A8231B"
                        : advOnly ? "#2C6FA8" : clean ? "#146B41" : "#B26B00",
                        lines, "Open the defect record", DEFECTS_SHEET)
  });
}

/* A bus authorised to run AFTER its check was already on the tab: from the
   Outcome column, or from a handset and brought back by the drain.

   Said at once or held for the Sunday summary, by TELL_COORDINATOR. Held is
   not lost: the summary lists every check with its outcome and the name of
   whoever authorised it, so the same fact reaches the same inbox that
   evening. */
function notifyAuthorised(a) {
  if (TELL_COORDINATOR === "summary" || !a) return;
  var who = String(a.by || "a coordinator");
  tellCoordinatorPhones({ id: "auth|" + a.reg + "|" + (a.at || ""), kind: "authorised",
    title: "Authorised to run: " + a.reg, body: "By " + who + ". The defect stays open.",
    reg: a.reg, not: [a.by] });
  if (!COORDINATOR_EMAIL) return;
  var when = a.at ? Utilities.formatDate(new Date(Number(a.at)),
                      Session.getScriptTimeZone(), "HH:mm") : "";
  var lines = [
    "<b>" + esc(a.reg) + " authorised to run by " + esc(who) + ".</b>",
    "The defect stays open.",
    "&nbsp;",
    "<b>Walkaround by:</b> " + esc(a.inspector || "not recorded"),
    "<b>Authorised:</b> " + esc(when) + (a.via === "sheet" ? " on the spreadsheet" : " in the app")
  ];
  var plain = [
    a.reg + " authorised to run by " + who + ".",
    "The defect stays open.", "",
    "Walkaround by: " + (a.inspector || "not recorded"),
    "Authorised:    " + when + (a.via === "sheet" ? " on the spreadsheet" : " in the app"),
    "", tabUrl(DEFECTS_SHEET)
  ].join("\n");
  try {
    sendMail({
      to: COORDINATOR_EMAIL,
      subject: "Authorised to run: " + a.reg,
      body: plain,
      htmlBody: htmlShell("Authorised to run, defect open", "#A8231B",
                          lines, "Open the defect record", DEFECTS_SHEET)
    });
  } catch (err) { /* an email must never undo an authorisation */ }
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
  /* THE DECISION, FROM HERE. Both answers on one page, behind his PIN.

     The page does not write the Rota. It records the decision, the drain
     carries it back to the Rota Requests tab, and the tab's own edit handler
     writes the Rota — the same code path a person setting the Status cell
     goes through, so a swap still moves both Sundays and there is no second
     implementation to drift. That is also why the wording below says five
     minutes rather than pretending it is instant.

     A COVER CAN BE PICKED THERE TOO, from v1.77.0. It could not before, and
     the reason given was that choosing who covers a Sunday is a judgement
     about people rather than a name off a list. That was right about the
     list and wrong about the conclusion: the page now carries what the
     judgement needs — who is already out that morning, and when each man
     last drove — because the live server holds both already.

     What settled it was that the old way guaranteed TWO touches. Approve
     from a phone, get "No driver assigned", open the laptop anyway. A
     decision link that still needs a laptop is half a link.

     A swap names its own partner and moves two Sundays, so no cover is
     offered on one: a third name there would be offering to do something
     else entirely. */
  var link = actionLink("rota", {
    id: rq.id || "", sunday: rq.date || "", sundayWords: when,
    driver: rq.driver || "", type: rq.type || "", reason: rq.reason || "",
    swapWith: rq.swapWith || "", theirSunday: rq.swapDate || "",
    bothAgreed: rq.swapWith ? (rq.agreed ? "Yes" : "Not marked as agreed") : "",
    to: coordinatorName()
  });

  lines.push("&nbsp;");
  lines.push(decideHtml(link, "Approve or turn it down", LINK_RULES.ttlMinutes, "#B26B00"));
  lines.push("&nbsp;");
  lines.push("The rota has <b>not</b> changed.");

  /* Pushed rather than a list of ternaries, for the reason written out at
     length over dutyReminderFor: a skipped field emitted "" and left a stray
     blank line behind it, and two skipped fields left two. Blank lines are a
     plain text email's only punctuation. A request with no swap on it was
     showing three in a row. */
  var prows = [rq.driver + " has asked for a change to the driving rota.", "",
               "Sunday:  " + when,
               "Request: " + (rq.type || ""),
               "Reason:  " + (rq.reason || "")];
  if (rq.swapWith) prows.push("Swap with: " + rq.swapWith);
  if (rq.swapDate) prows.push("Taking their Sunday: " + rq.swapDate);
  prows.push("", "The rota has not changed.", "", tabUrl(REQUESTS_SHEET));
  var dp = decidePlain(link, LINK_RULES.ttlMinutes);
  if (dp) prows.push(dp);
  var plain = prows.join("\n");

  sendMail({
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
    /* script is the word the pages read before the three numbers were split
       apart. Kept so a page that has not been redeployed yet still sees
       something. sheet is what they read now. */
    obj.script = SCRIPT_VERSION;
    obj.sheet = SCRIPT_VERSION;
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
  where: "Where started", acc: "Accuracy (yd)", away: "Distance from base (yd)",
  endedBy: "Ended by",
  liveId: "Live ID"
};
FIELDS[STOPS_SHEET] = {
  route: "Route", id: "Stop ID", time: "Time", stop: "Stop",
  postcode: "Postcode", active: "Active", type: "Type", where: "Where",
  lat: "Lat", lng: "Lng"
};
FIELDS[BOOKINGS_SHEET] = {
  received: "Received", sunday: "Sunday", route: "Route", stopId: "Stop ID",
  stop: "Stop", seats: "Seats", device: "Device", status: "Status",
  phone: "Phone", passenger: "Passenger ID", liveId: "Live ID"
};
FIELDS[DRIVERS_SHEET] = {
  name: "Name", role: "Role", active: "Active", order: "Primary order",
  pin: "PIN", email: "Email", route: "Route", phone: "Phone"
};
FIELDS[BUSES_SHEET] = {
  reg: "Registration", seats: "Seats for passengers",
  active: "Active", notes: "Notes",
  mot: "MOT due", service: "Service due", insurance: "Insurance due", permit: "Permit due",
  oddRoute: "Route in odd months"
};
FIELDS[CHECKS_SHEET] = {
  received: "Received", id: "Check ID", date: "Date", time: "Time",
  vehicle: "Vehicle", reg: "Registration", driver: "Driver", role: "Role",
  mileage: "Mileage", mileageFlag: "Mileage flag", outcome: "Outcome",
  items: "Items checked", defectCount: "Defect count", defects: "Defects",
  renewals: "Renewals due", signed: "Signed", na: "Not applicable",
  type: "Check type", where: "Where checked", acc: "Accuracy (yd)",
  away: "Distance from base (yd)", locNote: "Location note", fuel: "Fuel",
  arrange: "To arrange", pinCheck: "PIN check",
  advisoryCount: "Advisory count", advisories: "Advisories",
  authBy: "Authorised by", authOn: "Authorised on"
};
/* Rota Requests had no entry here: it has always been read through
   requestCols, which is its own hard map. Added so colsSoft works on this tab
   like every other, which is what the archiver needs — it must be able to age
   a row on a sheet that is merely out of date rather than refuse to. The
   names match requestCols exactly; nothing else changes by its being here. */
FIELDS[REQUESTS_SHEET] = {
  received: "Received", id: "Request ID", sunday: "Sunday", driver: "Driver",
  type: "Type", reason: "Reason", swapWith: "Preferred swap",
  status: "Status", decidedOn: "Decided on",
  replacement: "Replacement assigned",
  theirSunday: "Their Sunday", bothAgreed: "Both agreed"
};
FIELDS[DEFECTS_SHEET] = {
  received: "Received", id: "Check ID", date: "Date", reg: "Registration",
  driver: "Driver", item: "Item", critical: "Critical",
  found: "What the driver found", status: "Status",
  action: "Action taken", closed: "Closed on", kind: "Kind"
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

/* ---- showing the time as well as the date -----------------------------

   A cell holding a moment is useless as a record if the sheet shows only the
   day. Received at 17:15:46 and received at 03:50 are different facts about a
   booking, and "13/08/2026" says neither.

   appendRow used to hide this. Sheets auto-formats a fresh Date written that
   way and picked a full date-and-time by itself. Writing the same value with
   setValues — which is what every write here does now, so a coordinator's own
   column is stepped over rather than written into — takes whatever format the
   cell already carries, and an untouched cell far down the grid carries the
   sheet default, which renders as a bare date. Nothing was lost: the moment is
   still in the cell, and only the display was thrown away. But a record you
   have to widen a column and click a cell to read is not a record anybody
   reads.

   So the format is set on the column, deliberately, the way the Phone column
   already sets text. Set once on the whole column, so every row written after
   it inherits, and every row written before it is corrected. */
var DATETIME_FORMAT = "dd/mm/yyyy hh:mm:ss";

function stampTimeFormats(sh, cols, names) {
  if (!sh || !cols) return;
  var rows = Math.max(1, sh.getMaxRows() - 1);
  names.forEach(function (k) {
    if (!cols[k]) return;
    /* Guarded one column at a time. A tab that refuses one is not a reason to
       leave the rest of them unreadable. */
    try { sh.getRange(2, cols[k], rows, 1).setNumberFormat(DATETIME_FORMAT); }
    catch (err) {}
  });
}

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
    /* A column inserted beside another inherits its formatting AND its data
       validation. Adding "Where" next to "Type" therefore put the Type
       dropdown on it, and the first address typed in came back "Input must be
       an item on the specified list" — a brand new column refusing its own
       contents, with nothing on the tab to say why.

       Cleared here rather than at the one call site that found it, because
       this is true of every column this function will ever add. A new column
       has no rules until somebody deliberately gives it some. */
    try { sh.getRange(1, at + 1, sh.getMaxRows(), 1).setDataValidation(null); }
    catch (err) { /* a tab that cannot hold validation cannot have inherited any */ }
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
/* Duck-typed rather than "instanceof Date".
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
