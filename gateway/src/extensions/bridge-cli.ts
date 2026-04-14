import { readFileSync } from "node:fs";
import { runGatewayTurn } from "../orchestration/main";
import { MigrationOptions, SessionKeyParts } from "../models/types";
import { parsePlanCommand, parsePlanQuickReply } from "../orchestration/entrypoints/dev-cli/start/plan-command";
import {
  appendPlanEvent,
  appendPlanProgressNote,
  buildPlanApplyPrompt,
  createPlanArtifact,
  loadActivePlanArtifact,
  recoverStaleApprovedPlan,
  updatePlanArtifactStatus,
} from "../orchestration/entrypoints/dev-cli/start/plan-artifact";
import { removeTrailingSlashes } from "../orchestration/entrypoints/dev-cli/services/runtime-paths";

const PLAN_GUARD_CODE = "PLAN_GUARD_DENIED";

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

function currentPlanView(workDir: string, sessionId: string): {
  mode: "normal" | "plan_only";
  active_plan_id?: string;
  active_plan_status?: "draft" | "approved" | "apply_failed" | "applied" | "discarded";
  active_plan_path?: string;
} {
  const active = loadActivePlanArtifact(workDir, sessionId);
  if (
    !active ||
    (active.entry.status !== "draft" && active.entry.status !== "approved" && active.entry.status !== "apply_failed")
  ) {
    return {
      mode: "normal",
    };
  }
  return {
    mode: "plan_only",
    active_plan_id: active.entry.plan_id,
    active_plan_status: active.entry.status,
    active_plan_path: active.planPath,
  };
}

function planOptionsMessage(): string {
  return [
    "[plan-options]",
    "1) apply current plan (/plan apply)",
    "2) show plan markdown (/plan show)",
    "3) continue planning (send text to append)",
    "4) discard plan (/plan discard)",
    "none of these: <note> (append custom note)",
  ].join("\n");
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
            detail: "no active plan to apply",
            plan: currentPlanView(workDir, sessionId),
          },
        };
      }
      if (active.entry.status === "approved") {
        appendPlanEvent(workDir, sessionId, {
          event: "plan_apply_idempotent_hit",
          plan_id: active.entry.plan_id,
          source,
          detail: "status=approved",
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
      if (active.entry.status !== "draft" && active.entry.status !== "apply_failed") {
        return {
          code: 1,
          payload: {
            status: "error",
            detail: `apply blocked by status=${active.entry.status}`,
            plan: currentPlanView(workDir, sessionId),
          },
        };
      }
      const approved = updatePlanArtifactStatus(workDir, sessionId, active.entry.plan_id, "approved");
      if (!approved) {
        return {
          code: 1,
          payload: {
            status: "error",
            detail: `failed to mark approved for ${active.entry.plan_id}`,
            plan: currentPlanView(workDir, sessionId),
          },
        };
      }
      appendPlanEvent(workDir, sessionId, {
        event: "plan_apply_started",
        plan_id: active.entry.plan_id,
        source,
        detail: "status moved to approved",
      });
      try {
        const report = await runGatewayTurn(
          buildPlanApplyPrompt(active.content, extra),
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
            assistant_message: `[plan] entered PLAN_ONLY plan_id=${created.entry.plan_id} file=${created.planPath}\n${planOptionsMessage()}`,
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
            assistant_message: `[plan-status] mode=${plan.mode} plan_id=${plan.active_plan_id ?? "<none>"}`,
            report: null,
            plan,
          })}\n`,
        );
        return 0;
      }
      if (parsed.kind === "show") {
        const active = loadActivePlanArtifact(workDir, sessionId);
        if (!active) {
          process.stdout.write(
            `${JSON.stringify({
              status: "ok",
              assistant_message: "[plan] no active plan. Use /plan <goal> first.",
              report: null,
              plan: currentPlanView(workDir, sessionId),
            })}\n`,
          );
          return 0;
        }
        process.stdout.write(
          `${JSON.stringify({
            status: "ok",
            assistant_message: active.content,
            report: null,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 0;
      }
      if (parsed.kind === "options") {
        process.stdout.write(
          `${JSON.stringify({
            status: "ok",
            assistant_message: planOptionsMessage(),
            report: null,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 0;
      }
      if (parsed.kind === "discard") {
        const active = loadActivePlanArtifact(workDir, sessionId);
        if (active) {
          updatePlanArtifactStatus(workDir, sessionId, active.entry.plan_id, "discarded");
        }
        process.stdout.write(
          `${JSON.stringify({
            status: "ok",
            assistant_message: active
              ? `[plan] discarded plan_id=${active.entry.plan_id}`
              : "[plan] no active plan to discard.",
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
            detail: "no active plan to apply",
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
    if (
      activeDraft &&
      (activeDraft.entry.status === "draft" ||
        activeDraft.entry.status === "approved" ||
        activeDraft.entry.status === "apply_failed")
    ) {
      const quickReply = parsePlanQuickReply(rawMessage);
      if (quickReply.kind === "option") {
        if (quickReply.value === 1) {
          const applyResult = await applyActivePlan(activeDraft, "", "bridge");
          process.stdout.write(`${JSON.stringify(applyResult.payload)}\n`);
          return applyResult.code;
        }
        if (quickReply.value === 2) {
          process.stdout.write(
            `${JSON.stringify({
              status: "ok",
              assistant_message: activeDraft.content,
              report: null,
              guard_code: PLAN_GUARD_CODE,
              plan: currentPlanView(workDir, sessionId),
            })}\n`,
          );
          return 0;
        }
        if (quickReply.value === 3) {
          process.stdout.write(
            `${JSON.stringify({
              status: "ok",
              assistant_message: "[plan] continue planning. Send your update and it will be appended.",
              report: null,
              guard_code: PLAN_GUARD_CODE,
              plan: currentPlanView(workDir, sessionId),
            })}\n`,
          );
          return 0;
        }
        updatePlanArtifactStatus(workDir, sessionId, activeDraft.entry.plan_id, "discarded");
        process.stdout.write(
          `${JSON.stringify({
            status: "ok",
            assistant_message: `[plan] discarded plan_id=${activeDraft.entry.plan_id}`,
            report: null,
            guard_code: PLAN_GUARD_CODE,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 0;
      }
      if (quickReply.kind === "none" && !quickReply.note) {
        process.stdout.write(
          `${JSON.stringify({
            status: "ok",
            assistant_message: "[plan] please provide note after `none of these:`.",
            report: null,
            guard_code: PLAN_GUARD_CODE,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 0;
      }
      if (quickReply.kind === "empty") {
        process.stdout.write(
          `${JSON.stringify({
            status: "ok",
            assistant_message: "[plan] empty input ignored in PLAN_ONLY mode.",
            report: null,
            guard_code: PLAN_GUARD_CODE,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 0;
      }
      const note = quickReply.kind === "none" ? quickReply.note : quickReply.note;
      appendPlanProgressNote(workDir, sessionId, activeDraft.entry.plan_id, note);
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
            `[plan-guard] code=${PLAN_GUARD_CODE} plan_only blocks normal execution; note appended file=${activeDraft.planPath}`,
          report: null,
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
    process.stdout.write(`${JSON.stringify({ status: "error", detail })}\n`);
    return 1;
  }
}

void main().then((code) => {
  process.exitCode = code;
});
