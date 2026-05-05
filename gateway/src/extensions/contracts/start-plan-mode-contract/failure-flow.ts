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
  let applyFailureStatusStdout = "";
  const applyFailureStatusPlanMode = createRunStartPlanMode({
    workDir: applyFailureWorkDir,
    runtimeState: applyFailureRuntimeState,
    persistence,
    executeTurn: async () => 0,
    requestRuntimeInterrupt: () => ({
      code: "TURN_INTERRUPT_NOT_RUNNING",
      interrupted: false,
    }),
    markFailureObserved: () => undefined,
    writeStdout: (message) => {
      applyFailureStatusStdout += message;
    },
    writeStderr: () => undefined,
  });
  const applyFailureStatusResult = await applyFailureStatusPlanMode.showPlanStatus();
  const applyFailureStatusSurface = stripAnsi(applyFailureStatusStdout);

  return {
    compact_plan_turn_failure_code_preserved: failureResultCode === 1,
    plan_turn_stdout_override_captures_plan_scaffolding:
      stdoutOverrideResult === 0
      && overrideStdout.includes("已进入计划模式")
      && overrideStdout.includes("正在规划...")
      && overrideStdout.includes("runtime output through override")
      && overrideStdout.includes("计划需要继续完善"),
    plan_turn_working_notice_uses_info_panel:
      !stripAnsi(overrideStdout).includes("● 正在规划...")
      && stripAnsi(overrideStdout).includes("正在规划...")
      && stripAnsi(overrideStdout).includes("• 模型正在生成计划草稿。"),
    plan_turn_stdout_override_skips_fallback_writer: fallbackStdout.length === 0,
    compact_plan_turn_failure_surface_human:
      failureStderr.includes("计划更新失败")
      && failureStderr.includes("• 运行时未完成")
      && failureStderr.includes("  ⎿")
      && failureStderr.includes("通道 mock 不可用（上游连接失败）。")
      && failureStderr.includes("计划已保存: .grobot/plans/")
      && failureStderr.includes("计划草稿已保留")
      && failureStderr.includes('直接输入补充内容继续完善，或使用 "/plan open" 编辑草稿。')
      && failureStderr.includes("详细日志可查看通道、退出码和策略字段。")
      && !failureStderr.includes("供应商不可用:")
      && !failureStderr.includes("详情:")
      && !failureStderr.includes("Provider 不可用")
      && !failureStderr.includes("provider、exit code 和 policy")
      && !failureStderr.includes("PLAN_PROVIDER_RUNTIME_FAILURE"),
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
      && applyFailureStderr.includes("通道 mock 不可用（上游连接失败）。")
      && applyFailureStderr.includes("计划已保存: .grobot/plans/")
      && applyFailureStderr.includes("计划仍可用")
      && applyFailureStderr.includes("再回复“开始实现计划”")
      && applyFailureStderr.includes("详细日志可查看通道、退出码和策略字段。")
      && !applyFailureStderr.includes("供应商不可用:")
      && !applyFailureStderr.includes("详情:")
      && !applyFailureStderr.includes("Provider 不可用")
      && !applyFailureStderr.includes("provider、exit code 和 policy")
      && !applyFailureStderr.includes("PLAN_PROVIDER_RUNTIME_FAILURE"),
    compact_plan_apply_failure_hides_machine_lines:
      !applyFailureStderr.includes("runtime failed:")
      && !applyFailureStderr.includes("[runtime-route] failed attempts=")
      && !applyFailureStderr.includes("plan_id="),
    compact_apply_failed_status_surface_shows_human_state:
      applyFailureStatusResult === 0
      && applyFailureStatusSurface.includes("当前计划")
      && applyFailureStatusSurface.includes("状态 执行失败")
      && applyFailureStatusSurface.includes("计划仍保留")
      && applyFailureStatusSurface.includes("开始实现计划"),
    compact_apply_failed_status_surface_hides_machine_fields:
      !applyFailureStatusSurface.includes("plan_status_output_mode:")
      && !applyFailureStatusSurface.includes("active_plan_id:")
      && !applyFailureStatusSurface.includes("latest_failure_diagnostic_code:")
      && !applyFailureStatusSurface.includes("recommended_next_action:")
      && !applyFailureStatusSurface.includes("suggested_action_reason:")
      && !applyFailureStatusSurface.includes("PLAN_PROVIDER_RUNTIME_FAILURE")
      && !applyFailureStatusSurface.includes("plan_id")
      && !applyFailureStatusSurface.includes("p_implementation"),
  };
}
