/* THE DRIVER APP'S OWN SHAPE, WHERE A FAULT HAS ALREADY BEEN.

   The rest of this suite exercises the Worker and the spreadsheet script by
   calling them. The driver app is a page, and these are the places in it where
   v1.74.8 was found wrong while the driver's manual was being written, and
   v1.74.9 after it — each
   one checked by driving the real page in a browser (tests/browser), and each
   held here by the fact that made it wrong, so it cannot drift back unseen.

   These read the source rather than run it. That is weaker than the browser
   run and it is meant to be: it is the part that runs every time. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Suite } from "../lib/t.mjs";

/* A named function's body, found by counting braces from its first line.
   Strings and comments can hold braces, so they are blanked first; the
   offsets are kept, which is all the slicing needs. */
function blank(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, (m) => m.replace(/[{}]/g, " "));
}
function body(src, name) {
  const at = blank(src).search(new RegExp("function\\s+" + name + "\\s*\\("));
  return at < 0 ? null : bodyAt(src, at);
}
/* The body of the first function that starts at or after an offset, named
   or not: for a handler written inline, like the one for visibilitychange. */
function bodyAt(src, from) {
  const clean = blank(src);
  const at = clean.indexOf("function", from);
  if (at < 0) return null;
  const open = clean.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < clean.length; i++) {
    if (clean[i] === "{") depth++;
    else if (clean[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
}

export default function (root) {
  const s = new Suite("the driver app, where v1.74.8 was wrong");
  const html = readFileSync(join(root, "index.html"), "utf8");
  const code = html.slice(html.indexOf("<script src=\"config.js\"></script>"));

  s.test("no page shows a JavaScript escape as text (the bus sheet read TODAY\\U2019S BUS)", (a) => {
    for (const f of ["index.html", "sunday/index.html", "do/index.html"]) {
      const src = readFileSync(join(root, f), "utf8");
      const markup = src.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "");
      const hit = markup.match(/\\u[0-9a-fA-F]{4}/);
      a.not(hit, f + " has " + (hit && hit[0]) + " in its markup, which a browser prints as it stands");
    }
  });

  s.test("opening Stops mid-run starts the speed watch after the poll, which stops it", (a) => {
    const b = body(code, "rotaOpenStops");
    a.ok(b, "rotaOpenStops not found");
    const poll = b.lastIndexOf("rotaCountsStart()");
    const watch = b.lastIndexOf("tripWatchStart()");
    a.ok(poll > 0 && watch > 0, "rotaOpenStops no longer calls both");
    a.ok(watch > poll, "tripWatchStart comes before rotaCountsStart, which stops it again");
  });

  s.test("coming back from the lock screen keeps the same order", (a) => {
    const at = code.indexOf('document.addEventListener("visibilitychange"');
    a.ok(at > 0, "the visibilitychange handler is gone");
    const b = bodyAt(code, at);
    a.ok(b && b.indexOf("rotaCountsStart()") > 0, "the handler no longer restarts the poll");
    a.ok(b.lastIndexOf("tripWatchStart()") > b.lastIndexOf("rotaCountsStart()"),
         "the watch is started before the poll on the way back from the lock screen");
  });

  s.test("the reopen button is drawn for a run that has ended, not only for one that has not", (a) => {
    const b = body(code, "tripHeaderHtml");
    const ended = b.slice(b.indexOf("if(t.ended)"));
    const line = (ended.match(/if\([^\n]*(tripMayReopen|tripAutoUndoOpen)\([^\n]*\{/) || [""])[0];
    a.ok(line, "the reopen condition is gone");
    a.not(/\bonThis\b/.test(line), "the reopen button still depends on onThis, which is false once a run has ended");
    a.not(/\bonThis\b/.test(body(code, "tripMayReopen") || ""), "the reopen test depends on onThis, which is false once a run has ended");
  });

  s.test("a stale board answer cannot close a run the driver has reopened", (a) => {
    const b = body(code, "tripMerge");
    a.has(b, "trip.reopened", "tripMerge takes any end the board reports, including the one he took back");
    a.has(body(code, "tripAutoUndo"), "trip.reopened", "reopening does not record when it happened");
    a.has(body(code, "tripSaveState"), "reopened", "the reopen is not kept on the phone");
  });

  s.test("the reopen offer survives the app being opened fresh, as the notification asks", (a) => {
    a.has(body(code, "tripSaveState"), "tripAutoEndedAt", "when the app ended the run is kept in memory only, so a reload loses the offer");
    a.has(body(code, "tripLoadState"), "tripAutoEndedAt", "the saved end time is never read back");
  });

  s.test("a driver covering at short notice can reopen his run after the app is opened fresh", (a) => {
    a.has(body(code, "tripSaveState"), "driver", "the run is kept with no name on it, so after a reload nothing says it was his");
    a.has(body(code, "tripMayReopen"), "tripIsMine(", "the reopen is offered only to the man the rota names");
    a.has(body(code, "tripHeaderHtml"), "tripMayReopen(", "the button is drawn by the rota's test, not its own");
    a.has(body(code, "tripAutoUndo"), "tripMayReopen(", "the reopen itself does not ask whose run it is");
  });

  s.test("«I am covering this run» can be drawn before the bus goes", (a) => {
    const b = body(code, "tripHeaderHtml");
    const notStarted = b.slice(b.indexOf("if(!t.started)"), b.indexOf("if(t.ended)"));
    a.has(notStarted, "tripCoverHtml(", "the cover offer is only drawn for a run already under way, where it can never apply");
    a.has(body(code, "tripMayCover"), "rotaMyRoute()", "a driver on the rota for one route is offered cover on the other");
  });

  s.test("the coordinator can reach Authorise without being the rostered driver", (a) => {
    const b = body(code, "tripHeaderHtml");
    a.has(b, "tripCoordStopsHtml()", "Authorise is only inside the Start buttons, which only the rostered driver sees");
    a.has(body(code, "tripCoordStopsHtml"), "mayAuthorise(", "the coordinator's Authorise is not behind mayAuthorise");
  });

  s.test("the stop buttons stick above the bar at the bottom, not under it", (a) => {
    const rule = (html.match(/\.trip-actions\{[^}]*\}/) || [""])[0];
    a.has(rule, "bottom:var(--footH", ".trip-actions sticks at the very bottom, behind the bar that holds End trip");
    a.has(body(code, "footHeightSync"), "--footH", "nothing measures the bar for --footH");
  });

  s.test("a repaint re-applies the moving state, and Undo refuses while moving", (a) => {
    const b = body(code, "rotaPaintStops");
    const force = b.lastIndexOf("tripMovingPainted=null");
    a.ok(force > 0 && force < b.lastIndexOf("tripPaintMoving()"),
         "a repaint while moving leaves the fresh buttons live and the banner blank");
    a.has(body(code, "tripUndo"), "tripMoving()", "Undo goes through on a moving bus");
  });

  s.test("the end of the run is drawn when the clock gets there, not at the next change", (a) => {
    a.has(body(code, "rotaCountsStart"), "tripDueNow()", "the poll repaints only when the board changes");
    a.has(body(code, "tripPaint"), "is-due", "End trip turns only when the bar is rebuilt, never on a tap");
  });

  s.test("past the time at church the line says so, even with every stop marked", (a) => {
    const b = body(code, "tripEndState") || "";
    a.ok(b.indexOf('"late"') > 0 && b.indexOf('"late"') < b.indexOf('"marked"'), "late does not win over marked");
    a.has(body(code, "tripDueNow"), "tripEndState(", "the poll watches only whether either line applies, not which one");
    a.has(body(code, "tripHeaderHtml"), "tripEndState(", "the line is worked out apart from what the poll watches");
  });

  s.test("every way into a check goes through the PIN gate", (a) => {
    const b = body(code, "reset");
    const gate = b.indexOf("pinGateNeeded()");
    a.ok(gate > 0 && gate < b.indexOf('show("vehicle")'),
         "Do the check and Check another bus go to the bus list with the PIN just cleared");
  });

  return s;
}
