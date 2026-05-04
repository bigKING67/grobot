import type { TerminalSelectMenuResult } from "./contract";

const MENU_TRANSITION_DELAY_LIMIT_MS = 160;
const MENU_OPEN_FRAME_DELAY_DEFAULTS: readonly [number, number] = [18, 34];
const MENU_CLOSE_FRAME_DELAY_DEFAULTS: readonly [number, number] = [14, 28];
const ANSI_RESET = "\u001B[0m";
const ANSI_DIM = "\u001B[90m";
const ANSI_SEQUENCE_PATTERN = /\x1b\[[0-9;?]+[A-Za-z]/g;

export type MenuTransitionDelays = readonly [number, number];
type MenuTransitionPresetName = "fast" | "medium" | "slow";
type MenuTransitionFrameKind =
  | "open_initial"
  | "open_mid"
  | "close_initial"
  | "close_mid";

const MENU_TRANSITION_PRESETS: Readonly<
  Record<MenuTransitionPresetName, { open: MenuTransitionDelays; close: MenuTransitionDelays }>
> = {
  fast: {
    open: [12, 22],
    close: [10, 20],
  },
  medium: {
    open: MENU_OPEN_FRAME_DELAY_DEFAULTS,
    close: MENU_CLOSE_FRAME_DELAY_DEFAULTS,
  },
  slow: {
    open: [24, 44],
    close: [18, 34],
  },
};

export interface TerminalSelectMenuTransitionConfig {
  openFrameDelays: MenuTransitionDelays;
  closeFrameDelays: MenuTransitionDelays;
  supportsTransitions: boolean;
}

export interface TerminalSelectMenuRenderSurface {
  render(menuLines: readonly string[]): void;
  clear(): void;
  getLastRenderedMenuLines(): readonly string[];
  getLastRenderedFrameLineCount(): number;
}

export interface TerminalSelectMenuTransitionController {
  surface: TerminalSelectMenuRenderSurface;
  clearOpenTransitionTimers(): void;
  clearCloseTransitionTimers(): void;
  renderOpen(menuLines: readonly string[], resolved: () => boolean): void;
  runClose(result: TerminalSelectMenuResult, finish: (result: TerminalSelectMenuResult) => void): void;
}

function stripMenuTransitionAnsi(valueRaw: string): string {
  return valueRaw.replace(ANSI_SEQUENCE_PATTERN, "");
}

function resolveMenuTransitionPreset(valueRaw: string | undefined): {
  open: MenuTransitionDelays;
  close: MenuTransitionDelays;
} {
  const value = (valueRaw ?? "").trim().toLowerCase();
  if (value === "fast") {
    return MENU_TRANSITION_PRESETS.fast;
  }
  if (value === "slow") {
    return MENU_TRANSITION_PRESETS.slow;
  }
  return MENU_TRANSITION_PRESETS.medium;
}

function resolveMenuTransitionDelays(
  valueRaw: string | undefined,
  fallback: MenuTransitionDelays,
): [number, number] {
  const value = (valueRaw ?? "").trim();
  if (value.length === 0) {
    return [fallback[0], fallback[1]];
  }
  const segments = value.split(/[,\s]+/).map((segment) => segment.trim()).filter((segment) =>
    segment.length > 0
  );
  if (segments.length < 2) {
    return [fallback[0], fallback[1]];
  }
  const first = Number.parseInt(segments[0] ?? "", 10);
  const second = Number.parseInt(segments[1] ?? "", 10);
  if (!Number.isFinite(first) || !Number.isFinite(second) || first < 0 || second < 0) {
    return [fallback[0], fallback[1]];
  }
  return [
    Math.min(MENU_TRANSITION_DELAY_LIMIT_MS, Math.floor(first)),
    Math.min(MENU_TRANSITION_DELAY_LIMIT_MS, Math.floor(second)),
  ];
}

function buildMenuTransitionFrame(
  menuLines: readonly string[],
  kind: MenuTransitionFrameKind,
): string[] {
  return menuLines.map((line, index) => {
    const plain = stripMenuTransitionAnsi(line);
    if (plain.trim().length === 0) {
      return "";
    }
    const isSecondaryLine = plain.startsWith("  ");
    if (kind === "open_initial") {
      if (index <= 1) {
        return plain;
      }
      if (isSecondaryLine) {
        return "";
      }
      return `${ANSI_DIM}${plain}${ANSI_RESET}`;
    }
    if (kind === "open_mid") {
      if (index <= 1) {
        return plain;
      }
      return `${ANSI_DIM}${plain}${ANSI_RESET}`;
    }
    if (kind === "close_initial") {
      return `${ANSI_DIM}${plain}${ANSI_RESET}`;
    }
    if (isSecondaryLine) {
      return "";
    }
    return `${ANSI_DIM}${plain}${ANSI_RESET}`;
  });
}

export function resolveTerminalSelectMenuTransitionConfig(input: {
  env: Record<string, string | undefined>;
  supportsTransitions: boolean;
}): TerminalSelectMenuTransitionConfig {
  const preset = resolveMenuTransitionPreset(input.env.GROBOT_MENU_TIMING_PRESET);
  return {
    openFrameDelays: resolveMenuTransitionDelays(
      input.env.GROBOT_MENU_OPEN_TIMING_MS,
      preset.open,
    ),
    closeFrameDelays: resolveMenuTransitionDelays(
      input.env.GROBOT_MENU_CLOSE_TIMING_MS,
      preset.close,
    ),
    supportsTransitions: input.supportsTransitions,
  };
}

export function createTerminalSelectMenuRenderSurface(input: {
  stdout: {
    write(chunk: string): unknown;
  };
}): TerminalSelectMenuRenderSurface {
  let lastRenderedMenuLines: string[] = [];
  let lastRenderedFrameLineCount = 0;

  return {
    render: (menuLines: readonly string[]): void => {
      const frameLines = [...menuLines];
      lastRenderedMenuLines = frameLines;
      if (lastRenderedFrameLineCount > 0) {
        input.stdout.write("\r");
        input.stdout.write(`\x1b[${String(lastRenderedFrameLineCount)}A`);
      }
      input.stdout.write("\x1b[J");
      input.stdout.write(frameLines.join("\n"));
      input.stdout.write("\n");
      lastRenderedFrameLineCount = frameLines.length;
    },
    clear: (): void => {
      if (lastRenderedFrameLineCount > 0) {
        input.stdout.write("\r");
        input.stdout.write(`\x1b[${String(lastRenderedFrameLineCount)}A`);
        input.stdout.write("\x1b[J");
        lastRenderedFrameLineCount = 0;
      }
      lastRenderedMenuLines = [];
    },
    getLastRenderedMenuLines: () => lastRenderedMenuLines,
    getLastRenderedFrameLineCount: () => lastRenderedFrameLineCount,
  };
}

export function createTerminalSelectMenuTransitionController(input: {
  surface: TerminalSelectMenuRenderSurface;
  config: TerminalSelectMenuTransitionConfig;
  markOpenPreviewRendered(): boolean;
}): TerminalSelectMenuTransitionController {
  let openTransitionStageOneTimer: ReturnType<typeof setTimeout> | undefined;
  let openTransitionStageTwoTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTransitionStageOneTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTransitionStageTwoTimer: ReturnType<typeof setTimeout> | undefined;

  const clearOpenTransitionTimers = (): void => {
    if (openTransitionStageOneTimer) {
      clearTimeout(openTransitionStageOneTimer);
      openTransitionStageOneTimer = undefined;
    }
    if (openTransitionStageTwoTimer) {
      clearTimeout(openTransitionStageTwoTimer);
      openTransitionStageTwoTimer = undefined;
    }
  };

  const clearCloseTransitionTimers = (): void => {
    if (closeTransitionStageOneTimer) {
      clearTimeout(closeTransitionStageOneTimer);
      closeTransitionStageOneTimer = undefined;
    }
    if (closeTransitionStageTwoTimer) {
      clearTimeout(closeTransitionStageTwoTimer);
      closeTransitionStageTwoTimer = undefined;
    }
  };

  return {
    surface: input.surface,
    clearOpenTransitionTimers,
    clearCloseTransitionTimers,
    renderOpen: (menuLines, resolved): void => {
      if (input.config.supportsTransitions && input.markOpenPreviewRendered()) {
        const initialFrame = buildMenuTransitionFrame(menuLines, "open_initial");
        const middleFrame = buildMenuTransitionFrame(menuLines, "open_mid");
        input.surface.render(initialFrame);
        clearOpenTransitionTimers();
        openTransitionStageOneTimer = setTimeout(() => {
          openTransitionStageOneTimer = undefined;
          if (resolved()) {
            return;
          }
          input.surface.render(middleFrame);
          openTransitionStageTwoTimer = setTimeout(() => {
            openTransitionStageTwoTimer = undefined;
            if (resolved()) {
              return;
            }
            input.surface.render(menuLines);
          }, input.config.openFrameDelays[1]);
        }, input.config.openFrameDelays[0]);
        return;
      }
      clearOpenTransitionTimers();
      input.surface.render(menuLines);
    },
    runClose: (result, finish): void => {
      if (
        !input.config.supportsTransitions
        || input.surface.getLastRenderedFrameLineCount() <= 0
        || input.surface.getLastRenderedMenuLines().length === 0
      ) {
        finish(result);
        return;
      }
      const initialFrame = buildMenuTransitionFrame(
        input.surface.getLastRenderedMenuLines(),
        "close_initial",
      );
      const middleFrame = buildMenuTransitionFrame(
        input.surface.getLastRenderedMenuLines(),
        "close_mid",
      );
      input.surface.render(initialFrame);
      clearCloseTransitionTimers();
      closeTransitionStageOneTimer = setTimeout(() => {
        closeTransitionStageOneTimer = undefined;
        input.surface.render(middleFrame);
        closeTransitionStageTwoTimer = setTimeout(() => {
          closeTransitionStageTwoTimer = undefined;
          finish(result);
        }, input.config.closeFrameDelays[1]);
      }, input.config.closeFrameDelays[0]);
    },
  };
}
