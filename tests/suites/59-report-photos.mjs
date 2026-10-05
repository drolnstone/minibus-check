/* PHOTOS ON A REPORT.
   pages v1.104.0 · server w2.50.0 · sheet v1.109.0 (Asim, 5 October 2026).

   A Defect needs at least one photo and an Advisory may carry up to three,
   taken in the driver app. They go to the live server only. The
   coordinator's app shows them on the open defect's card, under a PIN, and
   the sheet's Defects tab counts them.

   Everything here fails on w2.49.0 and v1.108.0, which know no photos. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { TABS, tab } from "../lib/tabs.mjs";

const PIN = "1234";
const JPEG = "data:image/jpeg;base64,";
const PIC = JPEG + "A".repeat(4000) + "==";
const THUMB = JPEG + "B".repeat(400);

export default async function (root) {
  const s = new Suite("photos on a report");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  const OIL = { key: "c1|YS70 PWE|Engine oil|4 October 2026", checkId: "c1", reg: "YS70 PWE",
                date: "4 October 2026", item: "Engine oil", crit: false, found: "Engine oil needs top up",
                kind: "Advisory", status: "Open", action: "", driver: "Bro Abiodun" };
  const DIRT = { key: "c2|NH56 FWP|Clean enough to be safe|4 October 2026", checkId: "c2", reg: "NH56 FWP",
                 date: "4 October 2026", item: "Clean enough to be safe", crit: false,
                 found: "Vehicle is very dirty inside", kind: "Advisory", status: "Open", action: "", driver: "Pst Obamakinwa" };

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await db.prepare("DELETE FROM drivers").run();
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,?,?)")
      .bind("Bro Asim", "Coordinator", "North", 1, 1, await W.pinHashOf(env, "Bro Asim", PIN)).run();
    await W.handleSync(env, { authRules: { roles: ["Coordinator"], sameHandBothWays: true } });
    await W.cachePut(env, "coord_shelf", { builtAt: Date.now(), readAt: Date.now(), requests: [],
      defects: [OIL, DIRT] }).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const photo = (env, p) => post(env, { action: "photo", photo: Object.assign(
    { id: "c1-oil-1", checkId: "c1", item: "Engine oil", n: 1, reg: "YS70 PWE", data: PIC, thumb: THUMB }, p || {}) }).then(J);
  const coord = async (env, body, pin) => J(await post(env, Object.assign({ action: "coord", who: "Bro Asim", pin: pin || PIN }, body)));

  s.test("a photo goes in once, and the coordinator's defect card names it", async (a) => {
    const { env, db } = await fresh();
    a.eq((await photo(env)).ok, true);
    a.eq((await photo(env)).ok, true, "a retry is an answer, not an error");
    a.eq((await photo(env, { id: "c1-oil-2", n: 2 })).ok, true);
    const n = await db.prepare("SELECT COUNT(*) AS n FROM photos").first();
    a.eq(n.n, 2);
    const out = await coord(env, { op: "load" });
    a.eq(out.ok, true, JSON.stringify(out).slice(0, 200));
    const oil = out.defects.find((d) => d.item === "Engine oil");
    const dirt = out.defects.find((d) => d.item === "Clean enough to be safe");
    a.same(oil.photos, ["c1-oil-1", "c1-oil-2"]);
    a.ok(!dirt.photos, "another defect was given the oil photos");
  });

  s.test("thumbnails for a card, one photo in full, and only under a PIN", async (a) => {
    const { env } = await fresh();
    await photo(env);
    const th = await coord(env, { op: "photos", ids: ["c1-oil-1", "nope"] });
    a.eq(th.photos["c1-oil-1"], THUMB);
    a.ok(!("nope" in th.photos));
    const big = await coord(env, { op: "photos", ids: ["c1-oil-1"], full: true });
    a.eq(big.photos["c1-oil-1"], PIC);
    const bad = await coord(env, { op: "photos", ids: ["c1-oil-1"], full: true }, "9999");
    a.ok(!bad.ok && !bad.photos, "a wrong PIN was shown a photo");
    const noToken = await J(await W.default.fetch(new Request("https://worker.test/", { method: "POST",
      body: JSON.stringify({ action: "photo", photo: { id: "x", checkId: "c1", item: "Engine oil", n: 1, data: PIC, thumb: THUMB } }) }), env, {}));
    a.eq(noToken.error, "bad token");
  });

  s.test("anything but a JPEG of a sane size, or a fourth photo, is refused", async (a) => {
    const { env } = await fresh();
    a.eq((await photo(env, { data: "data:image/png;base64,AAAA" })).error, "bad photo");
    a.eq((await photo(env, { data: JPEG + "A".repeat(1400001) })).error, "bad photo");
    a.eq((await photo(env, { data: JPEG + "<script>" })).error, "bad photo");
    a.eq((await photo(env, { n: 4, id: "c1-oil-4" })).error, "bad photo");
    a.eq((await photo(env, { id: "bad id!" })).error, "bad photo");
    a.eq((await photo(env, { item: "" })).error, "bad photo");
  });

  s.test("two hundred in a day is a ceiling", async (a) => {
    const { env, db } = await fresh();
    for (let i = 0; i < 200; i++) {
      await db.prepare("INSERT INTO photos (id, check_id, item, n, reg, made, thumb, data) VALUES (?,?,?,?,?,?,?,?)")
        .bind("f" + i, "cf" + i, "Tyres", 1, "", Date.now(), THUMB, PIC).run();
    }
    a.eq((await photo(env)).error, "too many photos");
  });

  s.test("old photos go once their defect is closed, an open defect keeps its own", async (a) => {
    const { env, db } = await fresh();
    await photo(env);
    await photo(env, { id: "c9-tyres-1", checkId: "c9", item: "Tyres" });
    await db.prepare("UPDATE photos SET made = ?").bind(Date.now() - 27 * 7 * 86400000).run();
    await W.prunePhotos(env, true);
    const left = (await db.prepare("SELECT id FROM photos").all()).results.map((r) => r.id);
    a.same(left, ["c1-oil-1"], "the oil defect is open, the tyres one is not on the list");
  });

  /* ---- the sheet ---- */
  const TODAY = new Date(2026, 9, 4);
  function sheet() {
    return loadCodeGs(root, { tabs: {
      "Drivers": tab("Drivers", [{ Name: "Bro Abiodun", Role: "Driver", Active: "YES", "Primary order": 1,
        Email: "a@b.c", Phone: "07700900111", Route: "North" }]),
      "Buses": tab("Buses", [{ Registration: "YS70 PWE", "Seats for passengers": 16, Active: "YES" }]),
      "Checks": [TABS["Checks"]], "Defects": [TABS["Defects"]], "Trip Events": [TABS["Trip Events"]],
      "Bus Bookings": [TABS["Bus Bookings"]], "Rota Requests": [TABS["Rota Requests"]]
    }, props: { COORDINATOR_EMAIL: "coord@b.c", PIN_SALT: "salt", WORKER_URL: "https://example.invalid" } });
  }

  s.test("the Defects tab counts each item's photos, and a tab without the column gets it", (a) => {
    const L = sheet();
    call(L, "handleCheck", { id: "c1", reg: "YS70 PWE", vehicle: "Ford Transit", driver: "Bro Abiodun",
      role: "Driver", date: "4 October 2026", time: "10:20", miles: 58061, sign: "Biodun", level: "warn",
      checked: 37, total: 37, jobs: [], defects: [],
      advisories: [{ name: "Engine oil", crit: false, note: "Engine oil needs top up", photos: 2 },
                   { name: "First aid kit", crit: false, note: "Can't locate it.", photos: 0 }] });
    const sh = L.gas.ss.getSheetByName("Defects");
    const rows = sh.getDataRange().getValues();
    const col = rows[0].indexOf("Photos");
    a.ok(col > -1, "no Photos heading: " + JSON.stringify(rows[0]));
    const oil = rows.find((r) => r.indexOf("Engine oil") > -1);
    const kit = rows.find((r) => r.indexOf("First aid kit") > -1);
    a.eq(oil[col], 2);
    a.eq(kit[col], "");
  });

  s.test("the Photos heading is added once the new version runs, before any defect", (a) => {
    const L = sheet();
    call(L, "vlogBoot", L.gas.ss);
    const head = L.gas.ss.getSheetByName("Defects").getDataRange().getValues()[0];
    a.ok(head.indexOf("Photos") > -1, JSON.stringify(head));
  });

  /* ---- the driver app ---- */
  s.test("the driver app asks for a photo on a Defect, never on items a photo cannot show", (a) => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    a.has(html, 'function needsPhoto(it, r){\n  return !!r && r.v==="def" && !it.nophoto');
    a.has(html, '"Add a photo of " + nopic[0].name');
    a.has(html, "left>0 || blank.length>0 || nopic.length>0");
    for (const id of ["keys", "firstaid", "docs", "brakes", "steering"]) a.has(html, '{ id:"' + id + '", nophoto:true,');
    for (const id of ["oil", "clean", "tyres", "doors"]) a.hasnt(html, '{ id:"' + id + '", nophoto:true,');
    a.has(html, 'action: "photo"');
  });

  return s;
}
