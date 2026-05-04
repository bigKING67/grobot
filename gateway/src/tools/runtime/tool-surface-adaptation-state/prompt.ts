import type { RuntimeToolRecoveryFeedback } from "../tool-events";
import type { RuntimeToolSurfaceAdaptationGuard } from "./contract";

export function buildRuntimeToolSurfaceAdaptationGuardPrompt(input: {
  guard: RuntimeToolSurfaceAdaptationGuard;
  recoveryFeedback: RuntimeToolRecoveryFeedback;
}): string {
  if (!input.guard.active || !input.recoveryFeedback.active) {
    return "";
  }
  const blockedProfile = input.guard.blockedProfile ?? "<none>";
  const recentProfiles = input.guard.recentProfileSequence.length > 0
    ? input.guard.recentProfileSequence.join(" -> ")
    : "<none>";
  const recoveryStage = input.recoveryFeedback.stage ?? "<none>";
  const recoveryTool = input.recoveryFeedback.toolName ?? "<none>";
  const recoveryErrorClass = input.recoveryFeedback.errorClass ?? "<none>";
  const recoveryAction = input.recoveryFeedback.recommendedNextAction ?? "<none>";
  const rule = (() => {
    switch (input.guard.reason) {
      case "recovered_signal_consumed":
        return "The previous recovery signal already produced a recovered adaptation. Treat that signal as consumed; do not switch tool profiles solely because of it.";
      case "successful_tool_call_consumed":
        return "The previous recovery signal already produced a successful tool call. Treat that signal as consumed; do not repeat stale recovery instructions solely because of it.";
      case "repeated_profile_failure":
        return "The same tool-surface adaptation has failed repeatedly. Do not retry the same surface switch unchanged; use the currently visible tools, reduce scope, or ask the user.";
      case "profile_oscillation":
        return "Recent tool-surface adaptations oscillated without recovery. Stop alternating profiles; pick one grounded strategy from the currently visible tools.";
      default:
        return "The tool-surface adaptation was blocked by guard policy. Do not repeat the guarded recovery path unchanged.";
    }
  })();
  return [
    "[Runtime Tool Surface Guard]",
    `Guard: reason=${input.guard.reason} blocked_profile=${blockedProfile} matching_failures=${String(input.guard.matchingFailureCount)}`,
    `Suppressed recovery hint: stage=${recoveryStage} tool=${recoveryTool} error_class=${recoveryErrorClass} action=${recoveryAction}`,
    `Recent profiles: ${recentProfiles}`,
    `Execution rule: ${rule}`,
  ].join("\n");
}
