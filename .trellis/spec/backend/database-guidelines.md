# Database Guidelines

> Persistence and state-management conventions currently used by `grobot`.

---

## Overview

Current state persistence uses a hybrid model:

1. File-first stores under `.grobot/` for local/default runtime.
2. Optional Redis-backed hot state (`session store` / `memory store`) with file fallback.
3. Runtime durable storage targets declared in config (`.grobot/project.toml`) for phased rollout.

There is no global ORM layer yet; persistence is explicit and module-scoped.

---

## Active State Stores

1. Session/history store selection and fallback logic:
   - `gateway/src/cli/services/session-store.ts`
2. Memory store encode/decode + redis/file bootstrap:
   - `gateway/src/cli/serve/memory-store-runtime.ts`
3. Redis URL parsing and JSON payload IO helpers:
   - `gateway/src/cli/services/redis-client.ts`
4. Runtime/config source resolution (`CLI > env > project toml > default`):
   - `gateway/src/cli/services/memory-store-config.ts`
   - `gateway/src/cli/services/runtime-paths.ts`

---

## Read/Write Patterns

1. Parse external config defensively and normalize values before use.
2. Persist typed payload objects, not raw arbitrary strings.
3. On redis read/write failure, degrade to file mode with explicit warning (`fallbackReason`).
4. Keep key naming deterministic (`grobot:ts-dev-cli:*`) to avoid collisions.
5. Preserve version field in persisted payloads (for example `version: 1` in memory store).

---

## Migration Rules

1. Additive schema changes only unless a migration path is documented.
2. If introducing new fields, update:
   - type definitions,
   - decode/normalize logic,
   - encode/save logic,
   - status/config response surfaces.
3. Keep backward tolerance when loading older payloads.
4. For runtime storage changes, update `.grobot/project.toml` docs and bootstrap behavior in the same PR.

---

## Naming Conventions

1. Storage backend enum values: lowercase literals (`"file"`, `"redis"`).
2. Runtime metadata fields use explicit source/fallback naming (`source`, `requestedBackend`, `fallbackReason`).
3. Session/memory keys include project/session namespace context.

---

## Common Mistakes

1. Writing persistence code that assumes Redis always succeeds.
2. Updating payload shape without updating decode path.
3. Silent fallback without operator-visible warning.
4. Introducing ad-hoc state files outside `.grobot/`.

---

## Examples

1. `gateway/src/cli/services/session-store.ts`
2. `gateway/src/cli/serve/memory-store-runtime.ts`
3. `gateway/src/cli/services/memory-store-config.ts`
4. `gateway/src/cli/services/redis-client.ts`
5. `.grobot/project.toml`
