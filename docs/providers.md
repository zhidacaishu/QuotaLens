# 数据源与适配说明

当前实现：0.1.1 后续修订（2026-10-03），2026-10-10 复核并通过自动化检查。外部协议参考核查日期：2026-09-27；本次未重新验证线上接口。

## Claude

- 每次刷新先访问 /api/organizations，仅在唯一一个组织具备 chat 能力时请求 /api/organizations/{id}/usage。没有符合条件的组织或存在多个候选时明确提示前往官方用量页，不猜测当前组织。
- 只读取 five_hour 与 seven_day，使用率必须为 0–100 的有限数值。未知字段、嵌套的其他额度不推测为 5h/7d；非法重置日期保持未知。
- 默认每 15 秒刷新，设置下限为 10 秒。每次刷新产生组织和额度两个请求；请求去重仅在单个标签页生效，没有跨标签页预算。
- 与 Codex 共用请求及错误处理：每个 HTTP 请求 15 秒超时，429 遵守 Retry-After（秒数或 HTTP 日期，至少等待 1 分钟），手动刷新也不能跳过限流等待。其他失败自动等待 1 分钟，允许手动重试。
- 401/403 清除当前读数；其他请求失败标明刷新失败。组织变化时先清除旧读数，再读取新组织额度。额度与组织只在页面内存保留；启动时删除旧版未绑定账号的 usage / orgId / orgIdAt 本地缓存。
- 隐藏标签页停止定时请求，但已发出的请求和已排队的回复完成刷新仍可能执行。隐藏额度栏不会停止可见页面轮询。每秒更新倒计时不发送请求。
- 本次没有可用的 Claude 订阅进行真实页面验证；请求、错误、解析和账号切换使用模拟数据回归，布局另有本地 Chromium 合成页面检查。

## Codex

- [OpenAI 官方 Codex 价格与用量说明](https://developers.openai.com/codex/pricing)：说明五小时用量区间、可能适用的每周限制以及官方 usage dashboard。固定消息数量只是估计，扩展不使用它们推算百分比。
- [AI Usage 扩展](https://github.com/cupcakedev/ai-usage-extension) 的 [UsageService.ts](https://github.com/cupcakedev/ai-usage-extension/blob/HEAD/src/background/services/UsageService.ts) 提供了浏览器会话读取方案：`/api/auth/session` → 带 Bearer 会话令牌访问 `/backend-api/wham/usage`。
- 本项目读取 `rate_limit.primary_window` / `secondary_window` 的 `used_percent`、`limit_window_seconds`、`reset_at` / `reset_after_seconds`。存在周期长度时按 18000 秒和 604800 秒映射，支持主次顺序颠倒；明确为其他长度的不冒充 5h/7d。长度缺省时使用接口主/次窗口约定。
- 请求使用会话明确提供的当前账号 ID；不会随意选择账号列表的第一项。多工作区账号应对照官方 Codex 用量页确认显示对象。
- 不展示 code review、额外模型额度或 credits 余额。这些不等价于用户要求的通用 5h/7d 配额。
- 上述网页接口是从公开实现核查到的内部接口，不是 OpenAI 官方承诺稳定的开发者 API。

## Gemini：直接 RPC

- [Google 官方 Gemini Apps limits](https://support.google.com/gemini/answer/16275805?hl=en)：五小时窗口及每周限制。官方用量入口为 Settings → Usage Limits。
- 参考 [Voyager 请求适配](https://github.com/Nagi-ovo/voyager/blob/82607fd9580a9fbd10f74cb352b9702883113dda/public/usage-observer.js) 与 [额度协议解析](https://github.com/Nagi-ovo/voyager/blob/82607fd9580a9fbd10f74cb352b9702883113dda/src/pages/content/usageStatus/index.ts)，核查的是固定提交 `82607fd9580a9fbd10f74cb352b9702883113dda`。
- 本项目依据其公开实现揭示的请求路径、参数及返回字段，独立编写适配器；未复制 Voyager 的源码、UI 或库。原项目的 MIT 许可保留。
- 默认 RPC：`jSf9Qc`，参数字符串：`[]`。通过当前页面的 `WIZ_global_data` 取请求所需的 `SNlM0e`、`cfb2h`、`FdrFJe`，POST 到同源 `[/u/N]/_/BardChatUi/data/batchexecute`，`source-path` 固定使用该账号的 `/usage`。
- 响应 `wrb.fr` 行中的数据结构为 `[flag, metrics, bool]`，每个 metric 为 `[limit, fractionUsed, periodEnum, [[resetEpochSec, nanos]]]`。周期 1 = 5h，周期 2 = 7d；按枚举映射，不按重置日期排序。小数使用率乘 100，显示上限为 100%；陌生周期跳过。

### 两个运行环境的职责

`gemini-main.js`（构建为自包含的 `gemini-main.bundle.js`）在 MAIN 环境执行同源请求、解析结果，只将标准化百分比及重置时间传给隔离环境；不向外传递会话参数、请求 body 或原始响应。`gemini-usage.js` 在 ISOLATED 环境验证消息来源、请求 ID 和账号，向既有用量条提供数据。使用清单声明注入，无需 scripting 权限。

MAIN 脚本仅在用户访问 `/usage` 时观察该页的 fetch/XHR 用量候选请求，既不读取对话响应，也不修改原请求/响应。校准只接受空参数 `[]` 的候选 RPC，并要求 5h 与 7d 两个返回百分比都与已渲染的官方页面相符（容忍 1 个百分点的显示舍入误差），候选标识必须唯一。保存值只有按账号隔离的 `geminiRpc:N` 字符串。接口参数或结构改动超出此范围时明确失败，不猜测。

正常刷新通过直接请求完成；定时刷新默认 5 分钟，另通过停止按钮的 DOM 变化判断回复完成并延迟 4 秒刷新。不复制或读取生成响应来判断完成。DOM 变化导致事件未被识别时仍由定时器兜底。

自动刷新不会创建后台标签页。只有用户主动点击官方用量页入口才打开新页面。

## 权限与验证边界

保持 `storage` 和 Claude、ChatGPT、Gemini 主机访问权限，无新增 cookies、scripting 或全站 tabs 权限。MAIN 清单注入要求 Chrome 111+。

测试使用伪造会话、假额度和模拟 DOM，覆盖直接请求、MAIN/ISOLATED 启动顺序、fetch/XHR 观察、令牌不经消息传递、官方页面校准、账号切换、未知字段、超时和 429 等。ChatGPT / Gemini 的 Chrome 核心流程与 Gemini 同账号官方用量页对照属于 2026-09-27 的历史验证，不代表当前修订已完成线上检查；当前布局通过本地 Chromium 合成页面回归，Claude 真实订阅页面仍未验证。网页内部接口不属于平台对第三方承诺稳定的公开 API，读取方式不代表平台官方授权或推荐。

## 布局与验证

输入框定位集中在 src/layout.js：优先选择各站完整输入框容器，包含附件和底部按钮；长文遮挡判断仅使用滚动区域可见部分。没有站点标记时回退到最近的输入卡片，排除对话区域；空间不足且角落位置会遮住输入卡片时暂时隐藏。

三站共用低对比度毛玻璃样式，跟随站点主题，为不支持模糊和减少透明效果的环境提供实色底色。运行方法与当前验证边界见[测试说明](testing.md)，以往人工检查见[历史验证记录](validation-history.md)。

## 为什么保留生成的 Gemini bundle？

`manifest.json` 给 MAIN 环境使用独立、自包含的 `src/gemini-main.bundle.js`，ISOLATED 环境保留自己的辅助脚本，避免同一路径在两个执行环境中声明时出现注入问题。bundle 由 `scripts/build.cjs` 生成，随仓库提交，以支持下载后直接加载扩展。测试检查清单跨环境文件去重、bundle 与源码同步及独立初始化，因此 bundle 不是可删除的旧副本。
