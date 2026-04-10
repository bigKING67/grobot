# Feishu Adapter Skeleton

## Inbound Responsibilities

1. Verify webhook signature.
2. Normalize inbound event to gateway `TurnRequest`.
3. Build canonical `SessionKey`:
   - format: `<platform>:<tenant>:<scope>:<subject>`
   - platform fixed to `feishu`

## Outbound Responsibilities

1. Stream intermediate chunks to thread preview.
2. Send final message with trace link metadata.
3. Respect per-platform outbound rate limits.
