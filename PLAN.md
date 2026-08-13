# Minibus app — plan to 30 August 2026

Written Thursday 13 August. The first South run is Sunday 16 August.

Rule for the week: **nothing changes after Saturday evening.** A fix that
lands untested on Saturday night is worse than the fault it was meant to
cure.

---

## Thursday 13 August — today

- [ ] Deploy `Code.gs` (the two speed changes). **Deploy → Manage
      deployments → Edit → New version.** Saving alone changes nothing at
      the `/exec` address.
- [ ] Push `icon-driver-180.png` to the repo root, confirm it opens at
      `https://drolnstone.github.io/minibus-check/icon-driver-180.png`,
      then push `index.html` and `sw.js` (v1.18.8).
- [ ] Swipe the driver tab away in Safari — do not reload it — then open
      the address fresh. Check the crest replaces the globe.
- [ ] Open the app on one phone and confirm the mileage line still reads
      correctly under the odometer box. That is the one thing today's
      backend change could touch.

## Friday 14 August

- [ ] **Baseline the speed.** Apps Script editor → **Executions**. Note the
      duration of a handful of `doGet` calls. Write the numbers down —
      Sunday's are meaningless without them.
- [ ] **Clear the test bookings for 16 August.** Bus Bookings tab: rows
      with Status `Rehearsal` are inert and can stay. Any other row for the
      16th is real and the driver will stop for it. Yours at Pym Street is
      one of them.
- [ ] Confirm the rota screen shows the right name against Sunday 16th on
      both routes.

## Saturday 15 August — freeze

- [ ] Post the passenger link in the group. One line, the bare address
      ending `/sunday/`, and the reminder that bookings close 09:30.
- [ ] Remind the two Sunday drivers to open the app once **on Saturday**,
      with signal. That is what puts the current version and their PIN copy
      on the phone before it matters.
- [ ] No deploys after this point.

## Sunday 16 August — first South run

- [ ] 09:00: open the Executions page and leave it. You are looking at how
      long calls take while ten people use it at once.
- [ ] 09:30: bookings close. Start trip appears on the drivers' phones.
- [ ] Watch for: taps reaching the sheet, the passenger page showing the
      pickup within about 30 seconds, both routes counting separately.
- [ ] Write down anything odd **as it happens**. Monday's memory of a
      Sunday morning is not evidence.

## Monday 17 August — the review

- [ ] Checks tab: did both runs record? Anything in the PIN check column
      other than blank or Verified?
- [ ] Trip Events: any run marked Unchecked, and if so, whose and why.
- [ ] Bus Bookings: did anyone book after 09:30, and what happened.
- [ ] Executions: compare Sunday's durations against Friday's baseline.
      **This decides the order of everything below.**

---

## The follow-on work

Each of these is a discussion first, then one build. Dates are when to
start, not deadlines.

### Tue 18 – Wed 19 August · the passenger board
One sheet read serving the stop counts and "your booking" together,
cached for about twenty seconds and dropped the moment a booking is
written. Sunday morning is the only time this app has real concurrency,
and this is the request that meets it. Held until after the 16th on
purpose: a caching mistake here looks exactly like "my booking did not
save".

### Thu 20 August · one call at startup
The driver app currently makes three or four separate requests when it
opens — rota, last mileage, board, counts — each its own Apps Script
execution, each paying its own start-up cost. One `?boot=1` returning all
of it would cut that to one. The largest single win left, and the one
most worth measuring before and after.

### Fri 21 August · keeping it warm
A time trigger every five minutes between 08:00 and 11:00 on Sundays, to
see whether it holds the runtime open and takes the 2–5 second cold start
off the first driver of the morning. An experiment, not a fix — measure
it against the 16th before keeping it.

### Sun 23 August · second South Sunday
Compare durations against the 16th. If nothing improved, the remaining
time is Google's and no amount of rearranging this code will get it back.

---

## Waiting on a decision

**Has anyone checked this bus today?**
Today the app only looks for a check on that phone, under that name. So a
walkaround done by the coordinator, or on a tablet, or before a
reinstall, all read as *no check* and the driver sees the warning. If the
sheet were asked instead, that driver would simply get Start trip, and
Set off anyway would shrink to what it is actually for — no signal, or a
check that never sent. It makes the warning honest every time it appears.
Not a wording change; needs a new field in the payload and a decision
about what happens with no signal.

**Splitting Code.gs.**
Safe to do — an Apps Script project takes as many `.gs` files as you
like, they share one namespace, no imports, no build step, deployment
unchanged. Natural seams: rota, bookings, trip, checks, menu, helpers.
Worth an afternoon when there is no Sunday in the next three days.
`index.html` stays one file: the service worker caches it as a unit, so a
phone has either the whole new app or the whole old one.
