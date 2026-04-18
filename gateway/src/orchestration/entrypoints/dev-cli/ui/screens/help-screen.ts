export function buildInteractiveHelpScreen(): string {
  return [
    "Interactive commands:",
    "  /sessions            Open session picker (title + summary)",
    "  /new                 Create and switch to a new session",
    "  /switch [id]         Switch active session (no id => open picker)",
    "  /continue [id]       Inject summary bridge (no id => open picker)",
    "  /health              Show provider failover and circuit status",
    "  /model               Open interactive model picker (session-scoped)",
    "  /model current       Show current provider/model",
    "  /model list          List selectable models from upstream",
    "  /model use <id>      Switch model for current session",
    "  /model reset         Reset model override for current session",
    "  /plan <goal>         Enter plan mode and create plan artifact",
    "  /plan status         Show active plan status",
    "  /plan apply [extra]  Review, approve, then execute active plan",
    "  /plan cancel         Cancel plan mode and discard active plan",
    "  /interrupt           Interrupt current running turn (CLI also supports Esc)",
    "  /handoff             Write HANDOFF.md",
    "  /exit                Exit interactive mode",
    "",
  ].join("\n");
}
