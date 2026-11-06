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

  function isRandomName(n) {
    var p = String(n || "").split(" ");
    return p.length === 2 && ADJ.indexOf(p[0]) >= 0 && ANIMAL.indexOf(p[1]) >= 0;
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
    var text = "I'm doing a daily news quiz. Join my group, \u201C" + name + ",\u201D and let's see who gets the most right. Tap here:";
    track("/league-share");
    var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    if (mobile && navigator.share) {
      navigator.share({ title: name, text: text, url: url }).catch(function () {});
      return;
    }
    var done = function () { if (flashEl) flashEl.textContent = "Copied. Now paste it into a text or email."; };
    try {
      navigator.clipboard.writeText(text + " " + url).then(done, function () { window.prompt("Copy this link:", url); });
    } catch (e) { window.prompt("Copy this link:", url); }
  }
  function pts(n) { return n + (n === 1 ? " point" : " points"); }
  function leagueText(l) {
    if (l.alone) return "just you so far. Text the link to your family.";
    if (!l.rank) return "you're in.";
    if (l.rank === 1) {
      if (l.tiedWith) return "you're tied for 1st with " + l.tiedWith + ".";
      return l.ahead > 0 ? "you're in 1st place, " + pts(l.ahead) + " ahead of " + l.nextName + "." : "you're in 1st place.";
    }
    return l.behind > 0 ? "you're in " + ord(l.rank) + " place, " + pts(l.behind) + " behind " + l.leaderName + "." : "you're tied with " + l.leaderName + ".";
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
      ".contest .ck{font-size:.85rem;letter-spacing:.12em;text-transform:uppercase;color:#3d3a33;font-weight:bold;}" +
      ".contest .cl{font-size:1.35rem;font-weight:bold;margin:8px 0 4px;color:var(--ink,#1c2733);}" +
      ".contest .cs{font-size:1.1rem;color:#1c2733;}" +
      ".contest .cn{font-size:1.05rem;color:#1c2733;margin-top:12px;}" +
      ".contest a,.contest button.clink{color:var(--ptdark,#1e3a1e);font:inherit;font-size:1.05rem;background:none;border:0;padding:4px 0;text-decoration:underline;cursor:pointer;}" +
      ".contest .cbar{margin-top:10px;font-size:1.05rem;}" +
      ".contest form{display:flex;flex-direction:column;align-items:stretch;gap:8px;margin-top:10px;text-align:left;}" +
      ".contest label{font-size:1.1rem;font-weight:bold;color:#1c2733;margin-top:6px;}" +
      ".contest input{font:inherit;font-size:1.15rem;padding:12px;border:2px solid #8f8670;width:100%;box-sizing:border-box;background:#fff;}" +
      ".contest form button{font:inherit;font-size:1.25rem;font-weight:bold;padding:16px 12px;margin-top:8px;background:var(--ptdark,#1e3a1e);color:#fff;border:0;cursor:pointer;}" +
      ".contest .cerr{color:#a33;font-size:1.05rem;font-weight:bold;margin-top:8px;}" +
      ".contest .lg{margin-top:12px;padding-top:10px;border-top:1px dashed #cfc7b2;}" +
      ".contest .lrow{font-size:1.1rem;margin:6px 0;color:#1c2733;}" +
      ".contest .lrow a{font-size:1.1rem;font-weight:bold;}" +
      ".contest .lnote{font-size:1rem;color:#3d3a33;margin-top:8px;}" +
      ".contest .lready{font-size:1.25rem;font-weight:bold;margin-top:12px;color:#1c2733;}" +
      ".contest button.lbig{display:block;width:100%;margin:14px 0 4px;font:inherit;font-size:1.45rem;font-weight:bold;line-height:1.2;padding:20px 12px;background:var(--ptmid,#4a7c4a);color:#fff;border:3px solid var(--ptdark,#1e3a1e);box-shadow:0 4px 0 var(--ptdark,#1e3a1e);cursor:pointer;text-decoration:none;}" +
      ".contest button.lbig:active{transform:translateY(3px);box-shadow:0 1px 0 var(--ptdark,#1e3a1e);}" +
      ".contest .lg.lhero{margin:12px 0 14px;padding:0;border-top:0;}" +
      ".contest button.lbig.lhot{margin:4px 0 6px;padding:22px 12px 20px;background:#e8641c;border:3px solid #7a2e06;box-shadow:0 5px 0 #7a2e06;color:#fff;animation:lpulse 2.2s ease-in-out infinite;}" +
      ".contest button.lbig.lhot:active{transform:translateY(4px);box-shadow:0 1px 0 #7a2e06;}" +
      ".contest button.lbig.lhot .l1{display:block;font-size:1.85rem;line-height:1.1;}" +
      ".contest button.lbig.lhot .l2{display:block;font-size:1.25rem;font-weight:bold;margin-top:6px;}" +
      "@keyframes lpulse{0%,100%{transform:scale(1);}50%{transform:scale(1.035);}}" +
      "@media (prefers-reduced-motion:reduce){.contest button.lbig.lhot{animation:none;}}" +
      ".contest .lshare{display:block;width:100%;margin:12px 0 4px;font:inherit;font-size:1.45rem;font-weight:bold;padding:20px 12px;background:var(--ptmid,#4a7c4a);color:#fff;border:3px solid var(--ptdark,#1e3a1e);box-shadow:0 4px 0 var(--ptdark,#1e3a1e);cursor:pointer;}";
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
    if (state.reason === "late") headline = "Only today's quiz counts in the contest.";
    else if (me.rank) headline = "You're " + ord(me.rank) + " this month, with " + me.total + " points.";
    else if (me.outside) headline = "You're outside the top 10 for now, with " + me.total + " points.";
    else headline = "You're in. Every weekday counts.";
    el.appendChild(node("div", "cl", headline));

    var sub;
    if (state.counted) sub = "Today's score of " + state.score + " counts.";
    else if (state.reason === "already") sub = "Only your first try each day counts.";
    else if (state.reason === "late") sub = "See you tomorrow.";
    else sub = "";
    if (sub) el.appendChild(node("div", "cs", sub));

    var nm = node("div", "cn");
    var shown = me.name || playerName();
    nm.appendChild(document.createTextNode("Your name on the scoreboard: "));
    nm.appendChild(node("b", null, shown));
    nm.appendChild(node("br"));
    var ch = node("button", "clink", isRandomName(shown) ? "Tap here to use your own name" : "Change your name");
    ch.onclick = function () { renameForm(el, state); };
    nm.appendChild(ch);
    el.appendChild(nm);

    var bar = node("div", "cbar");
    var lb = node("a", null, "See the top 10");
    lb.href = "/contest";
    lb.onclick = function () { track("/contest-board"); };
    bar.appendChild(lb);
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
        row.appendChild(document.createTextNode(" group: " + leagueText(l)));
        wrap.appendChild(row);
      });
    }
    var start;
    if (leagues.length) start = node("button", "lbig", "Start another group");
    else {
      // Amplified (Matt, Nov 4): orange, gently pulsing, top of the box.
      wrap.className = "lg lhero";
      start = node("button", "lbig lhot");
      start.appendChild(node("span", "l1", "Create a group!"));
      start.appendChild(node("span", "l2", "Play your family and friends!"));
      track("/league-cta-view");
    }
    start.onclick = function () { track("/league-cta-tap"); startForm(wrap, start, state); };
    var bar = node("div", "cbar");
    bar.appendChild(start);
    wrap.appendChild(bar);
    // No groups yet: put the button right under the kicker, above everything else.
    if (!leagues.length && el.children.length > 1) el.insertBefore(wrap, el.children[1]);
    else el.appendChild(wrap);
  }

  function field(f, label, input) {
    var id = "cf" + Math.random().toString(36).slice(2, 8);
    var lb = node("label", null, label); lb.htmlFor = id; input.id = id;
    f.appendChild(lb); f.appendChild(input);
    return input;
  }

  function startForm(wrap, startBtn, state) {
    if (wrap.querySelector("form")) return;
    startBtn.style.display = "none";
    var needEmail = !isSubbed();
    var needName = isRandomName(playerName());
    var f = node("form", "lform");
    var you = null, em = null;
    if (needName) {
      you = node("input"); you.maxLength = 20; you.autocomplete = "given-name";
      field(f, "Your first name", you);
    }
    var nm = node("input"); nm.maxLength = 30; nm.placeholder = "Example: Smith Family";
    field(f, "Name your group", nm);
    if (needEmail) {
      em = node("input"); em.type = "email"; em.autocomplete = "email";
      field(f, "Your email", em);
    }
    var b = node("button", null, "Start my group"); b.type = "submit";
    f.appendChild(b);
    wrap.appendChild(f);
    var note = node("div", "lnote", needEmail
      ? "You'll also get the free daily quiz by email. You can stop it anytime."
      : "Next, you'll text the link to your family.");
    wrap.appendChild(note);
    var err = node("div", "cerr");
    wrap.appendChild(err);
    (you || nm).focus();
    var reset = function (msg) { err.textContent = msg; b.disabled = false; b.textContent = "Start my group"; };
    f.onsubmit = function (e) {
      e.preventDefault();
      err.textContent = "";
      var me = you ? you.value.replace(/\s+/g, " ").trim() : "";
      var name = nm.value.replace(/\s+/g, " ").trim();
      var email = em ? em.value.trim() : "";
      if (you && me.length < 2) { err.textContent = "Please type your first name."; you.focus(); return; }
      if (name.length < 2) { err.textContent = "Please give your group a name."; nm.focus(); return; }
      if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = "Please check your email address."; em.focus(); return; }
      b.disabled = true; b.textContent = "One moment...";
      var step = "name";
      var p = you
        ? call("/name", { id: playerId(), name: me }).then(function (r) {
            if (!r || !r.ok) throw { msg: (r && r.error) || "Please try a different first name." };
            set(K.name, r.name); if (state.me) state.me.name = r.name; track("/contest-rename");
          })
        : Promise.resolve();
      p.then(function () {
        step = "email";
        return needEmail ? kitSubscribe(email).then(function () { track("/signup-league"); }) : null;
      }).then(function () {
        step = "group";
        return call("/league/create", { id: playerId(), name: name, player: playerName() });
      }).then(function (r) {
        if (!r || !r.ok) { reset((r && r.error) || "Something went wrong. Please try again."); return; }
        track("/league-start");
        f.remove(); note.remove(); err.textContent = "";
        if (you) render(state);
        var w = wrap.isConnected ? wrap : (document.querySelector("#contestBox .lg") || wrap);
        var ready = node("div", "lready", "Your group, “" + r.name + ",” is ready.");
        var how = node("div", "lnote", "Now send the link so your family can join.");
        var sh = node("button", "lshare", "Text this to your family");
        var flash = node("div", "lnote");
        sh.onclick = function () { shareLeague(r.code, r.name, flash); };
        w.appendChild(ready); w.appendChild(how); w.appendChild(sh); w.appendChild(flash);
        state.leagues = (state.leagues || []).concat([{ code: r.code, name: r.name, alone: true }]);
        var big = w.querySelector("button.lbig"); if (big) big.style.display = "none";
      }).catch(function (x) {
        if (x && x.msg) { reset(x.msg); return; }
        reset(step === "email" ? "That email didn't go through. Please check it and try again."
                               : "Something went wrong. Please try again in a minute.");
      });
    };
  }

  function renameForm(el, state) {
    if (el.querySelector("form")) return;
    var f = node("form");
    var inp = node("input");
    inp.maxLength = 20;
    inp.value = isRandomName(playerName()) ? "" : playerName();
    inp.placeholder = "Your first name";
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
      try { lbLabel(r.me, r.counted); } catch (e) {}
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

  // Leaderboard button (Matt, Nov 2): a big "See the leaderboard" button at
  // the top of every page that loads this file. It opens the top 10 in a
  // pop-up over the page, so a quiz in progress is never lost.
  var lbLabel = function () {};
  function leaderButton() {
    if (document.getElementById("lbOpen") || location.pathname.indexOf("/contest") === 0) return;
    var head = document.querySelector("header");
    if (!head) return;
    var css = node("style");
    css.textContent =
      // Looks pressable (raised gold button with a shadow and an arrow) and
      // pulses until it's been opened today. No motion if the phone asks for less.
      "#lbOpen{display:block;width:100%;margin:12px 0 6px;padding:12px 10px 10px;font:inherit;font-weight:bold;line-height:1.25;" +
      "background:#f6c945;color:#1c2733;border:3px solid var(--ptdark,#1e3a1e);border-radius:8px;box-shadow:0 5px 0 var(--ptdark,#1e3a1e);cursor:pointer;position:relative;}" +
      "#lbOpen .lbm{display:block;font-size:1.2rem;}" +
      "#lbOpen .lbs{display:block;font-size:.9rem;font-weight:normal;margin-top:3px;}" +
      "#lbOpen .lbt{display:inline-block;}" +
      "#lbOpen:active{transform:translateY(4px);box-shadow:0 1px 0 var(--ptdark,#1e3a1e);}" +
      "#lbOpen.pulse{animation:lbPulse 2.2s ease-out infinite;}" +
      "#lbOpen.pulse .lbt{animation:lbWig 2.2s ease-in-out infinite;}" +
      "@keyframes lbPulse{0%{box-shadow:0 5px 0 var(--ptdark,#1e3a1e),0 0 0 0 rgba(246,201,69,.9);}" +
      "70%{box-shadow:0 5px 0 var(--ptdark,#1e3a1e),0 0 0 14px rgba(246,201,69,0);}100%{box-shadow:0 5px 0 var(--ptdark,#1e3a1e),0 0 0 0 rgba(246,201,69,0);}}" +
      "@keyframes lbWig{0%,60%,100%{transform:rotate(0)}66%{transform:rotate(-14deg)}74%{transform:rotate(12deg)}82%{transform:rotate(-8deg)}90%{transform:rotate(4deg)}}" +
      "@media (prefers-reduced-motion:reduce){#lbOpen.pulse,#lbOpen.pulse .lbt{animation:none;}}" +
      "#lbSheet{position:fixed;inset:0;z-index:9999;background:rgba(20,30,20,.55);display:flex;align-items:flex-start;justify-content:center;padding:16px 10px;overflow-y:auto;}" +
      "#lbSheet[hidden]{display:none;}" +
      "#lbSheet .lbbox{background:#f7f4ec;border:2px solid var(--ptdark,#1e3a1e);width:100%;max-width:520px;padding:18px 14px;font-family:Georgia,'Times New Roman',serif;color:#1c2733;text-align:center;}" +
      "#lbSheet h2{font-size:1.5rem;margin-bottom:4px;}" +
      "#lbSheet .lbsub{font-size:1rem;color:#524b3e;margin-bottom:12px;}" +
      "#lbSheet table{width:100%;border-collapse:collapse;font-size:1.1rem;background:#fffdf7;}" +
      "#lbSheet th{font-size:.85rem;color:#524b3e;font-weight:normal;padding:6px 4px;border-bottom:2px solid #1c2733;}" +
      "#lbSheet td{padding:10px 4px;border-bottom:1px solid #d8d2c0;text-align:center;}" +
      "#lbSheet td.n{text-align:left;}" +
      "#lbSheet tr.me td{background:#dfeedd;font-weight:bold;}" +
      "#lbSheet .lbmine{margin-top:12px;font-size:1.05rem;}" +
      "#lbSheet .lbgroups{margin-top:18px;padding-top:12px;border-top:2px solid #1c2733;text-align:left;}" +
      "#lbSheet .lbgroups h3{font-size:1.25rem;text-align:center;margin-bottom:8px;}" +
      "#lbSheet .lbg{display:block;margin-top:10px;padding:14px 12px;background:#fffdf7;border:2px solid var(--ptdark,#1e3a1e);border-radius:4px;color:#1c2733;text-decoration:none;font-size:1.05rem;line-height:1.4;}" +
      "#lbSheet .lbg b{display:block;font-size:1.2rem;color:var(--ptdark,#1e3a1e);}" +
      "#lbSheet .lbclose{display:block;width:100%;margin-top:16px;padding:16px;font:inherit;font-size:1.25rem;font-weight:bold;background:var(--ptdark,#1e3a1e);color:#fff;border:0;cursor:pointer;}" +
      "#lbSheet .lbmore{display:block;margin-top:12px;font-size:1rem;color:var(--ptdark,#1e3a1e);}";
    document.head.appendChild(css);

    // The label speaks to the player about their own spot, which is what makes
    // people tap: "You're #3 this month" beats "See the leaderboard".
    var btn = node("button");
    btn.id = "lbOpen"; btn.type = "button";
    var bm = node("span", "lbm"), bs = node("span", "lbs", "Tap to see the leaderboard");
    btn.appendChild(bm); btn.appendChild(bs);
    function label(text) {
      bm.innerHTML = "";
      bm.appendChild(node("span", "lbt", "\uD83C\uDFC6"));
      bm.appendChild(document.createTextNode(" " + text + " \u203A"));
    }
    var todayPT = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    function pulse(on) { if (on) btn.classList.add("pulse"); else btn.classList.remove("pulse"); }
    label("Who's winning this month?");
    pulse(get("tenContest.boardSeen") !== todayPT);
    head.appendChild(btn);
    lbLabel = function (me, fresh) {
      if (me && !me.out && me.rank) label("You're #" + me.rank + " this month. See the board");
      else if (me && !me.out && me.outside) label("How close are you to the top 10?");
      else label("Who's winning this month?");
      if (fresh) pulse(true);
    };
    try {
      var pid = get(K.id);
      if (pid) {
        var m0 = (typeof EDITION_DATE !== "undefined" && EDITION_DATE >= START ? EDITION_DATE : todayPT).slice(0, 7);
        if (m0 < START.slice(0, 7)) m0 = START.slice(0, 7);
        call("/board?month=" + m0 + "&me=" + pid).then(function (b) { if (b && b.me) lbLabel(b.me); }).catch(function () {});
      }
    } catch (e) {}

    var sheet = node("div"); sheet.id = "lbSheet"; sheet.hidden = true;
    sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true");
    var box = node("div", "lbbox");
    sheet.appendChild(box);
    document.body.appendChild(sheet);
    sheet.onclick = function (e) { if (e.target === sheet) sheet.hidden = true; };

    function close() { sheet.hidden = true; }
    function closeBtn() { var c = node("button", "lbclose", "Close"); c.type = "button"; c.onclick = close; return c; }

    btn.onclick = function () {
      track("/contest-board-pop");
      set("tenContest.boardSeen", todayPT); pulse(false);
      var month = (typeof EDITION_DATE !== "undefined" && EDITION_DATE >= START ? EDITION_DATE
        : new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })).slice(0, 7);
      if (month < START.slice(0, 7)) month = START.slice(0, 7);
      var monthName = new Date(month + "-15T12:00:00Z").toLocaleString("en-US", { month: "long", timeZone: "UTC" });
      box.innerHTML = "";
      box.appendChild(node("h2", null, "Top 10 for " + monthName));
      box.appendChild(node("div", "lbsub", "Loading..."));
      box.appendChild(closeBtn());
      sheet.hidden = false;
      var id = get(K.id);
      call("/board?month=" + month + (id ? "&me=" + id : "")).then(function (b) {
        var weeks = b.weeks || [], today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }), cw = 0;
        weeks.forEach(function (w, i) { if (w.dates && w.dates[0] <= today) cw = i; });
        box.innerHTML = "";
        box.appendChild(node("h2", null, "Top 10 for " + monthName));
        box.appendChild(node("div", "lbsub", "Every weekday counts. Most points at the end of the month wins."));
        var t = node("table"), hr = node("tr");
        ["#", "Name", "This week", "Total"].forEach(function (h, i) { var th = node("th", null, h); if (i === 1) th.style.textAlign = "left"; hr.appendChild(th); });
        t.appendChild(hr);
        (b.players || []).forEach(function (p) {
          var tr = node("tr", p.me ? "me" : null);
          tr.appendChild(node("td", null, String(p.rank)));
          tr.appendChild(node("td", "n", p.name + (p.me ? " (you)" : "")));
          tr.appendChild(node("td", null, String((p.weeks || [])[cw] || 0)));
          tr.appendChild(node("td", null, String(p.total)));
          t.appendChild(tr);
        });
        box.appendChild(t);
        var me = b.me;
        if (me && !me.out && me.outside) box.appendChild(node("div", "lbmine", "You're outside the top 10 for now, with " + me.total + " points. Every weekday is a chance to climb."));
        else if (!me) box.appendChild(node("div", "lbmine", "Finish today's quiz and you're in."));
        if (id) {
          var gbox = node("div", "lbgroups");
          box.appendChild(gbox);
          call("/leagues?month=" + month + "&me=" + id).then(function (r) {
            var ls = (r && r.leagues) || [];
            if (!ls.length) { gbox.remove(); return; }
            gbox.appendChild(node("h3", null, ls.length === 1 ? "Your group" : "Your groups"));
            ls.forEach(function (l) {
              var g = node("a", "lbg");
              g.href = "/l?c=" + encodeURIComponent(l.code);
              g.appendChild(node("b", null, l.name + " \u2192"));
              var line = leagueText(l);
              g.appendChild(document.createTextNode(line.charAt(0).toUpperCase() + line.slice(1)));
              g.onclick = function () { track("/contest-group-pop"); };
              gbox.appendChild(g);
            });
          }).catch(function () { gbox.remove(); });
        }
        box.appendChild(closeBtn());
        var more = node("a", "lbmore", "See every week and the rules");
        more.href = "/contest";
        box.appendChild(more);
      }).catch(function () {
        box.innerHTML = "";
        box.appendChild(node("h2", null, "Top 10 for " + monthName));
        box.appendChild(node("div", "lbsub", "The leaderboard didn't load. Try again in a minute."));
        box.appendChild(closeBtn());
      });
    };
  }
  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", leaderButton);
    else leaderButton();
  } catch (e) {}

  window.tenContest = {
    api: API, playerId: playerId, playerName: playerName, call: call, setName: function (n) { set(K.name, n); },
    isSubbed: isSubbed, isRandomName: isRandomName, kitSubscribe: kitSubscribe, shareLeague: shareLeague, leagueText: leagueText, ord: ord, track: track
  };

  // Per-question timing and exact signup/shop events (Nov 6). Read-only
  // listeners: they never change how the quiz plays.
  var qStart = Date.now(), qsecs = [], sent = {};
  function ev(name) {
    try {
      if (sent[name] || typeof EDITION_DATE === "undefined") return;
      sent[name] = 1;
      call("/ev", { id: playerId(), date: EDITION_DATE, ev: name }).catch(function () {});
    } catch (e) {}
  }
  try {
    if (typeof startTime !== "undefined") qStart = startTime;
    document.addEventListener("click", function (e) {
      try {
        var t = e.target;
        var opt = t.closest && t.closest(".opt");
        if (opt && !opt.disabled && typeof current !== "undefined" && qsecs.length === current) {
          qsecs.push(Math.max(0, Math.round((Date.now() - qStart) / 1000)));
          var q = typeof QUESTIONS !== "undefined" && QUESTIONS[current];
          if (q && q.shop) ev("seen_shop_q");
        }
        if (t.id === "nextBtn" || (t.closest && t.closest("#nextBtn"))) qStart = Date.now();
        var a = t.closest && t.closest("a");
        if (a && /shop|fourthwall/i.test(a.href || "")) ev("tap_shop_" + (a.className === "shoplink" ? "q" : (a.id || "other").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20)));
      } catch (x) {}
    }, true);
    document.addEventListener("submit", function (e) {
      try { var f = e.target; if (f && f.id) ev("submit_" + f.id.toLowerCase().replace(/[^a-z0-9]/g, "")); } catch (x) {}
    }, true);
    // Which signup boxes were actually on screen: the denominator for signups.
    var watch = function () {
      if (!window.IntersectionObserver) return;
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (x) {
          if (x.isIntersecting && x.target.offsetParent !== null) {
            ev("seen_" + x.target.id.toLowerCase().replace(/[^a-z0-9]/g, ""));
            if (!isSubbed()) ev("seen_unsub_" + x.target.id.toLowerCase().replace(/[^a-z0-9]/g, ""));
          }
        });
      }, { threshold: 0.5 });
      ["kitForm", "kitFormMid", "kitFormPick", "kitFormMerch"].forEach(function (id) {
        var el = document.getElementById(id); if (el) io.observe(el);
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
  } catch (e) {}

  // Every finish, first try or replay, goes to the private dashboard (Nov 3):
  // which questions were right ("1") or wrong ("0") in QUESTIONS order, plus
  // how long it took. Read from the edition's own dots and timer.
  function logPlay(first) {
    var ans = null, secs = null;
    try {
      if (typeof dots !== "undefined" && dots.length) {
        ans = dots.map(function (d) { return d === "\uD83D\uDFE2" ? "1" : "0"; }).join("");
      }
    } catch (e) {}
    try {
      if (typeof startTime !== "undefined") {
        var end = (typeof finishedAt !== "undefined" && finishedAt) || Date.now();
        secs = Math.round((end - startTime) / 1000);
      }
    } catch (e) {}
    var qs = qsecs.length && typeof QUESTIONS !== "undefined" && qsecs.length === QUESTIONS.length ? qsecs.join(",") : null;
    call("/play", { id: playerId(), date: EDITION_DATE, score: score, answers: ans, secs: secs, first: !!first, qsecs: qs, subbed: isSubbed() }).catch(function () {});
  }

  try {
    if (typeof EDITION_DATE === "undefined" || EDITION_DATE < START) return;
    if (typeof window.showResults !== "function") return;
    var orig = window.showResults;
    window.showResults = function () {
      var first = false;
      try { first = !localStorage.getItem("tenEveryday.done." + EDITION_DATE); } catch (e) {}
      var out = orig.apply(this, arguments);
      try { start(first); } catch (e) {}
      try { logPlay(first); } catch (e) {}
      return out;
    };
  } catch (e) {}
})();
