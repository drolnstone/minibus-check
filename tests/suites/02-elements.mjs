/* EVERY ELEMENT THE PAGES LOOK UP EXISTS.

   $("someId") returning null is not an error in JavaScript. It is null, and
   the next line quietly does nothing — a button that never gets its handler,
   a line that never gets its text. Nothing throws, nothing is logged, and it
   reaches a driver as a feature that "sometimes doesn't work".

   An id can be written in three ways here, and all three count:

     1.  in the static markup                    <div id="hub">
     2.  in a template string                    '<b id="busName">'
     3.  by a HELPER that interpolates it        idBtn("idFind","Find it")

   The third is the one a naive scanner misses, and missing it is worse than
   not checking at all: five perfectly good buttons get reported as broken,
   somebody learns the check cries wolf, and the sixth one — which really is
   broken — goes out on a Sunday. So the helpers are found rather than
   listed: any function that interpolates one of its own parameters into an
   id attribute is an id-maker, and the string literals passed to it in that
   position are declared ids. */

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { join } from "node:path";
import { Suite } from "../lib/t.mjs";

const LOOKUP = /\$\(\s*["']([A-Za-z][\w-]*)["']\s*\)/g;
const DECLARED = /\bid\s*=\s*\\?["']([A-Za-z][\w-]*)\\?["']/g;
const SET_ID = /\.id\s*=\s*["']([A-Za-z][\w-]*)["']/g;

/* function foo(a, b) {   |   var foo = function (a, b) {   |   foo: function (a, b) { */
const FN = /(?:function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)|(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*function\s*\(([^)]*)\))\s*\{/g;

/* How much of a helper's body to look at. These are all one-liners that
   return a string; anything longer than this is not an id-maker of the kind
   this is looking for. */
const BODY = 900;

export function idMakers(src) {
  const makers = [];
  for (const m of src.matchAll(FN)) {
    const name = m[1] || m[3];
    const params = (m[2] || m[4] || "").split(",").map((p) => p.trim()).filter(Boolean);
    if (!name || !params.length) continue;
    const body = src.slice(m.index + m[0].length, m.index + m[0].length + BODY);
    params.forEach((p, i) => {
      /* id="' + p    or    id=\"" + p    or    id='" + p  */
      const re = new RegExp("\\bid\\s*=\\s*\\\\?[\"'][^\"'+]*[\"']?\\s*\\+\\s*" + p.replace(/[$]/g, "\\$") + "\\b");
      if (re.test(body)) makers.push({ name, at: i });
    });
  }
  return makers;
}

export function scan(src) {
  const looked = new Set(), declared = new Set();
  for (const m of src.matchAll(LOOKUP)) looked.add(m[1]);
  for (const m of src.matchAll(DECLARED)) declared.add(m[1]);
  for (const m of src.matchAll(SET_ID)) declared.add(m[1]);

  for (const maker of idMakers(src)) {
    /* Only literal arguments. An id built at runtime out of a stop id cannot
       be checked from here and is not pretended to be. */
    const call = new RegExp("\\b" + maker.name + "\\s*\\(([^()]*)\\)", "g");
    for (const m of src.matchAll(call)) {
      const args = splitArgs(m[1]);
      const a = args[maker.at];
      if (!a) continue;
      const lit = /^\s*["']([A-Za-z][\w-]*)["']\s*$/.exec(a);
      if (lit) declared.add(lit[1]);
    }
  }
  return { looked, declared, makers: idMakers(src) };
}

function splitArgs(s) {
  const out = []; let depth = 0, cur = "", q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export default function (root) {
  const s = new Suite("every element the pages look up exists");

  for (const file of ["index.html", "sunday/index.html", "do/index.html"]) {
    const src = readFileSync(join(root, file), "utf8");
    const { looked, declared, makers } = scan(src);

    for (const id of [...looked].sort()) {
      s.test(file + " declares #" + id + " somewhere", (a) => {
        a.ok(declared.has(id),
             '$("' + id + '") is looked up in ' + file + ' and no id="' + id + '" is ever written, ' +
             "in the markup, in a template string, or through an id-making helper");
      });
    }

    s.test(file + " looks up a plausible number of elements", (a) => {
      /* The floor is deliberately low. It is here to catch the SCANNER going
         blind, which shows up as nothing at all being found, and not to
         assert that a page is a particular size: the page an email links to
         has seven ids and is right to. */
      a.ok(looked.size > 3, "only found " + looked.size + " lookups, so the pattern has stopped matching");
    });
    s.test(file + " declares a plausible number of ids", (a) => {
      /* The scanner going blind would show up as every lookup failing at
         once, which the per-id checks above already say loudly. This is the
         cheap guard against the opposite failure: a declared set so large it
         would match anything. */
      a.ok(declared.size > 3, "only found " + declared.size + " declared ids in " + file);
      a.ok(declared.size < 4000, "found " + declared.size + " declared ids, which is not a real count");
    });
  }


  /* ---- logic that lives inside a page ------------------------------------

     Nothing in this project has ever RUN a line of the two apps' script. One
     stray bracket in sunday/index.html shipped in four releases and the page
     never started, because the suite checked that <script> tags balanced and
     called that parsing.

     They are parsed now. This goes one step further for the handful of pure
     functions worth holding to a behaviour: pull one out of the page by name
     and run it. No DOM, no stubs, no second copy to keep in step — the text
     under test is the text that ships. */
  function cutFunction(src, name, file) {
    const at = src.indexOf("function " + name + "(");
    if (at === -1) throw new Error(file + " has no function called " + name);
    /* Brace matching from the first {, which is enough for a top level
       function and refuses to guess at anything harder. */
    let depth = 0, end = -1;
    for (let j = src.indexOf("{", at); j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") { depth--; if (!depth) { end = j + 1; break; } }
    }
    if (end === -1) throw new Error(name + " in " + file + " has no closing brace");
    return src.slice(at, end);
  }

  /* One or more functions lifted out of a page and run with whatever they
     lean on stubbed. The text under test is the text that ships; only what
     it CALLS is stood in for, which is what makes it a test of this function
     rather than of the whole app. */
  function fromPage(file, names, extra) {
    const src = readFileSync(join(root, file), "utf8");
    const list = [].concat(names);
    const ctx = vm.createContext(Object.assign(
      { String: String, Number: Number, Object: Object, Array: Array,
        Math: Math, JSON: JSON, Boolean: Boolean }, extra || {}));
    const code = list.map((n) => cutFunction(src, n, file)).join("\n");
    new vm.Script(code, { filename: file }).runInContext(ctx);
    return ctx;
  }


  /* ---- WHAT THE DECISION PAGE SAYS HAPPENED -----------------------------

     The live server now hands a rota decision straight to the spreadsheet
     rather than waiting to be asked on the next five minute tick, and tells
     the page which of the two actually happened. These two checks are that
     the page reads that field rather than deciding for itself.

     A page that says "it is done" over a rota that has not moved yet is how
     a man rings you at nine on a Sunday morning. */


  /* ---- THE HOUSE STANDARD, MADE FAILABLE ---------------------------------

     The two running apps already set it and had done for a year: they explain
     THE BUS at length — tread depth, belt buckles, what a weeping nut means —
     and never explain THEMSELVES. A confirmation is "Sent.", "Booked.",
     "Done." A next step appears only when there is an urgent one ("Sent. Now
     ring the coordinator."). A wait is mentioned only when there is a wait
     ("Sent. Give it a few seconds.").

     The decision page and the emails had drifted off it, because both were
     written later and neither had the apps open beside them. They explained
     link lifetimes, what approving does to a tab, where a decision travels
     and how long it takes to get there.

     A phrase list is a regression test and nothing grander: it catches these
     sentences coming back, not the next ones. The length cap underneath it is
     the general net — small print that runs past a line has almost always
     stopped being a fact and started being a lesson. */

  const TAUGHT = [
    ["It asks for your PIN", "the page asks when he gets there"],
    ["Good once", "an expired link says so itself"],
    ["A link is good for one decision", "so is every link in every system"],
    ["Links last about an hour", "only interesting once it has expired"],
    ["Links sometimes get cut in half", "the cause of a broken link is not his problem"],
    ["stays open on the Defects tab", "he is not looking at the tab"],
    ["Approving writes it into the Rota", "that is what approving means"],
    ["A swap moves both Sundays", "the app's internals"],
    ["will show it within a few seconds", "a promise about our plumbing"],
    ["Rota Requests tab now", "where it lives, not news"],
    ["exactly as before", "reassurance about a change he did not see"],
    ["You will get an email as soon as", "a promise about our plumbing"],
    ["so you may get the usual reminders", "true, but three clauses of it"],
    ["open the app, find the Sunday and tap", "a click path, in an email"],
    ["remind you a day before, even with no signal", "how calendars work"],
    ["Either open the attached file, or use the button", "how attachments work"],
    ["you can delete that entry", "how calendars work"],
    ["Sent once. If a check is recorded later", "our sending policy"],
    ["put the registration in the", "he owns the spreadsheet"],
    ["it does not have to be the one this email was sent to", "one clause will do"]
  ];

  /* Comments are where the reasoning lives and are meant to be long — this
     file's own header is four paragraphs about why. Only what a person
     actually receives is held to the standard, so both shapes of comment come
     out whole, not line by line: the first version matched on lines STARTING
     with a marker, which let every continuation line of every block comment
     through, and the check went red over a sentence nobody can read. */
  const prose = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ")
                            .replace(/^\s*\/\/.*$/gm, " ");

  s.test("THE PAGE AND THE EMAILS EXPLAIN THE BUS, NEVER THEMSELVES", (a) => {
    const where = { "do/index.html": readFileSync(join(root, "do/index.html"), "utf8"),
                    "Code.gs": readFileSync(join(root, "Code.gs"), "utf8") };
    for (const [phrase, why] of TAUGHT) {
      for (const [file, src] of Object.entries(where)) {
        a.hasnt(prose(src), phrase, file + " is explaining itself again — " + why);
      }
    }
  });

  s.test("and the decision page's small print stays small", (a) => {
    /* The general net. Every tiny on the page, measured. Anything past a line
       has almost always stopped being a fact and started being a lesson. */
    const src = readFileSync(join(root, "do/index.html"), "utf8");
    const long = [];
    for (const m of src.matchAll(/class="tiny"[^>]*>([^<']{0,400})/g)) {
      const words = m[1].replace(/\s+/g, " ").trim();
      if (words.length > 60) long.push(words);
    }
    a.eq(long.length, 0, "small print that is no longer small: " + JSON.stringify(long));
  });

  function decisionWords(out) {
    let said = "";
    const ctx = fromPage("do/index.html", ["done", "esc"], {
      show: function (title, html, foot) { said = String(title) + " :: " + String(html); },
      paintBus: function () {}, paintRota: function () {}
    });
    ctx.done(out, out.choice);
    return said;
  }

  s.test("a decision that has landed says nothing about waiting", (a) => {
    /* The house rule the two running apps set: "Sent." on its own when it is
       done, "Sent. Give it a few seconds." only when there is something to
       wait for. The panel already says Approved and who is covering; a line
       explaining where it went is the app talking about itself. */
    const said = decisionWords({ kind: "rota", choice: "Approved", by: "Bro Asim",
                                 cover: "Bro Tunde", applied: true });
    a.hasnt(said, "five minutes", "it told him to wait for something already done");
    a.hasnt(said, "Rota Requests", "the tab is where it lives, not news");
    a.has(said, "Bro Tunde", "and it still says who is covering");
    a.has(said, "Approved");
  });

  s.test("and one that has not says how long, because there is a wait", (a) => {
    /* The sheet asleep, cold, over quota or mid-redeploy. Nothing is broken
       by any of those — the drain carries it — but the page must not claim
       otherwise. Tested for BOTH the missing field and an explicit false,
       because an older Worker sends no such field at all. */
    for (const out of [{ kind: "rota", choice: "Approved", by: "Bro Asim", cover: "", applied: false },
                       { kind: "rota", choice: "Approved", by: "Bro Asim", cover: "" }]) {
      const said = decisionWords(out);
      a.has(said, "within five minutes", JSON.stringify(out));
    }
  });

  s.test("approving nobody says so, because that is a fact and not a lesson", (a) => {
    /* It used to explain the consequence in a sentence and a half — the
       morning will read "No driver assigned" until you pick somebody. The
       consequence is worth four words; the mechanism is not. */
    const said = decisionWords({ kind: "rota", choice: "Approved", by: "Bro Asim",
                                 cover: "", applied: true });
    a.has(said, "Nobody is covering it yet");
    a.hasnt(said, "No driver assigned", "it named a cell on a tab he cannot see");
  });

  s.test("turning one down adds nothing at all", (a) => {
    const said = decisionWords({ kind: "rota", choice: "Rejected", by: "Bro Asim",
                                 cover: "", applied: true });
    a.has(said, "Turned down");
    a.hasnt(said, "Nobody is covering", "nobody was going to cover a refusal");
    a.hasnt(said, "five minutes");
  });

  const group = fromPage("index.html", "groupOpenDefects").groupOpenDefects;

  s.test("two reports of one fault are one line, not two", (a) => {
    /* A key remote nobody has fixed is written down again by every
       walkaround that finds it. Six lines are shown and the rest become "and
       9 more", so duplicates of ONE fault were pushing OTHER faults out of
       sight — which is a safety problem wearing the clothes of an untidy
       list. */
    const out = group([
      { item: "Keys and remote", note: "Key remote defected", kind: "Defect", date: "2026-09-10" },
      { item: "Keys and remote", note: "Remote control not working.", kind: "Defect", date: "2026-09-21" },
      { item: "First aid kit", note: "Not available", kind: "Defect", date: "2026-09-10" },
      { item: "First aid kit", note: "None visible.", kind: "Defect", date: "2026-09-21" }
    ]);
    a.eq(out.length, 2, "got " + JSON.stringify(out.map((x) => x.item)));
  });

  s.test("the words are the newest ones, and the count says how long", (a) => {
    const out = group([
      { item: "Keys and remote", note: "Key remote defected", kind: "Defect", date: "2026-09-10" },
      { item: "Keys and remote", note: "Remote control not working.", kind: "Defect", date: "2026-09-21" }
    ]);
    a.eq(out[0].note, "Remote control not working.");
    a.eq(out[0].n, 2);
  });

  s.test("A CRITICAL IS NEVER LOST BEHIND A NEWER ADVISORY", (a) => {
    /* The one that matters. Grouping must not be able to soften anything:
       if any report of an item is critical the line is critical, whatever
       the newest row happens to say. */
    const out = group([
      { item: "Tyres", note: "Near side front worn through", crit: true, kind: "Defect", date: "2026-09-01" },
      { item: "Tyres", note: "Looks fine to me", crit: false, kind: "Advisory", date: "2026-09-21" }
    ]);
    a.eq(out.length, 1);
    a.eq(out[0].crit, true, "a critical was downgraded by a later advisory");
    a.eq(out[0].kind, "Defect", "and a defect was downgraded to an advisory");
  });

  s.test("items that differ only in spacing or case are the same item", (a) => {
    const out = group([
      { item: "First aid kit", note: "a", kind: "Defect", date: "2026-09-10" },
      { item: "  first aid KIT ", note: "b", kind: "Defect", date: "2026-09-21" }
    ]);
    a.eq(out.length, 1);
    a.eq(out[0].note, "b");
  });

  s.test("rows with no date still give a line rather than a blank one", (a) => {
    const out = group([{ item: "Mirrors", note: "Cracked", kind: "Defect" }]);
    a.eq(out.length, 1);
    a.eq(out[0].note, "Cracked");
  });

  s.test("nothing open is still nothing", (a) => {
    a.eq(group([]).length, 0);
    a.eq(group(undefined).length, 0);
  });


  /* ---- whose bus it is on the chooser ------------------------------------

     The route chip is a fact about the BUS and reads the same on every phone.
     The Yours chip is the other kind: true only for the man holding it. */

  function duty(myRoute, seats) {
    return fromPage("index.html", ["busIsMyDuty", "busRoutesFor"],
      { SEATS: seats, rotaMyRoute: function () { return myRoute; } }).busIsMyDuty;
  }

  const FLEET = { North: { reg: "NH56 FWP" }, South: { reg: "YS70 PWE" } };

  s.test("the bus he is down to drive is his", (a) => {
    a.eq(duty("North", FLEET)("NH56 FWP"), true);
  });

  s.test("and the other one is not", (a) => {
    a.eq(duty("North", FLEET)("YS70 PWE"), false);
  });

  s.test("A MAN WHO IS NOT DRIVING THIS SUNDAY IS TOLD NOTHING IS HIS", (a) => {
    /* The distinction that has already cost this project once. "Which route
       is this man's" is right for choosing a tab and wrong for a badge: it
       would tell every driver in North's pattern the bus was his, so on a
       Sunday when one of them is driving, the other five are each told it is
       theirs — and the one man it is aimed at then has no reason to believe
       it. Only whose turn it actually is may light this up. */
    const off = duty(null, FLEET);
    a.eq(off("NH56 FWP"), false);
    a.eq(off("YS70 PWE"), false);
  });

  s.test("one bus on both routes is still his when one of them is", (a) => {
    const both = { North: { reg: "NH56 FWP" }, South: { reg: "NH56 FWP" } };
    a.eq(duty("South", both)("NH56 FWP"), true);
  });

  s.test("a bus the record says nothing about is nobody's", (a) => {
    a.eq(duty("North", FLEET)("AB12 CDE"), false);
    a.eq(duty("North", FLEET)(""), false);
  });

  s.test("the plate is matched however it is typed", (a) => {
    a.eq(duty("North", FLEET)(" nh56 fwp "), true);
  });


  /* ---- one chip, and which one ------------------------------------------ */

  function chips(myRoute, seats, today) {
    return fromPage("index.html",
      ["busChipFor", "busIsMyDuty", "busRoutesFor", "busTagFor", "yoursWhen"],
      { SEATS: seats,
        rotaMyRoute: function () { return myRoute; },
        sundayIsToday: function () { return !!today; },
        esc: function (x) { return String(x); } }).busChipFor;
  }

  s.test("his own bus says Yours and does not also say the route", (a) => {
    /* Two badges saying one thing in different words is two things to read
       where one would do. Yours wins on his card because he is choosing a
       vehicle, and "this is the one" answers that better than the name of a
       route he already knows he is on. */
    const out = chips("North", FLEET)("NH56 FWP");
    a.has(out, "Yours this Sunday", "got: " + out);
    a.hasnt(out, "North", "the route is said twice: " + out);
  });

  s.test("THE OTHER BUS STILL CARRIES ITS ROUTE", (a) => {
    /* The swap happens on one card, for one man. Take the route off the
       other one and a driver picking a bus to cover somebody has nothing to
       go on. */
    const out = chips("North", FLEET)("YS70 PWE");
    a.has(out, "South this Sunday", "got: " + out);
    a.hasnt(out, "Yours");
  });

  s.test("a man not driving this Sunday sees both routes, as before", (a) => {
    const off = chips(null, FLEET);
    a.has(off("NH56 FWP"), "North this Sunday");
    a.has(off("YS70 PWE"), "South this Sunday");
    a.hasnt(off("NH56 FWP") + off("YS70 PWE"), "Yours");
  });

  s.test("on the day itself it says today rather than this Sunday", (a) => {
    a.has(chips("North", FLEET, true)("NH56 FWP"), "Yours today");
    a.has(chips("North", FLEET, true)("YS70 PWE"), "South today");
  });

  s.test("a bus the record says nothing about carries no chip at all", (a) => {
    a.eq(chips("North", FLEET)("AB12 CDE"), "");
  });

  return s;
}
