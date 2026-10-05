/* ALERTS AND EMAILS SAY ONLY PROMPTS AND FACTS.

   From v1.107.0 · w2.47.0 (Asim, 5 October 2026): no explanation, reassurance
   or pleasantry in any push or email. Each phrase below was once sent and
   was taken out; none may come back. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Suite } from "../lib/t.mjs";

const GONE = [
  "Warning only", "stopped until", "Nothing has happened to", "If you can read this",
  "Have a good service", "as soon as it sets off", ". Sorry.", "Every Call button shows them",
  "Nothing is needed from you", "You were emailed because", "Buses can change during the week",
  "none of these people exist", "think about who takes it", "between themselves",
  "nothing to report yet", "That has changed"
];

export default function (root) {
  const s = new Suite("alerts and emails carry only prompts and facts");
  for (const f of ["Code.gs", "server/worker.js"]) {
    s.test(f + " sends none of the old explanations", (a) => {
      const src = readFileSync(join(root, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const g of GONE) a.hasnt(src, g, f + " still says \"" + g + "\"");
    });
  }
  return s;
}
