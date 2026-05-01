import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { removeTrailingSlashes } from "../services/runtime-paths";
import {
  runTerminalLinePrompt,
  runTerminalSelectMenu,
} from "./run-start-io";
import { TURN_INTERRUPTED_EXIT_CODE } from "./run-start-turn";
import { terminalStyle } from "../ui/theme/terminal-style";

const USER_COMMAND_SCHEMA_VERSION = 1;
const USER_COMMAND_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const USER_COMMAND_DEFAULT_PROMPT =
  "请在这里编写命令提示词。可使用 {{args}} 占位符接收调用参数。";

const RESERVED_SLASH_COMMAND_NAMES = new Set<string>([
  "commands",
  "skill-creator",
  "create",
  "new",
  "help",
  "exit",
  "quit",
  "sessions",
  "switch",
  "resume",
  "rewind",
  "checkpoint",
  "continue",
  "health",
  "init",
  "context",
  "memory",
  "skills",
  "mcp",
  "model",
  "status",
  "plan",
  "interrupt",
  "handoff",
]);

interface UserCommandRecord {
  schema_version: number;
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  path: string;
}

interface UserCommandFilePayload {
  schema_version?: unknown;
  name?: unknown;
  description?: unknown;
  prompt?: unknown;
  enabled?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

interface CreateRunStartUserCommandsRuntimeInput {
  homeDir: string;
  writeStdout(message: string): void;
  runLinePrompt?: typeof runTerminalLinePrompt;
  runSelectMenu?: typeof runTerminalSelectMenu;
  executeTurn(
    userInput: string,
    interactiveMode: boolean,
    options?: {
      writeStderr?: (message: string) => void;
    },
  ): Promise<number>;
  markFailureObserved(): void;
}

export interface RunStartUserCommandTurnOptions {
  writeStderr?: (message: string) => void;
}

export interface RunStartUserCommandsRuntime {
  handleManagementCommand(userInput: string): Promise<void>;
  openManagementMenu(
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<void>;
  tryRunUserCommand(
    userInput: string,
    options?: RunStartUserCommandTurnOptions,
  ): Promise<boolean>;
}

export interface RunStartUserCommandSuggestion {
  command: string;
  description: string;
  enabled: boolean;
}

type NormalizedCommandNameResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

function nowIsoUtc(): string {
  return new Date().toISOString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCommandName(raw: string): string {
  return raw.trim().toLowerCase();
}

function validateCommandName(nameRaw: string): string | undefined {
  const name = normalizeCommandName(nameRaw);
  if (!USER_COMMAND_NAME_PATTERN.test(name)) {
    return "命令名不合法。仅允许 [a-z][a-z0-9_-]，长度 1-32。";
  }
  if (RESERVED_SLASH_COMMAND_NAMES.has(name)) {
    return `命令名 \`/${name}\` 与内置命令冲突，不能用于用户自定义命令。`;
  }
  return undefined;
}

function normalizeAndValidateCommandName(nameRaw: string): NormalizedCommandNameResult {
  const name = normalizeCommandName(nameRaw);
  const error = validateCommandName(name);
  if (error) {
    return { ok: false, error };
  }
  return { ok: true, name };
}

function buildCommandsSurface(input: {
  title: string;
  details?: readonly string[];
}): string {
  const lines = [`${terminalStyle.accent("●")} ${input.title}`];
  for (const detail of input.details ?? []) {
    if (detail.length === 0) {
      lines.push("");
    } else {
      lines.push(`  ${terminalStyle.muted(detail)}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildCommandsUsageSurface(usage: string): string {
  return buildCommandsSurface({
    title: "用法不完整",
    details: [`用法: ${usage}`],
  });
}

function parseUserCommandPayload(
  filePath: string,
  rawPayload: unknown,
): UserCommandRecord | undefined {
  if (!isObject(rawPayload)) {
    return undefined;
  }
  const payload = rawPayload as UserCommandFilePayload;
  const schemaVersionRaw = payload.schema_version;
  const schemaVersion = typeof schemaVersionRaw === "number" && Number.isFinite(schemaVersionRaw)
    ? Math.floor(schemaVersionRaw)
    : USER_COMMAND_SCHEMA_VERSION;

  const nameRaw = typeof payload.name === "string" ? payload.name : "";
  const normalizedName = normalizeCommandName(nameRaw);
  const nameError = validateCommandName(normalizedName);
  if (nameError) {
    return undefined;
  }

  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!prompt) {
    return undefined;
  }
  const description = typeof payload.description === "string"
    ? payload.description.trim()
    : "";
  const enabled = typeof payload.enabled === "boolean" ? payload.enabled : true;
  const createdAt = typeof payload.created_at === "string" && payload.created_at.trim().length > 0
    ? payload.created_at.trim()
    : nowIsoUtc();
  const updatedAt = typeof payload.updated_at === "string" && payload.updated_at.trim().length > 0
    ? payload.updated_at.trim()
    : createdAt;
  return {
    schema_version: schemaVersion,
    name: normalizedName,
    description,
    prompt,
    enabled,
    created_at: createdAt,
    updated_at: updatedAt,
    path: filePath,
  };
}

function formatCommandList(records: readonly UserCommandRecord[], commandsDir: string): string {
  const rows: string[] = [];
  rows.push(`${terminalStyle.accent("●")} 用户自定义命令`);
  rows.push(`  ${terminalStyle.muted(`目录: ${commandsDir}`)}`);
  rows.push(`  ${terminalStyle.muted(`总数: ${String(records.length)}`)}`);
  if (records.length === 0) {
    rows.push(`  ${terminalStyle.muted("状态: 尚未创建用户命令")}`);
    rows.push(`  ${terminalStyle.muted('使用 "/commands new <name> [prompt]" 创建。')}`);
  } else {
    for (const record of records) {
      const summary = record.description.length > 0 ? record.description : "(无描述)";
      rows.push(`  /${record.name}  ${record.enabled ? "启用" : "停用"}  ${summary}`);
    }
  }
  rows.push("");
  rows.push("入口");
  rows.push("  /commands");
  rows.push("");
  rows.push("二级动作");
  rows.push("  /commands list");
  rows.push("  /commands new <name> [prompt]");
  rows.push("  /commands set <name> <prompt>");
  rows.push("  /commands show <name>");
  rows.push("  /commands delete <name>");
  rows.push("  /commands enable <name>");
  rows.push("  /commands disable <name>");
  rows.push("");
  return `${rows.join("\n")}\n`;
}

function splitFirstToken(input: string): {
  head: string;
  tail: string;
} {
  const normalized = input.trim();
  if (!normalized) {
    return { head: "", tail: "" };
  }
  const firstSpace = normalized.indexOf(" ");
  if (firstSpace < 0) {
    return { head: normalized, tail: "" };
  }
  return {
    head: normalized.slice(0, firstSpace).trim(),
    tail: normalized.slice(firstSpace + 1).trim(),
  };
}

function pathDirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) {
    return slashIndex === 0 ? "/" : ".";
  }
  return normalized.slice(0, slashIndex);
}

function parseSlashInvocation(userInput: string): {
  name: string;
  args: string;
} | undefined {
  const trimmed = userInput.trim();
  if (!trimmed.startsWith("/")) {
    return undefined;
  }
  const body = trimmed.slice(1).trim();
  if (!body) {
    return undefined;
  }
  const firstSpace = body.indexOf(" ");
  const commandNameRaw = firstSpace < 0 ? body : body.slice(0, firstSpace);
  const args = firstSpace < 0 ? "" : body.slice(firstSpace + 1).trim();
  const name = normalizeCommandName(commandNameRaw);
  if (!name) {
    return undefined;
  }
  return { name, args };
}

function normalizeCommandsAliasInput(userInput: string): string | undefined {
  const trimmed = userInput.trim();
  if (/^\/commands(?:\s|$)/i.test(trimmed)) {
    return trimmed;
  }
  if (/^\/(?:create|new)\s+commands(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^\/(?:create|new)\s+commands/i, "").trim();
    return rest.length > 0 ? `/commands ${rest}` : "/commands";
  }
  if (/^\/(?:create|new)\s+command(?:\s|$)/i.test(trimmed)) {
    const rest = trimmed.replace(/^\/(?:create|new)\s+command/i, "").trim();
    return rest.length > 0 ? `/commands new ${rest}` : "/commands new";
  }
  return undefined;
}

function applyCommandPromptTemplate(prompt: string, args: string): string {
  if (prompt.includes("{{args}}")) {
    return prompt.split("{{args}}").join(args);
  }
  if (!args) {
    return prompt;
  }
  return `${prompt}\n\n${args}`;
}

function resolveCommandsDir(homeDir: string): string {
  return `${removeTrailingSlashes(homeDir)}/commands`;
}

function listUserCommandRecords(commandsDir: string): UserCommandRecord[] {
  mkdirSync(commandsDir, { recursive: true });
  let entries: string[] = [];
  try {
    entries = readdirSync(commandsDir);
  } catch {
    return [];
  }
  const records: UserCommandRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const filePath = `${commandsDir}/${entry}`;
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      const normalized = parseUserCommandPayload(filePath, raw);
      if (normalized) {
        records.push(normalized);
      }
    } catch {
      // ignore malformed files to keep command runtime resilient
    }
  }
  records.sort((left, right) => left.name.localeCompare(right.name));
  return records;
}

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
  const commandsDir = resolveCommandsDir(input.homeDir);
  const runLinePrompt = input.runLinePrompt ?? runTerminalLinePrompt;
  const runSelectMenu = input.runSelectMenu ?? runTerminalSelectMenu;

  const ensureCommandsDir = (): void => {
    mkdirSync(commandsDir, { recursive: true });
  };

  const commandFilePath = (name: string): string =>
    `${commandsDir}/${name}.json`;

  const readCommandByName = (nameRaw: string): UserCommandRecord | undefined => {
    const normalized = normalizeAndValidateCommandName(nameRaw);
    if (!normalized.ok) {
      return undefined;
    }
    const filePath = commandFilePath(normalized.name);
    if (!existsSync(filePath)) {
      return undefined;
    }
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      const record = parseUserCommandPayload(filePath, raw);
      if (!record || record.name !== normalized.name) {
        return undefined;
      }
      return record;
    } catch {
      return undefined;
    }
  };

  const listCommands = (): UserCommandRecord[] => {
    ensureCommandsDir();
    return listUserCommandRecords(commandsDir);
  };

  const writeCommand = (record: UserCommandRecord): void => {
    ensureCommandsDir();
    const payload = {
      schema_version: USER_COMMAND_SCHEMA_VERSION,
      name: record.name,
      description: record.description,
      prompt: record.prompt,
      enabled: record.enabled,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
    const path = commandFilePath(record.name);
    mkdirSync(pathDirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(payload, undefined, 2)}\n`, "utf8");
  };

  const printUsage = (): void => {
    input.writeStdout(formatCommandList(listCommands(), commandsDir));
  };

  const resolveManagedCommandName = (nameRaw: string): string | undefined => {
    const normalized = normalizeAndValidateCommandName(nameRaw);
    if (!normalized.ok) {
      input.writeStdout(buildCommandsSurface({
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
      input.writeStdout(buildCommandsSurface({
        title: "命令名不可用",
        details: [normalized.error],
      }));
      return;
    }
    const name = normalized.name;
    if (readCommandByName(name)) {
      input.writeStdout(buildCommandsSurface({
        title: "自定义命令已存在",
        details: [`/${name}`],
      }));
      return;
    }
    const now = nowIsoUtc();
    const prompt = promptRaw.trim().length > 0 ? promptRaw.trim() : USER_COMMAND_DEFAULT_PROMPT;
    writeCommand({
      schema_version: USER_COMMAND_SCHEMA_VERSION,
      name,
      description: "",
      prompt,
      enabled: true,
      created_at: now,
      updated_at: now,
      path: commandFilePath(name),
    });
    input.writeStdout(
      buildCommandsSurface({
        title: "已创建自定义命令",
        details: [
          `命令: /${name}`,
          `文件: ${commandFilePath(name)}`,
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
    const record = readCommandByName(name);
    if (!record) {
      input.writeStdout(buildCommandsSurface({
        title: "未找到自定义命令",
        details: [`/${name}`],
      }));
      return;
    }
    const prompt = promptRaw.trim();
    if (!prompt) {
      input.writeStdout(buildCommandsSurface({
        title: "prompt 不能为空",
        details: [`使用: /commands set ${name} <prompt>`],
      }));
      return;
    }
    writeCommand({
      ...record,
      prompt,
      updated_at: nowIsoUtc(),
    });
    input.writeStdout(buildCommandsSurface({
      title: "已更新自定义命令",
      details: [`/${name} 的 prompt 已更新。`],
    }));
  };

  const toggleCommandEnabled = (nameRaw: string, enabled: boolean): void => {
    const name = resolveManagedCommandName(nameRaw);
    if (!name) {
      return;
    }
    const record = readCommandByName(name);
    if (!record) {
      input.writeStdout(buildCommandsSurface({
        title: "未找到自定义命令",
        details: [`/${name}`],
      }));
      return;
    }
    writeCommand({
      ...record,
      enabled,
      updated_at: nowIsoUtc(),
    });
    input.writeStdout(buildCommandsSurface({
      title: `已${enabled ? "启用" : "停用"}自定义命令`,
      details: [`/${name}`],
    }));
  };

  const showCommand = (nameRaw: string): void => {
    const name = resolveManagedCommandName(nameRaw);
    if (!name) {
      return;
    }
    const record = readCommandByName(name);
    if (!record) {
      input.writeStdout(buildCommandsSurface({
        title: "未找到自定义命令",
        details: [`/${name}`],
      }));
      return;
    }
    const rows = [
      `${terminalStyle.accent("●")} /${record.name}`,
      `  ${terminalStyle.muted(`状态: ${record.enabled ? "启用" : "停用"}`)}`,
      `  ${terminalStyle.muted(`文件: ${record.path}`)}`,
      `  ${terminalStyle.muted(`描述: ${record.description || "(无描述)"}`)}`,
      "  prompt:",
      record.prompt,
      "",
    ];
    input.writeStdout(`${rows.join("\n")}\n`);
  };

  const deleteCommand = (nameRaw: string): void => {
    const name = resolveManagedCommandName(nameRaw);
    if (!name) {
      return;
    }
    const filePath = commandFilePath(name);
    if (!existsSync(filePath)) {
      input.writeStdout(buildCommandsSurface({
        title: "未找到自定义命令",
        details: [`/${name}`],
      }));
      return;
    }
    rmSync(filePath, { force: true });
    input.writeStdout(buildCommandsSurface({
      title: "已删除自定义命令",
      details: [`/${name}`],
    }));
  };

  const readMenuTextInput = async (
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
    prompt: string,
    options?: { optional?: boolean },
  ): Promise<string | undefined> => {
    const result = await withInputPaused(() =>
      runLinePrompt({ prompt }),
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
  };

  const openManagementMenu = async (
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
  ): Promise<void> => {
    if (!process.stdin.isTTY) {
      printUsage();
      return;
    }
    const menu = await withInputPaused(() =>
      runSelectMenu({
        title: "命令管理",
        subtitle: "管理 ~/.grobot/commands",
        hint: "↑/↓ 选择 · Enter 确认 · Esc 返回",
        items: [
          {
            id: "list",
            label: "列出命令",
            description: "显示所有用户自定义命令和用法。",
          },
          {
            id: "new",
            label: "创建命令",
            description: "创建 /<name>，可附带 prompt 模板。",
          },
          {
            id: "set",
            label: "更新 prompt",
            description: "更新已有命令的 prompt。",
          },
          {
            id: "show",
            label: "查看详情",
            description: "输出命令元数据和 prompt 内容。",
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
      printUsage();
      return;
    }
    if (menu.item.id === "new") {
      const name = await readMenuTextInput(
        withInputPaused,
        "命令名> ",
      );
      if (!name) {
        return;
      }
      const prompt = await readMenuTextInput(
        withInputPaused,
        "prompt（可选）> ",
        { optional: true },
      );
      if (typeof prompt === "undefined") {
        return;
      }
      createCommand(name, prompt);
      return;
    }
    if (menu.item.id === "set") {
      const name = await readMenuTextInput(
        withInputPaused,
        "目标命令> ",
      );
      if (!name) {
        return;
      }
      const prompt = await readMenuTextInput(
        withInputPaused,
        "新 prompt> ",
      );
      if (!prompt) {
        return;
      }
      setCommandPrompt(name, prompt);
      return;
    }
    if (menu.item.id === "show") {
      const name = await readMenuTextInput(
        withInputPaused,
        "目标命令> ",
      );
      if (!name) {
        return;
      }
      showCommand(name);
      return;
    }
    if (menu.item.id === "enable") {
      const name = await readMenuTextInput(
        withInputPaused,
        "目标命令> ",
      );
      if (!name) {
        return;
      }
      toggleCommandEnabled(name, true);
      return;
    }
    if (menu.item.id === "disable") {
      const name = await readMenuTextInput(
        withInputPaused,
        "目标命令> ",
      );
      if (!name) {
        return;
      }
      toggleCommandEnabled(name, false);
      return;
    }
    if (menu.item.id === "delete") {
      const name = await readMenuTextInput(
        withInputPaused,
        "目标命令> ",
      );
      if (!name) {
        return;
      }
      deleteCommand(name);
      return;
    }
  };

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
        printUsage();
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
        createCommand(parts.head, parts.tail);
        return;
      }
      if (action === "set") {
        const parts = splitFirstToken(tail);
        if (!parts.head || !parts.tail) {
          input.writeStdout(buildCommandsUsageSurface("/commands set <name> <prompt>"));
          return;
        }
        setCommandPrompt(parts.head, parts.tail);
        return;
      }
      if (action === "show") {
        const name = tail.trim();
        if (!name) {
          input.writeStdout(buildCommandsUsageSurface("/commands show <name>"));
          return;
        }
        showCommand(name);
        return;
      }
      if (action === "delete") {
        const name = tail.trim();
        if (!name) {
          input.writeStdout(buildCommandsUsageSurface("/commands delete <name>"));
          return;
        }
        deleteCommand(name);
        return;
      }
      if (action === "enable") {
        const name = tail.trim();
        if (!name) {
          input.writeStdout(buildCommandsUsageSurface("/commands enable <name>"));
          return;
        }
        toggleCommandEnabled(name, true);
        return;
      }
      if (action === "disable") {
        const name = tail.trim();
        if (!name) {
          input.writeStdout(buildCommandsUsageSurface("/commands disable <name>"));
          return;
        }
        toggleCommandEnabled(name, false);
        return;
      }
      input.writeStdout(buildCommandsSurface({
        title: "不支持的命令动作",
        details: [`动作: ${action}`, '使用 "/commands help" 查看可用动作。'],
      }));
    },
    openManagementMenu,
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
      const record = readCommandByName(normalized.name);
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
