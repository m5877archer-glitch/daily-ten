// 10Everyday monthly contest, the player side.
//
// Loaded by every edition from Nov 2, 2026 on with
//   <script src="contest.js" defer></script>
// It does nothing on older editions. Everyone who plays is entered under a
// random name; the first play of each edition is sent to the contest Worker
// and the score card shows where the player stands. Players can rename
// themselves or leave the contest from the score card or /contest.
// Leagues: private boards for a group, started from the score card (email
// subscribers only) and joined through a link to /l?c=CODE (see l.html).
// window.tenContest exposes the shared helpers to l.html.
// Any failure here is swallowed: the quiz must never break because of it.
(function () {
  "use strict";
  var API = "https://tenevery-contest.m5877archer.workers.dev";
  var START = "2026-11-02";
  var K = { id: "tenContest.id", name: "tenContest.name", out: "tenContest.out" };

  var ADJ = ["Brave", "Clever", "Curious", "Daring", "Eager", "Fearless", "Gentle", "Golden", "Happy", "Jolly",
    "Keen", "Lucky", "Mellow", "Mighty", "Nimble", "Plucky", "Quick", "Quiet", "Rowdy", "Sharp",
    "Sly", "Snappy", "Steady", "Sunny", "Swift", "Thrifty", "Tidy", "Witty", "Zesty", "Bold",
    "Breezy", "Cosmic", "Dapper", "Fuzzy", "Groovy", "Humble", "Lively", "Merry", "Peppy", "Spry"];
  var ANIMAL = ["Otter", "Heron", "Badger", "Falcon", "Fox", "Gecko", "Hedgehog", "Ibis", "Jackal", "Koala",
    "Lemur", "Marmot", "Narwhal", "Ocelot", "Pelican", "Quail", "Raven", "Seal", "Tapir", "Walrus",
    "Yak", "Zebra", "Bison", "Coyote", "Dolphin", "Egret", "Ferret", "Gopher", "Hawk", "Iguana",
    "Lynx", "Moose", "Newt", "Owl", "Puffin", "Robin", "Sparrow", "Toucan", "Weasel", "Wombat"];

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function track(p) { try { if (typeof trackPath === "function") trackPath(p); } catch (e) {} }

  function playerId() {
    var id = get(K.id);
    if (id && /^[a-f0-9]{24}$/.test(id)) return id;
    var b = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(b);
    id = Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    set(K.id, id);
    return id;
  }
  function playerName() {
    var n = get(K.name);
    if (!n) { n = pick(ADJ) + " " + pick(ANIMAL); set(K.name, n); }
    return n;
  }

  function call(path, data) {
    var opts = data
      ? { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(data) }
      : {};
    if (window.AbortController) {
      var c = new AbortController();
      setTimeout(function () { c.abort(); }, 6000);
      opts.signal = c.signal;
    }
    return fetch(API + path, opts).then(function (r) { return r.json(); });
  }

  var KIT = "https://app.kit.com/forms/9732657/subscriptions";
  function isSubbed() { return !!window.tenSubscribed || get("tenSubbed") === "1"; }
  function markSubbed() { window.tenSubscribed = true; set("tenSubbed", "1"); }
  function kitSubscribe(email) {
    return fetch(KIT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ email_address: email })
    }).then(function (r) { if (!r.ok) throw new Error("kit"); markSubbed(); window.tenEmail = email; });
  }
  function leagueUrl(code) { return "https://10everyday.com/l?c=" + encodeURIComponent(code); }
  function shareLeague(code, name, flashEl) {
    var url = leagueUrl(code);
    var text = "Join my 10Everyday league, \u201C" + name + "\u201D. Ten questions on the news every weekday. Let's see who knows the most.";
    track("/league-share");
    var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    if (mobile && navigator.share) {
      navigator.share({ title: name, text: text, url: url }).catch(function () {});
      return;
    }
    var done = function () { if (flashEl) flashEl.textContent = "Link copied. Paste it in your group chat."; };
    try {
      navigator.clipboard.writeText(text + " " + url).then(done, function () { window.prompt("Copy this link:", url); });
    } catch (e) { window.prompt("Copy this link:", url); }
  }
  function pts(n) { return n + (n === 1 ? " point" : " points"); }
  function leagueText(l) {
    if (l.alone) return "just you so far. Send the link.";
    if (!l.rank) return "you're in.";
    if (l.rank === 1) {
      if (l.tiedWith) return "tied for 1st with " + l.tiedWith + ".";
      return l.ahead > 0 ? "you're 1st, " + pts(l.ahead) + " ahead of " + l.nextName + "." : "you're 1st on the tiebreaker over " + l.nextName + ".";
    }
    return l.behind > 0 ? "you're " + ord(l.rank) + ", " + pts(l.behind) + " behind " + l.leaderName + "." : "you're " + ord(l.rank) + ", level on points with " + l.leaderName + ".";
  }

  function monthName(d) {
    return new Date(d + "T12:00:00Z").toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  }
  function ord(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // ---------- score card box ----------
  function css() {
    if (document.getElementById("contestCss")) return;
    var st = document.createElement("style");
    st.id = "contestCss";
    st.textContent =
      ".contest{margin:18px auto 6px;max-width:400px;border:1px solid var(--ptdark,#1e3a1e);background:#fffdf6;padding:14px 14px 12px;}" +
      ".contest .ck{font-size:.68rem;letter-spacing:.22em;text-transform:uppercase;color:#6b6455;}" +
      ".contest .cl{font-size:1.15rem;font-weight:bold;margin:6px 0 2px;color:var(--ink,#1c2733);}" +
      ".contest .cs{font-size:.92rem;color:#3d3a33;}" +
      ".contest .cn{font-size:.85rem;color:#6b6455;margin-top:8px;}" +
      ".contest a,.contest button.clink{color:var(--ptdark,#1e3a1e);font:inherit;font-size:.85rem;background:none;border:0;padding:0;text-decoration:underline;cursor:pointer;}" +
      ".contest .cbar{margin-top:8px;font-size:.85rem;}" +
      ".contest form{display:flex;gap:6px;justify-content:center;margin-top:8px;}" +
      ".contest input{font:inherit;font-size:.95rem;padding:6px 8px;border:1px solid #b8b09c;width:60%;}" +
      ".contest form button{font:inherit;font-size:.9rem;padding:6px 12px;background:var(--ptdark,#1e3a1e);color:#fff;border:0;cursor:pointer;}" +
      ".contest .cerr{color:#a33;font-size:.82rem;margin-top:4px;}" +
      ".contest .lg{margin-top:12px;padding-top:10px;border-top:1px dashed #cfc7b2;}" +
      ".contest .lrow{font-size:.9rem;margin:4px 0;}" +
      ".contest .lrow a{font-size:.9rem;font-weight:bold;}" +
      ".contest .lform{flex-direction:column;align-items:center;}" +
      ".contest .lform input{width:85%;}" +
      ".contest .lnote{font-size:.78rem;color:#6b6455;margin-top:4px;}" +
      ".contest .lready{font-size:.9rem;margin-top:8px;}" +
      ".contest .lshare{margin-top:8px;font:inherit;font-size:.95rem;padding:8px 16px;background:var(--ptmid,#4a7c4a);color:#fff;border:0;cursor:pointer;}";
    document.head.appendChild(st);
  }

  function box() {
    var el = document.getElementById("contestBox");
    if (el) return el;
    css();
    el = document.createElement("div");
    el.className = "contest";
    el.id = "contestBox";
    var anchor = document.getElementById("shareBtn");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor.nextSibling);
    else (document.getElementById("results") || document.body).appendChild(el);
    return el;
  }

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function render(state) {
    var el = box();
    el.innerHTML = "";
    var month = monthName(EDITION_DATE);
    el.appendChild(node("div", "ck", "The " + month + " contest"));

    if (state.out) {
      el.appendChild(node("div", "cs", "You're sitting out this month's contest."));
      var bar0 = node("div", "cbar");
      var back = node("button", "clink", "Count me back in");
      back.onclick = function () {
        set(K.out, "0");
        track("/contest-rejoin");
        call("/optout", { id: playerId(), name: playerName(), out: false })
          .then(function () { start(state.first); })
          .catch(function () {});
      };
      bar0.appendChild(back);
      el.appendChild(bar0);
      leaguesBlock(el, state);
      return;
    }

    var me = state.me || {};
    var headline;
    if (state.reason === "late") headline = "Contest scores count on the day of the edition.";
    else if (me.rank) headline = "You're " + ord(me.rank) + " this month, with " + me.total + " points.";
    else if (me.outside) headline = "You're outside the top 10 for now, with " + me.total + " points.";
    else headline = "You're in. Every weekday counts.";
    el.appendChild(node("div", "cl", headline));

    var sub;
    if (state.counted) sub = "Today's " + state.score + " is on the board.";
    else if (state.reason === "already") sub = "Only your first play of the day counts.";
    else if (state.reason === "late") sub = "Today's edition is the one that counts. See you tomorrow.";
    else sub = "";
    if (me.days) sub += (sub ? " " : "") + me.days + (me.days === 1 ? " day" : " days") + " played this month.";
    if (sub) el.appendChild(node("div", "cs", sub));

    var nm = node("div", "cn");
    nm.appendChild(document.createTextNode("Playing as " + (me.name || playerName()) + ". "));
    var ch = node("button", "clink", "Change name");
    ch.onclick = function () { renameForm(el, state); };
    nm.appendChild(ch);
    el.appendChild(nm);

    var bar = node("div", "cbar");
    var lb = node("a", null, "See the leaderboard");
    lb.href = "/contest";
    lb.onclick = function () { track("/contest-board"); };
    bar.appendChild(lb);
    bar.appendChild(document.createTextNode(" · "));
    var lv = node("button", "clink", "Leave the contest");
    lv.onclick = function () {
      set(K.out, "1");
      track("/contest-out");
      call("/optout", { id: playerId(), name: playerName(), out: true }).catch(function () {});
      render({ out: true, first: state.first, leagues: state.leagues });
    };
    bar.appendChild(lv);
    el.appendChild(bar);
    leaguesBlock(el, state);
  }

  function leaguesBlock(el, state) {
    var wrap = node("div", "lg");
    var leagues = state.leagues || [];
    if (leagues.length) {
      leagues.forEach(function (l) {
        var row = node("div", "lrow");
        var a = node("a", null, l.name);
        a.href = "/l?c=" + encodeURIComponent(l.code);
        row.appendChild(a);
        row.appendChild(document.createTextNode(": " + leagueText(l)));
        wrap.appendChild(row);
      });
    }
    var start = node("button", "clink", leagues.length ? "Start another league" : "Start a league with friends");
    start.onclick = function () { startForm(wrap, start, state); };
    var bar = node("div", "cbar");
    bar.appendChild(start);
    wrap.appendChild(bar);
    el.appendChild(wrap);
  }

  function startForm(wrap, startBtn, state) {
    if (wrap.querySelector("form")) return;
    startBtn.style.display = "none";
    var needEmail = !isSubbed();
    var f = node("form", "lform");
    var nm = node("input");
    nm.maxLength = 30; nm.placeholder = "League name, like Archer Family";
    nm.setAttribute("aria-label", "League name");
    f.appendChild(nm);
    var em = null;
    if (needEmail) {
      em = node("input"); em.type = "email"; em.required = true; em.placeholder = "you@example.com";
      em.setAttribute("aria-label", "Email address");
      f.appendChild(em);
    }
    var b = node("button", null, "Start the league"); b.type = "submit";
    f.appendChild(b);
    wrap.appendChild(f);
    var note = node("div", "lnote", needEmail
      ? "Leagues come with the free daily quiz email. Unsubscribe anytime."
      : "You'll get a link to send your group.");
    wrap.appendChild(note);
    var err = node("div", "cerr");
    wrap.appendChild(err);
    nm.focus();
    f.onsubmit = function (e) {
      e.preventDefault();
      var name = nm.value.replace(/\s+/g, " ").trim();
      if (name.length < 2) { err.textContent = "Give your league a name."; return; }
      b.disabled = true; b.textContent = "Starting...";
      var first = needEmail
        ? kitSubscribe(em.value.trim()).then(function () { track("/signup-league"); })
        : Promise.resolve();
      first.then(function () {
        return call("/league/create", { id: playerId(), name: name, player: playerName() });
      }).then(function (r) {
        if (!r || !r.ok) { err.textContent = (r && r.error) || "That didn't work. Try again."; b.disabled = false; b.textContent = "Start the league"; return; }
        track("/league-start");
        f.remove(); note.remove(); err.textContent = "";
        var ready = node("div", "lready", "\u201C" + r.name + "\u201D is ready. Send the link to your group.");
        var sh = node("button", "lshare", "Send the invite");
        var flash = node("div", "lnote");
        sh.onclick = function () { shareLeague(r.code, r.name, flash); };
        wrap.appendChild(ready); wrap.appendChild(sh); wrap.appendChild(flash);
        state.leagues = (state.leagues || []).concat([{ code: r.code, name: r.name, alone: true }]);
      }).catch(function () {
        err.textContent = needEmail ? "Couldn't sign you up just now. Check the email and try again." : "Couldn't reach the scoreboard. Try again in a minute.";
        b.disabled = false; b.textContent = "Start the league";
      });
    };
  }

  function renameForm(el, state) {
    if (el.querySelector("form")) return;
    var f = node("form");
    var inp = node("input");
    inp.maxLength = 20;
    inp.value = playerName();
    inp.setAttribute("aria-label", "Leaderboard name");
    var b = node("button", null, "Save");
    b.type = "submit";
    f.appendChild(inp); f.appendChild(b);
    var err = node("div", "cerr");
    f.onsubmit = function (e) {
      e.preventDefault();
      var v = inp.value.replace(/\s+/g, " ").trim();
      call("/name", { id: playerId(), name: v }).then(function (r) {
        if (r && r.ok) {
          set(K.name, r.name);
          track("/contest-rename");
          if (state.me) state.me.name = r.name;
          render(state);
        } else {
          err.textContent = (r && r.error) || "That name didn't work. Try another.";
        }
      }).catch(function () { err.textContent = "Couldn't save just now. Try again in a minute."; });
    };
    el.appendChild(f);
    el.appendChild(err);
    inp.focus();
  }

  function start(first) {
    var id = playerId(), name = playerName();
    var month = EDITION_DATE.slice(0, 7);
    // Scores are recorded even for players who left the contest, so their
    // leagues still count them; the public board leaves them off.
    var p = first
      ? call("/score", { id: id, name: name, date: EDITION_DATE, score: score })
      : Promise.all([
          call("/board?month=" + month + "&me=" + id),
          call("/leagues?month=" + month + "&me=" + id)
        ]).then(function (rs) {
          return { ok: true, counted: false, reason: "already", me: rs[0].me, leagues: rs[1].leagues };
        });
    p.then(function (r) {
      if (!r || !r.ok) return;
      if (r.me && r.me.name) set(K.name, r.me.name);
      if (r.counted) track("/contest-in");
      var out = get(K.out) === "1" || (r.me && r.me.out);
      if (out) { set(K.out, "1"); render({ out: true, first: first, leagues: r.leagues }); return; }
      render({ counted: r.counted, reason: r.reason, me: r.me, score: score, first: first, leagues: r.leagues });
    }).catch(function () {});
  }

  // The edition's trackPath pushes a fake path and restores the "real" URL
  // 120 ms later. When two fire close together, the second one treats the
  // first's fake path as real and leaves it in the address bar, so Play
  // Again reloads a page that does not exist (e.g. /score-9). This version
  // queues them and always restores the true URL.
  try {
    if (typeof window.trackPath === "function") {
      var queue = [], busy = false, real = null;
      var next = function () {
        var p = queue.shift();
        if (!p) { busy = false; real = null; return; }
        try { history.pushState(null, "", p); } catch (e) {}
        setTimeout(function () {
          try { history.replaceState(null, "", real); } catch (e) {}
          setTimeout(next, 40);
        }, 120);
      };
      window.trackPath = function (path) {
        try {
          queue.push(path);
          if (busy) return;
          busy = true;
          real = location.pathname + location.search + location.hash;
          next();
        } catch (e) {}
      };
    }
  } catch (e) {}

  window.tenContest = {
    api: API, playerId: playerId, playerName: playerName, call: call, setName: function (n) { set(K.name, n); },
    isSubbed: isSubbed, kitSubscribe: kitSubscribe, shareLeague: shareLeague, leagueText: leagueText, ord: ord, track: track
  };

  try {
    if (typeof EDITION_DATE === "undefined" || EDITION_DATE < START) return;
    if (typeof window.showResults !== "function") return;
    var orig = window.showResults;
    window.showResults = function () {
      var first = false;
      try { first = !localStorage.getItem("tenEveryday.done." + EDITION_DATE); } catch (e) {}
      var out = orig.apply(this, arguments);
      try { start(first); } catch (e) {}
      return out;
    };
  } catch (e) {}
})();
