/* QuotaLens — provider-aware popup */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var DEF = { pollSeconds: 15, geminiPollMinutes: 5, debug: false, showClaude: true, showCodex: true, showGemini: true, transparency: 70 };

  var motionMedia = null;
  try {
    if (typeof window.matchMedia === "function") motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  } catch (_) {}
  function motionAllowed() {
    return !!(motionMedia && !motionMedia.matches);
  }
  function currentAngle(el) {
    try {
      var transform = getComputedStyle(el).transform;
      if (!transform || transform === "none") return 0;
      var match = transform.match(/matrix\(([^)]+)\)/);
      if (!match) return 0;
      var parts = match[1].split(",").map(Number);
      return (((Math.atan2(parts[1], parts[0]) * 180 / Math.PI) % 360) + 360) % 360;
    } catch (_) { return 0; }
  }
  function statusSignature(text) {
    return String(text || "").replace(/\d+[sm]/g, "#");
  }

  var lastStatusText = "", lastStatusSig = "", lastAnnouncedSig = "";
  function announce(text, force) {
    var sr = $("#sr-status");
    if (!sr || !text) return;
    var sig = statusSignature(text);
    if (!force && sig === lastAnnouncedSig) return;
    lastAnnouncedSig = sig;
    sr.textContent = "";
    sr.textContent = text;
  }
  function setStatus(text, state, shouldAnnounce) {
    var el = $("#status");
    var card = $(".connection");
    if (card) card.setAttribute("data-state", state || "idle");
    if (shouldAnnounce) announce(text, false);
    if (text === lastStatusText) return;
    var nextSig = statusSignature(text);
    var shouldFade = lastStatusText && nextSig !== lastStatusSig && motionAllowed() && typeof el.animate === "function";
    lastStatusText = text;
    lastStatusSig = nextSig;
    el.textContent = text;
    if (shouldFade) {
      try {
        el.animate(
          [{ opacity: 0.45, transform: "translateY(2px)" }, { opacity: 1, transform: "translateY(0)" }],
          { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
        );
      } catch (_) {}
    }
  }

  var spinAnim = null, settleAnim = null, spinBusy = false, feedbackTimer = null, pendingDoneAfterSettle = false;
  function clearRefreshFeedback() {
    clearTimeout(feedbackTimer); feedbackTimer = null;
    pendingDoneAfterSettle = false;
    var btn = $("#refresh");
    if (btn) btn.removeAttribute("data-feedback");
  }
  function showDoneCheckmark() {
    var btn = $("#refresh");
    if (!btn || spinBusy) return;
    btn.setAttribute("data-feedback", "done");
    clearTimeout(feedbackTimer);
    if (motionMedia) {
      feedbackTimer = setTimeout(function () {
        feedbackTimer = null;
        btn.removeAttribute("data-feedback");
      }, 950);
    }
  }
  function setRefreshBusy(busy) {
    var btn = $("#refresh");
    if (!btn) return;
    if (busy) clearRefreshFeedback();
    btn.setAttribute("data-busy", String(!!busy));
    var icon = btn.querySelector(".icon-refresh");
    if (!icon || !motionAllowed() || typeof icon.animate !== "function") {
      if (spinAnim) { try { spinAnim.cancel(); } catch (_) {} spinAnim = null; }
      settleAnim = null;
      btn.removeAttribute("data-waapi-spin");
      spinBusy = !!busy;
      if (!spinBusy && pendingDoneAfterSettle) { pendingDoneAfterSettle = false; showDoneCheckmark(); }
      return;
    }
    if (busy && !spinBusy) {
      if (spinAnim) { try { spinAnim.cancel(); } catch (_) {} }
      settleAnim = null;
      var startAngle = currentAngle(icon);
      btn.setAttribute("data-waapi-spin", "true");
      try {
        spinAnim = icon.animate(
          [{ transform: "rotate(" + startAngle.toFixed(1) + "deg)" }, { transform: "rotate(" + (startAngle + 360).toFixed(1) + "deg)" }],
          { duration: 850, iterations: Infinity, easing: "linear" }
        );
      } catch (_) { spinAnim = null; btn.removeAttribute("data-waapi-spin"); }
    } else if (!busy && spinBusy) {
      var angle = currentAngle(icon);
      if (spinAnim) { try { spinAnim.cancel(); } catch (_) {} spinAnim = null; }
      var remaining = 360 - angle;
      if (remaining > 8 && remaining < 358) {
        try {
          var settle = icon.animate(
            [{ transform: "rotate(" + angle.toFixed(1) + "deg)" }, { transform: "rotate(360deg)" }],
            { duration: Math.round(Math.max(140, Math.min(340, remaining * 0.92))), easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
          );
          spinAnim = settle;
          settleAnim = settle;
          var done = function () {
            if (spinAnim === settle) spinAnim = null;
            if (settleAnim === settle) settleAnim = null;
            if (!spinBusy) {
              btn.removeAttribute("data-waapi-spin");
              if (pendingDoneAfterSettle) { pendingDoneAfterSettle = false; showDoneCheckmark(); }
            }
          };
          settle.onfinish = done;
          settle.oncancel = done;
        } catch (_) { settleAnim = null; btn.removeAttribute("data-waapi-spin"); }
      } else {
        settleAnim = null;
        btn.removeAttribute("data-waapi-spin");
      }
    }
    spinBusy = !!busy;
  }
  function showRefreshOutcome(ok) {
    if (ok) {
      announce("Usage refreshed", true);
      if (settleAnim) pendingDoneAfterSettle = true;
      else showDoneCheckmark();
    } else {
      announce("Could not refresh usage", true);
      var statusEl = $("#status");
      if (motionAllowed() && statusEl && typeof statusEl.animate === "function") {
        try {
          statusEl.animate(
            [{ transform: "translateX(0)" }, { transform: "translateX(-2.5px)" }, { transform: "translateX(2px)" }, { transform: "translateX(-1px)" }, { transform: "translateX(0)" }],
            { duration: 260, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" }
          );
        } catch (_) {}
      }
    }
  }

  function getCfg() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(["cfg"], function (data) { resolve(Object.assign({}, DEF, data.cfg || {})); });
    });
  }
  var saveChain = Promise.resolve();
  function patchCfg(patch, shouldRefreshStatus) {
    saveChain = saveChain.then(function () {
      return getCfg().then(function (cfg) {
        Object.assign(cfg, patch);
        delete cfg.hidden;
        return new Promise(function (resolve) {
          chrome.storage.local.set({ cfg: cfg }, function () {
            if (shouldRefreshStatus) refreshStatus();
            resolve();
          });
        });
      });
    });
    return saveChain;
  }
  function activeTab() {
    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) { resolve(tabs && tabs[0]); });
    });
  }
  function supported(tab) { return tab && UsageProviders.identify(tab.url); }
  var statusTimer, statusVersion = 0, refreshing = false, wasCooling = false;
  function refreshStatus() {
    clearTimeout(statusTimer);
    if (refreshing) return;
    var version = ++statusVersion;
    activeTab().then(function (tab) {
      if (version !== statusVersion) return;
      var provider = supported(tab);
      $("#sync").disabled = !provider;
      var note = $("#gemini-note");
      var wasHidden = note.hidden;
      note.hidden = provider !== "gemini";
      if (wasHidden && !note.hidden && motionAllowed() && typeof note.animate === "function") {
        try {
          note.animate(
            [{ opacity: 0, transform: "translateY(-2px)" }, { opacity: 1, transform: "translateY(0)" }],
            { duration: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
          );
        } catch (_) {}
      }
      if (!provider) {
        $("#refresh").disabled = true;
        setRefreshBusy(false);
        $("#provider").textContent = "Claude · Codex · Gemini";
        setStatus("Open Claude, ChatGPT or Gemini.", "idle", false);
        return;
      }
      $("#provider").textContent = UsageProviders.labels[provider] + (provider === "codex" ? " quota · shown in ChatGPT" : " quota");
      if (UsageProviders.isGeminiUsage(tab.url)) {
        $("#refresh").disabled = true;
        setRefreshBusy(false);
        setStatus("Return to a Gemini conversation to refresh its meter.", "idle", false);
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: "cum-status" }, function (resp) {
        var disconnected = chrome.runtime.lastError || !resp;
        if (version !== statusVersion) return;
        if (disconnected) {
          $("#refresh").disabled = false;
          setRefreshBusy(false);
          setStatus("Reload this page to connect the extension.", "error", true);
          return;
        }
        var wait = Math.max(0, Math.ceil(((resp.retryAt || 0) - Date.now()) / 1000));
        $("#refresh").disabled = !!resp.busy || wait > 0;
        setRefreshBusy(!!resp.busy);
        if (resp.busy || wait || resp.status === "loading") statusTimer = setTimeout(refreshStatus, 1000);
        if (wait) {
          var enteredCooldown = !wasCooling;
          wasCooling = true;
          setStatus("Rate limited — retry in " + wait + "s.", "error", enteredCooldown);
        } else {
          if (wasCooling) { wasCooling = false; announce("Ready to refresh", true); }
          if (resp.busy) {
            setStatus("Refreshing usage in this page…", "loading", false);
          } else if (resp.status === "error") {
            setStatus(resp.error || "Can't reach usage — check sign-in.", "error", true);
          } else if (!$("#show-" + provider).checked) {
            setStatus("Quota bar hidden for " + UsageProviders.labels[provider] + ".", "idle", false);
          } else if (resp.hasData) {
            var seconds = Math.max(0, Math.round((Date.now() - resp.at) / 1000));
            var ago = seconds < 5 ? "just now" : (seconds < 60 ? seconds + "s" : Math.round(seconds / 60) + "m") + " ago";
            setStatus("Updated " + ago + " · percentages used", "ok", false);
          } else {
            setStatus(resp.status === "empty" ? "5h / 7d usage unavailable for this account." : "Loading usage…", resp.status === "empty" ? "idle" : "loading", false);
          }
        }
      });
    });
  }
  function showTransparency(value) {
    var percent = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(95, Math.round(value))) : DEF.transparency;
    $("#transparency").value = percent;
    $("#transparency-value").value = percent + "%";
    $("#transparency").setAttribute("aria-valuetext", percent + "% transparent");
    $("#transparency").style.setProperty("--range-progress", percent / 95 * 100 + "%");
  }
  function pulseClamped(input, message) {
    if (message) announce(message, true);
    if (!motionAllowed()) return;
    var control = input && input.closest(".number-control");
    if (!control) return;
    control.classList.remove("is-clamped");
    void control.offsetWidth;
    control.classList.add("is-clamped");
    setTimeout(function () { control.classList.remove("is-clamped"); }, 300);
  }
  function save() {
    var rawPoll = $("#poll").value;
    var rawGeminiPoll = $("#gemini-poll").value;
    var pollSeconds = UsageProviders.pollSetting("codex", rawPoll);
    var geminiPollMinutes = UsageProviders.pollSetting("gemini", rawGeminiPoll);
    $("#poll").value = pollSeconds;
    $("#gemini-poll").value = geminiPollMinutes;
    if (String(rawPoll).trim() !== "" && Number(rawPoll) !== pollSeconds) {
      pulseClamped($("#poll"), "Claude / Codex interval adjusted to " + pollSeconds + " seconds.");
    }
    if (String(rawGeminiPoll).trim() !== "" && Number(rawGeminiPoll) !== geminiPollMinutes) {
      pulseClamped($("#gemini-poll"), "Gemini interval adjusted to " + geminiPollMinutes + " minutes.");
    }
    patchCfg({
      pollSeconds: pollSeconds,
      geminiPollMinutes: geminiPollMinutes,
      transparency: Number($("#transparency").value),
      debug: $("#debug").checked,
      showClaude: $("#show-claude").checked,
      showCodex: $("#show-codex").checked,
      showGemini: $("#show-gemini").checked
    }, true);
  }

  // Smooth, interruptible accordion for Advanced settings.
  var details = $("details.advanced");
  var accordionAnim = null, accordionTargetOpen = false;
  function settleAccordion() {
    if (!details) return;
    var body = details.querySelector(".advanced-body");
    if (accordionAnim) {
      var running = accordionAnim;
      accordionAnim = null;
      try { running.cancel(); } catch (_) {}
    }
    details.open = accordionTargetOpen;
    details.classList.remove("is-closing");
    if (body) {
      body.style.overflow = "";
      if ("inert" in body) body.inert = !accordionTargetOpen;
    }
  }
  if (details && !details.__qlBound) {
    details.__qlBound = true;
    var summary = details.querySelector("summary");
    var body = details.querySelector(".advanced-body");
    accordionTargetOpen = details.open;
    if (body && "inert" in body) body.inert = !details.open;
    summary.addEventListener("click", function (event) {
      if (!body || !motionAllowed() || typeof body.animate !== "function") {
        accordionTargetOpen = !details.open;
        if (body && "inert" in body) body.inert = !accordionTargetOpen;
        return;
      }
      event.preventDefault();
      var opening = !accordionTargetOpen;
      accordionTargetOpen = opening;
      var currentHeight = details.open ? body.getBoundingClientRect().height : 0;
      var currentOpacity = parseFloat(getComputedStyle(body).opacity);
      if (!Number.isFinite(currentOpacity)) currentOpacity = opening ? 0 : 1;
      if (accordionAnim) {
        var prev = accordionAnim;
        accordionAnim = null;
        try { prev.cancel(); } catch (_) {}
      }
      if (opening) {
        details.classList.remove("is-closing");
        details.open = true;
        if ("inert" in body) body.inert = false;
        var targetHeight = body.scrollHeight;
        body.style.overflow = "hidden";
        try {
          var openAnim = body.animate(
            [{ height: currentHeight + "px", opacity: currentHeight > 0 ? currentOpacity : 0 }, { height: targetHeight + "px", opacity: 1 }],
            { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
          );
          accordionAnim = openAnim;
          var finishOpen = function () {
            if (accordionAnim !== openAnim) return;
            accordionAnim = null;
            body.style.overflow = "";
          };
          openAnim.onfinish = finishOpen;
          openAnim.oncancel = finishOpen;
        } catch (_) { settleAccordion(); }
      } else {
        details.classList.add("is-closing");
        if ("inert" in body) body.inert = true;
        body.style.overflow = "hidden";
        try {
          var closeAnim = body.animate(
            [{ height: currentHeight + "px", opacity: currentOpacity }, { height: "0px", opacity: 0 }],
            { duration: 180, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }
          );
          accordionAnim = closeAnim;
          var finishClose = function () {
            if (accordionAnim !== closeAnim) return;
            accordionAnim = null;
            details.open = false;
            details.classList.remove("is-closing");
            body.style.overflow = "";
          };
          closeAnim.onfinish = finishClose;
          closeAnim.oncancel = finishClose;
        } catch (_) { settleAccordion(); }
      }
    });
  }

  if (motionMedia && typeof motionMedia.addEventListener === "function") {
    motionMedia.addEventListener("change", function () {
      if (motionMedia.matches) {
        setRefreshBusy(spinBusy);
        settleAccordion();
      }
    });
  }

  var slider = $("#transparency");
  var appearanceCard = $(".appearance-card");
  if (slider && appearanceCard) {
    var setAdjusting = function (active) { appearanceCard.classList.toggle("is-adjusting", active); };
    slider.addEventListener("pointerdown", function () { setAdjusting(true); });
    slider.addEventListener("focus", function () { setAdjusting(true); });
    ["pointerup", "pointercancel", "blur"].forEach(function (ev) { slider.addEventListener(ev, function () { setAdjusting(false); }); });
  }

  $("#refresh").addEventListener("click", function () {
    clearTimeout(statusTimer);
    clearRefreshFeedback();
    ++statusVersion;
    refreshing = true;
    $("#refresh").disabled = true;
    setRefreshBusy(true);
    setStatus("Refreshing usage in this page…", "loading", false);
    activeTab().then(function (tab) {
      if (!supported(tab) || UsageProviders.isGeminiUsage(tab.url)) {
        refreshing = false; setRefreshBusy(false); refreshStatus(); return;
      }
      chrome.tabs.sendMessage(tab.id, { type: "cum-poll" }, function (resp) {
        refreshing = false;
        if (chrome.runtime.lastError || !resp) {
          $("#refresh").disabled = false;
          setRefreshBusy(false);
          setStatus("Reload this page to connect the extension.", "error", true);
          showRefreshOutcome(false);
          return;
        }
        setRefreshBusy(false);
        showRefreshOutcome(resp.ok === true || (resp.ok === undefined && resp.status === "ok"));
        refreshStatus();
      });
    });
  });
  $("#sync").addEventListener("click", function () {
    activeTab().then(function (tab) {
      if (!supported(tab)) return;
      try { chrome.tabs.create({ url: UsageProviders.usageUrl(tab.url) }); }
      catch (error) { setStatus(error.message, "error", true); }
    });
  });
  $("#transparency").addEventListener("input", function () {
    var value = Number(this.value);
    showTransparency(value);
    patchCfg({ transparency: value }, false);
  });
  ["#poll", "#gemini-poll", "#debug", "#show-claude", "#show-codex", "#show-gemini"].forEach(function (selector) { $(selector).addEventListener("change", save); });
  getCfg().then(function (cfg) {
    showTransparency(cfg.transparency);
    $("#poll").value = UsageProviders.pollSetting("codex", cfg.pollSeconds);
    $("#gemini-poll").value = UsageProviders.pollSetting("gemini", cfg.geminiPollMinutes);
    $("#debug").checked = cfg.debug;
    $("#show-claude").checked = cfg.showClaude !== false;
    $("#show-codex").checked = cfg.showCodex !== false;
    $("#show-gemini").checked = cfg.showGemini !== false;
    refreshStatus();
  });
})();
