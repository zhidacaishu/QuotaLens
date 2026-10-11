<p align="center">
  <img src="icons/quotalens.svg" width="96" height="96" alt="QuotaLens icon" />
</p>

<h1 align="center">QuotaLens</h1>
<p align="center">Your AI quota, in focus.</p>
<p align="center"><a href="README.md">简体中文</a> · <strong>English</strong></p>

QuotaLens is a Chrome extension that puts **Claude, Codex and Gemini 5-hour and weekly usage** right above your chat input. See how much you have used and when your quota resets without repeatedly opening settings.

## Supported pages

| Page | Quota shown | Source |
| --- | --- | --- |
| Claude and Claude Code on the web | Claude 5h / 7d usage | Organization usage endpoint through your signed-in session |
| ChatGPT and Codex on the web | **Codex** 5h / 7d usage | Codex usage endpoint through your signed-in session |
| Gemini on the web | Gemini 5h / 7d usage | Direct request to the official usage RPC in the current page |

## Install

Requires **Chrome 111 or later**.

1. Choose **Code → Download ZIP** in this repository and extract it to a permanent folder, or clone it using the command below.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Disable the original Usage Meter for Claude or older modified versions to avoid duplicate bars.
5. Refresh your signed-in Claude, ChatGPT or Gemini page.

```sh
git clone git@github.com:zhidacaishu/QuotaLens.git
```

**Node.js, npm and a build step are not needed for installation.** The repository includes the generated scripts and icons. Keep the loaded folder in place so Chrome can continue reading its files.

Claude usage is shown only when one chat-capable organization can be identified. Accounts with multiple eligible organizations are directed to the official usage page.

## Controls

Click the QuotaLens icon in Chrome's toolbar:

| Control | What it does |
| --- | --- |
| **Refresh now** | Fetch the current platform's usage; still respects server rate limits |
| **Open Usage page** | Open the platform's official usage page to compare readings |
| **Quota bar transparency** | Adjust the quota bar background from 0–90% transparency (default 70%). Saves and applies immediately; text and the settings page background stay unchanged |
| **Claude / Codex** | Set the polling interval, at least 10 seconds |
| **Gemini** | Set the idle refresh interval, at least 1 minute |
| **Hide bar completely** | Hide the bar; polling in visible pages continues |
| **Debug logging** | Enable diagnostic logging |

Use the arrow on the bar to collapse it, then click the chip to expand. Hover over a countdown for its exact reset time, or over the bar for the quota source.

## Data, permissions and privacy

[Privacy policy](PRIVACY.md)

- Requests `storage` and access to the supported Claude, ChatGPT and Gemini sites only. No all-site history, `cookies` or `scripting` permission.
- No telemetry, ads or third-party data server. Usage requests go to the respective platform.
- Session tokens and Gemini request verification parameters are used for requests only; they are not persisted in extension storage, logged or sent through cross-world messages.
- Settings and account-scoped Gemini RPC calibration identifiers are stored locally. All readings stay in page memory; legacy Claude disk caches are removed at startup.
- No conversation collection or upload. The extension observes composer geometry and response state to position and refresh the bar; it does not modify drafts.

Internal endpoints and page layouts can change. QuotaLens is not affiliated with Anthropic, OpenAI or Google. Implementation references and parsing boundaries are documented in [Data sources](docs/providers.md) (Chinese).

## Development

```sh
npm ci
npm run build
npm run check
npm test
```

Runtime code is plain JavaScript. `jsdom` supports tests and `sharp` exports SVG to the PNG icons required by Chrome; Playwright runs local Chromium layout checks. These development dependencies do not run inside the extension.

| Path | Purpose |
| --- | --- |
| `src/content.js` / `src/content.css` | Usage bar, state and refresh; src/layout.js handles positioning and overlap protection |
| `src/providers.js` | Platform detection and usage normalization |
| `src/gemini-*.js` | Gemini requests, page bridge and parsing |
| `popup.html` / `popup.js` | Toolbar popup and settings |
| `icons/quotalens.svg` | Editable vector icon source |
| `tests/` | Parsing, bridge, account isolation and layout lifecycle tests |

After editing Gemini MAIN or RPC helpers, run `npm run build` and include the generated `src/gemini-main.bundle.js`. After editing the icon, run `npm run build:icons` to export the 16 / 32 / 48 / 128px PNGs.

Unit tests use mocked sessions and geometry; separate Chromium tests exercise synthetic pages without signing in. See [Testing](docs/testing.md) for commands and limitations. No Claude subscription was available for this revision, so the live subscription page remains unverified. Earlier ChatGPT / Gemini checks are preserved as [historical records](docs/validation-history.md), not current live verification.

## Acknowledgments

- **[Usage Meter for Claude](https://chromewebstore.google.com/detail/usage-meter-for-claude/jlohkbicmcebjejobahelcfbdmhjfdie)** ([source](https://github.com/suresh8883/Claude-Usage-Meter-Chrome-Extension)): thank you to Suresh Kumar for the original project. QuotaLens extends its foundation, including quota visibility near the composer, Claude session-based usage fetching, progress display and refresh behavior. The original MIT copyright notice is retained.
- **[Voyager](https://github.com/Nagi-ovo/voyager)**: thank you for publishing the Gemini usage request and protocol parsing implementation. It informed the direct in-page request approach, account routing and quota-window mapping. QuotaLens implements its own adapter using those references, without temporary background tabs. Referenced files and the pinned commit are listed in [Data sources](docs/providers.md).
- Additional thanks to [AI Usage](https://github.com/cupcakedev/ai-usage-extension) for its Codex browser-session approach, and [Gemini Web Quota Monitor](https://github.com/Hakkinex/Gemini_Web_Quota_Monitor) for inspiring the early adaptation.

## License

[MIT](LICENSE), retaining Suresh Kumar's original copyright notice.

### Per-platform visibility

Use **Show quota on** to toggle Claude, Codex (including ChatGPT), and Gemini independently. All are on by default. Changes apply immediately to open pages and persist across reloads. These switches only affect display; visible pages keep refreshing usage. **Advanced settings → Hide all quota bars** overrides all three switches.
