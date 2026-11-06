CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  optout INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scores (
  player TEXT NOT NULL,
  date TEXT NOT NULL,
  score INTEGER NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (player, date)
);

CREATE INDEX IF NOT EXISTS scores_date ON scores (date);

CREATE TABLE IF NOT EXISTS leagues (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  created TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS league_members (
  league TEXT NOT NULL,
  player TEXT NOT NULL,
  joined TEXT NOT NULL,
  PRIMARY KEY (league, player)
);

CREATE INDEX IF NOT EXISTS league_members_player ON league_members (player);

-- Every finished quiz (Nov 3, 2026), for the private dashboard at /dash:
-- first tries and replays alike. answers is one character per question in
-- QUESTIONS order, "1" right and "0" wrong, so per-question difficulty can be
-- read from first tries. Contest scoring still uses the scores table only.
CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player TEXT NOT NULL,
  date TEXT NOT NULL,
  score INTEGER NOT NULL,
  answers TEXT,
  secs INTEGER,
  first INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS plays_at ON plays (at);
CREATE INDEX IF NOT EXISTS plays_date ON plays (date);

-- Per-question seconds for each finish, in QUESTIONS order, plus whether the
-- player was already subscribed (Nov 6, 2026).
CREATE TABLE IF NOT EXISTS qtimes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player TEXT NOT NULL,
  date TEXT NOT NULL,
  first INTEGER NOT NULL DEFAULT 0,
  qsecs TEXT,
  subbed INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS qtimes_date ON qtimes (date);

-- Exact event log (Nov 6, 2026): seen_/submit_/tap_ events for signup boxes
-- and shop links. Never shown on the site.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player TEXT NOT NULL,
  date TEXT NOT NULL,
  ev TEXT NOT NULL,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS events_at ON events (at);
