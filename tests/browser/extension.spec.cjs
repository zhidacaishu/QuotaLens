const { test, expect, chromium } = require('@playwright/test');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const quota = [1, [[100, 0.12, 1, [[2000000000, 0]]], [100, 0.34, 2, [[2000001000, 0]]]], true];
const envelope = id => ")]}'\n\n" + JSON.stringify([['wrb.fr', id, JSON.stringify(quota), null]]) + '\n';
const fixture = `<!doctype html><html class="dark"><head><style>
body{margin:0;background:#101010;color:white;font-family:system-ui}
#composer{position:fixed;bottom:24px;left:16px;width:calc(100% - 32px);padding:16px;box-sizing:border-box;border:1px solid gray;border-radius:24px}
#prompt-textarea{min-height:32px}
</style></head><body><div id="composer" data-composer-surface-variant="default" class="input-area-container"><div id="prompt-textarea" contenteditable="true" role="textbox" aria-label="Message">Unsent fixture draft</div></div></body></html>`;

// Load the actual manifest, CSS and content scripts in Chromium extension worlds.
// Every HTTP request is fulfilled locally: no real accounts or provider traffic.
for (const provider of ['codex', 'gemini']) {
  test(`installed extension: ${provider} world isolation, refresh and narrow layout`, async ({}, testInfo) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
      viewport: { width: 390, height: 844 }
    });
    try {
      const requests = [], rpcCalls = [], failures = [];
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        requests.push(url.pathname);
        if (url.pathname === '/api/auth/session') return route.fulfill({ json: { accessToken: 'fixture-token', active_account_id: 'fixture-account' } });
        if (url.pathname === '/backend-api/wham/usage') {
          expect(req.headers().authorization).toBe('Bearer fixture-token');
          expect(req.headers()['chatgpt-account-id']).toBe('fixture-account');
          return route.fulfill({ json: { rate_limit: {
            primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 2000000000 },
            secondary_window: { used_percent: 34, limit_window_seconds: 604800, reset_at: 2000001000 }
          } } });
        }
        if (url.pathname === '/u/1/_/BardChatUi/data/batchexecute') {
          rpcCalls.push(url.searchParams.get('rpcids'));
          expect(url.searchParams.get('source-path')).toBe('/u/1/usage');
          expect(new URLSearchParams(req.postData()).get('at')).toBe('fixture-at');
          return route.fulfill({ contentType: 'application/json', body: envelope(url.searchParams.get('rpcids')) });
        }
        if (url.pathname === '/u/1/usage') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
          <section style="display:none"><h2>Current usage</h2><p>99% used</p></section>
          <section><h2>Current usage</h2><p>12% used</p></section><section><h2>Weekly limit</h2><p>34% used</p></section>
          <script>fetch('/u/1/_/BardChatUi/data/batchexecute?rpcids=Rotated1&source-path=/u/1/usage', {method:'POST', body:new URLSearchParams({'f.req':JSON.stringify([[['Rotated1','[]',null,'generic']]]),at:'fixture-at'})});</script>
          </body></html>` });
        if (req.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: fixture });
        return route.abort();
      });
      await context.addInitScript(() => {
        window.WIZ_global_data = { SNlM0e: 'fixture-at', cfb2h: 'fixture-build', FdrFJe: 'fixture-session' };
        window.bridgeMessages = [];
        window.calibrated = false;
        window.addEventListener('cum-gemini-calibrated', () => { window.calibrated = true; });
        window.addEventListener('message', event => {
          if (event.data?.source === 'usage-meter-gemini-response') window.bridgeMessages.push(event.data);
        });
      });
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(error.message));
      await page.goto(provider === 'gemini' ? 'https://gemini.google.com/u/1/app' : 'https://chatgpt.com/');
      const bar = page.locator('#cum-bar');
      await expect(bar).toBeVisible();
      await expect(bar).toHaveAttribute('data-state', 'ok');
      await expect(bar.locator('.cum-pct')).toHaveText(['12%', '34%']);
      expect(await page.evaluate(() => typeof window.UsageProviders)).toBe('undefined');
      expect(await page.evaluate(() => typeof window.UsageGemini)).toBe('undefined');
      expect(await page.evaluate(() => JSON.stringify(window.bridgeMessages))).not.toContain('fixture-at');
      const bounds = await bar.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(16);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(374);
      expect(await page.locator('#composer').evaluate(el => el.getBoundingClientRect().top) - bounds.y - bounds.height).toBeCloseTo(6, 0);
      await expect(page.getByRole('textbox', {name:'Message'})).toHaveText('Unsent fixture draft');
      await page.getByRole('button', {name:'Minimize usage',exact:true}).click();
      await expect(bar).toHaveClass(/cum-collapsed/);
      await page.getByRole('button', {name:`Show ${provider === 'codex' ? 'Codex' : 'Gemini'} usage`,exact:true}).click();
      await expect(bar).not.toHaveClass(/cum-collapsed/);
      const before = requests.length;
      await page.locator('.cum-refresh').click();
      await expect.poll(() => requests.length).toBeGreaterThan(before);
      await expect(page.locator('.cum-refresh')).toHaveAttribute('aria-busy', 'false');
      await expect(bar).toHaveAttribute('data-state', 'ok');
      expect(failures).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`${provider}-installed-narrow.png`) });
      if (provider === 'gemini') {
        await page.goto('https://gemini.google.com/u/1/usage');
        await expect(bar).toHaveCount(0);
        // The isolated script announces successful calibration on the page.
        await expect.poll(() => page.evaluate(() => window.calibrated)).toBe(true);
        await page.goto('https://gemini.google.com/u/1/app');
        await expect(bar).toHaveAttribute('data-state', 'ok');
        expect(rpcCalls.at(-1)).toBe('Rotated1');
      }
    } finally { await context.close(); }
  });
}
