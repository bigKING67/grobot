import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const MCP_SCOPE_PROJECT_FIRST = "project_first";
const MCP_SCOPE_PROJECT_ONLY = "project_only";
const MCP_SCOPE_GLOBAL_ONLY = "global_only";

type McpInstructionScope =
  | typeof MCP_SCOPE_PROJECT_FIRST
  | typeof MCP_SCOPE_PROJECT_ONLY
  | typeof MCP_SCOPE_GLOBAL_ONLY;

interface McpInstructionSettings {
  enabled: boolean;
  strict: boolean;
  scope: McpInstructionScope;
}

interface McpServerEntry {
  name: string;
  enabled: boolean;
}

interface McpRulePack {
  serverName: string;
  source: "project" | "global";
  path: string;
  content: string;
}

export interface McpInstructionRuntime {
  promptPrefix: string;
  loadedServerNames: string[];
  events: string[];
  strictFailure?: string;
}

interface ResolveMcpInstructionRuntimeInput {
  homeDir: string;
  workDir: string;
  projectTomlPath?: string;
}

const MCP_RULE_MAX_CHARS_PER_SERVER = 1_200;
const MCP_RULE_MAX_TOTAL_CHARS = 3_200;
const MCP_RULE_BLOCKLIST_SNIPPETS = [
  "must ultra thinking",
  "four or more ````markdown wrappers",
];

function stripInlineComment(line: string): string {
  let inQuote = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inQuote = !inQuote;
      continue;
    }
    if (char === "#" && !inQuote) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseTomlString(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = trimmed.match(/^"([^"]*)"/);
  if (!match || typeof match[1] !== "string") {
    return undefined;
  }
  return match[1].trim();
}

function parseTomlBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}

function fileReadable(path: string): boolean {
  try {
    const text = readFileSync(path, "utf8");
    return text.length >= 0;
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function parentPath(path: string): string {
  return resolve(path, "..");
}

function findProjectGrobotDir(workDir: string): string | undefined {
  let cursor = resolve(workDir);
  while (true) {
    const candidate = resolve(cursor, ".grobot");
    if (isDirectory(candidate)) {
      return candidate;
    }
    const next = parentPath(cursor);
    if (next === cursor) {
      return undefined;
    }
    cursor = next;
  }
}

function resolveProjectGrobotDir(workDir: string, projectTomlPath?: string): string | undefined {
  if (projectTomlPath) {
    const normalized = resolve(projectTomlPath);
    if (normalized.endsWith("/.grobot/project.toml")) {
      const candidate = normalized.slice(0, normalized.length - "/project.toml".length);
      if (isDirectory(candidate)) {
        return candidate;
      }
    }
  }
  return findProjectGrobotDir(workDir);
}

function normalizeMcpScope(raw: string | undefined): McpInstructionScope | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === MCP_SCOPE_PROJECT_FIRST ||
    normalized === MCP_SCOPE_PROJECT_ONLY ||
    normalized === MCP_SCOPE_GLOBAL_ONLY
  ) {
    return normalized;
  }
  return undefined;
}

function readMcpInstructionSettings(projectTomlPath?: string): McpInstructionSettings {
  const defaults: McpInstructionSettings = {
    enabled: true,
    strict: false,
    scope: MCP_SCOPE_PROJECT_FIRST,
  };
  if (!projectTomlPath || !fileReadable(projectTomlPath)) {
    return defaults;
  }
  let raw = "";
  try {
    raw = readFileSync(projectTomlPath, "utf8");
  } catch {
    return defaults;
  }
  const lines = raw.split(/\r?\n/);
  let inTargetSection = false;
  let enabled = defaults.enabled;
  let strict = defaults.strict;
  let scope = defaults.scope;
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      inTargetSection = sectionMatch[1] === "mcp.instructions";
      continue;
    }
    if (!inTargetSection) {
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      continue;
    }
    const key = kvMatch[1];
    const value = kvMatch[2];
    if (key === "enabled") {
      enabled = parseTomlBoolean(value) ?? enabled;
      continue;
    }
    if (key === "strict") {
      strict = parseTomlBoolean(value) ?? strict;
      continue;
    }
    if (key === "scope") {
      scope = normalizeMcpScope(parseTomlString(value)) ?? scope;
    }
  }
  return { enabled, strict, scope };
}

function parseMcpServerEntries(registryPath: string): McpServerEntry[] {
  if (!fileReadable(registryPath)) {
    return [];
  }
  let raw = "";
  try {
    raw = readFileSync(registryPath, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split(/\r?\n/);
  const rows: McpServerEntry[] = [];
  let current: McpServerEntry | undefined;
  let inServerEnvSection = false;

  const flushCurrent = () => {
    if (!current) {
      return;
    }
    const normalizedName = current.name.trim();
    if (normalizedName.length > 0) {
      rows.push({
        name: normalizedName,
        enabled: current.enabled,
      });
    }
    current = undefined;
    inServerEnvSection = false;
  };

  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }

    const arraySectionMatch = line.match(/^\[\[([A-Za-z0-9_.-]+)\]\]$/);
    if (arraySectionMatch) {
      flushCurrent();
      if (arraySectionMatch[1] === "servers") {
        current = {
          name: "",
          enabled: true,
        };
      }
      continue;
    }

    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      inServerEnvSection = sectionMatch[1] === "servers.env";
      continue;
    }

    if (!current || inServerEnvSection) {
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      continue;
    }
    const key = kvMatch[1];
    const value = kvMatch[2];
    if (key === "name") {
      current.name = parseTomlString(value) ?? current.name;
      continue;
    }
    if (key === "enabled") {
      current.enabled = parseTomlBoolean(value) ?? current.enabled;
    }
  }
  flushCurrent();
  return rows;
}

function mergeEnabledMcpServerNames(globalRegistryPath: string, projectRegistryPath?: string): string[] {
  const merged = new Map<string, McpServerEntry>();
  for (const entry of parseMcpServerEntries(globalRegistryPath)) {
    merged.set(entry.name, entry);
  }
  if (projectRegistryPath) {
    for (const entry of parseMcpServerEntries(projectRegistryPath)) {
      merged.set(entry.name, entry);
    }
  }
  return Array.from(merged.values())
    .filter((entry) => entry.enabled)
    .map((entry) => entry.name);
}

function readRulePack(path: string, source: "project" | "global", serverName: string): McpRulePack | undefined {
  if (!fileReadable(path)) {
    return undefined;
  }
  let content = "";
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  if (content.trim().length === 0) {
    return undefined;
  }
  return {
    serverName,
    source,
    path,
    content: content.trim(),
  };
}

function compactRulePackContent(rawContent: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }
  const lines = rawContent.split(/\r?\n/);
  const selected: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const normalized = line.trim().toLowerCase();
    if (normalized.length === 0) {
      if (selected.length > 0 && selected[selected.length - 1] !== "") {
        selected.push("");
      }
      continue;
    }
    if (MCP_RULE_BLOCKLIST_SNIPPETS.some((snippet) => normalized.includes(snippet))) {
      continue;
    }
    selected.push(line);
  }
  const compacted = selected.join("\n").trim();
  if (compacted.length <= maxChars) {
    return compacted;
  }
  const clipped = compacted.slice(0, Math.max(0, maxChars - 14)).trimEnd();
  return `${clipped}\n[truncated]`;
}

function buildPromptPrefix(packs: readonly McpRulePack[]): string {
  if (packs.length === 0) {
    return "";
  }
  const lines: string[] = [
    "[Activated MCP Instruction Packs]",
    "Use these connector rules when deciding whether and how to call MCP tools.",
  ];
  let remainingChars = MCP_RULE_MAX_TOTAL_CHARS;
  for (const pack of packs) {
    if (remainingChars <= 0) {
      break;
    }
    const budget = Math.min(remainingChars, MCP_RULE_MAX_CHARS_PER_SERVER);
    const compactedContent = compactRulePackContent(pack.content, budget);
    if (!compactedContent) {
      continue;
    }
    remainingChars -= compactedContent.length;
    lines.push("");
    lines.push(`### ${pack.serverName}`);
    lines.push(`source=${pack.source}`);
    lines.push(compactedContent);
  }
  return lines.join("\n");
}

function resolveRulePackForServer(input: {
  serverName: string;
  scope: McpInstructionScope;
  projectRulePath?: string;
  globalRulePath: string;
  events: string[];
}): McpRulePack | undefined {
  const { serverName, scope, projectRulePath, globalRulePath, events } = input;
  if (scope === MCP_SCOPE_PROJECT_ONLY) {
    if (!projectRulePath) {
      return undefined;
    }
    return readRulePack(projectRulePath, "project", serverName);
  }
  if (scope === MCP_SCOPE_GLOBAL_ONLY) {
    return readRulePack(globalRulePath, "global", serverName);
  }
  const projectPack = projectRulePath
    ? readRulePack(projectRulePath, "project", serverName)
    : undefined;
  if (projectPack) {
    return projectPack;
  }
  const globalPack = readRulePack(globalRulePath, "global", serverName);
  if (globalPack && projectRulePath) {
    events.push(`event=fallback_used server=${serverName} from=project to=global`);
  }
  return globalPack;
}

export function resolveMcpInstructionRuntime(
  input: ResolveMcpInstructionRuntimeInput,
): McpInstructionRuntime {
  const settings = readMcpInstructionSettings(input.projectTomlPath);
  if (!settings.enabled) {
    return {
      promptPrefix: "",
      loadedServerNames: [],
      events: ["event=pack_disabled"],
    };
  }
  const projectGrobotDir = resolveProjectGrobotDir(input.workDir, input.projectTomlPath);
  const globalRegistryPath = resolve(input.homeDir, "mcp", "servers.toml");
  const projectRegistryPath = projectGrobotDir ? resolve(projectGrobotDir, "mcp.toml") : undefined;
  const serverNames = mergeEnabledMcpServerNames(globalRegistryPath, projectRegistryPath);
  if (serverNames.length === 0) {
    return {
      promptPrefix: "",
      loadedServerNames: [],
      events: ["event=pack_skipped reason=no_enabled_servers"],
    };
  }

  const events: string[] = [];
  const loadedPacks: McpRulePack[] = [];
  const missingServers: string[] = [];
  for (const serverName of serverNames) {
    const projectRulePath = projectGrobotDir
      ? resolve(projectGrobotDir, "rules", "mcp", `${serverName}.md`)
      : undefined;
    const globalRulePath = resolve(input.homeDir, "rules", "mcp", `${serverName}.md`);
    const pack = resolveRulePackForServer({
      serverName,
      scope: settings.scope,
      projectRulePath,
      globalRulePath,
      events,
    });
    if (!pack) {
      missingServers.push(serverName);
      events.push(`event=pack_missing server=${serverName} strict=${settings.strict ? "true" : "false"}`);
      continue;
    }
    loadedPacks.push(pack);
    events.push(`event=pack_loaded server=${serverName} source=${pack.source} path=${pack.path}`);
  }
  const strictFailure = settings.strict && missingServers.length > 0
    ? `missing required MCP rule packs for servers: ${missingServers.join(", ")}`
    : undefined;

  return {
    promptPrefix: buildPromptPrefix(loadedPacks),
    loadedServerNames: loadedPacks.map((pack) => pack.serverName),
    events,
    strictFailure,
  };
}
