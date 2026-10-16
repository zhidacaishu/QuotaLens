/* QuotaLens — quota state, rendering and refresh scheduling (ISOLATED world).
 * Provider adapters keep readings in this page's memory. Layout lives in layout.js. */
(function () {
  "use strict";

  var TAG = "[UsageMeter]";
  var BAR_ID = "cum-bar";
  var provider = UsageProviders.identify(location.href);
  if (!provider) return;
  var providerLabel = UsageProviders.labels[provider];
  var layout = UsageLayout.create(provider, schedule);
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
    showClaude: true,
    showCodex: true,
    showGemini: true,
    collapsed: false,  // minimized to a small restore chip
    transparency: 70, // background only; quota text remains fully opaque
    staleMinutes: 10
  };

  var cfg = shallow(DEFAULTS);
  var usage = null;          // { five:{pct,resetMs}|null, weekly:{...}|null, at }
  var status = "loading";    // loading | ok | empty | error
  var usageInFlight = null;
  var pollTimer = null, uiTimer = null;

  function shallow(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }
  function log() { if (cfg.debug) { try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch (_) {} } }

  /* ----------------------------- storage ----------------------------- */
  function loadAll() {
    return new Promise(function (res) {
      chrome.storage.local.get(["cfg"], function (d) {
        if (d.cfg) {
          var stored = d.cfg;
          cfg = Object.assign(shallow(DEFAULTS), stored);
          // The global hide switch was removed; platform switches remain authoritative.
          if (Object.prototype.hasOwnProperty.call(stored, "hidden")) {
            delete cfg.hidden;
            chrome.storage.local.set({ cfg: cfg });
          }
        }
        // Remove unscoped data from versions that persisted Claude readings.
        chrome.storage.local.remove(["usage", "orgId", "orgIdAt"]);
        res();
      });
    });
  }

  chrome.storage.onChanged.addListener(function (ch, area) {
    if (area !== "local" || !ch.cfg) return;
    var previous = cfg;
    cfg = Object.assign(shallow(DEFAULTS), ch.cfg.newValue || {});
    delete cfg.hidden;
    if (previous.pollSeconds !== cfg.pollSeconds || previous.geminiPollMinutes !== cfg.geminiPollMinutes) restartPolling();
    render();
  });

  // popup <-> content
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    if (msg.type === "cum-poll") { loadUsage(true).then(function () { sendResponse({ ok: status === "ok", status: status }); }); return true; }
    if (msg.type === "cum-status") { sendResponse({ provider: providerLabel, hasData: !!(usage && (usage.five || usage.weekly)), at: usage && usage.at, status: status, error: errorText, cfg: cfg }); return true; }
  });

  /* --------------------------- API calls ----------------------------- */
  function loadUsage(force, afterGeneration) {
    if (provider === "gemini" && UsageProviders.isGeminiUsage(location.href)) return Promise.resolve();
    if (usageInFlight) return afterGeneration ? usageInFlight.then(function () { return loadUsage(false, true); }) : usageInFlight;
    var now = Date.now();
    if ((now < retryAt && (!force || rateLimited)) || (!force && !afterGeneration && lastAttempt && now - lastAttempt < pollInterval())) return Promise.resolve();
    var requestedScope = scope;
    lastAttempt = now;
    if (!usage) status = "loading";
    render();
    // Initialization errors must enter the same error path as network failures;
    // otherwise a missing adapter leaves the UI stuck on Loading forever.
    var expired = false, deadlineTimer;
    var request = Promise.resolve().then(function () {
      if (provider !== "gemini") return UsageProviders[provider === "claude" ? "fetchClaude" : "fetchCodex"](function (nextAccount) {
        if (expired || requestedScope !== scope) return;
        if (account !== nextAccount) { account = nextAccount; usage = null; status = "loading"; render(); }
      });
      if (!globalThis.UsageGemini || typeof globalThis.UsageGemini.fetchUsage !== "function") {
        throw new Error("Gemini adapter failed to initialize. Reload the extension and this page.");
      }
      return globalThis.UsageGemini.fetchUsage();
    });
    // A suspended page or stalled adapter must not hold the refresh lock forever.
    var deadline = new Promise(function (_, reject) {
      deadlineTimer = setTimeout(function () {
        expired = true;
        reject(new Error("Usage request timed out. Try refreshing again."));
      }, 45000);
    });
    usageInFlight = Promise.race([request, deadline]).then(function (data) {
      if (requestedScope !== scope) return;
      usage = data;
      status = data && (data.five || data.weekly) ? "ok" : "empty";
      errorText = ""; retryAt = 0; rateLimited = false;
      render();
    }).catch(function (error) {
      if (requestedScope !== scope) return;
      status = "error";
      log("Usage refresh failed", provider, error.status || 0);
      errorText = error.message || "Unable to read usage";
      rateLimited = error.status === 429;
      if (error.status === 401 || error.status === 403) { usage = null; account = null; }
      retryAt = Date.now() + (error.retryMs || (provider === "gemini" ? geminiInterval() : 60000));
      render();
    }).then(function () {
      clearTimeout(deadlineTimer);
      expired = true;
      usageInFlight = null;
      render();
      if (requestedScope !== scope && document.visibilityState === "visible") loadUsage(false);
    });
    render();
    return usageInFlight;
  }

  function pollInterval() { return provider === "gemini" ? geminiInterval() : Math.max(10, cfg.pollSeconds | 0) * 1000; }
  function geminiInterval() { return Math.max(1, Number(cfg.geminiPollMinutes) || 5) * 60000; }

  window.addEventListener("cum-gemini-calibrated", function () {
    if (provider !== "gemini") return;
    lastAttempt = 0;
    if (!rateLimited) retryAt = 0;
    if (document.visibilityState === "visible") loadUsage(false);
  });

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

  function setCollapsed(v) {
    var restoreFocus = barEl && barEl.contains(document.activeElement);
    cfg.collapsed = v;
    try { chrome.storage.local.set({ cfg: cfg }); } catch (_) {}
    render();
    if (restoreFocus && barEl) barEl.querySelector(v ? ".cum-restore" : ".cum-min").focus({ preventScroll: true });
  }

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
    var min = document.createElement("button"); min.type = "button"; min.setAttribute("aria-label", "Minimize usage"); min.className = "cum-min"; min.title = "Minimize";
    min.innerHTML = svg('<path d="M18 15l-6-6-6 6"/>');
    min.addEventListener("click", function () { setCollapsed(true); });
    meta.appendChild(live); meta.appendChild(updated);
    var refresh = document.createElement("button"); refresh.type = "button"; refresh.className = "cum-refresh";
    refresh.innerHTML = svg('<path d="M20 7v5h-5M20 12a8 8 0 1 0-2.34 5.66"/>');
    refresh.addEventListener("click", function () { if (refresh.getAttribute("aria-disabled") !== "true") loadUsage(true); });
    meta.appendChild(refresh);
    meta.appendChild(min);

    main.appendChild(body); main.appendChild(meta);

    var chip = document.createElement("button"); chip.type = "button"; chip.setAttribute("aria-label", "Show " + providerLabel + " usage"); chip.className = "cum-restore"; chip.title = "Show usage";
    var chipDot = document.createElement("span"); chipDot.className = "cum-live";
    var chipText = document.createElement("span"); chipText.className = "cum-chip-text"; chipText.textContent = providerLabel + " Usage";
    var chipIcon = document.createElement("span"); chipIcon.className = "cum-chev"; chipIcon.innerHTML = svg('<path d="M6 9l6 6 6-6"/>');
    chip.appendChild(chipDot); chip.appendChild(chipText); chip.appendChild(chipIcon);
    chip.addEventListener("click", function () { setCollapsed(false); });

    var source = document.createElement("a"); source.className = "cum-source";
    source.target = "_blank"; source.rel = "noopener noreferrer";
    bar.appendChild(source); bar.appendChild(main); bar.appendChild(chip);
    els = { source: source, main: main, five: five, divider: divider, weekly: weekly, status: statusEl, live: live, updated: updated, chip: chip, refresh: refresh };
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
    layout.restoreGreeting();
    var nextScope = providerScope();
    if (nextScope !== scope) {
      scope = nextScope; usage = null; status = "loading"; errorText = ""; lastAttempt = 0; retryAt = 0; rateLimited = false;
      setTimeout(function () { if (document.visibilityState === "visible") loadUsage(false); }, 0);
    }
    if (provider === "gemini" && UsageProviders.isGeminiUsage(location.href)) {
      if (barEl) barEl.remove(); layout.observeComposer(null, null); return;
    }
    if (provider === "gemini" && !lastAttempt && !usageInFlight && document.visibilityState === "visible") {
      setTimeout(function () { loadUsage(false); }, 0);
    }
    var displayKey = { claude: "showClaude", codex: "showCodex", gemini: "showGemini" }[provider];
    if (cfg[displayKey] === false) { if (barEl) { barEl.remove(); barEl = null; els = null; } layout.observeComposer(null, null); return; }
    var editable = layout.findEditable();
    // A detached composer can remain cached across SPA navigation. Remove the
    // old meter when there is no safe target instead of leaving it on screen.
    if (!document.body || (!editable && !(provider === "claude" && isCodePage()))) {
      if (barEl) barEl.remove();
      layout.observeComposer(null, null);
      return;
    }

    if (!barEl) { barEl = document.createElement("div"); barEl.id = BAR_ID; }
    var transparency = typeof cfg.transparency === "number" && Number.isFinite(cfg.transparency) ? Math.max(0, Math.min(95, Math.round(cfg.transparency))) : DEFAULTS.transparency;
    barEl.style.setProperty("--surface-alpha", (1 - transparency / 100).toFixed(2));
    if (!els) { buildStructure(barEl); setTimeout(function () { if (barEl) barEl.style.animation = "none"; }, 360); }
    barEl.classList.add("cum-code-dock");
    barEl.setAttribute("role", "region");
    barEl.setAttribute("aria-label", providerLabel + " usage");
    barEl.setAttribute("data-provider", provider);
    barEl.title = provider === "codex" ? "Codex quota · used (not ChatGPT message limits)" : providerLabel + " quota · used";
    try { els.source.href = UsageProviders.usageUrl(location.href); }
    catch (_) { els.source.href = "https://gemini.google.com/app"; }
    var ageMin = usage ? (Date.now() - usage.at) / 60000 : 0;
    barEl.setAttribute("data-state", status === "ok" && ageMin > cfg.staleMinutes ? "stale" : status);
    var warning = status === "error" || (usage && ageMin > cfg.staleMinutes);
    var stateLabel = status === "error" ? "Refresh failed" + (usage ? " — showing last reading. " : ". ") + errorText
      : warning ? "Reading is out of date — updated " + relPast(usage.at) : usage ? "Updated " + relPast(usage.at) : status === "empty" ? "Usage unavailable" : "Loading usage";
    [els.live, els.chip.querySelector(".cum-live")].forEach(function (indicator) {
      indicator.textContent = warning ? "!" : "";
      indicator.title = stateLabel;
      indicator.setAttribute("role", "img");
      indicator.setAttribute("aria-label", stateLabel);
    });
    if (warning) barEl.title += ". " + stateLabel;
    if (els.refresh) {
      var cooling = rateLimited && Date.now() < retryAt;
      var refreshLabel = usageInFlight ? "Refreshing " + providerLabel + " usage…" : cooling ? "Rate limited — retry in " + Math.ceil((retryAt - Date.now()) / 1000) + "s" : "Refresh " + providerLabel + " usage";
      els.refresh.title = refreshLabel;
      els.refresh.setAttribute("aria-label", refreshLabel);
      els.refresh.setAttribute("aria-disabled", String(!!usageInFlight || cooling));
      els.refresh.setAttribute("aria-busy", String(!!usageInFlight));
    }
    var note = status === "error" ? " · refresh failed" : ageMin > cfg.staleMinutes ? " · stale" : "";
    els.source.textContent = providerLabel + " · used" + note;
    els.source.title = (provider === "codex" ? "Codex quota (not ChatGPT message limits). " : "") +
      (errorText || (usage ? "Updated " + relPast(usage.at) + ". " : "")) + " Open official usage page";
    // Keep the node outside the editor tree on all providers so drafts, focus
    // and the site's own composer layout remain untouched.
    if (barEl.parentElement !== document.body) document.body.appendChild(barEl);

    barEl.classList.toggle("cum-collapsed", !!cfg.collapsed);
    if (cfg.collapsed) { els.main.style.display = "none"; els.chip.style.display = ""; layout.placeBar(barEl, editable, cfg.collapsed); return; }
    els.main.style.display = ""; els.chip.style.display = "none";

    if (usage && (usage.five || usage.weekly)) {
      els.status.style.display = "none";
      var compact = !editable || Math.min(layout.composerBoundary(editable).getBoundingClientRect().width, window.innerWidth - 32) < 760;
      setMeter(els.five, usage.five, compact);
      setMeter(els.weekly, usage.weekly, compact);
      els.divider.style.display = (usage.five && usage.weekly) ? "" : "none";
      els.live.style.display = ""; els.updated.style.display = "";
      els.updated.textContent = status === "error" ? "refresh failed" : (ageMin > cfg.staleMinutes ? "stale · " : "") + relPast(usage.at);
      els.updated.title = errorText || "Updated " + relPast(usage.at);
    } else {
      setMeter(els.five, null, false);
      setMeter(els.weekly, null, false);
      els.five.row.style.display = "none";
      els.weekly.row.style.display = "none";
      els.divider.style.display = "none";
      els.status.style.display = "";
      els.status.textContent = status === "error" ? (errorText || "Can't reach usage — sign in to " + providerLabel)
        : status === "empty" ? "5h / 7d usage unavailable — open Usage page" : "Loading " + providerLabel + " usage…";
      els.live.style.display = warning ? "" : "none"; els.updated.style.display = "none";
    }
    layout.placeBar(barEl, editable, cfg.collapsed);
    // Placement may fall back to the small corner dock even for a wide
    // composer. Its fixed time column needs the compact wording as well.
    var placedCompact = !barEl.classList.contains("cum-composer") || barEl.classList.contains("cum-compact");
    if (usage && (usage.five || usage.weekly) && placedCompact !== compact) {
      setMeter(els.five, usage.five, placedCompact);
      setMeter(els.weekly, usage.weekly, placedCompact);
    }
  }

  function isCodePage() {
    return /^(?:\/code|\/cowork\/code)(?:\/|$)/i.test(location.pathname);
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
    var ms = pollInterval();
    loadUsage(false);
    pollTimer = setInterval(function () { loadUsage(false); }, ms);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") restartPolling();
    else if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  });

  // Some browser shells resume without a visibility transition. Re-arm polling
  // on lifecycle events; loadUsage deduplicates and respects retry cooldowns.
  ["focus", "pageshow", "online"].forEach(function (event) {
    window.addEventListener(event, function () {
      if (document.visibilityState === "visible") { restartPolling(); schedule(); }
    });
  });

  /* ----------------------------- init -------------------------------- */
  function init() {
    loadAll().then(function () {
      observeDom();
      render();
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
