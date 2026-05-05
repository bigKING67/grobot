import { readFileSync } from "node:fs";
import { measureDisplayWidth } from "../../cli/tui/terminal/display-width";
import {
  buildInteractiveHelpScreen,
  buildInteractiveHelpViewModel,
  renderInteractiveHelpScreen,
} from "../../cli/tui/components/help/render";

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

function linesWithinWidth(value: string, width: number): boolean {
  return stripAnsi(value)
    .split(/\r?\n/)
    .every((line) => measureDisplayWidth(line) <= width);
}

const interactive = buildInteractiveHelpScreen({
  terminalColumns: 96,
  interactiveMode: true,
});
const plain = stripAnsi(interactive);
const regularViewModel = buildInteractiveHelpViewModel({
  terminalColumns: 96,
  interactiveMode: false,
});
const regular = renderInteractiveHelpScreen(regularViewModel, {
  terminalColumns: 96,
  interactiveMode: false,
});
const regularPlain = stripAnsi(regular);
const narrowViewModel = buildInteractiveHelpViewModel({
  terminalColumns: 52,
  interactiveMode: false,
});
const narrow = renderInteractiveHelpScreen(narrowViewModel, {
  terminalColumns: 52,
  interactiveMode: false,
});
const renderSource = readFileSync(
  "gateway/src/cli/tui/components/help/render.ts",
  "utf8",
);

const payload = {
  has_reference_header: plain.includes("Help"),
  has_reference_intro: plain.includes("Grobot 在终端里处理项目上下文"),
  has_shortcuts_section: plain.includes("快捷键"),
  has_ctrl_r: plain.includes("Ctrl+R") && plain.includes("历史搜索"),
  has_esc: plain.includes("Esc") && plain.includes("计划空闲时退出"),
  has_commands_section: plain.includes("命令"),
  has_sessions_command: plain.includes("• /sessions"),
  has_resume_command: plain.includes("• /resume [query]"),
  has_rewind_command: plain.includes("• /rewind [query]"),
  has_model_command: plain.includes("• /model"),
  has_plan_command: plain.includes("• /plan"),
  has_status_command: plain.includes("• /status"),
  has_help_command: plain.includes("Help"),
  has_exit_command: plain.includes("• /exit、/quit"),
  avoids_pipe_alias_rows: !plain.includes("/exit | /quit"),
  has_commands_browse_hint:
    plain.includes("• /commands") && plain.includes("浏览全部命令"),
  has_utilities_section: plain.includes("状态与工具"),
  has_health_command: plain.includes("• /health"),
  has_context_command: plain.includes("• /context"),
  has_memory_command: plain.includes("• /memory"),
  has_skills_command: plain.includes("• /skills"),
  has_mcp_command: plain.includes("• /mcp"),
  has_utilities_status_hint: plain.includes("查看状态栏与运行状态"),
  health_copy_is_human:
    plain.includes("/health")
    && plain.includes("查看模型通道状态")
    && !plain.includes("查看 provider 健康状态")
    && !plain.includes("provider failover")
    && !plain.includes("circuit 状态"),
  help_copy_hides_english_operator_terms:
    !plain.includes("plan mode")
    && !plain.includes("provider")
    && !plain.includes("server 状态")
    && !plain.includes("查看已配置 skills")
    && !plain.includes("根据需求创建 skill")
    && !plain.includes("config provider.model"),
  has_notes_section: plain.includes("说明"),
  has_compatibility_note: plain.includes("兼容入口: /switch、/continue"),
  has_checkpoint_alias_note: plain.includes("别名: /checkpoint -> /rewind"),
  uses_compact_notes: (plain.match(/^\s*⎿ /gm)?.length ?? 0) === 2,
  avoids_document_style_notes:
    !plain.includes("交互模式优先使用")
    && !plain.includes("/plan 仅支持")
    && !plain.includes("非交互脚本按需保留"),
  uses_compact_overview_descriptions:
    plain.includes("/resume [query] 恢复历史会话")
    && plain.includes("/rewind [query] 回退到检查点")
    && plain.includes("/model          切换模型")
    && plain.includes("/plan           进入或查看计划模式"),
  avoids_long_registry_descriptions:
    !plain.includes("打开完整恢复选择器")
    && !plain.includes("快速查询")
    && !plain.includes("summary|updated-at"),
  uses_reference_bullets: plain.includes("• /sessions") && plain.includes("  ⎿"),
  uses_reference_overview_instead_of_full_command_dump:
    (plain.match(/^  • /gm)?.length ?? 0) <= 16,
  avoids_legacy_headers:
    !plain.includes("交互命令（常用）:")
    && !plain.includes("运维工具:")
    && !plain.includes("兼容说明:")
    && !plain.includes("快捷键:"),
  avoids_machine_prefix:
    !plain.includes("[help]")
    && !plain.includes("command=")
    && !plain.includes("section="),
  interactive_has_ansi: /\u001B\[[0-9;]*m/.test(interactive),
  regular_lines_within_width: linesWithinWidth(regular, 96),
  regular_uses_terminal_width_budget:
    regularPlain.split(/\r?\n/).some((line) => measureDisplayWidth(line) >= 80),
  regular_avoids_help_over_truncation:
    !regularPlain.includes("Grobot understands project contex...")
    && !regularPlain.includes("/sessions for session actions · /...")
    && !regularPlain.includes("..."),
  narrow_lines_within_width: linesWithinWidth(narrow, 52),
  ends_with_spacing: interactive.endsWith("\n\n"),
  render_keeps_terminal_width_explicit:
    !renderSource.includes("process.stdout")
    && renderSource.includes("DEFAULT_HELP_COLUMNS")
    && renderSource.includes("options.terminalColumns ?? viewModel.terminalColumns"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
