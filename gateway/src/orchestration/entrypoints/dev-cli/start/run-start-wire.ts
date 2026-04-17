import { type ExecutionPlaneConfig } from "../../../execution-plane";
import { type RuntimeModelConfig, type RuntimeToolContext } from "../../../../models/types";
import { type ContextEngineConfig } from "../../../../tools/context";
import { type GaMechanismRuntime } from "../services/ga-mechanism-runtime";
import { type ExperiencePoolRuntime } from "../services/experience-pool-runtime";
import { type SessionStoreController } from "../services/session-store";
import { createRunStartHandoff } from "./run-start-handoff";
import { createRunStartSessionOps } from "./run-start-session-ops";
import {
  createRunStartTurnRunner,
  type KimiSearchRoutingPolicy,
  type RuntimeFailoverConfig,
  type RunStartTurnExecuteOptions,
  type RuntimeProviderCandidate,
} from "./run-start-turn";
import { type RunStartPersistence } from "./run-start-persistence";
import { type RunStartRuntimeState } from "./run-start-runtime-state";
import { type ChatHistoryMessage } from "./session-history";
import { setSessionGaState, setSessionProviderRuntime, type SessionRegistryPayload, touchSessionRecord } from "./session-registry";

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
  contextEngineConfig: ContextEngineConfig;
  runtimeModelConfigSource: {
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: string;
    providerKind: string;
  };
  runtimeToolContext?: RuntimeToolContext;
  gaMechanismRuntime: GaMechanismRuntime;
  kimiSearchRoutingPolicy: KimiSearchRoutingPolicy;
  mcpInstructionPromptPrefix?: string;
  mcpInstructionServerNames: string[];
  experiencePoolRuntime: ExperiencePoolRuntime;
  runtimeState: RunStartRuntimeState;
  persistence: RunStartPersistence;
  writeStoreWarnings(warnings: readonly string[]): void;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
}

export interface RunStartWire {
  handoff: ReturnType<typeof createRunStartHandoff>;
  sessionOps: ReturnType<typeof createRunStartSessionOps>;
  executeTurn: (
    userText: string,
    interactiveMode: boolean,
    options?: RunStartTurnExecuteOptions,
  ) => Promise<number>;
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
      setPlanMode: input.runtimeState.setPlanMode,
      setPlanMeta: input.runtimeState.setPlanMeta,
      setGaState: input.runtimeState.setGaState,
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
    workDir: input.workDir,
    subject: input.subject,
    executionPlane: input.executionPlane,
    runtimeModelConfig: input.runtimeModelConfig,
    runtimeProviderChain: input.runtimeProviderChain,
    runtimeFailoverConfig: input.runtimeFailoverConfig,
    contextEngineConfig: input.contextEngineConfig,
      runtimeModelConfigSource: input.runtimeModelConfigSource,
      runtimeToolContext: input.runtimeToolContext,
      gaMechanismRuntime: input.gaMechanismRuntime,
      kimiSearchRoutingPolicy: input.kimiSearchRoutingPolicy,
      mcpInstructionPromptPrefix: input.mcpInstructionPromptPrefix,
      mcpInstructionServerNames: input.mcpInstructionServerNames,
      experiencePoolRuntime: input.experiencePoolRuntime,
    getSessionKey: input.runtimeState.getSessionKey,
    getHistoryMessages: input.runtimeState.getHistoryMessages,
    setHistoryMessages: input.runtimeState.setHistoryMessages,
    getStickyProvider: input.runtimeState.getStickyProvider,
    setStickyProvider: input.runtimeState.setStickyProvider,
      getProviderRuntimeStates: input.runtimeState.getProviderRuntimeStates,
      setProviderRuntimeStates: input.runtimeState.setProviderRuntimeStates,
      getGaState: input.runtimeState.getGaState,
      setGaState: input.runtimeState.setGaState,
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
      updateActiveSessionGaState: (gaState) => {
        setSessionGaState(
          input.runtimeState.getSessionRegistry(),
          input.runtimeState.getActiveSessionId(),
          gaState,
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
