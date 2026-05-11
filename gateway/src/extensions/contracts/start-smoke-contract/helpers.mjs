import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stripAnsi(value) {
  return String(value).replace(/\u001B\[[0-9;]*m/g, "");
}

export function parseJsonObjectSafe(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    // ignore and try line-based fallback
  }
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (isObject(parsed)) {
        return parsed;
      }
    } catch {
      // continue probing
    }
  }
  return null;
}

export function parseArgs(argv) {
  const command = argv[0] ?? "";
  if (!command) {
    throw new Error("missing command");
  }
  const options = new Map();
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

const ANSI_ESCAPE_PATTERN = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|[@-Z\\-_])/g;
const OSC_ESCAPE_PATTERN = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]/g;

function normalizeTerminalTextForMatch(value) {
  const raw = String(value ?? "");
  return raw
    .replace(OSC_ESCAPE_PATTERN, "")
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(CONTROL_CHAR_PATTERN, "");
}

export function hasStartBannerMarker(outputText) {
  const normalized = normalizeTerminalTextForMatch(outputText);
  if (/G\s*R\s*O\s*L\s*A\s*N\s*D(?:\s*®)?/i.test(normalized)) {
    return true;
  }
  if (/Grobot\s+v\d/i.test(normalized)) {
    return true;
  }
  if (/Grobot\s+dev\b/i.test(normalized)) {
    return true;
  }
  return false;
}

export function requireOption(options, key) {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

export function runCommand(repoRoot, argv, envPrefix = null, stdinText = null) {
  const completed = spawnSync(argv[0], argv.slice(1), {
    cwd: repoRoot,
    env: envPrefix ? { ...process.env, ...envPrefix } : process.env,
    encoding: "utf8",
    input: typeof stdinText === "string" ? stdinText : undefined,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    exit_code: completed.status ?? 1,
    stdout: completed.stdout ?? "",
    stderr: completed.stderr ?? "",
  };
}

export function runShellScript(repoRoot, shellBody) {
  const shellScript = `cd ${shellEscape(repoRoot)} && ${shellBody}`;
  const completed = spawnSync("bash", ["-lc", shellScript], {
    encoding: "utf8",
  });
  return {
    exit_code: completed.status ?? 1,
    stdout: completed.stdout ?? "",
    stderr: completed.stderr ?? "",
  };
}

export function shellEscape(value) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function writeConfig(content) {
  const configDir = createTempDir("grobot-start-config");
  const configPath = `${configDir}/config.toml`;
  writeFileSync(configPath, content, "utf8");
  return { configPath };
}

export function createTempDir(prefix) {
  const random = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const dir = resolve("/tmp", `${prefix}-${random}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function sanitizeSessionKey(sessionKey) {
  return String(sessionKey).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function sanitizePlanSessionSegment(raw) {
  const normalized = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "");
  const resolved = normalized.length > 0 ? normalized : "main";
  return resolved.slice(0, 64);
}

export function readJsonFileSafe(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function readTextFileSafe(path) {
  if (!existsSync(path)) {
    return "";
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function countOccurrences(text, pattern) {
  if (!text || !pattern) {
    return 0;
  }
  let cursor = 0;
  let count = 0;
  while (cursor < text.length) {
    const nextIndex = text.indexOf(pattern, cursor);
    if (nextIndex < 0) {
      break;
    }
    count += 1;
    cursor = nextIndex + pattern.length;
  }
  return count;
}
