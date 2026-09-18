/* The Workflow Library: shelves, facets, pricing toggle, email capture, measurement.
   Loaded on every page. Everything is optional: each block checks its own DOM first.
   Data comes from window.TWL, injected by site/build.py. */
(function () {
  "use strict";
  var T = window.TWL || {};
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };

  /* ---------------------------------------------------------------- measurement */
  function track(name, params) {
    if (window.gtag) window.gtag("event", name, params || {});
  }
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-cta]");
    if (!el) return;
    track("cta_click", {
      cta: el.getAttribute("data-cta"),
      label: (el.textContent || "").trim().slice(0, 60),
      page: location.pathname
    });
  });

  /* ------------------------------------------------------------- analytics consent */
  (function () {
    var el = $("consent");
    if (!el) return;
    var K = "twl_consent", v = null;
    try { v = localStorage.getItem(K); } catch (e) {}
    if (!v) el.hidden = false;
    function set(val) {
      try { localStorage.setItem(K, val); } catch (e) {}
      el.hidden = true;
      if (val === "granted" && window.twlLoadHubSpot) window.twlLoadHubSpot();
      if (val === "granted" && window.gtag) {
        window.gtag("consent", "update", {
          ad_storage: "granted", ad_user_data: "granted",
          ad_personalization: "granted", analytics_storage: "granted"
        });
      }
    }
    $("consent-yes").addEventListener("click", function () { set("granted"); });
    $("consent-no").addEventListener("click", function () { set("denied"); });
  })();

  /* ------------------------------------------------------------- shelf scrolling */
  function wireRail(sh) {
    var r = sh.querySelector(".rail"), p = sh.querySelector(".prev"), n = sh.querySelector(".next");
    if (!r || !p || !n) return;
    var step = function () { return Math.max(260, Math.round(r.clientWidth * 0.82)); };
    p.addEventListener("click", function () { r.scrollBy({ left: -step(), behavior: "smooth" }); });
    n.addEventListener("click", function () { r.scrollBy({ left: step(), behavior: "smooth" }); });
    var sync = function () {
      p.disabled = r.scrollLeft < 8;
      n.disabled = r.scrollLeft + r.clientWidth >= r.scrollWidth - 8;
    };
    r.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    sync();
  }
  function wireAllRails(root) {
    (root || document).querySelectorAll(".shelf").forEach(wireRail);
  }
  wireAllRails();

  /* ------------------------------------------------------------------ email capture */
  function post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json().catch(function () { return {}; });
    });
  }
  function hsSubmit(email, page) {
    var h = T.hsForm;
    if (!h || !h.portal || !h.guid) return Promise.reject(new Error("no form"));
    return fetch("https://api.hsforms.com/submissions/v3/integration/submit/" + h.portal + "/" + h.guid, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: [{ objectTypeId: "0-1", name: "email", value: email }],
        context: { pageUri: location.href, pageName: page || document.title }
      })
    }).then(function (r) { if (!r.ok) throw new Error(r.status); return {}; });
  }
  /* Worker first, then the form API, then a local confirmation. Never a dead end. */
  function capture(route, payload) {
    var w = T.worker;
    var first = w ? post(w + route, payload) : Promise.reject(new Error("no worker"));
    return first.catch(function () { return hsSubmit(payload.email, payload.spec || "site"); });
  }
  function cookie(name) {
    try {
      var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
      return m ? decodeURIComponent(m[1]) : "";
    } catch (e) { return ""; }
  }

  function wireForm(form, done, route, event, extra) {
    if (!form || !done) return;
    var note = form.parentNode.querySelector(".freenote");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = (form.email.value || "").trim();
      if (!email) return;
      var btn = form.querySelector("button");
      if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }
      var body = { email: email, source: source(), ref: location.pathname + location.search,
        // The Worker turns this into a real HubSpot form submission: hutk ties it to the visit, so the contact
        // arrives with its source instead of out of nowhere (17/09/2026).
        hutk: cookie("hubspotutk"), page_url: location.href, page_name: document.title.slice(0, 120) };
      if (extra) for (var k in extra) body[k] = extra[k];
      capture(route, body).then(function (d) {
        form.hidden = true;
        done.hidden = false;
        if (d && d.download) {
          var a = done.querySelector("[data-dl]");
          if (a) { a.href = d.download; a.hidden = false; }
        }
        track(event, { source: body.source });
      }).catch(function () {
        /* nothing reached us: say so and give a route that works. Never a fake confirmation. */
        if (btn) { btn.disabled = false; btn.textContent = "Try again"; }
        if (note) {
          note.innerHTML = "That did not go through, so nothing was sent. Try again in a minute, or write to " +
            '<a href="mailto:' + (T.support || "") + "?subject=" + encodeURIComponent(subject(route, extra)) +
            '">' + (T.support || "us") + "</a> and you get it by hand.";
        }
        track(event + "_failed", { route: route });
      });
    });
  }
  function subject(route, extra) {
    if (route === "/free" && extra && extra.spec) return "Install " + extra.spec + " in my portal";
    return "Send me the free specs";
  }
  function source() {
    try {
      return new URLSearchParams(location.search).get("utm_source") || document.referrer || "site";
    } catch (e) { return "site"; }
  }
  wireForm($("heroform"), $("herodone"), "/subscribe", "free_pack_signup");
  wireForm($("freeform"), $("freedone"), "/subscribe", "free_pack_signup");

  /* free spec page: the install panel */
  (function () {
    var btn = $("insbtn"), pnl = $("inspanel"), form = $("insform"), ok = $("insok"), cancel = $("inscancel");
    if (!btn || !pnl || !form || !ok) return;
    btn.addEventListener("click", function () {
      pnl.hidden = false; btn.hidden = true;
      var m = $("insmail"); if (m) m.focus();
    });
    if (cancel) cancel.addEventListener("click", function () {
      pnl.hidden = true; btn.hidden = false; btn.focus();
    });
    wireForm(form, ok, "/free", "install_request", { spec: pnl.getAttribute("data-spec") || "" });
  })();

  /* --------------------------------------------------------------- pricing toggle */
  (function () {
    var seg = $("buyseg"), tiers = $("tiers"), note = $("togglenote");
    if (!seg || !tiers) return;
    var ICO = {
      ok: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.4l3.2 3.2L13 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      ins: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8.8 1.6L3.2 9.2h3.6l-.6 5.2 5.6-7.6H8.2l.6-5.2z" fill="currentColor"/></svg>'
    };
    var mode = "files";
    function paint() {
      tiers.querySelectorAll(".tier").forEach(function (t) {
        var row = t.querySelector(".insrow");
        if (row) {
          var kind = row.getAttribute("data-" + mode + "-kind") || "ok";
          row.className = "insrow" + (kind === "ins" ? " ins" : "");
          row.innerHTML = ICO[kind === "ins" ? "ins" : "ok"] + "<span>" + esc(row.getAttribute("data-" + mode) || "") + "</span>";
        }
        var rib = t.querySelector(".rib");
        if (rib && rib.getAttribute("data-" + mode)) rib.textContent = rib.getAttribute("data-" + mode);
        var addon = t.querySelector(".addon input");
        var b = t.querySelector(".price b"), s = t.querySelector(".price s");
        if (b && b.getAttribute("data-base")) {
          var plus = addon && addon.checked ? +(t.getAttribute("data-addon") || 0) : 0;
          b.textContent = (+b.getAttribute("data-base") + plus) + " EUR";
          if (s && s.getAttribute("data-base")) s.textContent = (+s.getAttribute("data-base") + plus) + " EUR";
        }
        var an = t.querySelector(".addonnote");
        if (an) an.hidden = !(addon && addon.checked);
        var cta = t.querySelector("a.btn[data-cta]");
        if (cta && addon) cta.setAttribute("data-addon", addon.checked ? "1" : "0");
      });
      if (note) note.innerHTML = note.getAttribute("data-" + mode) || "";
      seg.querySelectorAll("button").forEach(function (x) {
        x.setAttribute("aria-pressed", String(x.getAttribute("data-mode") === mode));
      });
    }
    seg.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-mode]");
      if (!b) return;
      mode = b.getAttribute("data-mode");
      tiers.classList.add("swap");
      setTimeout(function () { paint(); tiers.classList.remove("swap"); }, 150);
      track("pricing_mode", { mode: mode });
    });
    tiers.addEventListener("change", function (e) {
      if (!e.target.closest(".addon")) return;
      paint();
      track("pricing_addon", { on: e.target.checked ? 1 : 0 });
    });
    paint();
  })();

  /* ------------------------------------------------------------------ the shelves */
  var shelfwrap = $("shelfwrap");
  if (!shelfwrap || !T.rows) return;

  var R = T.rows, CATS = T.cats, OBJS = T.objs, TIERS = T.tiers;
  var STATUS = ["free", "full", "planned"], SLABEL = ["Free", "Full spec", "Dated"];
  var DIFF = { 1: "Simple", 2: "Intermediate", 3: "Advanced" };
  var CLS = { free: "free", full: "full", planned: "plan" };
  var PAGE = window.matchMedia("(max-width:760px)").matches ? 9 : 24;
  var state = { q: "", cat: new Set(), status: new Set(), obj: new Set(), lvl: new Set(), diff: new Set(), sort: "rec", page: 1 };

  var FACETS = {
    cat: { label: "Category", opts: CATS.map(function (c, i) { return [String(i), c[1]]; }), test: function (r, v) { return String(r[5]) === v; } },
    status: { label: "Status", opts: [["0", "Free"], ["1", "Full spec"], ["2", "Dated"]], test: function (r, v) { return String(r[6]) === v; } },
    obj: { label: "Object", opts: OBJS.map(function (o, i) { return [String(i), o]; }), test: function (r, v) { return String(r[2]) === v; } },
    lvl: { label: "Tier", opts: T.levels.map(function (l) { return [l, l]; }), test: function (r, v) { return TIERS[r[3]][1] === v; } },
    diff: { label: "Level", opts: [["1", "Simple"], ["2", "Intermediate"], ["3", "Advanced"]], test: function (r, v) { return String(r[4]) === v; } }
  };
  function rid(r) { return CATS[r[5]][0] + "-" + String(r[0]).padStart(3, "0"); }
  function match(r) {
    for (var f in FACETS) {
      var s = state[f];
      if (s.size) {
        var ok = false;
        s.forEach(function (v) { if (FACETS[f].test(r, v)) ok = true; });
        if (!ok) return false;
      }
    }
    if (state.q) {
      var h = (r[1] + " " + CATS[r[5]][1] + " " + rid(r) + " " + OBJS[r[2]] + " " + TIERS[r[3]][0]).toLowerCase();
      var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < terms.length; i++) if (h.indexOf(terms[i]) < 0) return false;
    }
    return true;
  }
  function active() {
    if (state.q) return true;
    for (var f in FACETS) if (state[f].size) return true;
    return false;
  }

  var CALICON = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="3" stroke="currentColor" stroke-width="1.6"/><path d="M8 3v3M16 3v3M3 9.5h18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  function card(r) {
    var i = rid(r), st = STATUS[r[6]];
    var flag = '<span class="b ' + CLS[st] + '">' + SLABEL[r[6]] + "</span>";
    var thumb = st === "planned"
      ? '<div class="thumb plan"><div class="glyph">' + CALICON + "<b>" + fridayOf(r) + "</b></div>" +
        '<span class="flag">' + flag + "</span></div>"
      : '<div class="thumb"><img src="/og/' + i + '-map.png" loading="lazy" decoding="async" fetchpriority="low" width="640" height="360" alt="Workflow map for ' +
        esc(r[1]) + '"><span class="flag">' + flag + "</span></div>";
    var tag = st === "planned" ? "div" : "a";
    var href = st === "planned" ? "" : ' href="/w/' + i + '.html"';
    var sp = r[7] === 1 ? "step" : "steps", pp = r[8] === 1 ? "prerequisite" : "prerequisites";
    return "<" + tag + ' class="card"' + href + ">" + thumb +
      '<div class="body"><div class="ttl">' + esc(r[1]) + "</div>" +
      '<div class="line"><span class="b cat">' + esc(CATS[r[5]][1]) + '</span><span class="b meta">' +
      esc(OBJS[r[2]]) + '</span><span class="b meta">' + DIFF[r[4]] + "</span></div>" +
      '<div class="tierline">' + esc(TIERS[r[3]][0]) + "</div>" +
      '<div class="incl"><span>' + r[7] + " " + sp + "</span><span>" + r[8] + " " + pp +
      "</span><span>~" + r[9] + " min</span></div></div></" + tag + ">";
  }
  function fridayOf(r) {
    var d = r[10];
    if (!d) return "Dated";
    var p = d.split("-");
    return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+p[1]] + " " + (+p[2]);
  }
  function rail(rows, extra) {
    return '<div class="rail" tabindex="0" role="group" aria-label="Scrollable shelf">' +
      rows.map(card).join("") + (extra || "") + "</div>";
  }
  var ARROWS = '<div class="arrows"><button type="button" class="prev" aria-label="Scroll this shelf left">' +
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
    '<button type="button" class="next" aria-label="Scroll this shelf right">' +
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>';

  function buildShelves() {
    var out = [], free = R.filter(function (r) { return r[6] === 0; });
    out.push('<section class="shelf" aria-labelledby="sh-free"><div class="shead"><div class="t">' +
      '<p class="kicker">Start here</p><h2 id="sh-free">' + free.length + ' free specs, one per category</h2>' +
      '<p class="countline">Complete and unlocked <i>|</i> nine sections, diagram, test plan <i>|</i> <em>0 EUR</em></p>' +
      '</div><div class="act"><a class="btn lime" href="#free" data-cta="shelf-free">Get all ' + T.freeWord +
      ', free</a>' + ARROWS + "</div></div>" + rail(free) + "</section>");

    var fri = R.filter(function (r) { return r[10] === T.friday; });
    if (fri.length) {
      out.push('<section class="shelf" aria-labelledby="sh-fri"><div class="shead"><div class="t">' +
        '<p class="kicker">New this Friday</p><h2 id="sh-fri">' + fri.length + " specs ship on " + esc(T.fridayLabel) + "</h2>" +
        '<p class="countline">' + T.perWeek + ' per category, every Friday <i>|</i> until ' + esc(T.lastLabel) +
        ' <i>|</i> included in every pack</p></div><div class="act">' +
        '<span class="sellline">Already in the <a href="#pricing">full library, ' + T.priceFull + ' EUR</a></span>' +
        '<a class="btn" href="/changelog.html">See the changelog</a>' + ARROWS + "</div></div>" + rail(fri) + "</section>");
    }

    CATS.forEach(function (c, i) {
      var rows = R.filter(function (r) { return r[5] === i; });
      var nf = rows.filter(function (r) { return r[6] === 0; }).length;
      var nl = rows.filter(function (r) { return r[6] < 2; }).length;
      var np = rows.filter(function (r) { return r[6] === 2; }).length;
      var seeall = '<button class="seeall" type="button" data-cat="' + i + '"><b>All ' + rows.length + " in " + esc(c[1]) + "</b>" +
        "<span>" + nf + " free, " + nl + " full today, " + np + " dated for a Friday between now and " + esc(T.lastLabel) + ".</span>" +
        '<span class="go">Filter the library &#8594;</span></button>';
      var shown = rows.filter(function (r) { return r[6] < 2; }).concat(rows.filter(function (r) { return r[6] === 2; }).slice(0, 7));
      out.push('<section class="shelf" aria-labelledby="sh-' + c[0] + '"><div class="shead"><div class="t">' +
        '<h3 id="sh-' + c[0] + '">' + esc(c[1]) + "</h3>" +
        '<p class="countline"><em>' + nf + " free</em> <i>|</i> " + nl + " full today <i>|</i> " + np +
        " dated for a Friday <i>|</i> " + rows.length + " by " + esc(T.lastLabel) + "</p></div><div class=\"act\">" +
        '<span class="sellline">or the whole library, <a href="#pricing">' + T.priceFull + ' EUR</a></span>' +
        '<a class="btn pri" href="' + esc(T.catLinks[c[0]] || "#pricing") + '" data-cta="shelf-pack">This category, ' +
        T.priceCat + " EUR</a>" + ARROWS + "</div></div>" + rail(shown, seeall) +
        '<p class="sellline" style="margin-top:-4px">' + esc(T.packFine) + "</p></section>");
    });
    shelfwrap.innerHTML = out.join("");
    wireAllRails(shelfwrap);
    wireSeeAll();
  }
  function wireSeeAll() {
    shelfwrap.querySelectorAll(".seeall").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-cat");
        if (!/^\d+$/.test(v)) {
          var i = CATS.findIndex(function (c) { return c[0] === v; });
          v = i < 0 ? null : String(i);
        }
        if (v === null) return;
        state.cat.clear(); state.cat.add(v); state.page = 1;
        render();
        $("shelves").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  /* ------------------------------------------------------------------- popovers */
  var bd = $("sheetbd");
  function counts(f, v) {
    var saved = state[f]; state[f] = new Set();
    var n = 0;
    for (var i = 0; i < R.length; i++) if (match(R[i]) && FACETS[f].test(R[i], v)) n++;
    state[f] = saved;
    return n;
  }
  function closeAll() {
    document.querySelectorAll(".fdd .pop").forEach(function (p) { p.remove(); });
    document.querySelectorAll(".fbtn").forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
    if (bd) bd.hidden = true;
  }
  function openPop(dd) {
    var f = dd.getAttribute("data-f"), btn = dd.querySelector(".fbtn");
    var wasOpen = btn.getAttribute("aria-expanded") === "true";
    closeAll();
    if (wasOpen) return;
    var pop = document.createElement("div");
    pop.className = "pop" + (["lvl", "diff"].indexOf(f) > -1 ? " right" : "");
    pop.innerHTML = FACETS[f].opts.map(function (o) {
      var on = state[f].has(o[0]);
      return '<label class="opt' + (on ? " on" : "") + '"><input type="checkbox" data-f="' + f + '" value="' +
        esc(o[0]) + '"' + (on ? " checked" : "") + "><span>" + esc(o[1]) + '</span><span class="n">' +
        counts(f, o[0]) + "</span></label>";
    }).join("") + '<div class="popfoot"><button class="btn pri" type="button" data-close>Show results</button></div>';
    dd.appendChild(pop);
    btn.setAttribute("aria-expanded", "true");
    if (bd && window.matchMedia("(max-width:760px)").matches) bd.hidden = false;
    pop.querySelectorAll("input").forEach(function (i) {
      i.addEventListener("change", function () {
        if (i.checked) state[f].add(i.value); else state[f].delete(i.value);
        i.closest(".opt").classList.toggle("on", i.checked);
        state.page = 1; render();
      });
    });
    var cl = pop.querySelector("[data-close]");
    if (cl) cl.addEventListener("click", closeAll);
    var first = pop.querySelector("input");
    if (first) first.focus();
  }
  document.querySelectorAll(".fdd").forEach(function (dd) {
    dd.querySelector(".fbtn").addEventListener("click", function (e) { e.stopPropagation(); openPop(dd); });
  });
  document.addEventListener("click", function (e) { if (!e.target.closest(".fdd")) closeAll(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAll(); });
  if (bd) bd.addEventListener("click", closeAll);

  /* --------------------------------------------------------------------- render */
  var grid = $("grid"), chipsEl = $("chips"), results = $("results"), gcount = $("gcount"),
      rescount = $("rescount"), emptyEl = $("empty"), moreWrap = $("morewrap"), moreBtn = $("more"),
      packstrip = $("packstrip"), qEl = $("q");
  function sorted(list) {
    var s = state.sort, c = list.slice();
    if (s === "az") c.sort(function (a, b) { return a[1].localeCompare(b[1]); });
    else if (s === "fast") c.sort(function (a, b) { return a[9] - b[9] || a[1].localeCompare(b[1]); });
    else if (s === "easy") c.sort(function (a, b) { return a[4] - b[4] || a[9] - b[9]; });
    else if (s === "steps") c.sort(function (a, b) { return b[7] - a[7]; });
    else c.sort(function (a, b) { return a[6] - b[6] || a[5] - b[5] || a[0] - b[0]; });
    return c;
  }
  function chipLabel(f, v) {
    var o = FACETS[f].opts.filter(function (x) { return x[0] === v; })[0];
    return o ? o[1] : v;
  }
  function render() {
    var on = active();
    shelfwrap.hidden = on;
    results.hidden = !on;
    var list = sorted(R.filter(match)), n = list.length;
    rescount.innerHTML = on ? "<b>" + n + "</b> of " + R.length + " specs" : "<b>" + R.length + "</b> specs on the shelves";
    if (on) {
      var shown = list.slice(0, state.page * PAGE);
      grid.innerHTML = shown.map(card).join("");
      gcount.textContent = n + " spec" + (n === 1 ? "" : "s");
      emptyEl.hidden = n > 0;
      moreWrap.style.display = n > shown.length ? "" : "none";
      moreBtn.textContent = "Load " + Math.min(PAGE, n - shown.length) + " more";
      var one = state.cat.size === 1 ? Array.from(state.cat)[0] : null;
      packstrip.hidden = one === null;
      if (one !== null) {
        var c = CATS[+one];
        $("packname").textContent = c[1];
        $("packcount").textContent = R.filter(function (r) { return r[5] === +one; }).length;
        $("packbtn").setAttribute("href", T.catLinks[c[0]] || "#pricing");
      }
    }
    var chips = [];
    for (var f in FACETS) state[f].forEach(function (v) {
      chips.push('<span class="chip">' + esc(chipLabel(f, v)) + '<button type="button" data-f="' + f +
        '" data-v="' + esc(v) + '" aria-label="Remove filter ' + esc(chipLabel(f, v)) + '">&times;</button></span>');
    });
    if (state.q) chips.push('<span class="chip">"' + esc(state.q) +
      '"<button type="button" data-f="q" data-v="" aria-label="Clear the search">&times;</button></span>');
    if (chips.length) chips.push('<button class="clr" type="button" id="clrall">Clear all</button>');
    chipsEl.innerHTML = chips.join("");
    chipsEl.hidden = !chips.length;
    document.querySelectorAll(".fdd").forEach(function (dd) {
      var f = dd.getAttribute("data-f"), b = dd.querySelector(".fbtn"), k = state[f].size;
      b.classList.toggle("on", k > 0);
      var n2 = b.querySelector(".n");
      if (k && !n2) { n2 = document.createElement("span"); n2.className = "n"; b.appendChild(n2); }
      if (n2) { n2.textContent = k; n2.hidden = !k; }
    });
  }
  chipsEl.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.id === "clrall") { for (var f in FACETS) state[f].clear(); state.q = ""; qEl.value = ""; }
    else if (b.getAttribute("data-f") === "q") { state.q = ""; qEl.value = ""; }
    else state[b.getAttribute("data-f")].delete(b.getAttribute("data-v"));
    state.page = 1; render();
  });
  var t = null;
  qEl.addEventListener("input", function (e) {
    clearTimeout(t);
    t = setTimeout(function () { state.q = e.target.value.trim(); state.page = 1; render(); }, 120);
  });
  $("sort").addEventListener("change", function (e) { state.sort = e.target.value; state.page = 1; render(); });
  moreBtn.addEventListener("click", function () { state.page++; render(); });
  $("backshelf").addEventListener("click", function () {
    for (var f in FACETS) state[f].clear();
    state.q = ""; qEl.value = ""; state.page = 1; render();
    $("shelves").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* a category link elsewhere on the page opens the filtered grid */
  document.addEventListener("click", function (e) {
    var a = e.target.closest("a[data-filter-cat]");
    if (!a) return;
    e.preventDefault();
    var i = CATS.findIndex(function (c) { return c[0] === a.getAttribute("data-filter-cat"); });
    if (i < 0) return;
    state.cat.clear(); state.cat.add(String(i)); state.page = 1; render();
    $("shelves").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function fromHash() {
    var m = /[?&]cat=([a-z-]+)/.exec(location.hash);
    if (!m) return;
    var i = CATS.findIndex(function (c) { return c[0] === m[1]; });
    if (i >= 0) { state.cat.clear(); state.cat.add(String(i)); }
  }
  fromHash();
  if (shelfwrap.getAttribute("data-ssr")) wireSeeAll();
  else buildShelves();
  render();
  window.addEventListener("hashchange", function () {
    var before = state.cat.size;
    fromHash();
    if (state.cat.size !== before) render();
  });
})();
