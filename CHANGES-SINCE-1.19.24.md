# Minibus app — everything since v1.19.24

**RCCG Dominion Assembly Liverpool · as at Sunday 16 August 2026**

Three states below: **shipped** (files are with you), **agreed** (settled, not yet
built), and **open** (offered, you have not taken it up).

---

## v1.19.25 — SHIPPED, awaiting your deploy

Three files sent: `index.html`, `sw.js`, `Code.gs`. `sunday/index.html` did not
change and was not re-sent — the copy you have from v1.19.24 is current.

### 1 · The PIN now guards a run, not only the start of one
*File: `index.html`. Found while answering "could I have signed in as Tunde?"*

**What was wrong.** `tripStart` asked for the PIN. `tripTap`, `tripUndo` and
`tripEnd` did not, and they only ever run *after* a run exists. So any phone that
picked a driver's name off the list could open Stops and bookings straight from
the home screen — no Continue needed — adopt the live run off the sheet, and tap.
No PIN box ever appeared. What it wrote landed on that driver's own trip id under
that driver's own name, and End trip closed the run for everybody.

Verified before the fix: a phone failing the PIN tapped a stop and it reached the
sheet as Tunde; End trip ended his run.

**What changed.** All three now ask. The PIN box is rendered mid-run as well as
before it, so a driver whose phone restarted at the third stop has somewhere to
key it. Tap and Undo buttons show as off until it is answered.

**Costs the real driver nothing** — he keys it before his walkaround and it is
still good. With no signal and no stored PIN the gate opens by itself and the
record says so, exactly as on the first screen. Verified: a driver who answers
the PIN taps normally, offline queue and End trip unaffected.

### 2 · One driver's End trip no longer ends the other route's morning
*File: `Code.gs`. This is what happened to you on the 16th.*

**What was wrong.** `runComplete()` counted only the runs that *began*, then
asked whether they had all finished. North did its checks and never tapped Start,
so North counted for nothing. South ran properly and tapped End at church — and
that single tap satisfied the test and rolled the whole booking page to next
Sunday. The 14:00 backstop never applied, because it only fires when *no* route
has started at all.

North's passengers were shown next Sunday's booking form under "Today's buses are
back", lost the stop list, and could no longer withdraw.

**What changed.** Every route with somebody booked on it must have started **and**
ended. Anything short of that waits for the backstop. A route nobody booked is
left out — nobody is waiting on it and there is nothing to watch.

**The trade-off you accepted.** From now on, a route with passengers that never
starts holds next week's bookings until 14:00. That is the backstop doing its job,
and nobody books before then.

---

## v1.19.26 — AGREED, not yet built

Four items. All four came out of your own questions. `sunday/index.html` and
`Code.gs`; the driver app is untouched.

### 3 · Tracking untied from the booking
*The laptop/phone problem your passenger reported.*

After the cutoff, a device with no booking can say which stop it is waiting at and
get that stop's live view. No identity needed, because there never was any: three
households booked at one kerb already receive a byte-identical answer. Everything
in the panel is a fact about the stop, not about a person.

Fixes it for the laptop-booker, and for three people you have not heard from: the
one whose browser cleared its storage, the one who reinstalled, and the one who
did not book but is deciding whether to walk to the stop.

**The line that must not be crossed while building it:** tracking is untied from
the booking; **the driver's phone number is not**. Anyone with the link may see
where the bus is. Only a phone holding a booking for that route gets the number.

### 4 · The other-device warning
*The half of the laptop problem that costs you seats.*

Reproduced: laptop books 2 at Church Lane, phone does not know, so he books 2
again — two rows, **four seats on a 15-seater for one family**. Cancelling on the
phone leaves the laptop's two seats standing and invisible to him.

A device with no booking of its own gets one plain line on the booking screen: a
booking made on another device is still counted, and booking again adds a second.

**Wording rule:** it must say *a booking **you** made on another device* — never
"a booking at this stop", which at a shared kerb reads as somebody taking your
seat.

*Worth checking on last Sunday's tab: same stop, same seat count, two different
handles is the signature.*

### 5 · "Nobody there" no longer reads as "Picked up"
*Found when you asked about several families at one stop.*

The server collapses both taps into one `served` state and the page renders both
as "Picked up at 11:14". A family who booked and was thirty seconds up the road is
told they are on a bus they are not on.

The event type is carried through, and there are two headlines:

| Driver tapped | Headline |
|---|---|
| Picked up | **Picked up at 11:14** |
| Nobody there | **Nobody there at 11:14** |

Each says what the driver actually said. He taps the stop, never the people.

### 6 · The recovery goes to the driver, not to you
*Your insight, and the reason the WhatsApp button exists.*

You can only apologise. The driver can turn round. And a message is the right
channel precisely because it waits — it sits until he pulls up at the next stop,
which is when he can read it and still early enough to come back. A ringing phone
would fight the rule you already built: nothing is tappable while the wheels turn.

So the panel names the existing WhatsApp button rather than sending them to you.
One button, not a second one.

**The message, your wording, verbatim, and the same for both cases:**

> Sunday bus — Church Lane, 11:14. I am sorry, I missed my bus. Please, can you
> come back for me? I am here now.

It asks rather than reports, so there is nothing to argue about at the kerb, and
it needs nobody to have been at fault.

**How the offer is made differs, because the two taps differ:**

- After **Nobody there** — straight out. Nobody at that kerb was collected, so
  everyone booked there is unambiguously left: *if you are at the stop, message
  him.*
- After **Picked up** — conditional, because most people reading it are on the
  bus and the app cannot tell them from the one who was left: *if you were not on
  it, message him now.*

**And it closes when the bus arrives.** Once End trip is tapped, the driver button
goes and the recovery returns to you — "please come back for me" is not a request
anybody can act on from the church car park. Your decision: nothing stays open
regardless.

**Prerequisite:** a number in column H of the Drivers tab. That read path was the
broken one; it is fixed in the `Code.gs` you already have (verified `07700 900123`
→ `447700900123`). The four disclosure conditions are unchanged: on the day, after
09:30, to a phone holding a booking, for that one route.

---

## OPEN — offered, not taken up

### 7 · "Who is tapping" showing a route that never ran
Tonight the report will not show North as "never started". It will not show North
**at all** — with no Trip Events rows there is no line to build, so the evidence of
a missing run is an absence, which is easy to miss. Roughly eight lines in a
menu-only function to make it a line in its own right. Say if you want it.

---

## Deploying

1. `index.html`, `sw.js` together — `sw.js` carries the cache name, and without it
   phones keep the old copy. Currently `minibus-check-v1.19.25`, matching
   `APP_VERSION` on the first screen.
2. `Code.gs` → **Deploy › Manage deployments › edit › Version: New version.**
   Saving alone does nothing to the live app.
3. Open the driver app once and confirm it reads **v1.19.25**.

Already confirmed done and not repeated here: `COORDINATOR_EMAIL` in Script
Properties, spreadsheet locale set to United Kingdom.
