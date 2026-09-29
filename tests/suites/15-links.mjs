/* A DECISION MADE FROM AN EMAIL.

   Two things in the coordinator's inbox now carry a link: a bus stopped by a
   critical defect, and a driver asking to swap. Both were decisions he could
   already make; both were costing him a laptop.

   THE WHOLE SUITE IS REALLY ABOUT ONE PROPERTY. A link that ACTS when it is
   opened is acted on by whatever opens it, and mail providers, phone previews
   and corporate gateways all open links before a person does. So the first
   thing tested here, and the thing to be most suspicious of in any future
   change, is that LOOKING CHANGES NOTHING. Only the PIN acts.

   The second is that a link is good once and not for ever. A mailbox is a
   filing cabinet people keep for years. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";

const REG = "YS70 PWE";

export default async function (root) {
  const s = new Suite("deciding from an email");
  const { mod: W } = await loadWorker(root);
  installGlobals();
  const body = async (r) => JSON.parse(await r.text());

  async function fresh(rules) {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    const key = W.runSunday();
    await seedSunday(db, key);
    /* THE ORDINARY DRIVER HAS A PIN OF HIS OWN, and that matters now. The
       link accepts ANY coordinator's PIN, so a fixture where everybody shares
       1234 could not tell "Bro Tunde is not allowed" from "1234 happens to be
       a coordinator's". His is 9876 and nobody else's. */
    for (const d of [["Bro Asim", "Coordinator", "1234"],
                     ["Bro Tunde", "Driver", "9876"],
                     ["Pst Kehinde", "Minister in Charge", "4321"]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind(d[0], d[1], "North", await W.pinHashOf(env, d[0], d[2])).run();
    }
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,'')")
      .bind("Bro Calvin", "Coordinator", "North").run();
    await W.cachePut(env, "auth_rules",
      { roles: ["coordinator", "minister in charge"], sameHandBothWays: true }).run();
    if (rules) await W.cachePut(env, "link_rules", rules).run();
    return { db, env, key };
  }

  const stopTheBus = (env, id) => W.handleCheck(env, {
    id: id || "chk-1", reg: REG, level: "stop", driver: "Bro Tunde", age: 0
  });

  async function mint(env, kind, subject) {
    const out = await body(await W.handleMintLink(env, { link: { kind, subject } }));
    return out;
  }

  const busLink = (env, over) => mint(env, "authorise",
    Object.assign({ reg: REG, checkId: "chk-1", inspector: "Bro Tunde", to: "Bro Asim" }, over || {}));

  const rotaLink = (env, over) => mint(env, "rota",
    Object.assign({ id: "REQ-9", sunday: "2026-10-04", driver: "Bro Tunde",
                    type: "Cover", to: "Bro Asim" }, over || {}));

  /* ---- minting ---------------------------------------------------------- */

  s.test("a link is 128 bits of hex and not a guessable string", async (a) => {
    const { env } = await fresh();
    const out = await busLink(env);
    a.ok(out.ok, JSON.stringify(out));
    a.ok(/^[0-9a-f]{32}$/.test(out.token), "got " + out.token);
  });

  s.test("two links are never the same link", async (a) => {
    const { env } = await fresh();
    const seen = new Set();
    for (let i = 0; i < 25; i++) seen.add((await busLink(env)).token);
    a.eq(seen.size, 25);
  });

  s.test("a kind nobody has heard of is refused", async (a) => {
    const { env } = await fresh();
    const out = await body(await W.handleMintLink(env, { link: { kind: "delete-everything" } }));
    a.not(out.ok);
    a.eq(out.error, "kind");
  });

  s.test("turning links off stops them being made at all", async (a) => {
    const { env } = await fresh({ on: false, ttlMinutes: 60 });
    const out = await body(await W.handleMintLink(env, { link: { kind: "authorise", subject: {} } }));
    a.not(out.ok);
    a.eq(out.error, "off", "and the email falls back to \"open the spreadsheet\"");
  });

  /* ---- LOOKING CHANGES NOTHING ------------------------------------------ */

  s.test("a mail scanner opening the link fifty times decides nothing", async (a) => {
    const { db, env } = await fresh();
    await stopTheBus(env);
    const { token } = await busLink(env);

    for (let i = 0; i < 50; i++) {
      const out = await body(await W.handleLinkWhat(env, { token }));
      a.ok(out.ok);
      a.not(out.used, "looking must never use a link up");
    }
    a.eq((await W.checksToday(env))[REG].state, "stopped",
         "fifty previews, and the bus is still off the road");
    a.eq(db._one("SELECT * FROM links WHERE token=?", token).used, 0);
  });

  s.test("looking tells you only what the email already said", async (a) => {
    const { env } = await fresh();
    await stopTheBus(env);
    const { token } = await busLink(env);
    const out = await body(await W.handleLinkWhat(env, { token }));
    const flat = JSON.stringify(out);
    a.hasnt(flat, "pin_hash", "nothing about anybody's PIN");
    a.hasnt(flat, "1234");
    a.has(flat, REG, "and it does say which bus, because the email did");
  });

  s.test("a token that is not a token is refused without touching anything", async (a) => {
    const { env } = await fresh();
    for (const t of ["", "nope", "../../etc/passwd", "0".repeat(31), "g".repeat(32)]) {
      const out = await body(await W.handleLinkWhat(env, { token: t }));
      a.not(out.ok, "accepted " + JSON.stringify(t));
    }
  });

  s.test("a link nobody minted is not a link", async (a) => {
    const { env } = await fresh();
    const out = await body(await W.handleLinkWhat(env, { token: "a".repeat(32) }));
    a.not(out.ok);
    a.eq(out.error, "no link");
  });

  /* ---- the PIN is the only thing that acts ------------------------------ */

  s.test("the right PIN authorises the bus", async (a) => {
    const { env } = await fresh();
    await stopTheBus(env);
    const { token } = await busLink(env);
    const out = await body(await W.handleLinkDo(env, { token, pin: "1234", choice: "run" }));
    a.ok(out.ok, JSON.stringify(out));
    a.eq(out.by, "Bro Asim");
    a.eq((await W.checksToday(env))[REG].state, "authorised");
  });

  s.test("no PIN, no decision", async (a) => {
    const { env } = await fresh();
    await stopTheBus(env);
    const { token } = await busLink(env);
    const out = await body(await W.handleLinkDo(env, { token, pin: "", choice: "run" }));
    a.not(out.ok);
    a.eq((await W.checksToday(env))[REG].state, "stopped");
  });

  s.test("three wrong PINs lock the link, and the bus stays stopped", async (a) => {
    const { env } = await fresh();
    await stopTheBus(env);
    const { token } = await busLink(env);
    for (let i = 0; i < 3; i++) {
      a.not((await body(await W.handleLinkDo(env, { token, pin: "9999", choice: "run" }))).ok);
    }
    const out = await body(await W.handleLinkDo(env, { token, pin: "1234", choice: "run" }));
    a.ok(out.locked);
    a.eq(out.minutes, 5, "the same lockout as everywhere else his name is used");
    a.eq((await W.checksToday(env))[REG].state, "stopped");
  });

  s.test("a wrong PIN does not burn the link, so he can try again", async (a) => {
    const { db, env } = await fresh();
    await stopTheBus(env);
    const { token } = await busLink(env);
    await W.handleLinkDo(env, { token, pin: "9999", choice: "run" });
    a.eq(db._one("SELECT * FROM links WHERE token=?", token).used, 0);
  });

  s.test("an ordinary driver's own PIN gets nowhere, whoever the link names", async (a) => {
    /* The link is checked against every COORDINATOR's hash and nobody
       else's, so a driver keying the PIN he uses for his walkaround is
       refused even on a link addressed to him. */
    const { env } = await fresh();
    await stopTheBus(env);
    const { token } = await busLink(env, { to: "Bro Tunde" });
    const out = await body(await W.handleLinkDo(env, { token, pin: "9876", choice: "run" }));
    a.not(out.ok);
    a.eq(out.error, "bad pin");
  });

  s.test("A SECOND COORDINATOR'S PIN WORKS ON THE FIRST ONE'S LINK", async (a) => {
    /* 24 September. A coordinator opened his own link, keyed his own PIN and
       was told it was not right. It was not right FOR THE MAN THE EMAIL HAD
       BEEN ADDRESSED TO, which coordinatorName() had picked by falling back
       to the first authoriser on the Drivers tab when COORDINATOR_EMAIL
       matched nobody. Nothing on the page said whose PIN it wanted.

       The app has always let any authoriser release a bus. One rule now, and
       the record names whoever actually keyed a PIN. */
    const { env } = await fresh();
    await stopTheBus(env);
    const { token } = await busLink(env, { to: "Pst Kehinde" });
    const out = await body(await W.handleLinkDo(env, { token, pin: "1234", choice: "run" }));
    a.ok(out.ok, JSON.stringify(out));
    a.eq(out.by, "Bro Asim", "and it is filed against the man who actually decided");
  });

  s.test("an empty PIN is never a way in", async (a) => {
    const { env } = await fresh();
    await stopTheBus(env);
    const { token } = await busLink(env, { to: "Bro Calvin" });
    const out = await body(await W.handleLinkDo(env, { token, pin: "", choice: "run" }));
    a.not(out.ok);
    a.eq(out.error, "bad pin");
  });

  s.test("a coordinator with no PIN against their name is not one of the matches", async (a) => {
    /* Bro Calvin is a coordinator with an empty hash. Everywhere else in this
       system a driver without a PIN is simply not asked for one; here it lets
       a bus out with a fault on it, so a name with nothing to check against
       cannot do it. With no hash anywhere, the page is told so plainly rather
       than letting somebody guess four digits at a door that cannot open. */
    const { db, env } = await fresh();
    await db.prepare("UPDATE drivers SET pin_hash = '' WHERE role <> 'Driver'").run();
    await stopTheBus(env);
    const { token } = await busLink(env);
    const out = await body(await W.handleLinkDo(env, { token, pin: "1234", choice: "run" }));
    a.not(out.ok);
    a.eq(out.error, "no pin");
  });

  s.test("naming yourself on the request buys nothing at all", async (a) => {
    /* `who` used to be read off the request and only then checked against the
       register. It is now ignored outright: the PIN is the whole credential
       and there is no field anybody can set to change what it is compared
       against. */
    const { env } = await fresh();
    await stopTheBus(env);
    const { token } = await busLink(env, { to: "Bro Tunde" });
    const out = await body(await W.handleLinkDo(env,
      { token, who: "Bro Tunde", pin: "9876", choice: "run" }));
    a.not(out.ok);
    a.eq(out.error, "bad pin");
  });


  /* ---- who takes the Sunday ----------------------------------------------

     Approving from a phone used to leave the morning reading "No driver
     assigned" and the coordinator still had to open the spreadsheet. A
     decision link that still needs a laptop is half a link. */

  async function withRota(env, key, over) {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO rota (sunday, north, north_cover, south, south_cover) " +
      "VALUES (?,?,?,?,?)"
    ).bind(key, (over && over.north) || "", (over && over.northCover) || "",
           (over && over.south) || "", (over && over.southCover) || "").run();
  }

  s.test("the page is offered names, and not the man who asked", (a) => {
    return (async () => {
      const { env } = await fresh();
      const { token } = await rotaLink(env, { sunday: "2026-10-18", driver: "Bro Tunde",
                                              type: "Holiday / planned leave" });
      const out = await body(await W.handleLinkWhat(env, { token }));
      a.ok(Array.isArray(out.candidates), "no candidates at all: " + JSON.stringify(out.candidates));
      const names = out.candidates.map((c) => c.name);
      a.ok(names.indexOf("Bro Asim") !== -1, "got " + names.join(", "));
      a.eq(names.indexOf("Bro Tunde"), -1, "the man asking to be excused was offered it");
    })();
  });

  s.test("each name carries what a coordinator needs to judge it", async (a) => {
    /* A bare list of names is the thing I objected to, and the objection was
       right about the list. Already-driving and last-drove are what turn it
       into a decision. */
    const { env } = await fresh();
    await withRota(env, "2026-10-18", { south: "Pst Kehinde" });
    await withRota(env, W.keyAddWeeks(W.runSunday(), -1), { north: "Bro Asim" });
    const { token } = await rotaLink(env, { sunday: "2026-10-18", driver: "Bro Tunde",
                                            type: "Holiday / planned leave" });
    const out = await body(await W.handleLinkWhat(env, { token }));
    const by = {};
    out.candidates.forEach((c) => { by[c.name] = c; });
    a.eq(by["Pst Kehinde"].busy, "South", "he is already out that morning and it does not say so");
    a.eq(by["Bro Asim"].busy, "", "he is free and it says otherwise");
    a.eq(by["Bro Asim"].last, W.keyAddWeeks(W.runSunday(), -1), "when he last drove");
  });

  s.test("A SWAP IS OFFERED NOBODY, because it names its own partner", async (a) => {
    /* It moves two Sundays between two men. A third name there would be
       offering to do something else entirely. */
    const { env } = await fresh();
    const { token } = await rotaLink(env, { type: "Request a swap", swapWith: "Bro Asim" });
    const out = await body(await W.handleLinkWhat(env, { token }));
    a.eq(out.candidates, undefined, "got " + JSON.stringify(out.candidates));
  });

  s.test("the cover rides the drain home with the decision", async (a) => {
    const { env } = await fresh();
    const { token } = await rotaLink(env, { type: "Holiday / planned leave" });
    const out = await body(await W.handleLinkDo(env,
      { token, pin: "1234", choice: "Approved", cover: "Pst Kehinde" }));
    a.ok(out.ok, JSON.stringify(out));
    a.eq(out.cover, "Pst Kehinde");
    const drain = await body(await W.handleDrain(env, { limit: 50 }));
    a.eq(drain.decisions.length, 1);
    a.eq(drain.decisions[0].cover, "Pst Kehinde");
  });

  s.test("A NAME THE REGISTER DOES NOT KNOW IS DROPPED, NOT WRITTEN", async (a) => {
    /* A page can send anything. Only somebody the spreadsheet knows as an
       active driver may be written into a Sunday — and the decision itself
       still stands, landing as "approved, cover to be arranged", which is
       exactly what it was before this page could offer a cover at all. */
    const { env } = await fresh();
    const { token } = await rotaLink(env, { type: "Holiday / planned leave" });
    const out = await body(await W.handleLinkDo(env,
      { token, pin: "1234", choice: "Approved", cover: "Somebody Made Up" }));
    a.ok(out.ok, "the decision should still stand: " + JSON.stringify(out));
    a.eq(out.cover, "");
    const drain = await body(await W.handleDrain(env, { limit: 50 }));
    a.eq(drain.decisions[0].cover, "");
  });

  s.test("turning a request down never records a cover", async (a) => {
    /* Refusing it and naming somebody to take it are two contradictory
       answers to one question. */
    const { env } = await fresh();
    const { token } = await rotaLink(env, { type: "Holiday / planned leave" });
    const out = await body(await W.handleLinkDo(env,
      { token, pin: "1234", choice: "Rejected", cover: "Pst Kehinde" }));
    a.ok(out.ok);
    a.eq(out.cover, "");
  });

  s.test("leaving it blank is still a whole answer", async (a) => {
    const { env } = await fresh();
    const { token } = await rotaLink(env, { type: "Holiday / planned leave" });
    const out = await body(await W.handleLinkDo(env, { token, pin: "1234", choice: "Approved" }));
    a.ok(out.ok);
    a.eq(out.cover, "");
  });

  s.test("an inactive driver is never offered", async (a) => {
    const { db, env } = await fresh();
    await db.prepare("UPDATE drivers SET active = 0 WHERE name = 'Pst Kehinde'").run();
    const { token } = await rotaLink(env, { type: "Holiday / planned leave" });
    const out = await body(await W.handleLinkWhat(env, { token }));
    a.eq(out.candidates.map((c) => c.name).indexOf("Pst Kehinde"), -1);
  });

  /* ---- one use, and it expires ------------------------------------------ */

  s.test("a link is good once", async (a) => {
    const { env } = await fresh();
    await stopTheBus(env);
    const { token } = await busLink(env);
    a.ok((await body(await W.handleLinkDo(env, { token, pin: "1234", choice: "run" }))).ok);
    const again = await body(await W.handleLinkDo(env, { token, pin: "1234", choice: "run" }));
    a.not(again.ok);
    a.eq(again.error, "used");
    a.eq(again.by, "Bro Asim", "and it says who already decided it");
  });

  s.test("a used link says so when it is looked at", async (a) => {
    const { env } = await fresh();
    await stopTheBus(env);
    const { token } = await busLink(env);
    await W.handleLinkDo(env, { token, pin: "1234", choice: "run" });
    const out = await body(await W.handleLinkWhat(env, { token }));
    a.ok(out.used);
    a.eq(out.usedBy, "Bro Asim");
  });

  s.test("an expired link decides nothing", async (a) => {
    const { db, env } = await fresh();
    await stopTheBus(env);
    const { token } = await busLink(env);
    db._exec("UPDATE links SET expires = " + (Date.now() - 1000));
    const out = await body(await W.handleLinkDo(env, { token, pin: "1234", choice: "run" }));
    a.not(out.ok);
    a.eq(out.error, "expired");
    a.eq((await W.checksToday(env))[REG].state, "stopped",
         "a message found in a mailbox in March is not a way into the record");
  });

  s.test("an expired link says so when it is looked at", async (a) => {
    const { db, env } = await fresh();
    const { token } = await busLink(env);
    db._exec("UPDATE links SET expires = " + (Date.now() - 1000));
    a.ok((await body(await W.handleLinkWhat(env, { token }))).expired);
  });

  s.test("a link cannot be minted to last for ever", async (a) => {
    const { db, env } = await fresh();
    await body(await W.handleMintLink(env, { link: { kind: "rota", subject: {}, ttlMinutes: 99999999 } }));
    const row = db._one("SELECT * FROM links ORDER BY made DESC LIMIT 1");
    a.ok(Number(row.expires) - Number(row.made) <= 7 * 86400000 + 1000,
         "a week is the most any link may last");
  });

  /* ---- the bus has moved on since the email ----------------------------- */

  s.test("a bus somebody else has already authorised is not authorised twice", async (a) => {
    const { env } = await fresh();
    await stopTheBus(env);
    const { token } = await busLink(env);
    await W.handleAuthorise(env, { authorise: { reg: REG, who: "Pst Kehinde", pin: "4321" } });
    const out = await body(await W.handleLinkWhat(env, { token }));
    a.eq(out.state, "authorised");
    a.eq(out.stateBy, "Pst Kehinde", "the page says who, instead of offering the button again");
  });

  s.test("a second walkaround since the email makes the link stale", async (a) => {
    const { env } = await fresh();
    await stopTheBus(env, "chk-1");
    const { token } = await busLink(env, { checkId: "chk-1" });
    await new Promise((r) => setTimeout(r, 12));
    await stopTheBus(env, "chk-2");
    const out = await body(await W.handleLinkWhat(env, { token }));
    a.ok(out.stale, "this message is about a check that is no longer the current one");
  });

  s.test("a link for a bus nobody stopped decides nothing", async (a) => {
    const { env } = await fresh();
    const { token } = await busLink(env);
    const out = await body(await W.handleLinkDo(env, { token, pin: "1234", choice: "run" }));
    a.not(out.ok);
    a.eq(out.error, "no check",
         "signing off a walkaround that never happened is the worst record of all");
  });

  s.test("the app and the email write the same authorisation", async (a) => {
    const viaApp = await fresh();
    await stopTheBus(viaApp.env);
    await W.handleAuthorise(viaApp.env, { authorise: { reg: REG, who: "Bro Asim", pin: "1234" } });

    const viaMail = await fresh();
    await stopTheBus(viaMail.env);
    const { token } = await busLink(viaMail.env);
    await W.handleLinkDo(viaMail.env, { token, pin: "1234", choice: "run" });

    const one = (await W.checksToday(viaApp.env))[REG];
    const two = (await W.checksToday(viaMail.env))[REG];
    a.eq(one.state, two.state);
    a.eq(one.by, two.by);
    a.eq(one.id, two.id, "same act, same record, whichever door it came through");
  });

  /* ---- a driver's rota request ------------------------------------------ */

  s.test("approving records the decision for the spreadsheet to apply", async (a) => {
    const { env } = await fresh();
    const { token } = await rotaLink(env);
    const out = await body(await W.handleLinkDo(env, { token, pin: "1234", choice: "Approved" }));
    a.ok(out.ok, JSON.stringify(out));
    a.eq(out.choice, "Approved");
    a.eq(out.request, "REQ-9");
  });

  s.test("turning one down is recorded just as plainly", async (a) => {
    const { env } = await fresh();
    const { token } = await rotaLink(env);
    const out = await body(await W.handleLinkDo(env, { token, pin: "1234", choice: "Rejected" }));
    a.ok(out.ok);
    a.eq(out.choice, "Rejected");
  });

  s.test("an answer that is neither is refused", async (a) => {
    const { env } = await fresh();
    const { token } = await rotaLink(env);
    for (const choice of ["", "Maybe", "run", "DROP TABLE rota"]) {
      const out = await body(await W.handleLinkDo(env, { token, pin: "1234", choice }));
      a.not(out.ok, "accepted " + JSON.stringify(choice));
      a.eq(out.error, "choice");
    }
  });

  s.test("a rota link cannot be used to authorise a bus", async (a) => {
    const { env } = await fresh();
    await stopTheBus(env);
    const { token } = await rotaLink(env);
    const out = await body(await W.handleLinkDo(env, { token, pin: "1234", choice: "run" }));
    a.not(out.ok, "the kind is decided when the link is made, never by the caller");
    a.eq((await W.checksToday(env))[REG].state, "stopped");
  });

  s.test("a bus link cannot be used to approve a swap", async (a) => {
    const { env } = await fresh();
    await stopTheBus(env);
    const { token } = await busLink(env);
    const out = await body(await W.handleLinkDo(env, { token, pin: "1234", choice: "Approved" }));
    a.not(out.ok);
    a.eq(out.error, "choice");
  });

  /* ---- getting it back to the spreadsheet -------------------------------- */

  s.test("a decided request rides the drain back to the sheet", async (a) => {
    const { env } = await fresh();
    const { token } = await rotaLink(env);
    await W.handleLinkDo(env, { token, pin: "1234", choice: "Approved" });
    const drain = await body(await W.handleDrain(env, { limit: 50 }));
    a.eq(drain.decisions.length, 1);
    a.eq(drain.decisions[0].id, "REQ-9");
    a.eq(drain.decisions[0].choice, "Approved");
    a.eq(drain.decisions[0].by, "Bro Asim");
  });

  s.test("an undecided request is not carried anywhere", async (a) => {
    const { env } = await fresh();
    await rotaLink(env);
    const drain = await body(await W.handleDrain(env, { limit: 50 }));
    a.eq(drain.decisions.length, 0);
  });

  s.test("it keeps coming round until the spreadsheet says it has it", async (a) => {
    const { env } = await fresh();
    const { token } = await rotaLink(env);
    await W.handleLinkDo(env, { token, pin: "1234", choice: "Approved" });
    a.eq((await body(await W.handleDrain(env, { limit: 50 }))).decisions.length, 1);
    a.eq((await body(await W.handleDrain(env, { limit: 50 }))).decisions.length, 1,
         "a drain that never landed must not lose the decision");
    await W.handleDrained(env, { decisions: [token] });
    a.eq((await body(await W.handleDrain(env, { limit: 50 }))).decisions.length, 0);
  });

  s.test("a bus authorisation does not go round that way", async (a) => {
    const { env } = await fresh();
    await stopTheBus(env);
    const { token } = await busLink(env);
    await W.handleLinkDo(env, { token, pin: "1234", choice: "run" });
    const drain = await body(await W.handleDrain(env, { limit: 50 }));
    a.eq(drain.decisions.length, 0,
         "that fact is this server's own and the phones already have it");
  });

  s.test("a made-up token cannot mark somebody else's decision as filed", async (a) => {
    const { db, env } = await fresh();
    const { token } = await rotaLink(env);
    await W.handleLinkDo(env, { token, pin: "1234", choice: "Approved" });
    await W.handleDrained(env, { decisions: ["nonsense", "", "b".repeat(32)] });
    a.eq(db._one("SELECT * FROM links WHERE token=?", token).synced, 0);
  });

  /* ---- the page itself, read rather than run -----------------------------

     The property this whole design rests on cannot be tested by calling a
     function: it is that OPENING the page does not act. So the page is read,
     and what it can reach on load is checked.

     A static check, and it is the honest kind here. If somebody later moves
     the linkdo call up into start(), every behaviour test above still passes
     and the feature is broken in the one way that matters. This is the test
     that would notice. */

  s.test("the page asks what a link is about when it loads, and nothing else", (a) => {
    const src = readFileSync(join(root, "do", "index.html"), "utf8");
    const start = src.slice(src.indexOf("function start()"), src.indexOf("/* ---- a stopped bus"));
    a.has(start, '"linkwhat"', "it should ask");
    a.hasnt(start, '"linkdo"',
            "opening the page must never be able to act: a mail scanner opens links too");
  });

  s.test("the only thing that calls linkdo is the thing behind the PIN", (a) => {
    const src = readFileSync(join(root, "do", "index.html"), "utf8");
    const calls = [...src.matchAll(/post\(\s*"linkdo"/g)].length;
    a.eq(calls, 1, "there should be exactly one place that acts, and there are " + calls);
    const send = src.slice(src.indexOf("function send(choice)"));
    a.has(send, '"linkdo"', "and it should be inside send()");
    a.has(send, "pin.length < 4", "which refuses before it asks");
  });

  s.test("the page reads only the token out of the address", (a) => {
    const src = readFileSync(join(root, "do", "index.html"), "utf8");
    a.has(src, "[0-9a-f]{32}",
          "a mail gateway appends its own parameters and must not be able to change the subject");
  });

  s.test("the page caches nothing and the driver's worker keeps off it", (a) => {
    const page = readFileSync(join(root, "do", "index.html"), "utf8");
    a.hasnt(page, "serviceWorker", "a decision served from a cache is a decision made on stale facts");
    a.hasnt(page, 'rel="manifest"', "nobody installs this");
    const sw = readFileSync(join(root, "sw.js"), "utf8");
    a.has(sw, '"/do/"', "the driver app's worker has to return without responding for this path");
  });

  s.test("the page fetches nothing from anywhere but the live server", (a) => {
    const src = readFileSync(join(root, "do", "index.html"), "utf8");
    const urls = [...src.matchAll(/https?:\/\/[^"'\s)]+/g)].map((m) => m[1] || m[0]);
    for (const u of urls) {
      a.ok(/minibus-api\.asimbassey\.workers\.dev|maps\.google\.com/.test(u),
           "an email page should reach nothing else, and it reaches " + u);
    }
  });

  /* ---- clearing up ------------------------------------------------------- */

  s.test("links older than a week are swept away", async (a) => {
    const { db, env } = await fresh();
    const { token } = await busLink(env);
    db._exec("UPDATE links SET expires = " + (Date.now() - 8 * 86400000));
    await W.sweepLinks(env);
    a.eq(db._one("SELECT * FROM links WHERE token=?", token), null,
         "a mailbox keeps a link for years and this table should not");
  });

  s.test("a decision the spreadsheet has not had yet is never swept", async (a) => {
    const { db, env } = await fresh();
    const { token } = await rotaLink(env);
    await W.handleLinkDo(env, { token, pin: "1234", choice: "Approved" });
    db._exec("UPDATE links SET expires = " + (Date.now() - 8 * 86400000));
    await W.sweepLinks(env);
    a.ok(db._one("SELECT * FROM links WHERE token=?", token),
         "an old link is rubbish; an old link carrying an unfiled decision is a record");
  });

  s.test("a live link is left alone", async (a) => {
    const { db, env } = await fresh();
    const { token } = await busLink(env);
    await W.sweepLinks(env);
    a.ok(db._one("SELECT * FROM links WHERE token=?", token));
  });

  return s;
}
