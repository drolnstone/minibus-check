/* WHO HEARD ABOUT EMERGENCY CALLS. server w2.54.0 · sheet v1.115.0.

   Asim, 11 Oct 2026: he put Bro Calvin on the calls and the Sent line named
   only the two drivers. One line now names every coordinator and driver
   whose phone took it; a coordinator no phone took it for is emailed by the
   sheet; and Who has alerts on has a Coordinators line.

   The first three fail on w2.52.0; the last on v1.113.0. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { TABS } from "../lib/tabs.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const SUN = "2026-10-11T05:44:00+01:00";
const KEY = "2026-10-11";
const PIN = "1234";

export default async function (root) {
  const s = new Suite("who heard about emergency calls");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  const REGISTER = [
    { name: "Bro Asim", role: "Coordinator", order: 4, route: "North", phone: "447377634214" },
    { name: "Bro Calvin", role: "Assistant Coordinator", order: 0, route: "North", phone: "447399671575" },
    { name: "Pst Kehinde", role: "Minister in Charge", order: 0, route: "South", phone: "447000000001" },
    { name: "Bro Moses", role: "Driver", order: 3, route: "North", phone: "447395626955" },
    { name: "Bro Adesina", role: "Driver", order: 3, route: "South", phone: "447717194643" }];

  async function fresh(phones) {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY, { north: "Bro Moses", south: "Bro Adesina" });
    await db.prepare("DELETE FROM drivers").run();
    for (const d of REGISTER) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
        .bind(d.name, d.role, d.route, d.order, await W.pinHashOf(env, d.name, PIN)).run();
    }
    await W.handleSync(env, { coordinator: { name: "Bro Asim", phone: "07377634214" },
      authRules: { roles: ["Coordinator", "Minister in Charge", "Assistant Coordinator"], sameHandBothWays: true } });
    await W.cachePut(env, "coord_shelf", { builtAt: Date.now(), readAt: Date.now(), requests: [], defects: [],
      drivers: REGISTER.map((d) => Object.assign({ active: true, email: "", hasPin: true }, d)),
      driverRoles: ["Driver", "Coordinator", "Assistant Coordinator", "Minister in Charge"] }).run();
    for (const who of phones) {
      await db.prepare("INSERT INTO push_subs (endpoint, p256dh, auth, role, driver, made) VALUES (?,?,?,?,?,?)")
        .bind("https://push.test/" + who, "p", "a", "driver", who, Date.now()).run();
    }
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const coord = async (env, body, who) => J(await post(env, Object.assign({ action: "coord", who: who || "Bro Asim", pin: PIN }, body)));
  let n = 0;
  const act = (env, a, who) => coord(env, { op: "act", act: Object.assign({ id: "cr-act-" + (++n) }, a) }, who);
  const sentLines = async (env) => (await coord(env, { op: "alerts" })).alerts.list.filter((m) => m.kind === "sent");

  s.test("the Sent line names the coordinators told as well as the drivers", async (a) => {
    await atTime(SUN, async () => {
      const { env } = await fresh(["Bro Asim", "Bro Calvin", "Pst Kehinde", "Bro Moses", "Bro Adesina"]);
      await act(env, { kind: "contact", name: "Bro Calvin", until: "today" });
      const lines = await sentLines(env);
      a.eq(lines.length, 1, JSON.stringify(lines));
      a.eq(lines[0].title, "Emergency calls: Bro Calvin today");
      a.eq(lines[0].body, "To Bro Calvin, Pst Kehinde, Bro Moses, Bro Adesina.");
    });
  });

  s.test("a coordinator no phone took it for is queued for the sheet to email", async (a) => {
    await atTime(SUN, async () => {
      const { db, env } = await fresh(["Bro Asim", "Bro Calvin", "Bro Moses"]);
      await act(env, { kind: "contact", name: "Bro Calvin", until: "today" });
      const q = await db.prepare("SELECT * FROM coord_actions WHERE kind='mail'").all();
      a.eq(q.results.length, 1, "one email for the one coordinator missed");
      const b = JSON.parse(q.results[0].body);
      a.eq(b.names.join(","), "Pst Kehinde", "the maker and a coordinator whose phone took it are not emailed");
      a.eq(b.title, "Emergency calls: Bro Calvin today");
      a.has(q.results[0].words, "Email to Pst Kehinde");
      a.eq((await sentLines(env))[0].body, "To Bro Calvin, Bro Moses.");
    });
  });

  s.test("nobody missed, nothing for the sheet to email", async (a) => {
    await atTime(SUN, async () => {
      const { db, env } = await fresh(["Bro Calvin", "Pst Kehinde"]);
      await act(env, { kind: "contact", name: "Bro Calvin", until: "today" });
      const q = await db.prepare("SELECT 1 FROM coord_actions WHERE kind='mail'").all();
      a.eq(q.results.length, 0);
    });
  });

  s.test("Who has alerts on has a Coordinators line naming anyone with none", async (a) => {
    await atTime(SUN, async () => {
      const { env } = await fresh(["Bro Asim", "Bro Calvin", "Bro Moses"]);
      const r = await coord(env, { op: "report", name: "alerts" });
      const c = r.sections.find((x) => x.head === "Coordinators");
      a.ok(c, JSON.stringify(r.sections));
      a.eq(c.lines.join(" | "), "Alerts on for 2 of 3 coordinators. | No alerts yet: Pst Kehinde.");
    });
  });

  s.test("the sheet emails each one at their Drivers tab address", (a) => {
    const H = TABS["Drivers"];
    const row = (o) => H.map((h) => (h in o ? o[h] : ""));
    const L = loadCodeGs(root, { tabs: { "Drivers": [H,
      row({ Name: "Pst Kehinde", Role: "Minister in Charge", Active: "YES", Route: "South", Email: "k@x.org", Phone: "07000000001" }),
      row({ Name: "Bro Calvin", Role: "Assistant Coordinator", Active: "YES", Route: "North", Email: "", Phone: "07399671575" })] } });
    const ss = L.gas.ss;
    const r = call(L, "applyCoordAction", ss, { id: "contact-x-mail", kind: "mail", sunday: "", by: "Bro Asim", made: Date.now(),
      body: { names: ["Pst Kehinde", "Bro Calvin"], title: "Emergency calls: Bro Calvin today",
              body: "Bro Asim put Bro Calvin on emergency calls until midnight. Bro Calvin · 07399671575." } }, {});
    a.ok(r.done && r.ok, JSON.stringify(r));
    a.eq(r.result, "Emailed Pst Kehinde. Not emailed: Bro Calvin.");
    const m = L.gas.mail.filter((x) => /Emergency calls/.test(x.subject));
    a.eq(m.length, 1);
    a.eq(m[0].to, "k@x.org");
    a.eq(m[0].body, "Emergency calls: Bro Calvin today\nBro Asim put Bro Calvin on emergency calls until midnight. Bro Calvin · 07399671575.");
  });

  return s;
}
