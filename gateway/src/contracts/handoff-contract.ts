type JsonObject = Record<string, unknown>;

const HANDOFF_DEFAULT_RECENT_TURNS = 6;
const SECTION_ARCHITECTURE = "Architecture decisions";
const SECTION_MODIFIED = "Modified files and key changes";
const SECTION_VERIFICATION = "Current verification status";
const SECTION_TODO = "Open TODOs and rollback notes";
const SECTION_TOOL_OUTPUT = "Tool outputs (pass/fail only)";

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

export function sanitizeHandoffText(raw: string): string {
  let sanitized = raw;
  sanitized = sanitized.replace(
    /\b(api[_-]?key|token|secret|password)\b\s*([:=])\s*([^\s,;]+)/gi,
    (_all, key: string, sep: string) => `${key}${sep}<redacted>`
  );
  sanitized = sanitized.replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer <redacted>");
  sanitized = sanitized.replace(/\b(?:sk|gsk|rk)-[A-Za-z0-9_-]{8,}\b/g, "<redacted>");
  return sanitized;
}

function readSectionItems(compactMemory: JsonObject, sectionName: string): string[] {
  const sectionsRaw = compactMemory.sections;
  if (!isObject(sectionsRaw)) {
    return [];
  }
  const values = sectionsRaw[sectionName];
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter((item): item is string => typeof item === "string");
}

function hasHint(content: string, hints: readonly string[]): boolean {
  const normalized = content.toLowerCase();
  for (const hint of hints) {
    if (normalized.includes(hint)) {
      return true;
    }
  }
  return false;
}

export function hasOpenTodoItems(compactMemory: JsonObject | null): boolean {
  if (!compactMemory) {
    return false;
  }
  return readSectionItems(compactMemory, SECTION_TODO).length > 0;
}

export function shouldAutoWriteHandoff(compacted: boolean, failover: boolean, todoOpen: boolean): boolean {
  return compacted || failover || todoOpen;
}

function renderBulletLines(lines: string[]): string {
  if (lines.length === 0) {
    return "- (none)";
  }
  return lines.map((line) => `- ${line}`).join("\n");
}

function selectCurrentGoal(historyMessages: unknown): string {
  if (!Array.isArray(historyMessages)) {
    return "Continue current implementation with verified checkpoints.";
  }
  for (let index = historyMessages.length - 1; index >= 0; index -= 1) {
    const row = historyMessages[index];
    if (!isObject(row)) {
      continue;
    }
    if (row.role !== "user") {
      continue;
    }
    if (typeof row.content === "string" && row.content.trim().length > 0) {
      return row.content.trim();
    }
  }
  return "Continue current implementation with verified checkpoints.";
}

function renderRecentTurns(historyMessages: unknown, recentTurns: number): string {
  if (!Array.isArray(historyMessages) || historyMessages.length === 0) {
    return "- (none)";
  }
  const maxRows = Math.max(1, recentTurns) * 2;
  const selected = historyMessages.slice(-maxRows);
  const lines: string[] = [];
  for (const row of selected) {
    if (!isObject(row)) {
      continue;
    }
    const role = typeof row.role === "string" ? row.role : "unknown";
    const content = typeof row.content === "string" ? row.content.trim() : "";
    if (!content) {
      continue;
    }
    lines.push(`- ${role}: ${content}`);
  }
  return lines.length > 0 ? lines.join("\n") : "- (none)";
}

export function buildHandoffMarkdown(payload: JsonObject): string {
  const compactMemory = isObject(payload.compact_memory) ? payload.compact_memory : {};
  const verification = readSectionItems(compactMemory, SECTION_VERIFICATION);
  const toolOutput = readSectionItems(compactMemory, SECTION_TOOL_OUTPUT);
  const worked = [...verification, ...toolOutput].filter((line) =>
    hasHint(line, ["pass", "passed", "success", "succeeded", "ok", "通过", "成功"])
  );
  const failed = [...verification, ...toolOutput].filter((line) =>
    hasHint(line, ["fail", "failed", "error", "exception", "timeout", "失败", "错误", "异常", "超时"])
  );
  const failoverErrorsRaw = payload.failover_errors;
  const failoverErrors = Array.isArray(failoverErrorsRaw)
    ? failoverErrorsRaw.filter((item): item is string => typeof item === "string")
    : [];
  const compactionObserved = payload.compaction_observed === true;
  const failoverObserved = failoverErrors.length > 0;
  const recentTurnsRaw = payload.recent_turns;
  const recentTurns = typeof recentTurnsRaw === "number" && Number.isFinite(recentTurnsRaw) ? recentTurnsRaw : 3;

  return [
    "# HANDOFF",
    "",
    "## Current Goal",
    `- ${selectCurrentGoal(payload.history_messages)}`,
    "",
    "## Architecture Decisions (verbatim)",
    renderBulletLines(readSectionItems(compactMemory, SECTION_ARCHITECTURE)),
    "",
    "## Modified Files and Key Changes",
    renderBulletLines(readSectionItems(compactMemory, SECTION_MODIFIED)),
    "",
    "## Verification Status (PASS/FAIL only)",
    renderBulletLines([...verification, ...toolOutput]),
    "",
    "## What Was Tried",
    "### Worked",
    renderBulletLines(worked),
    "### Did Not Work",
    renderBulletLines(failed),
    "",
    "## Open TODOs and Rollback Notes",
    renderBulletLines(readSectionItems(compactMemory, SECTION_TODO)),
    "",
    "## Next 3 Steps",
    "- Finalize outstanding TODO items and record rollback notes.",
    "- Re-run target checks and capture pass/fail status.",
    "- Continue from this handoff with minimal context loss.",
    "",
    "## Runtime Signals",
    `- compaction_observed: ${compactionObserved ? "true" : "false"}`,
    `- failover_observed: ${failoverObserved ? "true" : "false"}`,
    "",
    "## Recent Turns",
    renderRecentTurns(payload.history_messages, recentTurns),
  ].join("\n");
}

function requireOption(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

export function runCli(argv: string[]): number {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "sanitize": {
      const text = requireOption(options, "text");
      process.stdout.write(`${JSON.stringify({ sanitized: sanitizeHandoffText(text) })}\n`);
      return 0;
    }
    case "build": {
      const payloadRaw = requireOption(options, "payload");
      const payload = parseJsonArg(payloadRaw, "--payload");
      process.stdout.write(`${buildHandoffMarkdown(payload)}\n`);
      return 0;
    }
    case "should-auto-write": {
      const compacted = normalizeBool(requireOption(options, "compacted"));
      const failover = normalizeBool(requireOption(options, "failover"));
      const todoOpen = normalizeBool(requireOption(options, "todo-open"));
      process.stdout.write(`${JSON.stringify({ value: shouldAutoWriteHandoff(compacted, failover, todoOpen) })}\n`);
      return 0;
    }
    case "has-open-todo": {
      const compactRaw = requireOption(options, "compact-memory");
      const compactMemory = parseJsonArg(compactRaw, "--compact-memory");
      process.stdout.write(`${JSON.stringify({ value: hasOpenTodoItems(compactMemory) })}\n`);
      return 0;
    }
    case "start-defaults": {
      process.stdout.write(
        `${JSON.stringify({
          handoff_recent_turns: HANDOFF_DEFAULT_RECENT_TURNS,
          handoff_auto_on_exit: true,
        })}\n`
      );
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
const shouldRun = entryScript.includes("handoff-contract");

if (shouldRun) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`handoff-contract fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
