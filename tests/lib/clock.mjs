/* A fixed clock, for the sweeps that only fire inside a window.

   Three of the things this app does are decided by what time it is in
   Liverpool: the driver's "you are driving today", the passenger's first
   message of the morning, and the three booking nudges. None of them can be
   tested by waiting until Saturday evening.

   The Worker has no clock of its own — it reads `new Date()` when Apps
   Script's five minute sync calls in — so moving the global Date is moving
   the only clock it has. Everything else about Date keeps working: parsing,
   arithmetic, a Date built from a number. Only "what time is it now" is
   answered differently. */

export async function atTime(iso, fn) {
  const fixed = new Date(iso).getTime();
  if (!isFinite(fixed)) throw new Error("atTime was given something that is not a time: " + iso);
  const Real = globalThis.Date;

  class Fixed extends Real {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() { return fixed; }
  }
  /* parse and UTC are inherited, but being explicit costs nothing and means a
     future change to Date cannot quietly drop them. */
  Fixed.parse = Real.parse;
  Fixed.UTC = Real.UTC;

  globalThis.Date = Fixed;
  try { return await fn(); }
  finally { globalThis.Date = Real; }
}

/* The Sunday this project's fixtures are about, and the days around it, as
   London times. Written out rather than computed so a reader can see which
   day of the week each one is. */
export const WHEN = {
  sundayEarly:     "2026-09-27T06:40:00+01:00",   /* before the window   */
  sundayMorning:   "2026-09-27T07:45:00+01:00",   /* inside it           */
  sundayLate:      "2026-09-27T09:10:00+01:00",   /* after it            */
  sundayRunning:   "2026-09-27T10:05:00+01:00",   /* bookings closed, bus out */
  sundayAfternoon:  "2026-09-27T15:20:00+01:00",  /* booking nudge, 1 of 3 */
  mondayAfternoon:  "2026-09-28T15:20:00+01:00",  /* same hour, wrong day  */
  wednesdayEvening: "2026-09-30T18:30:00+01:00",  /* booking nudge, 2 of 3 */
  thursdayEvening:  "2026-10-01T18:30:00+01:00",  /* NOT a nudge any more  */
  saturdayEvening:  "2026-10-03T18:30:00+01:00",  /* booking nudge, 3 of 3 */
  saturdayNight:    "2026-10-03T23:30:00+01:00"   /* quiet hours           */
};
