/* FINAL TOUCHES. pages v1.95.2 · sheet v1.101.0.

   - Coordinators get a monthly summary after each month's last Sunday, and a
     yearly one after the year's last Sunday, from the weekly summary's own
     Sunday evening run. Same people, same figures as the Period summary PDF.
     Sent once each.
   - Samples say Thanksgiving, never Harvest.
   - The driver app fades any button while it is sending, and an MOT run tap
     is sent once.

   Everything here fails on v1.100.0 / v1.95.1. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab } from "../lib/tabs.mjs";
import { atTime } from "../lib/clock.mjs";

export default async function (root) {
  const s = new Suite("Final touches");

  function sheet() {
    return loadCodeGs(root, { tabs: {
      "Buses": tab("Buses", [{ Registration: "YS70 PWE", "Seats for passengers": 16, Active: "YES" }]),
      "Drivers": tab("Drivers", [{ Name: "Bro Ben", Role: "Driver", Active: "YES" }]),
      "Defects": tab("Defects", [
        { Date: "27/09/2026", Registration: "YS70 PWE", Driver: "Bro Ben", Item: "Tyres", Critical: "",
          "What the driver found": "Low", Status: "Open", Kind: "Defect" }]),
      "Checks": tab("Checks", [
        { Date: "27/09/2026", Time: "08:45", Registration: "YS70 PWE", Driver: "Bro Ben", Outcome: "Pass", "Defect count": 0 }]),
      "Rota": tab("Rota", [
        { Sunday: "27/09/2026", "North Liverpool scheduled": "Bro Ben", "North bus": "YS70 PWE" }]),
      "Trip Events": tab("Trip Events", [
        { Sunday: "27/09/2026", Route: "North", Driver: "Bro Ben", Event: "start",
          Happened: new Date("2026-09-27T09:30:00+01:00"), Reg: "YS70 PWE" }]),
      "Bus Bookings": tab("Bus Bookings", [
        { Sunday: "27/09/2026", Route: "North", "Stop ID": "N01", Stop: "Walton Vale", Seats: 3, Status: "Booked" }]),
      "Vehicle Log": tab("Vehicle Log", [
        { "Log ID": "VL-1", Registration: "YS70 PWE", What: "Service", Status: "Done", "Date done": "15/09/2026",
          Garage: "Kwik", "Cost (£)": 210.5 }]),
      "History": tab("History", [{ When: new Date("2026-09-27T08:50:00+01:00"), Who: "Bro Ben" }])
    }, props: { COORDINATOR_EMAIL: "coord@b.c" } });
  }
  const summaries = (L) => L.gas.mail.filter((m) => /monthly|yearly/.test(m.subject));
  const sunday = (L, y, m, d) => new L.ctx.Date(y, m, d);

  s.test("after a month's last Sunday the weekly run also sends the month, once", async (a) => {
    await atTime("2026-09-27T19:00:00+01:00", () => {
      const L = sheet();
      call(L, "weeklyDigest");
      a.eq(L.gas.mail.length, 2, L.gas.mail.map((m) => m.subject).join(" / "));
      const m = summaries(L);
      a.eq(m.length, 1);
      a.eq(m[0].to, "coord@b.c");
      a.eq(m[0].subject, "Minibus monthly summary — September 2026");
      a.has(m[0].body, "31/08/2026 to 27/09/2026");
      a.has(m[0].body, "Sundays: 1");
      a.has(m[0].body, "Seats booked: 3");
      a.has(m[0].body, "Cost on the Vehicle Log (£): 210.50");
      a.has(m[0].htmlBody, "<b>By route</b>");
      a.has(m[0].htmlBody, "<b>Bro Ben</b>");
      call(L, "weeklyDigest");
      a.eq(summaries(L).length, 1, "the month was sent twice");
    });
  });

  s.test("no monthly summary on other Sundays, or before the evening", async (a) => {
    await atTime("2026-09-20T19:00:00+01:00", () => {
      const L = sheet();
      call(L, "weeklyDigest");
      a.eq(summaries(L).length, 0);
    });
    await atTime("2026-09-27T10:00:00+01:00", () => {
      const L = sheet();
      call(L, "weeklyDigest");
      a.eq(summaries(L).length, 0, "sent before the day was over");
    });
  });

  s.test("after the year's last Sunday: December and the year", async (a) => {
    await atTime("2026-12-27T19:00:00Z", () => {
      const L = sheet();
      const sent = call(L, "periodDigests", sunday(L, 2026, 11, 27), new L.ctx.Date());
      a.eq(sent.join(" / "), "month:2026-12-27 / year:2026-12-27");
      const m = summaries(L).map((x) => x.subject);
      a.eq(m.join(" / "), "Minibus monthly summary — December 2026 / Minibus yearly summary — 2026");
      const y = summaries(L)[1];
      a.has(y.body, "29/12/2025 to 27/12/2026");
      a.has(y.body, "Sundays: 1");
    });
  });

  s.test("samples say Thanksgiving, never Harvest", async (a) => {
    for (const f of ["index.html", "sunday/index.html", "coord/index.html"]) {
      const src = readFileSync(join(root, f), "utf8");
      a.not(/harvest/i.test(src), f + " still says Harvest");
    }
    a.has(readFileSync(join(root, "coord/index.html"), "utf8"), "e.g. Thanksgiving service, more people expected");
  });

  s.test("driver app: a sending button fades, and an MOT run tap goes once", async (a) => {
    const src = readFileSync(join(root, "index.html"), "utf8");
    a.has(src, ".btn[disabled]{opacity:.38;pointer-events:none}");
    a.has(src, "if(motRunBusy) return;");
  });

  return s;
}
