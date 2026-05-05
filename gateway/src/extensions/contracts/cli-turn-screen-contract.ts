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
    stripAnsi(managementInteractive) === "会话已中断 · 管理端已跳过当前输入\n\n",
  management_non_interactive_matches:
    stripAnsi(managementNonInteractive) === "会话已中断 · 管理端已跳过当前请求\n",
  management_hides_raw_api_label:
    !stripAnsi(managementInteractive).includes("management API")
    && !stripAnsi(managementNonInteractive).includes("management API"),
  turn_interrupted_interactive_matches:
    stripAnsi(turnInterruptedInteractive) === "回合已中断 · 可以继续输入新指令。\n\n",
  turn_interrupted_non_interactive_matches:
    stripAnsi(turnInterruptedNonInteractive) === "回合已中断\n",
  turn_interrupted_avoids_machine_prefix:
    !turnInterruptedInteractive.includes("[interrupt]")
    && !turnInterruptedNonInteractive.includes("[interrupt]"),
  open_circuit_interactive_is_human_surface:
    stripAnsi(openCircuitInteractive) === "所有模型通道暂不可用 · 稍后重试，或用 /model 切换模型\n\n",
  open_circuit_non_interactive_is_human_surface:
    stripAnsi(openCircuitNonInteractive) === "所有模型通道暂不可用 · 请切换模型后再执行\n",
  open_circuit_avoids_machine_prefix:
    !openCircuitInteractive.includes("[runtime-route]")
    && !openCircuitNonInteractive.includes("[runtime-route]")
    && !openCircuitInteractive.includes("provider=")
    && !openCircuitNonInteractive.includes("provider="),
  failure_summary_is_human_surface:
    stripAnsi(failureSummary).includes("回合执行失败 · beta · 运行时错误")
    && stripAnsi(failureSummary).includes("⎿  尝试顺序 alpha -> beta -> gamma")
    && stripAnsi(failureSummary).includes("⎿  失败通道 alpha · 请求超时, beta · 运行时错误"),
  failure_summary_has_last_error_detail:
    stripAnsi(failureSummary).includes("⎿  最近错误 服务执行失败"),
  failure_summary_uses_reference_detail_glyph:
    stripAnsi(failureSummary).includes("  ⎿  最近错误")
    && stripAnsi(failureSummary).includes("  ⎿  尝试顺序")
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
    && !stripAnsi(openCircuitInteractive).includes("当前没有可尝试的模型通道")
    && stripAnsi(failureSummary).split("\n").filter(Boolean).length <= 4,
  failure_summary_truncates_long_errors:
    stripAnsi(longFailureSummary).includes("上游连接失败")
    && stripAnsi(longFailureSummary).includes("… 还有 2 行")
    && !stripAnsi(longFailureSummary).includes("extra diagnostic line"),
  failure_summary_strips_ansi:
    !longFailureSummary.includes("\u001b[31m")
    && !longFailureSummary.includes("\u001b[0mRuntimeRpcError"),
  failure_summary_ends_with_newline: failureSummary.endsWith("\n"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
