import { listSlashCommandHelpLines } from "../../commands/slash/registry";

export function buildInteractiveHelpScreen(): string {
  return [
    "Interactive commands:",
    ...listSlashCommandHelpLines(),
    "",
  ].join("\n");
}
