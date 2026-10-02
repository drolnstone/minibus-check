# Minibus apps: handover for a new Claude session

Written 2 October 2026, 21:35 UTC, from the Claude Project "Driver's manual completion".

## Paste this first

> I'm Asim (GitHub drolnstone). Please read HANDOVER.md in the repo drolnstone/minibus-check (or the copy I paste below) before doing anything. It explains my church minibus apps, what is live, what is pending, and how I like to work. Keep replies short: I read every line myself. Don't change anything in the apps until I ask. Right now I'm on a break, so don't start the Driver's Manual or the videos until I say I'm ready.

---

## 1. What this is

Three phone web apps for the Sunday minibus of RCCG Dominion Assembly, Liverpool, plus a Google Sheet and a small server.

| Part | Where in the repo | Live at |
|---|---|---|
| Driver app (walkaround check, rota, live stop list) | `index.html`, `sw.js`, `config.js` | https://drolnstone.github.io/minibus-check/ |
| Passenger page (book a seat, watch the bus) | `sunday/` | https://drolnstone.github.io/minibus-check/sunday/ |
| Coordinator app (rota, notes, requests, defects, drivers, buses, bus stops, Vehicle Log, bookings, trip times, authorise stopped buses, PDF reports) | `coord/` | https://drolnstone.github.io/minibus-check/coord/ |
| Fast server: Cloudflare Worker with D1 database `minibus` (bound as `DB`) | `server/worker.js`, `server/schema.sql` | https://minibus-api.asimbassey.workers.dev |
| Sheet code: Google Apps Script bound to the Google Sheet (Europe/London), deployed as the web app the Worker calls (URL ends `…1XxMSA`, full URL in `config.js`) | `Code.gs` (repo root) | script.google.com |
| Driver's Manual PDF builder | `manual/` | |
| Doodle video scripts | `video/` | |
| Deploy notes, one per release | `analysis/DEPLOY-*.txt`, latest also in `DEPLOY.txt` | |
| Tests | `tests/run-tests.mjs`, `tests/suites/` | GitHub Actions, run on London time |

Project shared files (Claude Project only): `samples/typing-box-samples.md` lists every typing box's "e.g." sample.

**How the parts talk.** The sheet is the record; if the two servers disagree, the sheet is right. The Worker owns what happens during a Sunday (bookings, stop taps, walkarounds, authorisations, coordinator app changes) and sends the alerts. When a phone does something, the server knocks on the web app (gives up after 25 seconds), and a 5-minute collection picks up the rest. The ✗ about the last knock stays until the next knock works. "Waiting to come back: nothing" means nothing is stuck. Only edits on the Rota, Drivers, Buses, Bus Stops, Requests, Defects and Bus Bookings tabs reach the server. Times typed on Trip Events don't (use the coordinator app's Fix). Threads can't reach script.google.com, so Asim checks the web app himself. The README has the full design.

## 2. What's live, and what's pending

**Code on main (checked in the repo):** app v1.95.2 · server w2.37.0 · sheet v1.101.0.

**Last confirmed live by Asim (18:17 UTC, health check all ✓):** app v1.95.0 · server w2.37.0 · sheet v1.100.0. Pages from #31 and #32 are published by the merge (app v1.95.2).

**Pending for #32 (Final touches, merged about 20:56 UTC). Asim's to do:**
1. Paste the whole Code.gs from main into the Apps Script editor and save: https://raw.githubusercontent.com/drolnstone/minibus-check/main/Code.gs (the deploy note's link names the old branch, which may be gone; main has the same file).
2. Deploy, Manage deployments, the pencil, Version: New version, Deploy.
3. No Worker paste.
4. Check that the foot of all three apps reads **app v1.95.2 · server w2.37.0 · sheet v1.101.0**. If a phone still shows an older app version, close the app and open it again.

**Asim's own to-dos:**
- Add more addresses to COORDINATOR_EMAIL, if wanted (Script properties in Apps Script).
- Delete old branches but keep main. (On 2 October at 21:30 UTC the repo showed only `main` and this handover branch, so this may already be done.)

**Offered, not asked for:** show the sheet ✗ only while something is actually waiting.

## 3. What comes next (agreed by Asim on 2 October)

1. Finish #32's paste and check (above).
2. **A break.**
3. **The Driver's Manual and doodle videos**, as one PR, brought up to date with the latest versions. **Only when Asim says he's ready.** On 2 October he said "Please dont. I'm not ready for that yet." Never start them on your own. Specifics:
   - Driver manual: the Driver name, the logo landing, the bar, no "Signed in as", the chosen bus card, and the notification title.
   - Coordinator manual: the logo sign-in and a Buses screen page.
   - Video clip 1 needs a new iPhone scene ("new caption and picture, re-render clip 1").
   - Plus everything since #18: Run record, grouped defects, the coordinator screens (Defects, Drivers, Buses, Rota notes, Bus stops), "e.g." samples, MOT and insurance stops and the MOT run, renewals, PDF reports, summary emails.
4. **Attachments later**, as future development: certificates and invoices saved to Drive; defect photos (the driver adds one when reporting a defect, not on every check item); later, driver licence and MiDAS records.

There is no quarterly email: the app makes a PDF for any period.

## 4. Release process

- Merging a PR to main publishes the three apps through GitHub Pages.
- Worker changes: Asim pastes `server/worker.js` into the Cloudflare editor and deploys.
- Code.gs changes: Asim pastes `Code.gs` into Apps Script, saves, then **Deploy, Manage deployments, New version**, because the Worker calls the deployed web app.
- The foot of all three apps shows app · server · sheet versions. Asim checks it after each release, and runs the sheet's health check (✓ and ✗ lines).
- Code.gs needed a one-time `pdfFolder` run so it can save reports to Drive (done for #30).

## 5. PR conventions

- **One PR per step.** Asim pastes the Worker once, Code.gs once, merges once, then checks ("anything else is too stressful for me"). Never split a step. Never ask for a separate catch-up paste when the next PR can carry it.
- Base every PR on main, and bring it up to date with main before it's ready. (A PR stacked on another branch closed when that branch was deleted: #21.)
- Each PR adds a deploy note in `analysis/DEPLOY-<versions>.txt` and copies it to `DEPLOY.txt`. It starts from the versions Asim actually has live ("YOU ARE ON / GOING TO"), gives the steps in order, and then checks A, B, C… to try afterwards.
- Deploy steps give direct raw.githubusercontent.com links to the exact Code.gs and worker.js.
- Bump the version numbers: app (`APP_VERSION` in `index.html`, the other pages, and the `sw.js` cache), server (worker), sheet (Code.gs).
- Run `node tests/run-tests.mjs` with `TZ=Europe/London` (one sheet check fails under UTC). Commit any tests written.
- Do one review, fix what it confirms, run the tests, open the PR and give him the link. Don't loop review rounds; he reads a quiet session as stuck.
- Claude never merges or deploys. Asim does both.

## 6. Agreed rules and decisions

**Wording.** "Prompts and instructions only. Never any essays and stories. All 3 apps."

**Samples.** Every typing box in all three apps has a faded sample starting "e.g." that fits the box (for example, Jobs to arrange, wash: "e.g. Washed after the service"). This is a sample, not explaining text. PIN boxes and date pickers stay blank. Never strip samples in a wording sweep (PR #18 did, without asking, and upset him). Samples say **Thanksgiving, never Harvest**.

**Sheet rules.** Every fixed-choice cell on every tab has a drop-down (case corrected, anything off the list refused). Set up locks every tab with no manual step, tabs are relocked at 3am, and the health check names any unlocked tab. PINs stay on the Drivers tab only.

**MOT and insurance (#29).** Expired insurance stops the bus with no override until the renewal is recorded. Expired MOT also stops it, except a coordinator can authorise one "MOT run" that day to a Vehicle Log MOT booking, with no passengers. Service or permit overdue only warns. Renewal alerts at 60, 30, 7 and 0 days, then weekly, at 08:00.

**PDF reports (#30, #31).** Made in the coordinator app: Outstanding actions, Fleet and safety record, Sunday service transport report, Transport summary for the period. Each has the app's banner, a clear title, selectable text, page x of y, and "Contains names". They're saved to a "Minibus reports" Drive folder (not shared). Readers are church leadership and any authority.

**Summary emails (#32).** The weekly summary as before. A monthly summary after each month's last Sunday, and a yearly one after the year's last Sunday. Both go to the weekly summary's recipients, use the Period summary figures, and the first is on the evening of Sunday 25 October 2026.

**Defects.** Critical is YES or blank. Kind is Defect or Advisory. Closing one needs "what was done".

**Coordinator titles.** Coordinator, Minister in Charge, Assistant Coordinator. Safety alerts go to COORDINATOR_EMAIL plus active drivers with those titles.

**Timing.** Bus Bookings has a Scheduled column. Early or late at a booked stop is measured from the time when the seat was booked, not today's timetable (#22). Bookings made before 1 October 2026 have no Scheduled time.

**Seat booking.** The coordinator app books seats one Sunday ahead of the coming Sunday (Asim likes this).

**Driver app (#32).** Buttons fade while sending; Start and End on an MOT run send once.

**Decided, nothing to do.** Real names stay in old git history (rewriting it was judged risky). Worker editor (TypeScript) warnings are harmless.

## 7. How Asim likes to work

- He reads every line himself, so keep messages short and plain. Lead with what he needs to do. No essays.
- A question is not a request. Answer it. Change or remove things only when he asks, and ask when unsure.
- When he poses a choice, give the options with a recommendation. When he says "let's agree", wait for his answer before building.
- Name the work in plain words, never phase numbers. Keep "manual" out of other work's titles (it alarmed him).
- Show proposals before changing project settings.
- When he confirms the foot shows a PR's versions, start the next step without waiting for another go, **except the manual and videos**.
- Close off finished work as soon as he has taken the last action; idle open work reads to him as stalled.
- He likes a short "What comes next" list: the one-step rule, live versions, what to check, numbered steps with PR links (done ones struck through), the break, later steps.
- Usage: his account hit the five-hour limit twice on 2 October and was over half the weekly limit. Keep work lean: one review, tests, PR, short reply.

## 8. PR history

- #10: DEPLOY.txt shows the real departure times in the "Time to set off" example.
- #11: README notes the server code and tests are public, so no secret goes in a file.
- #12: Passenger videos: the scripts that make them, in `video/`.
- #13: Invented names in place of the volunteers' real ones.
- #14: v1.88.0: "Add to your phone" on a first visit; Message the driver switched on.
- #15: "Is everything working?" checks whether passengers can message the driver.
- #16: Vehicle Log, History and next due dates; one pattern for the three apps (v1.89.0 · w2.30.0 · v1.92.0).
- #17: The live server reads the driver app's own words for a stop tap.
- #18: Coordinator app tidy-up, and the stop behind a number (v1.90.0 · w2.31.0 · v1.93.0). Also removed samples without asking (later restored by #28).
- #19: Wording sweep of the driver app and passenger page ("prompts and instructions only").
- #20: Drop-downs on every fixed-choice cell, and sheet locks.
- #21: Closed unmerged: it was stacked on a branch that got deleted.
- #22: Run record times measured from the booked (Scheduled) time.
- #23: Tests for BST and GMT so calendar times stay right across the clock change.
- #24: Sheet protection: every tab locked, relocked at 3am, health check names unlocked tabs.
- #25: Defects screen in the coordinator app.
- #26: Drivers screen in the coordinator app.
- #27: Buses, Rota notes and Bus stops screens in the coordinator app.
- #28: Faded "e.g." samples back in every typing box (pages v1.93.1).
- #29: MOT and insurance stops, the MOT run, renewals and alerts.
- #30: Four PDF reports in the coordinator app, saved to Drive.
- #31: PDF report fixes: the app's banner and clear titles.
- #32: Final touches: Thanksgiving in samples, buttons fade while sending, monthly and yearly summary emails (app v1.95.2 · sheet v1.101.0). Code.gs paste still pending.

## 9. Earlier sessions

- First Claude Code session: `session_01BXmUCvFo8b6ePpUexXBj5j` (PRs up to #18).
- Claude Project "Driver's manual completion" (PRs #19 to #32, and this handover).
