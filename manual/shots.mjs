/* THE MANUAL'S PICTURES, taken on the release in this repo.

   The stand-in servers of tests/browser/lib.mjs answer from a fresh download
   of the spreadsheet (manual/export.py writes it; MINIBUS_REAL names it), so
   every stop, time, bus, driver and the coordinator are the real ones. Bro
   Sample is the one invented person; faults, readings and bookings are
   examples. manual/build.sh runs this; by hand:

     MINIBUS_REAL=manual/build/real.json SHOTS=manual/build/shots \
       node manual/shots.mjs [scene,scene,prefix*]                          */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { phone as base, done, SAMPLE, realRows, KEY, REAL, ROOT, OUT } from "../tests/browser/lib.mjs";

/* What the live server stamps on every answer: who to ring, from the Drivers
   tab, and whose titles make a coordinator, COORDINATOR_ROLES in the sheet's
   Script Properties. That one is not in the download, so it is said here. */
const COORD = REAL.coordinator;
const LEAD = (process.env.COORDINATOR_ROLES || "Coordinator,Minister in Charge,Assistant Coordinator")
  .split(",").map(s => s.trim()).filter(Boolean);
/* A second coordinator for the picture of the Authorise button on Stops and
   bookings: somebody who did not do the check and is not driving. */
const OTHER = (REAL.drivers.find(d => d.name !== COORD.name && /assistant/i.test(d.role) && LEAD.includes(d.role)) || COORD).name;
/* The versions, off the files themselves. */
const grab = (f, re) => (readFileSync(ROOT + "/" + f, "utf8").match(re) || [])[1] || "";
const STAMPS = { sheet: grab("Code.gs", /SCRIPT_VERSION = "([^"]+)"/), server: grab("server/worker.js", /SCRIPT_VERSION = "([^"]+)"/) };
mkdirSync(OUT, { recursive: true });
const LEADS = [COORD.name].concat(REAL.drivers.filter(d => d.name !== COORD.name && LEAD.includes(d.role)).map(d => d.name));
writeFileSync(OUT + "/cast.json", JSON.stringify({ coordinator: COORD, other: OTHER, leadRoles: LEAD, leads: LEADS,
  app: grab("index.html", /APP_VERSION = "([^"]+)"/), server: STAMPS.server, sheet: STAMPS.sheet }, null, 1));

/* London time and English dates whatever this machine is set to, and a live
   server of today's shape. A scenario's own world is laid over the top. */
const phone = (o = {}) => base(Object.assign({ timezoneId: "Europe/London", locale: "en-GB" }, o, {
  world: Object.assign({ stamps: STAMPS, coordinator: COORD, leadRoles: LEAD }, o.world || {}) }));

const ONLY = (process.argv[2] || "").split(",").filter(Boolean);
const want = (id) => !ONLY.length || ONLY.includes(id) || ONLY.some(p => p.endsWith("*") && id.startsWith(p.slice(0, -1)));
const T = (hm) => Date.parse("2026-09-27T" + hm + ":00+01:00");
const okCheck = (reg = "NH56 FWP", who = SAMPLE) => ({ [reg]: { state: "ok", at: T("09:40"), driver: who, id: "c1" } });
const CHURCH = { lat: 53.424169, lng: -2.936799, acc: 10, speed: 0 };
const YARD = { lat: 53.424169, lng: -2.936799, acc: 8, speed: 0 };
const AWAY = { lat: 53.463563, lng: -2.959062, acc: 10, speed: 0 };
const HOME = { lat: 53.4375, lng: -2.9660, acc: 12, speed: 0 };
const MOVING = { lat: 53.44, lng: -2.95, acc: 8, speed: 11 };
const STILL = { lat: 53.44, lng: -2.95, acc: 8, speed: 0 };
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const scenes = [];
const scene = (id, fn) => scenes.push({ id, fn });
const tapStop = (me, kind, id) => me.pg.evaluate(([k, i]) => {
  const b = [...document.querySelectorAll('[data-triptap="' + i + '"][data-tripkind="' + k + '"]')].find(x => x.offsetParent);
  if (b && !b.disabled) { b.click(); return true; } return false;
}, [kind, id]);
const tapSel = (me, sel) => me.pg.evaluate(s => { const b = document.querySelector(s); if (b) { b.click(); return true; } return false; }, sel);
async function moveFor(me, secs) { for (let i = 0; i < secs * 2; i++) { await me.emit(MOVING); await me.wait(500); } }
const route = (me, r) => me.pg.evaluate(x => { const b = document.querySelector('[data-stoproute="' + x + '"]'); if (b) b.click(); }, r);
const buttons = (me) => me.pg.$$eval("#s-stops button, #footbar button", bs => bs.filter(x => x.offsetParent).map(x => x.textContent.trim()));

async function hub(me, name = SAMPLE, pin = "1234") {
  await me.load(); await me.close(["howDone"]);
  await me.signIn(name, pin); await me.close(["alertAskNot"]);
}
async function startRun(me, reg = "NH56 FWP") {
  await hub(me); await me.toStops(); await me.close();
  await me.click("Start trip · " + reg, "#s-stops"); await me.wait(1300); await me.close();
}
/* Before you start, for the bus given, ready to answer. */
async function prep(me, reg = "NH56 FWP", where = YARD) {
  await hub(me);
  await me.emit(where);
  await me.click("Vehicle check", "#s-hub");
  await me.pickBus(reg);
  await me.onward();
  await me.close(["busAskStay"]);
}

/* ---------------------------------------------------------------- Part 1 */

scene("hub-cover", async () => {
  const me = await phone({ world: { closed: false }, clock: "2026-09-27T09:05:00+01:00", pushOn: true });
  await hub(me);
  await me.shot("hub-cover");
  return me;
});

scene("install-android", async () => {
  const me = await phone({ ua: ANDROID });
  await me.load(); await me.wait(900);
  await me.shot("install-android");
  return me;
});

scene("install-iphone", async () => {
  const me = await phone({ ua: IPHONE });
  await me.load(); await me.wait(900);
  await me.shot("install-iphone");
  return me;
});

scene("remind-offer", async () => {
  const me = await phone({ world: { closed: false }, clock: "2026-09-27T09:05:00+01:00", pushFake: true, ua: ANDROID });
  await me.load(); await me.close(["howDone"]);
  await me.signIn(SAMPLE, "1234", true);
  await me.wait(800);
  await me.shot("remind-offer", { marks: [] });
  return me;
});

scene("remind-bell", async () => {
  const me = await phone({ world: { closed: false }, clock: "2026-09-27T09:05:00+01:00", pushOn: true, ua: ANDROID });
  await hub(me);
  await me.clickId("alertIcon"); await me.wait(150);
  await me.shot("remind-bell", { marks: [{ n: 1, sel: "#alertIcon", side: "right" }] });
  return me;
});

scene("iphone-offer", async () => {
  const me = await phone({ world: { closed: false }, clock: "2026-09-27T09:05:00+01:00", ua: IPHONE, noPush: true });
  await me.pg.addInitScript(() => { try { localStorage.setItem("fleet.install.v1", "1"); } catch (e) {} });
  await me.load();
  await me.signIn(SAMPLE, "1234", true);
  await me.wait(800);
  await me.shot("iphone-offer");
  return me;
});

scene("iphone-line", async () => {
  const me = await phone({ world: { closed: false }, clock: "2026-09-27T09:05:00+01:00", ua: IPHONE, noPush: true });
  await me.pg.addInitScript(() => { try { localStorage.setItem("fleet.install.v1", "1"); } catch (e) {} });
  await me.load();
  await me.signIn(SAMPLE, "1234");
  await me.close(["alertAskNot"]);
  await me.shot("iphone-line");
  return me;
});

for (const th of ["dark", "green", "navy"]) {
  scene("theme-" + th, async () => {
    const me = await phone({});
    await me.load(); await me.close(["howDone"]);
    await me.pick(SAMPLE); await me.pin("1234");
    /* back to the first screen, as it looks once a PIN is in */
    await me.pg.evaluate(() => { try { show("driver"); } catch (e) {} }); await me.wait(300);
    await me.click(th[0].toUpperCase() + th.slice(1), "#themes", true); await me.wait(300);
    await me.shot("theme-" + th);
    return me;
  });
}

/* ---------------------------------------------------------------- Part 2 */

scene("first-screen", async () => {
  const me = await phone({});
  await me.load(); await me.close(["howDone"]);
  await me.shot("first-screen", { marks: [
    { n: 1, sel: "#driverPick" }, { n: 2, sel: "#s-driver p.tiny", text: "Name missing?" },
    { n: 3, sel: "#themes" }, { n: 4, sel: "#appVersion" }, { n: 5, sel: "#howLink" },
    { n: 6, sel: "#footbar button" } ] });
  return me;
});

scene("first-open", async () => {
  const me = await phone({ world: { noRota: true } });
  await me.load(); await me.close(["howDone"]);
  await me.shot("first-open", { marks: [{ n: 1, sel: "#driver" }] });
  return me;
});

scene("pin-box", async () => {
  const me = await phone({});
  await me.load(); await me.close(["howDone"]);
  await me.pick(SAMPLE);
  await me.shot("pin-box", { marks: [{ n: 1, sel: "#driverPick" }, { n: 2, sel: "#pin", side: "right" }, { n: 3, sel: "#idHint" }] });
  return me;
});

scene("pin-wrong", async () => {
  const me = await phone({ world: { pin: () => ({ ok: true, valid: false, left: 2 }) } });
  await me.load(); await me.close(["howDone"]);
  await me.pick(SAMPLE); await me.pin("1243"); await me.wait(600);
  await me.shot("pin-wrong");
  return me;
});

scene("hub-nopin", async () => {
  const me = await phone({ world: { closed: false }, clock: "2026-09-27T09:05:00+01:00" });
  await me.load(); await me.close(["howDone"]);
  await me.pick(SAMPLE); await me.onward(); await me.wait(500); await me.close(["alertAskNot"]);
  await me.shot("hub-nopin");
  return me;
});

/* ---------------------------------------------------------------- Part 3 */

scene("hub", async () => {
  const me = await phone({ world: { closed: false }, clock: "2026-09-27T09:05:00+01:00", pushFake: true, ua: ANDROID });
  await hub(me);
  await me.shot("hub", { marks: [
    { n: 1, sel: "#hubWho" }, { n: 2, sel: "#hubAlert" }, { n: 3, sel: "#toRota" }, { n: 4, sel: "#toStops", side: "right" },
    { n: 5, sel: "#toCheck" }, { n: 6, sel: "#modeNote" }, { n: 7, sel: "#footbar button" } ] });
  return me;
});

scene("hub-coordinator", async () => {
  const me = await phone({ world: { closed: false }, clock: "2026-09-27T09:05:00+01:00", pushOn: true });
  await hub(me, COORD.name);
  await me.shot("hub-coordinator", { marks: [{ n: 1, sel: "#toCoord" }] });
  return me;
});

scene("hub-pinline", async () => {
  const me = await phone({ world: { closed: false }, clock: "2026-09-27T09:05:00+01:00", pushOn: true });
  await me.load(); await me.close(["howDone"]);
  await me.pick(SAMPLE); await me.onward(); await me.wait(500); await me.close(["alertAskNot"]);
  await me.shot("hub-pinline");
  return me;
});

scene("hub-nobody", async () => {
  const me = await phone({ world: { closed: false }, clock: "2026-09-27T09:05:00+01:00", pushOn: true });
  await me.load(); await me.close(["howDone"]);
  await me.onward(); await me.wait(500);
  await me.shot("hub-nobody");
  return me;
});

scene("hub-waiting", async () => {
  const me = await phone({ world: { closed: false, checkFails: true }, clock: "2026-09-27T09:05:00+01:00", pushOn: true });
  await hub(me);
  await me.offline(true);
  await me.fullCheck({ answers: {} });
  await me.wait(1500);
  await me.clickId("goOn").catch(() => {});
  await me.pg.evaluate(() => { try { goHome(); } catch (e) {} }); await me.wait(600);
  await me.shot("hub-waiting");
  return me;
});

/* The bar across the top, cropped: nothing chosen, checking, amber, red. */
const BAR = { x: 0, y: 0, width: 390, height: 64 };
scene("bar-none", async () => {
  const me = await phone({ world: { closed: false }, clock: "2026-09-27T09:05:00+01:00", pushOn: true });
  await hub(me);
  await me.click("Vehicle check", "#s-hub");
  await me.pg.screenshot({ path: OUT + "/bar-none.png", clip: BAR });
  return me;
});
scene("bar-states", async () => {
  const me = await phone({ world: { closed: false }, clock: "2026-09-27T09:05:00+01:00", pushOn: true });
  await prep(me);
  await me.setInput("miles", "48262"); await me.fuel(6); await me.emit(YARD); await me.wait(400);
  await me.onward(); await me.wait(400);
  await me.answerStage({ "Keys": { a: "Fine" }, "Tyres": { a: "Fine" }, "Wheel nuts": { a: "Fine" } }, true);
  await me.pg.evaluate(() => window.scrollTo(0, 0)); await me.wait(300);
  await me.pg.screenshot({ path: OUT + "/bar-checking.png", clip: BAR });
  await me.answerStage({ "Body and glass": { a: "Defect", note: "Small chip in the screen, passenger side, outside the wiper area" } }, true);
  await me.pg.evaluate(() => window.scrollTo(0, 0)); await me.wait(300);
  await me.pg.screenshot({ path: OUT + "/bar-amber.png", clip: BAR });
  await me.answerStage({ "Tyres": { a: "Defect", note: "Nearside rear has a bulge in the sidewall" } }, true);
  await me.wait(600);
  await me.pg.evaluate(() => window.scrollTo(0, 0)); await me.wait(300);
  const h = await me.pg.evaluate(() => Math.ceil(document.getElementById("dash").getBoundingClientRect().bottom));
  await me.pg.screenshot({ path: OUT + "/bar-red.png", clip: { x: 0, y: 0, width: 390, height: h + 2 } });
  return me;
});

/* ---------------------------------------------------------------- Part 4 */

const OPEN = { "NH56 FWP": [ { item: "Keys and remote", crit: false, kind: "Advisory",
  note: "Remote only works right up against the bus", date: "2026-09-20" } ] };
const W4 = (x = {}) => Object.assign({ closed: false, openDefects: OPEN }, x);
const C4 = "2026-09-27T09:05:00+01:00";

scene("vehicles", async () => {
  const me = await phone({ world: W4(), clock: C4, pushOn: true });
  await hub(me);
  await me.click("Vehicle check", "#s-hub");
  await me.shot("vehicles", { marks: [ { n: 1, sel: "#hello" }, { n: 2, sel: "#vehList button" },
    { n: 3, sel: "#vehList button", nth: 1 }, { n: 4, sel: "#footbar button", side: "right" } ] });
  return me;
});

scene("bus-ask", async () => {
  const me = await phone({ world: W4(), clock: C4, pushOn: true });
  await hub(me);
  await me.click("Vehicle check", "#s-hub");
  await me.pickBus("YS70 PWE");
  await me.onward(); await me.wait(400);
  await me.shot("bus-ask");
  return me;
});

scene("prep", async () => {
  const me = await phone({ world: W4(), clock: C4, pushOn: true });
  await prep(me);
  await me.emit(YARD); await me.wait(1200);
  await me.shot("prep", { marks: [ { n: 1, sel: "#prepTitle" }, { n: 2, sel: "#openBox" }, { n: 3, sel: "#miles" },
    { n: 4, sel: "#milesHint" }, { n: 5, sel: "#fuelBar" }, { n: 6, sel: "#geoLine" } ] });
  return me;
});

scene("prep-renewal", async () => {
  const me = await phone({ world: W4({ dates: { "NH56 FWP": { mot: "2027-04-28", service: "2027-07-01", insurance: "2027-07-08", permit: "2026-10-18" } } }),
                           clock: C4, pushOn: true });
  await prep(me, "NH56 FWP", HOME);
  await me.wait(1200);
  await me.shot("prep-renewal", { marks: [ { n: 1, sel: "#dueBox" }, { n: 2, sel: "#geoLine" } ] });
  return me;
});

scene("prep-lower", async () => {
  const me = await phone({ world: W4(), clock: C4, pushOn: true });
  await prep(me);
  await me.emit(YARD); await me.wait(800);
  await me.setInput("miles", "48188"); await me.wait(400);
  await me.shot("prep-lower");
  return me;
});

scene("prep-ready", async () => {
  const me = await phone({ world: W4(), clock: C4, pushOn: true });
  await prep(me);
  await me.emit(YARD); await me.wait(800);
  await me.setInput("miles", "48262"); await me.fuel(6); await me.wait(400);
  await me.shot("prep-ready", { marks: [ { n: 1, sel: "#milesHint" }, { n: 2, sel: "#fuelBar" }, { n: 3, sel: "#geoLine" },
    { n: 4, sel: "#footbar button", nth: 1, side: "right" } ] });
  return me;
});

async function toStage1(me) {
  await prep(me);
  await me.emit(YARD); await me.wait(800);
  await me.setInput("miles", "48262"); await me.fuel(6); await me.wait(300);
  await me.onward(); await me.wait(500);
}

scene("stage1", async () => {
  const me = await phone({ world: W4(), clock: C4, pushOn: true });
  await toStage1(me);
  await me.shot("stage1", { marks: [ { n: 1, sel: "#steps" }, { n: 2, sel: "#stageEyebrow" }, { n: 3, sel: "#stageLede" },
    { n: 4, sel: "#itemList h3" }, { n: 5, sel: "#itemList .tag.t-crit" }, { n: 6, sel: "#itemList .choose" },
    { n: 7, sel: "#count" }, { n: 8, sel: "#itemList .tag.t-dvsa", side: "right" } ] });
  return me;
});

scene("stage1-answers", async () => {
  const me = await phone({ world: W4(), clock: C4, pushOn: true });
  await toStage1(me);
  await me.answerStage({ "Keys": { a: "Fine" } }, true);
  await me.answerStage({ "Tyres": { a: "Advisory", note: "Nearside rear wearing on the outer edge" } }, true);
  await me.wait(300);
  await me.shot("adv-tyres", { scrollToTop: ["#itemList article:nth-child(2)", 90], top: false });
  await me.answerStage({ "Wheel nuts": { a: "Fine" }, "Lights": { a: "Fine" }, "Front brakes": { a: "Fine" },
    "Passenger and cab doors": { a: "Fine" } }, true);
  await me.answerStage({ "Body and glass": { a: "Defect", note: "Small chip in the screen, passenger side, outside the wiper area" } }, true);
  await me.wait(300);
  await me.shot("defect-body", { scrollToTop: ["#itemList article:nth-child(7)", 90], top: false });
  return me;
});

scene("known-history", async () => {
  const me = await phone({ world: W4(), clock: C4, pushOn: true });
  await toStage1(me);
  await me.answerStage({ "Keys": { a: "Fine" }, "Tyres": { a: "Fine" }, "Wheel nuts": { a: "Fine" } }, true);
  await me.shot("known-history", { scrollToTop: ["#itemList article:nth-child(4)", 90], top: false,
    marks: [ { n: 1, sel: "#itemList .tag.t-watch" }, { n: 2, sel: "#itemList .history" } ] });
  return me;
});

scene("stage1-mudflaps", async () => {
  const me = await phone({ world: W4(), clock: C4, pushOn: true });
  await toStage1(me);
  await me.shot("mudflaps", { scrollTo: "#itemList article:nth-child(13)", top: false });
  return me;
});

scene("stage4-seat", async () => {
  const me = await phone({ world: W4(), clock: C4, pushOn: true });
  await toStage1(me);
  for (let i = 0; i < 3; i++) { await me.answerStage({}); await me.onward(); }
  await me.shot("driver-seat", { scrollTo: "#itemList article:nth-last-child(1)", top: false });
  return me;
});

async function toReview(me, answers, o = {}) {
  await toStage1(me);
  for (let i = 0; i < 4; i++) {
    if ((await me.where()) !== "s-stage") break;
    await me.answerStage(answers); await me.onward();
    if (o.closeCrit) await me.wait(300);
  }
}
const FOUND = { "Tyres": { a: "Advisory", note: "Nearside rear wearing on the outer edge" },
                "Body and glass": { a: "Defect", note: "Small chip in the screen, passenger side, outside the wiper area" } };

scene("review", async () => {
  const me = await phone({ world: W4(), clock: C4, pushOn: true });
  await toReview(me, FOUND);
  await me.shot("review", { marks: [ { n: 1, sel: "#verdict" }, { n: 2, sel: "#jobsCard" } ] });
  await me.pg.evaluate(() => { const b = [...document.querySelectorAll("#jobChips button")].find(x => x.textContent.trim() === "Tyres need air"); if (b) b.click(); });
  await me.setInput("sign", SAMPLE);
  await me.pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await me.wait(300);
  await me.shot("review-signed", { top: false, marks: [ { n: 1, sel: "#jobsCard" }, { n: 2, sel: "#sumBox" },
    { n: 3, sel: "#sign" }, { n: 4, sel: "#footbar button", nth: 1, side: "right" } ] });
  await me.onward(); await me.wait(1500);
  const share = await me.pg.evaluate(() => { try { return recText(lastRec); } catch (e) { return "ERR " + e.message; } });
  writeFileSync(OUT + "/share.txt", share);
  await me.shot("complete", { marks: [ { n: 1, sel: "#sentTitle" }, { n: 2, sel: "#sendStatus" }, { n: 3, sel: "#sentVerdict" },
    { n: 4, sel: "#footbar button", side: "left" }, { n: 5, sel: "#footbar button", nth: 1, side: "right" } ] });
  return me;
});

const CRIT = { "Tyres": { a: "Defect", note: "Nearside rear has a bulge in the sidewall" } };
scene("stopped", async () => {
  const me = await phone({ world: W4(), clock: C4, pushOn: true });
  await toStage1(me);
  await me.answerStage({ "Keys": { a: "Fine" } }, true);
  await me.answerStage(CRIT, true);
  await me.wait(200);
  await me.shot("crit-tyres", { top: false, scrollToTop: ["#itemList article:nth-child(2)", 170] });
  await me.wait(2500);
  await me.answerStage(CRIT); await me.onward();
  for (let i = 0; i < 3; i++) { await me.answerStage({}); await me.onward(); }
  await me.pg.evaluate(() => { const b = [...document.querySelectorAll("#jobChips button")].find(x => x.textContent.trim() === "Nothing needed"); if (b) b.click(); });
  await me.setInput("sign", SAMPLE);
  await me.shot("bus-not-run");
  await me.onward(); await me.wait(1500);
  await me.shot("bus-stopped");
  return me;
});

scene("stops-after-stop", async () => {
  const me = await phone({ world: { closed: true, checks: { "NH56 FWP": { state: "stopped", at: T("09:15"), driver: SAMPLE, id: "c9", item: "Tyres" } } },
                           clock: "2026-09-27T09:50:00+01:00", pushOn: true });
  await hub(me); await me.toStops(); await me.close();
  await me.shot("stops-after-stop", { marks: [ { n: 1, sel: "#stopsBody b", text: "NH56 FWP was stopped" } ] });
  return me;
});

scene("held", async () => {
  const me = await phone({ world: W4(), clock: C4, pushOn: true });
  await toReview(me, FOUND);
  await me.pg.evaluate(() => { const b = [...document.querySelectorAll("#jobChips button")].find(x => x.textContent.trim() === "Tyres need air"); if (b) b.click(); });
  await me.setInput("sign", SAMPLE);
  await me.offline(true);
  await me.onward(); await me.wait(2500);
  await me.shot("held", { marks: [ { n: 1, sel: "#banner" }, { n: 2, sel: "#sendStatus" } ] });
  await me.pg.evaluate(() => { try { renderPending(); show("pending"); } catch (e) {} }); await me.wait(500);
  await me.shot("pending", { marks: [ { n: 1, sel: "#pendList > *" }, { n: 2, sel: "#flush", side: "right" } ] });
  return me;
});

/* ---------------------------------------------------------------- Part 5 */

const RUN = (x = {}) => Object.assign({ checks: okCheck() }, x);
/* The live server estimates every pickup still ahead once a stop is marked. */
const ETAS = { North: { N02: T("10:25"), N03: T("10:32"), N04: T("10:37"), N05: T("10:41"), N06: T("10:45"), N07: T("10:48"), N08: T("10:51") } };
const TXT = "#stopsBody p, #stopsBody b, #stopsBody span, #stopsBody div, #stopsBody a, #stopsBody button";

scene("stops-before", async () => {
  const me = await phone({ world: { closed: false, checks: okCheck() }, clock: "2026-09-27T09:10:00+01:00", pushOn: true });
  await hub(me); await me.toStops(); await me.close();
  await me.shot("stops-before", { marks: [ { n: 1, sel: TXT, text: "Bookings for" }, { n: 2, sel: TXT, text: "Signed in as" },
    { n: 3, sel: '[data-stoproute="North"]' }, { n: 4, sel: TXT, text: "North Liverpool" },
    { n: 5, sel: TXT, text: "Bookings close" } ] });
  return me;
});

scene("stops-ready", async () => {
  const me = await phone({ world: RUN(), clock: "2026-09-27T10:03:00+01:00", pushOn: true });
  await hub(me); await me.toStops(); await me.close();
  await me.shot("stops-ready", { marks: [ { n: 1, sel: "#stopsBody button", text: "Start trip" },
    { n: 2, sel: TXT, text: "Tap each stop" } ] });
  return me;
});

scene("pin-confirm", async () => {
  const me = await phone({ world: RUN(), clock: "2026-09-27T10:03:00+01:00", pushOn: true });
  await me.load(); await me.close(["howDone"]);
  await me.pick(SAMPLE); await me.onward(); await me.wait(500); await me.close(["alertAskNot"]);
  await me.toStops(); await me.wait(800);
  await me.shot("pin-confirm");
  return me;
});

scene("no-check", async () => {
  const me = await phone({ world: { checks: {} }, clock: "2026-09-27T10:03:00+01:00", pushOn: true });
  await hub(me); await me.toStops(); await me.close();
  await me.click("Start trip · NH56 FWP", "#s-stops"); await me.wait(1500); await me.close();
  await me.shot("no-check", { marks: [ { n: 1, sel: TXT, text: "No check signed" }, { n: 2, sel: "#tripDoCheck" },
    { n: 3, sel: "#tripStartAnyway" } ] });
  return me;
});

scene("authorised", async () => {
  const me = await phone({ world: { checks: { "NH56 FWP": { state: "authorised", at: T("09:15"), driver: SAMPLE, id: "c9", by: COORD.name, authAt: T("09:32") } } },
                           clock: "2026-09-27T10:03:00+01:00", pushOn: true });
  await hub(me); await me.toStops(); await me.close();
  await me.shot("authorised", { marks: [ { n: 1, sel: TXT, text: "NH56 FWP is authorised" } ] });
  return me;
});

scene("run", async () => {
  const me = await phone({ world: RUN(), clock: "2026-09-27T10:04:00+01:00", pushOn: true });
  await hub(me); await me.toStops(); await me.close();
  await me.jump(1);
  await me.click("Start trip · NH56 FWP", "#s-stops"); await me.wait(1500); await me.close();
  await me.shot("run-start", { marks: [ { n: 1, sel: TXT, text: "Running since" }, { n: 2, sel: "#stopsBody a", text: "L11 7DD" },
    { n: 3, sel: TXT, text: "2 people waiting" }, { n: 4, sel: ".trip-actions button" },
    { n: 5, sel: ".trip-actions button", nth: 1 }, { n: 6, sel: "#tripEnd", side: "right" } ] });
  /* a thumb straight after setting off */
  await tapStop(me, "pickup", "N01"); await me.wait(250);
  await me.shot("run-too-soon");
  await me.wait(13000);
  await me.jump(12);
  me.world.etas = ETAS; me.world.offset = { North: 2 };
  await tapStop(me, "pickup", "N01"); await me.wait(6500);
  await me.shot("run-one", { top: false, scrollToTop: [".trip-at", 330], marks: [ { n: 1, sel: TXT, text: "Picked up 10:1" }, { n: 2, sel: "[data-tripundo]", side: "right" },
    { n: 3, sel: ".stop-time-eta" } ] });
  await moveFor(me, 5);
  await me.shot("run-moving", { marks: [ { n: 1, sel: "#tripMoving" } ] });
  await me.wait(4000);
  return me;
});

scene("run-skip", async () => {
  const me = await phone({ world: RUN(), clock: "2026-09-27T10:04:00+01:00", pushOn: true });
  await hub(me); await me.toStops(); await me.close();
  await me.jump(1);
  await me.click("Start trip · NH56 FWP", "#s-stops"); await me.wait(1500); await me.close();
  await me.jump(10); await tapStop(me, "pickup", "N01"); await me.wait(3500);
  await me.jump(20);
  /* past Grace Road without marking it; somebody gets on at the nursery */
  await tapStop(me, "pickup", "N03"); await me.wait(3500);
  await me.shot("run-skip-ask", { top: false, scrollTo: ".trip-ask" });
  await me.pg.evaluate(() => { const b = document.querySelector("[data-tripskip]"); if (b) b.click(); }); await me.wait(3500);
  await me.shot("run-gone-past", { scrollTo: ".trip-past", top: false });
  return me;
});

scene("run-offline", async () => {
  const me = await phone({ world: RUN(), clock: "2026-09-27T10:04:00+01:00", pushOn: true });
  await hub(me); await me.toStops(); await me.close();
  await me.jump(1);
  await me.click("Start trip · NH56 FWP", "#s-stops"); await me.wait(1500); await me.close();
  await me.jump(10); await tapStop(me, "pickup", "N01"); await me.wait(3500);
  await me.jump(8); await tapStop(me, "pickup", "N02"); await me.wait(3500);
  await me.jump(13); await tapStop(me, "pickup", "N04"); await me.wait(3500);
  await me.offline(true);
  await me.jump(9); await tapStop(me, "pickup", "N06"); await me.wait(3500);
  await me.jump(3); await tapStop(me, "empty", "N07"); await me.wait(3500);
  await me.shot("run-offline", { marks: [ { n: 1, sel: "#tripWait, .trip-waiting" }, { n: 2, sel: TXT, text: "Every stop marked" } ] });
  await me.offline(false); await me.wait(6000);
  await me.shot("run-all-marked");
  await me.jump(14); await me.wait(6000);
  await me.shot("run-late");
  await me.click("End trip, arrived at church", "#footbar"); await me.wait(2000);
  await me.shot("run-finished");
  return me;
});

scene("run-auto", async () => {
  const me = await phone({ world: RUN(), clock: "2026-09-27T10:03:00+01:00", pushOn: true });
  await startRun(me);
  await me.jump(20); await me.emit(AWAY); await me.wait(500);
  await me.jump(30); await me.emit(CHURCH); await me.wait(500);
  await me.jump(4); await me.emit(CHURCH); await me.wait(7000);
  await me.shot("run-auto", { marks: [ { n: 1, sel: TXT, text: "Trip finished" }, { n: 2, sel: TXT, text: "Ended automatically" },
    { n: 3, sel: "#tripAutoUndo" } ] });
  return me;
});

scene("run-noname", async () => {
  const me = await phone({ world: RUN(), clock: "2026-09-27T10:03:00+01:00", pushOn: true });
  await startRun(me);
  await me.jump(12);
  await me.pg.evaluate(() => { try { st.driver = ""; signSave(); } catch (e) {} for (const k of Object.keys(localStorage)) if (/sign|driver\.v|who/i.test(k) && !/trip/.test(k)) localStorage.removeItem(k); });
  await me.load(); await me.close(["howDone"]);
  await me.toStops(); await me.close();
  await me.shot("run-noname", { marks: [ { n: 1, sel: TXT, text: "Nobody is signed in" } ] });
  return me;
});

scene("other-route", async () => {
  const south = { trip: "t-s", route: "South", reg: "YS70 PWE", driver: "Bro Tunde", started: T("10:16"), ended: 0,
    served: { S01: { at: T("10:25"), event: "pickup" } }, lastStop: "Dewsbury Road by Lynholme Road", lastAt: T("10:25"), offset: 1 };
  const me = await phone({ world: RUN({ trips: { North: null, South: south },
    etas: { North: {}, South: { S02: T("10:29"), S03: T("10:33"), S04: T("10:36"), S05: T("10:39"), S06: T("10:45"), S07: T("10:48"), S08: T("10:51") } } }),
    clock: "2026-09-27T10:27:00+01:00", pushOn: true });
  await hub(me); await me.toStops(); await me.close();
  await route(me, "South"); await me.wait(1500);
  await me.shot("other-route", { marks: [ { n: 1, sel: TXT, text: "Bro Tunde is out" } ] });
  return me;
});

scene("cover", async () => {
  const rows = realRows(rs => { rs.find(r => r.date === KEY).primary = "Bro Adebola"; return rs; });
  const me = await phone({ world: RUN({ rows }), clock: "2026-09-27T09:52:00+01:00", pushOn: true });
  await hub(me); await me.toStops(); await me.close();
  await me.shot("cover-offer", { scrollTo: "#tripCover", top: false, marks: [ { n: 1, sel: "#tripCover" } ] });
  await me.click("I am covering this run", "#s-stops"); await me.wait(300);
  await me.shot("cover-confirm", { scrollTo: "#tripCover", top: false });
  await me.click("Confirm: you are covering North", "#s-stops"); await me.wait(150);
  await me.shot("cover-bus");
  return me;
});

scene("rehearsal", async () => {
  const R = T("09:40");
  const me = await phone({ world: RUN({ rehearsal: { round: R, ends: T("10:30"), shape: "normal" } }), clock: "2026-09-27T09:52:00+01:00", pushOn: true });
  await hub(me); await me.toStops(); await me.close();
  await me.shot("rehearsal", { marks: [ { n: 1, sel: ".trip-rehearsal" } ] });
  return me;
});

/* ---------------------------------------------------------------- Part 6 */

/* The rota as the export has it, with Bro Sample written into a few Sundays
   to show what a card can say. Only the Sundays he is on are invented. */
const ROTA = () => realRows(rs => {
  const at = (d) => rs.find(r => r.date === d);
  let r = at("2026-10-11"); r.primary2 = "Bro Adesina"; r.actual2 = SAMPLE;
  r = at("2026-10-25"); r.primary = SAMPLE; r.locked = true; r.lockNote = "Harvest Sunday";
  r = at("2026-11-01"); r.actual = SAMPLE; r.swaps = [{ a: SAMPLE, b: "Bro Abiodun" }];
  r = at("2026-11-22"); r.primary = SAMPLE;
  r.requests = [{ driver: SAMPLE, type: "Holiday / planned leave", status: "Pending" }]; r.request = r.requests[0]; r.status = "Change requested";
  return rs;
});
const W6 = (x = {}) => Object.assign({ closed: false, rows: ROTA() }, x);
const C6 = "2026-09-27T08:40:00+01:00";
async function rota(me) { await me.click("Driving rota", "#s-hub"); await me.wait(1500); await me.close(); }

scene("rota", async () => {
  const me = await phone({ world: W6(), clock: C6, pushOn: true });
  await hub(me); await rota(me);
  await me.shot("rota", { marks: [ { n: 1, sel: "#rotaToday" }, { n: 2, sel: "#rotaMyDuties", side: "right" }, { n: 3, sel: "#rotaViewing" },
    { n: 4, sel: "#rotaStopsBtn", side: "right" }, { n: 5, sel: "#rotaEarlier" }, { n: 6, sel: ".rota-current" },
    { n: 7, sel: ".rota-you", side: "right" }, { n: 8, sel: ".rota-edit", side: "right" } ] });
  await me.shot("rota-cards", { top: false, scrollToTop: ["#rota-2026-10-11", 70] });
  await me.shot("rota-swap", { top: false, scrollToTop: ["#rota-2026-11-01", 70] });
  await me.clickId("rotaMyDuties"); await me.wait(600);
  await me.shot("rota-mine");
  return me;
});

scene("rota-request", async () => {
  const me = await phone({ world: W6(), clock: C6, pushOn: true });
  await hub(me); await rota(me);
  await tapSel(me, '[data-rota-request="2026-09-27"]'); await me.wait(600);
  await me.shot("rota-request");
  await me.pg.selectOption("#rotaReqType", { label: "Request a swap" }).catch(() => {}); await me.wait(400);
  await me.pg.selectOption("#rotaSwapWith", { label: "Bro Moses" }).catch(() => {}); await me.wait(400);
  await me.pg.evaluate(() => { const s = document.getElementById("rotaSwapDate"); if (s && s.options.length > 1) { s.selectedIndex = 1; s.dispatchEvent(new Event("change", { bubbles: true })); } });
  await me.wait(300);
  await me.pg.evaluate(() => { const c = document.getElementById("rotaSwapAgreed"); if (c && !c.checked) c.click(); }); await me.wait(300);
  await me.shot("rota-swap-sheet", { top: false });
  return me;
});

scene("rota-protected", async () => {
  const me = await phone({ world: W6(), clock: C6, pushOn: true });
  await hub(me); await rota(me);
  await tapSel(me, '[data-rota-request="2026-10-25"]'); await me.wait(600);
  await me.shot("rota-protected", { top: false });
  return me;
});

scene("rota-sent", async () => {
  const me = await phone({ world: W6(), clock: C6, pushOn: true });
  await hub(me); await rota(me);
  await tapSel(me, '[data-rota-request="2026-09-27"]'); await me.wait(600);
  await me.pg.selectOption("#rotaReqType", { label: "Holiday / planned leave" }).catch(() => {});
  await me.setInput("rotaReqReason", "Away at a family wedding in Manchester");
  /* Long enough for "Request sent." to have gone, so it does not cover the card. */
  await me.clickId("rotaSubmitRequest"); await me.wait(4500);
  await me.shot("rota-after-ask", { marks: [ { n: 1, sel: "#rota-2026-09-27 .rota-leg" } ] });
  return me;
});

/* ---------------------------------------------------------------- Part 8 */

scene("coord-mode", async () => {
  const me = await phone({ world: W4(), clock: C4, pushOn: true });
  await me.load(); await me.close(["howDone"]); await me.emit(YARD);
  await me.signIn(COORD.name); await me.close(["alertAskNot"]);
  await me.click("Vehicle check", "#s-hub"); await me.pickBus("NH56 FWP"); await me.onward(); await me.close(["busAskStay"]);
  await me.wait(800);
  await me.shot("coord-mode", { marks: [ { n: 1, sel: "#modeCard" } ] });
  await me.clickId("modeFull"); await me.wait(400);
  await me.setInput("miles", "48262"); await me.fuel(6); await me.onward(); await me.wait(500);
  await me.answerStage({ "Keys": { a: "Fine" }, "Tyres": { a: "Fine" }, "Wheel nuts": { a: "Fine" } }, true);
  await me.answerStage({ "Spare wheel": { a: "Not on this bus" } }, true); await me.wait(300);
  await me.shot("coord-na", { top: false, scrollToTop: ["#itemList article:nth-child(4)", 90] });
  return me;
});

scene("coord-authorise", async () => {
  const me = await phone({ world: W4(), clock: C4, pushOn: true });
  await me.load(); await me.close(["howDone"]); await me.emit(YARD);
  await me.signIn(COORD.name); await me.close(["alertAskNot"]);
  await me.click("Vehicle check", "#s-hub"); await me.pickBus("NH56 FWP"); await me.onward(); await me.close(["busAskStay"]);
  await me.setInput("miles", "48262"); await me.fuel(6); await me.onward(); await me.wait(500);
  await me.answerStage(CRIT); await me.onward(); await me.wait(2600);
  for (let i = 0; i < 3; i++) { await me.answerStage({}); await me.onward(); }
  await me.pg.evaluate(() => { const b = [...document.querySelectorAll("#jobChips button")].find(x => x.textContent.trim() === "Nothing needed"); if (b) b.click(); });
  await me.setInput("sign", COORD.name);
  await me.onward(); await me.wait(2600);
  await me.shot("coord-auth-button", { top: false, scrollTo: ".auth-btn", marks: [ { n: 1, sel: ".auth-btn" } ] });
  await tapSel(me, ".auth-btn"); await me.wait(500);
  await me.shot("coord-auth-sheet");
  await me.pg.fill("#authPin", "1234"); await me.wait(200);
  await me.clickId("authGo"); await me.wait(300);
  await me.wait(2500);
  await me.shot("coord-authorised");
  return me;
});

scene("coord-stops", async () => {
  const STOPPED = { "NH56 FWP": { state: "stopped", at: T("09:05"), driver: SAMPLE, id: "c9", item: "Tyres" } };
  const me = await phone({ world: { checks: STOPPED, closed: false }, clock: "2026-09-27T09:12:00+01:00", pushOn: true });
  await hub(me, OTHER); await me.toStops(); await me.close();
  await me.shot("coord-stops", { marks: [ { n: 1, sel: TXT, text: "NH56 FWP was stopped" }, { n: 2, sel: "#stopsBody button", text: "Authorise NH56 FWP" } ] });
  return me;
});

scene("coord-endrun", async () => {
  const north = { trip: "t-n", route: "North", reg: "NH56 FWP", driver: SAMPLE, started: T("10:05"), ended: 0,
    served: { N01: { at: T("10:16"), event: "pickup" }, N02: { at: T("10:24"), event: "pickup" }, N04: { at: T("10:37"), event: "pickup" },
              N06: { at: T("10:46"), event: "pickup" }, N07: { at: T("10:49"), event: "empty" } },
    lastStop: "Pym Street bus stop, County Road", lastAt: T("10:49"), offset: 1 };
  const me = await phone({ world: RUN({ trips: { North: north, South: null } }), clock: "2026-09-27T11:40:00+01:00", pushOn: true });
  await hub(me, COORD.name); await me.toStops(); await me.close();
  await me.shot("coord-endrun", { marks: [ { n: 1, sel: "#tripEndOther, [data-endroute]" } ] });
  await tapSel(me, "[data-endroute]"); await me.wait(500);
  await me.shot("coord-endrun-sheet");
  return me;
});

/* ---------------------------------------------------------------- run */
for (const s of scenes) {
  if (!want(s.id)) continue;
  let me = null;
  try { me = await s.fn(); }
  catch (e) { console.log("  FAILED " + s.id + ": " + (e && e.message || e)); }
  if (me && me.errs && me.errs.length) console.log("  page errors in " + s.id + ": " + me.errs.join(" | "));
  if (me) await me.ctx.close();
}
await done();
