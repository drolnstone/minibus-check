/**
 * Minibus check recorder.
 *
 * Receives a completed check from the phone app and writes it to this
 * spreadsheet. Emails the coordinator whenever a bus is stopped.
 *
 * Setup is in the README. In short:
 *   1. Make a Google Sheet, Extensions > Apps Script, paste this in
 *   2. Change TOKEN and COORDINATOR_EMAIL below
 *   3. Deploy > New deployment > Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *   4. Copy the /exec URL into config.js
 */

/* ---- settings ---------------------------------------------------------- */

var TOKEN = "dominion-minibus";          // must match config.js
var COORDINATOR_EMAIL = "asimbassey@yahoo.com";   // blank = no email alerts
var CHECKS_SHEET = "Checks";
var STATUS_OPTIONS = ["Open", "Booked in", "Parts on order", "Fixed", "Monitoring", "Not a defect"];
var DEFECTS_SHEET = "Defects";

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

    var c = body.check;
    if (!c || !c.id) {
      return reply({ ok: false, error: "no check in request" });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var checks = sheet(ss, CHECKS_SHEET, [
      "Received", "Check ID", "Date", "Time", "Vehicle", "Registration",
      "Driver", "Role", "Mileage", "Mileage flag", "Outcome",
      "Items checked", "Defect count", "Defects", "Renewals due", "Signed"
    ]);

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
      new Date(),
      c.id,
      c.date || "",
      c.time || "",
      c.vehicle || "",
      c.reg || "",
      c.driver || "",
      c.role || "",
      c.miles || "",
      c.milesFlag || "",
      outcome,
      (c.checked || "") + "/" + (c.total || ""),
      (c.defects || []).length,
      defectText,
      c.renewals || "",
      c.sign || ""
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
      notify(c, outcome, defectText);
    }

    return reply({ ok: true });

  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

/**
 * The app calls this with ?last=1 to find the most recent mileage recorded
 * for each vehicle, so a driver sees what was logged last week and gets a
 * warning if the new reading is lower.
 */
function doGet(e) {
  var wantLast = e && e.parameter && e.parameter.last;
  if (!wantLast) {
    return reply({ ok: true, service: "minibus check recorder" });
  }

  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CHECKS_SHEET);
    if (!sh || sh.getLastRow() < 2) return reply({ ok: true, last: {} });

    // Columns: 1 Received, 2 Check ID, 3 Date, 4 Time, 5 Vehicle,
    //          6 Registration, 7 Driver, 8 Role, 9 Mileage, 10 Mileage flag ...
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
    return reply({ ok: true, last: last });

  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

/* ---- helpers ----------------------------------------------------------- */

function reply(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
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

/**
 * Status column (I) becomes a dropdown, and colours itself so open defects
 * stand out from closed ones at a glance.
 */
function setUpDefectsSheet(sh) {
  // Dropdown down the whole column, so pasted or future rows get it too.
  applyStatusDropdown(sh, null);

  var range = sh.getRange("I2:I1000");
  var rules = sh.getConditionalFormatRules();

  function colourRule(value, bg, fg) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(value)
      .setBackground(bg)
      .setFontColor(fg)
      .setRanges([range])
      .build();
  }

  rules.push(colourRule("Open", "#FBE9E7", "#A8231B"));
  rules.push(colourRule("Booked in", "#FDF3E2", "#8A5300"));
  rules.push(colourRule("Parts on order", "#FDF3E2", "#8A5300"));
  rules.push(colourRule("Monitoring", "#FDF3E2", "#8A5300"));
  rules.push(colourRule("Fixed", "#E6F2EB", "#146B41"));
  rules.push(colourRule("Not a defect", "#F1F1F1", "#666666"));
  sh.setConditionalFormatRules(rules);

  sh.setColumnWidth(8, 320);   // what the driver found
  sh.setColumnWidth(9, 130);   // status
  sh.setColumnWidth(10, 300);  // action taken
  sh.setColumnWidth(11, 110);  // closed on

  applyClosedOnRules(sh);
}

/**
 * "Closed on" (column K) must be a real date, not before this system existed
 * and not in the future. A defect cannot be closed tomorrow.
 */
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

/**
 * Keeps Status and "Closed on" honest, and warns if a date is impossible.
 * This is a simple trigger: it runs whenever someone edits the sheet.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== DEFECTS_SHEET) return;

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

      // A date implies the work is done, so nudge the status along.
      var st = String(sh.getRange(row, 9).getValue() || "");
      if (CLOSED_STATES.indexOf(st) === -1) {
        sh.getRange(row, 9).setValue("Fixed");
      }
    }
  } catch (err) {
    // Never let a trigger error block someone editing the sheet.
  }
}

/**
 * Applies the status dropdown. Pass a row number for one row, or null for
 * the whole column.
 */
function applyStatusDropdown(sh, row) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_OPTIONS, true)
    .setAllowInvalid(false)
    .setHelpText("Pick a status: " + STATUS_OPTIONS.join(", "))
    .build();

  var range = row ? sh.getRange(row, 9) : sh.getRange("I2:I1000");
  range.setDataValidation(rule);
}

/**
 * Run this once by hand from the Apps Script editor if you already have a
 * Defects sheet and want the dropdown added to it.
 */
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

function notify(c, outcome, defectText) {
  var stopped = c.level === "stop";
  var subject = (stopped ? "BUS STOPPED: " : "Defect reported: ") + c.reg +
                " — " + c.date;

  var lines = [
    stopped
      ? "A driver has stopped this vehicle after a safety critical defect."
      : "A driver has reported a defect. The vehicle was safe to drive.",
    "",
    "Vehicle:  " + c.reg + " (" + (c.vehicle || "") + ")",
    "Driver:   " + c.driver + (c.role ? " (" + c.role + ")" : ""),
    "When:     " + c.date + " at " + c.time,
    "Mileage:  " + c.miles + (c.milesFlag ? "   [" + c.milesFlag + "]" : ""),
    "Outcome:  " + outcome,
    "",
    "Defects:",
    defectText.split(" | ").map(function (d) { return "  - " + d; }).join("\n"),
    "",
    "Signed: " + c.sign
  ];

  MailApp.sendEmail(COORDINATOR_EMAIL, subject, lines.join("\n"));
}
