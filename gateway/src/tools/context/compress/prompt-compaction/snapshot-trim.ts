import { estimateTokensFromText } from "../../budget/token-budget";
import {
  collectPromptSnapshotSectionBlocks,
  normalizeSectionKey,
  SNAPSHOT_SECTION_DROP_ORDER,
  SNAPSHOT_SECTION_MANDATORY,
} from "./snapshot-sections";

export function trimPromptSnapshotSectionsForBudget(args: {
  prompt: string;
  targetTokenLimit: number;
}): {
  prompt: string;
  removedSections: string[];
  estimatedTokens: number;
} {
  const targetTokenLimit = Math.max(1, Math.floor(args.targetTokenLimit));
  const originalPrompt = args.prompt;
  let estimatedTokens = estimateTokensFromText(originalPrompt);
  if (estimatedTokens <= targetTokenLimit) {
    return {
      prompt: originalPrompt,
      removedSections: [],
      estimatedTokens,
    };
  }

  const lines = originalPrompt.split(/\r?\n/);
  const contextHeaderIndex = lines.findIndex((line) => line.trim() === "[Conversation Context]");
  const userHeaderIndex = lines.findIndex((line) => line.trim() === "[Current User Message]");
  if (contextHeaderIndex < 0 || userHeaderIndex <= contextHeaderIndex + 1) {
    return {
      prompt: originalPrompt,
      removedSections: [],
      estimatedTokens,
    };
  }

  const contextLines = lines.slice(contextHeaderIndex + 1, userHeaderIndex);
  const snapshotHeaderIndex = contextLines.findIndex(
    (line) => line.trim() === "[Compact Context Snapshot v2]",
  );
  if (snapshotHeaderIndex < 0) {
    return {
      prompt: originalPrompt,
      removedSections: [],
      estimatedTokens,
    };
  }
  const recentHeaderIndex = contextLines.findIndex((line) => line.trim() === "[Recent Turns]");
  const snapshotTailIndex = recentHeaderIndex >= 0 ? recentHeaderIndex : contextLines.length;
  if (snapshotTailIndex <= snapshotHeaderIndex + 1) {
    return {
      prompt: originalPrompt,
      removedSections: [],
      estimatedTokens,
    };
  }

  const snapshotPrefix = contextLines.slice(0, snapshotHeaderIndex + 1);
  const snapshotBody = contextLines.slice(snapshotHeaderIndex + 1, snapshotTailIndex);
  const snapshotSuffix = contextLines.slice(snapshotTailIndex);
  const sectionBlocks = collectPromptSnapshotSectionBlocks(snapshotBody);
  if (sectionBlocks.length === 0) {
    return {
      prompt: originalPrompt,
      removedSections: [],
      estimatedTokens,
    };
  }

  const removableKeys = new Set<string>(SNAPSHOT_SECTION_DROP_ORDER);
  const droppedTitles: string[] = [];
  const keepBlocks = [...sectionBlocks];

  const removeOneSectionByKey = (key: string): boolean => {
    for (let index = 0; index < keepBlocks.length; index += 1) {
      const title = keepBlocks[index]?.title ?? "";
      const normalizedTitle = normalizeSectionKey(title);
      if (normalizedTitle !== key) {
        continue;
      }
      if (SNAPSHOT_SECTION_MANDATORY.has(normalizedTitle)) {
        return false;
      }
      keepBlocks.splice(index, 1);
      droppedTitles.push(title);
      return true;
    }
    return false;
  };

  let currentPrompt = originalPrompt;
  for (const key of SNAPSHOT_SECTION_DROP_ORDER) {
    if (!removableKeys.has(key)) {
      continue;
    }
    while (removeOneSectionByKey(key)) {
      const marker = droppedTitles.length > 0
        ? ["[snapshot sections truncated for budget]"]
        : [];
      const rebuiltContext = [
        ...snapshotPrefix,
        ...marker,
        ...keepBlocks.flatMap((block) => block.lines),
        ...snapshotSuffix,
      ];
      currentPrompt = [
        ...lines.slice(0, contextHeaderIndex + 1),
        ...rebuiltContext,
        ...lines.slice(userHeaderIndex),
      ].join("\n");
      estimatedTokens = estimateTokensFromText(currentPrompt);
      if (estimatedTokens <= targetTokenLimit) {
        return {
          prompt: currentPrompt,
          removedSections: droppedTitles,
          estimatedTokens,
        };
      }
    }
  }

  return {
    prompt: currentPrompt,
    removedSections: droppedTitles,
    estimatedTokens,
  };
}
