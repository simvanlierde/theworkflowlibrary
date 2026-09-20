/* The Workflow Library: the install page.
   Static shell, three steps, vanilla JS. It talks to the install Worker and to nothing else:
   the install bodies are paid content and never leave the Worker's private storage, so this
   page never fetches an install index or a workflow payload from the site.
     endpoints (config.hubspot.install_worker):
     GET  /install/state?t=<token>   licence, portal, which specs the licence covers
     GET  /install/auth?t=<token>    302 to HubSpot's authorisation screen, so the page navigates there
     POST /install/run               { t, s, specs } -> per spec result
   With ?demo=1 the page runs on the fixture below and calls nothing. */
(function () {
  "use strict";
  var T = window.TWL || {};
  var W = T.installWorker || "";
  var SPECS = window.TWL_INSTALL || [];
  var $ = function (id) { return document.getElementById(id); };
  var qs = new URLSearchParams(location.search);
  var stash = function (k) { try { return sessionStorage.getItem("twl_" + k) || ""; } catch (e) { return ""; } };
  var token = qs.get("t") || stash("t");
  // The callback comes back with ?s=<session>: the portal it authorised. Every route that touches the portal
  // needs it (/install/state to show it connected, /install/run to create anything), and the page dropped it
  // until 17/09/2026, so step 2 stayed "Not connected" after a successful authorisation.
  var sid = qs.get("s") || stash("s");
  var DEMO = qs.get("demo") === "1";
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  var byId = {};
  SPECS.forEach(function (s) { byId[s[0]] = s; });

  var FIXTURE = {
    ok: true, demo: true, licence: "Full library", tier: "full",
    order: "DEMO-0000", date: "16 September 2026",
    portals_used: 0, portals_max: 3,
    portal: null, specs: SPECS.map(function (s) { return s[0]; })
  };
  var state = null, results = null;

  // /install/state answers with "connected" (hub_id, name, tiers per hub, installed), while this page was
  // written against a "portal" object holding a "hubs" list of "<hub>-<level>" strings. Same data, two shapes,
  // and nothing bridged them until 17/09/2026, so an authorised portal still read "Not connected".
  var LEVELS = ["none", "free", "starter", "professional", "enterprise"];
  var HUB_LABEL = { sales: "Sales", marketing: "Marketing", service: "Service", ops: "Operations", content: "Content" };

  function tierLabel(tiers) {
    var pairs = Object.keys(tiers || {})
      .filter(function (h) { return LEVELS.indexOf(tiers[h]) > 1; })
      .sort(function (a, b) { return LEVELS.indexOf(tiers[b]) - LEVELS.indexOf(tiers[a]); });
    if (!pairs.length) return "Free HubSpot";
    return pairs.slice(0, 3).map(function (h) {
      var lvl = tiers[h];
      return (HUB_LABEL[h] || h) + " Hub " + lvl.charAt(0).toUpperCase() + lvl.slice(1);
    }).join(", ") + (pairs.length > 3 ? ", and more" : "");
  }

  function adapt(s) {
    s = s || {};
    if (s.portal && !s.portal.tiers && s.portal.hubs) {
      // demo fixture shape: ["sales-professional", ...]
      var t = {};
      s.portal.hubs.forEach(function (h) {
        var parts = String(h).split("-"), lvl = parts.pop();
        t[parts.join("-")] = lvl;
      });
      s.portal.tiers = t;
    }
    if (s.connected && !s.portal) {
      s.portal = {
        name: s.connected.name || "Your portal",
        hub_id: s.connected.hub_id,
        tiers: s.connected.tiers || null,
        installed: s.connected.installed || [],
        installed_on: s.connected.installed_on || {},
        expires_in: s.connected.expires_in,
        tier: tierLabel(s.connected.tiers),
      };
    }
    return s;
  }

  function ev(name, params) {
    if (window.gtag) { try { window.gtag("event", name, params || {}); } catch (e) { /* never break an install */ } }
  }

  function setState(s) {
    var had = !!(state && state.portal);
    state = adapt(s);
    if (!had && state.portal) {
      ev("install_portal_connected", { tier: (state.licence && state.licence.tier) || "", specs_selected: selected().length });
    }
    paint();
  }
  function note(el, msg, spin) {
    var e = $(el);
    if (e) e.innerHTML = (spin ? '<span class="spin"></span> ' : "") + esc(msg);
  }

  /* ----------------------------------------------------------------- selection */
  function selected() {
    return Array.prototype.slice.call(document.querySelectorAll(".pickrow input:checked"))
      .map(function (i) { return i.value; });
  }
  // What the connected portal already holds: { "<spec id>": "2026-09-17" }.
  function installedMap() {
    var p = state && state.portal ? state.portal : null;
    if (!p) return {};
    if (p.installed_on && Object.keys(p.installed_on).length) return p.installed_on;
    var out = {};
    (p.installed || []).forEach(function (id) { out[id] = ""; });
    return out;
  }

  function covered(id) {
    var tiers = state && state.portal ? state.portal.tiers : null;
    if (!tiers) return true;
    var need = byId[id] ? byId[id][6] : "";
    if (!need) return true;
    // "sales-professional": the hub, then the level it needs. A portal one level up covers it, so this is a
    // comparison on the ladder, not a string match (an Enterprise portal was failing every Professional spec).
    var parts = String(need).split("-"), want = parts.pop(), hub = parts.join("-");
    var have = tiers[hub];
    if (!have) return true;
    return LEVELS.indexOf(have) >= LEVELS.indexOf(want);
  }
  // The authorisation screen is a full page leave and comes back on a fresh load, so the picked specs are
  // remembered here rather than asking the buyer to tick them twice.
  var SEL_KEY = "twl.install.sel";

  function saveSelection() {
    try { localStorage.setItem(SEL_KEY, JSON.stringify(selected())); } catch (e) { /* private window */ }
  }

  function restoreSelection() {
    var ids = [];
    try { ids = JSON.parse(localStorage.getItem(SEL_KEY) || "[]"); } catch (e) { ids = []; }
    if (!Array.isArray(ids) || !ids.length) return;
    ids.forEach(function (id) {
      var i = document.querySelector('.pickrow input[value="' + String(id).replace(/"/g, "") + '"]');
      if (i) i.checked = true;
    });
  }

  function syncSelection() {
    saveSelection();
    var sel = selected();
    var miss = sel.filter(function (id) { return !covered(id); });
    $("selcount").textContent = sel.length + " spec" + (sel.length === 1 ? "" : "s") + " selected";
    $("step1d").textContent = sel.length + " of " + SPECS.length + " selected";
    $("step1sel").textContent = sel.length + " selected";
    $("s1note").textContent = sel.length
      ? sel.length + " of the " + SPECS.length + " specs your licence covers."
      : "Tick the specs you want in this portal.";
    $("continue1").disabled = sel.length === 0;
    // Step 2 is locked until a spec is picked. paint() also does this, but it only runs on load and after the
    // authorisation round trip, so without these two lines ticking a spec never unlocked "Authorise a portal"
    // (found on the test portal 17/09/2026, the page was unusable).
    $("st2").classList.toggle("off", sel.length === 0);
    $("step1done").classList.toggle("done", sel.length > 0);
    var already = installedMap();
    var dupes = [];
    document.querySelectorAll(".pickrow").forEach(function (r) {
      var i = r.querySelector("input");
      r.classList.toggle("warn", i.checked && !covered(i.value));
      // Installing the same spec twice creates a second workflow of the same name: the buyer is told, and left
      // free to do it on purpose after a spec was updated (docs/ACCOUNT-AND-STATE.md).
      var on = already[i.value];
      r.classList.toggle("has", !!on);
      var tag = r.querySelector(".doneon");
      if (on && !tag) {
        tag = document.createElement("span");
        tag.className = "doneon";
        r.querySelector(".t").appendChild(tag);
      }
      if (tag) {
        tag.textContent = on ? "In this portal since " + on : "";
        tag.hidden = !on;
      }
      if (on && i.checked) dupes.push(i.value);
    });
    var dw = $("dupwarn");
    if (dw) {
      dw.hidden = dupes.length === 0;
      if (dupes.length) {
        dw.innerHTML = "<b>" + dupes.length + (dupes.length === 1 ? " spec is" : " specs are") +
          " already in this portal.</b> Installing " + (dupes.length === 1 ? "it" : "them") +
          " again creates a second workflow of the same name. Do it when a spec was updated, otherwise untick " +
          (dupes.length === 1 ? "it" : "them") + ".";
      }
    }
    var w = $("tierwarn");
    if (w) {
      w.hidden = miss.length === 0;
      if (miss.length) {
        $("tierwarnh").textContent = miss.length + " of your " + sel.length +
          " specs need a hub this portal does not have";
        $("tierwarnl").innerHTML = miss.map(function (id) {
          return "<li>" + esc(byId[id][1]) + " needs " + esc(byId[id][4]) + ".</li>";
        }).join("");
      }
    }
    paintReview();
  }

  /* -------------------------------------------------------------------- review */
  function paintReview() {
    var sel = selected(), box = $("rev");
    if (!box) return;
    box.innerHTML = sel.map(function (id) {
      var s = byId[id];
      var res = results && results[id];
      var badge = res
        ? '<span class="s2 ' + (res.status === "ok" || res.status === "installed" ? "ok" : "skip") + '">' +
          esc(res.status === "ok" || res.status === "installed" ? "Installed" : res.status === "skipped" ? "Skipped" : "Failed") + "</span>"
        : (covered(id) ? '<span class="s2 pend">Ready</span>' : '<span class="s2 skip">Will be skipped</span>');
      var line = res && res.note ? esc(res.note)
        : s[5] + (s[5] === 1 ? " action" : " actions") +
          " &#183; properties from the spec &#183; 1 workflow, switched off";
      return '<div class="revrow"><span class="t"><b>' + esc(s[1]) + '</b><span class="m2">' + line +
        "</span></span>" + badge + "</div>";
    }).join("") || '<div class="revrow"><span class="t"><b>Nothing selected yet</b><span class="m2">Pick specs in step 1.</span></span></div>';
    $("runbtn").disabled = !(state && state.portal && sel.length);
  }

  /* --------------------------------------------------------------------- paint */
  function licenceLabel(l) {
    if (!l || typeof l !== "object") return l || "";
    var t = l.tier || "";
    if (t === "full") return "Full library";
    if (t === "agency") return "Agency licence";
    if (t === "category") return "Category pack" + (l.pack ? " (" + l.pack.replace(/-/g, " ") + ")" : "");
    if (t === "free") return "Free specs";
    return t;
  }
  function paint() {
    var s = state || {};
    if (s.licence && typeof s.licence === "object") {
      var l = s.licence;
      s.order = s.order || l.id || "";
      s.date = s.date || l.order_date || "";
      if (!s.portals_max && l.portals_allowed && l.portals_allowed !== "unlimited") s.portals_max = Number(l.portals_allowed) || 0;
      if (s.portals_used == null && l.portals_used != null) s.portals_used = l.portals_used;
      s.licence = licenceLabel(l);
    }
    $("licline").innerHTML = s.licence
      ? "<b>" + esc(s.licence) + "</b><span class=\"dot\"></span>order " + esc(s.order || "") +
        '<span class="dot"></span>' + esc(s.date || "") +
        (s.portals_max ? '<span class="cnt">Portal ' + ((s.portals_used || 0) + 1) + " of " + s.portals_max + "</span>" : "")
      : "";
    $("licline").hidden = !s.licence;
    var p = s.portal;
    $("portalbox").hidden = !p;
    $("connectbox").hidden = !!p;
    if (p) {
      $("pav").textContent = (p.name || "?").split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase();
      $("pname").textContent = p.name || "Your portal";
      $("pdesc").innerHTML = esc(p.tier || "") + (p.hub_id ? ". Portal " + esc(String(p.hub_id)) + "." : "") +
        "<br>Authorised through the authorisation screen, for creating properties and workflows only.";
      $("step2st").textContent = "Connected";
    } else {
      $("step2st").textContent = "Not connected";
    }
    $("st2").classList.toggle("off", !selected().length);
    $("st3").classList.toggle("off", !p);
    $("step1done").classList.toggle("done", selected().length > 0);
    $("step2done").classList.toggle("done", !!p);
    $("step3done").classList.toggle("done", !!results);
    $("step2d").textContent = p ? (p.name + ", " + (p.tier || "")) : "Authorise a portal";
    syncSelection();
    paintReview();
  }
  /* ---------------------------------------------------------------------- boot */
  function boot() {
    if (DEMO) {
      $("demobar").hidden = false;
      FIXTURE.portal = { name: "Demo portal", tier: "Sales Hub Professional", hub_id: "00000000",
        tiers: { sales: "professional", marketing: "professional" },
        // two already in the portal, so the demo shows the badge and the duplicate warning too
        installed: [SPECS[0] && SPECS[0][0], SPECS[2] && SPECS[2][0]].filter(Boolean),
        installed_on: (function () {
          var o = {};
          if (SPECS[0]) o[SPECS[0][0]] = "2026-09-12";
          if (SPECS[2]) o[SPECS[2][0]] = "2026-09-15";
          return o;
        })() };
      Array.prototype.slice.call(document.querySelectorAll(".pickrow input"), 0, 6)
        .forEach(function (i) { i.checked = true; });
      setState(FIXTURE);
      note("instate", "Demo mode. Nothing is sent anywhere and no portal is touched.");
      syncSelection();
      return;
    }
    if (!token) {
      note("instate", "This page opens from the signed link on your receipt page or in your receipt email. Open that link and the three steps below fill in.");
      setState({});
      return;
    }
    if (!W) {
      note("instate", "The installer is not switched on yet. Your files are on your receipt page, and the install link keeps working once it is.");
      setState({});
      return;
    }
    note("instate", "Checking your licence", true);
    fetch(W + "/install/state?t=" + encodeURIComponent(token) + (sid ? "&s=" + encodeURIComponent(sid) : ""))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) throw new Error("not ok");
        setState(d);
        note("instate", "Licence checked. Pick the specs, then authorise the portal.");
      })
      .catch(function () {
        setState({});
        note("instate", "That link could not be checked. It may have expired. Ask for a fresh one with your purchase email, or write to " + (T.support || "us") + ".");
      });
  }

  function connect() {
    if (DEMO) {
      state.portal = { name: "Demo portal", tier: "Sales Hub Professional", hub_id: "00000000", tiers: { sales: "professional", marketing: "professional" } };
      paint();
      return;
    }
    if (!W || !token) return;
    note("p2note", "Opening the authorisation screen", true);
    // /install/auth answers with a 302 to HubSpot's own authorisation screen, so this has to be a page
    // navigation. Fetching it followed the redirect to app.hubspot.com, which allows no cross-origin read,
    // so the call always failed ("Could not open the authorisation screen", 17/09/2026).
    saveSelection();
    location.href = W + "/install/auth?t=" + encodeURIComponent(token);
  }

  function run() {
    var ids = selected().filter(covered);
    if (!ids.length) return;
    if (DEMO) {
      results = {};
      ids.forEach(function (id) {
        var s = byId[id];
        results[id] = { status: "installed",
          note: "properties created &#183; 1 workflow created, switched off &#183; task opened for the assets" };
      });
      selected().filter(function (id) { return !covered(id); }).forEach(function (id) {
        results[id] = { status: "skipped", note: "Skipped, this portal does not have " + byId[id][4] + "." };
      });
      finish(ids, { workflows: ids.length });
      return;
    }
    if (!W || !token) return;
    $("runbtn").disabled = true;
    note("p3note", "Creating properties and workflows", true);
    ev("install_started", { specs: ids.length, tier: (state.licence && state.licence.tier) || "" });
    // The Worker answers in NDJSON: one line per spec as it lands, then a "done" line with the totals. Reading
    // it as one JSON object never parsed (17/09/2026), so nothing ever appeared. Read the stream line by line
    // and report progress as each spec arrives.
    results = {};
    var totals = null, done = 0;
    fetch(W + "/install/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: token, s: sid, specs: ids })
    }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          throw new Error(d.message || "HTTP " + r.status);
        });
      }
      if (!r.body || !r.body.getReader) {
        // No streaming in this browser: read it whole, then split.
        return r.text().then(function (t) { t.split("\n").forEach(handleLine); });
      }
      var reader = r.body.getReader(), dec = new TextDecoder(), buf = "";
      return (function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) { buf.split("\n").forEach(handleLine); return; }
          buf += dec.decode(chunk.value, { stream: true });
          var parts = buf.split("\n");
          buf = parts.pop();
          parts.forEach(handleLine);
          return pump();
        });
      })();
    }).then(function () {
      if (!totals && !Object.keys(results).length) throw new Error("empty answer");
      ev("install_done", {
        specs: ids.length,
        installed: (totals && (totals.ok != null ? totals.ok : totals.workflows)) || 0,
        properties: (totals && totals.properties) || 0,
        manual_steps: (totals && (totals.manual_steps != null ? totals.manual_steps : totals.manual)) || 0,
        failed: (totals && totals.error) || 0,
        skipped: (totals && totals.skipped) || 0
      });
      finish(ids, totals || {});
    }).catch(function (e) {
      ev("install_failed", { specs: ids.length, reason: String(e && e.message ? e.message : "unknown").slice(0, 80) });
      $("runbtn").disabled = false;
      note("p3note", "The install stopped: " + esc(e && e.message ? e.message : "unknown error") +
        ". Nothing is switched on in your portal. Anything already created stays, and running it again skips it.");
    });

    function handleLine(raw) {
      var t = String(raw || "").trim();
      if (!t) return;
      var d;
      try { d = JSON.parse(t); } catch (e) { return; }
      if (d.event === "start") {
        note("p3note", "Creating properties and workflows in " + esc(d.portal || "your portal"), true);
        return;
      }
      if (d.event === "done") { totals = d.totals || {}; return; }
      if (d.event) return;
      if (d.id) {
        results[d.id] = d;
        done += 1;
        note("p3note", done + " of " + ids.length + " done, latest: " + esc(d.title || d.id), done < ids.length);
        paintReview();
      }
    }
  }

  function finish(ids, totals) {
    /* ids are what we asked for; every figure below comes from the Worker's answer. */
    /* the counts come from the Worker, which is the only thing that knows what it created.
       Without them the page says what it installed and leaves the rest to the per-spec cards. */
    var line = "<b>" + ids.length + "</b> " + (ids.length === 1 ? "spec" : "specs") +
      ' installed<span class="dot"></span>every workflow switched off';
    if (totals && typeof totals.properties === "number") {
      // The Worker's own field names: ok, error, skipped, properties, lists, manual_steps.
      var wf = totals.workflows != null ? totals.workflows : (totals.ok != null ? totals.ok : ids.length);
      var man = totals.manual_steps != null ? totals.manual_steps : (totals.manual || 0);
      line = "<b>" + totals.properties + "</b> " +
        (totals.properties === 1 ? "property" : "properties") + ' created<span class="dot"></span><b>' +
        wf + "</b> " + (wf === 1 ? "workflow" : "workflows") +
        ' created, every one switched off<span class="dot"></span><b>' + man + "</b> " +
        (man === 1 ? "step" : "steps") + " left for you, listed in a task per spec";
      if (totals.error) line += '<span class="dot"></span><b>' + totals.error + "</b> could not be installed";
      if (totals.skipped) line += '<span class="dot"></span><b>' + totals.skipped + "</b> skipped";
    }
    if (DEMO) line += '<span class="dot"></span>demo figures';
    $("totline").innerHTML = line;
    $("totline").hidden = false;
    $("results").innerHTML = ids.map(function (id) {
      var s = byId[id], r = results[id] || {};
      // The Worker names these manual_steps_list, link, caveats, and says status ok, skipped or error.
      var steps = r.manual_steps_list || r.manual || [];
      if (r.extra_manual_steps && r.extra_manual_steps.length) steps = steps.concat(r.extra_manual_steps);
      var task = steps.length
        ? '<div class="task"><p class="th"><span>Task created: finish ' +
          (steps.length === 1 ? "this step" : "these " + steps.length + " steps") + '</span></p><ol>' +
          steps.map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("") + "</ol></div>"
        : '<p class="nothing">Anything the installer could not create is listed in a task next to the workflow ' +
          'in the portal.</p>';
      var url = r.link || r.url || "";
      var open = url ? '<a class="btn sm" href="' + esc(url) + '" rel="noopener" target="_blank">Open it</a>' : "";
      var bad = r.status && r.status !== "ok";
      var head = bad
        ? '<p class="wf">' + esc(r.status === "skipped" ? "Skipped" : "Not installed") + ". " +
          esc(r.error || "") + "</p>"
        : '<p class="wf">' + esc(T.brand + ": " + s[1]) + " &#183; " + esc(s[3].toLowerCase()) +
          " workflow &#183; switched off</p>";
      var notes = (r.caveats && r.caveats.length)
        ? '<ul class="cav">' + r.caveats.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul>"
        : "";
      return '<div class="rescard"><div class="top"><b>' + esc(s[1]) + '</b><span class="sp"></span>' + open +
        "</div>" + head + (bad ? "" : task + notes) + "</div>";
    }).join("");
    $("resultwrap").hidden = false;
    $("step3st").textContent = "Done";
    note("p3note", "Done. Every workflow arrived switched off.");
    paint();
    $("st3").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ------------------------------------------------------------------- wiring */
  document.addEventListener("change", function (e) {
    if (e.target.closest(".pickrow")) syncSelection();
  });
  $("clearsel").addEventListener("click", function () {
    document.querySelectorAll(".pickrow input").forEach(function (i) { i.checked = false; });
    syncSelection();
  });
  document.querySelectorAll(".pickcat .lnk").forEach(function (b) {
    b.addEventListener("click", function () {
      var node = b.closest(".pickcat").nextElementSibling;
      while (node && node.classList.contains("pickrow")) {
        node.querySelector("input").checked = true;
        node = node.nextElementSibling;
      }
      syncSelection();
    });
  });
  $("iq").addEventListener("input", function (e) {
    var q = e.target.value.trim().toLowerCase();
    document.querySelectorAll(".pickrow").forEach(function (r) {
      r.hidden = q ? r.textContent.toLowerCase().indexOf(q) < 0 : false;
    });
    document.querySelectorAll(".pickcat").forEach(function (h) {
      var node = h.nextElementSibling, any = false;
      while (node && node.classList.contains("pickrow")) { if (!node.hidden) any = true; node = node.nextElementSibling; }
      h.hidden = !any;
    });
  });
  $("continue1").addEventListener("click", function () {
    syncSelection();
    $("st2").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("connectbtn").addEventListener("click", connect);
  var again = $("reconnect");
  if (again) again.addEventListener("click", connect);
  $("continue2").addEventListener("click", function () { $("st3").scrollIntoView({ behavior: "smooth", block: "start" }); });
  $("runbtn").addEventListener("click", run);
  boot();
  restoreSelection();
  syncSelection();
})();
