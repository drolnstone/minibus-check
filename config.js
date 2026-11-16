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

  /* The sheet, by way of the live server. Blank sends nothing.

     Until v1.126.0 this was the Apps Script web app's own address. It is not
     written in any file now: the live server keeps it, as the sheet sends it,
     and passes on what is sent here. */
  endpoint: "https://minibus-api.asimbassey.workers.dev/sheet",

  /* ---- the live server -------------------------------------------------
     The calls that happen DURING a Sunday go here instead: the driver's stop
     taps and his Stops and bookings screen. It answers in well under a tenth
     of a second where Apps Script took two to eight, because there is no
     forced redirect to a second host and nothing has gone to sleep.

     Submitting a check comes here as well now. It used to go to endpoint
     above and wait, and on 20 September 2026 the wait was long enough to fail
     at the kerb. The sheet still gets every check; it just is not the thing
     a driver waits for.

     Asking for a rota change comes here first as well, from v1.76.0, and goes
     to endpoint above only if this does not answer. The rota and last
     mileage are read from here and fall back to endpoint above.

     TO GO BACK: blank this line. Every call goes to the sheet, by way of
     endpoint above, and the app behaves as it did before the live server,
     slowly but correctly. */
  liveEndpoint: "https://minibus-api.asimbassey.workers.dev",

  /* Must match the token in Code.gs. */
  token: "minibusapp",

  /* Who drivers and passengers ring when something has gone wrong is NOT set
     here. From v1.80.0 it is whoever has Role Coordinator on the Drivers tab,
     with the number in the Phone column beside him. The sheet sends it to the
     live server, which stamps it on every answer, and every page reads it from
     there. A change of coordinator is two cells on the Drivers tab. */

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
     it is offered to everybody who opens it, booked or not.

     Set false and it goes back to being a line. */
  alertPopup: true,

  /* ---- The coordinator's app, at coord/ ---------------------------------
     idleMinutes     how long it keeps your PIN while nobody touches it.
                     Then it locks and asks for the PIN again.
     refreshSeconds  how often an open screen asks the live server again. */
  coordApp: { idleMinutes: 15, refreshSeconds: 30 },

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
  autoEnd: { enabled: true, minutes: 1 },

  /* Drivers key in a four digit PIN before they can start a check.

     Never set here. From v1.96.0 every driver starts on the default PIN, the
     last four digits of the Phone on the Drivers tab, and can change it in
     the driver app; the coordinator's app resets it to the default. The live
     server is the only thing that knows a PIN: it keeps the default as a
     salted one-way fingerprint and a driver's own PIN the same way, and
     answers yes or no. No phone is ever sent a fingerprint.

     A driver with no phone number and no PIN of his own is not asked for
     one, so adding somebody never locks them out.

     Keep it true. From v1.123.0 the live server takes a driver's runs, stop
     taps, rota requests and MOT runs only once his PIN has been keyed on
     the phone, so false would hold every one of them. */
  requirePin: true,

  /* Who is offered the full inspection as well as the pre-drive check, and
     who may open the coordinator's app. Everyone else only ever sees the
     pre-drive check and is not shown a choice.

     From v1.81.0 this is only the starting point. The real list is
     COORDINATOR_ROLES in the sheet's Script Properties, and every page uses
     that once the live server has answered. Change the titles there, not
     here. Keep this equal to AUTHORISER_ROLES_DEFAULT in Code.gs. */
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

  /* ---- Authorised driver register --------------------------------------
     The Drivers tab in the spreadsheet is the register, and from v1.80.0 it
     is the only one. It reaches every phone with the rota and is kept there
     for when there is no signal. Left empty on purpose, so a new church starts
     with nobody in it rather than with this one's. */
  drivers: [],

  /* ---- Driving rota ----------------------------------------------------
     One name per Sunday, repeating. The spreadsheet is the official rota;
     these are the fallback when the phone cannot reach it.
     rotaAnchor must be a Sunday and must match PATTERN_ANCHOR in Code.gs. */
  rotaAnchor: "2026-08-02",

  /* The order each route's drivers take their turn is NOT set here. It is the
     Primary order column on the Drivers tab, one number per driver, counted
     separately for North and South, and it reaches the app with the rota.
     These stay empty so a new church starts with nobody in the pattern. */
  rotaPrimaryPattern: [],
  rotaSecondaryPattern: [],

  /* The first Sunday the South route actually ran. It counts from here, not
     from rotaAnchor, and the South line stays blank before this date because
     there was no South run to record. Must match PATTERN_ANCHOR_SOUTH in
     Code.gs. */
  rotaSecondaryAnchor: "2026-08-16"

};

/* ==========================================================================
   VEHICLES

     (renewal dates: the MOT due, Service due, Insurance due and Permit due
      columns on the Buses tab, not here. Within 30 days the app shows
      amber, past shows red, blank is not tracked.)
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
