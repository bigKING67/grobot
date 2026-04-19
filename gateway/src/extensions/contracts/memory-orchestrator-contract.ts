import {
  createMemoryOrchestrator,
  defaultMemoryOrchestratorPolicy,
  type MemoryOrchestratorExperienceAdapter,
  type MemoryOrchestratorGaAdapter,
} from "../../tools/memory";

const nowMs = Date.now();
const nowIso = new Date(nowMs).toISOString();
const staleIso = new Date(nowMs - (14 * 24 * 3_600_000)).toISOString();
const defaultPolicy = defaultMemoryOrchestratorPolicy();

const gaSuccessCalls: Array<{ sessionKey: string; traceId: string }> = [];
const gaFailureCalls: Array<{ sessionKey: string; errorClass: string }> = [];
const experienceSuccessCalls: Array<{ sessionKey: string; traceId: string }> = [];
const experienceFailureCalls: Array<{ sessionKey: string; errorClass: string }> = [];

const gaAdapter: MemoryOrchestratorGaAdapter = {
  listMemory: () => [
    {
      id: "mem_1",
      memoryLevel: "L2",
      text: "支付回调改造时先看 webhook retry 和幂等日志。",
      executionVerified: true,
      confidence: 0.93,
      createdAt: nowIso,
      tags: ["payments", "retry"],
    },
  ],
  listSkillCards: () => [
    {
      id: "card_1",
      taskSignature: "intent:payment-logging",
      preconditions: ["payment webhook"],
      steps: ["add request id", "persist idempotency key", "log retry reason"],
      failureSignals: ["duplicate callback"],
      rollback: ["restore old webhook handler"],
      confidence: 0.88,
      updatedAt: nowIso,
    },
  ],
  registerTurnSuccess: (input) => {
    gaSuccessCalls.push({
      sessionKey: input.sessionKey,
      traceId: input.traceId,
    });
  },
  registerTurnFailure: (input) => {
    gaFailureCalls.push({
      sessionKey: input.sessionKey,
      errorClass: input.errorClass,
    });
  },
  writeMemory: () => ({
    ok: true,
    code: "OK",
    record: {
      id: "mem_ingest_1",
      memoryLevel: "L2",
      text: "ok",
      executionVerified: true,
      confidence: 0.9,
      createdAt: nowIso,
      tags: [],
    },
  }),
};

const experienceAdapter: MemoryOrchestratorExperienceAdapter = {
  getTeamDefault: () => "team-default",
  buildRecallPrompt: () => ({
    prompt: "[GA Experience Pool]\n- exp#1 summary=支付链路日志模板",
    matched: 1,
    candidates: 3,
  }),
  searchRecords: () => [
    {
      score: 82,
      record: {
        id: "exp_team_1",
        user: "teammate",
        summary: "支付回调链路按 traceId 串联 API 与 DB 日志。",
        sop: ["trace id", "request id", "db latency"],
        confidence: 0.86,
        successCount: 8,
        failureCount: 1,
        state: "active",
      },
    },
    {
      score: 85,
      record: {
        id: "exp_self_1",
        user: "gaoqian",
        summary: "self record should be filtered in team memory block",
        sop: [],
        confidence: 0.92,
        successCount: 10,
        failureCount: 0,
        state: "active",
      },
    },
  ],
  registerTurnSuccess: (input) => {
    experienceSuccessCalls.push({
      sessionKey: input.sessionKey,
      traceId: input.traceId,
    });
    return {
      skipped: false,
      verificationPassed: true,
      evidenceRefPassed: true,
      redactionPassed: true,
      created: true,
      recordId: "exp_created_1",
      confidence: 0.91,
    };
  },
  registerTurnFailure: (input) => {
    experienceFailureCalls.push({
      sessionKey: input.sessionKey,
      errorClass: input.errorClass,
    });
    return {
      matched: true,
      recordId: "exp_feedback_1",
      score: 77,
      confidence: 0.73,
      quarantined: false,
    };
  },
};

const orchestrator = createMemoryOrchestrator({
  ga: gaAdapter,
  experience: experienceAdapter,
  policy: {
    injectBudgetRatio: 0.3,
    maxSectionTokens: 800,
    maxGaMemoryRows: 2,
    maxTeamExperienceRows: 2,
    decayMaxRowsPerSession: 2,
  },
});

const inject = orchestrator.injectContext({
  sessionKey: "feishu:tenant-a:dm:gaoqian",
  userText: "给支付回调链路补全 logging 并处理 webhook 重试幂等",
  targetTokenLimit: 1800,
  tenant: "tenant-a",
  user: "gaoqian",
  includeLineage: false,
  lineageMaxRows: 4,
  lineageMaxCommits: 80,
  lineageCacheTtlMs: 60_000,
});

const reconcile = orchestrator.reconcile({
  rows: [
    {
      id: "dup_1",
      memoryLevel: "L2",
      text: "支付回调必须带 trace id",
      executionVerified: true,
      confidence: 0.81,
      createdAt: nowIso,
      tags: [],
    },
    {
      id: "dup_2",
      memoryLevel: "L2",
      text: "支付回调必须带 trace id",
      executionVerified: true,
      confidence: 0.79,
      createdAt: nowIso,
      tags: [],
    },
  ],
});
const decay = orchestrator.decay({
  nowMs,
  rows: [
    {
      id: "keep_l3",
      memoryLevel: "L3",
      text: "支付链路关键 SOP",
      executionVerified: true,
      confidence: 0.94,
      createdAt: nowIso,
      tags: ["payments"],
    },
    {
      id: "keep_l2",
      memoryLevel: "L2",
      text: "webhook 幂等重试日志策略",
      executionVerified: true,
      confidence: 0.88,
      createdAt: nowIso,
      tags: ["webhook"],
    },
    {
      id: "trim_capacity",
      memoryLevel: "L2",
      text: "备用经验行用于测试容量裁剪",
      executionVerified: true,
      confidence: 0.62,
      createdAt: nowIso,
      tags: ["capacity"],
    },
    {
      id: "drop_confidence",
      memoryLevel: "L2",
      text: "低可信行应被清理",
      executionVerified: true,
      confidence: 0.08,
      createdAt: nowIso,
      tags: ["low-confidence"],
    },
    {
      id: "drop_age",
      memoryLevel: "L1",
      text: "陈旧未验证记忆应淘汰",
      executionVerified: false,
      confidence: 0.9,
      createdAt: staleIso,
      tags: ["stale"],
    },
  ],
});
const tunedPolicy = orchestrator.tuneDecayPolicy({
  decayMaxRowsPerSession: 3,
  decayMinRowsToKeep: 2,
  decayMinConfidenceVerified: 0.31,
  decayMinConfidenceUnverified: 0.52,
  decayUnverifiedMaxAgeHours: 60,
});

const turnSuccessFeedback = orchestrator.feedback({
  type: "turn_success",
  sessionKey: "feishu:tenant-a:dm:gaoqian",
  userText: "补全支付 logging",
  assistantText: "已补充 trace id 和幂等校验日志。",
  traceId: "trace_success_1",
  requestId: "req_success_1",
  providerName: "provider-a",
  verificationPass: true,
});

const verificationFailureFeedback = orchestrator.feedback({
  type: "verification_failure",
  sessionKey: "feishu:tenant-a:dm:gaoqian",
  userText: "补全支付 logging",
  providerName: "provider-a",
  errorMessage: "turn verification failed",
});
const gaFailureCountAfterVerification = gaFailureCalls.length;
const experienceFailureCountAfterVerification = experienceFailureCalls.length;

const turnFailureFeedback = orchestrator.feedback({
  type: "turn_failure",
  sessionKey: "feishu:tenant-a:dm:gaoqian",
  userText: "补全支付 logging",
  providerName: "provider-a",
  errorClass: "upstream_timeout",
  errorMessage: "timeout",
});

const policy = orchestrator.policySnapshot();
const payload = {
  policy_has_override_ratio: Number(policy.injectBudgetRatio.toFixed(2)) === 0.3,
  policy_max_section_tokens: policy.maxSectionTokens,
  policy_default_min_tokens: policy.injectBudgetMinTokens === defaultPolicy.injectBudgetMinTokens,
  inject_has_prompt_parts: inject.promptParts.length > 0,
  inject_budget_positive: inject.budgetTokens > 0,
  inject_budget_respects_ratio: inject.budgetTokens === Math.floor(1800 * 0.3),
  reconcile_deduplicated: reconcile.deduplicated === 1,
  reconcile_kept: reconcile.kept === 1,
  reconcile_rows_length: reconcile.rows.length === 1,
  decay_pruned: decay.action === "pruned",
  decay_kept: decay.kept === 2,
  decay_dropped: decay.dropped === 3,
  decay_rows_length: decay.rows.length === 2,
  decay_kept_expected_rows:
    decay.rows.some((row) => row.id === "keep_l3")
    && decay.rows.some((row) => row.id === "keep_l2"),
  decay_dropped_age_count: decay.droppedByReason.ageExceeded === 1,
  decay_dropped_confidence_count: decay.droppedByReason.lowConfidence === 1,
  decay_dropped_capacity_count: decay.droppedByReason.capacityTrim === 1,
  decay_reason_present: typeof decay.reason === "string" && decay.reason.length > 0,
  decay_reason_has_capacity: decay.reason.includes("capacity_trim:1"),
  tune_decay_policy_applied_rows: tunedPolicy.decayMaxRowsPerSession === 3,
  tune_decay_policy_applied_confidence:
    tunedPolicy.decayMinConfidenceVerified === 0.31
    && tunedPolicy.decayMinConfidenceUnverified === 0.52,
  tune_decay_policy_applied_age: tunedPolicy.decayUnverifiedMaxAgeHours === 60,
  inject_includes_ga_or_experience:
    inject.includedSections.includes("ga_skill_cards")
    || inject.includedSections.includes("personal_experience"),
  inject_filters_self_from_team_memory:
    inject.promptParts.join("\n").includes("user=teammate")
    && !inject.promptParts.join("\n").includes("user=gaoqian"),
  inject_emits_event: inject.stderrEvents.some((line) => line.includes("[memory-orchestrator] event=context_")),
  feedback_turn_success_calls_ga_once: gaSuccessCalls.length === 1,
  feedback_turn_success_calls_experience_once: experienceSuccessCalls.length === 1,
  feedback_turn_success_emits_publish_event:
    turnSuccessFeedback.stderrEvents.some((line) => line.includes("[experience] event=published")),
  feedback_verification_failure_only_hits_experience:
    gaFailureCountAfterVerification === 0 && experienceFailureCountAfterVerification === 1,
  feedback_verification_failure_event:
    verificationFailureFeedback.stderrEvents.some((line) => line.includes("[experience] event=failure_feedback")),
  feedback_turn_failure_calls_ga: gaFailureCalls.length === 1,
  feedback_turn_failure_calls_experience: experienceFailureCalls.length === 2,
  feedback_turn_failure_event:
    turnFailureFeedback.stderrEvents.some((line) => line.includes("[experience] event=failure_feedback")),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
