import { SessionStoreController } from "../services/session-store";
import {
  buildContinueBridgeMessage,
  trimHistoryMessages,
  type ChatHistoryMessage,
} from "./session-history";
import {
  createSessionRecord,
  findSessionRecord,
  type SessionPlanMeta,
  type SessionPlanMode,
  type SessionProviderRuntimeState,
  touchSessionRecord,
  type SessionRegistryPayload,
} from "./session-registry";

interface CreateRunStartSessionOpsInput {
  sessionNamespaceKey: string;
  historyTurns: number;
  sessionStore: SessionStoreController<SessionRegistryPayload, ChatHistoryMessage>;
  getSessionRegistry(): SessionRegistryPayload;
  getActiveSessionId(): string;
  setActiveSessionId(value: string): void;
  setSessionKey(value: string): void;
  setStickyProvider(value: string | undefined): void;
  setProviderRuntimeStates(rows: SessionProviderRuntimeState[]): void;
  setPlanMode(value: SessionPlanMode): void;
  setPlanMeta(value: SessionPlanMeta | undefined): void;
  getHistoryMessages(): ChatHistoryMessage[];
  setHistoryMessages(rows: ChatHistoryMessage[]): void;
  onHistoryCompacted(): void;
  persistSessionRegistryState(): Promise<void>;
  persistHistoryState(): Promise<void>;
  writeStoreWarnings(warnings: readonly string[]): void;
  writeStdout(message: string): void;
}

export function createRunStartSessionOps(input: CreateRunStartSessionOpsInput) {
  const switchActiveSession = async (targetSessionId: string, reason: string): Promise<boolean> => {
    const sessionRegistry = input.getSessionRegistry();
    const record = findSessionRecord(sessionRegistry, targetSessionId);
    if (!record) {
      input.writeStdout(`Session "${targetSessionId}" not found. Use /sessions to inspect ids.\n\n`);
      return false;
    }
    input.setActiveSessionId(record.id);
    sessionRegistry.active_id = record.id;
    input.setSessionKey(record.session_key);
    input.setStickyProvider(record.sticky_provider);
    input.setProviderRuntimeStates(Array.isArray(record.provider_runtime_states) ? [...record.provider_runtime_states] : []);
    input.setPlanMode(record.plan_mode === "plan_only" ? "plan_only" : "normal");
    input.setPlanMeta(record.plan_meta);
    const historyLoad = await input.sessionStore.loadHistoryMessagesState(record.session_key);
    input.setHistoryMessages(historyLoad.messages);
    input.writeStoreWarnings(historyLoad.warnings);
    touchSessionRecord(sessionRegistry, record.id);
    await input.persistSessionRegistryState();
    input.writeStdout(
      `Switched to session "${record.id}" (reason=${reason}, restored=${String(historyLoad.messages.length / 2)} turns from ${historyLoad.source}).\n\n`,
    );
    return true;
  };

  const createNewSession = async (): Promise<string> => {
    const sessionRegistry = input.getSessionRegistry();
    const record = createSessionRecord(input.sessionNamespaceKey);
    sessionRegistry.sessions.push(record);
    sessionRegistry.active_id = record.id;
    input.setStickyProvider(undefined);
    input.setProviderRuntimeStates([]);
    input.setPlanMode("normal");
    input.setPlanMeta(undefined);
    await input.persistSessionRegistryState();
    return record.id;
  };

  const printSessionOverview = (): void => {
    const sessionRegistry = input.getSessionRegistry();
    const activeSessionId = input.getActiveSessionId();
    if (!sessionRegistry.sessions.length) {
      input.writeStdout("No sessions available.\n\n");
      return;
    }
    input.writeStdout(`Session namespace: ${input.sessionNamespaceKey}\n`);
    for (const record of sessionRegistry.sessions) {
      const marker = record.id === activeSessionId ? "*" : " ";
      const previewPart = record.preview ? ` | ${record.preview}` : "";
      input.writeStdout(
        `${marker} ${record.id} -> ${record.session_key} (${record.updated_at})${previewPart}\n`,
      );
    }
    input.writeStdout("\n");
  };

  const continueFromSession = async (sourceId: string): Promise<void> => {
    const sessionRegistry = input.getSessionRegistry();
    const activeSessionId = input.getActiveSessionId();
    if (sourceId === activeSessionId) {
      input.writeStdout("Skip: source session is current active session.\n\n");
      return;
    }
    const sourceRecord = findSessionRecord(sessionRegistry, sourceId);
    if (!sourceRecord) {
      input.writeStdout(`Session "${sourceId}" not found. Use /sessions to inspect ids.\n\n`);
      return;
    }
    const sourceHistoryState = await input.sessionStore.loadHistoryMessagesState(sourceRecord.session_key);
    input.writeStoreWarnings(sourceHistoryState.warnings);
    const bridge = buildContinueBridgeMessage(
      sourceId,
      sourceRecord.session_key,
      sourceHistoryState.messages,
      input.historyTurns,
    );
    if (!bridge) {
      input.writeStdout(
        `Cannot bridge from "${sourceId}" because source session has no recoverable summary (restored=${sourceHistoryState.source}).\n\n`,
      );
      return;
    }
    const historyMessages = input.getHistoryMessages();
    const nextHistory = trimHistoryMessages([...historyMessages, bridge], input.historyTurns);
    if (nextHistory.length < historyMessages.length + 1) {
      input.onHistoryCompacted();
    }
    input.setHistoryMessages(nextHistory);
    await input.persistHistoryState();
    touchSessionRecord(sessionRegistry, activeSessionId, `continue from ${sourceId}`);
    await input.persistSessionRegistryState();
    input.writeStdout(
      `Bridge injected from "${sourceId}" into current session "${activeSessionId}" (summary only, no full history import).\n\n`,
    );
  };

  return {
    switchActiveSession,
    createNewSession,
    printSessionOverview,
    continueFromSession,
  };
}
