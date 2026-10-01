/* Apps Script, faked well enough to run Code.gs and badly enough to stay
   readable.

   The parts that CARRY A FACT are real: cell values, notes, data validation
   rules, sheet creation, sorting, row deletion, properties, the cache, the
   clock, the sent mail. Everything that is only ever cosmetic — widths,
   weights, colours, freezing — records that it happened and otherwise does
   nothing, because no behaviour in this app depends on a column being 140
   pixels wide and a suite that asserted it would only ever be in the way.

   The spreadsheet is a plain 2D array per tab. That is what a Google Sheet
   is, and modelling it as anything cleverer buys nothing and hides the
   off-by-one errors that this is here to catch. */

const EMPTY = "";

class FakeRange {
  constructor(sheet, row, col, rows, cols) {
    this.s = sheet; this.r = row; this.c = col;
    this.nr = rows || 1; this.nc = cols || 1;
  }
  getRow() { return this.r; }
  getColumn() { return this.c; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }

  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.s._get(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  getValue() { return this.s._get(this.r, this.c); }

  setValues(v) {
    for (let i = 0; i < this.nr; i++)
      for (let j = 0; j < this.nc; j++)
        this.s._set(this.r + i, this.c + j, v[i] && v[i][j] !== undefined ? v[i][j] : EMPTY);
    return this;
  }
  setValue(v) {
    for (let i = 0; i < this.nr; i++)
      for (let j = 0; j < this.nc; j++) this.s._set(this.r + i, this.c + j, v);
    return this;
  }

  /* Every real Range knows its sheet, and onRotaEditNotify is built on that:
     the first thing it does with an edit event is ask which tab it happened
     on. Without this the function returned at its first line, silently, and
     a test could only ever have proved that nothing happened. */
  getSheet() { return this.s; }

  setNote(n) { this.s._note(this.r, this.c, n == null ? "" : String(n)); return this; }
  getNote() { return this.s._getNote(this.r, this.c); }
  /* Real ranges have it, and onEditRequests calls it on a swap that applied
     cleanly. Without it the fake threw where Apps Script would not, which is
     a test failing for a reason the spreadsheet does not have. */
  clearNote() { this.s._note(this.r, this.c, ""); return this; }

  setDataValidation(rule) {
    for (let i = 0; i < this.nr; i++)
      for (let j = 0; j < this.nc; j++) this.s._valid(this.r + i, this.c + j, rule);
    return this;
  }
  getDataValidation() { return this.s._getValid(this.r, this.c); }

  clearContent() { return this.setValue(EMPTY); }
  clear() { this.setValue(EMPTY); return this; }

  /* Sorting one column of a range, which is all Code.gs ever asks for. */
  sort(spec) {
    const col = (typeof spec === "object" && spec) ? spec.column : spec;
    const asc = (typeof spec === "object" && spec) ? spec.ascending !== false : true;
    const rows = this.getValues();
    const idx = col - this.c;
    rows.sort((a, b) => {
      const x = a[idx], y = b[idx];
      if (x === y) return 0;
      if (x === EMPTY || x === null || x === undefined) return 1;
      if (y === EMPTY || y === null || y === undefined) return -1;
      return (x > y ? 1 : -1) * (asc ? 1 : -1);
    });
    this.setValues(rows);
    return this;
  }

  /* Cosmetic. Recorded, never acted on. */
  setBackground(v) { this.s.cosmetic.push(["background", this.r, this.c, v]); return this; }
  setFontWeight(v) { this.s.cosmetic.push(["weight", this.r, this.c, v]); return this; }
  setFontColor(v) { this.s.cosmetic.push(["colour", this.r, this.c, v]); return this; }
  setNumberFormat(v) { this.s.cosmetic.push(["format", this.r, this.c, v]); return this; }
  setWrap(v) { return this; }
  setHorizontalAlignment(v) { return this; }
  setFontSize(v) { return this; }
  setFontStyle(v) { return this; }
  setBorder() { return this; }
  merge() { return this; }
  activate() { return this; }
}

class FakeSheet {
  constructor(name, grid) {
    this.name = name;
    this.cells = (grid || []).map((r) => r.slice());
    this.notes = {};
    this.valids = {};
    this.cosmetic = [];
    this.frozen = 0;
    this.widths = {};
    this.id = Math.floor(Math.random() * 1e9);
  }
  _grow(row, col) {
    while (this.cells.length < row) this.cells.push([]);
    for (let i = 0; i < this.cells.length; i++) {
      while (this.cells[i].length < col) this.cells[i].push(EMPTY);
    }
  }
  _get(row, col) {
    const r = this.cells[row - 1];
    if (!r) return EMPTY;
    const v = r[col - 1];
    return v === undefined ? EMPTY : v;
  }
  _set(row, col, v) { this._grow(row, col); this.cells[row - 1][col - 1] = v; }
  _note(row, col, n) { this.notes[row + ":" + col] = n; }
  _getNote(row, col) { return this.notes[row + ":" + col] || ""; }
  _valid(row, col, rule) { this.valids[row + ":" + col] = rule; }
  _getValid(row, col) { return this.valids[row + ":" + col] || null; }

  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getSheetId() { return this.id; }

  getLastRow() {
    let last = 0;
    for (let i = 0; i < this.cells.length; i++) {
      if (this.cells[i].some((v) => v !== EMPTY && v !== null && v !== undefined)) last = i + 1;
    }
    return last;
  }
  getLastColumn() {
    let last = 0;
    for (const row of this.cells) {
      for (let j = row.length - 1; j >= 0; j--) {
        if (row[j] !== EMPTY && row[j] !== null && row[j] !== undefined) { last = Math.max(last, j + 1); break; }
      }
    }
    return last;
  }
  getMaxRows() { return Math.max(this.cells.length, this.getLastRow(), 1); }
  getMaxColumns() { return Math.max(this.getLastColumn(), (this.cells[0] || []).length, 1); }

  getRange(a, b, c, d) {
    /* A1 notation is used in a couple of places. Only the shapes Code.gs
       actually writes are understood, and anything else throws loudly rather
       than returning a range over the wrong cells. */
    if (typeof a === "string") {
      const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a.toUpperCase());
      if (!m) throw new Error("fake getRange cannot read A1 notation: " + a);
      const c1 = colNum(m[1]), r1 = Number(m[2]);
      const c2 = m[3] ? colNum(m[3]) : c1, r2 = m[4] ? Number(m[4]) : r1;
      return new FakeRange(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    return new FakeRange(this, a, b, c || 1, d || 1);
  }
  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  appendRow(vals) {
    const row = this.getLastRow() + 1;
    this._grow(row, vals.length);
    for (let j = 0; j < vals.length; j++) this._set(row, j + 1, vals[j]);
    return this;
  }
  insertRowsAfter(after, how) {
    const blank = new Array(this.getMaxColumns()).fill(EMPTY);
    for (let i = 0; i < (how || 1); i++) this.cells.splice(after + i, 0, blank.slice());
    return this;
  }
  /* Column inserts move the cells right of it along. Notes and validation
     are keyed by position and are not moved: every insert Code.gs makes today
     adds a column at the right-hand end, where there are none to move. */
  insertColumnsAfter(after, how) {
    this._grow(1, after);
    for (const r of this.cells) for (let i = 0; i < (how || 1); i++) r.splice(after, 0, EMPTY);
    return this;
  }
  insertColumnAfter(after) { return this.insertColumnsAfter(after, 1); }
  insertColumnBefore(col) { return this.insertColumnsAfter(col - 1, 1); }
  deleteRow(row) { this.cells.splice(row - 1, 1); return this; }
  deleteRows(row, how) { this.cells.splice(row - 1, how || 1); return this; }
  setFrozenRows(n) { this.frozen = n; return this; }
  setColumnWidth(c, w) { this.widths[c] = w; return this; }
  autoResizeColumn() { return this; }
  hideColumn() { return this; }
  showColumns() { return this; }
  getFilter() { return null; }
  /* Protection is recorded: what it says and whether it only warns. */
  protect() {
    const p = { desc: "", warn: false, ranges: [],
      setDescription(d) { p.desc = String(d); return p; }, getDescription() { return p.desc; },
      setWarningOnly(w) { p.warn = !!w; return p; }, isWarningOnly() { return p.warn; },
      setUnprotectedRanges(r) { p.ranges = r || []; return p; },
      remove: () => { this.protections = this.protections.filter((x) => x !== p); } };
    (this.protections = this.protections || []).push(p);
    return p;
  }
  getConditionalFormatRules() { return (this.cfRules || []).slice(); }
  setConditionalFormatRules(r) { this.cfRules = (r || []).slice(); return this; }
  activate() { return this; }
  createTextFinder(q) {
    const self = this;
    return { findAll() {
      const out = [];
      for (let i = 0; i < self.cells.length; i++)
        for (let j = 0; j < self.cells[i].length; j++)
          if (String(self.cells[i][j]).indexOf(q) !== -1) out.push(new FakeRange(self, i + 1, j + 1, 1, 1));
      return out;
    } };
  }
}

function colNum(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

class FakeSpreadsheet {
  constructor(tabs) {
    this.sheets = [];
    for (const name of Object.keys(tabs || {})) this.sheets.push(new FakeSheet(name, tabs[name]));
    this.url = "https://docs.google.com/spreadsheets/d/FAKE/edit";
    this.id = "FAKE";
  }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) { const s = new FakeSheet(n, []); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  getUrl() { return this.url; }
  getId() { return this.id; }
  getName() { return "Minibus (test)"; }
  getActiveSheet() { return this.sheets[0]; }
  setActiveSheet(s) { return s; }
  toast() {}
  rename(n) { return this; }
}

/* ---- the services ------------------------------------------------------ */

export function makeGas(opts) {
  opts = opts || {};
  const ss = new FakeSpreadsheet(opts.tabs || {});
  const props = Object.assign({}, opts.props || {});
  const cache = {};
  const mail = [];
  const triggers = [];
  const logs = [];
  const fetched = [];
  let fetchReply = null;

  const PropertiesService = {
    getScriptProperties() {
      return {
        getProperty: (k) => (k in props ? String(props[k]) : null),
        setProperty: (k, v) => { props[k] = String(v); return this; },
        deleteProperty: (k) => { delete props[k]; },
        getProperties: () => Object.assign({}, props),
        setProperties: (o) => { Object.assign(props, o); }
      };
    },
    getUserProperties() { return PropertiesService.getScriptProperties(); },
    getDocumentProperties() { return PropertiesService.getScriptProperties(); }
  };

  const CacheService = {
    getScriptCache() {
      return {
        get: (k) => (k in cache ? cache[k].v : null),
        put: (k, v, sec) => { cache[k] = { v: String(v), until: Date.now() + (sec || 600) * 1000 }; },
        remove: (k) => { delete cache[k]; },
        getAll: (ks) => { const o = {}; for (const k of ks) if (k in cache) o[k] = cache[k].v; return o; },
        putAll: (o, sec) => { for (const k of Object.keys(o)) cache[k] = { v: String(o[k]), until: Date.now() + (sec || 600) * 1000 }; }
      };
    },
    getUserCache() { return CacheService.getScriptCache(); },
    getDocumentCache() { return CacheService.getScriptCache(); }
  };

  const Session = {
    getActiveUser: () => ({ getEmail: () => opts.userEmail || "arthur@example.org" }),
    getEffectiveUser: () => ({ getEmail: () => opts.userEmail || "arthur@example.org" }),
    getScriptTimeZone: () => "Europe/London",
    getTemporaryActiveUserKey: () => "tmpkey"
  };

  const Utilities = {
    formatDate(d, tz, fmt) {
      /* A DATE, OR NOTHING. Real Apps Script throws on anything else. This fake
         handed the value straight to Intl, which treats undefined as "now" —
         and not even the pinned now, because Intl reads the system clock
         directly rather than the patched Date. So a call that had LOST its date
         argument came back with a confident, plausible, wholly unrelated day,
         and said nothing.

         Found by writing a check that fired notifyRotaRequest at three
         different hours and expected the same words each time. All three came
         back stamped with the real date the test was run on. The fixture was
         missing the function's second argument — and this let it through, which
         is the trap the whole suite exists to avoid: a fake more forgiving than
         the thing it stands in for. */
      /* DUCK-TYPED, NOT instanceof. Code.gs runs in a vm with its own realm, so
         a Date built in there is not an instance of this file's Date at all.
         The first version of this guard used instanceof and rejected every
         perfectly good date the script makes for itself — four checks went red
         carrying a message that named a real Date and called it not a Date. */
      if (!d || typeof d.getTime !== "function" || isNaN(d.getTime())) {
        throw new Error("fake Utilities.formatDate was given " +
                        (d === undefined ? "undefined" : JSON.stringify(String(d))) +
                        " instead of a Date. Real Apps Script throws here too.");
      }
      /* Only the patterns Code.gs uses. A pattern it does not know is a
         failure, not a guess: a wrong date silently formatted is exactly the
         class of bug this suite exists for.

         THE ZONE IS OBEYED. It used to be ignored and everything came back as
         London, which would have let a calendar file claiming to be in UTC
         quietly carry a British Summer Time clock — an hour out, in a file
         whose whole job is to say when to turn up. */
      const p = londonParts(d, tz);
      const map = {
        "yyyy-MM-dd": `${p.y}-${p.mo}-${p.d}`,
        "yyyy-MM-dd HH:mm": `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}`,
        "yyyy-MM-dd HH:mm:ss": `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}:${p.s}`,
        "HH:mm": `${p.h}:${p.mi}`,
        "HH:mm:ss": `${p.h}:${p.mi}:${p.s}`,
        "EEE d MMM": `${p.wd} ${Number(p.d)} ${p.mon}`,
        "EEEE d MMMM": `${p.wdl} ${Number(p.d)} ${p.monl}`,
        "EEEE d MMMM yyyy": `${p.wdl} ${Number(p.d)} ${p.monl} ${p.y}`,
        "dd/mm/yyyy": `${p.d}/${p.mo}/${p.y}`,
        "d MMM": `${Number(p.d)} ${p.mon}`,
        "d MMMM": `${Number(p.d)} ${p.monl}`,
        "d MMMM yyyy": `${Number(p.d)} ${p.monl} ${p.y}`,
        "dd/MM/yyyy": `${p.d}/${p.mo}/${p.y}`,
        "yyyyMMdd": `${p.y}${p.mo}${p.d}`,
        "yyyyMMdd-HHmm": `${p.y}${p.mo}${p.d}-${p.h}${p.mi}`,
        /* A hand-typed Vehicle Log row's Log ID, from v1.92.0. */
        "yyyyMMdd-HHmmss": `${p.y}${p.mo}${p.d}-${p.h}${p.mi}${p.s}`,
        /* The calendar file's own two. */
        "yyyyMMdd'T'HHmmss'Z'": `${p.y}${p.mo}${p.d}T${p.h}${p.mi}${p.s}Z`,
        "yyyyMMdd'T'HHmmss": `${p.y}${p.mo}${p.d}T${p.h}${p.mi}${p.s}`
      };
      if (!(fmt in map)) throw new Error("fake Utilities.formatDate does not know the pattern " + fmt);
      return map[fmt];
    },
    computeDigest(algo, value) {
      /* A stable, deterministic stand-in. It is NOT SHA-256 and does not
         pretend to be: nothing in the app checks the hash against anything
         computed elsewhere, both sides of the PIN comparison run through this
         same function, and a real digest here would only slow the run down.
         The one property that matters is that different inputs give different
         bytes, and that holds. */
      const s = String(value);
      const out = new Array(32).fill(0);
      for (let i = 0; i < s.length; i++) {
        out[i % 32] = (out[i % 32] * 31 + s.charCodeAt(i) + i) % 256;
      }
      return out.map((n) => (n > 127 ? n - 256 : n));
    },
    base64Encode(v) {
      if (Array.isArray(v)) return Buffer.from(v.map((n) => (n < 0 ? n + 256 : n))).toString("base64");
      return Buffer.from(String(v), "utf8").toString("base64");
    },
    base64Decode(s) { return [...Buffer.from(String(s), "base64")].map((n) => (n > 127 ? n - 256 : n)); },
    getUuid() { return "uuid-" + Math.random().toString(36).slice(2); },
    sleep() {},
    newBlob(v) { return { getDataAsString: () => String(v), getBytes: () => [...Buffer.from(String(v))] }; },
    DigestAlgorithm: { SHA_256: "SHA_256", MD5: "MD5" },
    Charset: { UTF_8: "UTF_8" }
  };

  const MailApp = {
    sendEmail(a, b, c, d) {
      mail.push(typeof a === "object" ? a : { to: a, subject: b, body: c, options: d });
    },
    getRemainingDailyQuota() { return 1500; }
  };

  const ScriptApp = {
    getProjectTriggers() { return triggers.slice(); },
    deleteTrigger(t) { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
    newTrigger(fn) {
      const t = { fn, type: "", detail: {} };
      const build = {
        timeBased() {
          const tb = {
            everyMinutes(n) { t.type = "minutes"; t.detail.every = n; return tb; },
            everyHours(n) { t.type = "hours"; t.detail.every = n; return tb; },
            everyDays(n) { t.type = "days"; t.detail.every = n; return tb; },
            everyWeeks(n) { t.type = "weeks"; t.detail.every = n; return tb; },
            atHour(h) { t.detail.hour = h; return tb; },
            nearMinute(m) { t.detail.minute = m; return tb; },
            onWeekDay(d) { t.detail.weekday = d; return tb; },
            inTimezone(z) { t.detail.tz = z; return tb; },
            create() { triggers.push(t); return t; }
          };
          return tb;
        },
        forSpreadsheet() {
          const sb = {
            onEdit() { t.type = "edit"; return sb; },
            onChange() { t.type = "change"; return sb; },
            onOpen() { t.type = "open"; return sb; },
            create() { triggers.push(t); return t; }
          };
          return sb;
        }
      };
      return build;
    },
    WeekDay: { MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 0 },
    EventType: { ON_EDIT: "ON_EDIT", CLOCK: "CLOCK" },
    getService: () => ({ getUrl: () => "https://script.google.com/macros/s/FAKE/exec" })
  };

  /* THE LOCK CAN BE MADE TO LOSE.

     It always won, which meant the every-path-holds-the-lock code was tested
     only along the path where the lock is free. A second script inside the
     same function is the whole reason the lock is there, and a fake that
     cannot be contended cannot show what happens then. */
  let lockHeldByAnother = false;
  const LockService = {
    getScriptLock() {
      return {
        tryLock: () => !lockHeldByAnother,
        waitLock: () => { if (lockHeldByAnother) throw new Error("Could not obtain lock"); return true; },
        releaseLock: () => {},
        hasLock: () => !lockHeldByAnother
      };
    },
    getUserLock() { return LockService.getScriptLock(); }
  };

  const UrlFetchApp = {
    fetch(url, opts) {
      fetched.push({ url: String(url), opts: opts || {} });
      /* A function answers each call on its own terms, for a test in which
         one menu item makes more than one call. */
      const r = (typeof fetchReply === "function" ? fetchReply(String(url), opts || {}) : fetchReply) ||
                { code: 200, body: JSON.stringify({ ok: true }) };
      return {
        getResponseCode: () => r.code,
        getContentText: () => r.body,
        getAllHeaders: () => ({})
      };
    }
  };

  const ContentService = {
    createTextOutput(t) {
      const o = { _t: t, setMimeType() { return o; }, getContent: () => o._t };
      return o;
    },
    MimeType: { JSON: "JSON", TEXT: "TEXT" }
  };

  const SpreadsheetApp = {
    getActiveSpreadsheet: () => ss,
    getActive: () => ss,
    openById: () => ss,
    openByUrl: () => ss,
    flush() {},
    getUi() {
      return {
        alert(...a) { logs.push(["alert", ...a]); return "OK"; },
        prompt(...a) { logs.push(["prompt", ...a]); return { getSelectedButton: () => "OK", getResponseText: () => "" }; },
        createMenu(n) {
          const m = { addItem() { return m; }, addSeparator() { return m; }, addSubMenu() { return m; }, addToUi() {} };
          return m;
        },
        ButtonSet: { OK: "OK", OK_CANCEL: "OK_CANCEL", YES_NO: "YES_NO" },
        Button: { OK: "OK", CANCEL: "CANCEL", YES: "YES", NO: "NO" }
      };
    },
    newDataValidation() {
      const rule = { _values: [], _help: "", _allowInvalid: true };
      const b = {
        requireValueInList(list, drop) { rule._values = list.slice(); rule._drop = drop !== false; return b; },
        /* A date, or a date between two. Kept so a test can ask what the
           cell will take, as the Buses tab's due dates do from v1.92.0. */
        requireDate() { rule._date = {}; return b; },
        requireDateBetween(from, to) { rule._date = { from, to }; return b; },
        setAllowInvalid(v) { rule._allowInvalid = !!v; return b; },
        setHelpText(t) { rule._help = t; return b; },
        build() { return Object.assign(rule, { getCriteriaValues: () => [rule._values], copy: () => b }); }
      };
      return b;
    },
    DataValidationCriteria: { VALUE_IN_LIST: "VALUE_IN_LIST", DATE_BETWEEN: "DATE_BETWEEN" },
    /* A rule is recorded and never applied: how a cell looks carries no fact. */
    newConditionalFormatRule() {
      const rule = { _ranges: [] };
      const b = new Proxy({}, { get: (t, k) => k === "build"
        ? () => Object.assign(rule, { getRanges: () => rule._ranges, getBooleanCondition: () => null })
        : k === "setRanges" ? (r) => { rule._ranges = r || []; return b; }
        : (...a) => { rule[k] = a; return b; } });
      return b;
    },
    BorderStyle: { SOLID: "SOLID" }
  };

  const Logger = { log(...a) { logs.push(a); }, clear() { logs.length = 0; }, getLog: () => logs.map(String).join("\n") };

  return {
    ss, mail, triggers, logs, fetched, props, cache,
    setFetchReply(r) { fetchReply = r; },
    /* Stand somebody else in the critical section. */
    holdTheLock(yes) { lockHeldByAnother = yes !== false; },
    globals: {
      SpreadsheetApp, PropertiesService, CacheService, Session, Utilities,
      MailApp, GmailApp: MailApp, ScriptApp, LockService, UrlFetchApp,
      ContentService, Logger,
      HtmlService: { createHtmlOutput: (h) => ({ _h: h, setTitle: () => ({}), getContent: () => h }) }
    }
  };
}

/* London parts without pulling in a date library. Enough for the formats
   above; the Worker has its own and is tested against that one. */
function londonParts(d, tz) {
  const zone = (tz === "UTC" || tz === "GMT" || tz === "Etc/UTC") ? "UTC" : "Europe/London";
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
  const g = {};
  for (const p of f.formatToParts(d)) g[p.type] = p.value;
  const wd = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short" }).format(d);
  const wdl = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long" }).format(d);
  const mon = new Intl.DateTimeFormat("en-GB", { timeZone: zone, month: "short" }).format(d);
  const monl = new Intl.DateTimeFormat("en-GB", { timeZone: zone, month: "long" }).format(d);
  return { y: g.year, mo: g.month, d: g.day, h: g.hour === "24" ? "00" : g.hour, mi: g.minute, s: g.second, wd, wdl, mon, monl };
}
