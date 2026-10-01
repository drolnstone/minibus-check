/* EVERY CELL WITH A FIXED ANSWER OFFERS IT. sheet v1.94.0.

   - Critical and Kind on Defects, Active and Route on Drivers, Buses and Bus
     Stops, Status on Bus Bookings and What, Status and Registration on the
     Vehicle Log take a word from their list and nothing else.
   - A right word in the wrong case (advisory, no) becomes the list's own.
   - Critical and Kind are open to edit on a locked sheet; the Vehicle Log
     and History are in the lock set.

   Everything here fails on v1.93.0. */

import { Suite } from "../lib/t.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab, TABS } from "../lib/tabs.mjs";

export default function (root) {
  const s = new Suite("every cell with a fixed answer offers it");

  function sheet() {
    const tabs = {
      "Drivers": tab("Drivers", [
        { Name: "Bro Trevor", Role: "Driver", Active: "YES", "Primary order": 1, Route: "North" },
        { Name: "Sis Ama", Role: "Assistant Coordinator", Active: "YES", "Primary order": 1, Route: "South" }]),
      "Buses": tab("Buses", [
        { Registration: "YS70 PWE", "Seats for passengers": 16, Active: "YES", "Route in odd months": "South" },
        { Registration: "NH56 FWP", "Seats for passengers": 14, Active: "YES", "Route in odd months": "North" }]),
      "Defects": tab("Defects", [
        { "Check ID": "chk-1", Date: "20/09/2026", Registration: "NH56 FWP", Driver: "Bro Trevor",
          Item: "Tyres", Critical: "YES", "What the driver found": "Worn", Status: "Open", Kind: "Defect" }]),
      "Bus Bookings": tab("Bus Bookings", [{ Sunday: "2026-10-04", Route: "North", Status: "Booked" }]),
      "Vehicle Log": tab("Vehicle Log", [{ "Log ID": "H-1", Registration: "NH56 FWP", What: "MOT", Status: "Done" }]),
      "History": tab("History", [])
    };
    return loadCodeGs(root, { tabs, props: {} });
  }
  const ss = (L) => L.ctx.SpreadsheetApp.getActiveSpreadsheet();
  const col = (name, h) => TABS[name].indexOf(h) + 1;
  const rule = (L, name, h) => ss(L).getSheetByName(name).getRange(2, col(name, h)).getDataValidation();

  s.test("each fixed-answer column takes its list and nothing else", (a) => {
    const L = sheet();
    call(L, "refreshDropdowns");
    const want = [
      ["Defects", "Critical", ["YES", "NO"]],
      ["Defects", "Kind", ["Defect", "Advisory"]],
      ["Defects", "Status", ["Open", "Booked in", "Parts on order", "Fixed", "Monitoring", "Not a defect"]],
      ["Drivers", "Active", ["YES", "NO"]],
      ["Drivers", "Route", ["North", "South"]],
      ["Buses", "Active", ["YES", "NO"]],
      ["Buses", "Route in odd months", ["North", "South"]],
      ["Bus Bookings", "Status", ["Booked", "Cancelled"]],
      ["Vehicle Log", "What", ["MOT", "Service", "Insurance", "Parking permit", "Repair", "Tyres", "Other"]],
      ["Vehicle Log", "Status", ["Booked", "Done", "Estimated", "Correction", "Withdrawn"]],
      ["Vehicle Log", "Registration", ["YS70 PWE", "NH56 FWP"]]
    ];
    for (const [name, h, list] of want) {
      const r = rule(L, name, h);
      a.ok(r, name + " " + h + " has no dropdown");
      a.eq(r && r._values.join("|"), list.join("|"), name + " " + h);
      a.eq(r && r._allowInvalid, false, name + " " + h + " lets in a word off the list");
    }
  });

  s.test("a title on the Drivers tab is offered, and a new one is let in", (a) => {
    const L = sheet();
    call(L, "refreshDropdowns");
    const r = rule(L, "Drivers", "Role");
    a.ok(r && r._values.indexOf("Driver") !== -1, "Driver is not offered");
    a.ok(r && r._values.indexOf("Assistant Coordinator") !== -1, "a title already on the tab is not offered");
    a.eq(r && r._allowInvalid, true);
  });

  s.test("a right word in the wrong case becomes the list's own", (a) => {
    const L = sheet();
    call(L, "refreshDropdowns");
    const sh = ss(L).getSheetByName("Defects");
    for (const [h, typed, want] of [["Kind", "advisory", "Advisory"], ["Critical", "no", "NO"], ["Status", " fixed", "Fixed"]]) {
      const cell = sh.getRange(2, col("Defects", h));
      cell.setValue(typed);
      call(L, "onEdit", { range: cell, value: typed, oldValue: "" });
      a.eq(cell.getValue(), want, h);
    }
  });

  s.test("Critical and Kind are read whatever the case", (a) => {
    const L = sheet();
    const sh = ss(L).getSheetByName("Defects");
    sh.getRange(2, col("Defects", "Critical")).setValue("yes");
    sh.getRange(2, col("Defects", "Kind")).setValue("advisory ");
    const d = call(L, "coordDefectsList", ss(L))[0];
    a.eq(d && d.crit, true);
    a.eq(d && d.kind, "Advisory");
  });

  s.test("Critical and Kind can be changed on a locked sheet; Vehicle Log and History are locked", (a) => {
    const L = sheet();
    const locks = call(L, "sheetLocks", ss(L));
    const def = locks.find((x) => x.sh.getName() === "Defects");
    const open = def.ranges.map((r) => r.getColumn());
    for (const h of ["Critical", "Kind", "Status", "Action taken", "Closed on"])
      a.ok(open.indexOf(col("Defects", h)) !== -1, h + " is locked");
    a.ok(open.indexOf(col("Defects", "What the driver found")) === -1, "the driver's words are open");

    const vl = locks.find((x) => x.sh.getName() === "Vehicle Log");
    a.ok(vl, "the Vehicle Log is not locked");
    const vopen = vl ? vl.ranges.map((r) => r.getColumn()) : [];
    a.ok(vopen.indexOf(col("Vehicle Log", "Log ID")) === -1, "Log ID is open");
    a.ok(vopen.indexOf(col("Vehicle Log", "Registration")) !== -1, "a new row cannot be typed");

    const hi = locks.find((x) => x.sh.getName() === "History");
    a.ok(hi && hi.ranges.length === 0, "History is not locked whole");
  });

  return s;
}
