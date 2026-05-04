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
      return `补齐章节 ${finding.section ?? "global"}，并写明可执行条目`;
    case "placeholder_detected":
      return `移除占位词并补齐 ${finding.section ?? "global"} 的具体实现内容`;
    case "unresolved_question":
      return `先澄清未决问题，再重新评审 ${finding.section ?? "global"}`;
    case "milestones_missing_done_criteria":
      return "每个里程碑增加“完成判据”";
    case "milestones_missing_validation":
      return "每个里程碑增加“验证”步骤与命令";
    case "milestones_missing_rollback":
      return "每个里程碑增加“回退”预案";
    case "validation_missing_items":
      return "Validation 至少补 1 条可执行命令与预期结果";
    case "validation_missing_command":
      return "Validation 补真实命令，或写明手工验证步骤";
    case "validation_missing_expected_result":
      return "Validation 补每条验证的预期结果";
    case "risk_missing_item":
    case "risk_too_vague":
      return "Risk & Rollback 写具体风险，而不是“低/无/可控”";
    case "rollback_missing_item":
    case "rollback_too_vague":
      return "Risk & Rollback 写可执行回退动作";
    case "goal_too_vague":
      return "Goal 写清楚目标行为变化和完成状态";
    case "scope_in_missing_items":
    case "scope_out_missing_items":
      return `补齐 ${finding.section ?? "Scope"} 的明确列表项`;
    case "proposed_plan_too_short":
      return "补充关键改动、验证计划和风险回退，避免过短计划";
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
    ? "质量达标，可进入审批或执行阶段"
    : review.blocked
      ? "存在阻断项，先澄清未决问题再继续"
      : "建议先修复高优先级 findings，再重新评审";
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
    parts.push("补里程碑条目");
  }
  if (hasAnyFindingCode(findings, ["milestones_missing_done_criteria"])) {
    parts.push("补完成判据");
  }
  if (hasAnyFindingCode(findings, ["milestones_missing_validation"])) {
    parts.push("补验证步骤");
  }
  if (hasAnyFindingCode(findings, ["milestones_missing_rollback"])) {
    parts.push("补回退预案");
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
      title: `补齐关键章节（${sections}）`,
      command: `直接补充当前计划：补齐 ${sections}，并给出可执行条目`,
      rationale: "缺失或空章节会显著拉低质量分，并导致审批风险升高",
    });
  }
  if (hasAnyFindingCode(review.findings, ["unresolved_question"])) {
    actions.push({
      id: "resolve_unresolved_questions",
      priority: "p0",
      title: "先消除未决问题再推进",
      command: "直接补充当前计划：先明确未决问题答案，再回写 Goal / Scope / Risk",
      rationale: "未决问题属于阻断类风险，未澄清不应进入审批/执行",
    });
  }
  if (hasAnyFindingCode(review.findings, ["placeholder_detected"])) {
    actions.push({
      id: "remove_placeholders",
      priority: "p1",
      title: "移除占位词并替换为真实步骤",
      command: "直接补充当前计划：移除 __REQUIRED__ / TODO，并写具体实现与验收",
      rationale: "占位文本会触发质量扣分并削弱计划可执行性",
    });
  }
  if (hasAnyFindingCode(review.findings, ["scope_in_missing_items", "scope_out_missing_items", "goal_too_vague"])) {
    actions.push({
      id: "repair_goal_scope",
      priority: "p1",
      title: "补清目标与范围边界",
      command: "直接补充当前计划：把 Goal 写成可判断的行为变化，并为 Scope In/Out 各列具体条目",
      rationale: "目标与范围不清会让执行阶段自行猜边界",
    });
  }
  const milestoneRepairHint = resolveMilestoneRepairHint(review.findings);
  if (milestoneRepairHint.length > 0) {
    actions.push({
      id: "repair_milestones",
      priority: "p1",
      title: "修复里程碑结构完整性",
      command: `直接补充当前计划：为每个里程碑补“完成判据 + 验证 + 回退”；当前缺口：${milestoneRepairHint}`,
      rationale: "里程碑缺少完成判据/验证/回退会直接降低执行可靠性",
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
      title: "补齐 Validation 可执行命令与预期结果",
      command: "直接补充当前计划：增加真实验证命令或手工验证步骤，并写明每条预期结果",
      rationale: "缺少可执行验证与预期结果时，计划无法形成闭环验收",
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
      title: "补具体风险与回退动作",
      command: "直接补充当前计划：把 Risk & Rollback 改成“风险: 具体失败面 / 回退: 可执行恢复动作”",
      rationale: "空泛风险会让审批看起来通过，但 apply 阶段缺少可恢复路径",
    });
  }
  if (hasAnyFindingCode(review.findings, ["proposed_plan_too_short", "proposed_plan_empty"])) {
    actions.push({
      id: "expand_plan_detail",
      priority: "p2",
      title: "扩充计划细节深度",
      command: "直接补充当前计划：补关键改动、验证矩阵、风险与回退边界",
      rationale: "过短计划通常缺少可执行细节，容易在 apply 阶段失败",
    });
  }
  if (actions.length === 0 && args.guard.level !== "healthy") {
    actions.push({
      id: "guard_watch_reinforce",
      priority: args.guard.level === "critical" ? "p0" : "p1",
      title: "针对 guard 风险做定向加固",
      command: "直接补充当前计划：补充本轮降分原因与改进动作，再重新评审",
      rationale: `当前 guard=${args.guard.level}，建议先提升计划稳定性`,
    });
  }
  if (actions.length === 0 && args.trend.trend === "down") {
    actions.push({
      id: "trend_down_recover",
      priority: "p2",
      title: "回补较上轮退化的细节",
      command: "直接补充当前计划：对比上轮计划，补齐被删减的验证与回退项",
      rationale: "质量趋势下滑时应先恢复关键细节，再推进审批",
    });
  }
  if (actions.length === 0 && args.quality.score < 80) {
    actions.push({
      id: "raise_quality_baseline",
      priority: "p2",
      title: "提高计划质量基线",
      command: "直接补充当前计划：补依赖边界、执行步骤与回归验证",
      rationale: "当前质量分仍有提升空间，建议先优化后审批",
    });
  }
  return compactRepairActions(actions);
}
