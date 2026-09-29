/* READING A REAL EXPORT OF THE TRIP EVENTS TAB.

   Kept apart from calibrate.mjs so it can be tested, and it needed to be: the
   first version of this went straight into the CLI, was never run against a
   real export, and got FOUR things wrong — every one of them silent.

     1. UK dates.        "16/08/2026" is not a date to Date.parse, and
                         "06/09/2026" is the ninth of June. So half the rows
                         vanished and the other half moved three months.
     2. Event names.     The tab says pickup and empty. The Worker's own
                         vocabulary is picked and none, and both are in the
                         same column depending on how old the row is.
     3. Stop IDs move.   Parton Street has been S01 and S05. Hannan Road has
                         been S04, S03 and S06. Joining history on the id
                         gives you the distance between two stops that were
                         never next to each other, and it looks fine.
     4. Impossible legs. Church to Parton Street in 53 seconds is 1.7 km at
                         115 km/h. It is a man tapping from where he actually
                         was, and it must not become evidence about a bus.

   All four produce a NUMBER rather than an error, which is the worst way for
   a measuring instrument to be wrong. */

/* ---- dates ---------------------------------------------------------------

   dd/mm/yyyy hh:mm(:ss), which is what a UK sheet exports, plus ISO for
   anything already sane. Nothing else is guessed at: a date this cannot read
   is counted and dropped, never approximated, because the whole point of the
   exercise is measuring how long things took. */
export function ukDate(s) {
  const t = String(s == null ? "" : s).trim();
  if (!t) return NaN;

  const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (uk) {
    return new Date(Number(uk[3]), Number(uk[2]) - 1, Number(uk[1]),
                    Number(uk[4] || 0), Number(uk[5] || 0), Number(uk[6] || 0)).getTime();
  }
  if (/^\d{4}-\d{2}-\d{2}([ T]|$)/.test(t)) {
    const ms = Date.parse(t.replace(" ", "T"));
    return isFinite(ms) ? ms : NaN;
  }
  return NaN;
}

/* ---- stops ---------------------------------------------------------------

   MATCHED ON THE NAME, NEVER ON THE ID, and that is not a preference.

   The Stop ID column has been renumbered at least twice on this route. Parton
   Street was S01 in August and S05 in September; Hannan Road has been S04,
   S03 and S06. An id join across those dates silently pairs up stops that
   were never adjacent and hands back a confident distance for a leg that
   never existed.

   The names are long and were typed by hand — "Pym Street bus stop, County
   Road", "Hannan Road, at the Molyneux Road junction" — so what is compared
   is the ROAD, which is the part that does not move: everything up to the
   first comma, "by", "at", "off" or "bus stop", with the usual
   Street/Road/Drive abbreviations flattened. */
const CUT = /(,| bus stop| by | at | off | near | outside | opposite ).*$/i;
const WORDS = [
  [/\bstreet\b/g, "st"], [/\broad\b/g, "rd"], [/\bdrive\b/g, "dr"],
  [/\bavenue\b/g, "ave"], [/\bpark\b/g, "pk"], [/\blane\b/g, "ln"],
  [/\bclose\b/g, "cl"], [/\bsquare\b/g, "sq"], [/\bthe\b/g, ""]
];

export function stopKey(name) {
  let t = String(name == null ? "" : name).trim().toLowerCase().replace(CUT, "");
  for (const [re, to] of WORDS) t = t.replace(re, to);
  return t.replace(/[^a-z0-9]/g, "");
}

/* One stop, or null. Route is used only to tell the two Churches apart. */
export function matchStop(stops, name, route) {
  const want = stopKey(name);
  if (!want) return null;

  const pool = stops.filter((s) => !route || !s.route ||
                                   String(s.route).toLowerCase() === String(route).toLowerCase());
  const list = pool.length ? pool : stops;

  let hit = list.find((s) => stopKey(s.stop) === want);
  if (hit) return hit;
  /* "Stanley Park Car Park bus stop" against "Stanley Pk": one is the other
     with more of the address on it. Longest sensible prefix wins so that a
     short key cannot swallow an unrelated longer one. */
  hit = list.filter((s) => {
    const k = stopKey(s.stop);
    return k && (want.startsWith(k) || k.startsWith(want));
  }).sort((a, b) => stopKey(b.stop).length - stopKey(a.stop).length)[0];
  return hit || null;
}

/* ---- the legs -------------------------------------------------------------

   Everything thrown away is counted. A fit built on a tenth of the rows is
   not a better fit than no fit, and the only way to know that has happened is
   to be told how much went and why. */
export const DROP_WORDS = {
  rehearsal: "rehearsal rows",
  undone: "taps taken back",
  unknownStop: "stops this project has no coordinates for",
  noTime: "rows with an unreadable date",
  batched: "taps sent together after a signal drop",
  tooLong: "gaps over half an hour",
  impossible: "legs faster than a minibus can go",
  /* Singular forms, because "1 legs" in a report is a small thing that makes
     a reader trust the big things less. */
  one: {
    rehearsal: "rehearsal row", undone: "tap taken back",
    unknownStop: "stop this project has no coordinates for",
    noTime: "row with an unreadable date",
    batched: "tap sent after a signal drop",
    tooLong: "gap over half an hour",
    impossible: "leg faster than a minibus can go"
  }
};

const PICKED = { pickup: 1, picked: 1, empty: 1, none: 1 };

/* AVERAGE speed between two kerbs, not top speed, and these are Liverpool
   streets with a minibus on them. Every real leg in the record so far sits
   between four and nine miles an hour, so forty is enormous headroom and
   still catches what it is for: church to Parton Street in 53 seconds on 20
   September, which is 1.2 km at fifty. That is not a bus. It is a driver who
   was running very late tapping from wherever he actually was, and left in it
   becomes evidence that the route is quick. */
const MAX_MPH = 40;

export function readLegs(table, head, stops, metresBetween) {
  const at = (r, name) => {
    const i = head.indexOf(name);
    return i === -1 ? "" : String(r[i] || "").trim();
  };

  const dropped = { rehearsal: 0, undone: 0, unknownStop: 0, noTime: 0,
                    batched: 0, tooLong: 0, impossible: 0 };
  const renamed = {};          /* stop name -> the set of ids it has worn */
  const runs = {};
  const days = new Set();

  for (const r of table) {
    const ev = at(r, "event").toLowerCase();
    const isStop = !!PICKED[ev];
    if (!isStop && ev !== "start") continue;

    const status = at(r, "status").toLowerCase();
    if (status.indexOf("undone") !== -1) { dropped.undone++; continue; }
    /* A REHEARSAL IS NOT A MORNING. Its stops are drawn at random and its
       taps are made sitting still, so every leg in one is either instant or
       however long somebody took to look at their phone. */
    if (status.indexOf("rehearsal") !== -1) { dropped.rehearsal++; continue; }

    const trip = at(r, "trip");
    if (!trip) continue;

    const when = ukDate(at(r, "happened"));
    if (!isFinite(when)) { dropped.noTime++; continue; }

    const route = at(r, "route");
    const name = at(r, "stop");
    const id = at(r, "stop id");

    /* A start with no stop named is the departure, which is church. Older
       rows are all like this and they carry the first leg of the morning. */
    let stop = name ? matchStop(stops, name, route) : null;
    if (!stop && ev === "start") stop = matchStop(stops, "Church", route);
    if (!stop) { dropped.unknownStop++; continue; }

    if (name && id) {
      (renamed[stop.stop] = renamed[stop.stop] || new Set()).add(id);
    }
    days.add(at(r, "sunday") || at(r, "happened").slice(0, 10));
    (runs[trip] = runs[trip] || []).push({ stop, when, served: ev === "pickup" || ev === "picked" });
  }

  const legs = [];
  for (const trip of Object.keys(runs)) {
    const seq = runs[trip].sort((a, b) => a.when - b.when);
    for (let i = 1; i < seq.length; i++) {
      const A = seq[i - 1].stop, B = seq[i].stop;
      if (A.id === B.id) continue;
      const minutes = (seq[i].when - seq[i - 1].when) / 60000;
      const metres = metresBetween(A, B);

      /* Under twenty seconds is not a journey between two kerbs. It is a
         phone that lost signal and sent four taps at once when it found it
         again, and the times are when he caught up rather than when he pulled
         away. */
      if (minutes < 20 / 60) { dropped.batched++; continue; }
      if (minutes > 30) { dropped.tooLong++; continue; }

      const mph = (metres / 1609.34) / (minutes / 60);
      if (mph > MAX_MPH) { dropped.impossible++; continue; }

      legs.push({ from: A, to: B, minutes, metres, served: seq[i].served });
    }
  }

  return { legs, dropped, renamed, days };
}

/* Least squares on  minutes = metres/speed + dwell , over legs where the bus
   ACTUALLY STOPPED. A leg it drove past has no dwell in it and would drag the
   dwell towards nothing, which is the wrong direction: see README.md on which
   way this model is allowed to be wrong. */
export function fit(served) {
  const n = served.length;
  if (!n) return { n: 0 };

  const sx = served.reduce((t, l) => t + l.metres, 0);
  const sy = served.reduce((t, l) => t + l.minutes, 0);
  const sxx = served.reduce((t, l) => t + l.metres * l.metres, 0);
  const sxy = served.reduce((t, l) => t + l.metres * l.minutes, 0);
  const denom = n * sxx - sx * sx;

  const slope = denom ? (n * sxy - sx * sy) / denom : 0;
  const dwellMin = denom ? (sy - slope * sx) / n : sy / n;
  const mph = slope > 0 ? (1 / slope) * 60 / 1609.34 : NaN;

  const mean = sy / n;
  const ssTot = served.reduce((t, l) => t + Math.pow(l.minutes - mean, 2), 0);
  const ssRes = served.reduce((t, l) => t + Math.pow(l.minutes - (slope * l.metres + dwellMin), 2), 0);

  return {
    n, dwellSeconds: dwellMin * 60, mph,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    spread: Math.sqrt(ssRes / n)
  };
}

/* A CSV reader that copes with quoted cells, which a stop called
   "Hannan Road, at the Molyneux Road junction" absolutely needs. */
export function rows(text) {
  const out = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === "\t") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out.filter((r) => r.some((x) => String(x).trim()));
}
