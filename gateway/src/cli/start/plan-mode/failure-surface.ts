import type {
  PlanFailureDecision,
  PlanFailurePhase,
} from "../plan-failure-policy";
import type { RunStartPlanTurnOptions } from "./contract";
import { PLAN_QUALITY_GUARD_BLOCKED_CODE } from "./constants";
import { isEnvTruthy } from "./env";
import { renderPlanSurface } from "./info-surface";
import { buildPlanSavedToHint } from "./plan-preview";

export interface PlanTurnDiagnosticStderr {
  writeStderr(message: string): void;
  flush(): void;
}

export function shouldRenderCompactPlanFailureSurface(
  diagnosticsMode?: RunStartPlanTurnOptions["diagnosticsMode"],
): boolean {
  if (isEnvTruthy(process.env.GROBOT_PLAN_STATUS_VERBOSE)
    || isEnvTruthy(process.env.GROBOT_PLAN_FAILURE_VERBOSE)) {
    return false;
  }
  if (diagnosticsMode === "verbose" || diagnosticsMode === "trace") {
    return false;
  }
  return true;
}

function isCompactPlanFailureMachineLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("[runtime-route] failed attempts=")
    || trimmed.startsWith("[runtime-route] all provider circuits are OPEN")
    || trimmed.startsWith("runtime failed:");
}

export function createPlanTurnDiagnosticStderr(input: {
  writeStderr: (message: string) => void;
  compactFailureSurface: boolean;
}): PlanTurnDiagnosticStderr {
  if (!input.compactFailureSurface) {
    return {
      writeStderr: input.writeStderr,
      flush: () => undefined,
    };
  }

  let buffered = "";
  const forwardLine = (line: string, suffix: string): void => {
    if (isCompactPlanFailureMachineLine(line)) {
      return;
    }
    input.writeStderr(`${line}${suffix}`);
  };

  return {
    writeStderr: (message: string): void => {
      buffered += message;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
        forwardLine(normalizedLine, "\n");
      }
    },
    flush: (): void => {
      if (!buffered) {
        return;
      }
      const line = buffered.endsWith("\r") ? buffered.slice(0, -1) : buffered;
      buffered = "";
      forwardLine(line, "");
    },
  };
}

function formatCompactPlanFailureReason(input: {
  exitCode: number;
  failureDecision: PlanFailureDecision;
}): string {
  const providerName = input.failureDecision.providerName?.trim();
  const errorClass = input.failureDecision.errorClass?.trim();
  const errorLabel = errorClass ? `（${formatCompactErrorClass(errorClass)}）` : "";
  if (input.failureDecision.reason === "provider_runtime_failure" && providerName) {
    return `通道 ${providerName} 不可用${errorLabel}。`;
  }
  if (providerName) {
    return `运行时在 ${providerName} 失败${errorLabel}。`;
  }
  return `运行时退出码 ${String(input.exitCode)}。`;
}

function formatCompactErrorClass(errorClass: string): string {
  switch (errorClass) {
    case "upstream_connect_failed":
      return "上游连接失败";
    case "timeout":
      return "请求超时";
    case "rate_limited":
      return "请求限流";
    default:
      return errorClass.replace(/_/g, " ");
  }
}

function formatCompactDiagnosticHint(context: "failure" | "review" | "quality_guard"): string {
  switch (context) {
    case "failure":
      return "详细日志可查看通道、退出码和策略字段。";
    case "review":
      return "详细日志可查看完整评审发现。";
    case "quality_guard":
      return "详细日志可查看质量门禁模式、级别和来源。";
  }
}

function buildCompactPlanFailureSurface(input: {
  phase: PlanFailurePhase;
  workDir: string;
  planPath?: string;
  exitCode: number;
  failureDecision: PlanFailureDecision;
}): string {
  const isApplying = input.phase === "applying";
  const title = isApplying ? "计划实现失败" : "计划更新失败";
  const savedToHint = buildPlanSavedToHint({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  const stateLine = isApplying
    ? "计划仍可用。修复问题后，再回复“开始实现计划”。"
    : '计划草稿已保留，计划模式仍处于开启状态。直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。';
  const nextLine = input.failureDecision.reason === "provider_runtime_failure"
    ? "接下来 修复模型通道配置，或切换到可用模型后重试。"
    : "接下来 先定位运行时失败，再重试计划步骤。";
  const detailLines: string[] = [];
  if (savedToHint) {
    detailLines.push(savedToHint);
  }
  detailLines.push(
    `原因 ${formatCompactPlanFailureReason({
      exitCode: input.exitCode,
      failureDecision: input.failureDecision,
    })}`,
    stateLine,
    nextLine,
    formatCompactDiagnosticHint("failure"),
  );
  return renderPlanSurface({
    title,
    rows: [
      {
        title: "运行时未完成",
        detailLines,
      },
    ],
  });
}

function formatCompactPlanReviewFinding(finding: {
  code: string;
  section?: string;
}): string {
  const section = finding.section ? `${finding.section}: ` : "";
  switch (finding.code) {
    case "placeholder_detected":
      return `${section}将占位符替换为具体细节。`;
    case "validation_missing_command":
      return `${section}增加真实命令或明确的手工验证步骤。`;
    case "validation_missing_expected_result":
      return `${section}写明预期验证结果。`;
    case "risk_missing_item":
      return `${section}写出具体失败模式。`;
    case "risk_too_vague":
      return `${section}把风险写具体，不要只写泛化描述。`;
    case "rollback_missing_item":
      return `${section}增加可执行的回滚或恢复步骤。`;
    case "rollback_too_vague":
      return `${section}把回滚动作写成可执行步骤。`;
    case "goal_too_vague":
      return `${section}把目标写到可验证。`;
    case "scope_in_missing_items":
      return `${section}列出明确纳入范围的文件或模块。`;
    case "scope_out_missing_items":
      return `${section}列出明确不做的边界。`;
    default:
      return `${section}${finding.code.replace(/_/g, " ")}。`;
  }
}

function compactPlanReviewFindingPriority(code: string): number {
  switch (code) {
    case "validation_missing_command":
      return 0;
    case "validation_missing_expected_result":
      return 1;
    case "risk_missing_item":
    case "risk_too_vague":
      return 2;
    case "rollback_missing_item":
    case "rollback_too_vague":
      return 3;
    case "goal_too_vague":
      return 4;
    case "scope_in_missing_items":
    case "scope_out_missing_items":
      return 5;
    case "placeholder_detected":
      return 6;
    default:
      return 9;
  }
}

function buildCompactPlanReviewFailureSurface(input: {
  reviewCode: string;
  blocked: boolean;
  findings: readonly { code: string; section?: string; message: string }[];
}): string {
  const headline = input.blocked ? "计划确认被阻止" : "计划还没准备好";
  const orderedFindings = [...input.findings].sort((left, right) =>
    compactPlanReviewFindingPriority(left.code) - compactPlanReviewFindingPriority(right.code),
  );
  const fixes = orderedFindings
    .slice(0, 4)
    .map((finding) => `修复 ${formatCompactPlanReviewFinding(finding)}`);
  const omitted = input.findings.length > fixes.length
    ? [`还有 ${String(input.findings.length - fixes.length)} 条发现已在精简模式隐藏。`]
    : [];
  return renderPlanSurface({
    title: headline,
    rows: [
      {
        title: "执行前计划需要更具体的范围、验证和回滚细节。",
        detailLines: [
          ...fixes,
          ...omitted,
          "接下来 继续完善计划，然后再回复“开始实现计划”。",
          formatCompactDiagnosticHint("review"),
        ],
      },
    ],
  });
}

export function formatReviewFindings(findings: readonly { code: string; section?: string; message: string }[]): string {
  if (findings.length === 0) {
    return "none";
  }
  return findings
    .map((item) => `${item.code}:${item.section ?? "global"}:${item.message}`)
    .join(" | ");
}

export function writePlanReviewFailureSurface(input: {
  reviewCode: string;
  planId: string;
  compactFailureSurface: boolean;
  review: {
    blocked: boolean;
    findings: readonly { code: string; section?: string; message: string }[];
  };
  writeStderr(message: string): void;
}): void {
  if (input.compactFailureSurface) {
    input.writeStderr(
      buildCompactPlanReviewFailureSurface({
        reviewCode: input.reviewCode,
        blocked: input.review.blocked,
        findings: input.review.findings,
      }),
    );
    return;
  }

  input.writeStderr(
    `[plan-review] code=${input.reviewCode} plan_id=${input.planId} findings=${formatReviewFindings(input.review.findings)}\n\n`,
  );
  input.writeStderr(
    `[plan-review-diagnostics] ${JSON.stringify({
      code: input.reviewCode,
      blocked: input.review.blocked,
      findings_count: input.review.findings.length,
      findings: input.review.findings.map((item) => ({
        code: item.code,
        section: item.section ?? "global",
      })),
    })}\n`,
  );
}

export function writePlanQualityGuardBlockedSurface(input: {
  qualityGuardMode: string;
  guardLevel: string;
  guardReason: string;
  compactFailureSurface: boolean;
  writeStderr(message: string): void;
}): void {
  if (input.compactFailureSurface) {
    input.writeStderr(
      renderPlanSurface({
        title: "计划质量门禁阻止执行",
        rows: [
          {
            title: `原因 ${input.guardReason}`,
            detailLines: [
              "接下来 继续完善计划，直到质量门禁不再阻断。",
              formatCompactDiagnosticHint("quality_guard"),
            ],
          },
        ],
      }),
    );
    return;
  }
  input.writeStderr(
    `[plan] code=${PLAN_QUALITY_GUARD_BLOCKED_CODE} apply blocked by quality guard (mode=${input.qualityGuardMode}, level=${input.guardLevel}): ${input.guardReason}\n`,
  );
}

export function writePlanFailureSurface(input: {
  phase: PlanFailurePhase;
  planId: string;
  workDir: string;
  planPath?: string;
  exitCode: number;
  compactFailureSurface: boolean;
  failureDecision: PlanFailureDecision;
  writeStderr(message: string): void;
}): void {
  if (input.compactFailureSurface) {
    input.writeStderr(
      buildCompactPlanFailureSurface({
        phase: input.phase,
        workDir: input.workDir,
        planPath: input.planPath,
        exitCode: input.exitCode,
        failureDecision: input.failureDecision,
      }),
    );
    return;
  }

  const prefix = input.phase === "applying" ? "[plan] apply failed" : "[plan] turn failed";
  input.writeStderr(
    `${prefix} plan_id=${input.planId} exit_code=${String(input.exitCode)} policy_reason=${input.failureDecision.reason} diagnostic=${input.failureDecision.diagnosticCode}${input.failureDecision.errorClass ? ` error_class=${input.failureDecision.errorClass}` : ""}\n`,
  );
}
