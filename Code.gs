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
var COORDINATOR_EMAIL = "";              // leave blank for no email alerts
var CHECKS_SHEET = "Checks";
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
      "Driver", "Role", "Mileage", "Outcome",
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
        "Item", "Critical", "What the driver found", "Status"
      ]);
      c.defects.forEach(function (d) {
        defs.appendRow([
          new Date(), c.id, c.date || "", c.reg || "", c.driver || "",
          d.name, d.crit ? "YES" : "", d.note || "", "Open"
        ]);
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

function doGet() {
  return reply({ ok: true, service: "minibus check recorder" });
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
  }
  return sh;
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
    "Mileage:  " + c.miles,
    "Outcome:  " + outcome,
    "",
    "Defects:",
    defectText.split(" | ").map(function (d) { return "  - " + d; }).join("\n"),
    "",
    "Signed: " + c.sign
  ];

  MailApp.sendEmail(COORDINATOR_EMAIL, subject, lines.join("\n"));
}
