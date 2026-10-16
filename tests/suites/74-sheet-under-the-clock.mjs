/* THE COORDINATOR APP'S SHEETS STOP UNDER THE CLOCK, 16 October 2026,
   pages v1.125.0.

   Asim: App info, opened from the Home Screen, reached up under the phone's
   clock and signal while there was room at the bottom. The sheet was allowed
   92vh, and on a Home Screen iPhone the page runs under the status bar, so a
   tall sheet went beneath it. Now the sheet's backdrop keeps the top safe
   area plus 12px clear, and the sheet is never taller than what is left. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";

export default async function (root) {
  const s = new Suite("coordinator sheets stop under the phone's clock");
  const src = readFileSync(join(root, "coord/index.html"), "utf8");
  const rule = (sel) => {
    const m = src.match(new RegExp("\\n" + sel.replace(/\./g, "\\.") + "\\{([^}]*)\\}"));
    return m ? m[1] : "";
  };

  s.test("the sheet's backdrop keeps the top safe area clear", (a) => {
    a.ok(/padding-top:calc\(var\(--safe-t\) \+ 12px\)/.test(rule(".sheet-wrap")), rule(".sheet-wrap"));
  });
  s.test("a sheet is never taller than the room left under the clock", (a) => {
    a.ok(/max-height:min\(92vh,100%\)/.test(rule(".sheet")), rule(".sheet"));
  });
  return s;
}
