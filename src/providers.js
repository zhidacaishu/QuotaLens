/* Shared provider metadata and parsers. No credentials or conversation content
 * are persisted here. Missing windows stay unknown, never assumed to be 0%. */
(function (root) {
  "use strict";

  function identify(value) {
    var url;
    try { url = new URL(value); } catch (_) { return null; }
    if (url.protocol !== "https:") return null;
    if (url.hostname === "claude.ai" || url.hostname.endsWith(".claude.ai")) return "claude";
    if (url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com") return "codex";
    if (url.hostname === "gemini.google.com") return "gemini";
    return null;
  }

  function geminiAccount(value) {
    var url = new URL(value);
    var path = url.pathname.match(/^\/u\/(\d+)(?:\/|$)/);
    var query = url.searchParams.get("authuser");
    // Account aliases/emails cannot safely be mapped to a numbered account.
    if (!path && query && !/^\d+$/.test(query)) throw new Error("Open Gemini using a /u/N/ account URL first");
    return path ? String(Number(path[1])) : query ? String(Number(query)) : "0";
  }

  function isGeminiUsage(value) {
    var url = new URL(value);
    return identify(value) === "gemini" && /^\/(?:u\/\d+\/)?usage\/?$/.test(url.pathname);
  }

  function usageUrl(value) {
    var provider = identify(value);
    if (provider === "gemini") return "https://gemini.google.com/u/" + geminiAccount(value) + "/usage";
    if (provider === "codex") return "https://chatgpt.com/codex/settings/usage";
    return "https://claude.ai/settings/usage";
  }

  function percent(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  }

  function parseCodex(data, now) {
    now = now || Date.now();
    var out = { five: null, weekly: null, at: now };
    var rate = data && data.rate_limit;
    if (!rate) return out;
    ["primary_window", "secondary_window"].forEach(function (slot) {
      var window = rate[slot];
      if (!window || percent(window.used_percent) === null) return;
      var seconds = window.limit_window_seconds;
      // Respect actual window lengths, including reversed primary/secondary.
      // Unknown nonstandard lengths must not masquerade as 5h or 7d.
      var key = seconds === 18000 ? "five" : seconds === 604800 ? "weekly"
        : seconds == null ? (slot === "primary_window" ? "five" : "weekly") : null;
      if (!key) return;
      var reset = null;
      if (typeof window.reset_at === "number" && Number.isFinite(window.reset_at) && window.reset_at > 0) reset = window.reset_at * 1000;
      else if (typeof window.reset_after_seconds === "number" && Number.isFinite(window.reset_after_seconds) && window.reset_after_seconds >= 0) reset = now + window.reset_after_seconds * 1000;
      out[key] = { pct: window.used_percent, resetMs: reset };
    });
    return out;
  }

  function accountId(session) {
    var user = session.user || {}, account = session.account || {};
    var candidates = [session.active_account_id, session.activeAccountId, session.account_id, session.accountId, account.id, user.account_id, user.accountId];
    return candidates.find(function (id) { return typeof id === "string" && id.length > 0; }) || null;
  }

  async function json(url, options) {
    var response = await fetch(url, Object.assign({ credentials: "include", cache: "no-store", signal: AbortSignal.timeout(15000) }, options));
    if (!response.ok) {
      var error = new Error(response.status === 401 || response.status === 403 ? "Sign in or open the official usage page (" + response.status + ")" : "Usage request failed (" + response.status + ")");
      error.status = response.status;
      if (response.status === 429) {
        var retry = response.headers.get("Retry-After");
        error.retryMs = Math.max(60000, /^\d+$/.test(retry || "") ? Number(retry) * 1000 : Date.parse(retry) - Date.now() || 60000);
      }
      throw error;
    }
    return response.json();
  }

  async function fetchCodex(onAccount) {
    var session = await json("/api/auth/session", { headers: { Accept: "application/json" } });
    if (!session || typeof session.accessToken !== "string" || !session.accessToken) {
      var error = new Error("Sign in to ChatGPT to read Codex usage"); error.status = 401; throw error;
    }
    var id = accountId(session);
    if (onAccount) onAccount(id || (session.user && session.user.id) || null);
    var headers = { Accept: "application/json", Authorization: "Bearer " + session.accessToken };
    if (id) headers["ChatGPT-Account-Id"] = id;
    // Token stays in this request's memory; never storage, page DOM or logs.
    return parseCodex(await json("/backend-api/wham/usage", { headers: headers }));
  }

  var FIVE = /^(?:current usage|current session|session usage|5\s*(?:hours?|h)(?:\s+(?:usage|limit))?|当前用量|目前用量|本次用量|当前使用量|目前使用量|5\s*小时(?:用量|限额)?|5\s*小時(?:用量|上限)?)$/i;
  var WEEK = /^(?:weekly(?:\s+(?:usage|limit|limits))?|7\s*(?:days?|d)(?:\s+(?:usage|limit))?|每周上限|每週上限|每周限额|每週限額|每周用量|每週用量|周用量|週用量)$/i;

  function textPercent(text) {
    var matches = [];
    var patterns = [
      { re: /(\d+(?:[.,]\d+)?)\s*[%％]\s*(?:used|已使用|已用)/gi, remaining: false },
      { re: /(?:used|已使用|已用)\s*[:：]?\s*(\d+(?:[.,]\d+)?)\s*[%％]/gi, remaining: false },
      { re: /(\d+(?:[.,]\d+)?)\s*[%％]\s*(?:remaining|left|剩余|剩餘)/gi, remaining: true },
      { re: /(?:remaining|剩余|剩餘)\s*[:：]?\s*(\d+(?:[.,]\d+)?)\s*[%％]/gi, remaining: true }
    ];
    patterns.forEach(function (pattern) {
      var match;
      while ((match = pattern.re.exec(text))) {
        var p = percent(Number(match[1].replace(",", ".")));
        if (p !== null) matches.push(pattern.remaining ? 100 - p : p);
      }
    });
    var unique = Array.from(new Set(matches));
    return unique.length === 1 ? unique[0] : null;
  }

  function parseGeminiDocument(doc, now) {
    var out = { five: null, weekly: null, at: now || Date.now() };
    var anchors = [];
    Array.from(doc.querySelectorAll("h1,h2,h3,h4,div,span,p,label")).forEach(function (el) {
      if (el.closest('#cum-bar, script, style, [hidden], [aria-hidden="true"]')) return;
      var style = doc.defaultView && doc.defaultView.getComputedStyle(el);
      if (style && (style.display === "none" || style.visibility === "hidden")) return;
      var text = el.textContent.trim();
      var key = FIVE.test(text) ? "five" : WEEK.test(text) ? "weekly" : null;
      if (key) anchors.push({ el: el, key: key });
    });
    anchors.forEach(function (anchor) {
      if (out[anchor.key]) return;
      var container = anchor.el;
      for (var depth = 0; container && container !== doc.body && depth < 7; depth++, container = container.parentElement) {
        // Never take a percentage from the other window's section.
        if (anchors.some(function (a) { return a.key !== anchor.key && container.contains(a.el); })) break;
        var text = container.innerText || container.textContent || "";
        var pct = textPercent(text);
        if (pct === null) continue;
        var reset = text.match(/(?:resets?(?:\s+(?:at|in|on))?|重置时间|重設時間|重设时间|重置時間|重置|重設)\s*[:：]?\s*([^\n]{1,100})/i);
        out[anchor.key] = { pct: pct, resetMs: null, resetText: reset ? reset[0].trim() : "" };
        if (reset) break;
      }
    });
    return out;
  }

  root.UsageProviders = { identify: identify, geminiAccount: geminiAccount, isGeminiUsage: isGeminiUsage,
    usageUrl: usageUrl, parseCodex: parseCodex, fetchCodex: fetchCodex, parseGeminiDocument: parseGeminiDocument,
    percent: percent, labels: { claude: "Claude", codex: "Codex", gemini: "Gemini" } };
})(globalThis);
