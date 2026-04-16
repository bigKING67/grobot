import { SessionStoreController } from "../services/session-store";
import { type GaSessionStateSnapshot } from "../services/ga-mechanism-runtime";
import {
  buildContinueBridgeMessage,
  trimHistoryMessages,
  type ChatHistoryMessage,
} from "./session-history";
import {
  createSessionRecord,
  findSessionRecord,
  SESSION_REGISTRY_MAIN_ID,
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
  setGaState(value: GaSessionStateSnapshot | undefined): void;
  getHistoryMessages(): ChatHistoryMessage[];
  setHistoryMessages(rows: ChatHistoryMessage[]): void;
  onHistoryCompacted(): void;
  persistSessionRegistryState(): Promise<void>;
  persistHistoryState(): Promise<void>;
  writeStoreWarnings(warnings: readonly string[]): void;
  writeStdout(message: string): void;
}

export interface RunStartSessionSummary {
  id: string;
  title: string;
  summary: string;
  sessionKey: string;
  updatedAt: string;
  active: boolean;
}

function parseUpdatedAtMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function trimSessionText(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function resolveSessionTitle(input: {
  id: string;
  preview: string;
  planTitle: string;
}): string {
  if (input.planTitle.length > 0) {
    return trimSessionText(input.planTitle, 44);
  }
  if (input.preview.length > 0) {
    return trimSessionText(input.preview, 44);
  }
  if (input.id === SESSION_REGISTRY_MAIN_ID) {
    return "Main Session";
  }
  return "Untitled Session";
}

export function createRunStartSessionOps(input: CreateRunStartSessionOpsInput) {
  const listSessions = (): RunStartSessionSummary[] => {
    const sessionRegistry = input.getSessionRegistry();
    const activeSessionId = input.getActiveSessionId();
    const rows = sessionRegistry.sessions.map((record) => ({
      title: resolveSessionTitle({
        id: record.id,
        preview: typeof record.preview === "string" ? record.preview : "",
        planTitle: typeof record.plan_meta?.active_plan_title === "string"
          ? record.plan_meta.active_plan_title
          : "",
      }),
      summary: trimSessionText(typeof record.preview === "string" ? record.preview : "", 120),
      id: record.id,
      sessionKey: record.session_key,
      updatedAt: record.updated_at,
      active: record.id === activeSessionId,
    }));
    rows.sort((left, right) => {
      if (left.active !== right.active) {
        return left.active ? -1 : 1;
      }
      const updatedDiff = parseUpdatedAtMs(right.updatedAt) - parseUpdatedAtMs(left.updatedAt);
      if (updatedDiff !== 0) {
        return updatedDiff;
      }
      return left.id.localeCompare(right.id);
    });
    return rows;
  };

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
    input.setGaState(record.ga_state);
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
      input.setGaState(undefined);
      await input.persistSessionRegistryState();
      return record.id;
    };

  const printSessionOverview = (): void => {
    const sessions = listSessions();
    if (!sessions.length) {
      input.writeStdout("No sessions available.\n\n");
      return;
    }
    input.writeStdout(`Session namespace: ${input.sessionNamespaceKey}\n`);
    for (const record of sessions) {
      const marker = record.active ? "*" : " ";
      input.writeStdout(
        `${marker} ${record.id} | ${record.title} (${record.updatedAt})\n`,
      );
      if (record.summary.length > 0) {
        input.writeStdout(`    summary: ${record.summary}\n`);
      }
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
    listSessions,
    switchActiveSession,
    createNewSession,
    printSessionOverview,
    continueFromSession,
  };
}
