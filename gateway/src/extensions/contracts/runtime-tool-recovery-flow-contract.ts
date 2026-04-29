import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeEvent } from "../../models/types";
import { applyRuntimeToolRecoveryPromptFlow } from "../../tools/runtime/recovery-prompt-flow";
import { applyRuntimeToolRecoveryConsumption, readRuntimeToolSurfaceAdaptationState } from "../../tools/runtime/tool-surface-adaptation-state";
import {
  readRuntimeToolSurfaceMetrics,
  recordRuntimeToolSurfaceMetrics,
  type RuntimeToolRecoveryFeedback,
} from "../../tools/runtime/tool-events";
import type { RuntimeToolSurfaceAdaptation } from "../../tools/runtime/default-enabled-tools";
import type { RuntimeToolSurfaceAdaptationGuard } from "../../tools/runtime/tool-surface-adaptation-state";

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: actual=${String(actual)} expected=${String(expected)}`);
  }
}

function activeNonrecoverableFeedback(observedAt: string): RuntimeToolRecoveryFeedback {
  return {
    active: true,
    severity: "warning",
    reason: "recent_recovery",
    stage: "ask_user",
    toolName: "web_scan",
    errorClass: "config_missing",
    recommendedNextAction: "ask_user_for_config_or_switch_provider",
    actionFamily: "user_intervention",
    actionReason: "ask_user_for_config_or_switch_provider",
    recoverable: false,
    requiresUserIntervention: true,
    sameToolErrorCount: 3,
    escalated: true,
    escalationReason: "same_tool_error_exhausted",
    escalationPolicyVersion: "v1",
    baseStage: "local_fix",
    baseRecommendedNextAction: "request_environment_fix",
    promptBlock: "[Runtime Tool Recovery Hint]\nRecent tool issue: stage=ask_user tool=web_scan error_class=config_missing",
    observedAt,
  };
}

function event(eventType: RuntimeEvent["eventType"], payload: Record<string, unknown>): RuntimeEvent {
  return {
    traceId: "trace_runtime_tool_recovery_flow_contract",
    turnId: "turn_runtime_tool_recovery_flow_contract",
    sessionKey: "dev:tenant:dm:user",
    eventType,
    payload,
    timestampIso: "2026-04-26T00:00:00.000Z",
  };
}

const inactiveGuard: RuntimeToolSurfaceAdaptationGuard = {
  active: false,
  reason: "ok",
  blockedProfile: null,
  matchingFailureCount: 0,
  recentProfileSequence: [],
};

const activeGuard: RuntimeToolSurfaceAdaptationGuard = {
  active: true,
  reason: "repeated_profile_failure",
  blockedProfile: "browser",
  matchingFailureCount: 2,
  recentProfileSequence: ["coding", "browser", "coding"],
};

const inactiveAdaptation: RuntimeToolSurfaceAdaptation = {
  enabled: true,
  active: false,
  reason: "recovery_requires_user_intervention",
  fromProfile: "coding",
  appliedProfile: "coding",
  recommendedProfile: null,
  source: null,
  autoAdaptationBlocked: true,
  recoveryStage: "ask_user",
  recoveryToolName: "web_scan",
  recoveryErrorClass: "config_missing",
  recoveryRecoverable: false,
  recoveryObservedAt: "2026-04-26T00:00:00.000Z",
};

const workDir = join(
  process.env.TMPDIR ?? "/tmp",
  `grobot-runtime-tool-recovery-flow-${String(process.pid)}-${String(Date.now())}`,
);
mkdirSync(workDir, { recursive: true });

try {
  const repeatedWebScanFailureEvents = [
    event("tool_end", {
      tool_name: "web_scan",
      status: "failed",
      error_class: "config_missing",
      duration_ms: 4,
    }),
    event("tool_recovery", {
      tool_name: "web_scan",
      error_class: "config_missing",
      recovery_stage: "local_fix",
      recovery_reason: "config_missing",
      recommended_next_action: "request_environment_fix",
      recoverable: true,
    }),
  ];
  recordRuntimeToolSurfaceMetrics({
    workDir,
    events: repeatedWebScanFailureEvents,
  });
  recordRuntimeToolSurfaceMetrics({
    workDir,
    events: repeatedWebScanFailureEvents,
  });
  recordRuntimeToolSurfaceMetrics({
    workDir,
    events: repeatedWebScanFailureEvents,
  });
  const repeatedPressureBeforePrompt = readRuntimeToolSurfaceMetrics(workDir);
  expectEqual(
    repeatedPressureBeforePrompt.latestRecoveryRepeatKey,
    "tool_error:web_scan:config_missing",
    "repeat pressure exists before intervention prompt",
  );
  expectEqual(
    repeatedPressureBeforePrompt.latestRecoveryRepeatCount,
    3,
    "repeat pressure count exists before intervention prompt",
  );

  const rawFeedback = activeNonrecoverableFeedback("2026-04-26T00:00:00.000Z");

  const guardedNonrecoverableWorkDir = join(workDir, "guarded-nonrecoverable");
  mkdirSync(guardedNonrecoverableWorkDir, { recursive: true });
  const guardedNonrecoverableFlow = applyRuntimeToolRecoveryPromptFlow({
    workDir: guardedNonrecoverableWorkDir,
    recoveryFeedback: rawFeedback,
    guard: activeGuard,
    adaptation: inactiveAdaptation,
    nowIso: "2026-04-26T00:00:00.500Z",
  });
  expectEqual(
    guardedNonrecoverableFlow.promptInjected,
    true,
    "guarded nonrecoverable flow still injects recovery prompt",
  );
  expectEqual(
    guardedNonrecoverableFlow.guardPromptInjected,
    false,
    "guarded nonrecoverable flow bypasses guard prompt",
  );
  expectEqual(
    guardedNonrecoverableFlow.automaticRecoveryDenied,
    true,
    "guarded nonrecoverable flow denies automatic recovery",
  );
  expectEqual(
    guardedNonrecoverableFlow.guardBypassedForUserIntervention,
    true,
    "guarded nonrecoverable flow marks guard bypass",
  );
  expectEqual(
    guardedNonrecoverableFlow.guardConsumptionRecorded,
    false,
    "guarded nonrecoverable flow does not record guard consumption",
  );
  expectEqual(
    guardedNonrecoverableFlow.nonrecoverableConsumptionRecorded,
    true,
    "guarded nonrecoverable flow records intervention consumption",
  );
  expect(
    guardedNonrecoverableFlow.promptBlocks.some((part) => part.includes("[Runtime Tool Recovery Hint]")),
    "guarded nonrecoverable flow keeps recovery prompt block",
  );
  expect(
    guardedNonrecoverableFlow.stderrEvents.some((line) => line.includes("event=automatic_recovery_denied")),
    "guarded nonrecoverable flow emits automatic recovery denied event",
  );
  expect(
    guardedNonrecoverableFlow.stderrEvents.some((line) =>
      line.includes("event=surface_guard_bypassed_for_user_intervention")
    ),
    "guarded nonrecoverable flow emits guard bypass event",
  );
  expect(
    guardedNonrecoverableFlow.stderrEvents.every((line) => !line.includes("event=prompt_hint_guarded")),
    "guarded nonrecoverable flow avoids stale guard prompt event",
  );

  const firstFeedback = applyRuntimeToolRecoveryConsumption({
    feedback: rawFeedback,
    snapshot: readRuntimeToolSurfaceAdaptationState(workDir),
  });
  expectEqual(firstFeedback.active, true, "first feedback is active before consumption");

  const firstFlow = applyRuntimeToolRecoveryPromptFlow({
    workDir,
    recoveryFeedback: firstFeedback,
    guard: inactiveGuard,
    adaptation: inactiveAdaptation,
    nowIso: "2026-04-26T00:00:01.000Z",
  });
  expectEqual(firstFlow.promptInjected, true, "first flow injects prompt");
  expectEqual(firstFlow.guardPromptInjected, false, "first flow does not inject guard prompt");
  expectEqual(firstFlow.automaticRecoveryDenied, true, "first flow denies automatic recovery");
  expectEqual(firstFlow.guardBypassedForUserIntervention, false, "first flow has no guard bypass");
  expectEqual(firstFlow.nonrecoverableConsumptionRecorded, true, "first flow records nonrecoverable consumption");
  expect(
    firstFlow.promptBlocks.some((part) => part.includes("[Runtime Tool Recovery Hint]")),
    "first flow includes recovery hint prompt block",
  );
  expect(
    firstFlow.stderrEvents.some((line) => line.includes("event=requires_user_intervention")),
    "first flow emits requires_user_intervention event",
  );
  expect(
    firstFlow.stderrEvents.some((line) => line.includes("event=automatic_recovery_denied")),
    "first flow emits automatic_recovery_denied event",
  );
  expect(
    firstFlow.stderrEvents.some((line) => line.includes("auto_retry_allowed=false")),
    "first flow explicitly denies automatic retry",
  );
  expect(
    firstFlow.stderrEvents.every((line) => line.includes("same_tool_error_count=3")),
    "first flow stderr events include repeat count",
  );
  expect(
    firstFlow.stderrEvents.every((line) => line.includes("action_family=user_intervention")),
    "first flow stderr events include action family",
  );
  expect(
    firstFlow.stderrEvents.every((line) => line.includes("action_reason=ask_user_for_config_or_switch_provider")),
    "first flow stderr events include action reason",
  );
  expect(
    firstFlow.stderrEvents.every((line) => line.includes("escalated=true")),
    "first flow stderr events include escalated flag",
  );
  expect(
    firstFlow.stderrEvents.every((line) => line.includes("escalation_reason=same_tool_error_exhausted")),
    "first flow stderr events include escalation reason",
  );
  expect(
    firstFlow.stderrEvents.every((line) => line.includes("base_recovery_stage=local_fix")),
    "first flow stderr events include base recovery stage",
  );
  expect(
    firstFlow.stderrEvents.some((line) => line.includes("event=prompt_hint_injected")),
    "first flow emits prompt_hint_injected event",
  );
  expect(
    firstFlow.stderrEvents.some((line) => line.includes("event=nonrecoverable_intervention_prompted")),
    "first flow emits nonrecoverable_intervention_prompted event",
  );
  const repeatedPressureAfterPrompt = readRuntimeToolSurfaceMetrics(workDir);
  expectEqual(
    repeatedPressureAfterPrompt.latestRecoveryRepeatKey,
    null,
    "intervention prompt clears repeat pressure key",
  );
  expectEqual(
    repeatedPressureAfterPrompt.latestRecoveryRepeatCount,
    0,
    "intervention prompt clears repeat pressure count",
  );

  const secondFeedback = applyRuntimeToolRecoveryConsumption({
    feedback: rawFeedback,
    snapshot: readRuntimeToolSurfaceAdaptationState(workDir),
  });
  expectEqual(secondFeedback.active, false, "second feedback is consumed");
  expectEqual(
    secondFeedback.consumedReason,
    "nonrecoverable_intervention_prompted",
    "second feedback consumed reason",
  );

  const secondFlow = applyRuntimeToolRecoveryPromptFlow({
    workDir,
    recoveryFeedback: secondFeedback,
    guard: inactiveGuard,
    adaptation: {
      ...inactiveAdaptation,
      autoAdaptationBlocked: false,
    },
    nowIso: "2026-04-26T00:00:02.000Z",
  });
  expectEqual(secondFlow.promptInjected, false, "second flow does not reinject prompt");
  expectEqual(secondFlow.guardPromptInjected, false, "second flow does not inject guard prompt");
  expectEqual(secondFlow.automaticRecoveryDenied, false, "consumed second flow has no active automatic denial");
  expectEqual(secondFlow.guardBypassedForUserIntervention, false, "consumed second flow has no guard bypass");
  expectEqual(secondFlow.nonrecoverableConsumptionRecorded, false, "second flow does not re-record consumption");
  expectEqual(secondFlow.promptBlocks.length, 0, "second flow has no prompt blocks");
  expectEqual(secondFlow.stderrEvents.length, 0, "second flow emits no recovery events");

  process.stdout.write(JSON.stringify({
    ok: true,
    first_prompt_injected: firstFlow.promptInjected,
    first_automatic_recovery_denied: firstFlow.automaticRecoveryDenied,
    guarded_nonrecoverable_bypasses_guard: guardedNonrecoverableFlow.guardBypassedForUserIntervention,
    first_nonrecoverable_consumption_recorded: firstFlow.nonrecoverableConsumptionRecorded,
    repeat_pressure_cleared_after_prompt: repeatedPressureAfterPrompt.latestRecoveryRepeatCount === 0,
    action_family_in_stderr: firstFlow.stderrEvents.every((line) => line.includes("action_family=user_intervention")),
    second_feedback_consumed: secondFeedback.consumed ?? false,
    second_prompt_reinjected: secondFlow.promptInjected,
  }) + "\n");
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
