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
  const cleanOverrideStdout = stripAnsi(overrideStdout);
  const cleanFailureStderr = stripAnsi(failureStderr);
  const cleanApplyFailureStderr = stripAnsi(applyFailureStderr);

  return {
    compact_plan_turn_failure_code_preserved: failureResultCode === 1,
    plan_turn_stdout_override_captures_plan_scaffolding:
      stdoutOverrideResult === 0
      && cleanOverrideStdout.includes("Entered plan mode")
      && cleanOverrideStdout.includes("Planning...")
      && overrideStdout.includes("runtime output through override")
      && cleanOverrideStdout.includes("Plan needs refinement"),
    plan_turn_working_notice_uses_info_panel:
      !cleanOverrideStdout.includes("● Planning...")
      && cleanOverrideStdout.includes("Planning...")
      && cleanOverrideStdout.includes("• The model is drafting the plan."),
    plan_turn_stdout_override_skips_fallback_writer: fallbackStdout.length === 0,
    compact_plan_turn_failure_surface_human:
      cleanFailureStderr.includes("Plan update failed")
      && cleanFailureStderr.includes("• Runtime did not finish")
      && cleanFailureStderr.includes("  ⎿")
      && cleanFailureStderr.includes("Provider mock is unavailable (upstream connection failed).")
      && cleanFailureStderr.includes("Plan saved: .grobot/plans/")
      && cleanFailureStderr.includes("Plan draft kept and plan mode remains active")
      && cleanFailureStderr.includes('Type more details to refine it, or use "/plan open" to edit the draft.')
      && cleanFailureStderr.includes("Verbose logs include provider, exit code, and policy fields.")
      && !cleanFailureStderr.includes("供应商不可用:")
      && !cleanFailureStderr.includes("详情:")
      && !cleanFailureStderr.includes("Provider 不可用")
      && !cleanFailureStderr.includes("provider、exit code 和 policy")
      && !cleanFailureStderr.includes("PLAN_PROVIDER_RUNTIME_FAILURE"),
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
      cleanApplyFailureStderr.includes("Plan implementation failed")
      && cleanApplyFailureStderr.includes("Provider mock is unavailable (upstream connection failed).")
      && cleanApplyFailureStderr.includes("Plan saved: .grobot/plans/")
      && cleanApplyFailureStderr.includes("The plan is still available")
      && cleanApplyFailureStderr.includes("reply Implement the plan")
      && cleanApplyFailureStderr.includes("Verbose logs include provider, exit code, and policy fields.")
      && !cleanApplyFailureStderr.includes("供应商不可用:")
      && !cleanApplyFailureStderr.includes("详情:")
      && !cleanApplyFailureStderr.includes("Provider 不可用")
      && !cleanApplyFailureStderr.includes("provider、exit code 和 policy")
      && !cleanApplyFailureStderr.includes("PLAN_PROVIDER_RUNTIME_FAILURE"),
    compact_plan_apply_failure_hides_machine_lines:
      !applyFailureStderr.includes("runtime failed:")
      && !applyFailureStderr.includes("[runtime-route] failed attempts=")
      && !applyFailureStderr.includes("plan_id="),
    compact_apply_failed_status_surface_shows_human_state:
      applyFailureStatusResult === 0
      && applyFailureStatusSurface.includes("Current plan")
      && applyFailureStatusSurface.includes("apply failed")
      && applyFailureStatusSurface.includes("# Contract Plan"),
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
