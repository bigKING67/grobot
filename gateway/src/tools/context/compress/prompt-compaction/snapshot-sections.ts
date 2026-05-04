import { estimateTokensFromText } from "../../budget/token-budget";
import { loadPromptSemanticGenerationContext } from "./semantic-context";
import {
  collectSemanticSignalTokens,
  compactSemanticLine,
  SNAPSHOT_SECTION_SEMANTIC_MAX_CHARS,
  synthesizeSnapshotSectionLines,
} from "./semantic-lines";

export function normalizeSectionKey(raw: string): string {
  return raw.trim().toLowerCase();
}

export const SNAPSHOT_SECTION_DROP_ORDER = [
  "tool outputs (pass/fail only)",
  "live workspace changes",
  "symbol graph hints",
  "dependency graph hints",
  "commit lineage hints",
  "current verification status",
  "open todos and rollback notes",
  "modified files and key changes",
] as const;

export const SNAPSHOT_SECTION_MANDATORY = new Set<string>([
  "architecture decisions",
  "modified files and key changes",
]);

export const SNAPSHOT_SECTION_SEMANTIC_COMPRESS_ORDER = [
  "tool outputs (pass/fail only)",
  "live workspace changes",
  "symbol graph hints",
  "dependency graph hints",
  "commit lineage hints",
  "current verification status",
  "open todos and rollback notes",
] as const;

const SNAPSHOT_SECTION_SEMANTIC_COMPRESS_MAX_ROWS: Record<string, number> = {
  "tool outputs (pass/fail only)": 1,
  "live workspace changes": 2,
  "symbol graph hints": 2,
  "dependency graph hints": 2,
  "commit lineage hints": 2,
  "current verification status": 2,
  "open todos and rollback notes": 2,
};

export function collectPromptSnapshotSectionBlocks(snapshotBody: readonly string[]): Array<{
  title: string;
  lines: string[];
}> {
  const sectionBlocks: Array<{
    title: string;
    lines: string[];
  }> = [];
  let cursor = 0;
  while (cursor < snapshotBody.length) {
    const line = snapshotBody[cursor]?.trim() ?? "";
    const headerMatch = line.match(/^\[(.+)\]$/);
    if (!headerMatch || typeof headerMatch[1] !== "string") {
      cursor += 1;
      continue;
    }
    const title = headerMatch[1].trim();
    const blockLines: string[] = [snapshotBody[cursor] ?? ""];
    cursor += 1;
    while (cursor < snapshotBody.length) {
      const nextLine = snapshotBody[cursor] ?? "";
      if (/^\[(.+)\]$/.test(nextLine.trim())) {
        break;
      }
      blockLines.push(nextLine);
      cursor += 1;
    }
    sectionBlocks.push({
      title,
      lines: blockLines,
    });
  }
  return sectionBlocks;
}

function compressSnapshotSectionLines(args: {
  sectionKey: string;
  lines: readonly string[];
}): {
  lines: string[];
  changed: boolean;
} {
  if (args.lines.length <= 1) {
    return {
      lines: [...args.lines],
      changed: false,
    };
  }
  const header = args.lines[0] ?? "";
  const rawContentRows = args.lines.slice(1).filter((line) => line.trim().length > 0);
  if (rawContentRows.length === 0) {
    return {
      lines: [header],
      changed: args.lines.length > 1,
    };
  }
  if (rawContentRows.some((line) => line.includes("[compressed]"))) {
    return {
      lines: [...args.lines],
      changed: false,
    };
  }
  const maxRows = SNAPSHOT_SECTION_SEMANTIC_COMPRESS_MAX_ROWS[args.sectionKey] ?? 2;
  const keepRows = rawContentRows.slice(0, Math.max(1, maxRows)).map((line) => {
    const compacted = compactSemanticLine(line, SNAPSHOT_SECTION_SEMANTIC_MAX_CHARS);
    return `- ${compacted}`;
  });
  const tailRows = rawContentRows.slice(keepRows.length);
  const tailTokens = collectSemanticSignalTokens(tailRows).slice(0, 6);
  const omittedRows = Math.max(0, rawContentRows.length - keepRows.length);
  const summaryRows: string[] = [];
  if (omittedRows > 0 || tailTokens.length > 0) {
    const parts = [`[compressed] omitted=${String(omittedRows)}`];
    if (tailTokens.length > 0) {
      parts.push(`key=${tailTokens.join(", ")}`);
    }
    summaryRows.push(`- ${parts.join("; ")}`);
  }
  const rebuilt = [header, ...keepRows, ...summaryRows];
  const changed = rebuilt.join("\n").length < args.lines.join("\n").length;
  return {
    lines: changed ? rebuilt : [...args.lines],
    changed,
  };
}

export function compressPromptSnapshotSectionsSemanticallyForBudget(args: {
  prompt: string;
  targetTokenLimit: number;
  workDir?: string;
  userText?: string;
  generativeTimeoutMs?: number;
  generativeMaxEvidence?: number;
}): {
  prompt: string;
  compressedSections: string[];
  generativeSections: string[];
  generativeUsed: boolean;
  warnings: string[];
  estimatedTokens: number;
} {
  const targetTokenLimit = Math.max(1, Math.floor(args.targetTokenLimit));
  const originalPrompt = args.prompt;
  const workDir = typeof args.workDir === "string" ? args.workDir.trim() : "";
  const userText = typeof args.userText === "string" ? args.userText.trim() : "";
  const warnings: string[] = [];
  let estimatedTokens = estimateTokensFromText(originalPrompt);
  if (estimatedTokens <= targetTokenLimit) {
    return {
      prompt: originalPrompt,
      compressedSections: [],
      generativeSections: [],
      generativeUsed: false,
      warnings,
      estimatedTokens,
    };
  }

  const lines = originalPrompt.split(/\r?\n/);
  const contextHeaderIndex = lines.findIndex((line) => line.trim() === "[Conversation Context]");
  const userHeaderIndex = lines.findIndex((line) => line.trim() === "[Current User Message]");
  if (contextHeaderIndex < 0 || userHeaderIndex <= contextHeaderIndex + 1) {
    return {
      prompt: originalPrompt,
      compressedSections: [],
      generativeSections: [],
      generativeUsed: false,
      warnings,
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
      compressedSections: [],
      generativeSections: [],
      generativeUsed: false,
      warnings,
      estimatedTokens,
    };
  }
  const recentHeaderIndex = contextLines.findIndex((line) => line.trim() === "[Recent Turns]");
  const snapshotTailIndex = recentHeaderIndex >= 0 ? recentHeaderIndex : contextLines.length;
  if (snapshotTailIndex <= snapshotHeaderIndex + 1) {
    return {
      prompt: originalPrompt,
      compressedSections: [],
      generativeSections: [],
      generativeUsed: false,
      warnings,
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
      compressedSections: [],
      generativeSections: [],
      generativeUsed: false,
      warnings,
      estimatedTokens,
    };
  }

  const compressedTitles: string[] = [];
  const generativeTitles: string[] = [];
  const keepBlocks = [...sectionBlocks];
  let currentPrompt = originalPrompt;
  const rebuildPrompt = (): string => {
    const markerLines: string[] = [];
    if (compressedTitles.length > 0) {
      markerLines.push("[snapshot sections semantically compressed for budget]");
    }
    if (generativeTitles.length > 0) {
      markerLines.push("[snapshot sections generatively compressed for budget]");
    }
    const rebuiltContext = [
      ...snapshotPrefix,
      ...markerLines,
      ...keepBlocks.flatMap((row) => row.lines),
      ...snapshotSuffix,
    ];
    return [
      ...lines.slice(0, contextHeaderIndex + 1),
      ...rebuiltContext,
      ...lines.slice(userHeaderIndex),
    ].join("\n");
  };
  const pushUniqueTitle = (rows: string[], title: string): void => {
    if (!rows.includes(title)) {
      rows.push(title);
    }
  };
  for (const key of SNAPSHOT_SECTION_SEMANTIC_COMPRESS_ORDER) {
    for (let index = 0; index < keepBlocks.length; index += 1) {
      const block = keepBlocks[index];
      if (!block) {
        continue;
      }
      if (normalizeSectionKey(block.title) !== key) {
        continue;
      }
      const compressed = compressSnapshotSectionLines({
        sectionKey: key,
        lines: block.lines,
      });
      if (!compressed.changed) {
        continue;
      }
      keepBlocks[index] = {
        ...block,
        lines: compressed.lines,
      };
      pushUniqueTitle(compressedTitles, block.title);
      currentPrompt = rebuildPrompt();
      estimatedTokens = estimateTokensFromText(currentPrompt);
      if (estimatedTokens <= targetTokenLimit) {
        return {
          prompt: currentPrompt,
          compressedSections: compressedTitles,
          generativeSections: generativeTitles,
          generativeUsed: generativeTitles.length > 0,
          warnings,
          estimatedTokens,
        };
      }
    }
  }

  if (estimatedTokens > targetTokenLimit) {
    const generationContext = loadPromptSemanticGenerationContext({
      workDir,
      prompt: userText || originalPrompt,
      timeoutMs: args.generativeTimeoutMs,
      maxEvidence: args.generativeMaxEvidence,
    });
    if (generationContext.warning) {
      warnings.push(generationContext.warning);
    }
    if (generationContext.available) {
      for (const key of SNAPSHOT_SECTION_SEMANTIC_COMPRESS_ORDER) {
        for (let index = 0; index < keepBlocks.length; index += 1) {
          const block = keepBlocks[index];
          if (!block) {
            continue;
          }
          if (normalizeSectionKey(block.title) !== key) {
            continue;
          }
          const synthesized = synthesizeSnapshotSectionLines({
            sectionKey: key,
            lines: block.lines,
            generationContext,
          });
          if (!synthesized.changed) {
            continue;
          }
          keepBlocks[index] = {
            ...block,
            lines: synthesized.lines,
          };
          pushUniqueTitle(compressedTitles, block.title);
          pushUniqueTitle(generativeTitles, block.title);
          currentPrompt = rebuildPrompt();
          estimatedTokens = estimateTokensFromText(currentPrompt);
          if (estimatedTokens <= targetTokenLimit) {
            return {
              prompt: currentPrompt,
              compressedSections: compressedTitles,
              generativeSections: generativeTitles,
              generativeUsed: generativeTitles.length > 0,
              warnings,
              estimatedTokens,
            };
          }
        }
      }
    }
  }

  return {
    prompt: currentPrompt,
    compressedSections: compressedTitles,
    generativeSections: generativeTitles,
    generativeUsed: generativeTitles.length > 0,
    warnings,
    estimatedTokens,
  };
}
