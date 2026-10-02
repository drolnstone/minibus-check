/* A NOTE ON THE ROTA, CHANGED OR TAKEN OFF. pages v1.93.0 · server w2.35.0 ·
   sheet v1.98.0.

   - A note already on a Sunday is changed, or taken off, from the
     coordinator's app, and every phone has it at once.
   - Swapped lines and PROTECTED, which the sheet reads back, are left to the
     sheet.
   - The sheet changes that one line of the Notes cell and leaves the rest.

   Everything here fails on w2.34.0 / v1.97.0. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab, TABS } from "../lib/tabs.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const THU = "2026-10-01T12:00:00+01:00";
const KEY = "2026-10-04";
const PIN = "1234";
const NOTES = "Swapped: Bro Adrian in for Bro Martin (with 2026-10-11)\nBring the ramp\nPROTECTED: harvest";

export default async function (root) {
  const s = new Suite("a note on the rota, changed or taken off");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await db.prepare("UPDATE rota SET notes=? WHERE sunday=?").bind(NOTES, KEY).run();
    await db.prepare("DELETE FROM drivers").run();
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
      .bind("Bro Arthur", "Coordinator", "North", 1, await W.pinHashOf(env, "Bro Arthur", PIN)).run();
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    await W.cachePut(env, "cache_rota", { builtAt: Date.now() - 60000, from: "2026-07-12", to: "2028-09-24",
      payload: { ok: true, rows: [{ date: KEY, primary: "Bro Adrian", actual: "Bro Adrian", status: "Confirmed",
        primary2: "Bro Trevor", actual2: "", notes: NOTES, northBus: "YS70 PWE", southBus: "NH56 FWP",
        swaps: [], locked: true, lockNote: "harvest", requests: [] }] } }).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const coord = async (env, body) => J(await post(env, Object.assign({ action: "coord", who: "Bro Arthur", pin: PIN }, body)));
  let n = 0;
  const act = (env, a) => coord(env, { op: "act", act: Object.assign({ id: "note-act-" + (++n) }, a) });
  const notesOf = async (env) => (await W.cachedRota(env, KEY, 1)).rows.find((r) => r.date === KEY).notes;

  s.test("a note changed, then taken off: every phone has it at once, and the words", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      const ch = await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: "Bring  the ramp", now: "Bring the ramp and the cones" } });
      a.ok(ch.ok, JSON.stringify(ch));
      a.has(ch.action.words, "Note changed.");
      a.has(await notesOf(env), "Bring the ramp and the cones");
      a.has(await notesOf(env), "PROTECTED: harvest");
      a.has((await W.getRotaRow(env, KEY)).notes, "Bring the ramp and the cones");
      const off = await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: "Bring the ramp and the cones", now: "" } });
      a.ok(off.ok, JSON.stringify(off));
      a.has(off.action.words, "Note taken off.");
      const left = await notesOf(env);
      a.not(/ramp/.test(left), left);
      a.eq(left.split("\n").length, 2, left);
      /* Laid over again, as each push from the sheet does: nothing more moves. */
      await W.reapplyRawRota(env);
      await W.reapplyRawRota(env);
      a.eq((await W.getRotaRow(env, KEY)).notes.split("\n").length, 2);
      const body = JSON.parse(db._one("SELECT body FROM coord_actions ORDER BY seq DESC LIMIT 1").body);
      a.eq(JSON.stringify(body.noteEdit), JSON.stringify({ was: "Bring the ramp and the cones", now: "" }));
    });
  });

  s.test("a note added, changed and taken off before the sheet has any of it: gone, and not back", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      a.ok((await act(env, { kind: "rota", sunday: KEY, note: "Ramp in the shed" })).ok);
      a.ok((await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: "Ramp in the shed", now: "Ramp in the vestry" } })).ok);
      const raw1 = (await W.getRotaRow(env, KEY)).notes;
      a.eq(raw1.split("\n").filter((x) => /Ramp/.test(x)).join("|"), "Ramp in the vestry", raw1);
      a.ok((await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: "Ramp in the vestry", now: "" } })).ok);
      await W.reapplyRawRota(env);
      const raw = (await W.getRotaRow(env, KEY)).notes;
      a.not(/Ramp/.test(raw), raw);
      a.not(/Ramp/.test(await notesOf(env)), await notesOf(env));
    });
  });

  s.test("the sheet's own lines, a note not there, and no change: each refused", async (a) => {
    await atTime(THU, async () => {
      const { env } = await fresh();
      a.has(String((await act(env, { kind: "rota", sunday: KEY,
        noteEdit: { was: "Swapped: Bro Adrian in for Bro Martin (with 2026-10-11)", now: "" } })).error), "Rota tab");
      a.not((await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: "PROTECTED: harvest", now: "harvest" } })).ok);
      a.not((await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: "Bring the ramp", now: "PROTECTED" } })).ok);
      a.has(String((await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: "No such note", now: "x" } })).error), "not on");
      a.has(String((await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: "Bring the ramp", now: "Bring the ramp" } })).error), "Nothing");
      a.has(await notesOf(env), "Bring the ramp");
    });
  });

  s.test("the sheet changes that one line and leaves the rest; a line gone is said", async (a) => {
    await atTime(THU, async () => {
      const L = loadCodeGs(root, { tabs: {
        "Rota": tab("Rota", [{ Sunday: new Date(2026, 9, 4), "North Liverpool scheduled": "Bro Adrian", Status: "Confirmed",
                               "South Liverpool scheduled": "Bro Trevor", Notes: NOTES }]),
        "Drivers": tab("Drivers", [{ Name: "Bro Adrian", Role: "Driver", Active: "YES", Route: "North" },
                                   { Name: "Bro Trevor", Role: "Driver", Active: "YES", Route: "South" }]) },
        props: {} });
      const ss = L.gas.ss;
      const A = (id, body) => ({ id, kind: "rota", sunday: KEY, by: "Bro Arthur", made: Date.now(), body: Object.assign({ sunday: KEY }, body) });
      const cell = () => ss.getSheetByName("Rota").getRange(2, TABS["Rota"].indexOf("Notes") + 1);
      const r1 = call(L, "applyCoordAction", ss, A("n1", { set: {}, note: "", noteEdit: { was: "Bring the ramp", now: "Ramp is in the shed" } }), {});
      a.ok(r1.done && r1.ok, JSON.stringify(r1));
      a.eq(String(cell().getValue()),
           "Swapped: Bro Adrian in for Bro Martin (with 2026-10-11)\nRamp is in the shed\nPROTECTED: harvest");
      const r2 = call(L, "applyCoordAction", ss, A("n2", { set: {}, note: "", noteEdit: { was: "Ramp is in the shed", now: "" } }), {});
      a.ok(r2.ok, JSON.stringify(r2));
      a.eq(String(cell().getValue()), "Swapped: Bro Adrian in for Bro Martin (with 2026-10-11)\nPROTECTED: harvest");
      const r3 = call(L, "applyCoordAction", ss, A("n3", { set: {}, note: "", noteEdit: { was: "Ramp is in the shed", now: "x" } }), {});
      a.not(r3.ok);
      a.has(r3.result, "not on the Rota tab");
      const r4 = call(L, "applyCoordAction", ss, A("n4", { set: {}, note: "", noteEdit: { was: "PROTECTED: harvest", now: "" } }), {});
      a.not(r4.ok, "a PROTECTED line was taken off");
      a.has(String(cell().getValue()), "PROTECTED: harvest");
    });
  });

  return s;
}
