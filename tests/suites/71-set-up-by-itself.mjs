/* SET UP BY ITSELF, sheet v1.120.0 (Asim, 14 Oct 2026: "if its auto, let it
   be auto indeed and not semiauto").

   Code.gs goes live on a merge (#93) with nobody at the sheet, so the
   five-minute clock runs Set up once for each new version. */

import { Suite } from "../lib/t.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";

export default async function (root) {
  const s = new Suite("set up by itself");

  function fresh(quiet) {
    const g = loadCodeGs(root);
    let runs = 0;
    g.ctx.setUpQuiet = () => { runs++; if (quiet) quiet(runs); return []; };
    return { g, runs: () => runs, props: g.gas.props };
  }

  s.test("runs once for a new version, then not again", (a) => {
    const t = fresh();
    a.eq(call(t.g, "setUpIfNew"), true);
    a.eq(t.props.setUpFor, t.g.ctx.SCRIPT_VERSION);
    a.eq(call(t.g, "setUpIfNew"), false);
    a.eq(t.runs(), 1);
    a.not("setUpRunning" in t.props, "the running stamp is left behind");
  });

  s.test("runs again when the version moves on", (a) => {
    const t = fresh();
    t.props.setUpFor = "v1.0.0";
    a.eq(call(t.g, "setUpIfNew"), true);
    a.eq(t.runs(), 1);
  });

  s.test("a Set up that keeps failing is tried three times, then left for the health check", (a) => {
    const t = fresh(() => { throw new Error("tab refused"); });
    for (let i = 0; i < 5; i++) { try { call(t.g, "setUpIfNew"); } catch (e) {} }
    a.eq(t.runs(), 3);
    a.not("setUpFor" in t.props);
    a.not("setUpRunning" in t.props);
  });

  s.test("not while another run is under way", (a) => {
    const t = fresh();
    t.props.setUpRunning = String(Date.now() - 60000);
    a.eq(call(t.g, "setUpIfNew"), false);
    a.eq(t.runs(), 0);
  });

  s.test("the five-minute clock does it before pushing to the live server", (a) => {
    const src = loadCodeGs(root).src;
    const body = src.slice(src.indexOf("function liveSync()"));
    const at = body.indexOf("setUpIfNew()"), push = body.indexOf("pushToWorker()");
    a.ok(at > 0 && at < push, "setUpIfNew is not first in liveSync");
  });

  s.test("the menu item marks the version done too", (a) => {
    const src = loadCodeGs(root).src;
    const body = src.slice(src.indexOf("function setUpEverything()"), src.indexOf("function setUpQuiet("));
    a.ok(/setUpFor/.test(body));
  });

  return s;
}
