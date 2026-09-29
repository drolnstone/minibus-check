#!/usr/bin/env node
/* FITTING dwellSeconds AND speedMph TO WHAT THE BUS ACTUALLY DID.

       node analysis/calibrate.mjs ~/Downloads/trip-events.csv

   Feed it an export of the Trip Events tab, comma or tab separated. It wants
   the columns that tab already has — Trip, Route, Event, Stop ID, Stop,
   Happened, Status — and takes the distances between stops from the
   project's own coordinates.

   HISTORIC DATA IS WORTH FEEDING IT, even from before any of this was built.
   What is being fitted is how long a minibus stands at a kerb and how fast it
   gets between two of them. Those are facts about a bus on Liverpool roads,
   not about which version of the app was recording them. What the old data
   CANNOT tell you is anything about the estimate itself, or about
   resendMinutes — only a Sunday running v1.71.0 or later does that.

   The reading is in lib.mjs, which is tested. This file is the printing.

   NOTHING IN THE RELEASE READS EITHER. It is a thing to run when there is
   data, not a thing the app depends on. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorker, installGlobals } from "../tests/lib/worker.mjs";
import { STOPS } from "../tests/lib/seed.mjs";
import { rows, readLegs, fit, DROP_WORDS } from "./lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2];

if (!file) {
  console.error("\n  node analysis/calibrate.mjs <trip-events.csv>\n");
  process.exit(1);
}

installGlobals();
const { mod: W } = await loadWorker(ROOT);

const table = rows(readFileSync(file, "utf8"));
const head = table[0].map((h) => String(h).trim().toLowerCase());

for (const need of ["trip", "event", "stop", "happened"]) {
  if (head.indexOf(need) === -1) {
    console.log("\n  That file has no \"" + need + "\" column. Export the Trip Events tab whole.\n");
    process.exit(1);
  }
}

const { legs, dropped, renamed, days } =
  readLegs(table.slice(1), head, STOPS, W.metresBetween);

const p = (s) => console.log(s);
p("");

/* ---- what the file turned out to be ------------------------------------- */

const set = Object.keys(dropped).filter((k) => dropped[k] > 0)
  .map((k) => dropped[k] + " " + (dropped[k] === 1 ? DROP_WORDS.one[k] : DROP_WORDS[k]));

p("  " + legs.length + " usable legs across " + days.size + " days.");
if (set.length) p("  Set aside: " + set.join(", ") + ".");

/* ---- the thing worth knowing whatever the numbers say -------------------- */

/* Two ids that differ only in their route letter are not a renumbering: both
   routes start and end at church and each has its own row, which is how the
   tab is meant to look. Only a stop whose NUMBER has moved within one route
   is worth reporting. */
const moved = Object.keys(renamed).filter((name) => {
  const byRoute = {};
  for (const id of renamed[name]) {
    const m = /^([A-Za-z]*)(\d+)$/.exec(id);
    const k = m ? m[1].toUpperCase() : "";
    (byRoute[k] = byRoute[k] || new Set()).add(m ? m[2] : id);
  }
  return Object.keys(byRoute).some((k) => byRoute[k].size > 1);
});
if (moved.length) {
  p("");
  p("  THE STOP IDS HAVE BEEN RENUMBERED. These stops have worn more than one:");
  for (const name of moved.sort()) {
    p("    " + name.padEnd(18) + [...renamed[name]].sort().join(", "));
  }
  p("");
  p("  Nothing here is joined on the id, for exactly this reason: an id join");
  p("  across those dates pairs up stops that were never next to each other and");
  p("  hands back a confident distance for a leg that never existed. Worth");
  p("  knowing on its own, though — anything else that reads history by Stop ID");
  p("  is reading it wrong.");
}

if (!legs.length) { p(""); process.exit(0); }

/* ---- the fit ------------------------------------------------------------- */

const f = fit(legs.filter((l) => l.served));
p("");
p("  " + f.n + " of those legs ended with the bus actually stopping.");
p("");

if (f.n < 30) {
  p("  THAT IS NOT ENOUGH TO TUNE ANYTHING, and the numbers below are printed");
  p("  so you can see them move, not so you can act on them. Thirty is about");
  p("  the least worth reading and a few hundred is where they stop shifting");
  p("  between exports.");
  p("");
}

p("  Fitted from what happened:");
p("    dwellSeconds   " + (f.n ? Math.round(f.dwellSeconds) : "—"));
p("    speedMph       " + (isFinite(f.mph) && f.mph > 0 && f.mph < 60
      ? f.mph.toFixed(1) : "not enough spread in the distances to say"));
p("");
p("  How well the line fits:");
p("    r2             " + f.r2.toFixed(2) +
  (f.r2 < 0.3 ? "   (poor — a hint, not an answer)"
   : f.r2 < 0.6 ? "   (fair)" : "   (good)"));
p("    typical miss   " + f.spread.toFixed(1) + " minutes a leg");
p("");
p("  Currently shipped: dwellSeconds 75, speedMph 18.");
p("");
p("  A fitted dwell LARGER than the shipped one means the estimate is running");
p("  late, which is the direction that leaves somebody at a kerb watching the");
p("  bus go. Raise it. Smaller is the safe side and is not urgent.");
p("");
p("  Change it in BOTH config.js (eta) and Code.gs (ETA_RULES), then Send");
p("  everything to the live server now. The test suite checks the two agree,");
p("  so a half-done change fails rather than shipping.");
p("");
