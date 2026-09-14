# Minibus

The Sunday bus for RCCG Dominion Assembly, Liverpool. Three screens, one
spreadsheet, one small server.

- **Driver app** — the pre-drive safety check, the driving rota, and the live
  stop list a driver taps his way down on a Sunday morning.
- **Passenger page** — book a seat, then watch the bus come.
- **The spreadsheet** — the record, the rota, and everything a coordinator
  edits by hand.

Nothing here needs an account, an install, or an app store. A driver opens a
link. A passenger opens a link.

---

## Where things live

| | |
|---|---|
| Pages | GitHub Pages — `drolnstone.github.io/minibus-check/` |
| Slow server | Google Apps Script, bound to the spreadsheet |
| Fast server | Cloudflare Worker — `minibus-api.asimbassey.workers.dev` |
| Database | Cloudflare D1 (`minibus`), bound in the Worker as `DB` |
| Record | one Google Sheet |

### Who owns what

This matters more than anything else in this file.

**The spreadsheet owns** the rota, the drivers, the buses, the stops, and
every safety check. It is the record. If the two servers ever disagree, the
spreadsheet is right.

**The Worker owns** what happens *during* a Sunday: bookings as they are made,
and stop taps as they happen. Both are drained back onto the spreadsheet every
five minutes, so the record still ends up in one place.

**The Worker also sends the alerts.** Apps Script cannot: it has no process
that is ever awake, and no way to sign a push. See *Alerts*, below.

**The Worker also keeps a shelf** — a copy of the finished rota and last
week's mileage, built by Apps Script and posted over. It serves those back
instantly instead of making a phone wait five to ten seconds for Apps Script
to build them again. It refuses anything on the shelf older than six hours, and
a refusal makes the app ask Apps Script directly. Slow and right beats fast and
wrong.

---

## The files

```
index.html              the driver app
sw.js                   its offline shell  — bump CACHE when index.html changes
config.js               vehicles, drivers, stops, endpoints
manifest.webmanifest
sunday/index.html       the passenger page
sunday/sw.js            its offline shell  — separate on purpose, see below
sunday/manifest.webmanifest
Code.gs                 everything on the Apps Script side
worker.js               everything on the Cloudflare side
schema.sql              the D1 tables
```

The two service workers are deliberately separate and must never cache the
same file. One phone with both apps installed would otherwise hold two copies
of a page at two versions and serve whichever answered first.

---

## Versions — read this before deploying

There are **five** version stamps and four of them must move together.

| Stamp | File |
|---|---|
| `APP_VERSION` | `index.html` |
| `CACHE` | `sw.js` |
| `PAGE_VERSION` and the `BUILD` comment | `sunday/index.html` |
| `CACHE` | `sunday/sw.js` |
| `SCRIPT_VERSION` | `Code.gs` (moves on its own) |
| `SCRIPT_VERSION` | `worker.js` (moves on its own) |

**If you change any page and do not bump all four page stamps, phones keep the
old copy** and it will look as though the deploy failed.

The app prints its version at the foot of the first screen. Apps Script shows
its deployment number in the editor. After a deploy, check both.

---

## Deploying

Order matters, because the pages depend on the two servers being ready.

0. **First time only:** paste `schema-push.sql` into the D1 console and run it.
   It adds the one table the alerts need.
1. **worker.js** → Cloudflare dashboard → Deploy
2. **Code.gs** → Apps Script editor → Save → Deploy
3. Minibus menu → **Send everything to the live server now**
4. Minibus menu → **Is the live server working?** — it should report the rota
   and mileage copies as a few minutes old
5. **The pages** → GitHub

Steps 1–4 need a computer. Step 5 can be done from a phone.

Out of order, nothing breaks: the app asks a Worker with nothing on its shelf,
gets a clean refusal, and falls back to Apps Script. It simply will not be any
faster until the sync has run.

### Rollback

Blank `liveEndpoint` in `config.js` and redeploy the pages. Every call returns
to Apps Script — slow, and correct. That one line is the whole escape hatch.

---

## Configuration

**`config.js`** — the church details, the vehicle list, the checklist, the
driver register (a fallback until the sheet answers), and two addresses:

```js
endpoint:     "https://script.google.com/macros/s/.../exec"   // Apps Script
liveEndpoint: "https://minibus-api.asimbassey.workers.dev"    // the Worker
```

**Apps Script → Project Settings → Script Properties**

| Key | What it is |
|---|---|
| `COORDINATOR_EMAIL` | where every alert goes. Blank means nothing is ever sent |
| `WORKER_URL` | the Worker's address |
| `ARCHIVE_SHEET_ID` | optional. Set it to archive into a separate spreadsheet |

**Cloudflare → Worker → Settings → Variables**

| Key | What it is |
|---|---|
| `TOKEN` | must match `token` in `config.js` |
| `PHONE_SALT` | salts the phone fingerprint. Changing it orphans every existing booking |

Both have fallbacks in `worker.js` so a fresh deploy works before they are set.
Set them.

---

## The spreadsheet

| Tab | Holds |
|---|---|
| `Rota` | who drives, which route, which bus, per Sunday |
| `Drivers` | the register — name, role, route, order, active, **PIN** |
| `Buses` | registration, seats, active |
| `Bus Stops` | route, stop, time, postcode |
| `Checks` | every safety check |
| `Defects` | one row per defect, so they can be chased |
| `Bus Bookings` | passenger bookings |
| `Trip Events` | every stop tap |
| `Rota Requests` | swaps and cover asked for by drivers |

The Worker's own database holds the same stops, rota, buses and drivers (a
copy, pushed from here), the bookings and taps as they happen, the shelf, and
`push_subs` — one row per phone that has asked to be told things.

**Give every active driver a PIN.** The PIN is what puts a name on a record. A
driver without one is waved through every gate in the app, and because a
sign-in now survives a page reload, that matters on a handset somebody else
picks up later. **Is everything working?** names anyone missing one.

### Scheduled jobs

Six, all installed by **Check scheduled emails, set up any missing**:

| When | What |
|---|---|
| every 5 min | sync with the live server |
| nightly, 3am | rota tidy-up, archive, push to the live server |
| daily | duty reminders, 7 days and 1 day ahead |
| Sunday 10:45 | tells you if a bus went out unchecked |
| Sunday evening | the weekly summary |
| on edit | alerts when a Sunday changes |

---

## How a Sunday runs

**Before.** The rota fills itself weeks ahead. Duty reminders go out a week
before and again the day before, each naming the route and the bus, with a
calendar file attached. Passengers book through the link. If more people book
than the bus holds, you get an email while there is still time to do something.

**Morning.** The driver signs in, keys his PIN, walks round the bus. A critical
defect stops the bus and nothing will start a run on it. He picks his bus,
starts the trip, and taps each stop as he pulls away. Every tap reaches the
passenger page in about five seconds.

**After.** He ends the trip. Bookings for next Sunday open. Everything drains
onto the spreadsheet.

### Alerts

Passengers who have booked can turn on notifications from the live panel. They
get four, and no more:

- the bus has left church, with their own timetabled time
- about twelve minutes to their stop, and where the bus actually is
- **the bus is coming to your stop** — one buzz, when it becomes true
- the bus has gone past and nothing was recorded at their stop

Drivers get one: **End the trip**, when a run is past its arrival time and has
gone quiet. Twice, a quarter of an hour apart, then it leaves them alone. It
exists because that tap has now been missed twice, and every other nudge in the
app lives inside the app — which is the one place a man who has parked and
walked into the service is not looking.

**On an iPhone, alerts only work once the page is on the Home Screen.** Safari
in a tab gets nothing, silently. The install sheet says so, to iPhones only.
Android works from a plain tab. So do not retire the group message.

Two things worth knowing about how it is built. The push itself **carries no
payload** — the phone is woken, and its service worker asks the Worker what
that means, so the message is built when it is read rather than when it was
queued, and there is no payload encryption to get subtly wrong. And the signing
keys are **made by the Worker on first use** and kept in its own database:
nothing to generate, paste or lose.

A rehearsal wakes nobody.

### Rehearsing

**Rehearse this Sunday** seeds test bookings and lets you drive the whole
morning on a Thursday evening. Ask for a *quiet*, *normal*, *full* or *over*
morning; the stops and numbers are drawn fresh each time, so you can run it as
often as you like. Test bookings are tagged `Rehearsal`, never counted as real,
and swept when you stop. It switches itself off after two hours.

---

## When something looks wrong

**Start with Minibus → Is everything working?** It checks the tabs, the
scheduled jobs, the email allowance, the driver PINs and the row counts.

| Symptom | Look at |
|---|---|
| The app is slow again | **Is the live server working?** — if the shelf is past six hours, run **Send everything to the live server now** |
| A deploy seems to have done nothing | the version at the foot of the app, and the deployment number in the editor. Then check all four page stamps moved |
| A driver has no Start trip | is he in the Rota's *actual / cover* column for that route? |
| A driver made no entries at all | he was signed out. The app now restores his name and offers a Sign in button wherever it would otherwise go quiet |
| Bookings will not open for next week | last Sunday's run was never ended |
| No emails at all | `COORDINATOR_EMAIL` is blank, or the daily allowance is used up |

---

## Two things to know before changing anything

**The PIN confirms your name on a record. It does not protect information.**
Reading the rota and the stop list writes nothing and stays open to anybody who
opens the app — a steward at the door, a coordinator on a borrowed phone, a
driver who is not out today. Anything that files a record under a name asks
first. Every gate in the app follows that rule; keep it.

**What an app can do at the kerb is write down what happened, not prevent it.**
There is exactly one hard refusal in the whole system: a bus stopped by a
critical defect will not start a run. Everything else warns and lets him
through, because a block does not produce a check — it produces a morning that
went unrecorded.
