import { usage } from "../../cli/cli-args";
import { measureDisplayWidth } from "../../cli/tui/terminal/display-width";

const output = usage();
const lines = output.split(/\r?\n/);

const payload = {
  has_reference_title: output.startsWith("Grobot\n"),
  has_local_tui_entry: output.includes("run `grobot` to enter the TUI"),
  uses_reference_command_rows:
    output.includes("  • grobot\n")
    && output.includes("    ⎿  Enter local interactive TUI"),
  has_status_summary_copy:
    output.includes("grobot status")
    && output.includes("Show actionable summary")
    && output.includes("--json for full snapshot"),
  has_session_recovery_rows:
    output.includes("grobot --resume <session-id|query>")
    && output.includes("grobot --rewind [checkpoint-id|query]"),
  has_interactive_help_hint: output.includes("Use /help inside the TUI for commands"),
  avoids_legacy_dev_cli_copy:
    !output.includes("Grobot TS dev CLI")
    && !output.includes("source-checkout fallback")
    && !output.includes("No subcommand =>")
    && !output.includes("Probe notes:")
    && !output.includes("Optional session args for start:"),
  avoids_long_option_walls:
    !output.includes("status [--project <name>]")
    && !output.includes("start [--message <text>]")
    && !output.includes("serve [--project <name>]"),
  avoids_machine_help_terms:
    !output.includes("base_url/api_key")
    && !output.includes("machine-readable")
    && !output.includes("diagnostic event logs")
    && !output.includes("context_graph_cache"),
  lines_within_reference_width: lines.every((line) => measureDisplayWidth(line) <= 112),
  ends_without_extra_blank: !output.endsWith("\n"),
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
