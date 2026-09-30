/* THE PASSENGER'S MESSAGE BUTTON, ON THE LIVE SERVER.

   The button was built against the sheet, and when the passenger page moved
   to the live server it went dark: the live server sent driver: null, because
   it had no numbers. From v1.90.0 (sheet) and w2.28.0 (Worker) the sheet sends
   every active driver's WhatsApp number on the sync, and the live server hands
   one number to one phone: a phone with a seat on that route, once that
   Sunday's bookings have closed, with the route running. Everybody else still
   gets null.

   On w2.27.0 every check that expects a number fails. The ones that expect
   none pass there trivially, since it never gave one; they are here so that
   switching the button on never hands a number to anybody else. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab } from "../lib/tabs.mjs";
import { seedSunday, seedBookings } from "../lib/seed.mjs";
import { atTime, WHEN } from "../lib/clock.mjs";

const PEOPLE = [
  { Name: "Bro Adrian", Role: "Driver", Active: "YES", "Primary order": 1, Route: "North", Phone: "07700 900111" },
  { Name: "Bro Martin", Role: "Driver", Active: "YES", "Primary order": 3, Route: "North", Phone: "+44 7700 900333" },
  { Name: "Bro Trevor", Role: "Driver", Active: "YES", "Primary order": 1, Route: "South", Phone: "07700900222" },
  { Name: "Bro Old", Role: "Driver", Active: "NO", "Primary order": 2, Route: "South", Phone: "07700900444" },
  { Name: "Bro Short", Role: "Driver", Active: "YES", "Primary order": 2, Route: "North", Phone: "0770" },
  { Name: "Bro Blank", Role: "Driver", Active: "YES", "Primary order": 4, Route: "North", Phone: "" },
  { Name: "Bro Arthur", Role: "Coordinator", Active: "YES", Route: "North", Phone: "07700900555" }
];

function tabs(drivers) {
  return {
    "Bus Stops": tab("Bus Stops", [
      { Route: "North", "Stop ID": "N00", Time: "09:52", Stop: "Church", Active: "YES", Type: "Depart" }]),
    "Drivers": tab("Drivers", drivers),
    "Buses": tab("Buses", [{ Registration: "YS70 PWE", "Seats for passengers": 16, Active: "YES" }]),
    "Rota": [["Date"]],
    "Checks": [["When"]],
    "Defects": [["When"]],
    "Bus Bookings": [["Received"]],
    "Trip Events": [["Logged"]],
    "Rota Requests": [["When"]]
  };
}

export default async function (root) {
  const s = new Suite("the passenger's Message button, from the live server");
  const G = installGlobals();

  /* ---- the sheet ------------------------------------------------------- */

  const sheet = (drivers) => loadCodeGs(root, { tabs: tabs(drivers),
    props: { COORDINATOR_EMAIL: "", PIN_SALT: "salt", WORKER_URL: "https://example.invalid" } });
  const numbers = (L) => call(L, "driverWhatsApp", call(L, "readDrivers", L.ctx.SpreadsheetApp.getActive()));

  s.test("every active driver with a usable number, in the form WhatsApp wants", (a) => {
    const got = numbers(sheet(PEOPLE));
    a.eq(got["Bro Adrian"], "447700900111", "07... becomes 447...");
    a.eq(got["Bro Martin"], "447700900333", "+44 stays as it is, spaces gone");
    a.eq(got["Bro Trevor"], "447700900222");
    a.eq(got["Bro Arthur"], "447700900555", "a coordinator who drives is a driver too");
    a.eq(got["Bro Old"], undefined, "an inactive driver is never sent");
    a.eq(got["Bro Short"], undefined, "too short to be a number is not a number");
    a.eq(got["Bro Blank"], undefined, "no number, nothing sent");
  });

  s.test("the push to the live server carries them", (a) => {
    const L = sheet(PEOPLE);
    call(L, "pushToWorker");
    const sync = L.gas.fetched.map((f) => { try { return JSON.parse(f.opts.payload); } catch (e) { return null; } })
      .filter((b) => b && b.action === "sync")[0];
    a.ok(sync, "no sync was sent");
    a.eq(sync.driverWa && sync.driverWa["Bro Adrian"], "447700900111");
  });

  s.test("the sheet's own button still reads its number the same way", (a) => {
    const L = sheet(PEOPLE);
    a.eq(call(L, "waNumber", "07700 900111"), "447700900111");
    a.eq(call(L, "waNumber", "0770"), "");
    a.eq(call(L, "waNumber", 447700900111), "447700900111", "a number Sheets has made a number");
  });

  /* ---- the live server ------------------------------------------------- */

  const WA = { "Bro Adrian": "447700900111", "Bro Martin": "447700900333", "Bro Trevor": "447700900222" };

  async function fresh(o) {
    o = o || {};
    G.reset();
    const { mod: W } = await loadWorker(root);
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    const key = await atTime(WHEN.sundayRunning, () => W.runSunday());
    await seedSunday(db, key, o.rota);
    await seedBookings(db, key, [{ route: "North", stopId: "N03", pid: "pid-north" },
                                 { route: "South", stopId: "S03", pid: "pid-south" }]);
    if (o.wa !== false) await W.handleSync(env, { driverWa: o.wa || WA });
    return { W, db, env, key };
  }
  const driverAt = (W, env, when, pid) => atTime(when, async () => (await W.busPayload(env, "", "", pid)).driver);

  s.test("a booked passenger on a Sunday morning after the cutoff is given the driver on his route", async (a) => {
    const { W, env } = await fresh();
    const d = await driverAt(W, env, WHEN.sundayRunning, "pid-north");
    a.ok(d, "no driver was given");
    a.eq(d && d.name, "Bro Adrian");
    a.eq(d && d.wa, "447700900111");
    a.eq(d && d.route, "North");
    const south = await driverAt(W, env, WHEN.sundayRunning, "pid-south");
    a.eq(south && south.name, "Bro Trevor", "the South passenger gets the South driver");
  });

  s.test("before bookings close, nobody is given a number", async (a) => {
    const { W, env } = await fresh();
    a.eq(await driverAt(W, env, WHEN.sundayMorning, "pid-north"), null);
  });

  s.test("a phone with no seat is given nothing, even on the morning", async (a) => {
    const { W, env } = await fresh();
    a.eq(await driverAt(W, env, WHEN.sundayRunning, "pid-stranger"), null);
    a.eq(await driverAt(W, env, WHEN.sundayRunning, ""), null);
  });

  s.test("the cover driver is the one reached, not the man first down for it", async (a) => {
    const { W, env } = await fresh({ rota: { northCover: "Bro Martin" } });
    const d = await driverAt(W, env, WHEN.sundayRunning, "pid-north");
    a.eq(d && d.name, "Bro Martin");
    a.eq(d && d.wa, "447700900333");
  });

  s.test("a route called off gives no number", async (a) => {
    const { W, env } = await fresh({ rota: { status: "North cancelled" } });
    a.eq(await driverAt(W, env, WHEN.sundayRunning, "pid-north"), null);
    const south = await driverAt(W, env, WHEN.sundayRunning, "pid-south");
    a.eq(south && south.name, "Bro Trevor", "the route still running is unaffected");
  });

  s.test("a driver with no number gives no button, and nobody else's number is given instead", async (a) => {
    const { W, env } = await fresh({ wa: { "Bro Trevor": "447700900222" } });
    a.eq(await driverAt(W, env, WHEN.sundayRunning, "pid-north"), null);
  });

  s.test("the rota's spelling and the Drivers tab's are matched without case or extra spaces", async (a) => {
    const { W, env } = await fresh({ wa: { "  bro   ADRIAN ": "447700900111" } });
    const d = await driverAt(W, env, WHEN.sundayRunning, "pid-north");
    a.eq(d && d.wa, "447700900111");
  });

  s.test("before any sheet has sent numbers, there is no button", async (a) => {
    const { W, env } = await fresh({ wa: false });
    a.eq(await driverAt(W, env, WHEN.sundayRunning, "pid-north"), null);
  });

  s.test("an older sheet that sends none leaves the last ones; an empty list clears them", async (a) => {
    const { W, env } = await fresh();
    await W.handleSync(env, {});
    a.eq((await driverAt(W, env, WHEN.sundayRunning, "pid-north") || {}).name, "Bro Adrian", "kept");
    await W.handleSync(env, { driverWa: {} });
    a.eq(await driverAt(W, env, WHEN.sundayRunning, "pid-north"), null, "cleared");
  });

  s.test("what is kept is cleaned: digits only, a real length, a name", async (a) => {
    const { W, env } = await fresh({ wa: { "Bro Adrian": "+44 (7700) 900-111", "Bro Martin": "123",
                                           "": "447700900999", "Bro Trevor": "4477009002221234567" } });
    const kept = await W.cacheGet(env, "driver_wa");
    a.eq(kept["Bro Adrian"], "447700900111");
    a.eq(kept["Bro Martin"], undefined, "too short");
    a.eq(kept[""], undefined, "no name");
    a.eq(kept["Bro Trevor"], undefined, "too long");
  });

  return s;
}
