# Error Handling

> Error-handling conventions across gateway, runtime, and workflow tooling.

---

## Overview

Error handling follows fail-fast plus explicit fallback boundaries:

1. Input/contract violations fail immediately with actionable messages.
2. Recoverable infrastructure failures can degrade mode (for example redis -> file), but must emit warnings.
3. Runtime turn failures must produce normalized failure events (`turn_failed`, then `turn_end` with failed status).

---

## Error Categories

1. Contract/input errors:
   - invalid CLI options, malformed session/model commands, invalid tool arguments.
2. IO/state errors:
   - missing files, unreadable config, redis/runtime process failures.
3. Upstream/provider errors:
   - timeout, auth/HTTP errors, invalid JSON responses.
4. Runtime execution errors:
   - tool disabled, unsupported tool call, interrupted turn, model execution failure.

---

## Handling Patterns

1. Validate and normalize at boundaries (`parse*`, `normalize*`, `resolve*` helpers).
2. Return structured error classes where possible (runtime model/tool error classes).
3. Preserve context in error text (provider, timeout source, trace/class identifiers).
4. Only degrade on explicitly recoverable paths (store backends, config read fallback).
5. Keep user-facing stdout concise, send diagnostics to stderr.

---

## API and Runtime Failure Contracts

1. TS dev CLI command dispatch returns explicit exit codes for unsupported/invalid commands.
2. Management routes should return consistent JSON error envelopes via route helpers.
3. Rust runtime pipeline emits `turn_failed` and terminal `turn_end` events on failure.
4. Stdio runtime client converts JSON-RPC errors into typed, contextual JS errors.
5. Management API numeric controls must fail closed on invalid values instead
   of silently falling back to defaults. For example,
   `POST /api/v1/sessions/{id}/interrupt` accepts omitted `ttl_secs` as the
   documented default but returns HTTP `400` with `invalid_ttl_secs` for
   non-number, non-finite, zero, or negative values.
6. Explicit CLI/network binding controls must fail closed on invalid values.
   `grobot serve --bind` may default to `127.0.0.1:8080` only when omitted;
   malformed explicit values must print a concise `invalid_bind` stderr error
   and exit `2` before listening.
7. Explicit runtime control knobs that change routing, timeout, concurrency,
   or runtime health reset behavior must fail closed on invalid CLI/env values.
   `grobot start`, `grobot status`, and `grobot serve` must return stable
   `invalid_<option>` errors with exit code `2` for malformed positive-integer
   controls such as `runtime-http-timeout-ms`, `circuit-failures`,
   `circuit-cooldown-secs`, provider concurrency/rate/burst knobs, and
   `cache-stats-window-ms`.
8. Management API query/body controls must fail closed on malformed explicit
   values. Optional controls may use documented defaults only when omitted;
   malformed booleans, limits, cursors, TTLs, and batch controls must return
   HTTP `400` JSON envelopes with stable `invalid_<field>` style errors instead
   of silently falling back or clamping.
9. Runtime storage and management config controls must fail closed on explicit
   invalid CLI/env/project values. Backend selectors, redis fallback booleans,
   redis URLs, and management config-read policies may use defaults only when
   omitted; malformed explicit values must return stable `invalid_<field>`
   errors before `grobot start` starts a turn or `grobot serve` begins
   listening. TOML values for these controls must use strict parsing: quoted
   strings may not accept trailing tokens such as `"redis" trailing`, and
   booleans may not accept trailing tokens such as `true trailing`.
10. CLI maintenance controls must fail closed on malformed explicit values.
    `grobot gc` may use cleanup defaults only when options are omitted;
    malformed, zero/negative, or out-of-range explicit CLI/config values for
    retention/session/plan cleanup controls must exit `2` with stable
    `invalid_<field>` errors instead of silently falling back or clamping.
    Explicit empty cache path env overrides such as
    `GROBOT_TS_DEV_CLI_CACHE_ROOT` and `GROBOT_TS_DEV_CACHE_ROOT` must fail
    closed before scanning cleanup targets.
11. Start/session controls must fail closed on malformed explicit values.
    `grobot start` may default history, handoff, and rewind behavior only when
    those controls are omitted; malformed, missing-value, or out-of-range
    explicit CLI/env controls must exit `2` with stable `invalid_<field>`
    errors before session bootstrap or runtime turn execution. Explicit empty
    env values such as `GROBOT_HANDOFF_AUTO_ON_EXIT=""` count as malformed, not
    omitted.
12. Runtime tool-loop controls must fail closed consistently across start and
    status surfaces. `GROBOT_MAX_TOOL_ROUNDS`,
    `GROBOT_NO_TOOL_FALLBACK_MODE`, and `GROBOT_MAX_RECOVERY_ROUNDS` may use
    defaults only when omitted; malformed or out-of-range explicit env values
    must return stable `invalid_<field>` errors instead of silently falling
    back or clamping.
13. Experience controls must fail closed consistently across start and serve.
    `GROBOT_EXPERIENCE_PUBLISH_MODE` and `GROBOT_EXPERIENCE_RECALL_LIMIT` may
    use defaults only when omitted; malformed or out-of-range explicit env
    values must return stable `invalid_<field>` errors before session bootstrap
    or management server listen.
14. Status context graph controls must fail closed on malformed explicit
    CLI/env values. `grobot status` may default graph cache and persistent graph
    degradation thresholds only when omitted; explicit malformed,
    zero/negative, or out-of-range values for
    `context-graph-cache-window-size`,
    `context-graph-cache-degrade-hit-rate`,
    `context-graph-cache-degrade-min-entries`,
    `context-persistent-graph-degrade-*-rate`,
    `context-persistent-graph-degrade-min-entries`, and
    `context-persistent-graph-degrade-min-scanned-files` must exit `2` with
    stable `invalid_<field>` errors. Ratio controls accept only `0..1`, and
    integer controls use bounded ranges matching the status window readers.
15. Runtime model provider controls must fail closed on malformed explicit
    provider TOML values. Kimi-specific knobs (`kimi_web_search_mode`,
    `kimi_max_tokens`, `kimi_temperature`, `kimi_top_p`, Kimi boolean flags) and
    prompt-cache knobs (`prompt_cache_enabled`, `prompt_cache_strategy`,
    `prompt_cache_user_last_n`, `prompt_cache_capability`, plus `kimi_*`
    aliases) may use provider defaults only when omitted; malformed,
    unsupported, or out-of-range explicit values must exit `2` with stable
    `invalid_<field>` errors before runtime turn execution. Numeric values must
    not be silently clamped. Provider TOML parsing must be strict: quoted
    strings may not accept trailing tokens, numeric fields may not accept
    numeric prefixes such as `1024abc`, `kimi_official_tools_allowlist` must be
    a non-empty array of strings when specified, and provider routing controls
    such as `provider_kind`, `priority`, `weight`, `unit_cost`, `max_inflight`,
    `requests_per_minute`, and `burst` must reject malformed, zero, or negative
    explicit values instead of being ignored or normalized away.
16. Context-engine config controls must fail closed on malformed explicit
    env/project TOML values. `GROBOT_CONTEXT_ENGINE_*` env values and
    `[context_engine]` project TOML knobs may use defaults only when omitted;
    malformed booleans, unsupported profiles/stages, non-numeric or
    non-integer numeric controls, zero/negative values, out-of-range
    ratios/limits, invalid threshold ordering, and effective context windows
    below the minimum must exit `2` with stable `invalid_<field>` errors before
    start/status continues. Explicit auto-compact limits must not exceed the
    derived effective window. Numeric values must not be silently clamped.
17. Experience scheduler controls must fail closed on malformed explicit
    env/project TOML values. `GROBOT_EXPERIENCE_SCHEDULER_*` env values and
    `[experience.scheduler]` project TOML knobs may use defaults only when
    omitted; malformed booleans, non-integer intervals, zero/negative or
    out-of-range intervals/delay windows, and empty explicit task/done/log
    paths must exit `2` with stable `invalid_<field>` errors before scheduler
    bootstrap. Scheduler intervals must be `10000..86400000` ms, interval
    seconds must be `10..86400`, and default task delay must be `1..24` hours.
    Numeric values must not be silently clamped.
18. MCP instruction controls must fail closed on malformed explicit project
    TOML values. `[mcp.instructions]` booleans (`enabled`, `strict`) and
    `scope` may use defaults only when omitted; malformed booleans, invalid
    scope values, or malformed quoted scope strings must exit `2` with stable
    `invalid_mcp_instructions_*` errors before prompt/runtime bootstrap.
    Enabled MCP registry entries in `.grobot/mcp.toml` or
    `${home}/mcp/servers.toml` must also fail closed for malformed explicit
    `name` or `enabled` fields, returning stable `invalid_mcp_server_*` errors
    instead of silently keeping previous/default values.
19. Status-line controls must fail closed on malformed explicit project TOML
    values. `[statusline]` and `[statusline.segments]` may use defaults only
    when omitted; malformed booleans, unsupported layout/theme values, empty
    separators, malformed/unknown/duplicate `segment_order` entries, invalid
    segment booleans or segment keys, out-of-range warning/critical
    thresholds, invalid threshold ordering, and out-of-range cache/width
    integers must exit `2` with stable `invalid_statusline_*` errors before
    prompt/runtime bootstrap. Ratio controls accept only `0..1`, percent
    controls accept only `0..100`, cache TTLs must be `250..120000` ms, and
    session topic max width must be `8..160`. Numeric values must not be
    silently clamped.
20. Search routing and runtime tool allowlist controls must fail closed on
    malformed explicit project TOML values. `[search.routing] kimi` and
    `kimi_route` may use the default routing policy only when omitted; invalid
    or malformed explicit values must exit `2` with stable
    `invalid_search_routing_kimi` errors before prompt/runtime bootstrap.
    `[tools] allow` must be a non-empty array of non-empty strings when
    specified; malformed arrays, empty arrays, empty entries, or duplicate
    entries must exit `2` with stable `invalid_runtime_tools_allow` errors
    instead of silently clearing or partially applying the allowlist.
21. CLI project identity controls must fail closed on malformed explicit
    values. `grobot start`, `grobot status`, and `grobot serve` may derive the
    project name from the work directory only when `--project` is omitted;
    explicit empty or missing `--project` values must exit `2` with stable
    `invalid_project` errors instead of falling back to the directory basename.
22. CLI path controls must fail closed on malformed explicit values.
    `--project-root`, `--work-dir`, `--project-toml` / `--project-path`,
    `--config` / `--config-path`, and `--home` / `--home-dir` may use implicit
    discovery only when omitted; explicit empty or missing values must exit
    `2` with stable `invalid_<field>` errors instead of silently falling back
    to the current directory, project root, or home default.
23. CLI runtime/provider string controls must fail closed on malformed explicit
    values. `--provider`, `--model`, `--base-url`, `--api-key`, and
    `--management-token` may fall back to env/config only when omitted;
    explicit empty or missing values must exit `2` with stable
    `invalid_<field>` errors instead of silently using a lower-priority source.
24. CLI execution-plane implementation selectors must fail closed on malformed
    explicit values. `--gateway-impl` and `--runtime-impl` may use project
    execution defaults only when omitted; explicit empty, missing, or
    unsupported values must exit `2` under the TS+Rust hard-cut error umbrella
    instead of falling back to `ts` / `rust`.
25. Start runtime maintenance env controls must fail closed on malformed
    explicit values. `GROBOT_MEMORY_MAINTENANCE_ENABLED`,
    `GROBOT_MEMORY_MAINTENANCE_INTERVAL_MS`, and
    `GROBOT_CONTEXT_GRAPH_CACHE_WINDOW_SIZE` may use defaults only when
    omitted; invalid booleans, non-integer values, or out-of-range integers
    must exit `2` with stable `invalid_<field>` errors before memory
    maintenance or runtime turn execution starts. `GROBOT_MEMORY_STRATEGY_PROFILE`
    may use session heuristics only when omitted; explicit empty,
    whitespace-only, or unsupported profile values must exit `2` with stable
    `invalid_memory_strategy_profile` before bootstrap memory maintenance,
    timers, or runtime turn execution start.
26. Ask-user pending TTL controls must fail closed on malformed explicit env
    values. `GROBOT_ASK_USER_PENDING_TTL_MINUTES` may use the default only
    when omitted or empty; malformed, zero, or out-of-range explicit values
    must exit `2` with stable `invalid_ask_user_pending_ttl_minutes` before
    GA mechanism runtime bootstrap, pending ask expiry, or runtime turn
    execution starts.
27. Plan artifact maintenance env controls must fail closed on malformed
    explicit values. `GROBOT_PLAN_EVENTS_MAX_BYTES`,
    `GROBOT_PLAN_EVENTS_ROTATE_KEEP`, and `GROBOT_PLAN_APPLY_STALE_MS` may use
    defaults only when omitted or empty; malformed, zero, or out-of-range
    explicit values must exit `2` with stable `invalid_<field>` errors before
    plan artifact event rotation, stale apply recovery, or runtime turn
    execution starts. Plan quality guard mode is stricter:
    `GROBOT_PLAN_QUALITY_GUARD_MODE` may use policy defaults only when omitted;
    explicit empty, whitespace-only, or unsupported values must exit `2` with
    stable `invalid_plan_quality_guard_mode` before plan status/apply,
    benchmark, bridge, or runtime turn execution starts.
28. Runtime/provider string env controls must fail closed on explicit empty
    values. `GROBOT_MODEL`, `GROBOT_BASE_URL`, `GROBOT_API_KEY`,
    `GROBOT_PROVIDER`, and `GROBOT_MANAGEMENT_TOKEN` may use lower-priority
    config/defaults only when omitted; if present but empty they must exit `2`
    with stable `invalid_<field>` errors instead of silently falling through to
    config TOML or unauthenticated management defaults.
29. Rust runtime model required string controls must fail closed on explicit
    empty values. `model_config.base_url`, `model_config.api_key`,
    `model_config.model`, and the matching runtime env vars may use the next
    configured source only when omitted; if present but empty they must return
    structured `config_invalid` model errors instead of falling through to
    lower-priority env/input sources. Missing required env remains
    `config_missing`.
30. Management token TOML controls must fail closed on explicit malformed
    values. `[management] token` may be omitted to leave management auth
    unconfigured, but explicit empty strings or malformed quoted strings such
    as `"secret" trailing` must exit `2` with `invalid_management_token`
    instead of silently falling back to unauthenticated management defaults.
31. Runtime semantic bridge env controls must fail closed on explicit empty
    values. `GROBOT_CONTEXTWEAVER_BRIDGE_SCRIPT` may use bridge discovery only
    when omitted, and `GROBOT_NODE_BIN` may default to `node` only when
    omitted; explicit empty or non-unicode values must return structured
    `invalid_tool_arguments` errors instead of silently falling back.
32. Rust runtime provider option strings must fail closed on explicit empty
    values. `model_config.provider_kind`,
    `provider_options.kimi.web_search_mode`,
    `provider_options.kimi.prompt_cache.strategy`,
    `provider_options.kimi.prompt_cache.capability`, and Kimi official-tool
    connection strings may use defaults only when omitted; explicit empty
    values must return structured `config_invalid` errors instead of deriving
    provider kind, choosing Kimi defaults, or reporting empty required
    connection strings as merely missing.
33. Gateway experience runtime controls must fail closed on explicit empty
    values across start and serve. `--team`, `GROBOT_TEAM`,
    `GROBOT_EXPERIENCE_POOL_PATH`, `GROBOT_EXPERIENCE_PUBLISH_MODE`, and
    `GROBOT_EXPERIENCE_RECALL_LIMIT` may use defaults or derived paths only
    when omitted; explicit empty or whitespace-only values must exit `2` with
    stable `invalid_<field>` errors before session bootstrap or management
    server listen.
34. Runtime tool-surface routing controls must fail closed on explicit
    malformed env values. `GROBOT_TOOL_SURFACE_PROFILE` may use intent-based
    routing only when omitted; explicit empty, whitespace-only, or unsupported
    values must exit `2` with `invalid_tool_surface_profile` before start turn
    execution or status rendering. Rust runtime `tool_context.tool_surface_profile`
    direct inputs follow the same fail-closed boundary: omitted values may use
    `coding`, but explicit empty, whitespace-only, or unsupported profiles must
    return structured `tool_context_invalid` errors instead of silently falling
    back to `coding`. Explicit runtime `tool_context.enabled_tools` and
    `tool_context.model_visible_tools` lists may be empty to hide/disable all
    tools, but their entries must be known, non-empty, and unique after
    normalization; malformed entries must return structured
    `tool_context_invalid` errors before dispatch. Explicit runtime
    `tool_context.bash_allowlist` lists may be empty to require permission
    checks for every command, but their entries must be non-empty and unique
    after trimming; malformed entries must return structured
    `tool_context_invalid` errors before bash policy evaluation.
35. Runtime binary path controls must fail closed on explicit empty values.
    `GROBOT_RUNTIME_BIN`, direct stdio runtime binary overrides, and
    `GROBOT_TS_DEV_REPO_ROOT` may use the derived repository runtime path only
    when omitted; explicit empty or whitespace-only binary path values must
    exit `2` with `invalid_runtime_bin`, and explicit empty or whitespace-only
    repo-root values must exit `2` with `invalid_ts_dev_repo_root`, before
    runtime health checks, status rendering, or Rust turn execution.
36. Gateway path env overrides must fail closed on explicit empty values.
    `GROBOT_CONFIG`, `GROBOT_HOME`, and repo-root discovery via
    `GROBOT_TS_DEV_REPO_ROOT` may use discovered config paths, default home
    directory, or work/project directory discovery only when omitted; explicit
    empty or whitespace-only values must return stable `invalid_config`,
    `invalid_home`, or `invalid_ts_dev_repo_root` path input errors instead of
    silently falling back.
37. Rust runtime numeric env controls must fail closed on explicit empty
    values. `GROBOT_RUNTIME_HTTP_TIMEOUT_MS` and
    `GROBOT_MODEL_AUTO_CACHE_TTL_SECS` may use runtime defaults only when
    omitted; explicit empty or whitespace-only values must return structured
    `config_invalid` model errors with env-key diagnostics instead of silently
    applying defaults.
38. Runtime protocol event stream controls must fail closed on malformed
    explicit values. `runtime.turn.execute` may omit `event_stream` to disable
    streaming and may use `stderr_jsonl` / `stderr-jsonl` to enable stderr JSONL
    runtime events, but explicit `null`, non-string, empty, whitespace-only, or
    unsupported values must return JSON-RPC `-32602` with structured
    `invalid_event_stream` data before runtime turn execution starts.
39. Rust orchestration direct turn inputs must enforce the same required-field
    boundary as the JSON-RPC handler. Direct `TurnExecuteInput` callers must not
    bypass empty `request_id`, `session_key`, or `user_message` checks; empty or
    whitespace-only values must return structured `turn_input_invalid` failures
    with terminal `turn_failed` and `turn_end` events before model execution.
    Non-empty `request_id` and `session_key` values should be trimmed at the
    orchestration boundary so trace IDs, event IDs, and session-scoped runtime
    state use a single canonical identity.
40. Runtime turn object controls must fail closed on malformed explicit JSON-RPC
    shapes. `runtime.turn.execute` may omit `model_config`, `tool_context`,
    provider option objects, and prompt-cache objects to use the documented
    runtime defaults/fallbacks, but explicit `null` or non-object values for
    those object controls must return JSON-RPC `-32602` with structured
    `invalid_*_shape` data instead of being treated as omitted.
41. Runtime health cache-window controls must fail closed on explicit invalid
    values. `runtime.health` may omit `cache_stats_window_ms` to disable window
    rotation, but explicit `null`, non-integer, or zero values must return
    JSON-RPC `-32602` with structured `invalid_cache_stats_window_ms` data
    instead of silently behaving like an omitted window policy. Explicit
    malformed `cache_stats_reset_window` values must return structured
    `invalid_cache_stats_reset_window` data instead of falling back to `false`.

---

## Provider Routing Failure Health Contract

When Rust model/provider execution returns structured failure metadata, gateway
provider routing must treat `error_data` as the primary recovery signal. Message
text is only a legacy fallback.

Implementation points:

1. `runtime/src/models/contracts.rs` emits provider/model `error_data` fields:
   `diagnostic_kind`, `source`, `stage`, `recovery_hint`, `provider`,
   `provider_kind`, `model`, `http_status`, `attempt`, `max_attempts`, and
   `retryable`.
2. `gateway/src/cli/start/session-registry/normalization.ts` persists only safe
   `provider_runtime_states[].last_error_data` summary fields. It must not
   persist `body_preview` or `response_headers`.
3. `gateway/src/cli/services/provider-failure-health.ts` maps
   `SessionProviderRuntimeState.last_error_data` into route health:
   - `retryable=false` -> strong score penalty and sticky bypass when another
     provider is available.
   - `attempt >= max_attempts` -> strong score penalty and sticky bypass when
     another provider is available.
   - `config_missing` / `config_invalid` and auth-like HTTP status
     `401` / `403` / `404` -> strongest penalty.
   - transient HTTP status `408` / `425` / `429` / `500` / `502` / `503` / `504`
     with `retryable=true` -> moderate penalty, not an immediate sticky bypass.
4. `gateway/src/cli/start/turn/provider-routing.ts` must include the health
   penalty in `resolveProviderOrder()` score calculations and expose route
   diagnostics via `RouteDecisionTrace.scoreOrder[].lastErrorPenalty`,
   `RouteDecisionTrace.scoreOrder[].lastErrorReason`, and stderr
   `last_error_penalties=...`.
   Final turn-failure summaries may render compact human labels from the same
   safe fields (diagnostic kind, HTTP status, attempt counts, retryability) but
   must not print raw previews or response headers.
5. `gateway/src/cli/status/route-status.ts` must serialize the same normalized
   route health as `provider_runtime_states[].last_error_health` with
   `score_penalty`, `reason`, and `sticky_bypass_reason`, so status consumers do
   not have to reimplement provider failure scoring from raw `last_error_data`.
   Observed route selection must use the same sticky bypass boundary as the
   runtime router: a sticky provider with a non-retryable or exhausted last
   error loses its hard sticky preference when any non-circuit alternate is
   available, then the observed route falls back to health/score ordering. The
   alternate does not have to be perfectly clean; a degraded-but-lower-risk
   provider must still be considered.
6. `gateway/src/extensions/contracts/provider-routing-contract.ts` must cover
   retry decisions and route ordering together:
   - non-retryable sticky provider loses hard sticky priority when a non-circuit
     alternate is open;
   - exhausted-attempt sticky provider loses hard sticky priority when a
     non-circuit alternate is open;
   - retryable transient provider keeps only moderate penalty and can remain
     selected when it is otherwise the better route;
   - config/auth blockers rank behind clean providers;
   - trace fields include machine-readable penalty reason.
7. `gateway/src/cli/status/run-status.ts` and
   `gateway/src/cli/serve/management-routes.ts` must expose the same safe
   `route_decision` contract. Namespace parsing must be centralized in
   `gateway/src/cli/status/route-namespace.ts`, then both `grobot status
   --json` and management `GET /api/v1/status` must reuse the status route
   snapshot helpers instead of reimplementing provider scoring. Both surfaces
   must preserve the same unsafe-field exclusion for `body_preview` and
   `response_headers`.
   Query parameters may select a management session namespace (`platform`,
   `tenant`, `session-scope` / `scope`, `session-subject` / `subject`), and CLI
   options may select a status namespace (`--platform`, `--tenant`,
   `--session-scope` / `--scope`, `--session-subject` / `--subject`). Invalid
   namespace values must fail as stable envelopes (`invalid_session_platform`,
   `invalid_session_scope`, `invalid_session_tenant`,
   `invalid_session_subject`) instead of throwing through the HTTP server or
   top-level CLI fatal handler. Management uses JSON HTTP `400`; `grobot status
   --json` uses `status:"error"` with exit code `2`; text status prints a
   concise stderr error and exits `2`. `grobot start` and `grobot serve` must
   reject invalid CLI namespace options before bootstrap/listen with the same
   concise stderr error and exit code `2`. Valid alias query forms must return
   provider health fields in the same shape as `grobot status --json`.

Memory and experience feedback must preserve the same safe structured signal
without storing unsafe provider previews:

1. `gateway/src/cli/start/turn/diagnostics.ts` is the gateway boundary for
   converting runtime provider `error_data` into safe
   `ExperienceProviderFailureDiagnostics` fields. It may include provider,
   diagnostic kind, source/stage, provider kind/model, upstream error kind,
   HTTP status, attempt counts, and retryability.
2. Experience persistence must store structured diagnostics separately from the
   legacy `toolContext` string:
   - `ExperienceAttemptRecord.providerFailureDiagnostics`
   - `ExperienceRecord.lastProviderFailureDiagnostics`
   - `ExperienceEvidence.providerFailureDiagnostics` for `turn_failure`
3. These structured fields must not include `body_preview`,
   `response_headers`, raw provider request/response bodies, or arbitrary
   unsafe payload previews.
4. Experience recall may surface only compact safe diagnostics (for example
   `diagnostic_kind=upstream_http_error http_status=503 retryable=false`) so the
   next turn can reason about retry/switch/config actions without leaking raw
   upstream content.
5. Contracts that touch memory/experience failure feedback must verify both
   typed persistence and unsafe-field exclusion.

---

## Common Mistakes

1. Swallowing error context (`catch {}` without warning/error output).
2. Returning success after partial write failure.
3. Throwing opaque `Error("failed")` without class/source details.
4. Logging sensitive values while printing debug failures.

---

## Examples

1. `gateway/src/cli/index.ts` (exit-code based command error handling)
2. `gateway/src/tools/runtime/stdio-client.ts` (spawn timeout, abort, JSON-RPC error normalization)
3. `gateway/src/cli/services/session-store.ts` (redis failure fallback)
4. `runtime/src/orchestration/pipeline.rs` (failure-to-event mapping)
5. `runtime/src/models/config.rs` (provider/config parse and upstream error classes)
