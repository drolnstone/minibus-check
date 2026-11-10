/* THE SERVER WATCHED ALL WEEK, and drivers with alerts off. 10 November 2026.
   server w2.88.0 · sheet v1.135.0.

   Asim forwarded the Ushers app's "the server has stopped" and "running
   again" emails. The sheet now judges the live server on every sync, all
   week, from what the last drain brought back, and emails the owner once
   when it stops and once when it is back. The health report names active
   drivers with alerts on no phone, and the sheet emails them on Mondays. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab } from "../lib/tabs.mjs";
import { atTime } from "../lib/clock.mjs";

const T = (d, hhmm) => "2026-11-" + d + "T" + hhmm + ":00Z";   /* November: London is UTC */

export default async function (root) {
  const s = new Suite("server watched all week; alerts off");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  /* One sync at each time, carrying the properties forward like the sheet. */
  const run = (steps) => {
    let props = { OWNER_EMAIL: "owner@test" };
    const mail = [];
    return steps.reduce((p, st) => p.then(() => atTime(st.at, () => {
      if (st.seen !== undefined) props.workerSeen = st.seen === null ? undefined :
        JSON.stringify({ at: Date.parse(st.seen.at), clockAgo: st.seen.clockAgo });
      if (props.workerSeen === undefined) delete props.workerSeen;
      const g = loadCodeGs(root, { props });
      call(g, "watchServer");
      props = Object.assign({}, g.gas.props);
      mail.push(...g.gas.mail);
    })), Promise.resolve()).then(() => mail);
  };

  s.test("stops, emails once; back, emails once", async (a) => {
    const mail = await run([
      { at: T("09", "18:00"), seen: { at: T("09", "18:00"), clockAgo: 20 } },
      { at: T("09", "18:10") },
      { at: T("09", "18:20") },                       /* 20 min since it answered */
      { at: T("09", "18:25") },
      { at: T("09", "19:15"), seen: { at: T("09", "19:15"), clockAgo: 30 } },
      { at: T("09", "19:20") , seen: { at: T("09", "19:20"), clockAgo: 30 } }
    ]);
    a.eq(mail.length, 2, JSON.stringify(mail.map((m) => m.subject)));
    a.eq(mail[0].subject, "Minibus: the server has stopped");
    a.ok(/has not answered since 18:00, Mon 9 Nov\.\nReminders and alerts are not going out\./.test(mail[0].body), mail[0].body);
    a.eq(mail[0].to, "owner@test");
    a.eq(mail[1].subject, "Minibus: the server is running again");
    a.eq(mail[1].body, "The server's clock is running.");
  });

  s.test("answers but its clock has stopped", async (a) => {
    const mail = await run([{ at: T("10", "03:00"), seen: { at: T("10", "03:00"), clockAgo: 40 * 60 } }]);
    a.eq(mail.length, 1);
    a.ok(/clock last ran at 02:20, Tue 10 Nov\./.test(mail[0].body), mail[0].body);
  });

  s.test("a short gap and a ticking clock send nothing", async (a) => {
    const mail = await run([
      { at: T("10", "10:00"), seen: { at: T("10", "10:00"), clockAgo: 30 } },
      { at: T("10", "10:10") },
      { at: T("10", "10:12"), seen: { at: T("10", "10:12"), clockAgo: 50 } }
    ]);
    a.eq(mail.length, 0, JSON.stringify(mail));
  });

  s.test("never answered: judged from when the watch began", async (a) => {
    const mail = await run([{ at: T("10", "10:00"), seen: null }, { at: T("10", "10:10") }, { at: T("10", "10:20") }]);
    a.eq(mail.length, 1);
    a.ok(/not answered since 10:00, Tue 10 Nov/.test(mail[0].body), mail[0].body);
  });

  s.test("the drain records when the server answered and its clock", async (a) => {
    await atTime(T("10", "12:00"), () => {
      const g = loadCodeGs(root, { props: {} });
      g.gas.setFetchReply({ code: 200, body: JSON.stringify({ ok: true, rows: [], clockAgoSec: 42 }) });
      try { call(g, "drainFromWorker"); } catch (e) {}
      const w = JSON.parse(g.gas.props.workerSeen || "null");
      a.ok(w && w.clockAgo === 42 && w.at === Date.parse(T("10", "12:00")), JSON.stringify(w));
    });
  });

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    for (const [n, act] of [["Bro Arthur", 1], ["Bro Trevor", 1], ["Sis Ama", 1], ["Bro Gone", 0]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,?,'')")
        .bind(n, "Driver", "North", 1, act).run();
    }
    await db.prepare("INSERT INTO push_subs (endpoint, p256dh, auth, role, driver, made) VALUES (?,?,?,?,?,?)")
      .bind("https://push.test/a", "p", "a", "driver", "Bro Arthur", Date.now()).run();
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});

  s.test("the live server names active drivers with alerts on no phone", async (a) => {
    const { env } = await fresh();
    const out = await J(await post(env, { action: "unalerted" }));
    a.ok(out.ok, JSON.stringify(out));
    a.eq(out.names.join("|"), "Bro Trevor|Sis Ama");
  });

  s.test("Mondays from 18:00, one email to each who has an Email", async (a) => {
    const drivers = tab("Drivers", [
      { Name: "Bro Trevor", Role: "Driver", Active: "YES", "Primary order": 1, Email: "t@test", Route: "North", Phone: "07700 900001" },
      { Name: "Sis Ama", Role: "Driver", Active: "YES", "Primary order": 2, Email: "", Route: "South", Phone: "07700 900002" },
      { Name: "Bro Arthur", Role: "Driver", Active: "YES", "Primary order": 3, Email: "a@test", Route: "South", Phone: "07700 900003" }]);
    const at = (when, props) => atTime(when, () => {
      const g = loadCodeGs(root, { tabs: { "Drivers": drivers }, props: Object.assign({}, props || {}) });
      g.gas.setFetchReply({ code: 200, body: JSON.stringify({ ok: true, names: ["Bro Trevor", "Sis Ama"] }) });
      call(g, "alertsNudge");
      call(g, "alertsNudge");
      return g.gas;
    });
    let g = await at(T("09", "18:05"));
    a.eq(g.mail.length, 1, JSON.stringify(g.mail));
    a.eq(g.mail[0].to, "t@test");
    a.eq(g.mail[0].subject, "Minibus: alerts are off");
    a.ok(/^Alerts are on no phone of yours in the Driver app\.\nDriver app: https:/.test(g.mail[0].body), g.mail[0].body);
    a.eq((await at(T("09", "17:55"))).mail.length, 0, "before 18:00");
    a.eq((await at(T("10", "18:05"))).mail.length, 0, "on a Tuesday");
    a.eq((await at(T("09", "18:05"), { alertsNudgeDay: "2026-11-09" })).mail.length, 0, "twice that day");
  });

  return s;
}
