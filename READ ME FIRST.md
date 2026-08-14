# Minibus transport — complete set

**RCCG Dominion Assembly Liverpool**

> **This document does not go in the repository.** Keep it with the operations
> documents. It describes the whole setup, including the parts that are
> deliberately not published.

---

## What lives where

```
NOT in the repository — keep these with the operations documents
  READ_ME_FIRST.md                    this file
  PLAN.md                             the working plan
  FLEET-HISTORY.md                    why each check says what it says
  Code.gs                             pasted into Apps Script, never published
  Minibus_Operations_Pack.docx        coordinator's document, both vehicles
  Check_Sheet_YS70PWE.docx            printed backup sheet, 2 pages
  Check_Sheet_NH56FWP.docx            printed backup sheet, 2 pages

IN the repository — everything a browser downloads
  index.html                          the driver app
  config.js                           drivers, vehicles, dates, endpoint
  sw.js                               offline cache
  manifest.webmanifest                home screen install
  README.md                           setup and maintenance
  sunday/index.html                   the passenger booking page
  logo.png  icon-192.png  icon-512.png  icon-512-maskable.png
  icon-driver-180.png  icon-sunday-180.png  icon-sunday-512.png
```

The dividing line is simple: **if a phone downloads it, it is public.** A
browser never asks for `Code.gs`, so publishing it gives away the backend for
nothing in return.

---

## The two settings that matter

Neither is in any file, and they are the ones that actually protect the record.

| Where | Setting | Should be |
|---|---|---|
| Apps Script → Deploy → Manage deployments | Who has access | **Anyone** |
| The spreadsheet → Share | General access | **Restricted** |

They are not in conflict. The web app executes as you and writes on your
behalf, so passengers with no Google account can book while the sheet itself
stays shut.

---

## Where the private values live

Nothing personal is written into a file. Set these in the Apps Script editor
under **Project Settings → Script Properties**:

| Property | What it is |
|---|---|
| `COORDINATOR_EMAIL` | where defect and stopped-bus alerts are sent |
| `SHEET_URL` | optional. The script normally finds its own sheet |

`Minibus → Check scheduled emails` tells you which address is in use and warns
you if none is set.

The coordinator's **name and phone number** are in `config.js` on purpose, so a
driver with a stopped bus and a passenger left at a kerb can ring somebody with
one tap. That is a published number, and it should be one you are content to
have published.

---

## Order of work for a fresh setup

1. **Read** the operations pack. Section C is the outstanding work.
2. **Print** both check sheets double sided. A dozen of each, one pile per
   glovebox.
3. **Set up the record.** New Google Sheet → set Share to Restricted →
   Extensions → Apps Script → paste `Code.gs` → set `COORDINATOR_EMAIL` in
   Script Properties → set `TOKEN` → Deploy as Web app, Execute as **Me**, Who
   has access **Anyone** → copy the `/exec` address.
4. **Edit `config.js`**: paste that address into `endpoint`, and set `token` to
   the same word as `TOKEN`.
5. **Push the repository files** listed above. Not `Code.gs`. Turn on Pages.
6. **Test it yourself before Sunday.** One full check on your own phone, and
   confirm a row lands in the sheet. Then one passenger booking.
7. **Then** send the two links out — the main address to the drivers, the one
   ending `/sunday/` to the WhatsApp group.

Full detail for steps 3 to 5 is in `README.md`.

---

## After any change to the app

Bump the version in **both** files and keep them equal:

```js
const CACHE = "minibus-check-v1.19.7";   // sw.js
var APP_VERSION = "v1.19.7";             // index.html
```

`APP_VERSION` shows at the foot of the first screen. It is how you tell what a
phone is actually running, so it is worth a moment to get right — a phone still
showing the old number has not taken the update.

## After any change to Code.gs

**Deploy → Manage deployments → pencil → Version: New version.** Saving the
script alone does not change anything at the `/exec` address.

---

## Standing rules

- **Nothing changes after Saturday evening.** A fix that lands untested on
  Saturday night is worse than the fault it was meant to cure.
- **The spreadsheet is the only place the rota is administered.** No admin
  screen in the app, by decision.
- **Write the instruction in `config.js`, the reason in `FLEET-HISTORY.md`.**
  A driver at eight on a Sunday morning needs to know what to look at and what
  to do about it. The history is for whoever books the bus into a garage, which
  is a different person doing a different job, sitting down.
