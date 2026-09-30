/* THE PIN SALT IS A SETTING, NEVER A LINE IN A PUBLIC FILE.

   Until w2.21.1 / v1.85.2 both files carried a fallback salt, and both files
   are in a public repository, so a system that had never had PIN_SALT set was
   salting with a value anybody could read. The fallback is gone. What matters
   now is which way a missing setting fails: every PIN refused, never every
   driver waved through, and "Is everything working?" saying so.

   The checks that a missing salt refuses fail on w2.21.0 / v1.85.1; the
   rest make sure the fix did not go too far, and pass on both. */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";

export default async function (root) {
  const s = new Suite("the PIN salt is a setting and a missing one refuses");
  installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  s.test("neither file carries a salt of its own", (a) => {
    const worker = readFileSync(join(root, "server", "worker.js"), "utf8");
    const code = readFileSync(join(root, "Code.gs"), "utf8");
    a.not(/PIN_SALT_FALLBACK/.test(worker), "worker.js still has a fallback salt");
    a.ok(/const pinSaltOf = \(env\) => String\(\(env && env\.PIN_SALT\) \|\| ""\);/.test(worker));
    a.not(/W4JKBxSr3GUFO3PR9lmCqawYBdYzD5/.test(worker + code), "the old published salt is still in a file");
  });

  /* ---- the sheet -------------------------------------------------------- */

  const sheet = (props) => loadCodeGs(root, { tabs: {}, props: props || {} });

  s.test("with no PIN_SALT, a driver with a PIN is sent a fingerprint nothing matches, never a blank", (a) => {
    const got = call(sheet(), "pinHashLive", "Bro Trevor", "1234");
    a.ok(got, "a blank fingerprint is read by the live server as 'no PIN wanted'");
    a.not(/^[0-9a-f]{64}$/.test(got), "it looks like a real fingerprint");
  });

  s.test("a driver with no PIN is still sent a blank, with or without the salt", (a) => {
    a.eq(call(sheet(), "pinHashLive", "Bro Trevor", ""), "");
    a.eq(call(sheet({ PIN_SALT: "salt" }), "pinHashLive", "Bro Trevor", ""), "");
  });

  /* Not compared with the live server's: the fake Utilities digest is a
     stand-in, not SHA-256 (see tests/lib/gas.mjs). */
  s.test("with PIN_SALT set, the sheet sends a real fingerprint, and the salt changes it", (a) => {
    const one = call(sheet({ PIN_SALT: "salt-one" }), "pinHashLive", "Bro Trevor", "1234");
    const two = call(sheet({ PIN_SALT: "salt-two" }), "pinHashLive", "Bro Trevor", "1234");
    a.ok(/^[0-9a-f]{64}$/.test(one), "got " + one);
    a.ok(one !== two, "the salt made no difference");
  });

  /* ---- the live server -------------------------------------------------- */

  async function withDriver(pinHash, over) {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db, over);
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
      .bind("Bro Trevor", "Driver", "North", 1, pinHash).run();
    return env;
  }
  const noSalt = { PIN_SALT: undefined };

  s.test("with no PIN_SALT on the live server, the right PIN is refused", async (a) => {
    const real = await W.pinHashOf(makeEnv(null, { PIN_SALT: "salt" }), "Bro Trevor", "1234");
    const env = await withDriver(real, noSalt);
    const out = await J(await W.handlePin(env, { driver: "Bro Trevor", pin: "1234" }));
    a.not(out.valid, "a PIN was accepted with no salt set: " + JSON.stringify(out));
  });

  s.test("with no salt on either side, no PIN gets through", async (a) => {
    const marker = call(sheet(), "pinHashLive", "Bro Trevor", "1234");
    const env = await withDriver(marker, noSalt);
    for (const pin of ["1234", "0000", "9999"]) {
      const out = await J(await W.handlePin(env, { driver: "Bro Trevor", pin }));
      a.not(out.valid, "PIN " + pin + " was accepted: " + JSON.stringify(out));
    }
  });

  s.test("an unsalted fingerprint never equals itself, or a NULL", async (a) => {
    const env = makeEnv(null, noSalt);
    const one = await W.pinHashOf(env, "Bro Trevor", "1234");
    const two = await W.pinHashOf(env, "Bro Trevor", "1234");
    a.ok(one !== two && one !== null && two !== null);
  });

  s.test("the status answer says whether the live server has a salt", async (a) => {
    const db = makeDB(join(root, "server", "schema.sql"));
    a.eq((await J(await W.handleDrain(makeEnv(db, noSalt), { limit: 1 }))).pinSalt, false);
    a.eq((await J(await W.handleDrain(makeEnv(db), { limit: 1 }))).pinSalt, true);
  });

  return s;
}
