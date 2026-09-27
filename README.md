<p align="center">
  <img src="icons/quotalens.svg" width="96" height="96" alt="QuotaLens 图标" />
</p>

<h1 align="center">QuotaLens</h1>
<p align="center">AI 额度，一眼看清。</p>
<p align="center"><strong>简体中文</strong> · <a href="README.en.md">English</a></p>

QuotaLens 是一个 Chrome 扩展，把 **Claude、Codex 和 Gemini 的 5 小时与每周已用额度**放在聊天输入框上方。发送消息前就能看到已用了多少、何时重置，无需反复打开设置页。

## 支持哪些页面？

| 页面 | 显示内容 | 读取方式 |
| --- | --- | --- |
| Claude、Claude Code 网页版 | Claude 5h / 7d 已用额度 | 当前登录会话的组织用量接口 |
| ChatGPT、Codex 网页版 | **Codex** 5h / 7d 已用额度 | 当前登录会话的 Codex 用量接口 |
| Gemini 网页版 | Gemini 5h / 7d 已用额度 | 当前页面直接请求官方用量 RPC |

## 安装

需要 **Chrome 111 或更新版本**。

1. 在本仓库点击 **Code → Download ZIP**，解压到一个固定位置；也可以使用下面的 Git 命令。
2. 打开 `chrome://extensions`，打开右上角的**开发者模式**。
3. 点击**加载已解压的扩展程序**，选择包含 `manifest.json` 的文件夹。
4. 如果装过原版 Usage Meter for Claude 或其他旧修改版，请先停用，避免重复显示。
5. 刷新已登录的 Claude、ChatGPT 或 Gemini 页面。

```sh
git clone git@github.com:zhidacaishu/QuotaLens.git
```

**安装不需要 Node.js、npm 或构建。** 仓库已包含可直接加载的脚本和图标。不要删除或移动已加载的文件夹，否则 Chrome 将找不到扩展文件。

## 使用与设置

点击 Chrome 工具栏的 QuotaLens 图标打开设置：

| 控件 | 作用 |
| --- | --- |
| **Refresh now** | 立即请求当前平台的额度；平台限流时仍遵守等待时间 |
| **Open Usage page** | 打开当前平台的官方用量页，以便核对数据 |
| **Claude / Codex** | 设置轮询间隔，最低 10 秒 |
| **Gemini** | 设置空闲刷新间隔，最低 1 分钟 |
| **Hide bar completely** | 隐藏额度栏；不会停止可见页面的轮询 |
| **Debug logging** | 开启排查问题所需的调试日志 |

点击额度栏右侧箭头可折叠，再点击小标签展开。悬停倒计时可查看具体重置时间；悬停额度栏可查看数据来源。

## 数据、权限与隐私

[隐私政策](PRIVACY.md)

- 只请求 `storage` 及 Claude、ChatGPT、Gemini 对应站点访问权限，没有全站浏览历史、`cookies` 或 `scripting` 权限。
- 没有遥测、广告或第三方数据服务器。额度请求只发往对应平台。
- 登录令牌和 Gemini 请求验证参数仅用于当前请求，不写入扩展存储、日志或跨运行环境消息。
- 设置、Claude 额度缓存及 Gemini 按账号校准的 RPC 标识保存在本机。Codex / Gemini 读数保留在当前页面内存中。
- 不采集或上传对话内容。扩展读取输入框的位置及回复状态来定位和刷新额度栏，不修改草稿。

这些网页内部接口和页面结构可能发生变化，项目与 Anthropic、OpenAI、Google 无隶属关系。数据解析与适配边界见[数据源说明](docs/providers.md)。

## 开发

```sh
npm ci
npm run build
npm run check
npm test
```

运行时代码使用原生 JavaScript。`jsdom` 用于测试，`sharp` 将 SVG 导出为 Chrome 所需的 PNG；两者均不随扩展运行。

| 路径 | 内容 |
| --- | --- |
| `src/content.js` / `src/content.css` | 额度栏、定位与刷新 |
| `src/providers.js` | 平台识别及额度标准化 |
| `src/gemini-*.js` | Gemini 直接请求、页面桥接与解析 |
| `popup.html` / `popup.js` | 工具栏弹窗与设置 |
| `icons/quotalens.svg` | 可编辑的矢量图标源文件 |
| `tests/` | 数据解析、桥接、账号隔离和布局生命周期测试 |

修改 Gemini MAIN 脚本或 RPC 辅助脚本后运行 `npm run build`，同步提交生成的 `src/gemini-main.bundle.js`。修改图标后可单独运行 `npm run build:icons`，导出 16 / 32 / 48 / 128px PNG。

自动化布局测试使用模拟坐标，不代替真实网页验证。目前已在 Chrome 的 ChatGPT / Gemini 页面验证核心流程；Claude 最近的布局改动仅经过自动化回归。

## 致谢

- **[Usage Meter for Claude](https://chromewebstore.google.com/detail/usage-meter-for-claude/jlohkbicmcebjejobahelcfbdmhjfdie)**（[源码](https://github.com/suresh8883/Claude-Usage-Meter-Chrome-Extension)）：感谢 Suresh Kumar 提供原始项目。QuotaLens 在其基础上扩展，延续了在输入框附近展示额度的思路，以及 Claude 会话读取、进度展示和刷新机制，并保留原 MIT 版权声明。
- **[Voyager](https://github.com/Nagi-ovo/voyager)**：感谢其公开的 Gemini 用量请求与协议解析实现，为当前页面直接读取额度、账号路由和周期字段映射提供了重要参考。QuotaLens 据此独立编写适配器，不需要临时后台标签页。具体参考文件与提交见[数据源说明](docs/providers.md)。
- 同时感谢 [AI Usage](https://github.com/cupcakedev/ai-usage-extension) 对 Codex 浏览器会话读取方式的参考，以及 [Gemini Web Quota Monitor](https://github.com/Hakkinex/Gemini_Web_Quota_Monitor) 对早期适配的启发。

## 许可

[MIT](LICENSE)。保留原作者 Suresh Kumar 的版权声明。
