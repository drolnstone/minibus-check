/* THE SUNDAY RUN REPORT. 19 November 2026. sheet v1.144.0.

   Asim: after the morning run, coordinators get one email per route: time
   left Church, minutes late at each stop, picked up or nobody there, time
   back, parked figures. Sent from 16:00 London (Asim, 19 Nov: first
   Sundays run late), once per route. The clock is fixed in every check. */

import { Suite } from "../lib/t.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { atTime } from "../lib/clock.mjs";
import { TABS, tab } from "../lib/tabs.mjs";

const KEY = "2026-11-22";                                   /* a Sunday; November, London is UTC */
const at = (hhmm) => new Date(KEY + "T" + hhmm + ":00Z");

export default async function (root) {
  const s = new Suite("Sunday run report, one email per route");
  const CHK = TABS["Checks"].concat(["Parked mileage", "Parked at", "Parked fuel"]);
  const ev = (o) => Object.assign({ Sunday: KEY, Route: "North", Trip: "t1", Driver: "Bro Adrian",
                                    Reg: "AB12 CDE", Status: "Logged" }, o);
  const stopRow = (id, time, name, type) => ({ Route: id[0] === "N" ? "North" : "South", "Stop ID": id,
                                               Time: time, Stop: name, Active: "YES", Type: type || "Pickup" });

  function load(over) {
    /* Built here, under the fixed clock: a Date made outside it is not an
       instance of the sandbox's Date, and the tab would read as blank. */
    const trips = (over && over.trips && over.trips()) || [
      ev({ Event: "start", Happened: at("09:57"), Offset: 2 }),
      ev({ Event: "pickup", "Stop ID": "N01", Stop: "Westbrook", Happened: at("10:09"), Offset: 4,
           Scheduled: at("10:05") }),
      ev({ Event: "empty", "Stop ID": "N02", Stop: "Grace Road", Happened: at("10:15"), Offset: 0 }),
      ev({ Event: "pickup", "Stop ID": "N02", Stop: "Grace Road", Happened: at("10:14"), Status: "Undone" }),
      ev({ Event: "end", Happened: at("10:58"), Status: "Logged (auto)", "Ended by": "Bro Adrian" })
    ];
    const checks = (over && over.checks) || [
      { Date: KEY, Registration: "AB12 CDE", Mileage: 45180, "Parked mileage": 45210,
        "Parked at": "14:05", "Parked fuel": "1/2" }
    ];
    const tabs = {
      "Trip Events": tab("Trip Events", trips),
      "Bus Stops": tab("Bus Stops", [stopRow("N01", "10:05", "Westbrook"), stopRow("N02", "10:15", "Grace Road"),
                                     stopRow("N03", "10:25", "Oak Lane"), stopRow("N04", "10:35", "Elm Street"),
                                     stopRow("N09", "11:00", "Church", "Arrival")]),
      "Bus Bookings": tab("Bus Bookings", [
        { Sunday: KEY, Route: "North", "Stop ID": "N01", Stop: "Westbrook", Seats: 2, Status: "Booked" },
        { Sunday: KEY, Route: "North", "Stop ID": "N03", Stop: "Oak Lane", Seats: 1, Status: "Booked" },
        { Sunday: KEY, Route: "North", "Stop ID": "N04", Stop: "Elm Street", Seats: 3, Status: "Cancelled" }
      ]),
      "Checks": [CHK].concat(checks.map((c) => CHK.map((h) => (h in c ? c[h] : "")))),
      "Drivers": tab("Drivers", [])
    };
    return loadCodeGs(root, { tabs, props: Object.assign({ COORDINATOR_EMAIL: "coord@b.c" }, (over && over.props) || {}) });
  }
  const run = (when, over, L) => atTime(KEY + "T" + when + ":00Z", () => {
    L = L || load(over);
    call(L, "runReport");
    return L;
  });

  s.test("16:00 Sunday: one email for the route, facts only", async (a) => {
    const L = await run("16:02");
    a.eq(L.gas.mail.length, 1);
    const m = L.gas.mail[0];
    a.eq(m.to, "coord@b.c");
    a.eq(m.subject, "North run, 22/11/2026");
    a.eq(m.body, [
      "North, 22/11/2026.",
      "Bus AB12 CDE. Driver Bro Adrian.",
      "Left Church 09:57, 2 min late.",
      "",
      "Westbrook: 10:09, 4 min late. Picked up (2 booked).",
      "Grace Road: 10:15, on time. Nobody there.",
      "Oak Lane: not marked (1 booked).",
      "",
      "Back at Church 10:58.",
      "Parked mileage 45,210, keyed 14:05. Parked fuel 1/2."
    ].join("\n"));
  });

  s.test("once per route per Sunday", async (a) => {
    const L = await run("16:02");
    await run("16:07", null, L);
    a.eq(L.gas.mail.length, 1);
  });

  s.test("not before 16:00, not on other days, not without a run", async (a) => {
    a.eq((await run("15:59")).gas.mail.length, 0);
    const L = load();
    await atTime("2026-11-23T16:30:00Z", () => call(L, "runReport"));
    a.eq(L.gas.mail.length, 0);
    a.eq((await run("16:30", { trips: () => [ev({ Event: "pickup", "Stop ID": "N01", Happened: at("10:09") })] })).gas.mail.length, 0);
  });

  s.test("a run not ended waits; parked not keyed says so", async (a) => {
    const open = () => [ev({ Event: "start", Happened: at("09:55") })];
    a.eq((await run("16:30", { trips: open })).gas.mail.length, 0);
    const L = await run("16:30", { checks: [{ Date: KEY, Registration: "AB12 CDE", Mileage: 45180 }],
      trips: () => open().concat([ev({ Event: "end", Happened: at("11:38"), Status: "Logged (server)" })]) });
    const b = L.gas.mail[0].body;
    a.ok(b.indexOf("Left Church 09:55.") !== -1, b);
    a.ok(b.indexOf("Arrival at Church not recorded. Run ended 11:38 by the server.") !== -1, b);
    a.ok(b.indexOf("Parked mileage not received.") !== -1, b);
  });

  s.test("ended in the Coordinator App names who ended it", async (a) => {
    const L = await run("16:30", { trips: () => [ev({ Event: "start", Happened: at("09:55") }),
      ev({ Event: "end", Happened: at("11:05"), "Ended by": "Bro Asim" })] });
    a.ok(L.gas.mail[0].body.indexOf("Run ended 11:05 by Bro Asim.") !== -1, L.gas.mail[0].body);
  });

  return s;
}
