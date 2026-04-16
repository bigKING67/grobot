import { type SessionMenuMode } from "./session-interactive";
import { runSessionMenuPicker } from "./run-start-session-menu";
import { type RunStartSessionSummary } from "./run-start-session-ops";

interface CreateRunStartSessionMenuOpsInput {
  sessionNamespaceKey: string;
  listSessions(): RunStartSessionSummary[];
  printSessionOverview(): void;
  createNewSession(): Promise<string>;
  switchActiveSession(
    targetSessionId: string,
    reason: string,
  ): Promise<boolean>;
  continueFromSession(sourceSessionId: string): Promise<void>;
  applyModelOverrideForActiveSession(): void;
  writeStdout(message: string): void;
}

export interface RunStartSessionMenuOps {
  openSessionMenu(
    mode: SessionMenuMode,
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<void>;
}

export function createRunStartSessionMenuOps(
  input: CreateRunStartSessionMenuOpsInput,
): RunStartSessionMenuOps {
  const openSessionMenu = async (
    mode: SessionMenuMode,
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<void> => {
    const sessions = input.listSessions();
    if (sessions.length === 0) {
      input.writeStdout("[session] no sessions available.\n\n");
      return;
    }
    if (!process.stdin.isTTY) {
      input.printSessionOverview();
      if (mode === "switch") {
        input.writeStdout("Usage: /switch <session_id>\n\n");
      } else if (mode === "continue") {
        input.writeStdout("Usage: /continue <session_id>\n\n");
      }
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
    const switched = await input.switchActiveSession(
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
