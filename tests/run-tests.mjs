#!/usr/bin/env node
/* THE RUNNER.

   One way in, so no suite can quietly go stale the way five of them did —
   they had been testing a w2.0.0 copy of the Worker for weeks and passing
   every time. Everything here reads the project fresh on every run.

       node tests/run-tests.mjs
       node tests/run-tests.mjs authorise trip      # only matching suites
       MINIBUS_ROOT=/path/to/project node tests/run-tests.mjs

   It ends in one word. READY means every check passed and the release can be
   handed over. NOT READY means it cannot, and the failures above say why. */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { Suite } from "./lib/t.mjs";
import { installGlobals, cleanup } from "./lib/worker.mjs";

/* London time, as the sheet runs, whatever clock this machine is on. */
process.env.TZ = "Europe/London";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.MINIBUS_ROOT || join(here, ".."));
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

const BOLD = "\u001b[1m", DIM = "\u001b[2m", RED = "\u001b[31m", GREEN = "\u001b[32m", OFF = "\u001b[0m";
const paint = process.stdout.isTTY ? (c, s) => c + s + OFF : (c, s) => s;

/* ---- the files this release is made of ---------------------------------- */

const PARSE_JS = ["server/worker.js", "sw.js", "sunday/sw.js", "coord/sw.js", "config.js", "Code.gs"];
const PARSE_JSON = ["manifest.webmanifest", "sunday/manifest.webmanifest", "coord/manifest.webmanifest"];
/* do/index.html is the page an email links to. It is small, standalone and
   has no service worker of its own, and it is checked exactly like the other
   two: it either parses and closes or it does not. */
/* coord/index.html, from v1.77.0, is the coordinator's app: checked the same way. */
const PAGES = ["index.html", "sunday/index.html", "do/index.html", "coord/index.html"];
const ALL = [...PARSE_JS, ...PARSE_JSON, ...PAGES, "server/schema.sql", "README.md"];

/* ---- step one: does it even parse? --------------------------------------

   Before any behaviour is asked about. A file that does not parse fails every
   suite downstream for one reason, and forty red lines hide the one fact that
   matters. */

function parseCheck() {
  const s = new Suite("every file parses");

  for (const f of ALL) {
    s.test(f + " is present", (a) => a.ok(existsSync(join(ROOT, f)), f + " is missing from the release"));
  }

  for (const f of PARSE_JS) {
    s.test(f + " parses as JavaScript", (a) => {
      const src = readFileSync(join(ROOT, f), "utf8");
      /* The Worker is a module and the rest are scripts, so the one
         `export default` is snipped before parsing rather than pulling in the
         module loader for a syntax check. Everything above it is the whole
         file and is parsed exactly as written. */
      try {
        new vm.Script(src.replace(/^export default[\s\S]*$/m, ""), { filename: f });
      } catch (err) {
        a.ok(false, f + " does not parse: " + err.message);
      }
    });
  }

  for (const f of PARSE_JSON) {
    s.test(f + " is valid JSON", (a) => {
      try { JSON.parse(readFileSync(join(ROOT, f), "utf8")); }
      catch (err) { a.ok(false, f + " is not valid JSON: " + err.message); }
    });
  }

  for (const f of PAGES) {
    s.test(f + " is a whole document", (a) => {
      const src = readFileSync(join(ROOT, f), "utf8");
      a.has(src.slice(0, 400).toLowerCase(), "<!doctype html", f + " does not begin with a doctype");
      a.has(src.slice(-200).toLowerCase(), "</html>", f + " does not end with </html> — it may be truncated");
      const open = (src.match(/<script\b/gi) || []).length;
      const close = (src.match(/<\/script>/gi) || []).length;
      a.eq(open, close, f + " has " + open + " <script> and " + close + " </script>");
    });

    s.test(f + " — its inline script parses as JavaScript", (a) => {
      /* THE CHECK THAT WAS NOT HERE, AND THE COST OF THAT.

         22 September 2026. The passenger page rendered its header, the words
         "Loading the stops...", the theme chips — and then nothing, for ever.
         One stray bracket:

             '</div>' + '');

         left behind when the stamp moved to the date line in v1.72.0. The
         whole 121 kilobytes of script in that file failed to parse, so not a
         line of it ran.

         The suite said "every file parses, 23 of 23" throughout. It parsed
         Code.gs, worker.js and the two service workers — every .js file — and
         for the two PAGES it counted <script> tags against </script> tags and
         called that parsing. The logic of both apps lives inside those tags
         and nothing had ever read it.

         Counted as well as parsed, because a regex that silently matches
         nothing would make this pass by finding no work to do. */
      const src = readFileSync(join(ROOT, f), "utf8");
      const blocks = [...src.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)]
        .filter((m) => !/type\s*=\s*["'](?!text\/javascript|module)/i.test(m[1]));

      a.ok(blocks.length > 0, f + " has no inline script at all, which cannot be right");

      for (const m of blocks) {
        const line = src.slice(0, m.index).split("\n").length;
        try {
          new vm.Script(m[2], { filename: f + " (script at line " + line + ")" });
        } catch (err) {
          a.ok(false, f + ": the script starting at line " + line +
                      " does not parse — " + err.message);
        }
      }
    });
  }

  s.test("server/schema.sql builds every table the Worker writes to", (a) => {
    const sql = readFileSync(join(ROOT, "server/schema.sql"), "utf8");
    const worker = readFileSync(join(ROOT, "server/worker.js"), "utf8");
    const made = new Set([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]));
    const used = new Set();
    /* Comments stripped first. "reads FROM the settings table" in a comment
       is prose, and looking for a table called THE is how a check earns a
       reputation for crying wolf. */
    const sql_only = worker.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
    for (const m of sql_only.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM|FROM)\s+(\w+)/g)) {
      const t = m[1];
      if (!/^(SELECT|VALUES|WHERE|SET)$/i.test(t)) used.add(t);
    }
    const missing = [...used].filter((t) => !made.has(t) && !/^sqlite/.test(t));
    a.same(missing, [], "the Worker reads or writes " + missing.join(", ") + " and schema.sql never creates it");
  });

  return s;
}

/* ---- run ---------------------------------------------------------------- */

async function main() {
  installGlobals();

  const suites = [parseCheck()];

  const dir = join(here, "suites");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort() : [];
  for (const f of files) {
    if (only.length && !only.some((o) => f.toLowerCase().includes(o.toLowerCase()))) continue;
    const mod = await import(pathToFileURL(join(dir, f)).href);
    const made = await mod.default(ROOT);
    for (const s of [].concat(made)) suites.push(s);
  }

  let passed = 0, failed = 0;
  const bad = [];

  console.log("");
  console.log(paint(BOLD, "Minibus tests") + paint(DIM, "  " + ROOT));
  console.log("");

  for (const s of suites) {
    const r = await s.run();
    passed += r.passed; failed += r.failed;
    const head = r.failed
      ? paint(RED, "  ✗ ") + r.name
      : paint(GREEN, "  ✓ ") + r.name;
    console.log(head + paint(DIM, "  " + r.passed + "/" + (r.passed + r.failed)));
    for (const f of r.failures) {
      bad.push({ suite: r.name, ...f });
      console.log(paint(RED, "      · " + f.what));
      console.log(paint(DIM, "        " + f.why));
    }
  }

  cleanup(ROOT);

  console.log("");
  console.log("  " + (passed + failed) + " checks, " + passed + " passed, " + failed + " failed");
  console.log("");
  if (failed) {
    console.log(paint(RED, paint(BOLD, "  NOT READY")) + " — " + failed + " check" + (failed === 1 ? "" : "s") + " failed. Do not hand this over.");
    console.log("");
    process.exit(1);
  }
  console.log(paint(GREEN, paint(BOLD, "  READY")) + " — every check passed.");
  console.log("");
}

main().catch((err) => {
  console.error("");
  console.error(paint(RED, "  The run itself fell over, which is not a test failure:"));
  console.error("  " + (err && err.stack || err));
  console.error("");
  console.error(paint(RED, paint(BOLD, "  NOT READY")));
  process.exit(2);
});
