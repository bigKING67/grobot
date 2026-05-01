import { TURN_INTERRUPTED_EXIT_CODE } from "./run-start-turn";

interface RunStartMessageModeInput {
  message: string;
  executeTurn(
    userInput: string,
    interactiveMode: boolean,
    options?: { emitDiagnostics?: boolean },
  ): Promise<number>;
  emitDiagnostics?: boolean;
  markFailureObserved(): void;
  handoffAutoOnExit: boolean;
  writeAutoExitHandoffIfNeeded(): void;
}

export async function runStartMessageMode(input: RunStartMessageModeInput): Promise<number> {
  const code = await input.executeTurn(input.message, false, {
    emitDiagnostics: input.emitDiagnostics === true,
  });
  if (code !== 0 && code !== TURN_INTERRUPTED_EXIT_CODE) {
    input.markFailureObserved();
  }
  if (input.handoffAutoOnExit) {
    input.writeAutoExitHandoffIfNeeded();
  }
  return code;
}
