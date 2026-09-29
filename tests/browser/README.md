# Browser checks for the driver app

The rest of `tests/` calls the Worker and the spreadsheet script directly.
These drive the driver app itself, in Chromium, with stand-in servers
answering from `real.json` (the real stops, buses, drivers and rota). Each
check is one of the faults fixed in v1.74.9 and v1.74.10, asserted the way
a driver would meet it.

    npm i playwright-core            # once, anywhere on the module path
    node tests/browser/driver-app.mjs           # all of them
    node tests/browser/driver-app.mjs T4,T7     # some

`MINIBUS_ROOT` points at another release folder, `MINIBUS_PORT` moves the
local server, `CHROMIUM` names a browser binary, `PLAYWRIGHT_CORE` names the
module file if it is not on the path.

Each check was written against a fault: it fails on the release that had
the fault and passes once it is fixed. T3b and T6b are the exception: they
make sure a fix did not go too far (a North driver is not offered cover on
South; a driver never sees Authorise), so they pass on every release.

    node tests/browser/sabotage.mjs             every fix taken out in turn
    node tests/browser/sabotage.mjs S2c,S9      some

`sabotage.mjs` copies the release to a scratch folder, takes one fix back
out, and runs the check written for it, once per fix. Each sabotage must
match the source exactly once or it stops, so it can never "prove" a check
by leaving the fix in place.

    node tests/browser/passenger.mjs            the passenger page, v1.75.0

`passenger.mjs` drives the real passenger page with its own stand-in for the
Worker, built from the same real stops. Its first six checks are the v1.75.0
rulings on that page, and each one fails on v1.74.10. T10 and T11 in
`driver-app.mjs` are the same rulings on the driver's stop list and trip
strip. P6, from v1.79.0, is the page loading again when a rehearsal ends; it
fails on v1.78.0, which went on showing the test morning.

    node tests/browser/coordinator.mjs          the coordinator's app, v1.77.0
    node tests/browser/coordinator.mjs C2,C7    some

`coordinator.mjs` drives the real coordinator's page against the real
Worker, run in the same process on a real SQLite database seeded from
`real.json`, so every change it makes is taken by the same code that will
take it live. Its twenty-six checks cover the PIN, a cover, a route called off
and put back, a bus swap, a note, a request approved, bookings cancelled and
made, a defect closed, a stop time put right, the reports, the refused-change
line, the idle lock, a stopped bus authorised from the first screen, the dark
theme, and from v1.78.0 the PIN taken from the driver app (and a stale one
refused), the cursor in the PIN box, and the landing page's three numbers,
report and theme chips, and from v1.79.0 a rehearsal started, started over
and ended on the Rehearsal screen (C19 to C19c), with no script error
throughout. The live server there runs on the real clock, so on a Sunday
between the cutoff and noon C19 checks the refusal instead. `SHOTS` names the folder for the
photographs it takes on the way. Run against v1.76.0 it cannot start, because
neither the page nor the Worker's half of it is there.

T13 in `driver-app.mjs` is the way in: the hub's Coordinator button for a
coordinator's name, and none for a driver's. T14 is where that button sits,
and T15 is the checked PIN going with it once, and not going when only the
name has been kept.

T16, T16b and T16c are the rehearsal rounds of v1.79.0: a phone drops its
test run and offers Start trip again when the round is over; a tap made in a
round that is over is dropped with its run and never lands in the next round
or as real; and a real run that has ended is put aside while a rehearsal
runs. All three fail on v1.78.0. The sabotages S16, S16b and S16c take each
fix back out in turn. From v1.79.1 the round is also checked by the clock,
so S16 takes out the rule both paths use rather than the board's call to it.

T16d, T17, T18 and T18b are faults found in v1.79.0 before it went up, and
fixed in v1.79.1. T16d: a board answer built a moment before a round ends
does not hand the phone its test run back as a real one. T17: taps made
while an earlier one is still being sent all reach the record. T18: after a
Saturday rehearsal, a run started on Sunday with no signal is a real run and
stays. T18b: a test run left open overnight goes on the Sunday morning with
no signal, and Start trip is offered. All four fail on v1.79.0, and T17
fails on v1.78.0 too, so the lost tap is a fault of the live release. S16d,
S17, S18, S18b and S18c take each fix back out in turn. S18b and S18c are the
two halves of T18b's fix: the clock's check of the round, and dropping what
the board said in a round that is over.
