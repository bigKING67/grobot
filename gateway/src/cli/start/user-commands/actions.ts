import {
  USER_COMMAND_DEFAULT_PROMPT,
  USER_COMMAND_SCHEMA_VERSION,
  type CreateRunStartUserCommandsRuntimeInput,
  type UserCommandStore,
} from "./contract";
import { normalizeAndValidateCommandName, nowIsoUtc } from "./parse";
import { buildCommandsSurface, formatCommandDetails } from "./render";

export interface UserCommandActions {
  printUsage(): void;
  resolveManagedCommandName(nameRaw: string): string | undefined;
  createCommand(nameRaw: string, promptRaw: string): void;
  setCommandPrompt(nameRaw: string, promptRaw: string): void;
  toggleCommandEnabled(nameRaw: string, enabled: boolean): void;
  showCommand(nameRaw: string): void;
  deleteCommand(nameRaw: string): void;
}

export function createUserCommandActions(input: {
  store: UserCommandStore;
  runtimeInput: CreateRunStartUserCommandsRuntimeInput;
  formatList: () => string;
}): UserCommandActions {
  const { store, runtimeInput } = input;

  const printUsage = (): void => {
    runtimeInput.writeStdout(input.formatList());
  };

  const resolveManagedCommandName = (nameRaw: string): string | undefined => {
    const normalized = normalizeAndValidateCommandName(nameRaw);
    if (!normalized.ok) {
      runtimeInput.writeStdout(buildCommandsSurface({
        title: "命令名不可用",
        details: [normalized.error],
      }));
      return undefined;
    }
    return normalized.name;
  };

  const createCommand = (nameRaw: string, promptRaw: string): void => {
    const normalized = normalizeAndValidateCommandName(nameRaw);
    if (!normalized.ok) {
      runtimeInput.writeStdout(buildCommandsSurface({
        title: "命令名不可用",
        details: [normalized.error],
      }));
      return;
    }
    const name = normalized.name;
    if (store.readCommandByName(name)) {
      runtimeInput.writeStdout(buildCommandsSurface({
        title: "自定义命令已存在",
        details: [`/${name}`],
      }));
      return;
    }
    const now = nowIsoUtc();
    const prompt = promptRaw.trim().length > 0 ? promptRaw.trim() : USER_COMMAND_DEFAULT_PROMPT;
    store.writeCommand({
      schema_version: USER_COMMAND_SCHEMA_VERSION,
      name,
      description: "",
      prompt,
      enabled: true,
      created_at: now,
      updated_at: now,
      path: store.commandFilePath(name),
    });
    runtimeInput.writeStdout(
      buildCommandsSurface({
        title: "已创建自定义命令",
        details: [
          `命令: /${name}`,
          `文件: ${store.commandFilePath(name)}`,
          `下一步: /commands set ${name} <prompt> 或直接编辑该文件`,
        ],
      }),
    );
  };

  const setCommandPrompt = (nameRaw: string, promptRaw: string): void => {
    const name = resolveManagedCommandName(nameRaw);
    if (!name) {
      return;
    }
    const record = store.readCommandByName(name);
    if (!record) {
      runtimeInput.writeStdout(buildCommandsSurface({
        title: "未找到自定义命令",
        details: [`/${name}`],
      }));
      return;
    }
    const prompt = promptRaw.trim();
    if (!prompt) {
      runtimeInput.writeStdout(buildCommandsSurface({
        title: "prompt 不能为空",
        details: [`使用: /commands set ${name} <prompt>`],
      }));
      return;
    }
    store.writeCommand({
      ...record,
      prompt,
      updated_at: nowIsoUtc(),
    });
    runtimeInput.writeStdout(buildCommandsSurface({
      title: "已更新自定义命令",
      details: [`/${name} 的 prompt 已更新。`],
    }));
  };

  const toggleCommandEnabled = (nameRaw: string, enabled: boolean): void => {
    const name = resolveManagedCommandName(nameRaw);
    if (!name) {
      return;
    }
    const record = store.readCommandByName(name);
    if (!record) {
      runtimeInput.writeStdout(buildCommandsSurface({
        title: "未找到自定义命令",
        details: [`/${name}`],
      }));
      return;
    }
    store.writeCommand({
      ...record,
      enabled,
      updated_at: nowIsoUtc(),
    });
    runtimeInput.writeStdout(buildCommandsSurface({
      title: `已${enabled ? "启用" : "停用"}自定义命令`,
      details: [`/${name}`],
    }));
  };

  const showCommand = (nameRaw: string): void => {
    const name = resolveManagedCommandName(nameRaw);
    if (!name) {
      return;
    }
    const record = store.readCommandByName(name);
    if (!record) {
      runtimeInput.writeStdout(buildCommandsSurface({
        title: "未找到自定义命令",
        details: [`/${name}`],
      }));
      return;
    }
    runtimeInput.writeStdout(formatCommandDetails(record));
  };

  const deleteCommand = (nameRaw: string): void => {
    const name = resolveManagedCommandName(nameRaw);
    if (!name) {
      return;
    }
    if (!store.deleteCommandFile(name)) {
      runtimeInput.writeStdout(buildCommandsSurface({
        title: "未找到自定义命令",
        details: [`/${name}`],
      }));
      return;
    }
    runtimeInput.writeStdout(buildCommandsSurface({
      title: "已删除自定义命令",
      details: [`/${name}`],
    }));
  };

  return {
    printUsage,
    resolveManagedCommandName,
    createCommand,
    setCommandPrompt,
    toggleCommandEnabled,
    showCommand,
    deleteCommand,
  };
}
