# Database Guidelines

> Persistence patterns currently used by this repository.

---

## Overview

Current persistence has two layers:

1. Active layer (implemented now): file-state under `.trellis/` (JSON/JSONL/Markdown).
2. Planned runtime layer (declared in `.grobot/project.toml`): Redis stream + Postgres durable state.

Until runtime storage code is implemented, file-state contracts remain the source
of truth for task/workflow state.

---

## Query Patterns

Current read/write patterns:

1. Read JSON with explicit error fallback (missing/corrupt file should not crash bootstrap flows).
2. Validate task paths before file operations to block absolute/path-traversal input.
3. Keep task metadata in `task.json` and append operational context in `*.jsonl`.

Operational rules:

1. Do not introduce ad-hoc state files at repo root.
2. Keep workflow state under `.trellis/`.
3. Keep runtime storage wiring behind explicit gateway/runtime modules.

---

## Migrations

Current migration model is schema-by-script:

1. Add new keys in `task.json`/registry/config with backward-tolerant readers.
2. Update corresponding scripts in `.trellis/scripts/common/` and command docs.
3. Validate with `python3 ./.trellis/scripts/task.py validate <task-dir>` when context files change.

When DB integration starts:

1. Add migration tooling per runtime package.
2. Version schema changes and include rollback notes.
3. Do not mix DB migration logic into `.trellis/scripts/common/*`.

---

## Naming Conventions

1. Workflow directories/files use constants from `common/paths.py`.
2. Task metadata uses stable JSON keys (for example, `id`, `status`, `createdAt`, `subtasks`).
3. Context lists use `.jsonl` (`implement/check/debug`) with one JSON record per line.
4. Runtime storage settings in `.grobot/project.toml` use explicit sections (`[runtime.queue]`, `[runtime.storage]`).

---

## Common Mistakes

1. Skipping path-safety checks before archive/move operations.
2. Adding new JSON keys without updating read/write call sites and docs together.
3. Treating file read errors as hard crashes instead of controlled fallbacks.
4. Defining queue/storage target in config but not reflecting it in module boundaries.

---

## Examples

1. `.trellis/scripts/common/task_utils.py`: safe task path validation and archive behavior.
2. `.trellis/scripts/common/config.py`: config read with defensive fallback.
3. `.trellis/tasks/00-bootstrap-guidelines/task.json`: canonical task metadata shape.
4. `.grobot/project.toml`: planned runtime queue/storage contract (`redis_stream` + `postgres`).
