import assert from "node:assert/strict";
import { logStep, parseJsonOutput, runTsContract } from "../../harness.mjs";

export function runPromptQualityGuardContracts() {
  const contextEnginePromptQualityGuardResult = runTsContract("context-engine-contract.ts", "prompt-quality-guard", [
    "--payload",
    JSON.stringify({
      selected_stage: "normal",
      policy: {
        enabled: true,
        promote_streak: 1,
        severe_promote_streak: 2,
        release_streak: 2,
        hold_turns: 1,
        max_floor_stage: "minimal",
        severe_overall_threshold: 0.45,
        severe_low_quality_rate_threshold: 0.7,
      },
      observations: [
        {
          degraded: true,
          reason: "overall_below_threshold",
          observed_overall: 0.7,
          observed_low_quality_rate: 0.2,
        },
        {
          degraded: true,
          reason: "overall_below_threshold",
          observed_overall: 0.32,
          observed_low_quality_rate: 0.6,
        },
        {
          degraded: true,
          reason: "low_quality_rate_above_threshold",
          observed_overall: 0.3,
          observed_low_quality_rate: 0.85,
        },
        {
          degraded: false,
          reason: "healthy",
          observed_overall: 0.82,
          observed_low_quality_rate: 0.1,
        },
        {
          degraded: false,
          reason: "healthy",
          observed_overall: 0.88,
          observed_low_quality_rate: 0.08,
        },
      ],
    }),
  ]);
  const contextEnginePromptQualityGuardPayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard",
    contextEnginePromptQualityGuardResult.stdout,
  );
  assert.equal(Array.isArray(contextEnginePromptQualityGuardPayload.timeline), true);
  assert.equal(contextEnginePromptQualityGuardPayload.timeline.length >= 5, true);
  assert.equal(contextEnginePromptQualityGuardPayload.timeline[0]?.floor_stage, "proactive");
  assert.equal(contextEnginePromptQualityGuardPayload.timeline[1]?.floor_stage, "forced");
  assert.equal(contextEnginePromptQualityGuardPayload.timeline[2]?.floor_stage, "minimal");
  assert.equal(contextEnginePromptQualityGuardPayload.timeline[2]?.severe_escalated, true);
  assert.equal(contextEnginePromptQualityGuardPayload.timeline[4]?.released, true);
  assert.equal(contextEnginePromptQualityGuardPayload.timeline[4]?.floor_stage, "forced");
  logStep("context-engine-contract prompt-quality-guard");

  const contextEnginePromptQualityGuardRuntimeResult = runTsContract(
    "context-engine-contract.ts",
    "prompt-quality-guard-runtime",
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
          severe_overall_threshold: 0.45,
          severe_low_quality_rate_threshold: 0.7,
        },
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
        observed_overall: 0.31,
        observed_low_quality_rate: 0.86,
      }),
    ],
  );
  const contextEnginePromptQualityGuardRuntimePayload = parseJsonOutput(
    "context-engine-contract prompt-quality-guard-runtime",
    contextEnginePromptQualityGuardRuntimeResult.stdout,
  );
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.enabled, true);
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.phase, "escalating");
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.transition, "promote");
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.severe, true);
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.floor_stage, "forced");
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.proposed_floor_stage, "minimal");
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.promote_remaining, 0);
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.severe_promote_remaining, 0);
  assert.equal(contextEnginePromptQualityGuardRuntimePayload.assessment?.release_remaining, 3);
  logStep("context-engine-contract prompt-quality-guard-runtime");
}
