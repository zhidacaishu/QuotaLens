/* QuotaLens — provider-aware popup */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var DEF = { pollSeconds: 15, geminiPollMinutes: 5, debug: false, hidden: false };

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
  function save() {
    getCfg().then(function (cfg) {
      cfg.pollSeconds = Math.max(10, Number($("#poll").value) || 15);
      cfg.geminiPollMinutes = Math.max(1, Number($("#gemini-poll").value) || 5);
      cfg.debug = $("#debug").checked;
      cfg.hidden = $("#hidden").checked;
      chrome.storage.local.set({ cfg: cfg });
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
  ["#poll", "#gemini-poll", "#debug", "#hidden"].forEach(function (selector) { $(selector).addEventListener("change", save); });
  getCfg().then(function (cfg) {
    $("#poll").value = cfg.pollSeconds;
    $("#gemini-poll").value = cfg.geminiPollMinutes;
    $("#debug").checked = cfg.debug;
    $("#hidden").checked = cfg.hidden;
    refreshStatus();
  });
})();
