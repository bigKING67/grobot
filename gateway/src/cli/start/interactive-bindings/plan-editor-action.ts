import { compactSingleLine } from "../session/history";
import type { RunStartPlanMode } from "../plan-mode";
import { buildCompactNotice } from "./notice-surface";
import { formatPlanPathForPanel, launchPlanFileInEditor } from "./plan-editor";

export async function openPlanInEditor(input: {
  workDir: string;
  planMode: RunStartPlanMode;
  withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>;
  suppressOpenPlanEditorNotice?: boolean;
  writeStdout(message: string): void;
}): Promise<void> {
  const planPath = input.planMode.getActivePlanPath();
  if (!planPath) {
    input.writeStdout(
      buildCompactNotice("No active plan file", ["Use /plan <goal> first."]),
    );
    return;
  }
  const displayPath =
    formatPlanPathForPanel(input.workDir, planPath) ?? planPath;
  const openOperation = async (): Promise<void> => {
    const launched = launchPlanFileInEditor(planPath);
    if (!launched.ok) {
      input.writeStdout(
        buildCompactNotice("Cannot open plan file", [
          `reason ${compactSingleLine(launched.detail, 200)}`,
          `plan file ${displayPath}`,
        ]),
      );
      return;
    }
    if (input.suppressOpenPlanEditorNotice) {
      return;
    }
    input.writeStdout(
      buildCompactNotice("Plan file opened", [`plan file ${displayPath}`]),
    );
  };
  if (!process.stdin.isTTY) {
    await openOperation();
    return;
  }
  await input.withInputPaused(openOperation);
}
