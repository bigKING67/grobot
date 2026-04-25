# browser-structured MCP Instruction Pack

Scope: `[[servers]].name = "browser-structured"`

## Routing Priority

0. For normal browser work, prefer core runtime tools first:
   - `web_scan`
   - `web_execute_js`
   The core facade defaults to `tmwd_mode="tmwd"` so "current browser / logged-in page" tasks do not silently fall back to a separate remote-debugging CDP Chrome. Direct `mcp_call(server="browser-structured", ...)` is for diagnostics, backend-specific operations, or cases not covered by the core facade.
1. Default to browser-side structured tooling first:
   - `browser_scan`
   - `browser_execute_js`
   - `browser_extract`
   - `browser_tab_ops`
2. Prefer TMWebDriver path for user-browser tasks:
   - core facade default: `tmwd_mode=tmwd`
   - direct backend diagnostic default: `tmwd_mode=auto`
   - `tmwd_transport=auto` (default)
   Use `tmwd_mode=remote_cdp` only for CI, controlled debug browsers, reverse-engineering protocol work, or explicit user request. Legacy `tmwd_mode=cdp` is accepted as a compatibility alias but should not be used in new docs/prompts.
   Preserve result context labels: `tmwd_user_browser` means the user's real browser/login state; `remote_cdp_debug_browser` means an external debug Chrome with no assumed current tabs/cookies.
3. Only escalate to `browser_native_input` when browser-side automation is blocked.
4. Before first native action in a session, call `browser_native_input` with `action="capabilities"` to validate local prerequisites.
5. Before risky native action (pointer/keyboard), call the same action with `dry_run=true` and proceed only when `next_step=safe_to_execute`.
6. If using `browser_execute_js` auto fallback, set `native_auto_fallback=true`; keep `native_auto_execute=false` by default and only enable execute after dry-run says safe.
7. For pointer auto-execution (`move/click/double_click/scroll`), require explicit `native_execute_action_scope="all"`; otherwise keep scope at default `non_pointer`.
8. When `native_auto_fallback=true`, treat transport/session preflight failures as planning opportunities (read structured fallback payload), not as immediate hard-stop.
9. Choose `native_auto_fallback_policy` intentionally:
   - `strict`: only high-confidence native-required signals.
   - `balanced` (default): includes transport/session preflight failures.
   - `aggressive`: includes timeout/general execution failures.
10. `native_auto_fallback_policy` is effective only when `native_auto_fallback=true`; if not enabled, keep standard error handling and do not assume policy-based escalation.
11. When reading fallback payloads, prefer `native_auto_fallback.suggestion` as the policy truth (`should_escalate/reason/policy`) before deciding next action.
12. Validation strategy should use two lanes:
    - Deterministic contract (`npm run check:browser-structured:mcp`) for stable CI semantics.
    - Real-browser live contract (`npm run check:browser-structured:mcp:live`) for session/cookie/runtime reality.
13. Preferred live verification entry is gate:
    - `npm run check:browser-structured:mcp:live:gate`
    - Gate runs doctor first, auto-ensures local `tmwd-hub` when TMWebDriver ports are unreachable, and only continues to live contract when runtime is ready.
14. If you need diagnose-only mode, run: `npm run check:browser-structured:mcp:live:doctor`
    or `npm run check:browser-structured:mcp:live:gate -- --doctor-only`.
15. For infrastructure-only checks (without active tabs/sessions), run doctor with `--allow-empty-tabs`.
16. If you need strict manual startup (no auto ensure), run gate with `--no-ensure-tmwd-hub`.
17. If extension reconnect is slower on your machine, increase gate session wait window with `--session-ready-wait-ms <ms>`.
18. Preferred operator lifecycle commands for hub are:
    - `npm run browser:tmwd:hub:start`
    - `npm run browser:tmwd:hub:status`
    - `npm run browser:tmwd:hub:stop`
19. Before deployment or first native fallback run, execute:
    - `npm run browser:native:doctor`
    - `npm run browser:native:setup` (auto install where supported)
20. On Windows, do not require `cliclick`; it is macOS-only for pointer actions.
21. On Windows, treat `powershell|pwsh` availability as native-input readiness baseline; if missing, install PowerShell before enabling native fallback.
22. Keep gate event logging enabled by default for traceability; disable only when explicitly needed (`--disable-event-log` or `BROWSER_LIVE_GATE_LOG_ENABLED=0`).
23. If `browser:tmwd:hub:start` reports `port_in_use_unmanaged`, treat it as conflict with non-managed process and resolve port ownership before retry.

## When `browser_native_input` Is Allowed

Use `browser_native_input` only for scenarios such as:

- `isTrusted`-gated interactions.
- OS-level file chooser / native picker.
- Browser popup/focus restrictions that JS / DevTools bridge cannot recover.
- Window activation / pointer operations that require native event injection.
- `browser_execute_js` returned `native_input_suggested=true` with a concrete hint.

Do not use native input as first choice for normal DOM or DevTools bridge actions.

## Safety Boundaries

1. Never silently fallback from browser-side tooling to native input.
2. If native input is required but permissions/environment are missing, surface explicit error and ask user.
3. Respect structured error codes from adapter:
   - `PLATFORM_PERMISSION_REQUIRED`
   - `DISPLAY_BACKEND_UNSUPPORTED`
   - `WINDOW_NOT_FOUND`
   - `COORDINATE_OUT_OF_RANGE`
   - `ACTION_NOT_SUPPORTED`
   - `NATIVE_INPUT_EXECUTION_FAILED`

## Operator Expectations

1. Explain why native input is needed before invoking it.
2. Keep native actions minimal and explicit (action + coordinates/keys).
3. After native step, switch back to browser-side verification (`browser_scan`/`browser_execute_js`).
