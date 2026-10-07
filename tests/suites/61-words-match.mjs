/* WHAT A LABEL SAYS IS WHAT IS BEHIND IT.
   pages v1.104.1 · server w2.51.0 · sheet v1.111.0 (Asim, 7 October 2026).

   Asim asked of NH56 FWP's red Renewal overdue badge: renewal or service? It
   was the service. A sweep of the words that followed found three more that
   said something other than what their data held:

   - a service past its date was pushed and emailed as "Service expired";
   - "went out unchecked" named every bus ever checked, including a bus on a
     route called off that never went out;
   - the coordinators' Alerts list called a passenger's "Be at your stop" push
     "The bus is on its way", and a route called off on a Friday "No bus
     today" when the passengers were told "on Sunday". */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { loadWorker, installGlobals } from "../lib/worker.mjs";
import { atTime } from "../lib/clock.mjs";
import { TABS, tab } from "../lib/tabs.mjs";

export default async function (root) {
  const s = new Suite("what a label says is what is behind it");
  installGlobals();
  const { mod: W } = await loadWorker(root);

  s.test("a service past its date is overdue, not expired; papers still expire", async (a) => {
    await atTime("2026-10-07T09:00:00+01:00", () => {
      const L = loadCodeGs(root, { tabs: {
        "Buses": tab("Buses", [
          { Registration: "NH56 FWP", "Seats for passengers": 14, Active: "YES",
            "MOT due": "28/04/2027", "Service due": "30/09/2026", "Insurance due": "05/10/2026" }]),
        "Drivers": tab("Drivers", [{ Name: "Bro Arthur", Role: "Coordinator", Active: "YES", Email: "arthur@b.c" }]) },
        props: { COORDINATOR_EMAIL: "coord@b.c" } });
      call(L, "renewalAlerts", L.gas.ss);
      const subj = L.gas.mail.map((m) => m.subject);
      a.ok(subj.indexOf("Minibus: NH56 FWP: Service overdue, was due 30/09/2026") > -1, subj.join(" / "));
      a.ok(subj.indexOf("Minibus: BUS STOPPED: NH56 FWP: Insurance expired 05/10/2026") > -1, subj.join(" / "));
      a.not(subj.some((x) => /Service expired/.test(x)), subj.join(" / "));
      const ins = L.gas.mail.find((m) => /Insurance expired/.test(m.subject));
      a.has(String(ins && ins.body), "Record the new insurance");
    });
  });

  const SUN = new Date(2026, 9, 4);
  function sunday(status) {
    const old = (reg, id) => ({ Received: new Date(2026, 8, 27, 9, 30), Date: new Date(2026, 8, 27), Time: "09:30",
      "Check ID": id, Registration: reg, Driver: "Bro Adrian", Role: "Driver", Mileage: 48000, Outcome: "Cleared" });
    return loadCodeGs(root, { tabs: {
      "Drivers": tab("Drivers", [
        { Name: "Bro Arthur", Role: "Coordinator", Active: "YES", "Primary order": 1, Email: "arthur@b.c", Route: "North" },
        { Name: "Bro Adrian", Role: "Driver", Active: "YES", "Primary order": 2, Email: "ade@b.c", Route: "North" },
        { Name: "Bro Keith", Role: "Driver", Active: "YES", "Primary order": 3, Email: "keith@b.c", Route: "South" }]),
      "Buses": tab("Buses", [
        { Registration: "YS70 PWE", "Seats for passengers": 16, Active: "YES" },
        { Registration: "NH56 FWP", "Seats for passengers": 14, Active: "YES" }]),
      "Rota": tab("Rota", [
        { Sunday: SUN, "North Liverpool scheduled": "Bro Adrian", "North bus": "YS70 PWE",
          Status: status, "South Liverpool scheduled": "Bro Keith", "South bus": "NH56 FWP" }]),
      "Checks": tab("Checks", [old("YS70 PWE", "o1"), old("NH56 FWP", "o2"), old("AB12 CDE", "o3")]),
      "Defects": [["When"]], "Trip Events": [["When"]], "Bus Bookings": [TABS["Bus Bookings"]],
      "Rota Requests": [["When"]] },
      props: { COORDINATOR_EMAIL: "coord@b.c", PIN_SALT: "salt", WORKER_URL: "https://example.invalid" } });
  }
  const toCoord = (L) => L.gas.mail.filter((m) => String(m.to).indexOf("coord@") === 0);

  s.test("went out unchecked names only the buses down for a route that ran", async (a) => {
    await atTime("2026-10-04T10:45:00+01:00", () => {
      const L = sunday("Confirmed");
      call(L, "missingCheckAlert");
      const m = toCoord(L)[0];
      a.ok(m && /YS70 PWE/.test(m.subject) && /NH56 FWP/.test(m.subject), m && m.subject);
      a.not(/AB12 CDE/.test(m.subject), "a bus nobody had today was said to have gone out: " + m.subject);
    });
    await atTime("2026-10-04T10:45:00+01:00", () => {
      const L = sunday("North cancelled");
      call(L, "missingCheckAlert");
      const m = toCoord(L)[0];
      a.ok(m && /NH56 FWP/.test(m.subject), m && m.subject);
      a.not(/YS70 PWE/.test(m.subject), "North's bus never went out: " + m.subject);
    });
    await atTime("2026-10-04T10:45:00+01:00", () => {
      const L = sunday("Cancelled/declined");
      call(L, "missingCheckAlert");
      a.eq(toCoord(L).length, 0, "no bus ran and one was said to have gone out");
    });
  });

  s.test("the Alerts list names a push as the passenger saw it", async (a) => {
    a.eq(W.sentTitle("next|2026-10-04|N03|1", false, { route: "North", stop: "Breck Rd" }), "North: Be at your stop");
    await atTime("2026-10-02T18:00:00+01:00", () => {
      a.eq(W.sentTitle("off|2026-10-04|North", false, { route: "North" }), "North: No bus on Sunday");
    });
    await atTime("2026-10-04T08:00:00+01:00", () => {
      a.eq(W.sentTitle("off|2026-10-04|North", false, { route: "North" }), "North: No bus today");
    });
  });

  /* Asim, 7 October: "MOT is MOT, service is service, parking permit is
     parking permit, insurance is insurance." No word lumps them together. */
  s.test("no screen, push or email says renewal for an item it can name", async (a) => {
    for (const f of ["index.html", "coord/index.html", "sunday/index.html", "Code.gs", "server/worker.js"]) {
      const src = readFileSync(join(root, f), "utf8");
      for (const bad of ["Renewal overdue", "Renewal due soon", "Renewal coming up", "Record the renewal",
                         "Record renewals", "<h3>Renewals</h3>", "<b>Renewals</b>", "\"Renewals overdue"]) {
        a.not(src.indexOf(bad) > -1, f + " still says " + bad);
      }
    }
  });

  return s;
}
