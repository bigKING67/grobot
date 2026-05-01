import {
  renderManagementInterruptNotice,
  renderRuntimeFailureSummary,
  renderTurnInterruptedNotice,
} from "../../orchestration/entrypoints/dev-cli/ui/screens/turn-screen";

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

const managementInteractive = renderManagementInterruptNotice(true);
const managementNonInteractive = renderManagementInterruptNotice(false);
const turnInterruptedInteractive = renderTurnInterruptedNotice(true);
const turnInterruptedNonInteractive = renderTurnInterruptedNotice(false);
const failureSummary = renderRuntimeFailureSummary({
  failures: [
    {
      providerName: "alpha",
      errorClass: "upstream_timeout",
      errorMessage: "timeout",
    },
    {
      providerName: "beta",
      errorClass: "runtime_error",
      errorMessage: "server failed",
    },
  ],
  orderedProviders: [
    { name: "alpha" },
    { name: "beta" },
    { name: "gamma" },
  ],
});

const payload = {
  management_interactive_matches: managementInteractive === "会话被 management API 中断。当前输入已跳过。\n\n",
  management_non_interactive_matches: managementNonInteractive === "会话被 management API 中断。当前请求已跳过。\n",
  turn_interrupted_interactive_matches:
    stripAnsi(turnInterruptedInteractive) === "● 回合已中断\n  可以继续输入新指令。\n\n",
  turn_interrupted_non_interactive_matches:
    stripAnsi(turnInterruptedNonInteractive) === "● 回合已中断\n",
  turn_interrupted_avoids_machine_prefix:
    !turnInterruptedInteractive.includes("[interrupt]")
    && !turnInterruptedNonInteractive.includes("[interrupt]"),
  failure_summary_has_route_line: failureSummary.includes("[runtime-route] failed attempts=2 providers=alpha -> beta -> gamma errors=alpha:upstream_timeout, beta:runtime_error"),
  failure_summary_has_last_error_line: failureSummary.includes("runtime failed: provider=beta server failed"),
  failure_summary_ends_with_newline: failureSummary.endsWith("\n"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
