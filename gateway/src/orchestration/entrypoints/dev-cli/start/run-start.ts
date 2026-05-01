import { hasFlag, OptionValue, readOptionString } from "../cli-args";
import { buildInteractiveHelpText } from "./session-interactive";
import { bootstrapRunStartState } from "./run-start-bootstrap";
import { resolveRunStartContext } from "./run-start-context";
import { createRunStartInteractiveModeInput } from "./run-start-interactive-bindings";
import {
  runStartInteractiveMode,
  type InteractiveDiagnosticsMode,
} from "./run-start-interactive-mode";
import { createRunStartModelOps, type RunStartModelOps } from "./run-start-model-ops";
import { createRunStartSessionMenuOps } from "./run-start-session-menu-ops";
import { runSessionMenuPicker } from "./run-start-session-menu";
import { runTerminalSelectMenu } from "./run-start-io";
import { runStartMessageMode } from "./run-start-message-mode";
import { createRunStartOutput } from "./run-start-output";
import { createRunStartPersistence } from "./run-start-persistence";
import { createRunStartRuntimeState } from "./run-start-runtime-state";
import { createRunStartWire } from "./run-start-wire";
import { createRunStartPlanMode } from "./run-start-plan-mode";
import { createRunStartRewindStore } from "./run-start-rewind-store";
import { TURN_INTERRUPTED_EXIT_CODE } from "./run-start-turn";
import { terminalStyle } from "../ui/theme/terminal-style";
import { setSessionGaState } from "./session-registry";
import { createGaMechanismRuntime } from "../services/ga-mechanism-runtime";
import { createExperiencePoolRuntime } from "../services/experience-pool-runtime";
import { resolveStartupRewindDisambiguation } from "./session-rewind-startup-disambiguation";
import { resolveStartupRewindTarget } from "./session-rewind-startup";
import { resolveStartupResumeDisambiguation } from "./session-resume-startup-disambiguation";
import { resolveStartupResumeTarget } from "./session-resume-startup";
import {
  applyMemoryDecayAutotuneToPolicy,
  applyMemoryStrategyAutotuneToPolicy,
  createMemoryOrchestrator,
  defaultMemoryOrchestratorPolicy,
  deriveMemoryDecayAutotuneState,
  deriveMemoryStrategyAutotuneState,
  readMemoryDecayAutotuneState,
  readMemoryStrategyAutotuneState,
  writeMemoryDecayAutotuneState,
  writeMemoryStrategyAutotuneState,
  type MemoryOrchestratorExperienceAdapter,
  type MemoryOrchestratorGaAdapter,
  type MemoryStrategyAutotuneProfile,
} from "../../../../tools/memory";
import { readPromptQualityWindowSummary } from "../../../../tools/context";
import {
  createExperienceSchedulerRuntime,
  resolveExperienceSchedulerConfig,
} from "../services/experience-scheduler";
import { type RuntimeAttachment } from "../../../../models/types";

function isTruthyEnvFlag(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeMemoryStrategyProfile(
  raw: string | undefined,
): MemoryStrategyAutotuneProfile | undefined {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized === "general"
    || normalized === "debug_heavy"
    || normalized === "delivery"
    || normalized === "docs"
  ) {
    return normalized;
  }
  return undefined;
}

function resolveMemoryStrategyProfile(input: {
  envProfile: string | undefined;
  activeSessionKey: string;
  activeSessionPreview: string | undefined;
}): MemoryStrategyAutotuneProfile {
  const envProfile = normalizeMemoryStrategyProfile(input.envProfile);
  if (envProfile) {
    return envProfile;
  }
  const text = `${input.activeSessionKey} ${input.activeSessionPreview ?? ""}`.toLowerCase();
  if (/(debug|bug|fix|故障|排查|报错|修复|flaky)/.test(text)) {
    return "debug_heavy";
  }
  if (/(release|deploy|上线|发版|交付|deadline)/.test(text)) {
    return "delivery";
  }
  if (/(doc|readme|文档|总结|报告|spec)/.test(text)) {
    return "docs";
  }
  return "general";
}

function humanizeInterruptSource(source: "command" | "cli_esc"): string {
  return source === "cli_esc" ? "Esc" : "/interrupt";
}

function buildRuntimeInterruptSurface(input: {
  code: string;
  kind: "requested" | "not_running";
  source: "command" | "cli_esc";
}): string {
  const sourceLabel = humanizeInterruptSource(input.source);
  const lines: string[] = [];
  if (input.kind === "requested") {
    lines.push(
      `${terminalStyle.accent("●")} 已请求中断当前回合`,
      `  ${terminalStyle.muted(`来源: ${sourceLabel} · 正在尝试安全停止。`)}`,
    );
  } else {
    lines.push(
      `${terminalStyle.accent("●")} 当前没有运行中的回合`,
      `  ${terminalStyle.muted(`${sourceLabel} 只会中断正在运行的回合。`)}`,
    );
  }
  lines.push(`  ${terminalStyle.muted(`诊断: ${input.code}`)}`, "");
  return lines.join("\n");
}

export function buildRuntimeInterruptIgnoredSurface(input: {
  source: "command" | "cli_esc";
}): string {
  const sourceLabel = humanizeInterruptSource(input.source);
  return [
    `${terminalStyle.accent("●")} 中断请求未生效`,
    `  ${terminalStyle.muted(`${sourceLabel} 请求发出时，当前回合已完成或已过安全中断点。`)}`,
    "",
  ].join("\n");
}

function buildRuntimeToolsFallbackSurface(input: {
  reason: string | undefined;
  source: string;
}): string {
  const details = [
    "已使用内置工具 schema 启动。",
    `来源: ${input.source}`,
  ];
  if (input.reason && input.reason.trim().length > 0) {
    details.push(`原因: ${formatDiagnosticToken(input.reason)}`);
  }
  details.push("如需完整诊断，可运行 grobot status --json。");
  const lines = [`${terminalStyle.accent("●")} 运行时工具描述不可用`];
  for (const detail of details) {
    lines.push(`  ${terminalStyle.muted(detail)}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function buildMcpInstructionStrictFailureSurface(reason: string | undefined): string {
  const lines = [`${terminalStyle.accent("●")} MCP 指令加载失败`];
  lines.push(`  ${terminalStyle.muted("strict 模式要求所有启用的 MCP 都有指令包。")}`);
  if (reason && reason.trim().length > 0) {
    lines.push(`  ${terminalStyle.muted(`原因: ${formatDiagnosticToken(reason)}`)}`);
  }
  lines.push(`  ${terminalStyle.muted("请补齐 .grobot/rules/mcp/<server>.md，或关闭 mcp.instructions.strict。")}`);
  lines.push("");
  return lines.join("\n");
}

export function buildExperienceSchedulerTickErrorSurface(error: string | undefined): string {
  const lines = [`${terminalStyle.accent("●")} 经验任务调度失败`];
  lines.push(`  ${terminalStyle.muted("后台任务本轮已跳过，不影响当前输入。")}`);
  if (error && error.trim().length > 0) {
    lines.push(`  ${terminalStyle.muted(`原因: ${formatDiagnosticToken(error)}`)}`);
  }
  lines.push(`  ${terminalStyle.muted("如需完整诊断，可设置 GROBOT_STARTUP_DIAGNOSTICS=1 后重试。")}`);
  lines.push("");
  return lines.join("\n");
}

export function buildExperienceSchedulerTaskFailedSurface(input: {
  taskId: string;
  error: string | undefined;
}): string {
  const lines = [`${terminalStyle.accent("●")} 经验任务执行失败`];
  lines.push(`  ${terminalStyle.muted(`任务: ${input.taskId || "未知任务"}`)}`);
  lines.push(`  ${terminalStyle.muted("本轮调度已记录失败，不影响继续输入。")}`);
  if (input.error && input.error.trim().length > 0) {
    lines.push(`  ${terminalStyle.muted(`原因: ${formatDiagnosticToken(input.error)}`)}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function buildMemoryMaintenanceFailedSurface(input: {
  reason: string;
  error: string | undefined;
}): string {
  const lines = [`${terminalStyle.accent("●")} 记忆维护失败`];
  lines.push(`  ${terminalStyle.muted(`阶段: ${input.reason || "unknown"}`)}`);
  lines.push(`  ${terminalStyle.muted("本轮对话会继续，后台记忆清理将在后续回合重试。")}`);
  if (input.error && input.error.trim().length > 0) {
    lines.push(`  ${terminalStyle.muted(`原因: ${formatDiagnosticToken(input.error)}`)}`);
  }
  lines.push(`  ${terminalStyle.muted("如需完整诊断，可设置 GROBOT_STARTUP_DIAGNOSTICS=1 后重试。")}`);
  lines.push("");
  return lines.join("\n");
}

export function buildRewindCaptureFailedSurface(error: string | undefined): string {
  const lines = [`${terminalStyle.accent("●")} 检查点保存失败`];
  lines.push(`  ${terminalStyle.muted("本轮对话已继续，但这一步无法用于 /rewind 回退。")}`);
  if (error && error.trim().length > 0) {
    lines.push(`  ${terminalStyle.muted(`原因: ${formatDiagnosticToken(error)}`)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function normalizePositiveInt(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function applyContextWindowOverride(input: {
  config: {
    contextWindowTokens: number;
    reservedOutputTokens: number;
    safetyMarginTokens: number;
    autoCompactTokenLimit?: number;
  };
  nextWindowTokens: number;
  keepAutoCompactAbsolute: boolean;
  autoCompactRatio: number;
}): boolean {
  const normalizedNextWindow = Math.max(1_024, Math.floor(input.nextWindowTokens));
  const previousWindow = normalizePositiveInt(input.config.contextWindowTokens) ?? 1_024;
  const previousAutoCompact = normalizePositiveInt(input.config.autoCompactTokenLimit) ?? 1;
  if (previousWindow === normalizedNextWindow) {
    return false;
  }
  input.config.contextWindowTokens = normalizedNextWindow;
  if (!input.keepAutoCompactAbsolute) {
    const effectiveWindow = Math.max(
      1_024,
      normalizedNextWindow
        - input.config.reservedOutputTokens
        - input.config.safetyMarginTokens,
    );
    const scaledAutoCompact = Math.max(
      1,
      Math.floor(normalizedNextWindow * input.autoCompactRatio),
    );
    input.config.autoCompactTokenLimit = Math.max(
      1,
      Math.min(effectiveWindow, scaledAutoCompact),
    );
  }
  const nextAutoCompact = normalizePositiveInt(input.config.autoCompactTokenLimit) ?? 1;
  return previousAutoCompact !== nextAutoCompact || previousWindow !== normalizedNextWindow;
}

function formatStartupPickerPreview(value: string, maxLength = 42): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "-";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function formatDiagnosticToken(value: string | undefined, fallback = "<none>"): string {
  const normalized = (value ?? fallback)
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/\s+/g, "_")
    .trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, 360);
}

export async function runStart(
  options: Record<string, OptionValue>,
): Promise<number> {
  const MEMORY_MAINTENANCE_DEFAULT_INTERVAL_MS = 5 * 60 * 1_000;
  const MEMORY_MAINTENANCE_MIN_INTERVAL_MS = 15_000;
  const PROMPT_QUALITY_WINDOW_DEFAULT_SIZE = 20;
  const TURN_INTERRUPT_OK_CODE = "TURN_INTERRUPT_OK";
  const TURN_INTERRUPT_NOT_RUNNING_CODE = "TURN_INTERRUPT_NOT_RUNNING";
  const isTurnInterruptedCode = (code: number): boolean => code === TURN_INTERRUPTED_EXIT_CODE;
  const context = resolveRunStartContext(options);
  const {
    homeDir,
    projectRoot,
    workDir,
    projectTomlPath,
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
  const traceModeEnabled = hasFlag(options, "trace");
  const verboseModeEnabled = hasFlag(options, "verbose") || traceModeEnabled;
  const interactiveDiagnosticsMode: InteractiveDiagnosticsMode = traceModeEnabled
    ? "trace"
    : verboseModeEnabled
      ? "verbose"
      : "compact";
  const startupDiagnosticsEnabled = isTruthyEnvFlag(
    process.env.GROBOT_STARTUP_DIAGNOSTICS,
  ) || traceModeEnabled;
  const interactiveDiagnosticsEnabled = interactiveDiagnosticsMode !== "compact";
  const output = createRunStartOutput({
    suppressWarningPatterns: startupDiagnosticsEnabled
      ? []
      : [
        /^session store fallback to file:/i,
      ],
  });
  const writeStartupDiagnostics = (message: string): void => {
    if (!startupDiagnosticsEnabled) {
      return;
    }
    output.writeStderr(message);
  };
  if (runtimeToolContextDiagnostics.enabledToolsSource === "runtime.tools.describe") {
    writeStartupDiagnostics(
      `[tool-surface] event=runtime_describe_ok enabled_tools_source=${runtimeToolContextDiagnostics.enabledToolsSource} manifest_fingerprint=${runtimeToolContextDiagnostics.manifestFingerprint} manifest_tool_count=${String(runtimeToolContextDiagnostics.manifestToolCount)} default_enabled_count=${String(runtimeToolContextDiagnostics.manifestDefaultEnabledCount)} schema_profiles_fingerprint=${runtimeToolContextDiagnostics.schemaProfilesFingerprint ?? "<none>"}\n`,
    );
  } else {
    const fallbackDiagnostic =
      `[tool-surface] event=runtime_describe_fallback enabled_tools_source=${runtimeToolContextDiagnostics.enabledToolsSource} reason=${formatDiagnosticToken(runtimeToolContextDiagnostics.enabledToolsSourceDetail)} manifest_fingerprint=${runtimeToolContextDiagnostics.manifestFingerprint} manifest_tool_count=${String(runtimeToolContextDiagnostics.manifestToolCount)} default_enabled_count=${String(runtimeToolContextDiagnostics.manifestDefaultEnabledCount)} schema_profiles_fingerprint=${runtimeToolContextDiagnostics.schemaProfilesFingerprint ?? "<none>"}\n`;
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
  const configuredAutoCompactLimit = normalizePositiveInt(
    contextEngineConfig.autoCompactTokenLimit,
  ) ?? defaultAutoCompactLimit;
  const keepAutoCompactAbsolute = Math.abs(
    configuredAutoCompactLimit - defaultAutoCompactLimit,
  ) > 1;
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
    output.writeStderr(buildMcpInstructionStrictFailureSurface(mcpInstructionStrictFailure));
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
  const gaMechanismRuntime = createGaMechanismRuntime();
  gaMechanismRuntime.hydrateSession(
    runtimeState.getSessionKey(),
    runtimeState.getGaState(),
  );
  const gaAdapter: MemoryOrchestratorGaAdapter = {
    listMemory: (sessionKey) => gaMechanismRuntime.listMemory(sessionKey),
    listSkillCards: (sessionKey) => gaMechanismRuntime.listSkillCards(sessionKey),
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
  let turnQueue: Promise<unknown> = Promise.resolve();
  let activeTurnAbortController: AbortController | undefined;
  let pendingRuntimeInterruptSource: "command" | "cli_esc" | undefined;
  const memoryMaintenanceEnabled = !["0", "false", "off", "no"].includes(
    (process.env.GROBOT_MEMORY_MAINTENANCE_ENABLED ?? "1").trim().toLowerCase(),
  );
  const parsedMemoryInterval = Number.parseInt(
    process.env.GROBOT_MEMORY_MAINTENANCE_INTERVAL_MS ?? "",
    10,
  );
  const memoryMaintenanceIntervalMs =
    Number.isFinite(parsedMemoryInterval) && parsedMemoryInterval > 0
      ? Math.max(MEMORY_MAINTENANCE_MIN_INTERVAL_MS, parsedMemoryInterval)
      : MEMORY_MAINTENANCE_DEFAULT_INTERVAL_MS;
  const parsedPromptQualityWindowSize = Number.parseInt(
    process.env.GROBOT_CONTEXT_GRAPH_CACHE_WINDOW_SIZE ?? "",
    10,
  );
  const promptQualityWindowSize =
    Number.isFinite(parsedPromptQualityWindowSize) && parsedPromptQualityWindowSize > 0
      ? Math.floor(parsedPromptQualityWindowSize)
      : PROMPT_QUALITY_WINDOW_DEFAULT_SIZE;
  let memoryMaintenanceRunning = false;
  const runMemoryMaintenance = async (reason: "bootstrap" | "post_turn" | "timer"): Promise<void> => {
    if (memoryMaintenanceRunning) {
      return;
    }
    if (
      reason === "timer"
      && activeTurnAbortController
      && !activeTurnAbortController.signal.aborted
    ) {
      writeStartupDiagnostics("[memory-orchestrator] event=maintenance_skipped reason=active_turn\n");
      return;
    }
    memoryMaintenanceRunning = true;
    try {
      const sessionRegistry = runtimeState.getSessionRegistry();
      const activeSessionId = runtimeState.getActiveSessionId();
      const activeSessionKey = runtimeState.getSessionKey();
      const activeSessionRecord = sessionRegistry.sessions.find(
        (item) => item.id === activeSessionId || item.session_key === activeSessionKey,
      );
      const strategyProfile = resolveMemoryStrategyProfile({
        envProfile: process.env.GROBOT_MEMORY_STRATEGY_PROFILE,
        activeSessionKey,
        activeSessionPreview: activeSessionRecord?.preview,
      });
      const maintenanceNowMs = Date.now();
      let sessionsScanned = 0;
      let sessionsUpdated = 0;
      let deduplicatedRows = 0;
      let decaySessionsPruned = 0;
      let decayDroppedRows = 0;
      let decayDroppedByAge = 0;
      let decayDroppedByConfidence = 0;
      let decayDroppedByCapacity = 0;
      let totalRowsBefore = 0;
      let totalRowsAfter = 0;
      for (const record of sessionRegistry.sessions) {
        if (!record.ga_state || !Array.isArray(record.ga_state.memory) || record.ga_state.memory.length === 0) {
          continue;
        }
        sessionsScanned += 1;
        totalRowsBefore += record.ga_state.memory.length;
        const reconcileResult = memoryOrchestrator.reconcile({
          rows: record.ga_state.memory,
        });
        const decayResult = memoryOrchestrator.decay({
          rows: reconcileResult.rows,
          nowMs: maintenanceNowMs,
        });
        totalRowsAfter += decayResult.rows.length;
        if (reconcileResult.deduplicated > 0) {
          deduplicatedRows += reconcileResult.deduplicated;
        }
        if (decayResult.dropped > 0) {
          decaySessionsPruned += 1;
          decayDroppedRows += decayResult.dropped;
          decayDroppedByAge += decayResult.droppedByReason.ageExceeded;
          decayDroppedByConfidence += decayResult.droppedByReason.lowConfidence;
          decayDroppedByCapacity += decayResult.droppedByReason.capacityTrim;
        }
        if (reconcileResult.deduplicated <= 0 && decayResult.dropped <= 0) {
          continue;
        }
        sessionsUpdated += 1;
        const nextGaState = {
          ...record.ga_state,
          memory: [...decayResult.rows],
        };
        record.ga_state = nextGaState;
        if (record.id === activeSessionId || record.session_key === activeSessionKey) {
          runtimeState.setGaState(nextGaState);
          gaMechanismRuntime.hydrateSession(activeSessionKey, nextGaState);
        }
      }
      if (sessionsUpdated > 0) {
        setSessionGaState(
          sessionRegistry,
          activeSessionId,
          runtimeState.getGaState(),
        );
        await persistence.persistSessionRegistryState();
      }
      const decayAction = decayDroppedRows > 0 ? "pruned" : "noop";
      const decayReason = decayDroppedRows > 0
        ? `age_exceeded:${String(decayDroppedByAge)},low_confidence:${String(decayDroppedByConfidence)},capacity_trim:${String(decayDroppedByCapacity)}`
        : "within_policy";
      const promptQualityWindowSummary = readPromptQualityWindowSummary({
        workDir,
        size: promptQualityWindowSize,
        lowQualityThreshold: contextEngineConfig.promptQuality?.lowQualityThreshold,
      });
      const qualitySnapshot = {
        lowQualityRate: promptQualityWindowSummary.lowQualityRate,
        averagePreSendPressureScore: promptQualityWindowSummary.signalAverages?.preSendPressureScore ?? null,
        hardBudgetFollowupOverallDelta:
          promptQualityWindowSummary.strategyOutcomes.hardBudgetFollowupOverallDelta,
        qualityFirstFollowupOverallDelta:
          promptQualityWindowSummary.strategyOutcomes.qualityFirstFollowupOverallDelta,
        hardBudgetRate: promptQualityWindowSummary.strategyActivity.hardBudgetRate,
        qualityFirstImprovedRate:
          promptQualityWindowSummary.strategyOutcomes.qualityFirstImprovedRate,
        averageUtilizationRatio: promptQualityWindowSummary.tokenBudget.averageUtilizationRatio,
        autoLimitTriggeredRate: promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate,
        snapshotSemanticCompressRate:
          promptQualityWindowSummary.compressionActivity.snapshotSemanticCompressRate,
        shortAverageUtilizationRatio:
          promptQualityWindowSummary.pressureTrends.short.averageUtilizationRatio,
        mediumAverageUtilizationRatio:
          promptQualityWindowSummary.pressureTrends.medium.averageUtilizationRatio,
        deltaAverageUtilizationRatio:
          promptQualityWindowSummary.pressureTrends.delta.averageUtilizationRatio,
        shortAutoLimitTriggeredRate:
          promptQualityWindowSummary.pressureTrends.short.autoLimitTriggeredRate,
        mediumAutoLimitTriggeredRate:
          promptQualityWindowSummary.pressureTrends.medium.autoLimitTriggeredRate,
        deltaAutoLimitTriggeredRate:
          promptQualityWindowSummary.pressureTrends.delta.autoLimitTriggeredRate,
        shortSnapshotSemanticCompressRate:
          promptQualityWindowSummary.pressureTrends.short.snapshotSemanticCompressRate,
        mediumSnapshotSemanticCompressRate:
          promptQualityWindowSummary.pressureTrends.medium.snapshotSemanticCompressRate,
        deltaSnapshotSemanticCompressRate:
          promptQualityWindowSummary.pressureTrends.delta.snapshotSemanticCompressRate,
      };
      const formatQualityValue = (value: number | null | undefined): string =>
        typeof value === "number" && Number.isFinite(value)
          ? value.toFixed(3)
          : "<none>";
      const decayAutotuneResult = deriveMemoryDecayAutotuneState({
        basePolicy: baseMemoryPolicy,
        currentState: memoryDecayAutotuneState,
        stats: {
          sessionsScanned,
          totalRowsBefore,
          totalRowsAfter,
          droppedRows: decayDroppedRows,
          droppedByAge: decayDroppedByAge,
          droppedByConfidence: decayDroppedByConfidence,
          droppedByCapacity: decayDroppedByCapacity,
        },
        quality: qualitySnapshot,
      });
      let decayAutotuneUpdated = false;
      let policyAfterAutotune = memoryOrchestrator.policySnapshot();
      if (decayAutotuneResult.changed) {
        decayAutotuneUpdated = true;
        memoryDecayAutotuneState = decayAutotuneResult.state;
        const tunedPolicyFromState = applyMemoryDecayAutotuneToPolicy({
          basePolicy: baseMemoryPolicy,
          state: memoryDecayAutotuneState,
        });
        const tunedPolicy = memoryOrchestrator.tuneDecayPolicy({
          decayMaxRowsPerSession: tunedPolicyFromState.decayMaxRowsPerSession,
          decayMinConfidenceVerified: tunedPolicyFromState.decayMinConfidenceVerified,
          decayMinConfidenceUnverified: tunedPolicyFromState.decayMinConfidenceUnverified,
          decayUnverifiedMaxAgeHours: tunedPolicyFromState.decayUnverifiedMaxAgeHours,
        });
        writeMemoryDecayAutotuneState({
          workDir,
          basePolicy: baseMemoryPolicy,
          state: memoryDecayAutotuneState,
        });
        policyAfterAutotune = tunedPolicy;
        writeStartupDiagnostics(
          `[memory-orchestrator] event=decay_autotune_updated reason=${decayAutotuneResult.reason} updates=${String(memoryDecayAutotuneState.adaptiveUpdates)} decay_max_rows=${String(tunedPolicy.decayMaxRowsPerSession)} decay_unverified_age_hours=${String(tunedPolicy.decayUnverifiedMaxAgeHours)} decay_confidence=${tunedPolicy.decayMinConfidenceVerified.toFixed(2)}/${tunedPolicy.decayMinConfidenceUnverified.toFixed(2)}\n`,
        );
      }
      const strategyAutotuneResult = deriveMemoryStrategyAutotuneState({
        basePolicy: baseMemoryPolicy,
        currentState: memoryStrategyAutotuneState,
        quality: qualitySnapshot,
        profile: strategyProfile,
      });
      let strategyAutotuneUpdated = false;
      if (strategyAutotuneResult.changed) {
        strategyAutotuneUpdated = true;
        memoryStrategyAutotuneState = strategyAutotuneResult.state;
        const tunedPolicyFromState = applyMemoryStrategyAutotuneToPolicy({
          basePolicy: policyAfterAutotune,
          state: memoryStrategyAutotuneState,
        });
        const tunedPolicy = memoryOrchestrator.tuneInjectionPolicy({
          injectBudgetRatio: tunedPolicyFromState.injectBudgetRatio,
          maxSectionTokens: tunedPolicyFromState.maxSectionTokens,
          maxGaMemoryRows: tunedPolicyFromState.maxGaMemoryRows,
          maxTeamExperienceRows: tunedPolicyFromState.maxTeamExperienceRows,
          minTeamExperienceScore: tunedPolicyFromState.minTeamExperienceScore,
        });
        policyAfterAutotune = tunedPolicy;
        writeMemoryStrategyAutotuneState({
          workDir,
          basePolicy: baseMemoryPolicy,
          state: memoryStrategyAutotuneState,
        });
        writeStartupDiagnostics(
          `[memory-orchestrator] event=strategy_autotune_updated reason=${strategyAutotuneResult.reason} updates=${String(memoryStrategyAutotuneState.adaptiveUpdates)} profile=${memoryStrategyAutotuneState.profile} budget_ratio=${tunedPolicy.injectBudgetRatio.toFixed(3)} section_max=${String(tunedPolicy.maxSectionTokens)} ga_rows=${String(tunedPolicy.maxGaMemoryRows)} team_rows=${String(tunedPolicy.maxTeamExperienceRows)} team_score_min=${String(tunedPolicy.minTeamExperienceScore)} pressure_ema=${memoryStrategyAutotuneState.averageUtilizationRatioEma.toFixed(3)}/${memoryStrategyAutotuneState.autoLimitTriggeredRateEma.toFixed(3)}/${memoryStrategyAutotuneState.snapshotSemanticCompressRateEma.toFixed(3)} pressure_delta=${formatQualityValue(qualitySnapshot.deltaAverageUtilizationRatio)}/${formatQualityValue(qualitySnapshot.deltaAutoLimitTriggeredRate)}/${formatQualityValue(qualitySnapshot.deltaSnapshotSemanticCompressRate)} outcome=${memoryStrategyAutotuneState.lastOutcomeGain.toFixed(3)}/${memoryStrategyAutotuneState.outcomeConfidenceEma.toFixed(3)}/${String(memoryStrategyAutotuneState.outcomeRollbackCount)}/${String(memoryStrategyAutotuneState.outcomeNegativeStreak)}\n`,
        );
      }
      writeStartupDiagnostics(
        `[memory-orchestrator] event=maintenance reason=${reason} sessions_scanned=${String(sessionsScanned)} sessions_updated=${String(sessionsUpdated)} deduplicated_rows=${String(deduplicatedRows)} total_rows=${String(totalRowsBefore)}->${String(totalRowsAfter)} decay_sessions_pruned=${String(decaySessionsPruned)} decay_dropped_rows=${String(decayDroppedRows)} decay_action=${decayAction} decay_reason=${decayReason} quality_low_rate=${formatQualityValue(qualitySnapshot.lowQualityRate)} quality_pressure=${formatQualityValue(qualitySnapshot.averagePreSendPressureScore)} quality_hard_budget_rate=${formatQualityValue(qualitySnapshot.hardBudgetRate)} quality_first_improved_rate=${formatQualityValue(qualitySnapshot.qualityFirstImprovedRate)} quality_followup_delta=${formatQualityValue(qualitySnapshot.hardBudgetFollowupOverallDelta)}/${formatQualityValue(qualitySnapshot.qualityFirstFollowupOverallDelta)} pressure_utilization=${formatQualityValue(qualitySnapshot.averageUtilizationRatio)} pressure_auto_limit_rate=${formatQualityValue(qualitySnapshot.autoLimitTriggeredRate)} pressure_semantic_rate=${formatQualityValue(qualitySnapshot.snapshotSemanticCompressRate)} pressure_delta=${formatQualityValue(qualitySnapshot.deltaAverageUtilizationRatio)}/${formatQualityValue(qualitySnapshot.deltaAutoLimitTriggeredRate)}/${formatQualityValue(qualitySnapshot.deltaSnapshotSemanticCompressRate)} decay_autotune_updated=${decayAutotuneUpdated ? "true" : "false"} decay_autotune_reason=${decayAutotuneResult.reason} strategy_autotune_updated=${strategyAutotuneUpdated ? "true" : "false"} strategy_autotune_reason=${strategyAutotuneResult.reason} strategy_profile=${memoryStrategyAutotuneState.profile} strategy_budget_ratio=${policyAfterAutotune.injectBudgetRatio.toFixed(3)} strategy_section_max=${String(policyAfterAutotune.maxSectionTokens)} strategy_ga_rows=${String(policyAfterAutotune.maxGaMemoryRows)} strategy_team_rows=${String(policyAfterAutotune.maxTeamExperienceRows)} strategy_team_score_min=${String(policyAfterAutotune.minTeamExperienceScore)} strategy_action=${memoryStrategyAutotuneState.lastActionDirection} strategy_cooldown=${String(memoryStrategyAutotuneState.cooldownTurnsRemaining)} strategy_streak=${String(memoryStrategyAutotuneState.tightenSignalStreak)}/${String(memoryStrategyAutotuneState.relaxSignalStreak)} strategy_scale=${memoryStrategyAutotuneState.adaptiveActionScale.toFixed(3)} strategy_outcome=${memoryStrategyAutotuneState.lastOutcomeGain.toFixed(3)}/${memoryStrategyAutotuneState.outcomeConfidenceEma.toFixed(3)}/${String(memoryStrategyAutotuneState.outcomeRollbackCount)}/${String(memoryStrategyAutotuneState.outcomeNegativeStreak)}\n`,
      );
    } catch (error) {
      writeStartupDiagnostics(
        `[memory-orchestrator] event=maintenance_failed reason=${reason} detail=${String(error)}\n`,
      );
      output.writeStderr(
        buildMemoryMaintenanceFailedSurface({
          reason,
          error: String(error),
        }),
      );
    } finally {
      memoryMaintenanceRunning = false;
    }
  };
  writeStartupDiagnostics(
    `[memory-orchestrator] maintenance_enabled=${memoryMaintenanceEnabled ? "on" : "off"} interval_ms=${String(memoryMaintenanceIntervalMs)}\n`,
  );
  const requestRuntimeInterrupt = (
    source: "command" | "cli_esc",
  ): {
    code: typeof TURN_INTERRUPT_OK_CODE | typeof TURN_INTERRUPT_NOT_RUNNING_CODE;
    interrupted: boolean;
  } => {
    const controller = activeTurnAbortController;
    if (!controller || controller.signal.aborted) {
      output.writeStdout(
        buildRuntimeInterruptSurface({
          code: TURN_INTERRUPT_NOT_RUNNING_CODE,
          kind: "not_running",
          source,
        }),
      );
      writeStartupDiagnostics(
        `[interrupt] event=rejected reason=no_active_turn source=${source}\n`,
      );
      return {
        code: TURN_INTERRUPT_NOT_RUNNING_CODE,
        interrupted: false,
      };
    }
    controller.abort(`source=${source}`);
    pendingRuntimeInterruptSource = source;
    output.writeStdout(
      buildRuntimeInterruptSurface({
        code: TURN_INTERRUPT_OK_CODE,
        kind: "requested",
        source,
      }),
    );
    writeStartupDiagnostics(
      `[interrupt] event=requested source=${source}\n`,
    );
    return {
      code: TURN_INTERRUPT_OK_CODE,
      interrupted: true,
    };
  };
  const runTurnWithController = async (
    userInput: string,
    interactiveMode: boolean,
    controller: AbortController,
    options?: {
      attachments?: RuntimeAttachment[];
      promptPrelude?: string;
      autoOpenAskUserPanel?: boolean;
      emitDiagnostics?: boolean;
      writeStdout?: (message: string) => void;
      writeStderr?: (message: string) => void;
    },
  ): Promise<number> => {
    const writeStderr = options?.writeStderr ?? output.writeStderr;
    activeTurnAbortController = controller;
    const turnCapture = rewindStore.beginTurnCapture({
      sessionKey: runtimeState.getSessionKey(),
      userText: userInput,
      historyBefore: runtimeState.getHistoryMessages(),
    });
    let recordedAssistantText: string | undefined;
    try {
      refreshContextWindowFromModelCatalog("pre_turn");
      const code = await wire.executeTurn(userInput, interactiveMode, {
        signal: controller.signal,
        attachments: options?.attachments,
        promptPrelude: options?.promptPrelude,
        autoOpenAskUserPanel: options?.autoOpenAskUserPanel,
        emitDiagnostics: options?.emitDiagnostics,
        writeStdout: options?.writeStdout,
        writeStderr,
        onTurnRecorded: (turnRecord) => {
          recordedAssistantText = turnRecord.assistantText;
        },
      });
      if (code !== TURN_INTERRUPTED_EXIT_CODE) {
        const historyAfter = runtimeState.getHistoryMessages();
        const assistantText = recordedAssistantText
          ?? (() => {
            const last = historyAfter[historyAfter.length - 1];
            if (last?.role === "assistant") {
              return last.content;
            }
            return `[turn] exit_code=${String(code)}`;
          })();
        try {
          await rewindStore.commitTurnCapture({
            capture: turnCapture,
            assistantText,
            historyAfter,
          });
        } catch (error) {
          writeStartupDiagnostics(`[rewind] event=capture_failed detail=${String(error)}\n`);
          writeStderr(buildRewindCaptureFailedSurface(String(error)));
        }
      }
      if (pendingRuntimeInterruptSource && code === TURN_INTERRUPTED_EXIT_CODE) {
        writeStartupDiagnostics(
          `[interrupt] event=applied source=${pendingRuntimeInterruptSource} interactive=${interactiveMode ? "true" : "false"}\n`,
        );
        pendingRuntimeInterruptSource = undefined;
      } else if (
        pendingRuntimeInterruptSource &&
        controller.signal.aborted &&
        code !== TURN_INTERRUPTED_EXIT_CODE
      ) {
        writeStartupDiagnostics(
          `[interrupt] event=ignored source=${pendingRuntimeInterruptSource} reason=turn_completed_before_abort interactive=${interactiveMode ? "true" : "false"}\n`,
        );
        writeStderr(buildRuntimeInterruptIgnoredSurface({
          source: pendingRuntimeInterruptSource,
        }));
        pendingRuntimeInterruptSource = undefined;
      }
      await runMemoryMaintenance("post_turn");
      return code;
    } finally {
      if (activeTurnAbortController === controller) {
        activeTurnAbortController = undefined;
      }
    }
  };
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
    },
  ): Promise<number> => {
    const controller = new AbortController();
    const next = turnQueue.then(
      async () => runTurnWithController(userInput, interactiveMode, controller, options),
      async () => runTurnWithController(userInput, interactiveMode, controller, options),
    );
    turnQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const schedulerRuntime = createExperienceSchedulerRuntime(
    resolveExperienceSchedulerConfig({
      workDir,
      projectTomlPath,
    }),
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

  const applyStartupSessionActions = async (): Promise<void> => {
    let resumed = false;
    const resumeTarget = resolveStartupResumeTarget({
      resumeRequested,
      resumeLastRequested,
      resumeAllRequested,
      resumeQuery: resumeSelector,
      sessions: sessionOps.listSessions(),
    });
    let targetResumeSessionId = resumeTarget.targetSessionId;
    if (resumeTarget.notice) {
      output.writeStdout(resumeTarget.notice);
    }
    if (resumeTarget.requiresDisambiguation) {
      const disambiguation = await resolveStartupResumeDisambiguation({
        resumeTarget,
        stdinIsTTY: Boolean(process.stdin.isTTY),
        pickSession: async (candidates) =>
          runSessionMenuPicker({
            mode: "resume",
            sessionNamespaceKey,
            sessions: candidates,
            withInputPaused: async <T>(operation: () => Promise<T>) => operation(),
          }),
      });
      targetResumeSessionId = disambiguation.targetSessionId;
      for (const message of disambiguation.messages) {
        output.writeStdout(message);
      }
    }
    if (targetResumeSessionId) {
      resumed = await sessionOps.resumeFromSession(targetResumeSessionId, "cli:resume");
      if (resumed) {
        modelOps.applyModelOverrideForActiveSession();
      }
    }
    const hasLegacyRewindCheckpointId = typeof resumeSessionAt === "string"
      && resumeSessionAt.trim().length > 0;
    const shouldRunRewind = rewindRequested
      || hasLegacyRewindCheckpointId
      || (Array.isArray(rewindFiles) && rewindFiles.length > 0);
    if (shouldRunRewind) {
      const rewindQuery = (rewindSelector?.trim() ?? "")
        || (resumeSessionAt?.trim() ?? "");
      const rewindTarget = resolveStartupRewindTarget({
        rewindRequested: shouldRunRewind,
        rewindQuery,
        rewindQueryStrict: rewindQuery.length > 0
          && hasLegacyRewindCheckpointId
          && !(rewindSelector?.trim()),
        checkpoints: sessionOps.listRewindCheckpoints(
          runtimeState.getActiveSessionId(),
          64,
        ),
      });
      let targetCheckpointId = rewindTarget.targetCheckpointId;
      if (rewindTarget.notice) {
        output.writeStdout(rewindTarget.notice);
      }
      if (rewindTarget.requiresDisambiguation) {
        const disambiguation = await resolveStartupRewindDisambiguation({
          rewindTarget,
          stdinIsTTY: Boolean(process.stdin.isTTY),
          pickCheckpoint: async (candidates) => {
            const picked = await runTerminalSelectMenu({
              title: "启动回退 Checkpoint",
              subtitle: `会话: ${runtimeState.getActiveSessionId()}`,
              hint: "↑/↓ 选择 · Enter 确认 · Esc 跳过",
              items: candidates.map((checkpoint) => ({
                id: checkpoint.checkpointId,
                label: checkpoint.checkpointId,
                description:
                  `${checkpoint.createdAt} | 文件=${String(checkpoint.changedFilesCount)} | 用户=${
                    formatStartupPickerPreview(checkpoint.userText)
                  } | 助手=${formatStartupPickerPreview(checkpoint.assistantText)}`,
              })),
            });
            if (picked.kind === "cancelled") {
              return { kind: "cancelled" };
            }
            return {
              kind: "checkpoint",
              checkpointId: picked.item.id,
            };
          },
        });
        targetCheckpointId = disambiguation.targetCheckpointId;
        for (const message of disambiguation.messages) {
          output.writeStdout(message);
        }
      }
      if (targetCheckpointId) {
        await sessionOps.rewindSession({
          sessionId: runtimeState.getActiveSessionId(),
          checkpointId: targetCheckpointId,
          mode: rewindMode,
          fileFilter: rewindFiles,
          reason: resumed ? "cli:resume+rewind" : "cli:rewind",
        });
      }
    }
    if (forkSession) {
      const forked = await sessionOps.forkFromSession(
        runtimeState.getActiveSessionId(),
        "cli:fork-session",
      );
      if (forked) {
        modelOps.applyModelOverrideForActiveSession();
      }
    }
  };

  await applyStartupSessionActions();

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
        writeStartupDiagnostics(`[experience-scheduler] event=tick_error detail=${error}\n`);
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
