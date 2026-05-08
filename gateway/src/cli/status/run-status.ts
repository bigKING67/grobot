import { resolveExecutionPlaneConfig } from "../../orchestration/execution-plane";
import { buildSessionKey } from "../../models/session-key";
import { hasFlag, OptionValue, readOptionString } from "../cli-args";
import { CLI_PRODUCT_ENGINE } from "../product-identity";
import {
  GLOBAL_TURN_GATE,
  serializeTurnGateSnapshot,
} from "../../orchestration/orchestrator/turn-gate";
import {
  readProviderPoolFromToml,
  readProviderSnapshotFromToml,
} from "../provider-probe";
import {
  resolveRuntimeBinaryPath,
  runRuntimeHealthcheck,
} from "../runtime-health";
import { maskSecret } from "../services/redaction";
import {
  readRuntimeToolSurfaceMetrics,
} from "../../tools/runtime/tool-events";
import { buildRuntimeToolRecoveryDecision } from "../../tools/runtime/tool-recovery-decision";
import {
  readRuntimeToolSurfaceAdaptationState,
} from "../../tools/runtime/tool-surface-adaptation-state";
import {
  assessGraphCacheWindowDegradation,
  assessPersistentGraphWindowDegradation,
  deriveGraphQualitySignals,
  derivePromptQualityGuardAdaptivePolicy,
  assessPromptQualityGuardRuntime,
  assessPromptQualityWindowDegradation,
  readContextGraphCacheStats,
  readGraphCacheWindowSummary,
  readGraphQualityAutotuneState,
  readPromptQualityGuardState,
  readPromptQualityWindowSummary,
  resolveContextEngineConfig,
  resolveContextStorageDomain,
  resolvePromptTargetTokenLimit,
} from "../../tools/context";
import { readPersistentGraphIndexStatus } from "../../tools/context/graph/persistent-index";
import {
  applyMemoryDecayAutotuneToPolicy,
  applyMemoryStrategyAutotuneToPolicy,
  defaultMemoryOrchestratorPolicy,
  readMemoryDecayAutotuneState,
  readMemoryStrategyAutotuneState,
} from "../../tools/memory";
import {
  basenameFromPath,
  resolveConfigTomlPath,
  resolveHomeDir,
  resolveProjectStateRoot,
  resolveProjectRoot,
  resolveProjectTomlPath,
  resolveWorkDir,
} from "../services/runtime-paths";
import {
  parsePlatform,
  parseScope,
  resolveSessionPlatformOption,
  resolveSessionScopeOption,
  resolveSessionSubjectOption,
} from "../start/session/options";
import {
  readGraphCacheCounter,
  resolveContextEngineRuntimeModelConfig,
} from "./context-engine-status";
import { serializeContextEngineStatus } from "./context-engine-json";
import {
  serializeContextGraphCacheStatsStatus,
  serializeContextGraphQualitySignalsStatus,
  serializeContextPersistentGraphIndexStatus,
} from "./context-graph-json";
import {
  parseOptionalPositiveInt,
  parseRequiredPositiveInt,
  parseRequiredRatio,
} from "./option-parsing";
import {
  formatStatusProviderProbeLines,
  resolveStatusProviderProbe,
  serializeStatusProviderProbe,
} from "./provider-probe-status";
import {
  formatRouteStatusLines,
  readRouteObservedRuntimeSummary,
  resolveRouteDecisionSummary,
  serializeRouteDecisionSummary,
} from "./route-status";
import {
  formatRuntimeHealthStatusLines,
  resolveRuntimeCacheStatsLocation,
  serializeRuntimeHealthStatus,
} from "./runtime-health-format";
import { resolveRuntimeToolContextPreview } from "./runtime-tool-context-preview";
import { serializeRuntimeToolsStatus } from "./runtime-tool-json";
import { buildRuntimeToolQualitySummary } from "./runtime-tool-quality";
import { formatRuntimeToolStatusLines } from "./runtime-tool-status-lines";
import { renderInfoPanel } from "../tui/components/info-panel/render";
import {
  displayValue,
  enabledText,
  formatProbeSummary,
  formatRouteSummary,
  formatRuntimeHealthSummary,
  humanizeConfigSource,
  humanizeExecutionSource,
  humanizeMachineToken,
  humanizeStatusSource,
} from "./human-status-format";

export async function runStatus(options: Record<string, OptionValue>): Promise<number> {
  const outputJson = hasFlag(options, "json");
  const turnGate = serializeTurnGateSnapshot(GLOBAL_TURN_GATE.snapshot());
  const homeDir = resolveHomeDir(options);
  const projectRoot = resolveProjectRoot(options, homeDir);
  const workDir = resolveWorkDir(options, projectRoot, homeDir);
  const projectStateRoot = resolveProjectStateRoot(workDir);
  const projectTomlPath = resolveProjectTomlPath(options, workDir, projectRoot, homeDir);
  const configTomlPath = resolveConfigTomlPath(options, homeDir, { workDir, projectRoot });
  const configSource =
    configTomlPath == null
      ? "none"
      : configTomlPath.startsWith(`${workDir}/.grobot/`)
        ? "project_work_dir"
        : configTomlPath.startsWith(`${projectRoot}/.grobot/`)
          ? "project_root"
          : configTomlPath.startsWith(`${homeDir}/`)
            ? "home"
            : "custom";
  const projectName = readOptionString(options, "project") ?? basenameFromPath(workDir);
  const sessionScopeRaw = resolveSessionScopeOption(options);
  const sessionSubject = resolveSessionSubjectOption(options) ?? process.env.USER ?? "user";
  const providerOverrideFromCli = readOptionString(options, "provider");
  const providerOverrideFromEnv = process.env.GROBOT_PROVIDER;
  const modelFromCli = readOptionString(options, "model");
  const modelFromEnv = process.env.GROBOT_MODEL;
  const baseUrlFromCli = readOptionString(options, "base-url");
  const baseUrlFromEnv = process.env.GROBOT_BASE_URL;
  const apiKeyFromCli = readOptionString(options, "api-key");
  const apiKeyFromEnv = process.env.GROBOT_API_KEY;
  const projectProviderPoolSnapshot = readProviderPoolFromToml(
    configTomlPath,
    projectName,
    workDir,
    homeDir,
    providerOverrideFromCli,
  );
  const projectProviderSnapshot = readProviderSnapshotFromToml(
    configTomlPath,
    projectName,
    workDir,
    homeDir,
    providerOverrideFromCli,
  );
  const providerName = providerOverrideFromCli ??
    providerOverrideFromEnv ??
    projectProviderSnapshot?.providerName ??
    "<auto>";
  const modelName = modelFromCli ??
    modelFromEnv ??
    projectProviderSnapshot?.provider?.model ??
    "<auto>";
  const baseUrl = baseUrlFromCli ??
    baseUrlFromEnv ??
    projectProviderSnapshot?.provider?.baseUrl ??
    "<auto>";
  const apiKey = apiKeyFromCli ??
    apiKeyFromEnv ??
    projectProviderSnapshot?.provider?.apiKey;
  const hasDirectRuntimeOverride = Boolean(baseUrlFromCli)
    || Boolean(baseUrlFromEnv)
    || Boolean(apiKeyFromCli)
    || Boolean(apiKeyFromEnv)
    || Boolean(modelFromCli)
    || Boolean(modelFromEnv);
  const circuitFailures = parseRequiredPositiveInt(
    readOptionString(options, "circuit-failures"),
    2,
  );
  const circuitCooldownSecs = parseRequiredPositiveInt(
    readOptionString(options, "circuit-cooldown-secs"),
    30,
  );
  const cacheStatsWindowMs = parseOptionalPositiveInt(
    readOptionString(options, "cache-stats-window-ms"),
  );
  const resetCacheStatsWindow = hasFlag(options, "cache-stats-reset-window");
  const contextGraphCacheWindowSize = parseRequiredPositiveInt(
    readOptionString(options, "context-graph-cache-window-size")
      ?? process.env.GROBOT_CONTEXT_GRAPH_CACHE_WINDOW_SIZE,
    20,
  );
  const contextGraphCacheDegradeHitRateThreshold = parseRequiredRatio(
    readOptionString(options, "context-graph-cache-degrade-hit-rate")
      ?? process.env.GROBOT_CONTEXT_GRAPH_CACHE_DEGRADE_HIT_RATE,
    0.3,
  );
  const contextGraphCacheDegradeMinEntries = parseRequiredPositiveInt(
    readOptionString(options, "context-graph-cache-degrade-min-entries")
      ?? process.env.GROBOT_CONTEXT_GRAPH_CACHE_DEGRADE_MIN_ENTRIES,
    8,
  );
  const contextPersistentGraphDegradeParsedPerScannedMax = parseRequiredRatio(
    readOptionString(options, "context-persistent-graph-degrade-parsed-rate")
      ?? process.env.GROBOT_CONTEXT_PERSISTENT_GRAPH_DEGRADE_PARSED_RATE,
    0.35,
  );
  const contextPersistentGraphDegradeReusedPerScannedMin = parseRequiredRatio(
    readOptionString(options, "context-persistent-graph-degrade-reused-rate")
      ?? process.env.GROBOT_CONTEXT_PERSISTENT_GRAPH_DEGRADE_REUSED_RATE,
    0.55,
  );
  const contextPersistentGraphDegradeRemovedPerScannedMax = parseRequiredRatio(
    readOptionString(options, "context-persistent-graph-degrade-removed-rate")
      ?? process.env.GROBOT_CONTEXT_PERSISTENT_GRAPH_DEGRADE_REMOVED_RATE,
    0.2,
  );
  const contextPersistentGraphDegradeMinEntries = parseRequiredPositiveInt(
    readOptionString(options, "context-persistent-graph-degrade-min-entries")
      ?? process.env.GROBOT_CONTEXT_PERSISTENT_GRAPH_DEGRADE_MIN_ENTRIES,
    8,
  );
  const contextPersistentGraphDegradeMinScannedFiles = parseRequiredPositiveInt(
    readOptionString(options, "context-persistent-graph-degrade-min-scanned-files")
      ?? process.env.GROBOT_CONTEXT_PERSISTENT_GRAPH_DEGRADE_MIN_SCANNED_FILES,
    40,
  );
  const sessionPreview = buildSessionKey({
    platform: parsePlatform(resolveSessionPlatformOption(options)),
    tenant: readOptionString(options, "tenant") ?? projectName,
    scope: parseScope(sessionScopeRaw),
    subject: sessionSubject,
  });
  const observedRuntime = readRouteObservedRuntimeSummary({
    projectStateRoot,
    sessionNamespaceKey: sessionPreview,
    orderedProviders: projectProviderPoolSnapshot?.providers.map((provider) => provider.name) ?? [],
  });
  const routeDecision = resolveRouteDecisionSummary({
    providerOverride: providerOverrideFromCli,
    providerEnv: providerOverrideFromEnv,
    providerPoolSnapshot: projectProviderPoolSnapshot
      ? {
          source: projectProviderPoolSnapshot.source,
          providerName: projectProviderPoolSnapshot.providerName,
          providers: projectProviderPoolSnapshot.providers.map((provider) => ({
            name: provider.name,
          })),
        }
      : undefined,
    observedRuntime,
    hasDirectRuntimeOverride,
    circuitFailures,
    circuitCooldownSecs,
  });
  const executionPlane = resolveExecutionPlaneConfig({
    gatewayImplArg: readOptionString(options, "gateway-impl"),
    runtimeImplArg: readOptionString(options, "runtime-impl"),
    shadowModeArg: hasFlag(options, "shadow-mode"),
    noShadowModeArg: hasFlag(options, "no-shadow-mode"),
    projectTomlPath,
  });
  const runtimeToolSurfaceMetrics = readRuntimeToolSurfaceMetrics(workDir);
  const runtimeToolSurfaceAdaptationSnapshot = readRuntimeToolSurfaceAdaptationState(workDir);
  const runtimeToolRecoveryDecision = buildRuntimeToolRecoveryDecision({
    metrics: runtimeToolSurfaceMetrics,
    adaptationSnapshot: runtimeToolSurfaceAdaptationSnapshot,
  });
  const runtimeToolRecoveryFeedback = runtimeToolRecoveryDecision.feedback;
  const runtimeToolRecoveryTimeline = runtimeToolRecoveryDecision.timeline;
  const runtimeToolRecoveryHealth = runtimeToolRecoveryDecision.health;
  const runtimeToolRecoveryPolicy = runtimeToolRecoveryDecision.policy;
  const runtimeToolRecoveryReadiness = runtimeToolRecoveryDecision.readiness;
  const runtimeToolRecoveryGate = runtimeToolRecoveryDecision.gate;
  const runtimeBinaryPath = executionPlane.runtimeImpl === "rust" ? resolveRuntimeBinaryPath() : undefined;
  const runtimeToolContextPreview = resolveRuntimeToolContextPreview(
    projectTomlPath,
    runtimeBinaryPath,
    runtimeToolRecoveryFeedback,
    runtimeToolRecoveryGate,
    runtimeToolSurfaceAdaptationSnapshot,
  );
  const parsedScope = parseScope(sessionScopeRaw);
  const maskedApiKey = maskSecret(apiKey);
  const runtimeHealth =
    executionPlane.runtimeImpl === "rust" && runtimeBinaryPath
      ? runRuntimeHealthcheck(runtimeBinaryPath, {
        cacheStatsWindowMs,
        resetCacheStatsWindow,
      })
      : undefined;
  const runtimeToolQuality = buildRuntimeToolQualitySummary({
    runtimeImpl: executionPlane.runtimeImpl,
    runtimeBinaryPath,
    runtimeHealth,
    contextPreview: runtimeToolContextPreview,
    recoveryHealth: runtimeToolRecoveryHealth,
    recoveryGate: runtimeToolRecoveryGate,
  });
  const contextEngineRuntimeModelConfig = resolveContextEngineRuntimeModelConfig({
    providerSnapshot: projectProviderSnapshot,
    baseUrlFromCli,
    baseUrlFromEnv,
    modelFromCli,
    modelFromEnv,
  });
  const contextEngineConfig = resolveContextEngineConfig({
    projectTomlPath,
    runtimeModelConfig: contextEngineRuntimeModelConfig,
  });
  const contextEngineTokenBudget = resolvePromptTargetTokenLimit(contextEngineConfig);
  const contextEngineEffectiveWindowTokens = contextEngineTokenBudget.effectiveWindowTokens;
  const memoryOrchestratorBasePolicy = defaultMemoryOrchestratorPolicy();
  const memoryDecayAutotuneState = readMemoryDecayAutotuneState({
    workDir,
    basePolicy: memoryOrchestratorBasePolicy,
  });
  const memoryPolicyAfterDecayAutotune = applyMemoryDecayAutotuneToPolicy({
    basePolicy: memoryOrchestratorBasePolicy,
    state: memoryDecayAutotuneState,
  });
  const memoryStrategyAutotuneState = readMemoryStrategyAutotuneState({
    workDir,
    basePolicy: memoryOrchestratorBasePolicy,
  });
  const memoryOrchestratorPolicy = applyMemoryStrategyAutotuneToPolicy({
    basePolicy: memoryPolicyAfterDecayAutotune,
    state: memoryStrategyAutotuneState,
  });
  const contextGraphCacheStats = readContextGraphCacheStats();
  const symbolQueryGraphCacheStats = readGraphCacheCounter(contextGraphCacheStats, "symbol_query");
  const symbolDeclarationGraphCacheStats = readGraphCacheCounter(contextGraphCacheStats, "symbol_declaration");
  const dependencyQueryGraphCacheStats = readGraphCacheCounter(contextGraphCacheStats, "dependency_query");
  const dependencyImportGraphCacheStats = readGraphCacheCounter(contextGraphCacheStats, "dependency_import");
  const contextGraphCacheWindowSummary = readGraphCacheWindowSummary({
    workDir,
    size: contextGraphCacheWindowSize,
  });
  const contextGraphCacheWindowDegradation = assessGraphCacheWindowDegradation({
    summary: contextGraphCacheWindowSummary,
    thresholdQueryHitRate: contextGraphCacheDegradeHitRateThreshold,
    minEntries: contextGraphCacheDegradeMinEntries,
  });
  const graphQualityAutotuneState = readGraphQualityAutotuneState({
    workDir,
  });
  const persistentGraphIndexStatus = readPersistentGraphIndexStatus({
    workDir,
    windowSize: contextGraphCacheWindowSize,
  });
  const persistentGraphWindowDegradation = assessPersistentGraphWindowDegradation({
    status: persistentGraphIndexStatus,
    thresholdParsedPerScannedMax: contextPersistentGraphDegradeParsedPerScannedMax,
    thresholdReusedPerScannedMin: contextPersistentGraphDegradeReusedPerScannedMin,
    thresholdRemovedPerScannedMax: contextPersistentGraphDegradeRemovedPerScannedMax,
    minEntries: contextPersistentGraphDegradeMinEntries,
    minScannedFiles: contextPersistentGraphDegradeMinScannedFiles,
  });
  const graphQualitySignals = deriveGraphQualitySignals({
    cacheWindow: contextGraphCacheWindowDegradation,
    persistentWindow: persistentGraphWindowDegradation,
  });
  const promptQualityWindowSummary = readPromptQualityWindowSummary({
    workDir,
    size: contextGraphCacheWindowSize,
    lowQualityThreshold: contextEngineConfig.promptQuality?.lowQualityThreshold,
  });
  const promptQualityWindowDegradation = assessPromptQualityWindowDegradation({
    summary: promptQualityWindowSummary,
    thresholdOverall: contextEngineConfig.promptQuality?.degradeOverallThreshold ?? 0.62,
    thresholdLowQualityRate: contextEngineConfig.promptQuality?.degradeLowQualityRateThreshold ?? 0.4,
    minEntries: contextEngineConfig.promptQuality?.degradeMinEntries ?? 8,
  });
  const promptQualityGuardState = readPromptQualityGuardState({
    workDir,
  });
  const promptQualityGuardRuntimeAssessment = assessPromptQualityGuardRuntime({
    policy: {
      enabled: contextEngineConfig.promptQuality?.guardEnabled ?? true,
      promoteStreak: contextEngineConfig.promptQuality?.guardPromoteStreak ?? 2,
      severePromoteStreak: contextEngineConfig.promptQuality?.guardSeverePromoteStreak ?? 2,
      releaseStreak: contextEngineConfig.promptQuality?.guardReleaseStreak ?? 3,
      holdTurns: contextEngineConfig.promptQuality?.guardHoldTurns ?? 2,
      maxFloorStage: contextEngineConfig.promptQuality?.guardMaxFloorStage ?? "minimal",
      severeOverallThreshold: contextEngineConfig.promptQuality?.guardSevereOverallThreshold ?? 0.45,
      severeLowQualityRateThreshold:
        contextEngineConfig.promptQuality?.guardSevereLowQualityRateThreshold ?? 0.7,
    },
    currentState: promptQualityGuardState,
    observation: {
      degraded: promptQualityWindowDegradation.degraded,
      reason: promptQualityWindowDegradation.reason,
      observedOverall: promptQualityWindowDegradation.observedOverall,
      observedLowQualityRate: promptQualityWindowDegradation.observedLowQualityRate,
    },
  });
  const promptQualityGuardAdaptivePolicy = derivePromptQualityGuardAdaptivePolicy({
    basePolicy: {
      enabled: contextEngineConfig.promptQuality?.guardEnabled ?? true,
      promoteStreak: contextEngineConfig.promptQuality?.guardPromoteStreak ?? 2,
      severePromoteStreak: contextEngineConfig.promptQuality?.guardSeverePromoteStreak ?? 2,
      releaseStreak: contextEngineConfig.promptQuality?.guardReleaseStreak ?? 3,
      holdTurns: contextEngineConfig.promptQuality?.guardHoldTurns ?? 2,
      maxFloorStage: contextEngineConfig.promptQuality?.guardMaxFloorStage ?? "minimal",
      severeOverallThreshold: contextEngineConfig.promptQuality?.guardSevereOverallThreshold ?? 0.45,
      severeLowQualityRateThreshold:
        contextEngineConfig.promptQuality?.guardSevereLowQualityRateThreshold ?? 0.7,
    },
    adaptiveEnabled: contextEngineConfig.promptQuality?.guardAdaptiveEnabled ?? true,
    adaptiveModeAllowlist: contextEngineConfig.promptQuality?.guardAdaptiveModeAllowlist,
    currentState: promptQualityGuardState,
    window: {
      degraded: promptQualityWindowDegradation.degraded,
      reason: promptQualityWindowDegradation.reason,
      lowQualityRate: promptQualityWindowSummary.lowQualityRate,
      averageOverall: promptQualityWindowSummary.averageScores?.overall ?? null,
      observedOverall: promptQualityWindowDegradation.observedOverall,
      observedLowQualityRate: promptQualityWindowDegradation.observedLowQualityRate,
      snapshotSemanticCompressRate:
        promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate,
      autoLimitTriggeredRate:
        promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate,
      averageUtilizationRatio:
        promptQualityWindowSummary.tokenBudget.averageUtilizationRatio,
      shortSnapshotSemanticCompressRate:
        promptQualityWindowSummary.pressureTrends.short.snapshotSemanticCompressRate,
      mediumSnapshotSemanticCompressRate:
        promptQualityWindowSummary.pressureTrends.medium.snapshotSemanticCompressRate,
      shortAutoLimitTriggeredRate:
        promptQualityWindowSummary.pressureTrends.short.autoLimitTriggeredRate,
      mediumAutoLimitTriggeredRate:
        promptQualityWindowSummary.pressureTrends.medium.autoLimitTriggeredRate,
      shortAverageUtilizationRatio:
        promptQualityWindowSummary.pressureTrends.short.averageUtilizationRatio,
      mediumAverageUtilizationRatio:
        promptQualityWindowSummary.pressureTrends.medium.averageUtilizationRatio,
      hardBudgetStrategyRate:
        promptQualityWindowSummary.strategyActivity.hardBudgetRate,
      qualityFirstStrategyRate:
        promptQualityWindowSummary.strategyActivity.qualityFirstRate,
      averagePreSendOverflowRatio:
        promptQualityWindowSummary.signalAverages?.preSendOverflowRatio ?? null,
      averagePreSendPressureScore:
        promptQualityWindowSummary.signalAverages?.preSendPressureScore ?? null,
      shortHardBudgetStrategyRate:
        promptQualityWindowSummary.strategyTrends.short.hardBudgetRate,
      mediumHardBudgetStrategyRate:
        promptQualityWindowSummary.strategyTrends.medium.hardBudgetRate,
      shortAveragePreSendOverflowRatio:
        promptQualityWindowSummary.strategyTrends.short.averageOverflowRatio,
      mediumAveragePreSendOverflowRatio:
        promptQualityWindowSummary.strategyTrends.medium.averageOverflowRatio,
      shortAveragePreSendPressureScore:
        promptQualityWindowSummary.strategyTrends.short.averagePressureScore,
      mediumAveragePreSendPressureScore:
        promptQualityWindowSummary.strategyTrends.medium.averagePressureScore,
      hardBudgetFollowupOverallDelta:
        promptQualityWindowSummary.strategyOutcomes.hardBudgetFollowupOverallDelta,
      qualityFirstFollowupOverallDelta:
        promptQualityWindowSummary.strategyOutcomes.qualityFirstFollowupOverallDelta,
      hardBudgetRecoveryRate:
        promptQualityWindowSummary.strategyOutcomes.hardBudgetRecoveryRate,
      qualityFirstImprovedRate:
        promptQualityWindowSummary.strategyOutcomes.qualityFirstImprovedRate,
      hardBudgetTransitionCount:
        promptQualityWindowSummary.strategyOutcomes.hardBudgetTransitions,
      qualityFirstTransitionCount:
        promptQualityWindowSummary.strategyOutcomes.qualityFirstTransitions,
    },
  });
  const graphCacheWindowPersistenceDomain = resolveContextStorageDomain("graph_cache_window");
  const promptQualityWindowPersistenceDomain = resolveContextStorageDomain("prompt_quality_window");
  const graphAutotuneStatePersistenceDomain = resolveContextStorageDomain(
    "graph_quality_autotune_state",
  );
  const promptQualityGuardStatePersistenceDomain = resolveContextStorageDomain(
    "prompt_quality_guard_state",
  );
  const memoryDecayAutotuneStatePersistenceDomain = resolveContextStorageDomain(
    "memory_decay_autotune_state",
  );
  const memoryStrategyAutotuneStatePersistenceDomain = resolveContextStorageDomain(
    "memory_strategy_autotune_state",
  );
  const persistentGraphIndexPersistenceDomain = resolveContextStorageDomain("graph_persistent_index");
  const persistentGraphIndexWindowPersistenceDomain = resolveContextStorageDomain(
    "graph_persistent_index_window",
  );
  const lineageDiffCachePersistenceDomain = resolveContextStorageDomain("lineage_diff_cache");

  const providerProbe = await resolveStatusProviderProbe({
    requested: hasFlag(options, "probe"),
    baseUrlFromCli,
    baseUrlFromEnv,
    apiKeyFromCli,
    apiKeyFromEnv,
    modelFromCli,
    modelFromEnv,
    projectProviderSnapshot,
  });

  if (outputJson) {
    const contextGraphQualitySignals = serializeContextGraphQualitySignalsStatus({
      contextGraphCacheWindowDegradation,
      persistentGraphWindowDegradation,
      graphQualitySignals,
    });
    const payload: Record<string, unknown> = {
      status: "ok",
      engine: CLI_PRODUCT_ENGINE,
      home: homeDir,
      project_root: projectRoot,
      work_dir: workDir,
      config_toml: configTomlPath ?? null,
      config_source: configSource,
      project_toml: projectTomlPath ?? null,
      project: projectName,
      provider: providerName,
      provider_source: projectProviderSnapshot?.source ?? null,
      model: modelName,
      base_url: baseUrl,
      api_key: maskedApiKey,
      session_scope: parsedScope,
      session_subject: sessionSubject,
      session_preview: sessionPreview,
      route_decision: serializeRouteDecisionSummary(routeDecision),
      execution: {
        gateway_impl: executionPlane.gatewayImpl,
        gateway_impl_source: executionPlane.gatewayImplSource,
        runtime_impl: executionPlane.runtimeImpl,
        runtime_impl_source: executionPlane.runtimeImplSource,
        shadow_mode: executionPlane.shadowMode,
        shadow_mode_source: executionPlane.shadowModeSource,
      },
      runtime_tools: serializeRuntimeToolsStatus({
        workDir,
        contextPreview: runtimeToolContextPreview,
        quality: runtimeToolQuality,
        metrics: runtimeToolSurfaceMetrics,
        recoveryFeedback: runtimeToolRecoveryFeedback,
        recoveryTimeline: runtimeToolRecoveryTimeline,
        recoveryHealth: runtimeToolRecoveryHealth,
        recoveryPolicy: runtimeToolRecoveryPolicy,
        recoveryReadiness: runtimeToolRecoveryReadiness,
        recoveryGate: runtimeToolRecoveryGate,
        adaptationSnapshot: runtimeToolSurfaceAdaptationSnapshot,
      }),
      runtime_tools_quality: runtimeToolQuality,
      context_graph_cache_stats: serializeContextGraphCacheStatsStatus({
        symbolQueryGraphCacheStats,
        symbolDeclarationGraphCacheStats,
        dependencyQueryGraphCacheStats,
        dependencyImportGraphCacheStats,
        graphQualityAutotuneState,
        graphAutotuneStatePersistenceDomain,
        contextGraphCacheWindowSummary,
        graphCacheWindowPersistenceDomain,
        contextGraphCacheWindowDegradation,
      }),
      context_persistent_graph_index: serializeContextPersistentGraphIndexStatus({
        persistentGraphIndexStatus,
        persistentGraphIndexPersistenceDomain,
        persistentGraphIndexWindowPersistenceDomain,
        persistentGraphWindowDegradation,
      }),
      context_engine: serializeContextEngineStatus({
        contextEngineConfig,
        contextEngineTokenBudget,
        promptQualityGuardState,
        promptQualityGuardStatePersistenceDomain,
        promptQualityGuardRuntimeAssessment,
        promptQualityGuardAdaptivePolicy,
        promptQualityWindowSummary,
        promptQualityWindowDegradation,
        promptQualityWindowPersistenceDomain,
        lineageDiffCachePersistenceDomain,
        memoryOrchestratorPolicy,
        memoryDecayAutotuneState,
        memoryDecayAutotuneStatePersistenceDomain,
        memoryStrategyAutotuneState,
        memoryStrategyAutotuneStatePersistenceDomain,
        graphQualitySignals: contextGraphQualitySignals,
      }),
      runtime_health: serializeRuntimeHealthStatus(runtimeHealth, runtimeBinaryPath),
      turn_gate: turnGate,
      cache_stats_location: resolveRuntimeCacheStatsLocation(runtimeHealth),
      probe: serializeStatusProviderProbe(providerProbe.probeResult),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return providerProbe.exitCode;
  }

  if (process.env.GROBOT_STATUS_LEGACY_TEXT !== "1") {
    const runtimeHealthRow = formatRuntimeHealthSummary(runtimeHealth, runtimeBinaryPath);
    const probeRow = formatProbeSummary(providerProbe.probeResult);
    process.stdout.write(renderInfoPanel({
      title: "Grobot status",
      subtitle: "Default view shows an actionable summary; use grobot status --json for the full machine snapshot.",
      sections: [{
        rows: [
          {
            title: "Running normally",
            detailLines: [
              `engine ${humanizeMachineToken(CLI_PRODUCT_ENGINE)}`,
              `project ${projectName}`,
              `directory ${workDir}`,
              `config ${humanizeConfigSource(configSource)}`,
            ],
          },
          {
            title: `Model ${displayValue(modelName)}`,
            detailLines: [
              `provider ${displayValue(providerName)}`,
              `config ${humanizeStatusSource(projectProviderSnapshot?.source, configSource)}`,
              `endpoint ${displayValue(baseUrl)}`,
              `api key ${displayValue(maskedApiKey)}`,
            ],
          },
          formatRouteSummary(routeDecision),
          {
            title: `Execution Gateway ${executionPlane.gatewayImpl} · Runtime ${executionPlane.runtimeImpl}`,
            detailLines: [
              `source Gateway ${humanizeExecutionSource(executionPlane.gatewayImplSource)} · Runtime ${humanizeExecutionSource(executionPlane.runtimeImplSource)}`,
              `shadow execution ${enabledText(executionPlane.shadowMode)}`,
            ],
          },
          {
            title: `Context ${enabledText(contextEngineConfig.enabled)}`,
            detailLines: [
              `window ${String(contextEngineEffectiveWindowTokens)}`,
              `target ${String(contextEngineTokenBudget.targetTokenLimit)}`,
              `auto compact ${String(contextEngineTokenBudget.autoCompactTokenLimit)}`,
              `strategy ${humanizeMachineToken(contextEngineConfig.profile)}`,
            ],
          },
          ...(runtimeHealthRow ? [runtimeHealthRow] : []),
          {
            title: `Turn gate ${turnGate.active_sessions > 0 ? "active" : "idle"}`,
            detailLines: [
              `active ${String(turnGate.active_sessions)} · tracked ${String(turnGate.tracked_sessions)}`,
              `rejected ${String(turnGate.rejected_reentrant_total)} · stale cleanup ${String(turnGate.stale_cleanup_total)}`,
            ],
          },
          ...(probeRow ? [probeRow] : []),
        ],
      }],
      footerLines: [
        "Full machine snapshot: grobot status --json",
      ],
    }));
    return providerProbe.exitCode;
  }

  process.stdout.write("status: ok\n");
  process.stdout.write(`engine: ${CLI_PRODUCT_ENGINE}\n`);
  process.stdout.write(`home: ${homeDir}\n`);
  process.stdout.write(`project_root: ${projectRoot}\n`);
  process.stdout.write(`work_dir: ${workDir}\n`);
  process.stdout.write(`config_toml: ${configTomlPath ?? "<not-found>"}\n`);
  process.stdout.write(`config_source: ${configSource}\n`);
  process.stdout.write(`project_toml: ${projectTomlPath ?? "<not-found>"}\n`);
  process.stdout.write(`project: ${projectName}\n`);
  process.stdout.write(`provider: ${providerName}\n`);
  if (projectProviderSnapshot?.source) {
    process.stdout.write(`provider_source: ${projectProviderSnapshot.source}\n`);
  }
  process.stdout.write(`model: ${modelName}\n`);
  process.stdout.write(`base_url: ${baseUrl}\n`);
  process.stdout.write(`api_key: ${maskedApiKey}\n`);
  process.stdout.write(`session_scope: ${parsedScope}\n`);
  process.stdout.write(`session_subject: ${sessionSubject}\n`);
  process.stdout.write(`session_preview: ${sessionPreview}\n`);
  for (const line of formatRouteStatusLines(routeDecision)) {
    process.stdout.write(`${line}\n`);
  }
  process.stdout.write(
    `execution: gateway=${executionPlane.gatewayImpl}(${executionPlane.gatewayImplSource}) runtime=${executionPlane.runtimeImpl}(${executionPlane.runtimeImplSource}) shadow=${executionPlane.shadowMode ? "on" : "off"}(${executionPlane.shadowModeSource})\n`,
  );
  process.stdout.write(
    `turn_gate: active_sessions=${String(turnGate.active_sessions)} rejected_reentrant_total=${String(turnGate.rejected_reentrant_total)} stale_cleanup_total=${String(turnGate.stale_cleanup_total)} tracked_sessions=${String(turnGate.tracked_sessions)}\n`,
  );
  for (const line of formatRuntimeToolStatusLines({
    workDir,
    contextPreview: runtimeToolContextPreview,
    quality: runtimeToolQuality,
    metrics: runtimeToolSurfaceMetrics,
    recoveryFeedback: runtimeToolRecoveryFeedback,
    recoveryTimeline: runtimeToolRecoveryTimeline,
    recoveryHealth: runtimeToolRecoveryHealth,
    recoveryPolicy: runtimeToolRecoveryPolicy,
    recoveryReadiness: runtimeToolRecoveryReadiness,
    recoveryGate: runtimeToolRecoveryGate,
    adaptationSnapshot: runtimeToolSurfaceAdaptationSnapshot,
  })) {
    process.stdout.write(`${line}\n`);
  }
  process.stdout.write(
    `context_graph_cache_stats: symbol_query=${symbolQueryGraphCacheStats.hit}/${symbolQueryGraphCacheStats.miss}/${symbolQueryGraphCacheStats.write}/${symbolQueryGraphCacheStats.evict} symbol_declaration=${symbolDeclarationGraphCacheStats.hit}/${symbolDeclarationGraphCacheStats.miss}/${symbolDeclarationGraphCacheStats.write}/${symbolDeclarationGraphCacheStats.evict} dependency_query=${dependencyQueryGraphCacheStats.hit}/${dependencyQueryGraphCacheStats.miss}/${dependencyQueryGraphCacheStats.write}/${dependencyQueryGraphCacheStats.evict} dependency_import=${dependencyImportGraphCacheStats.hit}/${dependencyImportGraphCacheStats.miss}/${dependencyImportGraphCacheStats.write}/${dependencyImportGraphCacheStats.evict}\n`,
  );
  process.stdout.write(
    `context_graph_cache_autotune_state: direction=${graphQualityAutotuneState.lastDirection} hold_turns_remaining=${String(graphQualityAutotuneState.holdTurnsRemaining)} downshift_warmup_streak=${String(graphQualityAutotuneState.downshiftWarmupStreak)} last_reason=${graphQualityAutotuneState.lastReason || "<none>"} updated_at=${graphQualityAutotuneState.updatedAt ?? "<none>"} adaptive_thresholds=${graphQualityAutotuneState.cacheDegradeQueryHitRateThreshold.toFixed(3)}/${graphQualityAutotuneState.persistentDegradeParsedPerScannedMax.toFixed(3)}/${graphQualityAutotuneState.persistentDegradeReusedPerScannedMin.toFixed(3)}/${graphQualityAutotuneState.persistentDegradeRemovedPerScannedMax.toFixed(3)} adaptive_alpha=${graphQualityAutotuneState.adaptiveLearnAlpha.toFixed(3)} adaptive_updates=${String(graphQualityAutotuneState.adaptiveUpdates)} adaptive_source=${graphQualityAutotuneState.adaptiveSource || "<none>"} adaptive_action_scale=${graphQualityAutotuneState.adaptiveActionScale.toFixed(3)} adaptive_action_updates=${String(graphQualityAutotuneState.adaptiveActionUpdates)} adaptive_action_source=${graphQualityAutotuneState.adaptiveActionSource || "<none>"} persistence_domain=${graphAutotuneStatePersistenceDomain}\n`,
  );
  process.stdout.write(
    `context_graph_cache_window: size=${contextGraphCacheWindowSummary.configuredSize} entries=${contextGraphCacheWindowSummary.entries} range=${contextGraphCacheWindowSummary.fromTs ?? "<none>"}..${contextGraphCacheWindowSummary.toTs ?? "<none>"} delta_symbol_query=${contextGraphCacheWindowSummary.deltaTotals.symbolQuery.hit}/${contextGraphCacheWindowSummary.deltaTotals.symbolQuery.miss}/${contextGraphCacheWindowSummary.deltaTotals.symbolQuery.write}/${contextGraphCacheWindowSummary.deltaTotals.symbolQuery.evict} delta_symbol_declaration=${contextGraphCacheWindowSummary.deltaTotals.symbolDeclaration.hit}/${contextGraphCacheWindowSummary.deltaTotals.symbolDeclaration.miss}/${contextGraphCacheWindowSummary.deltaTotals.symbolDeclaration.write}/${contextGraphCacheWindowSummary.deltaTotals.symbolDeclaration.evict} delta_dependency_query=${contextGraphCacheWindowSummary.deltaTotals.dependencyQuery.hit}/${contextGraphCacheWindowSummary.deltaTotals.dependencyQuery.miss}/${contextGraphCacheWindowSummary.deltaTotals.dependencyQuery.write}/${contextGraphCacheWindowSummary.deltaTotals.dependencyQuery.evict} delta_dependency_import=${contextGraphCacheWindowSummary.deltaTotals.dependencyImport.hit}/${contextGraphCacheWindowSummary.deltaTotals.dependencyImport.miss}/${contextGraphCacheWindowSummary.deltaTotals.dependencyImport.write}/${contextGraphCacheWindowSummary.deltaTotals.dependencyImport.evict} query_hit_rate=${typeof contextGraphCacheWindowSummary.queryHitRate === "number" ? contextGraphCacheWindowSummary.queryHitRate.toFixed(3) : "<none>"} overall_hit_rate=${typeof contextGraphCacheWindowSummary.overallHitRate === "number" ? contextGraphCacheWindowSummary.overallHitRate.toFixed(3) : "<none>"} persistence_domain=${graphCacheWindowPersistenceDomain}\n`,
  );
  process.stdout.write(
    `context_graph_cache_window_quality: entries_with_quality=${String(contextGraphCacheWindowSummary.quality.entriesWithQuality)} dependency_avg_rows=${typeof contextGraphCacheWindowSummary.quality.dependency.avgRows === "number" ? contextGraphCacheWindowSummary.quality.dependency.avgRows.toFixed(3) : "<none>"} dependency_avg_multi_hop_rows=${typeof contextGraphCacheWindowSummary.quality.dependency.avgMultiHopRows === "number" ? contextGraphCacheWindowSummary.quality.dependency.avgMultiHopRows.toFixed(3) : "<none>"} dependency_avg_max_chain_depth=${typeof contextGraphCacheWindowSummary.quality.dependency.avgMaxChainDepth === "number" ? contextGraphCacheWindowSummary.quality.dependency.avgMaxChainDepth.toFixed(3) : "<none>"} dependency_multi_hop_rate=${typeof contextGraphCacheWindowSummary.quality.dependency.multiHopRate === "number" ? contextGraphCacheWindowSummary.quality.dependency.multiHopRate.toFixed(3) : "<none>"} dependency_depth_4_plus_rate=${typeof contextGraphCacheWindowSummary.quality.dependency.depth4PlusRate === "number" ? contextGraphCacheWindowSummary.quality.dependency.depth4PlusRate.toFixed(3) : "<none>"} symbol_avg_rows=${typeof contextGraphCacheWindowSummary.quality.symbol.avgRows === "number" ? contextGraphCacheWindowSummary.quality.symbol.avgRows.toFixed(3) : "<none>"} symbol_bridge_coverage_rate=${typeof contextGraphCacheWindowSummary.quality.symbol.bridgeCoverageRate === "number" ? contextGraphCacheWindowSummary.quality.symbol.bridgeCoverageRate.toFixed(3) : "<none>"} symbol_breadth_coverage_rate=${typeof contextGraphCacheWindowSummary.quality.symbol.breadthCoverageRate === "number" ? contextGraphCacheWindowSummary.quality.symbol.breadthCoverageRate.toFixed(3) : "<none>"} symbol_avg_bridge=${typeof contextGraphCacheWindowSummary.quality.symbol.avgBridge === "number" ? contextGraphCacheWindowSummary.quality.symbol.avgBridge.toFixed(3) : "<none>"} symbol_avg_breadth=${typeof contextGraphCacheWindowSummary.quality.symbol.avgBreadth === "number" ? contextGraphCacheWindowSummary.quality.symbol.avgBreadth.toFixed(3) : "<none>"} symbol_avg_refs=${typeof contextGraphCacheWindowSummary.quality.symbol.avgRefs === "number" ? contextGraphCacheWindowSummary.quality.symbol.avgRefs.toFixed(3) : "<none>"} symbol_max_refs=${typeof contextGraphCacheWindowSummary.quality.symbol.maxRefs === "number" ? contextGraphCacheWindowSummary.quality.symbol.maxRefs.toFixed(3) : "<none>"}\n`,
  );
  process.stdout.write(
    `context_graph_cache_window_guard: degraded=${contextGraphCacheWindowDegradation.degraded ? "yes" : "no"} reason=${contextGraphCacheWindowDegradation.reason} threshold_query_hit_rate=${contextGraphCacheWindowDegradation.thresholdQueryHitRate.toFixed(3)} min_entries=${contextGraphCacheWindowDegradation.minEntries} observed_entries=${contextGraphCacheWindowDegradation.observedEntries} observed_query_hit_rate=${typeof contextGraphCacheWindowDegradation.observedQueryHitRate === "number" ? contextGraphCacheWindowDegradation.observedQueryHitRate.toFixed(3) : "<none>"}\n`,
  );
  if (persistentGraphIndexStatus.enabled) {
    const refresh = persistentGraphIndexStatus.last_refresh;
    const window = persistentGraphIndexStatus.window;
    process.stdout.write(
      `context_persistent_graph_index: files=${String(persistentGraphIndexStatus.file_count ?? 0)} symbols=${String(persistentGraphIndexStatus.symbol_count ?? 0)} edges=${String(persistentGraphIndexStatus.edge_count ?? 0)} updated_at=${persistentGraphIndexStatus.updated_at ?? "<none>"} refresh=${refresh?.mode ?? "<none>"}/${String(refresh?.parsed_files ?? 0)}/${String(refresh?.reused_files ?? 0)}/${String(refresh?.removed_files ?? 0)} window_entries=${String(window?.entries ?? 0)} window_parsed_rate=${typeof window?.rates?.parsed_per_scanned === "number" ? window.rates.parsed_per_scanned.toFixed(3) : "<none>"} persistence_domain=${persistentGraphIndexPersistenceDomain} window_persistence_domain=${persistentGraphIndexWindowPersistenceDomain}\n`,
    );
    process.stdout.write(
      `context_persistent_graph_index_guard: degraded=${persistentGraphWindowDegradation.degraded ? "yes" : "no"} reason=${persistentGraphWindowDegradation.reason} threshold_parsed_max=${persistentGraphWindowDegradation.thresholdParsedPerScannedMax.toFixed(3)} threshold_reused_min=${persistentGraphWindowDegradation.thresholdReusedPerScannedMin.toFixed(3)} threshold_removed_max=${persistentGraphWindowDegradation.thresholdRemovedPerScannedMax.toFixed(3)} min_entries=${persistentGraphWindowDegradation.minEntries} min_scanned_files=${persistentGraphWindowDegradation.minScannedFiles} observed_entries=${persistentGraphWindowDegradation.observedEntries} observed_scanned_files=${persistentGraphWindowDegradation.observedScannedFiles} observed_parsed_rate=${typeof persistentGraphWindowDegradation.observedParsedPerScanned === "number" ? persistentGraphWindowDegradation.observedParsedPerScanned.toFixed(3) : "<none>"} observed_reused_rate=${typeof persistentGraphWindowDegradation.observedReusedPerScanned === "number" ? persistentGraphWindowDegradation.observedReusedPerScanned.toFixed(3) : "<none>"} observed_removed_rate=${typeof persistentGraphWindowDegradation.observedRemovedPerScanned === "number" ? persistentGraphWindowDegradation.observedRemovedPerScanned.toFixed(3) : "<none>"}\n`,
    );
  } else {
    process.stdout.write("context_persistent_graph_index: disabled\n");
  }
  process.stdout.write(
    `context_engine_graph_quality_signals: state=${graphQualitySignals.state} reason=${graphQualitySignals.reason} degraded_sources=${graphQualitySignals.degradedSources.length > 0 ? graphQualitySignals.degradedSources.join(",") : "<none>"} action=${graphQualitySignals.recommendedAction}\n`,
  );
  process.stdout.write(
    `context_engine: enabled=${contextEngineConfig.enabled ? "on" : "off"} profile=${contextEngineConfig.profile} window=${contextEngineConfig.contextWindowTokens} reserve=${contextEngineConfig.reservedOutputTokens} safety=${contextEngineConfig.safetyMarginTokens} auto_limit=${contextEngineTokenBudget.autoCompactTokenLimit} target=${contextEngineTokenBudget.targetTokenLimit} effective=${contextEngineEffectiveWindowTokens} thresholds=${contextEngineConfig.thresholds.proactiveRatio.toFixed(2)}/${contextEngineConfig.thresholds.forcedRatio.toFixed(2)}/${contextEngineConfig.thresholds.hardRatio.toFixed(2)} recovery=${contextEngineConfig.recovery.reactiveMaxRetries}/${contextEngineConfig.recovery.ptlMaxRetries}/${contextEngineConfig.recovery.circuitBreakerFailures}\n`,
  );
  process.stdout.write(
    `memory_orchestrator: enabled=${memoryOrchestratorPolicy.enabled ? "on" : "off"} version=${memoryOrchestratorPolicy.version} budget_ratio=${memoryOrchestratorPolicy.injectBudgetRatio.toFixed(2)} budget_min=${String(memoryOrchestratorPolicy.injectBudgetMinTokens)} budget_max=${String(memoryOrchestratorPolicy.injectBudgetMaxTokens)} section_max=${String(memoryOrchestratorPolicy.maxSectionTokens)} ga_rows=${String(memoryOrchestratorPolicy.maxGaMemoryRows)} team_rows=${String(memoryOrchestratorPolicy.maxTeamExperienceRows)} team_score_min=${String(memoryOrchestratorPolicy.minTeamExperienceScore)} decay_enabled=${memoryOrchestratorPolicy.decayEnabled ? "on" : "off"} decay_max_rows=${String(memoryOrchestratorPolicy.decayMaxRowsPerSession)} decay_min_keep=${String(memoryOrchestratorPolicy.decayMinRowsToKeep)} decay_age_hours=${String(memoryOrchestratorPolicy.decayMaxAgeHoursL1)}/${String(memoryOrchestratorPolicy.decayMaxAgeHoursL2)}/${String(memoryOrchestratorPolicy.decayMaxAgeHoursL3)}/${String(memoryOrchestratorPolicy.decayMaxAgeHoursL4)} decay_unverified_age_hours=${String(memoryOrchestratorPolicy.decayUnverifiedMaxAgeHours)} decay_confidence=${memoryOrchestratorPolicy.decayMinConfidenceVerified.toFixed(2)}/${memoryOrchestratorPolicy.decayMinConfidenceUnverified.toFixed(2)} autotune_updates=${String(memoryDecayAutotuneState.adaptiveUpdates)} autotune_alpha=${memoryDecayAutotuneState.adaptiveLearnAlpha.toFixed(2)} autotune_ema=${memoryDecayAutotuneState.dropRatioEma.toFixed(3)}/${memoryDecayAutotuneState.capacityTrimRatioEma.toFixed(3)}/${memoryDecayAutotuneState.lowConfidenceRatioEma.toFixed(3)}/${memoryDecayAutotuneState.ageDropRatioEma.toFixed(3)} autotune_quality_ema=${memoryDecayAutotuneState.qualityLowRateEma.toFixed(3)}/${memoryDecayAutotuneState.qualityPressureEma.toFixed(3)}/${memoryDecayAutotuneState.hardBudgetFollowupDeltaEma.toFixed(3)}/${memoryDecayAutotuneState.qualityFirstFollowupDeltaEma.toFixed(3)} autotune_last_reason=${memoryDecayAutotuneState.lastReason} autotune_updated_at=${memoryDecayAutotuneState.updatedAt ?? "<none>"} autotune_persistence_domain=${memoryDecayAutotuneStatePersistenceDomain} strategy_updates=${String(memoryStrategyAutotuneState.adaptiveUpdates)} strategy_schema=${String(memoryStrategyAutotuneState.schemaVersion)} strategy_profile=${memoryStrategyAutotuneState.profile} strategy_alpha=${memoryStrategyAutotuneState.adaptiveLearnAlpha.toFixed(2)} strategy_ema=${memoryStrategyAutotuneState.qualityLowRateEma.toFixed(3)}/${memoryStrategyAutotuneState.qualityPressureEma.toFixed(3)}/${memoryStrategyAutotuneState.hardBudgetRateEma.toFixed(3)}/${memoryStrategyAutotuneState.qualityFirstImprovedRateEma.toFixed(3)} strategy_pressure_ema=${memoryStrategyAutotuneState.averageUtilizationRatioEma.toFixed(3)}/${memoryStrategyAutotuneState.autoLimitTriggeredRateEma.toFixed(3)}/${memoryStrategyAutotuneState.snapshotSemanticCompressRateEma.toFixed(3)} strategy_followup_ema=${memoryStrategyAutotuneState.hardBudgetFollowupDeltaEma.toFixed(3)}/${memoryStrategyAutotuneState.qualityFirstFollowupDeltaEma.toFixed(3)} strategy_action=${memoryStrategyAutotuneState.lastActionDirection} strategy_cooldown=${String(memoryStrategyAutotuneState.cooldownTurnsRemaining)} strategy_streak=${String(memoryStrategyAutotuneState.tightenSignalStreak)}/${String(memoryStrategyAutotuneState.relaxSignalStreak)} strategy_scale=${memoryStrategyAutotuneState.adaptiveActionScale.toFixed(3)} strategy_pending=${memoryStrategyAutotuneState.pendingEvaluationDirection}/${String(memoryStrategyAutotuneState.pendingEvaluationWarmupTurns)} strategy_outcome=${memoryStrategyAutotuneState.lastOutcomeGain.toFixed(3)}/${memoryStrategyAutotuneState.outcomeConfidenceEma.toFixed(3)}/${String(memoryStrategyAutotuneState.outcomeRollbackCount)}/${String(memoryStrategyAutotuneState.outcomeNegativeStreak)} strategy_last_reason=${memoryStrategyAutotuneState.lastReason} strategy_updated_at=${memoryStrategyAutotuneState.updatedAt ?? "<none>"} strategy_persistence_domain=${memoryStrategyAutotuneStatePersistenceDomain}\n`,
  );
  process.stdout.write(
    `context_engine_prompt_quality_config: low_quality_threshold=${(contextEngineConfig.promptQuality?.lowQualityThreshold ?? 0.6).toFixed(3)} degrade_overall=${(contextEngineConfig.promptQuality?.degradeOverallThreshold ?? 0.62).toFixed(3)} degrade_low_quality_rate=${(contextEngineConfig.promptQuality?.degradeLowQualityRateThreshold ?? 0.4).toFixed(3)} degrade_min_entries=${String(contextEngineConfig.promptQuality?.degradeMinEntries ?? 8)} guard_enabled=${contextEngineConfig.promptQuality?.guardEnabled === false ? "false" : "true"} guard_adaptive_enabled=${contextEngineConfig.promptQuality?.guardAdaptiveEnabled === false ? "false" : "true"} guard_adaptive_allowlist=${(contextEngineConfig.promptQuality?.guardAdaptiveModeAllowlist ?? ["harden", "relax"]).join(",")} guard_promote_streak=${String(contextEngineConfig.promptQuality?.guardPromoteStreak ?? 2)} guard_severe_promote_streak=${String(contextEngineConfig.promptQuality?.guardSeverePromoteStreak ?? 2)} guard_release_streak=${String(contextEngineConfig.promptQuality?.guardReleaseStreak ?? 3)} guard_hold_turns=${String(contextEngineConfig.promptQuality?.guardHoldTurns ?? 2)} guard_max_floor=${contextEngineConfig.promptQuality?.guardMaxFloorStage ?? "minimal"} guard_severe_overall=${(contextEngineConfig.promptQuality?.guardSevereOverallThreshold ?? 0.45).toFixed(3)} guard_severe_low_quality_rate=${(contextEngineConfig.promptQuality?.guardSevereLowQualityRateThreshold ?? 0.7).toFixed(3)}\n`,
  );
  process.stdout.write(
    `context_engine_prompt_quality_guard_state: floor=${promptQualityGuardState.floorStage} degraded_streak=${String(promptQualityGuardState.degradedStreak)} severe_streak=${String(promptQualityGuardState.severeStreak)} healthy_streak=${String(promptQualityGuardState.healthyStreak)} hold_turns_remaining=${String(promptQualityGuardState.holdTurnsRemaining)} pressure_thresholds=${promptQualityGuardState.pressureUtilizationThreshold.toFixed(3)}/${promptQualityGuardState.pressureSemanticRateThreshold.toFixed(3)}/${promptQualityGuardState.pressureAutoLimitRateThreshold.toFixed(3)}/${promptQualityGuardState.pressureJointRateThreshold.toFixed(3)} pressure_trend_state=${promptQualityGuardState.pressureTrendMomentum.toFixed(3)}/${promptQualityGuardState.pressureTrendUtilizationDelta.toFixed(3)}/${promptQualityGuardState.pressureTrendSemanticDelta.toFixed(3)}/${promptQualityGuardState.pressureTrendAutoLimitDelta.toFixed(3)} outcome_state=${String(promptQualityGuardState.outcomeRequiredTransitions)}/${promptQualityGuardState.outcomeCombinedEvidenceScore.toFixed(3)}/${String(promptQualityGuardState.outcomeHighEvidenceTurns)}/${String(promptQualityGuardState.outcomeHighEvidenceHardenTurns)}/${String(promptQualityGuardState.outcomeDriftRecentAutoActionLevels.length)}/${promptQualityGuardState.outcomeDriftRecentAutoActionLevels[promptQualityGuardState.outcomeDriftRecentAutoActionLevels.length - 1] ?? "none"} last_reason=${promptQualityGuardState.lastReason || "<none>"} updated_at=${promptQualityGuardState.updatedAt ?? "<none>"} persistence_domain=${promptQualityGuardStatePersistenceDomain}\n`,
  );
  process.stdout.write(
    `context_engine_prompt_quality_guard_runtime: phase=${promptQualityGuardRuntimeAssessment.phase} transition=${promptQualityGuardRuntimeAssessment.transition} degraded=${promptQualityGuardRuntimeAssessment.degraded ? "true" : "false"} severe=${promptQualityGuardRuntimeAssessment.severe ? "true" : "false"} reason=${promptQualityGuardRuntimeAssessment.reason} triggered=${promptQualityGuardRuntimeAssessment.triggered ? "true" : "false"} floor=${promptQualityGuardRuntimeAssessment.floorStage} proposed_floor=${promptQualityGuardRuntimeAssessment.proposedFloorStage} promote_remaining=${String(promptQualityGuardRuntimeAssessment.promoteRemaining)} severe_promote_remaining=${String(promptQualityGuardRuntimeAssessment.severePromoteRemaining)} release_remaining=${String(promptQualityGuardRuntimeAssessment.releaseRemaining)} hold_turns_remaining=${String(promptQualityGuardRuntimeAssessment.holdTurnsRemaining)} observed_overall=${typeof promptQualityGuardRuntimeAssessment.observedOverall === "number" ? promptQualityGuardRuntimeAssessment.observedOverall.toFixed(3) : "<none>"} observed_low_quality_rate=${typeof promptQualityGuardRuntimeAssessment.observedLowQualityRate === "number" ? promptQualityGuardRuntimeAssessment.observedLowQualityRate.toFixed(3) : "<none>"}\n`,
  );
  process.stdout.write(
    `context_engine_prompt_quality_guard_adaptive: mode=${promptQualityGuardAdaptivePolicy.mode} reason=${promptQualityGuardAdaptivePolicy.reason} allowlist=${promptQualityGuardAdaptivePolicy.allowlist.join(",")} mode_blocked=${promptQualityGuardAdaptivePolicy.modeBlocked ? "true" : "false"} blocked_mode=${promptQualityGuardAdaptivePolicy.blockedMode ?? "<none>"} base_promote=${String(promptQualityGuardAdaptivePolicy.basePolicy.promoteStreak)} base_release=${String(promptQualityGuardAdaptivePolicy.basePolicy.releaseStreak)} effective_promote=${String(promptQualityGuardAdaptivePolicy.effectivePolicy.promoteStreak)} effective_release=${String(promptQualityGuardAdaptivePolicy.effectivePolicy.releaseStreak)} effective_hold=${String(promptQualityGuardAdaptivePolicy.effectivePolicy.holdTurns)} delta=${String(promptQualityGuardAdaptivePolicy.adjustment.promoteStreakDelta)}/${String(promptQualityGuardAdaptivePolicy.adjustment.releaseStreakDelta)}/${String(promptQualityGuardAdaptivePolicy.adjustment.holdTurnsDelta)} pressure_policy=${promptQualityGuardAdaptivePolicy.pressurePolicy.source}/${promptQualityGuardAdaptivePolicy.pressurePolicy.updated ? "updated" : "stable"}/${promptQualityGuardAdaptivePolicy.pressurePolicy.learnAlpha.toFixed(3)}/${promptQualityGuardAdaptivePolicy.pressurePolicy.utilizationThreshold.toFixed(3)}/${promptQualityGuardAdaptivePolicy.pressurePolicy.semanticRateThreshold.toFixed(3)}/${promptQualityGuardAdaptivePolicy.pressurePolicy.autoLimitRateThreshold.toFixed(3)}/${promptQualityGuardAdaptivePolicy.pressurePolicy.jointRateThreshold.toFixed(3)} trend=${promptQualityGuardAdaptivePolicy.pressurePolicy.trendMomentum.toFixed(3)}/${promptQualityGuardAdaptivePolicy.pressurePolicy.trendUtilizationDelta.toFixed(3)}/${promptQualityGuardAdaptivePolicy.pressurePolicy.trendSemanticDelta.toFixed(3)}/${promptQualityGuardAdaptivePolicy.pressurePolicy.trendAutoLimitDelta.toFixed(3)} flip_suppressed=${promptQualityGuardAdaptivePolicy.pressurePolicy.trendFlipSuppressed ? "true" : "false"} outcome_reliability=${String(promptQualityGuardAdaptivePolicy.outcomeReliability.requiredTransitions)}->${String(promptQualityGuardAdaptivePolicy.outcomeReliability.nextRequiredTransitions)}/${String(promptQualityGuardAdaptivePolicy.outcomeReliability.hardBudgetTransitions)}/${String(promptQualityGuardAdaptivePolicy.outcomeReliability.qualityFirstTransitions)}/${promptQualityGuardAdaptivePolicy.outcomeReliability.combinedEvidenceScore.toFixed(3)} hard_budget_reliable=${promptQualityGuardAdaptivePolicy.outcomeReliability.hardBudgetReliable ? "true" : "false"} quality_first_reliable=${promptQualityGuardAdaptivePolicy.outcomeReliability.qualityFirstReliable ? "true" : "false"} drift_guard=${String(promptQualityGuardAdaptivePolicy.outcomeDriftGuard.highEvidenceTurns)}/${String(promptQualityGuardAdaptivePolicy.outcomeDriftGuard.highEvidenceHardenTurns)}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.highEvidenceHardenRate.toFixed(3)}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.highEvidenceHardenBias ? "bias" : "ok"}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.autoActionLevel}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.recommendation}/${String(promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.entries)}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.latest}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.dominant}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.alertLevel}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.activeRate.toFixed(3)}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.mediumOrHardRate.toFixed(3)}/${promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.hardRate.toFixed(3)}/${String(promptQualityGuardAdaptivePolicy.outcomeDriftGuard.windowSummary.transitionCount)} semantic_rate=${typeof promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate === "number" ? promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate.toFixed(3) : "<none>"} auto_limit_rate=${typeof promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate === "number" ? promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate.toFixed(3) : "<none>"} hard_budget_rate=${typeof promptQualityWindowSummary.strategyActivity.hardBudgetRate === "number" ? promptQualityWindowSummary.strategyActivity.hardBudgetRate.toFixed(3) : "<none>"} quality_first_rate=${typeof promptQualityWindowSummary.strategyActivity.qualityFirstRate === "number" ? promptQualityWindowSummary.strategyActivity.qualityFirstRate.toFixed(3) : "<none>"} avg_pre_send_overflow=${typeof promptQualityWindowSummary.signalAverages?.preSendOverflowRatio === "number" ? promptQualityWindowSummary.signalAverages.preSendOverflowRatio.toFixed(3) : "<none>"} avg_pre_send_pressure=${typeof promptQualityWindowSummary.signalAverages?.preSendPressureScore === "number" ? promptQualityWindowSummary.signalAverages.preSendPressureScore.toFixed(3) : "<none>"} avg_utilization=${typeof promptQualityWindowSummary.tokenBudget.averageUtilizationRatio === "number" ? promptQualityWindowSummary.tokenBudget.averageUtilizationRatio.toFixed(3) : "<none>"}\n`,
  );
  process.stdout.write(
    `context_engine_prompt_quality_window: size=${promptQualityWindowSummary.configuredSize} entries=${promptQualityWindowSummary.entries} range=${promptQualityWindowSummary.fromTs ?? "<none>"}..${promptQualityWindowSummary.toTs ?? "<none>"} avg_overall=${typeof promptQualityWindowSummary.averageScores?.overall === "number" ? promptQualityWindowSummary.averageScores.overall.toFixed(3) : "<none>"} latest_overall=${typeof promptQualityWindowSummary.latestScores?.overall === "number" ? promptQualityWindowSummary.latestScores.overall.toFixed(3) : "<none>"} low_quality_rate=${typeof promptQualityWindowSummary.lowQualityRate === "number" ? promptQualityWindowSummary.lowQualityRate.toFixed(3) : "<none>"} degraded=${promptQualityWindowDegradation.degraded ? "yes" : "no"} reason=${promptQualityWindowDegradation.reason} persistence_domain=${promptQualityWindowPersistenceDomain}\n`,
  );
  process.stdout.write(
    `context_engine_prompt_quality_window_signals: avg_recent_rows=${typeof promptQualityWindowSummary.signalAverages?.recentRows === "number" ? promptQualityWindowSummary.signalAverages.recentRows.toFixed(3) : "<none>"} avg_snapshot_sections=${typeof promptQualityWindowSummary.signalAverages?.snapshotSections === "number" ? promptQualityWindowSummary.signalAverages.snapshotSections.toFixed(3) : "<none>"} avg_recent_trim_rows=${typeof promptQualityWindowSummary.signalAverages?.recentTrimRows === "number" ? promptQualityWindowSummary.signalAverages.recentTrimRows.toFixed(3) : "<none>"} avg_snapshot_trim_sections=${typeof promptQualityWindowSummary.signalAverages?.snapshotTrimSections === "number" ? promptQualityWindowSummary.signalAverages.snapshotTrimSections.toFixed(3) : "<none>"} avg_snapshot_semantic_compress_sections=${typeof promptQualityWindowSummary.signalAverages?.snapshotSemanticCompressSections === "number" ? promptQualityWindowSummary.signalAverages.snapshotSemanticCompressSections.toFixed(3) : "<none>"} avg_head_trim_retries=${typeof promptQualityWindowSummary.signalAverages?.headTrimRetries === "number" ? promptQualityWindowSummary.signalAverages.headTrimRetries.toFixed(3) : "<none>"} avg_pre_send_overflow=${typeof promptQualityWindowSummary.signalAverages?.preSendOverflowRatio === "number" ? promptQualityWindowSummary.signalAverages.preSendOverflowRatio.toFixed(3) : "<none>"} avg_pre_send_pressure=${typeof promptQualityWindowSummary.signalAverages?.preSendPressureScore === "number" ? promptQualityWindowSummary.signalAverages.preSendPressureScore.toFixed(3) : "<none>"} semantic_rate=${typeof promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate === "number" ? promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate.toFixed(3) : "<none>"} auto_limit_rate=${typeof promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate === "number" ? promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate.toFixed(3) : "<none>"} hard_budget_rate=${typeof promptQualityWindowSummary.strategyActivity.hardBudgetRate === "number" ? promptQualityWindowSummary.strategyActivity.hardBudgetRate.toFixed(3) : "<none>"} quality_first_rate=${typeof promptQualityWindowSummary.strategyActivity.qualityFirstRate === "number" ? promptQualityWindowSummary.strategyActivity.qualityFirstRate.toFixed(3) : "<none>"} avg_utilization=${typeof promptQualityWindowSummary.tokenBudget.averageUtilizationRatio === "number" ? promptQualityWindowSummary.tokenBudget.averageUtilizationRatio.toFixed(3) : "<none>"} trend_short=${typeof promptQualityWindowSummary.pressureTrends.short.averageUtilizationRatio === "number" ? promptQualityWindowSummary.pressureTrends.short.averageUtilizationRatio.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.pressureTrends.short.snapshotSemanticCompressRate === "number" ? promptQualityWindowSummary.pressureTrends.short.snapshotSemanticCompressRate.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.pressureTrends.short.autoLimitTriggeredRate === "number" ? promptQualityWindowSummary.pressureTrends.short.autoLimitTriggeredRate.toFixed(3) : "<none>"} trend_medium=${typeof promptQualityWindowSummary.pressureTrends.medium.averageUtilizationRatio === "number" ? promptQualityWindowSummary.pressureTrends.medium.averageUtilizationRatio.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.pressureTrends.medium.snapshotSemanticCompressRate === "number" ? promptQualityWindowSummary.pressureTrends.medium.snapshotSemanticCompressRate.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.pressureTrends.medium.autoLimitTriggeredRate === "number" ? promptQualityWindowSummary.pressureTrends.medium.autoLimitTriggeredRate.toFixed(3) : "<none>"} trend_delta=${typeof promptQualityWindowSummary.pressureTrends.delta.averageUtilizationRatio === "number" ? promptQualityWindowSummary.pressureTrends.delta.averageUtilizationRatio.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.pressureTrends.delta.snapshotSemanticCompressRate === "number" ? promptQualityWindowSummary.pressureTrends.delta.snapshotSemanticCompressRate.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.pressureTrends.delta.autoLimitTriggeredRate === "number" ? promptQualityWindowSummary.pressureTrends.delta.autoLimitTriggeredRate.toFixed(3) : "<none>"} strategy_trend_short=${typeof promptQualityWindowSummary.strategyTrends.short.hardBudgetRate === "number" ? promptQualityWindowSummary.strategyTrends.short.hardBudgetRate.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.strategyTrends.short.averageOverflowRatio === "number" ? promptQualityWindowSummary.strategyTrends.short.averageOverflowRatio.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.strategyTrends.short.averagePressureScore === "number" ? promptQualityWindowSummary.strategyTrends.short.averagePressureScore.toFixed(3) : "<none>"} strategy_trend_medium=${typeof promptQualityWindowSummary.strategyTrends.medium.hardBudgetRate === "number" ? promptQualityWindowSummary.strategyTrends.medium.hardBudgetRate.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.strategyTrends.medium.averageOverflowRatio === "number" ? promptQualityWindowSummary.strategyTrends.medium.averageOverflowRatio.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.strategyTrends.medium.averagePressureScore === "number" ? promptQualityWindowSummary.strategyTrends.medium.averagePressureScore.toFixed(3) : "<none>"} strategy_trend_delta=${typeof promptQualityWindowSummary.strategyTrends.delta.hardBudgetRate === "number" ? promptQualityWindowSummary.strategyTrends.delta.hardBudgetRate.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.strategyTrends.delta.averageOverflowRatio === "number" ? promptQualityWindowSummary.strategyTrends.delta.averageOverflowRatio.toFixed(3) : "<none>"}/${typeof promptQualityWindowSummary.strategyTrends.delta.averagePressureScore === "number" ? promptQualityWindowSummary.strategyTrends.delta.averagePressureScore.toFixed(3) : "<none>"}\n`,
  );
  process.stdout.write(
    `context_engine_prompt_quality_strategy_outcomes: hard_budget_followup_delta=${typeof promptQualityWindowSummary.strategyOutcomes.hardBudgetFollowupOverallDelta === "number" ? promptQualityWindowSummary.strategyOutcomes.hardBudgetFollowupOverallDelta.toFixed(3) : "<none>"} quality_first_followup_delta=${typeof promptQualityWindowSummary.strategyOutcomes.qualityFirstFollowupOverallDelta === "number" ? promptQualityWindowSummary.strategyOutcomes.qualityFirstFollowupOverallDelta.toFixed(3) : "<none>"} hard_budget_recovery_rate=${typeof promptQualityWindowSummary.strategyOutcomes.hardBudgetRecoveryRate === "number" ? promptQualityWindowSummary.strategyOutcomes.hardBudgetRecoveryRate.toFixed(3) : "<none>"} quality_first_improved_rate=${typeof promptQualityWindowSummary.strategyOutcomes.qualityFirstImprovedRate === "number" ? promptQualityWindowSummary.strategyOutcomes.qualityFirstImprovedRate.toFixed(3) : "<none>"} hard_budget_transitions=${String(promptQualityWindowSummary.strategyOutcomes.hardBudgetTransitions)} quality_first_transitions=${String(promptQualityWindowSummary.strategyOutcomes.qualityFirstTransitions)}\n`,
  );

  for (const line of formatRuntimeHealthStatusLines(runtimeHealth, runtimeBinaryPath)) {
    process.stdout.write(`${line}\n`);
  }
  if (providerProbe.probeResult) {
    for (const line of formatStatusProviderProbeLines(providerProbe.probeResult)) {
      process.stdout.write(`${line}\n`);
    }
  }
  return providerProbe.exitCode;
}
