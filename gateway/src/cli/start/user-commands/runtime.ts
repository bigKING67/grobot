import {
  runTerminalLinePrompt,
} from "../../tui/components/prompt-input/controller";
import { runTerminalSelectMenu } from "../../tui/components/select-menu/controller";
import { TURN_INTERRUPTED_EXIT_CODE } from "../turn";
import { createUserCommandActions } from "./actions";
import {
  type CreateRunStartUserCommandsRuntimeInput,
  type RunStartUserCommandSuggestion,
  type RunStartUserCommandTurnOptions,
  type RunStartUserCommandsRuntime,
} from "./contract";
import { openUserCommandsManagementMenu } from "./menu";
import {
  applyCommandPromptTemplate,
  normalizeAndValidateCommandName,
  normalizeCommandsAliasInput,
  parseSlashInvocation,
  splitFirstToken,
} from "./parse";
import { buildCommandsSurface, buildCommandsUsageSurface, formatCommandList } from "./render";
import { createUserCommandStore, listUserCommandRecords, resolveCommandsDir } from "./store";

export function listRunStartUserCommandSuggestions(homeDir: string): RunStartUserCommandSuggestion[] {
  const commandsDir = resolveCommandsDir(homeDir);
  const records = listUserCommandRecords(commandsDir);
  const suggestions: RunStartUserCommandSuggestion[] = [];
  for (const record of records) {
    suggestions.push({
      command: `/${record.name}`,
      description: record.description.trim() || "用户自定义命令",
      enabled: record.enabled,
    });
  }
  return suggestions;
}

export function createRunStartUserCommandsRuntime(
  input: CreateRunStartUserCommandsRuntimeInput,
): RunStartUserCommandsRuntime {
  const store = createUserCommandStore(input.homeDir);
  const runLinePrompt = input.runLinePrompt ?? runTerminalLinePrompt;
  const runSelectMenu = input.runSelectMenu ?? runTerminalSelectMenu;
  const formatList = (): string => formatCommandList(store.listCommands(), store.commandsDir);
  const actions = createUserCommandActions({
    store,
    runtimeInput: input,
    formatList,
  });

  return {
    handleManagementCommand: async (userInput: string): Promise<void> => {
      const normalizedInput = normalizeCommandsAliasInput(userInput);
      if (!normalizedInput) {
        input.writeStdout(buildCommandsSurface({
          title: "无效命令入口",
          details: ['使用 "/commands" 打开命令管理。'],
        }));
        return;
      }
      const rest = normalizedInput.replace(/^\/commands/i, "").trim();
      if (!rest || rest === "list" || rest === "help") {
        actions.printUsage();
        return;
      }
      const { head, tail } = splitFirstToken(rest);
      const action = head.toLowerCase();
      if (action === "new") {
        const parts = splitFirstToken(tail);
        if (!parts.head) {
          input.writeStdout(buildCommandsUsageSurface("/commands new <name> [prompt]"));
          return;
        }
        actions.createCommand(parts.head, parts.tail);
        return;
      }
      if (action === "set") {
        const parts = splitFirstToken(tail);
        if (!parts.head || !parts.tail) {
          input.writeStdout(buildCommandsUsageSurface("/commands set <name> <prompt>"));
          return;
        }
        actions.setCommandPrompt(parts.head, parts.tail);
        return;
      }
      if (action === "show") {
        const name = tail.trim();
        if (!name) {
          input.writeStdout(buildCommandsUsageSurface("/commands show <name>"));
          return;
        }
        actions.showCommand(name);
        return;
      }
      if (action === "delete") {
        const name = tail.trim();
        if (!name) {
          input.writeStdout(buildCommandsUsageSurface("/commands delete <name>"));
          return;
        }
        actions.deleteCommand(name);
        return;
      }
      if (action === "enable") {
        const name = tail.trim();
        if (!name) {
          input.writeStdout(buildCommandsUsageSurface("/commands enable <name>"));
          return;
        }
        actions.toggleCommandEnabled(name, true);
        return;
      }
      if (action === "disable") {
        const name = tail.trim();
        if (!name) {
          input.writeStdout(buildCommandsUsageSurface("/commands disable <name>"));
          return;
        }
        actions.toggleCommandEnabled(name, false);
        return;
      }
      input.writeStdout(buildCommandsSurface({
        title: "不支持的命令动作",
        details: [`动作: ${action}`, '使用 "/commands help" 查看可用动作。'],
      }));
    },
    openManagementMenu: async (
      withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
    ): Promise<void> => {
      await openUserCommandsManagementMenu({
        actions,
        writeStdout: input.writeStdout,
        runLinePrompt,
        runSelectMenu,
        withInputPaused,
      });
    },
    tryRunUserCommand: async (
      userInput: string,
      options?: RunStartUserCommandTurnOptions,
    ): Promise<boolean> => {
      const invocation = parseSlashInvocation(userInput);
      if (!invocation) {
        return false;
      }
      const normalized = normalizeAndValidateCommandName(invocation.name);
      if (!normalized.ok) {
        return false;
      }
      const record = store.readCommandByName(normalized.name);
      if (!record) {
        return false;
      }
      if (!record.enabled) {
        input.writeStdout(buildCommandsSurface({
          title: "自定义命令已停用",
          details: [
            `/${record.name} 当前不可调用。`,
            `使用: /commands enable ${record.name}`,
          ],
        }));
        return true;
      }
      const prompt = applyCommandPromptTemplate(record.prompt, invocation.args);
      const code = await input.executeTurn(prompt, true, {
        writeStderr: options?.writeStderr,
      });
      if (code !== 0 && code !== TURN_INTERRUPTED_EXIT_CODE) {
        input.markFailureObserved();
      }
      return true;
    },
  };
}
