import type {
  RuntimeToolContext,
  ToolSurfaceProfile,
  ToolSurfaceSource,
} from "../../../models/types";
import type { RuntimeToolRecoveryFeedback } from "../tool-events";
import {
  runtimeToolRecoveryGateAdaptationReason,
  type RuntimeToolRecoveryReadinessGateDecision,
} from "../tool-recovery-readiness-gate";
import {
  type RuntimeToolSurfaceAdaptation,
  type RuntimeToolSurfaceAdaptationResult,
} from "./contract";
import { buildRuntimeToolContextForProfile } from "./decision";
import {
  hasBrowserExecutionIntent,
  hasCodeMaintenanceIntent,
  hasContextRetrievalIntent,
  hasMcpExecutionIntent,
  includesAny,
} from "./intent-rules";

function emptyAdaptation(input: {
  context?: RuntimeToolContext;
  reason: string;
  recommendedProfile?: ToolSurfaceProfile | null;
  source?: ToolSurfaceSource | null;
  recoveryFeedback?: RuntimeToolRecoveryFeedback;
  recoveryGate?: RuntimeToolRecoveryReadinessGateDecision;
}): RuntimeToolSurfaceAdaptation {
  const fromProfile = input.context?.toolSurfaceProfile ?? "coding";
  return {
    enabled: true,
    active: false,
    reason: input.reason,
    fromProfile,
    appliedProfile: fromProfile,
    recommendedProfile: input.recommendedProfile ?? null,
    source: input.source ?? null,
    autoAdaptationBlocked: Boolean(
      input.recoveryGate?.blocking
      || (input.recoveryFeedback?.active && input.recoveryFeedback.recoverable === false),
    ),
    recoveryStage: input.recoveryFeedback?.stage ?? null,
    recoveryToolName: input.recoveryFeedback?.toolName ?? null,
    recoveryErrorClass: input.recoveryFeedback?.errorClass ?? null,
    recoveryRecoverable: input.recoveryFeedback?.recoverable ?? null,
    recoveryObservedAt: input.recoveryFeedback?.observedAt ?? null,
  };
}

function inferProfileFromRecovery(input: {
  feedback: RuntimeToolRecoveryFeedback;
  userMessage?: string;
}): ToolSurfaceProfile | undefined {
  const recoveryText = [
    input.feedback.toolName ?? "",
    input.feedback.errorClass ?? "",
    input.feedback.recommendedNextAction ?? "",
  ].join(" ").toLowerCase();
  const unavailableSignal = includesAny(recoveryText, [
    "tool_not_visible",
    "tool_disabled",
    "semantic_tool_unavailable",
  ]);
  if (!unavailableSignal && input.feedback.stage !== "strategy_switch") {
    return undefined;
  }
  const normalizedMessage = (input.userMessage ?? "").toLowerCase();
  if (includesAny(recoveryText, ["web_scan", "web_execute_js"])) {
    if (hasCodeMaintenanceIntent(normalizedMessage) && !hasBrowserExecutionIntent(normalizedMessage)) {
      return undefined;
    }
    return "browser";
  }
  if (includesAny(recoveryText, ["mcp_servers", "mcp_call", "grok-search", "grok_search"])) {
    if (hasCodeMaintenanceIntent(normalizedMessage) && !hasMcpExecutionIntent(normalizedMessage)) {
      return undefined;
    }
    return "mcp";
  }
  if (includesAny(recoveryText, ["semantic_search", "semantic_tool_unavailable"])) {
    if (hasCodeMaintenanceIntent(normalizedMessage) && !hasContextRetrievalIntent(normalizedMessage)) {
      return undefined;
    }
    return "context";
  }

  if (!normalizedMessage) {
    return undefined;
  }
  if (hasBrowserExecutionIntent(normalizedMessage)) {
    return "browser";
  }
  if (hasMcpExecutionIntent(normalizedMessage)) {
    return "mcp";
  }
  if (hasContextRetrievalIntent(normalizedMessage)) {
    return "context";
  }
  return undefined;
}

export function adaptRuntimeToolContextForRecovery(input: {
  context: RuntimeToolContext | undefined;
  recoveryFeedback: RuntimeToolRecoveryFeedback;
  recoveryGate?: RuntimeToolRecoveryReadinessGateDecision;
  userMessage?: string;
  availableTools?: readonly string[];
}): RuntimeToolSurfaceAdaptationResult {
  if (!input.context) {
    return {
      context: undefined,
      adaptation: emptyAdaptation({
        reason: "missing_tool_context",
        recoveryFeedback: input.recoveryFeedback,
        recoveryGate: input.recoveryGate,
      }),
    };
  }
  if (input.recoveryGate?.blocking) {
    return {
      context: input.context,
      adaptation: emptyAdaptation({
        context: input.context,
        reason: runtimeToolRecoveryGateAdaptationReason(input.recoveryGate),
        recoveryFeedback: input.recoveryFeedback,
        recoveryGate: input.recoveryGate,
      }),
    };
  }
  if (!input.recoveryFeedback.active) {
    return {
      context: input.context,
      adaptation: emptyAdaptation({
        context: input.context,
        reason: input.recoveryFeedback.reason,
        recoveryFeedback: input.recoveryFeedback,
        recoveryGate: input.recoveryGate,
      }),
    };
  }
  if (input.recoveryFeedback.recoverable === false) {
    return {
      context: input.context,
      adaptation: emptyAdaptation({
        context: input.context,
        reason: "recovery_requires_user_intervention",
        recoveryFeedback: input.recoveryFeedback,
        recoveryGate: input.recoveryGate,
      }),
    };
  }

  const source = input.context.toolSurfaceSource ?? "fallback";
  if (source === "env" || source === "cli" || source === "config" || source === "debug") {
    return {
      context: input.context,
      adaptation: emptyAdaptation({
        context: input.context,
        reason: `explicit_surface_source_${source}`,
        recoveryFeedback: input.recoveryFeedback,
        recoveryGate: input.recoveryGate,
      }),
    };
  }

  const fromProfile = input.context.toolSurfaceProfile ?? "coding";
  if (fromProfile !== "coding" && fromProfile !== "minimal") {
    return {
      context: input.context,
      adaptation: emptyAdaptation({
        context: input.context,
        reason: `current_profile_${fromProfile}_wins`,
        recoveryFeedback: input.recoveryFeedback,
        recoveryGate: input.recoveryGate,
      }),
    };
  }

  const recommendedProfile = inferProfileFromRecovery({
    feedback: input.recoveryFeedback,
    userMessage: input.userMessage,
  });
  if (!recommendedProfile) {
    return {
      context: input.context,
      adaptation: emptyAdaptation({
        context: input.context,
        reason: "no_safe_profile_for_recovery",
        recoveryFeedback: input.recoveryFeedback,
        recoveryGate: input.recoveryGate,
      }),
    };
  }
  if (recommendedProfile === fromProfile) {
    return {
      context: input.context,
      adaptation: emptyAdaptation({
        context: input.context,
        reason: "already_on_recommended_profile",
        recommendedProfile,
        recoveryFeedback: input.recoveryFeedback,
        recoveryGate: input.recoveryGate,
      }),
    };
  }

  const reason = [
    "recent_recovery_surface_adaptation",
    `tool=${input.recoveryFeedback.toolName ?? "<none>"}`,
    `error_class=${input.recoveryFeedback.errorClass ?? "<none>"}`,
  ].join(" ");
  const adaptedContext = buildRuntimeToolContextForProfile({
    baseContext: input.context,
    profile: recommendedProfile,
    source: "metrics_recovery",
    reason,
    availableTools: input.availableTools,
  });
  return {
    context: adaptedContext,
    adaptation: {
      enabled: true,
      active: true,
      reason,
      fromProfile,
      appliedProfile: recommendedProfile,
      recommendedProfile,
      source: "metrics_recovery",
      autoAdaptationBlocked: false,
      recoveryStage: input.recoveryFeedback.stage,
      recoveryToolName: input.recoveryFeedback.toolName,
      recoveryErrorClass: input.recoveryFeedback.errorClass,
      recoveryRecoverable: input.recoveryFeedback.recoverable,
      recoveryObservedAt: input.recoveryFeedback.observedAt ?? null,
    },
  };
}
