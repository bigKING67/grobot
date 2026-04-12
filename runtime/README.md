# Runtime Skeleton

Rust runtime skeleton for Grobot.

## Responsibilities (MVP)

1. One mailbox per `SessionKey`.
2. One active turn per session.
3. Parallel execution across sessions with bounded worker pool.
4. Emit normalized runtime events for gateway streaming.
5. Serve `runtime.v1` JSON-RPC methods over stdio.

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
