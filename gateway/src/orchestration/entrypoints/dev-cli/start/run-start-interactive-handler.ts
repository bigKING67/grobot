import {
  dispatchSessionInteractiveInput,
  type SessionInteractiveAction,
  type SessionInteractiveControls,
  type SessionMenuMode,
} from "./session-interactive";
import { type PlanInterruptSource } from "./run-start-plan-mode";
import { TURN_INTERRUPTED_EXIT_CODE } from "./run-start-turn";

interface CreateRunStartInteractiveHandlerInput {
  writeStdout(message: string): void;
  writeStderr(message: string): void;
  showHelp(): void;
  showHealthStatus(): void;
  showModelCurrent(): Promise<void>;
  listModels(): Promise<void>;
  useModel(modelId: string): Promise<void>;
  resetModel(): Promise<void>;
  openModelMenu(withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  openSessionMenu(
    mode: SessionMenuMode,
    withInputPaused: SessionInteractiveControls["withInputPaused"],
  ): Promise<void>;
  createNewSession(): Promise<string>;
  switchActiveSession(targetSessionId: string, reason: string): Promise<boolean>;
  continueFromSession(sourceSessionId: string): Promise<void>;
  writeHandoff(): void;
  isPlanMode(): boolean;
  showPlanStatus(): Promise<number>;
  enterPlan(goal: string): Promise<number>;
  applyPlan(extra: string): Promise<number>;
  cancelPlan(): Promise<number>;
  requestPlanInterrupt(source: PlanInterruptSource): Promise<void>;
  requestRuntimeInterrupt(source: PlanInterruptSource): Promise<void>;
  runPlanTurn(userInput: string): Promise<number>;
  executeTurn(userInput: string, interactiveMode: boolean): Promise<number>;
  markFailureObserved(): void;
}

export function createRunStartInteractiveHandler(
  input: CreateRunStartInteractiveHandlerInput,
): (userInputRaw: string, controls: SessionInteractiveControls) => Promise<SessionInteractiveAction> {
  const shouldMarkFailure = (code: number): boolean => code !== 0 && code !== TURN_INTERRUPTED_EXIT_CODE;
  return async (userInputRaw: string, controls: SessionInteractiveControls): Promise<SessionInteractiveAction> =>
    dispatchSessionInteractiveInput(userInputRaw, controls, {
      writeStdout: input.writeStdout,
      showHelp: input.showHelp,
      showHealthStatus: input.showHealthStatus,
      showModelCurrent: async () => {
        await input.showModelCurrent();
      },
        listModels: async () => {
          await input.listModels();
        },
        useModel: async (modelId) => {
          await input.useModel(modelId);
        },
        resetModel: async () => {
          await input.resetModel();
        },
        openModelMenu: async (withInputPaused) => {
          await input.openModelMenu(withInputPaused);
        },
      openSessionMenu: async (mode, withInputPaused) => {
        await input.openSessionMenu(mode, withInputPaused);
      },
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
        enterPlan: async (goal) => {
          await input.enterPlan(goal);
        },
        applyPlan: async (extra) => {
          const code = await input.applyPlan(extra);
          if (shouldMarkFailure(code)) {
            input.markFailureObserved();
          }
        },
        cancelPlan: async () => {
          const code = await input.cancelPlan();
          if (shouldMarkFailure(code)) {
            input.markFailureObserved();
          }
        },
        requestPlanInterrupt: async (source) => {
          await input.requestPlanInterrupt(source);
        },
        requestRuntimeInterrupt: async (source) => {
          await input.requestRuntimeInterrupt(source);
        },
        runPlanTurn: async (userInput) => {
          const code = await input.runPlanTurn(userInput);
          if (shouldMarkFailure(code)) {
            input.markFailureObserved();
          }
        },
        runTurn: async (userInput) => {
          const code = await input.executeTurn(userInput, true);
          if (shouldMarkFailure(code)) {
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
