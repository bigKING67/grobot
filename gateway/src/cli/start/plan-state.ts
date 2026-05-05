export type PlanLifecycleStatus =
  | "draft"
  | "blocked"
  | "review_failed"
  | "ready"
  | "approved"
  | "applying"
  | "apply_failed"
  | "applied"
  | "discarded";

export type SessionPlanPhase = "drafting" | "awaiting_decision" | "applying";

export const PLAN_EXECUTION_REPLY = "Implement the plan.";
export const PLAN_DIRECT_REFINE_ACTION = "Refine current plan (type more details)";

export function derivePlanPhaseFromStatus(
  status: PlanLifecycleStatus | undefined,
): SessionPlanPhase | undefined {
  if (status === "draft" || status === "blocked" || status === "review_failed") {
    return "drafting";
  }
  if (status === "ready" || status === "approved" || status === "apply_failed") {
    return "awaiting_decision";
  }
  if (status === "applying") {
    return "applying";
  }
  return undefined;
}

export function resolvePlanStatusRecommendation(input: {
  mode: "normal" | "plan_only";
  status?: PlanLifecycleStatus;
  latestVerificationStatus?: "pending" | "passed" | "failed";
  planQualityScore?: number;
  planQualityTopHint?: string;
  planQualityGuardLevel?: "healthy" | "watch" | "critical";
  planQualityGuardReason?: string;
  interactiveMenuFirst?: boolean;
}): {
  action: string;
  reason: string;
} {
  const planPhase = derivePlanPhaseFromStatus(input.status);
  if (input.planQualityGuardLevel === "critical") {
    const guardReason = typeof input.planQualityGuardReason === "string" && input.planQualityGuardReason.trim().length > 0
      ? `; reason: ${input.planQualityGuardReason.trim()}`
      : "";
    const topHint = typeof input.planQualityTopHint === "string" && input.planQualityTopHint.trim().length > 0
      ? `; prioritize: ${input.planQualityTopHint.trim()}`
      : "";
    return {
      action: PLAN_DIRECT_REFINE_ACTION,
      reason: `Plan quality gate blocked execution; add concrete plan details first${guardReason}${topHint}`,
    };
  }
  if (typeof input.planQualityScore === "number" && input.planQualityScore < 70) {
    const topHint = typeof input.planQualityTopHint === "string" && input.planQualityTopHint.trim().length > 0
      ? `; prioritize: ${input.planQualityTopHint.trim()}`
      : "";
    return {
      action: PLAN_DIRECT_REFINE_ACTION,
      reason: `Plan quality score is only ${String(input.planQualityScore)}; add concrete plan details first${topHint}`,
    };
  }
  if (input.mode === "plan_only") {
    if (planPhase === "applying") {
      return {
        action: "/plan",
        reason: "Implementation is running; use /plan to view current status",
      };
    }
    if (planPhase === "drafting" || planPhase === undefined) {
      return {
        action: PLAN_DIRECT_REFINE_ACTION,
        reason: "The plan is still drafting; type more details to refine it until it is ready",
      };
    }
    return {
      action: PLAN_EXECUTION_REPLY,
      reason: "The plan is ready; reply Implement the plan. or confirm to start implementation",
    };
  }
  if (input.status === "applied") {
    return {
      action: "/plan <goal>",
      reason: "The current plan is complete; start a new goal to plan next",
    };
  }
  if (input.status === "apply_failed") {
    return {
      action: "/plan <goal>",
      reason: "The last implementation failed; replan with the failure result before retrying",
    };
  }
  return {
    action: "/plan <goal>",
    reason: "No active plan",
  };
}

export function resolvePlanStatusRecommendationCommand(actionRaw: string): string {
  const normalized = actionRaw.trim().toLowerCase();
  if (normalized.startsWith("/plan open")) {
    return "/plan open";
  }
  if (normalized === PLAN_EXECUTION_REPLY.toLowerCase() || normalized === "implement the plan") {
    return PLAN_EXECUTION_REPLY;
  }
  if (normalized.startsWith("/plan <goal>")) {
    return "/plan <goal>";
  }
  if (normalized.startsWith("/plan")) {
    return "/plan";
  }
  if (normalized === PLAN_DIRECT_REFINE_ACTION.toLowerCase()) {
    return PLAN_DIRECT_REFINE_ACTION;
  }
  return actionRaw.trim();
}

export type PlanStatusRecommendationActionId =
  | "view_status"
  | "open_file"
  | "execute"
  | "refine"
  | "enter"
  | "unknown";

export function resolvePlanStatusRecommendationActionId(actionRaw: string): PlanStatusRecommendationActionId {
  const command = resolvePlanStatusRecommendationCommand(actionRaw).toLowerCase();
  if (command === "/plan") {
    return "view_status";
  }
  if (command.startsWith("/plan open")) {
    return "open_file";
  }
  if (command === PLAN_EXECUTION_REPLY.toLowerCase()) {
    return "execute";
  }
  if (command === PLAN_DIRECT_REFINE_ACTION.toLowerCase()) {
    return "refine";
  }
  if (command.startsWith("/plan <goal>")) {
    return "enter";
  }
  return "unknown";
}

export function resolvePlanStatusRecommendationLabel(actionRaw: string): string {
  const actionId = resolvePlanStatusRecommendationActionId(actionRaw);
  if (actionId === "view_status") {
    return "View plan status";
  }
  if (actionId === "open_file") {
    return "Open plan file";
  }
  if (actionId === "execute") {
    return "Start implementation";
  }
  if (actionId === "refine") {
    return "Refine plan";
  }
  if (actionId === "enter") {
    return "Create/refine plan";
  }
  return "Plan action";
}
