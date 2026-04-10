# Runtime Events Contract (v1)

Required event types:

1. `turn_start`
2. `model_request`
3. `model_response`
4. `tool_start`
5. `tool_end`
6. `turn_stream_chunk`
7. `turn_end`
8. `turn_failed`
9. `session_resume`

Common envelope:

```json
{
  "trace_id": "trace_xxx",
  "turn_id": "turn_xxx",
  "session_key": "feishu:acme:dm:ou_xxx",
  "event_type": "tool_end",
  "payload": {},
  "timestamp_iso": "2026-04-09T08:00:00Z"
}
```
