# 浏览器能力

面向最终用户的章节化教程见：[第 2 章 浏览器能力解锁](chapter2-browser.md)。

`grobot` 的浏览器能力分两层：

1. Agent 默认可直接调用的原子工具：`web_scan` / `web_execute_js`。
2. 本机浏览器后端：`browser-structured`，负责连接 TMWD hub、Chrome/Edge 扩展、必要时显式连接 remote-debugging CDP，并提供 native input 兜底。

日常任务不需要让模型手写 `mcp_call(server="browser-structured", ...)`；让 Agent “打开网页、读取当前页面、操作按钮、整理网页信息”时，默认应使用 `web_scan` / `web_execute_js`。

默认语义是 **当前用户浏览器优先**：core `web_scan` / `web_execute_js` 在未显式传入 `tmwd_mode` 时会按 `tmwd_mode="tmwd"` 调用后端，不会静默落到一个独立的 remote-debugging CDP Chrome。只有 CI、受控浏览器、JS 逆向或用户明确要求 remote debugging 时，才显式设置 `tmwd_mode="remote_cdp"` 或 `tmwd_mode="auto"`。旧值 `tmwd_mode="cdp"` 仍兼容，但文档和 Agent 规则统一使用 `remote_cdp`，避免和 TMWD-CDP Bridge 混淆。

## 快速准备

```bash
# 1) 生成稳定扩展目录
grobot browser setup

# 2) 启动 TMWD hub
grobot browser hub start

# 3) 诊断真实浏览器链路
grobot browser doctor
```

源码仓库内也可以直接使用 npm 脚本：

```bash
npm run browser:setup
npm run browser:tmwd:hub:start
npm run check:browser-structured:mcp:live:gate
```

`grobot browser setup` 会生成扩展目录：

```text
~/.grobot/browser/tmwd_cdp_bridge/
```

这个目录包含浏览器扩展所需的 `config.js`。不要移动或删除该目录；浏览器“加载已解压扩展”依赖这个路径。

同时，setup 会在全局 MCP 注册表中注册 `browser-structured` 后端：

```text
~/.grobot/mcp/servers.toml
```

这是 `web_scan` / `web_execute_js` 能跨项目直接使用浏览器能力的前提。

## 安装浏览器扩展

推荐使用 Chrome 或 Edge。

### Chrome

1. 打开：

   ```text
   chrome://extensions
   ```

2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择：

   ```text
   ~/.grobot/browser/tmwd_cdp_bridge/
   ```

### Edge

1. 打开：

   ```text
   edge://extensions
   ```

2. 开启“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择：

   ```text
   ~/.grobot/browser/tmwd_cdp_bridge/
   ```

其他 Chromium 浏览器如果支持“加载已解压扩展”，理论上可用，但以 `grobot browser doctor` 的结果为准。

## 验证

优先用诊断命令验证：

```bash
grobot browser doctor
```

### 机器可读诊断（企业部署 / GUI）

企业部署、健康检查面板或 GUI 不应解析人类可读文本，直接读取 `doctor --json` 的 stdout：

```bash
grobot browser doctor --json
```

机器可读输出契约固定在：

```text
docs/schemas/browser-doctor.schema.json
```

仓库内可用以下命令验证 schema 与示例 payload：

```bash
npm run check:browser-doctor:schema
```

如果只是检查后端端口和传输层是否可达，而不要求当前浏览器已有可操作 tab/session，可加：

```bash
grobot browser doctor --json --allow-empty-tabs
```

如果 GUI 高频轮询且不希望写入 gate 事件日志，可加：

```bash
grobot browser doctor --json --disable-event-log
```

退出码语义：

- `0`：`ok: true`，浏览器后端已就绪。
- `1`：`ok: false`，stdout 仍会输出 JSON，GUI 应继续解析其中的失败原因。

关键字段：

| 字段 | 含义 |
| --- | --- |
| `ok` | 整体是否可用。 |
| `stage` | 当前 gate 阶段；`doctor_only` 表示只做诊断。 |
| `doctor.readiness.ready` | doctor 层是否找到可用路由。 |
| `doctor.readiness.reason` | 不可用或可用的机器可读原因。 |
| `doctor.readiness.path` | 实际命中的路径：`tmwd_ws` / `tmwd_link` / `cdp` / `none`；其中 `cdp` 表示外部 remote-debugging CDP 路径。 |
| `doctor.checks.tmwd_ws_tcp.reachable` | TMWD WebSocket 端口是否可达。 |
| `doctor.checks.tmwd_ws_api.ok` | TMWD WebSocket API 是否可用。 |
| `doctor.checks.tmwd_ws_api.tab_count` | WebSocket 路径看到的 tab 数。 |
| `doctor.checks.tmwd_link_http.ok` | TMWD link HTTP API 是否可用。 |
| `doctor.checks.tmwd_link_http.session_count` | link 路径看到的 session 数。 |
| `doctor.checks.cdp_http.ok` | 外部 remote-debugging CDP `/json/version` 是否可用。 |
| `doctor.checks.cdp_targets.page_count` | 外部 remote-debugging CDP `/json/list` 里可用页面数。 |
| `ensure_tmwd_hub` | gate 是否尝试自动拉起 TMWD hub，以及结果。 |
| `session_wait` | gate 是否等待浏览器 session 就绪，以及结果。 |
| `event_log` | 本次诊断事件日志是否写入成功。 |

成功示例：

```json
{
  "ok": true,
  "stage": "doctor_only",
  "doctor": {
    "ok": true,
    "mode": "auto",
    "transport": "auto",
    "allow_empty_tabs": false,
    "readiness": {
      "ready": true,
      "reason": "auto_has_route",
      "path": "tmwd_ws"
    },
    "checks": {
      "tmwd_ws_tcp": {
        "endpoint": "ws://127.0.0.1:18765/",
        "reachable": true,
        "latency_ms": 2,
        "detail": "connect_ok"
      },
      "tmwd_ws_api": {
        "endpoint": "ws://127.0.0.1:18765",
        "ok": true,
        "latency_ms": 8,
        "tab_count": 1,
        "detail": "tabs_ok"
      }
    }
  },
  "ensure_tmwd_hub": {
    "attempted": false,
    "enabled": true,
    "reason": "not_needed"
  },
  "session_wait": {
    "attempted": false,
    "wait_ms": 6000,
    "reason": "not_needed"
  },
  "event_log": {
    "enabled": true,
    "ok": true,
    "path": ".grobot/runtime/browser-live-gate-events.jsonl"
  }
}
```

未就绪示例：

```json
{
  "ok": false,
  "stage": "doctor_only",
  "doctor": {
    "ok": false,
    "readiness": {
      "ready": false,
      "reason": "auto_no_route",
      "path": "none"
    },
    "checks": {
      "tmwd_ws_tcp": {
        "reachable": false,
        "detail": "ECONNREFUSED"
      },
      "tmwd_link_tcp": {
        "reachable": false,
        "detail": "ECONNREFUSED"
      },
      "cdp_tcp": {
        "reachable": false,
        "detail": "ECONNREFUSED"
      }
    }
  }
}
```

GUI 推荐判定逻辑：

```text
ready = payload.ok === true
route = payload.doctor.readiness.path
reason = payload.doctor.readiness.reason
```

当 `reason` 是 `auto_no_route`、`tmwd_no_route`、`tmwd_ws_unavailable`、`tmwd_link_unavailable` 或 `cdp_unavailable` 时，引导用户执行：

```bash
grobot browser setup
grobot browser hub start
grobot browser doctor --json
```

通过后，可以在 grobot 对话中尝试：

```text
打开百度，搜索“今天天气”
```

或者：

```text
读取当前浏览器页面的主要内容并总结
```

## Agent 工具语义

### `web_scan`

用于读取浏览器状态和页面内容：

- 当前 tab / 所有 tabs
- 当前页面文本
- 主内容区域
- 已登录页面的可见内容

常见参数：

- `tabs_only`
- `text_only`
- `main_only`
- `session_id`
- `session_url_pattern`
- `max_chars`
- `tmwd_mode`：默认 `tmwd`。当前浏览器/登录态任务不要改；受控 debug Chrome 才显式传 `remote_cdp`（旧值 `cdp` 兼容）。

### `web_execute_js`

用于执行浏览器动作：

- 导航页面
- DOM 查询和点击
- 读取 cookie
- DevTools / CDP bridge 命令
- batch 命令

`web_execute_js` 同样默认 `tmwd_mode="tmwd"`。这能保证“操作我现在打开的浏览器”不会因为 TMWD 未连接而误扫另一个空的 remote-debugging CDP Chrome。

示例 bridge command：

```json
{"cmd":"tabs"}
{"cmd":"cookies"}
{"cmd":"cdp","method":"Runtime.evaluate","params":{"expression":"document.title"}}
{"cmd":"batch","commands":[{"cmd":"tabs"},{"cmd":"cookies"}]}
```

这里的 `cmd:"cdp"` 是 **TMWD bridge command 名称**：表示向当前选中的真实浏览器 tab 发送 DevTools 命令；它不等于 `tmwd_mode="remote_cdp"`，也不会自动切到另一个 remote-debugging Chrome。

核心工具返回里会额外标注当前浏览器上下文：

| 字段 | 含义 |
| --- | --- |
| `browser_context_kind` | `tmwd_user_browser` 表示用户真实浏览器；`remote_cdp_debug_browser` 表示外部 debug Chrome；`unknown` 表示后端未能确认。 |
| `browser_context_note` | 人类可读说明，提示该路径是否保留用户当前 tabs / cookies / 登录态。 |

## 能做什么

- 读取真实浏览器页面内容。
- 复用你本机浏览器的登录态。
- 操作普通网页按钮、输入框、导航。
- 读取 HttpOnly cookie（通过扩展的 DevTools/debugger 后端）。
- 对部分 CSP 或受限页面使用 DevTools bridge / native fallback。

## 不能承诺什么

- 不负责自动输入或保存你的账号密码。
- 不保证绕过滑块、图形验证码或站点风控。
- 不保证所有网站都允许自动化点击；遇到 `isTrusted`、文件选择器或原生弹窗时，需要显式 native fallback 和 dry-run。
- 不在浏览器后端不可用时静默假成功。

## TMWD-CDP Bridge 与 remote-debugging CDP 的边界

这里有两个容易混淆的概念：

- **TMWD-CDP Bridge**：通过浏览器扩展和 hub 使用 Chrome DevTools / debugger 能力，操作用户真实 Chrome / Edge，保留当前标签页和登录态。
- **remote-debugging CDP**：连接 `http://127.0.0.1:9222` 这类外部 debug endpoint，可能是新窗口、独立 profile 或 CI headless Chrome，不保证有用户当前标签页和登录态。

### 默认路径：TMWD

TMWD 操作的是你已经打开的普通 Chrome / Edge 窗口。它适合：

- 读取“当前页面”。
- 操作用户已经登录的网站。
- 复用当前浏览器 cookie / session。
- 在用户真实浏览器标签页之间切换。

### 显式路径：remote-debugging CDP

remote-debugging CDP 连接的是 `http://127.0.0.1:9222` 这类 endpoint。它不一定是用户现在正在使用的普通浏览器；如果它是新启动的 debug Chrome，就可能没有原来的标签页和登录态。

因此，普通网页任务不要依赖 remote-debugging CDP fallback。仅在下面场景显式使用 `tmwd_mode="remote_cdp"`：

- CI / headless / 自动化测试。
- 用户明确启动并指定了 debug Chrome。
- JS 逆向需要 Network / Debugger / Script source 等底层协议能力。
- 企业环境禁用扩展但允许 remote debugging。

如果你看到 `grobot browser doctor --json` 返回：

```json
{
  "doctor": {
    "readiness": {
      "path": "cdp"
    }
  }
}
```

就应把它理解成“当前正在使用受控 remote-debugging CDP 浏览器”，而不是“必然是用户日常使用的那个 Chrome”。需要登录态时，优先修复 TMWD 链路，或让用户在该 debug Chrome 中单独登录。

## 权限与隐私

浏览器扩展需要较高权限，例如 tabs、cookies、debugger、scripting 和 `<all_urls>`。这些权限用于真实浏览器控制和登录态复用。

安全建议：

- 只加载由本机 `grobot browser setup` 生成的扩展目录。
- 不加载未知来源的同名扩展。
- 不使用时可以禁用扩展或停止 hub：

  ```bash
  grobot browser hub stop
  ```

- 诊断或日志中不得输出原始 cookie、token、密码。

## 排障

### 扩展没连接

```bash
grobot browser setup
grobot browser hub start
grobot browser doctor
```

确认浏览器扩展已启用，并刷新目标页面。

### 没有可用 tab

打开一个普通网页后重试。`chrome://`、`edge://`、`about:blank` 等内部页通常不会加载扩展内容脚本。

### 端口冲突

```bash
grobot browser status
```

如果提示 `port_in_use_unmanaged`，先释放 `18765/18766`，再启动 hub。

### 需要真实浏览器环境验收

```bash
npm run check:browser-structured:mcp:live:gate
```

这个 gate 会先 doctor，再在条件满足时执行真实浏览器 live contract。
