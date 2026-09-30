/* THE PASSENGER PAGE, AT EVERY STAGE OF A PASSENGER'S WEEK, for the videos.

   The real sunday/ page in Chromium at phone width, served by
   tests/browser/lib.mjs, with a stand-in for the live server that takes a
   real booking: the phone number, the seats, the cancel. The stops are the
   real ones, from tests/browser/real.json unless MINIBUS_REAL names a fresh
   export. Each picture also records where the things the animation circles
   are (marks.json).

     SHOTS=video/build/shots node video/shots.mjs [scene,...]

   THE EXAMPLE PASSENGER is booked for 2 on North at N04, and the trip below
   is staged around North's timetable. clips.js writes the same stop names and
   times into the notifications, so if the timetable moves, this stops and
   says so rather than make a video that disagrees with itself. */
import { browser, done, REAL, OUT, ROOT } from "../tests/browser/lib.mjs";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

const PORT = Number(process.env.MINIBUS_PORT || 8113);
const ONLY = (process.argv[2] || "").split(",").filter(Boolean);
const want = (id) => !ONLY.length || ONLY.includes(id);
mkdirSync(OUT, { recursive: true });

/* What clips.js was written for. Change both together. */
const EXPECT = {
  N00: ["Church, Chester Road", "10:05"],
  N02: ["Grace Road bus stop, Walton Vale", "10:23"],
  N03: ["Little Kings & Queens Nursery, Litherland Road", "10:30"],
  N04: ["Fountains Road by Stanley Close", "10:36"]
};
const off = Object.keys(EXPECT).filter((id) => {
  const s = REAL.stops.find((x) => x.id === id);
  return !s || s.stop !== EXPECT[id][0] || s.time !== EXPECT[id][1] || !s.active;
});
if (off.length) {
  console.log("The timetable no longer matches the example in the videos: " + off.map((id) => {
    const s = REAL.stops.find((x) => x.id === id);
    return id + " is " + (s ? '"' + s.stop + '" ' + s.time + (s.active ? "" : " (not active)") : "gone") + ", not \"" + EXPECT[id].join('" ') + "\"";
  }).join("; ") + ".\nChange EXPECT and the trips here, and the stop names and times in clips.js, to match.");
  await done();
  process.exit(1);
}

/* The versions the page's foot shows, off the files themselves. */
const grab = (f, re) => (readFileSync(ROOT + "/" + f, "utf8").match(re) || [])[1] || "";
const SERVER = grab("server/worker.js", /SCRIPT_VERSION = "([^"]+)"/), SHEET = grab("Code.gs", /SCRIPT_VERSION = "([^"]+)"/);

const KEY = "2026-09-27", NEXT = "2026-10-04";
const pub = (s) => ({ route: s.route, id: s.id, time: s.time, stop: s.stop, postcode: s.postcode,
                      arrival: s.kind === "arrival", depart: false });
const STOPS = REAL.stops.filter((s) => s.kind === "pickup" && s.active).map(pub);
const ARRIVALS = REAL.stops.filter((s) => s.kind === "arrival").map(pub);
const MINE = STOPS.find((s) => s.id === "N04");
/* Other people's seats: invented, a believable Sunday. */
const COUNTS = { N01: 2, N02: 3, N04: 1, N06: 2, N07: 1, S01: 2, S03: 1, S05: 2, S07: 1 };
/* 07700 900123 is from the range Ofcom keeps for examples: nobody's phone. */
const PHONE = "07700900123";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

async function passenger(o = {}) {
  const w = Object.assign({ closed: false, rolled: false, date: KEY, mine: null, trip: null, counts: Object.assign({}, COUNTS) }, o.world || {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, serviceWorkers: "block", timezoneId: "Europe/London", locale: "en-GB",
    userAgent: o.ua || undefined });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e.message)));
  const at = Date.parse(o.clock || "2026-09-24T19:10:00+01:00");
  await pg.addInitScript(`(() => {
    const Real = Date, shift = ${at} - Real.now();
    function Shifted(...a) { if (a.length === 0) return new Real(Real.now() + shift); return new Real(...a); }
    Shifted.prototype = Real.prototype; Shifted.now = () => Real.now() + shift; Shifted.parse = Real.parse; Shifted.UTC = Real.UTC;
    window.Date = Shifted;
    try { localStorage.setItem("bus.install.v1", "1"); } catch (e) {}
    ${o.pid ? 'try { localStorage.setItem("bus.pid.v1", "pid-me"); localStorage.setItem("bus.phone.v1", "' + PHONE + '"); } catch (e) {}' : ""}
    try { Object.defineProperty(Notification, "permission", { get: () => window.__perm || "${o.alertsOn ? "granted" : "default"}", configurable: true }); } catch (e) {}
    Notification.requestPermission = async () => { window.__perm = "granted"; return "granted"; };
    const fake = { endpoint: "https://push.example/x", toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "x", auth: "y" } }; }, unsubscribe: async () => true };
    window.__sub = ${o.alertsOn ? "fake" : "null"};
    /* PushManager cannot be constructed from a page, so the registration the
       page waits on is a plain object with the two calls it makes. */
    const pm = { getSubscription: async () => window.__sub, subscribe: async () => { window.__sub = fake; return fake; } };
    if (navigator.serviceWorker) {
      try { Object.defineProperty(navigator.serviceWorker, "ready", { get: () => Promise.resolve({ pushManager: pm }), configurable: true }); } catch (e) {}
      try { navigator.serviceWorker.register = async () => ({ pushManager: pm }); } catch (e) {}
    }
  })()`);
  const bus = () => ({ ok: true, server: SERVER, sheet: SHEET, date: w.date, closed: w.closed, rehearsal: false,
    rolled: w.rolled, cutoff: "Sunday 09:30", stops: STOPS, arrivals: ARRIVALS, off: [], counts: w.counts,
    driver: null, phone: w.mine ? PHONE : "", stopGone: "", mine: w.mine, seats: {} });
  await pg.route("**://*.workers.dev/**", async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.searchParams;
    let post = {}; try { post = JSON.parse(req.postData() || "{}"); } catch (e) {}
    let body = { ok: true, server: SERVER, sheet: SHEET };
    if (p.get("bus")) body = bus();
    else if (p.get("trip")) body = Object.assign(body, w.trip || { live: false, why: "open", date: w.date });
    else if (p.get("vapid")) body = { ok: true, key: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" };
    else if (post.action === "identify") body = Object.assign(bus(), { pid: "pid-me", phone: post.phone || PHONE });
    else if (post.action === "booking") {
      const b = post.booking || {};
      const was = w.mine;
      if (was) w.counts[was.stopId] = Math.max(0, (w.counts[was.stopId] || 0) - was.seats);
      w.mine = Number(b.seats) > 0 ? { stopId: b.stopId, seats: Number(b.seats) } : null;
      if (w.mine) w.counts[w.mine.stopId] = (w.counts[w.mine.stopId] || 0) + w.mine.seats;
      body = Object.assign(bus(), { ok: true });
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await pg.goto("http://127.0.0.1:" + PORT + "/sunday/", { waitUntil: "networkidle" });
  await pg.waitForTimeout(o.wait === undefined ? 5200 : o.wait);
  await pg.addStyleTag({ content: "img { visibility: hidden }" });
  const me = { pg, ctx, errs, w };
  me.shot = async (name, opt = {}) => {
    if (opt.scrollTo) { await pg.evaluate((s) => { const e = document.querySelector(s); if (e) e.scrollIntoView({ block: "center" }); }, opt.scrollTo); await pg.waitForTimeout(300); }
    await pg.screenshot({ path: OUT + "/" + name + ".png" });
    /* Where the things the animation circles are, in CSS pixels of the
       390 x 844 screen: a selector, or the smallest visible element whose
       words start with the text given. "words@1" is the box one level out
       from the words: the panel, not just the bold line inside it. */
    const boxes = await pg.evaluate((specs) => {
      const out = {};
      for (const k in specs) {
        const up = /@(\d+)$/.test(specs[k]) ? Number(specs[k].match(/@(\d+)$/)[1]) : 0;
        const spec = specs[k].replace(/@\d+$/, "");
        let el = null;
        if (/^[#.\[]/.test(spec)) el = document.querySelector(spec);
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
    console.log("  shot " + name + (miss.length ? "   MISSING MARKS: " + miss.join(", ") : ""));
    if (miss.length) process.exitCode = 1;
  };
  me.click = (sel) => pg.evaluate((s) => { const e = document.querySelector(s); if (e) { e.click(); return true; } return false; }, sel);
  me.clickText = (t) => pg.evaluate((x) => { const e = [...document.querySelectorAll("button,a")].find((b) => b.offsetParent && (b.textContent || "").trim().indexOf(x) === 0); if (e) { e.click(); return true; } return false; }, t);
  me.wait = (ms) => pg.waitForTimeout(ms);
  me.not = async () => { await me.click("#alertAskNot"); await me.wait(300); };
  return me;
}

const scenes = [];
const scene = (id, fn) => scenes.push({ id, fn });

/* ---- 1. put it on your phone ------------------------------------------- */
scene("p-first", async () => {
  const me = await passenger({ ua: ANDROID });
  await me.not();
  await me.shot("p-first");
  return me;
});
/* The foot of the page, where "Add to your phone" always is. The page also
   offers it by itself on a first visit, but that offer and the alerts
   question race each other on timers, so the video teaches the link. */
scene("p-foot", async () => {
  const me = await passenger({ ua: ANDROID });
  await me.not();
  await me.pg.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await me.wait(400);
  await me.shot("p-foot", { marks: { add: "#idInstall", foot: "#foot" } });
  return me;
});
/* The install steps, opened from the foot link. Chrome on Android hands
   over its own install prompt when the page qualifies, which puts a one-tap
   Install button above the steps. */
scene("p-install-android", async () => {
  const me = await passenger({ ua: ANDROID });
  await me.not();
  await me.click("#idInstall"); await me.wait(300);
  await me.pg.evaluate(() => {
    const e = new Event("beforeinstallprompt");
    e.prompt = () => {}; e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  await me.wait(400);
  await me.shot("p-install-android", { marks: { go: "#howGo", menu: "Tap the" } });
  return me;
});
/* An iPhone in Safari cannot have alerts until the page is on the Home
   Screen, so the page asks for that first, and Show me how opens the steps. */
scene("p-install-iphone", async () => {
  const me = await passenger({ ua: IPHONE });
  await me.shot("p-iphone-offer", { marks: { go: "#alertAskGo" } });
  await me.click("#alertAskGo"); await me.wait(500);
  await me.shot("p-install-iphone", { marks: { share: "Tap the Share button", add: "Scroll down and tap", addBtn: "Tap Add" } });
  return me;
});
scene("p-alerts", async () => {
  const me = await passenger({ ua: ANDROID });
  await me.shot("p-alerts-offer", { marks: { go: "#alertAskGo" } });
  return me;
});

/* ---- 2. book your seat -------------------------------------------------- */
scene("p-book", async () => {
  const me = await passenger({ ua: ANDROID, alertsOn: true });
  await me.not();
  await me.shot("p-stops", { marks: { routes: "[data-route]", first: "[data-stop]" } });
  await me.shot("p-stops-mine", { scrollTo: '[data-stop="N04"]', marks: { mine: '[data-stop="N04"]' } });
  await me.click('[data-stop="N04"]'); await me.wait(500);
  await me.pg.fill("#askInput", "07700 900123"); await me.wait(300);
  await me.shot("p-ask-typed", { marks: { input: "#askInput", go: "#askGo" } });
  await me.click("#askGo"); await me.wait(1200);
  await me.clickText("+"); await me.wait(200); await me.clickText("+"); await me.wait(300);
  await me.shot("p-howmany-2", { scrollTo: ".seats", marks: { plus: "+", save: "#save" } });
  await me.click("#save"); await me.wait(4750);
  await me.pg.evaluate(() => window.scrollTo(0, 0)); await me.wait(300);
  await me.shot("p-booked", { marks: { booked: "You are booked.@1" } });
  await me.click("#cancel"); await me.wait(700);
  await me.shot("p-notcoming", { marks: { yes: "Yes, I am not coming" } });
  return me;
});

/* ---- 3. Sunday morning --------------------------------------------------
   North leaves church at 10:05 on time; the estimate for N04 is 10:34, and
   after Grace Road (N02) is marked at 10:24, a minute behind, it is 10:35. */
const MINEW = { mine: { stopId: "N04", seats: 2 }, counts: Object.assign({}, COUNTS, { N04: COUNTS.N04 + 2 }) };
const trip = (o) => Object.assign({ live: true, date: KEY, now: Date.now(), route: "North", watching: false,
  rehearsal: false, routes: [], stop: MINE.stop, stopId: "N04", scheduled: MINE.time, started: false, ended: false,
  startedAtWords: "", lastStop: "", lastAgo: 0, lastAtWords: "", mine: "", offset: 0 }, o);

scene("p-closed", async () => {
  const me = await passenger({ pid: true, alertsOn: true, clock: "2026-09-27T09:40:00+01:00",
    world: Object.assign({ closed: true, trip: trip({}) }, MINEW) });
  await me.shot("p-closed", { marks: { live: "Not set off yet@1" } });
  return me;
});
scene("p-left", async () => {
  const me = await passenger({ pid: true, alertsOn: true, clock: "2026-09-27T10:06:00+01:00",
    world: Object.assign({ closed: true, trip: trip({ started: true, startedAtWords: "10:05", mine: "eta", offset: 0, etaWords: "10:34", minutes: 28 }) }, MINEW) });
  await me.shot("p-left", { marks: { live: "28 min@1" } });
  return me;
});
scene("p-coming", async () => {
  const me = await passenger({ pid: true, alertsOn: true, clock: "2026-09-27T10:29:00+01:00",
    world: Object.assign({ closed: true, trip: trip({ started: true, startedAtWords: "10:05", mine: "eta", offset: 1,
      lastStop: EXPECT.N02[0], lastAtWords: "10:24", lastAgo: 5, etaWords: "10:35", minutes: 6 }) }, MINEW) });
  await me.shot("p-coming", { marks: { live: "6 min@1" } });
  return me;
});
scene("p-now", async () => {
  const me = await passenger({ pid: true, alertsOn: true, clock: "2026-09-27T10:34:00+01:00",
    world: Object.assign({ closed: true, trip: trip({ started: true, startedAtWords: "10:05", mine: "eta", offset: 1, imminent: true,
      lastStop: EXPECT.N03[0], lastAtWords: "10:31", lastAgo: 3, etaWords: "10:35", minutes: 1 }) }, MINEW) });
  await me.shot("p-now", { marks: { live: "Be at your stop@1" } });
  return me;
});
scene("p-picked", async () => {
  const me = await passenger({ pid: true, alertsOn: true, clock: "2026-09-27T10:37:00+01:00",
    world: Object.assign({ closed: true, trip: trip({ started: true, startedAtWords: "10:05", mine: "served", servedAt: "10:36",
      servedEvent: "pickup", lastStop: MINE.stop, lastAtWords: "10:36" }) }, MINEW) });
  await me.shot("p-picked", { marks: { live: "Picked up at@1" } });
  return me;
});
/* An hour after the last bus, next Sunday is open and barely booked. */
scene("p-rolled", async () => {
  const me = await passenger({ pid: true, alertsOn: true, clock: "2026-09-27T11:40:00+01:00",
    world: { closed: false, rolled: true, date: NEXT, mine: null, counts: { N02: 2, S01: 1 },
             trip: trip({ started: true, ended: true, startedAtWords: "10:05", mine: "served", servedAt: "10:36", servedEvent: "pickup" }) } });
  await me.shot("p-rolled", { marks: { back: "Today’s buses are back@1" } });
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
