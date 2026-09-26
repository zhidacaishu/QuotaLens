const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '../src/', file), 'utf8');
const fixture = '<main><section><h2>Current usage</h2><p>10% used</p></section><section><h2>Weekly limit</h2><p>30% used</p></section></main>';
const payload = (five = 0.1, week = 0.3) => [1, [[100, five, 1, [[2000000000, 0]]], [100, week, 2, [[1999999000, 0]]]], true];
const envelope = (id = 'jSf9Qc', data = payload()) => ")]}'\n\n200\n" + JSON.stringify([['wrb.fr', id, JSON.stringify(data), null]]) + '\n';
const body = id => new URLSearchParams({ 'f.req': JSON.stringify([[[id, '[]', null, 'generic']]]), at: 'secret' }).toString();
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

function setup(t, { route = '/u/2/app', html = '', fetchImpl, main = true, isolated = true, mockXHR = false } = {}) {
  const dom = new JSDOM(html, { url: 'https://gemini.google.com' + route, runScripts: 'outside-only' });
  const w = dom.window, requests = [], posted = [], stored = {}, timers = new Map(), observers = [];
  let sequence = 0;
  const NativeObserver = w.MutationObserver;
  w.MutationObserver = class extends NativeObserver { constructor(fn) { super(fn); observers.push(this); } };
  t.after(() => { observers.forEach(observer => observer.disconnect()); w.close(); });
  w.AbortSignal = AbortSignal; w.Request = Request;
  if (mockXHR) w.XMLHttpRequest = class extends w.EventTarget {
    static DONE = 4;
    open(method, url) { this.method = method; this.url = url; }
    send(body) { this.sentBody = body; }
  };
  w.setTimeout = (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id; };
  w.clearTimeout = id => timers.delete(id);
  w.setInterval = w.setTimeout; w.clearInterval = w.clearTimeout;
  w.WIZ_global_data = { SNlM0e: 'secret-at', cfb2h: 'secret-build', FdrFJe: 'secret-session' };
  const event = (data, origin = w.location.origin, source = w) => w.dispatchEvent(new w.MessageEvent('message', { data, origin, source }));
  w.postMessage = (data, target) => {
    assert.equal(target, w.location.origin);
    const clone = JSON.parse(JSON.stringify(data));
    posted.push(clone);
    queueMicrotask(() => { if (w.document) event(clone); });
  };
  w.fetch = (url, init) => {
    requests.push({ url, init });
    return fetchImpl ? fetchImpl(url, init) : Promise.resolve(new Response(envelope()));
  };
  w.chrome = { storage: {
    local: { get: (_, cb) => cb(stored), set: data => Object.assign(stored, data) },
    onChanged: { addListener() {} }
  }, tabs: { create() { throw new Error('Must never open tabs'); } } };
  w.eval(read('providers.js')); w.eval(read('gemini-rpc.js'));
  if (main) w.eval(read('gemini-main.js'));
  if (isolated) w.eval(read('gemini-usage.js'));
  const runTimers = ms => {
    for (const [id, timer] of Array.from(timers)) if (timer.ms === ms) { timers.delete(id); timer.fn(); }
  };
  return { w, requests, posted, stored, timers, event, runTimers };
}

test('Gemini RPC parser handles framing, exact periods, fractions and unrelated buckets', t => {
  const env = setup(t, { main: false, isolated: false });
  const data = payload(0.01, 0);
  data[1].reverse();
  data[1].push([100, 0.9, 3, [[2000000000, 0]]], ['unknown']);
  const parsed = env.w.UsageGeminiRPC.decode(envelope('NewRpc', data), 'NewRpc');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].usage.five.pct, 1);
  assert.equal(parsed[0].usage.weekly.pct, 0);
  assert.equal(parsed[0].usage.weekly.resetMs, 1999999000000); // reset order is irrelevant
  assert.equal(env.w.UsageGeminiRPC.decode(envelope(), 'WrongRpc').length, 0);
  assert.equal(env.w.UsageGeminiRPC.decode('html or invalid json').length, 0);
});

test('Gemini RPC parser never fills missing/malformed windows with 0%', t => {
  const env = setup(t, { main: false, isolated: false });
  const data = payload();
  data[1][0][1] = '0.1';
  const parsed = env.w.UsageGeminiRPC.decode(envelope('jSf9Qc', data));
  assert.equal(parsed[0].usage.five, null);
  assert.equal(parsed[0].usage.weekly.pct, 30);
  data[1][1][3] = [[null]];
  assert.equal(env.w.UsageGeminiRPC.decode(envelope('jSf9Qc', data)).length, 0);
});

test('Gemini bridge fetches directly with account-scoped endpoint and only returns normalized usage', async t => {
  const env = setup(t);
  const usage = await env.w.UsageGemini.fetchUsage();
  assert.equal(usage.five.pct, 10);
  assert.equal(usage.weekly.pct, 30);
  assert.equal(env.requests.length, 1);
  const request = env.requests[0], url = new URL(request.url);
  assert.equal(url.pathname, '/u/2/_/BardChatUi/data/batchexecute');
  assert.equal(url.searchParams.get('source-path'), '/u/2/usage');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.credentials, 'include');
  assert.equal(new URLSearchParams(request.init.body).get('at'), 'secret-at');
  assert.equal(JSON.stringify(env.posted).includes('secret'), false);
  assert.equal(JSON.stringify(env.stored).includes('secret'), false);
  assert.equal(env.timers.size, 0);
});

test('Gemini default account and authuser paths use matching usage source paths', async t => {
  for (const [route, prefix] of [['/app/chat', ''], ['/app?authuser=3', '/u/3']]) {
    const env = setup(t, { route });
    await env.w.UsageGemini.fetchUsage();
    const url = new URL(env.requests[0].url);
    assert.equal(url.pathname, prefix + '/_/BardChatUi/data/batchexecute');
    assert.equal(url.searchParams.get('source-path'), prefix + '/usage');
  }
});

test('Gemini bridge propagates 429 Retry-After and auth errors without leaking response text', async t => {
  for (const status of [429, 401, 403, 500]) {
    const env = setup(t, { fetchImpl: () => Promise.resolve(new Response('private debug payload', { status, headers: { 'Retry-After': '120' } })) });
    await assert.rejects(env.w.UsageGemini.fetchUsage(), error => {
      assert.equal(error.status, status);
      if (status === 429) assert.equal(error.retryMs, 120000);
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
    assert.equal(JSON.stringify(env.posted).includes('private debug'), false);
  }
});

test('Gemini direct RPC schema failures give recalibration instructions', async t => {
  const env = setup(t, { fetchImpl: () => Promise.resolve(new Response(envelope('unrelatedRPC'))) });
  await assert.rejects(env.w.UsageGemini.fetchUsage(), /recalibrate/);
  assert.deepEqual(env.stored, {});
});

test('Gemini capture calibrates rotated RPC against both DOM windows and stores only its ID', async t => {
  const env = setup(t, { route: '/u/2/usage', html: fixture, fetchImpl: () => Promise.resolve(new Response(envelope('NewRpc'))) });
  await env.w.fetch('/u/2/_/BardChatUi/data/batchexecute?rpcids=NewRpc', { method: 'POST', body: body('NewRpc') });
  await flush();
  env.runTimers(200);
  assert.deepEqual(env.stored, { 'geminiRpc:2': 'NewRpc' });
  env.w.history.pushState({}, '', '/u/2/app');
  const usage = await env.w.UsageGemini.fetchUsage();
  assert.equal(usage.five.pct, 10);
  assert.equal(new URL(env.requests[1].url).searchParams.get('rpcids'), 'NewRpc');
});

test('Gemini calibration waits for DOM and rejects mismatches, missing windows and foreign accounts', async t => {
  const env = setup(t, { route: '/u/2/usage', fetchImpl: () => Promise.resolve(new Response(envelope('NewRpc'))) });
  await env.w.fetch('/u/2/_/BardChatUi/data/batchexecute?rpcids=NewRpc', { method: 'POST', body: body('NewRpc') });
  await flush(); env.runTimers(200);
  assert.deepEqual(env.stored, {});
  env.w.document.body.innerHTML = fixture.replace('10% used', '99% used');
  await flush(); env.runTimers(200);
  assert.deepEqual(env.stored, {});
  env.w.document.body.innerHTML = fixture;
  await flush(); env.runTimers(200);
  assert.equal(env.stored['geminiRpc:2'], 'NewRpc');
  env.w.history.pushState({}, '', '/u/3/usage');
  env.event({ source: 'usage-meter-gemini-response', type: 'capture', rpcid: 'OtherRPC', account: '2', usage: { five: { pct: 10, resetMs: 2000000000000 }, weekly: { pct: 30, resetMs: 1999999000000 } } });
  env.runTimers(200);
  assert.equal(env.stored['geminiRpc:3'], undefined);
});

test('Gemini bridge rejects unrelated origin/window, stale IDs and account-switched responses', async t => {
  let finish;
  const env = setup(t, { fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  const waiting = env.w.UsageGemini.fetchUsage();
  const rejected = assert.rejects(waiting, /account changed/i);
  await flush();
  const command = env.posted.find(message => message.type === 'refresh');
  const fake = { source: 'usage-meter-gemini-response', type: 'result', id: command.id, account: '2', error: 'fake' };
  env.event(fake, 'https://evil.test');
  env.event(fake, env.w.location.origin, null);
  env.event({ ...fake, id: 'stale-id' });
  env.w.history.pushState({}, '', '/u/3/app');
  finish(new Response(envelope()));
  await rejected;
});

test('Gemini MAIN startup race is handled by ping; unavailable bridge times out without creating tabs', async t => {
  const env = setup(t, { main: false });
  const waiting = env.w.UsageGemini.fetchUsage();
  await flush();
  assert.equal(env.requests.length, 0);
  env.w.eval(read('gemini-main.js'));
  assert.equal((await waiting).five.pct, 10);
  const missing = setup(t, { main: false });
  const rejected = assert.rejects(missing.w.UsageGemini.fetchUsage(), /timed out/);
  await flush(); missing.runTimers(25000);
  await rejected;
  assert.equal(missing.requests.length, 0);
  assert.equal(missing.timers.size, 0);
});

test('Gemini fetch hook preserves the original promise and does not inspect conversation responses', async t => {
  let clones = 0;
  const original = Promise.resolve({ ok: true, clone() { clones++; return { text: async () => envelope() }; } });
  const env = setup(t, { isolated: false, fetchImpl: () => original });
  const result = env.w.fetch('/u/2/_/BardChatUi/data/batchexecute?rpcids=jSf9Qc', { body: body('jSf9Qc') });
  assert.equal(result, original);
  await flush();
  assert.equal(clones, 0);
  assert.equal(env.posted.some(item => item.type === 'capture'), false);
});

test('Gemini fetch Request objects are captured before their bodies are consumed', async t => {
  const env = setup(t, { route: '/u/2/usage', html: fixture, fetchImpl: async input => {
    if (input instanceof Request) await input.text();
    return new Response(envelope('NewRpc'));
  } });
  const input = new Request('https://gemini.google.com/u/2/_/BardChatUi/data/batchexecute?rpcids=NewRpc', { method: 'POST', body: body('NewRpc') });
  await env.w.fetch(input); await flush(); env.runTimers(200);
  assert.equal(env.stored['geminiRpc:2'], 'NewRpc');
});

test('Gemini XHR calibration preserves constructor/constants and captures only matching usage RPCs', async t => {
  const env = setup(t, { route: '/u/2/usage', html: fixture, mockXHR: true });
  const xhr = new env.w.XMLHttpRequest();
  assert.ok(xhr instanceof env.w.XMLHttpRequest);
  assert.equal(env.w.XMLHttpRequest.DONE, 4);
  xhr.open('POST', '/u/2/_/BardChatUi/data/batchexecute?rpcids=Rotated2');
  xhr.send(body('Rotated2'));
  assert.equal(xhr.sentBody, body('Rotated2'));
  xhr.status = 200; xhr.responseType = ''; xhr.responseText = envelope('Rotated2');
  xhr.dispatchEvent(new env.w.Event('load'));
  await flush(); env.runTimers(200);
  assert.equal(env.stored['geminiRpc:2'], 'Rotated2');
});

test('Gemini MAIN retains early calibration captures until the isolated bridge is listening', async t => {
  const env = setup(t, { route: '/u/2/usage', html: fixture, isolated: false,
    fetchImpl: () => Promise.resolve(new Response(envelope('Rotated3'))) });
  await env.w.fetch('/u/2/_/BardChatUi/data/batchexecute?rpcids=Rotated3', { method: 'POST', body: body('Rotated3') });
  await flush();
  env.w.eval(read('gemini-usage.js'));
  await flush(); env.runTimers(200);
  assert.equal(env.stored['geminiRpc:2'], 'Rotated3');
});
