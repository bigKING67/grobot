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
      return "Draft";
    case "blocked":
      return "Blocked";
    case "review_failed":
      return "Needs refinement";
    case "ready":
      return "Awaiting approval";
    case "approved":
      return "Approved";
    case "applying":
      return "Applying";
    case "apply_failed":
      return "Apply failed";
    case "applied":
      return "Applied";
    case "discarded":
      return "Discarded";
    default:
      return "Not started";
  }
}

function humanizeBridgePlanPhase(phase: BridgePlanPhase | undefined): string {
  switch (phase) {
    case "drafting":
      return "Planning";
    case "awaiting_decision":
      return "Awaiting approval";
    case "applying":
      return "Applying";
    default:
      return "Not started";
  }
}

function humanizeBridgePlanFailure(event: string | undefined): string | undefined {
  switch (event) {
    case "plan_apply_failed":
      return "Plan apply failed";
    case "plan_review_failed":
      return "Plan review failed";
    case "plan_review_blocked":
      return "Plan review blocked";
    default:
      return event ? "Latest plan flow failed" : undefined;
  }
}

function humanizeBridgeVerificationStatus(status: "pending" | "passed" | "failed"): string {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "pending":
    default:
      return "Pending";
  }
}

export function buildBridgePlanEnteredMessage(input: {
  goal?: string;
  planPath?: string;
  workDir: string;
}): string {
  const lines = [
    "Plan mode entered",
    "• Planning started",
  ];
  const goal = input.goal?.trim();
  if (goal) {
    lines.push(`  ⎿  goal ${goal}`);
  }
  const displayPath = formatBridgePlanPath({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  if (displayPath) {
    lines.push(`  ⎿  plan file ${displayPath}`);
  }
  lines.push(
    "  ⎿  Grobot is exploring and drafting an implementation plan.",
    "  ⎿  Plan mode stays read-only until approval.",
    "",
    "Type more details to refine, or use /plan open to view the plan.",
    `Reply "${PLAN_EXECUTION_REPLY}" after approval to execute.`,
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
        "No active plan",
        "• Use /plan <goal> to start planning.",
        `  ⎿  next ${nextAction.action}`,
      ].join("\n");
    }
    lines.push("Recent plan status");
    lines.push(`• status ${humanizeBridgePlanStatus(plan.latest_plan_status)}`);
    const latestFailure = humanizeBridgePlanFailure(plan.latest_failure_event);
    if (latestFailure) {
      lines.push(`  ⎿  latest failure ${latestFailure}`);
    }
    if (plan.latest_verification_status) {
      lines.push(`  ⎿  validation ${humanizeBridgeVerificationStatus(plan.latest_verification_status)}`);
    }
    lines.push(`  ⎿  next ${nextAction.action}`);
    return lines.join("\n");
  }

  lines.push("Current plan");
  const displayPath = formatBridgePlanPath({
    workDir: input.workDir,
    planPath: plan.active_plan_path,
  });
  if (displayPath) {
    lines.push(`• plan file ${displayPath}`);
  }
  if (plan.active_plan_title) {
    lines.push(`  ⎿  title ${plan.active_plan_title}`);
  }
  lines.push(
    `  ⎿  status ${humanizeBridgePlanStatus(plan.active_plan_status)}`,
    `  ⎿  phase ${humanizeBridgePlanPhase(plan.active_plan_phase)}`,
  );
  if (typeof plan.plan_quality_score === "number") {
    lines.push(`  ⎿  plan quality ${String(plan.plan_quality_score)}/${plan.plan_quality_grade ?? "unrated"}`);
  }
  const latestFailure = humanizeBridgePlanFailure(plan.latest_failure_event);
  if (latestFailure) {
    lines.push(`  ⎿  latest failure ${latestFailure}`);
  }
  if (plan.latest_verification_status) {
    lines.push(`  ⎿  validation ${humanizeBridgeVerificationStatus(plan.latest_verification_status)}`);
  }
  lines.push(
    `  ⎿  next ${nextAction.action}`,
    `  ⎿  Type more details to refine, or use /plan open to view the plan.`,
  );
  return lines.join("\n");
}

export function buildBridgePlanApplyInProgressMessage(): string {
  return [
    "Plan is applying",
    "• Wait for the current apply to finish; use /interrupt to stop.",
  ].join("\n");
}

export function buildBridgePlanRecoveredLockMessage(reportMessage: string): string {
  const normalizedReport = reportMessage.trim();
  const header = [
    "Plan apply lock recovered",
    "• Previous apply lock expired and was recovered safely.",
  ].join("\n");
  return normalizedReport ? `${header}\n\n${normalizedReport}` : header;
}

export function buildBridgePlanGuardDeniedMessage(input: {
  workDir: string;
  planPath?: string;
}): string {
  const lines = [
    "Added to current plan",
  ];
  const displayPath = formatBridgePlanPath({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  if (displayPath) {
    lines.push(`• plan file ${displayPath}`);
  }
  lines.push(
    "  ⎿  Plan mode is still planning; no code was executed.",
    "",
    `Keep typing details to refine the plan; reply "${PLAN_EXECUTION_REPLY}" after approval to execute.`,
  );
  return lines.join("\n");
}

export function buildBridgeUnsupportedPlanCommandMessage(): string {
  return [
    "Unsupported /plan subcommand",
    "• Use /plan, /plan <goal>, or /plan open.",
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
