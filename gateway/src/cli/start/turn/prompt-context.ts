import { resolveAgentsInstructionBlock } from "../../services/agents-instructions";
import {
  buildSemanticPrefetchBlock,
  computeUtilization,
  prepareTurnPrompt,
  readContextGraphCacheStats,
  type PromptCompactionStage,
  type PromptVariant,
} from "../../../tools/context";
import { applyRuntimeToolRecoveryPromptFlow } from "../../../tools/runtime/recovery-prompt-flow";
import { compactSingleLine } from "../session-history";
import {
  buildKimiBuiltinFallbackPrompt,
  buildKimiSearchRoutingPrefix,
  hasGrokSearchServer,
  resolvePrimaryProviderKind,
  shouldInjectMcpInstructionPrefix,
  shouldUseKimiMcpFirstRoute,
} from "./provider-routing";
import { recordGraphCacheWindowEntry } from "./graph-cache-window";
import {
  buildPromptPreparedDiagnostic,
  recordPromptQualityWindowEntry,
} from "./prompt-quality-surface";
import {
  buildKimiBuiltinFallbackPreparedPrompt,
  preparePreSendPrompt,
} from "./prompt-preparation";
import { prepareRuntimeToolSurfaceForTurn } from "./runtime-tool-surface";
import { type CreateRunStartTurnRunnerInput } from "./contract";
import { preparePromptContextGraphAutotune } from "./prompt-context/graph-autotune-runtime";
import { applyPromptContextQualityGuard } from "./prompt-context/quality-guard-runtime";

type RuntimeToolSurfaceForTurn = ReturnType<
  typeof prepareRuntimeToolSurfaceForTurn
>;

export interface PreparedRunStartTurnPromptContext {
  selectedStage: PromptCompactionStage;
  preparedPromptVariants: PromptVariant[];
  prompt: string;
  kimiBuiltinFallbackPrompt: string;
  kimiMcpFirstRouteEnabled: boolean;
  runtimeToolContextForTurn: RuntimeToolSurfaceForTurn["contextForTurn"];
  runtimeToolRecoveryFeedback: RuntimeToolSurfaceForTurn["recoveryFeedback"];
  runtimeToolSurfaceAdaptationStartedAtIso: string;
  nextPreviousTargetTokenLimit: number;
}

export function prepareRunStartTurnPromptContext(input: {
  runnerInput: CreateRunStartTurnRunnerInput;
  sessionKey: string;
  sessionTenant: string;
  sessionSubject: string;
  turnUserText: string;
  askUserPromptParts: readonly string[];
  promptPrelude?: string;
  consecutiveCompactionFailures: number;
  previousTargetTokenLimit?: number;
  writeTurnDiagnostic(message: string): void;
  writeTurnDiagnosticEvents(events: readonly string[]): void;
}): PreparedRunStartTurnPromptContext {
  const runnerInput = input.runnerInput;
  const historyMessages = runnerInput.getHistoryMessages();
  const allowProactiveCompaction =
    runnerInput.contextEngineConfig.enabled &&
    input.consecutiveCompactionFailures <
      runnerInput.contextEngineConfig.recovery.circuitBreakerFailures;
  if (
    runnerInput.contextEngineConfig.enabled &&
    !allowProactiveCompaction &&
    input.consecutiveCompactionFailures >=
      runnerInput.contextEngineConfig.recovery.circuitBreakerFailures
  ) {
    input.writeTurnDiagnostic(
      `[context-engine] event=circuit_open failures=${String(input.consecutiveCompactionFailures)} limit=${String(runnerInput.contextEngineConfig.recovery.circuitBreakerFailures)}\n`,
    );
  }

  const {
    promptQualityConfig,
    promptQualityWindowSummary,
    graphAutotuneDecision,
  } = preparePromptContextGraphAutotune({
    runnerInput,
    allowProactiveCompaction,
    writeTurnDiagnostic: input.writeTurnDiagnostic,
  });

  const graphCacheStatsBefore = readContextGraphCacheStats();
  const promptPreparation = prepareTurnPrompt({
    userText: input.turnUserText,
    historyMessages,
    historyTurns: runnerInput.historyTurns,
    workDir: runnerInput.workDir,
    config: {
      ...graphAutotuneDecision.adjustedConfig,
      enabled: allowProactiveCompaction,
    },
  });
  let selectedStage = promptPreparation.selected.stage;
  let basePrompt = promptPreparation.selected.prompt;
  let selectionReason: "threshold" | "budget_guard" =
    promptPreparation.selectionReason;
  const targetTokenLimit = promptPreparation.targetTokenLimit;
  const qualityGuardRuntime = applyPromptContextQualityGuard({
    runnerInput,
    allowProactiveCompaction,
    previousTargetTokenLimit: input.previousTargetTokenLimit,
    promptQualityConfig,
    promptQualityWindowSummary,
    promptPreparation,
    selectedStage,
    basePrompt,
    selectionReason,
    targetTokenLimit,
    writeTurnDiagnostic: input.writeTurnDiagnostic,
  });
  selectedStage = qualityGuardRuntime.selectedStage;
  basePrompt = qualityGuardRuntime.basePrompt;
  selectionReason = qualityGuardRuntime.selectionReason;
  const qualityGuardDecision = qualityGuardRuntime.qualityGuardDecision;
  const adaptiveGuardPolicyDecision =
    qualityGuardRuntime.adaptiveGuardPolicyDecision;
  const qualityGuardActive = qualityGuardRuntime.qualityGuardActive;
  const downshiftGuardTriggered =
    qualityGuardRuntime.downshiftGuardTriggered;

  const memoryInject = runnerInput.memoryOrchestrator.injectContext({
    sessionKey: input.sessionKey,
    userText: input.turnUserText,
    targetTokenLimit,
    tenant: input.sessionTenant,
    user: input.sessionSubject,
    includeLineage: runnerInput.contextEngineConfig.lineage.enabled,
    lineageMaxRows: runnerInput.contextEngineConfig.lineage.maxRows,
    lineageMaxCommits: runnerInput.contextEngineConfig.lineage.maxCommits,
    lineageCacheTtlMs: runnerInput.contextEngineConfig.lineage.cacheTtlMs,
    workDir: runnerInput.workDir,
  });
  input.writeTurnDiagnosticEvents(memoryInject.stderrEvents);
  const agentsInstructions = resolveAgentsInstructionBlock({
    projectRoot: runnerInput.projectRoot,
    workDir: runnerInput.workDir,
  });
  const promptPrelude = input.promptPrelude?.trim();
  const promptParts = [
    ...(agentsInstructions.block ? [agentsInstructions.block] : []),
    ...(promptPrelude ? [promptPrelude] : []),
    ...input.askUserPromptParts,
    ...memoryInject.promptParts,
  ];
  const runtimeToolSurface = prepareRuntimeToolSurfaceForTurn({
    workDir: runnerInput.workDir,
    runtimeToolContext: runnerInput.runtimeToolContext,
    userText: input.turnUserText,
  });
  const runtimeToolContextForTurn = runtimeToolSurface.contextForTurn;
  const runtimeToolRecoveryFeedback = runtimeToolSurface.recoveryFeedback;
  const runtimeToolSurfaceAdaptationStartedAtIso =
    runtimeToolSurface.startedAtIso;
  input.writeTurnDiagnosticEvents(runtimeToolSurface.diagnostics);
  const recoveryPromptFlow = applyRuntimeToolRecoveryPromptFlow({
    workDir: runnerInput.workDir,
    recoveryFeedback: runtimeToolRecoveryFeedback,
    guard: runtimeToolContextForTurn.guard,
    adaptation: runtimeToolContextForTurn.adaptation,
    nowIso: runtimeToolSurfaceAdaptationStartedAtIso,
  });
  promptParts.push(...recoveryPromptFlow.promptBlocks);
  input.writeTurnDiagnosticEvents(recoveryPromptFlow.stderrEvents);
  const mcpInstructionPrefix =
    runnerInput.mcpInstructionPromptPrefix?.trim() ?? "";
  const mcpInstructionDecision = shouldInjectMcpInstructionPrefix(
    runnerInput,
    input.turnUserText,
  );
  const providerKind = resolvePrimaryProviderKind(runnerInput);
  const kimiMcpFirstRouteEnabled = shouldUseKimiMcpFirstRoute({
    policy: runnerInput.kimiSearchRoutingPolicy,
    providerKind,
    userText: input.turnUserText,
    mcpServerNames: runnerInput.mcpInstructionServerNames,
  });
  const kimiSearchRoutingPrefix = buildKimiSearchRoutingPrefix({
    policy: runnerInput.kimiSearchRoutingPolicy,
    providerKind,
    userText: input.turnUserText,
    mcpServerNames: runnerInput.mcpInstructionServerNames,
  });
  const askUserClarificationHint =
    runnerInput.gaMechanismRuntime.buildAskUserClarificationHint(
      input.sessionKey,
      input.turnUserText,
    );
  if (askUserClarificationHint.length > 0) {
    promptParts.push(askUserClarificationHint);
    input.writeTurnDiagnostic("[ask-user] event=clarification_hint_injected\n");
  }
  const semanticPrefetch = buildSemanticPrefetchBlock({
    enabled: runnerInput.contextEngineConfig.semanticPrefetch.enabled,
    workDir: runnerInput.workDir,
    userText: input.turnUserText,
    timeoutMs: runnerInput.contextEngineConfig.semanticPrefetch.timeoutMs,
    maxEvidence: runnerInput.contextEngineConfig.semanticPrefetch.maxEvidence,
  });
  if (semanticPrefetch.block && semanticPrefetch.block.trim().length > 0) {
    promptParts.push(semanticPrefetch.block);
    input.writeTurnDiagnostic(
      `[context-engine] event=semantic_prefetch status=applied evidence=${String(semanticPrefetch.evidenceCount)} duration_ms=${String(semanticPrefetch.durationMs)}\n`,
    );
    if (semanticPrefetch.warning) {
      input.writeTurnDiagnostic(
        `[context-engine] event=semantic_prefetch status=warning message=${compactSingleLine(semanticPrefetch.warning, 140)}\n`,
      );
    }
  } else if (runnerInput.contextEngineConfig.semanticPrefetch.enabled) {
    if (semanticPrefetch.warning) {
      input.writeTurnDiagnostic(
        `[context-engine] event=semantic_prefetch status=degraded message=${compactSingleLine(semanticPrefetch.warning, 140)} duration_ms=${String(semanticPrefetch.durationMs)}\n`,
      );
    } else {
      input.writeTurnDiagnostic(
        `[context-engine] event=semantic_prefetch status=empty duration_ms=${String(semanticPrefetch.durationMs)}\n`,
      );
    }
  }
  if (mcpInstructionPrefix.length > 0 && mcpInstructionDecision.inject) {
    promptParts.push(mcpInstructionPrefix);
  }
  if (kimiSearchRoutingPrefix.length > 0) {
    promptParts.push(kimiSearchRoutingPrefix);
  }
  const preSendPrompt = preparePreSendPrompt({
    allowProactiveCompaction,
    promptParts,
    promptPreparation,
    selectedStage,
    selectionReason,
    targetTokenLimit,
    qualityGuardActive,
    qualityGuardSevere: qualityGuardDecision.severe,
    pressureTrendMomentum:
      adaptiveGuardPolicyDecision.pressurePolicy.trendMomentum,
    workDir: runnerInput.workDir,
    userText: input.turnUserText,
    semanticPrefetchTimeoutMs:
      runnerInput.contextEngineConfig.semanticPrefetch.timeoutMs,
    semanticPrefetchMaxEvidence:
      runnerInput.contextEngineConfig.semanticPrefetch.maxEvidence,
    ptlMaxRetries: runnerInput.contextEngineConfig.recovery.ptlMaxRetries,
  });
  const preparedPromptVariants = preSendPrompt.preparedPromptVariants;
  const selectedPrepared = preSendPrompt.selectedPrepared;
  selectedStage = preSendPrompt.selectedStage;
  selectionReason = preSendPrompt.selectionReason;
  const preSendHeadTrimRetries = preSendPrompt.preSendHeadTrimRetries;
  const preSendRecentTrimRows = preSendPrompt.preSendRecentTrimRows;
  const preSendSnapshotTrimSections = preSendPrompt.preSendSnapshotTrimSections;
  const preSendSnapshotSemanticCompressSections =
    preSendPrompt.preSendSnapshotSemanticCompressSections;
  const preSendCompressionStrategy = preSendPrompt.preSendCompressionStrategy;
  const preSendCompressionOverflowRatio =
    preSendPrompt.preSendCompressionOverflowRatio;
  const preSendCompressionPressureScore =
    preSendPrompt.preSendCompressionPressureScore;
  const preSendCompressionOrder = preSendPrompt.preSendCompressionOrder;
  input.writeTurnDiagnosticEvents(preSendPrompt.diagnostics);
  basePrompt = selectedPrepared.prompt;
  if (preSendPrompt.historyCompacted) {
    runnerInput.onHistoryCompacted();
  }
  const selectedUtilizationRatio = computeUtilization(
    selectedPrepared.estimatedTokens,
    promptPreparation.effectiveWindowTokens,
  );
  runnerInput.onPromptBudgetSnapshot?.({
    contextWindowUsageRatio: selectedUtilizationRatio,
    estimatedTokens: selectedPrepared.estimatedTokens,
    targetTokenLimit,
  });
  input.writeTurnDiagnostic(
    buildPromptPreparedDiagnostic({
      selectedStage,
      thresholdStage: promptPreparation.thresholdStage,
      selectionReason,
      utilization: promptPreparation.utilization,
      selectedUtilizationRatio,
      selectedPrepared,
      promptPreparation,
      targetTokenLimit,
      downshiftGuardTriggered,
      qualityGuardActive,
      preSendCompressionStrategy,
      preSendCompressionOverflowRatio,
      preSendCompressionPressureScore,
      preSendCompressionOrder,
      preSendRecentTrimRows,
      preSendSnapshotTrimSections,
      preSendSnapshotSemanticCompressSections,
      preSendHeadTrimRetries,
    }),
  );
  input.writeTurnDiagnostic(
    recordPromptQualityWindowEntry({
      workDir: runnerInput.workDir,
      sessionKey: input.sessionKey,
      selectedStage,
      selectionReason,
      selectedPrepared,
      targetTokenLimit,
      preSendRecentTrimRows,
      preSendSnapshotTrimSections,
      preSendSnapshotSemanticCompressSections,
      preSendHeadTrimRetries,
      autoLimitTriggered: promptPreparation.autoCompactLimitTriggered,
      downshiftGuardTriggered,
      preSendCompressionStrategy,
      preSendCompressionOverflowRatio,
      preSendCompressionPressureScore,
    }),
  );
  const graphCacheStats = readContextGraphCacheStats();
  input.writeTurnDiagnostic(
    recordGraphCacheWindowEntry({
      workDir: runnerInput.workDir,
      sessionKey: input.sessionKey,
      stage: selectedStage,
      selectionReason,
      prompt: selectedPrepared.prompt,
      before: graphCacheStatsBefore,
      after: graphCacheStats,
    }),
  );
  const selectedConversationVariant =
    promptPreparation.variants.find(
      (variant) => variant.stage === selectedStage,
    ) ?? promptPreparation.selected;
  const kimiBuiltinFallbackPrompt = kimiMcpFirstRouteEnabled
    ? buildKimiBuiltinFallbackPreparedPrompt({
        promptParts,
        conversationPrompt: buildKimiBuiltinFallbackPrompt(
          selectedConversationVariant.prompt,
        ),
      })
    : basePrompt;
  if (kimiSearchRoutingPrefix.length > 0) {
    input.writeTurnDiagnostic(
      `[governance:search-route] event=policy_injected provider=${providerKind} policy=${runnerInput.kimiSearchRoutingPolicy} has_grok_search=${hasGrokSearchServer(runnerInput.mcpInstructionServerNames) ? "true" : "false"} chars=${String(kimiSearchRoutingPrefix.length)}\n`,
    );
  }
  if (mcpInstructionPrefix.length > 0) {
    const serversSummary =
      runnerInput.mcpInstructionServerNames.length > 0
        ? runnerInput.mcpInstructionServerNames.join(",")
        : "<none>";
    if (mcpInstructionDecision.inject) {
      input.writeTurnDiagnostic(
        `[governance:mcp-instruction] event=prompt_injected servers=${serversSummary} chars=${String(mcpInstructionPrefix.length)} reason=${mcpInstructionDecision.reason}\n`,
      );
    } else {
      input.writeTurnDiagnostic(
        `[governance:mcp-instruction] event=prompt_skipped servers=${serversSummary} reason=${mcpInstructionDecision.reason}\n`,
      );
    }
  }

  return {
    selectedStage,
    preparedPromptVariants,
    prompt: basePrompt,
    kimiBuiltinFallbackPrompt,
    kimiMcpFirstRouteEnabled,
    runtimeToolContextForTurn,
    runtimeToolRecoveryFeedback,
    runtimeToolSurfaceAdaptationStartedAtIso,
    nextPreviousTargetTokenLimit: targetTokenLimit,
  };
}
