/* Loads worker.js FOR TESTING WITHOUT EDITING IT.

   The file that ships exports one thing: the fetch handler. Everything else
   is module-private, which is correct for the Worker and useless for a test
   that wants to ask handleAuthorise a direct question.

   So a COPY is made on every run, its top level scanned, and one generated
   export block appended. The copy is thrown away afterwards. The shipped file
   is never touched and never imported from the project folder, which is what
   stops the suite from slowly drifting onto a stale copy the way five of the
   old suites did — they had been testing a w2.0.0 snapshot for weeks and
   passing.

   Scanned rather than listed by hand, so a function added tomorrow is
   testable tomorrow without anybody remembering to add it here. */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DECL = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const CONST = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;
const CLASS = /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/;

export function topLevelNames(src) {
  const names = new Set();
  for (const line of src.split("\n")) {
    /* Column zero only. Anything indented is inside something, and exporting
       a name that is not actually at module scope is a syntax error that
       would fail the whole run rather than one check. */
    if (/^\s/.test(line)) continue;
    const m = DECL.exec(line) || CONST.exec(line) || CLASS.exec(line);
    if (m) names.add(m[1]);
  }
  names.delete("default");
  return [...names];
}

let tmpDir = null;

export async function loadWorker(root) {
  const srcPath = join(root, "server", "worker.js");
  const src = readFileSync(srcPath, "utf8");

  const names = topLevelNames(src).filter((n) => !/^_/.test(n));
  const banner =
    "\n\n/* ---- generated for the test run, not part of the shipped file ---- */\n" +
    "export { " + names.join(", ") + " };\n";

  tmpDir = tmpDir || join(root, "tests", ".build");
  mkdirSync(tmpDir, { recursive: true });
  /* A new name every run so node's module cache cannot hand back the copy
     made before the file was edited. That is the same staleness trap in a
     different coat. */
  const out = join(tmpDir, "worker." + Date.now() + "." + Math.random().toString(36).slice(2) + ".mjs");
  writeFileSync(out, src + banner);

  const mod = await import(pathToFileURL(out).href);
  return { mod, names, src, path: srcPath };
}

export function cleanup(root) {
  try { rmSync(join(root, "tests", ".build"), { recursive: true, force: true }); } catch (e) {}
}

/* ---- the runtime the Worker expects -------------------------------------

   Small enough to write out in full, which is the point: anything the Worker
   reaches for that is not here is a dependency somebody added without
   thinking about the platform, and the test run is where that should be
   noticed. */

/* ONE STUB, HOWEVER MANY SUITES ASK FOR IT.

   This used to hand back a fresh stub every time it was called, and the
   runner builds every suite before it runs any of them — so the LAST suite to
   call this replaced the fetch stub that an earlier suite was already holding
   a handle to. That suite then watched an array nobody was writing to, and
   thirteen checks about passenger messages failed with "expected 1, got 0"
   while the code they were testing was perfectly fine.

   A test harness that can fail the code for its own reasons is worse than no
   harness, because the first instinct on seeing those thirteen is to go and
   change the app. So there is one stub, and everybody gets the same one. */
let installed = null;

export function installGlobals() {
  if (installed) return installed;
  const calls = [];
  const replies = [];

  globalThis.fetch = async function (url, opts) {
    calls.push({ url: String(url), opts: opts || {} });
    const next = replies.shift();
    if (typeof next === "function") return next(url, opts);
    if (next) return next;
    /* The push services are the only thing the Worker calls out to, and a
       test that has not said otherwise means "it worked". */
    return new Response("", { status: 201 });
  };

  if (typeof globalThis.btoa !== "function") {
    globalThis.btoa = (s) => Buffer.from(s, "binary").toString("base64");
  }
  if (typeof globalThis.atob !== "function") {
    globalThis.atob = (s) => Buffer.from(s, "base64").toString("binary");
  }

  installed = {
    calls,
    /* Queue an answer for the next outbound call. */
    reply(r) { replies.push(r); },
    reset() { calls.length = 0; replies.length = 0; }
  };
  return installed;
}

export function env(db, over) {
  return Object.assign({
    DB: db,
    TOKEN: "minibusapp",
    PIN_SALT: "test-pin-salt",
    PHONE_SALT: "test-phone-salt"
  }, over || {});
}
