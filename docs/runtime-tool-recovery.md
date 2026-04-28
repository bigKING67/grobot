# Runtime Tool Recovery

`grobot` keeps tool recovery policy explicit across the Rust runtime and the
TypeScript gateway. The goal is to prevent repeated failed tool calls while
keeping every recovery decision observable in `status --json`.

## Event chain

1. Runtime emits `tool_end` for every tool call.
2. Runtime emits `tool_recovery` when a failed, deferred, or unsupported tool
   call needs a next-step hint.
3. Gateway records a cumulative `.grobot/runtime/tool-surface-metrics.json`
   snapshot.
4. Gateway converts the latest recovery into a prompt hint for the next turn.
5. Gateway records recovery consumption in
   `.grobot/runtime/tool-surface-adaptation-state.json` when the hint has been
   resolved, blocked, or shown once for human intervention.
6. Gateway projects `metrics.recentRecoveries` +
   `surface_adaptation_outcome.recentRecoveryConsumptions` into a merged
   `recovery_timeline` for `status --json`.

The Rust policy source is `runtime/src/tools/recovery.rs`. Gateway action
instructions are cataloged in
`gateway/src/tools/runtime/tool-events.ts` as
`RUNTIME_TOOL_RECOVERY_ACTION_INSTRUCTIONS`.

`runtime.tools.describe` is also a governance surface now. It exposes:

- `tool_recovery_policy_version`
- `tool_recovery_actions`
- `tool_recovery_catalog_fingerprint`
- `tool_recovery_catalog`
- `tool_surface_schema_profiles_fingerprint`
- `tool_surface_schema_profiles`

Gateway validates both fingerprints before trusting runtime describe output. It
also rejects malformed schema profile rows, incomplete profile sets, profile
projection drift, unknown tool names, and visible/suppressed argument overlap so
the reported schema budget cannot silently diverge from the executable runtime
tool manifest.

Tool schema budget is an explicit contract, not a comment. Gateway fallback
projections and runtime-reported schema profiles are both checked against
`gateway/src/tools/runtime/tool-surface-budget.ts`, including visible tool count,
projected/full/suppressed argument counts, and estimated schema-token ceilings.
This keeps browser schema slimming measurable and prevents accidental tool
surface expansion from silently increasing prompt cost.
Gateway fallback `schema_fingerprint` must hash the actual projected schema
shape, not just the visible tool names. The fingerprint payload includes
projection mode, advanced-schema flag, projected/full/suppressed argument
counts, and visible/suppressed args per tool. Profiles with the same visible
tools, such as `browser` and `browser_advanced`, therefore get different
fingerprints when their argument surfaces differ.

The default `browser` profile intentionally exposes only the common browser
control primitives: page/tab scan, current/session tab selection, bounded output,
JS/bridge code execution, and timeout control. Low-frequency output/debug
selectors such as `text_only` and `session_url_pattern` stay available through
`browser_advanced` and `full_debug`, not the default prompt surface. Hidden args
are rejected at the runtime execution boundary, so profile slimming cannot create
silent behavior drift.

`read` follows the same split for lightweight profiles. `minimal`, `browser`,
and `context` expose the normal text-window contract (`path`, `offset`, `limit`,
`include_metadata`), while legacy line-range compatibility and media page
selection (`line_start`, `line_end`, `pages`) remain available through `coding`,
`browser_advanced`, and `full_debug`. The runtime rejects hidden `read` args
before parsing the request, so a slim profile cannot accidentally use parameters
that were not shown in the model schema.

`semantic_search` is also slimmed in the `context` profile. The normal context
retrieval surface exposes only `query`, `sources`, `per_source_limit`,
`max_segments`, and `include_org`; bridge overrides, refresh forcing, timeout
tuning, and manual `technical_terms` hints remain a `full_debug` concern.
Runtime dispatch rejects hidden semantic-search args before running the bridge,
so cache/debug tuning cannot slip through a slim context prompt.

The canonical human-intervention primitive is `ask_user`. Older
`ask_user_question` tool calls are accepted only as a runtime compatibility
alias at dispatch/interrupt parsing boundaries; new tool manifests and gateway
fallback surfaces must expose `ask_user`.
Normal `ask_user` schemas expose only `questions`. Internal orchestration fields
(`blocking_node_id`, `default_on_timeout`, `resume_token`) are reserved for
`full_debug` and rejected in slim/advanced surfaces, preventing model-visible
collaboration prompts from carrying hidden resume-control state.

`mcp_servers` exposes only `ready_only` outside `full_debug`. Disabled-server
inventory is an operator/debug concern, so `include_disabled` remains available
only in `full_debug` and is rejected in normal MCP surfaces. Normal MCP listing
also defaults to excluding disabled servers; full-debug inventory keeps the
complete list unless the caller explicitly narrows it.

`mcp_call.arguments` keeps its general object-shaped capability, but it is not
an unbounded transport. Runtime rejects non-object argument payloads with
structured `invalid_tool_arguments` data, and rejects oversized argument objects
before server lookup/spawn with `mcp_arguments_too_large`. This preserves MCP
composability while keeping input-side context and process pressure observable.
When an MCP call fails after argument parsing, including configuration/gate
failures, JSON-RPC/transport failures, or `isError=true` tool results, the
runtime recovery data must include bounded argument diagnostics:
`argument_keys`, `argument_bytes`, `max_argument_bytes`, and a redacted
`argument_preview`. The full argument object is never emitted as recovery data;
the preview is capped and secret-like values are masked before reaching the
gateway prompt hint.

Gateway recovery feedback then specializes the next action from that structured
MCP data instead of leaving the model with a generic strategy-switch prompt.
`mcp_tool_blocked` maps to `use_allowed_mcp_tool_or_request_policy_change`;
`mcp_rpc_error` with JSON-RPC code `-32602` or MCP-side
`invalid_tool_arguments` maps to `fix_mcp_tool_arguments`; payloads over the
hard limit or near the reported `max_argument_bytes` map to
`reduce_mcp_argument_payload`; and `mcp_tool_result_error` maps to
`inspect_mcp_tool_result_and_change_arguments`. Repeated or non-recoverable
MCP environment failures still keep the higher-priority ask-user/environment
escalation rather than being downgraded to argument-level retries.

Every effective `recommended_next_action` is also classified into a stable
`recommended_action_family` / `recommended_action_reason` pair. Families are
coarse enough for status, readiness, gates, and experience aggregation:
`argument_fix`, `payload_reduce`, `path_fix`, `content_fix`, `schema_fix`,
`strategy_switch`, `fallback_tool`, `wait_or_retry`, `policy_or_permission`,
`environment_fix`, `user_intervention`, `observe`, `media_extract`,
`unknown_tool`, `unknown`, or `none`. The family is derived after gateway
MCP-specific refinement, so `mcp_rpc_error:-32602` reports `argument_fix` and
near-budget MCP payloads report `payload_reduce`.

The MCP recovery eval matrix in
`gateway/src/extensions/contracts/runtime-tool-mcp-recovery-eval-contract.ts`
locks the main MCP failure families end to end: policy-blocked tools,
JSON-RPC invalid params, generic RPC errors, `isError=true` tool results,
oversized and near-budget payloads, invalid argument shapes, unready servers,
busy servers, queue timeouts, and open circuits. Each row asserts the refined
`recommended_next_action`, `recommended_action_family`, recoverability, prompt
hint fragments, readiness state, and readiness-gate blocker projection.

Tool-surface routing is contract-tested by
`gateway/src/tools/runtime/tool-surface-routing-evals.ts`. Each eval row maps a
representative user intent to the expected profile, visible tool set, forbidden
tools, and required suppression reasons. This protects the minimal toolset from
drifting into broad `full_debug` exposure or confusing code-maintenance mentions
of `web_scan`, `mcp_call`, or `semantic_search` with actual execution intent.

Tool output budget is enforced at the model-loop boundary. Local tools may
return their full structured payload to the runtime caller, but before that
payload is appended as a `role=tool` message for the next model request, the
runtime applies the `tool_message_budget_policy_version` contract exposed by
`runtime.tools.describe`. Oversized tool messages are converted into a compact
JSON envelope containing:

- `output_budget`: policy version, truncation flag, original size, ceiling, and
  retry hint.
- `summary`: normalized tool output metadata from the original payload.
- `preview`: bounded middle-truncated text so the model still sees the shape of
  the output without paying the full dynamic context cost.

The current budget targets the highest-risk dynamic outputs first:

- default tool message ceiling: `80_000` chars.
- `mcp_call`, `web_scan`, and `web_execute_js`: `48_000` chars.

Gateway validates the reported budget rows against
`gateway/src/tools/runtime/tool-output-budget.ts`; missing, duplicate, unknown,
or expanded budget rows make `runtime.tools.describe` invalid instead of
silently increasing dynamic context cost.

`tool_end.output_summary` remains based on the original payload, while
`tool_end.output_budget` records whether the model-facing tool message was
compressed. This preserves direct tool fidelity for operators and tests while
protecting the next model turn from accidental raw DOM/MCP payload floods.

Tool output density is also contract-owned by the runtime-tool suite. The
`runtime-tool-output-density` contract locks the structured, model-useful
metadata that keeps atomic tools high signal: list/glob/search truncation
flags, read offsets and metadata opt-out, bash persisted-output pointers,
write/edit change metadata, MCP bounded argument diagnostics, and the
model-facing budget envelope summary. This prevents a tool from staying
functionally correct while quietly regressing into low-density raw output or
opaque failure text.

Recovery prompt-flow stderr events must carry the same stable action
classification as feedback/readiness/gate surfaces: `action_family` and
`action_reason` are emitted with prompt injection, guarded suppression, and
non-recoverable intervention events. This keeps operator diagnostics and
experience-pool consumers from parsing long `recommended_next_action` strings.

Release reports use the same quality-summary shape as daily status surfaces:
`checks.runtime_tool_quality` exposes `status`, `passed`, `failure_reasons`,
and `warning_reasons` in addition to describe-runner evidence. A release gate
failure must therefore explain why the runtime-tool quality gate failed, not
only return a boolean.
The runtime-tool suite owns a dedicated quality-schema contract that keeps
release `checks.runtime_tool_quality` and daily `runtime_tools_quality`
aligned on the core machine-readable fields: status, passed, source,
failure/warning reasons, schema-budget status and violations, runtime binary
existence, and the actionable next-step field for the surface.

If `runtime.tools.describe` is unavailable or invalid, the gateway falls back to
the gateway start-default tool set, but the degradation must stay observable:
`status` reports `runtime_tool_enabled_tools_source_detail` and the real
`grobot start` path emits a single
`[tool-surface] event=runtime_describe_fallback` stderr line with the fallback
reason and manifest fingerprint. Normal successful describe resolution stays
quiet unless startup diagnostics are enabled.

## Recoverability contract

`tool_recovery.recoverable` controls whether the gateway may recover
automatically:

- `true`: automatic recovery is allowed only after changing a concrete variable.
- `false`: automatic recovery is blocked; the next turn must ask the user or fix
  the required configuration, approval, or environment.
- missing/unknown: legacy-tolerant behavior; gateway can still use a safe
  strategy switch, but status keeps `recoverable=<unknown>`.

For nonrecoverable recoveries, the gateway sets:

- `runtime_tools.recovery_feedback.recoverable=false`
- `runtime_tools.recovery_feedback.requires_user_intervention=true`
- `runtime_tools.surface_adaptation.auto_adaptation_blocked=true`
- `runtime_tools.surface_adaptation.reason=recovery_gate_blocked_operator_action_required`

## Repeated failure escalation

The gateway persists repeated recovery pressure by `(tool_name, error_class)` in
`.grobot/runtime/tool-surface-metrics.json`. `recoveryCountsByKey` is a
cumulative diagnostic map, while `latestRecoveryRepeatKey` /
`latestRecoveryRepeatCount` drive escalation and reset after a tool batch with no
new recovery event. This is a gateway-side loop guard because normal runtime
tool failures usually terminate the current model turn; the repeated pattern
becomes visible across turns rather than inside one model loop.

Repeat pressure is also cleared when the matching recovery is consumed:

- a recovery-driven adaptation completes successfully
  (`recovered_signal_consumed`)
- a later turn successfully completes a matching tool call without new failed,
  deferred, or recovery events (`successful_tool_call_consumed`)
- a guard consumes the active recovery hint
  (`repeated_profile_failure` / `profile_oscillation`)
- a nonrecoverable recovery is shown once for human intervention
  (`nonrecoverable_intervention_prompted`)

This keeps escalation tied to live failure pressure. Historical counters remain
available in `recoveryCountsByKey`, but consumed or recovered hints stop
poisoning the next independent attempt.

The effective recovery hint can be stricter than the raw runtime hint:

- First occurrence: preserve the runtime stage/action.
- Second occurrence of the same tool/error: escalate lower-grade stages to
  `strategy_switch` with `recommended_next_action=switch_tool_strategy`.
- Third and later occurrence: escalate lower-grade stages to `ask_user` with
  `recommended_next_action=ask_user_for_config_or_switch_provider`,
  `recoverable=false`, and `requires_user_intervention=true`.

Escalation never downgrades a runtime-provided `strategy_switch` or `ask_user`.
When the gateway changes the effective hint, it records:

- `same_tool_error_count`
- `escalated`
- `escalation_reason` (`same_tool_error_repeated` or
  `same_tool_error_exhausted`)
- `escalation_policy_version`
- `base_recovery_stage`
- `base_recommended_next_action`

The active prompt hint includes the repeat count and the base recovery so the
model can see why a local retry is no longer acceptable. This implements the
GA-style staged discipline: local fix first, strategy switch second, human
intervention when the same failure keeps repeating.

The same escalation fields are emitted on recovery prompt-flow stderr events and
text status lines. Operators should not have to expand `promptBlock` or JSON to
see why a hint was escalated; `same_tool_error_count`, `escalated`,
`escalation_reason`, `escalation_policy_version`, `base_recovery_stage`, and
`base_recommended_next_action` are kept together as a single observability
tuple.

## Surface adaptation rules

Surface adaptation is intentionally narrow:

- Active recoverable feedback can switch to a better tool profile, for example
  from `coding` to `browser`, `context`, or `mcp`.
- `recovery_gate` is evaluated before profile inference. When the gate is
  `fail`, automatic surface adaptation is blocked even if the latest feedback
  still looks recoverable.
- The same gate is used by both `status --json` preview and the actual
  `grobot start` turn path; start-turn orchestration must not re-implement a
  separate recovery/adaptation policy.
- When the start-turn gate blocks automatic surface adaptation, stderr emits
  `[tool-recovery-gate] event=blocked ... policy_version=... health_thresholds=<watch>/<risk>`
  so the runtime decision can be diagnosed without a separate status command.
- Nonrecoverable feedback never switches profiles automatically.
- Explicit user/config/env/debug profiles are not overridden by recovery.
- The adaptation guard blocks repeated failed profile switches and profile
  oscillation.

The orchestration entrypoint should stay thin. It may compose these helpers, but
policy belongs in `gateway/src/tools/runtime/*`.

The start-turn prompt branch is routed through
`gateway/src/tools/runtime/recovery-prompt-flow.ts`, so one-shot recovery prompt
behavior can be contract-tested without embedding branch-heavy logic directly in
`run-start-turn.ts`.

## Policy source of truth

Recovery policy is centralized in:

- `gateway/src/tools/runtime/tool-recovery-policy.ts`
- `gateway/src/tools/runtime/tool-recovery-decision.ts`

That module defines the shared knobs for:

- prompt max age before a recovery hint becomes stale
- recovery timeline retention
- adaptation / recovery-consumption history retention
- guard thresholds for repeated profile failure and oscillation
- escalation thresholds for repeated `(tool_name, error_class)` failures
- health score thresholds and penalty weights

The intent is to prevent silent drift between `tool-events`,
`tool-surface-adaptation-state`, `tool-recovery-timeline`, and `status --json`.
`tool-recovery-decision.ts` is the shared composition point for feedback
consumption, timeline, health, readiness, and gate decisions. Both
`status --json` and `grobot start` must use this helper instead of rebuilding
the chain locally.

Policy is injected through the full recovery decision chain:

```text
policy -> health -> readiness -> gate -> status/start-turn observability
```

`buildRuntimeToolRecoveryHealthSummary(...)` accepts the same policy snapshot as
readiness/gate so health scoring, penalty weights, and thresholds can be tested
or overridden as one unit. Text fields for readiness/gate are formatted through
shared formatter helpers instead of separate string templates in status and
start-turn code.

## Consumption rules

Recovery hints are one-shot per observed recovery key:

- `recovered_signal_consumed`: a previous adaptation recovered successfully.
- `successful_tool_call_consumed`: a later tool batch completed successfully
  after the hint, so the stale hint must not be injected again.
- `repeated_profile_failure`: guard blocked a repeated failed adaptation.
- `profile_oscillation`: guard blocked an A/B/A/B profile loop.
- `nonrecoverable_intervention_prompted`: a nonrecoverable hint was injected
  once and must not be repeated until a newer recovery event arrives.

Consumption matches by recovery stage, tool name, error class, and observed
timestamp. A newer recovery event with a later `observedAt` becomes active
again.

## Status fields

`./grobot status --json` exposes the current state under
`runtime_tools`:

- `runtime_tools.quality` and top-level `runtime_tools_quality`
  - `status` (`ok` / `warn` / `fail`)
  - `runtime_binary_exists`
  - `runtime_health_ok`
  - `runtime_describe_source`
  - `schema_projection_drift_active`
  - `schema_budget_status`
  - `schema_budget_violations`
  - `recovery_health_level`
  - `recovery_gate_status`
  - `latest_recovery_stage`
  - `latest_blocker_kind`
  - `action_required`
- `metrics.recoveryCountsByKey`
- `metrics.latestRecoveryRepeatKey`
- `metrics.latestRecoveryRepeatCount`
- `recovery_feedback.active`
- `recovery_feedback.reason`
- `recovery_feedback.recoverable`
- `recovery_feedback.requires_user_intervention`
- `recovery_feedback.same_tool_error_count`
- `recovery_feedback.escalated`
- `recovery_feedback.escalation_reason`
- `recovery_feedback.escalation_policy_version`
- `recovery_feedback.base_recovery_stage`
- `recovery_feedback.base_recommended_next_action`
- `recovery_feedback.consumed`
- `recovery_feedback.consumed_reason`
- `recovery_feedback.recommended_action_family`
- `recovery_feedback.recommended_action_reason`
- `recovery_timeline[]`
- `recovery_health`
- `recovery_policy`
- `recovery_readiness`
- `recovery_gate`
- `recovery_policy.escalation.same_tool_error_strategy_switch_threshold`
- `recovery_policy.escalation.same_tool_error_ask_user_threshold`
- `surface_adaptation.active`
- `surface_adaptation.reason`
- `surface_adaptation.auto_adaptation_blocked`
- `surface_adaptation.recovery_recoverable`
- `surface_adaptation_outcome.latest_recovery_consumption`

`recovery_timeline` is ordered newest-first and keeps each recent recovery
annotated with:

- `recovery_key`
- `observed_at`
- `tool_name`
- `error_class`
- `stage`
- `recommended_next_action`
- `recommended_action_family`
- `recommended_action_reason`
- `recoverable`
- `requires_user_intervention`
- `same_tool_error_count`
- `escalated`
- `escalation_reason`
- `escalation_policy_version`
- `base_recovery_stage`
- `base_recommended_next_action`
- `active`
- `consumed`
- `consumed_reason`
- `consumed_at`

`recovery_health` provides a compact machine-readable summary for automation and
diagnostics:

- `score`
- `level` (`good|watch|risk`)
- `reason`
- `recommended_next_action`
- `recommended_action_family`
- `recommended_action_reason`
- `attention_source` (`none|latest|historical_unconsumed`)
- `attention_recovery_key`
- `attention_stage`
- `attention_tool_name`
- `attention_error_class`
- `attention_requires_user_intervention`
- `attention_age_ms`
- `timeline_entry_count`
- `active_recovery_count`
- `active_nonrecoverable_count`
- `unconsumed_count`
- `consumed_count`
- `stuck_nonrecoverable_count`
- `has_stuck_nonrecoverable`
- `latest_recovery_key`
- `latest_age_ms`

The intended contract is:

- `good`: no active or historical unresolved pressure worth operator attention
- `watch`: historical or low-grade recovery pressure exists; inspect before the
  next risky tool sequence
- `risk`: active nonrecoverable or otherwise stuck recovery pressure exists;
  follow `recommended_next_action` before continuing

`attention_*` makes the recommendation traceable:

- `attention_source=latest`: the recommended action points at the newest active
  recovery entry.
- `attention_source=historical_unconsumed`: the newest recovery may already be
  consumed, but an older unresolved recovery still requires action.
- `attention_recovery_key`: the exact recovery entry the action refers to, so
  automation does not have to guess from `latest_*`.

`recovery_readiness` converts health + policy into a direct operator/CI signal:

- `status` (`ready|degraded|blocked`)
- `ready`
- `automatic_recovery_allowed`
- `operator_action_required`
- `reason`
- `recommended_next_action`
- `recommended_action_family`
- `recommended_action_reason`
- `policy_version`
- `health_level`
- `health_score`
- `risk_score_threshold`
- `watch_score_threshold`
- `attention_recovery_key`
- `attention_source`
- `attention_stage`
- `attention_tool_name`
- `attention_error_class`
- `attention_requires_user_intervention`
- `attention_action_family`
- `attention_action_reason`

The intended readiness contract is:

- `ready`: no active or unresolved recovery pressure; normal automatic recovery
  may continue.
- `degraded`: health is in `watch`; automation should inspect the referenced
  recovery, but automatic recovery can continue when no operator action is
  required.
- `blocked`: health is in `risk`; automatic recovery is blocked until the
  recommended action or operator intervention clears the pressure.

`recovery_gate` turns readiness into a direct pass/warn/fail decision so CI,
operators, and orchestration code do not re-implement readiness policy:

- `status` (`pass|warn|fail`)
- `passed`
- `blocking`
- `severity` (`none|warning|error`)
- `reason`
- `recommended_next_action`
- `recommended_action_family`
- `recommended_action_reason`
- `readiness_status`
- `readiness_ready`
- `readiness_reason`
- `automatic_recovery_allowed`
- `operator_action_required`
- `policy_version`
- `health_level`
- `health_score`
- `risk_score_threshold`
- `watch_score_threshold`
- `attention_recovery_key`
- `attention_source`
- `attention_stage`
- `attention_tool_name`
- `attention_error_class`
- `attention_requires_user_intervention`

The intended gate contract is:

- `pass`: readiness is `ready`; automatic recovery may proceed normally.
- `warn`: readiness is `degraded`, but automatic recovery remains allowed and
  no operator action is required. Automation may continue, but should surface
  the referenced `attention_*` recovery before the next risky tool sequence.
- `fail`: readiness is blocked, operator action is required, automatic recovery
  is denied, or the readiness fields are internally inconsistent. Automation
  must stop automatic recovery/adaptation and follow `recommended_next_action`.
  In `grobot start`, this blocks automatic tool-surface/profile adaptation; the
  turn may still continue with an explicit recovery prompt unless the prompt
  flow requires user intervention.

Text status mirrors the decisive fields for quick terminal inspection:

- `runtime_tool_recovery_feedback: ...`
- `runtime_tool_recovery_timeline: ...`
- `runtime_tool_recovery_health: ...`
- `runtime_tool_recovery_policy: ...`
- `runtime_tool_recovery_readiness: ...`
- `runtime_tool_recovery_gate: ...`
- `runtime_tool_surface_adaptation: ...`
- `runtime_tool_surface_adaptation_outcome: ...`

The readiness and gate text lines include `health_thresholds=<watch>/<risk>` so
operators can evaluate the displayed health score without jumping back to the
policy JSON block.

## Verification

Focused runtime-tool contract suite:

```bash
npm run check:gateway:runtime-tools
npm run check:gateway:runtime-tools:json
npm run check:gateway:runtime-tools:schema
npm run check:gateway:runtime-tools:release-report
```

The JSON mode reports `schema_version: 1` and always includes
`diagnostics_self_test` so the runner fails before contract execution if its
own failure-detail extraction regresses. When a contract fails, it reports
`failed_contract_detail` with the failed path, duration, reproduction command,
parseable last JSON output, and capped stdout/stderr tails. It also exposes
`diagnostic_summary` with the pass/fail status, failed contract id,
reproduction command, runtime binary source/existence, and schema-budget
violation count. When
`--include-runtime-describe` is enabled, the report also includes
`runtime_binary` with the describe binary path, source, size, and modification
timestamp, so CI artifacts can distinguish a contract regression from stale or
missing runtime binaries.

`check:gateway:runtime-tools:schema` validates both successful and forced
failure runner JSON output. It asserts required field types for
`schema_version`, counts, `diagnostics_self_test`, `failed_contract_detail`,
`diagnostic_summary`, `runtime_binary`, and every compact `results[]` item. It
is part of `check:gateway:runtime-tools`, so schema drift is blocked by the
normal focused runtime-tool suite.

`check:gateway:runtime-tools:release-report` runs the core release gate with a
deterministic synthetic runtime-tool contract failure and asserts that the
failure report still preserves `diagnostics_self_test`,
`failed_contract_detail`, `diagnostic_summary`, `runtime_binary`, and
`checks.runtime_tool_quality`. It also runs a successful release-gate path and
asserts that `runtime_tool_quality` reports complete contract coverage,
temporary fixture isolation, zero schema-budget violations, runtime binary
presence, and a passed diagnostic summary. This regression belongs to the
release/packaging gate rather than the gateway-only suite because it builds the
Rust runtime before checking describe-mode failure evidence. If the describe
runner exits successfully but the release gate cannot parse or summarize its
JSON report, the gate must fail through the explicit
`runtime_tool_describe_report_invalid` reason so `--report` callers still get a
machine-readable failure.

The default suite is gateway-only and does not require a freshly built Rust
runtime binary. It is part of the repository `npm run check` gate, so recovery
or tool-surface changes cannot bypass these contracts in the default validation
path. `check:gateway` intentionally does not repeat these focused contracts;
`check:gateway:runtime-tools` is the single gateway-only owner for runtime-tool
surface/recovery assertions. The ownership contract also prevents the suite
from drifting out of the default check, release gate, CI workflow coverage,
runner coverage for every `runtime-tool-*.ts` contract, or per-process
temporary fixture isolation.
It runs:

```bash
npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/runtime-tool-suite-ownership-contract.ts
npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/runtime-tool-events-contract.ts
npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/runtime-tool-mcp-recovery-eval-contract.ts
npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/runtime-tool-recovery-timeline-contract.ts
npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/runtime-tool-recovery-readiness-contract.ts
npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/runtime-tool-recovery-flow-contract.ts
npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/runtime-tool-surface-contract.ts
node gateway/src/extensions/contracts/start-smoke-contract.mjs status-nonrecoverable-tool-recovery --repo-root .
node gateway/src/extensions/contracts/start-smoke-contract.mjs status-nonrecoverable-tool-recovery-consumed --repo-root .
```

The two status smoke contracts also assert that escalation diagnostics survive
both `status --json` and text status:

- `same_tool_error_count`
- `escalated`
- `escalation_reason`
- `escalation_policy_version`
- `base_recovery_stage`
- `base_recommended_next_action`

They also lock the policy snapshot exposed by `runtime_tools.recovery_policy`
against the text status line, including guard thresholds, repeated tool-error
escalation thresholds (`2/3`), health thresholds (`85/60`), and health
penalties. Readiness/gate contracts additionally assert that custom policy
thresholds are forwarded into `recovery_readiness`, `recovery_gate`, and their
text status surfaces.
The status smoke also locks `runtime_tools_quality` so the shallow quality
surface stays available during daily operation, not only in release reports.
This runtime summary is intentionally lightweight: it does not execute the
release contract runner, but it does combine runtime binary health, describe
source, schema-projection drift, schema-budget validation, recovery health, and
recovery-gate blockers into a single `ok` / `warn` / `fail` status.
The fallback smokes for missing and invalid `runtime.tools.describe` binaries
must assert `runtime_tools_quality.status=fail`, the concrete failure reasons,
and the text `runtime_tool_quality:` line so degraded runtime states cannot
silently appear healthy.

The timeline contract also covers a full recovery loop: once all historical
recoveries are consumed, health returns to `good`, readiness returns to
`ready`, and the gate returns to `pass`.

Runtime/governance contract after building the Rust runtime:

```bash
npm run check:gateway:runtime-tools:describe
npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/runtime-tool-governance-contract.ts
```

The `:describe` script builds the Rust runtime first so
`runtime/target/debug/grobot-runtime` is not stale. Runtime describe is expected
to expose the base recovery actions it can emit directly; gateway-only
contextual refinements such as `fix_mcp_tool_arguments` are verified by the MCP
recovery eval matrix instead of being forced into the Rust base catalog. Keep
`:describe` as the explicit deep compatibility gate for Rust recovery catalog,
tool schema budget, or `runtime.tools.describe` surface changes. The release
gate (`npm run core:gate:release`) also runs this deep compatibility check so
release packaging cannot pass with a stale or drifted runtime tool describe
surface. Its JSON report exposes `checks.runtime_tool_describe` with
`runner_schema_version`, `contract_count`, `completed_count`,
`diagnostics_self_test`, `failed_contract`, `failed_contract_detail`,
`diagnostic_summary`, `runtime_binary`, `runtime_schema_budget_violations`, and
gateway-only recovery action summaries for release evidence. It also exposes
`checks.runtime_tool_quality` as a shallow release-quality summary containing
the diagnostic summary status, contract coverage, runner coverage, temporary
fixture isolation, schema-budget status and violations, runtime binary
existence, gateway-only recovery-action exceptions, and the next actionable
command when a runtime-tool contract fails. The focused
`runtime-tool-quality-schema` contract keeps this release surface aligned with
daily `runtime_tools_quality` status so downstream automation never has to infer
quality from prose or raw booleans. The default `npm run check` already covers the
gateway-only suite and then runs the normal Rust compile/test gate separately.
The core packaging workflow runs
`npm run check:gateway:runtime-tools:schema` and
`npm run check:gateway:runtime-tools:release-report` so runner JSON and
release-report failure diagnostics cannot silently drift.

Full gate:

```bash
npm run check
```
