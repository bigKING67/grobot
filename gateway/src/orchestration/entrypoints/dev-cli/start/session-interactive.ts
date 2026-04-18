import { parsePlanCommand } from "./plan-command";
import { buildInteractiveHelpScreen } from "../ui/screens/help-screen";

export type SessionInteractiveAction = "continue" | "break";
export type SessionMenuMode = "sessions" | "switch" | "continue";

export interface SessionInteractiveControls {
  withInputPaused<T>(operation: () => Promise<T>): Promise<T>;
}

interface ParsedModelCommand {
  kind: "menu" | "current" | "list" | "use" | "reset" | "invalid";
  modelId?: string;
  reason?: string;
}

interface ParsedStatusCommand {
  kind: "current" | "theme" | "segment" | "layout" | "invalid";
  theme?: string;
  segmentId?: string;
  segmentEnabled?: boolean;
  layoutMode?: string;
  reason?: string;
}

function matchesInteractiveCommand(input: string, command: string): boolean {
  return input === command || input.startsWith(`${command} `);
}

export interface SessionInteractiveHandlers {
  writeStdout(message: string): void;
  showHelp(): void;
  showHealthStatus(): void;
  showModelCurrent(): Promise<void>;
  listModels(): Promise<void>;
  useModel(modelId: string): Promise<void>;
  resetModel(): Promise<void>;
  openModelMenu(withInputPaused: SessionInteractiveControls["withInputPaused"]): Promise<void>;
  showStatusCurrent(): void;
  setStatusTheme(theme: string): void;
  setStatusLayoutMode(layoutMode: string): void;
  setStatusSegmentEnabled(segmentId: string, enabled: boolean): void;
  openSessionMenu(
    mode: SessionMenuMode,
    withInputPaused: SessionInteractiveControls["withInputPaused"],
  ): Promise<void>;
  createAndSwitchSession(): Promise<void>;
  switchSession(targetSessionId: string): Promise<void>;
  continueFromSession(sourceSessionId: string): Promise<void>;
  writeHandoff(): void;
  isPlanMode(): boolean;
  showPlanStatus(): Promise<void>;
  enterPlan(goal: string): Promise<void>;
  applyPlan(extra: string): Promise<void>;
  cancelPlan(): Promise<void>;
  requestPlanInterrupt(source: "command"): Promise<void>;
  requestRuntimeInterrupt(source: "command"): Promise<void>;
  runPlanTurn(userInput: string): Promise<void>;
  runTurn(userInput: string): Promise<void>;
  onTurnError(error: unknown): void;
}

function parseModelCommand(inputRaw: string): ParsedModelCommand {
  const input = inputRaw.trim();
  if (!input.startsWith("/model")) {
    return { kind: "invalid", reason: "command must start with /model" };
  }
  const rest = input.slice("/model".length).trim();
  if (!rest) {
    return { kind: "menu" };
  }
  const firstSpace = rest.indexOf(" ");
  const head = (firstSpace >= 0 ? rest.slice(0, firstSpace) : rest).trim().toLowerCase();
  const tail = (firstSpace >= 0 ? rest.slice(firstSpace + 1) : "").trim();
  if (head === "current") {
    return { kind: "current" };
  }
  if (head === "list") {
    return { kind: "list" };
  }
  if (head === "use") {
    if (!tail) {
      return { kind: "invalid", reason: "usage: /model use <model_id>" };
    }
    return { kind: "use", modelId: tail };
  }
  if (head === "reset") {
    return { kind: "reset" };
  }
  return { kind: "invalid", reason: "usage: /model | /model current | /model list | /model use <model_id> | /model reset" };
}

function parseStatusCommand(inputRaw: string): ParsedStatusCommand {
  const input = inputRaw.trim();
  if (!input.startsWith("/status")) {
    return { kind: "invalid", reason: "command must start with /status" };
  }
  const rest = input.slice("/status".length).trim();
  if (!rest || rest.toLowerCase() === "current") {
    return { kind: "current" };
  }
  if (rest === "full" || rest === "compact" || rest === "adaptive") {
    return {
      kind: "layout",
      layoutMode: rest,
    };
  }
  const firstSpace = rest.indexOf(" ");
  const head = (firstSpace >= 0 ? rest.slice(0, firstSpace) : rest).trim().toLowerCase();
  const tail = (firstSpace >= 0 ? rest.slice(firstSpace + 1) : "").trim();
  if (head === "layout") {
    if (!tail) {
      return { kind: "invalid", reason: "usage: /status layout <adaptive|full|compact>" };
    }
    return { kind: "layout", layoutMode: tail };
  }
  if (head === "theme") {
    if (!tail) {
      return { kind: "invalid", reason: "usage: /status theme <plain|nerd>" };
    }
    return { kind: "theme", theme: tail };
  }
  if (head === "segment") {
    const segmentTokens = tail.split(/\s+/).filter((token) => token.length > 0);
    if (segmentTokens.length !== 2) {
      return {
        kind: "invalid",
        reason: "usage: /status segment <model|project|context|tokens|session> <on|off>",
      };
    }
    const segmentId = segmentTokens[0];
    const state = segmentTokens[1].toLowerCase();
    if (state !== "on" && state !== "off") {
      return {
        kind: "invalid",
        reason: "usage: /status segment <model|project|context|tokens|session> <on|off>",
      };
    }
    return {
      kind: "segment",
      segmentId,
      segmentEnabled: state === "on",
    };
  }
  return {
    kind: "invalid",
    reason:
      "usage: /status | /status current | /status layout <adaptive|full|compact> | /status theme <plain|nerd> | /status segment <model|project|context|tokens|session> <on|off>",
  };
}

export function buildInteractiveHelpText(): string {
  return buildInteractiveHelpScreen();
}

export async function dispatchSessionInteractiveInput(
  userInputRaw: string,
  controls: SessionInteractiveControls,
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
    await handlers.openSessionMenu("sessions", controls.withInputPaused);
    return "continue";
  }
  if (userInput === "/health") {
    handlers.showHealthStatus();
    return "continue";
  }
  if (matchesInteractiveCommand(userInput, "/model")) {
    const parsed = parseModelCommand(userInput);
    if (parsed.kind === "invalid") {
      handlers.writeStdout(`${parsed.reason ?? "invalid model command"}\n\n`);
      return "continue";
    }
    if (parsed.kind === "menu") {
      await handlers.openModelMenu(controls.withInputPaused);
      return "continue";
    }
    if (parsed.kind === "current") {
      await handlers.showModelCurrent();
      return "continue";
    }
    if (parsed.kind === "list") {
      await handlers.listModels();
      return "continue";
    }
    if (parsed.kind === "reset") {
      await handlers.resetModel();
      return "continue";
    }
    await handlers.useModel(parsed.modelId ?? "");
    return "continue";
  }
  if (matchesInteractiveCommand(userInput, "/status")) {
    const parsed = parseStatusCommand(userInput);
    if (parsed.kind === "invalid") {
      handlers.writeStdout(`${parsed.reason ?? "invalid status command"}\n\n`);
      return "continue";
    }
    if (parsed.kind === "current") {
      handlers.showStatusCurrent();
      return "continue";
    }
    if (parsed.kind === "theme") {
      handlers.setStatusTheme(parsed.theme ?? "");
      return "continue";
    }
    if (parsed.kind === "layout") {
      handlers.setStatusLayoutMode(parsed.layoutMode ?? "");
      return "continue";
    }
    handlers.setStatusSegmentEnabled(parsed.segmentId ?? "", parsed.segmentEnabled ?? true);
    return "continue";
  }
  if (matchesInteractiveCommand(userInput, "/plan")) {
    const parsed = parsePlanCommand(userInput);
    if (parsed.kind === "invalid") {
      handlers.writeStdout(`${parsed.reason}\n\n`);
      return "continue";
    }
    if (parsed.kind === "status") {
      await handlers.showPlanStatus();
      return "continue";
    }
    if (parsed.kind === "apply") {
      await handlers.applyPlan(parsed.extra);
      return "continue";
    }
    if (parsed.kind === "cancel") {
      await handlers.cancelPlan();
      return "continue";
    }
    await handlers.enterPlan(parsed.goal);
    return "continue";
  }
  if (userInput === "/interrupt") {
    if (handlers.isPlanMode()) {
      await handlers.requestPlanInterrupt("command");
      return "continue";
    }
    await handlers.requestRuntimeInterrupt("command");
    return "continue";
  }
  if (userInput === "/new") {
    await handlers.createAndSwitchSession();
    return "continue";
  }
  if (matchesInteractiveCommand(userInput, "/switch")) {
    const tokens = userInput.split(/\s+/, 2);
    const target = tokens[1]?.trim() ?? "";
    if (!target) {
      await handlers.openSessionMenu("switch", controls.withInputPaused);
      return "continue";
    }
    await handlers.switchSession(target);
    return "continue";
  }
  if (matchesInteractiveCommand(userInput, "/continue")) {
    const tokens = userInput.split(/\s+/, 2);
    const sourceId = tokens[1]?.trim() ?? "";
    if (!sourceId) {
      await handlers.openSessionMenu("continue", controls.withInputPaused);
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
