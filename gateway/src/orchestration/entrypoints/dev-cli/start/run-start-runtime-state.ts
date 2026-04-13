import { type RunStartBootstrapState } from "./run-start-bootstrap";
import { type ChatHistoryMessage } from "./session-history";
import { type SessionRegistryPayload } from "./session-registry";

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
}

export function createRunStartRuntimeState(input: CreateRunStartRuntimeStateInput): RunStartRuntimeState {
  let sessionRegistry = input.bootstrapState.sessionRegistry;
  let activeSessionId = input.bootstrapState.activeSessionId;
  let sessionKey = input.bootstrapState.sessionKey;
  let historyMessages = input.bootstrapState.historyMessages;
  let restoreSource = input.bootstrapState.restoreSource;
  let historyCompacted = false;
  let failureObserved = false;

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
  };
}
