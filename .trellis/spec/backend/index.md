# Backend Development Guidelines

> Standards for backend and platform engineering in `grobot`.

---

## Overview

Backend development in this repository spans three cooperating layers:

1. Gateway (TypeScript): request orchestration, management APIs, session/persistence adapters.
2. Runtime (Rust): model/tool execution pipeline and normalized runtime event emission.
3. Workflow tooling (Python in `.trellis/scripts`): task/session workflow automation.

The product architecture follows `4 execution layers + 1 governance plane` in both gateway and runtime:
`models -> tools -> extensions -> orchestration`, plus `governance` for eval and policy gates.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module boundaries and file layout | Updated v1.0 (2026-04-16) |
| [Database Guidelines](./database-guidelines.md) | State persistence contracts (`file` / `redis`) and migration rules | Updated v1.0 (2026-04-16) |
| [Error Handling](./error-handling.md) | Failure taxonomy, propagation, and operator-facing errors | Updated v1.0 (2026-04-16) |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, review checks, and verification commands | Updated v1.0 (2026-04-16) |
| [Logging Guidelines](./logging-guidelines.md) | Runtime/CLI observability and redaction requirements | Updated v1.0 (2026-04-16) |

---

## Pre-Development Checklist

1. Identify touched layer(s): `gateway`, `runtime`, and/or `.trellis/scripts`.
2. Read `directory-structure.md` and `quality-guidelines.md` first.
3. If state/config/session behavior changes, also read `database-guidelines.md`.
4. If error/event/log behavior changes, also read `error-handling.md` and `logging-guidelines.md`.
5. Keep contracts and docs synchronized in the same change.

---

## Maintenance Rules

1. Document current behavior, not planned behavior.
2. Use real code paths in examples (no placeholder paths).
3. When adding new persistent state fields, update type definitions and load/save paths together.
4. When introducing new runtime events or error classes, update both docs and contracts in one PR.

---

**Language**: Keep these backend guidelines in English for cross-agent consistency.
