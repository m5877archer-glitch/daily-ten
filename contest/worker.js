// 10Everyday monthly contest.
//
// Every player is entered automatically under a random name. Their first
// play of each edition counts, on the day that edition is live. The month's
// total wins; ties go to the most perfect 10s. Players can rename themselves
// or leave (and rejoin) at any time.
//
// Deployed by .github/workflows/contest-deploy.yml (token: CF_WORKERS_TOKEN). Storage is a D1 database
// named tenevery-contest (schema in contest/schema.sql).
//
// Endpoints (all JSON):
//   POST /score   {id, name, date, score}   record a first play
//   POST /name    {id, name}                change display name
//   POST /optout  {id, out: true|false}     leave or rejoin
//   GET  /board?month=YYYY-MM&me=ID         standings with weekly columns
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

  const weekOf = {};
  weeks.forEach((w, i) => w.dates.forEach((d) => { weekOf[d] = i; }));
  const by = new Map();
  for (const r of rows) {
    let p = by.get(r.id);
    if (!p) { p = { id: r.id, name: r.name, created: r.created, weeks: weeks.map(() => 0), total: 0, tens: 0, days: 0 }; by.set(r.id, p); }
    p.weeks[weekOf[r.date]] += r.score;
    p.total += r.score;
    p.days += 1;
    if (r.score === 10) p.tens += 1;
  }
  const list = [...by.values()].sort((a, b) =>
    b.total - a.total || b.tens - a.tens || (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));
  // Shared rank for exact ties (same total and same number of 10s).
  list.forEach((p, i) => {
    const prev = list[i - 1];
    p.rank = prev && prev.total === p.total && prev.tens === p.tens ? prev.rank : i + 1;
  });
  out.players = list.slice(0, TOP).map((p) => ({ name: p.name, weeks: p.weeks, total: p.total, tens: p.tens, days: p.days, rank: p.rank, me: p.id === me || undefined }));
  if (validId(me)) {
    const mine = by.get(me);
    const pl = await db.prepare("SELECT name, optout FROM players WHERE id = ?1").bind(me).first();
    if (pl) {
      out.me = { name: pl.name, out: !!pl.optout, rank: mine ? mine.rank : null, total: mine ? mine.total : 0, days: mine ? mine.days : 0, tens: mine ? mine.tens : 0, weeks: mine ? mine.weeks : weeks.map(() => 0) };
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
        if (pl.optout) reason = "out";
        else if (date < FIRST_DAY || !isWeekday(date)) reason = "no-contest";
        // Counts on the day the edition is live: its date in Eastern time
        // (editions publish around 1 AM Eastern) or in Pacific time.
        else if (date !== dateIn("America/New_York", now) && date !== dateIn("America/Los_Angeles", now)) reason = "late";
        else {
          const r = await db.prepare("INSERT OR IGNORE INTO scores (player, date, score, at) VALUES (?1, ?2, ?3, ?4)")
            .bind(b.id, date, score, now.toISOString()).run();
          counted = !!(r.meta && r.meta.changes);
          if (!counted) reason = "already";
        }
        const board = await standings(db, date.slice(0, 7), b.id);
        return json({ ok: true, counted, reason, me: board.me, weeks: board.weeks });
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

      return json({ ok: false, error: "not found" }, 404);
    } catch (e) {
      return json({ ok: false, error: "server error" }, 500);
    }
  },
};
