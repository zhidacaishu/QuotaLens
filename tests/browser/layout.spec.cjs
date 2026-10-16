const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
// Synthetic local pages exercise Chromium layout/observers without a login or network.
for (const [host, card] of [
  ['claude.ai', 'data-testid="composer"'],
  ['chatgpt.com', 'data-composer-surface-variant="default"'],
  ['gemini.google.com', 'class="input-area-container"']
]) {
  test(host + ' positions above attachments, follows resize and preserves drafts', async ({ page }) => {
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html class="dark"><body>' +
      '<style>body{margin:0} #composer{position:fixed;bottom:24px;left:16px;width:calc(100% - 32px);box-sizing:border-box;padding:16px;border:1px solid gray;border-radius:20px} #attachments{height:50px} #scroller{height:80px;overflow:auto} #editor{min-height:70px;outline:0;white-space:pre-wrap}</style>' +
      '<div id="composer" ' + card + '><div id="attachments">Attachment</div><div id="scroller"><div id="editor" contenteditable="true" aria-label="Message">Unsent draft</div></div></div></body></html>' }));
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto('https://' + host + '/app');
    await page.addStyleTag({ content: read('src/content.css') });
    await page.evaluate(() => {
      const cfg = {};
      window.chrome = { storage: { local: { get: (_, cb) => cb({ cfg }), set: values => Object.assign(cfg, values.cfg), remove() {} }, onChanged: { addListener() {} } }, runtime: { onMessage: { addListener() {} } } };
      window.fetch = async url => ({ ok: true, json: async () => url === '/api/organizations' ? [{ uuid: 'test', capabilities: ['chat'] }] : url === '/api/auth/session' ? { accessToken: 'fake' } : url.includes('/wham/') ? { rate_limit: { primary_window: { used_percent: 17 }, secondary_window: { used_percent: 38 } } } : { five_hour: { utilization: 17 }, seven_day: { utilization: 38 } } });
      window.UsageGemini = { fetchUsage: async () => ({ five: { pct: 17 }, weekly: { pct: 38 }, at: Date.now() }) };
    });
    for (const file of ['src/providers.js', 'src/layout.js', 'src/content.js']) await page.addScriptTag({ content: read(file) });
    const bar = page.locator('#cum-bar');
    const gap = () => page.evaluate(() => document.querySelector('#composer').getBoundingClientRect().top - document.querySelector('#cum-bar').getBoundingClientRect().bottom);
    await expect(bar).toBeVisible();
    await expect.poll(gap).toBeCloseTo(6, 0);
    await page.locator('#editor').focus();
    await page.evaluate(() => { document.querySelector('#attachments').style.height = '200px'; });
    await expect.poll(gap).toBeCloseTo(6, 0);
    await expect(page.locator('#editor')).toBeFocused();
    await expect(page.locator('#editor')).toHaveText('Unsent draft');
    await page.evaluate(() => {
      document.querySelector('#editor').textContent = Array(100).fill('Long draft').join('\n');
      document.querySelector('#scroller').scrollTop = 10000;
    });
    await expect.poll(gap).toBeCloseTo(6, 0);
    await expect(bar).toBeVisible();
    await page.setViewportSize({ width: 360, height: 800 });
    await expect.poll(gap).toBeCloseTo(6, 0);
    const bounds = await bar.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(16);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(344);
    await page.getByRole('button', { name: 'Minimize usage', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(bar).toHaveClass(/cum-collapsed/);
    await expect.poll(gap).toBeCloseTo(6, 0);
    await expect(page.locator('.cum-restore')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(bar).not.toHaveClass(/cum-collapsed/);
    await expect(page.locator('.cum-min')).toBeFocused();
    await page.evaluate(() => { document.querySelector('#attachments').style.height = '680px'; });
    await expect(bar).toBeHidden();
    await page.evaluate(() => { document.querySelector('#attachments').style.height = '50px'; });
    await expect(bar).toBeVisible();
  });
}

// The current ChatGPT home shell has no <main> around its greeting.
test('ChatGPT home greeting outside main stays clear through collapse and navigation', async ({ page }, testInfo) => {
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html class="dark"><body>
    <style>body{margin:0;background:#101010;color:#dedede;font-family:system-ui}#home{position:absolute;top:40%;left:12%;width:76%}h1{text-align:center;font-size:24px;font-weight:400;margin:0 0 24px;line-height:32px}#composer{background:#212121;border:1px solid #303030;border-radius:28px;padding:16px;box-sizing:border-box}#editor{min-height:28px;outline:0}nav{position:absolute;left:0;top:0}nav h2{font-size:12px}</style>
    <nav><h2 id="sidebar-heading">Recent chats</h2></nav><div id="home"><h1 id="greeting">我们从哪里开始？</h1><div id="composer" data-composer-surface-variant="default"><div id="editor" contenteditable="true" aria-label="Message">Unsent draft</div></div></div></body></html>` }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('https://chatgpt.com/');
  await page.addStyleTag({ content: read('src/content.css') });
  await page.evaluate(() => {
    const cfg = {};
    window.chrome = { storage: { local: { get: (_, cb) => cb({ cfg }), set: values => Object.assign(cfg, values.cfg), remove() {} }, onChanged: { addListener() {} } }, runtime: { onMessage: { addListener() {} } } };
  });
  await page.addScriptTag({ content: read('src/providers.js') });
  await page.evaluate(() => { UsageProviders.fetchCodex = async () => ({five:{pct:47},weekly:{pct:7},at:Date.now()}); });
  for (const file of ['src/layout.js', 'src/content.js']) await page.addScriptTag({ content: read(file) });
  const bar = page.locator('#cum-bar');
  const gap = () => page.evaluate(() => document.querySelector('#cum-bar').getBoundingClientRect().top - document.querySelector('#greeting').getBoundingClientRect().bottom);
  await expect(bar).toBeVisible();
  await expect.poll(gap).toBeGreaterThanOrEqual(8);
  await page.locator('#editor').focus();
  const initialTop = await page.locator('#greeting').evaluate(el => el.getBoundingClientRect().top);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await expect.poll(gap).toBeGreaterThanOrEqual(8);
  await expect(page.locator('#editor')).toBeFocused();
  expect(await page.locator('#greeting').evaluate(el => el.getBoundingClientRect().top)).toBe(initialTop);
  expect(await page.locator('#sidebar-heading').evaluate(el => el.style.translate)).toBe('');
  expect((await bar.boundingBox()).height).toBeLessThanOrEqual(30);
  await page.screenshot({ path: testInfo.outputPath('chatgpt-home.png') });
  await page.getByRole('button', {name:'Minimize usage',exact:true}).click();
  await expect.poll(gap).toBeGreaterThanOrEqual(8);
  await page.getByRole('button', {name:'Show Codex usage',exact:true}).click();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect.poll(gap).toBeGreaterThanOrEqual(8);
  await expect(page.locator('#editor')).toHaveText('Unsent draft');
  await page.evaluate(() => { history.pushState({}, '', '/c/test'); window.dispatchEvent(new Event('resize')); });
  await expect.poll(() => page.locator('#greeting').evaluate(el => el.style.translate)).toBe('');
});

test('ChatGPT settings fields never become quota anchors and returning to chat restores placement', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://127.0.0.1:4173/provider?theme=dark&provider=codex');
  const bar = page.locator('#cum-bar');
  await expect(bar).toBeVisible();
  await page.evaluate(() => {
    window.savedComposer = document.querySelector('#composer');
    savedComposer.remove();
    const settings = document.createElement('section');
    settings.id = 'settings';
    settings.style.cssText = 'margin:80px auto;width:700px';
    settings.innerHTML = '<h1>ChatGPT 自定义指令</h1><textarea aria-label="Custom instructions" style="width:100%;height:220px">偏好段落式回答</textarea><label>昵称<input style="display:block;width:100%;margin:30px 0"></label><textarea style="width:100%;height:50px" placeholder="Message preferences"></textarea>';
    document.body.appendChild(settings);
  });
  await expect(bar).toHaveCount(0); // Full-page settings without a dialog or route change.
  await page.locator('textarea').first().focus();
  await page.screenshot({ path: testInfo.outputPath('settings-no-meter.png') });
  await page.evaluate(() => {
    document.querySelector('#settings').remove();
    document.body.appendChild(savedComposer);
    history.pushState({}, '', '/c/test#settings/Personalization');
  });
  await expect(bar).toHaveCount(0); // Settings hash with the chat still mounted underneath.
  await page.evaluate(() => { history.pushState({}, '', '/c/test'); });
  await expect(bar).toBeVisible();
  await expect.poll(() => page.evaluate(() => savedComposer.getBoundingClientRect().top - document.querySelector('#cum-bar').getBoundingClientRect().bottom)).toBeCloseTo(6, 0);
});
