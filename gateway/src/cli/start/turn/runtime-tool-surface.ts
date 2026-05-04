import {
  adaptRuntimeToolContextForRecovery,
  buildRuntimeToolContextForMessage,
} from "../../../tools/runtime/default-enabled-tools";
import { type RuntimeToolContext } from "../../../models/types";
import { buildRuntimeToolRecoveryDecision } from "../../../tools/runtime/tool-recovery-decision";
import { formatRuntimeToolRecoveryGateFields } from "../../../tools/runtime/tool-recovery-readiness-gate";
import {
  applyRuntimeToolSurfaceAdaptationGuard,
  readRuntimeToolSurfaceAdaptationState,
} from "../../../tools/runtime/tool-surface-adaptation-state";
import { readRuntimeToolSurfaceMetrics } from "../../../tools/runtime/tool-events";
import { nowIso } from "./time";

export function prepareRuntimeToolSurfaceForTurn(input: {
  workDir: string;
  runtimeToolContext: RuntimeToolContext | undefined;
  userText: string;
}) {
  const metrics = readRuntimeToolSurfaceMetrics(input.workDir);
  const adaptationSnapshot = readRuntimeToolSurfaceAdaptationState(input.workDir);
  const startedAtIso = nowIso();
  const recoveryDecision = buildRuntimeToolRecoveryDecision({
    metrics,
    adaptationSnapshot,
    nowMs: Date.parse(startedAtIso),
  });
  const feedback = recoveryDecision.feedback;
  const gate = recoveryDecision.gate;
  const baseContext = buildRuntimeToolContextForMessage(input.runtimeToolContext, input.userText);
  const rawContext = adaptRuntimeToolContextForRecovery({
    context: baseContext,
    recoveryFeedback: feedback,
    recoveryGate: gate,
    userMessage: input.userText,
  });
  const contextForTurn = applyRuntimeToolSurfaceAdaptationGuard({
    baseContext,
    result: rawContext,
    snapshot: adaptationSnapshot,
  });

  return {
    startedAtIso,
    recoveryFeedback: feedback,
    recoveryGate: gate,
    contextForTurn,
    diagnostics: buildRuntimeToolSurfaceDiagnostics({
      contextForTurn,
      recoveryGate: gate,
    }),
  };
}

function buildRuntimeToolSurfaceDiagnostics(input: {
  contextForTurn: ReturnType<typeof applyRuntimeToolSurfaceAdaptationGuard>;
  recoveryGate: ReturnType<typeof buildRuntimeToolRecoveryDecision>["gate"];
}): string[] {
  const diagnostics: string[] = [];
  const adaptation = input.contextForTurn.adaptation;
  const guard = input.contextForTurn.guard;
  if (adaptation.active) {
    diagnostics.push(
      `[tool-surface] event=adapted from=${adaptation.fromProfile} to=${adaptation.appliedProfile} source=${adaptation.source ?? "<none>"} stage=${adaptation.recoveryStage ?? "<none>"} tool=${adaptation.recoveryToolName ?? "<none>"} error_class=${adaptation.recoveryErrorClass ?? "<none>"} recoverable=${adaptation.recoveryRecoverable === null ? "<unknown>" : String(adaptation.recoveryRecoverable)} auto_adaptation_blocked=${adaptation.autoAdaptationBlocked ? "true" : "false"}\n`,
    );
    return diagnostics;
  }
  if (adaptation.autoAdaptationBlocked) {
    diagnostics.push(
      `[tool-surface] event=adaptation_blocked reason=${adaptation.reason} from=${adaptation.fromProfile} applied=${adaptation.appliedProfile} recommended=${adaptation.recommendedProfile ?? "<none>"} stage=${adaptation.recoveryStage ?? "<none>"} tool=${adaptation.recoveryToolName ?? "<none>"} error_class=${adaptation.recoveryErrorClass ?? "<none>"} recoverable=${adaptation.recoveryRecoverable === null ? "<unknown>" : String(adaptation.recoveryRecoverable)} auto_adaptation_blocked=true\n`,
    );
    if (input.recoveryGate.blocking) {
      diagnostics.push(
        `[tool-recovery-gate] event=blocked ${formatRuntimeToolRecoveryGateFields(input.recoveryGate)} attention_tool=${input.recoveryGate.attentionToolName ?? "<none>"} attention_error_class=${input.recoveryGate.attentionErrorClass ?? "<none>"}\n`,
      );
    }
    return diagnostics;
  }
  if (guard.active) {
    diagnostics.push(
      `[tool-surface] event=adaptation_guard reason=${guard.reason} blocked_profile=${guard.blockedProfile ?? "<none>"} matching_failures=${String(guard.matchingFailureCount)} recent_profiles=${guard.recentProfileSequence.join(",") || "<empty>"}\n`,
    );
  }
  return diagnostics;
}
