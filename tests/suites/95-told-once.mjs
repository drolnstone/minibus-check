/* TOLD ONCE, ONE ROAD. sheet v1.155.0 · server w2.114.0 (Asim, 25 Nov 2026).

   An alert with a full email of its own reaches each coordinator once: on a
   phone, or by email when they have alerts on no phone. An address in
   COORDINATOR_EMAIL that is nobody's on the Drivers tab still has it, and
   with no live server to ask, everybody's email goes as before. A driver's
   rota answer goes to the Driver App first. */

import { Suite } from "../lib/t.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab } from "../lib/tabs.mjs";

export default async function (root) {
  const s = new Suite("told once, one road");

  const sheet = (reply) => {
    const L = loadCodeGs(root, { tabs: {
      "Drivers": tab("Drivers", [
        { Name: "Bro Arthur", Role: "Coordinator", Active: "YES", "Primary order": 1, Email: "arthur@b.c", Route: "North" },
        { Name: "Bro Keith", Role: "Coordinator", Active: "YES", "Primary order": 2, Email: "keith@b.c", Route: "South" },
        { Name: "Bro Adrian", Role: "Driver", Active: "YES", "Primary order": 3, Email: "ade@b.c", Route: "North" }])
    }, props: { COORDINATOR_EMAIL: "arthur@b.c,other@b.c", PIN_SALT: "salt", WORKER_URL: "https://example.invalid" } });
    L.gas.setFetchReply(reply);
    return L;
  };
  const ok = (o) => ({ code: 200, body: JSON.stringify(Object.assign({ ok: true }, o)) });
  const send = (L) => call(L, "tellCoordinatorsOnce", { id: "t1", title: "YS70 PWE: MOT due" },
    function (to) { L.gas.mail.push({ to: to, subject: "full" }); });
  const sent = (L) => L.gas.mail.map((m) => String(m.to)).join("|");

  s.test("every coordinator on a phone: only the address that is nobody's on the Drivers tab", (a) => {
    const L = sheet(ok({ unalerted: [] }));
    send(L);
    a.eq(sent(L), "other@b.c");
  });

  s.test("a coordinator with alerts on no phone has the full email", (a) => {
    const L = sheet(ok({ unalerted: ["Bro Keith"] }));
    send(L);
    a.eq(sent(L), "keith@b.c,other@b.c");
  });

  s.test("no live server answer: the email goes to everybody as before", (a) => {
    const L = sheet({ code: 500, body: "" });
    send(L);
    a.eq(sent(L), "arthur@b.c,other@b.c");
  });

  s.test("the same alert again sends nothing", (a) => {
    const L = sheet(ok({ duplicate: true }));
    send(L);
    a.eq(sent(L), "");
  });

  s.test("a driver's alert: the Driver App first", (a) => {
    a.ok(call(sheet(ok({ pushed: ["Bro Adrian"] })), "driverAppFirst", "Bro Adrian", "Request approved", "x"));
    a.not(call(sheet(ok({ pushed: [] })), "driverAppFirst", "Bro Adrian", "Request approved", "x"));
    a.not(call(sheet({ code: 500, body: "" }), "driverAppFirst", "Bro Adrian", "Request approved", "x"));
  });

  s.test("a correction, an MOT run and an unmarked stop raise no sheet alert of their own", (a) => {
    const src = require_src(root);
    a.hasnt(src, '"vfix|" + b.logId');
    a.hasnt(src, '"motrun|" + reg');
    a.hasnt(src, "missedTapAlert");
  });

  return s;
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
const require_src = (root) => readFileSync(join(root, "Code.gs"), "utf8");
