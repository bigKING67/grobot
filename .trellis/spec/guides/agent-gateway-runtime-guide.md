# Agent Gateway and Runtime Guide

> Scope: Contracts and execution behavior for the TypeScript gateway and Rust runtime core.

---

## 1. Runtime Contracts

### 1.1 SessionKey

Canonical format:

```text
<platform>:<tenant>:<scope>:<subject>
```

Examples:

- `feishu:acme:dm:ou_xxx`
- `telegram:acme:group:chat123_thread456`

Rules:

- `platform` is adapter identifier (`feishu`, `telegram`).
- `tenant` is enterprise slug.
- `scope` is `dm` or `group`.
- `subject` is user/thread/session discriminator.

### 1.2 TurnRequest

```json
{
  "request_id": "uuid",
  "session_key": "feishu:acme:dm:ou_xxx",
  "project_id": "backend-core",
  "message": "text",
  "attachments": [],
  "channel_meta": {
    "reply_ctx": "opaque",
    "thread_id": "optional"
  },
  "priority": "normal",
  "requested_mode": "default"
}
```

### 1.3 RuntimeEvent

```json
{
  "event_id": "uuid",
  "trace_id": "uuid",
  "session_key": "...",
  "turn_id": "uuid",
  "event_type": "tool_end",
  "ts": "2026-04-09T16:00:00Z",
  "status": "ok",
  "error_code": "",
  "payload": {}
}
```

Required event types:

- `turn_start`
- `model_request`
- `model_response`
- `tool_start`
- `tool_end`
- `turn_stream_chunk`
- `turn_end`
- `turn_failed`
- `session_resume`

Optional observability event types:

- `prompt_cache_hint_applied`
- `prompt_cache_usage_observed`

### 1.4 ToolCallContract

```json
{
  "tool_name": "fs.read_file",
  "input": {
    "path": "..."
  },
  "capability": "read",
  "timeout_ms": 15000,
  "retryable": false
}
```

Structured error contract:

```json
{
  "error_code": "TOOL_TIMEOUT",
  "message": "Timed out after 15000ms",
  "retry_hint": "retry_with_shorter_scope"
}
```

---

## 2. TypeScript Gateway Responsibilities

### 2.1 Channel Adapter Layer

- Normalize inbound IM messages into canonical `TurnRequest`.
- Maintain channel-specific reply handles for streaming/final updates.
- Support per-channel controls:
  - Feishu thread mode and group isolation.
  - Telegram group mention mode and session sharing mode.

### 2.2 Access and Guard Layer

- Authenticate users by platform identity mapping.
- Apply command ACL (`admin_from`, role-based restrictions).
- Enforce rate limit:
  - per-user sliding window
  - per-session burst control
  - outbound throttle by platform

### 2.3 Orchestration Layer

- Resolve project by routing rule (`[[projects]]` style config).
- Dispatch turn to Rust runtime via gRPC (localhost for MVP, service mesh later).
- Stream runtime chunks to IM platform preview/final message.

### 2.4 Management Endpoints

- `GET /api/v1/status`
- `GET /api/v1/config`
- `POST /api/v1/reload`
- `POST /api/v1/sessions/{id}/interrupt`
- `GET /api/v1/traces/{trace_id}`

All responses use envelope:

```json
{ "ok": true, "data": {} }
```

or

```json
{ "ok": false, "error": "message" }
```

### 2.5 `grobot status --json` Observability Contract

Gateway status output should include route and cache observability fields:

- `route_decision`
  - `strategy` (`sticky+score`)
  - `primary_provider`
  - `requested_provider`
  - `ordered_providers`
  - `source`
  - `reason`
  - `configured_primary_provider`
  - `observed`:
    - `source`
    - `active_session_id`
    - `updated_at`
    - `sticky_provider`
    - `selected_provider`
    - `reason`
    - `provider_runtime_states`
  - `failover.circuit_failures`
  - `failover.circuit_cooldown_secs`
  - `failover.sticky_mode`
- `runtime_health.cache_stats`
  - `process_since_unix_ms`
  - `window_since_unix_ms`
  - `window_duration_ms`
  - `window_policy_ms`
  - `model_catalog` (`cache_entries/hit_total/miss_total/stale_total/write_total`)
    - `window` (`hit_total/miss_total/stale_total/write_total`)
  - `prompt_cache` (`enabled_total/hint_attempted_total/hint_applied_total/usage_observed_total/cached_tokens_total`)
    - `window` (`enabled_total/hint_attempted_total/hint_applied_total/usage_observed_total/cached_tokens_total`)
- `runtime_tool_recovery_policy.escalation`
  - `same_tool_error_strategy_switch_threshold`
  - `same_tool_error_ask_user_threshold`
  - `environment_ask_user_threshold`
  - `browser_environment_ask_user_threshold`
- `runtime_tool_recovery_feedback.browser_environment_recovery`
  - `error_code`
  - `action`
  - `retry_allowed`
  - `commands`
- `runtime_tool_recovery_feedback.mcp_environment_recovery`
  - `error_code`
  - `action`
  - `retry_allowed`
  - `commands`
  - `server`
  - `tool_name`
  - `source_path`
  - `ready_reason`
  - `command`
  - `available_servers`
  - `registry_paths`
- `runtime_tool_recovery_feedback.runtime_environment_recovery`
  - `error_code`
  - `action`
  - `retry_allowed`
  - `commands`
  - `error_class`
  - `detail`
  - `source_path`
  - `required_config`
  - `work_dir`
- `runtime_tool_recovery_timeline[*].browser_environment_recovery`
  - `error_code`
  - `action`
  - `retry_allowed`
  - `commands`
- `runtime_tool_recovery_timeline[*].mcp_environment_recovery`
  - `error_code`
  - `action`
  - `retry_allowed`
  - `commands`
  - `server`
  - `tool_name`
  - `source_path`
  - `ready_reason`
  - `command`
  - `available_servers`
  - `registry_paths`
- `runtime_tool_recovery_timeline[*].runtime_environment_recovery`
  - `error_code`
  - `action`
  - `retry_allowed`
  - `commands`
  - `error_class`
  - `detail`
  - `source_path`
  - `required_config`
  - `work_dir`
- `runtime_tool_recovery_health.attention_browser_environment_recovery`
- `runtime_tool_recovery_health.attention_mcp_environment_recovery`
- `runtime_tool_recovery_health.attention_runtime_environment_recovery`
- `runtime_tool_recovery_readiness.attention_browser_environment_recovery`
- `runtime_tool_recovery_readiness.attention_mcp_environment_recovery`
- `runtime_tool_recovery_readiness.attention_runtime_environment_recovery`
- `runtime_tool_recovery_gate.attention_browser_environment_recovery`
- `runtime_tool_recovery_gate.attention_mcp_environment_recovery`
- `runtime_tool_recovery_gate.attention_runtime_environment_recovery`
- `runtime_tool_recovery_gate.blocker_kind`
  - `none`
  - `runtime_environment`
  - `browser_environment`
  - `mcp_environment`
  - `operator_action`
  - `automatic_recovery_policy`
  - `readiness_state`
- `runtime_tool_recovery_gate.blocker_code`
- `runtime_tool_recovery_gate.blocker_action`
- `cache_stats_location` (canonical pointer, currently `runtime_health.cache_stats`)

Tool surface schema profiles are part of the gateway/runtime contract. The default `browser`
profile must stay slim enough for normal browser tasks: expose scan/action primitives and common
tab/session selection, but keep low-frequency selectors such as `text_only` and
`session_url_pattern` in `browser_advanced`/`full_debug`. Runtime dispatch must reject hidden
browser args for the active profile instead of silently accepting parameters that the model could
not see in its schema.
Gateway fallback `schema_fingerprint` must be projection-aware. It should include the projection
mode, advanced-schema flag, schema property counts, and per-tool visible/suppressed args, not only
the visible tool list; otherwise profiles with the same tools but different argument surfaces can
silently share a fingerprint.
`read` should also project a slim schema in lightweight profiles (`minimal`, `browser`, and
`context`): expose `path`, `offset`, `limit`, and `include_metadata`, while keeping legacy
`line_start`/`line_end` and media `pages` selection in `coding`, `browser_advanced`, and
`full_debug`. Hidden `read` args must fail before request parsing so schema slimming remains a hard
execution boundary.
`semantic_search` should project a slim schema in the `context` profile: expose only normal
retrieval controls (`query`, `sources`, `per_source_limit`, `max_segments`, `include_org`) and keep
bridge overrides, forced refresh, timeout tuning, and manual technical-term hints in `full_debug`.
Hidden semantic-search args must fail before the ContextWeaver bridge runs.
`ask_user` should expose only `questions` outside `full_debug`. Internal blocking/resume/default
timeout fields are orchestration state, not normal model controls, and must be rejected when hidden
from the active schema.
`mcp_servers` should expose only `ready_only` outside `full_debug`. Disabled-server inventory is an
operator/debug control, not a normal model control, so `include_disabled` must be rejected when
hidden from the active MCP schema and normal MCP listing should exclude disabled servers by default.
`mcp_call.arguments` remains a general JSON object because MCP tool schemas are server-defined, but
runtime must treat it as bounded untrusted input: reject non-object payloads with structured
`invalid_tool_arguments` data and reject oversized argument objects before server lookup/spawn with a
machine-readable size-limit error.
MCP execution recovery must preserve call context without dumping the full payload. JSON-RPC errors,
transport/protocol failures, and MCP `isError=true` tool results include `server`, `tool_name`,
`argument_keys`, `argument_bytes`, `max_argument_bytes`, and a capped/redacted `argument_preview` so
the next turn can change a concrete variable without re-probing blindly.

Browser facade recovery must treat repeated environment failures as operator-action signals. For
`browser_backend_result_error` with `error_code` in `NO_EXTENSION`, `NO_SESSION`, or
`TRANSPORT_UNAVAILABLE`, the second same-tool recovery escalates to `ask_user` with
`recommended_next_action=request_environment_fix`. Retryable browser execution failures such as
`TIMEOUT` keep the generic repeated-error thresholds. The recovery prompt must include the
browser-specific execution rule instead of the generic environment instruction: ask the user to
repair the browser environment with the listed setup/hub/doctor commands, and do not retry the
browser tool until `grobot browser doctor` confirms the environment is ready. The following
`Browser environment fix:` line must carry the concrete recovery plan commands
(`grobot browser setup`, `grobot browser hub start`, `grobot browser doctor`) and the specific
retry prerequisite for the observed error code.

MCP environment recovery follows the same fail-fast discipline for configuration/readiness issues.
`mcp_server_not_found`, `mcp_server_unready`, and repeated `mcp_spawn_failed` must surface an
operator recovery plan instead of encouraging blind retries. The plan points to
`~/.grobot/mcp/servers.toml` and `.grobot/mcp.toml`, preserves the runtime-reported `source_path`
when available, carries actionable diagnostics (`ready_reason`, failed `command`, and
`available_servers` for missing-server errors), includes `grobot status --json` as the readiness
check, and blocks automatic `mcp_call` retry until status shows the target server is configured and
ready.

Runtime environment recovery covers non-browser/non-MCP operator-fix errors surfaced by runtime
tools. `config_missing`, `tool_context_missing`, `tool_context_invalid`, and
`runtime_state_unavailable` must expose a structured `runtime_environment_recovery` plan in feedback,
timeline, health, readiness, and gate status surfaces. Config failures include
`grobot status --json` and `grobot status --probe --json` checks and preserve inferred missing
configuration (`model_config.api_key`, `model_config.base_url`,
`provider_options.kimi.files_enabled=true`, or `kimi-k2.5`) when available. Tool-context and runtime
state failures block automatic retry until `grobot status --json` confirms a valid workspace/tool
context or the current grobot session has been restarted after state remains unavailable.
Rust runtime environment errors should carry structured `error_data` with `diagnostic_kind`,
`recovery_hint`, `source`, and `work_dir` when available; gateway recovery plans must prefer these
fields over parsing free-form error messages.
`config_missing` errors should also set `required_config` to the canonical missing runtime contract
path (`model_config.api_key`, `model_config.base_url`, `provider_options.kimi.files_enabled=true`,
`kimi-k2.5`, etc.) so gateway plans can keep message parsing as a legacy fallback only.

The readiness gate keeps the high-level `reason` stable for policy compatibility, but must also
expose a concrete blocker triplet. Environment-plan blockers use `blocker_kind` to identify the
family (`runtime_environment`, `browser_environment`, or `mcp_environment`), `blocker_code` to carry
the concrete plan error code (`CONFIG_MISSING`, `NO_EXTENSION`, `SERVER_UNREADY`, etc.), and
`blocker_action` to carry the recovery action. Non-environment gate failures fall back to
`operator_action`, `automatic_recovery_policy`, or `readiness_state`.
When a blocker prevents automatic tool-surface adaptation, the adaptation reason should use the
environment-specific blocker when available (for example
`recovery_gate_runtime_environment_config_missing`) instead of collapsing all operator fixes into
`recovery_gate_blocked_operator_action_required`.
Gateway status/readiness/gate formatters should route environment recovery fields through the
runtime environment recovery family helper so runtime/browser/MCP plan fields stay symmetric across
JSON and text surfaces.

`ask_user` questions marked with `is_secret=true` keep the raw answer available only in the current
turn's `[AskUser Resolution]` prompt so the agent can act on credentials or other sensitive
operator input. Secret answers must be redacted from terminal review surfaces, session previews,
chat history, memory/experience ingestion, and diagnostic logs with the stable marker
`<redacted:ask_user_secret>`. When a secret answer is resolved, the turn runner should use the
redacted safe user text for history, context injection, tool-surface routing, and provider failure
feedback; the raw answer must not be used as the normal conversation message.

---

## 3. Rust Runtime Core Responsibilities

### 3.1 Session Mailbox Model

- One mailbox per `SessionKey`.
- One active turn per session.
- Global scheduler executes many sessions in parallel.

### 3.2 Turn State Machine

States:

- `Queued`
- `Running::Modeling`
- `Running::Tooling`
- `WaitingExternal`
- `Completed`
- `Failed`
- `Cancelled`

Transitions are event-driven and persisted per turn.

### 3.3 Scheduler Policy

- Weighted fair scheduling by project priority.
- Queue depth limits and backpressure signaling.
- Lease-based turn ownership for crash recovery.

### 3.4 Provider Routing

Runtime resolves provider candidates from policy:

```toml
[provider_routing]
max_failover_attempts = 3
session_sticky_ttl_secs = 300

[[provider_routing.groups]]
name = "primary"
priority = 1
strategy = "weighted"

[[provider_routing.groups.targets]]
provider = "openai-compatible"
model = "gpt-5.4"
weight = 60

[[provider_routing.groups.targets]]
provider = "moonshot"
model = "kimi-2.5"
weight = 40
```

Failover order:

1. next target in same priority group
2. next priority group
3. explicit failure event if budget exhausted

Status and diagnostics should expose routing decisions with explicit reason/source to support postmortem and policy tuning.

Prompt-cache support should use explicit provider capability flags rather than model/base-url substring heuristics.

### 3.5 Tool Execution

- Validate tool capability before invocation.
- Attach execution identity (`session`, `turn`, `trace`, `project`).
- Enforce timeout and retry policy per tool category.
- Emit `tool_start` and `tool_end` with normalized output summary.

---

## 4. 100-Concurrency Capacity Rules

### 4.1 Minimum Runtime Settings (Scale Profile)

- Runtime workers: `16-24` async executors per node.
- Active turn soft limit per node: `60`.
- Queue spillover: Redis stream / durable queue.
- Gateway replicas: minimum `2`.

### 4.2 Timeout Budgets

- Model call timeout: 45s default, 120s max for long tasks.
- Tool timeout:
  - read-only tools 15s
  - network tools 30s
  - background job trigger 10s ack + async completion
- Full turn timeout: 180s standard class.

### 4.3 Degradation Sequence

1. disable verbose streaming previews
2. reduce non-critical tool retries
3. raise task-class threshold for expensive routes
4. queue low-priority turns
5. reject with explicit overload error if hard capacity reached

---

## 5. Session Control

### 5.1 Commands

- `/new`: rotate to fresh session context.
- `/switch <session>`: bind active session.
- `/stop`: cancel current turn.
- `/mode <default|plan|acceptEdits|yolo>`: update permission mode.

### 5.2 Isolation Modes

- `share_session_in_channel=false` (default for enterprise).
- `thread_isolation=true` for group thread-bound workflows.
- `reply_in_thread=true` recommended for traceability.

---

## 6. Configuration Shape (`config.toml`)

Recommended top-level sections:

- `log`
- `rate_limit`
- `outgoing_rate_limit`
- `bridge`
- `management`
- `webhook`
- `projects`

Project section should include:

- agent runtime type
- provider chains
- platform adapters
- ACL controls
- session and heartbeat policy

---

## 7. Release Checklist (Gateway + Runtime)

- Contract compatibility tests pass.
- Session crash-recovery replay passes.
- Provider failover simulation passes.
- Tool policy deny/allow tests pass.
- P95 latency and queue-depth within SLO under 100 concurrent synthetic sessions.
