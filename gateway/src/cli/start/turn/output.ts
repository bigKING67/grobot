import { type RuntimeEvent } from "../../../models/types";
import {
  renderRuntimeActivityFeed,
  resolveRuntimeActivityFeedDetailMode,
} from "../../tui/screens/activity-feed-screen";
import {
  renderTerminalMarkdown,
  resolveTerminalMarkdownMode,
  type TerminalMarkdownMode,
} from "../../tui/interactive/terminal-markdown";
import { type TurnTerminalOutputSegments } from "./contract";

export function resolveRuntimeActivityFeedTranscriptEnabled(valueRaw?: string): boolean {
  const value = (valueRaw ?? "").trim().toLowerCase();
  return value === "1"
    || value === "true"
    || value === "yes"
    || value === "on"
    || value === "transcript";
}

function resolveInteractiveTerminalColumns(): number | undefined {
  const stdout = process.stdout as unknown as {
    isTTY?: boolean;
    columns?: number;
  };
  if (
    stdout.isTTY
    && typeof stdout.columns === "number"
    && Number.isFinite(stdout.columns)
    && stdout.columns > 0
  ) {
    return Math.floor(stdout.columns);
  }
  return undefined;
}

export function buildTurnTerminalOutputSegments(input: {
  assistantMessage: string;
  interactiveMode: boolean;
  runtimeAskUser?: boolean;
  events?: readonly RuntimeEvent[];
  terminalColumns?: number;
  terminalMarkdownMode?: TerminalMarkdownMode;
  activityFeedDetailValue?: string;
  activityFeedTranscriptValue?: string;
}): TurnTerminalOutputSegments {
  const assistantMessageForTerminal = input.interactiveMode
    ? renderTerminalMarkdown({
      text: input.assistantMessage,
      mode: input.terminalMarkdownMode ?? resolveTerminalMarkdownMode(undefined),
    })
    : input.assistantMessage;
  const assistantOutput = input.interactiveMode
    ? `${assistantMessageForTerminal}\n\n`
    : `${assistantMessageForTerminal}\n`;
  if (
    !input.interactiveMode
    || input.runtimeAskUser
    || !resolveRuntimeActivityFeedTranscriptEnabled(input.activityFeedTranscriptValue)
  ) {
    return {
      activityFeed: "",
      assistantOutput,
    };
  }
  const activityFeedDetailMode = resolveRuntimeActivityFeedDetailMode(input.activityFeedDetailValue);
  const activityFeed = renderRuntimeActivityFeed({
    events: input.events ?? [],
    terminalColumns: input.terminalColumns ?? resolveInteractiveTerminalColumns(),
    detailMode: activityFeedDetailMode,
  });
  return {
    activityFeed,
    assistantOutput,
  };
}
