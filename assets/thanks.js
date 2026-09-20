/* The Workflow Library: the receipt page.
   Reads the purchase from the Worker ({worker}/session?s=<id>) and shows the download, the
   install link when the licence carries one, and the upgrade code when there is one.
   With ?demo=1 it paints a fixture and calls nothing. */
(function () {
  "use strict";
  var T = window.TWL || {};
  var $ = function (id) { return document.getElementById(id); };
  var qs = new URLSearchParams(location.search);
  // The head script moves ?s out of the address bar before any tracker sees it (E21), so read the stash too.
  var stash = function (k) { try { return sessionStorage.getItem("twl_" + k) || ""; } catch (e) { return ""; } };
  var s = qs.get("s") || stash("s");
  var DEMO = qs.get("demo") === "1";
  var dl = $("dl"), note = $("dl-note");

  function put(id, v) { var e = $(id); if (e) e.textContent = v; }
  function fail(msg) {
    note.textContent = msg;
    dl.hidden = true;
    put("thx-st", "Not found");
  }
  function money(cents, cur) {
    try {
      return (cents / 100).toLocaleString("en", { style: "currency", currency: (cur || "eur").toUpperCase() });
    } catch (e) { return (cents / 100) + " " + (cur || "EUR").toUpperCase(); }
  }

  function paint(d) {
    put("thx-st", d.live === false ? "Verified (test)" : "Verified");
    put("o-product", d.product || d.tier || "");
    put("o-desc", d.description || "");
    put("o-amount", typeof d.amount_total === "number"
      ? money(d.amount_total, d.currency) + (d.amount_tax ? " (incl. " + money(d.amount_tax, d.currency) + " VAT)" : "")
      : "");
    put("o-email", d.email || "");
    if (d.product) {
      put("thx-h1", "Your " + String(d.product).toLowerCase() + " is ready");
    }
    // The purchase is the one conversion that matters. Sent once, on a receipt the Worker confirmed as paid.
    if (d.paid && window.gtag) {
      try {
        window.gtag("event", "purchase", {
          transaction_id: "o_" + String(s || "").split("").reduce(function (h, c) { return ((h << 5) - h + c.charCodeAt(0)) | 0; }, 0).toString(36), // hashed: the raw session id opens the download
          value: (d.amount_total || 0) / 100,
          currency: String(d.currency || "eur").toUpperCase(),
          tier: d.tier || "",
          pack: d.pack || "",
          price_step: d.step || "",
          installer_included: d.install_token ? 1 : 0
        });
      } catch (e) { /* measurement must never break a receipt */ }
    }
    // D025 (20/09/2026): Studio rents portals and Extra portal is a credit. Neither ships files, so the
    // download button and the zip contents would send the buyer to a 404 from the Worker.
    var NO_FILES = d.tier === "studio" || d.tier === "extra_portal";
    if (NO_FILES) {
      dl.hidden = true;
      if ($("zip-what")) $("zip-what").hidden = true;
      if ($("zip-what-h")) $("zip-what-h").hidden = true;
      put("thx-dlnote", d.tier === "studio"
        ? "Studio adds portals to the library you already own. There is nothing to download here: your install link is below, and the files stay with your library purchase."
        : "The extra portal is now on your licence. There is nothing to download here: use the install link from your library purchase, and the new portal is simply allowed.");
    }
    if (d.tier === "agency_lifetime") put("o-refund", "14 days, while at most 3 portals are activated");
    if (d.install_token) {
      var href = "/install/?t=" + encodeURIComponent(d.install_token);
      var b = $("thx-instbtn");
      b.hidden = false;
      b.setAttribute("href", href);
      b.textContent = (d.tier === "agency" || d.tier === "agency_lifetime") ? "Install in a client portal" : "Install in your portal";
      $("thx-linkbox").hidden = false;
      put("thx-link", location.origin.replace(/^https?:\/\//, "") + href);
      $("thx-instcopy").hidden = false;
      put("thx-sub", NO_FILES
        ? "Your install link lives on this page and arrives by email, so you can close this tab."
        : "Two things live on this page: the download, and your install link. Both also arrive by email, so you can close this tab.");
    } else if (d.tier === "category") {
      $("thx-blocked").hidden = false;
    }
    if (d.upgrade_code) {
      $("thx-upg").hidden = false;
      put("thx-upgcode", d.upgrade_code);
    }
    if (d.tier === "agency") $("agency-note").hidden = false;
    if (d.tier === "agency_lifetime") note.textContent = "Unbranded files, unlimited portals, unlimited seats, one legal entity.";
    else if (NO_FILES) note.textContent = "";
    else if (d.pack) note.textContent = "The file is " + d.pack + ".";
    else note.textContent = "";
  }

  if (DEMO) {
    $("demobar").hidden = false;
    dl.setAttribute("href", "#");
    paint({
      live: false, paid: true, tier: "full", product: "Full library",
      description: "500 specs, all ten categories", amount_total: 14900, amount_tax: 0,
      currency: "eur", email: "buyer@example.com", pack: "twl-full-library.zip",
      install_token: "demo-token"
    });
    note.textContent = "Demo data. Nothing was looked up.";
    return;
  }
  if (!s) {
    return fail("No purchase found in this link. Open the page from your Stripe confirmation, or write to "
      + (T.support || "us") + " with your receipt.");
  }
  if (!T.worker) {
    return fail("Downloads open shortly after launch. Keep your receipt: every buyer gets the pack by email within 24 hours.");
  }
  dl.setAttribute("href", T.worker + "/download?s=" + encodeURIComponent(s));
  // La bibliothèque complète et la licence agence dépassent la taille d'un objet du stockage : elles arrivent
  // en plusieurs fichiers. Le Worker répond alors un JSON de parties au lieu du zip, et on affiche un bouton par partie.
  fetch(T.worker + "/download?s=" + encodeURIComponent(s), { headers: { Accept: "application/json" } })
    .then(function (r) { return r.headers.get("Content-Type").indexOf("json") > -1 ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.parts || !d.parts.length) return;
      var box = dl.parentNode;
      dl.textContent = "Download part 1 of " + d.parts.length + " (.zip)";
      dl.setAttribute("href", d.parts[0].url);
      for (var i = 1; i < d.parts.length; i++) {
        var a2 = document.createElement("a");
        a2.className = "btn lg"; a2.href = d.parts[i].url;
        a2.setAttribute("data-cta", "thanks-download-part");
        a2.textContent = "Download part " + (i + 1) + " of " + d.parts.length + " (.zip)";
        box.appendChild(a2);
      }
    })
    .catch(function () {});
  note.innerHTML = '<span class="spin"></span> Checking your purchase...';
  fetch(T.worker + "/session?s=" + encodeURIComponent(s))
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      if (!d.paid) return fail("This purchase is not confirmed yet. Refresh in a minute, or write to " + (T.support || "us") + ".");
      paint(d);
    })
    .catch(function () {
      note.textContent = "Could not load the order summary. The download button still works.";
      put("thx-st", "Unverified");
    });
})();
