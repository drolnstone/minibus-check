# Minibus check + driving rota — deployment and handover

Four files make up the app. Three live on the web host, one lives inside the
Google Sheet.

| File | Where it goes |
|---|---|
| `index.html` | web host, alongside your existing files |
| `config.js` | web host |
| `sw.js` | web host |
| `Code.gs` | Google Sheet → Extensions → Apps Script |

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

`sw.js` has been bumped to `minibus-check-v32`. That is what tells every
phone to throw away its old copy. If you ever edit `index.html` or
`config.js` again, bump that number again or phones will keep the old app.

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
**Bus 1 actual / cover**. No request needed.

**Never delete the scheduled name.** That is how you keep sight of whose
Sunday it was and who actually covered it.

---

## The four things a future coordinator needs to know

1. Drivers ask for changes in the app. You decide.
2. You change the official rota in Google Sheets, never in the app.
3. To cover one Sunday, fill in **Bus 1 actual / cover**. Leave **Bus 1
   scheduled** alone.
4. To change who is normally on that slot for good, edit **Bus 1 scheduled**.

---

## The repeating pattern

Sundays repeat in this order, for ever:

**Bro Adebola → Bro Abiodun → Bro Moses → Bro Asim → back to Adebola**

Counted from Sunday **2 August 2026**.

A one-off cover does **not** shift the pattern. If Asim is away on 11 October
and Moses covers, the next Asim Sunday is still Asim.

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
code file and re-uploading it. Four columns:

- **Name** — what appears in the app.
- **Role** — decides who is offered the full inspection.
- **Active** — NO removes them from every dropdown and every phone.
- **Primary order** — 1, 2, 3, 4 sets the repeating pattern. Blank means they
  are not in the normal rotation but can still cover.

The old **Backup pool** column has been dropped. Nothing read it. If your
sheet still has it, delete column E by hand or leave it: it is ignored either
way.

## Why there are two rota tabs

**Rota Requests** is what drivers asked for. **Rota** is what is actually
happening. You need both, because most changes will never have a request
behind them — you find out on Friday that somebody cannot make Sunday, and you
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
**Accuracy (m)**, **Distance from base (m)**, **Location note**. The location
also appears in defect and bus-stopped emails.

### Where the buses are kept

`busBase` in `config.js` is set to the centre of **L6 4DY**, the postcode for
3-5 Chester Road, with a 250 m radius.

That is the postcode centre, not the exact parking spot, so it may be fifty
metres or so out. The radius covers that.

**Worth replacing once.** Do a check standing at the bus, read the **Where
checked** cell off the Checks tab, and put those two numbers into `busBase`
instead. That pins it to the actual spot, and it pins it using the same
satellites the drivers' phones use, which matters more than the map being
right. After that you can bring the radius down to about 150 m.

```
busBase: { lat: 53.425024, lng: -2.937394, radius: 250 },
```

A check done away from that point records the distance, and the driver sees it
on screen before they start. It is never treated as an accusation: the app
only calls a check "away" when the phone's own accuracy figure leaves no
doubt, so a poor fix in a built-up area never flags anyone wrongly.

To switch the whole thing off, set `recordLocation: false`.

## Two buses

The Rota tab already has **Bus 2 scheduled** and **Bus 2 actual / cover**
columns, sitting empty. Start filling them in whenever you begin running both
buses on the same Sunday, and the app will show them. Nothing needs rebuilding.

---

## Things worth knowing

**Statuses on the Rota tab:** Confirmed, Change requested, Covered,
Cancelled/declined, No driver assigned. The last one goes red, so an empty
Sunday cannot quietly look normal.

**The PIN is off.** `requirePin: false` in `config.js`. Turn it on by setting
it to `true` and adding `pin: "1234"` to a driver. Be clear about what it is:
the app is static files, so anyone who views the page source can read the
PINs. It stops one driver casually picking another's name. It is not
security. The real boundary is who you share the spreadsheet with.

**Emails** go to `COORDINATOR_EMAIL` at the top of `Code.gs`, currently
`asimbassey@yahoo.com`. Both defect emails and rota emails carry a button
that opens the spreadsheet **on the right tab** — defect emails land on
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

**Pre-drive — 33 items.** What every driver does before carrying anyone. All
12 critical items are in it. This is the only list most drivers ever see, and
they are not shown a choice.

**Full inspection — 49 items.** The pre-drive list plus the slower structural
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

That third one means **not applicable** — this bus genuinely does not have the
thing. A wheelchair ramp on a bus with none. A speed limiter that was never
fitted. It counts as answered, never as a defect, and never stops the bus.

It does **not** mean "not available" or "I could not check it". If something is
fitted but the driver could not check it — the bonnet catch is jammed, the step
is buried under bags — that is a **Defect** with a note. The coordinator needs
to know, and burying it under N/A would hide a real problem behind something
that reads like a shrug.

The pre-drive list is already cut to what each bus actually has, so nothing on
it can be "not on this bus" and the button is not shown there. The full
inspection reaches further, so it keeps it.

A defect has to be described before the driver can move on. Not on this bus
does not. It is recorded in the **Not applicable** column of the Checks sheet,
so a gap in the record means an item was missed, not that it did not apply.

## Fuel and things to arrange

**Fuel** is recorded on the mileage screen as eighths: eight segments, tap what
the gauge reads. Marked at the quarter, half, three quarters and full. Red up
to a quarter, amber at three eighths, green from half a tank up. It is
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
be **safe** — by then you are not booking a wash, you are dealing with a
problem. A bus can be perfectly fine to drive and still look poor for a
wedding, and nothing recorded that until now.

Both get their own column on the Checks sheet, and both appear in the Sunday
evening digest, which is where you would actually act on them.

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
