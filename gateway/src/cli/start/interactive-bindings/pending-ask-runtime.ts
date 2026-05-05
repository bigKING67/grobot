import { runAskUserQuestionnairePanel } from "../../tui/components/ask-user-panel/controller";
import {
  buildAskUserQueueDisplay,
  buildAskUserPendingSummary,
  createAskUserQuestionnaireState,
} from "../../../tools/ask-user";
import { compactSingleLine } from "../session/history";
import { formatPlanPathForPanel } from "./plan-editor";
import type {
  CreateRunStartInteractiveModeInput,
  InteractiveModeBindingPatch,
} from "./contract";

export function createPendingAskRuntime(
  input: CreateRunStartInteractiveModeInput,
): Pick<
  InteractiveModeBindingPatch,
  "getPendingAskPromptSummary" | "selectPendingAskAnswer" | "showPendingAskQueue"
> {
  const purgeExpiredPendingAsk = (notify: boolean): number => {
    const sessionKey = input.runtimeState.getSessionKey();
    const expired = input.gaMechanismRuntime.purgeExpiredPendingAsk(sessionKey);
    if (notify && expired.length > 0) {
      input.output.writeStdout(
        `已移除 ${String(expired.length)} 个过期待确认问题。\n\n`,
      );
    }
    return expired.length;
  };

  const resolveDefaultAskAnswer = (
    value: string | undefined,
  ): string | undefined => {
    const raw = String(value ?? "").trim();
    if (!raw || /^none$/i.test(raw)) {
      return undefined;
    }
    return raw;
  };

  const getPendingAskPromptSummary = (): string | undefined => {
    purgeExpiredPendingAsk(false);
    const sessionKey = input.runtimeState.getSessionKey();
    const active = input.gaMechanismRuntime.getPendingAsk(sessionKey);
    if (!active) {
      return undefined;
    }
    return buildAskUserPendingSummary(active);
  };

  const selectPendingAskAnswer = async (
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<string | undefined> => {
    purgeExpiredPendingAsk(true);
    const sessionKey = input.runtimeState.getSessionKey();
    const active = input.gaMechanismRuntime.getPendingAsk(sessionKey);
    if (!active) {
      input.output.writeStdout("没有待确认问题。\n\n");
      return undefined;
    }
    const queue = input.gaMechanismRuntime.listPendingAsk(sessionKey);
    const questionnaireState = createAskUserQuestionnaireState();
    if (!process.stdin.isTTY) {
      input.output.writeStdout(
        buildAskUserQueueDisplay({
          queue: queue.length > 0 ? queue : [active],
          state: questionnaireState,
        }),
      );
      return undefined;
    }
    const effectiveQueue = queue.length > 0 ? queue : [active];
    const result = await withInputPaused(() =>
      runAskUserQuestionnairePanel({
        queue: effectiveQueue,
        planMode: input.planMode.isPlanMode(),
        planFilePath: formatPlanPathForPanel(
          input.workDir,
          input.planMode.getActivePlanPath(),
        ),
      }),
    );
    if (result.kind !== "submitted") {
      return undefined;
    }
    return result.text.trim().length > 0 ? result.text : undefined;
  };

  const showPendingAskQueue = (limit?: number): void => {
    void limit;
    purgeExpiredPendingAsk(true);
    const sessionKey = input.runtimeState.getSessionKey();
    const queue = input.gaMechanismRuntime.listPendingAsk(sessionKey);
    if (queue.length === 0) {
      input.output.writeStdout("没有待确认问题。\n\n");
      return;
    }
    const active = queue[0];
    if (!active) {
      input.output.writeStdout("没有待确认问题。\n\n");
      return;
    }
    const defaultAnswer = resolveDefaultAskAnswer(active.defaultOnTimeout);
    const lines: string[] = [
      buildAskUserQueueDisplay({
        queue,
        state: createAskUserQuestionnaireState(),
      }).trimEnd(),
    ];
    if (!lines[0]?.includes("待确认：")) {
      lines.push(`  待确认：${String(queue.length)} 项`);
    }
    if (defaultAnswer && !lines[0]?.includes("默认：")) {
      lines.push(`  默认：${compactSingleLine(defaultAnswer, 120)}`);
    }
    lines.push("");
    input.output.writeStdout(`${lines.join("\n")}\n`);
  };

  return {
    getPendingAskPromptSummary,
    selectPendingAskAnswer,
    showPendingAskQueue,
  };
}
