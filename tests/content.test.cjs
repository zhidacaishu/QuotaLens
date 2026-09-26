const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8');
const providers = fs.readFileSync(path.join(__dirname, '../src/providers.js'), 'utf8');
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

// JSDOM has no layout engine. Supply geometry explicitly to exercise placement
// and DOM lifecycle with the actual content script; this is not visual QA.
async function setup(t, { route = '/code/session/test', host = 'claude.ai', width = 1000, fetchResponse, geminiResponse, missingAdapter = false,
  html = '<form id="composer"><textarea placeholder="Reply" id="editor"></textarea></form>' } = {}) {
  const dom = new JSDOM(html, { url: 'https://' + host + route, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const observers = [];
  const NativeMutationObserver = w.MutationObserver;
  w.MutationObserver = class extends NativeMutationObserver {
    constructor(callback) { super(callback); observers.push(this); }
  };
  t.after(() => { observers.forEach(observer => observer.disconnect()); dom.window.close(); });
  w.innerWidth = width;
  w.innerHeight = 800;
  const boxes = new Map();
  boxes.set('composer', rect(100, 600, Math.min(700, width - 32), 140));
  boxes.set('editor', rect(116, 620, Math.min(668, width - 64), 100));
  const ticks = [];
  const pending = [];
  const storageListeners = [];
  const requests = [];
  const messages = [];
  const messageListeners = [];
  w.AbortSignal = AbortSignal;
  w.setInterval = (fn, ms) => { ticks.push({ fn, ms }); return ticks.length; };
  w.clearInterval = () => {};
  w.setTimeout = (fn, ms) => { fn.delay = ms; pending.push(fn); return pending.length; };
  w.clearTimeout = id => { if (pending[id - 1]) pending[id - 1].cancelled = true; };
  w.ResizeObserver = class { observe() {} disconnect() {} };
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.id === 'cum-bar') {
      const collapsed = this.classList.contains('cum-collapsed');
      const attached = this.classList.contains('cum-composer');
      const size = collapsed ? 90 : parseFloat(this.style.width) || 290;
      const height = collapsed ? 30 : attached && !this.classList.contains('cum-narrow') ? 38 : 60;
      return rect(parseFloat(this.style.left) || width - size - 16, parseFloat(this.style.top) || 72, size, height);
    }
    return boxes.get(this.id) || rect(0, 0, 0, 0);
  };
  w.HTMLElement.prototype.getClientRects = function () {
    const r = this.getBoundingClientRect();
    return this.hidden || this.style.display === 'none' || !r.width ? [] : [r];
  };
  const stored = { cfg: {}, usage: { five: { pct: 17, resetMs: Date.now() + 3600000 }, weekly: { pct: 38 }, at: Date.now() } };
  w.chrome = {
    storage: {
      local: { get: (_, cb) => cb(stored), set: data => Object.assign(stored, data) },
      onChanged: { addListener: fn => storageListeners.push(fn) }
    },
    runtime: {
      onMessage: { addListener(fn) { messageListeners.push(fn); } },
      sendMessage() { throw new Error('Gemini must not use a background tab reader'); }
    }
  };
  w.UsageGemini = { fetchUsage() {
    messages.push({ type: 'direct-rpc' });
    return new Promise((resolve, reject) => {
      if (geminiResponse) geminiResponse({}, response => response.ok ? resolve(response.usage) : reject(new Error(response.error)));
      else resolve({ five: { pct: 25 }, weekly: { pct: 67 }, at: Date.now() });
    });
  } };
  w.fetch = async (url, options) => {
    requests.push(url);
    if (fetchResponse) return fetchResponse(url, options);
    return { ok: true, status: 200, json: async () => url === '/api/organizations' ? [{ uuid: 'test-org', capabilities: ['chat'] }] : { five_hour: { utilization: 17 }, seven_day: { utilization: 38 } } };
  };
  w.eval(providers);
  if (missingAdapter) delete w.UsageGemini;
  w.eval(source);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  const render = () => ticks.find(tick => tick.ms === 1000).fn();
  const setCfg = cfg => { stored.cfg = cfg; storageListeners.forEach(fn => fn({ cfg: { newValue: cfg } }, 'local')); };
  const message = type => new Promise(resolve => messageListeners.forEach(fn => fn({ type }, {}, resolve)));
  return { w, boxes, render, setCfg, requests, ticks, pending, messages, message, stored, bar: () => w.document.getElementById('cum-bar') };
}

test('Code meter sits above composer without modifying draft, focus or editor tree', async t => {
  const env = await setup(t);
  const editor = env.w.document.getElementById('editor');
  editor.value = 'unsent draft';
  editor.focus();
  editor.setSelectionRange(2, 7);
  const parent = editor.parentElement;
  env.render();
  const bar = env.bar();
  assert.equal(bar.parentElement, env.w.document.body);
  assert.ok(bar.classList.contains('cum-composer'));
  assert.equal(bar.getBoundingClientRect().bottom, 594);
  assert.equal(bar.getBoundingClientRect().right, 800);
  assert.equal(editor.value, 'unsent draft');
  assert.equal(env.w.document.activeElement, editor);
  assert.equal(editor.selectionStart, 2);
  assert.equal(editor.selectionEnd, 7);
  assert.equal(parent.children.length, 1);
  assert.match(bar.textContent, /17%/);
  assert.ok(env.ticks.some(tick => tick.ms === 15000));
  assert.deepEqual(env.requests, ['/api/organizations', '/api/organizations/test-org/usage']);
});

test('Code composer without form, including plaintext-only editor, gets anchored', async t => {
  const env = await setup(t, { route: '/cowork/code/test', html: '<div id="composer" style="border-radius:16px"><div id="editor" contenteditable="plaintext-only" role="textbox" aria-label="Message"></div></div>' });
  assert.ok(env.bar().classList.contains('cum-composer'));
  assert.equal(env.bar().getBoundingClientRect().bottom, 594);
});

test('narrow viewport and collapsed chip stay within viewport above composer', async t => {
  const env = await setup(t, { width: 360 });
  env.boxes.set('composer', rect(16, 600, 328, 140));
  env.boxes.set('editor', rect(32, 620, 296, 100));
  env.render();
  assert.ok(env.bar().classList.contains('cum-narrow'));
  assert.equal(env.bar().getBoundingClientRect().left, 16);
  assert.equal(env.bar().getBoundingClientRect().right, 344);
  env.bar().querySelector('.cum-min').click();
  assert.ok(env.bar().classList.contains('cum-collapsed'));
  assert.equal(env.bar().getBoundingClientRect().bottom, 594);
  env.bar().querySelector('.cum-restore').click();
  assert.equal(env.bar().classList.contains('cum-collapsed'), false);
});

test('ChatGPT home greeting clears the meter and restores on hide or conversation navigation', async t => {
  const env = await setup(t, { host: 'chatgpt.com', route: '/', html: '<main><h1 id="greeting">Welcome</h1><form id="composer"><textarea id="editor"></textarea></form></main>' });
  const greeting = env.w.document.getElementById('greeting');
  env.boxes.set('greeting', rect(300, 550, 200, 28));
  env.render();
  const shifted = greeting.style.translate;
  assert.equal(shifted, '0 -30px');
  env.render();
  assert.equal(greeting.style.translate, shifted); // No drift on the next timer tick.
  env.setCfg({ hidden: true });
  assert.equal(greeting.style.translate, '');
  env.setCfg({ hidden: false });
  assert.equal(greeting.style.translate, shifted);
  env.w.history.pushState({}, '', '/c/test');
  env.render();
  assert.equal(greeting.style.translate, '');
});

test('tracks editor expansion and falls back when there is no room above', async t => {
  const env = await setup(t);
  env.boxes.set('composer', rect(100, 400, 700, 340));
  env.boxes.set('editor', rect(116, 420, 668, 300));
  env.render();
  assert.equal(env.bar().getBoundingClientRect().bottom, 394);
  env.boxes.set('composer', rect(100, 20, 700, 720));
  env.boxes.set('editor', rect(116, 40, 668, 680));
  env.render();
  assert.equal(env.bar().classList.contains('cum-composer'), false);
  assert.equal(env.bar().style.top, '');
  assert.equal(env.bar().style.left, '');
  assert.equal(env.bar().style.visibility, 'hidden');
  env.boxes.set('composer', rect(100, 600, 700, 140));
  env.boxes.set('editor', rect(116, 620, 668, 100));
  env.render();
  assert.ok(env.bar().classList.contains('cum-composer'));
  assert.equal(env.bar().style.visibility, '');
});

test('SPA switching, composer remount, hidden setting and missing editor recover', async t => {
  const env = await setup(t);
  const doc = env.w.document;
  const original = env.bar();
  doc.getElementById('composer').remove();
  env.render();
  assert.equal(env.bar(), original);
  assert.equal(env.bar().classList.contains('cum-composer'), false);
  doc.body.insertAdjacentHTML('beforeend', '<form id="composer"><textarea id="editor"></textarea></form>');
  env.render();
  assert.ok(env.bar().classList.contains('cum-composer'));
  env.w.history.pushState({}, '', '/chat/test');
  env.render();
  assert.equal(env.bar().parentElement, doc.body);
  assert.ok(env.bar().classList.contains('cum-code-dock'));
  assert.equal(env.bar().getBoundingClientRect().left, 100);
  assert.equal(env.bar().getBoundingClientRect().width, 700);
  env.setCfg({ hidden: true });
  assert.equal(env.bar(), null);
  env.setCfg({ hidden: false });
  assert.ok(env.bar());
  env.w.history.pushState({}, '', '/settings');
  doc.getElementById('composer').remove();
  env.render();
  assert.equal(env.bar(), null);
});

test('ignores source editor, hidden/modal editors; overlapping modal hides meter', async t => {
  const env = await setup(t, { html: '<div class="monaco-editor"><textarea id="source"></textarea></div><textarea id="hidden" hidden></textarea><form id="composer"><textarea id="editor" placeholder="Reply"></textarea></form><div id="modal" role="dialog"><textarea id="modal-editor"></textarea></div>' });
  env.boxes.set('source', rect(10, 200, 800, 580));
  env.boxes.set('hidden', rect(10, 200, 800, 580));
  env.boxes.set('modal-editor', rect(400, 300, 300, 100));
  env.render();
  assert.equal(env.bar().getBoundingClientRect().bottom, 594);
  env.boxes.set('source', rect(10, 200, 70, 580));
  env.boxes.set('modal', rect(300, 300, 500, 400));
  env.render();
  assert.equal(env.bar().style.visibility, 'hidden');
  env.w.document.getElementById('modal').remove();
  env.render();
  assert.equal(env.bar().style.visibility, '');
});

test('ChatGPT displays Codex usage, authenticates requests and never persists tokens', async t => {
  const env = await setup(t, { host: 'chatgpt.com', route: '/c/test', fetchResponse: (url, options) => {
    if (url === '/api/auth/session') return { ok: true, json: async () => ({ accessToken: 'test-secret', active_account_id: 'account-a' }) };
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.equal(options.headers['ChatGPT-Account-Id'], 'account-a');
    return { ok: true, json: async () => ({ rate_limit: {
      primary_window: { used_percent: 1, limit_window_seconds: 18000 },
      secondary_window: { used_percent: 72, limit_window_seconds: 604800 }
    } }) };
  } });
  assert.equal(env.bar().querySelector('.cum-source').textContent, 'Codex · used');
  assert.ok(env.bar().classList.contains('cum-composer'));
  assert.equal(env.bar().querySelector('.cum-pct').textContent, '1%');
  assert.match(env.bar().textContent, /72%/);
  assert.equal(JSON.stringify(env.stored).includes('test-secret'), false);
  assert.equal(env.stored.usage.five.pct, 17); // Claude's cache untouched.
  assert.equal((await env.message('cum-status')).provider, 'Codex');
});

test('Codex missing windows are unknown; auth failure clears previous account usage', async t => {
  let signedIn = true;
  const env = await setup(t, { host: 'chatgpt.com', fetchResponse: url => {
    if (url === '/api/auth/session') return { ok: true, json: async () => signedIn ? { accessToken: 'test' } : {} };
    return { ok: true, json: async () => ({ rate_limit: { primary_window: { used_percent: 20 } } }) };
  } });
  const pcts = env.bar().querySelectorAll('.cum-pct');
  assert.equal(pcts[0].textContent, '20%');
  assert.equal(pcts[1].textContent, '—');
  signedIn = false;
  await env.message('cum-poll');
  assert.equal((await env.message('cum-status')).hasData, false);
  assert.match(env.bar().textContent, /Sign in to ChatGPT/);
  signedIn = true;
  await env.message('cum-poll');
  assert.equal((await env.message('cum-status')).hasData, true);
});

test('Codex failures show stale data honestly and respect Retry-After', async t => {
  let limited = false;
  const env = await setup(t, { host: 'chatgpt.com', fetchResponse: url => {
    if (url === '/api/auth/session') return { ok: true, json: async () => ({ accessToken: 'test' }) };
    if (limited) return { ok: false, status: 429, headers: { get: () => '120' } };
    return { ok: true, json: async () => ({ rate_limit: { primary_window: { used_percent: 20 } } }) };
  } });
  limited = true;
  await env.message('cum-poll');
  assert.match(env.bar().querySelector('.cum-source').textContent, /refresh failed/);
  const calls = env.requests.length;
  await env.message('cum-poll');
  assert.equal(env.requests.length, calls);
});

test('Gemini uses direct RPC, idle refresh and no Claude cache', async t => {
  const env = await setup(t, { host: 'gemini.google.com', route: '/u/2/app/test' });
  assert.equal(env.requests.length, 0);
  assert.equal(env.messages[0].type, 'direct-rpc');
  assert.match(env.bar().textContent, /Gemini · used/);
  assert.match(env.bar().textContent, /25%/);
  assert.match(env.bar().textContent, /67%/);
  assert.equal(env.bar().querySelector('.cum-source').href, 'https://gemini.google.com/u/2/usage');
  assert.ok(env.ticks.some(tick => tick.ms === 300000));
  env.w.document.dispatchEvent(new env.w.Event('visibilitychange'));
  assert.equal(env.messages.length, 1); // no unnecessary idle requests on focus
});

test('Gemini scope change drops old in-flight account result', async t => {
  const callbacks = [];
  const env = await setup(t, { host: 'gemini.google.com', route: '/u/0/app', geminiResponse: (_, cb) => callbacks.push(cb) });
  assert.doesNotMatch(env.bar().textContent, /17%/);
  env.w.history.pushState({}, '', '/u/1/app');
  env.render();
  callbacks[0]({ ok: true, usage: { five: { pct: 99 }, at: Date.now() } });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(callbacks.length, 2);
  assert.doesNotMatch(env.bar().textContent, /99%/);
  callbacks[1]({ ok: true, usage: { five: { pct: 12 }, at: Date.now() } });
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.match(env.bar().textContent, /12%/);
  assert.equal(env.bar().querySelector('.cum-source').href, 'https://gemini.google.com/u/1/usage');
});

test('Gemini usage pages never recursively open another usage page', async t => {
  const env = await setup(t, { host: 'gemini.google.com', route: '/u/0/usage' });
  assert.equal(env.bar(), null);
  assert.equal(env.messages.length, 0);
  await env.message('cum-poll');
  assert.equal(env.messages.length, 0);
});

test('Gemini refreshes after response completion without waiting for the idle interval', async t => {
  const env = await setup(t, { host: 'gemini.google.com', route: '/app' });
  const stop = env.w.document.createElement('button');
  stop.setAttribute('aria-label', 'Stop response');
  env.w.document.body.appendChild(stop);
  await Promise.resolve();
  stop.remove();
  await Promise.resolve();
  const refresh = env.pending.find(fn => fn.delay === 4000 && !fn.cancelled);
  assert.ok(refresh);
  refresh();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(env.messages.length, 2);
});

test('Gemini missing adapter reports an actionable error instead of staying on Loading', async t => {
  const env = await setup(t, { host: 'gemini.google.com', route: '/app', missingAdapter: true });
  const status = await env.message('cum-status');
  assert.equal(status.status, 'error');
  assert.match(status.error, /failed to initialize/);
  assert.match(env.bar().textContent, /failed to initialize/);
  assert.doesNotMatch(env.bar().textContent, /Loading Gemini/);
});

test('Gemini synchronous adapter exception follows the normal failure path', async t => {
  const env = await setup(t, { host: 'gemini.google.com', route: '/app' });
  env.w.UsageGemini.fetchUsage = () => { throw new Error('adapter startup failed'); };
  await env.message('cum-poll');
  assert.equal((await env.message('cum-status')).status, 'error');
});
