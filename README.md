# grobot

企业级 Agent 工程实验仓库（Trellis 驱动），目标是基于 `TypeScript + Rust` 打造可在 IM 中调用的高可靠编码代理平台。

## 项目目标

- 支持 Feishu / Telegram 首发接入，后续可扩展更多渠道。
- 支持 100 并发会话，并保证严格会话隔离与可恢复执行。
- 通过流程工程（harness、context、memory、eval、trace、安全）在非顶级模型上获得接近旗舰体验的稳定效果。
- 保持模型供应商可替换（Kimi 2.5、GPT-5.4 级别、OpenAI-compatible 等）。

## 技术栈与边界

- TypeScript: gateway、channel adapters、management API、config orchestration。
- Rust: runtime core（调度、会话状态机、工具执行策略、并发控制）。
- Data plane: PostgreSQL + Redis（后续可扩展对象存储与消息队列）。

## 目录分层（源码 vs 配置）

- 源码层（repo root）：
  - `adapters/`、`gateway/`、`runtime/`、`shared/`
  - 这些目录是产品代码，负责实现协议、编排、运行时和共享契约。
- 全局运行层（`~/.grobot/`）：
  - `~/.grobot/config.toml`：全局 agent/platform/provider 配置（含敏感信息，不进仓库）
  - `~/.grobot/rules/`、`~/.grobot/skills/`、`~/.grobot/mcp/servers.toml`
  - `~/.grobot/runtime/sessions/`、`~/.grobot/runtime/memory/session/`、`~/.grobot/memory/global/`
- 项目运行层（`<业务仓库>/.grobot/`）：
  - `.grobot/project.toml`：项目级架构/运行契约（source of truth）
  - `.grobot/mcp.toml`：项目级 MCP 覆盖
  - `.grobot/rules/`、`.grobot/skills/`、`.grobot/memory/`

### 配置初始化

```bash
# 1) 初始化全局 home（默认 ~/.grobot，可用 --home 覆盖）
grobot init --global

# 2) 在业务仓库初始化项目层（默认当前目录）
grobot init --project

# 3) 或指定项目目录
grobot init --project --project-root /path/to/your/repo
```

### npm 安装分发（给别人用）

```bash
# 全局安装（发布到 npm 后）
npm install -g grobot

# 首次初始化（生成 ~/.grobot）
grobot init --global

# 在业务仓库内初始化项目配置（生成 <repo>/.grobot）
cd /path/to/business-repo
grobot init --project
```

说明：
- 全局安装后，用户日常只需要关注 `~/.grobot` 与业务仓库里的 `.grobot`。
- `adapters/`、`gateway/`、`runtime/`、`shared/` 属于实现源码，不需要用户在业务目录里维护。
- npm 发布包已通过 `files` 白名单控制，只包含 CLI 运行所需最小文件集合。

### 本地启动 grobot（可在任意业务目录触发）

```bash
# 一次性问答
grobot start \
  --project <project-name> \
  --work-dir "$(pwd)" \
  --message "请介绍当前目录要做什么"

# 交互模式
grobot start \
  --project <project-name> \
  --work-dir "$(pwd)"

# 交互模式（控制上下文重放窗口，默认 12 轮）
grobot start \
  --project <project-name> \
  --work-dir "$(pwd)" \
  --history-turns 16

# 交互模式（启用 Redis 会话持久化 + 熔断参数）
grobot start \
  --project <project-name> \
  --work-dir "$(pwd)" \
  --session-backend redis \
  --redis-url "redis://127.0.0.1:6379/0" \
  --history-turns 16 \
  --circuit-failures 2 \
  --circuit-cooldown-secs 30

# 若你在任意目录启动，但希望强制使用某个项目根目录
grobot start \
  --project <project-name> \
  --work-dir /path/to/business-dir \
  --project-root /path/to/project-root
```

说明：
- `start` 现在会自动构建 provider failover 链（主 provider 失败时自动切后备）。
- 切换 provider 时会重放当前会话历史消息（最近 N 轮），用于尽量保持上下文连续。
- 会话持久化支持 `file` 与 `redis`（生产建议 Redis）。
- `start` 已内置基础本地工具：`list`、`glob`、`search`、`read`、`write`、`edit`、`bash`（通过 Chat Completions `tools` 调用）。
- `bash` 放行受 `.grobot/project.toml` 的 `[tools].allow` 控制；`read/write/edit` 仅允许访问 `--work-dir` 目录内路径。
- `list/glob/search` 优先使用 `fd/rg`（不存在时自动回退到 Python 实现）。
- `search` 支持 `context_before/context_after`，可直接返回命中行前后文（类似 `rg -B/-A`）。
- 支持 `@文件名` 快速解析：在用户消息中写 `@xxx`，会先在 `--work-dir` 内做文件匹配并把解析结果注入 prompt（命中唯一路径可直接用于后续读写工具）。
- `@文件名` 解析使用“常驻内存路径索引 + 增量刷新（added/removed diff）”，匹配阶段采用 trigram 候选集与优先级排序，适配大仓库搜索。
- 管理 API 可对会话设置 interrupt 标记，`start` 在下一轮调用前会消费该标记并跳过当次请求。
- 交互命令新增 `/health`，用于查看 provider 熔断状态（CLOSED/OPEN/HALF_OPEN）。

### 本地体检（启动前先检查配置/连通性）

```bash
# 只检查本地配置解析（不访问模型服务）
grobot status \
  --project <project-name> \
  --work-dir "$(pwd)"

# 增加远程探测：访问 provider 的 /models 验证连通性
grobot status \
  --project <project-name> \
  --work-dir "$(pwd)" \
  --probe
```

### Agent Harness（评测门禁 + 迭代优化）

```bash
# 1) 从真实会话抽样生成初版评测集（需人工复核）
npm run harness:trace-mine

# 2) 对抽样集做去重与脱敏，输出审核报告
npm run harness:trace-clean

# 2.5) 一步跑完 trace pipeline（支持参数透传）
npm run harness:trace-pipeline -- --max-cases 100 --similarity-threshold 0.9

# 3) 运行评测并执行 gate（失败返回非 0，适合 CI）
npm run harness:gate:sample

# 4) CI 专用稳定门禁（GitHub Actions 内使用）
npm run harness:gate:ci

# 5) 在多个 variant 间做爬山选优（优化分提升且 holdout 不退化）
npm run harness:hill-climb:sample
```

### 管理端点（已实现 status/config/reload/interrupt）

管理写接口鉴权来源优先级：
- `--management-token`（CLI）
- `GROBOT_MANAGEMENT_TOKEN`（环境变量）
- `~/.grobot/config.toml` 的 `[management].token` 或 `[[management.tokens]]`

`GET /api/v1/config` 读策略来源优先级：
- `--config-read-policy`
- `GROBOT_CONFIG_READ_POLICY`
- `[management].config_read_policy`
- 默认 `auto`：`bind` 为 `127.0.0.1/localhost/::1` 时放开为 `public`，否则收紧为 `auth`

字段视图 preset（可用于 `public_config_profile` / `config_profile`）：
- `operator`：`selection`、`session_store`
- `auditor`：`paths`、`selection`、`session_store`、`project_toml`
- `admin`：全部 section

策略模板（`policy_template`，可用于 `[management]` 与 `[[management.tokens]]`）：
- `ops_read_only`：`actions=["config_read"]` + `config_profile="operator"`
- `audit_read`：`actions=["config_read"]` + `config_profile="auditor"`
- `full_admin`：`actions=["all"]` + `config_profile="admin"`
- 显式字段优先：若同时配置 `actions/config_sections/config_profile/interrupt_session_prefixes`，会覆盖模板默认值。

可选 ACL（多 token + action 权限 + interrupt 会话前缀）：

```toml
[management]
enabled = true
token = "ops-full-token" # 全权限（reload + interrupt + config_read）
policy_template = "full_admin" # ops_read_only | audit_read | full_admin（可选）
config_read_policy = "auto" # auto | public | auth | disabled
public_config_sections = ["selection", "session_store"] # public 策略下可见 section（默认即此）
# public_config_profile = "operator" # 可选 preset: operator | auditor | admin（与 public_config_sections 二选一）

[[management.tokens]]
name = "ops-reload"
token = "ops-reload-token"
policy_template = "full_admin" # 可选：先套模板，再用显式字段覆盖
actions = ["reload"]

[[management.tokens]]
name = "ops-feishu-interrupt"
token = "ops-feishu-interrupt-token"
actions = ["interrupt"]
interrupt_session_prefixes = ["feishu:grobot:dm:"]

[[management.tokens]]
name = "ops-config-read"
token = "ops-config-token"
policy_template = "audit_read"
config_sections = ["selection", "session_store"] # 显式 section 会覆盖模板里的 config_profile
# config_profile = "auditor" # 可选 preset: operator | auditor | admin（与 config_sections 二选一）
```

```bash
# 管理写接口鉴权 token（推荐从 ~/.grobot/config.toml 的 [management].token 读取）
export GROBOT_MGMT_TOKEN="replace-with-management-token"

# 启动管理 API（默认读取 .grobot/project.toml 里的 gateway.management.bind）
grobot serve \
  --project <project-name> \
  --work-dir "$(pwd)"

# 可指定端口
grobot serve \
  --project <project-name> \
  --work-dir "$(pwd)" \
  --bind 127.0.0.1:18080

# 也可直接用 CLI 覆盖管理 token（优先级高于 env/config）
grobot serve \
  --project <project-name> \
  --work-dir "$(pwd)" \
  --bind 127.0.0.1:18080 \
  --management-token "$GROBOT_MGMT_TOKEN"

# 也可显式要求 /api/v1/config 必须鉴权（适合公网）
grobot serve \
  --project <project-name> \
  --work-dir "$(pwd)" \
  --bind 0.0.0.0:18080 \
  --management-token "$GROBOT_MGMT_TOKEN" \
  --config-read-policy auth

# 查看状态
curl -sS http://127.0.0.1:18080/api/v1/status | jq

# 查看当前生效配置（敏感字段自动脱敏）
curl -sS \
  http://127.0.0.1:18080/api/v1/config \
  -H "Authorization: Bearer $GROBOT_MGMT_TOKEN" | jq

# 热重载 .grobot/project.toml 与 .grobot/config.toml
curl -sS -X POST \
  http://127.0.0.1:18080/api/v1/reload \
  -H "Authorization: Bearer $GROBOT_MGMT_TOKEN" | jq

# 中断指定会话（session id 可用 status 输出里的 session_preview）
curl -sS -X POST \
  http://127.0.0.1:18080/api/v1/sessions/feishu%3Agrobot%3Adm%3Agrobot/interrupt \
  -H "Authorization: Bearer $GROBOT_MGMT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ttl_secs":300}' | jq
```

## 文档导航

所有核心设计文档位于 `.trellis/spec/guides/`：

- [`agent-platform-blueprint.md`](.trellis/spec/guides/agent-platform-blueprint.md)
  - 主架构蓝图、分层职责、核心控制流、SLO 目标。
- [`agent-gateway-runtime-guide.md`](.trellis/spec/guides/agent-gateway-runtime-guide.md)
  - 会话键规范、事件协议、网关与运行时契约、并发与降级策略。
- [`agent-memory-context-guide.md`](.trellis/spec/guides/agent-memory-context-guide.md)
  - 记忆分层、写入/召回链路、生命周期、上下文压缩策略。
- [`agent-eval-observability-security-guide.md`](.trellis/spec/guides/agent-eval-observability-security-guide.md)
  - 评测门禁、Trace 事件、SLO 告警、安全边界与审计。
- [`agent-implementation-roadmap.md`](.trellis/spec/guides/agent-implementation-roadmap.md)
  - 从 MVP 到企业化的阶段路线图与验收标准。
- [`index.md`](.trellis/spec/guides/index.md)
  - guides 总索引与触发条件。

## Trellis 启动方式

1. 新会话先执行 `/trellis:start`，同步当前项目上下文与协作规则。
2. 从 `index.md` 选择本轮任务对应的 guide（架构、运行时、记忆、评测安全）。
3. 变更前先固定契约与验收标准，变更后补充验证证据。

## 推荐实施顺序

1. 先读 `agent-platform-blueprint.md`，确认边界与目标。
2. 按 `agent-gateway-runtime-guide.md` 固定契约和会话模型。
3. 按 `agent-memory-context-guide.md` 落记忆与上下文策略。
4. 同步接入 `agent-eval-observability-security-guide.md` 的门禁与追踪。
5. 按 `agent-implementation-roadmap.md` 分阶段推进（MVP -> 100并发 -> GA）。

## 参考资料（已采信）

- Anthropic Managed Agents / Harness / Context / Evals
- cc-connect（配置、Bridge 协议、Management API）
- MemOS、Cortex（记忆系统）
- Hermes Agent、IronClaw、Pi Mono（开源工程模式）
- Claude Code Hub（企业网关与调度思路）
- Karpathy LLM Wiki（持久化知识工件模式）

---

## English Summary

`grobot` is an enterprise agent-engineering workspace using Trellis and a TypeScript + Rust split:

- TypeScript for gateway, platform adapters, management APIs, and orchestration.
- Rust for high-concurrency runtime execution, scheduling, and policy enforcement.
- Target: Feishu + Telegram launch, 100 concurrent sessions, strong session isolation, and model-agnostic quality through harness/context/memory/eval/trace/security engineering.

Start from:

- `.trellis/spec/guides/agent-platform-blueprint.md`
- `.trellis/spec/guides/index.md`
