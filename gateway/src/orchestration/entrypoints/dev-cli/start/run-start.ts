import { OptionValue, readOptionString } from "../cli-args";
import { buildInteractiveHelpText } from "./session-interactive";
import { bootstrapRunStartState } from "./run-start-bootstrap";
import { resolveRunStartContext } from "./run-start-context";
import { runStartInteractiveMode } from "./run-start-interactive-mode";
import { runStartMessageMode } from "./run-start-message-mode";
import { createRunStartOutput } from "./run-start-output";
import { createRunStartPersistence } from "./run-start-persistence";
import { createRunStartRuntimeState } from "./run-start-runtime-state";
import { createRunStartWire } from "./run-start-wire";

export async function runStart(options: Record<string, OptionValue>): Promise<number> {
  const context = resolveRunStartContext(options);
  const {
    homeDir,
    projectRoot,
    workDir,
    projectName,
    historyTurns,
    handoffRecentTurns,
    handoffAutoOnExit,
    handoffPath,
    interruptStorePath,
    subject,
    executionPlane,
    sessionNamespaceKey,
    sessionRegistryFilePathValue,
    sessionStore,
  } = context;
  const output = createRunStartOutput();

  const bootstrapState = await bootstrapRunStartState({
    sessionNamespaceKey,
    sessionStore,
    writeSessionWarnings: output.writeSessionWarnings,
    writeStoreWarnings: output.writeStoreWarnings,
  });

  const runtimeState = createRunStartRuntimeState({ bootstrapState });
  const persistence = createRunStartPersistence({
    sessionStore,
    runtimeState,
    writeSessionWarnings: output.writeSessionWarnings,
    writeStoreWarnings: output.writeStoreWarnings,
  });

  const { handoff, sessionOps, executeTurn } = createRunStartWire({
    sessionNamespaceKey,
    historyTurns,
    sessionStore,
    projectName,
    workDir,
    handoffPath,
    handoffRecentTurns,
    interruptStorePath,
    subject,
    executionPlane,
    runtimeState,
    persistence,
    writeStoreWarnings: output.writeStoreWarnings,
    writeStdout: output.writeStdout,
    writeStderr: output.writeStderr,
  });

  const message = readOptionString(options, "message");
  if (message) {
    return runStartMessageMode({
      message,
      executeTurn,
      markFailureObserved: runtimeState.markFailureObserved,
      handoffAutoOnExit,
      writeAutoExitHandoffIfNeeded: () => {
        handoff.writeAutoExitHandoffIfNeeded(true);
      },
    });
  }

  await runStartInteractiveMode({
    homeDir,
    projectRoot,
    projectName,
    workDir,
    sessionKey: runtimeState.getSessionKey(),
    sessionNamespaceKey,
    activeSessionId: runtimeState.getActiveSessionId(),
    sessionStoreRuntime: sessionStore.getRuntime(),
    sessionRegistryFilePathValue,
    handoffAutoOnExit,
    handoffRecentTurns,
    handoffPath,
    restoredTurns: runtimeState.getRestoredTurns(),
    restoreSource: runtimeState.getRestoreSource(),
    buildHelpText: buildInteractiveHelpText,
    printSessionOverview: () => {
      sessionOps.printSessionOverview();
    },
    createNewSession: sessionOps.createNewSession,
    switchActiveSession: sessionOps.switchActiveSession,
    continueFromSession: sessionOps.continueFromSession,
    writeManualHandoff: () => {
      handoff.writeHandoff("manual-command", false);
    },
    executeTurn,
    markFailureObserved: runtimeState.markFailureObserved,
    getHistoryMessagesCount: () => runtimeState.getHistoryMessages().length,
    writeAutoExitHandoffIfNeeded: () => {
      handoff.writeAutoExitHandoffIfNeeded(false);
    },
  });
  return 0;
}
