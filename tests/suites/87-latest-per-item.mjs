/* LATEST REPORT PER ITEM. pages v1.173.0 · sheet v1.142.0 (Asim, 16 Nov 2026).

   - The weekly summary lists one line per bus and item, carrying the newest
     report, so an Advisory later reported as a Defect is in Open defects
     only, and a job asked for twice is listed once.
   - A Defects row closed by hand closes the earlier open rows of the same
     bus and item, and leaves later ones and other items alone.
   - The Coordinator App bus page opens on Jobs to arrange.

   Everything here fails on v1.172.0 / v1.141.0. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab } from "../lib/tabs.mjs";
import { atTime } from "../lib/clock.mjs";

export default async function (root) {
  const s = new Suite("latest report per item");
  const SUN = "2026-09-27T19:00:00+01:00";

  function sheet() {
    return loadCodeGs(root, { tabs: {
      "Buses": tab("Buses", [{ Registration: "YS70 PWE", "Seats for passengers": 16, Active: "YES" }]),
      "Drivers": tab("Drivers", [{ Name: "Bro Ben", Role: "Driver", Active: "YES" }]),
      "Defects": tab("Defects", [
        { Date: "06/09/2026", Registration: "YS70 PWE", Driver: "Bro Ben", Item: "Tyres", Critical: "",
          "What the driver found": "Tread low", Status: "Open", Kind: "Advisory" },
        { Date: "13/09/2026", Registration: "YS70 PWE", Driver: "Bro Ben", Item: "Tyres", Critical: "",
          "What the driver found": "Tread lower", Status: "Open", Kind: "Advisory" },
        { Date: "20/09/2026", Registration: "YS70 PWE", Driver: "Bro Ben", Item: "Tyres", Critical: "YES",
          "What the driver found": "Worn through", Status: "Open", Kind: "Defect" },
        { Date: "27/09/2026", Registration: "YS70 PWE", Driver: "Bro Ben", Item: "Horn", Critical: "",
          "What the driver found": "Quiet", Status: "Open", Kind: "Defect" },
        { Date: "27/09/2026", Registration: "YS70 PWE", Driver: "Bro Ben", Item: "Horn", Critical: "",
          "What the driver found": "Quiet now", Status: "Open", Kind: "Advisory" }]),
      "Checks": tab("Checks", [
        { Date: "27/09/2026", Time: "08:45", Registration: "YS70 PWE", Driver: "Bro Ben", Outcome: "Pass",
          "Defect count": 0, "To arrange": "Inside needs a clean" },
        { Date: "27/09/2026", Time: "09:10", Registration: "YS70 PWE", Driver: "Bro Ben", Outcome: "Pass",
          "Defect count": 0, "To arrange": "Inside needs a clean" }]),
      "History": tab("History", [{ When: new Date("2026-09-27T08:50:00+01:00"), Who: "Bro Ben" }])
    }, props: { COORDINATOR_EMAIL: "coord@b.c" } });
  }
  const weekly = (L) => L.gas.mail.find((m) => /weekly summary/.test(m.subject));
  const objs = (L, name) => {
    const v = L.gas.ss.getSheetByName(name).getDataRange().getValues();
    return v.slice(1).map((r) => Object.fromEntries(v[0].map((h, i) => [h, r[i]])));
  };

  s.test("the weekly summary: one line per bus and item, the newest report's", async (a) => {
    await atTime(SUN, () => {
      const L = sheet();
      call(L, "weeklyDigest");
      const m = weekly(L);
      a.ok(m, "no weekly summary");
      const body = m.body;
      a.eq((body.match(/YS70 PWE: Tyres/g) || []).length, 1, "Tyres listed once per report:\n" + body);
      a.has(body, "YS70 PWE: Tyres (critical)   Worn through");
      a.hasnt(body, "Tread low");
      a.eq((body.match(/YS70 PWE: Horn/g) || []).length, 1, "Horn listed in both lists");
      a.has(body, "YS70 PWE: Horn   Quiet now");
      a.has(body, "1 open defect", "counts were reports, not items");
      a.eq((body.match(/Inside needs a clean/g) || []).length, 1, "a job asked for twice was listed twice");
    });
  });

  s.test("closing the newest report by hand closes the earlier ones of that item", async (a) => {
    await atTime(SUN, () => {
      const L = sheet();
      const sh = L.gas.ss.getSheetByName("Defects");
      const head = sh.getDataRange().getValues()[0];
      const cell = sh.getRange(4, head.indexOf("Status") + 1);   /* 20/09 Tyres */
      cell.setValue("Fixed");
      call(L, "onEdit", { range: cell, oldValue: "Open", value: "Fixed" });
      const rows = objs(L, "Defects");
      a.eq(rows.slice(0, 3).map((r) => r.Status).join(","), "Fixed,Fixed,Fixed");
      a.ok(rows.slice(0, 3).every((r) => r["Closed on"]), "an earlier report has no Closed on");
      a.eq(rows.slice(3).map((r) => r.Status).join(","), "Open,Open", "another item was closed");
      const h = objs(L, "History").filter((x) => /Closed with the report of 20\/09\/2026/.test(x.Why || ""));
      a.eq(h.length, 2, JSON.stringify(objs(L, "History")));
    });
  });

  s.test("closing an earlier report leaves a later one open", async (a) => {
    await atTime(SUN, () => {
      const L = sheet();
      const sh = L.gas.ss.getSheetByName("Defects");
      const head = sh.getDataRange().getValues()[0];
      const cell = sh.getRange(3, head.indexOf("Status") + 1);   /* 13/09 Tyres */
      cell.setValue("Not a defect");
      call(L, "onEdit", { range: cell, oldValue: "Open", value: "Not a defect" });
      const rows = objs(L, "Defects");
      a.eq(rows.slice(0, 3).map((r) => r.Status).join(","), "Not a defect,Not a defect,Open");
    });
  });

  s.test("the Coordinator App bus page opens on Jobs to arrange", (a) => {
    const html = readFileSync(join(root, "coord", "index.html"), "utf8");
    const f = html.slice(html.indexOf("function paintBus(reg)"));
    const body = f.slice(0, f.indexOf("\n}\n"));
    const jobs = body.indexOf("<h3>Jobs to arrange</h3>"), defs = body.indexOf("defects are open on this bus");
    const due = body.indexOf("dueRows(b)"), rec = body.indexOf("Record something");
    a.ok(jobs > 0 && jobs < defs && defs < due && due < rec, "Jobs to arrange and the defects line are not first");
  });

  return s;
}
