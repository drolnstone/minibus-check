# Minibus check + driving rota: deployment and handover

Four files are edited. One lives inside the Google Sheet, three on the web
host.

| File | Where it goes |
|---|---|
| `index.html` | web host, alongside your existing files |
| `config.js` | web host |
| `sw.js` | web host |
| `Code.gs` | Google Sheet → Extensions → Apps Script |

Four more files must already be sitting on the host next to those. They are
never edited, but `sw.js` lists them as the offline shell, and if any one of
them is missing the app stops working without signal altogether. Nothing
announces this, because everything still works while you have a connection.

`manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `logo.png`

---

## Deploy in this order

Doing it out of order gives you an app that looks fine and silently fails, so
follow the numbers.

### 1. The spreadsheet first

1. Open your Minibus Rota & Checks spreadsheet.
2. **Extensions → Apps Script.**
3. Select everything in the editor and replace it with the new `Code.gs`.
4. **Save.**
5. In the function dropdown at the top, choose **`setUpEverything`** and press
   **Run**. Grant permissions when Google asks.

You should now have three new tabs: **Rota**, **Rota Requests** and
**Drivers**. Your existing **Checks** and **Defects** tabs are untouched.

### 2. Redeploy the web app

Saving the script does **not** update what the phones talk to. You must
publish a new version.

1. **Deploy → Manage deployments.**
2. Click the pencil on your existing deployment.
3. Version: **New version.**
4. **Deploy.**

Keep the same deployment so the `/exec` URL does not change. If you create a
brand new deployment instead, you must paste the new URL into `config.js`.

### 3. Upload the web files

Replace `index.html`, `config.js`, `sw.js` and `sunday/index.html` on your
host.

`sw.js` has been bumped to `minibus-check-v1.9.0`. That is what tells every
phone to throw away its old copy. If you ever edit `index.html` or `config.js`
again, bump that number, and bump `APP_VERSION` in `index.html` to match. Both
currently read `v1.9.0` and they are meant to stay in step, so that a version
shown on a phone tells you exactly which copy it is running.

**Checking which copy a phone has.** The version shows at the bottom of the
first screen, under the church name. If it does not match what you uploaded,
that phone has not picked it up yet.

**If the PIN box does not appear, tap that version line.** It reports which of
the four conditions is failing: requirePin in `config.js`, whether the page is
on https, whether the register arrived from the spreadsheet with PINs, and
whether the name you picked has one. No guessing.

**If a phone is stuck on an old copy.** It should sort itself out: the app
asks for an update every launch, and reloads itself once when a new version
takes over. Failing that, close the app fully and reopen it. On an iPhone with
the app on the home screen, swipe it away from the app switcher first.

Adding anything to the end of the address, like `?x=1`, also forces a fresh
copy, because the browser treats it as a different page. That is a useful
one-off trick while testing, but it is not something to do routinely and the
real address never needs to change.

### 4. Check it works before Sunday

- Open the app, tap **Driving rota**. You should see Sundays with names.
- Scroll a long way forward. It should keep going, not stop.
- Pick your own name on the first screen, go back to the rota, find one of
  your Sundays, tap **Request change**, send one.
- You should get an email within a minute with an **Open spreadsheet** button.
- The request should appear on the **Rota Requests** tab.

If the rota shows names but your request never arrives, step 2 was missed.

---

## How it works day to day

### Drivers

They can look at the rota, see who is on which Sunday, look at **My duties**,
and ask for a change on a Sunday that is theirs. That is all. They cannot
change the rota.

If a request cannot be sent, the app says **Not submitted**. It never queues a
rota request quietly, because a driver must not walk away thinking their
holiday is booked when it is still sitting on their phone.

### You

Everything official happens in the spreadsheet.

**A driver asked for a change:**

1. Open the **Rota Requests** tab from the email button.
2. Set **Status** to Approved or Rejected.
3. If approving, put the covering person in **Replacement assigned**.
4. The **Rota** tab updates itself: the cover goes in, the status becomes
   Covered, and the scheduled name is left alone.

**You already know somebody cannot make it:**

Go straight to the **Rota** tab, find the Sunday, put the covering person in
**North Liverpool actual / cover**. No request needed.

**Never delete the scheduled name.** That is how you keep sight of whose
Sunday it was and who actually covered it.

---

## The four things a future coordinator needs to know

1. Drivers ask for changes in the app. You decide.
2. You change the official rota in Google Sheets, never in the app.
3. To cover one Sunday, fill in **North Liverpool actual / cover**. Leave
   **North Liverpool scheduled** alone.
4. To change who is normally on that slot for good, edit **North Liverpool
   scheduled**.

---

## The repeating pattern

Sundays repeat in this order, for ever:

**Bro Adebola → Bro Abiodun → Bro Moses → Bro Asim → back to Adebola**

Counted from Sunday **2 August 2026**.

A one-off cover does **not** shift the pattern. If Asim is away on 18 October,
which is his Sunday, and Moses covers, the Sunday after that still belongs to
whoever the pattern says, and Asim's next turn is still Asim's.

### Changing the pattern

The **Drivers** tab controls it, through the **Primary order** column:

| Name | Role | Active | Primary order |
|---|---|---|---|
| Bro Adebola | Driver | YES | 1 |
| Bro Abiodun | Driver | YES | 2 |
| Bro Moses | Driver | YES | 3 |
| Bro Asim | Coordinator | YES | 4 |
| Pst Kehinde | Minister in Charge | YES | |
| Bro Calvin | Backup | YES | |
| Bro Tunde | Backup | YES | |

- **To add someone to the normal rotation:** give them the next number.
- **To add someone for cover only:** leave Primary order blank. Anyone marked
  Active can still be picked to cover a Sunday.
- **To stop someone driving:** set Active to NO. They vanish from every
  dropdown and from the app. Sundays they already drove are left alone.
- After any change here, run **Minibus → Refresh dropdowns from Drivers tab**.

Anyone marked Active can be picked to cover a Sunday. "Backup" in the Role
column is just a description of what they normally do, not a limit on it.

**Adding somebody: the Drivers tab is enough.** The app pulls the register
from the sheet whenever it connects, so a new person appears on every phone
without touching `config.js`.

**Removing somebody: do both.** Take them off the Drivers tab and out of the
`drivers:` list in `config.js`. That list is what a phone falls back to when
it has no signal or has never connected, so a name left there can still be
picked by an offline phone.

---

## Do you need the Drivers tab

Yes, and it is the only tab that earns its keep by being editable from your
phone. It is the one place you can add or remove a driver without editing a
code file and re-uploading it. Six columns, and the order matters:

- **Name**: what appears in the app.
- **Role**: decides who is offered the full inspection.
- **Active**: NO removes them from every dropdown and every phone.
- **Primary order**: 1, 2, 3, 4 sets the repeating pattern. Blank means they
  are not in the normal rotation but can still cover.
- **PIN**: four digits they key in before starting a check. Blank means they
  are not asked for one.
- **Email**: where duty reminders are sent. Blank means they get none.

The script reads these by position, not by name, so do not insert a column in
the middle of them. If you ever need to check, **Minibus → Check the Drivers
tab** says whether they are still where the script expects and how many
drivers have an email address and a PIN.

The old **Backup pool** column was dropped long ago. Nothing read it. If you
are looking at a very old copy of this sheet that still has it, the columns
will be one out from the list above, and the Drivers tab check will tell you
so. Put them back in the order shown rather than deleting anything blindly:
on a current sheet, column E is the PIN.

## Why there are two rota tabs

**Rota Requests** is what drivers asked for. **Rota** is what is actually
happening. You need both, because most changes will never have a request
behind them. You find out on Friday that somebody cannot make Sunday, and you
just change it. There is nowhere else for that to live.

The Rota tab holds **16 weeks** of Sundays. Short on purpose: the rows exist so
you have a cell to click, and in practice you only change a Sunday in the next
month or two. Everything past 16 weeks still shows in the app, worked out from
the repeating pattern, and gets written down here as the horizon rolls forward
or the moment you touch it.

To change a Sunday further ahead, use **Minibus → Add a Sunday to the rota**.
It creates the row with whatever driver the pattern gives, and you change it
from there. **Extend rota further ahead** fills a whole year at once.

If the Rota tab is ever empty, run **Minibus → Set up / refresh rota**. That
fills it immediately whatever the once-a-day timer says.

## The Sunday summary

An email goes out on Sunday evenings: which buses were checked, by whom, fuel
level, anything to arrange, and every defect still open. It is where the wash
and fuel requests actually reach you.

It is scheduled by a trigger that is installed during setup inside a
try/catch, so that a refused permission cannot stop the rota being built. The
cost of that is it can fail quietly. Run **Minibus → Check weekly summary is
scheduled** once after deploying. It tells you plainly, and sets it up if it
is missing.

## Where the check was done

A walkaround is meant to happen at the bus. The app records **one location**
when an inspection starts, so that shows on the record.

- Nothing is recorded when a driver is only looking at the rota.
- There is no tracking between checks. One fix, at the start, and that is all.
- The driver sees a line on the mileage screen telling them it is happening.

**It never blocks a check.** If the phone refuses, has no signal, or takes too
long, the inspection carries on and the record says why there is no location.
A bus going out unchecked because the GPS sulked would be far worse than a
blank cell.

Four columns on the Checks sheet: **Where checked** (a tappable map link),
**Accuracy (yd)**, **Distance from base (yd)**, **Location note**. The location
also appears in defect and bus-stopped emails.

Distances are in yards and miles, like the mileage and every road sign the
driver passes. Anything recorded before this change is in metres under those
same columns; the headers are renamed in place on the next check.

### Where the buses are kept

`busBase` in `config.js` holds the spot outside 3-5 Chester Road, measured
standing at the bus rather than taken off a map. The postcode centre was
113 yards out, which is why it was worth doing once.

```
busBase: { lat: 53.424169, lng: -2.936799, radius: 165 },
```

`radius` is how far from that point still counts as being at the buses, in
yards. 165 allows for parking further along the road on a busy Sunday.

A check done away from that point records the distance, and the driver sees it
on screen before they start. It is never treated as an accusation: the app
only calls a check "away" when the phone's own accuracy figure leaves no
doubt, so a poor fix in a built-up area never flags anyone wrongly.

If the buses ever move, do one check standing at the new spot and copy the
**Where checked** figures into `busBase`.

To switch the whole thing off, set `recordLocation: false`.

## Two routes, two rotas

Each route has its own repeating pattern, and they run independently.

- **North Liverpool**, four drivers, so it turns over every four Sundays.
- **South Liverpool**, three drivers, so it turns over every three.

They are not meant to line up, and nothing anywhere needs them to. Four and
three only meet every twelve weeks. Each route simply takes its next turn.

Each route counts from its own first Sunday, set by `rotaAnchor` for North and
`rotaSecondaryAnchor` for South. South began on 16 August 2026 and its column
stays blank before that date, because there was no South run to record and a
name against an empty Sunday reads later as a missed duty. If a third route is
ever added, give it its own anchor the same way rather than bending the name
order to fit somebody else's.

The **Route** column on the Drivers tab says which pattern somebody belongs
to, and **Primary order** is numbered separately per route, so both start at
1. A blank Route counts as North.

That default is worth understanding. If Route is blank for everybody, every
ordered driver counts as North and the North rota runs through all of them in
one long cycle, which is not obviously wrong at a glance: the names are all
real and the Sundays all look filled. Set up / refresh rota fills Route in for
drivers it recognises, and **Minibus → Check the Drivers tab** shows the two
patterns so you can see at a glance that North has four names and South has
three. If a rota ever looks subtly wrong, check that first.

**Minibus → Rebuild future Sundays from the pattern** puts the scheduled names
back where the pattern says, for Sundays still to come. It will not touch the
past, a Sunday with a cover filled in, or one whose Status you moved off
Confirmed.

The two slots are named after the routes rather than the vehicles, because
which bus runs which route can change on the day. The script reads this tab by
column position and never by heading, so the names are yours to reword whenever
you like.

Duty reminders go to whoever is on either route that Sunday, and both the
email and the calendar entry name the route, so nobody has to guess which end
of the city they are driving.

---

## Things worth knowing

**Statuses on the Rota tab:** Confirmed, Change requested, Covered,
Cancelled/declined, No driver assigned. The last one goes red, so an empty
Sunday cannot quietly look normal.

**PINs are on.** Each driver keys in four digits before they can start a
check. Set them in the **PIN** column of the Drivers tab, not in a file. The
last four digits of the person's own phone number work well: nobody forgets
their own number, which is what made PINs unworkable before.

The PIN itself never leaves the spreadsheet. The app is sent a one way
fingerprint and compares that, so the numbers cannot be read off the endpoint.
Worth being clear all the same: four digits are few enough that anyone
determined can work through them, and people who know each other tend to know
each other's phone numbers. This stops a driver casually picking the wrong
name and makes signing as somebody else deliberate rather than easy. It is not
a security boundary. The real one is who you share the spreadsheet with.

A driver with no PIN in the sheet is not asked for one, so adding somebody
never locks them out. Set `requirePin: false` in `config.js` to switch it off.

**Emails** go to `COORDINATOR_EMAIL` at the top of `Code.gs`, currently
`asimbassey@yahoo.com`. Both defect emails and rota emails carry a button
that opens the spreadsheet **on the right tab**: defect emails land on
**Defects**, rota emails land on **Rota Requests**. The address is read from
the sheet itself each time, so there is no link to keep up to date. Your
sheet URL is also written into `SHEET_URL` near the bottom of `Code.gs` as a
backstop; if you ever make a copy of this spreadsheet, delete that line so
the copy does not email links back to the original.

**There is no Query workflow.** If a request needs explaining, ring the
person. Approve or reject is the whole of it.

---

## The checklist

There are two lists, built from one set of 49 items.

**Pre-drive, 33 items.** What every driver does before carrying anyone. All
12 critical items are in it. This is the only list most drivers ever see, and
they are not shown a choice.

**Full inspection, 49 items.** The pre-drive list plus the slower structural
and equipment checks: corrosion, seat and handrail condition, battery, spare
wheel, wheelchair restraints, documents. This is coordinator work.

Who gets the choice is set by `fullInspectionRoles` in `config.js`, matched
against the role in the driver register. It is currently Coordinator and
Minister in Charge. The choice appears on the mileage screen. Switching type
clears any answers already given, because the two lists are different.

Every check records which type it was, in the **Check type** column.

### The three answers

Each item has **Fine** and **Defect**. The full inspection adds a third,
**Not on this bus**.

That third one means **not applicable**: this bus genuinely does not have the
thing. A wheelchair ramp on a bus with none. A speed limiter that was never
fitted. It counts as answered, never as a defect, and never stops the bus.

It does **not** mean "not available" or "I could not check it". If something is
fitted but the driver could not check it, say the bonnet catch is jammed or the
step is buried under bags, that is a **Defect** with a note. The coordinator needs
to know, and burying it under N/A would hide a real problem behind something
that reads like a shrug.

The pre-drive list is already cut to what each bus actually has, so nothing on
it can be "not on this bus" and the button is not shown there. The full
inspection reaches further, so it keeps it.

A defect has to be described before the driver can move on. Not on this bus
does not. It is recorded in the **Not applicable** column of the Checks sheet,
so a gap in the record means an item was missed, not that it did not apply.

## Fuel and things to arrange

**Fuel** is recorded on the mileage screen: eight segments, tap what the gauge
reads. It is written down the way a person says it, so half a tank records as
1/2 tank and a full one as Full. Marked at the quarter, half, three quarters
and full. Red up to a quarter, amber at three eighths, green from half a tank
up.

The word "tank" is doing real work. Written on its own, `1/2` is not text to
Google Sheets, it is the 1st of February, and `3/8` is the 3rd of August.
Every reading except Full was quietly stored as a date until this was fixed.
If your sheet has checks recorded from before then, run **Minibus → Repair old
fuel readings** once and it will put them back. It is
required, because a column only half filled in cannot be used to arrange
anything.

Eighths rather than miles remaining, because only YS70 has a range readout and
range swings about with how the bus is driven. Eighths means the same thing on
both buses and compares week to week.

A low tank is **not a fault**. It stops nothing and emails nobody. At 2/8 or
below the app tells the driver to fill up before setting off, and pre-ticks
*Needs fuel* on the next screen.

**Things to arrange** sits on the review screen, above the summary: *Needs a
wash*, *Inside needs a clean*, *Needs fuel*, *Tyres need air*, and *Nothing
needed*. Any number of the first four, or Nothing needed on its own.

An answer is **required** before the check can be signed. Nothing needed is a
real answer and is not recorded as a job; leaving it blank is not, because
that is a driver who scrolled past rather than one who looked.

These exist because the cleanliness item only fires when a bus is too dirty to
be **safe**, and by then you are not booking a wash, you are dealing with a
problem. A bus can be perfectly fine to drive and still look poor for a
wedding, and nothing recorded that until now.

Both get their own column on the Checks sheet, and both appear in the Sunday
evening digest, which is where you would actually act on them.

## Duty reminders

Drivers get an email before their Sunday, with a **calendar file attached**.
Opening it once puts the duty in their own phone calendar, which then reminds
them the evening before, on their own alerts, with no signal needed. After
that the app is not involved.

Two go out: **a week before**, which gives somebody time to ask for a swap,
and **the day before**, which is the one that gets them out of bed. Change
`REMIND_DAYS` at the top of `Code.gs` if you want different notice.

**It needs the Email column on the Drivers tab.** Anyone left blank simply
gets no reminder. Nothing breaks, they are skipped. Emails are never sent to
the app; they stay in the spreadsheet.

Reminders go out once each. Running them by hand will not double up.

### When you change a Sunday afterwards

If you move a Sunday that people have already been reminded about, both are
told automatically: the one coming off gets a short note saying they are no
longer needed, and the one coming on gets the duty with its own calendar file.

It only fires for Sundays inside the reminder window. Change something a month
out and nobody has been told yet, so the normal reminder carries the right
name and there is nothing to correct.

This runs on its own trigger, separate from the one that stamps the sheet.
Google does not allow the ordinary sheet trigger to send email, so if that
separate one ever fails to install you lose these alerts and nothing else.
**Minibus → Check scheduled emails** reports on all of them, and sets up any
that are missing.

- **Minibus → Send duty reminders now** to test without waiting for morning.
- **Minibus → Check scheduled emails** confirms the reminders, the Sunday
  summary, the change alerts and the nightly rota tidy-up are all actually
  scheduled, and reports how many drivers have an address.

Why email rather than a text or a phone notification: Apps Script cannot send
texts without a paid third party account, and phone notifications only work if
the driver has added the app to their Home Screen and granted permission,
failing silently otherwise. The calendar file needs nothing set up at their
end and keeps working offline.

### What works on which phone

Every driver gets the **email** itself, whatever they use. That carries the
date and who they are covering, so the reminder never depends on anything
clever working.

Two ways into their calendar, because no single one is reliable everywhere:

- **The attached file.** Opens straight into Calendar on an iPhone. Also fine
  in Outlook and on most Android mail apps.
- **The Add to my calendar button.** A plain web link, so it works where an
  attachment does not, which is mainly Gmail on Android and some Yahoo Mail
  app versions.

One honest limitation. The attached file asks for an alert twelve hours
before. **iPhone honours that. Google Calendar usually ignores it** and applies
whatever default notification the driver has set for all-day events, which is
normally the evening before anyway. So the reminder still arrives, just not
always at the minute we asked for. Nothing to fix at our end: it is Google
Calendar's own behaviour on imported events.

The duty is marked as free rather than busy, so it does not black out somebody's
whole Sunday in their calendar.

Yahoo addresses: the first email from the script often lands in spam. Mark it
not spam once and it behaves after that.

## When emails stop arriving

**First: a clear check never sends an email.** Only a defect or a stopped bus
does. If every recent check came back clean, silence is the app working.

If you were expecting one, use **Minibus → Send a test email**. It tells you
what happened rather than leaving you guessing, and reports how many emails
the account can still send today.

Common causes, in the order worth checking:

1. **The check had no defects.** By design. Nothing to fix.
2. **The script needs re-authorising.** It now uses two Google services it did
   not before. After pasting in new code, open the editor, run
   `setUpEverything` by hand once, and grant permissions when asked. A web app
   whose permissions are stale can fail silently.
3. **The daily email allowance is used up.** Google caps it per account. The
   test email reports what is left. It frees up about 24 hours later.
4. **Spam.** Apps Script mail to Yahoo often lands there the first time. Mark
   it not spam once and it usually behaves after that.
5. **Deployment not updated.** Saving the script changes nothing on its own.
   Deploy → Manage deployments → edit → Version: New version.

### Upgrading an existing sheet

New columns are always added to the right-hand end of the Checks sheet, never
inserted in the middle, so nothing already recorded ever moves. They appear
automatically on the next check.

## Renewal dates

| | YS70 PWE | NH56 FWP |
|---|---|---|
| MOT | 17 Jun 2027 | 28 Apr 2027 |
| Service | 17 Jun 2027 | 1 Jul 2027 |
| Insurance | 26 Jun 2027 | 8 Jul 2027 |
| Parking permit | 31 Jan 2027 | 31 Jan 2027 |

Within 30 days shows amber, past shows red. Nothing shows today. The first is
**1 January 2027**, when both parking permits go amber.

---

## The nightly tidy-up

Once a week the rota needs a new Sunday added on the end, and the dropdowns
rebuilt to match the Drivers tab. That work used to happen the first time
somebody opened the rota after the horizon rolled forward, which meant one
driver waited several extra seconds, and Sunday morning was exactly when it
landed.

It now runs on its own trigger at 3am. **Minibus → Set up / refresh rota**
installs it, and **Minibus → Check scheduled emails** confirms it is there.

There is still a safety net. If the trigger was never installed, or stops
running for three days, the old behaviour comes back automatically so the
rota never stops growing. You do not have to do anything for that to happen.


---

## Versions

Numbering changed at 1.0. The forty-nine numbered versions before it were one
number per upload, which said nothing about how much had changed: five of them
in a row were a single problem found in five different places, one at a time.

From 1.0 on, the second number carries a real change and the third carries a
small fix. 1.0 to 1.4 tells you the app changed four times and roughly how
much. Forty-nine numbers never told you anything.

**v1.1** follows v49. The rota card, and swaps.

**v1.1.1** Four fixes to the request sheet. Messages fired while the sheet is
open are now visible: they were rendering behind the dark overlay, so a
submission could be refused without anything saying why. The swap picker now
offers the same number of Sundays whoever you choose, instead of four for a
North driver and six for a South one. A cover on one route no longer removes
that Sunday from the other route's driver. And when the list comes back empty
it says why, rather than leaving the driver to work it out.

**v1.1.2** A Sunday now holds one request per driver rather than one request
in total. With two routes a Sunday has two drivers who can each ask for
something independently, and only one was being kept: whichever row was read
last won, so a request could appear on the card under the other driver's
name, and it quietly used up their one ask as well. Both requests now show,
each under the name of whoever made it.

**v1.2** Protected Sundays, and a load report.

## Protecting a Sunday

Some Sundays matter more than others: a first run on a new route, a
convention, any Sunday where who is driving is not interchangeable. Write
this in the **Notes** column on the Rota tab:

```
PROTECTED: first South run, Tunde leads
```

The reason after the colon is optional but worth writing, because it is shown
to a driver who tries to swap rather than leaving them refused with no
explanation.

Protection stops **swaps**, not covers. A swap is a convenience and can wait.
A cover is somebody telling you they cannot come, and refusing that could
leave a bus with nobody to drive it on the very Sunday you were protecting.
Covers go through, and the request email tells you the Sunday is protected so
you can think about who takes it.

On a protected Sunday the app says so on the card, does not offer the swap
option at all, and never lists that Sunday when somebody else is choosing a
date to trade for. The rule is enforced again in the sheet when a swap is
approved, because a phone may be running an old cached copy.

## Who is carrying the load

**Minibus → Who is carrying the load** counts the last 26 Sundays that have
actually happened and reports, per driver, how many they drove, how many they
covered for somebody else, how many times they were covered, and how many
swaps they took.

This is the reason covers and swaps are kept as different things. A cover
leaves a debt: whoever said yes drove an extra Sunday. A swap is even. A rota
can look perfectly tidy while the same two or three people absorb every gap
in it, and nothing else on the sheet would tell you.

**v1.3** Sheet protection.

## Locking the sheet

Most of this spreadsheet is a record rather than a control. Checks are what
was inspected and signed. Requests are what a driver typed on their phone.
Defect descriptions are what somebody found on a bus. An accidental keystroke
in any of it is silent: no error, no warning, just a changed record that
nobody notices.

**Minibus → Lock the sheet** protects everything the app writes. It also runs
by itself every time you run Set up / refresh rota, because adding columns
leaves old protection covering the wrong range.

Worth understanding what this can and cannot do. Google Sheets **cannot lock
the owner out of their own sheet**. Strict protection stops other people and
is invisible to you. What works for the owner is a warning: edit a locked
cell and Sheets asks whether you meant to. You can still go ahead. That is
the point, because the risk is the accidental keystroke, not the considered
decision.

Left editable, because these are touched as a matter of course:

| Tab | Still editable |
|---|---|
| Rota | both scheduled columns, both cover columns, Status, Notes |
| Rota Requests | Status, Replacement assigned |
| Defects | Status, Action taken, Closed on |
| Bus Bookings | Status only |
| Bus Stops | the whole timetable below the header |
| Drivers | the whole register below the header |
| Checks | nothing |

Header rows are locked on every tab. That is where the quiet damage happens:
rename or move a heading and things break without saying so, which is exactly
what an empty Route column did.

**Minibus → Unlock the sheet** removes all of it if you ever need to work
freely. Lock it again afterwards.

**v1.4** The Sunday 10:30 alert.

## When a check has not been done

The duty reminder tells a driver the day before, and then nothing checks
whether they acted on it. That left the only way of finding out as asking.

At **10:45 every Sunday** you get one email naming any bus that went out with
no check recorded, and who is driving it. If both were checked, nothing is
sent.

By 10:45 both buses have already left, so this is not a warning to catch
somebody before they pull out. It is a record that a vehicle went out
unchecked, and a prompt to inspect it on return while anything that happened
that morning can still be found.

It is deliberately this way round rather than a message for every clean
check. Two confirmations a Sunday that nothing is wrong would be skimmed
within a month, including the one that mattered.

The buses it expects are the ones the app has ever recorded a check for, so
adding a bus needs no change here: its first check puts it on the list.

To change the time, edit `installMissingCheckAlert` in `Code.gs` and run
**Minibus → Set up / refresh rota** again.

**v1.5** The Sunday timetable.

## Bus Stops

A new tab holds the pickup points and times, so the timetable stops living
only in a WhatsApp message. **Stops and times** on the rota screen shows it to
any driver, both routes, and it is cached like the rota so it works without a
signal at the far end of a run.

| Column | What it is |
|---|---|
| Route | North or South |
| Stop ID | N01, S03, and so on |
| Time | written as text, `09:50`, not a time value |
| Stop | as a passenger would recognise it |
| Postcode | optional |
| Active | NO hides a stop without deleting it |
| Type | Pickup, or Arrival for where the run ends |

Both routes run every Sunday, in two buses at opposite ends of the city. What
rotates is which driver takes each route, not which route operates.

South is five junctions off Molyneux Road, taken Patton Street first, then in
to Tudor Street and back out. They were one line on the old timetable because
a single bus did both runs and there was no reason to separate them.

Family names are deliberately not in the stop labels. Among people who know
each other that is fine. Written into a tab the app reads, it pairs a surname
with a street and the exact minute those people stand outside.

Nothing on that tab records passengers. It is the timetable only.

**v1.6** Passenger bookings.

**v1.8** One permanent booking link. The date and per-Sunday code came out of
the passenger link, so there is a single address to pin in the group instead of
a fresh one every Saturday. The script works out which Sunday it is: this one
until bookings close, then the next. The page lives at `sunday/index.html`.

Also: the passenger page now takes its styling from the checks app, and its
stop name, postcode and count stack instead of running together in one line.
"You are booked" no longer appears until Confirm has actually been pressed.
Before this, tapping a stop was enough to say it, and somebody could close the
page believing they were on a list they had never joined.

North and South are tabs on both pages, each with its own summary, opening on
the driver's own route for that Sunday, covers included. **Stops and bookings**
is on the home screen as well as in the rota. The rota has a back to top
button. The service worker no longer hands the driver app to somebody who
opens the booking page with no signal.

**v1.9** Bookings that actually reach the driver.

**Stops and bookings** was reading whatever counts happened to be in the
phone's cache and never asking again. The only fetch on that path fired when
the timetable itself was missing, so a phone that already had the timetable
showed numbers from whenever the rota screen was last opened. Worse, when
those numbers belonged to a Sunday that had passed the screen withheld them
entirely and showed times only, with nothing on screen to say why. A booking
made on Tuesday could be invisible on Thursday.

The screen now asks. There is a new `?counts=1` endpoint returning the Sunday
and the counts and nothing else, instead of pulling the whole rota payload
with the driver register, PIN hashes, open defects and a year of rota rows to
answer a question about two numbers. It is fetched when the sheet opens and
every thirty seconds while it stays open, because bookings arrive until 09:30
and a driver reading the list at 09:10 should not be looking at a frozen copy
at 09:25. The poll stops when the sheet closes and when the phone sleeps, and
refetches on waking.

The counts are cached in the script for twenty seconds, so several drivers
polling at once cost one sheet read. Writing a booking clears that cache, so a
passenger tap shows up on the next poll rather than whenever the cache lapses.
Striking a booking out by hand on the Bus Bookings tab clears it too, through
`onEditBookings`. That one runs in a simple trigger with restricted
permissions and may not be allowed to touch the cache, so it is wrapped: the
worst case is a hand cancellation taking twenty seconds instead of none.
`rotaVersion` is deliberately not bumped by a booking, because that would
rebuild the entire rota cache on every passenger tap.

The screen now says how old its numbers are, and says why when it has none.

Also in v1.9: the modal eyebrow is set by whichever function opens it. It was
fixed text, so **Stops and bookings** was headed "Rota request", left over
from when that sheet only did one job. `aria-hidden` is handled on both
openers, and the stops Close button goes through `rotaClose` like everything
else.

On the passenger page: Open Graph tags, so pasting the booking link into
WhatsApp produces a card instead of a bare address. `og:image` has to be an
absolute https URL and at least 300px wide, hence `icon-512.png` rather than
`icon-192.png`. If WhatsApp has already cached an empty preview for the
address, the Facebook Sharing Debugger at `developers.facebook.com/tools/debug/`
will clear it: Scrape Again. That is a one-time fix, not a per-release one,
because ordinary edits to the page do not touch those four tags.

Also on the passenger page: `touch-action:manipulation` stops double tap to
zoom while leaving pinch to zoom alone, the closing time is bold, and the line
about what the page does and does not record has been taken off. That
statement still sits as a column note on the Bus Bookings tab, which is where
anybody asking the question would look.

**v1.10.1** Stops and bookings opened on whatever route was looked at last,
rather than on the driver's own.

Three things compounding. The chosen route was worked out once and then kept,
and the guard only reconsidered it when the current route had become invalid,
which North never is. Nothing reset it when the sheet closed, so one person
looking at the other bus left it that way for everybody afterwards. And the
fallback used while the timetable was still loading was North for everybody,
so a South driver who opened the sheet quickly was pinned to the wrong bus
before his own route was known to exist, and pinned there permanently by the
first two.

It now re-derives on every repaint, so the late-arriving timetable corrects
it. A tab tap is recorded as a deliberate choice and holds while the sheet is
open. Opening the sheet resets to your own bus.

**v1.10** Where the bus is.

The driver taps a stop as he pulls away from it. That one tap says two things:
the people there have been collected, and the bus is running so many minutes
off the timetable. The first is what a passenger sees. The second is what
makes it worth building, because "the bus has done Molyneux Road" is a fact,
and "your 10:20 is about 10:26" is an answer. Standing in the rain knowing you
have nine minutes is a different morning from watching a row turn green.

Only stops with somebody booked need a tap. An empty stop is shown green and
asks for nothing, because one tap sets the offset for every stop after it, and
nobody is watching a stop nobody booked. Green here means no tap is required.
It does not mean drive past, and the wording on screen never says it does: the
driver drives the road he always drove and his own eyes decide who is standing
on it. Somebody who never booked but is at the kerb gets carried as always,
and simply does not appear in the numbers.

The one big button. The screen shows a single full-width target reading Picked
up, followed by the name of the stop he is expected at next, because a man who
has just pulled up in traffic should not be hunting among fifteen small
targets. Progress is measured from the last stop he marked, not the first he
has not: taking the first unmarked stop looked right until a driver forgot
one, at which point the button sat pointing back at a stop two miles behind
him. Anything booked and unmarked behind his furthest point is shown as a
stop he has gone past, with two buttons, Nobody there and Picked up, to settle
it in one tap. It warns and never blocks. A driver at the kerb with the engine
running must not be fighting a modal to get on with his morning. Every booked
stop also carries its own small pair of buttons, so being out of sequence is
never an argument with the app.

Nothing is tappable while the bus is moving. Holding a phone at the wheel has
been an offence in its own right since March 2022, moving or stopped in
traffic, and an app the church built should not be the thing asking for it.
The speed comes from the same location API the walkaround already uses.
Anything above about five miles an hour greys the buttons out and says why. A
phone that will not report speed at all is treated as stopped, because the law
is the driver's to keep and this is a guard, not a gate.

Start trip and End trip. Start is unavailable until bookings close, and no tap
is live until Start has been pressed, so there is no state where the buttons
work but the run has not begun. End writes the total, which is the journey
time you have never had a record of.

Taps carry the time they were MADE. A phone in a blackspot queues them and
sends the lot on reconnect, and the server writes its own Logged column but
never touches Happened. Get that the wrong way round and every projection
downstream of a bad patch of road drifts by however long the phone was out of
touch, silently, and you would never find it from the sheet. Queued taps are
sorted by when they happened, not by when they arrived. A repeat after a
timeout is ignored, because one live row per trip, stop and event is already
unique. And every successful call carries the server's own clock, so a phone
set an hour wrong is corrected rather than allowed to poison every offset it
sends.

The passenger side has a floor, and the floor is the timetable. A driver who
never taps leaves that page saying exactly what it said before any of this
existed, which is no worse than before. Every tap is an improvement on the
floor and never a replacement for it. Built the other way round, a forgetful
Sunday would leave people staring at a screen that promised something and went
quiet, which is worse than the message in the group, because the message at
least stopped honestly.

So the page refuses to project in four cases: the run has not started, nothing
has been tapped yet, nothing has come in for fifteen minutes, or the offset is
beyond forty-five minutes, which is no longer a late bus but something else.
In all four it states the last thing it actually knows and stops. The bus has
not reported since 10:12. Under a minute it says any moment now rather than
counting down at somebody who is already looking up the road.

Both those numbers are guesses. Nothing derives them. Fifteen minutes is about
three missed stops at your spacing; forty-five is set long on purpose, because
a diversion on a match morning eats thirty without anything being wrong, and
the two mistakes cost differently. Cutting off early leaves somebody with
nothing at the moment they most want something. Projecting a little too long
leaves them with a soft number, which still beats a blank screen. Trip Events
records the gap between every tap on both routes, so after four or five
Sundays the real spread can be read off the tab and both constants set from
data instead of from judgement. That is worth doing.

Who may tap: the rostered driver for that route that Sunday, or his named
cover. Everyone else reads. It stops a second driver idly tapping a route he
is not on and corrupting the timeline, and it makes every tap attributable to
a name, which is the whole enforcement value. Nobody tapped Utting Avenue
invites a shrug. You did not tap Utting Avenue does not. Coordinator and
Minister in Charge see both routes live, through the existing
`fullInspectionRoles` setting, because they are the ones rung when a bus is
late.

Waiting passengers are shown on the driver's screen at the moment of the tap,
not just as a booking count. The pressure to keep tapping belongs in the cab,
aimed at the man who decides, rather than arriving on Monday through a
complaint.

Who is tapping, under Have a look, is the record: per driver, per Sunday,
stops tapped against stops that had somebody booked, and the journey time.
Show it to the drivers once at the start. Being told it is recorded does more
work than any nudge inside the app.

Visibility is gated. The live view is for a phone with a booking for that
Sunday, and only after bookings close. Everybody else sees the timetable
exactly as before.

A new **Trip Events** tab holds all of it, append-only. Events rather than a
status column on the timetable, because the timetable is reused every week and
a status would be gone by the following Sunday. Undo marks a row Undone rather
than deleting it, because a driver who taps and untaps four times should leave
a trace.

**v1.11** Rehearsal, and two things that were not bugs.

**Rehearse this Sunday**, at the bottom of the Minibus menu. For two hours, or
until bookings next close, whichever comes first, the tracking behaves as
though bookings had shut, test bookings appear on both routes, and a
coordinator can tap either route whether rostered or not. Both apps carry a
banner. Nothing a rehearsal writes touches the real record: seeded bookings
are tagged Rehearsal and are ignored unless a rehearsal is actually running,
Trip Events rows are tagged the same way, and a real run and a rehearsal never
see each other's events in either direction. Who is tapping ignores rehearsal
rows always.

The expiry is deliberately not a flat number of hours. Rehearse at eight on a
Sunday morning, forget, and three hours later it would still be running during
the real thing. Ending at the booking cutoff means a rehearsal can never
survive into a live morning. It also clears itself on the nightly job, and
**Is everything working?** reports it in the needs-attention list, because a
rehearsal left running is the one state that makes everything else on that
screen mean something different.

One thing it deliberately does not do is force `bookingsClosed` to return
true. That function decides which Sunday a bare link is for and whether a real
passenger may still book. Forcing it would roll the booking page forward a
week and turn away anybody trying to book. The tracking gate is separate.

**Duty reminders were never broken.** Reminders go out a week before a Sunday
and again the day before, so the only two days that send anything are the
Sunday before and the Saturday. On the other five days there is nothing to
send. Running it by hand on a Tuesday correctly sent nothing and then toasted
"Reminders checked", which read as though mail had gone out. It now says what
went, what was skipped as already sent, and when the next batch is due. There
is also **Send me a sample duty reminder**, which sends you the real duty
email for the next Sunday, ignores the sent-once record, and never goes to a
driver. That is the test that was being reached for.

**Why the Start trip button was nowhere to be found.** Two gates, both
correct. It belongs to the rostered driver for that route, and it does not
appear until bookings close. Anybody else got "This bus has not started yet",
which explained none of that. The read-only strip now names the driver and the
time the button appears, and points at the rehearsal.

**The rota card still shows both routes.** Sunday is one operation with two
buses, and who has the other one matters when you are deciding whether to swap
or who to ring. The answer to "which of these is me" is to mark yours, not to
hide theirs, so your own leg now carries a You marker and a stronger left
edge.

**v1.11.1** The booking page moved from `/bus/` to `/sunday/`.

It is a Sunday bookings page, and bus never said that. The old address had
only ever been used for testing and was never given out, so it was deleted
rather than redirected. Nothing points at `/bus/` any more.

WhatsApp caches previews per address, so the new one needs its own scrape
through the Facebook Sharing Debugger before it is pinned. Otherwise the first
paste comes up bare and that empty result is what gets cached.

Internal names were left alone. `BUS_PAGE_URL`, `busPayload`, `busCurrentSunday`
and the Bus Stops and Bus Bookings tabs all still say bus, which is accurate:
they are about the vehicle. Only the address the congregation sees changed.

## The Minibus menu

Grouped by what a thing does to you, not by what it is about. It used to be
seventeen items in one flat list, which put "Rebuild future Sundays" three
rows below "Check time zone" with nothing to say that one rewrites the rota
and the other only looks.

Two items sit at the top level, the two wanted most weeks: **Bus link for
this Sunday** and **Bookings for this Sunday**. Everything else is behind one
of four submenus.

**Have a look (nothing changes)** holds Is everything working, Who is carrying
the load, Who is tapping, Check the Drivers tab, and Check time zone. Nothing
in there writes anything.

**Rota and setup (safe to re-run)** holds Set up / refresh rota, Refresh
dropdowns from Drivers tab, Add a Sunday to the rota, Extend rota further
ahead, and Check scheduled emails. These add and repair; they do not
overwrite, and running any of them twice costs nothing but time. Below a
separator, on its own, sits Rebuild future Sundays from the pattern, which
asks first.

**Send an email now** holds the test email and the weekly summary, both of
which go to you alone, then below a separator the duty reminders, which are
the only thing in the whole menu that reaches anybody else's inbox. The
labels say so.

**Sheet protection** holds Lock the sheet and Unlock the sheet. Unlocking asks
first.

Below all of it sits the rehearsal item, which states which way it will act:
**Rehearse this Sunday** when none is running, or **STOP REHEARSING** with the
minutes left when one is. The menu itself is therefore the answer to "is a
rehearsal on".

**Send an email now** also holds Send me a sample duty reminder, which goes to
you and ignores the sent-once record, so it can be run as often as you like.


Three items can change something you would miss, and all three say so before
they do it: **Rebuild future Sundays**, **Unlock the sheet**, and **Duty
reminders**, which is the only item in the menu that reaches anybody else's
inbox.

**Is everything working?** is new. It checks the time zone, the Drivers tab
columns, both route rotations, all five scheduled jobs, the day's remaining
email allowance, `COORDINATOR_EMAIL`, and that the timetable has pickup stops,
then reports it in one alert. It repairs nothing on purpose: **Check scheduled
emails** already reinstalls missing triggers, and a look-only item that quietly
changed the project would be the sort of surprise this menu now exists to
avoid. It names what is missing and points at the item that fixes it.

**Bookings for this Sunday** is new. The Bus Bookings tab holds one row per
phone, which is the right shape for storing bookings and the wrong shape for
reading them. This is the same summing the driver's app does, per stop and
per route, for whoever is at the spreadsheet instead. It is what you want in
front of you when somebody rings to cancel.

Two items were taken out. **Repair old fuel readings** was a migration that
ran once and has nothing left to do. **Set the bus link secret** stopped
meaning anything in v1.8, when `BUS_REQUIRE_CODE` went false and the code came
out of the link: nothing checks the secret now, but the item still warned that
replacing it would stop every link already sent from working. A frightening
warning attached to an action with no effect is worse than no item at all.

Both functions are still in `Code.gs` and can be run from the Apps Script
editor if `BUS_REQUIRE_CODE` ever goes back to true, or an old sheet turns up
with date-shaped fuel readings in it.

## The Sunday bus link

**One address, forever.** Pin it in the WhatsApp group and never post another:

```
https://drolnstone.github.io/minibus-check/sunday/
```

Passengers tap it, tap their stop, say how many are boarding, and confirm.
They can change or cancel until **09:30 on Sunday morning**, set by
`BOOKING_CUTOFF_DAY`, `_HOUR` and `_MIN` in `Code.gs`. North's first pickup is
10:05, so the list settles shortly before the driver sets off. The driver sees
the numbers per stop under **Stops and bookings**, on the home screen or in
the rota.

The link used to carry a date and a per-Sunday code, so a fresh one had to go
into the group every week and last week's died quietly in somebody's chat
history. It now carries nothing. The page asks the script which Sunday it is
and the script answers: this Sunday until bookings close on the morning, then
the next one. Somebody opening it at ten past ten on a Sunday is told that
today's bus has gone and that they are now booking for next week, rather than
being shown an empty list they might mistake for a lost booking.

**Minibus → Bus link for this Sunday** still exists. There is nothing left to
generate, but it is where you go for the address and it tells you which Sunday
the page is currently taking bookings for.

### Where the file goes

`sunday/index.html`, a folder called `sunday` next to `index.html`, with the page
inside it named `index.html`. That is what makes the trailing-slash address
above work. A file called `bus.html` at the top level would answer to
`/minibus-check/sunday.html` instead.

**`BUS_PAGE_URL`** in `Code.gs` must match wherever it actually sits. If the
site ever moves, change this too, or the menu will hand you a link to nowhere.

A 404 saying **"There isn't a GitHub Pages site here"** means the address is
wrong or the folder was never pushed. Pages serves only what is committed, so
having the file locally is not enough.

### If the link is ever abused

The address is not secret. Anyone who has it can see the stop times and add a
booking. They cannot read or change anybody else's, because a booking is tied
to the handle the phone that made it invented, and there are no names or
numbers on the page to read. The realistic worst case is somebody padding the
seat counts, which you would notice.

If it happens, set **`BUS_REQUIRE_CODE = true`** in `Code.gs`. The old gate
comes straight back: run **Minibus → Set the bus link secret** once, then
**Bus link for this Sunday** for the new address. You are back to posting a
link every week, so it is worth doing only if you need it.

### Why the secret is not in Code.gs

`.gs` files are served as plain text by GitHub, so anything written in this
file is readable by anyone who finds the repository. Worse, a secret committed
once stays in the commit history for good: deleting it later does not take it
back, and the only real fix is to change the secret.

A secret that was never in the file cannot be committed by accident, which is
why it lives in Script Properties instead. `COORDINATOR_EMAIL` can go there
too, under that name, and the value in the file will be ignored.

A `.gitignore` is included that keeps `Code.gs` and this file out of the
repository. Read the comments in it before changing anything: `config.js` is
committed on purpose, because GitHub Pages cannot serve what is not there, and
that means the endpoint, the token and the coordinator's mobile number are
public. The number is worth a thought. It is there so a driver with a stopped
bus can ring somebody, which is a good reason, but a separate number for the
purpose would be better than a personal mobile on a public page.

### Why the link has a code on the end

The driver app's token sits in `config.js` on a public host, so anyone who
views source has it. For vehicle checks that is tolerable: the worst case is
a made up inspection record. Bookings are not, because the same openness would
let a stranger wipe a Sunday's bookings.

So bookings ignore that token entirely. Each Sunday has its own code worked
out from the date and `BUS_LINK_SECRET`, which never leaves `Code.gs`. Last
week's link is dead. Nobody can work out next week's. Changing the secret
kills every link already sent, which is how you shut off one that has gone
somewhere you did not intend.

### Nothing fills this tab in by hand

There is no command that populates **Bus Bookings**. Rows appear only when a
passenger uses the link and taps Confirm. To see it working: set the secret,
get the link, open it on your own phone, pick a stop, confirm. A row appears,
and the count shows against that stop under **Stops and times** in the app.

Only **Status** is editable there, so you can strike out a booking if somebody
rings you after the cut-off. Everything else came from a passenger's phone.
The Device column especially: it is how their phone finds their own booking to
change it, so altering one silently detaches a person from the row they made.

### What is recorded, and what is not

The Bus Bookings tab holds the Sunday, the stop, and how many people are
boarding there. Nothing else.

No names. No phone numbers. The Device column is a random handle the
passenger's own phone made up so they can come back and change their booking,
and it identifies nobody. **Do not add a name column.** The driver needs to
know five people are waiting on Church Lane, not who they are, and everything
about this design assumes that.

### The app does not tell a driver to skip a stop

It shows the count, including "Nobody booked", and stops there. Somebody who
did not book still turns up: a dead phone, no phone, a visitor, or nobody
thought to tell them. A stop driven past leaves a person standing on a corner.
The count is there for the driver's judgement, not instead of it.

---

## The rota card

One card per Sunday. The date on the left, with **This Sunday** marked beside
it. Inside, one row per route, drawn identically: the driver's name and a
NORTH or SOUTH chip. Neither route is a heading and neither is a footnote.

Nothing marks an ordinary Sunday. The old PRIMARY badge said nothing, appeared
on almost every row, and implied a rank that does not exist among people
giving up their Sundays. What does appear, under a name, is a plain line when
something has moved:

- **Covering for Bro Adesina**, when somebody is standing in.
- **Swapped with Bro Moses**, when two Sundays were exchanged.

**All routes** and **My duties** sit at the top, and underneath them a line
says **Viewing as Bro Tunde**. The app never used to say who it thought you
were once you left the first screen, yet My duties depends on it entirely, and
phones get handed round. My duties shows the whole card with your own row
picked out, so you also see who you are driving alongside that morning.

---

## Swaps

A **cover** is one Sunday moving. Whoever says yes has driven an extra Sunday,
and if the same two people always say yes, that builds up quietly.

A **swap** is an exchange. Two Sundays move and both drivers end up having
driven the same number. Telling them apart is worth something every time a
request lands on your desk.

A swap request names the other driver, names which of their Sundays is being
taken, and carries a tick box confirming the two have already agreed between
themselves. All three are required. The Sunday picker only offers Sundays that
driver actually has coming up.

You still approve everything, and you can still say no. Set the Status to
Approved and both Sundays move at once, both cards show the swap, and both
drivers are emailed.

**What a swap will refuse**, with the reason written into a note on the Status
cell and shown as a message on screen:

- A Sunday that already has a cover. That Sunday has two people attached and
  a swap would make three, which nobody could untangle later.
- A Sunday somebody is only covering. That is not theirs to trade.
- Anything that would put one driver on both routes the same morning.
- A driver who has since come off that Sunday altogether.

These are checked when you approve, not when the request was sent, because a
request can sit for days and a Sunday can pick up a cover in between. If a
swap is refused, nothing is written at all: half a swap would leave no trace
of being half done.

Cross-route swaps are allowed, so a South driver may end up on North that
week. The pairing is recorded in the **Notes** column on both rows, which is
where the app reads it from, so the sheet and the app cannot disagree.
