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
export const PLAN_DIRECT_REFINE_ACTION = "继续完善当前计划（直接输入补充内容）";

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
      ? `；${input.planQualityGuardReason.trim()}`
      : "";
    const topHint = typeof input.planQualityTopHint === "string" && input.planQualityTopHint.trim().length > 0
      ? `；优先处理：${input.planQualityTopHint.trim()}`
      : "";
    return {
      action: PLAN_DIRECT_REFINE_ACTION,
      reason: `quality guard=critical，先补齐计划再进入执行${guardReason}${topHint}`,
    };
  }
  if (typeof input.planQualityScore === "number" && input.planQualityScore < 70) {
    const topHint = typeof input.planQualityTopHint === "string" && input.planQualityTopHint.trim().length > 0
      ? `，优先处理：${input.planQualityTopHint.trim()}`
      : "";
    return {
      action: PLAN_DIRECT_REFINE_ACTION,
      reason: `plan 质量分仅 ${String(input.planQualityScore)}，建议先补齐计划细节${topHint}`,
    };
  }
  if (input.mode === "plan_only") {
    if (planPhase === "applying") {
      return {
        action: "/plan",
        reason: "执行正在进行中，可用 /plan 查看当前状态",
      };
    }
    if (planPhase === "drafting" || planPhase === undefined) {
      return {
        action: PLAN_DIRECT_REFINE_ACTION,
        reason: "当前计划仍在整理阶段；直接补充内容即可继续完善，直到进入待决策态",
      };
    }
    return {
      action: PLAN_EXECUTION_REPLY,
      reason: "当前计划已进入待决策态；直接回复“开始实现计划”或选择确认项即可开始执行",
    };
  }
  if (input.status === "applied") {
    return {
      action: "/plan <goal>",
      reason: "当前计划已执行完成，可开启新目标继续规划",
    };
  }
  if (input.status === "apply_failed") {
    return {
      action: "/plan <goal>",
      reason: "上一次执行失败，建议结合失败结果重新规划后再执行",
    };
  }
  return {
    action: "/plan <goal>",
    reason: "当前无活跃 plan",
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
    return "查看计划状态";
  }
  if (actionId === "open_file") {
    return "打开计划文件";
  }
  if (actionId === "execute") {
    return "开始实现";
  }
  if (actionId === "refine") {
    return "继续完善计划";
  }
  if (actionId === "enter") {
    return "创建/完善计划";
  }
  return "计划操作";
}
