const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser',
  use: { browserName: 'chromium', headless: true },
  workers: 1,
  webServer: { command: 'node scripts/preview-ui.cjs', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
  reporter: 'list'
});
