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
| **Buses** | Registration, Seats for passengers, Active, Notes |
| **Bus Stops** | Route, Stop ID, Time, Stop, Postcode, Active, Type |
| **Bus Bookings** | Who booked which stop, this Sunday |
| **Trip Events** | Every tap a driver makes. The record the whole live page rests on. The start row also carries the rota's bus and where the run began |

#### Adding your own column

**Every tab finds its columns by reading the headings.** Insert a column of
your own anywhere on any tab — a note, a headcount, a fare, a cost — and the
app reads straight past it. Your column keeps its heading and its values
through every refresh, and nothing the app writes will land in it.

Two rules, and they are the only two:

- **Do not rename or delete a heading the app uses.** If you do, the app stops
  with a sentence naming the column, and **Minibus → Rota → Set up / refresh
  rota** puts it back.
- **Add a bus by adding a row, never by retyping a registration.** Every other
  tab refers to a bus by its registration, so renaming one detaches it from its
  own history.

Column *order* is yours. Move them, insert between them, widen them. The app
does not care where a column sits, only that its heading is still spelled the
way it was.

### The Minibus menu

- **Bus link for this Sunday** — the link to share
- **Bookings for this Sunday**
- **Checks** → Is everything working? · Who is carrying the load · Who is
  tapping · **Which bus is on which route** · Check the Drivers tab · Check time zone
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

## Two ways a driver starts a Sunday

Both are normal. The app supports each fully and tells the driver the same
things in both.

### 1 · The walkaround

Name → PIN → **"Which one today?"** → forty-five items → sign → later, *Stops
and bookings* → Start trip.

### 2 · Straight to driving

Weather, running late, or the coordinator did the check already. He opens
*Stops and bookings*, enters his PIN there, and presses Start trip. **No
walkaround.** This is a supported path, not a workaround.

### What he is told, on both

| | Walkaround | Straight to driving |
|---|---|---|
| His bus listed **first** | on the picker | on the Start trip buttons |
| Tagged **"North today"** | yes | — (the button names it) |
| Asked if he picks another | **yes**, on Continue | **yes**, on Start trip |
| Seats and bookings | on the stops screen | on the stops screen, and under the button |
| Missing check | n/a | the existing "No check signed" gate, unchanged |

**The question is one pop-up, shared by both paths**, so the wording cannot
drift apart:

> **Not the bus you were given**
> The rota has **NH56 FWP** for North today.
>
> **[ Stay with YS70 PWE ]  [ Take NH56 FWP ]**

One line and two buttons, whatever the numbers. The bus he chose is on the
button he is about to press, and the seat count is already on the screen behind
the sheet, so neither is repeated here.

*Take* switches him and carries on. *Stay* keeps his choice and carries on.
**Neither refuses.** On the walkaround path it asks at **Continue**, not on
tapping a card — choosing a card is browsing; Continue is committing a bus to
an inspection.

### Who gets asked

Only a driver **actually out today** — rostered, or named as cover. A driver
doing a check as a favour, or a coordinator checking a bus in advance, gets no
tag and no question: the rota gave him neither, so the app has nothing to tell
him.

### Where the answer comes from

The day's buses ride on the **one call the app makes at launch** (last week's
mileage). Before that they only arrived when *Stops and bookings* opened —
which is *after* the picker, so the information was reaching the driver later
than the moment it was for. That same change is why the script version now
appears in the footer within a second of opening the app.

### Which bus leads the Start trip buttons

1. The bus he **walked round in this session** — a check is the strongest
   statement about what he is about to drive, and it is the one that will not
   stop to ask him about a missing check.
2. Then the bus the **rota** gave the route.

Most Sundays these are the same bus. They only disagree when he has
deliberately taken the other one, and then his own walkaround wins.

### Location

Two fixes, both at the start of something, and nothing in between.

**When a walkaround begins** — recorded on the Checks tab as *Where checked*,
*Accuracy*, *Distance from base* and a note.

**When Start trip is pressed** — recorded on the Trip Events **start row** as
*Where started*, *Accuracy (yd)* and *Distance from base (yd)*. Not on every
tap: a fix per stop would be tracking the bus, which this app does not do.

The second one exists because the two are different facts. A bus can be
inspected at the yard and driven somewhere else before anyone presses Start,
or be on the road already when somebody remembers to. On a Sunday driven
without a walkaround it is the only thing that places the bus anywhere.

Neither ever blocks or delays. The run starts on screen the moment the button
is pressed; only the queued row waits, and the queue is built to wait. If the
phone refuses or takes too long, **the reason goes in the cell where the
position would have been** — a blank cell and a refused one are different
facts. Both are governed by `recordLocation` in `config.js`.

### What the record shows about the bus

The start row also carries **Rota bus** — the bus the rota gave that route —
beside **Reg**, the bus that actually went. A row where the two differ is a
deviation, visible without cross-referencing anything.

---

## Things that will bite you

**Google Sheets Tables.** If a tab has been converted to a Table, the script
cannot write formatting to it and setup fails with *"This operation is not
allowed on cells in typed columns."* Fix: select the tab, **Format → Convert to
range**. Cosmetic writes are individually guarded now, so setup no longer stops
dead — but the tab stays unformatted until you convert it.

**Column headings are read by name on the Rota tab.** Rename one and the app
stops and tells you which; it does not guess. Every other tab is still read by
position, so a renamed column there would be read silently as the wrong one —
which is why *Is everything working?* now checks the headings on all nine tabs.
Run it after any change to a sheet.

**Which bus, which route.** The rotation swaps every calendar month — a month
is four or five Sundays, so it never falls into step with a three or four
driver rota and nobody stays in one bus. `BUS_ROTATION_ODD` in `Code.gs` sets
the pairing for odd-numbered months; even months are the reverse. The *North bus* and *South bus*
columns on the Rota are **filled in for you** as far ahead as the rota goes.
Change one and it stays changed: the app **only ever writes into an empty
cell**, so it will never undo a decision of yours. Past Sundays are never
touched — what actually went out is recorded in Trip Events, not here. To put a
Sunday back the way the rotation wants it, clear the cell and run *Set up /
refresh rota*; to reset them all — after swapping `BUS_ROTATION_ODD` — use
**Minibus → Rota → Rebuild the bus rotation (asks first)**.
Seats live on the **Buses** tab and are PASSENGER seats, not counting the
driver.

**What people see.** The booking page says nothing about seats until three are
left, then "3 seats left", then "Bus full". **Booking is never refused** — the
app has never known who really travels, and a page is the wrong thing to turn
somebody away; a full route tells them to say something instead. The driver's
board reads "13 booked of 14", and if he takes the bus the rota did not name he
is told so under that button, with what it costs in seats. It does not stop
him: the check gate already stops a bus that should not run, so a driver
reaching for the other one has a reason.

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
