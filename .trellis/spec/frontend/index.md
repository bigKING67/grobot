# Frontend Development Guidelines

> Standards for developer-facing frontend interaction in `grobot`.

---

## Overview

This repository currently has no browser page package (no active `packages/web-ui` implementation path).
In `grobot`, "frontend" means the **interactive CLI/TUI surface** used by developers:

1. Command parsing and interaction flow in `gateway/src/orchestration/entrypoints/dev-cli/start/*`.
2. Terminal rendering and menu interaction in `run-start-io.ts` and `run-start-session-menu.ts`.
3. Human-in-the-loop question/answer UX in `gateway/src/tools/ask-user/*`.

These guidelines define how to keep that interaction layer predictable, type-safe, and maintainable.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and interaction-layer layout | Updated v1.0 (2026-04-16) |
| [Component Guidelines](./component-guidelines.md) | Terminal component patterns, contracts, composition | Updated v1.0 (2026-04-16) |
| [Hook Guidelines](./hook-guidelines.md) | Hook-equivalent factory/context patterns and side-effect boundaries | Updated v1.0 (2026-04-16) |
| [State Management](./state-management.md) | Session/runtime/store state partition and promotion rules | Updated v1.0 (2026-04-16) |
| [Quality Guidelines](./quality-guidelines.md) | Interaction-layer quality gates and verification checklist | Updated v1.0 (2026-04-16) |
| [Type Safety](./type-safety.md) | Type organization, normalization, and forbidden typing shortcuts | Updated v1.0 (2026-04-16) |

---

## Pre-Development Checklist

1. Confirm your change belongs to the interaction layer (`start/*` or `tools/ask-user/*`) and not runtime core (`runtime/src/*`).
2. Read `directory-structure.md` and `component-guidelines.md` before adding new command/menu/display code.
3. If changing session or persistence behavior, read `state-management.md` and backend `database-guidelines.md`.
4. If introducing new input payload parsing, read `type-safety.md` and ensure normalization is explicit.
5. Keep docs and code synchronized when adding new command modes or output formats.

---

## Maintenance Rules

1. Document current behavior, not desired future architecture.
2. Use real file paths from `gateway/src/orchestration/entrypoints/dev-cli/*` and `gateway/src/tools/ask-user/*`.
3. Keep "frontend" scope aligned with CLI/TUI interaction semantics until browser UI is added.
4. When browser UI modules are introduced later, split this index into `cli-frontend` and `web-frontend` sections instead of mixing conventions.

---

**Language**: Keep these frontend guidelines in English for cross-agent consistency.
