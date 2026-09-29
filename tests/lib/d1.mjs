/* A D1 shim over node:sqlite.

   The Worker is tested against a REAL SQLite database, not a mock of one.
   That is the whole point: the bugs worth catching here are SQL bugs — a
   column that is a keyword, an ON CONFLICT clause that does not fire, a
   UNIQUE index that lets a second row through — and none of them show up
   against a JavaScript object pretending to be a table.

   What is faked is only the SHAPE of the D1 client: prepare / bind / first /
   all / run / batch / exec. The statements themselves go to SQLite exactly
   as the Worker wrote them. */

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

/* SQLite will not take undefined, a boolean or a Date. D1 will, quietly, and
   the Worker leans on that in a few places, so the shim has to be at least as
   forgiving or the tests fail for a reason production would not. */
function norm(v) {
  if (v === undefined || v === null) return null;
  if (v === true) return 1;
  if (v === false) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint" || typeof v === "string") return v;
  return String(v);
}

/* node:sqlite hands back null-prototype objects. Anything that does
   `row.foo === undefined` is fine with that, but JSON.stringify and spread
   both behave oddly enough to be worth flattening once, here, rather than
   wondering about it in a suite. */
function plain(row) {
  if (!row) return row;
  const out = {};
  for (const k of Object.keys(row)) out[k] = row[k];
  return out;
}

export function makeDB(schemaPath) {
  const db = new DatabaseSync(":memory:");
  if (schemaPath) db.exec(readFileSync(schemaPath, "utf8"));
  return wrap(db);
}

/* The D1 shape, around a database somebody else opened. Split out so that
   makeOldDB below can build its own and still get the same object back. */
function wrap(db) {
  function prepare(sql) {
    /* Each prepare() gets its OWN args. batch() collects bound statements and
       runs them later, so sharing a slot between two of them would run the
       whole batch with the last one's values — which is exactly the sort of
       fault a test suite is supposed to find, not to have. */
    let args = [];
    const self = {
      bind(...a) { args = a.map(norm); return self; },
      async first() {
        const r = db.prepare(sql).get(...args);
        return r === undefined ? null : plain(r);
      },
      async all() {
        return { results: db.prepare(sql).all(...args).map(plain), success: true };
      },
      async run() {
        const info = db.prepare(sql).run(...args);
        return { success: true, meta: {
          changes: Number(info.changes || 0),
          last_row_id: Number(info.lastInsertRowid || 0)
        } };
      },
      /* For a suite that wants to see what was about to be sent. */
      _sql: sql,
      _args() { return args.slice(); }
    };
    return self;
  }

  return {
    prepare,
    async batch(list) {
      const out = [];
      /* D1 runs a batch in one transaction. Doing the same here means a suite
         that asserts "nothing was written" after a failure is testing the real
         behaviour rather than a partial write the shim happened to allow. */
      db.exec("BEGIN");
      try {
        for (const s of list) out.push(await s.run());
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return out;
    },
    async exec(sql) { db.exec(sql); return { count: 1 }; },

    /* Test-side conveniences. Never called by the Worker. */
    _raw: db,
    _rows(sql, ...a) { return db.prepare(sql).all(...a.map(norm)).map(plain); },
    _one(sql, ...a) { const r = db.prepare(sql).get(...a.map(norm)); return r === undefined ? null : plain(r); },
    _exec(sql) { db.exec(sql); }
  };
}

/* THE DATABASE AS IT ACTUALLY IS ON THE DAY, which is not what schema.sql
   describes.

   schema.sql is what you get building a database from nothing. Asim's D1 was
   built months ago and has been ALTERed by the Worker ever since, one column
   at a time, on first use. Every test here was built from the file, so every
   test had the new columns already and the migration path had nothing to
   migrate — which is exactly how a sync that could never add lat reached a
   live deployment and failed every five minutes.

   So this builds the current schema and then takes the columns back off,
   leaving the database in the state the Worker is supposed to find and
   repair. Anything that must survive meeting an older database is tested
   against this, not against schema.sql. */
export function makeOldDB(schemaPath) {
  /* Comments stripped FIRST, and not for tidiness. SQLite implements DROP
     COLUMN by rewriting the table's own DDL text with the column cut out of
     it — and `lat` and `lng` are the last two columns of `stops`, sitting
     under six lines of comment explaining them. Cut them and what is left to
     re-parse ends in a comment and a bracket:

       Error: error in table stops after drop column: incomplete input

     No string literal in this schema contains a double dash, so taking the
     comments out is safe here and nowhere near general. */
  const bare = readFileSync(schemaPath, "utf8")
    .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

  const db = new DatabaseSync(":memory:");
  db.exec(bare);
  const wrapped = wrap(db);

  for (const [table, col] of [["stops", "lat"], ["stops", "lng"],
                              ["trip_events", "ended_by"], ["push_subs", "last_eta"],
                              ["trip_events", "fix_note"]]) {
    wrapped._exec("ALTER TABLE " + table + " DROP COLUMN " + col);
    /* Checked, so that a schema change which quietly makes one of these a
       no-op cannot leave the suite believing it is testing an old database
       while testing a current one. */
    const has = wrapped._rows("SELECT name FROM pragma_table_info('" + table + "')")
      .some((r) => r.name === col);
    if (has) throw new Error("makeOldDB could not remove " + table + "." + col);
  }
  /* The coordinator's table arrived in w2.18.0, made by the Worker on first
     use. A live database older than that has none. */
  wrapped._exec("DROP TABLE IF EXISTS coord_actions");
  return wrapped;
}
