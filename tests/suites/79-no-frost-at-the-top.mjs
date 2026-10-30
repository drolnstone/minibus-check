/* NO FROST AT THE TOP, 30 October 2026, pages v1.138.0.

   Asim: a fog across the top of the coordinator app, over the clock and the
   bar, and in the driver and passenger apps too. iOS 26 frosts the strip under
   the clock, and about 40px below it, in a Home Screen app that draws its page
   under the status bar (black-translucent). All three apps now keep the status
   bar apart ("default", as the passenger page already did), and a phone still
   on an older install keeps its bar 40px clear of the frost. v1.139.0: iOS
   still softens the top edge with the plain status bar, so a Home Screen
   iPhone keeps 16px more at the top. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";

export default async function (root) {
  const s = new Suite("no frost at the top of the apps");
  for (const f of ["index.html", "coord/index.html", "sunday/index.html"]) {
    const src = readFileSync(join(root, f), "utf8");
    s.test(f + ": the status bar sits apart from the page", (a) => {
      a.ok(/<meta name="apple-mobile-web-app-status-bar-style" content="default">/.test(src));
      a.ok(src.indexOf("black-translucent") === -1);
    });
    s.test(f + ": an older install keeps the top 40px clear of the frost", (a) => {
      a.ok(src.indexOf("--safe-t:calc(env(safe-area-inset-top,0px) + min(env(safe-area-inset-top,0px), 40px) + var(--edge,0px));") !== -1);
    });
    s.test(f + ": a Home Screen iPhone keeps 16px clear of the soft top edge, nothing elsewhere", (a) => {
      a.ok(/@supports \(-webkit-touch-callout:none\)\{\n  @media all and \(display-mode:standalone\)\{ :root\{--edge:16px\} \}/.test(src));
    });
  }
  return s;
}
