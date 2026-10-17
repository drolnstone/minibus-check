/* THE WEB APP'S ADDRESS IS IN NO FILE, from pages v1.126.0, server w2.67.0,
   sheet v1.124.0.

   It was in config.js, which every phone downloads and which sits in a
   public repository, and in the Apps Script workflow. Now the driver app
   reaches the sheet through the live server's /sheet, the live server keeps
   the address the sheet sends it, and the workflow reads the deployment from
   a repository secret. */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";

const SECRET = "a-private-sheet-password";
const SHEET = "https://script.google.com/macros/s/AKfyPRIVATEtest/exec";

export default async function (root) {
  const s = new Suite("the sheet's web app address is kept off every page and file");
  const G = installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());
  const fresh = (over) => { G.reset(); return makeEnv(makeDB(join(root, "server", "schema.sql")), over); };
  const withSheet = async (over) => {
    const env = fresh(Object.assign({ SHEET_TOKEN: SECRET }, over || {}));
    await W.cachePut(env, "sheet_url", { url: SHEET }).run();
    return env;
  };
  const relay = (env, method, qs, body) => W.default.fetch(new Request("https://worker.test/sheet" + (qs || ""),
    method === "POST" ? { method, body: JSON.stringify(body) } : { method }), env, {});

  /* ---- the files ---------------------------------------------------------- */

  s.test("no file outside the tests names a real web app id", (a) => {
    const bad = [];
    const walk = (dir) => {
      for (const n of readdirSync(dir)) {
        if (n === ".git" || n === "node_modules" || n === "tests") continue;
        const f = join(dir, n);
        if (statSync(f).isDirectory()) { walk(f); continue; }
        if (!/\.(js|gs|html|md|txt|yml|yaml|json|toml)$/.test(n)) continue;
        const t = readFileSync(f, "utf8");
        if (/AKfyc[A-Za-z0-9_-]{20,}/.test(t) || /macros\/s\/[A-Za-z0-9_-]{20,}\/exec/.test(t)) bad.push(f.slice(root.length + 1));
      }
    };
    walk(root);
    a.eq(bad.join(", "), "", "a web app id is written in a public file");
  });

  s.test("config.js sends the driver app to the sheet through the live server's /sheet", (a) => {
    const c = readFileSync(join(root, "config.js"), "utf8");
    const live = /liveEndpoint:\s*"([^"]*)"/.exec(c)[1].replace(/\/$/, "");
    a.eq(/endpoint:\s*"([^"]*)"/.exec(c)[1], live + "/sheet");
  });

  s.test("the Apps Script workflow reads the deployment from a secret", (a) => {
    const y = readFileSync(join(root, ".github", "workflows", "apps-script.yml"), "utf8");
    a.has(y, "DEPLOYMENT_ID: ${{ secrets.DEPLOYMENT_ID }}");
  });

  /* ---- the live server's /sheet ------------------------------------------- */

  s.test("a GET goes to the sheet with the same question, and its answer comes back untouched", async (a) => {
    const env = await withSheet();
    G.reply(new Response(JSON.stringify({ ok: true, script: "v1.124.0", rows: [1] }), { status: 200 }));
    const out = await J(await relay(env, "GET", "?rota=1&from=2026-10-18&weeks=4"));
    a.eq(G.calls[0].url, SHEET + "?rota=1&from=2026-10-18&weeks=4");
    a.eq(out.script, "v1.124.0", "the sheet's version was stamped over");
    a.eq(out.rows.length, 1);
  });

  s.test("a POST goes to the sheet as sent, without any sheet password", async (a) => {
    const env = await withSheet();
    G.reply(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const out = await J(await relay(env, "POST", "", { token: "minibusapp", action: "check", check: { id: "c1" }, sheetToken: "guess" }));
    a.ok(out.ok);
    a.eq(G.calls[0].url, SHEET);
    const sent = JSON.parse(G.calls[0].opts.body);
    a.eq(sent.action, "check");
    a.eq(sent.check.id, "c1");
    a.eq(sent.sheetToken, undefined, "a phone's call was given the sheet's password");
  });

  s.test("what only the live server asks the sheet is refused and never sent", async (a) => {
    const env = await withSheet();
    for (const action of ["decision", "report", "pdf", "drainnow"]) {
      const out = await J(await relay(env, "POST", "", { token: "minibusapp", action }));
      a.eq(out.ok, false, action);
    }
    a.eq(G.calls.length, 0, "a refused call reached the sheet");
  });

  s.test("no address, no SHEET_TOKEN, or no answer: ok false, which the app reads as not reached", async (a) => {
    a.eq((await J(await relay(fresh({ SHEET_TOKEN: SECRET }), "GET", "?last=1"))).ok, false);
    a.eq((await J(await relay(await withSheet({ SHEET_TOKEN: "" }), "GET", "?last=1"))).ok, false);
    a.eq(G.calls.length, 0, "it called a sheet address without SHEET_TOKEN set");
    const env = await withSheet();
    G.reply(new Response("<html>sign in</html>", { status: 200 }));
    a.eq((await J(await relay(env, "GET", "?last=1"))).ok, false);
    G.reply(new Response("", { status: 500 }));
    a.eq((await J(await relay(env, "GET", "?last=1"))).ok, false);
  });

  s.test("the status answer names the address only behind the sheet's password", async (a) => {
    const off = fresh();
    await W.cachePut(off, "sheet_url", { url: SHEET }).run();
    a.eq((await J(await W.handleDrain(off, { limit: 1 }))).knockTo, undefined);
    const on = await withSheet();
    a.eq((await J(await W.handleDrain(on, { limit: 1 }))).knockTo, SHEET);
  });

  return s;
}
