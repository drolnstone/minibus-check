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
stop taps as they happen, and since v1.70.0 the walkaround itself and any
authorisation made in the app. All of them are drained back onto the
spreadsheet every five minutes, so the record still ends up in one place. A
walkaround is also sent straight to Apps Script without waiting, so the
coordinator's email is not held for the drain.

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
do/index.html           the page an email links to. No worker, no manifest,
                        no config.js: opened once from a message and closed
Code.gs                 everything on the Apps Script side
worker.js               everything on the Cloudflare side
schema.sql              the D1 tables, all of them
```

`schema-pin.sql` and `schema-push.sql` were one-off additions to a database
that already existed. `schema.sql` has carried both since, so they were
retired in v1.70.1.

They were never in the repository and there is nothing to delete there: the
repo rule is that only what a browser downloads goes in it, so `Code.gs`,
`worker.js` and `schema.sql` have never been published. v1.70.1's deploy
sheet said otherwise and was wrong.

The two service workers are deliberately separate and must never cache the
same file. One phone with both apps installed would otherwise hold two copies
of a page at two versions and serve whichever answered first.

---

## Versions — read this before deploying

There are **six** version stamps and four of them must move together.

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

**A number that has been handed over is spent.** Once a build has been given to
whoever deploys it, the next change bumps the number, even if the first one was
never put live. This was learned the hard way on 19 September 2026: v1.65.0 was
delivered, edited several times afterwards, and deployed somewhere in the
middle of that. Two different builds were wearing one stamp and the foot of the
app could not say which one was running. The stamp exists to answer exactly
that question, so it is worth more than a tidy sequence of numbers.

A corollary: **the three numbers do not have to move together.** v1.66.0 left
the Worker on w2.1.0 because nothing in it changed, which removed Cloudflare
from that deploy entirely. Only bump what moved.

### Reading all three at once

From v1.65.0 the foot of the driver app's first screen and the foot of the
passenger page both read:

    app v1.65.0 · server w2.1.0 · sheet v1.60.0

That is the page, the Cloudflare Worker and the Apps Script, on one line. On a
narrow phone it wraps between the three and never through the middle of a
number.

**A blank `sheet` slot means the sync has not run.** The Worker cannot see the
spreadsheet, so it is told: every *Send everything to the live server now*
carries the Apps Script's version, the Worker parks it in `settings` under
`sheet_version` and hands it back on every reply. A slot nobody has named
stays blank rather than guessing, so blank is a fact about the sync and not
about the version.

The Worker's copy can be up to five minutes behind a deploy, for the same
reason the PIN hashes can: it is cached in the isolate rather than read from
the database on every request.

*Minibus → Have a look → Is everything working?* reports the sheet's own
version and then asks the Worker for its, so the spreadsheet and the phones
can be checked against each other from either end. The app's own number
cannot be known from the spreadsheet and is not claimed there.

### Who has not got alerts on

The same report now **names the drivers with no live subscription**, in the
Drivers tab's Order column:

    Still to do:

      •  No alerts yet for: Bro Moses, Bro Adesina.
         Open the app on that phone and tap Turn on.

    Fine:

      ✓  Alerts on: 7 of 9 drivers, 14 passenger phones.

Every alert in this system depends on somebody having tapped **Turn on** on
that handset and let the phone ask. Until v1.65.0 there was no way to find out
who had, short of taking each phone and pressing the bell. Nine drivers
trained, three who never allowed notifications, and it looks identical to the
alerts being broken.

Both halves were already there: the `drivers` table is synced from the Drivers
tab, and `push_subs` is written when somebody taps Turn on.

**It asks the same question the waking asks.** `DRIVER_SUB_MATCH` in
`worker.js` is one SQL fragment used by both `wakeDrivers`, which sends the
alert, and `alertRoll`, which reports on it. For one afternoon the report had a
clever join of its own and the two disagreed on both the comparison and the
column: a handset registered as `bro asim` satisfied the report and was
invisible to the only query that would ever have woken it, so the report
certified the exact silence it was built to catch. It now loops one driver at a
time. Nine small indexed lookups off a menu nobody runs in a loop, and being
right by construction is worth more than the join.

Four things worth knowing about how it counts:

- **Names are matched lower-cased and trimmed.** Both ends are typed by hand:
  the Drivers tab, the Rota cell, and the name the app sends on Turn on. That
  same looseness now applies to the sweep that wakes a driver, which used to
  need an exact match against the **Rota** cell. A cover typed in by hand on a
  Saturday night could spell a name differently from the Drivers tab, and that
  driver was never woken, silently.
- **Retired drivers are not chased.** They stay on the tab for their history.
- **The count comes off the register, not off `push_subs`**, so *on* plus
  *not yet* is exactly the number of active drivers. Counted the other way, a
  retired driver's handset padded the total and the report read six out of
  five.
- **Three different nothings are kept apart.** An old Worker with no roll call
  says nothing, a Worker that tried and failed says so, and an empty missing
  list means it really asked about every driver. An empty list once meant all
  three, so a D1 outage read as "alerts are on for every driver".

### Why the overbooking email stops at the numbers

It used to end: *"Booked is not boarded. Some will not turn up, and some who
turn up did not book."* True, and the reason it was there is real: without it a
bus gets moved for four people who were never coming.

It went, from v1.65.0. It was a lecture sent to the one person who already
knew, on every single email, and a paragraph that is read past every time
trains somebody to read past the paragraph above it as well. The fact it stood
in for is already on the line that matters: the count says **booked**, never
travelling, and how many will not fit is given as a number.

Whoever inherits this should know it, which is why it is written here rather
than posted weekly.

A driver with no alerts is **not a fault**. He may have said no, and the group
message still reaches him. So the report has a third bucket, **Still to do**,
between *Needs attention* and *Fine*. Only *Needs attention* counts in the
dialog title, so this cannot open with "1 thing to look at" every week until
the last man taps Turn on.

Before v1.65.0 both apps printed one number called `script`, which meant the
Worker in the app and the Apps Script in the spreadsheet. `out.script` is
still sent by both servers so an old page shows something, but the pages now
read `out.server` and `out.sheet`.

---

## Deploying

Order matters, because the pages depend on the two servers being ready.

0. **A new database only:** paste `schema.sql` into the D1 console and run
   it. It builds every table and is safe to run twice. An existing database
   needs nothing: the one table and one column v1.70.0 added are created by
   the Worker itself the first time a check reaches it.
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

Run this on any evening before the Sunday it is meant for. Nothing in it
touches the real record.

It is longer than it was. Four releases went out together and this is the only
thing that exercises them, so the checklist grew with them rather than staying
comfortable — a ten minute check that says the app is fine without having
touched most of what is new is worse than no check at all. **A, B and C are
the ones that matter and take about fifteen minutes. D to F are worth doing
once after a deploy and can be skipped on an ordinary week.**

#### A. Before you touch a phone

1. **Check all three versions.** The foot of the driver app's first screen
   reads `app · server · sheet`. All three should be the ones you just
   deployed. If a number has not moved, that paste did not land and nothing
   below it is testing what you think it is. A blank `sheet` means *Send
   everything to the live server now* has not run.

2. **Minibus → Have a look → Is everything working?** Fix anything it names.
   It lists any active driver with no PIN, and names any driver with no alerts
   turned on.

3. **Minibus → Have a look → Is the live server working?** The rota and
   mileage copies should read a few minutes old. Past six hours, run **Rota
   and setup → Send everything to the live server now** and check again.

4. **Look at the tabs once.** Bus Stops ends with **Lat** and **Lng** and they
   are filled in — spot-check S04 Breck Rd against 53.424312, -2.953563.
   Checks ends with Advisory count, Advisories, Authorised by, Authorised on,
   and **Outcome is a dropdown**. Defects ends with **Kind**. Trip Events ends
   with **Ended by** then Live ID.

#### B. The walkaround

5. **Three buttons on every item.** Open a vehicle check. Every item offers
   **Fine**, **Advisory** and **Defect**. Mark one *non-critical* item
   Advisory, write a note, and send it. It should say "Sending" for a moment
   at most, then "On the record" — the check goes to the live server now, not
   to Apps Script, and the difference is seconds.

   On the sheet: the Defects tab has a row with Kind **Advisory**, and the
   email lists it separately from any defect. **The bus still runs.**

6. **Stop a bus, and let it out again.** *On a weekday, never on a Sunday.*
   Mark a **critical** item Defect, sign, send: "Bus stopped".

   Tap **Authorise to run**, key your PIN. The card reads "Authorised to run.
   By <you>. The defect stays open." Open Stops and bookings: the bus has its
   **Start trip** button back.

7. **The same thing from the sheet.** On that check's row, set **Outcome** to
   *STOPPED*. The toast says it was sent, and the app shows the bus stopped
   again within a minute. Set it back to *Authorised to run* and it comes
   back.

8. **An old row is refused.** Do a second walkaround on the same bus, then go
   back and change **Outcome** on the *first* one. The sheet should refuse it
   and say why: only the bus's latest check counts.

   Set the defect to **Not a defect** when you have finished with it.

#### C. The morning

9. **Minibus → Rehearse this Sunday.** Ask for **over**. It is the shape most
   likely to show up a problem, and step 16 needs a route that is over.

10. **Driver phone.** Open the app, sign in, key the PIN. It should open the
    gate with no perceptible wait and jump to the hub on its own. A wait of
    seconds means the Worker has no hash for that name — either the sync has
    not run or the two `PIN_SALT` values do not match. Go to Stops and
    bookings, then **Start trip**.

11. **Tap two stops**, one **Picked up** and one **Nobody there**.

12. **The estimate should lead.** Once a stop is marked, the times down the
    left of the stop list are the **estimate**, with the timetable time small
    underneath. On an *over* rehearsal they should be close together; ask for
    **quiet** instead and they should pull apart, because the bus is skipping
    empty stops. If there is only one number on each row, the board is not
    sending estimates — check the server version.

13. **Skip one deliberately.** Mark a stop further down the list without
    marking the booked one before it. The app should ask you about the one you
    passed, naming it, with three buttons. **Not now** should silence it and
    leave that row amber with its own buttons back.

14. **A second phone must not be able to end your run.** Sign in on another
    handset as a **different driver** and open the same route. There should be
    **no End trip button on it at all**. This is the 20 September fault and it
    is the one thing in this list worth doing every single time.

15. **The coordinator's way round it.** On that second phone, sign in as
    yourself. Under the route somebody else is out on, **End this run**
    appears. Key your PIN. The run closes, and on the Trip Events tab the end
    row has the **driver's** name in Driver and **yours** in Ended by. Two
    different names is the fact worth having.

    If you would rather not close it yet, end the run from the driver's own
    phone instead and check Ended by carries *his* name.

16. **Minibus → Have a look → Are we over on seats?** One email should arrive,
    carrying the line that says these are test bookings.

17. **Minibus → Stop rehearsing.** The test bookings are swept. It also
    switches itself off after two hours if you forget.

#### D. What a passenger sees

18. **Open the passenger link** on a second phone while the rehearsal run is
    going. The clock should tick and the panel should move down the list
    within about five seconds of each tap.

19. **The date line carries one Updated stamp.** At the top, beside the date.
    There should be **no** Updated line under the bus panel — it moved in
    v1.72.0, because it is a fact about the whole page and not about the bus.

20. **Be at your stop, in red.** Book that phone onto a stop, then mark the
    stop *before* it on the driver phone. The panel should turn red and read
    **Be at your stop**. It is the one red thing on that page and it should
    look like it.

#### E. Deciding from an email

21. **The page loads at all.** Open
    `https://drolnstone.github.io/minibus-check/do/` with nothing after it. It
    should say the link is not complete. That is the whole of what step 5 of
    the deploy can get wrong.

22. **A stopped bus, from the email.** Do step 6 again but do not touch the
    app. The **BUS STOPPED** email has a button.

    **Open it twice and close it without keying anything.** Then look at the
    driver app: the bus is **still stopped**. That is the property the whole
    design rests on — your mail provider opens links before you do, and if
    opening one decided anything it would have decided this.

    Now key your PIN. The page says authorised; Stops and bookings has its
    Start trip button back within seconds. Open the link a third time: it says
    you already decided it.

23. **A rota request, from the email.** Ask for a swap from a driver's phone.
    The email arrives with two buttons. Approve it, then watch the Rota
    Requests tab: within five minutes the Status reads **Approved**, the cell
    carries a note saying it came from the email link and who decided it, and
    the **Rota has moved** — both Sundays, if it was a swap.

#### F. Cover, and a cancelled route

24. **Cover.** Sign in as somebody not on the rota for that route and open
    Stops and bookings. **I am covering this run** should appear, take two
    taps, and then behave like an ordinary start. Sign in as a third name
    while that run is open and you should be refused by name. A rehearsal run
    is tagged `Rehearsal`, not `Cover`, so it writes nothing into the Rota —
    only a real run does that.

25. **A cancelled route.** Set the Rota's Status to *North cancelled*, wait
    for the next sync, and open the passenger link on a phone with a booking
    on North. The panel should say the bus is not running and the stops should
    go grey. Put the Status back to *Confirmed* when done.

#### G. Alerts, and what a rehearsal cannot test

26. **Alerts, separately and deliberately.** **A rehearsal sends no push at
    all**, and the driver's nudges are held back by the clock, so nothing
    above tests the push chain. Turn alerts on, then tap the **bell icon** in
    the top right of the frozen pane on either app. A notification should
    arrive within a few seconds saying *Alerts are working*. If the push
    service refuses, the reason appears on screen. Do this on every phone that
    matters, and on an iPhone only after the app is on the Home Screen.

**Four things a rehearsal cannot test at all.**

- **The alerts themselves**, which is step 26 and why it is there.
- **The run closing itself.** It needs the bus to physically leave the church
  geofence and come back — a Thursday evening in the car park will never
  produce one. Watch the first real Sunday for a `Logged (auto)` row.
- **The passenger messages on the morning**, for the same reason as the
  alerts. Step 20 shows the *wording* on the page; only a real Sunday shows
  the buzzing, and the first one is where you find out whether
  `resendMinutes` is right.
- **The booking nudges**, which only fire in their windows: Sunday between
  three and four, Wednesday and Saturday between six and seven.

### Deciding from the email

From v1.73.0 two messages carry a link to a page where the decision can be
made: **a bus stopped by a critical defect**, and **a driver asking to swap or
be covered**. Both were decisions the coordinator could already make, and both
were costing him a laptop.

**It is never a one-click link, and that is the whole shape of it.** A link
that *acts* when it is opened is acted on by whatever opens it, and plenty of
things open a link before a person does: the mail provider scanning for
malware, the phone warming up a preview, a corporate gateway rewriting the URL
and fetching it to see where it goes. Any of those would authorise a bus with
a fault on it while the email was still unread. That is not a theoretical
risk; it is the ordinary behaviour of modern mail.

So the link opens a page. The page says what the decision is, and asks for the
coordinator's own PIN — checked on the live server, with the same three tries
and the same five minute lockout as everything else that carries his name.
**Looking costs nothing and burns nothing.** Only the PIN acts.

**One use, and it expires.** An hour by default. A mailbox is a filing cabinet
people keep for years, and a link that still works in March is a way into the
record nobody is watching. A link reveals exactly what the email it came in
already said, and no more.

| | |
|---|---|
| Whose PIN | whoever `COORDINATOR_EMAIL` matches in the Drivers tab's Email column, falling back to the first active driver in an authorising role. Not a new setting on purpose |
| A stopped bus | authorised on the spot; the phones see it in seconds. The same act, writing the same record, as the button in the app |
| A rota request | recorded, then carried back on the drain. The spreadsheet writes the Status cell and calls its own edit handler, so a swap still moves both Sundays and there is no second implementation of what approving means |
| If the live server is down | the email still goes, without a link, saying "open the spreadsheet" — which is what every one of these messages said before |

The page has **no service worker, no manifest and no `config.js`**. A decision
served from a cache is a decision made against a stale picture of the morning,
so nothing caches it and the driver app's worker returns without responding for
`/do/`. If there is no signal the page does not load, and a page that does not
load is a much better answer here than one that loads and is wrong.

Turning it off is `LINK_RULES.on` in `Code.gs`. Every email goes back to
saying "open the spreadsheet" and nothing else changes.

### Telling the driver what was decided

A request is a question a driver asked. **From v1.70.0 of the script every
answer reaches him**, and until then two of the three shapes of answer reached
nobody.

| What you decide | Who is emailed |
|---|---|
| **Swap approved** | both drivers, from inside `applySwap` — so it works however the approval arrived |
| **Approved, cover named** | the man coming off and the man coming on, with the bus and a calendar file |
| **Approved, no cover yet** | the man who asked: *"approved — nobody has been assigned to cover it yet, you will get an email as soon as somebody is"* |
| **Turned down** | the man who asked, and **only** him |

**Why two of these used to reach nobody.** The notice hangs off an installed
edit trigger on the Rota Requests tab — and *Apps Script's own writes do not
fire installed edit triggers*. A decision arriving from the email link is
written by the script, so the rota came out right and nothing was sent. The
drain now calls both handlers by name, in that order, because the notice names
the bus and the route and both are read off the Rota row the first handler
writes.

Separately, the branch returned unless the word was `Approved`, so a refusal
was silent. And an approval made from the email link **never** names a cover —
that page has two buttons and no box to type one into, deliberately, because
choosing a replacement is a decision about the whole rota and belongs in front
of the rota. So every approval from a phone landed in the one case nothing was
written for.

**Two things it will not say.** It never tells the other driver in a *refused*
swap — he was never told it had been proposed, so the note would be the first
he heard of it. And it only says *"you are still down to drive"* when the Rota
actually still has his name: a request can be refused on a Sunday somebody else
has since picked up, and sending a man to a morning he is not on is worse than
sending him nothing.

**A reminder is not sent for a morning that is not his.** `dutyReminders`
read the name out of the Rota and never asked the **Status** column what had
happened to the Sunday — so a morning marked **Cancelled/declined** still
emailed its driver *"You are down to drive"*, a week out and again on the
Friday, with a calendar file that alarmed him on the Saturday. The passenger
side has always read that column; the one person who has to physically turn up
was the one nobody told. From v1.71.0 of the script:

| Status | Reminder |
|---|---|
| `Confirmed`, `Covered`, `Change requested` | sent, both routes |
| `Cancelled/declined` | neither route |
| `North cancelled` / `South cancelled` | that route only |
| `No driver assigned` | not sent |

The skipped ones are **listed by name** in *Is everything working?* — a
reminder deliberately not sent looks exactly like one that failed, and the
answer should be on the screen you'd check rather than reconstructed from the
Rota.

**Approving a cover does not clear his name, on purpose.** It sets the morning
to `No driver assigned` and leaves the requester in the scheduled column. That
name is how you know whose Sunday you are covering, and how you put it back if
the request is reversed; clearing it would destroy the record in order to
silence a reminder. Reading the status silences the reminder and keeps the
record.

**The duty *change* alert asks a narrower question** — only whether the route
was **called off**, never whether anybody is assigned. It runs inside the edit
being made, and `No driver assigned` is a state a row passes through for the
second between clearing one name and typing the next. Reading it there would
swallow the email telling the new driver he is on. The daily reminders run
against a sheet nobody is typing into, so they can safely ask the wider
question. There is a test either side of that line.

**Cancelled means the same thing in both places.** `routeCalledOff` in
`Code.gs` and `routeCancelled` in `worker.js` are compared by behaviour across
every value in `ROTA_STATUS`. If they drifted, a Sunday would be off for the
passengers and on for the driver, which is the worst of the three possible
answers.

**The seven-day horizon does not apply here, and that is deliberate.** A duty
*change* stays quiet about a Sunday more than a week out because nobody has
been told who is driving it yet — the ordinary reminder will carry the right
name. An *answer to a request* is something a driver is waiting for whether the
Sunday is next week or in ten. Two tests sit either side of that line.

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
| `PIN_SALT` | salts the PIN hash before it is pushed. **Must match the Worker variable of the same name** |

**Cloudflare → Worker → Settings → Variables**

| Key | What it is |
|---|---|
| `TOKEN` | must match `token` in `config.js` |
| `PHONE_SALT` | salts the phone fingerprint. Changing it orphans every existing booking |
| `PIN_SALT` | salts the PIN hash. **Must match the Apps Script property of the same name** |

Both have fallbacks in `worker.js` so a fresh deploy works before they are set.
Set them.

---

## The spreadsheet

| Tab | Holds |
|---|---|
| `Rota` | who drives, which route, which bus, per Sunday. **Status** is also where a route is marked not running |
| `Drivers` | the register — name, role, route, order, active, **PIN** |
| `Buses` | registration, seats, active |
| `Bus Stops` | route, stop, time, postcode, and from v1.71.0 **Lat** and **Lng** — the kerb itself, used for the driver's map link and for working out what passing a stop saves. *Set up / refresh rota* fills any blank one it recognises from `STOP_PINS` in `Code.gs` and never overwrites one you have typed. A stop it does not recognise stays blank, which everything downstream already handles |
| `Checks` | every safety check. **Outcome** is a dropdown, and picking **Authorised to run** on today's row lets a stopped bus out |
| `Defects` | one row per defect and one per advisory, told apart by **Kind**, so they can be chased |
| `Bus Bookings` | passenger bookings |
| `Trip Events` | every stop tap. **Ended by** is filled on the end row only, and differs from **Driver** when a coordinator closed somebody else's run |
| `Rota Requests` | swaps and cover asked for by drivers. **Status** is what approving means; a decision made from an email link writes that same cell and leaves a note saying who decided it and when |

The Worker's own database holds the same stops, rota, buses and drivers (a
copy, pushed from here), the bookings and taps as they happen, the shelf, and
`push_subs` — one row per phone that has asked to be told things.

**Give every active driver a PIN.** The PIN is what puts a name on a record. A
driver without one is waved through every gate in the app, and because a
sign-in now survives a page reload, that matters on a handset somebody else
picks up later. **Is everything working?** names anyone missing one.

### Scheduled jobs

Seven, all installed by **Check scheduled emails, set up any missing**:

| When | What |
|---|---|
| every 5 min | sync with the live server |
| nightly, 3am | rota tidy-up, archive, push to the live server |
| daily | duty reminders, 7 days and 2 days ahead |
| Sunday 10:45 | tells you if a bus went out unchecked |
| Sunday evening | the weekly summary |
| on edit | alerts when a Sunday changes |
| on edit | the Outcome column on the Checks tab reaches the drivers' phones |

---

## How a Sunday runs

**Before.** The rota fills itself weeks ahead. Duty reminders go out a week
before and again two days before, each naming the route and the bus, with a
calendar file attached. **From v1.73.0 that entry is timed to the real
departure** rather than being all-day, and its alarm is twenty-four hours.
An all-day event has no hour in it to count back from — a phone counts from
the start of the day — so the alarm landed at midnight going into Saturday,
which is no use to anybody. Timed at 09:52 it lands on **Saturday morning**,
at the hour he would be leaving, with a whole waking day in front of him to
ring somebody if he cannot make it. A route with no Depart row on the Bus
Stops tab keeps the all-day entry, because a departure nobody has written down
is not a time to put in somebody's calendar.

That is four warnings on four separate days — a week out, two days out,
Saturday morning, and the **You are driving today** push on Sunday between
half seven and half eight — and none of them within two hours of another.
Two days rather than one is why: the Saturday email used to land about two
hours before the alarm, and two notices about the same duty that close
together is one of them being ignored.

Passengers book through the link. If more people book than the bus holds, you
get an email while there is still time to do something.

**Morning.** The driver signs in, keys his PIN, walks round the bus. Every item
takes one of three answers: **Fine**, **Advisory** (worth watching, does not
stop the bus) or **Defect**. A critical defect stops the bus and nothing will
start a run on it until a coordinator authorises it. He picks his bus,
starts the trip, and taps each stop as he pulls away. Every tap reaches the
passenger page in about five seconds.

If he moves on without marking a booked stop, the app **asks him about it** —
the earliest one behind him, once, with the same two buttons the row carries.
The earliest rather than the nearest, because the person still standing there
has been standing the longest. **Not now** silences that stop for the rest of
the run and leaves it amber in the list. While the question is up, that stop's
own row buttons are suppressed: one stop, one place to answer it.

**The passenger page** carries one stamp for the whole page, beside the date,
from v1.72.0. It used to sit under the live panel, which made it read as a fact
about the bus; it is a fact about everything on the page, the stop list and the
counts included.

**After.** He ends the trip — or it ends itself. See below. Bookings for next
Sunday open. Everything drains onto the spreadsheet.

### The estimate

From v1.71.0 a passenger's estimate is worked out over **the stops the bus is
actually going to make**, not over the whole timetable. Before that it was his
own timetabled time plus however many minutes the bus was running behind,
which charges it for every empty stop on the tab: on a morning where four of
the seven North stops have nobody booked, the bus reached London Road several
minutes before the estimate said and whoever trusted it was still walking.

The driver's stop list shows the same number, in front of the timetable time,
while a run is out. It comes off the live server rather than being worked out
on the phone, so the driver's screen and the passenger's alert cannot give two
answers about one bus.

**The direction of the error is the design.** Too late means the bus came and
went while somebody was still walking, and the next one is next week. Too
early means a wait at a stop they were standing at anyway. Those costs are not
equal, so where the arithmetic is unsure it leans towards predicting the bus
early — and anything added to it should too. `eta` in `config.js` and
`ETA_RULES` in `Code.gs` hold the four settings and **must be kept equal**.

`Lat` and `Lng` on the Bus Stops tab make it better and are not required by
it. With no coordinates the time the bus would have spent standing still comes
off, which already beats the timetable. `analysis/` has the model, the two
things it got wrong first, and a script that fits the numbers to a real
Sunday.

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

**Five things send a passenger a push, and no more.** This matters, because an
earlier version of this file listed four *wordings* as though each were its own
event, and they are not.

| Sent when | Who |
|---|---|
| the Rota marks that route not running | everybody booked on it |
| Sunday morning, 07:30-08:30 | everybody booked, at the same time the drivers are told. *From v1.72.0* |
| the driver taps **Start trip** | everybody booked on that route, once each |
| the driver marks a stop | **every booked stop still in front of it**, plus any earlier stop he went past unmarked. *From v1.72.0; before that, only the next one* |
| Sunday afternoon and midweek | anybody with no seat for the Sunday that is open. *From v1.72.0* |

The **words** are worked out when the phone is looked at, not when the push was
sent, so one buzz can read as any of these depending on what is true at that
moment:

- the bus is not running today
- your bus comes at 10:34, be at your stop a few minutes early
- be at your stop in about 8 min
- be at your stop now
- the bus has gone past and nothing was recorded at your stop
- you are booked for Sunday, or: book your seat for Sunday, bookings close
  Sunday 09:30 — and on the Saturday, *last chance to book*

### Hearing at every stop, without being buzzed to death

From v1.72.0 a passenger hears at **every booked pickup before his own** rather
than only when the bus is one stop away. He can watch it coming down the line
instead of being tapped on the shoulder once and hoping.

The cost of that is volume, and the coordinates show where it lands. North has
eight pickups and South seven, so the last man on a full morning would be woken
seven or eight times — and those stops are not evenly spread. **S05, S06 and S07
sit inside 438 metres of each other, and N05 through N07 inside 556.** Three
buzzes in four minutes, all saying nearly the same thing, and the one that
mattered is the one he has stopped reading.

So a message that would say the same thing again is held back: if the estimate
for **his** stop has not moved by more than `resendMinutes` since the last thing
he was told, he is not told again. Two always send whatever the threshold says —
**the stop immediately before his**, which is his cue to start walking, and **his
own**. Those two carry an instruction rather than an update, and an instruction
is never redundant.

The stops the bus went **past** without marking are not subject to any of this.
Somebody standing at a kerb the bus has driven by is not receiving an update; he
is receiving the only message that will ever reach him.

### The bold line

The title is the only part of a notification that is certainly read: it is what
shows on a locked screen, in a banner that lasts three seconds, and in the list
of things that arrived while somebody was in a service. So from v1.72.0 **the
title carries the instruction and the body carries the facts.**

"About 8 min to Breck Rd" is a fact, and a fact is something to think about.
"Be at your stop in about 8 min" is a thing to do. The old wording survives in
the body, where it belongs, and the stop name goes with it — a passenger knows
which stop is his, and the words telling him what to do should not be competing
with it for the first line.

On the page the same words appear, **in red, and this is the one place red is
spent on the passenger page.** Red in these apps means a defect or a bus off the
road, and this file argues against spending it on an offer to switch on
reminders. That argument holds; this is not it. This is the one moment where a
few seconds of not looking up costs somebody the bus, and it is on screen for
about ninety seconds a week.

### Asking people to book

Three nudges a week to anybody whose phone has asked to be told things and who
has no seat for the Sunday bookings are currently open for. **From v1.74.0**
these are the three moments a seat actually gets decided:

| When | Why that moment |
|---|---|
| **Sunday, 3–4pm** | the run is over and next Sunday has just opened, while the bus is still on his mind |
| **Wednesday, 6–7pm** | the middle of the week, for whoever has not got round to it |
| **Saturday, 6–7pm** | the last one that can do anything, and it says so |

**Every one of them says when bookings close.** "There is room on the bus.
Bookings close Sunday 09:30." The words are built from the cutoff the server
actually keeps, not typed beside it, so the phone cannot promise a deadline the
server does not hold.

**The Saturday one is a deadline, not a detail.** Inside the last day the title
changes to **Last chance to book for Sunday** and the body to "Bookings close at
09:30 tomorrow." That is worked out from the clock when the phone asks, never
from the tag — so a push that sat in a tunnel until eight on Sunday morning
arrives saying *today*, not *tomorrow*.

**It used to be two, and it was really one.** Sunday and Thursday, with
`oncePerWeek` true — and since the Sunday window runs first and tags the whole
week, the Thursday one only ever reached people who had subscribed in between.
`oncePerWeek` is now false, so each window he is still unbooked at reaches him:
a man who never books hears three times, and a man who books on Sunday night
hears once. Set it back to `true` and the first window he is caught by is the
only one he ever hears, whatever else is in the list.

**Nothing at night.** `quietFrom` and `quietTo` are whole hours nothing is sent
between. Booking reminders only — a bus that is coming is not a convenience and
is never held back. The test suite checks every window against those hours and
fails rather than shipping one that sits inside them.

**Adding or removing one is a line.** `windows` in `BOOKING_RULES` (Code.gs) and
`booking` (config.js), which must match. All three point at the Sunday the
**booking page itself** would accept, asked of the same cutoff, so a reminder
can never point at a Sunday nobody can book.

**No new scheduled job.** All of these ride the five minute sync that
already exists, the same way the driver nudges do, and each is a WINDOW rather
than a moment because this Worker has no clock of its own. The tag sees to it
that the first sweep inside a window is the only one that sends.

Drivers get five, and **only ever one at a time**:

| | When |
|---|---|
| **Your route is not running today** | the Rota's Status says so. Above the stopped bus, because a morning can be called off for reasons that have nothing to do with a defect, and a driver who turns up to a cancelled run has wasted it for nothing |
| **Your bus was stopped by the check** | a walkaround stopped the bus the rota puts on his route, and he has not set off. It tells him to ring the coordinator, which is what every other stopped-bus message in the app says. The app does not choose a replacement vehicle |
| **The bus has not gone out** | ten minutes past **the departure time on the Bus Stops tab**, with nothing started. Twice, then it stops. Not the 09:30 booking cutoff: a route with no Depart row gets no nudge at all rather than a guess |
| **End the trip** | a run past its arrival time that has gone quiet. Twice, a quarter of an hour apart |
| **You are driving today** | Sunday between 07:30 and 08:30, when nothing else is wrong |

*From v1.73.0 there is a sixth, sitting directly under the stopped bus because
it is the same subject and it is newer:* **"<reg> is authorised to run"**, when
the bus the rota puts on his route has been stopped and then let out again. He
was told not to drive and told to ring the coordinator; until this existed, the
answer came back only if he thought to open Stops and bookings again. Tagged by
the CHECK rather than by the day, so a second walkaround that stops the bus and
is authorised again is a second thing worth telling him.

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

Once alerts are on, both apps show a **bell icon in the top right of the frozen
pane**. Tapping it sends a test to that one phone and a toast says what came
back. No label, no explanation.

The icon is inline SVG drawn on `currentColor`, so it takes whichever of the
five themes is set without a rule per theme. It carries an `aria-label` and a
`title`, so colour is never the only signal.

On the driver app it sits in the hub header, above the three buttons and
nowhere near the check flow. The walkaround is the statutory act of this app
and a thumb reaching for **Vehicle check** has to find Vehicle check.

Shown to a passenger only when they are booked this Sunday and alerts are
already on, and to a driver only when signed in with reminders on. It pushes to
that one phone and to nobody else.

### Asking people to turn alerts on

Until v1.65.0 the offer was a grey line: *Remind me to end the trip. Turn on*
in the driver app, *Tell me when the bus is near* on the passenger page. Almost
nobody read either, so almost nobody had alerts on and the whole push pipeline
served four phones.

From v1.65.0 it is **asked**: one question on a sheet over a dimmed screen,
with **Not now** and **Turn on**. It comes up once each time the app is opened,
until they turn alerts on or the phone refuses. Not now costs them nothing
until the next launch.

**It never covers the vehicle check.** In the driver app it is drawn on the hub
and nowhere else, never while a check is open, never on top of another sheet,
and it closes on either button, on the backdrop and on Escape. `anySheetUp()`
lists every sheet the app can put up, and a contract test asserts that list
against the markup, so adding a sheet later without adding it to that list
fails the suite rather than producing two backdrops on a Sunday morning.

On the passenger page it is shown only to somebody who has actually booked a
seat for the coming Sunday. A page open on a stranger's phone is asked for
nothing. It also waits half a second and re-tests, because the install sheet
opens on a timer of its own.

**On an iPhone in a tab it asks the other question**, because that phone cannot
be given an alert at all until the app is on the Home Screen. The button opens
the steps instead.

**Not red.** Red in these apps means a defect or a bus off the road, and
spending it on an offer to switch on reminders would cost it where it is
needed. The sheet stops the eye by standing in front of the screen.

**To turn it off:** `alertPopup` in `config.js` for the driver app, and
`ALERT_POPUP` near the top of `sunday/index.html` for the passenger page. Set
either false and that app goes back to the line. The line is still there in
both apps either way: it is the way back for anybody who tapped Not now.

The passenger page keeps its own copy of the setting because **it loads no
`config.js`**. It is opened from a WhatsApp link by members and has no business
downloading the driver register to do it. Keep the two in step.

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

## Tests

Kept beside the releases, not in this repository: `tests/`. They check the
code as it ships, not a copy of it.

    node tests/run-tests.mjs                  everything
    node tests/run-tests.mjs authorise trip   only matching suites
    MINIBUS_ROOT=/path/to/project node tests/run-tests.mjs

The runner reads the project fresh on every run — `worker.js` is copied and
given a generated export block so its internals can be asked direct
questions, and `Code.gs` is loaded into a sandbox with the Apps Script
services faked, which is not an approximation of how Apps Script works but a
description of it. It checks that every file parses, runs every suite, and
ends in one word: READY or NOT READY. Run it before handing a build over.

The Worker's suites run against a **real SQLite database** through a shim of
the D1 client, because half the faults worth catching here are SQL — a column
that is a keyword, an `ON CONFLICT` that does not fire, a unique index that
lets a second row through — and none of them show up against a mock.

Three of the suites are about the code rather than the behaviour: the six
version stamps and the paired settings agree, every element the pages look up
exists, and every function and constant is used in code rather than only in a
comment. The last is there because an unused function keeps its comment, and
the comment keeps describing a feature that is no longer there. It found three
on its first run.

`tests/screens/` holds harnesses that photograph the pages at phone width in
every theme. They are for a person to look at, and are not part of the run.

---

## Two things to know before changing anything

### The PIN

Keyed once, at the point of writing, and good for the rest of the morning.

**Answered by the Worker**, in well under a tenth of a second. It used to be
Apps Script, which takes two to eight, at the one moment a man is standing
beside a bus with people waiting to get on it.

The four digits never leave the spreadsheet. Apps Script computes a **salted
one way hash** and posts only that to the Worker's `drivers` table on every
sync. The Worker compares hashes.

| Where | What |
|---|---|
| Apps Script → Script Properties | `PIN_SALT` |
| Cloudflare → Worker → Variables | `PIN_SALT`, the **same value** |

**If the two ever differ, every PIN is refused by the Worker.** The app falls
back to Apps Script so nobody is locked out, but it is slow again and nothing
on screen says why. That is the first thing to check if PINs go slow.

It falls back on anything the Worker cannot answer: a name it has not been told
about, a sync that has not run, a refusal, a timeout, no signal. Worst case is
the behaviour that shipped before it.

**Three tries, then five minutes.** That lockout lives in the Worker now and
had to move with the check. Verifying in one place while counting in the other
gives six tries wearing the label of three.

There is also a per-handset cache: a hash of `driver:pin` kept on the phone,
which short-circuits a repeat. It is a nicety now rather than the thing holding
the experience up, which is the right place for it.

**One PIN call still goes to Apps Script on purpose.** When a driver gets in on
that cached hash, a quiet re-check runs behind him to catch a PIN you have
since changed. That is a question about authority, and the spreadsheet is the
authority: the Worker's copy is a hash pushed on a five minute sync, so asking
it would hand back a gate you had already taken away. Nobody is waiting on that
call, so slow is the right answer for it.

**The PIN confirms your name on a record. It does not protect information.**
Reading the rota and the stop list writes nothing and stays open to anybody who
opens the app — a steward at the door, a coordinator on a borrowed phone, a
driver who is not out today. Anything that files a record under a name asks
first. Every gate in the app follows that rule; keep it.

**What an app can do at the kerb is write down what happened, not prevent it.**
There are exactly **two** hard refusals in the whole system, and everything
else warns and lets him through, because a block does not produce a check. It
produces a morning that went unrecorded.

1. **A bus stopped by a critical defect will not start a run** until a
   coordinator authorises it. The app recorded that vehicle as unfit; it is
   not then going to help somebody drive it on its own say so.

   There are two ways to authorise, and both write the same record: in the
   app, behind the coordinator's own PIN, checked by the live server under the
   usual three-try lockout; or by picking **Authorised to run** in the Outcome
   column on the Checks tab. **Authorising never closes the defect.** It stays
   Open on the Defects tab with a name against the decision to run.

   Who may authorise is `AUTHORISER_ROLES` in Code.gs, kept equal to
   `fullInspectionRoles` in config.js. Whether the person who did the
   walkaround may also authorise it is `SAME_HAND_BOTH_WAYS` in Code.gs and
   `override.sameHandBothWays` in config.js: the app hides the button, the
   server refuses. When you are emailed is `TELL_COORDINATOR` in Code.gs.

   An authorisation names the check it lifts and lifts no other. A second
   walkaround that stops the bus again is not waved through by the first
   signature. Each check keeps the time a server first saw it, so the same
   check told again (the drain filing it, a phone retrying) cannot undo a
   signature, and an older check arriving late cannot overrule a newer one.
   An Outcome edit on an earlier row for the same bus is refused and the
   sheet says so; one the live server did not answer is sent again on the
   next five minute sync.
2. **A driver ends his own run and nobody else's.** From v1.71.0 the live
   server refuses an end from anyone but the run's own driver, and a phone no
   longer adopts a run it cannot show is its own.

   On 20 September a run was ended from another driver's phone. That phone was
   not misbehaving: it had taken the run off the board, because a phone with
   no run of its own used to take whatever the board reported — and once it
   held the run, every test that asked "is this yours" answered yes.

   The one deliberate way round it is a **coordinator, behind his own PIN**,
   with the same three tries and the same five minute lockout as authorising a
   stopped bus. The row lands under the driver's name and `Ended by` carries
   the coordinator's. Deliberately NOT a confirmation dialog in front of the
   ordinary button: "are you sure" in front of a destructive act belonging to
   another man is a speed bump, and the morning it matters is the morning
   somebody taps through it.

   A second end is ignored rather than written twice, so the arrival time on
   the record stays the one the driver tapped.
3. **A route that already has a run open will not start a second one.** Not
   about the record, about the road: two buses cannot run one route at once.
   A second start would split the morning's taps across two runs and leave the
   passenger page flicking between them.

The third one is refused in **both** places, the app and the Worker. It has to
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
