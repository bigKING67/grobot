import { estimateTokensFromText } from "../../context";
import type {
  MemoryContextBlock,
  MemoryOrchestratorPolicySnapshot,
} from "./contract";
import { clamp } from "./utils";

function fitBlockToTokens(rawBlock: string, maxTokens: number): {
  text: string;
  truncated: boolean;
} | undefined {
  if (maxTokens <= 0) {
    return undefined;
  }
  const tokens = estimateTokensFromText(rawBlock);
  if (tokens <= maxTokens) {
    return {
      text: rawBlock,
      truncated: false,
    };
  }
  const lines = rawBlock.split(/\r?\n/);
  if (lines.length <= 2) {
    return undefined;
  }
  let cursor = lines.length;
  while (cursor > 2) {
    const candidate = `${lines.slice(0, cursor).join("\n")}\n[... trimmed by memory orchestrator budget]`;
    if (estimateTokensFromText(candidate) <= maxTokens) {
      return {
        text: candidate,
        truncated: true,
      };
    }
    cursor -= 1;
  }
  return undefined;
}

export function buildInjectBudget(policy: MemoryOrchestratorPolicySnapshot, targetTokenLimit: number): number {
  const ratioBudget = Math.floor(targetTokenLimit * clamp(policy.injectBudgetRatio, 0.05, 0.45));
  return clamp(
    ratioBudget,
    policy.injectBudgetMinTokens,
    Math.max(policy.injectBudgetMinTokens, policy.injectBudgetMaxTokens),
  );
}

export function selectBlocksByBudget(input: {
  blocks: readonly MemoryContextBlock[];
  budgetTokens: number;
  maxSectionTokens: number;
}): {
  promptParts: string[];
  usedTokens: number;
  includedSections: string[];
  truncatedSections: string[];
} {
  let usedTokens = 0;
  const promptParts: string[] = [];
  const includedSections: string[] = [];
  const truncatedSections: string[] = [];
  const sorted = [...input.blocks].sort((left, right) => right.priority - left.priority);
  for (const block of sorted) {
    if (usedTokens >= input.budgetTokens) {
      break;
    }
    const remaining = input.budgetTokens - usedTokens;
    const sectionCap = Math.min(remaining, input.maxSectionTokens);
    const fitted = fitBlockToTokens(block.text, sectionCap);
    if (!fitted) {
      continue;
    }
    const fittedTokens = estimateTokensFromText(fitted.text);
    promptParts.push(fitted.text);
    includedSections.push(block.name);
    if (fitted.truncated) {
      truncatedSections.push(block.name);
    }
    usedTokens += fittedTokens;
  }
  return {
    promptParts,
    usedTokens,
    includedSections,
    truncatedSections,
  };
}
