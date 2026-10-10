# 测试与验证 / Testing

安装开发依赖并运行基础检查：

```sh
npm ci
npm run build
npm run check
npm test
```

浏览器检查使用 Playwright 提供的 Chromium，首次运行需安装浏览器：

```sh
npx playwright install chromium
npm run test:browser
```

## 覆盖范围

- 单元与集成测试：三站额度解析、认证与限流、超时恢复、Claude 组织变化与旧缓存清理、Gemini 消息桥接与校准、轮询取消、尺寸观察器生命周期、弹窗设置及刷新行为。
- Chromium：三站合成输入框页面上的真实 CSS 布局、附件扩展、长文滚动、360px 窄窗口、折叠恢复、遮挡隐藏及草稿和焦点保留。网络被本地测试响应替代，不需要账号或订阅，不向平台发送消息。
- manifest 检查：脚本路径存在、执行环境之间不复用脚本 URL、提交的 Gemini bundle 与源码同步。

## 验证边界

JSDOM 没有布局引擎，其坐标测试只验证定位逻辑；Chromium 合成页面测试补充真实布局与观察器行为，但没有安装扩展验证 Chrome 权限和 MAIN/ISOLATED 环境，也不能证明平台当前 DOM 或内部 API 仍兼容。

本次没有可用 Claude 订阅，未进行真实订阅页面验证。ChatGPT / Gemini 此前的人工检查保留在[历史验证记录](validation-history.md)，不代表当前修改已重新完成线上检查。测试总数以运行输出为准。

## English

Run the commands above for unit/integration checks and local Chromium smoke tests. Browser fixtures intercept network requests and require no account or subscription. They exercise real CSS layout and observer behavior, but do not install the extension or validate Chrome permissions, execution-world isolation, current provider DOM, or live internal APIs. No Claude subscription was available for this revision; live Claude behavior remains unverified. Earlier manual checks are historical records only.
