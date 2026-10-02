/* PDF REPORTS. pages v1.95.0 · server w2.37.0 · sheet v1.100.0.

   - The sheet gathers four reports as tables: Outstanding, Fleet and safety
     record, Sunday report and Period summary, each for the dates asked.
   - The coordinator's app lays one out as a PDF: real text, the logo, the
     title and period, "Contains names" and "Page x of y" on every page.
   - The finished file goes back through the live server to the sheet, which
     keeps it in a "Minibus reports" folder in Drive and notes it on History.

   Everything here fails on w2.36.0 / v1.99.0 / v1.94.0. */

import vm from "node:vm";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Suite } from "../lib/t.mjs";
import { makeDB } from "../lib/d1.mjs";
import { loadWorker, env as makeEnv, installGlobals } from "../lib/worker.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { tab } from "../lib/tabs.mjs";
import { seedSunday } from "../lib/seed.mjs";
import { atTime } from "../lib/clock.mjs";

const THU = "2026-10-01T12:00:00+01:00";
const PIN = "1234";
const at = (s) => new Date(s);

export default async function (root) {
  const s = new Suite("PDF reports");
  const G = installGlobals();
  const { mod: W } = await loadWorker(root);
  const J = async (r) => JSON.parse(await r.text());

  function sheet() {
    const L = loadCodeGs(root, { tabs: {
      "Buses": tab("Buses", [
        { Registration: "YS70 PWE", "Seats for passengers": 16, Active: "YES", "MOT due": "31/10/2026", "Insurance due": "30/09/2026" },
        { Registration: "NH56 FWP", "Seats for passengers": 14, Active: "YES", "MOT due": "01/03/2027" }]),
      "Drivers": tab("Drivers", [
        { Name: "Bro Arthur", Role: "Coordinator", Active: "YES" },
        { Name: "Bro Ben", Role: "Driver", Active: "YES" }]),
      "Defects": tab("Defects", [
        { Date: "27/09/2026", Registration: "NH56 FWP", Driver: "Bro Ben", Item: "Tyres", Critical: "YES",
          "What the driver found": "Cut in the sidewall", Status: "Open", Kind: "Defect" },
        { Date: "13/09/2026", Registration: "YS70 PWE", Driver: "Bro Ben", Item: "Wipers", Critical: "",
          "What the driver found": "Smears", Status: "Fixed", "Action taken": "New blades", "Closed on": "20/09/2026", Kind: "Defect" }]),
      "Checks": tab("Checks", [
        { Date: "27/09/2026", Time: "08:40", Registration: "NH56 FWP", Driver: "Bro Ben", Outcome: "Stop",
          "Defect count": 1, "Advisory count": 0, "Authorised by": "Bro Arthur" },
        { Date: "27/09/2026", Time: "08:45", Registration: "YS70 PWE", Driver: "Bro Arthur", Outcome: "Pass", "Defect count": 0 }]),
      "Rota": tab("Rota", [
        { Sunday: "27/09/2026", "North Liverpool scheduled": "Bro Ben", "North bus": "NH56 FWP",
          "South Liverpool scheduled": "Bro Ben", "South Liverpool actual / cover": "Bro Arthur", "South bus": "YS70 PWE",
          Status: "", Notes: "Swapped: north and south" },
        { Sunday: "04/10/2026", "North Liverpool scheduled": "Bro Ben", "North bus": "NH56 FWP", "South bus": "" },
        { Sunday: "11/10/2026", Status: "Cancelled/declined" }]),
      "Trip Events": tab("Trip Events", [
        { Sunday: "27/09/2026", Route: "North", Driver: "Bro Ben", Event: "start", Happened: at("2026-09-27T09:30:00+01:00"), Reg: "NH56 FWP" },
        { Sunday: "27/09/2026", Route: "North", Driver: "Bro Ben", Event: "picked", "Stop ID": "N01", Stop: "Walton Vale",
          Scheduled: at("2026-09-27T09:40:00+01:00"), Happened: at("2026-09-27T09:43:00+01:00"), Offset: 3, Reg: "NH56 FWP" },
        { Sunday: "27/09/2026", Route: "North", Driver: "Bro Ben", Event: "picked", "Stop ID": "N02", Stop: "Gone stop",
          Happened: at("2026-09-27T09:50:00+01:00"), Offset: 1, Status: "undone" },
        { Sunday: "27/09/2026", Route: "North", Driver: "Bro Ben", Event: "end", Happened: at("2026-09-27T10:20:00+01:00"), "Ended by": "Bro Ben" }]),
      "Bus Bookings": tab("Bus Bookings", [
        { Sunday: "27/09/2026", Route: "North", "Stop ID": "N01", Stop: "Walton Vale", Seats: 3, Status: "Booked" },
        { Sunday: "27/09/2026", Route: "North", "Stop ID": "N01", Stop: "Walton Vale", Seats: 2, Status: "Cancelled" }]),
      "Vehicle Log": tab("Vehicle Log", [
        { "Log ID": "VL-1", Registration: "YS70 PWE", What: "Service", Status: "Done", "Date done": "15/09/2026",
          Garage: "Kwik", "Cost (£)": 210.5, "Next due": "15/09/2027" },
        { "Log ID": "VL-2", Registration: "YS70 PWE", What: "MOT", Status: "Booked", "Booked for": "20/10/2026", Garage: "Test centre" }]),
      "History": tab("History", [
        { When: at("2026-09-27T08:50:00+01:00"), Who: "Bro Arthur", Where: "Coordinator app", Registration: "NH56 FWP",
          "What changed": "Defect authorised", From: "", To: "", Why: "Tyres" }]),
      "Rota Requests": tab("Rota Requests", [
        { "Request ID": "REQ-1", Sunday: "04/10/2026", Driver: "Bro Ben", Type: "Cover", Status: "Pending" }])
    } });
    return L;
  }
  const heads = (rep) => rep.sections.map((x) => x.head);
  const sec = (rep, h) => rep.sections.find((x) => x.head === h);

  s.test("Outstanding: stopped buses, renewals, open defects, bookings, rota gaps, requests", async (a) => {
    await atTime(THU, async () => {
      const out = call(sheet(), "pdfReport", "outstanding", "", "");
      a.ok(out.ok, JSON.stringify(out));
      const r = out.report;
      a.eq(r.title, "Outstanding");
      a.eq(r.period, "As at 01/10/2026");
      const stopped = sec(r, "Buses stopped").rows.map((x) => x.join(" | "));
      a.ok(stopped.some((x) => x === "YS70 PWE | Insurance expired 30/09/2026"), stopped.join(" / "));
      a.ok(stopped.some((x) => /^NH56 FWP \| Critical defect: Tyres/.test(x)), stopped.join(" / "));
      const ren = sec(r, "Renewals overdue or due in the next 60 days").rows.map((x) => x.join(" | "));
      a.ok(ren.indexOf("YS70 PWE | MOT | 31/10/2026 | Due in 30 days") !== -1, ren.join(" / "));
      a.not(ren.some((x) => /NH56 FWP/.test(x)), "an MOT five months off is listed");
      a.eq(sec(r, "Open defects and advisories").rows.length, 1);
      a.eq(sec(r, "Booked on the Vehicle Log").rows[0].slice(0, 3).join(" | "), "20/10/2026 | YS70 PWE | MOT");
      a.eq(sec(r, "Rota gaps in the next 8 weeks").rows.map((x) => x.join(" | ")).join(" / "),
           "04/10/2026 | South | No driver, No bus");
      a.eq(sec(r, "Rota requests waiting").rows[0].join(" | "), "04/10/2026 | Bro Ben | Cover");
    });
  });

  s.test("Fleet and safety record: checks, defects, the Vehicle Log and History in the dates asked", async (a) => {
    await atTime(THU, async () => {
      const out = call(sheet(), "pdfReport", "fleet", "2026-09-01", "2026-09-30");
      a.ok(out.ok, JSON.stringify(out));
      const r = out.report;
      a.eq(r.period, "01/09/2026 to 30/09/2026");
      a.eq(heads(r).join(" / "), "Buses / Walkaround checks / Defects reported or closed / Vehicle Log / Changes on History");
      a.eq(sec(r, "Walkaround checks").rows.length, 2);
      a.eq(sec(r, "Defects reported or closed").rows.length, 2);
      a.eq(sec(r, "Vehicle Log").rows.map((x) => x[2] + " " + x[5]).join(" / "), "Service 210.50");
      a.eq(sec(r, "Changes on History").rows[0][2], "Defect authorised");
      const none = call(sheet(), "pdfReport", "fleet", "2026-08-01", "2026-08-31").report;
      a.eq(sec(none, "Walkaround checks").rows.length, 0);
    });
  });

  s.test("Sunday report: the rota, each run, the stops, seats, checks and defects of that day", async (a) => {
    await atTime(THU, async () => {
      const r = call(sheet(), "pdfReport", "sunday", "2026-09-27", "").report;
      a.eq(r.period, "27/09/2026");
      a.eq(sec(r, "Rota").rows.map((x) => x.join(" | ")).join(" / "),
           "North | Running | Bro Ben |  | NH56 FWP | Bro Ben | NH56 FWP / South | Running | Bro Ben | Bro Arthur | YS70 PWE |  | ");
      a.eq(sec(r, "Runs").rows[0].join(" | "), "North | Bro Ben | NH56 FWP | 09:30 | 10:20 |  | 1");
      a.eq(sec(r, "Stops").rows[0].join(" | "), "North | Walton Vale | 09:40 | 09:43 | 3 min late | Picked");
      a.eq(sec(r, "Seats booked").rows.map((x) => x.join(" | ")).join(" / "), "North | Walton Vale | 3 / Total |  | 3");
      a.eq(sec(r, "Walkaround checks").rows.length, 2);
      a.eq(sec(r, "Defects reported").rows[0][1], "Tyres");
      a.eq(call(sheet(), "pdfReport", "sunday", "2026-09-26", "").error, "That is not a Sunday.");
    });
  });

  s.test("Period summary: counts, by route and by driver", async (a) => {
    await atTime(THU, async () => {
      const r = call(sheet(), "pdfReport", "summary", "2026-09-01", "2026-09-30").report;
      const f = {};
      sec(r, "In this period").rows.forEach((x) => { f[x[0]] = x[1]; });
      a.eq(f["Sundays"], "1"); a.eq(f["Runs driven"], "1"); a.eq(f["Seats booked"], "3");
      a.eq(f["Walkaround checks"], "2"); a.eq(f["Defects reported"], "2"); a.eq(f["of which critical"], "1");
      a.eq(f["Defects closed"], "1"); a.eq(f["Cost on the Vehicle Log (£)"], "210.50");
      a.eq(sec(r, "By route").rows[0].join(" | "), "North | 1 | 3 | 1 | 3 min late | 0");
      const d = sec(r, "Drivers").rows.map((x) => x.join(" | "));
      a.ok(d.indexOf("Bro Ben | 1 | 0 | 1 | 1") !== -1, d.join(" / "));
      a.ok(d.indexOf("Bro Arthur | 1 | 1 | 0 | 1") !== -1, d.join(" / "));
      a.eq(call(sheet(), "pdfReport", "summary", "2026-09-30", "2026-09-01").error, "The first date is after the last.");
      a.eq(call(sheet(), "pdfReport", "nothing", "2026-09-01", "2026-09-30").error, "no such report");
    });
  });

  s.test("saving: a PDF goes into the reports folder, once made, and onto History", async (a) => {
    await atTime(THU, async () => {
      const L = sheet();
      const files = [], folders = [];
      const folder = (name) => { const f = { name, id: "F" + folders.length, getId() { return this.id; },
        createFile(b) { files.push(b); return { getUrl: () => "https://drive.example/" + b.name, getId: () => "D1" }; },
        createFolder(n) { return folder(n); } }; folders.push(f); return f; };
      L.ctx.DriveApp = {
        getFolderById: (id) => { const f = folders.find((x) => x.id === id); if (!f) throw new Error("gone"); return f; },
        getFileById: () => ({ getParents: () => { let left = 1; return { hasNext: () => left > 0, next: () => { left--; return folder("Church"); } }; } }),
        createFolder: (n) => folder(n)
      };
      L.ctx.Utilities.newBlob = (bytes, type, name) => ({ bytes, type, name });
      const pdf = Buffer.from("%PDF-1.3 a report").toString("base64");
      const post = (body) => JSON.parse(call(L, "doPost", { postData: { contents: JSON.stringify(
        Object.assign({ token: "minibusapp", action: "pdf" }, body)) } }).getContent());
      const out = post({ step: "save", who: "Bro Arthur", file: { name: "Minibus - Outstanding - 2026-10-01.pdf", data: pdf } });
      a.ok(out.ok, JSON.stringify(out));
      a.eq(out.url, "https://drive.example/Minibus - Outstanding - 2026-10-01.pdf");
      a.eq(files[0].type, "application/pdf");
      a.eq(folders.filter((f) => f.name === "Minibus reports").length, 1);
      post({ step: "save", file: { name: "Second.pdf", data: pdf } });
      a.eq(folders.filter((f) => f.name === "Minibus reports").length, 1, "a second folder was made");
      a.eq(post({ step: "save", file: { name: "x.pdf", data: Buffer.from("<html>").toString("base64") } }).error, "That is not a PDF.");
      a.eq(post({ step: "save", file: { name: "x.html", data: pdf } }).error, "That is not a PDF.");
      const hist = L.gas.ss.getSheetByName("History");
      const last = hist.getRange(hist.getLastRow(), 1, 1, hist.getLastColumn()).getValues()[0];
      a.ok(last.indexOf("PDF report saved") !== -1, JSON.stringify(last));
      const data = post({ step: "data", name: "outstanding" });
      a.ok(data.ok && data.report.title === "Outstanding", JSON.stringify(data).slice(0, 200));
    });
  });

  s.test("the live server carries both calls after the PIN, and refuses what is not a report", async (a) => {
    const db = makeDB(join(root, "server", "schema.sql"));
    const env = makeEnv(db);
    await seedSunday(db, "2026-10-04");
    await db.prepare("DELETE FROM drivers").run();
    await db.prepare("INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,1,?)")
      .bind("Bro Arthur", "Coordinator", "North", 1, await W.pinHashOf(env, "Bro Arthur", PIN)).run();
    await W.cachePut(env, "auth_rules", { roles: ["coordinator"], sameHandBothWays: true }).run();
    await W.cachePut(env, "sheet_url", { url: "https://script.example/exec" }).run();
    const coord = async (body, pin) => J(await W.default.fetch(new Request("https://worker.test/", {
      method: "POST", body: JSON.stringify(Object.assign({ token: "minibusapp", action: "coord", who: "Bro Arthur", pin: pin || PIN }, body)) }), env, {}));
    G.reset();
    a.eq((await coord({ op: "pdf", name: "outstanding" }, "9999")).error, "bad pin");
    a.eq(G.calls.length, 0, "the sheet was asked without a PIN");
    a.eq((await coord({ op: "pdf", name: "nothing" })).error, "no such report");
    G.reply(new Response(JSON.stringify({ ok: true, report: { title: "Outstanding", sections: [] } }), { status: 200 }));
    const got = await coord({ op: "pdf", name: "outstanding" });
    a.eq(got.report.title, "Outstanding");
    const sent = JSON.parse(G.calls[G.calls.length - 1].opts.body);
    a.eq(sent.action + " " + sent.step + " " + sent.name, "pdf data outstanding");
    G.reply(new Response(JSON.stringify({ ok: true, url: "https://drive.example/x", name: "x.pdf" }), { status: 200 }));
    const saved = await coord({ op: "pdfsave", file: { name: "x.pdf", data: "JVBERi0=" } });
    a.eq(saved.url, "https://drive.example/x");
    const sent2 = JSON.parse(G.calls[G.calls.length - 1].opts.body);
    a.eq(sent2.who + " " + sent2.step, "Bro Arthur save");
    a.eq((await coord({ op: "pdfsave", file: { name: "x.pdf", data: "" } })).error, "That file is empty or too big.");
    a.eq((await coord({ op: "load" })).pdf, true);
    G.reset();
  });

  s.test("the PDF: real text, title and period, Contains names and Page x of y on every page", (a) => {
    const ctx = { console, TextEncoder, TextDecoder, atob, btoa, Uint8Array, ArrayBuffer, navigator: { userAgent: "" } };
    ctx.window = ctx; ctx.self = ctx;
    vm.createContext(ctx);
    vm.runInContext(readFileSync(join(root, "coord", "jspdf.umd.min.js"), "utf8"), ctx);
    vm.runInContext(readFileSync(join(root, "coord", "pdf.js"), "utf8"), ctx);
    const rows = [];
    for (let i = 0; i < 90; i++) rows.push(["0" + (i % 9 + 1) + "/09/2026", "YS70 PWE", "Tyres – a long note that has to wrap across more than one line in its column, so the row grows", "Open"]);
    const rep = { name: "fleet", title: "Fleet and safety record", from: "2026-09-01", to: "2026-09-30", period: "01/09/2026 to 30/09/2026",
                  sections: [{ head: "Defects reported or closed", cols: ["Reported", "Bus", "Found", "Status"], rows },
                             { head: "Vehicle Log", cols: ["Date"], rows: [], empty: "None." }] };
    const doc = ctx.reportPdf(rep, { church: "RCCG Dominion Assembly Liverpool", made: "01/10/2026 12:00", who: "Bro Arthur", compress: false });
    const n = doc.getNumberOfPages();
    a.ok(n >= 3, "only " + n + " pages");
    const out = doc.output();
    a.eq(out.slice(0, 5), "%PDF-");
    for (let p = 1; p <= n; p++) a.ok(out.indexOf("(Page " + p + " of " + n + ")") !== -1, "no Page " + p + " of " + n);
    a.eq(out.split("(Contains names)").length - 1, n + 1, "Contains names on every page and in the file's subject");
    a.ok(out.indexOf("(Minibus: fleet and safety record)") !== -1, "the title does not say what it is");
    a.ok(out.indexOf("(RCCG Dominion Assembly Liverpool)") !== -1, "no banner");
    a.ok(out.indexOf("Each bus's due dates") !== -1 || out.indexOf("Each bus\\'s due dates") !== -1, "no line saying what it covers");
    a.ok(out.indexOf("Tyres - a long note") !== -1, "the dash was lost");
    a.ok(/\/Orientation|\/MediaBox \[0 0 841/.test(out), "the fleet record is not landscape");
    a.eq(ctx.reportFileName(rep), "Minibus - Fleet and safety record - 2026-09-01 to 2026-09-30.pdf");
    a.eq(ctx.reportFileName({ name: "outstanding", title: "Outstanding", from: "2026-10-01", to: "2026-10-01" }), "Minibus - Outstanding actions - 2026-10-01.pdf");
  });

  s.test("the coordinator's app: PDF reports on the first screen, the two files beside it", (a) => {
    const html = readFileSync(join(root, "coord", "index.html"), "utf8");
    a.ok(/D && D\.pdf \? item\("pdf", "PDF reports"/.test(html));
    a.ok(html.indexOf('pdfScript("jspdf.umd.min.js') !== -1 && html.indexOf('pdfScript("pdf.js') !== -1);
    a.ok(html.indexOf('api("pdfsave"') !== -1);
    a.ok(html.indexOf("PDF.q === q[0] ? ' class=\"on\"'") !== -1, "a period button does not light up");
    a.ok(html.indexOf("PDF.busy || PDF.made === pdfAsk() ? ' disabled'") !== -1, "Make the PDF stays on after it is made");
    a.ok(/\.field input\[type=date\]\{[^}]*max-width:100%/.test(html), "the date boxes can run past the card");
  });

  return s;
}
