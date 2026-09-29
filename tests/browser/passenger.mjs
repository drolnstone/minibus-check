/* THE PASSENGER PAGE, ON THE 27 SEPTEMBER RULINGS.

   The real page, in Chromium, at phone width, answered by a stand-in for the
   Worker built from the real stops. Each check fails on v1.74.10 and passes
   on v1.75.0.

     node tests/browser/passenger.mjs [P1,P2,...]

   Photographs go to $SHOTS (default: the system temp folder), for a person to
   look at. */
import { browser, done, KEY, REAL, OUT } from "./lib.mjs";
import { mkdirSync } from "node:fs";

const PORT = Number(process.env.MINIBUS_PORT || 8113);
const ONLY = (process.argv[2] || "").split(",").filter(Boolean);
const want = (id) => !ONLY.length || ONLY.includes(id);
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok });
  console.log((ok ? "  ✓ " : "  ✗ ") + id + "  " + name + (ok ? "" : "   [" + detail + "]"));
}
try { mkdirSync(OUT, { recursive: true }); } catch (e) {}

const pub = (s) => ({ route: s.route, id: s.id, time: s.time, stop: s.stop, postcode: s.postcode,
                      arrival: s.kind === "arrival", depart: false });
const STOPS = REAL.stops.filter((s) => s.kind === "pickup").map(pub);
const ARRIVALS = REAL.stops.filter((s) => s.kind === "arrival").map(pub);
const S03 = STOPS.find((s) => s.id === "S03");

async function passenger(o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const pg = await ctx.newPage();
  const errs = [], asked = [];
  pg.on("pageerror", (e) => errs.push(String(e.message)));
  /* A phone that has never been asked about notifications, and has already
     seen the install sheet, so the alerts offer is the one that comes up. */
  await pg.addInitScript(`(() => {
    try { localStorage.setItem("bus.install.v1", "1"); } catch (e) {}
    ${o.pid ? 'try { localStorage.setItem("bus.pid.v1", "pid-me"); localStorage.setItem("bus.phone.v1", "07700900123"); } catch (e) {}' : ""}
    try { Object.defineProperty(Notification, "permission", { get: () => "default", configurable: true }); } catch (e) {}
    if (window.PushManager) PushManager.prototype.getSubscription = async function () { return null; };
  })()`);
  await pg.route("**://*.workers.dev/**", async (route) => {
    const u = new URL(route.request().url());
    const p = u.searchParams;
    asked.push(u.search);
    let body = { ok: true, server: "w2.16.0", sheet: "v1.80.0" };
    if (p.get("bus")) {
      body = Object.assign(body, { date: KEY, closed: !!o.closed, rehearsal: o.rehearsal || false, rolled: false,
        cutoff: "Sunday 09:30", stops: STOPS, arrivals: ARRIVALS, off: [], counts: { S03: 3, N02: 2 },
        driver: null, phone: o.booked ? "07700900123" : "", stopGone: "",
        mine: o.booked ? { stopId: "S03", seats: 2 } : null, seats: {} });
    } else if (p.get("trip")) {
      body = Object.assign(body, o.trip || { live: false, why: "open", date: KEY });
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await pg.goto("http://127.0.0.1:" + PORT + "/sunday/", { waitUntil: "networkidle" });
  /* The subscription lookup waits up to four seconds for a service worker
     that is blocked here, then the offer rises half a second later. */
  await pg.waitForTimeout(o.wait || 5200);
  await pg.addStyleTag({ content: 'img { visibility: hidden }' });
  const me = { pg, ctx, errs, asked };
  me.text = (sel) => pg.$eval(sel, (n) => (n.innerText || n.textContent || "").trim()).catch(() => "");
  me.up = () => pg.$eval("#alertAsk", (n) => n.classList.contains("is-on")).catch(() => false);
  me.shot = (name) => pg.screenshot({ path: OUT + "/" + name + ".png" });
  return me;
}

/* P1: somebody with no seat is offered alerts, and told to book */
if (want("P1")) {
  const me = await passenger({});
  const up = await me.up();
  const line = await me.text("#alertAskLine");
  const title = await me.text("#alertAskTitle");
  await me.shot("P1-offer-no-booking");
  check("P1", "a phone with no booking is offered alerts and told to book",
        up && line === "No seat booked. Book below." && /alerts/i.test(title),
        "offer up " + up + ", title '" + title + "', line '" + line + "'");
  await me.ctx.close();
}

/* P2: somebody with a seat is offered alerts and told what they have booked */
if (want("P2")) {
  const me = await passenger({ booked: true, pid: true });
  const up = await me.up();
  const line = await me.text("#alertAskLine");
  await me.shot("P2-offer-booked");
  check("P2", "a booked phone is told its stop, seats and Sunday on the offer",
        up && line.indexOf("Booked for ") === 0 && line.indexOf(S03.stop) > -1 && /2 seats\.$/.test(line),
        "offer up " + up + ", line '" + line + "'");
  await me.ctx.close();
}

/* The live panel, once bookings have closed and the bus has left church. */
const leftChurch = (over) => Object.assign({
  live: true, date: KEY, now: Date.now(), route: "South", watching: false, rehearsal: false, routes: [],
  stop: S03.stop, stopId: "S03", scheduled: S03.time, started: true, ended: false,
  startedAtWords: "10:25", lastStop: "", lastAgo: 2, lastAtWords: "10:25",
  mine: "eta", offset: 4, etaWords: "10:41", minutes: 12, imminent: false
}, over || {});

/* P3: the estimate is on the page from the moment the bus leaves church */
if (want("P3")) {
  const me = await passenger({ booked: true, pid: true, closed: true, trip: leftChurch() });
  await me.pg.evaluate(() => { const b = document.getElementById("alertAskNot"); if (b) b.click(); });
  await me.pg.waitForTimeout(300);
  const big = await me.text("#live .live-big");
  const sub = await me.text("#live .live-sub");
  const bold = await me.pg.$$eval("#live .live-sub b", (bs) => bs.map((b) => b.textContent));
  const rowTime = await me.pg.$eval('[data-stop="S03"] .stop-time', (t) =>
    ({ text: t.textContent, weight: getComputedStyle(t).fontWeight })).catch(() => ({}));
  const other = await me.pg.$eval('[data-stop="S04"] .stop-time', (t) =>
    ({ text: t.textContent, weight: getComputedStyle(t).fontWeight })).catch(() => ({}));
  await me.shot("P3-estimate-leaving-church");
  check("P3", "straight out of church the panel gives the estimate, in bold, with no timetabled time",
        big === "12 min" && bold.indexOf("10:41") > -1 && sub.indexOf("timetabled") === -1 &&
        sub.indexOf("4 minutes behind schedule") > -1 && sub.indexOf("Left church 10:25") > -1,
        "big '" + big + "', sub '" + sub + "', bold " + JSON.stringify(bold));
  check("P3b", "his own stop's row shows the estimate in bold, and the other rows the timetable in plain",
        rowTime.text === "10:41" && Number(rowTime.weight) >= 700 && other.text === "10:36" && Number(other.weight) < 600,
        "own row " + JSON.stringify(rowTime) + ", next row " + JSON.stringify(other));
  await me.ctx.close();
}

/* P4: ahead of schedule, in those words */
if (want("P4")) {
  const me = await passenger({ booked: true, pid: true, closed: true,
    trip: leftChurch({ offset: -2, lastStop: "Vicar Road", lastAtWords: "10:31", minutes: 5, etaWords: "10:35" }) });
  const sub = await me.text("#live .live-sub");
  check("P4", "a bus in front of the timetable is 'minutes ahead of schedule'",
        sub.indexOf("2 minutes ahead of schedule") > -1 && sub.indexOf("early") === -1,
        "sub '" + sub + "'");
  await me.ctx.close();
}

/* P5: an estimate past its time still tells him to be at his stop */
if (want("P5")) {
  const me = await passenger({ booked: true, pid: true, closed: true,
    trip: leftChurch({ lastStop: "Vicar Road", lastAtWords: "10:33", minutes: -4, imminent: true }) });
  await me.pg.evaluate(() => { const b = document.getElementById("alertAskNot"); if (b) b.click(); });
  await me.pg.waitForTimeout(300);
  const big = await me.text("#live .live-big");
  const sub = await me.text("#live .live-sub");
  await me.shot("P5-estimate-kept");
  check("P5", "four minutes past the estimate the panel still says be at your stop, and not that the bus is a minute away",
        big === "Be at your stop" && sub.indexOf("a minute or two away") === -1 && sub.indexOf("10:41") > -1,
        "big '" + big + "', sub '" + sub + "'");
  await me.ctx.close();
}

/* P6: the page lets go of a rehearsal when it ends. Until v1.79.0 it went
   on showing the test morning until somebody reloaded it. */
if (want("P6")) {
  const R = Date.now() - 600000;
  const round = { round: R, ends: R + 7200000, shape: "normal" };
  const o = { closed: false, rehearsal: round, booked: true, pid: true,
              trip: leftChurch({ rehearsal: round, routes: ["North", "South"] }) };
  const me = await passenger(o);
  await me.pg.evaluate(() => { const b = document.getElementById("alertAskNot"); if (b) b.click(); });
  await me.pg.waitForTimeout(300);
  const during = await me.text("#live");
  const loads = () => me.asked.filter((q) => /[?&]bus=1/.test(q)).length;
  const before = loads();
  o.rehearsal = false;
  o.trip = { live: false, why: "open", date: KEY, rehearsal: false };
  await me.pg.waitForTimeout(7000);
  const after = await me.text("#live");
  const form = await me.pg.$$eval("[data-stop]", (b) => b.filter((x) => x.offsetParent).length).catch(() => 0);
  await me.shot("P6-after-rehearsal");
  check("P6", "when the rehearsal ends the page loads again and the test morning is gone",
        /Rehearsal/i.test(during) && loads() > before && !/Rehearsal/i.test(after) && form > 0,
        "during '" + during.slice(0, 60) + "', loads " + before + " then " + loads() + ", after '" + after.slice(0, 60) +
        "', stops on screen " + form);
  await me.ctx.close();
}

const bad = results.filter((r) => !r.ok);
console.log("\n  " + results.length + " checks, " + (results.length - bad.length) + " passed, " + bad.length + " failed");
console.log("  photographs in " + OUT);
await done();
process.exit(bad.length ? 1 : 0);
