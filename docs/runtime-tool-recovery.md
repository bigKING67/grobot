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
- health score thresholds and penalty weights

The intent is to prevent silent drift between `tool-events`,
`tool-surface-adaptation-state`, `tool-recovery-timeline`, and `status --json`.
`tool-recovery-decision.ts` is the shared composition point for feedback
consumption, timeline, health, readiness, and gate decisions. Both
`status --json` and `grobot start` must use this helper instead of rebuilding
the chain locally.

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

- `recovery_feedback.active`
- `recovery_feedback.reason`
- `recovery_feedback.recoverable`
- `recovery_feedback.requires_user_intervention`
- `recovery_feedback.consumed`
- `recovery_feedback.consumed_reason`
- `recovery_timeline[]`
- `recovery_health`
- `recovery_policy`
- `recovery_readiness`
- `recovery_gate`
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
  must stop and follow `recommended_next_action`.

Text status mirrors the decisive fields for quick terminal inspection:

- `runtime_tool_recovery_feedback: ...`
- `runtime_tool_recovery_timeline: ...`
- `runtime_tool_recovery_health: ...`
- `runtime_tool_recovery_policy: ...`
- `runtime_tool_recovery_readiness: ...`
- `runtime_tool_recovery_gate: ...`
- `runtime_tool_surface_adaptation: ...`
- `runtime_tool_surface_adaptation_outcome: ...`

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

Runtime/governance contract after building the Rust runtime:

```bash
npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/runtime-tool-governance-contract.ts
```

Full gate:

```bash
npm run check
```
