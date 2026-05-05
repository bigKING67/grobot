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
      buildCompactNotice("当前没有活跃计划文件", ["请先使用 /plan <goal>。"]),
    );
    return;
  }
  const displayPath =
    formatPlanPathForPanel(input.workDir, planPath) ?? planPath;
  const openOperation = async (): Promise<void> => {
    const launched = launchPlanFileInEditor(planPath);
    if (!launched.ok) {
      input.writeStdout(
        buildCompactNotice("无法打开计划文件", [
          `原因 ${compactSingleLine(launched.detail, 200)}`,
          `计划文件 ${displayPath}`,
        ]),
      );
      return;
    }
    if (input.suppressOpenPlanEditorNotice) {
      return;
    }
    input.writeStdout(
      buildCompactNotice("已打开计划文件", [`计划文件 ${displayPath}`]),
    );
  };
  if (!process.stdin.isTTY) {
    await openOperation();
    return;
  }
  await input.withInputPaused(openOperation);
}
