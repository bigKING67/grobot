import { readFileSync } from "node:fs";
import { relative as relativePath, resolve as resolvePath } from "node:path";
import { type SessionInteractiveControls } from "../session-interactive";
import {
  type PlanReadyApprovalDecision,
  type PlanReadyApprovalRequest,
} from "../plan-mode";
import { runTerminalSelectMenu } from "../../tui/components/select-menu/controller";

export function createPlanReadyApprovalRequester(input: {
  writeStdout(message: string): void;
  writeStderr(message: string): void;
  openPlanInEditor(
    withInputPaused: SessionInteractiveControls["withInputPaused"],
    options?: {
      writeStdout?: (message: string) => void;
      writeStderr?: (message: string) => void;
      suppressOpenPlanEditorNotice?: boolean;
    },
  ): Promise<void>;
}): (
  withInputPaused: SessionInteractiveControls["withInputPaused"] | undefined,
) => (request: PlanReadyApprovalRequest) => Promise<PlanReadyApprovalDecision> {
  return (withInputPaused) =>
    async (request): Promise<PlanReadyApprovalDecision> => {
      if (!process.stdin.isTTY || typeof withInputPaused !== "function") {
        return "unavailable";
      }
      const displayPath = resolveDisplayPlanPath({
        workDir: request.workDir,
        planPath: request.planPath,
      });
      let currentPlanContent = request.planContent;
      let planEdited = false;
      let draftFeedback = "";
      while (true) {
        const isEmptyPlan = isEmptyPlanApprovalContent(currentPlanContent);
        const result = await withInputPaused(() =>
          runTerminalSelectMenu({
            title: isEmptyPlan ? "Exit plan mode?" : "Ready to implement?",
            hint: isEmptyPlan
              ? "Enter confirm · Esc back to input"
              : "↑/↓ select · Enter confirm · Esc back to input",
            variant: "plan_approval",
            visibleOptionCount: 2,
            planApprovalMeta: {
              agentName: "Grobot",
              editorName: resolveExternalEditorDisplayName(),
              planContent: currentPlanContent,
              planPath: displayPath,
              planEdited,
              emptyPlan: isEmptyPlan,
            },
            items: isEmptyPlan
              ? [
                {
                  id: "approve",
                  label: "Yes, exit",
                },
                {
                  id: "keep_planning",
                  label: "No, keep planning",
                },
              ]
              : [
                {
                  id: "approve",
                  label: "Confirm, implement plan",
                  description: "Start implementation from this plan.",
                },
                {
                  id: "keep_planning",
                  label: "Refine plan",
                  description: "Shift+Tab can approve with feedback",
                  input: {
                    placeholder: "Tell Grobot what to adjust",
                    initialValue: draftFeedback,
                    showLabelWithValue: true,
                    labelValueSeparator: ": ",
                    resetCursorOnUpdate: true,
                  },
                },
              ],
          }),
        );
        if (result.kind === "edit_plan") {
          draftFeedback = result.inputValue ?? draftFeedback;
          await input.openPlanInEditor(withInputPaused, {
            writeStdout: input.writeStdout,
            writeStderr: input.writeStderr,
            suppressOpenPlanEditorNotice: true,
          });
          currentPlanContent = readPlanContentAfterExternalEdit(
            request.planPath,
            currentPlanContent,
          );
          planEdited = currentPlanContent !== request.planContent;
          continue;
        }
        if (result.kind === "selected" && result.item.id === "approve") {
          if (isEmptyPlan) {
            return {
              action: "exit_plan_mode",
              planContent: currentPlanContent,
              silent: true,
            };
          }
          const feedback = result.inputValue?.trim();
          return {
            action: "approve",
            ...(feedback && feedback.length > 0 ? { feedback } : {}),
            planContent: currentPlanContent,
          };
        }
        if (result.kind === "selected" && result.item.id === "keep_planning") {
          if (isEmptyPlan) {
            return {
              action: "keep_planning",
              planContent: currentPlanContent,
              silent: true,
            };
          }
          draftFeedback = result.inputValue ?? draftFeedback;
          const feedback = draftFeedback.trim();
          if (feedback.length <= 0) {
            continue;
          }
          return {
            action: "keep_planning",
            feedback,
            planContent: currentPlanContent,
          };
        }
        if (result.kind === "cancelled") {
          return {
            action: "keep_planning",
            planContent: currentPlanContent,
            silent: true,
          };
        }
        return {
          action: "keep_planning",
          planContent: currentPlanContent,
        };
      }
    };
}

function resolveDisplayPlanPath(input: {
  workDir: string;
  planPath: string;
}): string {
  const resolvedWorkDir = resolvePath(input.workDir);
  const resolvedPlanPath = resolvePath(input.planPath);
  const relativePlanPath = relativePath(resolvedWorkDir, resolvedPlanPath);
  if (
    relativePlanPath
    && !relativePlanPath.startsWith("..")
    && !relativePlanPath.startsWith("/")
  ) {
    return relativePlanPath;
  }
  return input.planPath;
}

function resolveExternalEditorDisplayName(): string {
  const rawEditor = String(process.env.VISUAL ?? process.env.EDITOR ?? "").trim();
  if (rawEditor.length === 0) {
    return "editor";
  }
  const command = rawEditor.split(/\s+/)[0] ?? rawEditor;
  const parts = command.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? command;
}

function readPlanContentAfterExternalEdit(planPath: string, fallback: string): string {
  try {
    const content = readFileSync(planPath, "utf8");
    return content.length > 0 ? content : fallback;
  } catch {
    return fallback;
  }
}

function isEmptyPlanApprovalContent(content: string): boolean {
  const normalized = content.trim();
  return normalized.length === 0 || normalized.includes("__REQUIRED__");
}
