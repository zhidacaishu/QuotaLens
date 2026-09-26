const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('manifest never reuses script URLs across execution worlds and all declared files exist', () => {
  const urls = new Set();
  for (const entry of manifest.content_scripts) {
    for (const file of entry.js) {
      assert.equal(urls.has(file), false, `${file} is reused across entries`);
      urls.add(file);
      assert.ok(fs.existsSync(path.join(root, file)));
    }
    for (const file of entry.css || []) assert.ok(fs.existsSync(path.join(root, file)));
  }
});

test('committed MAIN bundle matches source and initializes independently of isolated helpers', () => {
  const source = ['src/gemini-rpc.js', 'src/gemini-main.js'].map(read).join('\n');
  const bundle = read('src/gemini-main.bundle.js');
  assert.equal(bundle.slice(bundle.indexOf('\n') + 1), source);
  const context = vm.createContext({ URL, location: { origin: 'https://gemini.google.com', href: 'https://gemini.google.com/app' },
    addEventListener() {}, postMessage() {} });
  context.window = context;
  const entry = manifest.content_scripts.find(item => item.world === 'MAIN');
  for (const file of entry.js) vm.runInContext(read(file), context);
  assert.equal(typeof context.UsageGeminiRPC.decode, 'function');
  assert.equal(context.__usageMeterGeminiMain, true);
});
