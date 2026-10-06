/* THE DRIVER APP, FROM SUNDAY MORNING TO THE END OF THE RUN, for the driver video.

   The real driver app (index.html at the top of the repo) in Chromium at
   phone width, with the stand-in servers of tests/browser/lib.mjs: the real
   stops, buses and timetable, the invented driver Bro Sample on North in
   NH56 FWP. Each picture also records where the things the animation circles
   are (marks.json, shared with shots.mjs).

     SHOTS=video/build/shots node video/shots-driver.mjs [scene,...]

   clips-driver.js writes North's stop names and times into its captions and
   notifications, so if the timetable moves, this stops and says so. */
import { phone as base, done, SAMPLE, REAL, ROOT, OUT } from "../tests/browser/lib.mjs";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

const ONLY = (process.argv[2] || "").split(",").filter(Boolean);
const want = (id) => !ONLY.length || ONLY.includes(id);
mkdirSync(OUT, { recursive: true });

/* What clips-driver.js was written for. Change both together. */
const EXPECT = {
  N00: ["Church, Chester Road", "10:05"],
  N01: ["Scarisbrick Drive", "10:15"]
};
const off = Object.keys(EXPECT).filter((id) => {
  const s = REAL.stops.find((x) => x.id === id);
  return !s || s.stop.indexOf(EXPECT[id][0]) !== 0 || s.time !== EXPECT[id][1] || !s.active;
});
if (off.length) {
  console.log("The timetable no longer matches the example in the driver video: " + off.map((id) => {
    const s = REAL.stops.find((x) => x.id === id);
    return id + " is " + (s ? '"' + s.stop + '" ' + s.time : "gone") + ", not \"" + EXPECT[id].join('" ') + "\"";
  }).join("; ") + ".\nChange EXPECT here and the stop names and times in clips-driver.js to match.");
  await done();
  process.exit(1);
}

/* The versions the app's foot shows, off the files themselves. */
const grab = (f, re) => (readFileSync(ROOT + "/" + f, "utf8").match(re) || [])[1] || "";
const STAMPS = { sheet: grab("Code.gs", /SCRIPT_VERSION = "([^"]+)"/), server: grab("server/worker.js", /SCRIPT_VERSION = "([^"]+)"/) };
const COORD = REAL.coordinator;
const LEAD = ["Coordinator", "Minister in Charge", "Assistant Coordinator"];
const phone = (o = {}) => base(Object.assign({ timezoneId: "Europe/London", locale: "en-GB", pushOn: true }, o, {
  world: Object.assign({ stamps: STAMPS, coordinator: COORD, leadRoles: LEAD }, o.world || {}) }));

const T = (hm) => Date.parse("2026-09-27T" + hm + ":00+01:00");
const okCheck = () => ({ "NH56 FWP": { state: "ok", at: T("09:40"), driver: SAMPLE, id: "c1" } });
const YARD = { lat: 53.424169, lng: -2.936799, acc: 8, speed: 0 };
const MOVING = { lat: 53.44, lng: -2.95, acc: 8, speed: 11 };
const STILL = { lat: 53.44, lng: -2.95, acc: 8, speed: 0 };
/* 07700 900123 and 900456 are from the range Ofcom keeps for examples. */
const PEOPLE = () => ({ ok: true, route: "North", people: {
  N01: [{ phone: "07700 900123", seats: 2 }],
  N02: [{ phone: "07700 900456", seats: 2 }, { phone: "07700 900789", seats: 1 }] } });

/* A picture, and where each named thing on it is, in CSS pixels of the
   390 x 844 screen: a selector, or the smallest visible element whose words
   start with the text given. "words@1" is the box one level out. */
async function shot(me, name, opt = {}) {
  const pg = me.pg;
  if (opt.top) { await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(250); }
  if (opt.scrollTo) { await pg.evaluate((s) => { const e = document.querySelector(s); if (e) e.scrollIntoView({ block: "center" }); }, opt.scrollTo); await pg.waitForTimeout(300); }
  if (opt.scrollToTop) {
    await pg.evaluate(([sel, off]) => { const e = document.querySelector(sel);
      if (e) window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - off); }, opt.scrollToTop);
    await pg.waitForTimeout(300);
  }
  await pg.screenshot({ path: OUT + "/" + name + ".png" });
  const boxes = await pg.evaluate((specs) => {
    const out = {};
    for (const k in specs) {
      const up = /@(\d+)$/.test(specs[k]) ? Number(specs[k].match(/@(\d+)$/)[1]) : 0;
      const spec = specs[k].replace(/@\d+$/, "");
      let el = null;
      if (/^[#.\[]/.test(spec)) el = [...document.querySelectorAll(spec)].find((e) => e.getClientRects().length) || null;
      else {
        const want = spec.toLowerCase();
        const all = [...document.querySelectorAll("body *")].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight &&
                 (e.textContent || "").trim().replace(/\s+/g, " ").toLowerCase().indexOf(want) === 0;
        });
        all.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height);
        el = all[0] || null;
      }
      for (let i = 0; el && i < up; i++) el = el.parentElement;
      if (el) { const r = el.getBoundingClientRect(); out[k] = { x: r.x, y: r.y, w: r.width, h: r.height }; }
      else out[k] = null;
    }
    return out;
  }, opt.marks || {});
  const f = OUT + "/marks.json";
  const all = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  all[name] = boxes;
  writeFileSync(f, JSON.stringify(all, null, 1));
  const miss = Object.keys(boxes).filter((k) => !boxes[k]);
  console.log("  shot " + name.padEnd(22) + (await me.where()) + (miss.length ? "   MISSING MARKS: " + miss.join(", ") : ""));
  if (miss.length) process.exitCode = 1;
}

const tapStop = (me, kind, id) => me.pg.evaluate(([k, i]) => {
  const b = [...document.querySelectorAll('[data-triptap="' + i + '"][data-tripkind="' + k + '"]')].find(x => x.offsetParent);
  if (b && !b.disabled) { b.click(); return true; } return false;
}, [kind, id]);
async function moveFor(me, secs) { for (let i = 0; i < secs * 2; i++) { await me.emit(MOVING); await me.wait(500); } }
async function stopFor(me, secs) { for (let i = 0; i < secs * 2; i++) { await me.emit(STILL); await me.wait(500); } }
async function hub(me) { await me.load(); await me.close(["howDone"]); await me.signIn(SAMPLE, "1234"); await me.close(["alertAskNot"]); }
async function prep(me) {
  await hub(me); await me.emit(YARD);
  await me.click("Vehicle check", "#s-hub"); await me.pickBus("NH56 FWP"); await me.onward(); await me.close(["busAskStay"]);
  await me.emit(YARD); await me.wait(800);
}
const again = async (me) => { await me.clickId("stopsBack"); await me.toStops(); await me.close(); await me.wait(1500); };

/* The photo the driver takes: a drawing of an oil dipstick, made here so
   nothing but code is kept in the repository. */
async function oilPhoto(me) {
  const f = OUT + "/oil.jpg";
  const pg = await me.ctx.newPage();
  await pg.setViewportSize({ width: 800, height: 600 });
  await pg.setContent('<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">' +
    '<rect width="800" height="600" fill="#3b4148"/><rect x="60" y="80" width="680" height="440" rx="40" fill="#555d66"/>' +
    '<circle cx="260" cy="300" r="90" fill="#f2c200" stroke="#222" stroke-width="10"/>' +
    '<text x="260" y="318" font-family="sans-serif" font-size="46" font-weight="700" text-anchor="middle" fill="#222">OIL</text>' +
    '<rect x="470" y="140" width="22" height="330" rx="8" fill="#c9ccd0"/><rect x="458" y="120" width="46" height="40" rx="12" fill="#f2c200"/>' +
    '<rect x="470" y="400" width="22" height="60" fill="#6b4a12"/><line x1="458" y1="380" x2="504" y2="380" stroke="#222" stroke-width="5"/>' +
    '<line x1="458" y1="440" x2="504" y2="440" stroke="#222" stroke-width="5"/></svg></body>');
  await pg.screenshot({ path: f, type: "jpeg", quality: 85 });
  await pg.close();
  return f;
}

const scenes = [];
const scene = (id, fn) => scenes.push({ id, fn });

/* ---- signing in --------------------------------------------------------- */
scene("d-signin", async () => {
  const me = await phone({ world: { closed: true }, clock: "2026-09-27T09:20:00+01:00" });
  await me.load(); await me.close(["howDone"]);
  await shot(me, "d-name", { marks: { pick: "#driverPick" } });
  await me.pick(SAMPLE);
  await me.pg.fill("#pin", "12"); await me.wait(300);
  await shot(me, "d-pin", { marks: { pick: "#driverPick", pin: "#pin" } });
  return me;
});

scene("d-hub", async () => {
  const me = await phone({ world: { closed: true }, clock: "2026-09-27T09:20:00+01:00" });
  await hub(me);
  await shot(me, "d-hub", { marks: { check: "#toCheck", stops: "#toStops" } });
  return me;
});

/* ---- the check ------------------------------------------------------------ */
scene("d-check", async () => {
  const me = await phone({ world: { closed: true }, clock: "2026-09-27T09:22:00+01:00", permissions: ["geolocation"] });
  await hub(me);
  await me.click("Vehicle check", "#s-hub");
  await shot(me, "d-bus", { marks: { bus: "#vehList button" } });
  await me.pickBus("NH56 FWP"); await me.onward(); await me.close(["busAskStay"]);
  await me.emit(YARD); await me.wait(800);
  await me.setInput("miles", "48262"); await me.fuel(6);
  for (let i = 0; i < 4; i++) { await me.emit(YARD); await me.wait(500); }
  await shot(me, "d-prep", { marks: { miles: "#miles", fuel: "#fuelBar" } });
  await me.onward(); await me.wait(500);
  await me.answerStage({ "Keys": { a: "Fine" } }, true);
  await shot(me, "d-stage", { top: true, marks: { choose: "#itemList .choose", crit: "#itemList .tag.t-crit" } });
  await me.answerStage({ "Tyres": { a: "Defect", note: "Bulge in the sidewall, nearside rear" } }, true);
  await me.wait(300);
  await shot(me, "d-crit", { scrollToTop: ["#itemList .item:nth-child(2)", 170], marks: { tyres: "#itemList .item:nth-child(2)", dash: "#dash" } });
  return me;
});

/* A Defect on the engine oil: it waits for a photo. */
scene("d-photo", async () => {
  const me = await phone({ world: { closed: true }, clock: "2026-09-27T09:24:00+01:00" });
  await prep(me);
  await me.setInput("miles", "48262"); await me.fuel(6); await me.onward(); await me.wait(500);
  await me.answerStage({}); await me.onward(); await me.wait(400);
  await me.answerStage({ "Engine oil": { a: "Defect", note: "Needs a top up" } });
  const card = '#itemList .item:nth-child(' + (await me.pg.evaluate(() =>
    [...document.querySelectorAll("#itemList .item")].findIndex(x => /Engine oil/.test(x.textContent)) + 1)) + ')';
  await shot(me, "d-photo-ask", { scrollToTop: [card, 120], marks: { add: card + " .addpic", count: "#count", item: card } });
  const input = await me.pg.evaluateHandle((c) => document.querySelector(c + " input[type=file]"), card);
  await input.asElement().setInputFiles(await oilPhoto(me));
  await me.wait(1500);
  await me.pg.addStyleTag({ content: ".pic img { visibility: visible !important }" }); await me.wait(200);
  await shot(me, "d-photo-done", { scrollToTop: [card, 120], marks: { pic: card + " .pic", count: "#count", item: card } });
  return me;
});

scene("d-send", async () => {
  const me = await phone({ world: { closed: true }, clock: "2026-09-27T09:26:00+01:00" });
  await prep(me);
  await me.setInput("miles", "48262"); await me.fuel(6); await me.onward(); await me.wait(500);
  await me.walkaround({});
  await me.pg.evaluate(() => { const b = [...document.querySelectorAll("#jobChips button")].find(x => x.textContent.trim() === "Nothing needed"); if (b) b.click(); });
  await me.setInput("sign", SAMPLE);
  await me.pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await me.wait(300);
  await shot(me, "d-review", { marks: { sign: "#sign", jobs: "#jobsCard", send: "#footbar button:last-child" } });
  await me.onward(); await me.wait(1800);
  await shot(me, "d-sent", { top: true, marks: { title: "#sentTitle", verdict: "#sentVerdict", go: "Start your run" } });
  return me;
});

/* ---- the run ---------------------------------------------------------------- */
scene("d-run", async () => {
  const etas = { North: {}, South: {} };
  const world = { checks: okCheck(), etas, trips: { North: null, South: null }, people: PEOPLE };
  const me = await phone({ clock: "2026-09-27T10:03:00+01:00", world });
  await hub(me); await me.toStops(); await me.close();
  await shot(me, "d-ready", { top: true, marks: { start: "Start trip" } });
  await me.jump(2);
  await me.click("Start trip · NH56 FWP", "#s-stops"); await me.wait(1500); await me.close();
  etas.North.N01 = T("10:15");
  await again(me);
  await shot(me, "d-running", { marks: { next: "#stopsBody .stop-row.trip-next", end: "#tripEnd" } });
  /* A minute away: the pop-up. */
  await me.jump(9); await again(me);
  await stopFor(me, 2);
  await shot(me, "d-popup", { marks: { body: "#pickBody", call: "[data-pickcall]", picked: "[data-pick='pickup']", nobody: "[data-pick='empty']" } });
  await moveFor(me, 7);
  await shot(me, "d-popup-moving", { marks: { body: "#pickBody", moving: "#pickMoving" } });
  await stopFor(me, 3);
  await me.pg.click("[data-pick='pickup']"); await me.wait(2500);
  etas.North.N02 = T("10:25");
  await me.wait(1500);
  await shot(me, "d-marked", { scrollTo: '[data-tripundo="N01"]', marks: { undo: '[data-tripundo="N01"]', other: '.trip-row-btns [data-triptap="N01"][data-tripkind="empty"]', row: '[data-tripundo="N01"]@2' } });
  await me.pg.click('[data-tripundo="N01"]'); await me.wait(800);
  await shot(me, "d-undo", { marks: { keep: "#undoKeep", yes: "#undoYes", body: "#undoBody" } });
  await me.pg.click("#undoKeep"); await me.wait(600);
  return me;
});

/* All marked, back at church: End trip. */
scene("d-end", async () => {
  const world = { checks: okCheck(), trips: { North: null, South: null }, people: PEOPLE };
  const me = await phone({ clock: "2026-09-27T10:03:00+01:00", world });
  await hub(me); await me.toStops(); await me.close();
  await me.jump(2);
  await me.click("Start trip · NH56 FWP", "#s-stops"); await me.wait(1500); await me.close();
  /* Each booked stop at its timetable time; nobody at the last one. */
  let at = T("10:05");
  for (const [id, kind] of [["N01", "pickup"], ["N02", "pickup"], ["N04", "pickup"], ["N06", "pickup"], ["N07", "empty"]]) {
    const due = T(REAL.stops.find(s => s.id === id).time);
    await me.jump((due - at) / 60000); at = due;
    await tapStop(me, kind, id); await me.wait(1800);
  }
  await me.jump(12); await me.wait(3000);
  await shot(me, "d-arrived", { marks: { end: "End trip" } });
  await me.click("End trip, arrived at church", "#footbar"); await me.wait(2200);
  await shot(me, "d-finished", { top: true, marks: { done: "Trip finished@1" } });
  return me;
});

for (const s of scenes) {
  if (!want(s.id)) continue;
  let me = null;
  try { me = await s.fn(); } catch (e) { console.log("  FAILED " + s.id + ": " + (e && e.message || e)); process.exitCode = 1; }
  if (me && me.errs.length) { console.log("  page errors in " + s.id + ": " + me.errs.join(" | ")); process.exitCode = 1; }
  if (me) await me.ctx.close();
}
await done();
