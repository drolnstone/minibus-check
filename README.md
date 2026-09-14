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

### After the deploy: rehearse it

Run this every time, on any evening before the Sunday it is meant for. It takes
about ten minutes. Nothing in it touches the real record.

1. **Check the version.** The foot of the driver app's first screen should read
   the version you just deployed. If it has not moved, the paste did not land,
   and nothing below it is testing what you think it is.

2. **Minibus → Have a look → Is everything working?** Fix anything it names. It
   lists any active driver with no PIN.

3. **Minibus → Have a look → Is the live server working?** The rota and mileage
   copies should read a few minutes old. Past six hours, run **Rota and setup →
   Send everything to the live server now**, then check again.

4. **Minibus → Rehearse this Sunday.** Ask for *over*. It is the shape most
   likely to show up a problem, and step 10 needs a route that is over.

5. **Driver phone.** Open the app, sign in, key the PIN. It should jump to the
   hub on its own. Go to Stops and bookings, then Start trip.

6. **Tap two stops**, one **Picked up** and one **Nobody there**.

7. **Skip one deliberately.** Mark a stop further down the list without marking
   the booked one before it. The app should ask you about the one you passed,
   naming it, with three buttons. **Not now** should silence it and leave that
   row amber with its own buttons back.

8. **Second phone.** Open the passenger link. The clock should tick, and the
   panel should move down the list within about five seconds of each tap.

9. **End trip, arrived at church.** The run closes and bookings for the
   following Sunday open again.

10. **Minibus → Have a look → Are we over on seats?** One email should arrive,
    carrying the line that says these are test bookings.

11. **Minibus → Stop rehearsing.** The test bookings are swept. It also
    switches itself off after two hours if you forget.

12. **Alerts, separately.** A rehearsal sends no push at all, deliberately, and
    the driver's End trip reminder waits for a run to be past its arrival time,
    which a weekday evening never is. So nothing above tests alerts. Turn them
    on, then use **Send me a test** on the hub, or **Check my alerts are
    working** on the passenger panel. A notification should arrive within a few seconds
    saying *Alerts are working*. If the push service refuses, the reason
    appears on the screen instead. Do this on every phone that matters, and on
    an iPhone only after the app is on the Home Screen.

13. **Cover, if you want it tested.** Sign in as somebody not on the rota for
    that route and open Stops and bookings. **I am covering this run** should
    appear, take two taps, and then behave like an ordinary start. Sign in as a
    third name while that run is open and you should be refused by name. Note
    that a rehearsal run is tagged `Rehearsal`, not `Cover`, so it will not
    write anything into the Rota. Only a real run does that.

14. **A cancelled route, if you want it tested.** Set the Rota's Status to
    *North cancelled*, wait for the next sync, and open the passenger link on a
    phone with a booking on North. The panel should say the bus is not running
    and the stops should go grey. Put the Status back to *Confirmed* when done.
    No alert will arrive while a rehearsal is running, by design.

**Two things a rehearsal cannot test.** The alerts, which is step 12 and why it
is there. And the run closing itself, which needs the bus to physically leave
the church geofence and come back to it — a Thursday evening in the car park
will never produce one. Watch the first real Sunday for a `Logged (auto)` row
instead.

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

Two settings govern the run closing itself:

```js
churchBase: { lat: 53.424169, lng: -2.936799, radius: 165 },  // yards
autoEnd:    { enabled: true, minutes: 3 },
```

**At this church the buses park in front of it, so `churchBase` carries the
`busBase` figures and is already correct.** It stays a setting of its own
because the next church to use this may keep its buses somewhere else, and a
run that closes itself at the depot instead of at the door is worse than one
that never closes. Leave it out and `busBase` is used.

If it is ever pointed at a different place, measure it standing at the door and
not off a map. The bus base was 103 metres out when it was taken off a postcode
centre, and at this fence size that is the difference between a run that closes
itself and one that never does.

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
| `Rota` | who drives, which route, which bus, per Sunday. **Status** is also where a route is marked not running |
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

If he moves on without marking a booked stop, the app **asks him about it** —
the earliest one behind him, once, with the same two buttons the row carries.
The earliest rather than the nearest, because the person still standing there
has been standing the longest. **Not now** silences that stop for the rest of
the run and leaves it amber in the list. While the question is up, that stop's
own row buttons are suppressed: one stop, one place to answer it.

**After.** He ends the trip — or it ends itself. See below. Bookings for next
Sunday open. Everything drains onto the spreadsheet.

### When a bus cannot go

Two buses, one per route. When one of them cannot go, that route stops and the
other runs as normal. Set the Rota's **Status** column for that Sunday:

| Status | Means |
|---|---|
| `North cancelled` | North is off, South runs |
| `South cancelled` | South is off, North runs |
| `Cancelled/declined` | neither route runs |

Within five minutes of setting it:

- everybody who booked that route gets **one** alert saying the bus is not
  running, tagged per route per Sunday so changing your mind and changing it
  back does not buzz the same pocket twice
- their live panel says so, with a call button, instead of showing a bus that
  never starts
- no further seats can be booked on it. **Withdrawing stays open**, for the
  same reason it stays open after the cutoff: somebody taking their name off a
  list is worth hearing at any hour
- the rostered driver is told, and it outranks the stopped-bus message, because
  a morning can be called off for reasons that have nothing to do with a defect

The match is on the **whole** status string, in lower case. A substring test
would make `South cancelled` true for a route called `South West` the day one
is added.

**The two new options need the dropdown refreshed** before the Rota will offer
them: Minibus → Rota and setup → **Refresh dropdowns from Drivers tab**.

### Ending itself

Once the bus has been back inside the church geofence for three unbroken
minutes, the run closes on its own, a notification says it has, and the app
offers to reopen it for half an hour afterwards.

It is not a prompt, on purpose. The whole reason End trip gets missed is that
he has parked and walked inside, and a man who is not looking at his phone will
not answer a prompt either.

Three things make it safe:

- **It must have left first.** The bus starts inside the fence, in the yard, so
  without that a run would close about thirty seconds after Start trip.
- **A vague fix has no opinion.** A reading with more uncertainty than the fence
  is worth counts as neither in nor out. It neither starts the clock nor breaks
  it, so a red light two streets away cannot end a run and a bad fix in the car
  park cannot reset a timer that was nearly up.
- **It needs the app open** on the dashboard, which is what `keepAwake` is for.
  A phone face down in a pocket gives no positions, and the run falls back to
  the End trip reminder.

Auto-ends land on the record as `Logged (auto)`. A week of them is how you find
out whether the fence is in the right place.

### Alerts

Passengers who have booked can turn on notifications from the live panel.

**There are three things that send a passenger a push, and no more.** This
matters, because an earlier version of this file listed the four *wordings*
below as though each were its own event, and they are not.

| Sent when | Who |
|---|---|
| the Rota marks that route not running | everybody booked on it |
| the driver taps **Start trip** | everybody booked on that route, once each |
| the driver marks a stop | the next stop down the line with anybody at it, plus any earlier stop he went past unmarked |

The **words** are worked out when the phone is looked at, not when the push was
sent, so one buzz can read as any of these depending on what is true at that
moment:

- the bus is not running today
- the bus has left church, with their own timetabled time
- about *n* minutes to their stop, and where the bus actually is
- the bus is coming to your stop, when they are a minute or less away
- the bus has gone past and nothing was recorded at their stop

Nothing watches the clock on a passenger's behalf. "The bus is coming to your
stop" is not a push that fires when it becomes true; it is how whichever push
happens to land at that moment is worded.

**The first booked stop on a route gets one push and the rest get two.** The
approach push wakes the stop *after* the one just marked, and the first stop
has nothing before it. Its passengers get the departure push, which is an
estimate to their own kerb at the moment the bus starts moving toward them, and
nothing after that. This is deliberate and may be wrong. If somebody at a first
stop is ever left standing, the fix is a timed sweep serving every stop rather
than a patch for that one.

Drivers get five, and **only ever one at a time**:

| | When |
|---|---|
| **Your route is not running today** | the Rota's Status says so. Above the stopped bus, because a morning can be called off for reasons that have nothing to do with a defect, and a driver who turns up to a cancelled run has wasted it for nothing |
| **Your bus was stopped by the check** | a walkaround stopped the bus the rota puts on his route, and he has not set off. It tells him to ring the coordinator, which is what every other stopped-bus message in the app says. The app does not choose a replacement vehicle |
| **The bus has not gone out** | ten minutes past **the departure time on the Bus Stops tab**, with nothing started. Twice, then it stops. Not the 09:30 booking cutoff: a route with no Depart row gets no nudge at all rather than a guess |
| **End the trip** | a run past its arrival time that has gone quiet. Twice, a quarter of an hour apart |
| **You are driving today** | Sunday between 07:30 and 08:30, when nothing else is wrong |

The order in that table is the priority, and it is the design. One decision per
route per sweep, taken by how much it costs him to not know.

That matters more than it looks. The push carries no payload, so the phone asks
the Worker what it means when it lands. Three separate sweeps would fire two
pushes in one pass on a Sunday with a stopped bus, and **both** would resolve to
whichever had run last: he would be told twice that he was driving today, and
the thing he actually needed would go out over the wire and arrive as nothing.
So the sweep picks one, and the words are worked out from the record when the
phone asks rather than from the tag. A push that sat in a tunnel for ten
minutes says what is true when he reads it.

**On an iPhone, alerts only work once the page is on the Home Screen.** Safari
in a tab gets nothing, silently. The install sheet says so, to iPhones only.
Android works from a plain tab. So do not retire the group message.

Two things worth knowing about how it is built. The push itself **carries no
payload** — the phone is woken, and its service worker asks the Worker what
that means, so the message is built when it is read rather than when it was
queued, and there is no payload encryption to get subtly wrong. And the signing
keys are **made by the Worker on first use** and kept in its own database:
nothing to generate, paste or lose.

**A rehearsal wakes nobody.** The Worker skips every passenger alert while one
is running, the cancellation sweep included, and the driver's nudges are held
back by the clock, since a weekday evening is never past Sunday's departure or
arrival time. Both are correct, and
between them they used to leave one question permanently unanswered: whether
Google and Apple accept what the Worker signs. A malformed token looked
exactly like a quiet Sunday.

### Testing an alert

Once alerts are on, both apps offer a test. **Send me a test** sits on the
driver's hub where the Turn on offer was; **Check my alerts are working** sits
on the passenger panel, and only for somebody booked this Sunday. It pushes to that one phone and to nobody else.

- A notification saying **Alerts are working** means the whole chain is good:
  the signing, the push service, the wake, and the service worker asking the
  Worker what it means.
- A refusal is shown on the screen with the push service's own status. 401 is
  the token. 404 and 410 mean that phone is gone for good, so the row is
  deleted and the Turn on offer comes back.
- Nothing arriving, with no refusal on screen, means the push service took it
  and did not deliver. On an iPhone that is almost always a page in a tab
  instead of on the Home Screen.

It bypasses the Sunday dedup entirely, so it can be run as often as needed and
changes nothing a real run depends on. One at a time per phone, twenty seconds
apart.

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
| Passengers waiting for a bus that was called off | the Rota's Status for that Sunday. `North cancelled` or `South cancelled` tells them within five minutes |
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
There are exactly **two** hard refusals in the whole system, and everything
else warns and lets him through, because a block does not produce a check. It
produces a morning that went unrecorded.

1. **A bus stopped by a critical defect will not start a run.** The app
   recorded that vehicle as unfit; it is not then going to help somebody drive
   it.
2. **A route that already has a run open will not start a second one.** Not
   about the record, about the road: two buses cannot run one route at once.
   A second start would split the morning's taps across two runs and leave the
   passenger page flicking between them.

The second one is refused in **both** places, the app and the Worker. It has to
be. The app judges it off a board answer a few seconds old, so two thumbs
coming down inside that window would both be told yes.

A refused batch stays in the phone's queue and is not discarded. There is no
special handling beyond that, on purpose: with two buses and one per route,
two drivers cannot be on one route, so the refusal is a guard rather than
something anyone should expect to meet.

**If two runs ever are filed against one route on one Sunday**, the board
reports the one that started last and reads only that run's rows. Both stay on
the record. Folding them together was a real bug: the later run read as already
finished and carried the earlier one's stops.

### Covering a route

A driver who is not on the rota for a route, when nobody is out on it, is
offered **I am covering this run** — its own button, confirmed with a second
tap, behind his PIN. It is deliberately not the ordinary Start trip button:
folding cover into the normal gate would put a live Start trip in front of
every driver for every route, and the man rostered North would be one stray tap
from starting South in his own name.

The run lands on the record with the status **Cover**, and the next five
minute sync **writes that name into the Rota's *actual / cover* column by
itself**. A blank rota line counts as cover too.

It fills the cell **only when the cell is blank**, and that rule is the whole
of it. A name a person typed is a decision; an observation is not. If you wrote
Bro Moses and Bro Calvin actually drove, the useful fact is that the two
disagree, and an app that rewrote the column to match itself would destroy the
only evidence of it. So a filled cell is never touched, whoever filled it and
whoever drove. The Rota keeps saying one name, Trip Events keeps saying the
other, and a person decides which is right.

Nothing there creates a rota row either. A Sunday with no row is a Sunday
nobody planned, and inventing one from a bus that went out would put a
fabricated plan into the record.

The status column now carries more than one fact at a time, so a run that was
both unchecked and covered reads `Unchecked, Cover`. Apps Script reads that
column with a **contains** test from `Code.gs` v1.56.0 onward, so the order of
those words does not matter. It did on v1.55.0 and earlier, which used a prefix
test: anything in front of the word made an unchecked run stop counting as
unchecked, silently, in the one report that exists to count them. **If the Apps
Script side is ever rolled back past v1.56.0, `Unchecked` has to lead again.**# Minibus

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

### After the deploy: rehearse it

Run this every time, on any evening before the Sunday it is meant for. It takes
about ten minutes. Nothing in it touches the real record.

1. **Check the version.** The foot of the driver app's first screen should read
   the version you just deployed. If it has not moved, the paste did not land,
   and nothing below it is testing what you think it is.

2. **Minibus → Have a look → Is everything working?** Fix anything it names. It
   lists any active driver with no PIN.

3. **Minibus → Have a look → Is the live server working?** The rota and mileage
   copies should read a few minutes old. Past six hours, run **Rota and setup →
   Send everything to the live server now**, then check again.

4. **Minibus → Rehearse this Sunday.** Ask for *over*. It is the shape most
   likely to show up a problem, and step 10 needs a route that is over.

5. **Driver phone.** Open the app, sign in, key the PIN. It should jump to the
   hub on its own. Go to Stops and bookings, then Start trip.

6. **Tap two stops**, one **Picked up** and one **Nobody there**.

7. **Skip one deliberately.** Mark a stop further down the list without marking
   the booked one before it. The app should ask you about the one you passed,
   naming it, with three buttons. **Not now** should silence it and leave that
   row amber with its own buttons back.

8. **Second phone.** Open the passenger link. The clock should tick, and the
   panel should move down the list within about five seconds of each tap.

9. **End trip, arrived at church.** The run closes and bookings for the
   following Sunday open again.

10. **Minibus → Have a look → Are we over on seats?** One email should arrive,
    carrying the line that says these are test bookings.

11. **Minibus → Stop rehearsing.** The test bookings are swept. It also
    switches itself off after two hours if you forget.

12. **Alerts, separately.** A rehearsal sends no push at all, deliberately, and
    the driver's End trip reminder waits for a run to be past its arrival time,
    which a weekday evening never is. So nothing above tests alerts. Turn them
    on, then use **Send me a test** on the hub, or **Check my alerts are
    working** on the passenger panel. A notification should arrive within a few seconds
    saying *Alerts are working*. If the push service refuses, the reason
    appears on the screen instead. Do this on every phone that matters, and on
    an iPhone only after the app is on the Home Screen.

13. **Cover, if you want it tested.** Sign in as somebody not on the rota for
    that route and open Stops and bookings. **I am covering this run** should
    appear, take two taps, and then behave like an ordinary start. Sign in as a
    third name while that run is open and you should be refused by name. Note
    that a rehearsal run is tagged `Rehearsal`, not `Cover`, so it will not
    write anything into the Rota. Only a real run does that.

14. **A cancelled route, if you want it tested.** Set the Rota's Status to
    *North cancelled*, wait for the next sync, and open the passenger link on a
    phone with a booking on North. The panel should say the bus is not running
    and the stops should go grey. Put the Status back to *Confirmed* when done.
    No alert will arrive while a rehearsal is running, by design.

**Two things a rehearsal cannot test.** The alerts, which is step 12 and why it
is there. And the run closing itself, which needs the bus to physically leave
the church geofence and come back to it — a Thursday evening in the car park
will never produce one. Watch the first real Sunday for a `Logged (auto)` row
instead.

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

Two settings govern the run closing itself:

```js
churchBase: { lat: 53.424169, lng: -2.936799, radius: 165 },  // yards
autoEnd:    { enabled: true, minutes: 3 },
```

**At this church the buses park in front of it, so `churchBase` carries the
`busBase` figures and is already correct.** It stays a setting of its own
because the next church to use this may keep its buses somewhere else, and a
run that closes itself at the depot instead of at the door is worse than one
that never closes. Leave it out and `busBase` is used.

If it is ever pointed at a different place, measure it standing at the door and
not off a map. The bus base was 103 metres out when it was taken off a postcode
centre, and at this fence size that is the difference between a run that closes
itself and one that never does.

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
| `Rota` | who drives, which route, which bus, per Sunday. **Status** is also where a route is marked not running |
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

If he moves on without marking a booked stop, the app **asks him about it** —
the earliest one behind him, once, with the same two buttons the row carries.
The earliest rather than the nearest, because the person still standing there
has been standing the longest. **Not now** silences that stop for the rest of
the run and leaves it amber in the list. While the question is up, that stop's
own row buttons are suppressed: one stop, one place to answer it.

**After.** He ends the trip — or it ends itself. See below. Bookings for next
Sunday open. Everything drains onto the spreadsheet.

### When a bus cannot go

Two buses, one per route. When one of them cannot go, that route stops and the
other runs as normal. Set the Rota's **Status** column for that Sunday:

| Status | Means |
|---|---|
| `North cancelled` | North is off, South runs |
| `South cancelled` | South is off, North runs |
| `Cancelled/declined` | neither route runs |

Within five minutes of setting it:

- everybody who booked that route gets **one** alert saying the bus is not
  running, tagged per route per Sunday so changing your mind and changing it
  back does not buzz the same pocket twice
- their live panel says so, with a call button, instead of showing a bus that
  never starts
- no further seats can be booked on it. **Withdrawing stays open**, for the
  same reason it stays open after the cutoff: somebody taking their name off a
  list is worth hearing at any hour
- the rostered driver is told, and it outranks the stopped-bus message, because
  a morning can be called off for reasons that have nothing to do with a defect

The match is on the **whole** status string, in lower case. A substring test
would make `South cancelled` true for a route called `South West` the day one
is added.

**The two new options need the dropdown refreshed** before the Rota will offer
them: Minibus → Rota and setup → **Refresh dropdowns from Drivers tab**.

### Ending itself

Once the bus has been back inside the church geofence for three unbroken
minutes, the run closes on its own, a notification says it has, and the app
offers to reopen it for half an hour afterwards.

It is not a prompt, on purpose. The whole reason End trip gets missed is that
he has parked and walked inside, and a man who is not looking at his phone will
not answer a prompt either.

Three things make it safe:

- **It must have left first.** The bus starts inside the fence, in the yard, so
  without that a run would close about thirty seconds after Start trip.
- **A vague fix has no opinion.** A reading with more uncertainty than the fence
  is worth counts as neither in nor out. It neither starts the clock nor breaks
  it, so a red light two streets away cannot end a run and a bad fix in the car
  park cannot reset a timer that was nearly up.
- **It needs the app open** on the dashboard, which is what `keepAwake` is for.
  A phone face down in a pocket gives no positions, and the run falls back to
  the End trip reminder.

Auto-ends land on the record as `Logged (auto)`. A week of them is how you find
out whether the fence is in the right place.

### Alerts

Passengers who have booked can turn on notifications from the live panel.

**There are three things that send a passenger a push, and no more.** This
matters, because an earlier version of this file listed the four *wordings*
below as though each were its own event, and they are not.

| Sent when | Who |
|---|---|
| the Rota marks that route not running | everybody booked on it |
| the driver taps **Start trip** | everybody booked on that route, once each |
| the driver marks a stop | the next stop down the line with anybody at it, plus any earlier stop he went past unmarked |

The **words** are worked out when the phone is looked at, not when the push was
sent, so one buzz can read as any of these depending on what is true at that
moment:

- the bus is not running today
- the bus has left church, with their own timetabled time
- about *n* minutes to their stop, and where the bus actually is
- the bus is coming to your stop, when they are a minute or less away
- the bus has gone past and nothing was recorded at their stop

Nothing watches the clock on a passenger's behalf. "The bus is coming to your
stop" is not a push that fires when it becomes true; it is how whichever push
happens to land at that moment is worded.

**The first booked stop on a route gets one push and the rest get two.** The
approach push wakes the stop *after* the one just marked, and the first stop
has nothing before it. Its passengers get the departure push, which is an
estimate to their own kerb at the moment the bus starts moving toward them, and
nothing after that. This is deliberate and may be wrong. If somebody at a first
stop is ever left standing, the fix is a timed sweep serving every stop rather
than a patch for that one.

Drivers get five, and **only ever one at a time**:

| | When |
|---|---|
| **Your route is not running today** | the Rota's Status says so. Above the stopped bus, because a morning can be called off for reasons that have nothing to do with a defect, and a driver who turns up to a cancelled run has wasted it for nothing |
| **Your bus was stopped by the check** | a walkaround stopped the bus the rota puts on his route, and he has not set off. It tells him to ring the coordinator, which is what every other stopped-bus message in the app says. The app does not choose a replacement vehicle |
| **The bus has not gone out** | ten minutes past **the departure time on the Bus Stops tab**, with nothing started. Twice, then it stops. Not the 09:30 booking cutoff: a route with no Depart row gets no nudge at all rather than a guess |
| **End the trip** | a run past its arrival time that has gone quiet. Twice, a quarter of an hour apart |
| **You are driving today** | Sunday between 07:30 and 08:30, when nothing else is wrong |

The order in that table is the priority, and it is the design. One decision per
route per sweep, taken by how much it costs him to not know.

That matters more than it looks. The push carries no payload, so the phone asks
the Worker what it means when it lands. Three separate sweeps would fire two
pushes in one pass on a Sunday with a stopped bus, and **both** would resolve to
whichever had run last: he would be told twice that he was driving today, and
the thing he actually needed would go out over the wire and arrive as nothing.
So the sweep picks one, and the words are worked out from the record when the
phone asks rather than from the tag. A push that sat in a tunnel for ten
minutes says what is true when he reads it.

**On an iPhone, alerts only work once the page is on the Home Screen.** Safari
in a tab gets nothing, silently. The install sheet says so, to iPhones only.
Android works from a plain tab. So do not retire the group message.

Two things worth knowing about how it is built. The push itself **carries no
payload** — the phone is woken, and its service worker asks the Worker what
that means, so the message is built when it is read rather than when it was
queued, and there is no payload encryption to get subtly wrong. And the signing
keys are **made by the Worker on first use** and kept in its own database:
nothing to generate, paste or lose.

**A rehearsal wakes nobody.** The Worker skips every passenger alert while one
is running, the cancellation sweep included, and the driver's nudges are held
back by the clock, since a weekday evening is never past Sunday's departure or
arrival time. Both are correct, and
between them they used to leave one question permanently unanswered: whether
Google and Apple accept what the Worker signs. A malformed token looked
exactly like a quiet Sunday.

### Testing an alert

Once alerts are on, both apps offer a test. **Send me a test** sits on the
driver's hub where the Turn on offer was; **Check my alerts are working** sits
on the passenger panel, and only for somebody booked this Sunday. It pushes to that one phone and to nobody else.

- A notification saying **Alerts are working** means the whole chain is good:
  the signing, the push service, the wake, and the service worker asking the
  Worker what it means.
- A refusal is shown on the screen with the push service's own status. 401 is
  the token. 404 and 410 mean that phone is gone for good, so the row is
  deleted and the Turn on offer comes back.
- Nothing arriving, with no refusal on screen, means the push service took it
  and did not deliver. On an iPhone that is almost always a page in a tab
  instead of on the Home Screen.

It bypasses the Sunday dedup entirely, so it can be run as often as needed and
changes nothing a real run depends on. One at a time per phone, twenty seconds
apart.

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
| Passengers waiting for a bus that was called off | the Rota's Status for that Sunday. `North cancelled` or `South cancelled` tells them within five minutes |
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
There are exactly **two** hard refusals in the whole system, and everything
else warns and lets him through, because a block does not produce a check. It
produces a morning that went unrecorded.

1. **A bus stopped by a critical defect will not start a run.** The app
   recorded that vehicle as unfit; it is not then going to help somebody drive
   it.
2. **A route that already has a run open will not start a second one.** Not
   about the record, about the road: two buses cannot run one route at once.
   A second start would split the morning's taps across two runs and leave the
   passenger page flicking between them.

The second one is refused in **both** places, the app and the Worker. It has to
be. The app judges it off a board answer a few seconds old, so two thumbs
coming down inside that window would both be told yes.

A refused batch stays in the phone's queue and is not discarded. There is no
special handling beyond that, on purpose: with two buses and one per route,
two drivers cannot be on one route, so the refusal is a guard rather than
something anyone should expect to meet.

**If two runs ever are filed against one route on one Sunday**, the board
reports the one that started last and reads only that run's rows. Both stay on
the record. Folding them together was a real bug: the later run read as already
finished and carried the earlier one's stops.

### Covering a route

A driver who is not on the rota for a route, when nobody is out on it, is
offered **I am covering this run** — its own button, confirmed with a second
tap, behind his PIN. It is deliberately not the ordinary Start trip button:
folding cover into the normal gate would put a live Start trip in front of
every driver for every route, and the man rostered North would be one stray tap
from starting South in his own name.

The run lands on the record with the status **Cover**, and the next five
minute sync **writes that name into the Rota's *actual / cover* column by
itself**. A blank rota line counts as cover too.

It fills the cell **only when the cell is blank**, and that rule is the whole
of it. A name a person typed is a decision; an observation is not. If you wrote
Bro Moses and Bro Calvin actually drove, the useful fact is that the two
disagree, and an app that rewrote the column to match itself would destroy the
only evidence of it. So a filled cell is never touched, whoever filled it and
whoever drove. The Rota keeps saying one name, Trip Events keeps saying the
other, and a person decides which is right.

Nothing there creates a rota row either. A Sunday with no row is a Sunday
nobody planned, and inventing one from a bus that went out would put a
fabricated plan into the record.

The status column now carries more than one fact at a time, so a run that was
both unchecked and covered reads `Unchecked, Cover`. Apps Script reads that
column with a **contains** test from `Code.gs` v1.56.0 onward, so the order of
those words does not matter. It did on v1.55.0 and earlier, which used a prefix
test: anything in front of the word made an unchecked run stop counting as
unchecked, silently, in the one report that exists to count them. **If the Apps
Script side is ever rolled back past v1.56.0, `Unchecked` has to lead again.**
