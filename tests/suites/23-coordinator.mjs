/* THE COORDINATOR'S INBOX, ACROSS THE HOURS IT ACTUALLY ARRIVES IN.

   The passenger and driver messages were swept hour by hour and gave up five
   faults between them, every one the same sentence: RIGHT ANSWER, WRONG HOUR.
   The coordinator's emails were checked only for EXISTENCE — that silencing one
   turns a check red. Not for whether the words suit the moment they land in.

   That is a weaker standard and it was left that way on purpose for a day.
   This closes it.

   WHY THE RISK WAS ALWAYS LOWER, and it is worth saying rather than implying:
   an email is a thing that arrives once and is read once. It carries no live
   estimate, nothing about where a bus is now, and nothing that expires between
   being sent and being opened. The passenger faults were all in wording
   computed fresh when a phone asked, hours after the push; nothing here works
   that way.

   So what IS worth checking is the other half — the lead time. Six of these
   carry a time or a date in the words, and a sentence about "today" or "in a
   week" is a sentence that can be wrong on a different day. That, and whether
   two of them arrive about the same Sunday at once saying different things. */

import { Suite } from "../lib/t.mjs";
import { loadCodeGs, call } from "../lib/codegs.mjs";
import { atTime } from "../lib/clock.mjs";
import { TABS, tab } from "../lib/tabs.mjs";

/* Sunday 4 October 2026, so "a week out" and "two days out" are real dates
   rather than whatever today happens to be. */
const SUN = new Date(2026, 9, 4);
const KEY = "2026-10-04";

/* Every hour one of these emails can actually be sent. A walkaround arrives
   whenever a driver signs; the rest are on a clock. */
const WHEN = {
  weekBefore:   "2026-09-27T08:00:00+01:00",  /* duty reminder, 7 days   */
  twoDays:      "2026-10-02T08:00:00+01:00",  /* duty reminder, 2 days   */
  saturday:     "2026-10-03T18:00:00+01:00",  /* the evening before     */
  sundayEarly:  "2026-10-04T07:10:00+01:00",  /* before any walkaround  */
  walkaround:   "2026-10-04T09:35:00+01:00",  /* a driver signs and sends */
  unchecked:    "2026-10-04T10:45:00+01:00",  /* the Sunday sweep       */
  midRun:       "2026-10-04T10:30:00+01:00",
  digest:       "2026-10-04T19:00:00+01:00",  /* Sunday evening         */
  monday:       "2026-10-05T09:00:00+01:00"
};

export default async function (root) {
  const s = new Suite("the coordinator's inbox, hour by hour");

  function sheet(over) {
    const tabs = {
      "Bus Stops": tab("Bus Stops", [
        { Route: "North", "Stop ID": "N00", Time: "10:05", Stop: "Church, Chester Road",
          Postcode: "L6 4DY", Active: "YES", Type: "Depart" },
        { Route: "North", "Stop ID": "N02", Time: "10:23", Stop: "Grace Road bus stop, Walton Vale",
          Postcode: "L9 2BU", Active: "YES", Type: "Pickup", Lat: 53.463563, Lng: -2.959062 },
        { Route: "North", "Stop ID": "N09", Time: "11:00", Stop: "Church, Chester Road",
          Postcode: "L6 4DY", Active: "YES", Type: "Arrival" }]),
      "Drivers": tab("Drivers", [
        { Name: "Bro Asim", Role: "Coordinator", Active: "YES", "Primary order": 1,
          PIN: "1234", Email: "coord@b.c", Route: "North" },
        { Name: "Bro Adebola", Role: "Driver", Active: "YES", "Primary order": 2,
          PIN: "4321", Email: "ade@b.c", Route: "North" },
        { Name: "Bro Tunde", Role: "Driver", Active: "YES", "Primary order": 3,
          PIN: "8765", Email: "tunde@b.c", Route: "South" }]),
      "Buses": tab("Buses", [
        { Registration: "YS70 PWE", "Seats for passengers": 16, Active: "YES" },
        { Registration: "NH56 FWP", "Seats for passengers": 14, Active: "YES" }]),
      "Rota": tab("Rota", [
        { Sunday: SUN, "North Liverpool scheduled": "Bro Adebola", "North bus": "NH56 FWP",
          Status: "Confirmed", "South Liverpool scheduled": "Bro Tunde",
          "South bus": "YS70 PWE" }]),
      "Checks": tab("Checks", [
        { Received: new Date(2026, 8, 27, 9, 30), Date: new Date(2026, 8, 27), Time: "09:30",
          "Check ID": "old-1", Registration: "YS70 PWE", Driver: "Bro Adebola",
          Mileage: 48000, Outcome: "Cleared" },
        { Received: new Date(2026, 8, 27, 9, 35), Date: new Date(2026, 8, 27), Time: "09:35",
          "Check ID": "old-2", Registration: "NH56 FWP", Driver: "Bro Tunde",
          Mileage: 31000, Outcome: "Cleared" }]),
      "Defects": [TABS["Defects"]],
      "Trip Events": [TABS["Trip Events"]],
      "Bus Bookings": [TABS["Bus Bookings"]],
      "Rota Requests": [TABS["Rota Requests"]]
    };
    return loadCodeGs(root, { tabs: Object.assign(tabs, over || {}),
      props: { COORDINATOR_EMAIL: "coord@b.c", PIN_SALT: "salt",
               WORKER_URL: "https://example.invalid" } });
  }

  const mine = (L) => L.gas.mail.filter((m) => String(m.to).indexOf("coord@") === 0);
  const words = (h) => String(h || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");
  const both = (m) => words(m.htmlBody) + " " + String(m.body || "");

  /* THE SAME EMAIL, WITH THE NONCE TAKEN OUT.

     Two of these carry a decision link, and a link is 128 fresh bits every
     time it is minted. Comparing the raw text across hours therefore compares
     random numbers and fails for a reason that has nothing to do with the
     clock — which is exactly what it did, and I spent a while looking for a
     time bug that was a token. */
  const settled = (m) => (m.subject + " :: " + both(m))
    .replace(/[0-9a-f]{32}/g, "<token>")   /* a minted decision link         */
    .replace(/gid=\d+/g, "gid=<n>")        /* the fake's per-load sheet id   */
    .replace(/\s+/g, " ").trim();

  const CHECK = {
    id: "chk-1", reg: "YS70 PWE", vehicle: "Ford Transit", driver: "Bro Adebola",
    role: "Driver", date: "4 October 2026", time: "09:35", miles: 48213,
    sign: "Bro Adebola", advisories: [], jobs: []
  };

  /* ---- the ones with a clock in them ----------------------------------- */

  s.test("THE DUTY EMAIL SAYS HOW FAR OFF THE SUNDAY IS, AND IS RIGHT BOTH TIMES", async (a) => {
    /* The one genuinely lead-time-dependent sentence in the whole inbox. Seven
       days out it is "in a week"; two days out it is a plain number, because
       "in a couple of days" is the one phrasing here that could be read as
       either. Both were already covered — this pins them at the hours the
       trigger actually fires, which is eight in the morning. */
    const week = await atTime(WHEN.weekBefore, () => {
      const L = sheet();
      call(L, "sendDutyEmail", "ade@b.c", "Bro Adebola", SUN, 7, "", "North Liverpool", "NH56 FWP");
      return L.gas.mail[0];
    });
    a.has(both(week), "in a week", "seven days out: " + both(week).slice(0, 90));
    a.hasnt(both(week), "tomorrow");

    const two = await atTime(WHEN.twoDays, () => {
      const L = sheet();
      call(L, "sendDutyEmail", "ade@b.c", "Bro Adebola", SUN, 2, "", "North Liverpool", "NH56 FWP");
      return L.gas.mail[0];
    });
    a.has(both(two), "in 2 days", "two days out: " + both(two).slice(0, 90));
    a.hasnt(both(two), "in a week");
  });

  s.test("and it names the Sunday itself, not only how far off it is", async (a) => {
    /* "In a week" on its own is a sentence you have to do arithmetic on, and a
       man who reads it on the wrong day arrives on the wrong day. */
    const m = await atTime(WHEN.weekBefore, () => {
      const L = sheet();
      call(L, "sendDutyEmail", "ade@b.c", "Bro Adebola", SUN, 7, "", "North Liverpool", "NH56 FWP");
      return L.gas.mail[0];
    });
    a.has(both(m), "4 October 2026", "no date at all: " + both(m).slice(0, 120));
    a.has(both(m), "North Liverpool", "or which route");
    a.has(both(m), "NH56 FWP", "or which bus");
  });

  s.test("THE WENT-OUT-UNCHECKED SWEEP NAMES THE MORNING IT IS ABOUT", async (a) => {
    /* Sent at 10:45 on the Sunday, about that Sunday. It has always said "this
       morning", which is only true because the sweep refuses to run on any
       other day — checked here so that a change to the trigger cannot quietly
       make the words wrong. */
    await atTime(WHEN.unchecked, () => {
      const L = sheet();
      call(L, "missingCheckAlert");
      const got = mine(L);
      a.eq(got.length, 1, "two buses went out unchecked and nobody was told");
      a.has(both(got[0]), "Sunday 4 October", "it does not say which morning");
      a.has(both(got[0]), "this morning", "or that it was this one");
    });
  });

  s.test("and it stays silent on every other day of that week", async (a) => {
    for (const [name, iso] of [["the Saturday before", WHEN.saturday],
                               ["the Monday after", WHEN.monday]]) {
      await atTime(iso, () => {
        const L = sheet();
        call(L, "missingCheckAlert");
        a.eq(mine(L).length, 0, name + " was reported for having no minibus check");
      });
    }
  });

  s.test("the weekly summary is about the week that has just gone", async (a) => {
    await atTime(WHEN.digest, () => {
      const L = sheet();
      call(L, "weeklyDigest");
      const got = mine(L);
      a.eq(got.length, 1, "the week went by and nothing summarised it");
      a.has(got[0].subject, "weekly summary");
      a.hasnt(both(got[0]), "in a week", "a digest does not predict");
    });
  });

  /* ---- the ones that arrive whenever a driver acts --------------------- */

  s.test("A WALKAROUND EMAIL READS THE SAME AT ANY HOUR IT CAN ARRIVE", async (a) => {
    /* The point of this check, and the reason the risk here was always lower
       than on a phone: nothing in this email is computed from the clock. It
       carries the time the check was DONE, which is a fact about the morning
       and not about when the message is opened.

       Sent at four hours across the week, byte for byte identical apart from
       nothing at all. If a clock ever creeps into this email, this is what
       says so. */
    const seen = [];
    for (const iso of [WHEN.saturday, WHEN.sundayEarly, WHEN.walkaround, WHEN.monday]) {
      seen.push(await atTime(iso, () => {
        const L = sheet();
        call(L, "notifyCheck", Object.assign({}, CHECK, { level: "stop" }),
             "Stopped", "Nearside mirror cracked");
        return settled(mine(L)[0]);
      }));
    }
    for (let i = 1; i < seen.length; i++) {
      a.eq(seen[i], seen[0], "the stopped-bus email changed with the hour it was sent");
    }
    a.has(seen[0], "09:35", "and it still carries the time the check was done");
  });

  s.test("and so does the rota request, and the authorisation", async (a) => {
    for (const [what, fire] of [
      ["a rota request", (L) => call(L, "notifyRotaRequest",
        { id: "REQ-1", date: SUN, driver: "Bro Adebola", type: "Request cover",
          reason: "away that weekend", swapWith: "", swapDate: "", agreed: false }, SUN)],
      ["an authorisation", (L) => call(L, "notifyAuthorised",
        { reg: "YS70 PWE", by: "Bro Asim", inspector: "Bro Adebola",
          at: Date.parse("2026-10-04T09:40:00+01:00"), via: "app" })]
    ]) {
      const seen = [];
      for (const iso of [WHEN.saturday, WHEN.walkaround, WHEN.monday]) {
        seen.push(await atTime(iso, () => {
          const L = sheet();
          fire(L);
          return settled(mine(L)[0]);
        }));
      }
      for (let i = 1; i < seen.length; i++) {
        a.eq(seen[i], seen[0], what + " changed with the hour it was sent");
      }
    }
  });

  /* ---- and the one thing worth checking about two at once -------------- */

  s.test("TWO EMAILS ABOUT ONE SUNDAY DO NOT CONTRADICT EACH OTHER", async (a) => {
    /* A request turned down and a duty reminder are about the same morning and
       the same man, and one says "you are not driving" while the other says
       "you are". Whichever order they arrive in, they have to agree — and the
       rejection reads the Rota back rather than assuming, which is the whole
       reason it can. */
    await atTime(WHEN.twoDays, () => {
      const L = sheet({
        "Rota Requests": tab("Rota Requests", [
          { Received: new Date(), "Request ID": "REQ-1", Sunday: SUN, Driver: "Bro Adebola",
            Type: "Request cover", Reason: "away", Status: "Pending" }])
      });
      const sh = L.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Rota Requests");
      const qc = call(L, "requestCols", sh);
      sh.getRange(2, qc.status).setValue("Rejected");
      call(L, "onRotaEditNotify", { range: sh.getRange(2, qc.status) });

      const his = L.gas.mail.filter((m) => String(m.to).indexOf("ade@") === 0);
      a.eq(his.length, 1, "he asked and nobody answered");
      a.has(both(his[0]), "still down to drive",
            "turned down, and not told he is still on it: " + both(his[0]).slice(0, 120));
      a.has(both(his[0]), "North Liverpool", "or which route he is still on");
    });
  });

  s.test("and an approval with cover never tells the man he is still driving", async (a) => {
    await atTime(WHEN.twoDays, () => {
      const L = sheet({
        "Rota Requests": tab("Rota Requests", [
          { Received: new Date(), "Request ID": "REQ-1", Sunday: SUN, Driver: "Bro Adebola",
            Type: "Request cover", Reason: "away", Status: "Pending",
            "Replacement assigned": "Bro Tunde" }])
      });
      const sh = L.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Rota Requests");
      const qc = call(L, "requestCols", sh);
      sh.getRange(2, qc.status).setValue("Approved");
      call(L, "onEditRequests", { range: sh.getRange(2, qc.status) }, sh);
      call(L, "onRotaEditNotify", { range: sh.getRange(2, qc.status) });

      const his = L.gas.mail.filter((m) => String(m.to).indexOf("ade@") === 0);
      a.ok(his.length > 0, "approved and told nobody");
      for (const m of his) {
        a.hasnt(both(m), "still down to drive",
                "approved, and told he is still driving: " + both(m).slice(0, 120));
      }
    });
  });

  return s;
}
