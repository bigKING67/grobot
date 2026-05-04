import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeEvent } from "../../../models/types";
import { isRuntimeToolRecoveryAction } from "../../../tools/runtime/tool-events";

export function expect(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: actual=${String(actual)} expected=${String(expected)}`);
  }
}

export function expectBefore(text: string, left: string, right: string, message: string): void {
  const leftIndex = text.indexOf(left);
  const rightIndex = text.indexOf(right);
  expect(leftIndex >= 0, `${message}: missing left fragment ${left}`);
  expect(rightIndex >= 0, `${message}: missing right fragment ${right}`);
  expect(leftIndex < rightIndex, `${message}: expected ${left} before ${right}`);
}

export function event(eventType: RuntimeEvent["eventType"], payload: Record<string, unknown>): RuntimeEvent {
  return {
    traceId: "trace_runtime_tool_events_contract",
    turnId: "turn_runtime_tool_events_contract",
    sessionKey: "dev:tenant:dm:user",
    eventType,
    payload,
    timestampIso: "2026-04-25T00:00:00.000Z",
  };
}

export function expectPromptIncludes(
  promptBlock: string,
  snippets: readonly string[],
  messagePrefix: string,
): void {
  for (const snippet of snippets) {
    expect(
      promptBlock.includes(snippet),
      `${messagePrefix}: missing prompt snippet ${snippet}`,
    );
  }
}

export function expectFeedbackActionInCatalog(
  action: string | null,
  message: string,
): void {
  expect(typeof action === "string" && action.length > 0, `${message}: action missing`);
  expect(isRuntimeToolRecoveryAction(action), `${message}: action not cataloged: ${action}`);
}

export function tmpWorkDir(prefix: string): string {
  const workDir = join("/tmp", `${prefix}-${String(process.pid)}-${String(Date.now())}`);
  mkdirSync(workDir, { recursive: true });
  return workDir;
}
