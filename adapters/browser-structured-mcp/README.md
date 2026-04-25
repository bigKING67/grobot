# browser-structured-mcp (GA-aligned)

This adapter is the MCP-first entry for structured browser extraction.
Current design follows GA browser strategy:
- TMWD user-browser control as the default product path
- explicit remote-debugging CDP as a diagnostic / CI / reverse-engineering path
- GA-like `web_scan` / `web_execute_js` response shapes
- bridge command protocol (`cmd=tabs|cookies|cdp|batch`)

The runtime-facing core tools (`web_scan` / `web_execute_js`) default to
`tmwd_mode="tmwd"`, so ordinary Agent browser work uses the user's already-open
Chrome/Edge window, tabs, cookies, and login state. The direct MCP backend keeps
`tmwd_mode="auto"` for diagnostics and low-level contract tests.

## Tools

- `browser_scan`: GA-style scan with tabs + content (`tabs_only`, `text_only`, `main_only`, `switch_tab_id`).
- `browser_execute_js`: GA-style JS execution over TMWD bridge commands or explicit remote-debugging CDP.
- `browser_extract`: structured extraction from HTML or active page.
- `browser_diff`: compare snapshots and return signatures.
- `browser_tab_ops`: list/switch/current + TMWebDriver-like session ops.
- `browser_native_input`: cross-platform native input fallback (Win/mac/Linux).

### browser_execute_js arguments (GA-style)

- `script`: JS body, or GA bridge command object string
- `tab_id` / `switch_tab_id`: target tab selection
- `session_id`: TMWebDriver-like session selection (session id == current target id)
- `session_url_pattern`: resolve target by URL/title pattern before execute
- `tmwd_mode`: `auto` (direct MCP default) | `tmwd` | `remote_cdp` | `cdp` (legacy alias)
- `tmwd_transport`: `auto` (default) | `ws` | `link`
- `tmwd_ws_endpoint`: TMWebDriver WS endpoint, default `ws://127.0.0.1:18765`
- `tmwd_link_endpoint`: TMWebDriver link API, default `http://127.0.0.1:18766/link`
- `no_monitor`: skip transient/diff monitor
- `native_auto_fallback`: when execution fails with native-required signal, run native fallback planner
- `native_auto_fallback_policy`: `strict | balanced | aggressive` (default `balanced`)
- `native_auto_execute`: only works with `native_auto_fallback=true`; if false, fallback stops at dry-run
- `native_execute_action_scope`: `non_pointer` (default) or `all`; pointer auto-execute requires `all`
- `native_fallback_action`: override fallback action (`click` by default from hint)
- `native_fallback_args`: action arguments passed to native fallback tool
- `native_fallback_timeout_ms`: timeout for fallback execution/dry-run
- `timeout_ms`: command timeout
- `cdp_endpoint`: remote-debugging CDP HTTP endpoint, default `http://127.0.0.1:9222`
- `target_url_contains`: optional target selector hint for remote-debugging CDP target picking

### browser_scan arguments (key)

- `tabs_only`: only return tab/session metadata
- `text_only`: return readable text instead of HTML
- `main_only`: prefer extracting main/article-like content region
- `main_only_fallback_to_full`: when `main_only=true` and coverage is too low, auto-fallback to full text (default `true`)
- `main_only_min_chars`: guardrail threshold for minimum main text length (default `600`)
- `main_only_min_coverage`: guardrail threshold for `main_text_len/full_text_len` (default `0.35`)

`main_only` is opt-in and does not affect default full-page behavior.
When guardrail triggers, response metadata includes `main_only_guardrail` for observability.

Bridge command examples:

```js
{"cmd":"tabs"}
{"cmd":"tabs","method":"switch","tabId":"<target-id>"}
{"cmd":"tabs","method":"set_session","url_pattern":"example.com/dashboard"}
{"cmd":"cookies","url":"https://example.com"}
{"cmd":"cdp","method":"Runtime.evaluate","params":{"expression":"document.title"}}
{"cmd":"batch","commands":[{"cmd":"tabs"},{"cmd":"cdp","method":"Runtime.evaluate","params":{"expression":"document.URL"}}]}
```

In bridge-command examples, `cmd:"cdp"` means "send this DevTools command through
the selected browser route". It does not by itself switch the session to an
external remote-debugging Chrome. Use `tmwd_mode="remote_cdp"` only when you
intentionally want the external debug endpoint path.

`batch` supports GA-style `$N.path` references and now keeps partial results on failure (`{ ok:false, error, results:[...] }`), which is useful for chained DOM/DevTools pipelines.

`browser_tab_ops` supports TMWebDriver-like session operations:

```js
{"op":"list_sessions"}
{"op":"find_session","url_pattern":"example.com"}
{"op":"set_session","url_pattern":"example.com/dashboard"}
{"op":"current_session"}
```

### browser_native_input arguments

- `action` (required):  
  `activate_window | move | click | double_click | press | type | paste | scroll | get_window_rect | capabilities`
- `x`, `y`: pointer coordinates for `move/click/double_click`
- `button`: `left | middle | right` for click actions
- `key`: key chord for `press` (e.g. `ctrl+v`, `cmd+shift+p`)
- `text`: text payload for `type`/`paste`
- `delay_ms`: typing delay (linux `xdotool type` path)
- `delta_x`, `delta_y`: scroll deltas
- `window_title`, `window_pid`: window selection hint for `activate_window/get_window_rect`
- `dry_run`: validate + plan only, no native event injection
- `timeout_ms`: native action timeout (`500..30000`)

`action="capabilities"` is side-effect free and returns per-platform support:
- `supported_actions`
- `unsupported_actions`
- `checks` (dependency/environment probes)
- `requirements` (what to install/configure)

`dry_run=true` (non-`capabilities`) returns:
- `validated_args`
- `driver_plan`
- `capabilities_summary`
- `next_step` (`safe_to_execute` or `requirements_missing`)

Typical usage boundary:
- Main chain still prefers `browser_execute_js` / `browser_scan` over native input.
- For user-login tasks, prefer the TMWD route; use remote-debugging CDP only when explicit.
- Use `browser_native_input` only when browser-side automation is blocked  
  (e.g. `isTrusted` restrictions, native file chooser, popup/focus constraints).

Structured native-input error codes:
- `PLATFORM_PERMISSION_REQUIRED`
- `DISPLAY_BACKEND_UNSUPPORTED`
- `WINDOW_NOT_FOUND`
- `COORDINATE_OUT_OF_RANGE`
- `ACTION_NOT_SUPPORTED`
- `NATIVE_INPUT_EXECUTION_FAILED`

`browser_execute_js` now also emits native escalation signals on failure:
- `native_input_suggested` (boolean)
- `native_input_hint` (present when escalation is recommended)
- `native_input_capabilities` (present when escalation is recommended and probe succeeds)
- `native_auto_fallback` (present only when `native_auto_fallback=true`, includes dry-run/execute status)
  - includes normalized `policy` (`strict | balanced | aggressive`)
  - includes `suggestion` (`should_escalate`, `reason`, `policy`) for deterministic policy debugging

Behavior note:
- With `native_auto_fallback=true`, pre-execution context failures (`NO_EXTENSION` / `NO_SESSION` / `TRANSPORT_UNAVAILABLE`) are returned as structured payload with fallback planning details, instead of immediate MCP `isError=true`.
- `native_auto_fallback_policy` controls escalation boundary:
  - `strict`: only escalate when signal is high-confidence (`CSP_BLOCKED` / `CDP_DENIED` / trusted-event/native-dialog hints)
  - `balanced` (default): plus transport/session preflight failures
  - `aggressive`: plus timeout/general execution failures
- when policy suppresses escalation (e.g. `strict` + `NO_EXTENSION`), fallback returns
  `status="skipped"` with `reason="no_escalation_signal"`.
- `native_auto_fallback_policy` is applied only when `native_auto_fallback=true`; otherwise normal error path stays unchanged.

Policy quick-pick:
- Choose `strict` when false-positive native escalation must be minimized.
- Choose `balanced` for default mixed workloads (recommended baseline).
- Choose `aggressive` when recovery success-rate is prioritized over conservative gating (including `TIMEOUT` and generic `EXECUTION_ERROR` failures).

Safety note for auto fallback:
- Keep `native_auto_execute=false` by default.
- If you must auto-execute pointer actions (`move/click/double_click/scroll`), set:
  - `native_auto_execute=true`
  - `native_execute_action_scope="all"`

### Native Dependency Doctor/Setup (Deployment)

To avoid manual environment drift, use the built-in dependency doctor/setup:

```bash
npm run browser:native:doctor
npm run browser:native:setup
```

Behavior by platform:

- Windows: no `cliclick` requirement; readiness requires `powershell` or `pwsh` in PATH.
- macOS: pointer actions require `cliclick`; setup auto-runs `brew install cliclick`.
- Linux: setup tries installing `xdotool` + `xclip` via available package manager.

Windows note:
- If doctor/setup reports missing PowerShell, install it (for example):
  - `winget install --id Microsoft.PowerShell -e`

JSON output (for CI/deploy hooks):

```bash
npm run browser:native:setup:json
```

## Run

```bash
node adapters/browser-structured-mcp/server.mjs
```

### Smoke Contract (initialize/tools/list/tools/call)

```bash
npm run check:browser-structured:mcp
```

The smoke contract intentionally calls `browser_execute_js` with a non-existing
TMWebDriver WS endpoint to verify structured error fields:

- `error_code`
- `retryable`
- `transport_attempts`

### Live Contract (Real Browser Session)

This path validates MCP behavior against your real browser environment
(logged-in profile/cookies/session tabs), rather than deterministic stubs:

```bash
npm run check:browser-structured:mcp:live
```

Useful options:

```bash
npm run check:browser-structured:mcp:live -- --tmwd-mode auto --tmwd-transport auto
npm run check:browser-structured:mcp:live -- --tmwd-mode tmwd --tmwd-transport link
npm run check:browser-structured:mcp:live -- --tmwd-mode remote_cdp --cdp-endpoint http://127.0.0.1:9222
npm run check:browser-structured:mcp:live -- --target-url-contains docs.trytrellis.app
npm run check:browser-structured:mcp:live -- --require-cookie
```

Live contract failure usually means runtime prerequisites are missing
(TMWD hub/extension or remote-debugging CDP endpoint), not contract regression.

Before running live contract, you can diagnose runtime readiness:

```bash
npm run check:browser-structured:mcp:live:doctor
```

For a one-command doctor->live flow, use the gate script:

```bash
npm run check:browser-structured:mcp:live:gate
```

Gate behavior:
- runs live doctor first
- when TMWebDriver ports are unreachable (`tmwd_mode=auto|tmwd`), gate auto-runs `browser:tmwd:hub:start` and retries doctor
- when TMWebDriver ports are up but no sessions yet, gate waits a short session-hydration window before final block
- blocks with structured hints only if prerequisites are still not ready after retry
- runs live contract only when doctor is `ok=true` (or when forced)
- writes gate event records to `.grobot/runtime/browser-live-gate-events.jsonl` by default

Gate options:

```bash
npm run check:browser-structured:mcp:live:gate -- --doctor-only
npm run check:browser-structured:mcp:live:gate -- --force-live
npm run check:browser-structured:mcp:live:gate -- --allow-empty-tabs
npm run check:browser-structured:mcp:live:gate -- --tmwd-mode remote_cdp --cdp-endpoint http://127.0.0.1:9222
npm run check:browser-structured:mcp:live:gate -- --no-ensure-tmwd-hub
npm run check:browser-structured:mcp:live:gate -- --ensure-tmwd-hub-wait-ms 6000
npm run check:browser-structured:mcp:live:gate -- --session-ready-wait-ms 10000
npm run check:browser-structured:mcp:live:gate -- --disable-event-log
npm run check:browser-structured:mcp:live:gate -- --event-log-path /tmp/grobot-live-gate.jsonl
```

Environment controls:
- `BROWSER_LIVE_GATE_LOG_ENABLED=0` disables gate event logging
- `BROWSER_LIVE_GATE_LOG_PATH=/abs/path/events.jsonl` overrides event log path

Mode-specific diagnose examples:

```bash
npm run check:browser-structured:mcp:live:doctor -- --tmwd-mode tmwd --tmwd-transport auto
npm run check:browser-structured:mcp:live:doctor -- --tmwd-mode remote_cdp --cdp-endpoint http://127.0.0.1:9222
npm run check:browser-structured:mcp:live:doctor -- --allow-empty-tabs
```

Doctor now checks protocol-level readiness (not only TCP):
- TMWebDriver WS `tabs` probe (tab count)
- TMWebDriver link `get_all_sessions` probe (session count)
- remote-debugging CDP `/json/version` + `/json/list` (page count)

### Run TMWebDriver Hub (inside grobot)

This repository now includes a GA-aligned TMWebDriver hub implementation:

```bash
npm run browser:tmwd:hub
```

Managed lifecycle commands (recommended for daily use):

```bash
npm run browser:tmwd:hub:start
npm run browser:tmwd:hub:status
npm run browser:tmwd:hub:stop
```

`browser:tmwd:hub:start` writes runtime state to:
- `.grobot/runtime/tmwd-hub-state.json`

When ports are occupied by non-managed processes, `browser:tmwd:hub:start`
returns `reason=port_in_use_unmanaged` with explicit hint.

Default endpoints:
- `ws://127.0.0.1:18765` (extension websocket)
- `http://127.0.0.1:18766/link` (TMWD link API)

Keep this process running while using `tmwd_mode=auto|tmwd`.

## Example MCP config

```toml
[[servers]]
name = "browser-structured"
command = "node"
args = ["adapters/browser-structured-mcp/server.mjs"]
enabled = true
```

## Notes

- No Playwright main chain is used.
- Remote-debugging CDP is optional. It is only needed for `tmwd_mode=remote_cdp`
  (or legacy `tmwd_mode=cdp`) or when direct-MCP `tmwd_mode=auto` falls back to
  the external debug endpoint.
- For default `tmwd_mode=auto` + `tmwd_transport=auto`, the main path is TMWebDriver link (`18766`) when hub + extension are alive.
- GA extension source has been vendored under `adapters/browser-structured-mcp/ga_tmwd_cdp_bridge/` for parity reference.
- Transport routing:
  - `tmwd_mode=auto`: try TMWebDriver (WS/link) first, fallback to external remote-debugging CDP
  - `tmwd_mode=tmwd`: force TMWebDriver only (no external CDP fallback)
  - `tmwd_mode=remote_cdp`: force external remote-debugging CDP only
  - `tmwd_mode=cdp`: legacy alias for `remote_cdp`; avoid in new docs/prompts
- TMWebDriver transport routing (inside `tmwd_mode=tmwd|auto`):
  - `tmwd_transport=auto`: try WS(18765) first, fallback to link(18766)
  - `tmwd_transport=ws`: force WS only
  - `tmwd_transport=link`: force link only
- TMWebDriver alignment in this adapter is based on these GA sources:
  - `GenericAgent/TMWebDriver.py`
  - `GenericAgent/assets/tmwd_cdp_bridge/background.js`
  - `GenericAgent/memory/tmwebdriver_sop.md`
  - `GenericAgent/memory/ljqCtrl_sop.md`
