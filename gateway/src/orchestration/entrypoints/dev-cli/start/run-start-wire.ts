import { type ExecutionPlaneConfig } from "../../../execution-plane";
import { type SessionStoreController } from "../services/session-store";
import { createRunStartHandoff } from "./run-start-handoff";
import { createRunStartSessionOps } from "./run-start-session-ops";
import { createRunStartTurnRunner } from "./run-start-turn";
import { type RunStartPersistence } from "./run-start-persistence";
import { type RunStartRuntimeState } from "./run-start-runtime-state";
import { type ChatHistoryMessage } from "./session-history";
import { type SessionRegistryPayload, touchSessionRecord } from "./session-registry";

interface CreateRunStartWireInput {
  sessionNamespaceKey: string;
  historyTurns: number;
  sessionStore: SessionStoreController<SessionRegistryPayload, ChatHistoryMessage>;
  projectName: string;
  workDir: string;
  handoffPath: string;
  handoffRecentTurns: number;
  interruptStorePath: string;
  subject: string;
  executionPlane: ExecutionPlaneConfig;
  runtimeState: RunStartRuntimeState;
  persistence: RunStartPersistence;
  writeStoreWarnings(warnings: readonly string[]): void;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
}

export interface RunStartWire {
  handoff: ReturnType<typeof createRunStartHandoff>;
  sessionOps: ReturnType<typeof createRunStartSessionOps>;
  executeTurn: ReturnType<typeof createRunStartTurnRunner>;
}

export function createRunStartWire(input: CreateRunStartWireInput): RunStartWire {
  const handoff = createRunStartHandoff({
    getSessionKey: input.runtimeState.getSessionKey,
    projectName: input.projectName,
    workDir: input.workDir,
    handoffPath: input.handoffPath,
    handoffRecentTurns: input.handoffRecentTurns,
    getHistoryMessages: input.runtimeState.getHistoryMessages,
    hasHistoryCompacted: input.runtimeState.hasHistoryCompacted,
    hasFailureObserved: input.runtimeState.hasFailureObserved,
    writeStdout: input.writeStdout,
    writeStderr: input.writeStderr,
  });

  const sessionOps = createRunStartSessionOps({
    sessionNamespaceKey: input.sessionNamespaceKey,
    historyTurns: input.historyTurns,
    sessionStore: input.sessionStore,
    getSessionRegistry: input.runtimeState.getSessionRegistry,
    getActiveSessionId: input.runtimeState.getActiveSessionId,
    setActiveSessionId: input.runtimeState.setActiveSessionId,
    setSessionKey: input.runtimeState.setSessionKey,
    getHistoryMessages: input.runtimeState.getHistoryMessages,
    setHistoryMessages: input.runtimeState.setHistoryMessages,
    onHistoryCompacted: input.runtimeState.markHistoryCompacted,
    persistSessionRegistryState: input.persistence.persistSessionRegistryState,
    persistHistoryState: input.persistence.persistHistoryState,
    writeStoreWarnings: input.writeStoreWarnings,
    writeStdout: input.writeStdout,
  });

  const executeTurn = createRunStartTurnRunner({
    interruptStorePath: input.interruptStorePath,
    historyTurns: input.historyTurns,
    projectName: input.projectName,
    subject: input.subject,
    executionPlane: input.executionPlane,
    getSessionKey: input.runtimeState.getSessionKey,
    getHistoryMessages: input.runtimeState.getHistoryMessages,
    setHistoryMessages: input.runtimeState.setHistoryMessages,
    onHistoryCompacted: input.runtimeState.markHistoryCompacted,
    onVerificationFailure: input.runtimeState.markFailureObserved,
    touchActiveSession: (userText) => {
      touchSessionRecord(
        input.runtimeState.getSessionRegistry(),
        input.runtimeState.getActiveSessionId(),
        userText,
      );
    },
    persistHistoryState: input.persistence.persistHistoryState,
    persistSessionRegistryState: input.persistence.persistSessionRegistryState,
    writeStdout: input.writeStdout,
    writeStderr: input.writeStderr,
  });

  return {
    handoff,
    sessionOps,
    executeTurn,
  };
}
