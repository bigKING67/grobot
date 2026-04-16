import { SessionStoreRuntime } from "../services/session-store";
import { SessionInteractiveControls, type SessionMenuMode } from "./session-interactive";
import { printRunStartBanner } from "./run-start-banner";
import { createRunStartInteractiveHandler } from "./run-start-interactive-handler";
import { runSessionInputLoop } from "./run-start-io";
import { type PlanInterruptSource } from "./run-start-plan-mode";

export interface RunStartInteractiveModeInput {
  homeDir: string;
  projectRoot: string;
  projectName: string;
  workDir: string;
  sessionKey: string;
  sessionNamespaceKey: string;
  activeSessionId: string;
  sessionStoreRuntime: SessionStoreRuntime;
  sessionRegistryFilePathValue: string;
  handoffAutoOnExit: boolean;
  handoffRecentTurns: number;
  handoffPath: string;
  restoredTurns: number;
  restoreSource: "store" | "empty";
  buildHelpText(): string;
  showHealthStatus(): void;
  showModelCurrent(): Promise<void>;
  listModels(): Promise<void>;
  useModel(modelId: string): Promise<void>;
  resetModel(): Promise<void>;
  openModelMenu(withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  openSessionMenu(mode: SessionMenuMode, withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  createNewSession(): Promise<string>;
  switchActiveSession(targetSessionId: string, reason: string): Promise<boolean>;
  continueFromSession(sourceSessionId: string): Promise<void>;
  writeManualHandoff(): void;
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
  getHistoryMessagesCount(): number;
  writeAutoExitHandoffIfNeeded(): void;
}

export async function runStartInteractiveMode(input: RunStartInteractiveModeInput): Promise<void> {
  printRunStartBanner({
    homeDir: input.homeDir,
    projectRoot: input.projectRoot,
    projectName: input.projectName,
    workDir: input.workDir,
    sessionKey: input.sessionKey,
    sessionNamespaceKey: input.sessionNamespaceKey,
    activeSessionId: input.activeSessionId,
    sessionStoreRuntime: input.sessionStoreRuntime,
    sessionRegistryFilePathValue: input.sessionRegistryFilePathValue,
    handoffAutoOnExit: input.handoffAutoOnExit,
    handoffRecentTurns: input.handoffRecentTurns,
    handoffPath: input.handoffPath,
    restoredTurns: input.restoredTurns,
    restoreSource: input.restoreSource,
  });

  const handleInteractiveInput = createRunStartInteractiveHandler({
    writeStdout: (message) => {
      process.stdout.write(message);
    },
    writeStderr: (message) => {
      process.stderr.write(message);
    },
    showHelp: () => {
      process.stdout.write(input.buildHelpText());
    },
      showHealthStatus: () => {
        input.showHealthStatus();
      },
      showModelCurrent: input.showModelCurrent,
      listModels: input.listModels,
      useModel: input.useModel,
      resetModel: input.resetModel,
      openModelMenu: input.openModelMenu,
    openSessionMenu: async (mode, withInputPaused) => {
      await input.openSessionMenu(mode, withInputPaused);
    },
      createNewSession: input.createNewSession,
      switchActiveSession: input.switchActiveSession,
      continueFromSession: input.continueFromSession,
      writeHandoff: input.writeManualHandoff,
      isPlanMode: input.isPlanMode,
      showPlanStatus: input.showPlanStatus,
      enterPlan: input.enterPlan,
      applyPlan: input.applyPlan,
      cancelPlan: input.cancelPlan,
      requestPlanInterrupt: input.requestPlanInterrupt,
      requestRuntimeInterrupt: input.requestRuntimeInterrupt,
      runPlanTurn: input.runPlanTurn,
      executeTurn: input.executeTurn,
      markFailureObserved: input.markFailureObserved,
    });

  await runSessionInputLoop(handleInteractiveInput, "grobot> ", {
    onEscapeInterrupt: async () => {
      if (input.isPlanMode()) {
        await input.requestPlanInterrupt("cli_esc");
        return;
      }
      await input.requestRuntimeInterrupt("cli_esc");
    },
  });

  if (input.handoffAutoOnExit && input.getHistoryMessagesCount() > 0) {
    input.writeAutoExitHandoffIfNeeded();
  }
}
