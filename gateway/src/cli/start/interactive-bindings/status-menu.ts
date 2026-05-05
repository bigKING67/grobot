import { runTerminalSelectMenu } from "../../tui/components/select-menu/controller";
import { renderInfoPanel } from "../../tui/components/info-panel/render";
import type {
  StatusLineConfig,
  StatusLineConfigInput,
} from "../../tui/components/status-line/contract";
import { buildCompactNotice } from "./notice-surface";
import {
  buildStatusLayoutUsageSurface,
  buildStatusSegmentUsageSurface,
  buildStatusThemeUsageSurface,
  formatStatusSegmentLabel,
  formatStatusSegmentStateLine,
  formatStatusLayoutModeLabel,
  formatStatusThemeLabel,
  formatStatusLineCurrentSnapshot,
  normalizeStatusSegmentId,
  resolveStatusLayoutMode,
  resolveStatusTheme,
} from "./status-line-settings";

export interface OpenStatusMenuInput {
  sessionKey: string;
  runSelectMenu: typeof runTerminalSelectMenu;
  withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>;
  getStatusLineConfig(): StatusLineConfig;
  updateStatusLineConfig(partial: StatusLineConfigInput): void;
  writeStdout(message: string): void;
}

export async function openStatusMenu(
  input: OpenStatusMenuInput,
): Promise<void> {
  const showCurrent = (): void => {
    input.writeStdout(
      formatStatusLineCurrentSnapshot(input.getStatusLineConfig()),
    );
  };
  if (!process.stdin.isTTY) {
    input.writeStdout(
      renderInfoPanel({
        title: "Status bar actions",
        sections: [{
          rows: [
            {
              title: "/status current",
              detailLines: ["Show current status bar config."],
            },
            {
              title: "/status theme <theme>",
              detailLines: ["Set status bar theme. Available: plain, ccline, nerd_font."],
            },
            {
              title: "/status layout <layout>",
              detailLines: ["Set status bar layout. Available: adaptive, full, compact."],
            },
            {
              title: "/status segment <name> <on|off>",
              detailLines: ["Toggle model, project, context, token, or session segments."],
            },
          ],
        }],
      }),
    );
    return;
  }
  const actionMenu = await input.withInputPaused(() =>
    input.runSelectMenu({
      title: "Status bar",
      subtitle: `session ${input.sessionKey}`,
      hint: "↑/↓ select · Enter confirm · Esc back",
      items: [
        {
          id: "current",
          label: "Show current snapshot",
          description: "Print current status bar config.",
        },
        {
          id: "theme",
          label: "Set status theme",
          description: "Choose the status bar visual theme.",
        },
        {
          id: "layout",
          label: "Set status layout",
          description: "Choose the status bar information density.",
        },
        {
          id: "segment",
          label: "Toggle status segment",
          description: "Enable or disable model, project, context, token, or session segments.",
        },
      ],
    }),
  );
  if (actionMenu.kind === "cancelled") {
    return;
  }
  if (actionMenu.item.id === "current") {
    showCurrent();
    return;
  }
  if (actionMenu.item.id === "theme") {
    await openThemeMenu(input);
    return;
  }
  if (actionMenu.item.id === "layout") {
    await openLayoutMenu(input);
    return;
  }
  await openSegmentMenu(input);
}

async function openThemeMenu(input: OpenStatusMenuInput): Promise<void> {
  const current = input.getStatusLineConfig().theme;
  const pickedTheme = await input.withInputPaused(() =>
    input.runSelectMenu({
      title: "Status theme",
      subtitle: `current ${formatStatusThemeLabel(current)}`,
      hint: "↑/↓ select · Enter apply · Esc back",
      items: [
        {
          id: "plain",
          label: "Plain",
          description: "Minimal ANSI style.",
          current: current === "plain",
        },
        {
          id: "ccline",
          label: "Two-line",
          description: "Low-noise two-line status theme.",
          current: current === "ccline",
        },
        {
          id: "nerd_font",
          label: "Nerd font",
          description: "Use Nerd Font glyphs for status recognition.",
          current: current === "nerd_font",
        },
      ],
    }),
  );
  if (pickedTheme.kind === "cancelled") {
    return;
  }
  const theme = resolveStatusTheme(pickedTheme.item.id);
  if (!theme) {
    input.writeStdout(
      buildStatusThemeUsageSurface("Invalid status theme"),
    );
    return;
  }
  input.updateStatusLineConfig({ theme });
  input.writeStdout(buildCompactNotice("Status theme updated", [`theme ${formatStatusThemeLabel(theme)}`]));
}

async function openLayoutMenu(input: OpenStatusMenuInput): Promise<void> {
  const current = input.getStatusLineConfig().layoutMode;
  const pickedLayout = await input.withInputPaused(() =>
    input.runSelectMenu({
      title: "Status layout",
      subtitle: `current ${formatStatusLayoutModeLabel(current)}`,
      hint: "↑/↓ select · Enter apply · Esc back",
      items: [
        {
          id: "adaptive",
          label: "Adaptive",
          description: "Select automatically by terminal width.",
          current: current === "adaptive",
        },
        {
          id: "full",
          label: "Full",
          description: "Always show full status details.",
          current: current === "full",
        },
        {
          id: "compact",
          label: "Compact",
          description: "Use compact status bar layout.",
          current: current === "compact",
        },
      ],
    }),
  );
  if (pickedLayout.kind === "cancelled") {
    return;
  }
  const layoutMode = resolveStatusLayoutMode(pickedLayout.item.id);
  if (!layoutMode) {
    input.writeStdout(
      buildStatusLayoutUsageSurface("Invalid status layout"),
    );
    return;
  }
  input.updateStatusLineConfig({ layoutMode });
  input.writeStdout(
    buildCompactNotice("Status layout updated", [`layout ${formatStatusLayoutModeLabel(layoutMode)}`]),
  );
}

async function openSegmentMenu(input: OpenStatusMenuInput): Promise<void> {
  const config = input.getStatusLineConfig();
  const pickedSegment = await input.withInputPaused(() =>
    input.runSelectMenu({
      title: "Status segment",
      subtitle: "Choose a segment to update",
      hint: "↑/↓ select · Enter continue · Esc back",
      items: config.segmentOrder.map((segmentId) => ({
        id: segmentId,
        label: formatStatusSegmentLabel(segmentId),
        description: formatStatusSegmentStateLine(segmentId, config.segments[segmentId]),
      })),
    }),
  );
  if (pickedSegment.kind === "cancelled") {
    return;
  }
  const segmentId = normalizeStatusSegmentId(pickedSegment.item.id);
  if (!segmentId) {
    input.writeStdout(
      buildStatusSegmentUsageSurface("Invalid status segment"),
    );
    return;
  }
  const currentEnabled = input.getStatusLineConfig().segments[segmentId];
  const segmentLabel = formatStatusSegmentLabel(segmentId);
  const pickedState = await input.withInputPaused(() =>
    input.runSelectMenu({
      title: `Status segment ${segmentLabel}`,
      subtitle: `current ${currentEnabled ? "on" : "off"}`,
      hint: "↑/↓ select · Enter apply · Esc back",
      items: [
        {
          id: "on",
          label: "On",
          description: "Enable this segment in the status bar.",
          current: currentEnabled,
        },
        {
          id: "off",
          label: "Off",
          description: "Disable this segment in the status bar.",
          current: !currentEnabled,
        },
      ],
    }),
  );
  if (pickedState.kind === "cancelled") {
    return;
  }
  const enabled = pickedState.item.id === "on";
  input.updateStatusLineConfig({
    segments: {
      [segmentId]: enabled,
    },
  });
  input.writeStdout(
    buildCompactNotice("Status segment updated", [
      `segment ${segmentLabel}`,
      enabled ? "on" : "off",
    ]),
  );
}
