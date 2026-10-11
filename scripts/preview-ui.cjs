/* Local visual fixture: real UI files, synthetic quota only, no provider requests. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.QUOTALENS_PREVIEW_PORT) || 4173;
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const mock = `<script>
const stored = { cfg: { pollSeconds: 15, geminiPollMinutes: 5 } };
const listeners = [];
window.chrome = {
  storage: { local: { get: (_, cb) => cb(stored), set: (data, done) => { Object.assign(stored, data); listeners.forEach(cb => cb({cfg:{newValue:stored.cfg}}, 'local')); if (done) done(); }, remove() {} }, onChanged: { addListener(cb) { listeners.push(cb); } } },
  runtime: { onMessage: { addListener() {} } },
  tabs: { query: (_, cb) => cb([{ id: 1, url: 'https://chatgpt.com/c/preview' }]), sendMessage: (_, message, cb) => cb({ status: 'ok', hasData: true, at: Date.now() }), create() {} }
};
</script>`;
const providerPage = (theme, provider, state) => `<!doctype html><html class="${theme}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/content.css"><style>
*{box-sizing:border-box}body{margin:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;color:${theme === 'light' ? '#24354a' : '#e9eef6'};background:${theme === 'light' ? '#f7f8fb' : '#171b24'}}
.header{padding:24px 28px;font-weight:600;display:flex;justify-content:space-between}.sample{font-size:10px;opacity:.6;font-weight:400}.intro{margin:18px 28px;font-size:21px;font-weight:500;letter-spacing:-.5px}.hint{font-size:12px;opacity:.6;margin:8px 28px}
#composer{position:fixed;bottom:24px;left:24px;width:calc(100% - 48px);padding:16px;border:1px solid ${theme === 'light' ? '#dce2ec' : '#3b4555'};border-radius:24px;background:${theme === 'light' ? '#fff' : '#242b37'}}
#editor{min-height:32px;outline:none;white-space:pre-wrap;font-size:13px}#editor:empty::before{content:'Ask anything';opacity:.5}.toolbar{display:flex;justify-content:space-between;align-items:center;color:${theme === 'light' ? '#526277' : '#aebdd1'};font-size:12px}.send{border:0;border-radius:50%;width:28px;height:28px;background:${theme === 'light' ? '#24354a' : '#e3ebf8'};color:${theme === 'light' ? '#fff' : '#24354a'};font-size:17px}
</style></head><body><div class="header">${({codex:'Codex',claude:'Claude',gemini:'Gemini'})[provider]}<span class="sample">SAMPLE DATA · ${theme.toUpperCase()}</span></div><div class="intro">A little clarity. More room to think.</div><div class="hint">Your quota, right where you need it.</div><div id="composer" data-composer-surface-variant="default" data-testid="composer" class="input-area-container"><div id="editor" contenteditable="true" role="textbox" aria-label="Message"></div><div class="toolbar"><span>＋ &nbsp; Attach files</span><button class="send" aria-label="Send preview message">↑</button></div></div>
${mock}<script src="/src/providers.js"></script><script>
UsageProviders.identify = () => '${provider}';
const sample = async () => { if ('${state}' === 'error') throw new Error('Usage is temporarily unavailable. Try again shortly.'); return {five:{pct:38,resetMs:Date.now()+8280000},weekly:{pct:76,resetMs:Date.now()+316800000},at:Date.now()}; };
UsageProviders.fetchClaude = sample; UsageProviders.fetchCodex = sample; window.UsageGemini = {fetchUsage: sample};
</script><script src="/src/layout.js"></script><script src="/src/content.js"></script></body></html>`;
const index = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>QuotaLens · Glass preview</title><style>
*{box-sizing:border-box}body{margin:0;background:#e6ebf3;color:#23344a;font:14px -apple-system,BlinkMacSystemFont,sans-serif}main{max-width:1260px;margin:0 auto;padding:32px}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}h1{margin:0;font-size:25px;letter-spacing:-.7px}header p{color:#53657d;font-size:12px;margin:6px 0 0}.tag{font-size:10px;letter-spacing:1.5px;color:#52667e}.grid{display:grid;grid-template-columns:minmax(0,1fr) 344px;gap:28px}iframe{display:block;width:100%;border:0;border-radius:24px;box-shadow:0 12px 32px #1f385218}.bar-preview{height:326px;margin-bottom:20px}.popup{height:642px}label{font-size:11px;color:#52667e;display:block;margin:0 0 10px 3px}.dark{color-scheme:dark}.light{color-scheme:light}a{color:inherit}.extra{margin-top:22px;display:flex;gap:16px;font-size:12px}@media(max-width:800px){main{padding:16px}.grid{grid-template-columns:1fr}.popup{width:344px;max-width:100%}}
</style></head><body><main><header><div><h1>QuotaLens</h1><p>Liquid Glass inspired · adaptive light & dark surfaces</p></div><span class="tag">UI PREVIEW / SAMPLE DATA</span></header><div class="grid"><div><label>01 / LIGHT · COMPOSER BAR</label><iframe title="Light quota bar" class="bar-preview light" src="/provider?theme=light&provider=codex"></iframe><label>02 / DARK · COMPOSER BAR</label><iframe title="Dark quota bar" class="bar-preview dark" src="/provider?theme=dark&provider=claude"></iframe></div><div><label>03 / SETTINGS · GLASS CONTROLS</label><iframe title="QuotaLens settings" class="popup light" src="/popup-preview"></iframe></div></div><div class="extra"><a href="/dark">Dark settings</a><a href="/provider?theme=light&provider=gemini">Gemini layout</a><a href="/provider?theme=dark&provider=codex&state=error">Error state</a></div></main></body></html>`;
const allowed = new Set(['popup.css','src/providers.js','src/layout.js','src/content.js','src/content.css','popup.js','icons/quotalens.svg']);
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let body, type = 'text/html';
  if (url.pathname === '/' || url.pathname === '/dark') body = url.pathname === '/dark' ? index.replace('class="popup light"', 'class="popup dark"') : index;
  else if (url.pathname === '/provider') body = providerPage(url.searchParams.get('theme') === 'light' ? 'light' : 'dark', ['claude','gemini'].includes(url.searchParams.get('provider')) ? url.searchParams.get('provider') : 'codex', url.searchParams.get('state') === 'error' ? 'error' : 'ok');
  else if (url.pathname === '/popup-preview') body = read('popup.html').replace('<script src="src/providers.js">', mock + '<script src="src/providers.js">');
  else if (allowed.has(url.pathname.slice(1))) { const file = url.pathname.slice(1); body = read(file); type = file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript'; }
  else { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body);
}).listen(port, '127.0.0.1', () => console.log('QuotaLens UI preview: http://127.0.0.1:' + port));
