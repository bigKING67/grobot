import { SessionStoreController } from "../services/session-store";
import { type ChatHistoryMessage } from "./session-history";
import {
  createSessionRecord,
  findSessionRecord,
  SESSION_REGISTRY_MAIN_ID,
  type SessionPlanMeta,
  type SessionPlanMode,
  type SessionProviderRuntimeState,
  type SessionRegistryPayload,
  type SessionRegistryRecord,
} from "./session-registry";

interface BootstrapRunStartStateInput {
  sessionNamespaceKey: string;
  sessionStore: SessionStoreController<SessionRegistryPayload, ChatHistoryMessage>;
  writeSessionWarnings(warnings: readonly string[]): void;
  writeStoreWarnings(warnings: readonly string[]): void;
}

export interface RunStartBootstrapState {
  sessionRegistry: SessionRegistryPayload;
  activeSessionId: string;
  sessionKey: string;
  historyMessages: ChatHistoryMessage[];
  restoreSource: "store" | "empty";
  stickyProvider?: string;
  providerRuntimeStates: SessionProviderRuntimeState[];
  planMode: SessionPlanMode;
  planMeta?: SessionPlanMeta;
}

function ensureActiveSession(
  sessionRegistry: SessionRegistryPayload,
  sessionNamespaceKey: string,
): SessionRegistryRecord {
  const activeId =
    typeof sessionRegistry.active_id === "string" && sessionRegistry.active_id.length > 0
      ? sessionRegistry.active_id
      : SESSION_REGISTRY_MAIN_ID;
  const found = findSessionRecord(sessionRegistry, activeId);
  if (found) {
    return found;
  }
  const fallback = createSessionRecord(sessionNamespaceKey, SESSION_REGISTRY_MAIN_ID);
  sessionRegistry.sessions = [fallback];
  sessionRegistry.active_id = fallback.id;
  return fallback;
}

export async function bootstrapRunStartState(
  input: BootstrapRunStartStateInput,
): Promise<RunStartBootstrapState> {
  const sessionRegistryState = await input.sessionStore.loadSessionRegistryState();
  input.writeSessionWarnings(sessionRegistryState.warnings);
  const sessionRegistry = sessionRegistryState.registry;
  const activeSessionRecord = ensureActiveSession(sessionRegistry, input.sessionNamespaceKey);
  const historyLoad = await input.sessionStore.loadHistoryMessagesState(activeSessionRecord.session_key);
  input.writeStoreWarnings(historyLoad.warnings);
  return {
    sessionRegistry,
    activeSessionId: activeSessionRecord.id,
    sessionKey: activeSessionRecord.session_key,
    historyMessages: historyLoad.messages,
    restoreSource: historyLoad.source,
    stickyProvider: activeSessionRecord.sticky_provider,
    providerRuntimeStates: Array.isArray(activeSessionRecord.provider_runtime_states)
      ? [...activeSessionRecord.provider_runtime_states]
      : [],
    planMode: activeSessionRecord.plan_mode === "plan_only" ? "plan_only" : "normal",
    planMeta: activeSessionRecord.plan_meta,
  };
}
