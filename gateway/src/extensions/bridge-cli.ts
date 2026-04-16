import { readFileSync } from "node:fs";
import { runGatewayTurn } from "../orchestration/main";
import { MigrationOptions, SessionKeyParts } from "../models/types";
import { parsePlanCommand } from "../orchestration/entrypoints/dev-cli/start/plan-command";
import {
  appendPlanEvent,
  appendPlanProgressNote,
  approvePlanArtifact,
  buildPlanApplyPrompt,
  createPlanArtifact,
  loadActivePlanArtifact,
  recoverStaleApprovedPlan,
  recordPlanReviewResult,
  reviewPlanContent,
  updatePlanArtifactStatus,
} from "../orchestration/entrypoints/dev-cli/start/plan-artifact";
import { removeTrailingSlashes } from "../orchestration/entrypoints/dev-cli/services/runtime-paths";

const PLAN_GUARD_CODE = "PLAN_GUARD_DENIED";
const PLAN_ERROR_NO_ACTIVE = "PLAN_NO_ACTIVE";
const PLAN_ERROR_APPLY_BLOCKED = "PLAN_APPLY_STATUS_BLOCKED";
const PLAN_ERROR_REVIEW_PLAN_NOT_FOUND = "PLAN_REVIEW_PLAN_NOT_FOUND";
const PLAN_ERROR_REVIEW_FAILED = "PLAN_REVIEW_FAILED";
const PLAN_ERROR_REVIEW_BLOCKED = "PLAN_REVIEW_BLOCKED";
const PLAN_ERROR_APPROVAL_FAILED = "PLAN_APPROVAL_FAILED";
const PLAN_ERROR_SET_APPLYING_FAILED = "PLAN_SET_APPLYING_FAILED";
const PLAN_ERROR_APPLY_EXEC_FAILED = "PLAN_APPLY_EXEC_FAILED";
const PLAN_ERROR_APPEND_NOTE_FAILED = "PLAN_APPEND_NOTE_FAILED";
const BRIDGE_FATAL_ERROR = "BRIDGE_FATAL";

type BridgePlanStatus =
  | "draft"
  | "blocked"
  | "review_failed"
  | "ready"
  | "approved"
  | "applying"
  | "apply_failed"
  | "applied"
  | "discarded";

interface BridgeInput {
  userMessage: string;
  session: SessionKeyParts;
  context: {
    actorId: string;
    projectId: string;
  };
  workDir?: string;
  migration?: Partial<MigrationOptions>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseJsonInput(raw: string): BridgeInput {
  const parsed = JSON.parse(raw) as unknown;
  if (!isObject(parsed)) {
    throw new Error("bridge input must be an object");
  }
  if (!isString(parsed.userMessage)) {
    throw new Error("userMessage is required");
  }
  if (!isObject(parsed.session)) {
    throw new Error("session is required");
  }
  if (!isObject(parsed.context)) {
    throw new Error("context is required");
  }
  const platform = parsed.session.platform;
  const tenant = parsed.session.tenant;
  const scope = parsed.session.scope;
  const subject = parsed.session.subject;
  if (platform !== "feishu" && platform !== "telegram") {
    throw new Error("session.platform must be feishu or telegram");
  }
  if (scope !== "dm" && scope !== "group") {
    throw new Error("session.scope must be dm or group");
  }
  if (!isString(tenant) || !isString(subject)) {
    throw new Error("session.tenant and session.subject are required");
  }
  if (!isString(parsed.context.actorId) || !isString(parsed.context.projectId)) {
    throw new Error("context.actorId and context.projectId are required");
  }
  const migration = isObject(parsed.migration) ? (parsed.migration as Partial<MigrationOptions>) : undefined;
  const workDir = isString(parsed.workDir) ? parsed.workDir.trim() : undefined;
  return {
    userMessage: parsed.userMessage,
    session: {
      platform,
      tenant,
      scope,
      subject,
    },
    context: {
      actorId: parsed.context.actorId,
      projectId: parsed.context.projectId,
    },
    workDir,
    migration,
  };
}

function resolvePlanSessionId(session: SessionKeyParts): string {
  return `${session.platform}:${session.tenant}:${session.scope}:${session.subject}`;
}

function resolveWorkDir(input: BridgeInput): string {
  if (input.workDir && input.workDir.trim().length > 0) {
    return removeTrailingSlashes(input.workDir.trim());
  }
  return removeTrailingSlashes(process.cwd());
}

function isPlanOnlyStatus(status: BridgePlanStatus): boolean {
  return status !== "applied" && status !== "discarded";
}

function currentPlanView(workDir: string, sessionId: string): {
  mode: "normal" | "plan_only";
  active_plan_id?: string;
  active_plan_status?: BridgePlanStatus;
  active_plan_path?: string;
  active_plan_seq?: number;
  active_plan_title?: string;
  blocked_count?: number;
  review_fail_count?: number;
  approval_ticket_id?: string;
  approved_hash?: string;
  approved_snapshot_path?: string;
} {
  const active = loadActivePlanArtifact(workDir, sessionId);
  if (!active || !isPlanOnlyStatus(active.entry.status)) {
    return {
      mode: "normal",
    };
  }
  return {
    mode: "plan_only",
    active_plan_id: active.entry.plan_id,
    active_plan_status: active.entry.status,
    active_plan_path: active.planPath,
    active_plan_seq: active.entry.seq,
    active_plan_title: active.entry.title,
    blocked_count: active.entry.blocked_count,
    review_fail_count: active.entry.review_fail_count,
    approval_ticket_id: active.entry.approval_ticket_id,
    approved_hash: active.entry.approved_hash,
    approved_snapshot_path: active.entry.approved_snapshot_path,
  };
}

function planModeHintMessage(): string {
  return [
    "[plan] commands:",
    "  /plan status",
    "  /plan apply [extra]",
    "  /plan cancel",
    "  (send plain text to refine the active plan)",
  ].join("\n");
}

function formatReviewFindings(findings: readonly { code: string; section?: string; message: string }[]): string {
  if (findings.length === 0) {
    return "none";
  }
  return findings
    .map((item) => `${item.code}:${item.section ?? "global"}:${item.message}`)
    .join(" | ");
}

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

async function main(): Promise<number> {
  const raw = readFileSync(0, "utf8");
  if (!raw.trim()) {
    process.stderr.write("bridge input is empty\n");
    return 1;
  }
  try {
    const input = parseJsonInput(raw);
    const workDir = resolveWorkDir(input);
    const sessionId = resolvePlanSessionId(input.session);
    const rawMessage = input.userMessage.trim();

    const applyActivePlan = async (
      activeInitial: NonNullable<ReturnType<typeof loadActivePlanArtifact>>,
      extra: string,
      source: "bridge",
    ): Promise<{ code: number; payload: Record<string, unknown> }> => {
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
            assistant_message: `[plan] apply already in progress plan_id=${active.entry.plan_id}`,
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
        const approvedPlanContent = readApprovedPlanContent(approval.snapshotPath, active.content);
        const report = await runGatewayTurn(
          buildPlanApplyPrompt({
            approvedPlanContent,
            approvedHash: approval.planHash,
            ticketId: approval.ticketId,
            extra,
          }),
          input.session,
          input.context,
          input.migration,
        );
        updatePlanArtifactStatus(workDir, sessionId, active.entry.plan_id, "applied");
        appendPlanEvent(workDir, sessionId, {
          event: "plan_apply_succeeded",
          plan_id: active.entry.plan_id,
          source,
          detail: "plan applied and exited plan_only",
        });
        return {
          code: 0,
          payload: {
            status: "ok",
            assistant_message: recovered.recovered
              ? `[plan] recovered stale apply lock plan_id=${active.entry.plan_id} stale_ms=${String(recovered.stale_ms ?? 0)}\n${report.assistantMessage}`
              : report.assistantMessage,
            report,
            plan: currentPlanView(workDir, sessionId),
          },
        };
      } catch (error) {
        updatePlanArtifactStatus(workDir, sessionId, active.entry.plan_id, "apply_failed");
        const detail = error instanceof Error ? error.message : String(error);
        appendPlanEvent(workDir, sessionId, {
          event: "plan_apply_failed",
          plan_id: active.entry.plan_id,
          source,
          detail,
        });
        return {
          code: 1,
          payload: {
            status: "error",
            error_code: PLAN_ERROR_APPLY_EXEC_FAILED,
            detail,
            plan: currentPlanView(workDir, sessionId),
          },
        };
      }
    };

    if (rawMessage.startsWith("/plan")) {
      const parsed = parsePlanCommand(rawMessage);
      if (parsed.kind === "invalid") {
        process.stdout.write(
          `${JSON.stringify({
            status: "ok",
            assistant_message: parsed.reason,
            report: null,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 0;
      }
      if (parsed.kind === "enter") {
        const created = createPlanArtifact(workDir, sessionId, parsed.goal);
        appendPlanEvent(workDir, sessionId, {
          event: "plan_mode_entered",
          plan_id: created.entry.plan_id,
          source: "bridge",
          detail: "entered plan_only mode",
        });
        process.stdout.write(
          `${JSON.stringify({
            status: "ok",
            assistant_message: `[plan] entered PLAN_ONLY plan_id=${created.entry.plan_id} file=${created.planPath}\n${planModeHintMessage()}`,
            report: null,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 0;
      }
      if (parsed.kind === "status") {
        const plan = currentPlanView(workDir, sessionId);
        process.stdout.write(
          `${JSON.stringify({
            status: "ok",
            assistant_message: `[plan-status] mode=${plan.mode} plan_id=${plan.active_plan_id ?? "<none>"} status=${plan.active_plan_status ?? "<none>"}`,
            report: null,
            plan,
          })}\n`,
        );
        return 0;
      }
      if (parsed.kind === "cancel") {
        const active = loadActivePlanArtifact(workDir, sessionId);
        if (active && isPlanOnlyStatus(active.entry.status)) {
          updatePlanArtifactStatus(workDir, sessionId, active.entry.plan_id, "discarded");
        }
        process.stdout.write(
          `${JSON.stringify({
            status: "ok",
            assistant_message: active && isPlanOnlyStatus(active.entry.status)
              ? `[plan] cancelled plan_id=${active.entry.plan_id}`
              : "[plan] no active plan to cancel.",
            report: null,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 0;
      }
      const active = loadActivePlanArtifact(workDir, sessionId);
      if (!active) {
        process.stdout.write(
          `${JSON.stringify({
            status: "error",
            error_code: PLAN_ERROR_NO_ACTIVE,
            detail: "no active plan to apply",
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 1;
      }
      if (!isPlanOnlyStatus(active.entry.status)) {
        process.stdout.write(
          `${JSON.stringify({
            status: "error",
            error_code: PLAN_ERROR_APPLY_BLOCKED,
            detail: `apply blocked by status=${active.entry.status}`,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 1;
      }
      const applyResult = await applyActivePlan(active, parsed.extra, "bridge");
      process.stdout.write(`${JSON.stringify(applyResult.payload)}\n`);
      return applyResult.code;
    }

    const activeDraft = loadActivePlanArtifact(workDir, sessionId);
    if (activeDraft && isPlanOnlyStatus(activeDraft.entry.status)) {
      let appended: ReturnType<typeof appendPlanProgressNote>;
      try {
        appended = appendPlanProgressNote(
          workDir,
          sessionId,
          activeDraft.entry.plan_id,
          rawMessage,
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        process.stdout.write(
          `${JSON.stringify({
            status: "error",
            error_code: PLAN_ERROR_APPEND_NOTE_FAILED,
            detail: `append plan note failed: ${detail}`,
            guard_code: PLAN_GUARD_CODE,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 1;
      }
      if (!appended.updated) {
        process.stdout.write(
          `${JSON.stringify({
            status: "error",
            error_code: PLAN_ERROR_APPEND_NOTE_FAILED,
            detail: "failed to append plan note",
            guard_code: PLAN_GUARD_CODE,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 1;
      }
      appendPlanEvent(workDir, sessionId, {
        event: "plan_guard_denied",
        plan_id: activeDraft.entry.plan_id,
        source: "bridge",
        detail: "plan_only blocked normal execution and appended note",
      });
      process.stdout.write(
        `${JSON.stringify({
          status: "ok",
          assistant_message:
            `[plan-guard] code=${PLAN_GUARD_CODE} plan_only blocks normal execution; note appended file=${appended.planPath ?? activeDraft.planPath}`,
          report: null,
          error_code: PLAN_GUARD_CODE,
          guard_code: PLAN_GUARD_CODE,
          plan: currentPlanView(workDir, sessionId),
        })}\n`,
      );
      return 0;
    }

    const report = await runGatewayTurn(
      input.userMessage,
      input.session,
      input.context,
      input.migration,
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "ok",
          assistant_message: report.assistantMessage,
          report,
          plan: currentPlanView(workDir, sessionId),
        },
        null,
        0,
      )}\n`,
    );
    return 0;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ status: "error", error_code: BRIDGE_FATAL_ERROR, detail })}\n`);
    return 1;
  }
}

void main().then((code) => {
  process.exitCode = code;
});
