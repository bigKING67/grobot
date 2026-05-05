import { type ExecutionPlaneConfig } from "../../../orchestration/execution-plane";
import {
  type RuntimeAttachment,
  type RuntimeModelConfig,
  type RuntimeToolContext,
} from "../../../models/types";
import { type GaMechanismRuntime, type GaSessionStateSnapshot } from "../../services/ga-mechanism-runtime";
import { type ExperiencePoolRuntime } from "../../services/experience-pool-runtime";
import { type MemoryOrchestrator } from "../../../tools/memory";
import { type ContextEngineConfig } from "../../../tools/context";
import { type ChatHistoryMessage } from "../session/history";
import { type SessionProviderRuntimeState } from "../session-registry";

export interface RuntimeProviderCandidate {
  name: string;
  modelConfig: RuntimeModelConfig;
  source: string;
  priority?: number;
  weight?: number;
  unitCost?: number;
  maxInFlight?: number;
  requestsPerMinute?: number;
  burst?: number;
}

export interface RuntimeFailoverConfig {
  circuitFailures: number;
  circuitCooldownSecs: number;
  stickyMode: "session_key";
}

export type KimiSearchRoutingPolicy =
  | "mcp_first_fallback_builtin"
  | "builtin_only"
  | "mcp_only";

export interface TurnTerminalOutputSegments {
  activityFeed: string;
  assistantOutput: string;
}

export interface RunStartTurnExecuteOptions {
  signal?: AbortSignal;
  attachments?: RuntimeAttachment[];
  promptPrelude?: string;
  autoOpenAskUserPanel?: boolean;
  emitDiagnostics?: boolean;
  writeStdout?: (message: string) => void;
  writeStderr?: (message: string) => void;
  onTurnRecorded?(input: {
    userText: string;
    assistantText: string;
    historyAfter: ChatHistoryMessage[];
  }): Promise<void> | void;
}

export interface RunStartTurnPromptBudgetSnapshot {
  contextWindowUsageRatio?: number;
  estimatedTokens?: number;
  targetTokenLimit?: number;
}

export interface CreateRunStartTurnRunnerInput {
  interruptStorePath: string;
  historyTurns: number;
  projectName: string;
  projectRoot: string;
  workDir: string;
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
  memoryOrchestrator: MemoryOrchestrator;
  experiencePoolRuntime: ExperiencePoolRuntime;
  getSessionKey(): string;
  getHistoryMessages(): ChatHistoryMessage[];
  setHistoryMessages(rows: ChatHistoryMessage[]): void;
  getStickyProvider(): string | undefined;
  setStickyProvider(value: string | undefined): void;
  getProviderRuntimeStates(): SessionProviderRuntimeState[];
  setProviderRuntimeStates(rows: SessionProviderRuntimeState[]): void;
  getGaState(): GaSessionStateSnapshot | undefined;
  setGaState(value: GaSessionStateSnapshot | undefined): void;
  onHistoryCompacted(): void;
  onVerificationFailure(): void;
  touchActiveSession(userText: string): void;
  updateActiveSessionProviderRuntime(
    stickyProvider: string | undefined,
    providerRuntimeStates: readonly SessionProviderRuntimeState[],
  ): void;
  updateActiveSessionGaState(gaState: GaSessionStateSnapshot | undefined): void;
  persistHistoryState(): Promise<void>;
  persistSessionRegistryState(): Promise<void>;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
  onPromptBudgetSnapshot?(snapshot: RunStartTurnPromptBudgetSnapshot): void;
}
