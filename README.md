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
  - `~/.grobot/rules/`、`~/.grobot/skills/`、`~/.grobot/hooks/`、`~/.grobot/mcp/servers.toml`
  - `~/.grobot/runtime/sessions/`、`~/.grobot/runtime/memory/session/`、`~/.grobot/memory/global/`
- 项目运行层（`<业务仓库>/.grobot/`）：
  - `.grobot/project.toml`：项目级架构/运行契约（source of truth）
  - `.grobot/mcp.toml`：项目级 MCP 覆盖
  - `.grobot/rules/`、`.grobot/skills/`、`.grobot/hooks/`、`.grobot/memory/`

### 配置初始化

```bash
# 1) 初始化全局 home（默认 ~/.grobot，可用 --home 覆盖）
grobot init --global

# 2) 在业务仓库初始化项目层（默认当前目录）
grobot init --project

# 3) 或指定项目目录
grobot init --project --project-root /path/to/your/repo

# 4) 初始化时同时生成 hooks 样例脚本（可直接 chmod 后使用）
grobot init --project --hooks-samples
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
- `grobot init --global` 会自动创建 `~/.grobot/mcp/servers.toml`（全局 MCP 注册表）。
- `grobot init --project` 会自动创建 `<repo>/.grobot/mcp.toml`（项目级 MCP 覆盖）。
- `grobot init` 会同时创建 hooks 目录：`hooks/user-prompt-submit/`、`hooks/before-tool-use/`、`hooks/after-tool-use/`（全局和项目层都会有）。

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
- `start` 已内置基础本地工具：`list`、`glob`、`search`、`read`、`write`、`edit`、`bash`、`mcp_servers`、`mcp_call`（通过 Chat Completions `tools` 调用）。
- `bash` 放行受 `.grobot/project.toml` 的 `[tools].allow` 控制；`read/write/edit` 仅允许访问 `--work-dir` 目录内路径。
- `list/glob/search` 优先使用 `fd/rg`（不存在时自动回退到 Python 实现）。
- `search` 支持 `context_before/context_after`，可直接返回命中行前后文（类似 `rg -B/-A`）。
- 支持 `@文件名` 快速解析：在用户消息中写 `@xxx`，会先在 `--work-dir` 内做文件匹配并把解析结果注入 prompt（命中唯一路径可直接用于后续读写工具）。
- `@文件名` 解析使用“常驻内存路径索引 + 增量刷新（added/removed diff）”，匹配阶段采用 trigram 候选集与优先级排序，适配大仓库搜索。
- Skills 按“描述符常驻 + 正文按需加载”运行：每轮先扫描 global/project skills 描述，命中时仅加载一个最匹配的 `SKILL.md`，并对 `Don't use when` 反例做强降权。
- 对带副作用的 skill（如部署/发布），路由块会附带速率约束提示（批量写入、避免逐条循环、遇到 429 回退重试）。
- Skills 路由阈值可在 `.grobot/project.toml` 的 `[skills.router]` 与 `[skills.runtime]` 配置（`score_threshold`、`min_score_gap`、`max_descriptors`、`descriptor_scan_lines`、`max_skill_block_chars`）。
- Skills 路由观测可在 `.grobot/project.toml` 的 `[skills.observability]` 配置（`enabled`、`path`），每轮会写入 JSONL（包含 selected skill、score、hits、prompt preview 与阈值配置）。
- MCP 会在启动时读取并合并：`~/.grobot/mcp/servers.toml`（全局） + `<repo>/.grobot/mcp.toml`（项目覆盖同名 server）。
- MCP 会在启动时做命令就绪度检查（ready/unready），并在 `status`、`serve`、`start`、`/mcp` 中显示原因。
- `mcp_call` 会按 `initialize -> tools/list -> tools/call` 流程通过 stdio 调用 MCP server，并返回标准化结果预览（含 `is_error/content/structured_content_preview`）。
- 同一 `start` 会话内，`mcp_call` 会复用已初始化的 MCP 进程（避免每次重启 server，降低时延）。
- 若复用中的 MCP 进程异常退出，`mcp_call` 会自动重建会话并重试一次，降低偶发中断对会话的影响。
- `mcp_call` 内置每个 server 的并发/排队/熔断门禁（避免高并发下把同一个 MCP server 打挂）。
- `mcp_call` 支持 `[tools.mcp].allow_tools` 白名单；不在白名单中的 MCP tool 会被拒绝调用。
- `mcp_call`/`mcp_servers` 会输出 server 级 `runtime_state` 指标；`mcp_servers` 还会输出跨 server 聚合的 `runtime_summary`（含总调用、失败分桶、延迟分位和 `top_errors`）。
  - `runtime_state` 同时包含失败分桶：`policy_denied_calls`、`gate_rejected_calls`、`timeout_failures`、`transport_failures`、`tool_failures`、`unknown_failures`。
  - 管理 API 可对会话设置 interrupt 标记，`start` 在下一轮调用前会消费该标记并跳过当次请求。
  - 支持 hooks 事件：`user-prompt-submit`、`before-tool-use`、`after-tool-use`。脚本目录支持全局（`~/.grobot/hooks/<event>/`）和项目层（`<repo>/.grobot/hooks/<event>/`）。
  - hooks 脚本读取 STDIN JSON（事件 payload）；可通过 `.grobot/project.toml` 的 `[hooks]` 配置 `enabled/strict/timeout_secs`。
- 交互命令新增 `/hooks`，可查看当前会话的 hook policy 与生效脚本列表。
- 交互命令新增 `/health`，用于查看 provider 熔断状态（CLOSED/OPEN/HALF_OPEN）。
- 交互命令新增 `/mcp`，用于查看当前会话的 MCP 生效列表与告警。
- 交互命令支持 `/mcp reset <server|all>`，用于关闭对应 MCP 会话并清空 gate/metrics 状态。
- 交互命令新增 `/memory ...`：Memory v1 的写入提案、审核应用与检索。

### Wiki v1（Memory + Wiki 双轨）

默认模式是 `review_first`：先产出提案，再审核应用，避免直接写坏知识库。

```bash
# 查看 wiki 运行状态（当前会话 scope、读写根目录、写入模式）
grobot wiki status --project <project-name> --work-dir "$(pwd)"

# 生成 ingest 提案（默认不直接写入页面）
grobot wiki ingest \
  --project <project-name> \
  --work-dir "$(pwd)" \
  --source "docs/architecture.md" \
  --scope auto

# 查询 wiki（可选保存为 insight 提案）
grobot wiki query \
  --project <project-name> \
  --work-dir "$(pwd)" \
  --query "支付回滚策略" \
  --save

# 审核提案
grobot wiki review list --project <project-name> --work-dir "$(pwd)"
grobot wiki review show <proposal_id> --project <project-name> --work-dir "$(pwd)"
grobot wiki review apply <proposal_id> --project <project-name> --work-dir "$(pwd)"
grobot wiki review reject <proposal_id> "信息不完整" --project <project-name> --work-dir "$(pwd)"

# 运行 wiki lint（孤儿页/坏链/陈旧页/标题冲突）
grobot wiki lint --project <project-name> --work-dir "$(pwd)"
```

交互模式也支持：
- `/wiki status`
- `/wiki ingest <source>`
- `/wiki query <query>`
- `/wiki lint`
- `/wiki review list|show|apply|reject ...`

作用域与隔离：
- `user`: `.grobot/wiki/users/<subject>/`（私有）
- `group`: `.grobot/wiki/groups/<subject>/`（群级共享）
- `org`: `~/.grobot/wiki/org/<tenant>/`（组织级，需显式开启 `allow_org_shared_read`）
- `shared`: `.grobot/wiki/shared/`（项目共享）

### Memory v1（个人/群组/组织记忆）

默认模式也是 `review_first`：写入先进入提案，审核后再入库，避免错误记忆污染。

```bash
# 查看 memory v1 运行状态（scope 根目录 + 检索阈值）
grobot memory status --project <project-name> --work-dir "$(pwd)"

# 创建记忆写入提案（默认不直接入库）
grobot memory write \
  --project <project-name> \
  --work-dir "$(pwd)" \
  --kind episodic \
  --scope auto \
  --tags "payment,rollback" \
  --text "支付回滚先锁单，再补偿；超时 30s 告警。"

# 查询记忆（按 lexical + importance + confidence + recency 融合排序）
grobot memory query \
  --project <project-name> \
  --work-dir "$(pwd)" \
  --query "支付回滚告警规则"

# 如需显式检索敏感记忆（默认关闭）
grobot memory query \
  --project <project-name> \
  --work-dir "$(pwd)" \
  --query "补偿审批手机号" \
  --include-restricted

# 审核提案
grobot memory review list --project <project-name> --work-dir "$(pwd)"
grobot memory review show <proposal_id> --project <project-name> --work-dir "$(pwd)"
grobot memory review apply <proposal_id> --project <project-name> --work-dir "$(pwd)"
grobot memory review reject <proposal_id> "不满足事实依据" --project <project-name> --work-dir "$(pwd)"

# 生命周期维护（promote/decay/archive）
grobot memory lifecycle --project <project-name> --work-dir "$(pwd)" --scope auto
grobot memory lifecycle --project <project-name> --work-dir "$(pwd)" --dry-run
```

交互模式也支持：
- `/memory status`
- `/memory write ...`
- `/memory query ...`
- `/memory review list|show|apply|reject ...`
- `/memory lifecycle [--scope <auto|user|group|org>] [--dry-run]`

记忆分类（kind）：
- `episodic`：会话/任务经过
- `semantic`：稳定事实与结论
- `preference`：个人或群组偏好
- `policy`：约束、制度、操作边界

记忆作用域（scope）：
- `user`: `.grobot/memory/v1/users/<subject>/`
- `group`: `.grobot/memory/v1/groups/<subject>/`
- `org`: `~/.grobot/memory/global/v1/org/<tenant>/`（默认关闭，需显式开启）

隐私默认策略：
- `restricted/secret` 记忆默认不参与普通 `query` 与会话上下文注入
- 仅在显式开启 `--include-restricted` / `--include-secret` 时返回

生命周期策略（`[memory.v1.lifecycle]`）：
- `promote`：高置信/高重要性的老 `episodic` 记忆提升为 `semantic`
- `decay`：长期未更新记忆按衰减因子下调 `importance`
- `archive`：超长期、低价值或短期事件记忆归档（不再参与默认检索）

### MCP 配置示例

```toml
# ~/.grobot/mcp/servers.toml
[[servers]]
name = "ctx-global"
command = "npx"
args = ["-y", "contextweaver-mcp@latest"]
enabled = true

[servers.env]
CONTEXTWEAVER_API_KEY = "replace-with-api-key"
```

```toml
# <repo>/.grobot/mcp.toml
[[servers]]
name = "ctx-global"
command = "npx"
args = ["-y", "contextweaver-mcp@latest"]
enabled = false # 通过同名覆盖关闭全局 server

[[servers]]
name = "ctx-project"
command = "npx"
args = ["-y", "project-local-mcp@latest"]
enabled = true
```

```toml
# <repo>/.grobot/project.toml
[tools.mcp]
max_concurrency_per_server = 1
max_queue_per_server = 16
failure_threshold = 3
cooldown_secs = 20
allow_tools = ["*"] # 可选：["search_code", "read_repo"]；["*"] 或省略表示不限制
latency_sample_limit = 256 # 可选：延迟样本保留上限（16..1024）
```

```toml
# <repo>/.grobot/project.toml
[hooks]
enabled = true
strict = false
timeout_secs = 5
```

### MCP 工具调用示例（会话内）

当你在 `grobot start` 交互里让模型调用本地工具时，可按下述参数约定触发：

```json
{
  "name": "mcp_call",
  "arguments": {
    "server": "ctx-project",
    "tool": "search_code",
    "arguments": {
      "query": "ContextWeaver"
    },
    "timeout_secs": 20
  }
}
```

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

# 6) Skill 路由离线评测（准确率/精确率/召回率/禁用命中）
npm run harness:skill-router:sample

# 7) Skill 路由门禁（CI / prod）
npm run harness:skill-router:gate:ci
npm run harness:skill-router:gate:prod

# 8) Skill 路由 policy 自检（schema/version/path/hash）
npm run harness:skill-router:policy:check
npm run harness:skill-router:policy:fingerprint
npm run harness:skill-router:policy:validate

# 9) 统一汇总 trace + skill-router 报告（用于 CI 摘要）
npm run harness:ci-summary
```

### 管理端点（已实现 status/config/reload/interrupt/mcp-reset/memory-ops）

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
- `memory_ops_readonly`：`actions=["memory_read"]`
- `memory_ops_writer`：`actions=["memory_import","memory_forget","memory_lifecycle"]`
- 显式字段优先：若同时配置 `actions/config_sections/config_profile/interrupt_session_prefixes`，会覆盖模板默认值。

最小权限模板建议（可直接复用）：
- 只读运维：`policy_template="memory_ops_readonly"` + `interrupt_session_prefixes=["feishu:grobot:dm:"]`
- 导入专员：`actions=["memory_import"]` + `interrupt_session_prefixes=[...]`
- 清理专员：`actions=["memory_forget"]` + `interrupt_session_prefixes=[...]`
- 生命周期维护专员：`actions=["memory_lifecycle"]` 或 `policy_template="memory_ops_writer"`

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

[[management.tokens]]
name = "ops-memory"
token = "ops-memory-token"
actions = ["memory_read", "memory_import", "memory_forget", "memory_lifecycle"]
interrupt_session_prefixes = ["feishu:grobot:dm:"] # 可选：限制可操作 session 前缀

# 兼容旧配置：
# actions = ["memory_manage"] # 等价授权 memory_read/import/forget/lifecycle
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

# 重置所有 MCP gate/metrics 与会话（远程运维）
curl -sS -X POST \
  http://127.0.0.1:18080/api/v1/mcp/reset \
  -H "Authorization: Bearer $GROBOT_MGMT_TOKEN" | jq

# 只重置指定 MCP server（名字需 URL 编码）
curl -sS -X POST \
  http://127.0.0.1:18080/api/v1/mcp/servers/ctx-project/reset \
  -H "Authorization: Bearer $GROBOT_MGMT_TOKEN" | jq

# 列出会话记忆（默认不含 archived/restricted/secret）
curl -sS \
  "http://127.0.0.1:18080/api/v1/sessions/feishu%3Agrobot%3Adm%3Agrobot/memory?limit=20" \
  -H "Authorization: Bearer $GROBOT_MGMT_TOKEN" | jq

# 分页读取会话记忆（cursor 为下一页游标）
curl -sS \
  "http://127.0.0.1:18080/api/v1/sessions/feishu%3Agrobot%3Adm%3Agrobot/memory?limit=20&cursor=20" \
  -H "Authorization: Bearer $GROBOT_MGMT_TOKEN" | jq

# 导出会话记忆（可包含 archived + restricted）
curl -sS \
  "http://127.0.0.1:18080/api/v1/sessions/feishu%3Agrobot%3Adm%3Agrobot/memory/export?include_archived=true&include_restricted=true&limit=200" \
  -H "Authorization: Bearer $GROBOT_MGMT_TOKEN" | jq

# 归档（forget）指定 memory id（支持 dry_run）
curl -sS -X POST \
  http://127.0.0.1:18080/api/v1/sessions/feishu%3Agrobot%3Adm%3Agrobot/memory/forget \
  -H "Authorization: Bearer $GROBOT_MGMT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids":["mm202604010001abcd"],"reason":"privacy_cleanup","dry_run":true}' | jq

# 导入记忆（按 fingerprint upsert）
curl -sS -X POST \
  http://127.0.0.1:18080/api/v1/sessions/feishu%3Agrobot%3Adm%3Agrobot/memory/import \
  -H "Authorization: Bearer $GROBOT_MGMT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scope":"auto","records":[{"text":"退款 SLA 为 24 小时","kind":"semantic","classification":"internal","importance":0.9,"confidence":0.8,"tags":["sla","refund"]}]}' | jq

# 运行记忆生命周期维护（promote/decay/archive，支持 dry_run）
curl -sS -X POST \
  http://127.0.0.1:18080/api/v1/sessions/feishu%3Agrobot%3Adm%3Agrobot/memory/lifecycle \
  -H "Authorization: Bearer $GROBOT_MGMT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scope":"auto","dry_run":true}' | jq

# 批量运行生命周期维护（按 prefix 自动发现会话）
curl -sS -X POST \
  http://127.0.0.1:18080/api/v1/memory/lifecycle/run \
  -H "Authorization: Bearer $GROBOT_MGMT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scope":"auto","dry_run":true,"session_prefix":"feishu:grobot:dm:","limit":50}' | jq

# 批量运行生命周期维护（显式指定会话列表）
curl -sS -X POST \
  http://127.0.0.1:18080/api/v1/memory/lifecycle/run \
  -H "Authorization: Bearer $GROBOT_MGMT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scope":"auto","dry_run":false,"sessions":["feishu:grobot:dm:open_a","feishu:grobot:group:chat_x"]}' | jq

# hooks 体检（输出当前 policy、脚本清单与可执行性检查）
grobot hooks doctor \
  --project <project-name> \
  --work-dir "$(pwd)"

# hooks 体检 JSON（可接 CI/脚本）
grobot hooks doctor \
  --project <project-name> \
  --work-dir "$(pwd)" \
  --json
```

说明：
- `mcp/reset` 仅作用于当前 `grobot serve` 进程内的 MCP 运行态（会话与 gate 指标）；与独立进程启动的 `grobot start` 不共享。
- `GET /api/v1/status` 与 `GET /api/v1/config` 现在会返回 `hooks_policy` + `hooks_runtime`（含事件脚本计数与路径）。
- memory 管理端点支持细粒度鉴权：`memory_read`（list/export）、`memory_import`、`memory_forget`、`memory_lifecycle`，并写入 `events.jsonl` 审计事件（`management_memory_*`）。
- 为兼容旧配置，`memory_manage` 仍保留并等价授权以上细粒度动作。
- `/memory` 与 `/memory/export` 支持 `cursor` 分页，响应会返回 `next_cursor` 与 `has_more`。
- `/memory/import` 启用严格 schema 校验（字段类型/枚举/数值范围），任意记录不合法会整体拒绝并返回 `invalid_rows` 明细。
- `/memory/import` 请求体大小默认上限 `1 MiB`，超限返回 `413 payload_too_large`。
- `POST /api/v1/memory/lifecycle/run` 支持批量生命周期维护（`sessions[]` 或 `session_prefix/session_prefixes`），并在 `/api/v1/status` 暴露 `memory_management.lifecycle` 指标（最近执行、成功/失败计数、动作汇总、最近报告路径）。

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
