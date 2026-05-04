# Directory Structure

> How CLI/TUI frontend interaction code is organized in this repository.

---

## Overview

For `grobot`, the current frontend surface is the developer-facing CLI/TUI.
This is product UI, not a temporary development helper. Its long-term home is
`gateway/src/cli/tui`.

The interaction layer boundary is:

1. `cli/start/*`: interactive flow composition and command routing.
2. `cli/tui/*`: terminal rendering, input controllers, menus, status rows, and
   prompt surfaces.
3. `tools/ask-user/*`: user-facing question protocol and display text.
4. `cli/services/*` and `cli/serve/*`: persistence/network adapters consumed by
   the interaction layer.

Current CLI files live under `gateway/src/cli/*`. The old
`gateway/src/orchestration/entrypoints/dev-cli/*` path is retired; do not
recreate it for UI modules or compatibility aliases.

---

## Target Directory Layout

```text
gateway/src/
├── cli/
│   ├── commands/
│   │   ├── cli/
│   │   └── slash/
│   ├── start/
│   │   ├── run.ts
│   │   ├── context.ts
│   │   ├── interactive-mode.ts
│   │   ├── interactive-bindings.ts
│   │   ├── turn.ts
│   │   ├── plan-mode.ts
│   │   └── session-interactive.ts
│   ├── status/
│   ├── serve/
│   ├── services/
│   └── tui/
│       ├── terminal/
│       │   ├── keyboard.ts
│       │   ├── raw-mode.ts
│       │   ├── screen-buffer.ts
│       │   ├── size.ts
│       │   └── stdin-events.ts
│       ├── components/
│       │   ├── prompt-input/
│       │   │   ├── contract.ts
│       │   │   ├── reducer.ts
│       │   │   ├── render.ts
│       │   │   ├── controller.ts
│       │   │   ├── turn-controller.ts
│       │   │   ├── turn-render-session.ts
│       │   │   ├── turn-state.ts
│       │   │   ├── input-buffer.ts
│       │   │   ├── attachments.ts
│       │   │   └── line-prompt.ts
│       │   ├── select-menu/
│       │   │   ├── contract.ts
│       │   │   ├── reducer.ts
│       │   │   ├── render.ts
│       │   │   ├── variants.ts
│       │   │   ├── controller.ts
│       │   │   ├── render-helpers.ts
│       │   │   └── transition.ts
│       │   ├── ask-user-panel/
│       │   │   ├── contract.ts
│       │   │   ├── reducer.ts
│       │   │   ├── render.ts
│       │   │   └── controller.ts
│       │   ├── status-line/
│       │   └── bottom-pane/
│       ├── theme/
│       └── kernel/
└── tools/
    └── ask-user/
        ├── schema.ts
        ├── resolver.ts
        ├── runtime.ts
        ├── protocol.ts
        └── display.ts
```

---

## Current Legacy Layout

Until migration completes, existing source may still be found under:

```text
gateway/src/cli/
├── start/
├── status/
├── serve/
├── services/
├── commands/
└── ui/
```

Do not use this legacy layout as the template for new interaction modules.

---

## Module Organization Rules

1. Keep start flow composition in `cli/start/*`; it should route modes and
   command handlers, not implement terminal primitives.
2. Keep terminal primitives in `cli/tui/terminal/*`.
3. Keep reusable UI surfaces in `cli/tui/components/<component>/`.
4. Each substantial TUI component should use role files:
   - `contract.ts`: types and public input/result contracts only.
   - `reducer.ts`: pure state transitions only.
   - `render.ts`: pure string/view-model rendering only.
   - `controller.ts`: stdin/stdout/raw-mode/timer/process IO only.
   - If a role still grows too large, split it into narrowly named internal
     files under the same component directory (`turn-controller.ts`,
     `turn-render-session.ts`, `input-buffer.ts`) instead of creating another
     cross-component "screen" or `run-start-*` module.
5. Keep style tokens in `cli/tui/theme/*` and render helpers. Do not scatter raw
   ANSI codes across start/status/serve orchestration files.
6. Keep session picker view-model separate from session execution flow.
7. Keep persistence/network concerns in `services/*` or `serve/*`; interaction
   modules consume interfaces, not low-level sockets/files directly.
8. Keep ask-user envelope parsing/normalization in `tools/ask-user/schema.ts`;
   resolution logic in `resolver.ts`; display text in `display.ts`.

---

## Naming Conventions

1. Use kebab-case TypeScript files for ordinary modules.
2. Use domain directories plus short role files for TUI components:
   - Prefer `components/select-menu/render.ts`
   - Prefer `components/prompt-input/controller.ts`
   - Prefer `components/ask-user-panel/reducer.ts`
   - Avoid new `run-start-select-menu-...ts` files
3. `run-start-*` names are legacy compatibility names. New code should shorten
   by directory context (`start/run.ts`, `start/turn.ts`, `start/context.ts`).
4. `dev-cli` is not an acceptable product source directory name for new modules.
   It may appear only in source-checkout runner scripts, flags, and cache labels.
5. Directory names express domain; file names express role.

---

## Monolith Split Rules

1. Do not add new behavior to `tui-compat.ts`; extract new terminal/component
   code into the target TUI structure or a migration submodule first.
2. Do not create new UI "screen" monoliths. A screen can compose components, but
   state transitions and render logic must remain split.
3. A component with keyboard handling must have a reducer-level contract test or
   an executable contract under `gateway/src/extensions/contracts/*`.
4. If a file grows beyond 800 lines, split by responsibility before adding new
   behavior.

---

## Examples

1. `gateway/src/cli/start/run.ts` (target): top-level interactive flow
   composition.
2. `gateway/src/cli/tui/components/select-menu/controller.ts` (target):
   keyboard loop and cancellation handling for select menus.
3. `gateway/src/cli/tui/components/select-menu/render.ts` (target): menu
   view-model to terminal string rendering.
4. `gateway/src/cli/tui/components/select-menu/transition.ts` (target):
   menu open/close frame timing and terminal surface clearing.
5. `gateway/src/cli/tui/components/prompt-input/reducer.ts` (target): prompt
   input state transitions.
6. `gateway/src/cli/tui/components/prompt-input/turn-render-session.ts`
   (target): one prompt-input turn's terminal render lifecycle.
7. `gateway/src/cli/tui/components/prompt-input/input-buffer.ts` (target):
   prompt buffer cursor, paste, inline-image-token, and active-line utilities.
8. `gateway/src/cli/tui/components/ask-user-panel/controller.ts` (target):
   questionnaire panel raw-mode lifecycle and submit/cancel control flow.
9. `gateway/src/tools/ask-user/schema.ts`: ask-user envelope normalization from
   runtime payloads.
