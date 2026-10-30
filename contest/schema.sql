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
