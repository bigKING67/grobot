import { compactSpaces } from "../../tui/terminal/display-width";
import type { RunStartPlanTurnOptions } from "./contract";

export function writePlanActivityDiagnostic(
  options: RunStartPlanTurnOptions | undefined,
  event: string,
  detail?: string,
): void {
  if (!options?.showWorkingNotice || !options.writeStderr) {
    return;
  }
  const compactDetail = compactSpaces(detail ?? "");
  options.writeStderr(
    compactDetail
      ? `[plan-mode] event=${event} ${compactDetail}\n`
      : `[plan-mode] event=${event}\n`,
  );
}
