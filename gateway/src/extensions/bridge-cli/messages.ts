import { PLAN_EXECUTION_REPLY } from "../../cli/start/plan-state";
import type { BridgePlanPhase, BridgePlanStatus } from "./types";
import {
  currentPlanView,
  formatBridgePlanPath,
  resolvePlanRecommendation,
} from "./plan-view";

function humanizeBridgePlanStatus(status: BridgePlanStatus | undefined): string {
  switch (status) {
    case "draft":
      return "草稿";
    case "blocked":
      return "被阻止";
    case "review_failed":
      return "需继续完善";
    case "ready":
      return "待确认";
    case "approved":
      return "已确认";
    case "applying":
      return "执行中";
    case "apply_failed":
      return "执行失败";
    case "applied":
      return "已执行";
    case "discarded":
      return "已丢弃";
    default:
      return "未开始";
  }
}

function humanizeBridgePlanPhase(phase: BridgePlanPhase | undefined): string {
  switch (phase) {
    case "drafting":
      return "规划中";
    case "awaiting_decision":
      return "待确认";
    case "applying":
      return "执行中";
    default:
      return "未开始";
  }
}

function humanizeBridgePlanFailure(event: string | undefined): string | undefined {
  switch (event) {
    case "plan_apply_failed":
      return "计划执行失败";
    case "plan_review_failed":
      return "计划评审未通过";
    case "plan_review_blocked":
      return "计划评审被阻止";
    default:
      return event ? "最近一次计划流程失败" : undefined;
  }
}

function humanizeBridgeVerificationStatus(status: "pending" | "passed" | "failed"): string {
  switch (status) {
    case "passed":
      return "已通过";
    case "failed":
      return "未通过";
    case "pending":
    default:
      return "待验证";
  }
}

export function buildBridgePlanEnteredMessage(input: {
  goal?: string;
  planPath?: string;
  workDir: string;
}): string {
  const lines = [
    "● 已进入 plan mode",
  ];
  const goal = input.goal?.trim();
  if (goal) {
    lines.push(`  目标: ${goal}`);
  }
  const displayPath = formatBridgePlanPath({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  if (displayPath) {
    lines.push(`  计划文件: ${displayPath}`);
  }
  lines.push(
    "  Grobot 正在探索并设计实现方案。",
    "  确认计划前，plan mode 只会读取和规划。",
    "",
    "直接输入补充内容继续完善，或发送 /plan open 查看计划。",
    `确认后回复“${PLAN_EXECUTION_REPLY}”即可执行。`,
  );
  return lines.join("\n");
}

export function buildBridgePlanStatusMessage(input: {
  plan: ReturnType<typeof currentPlanView>;
  workDir: string;
  nextAction: {
    action: string;
    reason: string;
  };
}): string {
  const { plan, nextAction } = input;
  const lines: string[] = [];
  if (plan.mode !== "plan_only") {
    if (!plan.latest_plan_status && !plan.latest_failure_event) {
      return [
        "● 当前没有活跃计划",
        "  使用 /plan <goal> 开始规划。",
        "",
        `下一步: ${nextAction.action}`,
      ].join("\n");
    }
    lines.push("● 最近计划状态");
    lines.push(`  状态: ${humanizeBridgePlanStatus(plan.latest_plan_status)}`);
    const latestFailure = humanizeBridgePlanFailure(plan.latest_failure_event);
    if (latestFailure) {
      lines.push(`  最近失败: ${latestFailure}`);
    }
    if (plan.latest_verification_status) {
      lines.push(`  验证: ${humanizeBridgeVerificationStatus(plan.latest_verification_status)}`);
    }
    lines.push("", `下一步: ${nextAction.action}`);
    return lines.join("\n");
  }

  lines.push("● 当前计划");
  const displayPath = formatBridgePlanPath({
    workDir: input.workDir,
    planPath: plan.active_plan_path,
  });
  if (displayPath) {
    lines.push(`  计划文件: ${displayPath}`);
  }
  if (plan.active_plan_title) {
    lines.push(`  标题: ${plan.active_plan_title}`);
  }
  lines.push(
    `  状态: ${humanizeBridgePlanStatus(plan.active_plan_status)}`,
    `  阶段: ${humanizeBridgePlanPhase(plan.active_plan_phase)}`,
  );
  if (typeof plan.plan_quality_score === "number") {
    lines.push(`  计划质量: ${String(plan.plan_quality_score)}/${plan.plan_quality_grade ?? "未评级"}`);
  }
  const latestFailure = humanizeBridgePlanFailure(plan.latest_failure_event);
  if (latestFailure) {
    lines.push(`  最近失败: ${latestFailure}`);
  }
  if (plan.latest_verification_status) {
    lines.push(`  验证: ${humanizeBridgeVerificationStatus(plan.latest_verification_status)}`);
  }
  lines.push(
    "",
    `下一步: ${nextAction.action}`,
    "直接输入补充内容继续完善，或发送 /plan open 查看计划。",
  );
  return lines.join("\n");
}

export function buildBridgePlanApplyInProgressMessage(): string {
  return [
    "● 计划正在执行中",
    "  请等待当前执行完成；需要停止时发送 /interrupt。",
  ].join("\n");
}

export function buildBridgePlanRecoveredLockMessage(reportMessage: string): string {
  const normalizedReport = reportMessage.trim();
  const header = [
    "● 已恢复计划执行锁",
    "  上次执行锁已过期，已安全恢复。",
  ].join("\n");
  return normalizedReport ? `${header}\n\n${normalizedReport}` : header;
}

export function buildBridgePlanGuardDeniedMessage(input: {
  workDir: string;
  planPath?: string;
}): string {
  const lines = [
    "● 已补充到当前计划",
  ];
  const displayPath = formatBridgePlanPath({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  if (displayPath) {
    lines.push(`  计划文件: ${displayPath}`);
  }
  lines.push(
    "  plan mode 仍在规划阶段，未执行代码。",
    "",
    `继续输入补充内容完善计划；确认后回复“${PLAN_EXECUTION_REPLY}”即可执行。`,
  );
  return lines.join("\n");
}

export function buildBridgeUnsupportedPlanCommandMessage(): string {
  return [
    "● 不支持这个 /plan 子命令",
    "  可用: /plan、/plan <goal>、/plan open。",
  ].join("\n");
}

export function buildPlanStatusPayload(workDir: string, sessionId: string): Record<string, unknown> {
  const plan = currentPlanView(workDir, sessionId);
  const nextAction = resolvePlanRecommendation(plan);
  return {
    status: "ok",
    assistant_message: buildBridgePlanStatusMessage({
      plan,
      workDir,
      nextAction,
    }),
    recommended_next_action: nextAction.action,
    recommendation_reason: nextAction.reason,
    report: null,
    plan,
  };
}

export function formatReviewFindings(findings: readonly { code: string; section?: string; message: string }[]): string {
  if (findings.length === 0) {
    return "none";
  }
  return findings
    .map((item) => `${item.code}:${item.section ?? "global"}:${item.message}`)
    .join(" | ");
}
