import { appendPlanEvent, updatePlanArtifactStatus } from "../plan-artifact";
import type { SessionPlanMeta, SessionPlanMode } from "../session-registry";
import {
  PLAN_INTERRUPT_NOT_PLAN_MODE_CODE,
  PLAN_INTERRUPT_NOT_RUNNING_CODE,
  PLAN_INTERRUPT_OK_CODE,
} from "./constants";
import type {
  PlanInterruptResult,
  PlanInterruptSource,
  PlanStablePoint,
  PlanTurnPhase,
} from "./contract";
import { buildPlanInterruptSurface } from "./surfaces";

export interface PlanInterruptController {
  hasPending(): boolean;
  request(source: PlanInterruptSource): Promise<PlanInterruptResult>;
  consume(snapshot: PlanStablePoint, stage: string): Promise<boolean>;
  clearAsIgnored(stage: string, reason: string): void;
}

export interface CreatePlanInterruptControllerInput {
  workDir: string;
  planSessionKey(): string;
  getPlanMode(): SessionPlanMode;
  getActiveTurnPhase(): PlanTurnPhase;
  resolveActivePlanId(): string | undefined;
  persistPlanState(
    planMode: SessionPlanMode,
    planMeta: SessionPlanMeta | undefined,
  ): Promise<void>;
  requestRuntimeInterrupt(source: PlanInterruptSource): {
    code: "TURN_INTERRUPT_OK" | "TURN_INTERRUPT_NOT_RUNNING";
    interrupted: boolean;
  };
  writeStdout(message: string): void;
}

function clonePlanMeta(
  planMeta: SessionPlanMeta | undefined,
): SessionPlanMeta | undefined {
  return planMeta ? { ...planMeta } : undefined;
}

export function createPlanInterruptController(
  input: CreatePlanInterruptControllerInput,
): PlanInterruptController {
  let pendingInterruptSource: PlanInterruptSource | undefined;

  const request = async (
    source: PlanInterruptSource,
  ): Promise<PlanInterruptResult> => {
    const activeTurnPhase = input.getActiveTurnPhase();
    if (input.getPlanMode() !== "plan_only") {
      input.writeStdout(
        buildPlanInterruptSurface({
          code: PLAN_INTERRUPT_NOT_PLAN_MODE_CODE,
          kind: "not_plan_mode",
        }),
      );
      return {
        code: PLAN_INTERRUPT_NOT_PLAN_MODE_CODE,
        accepted: false,
        phase: activeTurnPhase,
      };
    }
    if (activeTurnPhase === "idle") {
      input.writeStdout(
        buildPlanInterruptSurface({
          code: PLAN_INTERRUPT_NOT_RUNNING_CODE,
          kind: "not_running",
        }),
      );
      return {
        code: PLAN_INTERRUPT_NOT_RUNNING_CODE,
        accepted: false,
        phase: activeTurnPhase,
      };
    }
    if (!pendingInterruptSource) {
      pendingInterruptSource = source;
      appendPlanEvent(input.workDir, input.planSessionKey(), {
        event: "plan_interrupt_requested",
        plan_id: input.resolveActivePlanId(),
        source: "cli",
        detail: `source=${source} phase=${activeTurnPhase}`,
      });
    }
    if (activeTurnPhase === "planning" || activeTurnPhase === "applying") {
      const runtimeInterrupt = input.requestRuntimeInterrupt(source);
      input.writeStdout(
        buildPlanInterruptSurface({
          code: PLAN_INTERRUPT_OK_CODE,
          kind: "requested",
          phase: activeTurnPhase,
          runtimeInterrupted: runtimeInterrupt.interrupted,
        }),
      );
    } else {
      input.writeStdout(
        buildPlanInterruptSurface({
          code: PLAN_INTERRUPT_OK_CODE,
          kind: "requested",
          phase: activeTurnPhase,
        }),
      );
    }
    return {
      code: PLAN_INTERRUPT_OK_CODE,
      accepted: true,
      phase: activeTurnPhase,
    };
  };

  const consume = async (
    snapshot: PlanStablePoint,
    stage: string,
  ): Promise<boolean> => {
    if (!pendingInterruptSource) {
      return false;
    }
    const interruptSource = pendingInterruptSource;
    pendingInterruptSource = undefined;
    const snapshotPlanId = snapshot.planMeta?.active_plan_id?.trim();
    const snapshotPlanStatus = snapshot.planMeta?.active_plan_status;
    if (snapshotPlanId && snapshotPlanStatus) {
      updatePlanArtifactStatus(
        input.workDir,
        input.planSessionKey(),
        snapshotPlanId,
        snapshotPlanStatus,
      );
    }
    await input.persistPlanState(
      snapshot.planMode,
      clonePlanMeta(snapshot.planMeta),
    );
    appendPlanEvent(input.workDir, input.planSessionKey(), {
      event: "plan_interrupt_applied",
      plan_id: input.resolveActivePlanId(),
      source: "cli",
      detail: `source=${interruptSource} stage=${stage} rollback=stable_point`,
    });
    input.writeStdout(
      buildPlanInterruptSurface({
        code: PLAN_INTERRUPT_OK_CODE,
        kind: "applied",
        stage,
      }),
    );
    return true;
  };

  const clearAsIgnored = (stage: string, reason: string): void => {
    if (!pendingInterruptSource) {
      return;
    }
    const interruptSource = pendingInterruptSource;
    pendingInterruptSource = undefined;
    appendPlanEvent(input.workDir, input.planSessionKey(), {
      event: "plan_interrupt_ignored",
      plan_id: input.resolveActivePlanId(),
      source: "cli",
      detail: `source=${interruptSource} stage=${stage} reason=${reason}`,
    });
    input.writeStdout(
      buildPlanInterruptSurface({
        code: PLAN_INTERRUPT_OK_CODE,
        kind: "ignored",
        stage,
        reason,
      }),
    );
  };

  return {
    hasPending: () => Boolean(pendingInterruptSource),
    request,
    consume,
    clearAsIgnored,
  };
}
