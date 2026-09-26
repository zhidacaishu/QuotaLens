/* Gemini wire-format helpers, shared by the two extension worlds.
 * Protocol reference: docs/providers.md. This module does not fetch or store. */
(function (root) {
  "use strict";
  var DEFAULT_RPC = "jSf9Qc";
  function validId(id) { return typeof id === "string" && /^[A-Za-z0-9]{4,32}$/.test(id); }

  function route(href) {
    var url = new URL(href);
    if (url.origin !== "https://gemini.google.com") throw new Error("Unsupported origin");
    var match = url.pathname.match(/^\/u\/(\d+)(?:\/|$)/);
    var query = url.searchParams.get("authuser");
    if (!match && query && !/^\d+$/.test(query)) throw new Error("Use a numbered Gemini account URL (/u/N/) first");
    var account = String(Number(match ? match[1] : query || 0));
    var prefix = match || query ? "/u/" + account : "";
    return { account: account, prefix: prefix, usagePath: prefix + "/usage",
      isUsage: /^\/(?:u\/\d+\/)?usage\/?$/.test(url.pathname) };
  }

  function readPayload(payload, now) {
    if (!Array.isArray(payload) || !Array.isArray(payload[1])) return null;
    var out = { five: null, weekly: null, at: now || Date.now() };
    var seen = new Set();
    for (var row of payload[1]) {
      if (!Array.isArray(row) || row.length < 4) continue;
      var key = row[2] === 1 ? "five" : row[2] === 2 ? "weekly" : null;
      var ratio = row[1];
      var epoch = Array.isArray(row[3]) && Array.isArray(row[3][0]) ? row[3][0][0] : null;
      if (!key || typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1.5 ||
          !Number.isInteger(epoch) || epoch < 1600000000 || epoch > 4102444800) continue;
      // Ambiguous duplicate buckets must not silently select a different limit.
      if (seen.has(key)) return null;
      seen.add(key);
      out[key] = { pct: Math.min(100, ratio * 100), resetMs: epoch * 1000 };
    }
    return out.five || out.weekly ? out : null;
  }

  function decode(text, expectedId) {
    if (typeof text !== "string" || text.length > 2000000) return [];
    // Decode only data-row JSON strings. Anti-XSSI prefixes, byte counts and
    // bookkeeping rows can then be ignored without guessing chunk lengths.
    var rowPattern = /\[\s*"wrb\.fr"\s*,\s*("(?:[^"\\]|\\.)*")\s*,\s*("(?:[^"\\]|\\.)*")/g;
    var result = [], match;
    while ((match = rowPattern.exec(text))) {
      try {
        var id = JSON.parse(match[1]);
        if (!validId(id) || (expectedId && expectedId !== id)) continue;
        var usage = readPayload(JSON.parse(JSON.parse(match[2])));
        if (usage) result.push({ rpcid: id, usage: usage });
      } catch (_) { /* Non-JSON and unrelated rows aren't quota data. */ }
    }
    return result;
  }

  function cleanUsage(input) {
    if (!input || typeof input !== "object") return null;
    var out = { five: null, weekly: null, at: Date.now() };
    for (var key of ["five", "weekly"]) {
      var value = input[key];
      if (!value || typeof value.pct !== "number" || !Number.isFinite(value.pct) || value.pct < 0 || value.pct > 100 ||
          typeof value.resetMs !== "number" || !Number.isFinite(value.resetMs) || value.resetMs < 1600000000000 || value.resetMs > 4102444800000) continue;
      out[key] = { pct: value.pct, resetMs: value.resetMs };
    }
    return out.five || out.weekly ? out : null;
  }

  root.UsageGeminiRPC = { DEFAULT_RPC: DEFAULT_RPC, validId: validId, route: route, decode: decode, cleanUsage: cleanUsage };
})(globalThis);
