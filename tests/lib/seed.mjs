/* A Sunday to test against.

   THE STOPS, THE IDS AND THE COORDINATES ARE THE REAL ONES, as supplied on
   21 September 2026. That matters more than it looks: the estimate's whole
   difficulty is that this timetable has two kinds of leg on it — two
   kilometre runs between districts, and clusters where three stops sit inside
   half a kilometre — and a fixture with evenly spaced invented stops makes
   the skip arithmetic look correct when it is not.

   Two distances here were checked against figures measured independently of
   this code: S03 to S04 comes out at 195 metres and N05 through N07 at 556,
   both exactly as reported. Anything that changes metresBetween and leaves
   those two alone has not changed it much.

   THE TIMES ARE THE REAL ONES TOO, as the Bus Stops tab stood on 20
   September 2026. They were invented until then, and plausibly, but a
   timetable somebody made up is a timetable with no padding in it — and the
   padding is most of what the estimate is arguing about. The real one has
   twelve minutes between two stops 2.2 km apart and three minutes between two
   that are 230 metres apart, which is the shape the whole model turns on. */

export const NORTH = [
  { id: "N00", route: "North", time: "09:52", stop: "Church",         kind: "depart",  seq: 0, lat: 53.424169, lng: -2.936799 },
  { id: "N01", route: "North", time: "10:03", stop: "Scarisbrick Dr", kind: "pickup",  seq: 1, lat: 53.449234, lng: -2.936301 },
  { id: "N02", route: "North", time: "10:15", stop: "Grace Rd",       kind: "pickup",  seq: 2, lat: 53.463563, lng: -2.959062 },
  { id: "N03", route: "North", time: "10:24", stop: "Litherland Rd",  kind: "pickup",  seq: 3, lat: 53.450731, lng: -2.987178 },
  { id: "N04", route: "North", time: "10:32", stop: "Fountains Rd",   kind: "pickup",  seq: 4, lat: 53.432320, lng: -2.984024 },
  { id: "N05", route: "North", time: "10:39", stop: "Bedford Rd",     kind: "pickup",  seq: 5, lat: 53.446071, lng: -2.970485 },
  { id: "N06", route: "North", time: "10:42", stop: "Pym St",         kind: "pickup",  seq: 6, lat: 53.444062, lng: -2.969688 },
  { id: "N07", route: "North", time: "10:45", stop: "Wilburn St",     kind: "pickup",  seq: 7, lat: 53.441187, lng: -2.970688 },
  { id: "N08", route: "North", time: "10:52", stop: "Stanley Pk",     kind: "pickup",  seq: 8, lat: 53.432312, lng: -2.956937 },
  { id: "N09", route: "North", time: "11:00", stop: "Church",         kind: "arrival", seq: 9, lat: 53.424169, lng: -2.936799 }
];

export const SOUTH = [
  { id: "S00", route: "South", time: "10:21", stop: "Church",         kind: "depart",  seq: 0, lat: 53.424169, lng: -2.936799 },
  { id: "S01", route: "South", time: "10:29", stop: "Dewsbury Rd",    kind: "pickup",  seq: 1, lat: 53.434771, lng: -2.955519 },
  { id: "S02", route: "South", time: "10:33", stop: "Vicar Rd",       kind: "pickup",  seq: 2, lat: 53.429938, lng: -2.944937 },
  { id: "S03", route: "South", time: "10:37", stop: "Sedley St",      kind: "pickup",  seq: 3, lat: 53.425937, lng: -2.952438 },
  { id: "S04", route: "South", time: "10:40", stop: "Breck Rd",       kind: "pickup",  seq: 4, lat: 53.424312, lng: -2.953563 },
  { id: "S05", route: "South", time: "10:46", stop: "Parton St",      kind: "pickup",  seq: 5, lat: 53.414062, lng: -2.944937 },
  { id: "S06", route: "South", time: "10:50", stop: "Hannan Rd",      kind: "pickup",  seq: 6, lat: 53.414313, lng: -2.949187 },
  { id: "S07", route: "South", time: "10:53", stop: "Halsbury Rd",    kind: "pickup",  seq: 7, lat: 53.414732, lng: -2.946951 },
  { id: "S08", route: "South", time: "11:00", stop: "Church",         kind: "arrival", seq: 8, lat: 53.424169, lng: -2.936799 }
];

export const STOPS = [...NORTH, ...SOUTH];

/* The two clusters and one long leg, named, because three suites reason about
   them and a magic id in an assertion tells nobody why it was chosen. */
export const CLUSTER_SOUTH = ["S03", "S04"];          /* 195 m apart */
export const CLUSTER_NORTH = ["N05", "N06", "N07"];   /* 556 m across all three */
export const LONG_LEG = ["N02", "N03"];               /* 2345 m, 9 minutes */

export async function seedSunday(db, key, over) {
  const o = over || {};
  for (const s of STOPS) {
    await db.prepare(
      "INSERT OR REPLACE INTO stops (stop_id, route, time, stop, postcode, place, kind, seq, lat, lng) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).bind(s.id, s.route, s.time, s.stop, "", "", s.kind, s.seq,
           o.noPins ? null : s.lat, o.noPins ? null : s.lng).run();
  }
  for (const b of [["YS70 PWE", 16], ["NH56 FWP", 14]]) {
    await db.prepare("INSERT OR REPLACE INTO buses (reg, seats, active) VALUES (?,?,1)").bind(b[0], b[1]).run();
  }
  await db.prepare(
    "INSERT OR REPLACE INTO rota (sunday, north, north_cover, north_bus, south, south_cover, south_bus, status, notes) " +
    "VALUES (?,?,?,?,?,?,?,?,?)"
  ).bind(key, o.north || "Bro Adrian", o.northCover || "", o.northBus || "YS70 PWE",
         o.south || "Bro Trevor", o.southCover || "", o.southBus || "NH56 FWP",
         o.status || "Confirmed", "").run();
}

/* Bookings, so "booked stops only" has something to be about. */
export async function seedBookings(db, key, list) {
  for (const b of list) {
    await db.prepare(
      "INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).bind(key, b.route, b.stopId, b.stop || b.stopId, b.seats == null ? 2 : b.seats,
           b.device || ("dev-" + b.stopId), b.pid || ("pid-" + b.stopId), b.phone || "",
           b.status || "Booked", Date.now()).run();
  }
}
