import assert from "node:assert/strict";
import {
  logStep,
  parseJsonOutput,
  runTsContract,
} from "../../harness.mjs";

export function runContextEngineCompressionContracts() {
  const contextEngineTrimRecentTurnsPrompt = [
    "[Conversation Context]",
    "[Compact Context Snapshot v2]",
    "[Architecture decisions]",
    "- keep retry guard strict and observable",
    "[Recent Turns]",
    "user: " + "请继续细化上下文压缩策略并解释回滚方案。".repeat(8),
    "assistant: " + "已补充自动压缩阈值与预算守卫。".repeat(8),
    "user: " + "再细化一下结构化压缩，不要只做头部截断。".repeat(8),
    "assistant: " + "可以先裁剪 Recent Turns，再做 head trim。".repeat(8),
    "",
    "[Current User Message]",
    "继续打磨上下文工程，质量优先。",
  ].join("\n");
  const contextEngineTrimRecentTurnsResult = runTsContract("context-engine-contract.ts", "trim-recent-turns", [
    "--payload",
    JSON.stringify({
      prompt: contextEngineTrimRecentTurnsPrompt,
      target_token_limit: 90,
      min_recent_rows: 1,
    }),
  ]);
  const contextEngineTrimRecentTurnsPayload = parseJsonOutput(
    "context-engine-contract trim-recent-turns",
    contextEngineTrimRecentTurnsResult.stdout,
  );
  assert.equal(contextEngineTrimRecentTurnsPayload.has_recent_turns_section, true);
  assert.equal(contextEngineTrimRecentTurnsPayload.changed, true);
  assert.equal(Number(contextEngineTrimRecentTurnsPayload.removed_recent_rows) >= 1, true);
  assert.equal(
    Number(contextEngineTrimRecentTurnsPayload.trimmed_estimated_tokens)
      < Number(contextEngineTrimRecentTurnsPayload.original_estimated_tokens),
    true,
  );
  logStep("context-engine-contract trim-recent-turns");

  const contextEngineTrimSnapshotSectionsPrompt = [
    "[Conversation Context]",
    "[Compact Context Snapshot v2]",
    "[Architecture decisions]",
    "- payment logging should keep request trace id and retry attempt",
    "[Dependency graph hints]",
    "- web/payment.ts -> api/payments.ts -> service/payment-core.ts -> db/order_log",
    "[Symbol graph hints]",
    "- fn trackPaymentTrace @ service/payment-core.ts:42 refs=3",
    "[Live workspace changes]",
    "- M service/payment-core.ts; M api/payments.ts; A docs/payment-observability.md",
    "[Commit lineage hints]",
    "- a1b2c3d4 refined payment retry envelope and audit fields",
    "[Modified files and key changes]",
    "- service/payment-core.ts added trace_id and retry_count propagation",
    "[Current verification status]",
    "- PASS: npm run check:gateway:ts",
    "[Open TODOs and rollback notes]",
    "- TODO: verify legacy webhook branch fallback",
    "[Tool outputs (pass/fail only)]",
    "- FAIL: payment webhook e2e timeout on staging",
    "[Recent Turns]",
    "user: 请继续强化上下文压缩，优先保留架构和变更链路。",
    "",
    "[Current User Message]",
    "继续打磨压缩策略。",
  ].join("\n");
  const contextEngineTrimSnapshotSectionsResult = runTsContract("context-engine-contract.ts", "trim-snapshot-sections", [
    "--payload",
    JSON.stringify({
      prompt: contextEngineTrimSnapshotSectionsPrompt,
      target_token_limit: 130,
    }),
  ]);
  const contextEngineTrimSnapshotSectionsPayload = parseJsonOutput(
    "context-engine-contract trim-snapshot-sections",
    contextEngineTrimSnapshotSectionsResult.stdout,
  );
  assert.equal(contextEngineTrimSnapshotSectionsPayload.has_snapshot, true);
  assert.equal(contextEngineTrimSnapshotSectionsPayload.changed, true);
  assert.equal(Number(contextEngineTrimSnapshotSectionsPayload.removed_sections_count) >= 1, true);
  assert.equal(
    Number(contextEngineTrimSnapshotSectionsPayload.trimmed_estimated_tokens)
      < Number(contextEngineTrimSnapshotSectionsPayload.original_estimated_tokens),
    true,
  );
  logStep("context-engine-contract trim-snapshot-sections");

  const contextEngineSemanticCompressSnapshotPrompt = [
    "[Conversation Context]",
    "[Compact Context Snapshot v2]",
    "[Architecture decisions]",
    "- keep architecture and changed-files evidence stable first",
    "[Dependency graph hints]",
    "- web/payment.ts -> api/payments.ts -> service/payment-core.ts -> db/order_log -> webhook/notify.ts",
    "- web/refund.ts -> api/refunds.ts -> service/payment-core.ts -> db/refund_log -> webhook/notify.ts",
    "[Symbol graph hints]",
    "- fn trackPaymentTrace(request, envelope, retryAttempt) @ service/payment-core.ts:42 refs=7",
    "- fn emitPaymentAuditTrail(payload, traceId, retryCount) @ service/payment-core.ts:96 refs=5",
    "[Live workspace changes]",
    "- M service/payment-core.ts; M api/payments.ts; M api/refunds.ts; A docs/payment-observability.md",
    "- M gateway/src/tools/context/compress/prompt-compaction.ts; M start/turn.ts",
    "[Commit lineage hints]",
    "- a1b2c3d4 refined payment retry envelope and audit fields for webhook retries and observability",
    "- d4e5f6a7 moved webhook retry branch to shared payment-core with unified trace propagation",
    "[Modified files and key changes]",
    "- service/payment-core.ts added trace_id and retry_count propagation",
    "[Current verification status]",
    "- PASS: npm run check:gateway:ts",
    "- FAIL: payment webhook e2e timeout on staging retry branch",
    "[Open TODOs and rollback notes]",
    "- TODO: verify legacy webhook branch fallback after retry envelope migration",
    "- TODO: add contract test for semantic snapshot compression",
    "[Tool outputs (pass/fail only)]",
    "- FAIL: payment webhook e2e timeout on staging with retry_count=5 and trace_id propagation mismatch",
    "- PASS: unit contract for prompt pre-send budget guard",
    "[Recent Turns]",
    "user: 请继续强化上下文压缩，优先保留架构和变更链路。",
    "",
    "[Current User Message]",
    "继续打磨压缩策略。",
  ].join("\n");
  const contextEngineSemanticCompressSnapshotResult = runTsContract(
    "context-engine-contract.ts",
    "semantic-compress-snapshot-sections",
    [
      "--payload",
      JSON.stringify({
        prompt: contextEngineSemanticCompressSnapshotPrompt,
        target_token_limit: 110,
      }),
    ],
  );
  const contextEngineSemanticCompressSnapshotPayload = parseJsonOutput(
    "context-engine-contract semantic-compress-snapshot-sections",
    contextEngineSemanticCompressSnapshotResult.stdout,
  );
  assert.equal(contextEngineSemanticCompressSnapshotPayload.has_snapshot, true);
  assert.equal(contextEngineSemanticCompressSnapshotPayload.changed, true);
  assert.equal(Number(contextEngineSemanticCompressSnapshotPayload.compressed_sections_count) >= 1, true);
  assert.equal(typeof contextEngineSemanticCompressSnapshotPayload.generative_used, "boolean");
  assert.equal(
    Array.isArray(contextEngineSemanticCompressSnapshotPayload.generative_sections),
    true,
  );
  assert.equal(
    typeof contextEngineSemanticCompressSnapshotPayload.generative_sections_count,
    "number",
  );
  assert.equal(Array.isArray(contextEngineSemanticCompressSnapshotPayload.warnings), true);
  logStep("context-engine-contract semantic-compress-snapshot-sections");
}
