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

`sw.js` has been bumped to `minibus-check-v23`. That is what tells every
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

| Name | Role | Active | Primary order | Backup pool |
|---|---|---|---|---|
| Bro Adebola | Driver | YES | 1 | |
| Bro Abiodun | Driver | YES | 2 | |
| Bro Moses | Driver | YES | 3 | |
| Bro Asim | Coordinator | YES | 4 | |
| Pst Kehinde | Minister in Charge | YES | | YES |
| Bro Calvin | Backup | YES | | YES |
| Bro Tunde | Backup | YES | | YES |

- **To add someone to the normal rotation:** give them the next number.
- **To add someone as assistance only:** leave Primary order blank, put YES
  in Backup pool.
- **To stop someone driving:** set Active to NO. They vanish from every
  dropdown and from the app. Sundays they already drove are left alone.
- After any change here, run **Minibus → Refresh dropdowns from Drivers tab**.

Anyone marked Active can be picked to cover a Sunday, backups included.
"Backup" describes their normal role, not a limit on what they can do.

**Two registers, keep them in step.** The Drivers tab feeds the rota. The
`drivers:` list in `config.js` feeds the driver-name dropdown on the check
screen. Add a new person to both.

---

## Two buses

The Rota tab already has **Bus 2 scheduled** and **Bus 2 actual / cover**
columns, sitting empty. Start filling them in whenever you begin running both
buses on the same Sunday, and the app will show them. Nothing needs rebuilding.

---

## Things worth knowing

**The Rota tab is filled about 18 months ahead.** Sundays past that still show
in the app, worked out from the pattern. They get written down as the horizon
rolls forward. If you want to set something further out than that, just type
the date into a new row on the Rota tab — the app will pick it up. Or use
**Minibus → Extend rota further ahead**.

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

There are two lists, built from one set of 48 items.

**Pre-drive — 32 items.** What every driver does before carrying anyone. All
12 critical items are in it. This is the only list most drivers ever see, and
they are not shown a choice.

**Full inspection — 48 items.** The pre-drive list plus the slower structural
and equipment checks: corrosion, seat and handrail condition, battery, spare
wheel, wheelchair restraints, documents. This is coordinator work.

Who gets the choice is set by `fullInspectionRoles` in `config.js`, matched
against the role in the driver register. It is currently Coordinator and
Minister in Charge. The choice appears on the mileage screen. Switching type
clears any answers already given, because the two lists are different.

Every check records which type it was, in the **Check type** column.

### The three answers

Each item has **Fine**, **Defect**, and **Not on this bus**.

That third one means **not applicable** — this bus genuinely does not have the
thing. A wheelchair ramp on a bus with none. A speed limiter that was never
fitted. It counts as answered, never as a defect, and never stops the bus.

It does **not** mean "not available" or "I could not check it". If something is
fitted but the driver could not check it — the bonnet catch is jammed, the step
is buried under bags — that is a **Defect** with a note. The coordinator needs
to know, and burying it under N/A would hide a real problem behind something
that reads like a shrug.

A defect has to be described before the driver can move on. Not on this bus
does not. It is recorded in the **Not applicable** column of the Checks sheet,
so a gap in the record means an item was missed, not that it did not apply.

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

Two columns are new: **Not applicable** and **Check type**. They are added to
the right-hand end of the Checks sheet automatically on the next check, so
nothing already recorded moves.

## Renewal dates

| | YS70 PWE | NH56 FWP |
|---|---|---|
| MOT | 17 Jun 2027 | 28 Apr 2027 |
| Service | 17 Jun 2027 | 1 Jul 2027 |
| Insurance | 26 Jun 2027 | 8 Jul 2027 |
| Parking permit | 31 Jan 2027 | 31 Jan 2027 |

Within 30 days shows amber, past shows red. Nothing shows today. The first is
**1 January 2027**, when both parking permits go amber.
