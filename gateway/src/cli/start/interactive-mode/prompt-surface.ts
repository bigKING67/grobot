import { readPromptQualityWindowSummary } from "../../../tools/context";
import { type SessionPromptLayout } from "../../tui/interactive/interactive-frame";
import { type StatusLineConfig } from "../../tui/components/status-line/contract";
import { inferModelApiContextWindowTokens } from "../model-context";

export interface PromptBudgetSnapshot {
  contextWindowUsageRatio?: number;
  estimatedTokens?: number;
  targetTokenLimit?: number;
}

export function resolveProjectFolder(projectRoot: string, fallbackName: string): string {
  const normalized = projectRoot.replace(/[\\/]+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex >= 0 && slashIndex < normalized.length - 1) {
    return normalized.slice(slashIndex + 1);
  }
  return fallbackName;
}

export function resolveTerminalColumns(): number | undefined {
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
    return stdout.columns;
  }
  return undefined;
}

export function resolveTerminalRows(): number | undefined {
  const stdout = process.stdout as unknown as {
    isTTY?: boolean;
    rows?: number;
  };
  if (
    stdout.isTTY
    && typeof stdout.rows === "number"
    && Number.isFinite(stdout.rows)
    && stdout.rows > 0
  ) {
    return Math.floor(stdout.rows);
  }
  return undefined;
}

export function buildInteractivePromptLayout(input: {
  renderedPrompt: string;
  promptLabel: string;
  promptSlot?: SessionPromptLayout["promptSlot"];
}): SessionPromptLayout {
  const suffix = input.renderedPrompt
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join("\n");
  return {
    prefix: "",
    inlinePrompt: input.promptLabel,
    suffix,
    renderSuffixWhileTyping: true,
    promptSlot: input.promptSlot,
  };
}

export function createPromptBudgetSnapshotReader(input: {
  workDir: string;
}): (config: StatusLineConfig) => PromptBudgetSnapshot {
  let cacheResolvedAtMs = 0;
  let cachedSnapshot: PromptBudgetSnapshot = {};
  let lastKnownGoodSnapshot: PromptBudgetSnapshot | undefined;

  return (config: StatusLineConfig): PromptBudgetSnapshot => {
    const now = Date.now();
    if (now - cacheResolvedAtMs <= config.budgetSnapshotCacheTtlMs) {
      return cachedSnapshot;
    }
    cacheResolvedAtMs = now;
    try {
      const snapshot = resolvePromptBudgetSnapshot(input.workDir);
      cachedSnapshot = snapshot;
      if (hasBudgetSnapshotValue(snapshot)) {
        lastKnownGoodSnapshot = snapshot;
      }
      return snapshot;
    } catch {
      if (lastKnownGoodSnapshot) {
        cachedSnapshot = lastKnownGoodSnapshot;
        return lastKnownGoodSnapshot;
      }
      cachedSnapshot = {};
      return cachedSnapshot;
    }
  };
}

export function buildInteractiveWindowTitle(input: {
  projectFolder: string;
  providerName: string;
  modelName: string;
  sessionId: string;
  sessionTopic?: string;
  planMode: boolean;
}): string {
  const sessionLabel = input.sessionTopic?.trim().length
    ? input.sessionTopic.trim()
    : input.sessionId;
  const planLabel = input.planMode ? " · PLAN" : "";
  return `Grobot · ${input.projectFolder} · ${sessionLabel} · ${input.providerName}/${input.modelName}${planLabel}`;
}

export function resolveModelContextWindowTokens(input: {
  modelName: string;
  fallback?: number;
  getCachedModelContextWindowTokens(modelId: string): number | undefined;
}): number | undefined {
  const cachedTokens = input.getCachedModelContextWindowTokens(input.modelName);
  if (
    typeof cachedTokens === "number"
    && Number.isFinite(cachedTokens)
    && cachedTokens > 0
  ) {
    return Math.floor(cachedTokens);
  }
  return inferModelApiContextWindowTokens({
    modelName: input.modelName,
    fallback: input.fallback,
  });
}

function resolvePromptBudgetSnapshot(workDir: string): PromptBudgetSnapshot {
  const summary = readPromptQualityWindowSummary({
    workDir,
    size: 1,
  });
  return {
    contextWindowUsageRatio: summary.tokenBudget.averageUtilizationRatio ?? undefined,
    estimatedTokens: summary.tokenBudget.averageEstimatedTokens ?? undefined,
    targetTokenLimit: summary.tokenBudget.averageTargetTokenLimit ?? undefined,
  };
}

function hasBudgetSnapshotValue(input: PromptBudgetSnapshot): boolean {
  return (
    typeof input.contextWindowUsageRatio === "number"
    || typeof input.estimatedTokens === "number"
    || typeof input.targetTokenLimit === "number"
  );
}
