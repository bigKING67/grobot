# State Management

> How interaction state is managed in `grobot` CLI/TUI frontend.

---

## Overview

State is partitioned by lifecycle and ownership.
There is no browser client store library here; we use typed runtime objects plus persistence controllers.

---

## State Categories

1. **Ephemeral turn state**
   - Scope: current command handling call stack.
   - Example: parsed command action in `dispatchSessionInteractiveInput()`.
2. **Session runtime state (in-memory)**
   - Scope: active interactive process.
   - Owner: `createRunStartRuntimeState()`.
   - Data: active session id/key, history rows, sticky provider, plan metadata, GA state.
3. **Persisted session state**
   - Scope: across process restarts.
   - Owner: `SessionStoreController` + session/history serializers.
   - Backends: `file` or `redis` with runtime fallback.
4. **Pending ask-user state**
   - Scope: per-session pending question.
   - Owner: `AskUserSessionStore`.

---

## When To Promote State To Shared Runtime

Promote data from local variables to runtime/shared state only when at least one is true:

1. It must survive multiple commands in the same session.
2. It must be visible to both interaction handler and persistence layer.
3. It is required to restore continuity after session switch/continue operations.

If none apply, keep it local to the command/handler function.

---

## Server State And Persistence

1. Persistence entrypoint is `createSessionStoreController()` with typed load/save methods.
2. Runtime backend selection comes from CLI/env/project config via `resolveMemoryStoreRuntime()`.
3. Redis is optional and may fall back to file with explicit `fallbackReason`.
4. History/session registry writes must stay coordinated when session identity changes.

---

## Common Mistakes

1. Updating `activeSessionId` without also syncing `sessionKey` and restored history.
2. Mutating registry/runtime state but skipping `persistSessionRegistryState()` or `persistHistoryState()`.
3. Treating redis failure as silent success instead of surfacing fallback warnings.
4. Using process-global state for data that should be keyed by `sessionKey`.

---

## Examples

1. `gateway/src/orchestration/entrypoints/dev-cli/start/run-start-runtime-state.ts`
2. `gateway/src/orchestration/entrypoints/dev-cli/start/run-start-session-ops.ts`
3. `gateway/src/orchestration/entrypoints/dev-cli/services/session-store.ts`
4. `gateway/src/orchestration/entrypoints/dev-cli/serve/memory-store-runtime.ts`
5. `gateway/src/tools/ask-user/resolver.ts`
