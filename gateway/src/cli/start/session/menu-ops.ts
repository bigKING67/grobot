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

function formatChangedFileCount(count: number): string {
  return `${String(count)} ${count === 1 ? "file" : "files"}`;
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
        title: primary ?? "No details",
        detailLines,
      }],
    }],
  });
}

function buildSessionCommandUsageNotice(command: string): string {
  return renderInfoPanel({
    title: "Session command",
    sections: [{
      title: "Available entries",
      rows: [{
        title: `Usage ${command}`,
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
      input.writeStdout(buildSessionMenuNotice("No rewindable sessions", [
        "This namespace has no selectable sessions yet.",
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
        title: "Rewind mode",
        subtitle: `session ${sessionId}`,
        hint: "↑/↓ select · Enter confirm · Esc back",
        items: [
          {
            id: "summarize",
            label: "Summarize checkpoints",
            description: "Show recent checkpoints without restoring.",
          },
          {
            id: "both",
            label: "Restore conversation + code",
            description: "Restore checkpoint conversation history and tracked file snapshots.",
          },
          {
            id: "conversation",
            label: "Restore conversation only",
            description: "Restore conversation history only.",
          },
          {
            id: "code",
            label: "Restore code only",
            description: "Restore tracked file snapshots only.",
          },
        ],
      }),
    );
    if (modePick.kind === "cancelled") {
      return;
    }
    const mode = resolveModeFromMenuId(modePick.item.id);
    if (!mode) {
      input.writeStdout(buildSessionMenuNotice("Invalid rewind mode", [
        "Reopen /rewind and choose a rewind mode.",
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
      input.writeStdout(buildSessionMenuNotice("No available checkpoints", [
        `session ${sessionId}`,
        "New rewind checkpoints are generated automatically after conversation turns.",
      ]));
      return;
    }
    const pickedCheckpoint = await withInputPaused(() =>
      runSelectMenu({
        title: "Rewind checkpoint",
        subtitle: `session ${sessionId}`,
        hint: "↑/↓ select · Enter confirm · Esc back",
        items: [
          {
            id: "__latest__",
            label: "Latest checkpoint",
            description: "Use the selected session's latest checkpoint.",
          },
          ...checkpoints.map((checkpoint) => ({
            id: checkpoint.checkpointId,
            label: checkpoint.checkpointId,
            description:
              `${checkpoint.createdAt} · ${formatChangedFileCount(checkpoint.changedFilesCount)} · messages ${String(checkpoint.historyBeforeCount)}->${String(checkpoint.historyAfterCount)} · user ${checkpoint.userText}`,
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
          prompt: "File filter (optional, comma separated)> ",
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
      input.writeStdout(buildSessionMenuNotice("No available sessions", [
        "This namespace has no switchable sessions yet.",
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
      input.writeStdout(buildSessionMenuNotice("No available sessions", [
        "This namespace has no switchable sessions yet.",
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
