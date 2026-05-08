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
  const errorLabel = errorClass ? ` (${formatCompactErrorClass(errorClass)})` : "";
  if (input.failureDecision.reason === "provider_runtime_failure" && providerName) {
    return `Provider ${providerName} is unavailable${errorLabel}.`;
  }
  if (providerName) {
    return `Runtime failed on ${providerName}${errorLabel}.`;
  }
  return `Runtime exit code ${String(input.exitCode)}.`;
}

function formatCompactErrorClass(errorClass: string): string {
  switch (errorClass) {
    case "upstream_connect_failed":
      return "upstream connection failed";
    case "timeout":
      return "request timeout";
    case "rate_limited":
      return "rate limited";
    default:
      return errorClass.replace(/_/g, " ");
  }
}

function formatCompactDiagnosticHint(context: "failure" | "review" | "quality_guard"): string {
  switch (context) {
    case "failure":
      return "Verbose logs include provider, exit code, and policy fields.";
    case "review":
      return "Verbose logs include full review findings.";
    case "quality_guard":
      return "Verbose logs include quality gate mode, level, and source.";
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
  const title = isApplying ? "Plan implementation failed" : "Plan update failed";
  const savedToHint = buildPlanSavedToHint({
    workDir: input.workDir,
    planPath: input.planPath,
  });
  const stateLine = isApplying
    ? "The plan is still available. Fix the issue, then reply Implement the plan."
    : 'Plan draft kept and plan mode remains active. Type more details to refine it, or use "/plan open" to edit the draft.';
  const decisionHint = input.failureDecision.hint?.trim();
  const nextLine = decisionHint
    ? `Next: ${decisionHint}`
    : input.failureDecision.reason === "provider_runtime_failure"
    ? "Next: fix model provider config or switch to an available model, then retry."
    : "Next: diagnose the runtime failure, then retry the plan step.";
  const detailLines: string[] = [];
  if (savedToHint) {
    detailLines.push(savedToHint);
  }
  detailLines.push(
    `reason ${formatCompactPlanFailureReason({
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
        title: "Runtime did not finish",
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
      return `${section}Replace placeholders with concrete details.`;
    case "validation_missing_command":
      return `${section}Add real commands or explicit manual validation steps.`;
    case "validation_missing_expected_result":
      return `${section}State the expected validation result.`;
    case "risk_missing_item":
      return `${section}Add concrete failure modes.`;
    case "risk_too_vague":
      return `${section}Make risks specific; avoid generic descriptions.`;
    case "rollback_missing_item":
      return `${section}Add executable rollback or recovery steps.`;
    case "rollback_too_vague":
      return `${section}Turn rollback actions into executable steps.`;
    case "goal_too_vague":
      return `${section}Make the goal verifiable.`;
    case "scope_in_missing_items":
      return `${section}List files or modules explicitly in scope.`;
    case "scope_out_missing_items":
      return `${section}List explicit out-of-scope boundaries.`;
    default:
      return `${section}${finding.code.replace(/_/g, " ")}.`;
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
  const headline = input.blocked ? "Plan confirmation blocked" : "Plan is not ready";
  const orderedFindings = [...input.findings].sort((left, right) =>
    compactPlanReviewFindingPriority(left.code) - compactPlanReviewFindingPriority(right.code),
  );
  const fixes = orderedFindings
    .slice(0, 4)
    .map((finding) => `Fix ${formatCompactPlanReviewFinding(finding)}`);
  const omitted = input.findings.length > fixes.length
    ? [`${String(input.findings.length - fixes.length)} more findings hidden in compact mode.`]
    : [];
  return renderPlanSurface({
    title: headline,
    rows: [
      {
        title: "Plan needs more concrete scope, validation, and rollback details before execution.",
        detailLines: [
          ...fixes,
          ...omitted,
          "Next: refine the plan, then reply Implement the plan.",
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
        title: "Plan quality gate blocked execution",
        rows: [
          {
            title: `reason ${input.guardReason}`,
            detailLines: [
              "Next: refine the plan until the quality gate no longer blocks.",
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
