import { parsePlanCommand } from "./plan-command";

export type SessionInteractiveAction = "continue" | "break";

export interface SessionInteractiveHandlers {
  writeStdout(message: string): void;
  showHelp(): void;
  showHealthStatus(): void;
  showSessions(): void;
  createAndSwitchSession(): Promise<void>;
  switchSession(targetSessionId: string): Promise<void>;
  continueFromSession(sourceSessionId: string): Promise<void>;
  writeHandoff(): void;
  isPlanMode(): boolean;
  showPlanStatus(): Promise<void>;
  showPlanContent(): Promise<void>;
  showPlanOptions(): Promise<void>;
  enterPlan(goal: string): Promise<void>;
  applyPlan(extra: string): Promise<void>;
  discardPlan(): Promise<void>;
  runPlanTurn(userInput: string): Promise<void>;
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
    "  /health              Show provider failover and circuit status",
    "  /plan <goal>         Enter plan mode and create plan artifact",
    "  /plan status         Show active plan status",
    "  /plan show           Print active plan markdown",
    "  /plan options        Show plan quick options (1/2/3/4/none of these)",
    "  /plan apply [extra]  Exit plan mode and execute approved plan",
    "  /plan discard        Discard active draft plan and exit plan mode",
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
  if (userInput === "/health") {
    handlers.showHealthStatus();
    return "continue";
  }
  if (userInput.startsWith("/plan")) {
    const parsed = parsePlanCommand(userInput);
    if (parsed.kind === "invalid") {
      handlers.writeStdout(`${parsed.reason}\n\n`);
      return "continue";
    }
    if (parsed.kind === "status") {
      await handlers.showPlanStatus();
      return "continue";
    }
    if (parsed.kind === "show") {
      await handlers.showPlanContent();
      return "continue";
    }
    if (parsed.kind === "options") {
      await handlers.showPlanOptions();
      return "continue";
    }
    if (parsed.kind === "apply") {
      await handlers.applyPlan(parsed.extra);
      return "continue";
    }
    if (parsed.kind === "discard") {
      await handlers.discardPlan();
      return "continue";
    }
    await handlers.enterPlan(parsed.goal);
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
  if (handlers.isPlanMode()) {
    await handlers.runPlanTurn(userInput);
    return "continue";
  }

  try {
    await handlers.runTurn(userInput);
  } catch (error) {
    handlers.onTurnError(error);
  }
  return "continue";
}
