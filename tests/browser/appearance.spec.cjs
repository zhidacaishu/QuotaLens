const { test, expect } = require('@playwright/test');

for (const theme of ['light', 'dark']) {
  test(`${theme} popup fits Chrome's 600px limit and settings remain interactive`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 344, height: 600 });
    await page.goto('http://127.0.0.1:4173/popup-preview');
    await expect(page.locator('#status')).toContainText('Updated');
    expect(await page.locator('body').evaluate(el => el.scrollWidth)).toBe(344);
    expect(await page.locator('.wrap').evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(600);
    const hidden = page.getByRole('switch', { name: 'Show quota on Claude', exact: true });
    await hidden.focus();
    await page.keyboard.press('Space');
    await expect(hidden).not.toBeChecked();
    await page.getByRole('button', { name: 'Refresh now' }).click();
    await expect(page.locator('#status')).toContainText('Updated');
    await page.screenshot({ path: testInfo.outputPath(`popup-${theme}.png`), fullPage: true });
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
