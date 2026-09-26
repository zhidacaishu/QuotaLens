/* QuotaLens — content script (ISOLATED world)
 *
 * Calls Claude's own usage API directly (no waiting, no sniffing):
 *   GET /api/organizations                  -> find org uuid (chat capability)
 *   GET /api/organizations/{uuid}/usage     -> { five_hour:{utilization,resets_at},
 *                                                seven_day:{utilization,resets_at} }
 *
 * Renders two meters ("5 Hrs", "Weekly") just above the composer. Fetches on
 * load, re-polls every pollSeconds while the tab is visible, refreshes on
 * tab-focus, and force-refreshes right after a response finishes streaming.
 * Last values are cached so the bar shows instantly on the next page load.
 */
(function () {
  "use strict";

  var TAG = "[UsageMeter]";
  var BAR_ID = "cum-bar";
  var ORG_TTL = 10 * 60 * 1000; // re-resolve org id at most every 10 min
  var provider = UsageProviders.identify(location.href);
  if (!provider) return;
  var providerLabel = UsageProviders.labels[provider];
  var scope = providerScope(), account = null, lastAttempt = 0, retryAt = 0, rateLimited = false, errorText = "";

  function providerScope() {
    if (provider !== "gemini") return provider;
    try { return "gemini:" + UsageProviders.geminiAccount(location.href); }
    catch (_) { return "gemini:unknown"; }
  }

  var DEFAULTS = {
    pollSeconds: 15,   // live-ish refresh while tab is visible
    geminiPollMinutes: 5, // idle fallback; also refresh after a reply completes
    debug: false,
    hidden: false,     // full hide (popup only)
    collapsed: false,  // minimized to a small restore chip
    staleMinutes: 10
  };

  var cfg = shallow(DEFAULTS);
  var usage = null;          // { five:{pct,resetMs}|null, weekly:{...}|null, at }
  var status = "loading";    // loading | ok | empty | error
  var orgId = null, orgIdAt = 0, orgInFlight = null;
  var usageInFlight = null;
  var pollTimer = null, uiTimer = null;

  function shallow(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }
  function log() { if (cfg.debug) { try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch (_) {} } }

  /* ----------------------------- storage ----------------------------- */
  function loadAll() {
    return new Promise(function (res) {
      chrome.storage.local.get(["cfg", "usage", "orgId", "orgIdAt"], function (d) {
        if (d.cfg) {
          var stored = d.cfg;
          cfg = Object.assign(shallow(DEFAULTS), stored);
          // migrate older "✕ = hidden with no way back" state
          if (typeof stored.collapsed === "undefined" && cfg.hidden) {
            cfg.hidden = false;
            chrome.storage.local.set({ cfg: cfg });
          }
        }
        // Legacy cache belongs only to Claude. New providers keep readings in
        // this tab's memory so account changes cannot reuse disk-cached data.
        if (provider === "claude" && d.usage) { usage = d.usage; status = (usage.five || usage.weekly) ? "ok" : status; }
        if (provider === "claude" && d.orgId) { orgId = d.orgId; orgIdAt = d.orgIdAt || 0; }
        res();
      });
    });
  }

  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== "local" || !ch.cfg) return;
    cfg = Object.assign(shallow(DEFAULTS), ch.cfg.newValue || {});
    restartPolling();
    render();
  });

  // popup <-> content
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    if (msg.type === "cum-poll") { loadUsage(true).then(function () { sendResponse({ ok: status === "ok", status: status }); }); return true; }
    if (msg.type === "cum-status") { sendResponse({ provider: providerLabel, hasData: !!(usage && (usage.five || usage.weekly)), at: usage && usage.at, status: status, error: errorText, cfg: cfg }); return true; }
  });

  /* --------------------------- API calls ----------------------------- */
  function getOrgId() {
    if (orgId && Date.now() - orgIdAt < ORG_TTL) return Promise.resolve(orgId);
    if (orgInFlight) return orgInFlight;
    orgInFlight = fetch("/api/organizations", { credentials: "include", headers: { Accept: "application/json" }, cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("orgs " + r.status); return r.json(); })
      .then(function (orgs) {
        if (!Array.isArray(orgs) || !orgs.length) throw new Error("no orgs");
        var org = null;
        for (var i = 0; i < orgs.length; i++) {
          if (orgs[i] && orgs[i].capabilities && orgs[i].capabilities.indexOf("chat") > -1) { org = orgs[i]; break; }
        }
        if (!org) org = orgs[0];
        var id = org.uuid || org.id;
        if (!id) throw new Error("no org id");
        orgId = id; orgIdAt = Date.now();
        try { chrome.storage.local.set({ orgId: orgId, orgIdAt: orgIdAt }); } catch (_) {}
        return id;
      })
      .then(function (id) { orgInFlight = null; return id; }, function (e) { orgInFlight = null; throw e; });
    return orgInFlight;
  }

  function loadUsage(force, afterGeneration) {
    if (provider !== "claude") return loadProviderUsage(force, afterGeneration);
    if (usageInFlight) return usageInFlight;
    if (!usage) { status = "loading"; render(); }
    usageInFlight = getOrgId()
      .then(function (id) {
        return fetch("/api/organizations/" + id + "/usage", { credentials: "include", headers: { Accept: "application/json" }, cache: "no-store" });
      })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error("auth " + r.status);
        if (!r.ok) throw new Error("usage " + r.status);
        return r.json();
      })
      .then(function (data) {
        log("usage payload:", data);
        usage = parseUsage(data);
        status = (usage.five || usage.weekly) ? "ok" : "empty";
        try { chrome.storage.local.set({ usage: usage }); } catch (_) {}
        render();
      })
      .catch(function (err) {
        log("loadUsage error:", err);
        // If the org id might be stale, drop it so the next try re-resolves.
        if (("" + err).indexOf("usage 4") > -1) { orgId = null; }
        if (!usage) { status = ("" + err).indexOf("auth") > -1 ? "error" : "error"; render(); }
      })
      .then(function () { usageInFlight = null; });
    return usageInFlight;
  }

  function loadProviderUsage(force, afterGeneration) {
    if (provider === "gemini" && UsageProviders.isGeminiUsage(location.href)) return Promise.resolve();
    if (usageInFlight) return afterGeneration ? usageInFlight.then(function () { return loadUsage(false, true); }) : usageInFlight;
    var now = Date.now();
    if ((now < retryAt && (!force || rateLimited)) || (!force && !afterGeneration && provider === "gemini" && now - lastAttempt < geminiInterval())) return Promise.resolve();
    var requestedScope = scope;
    lastAttempt = now;
    if (!usage) status = "loading";
    render();
    // Initialization errors must enter the same error path as network failures;
    // otherwise a missing adapter leaves the UI stuck on Loading forever.
    var request = Promise.resolve().then(function () {
      if (provider === "codex") return UsageProviders.fetchCodex(function (nextAccount) {
        if (account !== nextAccount) { account = nextAccount; usage = null; render(); }
      });
      if (!globalThis.UsageGemini || typeof globalThis.UsageGemini.fetchUsage !== "function") {
        throw new Error("Gemini adapter failed to initialize. Reload the extension and this page.");
      }
      return globalThis.UsageGemini.fetchUsage();
    });
    usageInFlight = request.then(function (data) {
      if (requestedScope !== scope) return;
      usage = data;
      status = data && (data.five || data.weekly) ? "ok" : "empty";
      errorText = ""; retryAt = 0; rateLimited = false;
      render();
    }).catch(function (error) {
      if (requestedScope !== scope) return;
      status = "error";
      errorText = error.message || "Unable to read usage";
      rateLimited = error.status === 429;
      if (error.status === 401 || error.status === 403) usage = null;
      retryAt = Date.now() + (error.retryMs || (provider === "gemini" ? geminiInterval() : 60000));
      render();
    }).then(function () {
      usageInFlight = null;
      if (requestedScope !== scope && document.visibilityState === "visible") loadUsage(false);
    });
    return usageInFlight;
  }

  function geminiInterval() { return Math.max(1, Number(cfg.geminiPollMinutes) || 5) * 60000; }

  window.addEventListener("cum-gemini-calibrated", function () {
    if (provider !== "gemini") return;
    lastAttempt = 0;
    if (!rateLimited) retryAt = 0;
    if (document.visibilityState === "visible") loadUsage(false);
  });

  /* ---------------------------- parsing ------------------------------ */
  // Primary: exact fields. Fallback: scan for utilization/resets pairs.
  function oneNode(node) {
    if (node && typeof node.utilization === "number") {
      // Claude's usage API returns utilization as a 0–100 percentage already
      // (1 means 1%, 17 means 17%). Do NOT rescale — just clamp to 0–100.
      // (The old "fraction form" heuristic wrongly turned 1% into 100%.)
      var p = Math.max(0, Math.min(100, node.utilization));
      return { pct: p, resetMs: node.resets_at ? Date.parse(node.resets_at) : null };
    }
    return null;
  }

  var WEEKLY_RE = /(seven|7)[\s_-]*day|weekl|week/i;
  var FIVEH_RE = /(five|5)[\s_-]*(h\b|hr|hour)|hourly|session/i;

  function parseUsage(data) {
    var five = oneNode(data && data.five_hour);
    var weekly = oneNode(data && data.seven_day);
    if (five || weekly) return { five: five, weekly: weekly, at: Date.now() };

    // Fallback scan (in case Anthropic renames the wrapper keys)
    var found = [];
    (function scan(obj, key) {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) { for (var i = 0; i < obj.length; i++) scan(obj[i], key); return; }
      if (typeof obj.utilization === "number") {
        var n = oneNode(obj);
        if (n) { n.hint = (String(key || "") + " " + Object.keys(obj).join(" ")).toLowerCase(); found.push(n); }
      }
      var ks = Object.keys(obj);
      for (var j = 0; j < ks.length; j++) scan(obj[ks[j]], ks[j]);
    })(data, "");

    var f = null, w = null;
    for (var k = 0; k < found.length; k++) {
      var h = found[k].hint || "";
      if (!w && WEEKLY_RE.test(h)) { w = found[k]; continue; }
      if (!f && FIVEH_RE.test(h)) { f = found[k]; }
    }
    if (!f && !w && found.length) { f = found[0]; w = found[1] || null; }
    return { five: f, weekly: w, at: Date.now() };
  }

  function metersFromUsage(u) {
    var out = [];
    if (u && u.five) out.push({ label: "5 Hrs", usedPct: u.five.pct, reset: u.five.resetMs ? new Date(u.five.resetMs) : null });
    if (u && u.weekly) out.push({ label: "Weekly", usedPct: u.weekly.pct, reset: u.weekly.resetMs ? new Date(u.weekly.resetMs) : null });
    return out;
  }

  /* ---------------------------- rendering ---------------------------- */
  function colorClass(p) { return p >= 80 ? "cum-red" : p >= 50 ? "cum-amber" : "cum-green"; }

  // Precise, human time-until-reset, e.g. "2 hr 48 min", "4 days 6 hr".
  function relFuture(d) {
    if (!d) return "";
    var ms = +d - Date.now();
    if (ms <= 0) return "resets now";
    var totalMin = Math.floor(ms / 60000);
    if (totalMin < 1) return "< 1 min";
    var days = Math.floor(totalMin / 1440);
    var hrs = Math.floor((totalMin % 1440) / 60);
    var mins = totalMin % 60;
    var parts = [];
    if (days > 0) {
      parts.push(days + " day" + (days > 1 ? "s" : ""));
      if (hrs > 0) parts.push(hrs + " hr");
    } else if (hrs > 0) {
      parts.push(hrs + " hr");
      if (mins > 0) parts.push(mins + " min");
    } else {
      parts.push(mins + " min");
    }
    return parts.join(" ");
  }
  function relPast(ts) {
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 10) return "just now";
    if (s < 60) return s + "s ago";
    var m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.round(m / 60);
    if (h < 48) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }

  function svg(inner) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + inner + "</svg>";
  }

  function setCollapsed(v) { cfg.collapsed = v; try { chrome.storage.local.set({ cfg: cfg }); } catch (_) {} render(); }

  var barEl = null, els = null;

  // Build the bar skeleton ONCE; later we only update text/width/colors so the
  // fills animate smoothly and nothing flickers.
  function buildStructure(bar) {
    bar.textContent = "";
    var main = document.createElement("div"); main.className = "cum-main";
    var body = document.createElement("div"); body.className = "cum-body";

    function meterRow(labelText) {
      var row = document.createElement("div"); row.className = "cum-meter";
      var label = document.createElement("span"); label.className = "cum-label"; label.textContent = labelText;
      var track = document.createElement("span"); track.className = "cum-track";
      var fill = document.createElement("span"); fill.className = "cum-fill"; track.appendChild(fill);
      var pct = document.createElement("span"); pct.className = "cum-pct";
      var reset = document.createElement("span"); reset.className = "cum-reset";
      row.appendChild(label); row.appendChild(track); row.appendChild(pct); row.appendChild(reset);
      return { row: row, fill: fill, pct: pct, reset: reset };
    }

    var five = meterRow("5 Hrs");
    var divider = document.createElement("span"); divider.className = "cum-divider";
    var weekly = meterRow("Weekly");
    var statusEl = document.createElement("span"); statusEl.className = "cum-status";
    body.appendChild(five.row); body.appendChild(divider); body.appendChild(weekly.row); body.appendChild(statusEl);

    var meta = document.createElement("div"); meta.className = "cum-meta";
    var live = document.createElement("span"); live.className = "cum-live"; live.title = "Live";
    var updated = document.createElement("span"); updated.className = "cum-updated";
    var min = document.createElement("span"); min.className = "cum-min"; min.title = "Minimize";
    min.innerHTML = svg('<path d="M18 15l-6-6-6 6"/>');
    min.addEventListener("click", function () { setCollapsed(true); });
    meta.appendChild(live); meta.appendChild(updated); meta.appendChild(min);

    main.appendChild(body); main.appendChild(meta);

    var chip = document.createElement("span"); chip.className = "cum-restore"; chip.title = "Show usage";
    var chipDot = document.createElement("span"); chipDot.className = "cum-live";
    var chipText = document.createElement("span"); chipText.className = "cum-chip-text"; chipText.textContent = providerLabel + " Usage";
    var chipIcon = document.createElement("span"); chipIcon.className = "cum-chev"; chipIcon.innerHTML = svg('<path d="M6 9l6 6 6-6"/>');
    chip.appendChild(chipDot); chip.appendChild(chipText); chip.appendChild(chipIcon);
    chip.addEventListener("click", function () { setCollapsed(false); });

    var source = document.createElement("a"); source.className = "cum-source";
    source.target = "_blank"; source.rel = "noopener noreferrer";
    bar.appendChild(source); bar.appendChild(main); bar.appendChild(chip);
    els = { source: source, main: main, five: five, divider: divider, weekly: weekly, status: statusEl, live: live, updated: updated, chip: chip };
  }

  // Compact dock labels; the full reset timestamp remains in the tooltip.
  function compactFuture(d) {
    var minutes = Math.max(0, Math.floor((+d - Date.now()) / 60000));
    if (minutes < 1) return +d <= Date.now() ? "now" : "<1m";
    var days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
    return days ? days + "d " + hours + "h" : hours ? hours + "h " + minutes % 60 + "m" : minutes + "m";
  }
  function setMeter(m, data, compact) {
    m.row.style.display = "";
    m.row.classList.toggle("cum-unavailable", !data);
    if (!data) {
      m.pct.textContent = "—"; m.fill.style.width = "0%"; m.reset.style.display = "none";
      m.row.title = "This usage window is not reported by the provider";
      return;
    }
    m.row.title = data.pct + "% used" + (data.resetText ? " · " + data.resetText : "");
    m.fill.className = "cum-fill " + colorClass(data.pct);
    m.fill.style.width = Math.round(data.pct) + "%";
    m.pct.textContent = (Math.round(data.pct * 10) / 10) + "%";
    if (data.resetMs) {
      var d = new Date(data.resetMs);
      m.reset.style.display = ""; m.reset.textContent = "· " + (compact ? compactFuture(d) : relFuture(d));
      try { m.reset.title = "Resets " + d.toLocaleString(); } catch (_) {}
    } else if (data.resetText) {
      m.reset.style.display = ""; m.reset.textContent = "· " + data.resetText; m.reset.title = data.resetText;
    } else { m.reset.style.display = "none"; m.reset.textContent = ""; }
  }

  function render() {
    restoreGreeting();
    var nextScope = providerScope();
    if (nextScope !== scope) {
      scope = nextScope; usage = null; status = "loading"; errorText = ""; lastAttempt = 0; retryAt = 0; rateLimited = false;
      setTimeout(function () { if (document.visibilityState === "visible") loadUsage(false); }, 0);
    }
    if (provider === "gemini" && UsageProviders.isGeminiUsage(location.href)) {
      if (barEl) barEl.remove(); observeComposer(null, null); return;
    }
    if (provider === "gemini" && !lastAttempt && !usageInFlight && document.visibilityState === "visible") {
      setTimeout(function () { loadUsage(false); }, 0);
    }
    if (cfg.hidden) { if (barEl) { barEl.remove(); barEl = null; els = null; } observeComposer(null, null); return; }
    var editable = findEditable();
    var docked = true;
    // A detached composer can remain cached across SPA navigation. Remove the
    // old meter when there is no safe target instead of leaving it on screen.
    if (!document.body || (provider === "claude" && !editable && !isCodePage())) {
      if (barEl) barEl.remove();
      observeComposer(null);
      return;
    }

    if (!barEl) { barEl = document.createElement("div"); barEl.id = BAR_ID; }
    if (!els) { buildStructure(barEl); setTimeout(function () { if (barEl) barEl.style.animation = "none"; }, 360); }
    barEl.classList.toggle("cum-code-dock", docked);
    barEl.setAttribute("role", "region");
    barEl.setAttribute("aria-label", providerLabel + " usage");
    barEl.setAttribute("data-provider", provider);
    barEl.title = provider === "codex" ? "Codex quota · used (not ChatGPT message limits)" : providerLabel + " quota · used";
    try { els.source.href = UsageProviders.usageUrl(location.href); }
    catch (_) { els.source.href = "https://gemini.google.com/app"; }
    var ageMin = usage ? (Date.now() - usage.at) / 60000 : 0;
    var note = status === "error" ? " · refresh failed" : ageMin > cfg.staleMinutes ? " · stale" : "";
    els.source.textContent = providerLabel + " · used" + note;
    els.source.title = (provider === "codex" ? "Codex quota (not ChatGPT message limits). " : "") +
      (errorText || (usage ? "Updated " + relPast(usage.at) + ". " : "")) + " Open official usage page";
    // Keep the node outside the editor tree on all providers so drafts, focus
    // and the site's own composer layout remain untouched.
    if (barEl.parentElement !== document.body) document.body.appendChild(barEl);

    barEl.classList.toggle("cum-collapsed", !!cfg.collapsed);
    if (cfg.collapsed) { els.main.style.display = "none"; els.chip.style.display = ""; placeBar(docked, editable); return; }
    els.main.style.display = ""; els.chip.style.display = "none";

    if (usage && (usage.five || usage.weekly)) {
      els.status.style.display = "none";
      var compact = docked && (!editable || composerBoundary(editable).getBoundingClientRect().width < 640);
      setMeter(els.five, usage.five, compact);
      setMeter(els.weekly, usage.weekly, compact);
      els.divider.style.display = (usage.five && usage.weekly) ? "" : "none";
      els.live.style.display = status === "error" ? "none" : ""; els.updated.style.display = "";
      els.updated.textContent = status === "error" ? "refresh failed" : (ageMin > cfg.staleMinutes ? "stale · " : "") + relPast(usage.at);
      els.updated.title = errorText || "Updated " + relPast(usage.at);
    } else {
      els.five.row.style.display = "none";
      els.weekly.row.style.display = "none";
      els.divider.style.display = "none";
      els.status.style.display = "";
      els.status.textContent = status === "error" ? (errorText || "Can't reach usage — sign in to " + providerLabel)
        : status === "empty" ? "5h / 7d usage unavailable — open Usage page" : "Loading " + providerLabel + " usage…";
      els.live.style.display = "none"; els.updated.style.display = "none";
    }
    placeBar(docked, editable);
  }

  function isCodePage() {
    return /^(?:\/code|\/cowork\/code)(?:\/|$)/i.test(location.pathname);
  }

  // Prefer the message composer over search, settings and source-code editors.
  function findEditable() {
    var candidates = document.querySelectorAll('[contenteditable="true"], [contenteditable="plaintext-only"], textarea');
    var best = null, bestScore = -Infinity;
    for (var i = 0; i < candidates.length; i++) {
      var editable = candidates[i];
      if (editable.closest('[role="dialog"], [aria-modal="true"], [role="search"], .monaco-editor, .cm-editor, nav') ||
          editable.disabled || editable.readOnly || !editable.getClientRects().length) continue;
      var style = getComputedStyle(editable);
      if (style.visibility === "hidden" || style.display === "none") continue;
      var rect = editable.getBoundingClientRect();
      if (rect.width < 100 || rect.height < 20 || rect.bottom <= 0 || rect.top >= window.innerHeight ||
          rect.right <= 0 || rect.left >= window.innerWidth) continue;
      var hint = [editable.id, editable.getAttribute("data-testid"), editable.getAttribute("aria-label"), editable.getAttribute("placeholder")].join(" ");
      var score = rect.bottom / window.innerHeight;
      if (editable.matches('#prompt-textarea, .ql-editor[contenteditable="true"]') || editable.closest('rich-textarea')) score += 20;
      if (/prompt|composer|message|reply|消息|回复/i.test(hint)) score += 10;
      if (editable.closest("form, fieldset")) score += 2;
      if (score > bestScore) { best = editable; bestScore = score; }
    }
    return best;
  }

  // Include a nearby input card's border/padding, but never anchor to a large
  // conversation panel or the entire page when a form wraps more than input.
  function composerBoundary(editable) {
    var rect = editable.getBoundingClientRect(), boundary = editable;
    var parent = editable.parentElement;
    for (var depth = 0; parent && parent !== document.body && depth < 10; depth++, parent = parent.parentElement) {
      var box = parent.getBoundingClientRect();
      // The editable excludes attachment, model and microphone controls.
      // Walk through wrappers to the full input card on every provider.
      if (!box.width || !box.height) continue;
      if (box.width > rect.width + 440 || box.height > rect.height + 180) break;
      if (box.width < rect.width || box.height < rect.height) continue;
      var style = getComputedStyle(parent);
      if (parent.matches("form, fieldset") || parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderRadius) > 0) boundary = parent;
    }
    return boundary;
  }

  var composerObserver = null, observedEditor = null, observedBoundary = null;
  var greetingAdjustment = null;
  function restoreGreeting() {
    if (!greetingAdjustment) return;
    var saved = greetingAdjustment;
    if (saved.value) saved.node.style.setProperty("translate", saved.value, saved.priority);
    else saved.node.style.removeProperty("translate");
    greetingAdjustment = null;
  }

  // The centered ChatGPT start screen has a heading immediately above its
  // composer. Move only that greeting enough to leave an 8px visual gap;
  // never move conversation headings or change the editor's layout.
  function makeRoomForGreeting(top, left, width, composerTop) {
    if (provider !== "codex" || !/^\/(?:$|new\/?$)/.test(location.pathname)) return;
    var headings = document.querySelectorAll('main h1, main h2, main [role="heading"]');
    for (var i = 0; i < headings.length; i++) {
      var heading = headings[i], box = heading.getBoundingClientRect();
      if (!heading.getClientRects().length || getComputedStyle(heading).visibility === "hidden" ||
          box.bottom > composerTop || box.bottom < composerTop - 180 ||
          box.right <= left || box.left >= left + width) continue;
      var shift = Math.max(0, box.bottom + 8 - top);
      if (!shift || box.top - shift < 16) continue;
      greetingAdjustment = { node: heading, value: heading.style.getPropertyValue("translate"), priority: heading.style.getPropertyPriority("translate") };
      heading.style.setProperty("translate", "0 -" + shift + "px", "important");
      break;
    }
  }
  function observeComposer(editable, boundary) {
    if (editable === observedEditor && boundary === observedBoundary) return;
    if (composerObserver) composerObserver.disconnect();
    observedEditor = editable; observedBoundary = boundary;
    if (!editable || typeof ResizeObserver === "undefined") return;
    if (!composerObserver) composerObserver = new ResizeObserver(schedule);
    composerObserver.observe(editable);
    if (boundary && boundary !== editable) composerObserver.observe(boundary);
  }

  function placeBar(docked, editable) {
    var boundary = docked && editable ? composerBoundary(editable) : null;
    observeComposer(docked ? editable : null, boundary);
    barEl.classList.remove("cum-composer", "cum-narrow");
    ["top", "left", "right", "width"].forEach(function (key) { barEl.style.removeProperty(key); });
    if (boundary) {
      var rect = boundary.getBoundingClientRect();
      var width = Math.min(rect.width, window.innerWidth - 32);
      barEl.classList.add("cum-composer");
      barEl.classList.toggle("cum-narrow", width < 600);
      if (!cfg.collapsed) barEl.style.width = width + "px";
      var size = barEl.getBoundingClientRect();
      var top = rect.top - size.height - 6;
      // Retain the corner dock if scrolling/expansion leaves no room above.
      if (top >= 16 && rect.top < window.innerHeight && rect.bottom > 0) {
        barEl.style.top = top + "px";
        barEl.style.left = Math.max(16, Math.min(rect.right - size.width, window.innerWidth - size.width - 16)) + "px";
        barEl.style.right = "auto";
        makeRoomForGreeting(top, parseFloat(barEl.style.left), size.width, rect.top);
      } else {
        barEl.classList.remove("cum-composer", "cum-narrow");
        barEl.style.removeProperty("width");
      }
    }
    protectEditor(docked);
  }

  // If a resized/expanded editor reaches the dock, temporarily hide the meter.
  // Visibility preserves its dimensions so it can reappear when space returns.
  function protectEditor(docked) {
    var overlaps = false;
    if (docked) {
      var bar = barEl.getBoundingClientRect();
      var editors = document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [role="dialog"], [aria-modal="true"]');
      for (var i = 0; i < editors.length; i++) {
        var editor = editors[i];
        if (!editor.getClientRects().length || getComputedStyle(editor).visibility === "hidden") continue;
        var rect = editor.getBoundingClientRect();
        if (bar.left < rect.right + 4 && bar.right > rect.left - 4 && bar.top < rect.bottom + 4 && bar.bottom > rect.top - 4) {
          overlaps = true; break;
        }
      }
    }
    barEl.style.visibility = overlaps ? "hidden" : "";
  }

  /* ------------------------- live triggers --------------------------- */
  // Force a refresh shortly after a response finishes streaming.
  function watchGeneration() {
    var active = false, generationTimer = null;
    var mo = new MutationObserver(function (records) {
      if (!hasPageMutation(records)) return;
      var stop = document.querySelector('[data-testid="stop-button"], button[aria-label="Stop"]');
      if (provider === "gemini") stop = document.querySelector('button[aria-label="Stop response"], button[aria-label="停止回答"], button[aria-label="停止回覆"], button[data-test-id="stop-button"], button.send-button.stop');
      var send = document.querySelector('[data-testid="send-button"], button[aria-label="Send message"]');
      if (stop) {
        active = true;
        if (generationTimer) { clearTimeout(generationTimer); generationTimer = null; }
        return;
      }
      if (active && (send || provider === "gemini")) {
        active = false;
        if (generationTimer) clearTimeout(generationTimer);
        generationTimer = setTimeout(function () {
          generationTimer = null;
          if (provider === "gemini") {
            if (document.visibilityState === "visible") loadUsage(false, true);
          } else loadUsage(true);
        }, provider === "gemini" ? 4000 : 1200);
      }
    });
    var options = { childList: true, subtree: true };
    if (provider === "gemini") { options.attributes = true; options.attributeFilter = ["class", "aria-label", "data-test-id"]; }
    mo.observe(document.body || document.documentElement, options);
  }

  var scheduled = false;
  function schedule() { if (scheduled) return; scheduled = true; setTimeout(function () { scheduled = false; render(); }, 200); }
  function hasPageMutation(records) {
    return records.some(function (record) { return !barEl || !barEl.contains(record.target); });
  }
  function observeDom() {
    new MutationObserver(function (records) { if (hasPageMutation(records)) schedule(); })
      .observe(document.documentElement, { childList: true, subtree: true });
  }
  window.addEventListener("resize", schedule);
  document.addEventListener("scroll", schedule, true);
  document.addEventListener("input", schedule, true);

  function restartPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (document.visibilityState !== "visible") return;
    var ms = provider === "gemini" ? geminiInterval() : Math.max(10, cfg.pollSeconds | 0) * 1000;
    loadUsage(false);
    pollTimer = setInterval(function () { loadUsage(false); }, ms);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") restartPolling();
    else if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  });

  /* ----------------------------- init -------------------------------- */
  function init() {
    loadAll().then(function () {
      observeDom();
      render();                 // instant paint from cache (if any)
      restartPolling();         // immediate fetch + interval
      if (document.body) watchGeneration();
      else document.addEventListener("DOMContentLoaded", watchGeneration);
      // light UI tick so "updated Ns ago" and reset countdowns stay fresh
      if (uiTimer) clearInterval(uiTimer);
      uiTimer = setInterval(render, 1000);
    });
  }
  init();
})();
