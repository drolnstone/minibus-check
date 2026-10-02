/* ==========================================================================
   MINIBUS API — Cloudflare Worker

   Answers the calls that happen DURING a Sunday. Everything administrative
   stays on Apps Script: the rota, the PIN's authority, the emails, the menus,
   the archiver. Nothing in that list has somebody standing at a kerb waiting
   for it.

   The walkaround used to be on that list. It came off it on 20 September
   2026, when a check took long enough to send that it failed at the kerb.
   It lands here now and Apps Script files it on the drain, the same way the
   stop taps always have.

   The payload shapes here are byte-compatible with Code.gs on purpose. That
   is the whole trick: both pages needed one constant changed and nothing
   else, so every fix already in them — the service worker race, the
   sequential flush, the stepper, the focus handling — survives untouched.
   If you ever change a shape here, you have to change it in Code.gs too,
   because the rollback path is the pages pointing back at Apps Script.

   WHAT ANSWERS: the version below is printed on both pages beside their own.
   A page reading "script w..." is talking to this Worker; one reading
   "script v1.50.0" has fallen back to Apps Script. That one line tells you
   which backend served a page without opening anything.
   ========================================================================== */

const SCRIPT_VERSION = "w2.35.0";

/* THE SHEET'S OWN VERSION, so both apps can print all three numbers on one
   line and nobody has to open the spreadsheet to find the third.

   It is not this file's number to know, so it is told: every sync from Apps
   Script carries the version of the Apps Script that sent it, and that is
   parked in settings and handed back on every reply.

   Held in a module variable because json() is synchronous and has no env to
   read from. An isolate that has never seen a sync loads it once, and after
   that it is refreshed on a timer, because a second isolate that was already
   warm when the sync arrived would otherwise keep printing the old number
   until it was recycled. Five minutes of staleness on a version stamp that
   only changes on a deploy is nothing, and the same five minutes already
   applies to the PIN hashes. */
const SHEET_VERSION_TTL = 5 * 60 * 1000;
let sheetVersion = "";
let sheetVersionAt = 0;

/* WHO PEOPLE RING, and it rides the same way as the version above.

   From w2.21.0 it is the row with Role Coordinator on the Drivers tab, told
   on every sync, parked in settings and stamped on every reply by json(). No
   page carries a name or a number of its own any more; each takes this from
   whatever answer it gets first and keeps it for when there is no signal.

   Null until a sheet that sends it has synced, and then nothing is stamped,
   so a page keeps whatever it last knew rather than being told "nobody". */
let coordinator = null;

/* WHOSE TITLES MAKE THEM A COORDINATOR, the same way. From w2.22.0 the list
   is COORDINATOR_ROLES in the sheet's Script Properties, sent on every sync
   as authRules and kept in settings for this server's own checks already.
   Stamped on every reply as leadRoles, so the pages use the sheet's list
   rather than the one typed into config.js. Null until a sync has sent one. */
let leadRoles = null;

function rolesOf(v) {
  if (!Array.isArray(v)) return null;
  const list = v.map((r) => String(r || "").replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean);
  return list.length ? list.slice(0, 12) : null;
}

/* The drivers' WhatsApp numbers as the sheet sends them, cleaned: a name of
   sixty characters at most, and a number of 11 to 15 digits or nothing. */
function driverWaOf(v) {
  const out = {};
  if (!v || typeof v !== "object") return out;
  for (const k of Object.keys(v).slice(0, 200)) {
    const name = String(k || "").trim().slice(0, 60);
    const wa = String(v[k] == null ? "" : v[k]).replace(/\D/g, "");
    if (name && wa.length >= 11 && wa.length <= 15) out[name] = wa;
  }
  return out;
}

function coordinatorOf(v) {
  if (!v || typeof v !== "object") return null;
  return { name: String(v.name || "").trim().slice(0, 60),
           phone: String(v.phone || "").trim().slice(0, 24) };
}

async function sheetVersionLoad(env) {
  /* Gated on WHEN it was last looked for, never on what was found. Gated on
     the value, an isolate that found nothing — which is every isolate until
     the sync has run once — would read the database again on every single
     request, for ever. Not finding it is an answer, and it is cached for the
     same five minutes as finding it. */
  if (sheetVersionAt && (Date.now() - sheetVersionAt) < SHEET_VERSION_TTL) return;

  /* Stamped before the read, compared after it. One isolate serves many
     requests at once: this read can be in flight when a sync on the next
     request commits a NEWER value and sets the variable directly. Assigning
     unconditionally on the way back would put the older number over the top
     of it and hold it there for the full five minutes. A read older than
     what is already in hand is thrown away. */
  const asked = Date.now();
  try {
    const rows = await env.DB.prepare(
      "SELECT k, v FROM settings WHERE k IN ('sheet_version','coordinator','auth_rules')").all();
    const got = {};
    for (const r of (rows && rows.results) || []) got[r.k] = r.v;
    if (sheetVersionAt <= asked) {
      sheetVersion = String(got.sheet_version || "");
      let c = null;
      try { c = got.coordinator ? JSON.parse(got.coordinator) : null; } catch (e) { c = null; }
      coordinator = coordinatorOf(c);
      let r = null;
      try { r = got.auth_rules ? JSON.parse(got.auth_rules) : null; } catch (e) { r = null; }
      leadRoles = rolesOf(r && r.roles);
    }
  } catch (e) { /* a version stamp is never worth failing a request over */ }
  if (sheetVersionAt <= asked) sheetVersionAt = Date.now();
}

/* ---- the two values that are not code ----------------------------------

   Both are read from the environment first and fall back to the literal
   below, which is the same pattern COORDINATOR_EMAIL already follows in
   Code.gs: a value a file should not really be carrying, kept working
   either way.

   It matters because of where this file might live. Pasted into the
   Cloudflare dashboard it is private, and the literals are no more exposed
   than Code.gs is today. Put it in a PUBLIC GitHub repository to get
   automatic deploys and they are on the open web — so if you ever take that
   route, set both as Secrets in the Worker's settings first and delete the
   literals here. Nothing else has to change.

   TOKEN must match TOKEN in Code.gs. It guards the driver's trip taps and
   the sync and nothing else: bookings have never used it and do not need
   it, because there is nothing on a booking row that names anybody.

   PHONE_SALT must match PHONE_SALT in Code.gs EXACTLY. Change it and every
   fingerprint already on the Bus Bookings tab stops matching the number
   that made it, orphaning every live booking at once. */
const TOKEN_FALLBACK = "minibusapp";
const SALT_FALLBACK = "rccg dominion liverpool minibus v1";

const tokenOf = (env) => (env && env.TOKEN) || TOKEN_FALLBACK;

/* THE SHEET'S OWN PASSWORD, from w2.23.0.

   TOKEN is in config.js, so every phone has it and so does anybody who reads
   the page source. It is right for what phones send. It was also all that
   guarded what only the spreadsheet should send: a sync that replaces the
   rota, drivers and stops, the drain, a coordinator alert. SHEET_TOKEN is a
   second password that only the spreadsheet and this Worker know: a Secret
   here, a Script Property there, the same value in both. Those messages need
   it, and so does everything this Worker sends to the sheet.

   Not set, nothing changes, so a Worker deployed before the Secret is added
   keeps working. "Is the live server working?" says when it is missing. */
const sheetTokenOf = (env) => String((env && env.SHEET_TOKEN) || "");
const SHEET_ONLY_ACTIONS = ["ping", "mint", "outcome", "cleartrips", "rehearsal", "sync",
                            "coordAlert", "drain", "drained", "sheetbookings"];
function sheetTokenOk(env, body) {
  const want = sheetTokenOf(env);
  return !want || String((body && body.sheetToken) || "") === want;
}
const saltOf = (env) => (env && env.PHONE_SALT) || SALT_FALLBACK;

const TZ = "Europe/London";

/* All the same numbers as Code.gs, and they must stay the same numbers. */
const BOOKING_CUTOFF_DAY = 0, BOOKING_CUTOFF_HOUR = 9, BOOKING_CUTOFF_MIN = 30;
const RUN_BACKSTOP_HOUR = 12, RUN_BACKSTOP_MIN = 0;
const TRIP_QUIET_MINUTES = 15;
const TRIP_MAX_EARLY = 12;
const TRIP_IMMINENT_MINUTES = 1;
const RUN_DONE_MARGIN_MIN = 30;
const RUN_DONE_QUIET_MIN = 30;
const REHEARSAL_HOURS = 2;
const IDENTIFY_MAX_TRIES = 25;
const IDENTIFY_WINDOW_MINUTES = 15;

/* ==========================================================================
   LONDON TIME

   Workers run in UTC. Apps Script ran in Europe/London, and every date in
   this app is a local one: a Sunday is a London Sunday, the cutoff is 09:30
   London, a stop timetabled 10:05 is 10:05 London. Do this with UTC maths
   and the whole thing is an hour out for seven months of the year and right
   for the other five, which is the worst kind of wrong — it would work all
   winter and break on the last Sunday in March.
   ========================================================================== */

function tzOffsetMs(date) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  const p = {};
  for (const part of f.formatToParts(date)) p[part.type] = part.value;
  const asIfUTC = Date.UTC(+p.year, +p.month - 1, +p.day,
                           p.hour === "24" ? 0 : +p.hour, +p.minute, +p.second);
  return asIfUTC - date.getTime();
}

/* The London calendar fields of a moment. */
function londonParts(date) {
  const d = new Date(date.getTime() + tzOffsetMs(date));
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    hh: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay()
  };
}

const p2 = (n) => (n < 10 ? "0" : "") + n;

/* YYYY-MM-DD for the London day a moment falls in. */
function londonKey(date) {
  const p = londonParts(date);
  return p.y + "-" + p2(p.m) + "-" + p2(p.d);
}

/* A London wall-clock time on a given day, as a real instant.

   Two passes on purpose. The offset depends on the instant, and the instant
   is what we are working out, so the first pass can land on the wrong side
   of a clock change. The second pass corrects it. On the two Sundays a year
   when the clocks move this is the difference between a bus that is on time
   and one the page says is an hour late. */
function londonMoment(key, hhmm) {
  const [y, m, d] = String(key).split("-").map(Number);
  const [hh, mi] = String(hhmm || "00:00").split(":").map(Number);
  if (!y || !m || !d || isNaN(hh) || isNaN(mi)) return null;
  const wall = Date.UTC(y, m - 1, d, hh, mi, 0);
  let t = wall - tzOffsetMs(new Date(wall));
  t = wall - tzOffsetMs(new Date(t));
  return new Date(t);
}

function londonHHMM(date) {
  const p = londonParts(date);
  return p2(p.hh) + ":" + p2(p.mi);
}

function keyAddWeeks(key, n) {
  const [y, m, d] = String(key).split("-").map(Number);
  const t = Date.UTC(y, m - 1, d + n * 7);
  const x = new Date(t);
  return x.getUTCFullYear() + "-" + p2(x.getUTCMonth() + 1) + "-" + p2(x.getUTCDate());
}

/* The coming Sunday, or today when today IS Sunday. Same rule as sundayOf. */
function sundayKeyOf(date) {
  const p = londonParts(date);
  if (p.dow === 0) return londonKey(date);
  const t = Date.UTC(p.y, p.m - 1, p.d + (7 - p.dow));
  const x = new Date(t);
  return x.getUTCFullYear() + "-" + p2(x.getUTCMonth() + 1) + "-" + p2(x.getUTCDate());
}

function anyToKey(v) {
  const s = String(v == null ? "" : v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (uk) return uk[3] + "-" + p2(+uk[2]) + "-" + p2(+uk[1]);
  return "";
}

/* ==========================================================================
   THE ESTIMATE
   ==========================================================================

   Until v1.71.0 a passenger's estimate was his own timetabled time plus
   however many minutes the bus was running behind at the last stop it marked.
   Honest, cheap, and wrong in one specific way: it projects over the
   TIMETABLE, including the stops the bus is not going to make. On a morning
   where four of the seven North stops have nobody booked, the bus reaches
   London Road several minutes before the estimate says, because the estimate
   has charged it for four stops it drove straight past.

   THE DIRECTION OF THE ERROR IS THE WHOLE DESIGN. An estimate that is too
   LATE means the bus comes early and the passenger misses it, and the next
   one is next week. An estimate that is too EARLY means he waits at a kerb he
   was going to stand at anyway. Those costs are not equal, so where this is
   unsure it leans towards predicting the bus earlier. Every default below is
   set that way and anything added here should be too.

   Skipping a stop removes two things: the time the bus stands there, and the
   extra distance it drives to reach that kerb and get back out again.

       saving = dwell + detour
       detour = drive(prev->skipped) + drive(skipped->next) - drive(prev->next)

   The detour needs coordinates. The dwell does not, and on this timetable the
   dwell is nearly all of it: S03 and S04 are 195 metres apart with three
   minutes between them, which is twenty seconds of driving and two and a half
   of standing. So a saving modelled as DISTANCE saved would barely move the
   estimate in a cluster, and the bus would keep arriving early — the exact
   fault this replaces. Dwell is the term that matters; distance is the
   correction. */

const ETA_FALLBACK = {
  dwellSeconds: 75,
  skipSaves: 0.8,
  speedMph: 18,
  maxSkipMinutes: 6,
  /* From w2.16.0. How far behind the timetable a bus may be and still be
     given an estimate. 0 is no limit, which is the ruling of 27 September:
     a bus an hour late is still coming, and the people waiting for it want
     the time more than anybody. It was a fixed 45 until w2.15.0. */
  maxBehindMinutes: 0,
  /* How long an estimate stays up once its time has passed with the stop
     still unmarked. It was two minutes, after which the page dropped back to
     the timetable while the bus was plainly still on its way. Fifteen is the
     same as the quiet rule, so in practice the estimate stays until the bus
     is marked at that stop or a later one, or goes quiet. */
  keepMinutes: 15
};

/* ==========================================================================
   A DECISION MADE FROM AN EMAIL
   ==========================================================================

   Two things arrive in the coordinator's inbox and both used to end with
   "open the spreadsheet": a bus stopped by a critical defect, and a driver
   asking to swap or be covered. Both are decisions he can make from the
   message itself, having already read everything he needs, and both were
   costing him a laptop.

   IT IS NEVER A ONE-CLICK LINK, and that is the whole shape of this.

   A link that ACTS when it is opened is acted on by whatever opens it, and
   plenty of things open a link before a person does: the mail provider
   scanning for malware, the phone warming up a preview, a corporate gateway
   rewriting the URL and fetching it to see where it goes. Any of those would
   authorise a bus with a fault on it, or approve a swap, while the email was
   still unread. That is not a theoretical risk; it is the ordinary behaviour
   of modern mail.

   So the link opens a PAGE. The page says what the decision is and asks for
   the coordinator's own PIN, checked here, with the same three tries and the
   same five minute lockout as everything else that carries his name. Looking
   costs nothing and burns nothing, so a scanner may fetch it as often as it
   likes. Only the PIN acts.

   ONE USE, AND IT EXPIRES. An hour by default. A mailbox is a filing cabinet
   people keep for years, and a link that still works in March is a way into
   the record that nobody is watching.

   WHAT A LINK REVEALS is exactly what the email it came in already said, and
   no more. Somebody holding the link learns nothing they did not have. */

const LINK_FALLBACK = { on: true, ttlMinutes: 60 };

async function linkRules(env) {
  let r = null;
  try { r = await cacheGet(env, "link_rules"); } catch (e) {}
  const n = Number(r && r.ttlMinutes);
  return {
    on: !(r && r.on === false),
    ttlMinutes: (isFinite(n) && n > 0) ? Math.min(60 * 24 * 7, n) : LINK_FALLBACK.ttlMinutes
  };
}

let linksReady = false;
async function ensureLinks(env) {
  if (linksReady) return;
  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS links (" +
      "  token   TEXT PRIMARY KEY," +
      "  kind    TEXT NOT NULL," +
      "  subject TEXT NOT NULL," +
      "  made    INTEGER NOT NULL," +
      "  expires INTEGER NOT NULL," +
      "  used    INTEGER NOT NULL DEFAULT 0," +
      "  used_at INTEGER," +
      "  used_by TEXT NOT NULL DEFAULT ''," +
      "  choice  TEXT NOT NULL DEFAULT ''," +
      "  cover   TEXT NOT NULL DEFAULT ''," +
      "  synced  INTEGER NOT NULL DEFAULT 0)"
    ).run();
    /* Added to a database that already had the table, the same way every
       other column in this file arrives: asked for, allowed to fail because
       it is already there, and then CHECKED rather than assumed. */
    try {
      await env.DB.prepare("ALTER TABLE links ADD COLUMN cover TEXT NOT NULL DEFAULT ''").run();
    } catch (e) { /* already there */ }
    await env.DB.prepare("SELECT token, cover FROM links LIMIT 1").all();
    linksReady = true;
  } catch (e) { linksReady = false; }
}

/* Long enough that guessing is not a strategy, short enough to survive being
   wrapped by a mail gateway. 128 bits, hex, from the platform's own generator
   and never from Math.random. */
function newToken() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => ("0" + x.toString(16)).slice(-2)).join("");
}

/* Apps Script asks for one as it builds the email. If this fails the email
   still goes, without a link and saying so: a decision that has to be made on
   the spreadsheet is the behaviour everybody already has. */
async function handleMintLink(env, body) {
  const rules = await linkRules(env);
  if (!rules.on) return json({ ok: false, error: "off" });
  await ensureLinks(env);

  const l = (body && body.link) || {};
  const kind = String(l.kind || "").trim();
  if (kind !== "authorise" && kind !== "rota") return json({ ok: false, error: "kind" });

  const token = newToken();
  const now = Date.now();
  const ttl = Number(l.ttlMinutes) > 0 ? Math.min(60 * 24 * 7, Number(l.ttlMinutes)) : rules.ttlMinutes;

  await env.DB.prepare(
    "INSERT INTO links (token, kind, subject, made, expires) VALUES (?,?,?,?,?)"
  ).bind(token, kind, JSON.stringify(l.subject || {}), now, now + ttl * 60000).run();

  return json({ ok: true, token: token, expires: now + ttl * 60000, minutes: ttl });
}

/* What a link is about. Looking burns nothing: see the note above about what
   opens a link before a person does. */
/* WHO COULD TAKE IT, AND WHAT A COORDINATOR NEEDS TO KNOW ABOUT EACH.

   A bare list of names is the thing I said should not go in an email, and I
   was right about the list and wrong about the conclusion. Picking cover is a
   judgement about people: who is already out that morning, and who has been
   asked most recently. Both of those are in the record this server already
   holds, so the page can carry the judgement rather than just the names.

     busy   the route they are already down for on THAT Sunday, if any. A man
            cannot cover North while he is driving South.
     last   the most recent Sunday they were down for, so "ask the one who
            has not done it for a while" is a thing the eye can do.

   The requester is left out: he is the one asking to be excused. */
async function coverCandidates(env, key, exclude) {
  const skip = String(exclude || "").trim().toLowerCase();
  let people = [];
  try {
    const r = await env.DB.prepare(
      "SELECT name FROM drivers WHERE active = 1 ORDER BY ord, name").all();
    people = (r.results || []).map((d) => String(d.name || "").trim()).filter(Boolean);
  } catch (e) { return []; }

  let rows = [];
  try {
    const r = await env.DB.prepare(
      "SELECT sunday, north, north_cover, south, south_cover FROM rota ORDER BY sunday DESC LIMIT 120"
    ).all();
    rows = r.results || [];
  } catch (e) { rows = [] }

  const today = sundayKeyOf(new Date());
  const on = (row, who) => {
    const w = who.toLowerCase();
    if (String(row.south_cover || row.south || "").trim().toLowerCase() === w) return "South";
    if (String(row.north_cover || row.north || "").trim().toLowerCase() === w) return "North";
    return "";
  };

  const target = rows.find((x) => String(x.sunday) === key) || null;

  return people.filter((n) => n.toLowerCase() !== skip).map((n) => {
    let last = "";
    for (const row of rows) {
      if (String(row.sunday) > today) continue;      /* not driven yet */
      if (on(row, n)) { last = String(row.sunday); break; }
    }
    return { name: n, busy: target ? on(target, n) : "", last: last };
  });
}

async function handleLinkWhat(env, body) {
  await ensureLinks(env);
  const token = String((body && body.token) || "").trim();
  if (!/^[0-9a-f]{32}$/.test(token)) return json({ ok: false, error: "no link" });

  const row = await env.DB.prepare("SELECT * FROM links WHERE token=?").bind(token).first();
  if (!row) return json({ ok: false, error: "no link" });

  let subject = {};
  try { subject = JSON.parse(row.subject || "{}"); } catch (e) {}

  const out = {
    ok: true, kind: row.kind, subject: subject,
    used: !!row.used, usedBy: row.used_by || "", choice: row.choice || "",
    expired: Date.now() > Number(row.expires),
    minutesLeft: Math.max(0, Math.round((Number(row.expires) - Date.now()) / 60000))
  };

  /* A stopped bus may have been dealt with elsewhere since the email went,
     from the app or from the Outcome column, and the page should say so
     rather than offering a decision somebody has already made. */
  if (row.kind === "authorise" && subject.reg) {
    try {
      const nowState = await checksToday(env);
      const rec = nowState[subject.reg] || null;
      out.state = rec ? rec.state : "";
      out.stateBy = rec ? (rec.by || "") : "";
      out.stale = !!(rec && subject.checkId && rec.id && String(rec.id) !== String(subject.checkId));
    } catch (e) {}
  }
  /* WHO COULD COVER IT. Only for a request that WANTS a cover: a swap names
     its own partner and moves two Sundays, so offering a third name there
     would be offering to do something else entirely. */
  if (row.kind === "rota" && String(subject.type || "") !== "Request a swap") {
    try {
      out.candidates = await coverCandidates(env, String(subject.sunday || ""),
                                             String(subject.driver || ""));
    } catch (e) { out.candidates = []; }
  }

  /* WHO MAY DECIDE, as a count rather than a list of names.

     The page says "Your PIN" and now knows whether anybody's would do. None
     at all is worth saying before somebody types four digits and is told they
     are wrong: it means no active coordinator has a PIN against their name in
     the Drivers tab, which is a spreadsheet problem and not a typing one. */
  try {
    const rules = await authRules(env);
    const people = await env.DB.prepare(
      "SELECT role, pin_hash FROM drivers WHERE active = 1").all();
    out.canDecide = (people.results || []).filter((d) =>
      String(d.pin_hash || "") &&
      rules.roles.indexOf(String(d.role || "").trim().toLowerCase()) !== -1).length;
  } catch (e) { out.canDecide = null; }

  return json(out);
}

/* The PIN, and the decision. This is the only thing here that acts. */
async function handleLinkDo(env, body) {
  await ensureLinks(env);
  const token = String((body && body.token) || "").trim();
  const pin = String((body && body.pin) || "").replace(/\D/g, "");
  const choice = String((body && body.choice) || "").trim();
  if (!/^[0-9a-f]{32}$/.test(token)) return json({ ok: false, error: "no link" });

  const row = await env.DB.prepare("SELECT * FROM links WHERE token=?").bind(token).first();
  if (!row) return json({ ok: false, error: "no link" });
  if (row.used) return json({ ok: false, error: "used", by: row.used_by || "", choice: row.choice || "" });
  if (Date.now() > Number(row.expires)) return json({ ok: false, error: "expired" });

  let subject = {};
  try { subject = JSON.parse(row.subject || "{}"); } catch (e) {}

  /* ANY COORDINATOR'S PIN, WHICH IS THE RULE THE APP HAS ALWAYS USED.

     This asked for ONE named person's — subject.to, which the spreadsheet
     fills in with coordinatorName(). That name is whoever COORDINATOR_EMAIL
     matches in the Email column, FALLING BACK to the first active driver in
     an authorising role when nothing matches.

     On 24 September a coordinator opened his own link, keyed his own PIN, and
     was told it was not right. It was not right — for the man the fallback had
     chosen, who is first in the Drivers tab and whose hash it was being
     compared against. Nothing on the page said whose PIN it wanted, so there
     was no way to see that from the outside, and the one message it could
     give was the one that sounds like your own mistake.

     One rule, in one place: the app lets any active driver in an authorising
     role authorise a bus, so this does too, and the record names whoever
     actually keyed a PIN rather than whoever the email happened to be
     addressed to.

     THE TRIES ARE COUNTED PER LINK, not per name. There is no name to count
     against until one matches, and a link is the thing being guessed at. */
  const rules = await authRules(env);
  const people = await env.DB.prepare(
    "SELECT name, role, pin_hash FROM drivers WHERE active = 1").all();
  const may = (people.results || []).filter((d) =>
    String(d.pin_hash || "") &&
    rules.roles.indexOf(String(d.role || "").trim().toLowerCase()) !== -1);
  if (!may.length) return json({ ok: false, error: "no pin" });

  const tkey = pinTriesKey("link:" + token);
  const held = await cacheGet(env, tkey);
  const now = Date.now();
  let tries = 0;
  if (held && now - (Number(held.at) || 0) < PIN_LOCK_MINUTES * 60000) tries = Number(held.n) || 0;
  if (tries >= PIN_MAX_TRIES) return json({ ok: false, locked: true, minutes: PIN_LOCK_MINUTES });

  let driver = null;
  if (pin) {
    for (const d of may) {
      if (await pinHashOf(env, d.name, pin) === d.pin_hash) { driver = d; break; }
    }
  }
  if (!driver) {
    try { await cachePut(env, tkey, { n: tries + 1, at: now }).run(); } catch (e) {}
    return json({ ok: false, error: "bad pin", left: Math.max(0, PIN_MAX_TRIES - tries - 1) });
  }
  try { await env.DB.prepare("DELETE FROM settings WHERE k=?").bind(tkey).run(); } catch (e) {}

  if (row.kind === "authorise") {
    if (choice !== "run") return json({ ok: false, error: "choice" });
    /* Through the ordinary handler, so a bus authorised from an email and a
       bus authorised from the app are the same act writing the same record.
       It re-checks that the bus is still stopped and that this check is still
       the current one, which is exactly what should happen to a decision made
       from a message that may have sat in an inbox for fifty minutes. */
    const res = await handleAuthorise(env, {
      authorise: { reg: subject.reg, who: driver.name, pin: pin,
                   inspector: subject.inspector || "" }
    });
    const out = JSON.parse(await res.text());
    if (!out.ok) return json(out);
    await burnLink(env, token, driver.name, choice);
    return json({ ok: true, kind: "authorise", by: driver.name, reg: subject.reg });
  }

  if (row.kind === "rota") {
    if (choice !== "Approved" && choice !== "Rejected") return json({ ok: false, error: "choice" });

    /* THE NAME IS CHECKED AGAINST THE REGISTER, not taken on trust from the
       request. A page can send anything; only somebody the spreadsheet knows
       as an active driver may be written into a Sunday. Anything else is
       dropped rather than refused, because the decision itself is still
       good — it simply lands as "approved, cover to be arranged", which is
       exactly what it was before this page could offer a cover at all. */
    let cover = String((body && body.cover) || "").trim();
    if (cover && choice === "Approved") {
      const ok = await env.DB.prepare(
        "SELECT name FROM drivers WHERE active = 1 AND lower(name) = lower(?)").bind(cover).first();
      cover = ok ? String(ok.name) : "";
    } else {
      cover = "";
    }
    if (cover) {
      try {
        await env.DB.prepare("UPDATE links SET cover = ? WHERE token = ?").bind(cover, token).run();
      } catch (e) { /* an older database has no such column; the rest stands */ }
    }
    /* Written down here first, so that it is safe whatever happens next. */
    await burnLink(env, token, driver.name, choice);

    /* THEN CARRIED OVER AT ONCE, if the spreadsheet is there to take it.

       The Rota Requests tab is where this actually lands, and approving a
       swap moves two Sundays and sends two emails — all of it on the other
       side. Handing it over now rather than waiting to be asked for it is
       the difference between a man watching the rota change and a man being
       told to come back later.

       'applied' is the truth about which of those just happened, and the
       page words itself from it. Never guessed at: unheard is not applied,
       and the drain is underneath either way. */
    const applied = await pushDecision(env, token, {
      id: subject.id || "", sunday: subject.sunday || "",
      driver: subject.driver || "", choice: choice, cover: cover,
      by: driver.name, at: Date.now()
    });

    return json({ ok: true, kind: "rota", by: driver.name, choice: choice,
                  cover: cover, applied: applied, request: subject.id || "" });
  }

  return json({ ok: false, error: "kind" });
}

/* ---- KNOCKING ON THE SPREADSHEET'S DOOR --------------------------------

   The one call this server makes outwards, and it exists for one reason: a
   man standing in a car park at half past nine has just keyed his PIN to
   approve somebody's cover, and "it will be on the rota within five minutes"
   is not an answer. It is an answer about our plumbing.

   The decision is already written down here and already queued for the drain
   before this is called. This is a shortcut, not a route: if the sheet is
   slow, asleep, redeployed, over quota or simply not answering, we say
   nothing about it, mark nothing, and the ordinary five minute tick carries
   the same decision in the ordinary way. The only thing that changes is how
   long somebody stands there.

   CAPPED AT EIGHT SECONDS. Apps Script waking up cold can take most of that;
   past it, waiting costs the person more than the certainty is worth, and
   the honest "within five minutes" is right there to fall back on. */
const SHEET_PUSH_MS = 8000;

async function sheetPush(env, payload, capMs) {
  /* The same call as sheetAsk in THE COORDINATOR'S APP, which also hands
     back what the sheet said. Here only whether it said yes. The redirect is
     followed on purpose: a POST to /exec answers 302 to googleusercontent,
     and fetch re-issues that as a GET, which is how Apps Script serves a web
     app's reply. doPost has already run by then. The cap is overridable
     (env.SHEET_PUSH_MS) so it can be tested without waiting eight seconds. */
  const out = await sheetAsk(env, payload, capMs);
  return !!(out && out.ok === true);
}

/* A decision carried over at once. Answers true only if the spreadsheet said
   it had it, which is the only thing that may mark it done here. */
async function pushDecision(env, token, decision) {
  let landed = false;
  try { landed = await sheetPush(env, { action: "decision", decision: decision }); }
  catch (e) { landed = false; }
  if (!landed) return false;
  /* Marked so the next drain does not carry it a second time. Harmless if
     this fails — applyRotaDecision leaves a decided request alone. */
  try {
    await env.DB.prepare("UPDATE links SET synced=1 WHERE token=?").bind(token).run();
  } catch (e) {}
  return true;
}

async function burnLink(env, token, by, choice) {
  await env.DB.prepare(
    "UPDATE links SET used=1, used_at=?, used_by=?, choice=? WHERE token=?"
  ).bind(Date.now(), String(by || ""), String(choice || ""), token).run();
}

/* Old links, cleared on the way past. A mailbox keeps a link for years and
   this table should not. Anything expired more than a week ago has nothing
   left to say, and a used rota decision is kept until the sheet has it. */
async function sweepLinks(env) {
  try {
    await ensureLinks(env);
    await env.DB.prepare("DELETE FROM links WHERE expires < ? AND (used = 0 OR synced = 1)")
      .bind(Date.now() - 7 * 86400000).run();
  } catch (e) {}
}

/* ---- WHEN A PASSENGER IS TOLD SOMETHING --------------------------------

   Pushed from config.js on every sync, same as the authorise rules and the
   estimate's. The four that matter:

     resendMinutes    the estimate has to have moved by more than this before
                      a passenger is told again. The stop just before his and
                      his own always send, whatever this says.
     morningMessage   the first message of the day, sent at the same time as
                      the drivers are told they are driving.
     quietFrom/To     hours nothing is sent between, in London time. A booking
                      reminder is a convenience and a convenience does not
                      wake anybody up.

   WHY resendMinutes EXISTS. North has eight pickups and South seven, so on a
   full morning a passenger at the last stop is woken once for every booked
   stop in front of him. The coordinates show where those land: S05, S06 and
   S07 sit inside 438 metres of each other, and N05 through N07 inside 556.
   Without a threshold the last man on either route gets three buzzes in a few
   minutes, all saying very nearly the same thing, and the one that mattered
   is the one he has stopped reading. */
const PASSENGER_FALLBACK = {
  resendMinutes: 3,
  morningMessage: true,
  quietFrom: 21,
  quietTo: 8
};

/* When the booking nudges go out, until the sheet says otherwise. Days are 0
   for Sunday and the hours are whole hours in London time. */
const BOOKING_FALLBACK = {
  on: true,
  oncePerWeek: false,
  windows: [
    { day: 0, from: 15, to: 16 },   /* Sunday afternoon, after the run */
    { day: 3, from: 18, to: 19 },   /* Wednesday evening */
    /* Saturday evening, the last one that can act, and from w2.19.0 the one
       that tells a man with a seat what he has booked. */
    { day: 6, from: 18, to: 19, booked: true }
  ]
};

async function bookingRules(env) {
  let r = null;
  try { r = await cacheGet(env, "booking_rules"); } catch (e) {}
  const num = (x, y) => (typeof x === "number" && isFinite(x) && x >= 0) ? x : y;

  /* A window, or null if it is not one. A day nobody has written down is not
     a window at midnight — it is a typo, and dropping it is the only safe
     reading. `to` can never be earlier than `from`, so a transposed pair
     yields a moment rather than a window that spans the whole clock. */
  const win = (v) => {
    if (!v || typeof v !== "object") return null;
    const day = num(v.day, -1);
    if (!(day >= 0 && day <= 6)) return null;
    const from = Math.min(23, num(v.from, 0));
    return { day: day, from: from, to: Math.max(from, Math.min(23, num(v.to, from))),
             booked: v.booked === true };
  };

  /* EITHER SHAPE, AND THIS IS NOT TIDINESS.

     The deploy order is worker first, spreadsheet second, so for the few
     minutes between those two steps this Worker is reading settings the OLD
     script pushed — `after` and `mid` rather than `windows`. Unrecognised,
     that would fall to the built-in list, which is a different schedule
     again. Understood, the nudges keep the old times until the sheet goes up
     and the new times from the moment it does.

     A sheet that has never synced leaves r null, and the built-in below is
     what runs. */
  let list = [];
  if (r && Array.isArray(r.windows)) list = r.windows.map(win).filter(Boolean);
  else if (r && (r.after || r.mid)) list = [win(r.after), win(r.mid)].filter(Boolean);
  if (!list.length) list = BOOKING_FALLBACK.windows.map(win).filter(Boolean);

  return {
    on: !(r && r.on === false),
    oncePerWeek: (r && typeof r.oncePerWeek === "boolean")
                   ? r.oncePerWeek : BOOKING_FALLBACK.oncePerWeek,
    windows: list
  };
}

async function passengerRules(env) {
  let r = null;
  try { r = await cacheGet(env, "passenger_rules"); } catch (e) {}
  const num = (v, d) => (typeof v === "number" && isFinite(v) && v >= 0) ? v : d;
  return {
    resendMinutes:  num(r && r.resendMinutes, PASSENGER_FALLBACK.resendMinutes),
    morningMessage: !(r && r.morningMessage === false),
    quietFrom:      Math.min(23, num(r && r.quietFrom, PASSENGER_FALLBACK.quietFrom)),
    quietTo:        Math.min(23, num(r && r.quietTo, PASSENGER_FALLBACK.quietTo))
  };
}

/* Is it the middle of the night in Liverpool?

   Written to cope with a window that crosses midnight, which is the only kind
   anybody would set: 21 to 8 is nine hours, not minus thirteen. Equal hours
   mean no quiet time at all rather than a whole day of it, because a setting
   somebody has switched off should switch it off. */
function quietNow(rules, when) {
  const p = londonParts(when || new Date());
  const from = rules.quietFrom, to = rules.quietTo;
  if (from === to) return false;
  return from < to ? (p.hh >= from && p.hh < to) : (p.hh >= from || p.hh < to);
}

/* Pushed from config.js on every sync, exactly as the authorise rules are, so
   the number a passenger is shown and the number a driver is shown come from
   one place and cannot drift apart. */
async function etaSettings(env) {
  let r = null;
  try { r = await cacheGet(env, "eta_rules"); } catch (e) {}
  const num = (v, d) => (typeof v === "number" && isFinite(v) && v >= 0) ? v : d;
  return {
    dwellSeconds:   num(r && r.dwellSeconds,   ETA_FALLBACK.dwellSeconds),
    skipSaves:      Math.min(1, num(r && r.skipSaves, ETA_FALLBACK.skipSaves)),
    speedMph:       Math.max(4, num(r && r.speedMph, ETA_FALLBACK.speedMph)),
    maxSkipMinutes: num(r && r.maxSkipMinutes, ETA_FALLBACK.maxSkipMinutes),
    maxBehindMinutes: num(r && r.maxBehindMinutes, ETA_FALLBACK.maxBehindMinutes),
    keepMinutes:    num(r && r.keepMinutes, ETA_FALLBACK.keepMinutes)
  };
}

function hasPin(s) {
  return !!(s && typeof s.lat === "number" && typeof s.lng === "number" &&
            isFinite(s.lat) && isFinite(s.lng));
}

/* Straight line, in metres. Equirectangular rather than haversine: over the
   two kilometres these stops span it is accurate to well under a metre, and
   the input is a hand-typed coordinate off a phone, so a more exact formula
   would be false precision on top of a rounded number. */
function metresBetween(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos((a.lat + b.lat) * rad / 2);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * R;
}

/* Minutes of driving, as the crow flies plus a third for the fact that roads
   are not straight. Deliberately crude: it is only ever used as the part of a
   gap that a skip CANNOT save, and being crude in that direction makes the
   saving larger, which is the safe side. */
function driveMinutes(a, b, set) {
  if (!hasPin(a) || !hasPin(b)) return 0;
  const metres = metresBetween(a, b) * 1.33;
  const mps = (set.speedMph * 1609.34) / 3600;
  return metres / mps / 60;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* One comparison for names, everywhere on this server.

   Both ends of every name in this system are typed by hand — the Drivers tab,
   the Rota cell, the name a phone signs in with — so an exact match is not a
   test of whether two people are the same person, it is a test of whether two
   people typed the same spaces. The sweep that wakes a driver already learned
   this the hard way: a handset registered as "bro arthur" was invisible to the
   only query that would ever have woken it.

   The same looseness, and no looser. It does not guess at nicknames. */
const sameName = (a, b) =>
  String(a == null ? "" : a).trim().toLowerCase() ===
  String(b == null ? "" : b).trim().toLowerCase();

/* Minutes on the timetable between two stops. Never negative: a timetable
   typed out of order is a fault on the tab, and reading it as a bus going
   backwards would put the estimate somewhere absurd. */
function gapMinutes(key, from, to) {
  const a = londonMoment(key, from.time), b = londonMoment(key, to.time);
  if (!a || !b) return 0;
  return Math.max(0, (b.getTime() - a.getTime()) / 60000);
}

/* WHAT A WHOLE STRETCH OF SKIPPED STOPS TAKES OFF THE RUN.

   Worked out a SEGMENT at a time — from the last stop the bus is calling at,
   over however many it is passing, to the next one it calls at — and never
   one stop at a time.

   That is not tidiness. Two stops skipped in a row share a gap: the gap out
   of the first IS the gap into the second. Adding up per-stop savings counts
   that gap twice and hands back a number larger than the whole stretch, which
   on the North route means an estimate that precedes the bus leaving the
   previous kerb. Asked as one question from P to Q, it cannot happen.

       with pins     saving = gap(P..Q) - drive(P->Q)
       without       saving = sum over skipped of (dwell, or a fraction of
                              its own gap, whichever is larger)

   The first of those is the honest one, and it is why the coordinates are
   worth typing in: it takes off the dwell AND the padding the timetable put
   there for a stop the bus is not making, and keeps only the driving. An
   earlier draft charged only dwell plus detour, which on this timetable made
   the estimate LATER once the pins were filled in — adding data made the
   answer worse, in the one direction that leaves somebody at a kerb.

   Both are floored at one dwell per stop skipped, because a stop the bus does
   not pull into is always worth at least the standing time, coordinates or
   not. Both are capped by maxSkipMinutes per stop AND by the whole gap from P
   to Q, so nothing here can ever put the bus somewhere it has not been. */
function segmentSaving(key, ordered, pIdx, qIdx, set) {
  const P = ordered[pIdx], Q = ordered[qIdx];
  if (!P || !Q || qIdx <= pIdx + 1) return 0;

  const skipped = ordered.slice(pIdx + 1, qIdx);
  const whole = gapMinutes(key, P, Q);
  const dwell = set.dwellSeconds / 60;
  const floor = Math.min(dwell * skipped.length, whole);
  const ceiling = Math.min(set.maxSkipMinutes * skipped.length, whole);

  const pinned = hasPin(P) && hasPin(Q) && skipped.every(hasPin);
  if (pinned) return clamp(whole - driveMinutes(P, Q, set), floor, ceiling);

  let sum = 0;
  for (let i = pIdx + 1; i < qIdx; i++) {
    sum += Math.max(dwell, set.skipSaves * gapMinutes(key, ordered[i - 1], ordered[i]));
  }
  return clamp(sum, floor, ceiling);
}

/* THE ESTIMATE ITSELF.

   Walk from the last stop the driver marked to the passenger's own, taking
   the timetable as given and removing what each unbooked stop in between
   would have cost. Returns minutes to subtract from the timetabled arrival;
   the caller adds the run's offset as before.

   `booked` is a set of stop ids with somebody on them. A stop the passenger
   himself booked is in it by definition, so his own stop is never skipped. */
function etaSavedMinutes(key, ordered, lastStopId, myStopId, booked, set) {
  if (!ordered || !ordered.length) return 0;
  const idx = (id) => ordered.findIndex((s) => String(s.id) === String(id));
  const mine = idx(myStopId);
  if (mine < 0) return 0;

  /* Nothing marked yet means the bus has only just left, so everything ahead
     of it is in play. The departure row is index 0 on a properly filled tab. */
  let from = lastStopId ? idx(lastStopId) : 0;
  if (from < 0) from = 0;
  if (mine <= from) return 0;

  let saved = 0;
  /* Walk forward, collecting runs of stops the bus is passing, and close each
     run against the next stop it actually calls at. His own stop closes the
     last one, and is never itself skipped. */
  let lastCalled = from;
  for (let i = from + 1; i <= mine; i++) {
    const stop = ordered[i];
    const passing = i < mine &&
                    String(stop.kind || "pickup") === "pickup" &&
                    !booked.has(String(stop.id));
    if (passing) continue;
    saved += segmentSaving(key, ordered, lastCalled, i, set);
    lastCalled = i;
  }
  return saved;
}

/* Which stops on a route have somebody on them today. */
async function bookedStopIds(env, key, route) {
  const rows = await liveBookings(env, key);
  const out = new Set();
  for (const b of rows) {
    if (Number(b.seats) > 0) out.add(String(b.stopId));
  }
  return out;
}

/* ==========================================================================
   SMALL HELPERS
   ========================================================================== */

/* Eleven digits, starting with a zero, and nothing else accepted. Forgiving
   about how it is typed and strict about what it becomes. Identical rules to
   normalisePhone in Code.gs — they must agree or a number saved on one side
   is not found by the other. */
function normalisePhone(raw) {
  let d = String(raw == null ? "" : raw).replace(/[^0-9+]/g, "");
  if (d.indexOf("+44") === 0) d = "0" + d.substring(3);
  else if (d.indexOf("0044") === 0) d = "0" + d.substring(4);
  else if (d.indexOf("44") === 0 && d.length === 12) d = "0" + d.substring(2);
  d = d.replace(/[^0-9]/g, "");
  if (d.length !== 11) return "";
  if (d.charAt(0) !== "0") return "";
  return d;
}

/* SHA-256 of salt:number, first 24 hex characters. Identical to passengerId
   in Code.gs, which is what lets a booking made before the move still be
   found by the phone that made it. */
async function passengerId(env, phone) {
  if (!phone) return "";
  const bytes = new TextEncoder().encode(saltOf(env) + ":" + phone);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0")).join("").substring(0, 24);
}

/* The row this person owns. Number first, old browser handle second — a
   booking made before numbers existed has no fingerprint, so it is still
   found by the handle. A row that already has an owner is never handed over
   on a handle match, whoever is asking. */
function bookingFor(rows, pid, ref) {
  let mine = null;
  if (pid) for (const b of rows) if (b.pid && b.pid === pid) mine = b;
  if (!mine && ref) for (const b of rows) if (!b.pid && b.device === ref) mine = b;
  return mine;
}

function json(obj, status) {
  if (obj && typeof obj === "object" && obj.script === undefined) {
    /* script is what the pages read before the three numbers were split
       apart. Kept so a page that has not been redeployed yet still sees
       something, and so nothing else that reads it has to change. */
    obj.script = SCRIPT_VERSION;
    obj.server = SCRIPT_VERSION;
    if (sheetVersion) obj.sheet = sheetVersion;
  }
  /* Over the top of anything already there, including a copy on the shelved
     rota: that was built up to an hour ago, and this was told on the last
     sync, which a Drivers tab edit sends within seconds. */
  if (coordinator && obj && typeof obj === "object" && !Array.isArray(obj)) {
    obj.coordinator = coordinator;
  }
  if (leadRoles && obj && typeof obj === "object" && !Array.isArray(obj)) {
    obj.leadRoles = leadRoles;
  }
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      "content-type": "application/json;charset=UTF-8",
      /* The pages are on GitHub Pages and this is another origin. Apps Script
         answered any origin and nothing here is more private than it was:
         a booking row names nobody. */
      "access-control-allow-origin": "*",
      "cache-control": "no-store"
    }
  });
}

/* ==========================================================================
   READING WHAT THE SHEET OWNS
   ========================================================================== */

async function getStops(env) {
  /* SELECT * rather than naming lat and lng: a database this Worker has not
     yet added those columns to must still answer the board, and a stop with
     no pin is the ordinary case until the six coordinates are typed in. */
  let results = [];
  try {
    ({ results } = await env.DB.prepare("SELECT * FROM stops ORDER BY route, seq").all());
  } catch (e) { results = []; }
  return (results || []).map((r) => ({
    id: r.stop_id, route: r.route, time: r.time, stop: r.stop,
    postcode: r.postcode || "", where: r.place || "",
    kind: r.kind || "pickup",
    arrival: r.kind === "arrival", depart: r.kind === "depart",
    /* A blank cell is no pin, not a pin at the equator. Zero is a real
       coordinate in the Gulf of Guinea and half a world from Liverpool, so it
       has to be told apart from empty or the geometry silently reads every
       unfilled stop as the same place. */
    lat: numOrNull(r.lat), lng: numOrNull(r.lng)
  }));
}

function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

/* WHAT A STOP TAP IS CALLED, AND THERE ARE TWO NAMES FOR EACH.

   The driver app has always sent "pickup" for Picked up and "empty" for
   Nobody there (its buttons' data-tripkind). The tap alerts, the Run record
   and the coordinator's Add were written against "picked" and "none", the
   words the tests used, so up to w2.30.0 not one real tap woke the next
   stop's passengers or showed on the Run record, and Add could put a second
   time beside a driver's real one. The sheet always read all four.

   One list, read everywhere a tap is asked about. The older words stay in
   it, because rows the coordinator's Add wrote before w2.30.1 say "picked".
   Anything written from now says what the driver app says. */
const TAP_PICKED = ["pickup", "picked"];
const TAP_EMPTY = ["empty", "none"];
const TAP_KINDS = TAP_PICKED.concat(TAP_EMPTY);
const isStopTap = (kind) => TAP_KINDS.indexOf(String(kind || "").trim().toLowerCase()) !== -1;
const TAP_SQL = "('" + TAP_KINDS.join("','") + "')";

/* A STOP IS ITS NUMBER. The coordinator keeps a fixed range of numbers and
   edits the place behind one when the passengers change, so N05 can be one
   road this month and another the next. Everything is matched by number.

   The name is only ever COMPARED, never matched on: a booking or a tap keeps
   the name its number had at the time, and when that differs from the
   timetable's name for the same number today, the place has changed since.
   That is how the guards below notice a seat booked at the old place, and how
   a past Sunday's record can say what its stop was then. Spacing and capitals
   are not a change. */
const stopWords = (x) => String(x || "").trim().toLowerCase().replace(/\s+/g, " ");
const sameStopName = (a, b) => stopWords(a) === stopWords(b);

/* Every stop on one route, in the order a driver taps them, departure row
   first. getStops already orders by route then seq, so filtering keeps it. */
const stopsOnRoute = (all, route) =>
  all.filter((s) => String(s.route || "") === String(route || ""));

/* A Depart row is a timing point, not a place anybody waits. Filtered out
   here rather than at each call site so it cannot leak into a booking list,
   a seat count or a driver's tap list by somebody forgetting one. */
const pickupsAndArrivals = (all) => all.filter((s) => !s.depart);

/* The same stops with the doorstep address removed, for the page anybody can
   open. Fields are listed rather than deleted, so a field added later has to
   be let out deliberately instead of leaking the day it is written. */
const publicStops = (list) => list.map((s) => ({
  route: s.route, id: s.id, time: s.time, stop: s.stop,
  postcode: s.postcode, arrival: s.arrival, depart: s.depart
}));

function routeNames(stops) {
  const seen = {}, out = [];
  for (const s of stops) if (s.route && !seen[s.route]) { seen[s.route] = 1; out.push(s.route); }
  return out;
}

function departStopFor(all, route) {
  for (const s of all) if (s.depart && s.route === route && s.time) return s;
  return null;
}

/* From w2.24.0 each bus also carries its renewal dates and the route it takes
   in odd months, from the Buses tab. Kept beside the table in settings
   (bus_extra, by registration) rather than as new columns, so an older
   database answers exactly as before and a sync from an older sheet, which
   sends neither, leaves the last ones alone. */
async function getBuses(env) {
  const { results } = await env.DB.prepare(
    "SELECT reg, seats, active FROM buses").all();
  let extra = {};
  try { extra = (await cacheGet(env, "bus_extra")) || {}; } catch (e) {}
  /* From w2.30.0 a renewal recorded in the coordinator's app shows here at
     once, before the sheet has written it on the Buses tab. The sync that
     names it as applied brings the tab's own date, and it stops being laid
     over then. */
  const over = {};
  /* From w2.35.0 a bus changed or added in the coordinator's app, the same
     way: laid over the table until the sheet has filed it, so the seat
     counts and the rotation have it at once. */
  const edits = [];
  try {
    for (const a of await coordPending(env, ["vlog", "vfix", "bus"])) {
      if (a.kind === "bus") { edits.push(a.body || {}); continue; }
      const b = a.body || {};
      const set = (reg, item, next) => {
        if (!reg || !item || !rnParts(next)) return;
        (over[String(reg).toUpperCase()] = over[String(reg).toUpperCase()] || {})[item] = next;
      };
      if (a.kind === "vlog" && b.status === "Done") set(b.reg, VLOG_ITEM[b.what], b.next);
      if (a.kind === "vfix") for (const t of b.targets || []) set(t.reg, t.item, t.next);
    }
  } catch (e) {}
  const list = (results || []).map((b) => {
    const reg = String(b.reg || "").toUpperCase();
    const x = extra[reg] || {};
    /* Notes from v1.98.0 of the sheet. noNotes: an older sheet, which sends
       none, so the Buses screen does not offer to change them. */
    return { reg: b.reg, seats: Number(b.seats) || 0, active: !!b.active,
             dates: Object.assign({}, x.dates || {}), oddRoute: x.oddRoute || "",
             notes: typeof x.notes === "string" ? x.notes : "", noNotes: typeof x.notes !== "string" || !!x.notesCut };
  });
  for (const e of edits) busEditApply(list, e);
  /* After the edits, so a bus added in the app has a renewal recorded on it
     too. */
  for (const b of list) {
    const o = over[String(b.reg || "").toUpperCase()];
    if (o) b.dates = Object.assign({}, b.dates || {}, o);
  }
  return list;
}

async function getRotaRow(env, key) {
  return await env.DB.prepare(
    "SELECT * FROM rota WHERE sunday = ?").bind(key).first();
}

/* ---- which bus is on which route --------------------------------------
   Odd calendar months follow the configured pairing, even months are the
   reverse. A month is four or five Sundays, so the swap never falls into
   step with a three or four driver rota and nobody stays in one bus.
   An entry in the rota's own bus column beats all of it, for that Sunday. */
/* Blank from w2.25.0: the pairing is the Buses tab's, and a Sunday with no
   pairing there gets no bus rather than another church's registration. */
const BUS_ROTATION_ODD = { north: "", south: "" };

/* The pairing is the Buses tab's from w2.24.0: the active bus marked North in
   its "Route in odd months" column and the one marked South. Either missing,
   or no buses given, the constant above, as before. */
function busPairing(buses) {
  let north = "", south = "";
  for (const b of buses || []) {
    if (!b || !b.active) continue;
    if (b.oddRoute === "North" && !north) north = b.reg;
    if (b.oddRoute === "South" && !south) south = b.reg;
  }
  return (north && south) ? { north, south } : BUS_ROTATION_ODD;
}

function busRule(key, buses) {
  const m = Number(String(key).split("-")[1]);
  if (!m) return null;
  const odd = m % 2 === 1;
  const p = busPairing(buses);
  return odd ? { North: p.north, South: p.south } : { North: p.south, South: p.north };
}

async function busFor(env, key, route, buses, rotaRow) {
  const want = String(route || "").toUpperCase().charAt(0) === "S" ? "South" : "North";
  const known = {};
  for (const b of buses) known[b.reg.toUpperCase()] = b;

  const over = String((rotaRow && (want === "South" ? rotaRow.south_bus : rotaRow.north_bus)) || "").trim();
  if (over) {
    const hit = known[over.toUpperCase()];
    /* A registration nobody recognises is not an answer. Better to fall back
       to the rotation than to price a bus that does not exist. */
    if (hit) return { reg: hit.reg, from: "rota", seats: hit.seats };
  }
  const pair = busRule(key, buses);
  if (!pair) return { reg: "", from: "", seats: 0 };
  const hit = known[String(pair[want] || "").toUpperCase()];
  return hit ? { reg: hit.reg, from: "rotation", seats: hit.seats }
             : { reg: "", from: "", seats: 0 };
}

/* ==========================================================================
   BOOKINGS
   ========================================================================== */

async function rehearsalOn(env) {
  const row = await env.DB.prepare("SELECT v FROM settings WHERE k='rehearsal'").first();
  if (!row) return null;
  let st; try { st = JSON.parse(row.v); } catch { return null; }
  if (!st || !st.at) return null;

  const ends = rehearsalEnds(st.at);
  if (Date.now() >= ends) {
    /* Run out. Cleared the same way as one ended by hand, test seats and
       taps and all, and the sheet told to clear its tabs. rehearsalClear
       claims the row first, so of two requests that notice together only
       one does the clearing. */
    try { await rehearsalClear(env, row.v, "the clock", true); } catch (e) {}
    return null;
  }
  st.ends = ends;
  return st;
}

/* Two hours from the start, or the first booking cutoff or the first
   Sunday midnight after it, whichever comes first, so a rehearsal can never
   run into a Sunday.

   Both are reckoned from when it STARTED. Until w2.20.1 the cutoff was
   reckoned from "now", and once the cutoff had passed there was no next one
   that week, so a rehearsal started at half past eight on a Sunday ran on
   through the real morning until half past ten, silencing the passengers'
   alerts and tagging the real taps as a test. */
function rehearsalEnds(at) {
  const t = Number(at) || 0;
  let ends = t + REHEARSAL_HOURS * 3600000;
  const cut = firstAfter(t, (key) => cutoffOf(key));
  const midnight = firstAfter(t, (key) => londonMoment(key, "00:00"));
  if (cut && cut < ends) ends = cut;
  if (midnight && midnight < ends) ends = midnight;
  return ends;
}

/* The booking cutoff for a Sunday, as a moment. */
function cutoffOf(key) {
  let cutKey = key;
  if (BOOKING_CUTOFF_DAY !== 0) cutKey = shiftDays(key, -(7 - BOOKING_CUTOFF_DAY));
  return londonMoment(cutKey, p2(BOOKING_CUTOFF_HOUR) + ":" + p2(BOOKING_CUTOFF_MIN));
}

/* The first moment after `t` that a rule gives for a Sunday: the Sunday of
   `t` first, then the one after. 0 if neither gives one. */
function firstAfter(t, rule) {
  let key = sundayKeyOf(new Date(t));
  for (let i = 0; i < 2; i++) {
    const m = rule(key);
    if (m && m.getTime() > t) return m.getTime();
    key = keyAddWeeks(key, 1);
  }
  return 0;
}

/* What a page is told about it. The round is the moment it started: a
   phone that made a run in one round drops it once the round is over. */
function rehearsalInfo(reh) {
  return reh ? { round: Number(reh.at) || 0, ends: Number(reh.ends) || rehearsalEnds(reh.at),
                 shape: String(reh.shape || "") } : false;
}

/* ==========================================================================
   A REHEARSAL, OWNED HERE FROM w2.20.0

   It used to belong to the spreadsheet: a menu item that only a computer can
   reach, a flag in Script Properties pushed over on the next sync, and test
   seats drawn onto the Bus Bookings tab. Three things went wrong with that,
   every time.

   A phone that had made a run in a rehearsal kept it. The run was saved on
   the phone for the day, the live server stopped mentioning it the moment
   the rehearsal ended, and silence reads to the phone as "nothing new", so
   the screen went on showing a finished run and would not offer Start trip
   again. One rehearsal a day per phone was the real limit.

   The record kept it too. Its taps stayed on the Trip Events tab, tagged,
   "so you can see it happened", and there was no way to take them off short
   of a separate menu item that clears the whole Sunday.

   And a tap that reached this server after the rehearsal ended was taken as
   a real one, because what a tap was used to be decided by whether a
   rehearsal happened to be on when it arrived.

   So: the flag, the test seats and the clearing-up all live here. The
   coordinator's app starts one, starts it over and ends it, under his PIN;
   the spreadsheet's menu items ask this server to do the same. Each start is
   a new ROUND, and a phone drops any run it made in a round that is over,
   taps still waiting included. Ending one, by hand or by the clock, deletes
   its seats and its taps here, and the sheet is told to delete its own
   Rehearsal rows. A tap says which round it was made in, and a tap from a
   round that is over is not recorded at all.
   ========================================================================== */

/* How busy the test morning is: a share of the seats on that route's bus
   that Sunday, so "full" means full on whichever bus the rota gave it. */
const REHEARSAL_SHAPES = {
  quiet:  { words: "a quiet morning",        lo: 0.20, hi: 0.40 },
  normal: { words: "an ordinary morning",    lo: 0.50, hi: 0.80 },
  full:   { words: "a nearly full bus",      lo: 0.93, hi: 1.00 },
  over:   { words: "more booked than seats", lo: 1.10, hi: 1.35 }
};

/* A number of seats across a number of stops, at least one each, the rest
   dropped a seat at a time onto random stops, capped at four unless the
   total will not otherwise fit. A morning where every stop has exactly two
   is not a morning anybody has driven. */
function rehearsalSplit(total, buckets, rnd) {
  rnd = rnd || Math.random;
  const out = [];
  if (buckets < 1) return out;
  for (let i = 0; i < buckets; i++) out.push(1);
  let left = total - buckets;
  let cap = 4;
  while (cap * buckets < total) cap++;
  let guard = 0;
  while (left > 0 && guard++ < 10000) {
    const i = Math.floor(rnd() * buckets);
    if (out[i] < cap) { out[i]++; left--; }
  }
  return out;
}

/* The test seats for one Sunday: statements to insert them, and the words
   for what was drawn. Two routes, each spread over some of its stops and
   never all of them where there is a choice, because an untouched stop is
   what lets "Nobody there" be rehearsed at all.

   They go to the sheet on the drain like any booking, so the Bus Bookings
   tab and the sheet's own seat counts show the test morning while it runs,
   and the sheet takes them off again when it is told the round is over. */
async function rehearsalSeeds(env, key, shape, round, rnd) {
  rnd = rnd || Math.random;
  const band = REHEARSAL_SHAPES[shape] || REHEARSAL_SHAPES.normal;
  const stops = pickupsAndArrivals(await getStops(env)).filter((x) => !x.arrival);
  const buses = await getBuses(env);
  const rotaRow = await getRotaRow(env, key);
  const stmts = [], summary = [], routes = [];
  for (const route of routeNames(stops)) {
    const list = stops.filter((x) => x.route === route);
    if (!list.length) continue;
    let seats = 14;
    try { seats = (await busFor(env, key, route, buses, rotaRow)).seats || 14; } catch (e) {}
    let target = Math.round(seats * (band.lo + rnd() * (band.hi - band.lo)));
    if (target < 1) target = 1;
    const least = Math.ceil(target / 4);
    let most = list.length > 2 ? list.length - 1 : list.length;
    if (most < least) most = Math.min(least, list.length);
    let use = least + Math.floor(rnd() * (most - least + 1));
    if (use > list.length) use = list.length;
    if (use > target) use = target;
    if (use < 1) use = 1;
    const idx = list.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }
    const at = idx.slice(0, use).sort((a, b) => a - b);
    const split = rehearsalSplit(target, use, rnd);
    let placed = 0;
    at.forEach((k, n) => {
      const st = list[k];
      placed += split[n];
      stmts.push(env.DB.prepare(
        "INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received, synced) " +
        "VALUES (?,?,?,?,?,?,'','','Rehearsal',?,0)")
        .bind(key, route, st.id, st.stop, split[n],
              "rehearsal-" + route.toLowerCase() + "-" + n + "-" + Number(round).toString(36), Date.now()));
    });
    routes.push({ route: route, booked: placed, stops: use, of: list.length, seats: seats });
    summary.push(route + ": " + placed + " booked at " + use + " of " + list.length +
                 " stops, on a " + seats + "-seat bus" + (placed > seats ? ", over by " + (placed - seats) : "") + ".");
  }
  return { stmts, summary, routes, words: band.words };
}

/* A real morning in progress: a real run out on either route, or a Sunday
   between the booking cutoff and the run backstop. A rehearsal started then
   would turn every phone's screen over to the test, the passenger page
   included, while a real bus was on the road. */
async function liveMorning(env) {
  const key = runSunday();
  const stops = pickupsAndArrivals(await getStops(env));
  for (const rt of routeNames(stops)) {
    let t = null, over = false;
    try { t = await tripState(env, key, rt, "real"); } catch (e) {}
    /* A run nobody ended is over once its last stop is well past and it has
       gone quiet, by the same rule that rolls the passenger page. */
    try { over = await routeOver(env, key, rt, stops, "real"); } catch (e) {}
    if (t && t.started && !t.ended && !over) return "The " + rt + " bus is out. A rehearsal waits until the real run has ended.";
  }
  /* The whole of Sunday up to the backstop, and from the cutoff if that
     comes earlier. Before the cutoff on a Sunday morning is not safe
     either: the morning message goes out then, and a rehearsal holds every
     passenger alert back. */
  const now = Date.now();
  const cut = cutoffOf(key), dayStart = londonMoment(key, "00:00");
  const back = londonMoment(key, p2(RUN_BACKSTOP_HOUR) + ":" + p2(RUN_BACKSTOP_MIN));
  let from = dayStart ? dayStart.getTime() : 0;
  if (cut && cut.getTime() < from) from = cut.getTime();
  if (from && back && now >= from && now < back.getTime()) {
    const at = p2(RUN_BACKSTOP_HOUR) + ":" + p2(RUN_BACKSTOP_MIN);
    return londonParts(new Date()).dow === 0
      ? "It is Sunday morning. A rehearsal can start from " + at + "."
      : "Bookings for Sunday have closed. A rehearsal can start from " + at + " on Sunday.";
  }
  return "";
}

/* A test tap made on its own Sunday between the cutoff and the backstop.
   None can be made there from w2.20.1. One from before may be a REAL run:
   an older version let a rehearsal started on a Sunday morning run on into
   the real one, and tagged the real taps as a test. So such a run is never
   cleared away, here or on the sheet, and is left for a person to judge. */
function inLiveMorning(sunday, at) {
  const a = cutoffOf(String(sunday || ""));
  const b = londonMoment(String(sunday || ""), p2(RUN_BACKSTOP_HOUR) + ":" + p2(RUN_BACKSTOP_MIN));
  const t = Number(at) || 0;
  return !!(a && b && t >= a.getTime() && t < b.getTime());
}

/* What a clear-up may take.

   A TEST RUN IS ONE WHOSE START WAS A TEST. All of its rows go, a taken-back
   tap included (Undone loses the word Rehearsal on the way), and the sheet is
   told the run's trip so it can do the same.

   A REAL RUN IS NEVER TAKEN, even when one of its taps was stored as a test.
   A page from before v1.79.0 names no round, so its taps are judged by
   whether a rehearsal is on as they arrive, and the End of a real run nobody
   closed, tapped during an afternoon rehearsal, is stored as one. Such a row
   is left where it is, for a person.

   A test row that belongs to no run, or to a run whose start is not here,
   goes on its own. And see inLiveMorning for what is kept whatever it is. */
async function rehearsalFind(env) {
  const out = { trips: [], keepTrips: [], keepIds: [] };
  try {
    const r = await env.DB.prepare(
      "SELECT id, trip, sunday, happened, event, status FROM trip_events WHERE lower(status)='rehearsal' " +
      "OR trip IN (SELECT trip FROM trip_events WHERE lower(status)='rehearsal' AND trip<>'')").all();
    const rows = r.results || [];
    const startOf = {};
    for (const x of rows) {
      if (x.trip && String(x.event || "").toLowerCase() === "start") startOf[x.trip] = String(x.status || "").toLowerCase();
    }
    const keep = new Set(), test = new Set();
    for (const x of rows) {
      const trip = String(x.trip || "");
      if (String(x.status || "").toLowerCase() === "rehearsal" && inLiveMorning(x.sunday, x.happened)) {
        if (trip) keep.add(trip); else out.keepIds.push(Number(x.id));
      }
      if (trip && startOf[trip] === "rehearsal") test.add(trip);
    }
    out.keepTrips = [...keep];
    out.trips = [...test].filter((t) => !keep.has(t));
  } catch (e) {}
  return out;
}

/* The test runs swept away, by trip, for a fortnight. A tap of one that
   arrives afterwards, from a phone that was out of signal, is thrown away
   rather than taken as the start of a real run on the coming Sunday: a page
   from before v1.79.0 names no round, and nothing else would tell. */
const GONE_DAYS = 14;
async function rehearsalGoneMap(env) {
  let m = {};
  try { m = (await cacheGet(env, "rehearsal_gone")) || {}; } catch (e) { m = {}; }
  const cut = Date.now() - GONE_DAYS * 86400000;
  for (const k of Object.keys(m)) if (!(Number(m[k]) > cut)) delete m[k];
  return m;
}
async function rehearsalGone(env, trip) {
  if (!trip) return false;
  return !!(await rehearsalGoneMap(env))[trip];
}

/* The rounds that have ended, for a fortnight: when each began and when it
   ended. A run that reaches this server only after its round is over, from a
   page that says nothing or from a phone that had not heard of the round
   yet, never swept because none of it was here, is judged by when it
   STARTED: inside a finished round, it was a test. No real run starts inside
   one: none can start on a Sunday morning, and one reaching Sunday ends at
   midnight. */
async function rehearsalRoundsDone(env) {
  let list = [];
  try { list = (await cacheGet(env, "rehearsal_rounds")) || []; } catch (e) { list = []; }
  const cut = Date.now() - GONE_DAYS * 86400000;
  return (Array.isArray(list) ? list : []).filter((r) => r && Number(r.end) > cut).slice(-50);
}

/* A round that has just ended, onto that list. `guard` as for the sweep. */
async function rehearsalRoundEnded(env, round, end, guard) {
  const list = await rehearsalRoundsDone(env);
  list.push({ at: Number(round) || 0, end: Number(end) || Date.now() });
  return env.DB.prepare("INSERT INTO settings (k,v) SELECT 'rehearsal_rounds', ? WHERE 1=1" + (guard || "") +
    " ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(JSON.stringify(list));
}

/* Its seats and its taps, here. Every Sunday's, not only the one it was
   for: a rehearsal that ran before this version left its rows behind, and
   there is no reason to keep them. Written as tests on the rows rather than
   a list of ids, so a tap that lands between the look and the delete goes
   too. `onlyIfEnded` makes every statement wait on the flag being gone, for
   the clock's clear, which claims the flag in the same batch. */
async function rehearsalSweep(env, onlyIfEnded) {
  const f = await rehearsalFind(env);
  const g = onlyIfEnded ? " AND NOT EXISTS (SELECT 1 FROM settings WHERE k='rehearsal')" : "";
  const stmts = [env.DB.prepare("DELETE FROM bookings WHERE lower(status)='rehearsal'" + g)];
  const kept = f.keepTrips.length + f.keepIds.length;
  /* More than a D1 statement can name is not a thing that happens. If it
     ever did, leaving the taps is the safe way to be wrong. */
  if (kept > 80) return { stmts: stmts, trips: [] };
  const notTrips = f.keepTrips.length ? " AND trip NOT IN (" + f.keepTrips.map(() => "?").join(",") + ")" : "";
  const notIds = f.keepIds.length ? " AND id NOT IN (" + f.keepIds.map(() => "?").join(",") + ")" : "";
  stmts.push(env.DB.prepare("DELETE FROM trip_events WHERE trip IN " +
    "(SELECT trip FROM trip_events WHERE event='start' AND lower(status)='rehearsal' AND trip<>'')" + notTrips + g)
    .bind(...f.keepTrips));
  stmts.push(env.DB.prepare("DELETE FROM trip_events WHERE lower(status)='rehearsal' AND trip NOT IN " +
    "(SELECT trip FROM trip_events WHERE event='start' AND lower(status)<>'rehearsal' AND trip<>'')" + notTrips + notIds + g)
    .bind(...f.keepTrips, ...f.keepIds));
  if (f.trips.length) {
    const gone = await rehearsalGoneMap(env);
    for (const t of f.trips) gone[t] = Date.now();
    stmts.push(env.DB.prepare("INSERT INTO settings (k,v) SELECT 'rehearsal_gone', ? WHERE 1=1" + g +
      " ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(JSON.stringify(gone)));
  }
  return { stmts: stmts, trips: f.trips };
}

/* An action on the list the sheet drains, so it clears its own tabs, keeps
   its copy of the flag, and it shows in What I have done. */
function rehearsalNote(env, id, body, by, words, onlyIfEnded) {
  return env.DB.prepare(
    "INSERT OR IGNORE INTO coord_actions (id, kind, sunday, body, by_name, made, words) " +
    "SELECT ?,?,?,?,?,?,? WHERE 1=1" + (onlyIfEnded ? " AND NOT EXISTS (SELECT 1 FROM settings WHERE k='rehearsal')" : ""))
    .bind(id, "rehearsal", String(body.sunday || ""), JSON.stringify(body), by, Date.now(), words);
}

/* Ended by the clock, or found run out on a read. `v` is the row as read, so
   the claim is on that exact rehearsal: one that has just been started over
   is not cleared by a request still holding the old one. */
async function rehearsalClear(env, v, by, expired) {
  /* ONE BATCH, AND EVERY PART OF IT WAITS ON THE CLAIM. As separate steps, a
     round started between the claim and the sweep lost its test seats, and
     the sheet was told "ended" after it had been told "started". Within one
     transaction, a flag that is still there (the claim found a newer round)
     stops the sweep and the note. The note's id is the round's, so two
     requests clearing the same one leave one note. */
  await ensureCoord(env);
  let st = null; try { st = JSON.parse(v); } catch (e) {}
  const round = Number(st && st.at) || 0;
  const sw = await rehearsalSweep(env, true);
  const body = { op: "end", sunday: (st && st.key) || "", round: round, trips: sw.trips };
  const guard = " AND NOT EXISTS (SELECT 1 FROM settings WHERE k='rehearsal')";
  const done = await rehearsalRoundEnded(env, round, Math.min(Date.now(), rehearsalEnds(round)), guard);
  const res = await env.DB.batch([env.DB.prepare("DELETE FROM settings WHERE k='rehearsal' AND v=?").bind(v)]
    .concat(sw.stmts, [done, rehearsalNote(env, "reh-end-" + round.toString(36), body, by,
                                           expired ? "The rehearsal ran out and was cleared." : "Rehearsal ended.", true)]));
  return !!(res && res[0] && res[0].meta && res[0].meta.changes);
}

/* Start, start over or end. Returns what to write, so the coordinator's app
   can write it in the same batch as its own record of the change, and the
   words for the answer. Nothing is written here. */
async function rehearsalPlan(env, op, shape, rnd) {
  const cur = await rehearsalOn(env);
  if (op === "end") {
    const sw = await rehearsalSweep(env);
    const done = cur ? [await rehearsalRoundEnded(env, cur.at, Date.now())] : [];
    return { ok: true, sunday: (cur && cur.key) || runSunday(),
             stmts: sw.stmts.concat(done, [env.DB.prepare("DELETE FROM settings WHERE k='rehearsal'")]),
             body: { op: "end", sunday: (cur && cur.key) || "", round: Number(cur && cur.at) || 0, trips: sw.trips },
             words: cur ? "Rehearsal ended." : "No rehearsal was running. Anything left from one was cleared.",
             reply: { rehearsal: false } };
  }
  if (op !== "start" && op !== "over") return { ok: false, error: "Start, start over or end." };
  const busy = await liveMorning(env);
  if (busy) return { ok: false, error: busy };
  const key = runSunday();
  const at = Date.now();
  const kind = REHEARSAL_SHAPES[shape] ? shape : "normal";
  const seeds = await rehearsalSeeds(env, key, kind, at, rnd);
  const sw = await rehearsalSweep(env);
  const trips = sw.trips;
  const flag = JSON.stringify({ at: at, key: key, shape: kind });
  const ends = rehearsalEnds(at);
  const again = !!cur;
  const done = cur ? [await rehearsalRoundEnded(env, cur.at, at)] : [];
  return { ok: true, sunday: key,
           stmts: sw.stmts.concat(done, seeds.stmts, [env.DB.prepare(
             "INSERT INTO settings (k,v) VALUES ('rehearsal',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(flag)]),
           body: { op: again ? "over" : "start", sunday: key, round: at, ends: ends, shape: kind,
                   trips: trips, routes: seeds.routes },
           words: (again ? "Rehearsal started over: " : "Rehearsal started: ") + seeds.words +
                  ", until " + londonHHMM(new Date(ends)) + ".",
           reply: { rehearsal: { round: at, ends: ends, shape: kind }, summary: seeds.summary } };
}

/* From the spreadsheet's menu. Token checked by the router, like the rest of
   what the sheet asks this server to do. */
async function handleRehearsal(env, body) {
  await ensureCoord(env);
  const op = String((body && body.do) || "");
  const plan = await rehearsalPlan(env, op, String((body && body.shape) || ""));
  if (!plan.ok) return { ok: false, error: plan.error };
  const id = "sheet-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);
  await env.DB.batch(plan.stmts.concat([rehearsalNote(env, id, plan.body, "the spreadsheet", plan.words)]));
  /* made is this server's clock, so the sheet can tell an end made here from
     a round started after it, whatever its own clock says. */
  return Object.assign({ ok: true, words: plan.words, id: id, body: plan.body, made: Date.now() }, plan.reply || {});
}

/* What the coordinator's app shows of one while it runs. */
async function rehearsalDetail(env, reh) {
  if (!reh) return null;
  const key = reh.key || runSunday();
  const out = { round: Number(reh.at) || 0, ends: reh.ends, sunday: key,
                words: (REHEARSAL_SHAPES[reh.shape] || REHEARSAL_SHAPES.normal).words, routes: [] };
  const stops = pickupsAndArrivals(await getStops(env));
  let rows = [];
  try {
    const r = await env.DB.prepare(
      "SELECT route, stop_id, seats FROM bookings WHERE sunday=? AND lower(status)='rehearsal'").bind(key).all();
    rows = r.results || [];
  } catch (e) {}
  const buses = await getBuses(env);
  const rotaRow = await getRotaRow(env, key);
  for (const rt of routeNames(stops)) {
    const mine = rows.filter((b) => b.route === rt);
    let seats = 0;
    try { seats = (await busFor(env, key, rt, buses, rotaRow)).seats || 0; } catch (e) {}
    let t = null;
    try { t = await tripState(env, key, rt, "rehearsal"); } catch (e) {}
    out.routes.push({ route: rt, booked: mine.reduce((n, b) => n + (Number(b.seats) || 0), 0),
                      stops: mine.length, seats: seats,
                      started: (t && t.started) || 0, ended: (t && t.ended) || 0,
                      marked: t ? Object.keys(t.served || {}).length : 0, driver: (t && t.driver) || "" });
  }
  return out;
}

function nextCutoffMs() {
  const sunday = sundayKeyOf(new Date());
  let key = sunday;
  if (BOOKING_CUTOFF_DAY !== 0) key = shiftDays(sunday, -(7 - BOOKING_CUTOFF_DAY));
  const c = londonMoment(key, p2(BOOKING_CUTOFF_HOUR) + ":" + p2(BOOKING_CUTOFF_MIN));
  return c && c.getTime() > Date.now() ? c.getTime() : 0;
}

function shiftDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.getUTCFullYear() + "-" + p2(x.getUTCMonth() + 1) + "-" + p2(x.getUTCDate());
}

function bookingsClosed(key) {
  let cutKey = key;
  if (BOOKING_CUTOFF_DAY !== 0) cutKey = shiftDays(key, -(7 - BOOKING_CUTOFF_DAY));
  const cutoff = londonMoment(cutKey, p2(BOOKING_CUTOFF_HOUR) + ":" + p2(BOOKING_CUTOFF_MIN));
  return cutoff ? Date.now() > cutoff.getTime() : false;
}

function cutoffClock() {
  return p2(BOOKING_CUTOFF_HOUR) + ":" + p2(BOOKING_CUTOFF_MIN);
}

function cutoffWords() {
  const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][BOOKING_CUTOFF_DAY];
  return day + " " + cutoffClock();
}

/* The Sunday being DRIVEN. Today if today is Sunday, otherwise the next one.
   Not the same as the one the booking page is offering — see busCurrentSunday. */
const runSunday = () => sundayKeyOf(new Date());

async function liveBookings(env, key) {
  const rehearsing = !!(await rehearsalOn(env));
  const { results } = await env.DB.prepare(
    "SELECT id, sunday, route, stop_id, stop, seats, device, pid, phone, status " +
    "FROM bookings WHERE sunday = ?").bind(key).all();
  return (results || []).filter((b) => {
    const st = String(b.status || "").toLowerCase();
    if (st === "cancelled") return false;
    /* Seeded test bookings are inert unless a rehearsal is actually running,
       so a row left behind by a crash cannot inflate a real Sunday. */
    if (st === "rehearsal" && !rehearsing) return false;
    return true;
  }).map((b) => ({
    row: b.id, sunday: b.sunday, stopId: b.stop_id, seats: Number(b.seats) || 0,
    device: b.device || "", pid: b.pid || "", phone: b.phone || "", status: b.status,
    /* What the stop was called when this seat was taken. The number is the
       booking; this is only ever compared, to notice the place behind a
       number changing after somebody booked it (sameStopName). */
    stop: b.stop || "", route: b.route || ""
  }));
}

/* THE TIME THE PASSENGER WAS GIVEN, from w2.32.0.

   A booking keeps its stop's timetable time as it stood when the seat was
   taken, in sched. Early or late at a booked stop is measured from that, not
   from whatever the Bus Stops tab says by the time the bus gets there. Added
   to a live database on first use, like every column since v1.70.0. */
let bookSchedReady = false;
async function ensureBookSched(env) {
  if (bookSchedReady) return true;
  try {
    await env.DB.prepare("ALTER TABLE bookings ADD COLUMN sched TEXT NOT NULL DEFAULT ''").run();
  } catch (e) { /* already there */ }
  try {
    await env.DB.prepare("SELECT sched FROM bookings LIMIT 1").all();
    bookSchedReady = true;
  } catch (e) { bookSchedReady = false; }
  return bookSchedReady;
}

/* Stamps a booking with its stop's time. force for a new seat or a change of
   stop; otherwise only a row that has none yet, so changing the number of
   seats keeps the time first given. synced=0 so the sheet gets it even when a
   drain took the row between the write and this. */
async function stampBooked(env, id, hhmm, force) {
  if (!id || !hhmm) return;
  try {
    if (!(await ensureBookSched(env))) return;
    await env.DB.prepare("UPDATE bookings SET sched=?, synced=0 WHERE id=?" +
      (force ? "" : " AND sched=''")).bind(hhmm, Number(id)).run();
  } catch (e) { /* the timetable time still applies */ }
}

/* stopId to the booked time for one Sunday and route, from the first live
   booking there that has one. Empty when nothing is booked or the column is
   not there yet, and the timetable applies. */
async function bookedTimes(env, key, route) {
  const out = {};
  try {
    if (!(await ensureBookSched(env))) return out;
    const q = await env.DB.prepare(
      "SELECT stop_id, sched, status FROM bookings WHERE sunday=? AND route=? AND sched<>'' ORDER BY id")
      .bind(key, route).all();
    for (const b of (q.results || [])) {
      const st = String(b.status || "").toLowerCase();
      if (st === "cancelled" || st === "rehearsal") continue;
      if (!out[b.stop_id]) out[b.stop_id] = String(b.sched);
    }
  } catch (e) {}
  return out;
}

function bookingCounts(rows) {
  const out = {};
  for (const b of rows) out[b.stopId] = (out[b.stopId] || 0) + b.seats;
  return out;
}

async function seatsFor(env, key, route, stops, buses, rotaRow, rows) {
  const want = String(route || "").toUpperCase().charAt(0) === "S" ? "South" : "North";
  const bus = await busFor(env, key, want, buses, rotaRow);
  const byStop = {};
  for (const s of stops) byStop[s.id] = s;
  let booked = 0;
  for (const b of rows) {
    const s = byStop[b.stopId];
    if (!s || s.route !== want) continue;
    booked += b.seats;
  }
  const seats = bus.seats || 0;
  return {
    route: want, reg: bus.reg, from: bus.from, seats, booked,
    /* Negative when more are booked than the bus holds. The page says "full"
       either way; the number is for the coordinator, who can still act. */
    left: seats ? seats - booked : null
  };
}

/* ==========================================================================
   THE RUN
   ========================================================================== */

/* `mode` asks for the real run ("real") or the rehearsal's ("rehearsal")
   whatever is running; left out, it is whichever is running now. */
async function tripState(env, key, route, mode) {
  const rehearsing = mode === "real" ? false : mode === "rehearsal" ? true : !!(await rehearsalOn(env));
  const { results } = await env.DB.prepare(
    "SELECT * FROM trip_events WHERE sunday = ? AND route = ? ORDER BY happened").bind(key, route).all();

  /* ONE RUN AT A TIME, AND IT IS THE LATEST ONE.

     This used to fold every row for the route into one state, which is right
     for as long as a route only ever holds one run in a day, and that is
     nearly always true: two buses, one per route, one driver.

     Nearly. A second run can reach the record the slow way. A driver starts
     offline, his phone finds a mast an hour later, and his whole morning
     arrives after somebody else's run has already been filed and ended. The
     folded state then took the LATEST start and the LATEST end from two
     different runs, so a run that was still going read as finished, and its
     served list carried the other man's stops. The record was right the whole
     time; every screen reading it was wrong.

     So: the rows are filtered once, the run is chosen, and the state is built
     from that run's rows alone. With one run in the day, which is the ordinary
     Sunday, this is identical to what it replaced. */
  const live = [];
  for (const r of results || []) {
    const st = String(r.status || "").toLowerCase();
    if (st === "undone") continue;
    /* Both ways round: a real run never counts rehearsal rows, and a
       rehearsal never counts real ones. */
    if ((st === "rehearsal") !== rehearsing) continue;
    if (!(Number(r.happened) || 0)) continue;
    live.push(r);
  }

  /* The run that began last. Rows arrive ordered by the DRIVER'S clock, so
     this is the run that started most recently on the road rather than the
     one whose rows reached the server last.

     No start row at all means a phone whose taps arrived before its start
     did. Falling back to the last row's run keeps that morning on screen
     instead of blanking it while the start catches up. */
  let want = "";
  for (const r of live) {
    if (String(r.event || "").toLowerCase() === "start" && r.trip) want = String(r.trip);
  }
  if (!want && live.length) want = String(live[live.length - 1].trip || "");

  const state = { trip: "", driver: "", reg: "", started: 0, ended: 0,
                  lastAt: 0, lastStop: "", lastStopId: "",
                  offset: null, served: {} };

  for (const r of live) {
    if (want && String(r.trip || "") !== want) continue;

    const at = Number(r.happened) || 0;
    const ev = String(r.event || "").toLowerCase();

    state.trip = r.trip || state.trip;
    state.driver = r.driver || state.driver;
    state.reg = r.reg || state.reg;

    if (ev === "start") {
      state.started = at;
      /* A departure row gives the run an offset before a single stop has been
         marked. Guarded on the offset actually being a number: a route with
         no Depart row writes nothing there, and nothing must not read as
         "exactly on time".

         lastStop is deliberately NOT set. It means "the last stop the bus was
         seen at", and leaving church is not that — nobody was collected. */
      if (r.off_min !== null && r.off_min !== undefined && at >= state.lastAt) {
        state.lastAt = at;
        state.offset = Number(r.off_min);
      }
      continue;
    }
    if (ev === "end") { state.ended = at; continue; }

    if (r.stop_id) state.served[r.stop_id] = { at, event: ev };

    /* The freshest stop event is what the offset comes from. Not an average:
       traffic is local, and smoothing would lag at the moment it matters. */
    if (at >= state.lastAt) {
      state.lastAt = at;
      state.lastStop = r.stop || "";
      /* THE ID AS WELL AS THE NAME, and they are not interchangeable.

         lastStop is the stop's NAME because that is what gets read out to a
         passenger: "it has just left Kirkdale". The estimate needs to find
         that stop in the ordered timetable, and two stops on two routes can
         be called the same thing — both routes end at "Church" — so it needs
         the id. Passing the name where an id was wanted fails silently: the
         lookup misses, the walk starts from the departure row, and every
         stop the bus has ALREADY passed is counted as a saving. The estimate
         comes out minutes early and nothing anywhere says why. */
      state.lastStopId = r.stop_id || "";
      state.offset = (r.off_min === null || r.off_min === undefined) ? null : Number(r.off_min);
    }
  }
  return state;
}

/* Whether the offset may be used to project a time, and why not when it
   cannot. Every refusal ends with the page saying the last thing it actually
   knows instead of a number it has invented. */
function tripProjectable(state, set) {
  if (!state.started) return { ok: false, why: "notstarted" };
  if (state.ended) return { ok: false, why: "ended" };

  /* It set off and has not been heard from since.

     Tested on lastStop, NOT lastAt: the departure stamps lastAt with the time
     the bus pulled out, so lastAt is never empty on a run that has started
     and a test on it would never fire. What is empty is lastStop — no kerb
     has been marked — and that is the truth of a run that has just left.

     It stops being the truth after a while. Without this, a run where the
     driver never tapped anything said "on its way, left church at 10:05" at
     half past twelve with the bus back and the service half over. */
  if (!state.lastStop && (Date.now() - state.started) / 60000 > TRIP_QUIET_MINUTES) {
    return { ok: false, why: "silent" };
  }
  if (!state.lastAt) return { ok: false, why: "noevents" };
  if (state.offset === null) return { ok: false, why: "noevents" };

  const quiet = (Date.now() - state.lastAt) / 60000;
  if (quiet > TRIP_QUIET_MINUTES) return { ok: false, why: "quiet" };
  /* A late bus is still a bus. The cap is a setting from w2.16.0 and off by
     default: see maxBehindMinutes in ETA_FALLBACK. */
  const behind = Number(set && set.maxBehindMinutes) || 0;
  if (behind > 0 && state.offset > behind) return { ok: false, why: "wild" };
  /* Far tighter on the early side, and deliberately. A bus can honestly be
     three quarters of an hour late. It cannot be half an hour early on a
     route timetabled to take an hour, because the road does not shrink — a
     large negative offset means a stop was marked the bus had not reached. */
  if (state.offset < -TRIP_MAX_EARLY) return { ok: false, why: "wild" };
  return { ok: true };
}

async function routeOver(env, key, route, stops, mode) {
  const t = await tripState(env, key, route, mode);
  if (t.ended) return true;
  if (!t.started) return false;            /* never left: the backstop's job */

  let last = null;
  for (const s of stops) {
    if (s.route !== route) continue;
    const m = londonMoment(key, s.time);
    if (m && (!last || m.getTime() > last)) last = m.getTime();
  }
  if (!last) return false;

  const now = Date.now();
  if (now < last + RUN_DONE_MARGIN_MIN * 60000) return false;
  const heard = t.lastAt || t.started;
  return now - heard >= RUN_DONE_QUIET_MIN * 60000;
}

/* Has this Sunday's service finished, so next week may be booked?

   Before the cutoff, no. After the backstop, yes whatever anybody tapped.
   Between the two, yes only once every route WITH SOMEBODY BOOKED ON IT has
   started and ended.

   Counting only the routes that began was the fault of 16 August: North did
   its checks and never started, South ran and tapped End, and South's last
   tap rolled the page for North's passengers, some still at a kerb. */
async function runComplete(env, stops, rows) {
  const key = runSunday();
  if (!bookingsClosed(key)) return false;

  const backstop = londonMoment(key, p2(RUN_BACKSTOP_HOUR) + ":" + p2(RUN_BACKSTOP_MIN));
  if (backstop && Date.now() >= backstop.getTime()) return true;

  const counts = bookingCounts(rows);
  const routes = [];
  for (const s of stops) {
    if (s.arrival || s.depart) continue;
    if (!(Number(counts[s.id]) > 0)) continue;
    if (routes.indexOf(s.route) < 0) routes.push(s.route);
  }
  if (!routes.length) return true;
  for (const r of routes) if (!(await routeOver(env, key, r, stops))) return false;
  return true;
}

/* Which Sunday the booking page is offering: today's until the service is
   over, then next week's. */
async function busCurrentSunday(env, stops) {
  const sunday = sundayKeyOf(new Date());
  const rows = await liveBookings(env, sunday);
  return (await runComplete(env, stops, rows)) ? keyAddWeeks(sunday, 1) : sunday;
}

function busDateAllowed(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ""))) return false;
  const thisSunday = sundayKeyOf(new Date());
  return key === thisSunday || key === keyAddWeeks(thisSunday, 1);
}

/* ==========================================================================
   PAYLOADS — shapes identical to Code.gs
   ========================================================================== */

async function busPayload(env, keyIn, ref, pid) {
  const all = await getStops(env);
  const stops = pickupsAndArrivals(all);

  let key = keyIn, rolled = false;
  if (!key) {
    const today = sundayKeyOf(new Date());
    key = await busCurrentSunday(env, stops);
    rolled = key !== today;
  }
  if (!busDateAllowed(key)) {
    return { ok: false, error: "That link is out of date. Ask for the current one." };
  }

  const rows = await liveBookings(env, key);
  let mine = bookingFor(rows, pid, ref);

  /* A seat at a stop that is no longer on the timetable. It can only happen
     when a stop is withdrawn or renumbered after somebody has booked, and
     left alone it is the worst kind of quiet failure: the page says "Booked",
     no stop is ticked because none matches, the driver never sees the seat,
     and the passenger stands at a kerb no bus is coming to. */
  let stopGone = "";
  if (mine && mine.stopId) {
    if (!stops.some((s) => s.id === mine.stopId)) { stopGone = mine.stopId; mine = null; }
  }

  const buses = await getBuses(env);
  const rotaRow = await getRotaRow(env, key);
  const seats = {};
  for (const rt of routeNames(stops)) {
    seats[rt] = await seatsFor(env, key, rt, stops, buses, rotaRow, rows);
  }

  return {
    ok: true,
    date: key,
    closed: bookingsClosed(key),
    /* Separate from closed on purpose. A rehearsal must not tell the page
       bookings have shut, or a member booking on a Tuesday is turned away by
       a test. It only tells the page to start watching. */
    rehearsal: rehearsalInfo(await rehearsalOn(env)),
    rolled,
    cutoff: cutoffWords(),
    stops: publicStops(stops.filter((s) => !s.arrival)),
    arrivals: publicStops(stops.filter((s) => s.arrival)),
    /* Routes that are off today. The page greys their stops and refuses to
       take a seat on one, and the refusal below is what makes that binding
       rather than cosmetic. */
    off: cancelledRoutes(await getRotaRow(env, key).catch(() => null), stops),
    counts: bookingCounts(rows),
    /* Who is driving this phone's route, with a WhatsApp number, for the
       Message button. From w2.28.0; null for everybody else, which is most
       phones most of the week. See driverForPassenger. */
    driver: await driverForPassenger(env, key, stops, mine),
    phone: mine && mine.phone ? mine.phone : "",
    mine: mine ? { stopId: mine.stopId, seats: mine.seats } : null,
    stopGone,
    seats
  };
}

/* THE DRIVER A BOOKED PASSENGER MAY MESSAGE. From w2.28.0.

   Handed to one phone only: one with a seat on this Sunday, once bookings
   have closed, for the route that seat is on, with the route running. The
   name is the rota's for that route, cover first, as every phone sees the
   rota now, so a cover the coordinator has just typed is the man the
   passenger reaches. His number comes from the Drivers tab by way of the
   sync; no number, no button. Any fault here is no button, never a broken
   page: this is a convenience, and it must not be able to take Sunday
   morning down with it. */
async function driverForPassenger(env, key, stops, mine) {
  try {
    if (!mine || !bookingsClosed(key)) return null;
    const st = stops.find((s) => s.id === mine.stopId);
    if (!st || !st.route) return null;
    const row = await currentRota(env, key);
    if (!row || routeCancelled(row, st.route)) return null;
    const who = st.route === "South" ? (row.southCover || row.south) : (row.northCover || row.north);
    if (!who) return null;
    const book = await cacheGet(env, "driver_wa");
    if (!book || typeof book !== "object") return null;
    const flat = (x) => String(x || "").trim().toLowerCase().replace(/\s+/g, " ");
    for (const name of Object.keys(book)) {
      if (flat(name) === flat(who) && book[name]) return { name: name, wa: String(book[name]), route: st.route };
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function tripPayload(env, ref, want, askedStop, pid) {
  const key = runSunday();
  const all = await getStops(env);
  const stops = pickupsAndArrivals(all);
  const reh = await rehearsalOn(env);

  const stopById = {};
  for (const s of stops) stopById[s.id] = s;

  /* A CANCELLED MORNING IS READ BEFORE THE GATE, NOT AFTER IT.

     This was the worst fault in the app and it hid for months, because it only
     appears when two things are true at once: a route is called off, AND the
     phone is looked at before bookings close at 09:30 on the Sunday.

     wakeCancelled runs on every five minute sync, any day of the week, so
     calling a route off on the Friday pushes every booked passenger there and
     then. The words, though, are computed when the phone asks — and the gate
     below used to return "open" before anything had looked at the Rota. So the
     cancellation push arrived wearing the booking message:

         You are booked for Sunday
         Scarisbrick Dr, 10:03.

     The exact opposite of what it was sent to say. And the tag burns on that
     send: by the Sunday the sweep considers this phone told, so the correct
     message never arrives at all. The ONLY notification he ever got said his
     seat was fine, on a morning that was not running. Twelve people at a kerb
     in the rain, each holding a phone that had reassured them.

     It came right only if the route was called off AFTER 09:30 on the day.

     The gate exists to keep the live TRACKING view hidden until bookings close
     — it was never meant to hide the Rota, and a bus that is not coming is not
     tracking. So the Rota is asked first, and the gate keeps its real job.

     The later cancellation check stays where it is. It covers what this one
     cannot: a phone with no booking that has named a kerb, and a rehearsal's
     seeded seat. Two checks, and the one that matters runs first.

     THE ROTA IS ASKED FIRST, AND THE SEATS ONLY IF IT SAYS SOMETHING.

     The obvious way round costs a full read of the Sunday's bookings on every
     tap, and the path this sits on — bookings still open — is the busy one:
     it runs all week, for every passenger opening the page and every phone
     asking what a notification should say. The first version of this fix did
     exactly that, to answer a question whose answer is no in forty-nine weeks
     out of fifty.

     One indexed row first. Nothing cancelled and it stops there, which is the
     ordinary week. Something cancelled and the seats are worth reading. */
  {
    let rotaNow = null;
    try { rotaNow = await getRotaRow(env, key); } catch (e) {}
    const off = cancelledRoutes(rotaNow, stops);
    if (off.length) {
      const seats = await liveBookings(env, key);
      const seat = bookingFor(seats, String(pid || "").trim(), String(ref || "").trim());
      const at = seat && seat.stopId ? stopById[seat.stopId] : null;
      if (at && off.indexOf(at.route) !== -1) {
        return { ok: true, live: false, why: "cancelled", date: key, rehearsal: rehearsalInfo(reh),
                 route: at.route, stop: at.stop, stopId: at.id, scheduled: at.time };
      }
    }
  }

  /* The gate: tracking is visible only once bookings have closed — or while
     a rehearsal is running, which is a separate switch on purpose. */
  if (!(reh || bookingsClosed(key))) {
    return { ok: true, live: false, why: "open", date: key, cutoff: cutoffWords(), rehearsal: false };
  }

  const rows = await liveBookings(env, key);

  let mine = bookingFor(rows, String(pid || "").trim(), String(ref || "").trim());
  if (mine && !mine.stopId) mine = null;

  /* Rehearsing. The live view is only ever shown to a phone with a booking,
     so without this the person running the rehearsal sees nothing unless
     they first make a real booking and remember to cancel it. An explicit
     route asked for by the page wins even when the phone holds a booking —
     without that, a tester who had booked a seat was pinned to his own
     stop's route and the North/South switch did nothing at all. */
  const askedRoute = String(want || "").trim();
  if (reh && (askedRoute || !mine)) {
    const seeds = rows.filter((b) => b.stopId && String(b.device || "").indexOf("rehearsal-") === 0);
    if (askedRoute) {
      mine = null;
      for (const b of seeds) {
        const s = stopById[b.stopId];
        if (!mine && s && s.route === askedRoute) mine = b;
      }
    }
    if (!mine) {
      for (const b of seeds) {
        if (mine) continue;
        const s = stopById[b.stopId];
        if (!s) continue;
        const t = await tripState(env, key, s.route);
        if (t.started && !t.ended) mine = b;
      }
    }
    if (!mine && seeds.length) mine = seeds[0];
  }

  /* No booking on this phone, but the passenger has said which kerb they are
     standing at. Everything below is a fact about the STOP — when the bus is
     due, how far off it is running, whether it has been. Three households
     booked at one kerb already get one identical answer, because the driver
     taps the stop and never the people. */
  let watching = false;
  if (!mine) {
    const wantStop = String(askedStop || "").trim();
    if (wantStop && stopById[wantStop] && !stopById[wantStop].arrival) {
      mine = { stopId: wantStop, seats: 0, device: "" };
      watching = true;
    }
  }
  if (!mine) return { ok: true, live: false, why: "nobooking", date: key, rehearsal: rehearsalInfo(reh) };

  const myStop = stopById[mine.stopId] || null;
  if (!myStop) return { ok: true, live: false, why: "nobooking", date: key, rehearsal: rehearsalInfo(reh) };

  /* THE BUS THAT IS NOT COMING.

     Said here, before a single fact about a run, because everything below
     this line describes a bus on the road and there is no bus on the road.
     A passenger who reads "not started yet" at ten past ten on a morning that
     was called off an hour earlier will stand at that kerb until somebody
     rings him. */
  {
    let rotaRow = null;
    try { rotaRow = await getRotaRow(env, key); } catch (e) {}
    if (routeCancelled(rotaRow, myStop.route)) {
      return { ok: true, live: false, why: "cancelled", date: key, rehearsal: rehearsalInfo(reh),
               route: myStop.route, stop: myStop.stop, stopId: myStop.id,
               scheduled: myStop.time };
    }
  }

  const state = await tripState(env, key, myStop.route);
  const out = {
    ok: true, live: true, date: key, now: Date.now(), route: myStop.route,
    watching,
    rehearsal: rehearsalInfo(reh),
    routes: reh ? routeNames(stops) : [],
    stop: myStop.stop, stopId: myStop.id, scheduled: myStop.time,
    started: !!state.started, ended: !!state.ended,
    startedAtWords: state.started ? londonHHMM(new Date(state.started)) : "",
    lastStop: state.lastStop,
    lastAgo: state.lastAt ? Math.round((Date.now() - state.lastAt) / 60000) : null,
    lastAtWords: state.lastAt ? londonHHMM(new Date(state.lastAt)) : ""
  };

  /* Already collected. Said plainly and before anything else, because a
     projected time for a stop the bus has left is nonsense. */
  const servedHere = state.served[myStop.id];
  if (servedHere) {
    out.mine = "served";
    out.servedAt = londonHHMM(new Date(servedHere.at));
    /* "Nobody there" and "picked up" are different facts. Collapsing them
       told a family thirty seconds up the road they were on a bus they were
       not on. */
    const said = String(servedHere.event || "").toLowerCase();
    out.servedEvent = TAP_EMPTY.indexOf(said) !== -1 ? "empty" : said;
    return out;
  }

  /* The bus has gone by without this stop being marked. The proof is a LATER
     stop being marked, and nothing else is proof: a bus merely running late
     has marked nothing beyond this stop. Deliberately after the served test,
     so a late out-of-order tap corrects this screen on the next poll. */
  const mineOrder = stops.filter((s) => s.route === myStop.route);
  const at = mineOrder.findIndex((s) => s.id === myStop.id);
  if (at >= 0) {
    for (let i = at + 1; i < mineOrder.length; i++) {
      const beyond = state.served[mineOrder[i].id];
      if (!beyond) continue;
      out.mine = "passed";
      out.passedStop = mineOrder[i].stop;
      out.passedAtWords = londonHHMM(new Date(beyond.at));
      return out;
    }
  }

  const set = await etaSettings(env);
  const can = tripProjectable(state, set);
  if (!can.ok) { out.mine = can.why; return out; }

  const sched = londonMoment(key, myStop.time);
  if (!sched) { out.mine = "noevents"; return out; }

  /* THE ESTIMATE LEADS FROM HERE.

     The timetabled time plus the run's offset is where it starts, and then
     everything the bus is not going to stop for between its last marked kerb
     and this one comes off. See THE ESTIMATE above for why the saving is
     dwell-led rather than distance-led, and why it leans early. */
  const ordered = stopsOnRoute(all, myStop.route);
  const booked = await bookedStopIds(env, key, myStop.route);
  const saved = etaSavedMinutes(key, ordered, state.lastStopId, myStop.id, booked, set);

  const eta = new Date(sched.getTime() + state.offset * 60000 - saved * 60000);
  const mins = Math.round((eta.getTime() - Date.now()) / 60000);

  /* AN ESTIMATE WHOSE TIME HAS PASSED, WITH THE STOP STILL UNMARKED.

     It used to be dropped two minutes after its time, and the page went back
     to the timetable and "No update yet" while the bus was plainly still on
     its way to that kerb. It now stays for keepMinutes, a setting, and the
     page goes on telling him to be at his stop. The quiet rule above still
     ends it if the bus stops being heard from. */
  if (mins < -set.keepMinutes) { out.mine = "quiet"; return out; }

  out.mine = "eta";
  out.offset = state.offset;
  out.etaWords = londonHHMM(eta);
  out.minutes = mins;
  out.imminent = mins <= TRIP_IMMINENT_MINUTES;
  return out;
}

/* `mode` as for tripState. The driver's board leaves it out; the driver's
   reminders ask for the real run, because a test run is nobody's to be
   reminded about. */
async function tripDriverPayload(env, route, mode) {
  const key = runSunday();
  const rt = String(route || "").trim() || "North";
  const all = await getStops(env);
  const state = await tripState(env, key, rt, mode);
  const reh = await rehearsalOn(env);
  const d = departStopFor(all, rt);
  return {
    ok: true, date: key, route: rt, now: Date.now(),
    closed: !!(reh || bookingsClosed(key)), cutoff: cutoffWords(),
    rehearsal: rehearsalInfo(reh),
    trip: state.trip, driver: state.driver, reg: state.reg,
    started: state.started || 0, ended: state.ended || 0,
    lastAt: state.lastAt || 0, lastStop: state.lastStop,
    lastStopId: state.lastStopId || "",
    offset: state.offset, served: state.served,
    departWords: d ? d.time : ""
  };
}

/* Which bus every OTHER route currently has out. Runs in progress only: a
   route that has finished tells you nothing about which bus is standing free. */
async function runningRegs(env, exceptRoute, stops) {
  const key = runSunday();
  const out = {};
  for (const rt of routeNames(stops)) {
    if (rt === exceptRoute) continue;
    const t = await tripState(env, key, rt);
    if (t.started && !t.ended && t.reg) out[rt] = t.reg;
  }
  return out;
}

/* An authorisation is stored beside the check rather than inside it.

   checks_today has one row per registration and it is overwritten by every
   sync, so a column on it would be wiped by the next push from Apps Script.
   The settings table is where small facts that must outlive a request already
   live, and putting it there also means no ALTER on a database the
   coordinator deploys to from a dashboard. */
const authKey = (day, reg) => "auth:" + day + ":" + String(reg || "").trim().toUpperCase();

async function authsToday(env, day) {
  const { results } = await env.DB.prepare(
    "SELECT k, v FROM settings WHERE k LIKE ?").bind("auth:" + day + ":%").all();
  const out = {};
  for (const r of results || []) {
    let v = null;
    try { v = JSON.parse(r.v); } catch (e) { continue; }
    if (v && v.reg) out[String(v.reg).trim().toUpperCase()] = v;
  }
  return out;
}

async function checksToday(env) {
  const day = londonKey(new Date());
  /* SELECT * rather than naming check_id: a database the Worker has not yet
     added that column to must still answer the board. */
  const { results } = await env.DB.prepare(
    "SELECT * FROM checks_today WHERE day = ?").bind(day).all();

  /* Fenced: a fault reading authorisations must not cost the caller the
     checks, because "I could not tell you" and "nobody has checked it" look
     the same on a phone and only one of them is true. */
  let auths = {};
  try { auths = await authsToday(env, day); } catch (e) {}

  const out = {};
  for (const r of results || []) {
    const at = Number(r.at);
    const cid = String(r.check_id || "");
    const a = auths[String(r.reg || "").trim().toUpperCase()];
    /* AN AUTHORISATION LIFTS THE CHECK IT NAMES, AND NO OTHER.

       Otherwise a second walkaround that stops the bus again would be waved
       through by this morning's earlier signature, which is the one direction
       this must never get wrong. By name where both sides have one, which no
       clock can get wrong; by time only for a record from before check ids,
       where time is all there is. */
    const names = !!(a && a.checkId && cid);
    const lifted = !!(r.state === "stopped" && a &&
      (names ? String(a.checkId) === cid : (Number(a.at) || 0) >= at));
    out[r.reg] = {
      state: lifted ? "authorised" : r.state,
      at: lifted ? Number(a.at) : at,
      driver: r.driver || "",
      /* Which walkaround this is, so a phone holding its own copy of the same
         check can tell "the same check, since changed" from "a different
         check" without comparing its clock with this one. */
      id: cid
    };
    if (lifted) out[r.reg].by = String(a.by || "");
  }
  return out;
}

/* Everything the driver's Stops and bookings screen needs, in one answer.
   Each part is fenced off: a part that fails is ABSENT, and absent is the one
   thing the phone can safely tell from a fact. An empty object would be
   indistinguishable from "nobody booked anywhere" and would wipe good
   numbers off a driver's screen. */
async function boardPayload(env, route) {
  const r = String(route || "").trim() || "North";
  const out = { ok: true };
  const key = runSunday();

  const all = await getStops(env);
  const stops = pickupsAndArrivals(all);
  const rows = await liveBookings(env, key);

  try { out.date = key; out.counts = bookingCounts(rows); }
  catch (e) { out.countsError = String(e); }

  try { out.checks = await checksToday(env); }
  catch (e) { out.checksError = String(e); }

  try { out.others = await runningRegs(env, r, stops); }
  catch (e) { out.othersError = String(e); }

  try {
    const buses = await getBuses(env);
    const rotaRow = await getRotaRow(env, key);
    const seats = {};
    for (const rt of routeNames(stops)) {
      seats[rt] = await seatsFor(env, key, rt, stops, buses, rotaRow, rows);
    }
    out.seats = seats;
    out.buses = buses.map((b) => ({ reg: b.reg, seats: b.seats, dates: b.dates || {} }));
  } catch (e) { out.seatsError = String(e); }

  try { out.trip = await tripDriverPayload(env, r); }
  catch (e) { out.tripError = String(e); }

  /* THE ESTIMATE, PER STOP, FOR THE DRIVER'S OWN LIST.

     Worked out HERE and not in the page, for the same reason the push wording
     is: the driver's screen and the passenger's phone must not be able to
     give two answers about the same bus. One function, one set of settings,
     one answer, and the page's only job is to draw it.

     Fenced like every other part of this payload. A failure here costs the
     estimate and nothing else — the stop list, the counts and the checks all
     still arrive, because a driver with no estimate has the morning he had
     last week and a driver with no stop list has nothing. */
  try {
    const st = out.trip;
    if (st && st.started && !st.ended && st.offset !== null && st.offset !== undefined) {
      const set = await etaSettings(env);
      const ordered = stopsOnRoute(all, r);
      const counts = out.counts || {};
      const booked = new Set(Object.keys(counts).filter((id) => Number(counts[id]) > 0));
      const etas = {};
      for (const stop of ordered) {
        if (String(stop.kind || "pickup") !== "pickup") continue;
        const sched = londonMoment(key, stop.time);
        if (!sched) continue;
        const saved = etaSavedMinutes(key, ordered, st.lastStopId, stop.id, booked, set);
        etas[stop.id] = Math.round(
          (sched.getTime() + Number(st.offset) * 60000 - saved * 60000) / 60000) * 60000;
      }
      out.etas = etas;
      out.etaAt = Date.now();
    }
  } catch (e) { out.etaError = String(e); }

  return out;
}

/* ==========================================================================
   WRITES
   ========================================================================== */

async function handleBooking(env, b) {
  if (!b) return json({ ok: false, error: "empty booking" });

  const all = await getStops(env);
  const stops = pickupsAndArrivals(all);
  const key = String(b.date || "") || (await busCurrentSunday(env, stops));
  if (!busDateAllowed(key)) {
    return json({ ok: false, error: "That link is out of date. Ask for the current one." });
  }

  const ref = String(b.ref || "").replace(/[^A-Za-z0-9]/g, "").substring(0, 32);
  const phone = normalisePhone(b.phone);
  const pid = phone ? await passengerId(env, phone)
                    : String(b.pid || "").replace(/[^a-f0-9]/g, "").substring(0, 24);
  if (!ref && !pid) return json({ ok: false, error: "no device handle" });

  const seats = Math.max(0, Math.min(12, Number(b.seats) || 0));
  const stopId = String(b.stopId || "").trim();

  /* Closed, and exactly one thing is still allowed: withdrawing. A seat
     cannot be taken, moved or resized once the driver is reading the list at
     the kerb. But somebody who is no longer coming is worth hearing at any
     hour, because the alternative is a driver waiting at a stop for nobody. */
  let late = false;
  if (bookingsClosed(key)) {
    if (seats > 0) {
      return json({ ok: false, error: "Bookings for that Sunday have closed. Reopen the page for the next one." });
    }
    const rowsNow = await liveBookings(env, key);
    if (key !== runSunday() || (await runComplete(env, stops, rowsNow))) {
      return json({ ok: false, error: "That Sunday is over. Reopen the page for the next one." });
    }
    late = true;
  }

  const stop = stops.find((s) => s.id === stopId && !s.arrival) || null;
  if (seats > 0 && !stop) return json({ ok: false, error: "unknown stop" });

  /* A seat on a bus that is not running.

     Only ever refused for seats > 0. Withdrawing stays open on a cancelled
     route exactly as it stays open after the cutoff, because somebody taking
     their name off a list is worth hearing at any hour and refusing it would
     be refusing the one message that costs nothing to accept. */
  if (seats > 0 && stop) {
    let rotaRow = null;
    try { rotaRow = await getRotaRow(env, key); } catch (e) {}
    if (routeCancelled(rotaRow, stop.route)) {
      return json({ ok: false, error: "The " + stop.route +
                    " bus is not running this Sunday." });
    }
  }

  const rows = await liveBookings(env, key);
  const existing = bookingFor(rows, pid, ref);

  /* Changing or cancelling one that already exists is allowed on the handle
     alone, so a page cached before numbers existed can still take a seat OFF
     the driver's list. Refusing that would be refusing the one message that
     is always worth hearing. */
  if (seats > 0 && !existing && !pid) {
    return json({ ok: false, needPhone: true,
                  error: "This page is out of date. Reload it and book again." });
  }

  if (!seats) {
    if (existing) {
      /* Exactly "Cancelled", never a status of its own: liveBookings drops
         that one word and counts everything else as booked, so a tidy-looking
         "Cancelled late" would leave the seat on the driver's screen — the
         precise opposite of what the passenger just asked for. The lateness
         goes in a note, which no code reads. */
      const note = late
        ? "Withdrew at " + londonHHMM(new Date()) +
          ", after bookings closed. The driver may already have been on the road."
        : "";
      await env.DB.prepare(
        "UPDATE bookings SET status='Cancelled', note=?, received=?, synced=0 WHERE id=?"
      ).bind(note, Date.now(), existing.row).run();
    }
    const after = await liveBookings(env, key);
    return json({ ok: true, cancelled: true, late, mine: null, counts: bookingCounts(after) });
  }

  if (existing) {
    await env.DB.prepare(
      "UPDATE bookings SET route=?, stop_id=?, stop=?, seats=?, status='Booked', " +
      "received=?, device=COALESCE(NULLIF(?,''), device), " +
      /* A booking made before numbers existed, being changed by somebody who
         has now given one. Put the owner on the row so the next device finds
         it by the number rather than by the handle. */
      "pid=CASE WHEN pid='' THEN ? ELSE pid END, " +
      "phone=CASE WHEN pid='' THEN ? ELSE phone END, synced=0 WHERE id=?"
    ).bind(stop.route, stop.id, stop.stop, seats, Date.now(), ref, pid, phone, existing.row).run();
    await stampBooked(env, existing.row, stop.time, existing.stopId !== stop.id);
  } else {
    const res = await env.DB.prepare(
      "INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received, synced) " +
      "VALUES (?,?,?,?,?,?,?,?,'Booked',?,0)"
    ).bind(key, stop.route, stop.id, stop.stop, seats, ref, pid, phone, Date.now()).run();
    await stampBooked(env, Number(res && res.meta && res.meta.last_row_id) || 0, stop.time, true);
  }

  await subsFollow(env, ref, pid);

  const after = await liveBookings(env, key);
  return json({ ok: true, stopId: stop.id, seats,
                mine: { stopId: stop.id, seats },
                counts: bookingCounts(after) });
}

/* The passenger gives their number once, on whichever device is in their
   hand, and this answers with everything the booking page loads plus the
   fingerprint to use from then on. Deliberately the SAME SHAPE as ?bus=1, so
   identifying on a second device and loading the page for the first time run
   through exactly one piece of code on the page. */
async function handleIdentify(env, body) {
  const phone = normalisePhone(body && body.phone);
  if (!phone) return json({ ok: false, error: "Eleven digits, starting with 0." });

  const ref = String((body && body.ref) || "").replace(/[^A-Za-z0-9]/g, "").substring(0, 32);

  /* Somebody sitting there trying numbers to see whose booking they can find.
     Not a wall — a handle is whatever the asker says it is — and not
     pretending to be one. Enough to make the idle version tedious, and
     nowhere near tight enough to trouble a family sharing one phone. */
  if (ref) {
    const k = "idtry_" + ref;
    const row = await env.DB.prepare("SELECT v FROM settings WHERE k=?").bind(k).first();
    let tries = 0, since = Date.now();
    if (row) { try { const s = JSON.parse(row.v); tries = s.n || 0; since = s.t || Date.now(); } catch {} }
    if (Date.now() - since > IDENTIFY_WINDOW_MINUTES * 60000) { tries = 0; since = Date.now(); }
    if (tries >= IDENTIFY_MAX_TRIES) {
      return json({ ok: false, error: "Too many tries. Wait " + IDENTIFY_WINDOW_MINUTES + " minutes." });
    }
    await env.DB.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
      .bind(k, JSON.stringify({ n: tries + 1, t: since })).run();
  }

  const pid = await passengerId(env, phone);
  const all = await getStops(env);
  const stops = pickupsAndArrivals(all);
  const key = await busCurrentSunday(env, stops);

  /* Adopting a booking made before this person had given a number. */
  const rows = await liveBookings(env, key);
  const owned = rows.find((b) => b.pid && b.pid === pid);
  const orphan = rows.find((b) => !b.pid && ref && b.device === ref);
  if (!owned && orphan) {
    await env.DB.prepare("UPDATE bookings SET pid=?, phone=?, synced=0 WHERE id=?")
      .bind(pid, phone, orphan.row).run();
  }

  await subsFollow(env, ref, pid);

  const out = await busPayload(env, key, ref, pid);
  out.pid = pid;
  out.phone = phone;
  return json(out);
}

/* ALERTS FOLLOW THE NUMBER.

   A phone's alerts are matched to a booking by its device handle or by the
   fingerprint of the number it holds. The fingerprint was written once, when
   Turn on was tapped, and never again. So a phone that turned alerts on
   before it had given a number, or that has since been told a different one,
   heard nothing about a booking made for that number on any other phone.

   Now, whenever a phone gives a number or books with one, every alert
   subscription on that handset is moved to that number. Book on the laptop,
   and the phone in your pocket that has the same number is told when the bus
   is coming. */
async function subsFollow(env, ref, pid) {
  if (!ref || !pid) return;
  try {
    await env.DB.prepare(
      "UPDATE push_subs SET pid=? WHERE role<>'driver' AND ref=? AND pid<>?").bind(pid, ref, pid).run();
  } catch (e) { /* the booking or the answer is what matters here */ }
}

/* Taps arriving from a driver's phone, one or many. Many, because a phone in
   a blackspot queues them and sends the lot on reconnect. Each carries the
   time it was MADE and that is what goes in happened; the server writes
   logged itself and never touches happened, or every time downstream of a
   blackspot drifts by however long the phone was out of touch.

   No lock. The unique index on (trip, event, stop_id) is what makes a retry
   free, and SQLite gives us that for nothing — which is the whole reason the
   ten-second script lock that every other driver used to queue behind is
   gone rather than reimplemented. */
/* WHAT A TAP IS: "real", "test", or "over" (a test from a round that has
   ended, taken and thrown away, never written). Decided by the run, never by
   the moment the tap happened to arrive.

   - A run swept away with its rehearsal is over, whatever the page says.
   - A tap that names a round is a test in the round running now, and over
     in any other.
   - A tap that says real, or says nothing (a page from before v1.79.0), is
     whatever its run's start was, when the start is here.
   - With no start here, the run is judged by when it started: the start in
     the batch, or, from a page that says nothing, its first tap. Made after
     the running rehearsal began, it is a test: no real run starts during
     one, and a phone that had not heard of the round yet would otherwise
     put a test run on the day's record. Made inside a round that has ended,
     it is over.

   Five minutes' grace, for a phone whose clock is a little behind. On a real
   Sunday none of this finds anything: no round runs on a Sunday morning. */
const ROUND_GRACE_MS = 5 * 60000;
async function rehearsalVerdict(env, trip, payload, reh) {
  if (trip && await rehearsalGone(env, trip)) return "over";
  const claimed = payload.rehearsal;
  const silent = claimed === undefined || claimed === null;
  if (!silent && Number(claimed)) return reh && Number(reh.at) === Number(claimed) ? "test" : "over";
  if (trip) {
    let s = null;
    try {
      s = await env.DB.prepare("SELECT status FROM trip_events WHERE trip=? AND event='start' ORDER BY id LIMIT 1")
        .bind(trip).first();
    } catch (e) {}
    if (s) return String(s.status || "").toLowerCase() === "rehearsal" ? "test" : "real";
  }
  const list = (payload.events || []).filter((e) => Number(e && e.at));
  const start = list.find((e) => String(e.event || "").trim().toLowerCase() === "start");
  const t0 = start ? Number(start.at)
           : silent ? list.reduce((m, e) => Math.min(m, Number(e.at)), Infinity) : NaN;
  if (!isFinite(t0)) return "real";
  if (reh && t0 >= Number(reh.at) - ROUND_GRACE_MS) return "test";
  for (const r of await rehearsalRoundsDone(env)) {
    if (t0 >= Number(r.at) - ROUND_GRACE_MS && t0 <= Number(r.end)) return "over";
  }
  return "real";
}

async function handleTrip(env, payload) {
  if (!payload) return json({ ok: false, error: "no trip data" });

  /* WHAT A TAP IS, SAID BY THE PHONE THAT MADE IT.

     From v1.79.0 a run knows the rehearsal round it was started in, and
     every tap in it says so: 0 for a real run. A tap from a round that is
     over is taken and thrown away, never written, so a phone that comes back
     into signal after the rehearsal has ended cannot put its taps on the
     record as a real morning. A real tap that arrives during a rehearsal is a
     real tap. Only a page from before v1.79.0, which says nothing, is judged
     the old way, by whether a rehearsal is on as it arrives. */
  const reh = await rehearsalOn(env);
  const tripId = String(payload.trip || "").trim();
  /* See rehearsalVerdict. "over" is answered yes, so a phone does not send
     it for ever, and says so, so a phone of this version lets the run go. */
  const verdict = await rehearsalVerdict(env, tripId, payload, reh);
  if (verdict === "over") {
    return json({ ok: true, written: 0, dropped: (payload.events || []).length,
                  rehearsalOver: true, rehearsal: rehearsalInfo(reh) });
  }
  const rehearsing = verdict === "test";
  const key = anyToKey(payload.sunday) || runSunday();
  const route = String(payload.route || "").trim() || "North";
  const trip = String(payload.trip || "").trim();
  const who = String(payload.driver || "").trim();
  if (!trip) return json({ ok: false, error: "no trip id" });

  const events = (payload.events || []).slice()
    .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
  if (!events.length) return json({ ok: true, written: 0 });

  let reg = String(payload.reg || "").trim();
  if (!reg) for (const ev of events) {
    if (!reg && String(ev.event || "").toLowerCase() === "start") reg = String(ev.reg || "").trim();
  }
  if (!reg) {
    const had = await env.DB.prepare(
      "SELECT reg FROM trip_events WHERE trip=? AND reg<>'' LIMIT 1").bind(trip).first();
    if (had) reg = had.reg;
  }

  const all = await getStops(env);
  const stops = pickupsAndArrivals(all);
  const byId = {}; for (const s of stops) byId[s.id] = s;
  const depart = departStopFor(all, route);

  const buses = await getBuses(env);
  const rotaRow = await getRotaRow(env, key);

  /* TWO BUSES ON ONE ROUTE AT ONCE IS NOT A THING THAT HAPPENS.

     The second hard refusal in the system, and the only one that lives on
     the server. The app refuses it too, instantly, off the board it already
     holds — but the board is a cached answer a few seconds old, and two
     drivers pressing Start within that window would both be told yes. One
     route would then have two open runs, two sets of stop taps, and a
     passenger page flicking between them.

     Judged on the trip id, not the name: a driver whose phone retries its own
     start must never be refused his own run. */
  const startsHere = events.some(
    (e) => String(e.event || "").trim().toLowerCase() === "start");
  if (startsHere && !rehearsing) {
    let open = null;
    /* The real run on the route, even while a rehearsal is on: a real start
       is only ever refused by another real run. */
    try { open = await tripState(env, key, route, "real"); } catch (e) {}
    if (open && open.started && !open.ended && open.trip && open.trip !== trip) {
      return json({ ok: false, error: "route busy", busy: {
        driver: String(open.driver || ""), reg: String(open.reg || ""),
        route: route
      } });
    }
  }

  /* WHOSE RUN IS THIS TO END?

     On 20 September a driver's run was ended from another driver's phone.
     The phone was not misbehaving: it had ADOPTED the run off the board,
     because at that point a phone with no run of its own took whatever the
     board reported as its own — and once it held the run, every test that
     asked "is this yours" answered yes. The app half of that is fixed in
     index.html. This is the other half, and it is the half that matters,
     because the app can be wrong about who is holding it and the record
     cannot.

     A run is ended by the man who started it. Nobody else, not even a
     coordinator, reaches this path: his way in is the endrun action below,
     which asks for his PIN and signs the row with his name. Refusing here and
     nowhere else would leave the record's only protection in a page that can
     be a version behind.

     Judged on the START ROW for this trip id, not on the route's state: two
     runs can reach one route the slow way, and the question is about THIS
     run. A batch that carries its own start is its own owner, which is what
     keeps a wholly offline morning — start and end arriving together — from
     being refused on arrival. */
  const endsHere = events.some(
    (e) => String(e.event || "").trim().toLowerCase() === "end");
  let endIgnored = 0;

  if (endsHere && !rehearsing) {
    await ensureTripCols(env);

    const startRow = await env.DB.prepare(
      "SELECT driver FROM trip_events WHERE trip=? AND event='start' AND status<>'Undone' LIMIT 1"
    ).bind(trip).first();

    const ownStart = events.some(
      (e) => String(e.event || "").trim().toLowerCase() === "start");
    const owner = String((startRow && startRow.driver) || (ownStart ? who : "")).trim();

    if (owner && who && !sameName(owner, who)) {
      return json({ ok: false, error: "not your run", run: { driver: owner, route: route } });
    }

    /* A SECOND END IS IGNORED, NOT WRITTEN TWICE.

       The unique index already stops a second row appearing, and the upsert
       below only revives a row somebody took back, so this changes no data.
       What it changes is the ANSWER: a phone retrying an end it already sent
       is told the run is closed rather than told it wrote something, and the
       arrival time on the record stays the one the driver actually tapped
       instead of creeping forward with every retry. */
    const already = await env.DB.prepare(
      "SELECT id FROM trip_events WHERE trip=? AND event='end' AND status<>'Undone' LIMIT 1"
    ).bind(trip).first();
    if (already) {
      const before = events.length;
      for (let i = events.length - 1; i >= 0; i--) {
        if (String(events[i].event || "").trim().toLowerCase() === "end") events.splice(i, 1);
      }
      endIgnored = before - events.length;
      if (!events.length) return json({ ok: true, written: 0, endIgnored, ended: true });
    }
  }

  /* Who the rota says is on this route, cover first. Used only to mark a run
     as cover on the record, never to refuse one: a man standing at the bus
     with the keys is driving it whatever the spreadsheet says, and the useful
     thing is that Monday can see the column was never filled. */
  const rotaWho = String(
    (route === "South" ? (rotaRow && (rotaRow.south_cover || rotaRow.south))
                       : (rotaRow && (rotaRow.north_cover || rotaRow.north))) || ""
  ).trim();
  /* A blank rota line counts as cover too: nobody was rostered, so whoever
     drove was covering for a gap. Guarded on the row EXISTING, because a rota
     copy that has not synced yet would otherwise stamp every run on a quiet
     morning as cover and teach you to ignore the word. */
  const isCover = !!(who && rotaRow &&
                     (!rotaWho || who.toLowerCase() !== rotaWho.toLowerCase()));
  let wantBus = "";
  try { wantBus = (await busFor(env, key, route, buses, rotaRow)).reg || ""; } catch {}

  /* The times passengers were given at the stops they booked. Not for a
     rehearsal: its seats were drawn this morning from today's timetable. */
  const promised = rehearsing ? {} : await bookedTimes(env, key, route);

  const stmts = [];
  let written = 0, undone = 0;

  for (const ev of events) {
    const kind = String(ev.event || "").trim().toLowerCase();
    let stopId = String(ev.stopId || "").trim();
    const at = Number(ev.at) || 0;
    if (!at) continue;

    /* An undo names the event it takes back. The row stays and is marked,
       because a driver who taps and untaps four times should leave a trace. */
    if (kind === "undo") {
      const target = String(ev.undoes || "").trim().toLowerCase();
      stmts.push(env.DB.prepare(
        "UPDATE trip_events SET status='Undone', synced=0 WHERE trip=? AND event=? AND stop_id=?"
      ).bind(trip, target, stopId));
      undone++;
      continue;
    }

    let stop = byId[stopId] || null;
    /* Leaving church is a timing point like any other. Filled in here rather
       than asked of the phone, so a handset on an older build still lands a
       proper departure row and the times come from the tab the coordinator
       edits. */
    if (!stop && kind === "start" && depart) { stop = depart; stopId = depart.id; }

    /* Early or late is from the time the passenger was given when they
       booked, where somebody booked; otherwise from the timetable now. */
    const anchor = stop ? (promised[stopId] || stop.time) : "";
    const sched = anchor ? londonMoment(key, anchor) : null;
    const off = sched ? Math.round((at - sched.getTime()) / 60000) : null;

    /* Built from parts, because a run can be two things at once. A cover
       driver who also had no walkaround on record used to land as whichever
       of the two the ladder reached first, and the other fact was simply
       gone. */
    let status;
    if (rehearsing) {
      status = "Rehearsal";
    } else if (kind === "start") {
      /* More than one fact at a time. A run can be unchecked AND driven by
         cover, and the ladder this replaced would record whichever it reached
         first and lose the other.

         The order here is readability and nothing more. Apps Script reads this
         column with a CONTAINS test (Code.gs v1.56.0 onward), so putting Cover
         first would change nothing. That was not true of v1.55.0 and earlier,
         which used a prefix test: on those, anything in front of the word made
         an unchecked run stop counting as unchecked, silently, in the one
         report that exists to count them. If the Apps Script side is ever
         rolled back past v1.56.0, this line has to lead with Unchecked again. */
      const bits = [];
      if (Number(ev.unchecked) === 2) bits.push("Unchecked (offline)");
      else if (ev.unchecked) bits.push("Unchecked");
      if (isCover) bits.push("Cover");
      status = bits.length ? bits.join(", ") : "Logged";
    } else if (kind === "end" && ev.auto) {
      /* The app closed this one itself, back inside the church fence. Worth
         saying on the record: an arrival time nobody typed is a different
         fact from one somebody did, and a week of them is how you find out
         whether the fence is in the right place. */
      status = "Logged (auto)";
    } else {
      status = "Logged";
    }

    /* Only the start row carries a bus assignment and a position. Every other
       row would be repeating the first or tracking the bus, and neither is
       wanted — this app says it does not track between checks and it does not. */
    let geo = "", acc = null, away = null;
    if (kind === "start") {
      const g = ev.geo || null;
      if (g && typeof g.lat === "number" && typeof g.lng === "number") {
        geo = g.lat.toFixed(6) + ", " + g.lng.toFixed(6);
        acc = typeof g.acc === "number" ? g.acc : null;
        away = typeof g.away === "number" ? g.away : null;
      } else if (g && g.why) {
        /* Why there is no fix, where the fix would have been. A blank cell
           and a refused one are different facts. */
        geo = String(g.why);
      }
    }

    stmts.push(env.DB.prepare(
      "INSERT INTO trip_events (trip, sunday, route, driver, reg, rota_bus, event, stop_id, stop, " +
      "scheduled, happened, off_min, status, geo, acc, away, logged, synced) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0) " +
      /* The retry, handled by the index rather than by a lock.

         DO NOTHING was not quite enough, and the hole only shows after an
         Undo. Undo does not delete the row, it marks it Undone, which is
         right: a driver who taps and untaps four times should leave a trace.
         But the row is still there, so the NEXT tap on that same stop
         conflicted with it and was quietly dropped. The phone showed the stop
         marked, because it marks it locally, and the record showed it Undone
         for ever. Undo then re-mark is not a rare sequence: it is what a man
         does the moment he realises he tapped the wrong kerb.

         The WHERE is what keeps the retry behaviour exactly as it was. A live
         row is still left alone, so a phone resending the same tap five times
         changes nothing. Only a row somebody has taken back can be revived,
         and reviving it is the whole point. */
      "ON CONFLICT(trip, event, stop_id) DO UPDATE SET " +
      "happened=excluded.happened, scheduled=excluded.scheduled, off_min=excluded.off_min, " +
      "status=excluded.status, " +
      "logged=excluded.logged, geo=excluded.geo, acc=excluded.acc, " +
      "away=excluded.away, synced=0 " +
      "WHERE trip_events.status='Undone'"
    ).bind(trip, key, route, who, reg, kind === "start" ? wantBus : "", kind, stopId,
           stop ? stop.stop : "", anchor, at, off, status,
           geo, acc, away, Date.now()));
    written++;
  }

  if (stmts.length) await env.DB.batch(stmts);

  /* WHO ENDED IT, on the end row itself.

     Written separately rather than as another column on the insert above, so
     a database that has not been given the column yet still files every tap
     of the morning. The name is the whole point of the column: for an
     ordinary end it is the driver's own and says nothing new, and for a run
     closed by a coordinator it is the only place the record says so. */
  if (endsHere && events.some((e) => String(e.event || "").trim().toLowerCase() === "end")) {
    const by = String(payload.endedBy || who || "").trim();
    if (by) {
      try {
        await ensureTripCols(env);
        await env.DB.prepare(
          "UPDATE trip_events SET ended_by=?, synced=0 WHERE trip=? AND event='end' AND ended_by=''"
        ).bind(by, trip).run();
      } catch (e) { /* an older database; the row itself is safely filed */ }
    }
  }

  /* WOKEN AFTER THE RECORD IS SAFE, NEVER BEFORE.

     Everything above this line is the morning being written down. Everything
     below is a courtesy on top of it, and it is wrapped so that a push service
     having a bad minute cannot cost a driver his stop tap. A tap recorded and
     not announced is a small problem; a tap announced and not recorded is the
     kind that loses a Sunday. */
  try {
    if (!rehearsing) {
      const marked = {};
      const done = await env.DB.prepare(
        "SELECT stop_id FROM trip_events WHERE trip=? AND status<>'Undone'").bind(trip).all();
      for (const r of (done.results || [])) marked[r.stop_id] = 1;

      for (const ev of events) {
        const kind = String(ev.event || "").trim().toLowerCase();
        if (kind === "start") {
          await wakeDeparture(env, key, route, stops, null);
        } else if (isStopTap(kind)) {
          await wakeAfterTap(env, key, route, all, stops, String(ev.stopId || "").trim(), marked);
        }
      }
    }
  } catch (e) { /* the record is written; this was only the courtesy */ }

  return json({ ok: true, written, undone, endIgnored });
}

/* ==========================================================================
   A ROTA REQUEST, TAKEN HERE FIRST
   ==========================================================================

   From w2.17.0 a driver asking for a swap or for cover is answered here, in
   a fraction of a second, and the request reaches the Rota Requests tab a few
   seconds later by the same knock and drain as a booking. Apps Script files
   it with the same function it always has, so the row, the Change requested
   status and the coordinator's email are exactly what they were.

   It was the last thing a phone wrote that went to Apps Script first. The
   driver waited up to ten seconds for a cold start, and a request that the
   phone did not hear back about was checked by asking the sheet again.

   The id is made on the phone, so a retry is the same row, and the sheet
   drops a second copy of an id it already holds. That covers the phone
   falling back to Apps Script after this server had in fact taken it.

   The checks are the sheet's own two: a Sunday and a name, and not a Sunday
   that has passed. Everything else is the coordinator's to judge. */
let requestsReady = false;
async function ensureRequests(env) {
  if (requestsReady) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS requests (" +
    "  id       TEXT PRIMARY KEY," +
    "  sunday   TEXT NOT NULL," +
    "  driver   TEXT NOT NULL DEFAULT ''," +
    "  type     TEXT NOT NULL DEFAULT ''," +
    "  body     TEXT NOT NULL," +
    "  received INTEGER NOT NULL," +
    "  synced   INTEGER NOT NULL DEFAULT 0)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS requests_sync ON requests(synced)").run();
  requestsReady = true;
}

async function handleRotaRequest(env, rq) {
  const r = rq || {};
  const date = anyToKey(r.date);
  const driver = String(r.driver || "").trim().slice(0, 80);
  if (!date || !driver) return json({ ok: false, error: "incomplete request" });
  if (date < sundayKeyOf(new Date())) return json({ ok: false, error: "that Sunday has already passed" });

  let id = String(r.id || "").trim();
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id)) id = "rq" + Date.now() + "-" + newToken().slice(0, 6);
  const clean = {
    id: id, date: date, driver: driver,
    type: String(r.type || "").slice(0, 60),
    reason: String(r.reason || "").slice(0, 1000),
    swapWith: String(r.swapWith || "").trim().slice(0, 80),
    swapDate: anyToKey(r.swapDate) || "",
    agreed: !!r.agreed
  };

  await ensureRequests(env);
  const res = await env.DB.prepare(
    "INSERT OR IGNORE INTO requests (id, sunday, driver, type, body, received) VALUES (?,?,?,?,?,?)"
  ).bind(id, date, driver, clean.type, JSON.stringify(clean), Date.now()).run();
  const dup = !!(res && res.meta && typeof res.meta.changes === "number" && res.meta.changes === 0);
  return json(dup ? { ok: true, duplicate: true, id: id } : { ok: true, id: id });
}

/* ==========================================================================
   SYNC — the spreadsheet's half
   ========================================================================== */

/* CLEARING A SUNDAY THAT HAS NOT BEEN DRIVEN YET.

   There was no way to do this, and on 23 September at three in the morning
   there needed to be. A rehearsal had run while this server still believed it
   was an ordinary night — the flag never reached it — so every tap went in as
   a REAL run on the real Sunday, and the only way out was a SQL console.

   TWO GUARDS, AND THEY ARE THE WHOLE SAFETY OF IT.

   A SUNDAY IN THE PAST IS HISTORY AND IS NEVER TOUCHED. Not by a mistyped
   date, not by a stale menu, not by anything. A morning that has been driven
   is the record of people who were actually carried, and nothing in this file
   may delete that.

   AND IT REFUSES WHILE A RUN IS OPEN. Clearing the morning out from under a
   driver who is between two stops would leave him tapping into nothing.

   Asked for by name, one Sunday at a time, and it answers with what it did
   rather than ok:true — the spreadsheet reads those numbers back to whoever
   pressed the button. */
async function handleClearTrips(env, body) {
  const key = String((body && body.sunday) || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return json({ ok: false, error: "no Sunday named" });

  const today = sundayKeyOf(new Date());
  /* Once its cutoff has passed as well. On a Sunday afternoon the Sunday
     "still ahead" is today, and its morning has been driven. */
  if (key < today || bookingsClosed(key)) {
    return json({ ok: false, error: "that Sunday has been and gone, and its record stays" });
  }

  /* A run that started and has not ended. tripState is asked per route
     because that is where the one-run-at-a-time rule lives. */
  for (const route of ["North", "South"]) {
    /* Real and rehearsal both: this clears every tap on the Sunday. */
    for (const mode of ["real", "rehearsal"]) {
      let t = null;
      try { t = await tripState(env, key, route, mode); } catch (e) {}
      if (t && t.started && !t.ended) {
        return json({ ok: false, error: "the " + route + " run is still open. End it first." });
      }
    }
  }

  const before = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM trip_events WHERE sunday = ?").bind(key).first();
  const seats = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM bookings WHERE sunday = ? AND lower(status) = 'rehearsal'"
  ).bind(key).first();

  await env.DB.batch([
    env.DB.prepare("DELETE FROM trip_events WHERE sunday = ?").bind(key),
    env.DB.prepare("DELETE FROM bookings WHERE sunday = ? AND lower(status) = 'rehearsal'").bind(key)
  ]);

  return json({ ok: true, sunday: key,
                trips: Number(before && before.n) || 0,
                seats: Number(seats && seats.n) || 0 });
}

async function handleSync(env, body) {
  const stmts = [];

  if (Array.isArray(body.stops)) {
    /* THE COLUMNS FIRST, AND THIS IS THE LINE THAT WAS MISSING.

       22 September 2026, on the deployment itself:

         D1_ERROR: table stops has no column named lat: SQLITE_ERROR

       ensureTripCols adds lat and lng, and every call to it sat inside
       handleTrip, guarded on a run ENDING. On a live database that had never
       run this version, the sync reached these columns FIRST — every five
       minutes, before any driver had ended anything — and there was no path
       by which they could exist yet. The one place that needed the migration
       most was the one place that never asked for it.

       It could not be caught by the suite as it stood, either: every test
       database is built from schema.sql, which already has the columns, so
       the migration had nothing to migrate. There is now a database built
       WITHOUT them, and this exact sync is run against it.

       AND THE TIMETABLE STILL GOES EVEN IF THE COLUMN CANNOT BE ADDED. A
       stop's coordinates are a convenience — they sharpen an estimate. Its
       TIME is not: without it the driver has no list and the passenger has no
       bus. The whole sync is one batch, and a batch that fails writes nothing
       at all, so one refused column would have cost the morning its
       timetable. Asked rather than assumed, and the insert narrows to match.

       Same bargain as writeCheckToday makes for check_id. */
    const pins = await ensureStopPins(env);

    stmts.push(env.DB.prepare("DELETE FROM stops"));
    body.stops.forEach((s, i) => {
      const kind = s.depart ? "depart" : s.arrival ? "arrival" : "pickup";
      const common = [s.id, s.route, s.time, s.stop, s.postcode || "", s.where || "", kind, i];
      stmts.push(pins
        ? env.DB.prepare(
            "INSERT INTO stops (stop_id, route, time, stop, postcode, place, kind, seq, lat, lng) " +
            "VALUES (?,?,?,?,?,?,?,?,?,?)"
          /* Blank stays blank. See the note on stops.lat in schema.sql: zero
             is a real place and it is not this one. */
          ).bind(...common, numOrNull(s.lat), numOrNull(s.lng))
        : env.DB.prepare(
            "INSERT INTO stops (stop_id, route, time, stop, postcode, place, kind, seq) " +
            "VALUES (?,?,?,?,?,?,?,?)"
          ).bind(...common));
    });
  }
  /* THE TEST BOOKINGS A REHEARSAL DRAWS, and the flag, came from the sheet
     until w2.20.0, and are ignored now. This server owns the rehearsal, and a
     sheet a version behind would otherwise end one on every sync: its push
     said "no rehearsal" whenever its own copy said so. */

  if (Array.isArray(body.buses)) {
    /* The dates and the pairing, when this sheet sends them (v1.87.0 on). */
    if (body.buses.some((b) => b && (b.dates || b.oddRoute !== undefined))) {
      const extra = {};
      for (const b of body.buses) {
        if (!b || !b.reg) continue;
        const d = b.dates || {};
        const day = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "";
        const r = String(b.oddRoute || "");
        extra[String(b.reg).toUpperCase()] = {
          dates: { mot: day(d.mot), service: day(d.service), insurance: day(d.insurance), permit: day(d.permit) },
          oddRoute: r === "North" || r === "South" ? r : ""
        };
        /* From v1.98.0, for the coordinator's Buses screen. Longer than the
           app takes, they are left to the tab (notesCut), so a save from the
           app cannot write a shortened copy over them. */
        if (typeof b.notes === "string") {
          extra[String(b.reg).toUpperCase()].notes = b.notes.slice(0, 500);
          if (b.notes.length > 500) extra[String(b.reg).toUpperCase()].notesCut = true;
        }
      }
      stmts.push(cachePut(env, "bus_extra", extra));
    }
    stmts.push(env.DB.prepare("DELETE FROM buses"));
    for (const b of body.buses) stmts.push(env.DB.prepare(
      "INSERT INTO buses (reg, seats, active) VALUES (?,?,?)"
    ).bind(b.reg, Number(b.seats) || 0, b.active === false ? 0 : 1));
  }
  if (Array.isArray(body.drivers)) {
    stmts.push(env.DB.prepare("DELETE FROM drivers"));
    for (const d of body.drivers) stmts.push(env.DB.prepare(
      "INSERT INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,?,?)"
    ).bind(d.name, d.role || "", d.route || "North", Number(d.order) || 0,
           d.active === false ? 0 : 1, String(d.pinHash || "")));
  }
  if (Array.isArray(body.rota)) {
    for (const r of body.rota) stmts.push(env.DB.prepare(
      "INSERT INTO rota (sunday, north, north_cover, north_bus, south, south_cover, south_bus, status, notes) " +
      "VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(sunday) DO UPDATE SET " +
      "north=excluded.north, north_cover=excluded.north_cover, north_bus=excluded.north_bus, " +
      "south=excluded.south, south_cover=excluded.south_cover, south_bus=excluded.south_bus, " +
      "status=excluded.status, notes=excluded.notes"
    ).bind(r.date, r.primary || "", r.actual || "", r.northBus || "",
           r.primary2 || "", r.actual2 || "", r.southBus || "", r.status || "", r.notes || ""));
  }
  /* Checks, one at a time and each fenced, BEFORE the batch rather than in
     it: a fault writing one bus's row must not cost the stops, the rota and
     the drivers. A check this server has seen takes the time it was made
     from its own record; the day follows from that time. */
  if (Array.isArray(body.checks)) {
    if (body.checks.length) { try { await ensureChecksIn(env); } catch (e) {} }
    for (const c of body.checks) {
      try {
        const look = await canonicalLookup(env, c.id);
        if (look.failed) continue;
        const at = look.known ? look.at : (Number(c.at) || 0);
        const day = look.known ? londonKey(new Date(at)) : String(c.day || "");
        await writeCheckToday(env, c.reg, day, c.state, at, c.driver || "", c.id);
      } catch (e) {}
    }
  }
  /* THE WAY BACK TO THE SPREADSHEET.

     Everything else on this server is downstream of the sheet: it is told
     things and it answers phones. This one setting lets it knock on the door
     it is normally only ever called from, which is what makes a rota decision
     land in seconds instead of somewhere in the next five minutes.

     Only ever overwritten by a sync that carries one. A sheet deployed at a
     new address sends the new one; a sheet that cannot work out its own
     address sends "", and the old one is kept rather than thrown away, since
     a stale address that might still work beats no address at all. Either
     way the drain is underneath it. */
  if (typeof body.sheetUrl === "string" && body.sheetUrl.indexOf("/exec") > -1) {
    stmts.push(cachePut(env, "sheet_url", { url: body.sheetUrl }));
  }

  /* Who may authorise a bus, and whether one pair of hands may do both ends
     of it. Kept on the spreadsheet so the rule lives where the roles do. */
  if (body.authRules) {
    stmts.push(cachePut(env, "auth_rules", {
      roles: Array.isArray(body.authRules.roles) ? body.authRules.roles : [],
      sameHandBothWays: body.authRules.sameHandBothWays !== false
    }));
  }

  /* How the estimate treats a stop the bus is passing. Kept on the
     spreadsheet for the same reason as the rules above: config.js is the file
     a person edits, and a number the passenger sees must not be able to
     differ from the number the driver sees. */
  if (body.passengerRules) {
    stmts.push(cachePut(env, "passenger_rules", {
      resendMinutes:  Number(body.passengerRules.resendMinutes),
      morningMessage: body.passengerRules.morningMessage !== false,
      quietFrom:      Number(body.passengerRules.quietFrom),
      quietTo:        Number(body.passengerRules.quietTo)
    }));
  }
  if (body.bookingRules) {
    stmts.push(cachePut(env, "booking_rules", body.bookingRules));
  }
  if (body.etaRules) {
    /* A field an older sheet does not send stays undefined here, and
       etaSettings falls back to its own default for it rather than to 0. */
    const numOr = (v) => (v === undefined || v === null || v === "") ? undefined : Number(v);
    stmts.push(cachePut(env, "eta_rules", {
      dwellSeconds:   Number(body.etaRules.dwellSeconds),
      skipSaves:      Number(body.etaRules.skipSaves),
      speedMph:       Number(body.etaRules.speedMph),
      maxSkipMinutes: Number(body.etaRules.maxSkipMinutes),
      maxBehindMinutes: numOr(body.etaRules.maxBehindMinutes),
      keepMinutes:    numOr(body.etaRules.keepMinutes)
    }));
  }

  /* Who people ring. Same rule as the version below: an older sheet that does
     not send it leaves the last one alone. A sheet with nobody in the role
     sends a blank name, and that is stored, because it is an answer. */
  let coordSent = null;
  if (body.coordinator && typeof body.coordinator === "object") {
    coordSent = coordinatorOf(body.coordinator);
    stmts.push(cachePut(env, "coordinator", coordSent));
  }

  /* The drivers' WhatsApp numbers, from w2.28.0, for the passenger's Message
     button. Same rule again: an older sheet that does not send them leaves
     the last ones alone, and an empty list is an answer and is stored, so a
     number taken off the Drivers tab stops being handed out. */
  if (body.driverWa && typeof body.driverWa === "object") {
    stmts.push(cachePut(env, "driver_wa", driverWaOf(body.driverWa)));
  }

  /* Told, never guessed. An older Apps Script that does not send it leaves
     whatever was last stored alone, so a partial deploy blanks nothing.

     Only the statement is queued here. The isolate's own copy is not touched
     until the batch has actually committed, below. */
  let sheetSent = "";
  if (body.sheet) {
    sheetSent = String(body.sheet).slice(0, 24);
    stmts.push(env.DB.prepare(
      "INSERT INTO settings (k,v) VALUES ('sheet_version',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v"
    ).bind(sheetSent));
  }


  /* The two answers Apps Script builds and this Worker only hands back.

     Deliberately NOT reimplemented here. The rota is not a table, it is a
     computation: a repeating pattern filled in for every Sunday nobody has
     written down, swaps parsed out of a Notes cell, protected Sundays, open
     defects, the driver register. Porting that would mean two implementations
     of one rota, in two languages, kept in step by hand for ever — and the
     day they disagree, the app and the spreadsheet would each be certain and
     one of them wrong.

     So Apps Script stays the only place that knows how a rota is built, and
     this is a shelf to put the finished answer on. */
  if (body.cache && typeof body.cache === "object") {
    const at = Number(body.cache.builtAt) || Date.now();
    if (body.cache.rota) {
      stmts.push(cachePut(env, "cache_rota", {
        builtAt: at,
        from: String(body.cache.from || ""),
        to:   String(body.cache.to   || ""),
        payload: body.cache.rota
      }));
    }
    if (body.cache.last) {
      stmts.push(cachePut(env, "cache_last", { builtAt: at, payload: body.cache.last }));
    }
  }

  /* WHAT THE COORDINATOR'S APP READS THAT THE PUBLIC ROTA DOES NOT: the
     requests with their reasons, and the open defects with what has been
     done so far. Kept apart from cache_rota because that one is served to
     anybody who asks, and these are only ever handed out under a PIN. */
  if (body.coordShelf && typeof body.coordShelf === "object") {
    stmts.push(cachePut(env, "coord_shelf", {
      builtAt: Date.now(),
      readAt: Number(body.coordShelf.readAt) || Date.now(),
      requests: Array.isArray(body.coordShelf.requests) ? body.coordShelf.requests : [],
      defects: Array.isArray(body.coordShelf.defects) ? body.coordShelf.defects : [],
      /* From v1.97.0: the Drivers tab, with no PIN in it. Missing from an
         older sheet, which leaves the Drivers screen to the drivers table. */
      drivers: Array.isArray(body.coordShelf.drivers) ? body.coordShelf.drivers : null,
      driverRoles: Array.isArray(body.coordShelf.driverRoles) ? body.coordShelf.driverRoles : null,
      /* From v1.98.0: every row on the Bus Stops tab, switched-off ones too. */
      stops: Array.isArray(body.coordShelf.stops) ? body.coordShelf.stops : null,
      vehicles: vehiclesShelfOf(body.coordShelf.vehicles)
    }));
  }

  if (stmts.length) await env.DB.batch(stmts);

  /* THE COORDINATOR'S ACTIONS THIS COPY INCLUDES. The sheet names them,
     read before it read a single tab, so a name here means the copy that
     just landed has it and the overlay can stop. In chunks: D1 takes a
     hundred bound values to a statement. */
  if (Array.isArray(body.coordApplied) && body.coordApplied.length) {
    try {
      await ensureCoord(env);
      const ids = body.coordApplied.map((x) => String(x || "")).filter((x) => /^[A-Za-z0-9_.-]{1,64}$/.test(x));
      for (let i = 0; i < ids.length; i += 90) {
        const part = ids.slice(i, i + 90);
        await env.DB.prepare("UPDATE coord_actions SET seen=1 WHERE seen=0 AND id IN (" +
                             part.map(() => "?").join(",") + ")").bind(...part).run();
      }
    } catch (e) {}
  }
  /* The rota rows just written are the sheet's. Anything the coordinator did
     that they do not include yet goes back over them. */
  if (Array.isArray(body.rota)) {
    try { await reapplyRawRota(env); } catch (e) {}
    try { await reapplyDrivers(env); } catch (e) {}
  }
  if (Array.isArray(body.stops)) {
    try { await reapplyStops(env); } catch (e) {}
  }

  /* AFTER THE BATCH, AND ONLY AFTER IT.

     batch() is one transaction: a duplicate name on the Drivers tab, a
     repeated stop id, a bad minute at D1, and nothing is committed at all.
     Set before the await, this isolate would hold a version the database
     does not have, stamp it on the very reply that says the sync FAILED, and
     go on stamping it on every answer for the next five minutes, because the
     timestamp went with it. The two apps print what they are told, so the
     version line would confirm a deploy that did not land. That line exists
     to be believed.

     Below the await it is only ever set from a batch that committed. */
  if (sheetSent) {
    sheetVersion = sheetSent;
    sheetVersionAt = Date.now();
  }
  if (coordSent) coordinator = coordSent;
  if (body.authRules) {
    const sent = rolesOf(body.authRules.roles);
    if (sent) leadRoles = sent;
  }
  return json({ ok: true, applied: stmts.length });
}

/* ==========================================================================
   THE SHELF
   ==========================================================================

   Two calls used to go to Apps Script on the way in to the driver's app: the
   rota and last week's mileage. Measured on the real project they took
   between five and ten and a half seconds EACH, at three in the morning with
   nothing else running, so it was never load — it is what a cold Apps Script
   container costs before a line of the work begins.

   They are reads. Nothing a driver does depends on them being a second old,
   and the spreadsheet re-publishes them whenever anything changes and hourly
   regardless. So they are built there, kept here, and served from here.

   Two rules make that safe, and both matter more than the speed:

     1. NOTHING IS SERVED THAT IS TOO OLD. A cache that quietly keeps handing
        out last Tuesday's rota because the push started failing is worse than
        a slow app, because it is confident and it is wrong. Past the age
        limit this refuses and says so.

     2. A REFUSAL IS NOT AN ERROR. It answers ok:false with a reason, and the
        app's job on seeing that is to ask Apps Script directly — slow, but
        right. Every path through here ends either in a fresh answer or in a
        clean handover.

   Six hours: comfortably longer than the hourly push, comfortably shorter
   than the gap between a Saturday edit and a Sunday morning. */
const CACHE_MAX_AGE_MS = 6 * 3600 * 1000;

function cachePut(env, k, obj) {
  return env.DB.prepare(
    "INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v"
  ).bind(k, JSON.stringify(obj));
}

async function cacheGet(env, k) {
  const row = await env.DB.prepare("SELECT v FROM settings WHERE k = ?").bind(k).first();
  if (!row || !row.v) return null;
  try { return JSON.parse(row.v); } catch (e) { return null; }
}

/* A date key, n weeks on. Noon UTC on purpose: these are calendar dates, not
   moments, and starting from midnight puts the arithmetic one hour from a
   clocks-change boundary twice a year for no reason at all. */
function keyPlusWeeks(key, n) {
  const d = new Date(String(key) + "T12:00:00Z");
  if (isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + 7 * Number(n || 0));
  return d.toISOString().slice(0, 10);
}

async function cachedRota(env, from, weeks) {
  const c = await cacheGet(env, "cache_rota");
  if (!c || !c.payload) return { ok: false, cache: "none" };

  const age = Date.now() - (Number(c.builtAt) || 0);
  if (age > CACHE_MAX_AGE_MS) {
    return { ok: false, cache: "stale", ageMin: Math.round(age / 60000) };
  }

  const want = String(from || "").trim() || String(c.from || "");
  const n = Math.max(1, Math.min(520, Number(weeks) || 1));
  const wantTo = keyPlusWeeks(want, n);
  if (!want || !wantTo) return { ok: false, cache: "badwindow" };

  /* Asking for something the shelf does not hold — usually somebody scrolling
     further back through the history than the push carries. Handed over
     rather than answered short, because a rota that silently stops in
     February looks like a rota with nothing in it. */
  if (want < String(c.from || "") || wantTo > String(c.to || "")) {
    return { ok: false, cache: "window", has: { from: c.from, to: c.to } };
  }

  const out = Object.assign({}, c.payload);
  out.rows = (c.payload.rows || []).filter((r) => r.date >= want && r.date <= wantTo);
  out.from = want;
  out.weeks = n;

  /* REQUESTS THE SHEET HAS NOT FILED YET, laid onto the shelf's rows.

     A request is taken here first and reaches the Rota Requests tab a few
     seconds later; the shelf is rebuilt after that. In between, a rota read
     from any phone would show the Sunday with no request on it, and the
     driver could ask a second time. So a request still waiting, or filed
     since the shelf was built, is added to its Sunday exactly as the sheet
     will show it: Pending, and the Sunday marked Change requested unless it
     has been called off. */
  try {
    await ensureRequests(env);
    const q = await env.DB.prepare(
      "SELECT sunday, driver, type FROM requests WHERE synced<>1 OR received>?")
      .bind(Number(c.builtAt) || 0).all();
    for (const r of (q.results || [])) {
      const row = out.rows.find((x) => x.date === r.sunday);
      if (!row) continue;
      const list = (row.requests || []).slice();
      if (list.some((x) => sameName(x.driver, r.driver))) continue;
      list.push({ driver: r.driver, type: r.type, status: "Pending" });
      row.requests = list;
      if (!row.request) row.request = list[0];
      if (!/cancel/i.test(String(row.status || ""))) row.status = "Change requested";
    }
  } catch (e) { /* the shelf as it stands */ }

  /* THE COORDINATOR'S CHANGES THE SHEET HAS NOT SENT BACK YET, laid over the
     rows the same way, so a Sunday he has just changed reads changed on
     every phone at once. See THE COORDINATOR'S APP. */
  try { await coordOverlayShelf(env, out); } catch (e) { /* the shelf as it stands */ }

  /* The one part NOT served from the shelf. Bookings live in this database
     now, so the counts can be read live — which makes them fresher here than
     they were on the spreadsheet, where they were as old as the payload. */
  try {
    const key  = runSunday();
    const rows = await liveBookings(env, key);
    out.stopCounts = bookingCounts(rows);
    out.stopCountsFor = key;
  } catch (e) { /* keep whatever the payload carried */ }

  out.ok = true;
  out.cache = "worker";
  out.builtAt = c.builtAt;
  return out;
}

async function cachedLast(env) {
  const c = await cacheGet(env, "cache_last");
  if (!c || !c.payload) return { ok: false, cache: "none" };

  const age = Date.now() - (Number(c.builtAt) || 0);
  if (age > CACHE_MAX_AGE_MS) {
    return { ok: false, cache: "stale", ageMin: Math.round(age / 60000) };
  }

  const out = Object.assign({}, c.payload);

  /* Mileage comes off the shelf; which bus is on which route, and how full it
     is, are worked out here and now. They ride on this call because it is the
     one the driver app makes at launch, and a driver choosing a vehicle needs
     them before the picker, not after it. */
  try {
    const all    = await getStops(env);
    const stops  = pickupsAndArrivals(all);
    const key    = runSunday();
    const rows   = await liveBookings(env, key);
    const buses  = await getBuses(env);
    const rotaRow = await getRotaRow(env, key);
    const seats  = {};
    for (const rt of routeNames(stops)) {
      seats[rt] = await seatsFor(env, key, rt, stops, buses, rotaRow, rows);
    }
    out.seats = seats;
    out.buses = buses.map((b) => ({ reg: b.reg, seats: b.seats, dates: b.dates || {} }));
  } catch (e) { out.seatsError = String(e); }

  out.ok = true;
  out.cache = "worker";
  out.builtAt = c.builtAt;
  return out;
}

/* ==========================================================================
   THE WALKAROUND, WRITTEN HERE FIRST
   ==========================================================================
   20 September 2026. The check used to be posted straight at Apps Script and
   waited on. It took long enough at a kerb to time out, the driver was shown
   "Held on this phone", and it only went through when he gave up and moved to
   Start trip, which happened to flush the queue.

   So it lands here now, the same way stop taps have since v1.5: written, the
   board updated, an answer in well under a second, and Apps Script picks it
   off the shelf on the five minute drain. THE SPREADSHEET IS STILL THE
   RECORD. It has stopped being the thing a man waits for.

   The whole check goes into one text column rather than twenty five of them.
   Nothing here reads the inside of a check; the only two facts this server
   needs are which bus and whether it stopped, and those are lifted out. The
   tab on the spreadsheet is what a person reads, and Apps Script already
   knows how to write it. A column here per field would be a second schema to
   keep in step with the first, for no reader. */

/* Created on demand rather than by hand in a console. The coordinator deploys
   this file from a dashboard and has never had to paste SQL to get a release
   out; making him start now would be the sort of step that gets skipped on a
   Saturday night. Once per isolate, not once per call. */
/* ONE ROW PER BUS, AND IT IS THE LATEST WALKAROUND. NOTHING ELSE MAY MOVE IT.

   Three things restate checks as a matter of course: the drain filing a
   check on the sheet a few minutes after it arrived, the unawaited call to
   Apps Script, and a phone retrying a send it never saw the answer to. Every
   one of them can arrive after something newer has happened to that bus: a
   coordinator's signature, or a second walkaround from another phone. Told
   with the time it ARRIVED, an old check looked like a new one and either
   put a signed-off bus back in the yard or let a bus out that a later
   walkaround had stopped.

   So a check has one time, the moment a server first saw it (canonicalAt),
   and this statement only lets a check replace the row when it is:
     the same check again   state may change (the Outcome cell), time stays
     at least as new        a genuinely later walkaround
     for a later day        yesterday's row is not a rival to today's
     without an id          an older copy of Apps Script; behaves as before
   A different, older check is ignored, and so is anything for an EARLIER day
   than the row already holds: yesterday's walkaround, flushed this morning
   from a phone that had no signal last night, does not describe today's bus. */
/* The same check told again changes NOTHING about the row: not its time and
   not its state either. Its state may have been corrected on the sheet since
   (STOPPED on a check that said ok, or the reverse), and the phone resending
   its original answer must not put the original back. Only the Outcome
   action changes the state of a check that is already here. */
const SAME_CHECK = "(excluded.check_id <> '' AND checks_today.check_id = excluded.check_id)";
const CHECKS_TODAY_UPSERT =
  "INSERT INTO checks_today (reg, day, state, at, driver, check_id) VALUES (?,?,?,?,?,?) " +
  "ON CONFLICT(reg) DO UPDATE SET day=excluded.day, " +
  "state=CASE WHEN " + SAME_CHECK + " THEN checks_today.state ELSE excluded.state END, " +
  "driver=CASE WHEN " + SAME_CHECK + " THEN checks_today.driver ELSE excluded.driver END, " +
  "at=CASE WHEN " + SAME_CHECK + " THEN checks_today.at ELSE excluded.at END, " +
  "check_id=excluded.check_id " +
  "WHERE excluded.day > checks_today.day " +
  "   OR (excluded.day = checks_today.day AND (excluded.check_id = '' " +
  "       OR checks_today.check_id = excluded.check_id OR excluded.at >= checks_today.at))";

/* When a server first saw this check. The Worker's own receipt if it has
   one, which is the earliest any server knew of it; otherwise the time it
   was offered with. Never a phone's clock. */
async function canonicalAt(env, id, fallback) {
  const r = await canonicalLookup(env, id);
  return r.known ? r.at : fallback;
}

/* The same question, saying whether it could be asked at all. A database
   fault is not "this server never saw it": a drained check carries the age it
   was first sent with, minutes stale by now, and timing it from that would
   let it replace a newer walkaround. The caller that files it again leaves
   the row alone instead. */
async function canonicalLookup(env, id) {
  if (!id) return { known: false, failed: false };
  try {
    const r = await env.DB.prepare("SELECT received FROM checks_in WHERE check_id=?")
      .bind(String(id)).first();
    if (r && Number(r.received)) return { known: true, at: Number(r.received) };
    return { known: false, failed: false };
  } catch (e) {
    return { known: false, failed: true };
  }
}

/* The rule as it stood before, for the one case where the column the new
   rule needs does not exist. writeCheckToday below falls back to it only when
   the database says so. With no column there are no check names to go stale,
   so the old rule is right there, if blunter. */
const CHECKS_TODAY_UPSERT_OLD =
  "INSERT INTO checks_today (reg, day, state, at, driver) VALUES (?,?,?,?,?) " +
  "ON CONFLICT(reg) DO UPDATE SET day=excluded.day, state=excluded.state, " +
  "at=excluded.at, driver=excluded.driver";

/* Written one statement at a time, never inside the sync's batch, so a
   fault here cannot cost the stops, the rota or the drivers.

   The full statement first, always. The old one only when the database
   answers that the column does not exist, which is the one case where it is
   right: with no column there are no names to go stale. Deciding once and
   caching the answer was the fault in the first version: one failed probe
   and an isolate wrote with the old statement for its whole life, leaving a
   row named after a check it no longer held, which a signature for that
   earlier check would then have lifted. */
async function writeCheckToday(env, reg, day, state, at, driver, id) {
  try {
    await env.DB.prepare(CHECKS_TODAY_UPSERT)
      .bind(reg, day, state, at, driver, String(id || "")).run();
  } catch (e) {
    if (!/no such column|has no column/i.test(String(e && e.message || e))) throw e;
    await env.DB.prepare(CHECKS_TODAY_UPSERT_OLD).bind(reg, day, state, at, driver).run();
  }
}

/* How long ago the phone says the check was made, by its own clock, which is
   good for a DURATION even when it is wrong about the time of day. Never
   negative, never more than a week. */
function checkAge(check) {
  const a = Number(check && check.age);
  if (!(a > 0)) return 0;
  return Math.min(a, 7 * 86400000);
}

let tripColsReady = false;

/* THE COLUMNS v1.71.0 ADDS, PUT THERE BY THE WORKER ITSELF.

   Same bargain as check_id in v1.70.0: a database built from schema.sql
   already has them, a live database gets them the first time it is asked to
   do something that needs them, and neither case has a console step. The
   isolate is only marked ready once the columns are SEEN to be there, so a
   failure is tried again on the next call rather than remembered as done. */
async function ensureTripCols(env) {
  if (tripColsReady) return;
  for (const sql of [
    "ALTER TABLE trip_events ADD COLUMN ended_by TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE stops ADD COLUMN lat REAL",
    "ALTER TABLE stops ADD COLUMN lng REAL",
    /* WHAT THIS PHONE WAS LAST TOLD, in minutes-to-your-stop.
       The threshold needs a number to compare against, and the tag cannot
       carry one: a tag is matched for equality, so a minute's drift would
       count as a change and the threshold would never hold anything back. */
    "ALTER TABLE push_subs ADD COLUMN last_eta INTEGER"
  ]) {
    try { await env.DB.prepare(sql).run(); } catch (e) { /* already there */ }
  }
  try {
    await env.DB.prepare("SELECT ended_by FROM trip_events LIMIT 1").all();
    await env.DB.prepare("SELECT lat, lng FROM stops LIMIT 1").all();
    await env.DB.prepare("SELECT last_eta FROM push_subs LIMIT 1").all();
    tripColsReady = true;
  } catch (e) { tripColsReady = false; }
}

/* Can this database hold a kerb. Asked rather than assumed, because the
   answer decides whether the timetable syncs at all: see handleSync. */
async function stopsHavePins(env) {
  try {
    await env.DB.prepare("SELECT lat, lng FROM stops LIMIT 1").all();
    return true;
  } catch (e) {
    return false;
  }
}

/* THE COLUMNS, AND THEN WHETHER THEY ARE ACTUALLY THERE.

   Deliberately NOT ensureTripCols. That one remembers, in a module-level
   flag, that it has already done its work — which is right for a Worker,
   where an isolate serves one database for its whole life, and wrong the
   moment it is not: a remembered yes cannot be checked, and the thing that
   went wrong on the day was precisely a column everybody assumed was there.

   Here the DATABASE is asked, every time, and the answer both decides and
   confirms. The ALTERs only run when the answer is no, so this costs one
   cheap read on every sync after the first and nothing else. */
async function ensureStopPins(env) {
  if (await stopsHavePins(env)) return true;
  for (const sql of ["ALTER TABLE stops ADD COLUMN lat REAL",
                     "ALTER TABLE stops ADD COLUMN lng REAL"]) {
    try { await env.DB.prepare(sql).run(); } catch (e) { /* already there, or refused */ }
  }
  return await stopsHavePins(env);
}

let checksInReady = false;
async function ensureChecksIn(env) {
  if (checksInReady) return;
  /* The column the rule above needs, added to a live database on first use.
     It fails harmlessly once it is there, which is every call after the
     first and every database built from schema.sql. The isolate is only
     marked ready once the column is seen to be there, so a failure is tried
     again on the next call rather than remembered. */
  try {
    await env.DB.prepare(
      "ALTER TABLE checks_today ADD COLUMN check_id TEXT NOT NULL DEFAULT ''").run();
  } catch (e) { /* already there */ }
  let hasColumn = false;
  try {
    await env.DB.prepare("SELECT check_id FROM checks_today LIMIT 1").all();
    hasColumn = true;
  } catch (e) { hasColumn = false; }
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS checks_in (" +
    "  id       INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  check_id TEXT NOT NULL UNIQUE," +
    "  reg      TEXT NOT NULL DEFAULT ''," +
    "  day      TEXT NOT NULL DEFAULT ''," +
    "  level    TEXT NOT NULL DEFAULT 'ok'," +
    "  driver   TEXT NOT NULL DEFAULT ''," +
    "  received INTEGER NOT NULL," +
    "  body     TEXT NOT NULL," +
    "  synced   INTEGER NOT NULL DEFAULT 0)").run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS checks_in_sync ON checks_in(synced)").run();
  checksInReady = hasColumn;
}

async function handleCheck(env, check) {
  if (!check || !check.id) return json({ ok: false, error: "no check" });
  await ensureChecksIn(env);

  const reg   = String(check.reg || "").trim();
  const level = String(check.level || "ok");
  const who   = String(check.driver || "").trim();
  const day   = londonKey(new Date());
  const now   = Date.now();
  /* WHEN THE WALKAROUND WAS DONE, by this server's clock. The phone says how
     long ago, which it can measure correctly even with its date set wrong,
     and that is taken off the time it arrived. A check held on a phone with
     no signal since last night is last night's check, and a check done
     before another one, and sent after it, is still the earlier of the two. */
  const made  = now - checkAge(check);

  /* OR IGNORE, not OR REPLACE. A phone that retries a send it never saw the
     answer to must not overwrite a row Apps Script is in the middle of
     filing, and the check id is made once on the handset, so the retry and
     the original are the same record by definition. */
  /* received holds the time the walkaround was MADE, as worked out above,
     because that is what every comparison with it needs. */
  await env.DB.prepare(
    "INSERT OR IGNORE INTO checks_in (check_id, reg, day, level, driver, received, body) " +
    "VALUES (?,?,?,?,?,?,?)"
  ).bind(String(check.id), reg, day, level, who, made, JSON.stringify(check)).run();

  /* The board, straight away. This used to be pushed by Apps Script AFTER it
     had written the tab, which meant a stopped bus was invisible to every
     other phone for as long as that write took.

     With the check's own first-seen time, so a retry of an old walkaround
     that lands after a newer one is refused by the statement rather than
     restating the old answer as today's. */
  /* Only a check made today speaks for today, and "made" is the server's
     reckoning above, never the phone's date. */
  const at = await canonicalAt(env, check.id, made);
  if (reg && londonKey(new Date(at)) >= day) {
    await writeCheckToday(env, reg, day, level === "stop" ? "stopped" : "ok", at, who, check.id);
  }

  return json({ ok: true, written: 1 });
}

/* What Apps Script has not taken a copy of yet. It marks them done with
   ?action=drained once they are safely on the tab — never before, so a failed
   write means they come round again rather than vanishing. */
/* EVERY COPY HANDED OUT IS STAMPED, AND ONLY AN UNCHANGED ROW IS MARKED DONE.

   27 September 2026, Sedley Street. A passenger cancelled while Apps Script
   was still writing the drain's copy of that row, which still said Booked.
   The Worker saved Cancelled and set synced back to 0. Apps Script then sent
   back the ids it had written and handleDrained marked the row synced=1 by
   id alone, which wiped the cancellation's flag. The Worker said Cancelled,
   the sheet said Booked, and no drain would ever carry it again.

   So the drain claims what it hands out with a stamp of its own, a negative
   number, and handleDrained marks a row done only if it still carries that
   stamp. Any write since then has put synced back to 0, the stamp no longer
   matches, and the row goes out again on the next drain.

   synced < 1 is pending: 0 for a row nobody has claimed, a negative stamp for
   one an earlier drain claimed and never confirmed. A drain that died half
   way leaves its rows to the next one, which claims them again. Writing a
   row to the tab twice is harmless, because Apps Script matches on Live ID.

   An older Code.gs sends no stamp back and gets the old rule. */
function drainClaim() {
  return -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
}

async function handleDrain(env, body) {
  const limit = Math.min(500, Math.max(1, Number(body.limit) || 300));
  const claim = drainClaim();
  await env.DB.batch([
    env.DB.prepare("UPDATE bookings SET synced=? WHERE id IN " +
      "(SELECT id FROM bookings WHERE synced<1 ORDER BY id LIMIT ?)").bind(claim, limit),
    env.DB.prepare("UPDATE trip_events SET synced=? WHERE id IN " +
      "(SELECT id FROM trip_events WHERE synced<1 ORDER BY id LIMIT ?)").bind(claim, limit)
  ]);
  const b = await env.DB.prepare(
    "SELECT * FROM bookings WHERE synced=? ORDER BY id").bind(claim).all();

  /* Rota requests taken here, stamped the same way. Fenced: a database that
     has never taken one has no table until the first arrives. */
  const requests = [];
  try {
    await ensureRequests(env);
    await env.DB.prepare("UPDATE requests SET synced=? WHERE id IN " +
      "(SELECT id FROM requests WHERE synced<1 ORDER BY received LIMIT 50)").bind(claim).run();
    const q = await env.DB.prepare("SELECT body FROM requests WHERE synced=? ORDER BY received").bind(claim).all();
    for (const r of (q.results || [])) { try { requests.push(JSON.parse(r.body)); } catch (e) {} }
  } catch (e) {}
  const t = await env.DB.prepare(
    "SELECT * FROM trip_events WHERE synced=? ORDER BY id").bind(claim).all();

  /* THE COORDINATOR'S ACTIONS, stamped the same way, in the order he made
     them: two changes to one Sunday are applied in that order. */
  const coord = [];
  try {
    await ensureCoord(env);
    await env.DB.prepare("UPDATE coord_actions SET synced=? WHERE seq IN " +
      "(SELECT seq FROM coord_actions WHERE synced<1 ORDER BY seq LIMIT 50)").bind(claim).run();
    const q = await env.DB.prepare("SELECT * FROM coord_actions WHERE synced=? ORDER BY seq").bind(claim).all();
    for (const r of (q.results || [])) coord.push(coordParse(r));
  } catch (e) {}

  /* Fenced on its own. An older database that has never taken a check here
     has no such table, and a drain that threw over it would stop the bookings
     and the trip events coming back as well. */
  let k = { results: [] };
  try {
    await ensureChecksIn(env);
    k = await env.DB.prepare(
      "SELECT id, check_id, body FROM checks_in WHERE synced=0 ORDER BY id LIMIT ?")
      .bind(Math.min(20, limit)).all();
  } catch (e) {}

  /* AUTHORISATIONS MADE ON A HANDSET, going the other way.

     One made on the spreadsheet arrived here through the sync and the
     spreadsheet already has it. One made in the app exists only here until
     this carries it back, and without it the Checks tab would say STOPPED
     about a bus that has been signed off and gone out, which is the worst
     kind of wrong a record can be.

     Only today's, and only the ones the spreadsheet has not filed. */
  const auths = [];
  try {
    const day = londonKey(new Date());
    const rows = await env.DB.prepare(
      "SELECT k, v FROM settings WHERE k LIKE ?").bind("auth:" + day + ":%").all();
    for (const r of (rows.results || [])) {
      let v = null;
      try { v = JSON.parse(r.v); } catch (e) { continue; }
      if (!v || v.via !== "app" || v.filed) continue;
      auths.push({ key: r.k, reg: v.reg, day: v.day, by: v.by || "",
                   inspector: v.inspector || "", at: Number(v.at) || 0,
                   checkId: v.checkId || "" });
    }
  } catch (e) {}

  /* How old the shelf is, in minutes, so "Is the live server working?" can
     say it out loud. A push that has quietly stopped is invisible from the
     spreadsheet otherwise: everything keeps answering, just with older and
     older answers, until the six hour limit trips and the whole app goes slow
     again for no reason anybody can see. */
  const age = {};
  for (const k of ["cache_rota", "cache_last"]) {
    try {
      const c = await cacheGet(env, k);
      age[k === "cache_rota" ? "rota" : "last"] =
        (c && c.builtAt) ? Math.round((Date.now() - Number(c.builtAt)) / 60000) : null;
    } catch (e) { age[k === "cache_rota" ? "rota" : "last"] = null; }
  }

  /* The sweeps belong to the clock now (see THE CLOCK). The drain only runs
     them when the clock has not ticked for a few minutes, which is a Worker
     deployed before its Cron Trigger was added, or a trigger somebody took
     away. Both at once would be two sweeps racing for the same tag. */
  if (!(await clockAlive(env))) await sweeps(env);

  /* Parsed here rather than on the far side: Apps Script gets the same object
     shape the phone posted, which is the shape handleCheck over there has
     always been given. A row that will not parse is dropped rather than
     returned, because a check nobody can read is not a check and holding it
     on the shelf forever would block every one behind it. */
  const checks = [];
  for (const r of (k.results || [])) {
    try { const c = JSON.parse(r.body); c.__row = r.id; checks.push(c); }
    catch (e) {
      try { await env.DB.prepare("UPDATE checks_in SET synced=1 WHERE id=?").bind(r.id).run(); }
      catch (e2) {}
    }
  }

  /* ROTA DECISIONS MADE FROM AN EMAIL.

     A bus authorised from a link is done here and the phones see it in
     seconds, because this server owns that fact. A rota request is not ours:
     it lives on the Rota Requests tab, and approving a swap moves two Sundays
     on the Rota. So the decision is carried back on the drain and the
     spreadsheet applies it through the same code path a person editing the
     Status cell goes through — one writer, and no chance of the two drifting.

     Held until the sheet says it has them, exactly like a booking. A drain
     that never reaches Apps Script leaves the decision here to go again. */
  const decisions = [];
  try {
    await ensureLinks(env);
    /* ASKED FOR, AND ASKED FOR AGAIN WITHOUT IT IF IT IS NOT THERE.

       ensureLinks adds `cover` to a live database, and remembers in a module
       variable that it has. That memo is right for a Worker, where one
       isolate serves one database for its whole life — and it is exactly the
       thing that would swallow every decision on the morning of a deploy if
       it were ever wrong. A drain that returns nothing looks like a quiet
       Sunday, not like a fault, which is the worst way for this to break.

       Same bargain writeCheckToday makes for check_id: ask for the column,
       and if the database says it has no such thing, take what it does have
       rather than dropping the lot. */
    let d = null;
    try {
      d = await env.DB.prepare(
        "SELECT token, subject, choice, used_at, used_by, cover FROM links " +
        "WHERE kind='rota' AND used=1 AND synced=0 ORDER BY used_at LIMIT 50").all();
    } catch (e) {
      if (!/no such column|has no column/i.test(String(e && e.message || e))) throw e;
      d = await env.DB.prepare(
        "SELECT token, subject, choice, used_at, used_by FROM links " +
        "WHERE kind='rota' AND used=1 AND synced=0 ORDER BY used_at LIMIT 50").all();
    }
    for (const r of (d.results || [])) {
      let subject = {};
      try { subject = JSON.parse(r.subject || "{}"); } catch (e) { continue; }
      decisions.push({ token: r.token, id: subject.id || "", sunday: subject.sunday || "",
                       driver: subject.driver || "", choice: r.choice,
                       cover: r.cover || "",
                       by: r.used_by || "", at: Number(r.used_at) || 0 });
    }
  } catch (e) { /* an older database has no links table and no decisions */ }

  /* When the clock last ticked and the sheet was last knocked on, so "Is the
     live server working?" can say whether the Cron Trigger is in place
     without anybody opening the Cloudflare dashboard. */
  let clockAgoSec = null, poke = null;
  try {
    const c = await cacheGet(env, "clock");
    if (c && c.at) clockAgoSec = Math.round((Date.now() - Number(c.at)) / 1000);
    const k = await cacheGet(env, "poke");
    if (k && k.at) poke = { agoSec: Math.round((Date.now() - Number(k.at)) / 1000), ok: !!k.ok };
  } catch (e) {}

  return json({ ok: true, claim: claim, bookings: b.results || [], trips: t.results || [],
                requests: requests, coord: coord,
                checks: checks, auths: auths, decisions: decisions, cacheAgeMin: age,
                clockAgoSec: clockAgoSec, poke: poke, pinSalt: !!pinSaltOf(env),
                /* Where it knocks, so the sheet can say whether that is its own
                   address. A web app URL is not a secret: it is in config.js. */
                knockTo: await sheetUrlKept(env),
                /* Whether the sheet's own password is set here, so the sheet
                   can say which side is missing it. */
                sheetTokenSet: !!sheetTokenOf(env) });
}

async function sheetUrlKept(env) {
  try { const u = await cacheGet(env, "sheet_url"); return String((u && u.url) || ""); }
  catch (e) { return ""; }
}

async function handleDrained(env, body) {
  const stmts = [];
  /* With the drain's stamp, only a row still carrying it is marked done. See
     drainClaim. Without one, an older Code.gs, the old rule stands. */
  const claim = Number(body.claim);
  const stamped = isFinite(claim) && claim < 0;
  const done = (table, ids) => {
    const list = ids.map(Number).filter((n) => isFinite(n));
    if (!list.length) return;
    const marks = list.map(() => "?").join(",");
    stmts.push(stamped
      ? env.DB.prepare("UPDATE " + table + " SET synced=1 WHERE synced=? AND id IN (" + marks + ")")
          .bind(claim, ...list)
      : env.DB.prepare("UPDATE " + table + " SET synced=1 WHERE id IN (" + marks + ")")
          .bind(...list));
  };
  if (Array.isArray(body.bookings) && body.bookings.length) done("bookings", body.bookings);
  if (Array.isArray(body.requests) && body.requests.length) {
    const ids = body.requests.map((x) => String(x || "")).filter((x) => /^[A-Za-z0-9_.-]{1,64}$/.test(x));
    if (ids.length) {
      const marks = ids.map(() => "?").join(",");
      stmts.push(stamped
        ? env.DB.prepare("UPDATE requests SET synced=1 WHERE synced=? AND id IN (" + marks + ")").bind(claim, ...ids)
        : env.DB.prepare("UPDATE requests SET synced=1 WHERE id IN (" + marks + ")").bind(...ids));
    }
  }
  if (Array.isArray(body.trips) && body.trips.length) done("trip_events", body.trips);
  if (Array.isArray(body.checks) && body.checks.length) {
    stmts.push(env.DB.prepare(
      "UPDATE checks_in SET synced=1 WHERE id IN (" + body.checks.map(() => "?").join(",") + ")"
    ).bind(...body.checks.map(Number)));
  }
  /* Marked filed rather than deleted. The row is still what checksToday reads
     to keep the bus clear for the rest of the day; filed only means the
     spreadsheet has a copy and does not need telling again. */
  if (Array.isArray(body.auths) && body.auths.length) {
    for (const item of body.auths) {
      /* { key, at } from v1.80.0 of the sheet, a bare key before it. With the
         time, a second authorisation of the same bus made while this one was
         being filed is not marked filed on the first one's say-so. */
      const key = String((item && typeof item === "object") ? item.key : item);
      const at = (item && typeof item === "object") ? Number(item.at) : NaN;
      const row = await env.DB.prepare("SELECT v FROM settings WHERE k=?").bind(key).first();
      if (!row || !row.v) continue;
      let v = null;
      try { v = JSON.parse(row.v); } catch (e) { continue; }
      if (isFinite(at) && Number(v.at) !== at) continue;
      v.filed = true;
      stmts.push(cachePut(env, key, v));
    }
  }
  /* Rota decisions the spreadsheet has now applied. Marked rather than
     deleted: the row is the record of who decided what and when, and
     sweepLinks clears it a week after it expired. */
  if (Array.isArray(body.decisions) && body.decisions.length) {
    const tokens = body.decisions
      .map((t) => String(t || "").trim())
      .filter((t) => /^[0-9a-f]{32}$/.test(t));
    if (tokens.length) {
      stmts.push(env.DB.prepare(
        "UPDATE links SET synced=1 WHERE token IN (" + tokens.map(() => "?").join(",") + ")"
      ).bind(...tokens));
    }
  }
  /* The coordinator's actions the sheet has dealt with, and what it said.
     ok false is a refusal, which the app shows him with the sheet's reason
     and which is never laid over the copy again. One left out is one the
     sheet could not deal with yet, and it comes round on the next drain. */
  if (Array.isArray(body.coord) && body.coord.length) {
    const now = Date.now();
    for (const c of body.coord) {
      const id = String((c && c.id) || "");
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id)) continue;
      const ok = (c && c.ok === false) ? 0 : 1;
      const result = String((c && c.result) || "").slice(0, 300);
      stmts.push(stamped
        ? env.DB.prepare("UPDATE coord_actions SET synced=1, ok=?, result=?, done_at=? WHERE id=? AND synced=?")
            .bind(ok, result, now, id, claim)
        : env.DB.prepare("UPDATE coord_actions SET synced=1, ok=?, result=?, done_at=? WHERE id=?")
            .bind(ok, result, now, id));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true });
}

/* ==========================================================================
   THE CLOCK
   ==========================================================================

   From w2.16.0 this Worker has a clock of its own: a Cron Trigger set in the
   Cloudflare dashboard to run every minute, which calls scheduled() below.

   Before it, every timed message rode on Apps Script's five minute sync, so
   "ten minutes past departure" went out somewhere between ten and fifteen
   minutes past, and the half past seven morning message somewhere before
   twenty to eight. Now each one goes on the minute its window opens.

   The windows themselves are unchanged. A window is still what decides
   whether something is due, and the tag still sees to it that the first tick
   inside one is the only one that sends.

   The clock also looks for anything a phone did that the sheet has not got,
   and knocks on the sheet's door if it finds some (see pokeSheet).

   NO TRIGGER, NO HARM. Until the Cron Trigger is added, or if it is ever
   removed, clockAlive answers no and the drain runs the sweeps exactly as it
   did before. */
const CLOCK_STALE_MS = 3 * 60000;

async function clockAlive(env) {
  try {
    const c = await cacheGet(env, "clock");
    return !!(c && Date.now() - (Number(c.at) || 0) < CLOCK_STALE_MS);
  } catch (e) { return false; }
}

/* Every timed message, in the order that matters: a route called off first,
   so nobody is told his bus comes at ten past ten before he is told it is not
   coming. Each one fenced, so one fault costs only itself. */
async function sweeps(env) {
  try { await wakeCancelled(env); } catch (e) {}
  try { await wakeDrivers(env); } catch (e) {}
  try { await wakeNotLeft(env); } catch (e) {}
  try { await wakeMorning(env); } catch (e) {}
  try { await wakeBookingReminders(env); } catch (e) {}
  try { await sweepLinks(env); } catch (e) {}
}

async function clockTick(env) {
  try { await cachePut(env, "clock", { at: Date.now() }).run(); } catch (e) {}
  /* Asking is what clears one that has run out. */
  try { await rehearsalOn(env); } catch (e) {}
  await sweeps(env);
  try { await pokeIfWaiting(env); } catch (e) {}
  try { await releaseCoordAlerts(env); } catch (e) {}
}

/* ---- telling the sheet there is something to collect -------------------

   From w2.16.0 a booking, a stop tap, a walkaround or an authorisation
   reaches the sheet in seconds, not on the next five minute drain.

   The Worker does not write the tab. It knocks: one POST to the sheet's own
   web app saying "drain now", and Apps Script runs the same drain it runs
   every five minutes, with the same code, the same Live ID matching and the
   same stamp rule. So there is still one way a row reaches the tab.

   Sent after the phone has had its answer (ctx.waitUntil in the router), so
   nobody at a kerb waits on Apps Script. If the knock is not answered, the
   clock tries again within a minute while anything is still waiting, and
   every five minutes if the sheet is not answering at all. The five minute
   drain is still underneath all of it. */
const POKE_CAP_MS = 25000;
const POKE_AGAIN_MS = 45000;
const POKE_BACKOFF_MS = 5 * 60000;

async function pokeSheet(env, why) {
  let ok = false;
  try { ok = await sheetPush(env, { action: "drainnow", why: String(why || "") }, POKE_CAP_MS); }
  catch (e) { ok = false; }
  try { await cachePut(env, "poke", { at: Date.now(), ok: ok }).run(); } catch (e) {}
  return ok;
}

/* Is there anything a phone did that the sheet has not confirmed? */
async function anythingWaiting(env) {
  for (const sql of [
    "SELECT 1 AS n FROM bookings WHERE synced < 1 LIMIT 1",
    "SELECT 1 AS n FROM trip_events WHERE synced < 1 LIMIT 1",
    "SELECT 1 AS n FROM checks_in WHERE synced = 0 LIMIT 1",
    "SELECT 1 AS n FROM requests WHERE synced < 1 LIMIT 1",
    "SELECT 1 AS n FROM links WHERE kind='rota' AND used=1 AND synced=0 LIMIT 1",
    "SELECT 1 AS n FROM coord_actions WHERE synced < 1 LIMIT 1"
  ]) {
    try { if (await env.DB.prepare(sql).first()) return true; } catch (e) { /* no such table yet */ }
  }
  return false;
}

async function pokeIfWaiting(env) {
  const last = await cacheGet(env, "poke");
  const since = Date.now() - (Number(last && last.at) || 0);
  if (since < ((last && last.ok === false) ? POKE_BACKOFF_MS : POKE_AGAIN_MS)) return false;
  if (!(await anythingWaiting(env))) return false;
  return await pokeSheet(env, "clock");
}

/* ---- a booking edited by hand on the sheet -----------------------------

   The coordinator strikes a booking out when somebody rings to say they are
   not coming, or changes how many are boarding. That row is the Worker's, so
   until w2.16.0 the edit reached nothing: the driver's list went on showing
   the seat, and the next time the phone touched the booking the drain wrote
   the phone's copy back over the coordinator's.

   The sheet now sends the edit here the moment it is made. The row is left
   pending (synced 0) on purpose, so the next drain writes the Worker's copy
   back onto the tab. That copy is what the coordinator typed, and writing it
   back also mends the case where a drain was carrying an older copy at the
   same moment. */
async function handleSheetBookings(env, body) {
  const edits = Array.isArray(body && body.edits) ? body.edits : [];
  const results = [];
  for (const e of edits) {
    const id = Number(e && e.id);
    if (!(id > 0)) { results.push({ id: e && e.id, applied: false, why: "no id" }); continue; }
    const row = await env.DB.prepare("SELECT id, status, seats FROM bookings WHERE id=?").bind(id).first();
    if (!row) { results.push({ id, applied: false, why: "not here" }); continue; }
    const st = String((e && e.status) || "").trim().toLowerCase();
    /* Only the two words this server acts on. Anything else typed in the
       Status cell is the coordinator's own note and is left where it is: taken
       here, the drain would write "Booked" back over it. */
    if (st && st !== "cancelled" && st !== "booked") {
      results.push({ id, applied: false, why: "status" });
      continue;
    }
    const status = st === "cancelled" ? "Cancelled" : st === "booked" ? "Booked" : String(row.status || "Booked");
    const n = Number(e && e.seats);
    const seats = isFinite(n) ? Math.max(0, Math.min(12, Math.floor(n))) : Number(row.seats) || 0;
    await env.DB.prepare("UPDATE bookings SET status=?, seats=?, received=?, synced=0 WHERE id=?")
      .bind(status, seats, Date.now(), id).run();
    results.push({ id, applied: true, status, seats });
  }
  return json({ ok: true, results });
}

/* ==========================================================================
   ROUTER
   ========================================================================== */

/* ==========================================================================
   TELLING PEOPLE THINGS
   ==========================================================================

   Web push, and deliberately the plainest kind there is.

   A push CAN carry an encrypted payload. This one carries nothing. The phone
   is woken, its service worker asks this Worker "what does that mean for me?",
   and the answer is built from tripPayload — the same function that draws the
   passenger's own screen. Three things fall out of that, and all three matter:

     1. One source of truth for what a passenger is told. The notification and
        the page cannot disagree, because they are the same sentence from the
        same function.
     2. The message is built at the moment it is READ, not when it was queued.
        A push that sat in a tunnel for four minutes says where the bus is now.
     3. No payload means no payload encryption: no ECDH, no HKDF, no AES-GCM.
        A hundred lines of cryptography nobody here could debug on a Sunday
        morning, not written, and so unable to be subtly wrong.

   What it costs: the phone must be able to reach this Worker when the push
   lands. It has just received a push over the network, so it almost always
   can, and when it cannot there is a plain fallback below.

   The signing keys are made here, once, and kept in the settings table.
   Nothing to generate by hand, nothing to paste into a dashboard, nothing to
   lose. The pages fetch the public half at runtime. */

/* How long a push service may hold one: fifteen minutes. Longer is pointless,
   because a bus that was two minutes away is long gone. */
/* SALTS THE PIN HASH, and must match PIN_SALT in Apps Script exactly.

   Set it as a Worker variable named PIN_SALT, of type Secret. There is no
   fallback in this file from w2.21.1: it is public, and a salt printed in it
   protects nothing. With the variable missing every PIN is refused, never
   waved through, and "Is everything working?" says so.

   What the salt buys: the Drivers tab holds four digit PINs, and four digits
   is ten thousand possibilities. An unsalted SHA-256 of a four digit number
   is looked up, not cracked. The salt is what makes the stored hash useless
   to anybody who gets a copy of this database.

   Change it and every PIN stops matching until the next sync recomputes them
   from the sheet, which is five minutes. */
/* Named apart from saltOf, which salts the phone fingerprint. Two salts,
   two purposes, and they must never be confused for one another. */
const pinSaltOf = (env) => String((env && env.PIN_SALT) || "");

/* Three, not ten, and five minutes. Copied from Apps Script deliberately so
   the two cannot disagree about what a lockout is. A PIN is four digits a man
   has known for months; three wrong in a row means he is on the wrong name or
   the sheet has the wrong number against him. */
const PIN_MAX_TRIES = 3;
const PIN_LOCK_MINUTES = 5;

const PUSH_TTL = 900;

function b64url(buf) {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function vapidKeys(env) {
  const had = await cacheGet(env, "vapid");
  if (had && had.pub && had.jwk) return had;

  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  const made = { pub: b64url(raw), jwk, at: Date.now() };
  await cachePut(env, "vapid", made).run();
  return made;
}

/* The Authorization header one push service will accept. Built per audience,
   which is the ORIGIN of the endpoint and not the whole address — Google,
   Apple and Mozilla each reject a token made out to anybody else. */
async function vapidAuth(env, endpoint, keys) {
  const aud = new URL(endpoint).origin;
  const head = b64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    /* Who to shout at if this Worker misbehaves. An https origin is as valid
       here as a mailto, and needs nobody's address kept in a database. */
    sub: "https://minibus-api.asimbassey.workers.dev"
  })));
  const key = await crypto.subtle.importKey(
    "jwk", keys.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key, new TextEncoder().encode(head + "." + body));
  return "vapid t=" + head + "." + body + "." + b64url(sig) + ", k=" + keys.pub;
}

/* One phone. True if the push service took it.

   A 404 or a 410 is the push service saying that phone is gone for good —
   uninstalled, permission revoked, browser data cleared. The row goes rather
   than being retried for ever. Anything else is left alone: a 500 from Google
   on a Sunday morning is Google's problem and the row is still good. */
async function pushOne(env, sub, keys) {
  try {
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Authorization": await vapidAuth(env, sub.endpoint, keys),
        "TTL": String(PUSH_TTL),
        "Content-Length": "0",
        "Urgency": "high"
      }
    });
    if (res.status === 404 || res.status === 410) {
      await env.DB.prepare("DELETE FROM push_subs WHERE id=?").bind(sub.id).run();
      return false;
    }
    if (res.ok || res.status === 201) {
      await env.DB.prepare("UPDATE push_subs SET seen=?, fails=0 WHERE id=?")
        .bind(Date.now(), sub.id).run();
      return true;
    }
    await env.DB.prepare("UPDATE push_subs SET fails=fails+1 WHERE id=?").bind(sub.id).run();
    return false;
  } catch (e) {
    try {
      await env.DB.prepare("UPDATE push_subs SET fails=fails+1 WHERE id=?").bind(sub.id).run();
    } catch (e2) {}
    return false;
  }
}

/* A group of phones, each woken at most once for a given tag.

   tag is what stops a driver who taps a stop twice from buzzing a pocket
   twice. It is stored against the subscription rather than counted centrally,
   because the question is always "has THIS person been told THIS" and never
   "how many went out". */
async function wake(env, subs, tag) {
  if (!subs || !subs.length) return 0;
  const keys = await vapidKeys(env);
  let sent = 0;
  for (const s of subs) {
    if (tag && s.last === tag) continue;
    if (tag) {
      /* Claimed in the same statement that checks it. The clock and a drain
         falling back to the sweeps can be running at the same moment, and a
         read followed by a write would let both send the same tag. Skipped
         only when the database says plainly that nothing changed. */
      const r = await env.DB.prepare("UPDATE push_subs SET last=? WHERE id=? AND last<>?")
        .bind(tag, s.id, tag).run();
      if (r && r.meta && typeof r.meta.changes === "number" && r.meta.changes === 0) continue;
    }
    if (await pushOne(env, s, keys)) sent++;
  }
  return sent;
}

/* ONE RULE FOR MATCHING A DRIVER TO HIS HANDSET.

   Used by the sweep that wakes him and by the report that says who has no
   alerts, so the two cannot disagree about who is signed up. They did.

   The report asked lower(trim()) against the Drivers tab. The sweep asked a
   bare = against the name in the Rota cell. So a handset registered as
   "bro arthur" answered the report — "alerts are on for every driver" — and was
   invisible to the only query that would ever have woken it. The report was
   built to catch exactly that silence and instead it certified it.

   Loose, because both ends are typed by a person: the Drivers tab, the Rota
   cell, and the name the app sends when he taps Turn on. Loose can only ever
   find MORE handsets than a bare =, never fewer, so nothing that worked
   before stops working. Two rows for one man means two phones, which is
   already what this loop expects.

   Whoever changes this changes who gets woken on a Sunday. Change it here,
   once, or not at all. */
const DRIVER_SUB_MATCH = "role = 'driver' AND lower(trim(driver)) = lower(trim(?))";

async function subsWhere(env, where, binds) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM push_subs WHERE " + where).bind(...binds).all();
  return results || [];
}

/* The passengers booked at one stop today. Matched on BOTH handles, because a
   booking made on a laptop and watched on a phone is one person. */
async function subsAtStop(env, key, stopId) {
  const rows = await liveBookings(env, key);
  const want = rows.filter((b) => b.stopId === stopId && b.seats > 0);
  if (!want.length) return [];
  const subs = [], seen = {};
  for (const b of want) {
    if (b.device) {
      for (const s of await subsWhere(env, "role='passenger' AND ref=?", [b.device])) {
        if (!seen[s.id]) { seen[s.id] = 1; subs.push(s); }
      }
    }
    if (b.pid) {
      for (const s of await subsWhere(env, "role='passenger' AND pid=?", [b.pid])) {
        if (!seen[s.id]) { seen[s.id] = 1; subs.push(s); }
      }
    }
  }
  return subs;
}

/* THE BUS IS NOT COMING. Everybody booked on that route, once each.

   The one message in this system that is worth sending before the morning
   rather than during it. Everything else here tells a passenger where a bus
   is; this one tells him to stop waiting for it, which is the only thing the
   app can do for somebody whose lift has been called off.

   Tagged per route per Sunday, so marking the Rota, changing your mind, and
   marking it again does not buzz the same pocket twice. */
async function wakeCancelled(env) {
  /* A rehearsal holds this back, and on purpose: the README's checklist
     calls a route off to watch the passenger page do it, and during a
     rehearsal that must reach nobody. A real route called off while one is
     running is told the minute it ends, on the next tick. */
  if (await rehearsalOn(env)) return 0;

  const key = runSunday();
  const all = await getStops(env);
  const stops = pickupsAndArrivals(all);

  let rotaRow = null;
  try { rotaRow = await getRotaRow(env, key); } catch (e) { return 0; }

  let n = 0;
  for (const route of cancelledRoutes(rotaRow, stops)) {
    const seen = {};
    for (const s of stops.filter((x) => x.route === route && !x.arrival)) {
      for (const sub of await subsAtStop(env, key, s.id)) {
        if (seen[sub.id]) continue;
        seen[sub.id] = 1;
        n += await wake(env, [sub], "off|" + key + "|" + route);
      }
    }
  }
  return n;
}

/* NO WORD YET THAT THE BUS HAS LEFT, from w2.27.0.

   Five minutes past the departure time with no Start tapped, everybody
   booked on that route is told, once. The words say only what this server
   knows: that nothing has recorded the bus leaving. They do not say it is
   late or why, because Start is the only thing that tells this server a bus
   has gone, and a driver who pulled away without tapping it is on the road
   while the record says he is at church. "The bus has left church" follows
   the moment he taps it.

   Not on a route called off (that has its own words, and they come first),
   not during a rehearsal, and not past an hour, when a stale buzz helps
   nobody and the coordinator is already on it. */
const NOT_LEFT_AFTER_MS = 5 * 60000;
const NOT_LEFT_UNTIL_MS = 60 * 60000;

function notLeftDue(all, key, route, now) {
  const d = departStopFor(all, route);
  const due = d && d.time ? londonMoment(key, d.time) : null;
  if (!due) return null;
  const late = now - due.getTime();
  return (late >= NOT_LEFT_AFTER_MS && late <= NOT_LEFT_UNTIL_MS) ? d.time : null;
}

async function wakeNotLeft(env) {
  if (await rehearsalOn(env)) return 0;
  const key = runSunday();
  const all = await getStops(env);
  const stops = pickupsAndArrivals(all);
  let rotaRow = null;
  try { rotaRow = await getRotaRow(env, key); } catch (e) { return 0; }
  const now = Date.now();
  let n = 0;
  for (const route of routeNames(stops)) {
    if (routeCancelled(rotaRow, route)) continue;
    if (!notLeftDue(all, key, route, now)) continue;
    let state = null;
    try { state = await tripState(env, key, route, "real"); } catch (e) { continue; }
    if (state && state.started) continue;
    const seen = {};
    for (const s of stops.filter((x) => x.route === route && !x.arrival)) {
      for (const sub of await subsAtStop(env, key, s.id)) {
        if (seen[sub.id]) continue;
        seen[sub.id] = 1;
        n += await wake(env, [sub], "late|" + key + "|" + route);
      }
    }
  }
  return n;
}

/* The bus has left church. Everybody booked on that route, once each. */
async function wakeDeparture(env, key, route, stops) {
  let n = 0;
  for (const s of stops.filter((x) => x.route === route && !x.arrival)) {
    n += await wake(env, await subsAtStop(env, key, s.id), "left|" + key + "|" + route);
  }
  return n;
}

/* A stop has been marked. Two groups and no more.

   The next stop that has anybody booked gets "the bus is coming to your stop"
   — one buzz, at the moment it becomes true. Waking every stop on every tap
   would mean eight buzzes for the man at the end of the route, and by October
   he would have turned them off.

   And anybody BEHIND the bus whose stop is still unmarked is told it has gone
   past. That is the Parton Street case: the driver moved on, and the people
   standing there had no way to know until somebody rang them. */
/* HOW LONG UNTIL THE BUS REACHES ONE STOP, in minutes.

   The same arithmetic the passenger's own page and the driver's stop list
   use, because it is the same function: one estimate, three places it is
   shown, and no way for them to disagree. Null when there is nothing to
   estimate from — before the bus has left, or once it has gone quiet. */
async function minutesToStop(env, key, route, all, state, stopId) {
  if (!state || !state.started || state.ended) return null;
  if (state.offset === null || state.offset === undefined) return null;
  const ordered = stopsOnRoute(all, route);
  const stop = ordered.find((x) => String(x.id) === String(stopId));
  if (!stop) return null;
  const sched = londonMoment(key, stop.time);
  if (!sched) return null;
  const set = await etaSettings(env);
  const booked = await bookedStopIds(env, key, route);
  const saved = etaSavedMinutes(key, ordered, state.lastStopId, stop.id, booked, set);
  return Math.round((sched.getTime() + Number(state.offset) * 60000 - saved * 60000 - Date.now()) / 60000);
}

/* EVERY BOOKED STOP IN FRONT OF THE ONE JUST MARKED, not only the next.

   The ruling is that a passenger hears at every booked pickup before his own,
   so that he can watch the bus coming down the line rather than being tapped
   on the shoulder once and hoping. The cost of that ruling is volume: eight
   pickups on North means the last man is woken eight times, and three of
   those stops are inside half a kilometre of each other.

   So a message he has already effectively had is held back. If the estimate
   for HIS stop has not moved by more than resendMinutes since the last thing
   he was told, he is not told again — because "about nine minutes" followed
   ninety seconds later by "about eight minutes" is not news, and a phone that
   buzzes with things that are not news is a phone somebody stops looking at.

   TWO ARE ALWAYS SENT, whatever the threshold says:

     the stop immediately before his   he needs to start walking
     his own                           it is the last thing he hears

   Those are the two that carry an instruction rather than an update, and an
   instruction is never redundant.

   The stops the bus went PAST without marking are unchanged and are not
   subject to any of this: somebody standing at a kerb the bus has driven by
   is not receiving an update, he is receiving the only message that will ever
   reach him. */
async function wakeAfterTap(env, key, route, all, stops, stopId, marked) {
  const line = stops.filter((s) => s.route === route && !s.arrival);
  const at = line.findIndex((s) => s.id === stopId);
  if (at < 0) return 0;

  const rules = await passengerRules(env);
  let state = null;
  try { state = await tripState(env, key, route); } catch (e) {}

  let n = 0;

  for (let i = at + 1; i < line.length; i++) {
    const subs = await subsAtStop(env, key, line[i].id);
    if (!subs.length) continue;

    const mins = await minutesToStop(env, key, route, all, state, line[i].id);
    /* The stop immediately after the one just marked is, from the point of
       view of whoever is standing at it, the stop before his own having been
       served. That is his cue to be at the kerb. */
    const always = (i === at + 1);

    for (const sub of subs) {
      if (!always && mins !== null && sub.last_eta !== null && sub.last_eta !== undefined) {
        if (Math.abs(mins - Number(sub.last_eta)) <= rules.resendMinutes) continue;
      }
      /* Tagged per stop per tap, so a retried tap cannot buzz the same pocket
         twice, and the remembered estimate is written whether or not the push
         itself gets through — a phone that is unreachable has still had its
         chance at this message and should not collect a backlog of them. */
      const sent = await wake(env, [sub], "next|" + key + "|" + line[i].id + "|" + at);
      if (mins !== null) {
        try {
          await env.DB.prepare("UPDATE push_subs SET last_eta=? WHERE id=?")
            .bind(Math.round(mins), sub.id).run();
        } catch (e) { /* an older database; the message still went */ }
      }
      n += sent;
    }
  }

  for (let i = 0; i < at; i++) {
    if (marked[line[i].id]) continue;
    n += await wake(env, await subsAtStop(env, key, line[i].id), "past|" + key + "|" + line[i].id);
  }
  return n;
}

/* ASKING PEOPLE TO BOOK FOR SUNDAY.

   Two nudges a week, neither of them about a bus that is running:

     the afternoon after the run   bookings for next Sunday have just opened
     midweek                       you still have not booked

   WHO GETS THEM: anybody whose phone has asked to be told things and who has
   no seat booked for the Sunday that is currently open. Somebody who has
   already booked is not chased, which is the whole point of the second one.

   AND, FROM w2.19.0, ONCE FOR A MAN WITH A SEAT. A window marked booked also
   tells everybody who has booked what they have booked: the stop, the time
   and the seats. Saturday evening is the one marked, so the last word before
   the morning is his own booking, while there is still time to change it or
   give the seat back. Before this his only reminder was the Sunday morning
   message. Tagged per Sunday and per day, apart from the nudge's tag, so it
   goes once in its window and a nudge he had earlier in the week does not
   stop it.

   AT MOST ONE A WEEK EACH, which is a ruling and not a guess: both windows
   share one tag per person per Sunday, so a man who was nudged on Sunday
   afternoon is left alone on Thursday even if he still has not booked. If you
   would rather the persistent non-booker heard twice, set oncePerWeek false
   in config.js and the two get their own tags.

   NOTHING AT NIGHT. The windows are daytime by default, but a setting can be
   changed and a reminder to book a seat is a convenience — it does not get to
   wake anybody up. The Sunday morning messages are deliberately NOT subject
   to this: a bus that is coming is not a convenience.

   A window rather than a moment, like every other sweep here, because this
   Worker has no clock of its own and runs when Apps Script calls in. */
async function wakeBookingReminders(env) {
  /* NOT HELD BACK BY A REHEARSAL, from w2.20.1.

     Everything else that wakes a passenger is about the run, and waits while
     a test run is on the road. This is not: it asks people to book, or tells
     a man what he has booked, from the real bookings, and says nothing about
     any bus. Held back, a rehearsal on a Saturday evening swallowed the one
     reminder a booked passenger gets before Sunday, and that is the evening
     a rehearsal is most likely to be run. */
  const rules = await bookingRules(env);
  if (!rules.on) return 0;
  if (quietNow(await passengerRules(env))) return 0;

  const p = londonParts(new Date());
  const mins = p.hh * 60 + p.mi;
  const hit = rules.windows.find((w) =>
    p.dow === w.day && mins >= w.from * 60 && mins <= w.to * 60);
  if (!hit) return 0;

  /* THE SUNDAY BOOKINGS ARE ACTUALLY OPEN FOR. On Sunday afternoon the
     coming one has closed and the open one is a week out; midweek it is the
     coming one. Asked of the same cutoff the booking page itself obeys, so
     the reminder can never point at a Sunday nobody can book. */
  const now = runSunday();
  const target = bookingsClosed(now) ? keyAddWeeks(now, 1) : now;

  /* EXCEPT FOR A SEAT ON A ROUTE THE ROTA HAS OFF, while a rehearsal runs.
     The checklist calls a route off during one, so a route off then may be
     a test or may be real, and nothing here can tell which. "You are booked"
     reads as if the bus runs, and "No bus" may be untrue, so he is not woken
     at all. Nothing claims his reminder: it goes in the window once the
     rehearsal is over, saying what is true then, and a route still off is
     told by its own message. See rehearsalSeatWords. */
  const held = {};
  let off = [];
  const byStop = {};
  if (await rehearsalOn(env)) {
    try {
      const stops = pickupsAndArrivals(await getStops(env));
      for (const x of stops) byStop[String(x.id)] = x.route;
      off = cancelledRoutes(await getRotaRow(env, target), stops);
    } catch (e) { off = []; }
  }

  const booked = {};
  for (const b of await liveBookings(env, target)) {
    if (!(Number(b.seats) > 0)) continue;
    const hold = off.length > 0 && off.indexOf(byStop[String(b.stopId)] || "") !== -1;
    if (b.device) { booked["d:" + b.device] = 1; if (hold) held["d:" + b.device] = 1; }
    if (b.pid) { booked["p:" + b.pid] = 1; if (hold) held["p:" + b.pid] = 1; }
  }

  const subs = await subsWhere(env, "role <> 'driver'", []);

  /* TAGGED BY THE DAY, NOT BY THE WINDOW'S PLACE IN THE LIST.

     An index would mean reordering the list re-nudged everybody who had
     already been told, for no change at all. The day is the thing a person
     experiences, so it is the thing the tag is made of.

     Two windows on the same day therefore share a tag and send once between
     them. That is the right way round: it reads as one nudge with a longer
     chance of catching a sweep, which is what it is. */
  const tag = rules.oncePerWeek
    ? "book|" + target
    : "book|" + target + "|d" + hit.day;

  const bookedTag = "booked|" + target + "|d" + hit.day;

  let n = 0;
  for (const sub of subs) {
    const has = (sub.ref && booked["d:" + sub.ref]) || (sub.pid && booked["p:" + sub.pid]);
    if (has) {
      const hold = (sub.ref && held["d:" + sub.ref]) || (sub.pid && held["p:" + sub.pid]);
      if (hit.booked && !hold) n += await wake(env, [sub], bookedTag);
      continue;
    }
    n += await wake(env, [sub], tag);
  }
  return n;
}

/* THE FIRST MESSAGE OF THE DAY, at the same time the drivers are told.

   Before this, the earliest a passenger heard anything was Start trip, which
   is the moment the bus pulls out — too late to be useful to anybody who was
   not already ready. This goes in the same Sunday morning window as "You are
   driving today", so the two halves of the morning are told at the same time.

   A window rather than a moment, for the same reason the driver's is: this
   Worker has no clock and runs when Apps Script calls in every five minutes.
   The tag sees to it that the first sweep inside the window is the only one
   that sends. */
async function wakeMorning(env) {
  if (await rehearsalOn(env)) return 0;
  const rules = await passengerRules(env);
  if (!rules.morningMessage) return 0;

  const p = londonParts(new Date());
  const mins = p.hh * 60 + p.mi;
  if (p.dow !== 0 || mins < 7 * 60 + 30 || mins > 8 * 60 + 30) return 0;

  const key = runSunday();
  const all = await getStops(env);
  const stops = pickupsAndArrivals(all);

  /* A route the Rota has called off says so through wakeCancelled, which
     outranks this and has already run. Telling somebody his bus comes at ten
     past ten and then that it is not running at all, in that order, is worse
     than saying nothing. */
  let rotaRow = null;
  try { rotaRow = await getRotaRow(env, key); } catch (e) {}
  const off = cancelledRoutes(rotaRow, stops);

  let n = 0;
  for (const route of routeNames(stops)) {
    if (off.indexOf(route) !== -1) continue;
    for (const s of stops.filter((x) => x.route === route && !x.arrival)) {
      n += await wake(env, await subsAtStop(env, key, s.id), "morn|" + key + "|" + route);
    }
  }
  return n;
}


/* Who the rota puts on a route, cover first. The cover column wins whenever
   it is filled, which is the whole reason it exists. */
/* IS THIS ROUTE OFF TODAY.

   Read off the Rota's one Status column, which is where the coordinator
   already records what happened to a Sunday. Three of its values mean a bus
   is not coming:

     Cancelled/declined   neither route runs
     North cancelled      North is off, South runs as normal
     South cancelled      South is off, North runs as normal

   One column and not two, because the tab has one Status cell per Sunday and
   adding a pair of per-route columns would mean migrating every existing
   sheet for a fact that is already expressible. A Sunday can only be one of
   these things at a time anyway: a morning where one bus is off is not also
   a morning with a change requested.

   Matched on the whole trimmed string. Substring matching here would make
   "South cancelled" true for a route called "South West" the day somebody
   adds one. */
function routeCancelled(rotaRow, route) {
  const st = String((rotaRow && rotaRow.status) || "").trim().toLowerCase();
  if (!st) return false;
  if (st === "cancelled/declined") return true;
  return st === String(route || "").trim().toLowerCase() + " cancelled";
}

/* Every route that is off today, as a list, for the pages that need to grey
   out more than one thing. */
function cancelledRoutes(rotaRow, stops) {
  return routeNames(stops).filter((rt) => routeCancelled(rotaRow, rt));
}

function rotaDriverFor(rotaRow, route) {
  if (!rotaRow) return "";
  return String((route === "South" ? (rotaRow.south_cover || rotaRow.south)
                                   : (rotaRow.north_cover || rotaRow.north)) || "").trim();
}

/* WHAT ONE DRIVER MOST NEEDS TOLD, AND NOTHING ELSE.

   This began as three separate sweeps and that was wrong, in a way the tests
   caught and a Sunday would not have. At half eight on a Sunday with a bus
   stopped by the check, two of them fired in the same pass: the driver's
   pocket buzzed twice, and because the push carries no payload and the phone
   asks what it means afterwards, BOTH buzzes resolved to whichever sweep had
   run last. He would have been told twice that he was driving today, and the
   one thing he actually needed — that his bus was stopped — would have gone
   out over the wire and arrived as nothing.

   So: one decision per route, taken in order of how much it costs to not
   know, and one push. The order is the argument.

     stopped   he is about to drive to a bus he cannot take
     unstarted people are standing at kerbs right now
     unended   the record is open; nobody is inconvenienced
     duty      nothing is wrong at all

   Each still carries its own tag, because the tag is what stops the same
   thing being said twice. It is no longer what decides the words: pushWhat
   works those out from the record at the moment the phone asks. */
async function driverNudgeFor(env, key, route, all, stops, rotaRow, buses) {
  const who = rotaDriverFor(rotaRow, route);
  if (!who) return null;                       /* nobody rostered, nobody to tell */

  let t = null;
  /* The real run, even while a rehearsal is on. On a Sunday afternoon a test
     run past the timetable's arrival would otherwise tell the rostered
     driver to end a run somebody else is rehearsing. */
  try { t = await tripDriverPayload(env, route, "real"); } catch (e) { return null; }
  if (!t) return null;

  const now = Date.now();

  /* ---- the route is off ------------------------------------------------- */
  /* Above the stopped bus, because a coordinator can call a morning off for
     reasons that have nothing to do with a defect, and a driver who turns up
     to a run that was cancelled has wasted his morning for nothing. */
  if (!t.started && routeCancelled(rotaRow, route)) {
    return { who, tag: "off|" + key + "|" + route };
  }

  /* ---- his bus was stopped by somebody's walkaround --------------------- */
  /* ---- and: it has since been authorised -------------------------------- */
  if (!t.started) {
    let mine = "";
    try { mine = (await busFor(env, key, route, buses, rotaRow)).reg || ""; } catch (e) {}
    if (mine) {
      let checks = {};
      try { checks = await checksToday(env); } catch (e) {}
      const rec = Object.keys(checks).find(
        (reg) => reg.toUpperCase() === mine.toUpperCase());
      const state = rec ? checks[rec].state : "";

      if (state === "stopped") return { who, tag: "stopped|" + key + "|" + mine };

      /* THE OTHER HALF OF A MESSAGE HE HAS ALREADY HAD.

         He was told his bus was stopped and told to ring the coordinator.
         Until now, the answer came back only if he thought to open Stops and
         bookings again — so a man who had been told not to drive had no way
         of hearing that he could, short of checking a screen he had no reason
         to look at.

         Directly under the stopped message and above everything else, because
         it is the same subject and it is the one that is newer. Tagged by the
         CHECK, not by the day: a second walkaround that stops the bus again
         and is authorised again is a second thing worth telling him. */
      if (state === "authorised") {
        const id = String((rec && checks[rec].id) || "");
        return { who, tag: "clear|" + key + "|" + mine + (id ? "|" + id : "") };
      }
    }
  }

  /* ---- the run that never started --------------------------------------- */
  if (!t.started) {
    const d = departStopFor(all, route);
    const due = d && d.time ? londonMoment(key, d.time) : null;
    if (due) {
      const late = now - due.getTime();
      /* Ten minutes, because a driver loading a full bus at the gate is not
         late yet. Ninety, because past that this is the coordinator's problem
         and a third buzz helps nobody. */
      if (late >= 10 * 60000 && late <= 90 * 60000) {
        return { who, tag: "start" + (late > 25 * 60000 ? "b" : "a") + "|" + key + "|" + route };
      }
      /* ON THE MINUTE, from w2.27.0: the departure time has come. Before
         this the first word was ten minutes late. Once, by its tag. */
      if (late >= 0 && late < 10 * 60000) {
        return { who, tag: "go|" + key + "|" + route };
      }
    }
  }

  /* ---- the run nobody closed -------------------------------------------- */
  if (t.started && !t.ended) {
    const arr = stops.filter((s) => s.route === route && s.arrival);
    const last = arr.length ? londonMoment(key, arr[arr.length - 1].time) : null;
    if (last &&
        now >= last.getTime() + 15 * 60000 &&
        now - (Number(t.lastAt) || Number(t.started) || 0) >= 10 * 60000) {
      return { who, tag: "end" + (now - last.getTime() > 40 * 60000 ? "b" : "a") +
                         "|" + key + "|" + route };
    }
  }

  /* ---- you are driving today -------------------------------------------- */
  /* A window rather than a moment: this Worker has no clock of its own and
     runs when Apps Script's five minute sync calls in. The tag sees to it
     that the first sweep inside the window is the only one that sends. */
  if (!t.started) {
    const p = londonParts(new Date());
    const mins = p.hh * 60 + p.mi;
    if (p.dow === 0 && mins >= 7 * 60 + 30 && mins <= 8 * 60 + 30) {
      return { who, tag: "duty|" + key + "|" + route };
    }
  }

  return null;
}

async function wakeDrivers(env) {
  const key = runSunday();
  const all = await getStops(env);
  const stops = pickupsAndArrivals(all);
  const rotaRow = await getRotaRow(env, key);
  const buses = await getBuses(env);
  let n = 0;

  for (const route of routeNames(stops)) {
    let nudge = null;
    try { nudge = await driverNudgeFor(env, key, route, all, stops, rotaRow, buses); }
    catch (e) { continue; }
    if (!nudge) continue;

    /* nudge.who is the name in the ROTA cell, which is not always spelled the
       way the Drivers tab spells it: a cover typed in by hand on a Saturday
       night is the usual way the two drift apart. A bare = here meant that
       driver was never woken, and nothing anywhere said so. */
    const subs = await subsWhere(env, DRIVER_SUB_MATCH, [nudge.who]);

    /* Mend the stored route on the way past. pushWhat no longer trusts it, so
       nothing depends on this being right; it just stops the column drifting
       further from the truth every week a man swaps routes. */
    for (const sb of subs) {
      if (sb.route === route) continue;
      try {
        await env.DB.prepare("UPDATE push_subs SET route=? WHERE id=?").bind(route, sb.id).run();
        sb.route = route;
      } catch (e) {}
    }

    n += await wake(env, subs, nudge.tag);
  }
  return n;
}

/* WHICH ROUTE HE IS ON TODAY, asked of the record and never of the
   subscription.

   push_subs.route is written once, when he first taps Turn on, and is never
   refreshed. So a man who turned alerts on during a North Sunday was answered
   about North for the rest of his life on this app.

   With one message that was a wrong route name inside an otherwise true
   sentence. With four it is a bus that was never stopped, a run that did
   start, and a departure time belonging to somebody else's route. The same
   fault, four times as loud.

   Asked in order of authority. A run he is actually driving beats the rota,
   because he may be covering and the column may not be filled. The rota beats
   a stale subscription. The subscription is the last resort and only because
   answering nothing at all is worse: a push that shows no notification is
   counted against the site until the browser stops delivering them. */
/* WHICH ROUTE IS THIS DRIVER'S TODAY, AND IS IT ACTUALLY HIS.

   Two answers, because the fallback is a guess and the caller has to know it
   was one. When the name matches nobody — not the man out on a run, not the
   rota, not a cover — this returns the route the PHONE registered with, which
   is right for a message about a route and wrong for every message that says
   "your".

   The second answer was thrown away, and the words paid for it: a driver who
   was stood down after the eight o'clock push still read "You are driving
   today. North. Depart 09:52 after vehicle check." Sent to a bus he had just
   been taken off, by the one mechanism written to stop stale words arriving.

   THE TRIP IS ASKED BEFORE THE ROTA, and that order is not tidiness. A man can
   drive a morning the rota never named him for — it is recorded as Cover and
   it happens — and he is as much the driver of that run as anybody. */
async function driverRouteToday(env, sub, key, stops) {
  const me = String(sub.driver || "").trim().toLowerCase();
  const routes = routeNames(stops);

  if (me) {
    for (const rt of routes) {
      let t = null;
      try { t = await tripState(env, key, rt); } catch (e) { continue; }
      if (t && t.started && !t.ended &&
          String(t.driver || "").trim().toLowerCase() === me) return { route: rt, mine: true };
    }
    let rotaRow = null;
    try { rotaRow = await getRotaRow(env, key); } catch (e) {}
    if (rotaRow) {
      for (const rt of routes) {
        if (rotaDriverFor(rotaRow, rt).trim().toLowerCase() === me) return { route: rt, mine: true };
      }
    }
  }
  return { route: String(sub.route || "").trim() || routes[0] || "North", mine: false };
}

/* ---- what a woken phone is told ---------------------------------------- */

/* The service worker asks this the moment a push lands, naming itself by its
   own endpoint. Everything a passenger is told comes straight off tripPayload,
   the function that draws their screen, so the notification and the page are
   the same sentence. */
/* This phone's seat on the Sunday bookings are currently open for, or null.

   Asked of the same cutoff the booking page obeys, so it can never answer
   about a Sunday nobody can book. Matched on the same two handles a booking
   is: the device reference and the salted phone fingerprint. */
/* A phone's seat on the Sunday that is currently bookable, AND WHICH SUNDAY
   THAT IS.

   The key was worked out here and kept private, which is how the caller came to
   guess at it: it compared today against the PAYLOAD's date, which is always
   this Sunday, while the seat it was describing could be next Sunday's. Booked
   for the 4th, and told on the 27th that your bus was today at 10:15 and to get
   to your stop. The answer has to carry its own date or the caller has nothing
   honest to compare. */
async function seatFor(env, sub) {
  if (!sub) return null;
  const now = runSunday();
  const target = bookingsClosed(now) ? keyAddWeeks(now, 1) : now;
  let rows = [];
  try { rows = await liveBookings(env, target); } catch (e) { return null; }
  const mine = rows.find((b) => Number(b.seats) > 0 &&
    ((sub.ref && b.device === sub.ref) || (sub.pid && b.pid === sub.pid)));
  if (!mine) return null;
  let stop = null;
  try {
    stop = (await getStops(env)).find((x) => String(x.id) === String(mine.stopId)) || null;
  } catch (e) {}
  return { stop: (stop && stop.stop) || mine.stopId, time: (stop && stop.time) || "",
           seats: Number(mine.seats) || 0, key: target, route: (stop && stop.route) || "" };
}

/* A route called off, said about one stop on one Sunday.

   "TODAY" ONLY WHEN IT IS TODAY. The sweep that sends this runs every five
   minutes all week, so a route called off on the Friday is pushed on the
   Friday, and "no bus today" on a Friday is a sentence about the wrong day,
   read by somebody who never asked about Friday. */
function offWords(stop, route, date) {
  const itsToday = londonKey(new Date()) === String(date || "");
  return { ok: true, tag: "bus", url: "./",
           title: "No bus to " + String(stop || "your stop") + (itsToday ? " today" : " on Sunday"),
           body: "The " + String(route || "") + " bus is not running" +
                 (itsToday ? "" : " this Sunday") + ". Sorry." };
}

/* WHAT TO SAY TO A PHONE WHEN THERE IS NO BUS ON THE ROAD FOR IT.

   Three situations, one set of words, because they are the same situation seen
   at different hours: before the morning, after it, and on a Sunday that is not
   this one. Written once and called from all three, after the third separate
   copy of this decision got the day wrong in its own particular way.

   The day comes off the SEAT, never off the clock and never off the payload.
   That is the whole lesson of the three faults this replaced. */
function seatWords(seat) {
  if (!seat) {
    /* WHEN IT CLOSES, IN EVERY ONE OF THESE. A nudge to book that does not say
       by when is a nudge to do it later, and later is a morning where the list
       has already gone to the driver. Built from BOOKING_CUTOFF_* rather than
       typed, so the one place the cutoff is set is the one place it is
       described.

       AND THE LAST ONE SAYS SO. Inside the final day the sentence stops being a
       fact about Sundays in general and becomes a deadline. Worked out from the
       clock, not from the tag, so a push that sat in a tunnel until Sunday
       morning still arrives saying what is true when it is read. */
    const cut = nextCutoffMs();
    if (cut && cut - Date.now() <= 24 * 3600000) {
      const today = londonParts(new Date()).dow === BOOKING_CUTOFF_DAY;
      return { ok: true, tag: "book", url: "./",
               title: "Last chance to book for Sunday",
               body: "Bookings close at " + cutoffClock() + " " +
                     (today ? "today" : "tomorrow") + ". Tap to pick your stop." };
    }
    return { ok: true, tag: "book", url: "./",
             title: "Book your seat for Sunday",
             body: "There is room on the bus. Bookings close " + cutoffWords() +
                   ". Tap to pick your stop." };
  }

  /* HIS SEAT'S OWN SUNDAY, COMPARED WITH TODAY. On the day it is a time to be
     somewhere and the message says so — that is the whole job of the morning
     push, which used to say "You are booked for Sunday" on a Sunday morning and
     never once told anybody to be there early. On any other day it is a fact
     about a Sunday, and saying "today" about it would send somebody to a kerb a
     week early. */
  const itsToday = seat.key && londonKey(new Date()) === String(seat.key);
  if (itsToday && seat.time) {
    return { ok: true, tag: "bus", url: "./",
             title: "Your bus today at " + seat.time,
             body: seat.stop + ". Be at your stop a few minutes early." };
  }
  /* What he booked, all of it, and what he can do about it. The Sunday is
     one whose bookings are still open (seatFor asks the cutoff), so changing
     it or giving the seat back is always possible from here. */
  const n = Number(seat.seats) || 0;
  return { ok: true, tag: "book", url: "./",
           title: "You are booked for Sunday",
           body: seat.stop + (seat.time ? ", " + seat.time : "") + "." +
                 (n ? " " + n + (n === 1 ? " seat." : " seats.") : "") +
                 " Tap to change or cancel." };
}

/* WHAT A MAN WITH A SEAT IS TOLD WHILE A REHEARSAL RUNS.

   His seat, from the real bookings, unless the Rota has his route off. The
   checklist calls a route off during a rehearsal to watch the passenger
   page, so a route off then may be a test, and "No bus" on its word would
   keep at home people whose bus is running. "You are booked" would read as
   if the bus runs when the route may really be off. So he is told to open
   the app, under the tag the booking reminders use, which leaves a "No bus"
   already on his screen where it is.

   Except when the last thing he was woken with was that route called off.
   A rehearsal holds that message back, so it went out before this one began
   and was real, and he is told it again. */
async function rehearsalSeatWords(env, sub, seat) {
  if (!seat || !seat.route) return seatWords(seat);
  let off = [];
  try { off = cancelledRoutes(await getRotaRow(env, seat.key), pickupsAndArrivals(await getStops(env))); } catch (e) { off = []; }
  if (off.indexOf(seat.route) === -1) return seatWords(seat);
  if (String((sub && sub.last) || "") === "off|" + seat.key + "|" + seat.route) {
    return offWords(seat.stop, seat.route, seat.key);
  }
  return { ok: true, tag: "book", url: "./", title: "Sunday Bus", body: "Open the app for the latest." };
}

/* ==========================================================================
   THE COORDINATORS' PHONES

   From w2.23.0 every alert that emails the coordinator also reaches the
   phone of everybody holding a coordinator title, so a stopped bus on a
   Sunday morning is not waiting on one person reading one inbox.

   Apps Script decides WHEN, exactly as it decides when to email, and posts
   the alert here (coordAlert). This server decides WHO: every phone signed
   into the driver app, with alerts on, under a name on the Drivers tab whose
   Role is one of the coordinator titles. There is no separate sign-up. The
   person the alert is about (the driver who did the check, the coordinator
   who authorised it) is left out: they already know.

   A push carries nothing, so each phone keeps a small box of alerts here
   (calert:<endpoint>) that pushWhat hands out, oldest first, one per wake.
   A stopped bus goes at any hour. Anything else that arrives in the quiet
   hours (passenger_rules, 21:00 to 08:00) is held and goes on the first
   clock tick after them.

   The words say what happened and to which bus or Sunday, never why: a
   phone joins this list by typing a name, with no PIN, so the details stay
   behind the coordinator's app, which is where the alert sends him.
   ========================================================================== */
const COORD_HELD_KEY = "calert_held";
const COORD_SEEN_KEY = "calert_seen";
const COORD_BOX_MAX = 10;
const COORD_ALERT_MAX_AGE_MS = 24 * 3600 * 1000;
const coordBoxKey = (endpoint) => "calert:" + String(endpoint || "");

/* Every coordinator's phone, less whoever the alert is about. */
async function coordinatorSubs(env, not) {
  const rules = await authRules(env);
  if (!rules.roles.length) return [];
  const marks = rules.roles.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    "SELECT p.* FROM push_subs p JOIN drivers d ON lower(trim(d.name)) = lower(trim(p.driver)) " +
    "WHERE p.role = 'driver' AND d.active = 1 AND lower(trim(d.role)) IN (" + marks + ")"
  ).bind(...rules.roles).all();
  const skip = (Array.isArray(not) ? not : [])
    .map((n) => String(n || "").trim().toLowerCase()).filter(Boolean);
  const seen = {};
  return (results || []).filter((sub) => {
    if (seen[sub.id]) return false;
    seen[sub.id] = 1;
    return skip.indexOf(String(sub.driver || "").trim().toLowerCase()) === -1;
  });
}

function coordAlertOf(a) {
  if (!a || typeof a !== "object") return null;
  const id = String(a.id || "").trim().slice(0, 120);
  const title = String(a.title || "").trim().slice(0, 120);
  if (!id || !title) return null;
  return {
    id, title,
    kind: String(a.kind || "").trim().slice(0, 20),
    body: String(a.body || "").trim().slice(0, 300),
    reg: String(a.reg || "").trim().slice(0, 20),
    urgent: a.urgent === true,
    not: (Array.isArray(a.not) ? a.not : []).map((n) => String(n || "").slice(0, 60)).slice(0, 5),
    at: Date.now()
  };
}

/* Into each phone's box, and the phone woken. pushOne, not wake(): wake
   keeps one tag per phone for the driver's own alerts, and a coordinator who
   is also driving that Sunday would have his driver alert sent twice once
   this had written over it. Duplicates are refused before this, by id. */
async function deliverCoordAlert(env, msg) {
  const subs = await coordinatorSubs(env, msg.not);
  if (!subs.length) return 0;
  const keys = await vapidKeys(env);
  let sent = 0;
  for (const sub of subs) {
    const box = ((await cacheGet(env, coordBoxKey(sub.endpoint))) || [])
      .filter((m) => m && Date.now() - (Number(m.at) || 0) < COORD_ALERT_MAX_AGE_MS);
    box.push(msg);
    while (box.length > COORD_BOX_MAX) box.shift();
    await cachePut(env, coordBoxKey(sub.endpoint), box).run();
    if (await pushOne(env, sub, keys)) sent++;
  }
  return sent;
}

async function handleCoordAlert(env, body) {
  const msg = coordAlertOf(body && body.alert);
  if (!msg) return json({ ok: false, error: "no alert" });

  /* Once each. Apps Script can send the same one twice: a drain that did not
     hear its answer runs again, and an email that failed is tried again on
     the next tick with its phone alert in front of it. */
  const seen = (await cacheGet(env, COORD_SEEN_KEY)) || [];
  if (seen.indexOf(msg.id) !== -1) return json({ ok: true, duplicate: true });
  seen.push(msg.id);
  while (seen.length > 200) seen.shift();
  await cachePut(env, COORD_SEEN_KEY, seen).run();

  if (!msg.urgent && quietNow(await passengerRules(env))) {
    const held = ((await cacheGet(env, COORD_HELD_KEY)) || []).slice(-49);
    held.push(msg);
    await cachePut(env, COORD_HELD_KEY, held).run();
    return json({ ok: true, held: true });
  }
  return json({ ok: true, sent: await deliverCoordAlert(env, msg) });
}

/* On the clock: whatever the quiet hours held, once they are over. Taken off
   the list before it is sent, so two ticks cannot both send it. */
async function releaseCoordAlerts(env) {
  if (quietNow(await passengerRules(env))) return 0;
  const held = (await cacheGet(env, COORD_HELD_KEY)) || [];
  if (!held.length) return 0;
  await env.DB.prepare("DELETE FROM settings WHERE k=?").bind(COORD_HELD_KEY).run();
  let sent = 0;
  for (const msg of held) {
    if (Date.now() - (Number(msg.at) || 0) >= COORD_ALERT_MAX_AGE_MS) continue;
    sent += await deliverCoordAlert(env, msg);
  }
  return sent;
}

/* The oldest alert in this phone's box, taken out, in the words that are true
   now. A stopped bus that has since been authorised says so, so a phone that
   was out of signal is not sent to deal with something already dealt with. */
async function coordAlertNext(env, endpoint) {
  const k = coordBoxKey(endpoint);
  const box = ((await cacheGet(env, k)) || [])
    .filter((m) => m && Date.now() - (Number(m.at) || 0) < COORD_ALERT_MAX_AGE_MS);
  const m = box.shift();
  if (box.length) await cachePut(env, k, box).run();
  else await env.DB.prepare("DELETE FROM settings WHERE k=?").bind(k).run();
  if (!m) return null;

  let title = m.title, text = m.body;
  if (m.kind === "stopped" && m.reg) {
    try {
      const checks = await checksToday(env);
      const rec = Object.keys(checks).find((reg) => reg.toUpperCase() === m.reg.toUpperCase());
      if (rec && checks[rec].state === "authorised") {
        title = m.reg + " is authorised to run";
        text = (checks[rec].by ? checks[rec].by + " authorised it. " : "") + "The defect stays open.";
      }
    } catch (e) { /* the words as sent */ }
  }
  return { ok: true, tag: "c|" + m.id, url: "coord/", title, body: text };
}

async function pushWhat(env, endpoint) {
  /* A TEST ASKED FOR FROM THE APP, answered before anything about the bus.

     The push carries no payload, so without this a test would wake the phone
     and this function would dutifully tell it where the bus is. The person
     doing the testing would then be reading a real sentence about a real
     Sunday and have no way to tell it apart from the thing he was testing.

     Cleared as it is read, so the next push is the ordinary one again. Five
     minutes, because a push held longer than that has failed the test. */
  const tkey = "test:" + String(endpoint || "");
  const test = await cacheGet(env, tkey);
  if (test) {
    await env.DB.prepare("DELETE FROM settings WHERE k=?").bind(tkey).run();
    if (Date.now() - (Number(test.at) || 0) < 5 * 60000) {
      return { ok: true, tag: "test", url: "./",
               title: "Alerts are working",
               body: "Nothing has happened to the bus." };
    }
  }

  /* A COORDINATOR ALERT, when this phone has one waiting. Before the driver's
     own words, because it is the reason this phone was woken: a coordinator
     who is not driving today would otherwise be told "Nothing outstanding". */
  try {
    const c = await coordAlertNext(env, endpoint);
    if (c) return c;
  } catch (e) { /* the ordinary answer, below */ }

  const sub = await env.DB.prepare(
    "SELECT * FROM push_subs WHERE endpoint=?").bind(String(endpoint || "")).first();

  /* Not a phone we know. Still answer with something showable: a push event
     that shows no notification at all is held against the site, and the
     browser eventually stops delivering them. */
  if (!sub) {
    return { ok: true, title: "Sunday Bus", body: "Open the app for the latest.", tag: "bus", url: "./" };
  }

  if (sub.role === "driver") {
    const key = runSunday();

    let all = [];
    try { all = await getStops(env); } catch (e) {}
    const todays = await driverRouteToday(env, sub, key, pickupsAndArrivals(all));
    const route = todays.route;

    /* NOT HIS MORNING, NOTHING TO SAY.

       Every sentence below this line says "your" — your run, your bus, the bus
       has not gone out. The sweep only ever wakes the man the record names, so
       this is not about pushes: it is about what a phone reads when it asks,
       and the record may have changed since it was woken. A driver who is
       nobody's driver today is told nothing, which is what the sweep would
       have told him. */
    if (!todays.mine) {
      return { ok: true, tag: "end", url: "./", title: "Dominion Assembly Transport",
               body: "Nothing outstanding." };
    }

    /* THE WORDS COME FROM THE RECORD, NEVER FROM THE TAG.

       This read the tag wake() had just written, and it was wrong in a way
       the tests caught and a Sunday would not have. The tag is one value per
       subscription. Two things worth saying in one five minute sweep meant
       two buzzes that both resolved to whichever had been written last, so
       the more important one went out over the wire and arrived as nothing.

       The tag is now for dedup only, which is all it was ever good for. What
       the phone is TOLD is worked out here, from the live record, in the same
       order of importance the sweep uses to decide whether to wake him at
       all. A push that sat in a tunnel for ten minutes therefore says what is
       true when he reads it, and two pushes say the one thing that matters
       most rather than the last thing that happened. */
    let t = null;
    try { t = await tripDriverPayload(env, route, "real"); } catch (e) {}

    const d = departStopFor(all, route);
    const due = d && d.time ? londonMoment(key, d.time) : null;
    const when = d && d.time ? d.time : "";
    const now = Date.now();

    if (t && !t.started) {
      let rotaNow = null;
      try { rotaNow = await getRotaRow(env, key); } catch (e) {}
      if (routeCancelled(rotaNow, route)) {
        return { ok: true, tag: "off", url: "./",
                 title: route + " is not running today",
                 body: "Do not take the bus out." };
      }

      /* His bus, stopped by somebody's walkaround. The worst of the four to
         not know, because he finds out at the gate with a bus full of people
         watching him find out. */
      try {
        const buses = await getBuses(env);
        const rotaRow = await getRotaRow(env, key);
        const mine = (await busFor(env, key, route, buses, rotaRow)).reg || "";
        if (mine) {
          const checks = await checksToday(env);
          const rec = Object.keys(checks).find(
            (reg) => reg.toUpperCase() === mine.toUpperCase());
          const state = rec ? checks[rec].state : "";
          if (state === "stopped") {
            return { ok: true, tag: "stopped", url: "./",
                     title: mine + " was stopped by today\u2019s check",
                     /* The same instruction the app itself gives, and for the
                        same reason: which bus goes out when one is condemned
                        is the coordinator's call, not this server's. Generic
                        rather than named, because the coordinator's name lives
                        in config.js on the phone and nothing here has it. */
                     body: "Do not take it out. Ring the coordinator." };
          }
          /* AND THE ANSWER, when it comes. He was told not to drive; this is
             the only way he hears that he may. Worked out from the record
             like everything else here, so a push that sat in a tunnel for ten
             minutes says what is true when he reads it — including, if the
             bus has been stopped again since, that it is stopped again. */
          if (state === "authorised") {
            const by = String((rec && checks[rec].by) || "");
            return { ok: true, tag: "stopped", url: "./",
                     title: mine + " is authorised to run",
                     body: (by ? by + " authorised it. " : "") +
                           "The defect stays open. You can take it out." };
          }
        }
      } catch (e) { /* fall through to whatever else is true */ }

      if (due && now >= due.getTime() && now - due.getTime() < 10 * 60000) {
        return { ok: true, tag: "start", url: "./",
                 title: "Time to set off",
                 body: "Your " + route + " run is due to leave church" + (when ? " at " + when : " now") +
                       ". Tap Start as you pull away." };
      }
      if (due && now - due.getTime() >= 10 * 60000) {
        return { ok: true, tag: "start", url: "./",
                 title: "The bus has not gone out",
                 body: "Your " + route + " run" + (when ? " was due at " + when + "." : ".") +
                       " Nothing has started." };
      }

      /* Nothing wrong. Just the morning, said on the morning. Held to before
         the bus is due, so a phone opened at noon is not told to go and drive
         a run that is hours behind it. */
      /* AND IT IS ACTUALLY HIS MORNING.

         driverRouteToday falls back to the route a phone REGISTERED with when
         the man's name matches nobody on the rota — which is right for the
         messages about a route, and wrong for this one, because this sentence
         is about HIM.

         The reachable case is a stand-down. He is rostered, the sweep wakes
         him at eight, the coordinator swaps him off at ten past, and he opens
         the notification at twenty past: "You are driving today. North. Depart
         09:52 after vehicle check." A man sent to a bus he has just been taken
         off, by the very mechanism written to stop stale words arriving —
         everything else in this section is worked out from the record, and
         this one sentence was not.

         Asked of the record, so a rota edited between the push and the tap is
         the rota that answers. */
      const lp = londonParts(new Date());
      if (lp.dow === 0 && (!due || now < due.getTime())) {
        /* One sentence carrying the ORDER of the morning, not two facts
           listed. The check comes first and the departure follows it, which
           is the thing a label like "North, out at 09:52" never said. The
           title has already said he is driving, so nothing here repeats it.

           It shortens on its own when the spreadsheet has no Depart row for
           the route, and the short form is still a sentence. */
        return { ok: true, tag: "duty", url: "./",
                 title: "You are driving today",
                 body: route + ". Depart " + (when ? when + " " : "") +
                       "after vehicle check." };
      }

      return { ok: true, tag: "end", url: "./", title: "Dominion Assembly Transport", body: "Nothing outstanding." };
    }

    if (t && t.started && !t.ended) {
      const arr = all.filter((x) => x.arrival && x.route === route);
      const last = arr.length ? londonMoment(key, arr[arr.length - 1].time) : null;
      if (last && now >= last.getTime() + 15 * 60000) {
        return { ok: true, tag: "end", url: "./",
                 title: "End the trip",
                 body: "Your " + route + " run is still open." };
      }
      return { ok: true, tag: "end", url: "./",
               title: "Your run is running", body: "Nothing outstanding." };
    }

    return { ok: true, tag: "end", url: "./", title: "Dominion Assembly Transport", body: "Nothing outstanding." };
  }

  /* NEVER THE TEST RUN. While a rehearsal is on, tripPayload describes it:
     the gate is open, and a phone with no seat is lent a test one. So a
     passenger woken then, by a booking reminder or a route called off, is
     told only what is true of his real seat and the real Rota. */
  /* Nor the Rota, on its own word. See rehearsalSeatWords. */
  if (await rehearsalOn(env)) return rehearsalSeatWords(env, sub, await seatFor(env, sub));

  let p = null;
  try { p = await tripPayload(env, sub.ref || "", "", "", sub.pid || ""); } catch (e) {}
  if (!p) return { ok: true, title: "Sunday Bus", body: "Open the app for the latest.", tag: "bus", url: "./" };

  /* NOTHING IS RUNNING. Either bookings are still open for the coming Sunday,
     or they have closed and this phone has no seat. The only thing worth
     saying is about the seat.

     `why: "open"` is the tracking gate and says NOTHING about whether this
     person has booked — it is returned before the booking is even looked up.
     Reading it as "no booking" told a man with a seat to go and book one,
     which is both wrong and the sort of wrong that makes somebody book twice.
     So the booking is asked for here, directly.

     From the record, never from the tag. If he booked in the four minutes
     between the nudge going out and the phone being looked at, what lands
     says he is booked rather than asking him again for something he has
     already done. */
  if (p.why === "nobooking" || p.why === "open") {
    return seatWords(await seatFor(env, sub));
  }

  /* Before anything about a bus, because there is no bus. */
  if (p.why === "cancelled") return offWords(p.stop, p.route, p.date);

  /* THE MORNING IS OVER.

     Above every branch below, because all of them describe a bus on the road
     and once the run has been closed off there is none. Without this,
     picked-up, gone-past and the timetable went on answering all afternoon: a
     man who got off at twenty past ten was still reading "Picked up at Grace
     Rd. Have a good service." at seven in the evening, in place of the one
     thing worth saying to him — that next Sunday is open.

     tripPayload has carried `ended` on every reply it has ever made. This layer
     simply never read it: grep the file before this change and the word does
     not appear once below the payload that sets it. */
  if (p.ended) {
    return seatWords(await seatFor(env, sub));
  }

  const stop = String(p.stop || "your stop");

  if (p.mine === "passed") {
    return { ok: true, tag: "bus", url: "./",
             title: "The bus has gone past",
             body: "It was at " + (p.passedStop || "an earlier stop") +
                   (p.passedAtWords ? " at " + p.passedAtWords : "") +
                   ", and nothing was recorded at " + stop + "." };
  }
  /* The page has always told these two apart; the notification did not, and
     a stop marked Nobody there was told it had been picked up. */
  if (p.mine === "served" && p.servedEvent === "empty") {
    return { ok: true, tag: "bus", url: "./",
             title: "Nobody there at " + stop,
             body: "The driver marked nobody waiting" + (p.servedAt ? " at " + p.servedAt : "") +
                   ". Still there? Open the page." };
  }
  if (p.mine === "served") {
    return { ok: true, tag: "bus", url: "./",
             title: "Picked up at " + stop, body: "Have a good service." };
  }
  /* BE AT YOUR STOP, IN THE BOLD LINE.

     The title is the only part of a notification that is certainly read: it
     is what shows on a locked screen, in a banner that lasts three seconds,
     and in the list of things that arrived while somebody was in a service.
     Everything below it is for whoever taps.

     So the title carries the INSTRUCTION and the body carries the facts.
     "About 8 min to Breck Rd" is a fact, and a fact is something to think
     about; "Be at your stop in about 8 minutes" is a thing to do. The old
     wording survives in the body, where it belongs.

     The stop name moves out of the title for the same reason. A passenger
     knows which stop is his — he booked it — and the four words that tell
     him what to do should not be competing with it for the first line. */
  if (p.mine === "eta" && p.imminent) {
    return { ok: true, tag: "bus", url: "./",
             title: "Be at your stop now",
             body: "The bus is a minute or two from " + stop + "." };
  }
  if (p.mine === "eta" && typeof p.minutes === "number") {
    return { ok: true, tag: "bus", url: "./",
             title: p.minutes <= 0 ? "Be at your stop now"
                                   : "Be at your stop in about " + p.minutes + " min",
             body: stop + ". " +
                   (p.etaWords ? "Around " + p.etaWords + ". " : "") +
                   (p.lastStop ? "It has just left " + p.lastStop + "."
                               : "It has left church.") };
  }
  if (p.started) {
    return { ok: true, tag: "bus", url: "./",
             title: "The bus has left church",
             body: "Yours is timetabled " + (p.scheduled || "shortly") + " at " + stop + "." };
  }

  /* NOTHING HAS RECORDED THE BUS LEAVING, and it was due five minutes ago.
     See wakeNotLeft for why the words go no further than that. */
  if (!p.started && p.route) {
    let dueAt = null;
    try { dueAt = notLeftDue(await getStops(env), runSunday(), p.route, Date.now()); } catch (e) {}
    if (dueAt) {
      return { ok: true, tag: "bus", url: "./",
               title: "No word yet that your bus has left church",
               body: "It was due to leave at " + dueAt + "." +
                     (p.scheduled ? " Yours is timetabled " + p.scheduled + " at " + String(p.stop || "your stop") + "." : "") +
                     " We will message you as soon as it sets off." };
    }
  }

  /* THE FIRST MESSAGE OF THE MORNING. The bus has not started, and he has a
     seat booked on it. Worked out from the record like everything else here,
     so a push that sat in a tunnel until half past ten arrives saying where
     the bus actually is rather than repeating a sentence about eight
     o'clock. */
  if (p.scheduled) {
    return { ok: true, tag: "bus", url: "./",
             title: "Your bus today at " + p.scheduled,
             body: stop + ". Be at your stop a few minutes early." };
  }

  return { ok: true, tag: "bus", url: "./", title: "Sunday Bus",
           body: "Open the app for the latest." };
}

/* ---- WHO HAS NOT GOT ALERTS ON -----------------------------------------

   The thing there was no way to find out.

   Every alert in this system depends on a driver having tapped Turn on, on
   that handset, and having let the phone ask. Nothing anywhere said who had
   and who had not. The bell proves one phone at a time, by hand, and only for
   whoever is holding it. So a coordinator could train nine drivers, believe
   it was done, and discover on a Sunday that three of them never allowed
   notifications: which looks exactly like the alerts being broken.

   Both halves of the answer are already here. The drivers table is synced
   from the Drivers tab, push_subs is written when somebody taps Turn on.

   ASKED ONE DRIVER AT A TIME, WITH DRIVER_SUB_MATCH: the very query that
   wakes him. A report about whether a man will be woken has to ask the same
   question the waking asks, or it is a report about something else. It was a
   join of its own for one afternoon and disagreed with the sweep on both the
   comparison and the column.

   Nine small indexed lookups off a menu nobody runs in a loop. Cheap enough
   that being right by construction is worth more than one clever join.

   Retired drivers are left out. They are kept on the tab for their history
   and are not going to be driving.

   driversOff is null until it is known. Seeded as an empty array, every way
   this can fail — D1 down, the table gone — read to the caller as "nobody is
   missing", and the one failure this whole feature exists to catch was the
   one it rendered as a tick. onRegister is sent for the same reason: an empty
   register also produces an empty missing list, and that is a wiped Drivers
   tab, not good news. */
async function alertRoll(env) {
  const out = { ok: true, driversOff: null, driversOn: 0, onRegister: 0, passengers: 0 };
  try {
    const reg = await env.DB.prepare(
      "SELECT name FROM drivers WHERE active = 1 ORDER BY ord, name").all();
    const names = (reg.results || []).map((r) => String(r.name || "")).filter(Boolean);
    out.onRegister = names.length;

    const off = [];
    for (const name of names) {
      const hit = await env.DB.prepare(
        "SELECT 1 AS n FROM push_subs WHERE " + DRIVER_SUB_MATCH + " LIMIT 1").bind(name).first();
      if (hit) out.driversOn++;
      else off.push(name);
    }
    /* Assigned last, so a throw anywhere above leaves it null. */
    out.driversOff = off;

    const pax = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM push_subs WHERE role <> 'driver'").first();
    out.passengers = Number((pax && pax.n) || 0);
  } catch (err) {
    /* A report that cannot be built is not a reason to answer nothing: the
       version stamp on this reply is the other half of what the caller
       wanted, and json() has already put it there. But it must not come back
       looking like an answer. */
    out.driversOff = null;
    out.rollError = String((err && err.message) || err);
  }
  /* WHOSE NUMBERS IT HOLDS, for the passenger's Message button. From
     w2.29.0. Names only: the sheet already has the numbers, and asks this
     only to find out whether they arrived. null when it could not tell,
     [] when it holds none, which is the fault the check is for. */
  try {
    const book = await cacheGet(env, "driver_wa");
    out.waHeld = (book && typeof book === "object") ? Object.keys(book) : [];
  } catch (err) {
    out.waHeld = null;
  }
  /* WHAT EVERY PHONE HAS ABOUT EACH BUS, from w2.30.0: the due dates the
     driver app warns from, as the sheet last sent them, and how many Vehicle
     Log entries the coordinator's Buses screen holds for each registration.
     Dates and counts only. The sheet holds them against its own tabs, so a
     sync that stops landing is noticed rather than shown as an empty log.
     null when it could not tell. */
  try {
    const extra = (await cacheGet(env, "bus_extra")) || {};
    out.busDates = {};
    for (const r of Object.keys(extra)) out.busDates[r] = Object.assign({}, (extra[r] && extra[r].dates) || {});
  } catch (err) {
    out.busDates = null;
  }
  try {
    const shelf = await cacheGet(env, "coord_shelf");
    const log = (shelf && shelf.vehicles && shelf.vehicles.log) || {};
    out.vlogHeld = {};
    for (const r of Object.keys(log)) out.vlogHeld[r] = (log[r] || []).length;
  } catch (err) {
    out.vlogHeld = null;
  }
  return out;
}

/* ---- signing up --------------------------------------------------------- */

async function handleSubscribe(env, body) {
  const endpoint = String((body && body.endpoint) || "").trim();
  if (!endpoint || endpoint.indexOf("https://") !== 0) {
    return json({ ok: false, error: "no endpoint" });
  }
  const role = String((body && body.role) || "passenger") === "driver" ? "driver" : "passenger";
  const k = (body && body.keys) || {};
  await env.DB.prepare(
    "INSERT INTO push_subs (endpoint,p256dh,auth,role,ref,pid,driver,route,made) " +
    "VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET " +
    "p256dh=excluded.p256dh, auth=excluded.auth, role=excluded.role, ref=excluded.ref, " +
    "pid=excluded.pid, driver=excluded.driver, route=excluded.route, fails=0"
  ).bind(endpoint, String(k.p256dh || ""), String(k.auth || ""), role,
         String((body && body.ref) || ""), String((body && body.pid) || ""),
         String((body && body.driver) || ""), String((body && body.route) || ""),
         Date.now()).run();
  return json({ ok: true });
}

/* ---- confirming a name, in a tenth of a second --------------------------

   This used to be Apps Script's job alone, and Apps Script answers in two to
   eight seconds. The app cached a hash per handset to avoid it, and on the
   coordinator's phone that cache never hit, so every PIN keyed anywhere was a
   round trip taken standing beside a bus.

   Rather than find out why one cache missed, the uncached path is now fast.
   The app still falls back to Apps Script whenever this has no hash to
   compare, so a sheet that has not synced yet behaves exactly as it did.

   The answer shape is Apps Script's, field for field, because the app reads
   one shape and must not learn a second. */
async function pinHashOf(env, name, pin) {
  /* No salt, no match. A random value, fresh every time, equals no stored
     fingerprint: not a real one, not the marker the sheet sends when it has
     no salt either, and not a NULL column, which a constant like null would. */
  if (!pinSaltOf(env)) return "no PIN_SALT " + crypto.randomUUID();
  const norm = pinSaltOf(env) + ":" + String(name || "").trim().toLowerCase() +
               ":" + String(pin || "").replace(/\D/g, "");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return Array.from(new Uint8Array(buf))
    .map((b) => ("0" + b.toString(16)).slice(-2)).join("");
}

function pinTriesKey(name) {
  return "pinfail:" + String(name || "").trim().toLowerCase();
}

async function handlePin(env, body) {
  const name = String((body && body.driver) || "").trim();
  const pin  = String((body && body.pin) || "").replace(/\D/g, "");
  if (!name) return json({ ok: false, error: "no driver" });

  const row = await env.DB.prepare(
    "SELECT name, pin_hash FROM drivers WHERE lower(name)=lower(?)").bind(name).first();

  /* Not a name this server has, or a name it has no hash for. Either way it
     cannot answer, and saying so sends the app to Apps Script rather than
     letting a man through on a shrug. */
  if (!row) return json({ ok: false, error: "unknown driver" });
  if (!row.pin_hash) return json({ ok: true, valid: true, noPin: true });

  /* THE LOCKOUT LIVES HERE NOW, and it had to move with the check.

     Leave it on Apps Script while verifying here and the two count
     separately, which is six tries wearing the label of three. */
  const tkey = pinTriesKey(name);
  const held = await cacheGet(env, tkey);
  const now = Date.now();
  let tries = 0;
  if (held && now - (Number(held.at) || 0) < PIN_LOCK_MINUTES * 60000) {
    tries = Number(held.n) || 0;
  }
  if (tries >= PIN_MAX_TRIES) {
    return json({ ok: true, valid: false, locked: true, minutes: PIN_LOCK_MINUTES });
  }

  const got = await pinHashOf(env, row.name, pin);
  if (pin && got === row.pin_hash) {
    try { await env.DB.prepare("DELETE FROM settings WHERE k=?").bind(tkey).run(); } catch (e) {}
    return json({ ok: true, valid: true });
  }

  try { await cachePut(env, tkey, { n: tries + 1, at: now }).run(); } catch (e) {}
  return json({ ok: true, valid: false, left: Math.max(0, PIN_MAX_TRIES - tries - 1) });
}

/* ==========================================================================
   AUTHORISING A STOPPED BUS
   ==========================================================================
   The second of the two ways out of a check that stopped a bus. The other is
   the Outcome column on the Checks tab, which reaches here through the
   ordinary sync. Both write the same thing and neither one closes the defect.

   THE PIN IS THE LOCK. The role test below decides who is OFFERED the button
   in the app; it is not a security boundary, because the name is picked from
   a dropdown anybody can open, and it is not pretending to be one. What
   cannot be got round is that the four digits are checked against that
   person's own hash, under the same three-try lockout as every other PIN in
   this system, and the name that goes on the record is the name that was
   verified. An authorisation always has somebody to ask about it. */

/* Told by Apps Script on every sync. The fallback is the settled default, so
   a Worker deployed before the next sync still behaves the way the settings
   say rather than refusing everybody or letting anybody through. */
const AUTH_ROLES_FALLBACK = ["Coordinator", "Minister in Charge"];

async function authRules(env) {
  let r = null;
  try { r = await cacheGet(env, "auth_rules"); } catch (e) {}
  const roles = (r && Array.isArray(r.roles) && r.roles.length) ? r.roles : AUTH_ROLES_FALLBACK;
  return {
    roles: roles.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean),
    sameHandBothWays: !(r && r.sameHandBothWays === false)
  };
}

async function handleAuthorise(env, body) {
  const a    = (body && body.authorise) || {};
  const reg  = String(a.reg || "").trim();
  const who  = String(a.who || "").trim();
  const pin  = String(a.pin || "").replace(/\D/g, "");
  if (!reg) return json({ ok: false, error: "no reg" });
  if (!who) return json({ ok: false, error: "no driver" });

  const row = await env.DB.prepare(
    "SELECT name, role, pin_hash FROM drivers WHERE lower(name)=lower(?)").bind(who).first();
  if (!row) return json({ ok: false, error: "unknown driver" });

  const rules = await authRules(env);
  if (rules.roles.indexOf(String(row.role || "").trim().toLowerCase()) === -1) {
    return json({ ok: false, error: "not authorised" });
  }

  /* There has to be something to authorise. Without this a bus with no check
     at all could be signed off, which would read on the record as a
     walkaround that never happened being waved through. */
  const day = londonKey(new Date());
  const chk = await env.DB.prepare(
    "SELECT * FROM checks_today WHERE day=? AND upper(trim(reg))=upper(trim(?))"
  ).bind(day, reg).first();
  if (!chk || chk.state !== "stopped") return json({ ok: false, error: "no check" });

  /* Whether the man who found it may also sign it off. A setting, and the
     server keeps it as well as the app so that turning it off actually turns
     it off rather than only hiding a button. */
  if (!rules.sameHandBothWays &&
      String(chk.driver || "").trim().toLowerCase() === who.toLowerCase()) {
    return json({ ok: false, error: "same hand" });
  }

  /* No hash against the name is not a way in here. Everywhere else in this
     system a driver without a PIN is simply not asked for one, because the
     alternative is a man locked out at a kerb with a check to do. This is the
     opposite case: it lets a bus out with a fault on it, so a name with
     nothing to check against cannot do it. */
  if (!row.pin_hash) return json({ ok: false, error: "no pin" });

  const tkey = pinTriesKey(row.name);
  const held = await cacheGet(env, tkey);
  const now  = Date.now();
  let tries = 0;
  if (held && now - (Number(held.at) || 0) < PIN_LOCK_MINUTES * 60000) tries = Number(held.n) || 0;
  if (tries >= PIN_MAX_TRIES) {
    return json({ ok: false, locked: true, minutes: PIN_LOCK_MINUTES });
  }

  const got = await pinHashOf(env, row.name, pin);
  if (!pin || got !== row.pin_hash) {
    try { await cachePut(env, tkey, { n: tries + 1, at: now }).run(); } catch (e) {}
    return json({ ok: false, error: "bad pin", left: Math.max(0, PIN_MAX_TRIES - tries - 1) });
  }
  try { await env.DB.prepare("DELETE FROM settings WHERE k=?").bind(tkey).run(); } catch (e) {}

  /* Named by the check it lifts, so a later walkaround is never mistaken for
     the one that was signed off, whatever the clocks say. */
  const rec = { reg: reg.toUpperCase(), day: day, by: row.name,
                inspector: String(chk.driver || ""), at: now, via: "app",
                checkId: String(chk.check_id || "") };
  await cachePut(env, authKey(day, reg), rec).run();
  await noteDecision(env, day, reg, rec.checkId, now);

  return json({ ok: true, authorised: true, by: row.name, at: now,
                checkId: rec.checkId });
}

/* ==========================================================================
   CLOSING SOMEBODY ELSE'S RUN
   ==========================================================================

   A driver ends his own run and nobody else's. That is the rule handleTrip
   enforces above, and it is not softened by a confirmation dialog: an "are
   you sure" in front of a destructive act that belongs to another man is not
   a safeguard, it is a speed bump, and the morning it matters is the morning
   somebody taps through it.

   So there is exactly one deliberate way to close a run that is not yours,
   and it is the same shape as authorising a stopped bus: a coordinator, his
   own PIN, checked here, with the same three tries and the same five minute
   lockout. The row lands under the DRIVER'S name, because it was his run and
   the record should go on saying so, and `ended_by` carries the coordinator's
   name, because a run somebody else closed is a different fact from one that
   ended at the kerb.

   The bus being back is not in question here. This is about the record and
   the passenger page, both of which need a run to close so that next week's
   bookings can open. */
async function handleEndRun(env, body) {
  const e     = (body && body.endrun) || {};
  const route = String(e.route || "").trim() || "North";
  const who   = String(e.who || "").trim();
  const pin   = String(e.pin || "").replace(/\D/g, "");
  if (!who) return json({ ok: false, error: "no driver" });

  const row = await env.DB.prepare(
    "SELECT name, role, pin_hash FROM drivers WHERE lower(name)=lower(?)").bind(who).first();
  if (!row) return json({ ok: false, error: "unknown driver" });

  /* The same register of roles that may sign a stopped bus out. Two lists
     would be two things to keep in step and one of them would drift. */
  const rules = await authRules(env);
  if (rules.roles.indexOf(String(row.role || "").trim().toLowerCase()) === -1) {
    return json({ ok: false, error: "not authorised" });
  }

  const key = runSunday();
  let open = null;
  try { open = await tripState(env, key, route); } catch (err) {}
  if (!open || !open.started) return json({ ok: false, error: "no run" });
  if (open.ended) return json({ ok: true, already: true, ended: open.ended });

  /* His own run goes through the ordinary path, where it costs no PIN. This
     is not pedantry: a coordinator who is also driving should not learn that
     ending his own run asks for four digits, because then the day he has to
     close somebody else's he will not notice that it did. */
  if (sameName(open.driver, who)) {
    return json({ ok: false, error: "your own run", hint: "End trip" });
  }

  if (!row.pin_hash) return json({ ok: false, error: "no pin" });

  const tkey = pinTriesKey(row.name);
  const held = await cacheGet(env, tkey);
  const now  = Date.now();
  let tries = 0;
  if (held && now - (Number(held.at) || 0) < PIN_LOCK_MINUTES * 60000) tries = Number(held.n) || 0;
  if (tries >= PIN_MAX_TRIES) return json({ ok: false, locked: true, minutes: PIN_LOCK_MINUTES });

  const got = await pinHashOf(env, row.name, pin);
  if (!pin || got !== row.pin_hash) {
    try { await cachePut(env, tkey, { n: tries + 1, at: now }).run(); } catch (err) {}
    return json({ ok: false, error: "bad pin", left: Math.max(0, PIN_MAX_TRIES - tries - 1) });
  }
  try { await env.DB.prepare("DELETE FROM settings WHERE k=?").bind(tkey).run(); } catch (err) {}

  /* Filed through handleTrip so there is one writer for trip_events and one
     place where a run's rows are shaped. endedBy is what makes this row
     different from an ordinary end; the driver on it is still the man who
     drove. */
  const res = await handleTrip(env, {
    trip: open.trip, route: route, driver: open.driver, reg: open.reg,
    sunday: key, endedBy: row.name,
    events: [{ event: "end", stopId: "", at: now, by: row.name }]
  });
  const out = JSON.parse(await res.text());
  if (!out.ok) return json(out);

  return json({ ok: true, ended: now, by: row.name,
                driver: open.driver, route: route, trip: open.trip });
}

/* ==========================================================================
   THE OUTCOME COLUMN ON THE CHECKS TAB
   ==========================================================================
   The second way out of a stopped bus. Until v1.62.0 of the spreadsheet,
   editing that cell reached nothing: the only thing that ever told this
   server about a check was the check itself, so a coordinator could change
   the cell, watch nothing happen, and still have a bus in the yard.

   ONE EDIT ACTS ON ONE CHECK, the one its row holds, and only if that check
   is still the bus's current one. Tidying the outcome on this morning's
   first walkaround must not release a bus that a second walkaround stopped
   an hour later, or take the signature off it. An edit to a row that is no
   longer current is refused and said so, and the spreadsheet tells the
   person who made it.

     Authorised to run   records a signature naming that check
     anything else       sets the plain state, and takes any signature off,
                         because putting a row back to STOPPED is withdrawing
                         one
   The check keeps its own time throughout; only its state changes. */
/* When the last decision about this bus's current check was made. Kept
   apart from the signature itself, because withdrawing a signature deletes
   it and the time of the withdrawal still has to be known. */
const decisionKey = (day, reg) => "dec:" + day + ":" + String(reg || "").trim().toUpperCase();
async function lastDecision(env, day, reg) {
  try { return await cacheGet(env, decisionKey(day, reg)); } catch (e) { return null; }
}
async function noteDecision(env, day, reg, checkId, at) {
  try {
    const prev = await lastDecision(env, day, reg);
    if (prev && prev.checkId === String(checkId || "") && (Number(prev.at) || 0) >= at) return;
    await cachePut(env, decisionKey(day, reg), { checkId: String(checkId || ""), at: at }).run();
  } catch (e) {}
}

async function handleOutcome(env, body) {
  try { await ensureChecksIn(env); } catch (e) {}
  const edits = Array.isArray(body && body.edits) ? body.edits : [];
  const results = [];
  for (const e of edits) {
    const reg = String(e.reg || "").trim();
    const day = String(e.day || "").trim();
    const cid = String(e.checkId || "");
    const outcome = String(e.outcome || "").trim().toUpperCase();
    if (!reg || !day || !outcome) { results.push({ reg, applied: false, why: "empty" }); continue; }

    const cur = await env.DB.prepare(
      "SELECT * FROM checks_today WHERE day=? AND upper(trim(reg))=upper(trim(?))")
      .bind(day, reg).first();
    if (!cur) { results.push({ reg, applied: false, why: "no check" }); continue; }
    const curId = String(cur.check_id || "");
    if (cid && curId && cid !== curId) {
      results.push({ reg, applied: false, why: "not current" });
      continue;
    }

    const key = authKey(day, reg);
    /* THE LATEST DECISION ABOUT A CHECK STANDS, WHICHEVER ARRIVES FIRST.

       Every decision is dated with when it was MADE, a sheet edit by the
       moment the coordinator changed the cell and an app signature by the
       moment it was keyed, and the date of the last one applied is kept. An
       edit older than that is refused, Authorised or not. Without this, an
       edit held because this server did not answer, and sent again later,
       could undo a decision made after it: a signature coming back over a
       withdrawal, or the reverse. */
    const madeAt = Number(e.madeAt) || Date.now();
    const last = await lastDecision(env, day, reg);
    if (last && (!last.checkId || !(curId || cid) || last.checkId === (curId || cid)) &&
        (Number(last.at) || 0) > madeAt) {
      results.push({ reg, applied: false, why: "superseded" });
      continue;
    }
    if (outcome === "AUTHORISED TO RUN") {
      await cachePut(env, key, {
        reg: reg.toUpperCase(), day: day, by: String(e.by || ""),
        inspector: String(e.inspector || cur.driver || ""), at: madeAt,
        via: "sheet", checkId: curId || cid
      }).run();
      results.push({ reg, applied: true, what: "authorised" });
    } else {
      const state = outcome === "STOPPED" ? "stopped" : "ok";
      await env.DB.prepare("UPDATE checks_today SET state=? WHERE reg=? AND day=?")
        .bind(state, cur.reg, day).run();
      await env.DB.prepare("DELETE FROM settings WHERE k=?").bind(key).run();
      results.push({ reg, applied: true, what: state });
    }
    await noteDecision(env, day, reg, curId || cid, madeAt);
  }
  return json({ ok: true, results });
}

async function handleUnsubscribe(env, body) {
  await env.DB.prepare("DELETE FROM push_subs WHERE endpoint=?")
    .bind(String((body && body.endpoint) || "")).run();
  return json({ ok: true });
}

/* ---- proving the chain --------------------------------------------------

   A rehearsal wakes nobody, deliberately, and the driver's End trip reminder
   waits for a run to be past its arrival time, which a weekday evening never
   is. Between them they left one question permanently unanswered: does the
   push service ACCEPT what this Worker signs. Everything up to that moment is
   exercised; the answer itself never was, and a malformed token looks exactly
   like a quiet Sunday.

   This asks for one push to one phone, the caller's own, and hands back the
   push service's own status code. 401 on a screen beats silence.

   It does NOT go through wake(). wake() skips a phone whose stored tag
   matches the one being sent, so a second test would report success and send
   nothing, and it writes that tag over the dedup state a real Sunday depends
   on. Neither is touched here. */
async function handleTestPush(env, body) {
  const endpoint = String((body && body.endpoint) || "").trim();
  if (!endpoint || endpoint.indexOf("https://") !== 0) {
    return json({ ok: false, error: "no endpoint" });
  }

  const sub = await env.DB.prepare(
    "SELECT * FROM push_subs WHERE endpoint=?").bind(endpoint).first();
  if (!sub) return json({ ok: false, error: "this phone is not signed up for alerts" });

  const tkey = "test:" + endpoint;

  /* One at a time. Catches a double tap, and means the endpoint alone cannot
     be used to buzz somebody's pocket over and over. */
  const pending = await cacheGet(env, tkey);
  if (pending && Date.now() - (Number(pending.at) || 0) < 20000) {
    return json({ ok: false, error: "one is already on its way" });
  }

  /* What the woken phone will be told. Written before the push goes, because
     a fast push service can have the phone asking before this returns. */
  await cachePut(env, tkey, { at: Date.now() }).run();

  const drop = () => env.DB.prepare("DELETE FROM settings WHERE k=?").bind(tkey).run();

  let status = 0, detail = "";
  try {
    const keys = await vapidKeys(env);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": await vapidAuth(env, endpoint, keys),
        "TTL": "60",
        "Content-Length": "0",
        "Urgency": "high"
      }
    });
    status = res.status;
    if (!(res.ok || status === 201)) {
      try { detail = String(await res.text() || "").slice(0, 300); } catch (e) {}
    }
  } catch (e) {
    try { await drop(); } catch (e2) {}
    return json({ ok: false, error: String((e && e.message) || e) });
  }

  /* 404 and 410 are the push service saying this phone is gone for good, and
     the row goes exactly as it would on a Sunday. Saying so is the useful
     part: it names the reason a phone that looks subscribed will never be
     woken again, which is otherwise invisible from the app. */
  if (status === 404 || status === 410) {
    try { await env.DB.prepare("DELETE FROM push_subs WHERE id=?").bind(sub.id).run(); } catch (e) {}
    try { await drop(); } catch (e) {}
    /* gone is flagged separately from the message because the two pages act on
       it: only this case should put the "turn alerts on" offer back. A 500
       from Google on a bad minute must not, or a phone that is perfectly well
       subscribed gets told it is not. */
    return json({ ok: false, status, gone: true,
                  error: "the push service says this phone is gone. Turn alerts off and on again." });
  }

  if (status >= 200 && status < 300) {
    try {
      await env.DB.prepare("UPDATE push_subs SET seen=?, fails=0 WHERE id=?")
        .bind(Date.now(), sub.id).run();
    } catch (e) {}
    return json({ ok: true, status });
  }

  try { await env.DB.prepare("UPDATE push_subs SET fails=fails+1 WHERE id=?").bind(sub.id).run(); } catch (e) {}
  try { await drop(); } catch (e) {}
  return json({ ok: false, status,
                error: detail || ("the push service answered " + status) });
}

/* ==========================================================================
   THE COORDINATOR'S APP
   ==========================================================================

   From w2.18.0 the coordinator does on his phone what he used to open the
   spreadsheet for: who drives or covers a Sunday, which bus goes where, a
   route or a whole Sunday called off and put back, a note on a Sunday, rota
   requests decided, a booking cancelled or made for somebody who rings, a
   defect closed with what was done, and a wrong time on the run record put
   right.

   Every one of them is taken here first, under his PIN, and answered at once.

   A FACT THIS SERVER OWNS is changed here, and reaches the tab by the
   ordinary drain: a booking, a stop time.

   A FACT THE SHEET OWNS is written down here as an action: the rota, a
   request, a defect. Every phone sees it at once, because it is laid over the
   copy the sheet last sent. The drain carries it to the sheet, which applies
   it through the same code a person editing that cell sets going (the status
   rules, the stamp, the emails to the drivers), and then sends a fresh copy
   naming the actions it now includes. From then on the copy speaks for
   itself and the overlay stops.

   THE PIN IS CHECKED ON EVERY CALL, reads included. The reads carry phone
   numbers and the reasons drivers give, which the public rota does not. Same
   three tries and five minute lockout as every other PIN here. */

/* How far back a run can be corrected from the app. Thirteen weeks stay on
   the Trip Events tab (archivePlan in Code.gs), so this is well inside it. */
const FIX_WINDOW_WEEKS = 5;
/* An action the sheet has not reported for this long stops being laid over
   the copy. It is still listed as waiting. */
const COORD_OVERLAY_DAYS = 3;
/* A report asked of the spreadsheet: the health check reads every tab. */
const SHEET_REPORT_MS = 25000;
const DEFECT_STATES = ["Open", "Booked in", "Parts on order", "Monitoring", "Fixed", "Not a defect"];
const DEFECT_CLOSED = ["Fixed", "Not a defect"];
const DEFECT_CRIT = ["YES", "NO"];
const DEFECT_KINDS = ["Defect", "Advisory"];

/* ---- when each renewal next falls due ----------------------------------
   From w2.30.0. A renewal recorded in the coordinator's app keeps the date it
   was actually done, and the next due date is worked out from it here. The
   same rules, word for word, are in Code.gs (for a row typed on the sheet)
   and coord/index.html (to show the date before Save); tests/suites run all
   three over thousands of dates and fail on any disagreement.

     service    twelve months from the day it was done. Due 30 September,
                done 14 October: next due 14 October next year.
     MOT        tested within a month (less a day) before it ran out: it keeps
                its date, a year on. Tested earlier than that, or after it ran
                out: a year from the test, less a day, which is the date a
                certificate carries.
     insurance  renewed in the two months up to its expiry: the policy's
                anniversary, a year on. After it lapsed, or more than two
                months early (a new policy, not a renewal): twelve months from
                the renewal. The anniversary is never carried further than
                that, so a date is never shown later than the cover runs.
     permit     the same as insurance.

   A date typed from the certificate or the policy always wins, and is said
   to have. Every answer carries its reason, which goes on the log. */
const RENEWALS = {
  mot:       { label: "MOT",            column: "MOT due" },
  service:   { label: "Service",        column: "Service due" },
  insurance: { label: "Insurance",      column: "Insurance due" },
  permit:    { label: "Parking permit", column: "Permit due" }
};

function rnParts(k) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k || ""));
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
function rnKey(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  const p2 = (n) => (n < 10 ? "0" : "") + n;
  return t.getUTCFullYear() + "-" + p2(t.getUTCMonth() + 1) + "-" + p2(t.getUTCDate());
}
/* A calendar month later or earlier, kept inside the month it lands in: 31
   March less a month is 28 February (29th in a leap year), and 29 February
   plus a year is 28 February. */
function rnAddMonths(k, n) {
  const p = rnParts(k);
  if (!p) return "";
  const idx = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(idx / 12), m = idx - y * 12 + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return rnKey(y, m, Math.min(p.d, last));
}
function rnAddDays(k, n) {
  const p = rnParts(k);
  return p ? rnKey(p.y, p.m, p.d + n) : "";
}
/* The day before the same date next year, which is how long an MOT
   certificate runs. A test on 29 February runs to 28 February: the same date
   next year does not exist, so it rolls to 1 March, and the day before is the
   28th. Not the same as a year less a day by rnAddMonths, which clamps first
   and would say the 27th. */
function rnYearLessDay(k) {
  const p = rnParts(k);
  return p ? rnAddDays(rnKey(p.y + 1, p.m, p.d), -1) : "";
}
/* Days from a to b: positive when b is later. */
function rnDays(a, b) {
  const x = rnParts(a), y = rnParts(b);
  if (!x || !y) return null;
  return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / 86400000);
}

/* Whether a service done on done may be lined up with an MOT due on mot. */
function lineUpOk(done, mot) {
  return !!(rnParts(done) && rnParts(mot) && mot > rnAddMonths(done, 6) && mot <= rnAddMonths(done, 13));
}

/* { next, how } for one renewal. item is a RENEWALS key; done the day it was
   done; was the due date it had; given a date typed from the paperwork. An
   item that is not a renewal, or a done date that is not a date, gives
   { next: "", how: "" }. */
function rnNextDue(item, done, was, given) {
  if (!RENEWALS[item] || !rnParts(done)) return { next: "", how: "" };
  if (rnParts(given)) {
    return { next: given, how: item === "mot" ? "the date on the certificate" : "the date given" };
  }
  const prior = rnParts(was) ? was : "";
  if (item === "service") return { next: rnAddMonths(done, 12), how: "twelve months from the day it was done" };
  if (item === "mot") {
    if (prior && done <= prior && done >= rnAddDays(rnAddMonths(prior, -1), 1)) {
      return { next: rnAddMonths(prior, 12), how: "kept its date: tested within a month of running out" };
    }
    const next = rnYearLessDay(done);
    if (!prior) return { next: next, how: "a year from the test, less a day" };
    return { next: next, how: done > prior ? "a year from the test, less a day: tested after it ran out"
                                           : "a year from the test, less a day: tested more than a month early" };
  }
  /* insurance and permit */
  if (prior && done <= prior && done >= rnAddMonths(prior, -2)) {
    return { next: rnAddMonths(prior, 12), how: "a year on from the old expiry" };
  }
  return { next: rnAddMonths(done, 12), how: !prior ? "twelve months from the renewal"
                                          : done > prior ? "twelve months from the renewal: it had lapsed"
                                          : "twelve months from the renewal: more than two months before the old one ran out" };
}

/* ---- the vehicle log, on the live server --------------------------------
   From w2.30.0. The coordinator's app records an MOT, a service, a renewal, a
   repair or a booking; this checks it, works out the next due date, and files
   it as a coordinator action (vlog), a correction (vfix) or a job done (job)
   for the sheet to write onto the Vehicle Log, the Buses tab and History.
   Until the sheet names it as applied, getBuses and coordVehiclesView lay it
   over the sheet's copy, so every phone has the new date at once. */
const VLOG_WHAT = ["MOT", "Service", "Insurance", "Parking permit", "Repair", "Tyres", "Other"];
const VLOG_ITEM = { "MOT": "mot", "Service": "service", "Insurance": "insurance", "Parking permit": "permit" };

function rnUk(k) {
  const p = rnParts(k);
  return p ? (p.d < 10 ? "0" : "") + p.d + "/" + (p.m < 10 ? "0" : "") + p.m + "/" + p.y : "";
}
function vlogText(v, n) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n); }
/* A number as a person types it: 45,180 miles, £54.85. */
function vlogNum(v, max, whole) {
  if (v === "" || v == null) return null;
  const t = String(v).replace(/[£,\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  if (!isFinite(n) || n < 0 || n > max) return undefined;
  return whole ? Math.round(n) : Math.round(n * 100) / 100;
}
function vlogDay(v) { const k = String(v || ""); return rnParts(k) && rnKey(+k.slice(0, 4), +k.slice(5, 7), +k.slice(8, 10)) === k ? k : ""; }

/* The sheet's Vehicle Log and jobs to arrange, with what has been recorded
   here and not yet written there laid over them. */
async function coordVehiclesView(env) {
  const shelf = await cacheGet(env, "coord_shelf");
  const v = (shelf && shelf.vehicles) || {};
  const log = {};
  for (const reg of Object.keys(v.log || {})) log[reg] = (v.log[reg] || []).map((x) => Object.assign({}, x));
  const jobs = JSON.parse(JSON.stringify(v.jobs || {}));
  const entry = (b, a, status) => ({
    id: b.logId, what: b.what, status: status, done: b.done || "", bookedFor: b.bookedFor || "",
    was: b.was || "", early: b.early == null ? null : b.early, next: b.next || "", how: b.how || "",
    given: b.given || "", miles: b.miles == null ? null : b.miles, garage: b.garage || "",
    cost: b.cost == null ? null : b.cost, defects: (b.defectNames || []).join("; "),
    notes: b.notes || b.why || "", corrects: b.corrects || "", by: a.by, source: "Coordinator's app",
    recorded: a.made, correctedBy: "", waiting: true });
  for (const a of await coordPending(env, ["vlog", "vfix", "job"])) {
    const b = a.body || {};
    if (a.kind === "job") {
      const j = jobs[b.reg];
      if (j && j.checkId === b.checkId) {
        j.jobs = (j.jobs || []).filter((x) => x !== b.job);
        if (!j.jobs.length) delete jobs[b.reg];
      }
      continue;
    }
    const list = log[b.reg] = log[b.reg] || [];
    if (list.some((x) => x.id === b.logId)) continue;
    if (a.kind === "vfix") {
      for (const r of Object.keys(log)) for (const x of log[r]) if (x.id === b.corrects) x.correctedBy = b.logId;
      list.push(entry(b, a, b.withdraw ? "Withdrawn" : "Correction"));
    } else {
      list.push(entry(b, a, b.status));
    }
  }
  for (const reg of Object.keys(log)) {
    log[reg].sort((p, q) => {
      const a = p.done || p.bookedFor || "", b = q.done || q.bookedFor || "";
      return a < b ? 1 : a > b ? -1 : (Number(q.recorded) || 0) - (Number(p.recorded) || 0);
    });
  }
  return { log, jobs };
}

/* The sheet's Vehicle Log and jobs to arrange, from v1.92.0's sync, kept to
   their shape: registrations to lists of plain rows, forty a bus, and each
   bus's jobs as words. Anything else, or an older sheet that sends none, is
   an empty log. */
function vehiclesShelfOf(v) {
  const out = { log: {}, jobs: {} };
  if (!v || typeof v !== "object") return out;
  const regs = (o) => (o && typeof o === "object" && !Array.isArray(o)) ? Object.keys(o).slice(0, 50) : [];
  for (const reg of regs(v.log)) {
    const list = Array.isArray(v.log[reg]) ? v.log[reg] : [];
    const rows = list.filter((x) => x && typeof x === "object" && !Array.isArray(x)).slice(0, 40);
    if (rows.length) out.log[String(reg).toUpperCase()] = rows;
  }
  for (const reg of regs(v.jobs)) {
    const j = v.jobs[reg];
    if (!j || typeof j !== "object" || !Array.isArray(j.jobs)) continue;
    const jobs = j.jobs.map((x) => vlogText(x, 80)).filter(Boolean).slice(0, 20);
    if (jobs.length) out.jobs[String(reg).toUpperCase()] = { checkId: vlogText(j.checkId, 80), date: vlogDay(j.date),
                                                             driver: vlogText(j.driver, 60), jobs };
  }
  return out;
}

/* The latest standing done row for one renewal, in a view. */
function vlogLatestIn(list, item) {
  let best = null;
  for (const x of list || []) {
    if (x.correctedBy || x.status === "Withdrawn" || VLOG_ITEM[x.what] !== item || !x.done) continue;
    if (["Done", "Estimated", "Correction"].indexOf(x.status) === -1) continue;
    if (!best || x.done > best.done || (x.done === best.done && (Number(x.recorded) || 0) >= (Number(best.recorded) || 0))) best = x;
  }
  return best;
}

async function actVlog(env, me, act, id) {
  const reg = String(act.reg || "").trim().toUpperCase();
  const bus = (await getBuses(env)).find((b) => String(b.reg).toUpperCase() === reg);
  if (!bus) return { ok: false, error: "That bus is not on the Buses tab." };
  const what = String(act.what || "");
  if (VLOG_WHAT.indexOf(what) === -1) return { ok: false, error: "Choose what was done." };
  const booking = act.status === "Booked";
  const today = londonKey(new Date());
  const done = booking ? "" : (vlogDay(act.done) || today);
  if (done && done > today) return { ok: false, error: "That day has not come yet. To record a date ahead, choose Booked." };
  if (done && done < "2000-01-01") return { ok: false, error: "That date is too long ago." };
  const bookedFor = booking ? vlogDay(act.bookedFor) : "";
  if (booking && !bookedFor) return { ok: false, error: "Say the day it is booked for." };
  if (booking && bookedFor < today) return { ok: false, error: "A booking is for a day ahead. For a day gone, record it as done." };
  const item = VLOG_ITEM[what] || "";
  const was = item && !booking ? ((bus.dates || {})[item] || "") : "";
  const given = item && !booking ? vlogDay(act.given) : "";
  let nd = item && !booking ? rnNextDue(item, done, was, given) : { next: "", how: "" };
  /* A service done on the same visit as the MOT may be lined up with it. The
     MOT's date is the one the bus has now, so record the MOT first. Only an
     MOT six to thirteen months off: lined up with one due in three weeks,
     the service would be due in three weeks too. */
  if (item === "service" && !booking && act.withMot && !given && lineUpOk(done, (bus.dates || {}).mot)) {
    nd = { next: bus.dates.mot, how: "lined up with the MOT" };
  }
  const miles = vlogNum(act.miles, 2000000, true), cost = vlogNum(act.cost, 1000000, false);
  if (miles === undefined) return { ok: false, error: "The mileage is not a number of miles." };
  if (cost === undefined) return { ok: false, error: "The cost is not an amount in pounds." };
  const defects = [], defectNames = [];
  if (!booking && Array.isArray(act.defects) && act.defects.length) {
    const open = await coordDefectsView(env);
    /* From w2.31.0 one tick is every report of a fault, so more keys come
       than faults; the name is said once. */
    for (const k of [...new Set(act.defects)].slice(0, 50)) {
      const d = open.find((x) => x.key === k && String(x.reg || "").toUpperCase() === reg);
      if (!d) return { ok: false, error: "One of those defects is not open on this bus any more. Refresh and try again." };
      defects.push(d.key);
      if (defectNames.indexOf(d.item) === -1) defectNames.push(d.item);
    }
  }
  const body = {
    logId: "L-" + id, reg: reg, what: what, status: booking ? "Booked" : "Done",
    done: done, bookedFor: bookedFor, was: was, early: was && done ? rnDays(was, done) : null,
    next: nd.next, how: nd.how, given: given, miles: miles, garage: vlogText(act.garage, 80), cost: cost,
    defects: defects, defectNames: defectNames, notes: vlogText(act.notes, 500)
  };
  const words = reg + ": " + what + (booking ? " booked for " + rnUk(bookedFor) : " done " + rnUk(done)) +
                (nd.next ? ". Next due " + rnUk(nd.next) : "") +
                (defectNames.length ? ". Put right: " + defectNames.join(", ") : "") + ".";
  return { ok: true, sunday: "", body: body, words: words };
}

/* A correction or a withdrawal of one entry. The next due date is worked out
   again from the corrected facts and the date the bus had before the entry,
   and the dates the bus will have once it is written go with it (targets),
   so getBuses can show them before the sheet has. */
async function actVfix(env, me, act, id) {
  const view = await coordVehiclesView(env);
  let orig = null, origReg = "";
  for (const r of Object.keys(view.log)) for (const x of view.log[r]) if (x.id && x.id === act.corrects) { orig = x; origReg = r; }
  if (!orig) return { ok: false, error: "That entry is not on the Vehicle Log. Refresh and try again." };
  if (orig.correctedBy) return { ok: false, error: "That entry has already been corrected. Correct the correction instead." };
  if (orig.status === "Withdrawn") return { ok: false, error: "That entry was withdrawn." };
  const withdraw = !!act.withdraw;
  const why = vlogText(act.why, 300);
  const today = londonKey(new Date());
  let body;
  if (withdraw) {
    body = { logId: "C-" + id, corrects: orig.id, reg: origReg, what: orig.what, withdraw: true, why: why };
  } else {
    const what = VLOG_WHAT.indexOf(String(act.what || "")) !== -1 ? String(act.what) : orig.what;
    const booking = orig.status === "Booked";
    const done = booking ? "" : (vlogDay(act.done) || orig.done);
    if (done && done > today) return { ok: false, error: "That day has not come yet." };
    const bookedFor = booking ? (vlogDay(act.bookedFor) || orig.bookedFor) : "";
    const item = VLOG_ITEM[what] || "";
    const was = orig.was || "";
    const given = item && !booking ? vlogDay(act.given) : "";
    const nd = item && !booking ? rnNextDue(item, done, was, given) : { next: "", how: "" };
    const miles = act.miles === undefined ? orig.miles : vlogNum(act.miles, 2000000, true);
    const cost = act.cost === undefined ? orig.cost : vlogNum(act.cost, 1000000, false);
    if (miles === undefined) return { ok: false, error: "The mileage is not a number of miles." };
    if (cost === undefined) return { ok: false, error: "The cost is not an amount in pounds." };
    body = { logId: "C-" + id, corrects: orig.id, reg: origReg, what: what, withdraw: false, why: why,
             status: booking ? "Booked" : "Done", done: done, bookedFor: bookedFor, was: was,
             early: was && done ? rnDays(was, done) : null, next: nd.next, how: nd.how, given: given,
             miles: miles, cost: cost,
             garage: act.garage === undefined ? orig.garage : vlogText(act.garage, 80),
             notes: act.notes === undefined ? orig.notes : vlogText(act.notes, 500) };
  }
  /* The bus's dates once this is written: the latest standing entry for each
     renewal it touches, or the date it had before the entry if none is left. */
  const list = (view.log[origReg] || []).map((x) => Object.assign({}, x));
  for (const x of list) if (x.id === orig.id) x.correctedBy = body.logId;
  if (!withdraw) list.push({ id: body.logId, what: body.what, status: "Correction", done: body.done,
                             next: body.next, recorded: Date.now() });
  const targets = [];
  for (const item of [VLOG_ITEM[orig.what], VLOG_ITEM[body.what]].filter((x, i, a) => x && a.indexOf(x) === i)) {
    const latest = vlogLatestIn(list, item);
    const next = latest ? latest.next : (VLOG_ITEM[orig.what] === item ? orig.was : "");
    if (rnParts(next)) targets.push({ reg: origReg, item: item, next: next });
  }
  body.targets = targets;
  const words = origReg + ": " + orig.what + (withdraw ? " entry withdrawn" : " entry corrected") +
                (!withdraw && body.next ? ". Next due " + rnUk(body.next) : "") + (why ? ". " + why : "") + ".";
  return { ok: true, sunday: "", body: body, words: words };
}

async function actJob(env, me, act) {
  const reg = String(act.reg || "").trim().toUpperCase();
  const view = await coordVehiclesView(env);
  const j = view.jobs[reg];
  const job = String(act.job || "");
  if (!j || j.checkId !== String(act.checkId || "") || (j.jobs || []).indexOf(job) === -1) {
    return { ok: false, error: "That job is not waiting any more. Refresh and try again." };
  }
  return { ok: true, sunday: "", body: { reg: reg, job: job, checkId: j.checkId, note: vlogText(act.note, 200) },
           words: reg + ": " + job + ", done." };
}
/* ---- the Drivers tab from the coordinator's app, from w2.34.0 ----------

   A change to a driver, or a new one. The drivers table is changed at once,
   so the rota's name lists and the sign-in screens have it now; the sheet
   files it on the Drivers tab at its next drain, and laid back over each push
   until then. The PIN is never here: it is set on the sheet. */
const DRIVER_ROUTES = ["North", "South"];
const DRIVER_NAME = /^[A-Za-z][A-Za-z .'-]{1,39}$/;
const DRIVER_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DRIVER_PHONE = /^\+?[0-9 ()-]{7,20}$/;

async function coordDriversView(env) {
  const shelf = await cacheGet(env, "coord_shelf");
  let list;
  if (shelf && Array.isArray(shelf.drivers)) {
    list = shelf.drivers.map((d) => ({ name: String(d.name || ""), role: String(d.role || ""), active: d.active !== false,
      order: Number(d.order) || 0, route: d.route === "South" ? "South" : "North",
      email: String(d.email || ""), phone: String(d.phone || ""), hasPin: !!d.hasPin }));
  } else {
    const q = await env.DB.prepare("SELECT name, role, route, ord, active, pin_hash FROM drivers").all();
    list = (q.results || []).map((x) => ({ name: x.name, role: x.role || "", active: Number(x.active) !== 0,
      order: Number(x.ord) || 0, route: String(x.route || "").toUpperCase().charAt(0) === "S" ? "South" : "North",
      email: "", phone: "", hasPin: !!x.pin_hash, noContact: true }));
  }
  for (const a of await coordPending(env, ["driver"])) {
    const b = a.body || {};
    let d = list.find((x) => x.name.toLowerCase() === String(b.name || "").toLowerCase());
    if (!d && b.add) { d = { name: b.name, role: "", active: true, order: 0, route: "North", email: "", phone: "", hasPin: false }; list.push(d); }
    if (!d) continue;
    Object.assign(d, b.set || {});
    d.waiting = true;
  }
  const roles = (shelf && Array.isArray(shelf.driverRoles) && shelf.driverRoles.length)
    ? shelf.driverRoles.map(String) : ["Driver", "Coordinator"];
  for (const d of list) if (d.role && roles.map((r) => r.toLowerCase()).indexOf(d.role.toLowerCase()) === -1) roles.push(d.role);
  return { drivers: list.sort((x, y) => x.route.localeCompare(y.route) || (x.order || 99) - (y.order || 99) ||
                                         x.name.localeCompare(y.name)), roles: roles };
}

function driverSql(env, name, add, set) {
  if (add) {
    return env.DB.prepare("INSERT OR IGNORE INTO drivers (name, role, route, ord, active, pin_hash) VALUES (?,?,?,?,?,'')")
      .bind(name, set.role || "", set.route || "North", Number(set.order) || 0, set.active === false ? 0 : 1);
  }
  const cols = [], vals = [];
  if (set.role !== undefined) { cols.push("role=?"); vals.push(set.role); }
  if (set.route !== undefined) { cols.push("route=?"); vals.push(set.route); }
  if (set.order !== undefined) { cols.push("ord=?"); vals.push(Number(set.order) || 0); }
  if (set.active !== undefined) { cols.push("active=?"); vals.push(set.active ? 1 : 0); }
  if (!cols.length) return null;
  return env.DB.prepare("UPDATE drivers SET " + cols.join(", ") + " WHERE name=? COLLATE NOCASE").bind(...vals, name);
}

async function reapplyDrivers(env) {
  const acts = await coordPending(env, ["driver"]);
  const stmts = [];
  for (const a of acts) {
    const st = driverSql(env, a.body.name, !!a.body.add, a.body.set || {});
    if (st) stmts.push(st);
    if (a.body.add) { const up = driverSql(env, a.body.name, false, a.body.set || {}); if (up) stmts.push(up); }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

async function actDriver(env, me, act) {
  const add = !!act.add;
  const name = String(act.name || "").replace(/\s+/g, " ").trim();
  if (!DRIVER_NAME.test(name)) return { ok: false, error: "Type the driver's name, letters only." };
  const view = await coordDriversView(env);
  const d = view.drivers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (add && d) return { ok: false, error: name + " is already a driver." };
  if (!add && !d) return { ok: false, error: name + " is not on the live server's list. Refresh and try again." };
  const inp = act.set || {};
  const set = {};
  if (inp.role !== undefined) {
    const r = view.roles.find((x) => x.toLowerCase() === String(inp.role).trim().toLowerCase());
    if (!r) return { ok: false, error: "Pick a role from the list." };
    set.role = r;
  }
  if (inp.route !== undefined) {
    if (DRIVER_ROUTES.indexOf(inp.route) === -1) return { ok: false, error: "Pick North or South." };
    set.route = inp.route;
  }
  if (inp.active !== undefined) set.active = inp.active === true;
  if (inp.order !== undefined) {
    const n = Number(inp.order);
    if (!Number.isInteger(n) || n < 0 || n > 99) return { ok: false, error: "Primary order is a number from 0 to 99." };
    set.order = n;
  }
  if (inp.email !== undefined) {
    const e = String(inp.email || "").trim();
    if (e && (e.length > 100 || !DRIVER_EMAIL.test(e))) return { ok: false, error: "Check the email address." };
    set.email = e;
  }
  if (inp.phone !== undefined) {
    const p = String(inp.phone || "").trim();
    if (p && !DRIVER_PHONE.test(p)) return { ok: false, error: "Check the phone number." };
    set.phone = p;
  }
  if (add) {
    if (!set.route) return { ok: false, error: "Pick North or South." };
    if (!set.role) set.role = "Driver";
    if (set.active === undefined) set.active = true;
  } else {
    for (const k of Object.keys(set)) if (set[k] === d[k] && !(d.noContact && (k === "email" || k === "phone"))) delete set[k];
    if (!Object.keys(set).length) return { ok: false, error: "Nothing to change." };
  }
  const words = [];
  if (set.role !== undefined) words.push(set.role);
  if (set.route !== undefined) words.push(set.route);
  if (set.active !== undefined) words.push(set.active ? "active" : "not active");
  if (set.order !== undefined && (set.order || !add)) words.push("primary order " + set.order);
  if (set.email !== undefined && (set.email || !add)) words.push(set.email ? (add ? "email" : "email changed") : "email taken off");
  if (set.phone !== undefined && (set.phone || !add)) words.push(set.phone ? (add ? "phone" : "phone changed") : "phone taken off");
  const st = driverSql(env, add ? name : d.name, add, set);
  return { ok: true, sunday: "", stmts: st ? [st] : [],
           body: { name: add ? name : d.name, add: add, set: set },
           words: (add ? name + " added: " : d.name + ": ") + words.join(", ") + "." };
}

/* ---- the Buses tab from the coordinator's app, from w2.35.0 ------------

   Seats, Active, Route in odd months and Notes, and a new bus. Nothing is
   written to the buses table: getBuses lays each change over it until the
   sheet has filed it on the Buses tab, so the seat counts and the rotation
   have it at once and a push from the sheet cannot undo it. The due dates
   are the Vehicle Log's. */
const BUS_REG = /^[A-Z0-9][A-Z0-9 ]{1,9}$/;
const busKey = (r) => String(r || "").toUpperCase().replace(/\s+/g, "");

/* One change laid over the list getBuses builds. */
function busEditApply(list, b) {
  let x = list.find((y) => busKey(y.reg) === busKey(b.reg));
  if (!x && b.add && busKey(b.reg)) {
    x = { reg: String(b.reg), seats: 0, active: true, dates: {}, oddRoute: "", notes: "", noNotes: false };
    list.push(x);
  }
  if (!x) return;
  const s = b.set || {};
  if (s.seats !== undefined) x.seats = Number(s.seats) || 0;
  if (s.active !== undefined) x.active = s.active === true;
  if (s.oddRoute !== undefined) x.oddRoute = s.oddRoute === "North" || s.oddRoute === "South" ? s.oddRoute : "";
  if (s.notes !== undefined) { x.notes = String(s.notes || ""); x.noNotes = false; }
  x.waiting = true;
  for (const o of b.also || []) {
    const y = list.find((z) => busKey(z.reg) === busKey(o && o.reg));
    if (!y || y === x) continue;
    y.oddRoute = o.oddRoute === "North" || o.oddRoute === "South" ? o.oddRoute : "";
    y.waiting = true;
  }
}

async function actBus(env, me, act) {
  const add = !!act.add;
  const reg = String(act.reg || "").toUpperCase().replace(/\s+/g, " ").trim();
  /* The format is asked of a new bus only. One already on the tab is found
     however it was typed there. */
  if (add ? !BUS_REG.test(reg) : !busKey(reg)) return { ok: false, error: "Type the registration, letters and numbers only." };
  const buses = await getBuses(env);
  const x = buses.find((b) => busKey(b.reg) === busKey(reg));
  if (add && x) return { ok: false, error: x.reg + " is already a bus." };
  if (!add && !x) return { ok: false, error: reg + " is not on the live server's list. Refresh and try again." };
  const inp = act.set || {};
  const set = {};
  if (inp.seats !== undefined) {
    const n = Number(inp.seats);
    if (!Number.isInteger(n) || n < 1 || n > 50) return { ok: false, error: "Seats is a number from 1 to 50." };
    set.seats = n;
  }
  if (inp.active !== undefined) set.active = inp.active === true;
  if (inp.oddRoute !== undefined) {
    const r = String(inp.oddRoute || "");
    if (r && DRIVER_ROUTES.indexOf(r) === -1) return { ok: false, error: "Pick North, South or Standby." };
    set.oddRoute = r;
  }
  if (inp.notes !== undefined) {
    if (x && x.noNotes) return { ok: false, error: "Change these notes on the Buses tab." };
    const t = String(inp.notes || "").replace(/\r\n?/g, "\n").trim();
    if (t.length > 500) return { ok: false, error: "Notes are 500 characters at most." };
    set.notes = t;
  }
  if (add) {
    if (!set.seats) return { ok: false, error: "Seats is a number from 1 to 50." };
    if (set.active === undefined) set.active = true;
    if (set.oddRoute === undefined) set.oddRoute = "";
  } else {
    for (const k of Object.keys(set)) if (set[k] === x[k]) delete set[k];
    if (!Object.keys(set).length) return { ok: false, error: "Nothing to change." };
  }
  /* Two buses on one route in odd months would leave the rotation to
     whichever comes first on the tab. The bus that had the route takes this
     one's old route, or none. */
  const name = add ? reg : x.reg;
  const was = add ? { active: false, oddRoute: "" } : x;
  const nowActive = set.active !== undefined ? set.active : was.active;
  const nowRoute = set.oddRoute !== undefined ? set.oddRoute : was.oddRoute;
  const also = [];
  if (nowActive && nowRoute && (set.oddRoute !== undefined || set.active === true)) {
    const back = was.active && was.oddRoute && was.oddRoute !== nowRoute ? was.oddRoute : "";
    for (const y of buses) {
      if (busKey(y.reg) === busKey(name) || !y.active || y.oddRoute !== nowRoute) continue;
      also.push({ reg: y.reg, oddRoute: back });
    }
  }
  const words = [];
  if (set.seats !== undefined) words.push(set.seats + " seats");
  if (set.active !== undefined && (!add || !set.active)) words.push(set.active ? "in use" : "not in use");
  if (set.oddRoute !== undefined && (set.oddRoute || !add)) words.push(set.oddRoute ? set.oddRoute + " in odd months" : "standby");
  if (set.notes !== undefined && (set.notes || !add)) words.push(set.notes ? (add ? "notes" : "notes changed") : "notes taken off");
  let said = (add ? name + " added: " : name + ": ") + words.join(", ") + ".";
  for (const o of also) said += " " + o.reg + ": " + (o.oddRoute ? o.oddRoute + " in odd months" : "standby") + ".";
  const body = { reg: name, add: add, set: set };
  if (also.length) body.also = also;
  return { ok: true, sunday: "", body: body, words: said };
}

/* ---- the Bus Stops tab from the coordinator's app, from w2.35.0 --------

   A stop's Time, place, Postcode, Where, Active and Type, and a new stop. The
   stops table is changed at once, so the driver app and the passenger page
   have it now; the sheet files it on the Bus Stops tab at its next drain, and
   it is laid back over each push until then. A new postcode clears the pin,
   which was the old kerb's. */
const STOP_TYPES = ["Pickup", "Arrival", "Depart"];
const STOP_TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const STOP_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;

/* 9:52 typed on the tab as text reads 09:52, so times compare as text. */
function stopTime(t) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(t == null ? "" : t));
  return m ? m[1].padStart(2, "0") + ":" + m[2] : String(t == null ? "" : t).trim();
}
/* Spacing and capitals are not a new postcode. */
const postcodeKey = (p) => String(p || "").replace(/\s+/g, "").toUpperCase();

function stopNorm(s) {
  const t = String(s.type || "");
  return { id: String(s.id || ""), route: s.route === "South" ? "South" : "North", time: stopTime(s.time),
           stop: String(s.stop || ""), postcode: String(s.postcode || ""), where: String(s.where || ""),
           active: s.active !== false, type: STOP_TYPES.indexOf(t) !== -1 ? t : "Pickup",
           lat: numOrNull(s.lat), lng: numOrNull(s.lng), hasPin: !!s.hasPin };
}

/* Where a new stop goes: after the last stop in use on its route timed no
   later than it (a Depart first, an Arrival last). A switched-off row keeps
   whatever time it had, so it says nothing about the place. Code.gs
   stopInsertAfter, by index. */
function stopInsertIndex(list, route, time, type) {
  let first = -1, last = -1, after = -1;
  list.forEach((x, i) => {
    if (x.route !== route) return;
    if (first === -1) first = i;
    last = i;
    if (!x.active || x.type === "Arrival") return;
    if (x.type === "Depart" || (x.time && x.time <= time)) after = i;
  });
  if (first === -1) return list.length;
  if (type === "Depart") return first;
  if (type === "Arrival") return last + 1;
  return after === -1 ? first : after + 1;
}

/* Code.gs stopOrderProblem: the changed stop against its own neighbours. */
function stopOrderProblem(list, s) {
  if (!s.active) return "";
  const on = list.filter((x) => x.active && x.route === s.route);
  const i = on.indexOf(s);
  if (i === -1) return "";
  const others = (type) => on.filter((x) => x !== s && x.type === type);
  if (s.type === "Depart" && (others("Depart").length || i !== 0)) return "Depart is the first stop on a route, and there is one.";
  if (s.type === "Arrival" && (others("Arrival").length || i !== on.length - 1)) return "Arrival is the last stop on a route, and there is one.";
  if (s.type === "Pickup" && on.slice(0, i).some((x) => x.type === "Arrival")) return "Move its row above the Arrival on the Bus Stops tab first.";
  if (s.type === "Pickup" && on.slice(i + 1).some((x) => x.type === "Depart")) return "Move its row below the Depart on the Bus Stops tab first.";
  const prev = on[i - 1], next = on[i + 1];
  if ((prev && s.time < prev.time) || (next && next.time && s.time > next.time)) {
    return "Pick a time " + (prev ? "from " + prev.time : "up to ") + (prev && next ? " to " : "") +
           (next ? next.time : prev ? " or later" : "") + ".";
  }
  return "";
}

/* The next number on a route: one more than the highest already on the tab,
   switched-off rows included, so no number is ever used twice. */
function nextStopId(list, route) {
  let pre = route === "South" ? "S" : "N", top = 0, wide = 2;
  for (const x of list) {
    const m = /^([A-Za-z]+)(\d+)$/.exec(x.id);
    if (!m || x.route !== route) continue;
    pre = m[1].toUpperCase();
    top = Math.max(top, Number(m[2]));
    wide = Math.max(wide, m[2].length);
  }
  let id;
  do { id = pre + String(++top).padStart(wide, "0"); } while (list.some((x) => x.id.toUpperCase() === id));
  return id;
}

/* One change laid over the list the shelf holds. */
function stopEditApply(list, b) {
  const id = String(b.id || "").toUpperCase();
  const set = b.set || {};
  let x = list.find((s) => s.id.toUpperCase() === id);
  if (!x && b.add && b.full) {
    x = stopNorm(Object.assign({ id: id, active: true }, b.full));
    list.splice(stopInsertIndex(list, x.route, x.time, x.type), 0, x);
  }
  if (!x) return;
  for (const k of ["time", "stop", "postcode", "where", "type"]) if (set[k] !== undefined) x[k] = String(set[k]);
  if (set.active !== undefined) x.active = set.active === true;
  if (b.pinCleared) { x.lat = null; x.lng = null; x.hasPin = false; }
  x.waiting = true;
}

async function coordStopsView(env) {
  const shelf = await cacheGet(env, "coord_shelf");
  if (!shelf || !Array.isArray(shelf.stops)) return null;
  const list = shelf.stops.map(stopNorm);
  for (const a of await coordPending(env, ["stop"])) stopEditApply(list, a.body || {});
  return { stops: list };
}

const stopKind = (t) => t === "Depart" ? "depart" : t === "Arrival" ? "arrival" : "pickup";

/* What one change does to the stops table. A stop switched off leaves it, as
   the sheet's push would leave it out; one added or switched on goes in after
   the last of its route timed no later than it. */
function stopSql(env, b, pins) {
  const set = b.set || {};
  const id = String(b.id || "");
  if (set.active === false) return [env.DB.prepare("DELETE FROM stops WHERE stop_id=?").bind(id)];
  if (b.add || set.active === true) {
    const f = b.full || {};
    const k = stopKind(f.type);
    const r = f.route === "South" ? "South" : "North";
    const t = String(f.time || "");
    /* A pickup goes halfway to the next stop, so a second one added in the
       same gap goes between the first and that stop, not level with it. */
    const prev = "(SELECT MAX(seq) FROM stops WHERE route=?1 AND stop_id<>?2 AND kind<>'arrival' " +
                 "AND (kind='depart' OR time<=?3))";
    const seq = k === "depart" ? "(SELECT MIN(seq) FROM stops WHERE route=?1 AND stop_id<>?2) - 0.5"
              : k === "arrival" ? "(SELECT MAX(seq) FROM stops WHERE route=?1 AND stop_id<>?2) + 0.5"
              : "COALESCE((" + prev + " + COALESCE((SELECT MIN(seq) FROM stops WHERE route=?1 AND stop_id<>?2 " +
                "AND seq>" + prev + "), " + prev + " + 1)) / 2.0, " +
                "(SELECT MIN(seq) FROM stops WHERE route=?1 AND stop_id<>?2) - 0.5)";
    const vals = "?2, ?1, ?3, ?4, ?5, ?6, ?7, COALESCE(" + seq + ", (SELECT MAX(seq) FROM stops) + 1, 0)" +
                 (pins ? ", ?8, ?9" : "");
    const st = env.DB.prepare("INSERT OR REPLACE INTO stops (stop_id, route, time, stop, postcode, place, kind, seq" +
                              (pins ? ", lat, lng" : "") + ") VALUES (" + vals + ")");
    const binds = [r, id, t, String(f.stop || ""), String(f.postcode || ""), String(f.where || ""), k];
    if (pins) binds.push(b.pinCleared ? null : numOrNull(f.lat), b.pinCleared ? null : numOrNull(f.lng));
    return [st.bind(...binds)];
  }
  const cols = [], vals = [];
  if (set.time !== undefined) { cols.push("time=?"); vals.push(String(set.time)); }
  if (set.stop !== undefined) { cols.push("stop=?"); vals.push(String(set.stop)); }
  if (set.postcode !== undefined) { cols.push("postcode=?"); vals.push(String(set.postcode)); }
  if (set.where !== undefined) { cols.push("place=?"); vals.push(String(set.where)); }
  if (set.type !== undefined) { cols.push("kind=?"); vals.push(stopKind(set.type)); }
  if (b.pinCleared && pins) cols.push("lat=NULL", "lng=NULL");
  if (!cols.length) return [];
  return [env.DB.prepare("UPDATE stops SET " + cols.join(", ") + " WHERE stop_id=?").bind(...vals, id)];
}

async function reapplyStops(env) {
  const acts = await coordPending(env, ["stop"]);
  if (!acts.length) return 0;
  const pins = await ensureStopPins(env);
  let n = 0;
  /* One at a time: a stop going in takes its place from the rows already
     there, the one before it included. */
  for (const a of acts) {
    for (const st of stopSql(env, a.body || {}, pins)) { await st.run(); n++; }
  }
  return n;
}

async function actStop(env, me, act) {
  const view = await coordStopsView(env);
  if (!view) return { ok: false, error: "The Bus Stops tab has not reached the live server yet. Try again in a few minutes." };
  const list = view.stops;
  const add = !!act.add;
  const inp = act.set || {};
  let id, x = null;
  if (add) {
    if (["North", "South"].indexOf(inp.route) === -1) return { ok: false, error: "Pick North or South." };
    id = nextStopId(list, inp.route);
  } else {
    /* stopId: act.id is the action's own. */
    id = String(act.stopId || "").toUpperCase().trim();
    x = list.find((s) => s.id.toUpperCase() === id) || null;
    if (!x) return { ok: false, error: (id || "That stop") + " is not on the live server's list. Refresh and try again." };
    id = x.id;
  }
  const set = {};
  if (inp.time !== undefined) {
    const m = STOP_TIME.exec(String(inp.time || "").trim());
    if (!m) return { ok: false, error: "Type the time as 10:35." };
    set.time = m[1].padStart(2, "0") + ":" + m[2];
  }
  if (inp.stop !== undefined) {
    const t = String(inp.stop || "").replace(/\s+/g, " ").trim();
    if (t.length < 2 || t.length > 120) return { ok: false, error: "Type the stop's name." };
    set.stop = t;
  }
  if (inp.postcode !== undefined) {
    const p = String(inp.postcode || "").toUpperCase().replace(/\s+/g, "");
    if (p && !STOP_POSTCODE.test(p)) return { ok: false, error: "Check the postcode." };
    set.postcode = p ? p.slice(0, -3) + " " + p.slice(-3) : "";
  }
  if (inp.where !== undefined) {
    const w = String(inp.where || "").replace(/\s+/g, " ").trim();
    if (w.length > 200) return { ok: false, error: "Where is 200 characters at most." };
    set.where = w;
  }
  if (inp.active !== undefined) set.active = inp.active === true;
  if (inp.type !== undefined) {
    if (STOP_TYPES.indexOf(inp.type) === -1) return { ok: false, error: "Pick Pickup, Arrival or Depart." };
    set.type = inp.type;
  }
  if (add) {
    if (!set.time) return { ok: false, error: "Type the time as 10:35." };
    if (!set.stop) return { ok: false, error: "Type the stop's name." };
    set.route = inp.route;
    if (set.active === undefined) set.active = true;
    if (!set.type) set.type = "Pickup";
    if (set.postcode === undefined) set.postcode = "";
    if (set.where === undefined) set.where = "";
  } else {
    const flat = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
    for (const k of Object.keys(set)) {
      const same = k === "postcode" ? postcodeKey(set[k]) === postcodeKey(x[k])
                 : k === "stop" || k === "where" ? set[k] === flat(x[k]) : set[k] === x[k];
      if (same) delete set[k];
    }
    if (!Object.keys(set).length) return { ok: false, error: "Nothing to change." };
  }

  /* The stop as it would be, in its place on the route. */
  const next = Object.assign(x ? Object.assign({}, x) : stopNorm({ id: id, route: inp.route }), set);
  const trial = list.slice();
  if (x) trial[trial.indexOf(x)] = next;
  else trial.splice(stopInsertIndex(list, next.route, next.time, next.type), 0, next);
  const wrong = stopOrderProblem(trial, next);
  if (wrong) return { ok: false, error: wrong };

  /* Seats booked there: a stop nobody can be picked up at any more would
     leave them standing. */
  if (x && x.active && x.type === "Pickup" && (set.active === false || (set.type && set.type !== "Pickup"))) {
    /* From the Sunday the booking page offers: once this morning's run is
       over, its seats have been used. */
    let from = runSunday();
    try { from = await busCurrentSunday(env, pickupsAndArrivals(await getStops(env))); } catch (e) {}
    const q = await env.DB.prepare(
      "SELECT COALESCE(SUM(seats),0) AS n FROM bookings WHERE stop_id=? AND sunday>=? AND lower(status)='booked'")
      .bind(x.id, from).first();
    const n = Number(q && q.n) || 0;
    if (n) return { ok: false, error: seatWord(n) + " booked at " + x.id + ". Cancel " + (n === 1 ? "it" : "them") + " on Bookings first." };
  }

  const pinCleared = !add && set.postcode !== undefined && !!x.hasPin;
  const body = { id: id, add: add, set: set };
  if (pinCleared) body.pinCleared = true;
  if (add || set.active === true) {
    body.full = { route: next.route, time: next.time, stop: next.stop, postcode: next.postcode, where: next.where,
                  type: next.type, lat: next.lat, lng: next.lng };
  }
  const pins = await ensureStopPins(env);
  const words = [];
  if (add) words.push(next.time, next.stop);
  else {
    if (set.time !== undefined) words.push("at " + set.time);
    if (set.stop !== undefined) words.push("now " + set.stop);
    if (set.postcode !== undefined) words.push(set.postcode ? "postcode " + set.postcode : "postcode taken off");
    if (set.where !== undefined) words.push(set.where ? "where changed" : "where taken off");
    if (set.type !== undefined) words.push(set.type);
    if (set.active !== undefined) words.push(set.active ? "active" : "not active");
    if (pinCleared) words.push("pin cleared");
  }
  if (add && next.type !== "Pickup") words.push(next.type);
  return { ok: true, sunday: "", stmts: stopSql(env, body, pins), body: body,
           words: (add ? id + " added: " : id + ": ") + words.join(", ") + "." };
}

const ROTA_OFF = ["North cancelled", "South cancelled", "Cancelled/declined"];
/* The order the sheet writes them in, which is the order the status rule
   sees them in. The status goes last so a status set on purpose stands. */
const ROTA_SET_ORDER = ["north", "northCover", "south", "southCover", "northBus", "southBus", "status"];
const ROTA_DRIVER_FIELDS = ["north", "northCover", "south", "southCover"];

let coordReady = false;
async function ensureCoord(env) {
  if (coordReady) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS coord_actions (" +
    "  seq     INTEGER PRIMARY KEY AUTOINCREMENT," +
    "  id      TEXT NOT NULL UNIQUE," +
    "  kind    TEXT NOT NULL," +
    "  sunday  TEXT NOT NULL DEFAULT ''," +
    "  body    TEXT NOT NULL," +
    "  by_name TEXT NOT NULL DEFAULT ''," +
    "  made    INTEGER NOT NULL," +
    "  words   TEXT NOT NULL DEFAULT ''," +
    "  synced  INTEGER NOT NULL DEFAULT 0," +
    "  ok      INTEGER," +
    "  result  TEXT NOT NULL DEFAULT ''," +
    "  done_at INTEGER," +
    "  seen    INTEGER NOT NULL DEFAULT 0)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS coord_sync ON coord_actions(synced)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS coord_open ON coord_actions(seen, kind)").run();
  coordReady = true;
}

let fixColReady = false;
async function ensureFixCol(env) {
  if (fixColReady) return true;
  try {
    await env.DB.prepare("ALTER TABLE trip_events ADD COLUMN fix_note TEXT NOT NULL DEFAULT ''").run();
  } catch (e) { /* already there */ }
  try {
    await env.DB.prepare("SELECT fix_note FROM trip_events LIMIT 1").all();
    fixColReady = true;
  } catch (e) { fixColReady = false; }
  return fixColReady;
}

/* ---- who is asking ----------------------------------------------------- */

/* The same register of roles that may authorise a stopped bus and close
   another man's run. The name that goes on every action is the name whose
   hash matched, never the name the page sent. */
async function coordAuth(env, body) {
  const who = String((body && body.who) || "").trim();
  const pin = String((body && body.pin) || "").replace(/\D/g, "");
  if (!who) return { error: { ok: false, error: "no driver" } };

  const row = await env.DB.prepare(
    "SELECT name, role, pin_hash, active FROM drivers WHERE lower(name)=lower(?)").bind(who).first();
  if (!row || Number(row.active) === 0) return { error: { ok: false, error: "unknown driver" } };

  const rules = await authRules(env);
  if (rules.roles.indexOf(String(row.role || "").trim().toLowerCase()) === -1) {
    return { error: { ok: false, error: "not authorised" } };
  }
  if (!row.pin_hash) return { error: { ok: false, error: "no pin" } };

  const tkey = pinTriesKey(row.name);
  const held = await cacheGet(env, tkey);
  const now = Date.now();
  let tries = 0;
  if (held && now - (Number(held.at) || 0) < PIN_LOCK_MINUTES * 60000) tries = Number(held.n) || 0;
  if (tries >= PIN_MAX_TRIES) return { error: { ok: false, locked: true, minutes: PIN_LOCK_MINUTES } };

  const got = await pinHashOf(env, row.name, pin);
  if (!pin || got !== row.pin_hash) {
    try { await cachePut(env, tkey, { n: tries + 1, at: now }).run(); } catch (e) {}
    return { error: { ok: false, error: "bad pin", left: Math.max(0, PIN_MAX_TRIES - tries - 1) } };
  }
  /* Only when there is something to clear. The app asks every thirty
     seconds while it is open, and a write on every one of those is waste. */
  if (held) { try { await env.DB.prepare("DELETE FROM settings WHERE k=?").bind(tkey).run(); } catch (e) {} }
  return { me: { name: row.name, role: row.role || "" } };
}

/* ---- one Sunday, in one shape ------------------------------------------ */

/* The shelf's rows are decorate()'s shape, where actual is the cover OR the
   scheduled name. The rota table's are the tab's columns. Both come out as
   the tab's columns here, so one set of rules can act on either. */
function rotaNorm(r, shelf) {
  if (!r) return null;
  const t = (v) => String(v == null ? "" : v).trim();
  if (shelf) {
    const north = t(r.primary), act = t(r.actual);
    return { north: north, northCover: (act && act !== north) ? act : "",
             northBus: t(r.northBus), south: t(r.primary2), southCover: t(r.actual2),
             southBus: t(r.southBus), status: t(r.status), notes: String(r.notes || "") };
  }
  return { north: t(r.north), northCover: t(r.north_cover), northBus: t(r.north_bus),
           south: t(r.south), southCover: t(r.south_cover), southBus: t(r.south_bus),
           status: t(r.status), notes: String(r.notes || "") };
}

/* onEditRota in Code.gs, cell by cell, as the sheet runs it after each
   write. Only the North columns move the status there, and this matches it
   rather than improving on it: the overlay has to show what the sheet will
   show, or a phone flickers between two answers. */
function rotaEditRule(n, touchesDriver) {
  if (!n.north && !n.northCover) {
    if (n.status !== "Cancelled/declined") n.status = "No driver assigned";
  } else if (touchesDriver) {
    if (n.northCover && n.northCover !== n.north) n.status = "Covered";
    else if (n.status === "Covered" || n.status === "No driver assigned") n.status = "Confirmed";
  }
}

function rotaApplySet(n0, body) {
  const n = Object.assign({}, n0);
  const set = (body && body.set) || {};
  for (const f of ROTA_SET_ORDER) {
    if (!Object.prototype.hasOwnProperty.call(set, f)) continue;
    n[f] = String(set[f] == null ? "" : set[f]).trim();
    rotaEditRule(n, f === "north" || f === "northCover");
  }
  const note = String((body && body.note) || "").trim();
  if (note) {
    /* Once. The same action applied twice, which the overlay can do in the
       seconds before the sheet reports it, must not write the note twice. */
    const lines = String(n.notes || "").split("\n").map(noteLine);
    if (lines.indexOf(noteLine(note)) === -1) n.notes = n.notes ? n.notes + "\n" + note : note;
    rotaEditRule(n, false);
  }
  /* A note changed or taken off, from w2.35.0. Applied twice, the second
     finds nothing to change. A change to a line already there takes the old
     one off: laid over a copy that already has the change, a note added then
     changed would otherwise show twice. */
  const ed = body && body.noteEdit;
  if (ed && ed.was) {
    const lines = String(n.notes || "").split("\n");
    const flat = lines.map(noteLine);
    const i = flat.indexOf(noteLine(ed.was));
    if (i !== -1) {
      const now = noteLine(ed.now);
      if (now && flat.indexOf(now) === -1) lines[i] = now; else lines.splice(i, 1);
      n.notes = lines.join("\n");
    }
    rotaEditRule(n, false);
  }
  return n;
}

/* One line of a Sunday's Notes, as the app and the sheet compare it (Code.gs
   coordRota nl). A line the sheet kept from turning into a formula has an
   apostrophe in front, which is not part of the note. */
function noteLine(x) { return String(x == null ? "" : x).replace(/\s+/g, " ").trim().replace(/^'/, ""); }
/* The lines the sheet writes and reads back: swaps, and a protected Sunday. */
const ROTA_NOTE_OWN = /^(swapped\s*:|protected\b)/i;

/* onEditRequests in Code.gs. A swap moves two Sundays and is left to the
   sheet, which answers in seconds. A Sunday that has been called off keeps
   its status: approving or refusing somebody's cover does not put a route
   back on for the passengers who read that cell. */
function decideApply(n0, b, routes) {
  if (!b || String(b.type || "") === "Request a swap") return n0;
  const n = Object.assign({}, n0);
  const off = ROTA_OFF.indexOf(n.status) !== -1;
  const who = String(b.driver || "").trim();
  const onSouth = who && (sameName(n.south, who) || sameName(n.southCover, who));
  const onNorth = who && (sameName(n.north, who) || sameName(n.northCover, who));
  const route = onSouth ? "South" : onNorth ? "North"
              : (routes && routes[who.toLowerCase()] === "South" ? "South" : "North");
  if (b.choice === "Approved" && b.cover) {
    n[route === "South" ? "southCover" : "northCover"] = String(b.cover);
    if (!off) n.status = "Covered";
  } else if (b.choice === "Approved") {
    if (!off) n.status = "No driver assigned";
  } else if (b.choice === "Rejected") {
    if (!off) n.status = "Confirmed";
  }
  return n;
}

/* The registration a route gets: the one written against the Sunday if it
   is a bus we know, the monthly rotation otherwise. Code.gs busOn. */
function busResolve(key, route, over, buses) {
  const known = {};
  for (const b of buses || []) known[String(b.reg || "").toUpperCase()] = b.reg;
  const o = String(over || "").trim();
  if (o && known[o.toUpperCase()]) return known[o.toUpperCase()];
  const pair = busRule(key, buses);
  if (!pair) return "";
  return known[String(pair[route] || "").toUpperCase()] || "";
}

/* What "running" means for a Sunday coming back on: the status the sheet
   would give a row nobody had called off. */
function runningStatus(n, hasPending) {
  if (hasPending) return "Change requested";
  if (n.northCover && n.northCover !== n.north) return "Covered";
  if (!n.north && !n.northCover) return "No driver assigned";
  return "Confirmed";
}

function shelfRowApply(row, a, ctx) {
  const n0 = rotaNorm(row, true);
  const n = a.kind === "rota" ? rotaApplySet(n0, a.body) : decideApply(n0, a.body, ctx.routes);
  const out = Object.assign({}, row);
  out.primary = n.north;
  out.actual = n.northCover || n.north;
  out.primary2 = n.south;
  out.actual2 = n.southCover;
  const set = (a.kind === "rota" && a.body && a.body.set) || {};
  if (Object.prototype.hasOwnProperty.call(set, "northBus")) out.northBus = busResolve(row.date, "North", n.northBus, ctx.buses);
  if (Object.prototype.hasOwnProperty.call(set, "southBus")) out.southBus = busResolve(row.date, "South", n.southBus, ctx.buses);
  out.status = n.status;
  out.notes = n.notes;
  if (!out.primary && !out.actual) out.status = "No driver assigned";
  if (a.kind === "decide") {
    const mark = (q) => (q && sameName(q.driver, a.body.driver)) ? Object.assign({}, q, { status: a.body.choice }) : q;
    if (Array.isArray(row.requests)) out.requests = row.requests.map(mark);
    if (row.request) out.request = mark(row.request);
  }
  /* So a screen can say this Sunday has a change on its way to the sheet. */
  out.coordPending = true;
  return out;
}

async function driverRoutes(env) {
  const out = {};
  try {
    const r = await env.DB.prepare("SELECT name, route FROM drivers").all();
    for (const d of (r.results || [])) {
      out[String(d.name || "").trim().toLowerCase()] =
        String(d.route || "").trim().toUpperCase().charAt(0) === "S" ? "South" : "North";
    }
  } catch (e) {}
  return out;
}

/* ---- the actions the sheet has not reported yet ------------------------ */

function coordParse(r) {
  let b = {};
  try { b = JSON.parse(r.body || "{}") || {}; } catch (e) { b = {}; }
  return { id: r.id, seq: Number(r.seq) || 0, kind: r.kind, sunday: r.sunday || "",
           by: r.by_name || "", made: Number(r.made) || 0, body: b };
}

/* Not refused, not yet named in a push as applied, and not so old that
   something must have gone wrong with it. */
async function coordPending(env, kinds, sundays) {
  try {
    await ensureCoord(env);
    const since = Date.now() - COORD_OVERLAY_DAYS * 86400000;
    const q = await env.DB.prepare(
      "SELECT * FROM coord_actions WHERE seen=0 AND (ok IS NULL OR ok=1) AND made>? " +
      "AND kind IN (" + kinds.map(() => "?").join(",") + ") ORDER BY seq").bind(since, ...kinds).all();
    let list = (q.results || []).map(coordParse);
    if (sundays) list = list.filter((a) => sundays.indexOf(a.sunday) !== -1);
    return list;
  } catch (e) { return []; }
}

/* THE ROTA TABLE, KEPT IN STEP.

   The copy every other part of this server reads a Sunday from: which bus is
   whose, whether a route is off, who the driver is for his reminders. It is
   rewritten by every push from the sheet, so anything still on its way is
   laid back over it straight after, and straight after the action itself. */
async function reapplyRawRota(env, onlySundays) {
  const acts = await coordPending(env, ["rota", "decide"], onlySundays);
  if (!acts.length) return 0;
  const routes = await driverRoutes(env);
  const by = {};
  for (const a of acts) (by[a.sunday] = by[a.sunday] || []).push(a);
  const stmts = [];
  for (const key of Object.keys(by)) {
    const raw = await getRotaRow(env, key);
    if (!raw) continue;          /* further ahead than the table holds; nothing reads it */
    let n = rotaNorm(raw, false);
    for (const a of by[key]) n = a.kind === "rota" ? rotaApplySet(n, a.body) : decideApply(n, a.body, routes);
    /* A note changed or taken off, from w2.35.0. The row here may already
       carry every change, and a note added then changed would come back if
       laid over it again, so the Notes are laid over the sheet's own copy
       instead, which has none of them yet. */
    if (by[key].some((a) => a.body && a.body.noteEdit)) {
      try {
        const c = await cacheGet(env, "cache_rota");
        const row = c && c.payload && (c.payload.rows || []).find((x) => x.date === key);
        if (row) {
          let m = rotaNorm(row, true);
          for (const a of by[key]) if (a.kind === "rota") m = rotaApplySet(m, a.body);
          n.notes = m.notes;
        }
      } catch (e) {}
    }
    stmts.push(env.DB.prepare(
      "UPDATE rota SET north=?, north_cover=?, north_bus=?, south=?, south_cover=?, south_bus=?, " +
      "status=?, notes=? WHERE sunday=?").bind(n.north, n.northCover, n.northBus, n.south,
      n.southCover, n.southBus, n.status, n.notes, key));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

/* The shelf's rows with the coordinator's changes laid over them. Called by
   cachedRota, so the driver app sees them as well. */
async function coordOverlayShelf(env, out) {
  const acts = await coordPending(env, ["rota", "decide", "defect"]);
  if (!acts.length) return;
  const ctx = { buses: await getBuses(env), routes: await driverRoutes(env) };
  for (const a of acts) {
    if (a.kind === "defect") continue;
    const i = (out.rows || []).findIndex((x) => x.date === a.sunday);
    if (i === -1) continue;
    out.rows[i] = shelfRowApply(out.rows[i], a, ctx);
  }
  const closes = acts.filter((a) => a.kind === "defect" && DEFECT_CLOSED.indexOf(a.body.status) !== -1);
  if (closes.length && out.openDefects) out.openDefects = defectsWithout(out.openDefects, closes);
  const judged = acts.filter((a) => a.kind === "defect" && (a.body.crit || a.body.type));
  if (judged.length && out.openDefects) out.openDefects = defectsJudged(out.openDefects, judged);
}

/* One defect, one key, worked out the same way in Code.gs (defectKey). */
function defectKeyOf(d) {
  return [String(d.checkId || ""), String(d.reg || "").trim().toUpperCase(),
          String(d.item || "").trim(), String(d.date || "")].join("|");
}

function defectsWithout(map, closes) {
  const gone = {};
  for (const a of closes) for (const k of defectKeysOf(a.body)) gone[k] = 1;
  const out = {};
  for (const reg of Object.keys(map || {})) {
    const left = (map[reg] || []).filter((d) => !gone[defectKeyOf(d)]);
    if (left.length) out[reg] = left;
  }
  return out;
}

/* Critical and Kind as the coordinator has just set them, from w2.33.0, so
   the driver app has them before the sheet's next copy comes back. */
function defectsJudged(map, acts) {
  const set = {};
  for (const a of acts) for (const k of defectKeysOf(a.body)) set[k] = a.body;
  const out = {};
  for (const reg of Object.keys(map || {})) {
    out[reg] = (map[reg] || []).map((d) => {
      const b = set[defectKeyOf(d)];
      if (!b) return d;
      const x = Object.assign({}, d);
      if (b.crit) x.crit = b.crit === "YES";
      if (b.type) x.kind = b.type;
      return x;
    });
  }
  return out;
}

/* ---- what the screens are built from ----------------------------------- */

function activityRow(r) {
  if (!r) return null;
  const synced = Number(r.synced);
  return { id: r.id, kind: r.kind, sunday: r.sunday || "", by: r.by_name || "",
           made: Number(r.made) || 0, words: r.words || "",
           state: synced === 1 ? (Number(r.ok) === 0 ? "refused" : "done") : "waiting",
           result: r.result || "", doneAt: Number(r.done_at) || 0 };
}

async function coordActivity(env, n) {
  try {
    await ensureCoord(env);
    const q = await env.DB.prepare("SELECT * FROM coord_actions ORDER BY seq DESC LIMIT ?")
      .bind(Math.max(1, Math.min(100, Number(n) || 40))).all();
    return (q.results || []).map(activityRow);
  } catch (e) { return []; }
}

/* Rota requests: what the sheet sent, what this server took and the sheet
   has not filed, and any decision still on its way. */
async function coordRequestsView(env, opts) {
  const shelf = await cacheGet(env, "coord_shelf");
  const today = runSunday();
  const list = [], have = {};
  for (const r of ((shelf && shelf.requests) || [])) {
    const one = Object.assign({}, r, { onSheet: true });
    list.push(one); have[one.id] = one;
  }
  try {
    await ensureRequests(env);
    const q = await env.DB.prepare(
      "SELECT body, received FROM requests WHERE synced<>1 OR received>?")
      .bind(Number(shelf && shelf.readAt) || 0).all();
    for (const r of (q.results || [])) {
      let b = null;
      try { b = JSON.parse(r.body); } catch (e) { continue; }
      if (!b || !b.id || have[b.id]) continue;
      const one = { id: b.id, sunday: b.date, driver: b.driver, type: b.type || "",
                    reason: b.reason || "", swapWith: b.swapWith || "",
                    theirSunday: b.swapDate || "", bothAgreed: b.agreed ? "YES" : "",
                    status: "Pending", received: Number(r.received) || 0, onSheet: false };
      list.push(one); have[one.id] = one;
    }
  } catch (e) {}

  /* Decided from an email link, not yet on the sheet. */
  try {
    await ensureLinks(env);
    const d = await env.DB.prepare(
      "SELECT subject, choice, cover, used_by, used_at FROM links " +
      "WHERE kind='rota' AND used=1 AND synced=0").all();
    for (const r of (d.results || [])) {
      let s = {};
      try { s = JSON.parse(r.subject || "{}"); } catch (e) { continue; }
      const one = have[s.id];
      if (!one || one.status !== "Pending") continue;
      one.status = r.choice; one.replacement = r.cover || "";
      one.decidedBy = r.used_by || ""; one.decidedAt = Number(r.used_at) || 0; one.waiting = true;
    }
  } catch (e) {}

  for (const a of await coordPending(env, ["decide"])) {
    const one = have[a.body.requestId];
    if (!one) continue;
    one.status = a.body.choice; one.replacement = a.body.cover || "";
    one.decidedBy = a.by; one.decidedAt = a.made; one.waiting = true;
  }

  const keep = list.filter((r) => r.status !== "Pending" || String(r.sunday || "") >= today);
  if (!(opts && opts.noCandidates)) {
    for (const r of keep) {
      if (r.status !== "Pending" || r.type === "Request a swap") continue;
      try { r.candidates = await coverCandidates(env, r.sunday, r.driver); } catch (e) { r.candidates = []; }
    }
  }
  keep.sort((a, b) => {
    const pa = a.status === "Pending" ? 0 : 1, pb = b.status === "Pending" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (pa === 0) return String(a.sunday) < String(b.sunday) ? -1 : String(a.sunday) > String(b.sunday) ? 1 : 0;
    return (Number(b.decidedAt || b.decidedOn) || 0) - (Number(a.decidedAt || a.decidedOn) || 0);
  });
  return keep;
}

/* Open defects: the sheet's list, with anything changed here laid over it.
   A sheet older than v1.82.0 sends no list; the public one stands in. */
async function coordDefectsView(env) {
  const shelf = await cacheGet(env, "coord_shelf");
  let list = [];
  if (shelf && Array.isArray(shelf.defects)) {
    list = shelf.defects.map((d) => Object.assign({}, d));
  } else {
    const c = await cacheGet(env, "cache_rota");
    const map = (c && c.payload && c.payload.openDefects) || {};
    for (const reg of Object.keys(map)) {
      for (const d of map[reg] || []) {
        list.push({ key: defectKeyOf(d), checkId: d.checkId || "", reg: d.reg || reg,
                    date: d.date || "", item: d.item || "", crit: !!d.crit,
                    found: d.note || "", kind: d.kind || "Defect", status: d.status || "Open",
                    action: "", driver: "" });
      }
    }
  }
  for (const a of await coordPending(env, ["defect"])) {
    for (const k of defectKeysOf(a.body)) {
      const d = list.find((x) => x.key === k);
      if (!d) continue;
      d.status = a.body.status;
      if (a.body.crit) d.crit = a.body.crit === "YES";
      if (a.body.type) d.kind = a.body.type;
      const add = String(a.body.action || "").trim();
      if (add && String(d.action || "").split("\n").map((x) => x.trim()).indexOf(add) === -1) {
        d.action = d.action ? d.action + "\n" + add : add;
      }
      d.waiting = true;
    }
  }
  /* From w2.30.0 a defect ticked as put right on a Vehicle Log entry is
     closed by the sheet as it writes the entry; until then it goes here. */
  for (const a of await coordPending(env, ["vlog"])) {
    for (const k of (a.body && a.body.defects) || []) {
      const d = list.find((x) => x.key === k);
      if (d) d.status = "Fixed";
    }
  }
  return list.filter((d) => DEFECT_CLOSED.indexOf(d.status) === -1);
}

/* ---- words ------------------------------------------------------------- */

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_LONG = ["January", "February", "March", "April", "May", "June", "July", "August",
                  "September", "October", "November", "December"];

function keyParts(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  return { y, mo, d, dow: new Date(Date.UTC(y, mo - 1, d)).getUTCDay() };
}
function shortDay(key) {
  const p = keyParts(key);
  return p ? DAY_SHORT[p.dow] + " " + p.d + " " + MON_SHORT[p.mo - 1] : String(key || "");
}
function longDay(key) {
  const p = keyParts(key);
  return p ? DAY_LONG[p.dow] + " " + p.d + " " + MON_LONG[p.mo - 1] : String(key || "");
}
function isSundayKey(key) {
  const p = keyParts(key);
  return !!p && p.dow === 0;
}
const seatWord = (n) => n + (Number(n) === 1 ? " seat" : " seats");

function rotaWords(key, cur, set, note, noteEdit) {
  const day = shortDay(key);
  const bits = [];
  const name = { north: "North", northCover: "North", south: "South", southCover: "South" };
  for (const f of ["north", "south"]) {
    if (!(f in set)) continue;
    bits.push(set[f] ? name[f] + ": " + set[f] + " drives" + (cur[f] ? " (was " + cur[f] + ")" : "") + "."
                     : name[f] + ": nobody down to drive.");
  }
  for (const f of ["northCover", "southCover"]) {
    if (!(f in set)) continue;
    bits.push(set[f] ? name[f] + ": " + set[f] + " covers." : name[f] + ": cover taken off.");
  }
  if ("northBus" in set && "southBus" in set) {
    bits.push("Buses: North " + (set.northBus || "back to the monthly bus") +
              ", South " + (set.southBus || "back to the monthly bus") + ".");
  } else {
    for (const f of ["northBus", "southBus"]) {
      if (!(f in set)) continue;
      const rt = f === "northBus" ? "North" : "South";
      bits.push(set[f] ? rt + " bus: " + set[f] + "." : rt + " bus: back to the monthly bus.");
    }
  }
  if ("status" in set) {
    const st = set.status;
    bits.push(st === "North cancelled" ? "North called off."
            : st === "South cancelled" ? "South called off."
            : st === "Cancelled/declined" ? "Whole Sunday called off."
            : "Both routes running.");
  }
  if (note) bits.push("Note added.");
  if (noteEdit) bits.push(noteEdit.now ? "Note changed." : "Note taken off.");
  return day + ". " + bits.join(" ");
}

/* ---- the reads ----------------------------------------------------------- */

async function coordLoad(env, me) {
  const out = { ok: true, me: me, now: Date.now() };
  const today = runSunday();
  out.today = today;
  out.londonToday = londonKey(new Date());

  const all = await getStops(env);
  const stops = pickupsAndArrivals(all);
  out.stops = stops.map((s) => ({ route: s.route, id: s.id, time: s.time, stop: s.stop,
                                  arrival: !!s.arrival }));
  out.routes = routeNames(stops);
  try { out.open = await busCurrentSunday(env, stops); } catch (e) { out.open = today; }
  out.cutoff = cutoffWords();

  /* The rehearsal, if one is running, with its seats and its runs so far. */
  try {
    const reh = await rehearsalOn(env);
    out.rehearsal = rehearsalInfo(reh);
    out.rehearsalDetail = await rehearsalDetail(env, reh);
    out.rehearsalBlocked = reh ? "" : await liveMorning(env);
  } catch (e) { out.rehearsal = false; out.rehearsalDetail = null; out.rehearsalBlocked = ""; }

  /* Twelve weeks back, for who drove last, and a year ahead. Inside what the
     shelf holds (LIVE_CACHE_BACK and LIVE_CACHE_AHEAD in Code.gs). */
  const rota = await cachedRota(env, keyAddWeeks(today, -12), 64);
  out.rota = rota && rota.ok
    ? { rows: rota.rows || [], builtAt: rota.builtAt || 0 }
    : { rows: [], error: (rota && rota.cache) || "none" };

  try {
    const d = await env.DB.prepare(
      "SELECT name, role, route, ord, active FROM drivers ORDER BY ord, name").all();
    out.drivers = (d.results || []).map((x) => ({
      name: x.name, role: x.role || "", active: Number(x.active) !== 0,
      route: String(x.route || "").trim().toUpperCase().charAt(0) === "S" ? "South" : "North" }));
  } catch (e) { out.drivers = []; }

  const buses = await getBuses(env);
  /* From w2.35.0 also what the Buses screen changes, and whether it is still
     on its way to the sheet. */
  out.buses = buses.map((b) => ({ reg: b.reg, seats: b.seats, active: b.active, dates: b.dates || {},
                                  oddRoute: b.oddRoute || "", notes: b.notes || "", noNotes: !!b.noNotes,
                                  waiting: !!b.waiting }));
  out.busEdits = true;
  /* From w2.35.0 a note on the rota can be changed or taken off. */
  out.noteEdits = true;
  /* From w2.35.0: the Bus Stops tab, for the Bus stops screen. null until a
     v1.98.0 sheet has sent it. */
  try { out.stopsReg = await coordStopsView(env); } catch (e) { out.stopsReg = null; }

  out.requests = await coordRequestsView(env);
  out.defects = await coordDefectsView(env);
  /* From w2.34.0: the Drivers tab, for the Drivers screen. */
  try { out.register = await coordDriversView(env); } catch (e) { out.register = null; }
  /* From w2.30.0: each bus's Vehicle Log and jobs to arrange, and the last
     mileage a walkaround read, for the Record form. */
  try { out.vehicles = await coordVehiclesView(env); } catch (e) { out.vehicles = { log: {}, jobs: {} }; }
  try {
    const c = await cacheGet(env, "cache_last");
    const last = (c && c.payload && c.payload.last) || {};
    out.lastMiles = {};
    for (const reg of Object.keys(last)) out.lastMiles[reg] = { miles: last[reg].miles, date: last[reg].date || "" };
  } catch (e) { out.lastMiles = {}; }

  /* Today's walkarounds and runs, for the two things that cannot wait: a bus
     the check stopped, and a run left open. */
  try { out.checks = await checksToday(env); } catch (e) { out.checks = {}; }
  out.runs = {};
  for (const rt of out.routes) {
    try {
      const t = await tripState(env, today, rt);
      out.runs[rt] = { trip: t.trip, driver: t.driver, reg: t.reg,
                       started: t.started, ended: t.ended, lastStop: t.lastStop };
    } catch (e) {}
  }

  /* Seats for the Sunday being driven and, once bookings have rolled over,
     the one they are open for. */
  out.seats = {};
  for (const key of [today, out.open].filter((k, i, a) => k && a.indexOf(k) === i)) {
    try {
      const rows = await liveBookings(env, key);
      const rotaRow = await getRotaRow(env, key);
      const s = {};
      for (const rt of out.routes) {
        s[rt] = await seatsFor(env, key, rt, stops, buses, rotaRow, rows);
        s[rt].off = routeCancelled(rotaRow, rt);
      }
      out.seats[key] = s;
    } catch (e) {}
  }

  out.activity = await coordActivity(env, 40);
  try {
    const w = await env.DB.prepare("SELECT COUNT(*) AS n FROM coord_actions WHERE synced<>1").first();
    out.waiting = Number((w && w.n) || 0);
  } catch (e) { out.waiting = 0; }
  try {
    const c = await cacheGet(env, "clock");
    out.clockAgoSec = (c && c.at) ? Math.round((Date.now() - Number(c.at)) / 1000) : null;
  } catch (e) { out.clockAgoSec = null; }
  return out;
}

/* Who is booked where, with the numbers to ring. For the Sunday being
   driven, the one after, and the last few for looking back. */
async function coordBookings(env, me, sundayIn) {
  const today = runSunday();
  const key = anyToKey(sundayIn) || today;
  if (!isSundayKey(key)) return { ok: false, error: "That is not a Sunday." };
  if (key > keyAddWeeks(today, 1) || key < keyAddWeeks(today, -FIX_WINDOW_WEEKS)) {
    return { ok: false, error: "Only the last few Sundays and the next one are kept here." };
  }
  const all = await getStops(env);
  const stops = pickupsAndArrivals(all);
  const rehearsing = !!(await rehearsalOn(env));
  const q = await env.DB.prepare(
    "SELECT id, route, stop_id, stop, seats, device, pid, phone, status, received, note " +
    "FROM bookings WHERE sunday=? ORDER BY received, id").bind(key).all();
  const rows = (q.results || []).filter((b) =>
    String(b.status || "").toLowerCase() !== "rehearsal" || rehearsing);
  const live = await liveBookings(env, key);
  const buses = await getBuses(env);
  const rotaRow = await getRotaRow(env, key);

  const one = (b) => ({ id: Number(b.id), stopId: b.stop_id, stop: b.stop, seats: Number(b.seats) || 0,
                        phone: b.phone || "", status: b.status, received: Number(b.received) || 0,
                        note: b.note || "", coord: String(b.device || "").indexOf("coord-") === 0,
                        rehearsal: String(b.status || "").toLowerCase() === "rehearsal" });
  const out = { ok: true, sunday: key, cutoff: cutoffWords(), closed: bookingsClosed(key),
                mayAct: busDateAllowed(key), routes: [], cancelled: [] };
  for (const rt of routeNames(stops)) {
    const seats = await seatsFor(env, key, rt, stops, buses, rotaRow, live);
    let run = null;
    if (key === today) { try { run = await tripState(env, key, rt); } catch (e) {} }
    const list = stops.filter((s) => s.route === rt && !s.arrival).map((s) => {
      const here = rows.filter((b) => b.stop_id === s.id && String(b.status || "").toLowerCase() !== "cancelled");
      return { id: s.id, time: s.time, stop: s.stop,
               passed: !!(run && run.served && run.served[s.id]),
               seats: here.reduce((n, b) => n + (Number(b.seats) || 0), 0),
               bookings: here.map(one) };
    });
    out.routes.push({ route: rt, off: routeCancelled(rotaRow, rt), bus: seats,
                      ended: !!(run && run.ended), started: !!(run && run.started), stops: list });
  }
  out.cancelled = rows.filter((b) => String(b.status || "").toLowerCase() === "cancelled")
    .sort((a, b) => (Number(b.received) || 0) - (Number(a.received) || 0)).slice(0, 30).map(one);
  return out;
}

/* The run record for one Sunday, stop by stop, with what can be put right. */
async function coordRuns(env, me, sundayIn) {
  const today = runSunday();
  const earliest = keyAddWeeks(today, -FIX_WINDOW_WEEKS);
  const key = anyToKey(sundayIn) || londonKey(new Date());
  const out = { ok: true, sunday: key, earliest: earliest, routes: [], recent: [] };
  try {
    const r = await env.DB.prepare(
      "SELECT DISTINCT sunday FROM trip_events WHERE sunday>=? AND sunday<=? AND status<>'Rehearsal' " +
      "ORDER BY sunday DESC").bind(earliest, londonKey(new Date())).all();
    out.recent = (r.results || []).map((x) => x.sunday);
  } catch (e) {}
  if (key < earliest || key > londonKey(new Date())) return out;

  await ensureFixCol(env);
  const all = await getStops(env);
  const q = await env.DB.prepare(
    "SELECT * FROM trip_events WHERE sunday=? ORDER BY happened, id").bind(key).all();
  const rows = (q.results || []).filter((r) => {
    const st = String(r.status || "");
    return st !== "Undone" && !/rehearsal/i.test(st);
  });
  /* WHAT WAS BOOKED, BY NUMBER. A stop nobody tapped is either one nobody
     booked, where the driver app asks for no tap at all, or one with seats
     the driver did not mark. The record has to tell those apart, or every
     quiet stop reads as a missed one. Real seats only: a rehearsal's are
     not this morning's. */
  const booked = {};
  try {
    for (const b of await liveBookings(env, key)) {
      if (!b.stopId || /rehearsal/i.test(String(b.status || ""))) continue;
      const x = booked[b.stopId] || (booked[b.stopId] = { seats: 0, stop: "" });
      x.seats += b.seats;
      if (!x.stop) x.stop = b.stop;
    }
  } catch (e) { /* the taps still show; every untapped stop reads as nobody booked */ }
  const ev = (r) => r ? ({ id: Number(r.id), event: r.event, at: Number(r.happened) || 0,
                            off: (r.off_min === null || r.off_min === undefined) ? null : Number(r.off_min),
                            status: r.status || "", note: r.fix_note || "",
                            corrected: /Corrected/.test(String(r.status || "")) }) : null;
  for (const rt of routeNames(all)) {
    const promised = await bookedTimes(env, key, rt);
    const mine = rows.filter((r) => r.route === rt);
    const trips = [];
    for (const r of mine) if (trips.indexOf(r.trip) === -1) trips.push(r.trip);
    const runs = trips.map((trip) => {
      const tr = mine.filter((r) => r.trip === trip);
      const start = tr.find((r) => r.event === "start") || null;
      const end = tr.find((r) => r.event === "end") || null;
      const first = start || tr[0];
      return {
        trip: trip, driver: (first && first.driver) || "", reg: (first && first.reg) || "",
        endedBy: (end && end.ended_by) || "",
        start: ev(start), end: ev(end),
        stops: stopsOnRoute(all, rt).filter((s) => !s.depart && !s.arrival).map((s) => {
          const tap = tr.find((r) => isStopTap(r.event) && r.stop_id === s.id) || null;
          const bk = booked[s.id] || null;
          /* The name this number had that morning, from the tap or the seat,
             when it is not the name it has now. */
          const then = (tap && tap.stop) || (bk && bk.stop) || "";
          /* The time early or late is measured from: the one on the tap, or
             the one the passenger was given, before today's timetable. */
          const time = (tap && /^\d{1,2}:\d{2}$/.test(String(tap.scheduled || "")) && tap.scheduled) ||
                       promised[s.id] || s.time;
          return { id: s.id, stop: s.stop, time: time, ev: ev(tap),
                   booked: bk ? bk.seats : 0,
                   then: then && !sameStopName(then, s.stop) ? then : "" };
        })
      };
    });
    out.routes.push({ route: rt, runs: runs });
  }
  return out;
}

/* ---- the reports ----------------------------------------------------------

   Four are answered here, from the live copy, because this is where the
   bookings, the alerts and the buses actually live. Two are the sheet's own,
   and are asked of it: the health check reads every tab, and who is carrying
   the load counts twenty six Sundays of the Rota tab. */

async function sheetAsk(env, payload, capMs) {
  const set = await cacheGet(env, "sheet_url");
  const url = set && String(set.url || "");
  if (!url) return null;
  const body = JSON.stringify(Object.assign({ token: tokenOf(env) },
    sheetTokenOf(env) ? { sheetToken: sheetTokenOf(env) } : {}, payload));
  const go = fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body })
    .then(async (r) => {
      if (!r || !r.ok) return null;
      try { return JSON.parse(await r.text()); } catch (e) { return null; }
    }).catch(() => null);
  const cap = Number((env && env.SHEET_PUSH_MS) || capMs || SHEET_PUSH_MS);
  let timer = null;
  const wait = new Promise((done) => { timer = setTimeout(() => done(null), cap); });
  return Promise.race([go, wait]).finally(() => clearTimeout(timer));
}

async function reportBookings(env) {
  const key = runSunday();
  const all = await getStops(env);
  const stops = pickupsAndArrivals(all).filter((s) => !s.arrival);
  const counts = bookingCounts(await liveBookings(env, key));
  const sections = [];
  let grand = 0;
  for (const rt of routeNames(stops)) {
    let sum = 0;
    const lines = stops.filter((s) => s.route === rt).map((s) => {
      const n = Number(counts[s.id]) || 0;
      sum += n;
      return s.time + "  " + s.stop + "  " + (n ? n + (n === 1 ? " person" : " people") : "nobody");
    });
    grand += sum;
    sections.push({ head: rt + " Liverpool, " + sum + " booked", lines: lines });
  }
  return { ok: true, name: "bookings", title: "Bookings for " + longDay(key),
           lead: grand ? grand + (grand === 1 ? " person" : " people") + " booked." : "Nobody booked yet.",
           sections: sections, foot: "Bookings close " + cutoffWords() + "." };
}

async function reportSeats(env) {
  const all = await getStops(env);
  const stops = pickupsAndArrivals(all);
  const buses = await getBuses(env);
  const today = runSunday();
  let open = today;
  try { open = await busCurrentSunday(env, stops); } catch (e) {}
  const sections = [];
  let over = 0;
  for (const key of [today, open].filter((k, i, a) => a.indexOf(k) === i)) {
    const rows = await liveBookings(env, key);
    const rotaRow = await getRotaRow(env, key);
    const lines = [];
    for (const rt of routeNames(stops)) {
      if (routeCancelled(rotaRow, rt)) { lines.push(rt + ": called off."); continue; }
      const f = await seatsFor(env, key, rt, stops, buses, rotaRow, rows);
      const tail = !f.seats ? ", seats unknown"
                 : f.booked > f.seats ? ", over by " + (f.booked - f.seats)
                 : f.booked === f.seats ? ", full" : ", " + (f.seats - f.booked) + " left";
      if (f.seats && f.booked > f.seats) over++;
      lines.push(rt + ": " + (f.reg || "no bus set") + (f.seats ? ", " + f.seats + " seats" : "") +
                 ", " + f.booked + " booked" + tail + ".");
    }
    sections.push({ head: longDay(key), lines: lines });
  }
  return { ok: true, name: "seats", title: "Are we over on seats?",
           lead: over ? (over === 1 ? "One route is over." : over + " routes are over.") : "Nobody is over.",
           sections: sections, tone: over ? "bad" : "good" };
}

async function reportAlerts(env) {
  const roll = await alertRoll(env);
  if (roll.driversOff === null) {
    return { ok: true, name: "alerts", title: "Who has alerts on",
             lead: "Could not read who has alerts on" + (roll.rollError ? ": " + roll.rollError : "") + ".",
             sections: [], tone: "bad" };
  }
  const sections = [{ head: "Drivers", lines: [
    "Alerts on for " + roll.driversOn + " of " + roll.onRegister + " drivers on the register."
  ].concat(roll.driversOff.length ? ["No alerts yet: " + roll.driversOff.join(", ") + "."] : []) }];
  sections.push({ head: "Passengers", lines: [
    roll.passengers + " passenger phone" + (roll.passengers === 1 ? " has" : "s have") + " alerts on." ] });
  return { ok: true, name: "alerts", title: "Who has alerts on",
           lead: roll.driversOff.length ? roll.driversOff.length + " driver" +
                 (roll.driversOff.length === 1 ? " has" : "s have") + " no alerts yet."
               : "Every driver has alerts on.",
           sections: sections };
}

async function reportBuses(env) {
  const today = runSunday();
  const r = await cachedRota(env, today, 8);
  if (!r || !r.ok) {
    return { ok: true, name: "buses", title: "Which bus is on which route",
             lead: "The rota has not reached the live server. Send everything to it from the spreadsheet.",
             sections: [], tone: "bad" };
  }
  const lines = (r.rows || []).filter((x) => x.date >= today).slice(0, 8).map((x) => {
    const st = String(x.status || "");
    const off = (rt) => st === "Cancelled/declined" || st === rt + " cancelled";
    return shortDay(x.date) + ":  North " + (off("North") ? "off" : (x.northBus || "not known")) +
           ",  South " + (off("South") ? "off" : (x.southBus || "not known"));
  });
  return { ok: true, name: "buses", title: "Which bus is on which route",
           sections: [{ head: "The next " + lines.length + " Sundays", lines: lines }],
           foot: "The rotation swaps every calendar month. A bus written against a Sunday wins for that Sunday." };
}

/* The live server's own half of "is everything working". */
async function liveHealthLines(env) {
  const bad = [], good = [];
  good.push("Live server " + SCRIPT_VERSION + ".");
  try {
    const c = await cacheGet(env, "clock");
    const ago = (c && c.at) ? Math.round((Date.now() - Number(c.at)) / 1000) : null;
    if (ago === null) bad.push("The live server's clock has never ticked. Add the Cron Trigger (every minute) in Cloudflare.");
    else if (ago > 180) bad.push("The live server's clock last ticked " + Math.round(ago / 60) + " minutes ago.");
    else good.push("The live server's clock is ticking.");
  } catch (e) {}
  try {
    const k = await cacheGet(env, "poke");
    if (k && k.at && k.ok === false) {
      const u = await sheetUrlKept(env);
      const m = /\/s\/([^/]+)\/exec/.exec(u);
      bad.push("The last time it asked the sheet to collect, the sheet did not answer. " +
               (m ? "It knocks on the web app ending \u2026" + m[1].slice(-6) + ". In Apps Script, " +
                    "Deploy, Manage deployments must show that one, with Who has access: Anyone; " +
                    "if it shows another, put that one's Web app URL in the Script Property WEB_APP_URL " +
                    "and Send everything to the live server now."
                  : "It has no address for the sheet. Send everything to the live server now."));
    }
  } catch (e) {}
  const waits = [];
  for (const [label, sql] of [
    ["booking", "SELECT COUNT(*) AS n FROM bookings WHERE synced < 1"],
    ["stop tap", "SELECT COUNT(*) AS n FROM trip_events WHERE synced < 1"],
    ["walkaround", "SELECT COUNT(*) AS n FROM checks_in WHERE synced = 0"],
    ["rota request", "SELECT COUNT(*) AS n FROM requests WHERE synced < 1"],
    ["coordinator change", "SELECT COUNT(*) AS n FROM coord_actions WHERE synced < 1"]
  ]) {
    try {
      const r = await env.DB.prepare(sql).first();
      const n = Number((r && r.n) || 0);
      if (n) waits.push(n + " " + label + (n === 1 ? "" : "s"));
    } catch (e) {}
  }
  if (waits.length) bad.push("Not on the sheet yet: " + waits.join(", ") + ".");
  else good.push("Everything phones have done is on the sheet.");
  try {
    const c = await cacheGet(env, "cache_rota");
    const m = (c && c.builtAt) ? Math.round((Date.now() - Number(c.builtAt)) / 60000) : null;
    if (m === null) bad.push("The rota has never been sent to the live server.");
    else if (m > 360) bad.push("The live server's rota is " + Math.round(m / 60) + " hours old.");
    else good.push("The live server's rota is " + (m < 1 ? "under a minute" : m + " minute" + (m === 1 ? "" : "s")) + " old.");
  } catch (e) {}
  return { bad: bad, good: good };
}

async function reportFromSheet(env, name, title) {
  const got = await sheetAsk(env, { action: "report", name: name }, SHEET_REPORT_MS);
  const rep = got && got.ok === true && got.report;
  const mine = name === "health" ? await liveHealthLines(env) : null;
  if (!rep) {
    const sections = [];
    if (mine && mine.bad.length) sections.push({ head: "Live server: needs attention", tone: "bad", lines: mine.bad });
    if (mine && mine.good.length) sections.push({ head: "Live server: fine", tone: "good", lines: mine.good });
    return { ok: true, name: name, title: title, tone: "bad", sheetDown: true,
             lead: "The spreadsheet did not answer in " + Math.round(SHEET_REPORT_MS / 1000) +
                   " seconds. Try again, or use the Minibus menu on the sheet.",
             sections: sections };
  }
  const out = { ok: true, name: name, title: rep.title || title, lead: rep.lead || "",
                sections: (rep.sections || []).slice(), foot: rep.foot || "", tone: rep.tone || "" };
  if (mine) {
    if (mine.bad.length) {
      out.sections.unshift({ head: "Live server: needs attention", tone: "bad", lines: mine.bad });
      out.tone = "bad";
    }
    out.sections.push({ head: "Live server: fine", tone: "good", lines: mine.good });
  }
  return out;
}

async function coordReport(env, me, name) {
  if (name === "bookings") return reportBookings(env);
  if (name === "seats") return reportSeats(env);
  if (name === "alerts") return reportAlerts(env);
  if (name === "buses") return reportBuses(env);
  if (name === "health") return reportFromSheet(env, "health", "Is everything working?");
  if (name === "load") return reportFromSheet(env, "load", "Who is carrying the load");
  /* From w2.26.0: three more off the Minibus menu, built by the same code. */
  if (name === "tapping") return reportFromSheet(env, "tapping", "Who is tapping");
  if (name === "live") return reportFromSheet(env, "live", "Is the live server working?");
  if (name === "remind") return reportFromSheet(env, "remind", "Duty reminders");
  return { ok: false, error: "no such report" };
}

/* ---- the acts --------------------------------------------------------------

   Each one checks what it has been asked against what every phone can see
   right now, and refuses in a sentence before anything is written. What it
   hands back is the statements to run with the action's own row, so the two
   land together or not at all. */

/* A Sunday as every phone sees it now: the shelf's copy with anything still
   on its way laid over it, or the rota table if the shelf cannot answer. */
async function currentRota(env, key) {
  try {
    const r = await cachedRota(env, key, 1);
    if (r && r.ok) {
      const row = (r.rows || []).find((x) => x.date === key);
      if (row) return rotaNorm(row, true);
    }
  } catch (e) {}
  const raw = await getRotaRow(env, key);
  return raw ? rotaNorm(raw, false) : null;
}

async function actRota(env, me, act) {
  const key = anyToKey(act.sunday);
  if (!key || !isSundayKey(key)) return { ok: false, error: "That is not a Sunday." };
  if (key < runSunday()) return { ok: false, error: "That Sunday has been and gone. Its record stays as it is." };

  const s = act.set || {};
  const set = {};
  const d = await env.DB.prepare("SELECT name FROM drivers WHERE active=1").all();
  const names = {};
  for (const x of (d.results || [])) names[String(x.name || "").trim().toLowerCase()] = String(x.name).trim();
  for (const f of ROTA_DRIVER_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(s, f)) continue;
    const v = String(s[f] == null ? "" : s[f]).trim();
    if (v && !names[v.toLowerCase()]) return { ok: false, error: v + " is not an active driver on the Drivers tab." };
    set[f] = v ? names[v.toLowerCase()] : "";
  }
  const buses = await getBuses(env);
  const regs = {};
  for (const b of buses) if (b.active) regs[String(b.reg).toUpperCase()] = b.reg;
  for (const f of ["northBus", "southBus"]) {
    if (!Object.prototype.hasOwnProperty.call(s, f)) continue;
    const v = String(s[f] == null ? "" : s[f]).trim();
    if (v && !regs[v.toUpperCase()]) return { ok: false, error: v + " is not an active bus on the Buses tab." };
    set[f] = v ? regs[v.toUpperCase()] : "";
  }
  if (Object.prototype.hasOwnProperty.call(s, "status")) {
    const v = String(s.status || "").trim();
    if (v !== "running" && ROTA_OFF.indexOf(v) === -1) return { ok: false, error: "unknown status" };
    set.status = v;
  }
  const note = String(act.note || "").replace(/\s+/g, " ").trim().slice(0, 300);
  /* From w2.35.0 a note already there, changed or taken off. The sheet's own
     lines are left to the sheet: a Swapped line is what the rota reads a
     swap back from, and PROTECTED is what keeps a Sunday as it is. */
  let noteEdit = null;
  if (act.noteEdit && typeof act.noteEdit === "object") {
    const was = noteLine(act.noteEdit.was), now = noteLine(act.noteEdit.now);
    if (!was) return { ok: false, error: "Pick a note." };
    /* A line typed longer on the Rota tab can stay as long; it is never cut. */
    const most = Math.max(300, was.length);
    if (now.length > most) return { ok: false, error: "Notes are " + most + " characters at most." };
    if (ROTA_NOTE_OWN.test(was) || ROTA_NOTE_OWN.test(now)) {
      return { ok: false, error: "Swapped and PROTECTED lines are changed on the Rota tab." };
    }
    if (now === was) return { ok: false, error: "Nothing to change." };
    noteEdit = { was: was, now: now };
  }
  if (!Object.keys(set).length && !note && !noteEdit) return { ok: false, error: "Nothing to change." };

  const cur = await currentRota(env, key);
  if (!cur) {
    return { ok: false, error: "That Sunday is not on the live server's copy of the rota yet. " +
                               "On the sheet: Minibus, Rota and setup, Send everything to the live server now." };
  }
  if (set.status === "running") {
    const reqs = await coordRequestsView(env, { noCandidates: true });
    set.status = runningStatus(rotaApplySet(cur, { set: Object.assign({}, set, { status: cur.status }) }),
                               reqs.some((r) => r.sunday === key && r.status === "Pending"));
  }
  if (noteEdit) {
    const flat = String(cur.notes || "").split("\n").map(noteLine);
    if (flat.indexOf(noteEdit.was) === -1) {
      return { ok: false, error: "That note is not on the live server's copy. Refresh and try again." };
    }
    if (noteEdit.now && flat.indexOf(noteEdit.now) !== -1) return { ok: false, error: "That note is there already." };
  }
  const next = rotaApplySet(cur, { set: set, note: note, noteEdit: noteEdit });

  /* One man, one bus, one morning. */
  const nDrv = next.northCover || next.north, sDrv = next.southCover || next.south;
  if (nDrv && sDrv && sameName(nDrv, sDrv)) {
    return { ok: false, error: nDrv + " cannot drive both routes that morning." };
  }
  const nBus = busResolve(key, "North", next.northBus, buses), sBus = busResolve(key, "South", next.southBus, buses);
  if (("northBus" in set || "southBus" in set) && nBus && sBus && nBus === sBus) {
    return { ok: false, clash: nBus,
             error: nBus + " is already on " + ("northBus" in set ? "South" : "North") + " that Sunday. Swap the two buses instead." };
  }

  const body = { sunday: key, set: set, note: note };
  if (noteEdit) body.noteEdit = noteEdit;
  return { ok: true, sunday: key, body: body,
           words: rotaWords(key, cur, set, note, noteEdit),
           after: () => reapplyRawRota(env, [key]) };
}

async function actDecide(env, me, act) {
  const id = String(act.requestId || "").trim();
  const choice = String(act.choice || "");
  if (choice !== "Approved" && choice !== "Rejected") return { ok: false, error: "choice" };
  const reqs = await coordRequestsView(env, { noCandidates: true });
  const rq = reqs.find((r) => r.id === id);
  if (!rq) return { ok: false, error: "That request is not on the live server's copy. Refresh and try again." };
  if (rq.status !== "Pending") {
    return { ok: false, error: "That request has already been " +
                               (rq.status === "Approved" ? "approved" : "turned down") + "." };
  }
  const swap = rq.type === "Request a swap";
  let cover = "";
  if (choice === "Approved" && !swap && String(act.cover || "").trim()) {
    const d = await env.DB.prepare(
      "SELECT name FROM drivers WHERE active=1 AND lower(name)=lower(?)").bind(String(act.cover).trim()).first();
    if (!d) return { ok: false, error: String(act.cover).trim() + " is not an active driver on the Drivers tab." };
    cover = String(d.name);
    if (sameName(cover, rq.driver)) return { ok: false, error: cover + " is the one asking to be covered." };
    const cur = await currentRota(env, rq.sunday);
    if (cur) {
      const onSouth = sameName(cur.south, rq.driver) || sameName(cur.southCover, rq.driver);
      const other = onSouth ? (cur.northCover || cur.north) : (cur.southCover || cur.south);
      if (other && sameName(other, cover)) {
        return { ok: false, error: cover + " is already driving " + (onSouth ? "North" : "South") + " that morning." };
      }
    }
  }
  const body = { requestId: id, choice: choice, cover: cover, driver: rq.driver, type: rq.type || "",
                 sunday: rq.sunday, swapWith: rq.swapWith || "", theirSunday: rq.theirSunday || "" };
  const day = shortDay(rq.sunday);
  const words = choice === "Rejected"
    ? "Turned down " + rq.driver + "'s request for " + day + "."
    : swap ? "Approved " + rq.driver + "'s swap for " + day + "."
    : "Approved " + rq.driver + "'s request for " + day + (cover ? ", " + cover + " covering." : ", nobody covering yet.");

  /* The email link for this request is spent, so a second answer cannot be
     given from an inbox. Marked as carried, because this action carries it. */
  const stmts = [];
  try {
    await ensureLinks(env);
    const esc = id.replace(/[\\%_]/g, (c) => "\\" + c);
    stmts.push(env.DB.prepare(
      "UPDATE links SET used=1, used_at=?, used_by=?, choice=?, synced=1 " +
      "WHERE kind='rota' AND used=0 AND subject LIKE ? ESCAPE '\\'")
      .bind(Date.now(), me.name, choice, '%"id":"' + esc + '"%'));
  } catch (e) {}
  return { ok: true, sunday: rq.sunday, body: body, words: words, stmts: stmts,
           after: () => reapplyRawRota(env, [rq.sunday]) };
}

async function actBooking(env, me, act, actionId) {
  const op = String(act.op || "");
  const all = await getStops(env);
  const stops = pickupsAndArrivals(all);

  if (op === "cancel") {
    const bid = Number(act.bookingId);
    const row = bid > 0 ? await env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(bid).first() : null;
    if (!row) return { ok: false, error: "That booking is not on the live server." };
    if (String(row.sunday) < runSunday()) return { ok: false, error: "That Sunday has been and gone." };
    const st = String(row.status || "").toLowerCase();
    if (st === "cancelled") return { ok: false, error: "That booking is already cancelled." };
    if (st === "rehearsal") return { ok: false, error: "That is a rehearsal seat." };
    const note = "Cancelled by " + me.name + " in the coordinator's app at " + londonHHMM(new Date()) + ".";
    const tail = row.phone ? ", number ending " + String(row.phone).slice(-3) : "";
    return { ok: true, sunday: row.sunday,
             stmts: [env.DB.prepare(
               "UPDATE bookings SET status='Cancelled', note=?, received=?, synced=0 WHERE id=?")
               .bind(note, Date.now(), bid)],
             body: { op: "cancel", bookingId: bid, sunday: row.sunday, stopId: row.stop_id, seats: Number(row.seats) || 0 },
             words: shortDay(row.sunday) + ". Cancelled " + seatWord(Number(row.seats) || 0) +
                    " at " + row.stop + tail + "." };
  }

  if (op === "add") {
    const key = anyToKey(act.sunday);
    if (!busDateAllowed(key)) return { ok: false, error: "Only this Sunday and next can be booked." };
    const stop = stops.find((s) => s.id === String(act.stopId || "").trim() && !s.arrival) || null;
    if (!stop) return { ok: false, error: "Choose a stop." };
    const seats = Math.floor(Number(act.seats));
    if (!(seats >= 1 && seats <= 12)) return { ok: false, error: "Between 1 and 12 seats." };
    const rotaRow = await getRotaRow(env, key);
    if (routeCancelled(rotaRow, stop.route)) {
      return { ok: false, error: "The " + stop.route + " bus is not running that Sunday." };
    }
    if (key === runSunday()) {
      let t = null;
      try { t = await tripState(env, key, stop.route); } catch (e) {}
      if (t && t.ended) return { ok: false, error: "The " + stop.route + " run is over." };
      if (t && t.served && t.served[stop.id]) return { ok: false, error: "The bus has already been to " + stop.stop + "." };
    }
    const raw = String(act.phone || "").trim();
    const phone = raw ? normalisePhone(raw) : "";
    if (raw && !phone) return { ok: false, error: "Eleven digits, starting with 0." };
    const pid = phone ? await passengerId(env, phone) : "";
    const device = "coord-" + actionId;
    const note = "Booked by " + me.name + " in the coordinator's app.";

    /* By the number if one was given, so the passenger's own phone finds it,
       and by this action's own handle if the call is a retry. */
    let bid = 0;
    const again = await env.DB.prepare("SELECT id FROM bookings WHERE device=?").bind(device).first();
    const rows = await liveBookings(env, key);
    const existing = again ? { row: Number(again.id) } : (pid ? rows.find((b) => b.pid === pid) : null);
    if (existing) {
      bid = Number(existing.row);
      await env.DB.prepare(
        "UPDATE bookings SET route=?, stop_id=?, stop=?, seats=?, status='Booked', note=?, received=?, synced=0 WHERE id=?")
        .bind(stop.route, stop.id, stop.stop, seats, note, Date.now(), bid).run();
      const was = rows.find((b) => Number(b.row) === bid);
      await stampBooked(env, bid, stop.time, !was || was.stopId !== stop.id);
    } else {
      const res = await env.DB.prepare(
        "INSERT INTO bookings (sunday, route, stop_id, stop, seats, device, pid, phone, status, received, note, synced) " +
        "VALUES (?,?,?,?,?,?,?,?,'Booked',?,?,0)")
        .bind(key, stop.route, stop.id, stop.stop, seats, device, pid, phone, Date.now(), note).run();
      bid = Number(res && res.meta && res.meta.last_row_id) || 0;
      if (!bid) {
        const got = await env.DB.prepare("SELECT id FROM bookings WHERE device=?").bind(device).first();
        bid = got ? Number(got.id) : 0;
      }
      await stampBooked(env, bid, stop.time, true);
    }
    const after = await liveBookings(env, key);
    const buses = await getBuses(env);
    const f = await seatsFor(env, key, stop.route, stops, buses, rotaRow, after);
    return { ok: true, sunday: key,
             body: { op: "add", bookingId: bid, sunday: key, stopId: stop.id, seats: seats,
                     phoneEnd: phone ? phone.slice(-3) : "" },
             words: shortDay(key) + ". Booked " + seatWord(seats) + " at " + stop.stop +
                    (phone ? ", number ending " + phone.slice(-3) : "") + ".",
             reply: { bookingId: bid, seatsNow: f } };
  }
  return { ok: false, error: "unknown booking change" };
}

/* ONE FAULT, HOWEVER MANY TIMES IT WAS REPORTED.

   Every walkaround that finds the same fault writes another row, so a key
   remote nobody has fixed is on the Defects tab once per inspection. From
   w2.31.0 an update names every report it is for (keys), and one Close with
   one "what was done" closes them all, each with its own History line. The
   coordinator's app sends every open report of the fault, ticked, and he
   can untick one that turns out to be a different fault under the same
   heading. One key alone, as before, is still one report. */
function defectKeysOf(body) {
  const b = body || {};
  const keys = Array.isArray(b.keys) && b.keys.length ? b.keys : [b.key];
  return keys.map((k) => String(k || "")).filter(Boolean);
}

async function actDefect(env, me, act) {
  const list = await coordDefectsView(env);
  const keys = [...new Set(defectKeysOf(act))].slice(0, 50);
  const ds = keys.map((k) => list.find((x) => x.key === k) || null);
  if (!keys.length || ds.some((d) => !d)) {
    return { ok: false, error: keys.length > 1
      ? "One of those reports is not open on the live server's copy. Refresh and try again."
      : "That defect is not open on the live server's copy. Refresh and try again." };
  }
  const d = ds[0];
  if (ds.some((x) => x.reg !== d.reg)) return { ok: false, error: "Those reports are not all on one bus." };
  const status = String(act.status || "").trim();
  if (DEFECT_STATES.indexOf(status) === -1) return { ok: false, error: "unknown status" };
  /* From w2.33.0: Critical and Kind, judged again by the coordinator. Either
     missing is no change. */
  const crit = act.crit == null || act.crit === "" ? "" : String(act.crit);
  /* type, not kind: kind names the change itself ("defect"). */
  const kind = act.type == null || act.type === "" ? "" : String(act.type);
  if (crit && DEFECT_CRIT.indexOf(crit) === -1) return { ok: false, error: "unknown critical" };
  if (kind && DEFECT_KINDS.indexOf(kind) === -1) return { ok: false, error: "unknown kind" };
  const critChange = !!crit && ds.some((x) => (x.crit ? "YES" : "NO") !== crit);
  const kindChange = !!kind && ds.some((x) => (x.kind === "Advisory" ? "Advisory" : "Defect") !== kind);
  const action = String(act.action || "").replace(/\s+/g, " ").trim().slice(0, 500);
  const closing = DEFECT_CLOSED.indexOf(status) !== -1;
  if (closing && !action) return { ok: false, error: "Say what was done before closing it." };
  if (ds.every((x) => status === (x.status || "Open")) && !action && !critChange && !kindChange) {
    return { ok: false, error: "Nothing to change." };
  }
  const many = keys.length > 1 ? " (" + keys.length + " reports)" : "";
  return { ok: true, sunday: "",
           /* key and the first report's details stay, for a sheet from
              before v1.93.0, which reads key alone. */
           body: { key: keys[0], keys: keys, checkId: d.checkId || "", reg: d.reg, item: d.item, date: d.date || "",
                   status: status, action: action,
                   crit: critChange ? crit : undefined, type: kindChange ? kind : undefined },
           words: d.reg + ", " + d.item + many + ": " + (closing ? "closed, " + status.toLowerCase() : status.toLowerCase()) +
                  (critChange ? (crit === "YES" ? ", critical" : ", not critical") : "") +
                  (kindChange ? (kind === "Advisory" ? ", an advisory" : ", a defect") : "") +
                  (action ? ". " + action : "") + "." };
}

const EVENT_WORDS = { start: "left church", end: "back at church" };

async function actFix(env, me, act) {
  const key = anyToKey(act.sunday);
  const todayKey = londonKey(new Date());
  if (!key || key > todayKey) return { ok: false, error: "Only a run that has happened can be corrected." };
  if (key < keyAddWeeks(runSunday(), -FIX_WINDOW_WEEKS)) {
    return { ok: false, error: "That run is too old to correct here. Use the Trip Events tab." };
  }
  const hhmm = String(act.time || "").trim();
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(hhmm)) return { ok: false, error: "Give the time as hours and minutes." };
  const when = londonMoment(key, hhmm);
  if (!when || when.getTime() > Date.now()) return { ok: false, error: "That time has not happened yet." };
  const at = when.getTime();
  await ensureTripCols(env);
  if (!(await ensureFixCol(env))) return { ok: false, error: "The live server could not add its correction column." };
  const stampNow = me.name + ", " + shortDay(todayKey) + " " + londonHHMM(new Date());

  if (act.eventId) {
    const row = await env.DB.prepare("SELECT * FROM trip_events WHERE id=? AND sunday=?")
      .bind(Number(act.eventId), key).first();
    if (!row) return { ok: false, error: "That time is not on the live server." };
    const st = String(row.status || "");
    if (/rehearsal/i.test(st)) return { ok: false, error: "That was a rehearsal." };
    if (st === "Undone") return { ok: false, error: "The driver took that tap back." };
    const wasAt = Number(row.happened) || 0;
    const wasHHMM = wasAt ? londonHHMM(new Date(wasAt)) : "";
    if (wasHHMM === hhmm) return { ok: false, error: "That is the time it already says." };
    const sched = row.scheduled ? londonMoment(key, row.scheduled) : null;
    const off = sched ? Math.round((at - sched.getTime()) / 60000) : null;
    /* The first time it was recorded as, however many times it is put right. */
    const first = /(Recorded as \d{2}:\d{2}|No tap was recorded)/.exec(row.fix_note || "");
    const note = "Corrected by " + stampNow + ". " + (first ? first[1] : "Recorded as " + wasHHMM) + ".";
    const status = /Corrected/.test(st) ? st : (st ? st + ", Corrected" : "Corrected");
    const label = EVENT_WORDS[row.event] || row.stop || "a stop";
    return { ok: true, sunday: key,
             stmts: [env.DB.prepare(
               "UPDATE trip_events SET happened=?, off_min=?, status=?, fix_note=?, synced=0 WHERE id=?")
               .bind(at, off, status, note, Number(row.id))],
             body: { eventId: Number(row.id), sunday: key, route: row.route, event: row.event,
                     stopId: row.stop_id || "", stop: row.stop || "", time: hhmm, was: wasHHMM },
             words: row.route + ", " + shortDay(key) + ": " + label + " corrected to " + hhmm +
                    (wasHHMM ? " (was " + wasHHMM + ")" : "") + "." };
  }

  const trip = String(act.trip || "").trim();
  const any = trip ? await env.DB.prepare(
    "SELECT * FROM trip_events WHERE trip=? AND sunday=? AND status<>'Undone' ORDER BY id LIMIT 1")
    .bind(trip, key).first() : null;
  if (!any) return { ok: false, error: "That run is not on the live server." };
  if (/rehearsal/i.test(String(any.status || ""))) return { ok: false, error: "That was a rehearsal." };
  const all = await getStops(env);
  const stop = all.find((s) => s.id === String(act.stopId || "").trim() &&
                               s.route === any.route && !s.depart && !s.arrival) || null;
  if (!stop) return { ok: false, error: "That stop is not on the " + any.route + " route." };
  const live = await env.DB.prepare(
    "SELECT id FROM trip_events WHERE trip=? AND stop_id=? AND event IN " + TAP_SQL + " AND status<>'Undone' LIMIT 1")
    .bind(trip, stop.id).first();
  if (live) return { ok: false, error: stop.stop + " already has a time. Correct that one." };
  const anchor = (await bookedTimes(env, key, any.route))[stop.id] || stop.time;
  const sched = londonMoment(key, anchor);
  const off = sched ? Math.round((at - sched.getTime()) / 60000) : null;
  const note = "Added by " + stampNow + ". No tap was recorded.";
  return { ok: true, sunday: key,
           stmts: [env.DB.prepare(
             "INSERT INTO trip_events (trip, sunday, route, driver, reg, rota_bus, event, stop_id, stop, " +
             "scheduled, happened, off_min, status, geo, acc, away, logged, synced, fix_note) " +
             "VALUES (?,?,?,?,?,'','pickup',?,?,?,?,?,'Corrected','',NULL,NULL,?,0,?) " +
             "ON CONFLICT(trip, event, stop_id) DO UPDATE SET happened=excluded.happened, " +
             "off_min=excluded.off_min, status=excluded.status, logged=excluded.logged, " +
             "fix_note=excluded.fix_note, synced=0 WHERE trip_events.status='Undone'")
             .bind(trip, key, any.route, any.driver || "", any.reg || "", stop.id, stop.stop,
                   anchor, at, off, Date.now(), note)],
           body: { trip: trip, sunday: key, route: any.route, event: "pickup", stopId: stop.id,
                   stop: stop.stop, time: hhmm, added: true },
           words: any.route + ", " + shortDay(key) + ": " + stop.stop + " added at " + hhmm + ".",
           after: async () => {
             /* The row's own id, so the sheet can say when it has it. */
             const r = await env.DB.prepare(
               "SELECT id FROM trip_events WHERE trip=? AND event='pickup' AND stop_id=?").bind(trip, stop.id).first();
             return r ? Number(r.id) : 0;
           } };
}

async function coordAct(env, me, act) {
  const id = String((act && act.id) || "").trim();
  if (!/^[A-Za-z0-9_.-]{6,64}$/.test(id)) return { ok: false, error: "no action id" };
  await ensureCoord(env);

  /* A retry of an action already taken gets the same answer, and nothing is
     done twice. */
  const had = await env.DB.prepare("SELECT * FROM coord_actions WHERE id=?").bind(id).first();
  if (had) return { ok: true, duplicate: true, action: activityRow(had) };

  const kind = String(act.kind || "");
  let r = null;
  if (kind === "rota") r = await actRota(env, me, act);
  else if (kind === "decide") r = await actDecide(env, me, act);
  else if (kind === "booking") r = await actBooking(env, me, act, id);
  else if (kind === "defect") r = await actDefect(env, me, act);
  else if (kind === "fix") r = await actFix(env, me, act);
  else if (kind === "vlog") r = await actVlog(env, me, act, id);
  else if (kind === "vfix") r = await actVfix(env, me, act, id);
  else if (kind === "job") r = await actJob(env, me, act);
  else if (kind === "driver") r = await actDriver(env, me, act);
  else if (kind === "bus") r = await actBus(env, me, act);
  else if (kind === "stop") r = await actStop(env, me, act);
  else if (kind === "rehearsal") r = await rehearsalPlan(env, String(act.op || ""), String(act.shape || ""));
  else return { ok: false, error: "unknown kind" };
  if (!r || !r.ok) return r || { ok: false, error: "refused" };

  const stmts = (r.stmts || []).slice();
  stmts.push(env.DB.prepare(
    "INSERT OR IGNORE INTO coord_actions (id, kind, sunday, body, by_name, made, words) VALUES (?,?,?,?,?,?,?)")
    .bind(id, kind, r.sunday || "", JSON.stringify(r.body || {}), me.name, Date.now(), r.words || ""));
  await env.DB.batch(stmts);

  if (r.after) {
    try {
      const extra = await r.after();
      /* An added stop time learns its row id only once the row exists. */
      if (kind === "fix" && r.body && r.body.added && extra) {
        r.body.eventId = extra;
        await env.DB.prepare("UPDATE coord_actions SET body=? WHERE id=?")
          .bind(JSON.stringify(r.body), id).run();
      }
    } catch (e) {}
  }
  const row = await env.DB.prepare("SELECT * FROM coord_actions WHERE id=?").bind(id).first();
  return Object.assign({ ok: true, action: activityRow(row) }, r.reply || {});
}

async function handleCoord(env, body) {
  const auth = await coordAuth(env, body || {});
  if (auth.error) return { body: auth.error };
  try { await ensureCoord(env); }
  catch (e) { return { body: { ok: false, error: "The live server could not open its coordinator table." } }; }
  const me = auth.me;
  const op = String((body && body.op) || "load");
  if (op === "load") return { body: await coordLoad(env, me) };
  if (op === "bookings") return { body: await coordBookings(env, me, body.sunday) };
  if (op === "runs") return { body: await coordRuns(env, me, body.sunday) };
  if (op === "report") return { body: await coordReport(env, me, String(body.name || "")) };
  if (op === "act") {
    const out = await coordAct(env, me, body.act || {});
    return { body: out, knock: !!(out && out.ok && !out.duplicate) };
  }
  return { body: { ok: false, error: "unknown op" } };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.searchParams;

    /* A phone has just written something the sheet should have. The knock
       goes after the answer, so nobody at a kerb waits on Apps Script. */
    const knock = (res, why) => {
      try { if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(pokeSheet(env, why)); }
      catch (e) {}
      return res;
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type"
      } });
    }

    /* Before anything can answer, because json() reads it synchronously.
       Cached in the isolate, so this is a database read once every five
       minutes and a no-op the rest of the time. */
    await sheetVersionLoad(env);

    try {
      if (request.method === "GET") {
        /* Both answer ok:false with a reason rather than throwing when the
           shelf is empty or old. The driver app reads that as "ask Apps
           Script instead" and the morning carries on, slowly. */
        /* The public half of the signing key, so a page can subscribe. Public
           by design — it is what a push service checks the signature against —
           and fetched rather than pasted into config.js, so there is nothing
           to keep in step. */
        if (p.get("vapid")) return json({ ok: true, key: (await vapidKeys(env)).pub });
        if (p.get("rota")) return json(await cachedRota(env, p.get("from"), p.get("weeks")));
        if (p.get("last")) return json(await cachedLast(env));
        if (p.get("bus")) return json(await busPayload(env, "", p.get("ref"), p.get("pid")));
        if (p.get("board")) return json(await boardPayload(env, p.get("route")));
        if (p.get("trip")) {
          return p.get("route")
            ? json(await tripDriverPayload(env, p.get("route")))
            : json(await tripPayload(env, p.get("ref"), p.get("r"), p.get("s"), p.get("pid")));
        }
        return json({ ok: true, service: "minibus api" });
      }

      if (request.method === "POST") {
        /* text/plain on purpose, exactly as the pages already send it: a JSON
           content type would trigger a CORS preflight and double every write. */
        const body = JSON.parse(await request.text() || "{}");
        const action = String(body.action || "");

        /* Bookings and identify carry no token and never have: there is
           nothing on a booking row that names anybody, and the passenger page
           must never need to hold the driver token. */
        if (action === "booking") return knock(await handleBooking(env, body.booking), "booking");
        if (action === "identify") return await handleIdentify(env, body);

        /* No token on these three, for the same reason bookings carry none:
           the passenger page must never hold the driver token. Subscribing
           gives nothing away — the endpoint is the phone's own — and pushwhat
           answers only about the endpoint it was asked with, which the caller
           had to know already. */
        /* THE TWO THE EMAIL PAGE CALLS, and neither carries the shared
           token. That page is opened from a message on whatever device is to
           hand and holds no secret of its own, and the shared token is in
           config.js, which every phone downloads, so requiring it here would
           protect nothing anyway.

           What protects these is what should: the link token is the
           credential for LOOKING, and it reveals only what the email already
           said; the coordinator's PIN is the credential for ACTING. */
        if (action === "linkwhat") return await handleLinkWhat(env, body);
        if (action === "linkdo")   return knock(await handleLinkDo(env, body), "linkdo");

        if (action === "subscribe")   return await handleSubscribe(env, body);
        if (action === "unsubscribe") return await handleUnsubscribe(env, body);
        if (action === "pushwhat")    return json(await pushWhat(env, body.endpoint));
        /* Same reasoning, plus: it only ever pushes to an endpoint that is
           already subscribed, and the caller had to know that endpoint to ask.
           There is nothing here a token would protect. */
        if (action === "testpush")    return await handleTestPush(env, body);

        if (String(body.token || "") !== tokenOf(env)) return json({ ok: false, error: "bad token" });
        if (SHEET_ONLY_ACTIONS.indexOf(action) !== -1 && !sheetTokenOk(env, body)) {
          return json({ ok: false, error: "bad sheet token" });
        }

        /* Answers which copy this Worker is, which json() has already
           attached, and WHO HAS NOT GOT ALERTS ON. Used by the spreadsheet's
           Is everything working report. */
        if (action === "ping") return json(await alertRoll(env));

        /* Token checked, like every other write-adjacent action. The PIN
           itself is never stored here and never returned; only yes or no. */
        if (action === "pin") return await handlePin(env, body.pin || body);

        if (action === "trip") return knock(await handleTrip(env, body.trip), "trip");
        /* A driver asking for a swap or cover. Same body as Apps Script's
           rotaRequest, so the app sends one thing to either server. */
        if (action === "rotaRequest") return knock(await handleRotaRequest(env, body.request), "request");
        /* The walkaround. Token checked like every other write. */
        if (action === "check") return knock(await handleCheck(env, body.check), "check");
        /* Letting a bus out with a fault on it. Checks its own PIN. */
        if (action === "authorise") return knock(await handleAuthorise(env, body), "authorise");
        if (action === "endrun") return knock(await handleEndRun(env, body), "endrun");
        /* The Outcome column, edited on the spreadsheet. Token checked. */
        /* Minting one. Token checked: only the spreadsheet asks for these. */
        if (action === "mint") return await handleMintLink(env, body);
        if (action === "outcome") return await handleOutcome(env, body);
        if (action === "cleartrips") return await handleClearTrips(env, body);
        /* The spreadsheet's Rehearse and Stop rehearsing. The knock is so the
           sheet clears its own tabs within seconds. */
        if (action === "rehearsal") return knock(json(await handleRehearsal(env, body)), "rehearsal");
        if (action === "sync") return await handleSync(env, body);
        /* An alert Apps Script has just emailed, for the coordinators' phones. */
        if (action === "coordAlert") return await handleCoordAlert(env, body);
        if (action === "drain") return await handleDrain(env, body);
        if (action === "drained") return await handleDrained(env, body);
        /* A booking edited by hand on the Bus Bookings tab. Token checked. */
        if (action === "sheetbookings") return await handleSheetBookings(env, body);
        /* The coordinator's app. Token checked, and then his PIN on every
           call. A change knocks, like a booking, once he has his answer. */
        if (action === "coord") {
          const out = await handleCoord(env, body);
          const res = json(out.body);
          return out.knock ? knock(res, "coord") : res;
        }
        return json({ ok: false, error: "unknown action" });
      }

      return json({ ok: false, error: "method" }, 405);
    } catch (err) {
      /* The real text goes back, as Apps Script's did — it is the only way a
         fault gets diagnosed on Monday. Both pages already refuse to put
         developer's English on a screen; machineSpeak catches it there. */
      return json({ ok: false, error: String((err && err.message) || err) });
    }
  },

  /* The Cron Trigger. See THE CLOCK. */
  async scheduled(event, env, ctx) {
    await sheetVersionLoad(env);
    await clockTick(env);
  }
};
