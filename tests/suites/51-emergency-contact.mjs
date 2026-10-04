/* WHO TAKES EMERGENCY CALLS, CHOSEN IN THE COORDINATOR'S APP. pages v1.96.8 ·
   server w2.41.0.

   After the Ushers app's Settings: a coordinator away for a Sunday picks
   somebody else, and every answer the live server gives carries that person
   as the one to ring, until the choice runs out. Today only runs out at
   midnight London time; Until changed back stays. A push from the sheet
   does not undo it, and putting it back returns the Drivers tab's answer.

   Everything here fails on w2.40.0. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const SUN = "2026-10-04T06:15:00+01:00";
const KEY = "2026-10-04";
const PIN = "1234";
const ASIM = { name: "Bro Asim", phone: "07377634214" };

export default async function (root) {
  const s = new Suite("who takes emergency calls, from the coordinator's app");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  const REGISTER = [
    { name: "Bro Asim", role: "Coordinator", active: true, order: 4, route: "North", email: "a@x.org", phone: "447377634214", hasPin: true },
    { name: "Bro Calvin", role: "Assistant Coordinator", active: true, order: 0, route: "North", email: "c@x.org", phone: "447399671575", hasPin: true },
    { name: "Bro Moses", role: "Driver", active: true, order: 3, route: "North", email: "", phone: "447395626955", hasPin: true },
    { name: "Bro Gone", role: "Coordinator", active: false, order: 0, route: "North", email: "", phone: "07000000000", hasPin: true },
    { name: "Pst Nophone", role: "Minister in Charge", active: true, order: 0, route: "North", email: "", phone: "", hasPin: false }];

  async function fresh() {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, KEY);
    await db.prepare("DELETE FROM drivers").run();
    for (const d of REGISTER) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,?,?)")
        .bind(d.name, d.role, d.route, d.order, d.active ? 1 : 0, await W.pinHashOf(env, d.name, PIN)).run();
    }
    await W.handleSync(env, { coordinator: ASIM,
      authRules: { roles: ["Coordinator", "Minister in Charge", "Assistant Coordinator"], sameHandBothWays: true } });
    await W.cachePut(env, "coord_shelf", { builtAt: Date.now(), readAt: Date.now(), requests: [], defects: [],
      drivers: REGISTER.map((d) => Object.assign({}, d)), driverRoles: ["Driver", "Coordinator", "Assistant Coordinator", "Minister in Charge"] }).run();
    /* The choice is held in the module as well, as the live isolate holds
       it, so each check starts from the usual person. */
    await act(env, { kind: "contact", clear: true });
    return { db, env };
  }
  const post = (env, body) => W.default.fetch(new Request("https://worker.test/", {
    method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp" }, body)) }), env, {});
  const coord = async (env, body, who) => J(await post(env, Object.assign({ action: "coord", who: who || "Bro Asim", pin: PIN }, body)));
  let n = 0;
  const act = (env, a, who) => coord(env, { op: "act", act: Object.assign({ id: "ct-act-" + (++n) }, a) }, who);
  const ringing = async (env) => (await J(await W.default.fetch(new Request("https://worker.test/?rota=1&weeks=1"), env, {}))).coordinator;

  s.test("the coordinator's app is told who takes the calls and who may be picked", async (a) => {
    await atTime(SUN, async () => {
      const { env } = await fresh();
      const out = await coord(env, { op: "load" });
      a.ok(out.contact, "no contact on the load");
      a.eq(out.contact.usual.name, "Bro Asim");
      a.eq(out.contact.chosen, null);
      a.eq(out.contact.can.map((x) => x.name).join(","), "Bro Asim,Bro Calvin",
           "a driver, an inactive coordinator and a coordinator with no phone are not offered");
      a.eq(out.contact.can[1].phone, "07399671575", "the number is tidied to the 07 form the pages dial");
    });
  });

  s.test("today only: every answer says ring Bro Calvin, until midnight London time", async (a) => {
    const { db, env } = await fresh();
    await atTime(SUN, async () => {
      const out = await act(env, { kind: "contact", name: "bro calvin", until: "today" });
      a.ok(out.ok, JSON.stringify(out));
      a.has(out.action.words, "Bro Calvin");
      a.eq(out.action.state, "done", "a change on the live server alone is done as it is made");
      const c = await ringing(env);
      a.eq(c.name, "Bro Calvin");
      a.eq(c.phone, "07399671575");
      a.eq((await coord(env, { op: "load" })).contact.chosen.by, "Bro Asim", "who made the choice is kept");
      const row = db._one("SELECT synced, ok FROM coord_actions WHERE kind='contact' ORDER BY seq DESC LIMIT 1");
      a.eq(Number(row.synced), 1, "never offered to the sheet, which has nothing to file");
    });
    await atTime("2026-10-04T23:59:00+01:00", async () => { a.eq((await ringing(env)).name, "Bro Calvin", "still him a minute before midnight"); });
    await atTime("2026-10-05T00:00:30+01:00", async () => { a.eq((await ringing(env)).name, "Bro Asim", "back to the usual person after midnight, by itself"); });
  });

  s.test("a push from the sheet does not undo the choice, and stays underneath it", async (a) => {
    const { env } = await fresh();
    await atTime(SUN, async () => {
      await act(env, { kind: "contact", name: "Bro Calvin", until: "changed" });
      await W.handleSync(env, { coordinator: ASIM });
      a.eq((await ringing(env)).name, "Bro Calvin");
      const back = await act(env, { kind: "contact", clear: true });
      a.ok(back.ok);
      a.has(back.action.words, "Bro Asim");
      a.eq((await ringing(env)).name, "Bro Asim");
    });
    await atTime("2026-10-11T08:00:00+01:00", async () => { a.eq((await ringing(env)).name, "Bro Asim"); });
  });

  s.test("until changed back lasts past midnight", async (a) => {
    const { env } = await fresh();
    await atTime(SUN, async () => { await act(env, { kind: "contact", name: "Bro Calvin", until: "changed" }); });
    await atTime("2026-10-11T08:00:00+01:00", async () => { a.eq((await ringing(env)).name, "Bro Calvin"); });
  });

  s.test("only somebody who could take the calls can be picked", async (a) => {
    await atTime(SUN, async () => {
      const { env } = await fresh();
      a.not((await act(env, { kind: "contact", name: "Bro Moses", until: "today" })).ok, "a driver");
      a.not((await act(env, { kind: "contact", name: "Bro Gone", until: "today" })).ok, "not active");
      a.not((await act(env, { kind: "contact", name: "Pst Nophone", until: "today" })).ok, "no phone");
      a.not((await act(env, { kind: "contact", name: "Bro Calvin", until: "forever" })).ok, "an unknown length");
      a.not((await act(env, { kind: "contact", name: "Bro Calvin", until: "today" }, "Bro Moses")).ok, "a driver cannot sign in to choose");
      a.eq((await ringing(env)).name, "Bro Asim", "nothing refused changed anything");
    });
  });

  s.test("the coordinator's app has the chooser on its first screen", async (a) => {
    const { readFileSync } = await import("node:fs");
    const html = readFileSync(join(root, "coord", "index.html"), "utf8");
    a.has(html, "function contactHtml()");
    a.has(html, 'data-do="contact"');
    a.has(html, 'kind: "contact"');
  });

  return s;
}
