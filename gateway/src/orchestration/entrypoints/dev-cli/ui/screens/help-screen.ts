import {
  listPrimarySlashCommandHelpLines,
  listSlashCommandCompatibilityNotes,
  listUtilitySlashCommandHelpLines,
} from "../../commands/slash/registry";

export function buildInteractiveHelpScreen(): string {
  const primary = listPrimarySlashCommandHelpLines();
  const utility = listUtilitySlashCommandHelpLines();
  const compatibility = listSlashCommandCompatibilityNotes();
  const keyboard = [
    "  Ctrl+r              Open history search and fill selected prompt",
    "  Esc                 Interrupt running turn / exit plan mode when idle",
    "  Ctrl+c              Exit interactive loop immediately",
  ];
  return [
    "Interactive commands (primary):",
    ...primary,
    "",
    "Keyboard shortcuts:",
    ...keyboard,
    "",
    "Operational utilities:",
    ...utility,
    "",
    "Compatibility notes:",
    ...compatibility,
    "",
  ].join("\n");
}
