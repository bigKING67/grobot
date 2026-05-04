import { type RunStartBootstrapState } from "./bootstrap";
import { type GaSessionStateSnapshot } from "../services/ga-mechanism-runtime";
import { type ChatHistoryMessage } from "./session-history";
import {
  type SessionPlanMeta,
  type SessionPlanMode,
  type SessionProviderRuntimeState,
  type SessionRegistryPayload,
} from "./session-registry";

interface CreateRunStartRuntimeStateInput {
  bootstrapState: RunStartBootstrapState;
}

export interface RunStartRuntimeState {
  getSessionRegistry(): SessionRegistryPayload;
  getActiveSessionId(): string;
  setActiveSessionId(value: string): void;
  getSessionKey(): string;
  setSessionKey(value: string): void;
  getHistoryMessages(): ChatHistoryMessage[];
  setHistoryMessages(rows: ChatHistoryMessage[]): void;
  getRestoreSource(): "store" | "empty";
  markHistoryCompacted(): void;
  hasHistoryCompacted(): boolean;
  markFailureObserved(): void;
  hasFailureObserved(): boolean;
  getRestoredTurns(): number;
  getStickyProvider(): string | undefined;
  setStickyProvider(value: string | undefined): void;
  getProviderRuntimeStates(): SessionProviderRuntimeState[];
  setProviderRuntimeStates(rows: SessionProviderRuntimeState[]): void;
  getPlanMode(): SessionPlanMode;
  setPlanMode(value: SessionPlanMode): void;
    getPlanMeta(): SessionPlanMeta | undefined;
    setPlanMeta(value: SessionPlanMeta | undefined): void;
    getGaState(): GaSessionStateSnapshot | undefined;
    setGaState(value: GaSessionStateSnapshot | undefined): void;
  }

export function createRunStartRuntimeState(input: CreateRunStartRuntimeStateInput): RunStartRuntimeState {
  let sessionRegistry = input.bootstrapState.sessionRegistry;
  let activeSessionId = input.bootstrapState.activeSessionId;
  let sessionKey = input.bootstrapState.sessionKey;
  let historyMessages = input.bootstrapState.historyMessages;
  let restoreSource = input.bootstrapState.restoreSource;
  let historyCompacted = false;
  let failureObserved = false;
  let stickyProvider = input.bootstrapState.stickyProvider;
  let providerRuntimeStates = input.bootstrapState.providerRuntimeStates;
  let planMode = input.bootstrapState.planMode;
  let planMeta = input.bootstrapState.planMeta;
  let gaState = input.bootstrapState.gaState;

  return {
    getSessionRegistry: (): SessionRegistryPayload => sessionRegistry,
    getActiveSessionId: (): string => activeSessionId,
    setActiveSessionId: (value: string): void => {
      activeSessionId = value;
    },
    getSessionKey: (): string => sessionKey,
    setSessionKey: (value: string): void => {
      sessionKey = value;
    },
    getHistoryMessages: (): ChatHistoryMessage[] => historyMessages,
    setHistoryMessages: (rows: ChatHistoryMessage[]): void => {
      historyMessages = rows;
    },
    getRestoreSource: (): "store" | "empty" => restoreSource,
    markHistoryCompacted: (): void => {
      historyCompacted = true;
    },
    hasHistoryCompacted: (): boolean => historyCompacted,
    markFailureObserved: (): void => {
      failureObserved = true;
    },
    hasFailureObserved: (): boolean => failureObserved,
    getRestoredTurns: (): number => historyMessages.length / 2,
    getStickyProvider: (): string | undefined => stickyProvider,
    setStickyProvider: (value: string | undefined): void => {
      stickyProvider = value;
    },
    getProviderRuntimeStates: (): SessionProviderRuntimeState[] => providerRuntimeStates,
    setProviderRuntimeStates: (rows: SessionProviderRuntimeState[]): void => {
      providerRuntimeStates = rows;
    },
    getPlanMode: (): SessionPlanMode => planMode,
    setPlanMode: (value: SessionPlanMode): void => {
      planMode = value;
    },
      getPlanMeta: (): SessionPlanMeta | undefined => planMeta,
      setPlanMeta: (value: SessionPlanMeta | undefined): void => {
        planMeta = value;
      },
      getGaState: (): GaSessionStateSnapshot | undefined => gaState,
      setGaState: (value: GaSessionStateSnapshot | undefined): void => {
        gaState = value;
      },
    };
  }
