# Runtime Real Execution v1 Spec

> Scope: Rust runtime `runtime.turn.execute` real-model execution (OpenAI-compatible), with v1.2 provider pass-through, prompt-cache hints, runtime cache telemetry, and explicit tool-call fail-fast.

---

## 1. Goal and Non-Goals

### 1.1 Goal

- Replace placeholder echo execution with real model invocation in Rust runtime.
- Keep `runtime.v1` response shape compatible with existing TypeScript gateway parser.
- On runtime model failure, fail explicitly and emit `turn_failed` in error data.

### 1.2 Non-Goals (v1)

- No runtime tool orchestration (`tool_start`/`tool_end` still reserved, not exercised here).
- No protocol version bump to `runtime.v2`.

---

## 2. Config and Inputs

### 2.1 Runtime Env Source (fallback)

- `GROBOT_BASE_URL` (required if request has no `model_config.base_url`)
- `GROBOT_API_KEY` (required if request has no `model_config.api_key`)
- `GROBOT_MODEL` (required if request has no `model_config.model`)
- `GROBOT_RUNTIME_HTTP_TIMEOUT_MS` (optional, default `15000`, clamp `[1000,120000]`)

### 2.2 Request Contract (runtime.v1 compatible, extended optional fields)

Method: `runtime.turn.execute`

Required params:

- `request_id`
- `session_key`
- `user_message`

Optional params:

- `context_lines` (array of strings)
- `model_config` (object, all fields optional):
  - `base_url`
  - `api_key`
  - `model`
  - `timeout_ms`
  - `provider_kind`
  - `provider_options.kimi`:
    - `web_search_mode`
    - `disable_thinking_on_builtin_web_search`
    - `official_tools_allowlist`
    - `official_tool_formulas`
    - `prompt_cache.enabled`
    - `prompt_cache.strategy` (`user_last_n`)
    - `prompt_cache.user_last_n` (`1..12`, default `2`)

Resolution priority per field:

1. `model_config.<field>`
2. corresponding env (`GROBOT_*`)

---

## 3. Execution and Event Contract

### 3.1 Success Path

Event order:

1. `turn_start`
2. `model_request`
3. `model_response`
4. `turn_end` (`status=ok`)

When `provider_options.kimi.prompt_cache.enabled=true`, runtime may emit extra telemetry events:

- `prompt_cache_hint_applied`
- `prompt_cache_usage_observed`

`prompt_cache_hint_applied` reports whether hint injection is supported/applied for current provider payload.
`prompt_cache_usage_observed` reports cache usage signals observed from upstream `usage` payload.

Response keeps existing fields:

- `protocol_version`
- `trace_id`
- `request_id`
- `session_key`
- `assistant_message`
- `events`

### 3.2 Failure Path

Event order:

1. `turn_start`
2. `model_request`
3. `turn_failed`
4. `turn_end` (`status=failed`)

For `tool_call_not_supported` specifically, runtime emits additional diagnostic events before `turn_failed`:

1. `tool_start`
2. `tool_end` (`status=failed`)

RPC error:

- code: `-32001`
- message: `runtime turn execution failed`
- error data includes:
  - `protocol_version`
  - `trace_id`
  - `request_id`
  - `session_key`
  - `error_class`
  - `error_message`
  - `events` (contains `turn_failed`)

### 3.3 Error Class Set (v1)

- `config_missing`
- `config_invalid`
- `client_init_failed`
- `upstream_timeout`
- `upstream_connect_failed`
- `upstream_request_failed`
- `upstream_http_error`
- `upstream_response_read_failed`
- `upstream_invalid_json`
- `upstream_invalid_response`
- `tool_call_not_supported` (model returned `tool_calls`; runtime v1.1 fail-fast)

---

## 4. Gateway Compatibility Rules

- `gateway/src/tools/runtime/stdio-client.ts` must keep JSON-RPC parsing compatible.
- `gateway/src/tools/runtime/stdio-client.ts` must forward optional `model_config` (including `provider_options.kimi.prompt_cache`) without changing protocol version.
- On RPC error, gateway should surface `error_class` and `trace_id` in thrown error message.
- No change to `RuntimeTurnResult` public shape in TypeScript types.
- `runtime.health` should expose `cache_stats.model_catalog` and `cache_stats.prompt_cache`.
- `grobot status --json` should expose:
  - `route_decision`
  - `runtime_health.cache_stats`
  - top-level `cache_stats` (mirrors runtime cache snapshot)

---

## 5. Validation Checklist

1. `cargo check --manifest-path runtime/Cargo.toml`
2. `cargo test --manifest-path runtime/Cargo.toml`
3. `npm run check:gateway`
4. `npm run check`

Acceptance:

- `npm run check` passes in a default local environment without real provider credentials.
- Rust runtime unit tests cover both success-event ordering and failure-event ordering at orchestrator level.
- Rust runtime unit tests cover request-level provider pass-through, prompt-cache hint/usage telemetry, and `tool_call_not_supported` fail-fast.
- Node gateway checks include:
  - local mock model server proving `failover-runs-ts-rust` real-model content path,
  - provider config (`config.toml`) pass-through path,
  - status contract path (`route_decision` + `cache_stats` presence/type),
  - explicit upstream failure mapping path (`upstream_connect_failed`),
  - tool-call fail-fast path (`tool_call_not_supported`).
