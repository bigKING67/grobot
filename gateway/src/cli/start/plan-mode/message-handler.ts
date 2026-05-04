import {
  isNaturalPlanExecutionIntent,
  parsePlanCommand,
} from "../plan-command";
import type { PlanMessageHandleResult } from "./contract";
import { buildPlanCommandErrorSurface } from "./surfaces";

export interface RunPlanMessageInput {
  messageRaw: string;
  messageMode?: boolean;
  isPlanMode(): boolean;
  writeStdout(message: string): void;
  requestInterrupt(): Promise<void>;
  createDraft(
    goal: string,
    options?: {
      printHint?: boolean;
      printModeReadyOnly?: boolean;
    },
  ): Promise<number>;
  enterPlan(goal: string): Promise<number>;
  showStatus(): Promise<number>;
  applyPlan(message: string): Promise<number>;
  runPlanTurn(
    message: string,
    options?: {
      skipExecution?: boolean;
    },
  ): Promise<number>;
}

function isPlanSlashCommand(message: string): boolean {
  return /^\/plan(?:\s|$)/.test(message);
}

export async function runPlanMessageInput(
  input: RunPlanMessageInput,
): Promise<PlanMessageHandleResult> {
  const message = input.messageRaw.trim();
  if (!message) {
    return { handled: false, code: 0 };
  }
  if (message === "/interrupt") {
    await input.requestInterrupt();
    return { handled: true, code: 0 };
  }
  if (isPlanSlashCommand(message)) {
    const parsed = parsePlanCommand(message);
    if (parsed.kind === "invalid") {
      input.writeStdout(buildPlanCommandErrorSurface(parsed.reason));
      return { handled: true, code: 0 };
    }
    if (parsed.kind === "enter") {
      if (input.isPlanMode()) {
        return { handled: true, code: await input.showStatus() };
      }
      if (input.messageMode) {
        return {
          handled: true,
          code: await input.createDraft(parsed.goal, {
            printHint: false,
            printModeReadyOnly: true,
          }),
        };
      }
      return { handled: true, code: await input.enterPlan(parsed.goal) };
    }
    if (parsed.kind === "enter_mode") {
      if (input.isPlanMode()) {
        return { handled: true, code: await input.showStatus() };
      }
      if (input.messageMode) {
        return {
          handled: true,
          code: await input.createDraft("", {
            printHint: false,
            printModeReadyOnly: true,
          }),
        };
      }
      return { handled: true, code: await input.enterPlan("") };
    }
    if (parsed.kind === "open") {
      if (!input.isPlanMode()) {
        if (input.messageMode) {
          return {
            handled: true,
            code: await input.createDraft("", {
              printHint: false,
              printModeReadyOnly: true,
            }),
          };
        }
        return { handled: true, code: await input.enterPlan("") };
      }
      return { handled: true, code: await input.showStatus() };
    }
    return { handled: true, code: 0 };
  }
  if (input.isPlanMode()) {
    if (isNaturalPlanExecutionIntent(message)) {
      return {
        handled: true,
        code: await input.applyPlan(message),
      };
    }
    return {
      handled: true,
      code: await input.runPlanTurn(message, {
        skipExecution: input.messageMode,
      }),
    };
  }
  return { handled: false, code: 0 };
}
