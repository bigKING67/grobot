# Directory Structure

> Frontend structure conventions for this repository at bootstrap stage.

---

## Overview

As of 2026-04-09, no dedicated frontend application package is present yet.
Frontend standards are pre-defined so the first UI package can start cleanly.

---

## Directory Layout

Current state:

```text
.trellis/spec/frontend/      # frontend standards (source of truth for new UI code)
.trellis/spec/guides/        # cross-layer design/runtime/memory constraints
README.md                    # product goals and architecture boundary
```

Target layout once frontend implementation starts:

```text
web-ui/
├── src/
│   ├── pages/
│   ├── components/
│   ├── hooks/
│   ├── state/
│   └── types/
└── README.md
```

---

## Module Organization

When frontend code is created:

1. Keep page-level orchestration under `pages/` (or route modules).
2. Keep reusable UI blocks under `components/`.
3. Keep reusable stateful logic under `hooks/`.
4. Keep shared domain contracts in `types/` and state models in `state/`.

Do not place business-critical cross-layer contracts only in UI files; mirror
them in `shared/contracts/` plus `.trellis/spec/guides/` once stable.

---

## Naming Conventions

1. Files/folders: lowercase `kebab-case` or `snake_case`, consistent within package.
2. Components: `PascalCase` file names and exported symbols.
3. Hooks: `useXxx` naming.
4. Shared types: descriptive domain names; avoid `misc`/`utils` type dumping.

---

## Examples (Current Evidence)

1. `README.md`: TypeScript + Rust boundary implies UI should remain gateway-facing and contract-driven.
2. `.grobot/project.toml`: channel/session/runtime contract source that UI should visualize and control.
3. `.trellis/spec/guides/agent-platform-blueprint.md`: architecture boundary for future web surfaces.
