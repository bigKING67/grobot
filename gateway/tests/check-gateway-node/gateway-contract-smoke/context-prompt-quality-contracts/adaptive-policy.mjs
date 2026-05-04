import assert from "node:assert/strict";
import { logStep, parseJsonOutput, runTsContract } from "../../harness.mjs";

export function runAdaptivePolicyContracts() {
  const contextEnginePromptQualityGuardAdaptivePolicyResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-policy",
    [
      "--payload",
      JSON.stringify({
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          adaptive_mode_allowlist: ["relax"],
        },
        adaptive_enabled: true,
        state: {
          floorStage: "forced",
          degradedStreak: 2,
          severeStreak: 2,
          healthyStreak: 0,
          holdTurnsRemaining: 2,
          lastReason: "low_quality_rate_above_threshold",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        degraded: true,
        reason: "low_quality_rate_above_threshold",
        low_quality_rate: 0.9,
        average_overall: 0.34,
        observed_overall: 0.3,
        observed_low_quality_rate: 0.9,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptivePolicyPayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-policy",
    contextEnginePromptQualityGuardAdaptivePolicyResult.stdout,
  );
  assert.equal(contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.enabled, true);
  assert.equal(contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.mode, "stable");
  assert.equal(contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.mode_blocked, true);
  assert.equal(contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.blocked_mode, "harden");
  assert.deepEqual(contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.allowlist, ["relax"]);
  assert.equal(
    contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.adjustment?.promote_streak_delta,
    0,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.adjustment?.release_streak_delta,
    0,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.effective_policy?.promote_streak,
    2,
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.outcome_drift_guard
      ?.high_evidence_harden_bias,
    "boolean",
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.outcome_drift_guard
      ?.recommendation,
    "string",
  );
  assert.equal(
    Array.isArray(
      contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.outcome_drift_guard
        ?.recent_auto_action_levels,
    ),
    true,
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.outcome_drift_guard
      ?.window_summary?.entries,
    "number",
  );
  assert.equal(
    ["green", "yellow", "red"].includes(
      String(
        contextEnginePromptQualityGuardAdaptivePolicyPayload.decision?.outcome_drift_guard
          ?.window_summary?.alert_level,
      ),
    ),
    true,
  );
  logStep("context-engine-contract prompt-quality-guard-adaptive-policy");

  const contextEnginePromptQualityGuardAdaptiveCompressionPressureResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-policy",
    [
      "--payload",
      JSON.stringify({
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          adaptive_mode_allowlist: ["harden", "relax"],
        },
        adaptive_enabled: true,
        state: {
          floorStage: "normal",
          degradedStreak: 0,
          severeStreak: 0,
          healthyStreak: 0,
          holdTurnsRemaining: 0,
          lastReason: "healthy",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        degraded: false,
        reason: "healthy",
        low_quality_rate: 0.2,
        average_overall: 0.8,
        observed_overall: 0.8,
        observed_low_quality_rate: 0.2,
        snapshot_semantic_compress_rate: 0.42,
        auto_limit_triggered_rate: 0.35,
        average_utilization_ratio: 0.92,
        short_snapshot_semantic_compress_rate: 0.58,
        medium_snapshot_semantic_compress_rate: 0.34,
        short_auto_limit_triggered_rate: 0.46,
        medium_auto_limit_triggered_rate: 0.29,
        short_average_utilization_ratio: 0.95,
        medium_average_utilization_ratio: 0.85,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptiveCompressionPressurePayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-policy compression-pressure",
    contextEnginePromptQualityGuardAdaptiveCompressionPressureResult.stdout,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveCompressionPressurePayload.decision?.mode,
    "harden",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveCompressionPressurePayload.decision?.reason,
    "compression_window_pressure",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveCompressionPressurePayload.decision?.mode_blocked,
    false,
  );
  const compressionPressureLearnAlpha = Number(
    contextEnginePromptQualityGuardAdaptiveCompressionPressurePayload.decision?.pressure_policy?.learn_alpha,
  );
  assert.equal(Number.isFinite(compressionPressureLearnAlpha), true);
  assert.equal(compressionPressureLearnAlpha >= 0.18, true);
  assert.equal(compressionPressureLearnAlpha <= 0.68, true);
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveCompressionPressurePayload.decision?.pressure_policy?.trend_momentum,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveCompressionPressurePayload.decision?.pressure_policy?.trend_flip_suppressed,
    "boolean",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveCompressionPressurePayload.decision?.effective_policy?.promote_streak,
    1,
  );
  logStep("context-engine-contract prompt-quality-guard-adaptive-policy compression-pressure");

  const contextEnginePromptQualityGuardAdaptiveStrategyPressureResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-policy",
    [
      "--payload",
      JSON.stringify({
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          adaptive_mode_allowlist: ["harden", "relax"],
        },
        adaptive_enabled: true,
        state: {
          floorStage: "normal",
          degradedStreak: 0,
          severeStreak: 0,
          healthyStreak: 0,
          holdTurnsRemaining: 0,
          lastReason: "healthy",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        degraded: false,
        reason: "healthy",
        low_quality_rate: 0.16,
        average_overall: 0.88,
        observed_overall: 0.88,
        observed_low_quality_rate: 0.16,
        snapshot_semantic_compress_rate: 0.21,
        auto_limit_triggered_rate: 0.18,
        average_utilization_ratio: 0.74,
        short_snapshot_semantic_compress_rate: 0.22,
        medium_snapshot_semantic_compress_rate: 0.20,
        short_auto_limit_triggered_rate: 0.19,
        medium_auto_limit_triggered_rate: 0.17,
        short_average_utilization_ratio: 0.76,
        medium_average_utilization_ratio: 0.73,
        hard_budget_strategy_rate: 0.66,
        quality_first_strategy_rate: 0.26,
        average_pre_send_overflow_ratio: 0.23,
        average_pre_send_pressure_score: 0.71,
        short_hard_budget_strategy_rate: 0.78,
        medium_hard_budget_strategy_rate: 0.52,
        short_average_pre_send_overflow_ratio: 0.29,
        medium_average_pre_send_overflow_ratio: 0.18,
        short_average_pre_send_pressure_score: 0.81,
        medium_average_pre_send_pressure_score: 0.63,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptiveStrategyPressurePayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-policy strategy-pressure",
    contextEnginePromptQualityGuardAdaptiveStrategyPressureResult.stdout,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyPressurePayload.decision?.mode,
    "harden",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyPressurePayload.decision?.reason,
    "strategy_window_pressure",
  );
  logStep("context-engine-contract prompt-quality-guard-adaptive-policy strategy-pressure");

  const contextEnginePromptQualityGuardAdaptiveStrategyEffectiveResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-policy",
    [
      "--payload",
      JSON.stringify({
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          adaptive_mode_allowlist: ["harden", "relax"],
        },
        adaptive_enabled: true,
        state: {
          floorStage: "normal",
          degradedStreak: 0,
          severeStreak: 0,
          healthyStreak: 0,
          holdTurnsRemaining: 0,
          lastReason: "healthy",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        degraded: false,
        reason: "healthy",
        low_quality_rate: 0.22,
        average_overall: 0.82,
        observed_overall: 0.82,
        observed_low_quality_rate: 0.22,
        snapshot_semantic_compress_rate: 0.18,
        auto_limit_triggered_rate: 0.15,
        average_utilization_ratio: 0.74,
        hard_budget_strategy_rate: 0.72,
        quality_first_strategy_rate: 0.24,
        average_pre_send_overflow_ratio: 0.24,
        average_pre_send_pressure_score: 0.74,
        short_hard_budget_strategy_rate: 0.81,
        medium_hard_budget_strategy_rate: 0.58,
        short_average_pre_send_overflow_ratio: 0.28,
        medium_average_pre_send_overflow_ratio: 0.19,
        short_average_pre_send_pressure_score: 0.83,
        medium_average_pre_send_pressure_score: 0.67,
        hard_budget_followup_overall_delta: 0.07,
        quality_first_followup_overall_delta: 0.02,
        hard_budget_recovery_rate: 0.78,
        quality_first_improved_rate: 0.64,
        hard_budget_transition_count: 6,
        quality_first_transition_count: 5,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptiveStrategyEffectivePayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-policy strategy-effective",
    contextEnginePromptQualityGuardAdaptiveStrategyEffectiveResult.stdout,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyEffectivePayload.decision?.mode,
    "stable",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyEffectivePayload.decision?.reason,
    "window_stable",
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveStrategyEffectivePayload.decision?.outcome_reliability
      ?.required_transitions,
    "number",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyEffectivePayload.decision?.outcome_reliability
      ?.required_transitions,
    6,
  );
  const strategyEffectiveNextRequiredTransitions = Number(
    contextEnginePromptQualityGuardAdaptiveStrategyEffectivePayload.decision?.outcome_reliability
      ?.next_required_transitions,
  );
  assert.equal(Number.isFinite(strategyEffectiveNextRequiredTransitions), true);
  assert.equal(
    strategyEffectiveNextRequiredTransitions <= 3,
    true,
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveStrategyEffectivePayload.decision?.outcome_reliability
      ?.combined_evidence_score,
    "number",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyEffectivePayload.decision?.outcome_reliability
      ?.hard_budget_reliable,
    true,
  );
  logStep("context-engine-contract prompt-quality-guard-adaptive-policy strategy-effective");

  const contextEnginePromptQualityGuardAdaptiveStrategyLowEvidenceResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-policy",
    [
      "--payload",
      JSON.stringify({
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          adaptive_mode_allowlist: ["harden", "relax"],
        },
        adaptive_enabled: true,
        state: {
          floorStage: "normal",
          degradedStreak: 0,
          severeStreak: 0,
          healthyStreak: 0,
          holdTurnsRemaining: 0,
          lastReason: "healthy",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        degraded: false,
        reason: "healthy",
        low_quality_rate: 0.22,
        average_overall: 0.82,
        observed_overall: 0.82,
        observed_low_quality_rate: 0.22,
        snapshot_semantic_compress_rate: 0.18,
        auto_limit_triggered_rate: 0.15,
        average_utilization_ratio: 0.74,
        hard_budget_strategy_rate: 0.72,
        quality_first_strategy_rate: 0.24,
        average_pre_send_overflow_ratio: 0.24,
        average_pre_send_pressure_score: 0.74,
        short_hard_budget_strategy_rate: 0.81,
        medium_hard_budget_strategy_rate: 0.58,
        short_average_pre_send_overflow_ratio: 0.28,
        medium_average_pre_send_overflow_ratio: 0.19,
        short_average_pre_send_pressure_score: 0.83,
        medium_average_pre_send_pressure_score: 0.67,
        hard_budget_followup_overall_delta: 0.09,
        quality_first_followup_overall_delta: 0.03,
        hard_budget_recovery_rate: 0.82,
        quality_first_improved_rate: 0.68,
        hard_budget_transition_count: 1,
        quality_first_transition_count: 1,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptiveStrategyLowEvidencePayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-policy strategy-low-evidence",
    contextEnginePromptQualityGuardAdaptiveStrategyLowEvidenceResult.stdout,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyLowEvidencePayload.decision?.mode,
    "harden",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyLowEvidencePayload.decision?.reason,
    "strategy_window_pressure",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyLowEvidencePayload.decision?.outcome_reliability
      ?.hard_budget_reliable,
    false,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyLowEvidencePayload.decision?.outcome_reliability
      ?.required_transitions,
    6,
  );
  const strategyLowEvidenceNextRequiredTransitions = Number(
    contextEnginePromptQualityGuardAdaptiveStrategyLowEvidencePayload.decision?.outcome_reliability
      ?.next_required_transitions,
  );
  assert.equal(Number.isFinite(strategyLowEvidenceNextRequiredTransitions), true);
  assert.equal(
    strategyLowEvidenceNextRequiredTransitions >= strategyEffectiveNextRequiredTransitions,
    true,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveStrategyLowEvidencePayload.decision?.outcome_reliability
      ?.quality_first_reliable,
    false,
  );
  logStep("context-engine-contract prompt-quality-guard-adaptive-policy strategy-low-evidence");

  const contextEnginePromptQualityGuardAdaptiveTrendRisingResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-policy",
    [
      "--payload",
      JSON.stringify({
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          adaptive_mode_allowlist: ["harden", "relax"],
        },
        adaptive_enabled: true,
        state: {
          floorStage: "normal",
          degradedStreak: 0,
          severeStreak: 0,
          healthyStreak: 0,
          holdTurnsRemaining: 0,
          lastReason: "healthy",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        degraded: false,
        reason: "healthy",
        low_quality_rate: 0.12,
        average_overall: 0.9,
        observed_overall: 0.9,
        observed_low_quality_rate: 0.12,
        snapshot_semantic_compress_rate: 0.26,
        auto_limit_triggered_rate: 0.31,
        average_utilization_ratio: 0.87,
        short_snapshot_semantic_compress_rate: 0.31,
        medium_snapshot_semantic_compress_rate: 0.21,
        short_auto_limit_triggered_rate: 0.35,
        medium_auto_limit_triggered_rate: 0.24,
        short_average_utilization_ratio: 0.90,
        medium_average_utilization_ratio: 0.82,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptiveTrendRisingPayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-policy trend-rising",
    contextEnginePromptQualityGuardAdaptiveTrendRisingResult.stdout,
  );
  const trendRisingLearnAlpha = Number(
    contextEnginePromptQualityGuardAdaptiveTrendRisingPayload.decision?.pressure_policy?.learn_alpha,
  );
  assert.equal(Number.isFinite(trendRisingLearnAlpha), true);
  assert.equal(trendRisingLearnAlpha >= 0.36, true);
  logStep("context-engine-contract prompt-quality-guard-adaptive-policy trend-rising");

  const contextEnginePromptQualityGuardAdaptiveTrendFallingResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-policy",
    [
      "--payload",
      JSON.stringify({
        policy: {
          enabled: true,
          promote_streak: 2,
          severe_promote_streak: 2,
          release_streak: 3,
          hold_turns: 2,
          max_floor_stage: "minimal",
          adaptive_mode_allowlist: ["harden", "relax"],
        },
        adaptive_enabled: true,
        state: {
          floorStage: "normal",
          degradedStreak: 0,
          severeStreak: 0,
          healthyStreak: 0,
          holdTurnsRemaining: 0,
          lastReason: "healthy",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        degraded: false,
        reason: "healthy",
        low_quality_rate: 0.12,
        average_overall: 0.9,
        observed_overall: 0.9,
        observed_low_quality_rate: 0.12,
        snapshot_semantic_compress_rate: 0.26,
        auto_limit_triggered_rate: 0.31,
        average_utilization_ratio: 0.87,
        short_snapshot_semantic_compress_rate: 0.18,
        medium_snapshot_semantic_compress_rate: 0.30,
        short_auto_limit_triggered_rate: 0.17,
        medium_auto_limit_triggered_rate: 0.31,
        short_average_utilization_ratio: 0.80,
        medium_average_utilization_ratio: 0.90,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptiveTrendFallingPayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-policy trend-falling",
    contextEnginePromptQualityGuardAdaptiveTrendFallingResult.stdout,
  );
  const trendFallingLearnAlpha = Number(
    contextEnginePromptQualityGuardAdaptiveTrendFallingPayload.decision?.pressure_policy?.learn_alpha,
  );
  assert.equal(Number.isFinite(trendFallingLearnAlpha), true);
  assert.equal(trendFallingLearnAlpha <= 0.29, true);
  logStep("context-engine-contract prompt-quality-guard-adaptive-policy trend-falling");
}
