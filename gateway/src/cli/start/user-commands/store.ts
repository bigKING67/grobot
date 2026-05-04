import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { removeTrailingSlashes } from "../../services/runtime-paths";
import {
  USER_COMMAND_SCHEMA_VERSION,
  type UserCommandFilePayload,
  type UserCommandRecord,
  type UserCommandStore,
} from "./contract";
import { isObject, normalizeAndValidateCommandName, normalizeCommandName, nowIsoUtc, validateCommandName } from "./parse";

function pathDirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex <= 0) {
    return slashIndex === 0 ? "/" : ".";
  }
  return normalized.slice(0, slashIndex);
}

export function resolveCommandsDir(homeDir: string): string {
  return `${removeTrailingSlashes(homeDir)}/commands`;
}

export function parseUserCommandPayload(
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

export function listUserCommandRecords(commandsDir: string): UserCommandRecord[] {
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
      // Keep command listing resilient when a user manually edits a JSON file incorrectly.
    }
  }
  records.sort((left, right) => left.name.localeCompare(right.name));
  return records;
}

export function createUserCommandStore(homeDir: string): UserCommandStore {
  const commandsDir = resolveCommandsDir(homeDir);

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

  const deleteCommandFile = (name: string): boolean => {
    const filePath = commandFilePath(name);
    if (!existsSync(filePath)) {
      return false;
    }
    rmSync(filePath, { force: true });
    return true;
  };

  return {
    commandsDir,
    commandFilePath,
    ensureCommandsDir,
    readCommandByName,
    listCommands,
    writeCommand,
    deleteCommandFile,
  };
}
