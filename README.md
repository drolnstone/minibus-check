# Minibus Check

**RCCG Dominion Assembly Liverpool**

A phone app for the pre-departure inspection of the church minibuses. Drivers sign in, pick a vehicle, work through the checks, and the completed check is written straight to a Google Sheet.

Plain HTML, CSS and JavaScript. No build step, no framework, no accounts. Hosted free on GitHub Pages, with Google Apps Script as the database.

**Vehicles:** YS70 PWE (Ford Transit 460, 2020) and NH56 FWP (Ford Transit, 2007). Both manual.

---

## How it hangs together

```
  phone  ──►  GitHub Pages  ──►  Apps Script  ──►  Google Sheet
              (the app)          (the door)        (the record)
```

The app has no login and stores no personal data. A driver types their name, and that name travels with the check to the sheet.

**Checks go straight to the sheet.** Nothing is kept on the phone as a record.

**Except when there is no signal.** If the send fails, the check is held on that phone and retried automatically as soon as the connection returns. The driver sees plainly whether it landed. This is deliberate: the alternative to holding a failed check is losing it, which is worse than a delayed one. Drivers should not close the app while a check is showing as held.

---

## Part 1 — Set up the record

1. Create a new Google Sheet. Name it something like `Minibus checks`.
2. In that sheet, go to **Extensions → Apps Script**.
3. Delete whatever is in the editor and paste in the contents of `apps-script/Code.gs`.
4. Near the top, change two lines:

   ```js
   var TOKEN = "dominion-minibus";     // pick your own word
   var COORDINATOR_EMAIL = "";         // your email, for defect alerts
   ```

   Leave `COORDINATOR_EMAIL` blank if you do not want emails. With it filled in, you get an email every time a defect is reported, and a differently worded one whenever a bus is stopped.

5. Click **Deploy → New deployment**.
6. Click the gear icon and choose **Web app**.
7. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
8. Click **Deploy**, then **Authorize access** and approve the permissions. Google will warn you that the app is unverified; this is normal for your own scripts. Choose **Advanced → Go to (project name)**.
9. Copy the **Web app URL**. It ends in `/exec`.

The two sheets, `Checks` and `Defects`, create themselves the first time a check arrives.

> **Whenever you edit Code.gs afterwards**, you must go to **Deploy → Manage deployments**, click the pencil, and set Version to **New version**. Just saving the script does not update the live web app.

---

## Part 2 — Put the app online

1. Create a new GitHub repository, for example `minibus-check`.
2. Open `config.js` and paste your Web app URL in, and set the same token:

   ```js
   endpoint: "https://script.google.com/macros/s/AKfy..../exec",
   token: "dominion-minibus",
   coordinator: { name: "Asim Bassey", phone: "07..." }
   ```

3. Upload these files to the root of the repository:

   ```
   index.html
   config.js
   sw.js
   manifest.webmanifest
   icon-192.png
   icon-512.png
   icon-512-maskable.png
   README.md
   apps-script/Code.gs
   ```

4. Go to **Settings → Pages**, set **Source** to *Deploy from a branch*, branch `main`, folder `/ (root)`, and **Save**.
5. After a minute the app is live at `https://YOUR-USERNAME.github.io/minibus-check/`.

If `endpoint` is left blank, the app runs in **practice mode**: everything works, nothing is sent, and it says so on screen. Useful for training drivers.

---

## Part 3 — Onto the drivers' phones

Send the link and ask them to install it, so it opens like a normal app with no browser bar.

- **iPhone:** open in Safari, tap Share, then *Add to Home Screen*.
- **Android:** open in Chrome, tap the three dots, then *Install app*.

---

## Adding or changing a vehicle

Everything vehicle-specific lives in `config.js`. Nothing else needs touching.

```js
{
  reg: "NH56 FWP",
  id: "nh56fwp",
  name: "Ford Transit",
  detail: "2007 · white · manual · 53,280 miles",
  dates: {
    mot:       "2027-04-28",
    service:   "",
    insurance: "",
    permit:    ""
  },
  watch: {
    corrosion: "Why this item matters on this particular vehicle."
  },
  skip: ["adblue"]
}
```

- **`watch`** adds the amber "known history" note to a check item. The keys must match item ids in the checklist (see below). This is what makes the app worth more than a paper sheet: a driver checks harder when told why.
- **`skip`** removes items that do not apply, for example AdBlue on a pre-2015 diesel.
- **`dates`** drives the renewal banner (see below).
- **`override`** rewrites the name or wording of a check for one vehicle only.

### skip or override?

Use **`skip`** when the vehicle does not have the thing at all. NH56 FWP skips `adblue` because a 2007 diesel has none.

Use **`override`** when it has the thing in a different form. Both buses have a step, but YS70 has a powered retractable one and NH56 has a fixed rear step you walk straight past into the side door. Same check id, different words:

```js
override: {
  step: {
    name: "Rear step and door thresholds",
    what: "Fixed rear step secure, not loose or lifting at the edge..."
  }
}
```

This matters more than it looks. A check describing hardware the bus does not have teaches drivers that the list is approximate, and that habit spreads to the items that count. If wording does not fit a vehicle, override it rather than leaving it generic.

### Check item ids

`tyres`, `nuts`, `lights`, `fbrake`, `body`, `corrosion`, `under`, `pipes`, `suspension`, `exhaust`, `plates`, `oil`, `coolant`, `bfluid`, `wash`, `adblue`, `belts`, `belts_seat`, `anchor`, `step`, `exits`, `gangway`, `extinguisher`, `firstaid`, `cabin`, `abs`, `lamps`, `brakes`, `steering`, `clutch`, `mirrors`, `cab`

The safety critical ones, which stop the bus when a defect is recorded, are: `tyres`, `nuts`, `fbrake`, `pipes`, `bfluid`, `belts_seat`, `anchor`, `exits`, `abs`, `brakes`, `steering`.

To change the checks themselves, edit the `STAGES` array near the top of the script block in `index.html`. Adding `crit: true` to an item makes it stop the bus.

---

## The driver register

`CONFIG.drivers` in `config.js` is the list of everyone the leadership has authorised. The app shows it as a dropdown, and there is no way round it.

```js
drivers: [
  { name: "Pst Kehinde", role: "Minister in Charge" },
  { name: "Bro Adebola", role: "Driver" },
  { name: "Bro Calvin",  role: "Backup" }
]
```

The role appears beside the name in the dropdown and goes into its own column in the sheet, so you can see at a glance whether the regular drivers are carrying the rota or whether the backups have been covering week after week.

**Selecting a name from the list is the authorisation check.** Only you can edit the list, so appearing in it means approved. There is no separate "are you authorised?" tick, because it would be asking a question the list has already answered.

**Newly approved drivers must be added here before their first Sunday.** It is a one-line edit and a push. There is deliberately no way for someone to type their own name in, because that would reopen the door the register exists to close. If a name is missing, the app tells the driver to ring the coordinator.

**Removing someone removes them everywhere.** Delete the line, push, and they are gone from every phone at the next refresh.

If you leave `drivers` empty, the app falls back to a plain name field.

### On PINs and passwords

`requirePin: false` is the default. Turn it on and any driver with a `pin` set must key it in.

```js
requirePin: true,
drivers: [
  { name: "Bro Moses", role: "Driver", pin: "4417" }
]
```

Understand what this is before switching it on. The app is static files served from GitHub Pages, so the PINs sit in the page source and anyone who looks can read them. It stops one driver casually picking another's name. It is not security and will not stop anyone determined.

Full usernames and passwords are not worth it here, for three reasons. They cannot be done properly without a login server, so any version built into these files would look like security without being it. There is no adversary: nobody gains from falsifying a minibus check. And the realistic failure is not impersonation but a driver ticking boxes without walking round the bus, which no password prevents. Meanwhile a forgotten password at seven on a January morning is a certainty, not a risk.

If you ever do need real authentication, the honest route is Google Sign-In through the Apps Script with access limited to named accounts. That needs every driver to have a Google account and a signal when they sign in, which is a genuine trade against a bus parked on a street.

---

## What the app will not let a driver do

Three things are blocked rather than merely warned about, because a warning that can be swiped past is not a control.

**Skip a check.** The Next button stays disabled until every item in the stage has been answered.

**Log a defect with no description.** If a driver taps Defect, the stage will not advance until they have written at least a few words. "Brakes" as a bare word is useless to a garage; "pulls left under braking" is a work instruction. The footer names which item is still missing its note.

**Enter impossible mileage.** The app knows the last reading for that vehicle. A lower figure, or a jump of more than 1,500 miles, stops the check and asks the driver to read the dashboard again. They can still proceed if the odometer really does say that, by ticking a confirmation, and the record is then marked in a **Mileage flag** column so you can look into it. An odometer that genuinely goes backwards means a swapped instrument cluster or a clocked vehicle, which you want to know about.

---

## The Defects sheet

Every defect a driver reports gets its own row, separate from the check it came from, so you can work a list rather than read through clear checks looking for problems.

| Column | Filled by |
|---|---|
| Received, Check ID, Date, Registration, Driver, Item, Critical, What the driver found | The app |
| **Status** | You, from a dropdown |
| **Action taken**, **Closed on** | You, by hand |

The Status column is a dropdown with six options: **Open**, **Booked in**, **Parts on order**, **Fixed**, **Monitoring**, **Not a defect**. Each colours its cell, so open defects sit red, in-progress ones amber and closed ones green. You can see the state of both buses by glancing down one column.

### Closing dates

**Closed on** has rules, so the record stays coherent:

- It must be a real date, entered as dd/mm/yyyy.
- It cannot be in the future. A defect is not fixed tomorrow.
- It cannot be before the defect was reported. If you try, the cell turns red and explains why.

It also keeps itself in step with Status. Set Status to **Fixed** or **Not a defect** and today's date appears automatically. Set it back to Open and the date clears. Type a closing date against a row still marked Open and the Status moves to Fixed for you.

Change the options by editing `STATUS_OPTIONS` near the top of `Code.gs`, then run `addDropdownToExistingSheet` once from the editor to push the change onto rows that already exist.

**If you already have a Defects sheet** from an earlier version, it has fewer columns and no dropdown. Either delete the tab and let it rebuild on the next defect, or add the two missing headers and run `addDropdownToExistingSheet` from the Apps Script editor.

---

## Renewal reminders

Each vehicle has a `dates` block:

```js
dates: {
  mot:       "2027-04-28",
  service:   "2026-11-15",
  insurance: "2027-01-31",
  permit:    "2026-09-30"
}
```

Dates are `YYYY-MM-DD`. Leave any of them as `""` and that item is simply not tracked.

- Within **30 days**: an amber banner appears on the vehicle screen and pulses gently, and the vehicle card carries a "Renewal due soon" chip.
- **Past the date**: the banner turns red and says overdue.

Whatever is showing also travels with the check into the **Renewals due** column in the sheet, so a renewal cannot quietly pass while checks carry on being filed.

Update the date as soon as you renew something. The banner is only useful while drivers trust it, and a banner that has been showing for six weeks is wallpaper.

**The MOT dates supplied are real.** The service, insurance and parking permit dates are placeholders, set deliberately close so you can see both banner states working before you go live. Replace all six with the true dates.

## After any edit

Bump the version in `sw.js`, or phones will keep serving the copy they already have:

```js
const CACHE = "minibus-check-v10";   // v4, v5 and so on
```

---

## Things to know

**The endpoint URL is in a public file.** `config.js` sits in a public repo, so anyone who finds it has the URL and the token and could write rows to the sheet. Nothing can be read back except the last mileage figure. If junk ever appears, change the token in both files and redeploy, and the old URL stops working.

**The token is a lock, not a safe.** It is visible in the page source, so treat it as protection against stray traffic rather than a determined person. Keep the spreadsheet itself private, and share it only with the people who need it.

**Duplicates are handled.** Every check carries an id, and the script refuses to write the same id twice, so a phone retrying after a failure cannot create a double entry.

**Export for the folder.** Download the sheet as a spreadsheet every few months for the vehicle records. A cloud sheet is not a substitute for a record you still hold if the account goes away.

**Mileage comes from the record, not the config.** When the app opens it asks the sheet for the last mileage logged against each vehicle, and shows it under the mileage field along with who entered it and how far the bus has gone since. Enter something lower than last time and it says so in red. With no signal it falls back to the last figure that phone saw. Nothing about mileage is hardcoded, so nothing about it goes stale.

**Keep the paper sheet in the glovebox.** Flat battery, forgotten phone, or a driver who prefers paper. The app should reduce the pad, not become a single point of failure.

---

Built for internal church use. Not a substitute for a competent person's inspection or the annual MOT.
