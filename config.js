/* ==========================================================================
   CONFIG — the only file you should normally need to edit.
   After changing it, bump CACHE in sw.js so phones pick it up.
   ========================================================================== */

window.CONFIG = {

  /* The Apps Script Web App URL. Blank means practice mode: nothing is sent. */
  endpoint: "https://script.google.com/macros/s/AKfycbxS-2KqOjCWCwTkoNWgOOsB-TfGYShkSkvQJC6ItfpGINj7DJ6CRYuTxpXQip1R1XxMSA/exec",

  /* Must match the token in Code.gs. */
  token: "dominion-minibus",

  /* Who drivers ring when a bus is stopped. Keep the number dialable. */
  coordinator: { name: "Asim Bassey", phone: "07377634214" },

  /* ---- Where the check was done ----------------------------------------
     Records one location when an inspection starts, so a walkaround can be
     shown to have happened at the bus rather than at somebody's kitchen
     table. Nothing is recorded when a driver is only looking at the rota,
     and there is no tracking of any kind between checks.

     It never blocks a check. If the phone refuses or has no signal, the
     inspection carries on and the record says why there is no location.

     Set false to turn it off entirely. */
  recordLocation: true,

  /* Where the buses are kept: 3-5 Chester Road, Liverpool L6 4DY.

     Measured standing at the bus, not taken off a map. The postcode centre
     was 103 metres out, which is why this is worth doing once.

     radius is how far from this point still counts as being at the buses,
     in YARDS. 165 covers parking further along the road on a busy Sunday.
     The app only calls a check "away" when the phone's own accuracy figure
     leaves no doubt, so a poor fix never accuses anyone. */
  busBase: { lat: 53.424169, lng: -2.936799, radius: 165 },

  /* Drivers key in a four digit PIN before they can start a check.

     Set them in the PIN column of the Drivers tab in the spreadsheet, not
     here. The last four digits of a person's own phone number work well:
     nobody forgets their own number, which was the thing that made PINs
     unworkable before. Any four digits will do though.

     The PIN itself never leaves the spreadsheet. The app is sent a one way
     fingerprint of it and compares that, so the numbers cannot be read off
     the endpoint. Worth being clear all the same: four digits are few enough
     that anyone determined can work through them, and people who know each
     other tend to know each other's phone numbers. This stops a driver
     casually picking the wrong name, and makes signing as somebody else a
     deliberate act rather than an easy one. It is not a security boundary.

     A driver with no PIN in the sheet is not asked for one, so adding
     somebody never locks them out. Set false to turn the whole thing off. */
  requirePin: true,

  /* Who is offered the full inspection as well as the pre-drive check.
     Matched against the role in the register below, so adding a second
     coordinator is a one word change. Everyone else only ever sees the
     pre-drive check and is not shown a choice. */
  fullInspectionRoles: ["Coordinator", "Minister in Charge"],

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
        what: "Select reverse with the engine running. Factory camera picture clear on the screen, not fogged, frozen or black. Parking sensors bleeping. Lens on the tailgate wiped clean."
      },
      mirrors: {
        name: "Mirrors, wipers and washers",
        what: "Both mirrors folded OUT before you move: they are electric on this bus and fold at the button. Glass clean, adjusted, secure. Blades not torn. Washers reaching the screen."
      },
      infotainment: {
        name: "Radio, screen and head up display",
        what: "Radio and speakers working front and rear so you can be heard. Screen not stuck on a warning. Head up display showing and not obscuring your view."
      }
    },

    watch: {
      tyres:  "Worn on the edge front and rear at past tests. Edge wear means something is out of line, so report it even if there is plenty of tread.",
      fbrake: "Front pads were dangerously thin in 2024 and were worn again within 1,360 miles. Something here wears faster than it should.",
      bfluid: "A dropping level means pad wear or a leak. The front brakes on this bus already have history.",
      step:   "Flagged at three separate tests since 2023 and never repaired before we bought it. Assume it is the weakest thing on the bus.",
      abs:    "Failed its MOT on this exact lamp in June 2026 and passed the same day. We have no proof anything was replaced.",
      brakes: "The front brake wear rate on this bus does not add up. Grinding or pulling is a stop, not a note."
    },
    skip: []
  },

  /* ---------------------------------------------------------------------- */
  {
    reg: "NH56 FWP",
    id: "nh56fwp",
    name: "Ford Transit 100 17-seat RWD",
    detail: "2007 \u00B7 2,402cc diesel \u00B7 manual \u00B7 15 seats including driver",
    colour: "White",

    dates: {
      mot:       "2027-04-28",
      service:   "2027-07-01",
      insurance: "2027-07-08",
      permit:    "2027-01-31"
    },

    watch: {
      corrosion:
        "The cab mountings on all four corners were repaired and independently inspected in April 2026, which is why it passed. Repaired areas are still the ones worth watching, because the metal around them is the same age. Report flaking, bubbling or soft metal at the sills, underbody or where the body meets the chassis.",
      pipes:
        "A brake pipe was replaced after a leak in January 2025. Pipes of this age tend to go one at a time, so keep looking. Any damp or wet patch along the chassis rails or behind a wheel is a stop.",
      bfluid:
        "Because of the pipe history, a level that has dropped since last week means a leak until proven otherwise. Do not top it up and drive.",
      brakes:
        "The parking brake and a brake cable were put right in early 2025. Test the handbrake on a slope every single time so you would notice if it ever slipped again.",
      suspension:
        "An anti-roll bar ball joint was replaced in 2025 and a leaf spring bush was flagged in 2015. Knocking over bumps is worth reporting on a vehicle this age.",
      lights:
        "A cracked rear stop lamp lens failed it in 2025. Check the lenses themselves, not just that the bulbs light up."
    },

    /* No retractable step and no side step: you step straight in through the
       side door. There is a fixed step at the rear. */
    override: {
      reverse_aid: {
        name: "Reversing camera and sounder",
        what: "Aftermarket kit on this bus, so check it properly. Select reverse: picture appears and is not fogged or rolling, and the sounder is audible from outside. Check the camera and its cable at the rear are still secure. If either has failed, do not reverse without someone guiding you."
      },
      mirrors: {
        name: "Mirrors, wipers and washers",
        what: "Both mirrors folded OUT and firm: they fold by hand on this bus, so check they have not been knocked in or left loose. Glass clean and adjusted. Blades not torn. Washers reaching the screen."
      },
      infotainment: {
        name: "Radio and speakers",
        what: "Radio and speakers working front and rear so you can be heard down the bus."
      },
      step: {
        name: "Rear step and door thresholds",
        what: "Fixed rear step secure, not loose or lifting at the edge, and not slippery. Side door threshold free of a trip lip. This bus has no retractable step, so passengers step straight in: check the drop is clear and lit."
      }
    },

    /* No AdBlue on a 2007 diesel. */
    skip: ["adblue"]
  }

];
