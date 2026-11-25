# QuotaLens 隐私政策 / Privacy Policy

生效日期 / Effective date: 2026-10-03

## 中文

QuotaLens 仅用于在 Claude、ChatGPT / Codex 与 Gemini 网页中展示用量进度及重置时间。

- **本地处理**：仅在本地读取当前访问站点、输入框几何位置、回复生成状态及平台返回的额度数据，用于额度栏定位与状态刷新，不会收集或上传用户的聊天对话内容。
- **登录会话**：仅复用用户在对应平台已建立的登录会话请求用量信息。Codex 会话令牌与 Gemini 请求验证参数仅在发起请求过程中临时使用，不会持久化至扩展存储，也不会传输至开发者服务器或任何第三方。
- **本地存储**：仅在本地保存用户偏好设置及按账号隔离的 Gemini RPC 校准标识。三家平台的额度读数与 Claude 组织标识仅暂存于当前页面内存中；扩展启动时会自动清理旧版本遗留的未绑定账号的 Claude 本地缓存。
- **网络请求**：网络请求严格限定于对应的 Claude、OpenAI 或 Google 官方域名，用于获取额度及必要的会话状态；用户点击打开官方用量页时亦直接跳转至对应官方平台。
- **无追踪机制**：不集成任何第三方数据分析、广告或遥测服务，不出售或向第三方转移用户数据。当用户主动开启调试日志时，仅在本地浏览器控制台输出刷新失败的平台名称与 HTTP 状态码，不记录原始额度响应报文或敏感会话参数。
- **数据清理**：卸载扩展即可彻底删除保存在本地的全部配置数据；驻留于页面内存的读数会随标签页关闭而释放。各平台自身持有的用户数据受其各自独立的隐私政策管辖。

扩展申请的目标站点访问权限仅用于读取额度数据及渲染显示界面，`storage` 权限仅用于保存本地设置与 Gemini RPC 校准标识。所有可执行代码均随扩展离线分发，不会动态下载或执行远程代码。

如有疑问或反馈，请通过 [GitHub Issues](https://github.com/zhidacaishu/QuotaLens/issues) 联系维护者。提交问题反馈时，请勿附带登录令牌、敏感账号凭证或私密对话记录。

## English

QuotaLens displays usage progress and reset times solely on Claude, ChatGPT / Codex, and Gemini web pages.

- **Local processing**: Reads only the current supported site, composer geometry, response state, and platform-returned usage data locally to position and refresh the bar. It never collects or uploads conversation content.
- **Signed-in sessions**: Reuses your existing signed-in session on each platform to request usage. Codex session tokens and Gemini verification parameters are used transiently during requests, are never persisted in extension storage, and are never transmitted to any developer-operated server or third party.
- **Local storage**: Stores only user preferences and account-scoped Gemini RPC calibration identifiers locally. Usage readings and Claude organization identifiers remain in page memory; legacy unscoped Claude disk caches are removed at startup.
- **Network requests**: Network requests are strictly limited to the respective Claude, OpenAI, or Google official domains for fetching usage and required session state. Opening the official usage page navigates directly to that platform.
- **No tracking**: Contains no analytics, advertising, or telemetry services, and does not sell or transfer user data to third parties. When debug logging is enabled, only the provider name and HTTP status code of failed refreshes are written to the local browser console, without raw usage responses or session parameters.
- **Data deletion**: Uninstalling the extension removes all locally stored settings; in-memory readings are released when the tab is closed. Data held by the platforms themselves is governed by their respective privacy policies.

Site access permissions are used solely to fetch quota data and render the interface, and the `storage` permission stores only local preferences and Gemini RPC calibration identifiers. All executable code is bundled offline with the extension; no remote code is downloaded or executed.

For questions or feedback, please contact the maintainer via [GitHub Issues](https://github.com/zhidacaishu/QuotaLens/issues). Do not include login tokens, sensitive account credentials, or private conversations in reports.
