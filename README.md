# Minibus

Transport for RCCG Dominion Assembly Liverpool. Two Sunday routes, two buses,
a rota of volunteer drivers, and a congregation that needs to know where the
bus is.

Three parts that share one Google Sheet and nothing else. There is no server,
no database and no user accounts. **The Sheet is the join.**

| Part | What it is | Who uses it |
|---|---|---|
| **Driver app** | Walkaround check, rota, and the live run | Drivers, on their phones |
| **Passenger page** | Book a seat, then track the bus | The congregation |
| **The Sheet** | Eight tabs and a Minibus menu | The coordinator |

Both apps install to a phone's home screen, survive no signal, and work in
light, dark, green and navy.

---

## Repository layout

Everything is served as static files from GitHub Pages. **Where a file sits
matters** — see the warning under `sunday/sw.js`.

```
/                          https://drolnstone.github.io/minibus-check/
├── index.html             the driver app (one file: markup, styles, script)
├── config.js              the only file you normally edit
├── sw.js                  the driver app's offline shell
├── manifest.webmanifest   driver app install details
├── logo.png
├── icon-192.png           \
├── icon-512.png            |
├── icon-driver-180.png     |  home screen tiles, for both apps
├── icon-sunday-180.png     |
├── icon-sunday-512.png    /
└── sunday/
    ├── index.html         the passenger page
    ├── manifest.webmanifest
    └── sw.js              the passenger page's offline shell
```

`Code.gs` is not in this repository. It lives in the Apps Script project bound
to the Sheet.

> **`sunday/sw.js` must be in the `sunday/` folder.** A service worker can only
> take charge of pages at or below its own folder. At the root it would take
> charge of the driver app instead, and the two would fight over one name. If
> you are uploading a file named `sunday-sw.js`, rename it to `sw.js` and put
> it in `sunday/`.

---

## Versioning

**Four files carry a version. They are one number.**

| File | Where |
|---|---|
| `index.html` | `var APP_VERSION` |
| `sunday/index.html` | `var PAGE_VERSION` |
| `sw.js` | `const CACHE` |
| `sunday/sw.js` | `const CACHE` |

Bump all four together, every release. This is not bookkeeping.

`Code.gs` carries a fifth, `SCRIPT_VERSION`, and it follows a **different**
rule: bump it only when `Code.gs` itself changes. It will often sit a release
or two behind the pages, and that is correct — the script changes less often
than they do.

It exists because the script's deploy is the one step that fails silently.
Pasting into the editor and saving changes nothing a phone can see; the Web
App keeps serving the last *deployed* version. Both apps now print the script's
number beside their own — `v1.32.0 · script v1.28.0` — and
**Minibus → Is everything working?** reports it on the first line. After a
deploy, if that number is not the one you just pasted, you missed
**Deploy → Manage deployments → New version**.

- A worker whose `CACHE` name has not changed **keeps serving the old app**.
  Phones will not pick up your change, and it will look like the upload failed.
- A version shown in a footer that lags behind the code is worse than no
  version at all: it gets read, believed, and sends whoever is debugging in the
  wrong direction for an hour. This has happened twice.

Both footers show the running version. **Reading a footer is the fastest way to
know which copy a phone is actually running.**

---

## Deploying

Order matters, and only in one direction.

### 1. The script, if `Code.gs` changed

Paste into the Apps Script editor, save, then **Deploy → Manage deployments →
edit → New version**. An existing deployment keeps serving the old code until
you do. The Web App URL does not change.

### 2. The site files

Upload to the repo. Keep `sunday/sw.js` in `sunday/`.

### 3. Wait about ten minutes

GitHub Pages tells browsers its files are good for **ten minutes**. Inside that
window a phone can still be handed the old file from its own cache. This is not
a fault and there is nothing to fix — just wait it out.

### 4. Open each app twice

The first open fetches the new version; the second runs it. Tell drivers to
**close the app fully** (swipe it out of the app switcher, not just go to the
home screen) rather than leaving it open on the dashboard.

**Deploy the script before the pages.** If the pages go up first they simply
won't use whatever is new in the script and will behave exactly as they did
before — no breakage either way. The reverse can leave a page asking for
something that isn't there yet.

### Checking it landed

1. Open `…/minibus-check/sunday/sw.js` in a browser. **Code = right folder.
   404 = wrong folder**, and the passenger offline shell is doing nothing.
2. Put a phone in **airplane mode** and open the passenger page. It should still
   come up. If you get the browser's no-internet page, the worker isn't running.
3. Both footers read the version you just deployed.
4. In the Sheet: **Minibus → Is everything working?**

---

## config.js

**This file is public.** Every phone that opens the app downloads it. Anything
written here can be read by anyone with the address. Names, registrations, the
endpoint and the token are here because the app cannot run without them.
Nothing else belongs here — **no PINs, no addresses, no notes explaining how
any of it could be got round.**

| Setting | What it does |
|---|---|
| `endpoint` | The Apps Script Web App URL. Blank = practice mode, nothing is sent |
| `token` | Must match `TOKEN` in `Code.gs` |
| `coordinator` | Name and number shown on the call buttons. The name is shown **whole** — write it the way people say it, e.g. `Bro Asim` |
| `recordLocation` | Stamps where a walkaround was done. Never blocks a check |
| `busBase` | Where the buses are kept, and how far still counts as "at the buses" (yards) |
| `requirePin` | Whether drivers key in a PIN. PINs live in the **Drivers tab**, never here |
| `keepAwake` | Holds the driver's screen awake between Start trip and End trip |
| `fullInspectionRoles` | Which roles are offered the full inspection |
| `drivers` | The authorised register. Only these names can be selected |
| `rotaAnchor` / `rotaPrimaryPattern` | North rota fallback, when the Sheet can't be reached |
| `rotaSecondaryAnchor` / `rotaSecondaryPattern` | The same for South |

`window.VEHICLES` below it holds each bus: registration, renewal dates
(`mot`, `service`, `insurance`, `permit` — amber inside 30 days), the
per-vehicle fault history that tells a driver what has gone wrong on **this**
bus before, and any checks to skip or reword.

`rotaAnchor` must match `PATTERN_ANCHOR` in `Code.gs`, and
`rotaSecondaryAnchor` must match `PATTERN_ANCHOR_SOUTH`.

---

## The Sheet

### Tabs

| Tab | Holds |
|---|---|
| **Checks** | Every walkaround, with verdict, odometer, fuel, signature, location |
| **Defects** | Anything reported, with a status to work through |
| **Rota** | Who drives which route, which Sunday |
| **Rota Requests** | Swaps and cover, pending your decision |
| **Drivers** | Name, Role, Active, Primary order, PIN, Email, Route, Phone |
| **Bus Stops** | Route, Stop ID, Time, Stop, Postcode, Active, Type |
| **Bus Bookings** | Who booked which stop, this Sunday |
| **Trip Events** | Every tap a driver makes. The record the whole live page rests on |

### The Minibus menu

- **Bus link for this Sunday** — the link to share
- **Bookings for this Sunday**
- **Checks** → Is everything working? · Who is carrying the load · Who is
  tapping · Check the Drivers tab · Check time zone
- **Rota** → Set up / refresh rota · Refresh dropdowns · Add a Sunday · Extend
  further ahead · Check scheduled emails · Rebuild future Sundays
- **Emails** → Test email · Weekly summary · Sample duty reminder · Duty
  reminders to the drivers
- **Lock / unlock the sheet**
- **Rehearsal** → Rehearse this Sunday · Stop rehearsing

### Running on its own

| When | What |
|---|---|
| Daily 03:00 | Nightly tidy-up |
| Daily 08:00 | Duty reminders to drivers due to drive |
| Sunday 10:45 | Alert if a check hasn't come in |
| Sunday 19:00 | Weekly summary |
| On edit | A note when someone changes the rota |

Set `COORDINATOR_EMAIL` in **Project Settings → Script Properties**, not in the
code.

### Stop types

The `Type` column takes **Pickup**, **Arrival** or **Depart**.

- **Pickup** — a kerb where people wait.
- **Arrival** — the church, at the end of the route.
- **Depart** — a *timing point*, not a place. One row per route, holding the
  time the bus is timetabled to leave church. It is filtered out of every stop
  list, booking list and driver tap list. It exists so the run has an honest
  offset from the moment it pulls out, which is what lets the passenger page
  say **"On its way, three minutes behind"** before a single stop is marked.

---

## Things that will bite you

**Google Sheets Tables.** If a tab has been converted to a Table, the script
cannot write formatting to it and setup fails with *"This operation is not
allowed on cells in typed columns."* Fix: select the tab, **Format → Convert to
range**. Cosmetic writes are individually guarded now, so setup no longer stops
dead — but the tab stays unformatted until you convert it.

**Never clear Trip Events rows by hand.** Use **Undo** in the driver app. A
blanked row leaves the run's arithmetic reading a gap that was never there.

**Don't run helper functions from the Apps Script editor.** Use the Minibus
menu. Functions like `applyStatusDropdown` expect arguments the editor's Run
button doesn't give them.

**The two service workers must never cache the same file.** `caches.keys()`
answers for the whole site, so each worker deletes only caches matching its own
prefix (`minibus-check-` / `minibus-sunday-`). Break that and each app wipes
the other's cache on activation — and nothing looks wrong until somebody loses
signal.

**Nothing shows the driver a new version mid-session.** The check happens at
launch. An app left open all morning runs the version it started with.

---

## Rules the app enforces

- **Only the rostered driver for that route, or his named cover, can tap.**
  Everyone else — including other drivers — can watch, read-only.
- **A critical defect stops the bus.** The app records and warns; it cannot
  immobilise anything.
- **Taps are refused while the bus is moving**, and a tap that is impossibly
  early asks for confirmation before it is taken.
- **The driver's number reaches only a booked phone, on that route, on the
  day.** Anyone else watching gets the coordinator's number.
- **A check that could not be verified says so.** Offline PIN entry is recorded
  as `offline`, never as `ok`.

---

## What it does not do

- No live map, no passenger GPS. Position is inferred from the driver's taps.
  Between two stops it genuinely does not know.
- No push notifications. The page has to be open.
- It never messages anyone by itself. WhatsApp links open pre-filled; a person
  presses send.
- No return leg, no seat allocation, no fares, no payments.

---

## For anyone reviewing this

The reasoning behind most decisions is **in the code, next to the decision** —
not in this file, and not in a wiki that will drift. Comments explain what went
wrong before and why the code is shaped the way it is. Start with:

- `tripPayload` in `Code.gs` — everything a passenger is told, and the gates on it
- `tripMerge` and `tripMayTap` in `index.html` — run state and who may write to it
- `paintLive` in `sunday/index.html` — every state a passenger can see
- `freshFirst` in either `sw.js` — the caching rules and the faults that shaped them

Worth challenging: the offline-first tap queue and its clock-skew correction;
the trust model, where a public token is the only thing between the internet
and a write; the privacy boundary around the driver's number; and the fact that
a passenger's identity is a phone number and a fingerprint of one.
