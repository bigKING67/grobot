import assert from "node:assert/strict";
import { logStep, parseJsonOutput, runTsContract } from "../../harness.mjs";

export function runPreSendCompressionPlanContracts() {
  const preSendPlanQualityFirstResult = runTsContract(
    "context-engine-contract.ts",
    "pre-send-compression-plan",
    [
      "--payload",
      JSON.stringify({
        selected_stage: "proactive",
        estimated_tokens: 10_150,
        target_token_limit: 10_000,
        quality_guard_active: false,
        quality_guard_severe: false,
        pressure_trend_momentum: 0.08,
      }),
    ],
  );
  const preSendPlanQualityFirstPayload = parseJsonOutput(
    "context-engine-contract pre-send-compression-plan quality-first",
    preSendPlanQualityFirstResult.stdout,
  );
  assert.equal(preSendPlanQualityFirstPayload.strategy, "quality_first");
  assert.equal(Array.isArray(preSendPlanQualityFirstPayload.order), true);
  assert.equal(preSendPlanQualityFirstPayload.order[0], "recent_trim");
  assert.equal(preSendPlanQualityFirstPayload.order[1], "snapshot_semantic_compress");
  assert.equal(preSendPlanQualityFirstPayload.order[2], "snapshot_trim");
  assert.equal(typeof preSendPlanQualityFirstPayload.overflow_ratio, "number");
  assert.equal(typeof preSendPlanQualityFirstPayload.pressure_score, "number");
  logStep("context-engine-contract pre-send-compression-plan quality-first");

  const preSendPlanHardBudgetResult = runTsContract(
    "context-engine-contract.ts",
    "pre-send-compression-plan",
    [
      "--payload",
      JSON.stringify({
        selected_stage: "minimal",
        estimated_tokens: 13_600,
        target_token_limit: 10_000,
        quality_guard_active: true,
        quality_guard_severe: true,
        pressure_trend_momentum: 0.82,
      }),
    ],
  );
  const preSendPlanHardBudgetPayload = parseJsonOutput(
    "context-engine-contract pre-send-compression-plan hard-budget",
    preSendPlanHardBudgetResult.stdout,
  );
  assert.equal(preSendPlanHardBudgetPayload.strategy, "hard_budget");
  assert.equal(Array.isArray(preSendPlanHardBudgetPayload.order), true);
  assert.equal(preSendPlanHardBudgetPayload.order[0], "recent_trim");
  assert.equal(preSendPlanHardBudgetPayload.order[1], "snapshot_trim");
  assert.equal(preSendPlanHardBudgetPayload.order.includes("snapshot_semantic_compress"), true);
  assert.equal(preSendPlanHardBudgetPayload.order.at(-1), "head_trim");
  assert.equal(Number(preSendPlanHardBudgetPayload.overflow_ratio) >= 0.3, true);
  assert.equal(Number(preSendPlanHardBudgetPayload.pressure_score) >= 0.62, true);
  logStep("context-engine-contract pre-send-compression-plan hard-budget");
}
