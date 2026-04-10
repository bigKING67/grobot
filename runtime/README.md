# Runtime Skeleton

Rust runtime skeleton for Grobot.

## Responsibilities (MVP)

1. One mailbox per `SessionKey`.
2. One active turn per session.
3. Parallel execution across sessions with bounded worker pool.
4. Emit normalized runtime events for gateway streaming.

## Next Steps

1. Add queue ingestion (Redis stream).
2. Add turn state machine (`Queued -> Running -> Completed/Failed/Cancelled`).
3. Add provider routing and tool-policy enforcement.
