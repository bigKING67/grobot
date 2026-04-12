import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { resolveExecutionPlaneConfig } from "./execution-plane";
import { runGatewayTurn } from "./main";
import { Platform, SessionScope } from "./types";
import { buildSessionKey } from "./session-key";

type OptionValue = string | boolean;

interface ParsedArgs {
  command: string;
  options: Record<string, OptionValue>;
  positionals: string[];
}

function usage(): string {
  return [
    "Grobot TS dev CLI (source-checkout fallback)",
    "",
    "Commands:",
    "  status [--work-dir <dir>] [--gateway-impl ts] [--runtime-impl rust] [--shadow-mode|--no-shadow-mode]",
    "  start --message <text> [--project <name>] [--work-dir <dir>] [--gateway-impl ts] [--runtime-impl rust]",
    "  serve [--bind 127.0.0.1:8080] [--management-token <token>] [--config <path>] [--config-read-policy auto|public|auth|disabled] [--work-dir <dir>] [--gateway-impl ts] [--runtime-impl rust]",
    "",
    "Optional session args for start:",
    "  --platform feishu|telegram --tenant <id> --scope dm|group --subject <id>",
  ].join("\n");
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, OptionValue> = {};
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      index += 1;
      continue;
    }

    const eqIndex = token.indexOf("=");
    if (eqIndex >= 0) {
      const key = token.slice(2, eqIndex);
      const value = token.slice(eqIndex + 1);
      options[key] = value;
      index += 1;
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      options[key] = next;
      index += 2;
      continue;
    }
    options[key] = true;
    index += 1;
  }

  const command = positionals[0] ?? "";
  return {
    command,
    options,
    positionals: positionals.slice(1),
  };
}

function readOptionString(options: Record<string, OptionValue>, key: string): string | undefined {
  const value = options[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function hasFlag(options: Record<string, OptionValue>, key: string): boolean {
  const value = options[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "false" || normalized === "off" || normalized === "0" || normalized === "no") {
      return false;
    }
    return normalized.length > 0;
  }
  return false;
}

function isTruthyString(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function validateHardCutExecutionOptions(options: Record<string, OptionValue>): string[] {
  const errors: string[] = [];
  if (hasFlag(options, "legacy-python-cli")) {
    errors.push("--legacy-python-cli is removed in TS+Rust hard-cut mode");
  }
  if (isTruthyString(process.env.GROBOT_LEGACY_PYTHON)) {
    errors.push("GROBOT_LEGACY_PYTHON is no longer supported");
  }

  const gatewayRaw = readOptionString(options, "gateway-impl");
  if (gatewayRaw) {
    const gatewayValue = gatewayRaw.trim().toLowerCase();
    if (gatewayValue === "python") {
      errors.push("--gateway-impl=python is no longer supported");
    } else if (gatewayValue !== "ts") {
      errors.push(`invalid --gateway-impl value: ${gatewayRaw}`);
    }
  }

  const runtimeRaw = readOptionString(options, "runtime-impl");
  if (runtimeRaw) {
    const runtimeValue = runtimeRaw.trim().toLowerCase();
    if (runtimeValue === "python") {
      errors.push("--runtime-impl=python is no longer supported");
    } else if (runtimeValue !== "rust") {
      errors.push(`invalid --runtime-impl value: ${runtimeRaw}`);
    }
  }

  return errors;
}

function fileReadable(path: string): boolean {
  try {
    const content = readFileSync(path, "utf8");
    return content.length >= 0;
  } catch {
    return false;
  }
}

function removeTrailingSlashes(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function stripInlineComment(line: string): string {
  let inQuote = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
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
      return line.slice(0, i);
    }
  }
  return line;
}

function parseTomlString(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("\"")) {
    const match = trimmed.match(/^"([^"]*)"/);
    if (match && typeof match[1] === "string") {
      return match[1].trim();
    }
  }
  return trimmed;
}

function resolveWorkDir(options: Record<string, OptionValue>): string {
  const raw = readOptionString(options, "work-dir");
  if (!raw) {
    return process.cwd();
  }
  if (raw.startsWith("/")) {
    return removeTrailingSlashes(raw);
  }
  return removeTrailingSlashes(`${process.cwd()}/${raw}`);
}

function resolveProjectTomlPath(options: Record<string, OptionValue>, workDir: string): string | undefined {
  const explicit = readOptionString(options, "project-toml");
  if (explicit && fileReadable(explicit)) {
    return explicit;
  }
  const fromWorkDir = `${workDir}/.grobot/project.toml`;
  if (fileReadable(fromWorkDir)) {
    return fromWorkDir;
  }
  const repoRoot = process.env.GROBOT_TS_DEV_REPO_ROOT;
  if (repoRoot) {
    const fromRepo = `${removeTrailingSlashes(repoRoot)}/.grobot/project.toml`;
    if (fileReadable(fromRepo)) {
      return fromRepo;
    }
  }
  return undefined;
}

function resolveConfigTomlPath(options: Record<string, OptionValue>): string | undefined {
  const explicit = readOptionString(options, "config");
  if (explicit && fileReadable(explicit)) {
    return explicit;
  }
  const envPath = process.env.GROBOT_CONFIG;
  if (typeof envPath === "string" && envPath.trim().length > 0 && fileReadable(envPath.trim())) {
    return envPath.trim();
  }
  const fromHome = `${resolveHomeDir()}/config.toml`;
  if (fileReadable(fromHome)) {
    return fromHome;
  }
  return undefined;
}

function basenameFromPath(value: string): string {
  const normalized = removeTrailingSlashes(value);
  const tokens = normalized.split(/[\\/]/);
  const last = tokens[tokens.length - 1];
  if (typeof last === "string" && last.length > 0) {
    return last;
  }
  return "grobot";
}

function parsePlatform(raw: string | undefined): Platform {
  if (raw === "telegram") {
    return "telegram";
  }
  return "feishu";
}

function parseScope(raw: string | undefined): SessionScope {
  if (raw === "group") {
    return "group";
  }
  return "dm";
}

function resolveHomeDir(): string {
  const fromEnv = process.env.GROBOT_HOME;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return removeTrailingSlashes(fromEnv.trim());
  }
  const home = process.env.HOME;
  if (typeof home === "string" && home.trim().length > 0) {
    return `${removeTrailingSlashes(home.trim())}/.grobot`;
  }
  return `${process.cwd()}/.grobot`;
}

function dirname(path: string): string {
  const normalized = removeTrailingSlashes(path);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function resolveInterruptStorePath(): string {
  return `${resolveHomeDir()}/runtime/sessions/interrupts.json`;
}

function resolveMemoryStorePath(): string {
  return `${resolveHomeDir()}/runtime/memory/ts-dev-cli-memory.json`;
}

interface InterruptStorePayload {
  version: number;
  entries: Record<string, number>;
}

interface MemoryStorePayload {
  version: number;
  sessions: Record<string, Record<string, unknown>[]>;
}

function nowEpochSec(): number {
  return Math.floor(Date.now() / 1_000);
}

function loadInterruptStore(path: string): InterruptStorePayload {
  if (!existsSync(path)) {
    return {
      version: 1,
      entries: {},
    };
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return { version: 1, entries: {} };
    }
    const record = parsed as Record<string, unknown>;
    const rawEntries = record.entries;
    const entries: Record<string, number> = {};
    if (typeof rawEntries === "object" && rawEntries !== null) {
      for (const [key, value] of Object.entries(rawEntries as Record<string, unknown>)) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
          entries[key] = Math.floor(value);
        }
      }
    }
    return {
      version: 1,
      entries,
    };
  } catch {
    return { version: 1, entries: {} };
  }
}

function saveInterruptStore(path: string, payload: InterruptStorePayload): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload)}\n`, "utf8");
}

function cleanupInterruptStore(payload: InterruptStorePayload): InterruptStorePayload {
  const now = nowEpochSec();
  const entries: Record<string, number> = {};
  for (const [sessionKey, expiry] of Object.entries(payload.entries)) {
    if (expiry > now) {
      entries[sessionKey] = expiry;
    }
  }
  return {
    version: 1,
    entries,
  };
}

function setInterruptFlag(sessionKey: string, ttlSecs: number): void {
  const path = resolveInterruptStorePath();
  const payload = cleanupInterruptStore(loadInterruptStore(path));
  payload.entries[sessionKey] = nowEpochSec() + ttlSecs;
  saveInterruptStore(path, payload);
}

function consumeInterruptFlag(sessionKey: string): boolean {
  const path = resolveInterruptStorePath();
  const payload = cleanupInterruptStore(loadInterruptStore(path));
  if (!payload.entries[sessionKey]) {
    return false;
  }
  delete payload.entries[sessionKey];
  saveInterruptStore(path, payload);
  return true;
}

function loadMemoryStore(path: string): Map<string, Record<string, unknown>[]> {
  const map = new Map<string, Record<string, unknown>[]>();
  if (!existsSync(path)) {
    return map;
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return map;
    }
    const sessions = (parsed as Record<string, unknown>).sessions;
    if (typeof sessions !== "object" || sessions === null) {
      return map;
    }
    for (const [sessionId, rows] of Object.entries(sessions as Record<string, unknown>)) {
      if (!Array.isArray(rows)) {
        continue;
      }
      const normalizedRows: Record<string, unknown>[] = [];
      for (const row of rows) {
        if (typeof row !== "object" || row === null || Array.isArray(row)) {
          continue;
        }
        normalizedRows.push({ ...(row as Record<string, unknown>) });
      }
      map.set(sessionId, normalizedRows);
    }
    return map;
  } catch {
    return map;
  }
}

function saveMemoryStore(path: string, sessions: Map<string, Record<string, unknown>[]>): void {
  const payload: MemoryStorePayload = {
    version: 1,
    sessions: {},
  };
  for (const [sessionId, rows] of sessions.entries()) {
    payload.sessions[sessionId] = rows.map((row) => ({ ...row }));
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload)}\n`, "utf8");
}

function memoryStoreRedisKey(projectName: string, workDir: string): string {
  return `grobot:ts-dev-cli:memory-store:v1:${projectName}:${encodeURIComponent(workDir)}`;
}

function decodeMemoryStorePayload(payload: Record<string, unknown>): Map<string, Record<string, unknown>[]> {
  const map = new Map<string, Record<string, unknown>[]>();
  const sessions = payload.sessions;
  if (typeof sessions !== "object" || sessions === null) {
    return map;
  }
  for (const [sessionId, rows] of Object.entries(sessions as Record<string, unknown>)) {
    if (!Array.isArray(rows)) {
      continue;
    }
    const normalizedRows: Record<string, unknown>[] = [];
    for (const row of rows) {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        continue;
      }
      normalizedRows.push({ ...(row as Record<string, unknown>) });
    }
    map.set(sessionId, normalizedRows);
  }
  return map;
}

function encodeMemoryStorePayload(sessions: Map<string, Record<string, unknown>[]>): MemoryStorePayload {
  const payload: MemoryStorePayload = {
    version: 1,
    sessions: {},
  };
  for (const [sessionId, rows] of sessions.entries()) {
    payload.sessions[sessionId] = rows.map((row) => ({ ...row }));
  }
  return payload;
}

interface BindConfig {
  host: string;
  port: number;
}

function parseBind(raw: string | undefined): BindConfig {
  const defaultBind: BindConfig = { host: "127.0.0.1", port: 8080 };
  if (!raw) {
    return defaultBind;
  }
  const trimmed = raw.trim();
  const idx = trimmed.lastIndexOf(":");
  if (idx <= 0 || idx >= trimmed.length - 1) {
    return defaultBind;
  }
  const host = trimmed.slice(0, idx);
  const port = Number(trimmed.slice(idx + 1));
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return defaultBind;
  }
  return {
    host,
    port,
  };
}

interface MCPRuntimeState {
  totalCalls: number;
  successCalls: number;
  failureCalls: number;
  retryCalls: number;
  recoveredCalls: number;
  policyDeniedCalls: number;
  gateRejectedCalls: number;
  timeoutFailures: number;
  transportFailures: number;
  toolFailures: number;
  unknownFailures: number;
  totalLatencyMs: number;
  maxLatencyMs: number;
  circuitOpenUntil: number;
  latencyMsSamples: number[];
  errorBuckets: Record<string, number>;
}

function createMcpRuntimeState(): MCPRuntimeState {
  return {
    totalCalls: 0,
    successCalls: 0,
    failureCalls: 0,
    retryCalls: 0,
    recoveredCalls: 0,
    policyDeniedCalls: 0,
    gateRejectedCalls: 0,
    timeoutFailures: 0,
    transportFailures: 0,
    toolFailures: 0,
    unknownFailures: 0,
    totalLatencyMs: 0,
    maxLatencyMs: 0,
    circuitOpenUntil: 0,
    latencyMsSamples: [],
    errorBuckets: {},
  };
}

function resetMcpRuntimeState(state: MCPRuntimeState): void {
  state.totalCalls = 0;
  state.successCalls = 0;
  state.failureCalls = 0;
  state.retryCalls = 0;
  state.recoveredCalls = 0;
  state.policyDeniedCalls = 0;
  state.gateRejectedCalls = 0;
  state.timeoutFailures = 0;
  state.transportFailures = 0;
  state.toolFailures = 0;
  state.unknownFailures = 0;
  state.totalLatencyMs = 0;
  state.maxLatencyMs = 0;
  state.circuitOpenUntil = 0;
  state.latencyMsSamples = [];
  state.errorBuckets = {};
}

function normalizeMcpServerName(name: string): string {
  return name.trim().toLowerCase();
}

function resetMcpServerStates(
  states: Map<string, MCPRuntimeState>,
  targetServer: string | undefined,
): number {
  if (typeof targetServer === "string" && targetServer.trim().length > 0) {
    const state = states.get(normalizeMcpServerName(targetServer));
    if (!state) {
      return 0;
    }
    resetMcpRuntimeState(state);
    return 1;
  }
  let resetCount = 0;
  for (const state of states.values()) {
    resetMcpRuntimeState(state);
    resetCount += 1;
  }
  return resetCount;
}

function normalizeLatencyMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Number(value.toFixed(3));
}

function latencyPercentile(values: number[], percentile: number): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].filter((item) => Number.isFinite(item) && item >= 0).sort((a, b) => a - b);
  if (!sorted.length) {
    return 0;
  }
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((percentile / 100) * sorted.length) - 1));
  return normalizeLatencyMs(sorted[idx]);
}

function aggregateMcpRuntimeSummary(
  states: Map<string, MCPRuntimeState>,
  serverNames?: string[],
): Record<string, unknown> {
  const keys = new Set(
    (serverNames ?? [])
      .map((name) => normalizeMcpServerName(name))
      .filter((name) => name.length > 0),
  );
  let serversConsidered = 0;
  let serversWithCircuitOpen = 0;
  let totalCalls = 0;
  let successCalls = 0;
  let failureCalls = 0;
  let retryCalls = 0;
  let recoveredCalls = 0;
  let policyDeniedCalls = 0;
  let gateRejectedCalls = 0;
  let timeoutFailures = 0;
  let transportFailures = 0;
  let toolFailures = 0;
  let unknownFailures = 0;
  let totalLatencyMs = 0;
  let maxLatencyMs = 0;
  const allSamples: number[] = [];
  const errorTotals: Record<string, number> = {};

  for (const [name, state] of states.entries()) {
    if (keys.size > 0 && !keys.has(name)) {
      continue;
    }
    serversConsidered += 1;
    totalCalls += state.totalCalls;
    successCalls += state.successCalls;
    failureCalls += state.failureCalls;
    retryCalls += state.retryCalls;
    recoveredCalls += state.recoveredCalls;
    policyDeniedCalls += state.policyDeniedCalls;
    gateRejectedCalls += state.gateRejectedCalls;
    timeoutFailures += state.timeoutFailures;
    transportFailures += state.transportFailures;
    toolFailures += state.toolFailures;
    unknownFailures += state.unknownFailures;
    totalLatencyMs += state.totalLatencyMs;
    maxLatencyMs = Math.max(maxLatencyMs, state.maxLatencyMs);
    allSamples.push(...state.latencyMsSamples);
    if (state.circuitOpenUntil > Date.now() / 1_000) {
      serversWithCircuitOpen += 1;
    }
    for (const [error, count] of Object.entries(state.errorBuckets)) {
      errorTotals[error] = (errorTotals[error] ?? 0) + count;
    }
  }

  const avgLatencyMs = totalCalls > 0 ? totalLatencyMs / totalCalls : 0;
  const topErrors = Object.entries(errorTotals)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([error, count]) => ({ error, count }));

  return {
    servers_considered: serversConsidered,
    servers_with_circuit_open: serversWithCircuitOpen,
    total_calls: totalCalls,
    success_calls: successCalls,
    failure_calls: failureCalls,
    retry_calls: retryCalls,
    recovered_calls: recoveredCalls,
    policy_denied_calls: policyDeniedCalls,
    gate_rejected_calls: gateRejectedCalls,
    timeout_failures: timeoutFailures,
    transport_failures: transportFailures,
    tool_failures: toolFailures,
    unknown_failures: unknownFailures,
    success_rate: totalCalls > 0 ? Number((successCalls / totalCalls).toFixed(4)) : 0,
    avg_latency_ms: normalizeLatencyMs(avgLatencyMs),
    p50_latency_ms: latencyPercentile(allSamples, 50),
    p95_latency_ms: latencyPercentile(allSamples, 95),
    max_latency_ms: normalizeLatencyMs(maxLatencyMs),
    latency_sample_count: allSamples.length,
    top_errors: topErrors,
  };
}

const CONFIG_READ_POLICY_AUTO = "auto";
const CONFIG_READ_POLICY_PUBLIC = "public";
const CONFIG_READ_POLICY_AUTH = "auth";
const CONFIG_READ_POLICY_DISABLED = "disabled";
const MEMORY_SCOPE_AUTO = "auto";
const MEMORY_SCOPE_USER = "user";
const MEMORY_SCOPE_GROUP = "group";
const MEMORY_SCOPE_ORG = "org";
const MEMORY_KIND_EPISODIC = "episodic";
const MEMORY_KIND_SEMANTIC = "semantic";
const MEMORY_KIND_PREFERENCE = "preference";
const MEMORY_KIND_POLICY = "policy";
const MEMORY_CLASSIFICATION_PUBLIC = "public";
const MEMORY_CLASSIFICATION_INTERNAL = "internal";
const MEMORY_CLASSIFICATION_RESTRICTED = "restricted";
const MEMORY_CLASSIFICATION_SECRET = "secret";
const MEMORY_STATE_ACTIVE = "active";
const MEMORY_STATE_ARCHIVED = "archived";
const MANAGEMENT_MEMORY_CURSOR_MAX = 200_000;
const MANAGEMENT_MEMORY_FETCH_MAX = 50_000;
const MANAGEMENT_MEMORY_IMPORT_MAX_BODY_BYTES = 1024 * 1024;
const MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT = 200;
const MANAGEMENT_MEMORY_BATCH_MAX_SESSIONS = 200;
const MEMORY_STORE_DEFAULT_REDIS_URL = "redis://127.0.0.1:6379/0";
const MEMORY_STORE_REDIS_TTL_SECS = 14 * 24 * 60 * 60;
const REDIS_IO_TIMEOUT_MS = 2_000;

type MemoryScope =
  | typeof MEMORY_SCOPE_AUTO
  | typeof MEMORY_SCOPE_USER
  | typeof MEMORY_SCOPE_GROUP
  | typeof MEMORY_SCOPE_ORG;

type MemoryKind =
  | typeof MEMORY_KIND_EPISODIC
  | typeof MEMORY_KIND_SEMANTIC
  | typeof MEMORY_KIND_PREFERENCE
  | typeof MEMORY_KIND_POLICY;

type MemoryClassification =
  | typeof MEMORY_CLASSIFICATION_PUBLIC
  | typeof MEMORY_CLASSIFICATION_INTERNAL
  | typeof MEMORY_CLASSIFICATION_RESTRICTED
  | typeof MEMORY_CLASSIFICATION_SECRET;

type MemoryState = typeof MEMORY_STATE_ACTIVE | typeof MEMORY_STATE_ARCHIVED;

type MemoryStoreBackend = "file" | "redis";

interface MemoryStoreRuntime {
  backend: MemoryStoreBackend;
  requestedBackend: MemoryStoreBackend;
  source: string;
  redisUrl?: string;
  fallbackReason?: string;
}

type ConfigReadPolicy =
  | typeof CONFIG_READ_POLICY_AUTO
  | typeof CONFIG_READ_POLICY_PUBLIC
  | typeof CONFIG_READ_POLICY_AUTH
  | typeof CONFIG_READ_POLICY_DISABLED;

interface ResolvedConfigReadPolicy {
  configuredPolicy: ConfigReadPolicy;
  configuredSource: string;
  effectivePolicy: Exclude<ConfigReadPolicy, "auto">;
  reason: string;
}

type QueryParams = Record<string, string[]>;

function parseQueryParams(rawUrl: string): QueryParams {
  const queryIndex = rawUrl.indexOf("?");
  if (queryIndex < 0 || queryIndex >= rawUrl.length - 1) {
    return {};
  }
  const rawQuery = rawUrl.slice(queryIndex + 1);
  const query: QueryParams = {};
  for (const pair of rawQuery.split("&")) {
    if (!pair) {
      continue;
    }
    const eqIndex = pair.indexOf("=");
    const rawKey = eqIndex >= 0 ? pair.slice(0, eqIndex) : pair;
    const rawValue = eqIndex >= 0 ? pair.slice(eqIndex + 1) : "";
    const decodeSafe = (value: string): string => {
      try {
        return decodeURIComponent(value.replace(/\+/g, " "));
      } catch {
        return value;
      }
    };
    const key = decodeSafe(rawKey).trim();
    const value = decodeSafe(rawValue).trim();
    if (!key) {
      continue;
    }
    const items = query[key] ?? [];
    items.push(value);
    query[key] = items;
  }
  return query;
}

function queryParamStr(query: QueryParams, key: string, defaultValue = ""): string {
  const values = query[key];
  if (Array.isArray(values) && values.length > 0) {
    const value = values[0];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return defaultValue;
}

function parseBoolValue(raw: string | undefined, defaultValue: boolean): boolean {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return defaultValue;
}

function queryParamBool(query: QueryParams, key: string, defaultValue: boolean): boolean {
  const values = query[key];
  if (Array.isArray(values) && values.length > 0) {
    return parseBoolValue(values[0], defaultValue);
  }
  return defaultValue;
}

function queryParamInt(
  query: QueryParams,
  key: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const values = query[key];
  if (Array.isArray(values) && values.length > 0) {
    const parsed = Number.parseInt(values[0], 10);
    if (Number.isFinite(parsed)) {
      return Math.max(minimum, Math.min(maximum, parsed));
    }
  }
  return Math.max(minimum, Math.min(maximum, defaultValue));
}

function queryParamCursor(
  query: QueryParams,
  key = "cursor",
  maximum = MANAGEMENT_MEMORY_CURSOR_MAX,
): {
  cursor: number;
  error?: string;
} {
  const raw = queryParamStr(query, key, "");
  if (!raw) {
    return { cursor: 0 };
  }
  if (!/^\d+$/.test(raw)) {
    return { cursor: 0, error: "invalid_cursor" };
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { cursor: 0, error: "invalid_cursor" };
  }
  if (parsed > Math.max(0, maximum)) {
    return { cursor: 0, error: "cursor_too_large" };
  }
  return { cursor: parsed };
}

const MEMORY_SCOPES: readonly MemoryScope[] = [
  MEMORY_SCOPE_AUTO,
  MEMORY_SCOPE_USER,
  MEMORY_SCOPE_GROUP,
  MEMORY_SCOPE_ORG,
];

const MEMORY_KINDS: readonly MemoryKind[] = [
  MEMORY_KIND_EPISODIC,
  MEMORY_KIND_SEMANTIC,
  MEMORY_KIND_PREFERENCE,
  MEMORY_KIND_POLICY,
];

const MEMORY_CLASSIFICATIONS: readonly MemoryClassification[] = [
  MEMORY_CLASSIFICATION_PUBLIC,
  MEMORY_CLASSIFICATION_INTERNAL,
  MEMORY_CLASSIFICATION_RESTRICTED,
  MEMORY_CLASSIFICATION_SECRET,
];

function normalizeMemoryScope(raw: string | undefined): MemoryScope | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (MEMORY_SCOPES.includes(normalized as MemoryScope)) {
    return normalized as MemoryScope;
  }
  return undefined;
}

function normalizeMemoryKind(raw: string | undefined): MemoryKind | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (MEMORY_KINDS.includes(normalized as MemoryKind)) {
    return normalized as MemoryKind;
  }
  return undefined;
}

function normalizeMemoryClassification(raw: string | undefined): MemoryClassification | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (MEMORY_CLASSIFICATIONS.includes(normalized as MemoryClassification)) {
    return normalized as MemoryClassification;
  }
  return undefined;
}

function normalizeMemoryState(raw: string | undefined): MemoryState | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === MEMORY_STATE_ACTIVE || normalized === MEMORY_STATE_ARCHIVED) {
    return normalized;
  }
  return undefined;
}

function parseBodyBool(raw: unknown, defaultValue: boolean): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "number") {
    if (raw === 1) {
      return true;
    }
    if (raw === 0) {
      return false;
    }
    return defaultValue;
  }
  if (typeof raw === "string") {
    return parseBoolValue(raw, defaultValue);
  }
  return defaultValue;
}

function parseJsonObjectBody(rawBody: string): {
  ok: true;
  body: Record<string, unknown>;
} | {
  ok: false;
  detail: string;
} {
  if (!rawBody.trim()) {
    return {
      ok: true,
      body: {},
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch (error) {
    return {
      ok: false,
      detail: `Invalid JSON body: ${String(error)}`,
    };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      detail: "JSON body must be an object",
    };
  }
  return {
    ok: true,
    body: parsed as Record<string, unknown>,
  };
}

function clampUnitNumber(raw: unknown, defaultValue: number): {
  value: number;
  valid: boolean;
} {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return {
      value: defaultValue,
      valid: false,
    };
  }
  if (raw < 0 || raw > 1) {
    return {
      value: defaultValue,
      valid: false,
    };
  }
  return {
    value: raw,
    valid: true,
  };
}

function memoryScopeMatches(recordScopeRaw: unknown, requestedScope: MemoryScope): boolean {
  if (requestedScope === MEMORY_SCOPE_AUTO) {
    return true;
  }
  const recordScope = normalizeMemoryScope(typeof recordScopeRaw === "string" ? recordScopeRaw : undefined);
  return recordScope === requestedScope;
}

function generateMemoryRecordId(): string {
  const nowPart = Date.now().toString(36);
  const randPart = Math.random().toString(36).slice(2, 10);
  return `mm_${nowPart}_${randPart}`;
}

function buildMemoryScopeRoot(sessionId: string, scope: MemoryScope): string {
  return `memory://session/${encodeURIComponent(sessionId)}/${scope}`;
}

function utf8ByteLength(value: string): number {
  return new Blob([value]).size;
}

function parseRuntimeHotCacheFromToml(rawToml: string): MemoryStoreBackend | undefined {
  const lines = rawToml.split(/\r?\n/);
  let inRuntimeStorageSection = false;
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      inRuntimeStorageSection = sectionMatch[1] === "runtime.storage";
      continue;
    }
    if (!inRuntimeStorageSection) {
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      continue;
    }
    const key = kvMatch[1];
    if (key !== "hot_cache") {
      continue;
    }
    const parsed = parseTomlString(kvMatch[2]);
    if (!parsed) {
      return undefined;
    }
    const normalized = parsed.trim().toLowerCase();
    if (normalized === "redis") {
      return "redis";
    }
    if (normalized === "file") {
      return "file";
    }
    return undefined;
  }
  return undefined;
}

function readRuntimeHotCacheFromProjectToml(projectTomlPath?: string): MemoryStoreBackend | undefined {
  if (!projectTomlPath || !fileReadable(projectTomlPath)) {
    return undefined;
  }
  try {
    const raw = readFileSync(projectTomlPath, "utf8");
    return parseRuntimeHotCacheFromToml(raw);
  } catch {
    return undefined;
  }
}

function normalizeMemoryStoreBackend(raw: string | undefined): MemoryStoreBackend | "auto" | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "file" || normalized === "redis" || normalized === "auto") {
    return normalized;
  }
  return undefined;
}

function resolveMemoryStoreRuntime(
  options: Record<string, OptionValue>,
  projectTomlPath: string | undefined,
): MemoryStoreRuntime {
  const fromCli = normalizeMemoryStoreBackend(
    readOptionString(options, "memory-store-backend") ?? readOptionString(options, "session-store"),
  );
  if (fromCli && fromCli !== "auto") {
    return {
      backend: fromCli,
      requestedBackend: fromCli,
      source: "cli",
      redisUrl: fromCli === "redis"
        ? (readOptionString(options, "redis-url") ??
          process.env.GROBOT_REDIS_URL ??
          MEMORY_STORE_DEFAULT_REDIS_URL)
        : undefined,
    };
  }

  const fromEnv = normalizeMemoryStoreBackend(process.env.GROBOT_SESSION_STORE);
  if (fromEnv && fromEnv !== "auto") {
    return {
      backend: fromEnv,
      requestedBackend: fromEnv,
      source: "env:GROBOT_SESSION_STORE",
      redisUrl: fromEnv === "redis" ? (process.env.GROBOT_REDIS_URL ?? MEMORY_STORE_DEFAULT_REDIS_URL) : undefined,
    };
  }

  const fromProject = readRuntimeHotCacheFromProjectToml(projectTomlPath);
  if (fromProject) {
    return {
      backend: fromProject,
      requestedBackend: fromProject,
      source: `project_toml:${projectTomlPath ?? ""}`,
      redisUrl: fromProject === "redis" ? (process.env.GROBOT_REDIS_URL ?? MEMORY_STORE_DEFAULT_REDIS_URL) : undefined,
    };
  }

  return {
    backend: "file",
    requestedBackend: "file",
    source: "default:file",
  };
}

function maskRedisUrl(redisUrl: string | undefined): string | undefined {
  if (!redisUrl || !redisUrl.includes("@")) {
    return redisUrl;
  }
  return redisUrl.replace(/^(redis(?:s)?:\/\/)([^@/]+)@/i, "$1<redacted>@");
}

interface ParsedRedisUrl {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
}

function redisParseUrl(redisUrl: string): ParsedRedisUrl {
  let parsed: URL;
  try {
    parsed = new URL(redisUrl);
  } catch (error) {
    throw new Error(`invalid redis url: ${String(error)}`);
  }
  if (parsed.protocol !== "redis:") {
    if (parsed.protocol === "rediss:") {
      throw new Error("rediss is not supported by ts-dev-cli yet");
    }
    throw new Error(`unsupported redis scheme: ${parsed.protocol.replace(/:$/, "")}`);
  }
  const host = parsed.hostname.trim();
  if (!host) {
    throw new Error("invalid redis url: host is required");
  }
  let port = 6379;
  if (parsed.port) {
    const parsedPort = Number.parseInt(parsed.port, 10);
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      throw new Error(`invalid redis port: ${parsed.port}`);
    }
    port = parsedPort;
  }
  let db = 0;
  const dbPath = parsed.pathname.trim();
  if (dbPath && dbPath !== "/") {
    const token = dbPath.replace(/^\//, "");
    if (!/^\d+$/.test(token)) {
      throw new Error(`invalid redis db index in url path: ${parsed.pathname}`);
    }
    db = Number.parseInt(token, 10);
  }
  if (db < 0) {
    throw new Error(`invalid redis db index in url path: ${parsed.pathname}`);
  }
  const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  return {
    host,
    port,
    username,
    password,
    db,
  };
}

function redisEncodeCommand(parts: string[]): Buffer {
  const chunks: Buffer[] = [];
  chunks.push(Buffer.from(`*${String(parts.length)}\r\n`, "utf8"));
  for (const part of parts) {
    const text = String(part);
    const data = Buffer.from(text, "utf8");
    chunks.push(Buffer.from(`$${String(data.length)}\r\n`, "utf8"));
    chunks.push(data);
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  return Buffer.concat(chunks);
}

interface RespParseSuccess {
  value: unknown;
  nextOffset: number;
}

function findRespCrlf(buffer: Buffer, start: number): number {
  for (let index = start; index + 1 < buffer.length; index += 1) {
    if (buffer[index] === 13 && buffer[index + 1] === 10) {
      return index;
    }
  }
  return -1;
}

function tryParseResp(buffer: Buffer, offset = 0): RespParseSuccess | undefined {
  if (offset >= buffer.length) {
    return undefined;
  }
  const marker = String.fromCharCode(buffer[offset] ?? 0);
  const lineEnd = findRespCrlf(buffer, offset + 1);
  if (lineEnd < 0) {
    return undefined;
  }
  const line = buffer.toString("utf8", offset + 1, lineEnd);
  const afterLine = lineEnd + 2;

  if (marker === "+") {
    return {
      value: line,
      nextOffset: afterLine,
    };
  }
  if (marker === "-") {
    throw new Error(`redis error reply: ${line}`);
  }
  if (marker === ":") {
    return {
      value: Number.parseInt(line, 10),
      nextOffset: afterLine,
    };
  }
  if (marker === "$") {
    const bulkLen = Number.parseInt(line, 10);
    if (!Number.isFinite(bulkLen)) {
      throw new Error(`invalid redis bulk length: ${line}`);
    }
    if (bulkLen < 0) {
      return {
        value: null,
        nextOffset: afterLine,
      };
    }
    const payloadStart = afterLine;
    const payloadEnd = payloadStart + bulkLen;
    if (payloadEnd + 2 > buffer.length) {
      return undefined;
    }
    if (buffer[payloadEnd] !== 13 || buffer[payloadEnd + 1] !== 10) {
      throw new Error("invalid redis bulk terminator");
    }
    return {
      value: buffer.toString("utf8", payloadStart, payloadEnd),
      nextOffset: payloadEnd + 2,
    };
  }
  if (marker === "*") {
    const count = Number.parseInt(line, 10);
    if (!Number.isFinite(count)) {
      throw new Error(`invalid redis array length: ${line}`);
    }
    if (count < 0) {
      return {
        value: null,
        nextOffset: afterLine,
      };
    }
    const values: unknown[] = [];
    let cursor = afterLine;
    for (let idx = 0; idx < count; idx += 1) {
      const parsed = tryParseResp(buffer, cursor);
      if (!parsed) {
        return undefined;
      }
      values.push(parsed.value);
      cursor = parsed.nextOffset;
    }
    return {
      value: values,
      nextOffset: cursor,
    };
  }
  throw new Error(`unsupported redis reply marker: ${marker}`);
}

async function redisExecute(redisUrl: string, parts: string[]): Promise<unknown> {
  const parsed = redisParseUrl(redisUrl);
  const commands: string[][] = [];
  if (parsed.password) {
    if (parsed.username) {
      commands.push(["AUTH", parsed.username, parsed.password]);
    } else {
      commands.push(["AUTH", parsed.password]);
    }
  }
  if (parsed.db > 0) {
    commands.push(["SELECT", String(parsed.db)]);
  }
  commands.push(parts);

  return await new Promise<unknown>((resolve, reject) => {
    const socket = createConnection({ host: parsed.host, port: parsed.port });
    let settled = false;
    let buffer = Buffer.alloc(0);
    const expectedReplies = commands.length;
    let receivedReplies = 0;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      reject(new Error(`redis timeout after ${String(REDIS_IO_TIMEOUT_MS)}ms`));
    }, REDIS_IO_TIMEOUT_MS);

    const finishResolve = (value: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.end();
      resolve(value);
    };

    const finishReject = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    socket.on("connect", () => {
      try {
        for (const command of commands) {
          socket.write(redisEncodeCommand(command));
        }
      } catch (error) {
        finishReject(error);
      }
    });

    socket.on("data", (chunk) => {
      try {
        const nextChunk = Buffer.from(chunk);
        buffer = Buffer.concat([buffer, nextChunk]);
        while (true) {
          const parsedReply = tryParseResp(buffer, 0);
          if (!parsedReply) {
            break;
          }
          buffer = buffer.subarray(parsedReply.nextOffset);
          receivedReplies += 1;
          if (receivedReplies >= expectedReplies) {
            finishResolve(parsedReply.value);
            return;
          }
        }
      } catch (error) {
        finishReject(error);
      }
    });

    socket.on("error", (error) => {
      finishReject(error);
    });

    socket.on("close", () => {
      if (!settled && receivedReplies < expectedReplies) {
        finishReject(new Error("redis connection closed before full reply"));
      }
    });
  });
}

async function redisGetJson(redisUrl: string, key: string): Promise<Record<string, unknown> | undefined> {
  const reply = await redisExecute(redisUrl, ["GET", key]);
  if (reply === null || reply === undefined) {
    return undefined;
  }
  if (typeof reply !== "string") {
    throw new Error("redis GET returned non-string payload");
  }
  const content = reply.trim();
  if (!content) {
    return undefined;
  }
  const parsed = JSON.parse(content) as unknown;
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("redis payload is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

async function redisSetJson(
  redisUrl: string,
  key: string,
  payload: Record<string, unknown>,
  ttlSecs: number,
): Promise<void> {
  const content = JSON.stringify(payload);
  await redisExecute(redisUrl, ["SET", key, content, "EX", String(ttlSecs)]);
}

function tokenizeQuery(value: string): string[] {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function memoryMatchesQuery(text: string, queryTokens: string[]): boolean {
  if (!queryTokens.length) {
    return true;
  }
  const lowered = text.toLowerCase();
  for (const token of queryTokens) {
    if (!lowered.includes(token)) {
      return false;
    }
  }
  return true;
}

function memoryClassificationVisible(
  classification: MemoryClassification,
  includeRestricted: boolean,
  includeSecret: boolean,
): boolean {
  if (classification === MEMORY_CLASSIFICATION_SECRET) {
    return includeSecret;
  }
  if (classification === MEMORY_CLASSIFICATION_RESTRICTED) {
    return includeRestricted || includeSecret;
  }
  return true;
}

function normalizeConfigReadPolicy(raw: string | undefined): ConfigReadPolicy | undefined {
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === CONFIG_READ_POLICY_AUTO ||
    normalized === CONFIG_READ_POLICY_PUBLIC ||
    normalized === CONFIG_READ_POLICY_AUTH ||
    normalized === CONFIG_READ_POLICY_DISABLED
  ) {
    return normalized;
  }
  return undefined;
}

function resolveConfiguredConfigReadPolicy(
  options: Record<string, OptionValue>,
  configTomlPath?: string,
): {
  policy: ConfigReadPolicy;
  source: string;
} {
  const fromCli = normalizeConfigReadPolicy(readOptionString(options, "config-read-policy"));
  if (fromCli) {
    return { policy: fromCli, source: "cli" };
  }
  const fromEnv = normalizeConfigReadPolicy(process.env.GROBOT_CONFIG_READ_POLICY);
  if (fromEnv) {
    return { policy: fromEnv, source: "env:GROBOT_CONFIG_READ_POLICY" };
  }
  const fromConfig = readConfigReadPolicyFromToml(configTomlPath);
  if (fromConfig) {
    return {
      policy: fromConfig.policy,
      source: fromConfig.source,
    };
  }
  return {
    policy: CONFIG_READ_POLICY_AUTO,
    source: "default",
  };
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }
  if (normalized.startsWith("::ffff:127.")) {
    return true;
  }
  return false;
}

function resolveEffectiveConfigReadPolicy(
  configuredPolicy: ConfigReadPolicy,
  bindHost: string,
): {
  effectivePolicy: Exclude<ConfigReadPolicy, "auto">;
  reason: string;
} {
  if (configuredPolicy === CONFIG_READ_POLICY_PUBLIC) {
    return {
      effectivePolicy: CONFIG_READ_POLICY_PUBLIC,
      reason: "configured_public",
    };
  }
  if (configuredPolicy === CONFIG_READ_POLICY_AUTH) {
    return {
      effectivePolicy: CONFIG_READ_POLICY_AUTH,
      reason: "configured_auth",
    };
  }
  if (configuredPolicy === CONFIG_READ_POLICY_DISABLED) {
    return {
      effectivePolicy: CONFIG_READ_POLICY_DISABLED,
      reason: "configured_disabled",
    };
  }
  if (isLoopbackHost(bindHost)) {
    return {
      effectivePolicy: CONFIG_READ_POLICY_PUBLIC,
      reason: "auto_loopback_public",
    };
  }
  return {
    effectivePolicy: CONFIG_READ_POLICY_AUTH,
    reason: "auto_non_loopback_auth",
  };
}

function parseManagementConfigReadPolicy(rawToml: string): string | undefined {
  const lines = rawToml.split(/\r?\n/);
  let inManagementSection = false;
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      inManagementSection = sectionMatch[1] === "management";
      continue;
    }
    if (!inManagementSection) {
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      continue;
    }
    const key = kvMatch[1];
    if (key !== "config_read_policy") {
      continue;
    }
    return parseTomlString(kvMatch[2]);
  }
  return undefined;
}

function readConfigReadPolicyFromToml(configTomlPath?: string): { policy: ConfigReadPolicy; source: string } | undefined {
  if (!configTomlPath || !fileReadable(configTomlPath)) {
    return undefined;
  }
  try {
    const raw = readFileSync(configTomlPath, "utf8");
    const parsed = normalizeConfigReadPolicy(parseManagementConfigReadPolicy(raw));
    if (!parsed) {
      return undefined;
    }
    return {
      policy: parsed,
      source: `config_toml:${configTomlPath}`,
    };
  } catch {
    return undefined;
  }
}

function resolveConfigReadPolicy(
  options: Record<string, OptionValue>,
  bindHost: string,
  configTomlPath?: string,
): ResolvedConfigReadPolicy {
  const configured = resolveConfiguredConfigReadPolicy(options, configTomlPath);
  const effective = resolveEffectiveConfigReadPolicy(configured.policy, bindHost);
  return {
    configuredPolicy: configured.policy,
    configuredSource: configured.source,
    effectivePolicy: effective.effectivePolicy,
    reason: effective.reason,
  };
}

function writeJson(response: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  const bodyBytes = utf8ByteLength(body);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Content-Length", String(bodyBytes));
  response.end(body);
}

function readHeaderValue(headers: IncomingMessage["headers"], key: string): string | undefined {
  const value = headers[key];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === "string") {
      return first;
    }
  }
  return undefined;
}

function parseBearerToken(headers: IncomingMessage["headers"]): string | undefined {
  const auth = readHeaderValue(headers, "authorization");
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const xToken = readHeaderValue(headers, "x-grobot-token");
  if (typeof xToken === "string" && xToken.trim().length > 0) {
    return xToken.trim();
  }
  return undefined;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += String(chunk);
    });
    request.on("end", () => {
      resolve(raw);
    });
  });
}

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  const remain = value.length - limit;
  return `${value.slice(0, limit)}\n...<truncated ${remain} chars>`;
}

function maskSensitiveText(raw: string): string {
  const maskedLines = raw.split(/\r?\n/).map((line) => {
    const kvMasked = line.replace(
      /^(\s*[A-Za-z0-9_.-]*?(?:api[_-]?key|token|secret|password|authorization|access[_-]?token|refresh[_-]?token)[A-Za-z0-9_.-]*\s*=\s*).+$/i,
      '$1"<redacted>"',
    );
    return kvMasked
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, "Bearer <redacted>")
      .replace(/\b(?:sk|gsk|rk|pk)-[A-Za-z0-9]{10,}\b/g, "<redacted>");
  });
  return maskedLines.join("\n");
}

function readMaskedFile(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  if (!fileReadable(path)) {
    return undefined;
  }
  try {
    const raw = readFileSync(path, "utf8");
    return truncateText(maskSensitiveText(raw), 20_000);
  } catch {
    return undefined;
  }
}

function resolveRuntimeBinaryPath(): string {
  const envPath = process.env.GROBOT_RUNTIME_BIN;
  if (typeof envPath === "string" && envPath.trim().length > 0) {
    return envPath.trim();
  }
  const repoRoot = process.env.GROBOT_TS_DEV_REPO_ROOT;
  if (typeof repoRoot === "string" && repoRoot.trim().length > 0) {
    return `${removeTrailingSlashes(repoRoot)}/runtime/target/debug/grobot-runtime`;
  }
  return `${process.cwd()}/runtime/target/debug/grobot-runtime`;
}

function runRuntimeHealthcheck(runtimeBinaryPath: string): {
  ok: boolean;
  detail: string;
} {
  const input = JSON.stringify({
    jsonrpc: "2.0",
    id: "health-1",
    method: "runtime.health",
    params: {},
  });
  const run = spawnSync(runtimeBinaryPath, [], {
    input: `${input}\n`,
    encoding: "utf8",
    timeout: 4_000,
    maxBuffer: 1_048_576,
  });
  if (run.error) {
    return { ok: false, detail: `spawn_failed: ${String(run.error)}` };
  }
  if (run.status !== 0) {
    return {
      ok: false,
      detail: `exit_status_${String(run.status)} stderr=${String(run.stderr || "").trim()}`,
    };
  }
  const firstLine = String(run.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return { ok: false, detail: "empty_stdout" };
  }
  try {
    const payload = JSON.parse(firstLine) as unknown;
    if (typeof payload !== "object" || payload === null) {
      return { ok: false, detail: "invalid_json_payload" };
    }
    const record = payload as Record<string, unknown>;
    const result = record.result;
    if (typeof result !== "object" || result === null) {
      return { ok: false, detail: "missing_result" };
    }
    const status = (result as Record<string, unknown>).status;
    if (status !== "ok") {
      return { ok: false, detail: `runtime_status=${String(status)}` };
    }
    return { ok: true, detail: "runtime.health=ok" };
  } catch (error) {
    return { ok: false, detail: `json_parse_failed: ${String(error)}` };
  }
}

async function runStatus(options: Record<string, OptionValue>): Promise<number> {
  const workDir = resolveWorkDir(options);
  const projectTomlPath = resolveProjectTomlPath(options, workDir);
  const executionPlane = resolveExecutionPlaneConfig({
    gatewayImplArg: readOptionString(options, "gateway-impl"),
    runtimeImplArg: readOptionString(options, "runtime-impl"),
    shadowModeArg: hasFlag(options, "shadow-mode"),
    noShadowModeArg: hasFlag(options, "no-shadow-mode"),
    projectTomlPath,
  });

  process.stdout.write("status: ok\n");
  process.stdout.write("engine: ts-dev-cli\n");
  process.stdout.write(`work_dir: ${workDir}\n`);
  process.stdout.write(`project_toml: ${projectTomlPath ?? "<not-found>"}\n`);
  process.stdout.write(
    `execution: gateway=${executionPlane.gatewayImpl}(${executionPlane.gatewayImplSource}) runtime=${executionPlane.runtimeImpl}(${executionPlane.runtimeImplSource}) shadow=${executionPlane.shadowMode ? "on" : "off"}(${executionPlane.shadowModeSource})\n`,
  );

  if (executionPlane.runtimeImpl === "rust") {
    const runtimeBinaryPath = resolveRuntimeBinaryPath();
    const health = runRuntimeHealthcheck(runtimeBinaryPath);
    process.stdout.write(
      `runtime_health: ${health.ok ? "ok" : "warn"} (${runtimeBinaryPath}) ${health.detail}\n`,
    );
  }
  return 0;
}

async function runStart(options: Record<string, OptionValue>): Promise<number> {
  const message = readOptionString(options, "message");
  if (!message) {
    process.stderr.write("error: start requires --message in ts-dev-cli mode\n");
    return 2;
  }

  const workDir = resolveWorkDir(options);
  const projectTomlPath = resolveProjectTomlPath(options, workDir);
  const projectName = readOptionString(options, "project") ?? basenameFromPath(workDir);
  const subject = readOptionString(options, "subject") ?? process.env.USER ?? "user";
  const executionPlane = resolveExecutionPlaneConfig({
    gatewayImplArg: readOptionString(options, "gateway-impl"),
    runtimeImplArg: readOptionString(options, "runtime-impl"),
    shadowModeArg: hasFlag(options, "shadow-mode"),
    noShadowModeArg: hasFlag(options, "no-shadow-mode"),
    projectTomlPath,
  });

  const session = {
    platform: parsePlatform(readOptionString(options, "platform")),
    tenant: readOptionString(options, "tenant") ?? projectName,
    scope: parseScope(readOptionString(options, "scope")),
    subject,
  } as const;
  const sessionKey = buildSessionKey(session);
  if (consumeInterruptFlag(sessionKey)) {
    process.stdout.write("Session interrupted by management API. Current request skipped.\n");
    return 0;
  }

  const report = await runGatewayTurn(
    message,
    session,
    {
      actorId: process.env.USER ?? subject,
      projectId: projectName,
    },
    {
      gatewayImpl: executionPlane.gatewayImpl,
      runtimeImpl: executionPlane.runtimeImpl,
      shadowMode: executionPlane.shadowMode,
    },
  );

  process.stdout.write(`${report.assistantMessage}\n`);
  process.stderr.write(
    `[execution] gateway=${executionPlane.gatewayImpl}(${executionPlane.gatewayImplSource}) runtime=${executionPlane.runtimeImpl}(${executionPlane.runtimeImplSource}) shadow=${executionPlane.shadowMode ? "on" : "off"}(${executionPlane.shadowModeSource})\n`,
  );
  process.stderr.write(
    `[governance] plane=${report.governance.plane} decision=${report.governance.decision} score=${report.governance.score.toFixed(4)} gate=${report.governance.gatePassed ? "pass" : "fail"} action=${report.governance.suggestedAction}\n`,
  );
  return report.verification.pass ? 0 : 1;
}

async function runServe(options: Record<string, OptionValue>): Promise<number> {
  const workDir = resolveWorkDir(options);
  const projectTomlPath = resolveProjectTomlPath(options, workDir);
  let configTomlPath = resolveConfigTomlPath(options);
  const bind = parseBind(readOptionString(options, "bind"));
  const projectName = readOptionString(options, "project") ?? basenameFromPath(workDir);
  const managementToken =
    readOptionString(options, "management-token") ?? process.env.GROBOT_MANAGEMENT_TOKEN;
  const executionPlaneInput = {
    gatewayImplArg: readOptionString(options, "gateway-impl"),
    runtimeImplArg: readOptionString(options, "runtime-impl"),
    shadowModeArg: hasFlag(options, "shadow-mode"),
    noShadowModeArg: hasFlag(options, "no-shadow-mode"),
    projectTomlPath,
  };
  let executionPlane = resolveExecutionPlaneConfig(executionPlaneInput);
  let reloadCount = 0;
  let configReadPolicy = resolveConfigReadPolicy(options, bind.host, configTomlPath);
  const mcpSessions = new Set<string>();
  const mcpServerStates = new Map<string, MCPRuntimeState>();
  let memoryStoreRuntime = resolveMemoryStoreRuntime(options, projectTomlPath);
  const memoryStorePath = resolveMemoryStorePath();
  const memoryStoreKey = memoryStoreRedisKey(projectName, workDir);
  const loadMemoryStoreRuntimeState = async (
    runtimeInput: MemoryStoreRuntime,
  ): Promise<{
    runtime: MemoryStoreRuntime;
    store: Map<string, Record<string, unknown>[]>;
  }> => {
    if (runtimeInput.backend === "redis" && runtimeInput.redisUrl) {
      try {
        const payload = await redisGetJson(runtimeInput.redisUrl, memoryStoreKey);
        return {
          runtime: runtimeInput,
          store: payload ? decodeMemoryStorePayload(payload) : new Map<string, Record<string, unknown>[]>(),
        };
      } catch (error) {
        return {
          runtime: {
            ...runtimeInput,
            backend: "file",
            fallbackReason: `redis bootstrap failed, fallback to file: ${String(error)}`,
          },
          store: loadMemoryStore(memoryStorePath),
        };
      }
    }
    return {
      runtime: runtimeInput,
      store: loadMemoryStore(memoryStorePath),
    };
  };

  const initialMemoryState = await loadMemoryStoreRuntimeState(memoryStoreRuntime);
  memoryStoreRuntime = initialMemoryState.runtime;
  const memoryRecordsBySession = initialMemoryState.store;

  const replaceMemoryRecordsBySession = (nextStore: Map<string, Record<string, unknown>[]>): void => {
    memoryRecordsBySession.clear();
    for (const [sessionId, rows] of nextStore.entries()) {
      memoryRecordsBySession.set(
        sessionId,
        rows.map((row) => ({ ...row })),
      );
    }
  };
  const persistMemoryStore = async (): Promise<void> => {
    if (memoryStoreRuntime.backend === "redis" && memoryStoreRuntime.redisUrl) {
      await redisSetJson(
        memoryStoreRuntime.redisUrl,
        memoryStoreKey,
        encodeMemoryStorePayload(memoryRecordsBySession) as unknown as Record<string, unknown>,
        MEMORY_STORE_REDIS_TTL_SECS,
      );
      return;
    }
    saveMemoryStore(memoryStorePath, memoryRecordsBySession);
  };

  const listMemoryRows = (
    sessionId: string,
    options: {
      includeArchived: boolean;
      includeRestricted: boolean;
      includeSecret: boolean;
      kindFilter?: MemoryKind;
      classificationFilter?: MemoryClassification;
      queryText?: string;
    },
  ): Record<string, unknown>[] => {
    const includeArchived = options.includeArchived;
    const includeRestricted = options.includeRestricted;
    const includeSecret = options.includeSecret;
    const kindFilter = options.kindFilter;
    const classificationFilter = options.classificationFilter;
    const queryText = options.queryText ?? "";
    const records = memoryRecordsBySession.get(sessionId);
    if (!Array.isArray(records) || records.length === 0) {
      return [];
    }
    const queryTokens = tokenizeQuery(queryText);
    const rows: Record<string, unknown>[] = [];
    for (const record of records) {
      if (typeof record !== "object" || record === null) {
        continue;
      }
      const rawText = String(record.text ?? "").trim();
      if (!rawText) {
        continue;
      }
      const state = String(record.state ?? "active").toLowerCase();
      if (!includeArchived && state === MEMORY_STATE_ARCHIVED) {
        continue;
      }
      const classification =
        normalizeMemoryClassification(String(record.classification ?? MEMORY_CLASSIFICATION_INTERNAL)) ??
        MEMORY_CLASSIFICATION_INTERNAL;
      if (!memoryClassificationVisible(classification, includeRestricted, includeSecret)) {
        continue;
      }
      if (classificationFilter && classification !== classificationFilter) {
        continue;
      }
      const kind = normalizeMemoryKind(String(record.kind ?? MEMORY_KIND_EPISODIC)) ?? MEMORY_KIND_EPISODIC;
      if (kindFilter && kind !== kindFilter) {
        continue;
      }
      if (!memoryMatchesQuery(rawText, queryTokens)) {
        continue;
      }
      rows.push({
        ...record,
        text: rawText,
        state,
        kind,
        classification,
      });
    }
    return rows;
  };

  const importMemoryRows = (
    sessionId: string,
    scope: MemoryScope,
    rawRecords: unknown,
    source: string | undefined,
    dryRun: boolean,
  ): {
    ok: boolean;
    result: Record<string, unknown>;
  } => {
    if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
      return {
        ok: false,
        result: {
          error: "records is required",
        },
      };
    }

    const accepted = rawRecords.slice(0, MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT);
    const truncatedCount = Math.max(0, rawRecords.length - accepted.length);
    const invalidRows: Array<Record<string, unknown>> = [];
    const normalizedRows: Array<Record<string, unknown>> = [];
    const scopeRoot = buildMemoryScopeRoot(sessionId, scope);

    for (let idx = 0; idx < accepted.length; idx += 1) {
      const rawRow = accepted[idx];
      if (typeof rawRow !== "object" || rawRow === null || Array.isArray(rawRow)) {
        invalidRows.push({
          index: idx,
          errors: [
            {
              field: "row",
              reason: "must be object",
            },
          ],
        });
        continue;
      }
      const row = rawRow as Record<string, unknown>;
      const rowErrors: Array<Record<string, string>> = [];

      const text = typeof row.text === "string" ? row.text.trim() : "";
      if (!text) {
        rowErrors.push({
          field: "text",
          reason: "must be non-empty string",
        });
      }

      let kind: MemoryKind = MEMORY_KIND_EPISODIC;
      if (row.kind !== undefined) {
        if (typeof row.kind !== "string") {
          rowErrors.push({
            field: "kind",
            reason: "must be string",
          });
        } else {
          const parsedKind = normalizeMemoryKind(row.kind);
          if (!parsedKind) {
            rowErrors.push({
              field: "kind",
              reason: `must be one of ${MEMORY_KINDS.join(",")}`,
            });
          } else {
            kind = parsedKind;
          }
        }
      }

      let classification: MemoryClassification = MEMORY_CLASSIFICATION_INTERNAL;
      if (row.classification !== undefined) {
        if (typeof row.classification !== "string") {
          rowErrors.push({
            field: "classification",
            reason: "must be string",
          });
        } else {
          const parsedClassification = normalizeMemoryClassification(row.classification);
          if (!parsedClassification) {
            rowErrors.push({
              field: "classification",
              reason: `must be one of ${MEMORY_CLASSIFICATIONS.join(",")}`,
            });
          } else {
            classification = parsedClassification;
          }
        }
      }

      let state: MemoryState = MEMORY_STATE_ACTIVE;
      if (row.state !== undefined) {
        if (typeof row.state !== "string") {
          rowErrors.push({
            field: "state",
            reason: "must be string",
          });
        } else {
          const parsedState = normalizeMemoryState(row.state);
          if (!parsedState) {
            rowErrors.push({
              field: "state",
              reason: `must be one of ${MEMORY_STATE_ACTIVE},${MEMORY_STATE_ARCHIVED}`,
            });
          } else {
            state = parsedState;
          }
        }
      }

      const importanceParsed = clampUnitNumber(row.importance, 0.6);
      if (row.importance !== undefined && !importanceParsed.valid) {
        rowErrors.push({
          field: "importance",
          reason: "must be number in range [0,1]",
        });
      }
      const confidenceParsed = clampUnitNumber(row.confidence, 0.6);
      if (row.confidence !== undefined && !confidenceParsed.valid) {
        rowErrors.push({
          field: "confidence",
          reason: "must be number in range [0,1]",
        });
      }

      const tags: string[] = [];
      if (row.tags !== undefined) {
        if (!Array.isArray(row.tags)) {
          rowErrors.push({
            field: "tags",
            reason: "must be array of strings",
          });
        } else {
          for (let tagIdx = 0; tagIdx < row.tags.length; tagIdx += 1) {
            const item = row.tags[tagIdx];
            if (typeof item !== "string") {
              rowErrors.push({
                field: `tags[${String(tagIdx)}]`,
                reason: "must be string",
              });
              continue;
            }
            const cleanedTag = item.trim();
            if (cleanedTag && !tags.includes(cleanedTag)) {
              tags.push(cleanedTag);
            }
          }
        }
      }

      let recordId = "";
      if (row.id !== undefined) {
        if (typeof row.id !== "string") {
          rowErrors.push({
            field: "id",
            reason: "must be string",
          });
        } else {
          const cleanedId = row.id.trim();
          if (!cleanedId) {
            rowErrors.push({
              field: "id",
              reason: "must be non-empty string",
            });
          } else {
            recordId = cleanedId;
          }
        }
      }

      let normalizedSource = source?.trim() || "memory:management_import";
      if (row.source !== undefined) {
        if (typeof row.source !== "string") {
          rowErrors.push({
            field: "source",
            reason: "must be string",
          });
        } else {
          const cleanedSource = row.source.trim();
          if (!cleanedSource) {
            rowErrors.push({
              field: "source",
              reason: "must be non-empty string",
            });
          } else {
            normalizedSource = cleanedSource;
          }
        }
      }

      if (rowErrors.length > 0) {
        invalidRows.push({
          index: idx,
          errors: rowErrors,
        });
        continue;
      }

      normalizedRows.push({
        id: recordId || generateMemoryRecordId(),
        kind,
        text,
        classification,
        state,
        tags,
        source: normalizedSource,
        importance: importanceParsed.value,
        confidence: confidenceParsed.value,
        scope,
      });
    }

    if (invalidRows.length > 0) {
      return {
        ok: false,
        result: {
          error: "invalid_record_schema",
          scope,
          scope_root: scopeRoot,
          dry_run: dryRun,
          accepted_count: accepted.length,
          truncated_count: truncatedCount,
          invalid_count: invalidRows.length,
          invalid_rows: invalidRows.slice(0, 64),
        },
      };
    }

    const importedIds: string[] = [];
    const archivedOnImportIds: string[] = [];
    if (!dryRun) {
      const store = memoryRecordsBySession.get(sessionId) ?? [];
      for (const row of normalizedRows) {
        const rowId = String(row.id ?? "");
        const nowIso = new Date().toISOString();
        const nextRecord: Record<string, unknown> = {
          version: 1,
          id: rowId,
          kind: row.kind,
          scope,
          text: row.text,
          summary: String(row.text ?? "").slice(0, 140),
          tags: row.tags,
          source: row.source,
          session_key: sessionId,
          classification: row.classification,
          importance: row.importance,
          confidence: row.confidence,
          state: row.state,
          updated_at: nowIso,
        };
        if (row.state === MEMORY_STATE_ARCHIVED) {
          nextRecord.archived_at = nowIso;
          nextRecord.imported_archived = true;
        } else {
          nextRecord.archived_at = "";
        }
        const existingIndex = store.findIndex((record) => String(record.id ?? "") === rowId);
        if (existingIndex >= 0) {
          const existing = store[existingIndex];
          if (typeof existing.created_at === "string" && existing.created_at.trim().length > 0) {
            nextRecord.created_at = existing.created_at;
          } else {
            nextRecord.created_at = nowIso;
          }
          store[existingIndex] = nextRecord;
        } else {
          nextRecord.created_at = nowIso;
          store.push(nextRecord);
        }
        importedIds.push(rowId);
        if (row.state === MEMORY_STATE_ARCHIVED) {
          archivedOnImportIds.push(rowId);
        }
      }
      memoryRecordsBySession.set(sessionId, store);
    } else {
      for (const row of normalizedRows) {
        const rowId = String(row.id ?? "");
        importedIds.push(rowId);
        if (row.state === MEMORY_STATE_ARCHIVED) {
          archivedOnImportIds.push(rowId);
        }
      }
    }

    return {
      ok: true,
      result: {
        scope,
        scope_root: scopeRoot,
        dry_run: dryRun,
        accepted_count: accepted.length,
        truncated_count: truncatedCount,
        imported_count: importedIds.length,
        archived_on_import_count: archivedOnImportIds.length,
        invalid_count: 0,
        imported_ids: importedIds.slice(0, 64),
        archived_on_import_ids: archivedOnImportIds.slice(0, 64),
        invalid_rows: [],
      },
    };
  };

  const forgetMemoryRows = (
    sessionId: string,
    scope: MemoryScope,
    ids: string[],
    reason: string | undefined,
    dryRun: boolean,
  ): {
    ok: boolean;
    result: Record<string, unknown>;
  } => {
    const normalizedIds = ids
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .filter((item, index, arr) => arr.indexOf(item) === index);
    if (!normalizedIds.length) {
      return {
        ok: false,
        result: {
          error: "record_ids is required",
        },
      };
    }

    const targetIds = normalizedIds.slice(0, MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT);
    const truncatedCount = Math.max(0, normalizedIds.length - targetIds.length);
    const store = memoryRecordsBySession.get(sessionId) ?? [];
    const forgottenIds: string[] = [];
    const alreadyArchivedIds: string[] = [];
    const notFoundIds: string[] = [];

    for (const recordId of targetIds) {
      const locatedIndex = store.findIndex((record) => {
        if (String(record.id ?? "") !== recordId) {
          return false;
        }
        return memoryScopeMatches(record.scope, scope);
      });
      if (locatedIndex < 0) {
        notFoundIds.push(recordId);
        continue;
      }
      const located = store[locatedIndex];
      const currentState = normalizeMemoryState(String(located.state ?? MEMORY_STATE_ACTIVE)) ?? MEMORY_STATE_ACTIVE;
      if (currentState === MEMORY_STATE_ARCHIVED) {
        alreadyArchivedIds.push(recordId);
        continue;
      }
      forgottenIds.push(recordId);
      if (!dryRun) {
        const nowIso = new Date().toISOString();
        store[locatedIndex] = {
          ...located,
          state: MEMORY_STATE_ARCHIVED,
          archived_at: nowIso,
          forgotten_by: "management",
          forget_reason: reason ?? "",
          updated_at: nowIso,
        };
      }
    }
    if (!dryRun) {
      memoryRecordsBySession.set(sessionId, store);
    }

    return {
      ok: true,
      result: {
        requested_count: targetIds.length,
        truncated_count: truncatedCount,
        forgotten_count: forgottenIds.length,
        already_archived_count: alreadyArchivedIds.length,
        not_found_count: notFoundIds.length,
        forgotten_ids: forgottenIds,
        already_archived_ids: alreadyArchivedIds,
        not_found_ids: notFoundIds,
        dry_run: dryRun,
      },
    };
  };

  const runMemoryLifecycle = (
    sessionId: string,
    scope: MemoryScope,
    dryRun: boolean,
  ): {
    ok: boolean;
    lines: string[];
  } => {
    const store = memoryRecordsBySession.get(sessionId) ?? [];
    let scanned = 0;
    let changed = 0;
    let promoteCount = 0;
    let decayCount = 0;
    let archiveCount = 0;
    const rowsPreview: string[] = [];

    for (let index = 0; index < store.length; index += 1) {
      if (changed >= MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT) {
        break;
      }
      const record = store[index];
      if (!memoryScopeMatches(record.scope, scope)) {
        continue;
      }
      const state = normalizeMemoryState(String(record.state ?? MEMORY_STATE_ACTIVE)) ?? MEMORY_STATE_ACTIVE;
      if (state === MEMORY_STATE_ARCHIVED) {
        continue;
      }
      scanned += 1;

      const importance = clampUnitNumber(record.importance, 0.6).value;
      const confidence = clampUnitNumber(record.confidence, 0.6).value;
      let action: "promote" | "decay" | "archive" | undefined;
      let reason = "";
      if (importance <= 0.2 || confidence <= 0.25) {
        action = "archive";
        reason = `importance=${importance.toFixed(3)}, confidence=${confidence.toFixed(3)}`;
      } else if (importance >= 0.85 && confidence >= 0.85) {
        action = "promote";
        reason = `importance=${importance.toFixed(3)}, confidence=${confidence.toFixed(3)}`;
      } else if (importance > 0.3) {
        action = "decay";
        reason = `importance=${importance.toFixed(3)}`;
      }
      if (!action) {
        continue;
      }

      changed += 1;
      const memoryId = String(record.id ?? "");
      if (action === "promote") {
        promoteCount += 1;
      } else if (action === "decay") {
        decayCount += 1;
      } else {
        archiveCount += 1;
      }
      rowsPreview.push(`- ${action}: ${memoryId} (${reason})`);
      if (dryRun) {
        continue;
      }
      const nowIso = new Date().toISOString();
      if (action === "archive") {
        store[index] = {
          ...record,
          state: MEMORY_STATE_ARCHIVED,
          archived_at: nowIso,
          updated_at: nowIso,
        };
      } else if (action === "decay") {
        const nextImportance = Math.max(0.3, Number((importance * 0.9).toFixed(4)));
        store[index] = {
          ...record,
          importance: nextImportance,
          state: MEMORY_STATE_ACTIVE,
          archived_at: "",
          updated_at: nowIso,
        };
      } else {
        const nextImportance = Math.min(1, Number((importance + 0.05).toFixed(4)));
        store[index] = {
          ...record,
          importance: nextImportance,
          state: MEMORY_STATE_ACTIVE,
          archived_at: "",
          updated_at: nowIso,
        };
      }
    }
    if (!dryRun) {
      memoryRecordsBySession.set(sessionId, store);
    }

    const lines = [
      `memory lifecycle: dry_run=${dryRun ? "on" : "off"}`,
      `roots=1 scanned=${String(scanned)} changed=${String(changed)} batch_limit=${String(MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT)}`,
      `actions=promote:${String(promoteCount)} decay:${String(decayCount)} archive:${String(archiveCount)}`,
    ];
    const previewLimit = 8;
    if (rowsPreview.length > 0) {
      lines.push(...rowsPreview.slice(0, previewLimit));
      if (rowsPreview.length > previewLimit) {
        lines.push(`... (+${String(rowsPreview.length - previewLimit)} more)`);
      }
    }
    return {
      ok: true,
      lines,
    };
  };

  const runMemoryLifecycleAcrossSessions = (
    options: {
      scope: MemoryScope;
      dryRun: boolean;
      sessions: string[];
      sessionPrefixes: string[];
      limit: number;
    },
  ): {
    status: "ok" | "partial";
    requestedCount: number;
    successCount: number;
    failedCount: number;
    actions: Record<"promote" | "decay" | "archive", number>;
    scanned: number;
    changed: number;
    discoveryTruncated: boolean;
    results: Array<Record<string, unknown>>;
  } => {
    const requestedSessions: string[] = [];
    const seenSessions = new Set<string>();
    const normalizedLimit = Math.max(1, Math.min(MANAGEMENT_MEMORY_BATCH_MAX_SESSIONS, options.limit));
    for (const rawSession of options.sessions) {
      const cleaned = rawSession.trim();
      if (!cleaned || seenSessions.has(cleaned)) {
        continue;
      }
      seenSessions.add(cleaned);
      requestedSessions.push(cleaned);
      if (requestedSessions.length >= normalizedLimit) {
        break;
      }
    }

    let discoveryTruncated = false;
    if (requestedSessions.length < normalizedLimit && options.sessionPrefixes.length > 0) {
      const availableSessions = Array.from(memoryRecordsBySession.keys());
      for (const prefix of options.sessionPrefixes) {
        const cleanedPrefix = prefix.trim();
        if (!cleanedPrefix) {
          continue;
        }
        for (const sessionId of availableSessions) {
          if (!sessionId.startsWith(cleanedPrefix)) {
            continue;
          }
          if (seenSessions.has(sessionId)) {
            continue;
          }
          seenSessions.add(sessionId);
          requestedSessions.push(sessionId);
          if (requestedSessions.length >= normalizedLimit) {
            discoveryTruncated = true;
            break;
          }
        }
        if (requestedSessions.length >= normalizedLimit) {
          break;
        }
      }
    } else if (requestedSessions.length >= normalizedLimit) {
      discoveryTruncated = true;
    }

    const actions = {
      promote: 0,
      decay: 0,
      archive: 0,
    };
    let scanned = 0;
    let changed = 0;
    let successCount = 0;
    let failedCount = 0;
    const results: Array<Record<string, unknown>> = [];
    const lifecycleLinePattern = /^actions=promote:(\d+)\s+decay:(\d+)\s+archive:(\d+)$/;
    const summaryLinePattern = /^roots=\d+\s+scanned=(\d+)\s+changed=(\d+)\s+batch_limit=\d+$/;
    for (const sessionId of requestedSessions) {
      const startedAtMs = Date.now();
      const lifecycleResult = runMemoryLifecycle(sessionId, options.scope, options.dryRun);
      if (!lifecycleResult.ok) {
        failedCount += 1;
      } else {
        successCount += 1;
      }

      for (const line of lifecycleResult.lines) {
        const summaryMatch = line.match(summaryLinePattern);
        if (summaryMatch) {
          scanned += Number.parseInt(summaryMatch[1] ?? "0", 10) || 0;
          changed += Number.parseInt(summaryMatch[2] ?? "0", 10) || 0;
        }
        const lifecycleMatch = line.match(lifecycleLinePattern);
        if (lifecycleMatch) {
          actions.promote += Number.parseInt(lifecycleMatch[1] ?? "0", 10) || 0;
          actions.decay += Number.parseInt(lifecycleMatch[2] ?? "0", 10) || 0;
          actions.archive += Number.parseInt(lifecycleMatch[3] ?? "0", 10) || 0;
        }
      }

      results.push({
        session_id: sessionId,
        status: lifecycleResult.ok ? "ok" : "error",
        code: lifecycleResult.ok ? 0 : 1,
        duration_ms: Math.max(0, Date.now() - startedAtMs),
        lines: lifecycleResult.lines.slice(0, 12),
      });
    }

    return {
      status: failedCount > 0 ? "partial" : "ok",
      requestedCount: requestedSessions.length,
      successCount,
      failedCount,
      actions,
      scanned,
      changed,
      discoveryTruncated,
      results: results.slice(0, 64),
    };
  };

  const applyMcpReset = (targetServer?: string): Record<string, unknown> => {
    if (typeof targetServer === "string" && targetServer.trim().length > 0) {
      const normalizedTarget = targetServer.trim();
      const key = normalizeMcpServerName(normalizedTarget);
      const closed = mcpSessions.delete(key);
      const resetStates = resetMcpServerStates(mcpServerStates, normalizedTarget);
      const runtimeSummary = aggregateMcpRuntimeSummary(mcpServerStates, [normalizedTarget]);
      return {
        status: "ok",
        timestamp: new Date().toISOString(),
        scope: "server",
        target: normalizedTarget,
        closed_sessions: closed ? 1 : 0,
        reset_states: resetStates,
        runtime_summary: runtimeSummary,
      };
    }
    const closedSessions = mcpSessions.size;
    mcpSessions.clear();
    const resetStates = resetMcpServerStates(mcpServerStates, undefined);
    const runtimeSummary = aggregateMcpRuntimeSummary(mcpServerStates);
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      scope: "all",
      target: "all",
      closed_sessions: closedSessions,
      reset_states: resetStates,
      runtime_summary: runtimeSummary,
    };
  };

  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const rawUrl = request.url ?? "/";
    const path = rawUrl.split("?")[0] ?? "/";

    if (method === "GET" && path === "/api/v1/status") {
      writeJson(response, 200, {
        status: "ok",
        engine: "ts-dev-cli",
        project: projectName,
        work_dir: workDir,
        reload_count: reloadCount,
        execution_plane: {
          gateway_impl: executionPlane.gatewayImpl,
          runtime_impl: executionPlane.runtimeImpl,
          shadow_mode: executionPlane.shadowMode,
          sources: {
            gateway_impl: executionPlane.gatewayImplSource,
            runtime_impl: executionPlane.runtimeImplSource,
            shadow_mode: executionPlane.shadowModeSource,
          },
        },
        governance_plane: {
          enabled: true,
          plane: "governance.v1",
          evaluator: "basic_turn_gate",
          auto_upgrade_enabled: false,
          auto_upgrade_reason: "manual_mode_default",
        },
        management_auth: {
          credential_count: managementToken ? 1 : 0,
          config_read_policy: configReadPolicy.effectivePolicy,
          config_read_policy_configured: configReadPolicy.configuredPolicy,
          config_read_policy_source: configReadPolicy.configuredSource,
          config_read_policy_reason: configReadPolicy.reason,
          config_endpoint_requires_auth: configReadPolicy.effectivePolicy === CONFIG_READ_POLICY_AUTH,
          config_endpoint_disabled: configReadPolicy.effectivePolicy === CONFIG_READ_POLICY_DISABLED,
          write_headers: ["Authorization: Bearer <token>", "X-Grobot-Token: <token>"],
          protected_endpoints: [
            "POST /api/v1/reload",
            "GET /api/v1/sessions/{id}/memory",
            "GET /api/v1/sessions/{id}/memory/export",
            "POST /api/v1/sessions/{id}/memory/import",
            "POST /api/v1/sessions/{id}/memory/forget",
            "POST /api/v1/sessions/{id}/memory/lifecycle",
            "POST /api/v1/memory/lifecycle/run",
            "POST /api/v1/sessions/{id}/interrupt",
            "POST /api/v1/mcp/reset",
            "POST /api/v1/mcp/servers/{name}/reset",
          ],
        },
        memory_store: {
          backend: memoryStoreRuntime.backend,
          requested_backend: memoryStoreRuntime.requestedBackend,
          source: memoryStoreRuntime.source,
          redis_url: maskRedisUrl(memoryStoreRuntime.redisUrl),
          fallback_reason: memoryStoreRuntime.fallbackReason ?? null,
          file_path: memoryStorePath,
          redis_key: memoryStoreKey,
          session_count: memoryRecordsBySession.size,
        },
        endpoints: {
          status: "/api/v1/status",
          config: "/api/v1/config",
          reload: "/api/v1/reload",
          session_memory_list: "/api/v1/sessions/{id}/memory",
          session_memory_export: "/api/v1/sessions/{id}/memory/export",
          session_memory_import: "/api/v1/sessions/{id}/memory/import",
          session_memory_forget: "/api/v1/sessions/{id}/memory/forget",
          session_memory_lifecycle: "/api/v1/sessions/{id}/memory/lifecycle",
          memory_lifecycle_run: "/api/v1/memory/lifecycle/run",
          session_interrupt: "/api/v1/sessions/{id}/interrupt",
          mcp_reset_all: "/api/v1/mcp/reset",
          mcp_reset_server: "/api/v1/mcp/servers/{name}/reset",
          healthz: "/healthz",
        },
        timestamp_iso: new Date().toISOString(),
      });
      return;
    }

    if (method === "GET" && path === "/api/v1/config") {
      if (configReadPolicy.effectivePolicy === CONFIG_READ_POLICY_DISABLED) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "config endpoint is disabled by policy",
        });
        return;
      }
      if (configReadPolicy.effectivePolicy === CONFIG_READ_POLICY_AUTH && !managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "management token is not configured",
        });
        return;
      }
      if (configReadPolicy.effectivePolicy === CONFIG_READ_POLICY_AUTH) {
        const incomingToken = parseBearerToken(request.headers);
        if (incomingToken !== managementToken) {
          writeJson(response, 403, {
            error: "forbidden",
            detail: "invalid management token",
          });
          return;
        }
      }
      writeJson(response, 200, {
        status: "ok",
        engine: "ts-dev-cli",
        project: projectName,
        work_dir: workDir,
        config: {
          paths: {
            project_toml: projectTomlPath ?? null,
            config_toml: configTomlPath ?? null,
          },
          execution_plane: {
            gateway_impl: executionPlane.gatewayImpl,
            runtime_impl: executionPlane.runtimeImpl,
            shadow_mode: executionPlane.shadowMode,
            sources: {
              gateway_impl: executionPlane.gatewayImplSource,
              runtime_impl: executionPlane.runtimeImplSource,
              shadow_mode: executionPlane.shadowModeSource,
            },
          },
          files: {
            project_toml_masked: readMaskedFile(projectTomlPath) ?? null,
            config_toml_masked: readMaskedFile(configTomlPath) ?? null,
          },
        },
        timestamp_iso: new Date().toISOString(),
      });
      return;
    }

    const memoryExportMatch = path.match(/^\/api\/v1\/sessions\/(.+)\/memory\/export$/);
    if (method === "GET" && memoryExportMatch) {
      const sessionId = decodeURIComponent(memoryExportMatch[1]).trim();
      if (!sessionId) {
        writeJson(response, 400, {
          error: "invalid_session_id",
        });
        return;
      }
      if (!managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "management token is not configured",
        });
        return;
      }
      const incomingToken = parseBearerToken(request.headers);
      if (incomingToken !== managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "invalid management token",
        });
        return;
      }

      const query = parseQueryParams(rawUrl);
      const scopeRaw = queryParamStr(query, "scope", MEMORY_SCOPE_AUTO).toLowerCase();
      const scope = normalizeMemoryScope(scopeRaw);
      if (!scope) {
        writeJson(response, 400, {
          error: "invalid_scope",
          detail: scopeRaw,
        });
        return;
      }
      const cursorResult = queryParamCursor(query);
      if (cursorResult.error) {
        writeJson(response, 400, {
          error: cursorResult.error,
        });
        return;
      }
      const cursor = cursorResult.cursor;
      const includeArchived = queryParamBool(query, "include_archived", true);
      const includeRestricted = queryParamBool(query, "include_restricted", false);
      const includeSecret = queryParamBool(query, "include_secret", false);
      const effectiveIncludeRestricted = includeRestricted || includeSecret;
      const queryText = queryParamStr(query, "query", "");
      const limit = queryParamInt(query, "limit", 2000, 1, 5000);
      const fetchLimit = cursor + limit + 1;
      if (fetchLimit > MANAGEMENT_MEMORY_FETCH_MAX) {
        writeJson(response, 400, {
          error: "cursor_window_too_large",
          detail: `cursor+limit exceeds max window ${String(MANAGEMENT_MEMORY_FETCH_MAX)}`,
        });
        return;
      }

      const rows = listMemoryRows(sessionId, {
        includeArchived,
        includeRestricted: effectiveIncludeRestricted,
        includeSecret,
        queryText,
      });
      const slicedRows = rows.slice(0, fetchLimit);
      const pageRows = slicedRows.slice(cursor, cursor + limit);
      const hasMore = slicedRows.length > cursor + limit;
      const nextCursor = hasMore ? String(cursor + limit) : null;

      writeJson(response, 200, {
        status: "ok",
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        scope,
        include_archived: includeArchived,
        include_restricted: effectiveIncludeRestricted,
        include_secret: includeSecret,
        query: queryText,
        limit,
        cursor,
        next_cursor: nextCursor,
        has_more: hasMore,
        count: pageRows.length,
        records: pageRows,
      });
      return;
    }

    const memoryListMatch = path.match(/^\/api\/v1\/sessions\/(.+)\/memory$/);
    if (method === "GET" && memoryListMatch) {
      const sessionId = decodeURIComponent(memoryListMatch[1]).trim();
      if (!sessionId) {
        writeJson(response, 400, {
          error: "invalid_session_id",
        });
        return;
      }
      if (!managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "management token is not configured",
        });
        return;
      }
      const incomingToken = parseBearerToken(request.headers);
      if (incomingToken !== managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "invalid management token",
        });
        return;
      }

      const query = parseQueryParams(rawUrl);
      const scopeRaw = queryParamStr(query, "scope", MEMORY_SCOPE_AUTO).toLowerCase();
      const scope = normalizeMemoryScope(scopeRaw);
      if (!scope) {
        writeJson(response, 400, {
          error: "invalid_scope",
          detail: scopeRaw,
        });
        return;
      }
      const cursorResult = queryParamCursor(query);
      if (cursorResult.error) {
        writeJson(response, 400, {
          error: cursorResult.error,
        });
        return;
      }
      const cursor = cursorResult.cursor;
      const includeArchived = queryParamBool(query, "include_archived", false);
      const includeRestricted = queryParamBool(query, "include_restricted", false);
      const includeSecret = queryParamBool(query, "include_secret", false);
      const effectiveIncludeRestricted = includeRestricted || includeSecret;

      const kindRaw = queryParamStr(query, "kind", "").toLowerCase();
      const kindFilter = kindRaw ? normalizeMemoryKind(kindRaw) : undefined;
      if (kindRaw && !kindFilter) {
        writeJson(response, 400, {
          error: "invalid_kind",
          detail: kindRaw,
        });
        return;
      }

      const classificationRaw = queryParamStr(query, "classification", "").toLowerCase();
      const classificationFilter = classificationRaw ? normalizeMemoryClassification(classificationRaw) : undefined;
      if (classificationRaw && !classificationFilter) {
        writeJson(response, 400, {
          error: "invalid_classification",
          detail: classificationRaw,
        });
        return;
      }

      const queryText = queryParamStr(query, "query", "");
      const limit = queryParamInt(query, "limit", 50, 1, 1000);
      const fetchLimit = cursor + limit + 1;
      if (fetchLimit > MANAGEMENT_MEMORY_FETCH_MAX) {
        writeJson(response, 400, {
          error: "cursor_window_too_large",
          detail: `cursor+limit exceeds max window ${String(MANAGEMENT_MEMORY_FETCH_MAX)}`,
        });
        return;
      }

      const rows = listMemoryRows(sessionId, {
        includeArchived,
        includeRestricted: effectiveIncludeRestricted,
        includeSecret,
        kindFilter,
        classificationFilter,
        queryText,
      });
      const slicedRows = rows.slice(0, fetchLimit);
      const pageRows = slicedRows.slice(cursor, cursor + limit);
      const hasMore = slicedRows.length > cursor + limit;
      const nextCursor = hasMore ? String(cursor + limit) : null;

      writeJson(response, 200, {
        status: "ok",
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        scope,
        include_archived: includeArchived,
        include_restricted: effectiveIncludeRestricted,
        include_secret: includeSecret,
        kind_filter: kindFilter ?? null,
        classification_filter: classificationFilter ?? null,
        query: queryText,
        limit,
        cursor,
        next_cursor: nextCursor,
        has_more: hasMore,
        count: pageRows.length,
        records: pageRows,
      });
      return;
    }

    const memoryImportMatch = path.match(/^\/api\/v1\/sessions\/(.+)\/memory\/import$/);
    if (method === "POST" && memoryImportMatch) {
      const sessionId = decodeURIComponent(memoryImportMatch[1]).trim();
      if (!sessionId) {
        writeJson(response, 400, {
          error: "invalid_session_id",
        });
        return;
      }
      if (!managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "management token is not configured",
        });
        return;
      }
      const incomingToken = parseBearerToken(request.headers);
      if (incomingToken !== managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "invalid management token",
        });
        return;
      }

      const declaredLength = Number.parseInt(readHeaderValue(request.headers, "content-length") ?? "0", 10);
      if (Number.isFinite(declaredLength) && declaredLength > MANAGEMENT_MEMORY_IMPORT_MAX_BODY_BYTES) {
        writeJson(response, 413, {
          error: "payload_too_large",
          detail: `Request body too large: ${String(declaredLength)} > ${String(MANAGEMENT_MEMORY_IMPORT_MAX_BODY_BYTES)} bytes`,
          max_bytes: MANAGEMENT_MEMORY_IMPORT_MAX_BODY_BYTES,
        });
        return;
      }

      const rawBody = await readBody(request);
      if (utf8ByteLength(rawBody) > MANAGEMENT_MEMORY_IMPORT_MAX_BODY_BYTES) {
        writeJson(response, 413, {
          error: "payload_too_large",
          detail: `Request body too large: ${String(utf8ByteLength(rawBody))} > ${String(MANAGEMENT_MEMORY_IMPORT_MAX_BODY_BYTES)} bytes`,
          max_bytes: MANAGEMENT_MEMORY_IMPORT_MAX_BODY_BYTES,
        });
        return;
      }
      const parsedBody = parseJsonObjectBody(rawBody);
      if (!parsedBody.ok) {
        writeJson(response, 400, {
          error: "invalid_json",
          detail: parsedBody.detail,
        });
        return;
      }
      const body = parsedBody.body;
      const scopeRaw = String(body.scope ?? MEMORY_SCOPE_AUTO).toLowerCase();
      const scope = normalizeMemoryScope(scopeRaw);
      if (!scope) {
        writeJson(response, 400, {
          error: "invalid_scope",
          detail: scopeRaw,
        });
        return;
      }
      const dryRun = parseBodyBool(body.dry_run, false);
      const source = typeof body.source === "string" && body.source.trim().length > 0 ? body.source.trim() : undefined;
      const importResult = importMemoryRows(sessionId, scope, body.records, source, dryRun);
      if (!importResult.ok) {
        const payload: Record<string, unknown> = {
          error: "memory_import_failed",
        };
        if (typeof importResult.result.error === "string") {
          payload.detail_error = importResult.result.error;
        }
        for (const [key, value] of Object.entries(importResult.result)) {
          if (key === "error") {
            continue;
          }
          payload[key] = value;
        }
        writeJson(response, 400, payload);
        return;
      }
      if (!dryRun) {
        try {
          await persistMemoryStore();
        } catch (error) {
          writeJson(response, 400, {
            error: "memory_import_failed",
            detail_error: "memory_store_persist_failed",
            detail: String(error),
          });
          return;
        }
      }
      writeJson(response, 200, {
        status: "ok",
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        scope,
        ...importResult.result,
      });
      return;
    }

    const memoryForgetMatch = path.match(/^\/api\/v1\/sessions\/(.+)\/memory\/forget$/);
    if (method === "POST" && memoryForgetMatch) {
      const sessionId = decodeURIComponent(memoryForgetMatch[1]).trim();
      if (!sessionId) {
        writeJson(response, 400, {
          error: "invalid_session_id",
        });
        return;
      }
      if (!managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "management token is not configured",
        });
        return;
      }
      const incomingToken = parseBearerToken(request.headers);
      if (incomingToken !== managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "invalid management token",
        });
        return;
      }

      const rawBody = await readBody(request);
      const parsedBody = parseJsonObjectBody(rawBody);
      if (!parsedBody.ok) {
        writeJson(response, 400, {
          error: "invalid_json",
          detail: parsedBody.detail,
        });
        return;
      }
      const body = parsedBody.body;
      const ids: string[] = [];
      if (typeof body.id === "string" && body.id.trim().length > 0) {
        ids.push(body.id.trim());
      }
      if (Array.isArray(body.ids)) {
        for (const item of body.ids) {
          if (typeof item !== "string") {
            continue;
          }
          const cleaned = item.trim();
          if (cleaned && !ids.includes(cleaned)) {
            ids.push(cleaned);
          }
        }
      }
      const scopeRaw = String(body.scope ?? MEMORY_SCOPE_AUTO).toLowerCase();
      const scope = normalizeMemoryScope(scopeRaw);
      if (!scope) {
        writeJson(response, 400, {
          error: "invalid_scope",
          detail: scopeRaw,
        });
        return;
      }
      const dryRun = parseBodyBool(body.dry_run, false);
      const reason = typeof body.reason === "string" && body.reason.trim().length > 0 ? body.reason.trim() : undefined;
      const forgetResult = forgetMemoryRows(sessionId, scope, ids, reason, dryRun);
      if (!forgetResult.ok) {
        const payload: Record<string, unknown> = {
          error: "memory_forget_failed",
        };
        if (typeof forgetResult.result.error === "string") {
          payload.detail_error = forgetResult.result.error;
        }
        for (const [key, value] of Object.entries(forgetResult.result)) {
          if (key === "error") {
            continue;
          }
          payload[key] = value;
        }
        writeJson(response, 400, payload);
        return;
      }
      if (!dryRun) {
        try {
          await persistMemoryStore();
        } catch (error) {
          writeJson(response, 400, {
            error: "memory_forget_failed",
            detail_error: "memory_store_persist_failed",
            detail: String(error),
          });
          return;
        }
      }
      writeJson(response, 200, {
        status: "ok",
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        scope,
        ...forgetResult.result,
      });
      return;
    }

    const memoryLifecycleMatch = path.match(/^\/api\/v1\/sessions\/(.+)\/memory\/lifecycle$/);
    if (method === "POST" && memoryLifecycleMatch) {
      const sessionId = decodeURIComponent(memoryLifecycleMatch[1]).trim();
      if (!sessionId) {
        writeJson(response, 400, {
          error: "invalid_session_id",
        });
        return;
      }
      if (!managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "management token is not configured",
        });
        return;
      }
      const incomingToken = parseBearerToken(request.headers);
      if (incomingToken !== managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "invalid management token",
        });
        return;
      }

      const rawBody = await readBody(request);
      const parsedBody = parseJsonObjectBody(rawBody);
      if (!parsedBody.ok) {
        writeJson(response, 400, {
          error: "invalid_json",
          detail: parsedBody.detail,
        });
        return;
      }
      const body = parsedBody.body;
      const scopeRaw = String(body.scope ?? MEMORY_SCOPE_AUTO).toLowerCase();
      const scope = normalizeMemoryScope(scopeRaw);
      if (!scope) {
        writeJson(response, 400, {
          error: "invalid_scope",
          detail: scopeRaw,
        });
        return;
      }
      const dryRun = parseBodyBool(body.dry_run, false);
      const lifecycleResult = runMemoryLifecycle(sessionId, scope, dryRun);
      if (!lifecycleResult.ok) {
        writeJson(response, 400, {
          error: "memory_lifecycle_failed",
          lines: lifecycleResult.lines,
        });
        return;
      }
      if (!dryRun) {
        try {
          await persistMemoryStore();
        } catch (error) {
          writeJson(response, 400, {
            error: "memory_lifecycle_failed",
            lines: [`memory lifecycle failed: memory_store_persist_failed (${String(error)})`],
          });
          return;
        }
      }
      writeJson(response, 200, {
        status: "ok",
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        scope,
        dry_run: dryRun,
        lines: lifecycleResult.lines,
      });
      return;
    }

    if (method === "POST" && path === "/api/v1/memory/lifecycle/run") {
      if (!managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "management token is not configured",
        });
        return;
      }
      const incomingToken = parseBearerToken(request.headers);
      if (incomingToken !== managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "invalid management token",
        });
        return;
      }

      const rawBody = await readBody(request);
      const parsedBody = parseJsonObjectBody(rawBody);
      if (!parsedBody.ok) {
        writeJson(response, 400, {
          error: "invalid_json",
          detail: parsedBody.detail,
        });
        return;
      }
      const body = parsedBody.body;
      const scopeRaw = String(body.scope ?? MEMORY_SCOPE_AUTO).toLowerCase();
      const scope = normalizeMemoryScope(scopeRaw);
      if (!scope) {
        writeJson(response, 400, {
          error: "invalid_scope",
          detail: scopeRaw,
        });
        return;
      }
      const dryRun = parseBodyBool(body.dry_run, false);

      const sessions: string[] = [];
      if (Array.isArray(body.sessions)) {
        for (const sessionId of body.sessions) {
          if (typeof sessionId !== "string") {
            continue;
          }
          const cleaned = sessionId.trim();
          if (cleaned && !sessions.includes(cleaned)) {
            sessions.push(cleaned);
          }
        }
      }

      const sessionPrefixes: string[] = [];
      if (typeof body.session_prefix === "string" && body.session_prefix.trim().length > 0) {
        sessionPrefixes.push(body.session_prefix.trim());
      }
      if (Array.isArray(body.session_prefixes)) {
        for (const prefix of body.session_prefixes) {
          if (typeof prefix !== "string") {
            continue;
          }
          const cleaned = prefix.trim();
          if (cleaned && !sessionPrefixes.includes(cleaned)) {
            sessionPrefixes.push(cleaned);
          }
        }
      }

      let limit = 20;
      if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
        limit = Math.floor(body.limit);
      } else if (typeof body.limit === "string" && body.limit.trim().length > 0) {
        const parsedLimit = Number.parseInt(body.limit.trim(), 10);
        if (Number.isFinite(parsedLimit)) {
          limit = parsedLimit;
        }
      }
      const normalizedLimit = Math.max(1, Math.min(MANAGEMENT_MEMORY_BATCH_MAX_SESSIONS, limit));

      if (sessions.length === 0 && sessionPrefixes.length === 0) {
        writeJson(response, 400, {
          error: "no_target_sessions",
          detail: "Provide sessions[] or session_prefix/session_prefixes.",
        });
        return;
      }

      const lifecycleResult = runMemoryLifecycleAcrossSessions({
        scope,
        dryRun,
        sessions,
        sessionPrefixes,
        limit: normalizedLimit,
      });
      if (!dryRun && lifecycleResult.changed > 0) {
        try {
          await persistMemoryStore();
        } catch (error) {
          writeJson(response, 400, {
            error: "memory_lifecycle_failed",
            detail_error: "memory_store_persist_failed",
            detail: String(error),
          });
          return;
        }
      }
      writeJson(response, 200, {
        status: lifecycleResult.status,
        timestamp: new Date().toISOString(),
        scope,
        dry_run: dryRun,
        requested_count: lifecycleResult.requestedCount,
        success_count: lifecycleResult.successCount,
        failed_count: lifecycleResult.failedCount,
        actions: lifecycleResult.actions,
        scanned: lifecycleResult.scanned,
        changed: lifecycleResult.changed,
        session_prefixes: sessionPrefixes,
        discovery_truncated: lifecycleResult.discoveryTruncated,
        discovery_warnings: [],
        results: lifecycleResult.results,
      });
      return;
    }

    if (method === "GET" && path === "/healthz") {
      writeJson(response, 200, {
        status: "ok",
        ready: true,
        engine: "ts-dev-cli",
        timestamp_iso: new Date().toISOString(),
      });
      return;
    }

    if (method === "POST" && path === "/api/v1/reload") {
      if (!managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "management token is not configured",
        });
        return;
      }
      const incomingToken = parseBearerToken(request.headers);
      if (incomingToken !== managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "invalid management token",
        });
        return;
      }
      executionPlane = resolveExecutionPlaneConfig(executionPlaneInput);
      configTomlPath = resolveConfigTomlPath(options);
      configReadPolicy = resolveConfigReadPolicy(options, bind.host, configTomlPath);
      const reloadedMemoryState = await loadMemoryStoreRuntimeState(resolveMemoryStoreRuntime(options, projectTomlPath));
      memoryStoreRuntime = reloadedMemoryState.runtime;
      replaceMemoryRecordsBySession(reloadedMemoryState.store);
      reloadCount += 1;
      writeJson(response, 200, {
        status: "ok",
        reload_count: reloadCount,
        execution_plane: {
          gateway_impl: executionPlane.gatewayImpl,
          runtime_impl: executionPlane.runtimeImpl,
          shadow_mode: executionPlane.shadowMode,
        },
        memory_store: {
          backend: memoryStoreRuntime.backend,
          requested_backend: memoryStoreRuntime.requestedBackend,
          source: memoryStoreRuntime.source,
          fallback_reason: memoryStoreRuntime.fallbackReason ?? null,
          session_count: memoryRecordsBySession.size,
        },
      });
      return;
    }

    if (method === "POST" && path === "/api/v1/mcp/reset") {
      if (!managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "management token is not configured",
        });
        return;
      }
      const incomingToken = parseBearerToken(request.headers);
      if (incomingToken !== managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "invalid management token",
        });
        return;
      }
      try {
        writeJson(response, 200, applyMcpReset());
      } catch (error) {
        writeJson(response, 500, {
          error: "mcp_reset_failed",
          detail: String(error),
        });
      }
      return;
    }

    const mcpResetMatch = path.match(/^\/api\/v1\/mcp\/servers\/(.+)\/reset$/);
    if (method === "POST" && mcpResetMatch) {
      const serverName = decodeURIComponent(mcpResetMatch[1]).trim();
      if (!serverName) {
        writeJson(response, 400, {
          error: "invalid_server_name",
        });
        return;
      }
      if (!managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "management token is not configured",
        });
        return;
      }
      const incomingToken = parseBearerToken(request.headers);
      if (incomingToken !== managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "invalid management token",
        });
        return;
      }
      try {
        writeJson(response, 200, applyMcpReset(serverName));
      } catch (error) {
        writeJson(response, 500, {
          error: "mcp_reset_failed",
          detail: String(error),
        });
      }
      return;
    }

    const interruptMatch = path.match(/^\/api\/v1\/sessions\/(.+)\/interrupt$/);
    if (method === "POST" && interruptMatch) {
      if (!managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "management token is not configured",
        });
        return;
      }
      const incomingToken = parseBearerToken(request.headers);
      if (incomingToken !== managementToken) {
        writeJson(response, 403, {
          error: "forbidden",
          detail: "invalid management token",
        });
        return;
      }
      const sessionId = decodeURIComponent(interruptMatch[1]);
      const body = await readBody(request);
      let ttlSecs = 300;
      if (body.trim()) {
        try {
          const payload = JSON.parse(body) as unknown;
          if (typeof payload === "object" && payload !== null) {
            const value = (payload as Record<string, unknown>).ttl_secs;
            if (typeof value === "number" && Number.isFinite(value) && value > 0) {
              ttlSecs = Math.floor(value);
            }
          }
        } catch {
          writeJson(response, 400, {
            error: "bad_request",
            detail: "invalid json body",
          });
          return;
        }
      }
      setInterruptFlag(sessionId, ttlSecs);
      writeJson(response, 200, {
        status: "ok",
        session_id: sessionId,
        ttl_secs: ttlSecs,
      });
      return;
    }

    writeJson(response, 404, {
      error: "not_found",
      path,
      method,
    });
  });

  return new Promise<number>((resolve) => {
    const shutdown = () => {
      server.close(() => {
        resolve(0);
      });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    server.listen(bind.port, bind.host, () => {
      const address = server.address();
      let listenHost = bind.host;
      let listenPort = bind.port;
      if (address && typeof address === "object" && "port" in address) {
        listenHost = String(address.address || bind.host);
        listenPort = Number(address.port || bind.port);
      }
      process.stdout.write(`serve: ts-dev-cli\n`);
      process.stdout.write(`management api: http://${listenHost}:${listenPort}\n`);
      process.stdout.write(
        `execution: gateway=${executionPlane.gatewayImpl}(${executionPlane.gatewayImplSource}) runtime=${executionPlane.runtimeImpl}(${executionPlane.runtimeImplSource}) shadow=${executionPlane.shadowMode ? "on" : "off"}(${executionPlane.shadowModeSource})\n`,
      );
    });
  });
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.command || parsed.command === "help" || parsed.command === "--help" || parsed.command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const hardCutErrors = validateHardCutExecutionOptions(parsed.options);
  if (hardCutErrors.length > 0) {
    process.stderr.write("error: invalid execution-plane options in TS+Rust hard-cut mode.\n");
    for (const item of hardCutErrors) {
      process.stderr.write(`- ${item}\n`);
    }
    return 2;
  }

  if (parsed.command === "status") {
    return runStatus(parsed.options);
  }
  if (parsed.command === "start") {
    return runStart(parsed.options);
  }
  if (parsed.command === "serve") {
    return runServe(parsed.options);
  }

  process.stderr.write(`error: unsupported command for ts-dev-cli: ${parsed.command}\n`);
  return 3;
}

void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`ts-dev-cli fatal error: ${String(error)}\n`);
    process.exitCode = 1;
  });
