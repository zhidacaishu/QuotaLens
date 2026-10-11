const { test, expect } = require('@playwright/test');

for (const theme of ['light', 'dark']) {
  test(`${theme} popup fits Chrome's 600px limit and settings remain interactive`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 344, height: 600 });
    await page.goto('http://127.0.0.1:4173/popup-preview');
    await expect(page.locator('#status')).toContainText('Updated');
    expect(await page.locator('body').evaluate(el => el.scrollWidth)).toBe(344);
    expect(await page.locator('.wrap').evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(600);
    const slider = page.getByRole('slider', { name: 'Quota bar transparency' });
    const backgrounds = () => page.locator('body, .glass').evaluateAll(els => els.map(el => getComputedStyle(el).backgroundColor));
    const initialBackgrounds = await backgrounds();
    await slider.focus();
    await page.keyboard.press('Home');
    await expect(page.locator('#transparency-value')).toHaveText('0%');
    expect(await backgrounds()).toEqual(initialBackgrounds);
    await page.keyboard.press('End');
    await expect(page.locator('#transparency-value')).toHaveText('95%');
    expect(await backgrounds()).toEqual(initialBackgrounds);
    await page.keyboard.press('ArrowLeft');
    await expect(slider).toHaveAttribute('aria-valuetext', '94% transparent');
    // Restore the default appearance for visual inspection.
    for (let i = 0; i < 24; i++) await page.keyboard.press('ArrowLeft');
    const hidden = page.getByRole('switch', { name: 'Show quota on Claude', exact: true });
    await hidden.focus();
    await page.keyboard.press('Space');
    await expect(hidden).not.toBeChecked();
    await page.getByRole('button', { name: 'Refresh now' }).click();
    await expect(page.locator('#status')).toContainText('Updated');
    await page.screenshot({ path: testInfo.outputPath(`popup-${theme}.png`), fullPage: true });
    await page.getByText('Advanced settings', { exact: true }).click();
    await page.getByRole('switch', { name: 'Debug logging' }).check();
    await expect(page.getByRole('switch', { name: 'Debug logging' })).toBeChecked();
    await page.getByText('Advanced settings', { exact: true }).click();
    // Gemini adds a helper note; it must still fit the browser popup limit.
    await page.locator('#gemini-note').evaluate(el => { el.hidden = false; });
    expect(await page.locator('.wrap').evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(600);
  });
}

test('glass overview renders actual UI without overflow', async ({ page }, testInfo) => {
  await page.goto('http://127.0.0.1:4173');
  for (const title of ['Light quota bar', 'Dark quota bar']) {
    const frame = page.frameLocator(`iframe[title="${title}"]`);
    await expect(frame.locator('#cum-bar')).toBeVisible();
    await expect.poll(() => frame.locator('#cum-bar').evaluate(el => document.querySelector('#composer').getBoundingClientRect().top - el.getBoundingClientRect().bottom)).toBeCloseTo(6, 0);
    expect(await frame.locator('#cum-bar').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('glass-overview.png'), fullPage: true });
  await page.goto('http://127.0.0.1:4173/dark');
  await expect(page.frameLocator('iframe[title="Dark quota bar"]').locator('#cum-bar')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('glass-overview-dark.png'), fullPage: true });
});

test('narrow error text fits, and reduced transparency uses an opaque surface', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-reduced-motion', value: 'reduce' },
    { name: 'prefers-reduced-transparency', value: 'reduce' }
  ] });
  await page.goto('http://127.0.0.1:4173/provider?theme=dark&provider=codex&state=error');
  const bar = page.locator('#cum-bar');
  await expect(bar).toHaveAttribute('data-state', 'error');
  await expect(bar).toContainText('temporarily unavailable');
  await expect.poll(() => bar.evaluate(el => document.querySelector('#composer').getBoundingClientRect().top - el.getBoundingClientRect().bottom)).toBeCloseTo(6, 0);
  expect(await bar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await bar.evaluate(el => getComputedStyle(el).backdropFilter)).toBe('none');
  await page.screenshot({ path: testInfo.outputPath('narrow-error.png'), fullPage: true });
});

for (const theme of ['light', 'dark']) {
  test(theme + ' quota material responds to storage changes without fading text', async ({ page }) => {
    await page.goto('http://127.0.0.1:4173/provider?theme=' + theme + '&provider=codex');
    const bar = page.locator('#cum-bar');
    await expect(bar).toBeVisible();
    for (const [transparency, expected] of [[0, 1], [95, .05]]) {
      await page.evaluate(value => chrome.storage.local.set({ cfg: { transparency: value } }), transparency);
      await expect.poll(() => bar.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(theme === 'light' ? (expected === 1 ? 'rgb(255, 255, 255)' : 'rgba(255, 255, 255, 0.05)') : (expected === 1 ? 'rgb(24, 24, 24)' : 'rgba(24, 24, 24, 0.05)'));
      expect(await bar.locator('.cum-pct').first().evaluate(el => getComputedStyle(el).opacity)).toBe('1');
    }
    await page.getByRole('button', { name: 'Minimize usage' }).click();
    await expect(bar).toHaveClass(/cum-collapsed/);
    expect(await bar.evaluate(el => getComputedStyle(el).backgroundColor)).toContain('0.05)');
  });
}

test('dark helper text retains readable contrast on opaque and reduced-transparency surfaces', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('http://127.0.0.1:4173/popup-preview');
  const slider = page.getByRole('slider', { name: 'Quota bar transparency' });
  for (const reduced of [false, true]) {
    await slider.fill(reduced ? '95' : '0');
    if (reduced) {
      const session = await page.context().newCDPSession(page);
      await session.send('Emulation.setEmulatedMedia', { features: [
        { name: 'prefers-color-scheme', value: 'dark' },
        { name: 'prefers-reduced-transparency', value: 'reduce' }
      ] });
    }
    const contrast = await page.locator('#transparency-help').evaluate(el => {
      const foreground = getComputedStyle(el).color.match(/[0-9.]+/g).map(Number);
      const background = getComputedStyle(el.closest('.glass')).backgroundColor.match(/[0-9.]+/g).map(Number);
      if (background.length === 4 && background[3] !== 1) throw new Error('Expected opaque surface');
      const luminance = rgb => rgb.slice(0, 3).map(v => {
        const channel = v / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      return (luminance(foreground) + .05) / (luminance(background) + .05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  }
});
