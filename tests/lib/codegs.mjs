/* Loads Code.gs into a sandbox with the fake Apps Script services bound.

   Apps Script has no modules: every top level `var` and `function` in Code.gs
   is a property of one global object. So running it in a vm context and then
   reading that context IS the real loading model, not an approximation of it,
   and every function comes out reachable without a line being added to the
   file.

   Read fresh from the project on every call, for the same reason the Worker
   is: a suite that quietly keeps testing the copy it loaded an hour ago is
   worse than no suite. */

import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeGas } from "./gas.mjs";

export function loadCodeGs(root, opts) {
  const path = join(root, "Code.gs");
  const src = readFileSync(path, "utf8");
  const gas = makeGas(opts || {});

  const ctx = vm.createContext(Object.assign({
    console,
    Date, Math, JSON, String, Number, Boolean, Array, Object, RegExp, Error,
    isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    Intl, Map, Set, Promise, Symbol,
    setTimeout, clearTimeout
  }, gas.globals));

  /* filename is given so a syntax error names Code.gs and a line, rather than
     "evalmachine". */
  new vm.Script(src, { filename: path }).runInContext(ctx);

  return { ctx, gas, src, path };
}

/* Convenience: call a Code.gs function by name with the sandbox's own
   globals, so `this` and every service resolve the way they do in Apps
   Script. */
export function call(loaded, name, ...args) {
  const fn = loaded.ctx[name];
  if (typeof fn !== "function") throw new Error("Code.gs has no function called " + name);
  return fn.apply(loaded.ctx, args);
}

export function topLevelNames(src) {
  const names = new Set();
  for (const line of src.split("\n")) {
    if (/^\s/.test(line)) continue;
    let m = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line);
    if (!m) m = /^(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line);
    if (m) names.add(m[1]);
  }
  return [...names];
}
