"""The spreadsheet, as the manual's pictures need it.

    python3 manual/export.py "Minibus checks.xlsx" manual/build/real.json

Reads a download of the coordinator's spreadsheet (File, Download, Microsoft
Excel) and writes the stops, buses, drivers, rota and the coordinator in the
shape tests/browser/lib.mjs answers from. Names, roles and routes only from
the Drivers tab: no PIN and no email, and one phone number, the coordinator's,
because the app shows it on every stopped bus. The output lives in
manual/build/, which git ignores. Nothing from the spreadsheet is committed."""
import datetime, json, os, re, sys
import openpyxl

src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, data_only=True)

def rows(tab):
    ws = wb[tab]
    it = ws.iter_rows(values_only=True)
    head = [str(h or "").strip() for h in next(it)]
    for r in it:
        if any(v not in (None, "") for v in r):
            yield dict(zip(head, r))

def yes(v): return str(v or "").strip().upper() in ("YES", "Y", "TRUE", "1")
def hhmm(v): return v.strftime("%H:%M") if isinstance(v, (datetime.time, datetime.datetime)) else str(v or "")
def day(v): return v.strftime("%Y-%m-%d") if isinstance(v, datetime.datetime) else ""

stops = [{"id": r["Stop ID"], "route": r["Route"], "time": hhmm(r["Time"]), "stop": r["Stop"],
          "postcode": r["Postcode"], "active": yes(r["Active"]), "kind": str(r["Type"] or "").lower(),
          "lat": r.get("Lat"), "lng": r.get("Lng")}
         for r in rows("Bus Stops") if r.get("Route")]

buses = [{"reg": r["Registration"], "seats": int(r["Seats for passengers"] or 0), "active": yes(r["Active"]),
          "notes": r.get("Notes") or "",
          "dates": {"mot": day(r.get("MOT due")), "service": day(r.get("Service due")),
                    "insurance": day(r.get("Insurance due")), "permit": day(r.get("Permit due"))},
          "odd": r.get("Route in odd months") or ""}
         for r in rows("Buses") if r.get("Registration")]

drivers, coordinator = [], None
for r in rows("Drivers"):
    if not r.get("Name"): continue
    drivers.append({"name": r["Name"], "role": r.get("Role") or "", "active": yes(r.get("Active")),
                    "route": r.get("Route") or "", "ord": r.get("Primary order") if r.get("Primary order") not in (None, "") else 99})
    if coordinator is None and str(r.get("Role") or "").strip().lower() == "coordinator":
        phone = re.sub(r"[^0-9]", "", str(r.get("Phone") or ""))
        if phone.startswith("44"): phone = "0" + phone[2:]      # the 07 form the pages dial
        coordinator = {"name": r["Name"], "phone": phone}

rota = [{"sunday": day(r["Sunday"]), "north": r.get("North Liverpool scheduled") or "",
         "northCover": r.get("North Liverpool actual / cover") or "", "northBus": r.get("North bus") or "",
         "status": r.get("Status") or "", "south": r.get("South Liverpool scheduled") or "",
         "southCover": r.get("South Liverpool actual / cover") or "", "southBus": r.get("South bus") or ""}
        for r in rows("Rota") if isinstance(r.get("Sunday"), datetime.datetime)]

if not coordinator: sys.exit("No row with Role Coordinator on the Drivers tab.")
if not any(r["sunday"] == "2026-09-27" for r in rota):
    sys.exit("The Rota tab has no row for Sunday 27 September 2026, the morning the pictures are staged on.")

os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
json.dump({"stops": stops, "buses": buses, "drivers": drivers, "rota": rota, "coordinator": coordinator},
          open(out, "w"), indent=1, default=str)
print("%d stops, %d buses, %d drivers, %d rota rows, coordinator %s" %
      (len(stops), len(buses), len(drivers), len(rota), coordinator["name"]))
