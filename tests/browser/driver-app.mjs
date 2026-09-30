/* THE DRIVER APP FAULTS FIXED IN v1.74.9 AND v1.74.10, AS TESTS ON THE REAL PAGE.

   Each test drives the page the way a Sunday would and asserts what the
   driver should get. Run against v1.74.8 they must fail; against v1.74.9
   they must pass; and against v1.74.9 with any one fix taken back out, the
   test for that fix must fail again.

     node tests/browser/driver-app.mjs [T1,T2,...]          */
import { phone, done, SAMPLE, realRows, KEY } from "./lib.mjs";

const ONLY = (process.argv[2] || "").split(",").filter(Boolean);
const want = (id) => !ONLY.length || ONLY.includes(id);
const results = [];
function check(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok });
  console.log((ok ? "  ✓ " : "  ✗ ") + id + "  " + name + (ok ? "" : "   [" + detail + "]"));
}
const T = (hm) => Date.parse("2026-09-27T" + hm + ":00+01:00");
const okCheck = (reg = "NH56 FWP", who = SAMPLE) => ({ [reg]: { state: "ok", at: T("09:40"), driver: who, id: "c1" } });
const CHURCH = { lat: 53.424169, lng: -2.936799, acc: 10, speed: 0 };
const AWAY = { lat: 53.463563, lng: -2.959062, acc: 10, speed: 0 };
const MOVING = { lat: 53.44, lng: -2.95, acc: 8, speed: 11 };
const STILL = { lat: 53.44, lng: -2.95, acc: 8, speed: 0 };

async function startRun(me, clock = "10:04") {
  await me.load(); await me.close(["howDone"]);
  await me.signIn(); await me.toStops(); await me.close();
  await me.jump(1);
  await me.click("Start trip · NH56 FWP", "#s-stops"); await me.wait(1300); await me.close();
}
async function tap(me, kind, id) {
  return me.pg.evaluate(([k, i]) => {
    const b = [...document.querySelectorAll('[data-triptap="' + i + '"][data-tripkind="' + k + '"]')].find(x => x.offsetParent);
    if (b && !b.disabled) { b.click(); return true; } return false;
  }, [kind, id]);
}
async function moveFor(me, secs) { for (let i = 0; i < secs * 2; i++) { await me.emit(MOVING); await me.wait(500); } }
async function stopFor(me, secs) { for (let i = 0; i < secs * 2; i++) { await me.emit(STILL); await me.wait(500); } }
const buttons = (me) => me.pg.$$eval("#s-stops button, #footbar button", bs => bs.filter(x => x.offsetParent).map(x => x.textContent.trim()));

/* T1 — the moving lock survives leaving Stops and coming back */
if (want("T1")) {
  const me = await phone({ clock: "2026-09-27T10:03:00+01:00", world: { checks: okCheck() } });
  await startRun(me);
  await me.clickId("stopsBack");
  await me.click("Stops and bookings", "#s-hub"); await me.wait(1500); await me.close();
  const live = await me.liveWatches();
  await moveFor(me, 6);
  const banner = await me.text("#tripMoving");
  const disabled = await me.pg.$$eval("[data-triptap]", bs => bs.filter(b => b.offsetParent).every(b => b.disabled));
  check("T1", "moving lock and speed watch come back with Stops and bookings", live === 1 && /moving/.test(banner) && disabled,
        "watches " + live + ", banner '" + banner + "', all stop buttons disabled " + disabled);
  await me.ctx.close();
}

/* T2 — a run the app ended by itself can be reopened, and the reopen reaches the record */
if (want("T2")) {
  const me = await phone({ clock: "2026-09-27T10:03:00+01:00", world: { checks: okCheck(), staleEndMs: 9000 } });
  await startRun(me);
  await me.jump(20); await me.emit(AWAY); await me.wait(500);
  await me.jump(30); await me.emit(CHURCH); await me.wait(500);
  await me.jump(4); await me.emit(CHURCH); await me.wait(1500);
  const ended = /Trip finished/.test(await me.text("#stopsBody"));
  const offered = (await buttons(me)).includes("It has not finished, reopen it");
  let reopened = false, undoPosted = false;
  if (offered) {
    await me.click("It has not finished, reopen it", "#s-stops"); await me.wait(200);
    const toast = await me.toast();
    /* two polls while the board still carries the old end */
    await me.wait(11000);
    reopened = /Run reopened/.test(toast) && (await me.foot()).includes("End trip, arrived at church") &&
               !/Trip finished/.test(await me.text("#stopsBody"));
    undoPosted = me.posted.some(p => p.action === "trip" && (p.trip.events || []).some(e => e.event === "undo" && e.undoes === "end"));
  }
  check("T2", "after an automatic end, «It has not finished, reopen it» appears and reopens the run",
        ended && offered && reopened && undoPosted, "ended " + ended + ", offered " + offered + ", reopened " + reopened + ", undo sent " + undoPosted);
  await me.ctx.close();
}

/* T2b — the offer is still there when the app is opened fresh, which is what
   the notification tells him to do. It was kept in memory only. */
if (want("T2b")) {
  const me = await phone({ clock: "2026-09-27T10:03:00+01:00", world: { checks: okCheck() } });
  await startRun(me);
  await me.jump(20); await me.emit(AWAY); await me.wait(500);
  await me.jump(30); await me.emit(CHURCH); await me.wait(500);
  await me.jump(4); await me.emit(CHURCH); await me.wait(1500);
  const ended = /Trip finished/.test(await me.text("#stopsBody"));
  await me.jump(3);
  await me.load(); await me.close(["howDone"]);
  await me.toStops(); await me.close();
  const offered = (await buttons(me)).includes("It has not finished, reopen it");
  let reopened = false;
  if (offered) {
    await me.click("It has not finished, reopen it", "#s-stops"); await me.wait(200);
    const toast = await me.toast();
    await me.wait(800);
    reopened = /Run reopened/.test(toast) && (await me.foot()).includes("End trip, arrived at church");
  }
  check("T2b", "the reopen offer is still there when the app is opened fresh after the automatic end",
        ended && offered && reopened, "ended " + ended + ", offered after reload " + offered + ", reopened " + reopened);
  await me.ctx.close();
}

/* T2c — the same for a driver covering at short notice. His claim is not kept
   through a reload, by design, and the rota does not name him, so once the
   run had ended nothing on the phone said it was his. */
if (want("T2c")) {
  const rows = realRows(rs => { rs.find(r => r.date === KEY).primary = "Bro Adrian"; return rs; });
  const me = await phone({ clock: "2026-09-27T09:52:00+01:00", world: { rows, checks: okCheck() } });
  await me.load(); await me.close(["howDone"]);
  await me.signIn(); await me.toStops(); await me.close();
  await me.click("I am covering this run", "#s-stops"); await me.wait(300);
  await me.click("Confirm: you are covering North", "#s-stops"); await me.wait(700);
  await me.click("Start trip · NH56 FWP", "#s-stops"); await me.wait(1500); await me.close();
  const started = /Running/.test(await me.text("#stopsBody"));
  await me.jump(20); await me.emit(AWAY); await me.wait(500);
  await me.jump(30); await me.emit(CHURCH); await me.wait(500);
  await me.jump(4); await me.emit(CHURCH); await me.wait(1500);
  const ended = /Trip finished/.test(await me.text("#stopsBody"));
  await me.jump(3);
  await me.load(); await me.close(["howDone"]);
  await me.toStops(); await me.close();
  const strip = await me.text("#stopsBody");
  const own = /Trip finished/.test(strip) && !/Adrian has finished/.test(strip);
  const offered = (await buttons(me)).includes("It has not finished, reopen it");
  let reopened = false;
  if (offered) {
    await me.click("It has not finished, reopen it", "#s-stops"); await me.wait(200);
    const toast = await me.toast();
    await me.wait(800);
    reopened = /Run reopened/.test(toast) && (await me.foot()).includes("End trip, arrived at church");
  }
  check("T2c", "a driver covering at short notice gets the reopen offer too, when the app is opened fresh",
        started && ended && own && offered && reopened,
        "started " + started + ", ended " + ended + ", shown as his own " + own + ", offered " + offered + ", reopened " + reopened);
  await me.ctx.close();
}

/* T3 — a driver who is not on the rota can cover, start and run */
if (want("T3")) {
  const rows = realRows(rs => { rs.find(r => r.date === KEY).primary = "Bro Adrian"; return rs; });
  const me = await phone({ clock: "2026-09-27T09:52:00+01:00", world: { rows, checks: okCheck() } });
  await me.load(); await me.close(["howDone"]);
  await me.signIn(); await me.toStops(); await me.close();
  const offered = (await buttons(me)).includes("I am covering this run");
  let armed = false, claimed = false, started = false, startBy = "";
  if (offered) {
    await me.click("I am covering this run", "#s-stops"); await me.wait(300);
    armed = (await buttons(me)).includes("Confirm: you are covering North");
    await me.click("Confirm: you are covering North", "#s-stops"); await me.wait(150);
    claimed = /Covering North/.test(await me.toast());
    await me.wait(600);
    await me.click("Start trip · NH56 FWP", "#s-stops"); await me.wait(1500); await me.close();
    started = /Running/.test(await me.text("#stopsBody"));
    const st = me.posted.find(p => p.action === "trip" && (p.trip.events || []).some(e => e.event === "start"));
    startBy = st ? st.trip.driver : "";
  }
  check("T3", "«I am covering this run» appears, confirms, and the cover driver starts the run in his own name",
        offered && armed && claimed && started && startBy === SAMPLE,
        "offered " + offered + ", armed " + armed + ", claimed " + claimed + ", started " + started + ", start by '" + startBy + "'");
  await me.ctx.close();
}

/* T3b — a driver on the rota for North is not invited to cover South */
if (want("T3b")) {
  const me = await phone({ clock: "2026-09-27T09:52:00+01:00", world: { checks: okCheck() } });
  await me.load(); await me.close(["howDone"]);
  await me.signIn(); await me.toStops(); await me.close();
  await me.pg.evaluate(() => { const b = document.querySelector('[data-stoproute="South"]'); if (b) b.click(); });
  await me.wait(1300);
  const bs = await buttons(me);
  check("T3b", "the rostered North driver is not offered cover on the South tab", !bs.includes("I am covering this run"), JSON.stringify(bs));
  await me.ctx.close();
}

/* T4 — Nobody there is where a thumb can reach it, on three phone sizes */
if (want("T4")) {
  let all = true; const notes = [];
  for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 740 }, { width: 414, height: 896 }]) {
    const me = await phone({ clock: "2026-09-27T10:03:00+01:00", world: { checks: okCheck() } });
    await me.pg.setViewportSize(vp);
    await startRun(me);
    for (const y of [0, 300]) {
      await me.pg.evaluate(v => window.scrollTo(0, v), y); await me.wait(300);
      const r = await me.pg.evaluate(() => {
        const nb = [...document.querySelectorAll(".trip-actions button")].find(x => x.textContent.trim() === "Nobody there");
        const pu = [...document.querySelectorAll(".trip-actions button")].find(x => /^Picked up/.test(x.textContent.trim()));
        const ft = document.getElementById("footbar").getBoundingClientRect().top;
        const c = nb.getBoundingClientRect();
        const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
        return { hit: hit === nb, nbBottom: c.bottom, puBottom: pu.getBoundingClientRect().bottom, ft };
      });
      const ok = r.hit && r.nbBottom <= r.ft + 0.5 && r.puBottom <= r.ft + 0.5;
      if (!ok) { all = false; notes.push(vp.width + "x" + vp.height + "@" + y + " " + JSON.stringify(r)); }
    }
    await me.ctx.close();
  }
  check("T4", "«Nobody there» and «Picked up» sit clear of the bottom bar, at any scroll", all, notes.join("; "));
}

/* T5 — the bus sheet's heading */
if (want("T5")) {
  const me = await phone({ clock: "2026-09-27T09:10:00+01:00" });
  await me.load(); await me.close(["howDone"]);
  const t = await me.pg.$eval("#busModal .eyebrow", e => e.textContent);
  check("T5", "the «Not the bus you were given» sheet is headed Today’s bus", t === "Today’s bus", JSON.stringify(t));
  await me.ctx.close();
}

/* T6 — the coordinator can authorise from his own screen, not driving, before 09:30 */
const STOPPED = { "NH56 FWP": { state: "stopped", at: T("09:05"), driver: SAMPLE, id: "c9" } };
if (want("T6")) {
  const checks = STOPPED;
  const me = await phone({ clock: "2026-09-27T09:12:00+01:00", world: { checks, closed: false } });
  await me.load(); await me.close(["howDone"]);
  await me.signIn("Bro Arthur"); await me.toStops(); await me.close();
  const txt = await me.text("#stopsBody");
  const bs = await buttons(me);
  let sheet = false;
  if (bs.includes("Authorise NH56 FWP to run")) {
    await me.click("Authorise NH56 FWP to run", "#s-stops"); await me.wait(400);
    sheet = (await me.sheetsUp()).includes("authModal");
  }
  check("T6", "a coordinator not driving that route sees the stopped bus and «Authorise NH56 FWP to run», before 09:30",
        /NH56 FWP was stopped by today’s check/.test(txt) && sheet, "text has stop line " + /stopped by/.test(txt) + ", buttons " + JSON.stringify(bs) + ", sheet " + sheet);
  await me.ctx.close();
}

/* T6b — and a driver never does. Its own block, so that it can be run on its
   own: inside T6's, asking for T6b alone ran nothing and passed. */
if (want("T6b")) {
  const me2 = await phone({ clock: "2026-09-27T09:12:00+01:00", world: { checks: STOPPED, closed: false } });
  await me2.load(); await me2.close(["howDone"]);
  await me2.signIn(); await me2.toStops(); await me2.close();
  const txt2 = await me2.text("#stopsBody");
  const bs2 = await buttons(me2);
  check("T6b", "a driver is never shown an Authorise button",
        !bs2.some(b => /^Authorise/.test(b)) && /Bookings close/.test(txt2), JSON.stringify(bs2) + " / " + JSON.stringify(txt2.slice(0, 160)));
  await me2.ctx.close();
}

/* T7 — moving stays moving through a repaint, and Undo is refused while moving */
if (want("T7")) {
  const me = await phone({ clock: "2026-09-27T10:03:00+01:00", world: { checks: okCheck() } });
  await startRun(me);
  await me.jump(11); await me.wait(300);
  await tap(me, "pickup", "N01"); await me.wait(3500);
  await moveFor(me, 6);
  /* a full repaint, the way a driver makes one: tap his own route's tab */
  await me.pg.evaluate(() => { const b = document.querySelector('[data-stoproute="North"]'); if (b) b.click(); });
  await me.wait(1200);
  await me.emit(MOVING); await me.wait(400);
  const banner = await me.text("#tripMoving");
  const undoBtn = await me.pg.$eval('[data-tripundo="N01"]', b => ({ disabled: b.disabled })).catch(() => null);
  const before = me.posted.filter(p => p.action === "trip" && (p.trip.events || []).some(e => e.event === "undo")).length;
  await me.pg.evaluate(() => { const b = document.querySelector('[data-tripundo="N01"]'); if (b) { b.disabled = false; b.click(); } });
  await me.wait(1500);
  const after = me.posted.filter(p => p.action === "trip" && (p.trip.events || []).some(e => e.event === "undo")).length;
  const stillMarked = /picked up 10:1/i.test(await me.text("#stopsBody"));
  check("T7", "after a repaint while moving the banner and the grey stay, and Undo is refused",
        /moving/.test(banner) && undoBtn && undoBtn.disabled && after === before && stillMarked,
        "banner '" + banner + "', undo disabled " + (undoBtn && undoBtn.disabled) + ", undo sent " + (after - before) + ", still marked " + stillMarked);
  await me.ctx.close();
}

/* T8 — the end of the run is said when it arrives, by the clock or by the last tap */
if (want("T8")) {
  const me = await phone({ clock: "2026-09-27T10:03:00+01:00", world: { checks: okCheck() } });
  await startRun(me);
  await me.jump(11); await tap(me, "pickup", "N01"); await me.wait(3500);
  me.world.noEcho = true;                            /* the drive back: nothing on the board moves */
  await me.wait(5500);
  await me.jump(46); await me.wait(6500);            /* 11:01, nothing tapped */
  const line = (await me.text("#stopsBody")).split("\n").find(l => /Still running/.test(l)) || "";
  const red1 = await me.pg.$eval("#tripEnd", b => b.classList.contains("is-due")).catch(() => false);
  check("T8", "«Still running — due at church 11:00» appears by itself once the time has passed, End trip turns",
        /due at church 11:00/.test(line) && red1, "line '" + line + "', End trip is-due " + red1);
  await me.ctx.close();

  const me2 = await phone({ clock: "2026-09-27T10:03:00+01:00", world: { checks: okCheck() } });
  await startRun(me2);
  await me2.jump(44);                                  /* 10:48 */
  for (const id of ["N01", "N02", "N04", "N06", "N07"]) { await tap(me2, "pickup", id); await me2.wait(400); }
  await me2.wait(800);
  const red2 = await me2.pg.$eval("#tripEnd", b => b.classList.contains("is-due")).catch(() => false);
  const said = /Every stop marked/.test(await me2.text("#stopsBody"));
  check("T8b", "marking the last booked stop turns End trip at once, with «Every stop marked»", red2 && said, "is-due " + red2 + ", line " + said);
  await me2.ctx.close();
}

/* T8c — every stop marked, then the time at church goes by: the line moves
   on to "Still running" by itself, as a fresh screen would draw it. */
if (want("T8c")) {
  const me = await phone({ clock: "2026-09-27T10:03:00+01:00", world: { checks: okCheck() } });
  await startRun(me);
  await me.jump(44);                                  /* 10:48 */
  for (const id of ["N01", "N02", "N04", "N06", "N07"]) { await tap(me, "pickup", id); await me.wait(400); }
  await me.wait(4000);
  const before = /Every stop marked/.test(await me.text("#stopsBody"));
  me.world.noEcho = true;                             /* nothing on the board moves */
  await me.wait(5500);
  await me.jump(13); await me.wait(7000);             /* 11:01 */
  const txt = await me.text("#stopsBody");
  const late = /Still running — due at church 11:00/.test(txt) && !/Every stop marked/.test(txt);
  const red = await me.pg.$eval("#tripEnd", b => b.classList.contains("is-due")).catch(() => false);
  check("T8c", "with every stop marked, the line still moves on to «Still running — due at church 11:00» by itself",
        before && late && red, "marked first " + before + ", late line by itself " + late + ", End trip is-due " + red);
  await me.ctx.close();
}

/* T9 — no way into a check round the PIN */
if (want("T9")) {
  const me = await phone({ clock: "2026-09-27T10:00:00+01:00", world: { checks: {} } });
  await me.load(); await me.close(["howDone"]);
  await me.signIn(); await me.toStops(); await me.close();
  await me.click("Start trip · NH56 FWP", "#s-stops"); await me.wait(1500); await me.close();
  await me.clickId("tripDoCheck"); await me.wait(150);
  const where1 = await me.where(), toast1 = await me.toast();
  check("T9", "«Do the check» asks for the PIN before the bus list", where1 === "s-driver" && /Key your PIN first/.test(toast1),
        "went to " + where1 + ", toast '" + toast1 + "'");
  await me.ctx.close();

  const me2 = await phone({ clock: "2026-09-27T08:50:00+01:00" });
  await me2.load(); await me2.close(["howDone"]);
  await me2.signIn("Bro Arthur");
  await me2.fullCheck({ bus: "NH56 FWP", sign: "Bro Arthur" });
  const hasAnother = (await me2.foot()).includes("Check another bus");
  if (hasAnother) { await me2.click("Check another bus", "#footbar"); await me2.wait(150); }
  const where2 = await me2.where(), toast2 = await me2.toast();
  check("T9b", "«Check another bus» asks for the PIN before the bus list", hasAnother && where2 === "s-driver" && /Key your PIN first/.test(toast2),
        "button " + hasAnother + ", went to " + where2 + ", toast '" + toast2 + "'");
  await me2.ctx.close();
}

/* T10 — the 27 September rulings on the driver's stop list: the estimate
   stands alone and in bold, with no timetabled time under it, and a
   timetabled time is plain. */
if (want("T10")) {
  const me = await phone({ clock: "2026-09-27T10:03:00+01:00",
    world: { checks: okCheck(), etas: { North: { N02: T("10:27") } }, offset: { North: 5 } } });
  await startRun(me);
  await me.wait(5600);
  const rows = await me.pg.$$eval("#s-stops .stop-row", rs => rs.filter(r => r.offsetParent).map(r => {
    const t = r.querySelector(".stop-time");
    return { name: (r.querySelector(".stop-name") || {}).textContent || "",
             time: t ? t.textContent.trim() : "", weight: t ? Number(getComputedStyle(t).fontWeight) : 0,
             plan: !!r.querySelector(".stop-time-plan") };
  }));
  const grace = rows.find(r => /^Grace Road/.test(r.name)) || {};
  const lither = rows.find(r => /Litherland Road/.test(r.name)) || {};
  check("T10", "the estimate stands alone in bold and a timetabled time is plain",
        grace.time === "10:27" && grace.weight >= 700 && !grace.plan && lither.time && lither.weight < 600,
        "Grace Rd " + JSON.stringify(grace) + ", Litherland Rd " + JSON.stringify(lither));
  const strip = await me.text("#s-stops .trip-note");
  check("T11", "the run is '5 minutes behind schedule'", /5 minutes behind schedule/.test(strip),
        "strip '" + strip + "'");
  await me.pg.screenshot({ path: (process.env.SHOTS || "/tmp") + "/T10-driver-stop-list.png" });
  await me.ctx.close();
}

/* T12 — a rota request goes to the live server first, and the Sunday shows
   it on this phone at once rather than after the sheet has filed it. */
if (want("T12")) {
  const me = await phone({ clock: "2026-09-26T19:00:00+01:00" });
  const sent = [];
  me.pg.on("request", (r) => {
    if (r.method() !== "POST") return;
    try { const b = JSON.parse(r.postData() || "{}"); if (b.action === "rotaRequest") sent.push(new URL(r.url()).host); }
    catch (e) {}
  });
  await me.load(); await me.close(["howDone"]);
  await me.signIn(); await me.close();
  const key = "2026-10-04";
  await me.pg.evaluate((k) => rotaOpenRequest(k), key);
  await me.wait(400);
  await me.setInput("rotaReqReason", "Away that weekend");
  await me.clickId("rotaSubmitRequest");
  await me.wait(1500);
  const shown = await me.pg.evaluate((k) => {
    const r = rotaRowFor(k);
    return !!(r && (r.requests || []).some(x => x.driver === "Bro Sample" && x.status === "Pending"));
  }, key);
  check("T12", "a rota request goes to the live server first, and the Sunday shows it at once",
        sent.length === 1 && /workers\.dev/.test(sent[0]) && shown,
        "sent to " + JSON.stringify(sent) + ", shown " + shown);
  await me.ctx.close();
}

/* T13 — the way into the coordinator's app is on the hub for a coordinator's
   name, and for nobody else's. The name goes with him in local storage, and
   the PIN is never put there. From v1.78.0 a checked PIN goes once, in the
   tab's session storage: that is T15. */
if (want("T13")) {
  const hub = async (m) => {
    if ((await m.where()) !== "s-hub") { await m.pg.evaluate(() => { try { goHome(); } catch (e) {} }); await m.wait(400); }
    return m.pg.$eval("#toCoord", (b) => !!b.offsetParent).catch(() => false);
  };
  const me = await phone({ clock: "2026-09-26T19:00:00+01:00" });
  await me.load(); await me.close(["howDone"]);
  await me.signIn("Bro Arthur"); await me.close();
  const coordSees = await hub(me);
  let went = "";
  if (coordSees) {
    await Promise.all([
      me.pg.waitForURL(/\/coord\//, { timeout: 6000 }).then(() => { went = me.pg.url(); }).catch(() => {}),
      me.pg.click("#toCoord")
    ]);
  }
  const carried = await me.pg.evaluate(() => {
    const o = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } } catch (e) {}
    return o;
  }).catch(() => ({}));
  await me.ctx.close();

  const me2 = await phone({ clock: "2026-09-26T19:00:00+01:00" });
  await me2.load(); await me2.close(["howDone"]);
  await me2.signIn(); await me2.close();
  const driverSees = await hub(me2);
  await me2.ctx.close();

  const pinCarried = Object.keys(carried).some((k) => /coord/i.test(k) && /1234/.test(String(carried[k])));
  check("T13", "the hub has «Coordinator» for a coordinator's name and takes him to the coordinator's page with his name; a driver has no such button",
        coordSees && /\/coord\/(#.*)?$/.test(went) && carried["coord.name.v1"] === "Bro Arthur" && !pinCarried && !driverSees,
        "coordinator sees " + coordSees + ", went '" + went + "', name '" + carried["coord.name.v1"] + "', pin carried " + pinCarried +
        ", driver sees " + driverSees);
}

/* T14 — on a coordinator's hub, Coordinator has a line of its own, as wide
   as Vehicle check, and Driving rota and Stops and bookings stay a pair. */
const toHub = async (m) => {
  if ((await m.where()) !== "s-hub") { await m.pg.evaluate(() => { try { goHome(); } catch (e) {} }); await m.wait(400); }
};
if (want("T14")) {
  const me = await phone({ clock: "2026-09-26T19:00:00+01:00" });
  await me.load(); await me.close(["howDone"]);
  await me.signIn("Bro Arthur"); await me.close();
  await toHub(me);
  const box = await me.pg.evaluate(() => {
    const r = (id) => { const e = document.getElementById(id); if (!e || !e.offsetParent) return null;
      const b = e.getBoundingClientRect(); return { y: Math.round(b.top), w: Math.round(b.width) }; };
    return { coord: r("toCoord"), rota: r("toRota"), stops: r("toStops"), check: r("toCheck") };
  });
  await me.shot("T14-hub-coordinator");
  const ok = box.coord && box.rota && box.stops && box.check &&
             Math.abs(box.coord.w - box.check.w) <= 2 && box.rota.y === box.stops.y &&
             box.coord.y < box.rota.y && box.check.y > box.rota.y && box.rota.w < box.coord.w;
  check("T14", "a coordinator's hub has «Coordinator» alone on its line, as wide as «Vehicle check», with the rota and the stops together between them",
        ok, JSON.stringify(box));
  await me.ctx.close();
}

/* T15 — the PIN checked on the driver app goes with him once; a name kept
   from earlier in the day without its PIN sends no PIN. What the tab holds
   is read the moment the coordinator's page starts, before it takes it. */
if (want("T15")) {
  const me = await phone({ clock: "2026-09-26T19:00:00+01:00" });
  await me.pg.addInitScript(() => {
    if (location.pathname.indexOf("/coord/") !== -1) {
      try { localStorage.setItem("t15.hand", sessionStorage.getItem("coord.hand.v1") || "none"); } catch (e) {}
    }
  });
  const toCoord = async () => {
    await toHub(me);
    const seen = await me.pg.$eval("#toCoord", (b) => !!b.offsetParent).catch(() => false);
    if (seen) await Promise.all([me.pg.waitForURL(/\/coord\//, { timeout: 6000 }).catch(() => {}), me.pg.click("#toCoord")]);
    await me.wait(600);
    return me.pg.evaluate(() => localStorage.getItem("t15.hand")).catch(() => null);
  };
  await me.load(); await me.close(["howDone"]);
  await me.signIn("Bro Arthur"); await me.close();
  const first = await toCoord();
  const pageNow = await me.pg.evaluate(() => Date.now());       /* the phone's clock, which is the test's */
  /* Back on the driver app: the name is kept for the day, the PIN is not. */
  await me.load(); await me.close(["howDone", "alertAskNot", "pinModalNot"]);
  const second = await toCoord();
  let h = null; try { h = JSON.parse(first); } catch (e) {}
  const fresh = h && h.name === "Bro Arthur" && h.pin === "1234" && Math.abs(pageNow - Number(h.at)) < 5 * 60000;
  check("T15", "with the PIN checked on the driver app, «Coordinator» hands it to the coordinator's page once; with only the name kept from earlier, no PIN goes",
        fresh && second === "none", "first " + first + ", second " + second);
  await me.ctx.close();
}

/* T16 — a rehearsal is a round, and a phone lets go of its test run when the
   round is over. Until v1.79.0 the run stayed on the phone for the rest of the
   day: the board stopped naming it, the phone read that silence as nothing
   new, and Start trip never came back. */
const R1 = T("10:00"), R2 = T("10:30");
const reh = (round) => ({ round: round, ends: round + 2 * 3600000, shape: "normal" });
const stateOf = (me) => me.pg.evaluate(() => { try { return JSON.parse(localStorage.getItem("fleet.trip.state.v1") || "null"); } catch (e) { return null; } });
const queueOf = (me) => me.pg.evaluate(() => { try { return JSON.parse(localStorage.getItem("fleet.trip.queue.v1") || "[]"); } catch (e) { return []; } });

if (want("T16")) {
  const me = await phone({ clock: "2026-09-27T10:03:00+01:00", world: { checks: okCheck(), rehearsal: reh(R1) } });
  await startRun(me);
  await me.jump(11); await tap(me, "pickup", "N01"); await me.wait(2500);
  const banner = await me.text(".trip-rehearsal");
  const tagged = me.posted.filter(p => p.action === "trip").every(p => p.trip.rehearsal === R1);
  const heard = !!(me.world.rehTrips && me.world.rehTrips.North && me.world.rehTrips.North.served.N01);
  /* The coordinator ends it. The live server clears its runs as it does. */
  me.world.rehearsal = false; me.world.rehTrips = { North: null, South: null };
  await me.wait(7000);
  const st = await stateOf(me);
  const back = (await buttons(me)).some(b => b.indexOf("Start trip") === 0);
  const noBanner = !(await me.text(".trip-rehearsal"));
  check("T16", "when a rehearsal ends, the phone drops its test run and offers Start trip again",
        /It ends at 12:00/.test(banner) && tagged && heard && !(st && st.id) && back && noBanner,
        "banner '" + banner + "', taps name the round " + tagged + ", recorded " + heard +
        ", run kept " + JSON.stringify(st && st.id) + ", Start trip back " + back + ", banner gone " + noBanner);
  await me.ctx.close();
}

/* T16b — a tap made in a round that is over is never recorded as the next
   round's, or as real. The phone is out of signal while the round changes. */
if (want("T16b")) {
  const me = await phone({ clock: "2026-09-27T10:03:00+01:00", world: { checks: okCheck(), rehearsal: reh(R1) } });
  await startRun(me);
  await me.wait(2000);
  await me.offline(true);
  await me.jump(11); await tap(me, "pickup", "N01"); await me.wait(600);
  const waiting = (await queueOf(me)).length;
  me.world.rehearsal = reh(R2); me.world.rehTrips = { North: null, South: null };
  await me.offline(false);
  await me.pg.evaluate(() => { try { tripFlush(); } catch (e) {} });
  await me.wait(7000);
  const st = await stateOf(me);
  const left = (await queueOf(me)).length;
  const leaked = !!(me.world.rehTrips.North && me.world.rehTrips.North.served && me.world.rehTrips.North.served.N01) ||
                 !!(me.world.trips.North && me.world.trips.North.served && me.world.trips.North.served.N01);
  const back = (await buttons(me)).some(b => b.indexOf("Start trip") === 0);
  check("T16b", "a tap from a round that is over is dropped with its run, and never lands in the next round or as real",
        waiting > 0 && !leaked && left === 0 && !(st && st.id) && back,
        "queued offline " + waiting + ", recorded in another round " + leaked + ", still queued " + left +
        ", run kept " + JSON.stringify(st && st.id) + ", Start trip back " + back);
  await me.ctx.close();
}

/* T16c — a real run that has ended is put aside while a rehearsal runs, so
   the afternoon's rehearsal can be driven on the same phone. */
if (want("T16c")) {
  const me = await phone({ clock: "2026-09-27T10:03:00+01:00", world: { checks: okCheck() } });
  await startRun(me);
  await me.jump(5);
  await me.pg.evaluate(() => { try { tripEnd(); } catch (e) {} });
  await me.wait(3000);
  const ended = /Trip finished/.test(await me.text("#stopsBody"));
  me.world.rehearsal = reh(T("10:20"));
  await me.wait(7000);
  const st = await stateOf(me);
  const back = (await buttons(me)).some(b => b.indexOf("Start trip") === 0);
  const real = !!(me.world.trips.North && me.world.trips.North.ended);
  check("T16c", "during a rehearsal, an ended real run is put aside and Start trip is offered for the rehearsal",
        ended && real && !(st && st.id) && back,
        "ended first " + ended + ", real run on the record " + real + ", run kept " + JSON.stringify(st && st.id) + ", Start trip back " + back);
  await me.ctx.close();
}

/* T17 — a tap made while the one before it is still being sent reaches the
   record. Until v1.79.1 a send that succeeded wrote back the queue as it had
   been when the send went out, so a tap made during a slow send was erased:
   on screen, never on the record. */
if (want("T17")) {
  const me = await phone({ clock: "2026-09-27T10:03:00+01:00", world: { checks: okCheck() } });
  await startRun(me);
  await me.jump(44); await me.wait(1500);             /* 10:48, every stop plausible */
  me.world.tripDelayMs = 3000;
  for (const id of ["N01", "N02", "N04"]) { await tap(me, "pickup", id); await me.wait(500); }
  await me.wait(12000);
  const served = Object.keys((me.world.trips.North || {}).served || {}).sort();
  const left = (await queueOf(me)).length;
  check("T17", "taps made while an earlier one is still sending all reach the record",
        served.join() === "N01,N02,N04" && left === 0, "on the record " + served.join() + ", still queued " + left);
  await me.ctx.close();
}

/* T18 — a phone left open after a Saturday rehearsal starts the real run on
   Sunday out of signal, and the run is real. In v1.79.0, as first sent, the
   round the board last named stayed on the phone, the run carried it, and
   the live server threw the whole morning away as a test. */
if (want("T18")) {
  const SAT = Date.parse("2026-09-26T20:00:00+01:00");
  const me = await phone({ clock: "2026-09-26T21:00:00+01:00", world: { checks: okCheck(), rehearsal: reh(SAT) } });
  await me.load(); await me.close(["howDone"]);
  await me.signIn(); await me.toStops(); await me.close();
  await me.wait(2000);
  const heard = await me.pg.evaluate(() => tripRehearsal);
  await me.offline(true);
  me.world.rehearsal = false; me.world.rehTrips = { North: null, South: null };
  await me.jump(12 * 60 + 55);                         /* Sunday 09:55, still out of signal */
  await me.pg.evaluate(() => { try { tripStart("North", "NH56 FWP", true); } catch (e) {} });
  await me.wait(1500);
  const q = await queueOf(me);
  await me.offline(false);
  await me.wait(9000);
  const st = await stateOf(me);
  const sent = me.posted.filter(p => p.action === "trip").map(p => p.trip.rehearsal);
  const real = !!(me.world.trips.North && me.world.trips.North.started);
  check("T18", "after a Saturday rehearsal, a run started out of signal on Sunday is a real run and stays",
        heard === SAT && q.length > 0 && q.every(e => e.rehearsal === 0) && real && !!(st && st.id) &&
        sent.length > 0 && sent.every(r => r === 0),
        "round heard " + heard + ", queued rounds " + JSON.stringify(q.map(e => e.rehearsal)) + ", sent rounds " +
        JSON.stringify(sent) + ", on the record " + real + ", run kept " + JSON.stringify(st && st.id));
  await me.ctx.close();
}

/* T18b — a test run left open overnight goes on the Sunday morning, out of
   signal, and Start trip is offered. It used to stay in the page's memory,
   without its banner, taking the real morning's taps onto a round long over. */
if (want("T18b")) {
  const SAT = Date.parse("2026-09-26T20:00:00+01:00");
  const me = await phone({ clock: "2026-09-26T20:10:00+01:00", world: { checks: okCheck(), rehearsal: reh(SAT) } });
  await me.load(); await me.close(["howDone"]);
  await me.signIn(); await me.toStops(); await me.close();
  await me.wait(2000);
  await me.pg.evaluate(() => { try { tripStart("North", "NH56 FWP", true); } catch (e) {} });
  await me.wait(2500);
  const before = await stateOf(me);
  await me.offline(true);
  await me.jump(13 * 60 + 45);                         /* Sunday 09:55, no signal */
  await me.wait(7000);
  const st = await stateOf(me);
  const back = (await buttons(me)).some(b => b.indexOf("Start trip") === 0);
  const left = (await queueOf(me)).filter(e => Number(e.rehearsal)).length;
  check("T18b", "a test run left open overnight goes on the Sunday morning, out of signal, and Start trip is offered",
        before && before.rehearsal === SAT && !(st && st.id) && back && left === 0,
        "test run first " + JSON.stringify(before && before.rehearsal) + ", run kept " + JSON.stringify(st && st.id) +
        ", Start trip " + back + ", test taps still queued " + left);
  await me.ctx.close();
}

/* T16d — at the end of a round, a board answer built a moment before it does
   not hand the phone its test run back as a real one. */
if (want("T16d")) {
  const R = Date.parse("2026-09-30T20:00:00+01:00");
  const me = await phone({ clock: "2026-09-30T20:00:30+01:00",
    world: { checks: okCheck(), rehearsal: { round: R, ends: R + 10 * 60000, shape: "normal" } } });
  await me.load(); await me.close(["howDone"]);
  await me.signIn(); await me.toStops(); await me.close();
  await me.wait(2000);
  await me.pg.evaluate(() => { try { tripStart("North", "NH56 FWP", true); } catch (e) {} });
  await me.wait(3000);
  const had = !!(me.world.rehTrips && me.world.rehTrips.North && me.world.rehTrips.North.started);
  await me.jump(11);                                   /* past its end; the server's answer is a moment old */
  await me.wait(12000);
  const st = await stateOf(me);
  check("T16d", "a board answer from just before the end does not hand the test run back",
        had && !(st && st.id), "test run on the server " + had + ", run kept " + JSON.stringify(st && st.id) +
        " with round " + JSON.stringify(st && st.rehearsal));
  await me.ctx.close();
}

await done();
const bad = results.filter(r => !r.ok);
console.log("\n  " + results.length + " checks, " + (results.length - bad.length) + " passed, " + bad.length + " failed");
process.exit(bad.length ? 1 : 0);
