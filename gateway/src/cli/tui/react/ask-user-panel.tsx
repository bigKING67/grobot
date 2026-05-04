import React from "react";
import { Box, Divider, Text, renderStaticInk } from "./static-ink";
import { createCliTheme } from "../theme/ansi-theme";
import { resolveCliRenderMode, type CliEnv } from "../kernel/render-mode";
import { measureDisplayWidth, stripAnsi, truncateDisplayWidth } from "../terminal/display-width";

function normalizePlainLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, array) => !(line.length === 0 && array[index - 1]?.length === 0));
}

function renderSurfaceLine(line: string, width: number): React.ReactElement {
  const plain = stripAnsi(line);
  if (/^[─]+$/.test(plain)) {
    return <Divider width={Math.max(1, Math.min(width, measureDisplayWidth(plain)))} tone="brand" />;
  }
  if (plain === line) {
    return <Text>{line}</Text>;
  }
  return <Text>{line}</Text>;
}

function AskUserPanelSurface({
  lines,
  width,
}: {
  lines: readonly string[];
  width: number;
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Box key={index} flexDirection="row">
          {renderSurfaceLine(line, width)}
        </Box>
      ))}
    </Box>
  );
}

export function renderReactAskUserPanelScreen(
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
  const plain = input.lines.join("\n");
  if (mode === "non_tty") {
    const width =
      typeof input.terminalColumns === "number" && Number.isFinite(input.terminalColumns)
        ? Math.max(44, Math.min(96, Math.floor(input.terminalColumns) - 4))
        : 80;
    return normalizePlainLines(plain)
      .map((line) => truncateDisplayWidth(stripAnsi(line), width))
      .join("\n");
  }
  const width =
    typeof input.terminalColumns === "number" && Number.isFinite(input.terminalColumns)
      ? Math.max(44, Math.min(96, Math.floor(input.terminalColumns) - 4))
      : 80;
  return renderStaticInk(
    <AskUserPanelSurface lines={normalizePlainLines(plain)} width={width} />,
    createCliTheme(mode),
  );
}
