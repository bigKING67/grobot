# Directory Structure

> How backend code is organized in this repository.

---

## Overview

`grobot` keeps strict separation between product runtime code and workflow automation code.

- Product backend: `gateway/` (TypeScript) + `runtime/` (Rust)
- Workflow backend: `.trellis/scripts/` (Python)

Do not mix product execution logic into Trellis scripts.

---

## Directory Layout

```text
gateway/
└── src/
    ├── models/
    ├── tools/
    ├── extensions/
    ├── orchestration/
    │   ├── entrypoints/dev-cli/
    │   │   ├── start/
    │   │   ├── serve/
    │   │   ├── services/
    │   │   └── status/
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
    │   ├── mcp/
    │   ├── bash/
    │   └── semantic/
    ├── extensions/
    ├── orchestration/
    └── governance/

.trellis/
└── scripts/
    ├── task.py
    ├── add_session.py
    ├── common/
    └── multi_agent/
```

---

## Module Organization Rules

1. Gateway `models/` holds canonical TS types and contracts.
2. Gateway `orchestration/entrypoints/dev-cli/*` composes command flows, not low-level execution details.
3. Gateway `tools/` provides adapters and persistence interfaces; core execution belongs to runtime.
4. Runtime `tools/*` implements local tool dispatch and safety checks.
5. Runtime `orchestration/*` controls turn pipeline and event sequence.
6. `.trellis/scripts/*` manages developer workflow only (task/session/context automation).

---

## Naming Conventions

1. TypeScript files: kebab-case (`run-start-context.ts`, `management-routes.ts`).
2. Rust module files: snake_case (`orchestrator.rs`, `session.rs`, `dispatcher/mod.rs`).
3. Python workflow scripts: snake_case (`add_session.py`, `task_context.py`).
4. CLI command handlers use explicit verbs (`runStart`, `dispatchManagementRoutes`, `cmd_*` in Trellis scripts).

---

## Examples

1. `gateway/src/orchestration/entrypoints/dev-cli/start/run-start-context.ts`: start-path context assembly and option resolution.
2. `gateway/src/orchestration/entrypoints/dev-cli/serve/management-routes.ts`: management API route dispatch.
3. `runtime/src/orchestration/pipeline.rs`: turn pipeline (`turn_start -> model_* -> tool_* -> turn_end/fail`).
4. `runtime/src/tools/dispatcher/mod.rs`: tool dispatch table and enablement checks.
5. `.trellis/scripts/task.py`: workflow task lifecycle command entrypoint.
