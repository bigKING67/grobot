import assert from "node:assert/strict";
import { logStep, makeTempDir, parseJsonOutput, runTsContract } from "../../harness.mjs";

export function runPromptQualityWindowContract() {
  const contextEnginePromptQualityWorkDir = makeTempDir("context-engine-prompt-quality");
  const contextEnginePromptQualityResult = runTsContract("context-engine-contract.ts", "prompt-quality-window", [
    "--payload",
    JSON.stringify({
      work_dir: contextEnginePromptQualityWorkDir,
      session_key: "contract:prompt-quality",
      size: 12,
      low_quality_threshold: 0.6,
      threshold_overall: 0.8,
      threshold_low_quality_rate: 0.2,
      min_entries: 2,
      samples: [
        {
          stage: "proactive",
          prompt: [
            "[Conversation Context]",
            "[Compact Context Snapshot v2]",
            "[Architecture decisions]",
            "- keep deterministic prompt budget routing",
            "[Modified files and key changes]",
            "- gateway/src/tools/context/compress/prompt-compaction.ts",
            "[Current verification status]",
            "- PASS: npm run check:gateway:ts",
            "[Open TODOs and rollback notes]",
            "- TODO: add dedicated prompt quality contract gate",
            "[Recent Turns]",
            "user: 请继续优化上下文压缩策略",
            "assistant: 已补齐 pre-send trim 和状态观测",
            "[Current User Message]",
            "继续打磨。",
          ].join("\\n"),
          target_token_limit: 500,
          pre_send_strategy: "quality_first",
          pre_send_overflow_ratio: 0.04,
          pre_send_pressure_score: 0.26,
        },
        {
          stage: "minimal",
          prompt: [
            "[Conversation Context]",
            "[Compact Context Snapshot v2]",
            "[Architecture decisions]",
            "- minimal fallback only",
            "[Current User Message]",
            "继续。",
          ].join("\\n"),
          target_token_limit: 40,
          pre_send_strategy: "hard_budget",
          pre_send_overflow_ratio: 0.32,
          pre_send_pressure_score: 0.78,
        },
      ],
    }),
  ]);
  const contextEnginePromptQualityPayload = parseJsonOutput(
    "context-engine-contract prompt-quality-window",
    contextEnginePromptQualityResult.stdout,
  );
  assert.equal(Number(contextEnginePromptQualityPayload.wrote_entries), 2);
  assert.equal(Number(contextEnginePromptQualityPayload.summary?.entries) >= 2, true);
  assert.equal(typeof contextEnginePromptQualityPayload.summary?.average_scores?.overall, "number");
  assert.equal(typeof contextEnginePromptQualityPayload.summary?.low_quality?.rate, "number");
  assert.equal(typeof contextEnginePromptQualityPayload.summary?.stage_counts?.proactive, "number");
  assert.equal(typeof contextEnginePromptQualityPayload.summary?.signal_averages?.recent_trim_rows, "number");
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.signal_averages?.snapshot_semantic_compress_sections,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.compression_activity?.snapshot_semantic_compress_rate,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.signal_averages?.pre_send_overflow_ratio,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.signal_averages?.pre_send_pressure_score,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.strategy_activity?.hard_budget_rate,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.strategy_activity?.quality_first_rate,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.token_budget?.average_utilization_ratio,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.strategy_trends?.short?.window_size,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.strategy_trends?.medium?.window_size,
    "number",
  );
  const promptQualityStrategyTrendDeltaHardBudget =
    contextEnginePromptQualityPayload.summary?.strategy_trends?.delta?.hard_budget_rate;
  assert.equal(
    typeof promptQualityStrategyTrendDeltaHardBudget === "number"
      || promptQualityStrategyTrendDeltaHardBudget === null,
    true,
  );
  const promptQualityStrategyOutcomeHardBudgetFollowupDelta =
    contextEnginePromptQualityPayload.summary?.strategy_outcomes?.hard_budget_followup_overall_delta;
  assert.equal(
    typeof promptQualityStrategyOutcomeHardBudgetFollowupDelta === "number"
      || promptQualityStrategyOutcomeHardBudgetFollowupDelta === null,
    true,
  );
  const promptQualityStrategyOutcomeQualityFirstFollowupDelta =
    contextEnginePromptQualityPayload.summary?.strategy_outcomes?.quality_first_followup_overall_delta;
  assert.equal(
    typeof promptQualityStrategyOutcomeQualityFirstFollowupDelta === "number"
      || promptQualityStrategyOutcomeQualityFirstFollowupDelta === null,
    true,
  );
  const promptQualityStrategyOutcomeHardBudgetRecoveryRate =
    contextEnginePromptQualityPayload.summary?.strategy_outcomes?.hard_budget_recovery_rate;
  assert.equal(
    typeof promptQualityStrategyOutcomeHardBudgetRecoveryRate === "number"
      || promptQualityStrategyOutcomeHardBudgetRecoveryRate === null,
    true,
  );
  const promptQualityStrategyOutcomeQualityFirstImprovedRate =
    contextEnginePromptQualityPayload.summary?.strategy_outcomes?.quality_first_improved_rate;
  assert.equal(
    typeof promptQualityStrategyOutcomeQualityFirstImprovedRate === "number"
      || promptQualityStrategyOutcomeQualityFirstImprovedRate === null,
    true,
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.strategy_outcomes?.hard_budget_transition_count,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.strategy_outcomes?.quality_first_transition_count,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.pressure_trends?.short?.window_size,
    "number",
  );
  assert.equal(
    typeof contextEnginePromptQualityPayload.summary?.pressure_trends?.medium?.window_size,
    "number",
  );
  const promptQualityPressureTrendDeltaUtilization =
    contextEnginePromptQualityPayload.summary?.pressure_trends?.delta?.average_utilization_ratio;
  assert.equal(
    typeof promptQualityPressureTrendDeltaUtilization === "number"
      || promptQualityPressureTrendDeltaUtilization === null,
    true,
  );
  assert.equal(typeof contextEnginePromptQualityPayload.degradation?.degraded, "boolean");
  assert.equal(contextEnginePromptQualityPayload.degradation?.degraded, true);
  assert.equal(
    ["overall_below_threshold", "low_quality_rate_above_threshold"].includes(
      String(contextEnginePromptQualityPayload.degradation?.reason),
    ),
    true,
  );
  logStep("context-engine-contract prompt-quality-window");
}
