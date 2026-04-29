# Shared Contracts

This directory holds canonical cross-layer contracts shared by:

1. Channel adapters
2. TypeScript gateway
3. Rust runtime

Current contract docs:

1. `session-key.md`
2. `runtime-events.md`
3. `runtime-v1.json`
4. `bridge-plan-error-codes-v1.json`
5. `runtime-tool-quality-v1.json`

## Runtime v1

`runtime-v1.json` is the canonical cross-language protocol marker for:

1. Method list (`runtime.health`, `runtime.turn.execute`)
2. Transport (`json-rpc-2.0-over-stdio`)
3. Version pin (`runtime.v1`)

## Runtime tool quality v1

`runtime-tool-quality-v1.json` is the canonical registry for runtime-tool
quality fields shared by `grobot status --json` and core release reports. It
owns the allowed statuses, sources, schema-budget states, failure reasons,
warning reasons, action families, and `action_required` ids for
`runtime_tools_quality` and `checks.runtime_tool_quality`. The two quality
surfaces should publish both symbolic automation fields (`action_family`,
`action_reason`, `action_required`) and the human-facing
`actionable_next_step`. Implementations should derive `action_required` from
this registry rather than keeping separate reason-to-action maps. The same
registry owns `default_next_step` guidance by surface; status/release code may
only override the default `actionable_next_step` with runtime-specific details
such as a healthcheck error, fallback reason, recovery blocker, or
failed-contract reproduction command.
