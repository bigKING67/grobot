import {
  runTerminalLinePrompt,
} from "../../tui/components/prompt-input/controller";
import { runTerminalSelectMenu } from "../../tui/components/select-menu/controller";
import { buildCommandsSurface } from "./render";
import { type UserCommandActions } from "./actions";

async function readMenuTextInput(
  input: {
    writeStdout(message: string): void;
    runLinePrompt: typeof runTerminalLinePrompt;
  },
  withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  prompt: string,
  options?: { optional?: boolean },
): Promise<string | undefined> {
  const result = await withInputPaused(() =>
    input.runLinePrompt({ prompt }),
  );
  if (result.kind === "cancelled") {
    return undefined;
  }
  const value = result.value.trim();
  if (!options?.optional && value.length === 0) {
    input.writeStdout(buildCommandsSurface({
      title: "输入为空，已取消操作",
    }));
    return undefined;
  }
  return value;
}

export async function openUserCommandsManagementMenu(input: {
  actions: UserCommandActions;
  writeStdout(message: string): void;
  runLinePrompt: typeof runTerminalLinePrompt;
  runSelectMenu: typeof runTerminalSelectMenu;
  withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>;
}): Promise<void> {
  if (!process.stdin.isTTY) {
    input.actions.printUsage();
    return;
  }
  const menu = await input.withInputPaused(() =>
    input.runSelectMenu({
      title: "命令管理",
      subtitle: "管理 ~/.grobot/commands",
      hint: "↑/↓ 选择 · Enter 确认 · Esc 返回",
      items: [
        {
          id: "list",
          label: "列出命令",
          description: "显示所有用户自定义命令。",
        },
        {
          id: "new",
          label: "创建命令",
          description: "创建 /<name>，可附带提示词模板。",
        },
        {
          id: "set",
          label: "更新模板",
          description: "更新已有命令的提示词模板。",
        },
        {
          id: "show",
          label: "查看详情",
          description: "查看命令状态、位置和模板摘要。",
        },
        {
          id: "enable",
          label: "启用命令",
          description: "允许在 slash 输入中调用该命令。",
        },
        {
          id: "disable",
          label: "停用命令",
          description: "保留命令文件，但阻止调用。",
        },
        {
          id: "delete",
          label: "删除命令",
          description: "删除命令 json 文件。",
        },
      ],
    }),
  );
  if (menu.kind === "cancelled") {
    return;
  }
  if (menu.item.id === "list") {
    input.actions.printUsage();
    return;
  }
  if (menu.item.id === "new") {
    const name = await readMenuTextInput(input, input.withInputPaused, "命令名> ");
    if (!name) {
      return;
    }
    const prompt = await readMenuTextInput(input, input.withInputPaused, "模板（可选）> ", { optional: true });
    if (typeof prompt === "undefined") {
      return;
    }
    input.actions.createCommand(name, prompt);
    return;
  }
  if (menu.item.id === "set") {
    const name = await readMenuTextInput(input, input.withInputPaused, "目标命令> ");
    if (!name) {
      return;
    }
    const prompt = await readMenuTextInput(input, input.withInputPaused, "新模板> ");
    if (!prompt) {
      return;
    }
    input.actions.setCommandPrompt(name, prompt);
    return;
  }
  if (menu.item.id === "show") {
    const name = await readMenuTextInput(input, input.withInputPaused, "目标命令> ");
    if (!name) {
      return;
    }
    input.actions.showCommand(name);
    return;
  }
  if (menu.item.id === "enable") {
    const name = await readMenuTextInput(input, input.withInputPaused, "目标命令> ");
    if (!name) {
      return;
    }
    input.actions.toggleCommandEnabled(name, true);
    return;
  }
  if (menu.item.id === "disable") {
    const name = await readMenuTextInput(input, input.withInputPaused, "目标命令> ");
    if (!name) {
      return;
    }
    input.actions.toggleCommandEnabled(name, false);
    return;
  }
  if (menu.item.id === "delete") {
    const name = await readMenuTextInput(input, input.withInputPaused, "目标命令> ");
    if (!name) {
      return;
    }
    input.actions.deleteCommand(name);
  }
}
