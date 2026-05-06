import { createInteractiveActivityTracker } from "../../cli/tui/interactive/activity-state";
import type { RuntimeEvent } from "../../models/types";

function runtimeEvent(
  eventType: RuntimeEvent["eventType"],
  payload: Record<string, unknown>,
): RuntimeEvent {
  return {
    traceId: "trace_contract",
    turnId: "turn_contract",
    sessionKey: "feishu:contract:dm:user",
    eventType,
    payload,
    timestampIso: "unix:1",
  };
}

const emittedLines: string[] = [];
const tracker = createInteractiveActivityTracker({
  writeProgressLine: (line) => {
    emittedLines.push(line);
  },
  minEmitIntervalMs: 1,
  promptRetentionMs: 20_000,
});

tracker.markTurnStart();
const startSnapshot = tracker.readPromptActivitySnapshot();
const startFullSnapshot = tracker.readActivitySnapshot();
tracker.consumeStderrChunk("[runtime-route] event=decision provider=alpha\n");
tracker.consumeStderrChunk("[runtime-route] event=decision selected=alpha sticky_hit=true strategy=sticky+score\n");
const routeSnapshot = tracker.readPromptActivitySnapshot();
const routeFullSnapshot = tracker.readActivitySnapshot();
tracker.consumeStderrChunk("[context-engine] event=prompt_prepared stage=normal estimated_tokens=2200 target_limit=5120 selected_utilization=0.430\n");
const contextFullSnapshot = tracker.readActivitySnapshot();
tracker.consumeStderrChunk("[ask-user] event=interrupt_received\n");
const askUserFullSnapshot = tracker.readActivitySnapshot();
tracker.consumeStderrChunk("[plan-mode] event=model_planning phase=planning\n");
const planFullSnapshot = tracker.readActivitySnapshot();
tracker.consumeStderrChunk("[plan-mode] event=approval_waiting\n");
const planApprovalSnapshot = tracker.readActivitySnapshot();
tracker.consumeStderrChunk("[context-engine] event=semantic_prefetch status=applied evidence=2 duration_ms=12\n");
const semanticPrefetchSnapshot = tracker.readActivitySnapshot();
tracker.consumeStderrChunk("[context-engine] event=pre_send_plan stage=forced strategy=quality_first retry=2\n");
const preSendSnapshot = tracker.readActivitySnapshot();
tracker.consumeStderrChunk("[governance:mcp-instruction] event=prompt_injected\n");
const governanceSnapshot = tracker.readActivitySnapshot();
tracker.consumeStderrChunk("[experience-scheduler] event=task_skipped reason=pending_ask\n");
const experienceSnapshot = tracker.readActivitySnapshot();
tracker.consumeStderrChunk("[memory-orchestrator] event=context_skipped reason=budget_or_no_signal\n");
const memorySnapshot = tracker.readActivitySnapshot();
tracker.consumeStderrChunk("[interrupt] event=ignored reason=turn_completed_before_abort\n");
const interruptSnapshot = tracker.readActivitySnapshot();
tracker.observeRuntimeEvent(runtimeEvent("model_request", { provider: "kimi" }));
const runtimeModelRequestSnapshot = tracker.readActivitySnapshot();
tracker.observeRuntimeEvent(runtimeEvent("tool_start", {
  tool_name: "bash",
  tool_call_id: "call_contract",
  input_summary: {
    command_preview: "npm test -- --runInBand",
  },
}));
const runtimeToolStartSnapshot = tracker.readActivitySnapshot();
tracker.observeRuntimeEvent(runtimeEvent("tool_end", {
  tool_name: "bash",
  tool_call_id: "call_contract",
  status: "ok",
  duration_ms: 1200,
  output_summary: {
    exit_code: 1,
  },
}));
const runtimeToolEndSnapshot = tracker.readActivitySnapshot();
tracker.markTurnFinished("ok");
const okSnapshot = tracker.readPromptActivitySnapshot();

tracker.markTurnStart({ planMode: true });
const planStartSnapshot = tracker.readActivitySnapshot();
tracker.markTurnFinished("ok");

tracker.markTurnStart();
tracker.markTurnFinished("error");
const errorSnapshot = tracker.readPromptActivitySnapshot();

const payload = {
  start_snapshot_visible: startSnapshot?.text === "Reading task and preparing context",
  start_snapshot_is_runtime_activity:
    startFullSnapshot?.kind === "runtime" && startFullSnapshot.status === "running",
  route_diagnostic_visible: routeSnapshot?.text === "Choosing model route",
  route_snapshot_has_stage_detail:
    routeFullSnapshot?.kind === "route"
    && routeFullSnapshot.detail === "route alpha · reuse session provider · strategy session first + score",
  route_snapshot_avoids_raw_key_value:
    !String(routeFullSnapshot?.detail ?? "").includes("selected=")
    && !String(routeFullSnapshot?.detail ?? "").includes("sticky=hit")
    && !String(routeFullSnapshot?.detail ?? "").includes("strategy="),
  context_snapshot_has_budget_detail:
    contextFullSnapshot?.kind === "context"
    && contextFullSnapshot.detail === "stage normal · budget 2200/5120 · usage 0.430",
  context_snapshot_avoids_raw_key_value:
    !String(contextFullSnapshot?.detail ?? "").includes("stage=")
    && !String(contextFullSnapshot?.detail ?? "").includes("tokens=")
    && !String(contextFullSnapshot?.detail ?? "").includes("util="),
  ask_user_waiting_has_reply_detail:
    askUserFullSnapshot?.kind === "ask-user"
    && askUserFullSnapshot.detail === "reply in input",
  plan_diagnostic_visible:
    planFullSnapshot?.kind === "plan"
    && planFullSnapshot.text === "Grobot is planning the implementation"
    && planFullSnapshot.detail === "phase planning",
  plan_approval_waiting_has_detail:
    planApprovalSnapshot?.kind === "plan"
    && planApprovalSnapshot.text === "Waiting for plan confirmation"
    && planApprovalSnapshot.detail === "confirm execution or keep planning",
  semantic_prefetch_status_is_human:
    semanticPrefetchSnapshot?.kind === "context"
    && semanticPrefetchSnapshot.detail === "status applied",
  pre_send_detail_is_human:
    preSendSnapshot?.kind === "context"
    && preSendSnapshot.detail === "stage forced compact · strategy quality first · retry 2",
  governance_topic_is_human:
    governanceSnapshot?.kind === "governance"
    && governanceSnapshot.detail === "MCP instructions",
  experience_event_detail_is_human:
    experienceSnapshot?.kind === "memory"
    && experienceSnapshot.detail === "event task skipped",
  memory_event_detail_is_human:
    memorySnapshot?.kind === "memory"
    && memorySnapshot.detail === "event memory context skipped",
  interrupt_event_detail_is_human:
    interruptSnapshot?.kind === "runtime"
    && interruptSnapshot.detail === "event ignored",
  runtime_model_request_is_request_activity:
    runtimeModelRequestSnapshot?.kind === "runtime"
    && runtimeModelRequestSnapshot.text === "Sending model request"
    && runtimeModelRequestSnapshot.detail === "provider kimi",
  runtime_tool_start_uses_input_summary_without_raw_keys:
    runtimeToolStartSnapshot?.kind === "tool"
    && runtimeToolStartSnapshot.text === "Run $ npm test -- --runInBand"
    && !runtimeToolStartSnapshot.text.includes("input_summary")
    && !runtimeToolStartSnapshot.text.includes("command_preview"),
  runtime_tool_end_normalizes_bash_exit_code_failure:
    runtimeToolEndSnapshot?.kind === "tool"
    && runtimeToolEndSnapshot.text === "Run failed"
    && runtimeToolEndSnapshot.detail === "exit 1 · 1.2s"
    && runtimeToolEndSnapshot.status === "error",
  residual_activity_details_avoid_raw_codes:
    [
      semanticPrefetchSnapshot?.detail,
      preSendSnapshot?.detail,
      governanceSnapshot?.detail,
      experienceSnapshot?.detail,
      memorySnapshot?.detail,
      interruptSnapshot?.detail,
      runtimeModelRequestSnapshot?.detail,
      runtimeToolEndSnapshot?.detail,
    ].every((detail) =>
      !/[a-z]+(?:[_-][a-z]+)+/.test(String(detail ?? ""))
      && !String(detail ?? "").includes("=")
    ),
  plan_mode_start_uses_plan_context:
    planStartSnapshot?.kind === "plan"
    && planStartSnapshot.text === "Reading goal and preparing plan context",
  ok_finish_clears_prompt_activity:
    typeof okSnapshot === "undefined"
    && !emittedLines.some((line) => line.includes("Execution complete, waiting for next input")),
  error_finish_remains_visible: errorSnapshot?.text === "Execution failed; see error output",
  no_done_footer_noise:
    !emittedLines.join("").includes("Execution complete, waiting for next input"),
  verbose_progress_line_uses_reference_prefix:
    emittedLines.some((line) =>
      line.includes("› Choosing model route · route alpha · reuse session provider · strategy session first + score")
    ),
  verbose_progress_line_avoids_machine_prefix:
    !emittedLines.join("").includes("[process]")
    && !emittedLines.join("").includes("selected=")
    && !emittedLines.join("").includes("sticky=hit")
    && !emittedLines.join("").includes("strategy="),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
