/* THE COORDINATOR'S APP, THE LIVE SERVER'S HALF AND THE SHEET'S.

   From w2.18.0 / v1.82.0 / v1.77.0 the coordinator changes the rota, decides
   requests, makes and cancels bookings, closes defects and puts run times
   right on his phone. Each change is taken by the live server under his PIN
   and shown on every phone at once, and the sheet applies it through the
   same code a person editing that cell sets going.

   Every check here fails on w2.17.0 / v1.81.0: none of it existed. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { makeDB, makeOldDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { TABS, tab } from "../lib/tabs.mjs";

const THU = "2026-10-01T12:00:00+01:00";        /* a Thursday: the Sunday ahead is 4 October */
const KEY = "2026-10-04", NEXT = "2026-10-11", LAST = "2026-09-27";
const SUN = "2026-10-04T11:40:00+01:00";         /* after both runs */
const SHEET = "https://script.google.com/macros/s/TEST/exec";
const PIN = "1234";

export default async function (root) {
  const s = new Suite("the coordinator's app");
  const net = installGlobals();
  const { mod: W } = await loadWorker(root);
  /* The two versions as the files carry them, so a release that moves them
     does not fail here for having moved them. */
  const stamp = (f) => (/SCRIPT_VERSION\s*=\s*"([^"]+)"/.exec(readFileSync(join(root, f), "utf8")) || [])[1];
  const WV = stamp("server/worker.js"), GV = stamp("Code.gs");
  const J = async (r) => JSON.parse(await r.text());

  const shelfRow = (date, o) => Object.assign({
    date: date, primary: "Bro Adrian", actual: "Bro Adrian", status: "Confirmed",
    primary2: "Bro Trevor", actual2: "", notes: "", northBus: "YS70 PWE", southBus: "NH56 FWP",
    swaps: [], locked: false, lockNote: "", requests: []
  }, o || {});

  async function fresh(opts) {
    const o = opts || {};
    const db = o.old ? makeOldDB(join(root, "server", "schema.sql")) : makeDB(join(root, "server", "schema.sql"));
    /* The old database is old only where this release reaches: the stop pins
       came in an earlier one and the seed writes them. */
    if (o.old) { db._exec("ALTER TABLE stops ADD COLUMN lat REAL"); db._exec("ALTER TABLE stops ADD COLUMN lng REAL"); }
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await db.prepare(
      "INSERT OR REPLACE INTO rota (sunday, north, north_cover, north_bus, south, south_cover, south_bus, status, notes) " +
      "VALUES (?,?,?,?,?,?,?,?,?)").bind(NEXT, "Bro Martin", "", "NH56 FWP", "Bro Alfred", "", "YS70 PWE", "Confirmed", "").run();
    for (const d of [["Bro Arthur", "Coordinator", "North", 1], ["Pst Kenneth", "Minister in Charge", "North", 2],
                     ["Bro Adrian", "Driver", "North", 3], ["Bro Martin", "Driver", "North", 4],
                     ["Bro Trevor", "Driver", "South", 5], ["Bro Alfred", "Driver", "South", 6]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
        .bind(d[0], d[1], d[2], d[3], await W.pinHashOf(env, d[0], PIN)).run();
    }
    await W.cachePut(env, "auth_rules", { roles: ["coordinator", "minister in charge"], sameHandBothWays: true }).run();
    await W.cachePut(env, "sheet_url", { url: SHEET }).run();
    await W.cachePut(env, "cache_rota", {
      builtAt: Date.now() - 60000, from: "2026-07-12", to: "2028-09-24",
      payload: { ok: true, rows: [shelfRow(LAST), shelfRow(KEY),
                                  shelfRow(NEXT, { primary: "Bro Martin", actual: "Bro Martin", primary2: "Bro Alfred",
                                                   northBus: "NH56 FWP", southBus: "YS70 PWE",
                                                   requests: [{ driver: "Bro Martin", type: "Request cover", status: "Pending" }],
                                                   status: "Change requested" })],
                 openDefects: { "YS70 PWE": [{ reg: "YS70 PWE", item: "Nearside rear tyre", crit: false, note: "Worn edge",
                                               kind: "Defect", date: LAST, checkId: "chk-1", status: "Open" }] } }
    }).run();
    await W.cachePut(env, "coord_shelf", {
      builtAt: Date.now() - 60000, readAt: Date.now() - 60000,
      requests: [{ id: "rq-martin", sunday: NEXT, driver: "Bro Martin", type: "Request cover",
                   reason: "Away at a wedding", swapWith: "", theirSunday: "", bothAgreed: "",
                   status: "Pending", received: Date.now() - 86400000, decidedOn: 0, replacement: "" }],
      defects: [{ key: "chk-1|YS70 PWE|Nearside rear tyre|" + LAST, checkId: "chk-1", reg: "YS70 PWE", date: LAST,
                  driver: "Bro Trevor", item: "Nearside rear tyre", crit: false, found: "Worn edge",
                  status: "Open", action: "", kind: "Defect", received: Date.now() - 4 * 86400000 }]
    }).run();
    return { db, env };
  }
  const post = (env, ctx, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, ctx || {});
  const coord = async (env, body, who, pin, ctx) =>
    J(await post(env, ctx, Object.assign({ action: "coord", who: who || "Bro Arthur", pin: pin || PIN }, body)));
  let n = 0;
  const act = (env, a, ctx) => coord(env, { op: "act", act: Object.assign({ id: "act-" + (++n) + "-test" }, a) }, null, null, ctx);
  const rowOf = async (env, key) => (await W.cachedRota(env, key, 1)).rows.find((r) => r.date === key);

  /* ---- who may ------------------------------------------------------------ */

  s.test("a coordinator's PIN opens it, and the answer carries the rota, the requests and the defects", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await coord(env, { op: "load" });
      a.ok(out.ok, JSON.stringify(out).slice(0, 300));
      a.eq(out.me.name, "Bro Arthur");
      a.eq(out.today, KEY);
      a.ok(out.rota.rows.some((r) => r.date === KEY), "no rota rows");
      a.eq(out.requests[0].reason, "Away at a wedding", "the reason is what he decides on");
      a.ok((out.requests[0].candidates || []).length > 0, "no names offered to cover");
      a.eq(out.defects.length, 1);
      a.eq(out.server, WV);
    });
  });

  s.test("a driver's own PIN does not open it", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await coord(env, { op: "load" }, "Bro Trevor", PIN);
      a.not(out.ok);
      a.eq(out.error, "not authorised");
      a.eq(out.requests, undefined, "a refusal carried the reasons anyway");
    });
  });

  s.test("a wrong PIN is refused and counts towards the same lockout as everywhere else", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const one = await coord(env, { op: "load" }, "Bro Arthur", "9999");
      a.eq(one.error, "bad pin");
      a.eq(one.left, 2);
      await coord(env, { op: "load" }, "Bro Arthur", "9999");
      await coord(env, { op: "load" }, "Bro Arthur", "9999");
      const locked = await coord(env, { op: "load" }, "Bro Arthur", PIN);
      a.ok(locked.locked, "three wrong and the right one still opened it");
    });
  });

  s.test("the bookings with their phone numbers come only with a PIN", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      await db.prepare("INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received) " +
                       "VALUES (?,?,?,?,?,?,?,?,?,?)").bind(KEY, "South", "S03", "Sedley St", 2, "dev", "pid", "07700900123", "Booked", Date.now()).run();
      const no = await coord(env, { op: "bookings", sunday: KEY }, "Bro Arthur", "0000");
      a.not(no.ok);
      a.hasnt(JSON.stringify(no), "07700900123");
      const yes = await coord(env, { op: "bookings", sunday: KEY });
      const s03 = yes.routes.find((r) => r.route === "South").stops.find((x) => x.id === "S03");
      a.eq(s03.seats, 2);
      a.eq(s03.bookings[0].phone, "07700900123");
    });
  });

  /* ---- the rota ----------------------------------------------------------- */

  s.test("a cover put on a Sunday shows on every phone at once, before the sheet has it", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "rota", sunday: KEY, set: { northCover: "Bro Martin" } });
      a.ok(out.ok, JSON.stringify(out));
      a.eq(out.action.state, "waiting");
      const row = await rowOf(env, KEY);
      a.eq(row.actual, "Bro Martin", "the driver app's rota does not show the cover");
      a.eq(row.status, "Covered", "the status rule the sheet runs was not followed");
      a.ok(row.coordPending);
      const raw = await W.getRotaRow(env, KEY);
      a.eq(raw.north_cover, "Bro Martin", "the live server's own rota table was not changed");
      a.eq(W.rotaDriverFor(raw, "North"), "Bro Martin", "the morning reminder would go to the wrong man");
    });
  });

  s.test("the change survives a push from the sheet that does not include it yet", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      await act(env, { kind: "rota", sunday: KEY, set: { northCover: "Bro Martin" } });
      /* An hourly push that started before the sheet had it. */
      await W.handleSync(env, { rota: [{ date: KEY, primary: "Bro Adrian", actual: "", northBus: "YS70 PWE",
                                         primary2: "Bro Trevor", actual2: "", southBus: "NH56 FWP", status: "Confirmed", notes: "" }],
                                coordApplied: [] });
      const raw = await W.getRotaRow(env, KEY);
      a.eq(raw.north_cover, "Bro Martin", "the push put the old rota back over the coordinator's change");
      a.eq((await rowOf(env, KEY)).actual, "Bro Martin");
    });
  });

  s.test("once a push names the change, the sheet's own copy speaks for itself", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "rota", sunday: KEY, set: { northCover: "Bro Martin" } });
      await W.handleSync(env, { coordApplied: [out.action.id],
                                cache: { builtAt: Date.now(), from: "2026-07-12", to: "2028-09-24",
                                         rota: { ok: true, rows: [shelfRow(KEY, { actual: "Bro Abel", status: "Covered" })] } } });
      const row = await rowOf(env, KEY);
      a.eq(row.actual, "Bro Abel", "the overlay went on after the sheet had sent its own answer");
      a.not(row.coordPending);
    });
  });

  s.test("one man cannot be put on both routes the same morning", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "rota", sunday: KEY, set: { northCover: "Bro Trevor" } });
      a.not(out.ok);
      a.has(out.error, "both routes");
    });
  });

  s.test("only an active driver can be put on a Sunday, and only a Sunday still to come", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      a.has((await act(env, { kind: "rota", sunday: KEY, set: { north: "Bro Nobody" } })).error, "not an active driver");
      a.has((await act(env, { kind: "rota", sunday: LAST, set: { north: "Bro Martin" } })).error, "been and gone");
      a.has((await act(env, { kind: "rota", sunday: "2026-10-05", set: { north: "Bro Martin" } })).error, "not a Sunday");
    });
  });

  s.test("a route called off stops bookings on it at once", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "rota", sunday: KEY, set: { status: "North cancelled" } });
      a.ok(out.ok, JSON.stringify(out));
      a.ok(W.routeCancelled(await W.getRotaRow(env, KEY), "North"), "the passenger page would still take seats");
      const b = await J(await W.handleBooking(env, { date: KEY, stopId: "N02", seats: 1, ref: "abc", phone: "07700900123" }));
      a.not(b.ok, "a seat was taken on a bus that is not running");
      a.eq((await rowOf(env, KEY)).status, "North cancelled");
    });
  });

  s.test("putting a route back on gives the status the sheet would", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      await act(env, { kind: "rota", sunday: KEY, set: { status: "North cancelled" } });
      const back = await act(env, { kind: "rota", sunday: KEY, set: { status: "running" } });
      a.ok(back.ok, JSON.stringify(back));
      a.eq((await rowOf(env, KEY)).status, "Confirmed");
      /* With a request waiting on it, the Sunday still needs attention. */
      await act(env, { kind: "rota", sunday: NEXT, set: { status: "Cancelled/declined" } });
      await act(env, { kind: "rota", sunday: NEXT, set: { status: "running" } });
      a.eq((await rowOf(env, NEXT)).status, "Change requested");
    });
  });

  s.test("a bus already on the other route is refused, and the two can be swapped", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const clash = await act(env, { kind: "rota", sunday: KEY, set: { northBus: "NH56 FWP" } });
      a.not(clash.ok);
      a.eq(clash.clash, "NH56 FWP");
      const swap = await act(env, { kind: "rota", sunday: KEY, set: { northBus: "NH56 FWP", southBus: "YS70 PWE" } });
      a.ok(swap.ok, JSON.stringify(swap));
      const row = await rowOf(env, KEY);
      a.eq(row.northBus, "NH56 FWP");
      a.eq(row.southBus, "YS70 PWE");
      const f = await W.busFor(env, KEY, "North", await W.getBuses(env), await W.getRotaRow(env, KEY));
      a.eq(f.reg, "NH56 FWP", "the seats on the passenger page are still counted against the old bus");
    });
  });

  s.test("a note is added once, however many times the change is laid over", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      await act(env, { kind: "rota", sunday: KEY, note: "North ran without a vehicle check, authorised by Bro Arthur." });
      await W.reapplyRawRota(env);
      await W.reapplyRawRota(env);
      const raw = await W.getRotaRow(env, KEY);
      a.eq(raw.notes.split("\n").length, 1, "got: " + raw.notes);
      a.has((await rowOf(env, KEY)).notes, "authorised by Bro Arthur");
    });
  });

  /* ---- requests ------------------------------------------------------------ */

  s.test("a request approved with a cover shows covered at once, and its email link is spent", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      const link = await J(await W.handleMintLink(env, { link: { kind: "rota", subject: { id: "rq-martin", sunday: NEXT, driver: "Bro Martin" } } }));
      const out = await act(env, { kind: "decide", requestId: "rq-martin", choice: "Approved", cover: "Bro Adrian" });
      a.ok(out.ok, JSON.stringify(out));
      const row = await rowOf(env, NEXT);
      a.eq(row.actual, "Bro Adrian");
      a.eq(row.status, "Covered");
      a.eq(row.requests[0].status, "Approved", "the driver's own screen still says Pending");
      const what = await J(await W.handleLinkWhat(env, { token: link.token }));
      a.ok(what.used, "the email link could still be used to decide it a second time");
      const l = db._one("SELECT synced FROM links WHERE token=?", link.token);
      a.eq(l.synced, 1, "the spent link would be carried to the sheet as a second decision");
      const load = await coord(env, { op: "load" });
      a.eq(load.requests.find((r) => r.id === "rq-martin").status, "Approved");
    });
  });

  s.test("a request cannot be decided twice", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      await act(env, { kind: "decide", requestId: "rq-martin", choice: "Rejected" });
      const again = await act(env, { kind: "decide", requestId: "rq-martin", choice: "Approved" });
      a.not(again.ok);
      a.has(again.error, "already");
    });
  });

  s.test("the cover cannot be somebody already driving the other route that morning", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "decide", requestId: "rq-martin", choice: "Approved", cover: "Bro Alfred" });
      a.not(out.ok);
      a.has(out.error, "already driving South");
    });
  });

  s.test("turning a request down on a Sunday that is called off leaves it called off", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      await act(env, { kind: "rota", sunday: NEXT, set: { status: "Cancelled/declined" } });
      await act(env, { kind: "decide", requestId: "rq-martin", choice: "Rejected" });
      a.eq((await rowOf(env, NEXT)).status, "Cancelled/declined");
      a.eq((await W.getRotaRow(env, NEXT)).status, "Cancelled/declined");
    });
  });

  /* ---- bookings ----------------------------------------------------------- */

  s.test("a booking made for somebody who rang is on the driver's list at once and goes to the sheet", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const out = await act(env, { kind: "booking", op: "add", sunday: KEY, stopId: "S03", seats: 2, phone: "07700 900456" });
      a.ok(out.ok, JSON.stringify(out));
      const rows = await W.liveBookings(env, KEY);
      a.eq(rows.length, 1);
      a.eq(rows[0].phone, "07700900456");
      a.eq(W.bookingCounts(rows).S03, 2);
      const d = await J(await W.handleDrain(env, { limit: 300 }));
      a.eq(d.bookings.length, 1, "the booking is not on its way to the sheet");
      a.has(d.bookings[0].note, "Bro Arthur");
      a.eq(d.coord.length, 1, "the action is not on its way to the sheet");
      a.eq(d.coord[0].body.bookingId, d.bookings[0].id);
    });
  });

  s.test("a passenger with that number sees the booking as his own", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      await act(env, { kind: "booking", op: "add", sunday: KEY, stopId: "S03", seats: 2, phone: "07700900456" });
      const pid = await W.passengerId(env, "07700900456");
      const page = await W.busPayload(env, KEY, "", pid);
      a.ok(page.mine && page.mine.seats === 2, "got " + JSON.stringify(page.mine));
    });
  });

  s.test("a booking cancelled for somebody who rang comes off the list", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      const r = await db.prepare("INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received, synced) " +
                                 "VALUES (?,?,?,?,?,?,?,?,?,?,1)").bind(KEY, "North", "N02", "Grace Rd", 3, "dev", "pid", "07700900111", "Booked", Date.now()).run();
      const out = await act(env, { kind: "booking", op: "cancel", bookingId: r.meta.last_row_id });
      a.ok(out.ok, JSON.stringify(out));
      a.eq((await W.liveBookings(env, KEY)).length, 0);
      const row = db._one("SELECT status, synced, note FROM bookings WHERE id=?", r.meta.last_row_id);
      a.eq(row.status, "Cancelled");
      a.eq(row.synced, 0, "the cancellation would never reach the sheet");
      a.hasnt(out.action.words, "07700900111", "a whole phone number went into the activity list");
    });
  });

  s.test("no seat is booked at a stop the bus has already been to", async (a) => {
    await atTime("2026-10-04T10:30:00+01:00", async () => {
      const { env } = await fresh();
      await W.handleTrip(env, { trip: "t1", route: "South", driver: "Bro Trevor", reg: "NH56 FWP", sunday: KEY,
                                events: [{ event: "start", at: Date.now() - 900000 },
                                         { event: "picked", stopId: "S03", at: Date.now() - 300000 }] });
      const out = await act(env, { kind: "booking", op: "add", sunday: KEY, stopId: "S03", seats: 1 });
      a.not(out.ok);
      a.has(out.error, "already been");
    });
  });

  /* ---- defects ------------------------------------------------------------ */

  s.test("a defect is closed only with what was done, and leaves every phone at once", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const key = "chk-1|YS70 PWE|Nearside rear tyre|" + LAST;
      const bare = await act(env, { kind: "defect", key: key, status: "Fixed", action: "" });
      a.not(bare.ok);
      a.has(bare.error, "what was done");
      const out = await act(env, { kind: "defect", key: key, status: "Fixed", action: "Tyre replaced at Halfords" });
      a.ok(out.ok, JSON.stringify(out));
      const shelf = await W.cachedRota(env, KEY, 1);
      a.eq(JSON.stringify(shelf.openDefects || {}), "{}", "the driver's pre-check still lists it");
      const load = await coord(env, { op: "load" });
      a.eq(load.defects.length, 0);
    });
  });

  s.test("the sheet and the live server name a defect the same way", async (a) => {
    const d = { checkId: "chk-1", reg: "ys70 pwe ", item: "Nearside rear tyre ", date: LAST };
    const L = loadCodeGs(root, { tabs: { "Defects": tab("Defects", [
      { "Check ID": "chk-1", Date: new Date(2026, 8, 27), Registration: "ys70 pwe ", Item: "Nearside rear tyre ", Status: "Open" }]) } });
    const sh = L.gas.ss.getSheetByName("Defects");
    const dc = call(L, "colsSoft", sh, "Defects");
    const vals = sh.getRange(2, 1, 1, sh.getLastColumn()).getValues()[0];
    a.eq(call(L, "defectKey", vals, dc), W.defectKeyOf(d));
  });

  /* ---- the run record ------------------------------------------------------- */

  async function morning(env) {
    const t0 = new Date("2026-10-04T10:21:00+01:00").getTime();
    await W.handleTrip(env, { trip: "t1", route: "South", driver: "Bro Trevor", reg: "NH56 FWP", sunday: KEY,
                              events: [{ event: "start", at: t0 },
                                       { event: "picked", stopId: "S03", at: t0 + 30 * 60000 },
                                       { event: "end", at: t0 + 45 * 60000 }] });
  }

  s.test("a stop time put right is marked as a correction and goes back to the sheet", async (a) => {
    await atTime(SUN, async () => {
      const { db, env } = await fresh();
      await morning(env);
      await J(await W.handleDrain(env, { limit: 300 }));
      db._exec("UPDATE trip_events SET synced=1");
      const runs = await coord(env, { op: "runs", sunday: KEY });
      const s03 = runs.routes.find((r) => r.route === "South").runs[0].stops.find((x) => x.id === "S03");
      a.ok(s03.ev, "the tap is not on the run record");
      const out = await act(env, { kind: "fix", sunday: KEY, eventId: s03.ev.id, time: "10:39" });
      a.ok(out.ok, JSON.stringify(out));
      const row = db._one("SELECT * FROM trip_events WHERE id=?", s03.ev.id);
      a.eq(W.londonHHMM(new Date(row.happened)), "10:39");
      a.eq(row.off_min, 2, "the minutes off the timetable were not worked out again");
      a.has(row.status, "Corrected");
      a.has(row.fix_note, "Recorded as 10:51");
      a.eq(row.synced, 0, "the correction would never reach the Trip Events tab");
      /* Put right again, it still says what it was first recorded as. */
      await act(env, { kind: "fix", sunday: KEY, eventId: s03.ev.id, time: "10:40" });
      a.has(db._one("SELECT fix_note FROM trip_events WHERE id=?", s03.ev.id).fix_note, "Recorded as 10:51");
    });
  });

  s.test("a stop nobody tapped can be given its time", async (a) => {
    await atTime(SUN, async () => {
      const { db, env } = await fresh();
      await morning(env);
      const out = await act(env, { kind: "fix", sunday: KEY, trip: "t1", stopId: "S05", time: "10:47" });
      a.ok(out.ok, JSON.stringify(out));
      const row = db._one("SELECT * FROM trip_events WHERE trip='t1' AND stop_id='S05'");
      a.eq(row.status, "Corrected");
      a.has(row.fix_note, "No tap was recorded");
      const d = await J(await W.handleDrain(env, { limit: 300 }));
      const c = d.coord.find((x) => x.kind === "fix");
      a.eq(c.body.eventId, row.id, "the sheet would not know which row to look for");
    });
  });

  /* A Worker of its own for each of these. It remembers, in module
     variables, that it has made its tables and columns: right for a Worker,
     where one isolate serves one database for life, and wrong for a suite
     that has already shown this module a newer database. */
  s.test("a correction on a database from before this release adds its own column", async (a) => {
    await atTime(SUN, async () => {
      const { mod: W2 } = await loadWorker(root);
      const { db, env } = await fresh({ old: true });
      await W2.handleTrip(env, { trip: "t1", route: "South", driver: "Bro Trevor", reg: "NH56 FWP", sunday: KEY,
                                 events: [{ event: "start", at: new Date("2026-10-04T10:21:00+01:00").getTime() },
                                          { event: "picked", stopId: "S03", at: new Date("2026-10-04T10:51:00+01:00").getTime() }] });
      const ev = db._one("SELECT id FROM trip_events WHERE stop_id='S03'");
      const out = await J(await W2.default.fetch(new Request("https://worker.test/", { method: "POST",
        body: JSON.stringify({ token: "minibusapp", action: "coord", who: "Bro Arthur", pin: PIN,
                               op: "act", act: { id: "old-fix-1", kind: "fix", sunday: KEY, eventId: ev.id, time: "10:39" } }) }), env, {}));
      a.ok(out.ok, JSON.stringify(out));
      a.has(db._one("SELECT fix_note FROM trip_events WHERE id=?", ev.id).fix_note, "Corrected by Bro Arthur");
    });
  });

  /* ---- the plumbing ----------------------------------------------------------- */

  s.test("a change knocks on the sheet's door once he has his answer; a look does not", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const waits = [];
      await coord(env, { op: "load" }, null, null, { waitUntil: (p) => waits.push(p) });
      a.eq(waits.length, 0, "opening the app knocked on the sheet");
      await coord(env, { op: "act", act: { id: "knock-test-1", kind: "rota", sunday: KEY, set: { northCover: "Bro Martin" } } },
                  null, null, { waitUntil: (p) => waits.push(p) });
      a.eq(waits.length, 1);
      await Promise.all(waits);
    });
  });

  s.test("the same change sent twice is one change", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      const body = { id: "twice-1", kind: "booking", op: "add", sunday: KEY, stopId: "N02", seats: 1 };
      const one = await coord(env, { op: "act", act: body });
      const two = await coord(env, { op: "act", act: body });
      a.ok(one.ok && two.ok && two.duplicate);
      a.eq(db._one("SELECT COUNT(*) AS n FROM bookings").n, 1);
      a.eq(db._one("SELECT COUNT(*) AS n FROM coord_actions").n, 1);
    });
  });

  s.test("what the sheet says about each change is what he is shown", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      const ok = await act(env, { kind: "rota", sunday: KEY, set: { northCover: "Bro Martin" } });
      const no = await act(env, { kind: "rota", sunday: NEXT, note: "a note" });
      const d = await J(await W.handleDrain(env, { limit: 300 }));
      await W.handleDrained(env, { claim: d.claim, coord: [
        { id: ok.action.id, ok: true, result: "On the Rota tab." },
        { id: no.action.id, ok: false, result: "That Sunday has been and gone, so the Rota tab was left as it is." }] });
      const load = await coord(env, { op: "load" });
      const byId = {};
      for (const x of load.activity) byId[x.id] = x;
      a.eq(byId[ok.action.id].state, "done");
      a.eq(byId[no.action.id].state, "refused");
      a.has(byId[no.action.id].result, "been and gone");
      a.ok(!(await rowOf(env, NEXT)).notes, "a change the sheet refused is still shown as made");
    });
  });

  s.test("a coordinator's change waiting for the sheet keeps the clock knocking", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      a.not(await W.anythingWaiting(env));
      await act(env, { kind: "rota", sunday: KEY, set: { northCover: "Bro Martin" } });
      a.ok(await W.anythingWaiting(env));
    });
  });

  s.test("a database from before this release makes its own table on the first change", async (a) => {
    await atTime(THU, async () => {
      const { mod: W2 } = await loadWorker(root);
      const { env } = await fresh({ old: true });
      const out = await J(await W2.default.fetch(new Request("https://worker.test/", { method: "POST",
        body: JSON.stringify({ token: "minibusapp", action: "coord", who: "Bro Arthur", pin: PIN,
                               op: "act", act: { id: "old-rota-1", kind: "rota", sunday: KEY, set: { northCover: "Bro Martin" } } }) }), env, {}));
      a.ok(out.ok, JSON.stringify(out));
      const d = await J(await W2.handleDrain(env, { limit: 300 }));
      a.eq(d.coord.length, 1);
    });
  });

  /* ---- the reports -------------------------------------------------------------- */

  s.test("four reports are answered by the live server from its own copy", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      await db.prepare("INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received) " +
                       "VALUES (?,?,?,?,?,?,?,?,?,?)").bind(KEY, "South", "S03", "Sedley St", 17, "dev", "pid", "", "Booked", Date.now()).run();
      const b = await coord(env, { op: "report", name: "bookings" });
      a.has(b.title, "Sunday 4 October");
      a.has(JSON.stringify(b.sections), "Sedley St  17 people");
      const seats = await coord(env, { op: "report", name: "seats" });
      a.has(JSON.stringify(seats.sections), "over by 3", JSON.stringify(seats));
      const al = await coord(env, { op: "report", name: "alerts" });
      a.has(al.lead, "no alerts yet");
      const bu = await coord(env, { op: "report", name: "buses" });
      a.has(JSON.stringify(bu.sections), "North YS70 PWE");
    });
  });

  s.test("is everything working asks the sheet, and says so when it does not answer", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      env.SHEET_PUSH_MS = 200;
      net.reset();
      net.reply(new Response(JSON.stringify({ ok: true, report: { title: "Minibus: all well",
        sections: [{ head: "Fine", tone: "good", lines: ["Script is v1.82.0."] }] } }), { status: 200 }));
      const up = await coord(env, { op: "report", name: "health" });
      a.eq(up.title, "Minibus: all well");
      a.has(JSON.stringify(up.sections), "Script is v1.82.0.");
      a.has(JSON.stringify(up.sections), "Live server " + WV);
      const asked = net.calls.find((c) => String(c.url) === SHEET);
      a.ok(asked && JSON.parse(asked.opts.body).action === "report", "the sheet was not asked");
      net.reset();
      net.reply(() => new Promise(() => {}));
      const down = await coord(env, { op: "report", name: "health" });
      a.ok(down.sheetDown);
      a.has(down.lead, "did not answer");
      net.reset();
    });
  });

  /* ================================================================ the sheet */

  const SOON = new Date(2026, 9, 4);     /* 4 October, inside the seven day email horizon */
  function sheet(o) {
    o = o || {};
    const tabs = {
      "Bus Stops": tab("Bus Stops", [
        { Route: "North", "Stop ID": "N02", Time: "10:15", Stop: "Grace Rd", Active: "YES", Type: "Pickup" },
        { Route: "South", "Stop ID": "S03", Time: "10:37", Stop: "Sedley St", Active: "YES", Type: "Pickup" }]),
      "Drivers": tab("Drivers", [
        { Name: "Bro Arthur", Role: "Coordinator", Active: "YES", "Primary order": 1, PIN: "1234", Email: "arthur@b.c", Route: "North" },
        { Name: "Bro Adrian", Role: "Driver", Active: "YES", "Primary order": 2, PIN: "1234", Email: "ade@b.c", Route: "North" },
        { Name: "Bro Martin", Role: "Driver", Active: "YES", "Primary order": 3, PIN: "1234", Email: "martin@b.c", Route: "North" },
        { Name: "Bro Trevor", Role: "Driver", Active: "YES", "Primary order": 1, PIN: "1234", Email: "trevor@b.c", Route: "South" }]),
      "Buses": tab("Buses", [{ Registration: "YS70 PWE", "Seats for passengers": 16, Active: "YES" },
                             { Registration: "NH56 FWP", "Seats for passengers": 14, Active: "YES" }]),
      "Rota": tab("Rota", [{ Sunday: SOON, "North Liverpool scheduled": "Bro Adrian", "North bus": "YS70 PWE",
                             Status: o.status || "Confirmed", "South Liverpool scheduled": "Bro Trevor", "South bus": "NH56 FWP" }]),
      "Rota Requests": tab("Rota Requests", o.requests || [
        { Received: new Date(2026, 8, 30), "Request ID": "rq-ade", Sunday: SOON, Driver: "Bro Adrian",
          Type: "Request cover", Reason: "Away", Status: "Pending" }]),
      "Checks": [TABS["Checks"]],
      "Defects": tab("Defects", [
        { Received: new Date(2026, 8, 27), "Check ID": "chk-1", Date: new Date(2026, 8, 27), Registration: "YS70 PWE",
          Driver: "Bro Trevor", Item: "Nearside rear tyre", Critical: "", "What the driver found": "Worn edge",
          Status: "Open", Kind: "Defect" }]),
      "Trip Events": tab("Trip Events", o.trips || []),
      "Bus Bookings": tab("Bus Bookings", o.bookings || [])
    };
    return loadCodeGs(root, { tabs, props: { COORDINATOR_EMAIL: "arthur@b.c", PIN_SALT: "salt",
                                             WORKER_URL: "https://worker.test" } });
  }
  function worker(L, answers) {
    const sent = [];
    L.ctx.UrlFetchApp = { fetch(url, opts) {
      const body = JSON.parse((opts && opts.payload) || "{}");
      sent.push(body);
      const fn = answers[body.action];
      const out = typeof fn === "function" ? fn(body) : (fn || { ok: true });
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(out), getAllHeaders: () => ({}) };
    } };
    return sent;
  }
  const cell = (L, tabName, row, heading) => {
    const sh = L.gas.ss.getSheetByName(tabName);
    return sh.getRange(row, TABS[tabName].indexOf(heading) + 1);
  };
  const A = (id, kind, body, extra) => Object.assign({ id: id, kind: kind, sunday: body.sunday || "", by: "Bro Arthur",
                                                      made: Date.now(), body: body }, extra || {});

  s.test("the sheet writes a cover the way a person's edit would: status, stamp and both emails", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      worker(L, {});
      const out = call(L, "applyCoordAction", L.gas.ss, A("c1", "rota", { sunday: KEY, set: { northCover: "Bro Martin" } }), {});
      a.ok(out.done && out.ok, JSON.stringify(out));
      a.eq(cell(L, "Rota", 2, "North Liverpool actual / cover").getValue(), "Bro Martin");
      a.eq(cell(L, "Rota", 2, "Status").getValue(), "Covered");
      a.eq(cell(L, "Rota", 2, "Updated by").getValue(), "Bro Arthur (app)");
      const to = L.gas.mail.map((m) => String(m.to));
      a.ok(to.indexOf("martin@b.c") !== -1, "the man now covering was not told: " + to.join());
      a.ok(to.indexOf("ade@b.c") !== -1, "the man coming off was not told: " + to.join());
    });
  });

  s.test("a change the sheet has already applied is not applied again", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      const sent = worker(L, { drain: () => ({ ok: true, claim: -5, bookings: [], trips: [], checks: [], auths: [],
                                                decisions: [], requests: [],
                                                coord: [A("c-note", "rota", { sunday: KEY, note: "Bus back at 12" })] }) });
      call(L, "drainFromWorker");
      call(L, "drainFromWorker");
      const notes = String(cell(L, "Rota", 2, "Notes").getValue());
      a.eq(notes, "Bus back at 12", "got: " + notes);
      const dones = sent.filter((b) => b.action === "drained");
      a.eq(dones.length, 2, "the second drain did not confirm it");
      a.ok(dones[1].coord[0].ok);
      const push = sent.filter((b) => b.action === "sync").pop();
      a.ok(push && (push.coordApplied || []).indexOf("c-note") !== -1, "the push does not name the change it includes");
    });
  });

  s.test("a request decided in the app goes through the email link's own code, and says where it came from", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      worker(L, {});
      const out = call(L, "applyCoordAction", L.gas.ss,
        A("c2", "decide", { requestId: "rq-ade", choice: "Approved", cover: "Bro Martin", sunday: KEY, driver: "Bro Adrian" }), {});
      a.ok(out.ok, JSON.stringify(out));
      a.eq(cell(L, "Rota Requests", 2, "Status").getValue(), "Approved");
      a.eq(cell(L, "Rota", 2, "North Liverpool actual / cover").getValue(), "Bro Martin");
      a.has(cell(L, "Rota Requests", 2, "Status").getNote(), "Decided in the coordinator's app by Bro Arthur");
    });
  });

  s.test("turning a request down on a called-off Sunday leaves the route off for the passengers", async (a) => {
    await atTime(THU, async () => {
      const L = sheet({ status: "North cancelled" });
      worker(L, {});
      call(L, "applyCoordAction", L.gas.ss, A("c3", "decide", { requestId: "rq-ade", choice: "Rejected", sunday: KEY }), {});
      a.eq(cell(L, "Rota", 2, "Status").getValue(), "North cancelled");
    });
  });

  s.test("and the same by hand on the Rota Requests tab", async (a) => {
    await atTime(THU, async () => {
      const L = sheet({ status: "South cancelled" });
      worker(L, {});
      const c = cell(L, "Rota Requests", 2, "Status");
      c.setValue("Rejected");
      call(L, "onEditRequests", { range: c }, L.gas.ss.getSheetByName("Rota Requests"));
      a.eq(cell(L, "Rota", 2, "Status").getValue(), "South cancelled");
    });
  });

  s.test("a defect is closed with what was done, and Closed on is filled", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      worker(L, {});
      const out = call(L, "applyCoordAction", L.gas.ss, A("c4", "defect",
        { key: "chk-1|YS70 PWE|Nearside rear tyre|" + LAST, status: "Fixed", action: "Tyre replaced" }), {});
      a.ok(out.ok, JSON.stringify(out));
      a.eq(cell(L, "Defects", 2, "Status").getValue(), "Fixed");
      a.eq(cell(L, "Defects", 2, "Action taken").getValue(), "Tyre replaced");
      a.ok(cell(L, "Defects", 2, "Closed on").getValue(), "Closed on was not filled");
      a.has(cell(L, "Defects", 2, "Status").getNote(), "Bro Arthur");
    });
  });

  s.test("a booking made in the app is confirmed once its row is on the tab, and not before", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      worker(L, {});
      const wait = call(L, "applyCoordAction", L.gas.ss, A("c5", "booking", { op: "add", bookingId: 41 }), {});
      a.not(wait.done, "confirmed before the booking was on the tab");
      const L2 = sheet({ bookings: [{ Sunday: SOON, "Stop ID": "S03", Seats: 2, Status: "Booked", "Live ID": 41 }] });
      worker(L2, {});
      const yes = call(L2, "applyCoordAction", L2.gas.ss, A("c5", "booking", { op: "add", bookingId: 41 }), {});
      a.ok(yes.done && yes.ok);
    });
  });

  s.test("a corrected time lands on the Trip Events tab with a note saying so", async (a) => {
    await atTime(SUN, async () => {
      const L = sheet({ trips: [{ Trip: "t1", Sunday: "2026-10-04", Route: "South", Event: "picked", "Stop ID": "S03",
                                  Status: "Logged", "Live ID": 7 }] });
      const sent = worker(L, { drain: () => ({ ok: true, claim: -6, bookings: [], checks: [], auths: [], decisions: [], requests: [],
        trips: [{ id: 7, trip: "t1", sunday: KEY, route: "South", driver: "Bro Trevor", event: "picked", stop_id: "S03",
                  stop: "Sedley St", scheduled: "10:37", happened: new Date("2026-10-04T10:39:00+01:00").getTime(),
                  off_min: 2, status: "Logged, Corrected", logged: Date.now(),
                  fix_note: "Corrected by Bro Arthur, Sun 4 Oct 11:40. Recorded as 10:51." }],
        coord: [A("c6", "fix", { eventId: 7, sunday: KEY })] }) });
      call(L, "drainFromWorker");
      a.has(cell(L, "Trip Events", 2, "Happened").getNote(), "Recorded as 10:51");
      a.eq(cell(L, "Trip Events", 2, "Status").getValue(), "Logged, Corrected");
      const done = sent.find((b) => b.action === "drained");
      a.ok(done && done.coord.some((c) => c.id === "c6" && c.ok), "the correction was not confirmed");
    });
  });

  s.test("the push carries the requests with their reasons and the defects with their keys", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      const sent = worker(L, {});
      call(L, "pushToWorker");
      const sync = sent.find((b) => b.action === "sync");
      a.ok(sync && sync.coordShelf, "no coordinator shelf in the push");
      a.eq(sync.coordShelf.requests[0].reason, "Away");
      a.eq(sync.coordShelf.defects[0].key, "chk-1|YS70 PWE|Nearside rear tyre|" + LAST);
      a.eq(sync.cache.rota.openDefects["YS70 PWE"][0].checkId, "chk-1",
           "the public list gives the live server nothing to match a closed defect by");
    });
  });

  s.test("the two reports the app asks the sheet for come back as parts", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      worker(L, { ping: { ok: true, server: "w2.18.0", driversOff: [], onRegister: 4, driversOn: 4, passengers: 3 } });
      const h = JSON.parse(call(L, "doPost", { postData: { contents: JSON.stringify({ token: "minibusapp", action: "report", name: "health" }) } }).getContent());
      a.ok(h.ok, JSON.stringify(h).slice(0, 300));
      a.ok(Array.isArray(h.report.sections) && h.report.sections.length, "no sections");
      a.has(JSON.stringify(h.report.sections), "Script is " + GV);
      const l = JSON.parse(call(L, "doPost", { postData: { contents: JSON.stringify({ token: "minibusapp", action: "report", name: "load" }) } }).getContent());
      a.ok(l.ok && l.report.title === "Who is carrying the load", JSON.stringify(l).slice(0, 300));
    });
  });

  /* ---- three more off the Minibus menu, from v1.89.0 / w2.26.0 ---------- */

  const rep = (L, name) => JSON.parse(call(L, "doPost", { postData: { contents:
    JSON.stringify({ token: "minibusapp", action: "report", name: name }) } }).getContent());

  s.test("Who is tapping comes back as parts, and the menu still shows it as words", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      worker(L, {});
      const r = rep(L, "tapping");
      a.ok(r.ok, JSON.stringify(r).slice(0, 300));
      a.eq(r.report.title, "Who is tapping");
      a.has(r.report.lead, "Nothing recorded yet");
      call(L, "whoIsTapping");
      a.has(JSON.stringify(L.gas.logs.filter((x) => x[0] === "alert")), "Nothing recorded yet");
    });
  });

  s.test("Is the live server working? sorts its lines into needs attention and fine", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      worker(L, { drain: { ok: true, script: "w2.26.0", bookings: [], trips: [], clockAgoSec: 20,
                           cacheAgeMin: { rota: 5, last: 5 }, sheetTokenSet: false, pinSalt: true } });
      const r = rep(L, "live").report;
      const bad = (r.sections.find((x) => x.head === "Needs attention") || {}).lines || [];
      const good = (r.sections.find((x) => x.head === "Fine") || {}).lines || [];
      a.has(bad.join("|"), "No SHEET_TOKEN yet");
      a.has(good.join("|"), "The live server's clock is ticking.");
      a.has(good.join("|"), "Its version: w2.26.0", "an indented line did not stay with the line above it");
      a.eq(r.tone, "bad");
      call(L, "liveCheck");
      a.has(JSON.stringify(L.gas.logs.filter((x) => x[0] === "alert")), "No SHEET_TOKEN yet");
    });
  });

  s.test("Send duty reminders now says what it did, as parts", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      worker(L, {});
      const r = rep(L, "remind");
      a.ok(r.ok, JSON.stringify(r).slice(0, 300));
      a.eq(r.report.title, "Duty reminders");
      a.ok(r.report.lead, "no lead");
      a.ok(typeof r.report.text === "string" && r.report.text.length, "the menu's words are missing");
    });
  });

  s.test("the live server hands the three to the sheet under their own names", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      env.SHEET_PUSH_MS = 200;
      for (const name of ["tapping", "live", "remind"]) {
        net.reset();
        net.reply(new Response(JSON.stringify({ ok: true, report: { title: "T-" + name, sections: [] } }), { status: 200 }));
        const out = await coord(env, { op: "report", name: name });
        a.eq(out.title, "T-" + name);
        const asked = net.calls.find((c) => String(c.url) === SHEET);
        a.eq(asked && JSON.parse(asked.opts.body).name, name);
      }
      net.reset();
      const not = await coord(env, { op: "report", name: "remind" }, "Bro Trevor", PIN);
      a.not(not.title === "T-remind", "a driver who is not a coordinator reached the reminders");
    });
  });

  return s;
}
