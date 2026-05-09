import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createExperiencePoolRuntime } from "../../cli/services/experience-pool-runtime";
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
    providerFailureDiagnostics: {
      providerName: "provider-a",
      diagnosticKind: "upstream_http_error",
      source: "model.transport",
      stage: "chat_http_status",
      providerKind: "kimi",
      model: "kimi-k2.5",
      httpStatus: 503,
      attempt: 3,
      maxAttempts: 3,
      retryable: false,
    },
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
  const diagnosticSearch = store.search({
    tenant: "tenant-a",
    team: "default",
    user: "alice",
    query: "upstream_http_error 503 retryable false provider-a",
    limit: 3,
    includeStates: ["active", "quarantined"],
  });
  const defaultLimitSearch = store.search({
    tenant: "tenant-a",
    team: "default",
    user: "alice",
    query: "登录 401 token refresh 重试",
    includeStates: ["active", "quarantined"],
  });
  const invalidSearchLimitsRejected = [
    () => store.search({
      tenant: "tenant-a",
      team: "default",
      user: "alice",
      query: "登录 401 token refresh 重试",
      limit: 0,
    }),
    () => store.search({
      tenant: "tenant-a",
      team: "default",
      user: "alice",
      query: "登录 401 token refresh 重试",
      limit: 21,
    }),
    () => store.search({
      tenant: "tenant-a",
      team: "default",
      user: "alice",
      query: "登录 401 token refresh 重试",
      limit: 1.5,
    }),
  ].every((action) => {
    try {
      action();
      return false;
    } catch (error) {
      return error instanceof RangeError
        && error.message.includes("invalid_experience_search_limit");
    }
  });
  const invalidRuntimeRecallLimitsRejected = [
    () => createExperiencePoolRuntime({
      poolPath,
      publishMode: "auto",
      recallLimit: 0,
    }),
    () => createExperiencePoolRuntime({
      poolPath,
      publishMode: "auto",
      recallLimit: 7,
    }),
    () => createExperiencePoolRuntime({
      poolPath,
      publishMode: "auto",
      recallLimit: 1.5,
    }),
  ].every((action) => {
    try {
      action();
      return false;
    } catch (error) {
      return error instanceof RangeError
        && error.message.includes("invalid_experience_recall_limit");
    }
  });

  const reloaded = new FileBackedExperiencePoolStore(poolPath);
  const roundtrip = reloaded.getRecordById(created.record.id);
  const failureAttempt = afterFailure?.attemptHistory.find((item) => item.outcome === "failure");
  const runtime = createExperiencePoolRuntime({
    poolPath,
    publishMode: "auto",
    recallLimit: 3,
  });
  const recallPrompt = runtime.buildRecallPrompt({
    sessionKey: "feishu:tenant-a:dm:alice",
    userText: "再次遇到 upstream_http_error 503 provider-a",
  }).prompt;

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
    provider_failure_diagnostics_persisted_on_record:
      afterFailure?.lastProviderFailureDiagnostics?.diagnosticKind === "upstream_http_error"
      && afterFailure.lastProviderFailureDiagnostics.httpStatus === 503
      && afterFailure.lastProviderFailureDiagnostics.retryable === false,
    provider_failure_diagnostics_persisted_on_attempt:
      failureAttempt?.providerFailureDiagnostics?.diagnosticKind === "upstream_http_error"
      && failureAttempt.providerFailureDiagnostics.httpStatus === 503,
    provider_failure_diagnostics_persisted_on_evidence:
      afterFailure?.evidence.some((item) =>
        item.source === "turn_failure"
        && item.providerFailureDiagnostics?.diagnosticKind === "upstream_http_error"
      ) ?? false,
    search_prefers_task_overlap: search[0]?.record.id === created.record.id,
    search_default_limit_works_without_silent_clamp: defaultLimitSearch[0]?.record.id === created.record.id,
    search_rejects_invalid_explicit_limits: invalidSearchLimitsRejected,
    runtime_rejects_invalid_explicit_recall_limits: invalidRuntimeRecallLimitsRejected,
    search_matches_provider_failure_diagnostic:
      diagnosticSearch[0]?.record.id === created.record.id
      && (diagnosticSearch[0]?.matchedTaskSignals ?? []).some((item) => item.includes("provider_failure")),
    search_emits_task_or_scenario_signals:
      ((search[0]?.matchedTaskSignals?.length ?? 0) > 0)
      || ((search[0]?.matchedScenarioTags?.length ?? 0) > 0),
    roundtrip_task_signature_persisted: Boolean(roundtrip?.taskSignature && roundtrip.taskSignature.length > 0),
    roundtrip_attempt_history_persisted: (roundtrip?.attemptHistory.length ?? 0) >= 2,
    roundtrip_task_metadata_persisted:
      Boolean(roundtrip?.taskType && roundtrip.taskType.length > 0)
      && (roundtrip?.scenarioTags.length ?? 0) > 0,
    roundtrip_provider_failure_diagnostics_persisted:
      roundtrip?.lastProviderFailureDiagnostics?.diagnosticKind === "upstream_http_error"
      && roundtrip.lastProviderFailureDiagnostics.httpStatus === 503,
    recall_prompt_surfaces_provider_failure_diagnostics:
      recallPrompt.includes("last_provider_failure:")
      && recallPrompt.includes("diagnostic_kind=upstream_http_error")
      && recallPrompt.includes("http_status=503"),
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
