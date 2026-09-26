/* ISOLATED-world Gemini adapter. The page bridge returns only quota values;
 * calibrated RPC identifiers (never credentials or request bodies) are saved. */
(function () {
  "use strict";
  if (location.origin !== "https://gemini.google.com") return;
  var rpc = UsageGeminiRPC;
  var COMMAND = "usage-meter-gemini-command", RESPONSE = "usage-meter-gemini-response";
  var ready = false, recipes = new Map(), pending = new Map(), candidates = [];
  var pingTimer = null, calibrationTimer = null;
  function route() { return rpc.route(location.href); }
  function key(account) { return "geminiRpc:" + account; }
  function post(values) { window.postMessage(Object.assign({ source: COMMAND }, values), location.origin); }
  function changed() { window.dispatchEvent(new Event("cum-gemini-calibrated")); }
  function recipeFor(account) {
    if (recipes.has(account)) return Promise.resolve(recipes.get(account));
    return new Promise(function (resolve) {
      chrome.storage.local.get([key(account)], function (data) {
        var stored = data && data[key(account)];
        var id = rpc.validId(stored) ? stored : rpc.DEFAULT_RPC;
        if (!recipes.has(account)) recipes.set(account, id);
        resolve(recipes.get(account));
      });
    });
  }
  function settle(id, error, usage) {
    var request = pending.get(id);
    if (!request) return;
    pending.delete(id); clearTimeout(request.timer);
    if (!pending.size && pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (error) request.reject(error); else request.resolve(usage);
  }
  function transmit(request) {
    if (request.sent || !ready) return;
    var here;
    try { here = route(); } catch (_) { here = null; }
    if (!here || here.account !== request.account) { settle(request.id, new Error("Gemini account changed; refresh again")); return; }
    request.sent = true;
    post({ type: "refresh", id: request.id, account: request.account, rpcid: request.rpcid });
  }
  async function fetchUsage() {
    var here = route();
    var id = await recipeFor(here.account);
    if (route().account !== here.account) throw new Error("Gemini account changed; refresh again");
    return new Promise(function (resolve, reject) {
      var request = { id: crypto.randomUUID(), account: here.account, rpcid: id, resolve: resolve, reject: reject, sent: false };
      request.timer = setTimeout(function () {
        settle(request.id, new Error("Gemini refresh timed out. Reload Gemini or open Usage page to recalibrate."));
      }, 25000);
      pending.set(request.id, request);
      if (ready) transmit(request);
      else {
        post({ type: "ping" });
        if (!pingTimer && !ready) pingTimer = setInterval(function () { post({ type: "ping" }); }, 250);
      }
    });
  }
  function calibrate() {
    calibrationTimer = null;
    var here;
    try { here = route(); } catch (_) { return; }
    if (!here.isUsage || !candidates.length) return;
    var dom = UsageProviders.parseGeminiDocument(document);
    // Require both independently labelled windows; missing DOM is not proof.
    if (!dom.five || !dom.weekly) return;
    candidates = candidates.filter(function (candidate) { return Date.now() - candidate.capturedAt < 20000 && candidate.account === here.account; });
    var matching = candidates.filter(function (candidate) {
      return candidate.usage.five && candidate.usage.weekly &&
        Math.abs(candidate.usage.five.pct - dom.five.pct) <= 1 && Math.abs(candidate.usage.weekly.pct - dom.weekly.pct) <= 1;
    });
    var ids = new Set(matching.map(function (candidate) { return candidate.rpcid; }));
    if (ids.size !== 1) return; // Ambiguity requires another real usage-page load.
    var id = matching[matching.length - 1].rpcid;
    if (recipes.get(here.account) === id) return;
    recipes.set(here.account, id);
    var update = {}; update[key(here.account)] = id;
    chrome.storage.local.set(update);
    changed();
  }
  function scheduleCalibration() {
    if (calibrationTimer || !candidates.length) return;
    calibrationTimer = setTimeout(calibrate, 200);
  }
  window.addEventListener("message", function (event) {
    if (event.source !== window || event.origin !== location.origin) return;
    var data = event.data;
    if (!data || data.source !== RESPONSE) return;
    if (data.type === "ready") {
      ready = true;
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      pending.forEach(transmit);
    } else if (data.type === "result") {
      var request = pending.get(data.id);
      if (!request || request.account !== data.account) return;
      var here;
      try { here = route(); } catch (_) { here = null; }
      if (!here || here.account !== data.account) { settle(data.id, new Error("Gemini account changed; refresh again")); return; }
      if (typeof data.error === "string") {
        var error = new Error(data.error.slice(0, 200));
        error.status = Number.isInteger(data.status) ? data.status : 0;
        error.retryMs = Number.isFinite(data.retryMs) ? Math.max(0, data.retryMs) : 0;
        settle(data.id, error); return;
      }
      var usage = rpc.cleanUsage(data.usage);
      settle(data.id, usage ? null : new Error("Gemini quota format changed; open Usage page to recalibrate"), usage);
    } else if (data.type === "capture") {
      var current;
      try { current = route(); } catch (_) { return; }
      if (!current.isUsage || current.account !== data.account || !rpc.validId(data.rpcid)) return;
      var captured = rpc.cleanUsage(data.usage);
      if (!captured) return;
      candidates.push({ account: data.account, rpcid: data.rpcid, usage: captured, capturedAt: Date.now() });
      candidates = candidates.slice(-8);
      scheduleCalibration();
    }
  });
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    var here;
    try { here = route(); } catch (_) { return; }
    var entry = changes[key(here.account)];
    if (!entry || !rpc.validId(entry.newValue) || recipes.get(here.account) === entry.newValue) return;
    recipes.set(here.account, entry.newValue); changed();
  });
  // Handles delayed Angular rendering and SPA navigation to the usage screen.
  new MutationObserver(scheduleCalibration).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.UsageGemini = { fetchUsage: fetchUsage };
  post({ type: "ping" });
})();
