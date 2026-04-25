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
  rows.push("[commands] 用户自定义命令（主入口）");
  rows.push(`- directory: ${commandsDir}`);
  rows.push(`- total: ${String(records.length)}`);
  if (records.length === 0) {
    rows.push("- empty: 尚未创建用户命令");
  } else {
    for (const record of records) {
      const summary = record.description.length > 0 ? record.description : "(无描述)";
      rows.push(`- /${record.name} [${record.enabled ? "enabled" : "disabled"}] ${summary}`);
    }
  }
  rows.push("");
  rows.push("入口：");
  rows.push("- /commands");
  rows.push("");
  rows.push("二级动作（兼容命令）：");
  rows.push("- /commands list");
  rows.push("- /commands new <name> [prompt]");
  rows.push("- /commands set <name> <prompt>");
  rows.push("- /commands show <name>");
  rows.push("- /commands delete <name>");
  rows.push("- /commands enable <name>");
  rows.push("- /commands disable <name>");
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
      description: record.description.trim() || "User-defined command",
      enabled: record.enabled,
    });
  }
  return suggestions;
}

export function createRunStartUserCommandsRuntime(
  input: CreateRunStartUserCommandsRuntimeInput,
): RunStartUserCommandsRuntime {
  const commandsDir = resolveCommandsDir(input.homeDir);

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
      input.writeStdout(`[commands] ${normalized.error}\n\n`);
      return undefined;
    }
    return normalized.name;
  };

  const createCommand = (nameRaw: string, promptRaw: string): void => {
    const normalized = normalizeAndValidateCommandName(nameRaw);
    if (!normalized.ok) {
      input.writeStdout(`[commands] ${normalized.error}\n\n`);
      return;
    }
    const name = normalized.name;
    if (readCommandByName(name)) {
      input.writeStdout(`[commands] \`/${name}\` 已存在。\n\n`);
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
      `[commands] 已创建 \`/${name}\`。\n`
      + `- file: ${commandFilePath(name)}\n`
      + `- next: /commands set ${name} <prompt> 或直接编辑该文件\n\n`,
    );
  };

  const setCommandPrompt = (nameRaw: string, promptRaw: string): void => {
    const name = resolveManagedCommandName(nameRaw);
    if (!name) {
      return;
    }
    const record = readCommandByName(name);
    if (!record) {
      input.writeStdout(`[commands] 未找到 \`/${name}\`。\n\n`);
      return;
    }
    const prompt = promptRaw.trim();
    if (!prompt) {
      input.writeStdout("[commands] prompt 不能为空。\n\n");
      return;
    }
    writeCommand({
      ...record,
      prompt,
      updated_at: nowIsoUtc(),
    });
    input.writeStdout(`[commands] 已更新 \`/${name}\` 的 prompt。\n\n`);
  };

  const toggleCommandEnabled = (nameRaw: string, enabled: boolean): void => {
    const name = resolveManagedCommandName(nameRaw);
    if (!name) {
      return;
    }
    const record = readCommandByName(name);
    if (!record) {
      input.writeStdout(`[commands] 未找到 \`/${name}\`。\n\n`);
      return;
    }
    writeCommand({
      ...record,
      enabled,
      updated_at: nowIsoUtc(),
    });
    input.writeStdout(`[commands] \`/${name}\` 已${enabled ? "启用" : "禁用"}。\n\n`);
  };

  const showCommand = (nameRaw: string): void => {
    const name = resolveManagedCommandName(nameRaw);
    if (!name) {
      return;
    }
    const record = readCommandByName(name);
    if (!record) {
      input.writeStdout(`[commands] 未找到 \`/${name}\`。\n\n`);
      return;
    }
    const rows = [
      `[commands] /${record.name}`,
      `- enabled: ${record.enabled ? "true" : "false"}`,
      `- file: ${record.path}`,
      `- description: ${record.description || "(无描述)"}`,
      "- prompt:",
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
      input.writeStdout(`[commands] 未找到 \`/${name}\`。\n\n`);
      return;
    }
    rmSync(filePath, { force: true });
    input.writeStdout(`[commands] 已删除 \`/${name}\`。\n\n`);
  };

  const readMenuTextInput = async (
    withInputPaused: <T>(operation: () => Promise<T>) => Promise<T>,
    prompt: string,
    options?: { optional?: boolean },
  ): Promise<string | undefined> => {
    const result = await withInputPaused(() =>
      runTerminalLinePrompt({ prompt }),
    );
    if (result.kind === "cancelled") {
      input.writeStdout("[commands] input cancelled.\n\n");
      return undefined;
    }
    const value = result.value.trim();
    if (!options?.optional && value.length === 0) {
      input.writeStdout("[commands] input is empty, operation cancelled.\n\n");
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
      runTerminalSelectMenu({
        title: "Commands Manager",
        subtitle: "Manage ~/.grobot/commands",
        hint: "Use ↑/↓ (or j/k, Ctrl+n/p), number to select directly, Enter/Space to confirm, Esc to cancel.",
        items: [
          {
            id: "list",
            label: "List commands",
            description: "Show all user-defined commands and usage.",
          },
          {
            id: "new",
            label: "Create command",
            description: "Create /<name> with optional prompt template.",
          },
          {
            id: "set",
            label: "Update prompt",
            description: "Update an existing command prompt.",
          },
          {
            id: "show",
            label: "Show details",
            description: "Print command metadata and prompt content.",
          },
          {
            id: "enable",
            label: "Enable command",
            description: "Allow command invocation in slash input.",
          },
          {
            id: "disable",
            label: "Disable command",
            description: "Keep command file but block invocation.",
          },
          {
            id: "delete",
            label: "Delete command",
            description: "Remove command json file.",
          },
        ],
      }),
    );
    if (menu.kind === "cancelled") {
      input.writeStdout("[commands] menu cancelled.\n\n");
      return;
    }
    if (menu.item.id === "list") {
      printUsage();
      return;
    }
    if (menu.item.id === "new") {
      const name = await readMenuTextInput(
        withInputPaused,
        "[commands] name> ",
      );
      if (!name) {
        return;
      }
      const prompt = await readMenuTextInput(
        withInputPaused,
        "[commands] prompt (optional)> ",
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
        "[commands] target name> ",
      );
      if (!name) {
        return;
      }
      const prompt = await readMenuTextInput(
        withInputPaused,
        "[commands] new prompt> ",
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
        "[commands] target name> ",
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
        "[commands] target name> ",
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
        "[commands] target name> ",
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
        "[commands] target name> ",
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
        input.writeStdout("[commands] invalid command entry.\n\n");
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
          input.writeStdout("[commands] usage: /commands new <name> [prompt]\n\n");
          return;
        }
        createCommand(parts.head, parts.tail);
        return;
      }
      if (action === "set") {
        const parts = splitFirstToken(tail);
        if (!parts.head || !parts.tail) {
          input.writeStdout("[commands] usage: /commands set <name> <prompt>\n\n");
          return;
        }
        setCommandPrompt(parts.head, parts.tail);
        return;
      }
      if (action === "show") {
        const name = tail.trim();
        if (!name) {
          input.writeStdout("[commands] usage: /commands show <name>\n\n");
          return;
        }
        showCommand(name);
        return;
      }
      if (action === "delete") {
        const name = tail.trim();
        if (!name) {
          input.writeStdout("[commands] usage: /commands delete <name>\n\n");
          return;
        }
        deleteCommand(name);
        return;
      }
      if (action === "enable") {
        const name = tail.trim();
        if (!name) {
          input.writeStdout("[commands] usage: /commands enable <name>\n\n");
          return;
        }
        toggleCommandEnabled(name, true);
        return;
      }
      if (action === "disable") {
        const name = tail.trim();
        if (!name) {
          input.writeStdout("[commands] usage: /commands disable <name>\n\n");
          return;
        }
        toggleCommandEnabled(name, false);
        return;
      }
      input.writeStdout(`[commands] unsupported action: ${action}\n\n`);
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
        input.writeStdout(`[commands] \`/${record.name}\` 当前已禁用。使用 /commands enable ${record.name} 启用。\n\n`);
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
