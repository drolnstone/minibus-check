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
    if (over && over.fetch) L.gas.setFetchReply(over.fetch);
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
    /* The time passed in: L was loaded outside the fixed clock, so its Date
       is the real one, and on a real Sunday after 16:00 it sent. */
    await atTime("2026-11-23T16:30:00Z", () => call(L, "runReport", new Date("2026-11-23T16:30:00Z").getTime()));
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

  /* THE LIVE LOCATION LINE, v1.149.0 (Asim, 22 Nov 2026). */
  const withLog = (log, since) => ({ fetch: (url, opts) => {
    const q = JSON.parse(opts.payload || "{}");
    if (q.action !== "livelog") return null;
    return { code: 200, body: JSON.stringify({ ok: true, since: since || at("08:00").getTime(), trips: { t1: log } }) };
  } });
  const body = async (log, since) => (await run("16:05", withLog(log, since))).gas.mail[0].body;
  const blank = { got: 0, first: null, last: null, vague: 0, other: 0, ok: 0, fail: 0, err: "" };

  s.test("live location: from when to when, last line", async (a) => {
    const b = await body(Object.assign({}, blank, { got: 120, first: at("09:58").getTime(), last: at("10:57").getTime(), ok: 40 }));
    a.eq(b.split("\n").pop(), "Live location: 09:58 to 10:57.", b);
  });

  s.test("live location: none, Google failing, another phone, before it was kept", async (a) => {
    a.ok((await body(blank)).endsWith("Live location: none received."));
    a.ok((await body(Object.assign({}, blank, { got: 5, first: at("10:00").getTime(), last: at("10:20").getTime(),
      fail: 3, err: "Service invoked too many times" })))
      .endsWith("Live location: 10:00 to 10:20. Google drive times failed: Service invoked too many times."));
    a.ok((await body(Object.assign({}, blank, { got: 5, first: at("10:00").getTime(), last: at("10:20").getTime(), ok: 9, fail: 2 })))
      .endsWith("Google drive times failed 2 times."));
    a.ok((await body(Object.assign({}, blank, { other: 4 })))
      .endsWith("Live location: none from the phone driving the run; another phone signed in as the driver sent it."));
    a.ok((await body(Object.assign({}, blank, { vague: 4 }))).endsWith("Live location: received, never clear enough to use."));
    a.ok((await body(blank, at("12:00").getTime())).endsWith("Live location: not recorded for this run."));
  });

  s.test("live location: no answer from the live server, the report goes without the line", async (a) => {
    const b = (await run("16:05")).gas.mail[0].body;
    a.ok(b.indexOf("Live location") === -1, b);
  });

  /* v1.152.0, the 22 Nov audit: the day's second trip and moved stops
     from the live server (dayplan). */
  s.test("split day: a stop nobody marked goes under its own trip; a moved one under the route it was on", async (a) => {
    const plan = { fetch: (url, opts) => {
      const q = JSON.parse(opts.payload || "{}");
      if (q.action !== "dayplan") return null;
      return { code: 200, body: JSON.stringify({ ok: true, sunday: KEY, moves: { N04: "South" }, splits: { North: ["N03", "N04"] } }) };
    } };
    const L = await run("16:30", Object.assign(plan, { trips: () => [
      ev({ Event: "start", Happened: at("09:55") }),
      ev({ Event: "end", Happened: at("10:30"), Status: "Logged (auto)" }),
      ev({ Event: "start", Trip: "t2", Happened: at("10:35") }),
      ev({ Event: "end", Trip: "t2", Happened: at("11:00"), Status: "Logged (auto)" })] }));
    const b = L.gas.mail[0].body;
    const one = b.slice(b.indexOf("Trip 1."), b.indexOf("Trip 2.")), two = b.slice(b.indexOf("Trip 2."));
    a.has(one, "Westbrook", b);
    a.ok(two.indexOf("Westbrook") === -1, b);
    a.has(two, "Oak Lane", b);
  });

  return s;
}
