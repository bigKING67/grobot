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
  isPlanMode(): boolean;
  showPlanStatus(): Promise<number>;
  showPlanContent(): Promise<number>;
  showPlanOptions(): Promise<number>;
  enterPlan(goal: string): Promise<number>;
  applyPlan(extra: string): Promise<number>;
  discardPlan(): Promise<number>;
  runPlanTurn(userInput: string): Promise<number>;
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
      isPlanMode: input.isPlanMode,
      showPlanStatus: async () => {
        await input.showPlanStatus();
      },
      showPlanContent: async () => {
        await input.showPlanContent();
      },
      showPlanOptions: async () => {
        await input.showPlanOptions();
      },
      enterPlan: async (goal) => {
        await input.enterPlan(goal);
      },
      applyPlan: async (extra) => {
        const code = await input.applyPlan(extra);
        if (code !== 0) {
          input.markFailureObserved();
        }
      },
      discardPlan: async () => {
        const code = await input.discardPlan();
        if (code !== 0) {
          input.markFailureObserved();
        }
      },
      runPlanTurn: async (userInput) => {
        const code = await input.runPlanTurn(userInput);
        if (code !== 0) {
          input.markFailureObserved();
        }
      },
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
