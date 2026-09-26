<p align="center">
  <img src="icons/quotalens.svg" width="96" height="96" alt="QuotaLens icon" />
</p>

<h1 align="center">QuotaLens</h1>
<p align="center">Your AI quota, in focus.</p>
<p align="center"><a href="README.md">简体中文</a> · <strong>English</strong></p>

QuotaLens is a Chrome extension that puts **Claude, Codex and Gemini 5-hour and weekly usage** right above your chat input. See how much you have used and when your quota resets without repeatedly opening settings.

**On ChatGPT, the extension shows Codex quota, not GPT chat message limits.** Percentages represent usage: `75%` means 75% used. If a window is unavailable, it displays `—` rather than treating missing data as zero.

## Supported pages

| Page | Quota shown | Source |
| --- | --- | --- |
| Claude and Claude Code on the web | Claude 5h / 7d usage | Organization usage endpoint through your signed-in session |
| ChatGPT and Codex on the web | **Codex** 5h / 7d usage | Codex usage endpoint through your signed-in session |
| Gemini on the web | Gemini 5h / 7d usage | Direct request to the official usage RPC in the current page |

Availability depends on your plan and the data returned by the platform. QuotaLens does not estimate message counts or display separate credit balances or code review limits.

## Features

- **Quota beside your workflow**: an input-width bar with two progress meters, percentages and reset countdowns.
- **Compact, stable layout**: about 30px tall in a single row, with percentages and both kinds of timers at 11px. A fixed-width update timestamp prevents the layout from shifting as seconds change.
- **Responsive positioning**: two rows on narrow screens, collapse and hide controls, and support for composer resizing and in-page navigation. The ChatGPT home greeting gets space when needed.
- **Automatic refresh**: every 15 seconds by default for Claude / Codex; after replies and every 5 minutes when idle for Gemini. Hidden tabs stop automatic polling.
- **No temporary Gemini tabs**: usage is fetched directly from the current signed-in page.
- **No API key or server setup**: uses your existing browser sign-in.

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

### Update

Update your local files (`git pull` for a Git checkout), click **Reload** on QuotaLens in `chrome://extensions`, then refresh your chat pages. An unpacked installation does not update automatically through the Chrome Web Store.

## Controls

Click the QuotaLens icon in Chrome's toolbar:

| Control | What it does |
| --- | --- |
| **Refresh now** | Fetch the current platform's usage; still respects server rate limits |
| **Open Usage page** | Open the platform's official usage page to compare readings |
| **Claude / Codex** | Set the polling interval, at least 10 seconds |
| **Gemini** | Set the idle refresh interval, at least 1 minute |
| **Hide bar completely** | Hide the bar; polling in visible pages continues |
| **Debug logging** | Enable diagnostic logging |

Use the arrow on the bar to collapse it, then click the chip to expand. Hover over a countdown for its exact reset time, or over the bar for the quota source.

## Troubleshooting

- **Loading or an error**: check that you are signed in, reload the extension and page, and confirm the extension has access to that site.
- **Gemini cannot read usage**: choose **Open Usage page** in the popup, wait for the official usage numbers, then return to your chat and refresh. The extension tries to recalibrate the RPC identifier against that page; a changed response structure may still require a code update.
- **`—` or unavailable**: the platform did not return a recognized 5h / 7d window. This can depend on your plan or an endpoint change.
- **stale / refresh failed**: the displayed reading is old or a request failed. Refresh after connectivity recovers; wait if the platform has rate-limited requests.
- **Misplaced or duplicate bars**: disable other quota extensions and refresh. If no composer is found or there is too little space above it, the bar may fall back to a corner; it temporarily hides if it overlaps an editor or dialog.

## Data, permissions and privacy

- Requests `storage` and access to the supported Claude, ChatGPT and Gemini sites only. No all-site history, `cookies` or `scripting` permission.
- No telemetry, ads or third-party data server. Usage requests go to the respective platform.
- Session tokens and Gemini request verification parameters are used for requests only; they are not persisted in extension storage, logged or sent through cross-world messages.
- Settings, Claude usage cache and account-scoped Gemini RPC calibration identifiers are stored locally. Codex / Gemini readings stay in the current page's memory.
- No conversation collection or upload. The extension observes composer geometry and response state to position and refresh the bar; it does not modify drafts.

Internal endpoints and page layouts can change. QuotaLens is not affiliated with Anthropic, OpenAI or Google. Implementation references and parsing boundaries are documented in [Data sources](docs/providers.md) (Chinese).

## Development

```sh
npm ci
npm run build
npm run check
npm test
```

Runtime code is plain JavaScript. `jsdom` supports tests and `sharp` exports SVG to the PNG icons required by Chrome; neither runs inside the extension.

| Path | Purpose |
| --- | --- |
| `src/content.js` / `src/content.css` | Usage bar, positioning and refresh |
| `src/providers.js` | Platform detection and usage normalization |
| `src/gemini-*.js` | Gemini requests, page bridge and parsing |
| `popup.html` / `popup.js` | Toolbar popup and settings |
| `icons/quotalens.svg` | Editable vector icon source |
| `tests/` | Parsing, bridge, account isolation and layout lifecycle tests |

After editing Gemini MAIN or RPC helpers, run `npm run build` and include the generated `src/gemini-main.bundle.js`. After editing the icon, run `npm run build:icons` to export the 16 / 32 / 48 / 128px PNGs.

Layout tests use simulated geometry and do not replace real-browser checks. Core flows have been checked in Chrome on ChatGPT / Gemini; recent Claude layout changes have only automated regression coverage.

## Acknowledgments

- **[Usage Meter for Claude](https://chromewebstore.google.com/detail/usage-meter-for-claude/jlohkbicmcebjejobahelcfbdmhjfdie)** ([source](https://github.com/suresh8883/Claude-Usage-Meter-Chrome-Extension)): thank you to Suresh Kumar for the original project. QuotaLens extends its foundation, including quota visibility near the composer, Claude session-based usage fetching, progress display and refresh behavior. The original MIT copyright notice is retained.
- **[Voyager](https://github.com/Nagi-ovo/voyager)**: thank you for publishing the Gemini usage request and protocol parsing implementation. It informed the direct in-page request approach, account routing and quota-window mapping. QuotaLens implements its own adapter using those references, without temporary background tabs. Referenced files and the pinned commit are listed in [Data sources](docs/providers.md).
- Additional thanks to [AI Usage](https://github.com/cupcakedev/ai-usage-extension) for its Codex browser-session approach, and [Gemini Web Quota Monitor](https://github.com/Hakkinex/Gemini_Web_Quota_Monitor) for inspiring the early adaptation.

## License

[MIT](LICENSE), retaining Suresh Kumar's original copyright notice.
