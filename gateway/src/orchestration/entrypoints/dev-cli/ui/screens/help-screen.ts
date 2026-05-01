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
    "  Ctrl+r              打开历史搜索并填入选中提示",
    "  Esc                 中断运行中回合 / 空闲 plan mode 下退出",
    "  Ctrl+c              立即退出交互循环",
  ];
  return [
    "交互命令（常用）:",
    ...primary,
    "",
    "快捷键:",
    ...keyboard,
    "",
    "运维工具:",
    ...utility,
    "",
    "兼容说明:",
    ...compatibility,
    "",
  ].join("\n");
}
