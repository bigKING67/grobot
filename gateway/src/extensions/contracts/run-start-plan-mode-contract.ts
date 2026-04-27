import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { reviewPlanContent } from "../../orchestration/entrypoints/dev-cli/start/plan-artifact";
import { createRunStartPlanMode } from "../../orchestration/entrypoints/dev-cli/start/run-start-plan-mode";
import { type RunStartPersistence } from "../../orchestration/entrypoints/dev-cli/start/run-start-persistence";
import { type RunStartRuntimeState } from "../../orchestration/entrypoints/dev-cli/start/run-start-runtime-state";
import { type ChatHistoryMessage } from "../../orchestration/entrypoints/dev-cli/start/session-history";
import {
  type SessionPlanMeta,
  type SessionProviderRuntimeState,
  type SessionRegistryPayload,
} from "../../orchestration/entrypoints/dev-cli/start/session-registry";

function sanitizePlanSessionSegment(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "");
  const fallback = normalized.length > 0 ? normalized : "main";
  return fallback.slice(0, 64);
}

function nowIsoUtc(): string {
  return new Date().toISOString();
}

function createRuntimeState(sessionKey: string): RunStartRuntimeState {
  const now = nowIsoUtc();
  const sessionRegistry: SessionRegistryPayload = {
    version: 1,
    namespace_key: sessionKey,
    active_id: "main",
    sessions: [
      {
        id: "main",
        session_key: sessionKey,
        created_at: now,
        updated_at: now,
        preview: "contract",
      },
    ],
  };
  let planMode: "normal" | "plan_only" = "normal";
  let planMeta: SessionPlanMeta | undefined;
  let providerStates: SessionProviderRuntimeState[] = [];
  let historyMessages: ChatHistoryMessage[] = [];
  let failureObserved = false;
  return {
    getSessionRegistry: () => sessionRegistry,
    getActiveSessionId: () => "main",
    setActiveSessionId: () => undefined,
    getSessionKey: () => sessionKey,
    setSessionKey: () => undefined,
    getHistoryMessages: () => historyMessages,
    setHistoryMessages: (rows: ChatHistoryMessage[]) => {
      historyMessages = rows;
    },
    getRestoreSource: () => "empty",
    markHistoryCompacted: () => undefined,
    hasHistoryCompacted: () => false,
    markFailureObserved: () => {
      failureObserved = true;
    },
    hasFailureObserved: () => failureObserved,
    getRestoredTurns: () => 0,
    getStickyProvider: () => undefined,
    setStickyProvider: () => undefined,
    getProviderRuntimeStates: () => providerStates,
    setProviderRuntimeStates: (rows: SessionProviderRuntimeState[]) => {
      providerStates = rows;
    },
    getPlanMode: () => planMode,
    setPlanMode: (value: "normal" | "plan_only") => {
      planMode = value;
    },
    getPlanMeta: () => planMeta,
    setPlanMeta: (value: SessionPlanMeta | undefined) => {
      planMeta = value;
    },
    getGaState: () => undefined,
    setGaState: () => undefined,
  };
}

async function main(): Promise<void> {
  const workDir = resolve(
    process.cwd(),
    ".grobot-contract-temp",
    `plan-mode-${Date.now().toString(36)}-${Math.floor(Math.random() * 65_536).toString(16)}`,
  );
  mkdirSync(workDir, { recursive: true });
  const sessionKey = "feishu:grobot:dm:plan-mode-contract";
  const runtimeState = createRuntimeState(sessionKey);
  const persistence: RunStartPersistence = {
    persistHistoryState: async () => undefined,
    persistSessionRegistryState: async () => undefined,
  };
  let stdout = "";
  let stderr = "";
  const executeInputs: string[] = [];
  const executePromptPreludes: string[] = [];
  const originalStdinIsTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });

  const validPlan = [
    "# Contract Plan",
    "",
    "- session_id: feishu:grobot:dm:plan-mode-contract",
    "- plan_id: p_contract",
    "- seq: 1",
    "- status: draft",
    "",
    "## Goal",
    "",
    "验证精简后的 plan 机制流：只保留 /plan、/plan <goal>、/plan open 与自然语言执行。",
    "",
    "## Scope In",
    "",
    "- 校验旧子命令被软失效。",
    "- 校验 /plan open 会回到状态面。",
    "- 校验 Implement the plan. 仍可触发执行。",
    "",
    "## Scope Out",
    "",
    "- 不恢复 approve/reject/verify/benchmark 命令表面。",
    "",
    "## Milestones",
    "",
    "1. [ ] 收敛命令面",
    "   - 完成判据: 只暴露 /plan、/plan <goal>、/plan open。",
    "   - 验证: contract 断言通过。",
    "   - 回退: 恢复旧命令面前重新评估交互复杂度。",
    "",
    "## Validation",
    "",
    "- npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/run-start-plan-mode-contract.ts",
    "",
    "## Risk & Rollback",
    "",
    "- 风险: 旧帮助文案或 contract 未同步。",
    "- 回退: 恢复精简前 surface 并重新整理说明。",
    "",
  ].join("\n");

  const review = reviewPlanContent(validPlan);

  try {
    const planMode = createRunStartPlanMode({
      workDir,
      runtimeState,
      persistence,
      executeTurn: async (userInput, _interactiveMode, options) => {
        executeInputs.push(userInput);
        executePromptPreludes.push(options?.promptPrelude ?? "");
        return 0;
      },
      requestRuntimeInterrupt: () => ({
        code: "TURN_INTERRUPT_NOT_RUNNING",
        interrupted: false,
      }),
      markFailureObserved: () => {
        runtimeState.markFailureObserved();
      },
      writeStdout: (message) => {
        stdout += message;
      },
      writeStderr: (message) => {
        stderr += message;
      },
    });

    const enter = await planMode.handleMessageInput("/plan contract cleanup", {
      messageMode: true,
    });
    const stdoutAfterEnter = stdout;
    const planModeAfterEnter = runtimeState.getPlanMode();
    const planPath = planMode.getActivePlanPath();
    if (!planPath) {
      throw new Error("expected active plan path after /plan <goal>");
    }
    const refine = await planMode.runPlanTurn("refine contract cleanup");
    writeFileSync(planPath, `${validPlan}\n`, "utf8");

    const stdoutBeforeOpen = stdout;
    const open = await planMode.handleMessageInput("/plan open");
    const openOutput = stdout.slice(stdoutBeforeOpen.length);
    const stdoutBeforeVerboseOpen = stdout;
    const originalVerbose = process.env.GROBOT_PLAN_STATUS_VERBOSE;
    process.env.GROBOT_PLAN_STATUS_VERBOSE = "1";
    const verboseOpen = await planMode.handleMessageInput("/plan open");
    const verboseOpenOutput = stdout.slice(stdoutBeforeVerboseOpen.length);
    if (typeof originalVerbose === "string") {
      process.env.GROBOT_PLAN_STATUS_VERBOSE = originalVerbose;
    } else {
      delete process.env.GROBOT_PLAN_STATUS_VERBOSE;
    }
    const executeCountBeforeApply = executeInputs.length;
    const execute = await planMode.handleMessageInput("Implement the plan.");

    const eventsPath = resolve(
      workDir,
      ".grobot/plans",
      sanitizePlanSessionSegment(sessionKey),
      "events.jsonl",
    );
    const eventsText = readFileSync(eventsPath, "utf8");
    const payload = {
      review_passes_for_valid_plan: review.ok && review.blocked === false,
      enter_plan_message_mode_handled: enter.handled && enter.code === 0,
      enter_plan_sets_plan_only: planModeAfterEnter === "plan_only",
      enter_plan_stdout_is_human:
        stdoutAfterEnter.includes("Enabled plan mode")
        && !stdoutAfterEnter.includes("session_key=")
        && !stdoutAfterEnter.includes("plan_id=")
        && !stdoutAfterEnter.includes("file=")
        && !stdoutAfterEnter.includes("[plan] entered PLAN_ONLY"),
      refine_plan_turn_handled: refine === 0,
      plan_turn_injects_plan_workflow_prompt:
        executePromptPreludes.some((item) =>
          item.includes("[Plan Mode Workflow]")
          && item.includes("Do not modify repo files")
          && item.includes("<proposed_plan>")),
      active_plan_path_present: typeof planPath === "string" && planPath.length > 0,
      open_plan_surface_handled: open.handled && open.code === 0,
      open_plan_surface_is_human_summary:
        openOutput.includes("Plan status")
        && openOutput.includes("Current plan:")
        && openOutput.includes("Quality:")
        && openOutput.includes("Benchmark:"),
      open_plan_surface_hides_machine_fields_by_default:
        !openOutput.includes("plan_status_output_mode:")
        && !openOutput.includes("active_plan_phase:")
        && !openOutput.includes("suggested_action_command:"),
      open_plan_surface_detects_live_decision_phase: openOutput.includes("Phase: awaiting decision"),
      open_plan_surface_detects_live_status_source: openOutput.includes("Stored state:"),
      open_plan_surface_suggests_execute: openOutput.includes("Next: Implement the plan."),
      verbose_plan_surface_handled: verboseOpen.handled && verboseOpen.code === 0,
      verbose_plan_surface_preserves_machine_fields:
        verboseOpenOutput.includes("plan_status_output_mode: full")
        && verboseOpenOutput.includes("active_plan_phase: awaiting_decision")
        && verboseOpenOutput.includes("suggested_action_command: Implement the plan."),
      execute_natural_language_handled: execute.handled && execute.code === 0,
      execute_triggered_runtime_turn: executeInputs.length === executeCountBeforeApply + 1,
      execute_payload_is_not_literal_phrase:
        executeInputs[executeInputs.length - 1]?.trim() !== "Implement the plan.",
      execute_exits_plan_only: runtimeState.getPlanMode() === "normal",
      execute_clears_active_plan_meta: runtimeState.getPlanMeta() === undefined,
      events_has_apply_succeeded: eventsText.includes("\"event\":\"plan_apply_succeeded\""),
      events_has_verification_pending: eventsText.includes("\"event\":\"plan_verification_pending\""),
      stderr_empty_on_success_path: stderr.trim().length === 0,
    };

    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } finally {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: originalStdinIsTTY,
    });
    rmSync(workDir, { recursive: true, force: true });
  }
}

void main();
