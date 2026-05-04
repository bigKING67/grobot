import { mkdirSync, writeFileSync } from "node:fs";



export function runStartContextMemoryDecayAutotuneQualityFlow(context) {
  const {
    repoRoot,
    createTempDir,
    writeExecutionProjectToml,
    writeConfig,
    buildSmokeConfig,
    runCommand,
    parseJsonObjectSafe,
    isObject,
    readJsonFileSafe,
  } = context;
  const workDir = createTempDir("grobot-start-memory-decay-autotune-quality-work");
  writeExecutionProjectToml(workDir);
  const contextDir = `${workDir}/.grobot/context`;
  const memoryContextEngineDir = `${workDir}/.grobot/memory/context-engine`;
  mkdirSync(contextDir, { recursive: true });
  mkdirSync(memoryContextEngineDir, { recursive: true });
  const promptSeedPath = `${contextDir}/prompt-quality-window.jsonl`;
  const statePath = `${memoryContextEngineDir}/memory-decay-autotune-state.json`;
  const strategyStatePath = `${memoryContextEngineDir}/memory-strategy-autotune-state.json`;
  const seedNowMs = Date.now();
  const promptRows = [0, 1, 2].map((index) => ({
    ts: new Date(seedNowMs - (3 - index) * 1_000).toISOString(),
    sessionKey: "seed:memory-decay-quality-autotune",
    stage: "minimal",
    selectionReason: "seed",
    estimatedTokens: 8200 + (index * 200),
    targetTokenLimit: 5000,
    scores: {
      coverage: 0.38,
      recency: 0.33,
      size: 0.29,
      overall: 0.46 - (index * 0.04),
    },
    signals: {
      recentRows: 2,
      snapshotSections: 3,
      recentTrimRows: 1,
      snapshotTrimSections: 2,
      snapshotSemanticCompressSections: 3,
      headTrimRetries: 1,
      autoLimitTriggered: true,
      downshiftGuardTriggered: true,
      preSendStrategy: "hard_budget",
      preSendOverflowRatio: 0.52 + (index * 0.03),
      preSendPressureScore: 0.84 + (index * 0.02),
    },
  }));
  writeFileSync(
    promptSeedPath,
    `${promptRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  const seededState = {
    maxRowsPerSession: 240,
    minConfidenceVerified: 0.20,
    minConfidenceUnverified: 0.45,
    unverifiedMaxAgeHours: 72,
    adaptiveLearnAlpha: 0.2,
    adaptiveUpdates: 4,
    dropRatioEma: 0.01,
    capacityTrimRatioEma: 0.02,
    lowConfidenceRatioEma: 0.03,
    ageDropRatioEma: 0.04,
    qualityLowRateEma: 0.72,
    qualityPressureEma: 0.74,
    hardBudgetFollowupDeltaEma: -0.12,
    qualityFirstFollowupDeltaEma: -0.02,
    lastReason: "seed_quality_pressure",
    updatedAt: "2026-04-19T10:00:00.000Z",
  };
  writeFileSync(statePath, `${JSON.stringify(seededState, null, 2)}\n`, "utf8");
  const seededStrategyState = {
    injectBudgetRatio: 0.27,
    maxSectionTokens: 1360,
    maxGaMemoryRows: 5,
    maxTeamExperienceRows: 4,
    minTeamExperienceScore: 34,
    adaptiveLearnAlpha: 0.2,
    adaptiveUpdates: 3,
    qualityLowRateEma: 0.66,
    qualityPressureEma: 0.74,
    hardBudgetRateEma: 0.61,
    qualityFirstImprovedRateEma: 0.28,
    hardBudgetFollowupDeltaEma: -0.11,
    qualityFirstFollowupDeltaEma: -0.03,
    lastReason: "seed_quality_pressure",
    updatedAt: "2026-04-19T10:05:00.000Z",
  };
  writeFileSync(strategyStatePath, `${JSON.stringify(seededStrategyState, null, 2)}\n`, "utf8");
  const config = writeConfig(buildSmokeConfig(workDir));
  const startResult = runCommand(repoRoot, [
    "./grobot",
    "start",
    "--project",
    "grobot",
    "--work-dir",
    workDir,
    "--config",
    config.configPath,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
    "--session-subject",
    "memory-decay-quality-autotune-user",
    "--history-turns",
    "8",
    "--message",
    "memory decay autotune should tighten by prompt quality pressure",
  ], {
    GROBOT_STARTUP_DIAGNOSTICS: "1",
  });
  const maintenanceEvent = startResult.stderr.match(
    /event=maintenance[^\n]*quality_low_rate=([0-9.<>-]+)[^\n]*quality_pressure=([0-9.<>-]+)[^\n]*decay_autotune_reason=([a-z_,]+)/,
  );
  const statusResult = runCommand(repoRoot, [
    "./grobot",
    "status",
    "--json",
    "--project",
    "grobot",
    "--work-dir",
    workDir,
    "--config",
    config.configPath,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
  ]);
  const parsedStatus = parseJsonObjectSafe(statusResult.stdout);
  const memoryOrchestrator = isObject(parsedStatus?.context_engine?.memory_orchestrator)
    ? parsedStatus.context_engine.memory_orchestrator
    : null;
  const statusAutotune = isObject(memoryOrchestrator?.autotune)
    ? memoryOrchestrator.autotune
    : null;
  const statusStrategyAutotune = isObject(memoryOrchestrator?.strategy_autotune)
    ? memoryOrchestrator.strategy_autotune
    : null;
  const persistedState = readJsonFileSafe(statePath);
  const persistedAutotune = isObject(persistedState) ? persistedState : null;
  const persistedStrategyState = readJsonFileSafe(strategyStatePath);
  const persistedStrategyAutotune = isObject(persistedStrategyState) ? persistedStrategyState : null;
  const decayMaxRowsAfter = typeof memoryOrchestrator?.decay_max_rows_per_session === "number"
    ? memoryOrchestrator.decay_max_rows_per_session
    : null;
  const decayMinConfidenceVerifiedAfter =
    typeof memoryOrchestrator?.decay_min_confidence_verified === "number"
      ? memoryOrchestrator.decay_min_confidence_verified
      : null;
  const decayMinConfidenceUnverifiedAfter =
    typeof memoryOrchestrator?.decay_min_confidence_unverified === "number"
      ? memoryOrchestrator.decay_min_confidence_unverified
      : null;
  return {
    start_exit_code: startResult.exit_code,
    status_exit_code: statusResult.exit_code,
    maintenance_quality_signal_logged: Boolean(maintenanceEvent),
    maintenance_quality_low_rate: maintenanceEvent?.[1] ?? "",
    maintenance_quality_pressure: maintenanceEvent?.[2] ?? "",
    maintenance_autotune_reason: maintenanceEvent?.[3] ?? "",
    maintenance_autotune_quality_reason_seen:
      typeof maintenanceEvent?.[3] === "string"
      && maintenanceEvent[3].includes("quality_pressure_tighten"),
    status_json_parse_ok: Boolean(parsedStatus),
    status_memory_orchestrator_present: Boolean(memoryOrchestrator),
    status_memory_autotune_present: Boolean(statusAutotune),
    status_memory_strategy_autotune_present: Boolean(statusStrategyAutotune),
    status_memory_autotune_quality_fields_present:
      typeof statusAutotune?.quality_low_rate_ema === "number"
      && typeof statusAutotune?.quality_pressure_ema === "number"
      && typeof statusAutotune?.hard_budget_followup_delta_ema === "number"
      && typeof statusAutotune?.quality_first_followup_delta_ema === "number",
    status_memory_strategy_autotune_quality_fields_present:
      typeof statusStrategyAutotune?.quality_low_rate_ema === "number"
      && typeof statusStrategyAutotune?.quality_pressure_ema === "number"
      && typeof statusStrategyAutotune?.average_utilization_ratio_ema === "number"
      && typeof statusStrategyAutotune?.auto_limit_triggered_rate_ema === "number"
      && typeof statusStrategyAutotune?.snapshot_semantic_compress_rate_ema === "number"
      && typeof statusStrategyAutotune?.hard_budget_rate_ema === "number"
      && typeof statusStrategyAutotune?.quality_first_improved_rate_ema === "number"
      && typeof statusStrategyAutotune?.hard_budget_followup_delta_ema === "number"
      && typeof statusStrategyAutotune?.quality_first_followup_delta_ema === "number",
    status_memory_strategy_autotune_profile_fields_present:
      typeof statusStrategyAutotune?.schema_version === "number"
      && typeof statusStrategyAutotune?.profile === "string",
    status_memory_strategy_autotune_pending_fields_present:
      typeof statusStrategyAutotune?.pending_evaluation_direction === "string"
      && typeof statusStrategyAutotune?.pending_evaluation_warmup_turns === "number",
    status_memory_strategy_autotune_outcome_fields_present:
      typeof statusStrategyAutotune?.outcome_confidence_ema === "number"
      && typeof statusStrategyAutotune?.last_outcome_gain === "number"
      && typeof statusStrategyAutotune?.outcome_rollback_count === "number"
      && typeof statusStrategyAutotune?.outcome_negative_streak === "number",
    status_memory_autotune_last_reason:
      typeof statusAutotune?.last_reason === "string" ? statusAutotune.last_reason : "",
    status_memory_autotune_reason_has_quality_tighten:
      typeof statusAutotune?.last_reason === "string"
      && statusAutotune.last_reason.includes("quality_pressure_tighten"),
    status_memory_strategy_autotune_last_reason:
      typeof statusStrategyAutotune?.last_reason === "string"
        ? statusStrategyAutotune.last_reason
        : "",
    status_memory_strategy_autotune_reason_has_quality_tighten:
      typeof statusStrategyAutotune?.last_reason === "string"
      && statusStrategyAutotune.last_reason.includes("quality_pressure_tighten"),
    status_memory_decay_max_rows_before: seededState.maxRowsPerSession,
    status_memory_decay_max_rows_after: decayMaxRowsAfter,
    status_memory_decay_max_rows_tightened:
      typeof decayMaxRowsAfter === "number" && decayMaxRowsAfter < seededState.maxRowsPerSession,
    status_memory_decay_verified_conf_before: seededState.minConfidenceVerified,
    status_memory_decay_verified_conf_after: decayMinConfidenceVerifiedAfter,
    status_memory_decay_unverified_conf_before: seededState.minConfidenceUnverified,
    status_memory_decay_unverified_conf_after: decayMinConfidenceUnverifiedAfter,
    status_memory_decay_confidence_tightened:
      typeof decayMinConfidenceVerifiedAfter === "number"
      && typeof decayMinConfidenceUnverifiedAfter === "number"
      && decayMinConfidenceVerifiedAfter > seededState.minConfidenceVerified
      && decayMinConfidenceUnverifiedAfter > seededState.minConfidenceUnverified,
    status_memory_strategy_budget_ratio_before: seededStrategyState.injectBudgetRatio,
    status_memory_strategy_budget_ratio_after:
      typeof memoryOrchestrator?.inject_budget_ratio === "number"
        ? memoryOrchestrator.inject_budget_ratio
        : null,
    status_memory_strategy_budget_ratio_tightened:
      typeof memoryOrchestrator?.inject_budget_ratio === "number"
      && memoryOrchestrator.inject_budget_ratio < seededStrategyState.injectBudgetRatio,
    status_memory_strategy_section_before: seededStrategyState.maxSectionTokens,
    status_memory_strategy_section_after:
      typeof memoryOrchestrator?.max_section_tokens === "number"
        ? memoryOrchestrator.max_section_tokens
        : null,
    status_memory_strategy_section_tightened:
      typeof memoryOrchestrator?.max_section_tokens === "number"
      && memoryOrchestrator.max_section_tokens < seededStrategyState.maxSectionTokens,
    state_exists: Boolean(persistedAutotune),
    state_adaptive_updates_before: seededState.adaptiveUpdates,
    state_adaptive_updates_after:
      typeof persistedAutotune?.adaptiveUpdates === "number"
        ? persistedAutotune.adaptiveUpdates
        : null,
    state_adaptive_updates_increased:
      typeof persistedAutotune?.adaptiveUpdates === "number"
      && persistedAutotune.adaptiveUpdates > seededState.adaptiveUpdates,
    state_quality_ema_present:
      typeof persistedAutotune?.qualityLowRateEma === "number"
      && typeof persistedAutotune?.qualityPressureEma === "number"
      && typeof persistedAutotune?.hardBudgetFollowupDeltaEma === "number"
      && typeof persistedAutotune?.qualityFirstFollowupDeltaEma === "number",
    state_last_reason:
      typeof persistedAutotune?.lastReason === "string" ? persistedAutotune.lastReason : "",
    state_last_reason_has_quality_tighten:
      typeof persistedAutotune?.lastReason === "string"
      && persistedAutotune.lastReason.includes("quality_pressure_tighten"),
    strategy_state_exists: Boolean(persistedStrategyAutotune),
    strategy_state_adaptive_updates_before: seededStrategyState.adaptiveUpdates,
    strategy_state_adaptive_updates_after:
      typeof persistedStrategyAutotune?.adaptiveUpdates === "number"
        ? persistedStrategyAutotune.adaptiveUpdates
        : null,
    strategy_state_adaptive_updates_increased:
      typeof persistedStrategyAutotune?.adaptiveUpdates === "number"
      && persistedStrategyAutotune.adaptiveUpdates > seededStrategyState.adaptiveUpdates,
    strategy_state_quality_ema_present:
      typeof persistedStrategyAutotune?.qualityLowRateEma === "number"
      && typeof persistedStrategyAutotune?.qualityPressureEma === "number"
      && typeof persistedStrategyAutotune?.hardBudgetRateEma === "number"
      && typeof persistedStrategyAutotune?.qualityFirstImprovedRateEma === "number",
    strategy_state_profile_fields_present:
      typeof persistedStrategyAutotune?.schemaVersion === "number"
      && typeof persistedStrategyAutotune?.profile === "string",
    strategy_state_pending_outcome_fields_present:
      typeof persistedStrategyAutotune?.pendingEvaluationDirection === "string"
      && typeof persistedStrategyAutotune?.pendingEvaluationWarmupTurns === "number"
      && typeof persistedStrategyAutotune?.outcomeConfidenceEma === "number"
      && typeof persistedStrategyAutotune?.lastOutcomeGain === "number"
      && typeof persistedStrategyAutotune?.outcomeRollbackCount === "number",
    strategy_state_last_reason:
      typeof persistedStrategyAutotune?.lastReason === "string"
        ? persistedStrategyAutotune.lastReason
        : "",
    strategy_state_last_reason_has_quality_tighten:
      typeof persistedStrategyAutotune?.lastReason === "string"
      && persistedStrategyAutotune.lastReason.includes("quality_pressure_tighten"),
    state_path: statePath,
    strategy_state_path: strategyStatePath,
    prompt_seed_path: promptSeedPath,
  };
}
export function runStartContextMemoryDecayAutotuneQualityRelaxFlow(context) {
  const {
    repoRoot,
    createTempDir,
    writeExecutionProjectToml,
    writeConfig,
    buildSmokeConfig,
    runCommand,
    parseJsonObjectSafe,
    isObject,
    readJsonFileSafe,
  } = context;
  const workDir = createTempDir("grobot-start-memory-decay-autotune-quality-relax-work");
  writeExecutionProjectToml(workDir);
  const contextDir = `${workDir}/.grobot/context`;
  const memoryContextEngineDir = `${workDir}/.grobot/memory/context-engine`;
  mkdirSync(contextDir, { recursive: true });
  mkdirSync(memoryContextEngineDir, { recursive: true });
  const promptSeedPath = `${contextDir}/prompt-quality-window.jsonl`;
  const statePath = `${memoryContextEngineDir}/memory-decay-autotune-state.json`;
  const strategyStatePath = `${memoryContextEngineDir}/memory-strategy-autotune-state.json`;
  const seedNowMs = Date.now();
  const promptRows = [0, 1, 2].map((index) => ({
    ts: new Date(seedNowMs - (3 - index) * 1_000).toISOString(),
    sessionKey: "seed:memory-decay-quality-autotune-relax",
    stage: "normal",
    selectionReason: "seed",
    estimatedTokens: 4200 + (index * 80),
    targetTokenLimit: 5000,
    scores: {
      coverage: 0.74,
      recency: 0.72,
      size: 0.76,
      overall: 0.72 + (index * 0.06),
    },
    signals: {
      recentRows: 2,
      snapshotSections: 3,
      recentTrimRows: 0,
      snapshotTrimSections: 0,
      snapshotSemanticCompressSections: 0,
      headTrimRetries: 0,
      autoLimitTriggered: false,
      downshiftGuardTriggered: false,
      preSendStrategy: "quality_first",
      preSendOverflowRatio: 0.05 + (index * 0.01),
      preSendPressureScore: 0.18 + (index * 0.02),
    },
  }));
  writeFileSync(
    promptSeedPath,
    `${promptRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
  const seededState = {
    maxRowsPerSession: 220,
    minConfidenceVerified: 0.28,
    minConfidenceUnverified: 0.58,
    unverifiedMaxAgeHours: 72,
    adaptiveLearnAlpha: 0.2,
    adaptiveUpdates: 5,
    dropRatioEma: 0.01,
    capacityTrimRatioEma: 0.01,
    lowConfidenceRatioEma: 0.02,
    ageDropRatioEma: 0.03,
    qualityLowRateEma: 0.12,
    qualityPressureEma: 0.18,
    hardBudgetFollowupDeltaEma: 0.00,
    qualityFirstFollowupDeltaEma: 0.03,
    lastReason: "seed_quality_relax",
    updatedAt: "2026-04-19T10:30:00.000Z",
  };
  writeFileSync(statePath, `${JSON.stringify(seededState, null, 2)}\n`, "utf8");
  const seededStrategyState = {
    injectBudgetRatio: 0.16,
    maxSectionTokens: 820,
    maxGaMemoryRows: 2,
    maxTeamExperienceRows: 2,
    minTeamExperienceScore: 44,
    adaptiveLearnAlpha: 0.2,
    adaptiveUpdates: 4,
    qualityLowRateEma: 0.09,
    qualityPressureEma: 0.18,
    hardBudgetRateEma: 0.1,
    qualityFirstImprovedRateEma: 0.8,
    hardBudgetFollowupDeltaEma: -0.01,
    qualityFirstFollowupDeltaEma: 0.08,
    lastReason: "seed_quality_relax",
    updatedAt: "2026-04-19T10:35:00.000Z",
  };
  writeFileSync(strategyStatePath, `${JSON.stringify(seededStrategyState, null, 2)}\n`, "utf8");
  const config = writeConfig(buildSmokeConfig(workDir));
  const startResult = runCommand(repoRoot, [
    "./grobot",
    "start",
    "--project",
    "grobot",
    "--work-dir",
    workDir,
    "--config",
    config.configPath,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
    "--session-subject",
    "memory-decay-quality-autotune-relax-user",
    "--history-turns",
    "8",
    "--message",
    "memory decay autotune should relax by prompt quality signal",
  ]);
  const maintenanceEvent = startResult.stderr.match(
    /event=maintenance[^\n]*quality_low_rate=([0-9.<>-]+)[^\n]*quality_pressure=([0-9.<>-]+)[^\n]*decay_autotune_reason=([a-z_,]+)/,
  );
  const statusResult = runCommand(repoRoot, [
    "./grobot",
    "status",
    "--json",
    "--project",
    "grobot",
    "--work-dir",
    workDir,
    "--config",
    config.configPath,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
  ]);
  const parsedStatus = parseJsonObjectSafe(statusResult.stdout);
  const memoryOrchestrator = isObject(parsedStatus?.context_engine?.memory_orchestrator)
    ? parsedStatus.context_engine.memory_orchestrator
    : null;
  const statusAutotune = isObject(memoryOrchestrator?.autotune)
    ? memoryOrchestrator.autotune
    : null;
  const statusStrategyAutotune = isObject(memoryOrchestrator?.strategy_autotune)
    ? memoryOrchestrator.strategy_autotune
    : null;
  const statusReason = typeof statusAutotune?.last_reason === "string"
    ? statusAutotune.last_reason
    : "";
  const statusStrategyReason = typeof statusStrategyAutotune?.last_reason === "string"
    ? statusStrategyAutotune.last_reason
    : "";
  const persistedState = readJsonFileSafe(statePath);
  const persistedAutotune = isObject(persistedState) ? persistedState : null;
  const persistedStrategyState = readJsonFileSafe(strategyStatePath);
  const persistedStrategyAutotune = isObject(persistedStrategyState) ? persistedStrategyState : null;
  const decayMaxRowsAfter = typeof memoryOrchestrator?.decay_max_rows_per_session === "number"
    ? memoryOrchestrator.decay_max_rows_per_session
    : null;
  const decayMinConfidenceVerifiedAfter =
    typeof memoryOrchestrator?.decay_min_confidence_verified === "number"
      ? memoryOrchestrator.decay_min_confidence_verified
      : null;
  const decayMinConfidenceUnverifiedAfter =
    typeof memoryOrchestrator?.decay_min_confidence_unverified === "number"
      ? memoryOrchestrator.decay_min_confidence_unverified
      : null;
  return {
    start_exit_code: startResult.exit_code,
    status_exit_code: statusResult.exit_code,
    maintenance_quality_signal_logged:
      Boolean(maintenanceEvent) || statusReason.includes("quality_signal_relax"),
    maintenance_quality_low_rate: maintenanceEvent?.[1] ?? "",
    maintenance_quality_pressure: maintenanceEvent?.[2] ?? "",
    maintenance_autotune_reason: maintenanceEvent?.[3] ?? "",
    maintenance_autotune_quality_reason_seen:
      (
        typeof maintenanceEvent?.[3] === "string"
        && maintenanceEvent[3].includes("quality_signal_relax")
      ) || statusReason.includes("quality_signal_relax"),
    status_json_parse_ok: Boolean(parsedStatus),
    status_memory_orchestrator_present: Boolean(memoryOrchestrator),
    status_memory_autotune_present: Boolean(statusAutotune),
    status_memory_strategy_autotune_present: Boolean(statusStrategyAutotune),
    status_memory_autotune_quality_fields_present:
      typeof statusAutotune?.quality_low_rate_ema === "number"
      && typeof statusAutotune?.quality_pressure_ema === "number"
      && typeof statusAutotune?.hard_budget_followup_delta_ema === "number"
      && typeof statusAutotune?.quality_first_followup_delta_ema === "number",
    status_memory_strategy_autotune_quality_fields_present:
      typeof statusStrategyAutotune?.quality_low_rate_ema === "number"
      && typeof statusStrategyAutotune?.quality_pressure_ema === "number"
      && typeof statusStrategyAutotune?.average_utilization_ratio_ema === "number"
      && typeof statusStrategyAutotune?.auto_limit_triggered_rate_ema === "number"
      && typeof statusStrategyAutotune?.snapshot_semantic_compress_rate_ema === "number"
      && typeof statusStrategyAutotune?.hard_budget_rate_ema === "number"
      && typeof statusStrategyAutotune?.quality_first_improved_rate_ema === "number"
      && typeof statusStrategyAutotune?.hard_budget_followup_delta_ema === "number"
      && typeof statusStrategyAutotune?.quality_first_followup_delta_ema === "number",
    status_memory_strategy_autotune_profile_fields_present:
      typeof statusStrategyAutotune?.schema_version === "number"
      && typeof statusStrategyAutotune?.profile === "string",
    status_memory_strategy_autotune_pending_fields_present:
      typeof statusStrategyAutotune?.pending_evaluation_direction === "string"
      && typeof statusStrategyAutotune?.pending_evaluation_warmup_turns === "number",
    status_memory_strategy_autotune_outcome_fields_present:
      typeof statusStrategyAutotune?.outcome_confidence_ema === "number"
      && typeof statusStrategyAutotune?.last_outcome_gain === "number"
      && typeof statusStrategyAutotune?.outcome_rollback_count === "number"
      && typeof statusStrategyAutotune?.outcome_negative_streak === "number",
    status_memory_autotune_last_reason: statusReason,
    status_memory_autotune_reason_has_quality_relax:
      statusReason.includes("quality_signal_relax"),
    status_memory_strategy_autotune_last_reason: statusStrategyReason,
    status_memory_strategy_autotune_reason_has_quality_relax:
      statusStrategyReason.includes("quality_signal_relax"),
    status_memory_decay_max_rows_before: seededState.maxRowsPerSession,
    status_memory_decay_max_rows_after: decayMaxRowsAfter,
    status_memory_decay_max_rows_relaxed:
      typeof decayMaxRowsAfter === "number" && decayMaxRowsAfter > seededState.maxRowsPerSession,
    status_memory_decay_verified_conf_before: seededState.minConfidenceVerified,
    status_memory_decay_verified_conf_after: decayMinConfidenceVerifiedAfter,
    status_memory_decay_unverified_conf_before: seededState.minConfidenceUnverified,
    status_memory_decay_unverified_conf_after: decayMinConfidenceUnverifiedAfter,
    status_memory_decay_confidence_relaxed:
      typeof decayMinConfidenceVerifiedAfter === "number"
      && typeof decayMinConfidenceUnverifiedAfter === "number"
      && decayMinConfidenceVerifiedAfter < seededState.minConfidenceVerified
      && decayMinConfidenceUnverifiedAfter < seededState.minConfidenceUnverified,
    status_memory_strategy_budget_ratio_before: seededStrategyState.injectBudgetRatio,
    status_memory_strategy_budget_ratio_after:
      typeof memoryOrchestrator?.inject_budget_ratio === "number"
        ? memoryOrchestrator.inject_budget_ratio
        : null,
    status_memory_strategy_budget_ratio_relaxed:
      typeof memoryOrchestrator?.inject_budget_ratio === "number"
      && memoryOrchestrator.inject_budget_ratio > seededStrategyState.injectBudgetRatio,
    status_memory_strategy_section_before: seededStrategyState.maxSectionTokens,
    status_memory_strategy_section_after:
      typeof memoryOrchestrator?.max_section_tokens === "number"
        ? memoryOrchestrator.max_section_tokens
        : null,
    status_memory_strategy_section_relaxed:
      typeof memoryOrchestrator?.max_section_tokens === "number"
      && memoryOrchestrator.max_section_tokens > seededStrategyState.maxSectionTokens,
    state_exists: Boolean(persistedAutotune),
    state_adaptive_updates_before: seededState.adaptiveUpdates,
    state_adaptive_updates_after:
      typeof persistedAutotune?.adaptiveUpdates === "number"
        ? persistedAutotune.adaptiveUpdates
        : null,
    state_adaptive_updates_increased:
      typeof persistedAutotune?.adaptiveUpdates === "number"
      && persistedAutotune.adaptiveUpdates > seededState.adaptiveUpdates,
    state_quality_ema_present:
      typeof persistedAutotune?.qualityLowRateEma === "number"
      && typeof persistedAutotune?.qualityPressureEma === "number"
      && typeof persistedAutotune?.hardBudgetFollowupDeltaEma === "number"
      && typeof persistedAutotune?.qualityFirstFollowupDeltaEma === "number",
    state_last_reason:
      typeof persistedAutotune?.lastReason === "string" ? persistedAutotune.lastReason : "",
    state_last_reason_has_quality_relax:
      typeof persistedAutotune?.lastReason === "string"
      && persistedAutotune.lastReason.includes("quality_signal_relax"),
    strategy_state_exists: Boolean(persistedStrategyAutotune),
    strategy_state_adaptive_updates_before: seededStrategyState.adaptiveUpdates,
    strategy_state_adaptive_updates_after:
      typeof persistedStrategyAutotune?.adaptiveUpdates === "number"
        ? persistedStrategyAutotune.adaptiveUpdates
        : null,
    strategy_state_adaptive_updates_increased:
      typeof persistedStrategyAutotune?.adaptiveUpdates === "number"
      && persistedStrategyAutotune.adaptiveUpdates > seededStrategyState.adaptiveUpdates,
    strategy_state_quality_ema_present:
      typeof persistedStrategyAutotune?.qualityLowRateEma === "number"
      && typeof persistedStrategyAutotune?.qualityPressureEma === "number"
      && typeof persistedStrategyAutotune?.hardBudgetRateEma === "number"
      && typeof persistedStrategyAutotune?.qualityFirstImprovedRateEma === "number",
    strategy_state_profile_fields_present:
      typeof persistedStrategyAutotune?.schemaVersion === "number"
      && typeof persistedStrategyAutotune?.profile === "string",
    strategy_state_pending_outcome_fields_present:
      typeof persistedStrategyAutotune?.pendingEvaluationDirection === "string"
      && typeof persistedStrategyAutotune?.pendingEvaluationWarmupTurns === "number"
      && typeof persistedStrategyAutotune?.outcomeConfidenceEma === "number"
      && typeof persistedStrategyAutotune?.lastOutcomeGain === "number"
      && typeof persistedStrategyAutotune?.outcomeRollbackCount === "number",
    strategy_state_last_reason:
      typeof persistedStrategyAutotune?.lastReason === "string"
        ? persistedStrategyAutotune.lastReason
        : "",
    strategy_state_last_reason_has_quality_relax:
      typeof persistedStrategyAutotune?.lastReason === "string"
      && persistedStrategyAutotune.lastReason.includes("quality_signal_relax"),
    state_path: statePath,
    strategy_state_path: strategyStatePath,
    prompt_seed_path: promptSeedPath,
  };
}
