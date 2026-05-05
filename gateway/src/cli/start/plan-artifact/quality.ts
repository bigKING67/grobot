import {
  reviewPlanContent,
} from "./review";
import type {
  PlanQualityGuardSummary,
  PlanQualityRepairAction,
  PlanQualitySummary,
  PlanQualityTrendSummary,
  PlanReviewFinding,
} from "./types";

function scorePenaltyForFindingCode(code: string): number {
  switch (code) {
    case "proposed_plan_empty":
      return 40;
    case "unresolved_question":
      return 35;
    case "missing_section":
    case "proposed_plan_missing_section":
      return 20;
    case "placeholder_detected":
      return 18;
    case "empty_section":
      return 15;
    case "proposed_plan_too_short":
      return 12;
    case "milestones_missing_items":
    case "milestones_missing_done_criteria":
    case "milestones_missing_validation":
    case "milestones_missing_rollback":
    case "validation_missing_items":
    case "validation_missing_command":
    case "validation_missing_expected_result":
    case "risk_missing_item":
    case "rollback_missing_item":
      return 10;
    case "goal_too_vague":
    case "scope_in_missing_items":
    case "scope_out_missing_items":
    case "risk_too_vague":
    case "rollback_too_vague":
      return 8;
    default:
      return 8;
  }
}

function toPlanQualityGrade(score: number): "A" | "B" | "C" | "D" | "E" {
  if (score >= 90) {
    return "A";
  }
  if (score >= 80) {
    return "B";
  }
  if (score >= 65) {
    return "C";
  }
  if (score >= 50) {
    return "D";
  }
  return "E";
}

function rewriteHintForFinding(finding: PlanReviewFinding): string | undefined {
  switch (finding.code) {
    case "missing_section":
    case "proposed_plan_missing_section":
      return `Fill in section ${finding.section ?? "global"} and add executable items`;
    case "placeholder_detected":
      return `Remove placeholders and fill in concrete implementation details for ${finding.section ?? "global"}`;
    case "unresolved_question":
      return `Clarify unresolved questions before re-reviewing ${finding.section ?? "global"}`;
    case "milestones_missing_done_criteria":
      return "Add a done-when criterion to each milestone";
    case "milestones_missing_validation":
      return "Add validation steps and commands to each milestone";
    case "milestones_missing_rollback":
      return "Add rollback plans to each milestone";
    case "validation_missing_items":
      return "Validation needs at least one executable command and expected result";
    case "validation_missing_command":
      return "Add real commands or spell out manual validation steps in Validation";
    case "validation_missing_expected_result":
      return "Add expected results for every Validation item";
    case "risk_missing_item":
    case "risk_too_vague":
      return "Write specific risks in Risk & Rollback instead of vague labels";
    case "rollback_missing_item":
    case "rollback_too_vague":
      return "Write executable rollback actions in Risk & Rollback";
    case "goal_too_vague":
      return "Make Goal describe the expected behavior change and done state";
    case "scope_in_missing_items":
    case "scope_out_missing_items":
      return `Add explicit list items for ${finding.section ?? "Scope"}`;
    case "proposed_plan_too_short":
      return "Add key changes, validation, and rollback details to avoid an overly short plan";
    default:
      return undefined;
  }
}

export function evaluatePlanQuality(planContent: string): PlanQualitySummary {
  const review = reviewPlanContent(planContent);
  const penalty = review.findings.reduce((total, finding) => total + scorePenaltyForFindingCode(finding.code), 0);
  const score = Math.max(0, 100 - Math.min(95, penalty));
  const grade = toPlanQualityGrade(score);
  const rewriteHints = review.findings
    .map((item) => rewriteHintForFinding(item))
    .filter((item): item is string => typeof item === "string")
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 4);
  const recommendation = review.ok
    ? "Quality is good enough to enter approval or execution"
    : review.blocked
      ? "Blocking items exist; clarify unresolved questions before continuing"
      : "Fix high-priority findings before re-reviewing";
  return {
    score,
    grade,
    findingCount: review.findings.length,
    blocked: review.blocked,
    recommendation,
    rewriteHints,
  };
}

function priorityRank(priority: PlanQualityRepairAction["priority"]): number {
  if (priority === "p0") {
    return 0;
  }
  if (priority === "p1") {
    return 1;
  }
  return 2;
}

function compactRepairActions(actions: PlanQualityRepairAction[]): PlanQualityRepairAction[] {
  const deduped = new Map<string, PlanQualityRepairAction>();
  for (const action of actions) {
    if (!deduped.has(action.id)) {
      deduped.set(action.id, action);
    }
  }
  return [...deduped.values()]
    .sort((left, right) => {
      const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return left.title.localeCompare(right.title);
    })
    .slice(0, 6);
}

function summarizeMissingSections(findings: readonly PlanReviewFinding[]): string[] {
  const sections: string[] = [];
  for (const finding of findings) {
    if (
      finding.code !== "missing_section"
      && finding.code !== "proposed_plan_missing_section"
      && finding.code !== "empty_section"
    ) {
      continue;
    }
    const section = finding.section?.trim();
    if (!section) {
      continue;
    }
    if (!sections.includes(section)) {
      sections.push(section);
    }
  }
  return sections;
}

function hasAnyFindingCode(findings: readonly PlanReviewFinding[], codes: readonly string[]): boolean {
  return findings.some((item) => codes.includes(item.code));
}

function resolveMilestoneRepairHint(findings: readonly PlanReviewFinding[]): string {
  const parts: string[] = [];
  if (hasAnyFindingCode(findings, ["milestones_missing_items"])) {
    parts.push("Add milestone entries");
  }
  if (hasAnyFindingCode(findings, ["milestones_missing_done_criteria"])) {
    parts.push("Add done-when criteria");
  }
  if (hasAnyFindingCode(findings, ["milestones_missing_validation"])) {
    parts.push("Add validation steps");
  }
  if (hasAnyFindingCode(findings, ["milestones_missing_rollback"])) {
    parts.push("Add rollback plans");
  }
  return parts.join(" + ");
}

export function buildPlanQualityRepairActions(args: {
  planContent: string;
  quality: PlanQualitySummary;
  trend: PlanQualityTrendSummary;
  guard: PlanQualityGuardSummary;
}): PlanQualityRepairAction[] {
  const review = reviewPlanContent(args.planContent);
  const actions: PlanQualityRepairAction[] = [];
  const missingSections = summarizeMissingSections(review.findings);
  if (missingSections.length > 0) {
    const sections = missingSections.join("、");
    actions.push({
      id: "repair_sections",
      priority: "p0",
      title: `Fill key sections (${sections})`,
      command: `Update the current plan: fill ${sections} and add executable items`,
      rationale: "Missing or empty sections lower the quality score and increase approval risk",
    });
  }
  if (hasAnyFindingCode(review.findings, ["unresolved_question"])) {
    actions.push({
      id: "resolve_unresolved_questions",
      priority: "p0",
      title: "Resolve unresolved questions first",
      command: "Update the current plan: answer unresolved questions first, then rewrite Goal / Scope / Risk",
      rationale: "Unresolved questions are blocking risks and should not enter approval or execution",
    });
  }
  if (hasAnyFindingCode(review.findings, ["placeholder_detected"])) {
    actions.push({
      id: "remove_placeholders",
      priority: "p1",
      title: "Remove placeholders and replace them with real steps",
      command: "Update the current plan: remove __REQUIRED__ / TODO and write concrete implementation and acceptance",
      rationale: "Placeholder text lowers quality and weakens executability",
    });
  }
  if (hasAnyFindingCode(review.findings, ["scope_in_missing_items", "scope_out_missing_items", "goal_too_vague"])) {
    actions.push({
      id: "repair_goal_scope",
      priority: "p1",
      title: "Clarify goal and scope boundaries",
      command: "Update the current plan: make Goal a verifiable behavior change and list concrete Scope In/Out items",
      rationale: "Unclear goals and scope force the execution phase to guess boundaries",
    });
  }
  const milestoneRepairHint = resolveMilestoneRepairHint(review.findings);
  if (milestoneRepairHint.length > 0) {
    actions.push({
      id: "repair_milestones",
      priority: "p1",
      title: "Fix milestone structure completeness",
      command: `Update the current plan: add done-when criteria, validation, and rollback for each milestone; current gaps: ${milestoneRepairHint}`,
      rationale: "Missing criteria, validation, or rollback reduces execution reliability",
    });
  }
  if (hasAnyFindingCode(review.findings, [
    "validation_missing_items",
    "validation_missing_command",
    "validation_missing_expected_result",
  ])) {
    actions.push({
      id: "repair_validation",
      priority: "p1",
      title: "Fill Validation with executable commands and expected results",
      command: "Update the current plan: add real validation commands or manual steps, and write the expected result for each",
      rationale: "Without executable validation and expected results, the plan cannot close the loop",
    });
  }
  if (hasAnyFindingCode(review.findings, [
    "risk_missing_item",
    "risk_too_vague",
    "rollback_missing_item",
    "rollback_too_vague",
  ])) {
    actions.push({
      id: "repair_risk_rollback",
      priority: "p1",
      title: "Add concrete risks and rollback actions",
      command: "Update the current plan: rewrite Risk & Rollback as specific failure modes and executable recovery actions",
      rationale: "Vague risks may pass approval but leave the apply phase without a recovery path",
    });
  }
  if (hasAnyFindingCode(review.findings, ["proposed_plan_too_short", "proposed_plan_empty"])) {
    actions.push({
      id: "expand_plan_detail",
      priority: "p2",
      title: "Expand plan detail depth",
      command: "Update the current plan: add key changes, validation matrix, and risk/rollback boundaries",
      rationale: "Overly short plans usually lack executable detail and often fail in apply",
    });
  }
  if (actions.length === 0 && args.guard.level !== "healthy") {
    actions.push({
      id: "guard_watch_reinforce",
      priority: args.guard.level === "critical" ? "p0" : "p1",
      title: "Reinforce the specific guard risk",
      command: "Update the current plan: explain this round's score drop and the improvement steps, then re-review",
      rationale: `Current guard=${args.guard.level}; improve plan stability first`,
    });
  }
  if (actions.length === 0 && args.trend.trend === "down") {
    actions.push({
      id: "trend_down_recover",
      priority: "p2",
      title: "Restore details lost from the previous round",
      command: "Update the current plan: compare with the previous round and restore removed validation and rollback items",
      rationale: "When quality trends down, restore key details before approval",
    });
  }
  if (actions.length === 0 && args.quality.score < 80) {
    actions.push({
      id: "raise_quality_baseline",
      priority: "p2",
      title: "Raise the plan quality baseline",
      command: "Update the current plan: add dependency boundaries, execution steps, and regression validation",
      rationale: "The current quality score still has room to improve; optimize before approval",
    });
  }
  return compactRepairActions(actions);
}
