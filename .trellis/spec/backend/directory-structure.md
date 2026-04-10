# Directory Structure

> How backend code is currently organized in this repository.

---

## Overview

This repository now has both:

1. Product backend skeleton:
   - `gateway/` (TypeScript)
   - `runtime/` (Rust)
2. Workflow backend tooling:
   - `.trellis/scripts/` (Python)

Design rule: business/runtime code and workflow tooling must stay separated.

---

## Directory Layout

```text
gateway/
└── src/
    ├── main.ts
    ├── session-key.ts
    └── types.ts

runtime/
└── src/
    └── main.rs

.trellis/
├── scripts/
│   ├── task.py
│   ├── get_context.py
│   ├── add_session.py
│   ├── common/
│   └── multi_agent/
├── tasks/
└── spec/
```

---

## Module Organization

Use these placement rules:

1. Gateway transport/session contracts go under `gateway/src/`.
2. Runtime execution/scheduler primitives go under `runtime/src/`.
3. Trellis automation logic stays in `.trellis/scripts/`.
4. Shared workflow constants stay in `.trellis/scripts/common/paths.py`.

Do not mix runtime business concerns into Trellis workflow scripts.

---

## Naming Conventions

1. Python modules/files: `snake_case`.
2. TypeScript modules/files: `kebab-case` or `snake_case`, consistent per package.
3. Rust modules/files: `snake_case` (standard Rust style).
4. Workflow command handlers in `task.py`: `cmd_<action>`.

---

## Examples

1. `gateway/src/session-key.ts`: canonical SessionKey build/parse contract.
2. `runtime/src/main.rs`: runtime bootstrap and config baseline.
3. `.trellis/scripts/task.py`: command-router style workflow CLI.
4. `.trellis/scripts/common/paths.py`: shared workflow path constants.
