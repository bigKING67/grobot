import { OptionValue, readOptionString } from "../cli-args";
import { buildInteractiveHelpText } from "./session-interactive";
import { bootstrapRunStartState } from "./run-start-bootstrap";
import { resolveRunStartContext } from "./run-start-context";
import { createRunStartInteractiveModeInput } from "./run-start-interactive-bindings";
import { runStartInteractiveMode } from "./run-start-interactive-mode";
import { createRunStartModelOps } from "./run-start-model-ops";
import { createRunStartSessionMenuOps } from "./run-start-session-menu-ops";
import { runStartMessageMode } from "./run-start-message-mode";
import { createRunStartOutput } from "./run-start-output";
import { createRunStartPersistence } from "./run-start-persistence";
import { createRunStartRuntimeState } from "./run-start-runtime-state";
import { createRunStartWire } from "./run-start-wire";
import { createRunStartPlanMode } from "./run-start-plan-mode";
import { createGaMechanismRuntime } from "../services/ga-mechanism-runtime";

export async function runStart(
  options: Record<string, OptionValue>,
): Promise<number> {
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
    runtimeModelConfig,
    runtimeProviderChain,
    runtimeFailoverConfig,
    runtimeModelConfigSource,
    runtimeToolContext,
    kimiSearchRoutingPolicy,
    mcpInstructionPromptPrefix,
    mcpInstructionServerNames,
    mcpInstructionEvents,
    mcpInstructionStrictFailure,
    sessionNamespaceKey,
    sessionRegistryFilePathValue,
    sessionStore,
  } = context;
  const output = createRunStartOutput();
  for (const event of mcpInstructionEvents) {
    output.writeStderr(`[governance:mcp-instruction] ${event}\n`);
  }
  if (mcpInstructionStrictFailure) {
    output.writeStderr(
      `[governance:mcp-instruction] event=strict_failure reason=${mcpInstructionStrictFailure}\n`,
    );
    return 1;
  }

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
  const gaMechanismRuntime = createGaMechanismRuntime();

  const wire = createRunStartWire({
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
    runtimeModelConfig,
    runtimeProviderChain,
    runtimeFailoverConfig,
    runtimeModelConfigSource,
    runtimeToolContext,
    gaMechanismRuntime,
    kimiSearchRoutingPolicy,
    mcpInstructionPromptPrefix,
    mcpInstructionServerNames,
    runtimeState,
    persistence,
    writeStoreWarnings: output.writeStoreWarnings,
    writeStdout: output.writeStdout,
    writeStderr: output.writeStderr,
  });
  const { handoff, sessionOps, executeTurn } = wire;

  const modelOps = createRunStartModelOps({
    runtimeProviderChain,
    runtimeModelConfig,
    runtimeModelConfigSource,
    getActiveSessionId: runtimeState.getActiveSessionId,
    getActiveSessionMetadata: () => {
      const activeSessionId = runtimeState.getActiveSessionId();
      const activeSession = sessionOps
        .listSessions()
        .find((item) => item.id === activeSessionId);
      if (!activeSession) {
        return undefined;
      }
      return {
        title: activeSession.title,
        summary: activeSession.summary,
      };
    },
    writeStdout: output.writeStdout,
  });

  const sessionMenuOps = createRunStartSessionMenuOps({
    sessionNamespaceKey,
    listSessions: sessionOps.listSessions,
    printSessionOverview: sessionOps.printSessionOverview,
    createNewSession: sessionOps.createNewSession,
    switchActiveSession: sessionOps.switchActiveSession,
    continueFromSession: sessionOps.continueFromSession,
    applyModelOverrideForActiveSession:
      modelOps.applyModelOverrideForActiveSession,
    writeStdout: output.writeStdout,
  });

  modelOps.applyModelOverrideForActiveSession();

  const planMode = createRunStartPlanMode({
    workDir,
    runtimeState,
    persistence,
    executeTurn,
    markFailureObserved: runtimeState.markFailureObserved,
    writeStdout: output.writeStdout,
    writeStderr: output.writeStderr,
  });

  const message = readOptionString(options, "message");
  if (message) {
    const planHandled = await planMode.handleMessageInput(message);
    if (planHandled.handled) {
      if (planHandled.code !== 0) {
        runtimeState.markFailureObserved();
      }
      if (handoffAutoOnExit) {
        handoff.writeAutoExitHandoffIfNeeded(true);
      }
      return planHandled.code;
    }
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

  await runStartInteractiveMode(
    createRunStartInteractiveModeInput({
      homeDir,
      projectRoot,
      projectName,
      workDir,
      sessionNamespaceKey,
      sessionStoreRuntime: sessionStore.getRuntime(),
      sessionRegistryFilePathValue,
      handoffAutoOnExit,
      handoffRecentTurns,
      handoffPath,
      buildHelpText: buildInteractiveHelpText,
      runtimeProviderChain,
      runtimeFailoverConfig,
      runtimeState,
      output,
      modelOps,
      sessionMenuOps,
      wire,
      planMode,
    }),
  );
  return 0;
}
