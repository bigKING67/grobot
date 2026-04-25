# 第 2 章 浏览器能力解锁

> 学完本章，`grobot` 可以帮你读取和操作真实浏览器里的网页任务，像一个稳定的“上网助手”。

## 学习目标

1. 通过 `grobot browser setup` 准备 TMWD-CDP Bridge 浏览器扩展。
2. 安装扩展并启动 TMWD hub，让 `grobot` 能连接你已经打开的 Chrome / Edge。
3. 用 `grobot browser doctor --json` 验证浏览器链路，供用户、企业部署脚本和 GUI 统一读取。
4. 理解 `web_scan` / `web_execute_js` 是 Agent 可直接调用的原子浏览器工具。
5. 分清 **TMWD-CDP Bridge** 与 **remote-debugging CDP**：前者是默认用户浏览器路径，后者只是显式调试/CI/逆向路径。

---

## 2.1 grobot 的浏览器能力是什么

`grobot` 不自带浏览器。它通过一个本地浏览器扩展和 hub 连接你已经安装、已经登录的 Chrome / Edge。

对 Agent 来说，浏览器能力暴露为两个核心原子工具：

| 工具 | 用途 |
| --- | --- |
| `web_scan` | 读取当前浏览器 tab、页面文本、主内容区域、已登录页面的可见内容。 |
| `web_execute_js` | 执行网页动作，例如导航、DOM 查询、点击、读取 cookie、执行 TMWD bridge command。 |

普通任务不需要让 Agent 直接调用：

```text
mcp_call(server="browser-structured", ...)
```

`web_scan` / `web_execute_js` 会自动映射到底层 `browser-structured` 后端，并且默认走：

```json
{
  "tmwd_mode": "tmwd"
}
```

这意味着：**默认操作的是用户真实浏览器，不是另开的空白 debug Chrome。**

---

## 2.2 一键准备

在已安装 grobot 的环境里执行：

```bash
grobot browser setup
```

这个命令会生成稳定的扩展目录：

```text
~/.grobot/browser/tmwd_cdp_bridge/
```

同时会在全局 MCP 注册表中注册浏览器后端：

```text
~/.grobot/mcp/servers.toml
```

> 不要移动或删除 `~/.grobot/browser/tmwd_cdp_bridge/`。浏览器扩展是“加载已解压扩展”的形式，路径变了扩展就会失效。

然后启动 TMWD hub：

```bash
grobot browser hub start
```

查看 hub 状态：

```bash
grobot browser status
```

或：

```bash
grobot browser hub status
```

---

## 2.3 安装浏览器扩展

推荐使用 Chrome 或 Edge。其他 Chromium 浏览器如果支持“加载已解压扩展”，理论上也可以用，但以 `grobot browser doctor --json` 的结果为准。

### Chrome

1. 打开地址：

   ```text
   chrome://extensions
   ```

2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择目录：

   ```text
   ~/.grobot/browser/tmwd_cdp_bridge/
   ```

5. 扩展列表中出现 TMWD-CDP Bridge 后，即表示加载成功。

### Edge

1. 打开地址：

   ```text
   edge://extensions
   ```

2. 打开“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择目录：

   ```text
   ~/.grobot/browser/tmwd_cdp_bridge/
   ```

---

## 2.4 验证安装

推荐使用机器可读诊断命令：

```bash
grobot browser doctor --json
```

成功时，输出类似：

```json
{
  "ok": true,
  "stage": "doctor_only",
  "doctor": {
    "ok": true,
    "mode": "auto",
    "transport": "auto",
    "readiness": {
      "ready": true,
      "reason": "auto_has_route",
      "path": "tmwd_ws"
    }
  }
}
```

关键看两个字段：

```text
ok = true
doctor.readiness.path = tmwd_ws 或 tmwd_link
```

含义：

| path | 含义 |
| --- | --- |
| `tmwd_ws` | TMWD WebSocket 路径可用，优先路径。 |
| `tmwd_link` | TMWD HTTP link 路径可用。 |
| `cdp` | 当前命中的是外部 remote-debugging CDP，不一定有用户当前登录态。 |
| `none` | 没有可用浏览器路由，需要检查 hub、扩展或浏览器。 |

如果 GUI / 企业部署只想检查端口和协议，不要求当前浏览器已有 tab/session，可以用：

```bash
grobot browser doctor --json --allow-empty-tabs
```

如果 GUI 高频轮询，不希望写入诊断事件日志，可以用：

```bash
grobot browser doctor --json --disable-event-log
```

JSON schema 固定在：

```text
docs/schemas/browser-doctor.schema.json
```

CI 或部署脚本可执行：

```bash
npm run check:browser-doctor:schema
```

---

## 2.5 在对话中验证

诊断通过后，可以在 grobot 对话中输入：

```text
打开百度，搜索“今天天气”
```

如果浏览器自动打开百度并完成搜索，说明链路正常。

也可以让 grobot 读取已登录网页：

```text
请读取我当前浏览器页面的主要内容，并总结成三点
```

底层会优先使用：

```text
web_scan
```

如果需要执行动作，会使用：

```text
web_execute_js
```

---

## 2.6 web_scan / web_execute_js 怎么理解

### `web_scan`

适合读取：

- 当前 tab。
- 所有 tabs。
- 当前页面文本。
- 页面主内容区域。
- 已登录页面的可见内容。

常见参数：

```json
{
  "tabs_only": true,
  "text_only": true,
  "main_only": true,
  "session_url_pattern": "example.com",
  "max_chars": 12000
}
```

### `web_execute_js`

适合执行：

- 打开网页。
- 查询 DOM。
- 点击按钮。
- 填写输入框。
- 读取 cookie。
- 执行 TMWD bridge command。

示例：

```json
{
  "script": "location.href = 'https://www.baidu.com'"
}
```

TMWD bridge command 示例：

```json
{"cmd":"tabs"}
{"cmd":"cookies"}
{"cmd":"cdp","method":"Runtime.evaluate","params":{"expression":"document.title"}}
```

这里的 `cmd:"cdp"` 是 TMWD bridge command 名称，表示向当前真实浏览器 tab 发送 DevTools 命令；它不等于切到外部 remote-debugging Chrome。

---

## 2.7 TMWD-CDP Bridge 与 remote-debugging CDP 的区别

这两个名字容易混淆，但语义不同。

### TMWD-CDP Bridge：默认路径

TMWD-CDP Bridge 是浏览器扩展 + 本地 hub。它通过 Chrome DevTools / debugger 能力操作你已经打开的普通浏览器。

它的特点：

- 保留你当前打开的 tab。
- 复用你已经登录的网站状态。
- 复用当前浏览器 cookie / session。
- 适合“帮我看当前网页”“帮我操作已登录网站”。

这是 grobot 的默认浏览器路径。

### remote-debugging CDP：显式专家路径

remote-debugging CDP 指连接：

```text
http://127.0.0.1:9222
```

这通常是一个用 `--remote-debugging-port=9222` 启动的 debug Chrome。

它的特点：

- 可能是新窗口。
- 可能是独立 profile。
- 不保证有你普通浏览器里的 tabs。
- 不保证有登录态。
- 更适合 CI、headless、受控调试浏览器、JS 逆向深挖。

因此普通网页任务不要默认使用 remote-debugging CDP。只有明确需要时才传：

```json
{
  "tmwd_mode": "remote_cdp"
}
```

旧值：

```json
{
  "tmwd_mode": "cdp"
}
```

仍然兼容，但新文档和新 Agent 规则统一使用 `remote_cdp`。

---

## 2.8 登录态与验证码

### grobot 能操作需要登录的网站吗？

可以。因为默认 TMWD 路径使用的是你的真实浏览器。

如果你已经在浏览器里登录了淘宝、飞书、Gmail、B 站等网站，grobot 通常可以直接读取和操作对应页面。

### grobot 会帮我自动登录吗？

不建议，也不作为默认能力。

推荐流程：

1. 用户先手动打开浏览器并登录目标网站。
2. grobot 通过 TMWD 复用这个登录态。
3. 登录过期时，grobot 看到登录页后暂停，由用户手动重新登录。
4. 登录完成后继续让 grobot 执行网页任务。

### 能绕过滑块或图形验证码吗？

不作为承诺能力。

验证码背后通常是反自动化风控系统，会分析鼠标轨迹、设备指纹、登录风险等。grobot 的浏览器能力定位是“替已登录用户做正常浏览器操作”，不是破解验证码。

---

## 2.9 常见问题

### Q1：grobot 是否自带浏览器？

不自带。grobot 使用你本机已有的 Chrome / Edge。

### Q2：为什么不直接默认 remote-debugging CDP？

因为 remote-debugging CDP 很可能是另一个 Chrome 窗口或独立 profile，不一定有你当前打开的网页和登录态。

用户说“看我现在打开的网页”时，默认应该看真实用户浏览器，所以使用 TMWD。

### Q3：既然 TMWD-CDP Bridge 已经基于 CDP，为什么还有 remote_cdp？

因为这是两层概念：

- TMWD-CDP Bridge：通过扩展和 hub，把 DevTools/debugger 能力带到用户真实浏览器里。
- remote-debugging CDP：直接连一个外部 debug endpoint，例如 `127.0.0.1:9222`。

前者是默认产品路径；后者只保留给 CI、受控 debug Chrome、JS 逆向深挖或扩展被禁用的企业环境。

### Q4：企业 GUI 怎么判断浏览器是否可用？

调用：

```bash
grobot browser doctor --json --disable-event-log
```

读取：

```text
payload.ok
payload.doctor.readiness.ready
payload.doctor.readiness.path
payload.doctor.readiness.reason
```

如果 `path` 是 `tmwd_ws` 或 `tmwd_link`，说明用户真实浏览器路径可用。

如果 `path` 是 `cdp`，说明命中的是外部 remote-debugging CDP，不应假设有用户当前登录态。

### Q5：浏览器链路不可用怎么办？

按顺序检查：

```bash
grobot browser setup
grobot browser hub start
grobot browser doctor --json
```

同时确认浏览器扩展页中启用了：

```text
~/.grobot/browser/tmwd_cdp_bridge/
```

---

## 小结

- grobot 的默认浏览器能力是 `web_scan` / `web_execute_js`。
- 默认路径是 TMWD-CDP Bridge，操作用户真实浏览器，保留 tabs / cookies / 登录态。
- `grobot browser doctor --json` 是用户、企业部署和 GUI 的统一健康检查入口。
- remote-debugging CDP 是显式专家路径，不是普通网页任务默认路径。

下一章建议继续学习 grobot 的基础使用方式：如何发起任务、查看工具结果、让 Agent 分步骤执行复杂网页任务。
