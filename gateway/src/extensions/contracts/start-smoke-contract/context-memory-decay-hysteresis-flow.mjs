import { mkdirSync, writeFileSync } from "node:fs";



export function runStartContextMemoryDecayAutotuneHysteresisFlow(context) {
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
  const workDir = createTempDir("grobot-start-memory-decay-autotune-hysteresis-work");
  writeExecutionProjectToml(workDir);
  const contextDir = `${workDir}/.grobot/context`;
  const memoryContextEngineDir = `${workDir}/.grobot/memory/context-engine`;
  mkdirSync(contextDir, { recursive: true });
  mkdirSync(memoryContextEngineDir, { recursive: true });
  const promptSeedPath = `${contextDir}/prompt-quality-window.jsonl`;
  const statePath = `${memoryContextEngineDir}/memory-decay-autotune-state.json`;
  const seededState = {
    maxRowsPerSession: 240,
    minConfidenceVerified: 0.20,
    minConfidenceUnverified: 0.45,
    unverifiedMaxAgeHours: 72,
    adaptiveLearnAlpha: 0.2,
    adaptiveUpdates: 5,
    dropRatioEma: 0.01,
    capacityTrimRatioEma: 0.01,
    lowConfidenceRatioEma: 0.02,
    ageDropRatioEma: 0.03,
    qualityLowRateEma: 0.72,
    qualityPressureEma: 0.74,
    hardBudgetFollowupDeltaEma: -0.12,
    qualityFirstFollowupDeltaEma: -0.02,
    lastReason: "seed_hysteresis",
    updatedAt: "2026-04-19T11:00:00.000Z",
  };
  writeFileSync(statePath, `${JSON.stringify(seededState, null, 2)}\n`, "utf8");
  const config = writeConfig(buildSmokeConfig(workDir));

  const buildPromptRows = (profile) => {
    const seedNowMs = Date.now();
    if (profile === "pressure") {
      return [0, 1, 2].map((index) => ({
        ts: new Date(seedNowMs - (3 - index) * 1_000).toISOString(),
        sessionKey: "seed:memory-decay-hysteresis-pressure",
        stage: "minimal",
        selectionReason: "seed",
        estimatedTokens: 8200 + (index * 120),
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
    }
    return [0, 1, 2, 3].map((index) => ({
      ts: new Date(seedNowMs - (4 - index) * 1_000).toISOString(),
      sessionKey: "seed:memory-decay-hysteresis-relax",
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
  };

  const runRound = (label, profile, message) => {
    const rows = buildPromptRows(profile);
    writeFileSync(promptSeedPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
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
      `memory-decay-hysteresis-${label}`,
      "--history-turns",
      "8",
      "--message",
      message,
    ]);
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
    const persisted = readJsonFileSafe(statePath);
    const persistedAutotune = isObject(persisted) ? persisted : null;
    const reason = typeof statusAutotune?.last_reason === "string" ? statusAutotune.last_reason : "";
    return {
      label,
      profile,
      start_exit_code: startResult.exit_code,
      status_exit_code: statusResult.exit_code,
      reason,
      has_tighten: reason.includes("quality_pressure_tighten"),
      has_relax: reason.includes("quality_signal_relax"),
      decay_max_rows:
        typeof memoryOrchestrator?.decay_max_rows_per_session === "number"
          ? memoryOrchestrator.decay_max_rows_per_session
          : null,
      decay_min_conf_verified:
        typeof memoryOrchestrator?.decay_min_confidence_verified === "number"
          ? memoryOrchestrator.decay_min_confidence_verified
          : null,
      decay_min_conf_unverified:
        typeof memoryOrchestrator?.decay_min_confidence_unverified === "number"
          ? memoryOrchestrator.decay_min_confidence_unverified
          : null,
      adaptive_updates:
        typeof persistedAutotune?.adaptiveUpdates === "number"
          ? persistedAutotune.adaptiveUpdates
          : null,
      quality_low_ema:
        typeof persistedAutotune?.qualityLowRateEma === "number"
          ? persistedAutotune.qualityLowRateEma
          : null,
      quality_pressure_ema:
        typeof persistedAutotune?.qualityPressureEma === "number"
          ? persistedAutotune.qualityPressureEma
          : null,
    };
  };

  const firstRound = runRound(
    "pressure-1",
    "pressure",
    "memory decay hysteresis pass 1 should tighten under pressure",
  );

  const lowRounds = [];
  let relaxRoundIndex = null;
  for (let index = 1; index <= 10; index += 1) {
    const lowRound = runRound(
      `relax-${String(index)}`,
      "relax",
      `memory decay hysteresis relax pass ${String(index)}`,
    );
    lowRounds.push(lowRound);
    if (lowRound.has_relax) {
      relaxRoundIndex = index;
      break;
    }
  }

  const roundsBeforeRelax = relaxRoundIndex == null
    ? lowRounds
    : lowRounds.slice(0, Math.max(0, relaxRoundIndex - 1));
  const noEarlyRelax = roundsBeforeRelax.every((round) => !round.has_relax);
  const relaxRound = relaxRoundIndex == null ? null : lowRounds[relaxRoundIndex - 1] ?? null;
  const relaxPrevRound = relaxRoundIndex == null
    ? null
    : (relaxRoundIndex > 1 ? lowRounds[relaxRoundIndex - 2] ?? null : firstRound);
  const relaxRowsExpanded = Boolean(
    relaxRound
    && relaxPrevRound
    && typeof relaxRound.decay_max_rows === "number"
    && typeof relaxPrevRound.decay_max_rows === "number"
    && relaxRound.decay_max_rows > relaxPrevRound.decay_max_rows,
  );
  const relaxConfidenceRelaxed = Boolean(
    relaxRound
    && relaxPrevRound
    && typeof relaxRound.decay_min_conf_verified === "number"
    && typeof relaxRound.decay_min_conf_unverified === "number"
    && typeof relaxPrevRound.decay_min_conf_verified === "number"
    && typeof relaxPrevRound.decay_min_conf_unverified === "number"
    && relaxRound.decay_min_conf_verified < relaxPrevRound.decay_min_conf_verified
    && relaxRound.decay_min_conf_unverified < relaxPrevRound.decay_min_conf_unverified,
  );
  const allRounds = [firstRound, ...lowRounds];
  let updatesMonotonic = true;
  for (let index = 1; index < allRounds.length; index += 1) {
    const prev = allRounds[index - 1];
    const next = allRounds[index];
    if (
      !prev
      || !next
      || typeof prev.adaptive_updates !== "number"
      || typeof next.adaptive_updates !== "number"
      || next.adaptive_updates < prev.adaptive_updates
    ) {
      updatesMonotonic = false;
      break;
    }
  }
  const finalLowRound = lowRounds.length > 0 ? lowRounds[lowRounds.length - 1] ?? null : null;
  const finalQualityLowEma =
    finalLowRound && typeof finalLowRound.quality_low_ema === "number"
      ? finalLowRound.quality_low_ema
      : null;
  const finalQualityPressureEma =
    finalLowRound && typeof finalLowRound.quality_pressure_ema === "number"
      ? finalLowRound.quality_pressure_ema
      : null;
  const finalQualityRelaxWindowReached = Boolean(
    typeof finalQualityLowEma === "number"
    && typeof finalQualityPressureEma === "number"
    && finalQualityLowEma <= 0.2
    && finalQualityPressureEma <= 0.38,
  );

  return {
    first_round_start_exit_code: firstRound.start_exit_code,
    first_round_status_exit_code: firstRound.status_exit_code,
    first_round_reason: firstRound.reason,
    first_round_has_quality_tighten: firstRound.has_tighten,
    low_rounds_executed: lowRounds.length,
    relax_seen: relaxRoundIndex != null,
    relax_round_index: relaxRoundIndex,
    no_early_relax: noEarlyRelax,
    relax_rows_expanded: relaxRowsExpanded,
    relax_confidence_relaxed: relaxConfidenceRelaxed,
    updates_monotonic: updatesMonotonic,
    final_quality_low_ema: finalQualityLowEma,
    final_quality_pressure_ema: finalQualityPressureEma,
    final_quality_relax_window_reached: finalQualityRelaxWindowReached,
    state_path: statePath,
    prompt_seed_path: promptSeedPath,
  };
}
