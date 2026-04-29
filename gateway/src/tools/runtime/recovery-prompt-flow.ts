import type { RuntimeToolSurfaceAdaptation } from "./default-enabled-tools";
import {
  formatRuntimeToolRecoveryEscalationFields,
  type RuntimeToolRecoveryFeedback,
} from "./tool-events";
import {
  buildRuntimeToolSurfaceAdaptationGuardPrompt,
  recordRuntimeToolNonRecoverableInterventionPrompt,
  recordRuntimeToolSurfaceRecoveryConsumption,
  type RuntimeToolSurfaceAdaptationGuard,
} from "./tool-surface-adaptation-state";

export interface RuntimeToolRecoveryPromptFlowResult {
  promptBlocks: string[];
  stderrEvents: string[];
  promptInjected: boolean;
  guardPromptInjected: boolean;
  automaticRecoveryDenied: boolean;
  guardBypassedForUserIntervention: boolean;
  nonrecoverableConsumptionRecorded: boolean;
  guardConsumptionRecorded: boolean;
}

function formatRuntimeToolRecoveryActionFields(feedback: RuntimeToolRecoveryFeedback): string {
  return [
    `action_family=${feedback.actionFamily ?? "<none>"}`,
    `action_reason=${feedback.actionReason ?? "<none>"}`,
  ].join(" ");
}

export function applyRuntimeToolRecoveryPromptFlow(input: {
  workDir: string;
  recoveryFeedback: RuntimeToolRecoveryFeedback;
  guard: RuntimeToolSurfaceAdaptationGuard;
  adaptation: RuntimeToolSurfaceAdaptation;
  nowIso: string;
  traceId?: string;
}): RuntimeToolRecoveryPromptFlowResult {
  const promptBlocks: string[] = [];
  const stderrEvents: string[] = [];
  let promptInjected = false;
  let guardPromptInjected = false;
  const automaticRecoveryDenied = input.recoveryFeedback.active
    && (input.recoveryFeedback.requiresUserIntervention || input.recoveryFeedback.recoverable === false);
  const guardBypassedForUserIntervention = automaticRecoveryDenied && input.guard.active;
  let nonrecoverableConsumptionRecorded = false;
  let guardConsumptionRecorded = false;
  const recoveryEscalationFields = formatRuntimeToolRecoveryEscalationFields(input.recoveryFeedback);
  const recoveryActionFields = formatRuntimeToolRecoveryActionFields(input.recoveryFeedback);

  if (input.recoveryFeedback.active && input.recoveryFeedback.requiresUserIntervention) {
    stderrEvents.push(
      `[tool-recovery] event=requires_user_intervention stage=${input.recoveryFeedback.stage ?? "<none>"} action=${input.recoveryFeedback.recommendedNextAction ?? "<none>"} ${recoveryActionFields} tool=${input.recoveryFeedback.toolName ?? "<none>"} error_class=${input.recoveryFeedback.errorClass ?? "<none>"} auto_adaptation_blocked=${input.adaptation.autoAdaptationBlocked ? "true" : "false"} ${recoveryEscalationFields}\n`,
    );
    stderrEvents.push(
      `[tool-recovery] event=automatic_recovery_denied reason=requires_user_intervention auto_retry_allowed=false auto_adaptation_allowed=false guard_bypassed=${guardBypassedForUserIntervention ? "true" : "false"} action=${input.recoveryFeedback.recommendedNextAction ?? "<none>"} ${recoveryActionFields} tool=${input.recoveryFeedback.toolName ?? "<none>"} error_class=${input.recoveryFeedback.errorClass ?? "<none>"} recoverable=${input.recoveryFeedback.recoverable === null ? "<unknown>" : String(input.recoveryFeedback.recoverable)} ${recoveryEscalationFields}\n`,
    );
    if (guardBypassedForUserIntervention) {
      stderrEvents.push(
        `[tool-recovery] event=surface_guard_bypassed_for_user_intervention guard_reason=${input.guard.reason} blocked_profile=${input.guard.blockedProfile ?? "<none>"} action=${input.recoveryFeedback.recommendedNextAction ?? "<none>"} ${recoveryActionFields} tool=${input.recoveryFeedback.toolName ?? "<none>"} error_class=${input.recoveryFeedback.errorClass ?? "<none>"}\n`,
      );
    }
  }

  if (input.recoveryFeedback.active && input.guard.active && !automaticRecoveryDenied) {
    const guardPromptBlock = buildRuntimeToolSurfaceAdaptationGuardPrompt({
      guard: input.guard,
      recoveryFeedback: input.recoveryFeedback,
    });
    if (guardPromptBlock) {
      promptBlocks.push(guardPromptBlock);
      guardPromptInjected = true;
    }
    const consumption = recordRuntimeToolSurfaceRecoveryConsumption({
      workDir: input.workDir,
      guard: input.guard,
      recoveryFeedback: input.recoveryFeedback,
      traceId: input.traceId,
      nowIso: input.nowIso,
    });
    guardConsumptionRecorded = consumption.recorded;
    stderrEvents.push(
      `[tool-recovery] event=prompt_hint_guarded guard_reason=${input.guard.reason} suppressed_action=${input.recoveryFeedback.recommendedNextAction ?? "<none>"} ${recoveryActionFields} tool=${input.recoveryFeedback.toolName ?? "<none>"} error_class=${input.recoveryFeedback.errorClass ?? "<none>"} recoverable=${input.recoveryFeedback.recoverable === null ? "<unknown>" : String(input.recoveryFeedback.recoverable)} requires_user_intervention=${input.recoveryFeedback.requiresUserIntervention ? "true" : "false"} ${recoveryEscalationFields}\n`,
    );
    return {
      promptBlocks,
      stderrEvents,
      promptInjected,
      guardPromptInjected,
      automaticRecoveryDenied,
      guardBypassedForUserIntervention,
      nonrecoverableConsumptionRecorded,
      guardConsumptionRecorded,
    };
  }

  if (input.recoveryFeedback.active) {
    promptBlocks.push(input.recoveryFeedback.promptBlock);
    promptInjected = true;
    stderrEvents.push(
      `[tool-recovery] event=prompt_hint_injected stage=${input.recoveryFeedback.stage ?? "<none>"} severity=${input.recoveryFeedback.severity} action=${input.recoveryFeedback.recommendedNextAction ?? "<none>"} ${recoveryActionFields} tool=${input.recoveryFeedback.toolName ?? "<none>"} error_class=${input.recoveryFeedback.errorClass ?? "<none>"} recoverable=${input.recoveryFeedback.recoverable === null ? "<unknown>" : String(input.recoveryFeedback.recoverable)} requires_user_intervention=${input.recoveryFeedback.requiresUserIntervention ? "true" : "false"} ${recoveryEscalationFields}\n`,
    );
    if (input.recoveryFeedback.requiresUserIntervention) {
      const consumption = recordRuntimeToolNonRecoverableInterventionPrompt({
        workDir: input.workDir,
        recoveryFeedback: input.recoveryFeedback,
        traceId: input.traceId,
        nowIso: input.nowIso,
      });
      nonrecoverableConsumptionRecorded = consumption.recorded;
      if (consumption.recorded) {
        stderrEvents.push(
          `[tool-recovery] event=nonrecoverable_intervention_prompted action=${input.recoveryFeedback.recommendedNextAction ?? "<none>"} ${recoveryActionFields} tool=${input.recoveryFeedback.toolName ?? "<none>"} error_class=${input.recoveryFeedback.errorClass ?? "<none>"} consumed_at=${consumption.record?.consumedAt ?? "<none>"} ${recoveryEscalationFields}\n`,
        );
      }
    }
  }

  return {
    promptBlocks,
    stderrEvents,
    promptInjected,
    guardPromptInjected,
    automaticRecoveryDenied,
    guardBypassedForUserIntervention,
    nonrecoverableConsumptionRecorded,
    guardConsumptionRecorded,
  };
}
