const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../src/providers.js'), 'utf8');
const context = vm.createContext({ URL, AbortSignal });
vm.runInContext(source, context);
const p = context.UsageProviders;

test('host matching rejects lookalikes and account routing preserves /u/N and authuser', () => {
  assert.equal(p.identify('https://chatgpt.com/c/1'), 'codex');
  assert.equal(p.identify('https://chat.openai.com/'), 'codex');
  assert.equal(p.identify('https://chatgpt.com.evil.test/'), null);
  assert.equal(p.identify('http://gemini.google.com/'), null);
  assert.equal(p.usageUrl('https://gemini.google.com/u/3/app/abc'), 'https://gemini.google.com/u/3/usage');
  assert.equal(p.usageUrl('https://gemini.google.com/app?authuser=2'), 'https://gemini.google.com/u/2/usage');
  assert.throws(() => p.geminiAccount('https://gemini.google.com/app?authuser=user@example.test'));
});

test('Codex maps windows by duration, converts epoch/relative resets and keeps 1% as 1%', () => {
  const usage = p.parseCodex({ rate_limit: {
    primary_window: { used_percent: 85, limit_window_seconds: 604800, reset_at: 2000000000 },
    secondary_window: { used_percent: 1, limit_window_seconds: 18000, reset_after_seconds: 3600 }
  } }, 1000000);
  assert.equal(usage.five.pct, 1);
  assert.equal(usage.five.resetMs, 4600000);
  assert.equal(usage.weekly.pct, 85);
  assert.equal(usage.weekly.resetMs, 2000000000000);
});

test('Codex does not invent unavailable, unlimited, malformed or nonstandard quotas', () => {
  for (const data of [null, {}, { rate_limit: null }, { rate_limit: { primary_window: null } },
    { rate_limit: { primary_window: { used_percent: NaN } } },
    { rate_limit: { primary_window: { used_percent: '10' } } },
    { rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 86400 } } },
    { rate_limit: { primary_window: { used_percent: -1 } } },
    { rate_limit: { primary_window: { used_percent: 101 } } }]) {
    const usage = p.parseCodex(data);
    assert.equal(usage.five, null);
    assert.equal(usage.weekly, null);
  }
  assert.equal(p.parseCodex({ rate_limit: { primary_window: { used_percent: 0 } } }).five.pct, 0);
});

function read(t, html) {
  const dom = new JSDOM(html);
  t.after(() => dom.window.close());
  return p.parseGeminiDocument(dom.window.document);
}

test('Gemini parses English used/remaining independently and preserves reset wording', t => {
  const usage = read(t, '<main><section><h2>Current usage</h2><div><span>12% used</span></div><p>Resets at 4:30 PM</p></section><section><h2>Weekly limit</h2><p>65% remaining</p><p>Resets on October 2</p></section></main>');
  assert.equal(usage.five.pct, 12);
  assert.equal(usage.weekly.pct, 35);
  assert.equal(usage.five.resetText, 'Resets at 4:30 PM');
  assert.equal(usage.weekly.resetText, 'Resets on October 2');
  assert.equal(usage.five.resetMs, null); // no fabricated timezone/date
});

test('Gemini parses simplified/traditional Chinese and zero/100% correctly', t => {
  for (const [current, weekly, used] of [['当前用量', '每周上限', '已使用'], ['目前用量', '每週上限', '已使用']]) {
    const usage = read(t, `<main><section><h2>${current}</h2><p>${used} 0%</p><p>重設時間：上午2:03</p></section><section><h2>${weekly}</h2><p>${used} 100%</p></section></main>`);
    assert.equal(usage.five.pct, 0);
    assert.equal(usage.weekly.pct, 100);
    assert.equal(usage.five.resetText, '重設時間：上午2:03');
  }
});

test('Gemini missing session percentage never borrows weekly percentage', t => {
  const usage = read(t, '<main><section><h2>Current usage</h2><p>Loading…</p></section><section><h2>Weekly limit</h2><p>80% used</p></section></main>');
  assert.equal(usage.five, null);
  assert.equal(usage.weekly.pct, 80);
});

test('Gemini ignores injected meter, hidden sections, ambiguous percentages and unknown language', t => {
  const usage = read(t, '<main><div id="cum-bar"><h2>Weekly limit</h2><p>99% used</p></div><section hidden><h2>Weekly limit</h2><p>80% used</p></section><section><h2>Current usage</h2><p>20% used 30% used</p></section></main>');
  assert.equal(usage.five, null);
  assert.equal(usage.weekly, null);
  assert.equal(read(t, '<section><h2>Uso actual</h2><p>10%</p></section>').five, null);
});
