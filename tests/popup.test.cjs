const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { flush } = require('./helpers.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
async function setup(t, url, response = { status: 'ok', hasData: true, at: Date.now() }) {
  const dom = new JSDOM(read('popup.html'), { runScripts: 'outside-only' });
  const w = dom.window, sent = [], opened = [], stored = { cfg: { collapsed: true, staleMinutes: 12 } };
  t.after(async () => { await flush(); w.close(); });
  w.chrome = {
    storage: { local: { get: (_, cb) => cb(stored), set: (data, cb) => { Object.assign(stored, data); if (cb) cb(); } } },
    runtime: {}, tabs: {
      query: (_, cb) => cb([{ id: 1, url }]),
      sendMessage: (id, message, cb) => { sent.push(message.type); cb(response); },
      create: value => opened.push(value.url)
    }
  };
  w.eval(read('src/providers.js')); w.eval(read('popup.js'));
  await flush();
  return { w, sent, opened, stored, $: selector => w.document.querySelector(selector) };
}

test('popup disables actions on unsupported pages and reports connection errors', async t => {
  const unsupported = await setup(t, 'https://example.com');
  assert.equal(unsupported.$('#refresh').disabled, true);
  assert.equal(unsupported.$('#sync').disabled, true);
  assert.equal(unsupported.sent.length, 0);
  const disconnected = await setup(t, 'https://claude.ai/chat', null);
  assert.match(disconnected.$('#status').textContent, /Reload this page/);
});

test('popup refreshes supported pages, reports failures and opens account-scoped usage', async t => {
  const env = await setup(t, 'https://gemini.google.com/u/2/app', { status: 'error', error: 'Gemini rate limited' });
  assert.equal(env.$('#gemini-note').hidden, false);
  env.$('#refresh').click(); env.$('#sync').click();
  await flush();
  assert.deepEqual(env.sent, ['cum-status', 'cum-poll', 'cum-status']);
  assert.equal(env.$('#refresh').disabled, false);
  assert.match(env.$('#status').textContent, /rate limited/);
  assert.deepEqual(env.opened, ['https://gemini.google.com/u/2/usage']);
});

test('popup usage screen refresh gives instructions without issuing a recursive refresh', async t => {
  const env = await setup(t, 'https://gemini.google.com/u/2/usage');
  env.$('#refresh').click(); await flush();
  assert.deepEqual(env.sent, ['cum-status']);
  assert.match(env.$('#status').textContent, /Return to a Gemini conversation/);
});

test('popup clamps polling intervals and preserves settings it does not edit', async t => {
  const env = await setup(t, 'https://chatgpt.com/c/test');
  assert.match(env.$('#provider').textContent, /Codex/);
  env.$('#poll').value = '2'; env.$('#gemini-poll').value = '0.5';
  env.$('#debug').checked = true;
  env.$('#poll').dispatchEvent(new env.w.Event('change')); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(env.stored.cfg)), {
    pollSeconds: 10, geminiPollMinutes: 1, debug: true, collapsed: true, staleMinutes: 12, showClaude: true, showCodex: true, showGemini: true, transparency: 70
  });
});

for (const [provider, host] of [['Claude', 'claude.ai'], ['Codex', 'chatgpt.com'], ['Gemini', 'gemini.google.com']]) {
  test(provider + ' display switch persists independently and restores on reopening', async t => {
    const env = await setup(t, 'https://' + host + '/');
    const selector = '#show-' + provider.toLowerCase();
    assert.equal(env.$(selector).checked, true);
    env.$(selector).checked = false;
    env.$(selector).dispatchEvent(new env.w.Event('change'));
    await flush();
    assert.equal(env.stored.cfg['show' + provider], false);
    assert.equal(env.stored.cfg.collapsed, true);
    for (const other of ['Claude', 'Codex', 'Gemini'].filter(name => name !== provider)) assert.equal(env.stored.cfg['show' + other], true);
    assert.match(env.$('#status').textContent, /Quota bar hidden/);
    env.w.eval(read('popup.js')); await flush();
    assert.equal(env.$(selector).checked, false);
  });
}


test('transparency updates on input, persists zero, and restores without changing other settings', async t => {
  const env = await setup(t, 'https://chatgpt.com/c/test');
  assert.equal(env.$('#transparency').value, '70');
  for (const percent of [95, 94, 37, 1, 0]) {
    env.$('#transparency').value = percent;
    env.$('#transparency').dispatchEvent(new env.w.Event('input'));
    await flush();
    assert.equal(env.stored.cfg.transparency, percent);
    assert.equal(env.$('#transparency-value').textContent, percent + '%');
    assert.equal(env.stored.cfg.collapsed, true);
    assert.equal(env.$('#transparency').getAttribute('aria-valuetext'), percent + '% transparent');
  }
  env.w.eval(read('popup.js')); await flush();
  assert.equal(env.$('#transparency').value, '0');
  assert.equal(env.$('#transparency-value').textContent, '0%');
});
