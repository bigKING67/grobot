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

The canonical human-intervention primitive is `ask_user`. Older
`ask_user_question` tool calls are accepted only as a runtime compatibility
alias at dispatch/interrupt parsing boundaries; new tool manifests and gateway
fallback surfaces must expose `ask_user`.

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

Focused contracts:

```bash
npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/runtime-tool-events-contract.ts
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

The timeline contract also covers a full recovery loop: once all historical
recoveries are consumed, health returns to `good`, readiness returns to
`ready`, and the gate returns to `pass`.

Runtime/governance contract after building the Rust runtime:

```bash
npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/runtime-tool-governance-contract.ts
```

Full gate:

```bash
npm run check
```
