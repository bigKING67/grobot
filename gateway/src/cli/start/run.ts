import {
  hasFlag,
  isCliStringOptionInputError,
  OptionValue,
  readOptionString,
} from "../cli-args";
import { buildInteractiveHelpText } from "./session-interactive";
import { bootstrapRunStartState } from "./bootstrap";
import { resolveRunStartContext } from "./context";
import { createRunStartInteractiveModeInput } from "./interactive-bindings";
import {
  runStartInteractiveMode,
  type InteractiveDiagnosticsMode,
} from "./interactive-mode";
import {
  createRunStartModelOps,
  type RunStartModelOps,
} from "./model-ops";
import { createRunStartSessionMenuOps } from "./session/menu-ops";
import { runStartMessageMode } from "./message-mode";
import { createRunStartOutput } from "./output";
import { createRunStartPersistence } from "./persistence";
import { createRunStartRuntimeState } from "./runtime-state";
import { createRunStartWire } from "./wire";
import { createRunStartPlanMode } from "./plan-mode";
import {
  isPlanArtifactControlInputError,
  resolvePlanArtifactEnvControls,
} from "./plan-artifact/env-controls";
import { createRunStartRewindStore } from "./rewind-store";
import { TURN_INTERRUPTED_EXIT_CODE } from "./turn";
import {
  createGaMechanismRuntime,
  isGaMechanismRuntimeConfigInputError,
} from "../services/ga-mechanism-runtime";
import { createExperiencePoolRuntime } from "../services/experience-pool-runtime";
import {
  applyMemoryDecayAutotuneToPolicy,
  applyMemoryStrategyAutotuneToPolicy,
  createMemoryOrchestrator,
  defaultMemoryOrchestratorPolicy,
  readMemoryDecayAutotuneState,
  readMemoryStrategyAutotuneState,
  type MemoryOrchestratorExperienceAdapter,
  type MemoryOrchestratorGaAdapter,
} from "../../tools/memory";
import { createExperienceSchedulerRuntime } from "../services/experience-scheduler";
import { isExperienceSchedulerConfigInputError } from "../services/experience-scheduler-config";
import { type RuntimeAttachment, type RuntimeEvent } from "../../models/types";
import { isTruthyEnvFlag } from "./startup/env";
import {
  applyContextWindowOverride,
  normalizePositiveInt,
} from "./context/window-runtime";
import { isToolSurfaceProfileInputError } from "../../tools/runtime/default-enabled-tools";
import { isRuntimeBinaryPathInputError } from "../../tools/runtime/runtime-binary-path";
import {
  buildExperienceSchedulerTaskFailedSurface,
  buildExperienceSchedulerTickErrorSurface,
  buildMcpInstructionStrictFailureSurface,
  buildRuntimeToolsFallbackSurface,
  formatDiagnosticToken,
} from "./startup/surfaces";
import {
  runMemoryMaintenanceRuntime,
  type MemoryMaintenanceReason,
} from "./memory-maintenance-runtime";
import { createRuntimeInterruptController } from "./runtime-interrupt-controller";
import { createTurnExecutionController } from "./turn-execution-controller";
import { runStartupSessionActions } from "./startup/session-actions";
import { GLOBAL_TURN_GATE } from "../../orchestration/orchestrator/turn-gate";
import { isRouteDecisionNamespaceInputError } from "../status/route-namespace";
import { isCliNumericOptionInputError } from "../status/option-parsing";
import { isMemoryStoreConfigInputError } from "../services/memory-store-config";
import { isMcpInstructionConfigInputError } from "../services/mcp-instruction-pack";
import { isExperienceControlInputError } from "../services/experience-controls";
import { isStartSessionOptionInputError } from "./session/input-errors";
import { isRuntimeToolControlInputError } from "./context/runtime-tool-controls";
import { isRuntimeModelConfigInputError } from "./context/runtime-model-config";
import { isStatusLineConfigInputError } from "./context/status-line-config";
import { isContextEngineConfigInputError } from "../../tools/context";
import { resolveStartEnvControls } from "./context/start-env-controls";

export async function runStart(
  options: Record<string, OptionValue>,
): Promise<number> {
  const isTurnInterruptedCode = (code: number): boolean =>
    code === TURN_INTERRUPTED_EXIT_CODE;
  let context: ReturnType<typeof resolveRunStartContext>;
  try {
    context = resolveRunStartContext(options);
  } catch (error) {
    if (isRouteDecisionNamespaceInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    if (isCliNumericOptionInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    if (isCliStringOptionInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    if (isMemoryStoreConfigInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    if (isStartSessionOptionInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    if (isRuntimeToolControlInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    if (isToolSurfaceProfileInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    if (isRuntimeBinaryPathInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    if (isRuntimeModelConfigInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    if (isContextEngineConfigInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    if (isExperienceControlInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    if (isExperienceSchedulerConfigInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    if (isMcpInstructionConfigInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    if (isStatusLineConfigInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
  const {
    homeDir,
    projectRoot,
    workDir,
    configTomlPath,
    projectName,
    historyTurns,
    handoffRecentTurns,
    handoffAutoOnExit,
    resumeRequested,
    resumeLastRequested,
    resumeAllRequested,
    resumeSelector,
    rewindRequested,
    rewindSelector,
    rewindMode,
    forkSession,
    resumeSessionAt,
    rewindFiles,
    handoffPath,
    interruptStorePath,
    experiencePoolPath,
    experienceLegacyPoolPath,
    experienceTeam,
    experiencePublishMode,
    experienceRecallLimit,
    experienceSchedulerConfig,
    subject,
    executionPlane,
    runtimeModelConfig,
    runtimeProviderChain,
    runtimeFailoverConfig,
    runtimeModelConfigSource,
    contextEngineConfig,
    runtimeToolContext,
    runtimeToolContextDiagnostics,
    kimiSearchRoutingPolicy,
    statusLineConfig,
    mcpInstructionPromptPrefix,
    mcpInstructionServerNames,
    mcpInstructionEvents,
    mcpInstructionStrictFailure,
    sessionNamespaceKey,
    sessionRegistryFilePathValue,
    sessionStore,
  } = context;
  try {
    resolvePlanArtifactEnvControls();
  } catch (error) {
    if (isPlanArtifactControlInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
  const traceModeEnabled = hasFlag(options, "trace");
  const verboseModeEnabled = hasFlag(options, "verbose") || traceModeEnabled;
  const interactiveDiagnosticsMode: InteractiveDiagnosticsMode =
    traceModeEnabled ? "trace" : verboseModeEnabled ? "verbose" : "compact";
  const startupDiagnosticsEnabled =
    isTruthyEnvFlag(process.env.GROBOT_STARTUP_DIAGNOSTICS) || traceModeEnabled;
  const interactiveDiagnosticsEnabled =
    interactiveDiagnosticsMode !== "compact";
  const output = createRunStartOutput({
    suppressWarningPatterns: startupDiagnosticsEnabled
      ? []
      : [
        /^session store fallback to file:/i,
        / migrated from legacy path \(/i,
      ],
  });
  const writeStartupDiagnostics = (message: string): void => {
    if (!startupDiagnosticsEnabled) {
      return;
    }
    output.writeStderr(message);
  };
  if (
    runtimeToolContextDiagnostics.enabledToolsSource ===
    "runtime.tools.describe"
  ) {
    writeStartupDiagnostics(
      `[tool-surface] event=runtime_describe_ok enabled_tools_source=${runtimeToolContextDiagnostics.enabledToolsSource} manifest_fingerprint=${runtimeToolContextDiagnostics.manifestFingerprint} manifest_tool_count=${String(runtimeToolContextDiagnostics.manifestToolCount)} default_enabled_count=${String(runtimeToolContextDiagnostics.manifestDefaultEnabledCount)} schema_profiles_fingerprint=${runtimeToolContextDiagnostics.schemaProfilesFingerprint ?? "<none>"}\n`,
    );
  } else {
    const fallbackDiagnostic = `[tool-surface] event=runtime_describe_fallback enabled_tools_source=${runtimeToolContextDiagnostics.enabledToolsSource} reason=${formatDiagnosticToken(runtimeToolContextDiagnostics.enabledToolsSourceDetail)} manifest_fingerprint=${runtimeToolContextDiagnostics.manifestFingerprint} manifest_tool_count=${String(runtimeToolContextDiagnostics.manifestToolCount)} default_enabled_count=${String(runtimeToolContextDiagnostics.manifestDefaultEnabledCount)} schema_profiles_fingerprint=${runtimeToolContextDiagnostics.schemaProfilesFingerprint ?? "<none>"}\n`;
    writeStartupDiagnostics(fallbackDiagnostic);
    output.writeStderr(
      buildRuntimeToolsFallbackSurface({
        reason: runtimeToolContextDiagnostics.enabledToolsSourceDetail,
        source: runtimeToolContextDiagnostics.enabledToolsSource,
      }),
    );
  }
  const defaultContextWindowTokens = Math.max(
    1_024,
    normalizePositiveInt(contextEngineConfig.contextWindowTokens) ?? 1_024,
  );
  const defaultAutoCompactLimit = Math.max(
    1,
    Math.floor(defaultContextWindowTokens * 0.9),
  );
  const configuredAutoCompactLimit =
    normalizePositiveInt(contextEngineConfig.autoCompactTokenLimit) ??
    defaultAutoCompactLimit;
  const keepAutoCompactAbsolute =
    Math.abs(configuredAutoCompactLimit - defaultAutoCompactLimit) > 1;
  const autoCompactRatio = keepAutoCompactAbsolute
    ? Math.max(
        0.1,
        Math.min(1, configuredAutoCompactLimit / defaultContextWindowTokens),
      )
    : 0.9;
  let modelOpsRef: RunStartModelOps | undefined;
  const refreshContextWindowFromModelCatalog = (reason: string): void => {
    const modelOps = modelOpsRef;
    if (!modelOps) {
      return;
    }
    const snapshot = modelOps.getCurrentModelSnapshot();
    const catalogWindow = normalizePositiveInt(
      modelOps.getCachedModelContextWindowTokens(snapshot.model),
    );
    const nextWindowTokens = catalogWindow ?? defaultContextWindowTokens;
    const updated = applyContextWindowOverride({
      config: contextEngineConfig,
      nextWindowTokens,
      keepAutoCompactAbsolute,
      autoCompactRatio,
    });
    if (updated) {
      writeStartupDiagnostics(
        `[context-engine] event=context_window_update reason=${reason} model=${snapshot.model} source=${catalogWindow ? "model_catalog" : "provider_default"} window=${String(contextEngineConfig.contextWindowTokens)} auto_limit=${String(contextEngineConfig.autoCompactTokenLimit ?? 0)}\n`,
      );
    }
  };
  for (const event of mcpInstructionEvents) {
    writeStartupDiagnostics(`[governance:mcp-instruction] ${event}\n`);
  }
  if (mcpInstructionStrictFailure) {
    writeStartupDiagnostics(
      `[governance:mcp-instruction] event=strict_failure reason=${mcpInstructionStrictFailure}\n`,
    );
    output.writeStderr(
      buildMcpInstructionStrictFailureSurface(mcpInstructionStrictFailure),
    );
    return 1;
  }
  const experiencePoolRuntime = createExperiencePoolRuntime({
    poolPath: experiencePoolPath,
    legacyPoolPath: experienceLegacyPoolPath,
    publishMode: experiencePublishMode,
    recallLimit: experienceRecallLimit,
    teamDefault: experienceTeam,
  });
  writeStartupDiagnostics(
    `[experience-pool] mode=${experiencePoolRuntime.getPublishMode()} recall_limit=${String(experiencePoolRuntime.getRecallLimit())} records=${String(experiencePoolRuntime.getRecordCount())} path=${experiencePoolRuntime.getPath()}\n`,
  );

  const bootstrapState = await bootstrapRunStartState({
    sessionNamespaceKey,
    sessionStore,
    writeSessionWarnings: output.writeSessionWarnings,
    writeStoreWarnings: output.writeStoreWarnings,
  });

  const runtimeState = createRunStartRuntimeState({ bootstrapState });
  const persistence = createRunStartPersistence({
    sessionStore,
    runtimeState,
    writeSessionWarnings: output.writeSessionWarnings,
    writeStoreWarnings: output.writeStoreWarnings,
  });
  const rewindStore = createRunStartRewindStore({
    workDir,
  });
  let gaMechanismRuntime: ReturnType<typeof createGaMechanismRuntime>;
  try {
    gaMechanismRuntime = createGaMechanismRuntime();
  } catch (error) {
    if (isGaMechanismRuntimeConfigInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
  gaMechanismRuntime.hydrateSession(
    runtimeState.getSessionKey(),
    runtimeState.getGaState(),
  );
  const gaAdapter: MemoryOrchestratorGaAdapter = {
    listMemory: (sessionKey) => gaMechanismRuntime.listMemory(sessionKey),
    listSkillCards: (sessionKey) =>
      gaMechanismRuntime.listSkillCards(sessionKey),
    registerTurnSuccess: (memoryInput) =>
      gaMechanismRuntime.registerTurnSuccess(memoryInput),
    registerTurnFailure: (memoryInput) =>
      gaMechanismRuntime.registerTurnFailure(memoryInput),
    writeMemory: (memoryInput) => gaMechanismRuntime.writeMemory(memoryInput),
  };
  const experienceAdapter: MemoryOrchestratorExperienceAdapter = {
    getTeamDefault: () => experiencePoolRuntime.getTeamDefault(),
    buildRecallPrompt: (memoryInput) =>
      experiencePoolRuntime.buildRecallPrompt(memoryInput),
    searchRecords: (memoryInput) =>
      experiencePoolRuntime.searchRecords({
        ...memoryInput,
        includeStates: memoryInput.includeStates
          ? [...memoryInput.includeStates]
          : undefined,
      }),
    registerTurnSuccess: (memoryInput) =>
      experiencePoolRuntime.registerTurnSuccess(memoryInput),
    registerTurnFailure: (memoryInput) =>
      experiencePoolRuntime.registerTurnFailure(memoryInput),
  };
  const baseMemoryPolicy = defaultMemoryOrchestratorPolicy();
  let memoryDecayAutotuneState = readMemoryDecayAutotuneState({
    workDir,
    basePolicy: baseMemoryPolicy,
  });
  const memoryPolicyAfterDecayAutotune = applyMemoryDecayAutotuneToPolicy({
    basePolicy: baseMemoryPolicy,
    state: memoryDecayAutotuneState,
  });
  let memoryStrategyAutotuneState = readMemoryStrategyAutotuneState({
    workDir,
    basePolicy: baseMemoryPolicy,
  });
  const initialMemoryPolicy = applyMemoryStrategyAutotuneToPolicy({
    basePolicy: memoryPolicyAfterDecayAutotune,
    state: memoryStrategyAutotuneState,
  });
  const memoryOrchestrator = createMemoryOrchestrator({
    ga: gaAdapter,
    experience: experienceAdapter,
    workDir,
    policy: initialMemoryPolicy,
  });
  const memoryPolicy = memoryOrchestrator.policySnapshot();
  writeStartupDiagnostics(
    `[memory-orchestrator] enabled=${memoryPolicy.enabled ? "on" : "off"} version=${memoryPolicy.version} budget_ratio=${memoryPolicy.injectBudgetRatio.toFixed(2)} budget_min=${String(memoryPolicy.injectBudgetMinTokens)} budget_max=${String(memoryPolicy.injectBudgetMaxTokens)} section_max=${String(memoryPolicy.maxSectionTokens)} ga_rows=${String(memoryPolicy.maxGaMemoryRows)} team_rows=${String(memoryPolicy.maxTeamExperienceRows)} team_score_min=${String(memoryPolicy.minTeamExperienceScore)} decay_enabled=${memoryPolicy.decayEnabled ? "on" : "off"} decay_max_rows=${String(memoryPolicy.decayMaxRowsPerSession)} decay_min_keep=${String(memoryPolicy.decayMinRowsToKeep)} decay_age_hours=${String(memoryPolicy.decayMaxAgeHoursL1)}/${String(memoryPolicy.decayMaxAgeHoursL2)}/${String(memoryPolicy.decayMaxAgeHoursL3)}/${String(memoryPolicy.decayMaxAgeHoursL4)} decay_unverified_age_hours=${String(memoryPolicy.decayUnverifiedMaxAgeHours)} decay_confidence=${memoryPolicy.decayMinConfidenceVerified.toFixed(2)}/${memoryPolicy.decayMinConfidenceUnverified.toFixed(2)} decay_autotune_updates=${String(memoryDecayAutotuneState.adaptiveUpdates)} decay_autotune_reason=${memoryDecayAutotuneState.lastReason} strategy_autotune_updates=${String(memoryStrategyAutotuneState.adaptiveUpdates)} strategy_autotune_reason=${memoryStrategyAutotuneState.lastReason} strategy_profile=${memoryStrategyAutotuneState.profile} strategy_action=${memoryStrategyAutotuneState.lastActionDirection} strategy_cooldown=${String(memoryStrategyAutotuneState.cooldownTurnsRemaining)} strategy_streak=${String(memoryStrategyAutotuneState.tightenSignalStreak)}/${String(memoryStrategyAutotuneState.relaxSignalStreak)} strategy_scale=${memoryStrategyAutotuneState.adaptiveActionScale.toFixed(3)} strategy_outcome=${memoryStrategyAutotuneState.lastOutcomeGain.toFixed(3)}/${memoryStrategyAutotuneState.outcomeConfidenceEma.toFixed(3)}/${String(memoryStrategyAutotuneState.outcomeRollbackCount)}\n`,
  );

  const wire = createRunStartWire({
    sessionNamespaceKey,
    historyTurns,
    sessionStore,
    projectName,
    projectRoot,
    workDir,
    handoffPath,
    handoffRecentTurns,
    interruptStorePath,
    subject,
    executionPlane,
    runtimeModelConfig,
    runtimeProviderChain,
    runtimeFailoverConfig,
    runtimeModelConfigSource,
    contextEngineConfig,
    runtimeToolContext,
    rewindStore,
    gaMechanismRuntime,
    kimiSearchRoutingPolicy,
    mcpInstructionPromptPrefix,
    mcpInstructionServerNames,
    memoryOrchestrator,
    experiencePoolRuntime,
    runtimeState,
    persistence,
    writeStoreWarnings: output.writeStoreWarnings,
    writeStdout: output.writeStdout,
    writeStderr: output.writeStderr,
  });
  const { handoff, sessionOps } = wire;
  writeStartupDiagnostics(
    `[context-engine] enabled=${contextEngineConfig.enabled ? "on" : "off"} profile=${contextEngineConfig.profile} thresholds=${contextEngineConfig.thresholds.proactiveRatio.toFixed(2)}/${contextEngineConfig.thresholds.forcedRatio.toFixed(2)}/${contextEngineConfig.thresholds.hardRatio.toFixed(2)} recovery=${contextEngineConfig.recovery.reactiveMaxRetries}/${contextEngineConfig.recovery.ptlMaxRetries}/${contextEngineConfig.recovery.circuitBreakerFailures} lineage=${contextEngineConfig.lineage.enabled ? "on" : "off"}:${String(contextEngineConfig.lineage.maxRows)}/${String(contextEngineConfig.lineage.maxCommits)} workspace=${contextEngineConfig.workspaceSignals.enabled ? "on" : "off"}:${String(contextEngineConfig.workspaceSignals.maxRows)}/${contextEngineConfig.workspaceSignals.includeUntracked ? "u1" : "u0"} dependency_graph=${contextEngineConfig.dependencyGraph.enabled ? "on" : "off"}:${String(contextEngineConfig.dependencyGraph.maxRows)} symbol_graph=${contextEngineConfig.symbolGraph.enabled ? "on" : "off"}:${String(contextEngineConfig.symbolGraph.maxRows)} semantic_prefetch=${contextEngineConfig.semanticPrefetch.enabled ? "on" : "off"}:${String(contextEngineConfig.semanticPrefetch.maxEvidence)}/${String(contextEngineConfig.semanticPrefetch.timeoutMs)}\n`,
  );
  const runtimeInterrupts = createRuntimeInterruptController({
    writeStdout: output.writeStdout,
    writeStartupDiagnostics,
  });
  let memoryMaintenanceEnabled: boolean;
  let memoryMaintenanceIntervalMs: number;
  let promptQualityWindowSize: number;
  try {
    ({
      memoryMaintenanceEnabled,
      memoryMaintenanceIntervalMs,
      promptQualityWindowSize,
    } = resolveStartEnvControls());
  } catch (error) {
    if (isCliStringOptionInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    if (isCliNumericOptionInputError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
  let memoryMaintenanceRunning = false;
  const runMemoryMaintenance = async (
    reason: MemoryMaintenanceReason,
  ): Promise<void> => {
    if (memoryMaintenanceRunning) {
      return;
    }
    if (
      reason === "timer" &&
      runtimeInterrupts.getActiveController() &&
      !runtimeInterrupts.getActiveController()?.signal.aborted
    ) {
      writeStartupDiagnostics(
        "[memory-orchestrator] event=maintenance_skipped reason=active_turn\n",
      );
      return;
    }
    memoryMaintenanceRunning = true;
    try {
      const result = await runMemoryMaintenanceRuntime({
        reason,
        workDir,
        basePolicy: baseMemoryPolicy,
        memoryOrchestrator,
        runtimeState,
        persistence,
        gaMechanismRuntime,
        memoryDecayAutotuneState,
        memoryStrategyAutotuneState,
        promptQualityWindowSize,
        promptQualityLowQualityThreshold:
          contextEngineConfig.promptQuality?.lowQualityThreshold,
        writeStartupDiagnostics,
        writeStderr: output.writeStderr,
      });
      memoryDecayAutotuneState = result.memoryDecayAutotuneState;
      memoryStrategyAutotuneState = result.memoryStrategyAutotuneState;
    } finally {
      memoryMaintenanceRunning = false;
    }
  };
  writeStartupDiagnostics(
    `[memory-orchestrator] maintenance_enabled=${memoryMaintenanceEnabled ? "on" : "off"} interval_ms=${String(memoryMaintenanceIntervalMs)}\n`,
  );
  const requestRuntimeInterrupt = runtimeInterrupts.request;
  const turnExecution = createTurnExecutionController({
    runtimeState,
    rewindStore,
    wire,
    runtimeInterrupts,
    turnGate: GLOBAL_TURN_GATE,
    refreshContextWindowFromModelCatalog,
    runMemoryMaintenance,
    writeStartupDiagnostics,
    writeStderr: output.writeStderr,
  });
  const executeTurn = async (
    userInput: string,
    interactiveMode: boolean,
    options?: {
      attachments?: RuntimeAttachment[];
      promptPrelude?: string;
      autoOpenAskUserPanel?: boolean;
      emitDiagnostics?: boolean;
      writeStdout?: (message: string) => void;
      writeStderr?: (message: string) => void;
      onRuntimeEvent?: (event: RuntimeEvent) => void;
    },
  ): Promise<number> => {
    return turnExecution.executeTurn(userInput, interactiveMode, options);
  };

  const schedulerRuntime = createExperienceSchedulerRuntime(
    experienceSchedulerConfig,
  );
  const schedulerConfig = schedulerRuntime.getConfig();
  writeStartupDiagnostics(
    `[experience-scheduler] enabled=${schedulerConfig.enabled ? "on" : "off"} interval_ms=${String(schedulerConfig.intervalMs)} tasks_dir=${schedulerConfig.tasksDir} done_dir=${schedulerConfig.doneDir} log_path=${schedulerConfig.logPath}\n`,
  );

  const modelOps = createRunStartModelOps({
    runtimeProviderChain,
    runtimeModelConfig,
    runtimeModelConfigSource,
    configTomlPath,
    homeDir,
    workDir,
    projectName,
    getActiveSessionId: runtimeState.getActiveSessionId,
    getActiveSessionMetadata: () => {
      const activeSessionId = runtimeState.getActiveSessionId();
      const activeSession = sessionOps
        .listSessions()
        .find((item) => item.id === activeSessionId);
      if (!activeSession) {
        return undefined;
      }
      return {
        title: activeSession.title,
        summary: activeSession.summary,
      };
    },
    writeStdout: output.writeStdout,
  });
  modelOpsRef = modelOps;

  const sessionMenuOps = createRunStartSessionMenuOps({
    sessionNamespaceKey,
    listSessions: sessionOps.listSessions,
    getActiveSessionId: runtimeState.getActiveSessionId,
    printSessionOverview: sessionOps.printSessionOverview,
    createNewSession: sessionOps.createNewSession,
    switchActiveSession: sessionOps.switchActiveSession,
    resumeFromSession: sessionOps.resumeFromSession,
    continueFromSession: sessionOps.continueFromSession,
    listRewindCheckpoints: sessionOps.listRewindCheckpoints,
    rewindSession: sessionOps.rewindSession,
    applyModelOverrideForActiveSession:
      modelOps.applyModelOverrideForActiveSession,
    writeStdout: output.writeStdout,
  });

  modelOps.applyModelOverrideForActiveSession();
  await modelOps.refreshModelCatalogCache();
  refreshContextWindowFromModelCatalog("startup_model_catalog");

  await runStartupSessionActions({
    resumeRequested,
    resumeLastRequested,
    resumeAllRequested,
    resumeSelector,
    rewindRequested,
    rewindSelector,
    rewindMode,
    forkSession,
    resumeSessionAt,
    rewindFiles,
    sessionNamespaceKey,
    runtimeState,
    sessionOps,
    modelOps,
    writeStdout: output.writeStdout,
  });

  const planMode = createRunStartPlanMode({
    workDir,
    runtimeState,
    persistence,
    executeTurn,
    requestRuntimeInterrupt,
    markFailureObserved: runtimeState.markFailureObserved,
    writeStdout: output.writeStdout,
    writeStderr: output.writeStderr,
  });

  await runMemoryMaintenance("bootstrap");

  const message = readOptionString(options, "message");
  if (message) {
    const planHandled = await planMode.handleMessageInput(message, {
      messageMode: true,
    });
    if (planHandled.handled) {
      if (planHandled.code !== 0 && !isTurnInterruptedCode(planHandled.code)) {
        runtimeState.markFailureObserved();
      }
      if (handoffAutoOnExit) {
        handoff.writeAutoExitHandoffIfNeeded(true);
      }
      return planHandled.code;
    }
    return runStartMessageMode({
      message,
      executeTurn,
      emitDiagnostics: startupDiagnosticsEnabled || verboseModeEnabled,
      markFailureObserved: runtimeState.markFailureObserved,
      handoffAutoOnExit,
      writeAutoExitHandoffIfNeeded: () => {
        handoff.writeAutoExitHandoffIfNeeded(true);
      },
    });
  }

  let schedulerTimer: ReturnType<typeof setInterval> | undefined;
  let memoryMaintenanceTimer: ReturnType<typeof setInterval> | undefined;
  let schedulerTickRunning = false;
  const runSchedulerTick = async (): Promise<void> => {
    if (!schedulerConfig.enabled || schedulerTickRunning) {
      return;
    }
    schedulerTickRunning = true;
    try {
      const tickResult = schedulerRuntime.tick();
      for (const error of tickResult.errors) {
        writeStartupDiagnostics(
          `[experience-scheduler] event=tick_error detail=${error}\n`,
        );
        output.writeStderr(buildExperienceSchedulerTickErrorSurface(error));
      }
      for (const trigger of tickResult.triggered) {
        const pendingAskDepth = gaMechanismRuntime.getPendingAskQueueSize(
          runtimeState.getSessionKey(),
        );
        if (pendingAskDepth > 0) {
          writeStartupDiagnostics(
            `[experience-scheduler] event=task_skipped reason=pending_ask task=${trigger.taskId} queue_depth=${String(pendingAskDepth)}\n`,
          );
          continue;
        }
        if (runtimeState.getPlanMode() === "plan_only") {
          writeStartupDiagnostics(
            `[experience-scheduler] event=task_skipped reason=plan_mode task=${trigger.taskId}\n`,
          );
          continue;
        }
        writeStartupDiagnostics(
          `[experience-scheduler] event=task_triggered task=${trigger.taskId} report_path=${trigger.reportPath}\n`,
        );
        try {
          const code = await executeTurn(trigger.prompt, false);
          schedulerRuntime.writeDoneReport(trigger, {
            status: code === 0 ? "success" : "failed",
            exitCode: code,
            reason: code === 0 ? "turn_completed" : "turn_failed",
          });
          if (code !== 0) {
            runtimeState.markFailureObserved();
          }
          writeStartupDiagnostics(
            `[experience-scheduler] event=task_finished task=${trigger.taskId} status=${code === 0 ? "success" : "failed"} exit_code=${String(code)}\n`,
          );
        } catch (error) {
          schedulerRuntime.writeDoneReport(trigger, {
            status: "failed",
            exitCode: 1,
            reason: String(error),
          });
          runtimeState.markFailureObserved();
          writeStartupDiagnostics(
            `[experience-scheduler] event=task_failed task=${trigger.taskId} detail=${String(error)}\n`,
          );
          output.writeStderr(
            buildExperienceSchedulerTaskFailedSurface({
              taskId: trigger.taskId,
              error: String(error),
            }),
          );
        }
      }
    } finally {
      schedulerTickRunning = false;
    }
  };
  if (schedulerConfig.enabled) {
    schedulerTimer = setInterval(() => {
      void runSchedulerTick();
    }, schedulerConfig.intervalMs);
  }
  if (memoryMaintenanceEnabled) {
    memoryMaintenanceTimer = setInterval(() => {
      void runMemoryMaintenance("timer");
    }, memoryMaintenanceIntervalMs);
  }
  try {
    await runStartInteractiveMode(
      createRunStartInteractiveModeInput({
        homeDir,
        projectRoot,
        projectName,
        workDir,
        sessionNamespaceKey,
        sessionStoreRuntime: sessionStore.getRuntime(),
        sessionRegistryFilePathValue,
        handoffAutoOnExit,
        handoffRecentTurns,
        handoffPath,
        contextWindowTokens: contextEngineConfig.contextWindowTokens,
        contextEngineConfig,
        memoryOrchestrator,
        mcpInstructionPromptPrefix,
        mcpInstructionServerNames,
        mcpInstructionStrictFailure,
        buildHelpText: buildInteractiveHelpText,
        interactiveDiagnosticsEnabled,
        interactiveDiagnosticsMode,
        statusLineConfig,
        runtimeProviderChain,
        runtimeFailoverConfig,
        runtimeState,
        gaMechanismRuntime,
        output,
        modelOps,
        sessionMenuOps,
        wire,
        planMode,
        requestRuntimeInterrupt,
        executeTurn,
      }),
    );
  } finally {
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
    }
    if (memoryMaintenanceTimer) {
      clearInterval(memoryMaintenanceTimer);
    }
  }
  return 0;
}
