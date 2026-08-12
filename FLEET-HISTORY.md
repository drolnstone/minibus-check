# Fleet history

Why the checks say what they say.

Every instruction below appears in the driver's app. The history beside it does
not, and should not. A volunteer at eight on a Sunday morning needs to know what
to look at and what to do about it. Dates, mileages and MOT outcomes are for
whoever decides when a bus goes into the garage, which is a different person
doing a different job, usually sitting down.

**This file is why the wording survives.** Without it, somebody in two years
reads "even if the brakes feel fine", decides it is over-cautious padding, and
tidies it away. Then the reason it was written is gone and so is the protection.
If you change an instruction, change the note beside it and say why.

It is also the document to hand a garage.

---

## YS70 PWE

Ford Transit 460 Trend EcoBlue, 2020, 17 seats including driver.

### Tyres

**Driver sees:** Report edge wear even when there is plenty of tread left.

**Why:** Worn on the edge front and rear at more than one past test. Edge wear
means something is out of line rather than simply worn out, so tread depth on
its own does not tell you the tyre is healthy.

### Front brakes

**Driver sees:** Report scoring, a deep lip, or one side cleaner than the other,
even if the brakes feel fine.

**Why:** Front pads were dangerously thin at the 2024 test and were worn again
within 1,360 miles of being replaced. The wear rate on this bus has never been
explained. "Even if they feel fine" is the whole point of the instruction: on
this vehicle the feel has not been a reliable guide.

### Brake fluid

**Driver sees:** Any drop since last week is a report, not a top up.

**Why:** Follows the front brake history above. A dropping level is either pad
wear or a leak, and on this bus both are live possibilities.

### Retractable step

**Driver sees:** Work it three times, out and back. Report anything slow, notchy
or noisy.

**Why:** Flagged at three separate tests since 2023 and never repaired before we
bought the bus. It is the least reliable thing on the vehicle. Three cycles
rather than one because an intermittent fault will not show on a single try.

### ABS warning lamp

**Driver sees:** The lamp must go out once you move off. If it stays on, report
before loading.

**Why:** Failed its MOT on this exact lamp in June 2026 and passed the same day.
There is no evidence anything was replaced, so the fault is not known to be
fixed.

### Brakes

**Driver sees:** Grinding or pulling to one side is a stop, not a note.

**Why:** Same unexplained front brake wear rate. On another vehicle a noise
might be worth watching; on this one it is not worth the risk.

---

## NH56 FWP

Ford Transit 100 RWD, 2007, 15 seats including driver.

Two seats were removed to leave a level floor at the rear for folded prams,
crates of water and similar. Nothing is fitted in that space, so it carries no
check of its own. **The seating capacity is 15 including the driver and that is
the figure to quote**, not the 17 the model was built with.

### Rust and structure

**Driver sees:** Report flaking, bubbling or soft metal at the sills, underbody,
and where the body meets the chassis. Look hardest at the cab mountings on all
four corners.

**Why:** The cab mountings on all four corners were repaired and independently
inspected in April 2026, which is why it passed. Repaired areas stay the ones
worth watching, because the metal around a repair is the same age as the metal
that failed.

### Brake pipes and lines

**Driver sees:** Any damp or wet patch along the chassis rails or behind a wheel
is a stop.

**Why:** A brake pipe was replaced after a leak in January 2025. Pipes of this
age tend to fail one at a time rather than together, so replacing one is not
reassurance about the rest.

### Brake fluid

**Driver sees:** Any drop since last week is a leak until proven otherwise. Do
not top it up and drive.

**Why:** Follows the pipe history above.

### Brakes

**Driver sees:** Test the handbrake on a slope every time, so you would know at
once if it ever slipped.

**Why:** The parking brake and a brake cable were both put right in early 2025.

### Suspension and ride height

**Driver sees:** Report knocking over bumps.

**Why:** An anti-roll bar ball joint was replaced in 2025 and a leaf spring bush
was flagged as long ago as 2015.

### Lights

**Driver sees:** Check the lenses themselves for cracks, not only that the bulbs
light up.

**Why:** A cracked rear stop lamp lens failed the test in 2025. A lit bulb
behind a cracked lens still fails.

### Reversing camera

**Driver sees:** Select reverse: picture appears and is not fogged or rolling,
and the sounder is audible from outside.

**Why:** Aftermarket kit rather than factory fitted, mounted at the rear with an
exposed cable run. It has more ways to fail than the equivalent on YS70 PWE.

### No AdBlue

A 2007 diesel has none, so the check is skipped on this vehicle.

---

## Both vehicles

Neither bus has a wheelchair ramp, lift or restraints, so that check is skipped
on both. **If a vehicle with that equipment ever joins the fleet, remove
`wheelchair` from its `skip` list in `config.js`.** DVSA expects accessibility
equipment to be checked on every walkaround where it is fitted, not
periodically.

---

## How the checks are put together

The **pre-drive check** is what a driver does every Sunday. It covers the DVSA
daily walkaround for a PSV, with items merged where one look answers several
questions, plus the vehicle-specific instructions above.

The **full inspection** is the pre-drive plus items that do not need looking at
weekly: the spare wheel, power steering fluid, belts and hoses, corrosion,
speed limiter, radio, documents on board and general cabin condition.

Five items were removed as separate checks in v1.14 and folded into others,
because a driver looking at the lights is already looking at the lenses,
reflectors and plates. Reflectors and number plates went into **Lights, plates
and reflectors**. Safety signage went into **Emergency exits and signage**.
Handrails went into **Gangway, handrails and hammers**. Seat condition went into
**Seats and anchorages**.

Three DVSA points had no home and were added: the footwell and pedal condition
into **Brakes and pedals**, hatches and ventilators being secure into
**Emergency exits and signage**, and the 1mm minimum tread depth into **Tyres**.
That figure is worth knowing: it is the PSV minimum and it differs from the
1.6mm most drivers know from cars.

**A note on the legal position.** These buses run under a Section 19 permit
rather than an operator's licence, so the formal record-retention regime that
applies to licensed operators is a separate question and is not settled by this
document. What is not in doubt is that using a vehicle in a dangerous condition
is an offence for anybody, and that the DVSA walkaround guidance is the
recognised standard of care. Verify the permit position independently rather
than relying on this file.

Source: DVSA, "Carry out bus or coach daily walkaround checks", last updated
18 April 2023. Check for a newer version before relying on the item list.
