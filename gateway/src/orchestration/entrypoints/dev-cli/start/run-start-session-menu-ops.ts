import { type SessionMenuMode } from "./session-interactive";
import { runSessionMenuPicker } from "./run-start-session-menu";
import {
  type RunStartSessionRewindInput,
  type RunStartSessionSummary,
} from "./run-start-session-ops";
import {
  runTerminalLinePrompt,
  runTerminalSelectMenu,
} from "./run-start-io";
import { type RewindRestoreMode } from "./run-start-rewind-store";

interface CreateRunStartSessionMenuOpsInput {
  sessionNamespaceKey: string;
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

export function createRunStartSessionMenuOps(
  input: CreateRunStartSessionMenuOpsInput,
): RunStartSessionMenuOps {
  const openRewindMenu = async (
    sessions: readonly RunStartSessionSummary[],
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<void> => {
    if (sessions.length === 0) {
      input.writeStdout("[rewind] no sessions available.\n\n");
      return;
    }
    const pickedSession = await runSessionMenuPicker({
      mode: "rewind",
      sessionNamespaceKey: input.sessionNamespaceKey,
      sessions,
      withInputPaused,
    });
    if (pickedSession.kind !== "session") {
      input.writeStdout("[rewind] picker cancelled.\n\n");
      return;
    }
    const sessionId = pickedSession.sessionId;
    const modePick = await withInputPaused(() =>
      runTerminalSelectMenu({
        title: "Rewind Mode",
        subtitle: `Session: ${sessionId}`,
        hint: "Choose summarize or restore mode. Enter/Space to confirm, Esc to cancel.",
        items: [
          {
            id: "summarize",
            label: "Summarize checkpoints",
            description: "Show latest checkpoints and stop.",
          },
          {
            id: "both",
            label: "Restore both conversation + code",
            description: "Recover checkpoint history and tracked file snapshots together.",
          },
          {
            id: "conversation",
            label: "Restore conversation only",
            description: "Recover history messages only.",
          },
          {
            id: "code",
            label: "Restore code only",
            description: "Recover tracked file snapshots only.",
          },
        ],
      }),
    );
    if (modePick.kind === "cancelled") {
      input.writeStdout("[rewind] mode selection cancelled.\n\n");
      return;
    }
    const mode = resolveModeFromMenuId(modePick.item.id);
    if (!mode) {
      input.writeStdout("[rewind] invalid mode selection.\n\n");
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
      input.writeStdout("[rewind] no checkpoints available.\n\n");
      return;
    }
    const pickedCheckpoint = await withInputPaused(() =>
      runTerminalSelectMenu({
        title: "Rewind Checkpoint",
        subtitle: `Session: ${sessionId}`,
        hint: "Select checkpoint to restore. Enter/Space to confirm, Esc to cancel.",
        items: [
          {
            id: "__latest__",
            label: "Latest checkpoint",
            description: "Use most recent checkpoint in selected session.",
          },
          ...checkpoints.map((checkpoint) => ({
            id: checkpoint.checkpointId,
            label: checkpoint.checkpointId,
            description:
              `${checkpoint.createdAt} | files=${String(checkpoint.changedFilesCount)} | history=${String(checkpoint.historyBeforeCount)}->${String(checkpoint.historyAfterCount)} | user=${checkpoint.userText}`,
          })),
        ],
      }),
    );
    if (pickedCheckpoint.kind === "cancelled") {
      input.writeStdout("[rewind] checkpoint selection cancelled.\n\n");
      return;
    }
    const checkpointId = pickedCheckpoint.item.id === "__latest__"
      ? undefined
      : pickedCheckpoint.item.id;
    let fileFilter: string[] | undefined;
    if (mode === "code") {
      const fileFilterInput = await withInputPaused(() =>
        runTerminalLinePrompt({
          prompt: "[rewind] files filter (optional, comma-separated)> ",
        }),
      );
      if (fileFilterInput.kind === "cancelled") {
        input.writeStdout("[rewind] file filter input cancelled.\n\n");
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
      runTerminalSelectMenu({
        title: "Session Actions",
        subtitle: `Namespace: ${input.sessionNamespaceKey}`,
        hint: "Use ↑/↓ (or j/k, Ctrl+n/p), number to select directly, Enter/Space to confirm, Esc to cancel.",
        items: [
          {
            id: "create",
            label: "Create and switch to new session",
            description: "Start a fresh isolated session context.",
          },
          {
            id: "switch",
            label: "Switch active session",
            description: "Open session picker and switch active session.",
          },
          {
            id: "resume",
            label: "Resume session",
            description: "Open full-restore picker and switch to selected session.",
          },
          {
            id: "rewind",
            label: "Rewind session",
            description: "Choose session + checkpoint to rewind conversation/code.",
          },
          {
            id: "continue",
            label: "Continue from previous session",
            description: "Open summary-bridge picker and continue from selected session.",
          },
          {
            id: "overview",
            label: "Show session overview",
            description: "Print current namespace session list and metadata.",
          },
        ],
      }),
    );
    if (picked.kind === "cancelled") {
      input.writeStdout("[session] menu cancelled.\n\n");
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
      input.writeStdout("[session] no sessions available.\n\n");
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
      });
      if (continued.kind === "cancelled") {
        input.writeStdout("[session] picker cancelled.\n\n");
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
    });
    if (pickedSession.kind !== "session") {
      input.writeStdout("[session] picker cancelled.\n\n");
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
      input.writeStdout("[session] no sessions available.\n\n");
      return;
    }
    if (!process.stdin.isTTY) {
      input.printSessionOverview();
      if (mode === "switch") {
        input.writeStdout("Usage: /switch\n\n");
      } else if (mode === "continue") {
        input.writeStdout("Usage: /continue\n\n");
      } else if (mode === "resume") {
        input.writeStdout("Usage: /resume\n\n");
      } else if (mode === "rewind") {
        await input.rewindSession({
          sessionId: input.getActiveSessionId(),
          mode: "summarize",
          reason: "menu:rewind:non_tty",
        });
        input.writeStdout("Usage: /rewind\n\n");
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
    });
    if (picked.kind === "cancelled") {
      input.writeStdout("[session] picker cancelled.\n\n");
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
