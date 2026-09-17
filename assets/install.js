/* The Workflow Library: the install page.
   Static shell, three steps, vanilla JS. It talks to the install Worker and to nothing else:
   the install bodies are paid content and never leave the Worker's private storage, so this
   page never fetches an install index or a workflow payload from the site.
     endpoints (config.hubspot.install_worker):
     GET  /install/state?t=<token>   licence, portal, which specs the licence covers
     GET  /install/auth?t=<token>    returns { url } to send the buyer to the authorisation screen
     POST /install/run               { t, ids } -> per spec result
   With ?demo=1 the page runs on the fixture below and calls nothing. */
(function () {
  "use strict";
  var T = window.TWL || {};
  var W = T.installWorker || "";
  var SPECS = window.TWL_INSTALL || [];
  var $ = function (id) { return document.getElementById(id); };
  var qs = new URLSearchParams(location.search);
  var token = qs.get("t") || "";
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

  function setState(s) { state = s; paint(); }
  function note(el, msg, spin) {
    var e = $(el);
    if (e) e.innerHTML = (spin ? '<span class="spin"></span> ' : "") + esc(msg);
  }

  /* ----------------------------------------------------------------- selection */
  function selected() {
    return Array.prototype.slice.call(document.querySelectorAll(".pickrow input:checked"))
      .map(function (i) { return i.value; });
  }
  function covered(id) {
    if (!state || !state.portal || !state.portal.hubs) return true;
    var need = byId[id] ? byId[id][6] : "";
    if (!need) return true;
    return state.portal.hubs.indexOf(need) > -1;
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
    document.querySelectorAll(".pickrow").forEach(function (r) {
      var i = r.querySelector("input");
      r.classList.toggle("warn", i.checked && !covered(i.value));
    });
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
        ? '<span class="s2 ' + (res.status === "installed" ? "ok" : "skip") + '">' + esc(res.status === "installed" ? "Installed" : "Skipped") + "</span>"
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
    syncSelectionLight();
    paintReview();
  }
  function syncSelectionLight() {
    var sel = selected();
    $("step1d").textContent = sel.length + " of " + SPECS.length + " selected";
  }

  /* ---------------------------------------------------------------------- boot */
  function boot() {
    if (DEMO) {
      $("demobar").hidden = false;
      FIXTURE.portal = { name: "Demo portal", tier: "Sales Hub Professional", hub_id: "00000000", hubs: ["sales-professional", "marketing-professional"] };
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
    fetch(W + "/install/state?t=" + encodeURIComponent(token))
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
      state.portal = { name: "Demo portal", tier: "Sales Hub Professional", hub_id: "00000000", hubs: ["sales-professional", "marketing-professional"] };
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
    fetch(W + "/install/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: token, ids: ids })
    }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        results = {};
        (d.results || []).forEach(function (r) { results[r.id] = r; });
        finish(ids, d.totals);
      })
      .catch(function () {
        $("runbtn").disabled = false;
        note("p3note", "The install did not complete. Nothing is switched on in your portal. Try again, or write to " + (T.support || "us") + ".");
      });
  }

  function finish(ids, totals) {
    /* ids are what we asked for; every figure below comes from the Worker's answer. */
    /* the counts come from the Worker, which is the only thing that knows what it created.
       Without them the page says what it installed and leaves the rest to the per-spec cards. */
    var line = "<b>" + ids.length + "</b> " + (ids.length === 1 ? "spec" : "specs") +
      ' installed<span class="dot"></span>every workflow switched off';
    if (totals && typeof totals.properties === "number") {
      line = "<b>" + totals.properties + "</b> " +
        (totals.properties === 1 ? "property" : "properties") + ' created<span class="dot"></span><b>' +
        (totals.workflows != null ? totals.workflows : ids.length) + "</b> " +
        ((totals.workflows === 1 || ids.length === 1) ? "workflow" : "workflows") +
        ' created, every one switched off<span class="dot"></span><b>' + (totals.manual || 0) + "</b> " +
        (totals.manual === 1 ? "step" : "steps") + " left for you, listed in a task per spec";
    }
    if (DEMO) line += '<span class="dot"></span>demo figures';
    $("totline").innerHTML = line;
    $("totline").hidden = false;
    $("results").innerHTML = ids.map(function (id) {
      var s = byId[id], r = results[id] || {};
      var task = (r.manual && r.manual.length)
        ? '<div class="task"><p class="th"><span>Task created: finish these ' + r.manual.length + ' steps</span></p><ol>' +
          r.manual.map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("") + "</ol></div>"
        : '<p class="nothing">Anything the installer could not create is listed in a task next to the workflow ' +
          'in the portal.</p>';
      var open = r.url ? '<a class="btn sm" href="' + esc(r.url) + '" rel="noopener" target="_blank">Open it</a>' : "";
      return '<div class="rescard"><div class="top"><b>' + esc(s[1]) + '</b><span class="sp"></span>' + open +
        '</div><p class="wf">' + esc(T.brand + ": " + s[1]) + " &#183; " + esc(s[3].toLowerCase()) +
        " workflow &#183; switched off</p>" + task + "</div>";
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
