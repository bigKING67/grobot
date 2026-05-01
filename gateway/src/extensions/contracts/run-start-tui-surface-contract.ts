import {
  buildExperienceSchedulerTaskFailedSurface,
  buildExperienceSchedulerTickErrorSurface,
  buildMcpInstructionStrictFailureSurface,
  buildRewindCaptureFailedSurface,
} from "../../orchestration/entrypoints/dev-cli/start/run-start";
import { runStartMessageMode } from "../../orchestration/entrypoints/dev-cli/start/run-start-message-mode";

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

const mcpStrictFailureSurface = buildMcpInstructionStrictFailureSurface(
  "missing required MCP rule packs for servers: grok-search",
);
const schedulerTickSurface = buildExperienceSchedulerTickErrorSurface(
  "Error: failed to parse schedule window",
);
const schedulerTaskFailedSurface = buildExperienceSchedulerTaskFailedSurface({
  taskId: "weekly-summary",
  error: "Error: model route unavailable",
});
const rewindCaptureFailedSurface = buildRewindCaptureFailedSurface(
  "Error: checkpoint store unavailable",
);

const mcpPlain = stripAnsi(mcpStrictFailureSurface);
const schedulerTickPlain = stripAnsi(schedulerTickSurface);
const schedulerTaskPlain = stripAnsi(schedulerTaskFailedSurface);
const combined = [
  mcpStrictFailureSurface,
  schedulerTickSurface,
  schedulerTaskFailedSurface,
  rewindCaptureFailedSurface,
].join("\n");

async function resolveMessageModeDiagnosticPayload(): Promise<{
  compact: boolean | undefined;
  verbose: boolean | undefined;
}> {
  let compactMessageModeEmitDiagnostics: boolean | undefined;
  await runStartMessageMode({
    message: "compact message diagnostics",
    emitDiagnostics: false,
    executeTurn: async (_userInput, _interactiveMode, options) => {
      compactMessageModeEmitDiagnostics = options?.emitDiagnostics;
      return 0;
    },
    markFailureObserved: () => undefined,
    handoffAutoOnExit: false,
    writeAutoExitHandoffIfNeeded: () => undefined,
  });

  let verboseMessageModeEmitDiagnostics: boolean | undefined;
  await runStartMessageMode({
    message: "verbose message diagnostics",
    emitDiagnostics: true,
    executeTurn: async (_userInput, _interactiveMode, options) => {
      verboseMessageModeEmitDiagnostics = options?.emitDiagnostics;
      return 0;
    },
    markFailureObserved: () => undefined,
    handoffAutoOnExit: false,
    writeAutoExitHandoffIfNeeded: () => undefined,
  });

  return {
    compact: compactMessageModeEmitDiagnostics,
    verbose: verboseMessageModeEmitDiagnostics,
  };
}

async function main(): Promise<void> {
  const messageModeDiagnosticPayload = await resolveMessageModeDiagnosticPayload();
  const payload = {
    mcp_strict_failure_is_human_surface:
      mcpPlain.includes("● MCP 指令加载失败")
      && mcpPlain.includes("strict 模式要求所有启用的 MCP 都有指令包。")
      && mcpPlain.includes("原因: missing_required_MCP_rule_packs_for_servers:_grok-search"),
    mcp_strict_failure_has_fix_hint:
      mcpPlain.includes("请补齐 .grobot/rules/mcp/<server>.md")
      && mcpPlain.includes("mcp.instructions.strict"),
    scheduler_tick_error_is_human_surface:
      schedulerTickPlain.includes("● 经验任务调度失败")
      && schedulerTickPlain.includes("后台任务本轮已跳过，不影响当前输入。")
      && schedulerTickPlain.includes("原因: Error:_failed_to_parse_schedule_window"),
    scheduler_task_failed_is_human_surface:
      schedulerTaskPlain.includes("● 经验任务执行失败")
      && schedulerTaskPlain.includes("任务: weekly-summary")
      && schedulerTaskPlain.includes("本轮调度已记录失败，不影响继续输入。")
      && schedulerTaskPlain.includes("原因: Error:_model_route_unavailable"),
    rewind_capture_failed_is_human_surface:
      stripAnsi(rewindCaptureFailedSurface).includes("● 检查点保存失败")
      && stripAnsi(rewindCaptureFailedSurface).includes("本轮对话已继续，但这一步无法用于 /rewind 回退。")
      && stripAnsi(rewindCaptureFailedSurface).includes("原因: Error:_checkpoint_store_unavailable"),
    surfaces_avoid_legacy_machine_markers:
      !combined.includes("[governance:mcp-instruction]")
      && !combined.includes("[experience-scheduler]")
      && !combined.includes("[rewind]")
      && !combined.includes("event=")
      && !combined.includes("detail=")
      && !combined.includes("task=")
      && !combined.includes("reason="),
    surfaces_end_with_newline:
      mcpStrictFailureSurface.endsWith("\n")
      && schedulerTickSurface.endsWith("\n")
      && schedulerTaskFailedSurface.endsWith("\n")
      && rewindCaptureFailedSurface.endsWith("\n"),
    message_mode_compact_disables_turn_diagnostics: messageModeDiagnosticPayload.compact === false,
    message_mode_verbose_keeps_turn_diagnostics: messageModeDiagnosticPayload.verbose === true,
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
