/* The Workflow Library: the receipt page.
   Reads the purchase from the Worker ({worker}/session?s=<id>) and shows the download, the
   install link when the licence carries one, and the upgrade code when there is one.
   With ?demo=1 it paints a fixture and calls nothing. */
(function () {
  "use strict";
  var T = window.TWL || {};
  var $ = function (id) { return document.getElementById(id); };
  var qs = new URLSearchParams(location.search);
  var s = qs.get("s") || "";
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
    if (d.install_token) {
      var href = "/install/?t=" + encodeURIComponent(d.install_token);
      var b = $("thx-instbtn");
      b.hidden = false;
      b.setAttribute("href", href);
      b.textContent = d.tier === "agency" ? "Install in a client portal" : "Install in your portal";
      $("thx-linkbox").hidden = false;
      put("thx-link", location.origin.replace(/^https?:\/\//, "") + href);
      $("thx-instcopy").hidden = false;
      put("thx-sub", "Two things live on this page: the download, and your install link. Both also arrive by email, so you can close this tab.");
    } else if (d.tier === "category") {
      $("thx-blocked").hidden = false;
    }
    if (d.upgrade_code) {
      $("thx-upg").hidden = false;
      put("thx-upgcode", d.upgrade_code);
    }
    if (d.tier === "agency") $("agency-note").hidden = false;
    if (d.pack) note.textContent = "The file is " + d.pack + ".";
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
