/* ==========================================================================
   CONFIG — the only file you should normally need to edit.
   After changing it, bump CACHE in sw.js so phones pick it up.
   ========================================================================== */

window.CONFIG = {

  /* ---- Where checks are sent -------------------------------------------
     Paste the Apps Script Web App URL here after deploying it.
     It looks like: https://script.google.com/macros/s/AKfy..../exec
     Until this is filled in, the app runs in practice mode and sends nothing. */
  endpoint: "https://script.google.com/macros/s/AKfycbxS-2KqOjCWCwTkoNWgOOsB-TfGYShkSkvQJC6ItfpGINj7DJ6CRYuTxpXQip1R1XxMSA/exec",

  /* Must match the token in Code.gs. It stops stray traffic writing to the
     sheet. It is visible in the page source, so it is a lock on the door,
     not a safe. Keep the sheet itself private. */
  token: "dominion-minibus",

  /* Who drivers ring when a bus is stopped. The number becomes a tappable
     call button on the stop screen, so keep it in a dialable form. */
  coordinator: { name: "Asim Bassey", phone: "07377634214" },

  /* ---- Optional PIN ----------------------------------------------------
     Off by default. Turn it on and any driver with a "pin" below must key it
     in before continuing.

     Be clear about what this is: the app is static files, so the PINs are
     readable by anyone who views the page source. It is a speed bump that
     stops one driver casually selecting another's name. It is not security,
     and it will not stop anyone determined. Weigh that against a volunteer
     who has forgotten four digits at seven on a wet Sunday morning. */
  requirePin: false,

  /* ---- Authorised driver register --------------------------------------
     Everyone the leadership has approved to drive a church bus.
     Shown as a dropdown, with the role beside the name.

     THIS LIST IS THE REGISTER. Only names here can be selected, and the app
     offers no way round it. If someone is newly approved, add them here
     before their first Sunday. If someone should no longer drive, remove
     them and they disappear from every phone at the next refresh.

     Optional per driver: pin: "1234"  (only used when requirePin is true) */
  drivers: [
    { name: "Pst Kehinde", role: "Minister in Charge" },
    { name: "Bro Asim",    role: "Coordinator" },
    { name: "Bro Adebola", role: "Driver" },
    { name: "Bro Abiodun", role: "Driver" },
    { name: "Bro Moses",   role: "Driver" },
    { name: "Bro Calvin",  role: "Backup" },
    { name: "Bro Tunde",   role: "Backup" }
  ]

};

/* ==========================================================================
   VEHICLES

     dates    renewal dates as YYYY-MM-DD. Anything within 30 days raises a
              pulsing amber banner; anything past raises a red one.
                mot        annual test expiry
                service    next scheduled service
                insurance  policy renewal
                permit     parking permit renewal
              Leave a date as "" and it is not tracked at all.

     >>> THE MOT DATES BELOW ARE REAL, TAKEN FROM THE DVSA RECORD.
     >>> THE SERVICE, INSURANCE AND PERMIT DATES ARE PLACEHOLDERS.
     >>> Replace them with the true dates before drivers rely on the banner.
     >>> They are set deliberately close so you can see the banner working:
     >>> YS70 service is due soon (amber), NH56 service reads overdue (red).

     watch    per-vehicle fault history, keyed by check item id
     skip     ids of checks that do not apply to this vehicle
   ========================================================================== */

window.VEHICLES = [

  /* ---------------------------------------------------------------------- */
  {
    reg: "YS70 PWE",
    id: "ys70pwe",
    name: "Ford Transit 460 Trend",
    detail: "2020 \u00B7 silver \u00B7 manual \u00B7 57,363 miles",
    colour: "Silver",

    dates: {
      mot:       "2027-06-17",   // real, from the DVSA record
      service:   "2026-08-28",   // PLACEHOLDER
      insurance: "2027-02-01",   // PLACEHOLDER
      permit:    "2026-11-30"    // PLACEHOLDER
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
    name: "Ford Transit",
    detail: "2007 \u00B7 white \u00B7 manual \u00B7 53,280 miles",
    colour: "White",

    dates: {
      mot:       "2027-04-28",   // real, from the DVSA record
      service:   "2026-07-20",   // PLACEHOLDER, deliberately in the past
      insurance: "2027-03-15",   // PLACEHOLDER
      permit:    "2026-09-01"    // PLACEHOLDER
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

    /* No AdBlue on a 2007 diesel. */
    skip: ["adblue"]
  }

];
