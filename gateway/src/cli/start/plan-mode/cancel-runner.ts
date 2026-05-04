import {
  appendPlanEvent,
  updatePlanArtifactStatus,
  type ActivePlanArtifact,
} from "../plan-artifact";
import type { SessionPlanMeta, SessionPlanMode } from "../session-registry";
import { buildPlanCancelSurface } from "./surfaces";

export interface RunPlanCancelInput {
  workDir: string;
  planSessionKey(): string;
  resolveActivePlan(): ActivePlanArtifact | undefined;
  persistPlanState(
    planMode: SessionPlanMode,
    planMeta: SessionPlanMeta | undefined,
  ): Promise<void>;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
}

export async function runPlanCancel(
  input: RunPlanCancelInput,
): Promise<number> {
  const active = input.resolveActivePlan();
  if (!active) {
    input.writeStdout(buildPlanCancelSurface({ kind: "empty" }));
    await input.persistPlanState("normal", undefined);
    return 0;
  }
  const discarded = updatePlanArtifactStatus(
    input.workDir,
    input.planSessionKey(),
    active.entry.plan_id,
    "discarded",
  );
  if (!discarded) {
    input.writeStderr(
      buildPlanCancelSurface({
        kind: "failed",
        workDir: input.workDir,
        planPath: active.planPath,
        detail: "未找到计划记录，无法更新为已取消。",
      }),
    );
    return 1;
  }
  await input.persistPlanState("normal", undefined);
  appendPlanEvent(input.workDir, input.planSessionKey(), {
    event: "plan_mode_cancelled",
    plan_id: active.entry.plan_id,
    source: "cli",
    detail: "cancel command moved plan to discarded",
  });
  input.writeStdout(
    buildPlanCancelSurface({
      kind: "cancelled",
      workDir: input.workDir,
      planPath: active.planPath,
    }),
  );
  return 0;
}
