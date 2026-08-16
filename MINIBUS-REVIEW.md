# Minibus Check + Sunday Bus — pre-launch review

**RCCG Dominion Assembly Liverpool · v1.19.23 · reviewed Sunday 16 August 2026**

Reviewed: `index.html` (4,908 lines), `Code.gs` (5,365), `sunday/index.html` (1,164),
`sw.js`, `config.js`, `manifest.webmanifest`. Every line read. Both front ends were
then actually run in a mobile Chromium against a stand-in for the Apps Script
endpoint, and `Code.gs` was executed against an in-memory spreadsheet, so what
follows is mostly observed behaviour rather than reading.

**Verdict: it is sound. Go.** Nothing found will stop this morning working. Four
small defects are listed, one of which is worth ten minutes before you deploy and
three of which can wait. The operational checklist at the end matters more than
the bug list.

---

## 1. What this is

Three programs sharing one spreadsheet.

**The driver app** (`/index.html`) — a walkaround inspection, a rota, and the
Sunday run. Installed to a home screen, works with no signal.

**The passenger page** (`/sunday/`) — one job: tap a stop, say how many are
boarding. No names, no numbers, no login. The link never changes; pin it in the
group once.

**The spreadsheet** (`Code.gs`) — the record and the authority. Nine tabs: Checks,
Defects, Rota, Rota Requests, Drivers, Bus Stops, Bus Bookings, Trip Events, plus
the Minibus menu. Everything the two apps know, they were told by this.

They meet at one Apps Script `/exec` address. The driver app carries a token; the
passenger page carries nothing, and needs nothing, because there is nothing on the
bookings tab that names a person.

---

## 2. A Sunday, in order

| Time | What happens | Where it is written |
|---|---|---|
| All week | Congregation book seats on the passenger link | Bus Bookings |
| Sat / Sun 08:00 | Duty reminder emails go out (7 days and 1 day before) | — |
| ~08:30 | Driver opens the app, picks his name, keys his PIN | — |
| 08:30–09:20 | Walkaround: mileage, fuel, 35 items, sign | Checks, Defects |
| — | Clear check → no email. Defect or a job to arrange → email. Critical → **BUS STOPPED** email | — |
| **09:30** | Bookings close. The list is fixed. Start trip appears | — |
| 09:50 | North sets off, taps each booked stop as he pulls away | Trip Events |
| 10:35 | South sets off | Trip Events |
| 10:45 | Any bus with no check recorded is emailed to the coordinator | — |
| 11:00 | Both arrive. End trip | Trip Events |
| ~11:05 | Both runs ended → the booking page rolls to next Sunday | — |
| 14:00 | Backstop: rolls anyway, if somebody forgot End trip | — |
| 19:00 | Weekly summary email | — |
| 03:00 | Nightly tidy-up: rota horizon rolled forward 16 weeks | Rota |

**Today specifically.** North: **Bro Moses**. South: **Bro Tunde** — the first South
run. I checked this against both the pattern in `config.js` and the pattern in
`Code.gs` independently; they agree, and they agree for the next six Sundays:

```
2026-08-16   North: Bro Moses        South: Bro Tunde
2026-08-23   North: Bro Asim         South: Pst Obamakinwa
2026-08-30   North: Bro Adebola      South: Bro Adesina
2026-09-06   North: Bro Abiodun      South: Bro Tunde
2026-09-13   North: Bro Moses        South: Pst Obamakinwa
2026-09-20   North: Bro Asim         South: Bro Adesina
```

The two anchors match across both files (`2026-08-02` North, `2026-08-16` South),
so the app working offline from `config.js` and the sheet working from `Code.gs`
cannot disagree about who is driving.

---

## 3. What it guarantees

These are the promises the code actually keeps. I tested each one.

**A check cannot be lost.** It is written to the phone before anything is sent. A
failed send queues it, shows a banner, and retries on reconnect, on the next
launch, and on the `online` event. Verified: killed the network mid-send, saw
"Held on this phone", restored it, tapped Send now, one row on the sheet.

**A check cannot be written twice.** Every check carries an id; the server scans
for it and answers `{ok:true, duplicate:true}` rather than appending. Verified.

**A tap cannot be lost or doubled.** Taps queue locally with the time they were
*made*, and are sent in per-run batches. The server treats (trip, event, stop) as
unique, so a retry writes nothing. Verified: two taps with the network down, both
queued, both landed once on reconnect. An undo held in the same offline batch as
the tap it cancels is handled — that was a real bug once and the fix is in.

**Times are the phone's, not the server's.** Every reply carries the server clock;
a phone more than a minute out has the difference applied to everything it queues.
The server writes `Logged` itself and never touches `Happened`.

**One booking per phone per Sunday.** Re-confirming replaces the row. Cancelling
writes exactly the word `Cancelled` — and the reader drops that one word and
counts everything else, which is why a tidy-looking "Cancelled late" would put the
seat back on the driver's screen. Don't invent statuses on that tab.

**A booking that appears to fail is checked, not guessed at.** Apps Script answers
a POST with a redirect, and a phone on a weak signal can fail to follow it after
the row is already written. So the page reads back before it says anything.
Verified: forced a failure, the page went and looked.

**Nothing a phone types can become a formula.** Anything starting `= + - @` gets a
leading apostrophe. Location is only turned into a `HYPERLINK` when it is a real
coordinate pair. I posted `=IMPORTRANGE(...)` as a registration and `@evil` as a
signature straight at the open endpoint; both landed as inert text.

**PINs never leave the spreadsheet.** The phone sends a name and four digits and is
told yes or no. No fingerprint goes out with the rota — I checked the whole rota
payload for one. Ten wrong tries pauses that name for ten minutes.

**Two buses cannot be one bus.** A registration already out on another route is not
offered on the second driver's screen.

**A stopped bus stays stopped.** A check ending in a critical defect removes that
bus's Start button entirely — for *anybody*, not just the man who signed it, so a
coordinator finding a fault at eight reaches the driver getting in at half nine.
Verified end to end.

**A rehearsal is invisible to the real record and vice versa.** Both directions,
enforced in `tripState` and `readBookings`. It expires on its own after two hours
*or* at the next booking cutoff, whichever is sooner, so one cannot survive into a
live morning.

**Nothing identifies a passenger.** The bookings tab holds a stop, a headcount and
a random handle the phone invented for itself. Punctuation is stripped from that
handle, so nobody can pose as a rehearsal seed — I tried.

### What it deliberately does not guarantee

- **It cannot stop a bus.** It records. Setting off with no check is one extra
  deliberate tap behind a PIN, and it lands on the sheet as an `Unchecked` run in
  that man's name. That is the enforcement, and it is the right one: a locked
  button produces no check, just an unrecorded morning.
- **A booking is an intention, not a promise.** Nobody is driven past on the
  strength of a count. An empty stop is green and asks for no tap; it does not say
  "drive past".
- **Live times are projections from the last tap**, and they go quiet rather than
  guess: silent after 15 minutes without a tap, or beyond 45 minutes off timetable.
- **A driver who never taps** leaves the passenger page saying exactly what the
  timetable says. Every tap improves on that floor; none is required for it.

---

## 4. Defects found

### D1 · The Phone column is never read — the WhatsApp button can never appear

`Code.gs:1134` fetches seven columns of the Drivers tab; `Code.gs:1153` reads the
eighth.

```js
var values = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();   // A..G
...
phone: String(r[7] || "").trim()                                       // H — always undefined
```

Every driver therefore reads back with `phone: ""`. `driverOnDuty()` bails on its
first test and returns `null` forever, so "Message the driver" never shows even
after you fill the column in. Confirmed by running it: three numbers in the sheet,
zero read back.

This is dormant today by decision, so it changes nothing this morning. It matters
the day you decide to switch it on, because the sheet's own note tells you it will
work.

```diff
- var values = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
+ var values = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
```

Same off-by-one at `Code.gs:1648`, where locking the sheet leaves the Phone column
protected while the rest of the register stays free:

```diff
-    return [sh.getRange(2, 1, last(sh) - 1, 7)];     // the register itself
+    return [sh.getRange(2, 1, last(sh) - 1, 8)];     // the register itself
```

### D2 · The passenger page blames the signal when the record has refused

`sunday/index.html`, `send()`. A reply of `{ok:false, error:"..."}` is thrown and
caught by the same handler as a network failure, which hands it to `verifySend`,
which finds nothing saved and says:

> "That did not save. Check your signal and tap Confirm again."

The server's actual words are discarded. The case where this bites is the one that
matters: somebody with the page open in a pocket since 09:20 taps Confirm at 09:31.
The record says *"Bookings for that Sunday have closed. Reopen the page for the
next one."* — and they are told to check their signal and try again. Verified by
forcing a refusal.

It self-corrects: `gateCheck` polls every 60s and reloads the page once bookings
close. So the wrong message lasts under a minute. Still worth the six lines:

```diff
   }).then(function(r){ return r.text(); }).then(function(t){
     var out=readJson(t);
-    if(!out || out.ok!==true) throw new Error(out && out.error ? out.error : "not saved");
+    if(!out || out.ok!==true){
+      /* The record answered, and said no. That is not a signal problem, and
+         going and looking will only confirm what it has already told us. */
+      var refusal=new Error(out && out.error ? out.error : "not saved");
+      refusal.refused=true;
+      throw refusal;
+    }
     saving=false;
     done(out);
   }).catch(function(err){
+    if(err && err.refused){
+      saving=false;
+      $("save").textContent="Confirm";
+      if(cancelAsk || CLOSED) paint(); else paintBar();
+      toast(err.message);
+      return;
+    }
     verifySend(payload, done);
   });
```

An HTML reply from Google still throws out of `readJson` without the flag, so a
sign-in page or a mid-deploy error page still goes to `verifySend`, as now.

### D3 · "Who is tapping" misses the runs it was extended to catch

`Code.gs:2831`. The status column holds either `Unchecked` or `Unchecked (offline)`
— the distinction added so nobody answers on Monday for a blackspot. The report
tests for exact equality:

```js
if (status === "unchecked") runs[id].unchecked = true;
```

so `unchecked (offline)` never matches, and those runs are neither flagged on their
line nor counted in the tally at the bottom. Report-only; nothing on the sheet is
wrong.

```diff
- if (status === "unchecked") runs[id].unchecked = true;
+ if (status.indexOf("unchecked") === 0) runs[id].unchecked = true;
```

### D4 · The "move the eye on" focus fires on every repaint, not on the transition

`index.html:1425`. `lastReady` and `lastVehId` are declared **inside** `paintFoot`,
so they are reset to `false` and `""` every call. `if(ready && !lastReady)` is
therefore true on every repaint while the screen is ready, and Continue takes focus
each time.

Observed: put the caret back in the PIN box, trigger one repaint, focus is on
Continue again. In practice a repaint arrives when the register lands from the
sheet a second or two after the screen is drawn, so a driver who has tapped back
into the PIN box can lose the caret once. Cosmetic, but it is not what the comment
above it says it does.

Fix: move those two `var`s out of `paintFoot`, above it.

---

## 5. Operational notes — these matter more than the bugs

**O1 · `COORDINATOR_EMAIL` lives in Script Properties, not in the file.** If it is
not set, *every* email path silently does nothing: defect alerts, the BUS STOPPED
alert, the Sunday 10:45 "went out unchecked" alert, and the weekly summary. The
file is blank on purpose. Check with **Minibus → Have a look → Is everything
working?** before this morning.

**O2 · Set the spreadsheet *locale*, not just the time zone.** The script warns if
the time zone is not Europe/London, but says nothing about locale — and the app
writes the check date as text, `16/08/2026`. On a US-locale sheet, `09/08/2026`
parses as 8 September. That is exactly the corruption `checkMoment` was written to
defend against ("one row carrying 8/9/2026 where the script had written
09/08/2026"), and the durable fix is one setting: **File → Settings → Locale →
United Kingdom.** Ten seconds, and it removes the whole class.

**O3 · Redeploy properly.** Saving `Code.gs` does nothing to the live app.
**Deploy → Manage deployments → edit → Version: New version.** If the `/exec`
address changes, it has to change in *two* files: `config.js` and
`sunday/index.html` (they hold the same string today — I diffed them).

**O4 · The cache version is bumped correctly.** `sw.js` is at
`minibus-check-v1.19.23` and `APP_VERSION` matches. The live site is currently
serving `v1.19.22`, so phones will pick this up. The version is on the first screen
— tap it for the PIN diagnosis if anybody's box does not appear.

**O5 · The PIN lockout can be triggered by anyone.** The `pin` action is answered
*before* the token test, and the token is public anyway. Ten wrong guesses against
a name pause that name for ten minutes, and the phone's own cached fingerprint is
not consulted when the server says "locked" — so a locked-out driver cannot start
his run, take a check, or send a request until it lifts. Very unlikely; worth
knowing the two ways out: wait ten minutes, or clear that man's PIN cell on the
Drivers tab (a driver with no PIN is never asked for one).

**O6 · The endpoint is open, by design.** Anyone holding the address can read the
timetable, the booking counts and where a bus is, and can create or cancel bookings
under invented handles. There is no rate limit. This is a proportionate trade —
nothing there names a person — but if it is ever abused, the answer is a new
deployment URL, not a patch.

**O7 · First open on a Sunday can look empty for up to thirty seconds.** The board
poll uses a 12-second timeout and a cold Apps Script container can exceed it; the
failure is silent by design and it retries at 30 seconds. Worth telling the drivers
once, so nobody reinstalls the app over it.

**O8 · A last-minute cover needs the phone to have had signal once.** With no
signal and no cached rota, "who may tap" falls back to the pattern in `config.js`,
which does not know about a cover you wrote on the Rota tab this morning. Opening
the app once in range fixes it.

**O9 · Watch the first Sunday's offsets.** `TRIP_QUIET_MINUTES` (15) and
`TRIP_MAX_OFFSET` (45) are honest guesses, and the code says so. Trip Events
records the gap between every tap, so after four or five Sundays you can read the
real spread off the tab and set them from data.

---

## 6. Pre-flight, in order

1. **Minibus → Have a look → Is everything working?** — expects: time zone
   Europe/London, both rotations present, all rostered drivers have an email
   address, all five scheduled jobs installed, `COORDINATOR_EMAIL` set, pickup
   stops present, no rehearsal running.
2. **File → Settings → Locale = United Kingdom.** (O2)
3. **Minibus → Check the Drivers tab** — confirms the eight columns are in order
   and reports how many have a PIN and an email.
4. Deploy the new `Code.gs` as a **New version** if you have edited it.
5. Upload `index.html`, `config.js`, `sw.js`, `sunday/index.html` together —
   `sw.js` must go with them or phones keep the old copy.
6. Open the driver app on one phone: version should read **v1.19.23**, and today's
   rota card should show **Bro Moses / North** and **Bro Tunde / South**.
7. **Minibus → Bus link for this Sunday** — confirm it says it is taking bookings
   for Sunday 16 August, and post the link.

---

## 7. What was tested, and passed

Driver app, in a mobile browser: boot with no console errors · register syncing
from the sheet · PIN accepted, PIN refused, wrong-PIN countdown · vehicle picker
with renewal chips · open defects shown on the prep screen · last-mileage lookup ·
the lower-than-last and big-jump guards and their confirm box · geolocation and the
"at the buses" line · all four stages, 35 items, on both vehicles · the critical
defect path: red dash, Do not run, call link, "Sign and stop the bus", correct
payload · the full POST body (25 fields, correct token) · offline check → queue →
banner → Send now · stops screen before the cutoff ("Bookings are still open") ·
after the cutoff, with counts · the unchecked-bus warning and Set off anyway ·
Start trip naming the bus · stop taps, the big next-stop button advancing, offset
and running time · two offline taps queued and both landing once · route tab
switching, and no Start button on a route that is not yours · End trip · rota cards
for both routes.

Spreadsheet, executed against an in-memory sheet: `doGet` for `rota`, `board`,
`bus`, `counts`, `trip`, `last` · `doPost` for a check, a trip batch with an undo,
a booking, a PIN and a rota request · duplicate suppression on checks and on taps ·
seat clamping (99 → 12) · an out-of-date link refused · an unknown stop refused ·
the PIN lockout after ten tries · a rota request writing "Change requested" and
emailing · approval writing the cover into the **correct route's** column ·
a swap moving **both** Sundays with matching notes · the roll from today to next
Sunday once both runs ended, and the "Today's buses are back" banner · withdrawal
allowed after the cutoff but refused once the run is over · five phones booking the
same stop summing correctly · formula injection neutralised · the weekly digest and
the 10:45 unchecked alert.

Service worker: installs, precaches 12 files, and both apps open with the network
gone — and the passenger page offline is still the passenger page, not a vehicle
inspection screen.

---

## 8. Two things I would not change

The failure design is the best thing here, and it is unusual. Almost every path
answers a failure by writing down what happened rather than by blocking: the
unchecked run, the unverified PIN, the missing location, the queued tap. That is
the correct trade for a volunteer at a kerb at eight on a Sunday, and the code
argues it out in the comments rather than assuming it.

The second is that the floor is always the timetable. Nothing the tracking does can
make the passenger page worse than it was before the feature existed. That is why
it is safe to go live with it today.
