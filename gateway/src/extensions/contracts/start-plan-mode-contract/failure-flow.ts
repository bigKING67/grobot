import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRunStartPlanMode } from "../../../cli/start/plan-mode";
import {
  createRuntimeState,
  nowIsoUtc,
  persistence,
  stripAnsi,
  validPlan,
} from "./helpers";

function writeProviderFailure(runtimeState: ReturnType<typeof createRuntimeState>): void {
  runtimeState.setProviderRuntimeStates([{
    provider_name: "mock",
    consecutive_failures: 1,
    circuit_open_until_ms: 0,
    last_error_class: "upstream_connect_failed",
    last_error_message: "runtime rpc error -32001",
    last_failed_at: nowIsoUtc(),
  }]);
}

export async function runFailurePlanModeFlow(workDir: string) {
  const failureWorkDir = resolve(workDir, "failure");
  mkdirSync(failureWorkDir, { recursive: true });
  const failureSessionKey = "feishu:grobot:dm:plan-mode-failure-contract";
  const failureRuntimeState = createRuntimeState(failureSessionKey);
  let failureStderr = "";
  const failurePlanMode = createRunStartPlanMode({
    workDir: failureWorkDir,
    runtimeState: failureRuntimeState,
    persistence,
    executeTurn: async (_userInput, _interactiveMode, options) => {
      writeProviderFailure(failureRuntimeState);
      options?.writeStderr?.(
        "[runtime-route] failed attempts=1 providers=mock errors=mock:upstream_connect_failed\n",
      );
      options?.writeStderr?.(
        "runtime failed: provider=mock RuntimeRpcError: runtime rpc error -32001\n",
      );
      return 1;
    },
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      failureRuntimeState.markFailureObserved();
    },
    writeStdout: () => undefined,
    writeStderr: (message) => {
      failureStderr += message;
    },
  });
  const failureResultCode = await failurePlanMode.enterPlan("provider failure");

  const overrideWorkDir = resolve(workDir, "stdout-override");
  mkdirSync(overrideWorkDir, { recursive: true });
  const overrideSessionKey = "feishu:grobot:dm:plan-mode-stdout-override-contract";
  const overrideRuntimeState = createRuntimeState(overrideSessionKey);
  let fallbackStdout = "";
  let overrideStdout = "";
  const stdoutOverridePlanMode = createRunStartPlanMode({
    workDir: overrideWorkDir,
    runtimeState: overrideRuntimeState,
    persistence,
    executeTurn: async (_userInput, _interactiveMode, options) => {
      options?.writeStdout?.("runtime output through override\n");
      return 0;
    },
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      overrideRuntimeState.markFailureObserved();
    },
    writeStdout: (message) => {
      fallbackStdout += message;
    },
    writeStderr: () => undefined,
  });
  const stdoutOverrideResult = await stdoutOverridePlanMode.enterPlan("stdout override", {
    writeStdout: (message) => {
      overrideStdout += message;
    },
    showWorkingNotice: true,
  });

  const verboseFailureWorkDir = resolve(workDir, "verbose-failure");
  mkdirSync(verboseFailureWorkDir, { recursive: true });
  const verboseFailureSessionKey = "feishu:grobot:dm:plan-mode-verbose-failure-contract";
  const verboseFailureRuntimeState = createRuntimeState(verboseFailureSessionKey);
  let verboseFailureStderr = "";
  const originalFailureVerbose = process.env.GROBOT_PLAN_STATUS_VERBOSE;
  process.env.GROBOT_PLAN_STATUS_VERBOSE = "1";
  const verboseFailurePlanMode = createRunStartPlanMode({
    workDir: verboseFailureWorkDir,
    runtimeState: verboseFailureRuntimeState,
    persistence,
    executeTurn: async (_userInput, _interactiveMode, options) => {
      writeProviderFailure(verboseFailureRuntimeState);
      options?.writeStderr?.(
        "[runtime-route] failed attempts=1 providers=mock errors=mock:upstream_connect_failed\n",
      );
      options?.writeStderr?.(
        "runtime failed: provider=mock RuntimeRpcError: runtime rpc error -32001\n",
      );
      return 1;
    },
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      verboseFailureRuntimeState.markFailureObserved();
    },
    writeStdout: () => undefined,
    writeStderr: (message) => {
      verboseFailureStderr += message;
    },
  });
  const verboseFailureResultCode = await verboseFailurePlanMode.enterPlan(
    "provider verbose failure",
  );
  if (typeof originalFailureVerbose === "string") {
    process.env.GROBOT_PLAN_STATUS_VERBOSE = originalFailureVerbose;
  } else {
    delete process.env.GROBOT_PLAN_STATUS_VERBOSE;
  }

  const applyFailureWorkDir = resolve(workDir, "apply-failure");
  mkdirSync(applyFailureWorkDir, { recursive: true });
  const applyFailureSessionKey = "feishu:grobot:dm:plan-mode-apply-failure-contract";
  const applyFailureRuntimeState = createRuntimeState(applyFailureSessionKey);
  let applyFailureStderr = "";
  const applyFailurePlanMode = createRunStartPlanMode({
    workDir: applyFailureWorkDir,
    runtimeState: applyFailureRuntimeState,
    persistence,
    executeTurn: async (_userInput, _interactiveMode, options) => {
      writeProviderFailure(applyFailureRuntimeState);
      options?.writeStderr?.(
        "[runtime-route] failed attempts=1 providers=mock errors=mock:upstream_connect_failed\n",
      );
      options?.writeStderr?.(
        "runtime failed: provider=mock RuntimeRpcError: runtime rpc error -32001\n",
      );
      return 1;
    },
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => {
      applyFailureRuntimeState.markFailureObserved();
    },
    writeStdout: () => undefined,
    writeStderr: (message) => {
      applyFailureStderr += message;
    },
  });
  await applyFailurePlanMode.handleMessageInput("/plan implementation failure", {
    messageMode: true,
  });
  const applyFailurePlanPath = applyFailurePlanMode.getActivePlanPath();
  if (!applyFailurePlanPath) {
    throw new Error("expected active plan path for apply failure contract");
  }
  writeFileSync(applyFailurePlanPath, `${validPlan}\n`, "utf8");
  const applyFailureResult = await applyFailurePlanMode.handleMessageInput("Implement the plan.");

  return {
    compact_plan_turn_failure_code_preserved: failureResultCode === 1,
    plan_turn_stdout_override_captures_plan_scaffolding:
      stdoutOverrideResult === 0
      && overrideStdout.includes("已进入 plan mode")
      && overrideStdout.includes("正在规划...")
      && overrideStdout.includes("runtime output through override")
      && overrideStdout.includes("计划需要继续完善"),
    plan_turn_working_notice_has_plan_bullet:
      stripAnsi(overrideStdout).includes("● 正在规划..."),
    plan_turn_stdout_override_skips_fallback_writer: fallbackStdout.length === 0,
    compact_plan_turn_failure_surface_human:
      failureStderr.includes("计划更新失败")
      && failureStderr.includes("Provider 不可用: mock (upstream_connect_failed)。")
      && failureStderr.includes("计划已保存: .grobot/plans/")
      && failureStderr.includes("计划草稿已保留")
      && failureStderr.includes('直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。')
      && failureStderr.includes("诊断: PLAN_PROVIDER_RUNTIME_FAILURE"),
    compact_plan_turn_failure_hides_machine_lines:
      !failureStderr.includes("runtime failed:")
      && !failureStderr.includes("[runtime-route] failed attempts=")
      && !failureStderr.includes("plan_id="),
    verbose_plan_turn_failure_preserves_machine_lines:
      verboseFailureResultCode === 1
      && verboseFailureStderr.includes("runtime failed:")
      && verboseFailureStderr.includes("[plan] turn failed plan_id="),
    compact_plan_apply_failure_code_preserved:
      applyFailureResult.handled && applyFailureResult.code === 1,
    compact_plan_apply_failure_surface_human:
      applyFailureStderr.includes("计划实现失败")
      && applyFailureStderr.includes("Provider 不可用: mock (upstream_connect_failed)。")
      && applyFailureStderr.includes("计划已保存: .grobot/plans/")
      && applyFailureStderr.includes("计划仍可用")
      && applyFailureStderr.includes("再回复“开始实现计划”")
      && applyFailureStderr.includes("诊断: PLAN_PROVIDER_RUNTIME_FAILURE"),
    compact_plan_apply_failure_hides_machine_lines:
      !applyFailureStderr.includes("runtime failed:")
      && !applyFailureStderr.includes("[runtime-route] failed attempts=")
      && !applyFailureStderr.includes("plan_id="),
  };
}
