# Telegram Adapter Skeleton

## Inbound Responsibilities

1. Verify bot token and update source.
2. Normalize inbound event to gateway `TurnRequest`.
3. Build canonical `SessionKey`:
   - format: `<platform>:<tenant>:<scope>:<subject>`
   - platform fixed to `telegram`

## Outbound Responsibilities

1. Support group mention mode and direct-message mode.
2. Stream chunk updates when channel API allows.
3. Respect per-platform outbound rate limits.
