import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { FileBackedExperiencePoolStore } from "../../tools/state/experience-pool/store";

const tempRoot = resolve(
  process.cwd(),
  ".grobot",
  "tmp",
  `grobot-exp-task-contract-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
);
mkdirSync(tempRoot, { recursive: true });

try {
  const poolPath = resolve(tempRoot, "experience-pool.json");
  const store = new FileBackedExperiencePoolStore(poolPath);

  const created = store.upsertSuccess({
    tenant: "tenant-a",
    team: "default",
    user: "alice",
    userText: "修复登录 401，并补充 token 续期与重试策略",
    assistantText: [
      "1. 先校验 session token 是否过期。",
      "2. 调整 refresh 流程并在 401 后触发一次重试。",
      "3. 用回归测试验证会话续期成功。",
    ].join("\n"),
    traceId: "trace_success_1",
    providerName: "provider-a",
    verificationPass: true,
    evidenceRef: {
      traceId: "trace_success_1",
      runId: "run_success_1",
      sourceType: "turn_success",
      capturedAt: "2026-04-19T00:00:00.000Z",
    },
  });

  const failure = store.registerFailure({
    tenant: "tenant-a",
    team: "default",
    user: "alice",
    userText: "登录后还是 401，token refresh 看起来没有生效",
    providerName: "provider-a",
    errorClass: "upstream_timeout",
    errorMessage: "provider timeout while refreshing auth token",
    toolContext: "provider=provider-a",
  });

  const afterFailure = store.getRecordById(created.record.id);

  store.upsertSuccess({
    tenant: "tenant-a",
    team: "default",
    user: "alice",
    userText: "再次修复登录 401，并验证 refresh 成功",
    assistantText: [
      "1. 复用已验证的 token refresh 流程。",
      "2. 保留 401 一次性重试并记录 trace。",
      "3. 回归测试通过，登录状态保持。",
    ].join("\n"),
    traceId: "trace_success_2",
    providerName: "provider-a",
    verificationPass: true,
    evidenceRef: {
      traceId: "trace_success_2",
      runId: "run_success_2",
      sourceType: "turn_success",
      capturedAt: "2026-04-19T00:02:00.000Z",
    },
  });

  store.upsertSuccess({
    tenant: "tenant-a",
    team: "default",
    user: "alice",
    userText: "优化首页视觉层级和 CTA 布局",
    assistantText: "调整栅格和按钮层级，完善 hover 反馈。",
    traceId: "trace_success_3",
    providerName: "provider-a",
    verificationPass: true,
    evidenceRef: {
      traceId: "trace_success_3",
      runId: "run_success_3",
      sourceType: "turn_success",
      capturedAt: "2026-04-19T00:04:00.000Z",
    },
  });

  const afterRecovery = store.getRecordById(created.record.id);
  const search = store.search({
    tenant: "tenant-a",
    team: "default",
    user: "alice",
    query: "登录 401 token refresh 重试",
    limit: 3,
    includeStates: ["active", "quarantined"],
  });

  const reloaded = new FileBackedExperiencePoolStore(poolPath);
  const roundtrip = reloaded.getRecordById(created.record.id);

  const payload = {
    created_record: created.created === true,
    failure_matched: Boolean(failure.matchedRecord),
    failure_stage_classified_runtime: afterFailure?.lastFailureStage === "runtime",
    guardrails_generated_after_failure: (afterFailure?.reuseGuardrails.length ?? 0) > 0,
    recovery_success_incremented: (afterRecovery?.recoverySuccessCount ?? 0) >= 1,
    consecutive_failure_reset_after_recovery: (afterRecovery?.consecutiveFailureCount ?? -1) === 0,
    attempt_history_has_both_outcomes:
      (afterRecovery?.attemptHistory.some((item) => item.outcome === "success") ?? false)
      && (afterRecovery?.attemptHistory.some((item) => item.outcome === "failure") ?? false),
    search_prefers_task_overlap: search[0]?.record.id === created.record.id,
    search_emits_task_or_scenario_signals:
      ((search[0]?.matchedTaskSignals?.length ?? 0) > 0)
      || ((search[0]?.matchedScenarioTags?.length ?? 0) > 0),
    roundtrip_task_signature_persisted: Boolean(roundtrip?.taskSignature && roundtrip.taskSignature.length > 0),
    roundtrip_attempt_history_persisted: (roundtrip?.attemptHistory.length ?? 0) >= 2,
    roundtrip_task_metadata_persisted:
      Boolean(roundtrip?.taskType && roundtrip.taskType.length > 0)
      && (roundtrip?.scenarioTags.length ?? 0) > 0,
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
