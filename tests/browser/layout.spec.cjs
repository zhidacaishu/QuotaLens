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
    await page.locator('.cum-min').click();
    await expect(bar).toHaveClass(/cum-collapsed/);
    await expect.poll(gap).toBeCloseTo(6, 0);
    await page.locator('.cum-restore').click();
    await expect(bar).not.toHaveClass(/cum-collapsed/);
    await page.evaluate(() => { document.querySelector('#attachments').style.height = '680px'; });
    await expect(bar).toBeHidden();
    await page.evaluate(() => { document.querySelector('#attachments').style.height = '50px'; });
    await expect(bar).toBeVisible();
  });
}
