# Backend Development Guidelines

> Standards for backend and platform engineering in `grobot`.

---

## Overview

Backend work in this repo currently spans two tracks:

1. Product platform skeleton:
   - `gateway/` (TypeScript contracts/orchestration entry)
   - `runtime/` (Rust runtime core skeleton)
2. Trellis workflow tooling:
   - `.trellis/scripts/` and `.trellis/scripts/common/`

These guides are bootstrapped and ready for active development.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Bootstrapped v0.2 (2026-04-09) |
| [Database Guidelines](./database-guidelines.md) | Persistence contracts, migration strategy | Bootstrapped v0.2 (2026-04-09) |
| [Error Handling](./error-handling.md) | Error types, handling strategies | Bootstrapped v0.2 (2026-04-09) |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | Bootstrapped v0.2 (2026-04-09) |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging and event observability | Bootstrapped v0.2 (2026-04-09) |

---

## How To Use During Development

1. Before coding backend changes, read:
   - `directory-structure.md`
   - `quality-guidelines.md`
2. If changing persistence/state behavior, also read `database-guidelines.md`.
3. If changing failure paths or command/runtime outputs, read both:
   - `error-handling.md`
   - `logging-guidelines.md`
4. In the same PR, update relevant guide sections when a new stable pattern is introduced.

---

## Maintenance Rules

1. Keep docs aligned with actual code, not planned ideals.
2. When introducing DB integrations, update `database-guidelines.md` before or in the same change.
3. When adding new runtime events, update `logging-guidelines.md` and shared contracts together.

---

**Language**: Documentation should remain in **English** for cross-agent consistency.
