/* EVERY TAB LOCKED, WITH NO STEP BY HAND. sheet v1.95.1.

   - Set up locks every tab, a tab with only its header row included.
   - A tab that cannot be locked is named in what Set up reports; the rest
     are still locked.
   - A tab made after Set up (the first walkaround, the first sync) is locked
     when it is made, and the nightly pass locks any tab left unlocked.

   Everything here fails on v1.95.0. */

import { Suite } from "../lib/t.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { TABS } from "../lib/tabs.mjs";

const ALL = ["Rota", "Rota Requests", "Defects", "Checks", "Buses", "Bus Bookings",
             "Trip Events", "Bus Stops", "Drivers", "Vehicle Log", "History"];

export default function (root) {
  const s = new Suite("every tab locked, with no step by hand");

  /* Header rows only: the shape of a tab the sheet has just made. */
  function sheet(names) {
    const tabs = {};
    for (const n of names) tabs[n] = [TABS[n]];
    return loadCodeGs(root, { tabs, props: {} });
  }
  const ss = (L) => L.ctx.SpreadsheetApp.getActiveSpreadsheet();
  const locked = (L) => ss(L).getSheets()
    .filter((sh) => (sh.protections || []).some((p) => p.getDescription().indexOf("Minibus lock") === 0))
    .map((sh) => sh.getName()).sort();

  s.test("every tab is locked, a header-only tab included", (a) => {
    const L = sheet(ALL);
    const skipped = call(L, "applyLocks", ss(L));
    a.eq(skipped.length, 0, "skipped: " + skipped.join("; "));
    a.eq(locked(L).join("|"), ALL.slice().sort().join("|"));
    a.eq(call(L, "locksMissing", ss(L)).length, 0);
  });

  s.test("a tab that cannot be locked is named, and the rest are still locked", (a) => {
    const L = sheet(ALL);
    /* The Rota's editable columns are found by heading. Without them its
       lock cannot be worked out. */
    ss(L).getSheetByName("Rota").cells[0] = ["Sunday"];
    const skipped = call(L, "applyLocks", ss(L));
    a.eq(skipped.length, 1);
    a.has(skipped[0], "Rota");
    a.eq(locked(L).length, ALL.length - 1, "one bad tab took the others' locks with it");
  });

  s.test("a tab made after Set up is locked when it is made", (a) => {
    const L = sheet(["Rota", "Drivers"]);
    call(L, "applyLocks", ss(L));
    call(L, "sheet", ss(L), "Defects", TABS["Defects"]);
    a.ok(locked(L).indexOf("Defects") !== -1, "a new Defects tab is not locked");
  });

  s.test("a tab left unlocked is found, and locked again", (a) => {
    const L = sheet(ALL);
    call(L, "applyLocks", ss(L));
    call(L, "removeLocks", ss(L));
    a.eq(call(L, "locksMissing", ss(L)).length, ALL.length);
    call(L, "relockIfNeeded", ss(L));
    a.eq(locked(L).length, ALL.length);
  });

  s.test("Is everything working? says whether every tab is locked", (a) => {
    const L = sheet(ALL);
    const good = [], todo = [];
    call(L, "locksHealth", ss(L), good, todo);
    a.has(todo.join(" "), "Not locked");
    call(L, "applyLocks", ss(L));
    const good2 = [], todo2 = [];
    call(L, "locksHealth", ss(L), good2, todo2);
    a.has(good2.join(" "), "every tab is locked");
    a.eq(todo2.length, 0);
  });

  return s;
}
