import {
  runTerminalLinePrompt,
} from "../../tui/components/prompt-input/controller";
import { runTerminalSelectMenu } from "../../tui/components/select-menu/controller";

export const USER_COMMAND_SCHEMA_VERSION = 1;
export const USER_COMMAND_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
export const USER_COMMAND_DEFAULT_PROMPT =
  "请在这里编写命令提示词。可使用 {{args}} 占位符接收调用参数。";

export const RESERVED_SLASH_COMMAND_NAMES = new Set<string>([
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

export interface UserCommandRecord {
  schema_version: number;
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  path: string;
}

export interface UserCommandFilePayload {
  schema_version?: unknown;
  name?: unknown;
  description?: unknown;
  prompt?: unknown;
  enabled?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

export interface CreateRunStartUserCommandsRuntimeInput {
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

export type NormalizedCommandNameResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

export interface UserCommandStore {
  commandsDir: string;
  commandFilePath(name: string): string;
  ensureCommandsDir(): void;
  readCommandByName(nameRaw: string): UserCommandRecord | undefined;
  listCommands(): UserCommandRecord[];
  writeCommand(record: UserCommandRecord): void;
  deleteCommandFile(name: string): boolean;
}
