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

`sw.js` has been bumped to `minibus-check-v17`. That is what tells every
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

## Still on your list

These are not faults in the app, but they were flagged in the original config
and are still outstanding:

- The **service, insurance and permit dates** in `config.js` are placeholders.
  The MOT dates are real, from the DVSA record. Replace the other three before
  drivers start trusting the renewal banner.
- The **gross weight of NH56 FWP** is unconfirmed. It decides the licence
  position: at or under 3,500kg the volunteer concession can apply to a car
  licence holder; above it, D1 is required. Confirm it from the V5C.
