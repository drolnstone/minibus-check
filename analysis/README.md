# The estimate

Working notes for the ETA in v1.71.0. Not part of the release; kept beside it
because the next person to change the arithmetic will want to know why it is
shaped like this.

## What is wrong with the estimate now

At v1.70.1 the passenger's estimate is one line:

```js
const eta  = new Date(sched.getTime() + state.offset * 60000);
const mins = Math.round((eta.getTime() - Date.now()) / 60000);
```

Your own timetabled time, plus however many minutes the bus is running behind
at the last stop it marked. It is honest and it is cheap, and it is wrong in
one specific way: **it projects over the timetable, including stops the bus is
not going to make.**

On a morning where four of the seven North stops have nobody booked, the bus
gets to London Road several minutes before the estimate says, because the
estimate has silently charged it for four stops it drove straight past. The
passenger who trusted the number is still walking to the kerb.

## The direction of the error matters more than its size

This is the whole design.

- **Estimate too late → the bus is early → the passenger misses it.** They
  were told eight minutes, it came in five, and the next one is next week.
- **Estimate too early → the bus is late → the passenger waits.** Mildly
  annoying, at a stop they were going to stand at anyway.

These are not the same cost, so the arithmetic is not symmetric. Where the
model is unsure it should lean towards predicting the bus **earlier** than it
will come. Every default below is set on that principle, and anything later
added to this should be too.

That is also why the approach alert fires on the estimate rather than on the
timetable: the timetable can only ever be late once a stop has been skipped.

## The model

Walk forward from the last stop the driver marked. For every stop between
there and the passenger's own:

- **booked** — it costs the full timetable gap.
- **not booked** — the bus goes past it.

Worked out a **segment** at a time — from the last stop the bus is calling at,
over however many it is passing, to the next one it calls at:

```
with coordinates      saving = gap(P..Q) - drive(P -> Q)
without               saving = per skipped stop, the dwell or a fraction of
                               its own gap, whichever is larger
```

floored at one dwell per stop skipped, capped both per stop and by the whole
gap from P to Q.

### Two things this got wrong first, both worth keeping written down

**One stop at a time double-counts.** The first version asked what each
skipped stop was worth and added them up. Two stops skipped in a row share a
gap — the gap out of the first *is* the gap into the second — so N05 and N06
together came out worth more than the whole stretch they sit in, which puts
the estimate before the bus left the kerb behind them. Asked as one question
from P to Q it cannot happen, and that is the only reason the code is shaped
in segments.

**Dwell plus detour made the coordinates harmful.** The first formula was
`saving = dwell + detour`, which reads well and is wrong here. On this
timetable the gap between two stops is dwell *plus padding* plus twenty
seconds of driving, and `detour` only ever recovers the driving. So filling in
the six coordinates moved the estimate from 5.6 minutes saved to 2.5 — adding
real data made the answer **later**, in the exact direction that leaves
somebody at a kerb. `gap − drive` takes off the padding as well, which is what
a skipped stop actually gives back.

The test that caught it is `coordinates do not make the estimate worse than no
coordinates`, and it is worth keeping whatever else changes here: any model
where typing in more truth makes the prediction worse is the wrong model.

## What your timetable says about dwell

Three observations off the real timetable, and all three point the same way:

| | gap | distance | implied drive |
|---|---|---|---|
| S03 → S04 | 3 min | 195 m | about 20 seconds |
| N05 → N06 → N07 | 3 min each | 556 m across all three | under a minute each |
| N01 → N02 | 4 min | — | about 2.5 minutes of it is padding |

At 195 metres the driving is twenty seconds and the gap is three minutes. So
**on these clusters the gap is almost entirely dwell and slack, and skipping
one of them saves very nearly the whole gap.**

The consequence for the code is worth stating plainly, because it is the
opposite of the obvious approach: if the saving is modelled as *distance
saved*, a skip in a cluster barely moves the estimate at all, and the bus
keeps arriving early — the exact failure this is being built to fix. **Dwell
is the term that matters here and distance is the correction**, not the other
way round.

## Settings

All in `config.js` under `eta`, all with defaults that work with no
coordinates at all.

| Setting | Default | What it is |
|---|---|---|
| `dwellSeconds` | 75 | How long the bus stands at a stop it calls at |
| `skipSaves` | 0.8 | Of a gap that cannot be explained by driving, the fraction a skip removes. Used when there are no coordinates |
| `speedMph` | 18 | Only to turn a distance into a drive time |
| `maxSkipMinutes` | 6 | A cap, so one absurd gap cannot swallow a leg |
| `leadsFrom` | `"start"` | When the estimate takes over from the timetable on the driver's list |

With no coordinates in the sheet, `detour` is zero and the model falls back to
`skipSaves` against the unexplained part of the gap. That is deliberately the
degraded case, not a broken one — it still beats the timetable, because it at
least removes the dwell.

## Calibrating it, once there is a Sunday of data

`calibrate.mjs` reads an export of the Trip Events tab and fits `dwellSeconds`
and `speedMph` to what actually happened. It wants one column of stop ids, one
of times, and the run id, which is what that tab already holds.

```
node analysis/calibrate.mjs ~/Downloads/trip-events.csv
```

It prints the fitted numbers and what they would have done to last Sunday's
estimates. **Nothing in the release reads it.** It is a thing to run when you
have data, not a thing the app depends on.

Until then the defaults above stand, and they are set to fail in the direction
that leaves somebody waiting rather than the direction that leaves them
behind.

## What the first real export said (21 September 2026)

Six Sundays of Trip Events, August and September. **21 usable legs**, 20 of
them ending with the bus actually stopping. That is not enough to tune a
setting from and the fitted numbers are printed only so they can be watched
moving: `dwellSeconds` 446, `speedMph` 12, r² **0.20**.

Take almost nothing from those. Take these three things instead.

### The old estimate was fourteen minutes wrong, in the dangerous direction

20 September, North, measured off the export:

| stop | timetable | actually | off |
|---|---|---|---|
| Church | 09:52 | 10:00 | +8 |
| Scarisbrick Dr | 10:03 | 10:11 | +8 |
| Grace Rd | 10:15 | 10:21 | +6 |
| Bedford Rd | 10:39 | **10:31** | −8 |
| Wilburn St | 10:45 | 10:37 | −8 |

The bus started eight minutes late and finished eight minutes **early**,
because it went past N03 and N04 without stopping. On the pre-v1.71.0 model a
passenger at Bedford Road would have been told his own timetabled 10:39 plus
the +6 the bus was running at Grace Rd — **10:45**. The bus came at **10:31**.

Fourteen minutes early, on the one Sunday somebody was standing there. That is
the exact failure v1.71.0 was built for, and it is in the record rather than
in an argument.

With the booked-stops model, two skipped stops between Grace Rd and Bedford Rd
come off that estimate — capped at `maxSkipMinutes` × 2 = 12 minutes — giving
about 10:33 against an actual 10:31. Two minutes early instead of fourteen.
*The exact figure needs that day's Bus Stops timetable and bookings, which are
not in this export.*

### That "dwell" of seven minutes is not dwell

It is **tap latency**. Drivers mark a stop when they remember, not when they
pull away, and an r² of 0.20 says the line barely explains the spread at all.

This matters more than the dwell number, because the offset is computed from
when a stop was *tapped*. A driver who is on time but taps four minutes late
produces an offset of +4, and every passenger ahead of him is told a time four
minutes later than the bus will actually arrive — early bus, missed bus. **Late
tapping pushes the estimate the unsafe way.**

Nothing has been changed for it. The first deployed Sunday is where to watch:
with the estimate leading on the driver's own stop list, a driver who sees
10:39 when his watch says 10:31 has a reason to notice.

### The Stop IDs have been renumbered, twice

| stop | ids it has worn |
|---|---|
| Parton St | S01, S05 |
| Hannan Rd | S04, S03, S06 |
| Halsbury Rd | S04, S05 |

North moved too: Pym Street was N04 and is now N06; Fountains Road was N05 and
is now N04.

**Nothing in this analysis joins history on the Stop ID**, for exactly that
reason — an id join across those dates pairs up stops that were never adjacent
and hands back a confident distance for a leg that never existed. It matches
on the road name instead.

It is worth knowing well beyond this script. Anything that reads the historic
record by Stop ID is reading it wrong, and a booking or a trip row from August
does not point where its id says it points.

## Checked against the real timetable (21 September 2026)

The Bus Stops tab as it stood on 20 September, run through the model.

### The estimate: verified, including where it over-corrects

| stop | timetable | old told | new told | actually | old | new |
|---|---|---|---|---|---|---|
| Grace Rd | 10:15 | 10:23 | 10:23 | 10:21 | −2 | −2 |
| Bedford Rd | 10:39 | **10:45** | **10:33** | **10:31** | **−14** | **−2** |
| Wilburn St | 10:45 | 10:37 | 10:32 | 10:37 | 0 | **+5** |

Negative means the bus came *early*, which is the one that loses somebody the
bus.

**Bedford Road is the case this was built for**, and it works: fourteen minutes
early becomes two.

**Wilburn Street is where it over-corrects**, and that is written down here
rather than glossed. The old model was exactly right and the new one is five
minutes out — because N06 was skipped between N05 and N07, so the model took
time off, and the bus took the full six minutes anyway.

That is the *safe* direction by design: predicting early costs somebody a wait
at a kerb they were standing at, predicting late costs them the bus. But it is
not free, and `maxSkipMinutes` is the dial. Dropping it from 6 to 3 would halve
the Wilburn error — and would also halve the Bedford fix, taking that estimate
back to eight minutes early. **6 is the better trade on this route.** Revisit it
if a Sunday shows the over-correction mattering.

### The timetable is not padded. It is optimistic.

Driving time at the fitted 12 mph, against what each leg is allotted:

| leg | gap | metres | driving | slack |
|---|---|---|---|---|
| Church → Scarisbrick Dr | 11m | 2787 | 11.5m | **−1.8** |
| Scarisbrick Dr → Grace Rd | 12m | 2193 | 9.1m | +1.7 |
| Grace Rd → Litherland Rd | 9m | 2345 | 9.7m | **−1.9** |
| Litherland Rd → Fountains Rd | 8m | 2058 | 8.5m | **−1.8** |
| Fountains Rd → Bedford Rd | 7m | 1773 | 7.3m | **−1.6** |
| Bedford Rd → Pym St | 3m | 230 | 0.9m | +0.8 |
| Pym St → Wilburn St | 3m | 326 | 1.3m | +0.4 |

Every long leg on North is **tight before the bus stops for anybody**. The
timetable implies roughly **18 mph** between districts; the record says the bus
does about **12**. At 18 the legs work with about a minute to spare, which is
no room for a set of lights.

South is the same shape: Church → Dewsbury, Dewsbury → Vicar, Vicar → Sedley
and Breck → Parton are all tight; only the three clusters have slack.

**So the North timetable is simultaneously impossible and far too loose.** Call
at every stop and the bus cannot keep it — which is why 20 September ran eight
minutes late to Grace Road. Skip two and it hands back seventeen minutes at
once — which is why the same bus was eight minutes *early* at Bedford Road.

Two things follow, neither of them a code change:

- **The long legs want another two or three minutes each**, or the bus will go
  on starting late and staying late whenever the stops are busy.
- **The clusters do not.** Three minutes for 230 metres is right; that time is
  the stopping, not the driving.

A timetable the bus can actually keep would make the offset mean something,
and the offset is half of every estimate on the passenger page.
