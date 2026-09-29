/* The smallest assertion library that still tells you what went wrong.

   Every check has a NAME, and the name is a sentence about the behaviour,
   not about the function. When one fails at eight on a Sunday morning the
   name is the whole of the diagnosis, so "an older check arriving late does
   not overrule a newer one" earns its length and "testOutcome3" does not. */

export class Suite {
  constructor(name) {
    this.name = name;
    this.checks = [];
    this.only = null;
  }

  /* An ordinary check. fn may be async; a throw is a failure and the message
     is kept. */
  test(what, fn) { this.checks.push({ what, fn }); }

  async run() {
    const out = { name: this.name, passed: 0, failed: 0, failures: [] };
    for (const c of this.checks) {
      try {
        await c.fn(assert);
        out.passed++;
      } catch (err) {
        out.failed++;
        out.failures.push({ what: c.what, why: (err && err.message) || String(err) });
      }
    }
    return out;
  }
}

function fail(msg) { throw new Error(msg); }

export const assert = {
  ok(v, msg) { if (!v) fail(msg || ("expected truthy, got " + show(v))); },
  not(v, msg) { if (v) fail(msg || ("expected falsy, got " + show(v))); },

  eq(a, b, msg) {
    if (!Object.is(a, b) && !(a === b)) {
      fail(msg || ("expected " + show(b) + ", got " + show(a)));
    }
  },
  ne(a, b, msg) {
    if (a === b) fail(msg || ("expected anything but " + show(b)));
  },

  /* Deep equality, for payload shapes. Order of object keys is not
     significant; order of array elements is. */
  same(a, b, msg) {
    const A = JSON.stringify(sortKeys(a)), B = JSON.stringify(sortKeys(b));
    if (A !== B) fail(msg || ("expected " + B + ", got " + A));
  },

  has(haystack, needle, msg) {
    const s = String(haystack == null ? "" : haystack);
    if (s.indexOf(String(needle)) === -1) {
      fail(msg || ("expected to find " + show(needle) + " in " + show(clip(s))));
    }
  },
  hasnt(haystack, needle, msg) {
    const s = String(haystack == null ? "" : haystack);
    if (s.indexOf(String(needle)) !== -1) {
      fail(msg || ("did not expect to find " + show(needle) + " in " + show(clip(s))));
    }
  },

  /* Within a tolerance, for anything that came off a clock or a distance. */
  near(a, b, slack, msg) {
    if (Math.abs(Number(a) - Number(b)) > Number(slack)) {
      fail(msg || ("expected " + b + " give or take " + slack + ", got " + a));
    }
  },

  async throws(fn, msg) {
    let threw = false;
    try { await fn(); } catch (e) { threw = true; }
    if (!threw) fail(msg || "expected this to throw, and it did not");
  }
};

function show(v) {
  if (typeof v === "string") return JSON.stringify(v);
  if (v === undefined) return "undefined";
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}
function clip(s) { return s.length > 300 ? s.slice(0, 300) + "…" : s; }
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}
