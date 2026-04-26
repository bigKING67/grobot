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

Gateway validates both fingerprints before trusting runtime describe output.

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
- `runtime_tools.surface_adaptation.reason=recovery_requires_user_intervention`

## Surface adaptation rules

Surface adaptation is intentionally narrow:

- Active recoverable feedback can switch to a better tool profile, for example
  from `coding` to `browser`, `context`, or `mcp`.
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
- `surface_adaptation.active`
- `surface_adaptation.reason`
- `surface_adaptation.auto_adaptation_blocked`
- `surface_adaptation.recovery_recoverable`
- `surface_adaptation_outcome.latest_recovery_consumption`

Text status mirrors the decisive fields for quick terminal inspection:

- `runtime_tool_recovery_feedback: ...`
- `runtime_tool_surface_adaptation: ...`
- `runtime_tool_surface_adaptation_outcome: ...`

## Verification

Focused contracts:

```bash
npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/runtime-tool-events-contract.ts
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
