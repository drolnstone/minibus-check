/* JOBS STILL TO ARRANGE, reminded. 14 November 2026. sheet v1.138.0.

   Asim, after Needs fuel, tyres, a wash and a clean reached the coordinator
   first screen: remind the coordinators of any still open, Wednesdays and
   Fridays from 18:00 London time, by the same road as other alerts. */

import { Suite } from "../lib/t.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { atTime } from "../lib/clock.mjs";

const T = (d, hhmm) => "2026-11-" + d + "T" + hhmm + ":00Z";   /* November: London is UTC */

export default async function (root) {
  const s = new Suite("open jobs reminded Wednesday and Friday");
  const OPEN = {
    "NH56 FWP": { checkId: "c1", date: "2026-11-15", driver: "A", jobs: ["Needs fuel", "Tyres need air"] },
    "YS70 PWE": { checkId: "c2", date: "2026-11-15", driver: "B", jobs: ["Needs a wash"] }
  };
  const at = (when, open) => atTime(when, () => {
    const g = loadCodeGs(root, { props: {} });
    const sent = [];
    g.ctx.jobsOutstanding = () => open;
    g.ctx.safetyAlert = (a) => sent.push(a);
    call(g, "jobsReminder");
    return sent;
  });

  s.test("Wednesday 18:00 lists each bus's open jobs, facts only", async (a) => {
    const sent = await at(T("18", "18:05"), OPEN);
    a.eq(sent.length, 1);
    a.eq(sent[0].title, "Still to arrange");
    a.eq(sent[0].body, "NH56 FWP: Needs fuel, Tyres need air.\nYS70 PWE: Needs a wash.");
    a.eq(sent[0].id, "jobs|2026-11-18");
  });
  s.test("Friday 18:00 too; once a day by its id", async (a) => {
    const sent = await at(T("20", "19:30"), OPEN);
    a.eq(sent.length, 1);
    a.eq(sent[0].id, "jobs|2026-11-20");
  });
  s.test("not before 18:00, not on other days, not with nothing open", async (a) => {
    a.eq((await at(T("18", "17:59"), OPEN)).length, 0);
    a.eq((await at(T("17", "18:30"), OPEN)).length, 0);
    a.eq((await at(T("18", "18:30"), {})).length, 0);
    a.eq((await at(T("18", "18:30"), { "NH56 FWP": { jobs: ["Something else"] } })).length, 0);
  });
  return s;
}
