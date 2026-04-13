# Runtime Skeleton

Rust runtime skeleton for Grobot.

## Architecture Positioning

Runtime follows the same `4 execution layers + 1 governance plane` split:

1. `models` (`runtime/src/models`): turn I/O structures and model-executor traits.
2. `tools` (`runtime/src/tools`): tool-executor traits and tool hooks.
3. `extensions` (`runtime/src/extensions`): protocol boundary (`runtime.v1` JSON-RPC).
4. `orchestration` (`runtime/src/orchestration`): turn pipeline orchestration (`before -> model -> after -> events`).
5. `governance` (`runtime/src/governance`): runtime bootstrap limits/policies and guardrail config.

Governance plane is for runtime quality/safety guardrails and lifecycle control, not a direct part of online token generation logic.

## Responsibilities (MVP)

1. One mailbox per `SessionKey`.
2. One active turn per session.
3. Parallel execution across sessions with bounded worker pool.
4. Emit normalized runtime events for gateway streaming.
5. Serve `runtime.v1` JSON-RPC methods over stdio.

## Current Module Layout

- `main.rs`: process bootstrap + stdio loop.
- `models/engine.rs`: shared turn input/output structs.
- `models/model.rs`: model execution trait and placeholder executor.
- `tools/tools.rs`: tool execution trait and no-op executor.
- `extensions/protocol.rs`: JSON-RPC parsing/validation and response shaping.
- `orchestration/orchestrator.rs`: turn orchestration pipeline (`before -> model -> after -> events`).
- `governance/session.rs`: runtime bootstrap config and startup banner.

## Next Steps

1. Add queue ingestion (Redis stream).
2. Add turn state machine (`Queued -> Running -> Completed/Failed/Cancelled`).
3. Add provider routing and tool-policy enforcement.
4. Replace placeholder turn implementation with tool/model execution pipeline.

## Runtime v1 RPC (current)

- `runtime.health`
  - Returns protocol/version/runtime label.
- `runtime.turn.execute`
  - Input: `request_id`, `session_key`, `user_message`, `context_lines[]`
  - Output: placeholder assistant message + normalized event list.
