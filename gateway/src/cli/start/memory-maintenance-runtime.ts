import {
  applyMemoryDecayAutotuneToPolicy,
  applyMemoryStrategyAutotuneToPolicy,
  deriveMemoryDecayAutotuneState,
  deriveMemoryStrategyAutotuneState,
  writeMemoryDecayAutotuneState,
  writeMemoryStrategyAutotuneState,
  type MemoryDecayAutotuneState,
  type MemoryOrchestrator,
  type MemoryOrchestratorPolicySnapshot,
  type MemoryStrategyAutotuneState,
} from "../../tools/memory";
import { readPromptQualityWindowSummary } from "../../tools/context";
import type { GaMechanismRuntime } from "../services/ga-mechanism-runtime";
import type { RunStartPersistence } from "./persistence";
import type { RunStartRuntimeState } from "./runtime-state";
import { setSessionGaState } from "./session-registry";
import { resolveMemoryStrategyProfile } from "./memory-strategy-profile";
import { buildMemoryMaintenanceFailedSurface } from "./startup-surfaces";

export type MemoryMaintenanceReason = "bootstrap" | "post_turn" | "timer";

export interface RunMemoryMaintenanceInput {
  reason: MemoryMaintenanceReason;
  workDir: string;
  basePolicy: MemoryOrchestratorPolicySnapshot;
  memoryOrchestrator: MemoryOrchestrator;
  runtimeState: RunStartRuntimeState;
  persistence: RunStartPersistence;
  gaMechanismRuntime: GaMechanismRuntime;
  memoryDecayAutotuneState: MemoryDecayAutotuneState;
  memoryStrategyAutotuneState: MemoryStrategyAutotuneState;
  promptQualityWindowSize: number;
  promptQualityLowQualityThreshold?: number;
  writeStartupDiagnostics(message: string): void;
  writeStderr(message: string): void;
}

export interface RunMemoryMaintenanceResult {
  memoryDecayAutotuneState: MemoryDecayAutotuneState;
  memoryStrategyAutotuneState: MemoryStrategyAutotuneState;
}

function formatQualityValue(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(3)
    : "<none>";
}

export async function runMemoryMaintenanceRuntime(
  input: RunMemoryMaintenanceInput,
): Promise<RunMemoryMaintenanceResult> {
  let memoryDecayAutotuneState = input.memoryDecayAutotuneState;
  let memoryStrategyAutotuneState = input.memoryStrategyAutotuneState;
  try {
    const sessionRegistry = input.runtimeState.getSessionRegistry();
    const activeSessionId = input.runtimeState.getActiveSessionId();
    const activeSessionKey = input.runtimeState.getSessionKey();
    const activeSessionRecord = sessionRegistry.sessions.find(
      (item) =>
        item.id === activeSessionId || item.session_key === activeSessionKey,
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
      if (
        !record.ga_state ||
        !Array.isArray(record.ga_state.memory) ||
        record.ga_state.memory.length === 0
      ) {
        continue;
      }
      sessionsScanned += 1;
      totalRowsBefore += record.ga_state.memory.length;
      const reconcileResult = input.memoryOrchestrator.reconcile({
        rows: record.ga_state.memory,
      });
      const decayResult = input.memoryOrchestrator.decay({
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
      if (
        record.id === activeSessionId ||
        record.session_key === activeSessionKey
      ) {
        input.runtimeState.setGaState(nextGaState);
        input.gaMechanismRuntime.hydrateSession(activeSessionKey, nextGaState);
      }
    }
    if (sessionsUpdated > 0) {
      setSessionGaState(
        sessionRegistry,
        activeSessionId,
        input.runtimeState.getGaState(),
      );
      await input.persistence.persistSessionRegistryState();
    }
    const decayAction = decayDroppedRows > 0 ? "pruned" : "noop";
    const decayReason =
      decayDroppedRows > 0
        ? `age_exceeded:${String(decayDroppedByAge)},low_confidence:${String(decayDroppedByConfidence)},capacity_trim:${String(decayDroppedByCapacity)}`
        : "within_policy";
    const promptQualityWindowSummary = readPromptQualityWindowSummary({
      workDir: input.workDir,
      size: input.promptQualityWindowSize,
      lowQualityThreshold: input.promptQualityLowQualityThreshold,
    });
    const qualitySnapshot = {
      lowQualityRate: promptQualityWindowSummary.lowQualityRate,
      averagePreSendPressureScore:
        promptQualityWindowSummary.signalAverages?.preSendPressureScore ?? null,
      hardBudgetFollowupOverallDelta:
        promptQualityWindowSummary.strategyOutcomes
          .hardBudgetFollowupOverallDelta,
      qualityFirstFollowupOverallDelta:
        promptQualityWindowSummary.strategyOutcomes
          .qualityFirstFollowupOverallDelta,
      hardBudgetRate:
        promptQualityWindowSummary.strategyActivity.hardBudgetRate,
      qualityFirstImprovedRate:
        promptQualityWindowSummary.strategyOutcomes.qualityFirstImprovedRate,
      averageUtilizationRatio:
        promptQualityWindowSummary.tokenBudget.averageUtilizationRatio,
      autoLimitTriggeredRate:
        promptQualityWindowSummary.compressionActivity.autoLimitTriggeredRate,
      snapshotSemanticCompressRate:
        promptQualityWindowSummary.compressionActivity
          .snapshotSemanticCompressRate,
      shortAverageUtilizationRatio:
        promptQualityWindowSummary.pressureTrends.short.averageUtilizationRatio,
      mediumAverageUtilizationRatio:
        promptQualityWindowSummary.pressureTrends.medium
          .averageUtilizationRatio,
      deltaAverageUtilizationRatio:
        promptQualityWindowSummary.pressureTrends.delta.averageUtilizationRatio,
      shortAutoLimitTriggeredRate:
        promptQualityWindowSummary.pressureTrends.short.autoLimitTriggeredRate,
      mediumAutoLimitTriggeredRate:
        promptQualityWindowSummary.pressureTrends.medium.autoLimitTriggeredRate,
      deltaAutoLimitTriggeredRate:
        promptQualityWindowSummary.pressureTrends.delta.autoLimitTriggeredRate,
      shortSnapshotSemanticCompressRate:
        promptQualityWindowSummary.pressureTrends.short
          .snapshotSemanticCompressRate,
      mediumSnapshotSemanticCompressRate:
        promptQualityWindowSummary.pressureTrends.medium
          .snapshotSemanticCompressRate,
      deltaSnapshotSemanticCompressRate:
        promptQualityWindowSummary.pressureTrends.delta
          .snapshotSemanticCompressRate,
    };
    const decayAutotuneResult = deriveMemoryDecayAutotuneState({
      basePolicy: input.basePolicy,
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
    let policyAfterAutotune = input.memoryOrchestrator.policySnapshot();
    if (decayAutotuneResult.changed) {
      decayAutotuneUpdated = true;
      memoryDecayAutotuneState = decayAutotuneResult.state;
      const tunedPolicyFromState = applyMemoryDecayAutotuneToPolicy({
        basePolicy: input.basePolicy,
        state: memoryDecayAutotuneState,
      });
      const tunedPolicy = input.memoryOrchestrator.tuneDecayPolicy({
        decayMaxRowsPerSession: tunedPolicyFromState.decayMaxRowsPerSession,
        decayMinConfidenceVerified:
          tunedPolicyFromState.decayMinConfidenceVerified,
        decayMinConfidenceUnverified:
          tunedPolicyFromState.decayMinConfidenceUnverified,
        decayUnverifiedMaxAgeHours:
          tunedPolicyFromState.decayUnverifiedMaxAgeHours,
      });
      writeMemoryDecayAutotuneState({
        workDir: input.workDir,
        basePolicy: input.basePolicy,
        state: memoryDecayAutotuneState,
      });
      policyAfterAutotune = tunedPolicy;
      input.writeStartupDiagnostics(
        `[memory-orchestrator] event=decay_autotune_updated reason=${decayAutotuneResult.reason} updates=${String(memoryDecayAutotuneState.adaptiveUpdates)} decay_max_rows=${String(tunedPolicy.decayMaxRowsPerSession)} decay_unverified_age_hours=${String(tunedPolicy.decayUnverifiedMaxAgeHours)} decay_confidence=${tunedPolicy.decayMinConfidenceVerified.toFixed(2)}/${tunedPolicy.decayMinConfidenceUnverified.toFixed(2)}\n`,
      );
    }
    const strategyAutotuneResult = deriveMemoryStrategyAutotuneState({
      basePolicy: input.basePolicy,
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
      const tunedPolicy = input.memoryOrchestrator.tuneInjectionPolicy({
        injectBudgetRatio: tunedPolicyFromState.injectBudgetRatio,
        maxSectionTokens: tunedPolicyFromState.maxSectionTokens,
        maxGaMemoryRows: tunedPolicyFromState.maxGaMemoryRows,
        maxTeamExperienceRows: tunedPolicyFromState.maxTeamExperienceRows,
        minTeamExperienceScore: tunedPolicyFromState.minTeamExperienceScore,
      });
      policyAfterAutotune = tunedPolicy;
      writeMemoryStrategyAutotuneState({
        workDir: input.workDir,
        basePolicy: input.basePolicy,
        state: memoryStrategyAutotuneState,
      });
      input.writeStartupDiagnostics(
        `[memory-orchestrator] event=strategy_autotune_updated reason=${strategyAutotuneResult.reason} updates=${String(memoryStrategyAutotuneState.adaptiveUpdates)} profile=${memoryStrategyAutotuneState.profile} budget_ratio=${tunedPolicy.injectBudgetRatio.toFixed(3)} section_max=${String(tunedPolicy.maxSectionTokens)} ga_rows=${String(tunedPolicy.maxGaMemoryRows)} team_rows=${String(tunedPolicy.maxTeamExperienceRows)} team_score_min=${String(tunedPolicy.minTeamExperienceScore)} pressure_ema=${memoryStrategyAutotuneState.averageUtilizationRatioEma.toFixed(3)}/${memoryStrategyAutotuneState.autoLimitTriggeredRateEma.toFixed(3)}/${memoryStrategyAutotuneState.snapshotSemanticCompressRateEma.toFixed(3)} pressure_delta=${formatQualityValue(qualitySnapshot.deltaAverageUtilizationRatio)}/${formatQualityValue(qualitySnapshot.deltaAutoLimitTriggeredRate)}/${formatQualityValue(qualitySnapshot.deltaSnapshotSemanticCompressRate)} outcome=${memoryStrategyAutotuneState.lastOutcomeGain.toFixed(3)}/${memoryStrategyAutotuneState.outcomeConfidenceEma.toFixed(3)}/${String(memoryStrategyAutotuneState.outcomeRollbackCount)}/${String(memoryStrategyAutotuneState.outcomeNegativeStreak)}\n`,
      );
    }
    input.writeStartupDiagnostics(
      `[memory-orchestrator] event=maintenance reason=${input.reason} sessions_scanned=${String(sessionsScanned)} sessions_updated=${String(sessionsUpdated)} deduplicated_rows=${String(deduplicatedRows)} total_rows=${String(totalRowsBefore)}->${String(totalRowsAfter)} decay_sessions_pruned=${String(decaySessionsPruned)} decay_dropped_rows=${String(decayDroppedRows)} decay_action=${decayAction} decay_reason=${decayReason} quality_low_rate=${formatQualityValue(qualitySnapshot.lowQualityRate)} quality_pressure=${formatQualityValue(qualitySnapshot.averagePreSendPressureScore)} quality_hard_budget_rate=${formatQualityValue(qualitySnapshot.hardBudgetRate)} quality_first_improved_rate=${formatQualityValue(qualitySnapshot.qualityFirstImprovedRate)} quality_followup_delta=${formatQualityValue(qualitySnapshot.hardBudgetFollowupOverallDelta)}/${formatQualityValue(qualitySnapshot.qualityFirstFollowupOverallDelta)} pressure_utilization=${formatQualityValue(qualitySnapshot.averageUtilizationRatio)} pressure_auto_limit_rate=${formatQualityValue(qualitySnapshot.autoLimitTriggeredRate)} pressure_semantic_rate=${formatQualityValue(qualitySnapshot.snapshotSemanticCompressRate)} pressure_delta=${formatQualityValue(qualitySnapshot.deltaAverageUtilizationRatio)}/${formatQualityValue(qualitySnapshot.deltaAutoLimitTriggeredRate)}/${formatQualityValue(qualitySnapshot.deltaSnapshotSemanticCompressRate)} decay_autotune_updated=${decayAutotuneUpdated ? "true" : "false"} decay_autotune_reason=${decayAutotuneResult.reason} strategy_autotune_updated=${strategyAutotuneUpdated ? "true" : "false"} strategy_autotune_reason=${strategyAutotuneResult.reason} strategy_profile=${memoryStrategyAutotuneState.profile} strategy_budget_ratio=${policyAfterAutotune.injectBudgetRatio.toFixed(3)} strategy_section_max=${String(policyAfterAutotune.maxSectionTokens)} strategy_ga_rows=${String(policyAfterAutotune.maxGaMemoryRows)} strategy_team_rows=${String(policyAfterAutotune.maxTeamExperienceRows)} strategy_team_score_min=${String(policyAfterAutotune.minTeamExperienceScore)} strategy_action=${memoryStrategyAutotuneState.lastActionDirection} strategy_cooldown=${String(memoryStrategyAutotuneState.cooldownTurnsRemaining)} strategy_streak=${String(memoryStrategyAutotuneState.tightenSignalStreak)}/${String(memoryStrategyAutotuneState.relaxSignalStreak)} strategy_scale=${memoryStrategyAutotuneState.adaptiveActionScale.toFixed(3)} strategy_outcome=${memoryStrategyAutotuneState.lastOutcomeGain.toFixed(3)}/${memoryStrategyAutotuneState.outcomeConfidenceEma.toFixed(3)}/${String(memoryStrategyAutotuneState.outcomeRollbackCount)}/${String(memoryStrategyAutotuneState.outcomeNegativeStreak)}\n`,
    );
  } catch (error) {
    input.writeStartupDiagnostics(
      `[memory-orchestrator] event=maintenance_failed reason=${input.reason} detail=${String(error)}\n`,
    );
    input.writeStderr(
      buildMemoryMaintenanceFailedSurface({
        reason: input.reason,
        error: String(error),
      }),
    );
  }

  return {
    memoryDecayAutotuneState,
    memoryStrategyAutotuneState,
  };
}
