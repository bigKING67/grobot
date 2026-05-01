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
import { terminalStyle } from "../ui/theme/terminal-style";

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

function buildRunStartNotice(title: string, details: readonly string[]): string {
  const lines = [`${terminalStyle.accent("●")} ${title}`];
  for (const detail of details) {
    lines.push(`  ${terminalStyle.muted(detail)}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function humanizeRewindMode(value: RewindRestoreMode): string {
  switch (value) {
    case "both":
      return "对话 + 代码";
    case "conversation":
      return "仅对话";
    case "code":
      return "仅代码";
    case "summarize":
      return "汇总检查点";
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
    return "主会话";
  }
  return "未命名会话";
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
      input.writeStdout(`未找到会话 "${targetSessionId}"。使用 /sessions 查看 id。\n\n`);
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
      `已切换到会话 "${record.id}"（原因=${reason}，从 ${historyLoad.source} 恢复 ${String(historyLoad.messages.length / 2)} 轮）。\n\n`,
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
      input.writeStdout("暂无可用会话。\n\n");
      return;
    }
    input.writeStdout(`会话命名空间: ${input.sessionNamespaceKey}\n`);
    for (const record of sessions) {
      const marker = record.active ? "*" : " ";
      input.writeStdout(
        `${marker} ${record.id} | ${record.title} (${record.updatedAt})\n`,
      );
      if (record.summary.length > 0) {
        input.writeStdout(`    摘要: ${record.summary}\n`);
      }
    }
    input.writeStdout("\n");
  };

  const continueFromSession = async (sourceId: string): Promise<void> => {
    const sessionRegistry = input.getSessionRegistry();
    const activeSessionId = input.getActiveSessionId();
    if (sourceId === activeSessionId) {
      input.writeStdout("已跳过：来源会话就是当前会话。\n\n");
      return;
    }
    const sourceRecord = findSessionRecord(sessionRegistry, sourceId);
    if (!sourceRecord) {
      input.writeStdout(`未找到会话 "${sourceId}"。使用 /sessions 查看 id。\n\n`);
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
        `无法从 "${sourceId}" 桥接：来源会话没有可恢复摘要（来源=${sourceHistoryState.source}）。\n\n`,
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
      `已把 "${sourceId}" 的摘要桥接到当前会话 "${activeSessionId}"（仅摘要，不导入完整历史）。\n\n`,
    );
  };

  const resumeFromSession = async (sourceId: string, reason = "resume"): Promise<boolean> => {
    if (sourceId === input.getActiveSessionId()) {
      input.writeStdout(`会话 "${sourceId}" 已是当前会话。\n\n`);
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
      input.writeStdout(`未找到会话 "${sourceId}"。使用 /sessions 查看 id。\n\n`);
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
            ? `，备份失败=${String(rewindClone.failedBackupFiles)}`
            : "";
          rewindCloneSummary =
            `，检查点=${String(rewindClone.copiedCheckpoints)}` +
            `，备份=${String(rewindClone.copiedBackupFiles)}` +
            failedHint;
        }
      } catch (error) {
        input.writeStdout(buildRunStartNotice("检查点克隆失败", [
          `来源会话: ${sourceId}`,
          "fork 会话已继续创建，但回退检查点没有完整复制。",
          `诊断: ${String(error)}`,
        ]));
      }
    }
    input.setStickyProvider(sourceRecord.sticky_provider);
    input.setProviderRuntimeStates(Array.isArray(sourceRecord.provider_runtime_states) ? [...sourceRecord.provider_runtime_states] : []);
    touchSessionRecord(sessionRegistry, forkSessionId, `fork from ${sourceId}`);
    await input.persistSessionRegistryState();
    input.writeStdout(
      `[session] 已 fork "${sourceId}" -> "${forkSessionId}"（恢复 ${String(nextHistory.length / 2)} 轮${rewindCloneSummary}）。\n\n`,
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
      input.writeStdout(`未找到会话 "${args.sessionId}"。使用 /sessions 查看 id。\n\n`);
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
      input.writeStdout(buildRunStartNotice("当前会话不可回退", [
        `会话: ${activeSessionId}`,
        "未找到当前会话记录。",
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
        ? `文件: ${String(restored.restoredFiles.length)}`
        : "";
      const skippedFilesPreview = restored.skippedFiles.length > 0
        ? `跳过文件: ${String(restored.skippedFiles.length)}`
        : "";
      const restoredDetails = [
        `检查点: ${restored.checkpointId}`,
        `模式: ${humanizeRewindMode(restored.mode)}`,
        `对话: ${restored.restoredConversation ? "已恢复" : "未恢复"} · 代码: ${restored.restoredCode ? "已恢复" : "未恢复"}`,
      ];
      if (restoredFilesPreview) {
        restoredDetails.push(restoredFilesPreview.trim());
      }
      if (skippedFilesPreview) {
        restoredDetails.push(skippedFilesPreview);
      }
      input.writeStdout(buildRunStartNotice("已恢复检查点", restoredDetails));
      return true;
    } catch (error) {
      input.writeStdout(buildRunStartNotice("恢复检查点失败", [
        `诊断: ${String(error)}`,
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
