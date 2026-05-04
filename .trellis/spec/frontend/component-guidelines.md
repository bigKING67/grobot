# Component Guidelines

> How terminal-facing interaction components are built in this project.

---

## Overview

This repository does not use React/Vue components for the current frontend surface.
Our "components" are CLI/TUI interaction modules composed from:

1. Typed input contract (`interface ...Input`).
2. Pure view-model or formatter function (`build*`, `format*`, `parse*`).
3. Effectful runner that executes interaction (`run*`, `open*`, `dispatch*`).

---

## Component Structure

Use a four-role structure for each substantial interaction component:

1. **Contract role (`contract.ts`)**: define explicit input/result/state types.
2. **Reducer role (`reducer.ts`)**: pure state transitions only.
3. **Render role (`render.ts`)**: derive render strings/view-models without IO
   side effects.
4. **Controller role (`controller.ts`)**: handle stdin/stdout, raw mode,
   keyboard events, timers, process lifecycle, and cancellation.

Legacy files such as `tui-compat.ts` may still contain several roles during
migration, but they are not the model for new code.

### Select Menu Current Contract

The shared terminal select-menu is now owned by
`gateway/src/cli/tui/components/select-menu/`.

Public imports should use these role files directly:

1. `contract.ts`: `TerminalSelectMenuInput`, `TerminalSelectMenuItem`,
   `TerminalSelectMenuResult`, and inline-input/result unions.
2. `reducer.ts`: pure keyboard/navigation/search reducers such as
   `decodeMenuInput`, `resolveTerminalSelectMenuViewport`,
   `reduceTerminalSelectMenuInlineInput`, and digit/search matching helpers.
3. `render.ts`: `renderTerminalSelectMenu()` only; no stdin/stdout or
   environment mutation.
4. `render-helpers.ts`: pure menu render shared helpers and constants; no
   stdin/stdout or environment mutation.
5. `transition.ts`: terminal frame surface, open/close transition timers, and
   transition env parsing.
6. `controller.ts`: `runTerminalSelectMenu()` and terminal lifecycle behavior.

`gateway/src/cli/tui/screens/select-menu-screen.ts` is only a compatibility
re-export while legacy imports are removed. Do not add new behavior there.
`gateway/src/cli/start/tui-compat.ts` must not be used as the owner or import
surface for select-menu code.

### Prompt Input Current Contract

The interactive session prompt is owned by
`gateway/src/cli/tui/components/prompt-input/`.

Public imports should use these role files directly:

1. `contract.ts`: prompt input types, inline image token constants, shortcut
   result unions, and `TerminalLinePromptResult`.
2. `attachments.ts`: inline image attachment registry, clipboard image capture,
   and `[Image #n]` resolution helpers.
3. `reducer.ts`: pure keyboard/shortcut/slash-suggestion decisions such as
   `resolveSubmitKeyAction()` and `resolveSlashSuggestionKeyAction()`.
4. `render.ts`: input chrome, submitted transcript, slash-token highlight, and
   footer/body width calculations.
5. `input-buffer.ts`: prompt buffer cursor math, bracketed paste marker
   cleanup, inline-image-token deletion, active-line replacement, and vertical
   cursor movement.
6. `turn-state.ts`: the per-turn mutable state shape and initial state factory.
7. `turn-render-session.ts`: one prompt-input turn's render lifecycle
   (`render()`, submit transcript replacement, cursor-to-output movement).
8. `turn-controller.ts`: one raw prompt-input turn's event loop and key/data
   routing; it may call terminal IO but should not own render string
   construction.
9. `line-prompt.ts`: readline-backed single-line prompt helper.
10. `controller.ts`: `runSessionInputLoop()` and stable prompt-input public
   entrypoints; it owns raw mode handoff, handler lifecycle, and turn-loop
   composition.

`gateway/src/cli/start/tui-compat.ts` is only a compatibility re-export plus
handoff helper surface. New prompt-input imports must not use it.

### Ask User Panel Current Contract

The human-in-the-loop questionnaire TUI panel is owned by
`gateway/src/cli/tui/components/ask-user-panel/`.

Public imports should use these role files directly:

1. `contract.ts`: `TerminalAskUserQuestionnairePanelInput`,
   `TerminalAskUserQuestionnairePanelResult`, and
   `AskUserPanelInputAction`.
2. `reducer.ts`: pure panel keyboard decoding and index/text synchronization
   helpers, including `decodeAskUserPanelInput()`.
3. `render.ts`: `renderAskUserPanelScreen()` only; no stdin/stdout or process
   mutation.
4. `controller.ts`: `runAskUserQuestionnairePanel()` and raw-mode lifecycle.

`gateway/src/cli/tui/screens/ask-user-panel-screen.ts` is only a compatibility
re-export while legacy imports are removed. Do not add new behavior there.
`gateway/src/cli/start/tui-compat.ts` must not be used as the owner or import
surface for ask-user panel code.

---

## Props Conventions

1. Prefer a single typed object input over positional parameters for interaction runners.
2. Use discriminated union results for control flow (`{ kind: "selected" | "cancelled" }`).
3. Keep optional fields explicit (`subtitle?: string`, `hint?: string`) and provide defaults in builder functions.
4. Preserve user-visible identifiers in display models (session id, updated time, current marker).

---

## Styling Patterns

1. Terminal styling uses ANSI escape sequences only in rendering functions.
2. Keep style tokens local to renderers (`\x1b[92m`, `\x1b[96m`) and avoid scattering color codes across orchestration logic.
3. Keep output textual and parseable for logs where possible (`[session] ...`, `[ask-user] ...` prefixes).
4. Prefer concise, line-based layout for menus/prompts to support both human reading and scripting.

## CLI/TUI Role Boundaries

1. `render.ts` must be pure. It must not read files, call network APIs, mutate
   process state, write to stdout/stderr, or inspect live stdin.
2. `reducer.ts` must be pure. It must not depend on wall-clock time unless time
   is passed as input, and it must not perform IO.
3. `controller.ts` owns effectful terminal work: stdin, stdout, stderr, raw mode,
   timers, process signals, and cancellation.
4. `contract.ts` exports types, discriminated unions, constants that define
   public component contract, and no effectful runtime code.
5. Do not add new behavior to `tui-compat.ts`. Extract a cohesive terminal or
   component module first, then wire the legacy export to it if compatibility is
   required.
6. Do not create new UI "screen" monoliths. A screen may compose components, but
   component state, rendering, and IO control must remain split.
7. Shared prompt, menu, status, and bottom-pane surfaces must have one owner for
   each terminal slot. Do not append ad hoc lines from unrelated turn-output
   code.

## Prompt Slot Ownership

1. The active input loop owns the prompt-bottom slot. Status, idle hints, pending ask summaries, shortcut overlays, and slash suggestions must not be appended ad hoc from unrelated turn-output code.
2. Use `resolvePromptSlotState()` and the input-loop footer resolver before rendering footer/status lines. Slash suggestions, shortcut overlays, history search, select menus, pending asks, and running activity must preempt the ordinary status slot in that priority order. Focused surfaces may still render a passive secondary status row when width allows; pending ask footers must not drop the persistent model/context/session/plan signal on normal-width terminals.
3. Plan ready-to-code approval in interactive mode must use the shared select-menu focus path (`runTerminalSelectMenu`) with the `plan_approval` variant. Do not emulate approval by printing Yes/No text while leaving the normal prompt active.
4. Submitted transcript output must stay input-only: never include status/footer lines in the finalized user input block.
5. Runtime activity feed diagnostics must stay separate from the final assistant answer. If a debug transcript feed is enabled, write it as a separate output segment and keep it out of conversation history.
6. Terminal Markdown rendering must be gated (`off`/`basic`/future `rich`) and must preserve copyable Markdown structure where practical, especially heading markers and fenced code blocks.

---

## Accessibility And Operator Ergonomics

1. Always provide keyboard alternatives beyond arrow keys where practical (`j/k` in menu navigation).
2. Always provide a cancel path (`Esc`, `Ctrl+C`, or explicit command fallback).
3. For non-TTY mode, return clear usage guidance instead of attempting interactive render.
4. Include explicit hint lines for commands and menu controls.

---

## Common Mistakes

1. Mixing persistence calls into renderer/view-model functions.
2. Returning loosely typed objects instead of result unions.
3. Omitting cancel branch handling and leaving interactive loop hanging.
4. Hardcoding display strings in multiple files instead of centralizing formatters.
5. Adding more `run-start-*` files for a UI component instead of creating a
   domain directory with role files.
6. Treating `dev-cli` as a product architecture name instead of legacy runner
   compatibility terminology.

---

## Examples

1. `gateway/src/cli/tui/components/select-menu/contract.ts` (target)
2. `gateway/src/cli/tui/components/select-menu/reducer.ts` (target)
3. `gateway/src/cli/tui/components/select-menu/render.ts` (target)
4. `gateway/src/cli/tui/components/select-menu/transition.ts` (target)
5. `gateway/src/cli/tui/components/select-menu/controller.ts` (target)
6. `gateway/src/cli/tui/components/prompt-input/controller.ts` (target)
7. `gateway/src/cli/tui/components/ask-user-panel/controller.ts` (target)
8. `gateway/src/tools/ask-user/display.ts`
