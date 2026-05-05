# Component Guidelines

> How terminal-facing interaction components are built in this project.

---

## Overview

The CLI/TUI frontend surface now supports React/Ink rendering adapters, but
public interaction components are still organized as CLI/TUI modules composed
from:

1. Typed input contract (`interface ...Input`).
2. Pure view-model or formatter function (`build*`, `format*`, `parse*`).
3. Effectful runner that executes interaction (`run*`, `open*`, `dispatch*`).

React/Ink adapters belong under `gateway/src/cli/tui/react/`. They currently
render startup, menu, prompt input, status line, bottom-pane, and ask-user panel
surfaces, but they must not become new owners for stdin/raw-mode lifecycle. Keep
controller ownership in the existing component controller role unless the full
component is deliberately migrated.

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

The former `gateway/src/cli/tui/screens/select-menu-screen.ts` compatibility
re-export has been removed. Do not recreate screen-path imports.
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
11. The visible prompt chrome is delegated through
    `gateway/src/cli/tui/react/prompt-input.tsx`; do not bypass
    `components/prompt-input/render.ts` to print ad hoc input frames.

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

The former `gateway/src/cli/tui/screens/ask-user-panel-screen.ts` compatibility
re-export has been removed. Do not recreate screen-path imports.
`gateway/src/cli/start/tui-compat.ts` must not be used as the owner or import
surface for ask-user panel code.

### Status, Bottom Pane, Activity Feed, And Turn Notices

Developer-facing passive surfaces are owned by component directories, not
screen monoliths:

1. `components/status-line/`: status-line contract, config normalization, and
   render logic. `react/status-line.tsx` owns the visible adapter surface.
2. `components/bottom-pane/`: prompt-bottom slot footer composition for idle,
   pending ask, running activity, and shortcut overlay.
3. `components/activity-feed/`: runtime tool activity feed rows and detail
   rendering. `react/activity-feed.tsx` owns the visible adapter surface. Keep
   rows terse and reference-style: one tool/action line, dim details only in
   full mode, and no raw key/value diagnostic dumps. The feed must stay out of
   conversation history.
4. `components/turn-notice/`: turn interruption/open-circuit/failure notices.
   `react/turn-notice.tsx` owns the visible adapter surface and should keep
   notices compact, low-noise, and reference-style: one primary line plus only
   the minimum muted details needed to continue.
5. `components/provider-health/`: provider failover/circuit state display.
   `react/provider-health.tsx` owns the visible adapter surface; avoid long
   key/value log lines in `/health` output.
6. `components/status-indicator/`: running-turn inline progress indicator.
   Keep spinner, elapsed time, token/thinking suffix, and stall logic here.
7. `components/help/`: `/help` command guide surface. `react/help-screen.tsx`
   owns the visible adapter surface; keep the output low-noise and
   reference-style with compact command rows, shortcut rows, and muted notes.
   Do not restore the legacy document-style `交互命令/运维工具/兼容说明`
   headers.
8. `components/info-panel/`: passive snapshot surfaces for slash-command
   status/read-only outputs. `react/info-panel.tsx` owns the visible adapter
   surface; keep panels terse, low-noise, and reference-style: title,
   optional muted subtitle, bullet rows, and muted `⎿` detail lines. Start
   layer files may assemble the data, but they must delegate visual rendering
   to this component instead of hand-building multiline `● 标题` documents.
9. `components/startup/`: startup banner surface. `react/startup-screen.tsx`
   owns the visible adapter surface; keep the banner logic and view-model
   contracts here. Do not recreate the retired `screens/startup-screen.ts`
   compatibility re-export.

The former files under `gateway/src/cli/tui/screens/*-screen.ts` are retired.
New imports must target `components/*` or the React adapter owner under
`react/*`.

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
8. React/Ink adapter files should be treated as render implementations. They
   can compose visual nodes, but keyboard state still belongs in reducers and
   terminal lifecycle still belongs in controllers.

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
