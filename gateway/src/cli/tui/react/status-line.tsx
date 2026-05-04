import React from "react";
import { Box, Text, renderStaticInk } from "./static-ink";
import { createCliTheme } from "../theme/ansi-theme";
import { resolveCliRenderMode, type CliEnv } from "../kernel/render-mode";
import { truncateDisplayWidth } from "../terminal/display-width";

function renderLineStack(lines: readonly string[], theme: ReturnType<typeof createCliTheme>): string {
  return renderStaticInk(
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={index}>{line}</Text>
      ))}
    </Box>,
    theme,
  );
}

function renderPlainStatusLines(lines: readonly string[], width: number): string {
  return lines
    .map((line) => truncateDisplayWidth(line, width))
    .join("\n");
}

export function renderReactStatusLineLines(
  input: {
    lines: readonly string[];
    terminalColumns?: number;
  },
  options: {
    stdinIsTTY?: boolean;
    stdoutIsTTY?: boolean;
    env?: CliEnv;
  } = {},
): string {
  const mode =
    typeof options.stdinIsTTY === "undefined"
    && typeof options.stdoutIsTTY === "undefined"
    && typeof options.env === "undefined"
      ? "interactive_tty"
      : resolveCliRenderMode({
        stdinIsTTY: options.stdinIsTTY,
        stdoutIsTTY: options.stdoutIsTTY,
        env: options.env,
      });
  const lines = input.lines.filter((line) => line.length > 0);
  if (lines.length === 0) {
    return "";
  }
  if (mode === "non_tty") {
    const width =
      typeof input.terminalColumns === "number" && Number.isFinite(input.terminalColumns)
        ? Math.max(1, Math.floor(input.terminalColumns))
        : 120;
    return renderPlainStatusLines(lines, width);
  }
  return renderLineStack(lines, createCliTheme(mode));
}
