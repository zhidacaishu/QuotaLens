# 测试与验证 / Testing

安装开发依赖并运行基础检查：

```sh
npm ci
npm run build
npm run check
npm test
```

端到端浏览器检查依赖 Playwright 提供的 Chromium。首次运行前需安装对应浏览器内核：

```sh
npx playwright install chromium
npm run test:browser
```

## UI 预览与视觉验证

运行 `npm run preview:ui` 后访问 `http://127.0.0.1:4173`，可对照查看浅色、深色额度栏及设置弹窗。该预览使用实际 CSS 与渲染脚本，额度及浏览器 API 均为本地模拟数据，不会向平台发送请求。服务端口可通过 `QUOTALENS_PREVIEW_PORT` 修改，浏览器测试则固定使用 `4173`。

`npm run test:browser` 会自动启动本地预览服务器，并将截图写入 `test-results/`。主要视觉与交互验证项如下：

- **设置弹窗与常规状态**：覆盖 344px 弹窗宽度及 Chrome 600px 高度限制（含 Gemini 校准提示）、设置开关交互、键盘折叠/展开与焦点交接、360px 窄屏错误文案换行，以及开启“减少透明度”时的纯色降级。
- **透明度调整**：验证 0–95% 边界与 1% 键盘步长、0% 数值的保存与重开恢复、设置页背景不受滑条影响、额度栏与折叠态背景的实时更新，以及调整外观时不触发额外额度请求或重启轮询。
- **响应式布局**：覆盖 240–1440px 输入框宽度、520px / 760px 布局切换边界、窄视口、角落停靠回退，以及缺失额度或重置时间时的对齐表现；相关截图用于浅色与深色视觉验收。

设计参考与实现取舍请参阅 [UI 设计说明](ui-design.md)。

## 测试覆盖范围

- **单元与集成测试**：覆盖三站额度数据解析、认证失败与 429 限流响应、请求超时恢复、Claude 组织变更与历史缓存清理、Gemini 跨环境消息桥接与动态校准、轮询定时器销毁、`ResizeObserver` 生命周期、弹窗交互与设置刷新等场景。
- **Chromium 页面合成测试**：在模拟三站结构的合成页面中，验证真实 CSS 布局渲染、附件栏展开、长文输入滚动、360px 窄视口自适应、折叠与展开动画、防遮挡隐藏机制，以及草稿内容与输入焦点的完整保留。网络请求均由本地测试固件拦截并模拟，无需真实账号或订阅，亦不会向官方平台发送消息。
- **实际扩展加载测试**：在独立 Chromium 持久上下文中直接加载 `manifest.json` 与内容脚本，验证 Codex / Gemini 的 `MAIN` / `ISOLATED` 执行环境隔离、真实 `chrome.storage` 校准持久化、账号路径路由、手动刷新、折叠恢复与 390px 窄屏表现。所有 HTTP 请求均由测试拦截，不使用真实账号。
- **扩展清单规范检查**：验证各脚本路径有效性，确保不同执行环境之间不复用同一脚本 URL，并确认已提交的 Gemini bundle 与源代码保持一致。

## 验证边界与局限说明

- JSDOM 缺乏内置布局引擎，其坐标相关测试仅用于验证数值定位逻辑。
- Chromium 合成页面测试用于验证 CSS 布局与观察器行为，实际扩展加载测试则补充验证执行环境隔离与存储机制；两者均依赖本地模拟响应，无法保证对第三方平台后续 DOM 或内部 API 变更的兼容性。
- 当前开发环境暂无可用 Claude 订阅账号，未在真实订阅页面下进行线上验证。
- 2026-11-05 已在用户登录的 ChatGPT / Gemini 页面对照官方用量核实读数、观察布局并操作刷新（Claude 按要求未访问）；该次源码修复尚未在用户现有 Chrome 中重载。
- 2026-11-19 发布 0.1.6 前，已在登录的 Chrome 中对照官方页面核实 ChatGPT 与 Gemini 的用量；重新加载扩展后，验证了 Codex 工作模式的环境工具栏，以及 390px 视口下 Gemini 的 Chat / Task 切换和额度栏折叠、展开。限流、超时与账号切换使用模拟响应验证；本轮跳过了 Claude 页面。

## English

Run the commands above for unit/integration checks and local Chromium smoke tests. Browser fixtures intercept network requests and require no account or subscription. The synthetic-page tests exercise CSS layout and observers, while the installed-extension tests load the actual manifest in an isolated Chromium profile to verify execution-world isolation and storage. Mocked requests do not guarantee compatibility with future provider DOM or live API changes. On November 19, signed-in Chrome checks verified ChatGPT and Gemini quota readings, the Codex work toolbar, and the Gemini Chat / Task switch at a 390px viewport; live Claude pages were outside the scope of the 0.1.6 checks.
