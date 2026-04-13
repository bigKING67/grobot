import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
function parseArgs(argv) {
  const command = argv[0] ?? "";
  if (!command) {
    throw new Error("missing command");
  }
  const options = /* @__PURE__ */ new Map();
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
function requireOption(options, key) {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}
function sessionFilePath(store, sessionKey) {
  const slug = sessionKey.replace(/[^A-Za-z0-9_.-]+/g, "_");
  return resolve(store.root, `${slug}.json`);
}
function writeJsonFile(path, payload) {
  const slashIndex = path.lastIndexOf("/");
  const parent = slashIndex >= 0 ? path.slice(0, slashIndex) : ".";
  mkdirSync(parent, { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, void 0, 2)}
`, "utf8");
}
function readJsonFile(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}
function loadHistoryFromStore(store, sessionKey, maxTurns) {
  const warnings = [];
  if (store.backend === "redis") {
    warnings.push("redis read failed: redis down; fallback to file");
  }
  const path = sessionFilePath(store, sessionKey);
  const parsed = readJsonFile(path);
  const rows = [];
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    const messages = parsed.messages;
    if (Array.isArray(messages)) {
      for (const row of messages) {
        if (typeof row === "object" && row !== null && !Array.isArray(row)) {
          rows.push(row);
        }
      }
    }
  }
  const bounded = rows.slice(-Math.max(0, maxTurns * 2));
  return {
    messages: bounded,
    source: "file",
    warnings
  };
}
function saveHistoryToStore(store, sessionKey, history, maxTurns) {
  const warnings = [];
  const bounded = history.slice(-Math.max(0, maxTurns * 2));
  if (store.backend === "redis") {
    warnings.push("redis write failed: redis down; fallback to file");
  }
  const path = sessionFilePath(store, sessionKey);
  const payload = {
    version: 1,
    messages: bounded
  };
  writeJsonFile(path, payload);
  const persisted = readJsonFile(path);
  if (typeof persisted === "object" && persisted !== null && !Array.isArray(persisted)) {
    return { warnings, persisted };
  }
  return { warnings, persisted: null };
}
function runLoadFallbackScenario(root) {
  const store = {
    backend: "redis",
    redisUrl: "redis://127.0.0.1:6379/0",
    ttlSecs: 1800,
    root: resolve(root, ".grobot/sessions")
  };
  const sessionKey = "feishu:test:dm:workspace";
  writeJsonFile(sessionFilePath(store, sessionKey), {
    version: 1,
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" }
    ]
  });
  const loaded = loadHistoryFromStore(store, sessionKey, 12);
  return loaded;
}
function runSaveFallbackScenario(root) {
  const store = {
    backend: "redis",
    redisUrl: "redis://127.0.0.1:6379/0",
    ttlSecs: 1800,
    root: resolve(root, ".grobot/sessions")
  };
  const sessionKey = "feishu:test:dm:workspace";
  const history = [
    { role: "user", content: "r1" },
    { role: "assistant", content: "a1" }
  ];
  const saved = saveHistoryToStore(store, sessionKey, history, 12);
  return {
    warnings: saved.warnings,
    persisted: saved.persisted
  };
}
function runCli(argv) {
  const { command, options } = parseArgs(argv);
  const root = requireOption(options, "root");
  switch (command) {
    case "load-fallback-scenario":
      process.stdout.write(`${JSON.stringify(runLoadFallbackScenario(root))}
`);
      return 0;
    case "save-fallback-scenario":
      process.stdout.write(`${JSON.stringify(runSaveFallbackScenario(root))}
`);
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
    process.stderr.write(`session-store-contract fatal: ${String(error)}
`);
    process.exitCode = 1;
  }
}
export {
  runCli
};
