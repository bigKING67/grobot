import { SessionStoreController } from "../../services/session-store";
import { type GaSessionStateSnapshot } from "../../services/ga-mechanism-runtime";
import {
  buildContinueBridgeMessage,
  trimHistoryMessages,
  type ChatHistoryMessage,
} from "./history";
import {
  type RewindCheckpointSummary,
  type RewindRestoreMode,
  type RunStartRewindStore,
} from "../rewind-store";
import {
  createSessionRecord,
  findSessionRecord,
  SESSION_REGISTRY_MAIN_ID,
  type SessionPlanMeta,
  type SessionPlanMode,
  type SessionProviderRuntimeState,
  touchSessionRecord,
  type SessionRegistryPayload,
} from "../session-registry";
import { renderInfoPanel } from "../../tui/components/info-panel/render";

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

function formatSessionUpdatedAtForDisplay(value: string): string {
  const normalized = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(normalized);
  if (isoMatch) {
    const [, year, month, day, hour, minute] = isoMatch;
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }
  return normalized.length > 0 ? normalized : "unknown";
}

function buildRunStartNotice(title: string, details: readonly string[]): string {
  const normalized = details
    .map((detail) => detail.trim())
    .filter((detail) => detail.length > 0);
  const [primary, ...detailLines] = normalized;
  return renderInfoPanel({
    title,
    sections: [{
      rows: [{
        title: primary ?? "No details",
        detailLines,
      }],
    }],
  });
}

function humanizeRewindMode(value: RewindRestoreMode): string {
  switch (value) {
    case "both":
      return "conversation + code";
    case "conversation":
      return "conversation only";
    case "code":
      return "code only";
    case "summarize":
      return "checkpoint summary";
  }
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
    return "Main session";
  }
  return "Untitled session";
}

export interface RunStartSessionOps {
  listSessions(): RunStartSessionSummary[];
  switchActiveSession(
    targetSessionId: string,
    reason: string,
  ): Promise<boolean>;
  createNewSession(): Promise<string>;
  printSessionOverview(): void;
  continueFromSession(sourceId: string): Promise<void>;
  resumeFromSession(sourceId: string, reason?: string): Promise<boolean>;
  forkFromSession(sourceId: string, reason?: string): Promise<boolean>;
  listRewindCheckpoints(
    sessionId: string,
    limit?: number,
  ): RewindCheckpointSummary[];
  rewindSession(args: RunStartSessionRewindInput): Promise<boolean>;
}

export function createRunStartSessionOps(input: CreateRunStartSessionOpsInput): RunStartSessionOps {
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

  const switchActiveSession = async (targetSessionId: string, _reason: string): Promise<boolean> => {
    const sessionRegistry = input.getSessionRegistry();
    const record = findSessionRecord(sessionRegistry, targetSessionId);
    if (!record) {
      input.writeStdout(buildRunStartNotice("Session not found", [
        `session ${targetSessionId}`,
        "Use /sessions to view available sessions.",
      ]));
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
    input.writeStdout(buildRunStartNotice("Session switched", [
      `session ${record.id}`,
      `restored ${String(historyLoad.messages.length / 2)} turns`,
    ]));
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
      input.writeStdout(buildRunStartNotice("No available sessions", [
        "This namespace has no switchable sessions yet.",
      ]));
      return;
    }
    const active = sessions.find((record) => record.active);
    input.writeStdout(renderInfoPanel({
      title: "Sessions",
      subtitle: active
        ? `${String(sessions.length)} sessions · current ${active.title || active.id}`
        : `${String(sessions.length)} sessions · no current session`,
      sections: [{
        rows: sessions.map((record) => {
          const details = [
            `${record.active ? "current · " : ""}updated ${formatSessionUpdatedAtForDisplay(record.updatedAt)}`,
            `session ${record.id}`,
          ];
          if (record.summary.length > 0) {
            details.push(`summary ${record.summary}`);
          }
          return {
            title: record.title || record.id,
            detailLines: details,
          };
        }),
      }],
    }));
  };

  const continueFromSession = async (sourceId: string): Promise<void> => {
    const sessionRegistry = input.getSessionRegistry();
    const activeSessionId = input.getActiveSessionId();
    if (sourceId === activeSessionId) {
      input.writeStdout(buildRunStartNotice("Continue session skipped", [
        `source session ${sourceId}`,
        "Source session is already current.",
      ]));
      return;
    }
    const sourceRecord = findSessionRecord(sessionRegistry, sourceId);
    if (!sourceRecord) {
      input.writeStdout(buildRunStartNotice("Session not found", [
        `session ${sourceId}`,
        "Use /sessions to view available sessions.",
      ]));
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
        buildRunStartNotice("Cannot bridge session", [
          `source session ${sourceId}`,
          "Source session has no restorable summary.",
          `history source ${sourceHistoryState.source}`,
        ]),
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
    input.writeStdout(buildRunStartNotice("Session summary continued", [
      `source session ${sourceId}`,
      `current session ${activeSessionId}`,
      "Summary bridge only; full history was not imported.",
    ]));
  };

  const resumeFromSession = async (sourceId: string, reason = "resume"): Promise<boolean> => {
    if (sourceId === input.getActiveSessionId()) {
      input.writeStdout(buildRunStartNotice("Session already current", [
        `session ${sourceId}`,
      ]));
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
      input.writeStdout(buildRunStartNotice("Session not found", [
        `session ${sourceId}`,
        "Use /sessions to view available sessions.",
      ]));
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
            ? `, backup_failed=${String(rewindClone.failedBackupFiles)}`
            : "";
          rewindCloneSummary =
            `, checkpoints=${String(rewindClone.copiedCheckpoints)}` +
            `, backups=${String(rewindClone.copiedBackupFiles)}` +
            failedHint;
        }
      } catch (error) {
        input.writeStdout(buildRunStartNotice("Checkpoint clone failed", [
          `source session ${sourceId}`,
          "Fork session was created, but rewind checkpoints were not fully copied.",
          `diagnostic ${String(error)}`,
        ]));
      }
    }
    input.setStickyProvider(sourceRecord.sticky_provider);
    input.setProviderRuntimeStates(Array.isArray(sourceRecord.provider_runtime_states) ? [...sourceRecord.provider_runtime_states] : []);
    touchSessionRecord(sessionRegistry, forkSessionId, `fork from ${sourceId}`);
    await input.persistSessionRegistryState();
    input.writeStdout(
      buildRunStartNotice("Session forked", [
        `source session ${sourceId}`,
        `new session ${forkSessionId}`,
        `restored turns ${String(nextHistory.length / 2)}${rewindCloneSummary}`,
      ]),
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
      input.writeStdout(buildRunStartNotice("Session not found", [
        `session ${args.sessionId}`,
        "Use /sessions to view available sessions.",
      ]));
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
      input.writeStdout(buildRunStartNotice("Current session cannot rewind", [
        `session ${activeSessionId}`,
        "Current session record was not found.",
      ]));
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
        ? `files ${String(restored.restoredFiles.length)}`
        : "";
      const skippedFilesPreview = restored.skippedFiles.length > 0
        ? `skipped files ${String(restored.skippedFiles.length)}`
        : "";
      const restoredDetails = [
        `checkpoint ${restored.checkpointId}`,
        `mode ${humanizeRewindMode(restored.mode)}`,
        `conversation ${restored.restoredConversation ? "restored" : "not restored"} · code ${restored.restoredCode ? "restored" : "not restored"}`,
      ];
      if (restoredFilesPreview) {
        restoredDetails.push(restoredFilesPreview.trim());
      }
      if (skippedFilesPreview) {
        restoredDetails.push(skippedFilesPreview);
      }
      input.writeStdout(buildRunStartNotice("Checkpoint restored", restoredDetails));
      return true;
    } catch (error) {
      input.writeStdout(buildRunStartNotice("Restore checkpoint failed", [
        `diagnostic ${String(error)}`,
      ]));
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
