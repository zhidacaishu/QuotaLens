const { test, expect } = require('@playwright/test');

test('quota bar collapse/expand, value updates, refresh feedback and interruptibility', async ({ page }, testInfo) => {
  for (const [theme, viewport] of [['dark', { width: 1280, height: 800 }], ['light', { width: 390, height: 780 }]]) {
    await page.setViewportSize(viewport);
    await page.goto(`http://127.0.0.1:4173/provider?theme=${theme}&provider=codex`);
    const bar = page.locator('#cum-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('data-state', 'ok');
    await expect(bar.locator('.cum-pct').first()).toHaveText('38%');

    // Progress fill settles to exact computed matrix scaleX matching 38%.
    await expect.poll(() => bar.locator('.cum-fill').first().evaluate(el => {
      const m = getComputedStyle(el).transform.match(/matrix\(([^,]+)/);
      return m ? Number(m[1]) : 0;
    })).toBeCloseTo(0.38, 2);

    // Mid-flight interruptible collapse -> expand -> collapse -> expand via direct dispatch.
    await bar.evaluate(el => {
      el.querySelector('.cum-min').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect(bar).toHaveClass(/cum-collapsed/);
    await page.waitForTimeout(55);
    await bar.evaluate(el => {
      el.querySelector('.cum-restore').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect(bar).not.toHaveClass(/cum-collapsed/);
    await page.waitForTimeout(55);
    await bar.evaluate(el => {
      el.querySelector('.cum-min').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect(bar).toHaveClass(/cum-collapsed/);
    await bar.evaluate(el => {
      el.querySelector('.cum-restore').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect(bar).not.toHaveClass(/cum-collapsed/);
    await page.waitForTimeout(300);

    const gap = () => page.evaluate(() => document.querySelector('#composer').getBoundingClientRect().top - document.querySelector('#cum-bar').getBoundingClientRect().bottom);
    await expect.poll(gap).toBeCloseTo(6, 0);
    expect(await bar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await bar.evaluate(el => getComputedStyle(el).clipPath)).toBe('none');

    // Manual refresh: smooth spin -> checkmark confirmation -> interruptible re-refresh.
    await page.evaluate(() => {
      window.nextQuota = { five: { pct: 64, resetMs: Date.now() + 7200000 }, weekly: { pct: 88, resetMs: Date.now() + 250000000 }, at: Date.now() };
      UsageProviders.fetchCodex = () => new Promise(resolve => {
        window.finishCodexRefresh = () => resolve(window.nextQuota);
      });
    });
    const refreshBtn = bar.locator('.cum-refresh');
    await refreshBtn.click();
    await expect(refreshBtn).toHaveAttribute('aria-busy', 'true');
    await page.waitForTimeout(180);
    await page.evaluate(() => window.finishCodexRefresh());
    await expect(refreshBtn).toHaveAttribute('aria-busy', 'false');
    await expect(refreshBtn).toHaveAttribute('data-feedback', 'done');
    await expect(bar.locator('.cum-pct').first()).toHaveText('64%');
    await expect(bar.locator('.cum-pct').last()).toHaveText('88%');
    await expect(bar.locator('.cum-fill').first()).toHaveClass(/cum-amber/);
    await expect(bar.locator('.cum-fill').last()).toHaveClass(/cum-red/);

    // Mid-tween temporary composer unmount commits exact target on remount with same data.
    await page.evaluate(() => {
      UsageProviders.fetchCodex = async () => ({ five: { pct: 12, resetMs: Date.now() + 7200000 }, weekly: { pct: 45, resetMs: Date.now() + 250000000 }, at: Date.now() });
    });
    await refreshBtn.click();
    await page.waitForTimeout(80); // Mid-way through 420ms numeric tween (64% -> 12%)
    await page.evaluate(() => {
      window._savedComposer = document.querySelector('#composer');
      window._savedComposer.remove();
    });
    await expect(bar).toHaveCount(0);
    await page.evaluate(() => {
      document.body.appendChild(window._savedComposer);
    });
    await expect(bar).toBeVisible();
    await expect(bar.locator('.cum-pct').first()).toHaveText('12%');
    await expect(bar.locator('.cum-fill').first()).toHaveClass(/cum-green/);

    await page.screenshot({ path: testInfo.outputPath(`motion-${theme}-${viewport.width}.png`) });
  }
});

test('obscured boundary does not oscillate and sets inert while hidden', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto('http://127.0.0.1:4173/provider?theme=dark&provider=codex');
  const bar = page.locator('#cum-bar');
  await expect(bar).toBeVisible();

  // Place a dialog overlapping the bar's top edge by 1px and repeatedly trigger resize.
  const flips = await page.evaluate(async () => {
    const barEl = document.getElementById('cum-bar');
    const r = barEl.getBoundingClientRect();
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.style.cssText = `position:fixed;left:${r.left}px;top:${r.top - 99}px;width:200px;height:100px;background:#333;`;
    document.body.appendChild(dlg);
    const states = [];
    for (let i = 0; i < 6; i++) {
      window.dispatchEvent(new Event('resize'));
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      states.push({ obscured: barEl.classList.contains('cum-obscured'), inert: barEl.inert });
    }
    dlg.remove();
    window.dispatchEvent(new Event('resize'));
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    return { states, restoredObscured: barEl.classList.contains('cum-obscured'), restoredInert: barEl.inert };
  });

  expect(flips.states.every(s => s.obscured && s.inert)).toBe(true);
  expect(flips.restoredObscured).toBe(false);
  expect(flips.restoredInert).toBe(false);
});

test('popup accordion, refresh checkmark, clamp feedback and 600px fit in light and dark', async ({ page }, testInfo) => {
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 344, height: 600 });
    await page.goto('http://127.0.0.1:4173/popup-preview');
    await expect(page.locator('#status')).toContainText('Updated just now');

    // Manual refresh triggers checkmark confirmation and stays accessible.
    const refresh = page.getByRole('button', { name: 'Refresh now' });
    await refresh.click();
    await expect(refresh).toHaveAttribute('data-feedback', 'done');

    // Accordion opens smoothly, can be interrupted mid-flight, sets inert on close, and cleans up.
    const summary = page.getByText('Advanced settings', { exact: true });
    const details = page.locator('details.advanced');
    const body = page.locator('.advanced-body');
    await summary.click();
    await expect(details).toHaveAttribute('open', '');
    await page.waitForTimeout(60);
    await summary.evaluate(el => el.click()); // Direct mid-flight interrupt
    expect(await body.evaluate(el => el.inert)).toBe(true);
    await expect(details).not.toHaveAttribute('open', '');
    await summary.click(); // Re-open cleanly
    await expect(details).toHaveAttribute('open', '');
    await page.waitForTimeout(280);
    expect(await body.evaluate(el => el.inert)).toBe(false);
    expect(await body.evaluate(el => el.style.overflow)).toBe('');

    // Clamping out-of-range interval updates value and announces via polite live region.
    const poll = page.locator('#poll');
    await poll.fill('2');
    await poll.dispatchEvent('change');
    await expect(poll).toHaveValue('10');
    await expect(page.locator('#sr-status')).toContainText('10 seconds');

    // Even with Advanced settings open + Gemini note visible, height stays <= 600px.
    await page.locator('#gemini-note').evaluate(el => { el.hidden = false; });
    const openHeight = await page.locator('.wrap').evaluate(el => el.getBoundingClientRect().height);
    expect(openHeight).toBeLessThanOrEqual(600);
    await page.screenshot({ path: testInfo.outputPath(`popup-motion-${theme}.png`), fullPage: true });
  }
});

test('reduced motion works at startup and when toggled mid-animation, while keeping static done feedback', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto('http://127.0.0.1:4173/provider?theme=dark&provider=codex');
  const bar = page.locator('#cum-bar');
  await expect(bar).toBeVisible();

  // Start a slow refresh and toggle reduced-motion ON mid-spin.
  await page.evaluate(() => {
    UsageProviders.fetchCodex = () => new Promise(resolve => { window._resolveQuota = resolve; });
  });
  await bar.locator('.cum-refresh').click();
  await expect(bar.locator('.cum-refresh')).toHaveAttribute('aria-busy', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => bar.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);

  // Resolve while reduced-motion is active: text updates synchronously and static checkmark still appears.
  await page.evaluate(() => window._resolveQuota({ five: { pct: 91, resetMs: Date.now() + 3600000 }, weekly: { pct: 55, resetMs: Date.now() + 86400000 }, at: Date.now() }));
  await expect(bar.locator('.cum-refresh')).toHaveAttribute('aria-busy', 'false');
  expect(await bar.locator('.cum-pct').first().textContent()).toBe('91%');
  await expect(bar.locator('.cum-refresh')).toHaveAttribute('data-feedback', 'done');
  expect(await bar.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);

  // Popup also skips animations under reduced motion and shrinks cleanly at 320px.
  await page.setViewportSize({ width: 320, height: 600 });
  await page.goto('http://127.0.0.1:4173/popup-preview');
  expect(await page.locator('body').evaluate(el => el.scrollWidth <= 320)).toBe(true);
  await page.getByText('Advanced settings', { exact: true }).click();
  await expect(page.locator('details.advanced')).toHaveAttribute('open', '');
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('long conversation scroll avoids per-frame layout work and continuous 4-edge composer resize stays locked', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('http://127.0.0.1:4173/provider?theme=dark&provider=codex');
  const bar = page.locator('#cum-bar');
  await expect(bar).toBeVisible();

  await page.evaluate(() => {
    const thread = document.createElement('div');
    thread.id = 'long-thread';
    thread.style.cssText = 'height:520px;overflow:auto;padding:16px 28px;';
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 400; i++) {
      const msg = document.createElement('article');
      msg.setAttribute('data-message-author-role', i % 2 ? 'assistant' : 'user');
      msg.style.cssText = 'padding:10px 14px;margin-bottom:8px;border-radius:12px;background:rgba(255,255,255,0.04);';
      msg.textContent = `Message #${i + 1}: Checking smooth frame pacing with a long conversation thread.`;
      frag.appendChild(msg);
    }
    thread.appendChild(frag);
    document.body.insertBefore(thread, document.querySelector('#composer'));
  });

  // 1) Scrolling the detached message thread should NOT trigger composer querySelectorAll each frame.
  const scrollQueries = await page.evaluate(() => new Promise(resolve => {
    const thread = document.getElementById('long-thread');
    const orig = document.querySelectorAll.bind(document);
    let count = 0;
    document.querySelectorAll = function () { count++; return orig.apply(document, arguments); };
    let frame = 0;
    function step() {
      frame++;
      thread.scrollTop = frame * 200;
      if (frame < 20) requestAnimationFrame(step);
      else { document.querySelectorAll = orig; resolve(count); }
    }
    requestAnimationFrame(step);
  }));
  expect(scrollQueries).toBeLessThanOrEqual(4);

  // 2) Continuous 4-edge composer geometry changes (width, height, bottom, left) stay frame-locked.
  const perf = await page.evaluate(() => new Promise(resolve => {
    const composer = document.getElementById('composer');
    const barEl = document.getElementById('cum-bar');
    const deltas = [];
    let maxVertDrift = 0, maxHorizDrift = 0;
    let last = performance.now();
    let frame = 0;
    function step(now) {
      deltas.push(now - last);
      last = now;
      frame++;
      const w = 1000 - (frame % 20) * 32;
      const left = 24 + (frame % 10) * 8;
      const bottom = 24 + (frame % 10) * 6;
      composer.style.width = w + 'px';
      composer.style.left = left + 'px';
      composer.style.bottom = bottom + 'px';
      if (frame < 36) {
        requestAnimationFrame(step);
      } else {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const cr = composer.getBoundingClientRect();
          const br = barEl.getBoundingClientRect();
          maxVertDrift = Math.abs((cr.top - br.bottom) - 6);
          maxHorizDrift = Math.max(Math.abs(cr.left - br.left), Math.abs(cr.right - br.right));
          deltas.sort((a, b) => a - b);
          const avg = deltas.reduce((s, v) => s + v, 0) / deltas.length;
          const p95 = deltas[Math.floor(deltas.length * 0.95)];
          resolve({ avg, p95, maxVertDrift, maxHorizDrift });
        }));
      }
    }
    requestAnimationFrame(step);
  }));

  expect(perf.maxVertDrift).toBeLessThanOrEqual(2);
  expect(perf.maxHorizDrift).toBeLessThanOrEqual(2);
  expect(perf.avg).toBeLessThan(34);
  expect(perf.p95).toBeLessThan(50);
});
