const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser',
  use: { browserName: 'chromium', headless: true },
  workers: 1,
  reporter: 'list'
});
