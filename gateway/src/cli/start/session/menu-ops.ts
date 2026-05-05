import { type SessionMenuMode } from "../session-interactive";
import {
  buildSessionsHubMenuViewModel,
  runSessionMenuPicker,
} from "./menu";
import {
  type RunStartSessionRewindInput,
  type RunStartSessionSummary,
} from "./ops";
import {
  runTerminalLinePrompt,
} from "../../tui/components/prompt-input/controller";
import { runTerminalSelectMenu } from "../../tui/components/select-menu/controller";
import { type RewindRestoreMode } from "../rewind-store";
import { renderInfoPanel } from "../../tui/components/info-panel/render";

interface CreateRunStartSessionMenuOpsInput {
  sessionNamespaceKey: string;
  runLinePrompt?: typeof runTerminalLinePrompt;
  runSelectMenu?: typeof runTerminalSelectMenu;
  listSessions(): RunStartSessionSummary[];
  getActiveSessionId(): string;
  printSessionOverview(): void;
  createNewSession(): Promise<string>;
  switchActiveSession(
    targetSessionId: string,
    reason: string,
  ): Promise<boolean>;
  resumeFromSession(sourceSessionId: string, reason?: string): Promise<boolean>;
  continueFromSession(sourceSessionId: string): Promise<void>;
  listRewindCheckpoints(
    sessionId: string,
    limit?: number,
  ): ReadonlyArray<{
    checkpointId: string;
    createdAt: string;
    userText: string;
    assistantText: string;
    historyBeforeCount: number;
    historyAfterCount: number;
    changedFilesCount: number;
  }>;
  rewindSession(input: RunStartSessionRewindInput): Promise<boolean>;
  applyModelOverrideForActiveSession(): void;
  writeStdout(message: string): void;
}

export interface RunStartSessionMenuOps {
  openSessionMenu(
    mode: SessionMenuMode,
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<void>;
}

function resolveModeFromMenuId(value: string): RewindRestoreMode | undefined {
  if (
    value === "both"
    || value === "conversation"
    || value === "code"
    || value === "summarize"
  ) {
    return value;
  }
  return undefined;
}

function parseFileFilterInput(value: string): string[] | undefined {
  const rows = value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (rows.length === 0) {
    return undefined;
  }
  return rows;
}

function buildSessionMenuNotice(title: string, details: readonly string[]): string {
  const normalized = details
    .map((detail) => detail.trim())
    .filter((detail) => detail.length > 0);
  const [primary, ...detailLines] = normalized;
  return renderInfoPanel({
    title,
    sections: [{
      rows: [{
        title: primary ?? "无更多信息",
        detailLines,
      }],
    }],
  });
}

function buildSessionCommandUsageNotice(command: string): string {
  return renderInfoPanel({
    title: "会话命令",
    sections: [{
      title: "可用入口",
      rows: [{
        title: `用法 ${command}`,
      }],
    }],
  });
}

export function createRunStartSessionMenuOps(
  input: CreateRunStartSessionMenuOpsInput,
): RunStartSessionMenuOps {
  const runLinePrompt = input.runLinePrompt ?? runTerminalLinePrompt;
  const runSelectMenu = input.runSelectMenu ?? runTerminalSelectMenu;

  const openRewindMenu = async (
    sessions: readonly RunStartSessionSummary[],
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<void> => {
    if (sessions.length === 0) {
      input.writeStdout(buildSessionMenuNotice("暂无可回退会话", [
        "当前命名空间还没有可选择的会话。",
      ]));
      return;
    }
    const pickedSession = await runSessionMenuPicker({
      mode: "rewind",
      sessionNamespaceKey: input.sessionNamespaceKey,
      sessions,
      withInputPaused,
      runSelectMenu,
    });
    if (pickedSession.kind !== "session") {
      return;
    }
    const sessionId = pickedSession.sessionId;
    const modePick = await withInputPaused(() =>
      runSelectMenu({
        title: "回退模式",
        subtitle: `会话 ${sessionId}`,
        hint: "↑/↓ 选择 · Enter 确认 · Esc 返回",
        items: [
          {
            id: "summarize",
            label: "汇总检查点",
            description: "只显示最近检查点，不执行恢复。",
          },
          {
            id: "both",
            label: "同时恢复对话 + 代码",
            description: "同时恢复检查点对话记录和已跟踪文件快照。",
          },
          {
            id: "conversation",
            label: "仅恢复对话",
            description: "只恢复对话记录。",
          },
          {
            id: "code",
            label: "仅恢复代码",
            description: "只恢复已跟踪文件快照。",
          },
        ],
      }),
    );
    if (modePick.kind === "cancelled") {
      return;
    }
    const mode = resolveModeFromMenuId(modePick.item.id);
    if (!mode) {
      input.writeStdout(buildSessionMenuNotice("回退模式无效", [
        "请重新打开 /rewind 选择回退模式。",
      ]));
      return;
    }
    if (mode === "summarize") {
      await input.rewindSession({
        sessionId,
        mode,
        reason: "menu:rewind:summarize",
      });
      return;
    }
    const checkpoints = input.listRewindCheckpoints(sessionId, 32);
    if (checkpoints.length === 0) {
      input.writeStdout(buildSessionMenuNotice("暂无可用检查点", [
        `会话 ${sessionId}`,
        "继续对话后会自动生成新的回退检查点。",
      ]));
      return;
    }
    const pickedCheckpoint = await withInputPaused(() =>
      runSelectMenu({
        title: "回退检查点",
        subtitle: `会话 ${sessionId}`,
        hint: "↑/↓ 选择 · Enter 确认 · Esc 返回",
        items: [
          {
            id: "__latest__",
            label: "最新检查点",
            description: "使用选中会话的最近检查点。",
          },
          ...checkpoints.map((checkpoint) => ({
            id: checkpoint.checkpointId,
            label: checkpoint.checkpointId,
            description:
              `${checkpoint.createdAt} · ${String(checkpoint.changedFilesCount)} 个文件 · 消息 ${String(checkpoint.historyBeforeCount)}->${String(checkpoint.historyAfterCount)} · 用户 ${checkpoint.userText}`,
          })),
        ],
      }),
    );
    if (pickedCheckpoint.kind === "cancelled") {
      return;
    }
    const checkpointId = pickedCheckpoint.item.id === "__latest__"
      ? undefined
      : pickedCheckpoint.item.id;
    let fileFilter: string[] | undefined;
    if (mode === "code") {
      const fileFilterInput = await withInputPaused(() =>
        runLinePrompt({
          prompt: "文件过滤（可选，逗号分隔）> ",
        }),
      );
      if (fileFilterInput.kind === "cancelled") {
        return;
      }
      fileFilter = parseFileFilterInput(fileFilterInput.value);
    }
    await input.rewindSession({
      sessionId,
      checkpointId,
      mode,
      fileFilter,
      reason: "menu:rewind:restore",
    });
  };

  const openSessionsHubMenu = async (
    sessions: readonly RunStartSessionSummary[],
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<void> => {
    const picked = await withInputPaused(() =>
      runSelectMenu(buildSessionsHubMenuViewModel({ sessions })),
    );
    if (picked.kind === "cancelled") {
      return;
    }
    if (picked.item.id === "overview") {
      input.printSessionOverview();
      return;
    }
    if (picked.item.id === "create") {
      const nextId = await input.createNewSession();
      const switched = await input.switchActiveSession(nextId, "menu:new");
      if (switched) {
        input.applyModelOverrideForActiveSession();
      }
      return;
    }
    if (sessions.length === 0) {
      input.writeStdout(buildSessionMenuNotice("暂无可用会话", [
        "当前命名空间里还没有可切换的会话。",
      ]));
      return;
    }
    if (picked.item.id === "rewind") {
      await openRewindMenu(sessions, withInputPaused);
      return;
    }
    if (picked.item.id === "continue") {
      const continued = await runSessionMenuPicker({
        mode: "continue",
        sessionNamespaceKey: input.sessionNamespaceKey,
        sessions,
        withInputPaused,
        runSelectMenu,
      });
      if (continued.kind === "cancelled") {
        return;
      }
      if (continued.kind === "new") {
        const nextId = await input.createNewSession();
        const switched = await input.switchActiveSession(nextId, "menu:new");
        if (switched) {
          input.applyModelOverrideForActiveSession();
        }
        return;
      }
      await input.continueFromSession(continued.sessionId);
      return;
    }
    const pickerMode: SessionMenuMode = picked.item.id === "resume" ? "resume" : "switch";
    const pickedSession = await runSessionMenuPicker({
      mode: pickerMode,
      sessionNamespaceKey: input.sessionNamespaceKey,
      sessions,
      withInputPaused,
      runSelectMenu,
    });
    if (pickedSession.kind !== "session") {
      return;
    }
    const switched = pickerMode === "resume"
      ? await input.resumeFromSession(pickedSession.sessionId, "menu:resume")
      : await input.switchActiveSession(pickedSession.sessionId, "menu:sessions");
    if (switched) {
      input.applyModelOverrideForActiveSession();
    }
  };

  const openSessionMenu = async (
    mode: SessionMenuMode,
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<void> => {
    const sessions = input.listSessions();
    if (mode !== "sessions" && sessions.length === 0) {
      input.writeStdout(buildSessionMenuNotice("暂无可用会话", [
        "当前命名空间里还没有可切换的会话。",
      ]));
      return;
    }
    if (!process.stdin.isTTY) {
      input.printSessionOverview();
      if (mode === "switch") {
        input.writeStdout(buildSessionCommandUsageNotice("/switch"));
      } else if (mode === "continue") {
        input.writeStdout(buildSessionCommandUsageNotice("/continue"));
      } else if (mode === "resume") {
        input.writeStdout(buildSessionCommandUsageNotice("/resume"));
      } else if (mode === "rewind") {
        await input.rewindSession({
          sessionId: input.getActiveSessionId(),
          mode: "summarize",
          reason: "menu:rewind:non_tty",
        });
        input.writeStdout(buildSessionCommandUsageNotice("/rewind"));
      }
      return;
    }
    if (mode === "sessions") {
      await openSessionsHubMenu(sessions, withInputPaused);
      return;
    }
    if (mode === "rewind") {
      await openRewindMenu(sessions, withInputPaused);
      return;
    }
    const picked = await runSessionMenuPicker({
      mode,
      sessionNamespaceKey: input.sessionNamespaceKey,
      sessions,
      withInputPaused,
      runSelectMenu,
    });
    if (picked.kind === "cancelled") {
      return;
    }
    if (picked.kind === "new") {
      const nextId = await input.createNewSession();
      const switched = await input.switchActiveSession(nextId, "menu:new");
      if (switched) {
        input.applyModelOverrideForActiveSession();
      }
      return;
    }
    if (mode === "continue") {
      await input.continueFromSession(picked.sessionId);
      return;
    }
    const switched = mode === "resume"
      ? await input.resumeFromSession(picked.sessionId, "menu:resume")
      : await input.switchActiveSession(
        picked.sessionId,
        mode === "switch" ? "menu:switch" : "menu:sessions",
      );
    if (switched) {
      input.applyModelOverrideForActiveSession();
    }
  };

  return {
    openSessionMenu,
  };
}
