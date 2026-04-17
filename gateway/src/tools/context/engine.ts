import { type TurnRequest } from "../../models/types";
import { preparePromptWithBudget } from "./compress/prompt-compaction";
import { type ContextEngineConfig, type ContextHistoryMessage, type PromptPreparationResult } from "./types";

function compactFingerprint(text: string, maxLen = 128): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLen) {
    return compact;
  }
  return `${compact.slice(0, maxLen).trimEnd()}…`;
}

export function buildContextLines(args: {
  turn: TurnRequest;
  staticFacts?: readonly string[];
}): string[] {
  const staticFacts = args.staticFacts ?? [];
  const fingerprint = compactFingerprint(args.turn.userMessage);
  return [
    ...staticFacts,
    `session:${args.turn.sessionKey}`,
    `project:${args.turn.metadata.projectId}`,
    `platform:${args.turn.metadata.platform}`,
    `user:${fingerprint}`,
  ];
}

export function prepareTurnPrompt(args: {
  userText: string;
  historyMessages: readonly ContextHistoryMessage[];
  historyTurns: number;
  config: ContextEngineConfig;
}): PromptPreparationResult {
  return preparePromptWithBudget({
    userText: args.userText,
    history: args.historyMessages,
    historyTurns: args.historyTurns,
    config: args.config,
  });
}
