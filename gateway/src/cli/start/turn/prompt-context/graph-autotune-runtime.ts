import {
  assessGraphCacheWindowDegradation,
  assessPersistentGraphWindowDegradation,
  deriveGraphQualitySignals,
  readGraphCacheWindowSummary,
  readGraphQualityAutotuneState,
  readPromptQualityWindowSummary,
  writeGraphQualityAutotuneState,
  type GraphQualityAutotuneState,
} from "../../../../tools/context";
import { readPersistentGraphIndexStatus } from "../../../../tools/context/graph/persistent-index";
import {
  GRAPH_AUTOTUNE_PERSISTENT_MIN_SCANNED_FILES,
  deriveAdaptiveGraphActionProfile,
  deriveAdaptiveGraphThresholdProfile,
  resolveGraphQualityAutotuneDecision,
} from "../graph-autotune";
import { buildGraphQualityAutotuneDiagnostic } from "../graph-autotune-surface";
import { isWorkDirWithinRepoRoot } from "../graph-autotune-utils";
import type { CreateRunStartTurnRunnerInput } from "../contract";

export function preparePromptContextGraphAutotune(input: {
  runnerInput: CreateRunStartTurnRunnerInput;
  allowProactiveCompaction: boolean;
  writeTurnDiagnostic(message: string): void;
}): {
  promptQualityConfig: CreateRunStartTurnRunnerInput["contextEngineConfig"]["promptQuality"];
  promptQualityWindowSummary: ReturnType<typeof readPromptQualityWindowSummary>;
  graphAutotuneDecision: ReturnType<typeof resolveGraphQualityAutotuneDecision>;
} {
  const { runnerInput } = input;
  const promptQualityConfig = runnerInput.contextEngineConfig.promptQuality;
  const promptQualityWindowSummary = readPromptQualityWindowSummary({
    workDir: runnerInput.workDir,
    size: Math.max(
      20,
      Math.min(256, promptQualityConfig?.degradeMinEntries ?? 8),
    ),
    lowQualityThreshold: promptQualityConfig?.lowQualityThreshold,
  });
  const graphAutotuneWindowSize = Math.max(
    8,
    Math.min(128, (promptQualityConfig?.degradeMinEntries ?? 8) * 4),
  );
  const graphWindowSummary = readGraphCacheWindowSummary({
    workDir: runnerInput.workDir,
    size: graphAutotuneWindowSize,
  });
  const persistentGraphStatus = readPersistentGraphIndexStatus({
    workDir: runnerInput.workDir,
    windowSize: graphAutotuneWindowSize,
  });
  const persistentSignalsActive = isWorkDirWithinRepoRoot(
    runnerInput.workDir,
    typeof persistentGraphStatus.root_path === "string"
      ? persistentGraphStatus.root_path
      : undefined,
  );
  const minGraphEvidenceEntries = Math.max(
    2,
    promptQualityConfig?.degradeMinEntries ?? 8,
  );
  const graphAutotuneState = readGraphQualityAutotuneState({
    workDir: runnerInput.workDir,
  });
  const adaptiveThresholds = deriveAdaptiveGraphThresholdProfile({
    state: graphAutotuneState,
    graphWindowSummary,
    persistentStatus: persistentSignalsActive
      ? persistentGraphStatus
      : { enabled: false },
    persistentSignalsActive,
    minEvidenceEntries: minGraphEvidenceEntries,
    pressureUtilization:
      promptQualityWindowSummary.tokenBudget.averageUtilizationRatio,
  });
  const graphWindowDegradation = assessGraphCacheWindowDegradation({
    summary: graphWindowSummary,
    thresholdQueryHitRate: adaptiveThresholds.cacheQueryHitRateThreshold,
    minEntries: minGraphEvidenceEntries,
  });
  const persistentWindowDegradation = assessPersistentGraphWindowDegradation({
    status: persistentSignalsActive
      ? persistentGraphStatus
      : { enabled: false },
    thresholdParsedPerScannedMax:
      adaptiveThresholds.persistentParsedPerScannedMaxThreshold,
    thresholdReusedPerScannedMin:
      adaptiveThresholds.persistentReusedPerScannedMinThreshold,
    thresholdRemovedPerScannedMax:
      adaptiveThresholds.persistentRemovedPerScannedMaxThreshold,
    minEntries: minGraphEvidenceEntries,
    minScannedFiles: GRAPH_AUTOTUNE_PERSISTENT_MIN_SCANNED_FILES,
  });
  const graphQualitySignals = deriveGraphQualitySignals({
    cacheWindow: graphWindowDegradation,
    persistentWindow: persistentWindowDegradation,
  });
  const adaptiveAction = deriveAdaptiveGraphActionProfile({
    state: graphAutotuneState,
    graphWindowSummary,
    graphWindowDegradation,
    persistentWindowDegradation,
    graphQualitySignals,
    promptQualityWindowSummary,
    minEvidenceEntries: minGraphEvidenceEntries,
  });
  const graphAutotuneDecision = resolveGraphQualityAutotuneDecision({
    baseConfig: runnerInput.contextEngineConfig,
    allowProactiveCompaction: input.allowProactiveCompaction,
    graphWindowSummary,
    graphWindowDegradation,
    persistentWindowDegradation,
    graphQualitySignals,
    persistentSignalsActive,
    adaptiveThresholds,
    adaptiveAction,
    promptQualityWindowSummary,
    state: graphAutotuneState,
  });
  const graphAutotuneStatePersisted: GraphQualityAutotuneState = {
    ...graphAutotuneDecision.stateAfter,
    cacheDegradeQueryHitRateThreshold:
      adaptiveThresholds.cacheQueryHitRateThreshold,
    persistentDegradeParsedPerScannedMax:
      adaptiveThresholds.persistentParsedPerScannedMaxThreshold,
    persistentDegradeReusedPerScannedMin:
      adaptiveThresholds.persistentReusedPerScannedMinThreshold,
    persistentDegradeRemovedPerScannedMax:
      adaptiveThresholds.persistentRemovedPerScannedMaxThreshold,
    adaptiveLearnAlpha: adaptiveThresholds.learnAlpha,
    adaptiveUpdates: adaptiveThresholds.updates,
    adaptiveSource: adaptiveThresholds.source,
    adaptiveActionScale: adaptiveAction.scale,
    adaptiveActionUpdates: adaptiveAction.updates,
    adaptiveActionSource: adaptiveAction.source,
  };
  writeGraphQualityAutotuneState({
    workDir: runnerInput.workDir,
    state: graphAutotuneStatePersisted,
  });
  if (
    graphAutotuneDecision.changed ||
    graphAutotuneDecision.suppressedBy !== "none"
  ) {
    input.writeTurnDiagnostic(
      buildGraphQualityAutotuneDiagnostic(graphAutotuneDecision),
    );
  }
  return {
    promptQualityConfig,
    promptQualityWindowSummary,
    graphAutotuneDecision,
  };
}
