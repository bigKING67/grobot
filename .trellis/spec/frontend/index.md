# Frontend Development Guidelines

> Bootstrap frontend standards for `grobot`.

---

## Overview

This repo does not yet contain a production frontend package. These guides are
bootstrapped so the first UI modules can be implemented with consistent rules.

Current focus:

1. Freeze UI engineering standards before code explosion.
2. Keep cross-layer compatibility with gateway/runtime contracts.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Bootstrapped v0.2 (2026-04-09) |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | Bootstrapped v0.2 (2026-04-09) |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks and data-flow patterns | Bootstrapped v0.2 (2026-04-09) |
| [State Management](./state-management.md) | Local/global/server state boundaries | Bootstrapped v0.2 (2026-04-09) |
| [Quality Guidelines](./quality-guidelines.md) | Code standards and review checklist | Bootstrapped v0.2 (2026-04-09) |
| [Type Safety](./type-safety.md) | Type and runtime validation policy | Bootstrapped v0.2 (2026-04-09) |

---

## How To Use During Development

1. Before first UI module implementation, read all six guides once.
2. For each UI task, at minimum re-read:
   - `component-guidelines.md`
   - `type-safety.md`
   - `quality-guidelines.md`
3. For cross-layer features, always pair with:
   - `.trellis/spec/guides/cross-layer-thinking-guide.md`
   - `.trellis/spec/guides/agent-gateway-runtime-guide.md`
4. Update these docs when stable UI patterns emerge in actual code.

---

## Maintenance Rules

1. Do not keep "planned-only" guidance once real UI code exists.
2. Replace bootstrap assumptions with concrete code examples in the same PR that introduces them.
3. Keep terminology aligned with `.grobot/project.toml` and shared contracts.

---

**Language**: Documentation should remain in **English** for cross-agent consistency.
