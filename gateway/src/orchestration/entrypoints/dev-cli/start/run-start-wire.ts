import { type ExecutionPlaneConfig } from "../../../execution-plane";
import { type RuntimeModelConfig } from "../../../../models/types";
import { type SessionStoreController } from "../services/session-store";
import { createRunStartHandoff } from "./run-start-handoff";
import { createRunStartSessionOps } from "./run-start-session-ops";
import {
  createRunStartTurnRunner,
  type RuntimeFailoverConfig,
  type RuntimeProviderCandidate,
} from "./run-start-turn";
import { type RunStartPersistence } from "./run-start-persistence";
import { type RunStartRuntimeState } from "./run-start-runtime-state";
import { type ChatHistoryMessage } from "./session-history";
import { setSessionProviderRuntime, type SessionRegistryPayload, touchSessionRecord } from "./session-registry";

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
  runtimeModelConfig?: RuntimeModelConfig;
  runtimeProviderChain: RuntimeProviderCandidate[];
  runtimeFailoverConfig: RuntimeFailoverConfig;
  runtimeModelConfigSource: {
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: string;
  };
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
    setStickyProvider: input.runtimeState.setStickyProvider,
    setProviderRuntimeStates: input.runtimeState.setProviderRuntimeStates,
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
    runtimeModelConfig: input.runtimeModelConfig,
    runtimeProviderChain: input.runtimeProviderChain,
    runtimeFailoverConfig: input.runtimeFailoverConfig,
    runtimeModelConfigSource: input.runtimeModelConfigSource,
    getSessionKey: input.runtimeState.getSessionKey,
    getHistoryMessages: input.runtimeState.getHistoryMessages,
    setHistoryMessages: input.runtimeState.setHistoryMessages,
    getStickyProvider: input.runtimeState.getStickyProvider,
    setStickyProvider: input.runtimeState.setStickyProvider,
    getProviderRuntimeStates: input.runtimeState.getProviderRuntimeStates,
    setProviderRuntimeStates: input.runtimeState.setProviderRuntimeStates,
    onHistoryCompacted: input.runtimeState.markHistoryCompacted,
    onVerificationFailure: input.runtimeState.markFailureObserved,
    touchActiveSession: (userText) => {
      touchSessionRecord(
        input.runtimeState.getSessionRegistry(),
        input.runtimeState.getActiveSessionId(),
        userText,
      );
    },
    updateActiveSessionProviderRuntime: (stickyProvider, providerRuntimeStates) => {
      setSessionProviderRuntime(
        input.runtimeState.getSessionRegistry(),
        input.runtimeState.getActiveSessionId(),
        {
          stickyProvider,
          providerRuntimeStates,
        },
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
