import {
  PROPOSED_PLAN_CLOSE_TAG,
  PROPOSED_PLAN_OPEN_TAG,
  REQUIRED_PLAN_SECTIONS,
} from "./constants";
import { nowIsoUtc } from "./fs-utils";
import type {
  PlanReviewFinding,
  PlanReviewResult,
} from "./types";

function stripMarkdownNoise(sectionBody: string): string[] {
  return sectionBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter((line) => line.length > 0);
}

function extractSection(markdown: string, sectionTitle: string): string | undefined {
  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexp = new RegExp(`(^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`);
  const match = regexp.exec(markdown);
  if (!match) {
    return undefined;
  }
  return match[2] ?? "";
}

function findPlaceholder(text: string): string | undefined {
  const placeholders = [
    "__REQUIRED__",
    "待补充",
    "TBD",
    "TODO",
    "请补充",
    "to be filled",
  ];
  for (const token of placeholders) {
    if (text.toLowerCase().includes(token.toLowerCase())) {
      return token;
    }
  }
  return undefined;
}

function hasUnresolvedQuestion(text: string): boolean {
  return (
    /\[ASK\]/i.test(text) ||
    /待确认|待决定/i.test(text) ||
    /\?\?/g.test(text)
  );
}

export function extractLatestProposedPlanBlock(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const blocks: string[] = [];
  let activeBlockLines: string[] | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === PROPOSED_PLAN_OPEN_TAG) {
      activeBlockLines = [];
      continue;
    }
    if (trimmed === PROPOSED_PLAN_CLOSE_TAG) {
      const candidate = activeBlockLines?.join("\n").trim();
      if (candidate) {
        blocks.push(candidate);
      }
      activeBlockLines = undefined;
      continue;
    }
    if (activeBlockLines) {
      activeBlockLines.push(line);
    }
  }
  const unterminatedCandidate = activeBlockLines?.join("\n").trim();
  if (unterminatedCandidate) {
    blocks.push(unterminatedCandidate);
  }
  if (blocks.length === 0) {
    return undefined;
  }
  return blocks[blocks.length - 1];
}

function hasSectionHeading(markdown: string, matcher: RegExp): boolean {
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trimStart().startsWith("##")) {
      continue;
    }
    if (matcher.test(line)) {
      return true;
    }
  }
  return false;
}

function extractSectionByHeadingMatcher(markdown: string, matcher: RegExp): string | undefined {
  const lines = markdown.split(/\r?\n/);
  let collecting = false;
  const bodyLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("##")) {
      if (collecting) {
        break;
      }
      if (matcher.test(trimmed)) {
        collecting = true;
      }
      continue;
    }
    if (collecting) {
      bodyLines.push(line);
    }
  }
  return collecting ? bodyLines.join("\n") : undefined;
}

function hasAllRequiredPlanSections(markdown: string): boolean {
  return REQUIRED_PLAN_SECTIONS.every((sectionName) =>
    typeof extractSection(markdown, sectionName) === "string"
  );
}

function sectionHasListItem(sectionBody: string): boolean {
  return sectionBody
    .split(/\r?\n/)
    .some((line) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(line));
}

function normalizePlanFieldValue(line: string): string {
  const cleaned = line
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .trim();
  const colonIndex = cleaned.search(/[:：]/);
  if (colonIndex >= 0) {
    return cleaned.slice(colonIndex + 1).trim();
  }
  return cleaned;
}

function isVaguePlanFieldValue(valueRaw: string): boolean {
  const value = valueRaw
    .trim()
    .replace(/[。.!！]+$/g, "")
    .trim()
    .toLowerCase();
  if (!value || value.length <= 4) {
    return true;
  }
  return /^(none|n\/a|na|low|minor|unknown|tbd|todo|无|暂无|没有|低|较低|低风险|可控|待定|待补充|按需处理|手动处理|回滚|回退|恢复|revert|rollback)$/.test(value);
}

const VALIDATION_COMMAND_PATTERN =
  /(`[^`]+`|\b(?:npm|pnpm|yarn|bun|cargo|go|pytest|python|node|npx|tsx|deno|make|bash|sh|curl|script|uv|docker|psql|sqlite3|mysql|kubectl)\b|\.\/|\/[A-Za-z0-9._/-]+|手工验证|人工验证|manual verification|manual test|browser check|浏览器验证|截图对比)/i;
const VALIDATION_EXPECTED_RESULT_PATTERN =
  /(预期|expected|expect|通过|passes?|green|成功|should|assert|断言|结果|输出|exit\s*0|exit code\s*0|无报错|不出现)/i;

function hasConcreteValidationSignal(sectionBody: string): boolean {
  return sectionBody
    .split(/\r?\n/)
    .some((line) => VALIDATION_COMMAND_PATTERN.test(line));
}

function hasValidationExpectedResult(sectionBody: string): boolean {
  return VALIDATION_EXPECTED_RESULT_PATTERN.test(sectionBody);
}

function reviewProposedPlanContent(proposedPlanContent: string): PlanReviewResult {
  const findings: PlanReviewFinding[] = [];
  const checkedAt = nowIsoUtc();
  const normalized = proposedPlanContent.trim();
  if (hasAllRequiredPlanSections(normalized)) {
    return reviewStructuredPlanContent(normalized);
  }
  if (!normalized) {
    findings.push({
      code: "proposed_plan_empty",
      section: "proposed_plan",
      message: "提取到的 <proposed_plan> 为空。",
    });
  }
  const placeholder = findPlaceholder(normalized);
  if (placeholder) {
    findings.push({
      code: "placeholder_detected",
      section: "proposed_plan",
      message: `计划仍含占位词(${placeholder})。`,
    });
  }
  if (hasUnresolvedQuestion(normalized)) {
    findings.push({
      code: "unresolved_question",
      section: "proposed_plan",
      message: "计划存在未决问题，需先澄清。",
    });
  }
  if (normalized.length > 0 && normalized.length < 120) {
    findings.push({
      code: "proposed_plan_too_short",
      section: "proposed_plan",
      message: "计划内容过短，无法支撑可执行实现。",
    });
  }
  const hasSummary = hasSectionHeading(normalized, /^##\s*(summary|概要|概述|摘要)\b/i);
  const hasKeyChanges = hasSectionHeading(
    normalized,
    /^##\s*(key changes?|implementation changes?|重要变更|实现变更)\b/i,
  );
  const hasTestPlan = hasSectionHeading(
    normalized,
    /^##\s*(test plan|tests?|test cases?|验证计划|测试计划|测试用例)\b/i,
  );
  const hasAssumptions = hasSectionHeading(
    normalized,
    /^##\s*(assumptions?|默认假设|假设)\b/i,
  );
  if (!hasSummary) {
    findings.push({
      code: "proposed_plan_missing_section",
      section: "Summary",
      message: "缺少 Summary 章节。",
    });
  }
  if (!hasKeyChanges) {
    findings.push({
      code: "proposed_plan_missing_section",
      section: "Key Changes",
      message: "缺少 Key Changes/Implementation Changes 章节。",
    });
  }
  if (!hasTestPlan) {
    findings.push({
      code: "proposed_plan_missing_section",
      section: "Test Plan",
      message: "缺少 Test Plan/Tests 章节。",
    });
  } else {
    const testPlan = extractSectionByHeadingMatcher(
      normalized,
      /^##\s*(test plan|tests?|test cases?|验证计划|测试计划|测试用例)\b/i,
    ) ?? "";
    if (!hasConcreteValidationSignal(testPlan)) {
      findings.push({
        code: "validation_missing_command",
        section: "Test Plan",
        message: "Test Plan 缺少可执行命令或明确的手工验证步骤。",
      });
    }
    if (!hasValidationExpectedResult(testPlan)) {
      findings.push({
        code: "validation_missing_expected_result",
        section: "Test Plan",
        message: "Test Plan 缺少预期结果。",
      });
    }
  }
  if (!hasAssumptions) {
    findings.push({
      code: "proposed_plan_missing_section",
      section: "Assumptions",
      message: "缺少 Assumptions 章节。",
    });
  }
  const blocked = findings.some((item) => item.code === "unresolved_question");
  const ok = findings.length === 0;
  return {
    ok,
    blocked,
    findings,
    checked_at: checkedAt,
  };
}

function reviewStructuredPlanContent(planContent: string): PlanReviewResult {
  const findings: PlanReviewFinding[] = [];
  const checkedAt = nowIsoUtc();
  const sectionMap = new Map<string, string>();

  for (const sectionName of REQUIRED_PLAN_SECTIONS) {
    const body = extractSection(planContent, sectionName);
    if (typeof body !== "string") {
      findings.push({
        code: "missing_section",
        section: sectionName,
        message: `缺少必填章节: ${sectionName}`,
      });
      continue;
    }
    sectionMap.set(sectionName, body);
    const normalizedLines = stripMarkdownNoise(body);
    if (normalizedLines.length === 0) {
      findings.push({
        code: "empty_section",
        section: sectionName,
        message: `章节内容为空: ${sectionName}`,
      });
      continue;
    }
    const placeholder = findPlaceholder(normalizedLines.join("\n"));
    if (placeholder) {
      findings.push({
        code: "placeholder_detected",
        section: sectionName,
        message: `章节仍含占位词(${placeholder}): ${sectionName}`,
      });
    }
    if (hasUnresolvedQuestion(normalizedLines.join("\n"))) {
      findings.push({
        code: "unresolved_question",
        section: sectionName,
        message: `章节存在未决问题，需先澄清: ${sectionName}`,
      });
    }
  }

  const goal = sectionMap.get("Goal");
  if (typeof goal === "string") {
    const goalText = stripMarkdownNoise(goal).join(" ");
    if (goalText.length > 0 && goalText.length < 16) {
      findings.push({
        code: "goal_too_vague",
        section: "Goal",
        message: "Goal 过短，缺少可判断的目标行为变化。",
      });
    }
  }

  for (const sectionName of ["Scope In", "Scope Out"] as const) {
    const sectionBody = sectionMap.get(sectionName);
    if (typeof sectionBody === "string" && !sectionHasListItem(sectionBody)) {
      findings.push({
        code: sectionName === "Scope In" ? "scope_in_missing_items" : "scope_out_missing_items",
        section: sectionName,
        message: `${sectionName} 至少需要 1 条明确列表项。`,
      });
    }
  }

  const milestones = sectionMap.get("Milestones");
  if (typeof milestones === "string") {
    const milestoneLines = milestones.split("\n").filter((line) => /^\s*\d+\.\s+/.test(line));
    if (milestoneLines.length === 0) {
      findings.push({
        code: "milestones_missing_items",
        section: "Milestones",
        message: "Milestones 至少需要 1 条编号里程碑。",
      });
    }
    if (!/完成判据/.test(milestones)) {
      findings.push({
        code: "milestones_missing_done_criteria",
        section: "Milestones",
        message: "Milestones 缺少“完成判据”。",
      });
    }
    if (!/验证/.test(milestones)) {
      findings.push({
        code: "milestones_missing_validation",
        section: "Milestones",
        message: "Milestones 缺少“验证”。",
      });
    }
    if (!/回退/.test(milestones)) {
      findings.push({
        code: "milestones_missing_rollback",
        section: "Milestones",
        message: "Milestones 缺少“回退”。",
      });
    }
  }

  const validation = sectionMap.get("Validation");
  if (typeof validation === "string") {
    const hasValidationItems = validation
      .split("\n")
      .some((line) => /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line));
    if (!hasValidationItems) {
      findings.push({
        code: "validation_missing_items",
        section: "Validation",
        message: "Validation 至少需要 1 条可执行验证项。",
      });
    }
    if (hasValidationItems && !hasConcreteValidationSignal(validation)) {
      findings.push({
        code: "validation_missing_command",
        section: "Validation",
        message: "Validation 缺少真实命令或明确的手工验证步骤。",
      });
    }
    if (hasValidationItems && !hasValidationExpectedResult(validation)) {
      findings.push({
        code: "validation_missing_expected_result",
        section: "Validation",
        message: "Validation 缺少预期结果。",
      });
    }
  }

  const riskRollback = sectionMap.get("Risk & Rollback");
  if (typeof riskRollback === "string") {
    const normalizedLines = stripMarkdownNoise(riskRollback);
    const riskLines = normalizedLines.filter((line) => /^(风险|risk)\s*[:：]/i.test(line));
    const rollbackLines = normalizedLines.filter((line) =>
      /^(回退|rollback|roll back|revert|restore)\s*[:：]/i.test(line)
    );
    if (riskLines.length === 0) {
      findings.push({
        code: "risk_missing_item",
        section: "Risk & Rollback",
        message: "Risk & Rollback 缺少明确“风险:”条目。",
      });
    } else if (riskLines.some((line) => isVaguePlanFieldValue(normalizePlanFieldValue(line)))) {
      findings.push({
        code: "risk_too_vague",
        section: "Risk & Rollback",
        message: "风险描述过于空泛，需要写出具体失败面。",
      });
    }
    if (rollbackLines.length === 0) {
      findings.push({
        code: "rollback_missing_item",
        section: "Risk & Rollback",
        message: "Risk & Rollback 缺少明确“回退:”条目。",
      });
    } else if (rollbackLines.some((line) => isVaguePlanFieldValue(normalizePlanFieldValue(line)))) {
      findings.push({
        code: "rollback_too_vague",
        section: "Risk & Rollback",
        message: "回退描述过于空泛，需要写出可执行恢复动作。",
      });
    }
  }

  const blocked = findings.some((item) => item.code === "unresolved_question");
  const ok = findings.length === 0;
  return {
    ok,
    blocked,
    findings,
    checked_at: checkedAt,
  };
}

export function reviewPlanContent(planContent: string): PlanReviewResult {
  const proposedPlan = extractLatestProposedPlanBlock(planContent);
  if (proposedPlan) {
    return reviewProposedPlanContent(proposedPlan);
  }
  return reviewStructuredPlanContent(planContent);
}
