import {
  renderManagementInterruptNotice,
  renderRuntimeFailureSummary,
  renderRuntimeOpenCircuitNotice,
  renderTurnInterruptedNotice,
} from "../../cli/tui/components/turn-notice/render";

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

const managementInteractive = renderManagementInterruptNotice(true);
const managementNonInteractive = renderManagementInterruptNotice(false);
const turnInterruptedInteractive = renderTurnInterruptedNotice(true);
const turnInterruptedNonInteractive = renderTurnInterruptedNotice(false);
const openCircuitInteractive = renderRuntimeOpenCircuitNotice(true);
const openCircuitNonInteractive = renderRuntimeOpenCircuitNotice(false);
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
const longFailureSummary = renderRuntimeFailureSummary({
  failures: [
    {
      providerName: "alpha",
      errorClass: "upstream_connect_failed",
      errorMessage: [
        "\u001b[31mRuntimeRpcError: runtime rpc error -32001: runtime turn execution failed (class=upstream_connect_failed)\u001b[0m",
        "caused by connection refused",
        "socket closed before handshake",
        "extra diagnostic line",
      ].join("\n"),
    },
  ],
  orderedProviders: [
    { name: "alpha" },
  ],
  terminalColumns: 86,
});

const payload = {
  management_interactive_matches:
    stripAnsi(managementInteractive) === "Session interrupted · Manager skipped the current input\n\n",
  management_non_interactive_matches:
    stripAnsi(managementNonInteractive) === "Session interrupted · Manager skipped the current request\n",
  management_hides_raw_api_label:
    !stripAnsi(managementInteractive).includes("management API")
    && !stripAnsi(managementNonInteractive).includes("management API"),
  turn_interrupted_interactive_matches:
    stripAnsi(turnInterruptedInteractive) === "Turn interrupted · You can enter a new instruction.\n\n",
  turn_interrupted_non_interactive_matches:
    stripAnsi(turnInterruptedNonInteractive) === "Turn interrupted\n",
  turn_interrupted_avoids_machine_prefix:
    !turnInterruptedInteractive.includes("[interrupt]")
    && !turnInterruptedNonInteractive.includes("[interrupt]"),
  open_circuit_interactive_is_human_surface:
    stripAnsi(openCircuitInteractive) === "All model providers unavailable · Retry later, or use /model to switch models\n\n",
  open_circuit_non_interactive_is_human_surface:
    stripAnsi(openCircuitNonInteractive) === "All model providers unavailable · Switch models before retrying\n",
  open_circuit_avoids_machine_prefix:
    !openCircuitInteractive.includes("[runtime-route]")
    && !openCircuitNonInteractive.includes("[runtime-route]")
    && !openCircuitInteractive.includes("provider=")
    && !openCircuitNonInteractive.includes("provider="),
  failure_summary_is_human_surface:
    stripAnsi(failureSummary).includes("Turn failed · beta · Runtime error")
    && stripAnsi(failureSummary).includes("⎿  Attempt order alpha -> beta -> gamma")
    && stripAnsi(failureSummary).includes("⎿  Failed providers alpha · Request timed out, beta · Runtime error"),
  failure_summary_has_last_error_detail:
    stripAnsi(failureSummary).includes("⎿  Last error Server failed"),
  failure_summary_uses_reference_detail_glyph:
    stripAnsi(failureSummary).includes("  ⎿  Last error")
    && stripAnsi(failureSummary).includes("  ⎿  Attempt order")
    && !stripAnsi(failureSummary).includes("  已尝试:"),
  failure_summary_hides_raw_error_classes:
    !stripAnsi(failureSummary).includes("runtime_error")
    && !stripAnsi(failureSummary).includes("upstream_timeout")
    && !stripAnsi(longFailureSummary).includes("upstream_connect_failed"),
  failure_summary_avoids_machine_prefix:
    !failureSummary.includes("[runtime-route]")
    && !failureSummary.includes("runtime failed:")
    && !failureSummary.includes("provider="),
  turn_notices_use_compact_reference_style:
    !stripAnsi(turnInterruptedInteractive).includes("●")
    && !stripAnsi(openCircuitInteractive).includes("No model provider can be tried")
    && stripAnsi(failureSummary).split("\n").filter(Boolean).length <= 4,
  failure_summary_truncates_long_errors:
    stripAnsi(longFailureSummary).includes("Upstream connection failed")
    && stripAnsi(longFailureSummary).includes("... 2 more lines")
    && !stripAnsi(longFailureSummary).includes("extra diagnostic line"),
  failure_summary_strips_ansi:
    !longFailureSummary.includes("\u001b[31m")
    && !longFailureSummary.includes("\u001b[0mRuntimeRpcError"),
  failure_summary_ends_with_newline: failureSummary.endsWith("\n"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
