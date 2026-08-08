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

var STATUS_OPTIONS = ["Open", "Booked in", "Parts on order", "Fixed", "Monitoring", "Not a defect"];
var ROTA_STATUS    = ["Confirmed", "Change requested", "Covered", "Cancelled/declined", "No driver assigned"];
var REQ_STATUS     = ["Pending", "Approved", "Rejected"];

/* The Sunday the repeating pattern is measured from. It must be a Sunday and
   it must match the anchor in config.js. Do not move it: moving it changes
   who drives on every future Sunday that has not been written down yet. */
var PATTERN_ANCHOR = "2026-08-02";

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
  { name: "Pst Kehinde", role: "Minister in Charge", order: "",  backup: "YES" },
  { name: "Bro Asim",    role: "Coordinator",        order: 4,   backup: "" },
  { name: "Bro Adebola", role: "Driver",             order: 1,   backup: "" },
  { name: "Bro Abiodun", role: "Driver",             order: 2,   backup: "" },
  { name: "Bro Moses",   role: "Driver",             order: 3,   backup: "" },
  { name: "Bro Calvin",  role: "Backup",             order: "",  backup: "YES" },
  { name: "Bro Tunde",   role: "Backup",             order: "",  backup: "YES" }
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
    "Not applicable", "Check type", "Where checked", "Accuracy (m)",
    "Distance from base (m)", "Location note"
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
    c.locNote || ""
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
  var want = ["Not applicable", "Check type", "Where checked",
              "Accuracy (m)", "Distance from base (m)", "Location note"];
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return;
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h || "").trim();
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
     Maintenance now runs at most once a day, and never in front of a
     waiting driver. */
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
  var pattern = primaryPattern(drivers);
  var backups = drivers.filter(function (d) { return d.active && d.backup; })
                       .map(function (d) { return d.name; });

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
      date: key, primary: patternDriver(d, pattern), actual: "",
      status: "Confirmed", primary2: "", actual2: "", notes: ""
    }, requests));
  }

  rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

  var payload = {
    ok: true,
    from: dateToKey(from),
    weeks: weeks,
    pattern: pattern,
    backups: backups,
    drivers: drivers.filter(function (d) { return d.active; }).map(function (d) { return d.name; }),
    rows: rows
  };

  try { cache.put(cacheKey, JSON.stringify(payload), 60); } catch (err) { /* too big, no matter */ }
  return payload;
}

/** Makes sure the tabs exist. Cheap: no reading, no writing, no formatting. */
function ensureRotaSheets(ss) {
  sheet(ss, ROTA_SHEET, [
    "Sunday", "Bus 1 scheduled", "Bus 1 actual / cover", "Status",
    "Bus 2 scheduled", "Bus 2 actual / cover", "Notes", "Updated", "Updated by"
  ]);
  var drivers = sheet(ss, DRIVERS_SHEET,
    ["Name", "Role", "Active", "Primary order", "Backup pool"]);
  sheet(ss, REQUESTS_SHEET, [
    "Received", "Request ID", "Sunday", "Driver", "Type", "Reason",
    "Preferred swap", "Status", "Decided on", "Replacement assigned"
  ]);

  /* Seed the register here rather than only in setUpEverything. Whichever
     path reaches the sheet first must leave it usable: an empty Drivers tab
     means no dropdowns and no pattern to fill the rota from. */
  if (drivers.getLastRow() < 2) {
    SEED_DRIVERS.forEach(function (d) {
      drivers.appendRow([d.name, d.role, "YES", d.order, d.backup]);
    });
  }
}

/**
 * Rolls the filled horizon forward, but only once a day. Anything sooner is
 * wasted work: the horizon moves by one Sunday a week.
 */
function maintainIfDue(ss, props) {
  try {
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

function primaryPattern(drivers) {
  var p = drivers.filter(function (d) { return d.active && d.order; })
                 .sort(function (a, b) { return a.order - b.order; })
                 .map(function (d) { return d.name; });
  if (p.length) return p;
  return SEED_DRIVERS.filter(function (d) { return d.order; })
                     .sort(function (a, b) { return a.order - b.order; })
                     .map(function (d) { return d.name; });
}

/** Which driver the repeating pattern puts on a given Sunday. */
function patternDriver(d, pattern) {
  if (!pattern.length) return "";
  var anchor = keyToDate(PATTERN_ANCHOR);
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
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  var out = [];
  values.forEach(function (r) {
    var name = String(r[0] || "").trim();
    if (!name) return;
    out.push({
      name: name,
      role: String(r[1] || "").trim(),
      active: yes(r[2]),
      order: Number(r[3]) || 0,
      backup: yes(r[4])
    });
  });
  return out;
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
  var pattern = primaryPattern(readDrivers(ss));
  sh.appendRow([d, patternDriver(d, pattern), "", "Confirmed", "", "", "", "", ""]);
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
  var n = ss.getSheetByName(ROTA_SHEET).getLastRow() - 1;
  ss.toast("Ready. " + n + " Sundays on the rota.", "Minibus", 6);
}

function ensureDrivers(ss) {
  var existing = ss.getSheetByName(DRIVERS_SHEET);
  var sh = sheet(ss, DRIVERS_SHEET, ["Name", "Role", "Active", "Primary order", "Backup pool"]);
  if (!existing) {
    SEED_DRIVERS.forEach(function (d) {
      sh.appendRow([d.name, d.role, "YES", d.order, d.backup]);
    });
    sh.setColumnWidth(1, 150);
    sh.setColumnWidth(2, 160);
    sh.getRange("C2:C200").setDataValidation(listRule(["YES", "NO"]));
    sh.getRange(1, 4).setNote(
      "Number the repeating pattern here: 1, 2, 3, 4...\n" +
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
  var sh = sheet(ss, ROTA_SHEET, [
    "Sunday", "Bus 1 scheduled", "Bus 1 actual / cover", "Status",
    "Bus 2 scheduled", "Bus 2 actual / cover", "Notes", "Updated", "Updated by"
  ]);

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
    sh.getRange(1, 5).setNote("Second bus. Leave these two columns blank until you run two buses.");
    rotaColours(sh);
  }

  fillRotaAhead(ss, sh);
  return sh;
}

/** Keeps the Rota tab filled from this Sunday out to the horizon. */
function fillRotaAhead(ss, sh) {
  sh = sh || ss.getSheetByName(ROTA_SHEET);
  if (!sh) return;

  var pattern = primaryPattern(readDrivers(ss));
  var have = {};
  readRotaRows(ss).forEach(function (r) { have[r.date] = true; });

  var start = sundayOf(new Date());
  var rows = [];
  for (var i = 0; i < ROTA_FILL_WEEKS; i++) {
    var d = addWeeks(start, i);
    var key = dateToKey(d);
    if (have[key]) continue;
    rows.push([d, patternDriver(d, pattern), "", "Confirmed", "", "", "", "", ""]);
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
      return { name: d.name, active: true, order: Number(d.order) || 0, backup: !!d.backup };
    });
  }

  var active  = drivers.filter(function (d) { return d.active; }).map(function (d) { return d.name; });
  var primary = primaryPattern(drivers);

  var rota = ss.getSheetByName(ROTA_SHEET);
  if (rota) {
    // Scheduled columns hold the normal rotation.
    // Cover columns hold ANYONE authorised, backups included.
    rota.getRange("B2:B3000").setDataValidation(listRule(primary.length ? primary : active));
    rota.getRange("E2:E3000").setDataValidation(listRule(primary.length ? primary : active));
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

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Minibus")
    .addItem("Set up / refresh rota", "setUpEverything")
    .addItem("Refresh dropdowns from Drivers tab", "refreshDropdowns")
    .addItem("Add a Sunday to the rota", "addSunday")
    .addItem("Extend rota further ahead", "extendRota")
    .addSeparator()
    .addItem("Send a test email", "sendTestEmail")
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
  var row = e.range.getRow();
  var col = e.range.getColumn();
  if (row < 2 || (col !== 8 && col !== 10)) return;

  var status = String(sh.getRange(row, 8).getValue() || "");
  var replacement = String(sh.getRange(row, 10).getValue() || "").trim();
  var key = anyToKey(sh.getRange(row, 3).getValue());
  if (!key) return;

  if (status === "Approved" || status === "Rejected") {
    if (!sh.getRange(row, 9).getValue()) {
      sh.getRange(row, 9).setValue(new Date()).setNumberFormat("dd/mm/yyyy");
    }
  } else {
    sh.getRange(row, 9).clearContent();
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var rota = ss.getSheetByName(ROTA_SHEET);
  if (!rota) return;
  var rRow = findRotaRow(rota, key) || appendRotaRow(ss, rota, keyToDate(key));

  if (status === "Approved" && replacement) {
    rota.getRange(rRow, 3).setValue(replacement);
    rota.getRange(rRow, 4).setValue("Covered");
    stamp(rota, rRow, "Approved request");
  } else if (status === "Approved" && !replacement) {
    rota.getRange(rRow, 4).setValue("No driver assigned");
    stamp(rota, rRow, "Approved, needs cover");
  } else if (status === "Rejected") {
    rota.getRange(rRow, 4).setValue("Confirmed");
    stamp(rota, rRow, "Request rejected");
  }
  bumpRotaVersion();
}

/** Keeps the Status column honest when you edit the rota directly. */
function onEditRota(e, sh) {
  var row = e.range.getRow();
  var col = e.range.getColumn();
  if (row < 2 || col > 7) return;

  var scheduled = String(sh.getRange(row, 2).getValue() || "").trim();
  var cover     = String(sh.getRange(row, 3).getValue() || "").trim();

  if (!scheduled && !cover) {
    sh.getRange(row, 4).setValue("No driver assigned");
  } else if (col === 2 || col === 3) {
    var status = String(sh.getRange(row, 4).getValue() || "");
    if (cover && cover !== scheduled) {
      sh.getRange(row, 4).setValue("Covered");
    } else if (status === "Covered" || status === "No driver assigned") {
      sh.getRange(row, 4).setValue("Confirmed");
    }
  }
  stamp(sh, row, "Coordinator");
  bumpRotaVersion();
}

function onEditDefects(e, sh) {
  var row = e.range.getRow();
  var col = e.range.getColumn();
  if (row < 2) return;

  var CLOSED_STATES = ["Fixed", "Not a defect"];

  // Status changed: stamp or clear the closing date to match.
  if (col === 9) {
    var status = String(e.range.getValue() || "");
    var closedCell = sh.getRange(row, 11);
    var isClosed = CLOSED_STATES.indexOf(status) !== -1;

    if (isClosed && !closedCell.getValue()) {
      closedCell.setValue(new Date());
    } else if (!isClosed && closedCell.getValue()) {
      closedCell.clearContent();
    }
    return;
  }

  // Closing date edited by hand: check it makes sense.
  if (col === 11) {
    var val = e.range.getValue();
    if (!val) return;
    if (!(val instanceof Date)) {
      e.range.setNote("That is not a date. Use dd/mm/yyyy.");
      return;
    }
    var today = new Date(); today.setHours(23, 59, 59, 999);
    var raised = sh.getRange(row, 1).getValue();

    if (val > today) {
      e.range.setNote("A defect cannot be closed on a future date.");
      e.range.setBackground("#FBE9E7");
      return;
    }
    if (raised instanceof Date && val < new Date(raised.getFullYear(), raised.getMonth(), raised.getDate())) {
      e.range.setNote("This is before the defect was reported on " +
        Utilities.formatDate(raised, Session.getScriptTimeZone(), "dd/MM/yyyy") + ".");
      e.range.setBackground("#FBE9E7");
      return;
    }
    e.range.clearNote();
    e.range.setBackground(null);

    var st = String(sh.getRange(row, 9).getValue() || "");
    if (CLOSED_STATES.indexOf(st) === -1) {
      sh.getRange(row, 9).setValue("Fixed");
    }
  }
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

function openButton(label, tabName) {
  var url = tabName ? tabUrl(tabName) : sheetUrl();
  if (!url) return "";
  return '<p style="margin:22px 0 6px"><a href="' + url + '" ' +
    'style="background:#1B222C;color:#ffffff;text-decoration:none;' +
    'font-family:Helvetica,Arial,sans-serif;font-weight:bold;font-size:16px;' +
    'padding:13px 22px;border-radius:8px;display:inline-block">' + label + '</a></p>';
}

function htmlShell(title, colour, lines, buttonLabel, tabName) {
  return '<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#16191F;line-height:1.5">' +
    '<p style="font-size:19px;font-weight:bold;color:' + colour + ';margin:0 0 14px">' + title + '</p>' +
    lines.map(function (l) { return '<p style="margin:0 0 6px">' + l + '</p>'; }).join("") +
    openButton(buttonLabel, tabName) +
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
       esc(c.loc) + "</a> (to within " + esc(c.locAcc) + " m)" +
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
function anyToKey(v) {
  if (v instanceof Date) return dateToKey(v);
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
