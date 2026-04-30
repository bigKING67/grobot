import { createInteractiveActivityTracker } from "../../orchestration/entrypoints/dev-cli/ui/interactive/activity-state";

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
    && routeFullSnapshot.detail === "selected=alpha · sticky=hit · strategy=sticky+score",
  context_snapshot_has_budget_detail:
    contextFullSnapshot?.kind === "context"
    && contextFullSnapshot.detail === "stage=normal · tokens=2200/5120 · util=0.430",
  ask_user_waiting_has_reply_detail:
    askUserFullSnapshot?.kind === "ask-user"
    && askUserFullSnapshot.detail === "reply in prompt",
  plan_diagnostic_visible:
    planFullSnapshot?.kind === "plan"
    && planFullSnapshot.text === "Grobot 正在规划实现方案"
    && planFullSnapshot.detail === "phase=planning",
  plan_approval_waiting_has_detail:
    planApprovalSnapshot?.kind === "plan"
    && planApprovalSnapshot.text === "等待你确认计划"
    && planApprovalSnapshot.detail === "approve or keep planning",
  plan_mode_start_uses_plan_context:
    planStartSnapshot?.kind === "plan"
    && planStartSnapshot.text === "正在读取目标并准备计划上下文",
  ok_finish_clears_prompt_activity:
    typeof okSnapshot === "undefined"
    && !emittedLines.some((line) => line.includes("执行完成，等待下一条输入")),
  error_finish_remains_visible: errorSnapshot?.text === "执行失败，请查看错误输出",
  no_done_footer_noise:
    !emittedLines.join("").includes("执行完成，等待下一条输入"),
  verbose_progress_line_includes_detail:
    emittedLines.some((line) =>
      line.includes("[process] 正在选择模型路由 · selected=alpha · sticky=hit · strategy=sticky+score")
    ),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
