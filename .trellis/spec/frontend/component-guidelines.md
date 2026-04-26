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

Use a three-layer structure for each interaction component:

1. **Contract layer**: define explicit input/result types.
   - Example: `TerminalSelectMenuInput`, `TerminalSelectMenuResult` in `run-start-io.ts`.
2. **Pure transform layer**: derive render strings/view-model without IO side effects.
   - Example: `terminalSelectMenuRender()` and `buildSessionMenuViewModel()`.
3. **Execution layer**: handle stdin/stdout, keyboard events, and cancellation.
   - Example: `runTerminalSelectMenu()` and `runSessionMenuPicker()`.

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

## Prompt Slot Ownership

1. The active input loop owns the prompt-bottom slot. Status, idle hints, pending ask summaries, shortcut overlays, and slash suggestions must not be appended ad hoc from unrelated turn-output code.
2. Use `resolvePromptSlotState()` and the input-loop footer resolver before rendering footer/status lines. Slash suggestions, shortcut overlays, history search, select menus, pending asks, and running activity must preempt ordinary status lines in that priority order.
3. Submitted transcript output must stay input-only: never include status/footer lines in the finalized user input block.
4. Runtime activity feed diagnostics must stay separate from the final assistant answer. If a debug transcript feed is enabled, write it as a separate output segment and keep it out of conversation history.
5. Terminal Markdown rendering must be gated (`off`/`basic`/future `rich`) and must preserve copyable Markdown structure where practical, especially heading markers and fenced code blocks.

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

---

## Examples

1. `gateway/src/orchestration/entrypoints/dev-cli/start/run-start-io.ts`
2. `gateway/src/orchestration/entrypoints/dev-cli/start/run-start-session-menu.ts`
3. `gateway/src/orchestration/entrypoints/dev-cli/start/run-start-session-menu-ops.ts`
4. `gateway/src/orchestration/entrypoints/dev-cli/start/session-interactive.ts`
5. `gateway/src/tools/ask-user/display.ts`
