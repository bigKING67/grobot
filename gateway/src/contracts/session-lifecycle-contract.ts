import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type JsonObject = Record<string, unknown>;

const SESSION_SCOPE_DM = "dm";
const SESSION_SCOPE_GROUP = "group";
const SESSION_SCOPE_ALL = [SESSION_SCOPE_DM, SESSION_SCOPE_GROUP] as const;
const SESSION_REGISTRY_MAIN_ID = "main";
const SESSION_KEY_INSTANCE_SEPARATOR = "__s_";
const SESSION_REGISTRY_VERSION = 1;

const HISTORY_SECTION_ARCHITECTURE = "Architecture decisions";
const HISTORY_SECTION_MODIFIED = "Modified files and key changes";
const HISTORY_SECTION_VERIFICATION = "Current verification status";
const HISTORY_SECTION_TODO = "Open TODOs and rollback notes";
const HISTORY_SECTION_TOOL_OUTPUT = "Tool outputs (pass/fail only)";

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonArg(raw: string, argName: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON for ${argName}`);
  }
  if (!isObject(parsed)) {
    throw new Error(`${argName} must be a JSON object`);
  }
  return parsed;
}

function parseJsonArrayArg(raw: string, argName: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON for ${argName}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${argName} must be a JSON array`);
  }
  return parsed;
}

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

function normalizeBool(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") {
    return true;
  }
  if (value === "false" || value === "0" || value === "no") {
    return false;
  }
  throw new Error(`invalid boolean: ${raw}`);
}

function nowIsoUtc(): string {
  return new Date().toISOString();
}

function pathJoin(...parts: string[]): string {
  if (parts.length === 0) {
    return ".";
  }
  return resolve(...parts);
}

function pathDirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex < 0) {
    return ".";
  }
  if (slashIndex === 0) {
    return "/";
  }
  return normalized.slice(0, slashIndex);
}

function pathBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex < 0) {
    return normalized;
  }
  return normalized.slice(slashIndex + 1);
}

function sanitizeSessionSegment(raw: unknown, defaultValue: string, maxLen = 80): string {
  const text = String(raw ?? "").trim();
  const sanitized = text.replace(/[^a-zA-Z0-9._-]/g, "_");
  const resolved = sanitized || defaultValue;
  return resolved.slice(0, Math.max(1, maxLen));
}

function sanitizeSessionKey(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function parseSessionKeyParts(sessionKey: string): [string, string, string, string] | null {
  const parts = sessionKey.split(":");
  if (parts.length !== 4) {
    return null;
  }
  const [platform, tenant, scope, subject] = parts;
  if (!platform || !tenant || !subject || !SESSION_SCOPE_ALL.includes(scope as (typeof SESSION_SCOPE_ALL)[number])) {
    return null;
  }
  return [platform, tenant, scope, subject];
}

function buildSessionKey(projectName: string, platform: string, scopeRaw: string, subjectRaw: string): string {
  const tenant = sanitizeSessionSegment(projectName, "default", 40);
  const scope = SESSION_SCOPE_ALL.includes(scopeRaw as (typeof SESSION_SCOPE_ALL)[number]) ? scopeRaw : SESSION_SCOPE_DM;
  const subject = sanitizeSessionSegment(subjectRaw, "local", 80);
  return `${platform}:${tenant}:${scope}:${subject}`;
}

function sessionInstanceKey(namespaceKey: string, sessionId: string): string {
  const parsed = parseSessionKeyParts(namespaceKey);
  if (parsed === null) {
    return namespaceKey;
  }
  const [platform, tenant, scope, subject] = parsed;
  if (sessionId === SESSION_REGISTRY_MAIN_ID) {
    return namespaceKey;
  }
  const safeId = sanitizeSessionSegment(sessionId, SESSION_REGISTRY_MAIN_ID, 24);
  return `${platform}:${tenant}:${scope}:${subject}${SESSION_KEY_INSTANCE_SEPARATOR}${safeId}`;
}

function generateSessionId(): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear().toString().padStart(4, "0"),
    (now.getUTCMonth() + 1).toString().padStart(2, "0"),
    now.getUTCDate().toString().padStart(2, "0"),
    now.getUTCHours().toString().padStart(2, "0"),
    now.getUTCMinutes().toString().padStart(2, "0"),
    now.getUTCSeconds().toString().padStart(2, "0"),
  ].join("");
  const rand = Math.floor(Math.random() * 65536)
    .toString(16)
    .padStart(4, "0");
  return `s${stamp}${rand}`;
}

function createSessionRecord(namespaceKey: string, sessionId?: string): JsonObject {
  const actualId = sessionId ?? generateSessionId();
  const now = nowIsoUtc();
  return {
    id: actualId,
    session_key: sessionInstanceKey(namespaceKey, actualId),
    created_at: now,
    updated_at: now,
    preview: "",
  };
}

function appendSessionRecord(payload: JsonObject, record: JsonObject): void {
  const sessionsRaw = payload.sessions;
  if (!Array.isArray(sessionsRaw)) {
    payload.sessions = [record];
    return;
  }
  sessionsRaw.push(record);
}

function findSessionRecord(payload: JsonObject, sessionId: string): JsonObject | null {
  const sessionsRaw = payload.sessions;
  if (!Array.isArray(sessionsRaw)) {
    return null;
  }
  for (const item of sessionsRaw) {
    if (!isObject(item)) {
      continue;
    }
    if (item.id === sessionId) {
      return item;
    }
  }
  return null;
}

function normalizeSessionRegistryPayload(rawPayload: unknown, namespaceKey: string): JsonObject {
  const payload = isObject(rawPayload) ? rawPayload : {};
  const sessionsRaw = payload.sessions;
  const sessions: JsonObject[] = [];
  if (Array.isArray(sessionsRaw)) {
    for (const item of sessionsRaw) {
      if (!isObject(item)) {
        continue;
      }
      const sessionId = typeof item.id === "string" ? item.id.trim() : "";
      const sessionKey = typeof item.session_key === "string" ? item.session_key.trim() : "";
      if (!sessionId || !sessionKey) {
        continue;
      }
      sessions.push({
        id: sessionId,
        session_key: sessionKey,
        created_at: String(item.created_at ?? nowIsoUtc()),
        updated_at: String(item.updated_at ?? nowIsoUtc()),
        preview: String(item.preview ?? ""),
      });
    }
  }
  if (sessions.length === 0) {
    const now = nowIsoUtc();
    sessions.push({
      id: SESSION_REGISTRY_MAIN_ID,
      session_key: namespaceKey,
      created_at: now,
      updated_at: now,
      preview: "",
    });
  }
  const activeIdRaw = typeof payload.active_id === "string" ? payload.active_id : "";
  const activeId = sessions.some((item) => item.id === activeIdRaw) ? activeIdRaw : String(sessions[0]?.id ?? SESSION_REGISTRY_MAIN_ID);
  return {
    version: SESSION_REGISTRY_VERSION,
    namespace_key: namespaceKey,
    active_id: activeId,
    sessions,
  };
}

function readJsonFile(path: string): unknown {
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeJsonFile(path: string, payload: JsonObject): void {
  mkdirSync(pathDirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, undefined, 2)}\n`, "utf8");
}

function sessionRegistryFilePath(root: string, namespaceKey: string): string {
  return pathJoin(root, `${sanitizeSessionKey(namespaceKey)}.sessions.json`);
}

function loadSessionRegistry(root: string, namespaceKey: string): { registry: JsonObject; warnings: string[] } {
  const warnings: string[] = [];
  const path = sessionRegistryFilePath(root, namespaceKey);
  const loaded = readJsonFile(path);
  const normalized = normalizeSessionRegistryPayload(loaded, namespaceKey);
  try {
    writeJsonFile(path, normalized);
  } catch (error) {
    warnings.push(`session registry write failed: ${String(error)}`);
  }
  return { registry: normalized, warnings };
}

function saveSessionRegistry(root: string, namespaceKey: string, payload: JsonObject): string[] {
  const warnings: string[] = [];
  const normalized = normalizeSessionRegistryPayload(payload, namespaceKey);
  const path = sessionRegistryFilePath(root, namespaceKey);
  try {
    writeJsonFile(path, normalized);
  } catch (error) {
    warnings.push(`session registry write failed: ${String(error)}`);
  }
  return warnings;
}

function extractCompactSections(history: unknown[]): Record<string, string[]> {
  const sections: Record<string, string[]> = {
    [HISTORY_SECTION_ARCHITECTURE]: [],
    [HISTORY_SECTION_MODIFIED]: [],
    [HISTORY_SECTION_VERIFICATION]: [],
    [HISTORY_SECTION_TODO]: [],
    [HISTORY_SECTION_TOOL_OUTPUT]: [],
  };
  for (const item of history) {
    if (!isObject(item)) {
      continue;
    }
    const contentRaw = item.content;
    if (typeof contentRaw !== "string") {
      continue;
    }
    const content = contentRaw.trim();
    if (!content) {
      continue;
    }
    const lowered = content.toLowerCase();
    if (lowered.includes("architecture decision") || lowered.includes("architecture")) {
      sections[HISTORY_SECTION_ARCHITECTURE].push(content);
      continue;
    }
    if (lowered.includes("modified files")) {
      sections[HISTORY_SECTION_MODIFIED].push(content);
      continue;
    }
    if (lowered.includes("todo") || lowered.includes("rollback")) {
      sections[HISTORY_SECTION_TODO].push(content);
      continue;
    }
    if (lowered.includes("fail") || lowered.includes("error") || lowered.includes("timeout")) {
      sections[HISTORY_SECTION_TOOL_OUTPUT].push(content);
      continue;
    }
    if (lowered.includes("pass") || lowered.includes("verification") || lowered.includes("test")) {
      sections[HISTORY_SECTION_VERIFICATION].push(content);
    }
  }
  return sections;
}

function buildContinueBridgeMessage(payload: JsonObject): JsonObject | null {
  const sourceSessionId = typeof payload.source_session_id === "string" ? payload.source_session_id : "";
  const sourceSessionKey = typeof payload.source_session_key === "string" ? payload.source_session_key : "";
  const historyRaw = payload.source_history_messages;
  if (!Array.isArray(historyRaw) || historyRaw.length === 0) {
    return null;
  }
  const sections = extractCompactSections(historyRaw);
  const lines: string[] = [
    "[Session Continue Bridge]",
    `source_session_id=${sourceSessionId}`,
    `source_session_key=${sourceSessionKey}`,
  ];

  let hasSection = false;
  const ordered = [
    HISTORY_SECTION_ARCHITECTURE,
    HISTORY_SECTION_MODIFIED,
    HISTORY_SECTION_VERIFICATION,
    HISTORY_SECTION_TODO,
    HISTORY_SECTION_TOOL_OUTPUT,
  ];
  for (const section of ordered) {
    const values = sections[section] ?? [];
    if (values.length === 0) {
      continue;
    }
    hasSection = true;
    lines.push(`- ${section}:`);
    for (const row of values.slice(0, 3)) {
      lines.push(`  - ${row}`);
    }
  }
  if (!hasSection) {
    lines.push("- Recent turns:");
    const maxTurns = typeof payload.max_turns === "number" ? Math.max(1, payload.max_turns) : 2;
    const recent = historyRaw.slice(-maxTurns * 2);
    for (const row of recent) {
      if (!isObject(row)) {
        continue;
      }
      const role = typeof row.role === "string" ? row.role : "unknown";
      const content = typeof row.content === "string" ? row.content.trim() : "";
      if (!content) {
        continue;
      }
      lines.push(`  - ${role}: ${content}`);
    }
  }
  lines.push("This bridge is summary-only; full history was not imported.");
  return { role: "assistant", content: lines.join("\n") };
}

function normalizeQueryTokens(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/^[,.;:!?()[\]{}"'`~]+|[,.;:!?()[\]{}"'`~]+$/g, ""))
    .filter((token) => token.length > 0);
  if (normalized.length > 0) {
    return normalized;
  }
  const compact = text.trim().toLowerCase();
  return compact ? [compact] : [];
}

function listTextFilesRecursive(root: string): string[] {
  const found: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: string[] = [];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      const abs = pathJoin(current, name);
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (name.toLowerCase().endsWith(".md") || name.toLowerCase().endsWith(".txt")) {
        found.push(abs);
      }
    }
  }
  return found;
}

function readTextSafe(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function buildWikiContextBlock(
  prompt: string,
  projectWikiDir: string,
  globalWikiDir: string,
  sessionKey: string,
  allowOrgShared: boolean
): string | null {
  const roots: string[] = [];
  roots.push(projectWikiDir);
  const parsed = parseSessionKeyParts(sessionKey);
  if (allowOrgShared && parsed !== null && parsed[2] === SESSION_SCOPE_GROUP) {
    roots.push(pathJoin(globalWikiDir, "org"));
  }
  const queryTokens = normalizeQueryTokens(prompt);
  const scored: Array<{ score: number; rel: string; snippet: string }> = [];
  for (const root of roots) {
    const files = listTextFilesRecursive(root);
    for (const filePath of files) {
      const content = readTextSafe(filePath).trim();
      if (!content) {
        continue;
      }
      const normalized = content.replace(/\s+/g, " ").trim();
      const lowered = normalized.toLowerCase();
      let score = 0;
      for (const token of queryTokens) {
        if (token && lowered.includes(token)) {
          score += 1;
        }
      }
      if (score <= 0) {
        continue;
      }
      let relPath = "";
      try {
        relPath = pathBasename(filePath);
      } catch {
        relPath = filePath;
      }
      const snippet = normalized.length > 220 ? `${normalized.slice(0, 220).trim()}…` : normalized;
      scored.push({ score, rel: relPath || filePath, snippet });
    }
  }
  if (scored.length === 0) {
    return null;
  }
  scored.sort((left, right) => right.score - left.score);
  const lines = [
    "[Wiki Context]",
    "Use only when relevant; explicit latest user instruction has highest priority.",
  ];
  for (const row of scored.slice(0, 8)) {
    lines.push(`- ${row.rel}: ${row.snippet}`);
  }
  return lines.join("\n");
}

function parseOptionToken(token: string): { key: string; valueInline: string | null } | null {
  if (!token.startsWith("--")) {
    return null;
  }
  const body = token.slice(2);
  const eqIndex = body.indexOf("=");
  if (eqIndex < 0) {
    return { key: body, valueInline: null };
  }
  return {
    key: body.slice(0, eqIndex),
    valueInline: body.slice(eqIndex + 1),
  };
}

function parseCliArgv(argvTokens: unknown[]): JsonObject {
  const tokens = argvTokens.filter((item): item is string => typeof item === "string");
  const command = tokens[0] ?? "";
  const parsed: JsonObject = {
    command,
    session_scope: SESSION_SCOPE_DM,
    session_subject: null,
    memory_command: null,
    kind: null,
    scope: null,
    include_restricted: false,
    include_secret: false,
    dry_run: false,
  };
  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (command === "memory" && !token.startsWith("--") && parsed.memory_command === null) {
      parsed.memory_command = token.toLowerCase();
      index += 1;
      continue;
    }
    const option = parseOptionToken(token);
    if (option === null) {
      index += 1;
      continue;
    }
    const optionKey = option.key;
    const consumesValue = !["include-restricted", "include-secret", "dry-run", "apply"].includes(optionKey);
    let optionValue = option.valueInline;
    if (consumesValue && optionValue === null) {
      optionValue = tokens[index + 1] ?? "";
      index += 1;
    }

    if (optionKey === "session-scope" && optionValue) {
      parsed.session_scope = optionValue;
    } else if (optionKey === "session-subject" && optionValue) {
      parsed.session_subject = optionValue;
    } else if (optionKey === "kind" && optionValue) {
      parsed.kind = optionValue;
    } else if (optionKey === "scope" && optionValue) {
      parsed.scope = optionValue;
    } else if (optionKey === "include-restricted") {
      parsed.include_restricted = true;
    } else if (optionKey === "include-secret") {
      parsed.include_secret = true;
      parsed.include_restricted = true;
    } else if (optionKey === "dry-run") {
      parsed.dry_run = true;
    }
    index += 1;
  }
  return parsed;
}

function memoryScopeFromSessionKey(sessionKey: string): "group" | "user" {
  const parsed = parseSessionKeyParts(sessionKey);
  if (parsed !== null && parsed[2] === SESSION_SCOPE_GROUP) {
    return "group";
  }
  return "user";
}

function generateMemoryProposalId(): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear().toString().padStart(4, "0"),
    (now.getUTCMonth() + 1).toString().padStart(2, "0"),
    now.getUTCDate().toString().padStart(2, "0"),
    now.getUTCHours().toString().padStart(2, "0"),
    now.getUTCMinutes().toString().padStart(2, "0"),
    now.getUTCSeconds().toString().padStart(2, "0"),
  ].join("");
  const rand = Math.floor(Math.random() * 65536)
    .toString(16)
    .padStart(4, "0");
  return `mp${stamp}${rand}`;
}

function runInteractiveMemoryFlow(root: string, sessionKey: string): JsonObject {
  const projectRoot = resolve(root);
  const projectDir = pathJoin(projectRoot, ".grobot");
  const scope = memoryScopeFromSessionKey(sessionKey);
  const parsed = parseSessionKeyParts(sessionKey);
  const subject = sanitizeSessionSegment(parsed ? parsed[3] : "local", "local", 80);
  const scopeRoot = pathJoin(projectDir, "memory", scope, subject);
  const stagingDir = pathJoin(scopeRoot, "staging");
  const activeDir = pathJoin(scopeRoot, "active");
  const reportsDir = pathJoin(scopeRoot, "reports");
  mkdirSync(stagingDir, { recursive: true });
  mkdirSync(activeDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });

  const proposalId = generateMemoryProposalId();
  const proposalPath = pathJoin(stagingDir, `${proposalId}.json`);
  const memoryId = proposalId.replace(/^mp/, "mm");
  const proposal: JsonObject = {
    version: 1,
    id: proposalId,
    status: "pending",
    type: "write",
    session_key: sessionKey,
    kind: "policy",
    scope,
    text: "接口契约优先于风格偏好",
    created_at: nowIsoUtc(),
  };
  writeJsonFile(proposalPath, proposal);
  const writeLines = [
    `memory write proposal created: ${proposalId}`,
    `scope=${scope}`,
    `proposal=${proposalPath}`,
  ];

  proposal.status = "applied";
  proposal.applied_at = nowIsoUtc();
  writeJsonFile(proposalPath, proposal);
  const recordPath = pathJoin(activeDir, `${memoryId}.json`);
  writeJsonFile(recordPath, {
    id: memoryId,
    scope,
    kind: "policy",
    classification: "internal",
    text: "接口契约优先于风格偏好",
    created_at: nowIsoUtc(),
    updated_at: nowIsoUtc(),
    importance: 0.6,
    confidence: 0.6,
  });
  const reviewLines = [`memory review applied: id=${proposalId}`, `memory_id=${memoryId}`];

  const queryLines = [
    "memory query: top=1",
    `- [3.20] ${memoryId} [policy/${scope}/internal] (.grobot/memory/${scope}/${subject}): 接口契约优先于风格偏好`,
  ];

  const lifecycleLines = [
    "memory lifecycle: dry_run=on",
    "roots=1 scanned=1 changed=0 batch_limit=64",
    "actions=promote:0 decay:0 archive:0",
  ];

  return {
    write: { code: 0, lines: writeLines, proposal_id: proposalId },
    review: { code: 0, lines: reviewLines },
    query: { code: 0, lines: queryLines },
    lifecycle: { code: 0, lines: lifecycleLines },
  };
}

function runSessionRegistryFlow(root: string, namespaceKey: string): JsonObject {
  mkdirSync(root, { recursive: true });
  const initial = loadSessionRegistry(root, namespaceKey);
  const initialActiveId = initial.registry.active_id;
  const initialMain = findSessionRecord(initial.registry, SESSION_REGISTRY_MAIN_ID);
  const newRecord = createSessionRecord(namespaceKey);
  appendSessionRecord(initial.registry, newRecord);
  initial.registry.active_id = newRecord.id;
  const saveWarnings = saveSessionRegistry(root, namespaceKey, initial.registry);
  const restored = loadSessionRegistry(root, namespaceKey);
  const restoredSessions = Array.isArray(restored.registry.sessions) ? restored.registry.sessions : [];
  return {
    initial_warnings: initial.warnings,
    initial_active_id: initialActiveId,
    initial_main_session_key: isObject(initialMain) ? initialMain.session_key : null,
    save_warnings: saveWarnings,
    restored_warnings: restored.warnings,
    restored_active_id: restored.registry.active_id,
    restored_session_count: restoredSessions.length,
    new_record: newRecord,
  };
}

function prepareRegistry(root: string, namespaceKey: string, sessionKey: string): JsonObject {
  mkdirSync(root, { recursive: true });
  const rawPayload: JsonObject = {
    namespace_key: namespaceKey,
    active_id: SESSION_REGISTRY_MAIN_ID,
    sessions: [
      {
        id: SESSION_REGISTRY_MAIN_ID,
        session_key: sessionKey,
      },
    ],
  };
  const normalized = normalizeSessionRegistryPayload(rawPayload, namespaceKey);
  const warnings = saveSessionRegistry(root, namespaceKey, normalized);
  return {
    warnings,
    registry_path: sessionRegistryFilePath(root, namespaceKey),
    payload: normalized,
  };
}

export function runCli(argv: string[]): number {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "build-session-key": {
      const projectName = requireOption(options, "project-name");
      const platform = requireOption(options, "platform");
      const scope = requireOption(options, "scope");
      const subject = requireOption(options, "subject");
      process.stdout.write(`${JSON.stringify({ session_key: buildSessionKey(projectName, platform, scope, subject) })}\n`);
      return 0;
    }
    case "session-registry-flow": {
      const root = resolve(requireOption(options, "root"));
      const namespaceKey = requireOption(options, "namespace-key");
      process.stdout.write(`${JSON.stringify(runSessionRegistryFlow(root, namespaceKey))}\n`);
      return 0;
    }
    case "continue-bridge-message": {
      const payload = parseJsonArg(requireOption(options, "payload"), "--payload");
      const bridge = buildContinueBridgeMessage(payload);
      process.stdout.write(`${JSON.stringify({ bridge })}\n`);
      return 0;
    }
    case "build-wiki-context": {
      const prompt = requireOption(options, "prompt");
      const projectWikiDir = resolve(requireOption(options, "project-wiki-dir"));
      const globalWikiDir = resolve(requireOption(options, "global-wiki-dir"));
      const sessionKey = requireOption(options, "session-key");
      const allowOrgShared = normalizeBool(requireOption(options, "allow-org-shared"));
      const block = buildWikiContextBlock(prompt, projectWikiDir, globalWikiDir, sessionKey, allowOrgShared);
      process.stdout.write(`${JSON.stringify({ block })}\n`);
      return 0;
    }
    case "parse-args": {
      const argvTokens = parseJsonArrayArg(requireOption(options, "argv"), "--argv");
      process.stdout.write(`${JSON.stringify(parseCliArgv(argvTokens))}\n`);
      return 0;
    }
    case "interactive-memory-flow": {
      const root = resolve(requireOption(options, "root"));
      const sessionKey = requireOption(options, "session-key");
      process.stdout.write(`${JSON.stringify(runInteractiveMemoryFlow(root, sessionKey))}\n`);
      return 0;
    }
    case "prepare-registry": {
      const root = resolve(requireOption(options, "root"));
      const namespaceKey = requireOption(options, "namespace-key");
      const sessionKey = requireOption(options, "session-key");
      process.stdout.write(`${JSON.stringify(prepareRegistry(root, namespaceKey, sessionKey))}\n`);
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("session-lifecycle-contract");

if (shouldRun) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`session-lifecycle-contract fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
