/* IS EVERYTHING WORKING? NOW ASKS ABOUT THE MESSAGE BUTTON.

   The passenger's Message button went dark for weeks and nothing said so:
   only a booked passenger sees it, only on a Sunday morning, and a missing
   button looks like a driver who gave no number. From v1.91.0 / w2.29.0 the
   live server says whose numbers it holds, and the health report holds that
   against the coming Sunday's two drivers. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab } from "../lib/tabs.mjs";
import { atTime } from "../lib/clock.mjs";

const THU = "2026-10-01T12:00:00+01:00";   /* the coming Sunday is 4 October */

export default async function (root) {
  const s = new Suite("is everything working asks whether passengers can message the driver");
  const G = installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  const sheet = (o) => {
    o = o || {};
    return loadCodeGs(root, { tabs: {
      "Drivers": tab("Drivers", [
        { Name: "Bro Adrian", Role: "Driver", Active: "YES", "Primary order": 1, Route: "North", Phone: o.adrianPhone === undefined ? "07700 900111" : o.adrianPhone },
        { Name: "Bro Trevor", Role: "Driver", Active: "YES", "Primary order": 1, Route: "South", Phone: "07700900222" },
        { Name: "Bro Colin", Role: "Driver", Active: "YES", "Primary order": 2, Route: "South", Phone: "07700900333" }]),
      "Rota": tab("Rota", [{ Sunday: new Date(2026, 9, 4), "North Liverpool scheduled": "Bro Adrian",
                             "South Liverpool scheduled": "Bro Trevor", "South Liverpool actual / cover": o.cover || "",
                             Status: o.status || "Confirmed" }])
    }, props: { PIN_SALT: "salt" } });
  };
  const run = (L, lv) => {
    const good = [], bad = [], todo = [];
    call(L, "messageDriverHealth", L.gas.ss, lv, good, bad, todo);
    return { good: good.join(" | "), bad: bad.join(" | "), todo: todo.join(" | ") };
  };

  s.test("both of Sunday's drivers held: said so, by name", async (a) => {
    await atTime(THU, async () => {
      const r = run(sheet(), { waHeld: ["Bro Adrian", "Bro Trevor", "Bro Colin"] });
      a.has(r.good, "passengers can message Bro Adrian (North) and Bro Trevor (South) on 4 October");
      a.eq(r.bad, ""); a.eq(r.todo, "");
    });
  });

  s.test("the live server holding none is a fault, the one this check is for", async (a) => {
    await atTime(THU, async () => {
      const r = run(sheet(), { waHeld: [] });
      a.has(r.bad, "holds no drivers' numbers");
      a.has(r.bad, "Send everything");
    });
  });

  s.test("a number on the tab that has not reached the live server is a fault", async (a) => {
    await atTime(THU, async () => {
      const r = run(sheet(), { waHeld: ["Bro Trevor"] });
      a.has(r.bad, "no number yet for Bro Adrian (North)");
      a.has(r.good, "Bro Trevor (South)");
    });
  });

  s.test("a driver with no Phone is a choice, not a fault", async (a) => {
    await atTime(THU, async () => {
      const r = run(sheet({ adrianPhone: "" }), { waHeld: ["Bro Trevor", "Bro Colin"] });
      a.has(r.todo, "Bro Adrian (North) has no Phone on the Drivers tab");
      a.eq(r.bad, "");
    });
  });

  s.test("the cover is the driver checked, as the passenger page uses", async (a) => {
    await atTime(THU, async () => {
      const r = run(sheet({ cover: "Bro Colin" }), { waHeld: ["Bro Adrian", "Bro Colin"] });
      a.has(r.good, "Bro Colin (South)");
      a.hasnt(r.good + r.bad, "Bro Trevor");
    });
  });

  s.test("a route called off is not checked", async (a) => {
    await atTime(THU, async () => {
      const r = run(sheet({ status: "South cancelled" }), { waHeld: ["Bro Adrian"] });
      a.eq(r.bad, "");
      a.hasnt(r.good, "South");
    });
  });

  s.test("an older live server, or one that could not tell, says so rather than nothing", async (a) => {
    await atTime(THU, async () => {
      a.has(run(sheet(), {}).bad, "older than w2.29.0");
      a.has(run(sheet(), { waHeld: null }).bad, "could not read");
    });
  });

  s.test("and it is in the report itself, from the live server's own answer", async (a) => {
    await atTime(THU, async () => {
      const L = loadCodeGs(root, { tabs: {
        "Drivers": tab("Drivers", [{ Name: "Bro Adrian", Role: "Driver", Active: "YES", "Primary order": 1, Route: "North", Phone: "07700900111" }]),
        "Rota": tab("Rota", [{ Sunday: new Date(2026, 9, 4), "North Liverpool scheduled": "Bro Adrian", Status: "Confirmed" }])
      }, props: { PIN_SALT: "salt", WORKER_URL: "https://worker.test" } });
      L.ctx.UrlFetchApp = { fetch() {
        return { getResponseCode: () => 200, getAllHeaders: () => ({}), getContentText: () => JSON.stringify(
          { ok: true, server: "w2.29.0", driversOff: [], driversOn: 1, onRegister: 1, passengers: 0, waHeld: [] }) };
      } };
      const r = call(L, "healthReport");
      a.has(r.bad.join(" | "), "holds no drivers' numbers");
    });
  });

  /* ---- the live server's half ------------------------------------------- */

  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});

  s.test("the live server says whose numbers it holds, names only", async (a) => {
    G.reset();
    const env = makeEnv(makeDB(join(root, "server", "schema.sql")));
    a.eq(JSON.stringify((await J(await post(env, { action: "ping" }))).waHeld), "[]", "none held yet");
    await post(env, { action: "sync", driverWa: { "Bro Adrian": "447700900111" } });
    const out = await J(await post(env, { action: "ping" }));
    a.eq(JSON.stringify(out.waHeld), JSON.stringify(["Bro Adrian"]));
    a.hasnt(JSON.stringify(out), "447700900111", "the number itself came back");
  });

  return s;
}
