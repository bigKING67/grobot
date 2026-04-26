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
tracker.consumeStderrChunk("[runtime-route] event=decision provider=alpha\n");
const routeSnapshot = tracker.readPromptActivitySnapshot();
tracker.markTurnFinished("ok");
const okSnapshot = tracker.readPromptActivitySnapshot();

tracker.markTurnStart();
tracker.markTurnFinished("error");
const errorSnapshot = tracker.readPromptActivitySnapshot();

const payload = {
  start_snapshot_visible: startSnapshot?.text === "已接收任务，正在执行",
  route_diagnostic_visible: routeSnapshot?.text === "正在选择可用路由",
  ok_finish_clears_prompt_activity:
    typeof okSnapshot === "undefined"
    && !emittedLines.some((line) => line.includes("执行完成，等待下一条输入")),
  error_finish_remains_visible: errorSnapshot?.text === "执行失败，请查看错误输出",
  no_done_footer_noise:
    !emittedLines.join("").includes("执行完成，等待下一条输入"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
