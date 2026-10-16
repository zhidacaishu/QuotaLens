const { test, expect } = require('@playwright/test');

for (const provider of ['gemini', 'codex']) {
for (const theme of ['light', 'dark']) {
  test(theme + ' ' + provider + ' refresh and warning fit all bar widths', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('http://127.0.0.1:4173/provider?theme=' + theme + '&provider=' + provider);
    const bar = page.locator('#cum-bar');
    const refresh = bar.locator('.cum-refresh');
    await expect(refresh).toHaveAttribute('aria-disabled', 'false');
    for (const width of [240, 320, 519, 520, 600, 760, 1000]) {
      await page.locator('#composer').evaluate((el, width) => el.style.width = width + 'px', width);
      await expect.poll(() => bar.evaluate(el => el.getBoundingClientRect().width)).toBe(width);
      expect(await bar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      const bounds = await bar.evaluate(el => {
        const body = el.querySelector('.cum-body').getBoundingClientRect();
        const meta = el.querySelector('.cum-meta').getBoundingClientRect();
        return { clear: body.right <= meta.left, tracks: [...el.querySelectorAll('.cum-track')].every(el => el.getBoundingClientRect().width >= 8), text: [...el.querySelectorAll('.cum-pct,.cum-reset')].every(el => el.scrollWidth <= el.clientWidth) };
      });
      expect(bounds).toEqual({ clear: true, tracks: true, text: true });
      await bar.screenshot({ path: testInfo.outputPath('gemini-' + width + '.png') });
    }
    await page.locator('#composer').evaluate(el => el.style.width = '240px');
    await page.evaluate(provider => {
      window.refreshCalls = 0;
      const fetchUsage = () => { window.refreshCalls++; return new Promise((resolve, reject) => { window.failRefresh = reject; }); };
      if (provider === 'gemini') UsageGemini.fetchUsage = fetchUsage;
      else UsageProviders.fetchCodex = fetchUsage;
    }, provider);
    await refresh.focus(); await page.keyboard.press('Enter');
    await expect(refresh).toHaveAttribute('aria-busy', 'true');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => refreshCalls)).toBe(1);
    await page.evaluate(() => failRefresh(new Error('Network unavailable')));
    await expect(bar).toHaveAttribute('data-state', 'error');
    const warning = bar.locator('.cum-meta .cum-live');
    await expect(warning).toBeVisible();
    expect(await warning.evaluate(el => el.getBoundingClientRect().width)).toBe(12);
    await expect(warning).toHaveAttribute('aria-label', /showing last reading/);
    expect(await bar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await bar.screenshot({ path: testInfo.outputPath('gemini-error-240.png') });
    await page.evaluate(provider => {
      const fetchUsage = async () => ({ five: { pct: 43 }, weekly: { pct: 78 }, at: Date.now() });
      if (provider === 'gemini') UsageGemini.fetchUsage = fetchUsage;
      else UsageProviders.fetchCodex = fetchUsage;
    }, provider);
    await refresh.click();
    await expect(bar).toHaveAttribute('data-state', 'ok');
    await expect(bar.locator('.cum-pct').first()).toHaveText('43%');
    await page.getByRole('button', { name: 'Minimize usage' }).click();
    await expect(refresh).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show ' + (provider === 'gemini' ? 'Gemini' : 'Codex') + ' usage' })).toBeFocused();
  });
}

}

test('Codex compact error and collapsed warning remain visible', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 648, height: 800 });
  await page.goto('http://127.0.0.1:4173/provider?theme=dark');
  await expect(page.locator('#cum-bar')).toHaveAttribute('data-state', 'ok');
  await page.evaluate(() => {
    UsageProviders.fetchCodex = async () => { throw new Error('Network unavailable'); };
  });
  await page.getByRole('button', { name: 'Refresh Codex usage' }).click();
  await expect(page.locator('#cum-bar')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('.cum-meta .cum-live')).toBeVisible();
  await expect(page.locator('.cum-meta .cum-live')).toHaveText('!');
  await page.locator('#cum-bar').screenshot({ path: testInfo.outputPath('codex-error.png') });
  await page.getByRole('button', { name: 'Minimize usage' }).click();
  await expect(page.locator('.cum-restore .cum-live')).toBeVisible();
  await expect(page.locator('.cum-restore .cum-live')).toHaveAttribute('title', /showing last reading/);
});

test('popup exposes intervals only inside advanced settings and removes global hiding', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 344, height: 600 });
  await page.goto('http://127.0.0.1:4173/popup-preview');
  await expect(page.locator('#poll')).toBeHidden();
  await expect(page.locator('#hidden')).toHaveCount(0);
  await page.getByText('Advanced settings', { exact: true }).click();
  await expect(page.locator('#poll')).toBeVisible();
  await expect(page.locator('#gemini-poll')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('advanced.png'), fullPage: true });
});
