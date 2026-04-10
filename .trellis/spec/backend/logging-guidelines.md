# Logging Guidelines

> Logging patterns used in current Trellis workflow scripts.

---

## Overview

Current logging is split by layer:

1. Workflow CLI (`.trellis/scripts/*`): console-first, human-readable.
2. Multi-agent tooling: tagged console logs (`[INFO]/[WARN]/[ERROR]/[SUCCESS]`).
3. Runtime/gateway contract: normalized event envelope in shared contracts (stream-oriented observability).

This is acceptable for bootstrap. Structured centralized logging will be added
when long-running runtime services are implemented.

---

## Log Levels

Use these semantics:

1. `INFO`: phase transitions, routing decisions, key identifiers.
2. `WARN`: recoverable degradation or partial issues.
3. `ERROR`: failed operation requiring abort/retry/human action.
4. `SUCCESS`: explicit milestone completion for operator confidence.

---

## Structured Logging

Current format is lightweight and grep-friendly:

1. Prefix tags (`[INFO]`, `[WARN]`, `[ERROR]`) for CLI flows.
2. Keep one event per line where possible.
3. Include identifiers (task dir, branch, worktree, PID, trace/turn/session ids).
4. Runtime event payloads must follow shared envelope definitions.

---

## What to Log

1. Start/end of pipeline phases.
2. Validation failures and missing prerequisites.
3. Runtime coordinates: worktree path, PID, trace id, session key, turn id.
4. Tool lifecycle events (`tool_start`, `tool_end`) when runtime event stream is available.

---

## What NOT to Log

1. Secrets, tokens, credentials, private keys.
2. Sensitive environment variable values.
3. Full unredacted user content when not required for debugging.
4. Oversized raw payload dumps when concise summaries are sufficient.

---

## Examples

1. `.trellis/scripts/multi_agent/start.py`: tagged phase logs and operator guidance.
2. `.trellis/scripts/multi_agent/cleanup.py`: explicit warning/error channels before cleanup actions.
3. `.trellis/scripts/common/developer.py`: stderr error logs for bootstrap failures.
4. `shared/contracts/runtime-events.md`: normalized runtime event envelope for observability.
