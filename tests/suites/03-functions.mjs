/* EVERY FUNCTION AND CONSTANT IS USED IN CODE, NOT ONLY IN A COMMENT.

   This is not about dead weight. It is about COMMENTS.

   A function nobody calls keeps its comment, and the comment keeps describing
   how the app behaves. Somebody reads it a month later and believes it. That
   is how fuelBand came to be carrying a note saying it was "still used" while
   nothing had called it for two releases, and it is the quietest way for a
   file to start lying about itself.

   So comments are stripped before the scan. A name mentioned ONLY in prose is
   exactly the case this exists to catch, and counting the prose as a use
   would turn the check into a tautology.

   An entry point is not dead: doGet, doPost, onOpen and onEdit are called by
   Google, and the Worker's default export by Cloudflare. Apps Script menu
   items and installed triggers name their function as a STRING, so they are
   found by the scan itself rather than listed here. The list below is
   deliberately tiny — adding to it should feel like a decision. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { topLevelNames as workerNames } from "../lib/worker.mjs";
import { topLevelNames as gsNames } from "../lib/codegs.mjs";

const ENTRY = new Set(["doGet", "doPost", "onOpen", "onEdit", "onChange", "onInstall"]);

/* Good enough for these two files, and honest about what it is: block
   comments go, line comments go unless the // is part of a URL. Strings are
   left alone, which can only ever make the check more forgiving, never less. */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

function declLines(src, name) {
  const re = new RegExp("^(?:export\\s+)?(?:async\\s+)?(?:function\\s+|(?:const|let|var)\\s+)" + name + "\\b", "gm");
  return [...src.matchAll(re)].length;
}

export function usesOutsideDeclaration(code, name) {
  const all = [...code.matchAll(new RegExp("\\b" + name.replace(/[$]/g, "\\$") + "\\b", "g"))].length;
  return all - declLines(code, name);
}

export default function (root) {
  const s = new Suite("every function and constant is used in code, not only in a comment");

  const files = [
    { path: "server/worker.js", names: workerNames },
    { path: "Code.gs", names: gsNames }
  ];

  for (const f of files) {
    const raw = readFileSync(join(root, f.path), "utf8");
    const code = stripComments(raw);
    const names = f.names(raw).filter((n) => !ENTRY.has(n));

    for (const name of names.sort()) {
      s.test(f.path + ": " + name + " is used", (a) => {
        const uses = usesOutsideDeclaration(code, name);
        a.ok(uses > 0,
             name + " is declared in " + f.path + " and never used outside its own declaration — " +
             "it appears in comments only. Wire it up or take it out: an unused name keeps its " +
             "comment, and the comment keeps being believed.");
      });
    }

    s.test(f.path + ": the scanner found a plausible number of names", (a) => {
      a.ok(names.length > 20, "only " + names.length + " top-level names found in " + f.path);
    });
  }

  /* The one the comment above is about, kept by name so the story survives
     whoever inherits this. */
  s.test("fuelBand has not come back", (a) => {
    for (const f of files) {
      const code = stripComments(readFileSync(join(root, f.path), "utf8"));
      a.hasnt(code, "function fuelBand", "fuelBand was removed in v1.70.1 and nothing called it");
    }
  });

  return s;
}
