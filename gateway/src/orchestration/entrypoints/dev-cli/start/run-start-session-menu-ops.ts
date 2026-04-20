import { type SessionMenuMode } from "./session-interactive";
import { runSessionMenuPicker } from "./run-start-session-menu";
import { type RunStartSessionSummary } from "./run-start-session-ops";
import { runTerminalSelectMenu } from "./run-start-io";

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
    const switchedResult = await runSessionMenuPicker({
      mode: "switch",
      sessionNamespaceKey: input.sessionNamespaceKey,
      sessions,
      withInputPaused,
    });
    if (switchedResult.kind === "cancelled") {
      input.writeStdout("[session] picker cancelled.\n\n");
      return;
    }
    if (switchedResult.kind === "new") {
      const nextId = await input.createNewSession();
      const switched = await input.switchActiveSession(nextId, "menu:new");
      if (switched) {
        input.applyModelOverrideForActiveSession();
      }
      return;
    }
    const switched = await input.switchActiveSession(
      switchedResult.sessionId,
      "menu:sessions",
    );
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
      }
      return;
    }
    if (mode === "sessions") {
      await openSessionsHubMenu(sessions, withInputPaused);
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
