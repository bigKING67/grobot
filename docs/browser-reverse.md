# JS 逆向增强能力

`grobot` 的普通浏览器能力解决“看网页、操作网页”；JS 逆向增强能力解决“网页为什么这样请求、签名参数怎么生成、脚本在哪里、如何 Hook 和复现”。

这层能力来自 `js-reverse` skill 的作业规范，并可选对接 JSReverser-MCP。

## 何时进入 reverse mode

出现以下意图时，进入 JS reverse 工作流：

- `sign`、`token`、`nonce`、`_signature`
- `h5st`、`x-bogus`、`msToken`
- request signing / token generation
- Hook 请求或函数
- 查找网络请求 initiator
- 反混淆、AST 去混淆、VMP 插桩
- 补环境、本地 Node 复现
- anti-bot / 反爬链路分析

普通网页阅读和点击仍优先使用 `web_scan` / `web_execute_js`，不要把 reverse 工具用于所有浏览器任务。

## 后端依赖

Core browser layer 不依赖 JSReverser-MCP；reverse mode 需要额外配置 JSReverser-MCP。

登录态场景默认 **TMWD-first**：先用 `web_scan` / `web_execute_js` 在用户真实浏览器里确认目标页面、请求结果、cookie/session 与可见 DOM。只有需要 Network initiator、script source、Debugger、preload hook、AST/VMP 等 DevTools 级能力时，才进入 JSReverser-MCP / remote-debugging CDP 路径。

推荐 MCP 配置模板：

```toml
[[servers]]
name = "js-reverse"
command = "node"
args = ["<JSREVERSER_MCP_PATH>/build/src/index.js"]
enabled = true

[servers.env]
REMOTE_DEBUGGING_URL = "http://127.0.0.1:9222"
```

Chrome 需要以 remote debugging 方式启动：

```bash
chrome --remote-debugging-port=9222
```

不同系统的 Chrome 命令路径不同；以本机可执行路径为准。

注意：这里的 remote debugging Chrome 是外部 remote-debugging CDP 浏览器，不等同于 TMWD-CDP Bridge 操作的用户真实浏览器。如果它是新窗口或独立 profile，就没有原浏览器的标签页和登录态。需要登录态时有三种选择：

1. 优先用 TMWD 在真实浏览器完成观察、取 cookie、确认请求与页面状态。
2. 让用户在 debug Chrome 中单独登录，再使用 JSReverser-MCP 做深度 Hook / initiator / script 分析。
3. 在可控企业环境中启动带 remote debugging 的指定 profile；这需要明确用户/管理员授权，不作为默认普通用户路径。

## 标准工作流

### Phase 1: Observe

目标：确认目标请求、相关脚本、候选函数、触发动作。

步骤：

1. `check_browser_health`
2. `new_page` / `navigate_page`
3. `list_network_requests`
4. `get_request_initiator`
5. `search_in_scripts`
6. 明确目标关键词、URL pattern、函数名和触发动作

退出条件：能回答“谁发起请求、哪个脚本、如何触发”。

### Phase 2: Capture

目标：非阻塞 Hook 采样。

步骤：

1. `create_hook`，优先 fetch / xhr / function
2. `inject_hook`
3. 触发业务动作
4. `get_hook_data` 先用 `summary`，再按需下钻 `raw`
5. `record_reverse_evidence`

首屏初始化场景必须优先 `inject_preload_script`，再导航页面。

### Phase 3: Rebuild

目标：导出本地复现工程。

```text
export_rebuild_bundle
```

产物通常包括：

- `env/entry.js`
- `env/env.js`
- `env/polyfills.js`
- `env/capture.json`

### Phase 4: Patch

目标：按代理日志补环境。

规则：

- 先读 env log。
- 找第一个失败点，即 `first divergence`。
- 一次只补一个最小因果单元。
- 复跑确认 divergence 前移。
- 连续 6 个补丁不收敛，回浏览器取证。
- 没有代理日志或 first divergence，禁止直接脑补浏览器环境。

常见补丁项：

- `navigator`
- `webdriver`
- `crypto`
- `atob` / `btoa`
- `TextEncoder`
- `window`
- `document`
- `location`
- `localStorage` / `sessionStorage`
- `fetch` / `XMLHttpRequest`

### Phase 5: Extract

目标：把签名或加密算法从环境噪声中提纯。

要求：

- 区分算法输入与浏览器环境状态。
- 用采样数据创建 fixture。
- 验证纯实现与补环境版本输出一致。

### Phase 6: Port

目标：迁移到 Python / Go / Java 等目标语言。

要求：

- 逐段移植。
- 用 Node fixture 校验中间值。
- 最终以真实服务器请求验证为准。

## Hook 优先原则

- 首选 Hook，不首选断点。
- 断点会暂停页面，容易触发反调试或断开 WebSocket。
- 只有 Hook 无法覆盖局部变量时，才临时使用断点。
- VMP 首轮只采样 opcode、ip/pc、栈顶摘要、关键寄存器摘要和输出摘要；不要首轮全量采样。

## 与 `web_scan` / `web_execute_js` 的关系

JSReverser-MCP 通常使用自管或 remote debugging Chrome；`web_scan` / `web_execute_js` 操作的是用户真实浏览器链路，并且 core facade 默认使用 TMWD，不静默落到 remote-debugging CDP。

需要登录态、HttpOnly cookie、跨域 iframe、文件上传或真实用户浏览器环境时，优先用：

```text
web_scan
web_execute_js
```

需要网络 initiator、脚本搜索、Hook、去混淆和补环境时，进入 JSReverser-MCP reverse flow。进入前必须明确当前分析的是哪个浏览器上下文：

- `tmwd_user_browser`：用户真实浏览器，有登录态；适合观察、采样、cookie/session 取证。
- `remote_cdp_debug_browser`：受控 debug Chrome；适合 DevTools 协议深挖，但可能需要重新登录。

如果任务同时需要登录态和 remote-debugging CDP 深挖，先用 TMWD 取证，再决定是否让用户在 debug Chrome 登录或迁移必要的无敏 session 线索；不要默认新开空 Chrome 后假设它已经具备登录态。

## 输出契约

完成 reverse 任务时必须产出：

- 目标接口与签名字段
- 函数路径
- 运行时证据
- Hook 记录与 request 关联
- 输入输出样例
- 补丁日志和回滚步骤
- 本地补环境状态
- 置信度与不确定点
- task artifact 路径

## 失败处理

如果 JSReverser-MCP 未配置或不可用，应明确返回：

- `reverse_backend_unavailable`
- `js_reverse_mcp_not_configured`
- `chrome_remote_debugging_unavailable`
- `check_browser_health_failed`

禁止在没有运行时证据的情况下猜测签名逻辑。
