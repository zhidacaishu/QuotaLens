const { test, expect } = require('@playwright/test');

test('corner dock uses compact reset text when a wide composer cannot be anchored', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:4173/provider?theme=dark');
  await page.locator('#composer').evaluate(el => { Object.assign(el.style, { top: '16px', bottom: 'auto', width: '800px' }); });
  const bar = page.locator('#cum-bar');
  await expect(bar).toBeVisible();
  await expect(bar).not.toHaveClass(/cum-composer/);
  await page.screenshot({ path: testInfo.outputPath('fallback.png') });
  const resets = await bar.locator('.cum-reset').evaluateAll(els => els.map(el => ({ text: el.textContent, width: el.clientWidth, scroll: el.scrollWidth })));
  expect(resets.every(el => el.scroll <= el.width)).toBe(true);
});

test('missing reset or quota data keeps remaining values aligned without overflow', async ({ page }) => {
  await page.route('http://127.0.0.1:4173/provider?**', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('five:{pct:38,resetMs:Date.now()+8280000},weekly:{pct:76,resetMs:Date.now()+316800000}', 'five:null,weekly:{pct:100}');
    await route.fulfill({ response, body });
  });
  await page.goto('http://127.0.0.1:4173/provider?theme=dark');
  for (const width of [240, 520, 760]) {
    await page.locator('#composer').evaluate((el, w) => el.style.width = w + 'px', width);
    await expect.poll(() => page.locator('#cum-bar').evaluate(el => el.getBoundingClientRect().width)).toBe(width);
    await expect(page.locator('.cum-pct').first()).toHaveText('—');
    await expect(page.locator('.cum-pct').last()).toHaveText('100%');
    expect(await page.locator('#cum-bar').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(page.locator('.cum-reset').last()).toBeHidden();
  }
});

test('viewport-capped wide composer uses compact reset text', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await page.goto('http://127.0.0.1:4173/provider?theme=dark');
  await page.locator('#composer').evaluate(el => { el.style.width = '800px'; });
  const bar = page.locator('#cum-bar');
  await expect(bar).toHaveClass(/cum-compact/);
  await expect.poll(() => bar.evaluate(el => el.getBoundingClientRect().width)).toBe(668);
  expect(await bar.locator('.cum-reset').evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth))).toBe(true);
});
