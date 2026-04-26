import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { applyRuntimeToolRecoveryPromptFlow } from "../../tools/runtime/recovery-prompt-flow";
import { applyRuntimeToolRecoveryConsumption, readRuntimeToolSurfaceAdaptationState } from "../../tools/runtime/tool-surface-adaptation-state";
import type { RuntimeToolRecoveryFeedback } from "../../tools/runtime/tool-events";
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
    recoverable: false,
    requiresUserIntervention: true,
    promptBlock: "[Runtime Tool Recovery Hint]\nRecent tool issue: stage=ask_user tool=web_scan error_class=config_missing",
    observedAt,
  };
}

const inactiveGuard: RuntimeToolSurfaceAdaptationGuard = {
  active: false,
  reason: "ok",
  blockedProfile: null,
  matchingFailureCount: 0,
  recentProfileSequence: [],
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

const workDir = join("/tmp", `grobot-runtime-tool-recovery-flow-${String(process.pid)}-${String(Date.now())}`);
mkdirSync(workDir, { recursive: true });

try {
  const rawFeedback = activeNonrecoverableFeedback("2026-04-26T00:00:00.000Z");

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
    firstFlow.stderrEvents.some((line) => line.includes("event=prompt_hint_injected")),
    "first flow emits prompt_hint_injected event",
  );
  expect(
    firstFlow.stderrEvents.some((line) => line.includes("event=nonrecoverable_intervention_prompted")),
    "first flow emits nonrecoverable_intervention_prompted event",
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
  expectEqual(secondFlow.nonrecoverableConsumptionRecorded, false, "second flow does not re-record consumption");
  expectEqual(secondFlow.promptBlocks.length, 0, "second flow has no prompt blocks");
  expectEqual(secondFlow.stderrEvents.length, 0, "second flow emits no recovery events");

  process.stdout.write(JSON.stringify({
    ok: true,
    first_prompt_injected: firstFlow.promptInjected,
    first_nonrecoverable_consumption_recorded: firstFlow.nonrecoverableConsumptionRecorded,
    second_feedback_consumed: secondFeedback.consumed ?? false,
    second_prompt_reinjected: secondFlow.promptInjected,
  }) + "\n");
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
