/* QuotaLens — provider-aware popup */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var DEF = { pollSeconds: 15, geminiPollMinutes: 5, debug: false, hidden: false, showClaude: true, showCodex: true, showGemini: true, transparency: 70 };

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
  function refreshStatus() {
    activeTab().then(function (tab) {
      var provider = supported(tab);
      $("#refresh").disabled = !provider;
      $("#sync").disabled = !provider;
      if (!provider) { $("#status").textContent = "Open Claude, ChatGPT or Gemini."; return; }
      $("#provider").textContent = UsageProviders.labels[provider] + (provider === "codex" ? " quota · shown in ChatGPT" : " quota");
      $("#gemini-note").hidden = provider !== "gemini";
      chrome.tabs.sendMessage(tab.id, { type: "cum-status" }, function (resp) {
        if (chrome.runtime.lastError || !resp) { $("#status").textContent = "Reload this page to connect the extension."; return; }
        getCfg().then(function (cfg) { updateVisibilityStatus(cfg, provider); });
        if (resp.status === "error") { $("#status").textContent = resp.error || "Can't reach usage — check sign-in."; return; }
        if (resp.hasData) {
          var seconds = Math.max(0, Math.round((Date.now() - resp.at) / 1000));
          $("#status").textContent = "Updated " + (seconds < 60 ? seconds + "s" : Math.round(seconds / 60) + "m") + " ago · percentages used";
        } else {
          $("#status").textContent = resp.status === "empty" ? "5h / 7d usage unavailable for this account." : "Loading usage…";
        }
      });
    });
  }
  function updateVisibilityStatus(cfg, provider) {
    if (cfg.hidden) $("#status").textContent = "All quota bars hidden in Advanced settings.";
    else if (cfg[{ claude: "showClaude", codex: "showCodex", gemini: "showGemini" }[provider]] === false)
      $("#status").textContent = "Quota bar hidden for " + UsageProviders.labels[provider] + ".";
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
      cfg.pollSeconds = Math.max(10, Number($("#poll").value) || 15);
      cfg.geminiPollMinutes = Math.max(1, Number($("#gemini-poll").value) || 5);
      cfg.transparency = Number($("#transparency").value);
      cfg.debug = $("#debug").checked;
      cfg.hidden = $("#hidden").checked;
      cfg.showClaude = $("#show-claude").checked;
      cfg.showCodex = $("#show-codex").checked;
      cfg.showGemini = $("#show-gemini").checked;
      chrome.storage.local.set({ cfg: cfg }, refreshStatus);
    });
  }
  $("#refresh").addEventListener("click", function () {
    activeTab().then(function (tab) {
      if (!supported(tab)) return;
      if (UsageProviders.isGeminiUsage(tab.url)) {
        $("#status").textContent = "Return to a Gemini conversation to refresh its meter."; return;
      }
      $("#refresh").disabled = true;
      $("#status").textContent = "Refreshing usage in this page…";
      chrome.tabs.sendMessage(tab.id, { type: "cum-poll" }, function (resp) {
        $("#refresh").disabled = false;
        if (chrome.runtime.lastError || !resp) { $("#status").textContent = "Reload this page to connect the extension."; return; }
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
  ["#poll", "#gemini-poll", "#debug", "#hidden", "#show-claude", "#show-codex", "#show-gemini"].forEach(function (selector) { $(selector).addEventListener("change", save); });
  getCfg().then(function (cfg) {
    showTransparency(cfg.transparency);
    $("#poll").value = cfg.pollSeconds;
    $("#gemini-poll").value = cfg.geminiPollMinutes;
    $("#debug").checked = cfg.debug;
    $("#hidden").checked = cfg.hidden;
    $("#show-claude").checked = cfg.showClaude !== false;
    $("#show-codex").checked = cfg.showCodex !== false;
    $("#show-gemini").checked = cfg.showGemini !== false;
    refreshStatus();
  });
})();
