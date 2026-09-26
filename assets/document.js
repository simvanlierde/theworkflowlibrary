/* Document a portal, entirely in the browser (26/09/2026).

   An agency dropping a client's workflow export is handing over client data. So none of it leaves the
   machine: the zip is read with JSZip in the page, converted here, and written back out as a zip. No
   upload, no server, no account. That is both the honest design and the only one this audience accepts.

   Input: a zip of HubSpot v4 flow JSON, which is what the browser extensions produce and what
   GET /automation/v4/flows returns. Output: one markdown fiche per workflow, in the library's format,
   plus an index.

   This is a faithful port of ops/fiche-from-flow.py. Keep the two in step. */
(function () {
  "use strict";
  var drop = document.getElementById("drop");
  if (!drop) return;

  var ACTIONS = {
    "0-1": "Delay", "0-2": "Send email", "0-3": "Create task", "0-4": "Send marketing email",
    "0-5": "Set property value", "0-7": "Branch on a list condition", "0-8": "Send internal email",
    "0-9": "Send in-app notification", "0-11": "Rotate record to owner", "0-13": "Custom code",
    "0-14": "Create record", "0-15": "Set a marketing contact status",
    "0-17": "Add to or remove from a static list", "0-18": "Remove from a static list",
    "0-25": "Copy property value", "0-28": "Enrol in a sequence",
    "0-29": "Wait for an event", "0-31": "Send an SMS or WhatsApp message",
    "0-35": "Delay until a date", "0-63809083": "Add to a static list",
    "1-67": "Send a marketing email", "1-179507819": "Send a Slack message"
  };
  var OBJECTS = { "0-1": "contact", "0-2": "company", "0-3": "deal", "0-5": "ticket",
    "0-8": "line item", "0-101": "quote", "0-48": "call", "0-27": "task" };
  var OPS = {
    IS_KNOWN: "is known", IS_UNKNOWN: "is unknown", IS_EQUAL_TO: "is", IS_NOT_EQUAL_TO: "is not",
    IS_ANY_OF: "is any of", IS_NONE_OF: "is none of", CONTAINS: "contains",
    DOES_NOT_CONTAIN: "does not contain", STARTS_WITH: "starts with", ENDS_WITH: "ends with",
    IS_GREATER_THAN: "is more than", IS_LESS_THAN: "is less than", IS_AFTER: "is after",
    IS_BEFORE: "is before", IS_BETWEEN: "is between", HAS_EVER_BEEN_ANY_OF: "has ever been any of",
    HAS_NEVER_BEEN_ANY_OF: "has never been", IS_IN_LIST: "is in the list",
    IS_NOT_IN_LIST: "is not in the list"
  };

  function humanFilter(f) {
    var prop = f.property || f.propertyName || "?";
    var op = f.operation || {};
    var name = OPS[op.operator] || String(op.operator || "matches").toLowerCase().replace(/_/g, " ");
    var vals = op.values || (op.value != null ? [op.value] : []);
    var tp = op.timePoint || {};
    if (tp.property) return "`" + prop + "` " + name + " `" + tp.property + "`";
    if (vals.length) {
      var shown = vals.slice(0, 4).map(function (v) { return "`" + v + "`"; }).join(", ");
      return "`" + prop + "` " + name + " " + shown + (vals.length > 4 ? " and " + (vals.length - 4) + " more" : "");
    }
    return "`" + prop + "` " + name;
  }

  function humanBranch(fb) {
    if (!fb) return [];
    var out = (fb.filters || []).map(humanFilter);
    (fb.filterBranches || []).forEach(function (sub) {
      var inner = humanBranch(sub);
      if (!inner.length) return;
      /* a sub-branch joins with ITS operator, not the parent's: an AND group inside an OR wrapper is
         the normal HubSpot shape, and reading it as OR inverts the criteria */
      var joiner = " " + String(sub.filterBranchOperator || "AND").toLowerCase() + " ";
      out.push(inner.length === 1 ? inner[0] : "(" + inner.join(joiner) + ")");
    });
    return out;
  }

  function propertiesUsed(flow) {
    var found = {};
    (function walk(o) {
      if (!o) return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (typeof o === "object") {
        Object.keys(o).forEach(function (k) {
          var v = o[k];
          if (["property", "propertyName", "property_name", "target_property"].indexOf(k) >= 0
              && typeof v === "string") found[v] = 1;
          if (k === "owner_properties" && Array.isArray(v))
            v.forEach(function (x) { if (typeof x === "string") found[x] = 1; });
          walk(v);
        });
      }
    })(flow);
    return Object.keys(found).sort();
  }

  function actionLine(a) {
    var tid = String(a.actionTypeId || ""), f = a.fields || {}, kind = String(a.type || "");
    if (kind === "STATIC_BRANCH") {
      var n = (a.staticBranches || a.listBranches || []).length;
      return "**Branch** on a value, into " + (n || "several") + " fixed paths";
    }
    if (kind === "WEBHOOK") return "**Send a webhook** to an external URL";
    if (a.listBranches != null) {
      var names = a.listBranches.map(function (b) { return "*" + (b.branchName || "?") + "*"; });
      return "**Branch** into " + (names.length + 1) + " paths: " + names.join(", ")
        + ", and *" + (a.defaultBranchName || "everything else") + "*";
    }
    var label = ACTIONS[tid] || ("Action " + tid);
    if (tid === "0-1") return "**Delay** " + (f.delta || "?") + " " + String(f.time_unit || "").toLowerCase();
    if (tid === "0-5") {
      var v = f.value || {};
      return "**Set property value**, `" + (f.property_name || "?") + "` to `"
        + (typeof v === "object" ? v.staticValue : v) + "`";
    }
    if (tid === "0-25") return "**Copy property value** into `" + (f.target_property || "?") + "`";
    if (tid === "0-3") return "**Create task**, " + String(f.task_type || "todo").toLowerCase()
      + ': "' + String(f.subject || "").slice(0, 80) + '"';
    if (tid === "0-8" || tid === "0-9") return "**" + label + '**: "' + String(f.subject || "").slice(0, 80) + '"';
    if (tid === "0-11") return "**Rotate record to owner** across the pool on this branch";
    if (kind === "CUSTOM_CODE" || tid === "0-13") return "**Custom code**, a coded action to read on its own";
    return "**" + label + "**";
  }

  function walkSteps(flow) {
    var byId = {}, seen = {}, out = [];
    (flow.actions || []).forEach(function (a) { byId[String(a.actionId)] = a; });
    (function walk(aid, depth, label) {
      aid = String(aid || "");
      if (!aid || seen[aid] || !byId[aid]) return;
      seen[aid] = 1;
      var a = byId[aid];
      out.push({ a: a, depth: depth, label: label });
      (a.listBranches || []).forEach(function (b) {
        walk((b.connection || {}).nextActionId, depth + 1, b.branchName || "match");
      });
      if (a.defaultBranch)
        walk(a.defaultBranch.nextActionId, depth + 1, a.defaultBranchName || "everything else");
      walk((a.connection || {}).nextActionId, depth, "");
    })(flow.startActionId, 0, "");
    Object.keys(byId).forEach(function (aid) {
      if (!seen[aid]) out.push({ a: byId[aid], depth: 0, label: "unreachable from the start" });
    });
    return out;
  }

  function mermaid(flow) {
    var byId = {}, lines = ["flowchart TD", "  start([Enrolled])"];
    (flow.actions || []).forEach(function (a) { byId[String(a.actionId)] = a; });
    if (flow.startActionId) lines.push("  start --> A" + flow.startActionId);
    Object.keys(byId).forEach(function (aid) {
      var a = byId[aid], txt = actionLine(a).replace(/[*`"]/g, "");
      if (txt.length > 46) txt = txt.slice(0, 46).replace(/\s\S*$/, "") + "...";
      lines.push(a.listBranches != null ? "  A" + aid + "{" + txt + "}" : '  A' + aid + '["' + txt + '"]');
      (a.listBranches || []).forEach(function (b) {
        var n = (b.connection || {}).nextActionId;
        if (n) lines.push("  A" + aid + " -->|" + (b.branchName || "yes") + "| A" + n);
      });
      var d = (a.defaultBranch || {}).nextActionId;
      if (d) lines.push("  A" + aid + " -->|" + (a.defaultBranchName || "else") + "| A" + d);
      var nx = (a.connection || {}).nextActionId;
      if (nx) lines.push("  A" + aid + " --> A" + nx);
    });
    return lines.join("\n");
  }

  function toFiche(flow) {
    var name = flow.name || "Untitled workflow";
    var obj = OBJECTS[String(flow.objectTypeId)] || String(flow.objectTypeId);
    var steps = walkSteps(flow), props = propertiesUsed(flow);
    var enrol = flow.enrollmentCriteria || {};
    var clauses = humanBranch(enrol.listFilterBranch);
    var retrigs = [];
    (enrol.reEnrollmentTriggersFilterBranches || []).forEach(function (fb) {
      retrigs = retrigs.concat(humanBranch(fb));
    });
    var branches = steps.filter(function (s) { return s.a.listBranches != null; }).length;
    var L = [];
    L.push("---", 'title: "' + name.replace(/"/g, "'") + '"', "object: " + obj,
      "actions: " + steps.length, "properties: " + props.length,
      "source: portal export, flow " + (flow.id || "unknown"),
      "generated: theworkflowlibrary.com, in your browser", "---", "");
    L.push("# " + name, "");
    L.push("**What it does.** " + steps.length + " actions on the " + obj + " object"
      + (branches ? ", branching " + branches + " time" + (branches > 1 ? "s" : "") : "")
      + ", touching " + props.length + " propert" + (props.length === 1 ? "y" : "ies") + "."
      + (flow.isEnabled ? " Currently switched on." : " Currently switched off."), "");
    L.push("## When to use it / when not to", "");
    L.push("> TO WRITE. Nothing in the export says why this workflow exists or when it is the wrong",
      "> tool. That judgement lives with whoever built it.", "");
    L.push("## Prerequisites", "");
    if (props.length) props.forEach(function (p) {
      L.push("- Property `" + p + "`, on the " + obj + " object. Read or written by this workflow.");
    });
    else L.push("- No properties are read or written by this workflow.");
    L.push("");
    L.push("## Enrollment", "");
    L.push("- Trigger: " + (clauses.length ? "list-based" : "manual or event-based") + ", on the " + obj + " object.");
    if (clauses.length) {
      L.push("- Criteria, joined with " + ((enrol.listFilterBranch || {}).filterBranchOperator || "AND") + ":");
      clauses.forEach(function (c) { L.push("  - " + c); });
    }
    L.push("- Re-enrolment: " + (enrol.shouldReEnroll ? "on" : "off") + "."
      + (retrigs.length ? " Re-triggers when: " + retrigs.join("; ") : ""));
    if ((flow.suppressionListIds || []).length)
      L.push("- Suppression: " + flow.suppressionListIds.length + " list(s) excluded on the trigger.");
    L.push("");
    L.push("## Steps", "");
    var n = 0;
    steps.forEach(function (s) {
      var pad = new Array(s.depth + 1).join("    ");
      if (s.label) L.push(pad + "- *on the " + s.label + " path:*");
      n++;
      L.push(pad + n + ". " + actionLine(s.a));
    });
    L.push("");
    L.push("## Diagram", "", "```mermaid", mermaid(flow), "```", "");
    L.push("## Known pitfalls", "", "> TO WRITE. The export records what the workflow does, never what",
      "> goes wrong with it.", "");
    L.push("## Test plan", "", "> TO WRITE. What to enrol and what you should see cannot be derived",
      "> from the structure.", "");
    L.push("## Variants", "", "> TO WRITE.", "");
    L.push("## Build spec", "");
    L.push("- Flow type: `" + (flow.flowType || "?") + "` / `" + (flow.type || "?") + "`");
    L.push("- Object: `" + flow.objectTypeId + "` (" + obj + ")");
    L.push("- Enabled in the source portal: " + !!flow.isEnabled);
    L.push("");
    return { md: L.join("\n"), name: name, actions: steps.length, props: props.length,
             documented: !!(clauses.length && steps.length), obj: obj };
  }

  /* ------------------------------------------------------------------ the page itself */
  var fileIn = document.getElementById("file");
  var out = document.getElementById("out");
  var stats = document.getElementById("stats");
  var preview = document.getElementById("preview");
  var dlBtn = document.getElementById("dl");
  var status = document.getElementById("status");
  var made = null;

  function say(t, kind) {
    status.textContent = t;
    status.className = "status" + (kind ? " " + kind : "");
  }
  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "workflow";
  }

  async function handle(file) {
    if (!window.JSZip) { say("The zip reader did not load. Reload the page and try again.", "bad"); return; }
    say("Reading " + file.name + ", in this browser...");
    out.hidden = true;
    var zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (e) {
      say("That did not open as a zip. Drop the .zip your export tool produced.", "bad");
      return;
    }
    var names = Object.keys(zip.files).filter(function (n) {
      return /\.json$/i.test(n) && !zip.files[n].dir && !/^__MACOSX/.test(n);
    });
    if (!names.length) { say("No JSON files inside that zip.", "bad"); return; }
    say("Documenting " + names.length + " workflows...");
    var fiches = [], failed = 0;
    for (var i = 0; i < names.length; i++) {
      try {
        var flow = JSON.parse(await zip.files[names[i]].async("string"));
        if (!flow || !flow.actions) { failed++; continue; }
        fiches.push(toFiche(flow));
      } catch (e) { failed++; }
      if (i % 25 === 0) say("Documenting " + (i + 1) + " of " + names.length + "...");
    }
    if (!fiches.length) { say("Nothing in that zip looked like a HubSpot workflow.", "bad"); return; }
    made = fiches;

    var docd = fiches.filter(function (f) { return f.documented; }).length;
    var acts = fiches.reduce(function (s, f) { return s + f.actions; }, 0);
    stats.innerHTML = ""
      + cell(fiches.length, "workflows read")
      + cell(docd + " / " + fiches.length, "with criteria and steps")
      + cell(acts, "actions described")
      + cell(failed, "files we could not parse");
    preview.textContent = fiches[0].md;
    out.hidden = false;
    say("Done. " + fiches.length + " fiches, and nothing left this browser.", "good");
    if (window.gtag) window.gtag("event", "vault_document", { workflows: fiches.length });
  }
  function cell(b, k) {
    return '<div class="st"><b>' + b + '</b><span>' + k + "</span></div>";
  }

  async function download() {
    if (!made) return;
    var zip = new JSZip();
    var index = ["# Workflow documentation", "",
      "Generated from a portal export by theworkflowlibrary.com, in the browser. " + made.length
      + " workflows.", "",
      "Four sections of every fiche are marked TO WRITE: when to use it, the known pitfalls, the test",
      "plan and the variants. No export contains them; they are judgement, and they are what a written",
      "spec adds on top of a copy.", "",
      "| Workflow | Object | Actions | Properties |", "| --- | --- | --- | --- |"];
    var used = {};
    made.forEach(function (f) {
      var base = slug(f.name);
      used[base] = (used[base] || 0) + 1;
      var fn = base + (used[base] > 1 ? "-" + used[base] : "") + ".md";
      zip.file("fiches/" + fn, f.md);
      index.push("| [" + f.name.replace(/\|/g, "-") + "](fiches/" + fn + ") | " + f.obj + " | "
        + f.actions + " | " + f.props + " |");
    });
    zip.file("INDEX.md", index.join("\n"));
    var blob = await zip.generateAsync({ type: "blob" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "workflow-documentation.zip";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    if (window.gtag) window.gtag("event", "vault_document_download", { workflows: made.length });
  }

  ["dragenter", "dragover"].forEach(function (e) {
    drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (e) {
    drop.addEventListener(e, function (ev) { ev.preventDefault(); drop.classList.remove("over"); });
  });
  drop.addEventListener("drop", function (ev) {
    var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) handle(f);
  });
  drop.addEventListener("click", function () { fileIn.click(); });
  drop.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileIn.click(); }
  });
  fileIn.addEventListener("change", function () {
    if (fileIn.files && fileIn.files[0]) handle(fileIn.files[0]);
  });
  dlBtn.addEventListener("click", download);
})();
