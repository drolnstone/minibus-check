-- ==========================================================================
-- Minibus API, D1 schema
--
-- Three kinds of table, and the difference is the whole design:
--
--   COPIED IN   stops, rota, buses, drivers
--               The spreadsheet owns these. You edit them there, exactly as
--               now, and Apps Script pushes them here. Nothing in this
--               database ever writes to them, so the two can never disagree.
--
--   BOTH        checks_today
--               One row per bus: its latest walkaround and whether it
--               stopped the bus. Written here the moment a walkaround
--               arrives, and again by Apps Script as it files each one on
--               the Checks tab. The Outcome column on that tab changes it
--               through the Worker's outcome action.
--
--   OWNED HERE  bookings, trip_events, checks_in, settings, push_subs, photos
--               Written by phones during a Sunday. Apps Script pulls copies
--               back into the Sheet for the record, the emails, the reports
--               and the archiver. settings also holds the day's signatures
--               (auth:) and the time of the last decision about each bus
--               (dec:).
--
-- A new database: paste this whole file into the D1 console in the dashboard
-- and run it, or  wrangler d1 execute minibus --file=schema.sql --remote
-- Safe to run twice. An existing database needs nothing from it.
-- ==========================================================================

-- ---- copied in from the Sheet -------------------------------------------

CREATE TABLE IF NOT EXISTS stops (
  stop_id   TEXT PRIMARY KEY,
  route     TEXT NOT NULL,
  time      TEXT NOT NULL,          -- "10:05", text, never a time value
  stop      TEXT NOT NULL,
  postcode  TEXT DEFAULT '',
  place     TEXT DEFAULT '',        -- the Sheet's "Where": doorstep address,
                                    -- driver app only, never sent to a passenger
  kind      TEXT DEFAULT 'pickup',  -- pickup | arrival | depart
  seq       INTEGER DEFAULT 0,      -- the order they sit in on the tab, which
                                    -- is the order a driver taps them
  -- The kerb itself, from the Lat and Lng columns on the Bus Stops tab.
  -- NULL means nobody has typed one in, which is not the same as 0: zero is a
  -- real coordinate in the Gulf of Guinea, and reading every unfilled stop as
  -- the same place is how the estimate would quietly stop working.
  -- Used for two things and no others: the driver's map link, and the detour
  -- part of what skipping a stop saves. Nothing tracks a bus with them.
  -- Added to a live database by the Worker on first use.
  lat       REAL,
  lng       REAL
);
CREATE INDEX IF NOT EXISTS stops_route ON stops(route, seq);

CREATE TABLE IF NOT EXISTS rota (
  sunday      TEXT PRIMARY KEY,     -- YYYY-MM-DD
  north       TEXT DEFAULT '',
  north_cover TEXT DEFAULT '',
  north_bus   TEXT DEFAULT '',
  south       TEXT DEFAULT '',
  south_cover TEXT DEFAULT '',
  south_bus   TEXT DEFAULT '',
  status      TEXT DEFAULT '',
  notes       TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS buses (
  reg    TEXT PRIMARY KEY,
  seats  INTEGER DEFAULT 0,         -- PASSENGER seats, not counting the driver
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS drivers (
  name     TEXT PRIMARY KEY,
  role     TEXT DEFAULT '',
  route    TEXT DEFAULT 'North',
  ord      INTEGER DEFAULT 0,
  active   INTEGER DEFAULT 1,
  -- A SALTED ONE WAY HASH OF THE DEFAULT PIN, AND NEVER THE PIN.
  --
  -- The default PIN is the last four digits of the Phone on the Drivers tab
  -- (from w2.39.0; there is no PIN column). Apps Script works it out and
  -- posts only this hash on every sync. A driver's own PIN is in driver_pins.
  --
  -- It is here so that keying a PIN is answered by this server in well under
  -- a tenth of a second instead of by Apps Script in two to eight, at the one
  -- moment a man is standing beside a bus with people waiting to get on it.
  --
  -- Empty means no default PIN (no phone number). With no own PIN either,
  -- that is how somebody without one gets in. It is not a failure.
  pin_hash TEXT NOT NULL DEFAULT ''
);

-- Which bus has been checked today, and whether the check stopped it.
-- Written by the Worker the moment a walkaround is posted to it, and again by
-- Apps Script as each check is filed on the tab. The same check told twice
-- keeps its first time: see check_id below.
CREATE TABLE IF NOT EXISTS checks_today (
  reg    TEXT PRIMARY KEY,
  day    TEXT NOT NULL,             -- YYYY-MM-DD, London
  state  TEXT NOT NULL,             -- ok | stopped
  at     INTEGER NOT NULL,          -- ms
  driver TEXT DEFAULT '',
  -- Which walkaround this row is. The same check told twice keeps its time,
  -- so a drain filing it after an authorisation does not undo the
  -- authorisation. Added to a live database by the Worker on first use.
  check_id TEXT NOT NULL DEFAULT ''
);

-- The walkaround, as the phone posted it, waiting for Apps Script to file it
-- on the Checks tab. Created by the Worker on demand as well as here, so a
-- database that predates this needs no console step to start taking them.
--
-- body is the whole check as one JSON string. Nothing on this server reads
-- inside it: the two facts it needs, which bus and whether it stopped, are
-- lifted into their own columns. The spreadsheet is what a person reads, and
-- Apps Script already knows how to write that tab.
CREATE TABLE IF NOT EXISTS checks_in (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id TEXT NOT NULL UNIQUE,     -- made on the handset, so a retry is the same row
  reg      TEXT NOT NULL DEFAULT '',
  day      TEXT NOT NULL DEFAULT '', -- YYYY-MM-DD, London
  level    TEXT NOT NULL DEFAULT 'ok',   -- ok | warn | stop
  driver   TEXT NOT NULL DEFAULT '',
  received INTEGER NOT NULL,         -- ms: when the walkaround was DONE, by the
                                     -- Worker's clock (arrival less the age the
                                     -- phone reports). Every ordering uses this.
  body     TEXT NOT NULL,
  synced   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS checks_in_sync ON checks_in(synced);

-- ---- owned here ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS bookings (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  sunday    TEXT NOT NULL,
  route     TEXT NOT NULL,
  stop_id   TEXT NOT NULL,
  stop      TEXT NOT NULL,
  seats     INTEGER NOT NULL DEFAULT 0,
  device    TEXT DEFAULT '',        -- the handle the browser made up for itself
  pid       TEXT DEFAULT '',        -- one-way fingerprint of the phone number
  phone     TEXT DEFAULT '',        -- the number itself
  status    TEXT NOT NULL DEFAULT 'Booked',
  received  INTEGER NOT NULL,       -- ms
  note      TEXT DEFAULT '',        -- late-withdrawal note, for the Sheet
  synced    INTEGER NOT NULL DEFAULT 0,  -- 0 until Apps Script has taken a copy
  sched     TEXT NOT NULL DEFAULT ''     -- the stop's timetable time when booked (w2.32.0)
);
CREATE INDEX IF NOT EXISTS bookings_sunday ON bookings(sunday, status);
CREATE INDEX IF NOT EXISTS bookings_pid    ON bookings(sunday, pid);
CREATE INDEX IF NOT EXISTS bookings_device ON bookings(sunday, device);
CREATE INDEX IF NOT EXISTS bookings_sync   ON bookings(synced);

CREATE TABLE IF NOT EXISTS trip_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  trip      TEXT NOT NULL,
  sunday    TEXT NOT NULL,
  route     TEXT NOT NULL,
  driver    TEXT DEFAULT '',
  reg       TEXT DEFAULT '',
  rota_bus  TEXT DEFAULT '',
  event     TEXT NOT NULL,          -- start | end | picked | none | undo
  stop_id   TEXT DEFAULT '',
  stop      TEXT DEFAULT '',
  scheduled TEXT DEFAULT '',        -- "10:05"
  happened  INTEGER NOT NULL,       -- ms, from the DRIVER'S phone, never the server
  off_min   INTEGER,                -- minutes off the timetable; NULL is not zero.
                                    -- NOT called "offset": that is a SQLite keyword and
                                    -- an unquoted INSERT into it fails to parse.
  status    TEXT NOT NULL DEFAULT 'Logged',
  geo       TEXT DEFAULT '',
  acc       INTEGER,
  away      INTEGER,
  logged    INTEGER NOT NULL,       -- ms, when the server received it
  -- WHO ENDED THE RUN. Only ever set on an end row.
  --
  -- For an ordinary end it is the driver's own name and says nothing new. For
  -- a run closed by a coordinator through the endrun action it is his, while
  -- `driver` stays the man who drove — because it was his run and the record
  -- should go on saying so. The two names differing IS the fact worth
  -- keeping. Added to a live database by the Worker on first use.
  ended_by  TEXT NOT NULL DEFAULT '',
  synced    INTEGER NOT NULL DEFAULT 0,
  -- A TIME PUT RIGHT FROM THE COORDINATOR'S APP (w2.18.0): who corrected it,
  -- when, and the time it was first recorded as. Written onto the Happened
  -- cell as a note by the drain, and the Status gains ", Corrected". Blank on
  -- every row nobody has corrected. Added to a live database on first use.
  fix_note  TEXT NOT NULL DEFAULT ''
);
-- One live row per trip, stop and event, so a phone that retries costs nothing.
CREATE UNIQUE INDEX IF NOT EXISTS trip_once ON trip_events(trip, event, stop_id);
CREATE INDEX IF NOT EXISTS trip_day  ON trip_events(sunday, route);
CREATE INDEX IF NOT EXISTS trip_sync ON trip_events(synced);

-- Rehearsal state and anything else small that has to outlive a request.
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- WHO HAS ASKED TO BE TOLD
--
-- One row per phone that has granted notification permission. Passengers are
-- matched by the same two handles a booking is: the device reference and the
-- salted phone fingerprint. Drivers are matched by name.
--
-- endpoint is unique because it IS the phone as far as the push service is
-- concerned: re-subscribing on the same handset returns the same address, and
-- a second row for it would mean two buzzes for one pocket.
--
-- No payload is ever sent to these, so nothing here can leak what a message
-- was going to say. p256dh and auth are kept for the day that changes.
CREATE TABLE IF NOT EXISTS push_subs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh   TEXT NOT NULL DEFAULT '',
  auth     TEXT NOT NULL DEFAULT '',
  role     TEXT NOT NULL DEFAULT 'passenger',
  ref      TEXT NOT NULL DEFAULT '',
  pid      TEXT NOT NULL DEFAULT '',
  driver   TEXT NOT NULL DEFAULT '',
  route    TEXT NOT NULL DEFAULT '',
  made     INTEGER NOT NULL DEFAULT 0,
  seen     INTEGER NOT NULL DEFAULT 0,
  fails    INTEGER NOT NULL DEFAULT 0,
  last     TEXT NOT NULL DEFAULT '',
  -- WHAT THIS PHONE WAS LAST TOLD, in minutes to its own stop.
  --
  -- A passenger is woken once for every booked stop in front of his, and on a
  -- full morning that is seven or eight times. The threshold in
  -- passenger_rules holds back the ones that would say the same thing twice,
  -- and it needs a number to compare against: `last` above is matched for
  -- equality, so a minute's drift would read as a change and nothing would
  -- ever be held back. NULL means nothing has been said yet.
  -- Added to a live database by the Worker on first use.
  last_eta INTEGER,
  -- Which app signed this endpoint up: driver, coord, both, or '' (before
  -- w2.43.0). Added to a live database by the Worker on first use.
  app      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS push_role ON push_subs(role);
CREATE INDEX IF NOT EXISTS push_ref  ON push_subs(ref);
CREATE INDEX IF NOT EXISTS push_pid  ON push_subs(pid);

-- ---------------------------------------------------------------------------
-- A ROTA REQUEST, TAKEN BY THE WORKER FIRST (w2.17.0)
--
-- A driver's swap or cover request, as the phone posted it, until Apps Script
-- has filed it on the Rota Requests tab. id is made on the phone, so a retry
-- is the same row. synced follows the drain's stamp rule: below 1 is pending.
-- Created by the Worker on first use, so a live database needs no console step.
CREATE TABLE IF NOT EXISTS requests (
  id       TEXT PRIMARY KEY,
  sunday   TEXT NOT NULL,
  driver   TEXT NOT NULL DEFAULT '',
  type     TEXT NOT NULL DEFAULT '',
  body     TEXT NOT NULL,
  received INTEGER NOT NULL,
  synced   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS requests_sync ON requests(synced);

-- ---------------------------------------------------------------------------
-- A DECISION MADE FROM AN EMAIL
--
-- One row per link put in a message to the coordinator: a bus stopped by a
-- critical defect, or a driver asking to swap. The link opens a page; the page
-- asks for his PIN; only the PIN acts.
--
-- IT IS NEVER A ONE-CLICK LINK. A link that acts when it is opened is acted on
-- by whatever opens it, and mail providers, phone previews and corporate
-- gateways all open links before a person does. Any of them would otherwise
-- authorise a bus with a fault on it while the email was still unread.
--
-- token    128 bits of hex from the platform's generator, never Math.random
-- kind     authorise | rota
-- subject  what the decision is about, as JSON. Never more than the email
--          it came in already said
-- used     one use only, and `expires` is an hour after minting by default
-- synced   rota decisions only: the Rota Requests tab is not this server's to
--          write, so the decision rides the drain back to Apps Script and is
--          held here until the spreadsheet says it has it
--
-- Created by the Worker on first use, so a live database needs no console step.
CREATE TABLE IF NOT EXISTS links (
  token   TEXT PRIMARY KEY,
  kind    TEXT NOT NULL,
  subject TEXT NOT NULL,
  made    INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  used    INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER,
  used_by TEXT NOT NULL DEFAULT '',
  choice  TEXT NOT NULL DEFAULT '',
  -- WHO IS TAKING THE SUNDAY, on an approved cover request and nowhere else.
  --
  -- Chosen on the decision page, checked against the register before it is
  -- written here, and carried to the Rota Requests tab by the drain. Blank is
  -- the ordinary answer and means exactly what it always meant: approved,
  -- and the morning waits for somebody with the rota in front of them.
  -- Added to a live database by the Worker on first use.
  cover   TEXT NOT NULL DEFAULT '',
  synced  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS links_pending ON links(kind, used, synced);

-- ---------------------------------------------------------------------------
-- A CHANGE MADE IN THE COORDINATOR'S APP (w2.18.0)
--
-- One row per change, under the coordinator's PIN: the rota, a request
-- decided, a booking made or cancelled, a defect updated, a run time put
-- right. id is made on the phone, so a retry is the same row. seq keeps them
-- in the order he made them, which is the order the sheet applies them in.
--
-- synced   the drain's stamp rule: below 1 is pending, 1 is dealt with
-- ok       1 applied on the sheet, 0 refused there (result says why), NULL
--          not dealt with yet
-- seen     1 once a push from the sheet has named it, which means the copy
--          the sheet sent includes it and it is no longer laid over that copy
--
-- Created by the Worker on first use, so a live database needs no console step.
CREATE TABLE IF NOT EXISTS coord_actions (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  id      TEXT NOT NULL UNIQUE,
  kind    TEXT NOT NULL,             -- rota | decide | booking | defect | fix | vlog | vfix | job | pin ...
  sunday  TEXT NOT NULL DEFAULT '',
  body    TEXT NOT NULL,             -- the change as checked here, JSON
  by_name TEXT NOT NULL DEFAULT '',  -- the coordinator whose PIN matched
  made    INTEGER NOT NULL,          -- ms, this server's clock
  words   TEXT NOT NULL DEFAULT '',  -- one line for What I have done
  synced  INTEGER NOT NULL DEFAULT 0,
  ok      INTEGER,
  result  TEXT NOT NULL DEFAULT '',
  done_at INTEGER,
  seen    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS coord_sync ON coord_actions(synced);
CREATE INDEX IF NOT EXISTS coord_open ON coord_actions(seen, kind);

-- A DRIVER'S OWN PIN, from w2.39.0, copied from the Ushers app. Only the
-- driver sets it, from the driver app; a coordinator's reset deletes the row,
-- which puts him back on the default PIN in drivers.pin_hash. Never touched
-- by the sync, so it outlives every push of the Drivers tab.
--   name      the driver's name, lower case
--   pin_salt  random, one per driver, hex
--   pin_hash  PBKDF2-SHA-256 of PIN_SALT:pin, hex. Empty when he kept the
--             default rather than set his own
--   kept      1 when he was asked and kept the default PIN, so he is not
--             asked again
-- Created by the Worker on first use, so a live database needs no console step.
CREATE TABLE IF NOT EXISTS driver_pins (
  name     TEXT PRIMARY KEY,
  pin_salt TEXT DEFAULT '',
  pin_hash TEXT DEFAULT '',
  pin_iter INTEGER DEFAULT 0,
  set_at   INTEGER,
  kept     INTEGER DEFAULT 0
);

-- PHOTOS ON A REPORT, from w2.50.0. Taken in the driver app on a Defect
-- (at least one) or an Advisory (up to three), keyed by the check and the
-- item's name as the Defects tab is. Only the coordinator's app shows them,
-- under a PIN. Kept while the defect is open, else 26 weeks.
--   thumb  a small copy for the defect card, data:image/jpeg;base64,...
--   data   the photo itself, about 250 KB, the same form
-- Created by the Worker on first use, so a live database needs no console step.
CREATE TABLE IF NOT EXISTS photos (
  id       TEXT PRIMARY KEY,          -- made on the handset, so a retry is the same row
  check_id TEXT NOT NULL,
  item     TEXT NOT NULL,
  n        INTEGER NOT NULL,          -- 1 to 3, in the order taken
  reg      TEXT NOT NULL DEFAULT '',
  made     INTEGER NOT NULL,          -- ms, when it arrived here
  thumb    TEXT NOT NULL,
  data     TEXT NOT NULL,
  UNIQUE (check_id, item, n)
);
