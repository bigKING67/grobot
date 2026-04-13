# Legacy Python Boundary (Phase 2 Freeze)

## Status

- `gateway/grobot_cli.py` is treated as a legacy facade in the TS+Rust migration.
- During the current phase, no new feature should be added directly into that file.
- New behavior must be implemented in TypeScript (`gateway/src/**`) or Rust (`runtime/src/**`), then exposed through bridge contracts.

## Boundary Contracts

1. Python -> TS bridge:
   - Input: JSON via stdin (user message, session key parts, actor/project context, migration options).
   - Output: single JSON object with `status`, `assistant_message`, and `report`.
   - Entrypoint: `gateway/src/extensions/bridge-cli.ts`.

2. TS -> Rust runtime:
   - Transport: stdio JSON-RPC.
   - Methods: `runtime.health`, `runtime.turn.execute`.
   - Contract source of truth: `shared/contracts/runtime-v1.json`.

## Compatibility Rules

- Keep CLI commands and flags behavior-compatible while internal files are reorganized.
- Keep management API routes and response field names stable.
- Keep `runtime.v1` request/response schema stable unless contract version is explicitly bumped.

## Migration Discipline

- Any Python-side change must be justified as bugfix/compat maintenance only.
- Cross-layer payload changes must update:
  - bridge implementation,
  - contract docs,
  - gateway/runtime tests.
