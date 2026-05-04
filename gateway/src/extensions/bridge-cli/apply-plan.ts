import { readFileSync } from "node:fs";
import { runGatewayTurn } from "../../orchestration/main";
import {
  appendPlanEvent,
  approvePlanArtifact,
  buildPlanApplyPrompt,
  evaluatePlanQuality,
  evaluatePlanQualityGuard,
  evaluatePlanQualityTrend,
  loadActivePlanArtifact,
  recoverStaleApprovedPlan,
  recordPlanReviewResult,
  resolvePlanQualityGuardMode,
  resolvePlanQualityGuardPolicy,
  reviewPlanContent,
  updatePlanArtifactStatus,
} from "../../cli/start/plan-artifact";
import { resolveBridgeApplyFailurePolicy } from "../bridge-plan-failure-policy";
import type { BridgeInput, BridgePayloadResult } from "./types";
import {
  PLAN_ERROR_APPLY_BLOCKED,
  PLAN_ERROR_APPLY_EXEC_FAILED,
  PLAN_ERROR_APPROVAL_FAILED,
  PLAN_ERROR_NO_ACTIVE,
  PLAN_ERROR_QUALITY_GUARD_BLOCKED,
  PLAN_ERROR_REVIEW_BLOCKED,
  PLAN_ERROR_REVIEW_FAILED,
  PLAN_ERROR_REVIEW_PLAN_NOT_FOUND,
  PLAN_ERROR_SET_APPLYING_FAILED,
} from "./types";
import {
  buildBridgePlanApplyInProgressMessage,
  buildBridgePlanRecoveredLockMessage,
  formatReviewFindings,
} from "./messages";
import { currentPlanView } from "./plan-view";

function readApprovedPlanContent(snapshotPath: string | undefined, fallback: string): string {
  if (!snapshotPath) {
    return fallback;
  }
  try {
    const snapshot = readFileSync(snapshotPath, "utf8");
    if (snapshot.trim().length > 0) {
      return snapshot;
    }
  } catch {
    // fallback to active content when snapshot is unavailable.
  }
  return fallback;
}

export async function applyActivePlan(input: {
  activeInitial: NonNullable<ReturnType<typeof loadActivePlanArtifact>>;
  extra: string;
  source: "bridge";
  workDir: string;
  sessionId: string;
  bridgeInput: BridgeInput;
}): Promise<BridgePayloadResult> {
  const {
    activeInitial,
    extra,
    source,
    workDir,
    sessionId,
    bridgeInput,
  } = input;
  const recovered = recoverStaleApprovedPlan(workDir, sessionId, {
    source,
    expectedPlanId: activeInitial.entry.plan_id,
  });
  const active = recovered.recovered ? loadActivePlanArtifact(workDir, sessionId) : activeInitial;
  if (!active) {
    return {
      code: 1,
      payload: {
        status: "error",
        error_code: PLAN_ERROR_NO_ACTIVE,
        detail: "no active plan to apply",
        plan: currentPlanView(workDir, sessionId),
      },
    };
  }
  if (active.entry.status === "applying") {
    appendPlanEvent(workDir, sessionId, {
      event: "plan_apply_idempotent_hit",
      plan_id: active.entry.plan_id,
      source,
      detail: "status=applying",
    });
    return {
      code: 0,
      payload: {
        status: "ok",
        assistant_message: buildBridgePlanApplyInProgressMessage(),
        report: null,
        plan: currentPlanView(workDir, sessionId),
      },
    };
  }
  if (active.entry.status === "applied" || active.entry.status === "discarded") {
    return {
      code: 1,
      payload: {
        status: "error",
        error_code: PLAN_ERROR_APPLY_BLOCKED,
        detail: `apply blocked by status=${active.entry.status}`,
        plan: currentPlanView(workDir, sessionId),
      },
    };
  }
  const quality = evaluatePlanQuality(active.content);
  const qualityTrend = evaluatePlanQualityTrend({
    workDir,
    sessionId,
    currentPlanId: active.entry.plan_id,
    currentScore: quality.score,
  });
  const qualityGuardRuntime = resolvePlanQualityGuardPolicy({
    workDir,
  });
  const qualityGuard = evaluatePlanQualityGuard({
    workDir,
    sessionId,
    currentPlanId: active.entry.plan_id,
    quality,
    trend: qualityTrend,
    policy: qualityGuardRuntime.policy,
  });
  const qualityGuardMode = resolvePlanQualityGuardMode(
    process.env.GROBOT_PLAN_QUALITY_GUARD_MODE,
    qualityGuardRuntime.policy.defaults.mode,
  );
  if (qualityGuardMode === "strict" && qualityGuard.level === "critical") {
    appendPlanEvent(workDir, sessionId, {
      event: "plan_apply_blocked",
      plan_id: active.entry.plan_id,
      source,
      detail: [
        "reason=quality_guard_critical",
        `guard_mode=${qualityGuardMode}`,
        `guard_profile=${qualityGuardRuntime.policy.profile}`,
        `guard_source=${qualityGuardRuntime.source}`,
        `guard_level=${qualityGuard.level}`,
        `guard_reason=${qualityGuard.reason.replace(/\s+/g, "_")}`,
      ].join(" "),
    });
    return {
      code: 2,
      payload: {
        status: "error",
        error_code: PLAN_ERROR_QUALITY_GUARD_BLOCKED,
        detail: `apply blocked by quality guard: mode=${qualityGuardMode} level=${qualityGuard.level} reason=${qualityGuard.reason}`,
        plan: currentPlanView(workDir, sessionId),
      },
    };
  }
  let approvedHash = active.entry.approved_hash;
  let approvalTicketId = active.entry.approval_ticket_id;
  let approvedSnapshotPath = active.entry.approved_snapshot_path;
  const shouldReviewAndApprove = active.entry.status !== "approved"
    || !approvedHash
    || !approvalTicketId;
  if (shouldReviewAndApprove) {
    const review = reviewPlanContent(active.content);
    const reviewedEntry = recordPlanReviewResult(
      workDir,
      sessionId,
      active.entry.plan_id,
      review,
      source,
    );
    if (!reviewedEntry) {
      return {
        code: 1,
        payload: {
          status: "error",
          error_code: PLAN_ERROR_REVIEW_PLAN_NOT_FOUND,
          detail: `review failed, plan not found: ${active.entry.plan_id}`,
          plan: currentPlanView(workDir, sessionId),
        },
      };
    }
    if (!review.ok) {
      return {
        code: 2,
        payload: {
          status: "error",
          error_code: review.blocked ? PLAN_ERROR_REVIEW_BLOCKED : PLAN_ERROR_REVIEW_FAILED,
          detail: `[plan-review] blocked=${review.blocked ? "yes" : "no"} findings=${formatReviewFindings(review.findings)}`,
          review_blocked: review.blocked,
          review_findings: review.findings.map((item) => ({
            code: item.code,
            section: item.section,
            message: item.message,
          })),
          plan: currentPlanView(workDir, sessionId),
        },
      };
    }

    const approval = approvePlanArtifact(workDir, sessionId, active.entry.plan_id, {
      approvedBy: source,
      source,
    });
    if (!approval.approved || !approval.entry || !approval.planHash || !approval.ticketId) {
      return {
        code: 1,
        payload: {
          status: "error",
          error_code: PLAN_ERROR_APPROVAL_FAILED,
          detail: `approval failed plan_id=${active.entry.plan_id}`,
          plan: currentPlanView(workDir, sessionId),
        },
      };
    }
    approvedHash = approval.planHash;
    approvalTicketId = approval.ticketId;
    approvedSnapshotPath = approval.snapshotPath;
  }

  const applying = updatePlanArtifactStatus(workDir, sessionId, active.entry.plan_id, "applying");
  if (!applying) {
    return {
      code: 1,
      payload: {
        status: "error",
        error_code: PLAN_ERROR_SET_APPLYING_FAILED,
        detail: `failed to set applying status for ${active.entry.plan_id}`,
        plan: currentPlanView(workDir, sessionId),
      },
    };
  }

  try {
    if (!approvedHash || !approvalTicketId) {
      return {
        code: 1,
        payload: {
          status: "error",
          error_code: PLAN_ERROR_APPROVAL_FAILED,
          detail: `approval metadata missing plan_id=${active.entry.plan_id}`,
          plan: currentPlanView(workDir, sessionId),
        },
      };
    }
    const approvedPlanContent = readApprovedPlanContent(approvedSnapshotPath, active.content);
    const report = await runGatewayTurn(
      buildPlanApplyPrompt({
        approvedPlanContent,
        approvedHash,
        ticketId: approvalTicketId,
        extra,
      }),
      bridgeInput.session,
      bridgeInput.context,
      bridgeInput.migration,
    );
    updatePlanArtifactStatus(workDir, sessionId, active.entry.plan_id, "applied");
    appendPlanEvent(workDir, sessionId, {
      event: "plan_apply_succeeded",
      plan_id: active.entry.plan_id,
      source,
      detail: "plan applied and exited plan_only",
    });
    appendPlanEvent(workDir, sessionId, {
      event: "plan_verification_pending",
      plan_id: active.entry.plan_id,
      source,
      detail: "verification_status=pending",
    });
    return {
      code: 0,
      payload: {
        status: "ok",
        assistant_message: recovered.recovered
          ? buildBridgePlanRecoveredLockMessage(report.assistantMessage)
          : report.assistantMessage,
        report,
        plan: currentPlanView(workDir, sessionId),
      },
    };
  } catch (error) {
    updatePlanArtifactStatus(workDir, sessionId, active.entry.plan_id, "apply_failed");
    const detail = error instanceof Error ? error.message : String(error);
    const failurePolicy = resolveBridgeApplyFailurePolicy(detail);
    appendPlanEvent(workDir, sessionId, {
      event: "plan_apply_failed",
      plan_id: active.entry.plan_id,
      source,
      detail: [
        detail,
        `policy_action=${failurePolicy.policyAction}`,
        `policy_reason=${failurePolicy.policyReason}`,
        `diagnostic_code=${failurePolicy.diagnosticCode}`,
        failurePolicy.providerName ? `provider=${failurePolicy.providerName}` : "",
        failurePolicy.errorClass ? `class=${failurePolicy.errorClass}` : "",
      ]
        .filter((item) => item.length > 0)
        .join(" "),
    });
    return {
      code: 1,
      payload: {
        status: "error",
        error_code: PLAN_ERROR_APPLY_EXEC_FAILED,
        detail,
        policy_action: failurePolicy.policyAction,
        policy_reason: failurePolicy.policyReason,
        diagnostic_code: failurePolicy.diagnosticCode,
        error_class: failurePolicy.errorClass,
        provider: failurePolicy.providerName,
        plan: currentPlanView(workDir, sessionId),
      },
    };
  }
}
