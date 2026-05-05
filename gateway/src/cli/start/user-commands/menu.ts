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
      title: "Empty input; action cancelled",
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
      title: "Command manager",
      subtitle: "Manage ~/.grobot/commands",
      hint: "↑/↓ select · Enter confirm · Esc back",
      items: [
        {
          id: "list",
          label: "List commands",
          description: "Show all user commands.",
        },
        {
          id: "new",
          label: "Create command",
          description: "Create /<name>, optionally with a prompt template.",
        },
        {
          id: "set",
          label: "Update template",
          description: "Update an existing command prompt template.",
        },
        {
          id: "show",
          label: "Show details",
          description: "Show command status, path, and template summary.",
        },
        {
          id: "enable",
          label: "Enable command",
          description: "Allow this command in slash input.",
        },
        {
          id: "disable",
          label: "Disable command",
          description: "Keep the command file but block invocation.",
        },
        {
          id: "delete",
          label: "Delete command",
          description: "Delete the command JSON file.",
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
    const name = await readMenuTextInput(input, input.withInputPaused, "Command name> ");
    if (!name) {
      return;
    }
    const prompt = await readMenuTextInput(input, input.withInputPaused, "Template (optional)> ", { optional: true });
    if (typeof prompt === "undefined") {
      return;
    }
    input.actions.createCommand(name, prompt);
    return;
  }
  if (menu.item.id === "set") {
    const name = await readMenuTextInput(input, input.withInputPaused, "Target command> ");
    if (!name) {
      return;
    }
    const prompt = await readMenuTextInput(input, input.withInputPaused, "New template> ");
    if (!prompt) {
      return;
    }
    input.actions.setCommandPrompt(name, prompt);
    return;
  }
  if (menu.item.id === "show") {
    const name = await readMenuTextInput(input, input.withInputPaused, "Target command> ");
    if (!name) {
      return;
    }
    input.actions.showCommand(name);
    return;
  }
  if (menu.item.id === "enable") {
    const name = await readMenuTextInput(input, input.withInputPaused, "Target command> ");
    if (!name) {
      return;
    }
    input.actions.toggleCommandEnabled(name, true);
    return;
  }
  if (menu.item.id === "disable") {
    const name = await readMenuTextInput(input, input.withInputPaused, "Target command> ");
    if (!name) {
      return;
    }
    input.actions.toggleCommandEnabled(name, false);
    return;
  }
  if (menu.item.id === "delete") {
    const name = await readMenuTextInput(input, input.withInputPaused, "Target command> ");
    if (!name) {
      return;
    }
    input.actions.deleteCommand(name);
  }
}
