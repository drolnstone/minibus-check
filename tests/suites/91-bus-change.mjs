/* A BUS CHANGE OR SWAP IS TOLD. 22 November 2026. server w2.102.0.

   Asim: a swap saved on the Coordinator App Rota alerts each driver whose
   bus changed, once, by the system: Driver App, else email. No other driver
   hears of it. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab, TABS } from "../lib/tabs.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const THU = "2026-11-19T22:00:00Z";
const PIN = "1234";
const SUNS = ["2026-11-22", "2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20", "2026-12-27", "2027-01-03", "2027-01-10"];
const OLD_S = ["Bro Adesina", "Bro Tunde", "Pst Obamakinwa"];
const OLD_N = ["Bro Adebola", "Bro Abiodun", "Bro Moses", "Bro Asim"];

export default async function (root) {
  const s = new Suite("bus change told");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());
  const PEOPLE = [["Bro Asim", "Coordinator", "North"], ["Bro Adebola", "Driver", "North"], ["Bro Abiodun", "Driver", "North"],
                  ["Bro Moses", "Driver", "North"], ["Bro Tunde", "Driver", "South"], ["Pst Obamakinwa", "Driver", "South"],
                  ["Bro Adesina", "Driver", "South"]];

  async function fresh(over) {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, SUNS[0]);
    await db.prepare("DELETE FROM drivers").run();
    for (const d of PEOPLE) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,?,?)")
        .bind(d[0], d[1], d[2], d[0] === "Bro Adesina" ? 0 : 1, await W.pinHashOf(env, d[0], PIN)).run();
    }
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    const rows = SUNS.map((k, i) => Object.assign({ date: k, primary: OLD_N[i % 4], actual: OLD_N[i % 4], status: "Confirmed",
      primary2: OLD_S[i % 3], actual2: "", notes: "", northBus: "YS70 PWE", southBus: "NH56 FWP", requests: [] }, (over || {})[k] || {}));
    for (const r of rows) {
      await db.prepare("INSERT OR REPLACE INTO rota (sunday, north, north_cover, north_bus, south, south_cover, south_bus, status, notes) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(r.date, r.primary, r.actual !== r.primary ? r.actual : "", "YS70 PWE", r.primary2, r.actual2, "NH56 FWP", r.status, r.notes).run();
    }
    await W.cachePut(env, "cache_rota", { builtAt: Date.now() - 60000, from: "2026-07-12", to: "2028-09-24",
      payload: { ok: true, rows: rows } }).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  let n = 0;
  const act = async (env, a) => J(await post(env, { action: "coord", who: "Bro Asim", pin: PIN, op: "act",
    act: Object.assign({ id: "bus-act-" + (++n), kind: "rota" }, a) }));
  const SOUTH = ["Bro Tunde", "Bro Adebola", "Pst Obamakinwa", "Bro Tunde", "Pst Obamakinwa", "Bro Adebola", "Pst Obamakinwa", "Bro Tunde"];
  const NORTH = ["Bro Abiodun", "Bro Moses", "Bro Asim", "Bro Adebola"];

  const mails = (db) => db._rows("SELECT body FROM coord_actions WHERE kind='mail'").map((r) => JSON.parse(r.body));

  s.test("Swap the two buses on Sun 29 Nov: each driver told his own bus, once", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      const out = await act(env, { sunday: "2026-11-29", set: { northBus: "NH56 FWP", southBus: "YS70 PWE" } });
      a.ok(out.ok, JSON.stringify(out));
      const m = mails(db);
      a.eq(m.length, 2, JSON.stringify(m));
      const by = {};
      for (const x of m) for (const n of x.names) by[n] = x;
      a.eq(Object.keys(by).sort().join(","), "Bro Abiodun,Bro Tunde");
      a.eq(by["Bro Abiodun"].title, "Bus changed");
      a.eq(by["Bro Abiodun"].body, "Sun 29 Nov North bus: NH56 FWP (was YS70 PWE).");
      a.eq(by["Bro Tunde"].body, "Sun 29 Nov South bus: YS70 PWE (was NH56 FWP).");
    });
  });

  s.test("a route called off is not told; a driver change still tells as before", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh({ "2026-11-29": { status: "North cancelled" } });
      const out = await act(env, { sunday: "2026-11-29", set: { northBus: "NH56 FWP", southBus: "YS70 PWE" } });
      a.ok(out.ok, JSON.stringify(out));
      const m = mails(db);
      a.eq(m.length, 1, JSON.stringify(m));
      a.eq(m[0].names.join(","), "Bro Tunde");
      const busMails = () => mails(db).filter((x) => x.title === "Bus changed").length;
      const before = busMails();
      const o2 = await act(env, { sunday: "2026-12-06", set: { south: "Bro Tunde" } });
      a.ok(o2.ok, JSON.stringify(o2));
      a.eq(busMails(), before, "no bus alert for a driver change");
    });
  });

  return s;
}
