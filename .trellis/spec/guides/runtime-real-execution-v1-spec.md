# Runtime Real Execution v1 Spec

> Scope: Rust runtime `runtime.turn.execute` real-model execution (OpenAI-compatible), no tool-calling in v1.

---

## 1. Goal and Non-Goals

### 1.1 Goal

- Replace placeholder echo execution with real model invocation in Rust runtime.
- Keep `runtime.v1` response shape compatible with existing TypeScript gateway parser.
- On runtime model failure, fail explicitly and emit `turn_failed` in error data.

### 1.2 Non-Goals (v1)

- No runtime tool orchestration (`tool_start`/`tool_end` still reserved, not exercised here).
- No provider config pass-through from gateway request.
- No protocol version bump to `runtime.v2`.

---

## 2. Config and Inputs

### 2.1 Runtime Env Source (v1)

- `GROBOT_BASE_URL` (required)
- `GROBOT_API_KEY` (required)
- `GROBOT_MODEL` (required)
- `GROBOT_RUNTIME_HTTP_TIMEOUT_MS` (optional, default `15000`, clamp `[1000,120000]`)

### 2.2 Request Contract (unchanged)

Method: `runtime.turn.execute`

Required params:

- `request_id`
- `session_key`
- `user_message`

Optional params:

- `context_lines` (array of strings)

---

## 3. Execution and Event Contract

### 3.1 Success Path

Event order:

1. `turn_start`
2. `model_request`
3. `model_response`
4. `turn_end` (`status=ok`)

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

---

## 4. Gateway Compatibility Rules

- `gateway/src/tools/runtime/stdio-client.ts` must keep JSON-RPC parsing compatible.
- On RPC error, gateway should surface `error_class` and `trace_id` in thrown error message.
- No change to `RuntimeTurnResult` public shape in TypeScript types.

---

## 5. Validation Checklist

1. `cargo check --manifest-path runtime/Cargo.toml`
2. `cargo test --manifest-path runtime/Cargo.toml`
3. `npm run check:gateway`
4. `npm run check`

Acceptance:

- `npm run check` passes in a default local environment without real provider credentials.
- Rust runtime unit tests cover both success-event ordering and failure-event ordering at orchestrator level.
- Node gateway checks include a local mock model server path proving `failover-runs-ts-rust` can return real-model content.
