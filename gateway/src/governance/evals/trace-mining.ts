import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

type JsonObject = Record<string, unknown>;

const DEFAULT_CASES_OUTPUT = "gateway/evals/data/cases.trace.jsonl";
const DEFAULT_RUNS_OUTPUT = "gateway/evals/data/runs.trace_baseline.jsonl";
const DEFAULT_VARIANT = "trace_baseline";

const TOOL_KEYWORDS: Array<{ tool: string; keywords: string[] }> = [
  { tool: "read", keywords: ["read", "读取", "查看", "看下", "打开", "open"] },
  { tool: "write", keywords: ["write", "写入", "创建", "新建", "保存"] },
  { tool: "edit", keywords: ["edit", "修改", "替换", "改一下", "patch"] },
  { tool: "bash", keywords: ["bash", "shell", "终端", "命令行", "执行命令"] },
  { tool: "search", keywords: ["search", "查找", "搜索", "grep", "rg"] },
  { tool: "glob", keywords: ["glob", "通配", "匹配文件"] },
  { tool: "list", keywords: ["list", "列出", "目录", "ls"] },
];

export interface MiningStats {
  session_files: number;
  message_pairs: number;
  generated_cases: number;
  skipped_short: number;
  skipped_invalid: number;
}

interface MineTraceSessionsArgs {
  sessionsDir: string;
  casesOutput: string;
  runsOutput: string;
  variant: string;
  holdoutRatio: number;
  seed: number;
  maxCases: number;
  minChars: number;
}

interface ParsedCliArgs {
  sessionsDir: string;
  casesOutput: string;
  runsOutput: string;
  variant: string;
  holdoutRatio: number;
  seed: number;
  maxCases: number;
  minChars: number;
  dryRun: boolean;
}

interface SessionMessage {
  role: string;
  content: string;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function dirname(path: string): string {
  const normalized = normalizePath(path).replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function normalizeText(value: string): string {
  return value.trim();
}

function slug(value: string): string {
  const lowered = value.toLowerCase();
  const converted = lowered.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return converted || "session";
}

function parseFloatNumber(value: string, flag: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be number`);
  }
  return parsed;
}

function parseInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${flag} must be int`);
  }
  return parsed;
}

function parseArgs(argv: string[]): ParsedCliArgs {
  const args: ParsedCliArgs = {
    sessionsDir: ".grobot/sessions",
    casesOutput: DEFAULT_CASES_OUTPUT,
    runsOutput: DEFAULT_RUNS_OUTPUT,
    variant: DEFAULT_VARIANT,
    holdoutRatio: 0.2,
    seed: 42,
    maxCases: 0,
    minChars: 8,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const readValue = (): string => {
      const value = argv[index + 1] ?? "";
      if (!value || value.startsWith("--")) {
        throw new Error(`missing value for ${token}`);
      }
      return value;
    };
    switch (token) {
      case "--sessions-dir":
        args.sessionsDir = readValue();
        index += 1;
        break;
      case "--cases-output":
        args.casesOutput = readValue();
        index += 1;
        break;
      case "--runs-output":
        args.runsOutput = readValue();
        index += 1;
        break;
      case "--variant":
        args.variant = readValue();
        index += 1;
        break;
      case "--holdout-ratio":
        args.holdoutRatio = parseFloatNumber(readValue(), "--holdout-ratio");
        index += 1;
        break;
      case "--seed":
        args.seed = parseInteger(readValue(), "--seed");
        index += 1;
        break;
      case "--max-cases":
        args.maxCases = parseInteger(readValue(), "--max-cases");
        index += 1;
        break;
      case "--min-chars":
        args.minChars = parseInteger(readValue(), "--min-chars");
        index += 1;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`unknown argument: ${token}`);
    }
  }
  return args;
}

function deterministicSplit(caseId: string, holdoutRatio: number, seed: number): "holdout" | "optimization" {
  const payload = `${seed}:${caseId}`;
  const digest = createHash("sha1").update(payload).digest();
  let numeric = 0n;
  for (let index = 0; index < 8; index += 1) {
    numeric = (numeric << 8n) | BigInt(digest[index]);
  }
  const maxUint64 = 1n << 64n;
  const threshold = BigInt(Math.floor(holdoutRatio * Number(maxUint64)));
  return numeric < threshold ? "holdout" : "optimization";
}

function extractPairs(messages: SessionMessage[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const current = messages[index];
    const next = messages[index + 1];
    if (current.role !== "user" || next.role !== "assistant") {
      continue;
    }
    pairs.push([normalizeText(current.content), normalizeText(next.content)]);
  }
  return pairs;
}

function inferTools(prompt: string, response: string): string[] {
  const joined = `${prompt}\n${response}`.toLowerCase();
  const inferred: string[] = [];
  for (const item of TOOL_KEYWORDS) {
    if (item.keywords.some((keyword) => joined.includes(keyword.toLowerCase()))) {
      inferred.push(item.tool);
    }
  }
  return inferred;
}

function inferCategory(
  prompt: string,
  response: string,
): { category: string; tags: string[]; weights: JsonObject | null } {
  const joined = `${prompt}\n${response}`.toLowerCase();
  if (["密钥", "token", "secret", "脱敏", "安全"].some((token) => joined.includes(token))) {
    return {
      category: "safety",
      tags: ["safety", "trace"],
      weights: { safety_compliance: 0.4, task_success: 0.3 },
    };
  }
  if (["继续", "回顾", "上下文", "previous", "context"].some((token) => joined.includes(token))) {
    return {
      category: "context",
      tags: ["context", "trace"],
      weights: { context_retention: 0.35, task_success: 0.3 },
    };
  }
  if (["read", "write", "edit", "bash", "文件", "@"].some((token) => joined.includes(token))) {
    return {
      category: "tooling",
      tags: ["tools", "trace"],
      weights: { tool_use_quality: 0.35, task_success: 0.3 },
    };
  }
  return { category: "general", tags: ["trace"], weights: null };
}

function extractRequiredSubstrings(response: string): string[] {
  const text = response.trim();
  if (!text) {
    return [];
  }
  const chunks = text
    .split(/[。.!?\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (chunks.length === 0) {
    return [];
  }
  let first = chunks[0];
  if (first.length < 4) {
    return [];
  }
  if (first.length > 48) {
    first = first.slice(0, 48);
  }
  return [first];
}

function buildCaseId(sessionKey: string, pairIndex: number): string {
  const sessionSlug = slug(sessionKey.replace(/:/g, "_"));
  return `${sessionSlug}_${String(pairIndex).padStart(4, "0")}`;
}

function loadSessionJson(path: string): JsonObject | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const payload = parsed as JsonObject;
  if (!Array.isArray(payload.messages)) {
    return null;
  }
  return payload;
}

function toSessionMessages(value: unknown): SessionMessage[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const messages: SessionMessage[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return null;
    }
    const row = item as JsonObject;
    const role = row.role;
    const content = row.content;
    if (typeof role !== "string" || typeof content !== "string") {
      return null;
    }
    messages.push({ role, content });
  }
  return messages;
}

function writeJsonl(path: string, rows: JsonObject[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = rows.map((item) => JSON.stringify(item)).join("\n");
  if (body.length > 0) {
    writeFileSync(path, `${body}\n`, "utf8");
    return;
  }
  writeFileSync(path, "", "utf8");
}

function listSessionFiles(sessionsDir: string): string[] {
  const names = readdirSync(sessionsDir)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => name !== "interrupts.json")
    .sort();
  return names.map((name) => `${removeTrailingSlash(sessionsDir)}/${name}`);
}

function removeTrailingSlash(path: string): string {
  return normalizePath(path).replace(/[\\/]+$/, "");
}

export function mineTraceSessions(args: MineTraceSessionsArgs): MiningStats {
  if (args.holdoutRatio < 0 || args.holdoutRatio > 1) {
    throw new Error("holdout_ratio must be within [0, 1]");
  }
  if (args.maxCases < 0) {
    throw new Error("max_cases must be >= 0");
  }
  if (args.minChars < 1) {
    throw new Error("min_chars must be >= 1");
  }

  const sessionFiles = listSessionFiles(args.sessionsDir);
  const cases: JsonObject[] = [];
  const runs: JsonObject[] = [];
  let messagePairs = 0;
  let skippedShort = 0;
  let skippedInvalid = 0;

  for (const sessionFile of sessionFiles) {
    const payload = loadSessionJson(sessionFile);
    if (payload === null) {
      skippedInvalid += 1;
      continue;
    }
    const sessionKeyRaw = payload.session_key;
    const updatedAtRaw = payload.updated_at;
    const messages = toSessionMessages(payload.messages);
    if (messages === null) {
      skippedInvalid += 1;
      continue;
    }
    const sessionKey = typeof sessionKeyRaw === "string" && sessionKeyRaw.length > 0 ? sessionKeyRaw : sessionFile;
    const updatedAt = typeof updatedAtRaw === "string" ? updatedAtRaw : "";

    const pairs = extractPairs(messages);
    messagePairs += pairs.length;

    for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
      const [prompt, response] = pairs[pairIndex];
      if (response.length < args.minChars) {
        skippedShort += 1;
        continue;
      }
      const caseId = buildCaseId(sessionKey, pairIndex + 1);
      const split = deterministicSplit(caseId, args.holdoutRatio, args.seed);
      const tools = inferTools(prompt, response);
      const categoryPayload = inferCategory(prompt, response);
      const expectations: JsonObject = {
        required_substrings: extractRequiredSubstrings(response),
      };
      if (tools.length > 0) {
        expectations.required_tools = tools.slice(0, 2);
      }
      const casePayload: JsonObject = {
        id: caseId,
        split,
        prompt,
        category: categoryPayload.category,
        tags: categoryPayload.tags,
        expectations,
        metadata: {
          source: "trace_mining",
          review_required: true,
          session_key: sessionKey,
          session_file: (() => {
            const parts = sessionFile.split("/");
            return parts.length > 0 ? parts[parts.length - 1] : sessionFile;
          })(),
          pair_index: pairIndex + 1,
          updated_at: updatedAt,
        },
      };
      if (categoryPayload.weights !== null) {
        casePayload.weights = categoryPayload.weights;
      }
      const runPayload: JsonObject = {
        case_id: caseId,
        variant: args.variant,
        assistant_response: response,
        used_tools: tools,
        recalled_context: [],
        completed: true,
        metadata: {
          source: "trace_mining",
          session_key: sessionKey,
          session_file: (() => {
            const parts = sessionFile.split("/");
            return parts.length > 0 ? parts[parts.length - 1] : sessionFile;
          })(),
          pair_index: pairIndex + 1,
        },
      };
      cases.push(casePayload);
      runs.push(runPayload);
      if (args.maxCases > 0 && cases.length >= args.maxCases) {
        break;
      }
    }
    if (args.maxCases > 0 && cases.length >= args.maxCases) {
      break;
    }
  }

  writeJsonl(args.casesOutput, cases);
  writeJsonl(args.runsOutput, runs);

  return {
    session_files: sessionFiles.length,
    message_pairs: messagePairs,
    generated_cases: cases.length,
    skipped_short: skippedShort,
    skipped_invalid: skippedInvalid,
  };
}

export function runCli(argv: string[]): number {
  const parsed = parseArgs(argv);
  const casesOutput = parsed.dryRun ? "/tmp/grobot.trace.cases.dryrun.jsonl" : parsed.casesOutput;
  const runsOutput = parsed.dryRun ? "/tmp/grobot.trace.runs.dryrun.jsonl" : parsed.runsOutput;
  const stats = mineTraceSessions({
    sessionsDir: parsed.sessionsDir,
    casesOutput,
    runsOutput,
    variant: parsed.variant,
    holdoutRatio: parsed.holdoutRatio,
    seed: parsed.seed,
    maxCases: parsed.maxCases,
    minChars: parsed.minChars,
  });
  const output: JsonObject = {
    stats,
    cases_output: casesOutput,
    runs_output: runsOutput,
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (parsed.dryRun) {
    try {
      unlinkSync(casesOutput);
    } catch {}
    try {
      unlinkSync(runsOutput);
    } catch {}
  }
  return 0;
}

const entryScript = process.argv[1] ?? "";
const shouldRunCli = entryScript.includes("trace-mining");

if (shouldRunCli) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`trace-mining fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
