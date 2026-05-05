import { createInteractiveActivityTracker } from "../../cli/tui/interactive/activity-state";

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
tracker.markTurnFinished("ok");
const okSnapshot = tracker.readPromptActivitySnapshot();

tracker.markTurnStart({ planMode: true });
const planStartSnapshot = tracker.readActivitySnapshot();
tracker.markTurnFinished("ok");

tracker.markTurnStart();
tracker.markTurnFinished("error");
const errorSnapshot = tracker.readPromptActivitySnapshot();

const payload = {
  start_snapshot_visible: startSnapshot?.text === "正在读取任务并准备上下文",
  start_snapshot_is_runtime_activity:
    startFullSnapshot?.kind === "runtime" && startFullSnapshot.status === "running",
  route_diagnostic_visible: routeSnapshot?.text === "正在选择模型路由",
  route_snapshot_has_stage_detail:
    routeFullSnapshot?.kind === "route"
    && routeFullSnapshot.detail === "路由 alpha · 复用会话通道 · 策略 会话优先 + 评分",
  route_snapshot_avoids_raw_key_value:
    !String(routeFullSnapshot?.detail ?? "").includes("selected=")
    && !String(routeFullSnapshot?.detail ?? "").includes("sticky=hit")
    && !String(routeFullSnapshot?.detail ?? "").includes("strategy="),
  context_snapshot_has_budget_detail:
    contextFullSnapshot?.kind === "context"
    && contextFullSnapshot.detail === "阶段 正常 · 预算 2200/5120 · 利用率 0.430",
  context_snapshot_avoids_raw_key_value:
    !String(contextFullSnapshot?.detail ?? "").includes("stage=")
    && !String(contextFullSnapshot?.detail ?? "").includes("tokens=")
    && !String(contextFullSnapshot?.detail ?? "").includes("util="),
  ask_user_waiting_has_reply_detail:
    askUserFullSnapshot?.kind === "ask-user"
    && askUserFullSnapshot.detail === "在输入框回复",
  plan_diagnostic_visible:
    planFullSnapshot?.kind === "plan"
    && planFullSnapshot.text === "Grobot 正在规划实现方案"
    && planFullSnapshot.detail === "阶段 规划中",
  plan_approval_waiting_has_detail:
    planApprovalSnapshot?.kind === "plan"
    && planApprovalSnapshot.text === "等待你确认计划"
    && planApprovalSnapshot.detail === "确认执行或继续规划",
  semantic_prefetch_status_is_human:
    semanticPrefetchSnapshot?.kind === "context"
    && semanticPrefetchSnapshot.detail === "状态 已应用",
  pre_send_detail_is_human:
    preSendSnapshot?.kind === "context"
    && preSendSnapshot.detail === "阶段 强制压缩 · 策略 质量优先 · 重试 2",
  governance_topic_is_human:
    governanceSnapshot?.kind === "governance"
    && governanceSnapshot.detail === "MCP 指令",
  experience_event_detail_is_human:
    experienceSnapshot?.kind === "memory"
    && experienceSnapshot.detail === "事件 跳过任务",
  memory_event_detail_is_human:
    memorySnapshot?.kind === "memory"
    && memorySnapshot.detail === "事件 跳过记忆上下文",
  interrupt_event_detail_is_human:
    interruptSnapshot?.kind === "runtime"
    && interruptSnapshot.detail === "事件 已忽略",
  residual_activity_details_avoid_raw_codes:
    [
      semanticPrefetchSnapshot?.detail,
      preSendSnapshot?.detail,
      governanceSnapshot?.detail,
      experienceSnapshot?.detail,
      memorySnapshot?.detail,
      interruptSnapshot?.detail,
    ].every((detail) =>
      !/[a-z]+(?:[_-][a-z]+)+/.test(String(detail ?? ""))
      && !String(detail ?? "").includes("=")
    ),
  plan_mode_start_uses_plan_context:
    planStartSnapshot?.kind === "plan"
    && planStartSnapshot.text === "正在读取目标并准备计划上下文",
  ok_finish_clears_prompt_activity:
    typeof okSnapshot === "undefined"
    && !emittedLines.some((line) => line.includes("执行完成，等待下一条输入")),
  error_finish_remains_visible: errorSnapshot?.text === "执行失败，请查看错误输出",
  no_done_footer_noise:
    !emittedLines.join("").includes("执行完成，等待下一条输入"),
  verbose_progress_line_uses_reference_prefix:
    emittedLines.some((line) =>
      line.includes("› 正在选择模型路由 · 路由 alpha · 复用会话通道 · 策略 会话优先 + 评分")
    ),
  verbose_progress_line_avoids_machine_prefix:
    !emittedLines.join("").includes("[process]")
    && !emittedLines.join("").includes("selected=")
    && !emittedLines.join("").includes("sticky=hit")
    && !emittedLines.join("").includes("strategy="),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
