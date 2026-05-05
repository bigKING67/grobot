import { TURN_INTERRUPTED_EXIT_CODE } from "./turn";
import {
  buildRuntimeInterruptIgnoredSurface,
  buildRuntimeInterruptSurface,
} from "./startup/surfaces";

export type RuntimeInterruptSource = "command" | "cli_esc";

export interface RuntimeInterruptController {
  setActiveController(controller: AbortController | undefined): void;
  getActiveController(): AbortController | undefined;
  request(source: RuntimeInterruptSource): {
    code: "TURN_INTERRUPT_OK" | "TURN_INTERRUPT_NOT_RUNNING";
    interrupted: boolean;
  };
  reconcileTurnResult(input: {
    code: number;
    controller: AbortController;
    interactiveMode: boolean;
    writeStderr(message: string): void;
  }): void;
}

export interface CreateRuntimeInterruptControllerInput {
  writeStdout(message: string): void;
  writeStartupDiagnostics(message: string): void;
}

const TURN_INTERRUPT_OK_CODE = "TURN_INTERRUPT_OK";
const TURN_INTERRUPT_NOT_RUNNING_CODE = "TURN_INTERRUPT_NOT_RUNNING";

export function createRuntimeInterruptController(
  input: CreateRuntimeInterruptControllerInput,
): RuntimeInterruptController {
  let activeTurnAbortController: AbortController | undefined;
  let pendingRuntimeInterruptSource: RuntimeInterruptSource | undefined;

  const request = (
    source: RuntimeInterruptSource,
  ): {
    code:
      | typeof TURN_INTERRUPT_OK_CODE
      | typeof TURN_INTERRUPT_NOT_RUNNING_CODE;
    interrupted: boolean;
  } => {
    const controller = activeTurnAbortController;
    if (!controller || controller.signal.aborted) {
      input.writeStdout(
        buildRuntimeInterruptSurface({
          code: TURN_INTERRUPT_NOT_RUNNING_CODE,
          kind: "not_running",
          source,
        }),
      );
      input.writeStartupDiagnostics(
        `[interrupt] event=rejected reason=no_active_turn source=${source}\n`,
      );
      return {
        code: TURN_INTERRUPT_NOT_RUNNING_CODE,
        interrupted: false,
      };
    }
    controller.abort(`source=${source}`);
    pendingRuntimeInterruptSource = source;
    input.writeStdout(
      buildRuntimeInterruptSurface({
        code: TURN_INTERRUPT_OK_CODE,
        kind: "requested",
        source,
      }),
    );
    input.writeStartupDiagnostics(
      `[interrupt] event=requested source=${source}\n`,
    );
    return {
      code: TURN_INTERRUPT_OK_CODE,
      interrupted: true,
    };
  };

  const reconcileTurnResult = (turn: {
    code: number;
    controller: AbortController;
    interactiveMode: boolean;
    writeStderr(message: string): void;
  }): void => {
    if (
      pendingRuntimeInterruptSource &&
      turn.code === TURN_INTERRUPTED_EXIT_CODE
    ) {
      input.writeStartupDiagnostics(
        `[interrupt] event=applied source=${pendingRuntimeInterruptSource} interactive=${turn.interactiveMode ? "true" : "false"}\n`,
      );
      pendingRuntimeInterruptSource = undefined;
      return;
    }
    if (
      pendingRuntimeInterruptSource &&
      turn.controller.signal.aborted &&
      turn.code !== TURN_INTERRUPTED_EXIT_CODE
    ) {
      input.writeStartupDiagnostics(
        `[interrupt] event=ignored source=${pendingRuntimeInterruptSource} reason=turn_completed_before_abort interactive=${turn.interactiveMode ? "true" : "false"}\n`,
      );
      turn.writeStderr(
        buildRuntimeInterruptIgnoredSurface({
          source: pendingRuntimeInterruptSource,
        }),
      );
      pendingRuntimeInterruptSource = undefined;
    }
  };

  return {
    setActiveController: (controller) => {
      activeTurnAbortController = controller;
    },
    getActiveController: () => activeTurnAbortController,
    request,
    reconcileTurnResult,
  };
}
