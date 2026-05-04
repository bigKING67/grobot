import type { ToolSurfaceProfile } from "../../../models/types";

export function recoveryConsumptionKey(input: {
  recoveryStage: string | null;
  recoveryToolName: string | null;
  recoveryErrorClass: string | null;
}): string {
  return [
    input.recoveryStage ?? "<none>",
    input.recoveryToolName ?? "<none>",
    input.recoveryErrorClass ?? "<none>",
  ].join("|");
}

export function adaptationGuardKey(input: {
  appliedProfile?: ToolSurfaceProfile | null;
  recoveryToolName: string | null;
  recoveryErrorClass: string | null;
}): string {
  return [
    input.appliedProfile ?? "<none>",
    input.recoveryToolName ?? "<none>",
    input.recoveryErrorClass ?? "<none>",
  ].join("|");
}

export function recoveryKey(input: {
  recoveryStage: string | null;
  recoveryToolName: string | null;
  recoveryErrorClass: string | null;
}): string {
  return recoveryConsumptionKey(input);
}
