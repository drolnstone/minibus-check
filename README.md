# Minibus

The Sunday bus for RCCG Dominion Assembly, Liverpool. Four screens, one
spreadsheet, one small server.

- **Driver app** — the pre-drive safety check, the driving rota, and the live
  stop list a driver taps his way down on a Sunday morning.
- **Passenger page** — book a seat, then watch the bus come.
- **Coordinator's app** — from v1.77.0, the changes a coordinator used to
  open the spreadsheet for, made on a phone under his PIN. See *The
  coordinator's app*, below.
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
authorisation made in the app. From w2.16.0 each of those knocks on the
spreadsheet's door as it happens, and Apps Script drains it onto the tab in
seconds. The five minute drain is still underneath, so the record ends up in
one place whether or not a knock is answered. See *Both ways in seconds*,
below.

**The Worker also sends the alerts.** Apps Script cannot: it has no process
that is ever awake, and no way to sign a push. See *Alerts*, below.

**From w2.18.0 the Worker also takes every change made in the coordinator's
app first**, and the spreadsheet applies it a few seconds later through its
own code. The spreadsheet is still the record. See *The coordinator's app*.

**From w2.20.0 the Worker owns a rehearsal**: the flag, the test seats, the
rounds and the clearing up. The spreadsheet keeps a copy of the flag, told on
the drain, and takes the rehearsal's rows off its tabs when it ends. See
*Rehearsing*.

**The Worker also keeps a shelf** — a copy of the finished rota and last
week's mileage, built by Apps Script and posted over. It serves those back
instantly instead of making a phone wait five to ten seconds for Apps Script
to build them again. It refuses anything on the shelf older than six hours, and
a refusal makes the app ask Apps Script directly. Slow and right beats fast and
wrong.

### The people live on the Drivers tab, and nowhere else

From v1.80.0 (pages), w2.21.0 (Worker) and v1.85.0 (sheet), no file carries a
name or a phone number. The Drivers tab is the one place for them:

- **The coordinator** is an active row whose **Role** is one of the titles
  in the `COORDINATOR_ROLES` Script Property (by default `Coordinator` and
  `Minister in Charge`), and the number people are told to ring is in that row's **Phone**
  column. The one whose **Email** matches `COORDINATOR_EMAIL` wins, so the
  person the alerts go to is the person people ring. Otherwise the first
  person holding the first role in the list, then the second: here the
  Coordinator before the Minister in Charge. A church with other titles
  changes that one setting, spelled as in the Role column, and sends
  everything to the live server. From v1.81.0 the pages take the titles from
  the live server too; `fullInspectionRoles` in `config.js` is only what they
  use before it has answered.
- **The register** is the rows marked Active, with their roles.
- **The rota order** is the **Primary order** column, counted separately for
  North and South.

The sheet sends the coordinator with everything else on every push (a Drivers
tab edit pushes within seconds), the Worker keeps it in `settings` and stamps
it on every answer it gives, and each page takes it from whichever answer it
gets first and keeps it on the phone for when there is no signal. The register
and rota order already came with the rota and still do.

**Changing coordinator is two cells:** clear `Coordinator` from the old row's
Role and type it on the new one, and put the new number in Phone.

`config.js` keeps only addresses and switches. Its `drivers`,
`rotaPrimaryPattern` and `rotaSecondaryPattern` are empty, and `SEED_DRIVERS`
in `Code.gs` is empty, so a new church starts with nobody in it.

---

## The files

```
index.html              the driver app
sw.js                   its offline shell  — bump CACHE when index.html changes
config.js               vehicles (checklist details only), switches, endpoints
manifest.webmanifest
sunday/index.html       the passenger page
sunday/sw.js            its offline shell  — separate on purpose, see below
sunday/manifest.webmanifest
do/index.html           the page an email links to. No worker, no manifest,
                        no config.js: opened once from a message and closed
coord/index.html        the coordinator's app. Every screen is read from the
                        live server as it opens
coord/sw.js             its offline shell, from v1.96.4: the page opens with
                        no signal and says so. Never caches the live server
coord/manifest.webmanifest
Code.gs                 everything on the Apps Script side
server/worker.js        everything on the Cloudflare side
server/schema.sql       the D1 tables, all of them
tests/                  the checks, see Tests below. Not part of the apps
manual/                 builds the driver's manual PDF from a download of the
                        spreadsheet, see manual/README.md. Not part of the apps
video/                  builds the three passenger videos, see video/README.md.
                        Not part of the apps
```

`schema-pin.sql` and `schema-push.sql` were one-off additions to a database
that already existed. `schema.sql` has carried both since, so they were
retired in v1.70.1.

They were never in the repository, so there is nothing to delete there.

**Everything else in the list above is public.** The repository is public and
GitHub Pages serves it from its root, so `Code.gs`, `worker.js`,
`schema.sql`, `tests/`, `manual/` and `video/` can be read by anybody, on GitHub and at
the Pages address. So no secret ever goes in a file here: `PIN_SALT`,
`SHEET_TOKEN` and the rest live in Script Properties and Worker variables.
And a value committed once stays readable in the history after it is taken
out, so a secret that was ever in a file is changed, not just deleted. (This
file used to say that only what a browser downloads was in the repository.
That stopped being true on 29 September 2026, when the server code and the
tests were added.)

The two service workers are deliberately separate and must never cache the
same file. One phone with both apps installed would otherwise hold two copies
of a page at two versions and serve whichever answered first.

The home screen icons live in the repo root and are not in a release unless
one is new. Each app has the church logo on a field of its own:

```
icon-driver-180.png, icon-192.png,       the driver app, navy (#1E3260, its Navy theme)
  icon-512.png, icon-512-maskable.png
icon-sunday-180.png, icon-sunday-512.png the passenger page, green (#00923F)
alt-indigo-180.png, alt-indigo-512.png   the coordinator's app, indigo
                                         (#28166F), from v1.77.1
logo.png                                 the logo inside the driver app and
                                         the passenger page
```

Each 180 is the 512 scaled down, nothing more. A new icon gets a filename iOS
has never seen, because iOS reads a home screen icon once, when the page is
added, and never looks again.

---

## Versions — read this before deploying

There are **seven** version stamps and five of them must move together.

| Stamp | File |
|---|---|
| `APP_VERSION` | `index.html` |
| `CACHE` | `sw.js` |
| `PAGE_VERSION` and the `BUILD` comment | `sunday/index.html` |
| `CACHE` | `sunday/sw.js` |
| `PAGE_VERSION` and the `BUILD` comment | `coord/index.html` (from v1.77.0) |
| `SCRIPT_VERSION` | `Code.gs` (moves on its own) |
| `SCRIPT_VERSION` | `worker.js` (moves on its own) |

**If you change any page and do not bump all five page stamps, phones keep the
old copy** and it will look as though the deploy failed. The coordinator's page
has no service worker and cannot be kept old by one, but its number moves with
the others so that the three pages on the site always say which build they are.

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
number. The coordinator's app has the same line on its sign-in screen,
starting `coordinator`, and from v1.78.0 nowhere else.

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

      •  No alerts yet for: Bro Martin, Bro Alfred.
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
column: a handset registered as `bro arthur` satisfied the report and was
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

### The words: explain the bus, never the app

The two apps have followed this since they were written, without it ever being
stated. They explain **the bus** at length — what 1mm of tread looks like, why
a nut weeping rust matters, that a reversing camera is an aid and not a
substitute for looking. They never explain **themselves**.

| | |
|---|---|
| A confirmation | one word. *"Sent."* *"Booked."* *"Done."* *"Thank you."* |
| A next step | only when there is an urgent one. *"Sent. Now ring the coordinator."* |
| A wait | only when there is a wait. *"Sent. Give it a few seconds."* |
| A consequence | one clause. *"This request is sent in your name."* |
| An error | one short fact. *"It was not saved."* *"No signal right now."* |

The decision page and the emails drifted off it, because both were written
later and neither had the apps open beside them. By v1.78.0 they were
explaining link lifetimes, what approving does to a tab, where a decision
travels and how long it takes to get there, how a calendar attachment works,
and how often we send a particular alert. **v1.79.0 took all of it out.**

The test is what the sentence is *about*. "Nobody is covering it yet" is about
his Sunday and stays. "You will get an email as soon as somebody is" is about
our plumbing and goes. "Authorising does not close the defect" changes what he
does next and stays; "it stays open on the Defects tab, with your name against
the decision to run" is the same fact explained twice more and goes.

Two checks hold it now, in `02-elements.mjs`. One is a list of the twenty
sentences that were cut, each with the reason, failing if any comes back —
a regression test and nothing grander, since it catches these and not the next
ones. The other is the general net: no `class="tiny"` on the decision page may
run past sixty characters, because small print that runs past a line has
almost always stopped being a fact and started being a lesson.

### One pattern for the three apps

From v1.89.0. **The service** is *Dominion Assembly Transport*: the emails'
sender name (`SENDER_NAME`) and the logo block, *RCCG Dominion Assembly ·
Liverpool · Transport*. **Each app** has a short name under its icon, because
a phone shows about twelve characters there and a coordinator may have all
three: **Sunday Bus**, **Driver**, **Coordinator**.

**Each opens on the logo.** The passenger page always has. The driver app's
first screen and the coordinator's sign-in show the logo block with no dark
bar over it, and say what they are in the line above the question
(*Before the first pick up*, *Coordinator*).

**Signed in, the bar names the app over who is using it**: DRIVER / Bro X,
COORDINATOR / Bro Y, or the screen's name over who on the screens past the
first. The driver app's bar becomes the check's once a bus is chosen: the
number plate, **Vehicle check** or *12 of 20 checked* over the bus, the three
lights (pass, advisory, do not run) and the red **Do not run** strip. Before
v1.89.0 that strip stood empty over the driver app's first screen, with
"Fleet" in the plate.

The driver app reads its own name from the page's `apple-mobile-web-app-title`
and the church's from its footer, so a new church changes each once, in the
page. A phone that added the driver app before v1.89.0 keeps the label it was
given, *Dominion Transport*, until it is removed and added again.

### A stop is its number

From v1.90.0 (pages), w2.31.0 and v1.93.0. The coordinator keeps a fixed range
of stop numbers and edits the place behind a number as the passengers change,
so N05 can be one road this month and another the next. Everything is matched
by the number: bookings, taps, the Run record, the driver's list.

What that leaves open is **a seat taken before the edit**. It stays a seat at
N05, and the driver stops at whatever N05 is now, but the passenger booked the
old place. A booking and a tap keep the name their number had when they were
made, and a name that no longer matches today's for the same number is the
whole of the test (spacing and capitals are not a change). The name is only
ever compared, never matched on. The guards:

- **History** gets every change to a numbered row of the Bus Stops tab: the
  place, the time, Active, a number added or taken off. From an edit, a paste
  or a script, caught at the edit or at the five minute sync (`stopsAudit`).
- **The sheet says so at once** when an edit leaves seats booked for a coming
  Sunday at the old place, and History's line names them.
- **Is everything working?** lists each such seat under To do until it is
  dealt with (`stopsHealth`).
- **The coordinator's Bookings** marks it: *Booked when N05 was …*.

**The passenger is told nothing.** Rearranging the stops is the
coordinator's business, and the numbers behind them are not the passenger's.
A seat stops being flagged once it is booked again, or cancelled.

A number switched off or taken off the tab was already handled: the passenger
is told their stop has gone and the seat is not shown as booked.

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
1. **worker.js** → Cloudflare dashboard → Deploy. Once only, from w2.16.0:
   add a **Cron Trigger** to the Worker that runs every minute
   (`* * * * *`). It is the Worker's clock. Without it everything still
   works, on the five minute sync, as before.
2. **Code.gs** → Apps Script editor → Save → Deploy
3. Minibus menu → **Send everything to the live server now**
4. Minibus menu → **Is the live server working?** — it should report the rota
   and mileage copies as a few minutes old
5. **The pages** → GitHub, with the `coord/` folder from v1.77.0

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
the ones that matter and take about fifteen minutes. D to H are worth doing
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

9. **Start a rehearsal from the coordinator's app.** First screen,
   **Rehearsal**, **Start a rehearsal**, **More booked than seats**. It is the
   shape most likely to show up a problem, and step 16 needs a route that is
   over. The first screen then leads with *A rehearsal is running until …*,
   and within a minute the test seats are on the Bus Bookings tab, tagged
   `Rehearsal`. **Minibus → Rehearse this Sunday** on the sheet does the same
   from a computer.

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

17. **Start it over, then end it.** Coordinator's app, **Rehearsal**, **Start
    over**, **A quiet morning**. Within about five seconds the driver phone
    says the rehearsal was started again, drops its test run and offers
    **Start trip** again; the Rehearsal screen shows the new seats. Start a
    run and tap a stop if you want a second go. Then **End it**. The driver
    phone says the rehearsal has ended and goes back to the real Sunday, the
    passenger phone loads again, and within a minute the Trip Events and Bus
    Bookings tabs have no `Rehearsal` rows left. **Minibus → Stop rehearsing**
    does the same from the sheet. Left alone it ends itself after two hours,
    or at midnight if it reaches Sunday, with the same clearing up.

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
    The email arrives with two buttons and a drop-down of who could cover it.
    Approve it, then watch the Rota Requests tab: the Status reads
    **Approved** before you have finished switching windows, the cell carries
    a note saying it came from the email link and who decided it, the
    Replacement cell has the name you picked, and the **Rota has moved** —
    both Sundays, if it was a swap.

    The page tells you which route it took. *"It is on the Rota Requests tab
    now"* is the push; *"within five minutes"* is the tick underneath it. Both
    are correct; only one of them is a lie if it says the wrong one.

#### F. Cover, and a cancelled route

24. **Cover.** Sign in as somebody not on the rota for that route and open
    Stops and bookings. **I am covering this run** should appear, take two
    taps, and then behave like an ordinary start. Sign in as a third name
    while that run is open and you should be refused by name. A rehearsal run
    is tagged `Rehearsal`, not `Cover`, so it writes nothing into the Rota.
    Only a real run does that.

25. **A cancelled route.** *Only while a rehearsal is running, and put it
    back before the rehearsal ends.* Set the Rota's Status to *North
    cancelled*, wait for the next sync, and open the passenger link on a phone
    with a booking on North. The panel should say the bus is not running and
    the stops should go grey. Put the Status back to *Confirmed*.

    A rehearsal holds the message that a route is off. With none running, or
    the minute one ends with the Status still set, every passenger booked on
    North is told the bus is not running, and putting it back tells them
    nothing. While the Status is set during a rehearsal, the Saturday
    reminder of what was booked waits for everyone booked on North, and goes
    once the rehearsal is over if its hour is not.

#### G. Alerts, and what a rehearsal cannot test

26. **Alerts, separately and deliberately.** **A rehearsal sends no push
    about a bus**, and the driver's nudges are about the real run, so nothing
    above tests the push chain. The booking reminders still go during one, at
    their usual times, and say only what the phone has booked. Turn alerts on, then tap the **bell icon** in
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

#### H. The coordinator's app

These are real changes. Each step says how to put it back.

27. **The way in.** On the driver app, signed in as yourself with your PIN
    keyed, the hub has **Coordinator** on a line of its own. Tap it: this
    Sunday and next, and the menu, with no PIN asked. Signed in as a driver,
    the driver app has no Coordinator button.

    Then open the coordinator's app from its own home screen icon. It asks
    for the PIN, and choosing your name puts the cursor in the PIN box. The
    line under **Driver app** reads `coordinator · server · sheet` with the
    numbers you deployed. Tap it for the report, and pick a theme from the
    chips under it: the driver app changes with it.

28. **A stopped bus, from the first screen.** *On a weekday, like step 6.* Do
    step 6 again and leave the driver app alone. The coordinator's first screen
    says the bus was stopped at the walkaround, with **Authorise**. Tap it and
    confirm. Stops and bookings on the driver app has its Start trip button
    back. Set the defect to **Not a defect** afterwards, on the tab or in the
    app's Defects.

29. **A note, both ways.** Rota, a Sunday about a month ahead, **Add a note**.
    It shows at once. Within about ten seconds it is in that Sunday's Notes on
    the Rota tab, with your name and `(app)` in Updated by, and *What I have
    done* then says **On the sheet**. A note emails nobody. Delete it on the
    tab.

30. **A request, decided in the app.** On the driver app, signed in as
    yourself, ask for a change on a Sunday of yours. The coordinator's first
    screen says a rota request is waiting. **Rota requests**, **Turn down**.
    Within about ten seconds the Rota Requests tab says **Rejected**, with a
    note saying it was decided in the coordinator's app, and the email saying
    it was turned down comes to you, as the man who asked. Nothing to put
    back.

31. **A booking for somebody who rings.** **Bookings**, next Sunday, **Book a
    seat for someone**: any stop, 1 seat, your own number. It is on the
    driver's Stops and bookings at once, and on the Bus Bookings tab within a
    minute, noted as booked in the coordinator's app. **Cancel** it from the
    app, and the tab says Cancelled within a minute.

32. **Over on seats.** The next time you rehearse *over* (step 9), open **Have
    a look**, **Are we over on seats?** in the app while it runs. It names the
    route that is over, as step 16's email does, and the first screen says so
    too.

33. **Is everything working, from the app.** **Have a look**, **Is everything
    working?** It comes back within about 25 seconds with what step 2 finds
    on the menu. If it says the spreadsheet did not answer, the deployed
    Apps Script is not the new version.

34. **The lock.** Leave the app untouched for 15 minutes
    (`coordApp.idleMinutes`). It asks for the PIN again, and keying it goes
    back to the screen you were on.

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
| Whose PIN | **any active driver in an authorising role.** The email is addressed to one person; the link is not. It used to compare against whoever `COORDINATOR_EMAIL` matched, falling back to the first authoriser in the tab — so a coordinator keying his own correct PIN was told it did not match, with nothing on screen to say whose it wanted. One rule, in one place: the app lets any authoriser authorise, so this does too, and the record names whoever actually keyed a PIN |
| A stopped bus | authorised on the spot; the phones see it in seconds. The same act, writing the same record, as the button in the app |
| A rota request | recorded on the Worker, then **handed straight to the spreadsheet** — see *The way back*, below. The spreadsheet writes the Status cell and calls its own edit handlers, so a swap still moves both Sundays and there is no second implementation of what approving means |
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
written by the script, so the rota came out right and nothing was sent. Both
handlers are now called by name, in that order, because the notice names the
bus and the route and both are read off the Rota row the first handler
writes.

Separately, the branch returned unless the word was `Approved`, so a refusal
was silent.

### Both ways in seconds

From w2.16.0 and v1.80.0.

**Phone to sheet.** Every write a phone makes (a booking, a stop tap, a
walkaround, an authorisation, a run closed by a coordinator) is followed by a
knock: one POST from the Worker to the sheet's web app, `drainnow`, sent
after the phone has had its answer. Apps Script runs the ordinary drain. If a
drain is already running, the knock leaves a note and that drain goes round
once more. The clock knocks again within a minute while anything is still
waiting, and every five minutes if the sheet is not answering.

**What the drain marks done.** Each drain stamps the rows it hands out, and
the Worker marks a row done only if it still carries that stamp. A booking
cancelled while Apps Script was writing the Booked copy used to be marked
done on the strength of that copy and never reached the tab: Sedley Street,
27 September. New rows are now confirmed only after they are on the tab, and
the drain writes only its own columns, so a column the coordinator added
keeps its value.

**Sheet to phone.** `onEditLive` pushes the Rota, Drivers, Buses, Bus Stops,
Rota Requests and Defects tabs the moment one is edited. A Status or Seats
edit on a Bus Bookings row with a Live ID goes to the Worker's
`sheetbookings` action, which applies it and leaves the row pending so the
next drain writes the Worker's copy back. Only `Booked` and `Cancelled` are
acted on; any other word in the Status cell is left where it is. The
passenger page asks every fifteen seconds while bookings are open, down
from sixty.

**Alerts follow the number.** When a phone gives a number or books with one,
every alert subscription on that handset is moved to that number.

**Rota requests, from w2.17.0.** A driver's swap or cover request is taken by
the Worker (`rotaRequest`, the same body Apps Script takes), knocks, and is
filed on the Rota Requests tab by `handleRotaRequest`, the function a direct
post has always used. The app falls back to Apps Script if the Worker does not
answer; the id is made on the phone, so a request both saw is filed once. Until
the sheet has filed it and rebuilt the shelf, the Worker lays the request onto
its copy of the rota, so no phone shows the Sunday without it. After this,
every write a phone makes goes to the live server first. The one Apps Script
call left is the quiet PIN re-check, which is deliberate: the sheet is the
authority on a PIN.

A request no longer writes Change requested over a Sunday that has been called
off. It did, and since the passenger page reads that same Status cell, a
request on a North cancelled Sunday put the North route back on.

### The clock

A Cron Trigger on the Worker, every minute, calls `scheduled()`. It runs the
sweeps that used to ride the five minute drain, and looks for anything the
sheet has not got. The drain runs the sweeps itself only when the clock has
not ticked for three minutes, so a Worker without its trigger behaves as it
did before. **Is the live server working?** says whether the clock is
ticking and when the sheet was last knocked on.

### The way back

Everything else the Worker does is downstream of the spreadsheet: it is told
the timetable, the buses, the drivers and the rota, and it answers phones. It
had never called back. **From `w2.12.0` it can.** Until `w2.16.0` it did so
for exactly one thing, the rota decision below; since then it also knocks
after every phone write (see *Both ways in seconds*).

A rota decision is the one act on the Worker that only *means* something once
the spreadsheet has it. Approving a cover moves two Sundays, writes the Rota
and sends two emails — all of it on the other side. So the page said *"within
five minutes"*, which is not a statement about anybody's rota. It is a
statement about our plumbing: five minutes is how long the sheet takes to
**ask**.

```
  the sync        Code.gs  ->  sheetUrl  ->  Worker    (every five minutes)
  a decision      Worker   ->  POST      ->  doPost    (the moment a PIN lands)
  the backstop    Code.gs  ->  drain     ->  Worker    (every five minutes)
```

The address is **sent on every sync rather than set by hand**, because a web
app gets a new one every time it is deployed and a stale one would fail
silently for ever. A `/dev` address — what `getUrl()` answers when the script
is run from the editor — is refused rather than stored: nothing outside that
Google account can reach it, which is worse than having no address at all. A
sync that carries none leaves the one already held alone.

**Two ways in, one writer.** `applyRotaDecision` is the body of the drain's
per-decision loop, lifted out. The push calls it and the drain calls it, so a
decision cannot mean one thing at two seconds and another at five minutes.

**Nothing is marked done on a guess.** The Worker marks a decision `synced`
only when the spreadsheet has said it has it. Every other outcome — `ok:false`,
a 500, a page of Google's HTML because the script is over quota, a refused
connection, no answer at all inside eight seconds, no address known — leaves
the row exactly where the drain will find it. Sixteen of this feature's
seventeen checks are about those cases, because a shortcut that can lose a
decision is worse than no shortcut: the five minutes it saves are five minutes
nobody was counting, and the decision it drops is a driver turning up to a bus
that is not his.

**A second delivery changes nothing.** The first thing `applyRotaDecision`
does after finding the row is read the Status cell, and a request already
decided is left alone — by hand, by an earlier drain, or by a push whose
answer never came back. That guard is what makes it safe for the Worker to
push, hear nothing, and let the tick carry the same decision round again.

**And the claim is made under a lock**, because that guard cannot hold by
itself once there are two ways in. Reading the cell and writing it are two
calls with a gap in the middle, and a drain fetching inside the second or so
between `burnLink` and `synced=1` gets the same decision: both read `Pending`,
both write, both drivers are told twice. So the read and the two writes are
one indivisible act — and *only* those. The Rota and the emails happen after
the lock is released, by whichever call claimed the row; holding it across the
mail would block `handleCheck`, which waits on the same script-wide lock for a
driver standing at a bus. A call that cannot get the lock returns `false`,
which leaves the decision queued and makes the page read *"within five
minutes"*. **The shortcut may always decline; the backstop may not.**

**The page says which one happened.** `applied: true` and it reads *"It is on
the Rota Requests tab now"*; anything else and it reads *"within five
minutes"*. Unheard is not applied. Telling somebody it is done over a rota
that has not moved is how you get a phone call at nine on a Sunday morning.

**Only this.** A bus authorised from an email is not pushed: the phones read
it off the Worker within seconds and the Defects tab is a record, not
something anybody is standing over.

### Choosing the cover on the phone

An approval from the email link used to **never** name a cover — that page had
two buttons and no box to type one into, deliberately, because choosing a
replacement is a decision about the whole rota and belongs in front of the
rota. So every approval from a phone landed in the one case nothing was
written for.

That reasoning was half right. The decision belongs in front of *the rota*,
not in front of *a spreadsheet* — and the page can show the rota. It now
carries a drop-down of every active driver, each marked with whether he is
already driving that Sunday and when he last drove, so the choice is made
with the same two facts you would have looked up yourself.

The name is checked against the register on the way through. A page can send
anything; only somebody the Drivers tab knows as active may be written into a
Sunday, and a name that does not match is dropped rather than refused — the
decision itself is still good, and lands as *approved, cover to be arranged*,
which is exactly what it was before the page could offer one at all.

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

## Setting up for a new church

From v1.88.0 the code carries no church's buses, stops, kerbs, renewal dates
or bus pairing, and from v1.80.0 no people. A copy of this repository for
another church starts empty and is filled in on the spreadsheet. What is left
is below, in the order it is easiest to do.

**1. Your own copies.**
- [ ] Fork or copy this repository and turn on GitHub Pages from `main`.
- [ ] Make a new Google spreadsheet, open **Extensions, Apps Script**, and
      paste in `Code.gs`. **Deploy, New deployment, Web app**, run as you,
      access Anyone. Copy the `/exec` address.
- [ ] Make a Cloudflare Worker from `server/worker.js`, with a D1 database
      bound to it under the name `DB`. Paste `server/schema.sql` into the D1 console and run it.
      Add the every-minute Cron Trigger (see *Deploying*).

**2. Settings.** No secret goes in a file: the repository is public.
- [ ] Script Properties (see *Configuration*): `COORDINATOR_EMAIL`,
      `WORKER_URL`, `PIN_SALT`, `SHEET_TOKEN`, and if you want them
      `SENDER_NAME`, `COORDINATOR_ROLES`.
- [ ] Worker Variables and Secrets: `PIN_SALT` and `SHEET_TOKEN`, the same
      values as above; `TOKEN`; a `PHONE_SALT` of your own.

**3. The code's addresses and church details.**
- [ ] `config.js`: `endpoint` (the `/exec` address), `liveEndpoint` (the
      Worker), `token`, `busBase` and `churchBase` (measured standing there,
      not off a map), `fullInspectionRoles`, `rotaAnchor` and
      `rotaSecondaryAnchor` (the first Sunday of each route's driver pattern),
      and `VEHICLES`: one entry per bus, with its registration exactly as on
      the Buses tab, what it skips, and what to watch on it.
- [ ] `Code.gs`: `TOKEN` (the same as `token`), `BUS_PAGE_URL` (your
      `sunday/` page), `CHURCH_PIN`, `BUS_ADDRESS`, `PATTERN_ANCHOR` and
      `PATTERN_ANCHOR_SOUTH` (the same dates as the two anchors above), and
      `PHONE_SALT`, set once and never changed.
- [ ] The church's name: search the pages and the two `manifest.webmanifest`
      files, and `worker.js`, for this church's name and replace it; and
      `logo.png`.

**4. The spreadsheet.** Minibus, **Set up / refresh rota** builds every tab.
Then fill in:
- [ ] **Drivers**: everybody who drives or coordinates, with a PIN each. The
      coordinator's row, with a Phone, is who every page tells people to ring.
- [ ] **Buses**: one row per bus. Registration, passenger seats (not counting
      the driver), Active YES, the MOT, service, insurance and permit dates,
      and North or South in **Route in odd months** for the two that run.
- [ ] **Bus Stops**: each route's stops, times and postcodes. **Lat** and
      **Lng** are the kerb, for the driver's map link and the estimate; blank
      works, just less well.
- [ ] **Rota**: who drives when. Each route's drivers take turns in their
      **Primary order** on the Drivers tab, counted from the two anchor
      dates; Set up fills the coming Sundays and anything can be typed over.

**5. Go.** Minibus, **Send everything to the live server now**, then **Is the
live server working?** until it shows no ✗, then the rehearsal in *After the
deploy*.

## Configuration

**`config.js`** — the church details, the vehicle list, the checklist, the
switches, and two addresses. No people: see *The people live on the Drivers
tab*, above.

```js
endpoint:     "https://script.google.com/macros/s/.../exec"   // Apps Script
liveEndpoint: "https://minibus-api.asimbassey.workers.dev"    // the Worker
```

Two settings govern the run closing itself:

```js
churchBase: { lat: 53.424169, lng: -2.936799, radius: 165 },  // yards
autoEnd:    { enabled: true, minutes: 3 },
```

One governs the coordinator's app:

```js
coordApp: { idleMinutes: 15, refreshSeconds: 30 },
```

`idleMinutes` is how long the page keeps the PIN while nobody touches it.
`refreshSeconds` is how often an open screen asks the live server again.

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
| `SENDER_NAME` | optional. The name emails show as sent by, e.g. `Dominion Assembly Transport`. The address is still the Google account the script runs as; for a church address, keep the spreadsheet under a church Google account |
| `WEB_APP_URL` | optional. The sheet's own web app address, copied from **Deploy, Manage deployments**. Only needed when **Is everything working?** says the live server knocks on a different deployment from this one |
| `COORDINATOR_ROLES` | the titles in the Role column that make somebody a coordinator, separated by commas, the one people should ring first: `Coordinator, Minister in Charge`. Blank uses that default. After changing it, **Send everything to the live server now** |
| `WORKER_URL` | the Worker's address |
| `ARCHIVE_SHEET_ID` | optional. Set it to archive into a separate spreadsheet |
| `PIN_SALT` | salts the PIN hash before it is pushed. **Must match the Worker variable of the same name** |
| `SHEET_TOKEN` | the sheet's own password for talking to the live server, from v1.86.0. **Must match the Worker Secret of the same name.** `TOKEN` is in `config.js` for the phones, so it cannot guard what only the sheet and the live server say to each other: a sync, the drain, a decision, a report, a coordinator alert. This does. Until it is set on both sides nothing changes, and **Is the live server working?** says it is missing |

**Cloudflare → Worker → Settings → Variables**

| Key | What it is |
|---|---|
| `TOKEN` | must match `token` in `config.js` |
| `PHONE_SALT` | salts the phone fingerprint. Changing it orphans every existing booking |
| `PIN_SALT` | salts the PIN hash. **Must match the Apps Script property of the same name** |
| `SHEET_TOKEN` | a Secret. **Must match the Apps Script property of the same name**. See above |

`TOKEN` and `PHONE_SALT` have fallbacks in `worker.js`, so a fresh deploy works
before they are set. **`PIN_SALT` has none, on either side, from w2.21.1 and
v1.85.2**: this repository is public, and a salt printed in it protects
nothing. With it missing every PIN is refused, never waved through, and **Is
everything working?** names the side that is missing it.

---

## The spreadsheet

| Tab | Holds |
|---|---|
| `Rota` | who drives, which route, which bus, per Sunday. **Status** is also where a route is marked not running |
| `Drivers` | the register — name, role, route, order, active, **Phone** (whose last four digits are the default PIN; there is no PIN column from v1.96.0). The row with Role **Coordinator** is who every page tells people to ring, on its Phone |
| `Buses` | registration, seats, active, and from v1.87.0 **MOT due**, **Service due**, **Insurance due**, **Permit due** and **Route in odd months**. The dates are what the driver app warns about (30 days ahead, red once passed; blank is not tracked) and the only place they are kept: a renewal is a cell, not a code change. **Route in odd months** is North or South, the route that bus takes in January, March and so on; even months swap. A Sunday's Rota row naming a bus still wins for that Sunday. Without exactly one active North and one active South, the pairing written in the code is used rather than a guess. The columns were filled once, the first *Set up / refresh rota* after v1.87.0, and never again. From v1.92.0 the four date columns take a date and nothing else, and every change to one, from the app or typed here, is written on History with what it was |
| `Bus Stops` | route, stop, time, postcode, and from v1.71.0 **Lat** and **Lng** — the kerb itself, used for the driver's map link and for working out what passing a stop saves. *Set up / refresh rota* fills any blank one it recognises from `STOP_PINS` in `Code.gs` and never overwrites one you have typed. A stop it does not recognise stays blank, which everything downstream already handles |
| `Checks` | every safety check. **Outcome** is a dropdown, and picking **Authorised to run** on today's row lets a stopped bus out |
| `Defects` | one row per defect and one per advisory, told apart by **Kind**, so they can be chased |
| `Bus Bookings` | passenger bookings |
| `Trip Events` | every stop tap. **Ended by** is filled on the end row only, and differs from **Driver** when a coordinator closed somebody else's run |
| `Vehicle Log` | from v1.92.0, one row for every MOT, service, insurance or permit renewal, repair, tyres or other job, and every one booked ahead: the day it was done, the date it had been due and how early or late that was, the next due date and how it was worked out, and whatever else was known (mileage, garage, cost, the defects it put right). Rows are never edited or removed: a mistake is put right with a new row naming the old one under **Corrects**, and the old one is struck through. A row typed here with a Registration, What and Date done is completed as the app would have: Log ID, next due date, the Buses tab. See *The vehicle log* |
| `History` | from v1.92.0, one row for every change to a bus's due dates, a defect's status or what was done about it, the Vehicle Log and jobs to arrange: when, who, where, what it was, what it became, and why. Only ever added to; an edit here is itself written down |
| `Rota Requests` | swaps and cover asked for by drivers. **Status** is what approving means; a decision made from an email link or in the coordinator's app writes that same cell and leaves a note saying who decided it, where and when |

The Worker's own database holds the same stops, rota, buses and drivers (a
copy, pushed from here), the bookings and taps as they happen, the shelf, and
`push_subs` — one row per phone that has asked to be told things.

**Give every active driver a phone number.** Its last four digits are his
default PIN, and the PIN is what puts a name on a record. A driver without
one (and no PIN of his own) is waved through every gate in the app, and
because a sign-in now survives a page reload, that matters on a handset
somebody else picks up later. **Is everything working?** names anyone missing
one.

### Scheduled jobs

All installed by **Check scheduled emails, set up any missing**:

| When | What |
|---|---|
| every 5 min | sync with the live server |
| nightly, 3am | rota tidy-up, archive, push to the live server |
| daily | duty reminders, 7 days and 2 days ahead |
| Sunday 10:45 | tells you if a bus went out unchecked |
| Sunday evening | the weekly summary |
| on edit | alerts when a Sunday changes |
| on edit | the Outcome column on the Checks tab reaches the drivers' phones |
| on edit | from v1.80.0, `onEditLive`: an edit on the Rota, Drivers, Buses, Bus Stops, Rota Requests or Defects tab is pushed to the live server at once, and Status or Seats edited on a Bus Bookings row the live server owns is sent to it |

Eight from v1.80.0. The Worker has one of its own as well: its Cron Trigger,
every minute, which sends every timed message (see *The clock*).

---

## The coordinator's app

From v1.77.0, at `coord/` on the same site. The driver app's hub has a
**Coordinator** button when the name signed in there has a coordinator's
role (`fullInspectionRoles` in `config.js`, the same list that may authorise a
stopped bus). From v1.78.0 it has a line of its own, as wide as Vehicle
check, so Driving rota and Stops and bookings stay a pair. From v1.77.1 the
app's home screen icon is the logo on indigo, so it is not mistaken for the
driver app's.

**The PIN is asked for once.** From v1.78.0, a coordinator whose PIN the
driver app has checked goes straight to the coordinator's first screen. The
button leaves the name and the checked PIN in the tab's own session storage,
which no other tab and no later visit can read, and the coordinator's page
takes them and wipes them as it opens, refusing a copy more than a minute
old. With no checked PIN (a name kept from earlier in the day, say) only the
name goes, and the page asks for the PIN with the cursor already in the box.
Opened any other way, from its own home screen icon or a link, it always
asks. The live server still checks the PIN on every call.

**And the other way.** From v1.81.0, once signed in, the coordinator's
**Driver app** link and the **Vehicle check** at the foot of its menu leave
the name and PIN for the driver app in the same way: once, in this tab only,
refused after a minute. The driver app checks the PIN exactly as it checks one
keyed there. A yes lands on the hub, signed in, from Driver app, or straight on
choosing the bus from Vehicle check; a no stays on the name screen, with the
PIN box saying so. The Driver app link on the sign-in screen has no PIN to
carry and stays a plain link.

**The landing page** is the sign-in screen, as on the driver app. It carries
the three numbers, `coordinator · server · sheet`, read from the live server
without a PIN, with the names that may sign in taken from the Drivers tab it
holds (config.js only until it answers). From v1.82.0 the last list it was
given is kept on the phone and drawn at once, so the remembered name and the
cursor in the PIN box are there before the live server has answered. Tapped, the numbers give the same
kind of report the driver app's do: the three versions to anybody, and once a
name is chosen, whether the live server answered, who can open the page, whether
the name has a PIN on the Drivers tab, how this visit was opened, the lock and
refresh settings, and after a sign-in what is on the way to the sheet and when
the live server's clock last ticked. The theme chips sit under the numbers and
set the driver app's own setting for Auto, Light and Dark. From v1.96.3 each
app has one colour of its own, the colour of its home screen icon: Indigo here,
Navy in the driver app, Green on the passenger page. The other app's colour
reads as Auto. The
first screen after the sign-in has no numbers on it.

Each change is made under the coordinator's PIN:

| Screen | What can be done there |
|---|---|
| Rota | who drives or covers each route; which bus runs which route (choosing the other route's bus swaps the two); both routes running, North off, South off or all off; a note on the Sunday. From v1.90.0 the way in is the Sunday card on the first screen (it says *Rota ›*): Back from that Sunday is the list of Sundays, and Back again home. The first screen has no Rota button of its own |
| Rota requests | the pending ones, approved with a cover chosen from the drivers free that morning, or turned down |
| Bookings | this Sunday's and next Sunday's, stop by stop, each by its number, with the numbers to ring. A booking cancelled for somebody who rings; seats booked for somebody without a smartphone. From v1.90.0 a seat taken when its stop number was another place says *Booked when N05 was …* (see *A stop is its number*) |
| Defects | the open ones, with their status changed, and closed only with what was done. From v1.89.0 each has *What has happened to it*: every status it has been given, by whom, where and when, a reopening included. From v1.90.0 **one card per fault on each bus**, however many walkarounds reported it: the heaviest weight any report gave it, the newest words, *3 reports since …*, how long it has been open and *DVSA daily check* when it is on that list. **Update** and **Close** are for every report on the card, each listed and ticked; untick one that is a different fault under the same heading. Each report gets its own History line |
| Buses | from v1.89.0, each bus's MOT, service, insurance and permit dates with how far off they are, its log, and the jobs its last walkaround asked for. **Record something** for an MOT, service, renewal, repair, tyres or other job done or booked ahead; **Correct** or withdraw an entry; **Done** on a job. See *The vehicle log* |
| Run record | the last five Sundays, each stop by its number. A wrong stop time put right, or a stop nobody tapped given its time; both are marked Corrected. From v1.90.0 a stop with no tap says which it is: *2 seats booked, not marked* in amber, or *nobody booked* in grey, where the driver app asks for no tap at all. A number that was another place that morning says *then …* |
| Have a look | the bus link for this Sunday; bookings this Sunday; are we over on seats; is everything working; is the live server working; who has alerts on; who is tapping; who is carrying the load; which bus is on which route; send duty reminders now |
| What has been done | every change, by whom, and whether the sheet has it. *What I have done* until v1.90.0, which told whoever opened it that every change was theirs |

The first screen also carries what cannot wait: a bus stopped at the
walkaround (Authorise), a run still open half an hour after it was due at
church (End it), a request waiting, a Sunday over on seats, a critical defect,
and a change the sheet did not take. Authorise and End it use the same calls
the driver app does.

**Every screen says its name once**, from v1.90.0: in the bar. The heading
that repeated it under the bar is gone, here and on the driver app's Driving
rota, Stops and bookings and Waiting to send. A heading stays only where it
says something the bar does not: a Sunday's date, a bus's plate, a report's
name. On Bookings and the Run record **the row of Sundays stays under the
bar** while the list scrolls, and **switching Sunday is not a step**: one Back
leaves the screen however many Sundays were looked at.

Left in the spreadsheet on purpose: setup, and
free-form editing of any tab. The rehearsal controls are in the app from
v1.79.0, on the Rehearsal screen; the sheet's menu items still work. The app
does not work without a signal: a change kept on the phone and sent later
could land on top of a decision somebody else made in the meantime.

### How a change travels

Every change goes to the live server first and is answered there.

**A fact the live server owns**, a booking or a stop time, is changed there
and reaches the tab by the drain, like a passenger's booking or a driver's tap.

**A fact the spreadsheet owns**, the rota, a request or a defect, is written
into the live server's `coord_actions` table. From then on every phone sees
it, the driver app and the passenger page included, because the live server
lays it over the copy of the rota the sheet last sent. The knock and the drain
carry it to the sheet within seconds, and Apps Script applies it through the
same code that runs when a person edits that cell: the Status rule on the Rota
tab, the stamp saying who changed it, the emails to the drivers affected,
`applyRotaDecision` for a request, the Closed on date for a defect. The sheet
then pushes a fresh copy naming the changes it now includes (`coordApplied`),
and the overlay stops.

A change the sheet refuses, such as a request somebody decided on the tab in
the meantime, is shown as **Not taken** with the reason, on the first screen
and in *What has been done*, and is no longer laid over the copy.

Each change carries an id made on the phone when the sheet for it opens, so a
second tap after a lost answer is the same change and is made once. Apps
Script keeps the ids it has applied in the `coordApplied` script property, so
a change drained twice is applied once there too.

**The PIN is checked on every call**, reads included, because the reads carry
phone numbers and the reasons drivers give. It is the same three tries and five
minute lockout as everywhere else. The page keeps the PIN in memory only, and
forgets it after `coordApp.idleMinutes` untouched. Keying it again goes back
to the same screen.

The page has no service worker, so it never shows a screen from a cache.

### The vehicle log

From v1.89.0 (pages), w2.30.0 (live server) and v1.92.0 (sheet). Until then
the Buses tab held one date per renewal and a new one was typed over the old:
when an MOT had actually been done, what it had been due, and anything about
the service before it were lost. Now a new date never removes the old one.

**Record something**, on a bus's screen, needs only what it was. The day it
was done is today unless changed, and everything else (the date on the
certificate or policy, mileage, garage, cost, notes, the open defects it put
right) can be left empty. **Booked ahead** puts a garage booking on the log and
moves no date; **Done** on it later records it. The next due date shows before
Save, and the live server works it out again and keeps its own answer:

| Renewal | Next due |
|---|---|
| Service | twelve months from the day it was done. Due 30 September, done 14 October: next due 14 October next year |
| MOT | tested within a month (less a day) before it ran out: it keeps its date, a year on. Earlier than that, or after it ran out: a year from the test, less a day, which is the date the certificate carries |
| Insurance, parking permit | renewed in the two months up to its expiry: the anniversary, a year on. After it lapsed, or earlier than that (a new policy): a year from the renewal, less a day (a policy starting 5 March runs to 4 March) |

A date typed from the certificate or the policy always wins. The app shows
the next due date and how many days early or late it was done; how the date
was worked out goes in the Vehicle Log tab's own column, not on the screen.
An MOT and a service done together are each recorded; a date that moves is
put right by hand. (Up to v1.90.0 the form offered to line a service up with
an MOT six to thirteen months off. The rule is still in all three copies, so
they stay one, but nothing offers it.)

**No teaching on the screens.** From v1.90.0 the coordinator's app states
facts, asks questions and names buttons, and leaves how and why to the manual
and the videos. Note fields carry no sample text: an empty note sends nothing.

**The new date is on every phone at once**, the driver app's warnings
included, as any other change from the app is (see *How a change travels*).
The sheet writes the row on the Vehicle Log, moves the date on the Buses tab
and writes on History what it was. A defect ticked as put right is closed with
the entry named under Action taken.

**Correct** an entry to change its day, the certificate date, mileage, garage
or cost: the next due date is worked out again from the date the bus had
before the entry. **Withdraw** one that should never have been recorded, and
the bus goes back to that date. Either way the entry stays on the log, struck
through, beside the one that corrects it.

**Jobs to arrange** are what the last walkaround on each bus asked for, less
any marked **Done** here. A later walkaround's list replaces an earlier one's.

**Where the log starts.** The first sync after v1.92.0 adds one row for each
date already on the Buses tab, marked **Estimated**: a year back from the due
date, with the last service taken as done with the last MOT. Nothing on the
Buses tab moves. Correct any whose real date you know; it only affects the
log.

**Is everything working?** holds what the phones have against the tabs, from
w2.30.0 and v1.92.0, so a sync that stops landing is noticed rather than
shown as an empty log: the due dates every driver app warns from against the
Buses tab, and the Vehicle Log the coordinator's Buses screen shows against
the tab. A difference says Send everything; a date cell that cannot be read is
listed to do. The live server sends dates and counts only.

**A date typed on the Buses tab** is written on History too, with who typed it
where the sheet will say, both as it is typed and at the five minute sync (so a
paste or a fill-down is caught). Text that is not a date is refused as it is
typed, and one already there is written down as unreadable rather than taken
as blank.

### The reports

Four come from the live server's own copy: bookings this Sunday, are we over
on seats, who has alerts on, and which bus is on which route. Five need the
spreadsheet: *is everything working*, *is the live server working*, *who is
tapping*, *who is carrying the load* and, from v1.87.0, *send duty reminders
now*, which asks before it sends and sends only what is due today. The live
server asks Apps Script for them and waits up to 25 seconds. If the sheet
does not answer, *is everything working* still reports on the live server and
says the sheet did not answer. The spreadsheet's own menu items give the same
reports as before, from the same code.

*The bus link for this Sunday* needs neither: it is the passenger page's
address, with **Send on WhatsApp** and **Copy the link**.

### Two faults fixed on the way

A request decided on a Sunday with a route called off put the route back on.
Approving or turning it down wrote Confirmed or Change requested into the
Rota's Status over `North cancelled`, and the passenger page reads that cell.
The Status is now left alone on a called-off Sunday, whether the request is
decided by hand on the Rota Requests tab, from an email link, or in the app.
v1.81.0 fixed the same fault for a request being filed.

The note saying who decided a swap was written, then wiped by the edit
handler that runs after it. It is now written last.

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

**Two settings from v1.75.0**, in `eta` in config.js and `ETA_RULES` in
Code.gs, which must be kept equal:

| | |
|---|---|
| `maxBehindMinutes` | how far behind a bus may be and still be given an estimate. `0` is no limit, which is the setting. It was a fixed 45 |
| `keepMinutes` | how long an estimate stays up once its time has passed with the stop unmarked. `15`, the same as the quiet rule. It was a fixed two |

The passenger page gives the estimate from the moment the bus leaves church,
in bold, and his own stop's row in the list shows the estimate in place of
the timetabled time. The driver's list shows the estimate alone, in bold; a
plain time is the timetable. Both apps say "5 minutes behind schedule" and
"2 minutes ahead of schedule".

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

Anybody who opens the passenger page is offered notifications, from
v1.75.0, booked or not. A phone's alerts follow the number it last gave: see
*Both ways in seconds*.

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

**Until w2.30.1 none of this fired for a real tap.** The driver app sends
`pickup` for Picked up and `empty` for Nobody there, and always has. The live
server asked for `picked` and `none`, the words the tests sent, so every test
passed while a real morning woke nobody after the departure. The Run record
and Add asked the same wrong question. One list in `worker.js`
(`TAP_PICKED`, `TAP_EMPTY`, `isStopTap`) now answers it everywhere, and
`tests/suites/37-stop-taps.mjs` reads the words off the driver app's own
buttons rather than typing them, so the two cannot drift apart again.

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

**And once for a man with a seat, from w2.19.0.** Until then the run skipped
anybody with a booking every time, so his only reminder was the Sunday morning
message. A window marked `booked: true` also tells everybody who has booked
what they booked: **You are booked for Sunday**, then the stop, the time, the
seats, and "Tap to change or cancel." Saturday evening is the one marked, so
the last word before the morning is his own booking, while he can still
change it or give the seat back. It goes once in its window, on a tag of its
own, so a nudge he had earlier in the week does not stop it. Take `booked` off
every window and a man with a seat hears nothing until the morning, as before.

**Adding or removing one is a line.** `windows` in `BOOKING_RULES` (Code.gs) and
`booking` (config.js), which must match. All three point at the Sunday the
**booking page itself** would accept, asked of the same cutoff, so a reminder
can never point at a Sunday nobody can book.

**From w2.16.0 these ride the Worker's own clock** and go at the first minute
of their window. What follows was true until then, and is what happens if
the Cron Trigger is missing. All of these ride the five minute sync that
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

**A rehearsal wakes nobody about a bus.** The Worker holds back every alert
about a run while one is running, the stop alerts, the morning message and a
route called off among them, and a route still off is told the minute it
ends. The driver's nudges are about the real run and never about a test one.
From w2.20.1 the booking reminders are not held back, because they say
nothing about a bus: a rehearsal on a Saturday evening used to swallow the
one reminder a booked passenger gets before Sunday. A phone woken during one
is told only what it has booked, unless the Rota has its route off. That may
be for the checklist or for real, so a seat on that route gets no Saturday
reminder until the rehearsal is over, and a phone woken meanwhile is told to
open the app, or "No bus" if that is what it was last told. Holding all this
back is correct, and it used to leave one question permanently unanswered:
whether Google and Apple accept what the Worker signs. A malformed token
looked exactly like a quiet Sunday.

### Every alert in the app

The complete inventory, by who receives it. **Held** says whether silencing
that alert makes a check go red — measured by actually silencing each one and
running the suite, not by reading test names. As of `w2.15.0` every one of them
is held; thirteen were not, and `21-alerts.mjs` is what closed them.

**The coordinator** — by email to `COORDINATOR_EMAIL`, and from v1.86.0 /
w2.23.0 also to **every coordinator's phone**: everybody whose Role is one of
the `COORDINATOR_ROLES` titles and who has turned alerts on, with the bell in
the coordinator's app's header (from v1.84.0) or the one in the driver app,
signed in as themselves. On an iPhone the app has to be on the Home Screen
first, and the bell says so. There is no other sign-up. The phone alert is short
(what happened, to which bus or Sunday) and opens the coordinator's app; the
detail stays in the email and behind the PIN, because a phone joins by typing
a name. A stopped bus is sent at any hour; the rest wait out the quiet hours
and go at 08:00. The person an alert is about (the driver who did the check,
the coordinator who authorised) is not woken by it. Each is sent once, however
many times Apps Script hands it over. **Send an email now, Test email and
coordinators' phones** tests both. The weekly summary and the test email are
the two rows below with no phone alert of their own; the test sends one.

| What | When | Why | Held |
|---|---|---|---|
| A walkaround came in — stopped / defect but driveable / advisory only / nothing wrong but something to arrange / already authorised | the second a driver signs and sends | it is the record that a bus went out, and the stopped one needs a decision in minutes | yes |
| Authorised to run | a bus is released, from the app or the email link | says who released it and that the defect is still open | yes |
| Rota change request | a driver taps Request change | a request is a question and needs an answer before that Sunday | yes |
| Went out unchecked | Sunday 10:45, once, only buses with no check | both routes are already out — a prompt to inspect on return, not to catch a bus | yes |
| Overbooked | the 5-minute sync when a booking lands; hourly regardless | a bus can only be moved while there is still time | yes |
| Weekly summary | Sunday 19:00 | the week in one place, unasked | yes |
| Test email | the menu, on demand | proves notifications work at all | n/a |

**The drivers** — email for the rota, push for the morning.

| What | When | How | Why | Held |
|---|---|---|---|---|
| You are driving | 7 days and 2 days before, 08:00 | email + `.ics` | a week to arrange your life, two days to remember | yes |
| You are no longer driving | the rota changes inside 7 days | email | so he does not turn up | yes |
| You are now driving | same | email + `.ics` | so he does — and it names the bus | yes |
| Approved / not approved | you decide it | email | he asked a question | yes |
| Your route is not running today | called off on the Rota | push | outranks everything: never say the bus is late when it is not coming | yes |
| Your bus was stopped | a critical defect stops it | push | do not take it out | yes |
| Your bus is authorised | you release it | push | otherwise he only finds out by opening a screen he has no reason to open | yes |
| Time to set off | the departure time, from w2.27.0 | push | on the minute, not ten minutes late | yes |
| The bus has not gone out | 10–90 min past departure, no start tap | push | forgotten, or something is wrong | yes |
| You are driving today | Sunday morning, before departure | push | the morning, said on the morning | yes |
| End the trip | 15 min after the last timetabled arrival, 10 min idle | push | an open run never closes itself | yes |

**The passengers** — push only.

| What | When | Why | Held |
|---|---|---|---|
| Book your seat | Sun 15:00–16:00, Wed 18:00–19:00, Sat 18:00–19:00 | three chances, and the bus needs to know | yes |
| Last chance to book | those windows, inside 24h of the cutoff | 09:30 Sunday is final | yes |
| You are booked | a nudge window, already booked | confirms instead of nagging | yes |
| Your bus today at HH:MM | Sunday 07:30–08:30 | the plan for the morning | yes |
| No bus to your stop today | route called off | before anything else, and instead of everything else | yes |
| No word yet that your bus has left church | 5–60 min past departure, no start tap, from w2.27.0 | says only what is known: Start is the one signal, and a driver who forgot to tap it is already on the road | yes |
| The bus has left church | the start tap | it is real and it is moving | yes |
| Be at your stop now | the estimate inside the imminent threshold | the one that matters | yes |
| The bus is a few minutes away | the estimate moved by more than `resendMinutes` | only when the number actually changed | yes |
| Picked up | you tap him picked | closes it | not measured |
| The bus has gone past | it passes his stop | he has been missed and needs to know | yes |
| Alerts are working | he taps Turn on | proves it | n/a |

Nothing is sent **21:00–08:00**. Every message carries a tag, so one event
cannot buzz the same pocket twice.

The coordinator's emails are swept across hours too, in `23-coordinator.mjs` —
not because the risk was equal, but because it was not the same standard. An
email arrives once and is read once: it carries no live estimate and nothing
that expires between sending and opening, which is where all five of the phone
faults were. What is worth checking is the lead time, and that two emails about
one Sunday do not contradict each other. Three of them are also asserted to read
**identically at any hour they can be sent**, which is what would catch a clock
creeping into a message that should not have one.

Nine of twenty-three used to be held. The heaviest of the missing was the
walkaround email — the single most important message the app sends, and
deleting the line that sent it broke no check at all. The coordinator emails
were the weak side throughout, because the suite grew up around the Worker and
the rota, where the arguments were.

#### The bug that came out of writing those tests

The cancellation test was written, and it failed — with *"You are booked for
Sunday"*. Not a fixture fault.

`wakeCancelled` runs on every five minute sync, any day of the week, so calling
a route off on the Friday pushed everybody booked on it there and then. But the
words are computed when the phone asks, and `tripPayload` returned
`why: "open"` **before anything had looked at the Rota**. So the cancellation
push arrived wearing the booking message:

> **You are booked for Sunday**
> Scarisbrick Dr, 10:03.

The exact opposite of what it was sent to say. And `wake` burns the tag on that
send, so by the Sunday the sweep considered the phone told and the correct
message never came. **The only notification he ever received told him his seat
was fine, on a morning that was not running.** It came out right only if the
route was called off *after* 09:30 on the day itself.

Two changes in `w2.13.0`, a third in `w2.13.1`, a fourth in `w2.13.2` and the whole thing rewritten in `w2.14.0`. The Rota is now read before the gate — the gate was
there to hide live *tracking* until bookings close, and a bus that is not
coming is not tracking. And the message says "today" only when it is today,
because a sweep that runs all week will say this on a Friday.

Four checks hold it, and reverting either half turns them red.

The first version of that fix read the Sunday's whole bookings table at the
same time, on the busiest path in the app — every passenger tap all week, to
answer a question whose answer is no in forty-nine weeks out of fifty. It asks
the Rota for one indexed row now and looks at the seats only if that row says a
route is off. Two reads before any of this, five in the first attempt, three
now. A check counts them, because the cheap version and the expensive one are
four lines apart and behave identically.

**And the same sweep found two more of the family.** Firing every alert and then
asking the phone what it says turned up the morning message — sent 07:30–08:30,
read through the same early return, and therefore saying *"You are booked for
Sunday"* on a Sunday morning instead of *"Your bus today at 10:15 — be at your
stop a few minutes early."* The wording it wanted already existed forty lines
lower and was unreachable before the cutoff. Its test passed because it checked
the words at 10:05, a time the message is never sent at. Fixed in `w2.13.2`.

The third was **fixed in `w2.14.0`**, along with a fourth that I caused while
fixing the second: at 15:00 on a Sunday the booking nudge is
about the week after, and a regular who travelled that morning has no seat for
it, so nudging him is right — but the record still has his pickup in it, so the
nudge lands reading *"Picked up at Grace Rd. Have a good service."* Nothing
false, five hours stale. Fixing it means deciding what the situation IS once a
run has ended and the next Sunday has opened, which touches picked-up, gone-past
and the timetable fall-through together. 
Four faults, one sentence: **right answer, wrong hour.** The cancellation was
right after 09:30 and wrong before it. The morning push was right after 09:30
and wrong at 07:45, which is when it is sent. The pickup was right until the bus
got back and wrong all afternoon. And mine: I fixed the morning push by reading
the day off the payload — always *this* Sunday — while the seat it described
came from `seatFor`, which correctly rolls to *next* Sunday once bookings close.
So a man booked for the 4th was told on the 27th that his bus was today at 10:15
and to get to his stop. I had finished explaining that exact trap, in writing,
an hour before walking into it.

### The diary

`22-diary.mjs` is the answer to all four. It walks **one passenger through one
whole Sunday** — 07:00, 07:45, 09:20, 09:40, 09:53, 10:10, 10:16, 11:05, 13:00,
15:20, 19:00, Monday, Wednesday — for four people: one who travelled that
morning, one booked for the week after, one who never books, and one whose route
was called off. It reads as a table on purpose, so a person can look down the
column and see whether a sentence belongs at that time of day.

Nothing else in the suite did this. Every other passenger test picks an hour,
pins the clock and asserts — so each branch came out right at the hour its
author had in mind, and nobody ever asked what the other hours say. **Each of
the four faults, reintroduced one at a time, turns the diary red.**

**And then the driver's side, swept the same way**, because "the driver gates
look tighter to me" is the kind of sentence that had already been wrong four
times. It gave up a fifth: **the stand-down.** `driverRouteToday` falls back to
the route a phone *registered* with when the man's name matches nobody on the
rota — right for a message about a route, wrong for every sentence that says
*your*. So he is rostered, the sweep wakes him at eight, the coordinator swaps
him off at ten past, and he opens the notification at twenty past to read *"You
are driving today. North. Depart 09:52 after vehicle check."* A man sent to a bus
he had just been taken off, by the one mechanism written to stop stale words
arriving.

`driverRouteToday` now returns whether it matched *him* or guessed, and the whole
driver section says nothing at all to a man who is nobody's driver today — which
is exactly what the sweep would have told him. The one case it must not break:
a morning driven by somebody the rota never named. That happens, the app records
it as Cover, and he is as much that run's driver as anybody — so the trip is
asked before the rota, and the man holding the keys is still asked to close the
run.

The mechanics that made it possible: `seatFor` now returns the Sunday it
answered about rather than keeping it private, `seatWords` is the single place
that turns a seat into a sentence, and `pushWhat` finally reads the `ended` flag
that `tripPayload` had been setting on every reply since the beginning — grep
the old file and the word does not appear once below the line that sets it.

#### What is deliberately NOT alerted

Three real gaps, all of them omissions rather than faults, and worth knowing
before somebody reports them as bugs:

- **A bus swap with the same driver tells nobody.** Change the registration on
  the Rota and nothing goes out. The duty email covers for it in words —
  *"buses can change during the week, check the app on the day"* — which is a
  sentence standing in for an alert.
- **A passenger cancelling a seat tells nobody.** The booking flips to
  Cancelled and the count drops. Fine when a full bus empties by one; less
  fine when twelve drop out on the Saturday night.
- **Nobody is ever told a bus is running late in words.** Passengers watch the
  estimate move; a driver hears *the bus has not gone out* only if it never
  started at all. A run that set off twenty minutes late and stays twenty
  minutes late is silent all morning.

### Fixtures, and the week they cost

Three faults came from a fixture that agreed with the code instead of with the
spreadsheet, and a fourth from a stand-in kinder than the thing it stood in for.

| | |
|---|---|
| **Bus Stops** | the fixture said `Grace Rd`. The tab says `Grace Road bus stop, Walton Vale`. `fillStopPins` matched on the name with `===`, so nineteen rows came out blank on a live deployment and the guard worked exactly as written |
| **Checks** | the fixture called the date column `When`. It is `Date`. `colsSoft` resolves by name, so nothing matched, every bus read as unchecked, and two checks passed for the wrong reason |
| **Bus Bookings** | the fixture said `Passenger` and invented a `Note` column. The tab says `Passenger ID` and has no `Note`. **The correct header already existed in another suite** — a second, wrong one was typed rather than the first reused, which is the worse mistake, because a duplicate drifts and a shared one cannot |
| **`Utilities.formatDate`** | the fake handed its argument to `Intl`, which reads `undefined` as *now* — and the system clock's now, not the pinned one. A call that had lost its date came back with a confident, plausible, unrelated day |

All nine headers now live in `tests/lib/tabs.mjs`, off a real export, with a
`row()` builder that throws on a column the tab does not have. `01-stamps.mjs`
fails if a suite types a header out again, and fails if the fake formats a
non-date. The header check found *itself* on its first run, which is at least
evidence that it looks.

The rule underneath all four: **a fixture written from the code agrees with the
code about everything, including being wrong.**

### Testing an alert

Once alerts are on, both apps show a **bell icon in the top right of the frozen
pane**. Tapping it sends a test to that one phone and a toast says what came
back. No label, no explanation.

The icon is inline SVG drawn on `currentColor`, so it takes whichever of the
four themes is set without a rule per theme. It carries an `aria-label` and a
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

From v1.75.0 the passenger page offers it to everybody who opens it. The sheet
carries one line under the question: with a seat, "Booked for Sunday 4
October: Sedley Street, 2 seats."; with none before the cutoff, "No seat
booked. Book below."; with none after it, nothing. Before v1.75.0 it was shown
only to somebody who had actually booked a
seat for the coming Sunday. A page open on a stranger's phone is asked for
nothing. It also waits half a second and re-tests, because the install sheet
opens on a timer of its own.

**On a first visit the install offer comes first**, from v1.88.0. The two used
to race: whenever the subscription lookup answered before the stops landed,
the alerts question rose first, the install sheet found it up and stood down,
and "Add to your phone" was never offered. Now the alerts question waits while
the install offer is still to come on that visit, and rises as the install
sheet closes. An iPhone just shown the Home Screen steps is not asked to add
the page again on the same visit. Browser checks P7 and P7b.

**The Message button**, from w2.28.0 and sheet v1.90.0. The sheet sends every
active driver's WhatsApp number on the sync, and the live server names the
driver, with his number, only to a phone that has a seat on that route on
that Sunday, once bookings have closed, with the route running; the rota's
cover wins over the man first down. The page shows **Message** and his name
beside **Not coming**, with a message that says where the passenger is
booked, and drops it once the run has ended. Everybody else, all week, is
given nothing. A driver with no number on the Drivers tab has no button.

**Checked every time**, from w2.29.0 and sheet v1.91.0, because it was dark
for weeks with nothing saying so: only a booked passenger ever sees it, and a
missing button looks like a driver who gave no number. *Is everything
working?* asks the live server whose numbers it holds (names only) and holds
that against the coming Sunday's two drivers, cover first. None held at all,
or a rostered driver's number on the tab but not on the live server, is
**Needs attention**; a rostered driver with no Phone is **To do**; both
reachable is **Fine**, by name.

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
downloading anything else to do it. Keep the two in step.

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

A rehearsal puts test seats on both routes and lets you drive the whole
morning on a Thursday evening. From v1.79.0 the live server runs it, and it
is started, started over and ended on the coordinator's app (**Rehearsal** on
the first screen) or from the sheet's **Rehearse this Sunday** and **Stop
rehearsing**. Ask for a *quiet*, *ordinary*, *nearly full* or *over* morning;
the stops and numbers are drawn fresh each time.

- **Each start is a round.** A phone keeps the round its run was started in,
  and every tap says which round it was made in. When the round is over,
  ended or started over, the phone drops its test run and any taps still
  waiting, and offers Start trip again. It knows the end time, so a phone
  left open overnight lets the run go on its own, out of signal.
- **A late test is never real.** A tap from a round that is over is thrown
  away by the live server rather than recorded. So is anything more of a
  test run already cleared away, and a run that reaches the server only
  after its round ended, judged by when it started. A run started while a
  rehearsal runs is a test, whatever the phone says: no real run starts
  during one.
- **A real run is never taken for a test.** A run is a test when its start
  was one. A real run keeps all its rows, even one stored as a test by a
  page from before v1.79.0, and a test tap made on a Sunday between the
  cutoff and noon is never cleared away: none can be made there now, and
  one from before may be a real run an older version tagged.
- **Ending one clears it.** Its seats and its taps come off the live server
  at once, and off the Bus Bookings and Trip Events tabs on the next drain,
  a run's taken-back taps included. The same happens when it runs out: two
  hours, or midnight if it reaches Sunday. The sheet takes rows off its tabs
  only in the drain's turn, never beside a drain that is filing.
- **As often as you like.** Start over is a new round with new seats, and
  nothing from the last one is left anywhere.
- **Never on a Sunday morning.** It will not start while a real bus is out,
  or on a Sunday before noon; the Rehearsal screen says why. A real run a
  phone has ended is put aside while one runs, so the same phone can
  rehearse on a Sunday afternoon.
- **Nothing it writes is real.** Test seats and taps are tagged `Rehearsal`,
  a real run never counts them, and a rehearsal wakes nobody about a bus.

---

## When something looks wrong

**Start with Minibus → Is everything working?** It checks the tabs, the
scheduled jobs, the email allowance, the driver PINs and the row counts.

| Symptom | Look at |
|---|---|
| The app is slow again | **Is the live server working?** — if the shelf is past six hours, run **Send everything to the live server now** |
| A deploy seems to have done nothing | the version at the foot of the app, and the deployment number in the editor. Then check all five page stamps moved |
| A driver has no Start trip | is he in the Rota's *actual / cover* column for that route? |
| A driver made no entries at all | he was signed out. The app now restores his name and offers a Sign in button wherever it would otherwise go quiet |
| Passengers waiting for a bus that was called off | the Rota's Status for that Sunday. `North cancelled` or `South cancelled` tells them within five minutes |
| Bookings will not open for next week | last Sunday's run was never ended |
| A change made in the coordinator's app is not on the sheet | *What has been done* in the app. **On the way** means the sheet has not reported it yet, and the Worker keeps knocking every minute. **Not taken** gives the sheet's reason |
| No emails at all | `COORDINATOR_EMAIL` is blank, or the daily allowance is used up |

---

## Tests

In this repository, beside the release files: `tests/`. They check the code
as it ships, not a copy of it.

    node tests/run-tests.mjs                  everything
    node tests/run-tests.mjs authorise trip   only matching suites
    MINIBUS_ROOT=/path/to/project node tests/run-tests.mjs

The runner reads the project fresh on every run — `worker.js` is copied and
given a generated export block so its internals can be asked direct
questions, and `Code.gs` is loaded into a sandbox with the Apps Script
services faked, which is not an approximation of how Apps Script works but a
description of it. It checks that every file parses, runs every suite, and
ends in one word: READY or NOT READY. Run it before handing a build over.

GitHub runs the same command on every pull request and every push to `main`
(`.github/workflows/tests.yml`), on London time. A red **Tests** check on a
pull request means NOT READY. The browser checks in `tests/browser` are not
part of it; run those by hand before a release.

The Worker's suites run against a **real SQLite database** through a shim of
the D1 client, because half the faults worth catching here are SQL — a column
that is a keyword, an `ON CONFLICT` that does not fire, a unique index that
lets a second row through — and none of them show up against a mock.

Three of the suites are about the code rather than the behaviour: the seven
version stamps and the paired settings agree, every element the pages look up
exists, and every function and constant is used in code rather than only in a
comment. The last is there because an unused function keeps its comment, and
the comment keeps describing a feature that is no longer there. It found three
on its first run.

`tests/browser/` drives the real pages in Chromium and photographs them at
phone width on the way, for a person to look at. It is not part of the run.
`driver-app.mjs` and `passenger.mjs` answer from stand-in servers built from
`real.json`. `coordinator.mjs` runs the coordinator's app against the real
Worker, in the same process, on a real SQLite database seeded from
`real.json`. See `tests/browser/README.md`.

---

## Two things to know before changing anything

### The PIN

Keyed once, at the point of writing, and good for the rest of the morning.

**From v1.96.0 the live server is the only thing that knows a PIN**, copied
from the Ushers app:

- **The default PIN** is the last four digits of the driver's Phone on the
  Drivers tab. Apps Script works it out and sends the Worker only a
  **salted one way hash** on every sync. There is no PIN column; delete it.
- **His own PIN.** The driver app's hub has **Change PIN**: current PIN, new
  PIN twice. Four digits, never the one he has, never his default. Kept in
  the Worker's `driver_pins` table only: a random salt per driver,
  PBKDF2-SHA-256, with `PIN_SALT` as the secret pepper.
- **Asked once.** Right after the default (first sign-in, or after a reset)
  the hub asks "Do you wish to keep your default PIN?". Keep, or change it.
  Nothing is blocked while he decides.
- **Reset PIN**, on a driver in the coordinator app's Drivers screen, puts
  him back on the default and clears a lockout.
- Each change, keep and reset is a line on the History tab. Never the PIN.

| Where | What |
|---|---|
| Apps Script → Script Properties | `PIN_SALT` |
| Cloudflare → Worker → Variables | `PIN_SALT`, the **same value** |

**If the two ever differ, every default PIN is refused by the Worker.** Never
change `PIN_SALT` once drivers have their own PINs: it is their pepper too.

The sheet no longer answers a PIN. When the Worker cannot (no signal, a name
it has not been told about yet), the app uses this phone's own copy, or lets
him through and records that it could not check.

**Three tries, then five minutes.** That lockout lives in the Worker now and
had to move with the check. Verifying in one place while counting in the other
gives six tries wearing the label of three.

There is also a per-handset cache: a hash of `driver:pin` kept on the phone,
which short-circuits a repeat. When a driver gets in on it, a quiet re-check
asks the Worker behind him, to catch a PIN changed or reset since.

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

   Who may authorise is the `COORDINATOR_ROLES` Script Property (by default
   `Coordinator, Minister in Charge`), which the live server passes to the
   pages; `fullInspectionRoles` in config.js is only their starting point. Whether the person who did the
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

A refused batch stays in the phone's queue and is not discarded. An
accepted one is taken off the queue as the queue is when the answer comes,
so a tap made while a slow send is on its way stays queued and goes next.
Until v1.79.1 the queue was written back as it had been when the send went
out, and a tap made in those seconds never reached the record. There is no
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
Bro Martin and Bro Cedric actually drove, the useful fact is that the two
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
