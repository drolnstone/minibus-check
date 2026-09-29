/* THE SHEET'S OWN PASSWORD.

   TOKEN is in config.js, which every phone downloads, so it was never able
   to keep anybody out of what only the spreadsheet and the live server should
   say to each other: a sync that replaces the rota, the drivers and the
   stops; the drain; a coordinator alert; a rota decision handed to the sheet.
   From w2.23.0 / v1.86.0 SHEET_TOKEN, set on both sides, guards those, and
   what phones send is exactly as it was. Not set on either side, nothing
   changes, so a half-finished deploy does not stop the Sunday. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";

const SECRET = "a-private-sheet-password";

export default async function (root) {
  const s = new Suite("the sheet's own password guards what only the sheet and the live server say");
  const G = installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  const fresh = (over) => { G.reset(); return makeEnv(makeDB(join(root, "server", "schema.sql")), over); };
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});

  /* ---- the live server -------------------------------------------------- */

  s.test("with SHEET_TOKEN set, the sheet's messages without it are refused", async (a) => {
    const env = fresh({ SHEET_TOKEN: SECRET });
    for (const action of ["sync", "drain", "drained", "coordAlert", "ping", "mint", "outcome", "rehearsal", "sheetbookings", "cleartrips"]) {
      const out = await J(await post(env, { action }));
      a.eq(out.error, "bad sheet token", action + " went through on the public token alone");
    }
  });

  s.test("and accepted with it", async (a) => {
    const env = fresh({ SHEET_TOKEN: SECRET });
    const out = await J(await post(env, { action: "sync", sheetToken: SECRET }));
    a.ok(out.ok, JSON.stringify(out));
  });

  s.test("what phones send still needs only the public token", async (a) => {
    const env = fresh({ SHEET_TOKEN: SECRET });
    for (const action of ["trip", "check", "rotaRequest", "pin", "coord", "authorise"]) {
      const out = await J(await post(env, { action }));
      a.not(out.error === "bad sheet token", action + " now wants the sheet's password, and phones do not have it");
    }
  });

  s.test("not set, the sheet's messages go through as they always did", async (a) => {
    const env = fresh();
    const out = await J(await post(env, { action: "sync" }));
    a.ok(out.ok, JSON.stringify(out));
  });

  s.test("the live server sends it when it asks the sheet for something", async (a) => {
    const env = fresh({ SHEET_TOKEN: SECRET, SHEET_PUSH_MS: 200 });
    await W.cachePut(env, "sheet_url", { url: "https://script.google.com/macros/s/X/exec" }).run();
    G.reply(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await W.sheetAsk(env, { action: "report", name: "health" }, 200);
    const sent = JSON.parse(G.calls[0].opts.body);
    a.eq(sent.sheetToken, SECRET);
    a.eq(sent.token, "minibusapp");
  });

  s.test("its status answer says whether it has one", async (a) => {
    a.eq((await J(await W.handleDrain(fresh({ SHEET_TOKEN: SECRET }), { limit: 1 }))).sheetTokenSet, true);
    a.eq((await J(await W.handleDrain(fresh(), { limit: 1 }))).sheetTokenSet, false);
  });

  /* ---- the sheet -------------------------------------------------------- */

  const sheet = (props) => {
    const L = loadCodeGs(root, { tabs: {}, props: Object.assign({ PIN_SALT: "salt", WORKER_URL: "https://worker.test" }, props || {}) });
    const sent = [];
    L.ctx.UrlFetchApp = { fetch(url, opts) {
      sent.push(JSON.parse((opts && opts.payload) || "{}"));
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true }), getAllHeaders: () => ({}) };
    } };
    return { L, sent };
  };
  const doPost = (L, body) => JSON.parse(call(L, "doPost", { postData: { contents: JSON.stringify(body) } }).getContent());

  s.test("the sheet sends SHEET_TOKEN on every call to the live server, once it is set", (a) => {
    const on = sheet({ SHEET_TOKEN: SECRET });
    call(on.L, "workerCall", "ping", {});
    a.eq(on.sent[0].sheetToken, SECRET);
    const off = sheet();
    call(off.L, "workerCall", "ping", {});
    a.eq(off.sent[0].sheetToken, undefined);
  });

  s.test("the sheet refuses the live server's three asks without it", (a) => {
    const { L } = sheet({ SHEET_TOKEN: SECRET });
    for (const action of ["decision", "report", "drainnow"]) {
      a.eq(doPost(L, { token: "minibusapp", action }).error, "bad sheet token",
           action + " went through on the public token alone");
      a.not(doPost(L, { token: "minibusapp", sheetToken: SECRET, action }).error === "bad sheet token",
            action + " was refused with the right password");
    }
  });

  s.test("and phones' own messages to the sheet are untouched", (a) => {
    const { L } = sheet({ SHEET_TOKEN: SECRET });
    a.not(doPost(L, { token: "minibusapp", action: "rotaRequest", request: {} }).error === "bad sheet token");
  });

  const report = (props, answer) => {
    const { L } = sheet(props);
    L.ctx.UrlFetchApp = { fetch() {
      return { getResponseCode: () => 200, getAllHeaders: () => ({}), getContentText: () => JSON.stringify(answer) };
    } };
    call(L, "liveCheck");
    const al = L.gas.logs.filter((x) => x[0] === "alert").pop();
    return al ? al.slice(1).join("\n") : "";
  };
  const fine = { ok: true, bookings: [], trips: [], clockAgoSec: 10, cacheAgeMin: { rota: 5, last: 5 }, pinSalt: true };

  s.test("Is the live server working? says when neither side has it yet", (a) => {
    a.has(report({}, Object.assign({ sheetTokenSet: false }, fine)), "No SHEET_TOKEN yet");
  });

  s.test("and which side is missing it", (a) => {
    a.has(report({ SHEET_TOKEN: SECRET }, Object.assign({ sheetTokenSet: false }, fine)),
          "set here but not on the live server");
    a.has(report({ SHEET_TOKEN: "other" }, { ok: false, error: "bad sheet token" }),
          "refused this sheet's password");
  });

  s.test("and nothing when both have it", (a) => {
    a.hasnt(report({ SHEET_TOKEN: SECRET }, Object.assign({ sheetTokenSet: true }, fine)), "SHEET_TOKEN");
  });

  return s;
}
