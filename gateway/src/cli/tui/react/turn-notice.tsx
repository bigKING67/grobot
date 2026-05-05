import React from "react";
import { Box, Text, renderStaticInk } from "./static-ink";
import { createCliTheme } from "../theme/ansi-theme";
import type { TurnNoticeViewModel } from "../components/turn-notice/contract";
import {
  measureDisplayWidth,
  truncateDisplayWidth,
} from "../terminal/display-width";

function resolveNoticeWidth(input: TurnNoticeViewModel): number {
  if (
    typeof input.terminalColumns === "number"
    && Number.isFinite(input.terminalColumns)
  ) {
    return Math.max(32, Math.floor(input.terminalColumns));
  }
  return 96;
}

function renderNoticeBody(input: TurnNoticeViewModel): React.ReactElement {
  const width = resolveNoticeWidth(input);
  const title = truncateDisplayWidth(input.title, width);
  const detail = input.detail
    ? truncateDisplayWidth(input.detail, Math.max(12, width - measureDisplayWidth(title) - 3))
    : "";
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text tone={input.tone ?? "muted"}>{title}</Text>
        {detail ? <Text tone="muted">{` · ${detail}`}</Text> : null}
      </Box>
      {(input.footerLines ?? []).map((line, index) => (
        <Text key={index} tone="muted">
          {`  ⎿  ${truncateDisplayWidth(line, Math.max(1, width - 5))}`}
        </Text>
      ))}
    </Box>
  );
}

export function renderReactTurnNotice(input: TurnNoticeViewModel): string {
  const mode = input.interactiveMode ? "interactive_tty" : "plain_tty";
  return renderStaticInk(renderNoticeBody(input), createCliTheme(mode));
}
