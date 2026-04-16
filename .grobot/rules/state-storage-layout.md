# Runtime State Storage Layout

This file is the source of truth for runtime state placement.

## Rule

- All runtime state must be project-local under `<work-dir>/.grobot/`.
- Global home (`~/.grobot`) is reserved for global configuration and shared connector registry only.

## Allowed under `~/.grobot`

- `config.toml`
- `rules/`
- `skills/`
- `hooks/`
- `mcp/servers.toml`
- `core/` and `bin/` installation artifacts

## Must be project-local under `<work-dir>/.grobot`

- `session/`
- `memory/` (including org scope)
- `experience/` (tenant/team/user records)
- `wiki/` (including org scope and shared scope)
- `plans/`
- `scheduler/` (`tasks/`, `done/`, `scheduler.log`)

## Extension Guidance

- Any new runtime state directory introduced in future features must be placed under `<work-dir>/.grobot/`.
- If a feature needs global config, keep only static configuration in `~/.grobot`.
- Do not place mutable runtime state in `~/.grobot` unless a formal exception is approved and documented in this file.
