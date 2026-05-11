import assert from "node:assert/strict";
import { logStep, parseJsonOutput, runTsContract } from "../../harness.mjs";

export function runAdaptiveSequenceContracts() {
  const adaptiveSequenceWindows = [];
  for (let index = 0; index < 40; index += 1) {
    adaptiveSequenceWindows.push({
      degraded: false,
      reason: "healthy",
      low_quality_rate: 0.12,
      average_overall: 0.9,
      observed_overall: 0.9,
      observed_low_quality_rate: 0.12,
      snapshot_semantic_compress_rate: 0.18,
      auto_limit_triggered_rate: 0.12,
      average_utilization_ratio: 0.78,
      short_snapshot_semantic_compress_rate: 0.16,
      medium_snapshot_semantic_compress_rate: 0.20,
      short_auto_limit_triggered_rate: 0.10,
      medium_auto_limit_triggered_rate: 0.14,
      short_average_utilization_ratio: 0.76,
      medium_average_utilization_ratio: 0.80,
    });
  }
  for (let index = 0; index < 40; index += 1) {
    adaptiveSequenceWindows.push({
      degraded: true,
      reason: "compression_window_pressure",
      low_quality_rate: 0.35,
      average_overall: 0.72,
      observed_overall: 0.69,
      observed_low_quality_rate: 0.35,
      snapshot_semantic_compress_rate: 0.46,
      auto_limit_triggered_rate: 0.39,
      average_utilization_ratio: 0.93,
      short_snapshot_semantic_compress_rate: 0.53,
      medium_snapshot_semantic_compress_rate: 0.40,
      short_auto_limit_triggered_rate: 0.45,
      medium_auto_limit_triggered_rate: 0.34,
      short_average_utilization_ratio: 0.96,
      medium_average_utilization_ratio: 0.89,
    });
  }
  for (let index = 0; index < 40; index += 1) {
    adaptiveSequenceWindows.push({
      degraded: false,
      reason: "window_recovered",
      low_quality_rate: 0.14,
      average_overall: 0.88,
      observed_overall: 0.86,
      observed_low_quality_rate: 0.14,
      snapshot_semantic_compress_rate: 0.22,
      auto_limit_triggered_rate: 0.18,
      average_utilization_ratio: 0.81,
      short_snapshot_semantic_compress_rate: 0.19,
      medium_snapshot_semantic_compress_rate: 0.28,
      short_auto_limit_triggered_rate: 0.16,
      medium_auto_limit_triggered_rate: 0.25,
      short_average_utilization_ratio: 0.79,
      medium_average_utilization_ratio: 0.87,
    });
  }
  const contextEnginePromptQualityGuardAdaptiveSequenceResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-adaptive-sequence",
    [
      "--payload",
      JSON.stringify({
        selected_stage: "normal",
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
        windows: adaptiveSequenceWindows,
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptiveSequencePayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-sequence",
    contextEnginePromptQualityGuardAdaptiveSequenceResult.stdout,
  );
  assert.equal(contextEnginePromptQualityGuardAdaptiveSequencePayload.turns, 120);
  assert.equal(
    Number.isFinite(Number(contextEnginePromptQualityGuardAdaptiveSequencePayload.mode_transitions?.count)),
    true,
  );
  assert.equal(
    Number(contextEnginePromptQualityGuardAdaptiveSequencePayload.mode_transitions?.count) <= 85,
    true,
  );
  assert.equal(
    Number(contextEnginePromptQualityGuardAdaptiveSequencePayload.pressure_alpha?.min) >= 0.18,
    true,
  );
  assert.equal(
    Number(contextEnginePromptQualityGuardAdaptiveSequencePayload.pressure_alpha?.max) <= 0.68,
    true,
  );
  assert.equal(
    Number(contextEnginePromptQualityGuardAdaptiveSequencePayload.pressure_threshold_steps?.max_utilization_step) <= 0.045,
    true,
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveSequencePayload.final_state?.pressureTrendMomentum,
    "number",
  );
  assert.equal(
    Number.isFinite(
      Number(
        contextEnginePromptQualityGuardAdaptiveSequencePayload.outcome_reliability?.required_transitions?.avg,
      ),
    ),
    true,
  );
  assert.equal(
    Number.isFinite(
      Number(
        contextEnginePromptQualityGuardAdaptiveSequencePayload.outcome_reliability?.next_required_transitions?.avg,
      ),
    ),
    true,
  );
  assert.equal(
    Number(
      contextEnginePromptQualityGuardAdaptiveSequencePayload.outcome_reliability?.next_required_transitions?.transitions,
    ) >= 1,
    true,
  );
  assert.equal(
    Number(
      contextEnginePromptQualityGuardAdaptiveSequencePayload.outcome_reliability?.combined_evidence_score?.avg,
    ) >= 0,
    true,
  );
  assert.equal(
    Number(
      contextEnginePromptQualityGuardAdaptiveSequencePayload.outcome_reliability?.combined_evidence_score?.avg,
    ) <= 1,
    true,
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveSequencePayload.final_state?.outcomeRequiredTransitions,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveSequencePayload.final_state?.outcomeCombinedEvidenceScore,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.high_evidence_harden_bias,
    "boolean",
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.high_evidence_harden_rate,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.recommendation,
    "string",
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.auto_action_level,
    "string",
  );
  assert.equal(
    Array.isArray(
      contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.recent_auto_action_levels,
    ),
    true,
  );
  assert.equal(
    typeof contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.window_summary?.entries,
    "number",
  );
  assert.equal(
    ["green", "yellow", "red"].includes(
      String(contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.window_summary?.alert_level),
    ),
    true,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.high_evidence_harden_bias,
    false,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.recommendation,
    "none",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveSequencePayload.drift_guard?.auto_action_level,
    "none",
  );
  logStep("context-engine-contract prompt-quality-guard-adaptive-sequence");

  const adaptiveSequenceHighEvidenceHardenWindows = [];
  for (let index = 0; index < 24; index += 1) {
    adaptiveSequenceHighEvidenceHardenWindows.push({
      degraded: false,
      reason: "compression_window_pressure",
      low_quality_rate: 0.16,
      average_overall: 0.86,
      observed_overall: 0.84,
      observed_low_quality_rate: 0.16,
      snapshot_semantic_compress_rate: 0.52,
      auto_limit_triggered_rate: 0.43,
      average_utilization_ratio: 0.95,
      short_snapshot_semantic_compress_rate: 0.58,
      medium_snapshot_semantic_compress_rate: 0.44,
      short_auto_limit_triggered_rate: 0.48,
      medium_auto_limit_triggered_rate: 0.37,
      short_average_utilization_ratio: 0.97,
      medium_average_utilization_ratio: 0.90,
      hard_budget_strategy_rate: 0.68,
      quality_first_strategy_rate: 0.24,
      average_pre_send_overflow_ratio: 0.22,
      average_pre_send_pressure_score: 0.69,
      short_hard_budget_strategy_rate: 0.76,
      medium_hard_budget_strategy_rate: 0.52,
      short_average_pre_send_overflow_ratio: 0.27,
      medium_average_pre_send_overflow_ratio: 0.17,
      short_average_pre_send_pressure_score: 0.77,
      medium_average_pre_send_pressure_score: 0.59,
      hard_budget_followup_overall_delta: 0.06,
      quality_first_followup_overall_delta: 0.03,
      hard_budget_recovery_rate: 0.76,
      quality_first_improved_rate: 0.64,
      hard_budget_transition_count: 8,
      quality_first_transition_count: 8,
    });
  }
  const contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardResult = runTsContract(
    "context-engine-contract.ts",
    "batch",
    [
      "--payload",
      JSON.stringify({
        cases: [
          {
            label: "drift-guard",
            command: "prompt-quality-guard-adaptive-sequence",
            payload: {
              selected_stage: "normal",
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
              windows: adaptiveSequenceHighEvidenceHardenWindows,
            },
          },
        ],
      }),
    ],
  );
  const contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-adaptive-sequence drift-guard",
    contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardResult.stdout,
  ).results?.find((row) => row?.label === "drift-guard")?.payload;
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.high_evidence_harden_bias,
    true,
  );
  assert.equal(
    Number(
      contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.high_evidence_turns,
    ) >= 10,
    true,
  );
  assert.equal(
    Number(
      contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.high_evidence_harden_rate,
    ) >= 0.7,
    true,
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.reason,
    "high_evidence_harden_bias",
  );
  assert.equal(
    contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.recommendation,
    "prefer_relax",
  );
  assert.equal(
    ["soft", "medium", "hard"].includes(
      String(contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.auto_action_level),
    ),
    true,
  );
  assert.equal(
    Array.isArray(
      contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.recent_auto_action_levels,
    ),
    true,
  );
  assert.equal(
    Number(
      contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.window_summary?.entries,
    ) >= 1,
    true,
  );
  assert.equal(
    ["green", "yellow", "red"].includes(
      String(
        contextEnginePromptQualityGuardAdaptiveSequenceDriftGuardPayload.drift_guard?.window_summary
          ?.alert_level,
      ),
    ),
    true,
  );
  logStep("context-engine-contract prompt-quality-guard-adaptive-sequence drift-guard");
}
