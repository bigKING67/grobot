import {
  listPrimarySlashCommandHelpLines,
  listSlashCommandCompatibilityNotes,
  listUtilitySlashCommandHelpLines,
} from "../../commands/slash/registry";

export function buildInteractiveHelpScreen(): string {
  const primary = listPrimarySlashCommandHelpLines();
  const utility = listUtilitySlashCommandHelpLines();
  const compatibility = listSlashCommandCompatibilityNotes();
  return [
    "Interactive commands (primary):",
    ...primary,
    "",
    "Operational utilities:",
    ...utility,
    "",
    "Compatibility notes:",
    ...compatibility,
    "",
  ].join("\n");
}
