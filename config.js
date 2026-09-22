/* ==========================================================================
   CONFIG. The only file you should normally need to edit.
   After changing it, bump CACHE in sw.js so phones pick it up.

   THIS FILE IS PUBLIC. Every phone that opens the app downloads it, so
   anything written here can be read by anyone with the address. Names,
   registrations, the endpoint and the token belong here because the app
   cannot run without them. Nothing else does. No PINs, no addresses, no
   note explaining how any of it could be got round.
   ========================================================================== */

window.CONFIG = {

  /* The Apps Script Web App URL. Blank means practice mode: nothing is sent. */
  endpoint: "https://script.google.com/macros/s/AKfycbxS-2KqOjCWCwTkoNWgOOsB-TfGYShkSkvQJC6ItfpGINj7DJ6CRYuTxpXQip1R1XxMSA/exec",

  /* ---- the live server -------------------------------------------------
     The calls that happen DURING a Sunday go here instead: the driver's stop
     taps and his Stops and bookings screen. It answers in well under a tenth
     of a second where Apps Script took two to eight, because there is no
     forced redirect to a second host and nothing has gone to sleep.

     Submitting a check comes here as well now. It used to go to endpoint
     above and wait, and on 20 September 2026 the wait was long enough to fail
     at the kerb. The sheet still gets every check; it just is not the thing
     a driver waits for.

     Everything else, the rota, last mileage, asking for a rota change, still
     goes to endpoint above, where it always did. None of it has anybody
     waiting at a kerb.

     TO GO BACK: blank this line. Every call returns to Apps Script and the
     app behaves exactly as it did before, slowly but correctly. That is the
     whole of the rollback. */
  liveEndpoint: "https://minibus-api.asimbassey.workers.dev",

  /* Must match the token in Code.gs. */
  token: "minibusapp",

  /* Who drivers and passengers ring when something has gone wrong. Keep the
     number dialable.

     The name is shown WHOLE, on a call button and in a sentence: "Call Bro
     Asim", "ring Bro Asim on 07377634214". Write it the way people say it.
     Both apps used to take the first word of this to shorten it, which turned
     every name in this church into "Bro". They do not any more. */
  coordinator: { name: "Bro Asim", phone: "07377634214" },

  /* ---- Where the check was done ----------------------------------------
     Records one location when an inspection starts, so a walkaround can be
     shown to have happened at the bus rather than at somebody's kitchen
     table. Nothing is recorded when a driver is only looking at the rota,
     and there is no tracking of any kind between checks.

     It never blocks a check. If the phone refuses or has no signal, the
     inspection carries on and the record says why there is no location.

     Set false to turn it off entirely. */
  recordLocation: true,

  /* ---- Keeping the driver's screen awake --------------------------------
     His phone is clamped to the dashboard. Without this it locks itself
     every minute or so and he has to unlock it at every stop before he can
     mark anyone picked up.

     Held only between Start trip and End trip, and given back the moment he
     ends the run. It cannot override him pressing the lock button himself,
     and a phone too old to support it simply carries on as before.

     Set false if a driver would rather have the battery. */
  keepAwake: true,

  /* ---- The offer to turn alerts on --------------------------------------
     This was a grey line under the buttons and it was read by nobody.

     true puts it on the screen as a question over a dimmed background, once
     each time the app is opened, until they turn alerts on or the phone
     refuses. Both apps use this setting.

     It never covers the vehicle check. On the driver app it is only ever
     drawn on the first screen after he has picked his name, never while a
     check is open, and never on top of another sheet. On the passenger page
     it is only drawn to somebody who has actually booked a seat.

     Set false and it goes back to being a line. */
  alertPopup: true,

  /* Where the buses are kept: 3-5 Chester Road, Liverpool L6 4DY.

     Measured standing at the bus, not taken off a map. The postcode centre
     was 103 metres out, which is why this is worth doing once.

     radius is how far from this point still counts as being at the buses,
     in YARDS. 165 covers parking further along the road on a busy Sunday.
     The app only calls a check "away" when the phone's own accuracy figure
     leaves no doubt, so a poor fix never accuses anyone. */
  busBase: { lat: 53.424169, lng: -2.936799, radius: 165 },

  /* ---- Where church is ---------------------------------------------------
     Used for one thing: deciding that the bus is back, so a run can close
     itself.

     HERE, THE BUSES PARK IN FRONT OF THE CHURCH, so these are the busBase
     figures and they are already right. It is a setting of its own anyway,
     because the next church to use this may keep its buses somewhere else,
     and a run that closes itself at the depot instead of at the door is worse
     than one that never closes at all. Leave it out entirely and busBase is
     used, which is the same answer for this church.

     If it is ever set to a different place, MEASURE IT STANDING AT THE DOOR,
     not off a map. The bus base was 103 metres out when it was taken off a
     postcode centre, and at this fence size that is the difference between a
     run that ends itself and one that never does.

     radius is in YARDS, and wants to cover the whole of where a bus might be
     left, including along the road. */
  churchBase: { lat: 53.424169, lng: -2.936799, radius: 165 },

  /* ---- Ending the run by itself -----------------------------------------
     He parks, lets everyone off, and walks into the service with the run
     still open. That has now happened twice. This closes it.

     The run must have LEFT the fence before coming back counts, so a bus
     sitting in the yard at half nine never ends its own run. Then it must sit
     inside the fence for `minutes` without a break. A fix too vague to be
     sure about counts as neither in nor out, so a bad reading at a red light
     cannot end a run and one in the car park cannot reset the timer.

     He is told the moment it happens, and the app offers to reopen it for
     half an hour afterwards.

     It needs the app open on the dashboard, which is what keepAwake is for.
     A phone in a pocket with the screen off gives no positions, and the run
     falls back to the End trip reminder.

     Set enabled false to turn it off and go back to the tap. */
  autoEnd: { enabled: true, minutes: 3 },

  /* Drivers key in a four digit PIN before they can start a check.

     Set them in the PIN column of the Drivers tab in the spreadsheet, never
     here. The four digits never leave the spreadsheet. The app sends what is
     keyed to the server, which compares it with a salted one-way fingerprint
     and answers yes or no. No phone is ever sent a fingerprint.

     Choose four digits that are not derived from anything else about the
     person. This file is downloaded by every phone that opens the app, so
     write nothing here or in the Drivers tab that would let one PIN be
     worked out from another.

     A driver with no PIN in the sheet is not asked for one, so adding
     somebody never locks them out. Set false to turn the whole thing off. */
  requirePin: true,

  /* Who is offered the full inspection as well as the pre-drive check.
     Matched against the role in the register below, so adding a second
     coordinator is a one word change. Everyone else only ever sees the
     pre-drive check and is not shown a choice. */
  fullInspectionRoles: ["Coordinator", "Minister in Charge"],

  /* ---- When a check stops the bus ---------------------------------------
     Three answers on the walkaround, not two.

       Fine       nothing to report
       Advisory   worth watching, does not stop the bus
       Defect     a fault, and on a critical item it stops the bus

     Advisory exists because the middle case had nowhere to go. A tyre wearing
     faster than the others is not a fault and it is not nothing, and with two
     buttons the only honest answer was Defect, which on a critical item
     stopped a bus that was safe to drive.

     advisory        false removes the third button and the app goes back to
                     two answers. The answer is still read on old records.
     criticalAdvisory  what an advisory on a critical item does.
                       "notice"    goes on the record and in the email, the
                                   bus runs
                       "authorise" the bus does not run until a coordinator
                                   authorises it, the same as a defect
     showWhoAuthorised whether the driver is told who authorised the bus, by
                       name. false shows only that it was authorised.
     sameHandBothWays  whether the person who did the walkaround may also
                       authorise the bus. false means a second coordinator
                       has to do it, and with one coordinator that means
                       nobody can, so think before changing it.
                       SAME_HAND_BOTH_WAYS in Code.gs must match: this one
                       hides the button, that one makes the server refuse.

     When the coordinator is emailed about an authorisation is set in Code.gs,
     TELL_COORDINATOR, because that is the file that sends the email. */
  override: {
    advisory: true,
    criticalAdvisory: "notice",
    showWhoAuthorised: true,
    sameHandBothWays: true
  },

  /* ---- The estimate -----------------------------------------------------
     What the app and the live server subtract when the bus is going past a
     stop nobody booked.

     Until v1.71.0 a passenger's estimate was his own timetabled time plus
     however many minutes the bus was running behind, which charges it for
     every stop on the tab including the empty ones. On a morning where four
     of the seven North stops have nobody booked, the bus reaches London Road
     several minutes before the estimate says and the passenger who trusted it
     is still walking to the kerb.

     THE DEFAULTS LEAN TOWARDS PREDICTING THE BUS EARLY, and that is the whole
     design rather than an accident of tuning. Too late means the bus came and
     went while somebody was still walking; too early means a wait at a stop
     they were standing at anyway. Those are not the same cost. If you change
     these, change them in the direction of earlier.

       dwellSeconds    how long the bus stands at a stop it calls at
       skipSaves       of a gap, the fraction a skip removes. Only used where
                       there are no coordinates to work it out properly
       speedMph        only used to turn a distance into a drive time
       maxSkipMinutes  a cap, so one absurd gap cannot swallow a whole leg

     KEEP THIS EQUAL TO ETA_RULES IN Code.gs. The driver's list is drawn from
     the live server's copy and the passenger's alert is worded from it too,
     and Code.gs is what puts it there; this copy is what the app falls back
     on. Two different numbers for one bus is the one thing this must not do.

     The Lat and Lng columns on the Bus Stops tab make this better and are not
     required by it. With no coordinates the dwell still comes off, which is
     already better than the timetable. */
  eta: {
    dwellSeconds: 75,
    skipSaves: 0.8,
    speedMph: 18,
    maxSkipMinutes: 6
  },

  /* ---- When a passenger is told something -------------------------------
     The ruling is that a passenger hears at every booked pickup before his
     own: the first with the drivers, one at each stop in front of him, and
     his own last. That lets him watch the bus coming down the line instead of
     being tapped on the shoulder once and hoping.

     The cost of it is volume. North has eight pickups and South seven, so on
     a full morning the last man is woken seven or eight times — and those
     stops are not evenly spread. S05, S06 and S07 sit inside 438 metres of
     each other and N05 through N07 inside 556, so three of his messages land
     within a few minutes all saying nearly the same thing.

       resendMinutes    how far the estimate has to have moved before he is
                        told again. The stop just before his and his own
                        ALWAYS send, whatever this says, because those two
                        carry an instruction rather than an update.
       morningMessage   false drops the first message of the day.
       quietFrom/To     whole hours, London time, nothing is sent between.
                        Booking reminders only. A bus that is coming is never
                        held back: it is not a convenience.

     KEEP THIS EQUAL TO PASSENGER_RULES IN Code.gs, which is what puts it on
     the live server. */
  passenger: {
    resendMinutes: 3,
    morningMessage: true,
    quietFrom: 21,
    quietTo: 8
  },

  /* ---- Asking people to book --------------------------------------------
     Nudges to anybody whose phone has asked to be told things and who has no
     seat for the Sunday bookings are open for. Anybody who has already booked
     is dropped from the list the moment he books.

     Three windows, which are the three moments a seat gets decided:

       Sunday afternoon    the run is over and next Sunday has just opened
       Wednesday evening   the middle of the week
       Saturday evening    the last one that can do anything, since bookings
                           close 09:30 Sunday. Its wording says so.

       windows        each { day, from, to }. day is 0 for Sunday, from and
                      to are whole hours, London time.
       oncePerWeek    true means the first window a man is caught by is the
                      only one he hears that week. False means every window
                      he is still unbooked at reaches him.

     No window may sit inside quiet hours; the test suite fails rather than
     ship one that does.

     KEEP THIS EQUAL TO BOOKING_RULES IN Code.gs. */
  booking: {
    on: true,
    oncePerWeek: false,
    windows: [
      { day: 0, from: 15, to: 16 },
      { day: 3, from: 18, to: 19 },
      { day: 6, from: 18, to: 19 }
    ]
  },

  /* ---- Authorised driver register --------------------------------------
     Only names here can be selected. Add someone before their first Sunday.
     Remove them and they disappear from every phone at the next refresh.
     The rota uses the Drivers tab in the spreadsheet, so add new people to
     both. Optional per driver: pin: "1234" */
  drivers: [
    { name: "Pst Kehinde",    role: "Minister in Charge" },
    { name: "Bro Asim",       role: "Coordinator" },
    { name: "Bro Adebola",    role: "Driver" },
    { name: "Bro Abiodun",    role: "Driver" },
    { name: "Bro Moses",      role: "Driver" },
    { name: "Pst Obamakinwa", role: "Driver" },
    { name: "Bro Tunde",      role: "Driver" },
    { name: "Bro Adesina",    role: "Driver" },
    { name: "Bro Calvin",     role: "Backup" }
  ],

  /* ---- Driving rota ----------------------------------------------------
     One name per Sunday, repeating. The spreadsheet is the official rota;
     these are the fallback when the phone cannot reach it.
     rotaAnchor must be a Sunday and must match PATTERN_ANCHOR in Code.gs. */
  rotaAnchor: "2026-08-02",

  /* North Liverpool. Four names, so it turns over every four Sundays.
     Counts from rotaAnchor above. */
  rotaPrimaryPattern: [
    "Bro Adebola",
    "Bro Abiodun",
    "Bro Moses",
    "Bro Asim"
  ],

  /* South Liverpool. Three names, so it turns over every three Sundays.

     Bro Tunde is first because he already knows the road. The other two
     shadow him on the opening Sunday and then take their turns.

     The two routes count from different Sundays and are not meant to line
     up: four and three only meet every twelve weeks, and nothing here needs
     them to meet at all. Each route simply takes its next turn.

     Leave this out entirely and the app shows North only, which is what it
     did before the South route started. */
  rotaSecondaryPattern: [
    "Bro Tunde",
    "Pst Obamakinwa",
    "Bro Adesina"
  ],

  /* The first Sunday the South route actually ran. It counts from here, not
     from rotaAnchor, and the South line stays blank before this date because
     there was no South run to record. Must match PATTERN_ANCHOR_SOUTH in
     Code.gs. */
  rotaSecondaryAnchor: "2026-08-16"

};

/* ==========================================================================
   VEHICLES

     dates     renewal dates as YYYY-MM-DD. Within 30 days shows amber,
               past shows red. Leave one as "" and it is not tracked.
     watch     per-vehicle fault history from past MOTs, keyed by check id.
               This is what makes the app worth using: it tells a driver what
               has actually gone wrong on this bus before.
     skip      ids of checks this vehicle does not have
     override  reword a check for this vehicle when it has the thing in a
               different form. Use skip only when it does not have it at all.
   ========================================================================== */

window.VEHICLES = [

  /* ---------------------------------------------------------------------- */
  {
    reg: "YS70 PWE",
    id: "ys70pwe",
    name: "Ford Transit 460 Trend EcoBlue",
    detail: "2020 \u00B7 1,995cc diesel \u00B7 manual \u00B7 17 seats including driver",
    colour: "Silver",

    dates: {
      mot:       "2027-06-17",
      service:   "2027-06-17",
      insurance: "2027-06-26",
      permit:    "2027-01-31"
    },

    /* Factory fitted: retractable step, reversing camera, head up display,
       electrically folding mirrors. */
    override: {
      step: {
        name: "Retractable step",
        what: "Deploys and retracts fully and smoothly every time. Tread not worn smooth. Step light works."
      },
      reverse_aid: {
        name: "Reversing camera and sensors",
        what: "Select reverse with the engine running. Camera picture clear, not fogged, frozen or black. Parking sensors bleeping. Lens on the tailgate wiped clean."
      },
      mirrors: {
        name: "Mirrors, wipers and washers",
        what: "Both mirrors folded out before you move: electric on this bus, at the button. Glass clean, adjusted and secure. Blades not torn. Washers reaching the screen."
      },
      infotainment: {
        name: "Radio, screen and head up display",
        what: "Radio and speakers working front and rear. Screen not stuck on a warning. Head up display showing and not obscuring your view."
      }
    },

    /* What to do, not what happened. The reasons behind each of these are in
       FLEET-HISTORY.md, which is for whoever books the bus in. A driver at
       eight on a Sunday morning needs the instruction, not the file. */
    watch: {
      tyres:  "Report edge wear even when there is plenty of tread left.",
      fbrake: "Report scoring, a deep lip, or one side cleaner than the other, even if the brakes feel fine.",
      bfluid: "Any drop since last week is a report, not a top up.",
      step:   "Work it three times, out and back. Report anything slow, notchy or noisy.",
      abs:    "The lamp must go out once you move off. If it stays on, report before loading.",
      brakes: "Grinding or pulling to one side is a stop, not a note."
    },
    skip: ["wheelchair"]
  },

  /* ---------------------------------------------------------------------- */
  {
    reg: "NH56 FWP",
    id: "nh56fwp",
    name: "Ford Transit 100 RWD",
    detail: "2007 \u00B7 2,402cc diesel \u00B7 manual \u00B7 15 seats including driver",
    colour: "White",

    dates: {
      mot:       "2027-04-28",
      service:   "2027-07-01",
      insurance: "2027-07-08",
      permit:    "2027-01-31"
    },

    /* As above: instructions only. The history is in FLEET-HISTORY.md. */
    watch: {
      corrosion:
        "Report flaking, bubbling or soft metal at the sills, underbody, and where the body meets the chassis. Look hardest at the cab mountings on all four corners.",
      pipes:
        "Any damp or wet patch along the chassis rails or behind a wheel is a stop.",
      bfluid:
        "Any drop since last week is a leak until proven otherwise. Do not top it up and drive.",
      brakes:
        "Test the handbrake on a slope every time, so you would know at once if it ever slipped.",
      suspension:
        "Report knocking over bumps.",
      lights:
        "Check the lenses themselves for cracks, not only that the bulbs light up."
    },

    /* No retractable step and no side step: you step straight in through the
       side door. There is a fixed step at the rear. */
    override: {
      reverse_aid: {
        name: "Reversing camera and sounder",
        what: "Select reverse: picture appears and is not fogged or rolling, and the sounder is audible from outside. Camera and its cable at the rear still secure. If either has failed, do not reverse without someone guiding you."
      },
      mirrors: {
        name: "Mirrors, wipers and washers",
        what: "Both mirrors folded out and firm: they fold by hand on this bus, so check they have not been knocked in. Glass clean and adjusted. Blades not torn. Washers reaching the screen."
      },
      infotainment: {
        name: "Radio and speakers",
        what: "Radio and speakers working front and rear."
      },
      step: {
        name: "Rear step and door thresholds",
        what: "Fixed rear step secure, not loose or lifting at the edge, and not slippery. Side door threshold free of a trip lip. No retractable step on this bus, so check the drop at the side door is clear and lit."
      }
    },

    /* No AdBlue on a 2007 diesel. No wheelchair equipment on either bus. */
    skip: ["adblue", "wheelchair"]
  }

];
