# js-reverse MCP Instruction Pack

Scope: `[[servers]].name = "js-reverse"`

## Routing

Use this MCP server only for browser reverse-engineering tasks, not ordinary browsing.

Trigger examples:

- signing parameters: `sign`, `_signature`, `token`, `nonce`, `h5st`, `x-bogus`, `msToken`
- request initiator tracing
- script search and deobfuscation
- Hook-based runtime sampling
- local Node rebuild / environment patching
- VMP instrumentation

For normal browser reading and actions, use core tools first:

- `web_scan`
- `web_execute_js`

For login-sensitive reverse work, start with the core TMWD-backed tools above. They operate on the user's real browser and keep the existing login/session context. Do not assume a JSReverser / remote-debugging CDP browser has the user's tabs or cookies.

## Workflow

1. Start with `check_browser_health`.
2. If the target depends on login state, first collect page/request context from the user's real browser via `web_scan` / `web_execute_js`, then decide whether a separate remote-debugging CDP/debug browser is acceptable.
3. Observe before acting:
   - `list_network_requests`
   - `get_request_initiator`
   - `list_scripts`
   - `search_in_scripts`
4. Prefer Hook over breakpoints:
   - `create_hook`
   - `inject_hook`
   - `get_hook_data` with `view=summary` first
5. Record evidence before rebuilding:
   - `record_reverse_evidence`
6. Export local rebuild only after runtime evidence is captured:
   - `export_rebuild_bundle`

## Guardrails

1. Do not guess signing logic without runtime evidence.
2. Do not patch browser environment without env logs and a first divergence point.
3. Patch one minimum causal unit at a time.
4. If six patches do not converge, return to browser observation.
5. Treat server-side verification as the final correctness gate.

## Output Contract

Reverse tasks should report:

- target API and signature fields
- script/function path
- hook evidence and request correlation
- input/output samples
- patch log and rollback points
- local rebuild status
- confidence and remaining uncertainty
