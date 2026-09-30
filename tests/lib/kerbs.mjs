/* THIS CHURCH'S KERBS, AS A TEST FIXTURE.

   Until v1.88.0 these were STOP_PINS in Code.gs, which filled blank Lat and
   Lng cells on the Bus Stops tab. Code.gs ships it empty now, so a copy for
   another church does not start with Liverpool's pavements, but the filling
   still has to be tested against something real: the sheet suite puts these
   back into the loaded Code.gs before it runs. The comments are the ones
   they were shipped with. */

/* ---- THE KERBS ----------------------------------------------------------

   Supplied 21 September 2026, one per pickup, plus the church both routes
   start and end at.

   WHAT THIS DOES: on every "Set up / refresh rota" it fills any Lat or Lng
   cell that is EMPTY and whose Stop ID it recognises. It never overwrites a
   cell that has something in it, so a coordinate you correct by hand stays
   corrected, and running the setup twice changes nothing the second time.

   WHY IT IS HERE rather than being typed in once: because typing fifteen
   pairs of six-decimal numbers into a spreadsheet by hand is how a digit gets
   transposed, and a transposed digit in a coordinate is not a wrong answer
   that looks wrong — it is a stop that quietly moves half a mile and an
   estimate that is confidently incorrect about it.

   IT IS NOT THE AUTHORITY. The tab is. This only fills blanks, and a stop
   added later with no entry here simply stays blank, which is a state
   everything downstream already handles.

   Two of these were checked against figures measured independently: S03 to
   S04 comes out at 195 metres and N05 through N07 at 556, both exactly as
   reported. */
export const KERBS = {
  "N01": { stop: "Scarisbrick Drive", postcode: "L11 7DD", at: [53.449234, -2.936301] },
  "N02": { stop: "Grace Road",        postcode: "L9 2BU",  at: [53.463563, -2.959062] },
  "N03": { stop: "Litherland Road",   postcode: "L20 3HZ", at: [53.450731, -2.987178] },
  /* FOUNTAINS ROAD IS MISSING ON PURPOSE, and it is the reason the check
     below exists.

     It was supplied as 53.432320, -2.984024 and the coordinator asked whether that was
     right. It is not. Two things say so and they agree:

       The latitude is Stanley Park's. N08 is 53.432312 — EIGHT METRES away
       in latitude, for two stops a mile and an eighth apart. That is what a
       row copied from the wrong line looks like.

       It bends the route by a factor of 3.1. Every other stop on both routes
       sits between 1.0 and 1.3 — near enough on the line between the one
       before it and the one after. Fountains Road made the bus travel 3,831
       metres to cover a 1,221 metre gap, out towards the docks and back.

     The longitude is probably fine: -2.984024 sits neatly between Litherland
     Road and Bedford Road, which is where that road belongs. It is the
     latitude that came off the wrong row, and at roughly 53.4455 the detour
     drops to 1.2 and the route reads straight.

     ROUGHLY IS NOT GOOD ENOUGH TO SHIP. A wrong coordinate is worse than no
     coordinate: blank is visible and everything downstream handles it, while
     a plausible wrong number is believed. So it stays out until somebody
     stands on the kerb or reads it off a map, and the cell waits. */
  "N05": { stop: "Bedford Road",      postcode: "L4 5PU",  at: [53.446071, -2.970485] },
  "N06": { stop: "Pym Street",        postcode: "L4 5PH",  at: [53.444062, -2.969688] },
  "N07": { stop: "Wilburn Street",    postcode: "L4 3QN",  at: [53.441187, -2.970688] },
  "N08": { stop: "Stanley Park",      postcode: "L4 0TQ",  at: [53.432312, -2.956937] },
  "S01": { stop: "Dewsbury Road",     postcode: "L4 2XF",  at: [53.434771, -2.955519] },
  /* VICAR ROAD AND PARTON STREET ARE BOTH OUT, and for one reason between
     them: they were supplied with THE SAME LONGITUDE, -2.944937, to six
     decimal places. That is seven centimetres, on two roads a mile and an
     eighth apart. It is not a coincidence — it is one of the two carrying the
     other's number — and the same duplicate sits in the Where column of the
     Bus Stops tab, so it came in with the original survey rather than
     arriving here.

     Which of the two is wrong cannot be decided from this end. S03 to S04
     was measured independently at 195 metres and comes out at 195; N05
     through N07 at 556 and comes out at 556. Neither of these was ever
     checked against anything.

     So both wait. Twelve stops fill themselves and three want a pair of eyes,
     which is a better trade than one confident wrong pin: blank is visible
     and everything downstream handles it, while a plausible wrong number is
     believed by the estimate and by the driver's map link. */
  "S03": { stop: "Sedley Street",     postcode: "L4 2RB",  at: [53.425937, -2.952438] },
  "S04": { stop: "Breck Road",        postcode: "L6 5BJ",  at: [53.424312, -2.953563] },
  /* Parton Street — see the note on Vicar Road above. */
  "S06": { stop: "Hannan Road",       postcode: "L6 6AN",  at: [53.414313, -2.949187] },
  "S07": { stop: "Halsbury Road",     postcode: "L6 6AW",  at: [53.414732, -2.946951] }
};