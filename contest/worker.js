// 10Everyday monthly contest.
//
// Every player is entered automatically under a random name. Their first
// play of each edition counts, on the day that edition is live. The month's
// total wins; ties go to the most perfect 10s. Players can rename themselves
// or leave (and rejoin) at any time.
//
// Deployed by .github/workflows/contest-deploy.yml (token secret: CF_WORKERS_TOKEN). Storage is a D1 database
// named tenevery-contest (schema in contest/schema.sql).
//
// Endpoints (all JSON):
//   POST /score   {id, name, date, score}   record a first play
//   POST /name    {id, name}                change display name
//   POST /optout  {id, out: true|false}     leave or rejoin
//   GET  /board?month=YYYY-MM&me=ID         standings with weekly columns
//   POST /league/create {id, name}          start a league (site gates this to subscribers)
//   POST /league/join   {id, code, name}    join by invite code
//   POST /league/leave  {id, code}
//   GET  /league?code=CODE&month=YYYY-MM&me=ID   one league's standings
//   GET  /leagues?me=ID&month=YYYY-MM       my leagues and where I stand in each
//
// Players who leave the contest still have scores recorded (for their
// leagues); they are just left off the public board.
//
// Moderation: to hide a player from the board, run in the D1 console
//   UPDATE players SET hidden = 1 WHERE name = 'Their Name';

const FIRST_DAY = "2026-11-02";   // contest starts with the Nov 2 edition
const TOP = 10;                    // rows shown on the public board

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  });
}

// Calendar date (YYYY-MM-DD) in a time zone.
function dateIn(tz, now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function isWeekday(d) {
  const wd = new Date(d + "T12:00:00Z").getUTCDay();
  return wd >= 1 && wd <= 5;
}

// Weekdays of a month, grouped into Monday to Friday weeks.
function weeksOf(month) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weeks = [];
  let cur = null;
  for (let day = 1; day <= days; day++) {
    const d = new Date(Date.UTC(y, m - 1, day));
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) { cur = null; continue; }
    const iso = d.toISOString().slice(0, 10);
    if (iso < FIRST_DAY) continue;
    if (!cur) { cur = { dates: [] }; weeks.push(cur); }
    cur.dates.push(iso);
  }
  const mon = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  weeks.forEach((w) => {
    const a = +w.dates[0].slice(8), b = +w.dates[w.dates.length - 1].slice(8);
    w.label = a === b ? `${mon} ${a}` : `${mon} ${a}-${b}`;
  });
  return weeks;
}

const BLOCK = ["fuck", "shit", "cunt", "nigg", "fag", "bitch", "whore", "slut", "rape", "nazi", "hitler", "kike", "spic", "chink", "retard", "penis", "vagina", "dick", "cock", "pussy", "porn"];

function cleanName(raw) {
  if (typeof raw !== "string") return null;
  const n = raw.replace(/\s+/g, " ").trim();
  if (n.length < 2 || n.length > 20) return null;
  if (!/^[A-Za-z0-9 .'_-]+$/.test(n)) return null;
  const flat = n.toLowerCase().replace(/[^a-z]/g, "");
  if (BLOCK.some((w) => flat.includes(w))) return null;
  return n;
}

function validId(id) {
  return typeof id === "string" && /^[a-f0-9]{24}$/.test(id);
}

async function body(request) {
  try { return JSON.parse(await request.text()); } catch (e) { return null; }
}

function rankList(by) {
  const list = [...by.values()].sort((a, b) =>
    b.total - a.total || b.tens - a.tens || (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));
  list.forEach((p, i) => {
    const prev = list[i - 1];
    p.rank = prev && prev.total === p.total && prev.tens === p.tens ? prev.rank : i + 1;
  });
  return list;
}

function tally(rows, weeks) {
  const weekOf = {};
  weeks.forEach((w, i) => w.dates.forEach((d) => { weekOf[d] = i; }));
  const by = new Map();
  for (const r of rows) {
    let p = by.get(r.id);
    if (!p) { p = { id: r.id, name: r.name, created: r.created, weeks: weeks.map(() => 0), total: 0, tens: 0, days: 0 }; by.set(r.id, p); }
    if (r.date == null || weekOf[r.date] == null) continue;
    p.weeks[weekOf[r.date]] += r.score;
    p.total += r.score;
    p.days += 1;
    if (r.score === 10) p.tens += 1;
  }
  return by;
}

function monthRange(month) {
  const weeks = weeksOf(month);
  if (!weeks.length) return { weeks, first: month + "-01", last: month + "-01" };
  return { weeks, first: weeks[0].dates[0], last: weeks[weeks.length - 1].dates.slice(-1)[0] };
}

function prevMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

async function leagueTally(db, code, month) {
  const { weeks, first, last } = monthRange(month);
  const rows = (await db.prepare(
    "SELECT p.id, p.name, m.joined AS created, s.date, s.score FROM league_members m " +
    "JOIN players p ON p.id = m.player " +
    "LEFT JOIN scores s ON s.player = m.player AND s.date >= ?2 AND s.date <= ?3 " +
    "WHERE m.league = ?1 AND p.hidden = 0"
  ).bind(code, first, last).all()).results || [];
  return { weeks, list: rankList(tally(rows, weeks)) };
}

// One line of league news for the score card.
function leagueLine(list, me) {
  const mine = list.find((p) => p.id === me);
  if (!mine) return null;
  if (list.length === 1) return { rank: 1, alone: true, total: mine.total };
  const leader = list[0];
  const tiedTop = list.filter((p) => p.rank === 1);
  const out = { rank: mine.rank, total: mine.total, size: list.length };
  if (mine.rank === 1) {
    if (tiedTop.length > 1) out.tiedWith = tiedTop.filter((p) => p.id !== me)[0].name;
    else { const second = list[1]; out.ahead = mine.total - second.total; out.nextName = second.name; }
  } else {
    out.behind = leader.total - mine.total;
    out.leaderName = leader.name;
  }
  return out;
}

async function myLeagues(db, me, month) {
  const ls = (await db.prepare(
    "SELECT l.code, l.name FROM league_members m JOIN leagues l ON l.code = m.league WHERE m.player = ?1 ORDER BY m.joined"
  ).bind(me).all()).results || [];
  const out = [];
  for (const l of ls) {
    const { list } = await leagueTally(db, l.code, month);
    out.push({ code: l.code, name: l.name, ...(leagueLine(list, me) || {}) });
  }
  return out;
}

function cleanLeagueName(raw) {
  if (typeof raw !== "string") return null;
  const n = raw.replace(/\s+/g, " ").trim();
  if (n.length < 2 || n.length > 30) return null;
  if (!/^[A-Za-z0-9 .'&_-]+$/.test(n)) return null;
  const flat = n.toLowerCase().replace(/[^a-z]/g, "");
  if (BLOCK.some((w) => flat.includes(w))) return null;
  return n;
}

async function standings(db, month, me) {
  const weeks = weeksOf(month);
  // No player count is ever returned: only the top rows and your own rank.
  const out = { month, weeks: weeks.map((w) => ({ label: w.label, dates: w.dates })), players: [], me: null };
  if (!weeks.length) return out;
  const first = weeks[0].dates[0];
  const last = weeks[weeks.length - 1].dates.slice(-1)[0];
  const rows = (await db.prepare(
    "SELECT p.id, p.name, p.created, s.date, s.score FROM scores s JOIN players p ON p.id = s.player " +
    "WHERE s.date >= ?1 AND s.date <= ?2 AND p.optout = 0 AND p.hidden = 0"
  ).bind(first, last).all()).results || [];

  const by = tally(rows, weeks);
  const list = rankList(by);
  out.players = list.slice(0, TOP).map((p) => ({ name: p.name, weeks: p.weeks, total: p.total, tens: p.tens, days: p.days, rank: p.rank, me: p.id === me || undefined }));
  if (validId(me)) {
    const mine = by.get(me);
    const pl = await db.prepare("SELECT name, optout FROM players WHERE id = ?1").bind(me).first();
    if (pl) {
      // Ranks past the top 10 are never sent: they would hint at how many play.
      const inTop = !!(mine && mine.rank <= TOP);
      out.me = { name: pl.name, out: !!pl.optout, rank: inTop ? mine.rank : null, outside: !!(mine && !inTop), total: mine ? mine.total : 0, days: mine ? mine.days : 0, tens: mine ? mine.tens : 0, weeks: mine ? mine.weeks : weeks.map(() => 0) };
    }
  }
  return out;
}

async function ensurePlayer(db, id, name) {
  const now = new Date().toISOString();
  await db.prepare("INSERT OR IGNORE INTO players (id, name, optout, hidden, created) VALUES (?1, ?2, 0, 0, ?3)")
    .bind(id, name, now).run();
  return db.prepare("SELECT name, optout FROM players WHERE id = ?1").bind(id).first();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const db = env.DB;
    const now = env.TEST_NOW ? new Date(env.TEST_NOW) : new Date();

    try {
      if (url.pathname === "/board" && request.method === "GET") {
        const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "")
          ? url.searchParams.get("month")
          : dateIn("America/Los_Angeles", now).slice(0, 7);
        return json(await standings(db, month, url.searchParams.get("me")));
      }

      const monthParam = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "")
        ? url.searchParams.get("month")
        : dateIn("America/Los_Angeles", now).slice(0, 7);

      if (url.pathname === "/league" && request.method === "GET") {
        const code = url.searchParams.get("code") || "";
        const lg = await db.prepare("SELECT code, name FROM leagues WHERE code = ?1").bind(code).first();
        if (!lg) return json({ ok: false, error: "That league link doesn't work." }, 404);
        const me = url.searchParams.get("me");
        const { weeks, list } = await leagueTally(db, code, monthParam);
        const prev = await leagueTally(db, code, prevMonth(monthParam));
        const champs = prev.list.filter((p) => p.rank === 1 && p.total > 0).map((p) => p.name);
        return json({
          ok: true, code: lg.code, name: lg.name, month: monthParam,
          weeks: weeks.map((w) => ({ label: w.label, dates: w.dates })),
          players: list.map((p) => ({ name: p.name, weeks: p.weeks, total: p.total, tens: p.tens, days: p.days, rank: p.rank, me: p.id === me || undefined })),
          member: list.some((p) => p.id === me),
          lastChampions: champs,
        });
      }

      if (url.pathname === "/leagues" && request.method === "GET") {
        const me = url.searchParams.get("me");
        if (!validId(me)) return json({ ok: true, leagues: [] });
        return json({ ok: true, leagues: await myLeagues(db, me, monthParam) });
      }

      if (request.method !== "POST") return json({ ok: false, error: "not found" }, 404);
      const b = await body(request);
      if (!b || !validId(b.id)) return json({ ok: false, error: "bad id" }, 400);

      if (url.pathname === "/score") {
        const name = cleanName(b.name) || "Mystery Reader";
        const date = String(b.date || "");
        const score = b.score;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(score) || score < 0 || score > 10) {
          return json({ ok: false, error: "bad score" }, 400);
        }
        const pl = await ensurePlayer(db, b.id, name);
        let counted = false, reason = null;
        if (date < FIRST_DAY || !isWeekday(date)) reason = "no-contest";
        // Counts on the day the edition is live: its date in Eastern time
        // (editions publish around 1 AM Eastern) or in Pacific time.
        else if (date !== dateIn("America/New_York", now) && date !== dateIn("America/Los_Angeles", now)) reason = "late";
        else {
          const r = await db.prepare("INSERT OR IGNORE INTO scores (player, date, score, at) VALUES (?1, ?2, ?3, ?4)")
            .bind(b.id, date, score, now.toISOString()).run();
          counted = !!(r.meta && r.meta.changes);
          if (!counted) reason = "already";
          else if (pl.optout) reason = "out";
        }
        const board = await standings(db, date.slice(0, 7), b.id);
        const leagues = await myLeagues(db, b.id, date.slice(0, 7));
        return json({ ok: true, counted, reason, me: board.me, weeks: board.weeks, leagues });
      }

      if (url.pathname === "/name") {
        const name = cleanName(b.name);
        if (!name) return json({ ok: false, error: "Names need 2 to 20 letters or numbers, and nothing rude." }, 400);
        await ensurePlayer(db, b.id, name);
        await db.prepare("UPDATE players SET name = ?2 WHERE id = ?1").bind(b.id, name).run();
        return json({ ok: true, name });
      }

      if (url.pathname === "/optout") {
        const pl = await ensurePlayer(db, b.id, cleanName(b.name) || "Mystery Reader");
        await db.prepare("UPDATE players SET optout = ?2 WHERE id = ?1").bind(b.id, b.out ? 1 : 0).run();
        return json({ ok: true, out: !!b.out, name: pl.name });
      }

      if (url.pathname === "/league/create") {
        const lname = cleanLeagueName(b.name);
        if (!lname) return json({ ok: false, error: "League names need 2 to 30 letters or numbers, and nothing rude." }, 400);
        await ensurePlayer(db, b.id, cleanName(b.player) || "Mystery Reader");
        const owned = await db.prepare("SELECT COUNT(*) AS n FROM leagues WHERE owner = ?1").bind(b.id).first();
        if (owned && owned.n >= 5) return json({ ok: false, error: "You can start up to 5 leagues." }, 400);
        const slug = lname.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "league";
        let code = null;
        for (let i = 0; i < 5 && !code; i++) {
          const c = slug + "-" + Math.random().toString(36).slice(2, 5);
          const r = await db.prepare("INSERT OR IGNORE INTO leagues (code, name, owner, created) VALUES (?1, ?2, ?3, ?4)")
            .bind(c, lname, b.id, now.toISOString()).run();
          if (r.meta && r.meta.changes) code = c;
        }
        if (!code) return json({ ok: false, error: "Couldn't start that league. Try again." }, 500);
        await db.prepare("INSERT OR IGNORE INTO league_members (league, player, joined) VALUES (?1, ?2, ?3)")
          .bind(code, b.id, now.toISOString()).run();
        return json({ ok: true, code, name: lname });
      }

      if (url.pathname === "/league/join") {
        const lg = await db.prepare("SELECT code, name FROM leagues WHERE code = ?1").bind(String(b.code || "")).first();
        if (!lg) return json({ ok: false, error: "That league link doesn't work." }, 404);
        await ensurePlayer(db, b.id, cleanName(b.name) || "Mystery Reader");
        const mine = await db.prepare("SELECT COUNT(*) AS n FROM league_members WHERE player = ?1").bind(b.id).first();
        if (mine && mine.n >= 10) return json({ ok: false, error: "You're already in 10 leagues. Leave one to join this." }, 400);
        await db.prepare("INSERT OR IGNORE INTO league_members (league, player, joined) VALUES (?1, ?2, ?3)")
          .bind(lg.code, b.id, now.toISOString()).run();
        return json({ ok: true, code: lg.code, name: lg.name });
      }

      if (url.pathname === "/league/leave") {
        await db.prepare("DELETE FROM league_members WHERE league = ?1 AND player = ?2").bind(String(b.code || ""), b.id).run();
        return json({ ok: true });
      }

      return json({ ok: false, error: "not found" }, 404);
    } catch (e) {
      return json({ ok: false, error: "server error" }, 500);
    }
  },
};
