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
  - `browser_environment_ask_user_threshold`
- `runtime_tool_recovery_timeline[*].browser_environment_recovery`
  - `error_code`
  - `action`
  - `retry_allowed`
  - `commands`
- `runtime_tool_recovery_health.attention_browser_environment_recovery`
- `runtime_tool_recovery_readiness.attention_browser_environment_recovery`
- `runtime_tool_recovery_gate.attention_browser_environment_recovery`
- `cache_stats_location` (canonical pointer, currently `runtime_health.cache_stats`)

Browser facade recovery must treat repeated environment failures as operator-action signals. For
`browser_backend_result_error` with `error_code` in `NO_EXTENSION`, `NO_SESSION`, or
`TRANSPORT_UNAVAILABLE`, the second same-tool recovery escalates to `ask_user` with
`recommended_next_action=request_environment_fix`. Retryable browser execution failures such as
`TIMEOUT` keep the generic repeated-error thresholds. The recovery prompt must include the
browser-specific execution block: do not retry the failing browser tool automatically; request the
relevant setup/hub/doctor action (`grobot browser setup`, `grobot browser hub start`,
`grobot browser doctor`) and retry only after the browser environment is ready.

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
