# Minibus apps: handover for a new Claude session

First written 2 October 2026; cut back on 29 October 2026 to what still holds. The live versions are at the top of `DEPLOY.txt`; the full design is in `README.md`.

---

## 1. What this is

Three phone web apps for the Sunday minibus of RCCG Dominion Assembly, Liverpool, plus a Google Sheet and a small server.

| Part | Where in the repo | Live at |
|---|---|---|
| Driver app (walkaround check, rota, live stop list) | `index.html`, `sw.js`, `config.js` | https://drolnstone.github.io/minibus-check/ |
| Passenger page (book a seat, watch the bus) | `sunday/` | https://drolnstone.github.io/minibus-check/sunday/ |
| Coordinator app (rota, notes, requests, defects, drivers, buses, bus stops, Vehicle Log, bookings, trip times, authorise stopped buses, PDF reports) | `coord/` | https://drolnstone.github.io/minibus-check/coord/ |
| Fast server: Cloudflare Worker with D1 database `minibus` (bound as `DB`) | `server/worker.js`, `server/schema.sql` | https://minibus-api.asimbassey.workers.dev |
| Sheet code: Google Apps Script bound to the Google Sheet (Europe/London), deployed as the web app the Worker calls (URL ends `…1XxMSA`; the full URL is only in the Script Property `WEB_APP_URL` and the repository secret `DEPLOYMENT_ID`, never in a file) | `Code.gs` (repo root) | script.google.com |
| Driver's Manual PDF builder | `manual/` | |
| Doodle video scripts | `video/` | |
| Deploy note for the latest release | `DEPLOY.txt` | |
| Tests | `tests/run-tests.mjs`, `tests/suites/` | GitHub Actions, run on London time |

**How the parts talk.** The sheet is the record; if the two servers disagree, the sheet is right. The Worker owns what happens during a Sunday (bookings, stop taps, walkarounds, authorisations, coordinator app changes) and sends the alerts. When a phone does something, the server knocks on the web app (gives up after 25 seconds), and a 5-minute collection picks up the rest. The ✗ about the last knock stays until the next knock works. "Waiting to come back: nothing" means nothing is stuck. Only edits on the Rota, Drivers, Buses, Bus Stops, Requests, Defects and Bus Bookings tabs reach the server. Times typed on Trip Events don't (use the coordinator app's Fix). Threads can't reach script.google.com, so Asim checks the web app himself. The README has the full design.

## 2. Release process

- Merging a PR to main publishes the three apps through GitHub Pages.
- Worker changes go live on merge through Cloudflare's Git deploy (`wrangler.toml`). From server w2.64.0 the build runs the tests first and a failure stops the deploy.
- Code.gs changes: the Apps Script workflow (`.github/workflows/apps-script.yml`) pushes `Code.gs` and makes a new version of the web app (same deployment, same URL) once the Tests workflow has passed on main (from 16 Oct 2026), and does nothing when the live Code.gs is already the same. It needs the secrets CLASPRC_JSON and SCRIPT_ID. From sheet v1.120.0 the five-minute clock runs Set up / refresh rota by itself once per new version.
- So one merge is the whole release: no paste. Asim checks the foot versions and "Is everything working?".
- The foot of all three apps shows app · server · sheet versions. Asim checks it after each release, and runs the sheet's health check (✓ and ✗ lines).

## 3. PR conventions

- **One PR per step.** One merge is the whole deploy, then Asim checks. Never split a step.
- Base every PR on main, and bring it up to date with main before it's ready. (A PR stacked on another branch closed when that branch was deleted: #21.)
- Each PR rewrites `DEPLOY.txt`: the versions Asim has live and the ones it goes to ("YOU ARE ON / GOING TO"), what changed, then checks A, B, C… to try afterwards. Older notes are in git history.
- Bump the version numbers: app (`APP_VERSION` in `index.html`, the other pages, and the `sw.js` cache), server (worker), sheet (Code.gs).
- Run `node tests/run-tests.mjs` with `TZ=Europe/London` (one sheet check fails under UTC). Commit any tests written.
- Do one review, fix what it confirms, run the tests, open the PR and give him the link. Don't loop review rounds; he reads a quiet session as stuck.
- Claude never merges or deploys. Asim does both.

## 4. Agreed rules and decisions

**Wording.** "Prompts and instructions only. Never any essays and stories. All 3 apps."

**Samples.** Every typing box in all three apps has a faded sample starting "e.g." that fits the box (for example, Jobs to arrange, wash: "e.g. Washed after the service"). This is a sample, not explaining text. PIN boxes and date pickers stay blank. Never strip samples in a wording sweep (PR #18 did, without asking, and upset him). Samples say **Thanksgiving, never Harvest**.

**Sheet rules.** Every fixed-choice cell on every tab has a drop-down (case corrected, anything off the list refused). Set up locks every tab with no manual step, tabs are relocked at 3am, and the health check names any unlocked tab. PINs are not on the sheet: the default PIN is the last four digits of the Phone, and a driver's own PIN is on the live server only (from v1.96.0).

**MOT and insurance (#29).** Expired insurance stops the bus with no override until the renewal is recorded. Expired MOT also stops it, except a coordinator can authorise one "MOT run" that day to a Vehicle Log MOT booking, with no passengers. Service or permit overdue only warns. Renewal alerts at 60, 30, 7 and 0 days, then weekly, at 08:00.

**PDF reports (#30, #31).** Made in the coordinator app: Outstanding actions, Fleet and safety record, Sunday service transport report, Transport summary for the period. Each has the app's banner, a clear title, selectable text, page x of y, and "Contains names". They're saved to a "Minibus reports" Drive folder (not shared). Readers are church leadership and any authority.

**Summary emails (#32).** The weekly summary as before. A monthly summary after each month's last Sunday, and a yearly one after the year's last Sunday. Both go to the weekly summary's recipients, use the Period summary figures, and the first is on the evening of Sunday 25 October 2026.

**Defects.** Critical is YES or blank. Kind is Defect or Advisory. Closing one needs "what was done".

**Coordinator titles.** Coordinator, Minister in Charge, Assistant Coordinator. Coordinator emails go to COORDINATOR_EMAIL.

**Timing.** Bus Bookings has a Scheduled column. Early or late at a booked stop is measured from the time when the seat was booked, not today's timetable (#22). Bookings made before 1 October 2026 have no Scheduled time.

**Seat booking.** The coordinator app books seats one Sunday ahead of the coming Sunday (Asim likes this).

**Driver app (#32).** Buttons fade while sending; Start and End on an MOT run send once.

**Decided, nothing to do.** Real names stay in old git history (rewriting it was judged risky). Worker editor (TypeScript) warnings are harmless.

## 5. How Asim likes to work

- He reads every line himself, so keep messages short and plain. Lead with what he needs to do. No essays. The manual and videos are made only when he asks.
- A question is not a request. Answer it. Change or remove things only when he asks, and ask when unsure.
- When he poses a choice, give the options with a recommendation. When he says "let's agree", wait for his answer before building.
- Name the work in plain words, never phase numbers. Keep "manual" out of other work's titles (it alarmed him).
- Show proposals before changing project settings.
- Close off finished work as soon as he has taken the last action; idle open work reads to him as stalled.
- Usage: his plan has weekly limits. Keep work lean: one review, tests, PR, short reply.
