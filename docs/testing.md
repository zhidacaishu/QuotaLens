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

运行 `npm run preview:ui`，打开 `http://127.0.0.1:4173` 可对照浅色、深色额度栏及设置弹窗。
预览使用实际 CSS 和渲染脚本，额度及浏览器 API 为本地模拟数据，不向平台发送请求。
端口可通过 `QUOTALENS_PREVIEW_PORT` 修改；浏览器测试固定使用 4173。

`npm run test:browser` 会自动启动本地预览服务器，并将截图写入 `test-results/`。
新增检查覆盖弹窗 344px 宽度和 Chrome 600px 高度限制（含 Gemini 提示）、设置开关、
键盘折叠/展开与焦点交接、360px 错误文案换行、减少透明度时的实色降级。
透明度检查覆盖设置页背景不受滑条影响、滑条键盘操作、0% 的保存与重开恢复、额度栏背景的实时更新及折叠状态，
并确保调整外观不触发额外额度请求或重新启动轮询。

设计参考与实现取舍见 [UI 设计说明](ui-design.md)。

## 测试覆盖范围

- **单元与集成测试**：覆盖三站额度数据解析、认证与 429 限流响应、请求超时恢复、Claude 组织变更与历史缓存清理、Gemini 跨环境消息桥接与动态校准、轮询定时器销毁、ResizeObserver 生命周期、弹窗交互与设置刷新等。
- **Chromium 页面合成测试**：在模拟三站结构的合成页面中，验证真实 CSS 布局渲染、附件栏展开、长文输入滚动、360px 窄视口自适应、折叠与展开动画、防遮挡隐藏机制，以及草稿内容与输入焦点的完整保留。网络请求均由本地测试固件拦截并模拟响应，无需真实账号或订阅，亦不会向官方平台发送消息。
- **扩展清单规范检查**：验证各脚本路径有效性、确保不同执行环境之间绝不复用同一脚本 URL，并确认已提交的 Gemini bundle 与源代码保持完全同步。

## 验证边界与局限说明

- JSDOM 缺乏内置布局引擎，其坐标相关测试仅用于验证数值定位逻辑；
- Chromium 合成页面测试进一步补充了真实 CSS 渲染及观察器行为，但由于未在浏览器中以正式安装扩展的形式加载，无法验证 Chrome 实际权限体系与 MAIN/ISOLATED 执行环境隔离，亦无法保证第三方平台最新的线上 DOM 结构或内部 API 保持向前兼容；
- 当前开发环境暂无可用 Claude 订阅账号，未在真实订阅页面下进行线上验证；
- ChatGPT 与 Gemini 此前的人工核验结果已归档至[历史验证记录](validation-history.md)，不代表当前修订版本完成了新一轮线上实测；本轮额度栏透明度另在用户 Chrome 的真实 ChatGPT 页面完成 0%/90% 往返验证，记录见 UI 设计说明。测试用例总数请以终端实际输出为准。

## English

Run the commands above for unit/integration checks and local Chromium smoke tests. Browser fixtures intercept network requests and require no account or subscription. They exercise real CSS layout and observer behavior, but do not install the extension or validate Chrome permissions, execution-world isolation, current provider DOM, or live internal APIs. No Claude subscription was available for this revision; live Claude behavior remains unverified. Earlier manual checks are historical records only.
