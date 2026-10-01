/* PROOF BY SABOTAGE.

   Each fix in v1.74.9 and v1.74.10, and the rehearsal rounds of v1.79.0 and v1.79.1, is taken back out, one at a time, in a throwaway copy,
   and the tests for it are run against that copy. A fix whose removal no test
   notices is a fix nothing is guarding, and this says so. Every sabotage must
   match its text exactly once, or it stops: a sabotage that silently changes
   nothing would "prove" the test by testing the fix itself. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/*   node tests/browser/sabotage.mjs            all of them
     node tests/browser/sabotage.mjs S2c,S9     some
   MINIBUS_ROOT names the release to sabotage (this one by default). */
const SRC = process.env.MINIBUS_ROOT || fileURLToPath(new URL("../..", import.meta.url));
const TMP = join(tmpdir(), "minibus-sabotage");
const TESTS = fileURLToPath(new URL("./driver-app.mjs", import.meta.url));

const S = [
  { id: "S1 watch order", tests: "T1", swaps: [
    ["  tripFlush();\n  rotaCountsStart();\n", "  tripFlush();\n  if(trip.started && !trip.ended){ tripWatchStart(); wakeAsk(); }\n  rotaCountsStart();\n"],
    ["same rule at the other door. */\n  if(trip.started && !trip.ended){ tripWatchStart(); wakeAsk(); }\n}", "same rule at the other door. */\n}"] ] },
  { id: "S2 reopen button", tests: "T2", swaps: [
    ["    if(tripMayReopen(route)){", "    if(mayTap && onThis && tripAutoUndoOpen()){"] ] },
  { id: "S2b reopen sticks", tests: "T2", swaps: [
    ["  if(boardEnd && trip.reopened && boardEnd <= trip.reopened) boardEnd = 0;\n", ""] ] },
  { id: "S2c reopen kept through a reload", tests: "T2b", swaps: [
    ["    tripAutoEndedAt = trip.ended ? (Number(s.autoEnded)||0) : 0;\n", ""] ] },
  { id: "S2d reopen for a covering driver", tests: "T2c", swaps: [
    ["  return tripMayTap(route) || tripIsMine(route);\n", "  return tripMayTap(route);\n"] ] },
  { id: "S3 cover offer", tests: "T3", swaps: [
    ["      else h+=tripCoverHtml(route);\n", ""] ] },
  { id: "S3b cover not for rostered", tests: "T3b", swaps: [
    ["  if(rotaMyRoute()) return false;\n", ""] ] },
  { id: "S4 buttons above the bar", tests: "T4", swaps: [
    ["bottom:var(--footH,0px)", "bottom:0"] ] },
  { id: "S4b bar height measured", tests: "T4", swaps: [
    ["    document.documentElement.style.setProperty(\"--footH\", (h > 0 ? h : 0)+\"px\");\n", ""] ] },
  { id: "S5 eyebrow", tests: "T5", swaps: [
    ["Today&rsquo;s bus", "Today\\u2019s bus"] ] },
  { id: "S6 coordinator authorise", tests: "T6", swaps: [
    ["    if(!(mayTap && tripClosed) && pinCoordinator()) h+=tripCoordStopsHtml();\n", ""] ] },
  { id: "S6b authorise only for coordinators", tests: "T6b", swaps: [
    ["    if(!(mayTap && tripClosed) && pinCoordinator()) h+=tripCoordStopsHtml();", "    if(!(mayTap && tripClosed) && true) h+=tripCoordStopsHtml();"],
    ["      if(mayAuthorise(av.driver||\"\"))\n        h+='<button class=\"btn btn-ghost btn-wide trip-auth\"", "      if(true)\n        h+='<button class=\"btn btn-ghost btn-wide trip-auth\""] ] },
  { id: "S7a moving after repaint", tests: "T7", swaps: [
    ["  tripMovingPainted=null;\n  tripPaintMoving();\n  pinGateAutoFocus();", "  tripPaintMoving();\n  pinGateAutoFocus();"] ] },
  { id: "S7b undo while moving", tests: "T7", swaps: [
    ["  if(tripMoving()){ toast(\"Not while the bus is moving. Tap it when you pull up.\"); return; }\n  /* Taking a tap back", "  /* Taking a tap back"] ] },
  { id: "S8a due by the clock", tests: "T8", swaps: [
    ["if((changed || dueFlip) && Date.now()-tripTapAt > 3000) tripPaint();", "if((changed) && Date.now()-tripTapAt > 3000) tripPaint();"] ] },
  { id: "S8b End trip turns on a tap", tests: "T8", swaps: [
    ["  if(eb) eb.classList.toggle(\"is-due\", !!tripDueNow());\n", ""] ] },
  { id: "S8c late wins over marked", tests: "T8c", swaps: [
    ["  return (trip.started && !trip.ended) ? tripEndState(trip.route) : null;", "  return (trip.started && !trip.ended) ? !!tripEndState(trip.route) : null;"] ] },
  { id: "S9 PIN before a check", tests: "T9", swaps: [
    ["the one path round the gate. */\n  if(pinGateNeeded()){", "the one path round the gate. */\n  if(false){"] ] },
  /* v1.79.0: a rehearsal is a round. */
  /* The run let go once its round is over. The board's answer and the clock
     both come here, so from v1.79.1 taking out either path alone leaves the
     other to do it within five seconds: the sabotage is the rule itself. */
  { id: "S16 run dropped with its round", tests: "T16", swaps: [
    ["  if(trip.id && mine && mine!==round){\n    drop = true;", "  if(false){\n    drop = true;"] ] },
  { id: "S16b taps carry the round", tests: "T16b", swaps: [
    ["  if(ev.rehearsal === undefined) ev.rehearsal = Number(trip.rehearsal)||0;\n", ""] ] },
  { id: "S16c ended real run put aside", tests: "T16c", swaps: [
    ["  } else if(trip.id && !mine && round && trip.ended && !ownWaiting){\n    drop = true;\n  }\n", "  }\n"] ] },
  { id: "S17 queue taken off as it is now", tests: "T17", swaps: [
    ["    rest=tripLoadQ().filter(function(e){ return !sentKeys[tripQKey(e)]; });\n", ""] ] },
  { id: "S18 a round past its end is none", tests: "T18", swaps: [
    ["  trip.rehearsal = tripRoundNow();\n  tripSkipAsked={};", "  trip.rehearsal = Number(tripRehearsal)||0;\n  tripSkipAsked={};"] ] },
  { id: "S18b the clock checks the round", tests: "T18b", swaps: [
    ["    /* The round by the clock first, which needs no signal. */\n    tripRoundTick();\n", ""] ] },
  { id: "S18c the board's word from a finished round goes", tests: "T18b", swaps: [
    ["    if(r && r!==round){ delete tripSeen[k]; seenGone=true; }\n", ""] ] },
  { id: "S16d no test run taken back at the end", tests: "T16d", swaps: [
    ["    if(Number(tripRehearsal) && !tripRoundNow()) return;\n", ""] ] },
  /* v1.88.0, the passenger page: "Add to your phone" before the alerts
     question on a first visit. file and runner name where the sabotage goes
     and which checks run; the driver app and driver-app.mjs otherwise. */
  { id: "S19 install offer first", tests: "P7", file: "sunday/index.html", runner: "passenger.mjs", swaps: [
    ["  if(howComing()) return;\n", ""] ] },
  { id: "S19b no second Home Screen ask", tests: "P7b", file: "sunday/index.html", runner: "passenger.mjs", swaps: [
    ["  if(needsHome && howShown) return;\n", ""] ] },
  /* v1.89.0: the Buses screens in the coordinator's app, and the live
     server's half of them. */
  { id: "S20 defect trail shown", tests: "C32", file: "coord/index.html", runner: "coordinator.mjs", swaps: [
    ["           trailHTML(d.trail) +\n", ""] ] },
  { id: "S21 MOT keeps its date before Save", tests: "C29", file: "coord/index.html", runner: "coordinator.mjs", swaps: [
    ["    if(prior && done <= prior && done >= rnAddDays(rnAddMonths(prior, -1), 1)){", "    if(false){"] ] },
  { id: "S22 new date on every phone at once", tests: "C29", file: "server/worker.js", runner: "coordinator.mjs", swaps: [
    ["      if (a.kind === \"vlog\" && b.status === \"Done\") set(b.reg, VLOG_ITEM[b.what], b.next);\n", ""] ] },
  { id: "S23 a correction moves the date", tests: "C30", file: "server/worker.js", runner: "coordinator.mjs", swaps: [
    ["  body.targets = targets;\n", "  body.targets = [];\n"] ] },
  { id: "S24 a job done leaves the list", tests: "C31", file: "server/worker.js", runner: "coordinator.mjs", swaps: [
    ["        j.jobs = (j.jobs || []).filter((x) => x !== b.job);\n", ""] ] },
  /* v1.89.0, the driver app's top bar: the app's until a bus is chosen. */
  { id: "S25 no empty plate before a bus", tests: "T19", swaps: [
    ["  d.classList.toggle(\"no-veh\", !st.veh);\n", ""] ] },
  { id: "S25b the app named on the way in", tests: "T19", swaps: [
    ["          : appName();\n", "          : \"Vehicle check\";\n"] ] },
  { id: "S25c no bar over the first screen", tests: "T19", swaps: [
    ["  d.classList.toggle(\"is-away\", away);\n", ""] ] },
  /* v1.89.0, the bus tapped shows at once. */
  { id: "S26 the chosen bus ticked", tests: "T20", swaps: [
    ["'</span><span class=\"veh-tick\" aria-hidden=\"true\">\\u2713</span>';", "'</span>';"] ] },
  { id: "S26b the others step back", tests: "T20", swaps: [
    ["  box.classList.toggle(\"has-pick\", !!st.veh);\n", ""] ] },
  /* v1.89.0, the coordinator's sign-in opens on the logo. */
  { id: "S27 no bar over the sign-in", tests: "C33", file: "coord/index.html", runner: "coordinator.mjs", swaps: [
    ["  document.querySelector(\".bar\").classList.toggle(\"is-away\", name === \"sign\");\n", ""] ] },
  /* v1.89.1: the live server reads the driver app's own words for a tap. */
  { id: "S28 the server deaf to pickup and empty", tests: "C9", file: "server/worker.js", runner: "coordinator.mjs", swaps: [
    ["const TAP_PICKED = [\"pickup\", \"picked\"];", "const TAP_PICKED = [\"picked\"];"],
    ["const TAP_EMPTY = [\"empty\", \"none\"];", "const TAP_EMPTY = [\"none\"];"] ] },
  { id: "S28b Nobody there not said", tests: "C9", file: "coord/index.html", runner: "coordinator.mjs", swaps: [
    ["(ev && (ev.event === \"empty\" || ev.event === \"none\") ?", "(ev && ev.event === \"none\" ?"] ] }
];

const summary = [];
let port = Number(process.env.MINIBUS_PORT || 8140);
/* node mutate-v1749.mjs S6b,S9   runs only those */
const PICK = (process.argv[2] || "").split(",").filter(Boolean);
for (const m of S.filter(m => !PICK.length || PICK.some(p => m.id.split(" ")[0] === p))) {
  rmSync(TMP, { recursive: true, force: true });
  cpSync(SRC, TMP, { recursive: true });
  const file = m.file || "index.html";
  let html = readFileSync(TMP + "/" + file, "utf8");
  for (const [a, b] of m.swaps) {
    const n = html.split(a).length - 1;
    if (n !== 1) { console.log("  !! " + m.id + ": sabotage text found " + n + " times, not once — stopping"); process.exit(2); }
    html = html.replace(a, b);
  }
  writeFileSync(TMP + "/" + file, html);
  const runner = m.runner ? fileURLToPath(new URL("./" + m.runner, import.meta.url)) : TESTS;
  let out = "";
  try {
    out = execFileSync("node", [runner, m.tests], { env: Object.assign({}, process.env, { MINIBUS_ROOT: TMP, MINIBUS_PORT: String(port++) }), encoding: "utf8", timeout: 600000 });
  } catch (e) { out = String(e.stdout || ""); }
  const failed = (out.match(/✗ [A-Za-z0-9]+/g) || []).map(x => x.slice(2));
  const ran = (out.match(/[✓✗] [A-Za-z0-9]+/g) || []).map(x => x.slice(2));
  const want = m.tests.split(",");
  /* A test that never ran has proved nothing either way: said as such, and
     counted as missed, never as caught. */
  const notRun = want.filter(t => !ran.includes(t));
  const caught = !notRun.length && want.some(t => failed.includes(t));
  summary.push({ id: m.id, caught, failed });
  console.log((caught ? "  caught  " : notRun.length ? "  NOT RUN " : "  MISSED  ") + (m.id + " ").padEnd(40) +
              (notRun.length ? "no result for: " + notRun.join(", ") : "failing: " + (failed.join(", ") || "none")));
}
const missed = summary.filter(s => !s.caught);
console.log("\n  " + summary.length + " sabotages, " + (summary.length - missed.length) + " caught, " + missed.length + " missed");
process.exit(missed.length ? 1 : 0);
