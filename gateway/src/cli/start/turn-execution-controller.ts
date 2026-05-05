import type { RuntimeAttachment } from "../../models/types";
import type { RunStartRewindStore } from "./rewind-store";
import type { RunStartRuntimeState } from "./runtime-state";
import { TURN_INTERRUPTED_EXIT_CODE } from "./turn";
import type { RunStartWire } from "./wire";
import type { RuntimeInterruptController } from "./runtime-interrupt-controller";
import { buildRewindCaptureFailedSurface } from "./startup/surfaces";

export interface TurnExecutionOptions {
  attachments?: RuntimeAttachment[];
  promptPrelude?: string;
  autoOpenAskUserPanel?: boolean;
  emitDiagnostics?: boolean;
  writeStdout?: (message: string) => void;
  writeStderr?: (message: string) => void;
}

export interface CreateTurnExecutionControllerInput {
  runtimeState: RunStartRuntimeState;
  rewindStore: RunStartRewindStore;
  wire: RunStartWire;
  runtimeInterrupts: RuntimeInterruptController;
  refreshContextWindowFromModelCatalog(reason: string): void;
  runMemoryMaintenance(reason: "post_turn"): Promise<void>;
  writeStartupDiagnostics(message: string): void;
  writeStderr(message: string): void;
}

export interface TurnExecutionController {
  executeTurn(
    userInput: string,
    interactiveMode: boolean,
    options?: TurnExecutionOptions,
  ): Promise<number>;
}

function formatFallbackAssistantTurnSummary(code: number): string {
  if (code === 0) {
    return "Turn completed.";
  }
  return `Turn did not finish, exit code ${String(code)}.`;
}

export function createTurnExecutionController(
  input: CreateTurnExecutionControllerInput,
): TurnExecutionController {
  let turnQueue: Promise<unknown> = Promise.resolve();

  const runTurnWithController = async (
    userInput: string,
    interactiveMode: boolean,
    controller: AbortController,
    options?: TurnExecutionOptions,
  ): Promise<number> => {
    const writeStderr = options?.writeStderr ?? input.writeStderr;
    input.runtimeInterrupts.setActiveController(controller);
    const turnCapture = input.rewindStore.beginTurnCapture({
      sessionKey: input.runtimeState.getSessionKey(),
      userText: userInput,
      historyBefore: input.runtimeState.getHistoryMessages(),
    });
    let recordedAssistantText: string | undefined;
    try {
      input.refreshContextWindowFromModelCatalog("pre_turn");
      const code = await input.wire.executeTurn(userInput, interactiveMode, {
        signal: controller.signal,
        attachments: options?.attachments,
        promptPrelude: options?.promptPrelude,
        autoOpenAskUserPanel: options?.autoOpenAskUserPanel,
        emitDiagnostics: options?.emitDiagnostics,
        writeStdout: options?.writeStdout,
        writeStderr,
        onTurnRecorded: (turnRecord) => {
          recordedAssistantText = turnRecord.assistantText;
        },
      });
      if (code !== TURN_INTERRUPTED_EXIT_CODE) {
        const historyAfter = input.runtimeState.getHistoryMessages();
        const assistantText =
          recordedAssistantText ??
          (() => {
            const last = historyAfter[historyAfter.length - 1];
            if (last?.role === "assistant") {
              return last.content;
            }
            return formatFallbackAssistantTurnSummary(code);
          })();
        try {
          await input.rewindStore.commitTurnCapture({
            capture: turnCapture,
            assistantText,
            historyAfter,
          });
        } catch (error) {
          input.writeStartupDiagnostics(
            `[rewind] event=capture_failed detail=${String(error)}\n`,
          );
          writeStderr(buildRewindCaptureFailedSurface(String(error)));
        }
      }
      input.runtimeInterrupts.reconcileTurnResult({
        code,
        controller,
        interactiveMode,
        writeStderr,
      });
      await input.runMemoryMaintenance("post_turn");
      return code;
    } finally {
      if (input.runtimeInterrupts.getActiveController() === controller) {
        input.runtimeInterrupts.setActiveController(undefined);
      }
    }
  };

  const executeTurn = async (
    userInput: string,
    interactiveMode: boolean,
    options?: TurnExecutionOptions,
  ): Promise<number> => {
    const controller = new AbortController();
    const next = turnQueue.then(
      async () =>
        runTurnWithController(userInput, interactiveMode, controller, options),
      async () =>
        runTurnWithController(userInput, interactiveMode, controller, options),
    );
    turnQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  return {
    executeTurn,
  };
}
