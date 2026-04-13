import {
  dispatchSessionInteractiveInput,
  type SessionInteractiveAction,
} from "./session-interactive";

interface CreateRunStartInteractiveHandlerInput {
  writeStdout(message: string): void;
  writeStderr(message: string): void;
  showHelp(): void;
  showHealthStatus(): void;
  showSessions(): void;
  createNewSession(): Promise<string>;
  switchActiveSession(targetSessionId: string, reason: string): Promise<boolean>;
  continueFromSession(sourceSessionId: string): Promise<void>;
  writeHandoff(): void;
  executeTurn(userInput: string, interactiveMode: boolean): Promise<number>;
  markFailureObserved(): void;
}

export function createRunStartInteractiveHandler(
  input: CreateRunStartInteractiveHandlerInput,
): (userInputRaw: string) => Promise<SessionInteractiveAction> {
  return async (userInputRaw: string): Promise<SessionInteractiveAction> =>
    dispatchSessionInteractiveInput(userInputRaw, {
      writeStdout: input.writeStdout,
      showHelp: input.showHelp,
      showHealthStatus: input.showHealthStatus,
      showSessions: input.showSessions,
      createAndSwitchSession: async () => {
        const nextId = await input.createNewSession();
        await input.switchActiveSession(nextId, "new");
      },
      switchSession: async (targetSessionId) => {
        await input.switchActiveSession(targetSessionId, "switch");
      },
      continueFromSession: input.continueFromSession,
      writeHandoff: input.writeHandoff,
      runTurn: async (userInput) => {
        const code = await input.executeTurn(userInput, true);
        if (code !== 0) {
          input.markFailureObserved();
        }
      },
      onTurnError: (error) => {
        input.markFailureObserved();
        input.writeStderr(`turn failed: ${String(error)}\n`);
        input.writeStdout("\n");
      },
    });
}
