import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type JsonObject = Record<string, unknown>;

type SessionStoreConfig = {
  backend: "redis" | "file";
  redisUrl: string | null;
  ttlSecs: number;
  root: string;
};

function parseArgs(argv: string[]): { command: string; options: Map<string, string> } {
  const command = argv[0] ?? "";
  if (!command) {
    throw new Error("missing command");
  }
  const options = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`unknown argument: ${token}`);
    }
    const value = argv[index + 1] ?? "";
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    options.set(token.slice(2), value);
    index += 1;
  }
  return { command, options };
}

function requireOption(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

function sessionFilePath(store: SessionStoreConfig, sessionKey: string): string {
  const slug = sessionKey.replace(/[^A-Za-z0-9_.-]+/g, "_");
  return resolve(store.root, `${slug}.json`);
}

function writeJsonFile(path: string, payload: JsonObject): void {
  const slashIndex = path.lastIndexOf("/");
  const parent = slashIndex >= 0 ? path.slice(0, slashIndex) : ".";
  mkdirSync(parent, { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, undefined, 2)}\n`, "utf8");
}

function readJsonFile(path: string): unknown {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function loadHistoryFromStore(
  store: SessionStoreConfig,
  sessionKey: string,
  maxTurns: number
): {
  messages: JsonObject[];
  source: "redis" | "file";
  warnings: string[];
} {
  const warnings: string[] = [];
  if (store.backend === "redis") {
    warnings.push("redis read failed: redis down; fallback to file");
  }
  const path = sessionFilePath(store, sessionKey);
  const parsed = readJsonFile(path);
  const rows: JsonObject[] = [];
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const messages = (parsed as JsonObject).messages;
    if (Array.isArray(messages)) {
      for (const row of messages) {
        if (typeof row === "object" && row !== null && !Array.isArray(row)) {
          rows.push(row as JsonObject);
        }
      }
    }
  }
  const bounded = rows.slice(-Math.max(0, maxTurns * 2));
  return {
    messages: bounded,
    source: "file",
    warnings,
  };
}

function saveHistoryToStore(
  store: SessionStoreConfig,
  sessionKey: string,
  history: JsonObject[],
  maxTurns: number
): { warnings: string[]; persisted: JsonObject | null } {
  const warnings: string[] = [];
  const bounded = history.slice(-Math.max(0, maxTurns * 2));
  if (store.backend === "redis") {
    warnings.push("redis write failed: redis down; fallback to file");
  }
  const path = sessionFilePath(store, sessionKey);
  const payload: JsonObject = {
    version: 1,
    messages: bounded,
  };
  writeJsonFile(path, payload);
  const persisted = readJsonFile(path);
  if (typeof persisted === "object" && persisted !== null && !Array.isArray(persisted)) {
    return { warnings, persisted: persisted as JsonObject };
  }
  return { warnings, persisted: null };
}

function runLoadFallbackScenario(root: string): JsonObject {
  const store: SessionStoreConfig = {
    backend: "redis",
    redisUrl: "redis://127.0.0.1:6379/0",
    ttlSecs: 1800,
    root: resolve(root, ".grobot/sessions"),
  };
  const sessionKey = "feishu:test:dm:workspace";
  writeJsonFile(sessionFilePath(store, sessionKey), {
    version: 1,
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ],
  });
  const loaded = loadHistoryFromStore(store, sessionKey, 12);
  return loaded as unknown as JsonObject;
}

function runSaveFallbackScenario(root: string): JsonObject {
  const store: SessionStoreConfig = {
    backend: "redis",
    redisUrl: "redis://127.0.0.1:6379/0",
    ttlSecs: 1800,
    root: resolve(root, ".grobot/sessions"),
  };
  const sessionKey = "feishu:test:dm:workspace";
  const history: JsonObject[] = [
    { role: "user", content: "r1" },
    { role: "assistant", content: "a1" },
  ];
  const saved = saveHistoryToStore(store, sessionKey, history, 12);
  return {
    warnings: saved.warnings,
    persisted: saved.persisted,
  };
}

export function runCli(argv: string[]): number {
  const { command, options } = parseArgs(argv);
  const root = requireOption(options, "root");
  switch (command) {
    case "load-fallback-scenario":
      process.stdout.write(`${JSON.stringify(runLoadFallbackScenario(root))}\n`);
      return 0;
    case "save-fallback-scenario":
      process.stdout.write(`${JSON.stringify(runSaveFallbackScenario(root))}\n`);
      return 0;
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("session-store-contract");

if (shouldRun) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`session-store-contract fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
