# 数据源与适配说明

核查日期：2026-09-27。适配版本：QuotaLens 0.1.0。

## Claude

- 通过已登录会话访问 `/api/organizations`，选取具备 chat 能力的组织，再请求 `/api/organizations/{id}/usage`。读取 `five_hour` 与 `seven_day` 的使用率和重置时间。
- 默认每 15 秒轮询，设置下限为 10 秒。组织 ID 缓存约 10 分钟；额度缓存保存在本机。
- 隐藏标签页停止定时轮询，但已发出的请求和已排队的回复完成刷新仍可能执行。初始化、恢复可见、设置变化、手动刷新和回复完成也会触发请求。
- 请求去重只在单个标签页内生效，没有跨标签页请求预算。隐藏额度栏不等于停止请求；每秒更新倒计时只做本地渲染。
- Claude 路径尚未实现 `Retry-After` 或指数退避；不能将 Codex/Gemini 的限流处理理解为三站通用行为。网页用量接口没有面向此扩展公开的推荐轮询频率。

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

测试使用伪造会话、假额度和模拟 DOM，覆盖直接请求、MAIN/ISOLATED 启动顺序、fetch/XHR 观察、令牌不经消息传递、官方页面校准、账号切换、未知字段、超时和 429 等。ChatGPT / Gemini 核心流程已在 Chrome 验证，Gemini 读数已对照同账号官方用量页；Claude 最近的布局变更仅经过自动化回归。网页内部接口不属于平台对第三方承诺稳定的公开 API，读取方式不代表平台官方授权或推荐。

## 输入框定位回归（2026-09-27）

额度条优先跟随各站完整输入框容器，包含附件和底部按钮；长文的遮挡判断只使用滚动区域内可见的部分。没有站点标记时，回退到最近的输入卡片，并排除对话区域。空间不足且角落位置会遮住输入卡片时暂时隐藏。

- Chrome 实测 ChatGPT / Gemini：空输入、100 行长文、滚动到底、文本附件与长文并存、仅附件、折叠/恢复、缩小窗口。布局稳定后额度条距完整输入框顶部均为 6px。使用合成测试内容，未发送对话。
- Claude：仅模拟 DOM 回归，未进行网页测试；实际账号页面仍待验证。
- 新增 7 项布局回归，在旧代码上全部失败、修复后全部通过。完整测试共 46 项通过，语法检查通过。

文字裁切修复：三站共用样式的行高从 1 调整为 1.4，倒计时和更新时间另加上下各 1px 留白，避免省略号容器裁掉 `days`、`ago` 的字母下沿。ChatGPT / Gemini 现有页面已检查；三种 provider 样式在 768px / 360px 宽度与 80% / 100% / 125% / 150% CSS 缩放下共 24 组本地 Chromium 检查通过，文字边界均位于容器内。Claude 未进行真实网页验证。

## 毛玻璃样式（2026-09-27）

三站共用半透明底色、20px 背景模糊、细边缘高光和轻阴影。主题优先跟随站点的明暗标记，再回退到系统设置；浅色主题使用更深的进度颜色。状态点常亮，保留文字行高与留白。不支持背景模糊或开启减少透明效果时使用实色底色。

生成深浅色、复杂背景和窄版截图进行迭代；本地 Chromium 的三站主题与四种布局组合共 24 组检查、24 组文字缩放检查，以及减少透明效果检查通过。ChatGPT / Gemini 实际页面确认启用透明底色与模糊，常规条高保持 30px；Claude 只验证本地样式。

## 为什么保留生成的 Gemini bundle？

`manifest.json` 给 MAIN 环境使用独立、自包含的 `src/gemini-main.bundle.js`，ISOLATED 环境保留自己的辅助脚本，避免同一路径在两个执行环境中声明时出现注入问题。bundle 由 `scripts/build.cjs` 生成，随仓库提交，以支持下载后直接加载扩展。测试检查清单跨环境文件去重、bundle 与源码同步及独立初始化，因此 bundle 不是可删除的旧副本。
