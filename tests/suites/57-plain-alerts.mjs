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
  "nothing to report yet", "That has changed", "Sent by the minibus app",
  "Nothing is lost by this", "Correct it in the coordinator app",
  /* 11 Oct 2026 (Asim): facts only, no advice or instructions. */
  "Ring the coordinator", "ring the coordinator", "Please have", "Tap to pick your stop",
  "Tap to change or cancel", "Tap Start as you pull away", "Still there? Open the page",
  "Check the app on the day", "Open the app to see who", "Tap the bell to get alerts",
  "Authorise it or arrange", "Arrange a second trip", "Swap the buses", "Record it in the coordinator app",
  "Record the new", "Move a bus or a booking", "Type it like", "Refresh and try again",
  "Correct the correction", "Ask for the current one", "Turn alerts off and on again"
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
