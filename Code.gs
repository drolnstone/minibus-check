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

var TOKEN = "dominion-minibus";                   // must match config.js
var COORDINATOR_EMAIL = "asimbassey@yahoo.com";   // blank = no email alerts

var CHECKS_SHEET   = "Checks";
var DEFECTS_SHEET  = "Defects";
var ROTA_SHEET     = "Rota";
var REQUESTS_SHEET = "Rota Requests";
var DRIVERS_SHEET  = "Drivers";

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

    if (String(body.token || "") !== TOKEN) {
      return reply({ ok: false, error: "bad token" });
    }

    if (String(body.action || "") === "rotaRequest") {
      return handleRotaRequest(body.request);
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
    "Distance from base (yd)", "Location note", "Fuel", "To arrange"
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

  checks.appendRow([
    new Date(), c.id, c.date || "", c.time || "", c.vehicle || "", c.reg || "",
    c.driver || "", c.role || "", c.miles || "", c.milesFlag || "", outcome,
    (c.checked || "") + "/" + (c.total || ""),
    (c.defects || []).length, defectText, c.renewals || "", c.sign || "",
    (c.na || []).join(", "), c.kind || "Pre-drive",
    c.loc ? '=HYPERLINK("https://maps.google.com/?q=' + c.loc.replace(/\s/g, "") +
            '","' + c.loc + '")' : "",
    c.locAcc === 0 || c.locAcc ? c.locAcc : "",
    c.locDist === 0 || c.locDist ? c.locDist : "",
    c.locNote || "", c.fuel || "", (c.jobs || []).join(", ")
  ]);

  // One row per defect as well, so the coordinator can filter and chase them.
  if ((c.defects || []).length) {
    var defs = sheet(ss, DEFECTS_SHEET, [
      "Received", "Check ID", "Date", "Registration", "Driver",
      "Item", "Critical", "What the driver found", "Status", "Action taken", "Closed on"
    ]);
    c.defects.forEach(function (d) {
      defs.appendRow([
        new Date(), c.id, c.date || "", c.reg || "", c.driver || "",
        d.name, d.crit ? "YES" : "", d.note || "", "Open", "", ""
      ]);
      applyStatusDropdown(defs, defs.getLastRow());
    });
  }

  if (COORDINATOR_EMAIL && c.level !== "ok") {
    notifyCheck(c, outcome, defectText);
  }

  return reply({ ok: true });
}

/**
 * Adds any column this version writes that an older sheet does not have yet.
 * Only ever appends on the right, so every existing row keeps its meaning and
 * nothing already recorded moves.
 */
function ensureChecksColumns(sh) {
  /* Older sheets carry these in metres. Rename in place rather than adding a
     second column for the same measurement. Anything recorded before the
     change is still in metres, so treat early rows with that in mind. */
  var RENAMED = { "Accuracy (m)": "Accuracy (yd)",
                  "Distance from base (m)": "Distance from base (yd)" };

  var want = ["Not applicable", "Check type", "Where checked",
              "Accuracy (yd)", "Distance from base (yd)", "Location note",
              "Fuel", "To arrange"];
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
}

function lastMileagePayload() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CHECKS_SHEET);
  if (!sh || sh.getLastRow() < 2) return { ok: true, last: {} };

  // Columns: 1 Received, 2 Check ID, 3 Date, 4 Time, 5 Vehicle,
  //          6 Registration, 7 Driver, 8 Role, 9 Mileage ...
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues();
  var last = {};

  rows.forEach(function (r) {
    var reg = String(r[5] || "").trim();
    var miles = Number(r[8]);
    if (!reg || !miles) return;
    var when = r[0] instanceof Date ? r[0].getTime() : 0;
    if (!last[reg] || when >= last[reg]._t) {
      last[reg] = { miles: miles, date: String(r[2] || ""), driver: String(r[6] || ""), _t: when };
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
    drivers: drivers.filter(function (d) { return d.active; })
                     .map(function (d) {
                       return { name: d.name, role: d.role,
                                pin: pinHash(d.name, d.pin) };
                     }),
    /* So the next driver sees what the last one reported and still open. */
    openDefects: openDefectsByReg(ss),
    rows: rows
  };

  try { cache.put(cacheKey, JSON.stringify(payload), 60); } catch (err) { /* too big, no matter */ }
  return payload;
}

/** Makes sure the tabs exist. Cheap: no reading, no writing, no formatting. */
function ensureRotaSheets(ss) {
  sheet(ss, ROTA_SHEET, ROTA_HEADERS);
  var drivers = sheet(ss, DRIVERS_SHEET,
    ["Name", "Role", "Active", "Primary order", "PIN", "Email"]);
  sheet(ss, REQUESTS_SHEET, [
    "Received", "Request ID", "Sunday", "Driver", "Type", "Reason",
    "Preferred swap", "Status", "Decided on", "Replacement assigned"
  ]);

  /* Seed the register here rather than only in setUpEverything. Whichever
     path reaches the sheet first must leave it usable: an empty Drivers tab
     means no dropdowns and no pattern to fill the rota from. */
  if (drivers.getLastRow() < 2) {
    SEED_DRIVERS.forEach(function (d) {
      drivers.appendRow([d.name, d.role, "YES", d.order, "", ""]);
    });
  }
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
  ensureRotaSheets(ss);
  fillRotaAhead(ss);

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

function decorate(r, requests) {
  var out = {
    date: r.date,
    primary: r.primary || "",
    actual: r.actual || r.primary || "",
    status: r.status || "Confirmed",
    primary2: r.primary2 || "",
    actual2: r.actual2 || "",
    notes: r.notes || ""
  };
  if (!out.primary && !out.actual) out.status = "No driver assigned";
  var req = requests[r.date];
  if (req) out.request = req;
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
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
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
function readLatestRequests(ss) {
  var sh = ss.getSheetByName(REQUESTS_SHEET);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues();
  values.forEach(function (r) {
    var key = anyToKey(r[2]);
    if (!key) return;
    out[key] = {
      driver: String(r[3] || "").trim(),
      type: String(r[4] || "").trim(),
      status: String(r[7] || "Pending").trim()
    };
  });
  return out;
}

function readDrivers(ss) {
  var sh = ss.getSheetByName(DRIVERS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
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
      route: (String(r[6] || "").trim().toUpperCase().charAt(0) === "S") ? "South" : "North"
    });
  });
  return out;
}

/**
 * A one-way fingerprint of a PIN, so the phone can check one without the
 * PIN ever leaving this sheet. Salted with the name, so two people who
 * happen to pick the same four digits do not produce the same fingerprint.
 *
 * Be clear about what this is. Four digits can be worked through by anyone
 * who sets out to, fingerprint or not. It stops a driver reading the numbers
 * straight off the endpoint. It is a lock on the door, not a safe.
 */
function pinHash(name, pin) {
  if (!pin) return "";
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
                                    name + ":" + pin, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ("0" + (b & 0xFF).toString(16)).slice(-2); }).join("");
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
    "Preferred swap", "Status", "Decided on", "Replacement assigned"
  ]);

  if (alreadyHaveRequest(sh, rq.id)) {
    return reply({ ok: true, duplicate: true });
  }

  var sunday = keyToDate(rq.date);
  if (sunday < sundayOf(new Date())) {
    return reply({ ok: false, error: "that Sunday has already passed" });
  }

  sh.appendRow([
    new Date(), rq.id || "", sunday, rq.driver || "", rq.type || "",
    rq.reason || "", rq.swapWith || "", "Pending", "", ""
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
var DRIVERS_HEADERS = ["Name", "Role", "Active", "Primary order", "PIN", "Email", "Route"];

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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureRotaSheets(ss);
  ensureDrivers(ss);
  ensureRota(ss);

  /* Run by hand means fill now, whatever the once-a-day stamp says. */
  try { PropertiesService.getScriptProperties().deleteProperty("rotaFilledAt"); }
  catch (err) {}
  fillRotaAhead(ss);

  refreshDropdowns();
  bumpRotaVersion();
  try { installWeeklyDigest(); } catch (err) { /* triggers need permission; never block setup */ }
  try { installDutyReminders(); } catch (err) { /* same */ }
  try { installChangeAlerts(); } catch (err) { /* same */ }
  try { installNightlyMaintenance(); } catch (err) { /* same. maintainIfDue covers it. */ }

  var n = ss.getSheetByName(ROTA_SHEET).getLastRow() - 1;
  var tz = timeZoneWarning();
  var dh = driversHeaderWarning(ss);
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

function rotaColours(sh) {
  var range = sh.getRange("D2:D3000");
  var rules = sh.getConditionalFormatRules();
  function rule(value, bg, fg) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(value).setBackground(bg).setFontColor(fg)
      .setRanges([range]).build();
  }
  rules.push(rule("Confirmed", "#E6F2EB", "#146B41"));
  rules.push(rule("Change requested", "#FDF3E2", "#8A5300"));
  rules.push(rule("Covered", "#EEF3F8", "#1B3A57"));
  rules.push(rule("Cancelled/declined", "#F1F1F1", "#666666"));
  rules.push(rule("No driver assigned", "#FBE9E7", "#A8231B"));
  sh.setConditionalFormatRules(rules);
}

/**
 * Rebuilds every dropdown from the Drivers tab. Run it after adding someone
 * to the register, or use the Minibus menu.
 */
function refreshDropdowns() {
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
    rota.getRange("B2:B3000").setDataValidation(listRule(north.length ? north : active));
    rota.getRange("E2:E3000").setDataValidation(listRule(south.length ? south : active));
    rota.getRange("C2:C3000").setDataValidation(listRule(active));
    rota.getRange("F2:F3000").setDataValidation(listRule(active));
    rota.getRange("D2:D3000").setDataValidation(listRule(ROTA_STATUS));
    rotaColours(rota);
  }

  var reqs = ss.getSheetByName(REQUESTS_SHEET);
  if (reqs) {
    reqs.getRange("H2:H2000").setDataValidation(listRule(REQ_STATUS));
    reqs.getRange("J2:J2000").setDataValidation(listRule(active));
    reqs.setColumnWidth(6, 300);
    reqs.setColumnWidth(8, 120);
    reqs.setColumnWidth(10, 180);
  }
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
    { fn: "nightlyMaintenance", label: "Nightly rota tidy-up, 3am",     install: installNightlyMaintenance }
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
  if (!Object.keys(emails).length) return;      // nobody has given an address yet

  var byDate = {};
  readRotaRows(ss).forEach(function (r) { byDate[r.date] = r; });
  var pattern = { north: primaryPattern(drivers, "North"),
                  south: primaryPattern(drivers, "South") };

  var props = PropertiesService.getScriptProperties();
  var sent = {};
  try { sent = JSON.parse(props.getProperty("remindersSent") || "{}"); } catch (err) {}

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
      if (sent[stamp]) return;

      sendDutyEmail(emails[slot.who], slot.who, target, days, slot.was, slot.route);
      sent[stamp] = true;
    });
  });

  var keys = Object.keys(sent).sort();
  while (keys.length > 300) { delete sent[keys.shift()]; }
  props.setProperty("remindersSent", JSON.stringify(sent));
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
  dutyReminders();
  ss.toast("Reminders checked for " + withEmail + " driver" +
           (withEmail > 1 ? "s" : "") + ".", "Minibus", 6);
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

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Minibus")
    .addItem("Set up / refresh rota", "setUpEverything")
    .addItem("Refresh dropdowns from Drivers tab", "refreshDropdowns")
    .addItem("Add a Sunday to the rota", "addSunday")
    .addItem("Extend rota further ahead", "extendRota")
    .addSeparator()
    .addItem("Send a test email", "sendTestEmail")
    .addItem("Send weekly summary now", "sendDigestNow")
    .addItem("Send duty reminders now", "sendRemindersNow")
    .addItem("Check scheduled emails", "checkDigestScheduled")
    .addItem("Check the Drivers tab", "checkDriversTab")
    .addItem("Check time zone", "checkTimeZoneMenu")
    .addSeparator()
    .addItem("Repair old fuel readings (run once)", "repairFuelColumn")
    .addItem("Rebuild future Sundays from the pattern", "rebuildFutureRota")
    .addToUi();
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
  } catch (err) {
    // Never let a trigger error block someone editing the sheet.
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
    var cols = routeColumns(ss, rota, rRow, String(sh.getRange(row, 4).getValue() || "").trim());

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
 * Normally the script asks the spreadsheet it is attached to for its own
 * address, so the link can never go stale, even if the sheet is renamed or
 * moved. SHEET_URL below is only a backstop, used if that ever fails. If you
 * copy this sheet, delete the line rather than leaving it pointing at the
 * old one.
 */
var SHEET_URL = "https://docs.google.com/spreadsheets/d/1h8Hln0T7pvkU5Rsq40X35b_ldaNu_nU_Gwf7klygZ6U/edit";

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
  var subject = (stopped ? "BUS STOPPED: " : "Defect reported: ") + c.reg + " \u2014 " + c.date;
  var defects = defectText ? defectText.split(" | ") : [];

  var lines = [
    stopped
      ? "<b>A driver has stopped this vehicle after a safety critical defect.</b>"
      : "A driver has reported a defect. The vehicle was safe to drive.",
    "&nbsp;",
    "<b>Vehicle:</b> " + esc(c.reg) + " (" + esc(c.vehicle || "") + ")",
    "<b>Driver:</b> " + esc(c.driver) + (c.role ? " (" + esc(c.role) + ")" : ""),
    "<b>When:</b> " + esc(c.date) + " at " + esc(c.time),
    "<b>Mileage:</b> " + esc(c.miles) + (c.milesFlag ? " [" + esc(c.milesFlag) + "]" : ""),
    "<b>Outcome:</b> " + esc(outcome),
    "&nbsp;",
    "<b>Defects</b>"
  ].concat(defects.map(function (d) { return "&bull; " + esc(d); }))
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
    "Outcome:  " + outcome, "", "Defects:",
    defects.map(function (d) { return "  - " + d; }).join("\n"),
    "", "Signed: " + c.sign, "", tabUrl(DEFECTS_SHEET)
  ].join("\n");

  MailApp.sendEmail({
    to: COORDINATOR_EMAIL,
    subject: subject,
    body: plain,
    htmlBody: htmlShell(stopped ? "Bus stopped \u2014 critical defect" : "Defect reported",
                        stopped ? "#A8231B" : "#B26B00",
                        lines, "Open the defect record", DEFECTS_SHEET)
  });
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
  if (rq.swapWith) lines.push("<b>Preferred swap:</b> " + esc(rq.swapWith));
  lines.push("&nbsp;");
  lines.push("The rota has <b>not</b> changed. Open the Rota Requests tab, set the status " +
             "and pick a replacement, and the Rota tab updates itself.");

  var plain = [
    rq.driver + " has asked for a change to the driving rota.", "",
    "Sunday:  " + when,
    "Request: " + (rq.type || ""),
    "Reason:  " + (rq.reason || ""),
    rq.swapWith ? "Preferred swap: " + rq.swapWith : "",
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
