# QuotaLens 隐私政策 / Privacy Policy

生效日期 / Effective date: 2026-10-03

## 中文

QuotaLens 仅用于在 Claude、ChatGPT / Codex 和 Gemini 网页中展示用量进度与重置时间。

- **本地处理**：仅在本地读取当前所处站点、输入框几何位置、回复生成状态及平台返回的额度数据，用于额度栏的定位与状态刷新；绝不收集或上传用户的聊天对话内容。
- **登录会话**：仅复用用户在对应平台已建立的登录会话请求用量信息。Codex 会话令牌与 Gemini 请求验证参数仅在发起请求过程中临时使用，既不持久化至扩展存储，亦不向开发者服务器或任何第三方传输。
- **本地存储**：仅在本地存储用户偏好设置以及按账号隔离的 Gemini RPC 校准标识。三家平台的额度读数与 Claude 组织标识仅暂存于当前页面内存中；扩展启动时会自动清理旧版本 Claude 未绑定账号的本地缓存。
- **网络请求**：网络请求严格限制在对应的 Claude、OpenAI 或 Google 官方域名之间，用于获取额度及必要的会话状态；用户点击打开官方用量页时亦直接访问对应官方平台。
- **无追踪机制**：不集成任何第三方数据分析、广告或遥测服务，不出售或向第三方转移用户数据。在用户主动开启调试日志时，仅在本地浏览器控制台输出刷新失败的平台名称与 HTTP 状态码，绝不记录原始额度响应报文或敏感会话参数。
- **数据清理**：卸载扩展即可彻底删除保存在本地的全部配置数据；驻留于页面内存的读数随标签页关闭即行释放。各平台自身持有的用户数据由其各自独立的隐私政策管辖。

扩展申请的目标站点访问权限仅用于读取额度数据及渲染显示界面，`storage` 权限仅用于保存本地设置与 Gemini RPC 校准标识。所有可执行代码均随扩展离线分发，绝不动态下载或执行远程代码。

若有疑问或反馈，请通过 [GitHub Issues](https://github.com/zhidacaishu/QuotaLens/issues) 联系维护者。在提交问题反馈时，请注意切勿附带登录令牌、敏感账号凭证或私密对话记录。

## English

QuotaLens displays usage and reset times on Claude, ChatGPT / Codex and Gemini pages.

- **Local processing**: reads the current supported site, composer geometry, response state and usage data to position and refresh the bar. It does not collect or upload conversation content.
- **Signed-in sessions**: uses your existing session with each platform to request usage. Codex session tokens and Gemini verification parameters are used during requests only, are not persisted in extension storage, and are not sent to a developer-operated server.
- **Local storage**: saves preferences and account-scoped Gemini RPC calibration identifiers. All usage readings and Claude organization identifiers remain in page memory. Legacy Claude disk caches are removed at startup.
- **Network requests**: requests usage and necessary session information only from the corresponding Claude, OpenAI or Google sites. Opening the official usage page visits that platform.
- **No tracking**: no analytics, advertising or telemetry; no sale or transfer of user data to third parties. When debug logging is enabled, the local console records the provider and HTTP status of failed refreshes, without raw usage responses or session parameters.
- **Deletion**: uninstalling the extension removes its local storage; closing the page releases its in-memory readings. Data held by the platforms is governed by their own privacy policies.

Site access is used to fetch quota and display the interface. The `storage` permission saves local settings and Gemini RPC calibration identifiers. All executable code ships with the extension; no remote code is downloaded or executed.

Contact the maintainer through [GitHub Issues](https://github.com/zhidacaishu/QuotaLens/issues). Do not include login tokens, account details or private conversations in reports.
