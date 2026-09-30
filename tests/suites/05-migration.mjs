/* MEETING A DATABASE THAT IS OLDER THAN THE CODE.

   Every other suite builds its database from schema.sql, so every other suite
   starts with a database that already has everything the current Worker
   wants. That is not what is out there. The live D1 was built months ago and
   has been ALTERed since, one column at a time, on first use — and the whole
   on-demand migration idea only works if the FIRST thing to touch a new
   column is also the thing that adds it.

   On 22 September 2026 it wasn't:

     D1_ERROR: table stops has no column named lat: SQLITE_ERROR

   Every call to ensureTripCols sat inside handleTrip, guarded on a run
   ENDING. The sync reached stops.lat first — every five minutes, before any
   driver had ended anything — and there was no path by which the column could
   exist yet. A whole suite of green tests could not see it, because none of
   them had a database old enough to break.

   So: makeOldDB. The current schema with those columns taken back off, which
   is the state the Worker is supposed to find and repair. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeOldDB, makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";

export default async function (root) {
  const s = new Suite("an older database, met for the first time");
  const { mod: W } = await loadWorker(root);
  installGlobals();

  const SCHEMA = join(root, "server", "schema.sql");
  const KEY = W.runSunday();

  /* What Code.gs actually posts on a sync: the tab, with the two new columns
     filled in on some rows and blank on others, which is how a real Bus Stops
     tab looks while it is being filled. */
  const STOPS = [
    { id: "N00", route: "North", time: "09:52", stop: "Church", postcode: "L6 4DY",
      where: "3-5 Chester Road", depart: true, lat: 53.424169, lng: -2.936799 },
    { id: "N01", route: "North", time: "10:03", stop: "Scarisbrick Dr", postcode: "L9 4RY",
      where: "1 Vale Rd", lat: 53.449234, lng: -2.936301 },
    { id: "N02", route: "North", time: "10:15", stop: "Grace Rd", postcode: "L9 1AF",
      where: "", lat: "", lng: "" },
    { id: "N99", route: "North", time: "11:00", stop: "Church", postcode: "L6 4DY",
      where: "", arrival: true, lat: 53.424169, lng: -2.936799 }
  ];

  const SYNC = {
    stops: STOPS,
    buses: [{ reg: "YS70 PWE", seats: 16, active: true }],
    rota: [{ sunday: KEY, north: "Bro Adrian", northCover: "", status: "Confirmed" }]
  };

  const cols = (db, table) =>
    db._rows("SELECT name FROM pragma_table_info('" + table + "')").map((r) => r.name);

  /* ---- the failure itself ------------------------------------------------ */

  s.test("the database really is the old one, or none of this proves anything", (a) => {
    const db = makeOldDB(SCHEMA);
    a.eq(cols(db, "stops").indexOf("lat"), -1);
    a.eq(cols(db, "stops").indexOf("lng"), -1);
    a.eq(cols(db, "trip_events").indexOf("ended_by"), -1);
    a.eq(cols(db, "push_subs").indexOf("last_eta"), -1);
    /* And the current one is not, so the pair of them mean something. */
    a.ok(cols(makeDB(SCHEMA), "stops").indexOf("lat") !== -1,
         "schema.sql itself should have lat, or makeOldDB is removing nothing");
  });

  s.test("the five minute sync survives meeting it", async (a) => {
    const db = makeOldDB(SCHEMA);
    const out = await W.handleSync(makeEnv(db), SYNC).then((r) => r.json());
    a.ok(out && out.ok === true,
         "this is the error off the deployment: " + JSON.stringify(out));
  });

  s.test("and adds the columns on its way past", async (a) => {
    const db = makeOldDB(SCHEMA);
    await W.handleSync(makeEnv(db), SYNC);
    a.ok(cols(db, "stops").indexOf("lat") !== -1, "lat was never added");
    a.ok(cols(db, "stops").indexOf("lng") !== -1, "lng was never added");
  });

  s.test("the kerbs are in it, and a blank one is still blank", async (a) => {
    const db = makeOldDB(SCHEMA);
    await W.handleSync(makeEnv(db), SYNC);
    const n01 = db._one("SELECT lat, lng FROM stops WHERE stop_id='N01'");
    a.near(n01.lat, 53.449234, 0.000001);
    a.near(n01.lng, -2.936301, 0.000001);
    const n02 = db._one("SELECT lat, lng FROM stops WHERE stop_id='N02'");
    a.eq(n02.lat, null, "zero is a real coordinate in the Gulf of Guinea");
    a.eq(n02.lng, null);
  });

  s.test("the timetable is there either way", async (a) => {
    const db = makeOldDB(SCHEMA);
    await W.handleSync(makeEnv(db), SYNC);
    a.eq(db._rows("SELECT stop_id FROM stops").length, 4);
    a.eq(db._one("SELECT time FROM stops WHERE stop_id='N01'").time, "10:03");
  });

  /* ---- the column that will not be added --------------------------------- */

  s.test("a database that refuses the column still gets its timetable", async (a) => {
    /* THE PART THAT MATTERS MORE THAN THE FIX.

       A stop's coordinates are a convenience: they sharpen an estimate. Its
       TIME is not — without it the driver has no list and the passenger has
       no bus. The sync is one batch and a failed batch writes nothing, so a
       single refused column would have cost the morning its whole timetable.

       Here the ALTER is refused however often it is asked, which is the shape
       of any D1 that will not take the column. The stops must still land. */
    const db = makeOldDB(SCHEMA);
    const raw = db.exec.bind(db);
    let refused = 0;
    db.exec = async (sql) => {
      if (/ALTER TABLE\s+stops/i.test(String(sql))) { refused++; throw new Error("nope"); }
      return raw(sql);
    };
    const realPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      if (/ALTER TABLE\s+stops/i.test(String(sql))) {
        refused++;
        return { bind: () => ({ run: async () => { throw new Error("nope"); },
                                all: async () => { throw new Error("nope"); } }),
                 run: async () => { throw new Error("nope"); },
                 all: async () => { throw new Error("nope"); } };
      }
      return realPrepare(sql);
    };

    const out = await W.handleSync(makeEnv(db), SYNC).then((r) => r.json());
    a.ok(refused > 0, "the test did not actually refuse anything");
    a.ok(out && out.ok === true, "the sync gave up over a coordinate: " + JSON.stringify(out));

    db.prepare = realPrepare;
    a.eq(db._rows("SELECT stop_id FROM stops").length, 4,
         "the timetable is the part nobody can do without");
  });

  /* ---- the other two columns, which were already guarded ----------------- */

  s.test("a run can still be ended on it", async (a) => {
    const db = makeOldDB(SCHEMA);
    const env = makeEnv(db);
    await W.handleSync(env, SYNC);
    const at = Date.now() - 900000;
    await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian",
      reg: "YS70 PWE", sunday: KEY, events: [{ event: "start", at: at }] });
    const out = await W.handleTrip(env, { trip: "t1", route: "North", driver: "Bro Adrian",
      reg: "YS70 PWE", sunday: KEY, events: [{ event: "end", at: Date.now() }] })
      .then((r) => r.json());
    a.ok(out && out.ok !== false, JSON.stringify(out));
    a.eq(db._rows("SELECT id FROM trip_events WHERE event='end'").length, 1,
         "the end row is the record; the column naming who closed it is not");
  });

  s.test("a phone can still be woken by it", async (a) => {
    const db = makeOldDB(SCHEMA);
    const env = makeEnv(db);
    await W.handleSync(env, SYNC);
    await db.prepare(
      "INSERT INTO push_subs (endpoint, p256dh, auth, role, ref, pid, driver, route, made, seen, fails, last) " +
      "VALUES ('https://push.example/a','p','a','passenger','dev-N02','pid-N02','','',?,0,0,'')"
    ).bind(Date.now()).run();
    let threw = "";
    try { await W.wakeBookingReminders(env); } catch (e) { threw = String(e && e.message || e); }
    a.eq(threw, "", "an older database must not cost anybody a message");
  });

  s.test("running it twice changes nothing the second time", async (a) => {
    /* The sweep asks on every sync. If asking were not free of consequence
       the fix would be a new fault arriving every five minutes. */
    const db = makeOldDB(SCHEMA);
    const env = makeEnv(db);
    await W.handleSync(env, SYNC);
    const out = await W.handleSync(env, SYNC).then((r) => r.json());
    a.ok(out && out.ok === true, JSON.stringify(out));
    a.eq(db._rows("SELECT stop_id FROM stops").length, 4, "and it did not double the tab");
  });

  return s;
}
