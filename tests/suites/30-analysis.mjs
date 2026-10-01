/* READING A REAL EXPORT OF THE TRIP EVENTS TAB.

   This suite exists because the first version of the calibration script was
   written, read well, and was wrong in FOUR ways — every one of them silent,
   and every one only discovered the first time a real export went through it.

     1. "16/08/2026" is not a date to Date.parse, and "06/09/2026" is the
        ninth of June. Half the rows vanished; the other half moved three
        months and said nothing.
     2. The tab says pickup and empty. The Worker's vocabulary is picked and
        none. Both are in the same column depending on how old the row is, so
        matching one of them threw the morning away and reported "no usable
        legs" as though that were a fact about the bus.
     3. Stop IDs get renumbered. Parton Street has been S01 and S05; Hannan
        Road has been S04, S03 and S06. Joining history on the id measures the
        distance between two stops that were never adjacent, confidently.
     4. Church to Parton Street in 53 seconds is 1.7 km at 115 km/h. It is a
        man tapping from where he actually was, and left in it is evidence
        about a bus.

   A measuring instrument that fails LOUDLY is a nuisance. One that hands back
   a plausible number is worse than having none, because somebody will tune a
   live setting from it. */

import { Suite } from "../lib/t.mjs";
import { STOPS } from "../lib/seed.mjs";
import { ukDate, stopKey, matchStop, readLegs, fit, rows } from "../../analysis/lib.mjs";

const metres = (a, b) => {
  const R = 6371000, rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos((a.lat + b.lat) * rad / 2);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * R;
};

const HEAD = ["logged", "trip", "sunday", "route", "driver", "event",
              "stop id", "stop", "scheduled", "happened", "offset", "status"];
const row = (o) => HEAD.map((h) => (o[h] === undefined ? "" : String(o[h])));

export default function () {
  const s = new Suite("reading a real export");

  /* ---- dates ------------------------------------------------------------ */

  s.test("a UK date is read as a UK date", (a) => {
    const t = ukDate("16/08/2026 10:12:41");
    const d = new Date(t);
    a.eq(d.getDate(), 16);
    a.eq(d.getMonth(), 7, "August");
    a.eq(d.getFullYear(), 2026);
    a.eq(d.getHours(), 10);
  });

  s.test("the sixth of September is not the ninth of June", (a) => {
    /* The one that matters. Date.parse takes this as a US date and moves it
       three months without complaining. */
    const d = new Date(ukDate("06/09/2026 09:54:20"));
    a.eq(d.getMonth(), 8, "September, not June");
    a.eq(d.getDate(), 6);
  });

  s.test("an ISO date still works", (a) => {
    a.ok(isFinite(ukDate("2026-09-20T10:00:11Z")));
    a.ok(isFinite(ukDate("2026-09-20 10:00:11")));
  });

  s.test("a date this cannot read is refused, never approximated", (a) => {
    for (const bad of ["", "not a date", "20 September", "2026", "//"]) {
      a.not(isFinite(ukDate(bad)), "accepted " + JSON.stringify(bad));
    }
  });

  /* ---- stops ------------------------------------------------------------ */

  s.test("the road is what is compared, not the whole typed name", (a) => {
    a.eq(stopKey("Scarisbrick Drive by Ardville Road"), stopKey("Scarisbrick Dr"));
    a.eq(stopKey("Pym Street bus stop, County Road"), stopKey("Pym St"));
    a.eq(stopKey("Hannan Road, at the Molyneux Road junction"), stopKey("Hannan Rd"));
    a.eq(stopKey("Parton Street, off Sheil Road"), stopKey("Parton St"));
    a.eq(stopKey("Grace Road bus stop, Walton Vale"), stopKey("Grace Rd"));
  });

  s.test("every stop name in the real export finds its kerb", (a) => {
    const seen = [
      ["Scarisbrick Drive by Ardville Road", "North", "N01"],
      ["Grace Road bus stop, Walton Vale", "North", "N02"],
      ["Fountains Road by Stanley Close", "North", "N04"],
      ["Bedford Road by Stuart Hotel", "North", "N05"],
      ["Pym Street bus stop, County Road", "North", "N06"],
      ["Wilburn Street bus stop, County Road", "North", "N07"],
      ["Stanley Park Car Park bus stop, Priory Road", "North", "N08"],
      ["Parton Street, off Sheil Road", "South", "S05"],
      ["Parton Street off Sheil Road", "South", "S05"],
      ["Hannan Road by Molyneux Road (The Molly Cafe)", "South", "S06"],
      ["Halsbury Road, at the Molyneux Road junction", "South", "S07"]
    ];
    for (const [name, route, want] of seen) {
      const hit = matchStop(STOPS, name, route);
      a.ok(hit, "no match for " + JSON.stringify(name));
      a.eq(hit.id, want, JSON.stringify(name) + " matched " + (hit && hit.id));
    }
  });

  s.test("a stop is matched on its NAME even when its id has moved", (a) => {
    /* Parton Street has been S01 and S05. Both rows must reach the same
       kerb, which is the whole reason nothing here joins on the id. */
    const asS01 = matchStop(STOPS, "Parton Street, off Sheil Road", "South");
    const asS05 = matchStop(STOPS, "Parton Street off Sheil Road", "South");
    a.eq(asS01.id, asS05.id);
  });

  s.test("the two Churches are told apart by route", (a) => {
    a.eq(matchStop(STOPS, "Church, Chester Road", "North").route, "North");
    a.eq(matchStop(STOPS, "Church", "South").route, "South");
  });

  s.test("a stop nobody has coordinates for is not guessed at", (a) => {
    a.eq(matchStop(STOPS, "Somewhere Nobody Has Been", "North"), null);
  });

  /* ---- what gets thrown away -------------------------------------------- */

  function read(list) {
    return readLegs(list.map(row), HEAD, STOPS, metres);
  }

  s.test("both vocabularies for a stop tap are read", (a) => {
    /* The driver app writes pickup and empty, and always has. The
       coordinator's Add wrote picked before w2.30.1, and the tab keeps those
       rows. Both, in the same column. */
    for (const ev of ["pickup", "picked", "empty", "none"]) {
      const { legs } = read([
        { trip: "t", route: "North", event: "start", stop: "Church",
          happened: "20/09/2026 10:00:00", status: "Logged" },
        { trip: "t", route: "North", event: ev, "stop id": "N01",
          stop: "Scarisbrick Drive by Ardville Road",
          happened: "20/09/2026 10:11:00", status: "Logged" }
      ]);
      a.eq(legs.length, 1, ev + " was not read as a stop tap");
    }
  });

  s.test("a rehearsal is not a morning", (a) => {
    const { legs, dropped } = read([
      { trip: "r", route: "North", event: "start", stop: "Church",
        happened: "08/09/2026 21:18:07", status: "Rehearsal" },
      { trip: "r", route: "North", event: "pickup", stop: "Scarisbrick Drive by Ardville Road",
        happened: "08/09/2026 21:19:37", status: "Rehearsal" }
    ]);
    a.eq(legs.length, 0);
    a.eq(dropped.rehearsal, 2, "its taps are made sitting still and drag the dwell to nothing");
  });

  s.test("a tap the driver took back is not evidence", (a) => {
    const { dropped } = read([
      { trip: "t", route: "North", event: "pickup", stop: "Scarisbrick Drive by Ardville Road",
        happened: "30/08/2026 09:45:06", status: "Undone" }
    ]);
    a.eq(dropped.undone, 1);
  });

  s.test("four taps sent in one breath are not four journeys", (a) => {
    const { legs, dropped } = read([
      { trip: "t", route: "South", event: "pickup", stop: "Hannan Road by Molyneux Road",
        happened: "06/09/2026 10:46:26", status: "Logged" },
      { trip: "t", route: "South", event: "pickup", stop: "Halsbury Road by Molyneux Road",
        happened: "06/09/2026 10:46:38", status: "Logged" }
    ]);
    a.eq(legs.length, 0);
    a.eq(dropped.batched, 1, "twelve seconds is a phone catching up, not a bus moving");
  });

  s.test("a minibus does not do a hundred and fifteen kilometres an hour", (a) => {
    /* Church to Parton Street in 53 seconds, on 20 September. The driver was
       very late and tapped from wherever he actually was. */
    const { legs, dropped } = read([
      { trip: "t", route: "South", event: "start", stop: "Church, Chester Road",
        happened: "20/09/2026 11:14:56", status: "Logged" },
      { trip: "t", route: "South", event: "pickup", stop: "Parton Street off Sheil Road",
        happened: "20/09/2026 11:15:49", status: "Logged" }
    ]);
    a.eq(legs.length, 0);
    a.eq(dropped.impossible, 1);
  });

  s.test("a gap over half an hour is a break, not a leg", (a) => {
    const { dropped } = read([
      { trip: "t", route: "North", event: "pickup", stop: "Scarisbrick Drive by Ardville Road",
        happened: "20/09/2026 10:11:00", status: "Logged" },
      { trip: "t", route: "North", event: "pickup", stop: "Grace Road bus stop, Walton Vale",
        happened: "20/09/2026 11:11:00", status: "Logged" }
    ]);
    a.eq(dropped.tooLong, 1);
  });

  s.test("a start with no stop named is the departure from church", (a) => {
    /* Every row before September is like this, and each one carries the
       first leg of its morning. */
    const { legs } = read([
      { trip: "t", route: "South", event: "start", happened: "16/08/2026 10:12:41", status: "Logged" },
      { trip: "t", route: "South", event: "pickup", "stop id": "S01",
        stop: "Parton Street, off Sheil Road",
        happened: "16/08/2026 10:37:22", status: "Logged" }
    ]);
    a.eq(legs.length, 1, "without this the oldest half of the record has no legs at all");
    a.eq(legs[0].from.stop, "Church");
  });

  s.test("two runs on one day do not get joined to each other", (a) => {
    const { legs } = read([
      { trip: "a", route: "North", event: "pickup", stop: "Scarisbrick Drive by Ardville Road",
        happened: "23/08/2026 10:18:31", status: "Logged" },
      { trip: "b", route: "South", event: "pickup", stop: "Parton Street, off Sheil Road",
        happened: "23/08/2026 10:45:03", status: "Logged" }
    ]);
    a.eq(legs.length, 0, "they are different mornings on different roads");
  });

  s.test("a renumbered stop is noticed and named", (a) => {
    const { renamed } = read([
      { trip: "a", route: "South", event: "pickup", "stop id": "S01",
        stop: "Parton Street, off Sheil Road",
        happened: "16/08/2026 10:37:22", status: "Logged" },
      { trip: "b", route: "South", event: "pickup", "stop id": "S05",
        stop: "Parton Street off Sheil Road",
        happened: "13/09/2026 10:47:54", status: "Logged" }
    ]);
    a.eq([...renamed["Parton St"]].sort().join(","), "S01,S05");
  });

  /* ---- the fit ----------------------------------------------------------- */

  s.test("the fit recovers numbers it was given", (a) => {
    /* Made-up legs on a known line: 90 seconds standing plus 20 mph of
       driving. If this cannot get its own numbers back it cannot get the
       bus's. */
    const dwell = 1.5, mph = 20;
    const served = [200, 500, 900, 1400, 2000, 2600].map((m) => ({
      metres: m, served: true,
      minutes: dwell + (m / 1609.34) / mph * 60
    }));
    const f = fit(served);
    a.near(f.dwellSeconds, 90, 1);
    a.near(f.mph, 20, 0.2);
    a.near(f.r2, 1, 0.001, "a perfect line should say so");
  });

  s.test("a scattered fit says it is scattered", (a) => {
    const served = [200, 500, 900, 1400, 2000, 2600].map((m, i) => ({
      metres: m, served: true, minutes: [14, 2, 19, 3, 21, 4][i]
    }));
    a.ok(fit(served).r2 < 0.4, "so nobody tunes a live setting off it");
  });

  s.test("no legs at all is not a fit of zero", (a) => {
    a.eq(fit([]).n, 0);
  });

  /* ---- the reader -------------------------------------------------------- */

  s.test("quoted commas inside a stop name survive", (a) => {
    const t = rows('a,b\n1,"Hannan Road, at the Molyneux Road junction"\n');
    a.eq(t[1][1], "Hannan Road, at the Molyneux Road junction");
  });

  s.test("a tab separated export is read too", (a) => {
    const t = rows("a\tb\n1\tChurch\n");
    a.eq(t[1][1], "Church");
  });

  return s;
}
