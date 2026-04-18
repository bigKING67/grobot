import {
  renderManagementInterruptNotice,
  renderRuntimeFailureSummary,
  renderTurnInterruptedNotice,
} from "../../orchestration/entrypoints/dev-cli/ui/screens/turn-screen";

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
  management_interactive_matches: managementInteractive === "Session interrupted by management API. Current input skipped.\n\n",
  management_non_interactive_matches: managementNonInteractive === "Session interrupted by management API. Current request skipped.\n",
  turn_interrupted_interactive_matches: turnInterruptedInteractive === "[interrupt] turn interrupted. You can send a new instruction.\n\n",
  turn_interrupted_non_interactive_matches: turnInterruptedNonInteractive === "[interrupt] turn interrupted.\n",
  failure_summary_has_route_line: failureSummary.includes("[runtime-route] failed attempts=2 providers=alpha -> beta -> gamma errors=alpha:upstream_timeout, beta:runtime_error"),
  failure_summary_has_last_error_line: failureSummary.includes("runtime failed: provider=beta server failed"),
  failure_summary_ends_with_newline: failureSummary.endsWith("\n"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
