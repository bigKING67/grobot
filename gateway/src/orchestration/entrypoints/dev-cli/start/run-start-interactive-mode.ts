import { SessionStoreRuntime } from "../services/session-store";
import { printRunStartBanner } from "./run-start-banner";
import { createRunStartInteractiveHandler } from "./run-start-interactive-handler";
import { runSessionInputLoop } from "./run-start-io";

interface RunStartInteractiveModeInput {
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
  printSessionOverview(): void;
  createNewSession(): Promise<string>;
  switchActiveSession(targetSessionId: string, reason: string): Promise<boolean>;
  continueFromSession(sourceSessionId: string): Promise<void>;
  writeManualHandoff(): void;
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
    showSessions: () => {
      input.printSessionOverview();
    },
    createNewSession: input.createNewSession,
    switchActiveSession: input.switchActiveSession,
    continueFromSession: input.continueFromSession,
    writeHandoff: input.writeManualHandoff,
    executeTurn: input.executeTurn,
    markFailureObserved: input.markFailureObserved,
  });

  await runSessionInputLoop(handleInteractiveInput, "grobot> ");

  if (input.handoffAutoOnExit && input.getHistoryMessagesCount() > 0) {
    input.writeAutoExitHandoffIfNeeded();
  }
}
