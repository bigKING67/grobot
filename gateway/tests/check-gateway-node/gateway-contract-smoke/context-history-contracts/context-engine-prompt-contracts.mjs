import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  runTsContract,
} from "../../harness.mjs";

export function runContextEnginePromptContracts() {
  const contextEnginePreparePromptHistory = Array.from({ length: 12 }).map((_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `turn-${String(index)}: please keep detailed architecture notes, modified files list, verification matrix, and rollback checklist for context engine hard-limit compaction regression coverage.`,
  }));
  const contextEnginePreparePromptResult = runTsContract("context-engine-contract.ts", "prepare-prompt", [
    "--payload",
    JSON.stringify({
      user_text: "请继续修复 context engine 的压缩失败，并保持关键文件和验证结论。",
      history_turns: 6,
      history: contextEnginePreparePromptHistory,
      config: {
        enabled: true,
        profile: "balanced",
        contextWindowTokens: 160,
        reservedOutputTokens: 60,
        safetyMarginTokens: 20,
        thresholds: {
          proactiveRatio: 0.7,
          forcedRatio: 0.8,
          hardRatio: 0.9,
        },
        recovery: {
          reactiveMaxRetries: 1,
          ptlMaxRetries: 2,
          circuitBreakerFailures: 3,
        },
        lineage: {
          enabled: false,
          maxRows: 1,
          maxCommits: 20,
          cacheTtlMs: 1000,
        },
        workspaceSignals: {
          enabled: false,
          maxRows: 1,
          includeUntracked: false,
          cacheTtlMs: 200,
        },
        semanticPrefetch: {
          enabled: false,
          timeoutMs: 500,
          maxEvidence: 2,
        },
        dependencyGraph: {
          enabled: false,
          maxRows: 1,
        },
        symbolGraph: {
          enabled: false,
          maxRows: 1,
        },
        reactiveOnPromptTooLong: true,
      },
    }),
  ]);
  const contextEnginePreparePromptPayload = parseJsonOutput(
    "context-engine-contract prepare-prompt",
    contextEnginePreparePromptResult.stdout,
  );
  assert.equal(
    ["normal", "proactive", "forced", "minimal"].includes(String(contextEnginePreparePromptPayload.selected_stage)),
    true,
  );
  assert.equal(
    ["normal", "proactive", "forced", "minimal"].includes(String(contextEnginePreparePromptPayload.threshold_stage)),
    true,
  );
  assert.equal(
    ["threshold", "budget_guard"].includes(String(contextEnginePreparePromptPayload.selection_reason)),
    true,
  );
  assert.equal(
    Number(contextEnginePreparePromptPayload.variant_tokens?.normal)
      >= Number(contextEnginePreparePromptPayload.variant_tokens?.proactive),
    true,
  );
  assert.equal(
    Number(contextEnginePreparePromptPayload.variant_tokens?.proactive)
      >= Number(contextEnginePreparePromptPayload.variant_tokens?.forced),
    true,
  );
  assert.equal(
    Number(contextEnginePreparePromptPayload.variant_tokens?.forced)
      >= Number(contextEnginePreparePromptPayload.variant_tokens?.minimal),
    true,
  );
  assert.equal(
    Number(contextEnginePreparePromptPayload.selected_utilization)
      <= Number(contextEnginePreparePromptPayload.utilization),
    true,
  );
  assert.equal(
    Number(contextEnginePreparePromptPayload.effective_window_tokens) > 0,
    true,
  );
  assert.equal(
    Number(contextEnginePreparePromptPayload.auto_compact_token_limit) > 0,
    true,
  );
  assert.equal(
    Number(contextEnginePreparePromptPayload.target_token_limit) > 0,
    true,
  );
  assert.equal(
    typeof contextEnginePreparePromptPayload.auto_limit_triggered === "boolean",
    true,
  );
  logStep("context-engine-contract prepare-prompt");

  const contextEngineAutoLimitGuardHistory = Array.from({ length: 8 }).map((_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `auto-limit-guard-${String(index)} ${"context details ".repeat(36)}`,
  }));
  const contextEngineAutoLimitGuardResult = runTsContract("context-engine-contract.ts", "prepare-prompt", [
    "--payload",
    JSON.stringify({
      user_text: "继续处理上下文压缩并保留关键回滚线索",
      history_turns: 6,
      history: contextEngineAutoLimitGuardHistory,
      config: {
        enabled: true,
        profile: "balanced",
        contextWindowTokens: 6400,
        reservedOutputTokens: 500,
        safetyMarginTokens: 200,
        autoCompactTokenLimit: 450,
        thresholds: {
          proactiveRatio: 0.92,
          forcedRatio: 0.96,
          hardRatio: 0.98,
        },
        recovery: {
          reactiveMaxRetries: 1,
          ptlMaxRetries: 2,
          circuitBreakerFailures: 3,
        },
        lineage: {
          enabled: false,
          maxRows: 1,
          maxCommits: 20,
          cacheTtlMs: 1000,
        },
        workspaceSignals: {
          enabled: false,
          maxRows: 1,
          includeUntracked: false,
          cacheTtlMs: 200,
        },
        semanticPrefetch: {
          enabled: false,
          timeoutMs: 500,
          maxEvidence: 2,
        },
        dependencyGraph: {
          enabled: false,
          maxRows: 1,
        },
        symbolGraph: {
          enabled: false,
          maxRows: 1,
        },
        reactiveOnPromptTooLong: true,
      },
    }),
  ]);
  const contextEngineAutoLimitGuardPayload = parseJsonOutput(
    "context-engine-contract prepare-prompt auto-limit-guard",
    contextEngineAutoLimitGuardResult.stdout,
  );
  assert.equal(contextEngineAutoLimitGuardPayload.threshold_stage, "proactive");
  assert.equal(contextEngineAutoLimitGuardPayload.auto_limit_triggered, true);
  logStep("context-engine-contract prepare-prompt auto-limit-guard");

  const contextEngineDownshiftGuardResult = runTsContract("context-engine-contract.ts", "downshift-guard", [
    "--payload",
    JSON.stringify({
      allow_proactive_compaction: true,
      previous_target_token_limit: 6000,
      current_target_token_limit: 4200,
      total_estimated_tokens: 5600,
      selected_stage: "normal",
    }),
  ]);
  const contextEngineDownshiftGuardPayload = parseJsonOutput(
    "context-engine-contract downshift-guard",
    contextEngineDownshiftGuardResult.stdout,
  );
  assert.equal(contextEngineDownshiftGuardPayload.triggered, true);
  assert.equal(contextEngineDownshiftGuardPayload.promoted_stage, "proactive");
  logStep("context-engine-contract downshift-guard");
}
