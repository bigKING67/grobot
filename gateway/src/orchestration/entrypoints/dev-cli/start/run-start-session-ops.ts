import { SessionStoreController } from "../services/session-store";
import { type GaSessionStateSnapshot } from "../services/ga-mechanism-runtime";
import {
  buildContinueBridgeMessage,
  trimHistoryMessages,
  type ChatHistoryMessage,
} from "./session-history";
import {
  type RewindCheckpointSummary,
  type RewindRestoreMode,
  type RunStartRewindStore,
} from "./run-start-rewind-store";
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
  rewindStore: RunStartRewindStore;
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

export interface RunStartSessionRewindInput {
  sessionId: string;
  checkpointId?: string;
  mode: RewindRestoreMode;
  fileFilter?: readonly string[];
  reason?: string;
  summaryLimit?: number;
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

  const resumeFromSession = async (sourceId: string, reason = "resume"): Promise<boolean> => {
    if (sourceId === input.getActiveSessionId()) {
      input.writeStdout(`Session "${sourceId}" is already active.\n\n`);
      return true;
    }
    return switchActiveSession(sourceId, reason);
  };

  const forkFromSession = async (
    sourceId: string,
    reason = "fork",
  ): Promise<boolean> => {
    const sessionRegistry = input.getSessionRegistry();
    const sourceRecord = findSessionRecord(sessionRegistry, sourceId);
    if (!sourceRecord) {
      input.writeStdout(`Session "${sourceId}" not found. Use /sessions to inspect ids.\n\n`);
      return false;
    }
    const sourceHistoryState = await input.sessionStore.loadHistoryMessagesState(sourceRecord.session_key);
    input.writeStoreWarnings(sourceHistoryState.warnings);
    const forkSessionId = await createNewSession();
    const switched = await switchActiveSession(forkSessionId, `${reason}:prepare`);
    if (!switched) {
      return false;
    }
    const nextHistory = trimHistoryMessages([...sourceHistoryState.messages], input.historyTurns);
    if (nextHistory.length < sourceHistoryState.messages.length) {
      input.onHistoryCompacted();
    }
    input.setHistoryMessages(nextHistory);
    await input.persistHistoryState();
    const forkRecord = findSessionRecord(sessionRegistry, forkSessionId);
    if (forkRecord) {
      forkRecord.sticky_provider = sourceRecord.sticky_provider;
      forkRecord.provider_runtime_states = Array.isArray(sourceRecord.provider_runtime_states)
        ? [...sourceRecord.provider_runtime_states]
        : [];
    }
    let rewindCloneSummary = "";
    if (forkRecord) {
      try {
        const rewindClone = input.rewindStore.cloneSessionCheckpoints({
          sourceSessionKey: sourceRecord.session_key,
          targetSessionKey: forkRecord.session_key,
        });
        if (rewindClone.copiedCheckpoints > 0 || rewindClone.failedBackupFiles > 0) {
          const failedHint = rewindClone.failedBackupFiles > 0
            ? `, rewind_backup_failed=${String(rewindClone.failedBackupFiles)}`
            : "";
          rewindCloneSummary =
            ` rewind_checkpoints=${String(rewindClone.copiedCheckpoints)}` +
            ` rewind_backups=${String(rewindClone.copiedBackupFiles)}` +
            failedHint;
        }
      } catch (error) {
        input.writeStdout(`[rewind] fork checkpoint clone failed: ${String(error)}\n`);
      }
    }
    input.setStickyProvider(sourceRecord.sticky_provider);
    input.setProviderRuntimeStates(Array.isArray(sourceRecord.provider_runtime_states) ? [...sourceRecord.provider_runtime_states] : []);
    touchSessionRecord(sessionRegistry, forkSessionId, `fork from ${sourceId}`);
    await input.persistSessionRegistryState();
    input.writeStdout(
      `[session] forked "${sourceId}" -> "${forkSessionId}" (restored=${String(nextHistory.length / 2)} turns${rewindCloneSummary}).\n\n`,
    );
    return true;
  };

  const listRewindCheckpoints = (
    sessionId: string,
    limit?: number,
  ): RewindCheckpointSummary[] => {
    const sessionRegistry = input.getSessionRegistry();
    const record = findSessionRecord(sessionRegistry, sessionId);
    if (!record) {
      return [];
    }
    return input.rewindStore.listCheckpoints(record.session_key, limit);
  };

  const rewindSession = async (args: RunStartSessionRewindInput): Promise<boolean> => {
    const sessionRegistry = input.getSessionRegistry();
    const record = findSessionRecord(sessionRegistry, args.sessionId);
    if (!record) {
      input.writeStdout(`Session "${args.sessionId}" not found. Use /sessions to inspect ids.\n\n`);
      return false;
    }
    if (args.mode === "summarize") {
      input.writeStdout(
        input.rewindStore.formatCheckpointSummary(
          record.session_key,
          args.summaryLimit,
        ),
      );
      return true;
    }
    if (args.sessionId !== input.getActiveSessionId()) {
      const switched = await switchActiveSession(args.sessionId, args.reason ?? "rewind");
      if (!switched) {
        return false;
      }
    }
    const activeSessionId = input.getActiveSessionId();
    const activeRecord = findSessionRecord(sessionRegistry, activeSessionId);
    if (!activeRecord) {
      input.writeStdout(`[rewind] active session "${activeSessionId}" not found.\n\n`);
      return false;
    }
    try {
      const restored = await input.rewindStore.restoreCheckpoint({
        sessionKey: activeRecord.session_key,
        checkpointId: args.checkpointId,
        mode: args.mode,
        fileFilter: args.fileFilter,
        setHistoryMessages: input.setHistoryMessages,
        persistHistoryState: input.persistHistoryState,
      });
      touchSessionRecord(
        sessionRegistry,
        activeSessionId,
        `rewind ${restored.checkpointId} ${restored.mode}`,
      );
      await input.persistSessionRegistryState();
      const restoredFilesPreview = restored.restoredFiles.length > 0
        ? ` files=${String(restored.restoredFiles.length)}`
        : "";
      const skippedFilesPreview = restored.skippedFiles.length > 0
        ? ` skipped=${String(restored.skippedFiles.length)}`
        : "";
      input.writeStdout(
        `[rewind] restored checkpoint=${restored.checkpointId} mode=${restored.mode} conversation=${restored.restoredConversation ? "yes" : "no"} code=${restored.restoredCode ? "yes" : "no"}${restoredFilesPreview}${skippedFilesPreview}\n\n`,
      );
      return true;
    } catch (error) {
      input.writeStdout(`[rewind] failed: ${String(error)}\n\n`);
      return false;
    }
  };

  return {
    listSessions,
    switchActiveSession,
    createNewSession,
    printSessionOverview,
    continueFromSession,
    resumeFromSession,
    forkFromSession,
    listRewindCheckpoints,
    rewindSession,
  };
}
