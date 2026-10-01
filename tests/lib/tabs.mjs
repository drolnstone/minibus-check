/* THE REAL HEADER ROWS, TAKEN OFF THE REAL SPREADSHEET.

   Three faults this week came from a fixture that agreed with the code instead
   of with the tab:

     Bus Stops    my fixture said "Grace Rd". The tab says "Grace Road bus
                  stop, Walton Vale". fillStopPins matched on the name with
                  ===, so nineteen rows came out blank on a live deployment and
                  the guard was working exactly as written.

     Checks       my fixture called the date column "When". It is "Date".
                  colsSoft resolves by name, so nothing matched, every bus read
                  as unchecked, and two checks passed for the wrong reason.

     Bus Bookings my fixture said "Passenger" and invented a "Note" column.
                  The tab says "Passenger ID" and has no Note. The correct
                  header already existed in 20-sheet.mjs — I wrote a second,
                  wrong one rather than reuse it, which is the worse mistake of
                  the two, because a duplicate can drift and a shared one
                  cannot.

   So they live here, once, copied from an export of the live sheet on
   26 September 2026, and every fixture builds from them. A fixture written
   from the code agrees with the code about everything, including being wrong.

   WHEN A TAB CHANGES, CHANGE IT HERE. 01-stamps.mjs checks that no suite
   carries a header of its own. */

export const TABS = {
  "Trip Events": ["Logged", "Trip", "Sunday", "Route", "Driver", "Event", "Stop ID",
                  "Stop", "Scheduled", "Happened", "Offset", "Status", "Reg",
                  "Rota bus", "Where started", "Accuracy (yd)",
                  "Distance from base (yd)", "Ended by", "Live ID"],

  "Buses": ["Registration", "Seats for passengers", "Active", "Notes", "MOT due", "Service due", "Insurance due", "Permit due", "Route in odd months"],

  "Bus Stops": ["Route", "Stop ID", "Time", "Stop", "Postcode", "Active", "Type",
                "Where", "Lat", "Lng"],

  "Bus Bookings": ["Received", "Sunday", "Route", "Stop ID", "Stop", "Seats",
                   "Device", "Status", "Phone", "Passenger ID", "Live ID"],

  "Drivers": ["Name", "Role", "Active", "Primary order", "PIN", "Email", "Route",
              "Phone"],

  "Rota": ["Sunday", "North Liverpool scheduled", "North Liverpool actual / cover",
           "North bus", "Status", "South Liverpool scheduled",
           "South Liverpool actual / cover", "South bus", "Notes", "Updated",
           "Updated by"],

  "Rota Requests": ["Received", "Request ID", "Sunday", "Driver", "Type", "Reason",
                    "Preferred swap", "Status", "Decided on",
                    "Replacement assigned", "Their Sunday", "Both agreed"],

  "Checks": ["Received", "Check ID", "Date", "Time", "Vehicle", "Registration",
             "Driver", "Role", "Mileage", "Mileage flag", "Outcome",
             "Items checked", "Defect count", "Defects", "Renewals due", "Signed",
             "Not applicable", "Check type", "Where checked", "Accuracy (yd)",
             "Distance from base (yd)", "Location note", "Fuel", "To arrange",
             "PIN check", "Advisory count", "Advisories", "Authorised by",
             "Authorised on"],

  "Defects": ["Received", "Check ID", "Date", "Registration", "Driver", "Item",
              "Critical", "What the driver found", "Status", "Action taken",
              "Closed on", "Kind"],

  /* Two tabs the sheet makes itself from v1.92.0, so these are Code.gs's own
     header rows rather than an export's. 36-vehicle-log.mjs checks the two
     agree. */
  "Vehicle Log": ["Recorded", "Log ID", "Registration", "What", "Status", "Date done",
                  "Booked for", "Was due", "Days early (-) or late (+)", "Next due",
                  "How the next date was worked out", "Certificate or policy date",
                  "Mileage", "Garage", "Cost (£)", "Defects put right", "Notes",
                  "Corrects", "Recorded by", "Source"],

  "History": ["When", "Who", "Where", "Registration", "What changed", "From", "To",
              "Why", "Ref"]
};

/* A row built BY COLUMN NAME, in the tab's own order, with every other cell
   left blank.

   The point is that a fixture cannot get the order wrong and cannot invent a
   column: a name the tab does not have throws here rather than being written
   into a cell nobody reads. Both of those have happened. */
export function row(tab, values) {
  const hdr = TABS[tab];
  if (!hdr) throw new Error("no such tab: " + tab);
  for (const k of Object.keys(values || {})) {
    if (hdr.indexOf(k) === -1) {
      throw new Error(tab + ' has no column "' + k + '". It has: ' + hdr.join(", "));
    }
  }
  return hdr.map((h) => (values && h in values ? values[h] : ""));
}

/* The header row plus however many rows, ready to drop into a fixture. */
export function tab(name, rows) {
  return [TABS[name]].concat((rows || []).map((r) => row(name, r)));
}
