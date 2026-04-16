# Directory Structure

> How frontend interaction code is organized in this repository.

---

## Overview

For `grobot`, frontend code lives inside gateway CLI/TUI modules.
The boundary is:

1. `start/*`: interactive flow composition and command routing.
2. `tools/ask-user/*`: user-facing question protocol and display text.
3. `services/*` and `serve/*`: persistence/network adapters consumed by the interaction layer.

---

## Directory Layout

```text
gateway/src/
├── orchestration/entrypoints/dev-cli/
│   ├── start/
│   │   ├── run-start.ts
│   │   ├── run-start-interactive-mode.ts
│   │   ├── run-start-interactive-handler.ts
│   │   ├── run-start-io.ts
│   │   ├── run-start-session-menu.ts
│   │   ├── run-start-session-menu-ops.ts
│   │   ├── run-start-session-ops.ts
│   │   ├── run-start-runtime-state.ts
│   │   └── session-interactive.ts
│   ├── services/
│   │   ├── session-store.ts
│   │   ├── memory-store-config.ts
│   │   └── redis-client.ts
│   └── serve/
│       └── memory-store-runtime.ts
└── tools/
    └── ask-user/
        ├── schema.ts
        ├── resolver.ts
        ├── runtime.ts
        ├── protocol.ts
        └── display.ts
```

---

## Module Organization Rules

1. Keep `start/*` focused on interaction orchestration (command parsing, menus, mode switching).
2. Keep terminal input/render primitives in `run-start-io.ts`; do not duplicate raw-mode/key decoding elsewhere.
3. Keep session picker view-model in `run-start-session-menu.ts` and execution flow in `run-start-session-menu-ops.ts`.
4. Keep persistence/network concerns in `services/*` or `serve/*`; interaction modules consume interfaces, not low-level sockets/files directly.
5. Keep ask-user envelope parsing/normalization in `tools/ask-user/schema.ts`; resolution logic in `resolver.ts`; display text in `display.ts`.

---

## Naming Conventions

1. Use kebab-case TypeScript files across interaction modules (`run-start-io.ts`, `run-start-wire.ts`).
2. Use `run-start-*` prefix for start pipeline modules.
3. Use `session-*` prefix for session domain files (`session-interactive.ts`, `session-registry.ts`, `session-history.ts`).
4. Use verb-based helpers:
   - `create*` for stateful factories (`createRunStartRuntimeState`).
   - `build*`/`format*` for pure render/model builders (`buildSessionMenuViewModel`, `formatAskUserIssuedEvent`).
   - `resolve*`/`normalize*` for boundary normalization (`resolveMemoryStoreRuntime`, `normalizeAskUserEnvelope`).

---

## Examples

1. `gateway/src/orchestration/entrypoints/dev-cli/start/run-start.ts`: top-level interactive flow composition.
2. `gateway/src/orchestration/entrypoints/dev-cli/start/run-start-io.ts`: reusable terminal input loop and menu renderer.
3. `gateway/src/orchestration/entrypoints/dev-cli/start/run-start-session-menu.ts`: menu view-model and item formatting.
4. `gateway/src/orchestration/entrypoints/dev-cli/services/session-store.ts`: session persistence abstraction with fallback behavior.
5. `gateway/src/tools/ask-user/schema.ts`: ask-user envelope normalization from runtime payloads.
