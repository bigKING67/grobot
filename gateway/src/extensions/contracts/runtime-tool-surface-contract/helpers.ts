import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  buildRuntimeToolContextForMessage,
  buildRuntimeToolSurfaceProjectionSummary,
} from "../../../tools/runtime/default-enabled-tools";
import { validateRuntimeToolSurfaceBudget } from "../../../tools/runtime/tool-surface-budget";
import type { RuntimeEvent, RuntimeToolContext } from "../../../models/types";
import type { RuntimeToolRecoveryFeedback } from "../../../tools/runtime/tool-events";

export const contractWorkDir = join(
  process.env.TMPDIR ?? "/tmp",
  `grobot-runtime-tool-surface-contract-${String(process.pid)}-${String(Date.now())}`,
);

process.on("exit", () => {
  rmSync(contractWorkDir, { recursive: true, force: true });
});

export const baseContext = {
  workDir: contractWorkDir,
  enabledTools: ["glob", "search", "read", "write", "edit", "bash", "ask_user"],
  maxToolRounds: 8,
};

export function withEnvProfile<T>(profile: string | undefined, callback: () => T): T {
  const previous = process.env.GROBOT_TOOL_SURFACE_PROFILE;
  if (profile) {
    process.env.GROBOT_TOOL_SURFACE_PROFILE = profile;
  } else {
    delete process.env.GROBOT_TOOL_SURFACE_PROFILE;
  }
  try {
    return callback();
  } finally {
    if (typeof previous === "string") {
      process.env.GROBOT_TOOL_SURFACE_PROFILE = previous;
    } else {
      delete process.env.GROBOT_TOOL_SURFACE_PROFILE;
    }
  }
}

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

export function expectDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: actual=${actualJson} expected=${expectedJson}`);
  }
}

export function expectDecisionProfile(
  context: RuntimeToolContext,
  expectedProfile: string,
  message: string,
): void {
  expect(context.toolSurfaceDecision !== undefined, `${message}: decision missing`);
  expectEqual(context.toolSurfaceDecision.profile, expectedProfile, `${message}: decision profile`);
  expectEqual(typeof context.toolSurfaceDecision.reason, "string", `${message}: decision reason type`);
  expectEqual(typeof context.toolSurfaceDecision.scores.coding, "number", `${message}: decision coding score type`);
  expect(Array.isArray(context.toolSurfaceDecision.suppressed), `${message}: decision suppressed list`);
}

export function expectSuppressedProfile(
  context: RuntimeToolContext,
  profile: string,
  reason: string,
  message: string,
): void {
  const rows = context.toolSurfaceDecision?.suppressed ?? [];
  const match = rows.find((item) => item.profile === profile && item.reason === reason);
  expect(Boolean(match), `${message}: missing suppressed ${profile}/${reason}`);
  expect(typeof match?.originalScore === "number" && match.originalScore > 0, `${message}: original score`);
  expectEqual(match?.finalScore, 0, `${message}: final score`);
}

export function event(eventType: RuntimeEvent["eventType"], payload: Record<string, unknown>): RuntimeEvent {
  return {
    traceId: "trace_runtime_tool_surface_contract",
    turnId: "turn_runtime_tool_surface_contract",
    sessionKey: "dev:tenant:dm:user",
    eventType,
    payload,
    timestampIso: "2026-04-25T00:00:00.000Z",
  };
}

export function build(message: string | undefined, availableTools?: readonly string[]): RuntimeToolContext {
  const context = buildRuntimeToolContextForMessage(baseContext, message, availableTools);
  expect(context !== undefined, "runtime tool context should be built");
  return context;
}

export function projection(context: RuntimeToolContext) {
  return buildRuntimeToolSurfaceProjectionSummary(context);
}

export function expectProjectionWithinBudget(
  context: RuntimeToolContext,
  message: string,
): void {
  const summary = projection(context);
  const validation = validateRuntimeToolSurfaceBudget(summary);
  expect(
    validation.ok,
    `${message}: schema budget violations=${validation.violations.join(",")}`,
  );
  expect(
    validation.violationDetails.length === validation.violations.length,
    `${message}: schema budget violation details must stay aligned`,
  );
}

export function activeRecoveryFeedback(input: {
  toolName: string;
  errorClass: string;
  stage?: RuntimeToolRecoveryFeedback["stage"];
  observedAt?: string | null;
  recoverable?: boolean | null;
}): RuntimeToolRecoveryFeedback {
  return {
    active: true,
    severity: "warning",
    reason: "recent_recovery",
    stage: input.stage ?? "strategy_switch",
    toolName: input.toolName,
    errorClass: input.errorClass,
    recommendedNextAction: "switch_tool_strategy",
    recoverable: input.recoverable === undefined ? true : input.recoverable,
    requiresUserIntervention: input.recoverable === false,
    promptBlock: "recovery prompt",
    ...(input.observedAt !== null
      ? { observedAt: input.observedAt ?? "2026-04-25T00:00:00.000Z" }
      : {}),
  };
}

export const inactiveRecoveryFeedback: RuntimeToolRecoveryFeedback = {
  active: false,
  severity: "none",
  reason: "stale_recovery",
  stage: "strategy_switch",
  toolName: "web_scan",
  errorClass: "tool_not_visible",
  recommendedNextAction: "switch_tool_strategy",
  recoverable: null,
  requiresUserIntervention: false,
  promptBlock: "",
};
