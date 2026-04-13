export type SessionInteractiveAction = "continue" | "break";

export interface SessionInteractiveHandlers {
  writeStdout(message: string): void;
  showHelp(): void;
  showSessions(): void;
  createAndSwitchSession(): Promise<void>;
  switchSession(targetSessionId: string): Promise<void>;
  continueFromSession(sourceSessionId: string): Promise<void>;
  writeHandoff(): void;
  runTurn(userInput: string): Promise<void>;
  onTurnError(error: unknown): void;
}

export function buildInteractiveHelpText(): string {
  return [
    "Interactive commands:",
    "  /sessions            List sessions in current namespace",
    "  /new                 Create and switch to a new session",
    "  /switch <id>         Switch active session",
    "  /continue <id>       Inject summary bridge from another session",
    "  /handoff             Write HANDOFF.md",
    "  /exit                Exit interactive mode",
    "",
  ].join("\n");
}

export async function dispatchSessionInteractiveInput(
  userInputRaw: string,
  handlers: SessionInteractiveHandlers,
): Promise<SessionInteractiveAction> {
  const userInput = userInputRaw.trim();
  if (!userInput) {
    return "continue";
  }

  if (userInput === "/exit" || userInput === "exit" || userInput === "quit") {
    return "break";
  }
  if (userInput === "/help") {
    handlers.showHelp();
    return "continue";
  }
  if (userInput === "/sessions") {
    handlers.showSessions();
    return "continue";
  }
  if (userInput === "/new") {
    await handlers.createAndSwitchSession();
    return "continue";
  }
  if (userInput.startsWith("/switch")) {
    const tokens = userInput.split(/\s+/, 2);
    const target = tokens[1]?.trim() ?? "";
    if (!target) {
      handlers.writeStdout("Usage: /switch <session_id>\n\n");
      return "continue";
    }
    await handlers.switchSession(target);
    return "continue";
  }
  if (userInput.startsWith("/continue")) {
    const tokens = userInput.split(/\s+/, 2);
    const sourceId = tokens[1]?.trim() ?? "";
    if (!sourceId) {
      handlers.writeStdout("Usage: /continue <session_id>\n\n");
      return "continue";
    }
    await handlers.continueFromSession(sourceId);
    return "continue";
  }
  if (userInput === "/handoff") {
    handlers.writeHandoff();
    handlers.writeStdout("\n");
    return "continue";
  }

  try {
    await handlers.runTurn(userInput);
  } catch (error) {
    handlers.onTurnError(error);
  }
  return "continue";
}
