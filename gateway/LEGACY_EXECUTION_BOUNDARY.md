# Legacy Python Retirement Record

## Status

- As of 2026-04-13, the legacy Python CLI facade (`gateway/grobot_cli.py`) is fully retired and removed from this repository.
- Runtime and management execution paths are TS+Rust only (`gateway/src/**` + `runtime/src/**`).
- Any Python reintroduction into runtime/release/governance target scope is treated as regression.

## Guardrail

- `npm run audit:python:target` enforces two checks:
  - target-scope text audit (`package.json` / `.github/workflows` / `scripts` / `gateway/src/governance`) must not reintroduce `python3`/`--python-bin` style runtime dependencies.
  - repository-wide Python-file boundary audit: any `*.py` under repo root fails the check (except `.trellis/**` tooling scripts, which are out-of-scope for this migration).

## Boundary Contracts

1. TS -> Rust runtime:
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
