# QuotaLens 隐私政策 / Privacy Policy

生效日期 / Effective date: 2026-09-27

## 中文

QuotaLens 仅用于在 Claude、ChatGPT / Codex 和 Gemini 页面显示用量及重置时间。

- **本地处理**：读取当前站点、输入框位置、回复状态及平台返回的额度数据，用于定位和刷新额度栏；不收集或上传聊天内容。
- **登录会话**：使用你在对应平台已有的登录会话请求用量。Codex 会话令牌和 Gemini 请求验证参数只在请求过程中使用，不保存到扩展存储，也不发送到开发者服务器。
- **本地存储**：保存设置、Claude 组织标识及额度缓存，以及按账号区分的 Gemini RPC 校准标识。Codex / Gemini 额度读数保留在当前页面内存中。
- **网络请求**：只向对应的 Claude、OpenAI 或 Google 站点请求用量及必要的会话信息；手动打开官方用量页时会访问对应平台。
- **无跟踪**：不使用分析服务、广告或遥测，不出售或向第三方转移用户数据。开启调试时，Claude 额度响应及错误信息可能出现在本机浏览器控制台。
- **删除数据**：卸载扩展可删除其本地存储；页面内存数据随页面关闭而释放。平台自身保存的数据由其隐私政策管理。

相关站点访问权限用于读取额度和显示界面，`storage` 权限用于保存本地设置及缓存。所有执行代码随扩展分发，不下载或执行远程代码。

如有问题，请通过 [GitHub Issues](https://github.com/zhidacaishu/QuotaLens/issues) 联系维护者。提交问题时请勿附带登录令牌、账号信息或私人对话。

## English

QuotaLens displays usage and reset times on Claude, ChatGPT / Codex and Gemini pages.

- **Local processing**: reads the current supported site, composer geometry, response state and usage data to position and refresh the bar. It does not collect or upload conversation content.
- **Signed-in sessions**: uses your existing session with each platform to request usage. Codex session tokens and Gemini verification parameters are used during requests only, are not persisted in extension storage, and are not sent to a developer-operated server.
- **Local storage**: saves preferences, Claude organization identifiers and usage cache, and account-scoped Gemini RPC calibration identifiers. Codex / Gemini usage readings remain in the current page's memory.
- **Network requests**: requests usage and necessary session information only from the corresponding Claude, OpenAI or Google sites. Opening the official usage page visits that platform.
- **No tracking**: no analytics, advertising or telemetry; no sale or transfer of user data to third parties. When debug logging is enabled, Claude usage responses and errors may appear in the local browser console.
- **Deletion**: uninstalling the extension removes its local storage; closing the page releases its in-memory readings. Data held by the platforms is governed by their own privacy policies.

Site access is used to fetch quota and display the interface. The `storage` permission saves local settings and cache. All executable code ships with the extension; no remote code is downloaded or executed.

Contact the maintainer through [GitHub Issues](https://github.com/zhidacaishu/QuotaLens/issues). Do not include login tokens, account details or private conversations in reports.
