/* THE SPREADSHEET'S LINK IS THE OWNER'S ALONE.

   From v1.106.0 (Asim): an email with a link to the sheet goes in full to
   OWNER_EMAIL and without any sheet link to everybody else. The other
   coordinators are not shared on the sheet and work in the coordinator app. */

import { Suite } from "../lib/t.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";

const SHEET = "https://docs.google.com/spreadsheets/d/FAKE/edit";

export default function (root) {
  const s = new Suite("the spreadsheet's link goes to its owner only");

  const load = (owner) => loadCodeGs(root, { props: Object.assign(
    { COORDINATOR_EMAIL: "owner@a.b, two@a.b, three@a.b" }, owner === undefined ? {} : { OWNER_EMAIL: owner }) });
  const email = (L) => call(L, "sendMail", {
    to: "owner@a.b, Two <two@a.b>, three@a.b", subject: "Defect reported",
    body: "A driver has reported a defect.\n\nSigned: Bro Adrian\n\n" + SHEET + "#gid=7\n\nDecide from here:\nhttps://x/do/?t=abc",
    htmlBody: call(L, "htmlShell", "Defect reported", "#B26B00", ["Line"], "Open the defect record", "Defects")
  });

  s.test("the owner gets the button and the link, the others get neither", (a) => {
    const L = load("Owner@A.B");
    email(L);
    const mail = L.gas.mail;
    a.eq(mail.length, 2, JSON.stringify(mail.map((m) => m.to)));
    const mine = mail.find((m) => m.to === "owner@a.b");
    const rest = mail.find((m) => m.to !== "owner@a.b");
    a.ok(mine && rest);
    a.has(mine.htmlBody, SHEET);
    a.has(mine.body, SHEET);
    a.eq(rest.to, "Two <two@a.b>,three@a.b");
    a.hasnt(rest.htmlBody, "docs.google.com");
    a.hasnt(rest.body, "docs.google.com");
    a.has(rest.body, "Signed: Bro Adrian\n\nDecide from here:\nhttps://x/do/?t=abc",
          "the decision link stays, and no double blank line is left behind");
    a.has(rest.htmlBody, "Line");
  });

  s.test("with OWNER_EMAIL blank, nobody gets the link", (a) => {
    const L = load();
    email(L);
    a.eq(L.gas.mail.length, 1);
    a.hasnt(L.gas.mail[0].htmlBody, "docs.google.com");
    a.hasnt(L.gas.mail[0].body, "docs.google.com");
  });

  s.test("an email with no sheet link goes once, untouched", (a) => {
    const L = load("owner@a.b");
    call(L, "sendMail", { to: "owner@a.b, two@a.b", subject: "x", body: "Hello", htmlBody: "<p>Hello</p>" });
    a.eq(L.gas.mail.length, 1);
    a.eq(L.gas.mail[0].to, "owner@a.b, two@a.b");
  });

  s.test("the owner alone gets one email, in full", (a) => {
    const L = load("owner@a.b");
    call(L, "sendMail", { to: "owner@a.b", subject: "x", body: SHEET, htmlBody: "" });
    a.eq(L.gas.mail.length, 1);
    a.has(L.gas.mail[0].body, SHEET);
  });

  return s;
}
