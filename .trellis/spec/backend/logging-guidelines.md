# Logging Guidelines

> Observability and log-safety rules for backend/runtime flows.

---

## Overview

Logging in this repo has three forms:

1. Human-readable CLI stderr/stdout diagnostics in gateway workflows.
2. Structured runtime event stream (`RuntimeEvent`) for turn-level tracing.
3. Task/workflow logs in `.trellis/tasks/*/*.jsonl` and Trellis script output.

---

## Level Semantics

1. INFO: lifecycle transitions, selected route/provider, session context.
2. WARN: degraded mode or fallback (for example redis fallback to file).
3. ERROR: operation failed and requires retry or operator action.
4. SUCCESS/OK-style messages: explicit completion checkpoints for workflows.

---

## Logging Patterns

1. Prefer one event per line and stable prefixes for grep (`[ask-user]`, `[runtime-route]`).
2. Include identifiers (`session_key`, `question_id`, `trace_id`, `blocking_node_id`) when available.
3. Keep stdout for user-facing flow; use stderr for diagnostics and route details.
4. Runtime events should preserve canonical event type names (`turn_start`, `tool_end`, `turn_failed`).

---

## Redaction and Sensitive Data

1. Never print raw API keys, bearer tokens, cookies, or passwords.
2. Use masking/redaction helpers for config/status surfaces.
3. Truncate oversized payloads before emitting diagnostics.
4. Redaction is mandatory for management config snapshots and file previews.

---

## What NOT to Log

1. Full unredacted credentials from config/env.
2. Raw provider request bodies containing secrets.
3. Verbose duplicated payload dumps that hide actionable signal.
4. Stack traces without request/session context.

---

## Examples

1. `gateway/src/cli/start/turn.ts` (runtime-route diagnostics)
2. `gateway/src/tools/ask-user/runtime.ts` (ask-user issued/resolved events)
3. `gateway/src/cli/services/redaction.ts` (secret masking/redaction)
4. `runtime/src/orchestration/pipeline.rs` (normalized runtime event emission)
5. `.trellis/tasks/00-bootstrap-guidelines/*.jsonl` (workflow activity journaling)
