# Minibus Check

**RCCG Dominion Assembly Liverpool**

A phone app for the pre-departure inspection of the church minibuses, with a
driving rota and a Sunday passenger booking page. Drivers sign in, pick a
vehicle, work through the checks, and the completed check is written straight
to a Google Sheet.

Plain HTML, CSS and JavaScript. No build step, no framework, no accounts.
Hosted on GitHub Pages, with Google Apps Script as the database.

---

## Before anything else: what is public

This repository is served to the internet. Every file in it is downloaded by
every phone that opens the app, so **treat the whole repository as a public
noticeboard**.

**Belongs here** — the app files, the driver register, vehicle registrations,
the endpoint address and the token. The app cannot run without them.

**Never here** — the spreadsheet address, personal email addresses, PINs, or
any note describing how a control could be got round.

**`Code.gs` does not belong here either.** It is pasted into the Apps Script
editor and lives there. No browser ever downloads it, so putting a copy in the
repository publishes the backend for nothing in return. Keep your copy with the
operations documents, outside the repository.

Two settings do the real work, and neither is in this repository:

| Setting | Should be |
|---|---|
| Apps Script deployment → Who has access | **Anyone** — passengers have no Google account |
| The spreadsheet → Share → General access | **Restricted** |

Those are not in conflict. The web app runs as you and writes on your behalf,
so the sheet stays shut while the app carries on working.

---

## How it hangs together

```
  phone  ──►  GitHub Pages  ──►  Apps Script  ──►  Google Sheet
              (the app)          (the door)        (the record)
```

The app has no login. A driver picks their name from the register, keys a PIN,
and that name travels with the check to the sheet.

**Checks go straight to the sheet.** Nothing is kept on the phone as a record.
If the send fails, the check is held on that phone and retried as soon as the
connection returns, and the driver sees plainly whether it landed. Losing a
check is worse than delaying one. Drivers should not close the app while a
check is showing as held.

---

## Part 1 — Set up the record

1. Create a new Google Sheet. Name it something like `Minibus checks`.
2. **Share → General access → Restricted.**
3. **Extensions → Apps Script.** Delete whatever is in the editor and paste in
   your copy of `Code.gs`.
4. **Project Settings → Script Properties → Add script property:**

   | Property | Value |
   |---|---|
   | `COORDINATOR_EMAIL` | the address defect alerts should reach |

   Leave it unset and no emails are sent. It is set here rather than in the
   code so the address is never in a file.
5. Near the top of `Code.gs`, set `TOKEN` to a word of your own. It must match
   `token` in `config.js`.
6. **Deploy → New deployment → Web app.**
   - **Execute as:** Me
   - **Who has access:** Anyone
7. **Deploy**, then **Authorize access**. Google warns that the app is
   unverified; this is normal for your own scripts. Choose
   **Advanced → Go to (project name)**.
8. Copy the **Web app URL**. It ends in `/exec`.

The tabs create themselves as they are first needed.

> **After any later edit to `Code.gs`**, go to **Deploy → Manage deployments**,
> click the pencil, and set Version to **New version**. Saving the script does
> not update the live address.

Check it with **Minibus → Check scheduled emails**, which tells you which
address alerts are going to.

---

## Part 2 — Put the app online

1. Create a GitHub repository, for example `minibus-check`.
2. In `config.js`, paste your Web app URL into `endpoint` and set the same
   token.
3. Upload to the root of the repository:

   ```
   index.html
   config.js
   sw.js
   manifest.webmanifest
   README.md
   icon-192.png
   icon-512.png
   icon-512-maskable.png
   icon-driver-180.png
   icon-sunday-180.png
   icon-sunday-512.png
   logo.png
   sunday/index.html
   ```

   Not `Code.gs`. See the section above.
4. **Settings → Pages**, Source *Deploy from a branch*, branch `main`, folder
   `/ (root)`, **Save**.
5. After a minute the app is live at
   `https://YOUR-USERNAME.github.io/minibus-check/`, and the passenger page at
   the same address ending `/sunday/`.

If `endpoint` is left blank the app runs in **practice mode**: everything
works, nothing is sent, and it says so on screen. Useful for training.

---

## Part 3 — Onto the phones

- **Drivers:** send the main address. iPhone: open in Safari, Share, *Add to
  Home Screen*. Android: Chrome, three dots, *Install app*.
- **Passengers:** send the address ending `/sunday/` in the WhatsApp group.
  It is permanent — the page works out which Sunday it is and rolls over at
  the 09:30 cutoff.

---

## After any edit

Bump the version in **two places**, or phones keep the copy they already have:

```js
const CACHE = "minibus-check-v1.19.22";  // sw.js
var APP_VERSION = "v1.19.22";            // index.html
```

They must match. `APP_VERSION` is printed at the foot of the first screen, so
it is how you tell what a phone is actually running. A phone showing the old
number after a deploy has not taken the update.

---

## Adding or changing a vehicle

Everything vehicle-specific lives in `config.js`.

```js
{
  reg: "NH56 FWP",
  id: "nh56fwp",
  name: "Ford Transit",
  detail: "2007 · manual · 15 seats including driver",
  dates: { mot: "2027-04-28", service: "", insurance: "", permit: "" },
  watch: { corrosion: "What to look at, and what to do about it." },
  skip: ["adblue"]
}
```

- **`watch`** adds the amber note to a check item. Keys must match item ids.
  This is what makes the app worth more than a paper sheet: a driver checks
  harder when told what to look for. Write the **instruction** here. The
  reasons live in the fleet history document, which is not in this repository.
- **`skip`** removes items the vehicle does not have — AdBlue on a pre-2015
  diesel.
- **`override`** rewrites the wording of a check for one vehicle. Use it when
  the vehicle has the thing in a different form; use `skip` only when it has
  none at all. A check describing hardware a bus does not have teaches drivers
  the list is approximate, and that habit spreads to the items that count.
- **`dates`** drives the renewal banner. Amber within 30 days, red past it.
  Whatever is showing travels with the check into the sheet, so a renewal
  cannot quietly pass while checks carry on being filed.

### Check item ids

The ids as the app has them. **A key that matches nothing does nothing, and
says nothing** — no warning, no error, just an amber note that never appears —
so copy them from here rather than from memory.

Pre-drive, which every driver sees:

`keys`, `tyres`, `nuts`, `lights`, `fbrake`, `doors`, `body`, `clean`,
`under`, `pipes`, `suspension`, `exhaust`, `fuel`, `oil`, `coolant`,
`bfluid`, `wash`, `adblue`, `battery`, `belts_seat`, `anchor`, `step`,
`exits`, `gangway`, `intlights`, `extinguisher`, `firstaid`, `abs`, `lamps`,
`brakes`, `steering`, `clutch`, `reverse_aid`, `mirrors`, `cab`

Full inspection only, which is the coordinator's list:

`spare`, `corrosion`, `pas`, `belts`, `wheelchair`, `cabin`, `limiter`,
`infotainment`, `docs`

**A `watch` note pulls a full-only item into the pre-drive list for that
vehicle.** NH56's rust history sits on `corrosion`, which is otherwise the
coordinator's item, and the most important thing known about a bus should not
be invisible to the man driving it. So a `watch` key from the second list is
not a mistake — it is how you put that item in front of every driver of that
one bus.

Safety critical, which stop the bus when a defect is recorded: `tyres`,
`nuts`, `fbrake`, `doors`, `pipes`, `bfluid`, `belts_seat`, `anchor`,
`exits`, `abs`, `brakes`, `steering`.

To change the checks themselves, edit the `STAGES` array in `index.html`.
Adding `crit: true` makes an item stop the bus; adding `full: true` keeps it
off the pre-drive list. **Anything added, removed or renamed there belongs in
the three lists above on the same pass**, or the next person writing a `watch`
note is working from a list that has quietly stopped being true.

---

## The driver register

`CONFIG.drivers` in `config.js` is everyone the leadership has authorised. The
app shows it as a dropdown and there is no way round it.

**Selecting a name is the authorisation check.** Only you can edit the list, so
appearing in it means approved. There is deliberately no way to type a name in,
because that would reopen the door the register exists to close. If a name is
missing, the app tells the driver to ring the coordinator.

**Add newly approved drivers before their first Sunday** — one line and a push.
**Removing someone removes them everywhere** at the next refresh.

The rota also reads the Drivers tab in the spreadsheet, so add new people to
both.

### PINs

`requirePin: true` asks each driver for a four digit PIN before a check.

Set PINs in the **PIN column of the Drivers tab**, never in `config.js`. The
PIN does not leave the spreadsheet; the app is sent a one way fingerprint and
compares that.

The Drivers tab also carries a **Phone** column, added for a WhatsApp button
on the passenger page that was then decided against. **Leave it empty.** Empty
means no button and one extra sheet read, and nothing else. Filling it would
publish that driver's number on a page with no login.

This exists so a driver cannot casually sign as somebody else. It is an
attribution control, not a login. Real authentication would mean Google
Sign-In, which needs every driver to have an account and a signal at seven on a
January morning, against a bus parked on a street.

A driver with no PIN set is not asked for one, so adding somebody never locks
them out.

---

## What the app will not let a driver do

Three things are blocked rather than warned about, because a warning that can
be swiped past is not a control.

**Skip a check.** Next stays dead until every item in the stage is answered.

**Log a defect with no description.** "Brakes" is useless to a garage; "pulls
left under braking" is a work instruction. The footer names which item is
still missing its note.

**Enter impossible mileage.** The app knows the last reading for that vehicle.
A lower figure, or a jump over 1,500 miles, stops the check and asks the driver
to read the dashboard again. They can proceed by ticking a confirmation, and
the record is marked in a **Mileage flag** column. An odometer that genuinely
goes backwards means a swapped cluster or a clocked vehicle, which you want to
know about.

---

## The Defects sheet

Every defect gets its own row, separate from the check it came from, so you can
work a list rather than read through clear checks looking for problems.

| Column | Filled by |
|---|---|
| Received, Check ID, Date, Registration, Driver, Item, Critical, What the driver found | The app |
| **Status** | You, from a dropdown |
| **Action taken**, **Closed on** | You, by hand |

Status has six options — **Open**, **Booked in**, **Parts on order**,
**Fixed**, **Monitoring**, **Not a defect** — each colouring its cell, so you
can see the state of both buses by glancing down one column.

**Closed on** keeps the record coherent: a real date, never in the future,
never before the defect was reported. Set Status to Fixed and today's date
appears; set it back to Open and it clears.

Change the options by editing `STATUS_OPTIONS` in `Code.gs`, then run
`addDropdownToExistingSheet` once from the editor.

---

## Rota, bookings and the Sunday run

- The **spreadsheet is the only place the rota is administered.** There is no
  admin screen in the app.
- Drivers can request a change from their phone; only the coordinator alters
  the official rota.
- The **passenger page** stores no names or numbers — only a stop, a headcount,
  and a random handle the phone made up so someone can change their own
  booking.
- **Bookings close 09:30.** After that the driver sees Start trip, picks the
  bus he is taking, and taps each stop as he pulls away.
- A stop, once confirmed, is settled for that Sunday. A change of mind is
  handled by **Not coming**, then booking again.

### After the 09:30 cutoff

Withdrawing is the one thing a passenger can still do. Booking, moving stop
and changing the number are all refused — by the screen and by the script, so
a stale tab cannot get round it.

Withdrawing is asked before it happens, on both sides of the cutoff, because
after it there is no booking again that day. The wording differs by side: the
consequence does.

The row's Status stays exactly **Cancelled**, never a status of its own. The
sheet drops that one word and counts everything else as booked, so a tidier
"Cancelled late" would leave the seat on the driver's screen. The lateness
goes in a note on the cell instead.

It is refused once the run is over, so the record cannot be rewritten to
disagree with the list the driver actually worked from.

### Which bus, and only one route at a time

Starting a run names the bus. **A bus already out on another route is not
offered to the second driver** — the record knows which one is out, so
offering it invites one registration onto two routes at once. If they swapped
at the gate, the driver who started corrects his own run; the other does not
fix it by duplicating it.

If filtering would leave no bus at all, every bus comes back. A driver who
cannot start is worse than a duplicate.

### While a run is live

There is no **Done** on the Stops screen. The only way off is **End trip,
arrived at church**, so the screen the run is recorded on cannot be closed by
a slip of the thumb.

Every tap is stamped with the run it belongs to and sends under that run's
own name, so a phone that does two routes in a morning — which is really only
a rehearsal — files them as two runs rather than folding the first into the
second.

Tapping a stop that already holds the same answer sends nothing. A driver who
presses again because he is not sure cannot make two rows.

Taps are greyed while the bus is moving, and that test needs a few seconds of
sustained speed either way. A single noisy GPS sample cannot flicker the
buttons any more.

---

## Things to know

**The token is a name tag, not a lock.** It is in `config.js`, which every
phone downloads. It keeps stray traffic out. Keep the spreadsheet Restricted
and the token stays sufficient. If junk ever appears in the sheet, change it in
`Code.gs` and `config.js`, redeploy, and the old one stops working.

**Duplicates are handled.** Every check carries an id and the script refuses to
write the same id twice, so a phone retrying after a failure cannot double up.

**Export for the folder.** Download the sheet every few months. A cloud sheet
is not a substitute for a record you still hold if the account goes away.

**Mileage comes from the record, not the config.** The app asks the sheet for
the last reading against each vehicle and shows who entered it and how far the
bus has gone since. Nothing about mileage is hardcoded, so nothing about it
goes stale.

**Keep the paper sheet in the glovebox.** Flat battery, forgotten phone, or a
driver who prefers paper. The app should reduce the pad, not become a single
point of failure.

---

Built for internal church use. Not a substitute for a competent person's
inspection or the annual MOT.
