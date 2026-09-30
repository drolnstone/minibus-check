/* THE LIVE SERVER KNOCKING ON THE SPREADSHEET'S DOOR.

   Everything else on this server is downstream of the sheet. It is told the
   timetable, the buses, the drivers and the rota, and it answers phones. It
   has never called back.

   Which was fine until a coordinator could approve somebody's cover from his
   phone in a car park. That decision lands on the Rota Requests tab, and the
   Rota Requests tab is in the spreadsheet — so the answer he got was "within
   five minutes", which is not an answer about his rota. It is an answer about
   our plumbing: five minutes is how long the sheet takes to ask.

   So the sheet now sends its own address on every sync, and the server hands
   a rota decision straight over the moment a PIN is accepted.

   WHAT THIS SUITE IS REALLY FOR. Not that the push works — that is the easy
   half. It is that EVERY WAY THE PUSH CAN FAIL LEAVES THE DECISION EXACTLY
   WHERE THE DRAIN WILL FIND IT. A shortcut that can lose a decision is worse
   than no shortcut, because the five minutes it saves are five minutes
   nobody was counting and the decision it drops is a driver who turns up to
   a bus that is not his. Silence is not consent, unheard is not applied, and
   nothing is marked done on a guess. */

import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { seedSunday } from "../lib/seed.mjs";

const EXEC = "https://script.google.com/macros/s/AKfy/exec";

export default async function (root) {
  const s = new Suite("handing a decision straight to the sheet");
  const { mod: W } = await loadWorker(root);
  const G = installGlobals();
  const body = async (r) => JSON.parse(await r.text());

  const base = {
    stops: [{ id: "N00", route: "North", time: "09:52", stop: "Church", depart: true }],
    buses: [{ reg: "YS70 PWE", seats: 16, active: true }]
  };

  async function fresh(over) {
    G.reset();
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db, over);
    const key = W.runSunday();
    await seedSunday(db, key);
    for (const d of [["Bro Arthur", "Coordinator", "1234"],
                     ["Bro Trevor", "Driver", "9876"],
                     ["Bro Keith", "Driver", "5555"]]) {
      await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,1,1,?)")
        .bind(d[0], d[1], "North", await W.pinHashOf(env, d[0], d[2])).run();
    }
    await W.cachePut(env, "auth_rules",
      { roles: ["coordinator"], sameHandBothWays: true }).run();
    await W.cachePut(env, "sheet_url", { url: EXEC }).run();
    return { db, env, key };
  }

  /* A rota link, minted and then decided with a coordinator's PIN. */
  async function decide(env, over) {
    const mint = await body(await W.handleMintLink(env, { link: { kind: "rota", subject:
      Object.assign({ id: "REQ-9", sunday: "2026-10-04", driver: "Bro Trevor",
                      type: "Cover", to: "Bro Arthur" }, (over && over.subject) || {}) } }));
    const out = await body(await W.handleLinkDo(env, Object.assign(
      { token: mint.token, pin: "1234", choice: "Approved", cover: "Bro Keith" },
      (over && over.doing) || {})));
    return { token: mint.token, out };
  }

  const queued = async (env) => (await body(await W.handleDrain(env, {}))).decisions;
  const syncedOf = (db, token) =>
    Number((db._rows("SELECT synced FROM links WHERE token=?", token)[0] || {}).synced);

  /* ---- the address -------------------------------------------------------- */

  s.test("the sheet's own address arrives on a sync and is kept", async (a) => {
    const { db, env } = await fresh();
    await db.prepare("DELETE FROM settings WHERE k='sheet_url'").run();
    await W.handleSync(env, Object.assign({ sheetUrl: EXEC }, base));
    a.eq((await W.cacheGet(env, "sheet_url")).url, EXEC);
  });

  s.test("a /dev address is not an address", async (a) => {
    /* What getUrl answers when the script is run from the editor rather than
       from the trigger. Nothing outside that Google account can reach it, so
       storing one would mean a way back that fails silently for ever. */
    const { db, env } = await fresh();
    await db.prepare("DELETE FROM settings WHERE k='sheet_url'").run();
    await W.handleSync(env, Object.assign({ sheetUrl: "https://script.google.com/macros/s/AAA/dev" }, base));
    a.eq(await W.cacheGet(env, "sheet_url"), null);
  });

  s.test("a sync that carries no address leaves the one we have alone", async (a) => {
    /* A Worker deployed ahead of the sheet, or a sheet that cannot work out
       its own address this minute, must not cost us the way back. */
    const { env } = await fresh();
    await W.handleSync(env, base);
    a.eq((await W.cacheGet(env, "sheet_url")).url, EXEC);
  });

  /* ---- the push ----------------------------------------------------------- */

  s.test("approving a cover reaches the spreadsheet at once", async (a) => {
    const { env } = await fresh();
    G.reply(new Response(JSON.stringify({ ok: true, id: "REQ-9" }), { status: 200 }));
    const { out } = await decide(env);
    a.eq(out.ok, true, JSON.stringify(out));
    a.eq(out.applied, true, "it did not say it had landed: " + JSON.stringify(out));

    const hit = G.calls.filter((c) => c.url === EXEC);
    a.eq(hit.length, 1, "it called out " + G.calls.length + " times, " + hit.length + " to the sheet");
    a.eq(String(hit[0].opts.method).toUpperCase(), "POST");
  });

  s.test("and what it carries is the decision, checked, not what the page sent", async (a) => {
    /* The cover is validated against the register before it goes anywhere.
       This is the assertion that it is the checked name travelling and not
       the raw one, and that the token goes with it so the sheet knows who is
       knocking. */
    const { env } = await fresh();
    G.reply(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await decide(env, { doing: { cover: "bro keith" } });
    const sent = JSON.parse(G.calls.filter((c) => c.url === EXEC)[0].opts.body);
    a.eq(sent.token, "minibusapp");
    a.eq(sent.action, "decision");
    a.eq(sent.decision.id, "REQ-9");
    a.eq(sent.decision.choice, "Approved");
    a.eq(sent.decision.cover, "Bro Keith", "it sent the page's spelling, not the register's");
    a.eq(sent.decision.by, "Bro Arthur");
  });

  s.test("a name the register does not know travels as no cover at all", async (a) => {
    const { env } = await fresh();
    G.reply(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { out } = await decide(env, { doing: { cover: "Somebody Else" } });
    const sent = JSON.parse(G.calls.filter((c) => c.url === EXEC)[0].opts.body);
    a.eq(sent.decision.cover, "", "a page could write any name it liked into a Sunday");
    a.eq(out.applied, true, "and the decision itself still stands");
  });

  s.test("once the sheet has it, the drain does not carry it again", async (a) => {
    const { db, env } = await fresh();
    G.reply(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { token } = await decide(env);
    a.eq(syncedOf(db, token), 1);
    a.eq((await queued(env)).length, 0, "the sheet would have been told twice");
  });

  s.test("turning a request down is pushed the same way", async (a) => {
    const { env } = await fresh();
    G.reply(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { out } = await decide(env, { doing: { choice: "Rejected", cover: "" } });
    a.eq(out.applied, true);
    a.eq(JSON.parse(G.calls.filter((c) => c.url === EXEC)[0].opts.body).decision.choice, "Rejected");
  });

  /* ---- EVERY WAY IT CAN FAIL ---------------------------------------------

     One property, six ways of breaking it: the decision is still there for
     the drain, and the page has not been told otherwise. */

  async function survives(a, arrange) {
    const { db, env } = await fresh(arrange.env);
    if (arrange.before) await arrange.before(db, env);
    if (arrange.reply) G.reply(arrange.reply);
    const { token, out } = await decide(env);

    a.eq(out.ok, true, "the decision itself was lost: " + JSON.stringify(out));
    a.not(out.applied === true, "it claimed the sheet had it");
    a.eq(syncedOf(db, token), 0, "it marked a decision done that nobody took");

    const left = await queued(env);
    a.eq(left.length, 1, "THE DECISION IS GONE. " + JSON.stringify(left));
    a.eq(left[0].choice, "Approved");
    a.eq(left[0].cover, "Bro Keith", "the drain would apply it without the cover");
    a.eq(left[0].by, "Bro Arthur");
  }

  s.test("the sheet saying no leaves it for the drain", (a) =>
    survives(a, { reply: new Response(JSON.stringify({ ok: false, error: "bad token" }), { status: 200 }) }));

  s.test("a 500 from the sheet leaves it for the drain", (a) =>
    survives(a, { reply: new Response("Server error", { status: 500 }) }));

  s.test("an HTML error page instead of JSON leaves it for the drain", (a) =>
    /* What Apps Script actually serves when a script is over quota or has
       been deleted: 200, and a page of Google's HTML. */
    survives(a, { reply: new Response("<html>Sorry, unable to open the file</html>", { status: 200 }) }));

  s.test("the network failing outright leaves it for the drain", (a) =>
    survives(a, { reply: () => Promise.reject(new Error("connect ECONNREFUSED")) }));

  s.test("A SHEET THAT NEVER ANSWERS DOES NOT HOLD THE PERSON THERE", async (a) => {
    /* The one that would otherwise be invisible. A hung request with no cap
       would sit on the page until the platform gave up on it — a man in a car
       park watching a spinner, for a shortcut whose whole purpose was to save
       him five minutes. Capped, and the cap is the fallback, not an error. */
    const started = Date.now();
    await survives(a, {
      env: { SHEET_PUSH_MS: 60 },
      reply: () => new Promise((done) =>
        setTimeout(() => done(new Response(JSON.stringify({ ok: true }), { status: 200 })), 3000))
    });
    a.ok(Date.now() - started < 2000, "it waited for a sheet that was not coming");
  });

  s.test("with no address at all it behaves exactly as it did before", async (a) => {
    /* A Worker that has never had a sync from a deployed sheet. Nothing is
       broken by this; it is simply the old five minute route. */
    await survives(a, { before: (db) =>
      db.prepare("DELETE FROM settings WHERE k='sheet_url'").run() });
    a.eq(G.calls.filter((c) => c.url === EXEC).length, 0,
         "it found an address it should not have had");
  });

  /* ---- and only this ------------------------------------------------------ */

  s.test("authorising a stopped bus pushes nothing", async (a) => {
    /* It has no business in the spreadsheet in a hurry: the phones read it
       from this server within seconds, and the Defects tab is a record rather
       than something anybody is standing over. Pushing it would be one more
       outbound call per fault for no one's benefit. */
    const { env } = await fresh();
    await W.handleCheck(env, { id: "chk-1", reg: "YS70 PWE", level: "stop",
                               driver: "Bro Trevor", age: 0 });
    const mint = await body(await W.handleMintLink(env, { link: { kind: "authorise", subject:
      { reg: "YS70 PWE", checkId: "chk-1", inspector: "Bro Trevor", to: "Bro Arthur" } } }));
    const out = await body(await W.handleLinkDo(env, { token: mint.token, pin: "1234", choice: "run" }));
    a.eq(out.ok, true, JSON.stringify(out));
    a.eq(G.calls.filter((c) => c.url === EXEC).length, 0);
  });

  s.test("a link opened and not acted on pushes nothing", async (a) => {
    /* The oldest promise in the link design, restated here because there is
       now something outbound that could break it: mail providers and phone
       previews open links before a person does, and looking must stay free. */
    const { env } = await fresh();
    const mint = await body(await W.handleMintLink(env, { link: { kind: "rota",
      subject: { id: "REQ-9", sunday: "2026-10-04", driver: "Bro Trevor", to: "Bro Arthur" } } }));
    await W.handleLinkWhat(env, { token: mint.token });
    a.eq(G.calls.filter((c) => c.url === EXEC).length, 0);
  });

  s.test("a wrong PIN pushes nothing", async (a) => {
    const { env } = await fresh();
    const { out } = await decide(env, { doing: { pin: "0000" } });
    a.eq(out.ok, false);
    a.eq(G.calls.filter((c) => c.url === EXEC).length, 0);
  });

  return s;
}
