# Hook Guidelines

> Hook-equivalent composition patterns for the CLI/TUI interaction layer.

---

## Overview

Most frontend flow code is not browser React state. React/Ink is now used for
terminal rendering adapters under `gateway/src/cli/tui/react/` (startup, menu,
prompt, status, bottom-pane, ask-user), while equivalent reuse patterns for the
rest of the interaction layer remain stateful factories and context builders:

1. Factory objects encapsulating mutable runtime state.
2. Context builders deriving turn inputs from existing runtime/session state.
3. Service controllers that centralize async IO and fallback decisions.

---

## Custom Hook Patterns

1. Use `create*` factories to encapsulate mutable internal state and expose controlled getters/setters.
   - Example: `createRunStartRuntimeState()` keeps session/history/provider/plan state private.
2. Use dedicated store classes for scoped pending interaction state.
   - Example: `AskUserSessionStore` manages pending ask-user envelopes by `sessionKey`.
3. Use context builders for per-turn derived prompt state.
   - Example: `createAskUserTurnPromptContext()` resolves pending ask and returns prompt parts.

---

## Data Fetching

1. Keep remote or file-backed IO behind explicit adapters (`redisGetJson`, `redisSetJson`, file loaders).
2. Centralize fallback logic in store controllers, not in command handlers.
   - Example: `createSessionStoreController()` falls back from redis to file with explicit warnings.
3. Never perform fetch/persistence calls in display or parse-only helpers.
4. Keep data fetch behavior observable with warning propagation (`writeStoreWarnings`).

---

## Naming Conventions

1. `create*`: stateful/runtime factories (`createRunStartInteractiveHandler`, `createRunStartWire`).
2. `build*`/`format*`: pure transforms (`buildInteractiveHelpText`, `formatAskUserResolvedEvent`).
3. `resolve*`/`normalize*`/`parse*`: boundary normalization and validation (`resolveMemoryStoreRuntime`, `normalizeAskUserEnvelope`).
4. Avoid `use*` naming outside actual React/Ink hook files. Non-React terminal
   flow helpers should keep `create*`, `build*`, `resolve*`, or `normalize*`
   naming.

---

## Common Mistakes

1. Introducing module-global mutable maps for session-scoped state.
2. Mixing normalization and side effects in the same function.
3. Returning untyped `{}` payloads from factories instead of explicit interfaces.
4. Swallowing fetch failures without fallback reason or warning output.

---

## Examples

1. `gateway/src/cli/start/runtime-state.ts`
2. `gateway/src/cli/services/session-store.ts`
3. `gateway/src/tools/ask-user/runtime.ts`
4. `gateway/src/tools/ask-user/resolver.ts`
5. `gateway/src/cli/start/interactive-bindings.ts`
