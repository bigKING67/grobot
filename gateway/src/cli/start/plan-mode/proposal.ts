import { extractLatestProposedPlanBlock } from "../plan-artifact";
import type { ChatHistoryMessage } from "../session-history";

export interface AssistantProposedPlanCandidate {
  content: string;
  historyIndex: number;
}

export function extractLatestAssistantProposedPlan(
  historyMessages: readonly ChatHistoryMessage[],
  startIndex: number,
): AssistantProposedPlanCandidate | undefined {
  const safeStartIndex = Math.max(0, Math.floor(startIndex));
  let latest: AssistantProposedPlanCandidate | undefined;
  for (let index = safeStartIndex; index < historyMessages.length; index += 1) {
    const row = historyMessages[index];
    if (!row || row.role !== "assistant") {
      continue;
    }
    const extracted = extractLatestProposedPlanBlock(row.content);
    if (!extracted) {
      continue;
    }
    latest = {
      content: extracted,
      historyIndex: index,
    };
  }
  return latest;
}
