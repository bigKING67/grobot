import {
  buildExperienceSchedulerTaskFailedSurface,
  buildExperienceSchedulerTickErrorSurface,
  buildMemoryMaintenanceFailedSurface,
  buildMcpInstructionStrictFailureSurface,
  buildRewindCaptureFailedSurface,
  buildRuntimeInterruptIgnoredSurface,
} from "../../cli/start/startup/surfaces";
import { resolveDisplayProjectPath } from "../../cli/start/startup/banner";
import { runStartMessageMode } from "../../cli/start/message-mode";

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
const memoryMaintenanceFailedSurface = buildMemoryMaintenanceFailedSurface({
  reason: "post_turn",
  error: "Error: decay index locked",
});
const runtimeInterruptIgnoredSurface = buildRuntimeInterruptIgnoredSurface({
  source: "command",
});
const rewindCaptureFailedSurface = buildRewindCaptureFailedSurface(
  "Error: checkpoint store unavailable",
);

const mcpPlain = stripAnsi(mcpStrictFailureSurface);
const schedulerTickPlain = stripAnsi(schedulerTickSurface);
const schedulerTaskPlain = stripAnsi(schedulerTaskFailedSurface);
const memoryMaintenancePlain = stripAnsi(memoryMaintenanceFailedSurface);
const runtimeInterruptIgnoredPlain = stripAnsi(runtimeInterruptIgnoredSurface);
const combined = [
  mcpStrictFailureSurface,
  schedulerTickSurface,
  schedulerTaskFailedSurface,
  memoryMaintenanceFailedSurface,
  runtimeInterruptIgnoredSurface,
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
  const messageModeDiagnosticPayload =
    await resolveMessageModeDiagnosticPayload();
  const userHome = process.env.HOME ?? "";
  const homeRelativeProjectPath = userHome
    ? resolveDisplayProjectPath({
      projectRoot: `${userHome.replace(/[\\/]+$/, "")}/Documents/demo/grobot`,
    })
    : "";
  const payload = {
    startup_project_path_uses_user_home_relative_display:
      homeRelativeProjectPath === "~/Documents/demo/grobot",
    startup_project_path_does_not_depend_on_grobot_home:
      !homeRelativeProjectPath.includes(".grobot"),
    mcp_strict_failure_is_human_surface:
      mcpPlain.includes("MCP instruction load failed") &&
      !mcpPlain.includes("● MCP instruction load failed") &&
      mcpPlain.includes("• Strict mode requires instruction packs for all enabled MCP servers.") &&
      mcpPlain.includes("⎿  reason missing_required_MCP_rule_packs_for_servers:_grok-search") &&
      mcpPlain.includes(
        "⎿  Add .grobot/rules/mcp/<server>.md or disable mcp.instructions.strict.",
      ),
    mcp_strict_failure_has_fix_hint:
      mcpPlain.includes(".grobot/rules/mcp/<server>.md") &&
      mcpPlain.includes("mcp.instructions.strict"),
    scheduler_tick_error_is_human_surface:
      schedulerTickPlain.includes("Experience scheduler tick failed") &&
      !schedulerTickPlain.includes("● Experience scheduler tick failed") &&
      schedulerTickPlain.includes("• Background task skipped this turn; current input is unaffected.") &&
      schedulerTickPlain.includes("⎿  reason Error:_failed_to_parse_schedule_window"),
    scheduler_task_failed_is_human_surface:
      schedulerTaskPlain.includes("Experience task failed") &&
      !schedulerTaskPlain.includes("● Experience task failed") &&
      schedulerTaskPlain.includes("• task weekly-summary") &&
      schedulerTaskPlain.includes("⎿  The failure was recorded; input can continue.") &&
      schedulerTaskPlain.includes("⎿  reason Error:_model_route_unavailable"),
    memory_maintenance_failed_is_human_surface:
      memoryMaintenancePlain.includes("Memory maintenance failed") &&
      !memoryMaintenancePlain.includes("● Memory maintenance failed") &&
      memoryMaintenancePlain.includes("• stage post_turn") &&
      memoryMaintenancePlain.includes("⎿  This conversation will continue; background memory cleanup will retry later.") &&
      memoryMaintenancePlain.includes("⎿  reason Error:_decay_index_locked"),
    runtime_interrupt_ignored_is_human_surface:
      runtimeInterruptIgnoredPlain.includes("Interrupt request ignored") &&
      !runtimeInterruptIgnoredPlain.includes("● Interrupt request ignored") &&
      runtimeInterruptIgnoredPlain.includes("• /interrupt request was skipped.") &&
      runtimeInterruptIgnoredPlain.includes("⎿  Current turn completed or passed the safe interrupt point."),
    rewind_capture_failed_is_human_surface:
      stripAnsi(rewindCaptureFailedSurface).includes("Checkpoint capture failed") &&
      !stripAnsi(rewindCaptureFailedSurface).includes("● Checkpoint capture failed") &&
      stripAnsi(rewindCaptureFailedSurface).includes("• This turn continued.") &&
      stripAnsi(rewindCaptureFailedSurface).includes("⎿  This step cannot be used for /rewind.") &&
      stripAnsi(rewindCaptureFailedSurface).includes("⎿  reason Error:_checkpoint_store_unavailable"),
    surfaces_avoid_legacy_machine_markers:
      !combined.includes("[governance:mcp-instruction]") &&
      !combined.includes("[experience-scheduler]") &&
      !combined.includes("[rewind]") &&
      !combined.includes("event=") &&
      !combined.includes("detail=") &&
      !combined.includes("task=") &&
      !combined.includes("reason="),
    surfaces_end_with_newline:
      mcpStrictFailureSurface.endsWith("\n") &&
      schedulerTickSurface.endsWith("\n") &&
      schedulerTaskFailedSurface.endsWith("\n") &&
      memoryMaintenanceFailedSurface.endsWith("\n") &&
      runtimeInterruptIgnoredSurface.endsWith("\n") &&
      rewindCaptureFailedSurface.endsWith("\n"),
    message_mode_compact_disables_turn_diagnostics:
      messageModeDiagnosticPayload.compact === false,
    message_mode_verbose_keeps_turn_diagnostics:
      messageModeDiagnosticPayload.verbose === true,
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
