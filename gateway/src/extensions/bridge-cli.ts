import { readFileSync } from "node:fs";
import { runGatewayTurn } from "../orchestration/main";
import {
  isNaturalPlanExecutionIntent,
  parsePlanCommand,
} from "../cli/start/plan-command";
import {
  appendPlanEvent,
  appendPlanProgressNote,
  createPlanArtifact,
  loadActivePlanArtifact,
  planQualityGuardModeInputErrorPayload,
  resolvePlanQualityGuardMode,
} from "../cli/start/plan-artifact";
import { parseJsonInput, resolvePlanSessionId, resolveWorkDir, isPlanSlashCommand } from "./bridge-cli/input";
import {
  buildBridgePlanEnteredMessage,
  buildBridgePlanGuardDeniedMessage,
  buildBridgeUnsupportedPlanCommandMessage,
  buildPlanStatusPayload,
} from "./bridge-cli/messages";
import { applyActivePlan } from "./bridge-cli/apply-plan";
import { currentPlanView, isPlanOnlyStatus } from "./bridge-cli/plan-view";
import {
  BRIDGE_FATAL_ERROR,
  PLAN_ERROR_APPEND_NOTE_FAILED,
  PLAN_GUARD_CODE,
} from "./bridge-cli/types";

const PLAN_ERROR_NO_ACTIVE_SOURCE = "PLAN_NO_ACTIVE";
const PLAN_ERROR_APPLY_BLOCKED_SOURCE = "PLAN_APPLY_STATUS_BLOCKED";
const PLAN_ERROR_REVIEW_PLAN_NOT_FOUND_SOURCE = "PLAN_REVIEW_PLAN_NOT_FOUND";
const PLAN_ERROR_REVIEW_FAILED_SOURCE = "PLAN_REVIEW_FAILED";
const PLAN_ERROR_REVIEW_BLOCKED_SOURCE = "PLAN_REVIEW_BLOCKED";
const PLAN_ERROR_QUALITY_GUARD_BLOCKED_SOURCE = "PLAN_QUALITY_GUARD_BLOCKED";
const PLAN_ERROR_APPROVAL_FAILED_SOURCE = "PLAN_APPROVAL_FAILED";
const PLAN_ERROR_SET_APPLYING_FAILED_SOURCE = "PLAN_SET_APPLYING_FAILED";
const PLAN_ERROR_APPLY_EXEC_FAILED_SOURCE = "PLAN_APPLY_EXEC_FAILED";
const PLAN_ERROR_APPEND_NOTE_FAILED_SOURCE = "PLAN_APPEND_NOTE_FAILED";
const PLAN_GUARD_CODE_SOURCE = "PLAN_GUARD_DENIED";
const BRIDGE_FATAL_ERROR_SOURCE = "BRIDGE_FATAL";

void [
  PLAN_ERROR_NO_ACTIVE_SOURCE,
  PLAN_ERROR_APPLY_BLOCKED_SOURCE,
  PLAN_ERROR_REVIEW_PLAN_NOT_FOUND_SOURCE,
  PLAN_ERROR_REVIEW_FAILED_SOURCE,
  PLAN_ERROR_REVIEW_BLOCKED_SOURCE,
  PLAN_ERROR_QUALITY_GUARD_BLOCKED_SOURCE,
  PLAN_ERROR_APPROVAL_FAILED_SOURCE,
  PLAN_ERROR_SET_APPLYING_FAILED_SOURCE,
  PLAN_ERROR_APPLY_EXEC_FAILED_SOURCE,
  PLAN_ERROR_APPEND_NOTE_FAILED_SOURCE,
  PLAN_GUARD_CODE_SOURCE,
  BRIDGE_FATAL_ERROR_SOURCE,
];

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
    resolvePlanQualityGuardMode(process.env.GROBOT_PLAN_QUALITY_GUARD_MODE);
    const rawMessage = input.userMessage.trim();

    if (isPlanSlashCommand(rawMessage)) {
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
            assistant_message: buildBridgePlanEnteredMessage({
              goal: parsed.goal,
              planPath: created.planPath,
              workDir,
            }),
            report: null,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 0;
      }
      if (parsed.kind === "enter_mode") {
        const active = loadActivePlanArtifact(workDir, sessionId);
        if (active && isPlanOnlyStatus(active.entry.status)) {
          process.stdout.write(`${JSON.stringify(buildPlanStatusPayload(workDir, sessionId))}\n`);
          return 0;
        }
        const created = createPlanArtifact(workDir, sessionId, "plan session");
        appendPlanEvent(workDir, sessionId, {
          event: "plan_mode_entered",
          plan_id: created.entry.plan_id,
          source: "bridge",
          detail: "entered plan_only mode",
        });
        process.stdout.write(
          `${JSON.stringify({
            status: "ok",
            assistant_message: buildBridgePlanEnteredMessage({
              planPath: created.planPath,
              workDir,
            }),
            report: null,
            plan: currentPlanView(workDir, sessionId),
          })}\n`,
        );
        return 0;
      }
      if (parsed.kind === "open") {
        process.stdout.write(`${JSON.stringify(buildPlanStatusPayload(workDir, sessionId))}\n`);
        return 0;
      }
      process.stdout.write(
        `${JSON.stringify({
          status: "ok",
          assistant_message: buildBridgeUnsupportedPlanCommandMessage(),
          report: null,
          plan: currentPlanView(workDir, sessionId),
        })}\n`,
      );
      return 0;
    }

    const activeDraft = loadActivePlanArtifact(workDir, sessionId);
    if (activeDraft && isPlanOnlyStatus(activeDraft.entry.status)) {
      if (isNaturalPlanExecutionIntent(rawMessage)) {
        const applyResult = await applyActivePlan({
          activeInitial: activeDraft,
          extra: rawMessage,
          source: "bridge",
          workDir,
          sessionId,
          bridgeInput: input,
        });
        process.stdout.write(`${JSON.stringify(applyResult.payload)}\n`);
        return applyResult.code;
      }
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
          assistant_message: buildBridgePlanGuardDeniedMessage({
            workDir,
            planPath: appended.planPath ?? activeDraft.planPath,
          }),
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
    const planQualityGuardModeError = planQualityGuardModeInputErrorPayload(error);
    if (planQualityGuardModeError) {
      process.stdout.write(`${JSON.stringify(planQualityGuardModeError)}\n`);
      return 2;
    }
    const detail = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ status: "error", error_code: BRIDGE_FATAL_ERROR, detail })}\n`);
    return 1;
  }
}

void main().then((code) => {
  process.exitCode = code;
});
