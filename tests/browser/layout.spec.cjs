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

test('Codex work composer keeps its upper toolbar clickable in both meter states', async ({ page }, testInfo) => {
  await page.goto('http://127.0.0.1:4173/provider?provider=codex&theme=dark');
  await page.locator('#composer').evaluate(composer => {
    const root = document.createElement('div');
    root.setAttribute('data-codex-composer-root', '');
    root.style.cssText = 'position:fixed;bottom:24px;left:24px;width:calc(100% - 48px)';
    composer.before(root);
    const toolbar = document.createElement('button');
    toolbar.textContent = 'Default environment';
    toolbar.style.cssText = 'display:block;height:40px;margin:auto';
    toolbar.onclick = () => { toolbar.textContent = 'Selected environment'; };
    root.append(toolbar, composer);
    Object.assign(composer.style, { position: 'static', width: '100%' });
  });
  const bar = page.locator('#cum-bar');
  const toolbar = page.getByRole('button', { name: /environment/ });
  for (const width of [1000, 390]) {
    await page.setViewportSize({ width, height: 540 });
    for (const action of ['Minimize usage', 'Show Codex usage']) {
      await expect.poll(async () => {
        const box = await bar.boundingBox();
        return (await toolbar.boundingBox()).y - box.y - box.height;
      }).toBeCloseTo(6, 0);
      await page.getByRole('button', { name: action, exact: true }).click();
    }
    await toolbar.click();
    await expect(toolbar).toHaveText('Selected environment');
  }
  await page.screenshot({ path: testInfo.outputPath('codex-work-toolbar.png') });
});

test('Gemini meter follows the Chat / Task switch when it moves above the input on mobile', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/provider?provider=gemini');
  await page.locator('#composer').evaluate(composer => {
    const outer = document.createElement('div');
    outer.className = 'input-area-container';
    outer.style.cssText = 'position:fixed;bottom:0;left:0;width:100%;display:flex;align-items:center;flex-direction:column';
    composer.classList.remove('input-area-container');
    composer.before(outer);
    const toggle = document.createElement('chat-spark-toggle');
    toggle.innerHTML = '<button type="button">Chat</button><button type="button">Task</button>';
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'input-area-fieldset';
    fieldset.style.cssText = 'width:calc(100% - 64px);padding:0;margin:0;border:none';
    outer.append(fieldset, toggle);
    fieldset.appendChild(composer);
    Object.assign(composer.style, { position: 'static', width: '100%' });
    const style = document.createElement('style');
    style.textContent = '@media (max-width:520px) { chat-spark-toggle { order:-1; margin-bottom:12px } }';
    document.head.appendChild(style);
  });
  for (const width of [900, 390, 900]) {
    await page.setViewportSize({ width, height: 600 });
    for (const action of ['Minimize usage', 'Show Gemini usage']) {
      await expect.poll(() => page.locator('#cum-bar').evaluate(el => {
        const card = document.querySelector('.input-area-fieldset').getBoundingClientRect();
        const toggle = document.querySelector('chat-spark-toggle').getBoundingClientRect();
        return Math.min(card.top, toggle.top) - el.getBoundingClientRect().bottom;
      })).toBeCloseTo(6, 0);
      await page.getByRole('button', { name: 'Task', exact: true }).click({ trial: true });
      await page.getByRole('button', { name: action, exact: true }).click();
    }
    expect((await page.locator('#cum-bar').boundingBox()).width).toBe(width - 64);
  }
});
