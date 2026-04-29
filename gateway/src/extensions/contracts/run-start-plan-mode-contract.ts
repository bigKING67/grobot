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
    "- npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/run-start-plan-mode-contract.ts；预期: exit 0 且所有断言通过。",
    "",
    "## Risk & Rollback",
    "",
    "- 风险: 旧帮助文案或 contract 未同步。",
    "- 回退: 恢复精简前 surface 并重新整理说明。",
    "",
  ].join("\n");

  const review = reviewPlanContent(validPlan);
  const weakValidationReview = reviewPlanContent(
    validPlan.replace(
      "- npx --yes --package tsx@4.20.6 tsx gateway/src/extensions/contracts/run-start-plan-mode-contract.ts；预期: exit 0 且所有断言通过。",
      "- 看一下是否正常。",
    ),
  );
  const weakRiskReview = reviewPlanContent(
    validPlan
      .replace("- 风险: 旧帮助文案或 contract 未同步。", "- 风险: 低")
      .replace("- 回退: 恢复精简前 surface 并重新整理说明。", "- 回退: 回滚"),
  );
  const canonicalProposedPlanReview = reviewPlanContent(
    `<proposed_plan>\n${validPlan}\n</proposed_plan>`,
  );

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
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });
    const stdoutBeforeScriptOpen = stdout;
    const scriptOpen = await planMode.handleMessageInput("/plan open");
    const scriptOpenOutput = stdout.slice(stdoutBeforeScriptOpen.length);
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    const executeCountBeforeApply = executeInputs.length;
    const stdoutBeforeApply = stdout;
    const execute = await planMode.handleMessageInput("Implement the plan.");
    const applyOutput = stdout.slice(stdoutBeforeApply.length);
    const applyPrompt = executeInputs[executeInputs.length - 1] ?? "";

    const eventsPath = resolve(
      workDir,
      ".grobot/plans",
      sanitizePlanSessionSegment(sessionKey),
      "events.jsonl",
    );
    const eventsText = readFileSync(eventsPath, "utf8");

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
        failureRuntimeState.setProviderRuntimeStates([{
          provider_name: "mock",
          consecutive_failures: 1,
          circuit_open_until_ms: 0,
          last_error_class: "upstream_connect_failed",
          last_error_message: "runtime rpc error -32001",
          last_failed_at: nowIsoUtc(),
        }]);
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
        verboseFailureRuntimeState.setProviderRuntimeStates([{
          provider_name: "mock",
          consecutive_failures: 1,
          circuit_open_until_ms: 0,
          last_error_class: "upstream_connect_failed",
          last_error_message: "runtime rpc error -32001",
          last_failed_at: nowIsoUtc(),
        }]);
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
        applyFailureRuntimeState.setProviderRuntimeStates([{
          provider_name: "mock",
          consecutive_failures: 1,
          circuit_open_until_ms: 0,
          last_error_class: "upstream_connect_failed",
          last_error_message: "runtime rpc error -32001",
          last_failed_at: nowIsoUtc(),
        }]);
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
      plan_turn_prompt_requires_strict_plan_sections:
        executePromptPreludes.some((item) =>
          item.includes("Validation must include real commands")
          && item.includes("Risk & Rollback must name concrete failure modes")),
      review_rejects_validation_without_command:
        !weakValidationReview.ok
        && weakValidationReview.findings.some((item) => item.code === "validation_missing_command"),
      review_rejects_validation_without_expected_result:
        !weakValidationReview.ok
        && weakValidationReview.findings.some((item) => item.code === "validation_missing_expected_result"),
      review_rejects_vague_risk:
        !weakRiskReview.ok
        && weakRiskReview.findings.some((item) => item.code === "risk_too_vague"),
      review_rejects_vague_rollback:
        !weakRiskReview.ok
        && weakRiskReview.findings.some((item) => item.code === "rollback_too_vague"),
      review_accepts_canonical_proposed_plan_block:
        canonicalProposedPlanReview.ok && canonicalProposedPlanReview.blocked === false,
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
        && !openOutput.includes("suggested_action_command:")
        && !openOutput.includes("session_id:")
        && !openOutput.includes("plan_id:")
        && !openOutput.includes("seq:")
        && !openOutput.includes("status:"),
      open_plan_surface_detects_live_decision_phase: openOutput.includes("Phase: awaiting decision"),
      open_plan_surface_hides_old_stored_state_label:
        !openOutput.includes("Stored state:"),
      open_plan_surface_splits_quality_lines:
        openOutput.includes("Quality: score")
        && openOutput.includes("Guard:")
        && !openOutput.includes("Quality: score 5;"),
      open_plan_surface_suggests_execute: openOutput.includes("Next: Implement the plan."),
      open_plan_surface_uses_relative_plan_file:
        /^Plan file: \.grobot\/plans\//m.test(openOutput),
      open_plan_surface_hides_absolute_plan_file:
        !openOutput.includes(`Plan file: ${workDir}`),
      verbose_plan_surface_handled: verboseOpen.handled && verboseOpen.code === 0,
      verbose_plan_surface_preserves_machine_fields:
        verboseOpenOutput.includes("plan_status_output_mode: full")
        && verboseOpenOutput.includes("active_plan_phase: awaiting_decision")
        && verboseOpenOutput.includes("suggested_action_command: Implement the plan."),
      script_plan_surface_defaults_to_human_summary:
        scriptOpen.handled
        && scriptOpen.code === 0
        && scriptOpenOutput.includes("Plan status")
        && scriptOpenOutput.includes("Current plan:")
        && scriptOpenOutput.includes("Next: Implement the plan."),
      script_plan_surface_hides_machine_fields_by_default:
        !scriptOpenOutput.includes("plan_status_output_mode:")
        && !scriptOpenOutput.includes("active_plan_phase:")
        && !scriptOpenOutput.includes("suggested_action_command:")
        && !scriptOpenOutput.includes("session_id:")
        && !scriptOpenOutput.includes("plan_id:")
        && !scriptOpenOutput.includes("seq:")
        && !scriptOpenOutput.includes("status:"),
      script_plan_surface_hides_old_stored_state_label:
        !scriptOpenOutput.includes("Stored state:"),
      script_plan_surface_splits_quality_lines:
        scriptOpenOutput.includes("Quality: score")
        && scriptOpenOutput.includes("Guard:")
        && !scriptOpenOutput.includes("Quality: score 5;"),
      script_plan_surface_uses_relative_plan_file:
        /^Plan file: \.grobot\/plans\//m.test(scriptOpenOutput),
      script_plan_surface_hides_absolute_plan_file:
        !scriptOpenOutput.includes(`Plan file: ${workDir}`),
      execute_natural_language_handled: execute.handled && execute.code === 0,
      execute_triggered_runtime_turn: executeInputs.length === executeCountBeforeApply + 1,
      execute_payload_is_not_literal_phrase:
        applyPrompt.trim() !== "Implement the plan.",
      execute_payload_has_approved_plan_contract:
        applyPrompt.includes("[Approved Plan Execution]")
        && applyPrompt.includes("Plan approval:")
        && applyPrompt.includes("Execution contract:")
        && applyPrompt.includes("Plan to implement:")
        && applyPrompt.includes("<approved_plan>")
        && applyPrompt.includes("</approved_plan>"),
      execute_payload_has_approval_metadata:
        applyPrompt.includes("- ticket:")
        && applyPrompt.includes("- sha256:"),
      execute_payload_has_scope_guardrails:
        applyPrompt.includes("Do not silently expand scope beyond Scope In")
        && applyPrompt.includes("stop and return to plan mode with the conflict")
        && applyPrompt.includes("validation aligned with the plan's Milestones and Validation sections"),
      execute_payload_contains_approved_plan_snapshot:
        applyPrompt.includes("# Contract Plan")
        && applyPrompt.includes("## Validation")
        && applyPrompt.includes("## Risk & Rollback"),
      execute_payload_omits_plain_trigger_as_extra:
        !applyPrompt.includes("Additional user instruction:\nImplement the plan."),
      apply_surface_shows_approved_plan_start:
        applyOutput.includes("Plan approved")
        && applyOutput.includes("Plan to implement")
        && applyOutput.includes("Starting implementation from approved snapshot"),
      apply_surface_renders_plan_card:
        applyOutput.includes("╭─ Plan to implement")
        && applyOutput.includes("│ Contract Plan")
        && applyOutput.includes("│ Goal:")
        && applyOutput.includes("│ Validation:")
        && applyOutput.includes("╰─ approval"),
      apply_surface_hides_machine_fields:
        !applyOutput.includes("plan_id=")
        && !applyOutput.includes("session_key=")
        && !applyOutput.includes("approved_snapshot_path"),
      apply_surface_hides_plan_metadata_preview:
        !applyOutput.includes("session_id:")
        && !applyOutput.includes("plan_id:")
        && !applyOutput.includes("seq:")
        && !applyOutput.includes("status:"),
      apply_surface_does_not_echo_literal_trigger:
        !applyOutput.includes("Implement the plan."),
      execute_exits_plan_only: runtimeState.getPlanMode() === "normal",
      execute_clears_active_plan_meta: runtimeState.getPlanMeta() === undefined,
      events_has_apply_succeeded: eventsText.includes("\"event\":\"plan_apply_succeeded\""),
      events_has_verification_pending: eventsText.includes("\"event\":\"plan_verification_pending\""),
      compact_plan_turn_failure_code_preserved: failureResultCode === 1,
      plan_turn_stdout_override_captures_plan_scaffolding:
        stdoutOverrideResult === 0
        && overrideStdout.includes("Enabled plan mode")
        && overrideStdout.includes("Working on the plan")
        && overrideStdout.includes("runtime output through override")
        && overrideStdout.includes("Plan needs refinement"),
      plan_turn_stdout_override_skips_fallback_writer: fallbackStdout.length === 0,
      compact_plan_turn_failure_surface_human:
        failureStderr.includes("Plan update failed")
        && failureStderr.includes("Provider unavailable: mock (upstream_connect_failed).")
        && failureStderr.includes("Plan draft was kept")
        && failureStderr.includes("Diagnostics: PLAN_PROVIDER_RUNTIME_FAILURE"),
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
        applyFailureStderr.includes("Plan implementation failed")
        && applyFailureStderr.includes("Provider unavailable: mock (upstream_connect_failed).")
        && applyFailureStderr.includes("Plan is still available")
        && applyFailureStderr.includes("Diagnostics: PLAN_PROVIDER_RUNTIME_FAILURE"),
      compact_plan_apply_failure_hides_machine_lines:
        !applyFailureStderr.includes("runtime failed:")
        && !applyFailureStderr.includes("[runtime-route] failed attempts=")
        && !applyFailureStderr.includes("plan_id="),
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
