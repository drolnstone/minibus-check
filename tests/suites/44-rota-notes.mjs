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
const NOTES = "Swapped: Bro Adrian in for Bro Martin (with 2026-10-11)\nBring the ramp\nPROTECTED: thanksgiving";

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
        swaps: [], locked: true, lockNote: "thanksgiving", requests: [] }] } }).run();
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
      a.has(await notesOf(env), "PROTECTED: thanksgiving");
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
      a.not((await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: "PROTECTED: thanksgiving", now: "thanksgiving" } })).ok);
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
           "Swapped: Bro Adrian in for Bro Martin (with 2026-10-11)\nRamp is in the shed\nPROTECTED: thanksgiving");
      const r2 = call(L, "applyCoordAction", ss, A("n2", { set: {}, note: "", noteEdit: { was: "Ramp is in the shed", now: "" } }), {});
      a.ok(r2.ok, JSON.stringify(r2));
      a.eq(String(cell().getValue()), "Swapped: Bro Adrian in for Bro Martin (with 2026-10-11)\nPROTECTED: thanksgiving");
      const r3 = call(L, "applyCoordAction", ss, A("n3", { set: {}, note: "", noteEdit: { was: "Ramp is in the shed", now: "x" } }), {});
      a.not(r3.ok);
      a.has(r3.result, "not on the Rota tab");
      const r4 = call(L, "applyCoordAction", ss, A("n4", { set: {}, note: "", noteEdit: { was: "PROTECTED: thanksgiving", now: "" } }), {});
      a.not(r4.ok, "a PROTECTED line was taken off");
      a.has(String(cell().getValue()), "PROTECTED: thanksgiving");
    });
  });

  /* What a push from the sheet does to the Notes: the sheet's copy and the
     rota table rewritten, the actions it has filed marked seen, and what is
     still on its way laid back over them. */
  async function pushNotes(db, env, notes, seen) {
    await W.cachePut(env, "cache_rota", { builtAt: Date.now() - 1000, from: "2026-07-12", to: "2028-09-24",
      payload: { ok: true, rows: [{ date: KEY, primary: "Bro Adrian", actual: "Bro Adrian", status: "Confirmed",
        primary2: "Bro Trevor", actual2: "", notes: notes, northBus: "YS70 PWE", southBus: "NH56 FWP",
        swaps: [], locked: true, lockNote: "thanksgiving", requests: [] }] } }).run();
    await db.prepare("UPDATE rota SET notes=? WHERE sunday=?").bind(notes, KEY).run();
    for (const id of seen || []) await db.prepare("UPDATE coord_actions SET seen=1 WHERE id=?").bind(id).run();
    await W.reapplyRawRota(env);
  }

  s.test("a line typed longer than 300 on the Rota tab is changed whole, never cut", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      const long = "Bring the ramp " + "and the cones ".repeat(24) + "END";
      a.ok(long.length > 300, String(long.length));
      await pushNotes(db, env, NOTES + "\n" + long, []);
      const now = long.replace("Bring the ramp", "Bring the vans");
      const ch = await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: long, now: now } });
      a.ok(ch.ok, JSON.stringify(ch));
      const body = JSON.parse(db._one("SELECT body FROM coord_actions ORDER BY seq DESC LIMIT 1").body);
      a.eq(body.noteEdit.now, now);
      a.has(await notesOf(env), now);
      a.has(String((await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: now, now: now + " and more" } })).error),
            "Notes are " + now.length + " characters at most.");
      a.has(String((await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: "Bring the ramp", now: "x".repeat(301) } })).error),
            "Notes are 300 characters at most.");
    });
  });

  s.test("a note starting with a minus, taken off while the sheet has filed only its adding: stays off", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      a.ok((await act(env, { id: "minus-add", kind: "rota", sunday: KEY, note: "-5 seats" })).ok);
      a.ok((await act(env, { id: "minus-off", kind: "rota", sunday: KEY, noteEdit: { was: "-5 seats", now: "" } })).ok);
      /* A sheet before v1.98.0 kept the apostrophe that stops a formula. */
      await pushNotes(db, env, NOTES + "\n'-5 seats", ["minus-add"]);
      a.not(/5 seats/.test((await W.getRotaRow(env, KEY)).notes), (await W.getRotaRow(env, KEY)).notes);
      a.not(/5 seats/.test(await notesOf(env)), await notesOf(env));
    });
  });

  s.test("a note added then changed, laid over a copy that already has the change: shown once", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      a.ok((await act(env, { kind: "rota", sunday: KEY, note: "Ramp in the shed" })).ok);
      a.ok((await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: "Ramp in the shed", now: "Ramp in the vestry" } })).ok);
      /* The sheet filed both, and its push left before it could say so. */
      await pushNotes(db, env, NOTES + "\nRamp in the vestry", []);
      for (const t of [(await W.getRotaRow(env, KEY)).notes, await notesOf(env)]) {
        a.eq(t.split("\n").filter((x) => /Ramp/.test(x)).join("|"), "Ramp in the vestry", t);
      }
      a.has(String((await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: "Bring the ramp", now: "Ramp in the vestry" } })).error),
            "That note is there already.");
    });
  });

  s.test("a line changed, put back, then another changed to it, laid over the sheet's copy: both lines shown", async (a) => {
    await atTime(THU, async () => {
      const { db, env } = await fresh();
      await pushNotes(db, env, "Ramp in the shed\nCones in the hall", []);
      a.ok((await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: "Ramp in the shed", now: "Ramp in the vestry" } })).ok);
      a.ok((await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: "Ramp in the vestry", now: "Ramp in the shed" } })).ok);
      a.ok((await act(env, { kind: "rota", sunday: KEY, noteEdit: { was: "Cones in the hall", now: "Ramp in the vestry" } })).ok);
      /* The sheet filed all three, and its push left before it could say so. */
      await pushNotes(db, env, "Ramp in the shed\nRamp in the vestry", []);
      for (const t of [(await W.getRotaRow(env, KEY)).notes, await notesOf(env)]) a.eq(t, "Ramp in the shed\nRamp in the vestry");
    });
  });

  s.test("the sheet keeps a lone date, time or number as the words, and a minus line without an apostrophe", async (a) => {
    await atTime(THU, async () => {
      const base = { "North Liverpool scheduled": "Bro Adrian", Status: "Confirmed", "South Liverpool scheduled": "Bro Trevor" };
      const L = loadCodeGs(root, { tabs: {
        "Rota": tab("Rota", [Object.assign({ Sunday: new Date(2026, 9, 4), Notes: "Bring the ramp\n11/10\nBring  the cones" }, base),
                             Object.assign({ Sunday: new Date(2026, 9, 11), Notes: "" }, base),
                             Object.assign({ Sunday: new Date(2026, 9, 18), Notes: "Bring the cones" }, base)]),
        "Drivers": tab("Drivers", [{ Name: "Bro Adrian", Role: "Driver", Active: "YES", Route: "North" },
                                   { Name: "Bro Trevor", Role: "Driver", Active: "YES", Route: "South" }]) },
        props: {} });
      const ss = L.gas.ss;
      const A = (id, key, body) => ({ id, kind: "rota", sunday: key, by: "Bro Arthur", made: Date.now(),
                                      body: Object.assign({ sunday: key, set: {}, note: "" }, body) });
      const cell = (r) => String(ss.getSheetByName("Rota").getRange(r, TABS["Rota"].indexOf("Notes") + 1).getValue());
      /* Already there with other spacing: not added again. */
      a.ok(call(L, "applyCoordAction", ss, A("d0", KEY, { note: "Bring the cones" }), {}).ok);
      a.eq(cell(2), "Bring the ramp\n11/10\nBring  the cones");
      a.ok(call(L, "applyCoordAction", ss, A("d1", KEY, { noteEdit: { was: "Bring the ramp", now: "" } }), {}).ok);
      a.ok(call(L, "applyCoordAction", ss, A("d1b", KEY, { noteEdit: { was: "Bring the cones", now: "" } }), {}).ok);
      a.eq(cell(2), "'11/10");
      a.ok(call(L, "applyCoordAction", ss, A("d2", "2026-10-11", { note: "10:30" }), {}).ok);
      a.eq(cell(3), "'10:30");
      a.ok(call(L, "applyCoordAction", ss, A("d3", "2026-10-18", { note: "-5 seats" }), {}).ok);
      a.eq(cell(4), "Bring the cones\n-5 seats");
      a.eq(call(L, "notesText", "Bring the ramp"), "Bring the ramp");
      a.eq(call(L, "notesText", "11 Oct"), "'11 Oct");
      a.eq(call(L, "notesText", "11-Oct"), "'11-Oct");
      a.eq(call(L, "notesText", "11-Oct-26"), "'11-Oct-26");
      a.eq(call(L, "notesText", "=1+1\nx"), "'=1+1\nx");
    });
  });

  return s;
}
