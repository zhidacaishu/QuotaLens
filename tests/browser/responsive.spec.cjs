const { test, expect } = require('@playwright/test');

for (const theme of ['light', 'dark']) {
  test(theme + ' quota rows fit composer widths and retain readable values', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1490, height: 500 });
    await page.goto('http://127.0.0.1:4173/provider?theme=' + theme);
    const bar = page.locator('#cum-bar');
    await expect(bar).toBeVisible();
    // Resize the composer independently of the viewport, as side panels do.
    for (const width of [240, 280, 320, 375, 420, 519, 520, 600, 759, 760, 945, 1440]) {
      await page.locator('#composer').evaluate((el, width) => { el.style.width = width + 'px'; }, width);
      await expect.poll(() => bar.evaluate(el => el.getBoundingClientRect().width)).toBe(width);
      await expect.poll(() => bar.evaluate(el => document.querySelector('#composer').getBoundingClientRect().top - el.getBoundingClientRect().bottom)).toBeCloseTo(6, 0);
      const issues = await bar.evaluate(el => {
        const issues = [], box = el.getBoundingClientRect();
        for (const row of el.querySelectorAll('.cum-meter')) {
          let previousRight = 0;
          for (const child of row.children) {
            const r = child.getBoundingClientRect();
            if (!r.width || !r.height) { issues.push(child.className + ': hidden'); continue; }
            if (r.left < previousRight - .5 || r.right > box.right || r.bottom > box.bottom) issues.push(child.className + ': overlaps');
            if (child.matches('.cum-label,.cum-pct') && child.scrollWidth > child.clientWidth + 1) issues.push(child.className + ': clipped');
            if (child.matches('.cum-track') && r.width < 12) issues.push('track too short');
            previousRight = r.right;
          }
        }
        const button = el.querySelector('.cum-min').getBoundingClientRect();
        if (button.right > box.right || button.left < box.left) issues.push('button overflow');
        return issues;
      });
      expect(issues, 'composer width ' + width).toEqual([]);
      const box = await bar.boundingBox();
      await page.screenshot({ path: testInfo.outputPath('bar-' + width + '.png'), clip: { x: 16, y: box.y - 4, width: width + 16, height: 500 - box.y - 12 } });
    }
    // A truly narrow viewport must retain the same information and progress tracks.
    await page.locator('#composer').evaluate(el => { el.style.width = ''; });
    await page.setViewportSize({ width: 320, height: 500 });
    await expect.poll(() => bar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(bar.locator('.cum-track').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Minimize usage' })).toBeVisible();
  });
}
