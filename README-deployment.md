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

### 3. Upload the three web files

Replace `index.html`, `config.js` and `sw.js` on your host.

`sw.js` has been bumped to `minibus-check-v44`. That is what tells every phone
to throw away its old copy. If you ever edit `index.html` or `config.js`
again, bump that number, and bump `APP_VERSION` in `index.html` to match.

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
1. A blank Route counts as North, so rows written before the South route
started keep working untouched.

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
