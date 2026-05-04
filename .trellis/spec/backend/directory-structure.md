# Directory Structure

> How backend and platform code is organized in this repository.

---

## Overview

`grobot` keeps strict separation between product runtime code, product CLI code,
runtime core code, adapters, and workflow automation code.

- Product gateway: `gateway/` (TypeScript)
- Runtime core: `runtime/` (Rust)
- External adapters: `adapters/`
- Workflow tooling: `.trellis/scripts/` (Python)
- Project source-of-truth config: committed `.grobot/` skeleton files only

Do not mix product execution logic into Trellis scripts. Do not commit generated
`.grobot` runtime state as source.

---

## Target Directory Layout

The long-term product layout is domain-first. Directories describe product
domains; files describe their role inside that domain.

```text
gateway/
└── src/
    ├── cli/                         # product CLI source, target root
    │   ├── commands/
    │   ├── start/
    │   ├── status/
    │   ├── serve/
    │   ├── services/
    │   └── tui/
    ├── models/
    ├── tools/
    ├── extensions/
    ├── orchestration/
    │   └── orchestrator/
    └── governance/evals/

runtime/
└── src/
    ├── models/
    ├── tools/
    │   ├── core/
    │   ├── dispatcher/
    │   ├── list/
    │   ├── glob/
    │   ├── search/
    │   ├── read/
    │   ├── write/
    │   ├── edit/
    │   ├── mcp/
    │   ├── bash/
    │   └── semantic/
    ├── extensions/
    ├── orchestration/
    └── governance/

adapters/
├── browser-structured-mcp/
└── contextweaver/

.trellis/
└── scripts/
    ├── task.py
    ├── add_session.py
    ├── common/
    └── multi_agent/
```

Source-checkout compatibility compiles `gateway/src/cli/main.ts` through
`scripts/run-ts-dev-cli.sh`. First-class CLI product code belongs under
`gateway/src/cli/`; do not recreate `gateway/src/orchestration/entrypoints/dev-cli`.

---

## Product CLI Naming Contract

1. `gateway/src/cli` is the target source root for first-class product CLI code.
2. `dev-cli` is runner terminology only. It may appear in:
   - `scripts/run-ts-dev-cli.sh`
   - `scripts/run-ts-dev-cli.ps1`
   - `--ts-dev-cli`
   - TypeScript runner/cache labels such as `ts-dev-cli`
3. Do not introduce new product source under `entrypoints/dev-cli`.
4. `ts-dev-cli` means "source checkout TypeScript runner/cache path"; it is not
   a product architecture name.

---

## Module Organization Rules

1. Gateway `models/` holds canonical TS types and contracts.
2. Gateway `cli/*` owns product command surfaces, start/status/serve flows, and
   terminal UI after migration.
3. Gateway `orchestration/*` owns cross-domain composition and durable
   orchestrators, not CLI screen implementation details.
4. Gateway `tools/` provides adapters and persistence interfaces; core local
   execution belongs to runtime.
5. Gateway `extensions/contracts/*` holds executable product contracts. Large
   contract suites must be split by behavior surface, not accumulated in one
   smoke file.
6. Runtime `tools/*` implements local tool dispatch and safety checks.
7. Runtime `orchestration/*` controls turn pipeline and event sequence.
8. `.trellis/scripts/*` manages developer workflow only.

---

## Generated State Boundary

Committed `.grobot` files are source-of-truth skeletons only:

```text
.grobot/config.toml.example
.grobot/project.toml
.grobot/mcp.toml
.grobot/rules/**
.grobot/hooks/**
.grobot/*/README.md
```

Generated runtime state must stay untracked:

```text
.grobot/context/**
.grobot/experience/tenant/**
.grobot/memory/context-engine/*.json
.grobot/memory/context-engine/*.jsonl
.grobot/memory/v1/**
.grobot/runtime/*.json
.grobot/runtime/*.jsonl
.grobot/session/**
.grobot/sessions/*
.grobot/plans/*
.grobot/tmp/**
.grobot/wiki/shared/**
.grobot/wiki/users/**
```

If a new `.grobot` subdirectory is needed, decide up front whether it is
source-of-truth config/docs or generated runtime state, then update `.gitignore`
and `scripts/layer-contract-spec.json` in the same change.

---

## Naming Conventions

1. TypeScript files use kebab-case (`management-routes.ts`,
   `status-render.ts`). Kebab-case is acceptable for files.
2. Avoid long story prefixes. Prefer domain directories plus role files:
   - Prefer `tui/components/select-menu/render.ts`
   - Avoid adding more `run-start-select-menu-...ts` files
3. Rust module files use snake_case (`orchestrator.rs`, `session.rs`,
   `dispatcher/mod.rs`).
4. Python workflow scripts use snake_case (`add_session.py`, `task_context.py`).
5. Directory names should be stable domain nouns (`cli`, `tui`, `commands`,
   `services`, `models`, `tools`, `runtime`), not transient implementation
   labels (`dev-cli`, `project-config`) unless the directory truly represents a
   dev-only tool.
6. CLI command handlers use explicit verbs (`runStart`,
   `dispatchManagementRoutes`, `cmd_*` in Trellis scripts).

---

## File Size And Split Rules

1. New source files should normally stay below 800 lines.
2. Files above 1,500 lines require an explicit debt allowlist in
   `scripts/layer-contract-spec.json` until they are split.
3. Do not add new behavior to an already-oversized file unless the change also
   extracts a coherent submodule or updates the debt register with a migration
   reason.

---

## Examples

1. `gateway/src/cli/start/context.ts` (target): start-path context assembly and
   option resolution.
2. `gateway/src/cli/serve/management-routes.ts` (target): management API route
   dispatch.
3. `gateway/src/cli/main.ts`: source-checkout TypeScript runner entrypoint.
4. `runtime/src/orchestration/pipeline.rs`: turn pipeline
   (`turn_start -> model_* -> tool_* -> turn_end/fail`).
5. `runtime/src/tools/dispatcher/mod.rs`: tool dispatch table and enablement
   checks.
6. `.trellis/scripts/task.py`: workflow task lifecycle command entrypoint.
