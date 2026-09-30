/* WHO PEOPLE RING, FROM THE DRIVERS TAB AND NOWHERE ELSE.

   Until v1.80.0 the coordinator's name and number were typed into config.js
   and again into the passenger page, and the register and North rota order
   were typed into config.js, Code.gs and the driver app as well. From v1.80.0
   (pages), w2.21.0 (Worker) and v1.85.0 (sheet) the coordinator is the row
   with Role Coordinator on the Drivers tab, its Phone column is the number,
   the sheet sends it on every push, and the Worker stamps it on every answer.

   Every check here fails on w2.20.1 / v1.84.1 / v1.79.1. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab } from "../lib/tabs.mjs";

const ADELE = { name: "Sis Adele", phone: "07700900123" };

function tabs(drivers) {
  return {
    "Bus Stops": tab("Bus Stops", [
      { Route: "North", "Stop ID": "N00", Time: "09:52", Stop: "Church", Active: "YES", Type: "Depart" }]),
    "Drivers": tab("Drivers", drivers),
    "Buses": tab("Buses", [{ Registration: "YS70 PWE", "Seats for passengers": 16, Active: "YES" }]),
    "Rota": [["Date"]],
    "Checks": [["When"]],
    "Defects": [["When"]],
    "Bus Bookings": [["Received"]],
    "Trip Events": [["Logged"]],
    "Rota Requests": [["When"]]
  };
}

const PEOPLE = [
  { Name: "Bro Old", Role: "Coordinator", Active: "NO", Phone: "07000 000000", Email: "old@b.c" },
  { Name: "Bro First", Role: "Coordinator", Active: "YES", Phone: "07111 111111", Email: "first@b.c" },
  { Name: "Sis Adele", Role: "Coordinator", Active: "YES", Phone: "07700 900123", Email: "adele@b.c" },
  { Name: "Bro Driver", Role: "Driver", Active: "YES", "Primary order": 1, Route: "North", Phone: "07222 222222" }
];

export default async function (root) {
  const s = new Suite("who people ring comes from the Drivers tab");
  const G = installGlobals();
  const J = async (r) => JSON.parse(await r.text());

  /* ---- the sheet ------------------------------------------------------- */

  const sheet = (drivers, email) => loadCodeGs(root, { tabs: tabs(drivers),
    props: { COORDINATOR_EMAIL: email || "", PIN_SALT: "salt", WORKER_URL: "https://example.invalid" } });
  const contact = (L) => call(L, "coordinatorContact", call(L, "readDrivers", L.ctx.SpreadsheetApp.getActive()));

  s.test("the coordinator is the active row with Role Coordinator, and its Phone", (a) => {
    const c = contact(sheet(PEOPLE));
    a.eq(c.name, "Bro First", "the first active coordinator, and never the inactive one above him");
    a.eq(c.phone, "07111111111");
  });

  s.test("with two, the one COORDINATOR_EMAIL names is the one people ring", (a) => {
    const c = contact(sheet(PEOPLE, "ADELE@b.c"));
    a.eq(c.name, "Sis Adele");
    a.eq(c.phone, "07700900123");
  });

  s.test("nobody with the role is a blank answer, not somebody else", (a) => {
    const c = contact(sheet([PEOPLE[3]]));
    a.eq(c.name, "");
    a.eq(c.phone, "");
  });

  const MIC = { Name: "Pst Top", Role: "Minister in Charge", Active: "YES", Phone: "07333 333333", Email: "pst@b.c" };

  s.test("the Coordinator comes before the Minister in Charge, whoever is higher on the tab", (a) => {
    a.eq(contact(sheet([MIC].concat(PEOPLE))).name, "Bro First");
  });

  s.test("with no Coordinator, the Minister in Charge is who people ring", (a) => {
    const c = contact(sheet([MIC, PEOPLE[3]]));
    a.eq(c.name, "Pst Top");
    a.eq(c.phone, "07333333333");
  });

  s.test("COORDINATOR_EMAIL wins across every role in the list", (a) => {
    a.eq(contact(sheet([MIC].concat(PEOPLE), "pst@b.c")).name, "Pst Top");
  });

  s.test("a church's own titles work once AUTHORISER_ROLES says them", (a) => {
    const L = sheet([{ Name: "Sis Lead", Role: "Transport Lead", Active: "YES", Phone: "07444 444444" },
                     PEOPLE[3]]);
    a.eq(contact(L).name, "", "a title not in the list must not be picked");
    L.ctx.AUTHORISER_ROLES = ["Transport Lead", "Pastor"];
    a.eq(contact(L).name, "Sis Lead");
  });

  /* ---- the titles, as a setting --------------------------------------- */

  const withRoles = (drivers, roles) => loadCodeGs(root, { tabs: tabs(drivers),
    props: Object.assign({ PIN_SALT: "salt", WORKER_URL: "https://example.invalid" },
                         roles === undefined ? {} : { COORDINATOR_ROLES: roles }) });

  s.test("COORDINATOR_ROLES in Script Properties sets the titles, in its own order", (a) => {
    const L = withRoles([PEOPLE[3]], " Transport Lead ,Pastor,, ");
    a.eq(JSON.stringify(L.ctx.AUTHORISER_ROLES), JSON.stringify(["Transport Lead", "Pastor"]));
    a.ok(call(L, "hasRolesProperty"));
  });

  s.test("blank or missing, the default titles are used", (a) => {
    for (const v of [undefined, "", " , "]) {
      const L = withRoles([PEOPLE[3]], v);
      a.eq(JSON.stringify(L.ctx.AUTHORISER_ROLES), JSON.stringify(["Coordinator", "Minister in Charge"]));
    }
    a.not(call(withRoles([PEOPLE[3]]), "hasRolesProperty"));
  });

  s.test("with the setting changed, who to ring follows it, and the push carries it", (a) => {
    const L = withRoles([{ Name: "Sis Lead", Role: "Transport Lead", Active: "YES", Phone: "07444 444444" }, PEOPLE[2]],
                        "Transport Lead");
    a.eq(contact(L).name, "Sis Lead");
    call(L, "pushToWorker");
    const sync = L.gas.fetched.map((f) => { try { return JSON.parse(f.opts.payload); } catch (e) { return null; } })
      .filter((b) => b && b.action === "sync")[0];
    a.eq(JSON.stringify(sync.authRules.roles), JSON.stringify(["Transport Lead"]));
    a.eq(JSON.stringify(call(L, "rotaPayload", "2026-10-04", 1).leadRoles), JSON.stringify(["Transport Lead"]));
  });

  s.test("the live server stamps the sheet's titles on every answer, and a cold isolate still knows them", async (a) => {
    const { W, env } = await fresh();
    await W.handleSync(env, { authRules: { roles: ["Transport Lead", "Pastor"], sameHandBothWays: true } });
    a.eq(JSON.stringify((await J(await ask(W, env))).leadRoles), JSON.stringify(["Transport Lead", "Pastor"]));
    const { mod: W2 } = await loadWorker(root);
    a.eq(JSON.stringify((await J(await ask(W2, env))).leadRoles), JSON.stringify(["Transport Lead", "Pastor"]));
  });

  s.test("before any sheet has sent titles, no answer carries any", async (a) => {
    const { W, env } = await fresh();
    a.eq((await J(await ask(W, env))).leadRoles, undefined);
  });

  s.test("a number Sheets has turned into 447... is sent as 07..., so the call button dials", (a) => {
    const rows = PEOPLE.map((r) => Object.assign({}, r));
    rows[1].Phone = 447111111111;
    rows[2].Phone = "+44 7700 900123";
    a.eq(contact(sheet(rows)).phone, "07111111111");
    a.eq(contact(sheet(rows, "adele@b.c")).phone, "07700900123");
  });

  s.test("the push to the live server carries it", (a) => {
    const L = sheet(PEOPLE, "adele@b.c");
    call(L, "pushToWorker");
    const sync = L.gas.fetched.map((f) => { try { return JSON.parse(f.opts.payload); } catch (e) { return null; } })
      .filter((b) => b && b.action === "sync")[0];
    a.ok(sync, "no sync was sent");
    a.eq(JSON.stringify(sync.coordinator), JSON.stringify(ADELE));
  });

  s.test("the rota the sheet answers the driver app with carries it too", (a) => {
    const L = sheet(PEOPLE, "adele@b.c");
    const out = call(L, "rotaPayload", "2026-10-04", 1);
    a.eq(JSON.stringify(out.coordinator), JSON.stringify(ADELE));
  });

  s.test("a new church's Drivers tab starts empty", (a) => {
    const L = sheet(PEOPLE);
    a.eq(L.ctx.SEED_DRIVERS.length, 0, "SEED_DRIVERS still names people");
  });

  /* ---- the live server ------------------------------------------------- */

  async function fresh() {
    G.reset();
    const { mod: W } = await loadWorker(root);     /* a cold isolate each time */
    const db = makeDB(join(root, "server", "schema.sql"));
    return { W, db, env: makeEnv(db) };
  }
  const ask = (W, env) => W.default.fetch(new Request("https://worker.test/?rota=1&weeks=1"), env, {});

  s.test("a sync that carries it is stamped on every answer after it", async (a) => {
    const { W, env } = await fresh();
    await W.handleSync(env, { coordinator: ADELE });
    a.eq(JSON.stringify((await J(await ask(W, env))).coordinator), JSON.stringify(ADELE));
    a.eq(JSON.stringify(await W.cacheGet(env, "coordinator")), JSON.stringify(ADELE), "not kept in settings");
  });

  s.test("a cold isolate reads it back from settings", async (a) => {
    const one = await fresh();
    await one.W.handleSync(one.env, { coordinator: ADELE });
    const { mod: W2 } = await loadWorker(root);
    a.eq(JSON.stringify((await J(await ask(W2, one.env))).coordinator), JSON.stringify(ADELE));
  });

  s.test("a sync from an older sheet that does not send it leaves it alone", async (a) => {
    const { W, env } = await fresh();
    await W.handleSync(env, { coordinator: ADELE });
    await W.handleSync(env, {});
    a.eq(JSON.stringify(await W.cacheGet(env, "coordinator")), JSON.stringify(ADELE));
  });

  s.test("nobody in the role is told as a blank name, so the pages say 'the bus coordinator'", async (a) => {
    const { W, env } = await fresh();
    await W.handleSync(env, { coordinator: ADELE });
    await W.handleSync(env, { coordinator: { name: "", phone: "" } });
    const out = await J(await ask(W, env));
    a.eq(out.coordinator.name, "");
    a.eq(out.coordinator.phone, "");
  });

  s.test("before any sheet has sent one, no answer invents one", async (a) => {
    const { W, env } = await fresh();
    a.eq((await J(await ask(W, env))).coordinator, undefined);
  });

  /* ---- the files ------------------------------------------------------- */

  s.test("config.js names nobody", (a) => {
    const box = { window: {} };
    vm.runInNewContext(readFileSync(join(root, "config.js"), "utf8"), box);
    const C = box.window.CONFIG;
    a.eq(C.coordinator, undefined, "config.js still has a coordinator");
    a.eq((C.drivers || []).length, 0, "config.js still has a driver register");
    a.eq((C.rotaPrimaryPattern || []).length, 0, "config.js still has a North rota order");
    a.eq((C.rotaSecondaryPattern || []).length, 0, "config.js still has a South rota order");
  });

  s.test("the passenger page types no coordinator of its own", (a) => {
    const src = readFileSync(join(root, "sunday", "index.html"), "utf8");
    a.ok(/var COORDINATOR = \{ name: "", phone: "" \};/.test(src), "COORDINATOR is typed in");
  });

  s.test("the driver app types no North rota order of its own", (a) => {
    const src = readFileSync(join(root, "index.html"), "utf8");
    a.ok(/var ROTA_PRIMARY_PATTERN = \(CFG\.rotaPrimaryPattern \|\| \[\]\)\.slice\(\);/.test(src));
    a.not(/CFG\.coordinator/.test(src), "the driver app still reads coordinator from config.js");
  });

  return s;
}
