# 数据源与适配说明

核查日期：2026-09-27。适配版本：QuotaLens 0.5.0（沿用 0.4.2 的直接请求方案，统一三站额度栏）。

## Codex

- [OpenAI 官方 Codex 价格与用量说明](https://developers.openai.com/codex/pricing)：说明五小时用量区间、可能适用的每周限制以及官方 usage dashboard。固定消息数量只是估计，扩展不使用它们推算百分比。
- [AI Usage 扩展](https://github.com/cupcakedev/ai-usage-extension) 的 [UsageService.ts](https://github.com/cupcakedev/ai-usage-extension/blob/HEAD/src/background/services/UsageService.ts) 提供了浏览器会话读取方案：`/api/auth/session` → 带 Bearer 会话令牌访问 `/backend-api/wham/usage`。
- 本项目读取 `rate_limit.primary_window` / `secondary_window` 的 `used_percent`、`limit_window_seconds`、`reset_at` / `reset_after_seconds`。存在周期长度时按 18000 秒和 604800 秒映射，支持主次顺序颠倒；明确为其他长度的不冒充 5h/7d。长度缺省时使用接口主/次窗口约定。
- 请求使用会话明确提供的当前账号 ID；不会随意选择账号列表的第一项。多工作区账号应对照官方 Codex 用量页确认显示对象。
- 不展示 code review、额外模型额度或 credits 余额。这些不等价于用户要求的通用 5h/7d 配额。
- 上述网页接口是从公开实现核查到的内部接口，不是 OpenAI 官方承诺稳定的开发者 API。

## Gemini：0.4.1 直接 RPC

- [Google 官方 Gemini Apps limits](https://support.google.com/gemini/answer/16275805?hl=en)：五小时窗口及每周限制。官方用量入口为 Settings → Usage Limits。
- 参考 [Voyager 请求适配](https://github.com/Nagi-ovo/voyager/blob/82607fd9580a9fbd10f74cb352b9702883113dda/public/usage-observer.js) 与 [额度协议解析](https://github.com/Nagi-ovo/voyager/blob/82607fd9580a9fbd10f74cb352b9702883113dda/src/pages/content/usageStatus/index.ts)，核查的是固定提交 `82607fd9580a9fbd10f74cb352b9702883113dda`。
- 本项目依据其公开实现揭示的请求路径、参数及返回字段，独立编写适配器；未复制 Voyager 的源码、UI 或库。原项目的 MIT 许可保留。
- 默认 RPC：`jSf9Qc`，参数字符串：`[]`。通过当前页面的 `WIZ_global_data` 取请求所需的 `SNlM0e`、`cfb2h`、`FdrFJe`，POST 到同源 `[/u/N]/_/BardChatUi/data/batchexecute`，`source-path` 固定使用该账号的 `/usage`。
- 响应 `wrb.fr` 行中的数据结构为 `[flag, metrics, bool]`，每个 metric 为 `[limit, fractionUsed, periodEnum, [[resetEpochSec, nanos]]]`。周期 1 = 5h，周期 2 = 7d；按枚举映射，不按重置日期排序。小数使用率乘 100，显示上限为 100%；陌生周期跳过。

### 两个运行环境的职责

`gemini-main.js`（构建为自包含的 `gemini-main.bundle.js`）在 MAIN 环境执行同源请求、解析结果，只将标准化百分比及重置时间传给隔离环境；不向外传递会话参数、请求 body 或原始响应。`gemini-usage.js` 在 ISOLATED 环境验证消息来源、请求 ID 和账号，向既有用量条提供数据。使用清单声明注入，无需 scripting 权限。

MAIN 脚本仅在用户访问 `/usage` 时观察该页的 fetch/XHR 用量候选请求，既不读取对话响应，也不修改原请求/响应。校准只接受空参数 `[]` 的候选 RPC，并要求 5h 与 7d 两个返回百分比都与已渲染的官方页面相符（容忍 1 个百分点的显示舍入误差），候选标识必须唯一。保存值只有按账号隔离的 `geminiRpc:N` 字符串。接口参数或结构改动超出此范围时明确失败，不猜测。

正常刷新通过直接请求完成；定时刷新默认 5 分钟，另通过停止按钮的 DOM 变化判断回复完成并延迟 4 秒刷新。不复制或读取生成响应来判断完成。DOM 变化导致事件未被识别时仍由定时器兜底。

### 与 0.4.0 的区别

0.4.0 参考 [Gemini Web Quota Monitor](https://github.com/Hakkinex/Gemini_Web_Quota_Monitor)，通过临时非活动标签页读取 DOM。0.4.1 已删除这个后台 worker、标签页创建/关闭流程和对应消息协议。只有用户主动点击官方用量页入口才打开新页面。

## 权限与验证边界

保持 `storage` 和 Claude、ChatGPT、Gemini 主机访问权限，无新增 cookies、scripting 或全站 tabs 权限。MAIN 清单注入要求 Chrome 111+。

测试使用伪造会话、假额度和模拟 DOM，覆盖直接请求、MAIN/ISOLATED 启动顺序、fetch/XHR 观察、令牌不经消息传递、官方页面校准、账号切换、未知字段、超时和 429 等。0.4.2 已在真实 Chrome 的 Gemini 对话页验证，并对照同账号官方用量页确认数据一致；这不代表已完成 Claude/Codex 新版本的在线验证。网页内部 RPC 不属于 Google 对第三方承诺稳定的公开 API。

## 0.4.2 注入修复

真实 Chrome 的扩展错误页报告隔离脚本缺少 `UsageGeminiRPC`。0.4.1 在两个执行环境中声明了同一路径的辅助脚本；0.4.2 给 MAIN 使用独立、自包含的 bundle 路径，隔离环境保留自己的辅助脚本。修复后在同一浏览器和账号下正常显示额度。新增清单跨环境文件去重、bundle 同步检查及初始化异常回归测试。
