import {
  dispatchSessionInteractiveInput,
  type SessionInteractiveAction,
  type SessionInteractiveControls,
  type SessionInteractiveRewindCheckpointSummary,
  type SessionInteractiveRewindMode,
  type SessionMenuMode,
} from "./session-interactive";
import { type PlanInterruptSource } from "./run-start-plan-mode";
import { TURN_INTERRUPTED_EXIT_CODE } from "./run-start-turn";

interface CreateRunStartInteractiveHandlerInput {
  writeStdout(message: string): void;
  writeStderr(message: string): void;
  hasPendingAsk(): boolean;
  getPendingAskQueueSize(): number;
  getPendingAskPromptSummary?(): string | undefined;
  showPendingAskQueue(limit?: number): void;
  selectPendingAskAnswer(
    withInputPaused: SessionInteractiveControls["withInputPaused"],
  ): Promise<string | undefined>;
  showHelp(): void;
  showHealthStatus(): void;
  showContextStatus(): void;
  showMemoryStatus(): void;
  showSkillsStatus(): void;
  showMcpStatus(): void;
  runInitProjectInstructions(): Promise<void>;
  openModelMenu(withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  showStatusCurrent(): void;
  setStatusTheme(theme: string): void;
  setStatusLayoutMode(layoutMode: string): void;
  setStatusSegmentEnabled(segmentId: string, enabled: boolean): void;
  openStatusMenu(withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  openSessionMenu(
    mode: SessionMenuMode,
    withInputPaused: SessionInteractiveControls["withInputPaused"],
  ): Promise<void>;
  listSessionSummaries?(): Array<{
    id: string;
    title: string;
    summary: string;
    updatedAt: string;
    active: boolean;
  }>;
  getActiveSessionId?(): string;
  listRewindCheckpoints?(
    sessionId: string,
    limit?: number,
  ): SessionInteractiveRewindCheckpointSummary[];
  rewindSession?(input: {
    sessionId: string;
    checkpointId?: string;
    mode: SessionInteractiveRewindMode;
    fileFilter?: readonly string[];
    reason?: string;
    summaryLimit?: number;
  }): Promise<boolean>;
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
  handleUserCommandsCommand(userInput: string): Promise<void>;
  openCommandsMenu(withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  openPlanInEditor(withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  showHistory(query?: string): Promise<void>;
  promptSkillCreatorRequirement(
    withInputPaused: SessionInteractiveControls["withInputPaused"],
  ): Promise<string | undefined>;
  runSkillCreator(requirement: string): Promise<void>;
  tryRunUserCommand(userInput: string): Promise<boolean>;
  executeTurn(
    userInput: string,
    interactiveMode: boolean,
    options?: {
      promptPrelude?: string;
      writeStderr?: (message: string) => void;
    },
  ): Promise<number>;
  markFailureObserved(): void;
}

export function createRunStartInteractiveHandler(
  input: CreateRunStartInteractiveHandlerInput,
): (userInputRaw: string, controls: SessionInteractiveControls) => Promise<SessionInteractiveAction> {
  const shouldMarkFailure = (code: number): boolean =>
    code !== 0 && code !== TURN_INTERRUPTED_EXIT_CODE;

  return async (
    userInputRaw: string,
    controls: SessionInteractiveControls,
  ): Promise<SessionInteractiveAction> =>
    dispatchSessionInteractiveInput(userInputRaw, controls, {
      writeStdout: input.writeStdout,
      hasPendingAsk: input.hasPendingAsk,
      getPendingAskQueueSize: input.getPendingAskQueueSize,
      getPendingAskPromptSummary: () => input.getPendingAskPromptSummary?.(),
      showPendingAskQueue: (limit) => {
        input.showPendingAskQueue(limit);
      },
      selectPendingAskAnswer: async (withInputPaused) =>
        input.selectPendingAskAnswer(withInputPaused),
      showHelp: input.showHelp,
      showHealthStatus: input.showHealthStatus,
      showContextStatus: input.showContextStatus,
      showMemoryStatus: input.showMemoryStatus,
      showSkillsStatus: input.showSkillsStatus,
      showMcpStatus: input.showMcpStatus,
      openModelMenu: async (withInputPaused) => {
        await input.openModelMenu(withInputPaused);
      },
      showStatusCurrent: () => {
        input.showStatusCurrent();
      },
      setStatusTheme: (theme) => {
        input.setStatusTheme(theme);
      },
      setStatusLayoutMode: (layoutMode) => {
        input.setStatusLayoutMode(layoutMode);
      },
      setStatusSegmentEnabled: (segmentId, enabled) => {
        input.setStatusSegmentEnabled(segmentId, enabled);
      },
      openStatusMenu: async (withInputPaused) => {
        await input.openStatusMenu(withInputPaused);
      },
      openSessionMenu: async (mode, withInputPaused) => {
        await input.openSessionMenu(mode, withInputPaused);
      },
      listSessionSummaries: () => input.listSessionSummaries?.() ?? [],
      getActiveSessionId: () => input.getActiveSessionId?.() ?? "",
      listRewindCheckpoints: (sessionId, limit) =>
        input.listRewindCheckpoints?.(sessionId, limit) ?? [],
      rewindSession: async (rewindInput) => {
        if (!input.rewindSession) {
          return false;
        }
        return input.rewindSession(rewindInput);
      },
      createAndSwitchSession: async () => {
        const nextId = await input.createNewSession();
        await input.switchActiveSession(nextId, "new");
      },
      switchSession: async (targetSessionId) => {
        await input.switchActiveSession(targetSessionId, "switch");
      },
      continueFromSession: async (sourceSessionId) => {
        await input.continueFromSession(sourceSessionId);
      },
      writeHandoff: input.writeHandoff,
      isPlanMode: input.isPlanMode,
      showPlanStatus: async () => {
        await input.showPlanStatus();
      },
      enterPlan: async (goal) => {
        const code = await input.enterPlan(goal);
        if (shouldMarkFailure(code)) {
          input.markFailureObserved();
        }
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
      handleUserCommandsCommand: async (userInput) => {
        await input.handleUserCommandsCommand(userInput);
      },
      openCommandsMenu: async (withInputPaused) => {
        await input.openCommandsMenu(withInputPaused);
      },
      openPlanInEditor: async (withInputPaused) => {
        await input.openPlanInEditor(withInputPaused);
      },
      showHistory: async (query) => {
        await input.showHistory(query);
      },
      promptSkillCreatorRequirement: async (withInputPaused) =>
        input.promptSkillCreatorRequirement(withInputPaused),
      runSkillCreator: async (requirement) => {
        await input.runSkillCreator(requirement);
      },
      runInitProjectInstructions: async () => {
        await input.runInitProjectInstructions();
      },
      tryRunUserCommand: async (userInput) => input.tryRunUserCommand(userInput),
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
