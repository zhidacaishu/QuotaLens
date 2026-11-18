/* QuotaLens — provider-aware popup */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var DEF = { pollSeconds: 15, geminiPollMinutes: 5, debug: false, showClaude: true, showCodex: true, showGemini: true, transparency: 70 };

  function getCfg() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(["cfg"], function (data) { resolve(Object.assign({}, DEF, data.cfg || {})); });
    });
  }
  function activeTab() {
    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) { resolve(tabs && tabs[0]); });
    });
  }
  function supported(tab) { return tab && UsageProviders.identify(tab.url); }
  var statusTimer, statusVersion = 0, refreshing = false;
  function refreshStatus() {
    clearTimeout(statusTimer);
    if (refreshing) return;
    var version = ++statusVersion;
    activeTab().then(function (tab) {
      if (version !== statusVersion) return;
      var provider = supported(tab);
      $("#sync").disabled = !provider;
      $("#gemini-note").hidden = provider !== "gemini";
      if (!provider) {
        $("#refresh").disabled = true;
        $("#provider").textContent = "Claude · Codex · Gemini";
        $("#status").textContent = "Open Claude, ChatGPT or Gemini.";
        return;
      }
      $("#provider").textContent = UsageProviders.labels[provider] + (provider === "codex" ? " quota · shown in ChatGPT" : " quota");
      if (UsageProviders.isGeminiUsage(tab.url)) {
        $("#refresh").disabled = true;
        $("#status").textContent = "Return to a Gemini conversation to refresh its meter.";
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: "cum-status" }, function (resp) {
        var disconnected = chrome.runtime.lastError || !resp;
        if (version !== statusVersion) return;
        if (disconnected) {
          $("#refresh").disabled = false;
          $("#status").textContent = "Reload this page to connect the extension.";
          return;
        }
        var wait = Math.max(0, Math.ceil(((resp.retryAt || 0) - Date.now()) / 1000));
        $("#refresh").disabled = !!resp.busy || wait > 0;
        if (resp.busy || wait || resp.status === "loading") statusTimer = setTimeout(refreshStatus, 1000);
        if (wait) $("#status").textContent = "Rate limited — retry in " + wait + "s.";
        else if (resp.busy) $("#status").textContent = "Refreshing usage in this page…";
        else if (resp.status === "error") $("#status").textContent = resp.error || "Can't reach usage — check sign-in.";
        else if (!$("#show-" + provider).checked) $("#status").textContent = "Quota bar hidden for " + UsageProviders.labels[provider] + ".";
        else if (resp.hasData) {
          var seconds = Math.max(0, Math.round((Date.now() - resp.at) / 1000));
          $("#status").textContent = "Updated " + (seconds < 60 ? seconds + "s" : Math.round(seconds / 60) + "m") + " ago · percentages used";
        } else {
          $("#status").textContent = resp.status === "empty" ? "5h / 7d usage unavailable for this account." : "Loading usage…";
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
  function save() {
    getCfg().then(function (cfg) {
      cfg.pollSeconds = UsageProviders.pollSetting("codex", $("#poll").value);
      cfg.geminiPollMinutes = UsageProviders.pollSetting("gemini", $("#gemini-poll").value);
      $("#poll").value = cfg.pollSeconds;
      $("#gemini-poll").value = cfg.geminiPollMinutes;
      cfg.transparency = Number($("#transparency").value);
      cfg.debug = $("#debug").checked;
      delete cfg.hidden;
      cfg.showClaude = $("#show-claude").checked;
      cfg.showCodex = $("#show-codex").checked;
      cfg.showGemini = $("#show-gemini").checked;
      chrome.storage.local.set({ cfg: cfg }, refreshStatus);
    });
  }
  $("#refresh").addEventListener("click", function () {
    clearTimeout(statusTimer);
    ++statusVersion;
    refreshing = true;
    $("#refresh").disabled = true;
    $("#status").textContent = "Refreshing usage in this page…";
    activeTab().then(function (tab) {
      if (!supported(tab) || UsageProviders.isGeminiUsage(tab.url)) {
        refreshing = false; refreshStatus(); return;
      }
      chrome.tabs.sendMessage(tab.id, { type: "cum-poll" }, function (resp) {
        refreshing = false;
        if (chrome.runtime.lastError || !resp) {
          $("#refresh").disabled = false;
          $("#status").textContent = "Reload this page to connect the extension."; return;
        }
        refreshStatus();
      });
    });
  });
  $("#sync").addEventListener("click", function () {
    activeTab().then(function (tab) {
      if (!supported(tab)) return;
      try { chrome.tabs.create({ url: UsageProviders.usageUrl(tab.url) }); }
      catch (error) { $("#status").textContent = error.message; }
    });
  });
  $("#transparency").addEventListener("input", function () { showTransparency(Number(this.value)); save(); });
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
