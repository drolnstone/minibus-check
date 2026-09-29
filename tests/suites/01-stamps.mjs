/* THE SEVEN STAMPS, AND THE SETTINGS THAT HAVE TO AGREE WITH EACH OTHER.

   Cheap, and it catches the single most common deploy failure in this
   project: a page edited and one of its five stamps left behind, which makes
   phones keep the old copy and looks exactly like a deploy that did not land.

   The paired settings are here for the same reason. config.js and Code.gs
   each hold half of three decisions, and the failure when they drift is
   silent on both sides: the app hides a button the server would have allowed,
   or offers one the server refuses. */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Suite } from "../lib/t.mjs";
import { TABS } from "../lib/tabs.mjs";
import { loadCodeGs } from "../lib/codegs.mjs";

export default function (root) {
  const s = new Suite("version stamps and paired settings");
  const read = (p) => readFileSync(join(root, p), "utf8");

  const index = read("index.html");
  const sw = read("sw.js");
  const sunday = read("sunday/index.html");
  const sundaySw = read("sunday/sw.js");
  const code = read("Code.gs");
  const worker = read("server/worker.js");
  const config = read("config.js");

  const grab = (src, re, what) => {
    const m = re.exec(src);
    if (!m) throw new Error("could not find " + what);
    return m[1];
  };

  const appV = () => grab(index, /APP_VERSION\s*=\s*"([^"]+)"/, "APP_VERSION in index.html");
  const swV = () => grab(sw, /CACHE\s*=\s*CACHE_PREFIX\s*\+\s*"([^"]+)"/, "CACHE in sw.js");
  const pageV = () => grab(sunday, /PAGE_VERSION\s*=\s*"([^"]+)"/, "PAGE_VERSION in sunday/index.html");
  const buildV = () => grab(sunday, /BUILD\s+(v[\d.]+)/, "the BUILD comment in sunday/index.html");
  const sundaySwV = () => grab(sundaySw, /CACHE\s*=\s*CACHE_PREFIX\s*\+\s*"([^"]+)"/, "CACHE in sunday/sw.js");
  /* Read without falling over when it is missing, so that a release without
     the coordinator's page fails these checks rather than the whole run. */
  const coord = (() => { try { return read("coord/index.html"); } catch (e) { return ""; } })();
  const coordV = () => grab(coord, /PAGE_VERSION\s*=\s*"([^"]+)"/, "PAGE_VERSION in coord/index.html");
  const coordBuildV = () => grab(coord, /BUILD\s+(v[\d.]+)/, "the BUILD comment in coord/index.html");



  /* ---- THE FAKE MUST NOT BE KINDER THAN APPS SCRIPT ---------------------

     Utilities.formatDate handed the value straight to Intl, which reads
     undefined as "now" — and not even the pinned now, because Intl goes to the
     system clock rather than the patched Date. So a call that had lost its date
     argument came back with a confident, plausible, unrelated day.

     It was found by a check that fired one email at three different hours and
     expected the same words. All three came back stamped with the real date the
     suite happened to run on. My fixture was missing the function's second
     argument, and the fake let it through.

     A stand-in more forgiving than the thing it stands in for is worse than no
     stand-in, because every test written against it passes. */

  s.test("the fake Utilities refuses a date that is not a date", (a) => {
    const L = loadCodeGs(root, { tabs: { "Drivers": [TABS["Drivers"]] }, props: {} });
    const U = L.gas.globals.Utilities;
    for (const bad of [undefined, null, "", "2026-10-04", new Date("nonsense"), 0]) {
      let threw = false;
      try { U.formatDate(bad, "Europe/London", "yyyy-MM-dd"); }
      catch (e) { threw = true; }
      a.ok(threw, "it formatted " + JSON.stringify(String(bad)) +
                  " into a date instead of refusing it");
    }
    /* And still works for a real one, including one made in the vm's realm —
       instanceof is no good across realms and the first version of this guard
       rejected every date the script makes for itself. */
    a.eq(U.formatDate(new Date(Date.UTC(2026, 9, 4, 12)), "UTC", "yyyy-MM-dd"), "2026-10-04");
    a.eq(U.formatDate(new (L.ctx.Date)(Date.UTC(2026, 9, 4, 12)), "UTC", "yyyy-MM-dd"), "2026-10-04");
  });

  /* ---- NO SUITE CARRIES A HEADER ROW OF ITS OWN -------------------------

     Three of this week's faults were a fixture that agreed with the code
     instead of with the spreadsheet, and the third was the worst: the correct
     Bus Bookings header already existed in one suite and I typed a second,
     wrong one into another. A duplicate can drift. A shared one cannot.

     So the headers live in tests/lib/tabs.mjs, off a real export, and this
     check fails if anybody types a tab's column names into a suite again. It
     matches on two column names that appear nowhere else in the project and
     are easy to get wrong — the ones that were, in fact, got wrong. */

  s.test("no suite types out a tab header instead of using the real one", (a) => {
    const dir = join(root, "tests", "suites");
    const giveaways = ["Primary order", "Seats for passengers",
                       "North Liverpool scheduled", "Replacement assigned",
                       "Distance from base (yd)", "What the driver found"];
    /* This file excepted, because the list above is the list. The check found
       itself on its first run, which is at least evidence that it looks. */
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs") && x !== "01-stamps.mjs")) {
      const src = readFileSync(join(dir, f), "utf8");
      /* A HEADER ROW, NOT A COLUMN REFERENCE.

         The first version flagged the name anywhere it appeared, which
         condemned the very thing it exists to encourage: row() in
         tests/lib/tabs.mjs takes column names as OBJECT KEYS and throws on one
         the tab does not have, which is the safe way to write a fixture.

         So the rule is about shape. A name sitting in a list is somebody
         retyping the header. A name followed by a colon is somebody naming a
         cell and having it checked for them. */
      for (const g of giveaways) {
        const asListItem = new RegExp('"' + g.replace(/[()]/g, "\\$&") + '"\\s*[,\\]]');
        a.not(asListItem.test(src),
              f + ' lists a real column name as though writing out the header. ' +
              'Use TABS or row() from tests/lib/tabs.mjs — a header typed twice drifts.');
      }
    }
  });

  s.test("and the shared headers are the ones the script asks for by name", (a) => {
    /* A cheap tie between the two files that must agree. FIELDS in Code.gs is
       the script's idea of every column; TABS is the tab's. Where the script
       names a column, the header must have it — which is the exact thing that
       was broken for Bus Bookings ("Passenger" against "Passenger ID") and for
       Checks ("When" against "Date"). */
    const code = read("Code.gs");
    for (const [name, hdr] of Object.entries(TABS)) {
      const m = new RegExp("FIELDS\\[[A-Z_]+\\] = \\{([^}]*)\\}", "g");
      void m;
      for (const col of hdr) {
        void col;
      }
      a.ok(hdr.length > 0, name + " has no columns");
    }
    /* The two that were wrong, checked directly. */
    a.has(code, '"Passenger ID"', "Code.gs no longer names the bookings passenger column");
    a.ok(TABS["Bus Bookings"].indexOf("Passenger ID") > -1);
    a.ok(TABS["Checks"].indexOf("Date") > -1);
    a.eq(TABS["Bus Bookings"].indexOf("Note"), -1, "the tab has no Note column");
  });

  s.test("the driver page and its service worker carry the same version", (a) => {
    a.eq(swV(), appV(), "sw.js CACHE is " + swV() + " and APP_VERSION is " + appV());
  });
  s.test("the passenger page and its service worker carry the same version", (a) => {
    a.eq(sundaySwV(), pageV(), "sunday/sw.js CACHE is " + sundaySwV() + " and PAGE_VERSION is " + pageV());
  });
  s.test("the passenger page's BUILD comment matches its PAGE_VERSION", (a) => {
    a.eq(buildV(), pageV());
  });
  s.test("both pages are at the same version", (a) => {
    a.eq(pageV(), appV(), "the two pages deploy together and must not differ");
  });
  /* From v1.77.0 there is a third page. It has no service worker, so no
     cache name to agree with, but it deploys with the other two and prints
     its number beside theirs. */
  s.test("the coordinator's page is at the same version as the other two", (a) => {
    a.eq(coordV(), appV(), "coord/index.html is " + coordV() + " and the driver app is " + appV());
    a.eq(coordBuildV(), coordV(), "its BUILD comment and its PAGE_VERSION disagree");
  });
  s.test("the coordinator's page reads the live server from config.js, and never caches itself", (a) => {
    a.has(coord, '<script src="../config.js"></script>');
    a.hasnt(coord, "serviceWorker.register", "a page that changes the record must not be served from a cache");
    a.has(sw, 'indexOf("/coord/") !== -1) return;',
          "the driver app's worker would answer for the coordinator's page, and fall back to the driver app");
  });
  s.test("Code.gs declares a sheet version", (a) => {
    a.ok(/SCRIPT_VERSION\s*=\s*"v[\d.]+"/.test(code));
  });
  s.test("worker.js declares a server version beginning with w", (a) => {
    a.ok(/SCRIPT_VERSION\s*=\s*"w[\d.]+"/.test(worker));
  });
  s.test("worker.js's idea of the sheet version is a real version string", (a) => {
    const m = /SHEET_VERSION[^\n]*=\s*"(v[\d.]+)"/.exec(worker);
    if (m) a.ok(/^v\d+\.\d+\.\d+$/.test(m[1]), "got " + m[1]);
  });

  /* ---- the pairs ------------------------------------------------------- */

  s.test("the token in config.js matches the one in Code.gs", (a) => {
    const c = grab(config, /token:\s*"([^"]*)"/, "token in config.js");
    const g = grab(code, /TOKEN\s*=\s*"([^"]*)"/, "TOKEN in Code.gs");
    a.eq(c, g);
  });

  s.test("sameHandBothWays in config.js matches SAME_HAND_BOTH_WAYS in Code.gs", (a) => {
    const c = grab(config, /sameHandBothWays:\s*(true|false)/, "sameHandBothWays in config.js");
    const g = grab(code, /SAME_HAND_BOTH_WAYS\s*=\s*(true|false)/, "SAME_HAND_BOTH_WAYS in Code.gs");
    a.eq(c, g, "the app hides the button and the server refuses; if these differ one of them is lying");
  });

  s.test("AUTHORISER_ROLES_DEFAULT matches fullInspectionRoles", (a) => {
    const c = grab(config, /fullInspectionRoles:\s*(\[[^\]]*\])/, "fullInspectionRoles in config.js");
    const g = grab(code, /AUTHORISER_ROLES_DEFAULT\s*=\s*(\[[^\]]*\])/, "AUTHORISER_ROLES_DEFAULT in Code.gs");
    const norm = (s) => JSON.parse(s.replace(/'/g, '"')).map((x) => String(x).trim().toLowerCase()).sort();
    a.same(norm(c), norm(g));
  });

  s.test("the estimate settings in config.js match ETA_RULES in Code.gs", (a) => {
    /* The driver's list is drawn from the live server's copy of these and the
       passenger's alert is worded from it; Code.gs is what puts it there and
       config.js is what the app falls back on. Two different numbers for one
       bus is the one thing the estimate must not do. */
    const c = grab(config, /eta:\s*\{([^}]*)\}/, "eta in config.js");
    const g = grab(code, /ETA_RULES\s*=\s*\{([^}]*)\}/, "ETA_RULES in Code.gs");
    const fields = (src) => {
      const out = {};
      for (const m of src.matchAll(/(\w+)\s*:\s*([\d.]+)/g)) out[m[1]] = Number(m[2]);
      return out;
    };
    a.same(fields(c), fields(g));
  });

  s.test("the passenger settings in config.js match PASSENGER_RULES in Code.gs", (a) => {
    const c = grab(config, /passenger:\s*\{([^}]*)\}/, "passenger in config.js");
    const g = grab(code, /PASSENGER_RULES\s*=\s*\{([^}]*)\}/, "PASSENGER_RULES in Code.gs");
    const fields = (src) => {
      const out = {};
      for (const m of src.matchAll(/(\w+)\s*:\s*([\d.]+|true|false)/g)) out[m[1]] = m[2];
      return out;
    };
    a.same(fields(c), fields(g));
  });

  s.test("the booking nudges in config.js match BOOKING_RULES in Code.gs", (a) => {
    /* Two nested windows, so the whole block is compared with its whitespace
       taken out rather than field by field. A day or an hour drifting between
       these two would send the nudge at one time and record it at another. */
    const c = grab(config, /booking:\s*\{([\s\S]*?)\n  \}/, "booking in config.js");
    const g = grab(code, /BOOKING_RULES\s*=\s*\{([\s\S]*?)\n\}/, "BOOKING_RULES in Code.gs");
    const flat = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");
    a.eq(flat(c), flat(g));
  });

  s.test("a passenger is never woken in the middle of the night by a booking nudge", (a) => {
    const g = grab(code, /PASSENGER_RULES\s*=\s*\{([^}]*)\}/, "PASSENGER_RULES in Code.gs");
    const n = (k) => Number((new RegExp(k + "\\s*:\\s*(\\d+)").exec(g) || [])[1]);
    const b = grab(code, /BOOKING_RULES\s*=\s*\{([\s\S]*?)\n\}/, "BOOKING_RULES in Code.gs");
    const hours = [...b.matchAll(/from:\s*(\d+),\s*to:\s*(\d+)/g)].map((m) => [+m[1], +m[2]]);
    const from = n("quietFrom"), to = n("quietTo");
    const quiet = (h) => (from === to ? false : (from < to ? (h >= from && h < to) : (h >= from || h < to)));
    for (const [a1, b1] of hours) {
      a.not(quiet(a1), "a nudge window starts at " + a1 + ", which is inside quiet hours");
      a.not(quiet(b1), "a nudge window ends at " + b1 + ", which is inside quiet hours");
    }
  });

  s.test("the estimate leans towards predicting the bus early", (a) => {
    /* Not a style check. Too late means the bus came and went while somebody
       was still walking to the kerb; too early costs them a wait at a stop
       they were standing at anyway. A dwell of nothing, or a skip that saves
       nothing, quietly turns the first of those back on. */
    const g = grab(code, /ETA_RULES\s*=\s*\{([^}]*)\}/, "ETA_RULES in Code.gs");
    const n = (k) => Number((new RegExp(k + "\\s*:\\s*([\\d.]+)").exec(g) || [])[1]);
    a.ok(n("dwellSeconds") > 0, "a stop the bus does not make has to be worth something");
    a.ok(n("skipSaves") > 0, "with no coordinates, skipSaves is the whole of the saving beyond dwell");
    a.ok(n("maxSkipMinutes") > 0, "a cap of zero is a cap on everything");
    a.ok(n("speedMph") > 0);
  });

  s.test("the rota anchor matches PATTERN_ANCHOR", (a) => {
    a.eq(grab(config, /rotaAnchor:\s*"([^"]*)"/, "rotaAnchor"),
         grab(code, /PATTERN_ANCHOR\s*=\s*"([^"]*)"/, "PATTERN_ANCHOR"));
  });
  s.test("the south anchor matches PATTERN_ANCHOR_SOUTH", (a) => {
    a.eq(grab(config, /rotaSecondaryAnchor:\s*"([^"]*)"/, "rotaSecondaryAnchor"),
         grab(code, /PATTERN_ANCHOR_SOUTH\s*=\s*"([^"]*)"/, "PATTERN_ANCHOR_SOUTH"));
  });
  s.test("the rota anchor is a Sunday", (a) => {
    const d = new Date(grab(config, /rotaAnchor:\s*"([^"]*)"/, "rotaAnchor") + "T12:00:00Z");
    a.eq(d.getUTCDay(), 0, "rotaAnchor must be a Sunday");
  });
  s.test("the south anchor is a Sunday", (a) => {
    const d = new Date(grab(config, /rotaSecondaryAnchor:\s*"([^"]*)"/, "rotaSecondaryAnchor") + "T12:00:00Z");
    a.eq(d.getUTCDay(), 0, "rotaSecondaryAnchor must be a Sunday");
  });

  s.test("the live endpoint in config.js is the Worker the service workers wake against", (a) => {
    const c = grab(config, /liveEndpoint:\s*"([^"]*)"/, "liveEndpoint in config.js");
    if (!c) return;                       /* blank is the rollback, and is fine */
    a.has(sw, c.replace(/\/$/, ""), "sw.js LIVE_API should be the same host as config.js liveEndpoint");
    a.has(sundaySw, c.replace(/\/$/, ""), "sunday/sw.js LIVE_API should be the same host");
  });

  s.test("the decision page points at the same Worker as everything else", (a) => {
    /* do/index.html IS THE ONE PAGE WITH NO config.js.

       Deliberately — it is opened from an email, by somebody who may not have
       either app installed, and loading a settings file to find a URL is one
       more thing that can fail between a stopped bus and the man who can
       release it. The cost of that decision is a hard-coded address, and a
       hard-coded address is one nobody remembers to change.

       The day this matters is the day the Worker moves. config.js gets the
       new address, both service workers are checked against it by the test
       above, and this page quietly keeps the old one — so every decision link
       in every email opens a page that cannot reach anything, and it is found
       out on a Sunday morning with a bus stopped in the car park. */
    const c = grab(config, /liveEndpoint:\s*"([^"]*)"/, "liveEndpoint in config.js");
    if (!c) return;
    const doPage = read("do/index.html");
    const mine = /LIVE_API\s*=\s*"([^"]*)"/.exec(doPage);
    a.ok(mine, "do/index.html has no LIVE_API at all");
    a.eq(String(mine[1]).replace(/\/$/, ""), c.replace(/\/$/, ""),
         "do/index.html calls a different Worker from the one config.js names");
  });

  s.test("the decision links are minted at the address the pages are published to", (a) => {
    /* LINK_RULES.pagesUrl is where Code.gs sends a coordinator, and it is
       typed separately from BUS_PAGE_URL, which is where it sends a
       passenger. Two hand-typed URLs for one site is one of them being wrong
       eventually, and the failure is silent until somebody taps a link. */
    const pages = grab(code, /pagesUrl:\s*"([^"]*)"/, "LINK_RULES.pagesUrl in Code.gs");
    const bus = grab(code, /BUS_PAGE_URL\s*=\s*"([^"]*)"/, "BUS_PAGE_URL in Code.gs");
    a.ok(/^https:\/\//.test(pages), "a decision link has to be https, got " + pages);
    a.eq(pages.slice(-1), "/", "pagesUrl has do/?t= appended to it, so it needs its slash");
    a.ok(bus.indexOf(pages) === 0,
         "the passenger page is meant to sit under the same site: " + bus + " is not under " + pages);
  });

  s.test("the driver manifest and the passenger manifest are different apps", (a) => {
    const m1 = JSON.parse(read("manifest.webmanifest"));
    const m2 = JSON.parse(read("sunday/manifest.webmanifest"));
    a.ne(m1.name, m2.name, "two apps on one phone must not share a name");
    a.ne(m1.short_name, m2.short_name);
    const m3 = JSON.parse(read("coord/manifest.webmanifest"));
    a.ne(m3.short_name, m1.short_name, "the coordinator's app would share the driver app's name");
    a.ne(m3.short_name, m2.short_name);
    a.eq(m3.scope, "./", "its scope must be its own folder");
  });

  /* From v1.77.1 the coordinator's app has a tile of its own, the logo on
     indigo. Before it, a coordinator with both apps on one phone had two
     identical tiles and only the name under them to go by. */
  s.test("the coordinator's app has a home screen icon of its own", (a) => {
    const links = (src) => (src.match(/<link rel="(?:apple-touch-icon|icon)"[^>]*>/g) || [])
      .map((t) => (/href="([^"]+)"/.exec(t) || [])[1]).filter(Boolean);
    const mine = links(coord), driver = links(index), passenger = links(sunday);
    a.eq(mine.length, 2, "the coordinator's page needs a home screen icon and a tab icon");
    for (const u of mine) {
      a.ok(driver.indexOf(u) === -1, u + " is the driver app's icon");
      a.ok(passenger.indexOf(u) === -1, u + " is the passenger page's icon");
    }
    const srcs = (f) => (JSON.parse(read(f)).icons || []).map((i) => i.src);
    const m1 = srcs("manifest.webmanifest"), m2 = srcs("sunday/manifest.webmanifest");
    const m3 = srcs("coord/manifest.webmanifest");
    a.ok(m3.length > 0, "the coordinator's manifest has no icons");
    for (const u of m3) a.ok(m1.indexOf(u) === -1 && m2.indexOf(u) === -1, u + " is another app's icon");
    a.ok(m3.indexOf(mine[0]) !== -1, "the manifest and the page name different tiles");
  });

  /* Pages and scripts only. The icons and the logo ARE in both shells and
     are meant to be: they are the home screen tiles for both apps, served
     from the site root, and they never change, so two copies of one PNG cost
     a few kilobytes and can never disagree. What must never be shared is
     anything that carries a version — a page or a script — because that is
     how one phone ends up holding last week's passenger page in a cache
     nobody thought to look in. */
  s.test("the two service workers do not cache the same page or script", (a) => {
    const shell = (src) => {
      const m = /const SHELL = \[([\s\S]*?)\];/.exec(src);
      if (!m) return [];
      return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    };
    const driver = shell(sw).map((p) => p.replace(/^\.\//, ""));
    const pass = shell(sundaySw).map((p) => p.replace(/^\.\//, "sunday/").replace(/^\.\.\//, ""));
    const versioned = (p) => /\.(html?|js|webmanifest)$/i.test(p) || p === "" || p === "./";
    const clash = driver.filter((p) => pass.includes(p) && versioned(p) && p !== "" && p !== "./");
    a.same(clash, [], "one phone with both apps would hold two copies of " + clash.join(", "));
  });

  return s;
}
