import { type ChatHistoryMessage } from "../../../cli/start/session-history";
import {
  type SessionPlanMeta,
  type SessionPlanMode,
  type SessionProviderRuntimeState,
  type SessionRegistryPayload,
} from "../../../cli/start/session-registry";
import { type RunStartRuntimeState } from "../../../cli/start/runtime-state";
import { type GaSessionStateSnapshot } from "../../../cli/services/ga-mechanism-runtime";

export async function withStdinTty<T>(
  stdinIsTty: boolean,
  operation: () => Promise<T>,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  try {
    Object.defineProperty(process.stdin, "isTTY", {
      value: stdinIsTty,
      configurable: true,
    });
    return await operation();
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdin, "isTTY", descriptor);
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  }
}

export function createRuntimeStateMock(input: {
  sessionKey: string;
  activeSessionId: string;
  historyMessages: ChatHistoryMessage[];
  stickyProvider?: string;
  providerRuntimeStates: SessionProviderRuntimeState[];
}): RunStartRuntimeState {
  const sessionRegistry: SessionRegistryPayload = {
    version: 1,
    namespace_key: "feishu:grobot:dm:interactive-binding-contract",
    active_id: input.activeSessionId,
    sessions: [],
  };
  let activeSessionId = input.activeSessionId;
  let sessionKey = input.sessionKey;
  let historyMessages = [...input.historyMessages];
  let stickyProvider = input.stickyProvider;
  let providerRuntimeStates = [...input.providerRuntimeStates];
  let planMode: SessionPlanMode = "normal";
  let planMeta: SessionPlanMeta | undefined;
  let gaState: GaSessionStateSnapshot | undefined;
  let historyCompacted = false;
  let failureObserved = false;
  return {
    getSessionRegistry: () => sessionRegistry,
    getActiveSessionId: () => activeSessionId,
    setActiveSessionId: (value) => {
      activeSessionId = value;
    },
    getSessionKey: () => sessionKey,
    setSessionKey: (value) => {
      sessionKey = value;
    },
    getHistoryMessages: () => historyMessages,
    setHistoryMessages: (rows) => {
      historyMessages = [...rows];
    },
    getRestoreSource: () => "store",
    markHistoryCompacted: () => {
      historyCompacted = true;
    },
    hasHistoryCompacted: () => historyCompacted,
    markFailureObserved: () => {
      failureObserved = true;
    },
    hasFailureObserved: () => failureObserved,
    getRestoredTurns: () => historyMessages.length / 2,
    getStickyProvider: () => stickyProvider,
    setStickyProvider: (value) => {
      stickyProvider = value;
    },
    getProviderRuntimeStates: () => providerRuntimeStates,
    setProviderRuntimeStates: (rows) => {
      providerRuntimeStates = [...rows];
    },
    getPlanMode: () => planMode,
    setPlanMode: (value) => {
      planMode = value;
    },
    getPlanMeta: () => planMeta,
    setPlanMeta: (value) => {
      planMeta = value;
    },
    getGaState: () => gaState,
    setGaState: (value) => {
      gaState = value;
    },
  };
}
