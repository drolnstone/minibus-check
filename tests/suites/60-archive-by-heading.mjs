/* THE ARCHIVE MATCHES COLUMNS BY HEADING.
   sheet v1.110.0; from v1.112.0 text goes across as text.

   7 October: v1.110.0 wrote "07514433370" bare, Sheets read it back as
   7514433370, the copy did not verify and stayed on the archive anyway.
   Now text is written with an apostrophe, a copy that does not verify comes
   off again, and the leftover from that night is cleared once the row has
   moved properly.

   On 6 October 2026 the 3am tidy-up moved nothing off Bus Bookings: the live
   tab has Scheduled after Seats and Live ID before Passenger ID, and the
   archive tab, made months earlier, has them the other way round. The mover
   compared by position and refused. Now each value goes under its own
   heading in the archive, so the live tab's order no longer matters.

   Fails on v1.109.0. */

import { Suite } from "../lib/t.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { atTime } from "../lib/clock.mjs";

const TUE = "2026-10-06T03:00:00+01:00";        /* the 3am run; cut-off 30 August */

/* The two heading rows exactly as they were on Asim's sheet on 4 October. */
const LIVE = ["Received", "Sunday", "Route", "Stop ID", "Stop", "Seats", "Scheduled",
              "Device", "Status", "Phone", "Live ID", "Passenger ID"];
const ARCH = ["Received", "Sunday", "Route", "Stop ID", "Stop", "Seats",
              "Device", "Status", "Phone", "Passenger ID", "Live ID"];

function liveRow(sunday, phone, live, pid) {
  return [new Date("2026-08-20T10:00:00+01:00"), new Date(sunday), "North", "N01",
          "Scarisbrick Drive by Ardville Road", 2, "10:12", "dev1", "Booked",
          phone, live, pid];
}

function bookingsSpec(L) {
  return call(L, "archivePlan").filter((p) => p.tab === "Bus Bookings")[0];
}

let ROOT;
function load(liveRows, archRows, liveHead) {
  const L = loadCodeGs(ROOT, {
    tabs: {
      "Bus Bookings": [liveHead || LIVE].concat(liveRows),
      "Bus Bookings (archive)": [ARCH].concat(archRows || [])
    }
  });
  likeSheets(L, "Bus Bookings (archive)");
  return L;
}

/* Sheets, not the fake: text written without an apostrophe is read as a
   number or a time when it looks like one, and an apostrophe is dropped. */
function likeSheets(L, name) {
  const sh = L.gas.globals.SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  const set = sh._set.bind(sh);
  sh._set = (r, c, v) => {
    if (typeof v === "string") {
      if (v.startsWith("'")) v = v.slice(1);
      else if (/^\d+$/.test(v)) v = Number(v);
      else if (/^\d{1,2}:\d{2}$/.test(v)) {
        const [h, m] = v.split(":").map(Number);
        v = new Date(1899, 11, 30, h, m);
      }
    }
    set(r, c, v);
  };
  return sh;
}

function byHead(sh) {
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const h = v[0].map(String);
  return v.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

export default function (root) {
  const s = new Suite("the archive matches columns by heading");
  ROOT = root;

  s.test("Bus Bookings in a different order from its archive still moves", async (a) => {
    await atTime(TUE, () => {
      const L = load([
        liveRow("2026-08-23T00:00:00+01:00", "07514433370", "41", "fp-old"),
        liveRow("2026-10-11T00:00:00+01:00", "07700900123", "99", "fp-new")
      ]);
      const out = call(L, "archiveTab", bookingsSpec(L), false);
      a.eq(out.note, "", "refused: " + out.note);
      a.eq(out.moved, 1);
      const ss = L.gas.globals.SpreadsheetApp.getActiveSpreadsheet();
      const arch = byHead(ss.getSheetByName("Bus Bookings (archive)"));
      a.eq(arch.length, 1);
      a.eq(arch[0]["Phone"], "07514433370");
      a.eq(arch[0]["Passenger ID"], "fp-old");
      a.eq(arch[0]["Live ID"], "41");
      a.eq(arch[0]["Scheduled"], "10:12", "Scheduled is added to the archive and filled");
      a.eq(arch[0]["Device"], "dev1");
      const live = byHead(ss.getSheetByName("Bus Bookings"));
      a.eq(live.length, 1);
      a.eq(live[0]["Passenger ID"], "fp-new");
    });
  });

  s.test("rows already in the archive are left where they are", async (a) => {
    await atTime(TUE, () => {
      const old = ["r", new Date("2026-08-16T00:00:00+01:00"), "South", "S04", "Hannan",
                   3, "d8", "Booked", "07000000001", "fp-aug", "7"];
      const L = load([liveRow("2026-08-23T00:00:00+01:00", "07514433370", "41", "fp-old")], [old]);
      call(L, "archiveTab", bookingsSpec(L), false);
      const ss = L.gas.globals.SpreadsheetApp.getActiveSpreadsheet();
      const arch = byHead(ss.getSheetByName("Bus Bookings (archive)"));
      a.eq(arch.length, 2);
      a.eq(arch[0]["Passenger ID"], "fp-aug");
      a.eq(arch[0]["Live ID"], "7");
      a.eq(arch[1]["Passenger ID"], "fp-old");
    });
  });

  s.test("a column with no heading but with entries is still refused", async (a) => {
    await atTime(TUE, () => {
      const r = liveRow("2026-08-23T00:00:00+01:00", "07514433370", "41", "fp-old").concat(["a note"]);
      const L = load([r], [], LIVE.concat([""]));
      const out = call(L, "archiveTab", bookingsSpec(L), false);
      a.eq(out.moved, 0);
      a.has(out.note, "nothing moved");
      const ss = L.gas.globals.SpreadsheetApp.getActiveSpreadsheet();
      a.eq(ss.getSheetByName("Bus Bookings").getLastRow(), 2, "the live row stays");
    });
  });

  s.test("the same heading twice on the live tab is still refused", async (a) => {
    await atTime(TUE, () => {
      const head = LIVE.slice(); head[11] = "Phone";
      const L = load([liveRow("2026-08-23T00:00:00+01:00", "07514433370", "41", "fp-old")], [], head);
      const out = call(L, "archiveTab", bookingsSpec(L), false);
      a.eq(out.moved, 0);
      a.has(out.note, "nothing moved");
    });
  });

  s.test("a phone number and a time go across as text, as they are on the live tab", async (a) => {
    await atTime(TUE, () => {
      const L = load([liveRow("2026-08-23T00:00:00+01:00", "07514433370", "41", "fp-old")]);
      const out = call(L, "archiveTab", bookingsSpec(L), false);
      a.eq(out.note, "", "refused: " + out.note);
      a.eq(out.moved, 1);
      const ss = L.gas.globals.SpreadsheetApp.getActiveSpreadsheet();
      const arch = byHead(ss.getSheetByName("Bus Bookings (archive)"));
      a.eq(arch[0]["Phone"], "07514433370");
      a.eq(arch[0]["Scheduled"], "10:12");
      a.eq(arch[0]["Live ID"], "41");
      a.eq(ss.getSheetByName("Bus Bookings").getLastRow(), 1, "the live row has gone");
    });
  });

  s.test("a copy that does not verify comes off the archive again", async (a) => {
    await atTime(TUE, () => {
      const L = load([liveRow("2026-08-23T00:00:00+01:00", "07514433370", "41", "fp-old")]);
      const arch = L.gas.globals.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Bus Bookings (archive)");
      const set = arch._set.bind(arch);
      arch._set = (r, c, v) => set(r, c, typeof v === "string" && v.indexOf("07514") >= 0 ? "mangled" : v);
      const out = call(L, "archiveTab", bookingsSpec(L), false);
      a.eq(out.moved, 0);
      a.has(out.note, "did not verify");
      a.eq(arch.getLastRow(), 1, "nothing left on the archive");
      const ss = L.gas.globals.SpreadsheetApp.getActiveSpreadsheet();
      a.eq(ss.getSheetByName("Bus Bookings").getLastRow(), 2, "the live row stays");
    });
  });

  s.test("a failed night's leftover copy is cleared when the row moves properly", async (a) => {
    await atTime(TUE, () => {
      const r = liveRow("2026-08-23T00:00:00+01:00", "07514433370", "41", "fp-old");
      /* What v1.110.0 left on 7 October: the same booking, in the archive's
         order, with Sheets' reading of the text. */
      const leftover = [r[0], r[1], r[2], r[3], r[4], r[5], new Date(1899, 11, 30, 10, 11),
                        r[7], r[8], 7514433370, 41, r[11]];
      const keep = ["x", new Date("2026-08-16T00:00:00+01:00"), "South", "S04", "Hannan",
                    3, "", "d8", "Booked", "07000000001", "7", "fp-aug"];
      const head = ARCH.slice(0, 6).concat(["Scheduled"], ARCH.slice(6, 9), ["Live ID", "Passenger ID"]);
      const L = loadCodeGs(ROOT, { tabs: {
        "Bus Bookings": [LIVE, r],
        "Bus Bookings (archive)": [head, keep, leftover]
      } });
      likeSheets(L, "Bus Bookings (archive)");
      const out = call(L, "archiveTab", bookingsSpec(L), false);
      a.eq(out.note, "", "refused: " + out.note);
      a.eq(out.moved, 1);
      const ss = L.gas.globals.SpreadsheetApp.getActiveSpreadsheet();
      const arch = byHead(ss.getSheetByName("Bus Bookings (archive)"));
      a.eq(arch.length, 2, "one copy of each booking");
      a.eq(arch[0]["Passenger ID"], "fp-aug");
      a.eq(arch[1]["Phone"], "07514433370");
    });
  });

  return s;
}
