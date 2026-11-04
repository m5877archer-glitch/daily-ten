// Private numbers for Matt's dashboard at https://10everyday.com/dash.
//
// GET /admin?month=YYYY-MM with header "Authorization: Bearer KEY".
// Only the SHA-256 of the key lives here, so the public repo never holds the
// key itself. Everything this returns is private: player counts, the full
// leaderboard, signups and sales. None of it is ever shown on the site.
//
// Outside sources are optional Worker secrets, set by contest-deploy.yml from
// repo secrets of the same name when they exist:
//   CF_API_TOKEN       Cloudflare Web Analytics (visits, signups, shop taps, misses)
//   KIT_API_KEY        Kit email list (new subscribers)
//   FOURTHWALL_USER /  Fourthwall Open API user (orders). Create one at
//   FOURTHWALL_PASS    Fourthwall > Settings > For developers > Create API user.
// A missing or failing source comes back as {error} and the rest still loads.
// Fourthwall secrets added Nov 3, 2026.

const KEY_SHA256 = "90b02ed671fbb4dfb957c336fa38e17d7bb6dbef2fe525e5a1d7e1774a9ffd2f";
const CF_ACCOUNT = "548962cab0a1c41df6c1579dbe54006f";
const CF_SITE = "259c91d975754d27b31d01b53491c005";
const FIRST_DAY = "2026-11-02";

const H = 3600 * 1000;

async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function authorized(request) {
  const h = request.headers.get("Authorization") || "";
  const key = h.replace(/^Bearer\s+/i, "").trim();
  if (!key || key.length < 16) return false;
  return (await sha256(key)) === KEY_SHA256;
}

function pacificDate(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// UTC instant of Pacific midnight starting a Pacific date.
function pacificMidnight(dateStr) {
  const guess = new Date(dateStr + "T08:00:00Z");
  const back = pacificDate(new Date(guess.getTime() - H));
  return back === dateStr ? new Date(guess.getTime() - H) : guess; // PDT is UTC-7, PST UTC-8
}

async function all(db, sql, ...args) {
  return (await db.prepare(sql).bind(...args).all()).results || [];
}
async function one(db, sql, ...args) {
  return db.prepare(sql).bind(...args).first();
}

// ---------- players, scores, groups (D1) ----------

async function fromD1(db, now, month, weeksOf) {
  const iso = (ms) => new Date(now.getTime() - ms).toISOString();
  const today = pacificDate(now);
  const todayStart = pacificMidnight(today).toISOString();
  const monthStart = pacificMidnight(month + "-01").toISOString();
  const win = { h6: iso(6 * H), h24: iso(24 * H), d7: iso(7 * 24 * H), today: todayStart, month: monthStart };

  // Anyone who finished a quiz: contest scores (first tries, live day) plus
  // every finish logged in plays (replays and back issues too, from Nov 3).
  const ACT = "SELECT player, at, score, date, 1 AS first FROM scores UNION ALL SELECT player, at, score, date, first FROM plays";
  const players = {}, perfect = {}, finishes = {}, newPlayers = {};
  for (const [k, since] of Object.entries(win)) {
    const r = await one(db, `SELECT COUNT(DISTINCT player) AS n, COUNT(*) AS f FROM (${ACT}) WHERE at >= ?1`, since);
    players[k] = r ? r.n : 0;
    // Perfect 10s on a first try (replays don't count, people learn the answers).
    const p = await one(db, "SELECT COUNT(DISTINCT player) AS n FROM scores WHERE score = 10 AND at >= ?1", since);
    perfect[k] = p ? p.n : 0;
    const f = await one(db, "SELECT COUNT(*) AS n FROM scores WHERE at >= ?1", since);
    finishes[k] = f ? f.n : 0;
    const np = await one(db, "SELECT COUNT(*) AS n FROM players WHERE created >= ?1", since);
    newPlayers[k] = np ? np.n : 0;
  }

  // Full monthly board, private: every player, including those who left the
  // contest or are hidden (flagged), no stand-in names.
  const weeks = weeksOf(month);
  const first = weeks.length ? weeks[0].dates[0] : month + "-01";
  const last = weeks.length ? weeks[weeks.length - 1].dates.slice(-1)[0] : month + "-31";
  const rows = await all(db,
    "SELECT p.id, p.name, p.created, p.optout, p.hidden, s.date, s.score FROM scores s JOIN players p ON p.id = s.player " +
    "WHERE s.date >= ?1 AND s.date <= ?2", first, last);
  const weekOf = {};
  weeks.forEach((w, i) => w.dates.forEach((d) => { weekOf[d] = i; }));
  const by = new Map();
  for (const r of rows) {
    let p = by.get(r.id);
    if (!p) { p = { id: r.id, name: r.name, created: r.created, out: !!r.optout, hidden: !!r.hidden, weeks: weeks.map(() => 0), total: 0, tens: 0, days: 0, dates: [] }; by.set(r.id, p); }
    if (weekOf[r.date] == null) continue;
    p.weeks[weekOf[r.date]] += r.score; p.total += r.score; p.days += 1; p.dates.push(r.date);
    if (r.score === 10) p.tens += 1;
  }
  const groupCount = {};
  for (const g of await all(db, "SELECT player, COUNT(*) AS n FROM league_members GROUP BY player")) groupCount[g.player] = g.n;
  const board = [...by.values()].sort((a, b) => b.total - a.total || b.tens - a.tens || (a.created < b.created ? -1 : 1));
  board.forEach((p, i) => {
    const prev = board[i - 1];
    p.rank = prev && prev.total === p.total && prev.tens === p.tens ? prev.rank : i + 1;
    p.groups = groupCount[p.id] || 0;
    p.playedToday = p.dates.includes(today);
    p.avg = p.days ? Math.round((p.total / p.days) * 10) / 10 : 0;
    delete p.dates; delete p.id;
  });

  // Day by day this month (first tries on the live day).
  const daily = await all(db,
    "SELECT date, COUNT(*) AS players, ROUND(AVG(score), 1) AS avg, SUM(CASE WHEN score = 10 THEN 1 ELSE 0 END) AS tens " +
    "FROM scores WHERE date >= ?1 AND date <= ?2 GROUP BY date ORDER BY date", first, last);
  const replays = await all(db,
    "SELECT date, COUNT(*) AS n FROM plays WHERE first = 0 AND at >= ?1 GROUP BY date", monthStart);

  // Groups.
  const groups = await all(db,
    "SELECT l.code, l.name, l.created, p.name AS owner, " +
    "(SELECT COUNT(*) FROM league_members m WHERE m.league = l.code) AS members, " +
    "(SELECT COUNT(DISTINCT s.player) FROM scores s JOIN league_members m ON m.player = s.player AND m.league = l.code WHERE s.date >= ?1 AND s.date <= ?2) AS active " +
    "FROM leagues l LEFT JOIN players p ON p.id = l.owner ORDER BY l.created DESC", first, last);
  const newGroups = {};
  for (const [k, since] of Object.entries(win)) newGroups[k] = groups.filter((g) => g.created >= since).length;
  const inGroup = await one(db,
    "SELECT COUNT(DISTINCT s.player) AS n FROM scores s WHERE s.date >= ?1 AND s.date <= ?2 AND s.player IN (SELECT player FROM league_members)", first, last);

  // Per-question results from first tries that sent answers (Nov 3 on).
  const ans = await all(db,
    "SELECT date, answers FROM plays WHERE first = 1 AND answers IS NOT NULL AND date >= ?1 ORDER BY date", FIRST_DAY);
  const qByDate = {};
  for (const a of ans) {
    const q = qByDate[a.date] || (qByDate[a.date] = { n: 0, right: [] });
    q.n += 1;
    [...a.answers].forEach((c, i) => { q.right[i] = (q.right[i] || 0) + (c === "1" ? 1 : 0); });
  }
  const secs = await all(db,
    "SELECT date, ROUND(AVG(secs)) AS secs FROM plays WHERE first = 1 AND secs > 0 AND secs < 3600 GROUP BY date");

  const totals = await one(db,
    "SELECT (SELECT COUNT(*) FROM players) AS players, (SELECT COUNT(*) FROM players WHERE optout = 1) AS optouts, " +
    "(SELECT COUNT(*) FROM leagues) AS groups, (SELECT COUNT(*) FROM league_members) AS memberships");

  return {
    today, players, perfect, finishes, newPlayers, newGroups, board,
    weeks: weeks.map((w) => w.label), daily, replays, groups, inGroup: inGroup ? inGroup.n : 0,
    questions: qByDate, secs, totals,
  };
}

// ---------- Cloudflare Web Analytics ----------

const PATHS_Q = (alias) => `${alias}: rumPageloadEventsAdaptiveGroups(filter: $${alias}, limit: 5000) { count sum { visits } dimensions { requestPath } }`;

export async function fromCloudflare(token, now) {
  if (!token) return { error: "Cloudflare token not set on the Worker yet" };
  const iso = (d) => d.toISOString().replace(/\.\d+Z$/, "Z");
  const today = pacificDate(now);
  const windows = {
    h6: new Date(now.getTime() - 6 * H), h24: new Date(now.getTime() - 24 * H),
    d7: new Date(now.getTime() - 7 * 24 * H), d30: new Date(now.getTime() - 30 * 24 * H),
    today: pacificMidnight(today),
  };
  const vars = { account: CF_ACCOUNT };
  const parts = [];
  for (const [k, since] of Object.entries(windows)) {
    vars[k] = { AND: [{ datetime_geq: iso(since) }, { datetime_lt: iso(now) }, { siteTag: CF_SITE }, { bot: 0 }] };
    parts.push(PATHS_Q(k));
  }
  // Hourly visits for the last 14 days, bucketed into Pacific days below.
  vars.hours = { AND: [{ datetime_geq: iso(new Date(now.getTime() - 14 * 24 * H)) }, { datetime_lt: iso(now) }, { siteTag: CF_SITE }, { bot: 0 }] };
  parts.push("hours: rumPageloadEventsAdaptiveGroups(filter: $hours, limit: 5000) { count sum { visits } dimensions { datetimeHour requestPath } }");
  const decl = Object.keys(windows).concat("hours").map((k) => `$${k}: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject`).join(", ");
  const query = `query($account: String!, ${decl}) { viewer { accounts(filter: {accountTag: $account}) { ${parts.join(" ")} } } }`;
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: vars }),
  });
  const body = await r.json();
  if (body.errors && body.errors.length) return { error: "Cloudflare: " + JSON.stringify(body.errors).slice(0, 300) };
  const acc = body.data.viewer.accounts[0];

  const summarize = (rows) => {
    const s = { visits: 0, pageviews: 0, done: 0, signups: 0, shopTaps: 0, shopViews: 0, shares: 0, groupInvites: 0, boardOpens: 0,
      entries: { email: 0, share: 0, reddit: 0, facebook: 0, pt: 0 }, signupBy: {}, miss: {}, doneBy: {}, scores: {} };
    const ENTRY = { "/e": "email", "/s": "share", "/r": "reddit", "/f": "facebook", "/pt": "pt" };
    for (const row of rows) {
      const p = row.dimensions.requestPath || "";
      const v = (row.sum && row.sum.visits) || 0;
      s.visits += v; s.pageviews += row.count;
      if (ENTRY[p]) s.entries[ENTRY[p]] += v;
      let m;
      if ((m = p.match(/^\/done-(\d{4})$/))) { s.done += row.count; s.doneBy[m[1]] = (s.doneBy[m[1]] || 0) + row.count; }
      else if ((m = p.match(/^\/miss-(\d{4})-q(\d+)$/))) { const e = s.miss[m[1]] || (s.miss[m[1]] = {}); e[m[2]] = (e[m[2]] || 0) + row.count; }
      else if ((m = p.match(/^\/score-(\d+)$/))) s.scores[m[1]] = (s.scores[m[1]] || 0) + row.count;
      else if (p.startsWith("/signup-") && p !== "/signup-league-page") { s.signups += row.count; s.signupBy[p.slice(8)] = (s.signupBy[p.slice(8)] || 0) + row.count; }
      else if (p === "/shop" || p === "/shop-q" || p === "/merch-click" || p.startsWith("/merch-results-tap")) s.shopTaps += row.count;
      else if (p === "/shop-q-view" || p === "/merch-view" || p.startsWith("/merch-results-view")) s.shopViews += row.count;
      else if (p === "/share-pressed") s.shares += row.count;
      else if (p === "/league-share") s.groupInvites += row.count;
      else if (p === "/contest-board-pop" || p === "/contest-board" || p === "/contest") s.boardOpens += row.count;
    }
    return s;
  };
  const out = {};
  for (const k of Object.keys(windows)) out[k] = summarize(acc[k] || []);
  const days = {};
  for (const row of acc.hours || []) {
    const d = pacificDate(new Date(row.dimensions.datetimeHour));
    const e = days[d] || (days[d] = { visits: 0, done: 0 });
    e.visits += (row.sum && row.sum.visits) || 0;
    if (/^\/done-\d{4}$/.test(row.dimensions.requestPath || "")) e.done += row.count;
  }
  out.days = days;
  // Keep the miss detail only for the 30-day window (that's the one used).
  for (const k of Object.keys(windows)) if (k !== "d30") { delete out[k].miss; delete out[k].doneBy; }
  return out;
}

// ---------- Kit (email list) ----------

export async function fromKit(key, now) {
  if (!key) return { error: "Kit key not set on the Worker yet" };
  const hdr = { "X-Kit-Api-Key": key, Accept: "application/json" };
  const since = new Date(now.getTime() - 30 * 24 * H).toISOString();
  const list = [];
  let cursor = null;
  for (let i = 0; i < 5; i++) {
    const u = "https://api.kit.com/v4/subscribers?per_page=1000&created_after=" + encodeURIComponent(since) + (cursor ? "&after=" + encodeURIComponent(cursor) : "");
    const r = await fetch(u, { headers: hdr });
    if (!r.ok) return { error: "Kit: HTTP " + r.status };
    const b = await r.json();
    for (const s of b.subscribers || []) list.push({ at: s.created_at, state: s.state });
    if (!(b.pagination && b.pagination.has_next_page)) break;
    cursor = b.pagination.end_cursor;
  }
  let total = null;
  try {
    const r = await fetch("https://api.kit.com/v4/subscribers?per_page=1&include_total_count=true", { headers: hdr });
    const b = await r.json();
    total = b.pagination && b.pagination.total_count != null ? b.pagination.total_count : null;
  } catch (e) {}
  const count = (ms) => list.filter((s) => s.at && new Date(s.at).getTime() >= now.getTime() - ms).length;
  const todayStart = pacificMidnight(pacificDate(now)).getTime();
  const days = {};
  for (const s of list) { if (!s.at) continue; const d = pacificDate(new Date(s.at)); days[d] = (days[d] || 0) + 1; }
  return {
    total, h6: count(6 * H), h24: count(24 * H), d7: count(7 * 24 * H), d30: list.length,
    today: list.filter((s) => s.at && new Date(s.at).getTime() >= todayStart).length,
    days,
  };
}

// ---------- Fourthwall (store orders) ----------

function pickList(b) {
  if (Array.isArray(b)) return b;
  for (const k of ["results", "content", "orders", "data", "items"]) if (b && Array.isArray(b[k])) return b[k];
  return [];
}

export async function fromFourthwall(user, pass, now) {
  if (!user || !pass) return { error: "Fourthwall API user not set up yet" };
  const auth = { Authorization: "Basic " + btoa(user + ":" + pass), Accept: "application/json" };
  let orders = null, lastErr = "";
  for (const base of ["https://api.fourthwall.com/open-api/v1.0/order", "https://api.fourthwall.com/open-api/v1.0/orders"]) {
    try {
      const r = await fetch(base + "?page=0&size=100", { headers: auth });
      if (!r.ok) { lastErr = "HTTP " + r.status; continue; }
      orders = pickList(await r.json());
      break;
    } catch (e) { lastErr = String(e).slice(0, 100); }
  }
  if (!orders) return { error: "Fourthwall: " + lastErr };
  const rows = orders.map((o) => {
    const at = o.createdAt || o.created_at || o.createdDate || o.created || null;
    const amt = (o.amounts && o.amounts.total && o.amounts.total.value) ?? (o.total && o.total.value) ?? o.totalPrice ?? 0;
    const status = String(o.status || "").toUpperCase();
    return { at, amount: Number(amt) || 0, status };
  }).filter((o) => o.at && !/CANCEL|REFUND/.test(o.status));
  const win = (ms) => {
    const s = rows.filter((o) => new Date(o.at).getTime() >= now.getTime() - ms);
    return { orders: s.length, revenue: Math.round(s.reduce((a, o) => a + o.amount, 0) * 100) / 100 };
  };
  const last = rows.map((o) => o.at).sort().slice(-1)[0] || null;
  return { h24: win(24 * H), d7: win(7 * 24 * H), d30: win(30 * 24 * H), all: { orders: rows.length, revenue: Math.round(rows.reduce((a, o) => a + o.amount, 0) * 100) / 100 }, lastOrder: last };
}

async function safe(p) {
  try { return await p; } catch (e) { return { error: String(e && e.message || e).slice(0, 200) }; }
}

export async function adminReport(env, now, month, weeksOf) {
  const [d1, cf, kit, shop] = await Promise.all([
    safe(fromD1(env.DB, now, month, weeksOf)),
    safe(fromCloudflare(env.CF_API_TOKEN, now)),
    safe(fromKit(env.KIT_API_KEY, now)),
    safe(fromFourthwall(env.FOURTHWALL_USER, env.FOURTHWALL_PASS, now)),
  ]);
  return { ok: true, at: now.toISOString(), month, contest: d1, web: cf, email: kit, shop };
}
