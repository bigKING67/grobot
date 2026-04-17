#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveContextWeaverRetrieval } from "../../../shared/retrieval/contextweaver-retrieval.mjs";
import {
  hasTomlPath,
  readTomlBoolean,
  readTomlConfig,
  readTomlNumberOrString,
  readTomlString,
} from "../../../shared/config/toml-config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..", "..", "..");

const DEFAULT_TIMEOUT_MS = 45_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 180_000;
const MAX_EVIDENCE_TEXT_CHARS = 2_000;
const MAX_WARNING_CHARS = 600;
const DEFAULT_SOURCE_CONCURRENCY = 3;
const MAX_SOURCE_CONCURRENCY = 8;
const contextWeaverLocalApiCache = new Map();

function parseArgs(argv) {
  const command = String(argv[0] ?? "").trim();
  if (!command) {
    throw createError("semantic_invalid_request", "missing bridge command");
  }
  const options = {
    payload: "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "").trim();
    if (!token) {
      continue;
    }
    if (token === "--payload") {
      const value = String(argv[index + 1] ?? "");
      if (!value || value.startsWith("--")) {
        throw createError("semantic_invalid_request", "missing value for --payload");
      }
      options.payload = value;
      index += 1;
      continue;
    }
    if (token === "--timeout-ms") {
      const value = String(argv[index + 1] ?? "");
      if (!/^\d+$/.test(value)) {
        throw createError("semantic_invalid_request", "invalid value for --timeout-ms");
      }
      const parsed = Number.parseInt(value, 10);
      options.timeoutMs = clamp(parsed, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
      index += 1;
      continue;
    }
    throw createError("semantic_invalid_request", `unknown argument: ${token}`);
  }
  if (!options.payload) {
    throw createError("semantic_invalid_request", "missing --payload");
  }
  let payload;
  try {
    payload = JSON.parse(options.payload);
  } catch (error) {
    throw createError(
      "semantic_invalid_request",
      `payload is not valid JSON: ${String(error)}`,
    );
  }
  if (!isRecord(payload)) {
    throw createError("semantic_invalid_request", "payload must be a JSON object");
  }
  return { command, payload, timeoutMs: options.timeoutMs };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function toStringArray(value, maxItems = 64) {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }
    rows.push(normalized);
    if (rows.length >= maxItems) {
      break;
    }
  }
  return rows;
}

function toPositiveInt(value, fallback, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return fallback;
  }
  return Math.min(normalized, max);
}

function truncateText(value, maxChars) {
  if (typeof value !== "string") {
    return "";
  }
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}...`;
}

const RETRIEVAL_ENV_KEYS = [
  "EMBEDDINGS_API_KEY",
  "EMBEDDINGS_BASE_URL",
  "EMBEDDINGS_MODEL",
  "EMBEDDINGS_DIMENSIONS",
  "EMBEDDINGS_BATCH_SIZE",
  "EMBEDDINGS_MAX_CONCURRENCY",
  "EMBEDDINGS_MAX_INPUT_TOKENS",
  "RERANK_API_KEY",
  "RERANK_BASE_URL",
  "RERANK_MODEL",
  "RERANK_TOP_N",
  "CONTEXTWEAVER_API_KEY",
  "CONTEXTWEAVER_BASE_URL",
  "CONTEXTWEAVER_EMBEDDINGS_API_KEY",
  "CONTEXTWEAVER_EMBEDDINGS_BASE_URL",
  "CONTEXTWEAVER_EMBEDDINGS_MODEL",
  "CONTEXTWEAVER_EMBEDDINGS_DIMENSIONS",
  "CONTEXTWEAVER_RERANK_API_KEY",
  "CONTEXTWEAVER_RERANK_BASE_URL",
  "CONTEXTWEAVER_RERANK_MODEL",
  "GROBOT_RETRIEVAL_API_KEY",
  "GROBOT_RETRIEVAL_BASE_URL",
  "GROBOT_EMBEDDING_API_KEY",
  "GROBOT_EMBEDDING_BASE_URL",
  "GROBOT_EMBEDDING_MODEL",
  "GROBOT_EMBEDDING_DIMENSIONS",
  "GROBOT_RERANK_API_KEY",
  "GROBOT_RERANK_BASE_URL",
  "GROBOT_RERANK_MODEL",
];

function isContextWeaverEnvKey(key) {
  return key === "HOME"
    || key.startsWith("EMBEDDINGS_")
    || key.startsWith("RERANK_");
}

function buildContextWeaverEnvPatch(env) {
  if (!isRecord(env)) {
    return {};
  }
  const patch = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      continue;
    }
    if (!isContextWeaverEnvKey(key)) {
      continue;
    }
    patch[key] = value;
  }
  return patch;
}

function stripAnsi(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\u001B\[[0-9;]*m/g, "");
}

function createError(errorClass, message, details) {
  const error = new Error(message);
  error.errorClass = errorClass;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function resolveSourceRoots(payload) {
  const rawRoots = Array.isArray(payload.sourceRoots) ? payload.sourceRoots : [];
  const rows = [];
  const dedup = new Set();
  for (const raw of rawRoots) {
    if (!isRecord(raw)) {
      continue;
    }
    const source = String(raw.source ?? "").trim().toLowerCase();
    const rootPathRaw = String(raw.rootPath ?? "").trim();
    if (!source || !rootPathRaw) {
      continue;
    }
    const rootPath = isAbsolute(rootPathRaw)
      ? rootPathRaw
      : resolve(process.cwd(), rootPathRaw);
    const key = `${source}:${rootPath}`;
    if (dedup.has(key)) {
      continue;
    }
    dedup.add(key);
    rows.push({ source, rootPath });
  }
  return rows;
}

function resolveContextWeaverRootCandidates() {
  return [
    String(process.env.GROBOT_CONTEXTWEAVER_ROOT ?? "").trim(),
    String(process.env.CONTEXTWEAVER_ROOT ?? "").trim(),
    resolve(repoRoot, "adapters", "contextweaver", "vendor", "contextweaver"),
  ].filter(Boolean);
}

function resolveContextWeaverDistEntry() {
  for (const rootCandidate of resolveContextWeaverRootCandidates()) {
    const rootPath = isAbsolute(rootCandidate)
      ? rootCandidate
      : resolve(process.cwd(), rootCandidate);
    const distEntry = resolve(rootPath, "dist/index.js");
    if (existsSync(distEntry)) {
      return distEntry;
    }
  }
  return "";
}

function resolveContextWeaverExecutable() {
  const envBin = String(process.env.CONTEXTWEAVER_BIN ?? "").trim();
  if (envBin) {
    return { command: envBin, baseArgs: [] };
  }

  const distEntry = resolveContextWeaverDistEntry();
  if (distEntry) {
    return { command: process.execPath, baseArgs: [distEntry] };
  }

  return { command: "contextweaver", baseArgs: [] };
}

function isExplicitContextWeaverBinSet() {
  return String(process.env.CONTEXTWEAVER_BIN ?? "").trim().length > 0;
}

function hasResolvableNodeModule(startDir, packageName) {
  let cursor = String(startDir ?? "").trim();
  if (!cursor || !packageName) {
    return false;
  }
  while (true) {
    const candidate = resolve(cursor, "node_modules", packageName);
    if (existsSync(candidate)) {
      return true;
    }
    const parent = resolve(cursor, "..");
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return false;
}

function normalizeBridgeExecMode(value, fallback = "local") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "auto" || normalized === "local" || normalized === "spawn") {
    return normalized;
  }
  return fallback;
}

function applyContextWeaverEnvToProcess(env) {
  const patch = buildContextWeaverEnvPatch(env);
  for (const [key, value] of Object.entries(patch)) {
    process.env[key] = value;
  }
}

async function loadContextWeaverLocalApi(distEntry) {
  const cacheKey = String(distEntry ?? "");
  if (!cacheKey) {
    throw new Error("contextweaver dist entry missing");
  }
  const cached = contextWeaverLocalApiCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const distDir = dirname(distEntry);
  const retrievalUrl = pathToFileURL(resolve(distDir, "retrieval-G6II56JG.js")).href;
  const promptUrl = pathToFileURL(resolve(distDir, "promptContext-XM36PCDP.js")).href;
  const cliUrl = pathToFileURL(resolve(distDir, "cli-OVRYLXAB.js")).href;

  const [retrievalModule, promptModule, cliModule] = await Promise.all([
    import(retrievalUrl),
    import(promptUrl),
    import(cliUrl),
  ]);

  const retrieveCodeContext = retrievalModule?.retrieveCodeContext;
  const buildPromptContext = promptModule?.buildPromptContext;
  const ensureSearchableProject = cliModule?.ensureSearchableProject;
  const runIndexCommand = cliModule?.runIndexCommand;

  if (typeof retrieveCodeContext !== "function") {
    throw new Error("contextweaver local API missing retrieveCodeContext()");
  }
  if (typeof buildPromptContext !== "function") {
    throw new Error("contextweaver local API missing buildPromptContext()");
  }
  if (typeof ensureSearchableProject !== "function") {
    throw new Error("contextweaver local API missing ensureSearchableProject()");
  }
  if (typeof runIndexCommand !== "function") {
    throw new Error("contextweaver local API missing runIndexCommand()");
  }

  const localApi = {
    retrieveCodeContext,
    buildPromptContext,
    ensureSearchableProject,
    runIndexCommand,
  };
  contextWeaverLocalApiCache.set(cacheKey, localApi);
  return localApi;
}

async function resolveContextWeaverRuntime(env) {
  if (isExplicitContextWeaverBinSet()) {
    return { mode: "spawn", execRef: resolveContextWeaverExecutable(), warning: "" };
  }
  const execMode = normalizeBridgeExecMode(process.env.GROBOT_CONTEXTWEAVER_BRIDGE_EXEC_MODE, "local");
  if (execMode === "spawn") {
    return { mode: "spawn", execRef: resolveContextWeaverExecutable(), warning: "" };
  }
  const distEntry = resolveContextWeaverDistEntry();
  if (!distEntry) {
    if (execMode === "local") {
      throw createError(
        "semantic_tool_unavailable",
        "local contextweaver runtime requested but dist/index.js was not found",
      );
    }
    return { mode: "spawn", execRef: resolveContextWeaverExecutable(), warning: "" };
  }
  const localDepsReady = hasResolvableNodeModule(dirname(distEntry), "better-sqlite3");
  if (!localDepsReady) {
    if (execMode === "local") {
      throw createError(
        "semantic_tool_unavailable",
        "local contextweaver runtime requires better-sqlite3 in a resolvable node_modules path",
      );
    }
    return { mode: "spawn", execRef: resolveContextWeaverExecutable(), warning: "" };
  }

  try {
    applyContextWeaverEnvToProcess(env);
    return { mode: "local", localApi: await loadContextWeaverLocalApi(distEntry), execRef: null, warning: "" };
  } catch (error) {
    if (execMode === "local") {
      throw createError(
        "semantic_tool_unavailable",
        `failed to load local contextweaver runtime: ${String(error?.message ?? error)}`,
      );
    }
    return {
      mode: "spawn",
      execRef: resolveContextWeaverExecutable(),
      warning: `local contextweaver runtime load failed, fallback to spawn: ${truncateText(String(error?.message ?? error), MAX_WARNING_CHARS)}`,
    };
  }
}

function normalizeContextWeaverPath(rootPath, filePath) {
  const normalizedPath = String(filePath ?? "").trim();
  if (!normalizedPath) {
    return "";
  }
  if (!isAbsolute(normalizedPath)) {
    return normalizedPath;
  }
  const base = resolve(rootPath);
  const relativePath = relative(base, normalizedPath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return normalizedPath;
  }
  return relativePath.split("\\").join("/");
}

function normalizeRefreshMode(value, fallback = "auto") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "auto") {
    return "auto";
  }
  if (normalized === "force" || normalized === "always") {
    return "force";
  }
  if (normalized === "skip" || normalized === "never") {
    return "skip";
  }
  return fallback;
}

function normalizeSemanticScore(value) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (numeric <= 0) {
    return 0;
  }
  if (numeric <= 1) {
    return Number(numeric.toFixed(6));
  }
  return Number((numeric / (numeric + 1)).toFixed(6));
}

function shouldRetryWithRefresh(errorClass) {
  return errorClass === "semantic_index_required" || errorClass === "semantic_index_config_invalid";
}

function normalizeToolErrorClass(value, fallback) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return fallback;
}

function findProjectRootBySourceRoots(sourceRoots) {
  for (const row of sourceRoots) {
    const rootPath = String(row?.rootPath ?? "").trim();
    if (!rootPath) {
      continue;
    }
    let cursor = isAbsolute(rootPath) ? rootPath : resolve(process.cwd(), rootPath);
    while (true) {
      const projectGrobotConfig = resolve(cursor, ".grobot/config.toml");
      const projectToml = resolve(cursor, ".grobot/project.toml");
      if (existsSync(projectGrobotConfig) || existsSync(projectToml)) {
        return cursor;
      }
      const parent = resolve(cursor, "..");
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  }
  return "";
}

function loadTomlOptional(path) {
  try {
    return readTomlConfig(path, { required: false });
  } catch (error) {
    throw createError(
      "semantic_config_missing",
      String(error?.message ?? error),
    );
  }
}

function loadTomlRequired(path) {
  try {
    return readTomlConfig(path, { required: true });
  } catch (error) {
    throw createError(
      "semantic_config_missing",
      String(error?.message ?? error),
    );
  }
}

function hasLegacyContextRetrievalSection(tomlDoc) {
  if (!isRecord(tomlDoc)) {
    return false;
  }
  return hasTomlPath(tomlDoc, "context_retrieval");
}

function buildContextWeaverEnv(sourceRoots) {
  const env = { ...process.env };
  for (const key of RETRIEVAL_ENV_KEYS) {
    delete env[key];
  }

  const projectRoot = findProjectRootBySourceRoots(sourceRoots);
  if (!projectRoot) {
    throw createError(
      "semantic_config_missing",
      "cannot resolve project root for semantic retrieval config",
    );
  }
  const projectGrobotConfigToml = resolve(projectRoot, ".grobot/config.toml");
  if (!existsSync(projectGrobotConfigToml)) {
    throw createError(
      "semantic_config_missing",
      `missing semantic retrieval config: ${projectGrobotConfigToml}`,
    );
  }
  const projectConfigDoc = loadTomlRequired(projectGrobotConfigToml);

  const projectToml = resolve(projectRoot, ".grobot/project.toml");
  const projectConfigToml = resolve(projectRoot, "config.toml");
  const projectTomlDoc = loadTomlOptional(projectToml);
  const projectConfigTomlDoc = loadTomlOptional(projectConfigToml);
  if (
    hasLegacyContextRetrievalSection(projectConfigDoc)
    || hasLegacyContextRetrievalSection(projectTomlDoc)
    || hasLegacyContextRetrievalSection(projectConfigTomlDoc)
  ) {
    throw createError(
      "semantic_config_missing",
      "legacy [context_retrieval] is no longer supported; migrate all retrieval settings to .grobot/config.toml [retrieval.*]",
    );
  }

  const retrievalEnabled = readTomlBoolean(projectConfigDoc, "retrieval.enabled");
  if (retrievalEnabled === false) {
    throw createError(
      "semantic_config_missing",
      "semantic retrieval is disabled in .grobot/config.toml [retrieval].enabled",
    );
  }
  const embeddingEnabled = readTomlBoolean(projectConfigDoc, "retrieval.embedding.enabled");
  if (embeddingEnabled === false) {
    throw createError(
      "semantic_config_missing",
      "semantic retrieval embedding is disabled in .grobot/config.toml [retrieval.embedding].enabled",
    );
  }
  const rerankEnabled = readTomlBoolean(projectConfigDoc, "retrieval.rerank.enabled");
  if (rerankEnabled === false) {
    throw createError(
      "semantic_config_missing",
      "semantic retrieval rerank is disabled in .grobot/config.toml [retrieval.rerank].enabled",
    );
  }

  const retrievalBaseUrl = readTomlString(projectConfigDoc, "retrieval.base_url");
  const retrievalApiKey = readTomlString(projectConfigDoc, "retrieval.api_key");
  const retrievalEmbeddingModel = readTomlString(projectConfigDoc, "retrieval.embedding.model");
  const retrievalEmbeddingDimensions = readTomlNumberOrString(projectConfigDoc, "retrieval.embedding.dimensions");
  const retrievalRerankModel = readTomlString(projectConfigDoc, "retrieval.rerank.model");

  const retrievalResolved = resolveContextWeaverRetrieval({
    sharedBaseUrlCandidates: [
      { value: retrievalBaseUrl, source: "project_config" },
    ],
    sharedApiKeyCandidates: [
      { value: retrievalApiKey, source: "project_config" },
    ],
    embeddingBaseUrlCandidates: [],
    embeddingApiKeyCandidates: [],
    embeddingModelCandidates: [
      { value: retrievalEmbeddingModel, source: "project_config" },
    ],
    embeddingDimensionsCandidates: [
      { value: retrievalEmbeddingDimensions, source: "project_config" },
    ],
    rerankBaseUrlCandidates: [],
    rerankApiKeyCandidates: [],
    rerankModelCandidates: [
      { value: retrievalRerankModel, source: "project_config" },
    ],
  });

  if (!retrievalResolved.embedding || !retrievalResolved.rerank || retrievalResolved.embeddingDimensions <= 0) {
    const missingFields = [];
    if (!retrievalResolved.sharedBaseUrl) {
      missingFields.push("retrieval.base_url");
    }
    if (!retrievalResolved.sharedApiKey) {
      missingFields.push("retrieval.api_key");
    }
    if (!retrievalResolved.embeddingModel) {
      missingFields.push("retrieval.embedding.model");
    }
    if (retrievalResolved.embeddingDimensions <= 0) {
      missingFields.push("retrieval.embedding.dimensions");
    }
    if (!retrievalResolved.rerankModel) {
      missingFields.push("retrieval.rerank.model");
    }
    const missingHint = missingFields.length > 0
      ? `missing required fields: ${missingFields.join(", ")}`
      : "retrieval values are empty or placeholders";
    throw createError(
      "semantic_config_missing",
      `invalid semantic retrieval config in ${projectGrobotConfigToml}; ${missingHint}`,
    );
  }

  if (retrievalResolved.embeddingApiKey) {
    env.EMBEDDINGS_API_KEY = retrievalResolved.embeddingApiKey;
  }
  if (retrievalResolved.embeddingBaseUrl) {
    env.EMBEDDINGS_BASE_URL = retrievalResolved.embeddingBaseUrl;
  }
  if (retrievalResolved.embeddingModel) {
    env.EMBEDDINGS_MODEL = retrievalResolved.embeddingModel;
  }
  if (retrievalResolved.embeddingDimensions > 0) {
    env.EMBEDDINGS_DIMENSIONS = String(retrievalResolved.embeddingDimensions);
  }
  if (retrievalResolved.rerankApiKey) {
    env.RERANK_API_KEY = retrievalResolved.rerankApiKey;
  }
  if (retrievalResolved.rerankBaseUrl) {
    env.RERANK_BASE_URL = retrievalResolved.rerankBaseUrl;
  }
  if (retrievalResolved.rerankModel) {
    env.RERANK_MODEL = retrievalResolved.rerankModel;
  }
  if (!env.HOME) {
    env.HOME = os.homedir();
  }
  return env;
}

function classifyContextWeaverFailure(rawText, fallbackErrorClass) {
  const cleaned = stripAnsi(String(rawText ?? "")).trim();
  const lower = cleaned.toLowerCase();
  if (
    cleaned.includes("已创建")
    && cleaned.includes("cwconfig.json")
    && cleaned.includes("请先检查配置后重新运行 cw index")
  ) {
    return {
      errorClass: "semantic_index_config_invalid",
      message: "ContextWeaver generated cwconfig.json but current include patterns are invalid; update includePatterns then rerun `cw index`.",
    };
  }
  if (lower.includes("matches no indexable files")) {
    return {
      errorClass: "semantic_index_config_invalid",
      message: "ContextWeaver index config matches no files; update cwconfig.json includePatterns then rerun `cw index`.",
    };
  }
  if (
    lower.includes("non-interactive index preview requires --yes")
    || lower.includes("index confirmation declined")
  ) {
    return {
      errorClass: "semantic_index_confirmation_required",
      message: "ContextWeaver index scope requires explicit confirmation; run `cw index <repo-path>` manually, preview matched scope, then confirm.",
    };
  }
    if (
      cleaned.includes("请先运行 `cw index`")
      || cleaned.includes("尚未完成确认式索引")
      || lower.includes("run `cw index`")
    ) {
      return {
        errorClass: "semantic_index_required",
        message: "ContextWeaver index is missing; run `cw index <repo-path>` and complete the confirmation flow before semantic tools. If indexing fails with Embedding API HTTP 404, configure retrieval-specific embeddings base URL/model.",
      };
    }
  if (
    lower.includes("embedding api")
    && lower.includes("http 404")
  ) {
    return {
      errorClass: "semantic_config_missing",
      message: "Embedding endpoint is not available for current URL/model. Update .grobot/config.toml retrieval.base_url and retrieval.embedding.model.",
    };
  }
  if (
    lower.includes("fetch failed")
    || lower.includes("econnreset")
    || lower.includes("etimedout")
    || lower.includes("socket disconnected")
  ) {
    return {
      errorClass: "semantic_config_missing",
      message: "ContextWeaver retrieval network call failed (fetch/connection reset). Check retrieval endpoint reachability, proxy/network policy, or retry later.",
    };
  }
  if (
    lower.includes("embeddings_api_key")
    || lower.includes("rerank_api_key")
    || lower.includes("api_key")
    || cleaned.includes("环境变量未设置")
  ) {
    return {
      errorClass: "semantic_config_missing",
      message: "ContextWeaver retrieval credentials are missing; configure .grobot/config.toml retrieval.api_key.",
    };
  }
  return {
    errorClass: fallbackErrorClass,
    message: truncateText(cleaned || "contextweaver command failed", MAX_WARNING_CHARS),
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timer = null;
    const complete = (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      resolvePromise(payload);
    };
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd ?? process.cwd(),
        env: options.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      complete({
        status: 1,
        signal: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        error,
      });
      return;
    }

    const maxBuffer = 16 * 1024 * 1024;
    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk ?? "");
        if (stdout.length > maxBuffer) {
          stdout = stdout.slice(stdout.length - maxBuffer);
        }
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk ?? "");
        if (stderr.length > maxBuffer) {
          stderr = stderr.slice(stderr.length - maxBuffer);
        }
      });
    }

    child.once("error", (error) => {
      complete({
        status: 1,
        signal: null,
        stdout,
        stderr,
        timedOut,
        error,
      });
    });
    child.once("close", (code, signal) => {
      complete({
        status: typeof code === "number" ? code : 1,
        signal: signal ?? null,
        stdout,
        stderr,
        timedOut,
        error: null,
      });
    });

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore kill race
        }
      }, timeoutMs);
    }
  });
}

async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    return [];
  }
  const runnerCount = Math.max(1, Math.min(toPositiveInt(concurrency, 1, MAX_SOURCE_CONCURRENCY), list.length));
  const results = new Array(list.length);
  let nextIndex = 0;
  const runners = [];
  const launchRunner = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= list.length) {
        return;
      }
      results[currentIndex] = await worker(list[currentIndex], currentIndex);
    }
  };
  for (let index = 0; index < runnerCount; index += 1) {
    runners.push(launchRunner());
  }
  await Promise.all(runners);
  return results;
}

function deduplicateSemanticMatches(matches) {
  const dedup = new Map();
  for (const row of Array.isArray(matches) ? matches : []) {
    if (!isRecord(row)) {
      continue;
    }
    const source = String(row.source ?? "").trim();
    const rootPath = String(row.root_path ?? "").trim();
    const path = String(row.path ?? "").trim();
    const startLine = toPositiveInt(row.start_line, 1, 10 ** 8);
    const endLine = toPositiveInt(row.end_line, startLine, 10 ** 8);
    const lineEnd = endLine < startLine ? startLine : endLine;
    const key = `${source}:${rootPath}:${path}:${String(startLine)}:${String(lineEnd)}`;
    const normalized = {
      ...row,
      source,
      root_path: rootPath,
      path,
      start_line: startLine,
      end_line: lineEnd,
      score: normalizeSemanticScore(row.score),
      breadcrumb: String(row.breadcrumb ?? ""),
      text: truncateText(String(row.text ?? ""), MAX_EVIDENCE_TEXT_CHARS),
    };
    const previous = dedup.get(key);
    if (!previous || normalized.score > previous.score) {
      dedup.set(key, normalized);
    }
  }
  return [...dedup.values()];
}

function rankSemanticMatches(matches, maxSegments) {
  const deduped = deduplicateSemanticMatches(matches);
  if (deduped.length === 0) {
    return [];
  }
  deduped.sort((left, right) => (
    normalizeSemanticScore(right.score) - normalizeSemanticScore(left.score)
  ) || (
    String(left.path ?? "").localeCompare(String(right.path ?? ""))
  ) || (
    toPositiveInt(left.start_line, 1, 10 ** 8) - toPositiveInt(right.start_line, 1, 10 ** 8)
  ));
  return deduped.slice(0, maxSegments);
}

function extractTechnicalTerms(text, maxItems = 24) {
  const terms = [];
  const seen = new Set();
  const push = (term) => {
    const normalized = String(term ?? "").trim();
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    terms.push(normalized);
  };
  for (const token of String(text ?? "").match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []) {
    push(token);
    if (terms.length >= maxItems) {
      break;
    }
  }
  return terms;
}

function pickDominantErrorClass(errorClasses, fallbackErrorClass) {
  const normalized = Array.isArray(errorClasses)
    ? errorClasses
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
    : [];
  if (normalized.length === 0) {
    return fallbackErrorClass;
  }
  const priority = [
    "semantic_config_missing",
    "semantic_index_config_invalid",
    "semantic_index_confirmation_required",
    "semantic_index_required",
  ];
  for (const code of priority) {
    if (normalized.includes(code)) {
      return code;
    }
  }
  return normalized[0];
}

function parseContextWeaverJsonOutput(stdout) {
  const cleaned = stripAnsi(String(stdout ?? "")).trim();
  if (!cleaned) {
    throw new Error("contextweaver returned empty output");
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const lines = cleaned
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (!line.startsWith("{") && !line.startsWith("[")) {
        continue;
      }
      try {
        return JSON.parse(line);
      } catch {
        continue;
      }
    }
    const candidateStartIndexes = [];
    if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
      candidateStartIndexes.push(0);
    }
    for (let index = 0; index < cleaned.length; index += 1) {
      if (
        cleaned[index] === "\n"
        && (cleaned[index + 1] === "{" || cleaned[index + 1] === "[")
      ) {
        candidateStartIndexes.push(index + 1);
      }
    }
    for (let index = candidateStartIndexes.length - 1; index >= 0; index -= 1) {
      const start = candidateStartIndexes[index];
      const candidate = cleaned.slice(start).trim();
      if (!candidate) {
        continue;
      }
      try {
        return JSON.parse(candidate);
      } catch {
        continue;
      }
    }
    throw new Error(`contextweaver returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }
}

async function runContextWeaver(execRef, args, options = {}) {
  const runArgs = [...execRef.baseArgs, ...args];
  const result = await runCommand(execRef.command, runArgs, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if (result.error) {
    const errorCode = String(result.error.code ?? "");
    if (errorCode === "ENOENT") {
      throw createError(
        "semantic_tool_unavailable",
        `contextweaver executable not found: ${execRef.command}`,
      );
    }
    throw createError(
      "semantic_tool_unavailable",
      `failed to start contextweaver command: ${String(result.error.message ?? result.error)}`,
    );
  }
  const status = typeof result.status === "number" ? result.status : 1;
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (status !== 0 || result.timedOut) {
    const fallbackErrorClass = normalizeToolErrorClass(options.errorClass, "semantic_search_failed");
    const rawFailure = result.timedOut
      ? `contextweaver command timed out after ${String(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)}ms`
      : stderr || stdout || `contextweaver exited with code ${String(status)}`;
    const classified = classifyContextWeaverFailure(rawFailure, fallbackErrorClass);
    throw createError(
      classified.errorClass,
      classified.message,
      {
        status,
        raw_message: truncateText(stripAnsi(rawFailure), MAX_WARNING_CHARS),
      },
    );
  }
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw createError("semantic_invalid_response", "contextweaver returned empty output");
  }
  let parsed;
  try {
    parsed = parseContextWeaverJsonOutput(stdout);
  } catch (error) {
    throw createError(
      "semantic_invalid_response",
      error instanceof Error ? error.message : `contextweaver returned invalid JSON: ${String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw createError("semantic_invalid_response", "contextweaver output is not a JSON object");
  }
  return parsed;
}

async function runContextWeaverIndex(execRef, rootPath, options = {}) {
  const autoConfirm = String(process.env.GROBOT_CONTEXTWEAVER_AUTO_INDEX_CONFIRM ?? "").trim() === "1";
  const runArgs = autoConfirm
    ? [...execRef.baseArgs, "index", rootPath, "-y"]
    : [...execRef.baseArgs, "index", rootPath];
  const result = await runCommand(execRef.command, runArgs, {
    cwd: options.cwd ?? rootPath,
    env: options.env ?? process.env,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  if (result.error) {
    const errorCode = String(result.error.code ?? "");
    if (errorCode === "ENOENT") {
      throw createError(
        "semantic_tool_unavailable",
        `contextweaver executable not found: ${execRef.command}`,
      );
    }
    throw createError(
      "semantic_tool_unavailable",
      `failed to start contextweaver index command: ${String(result.error.message ?? result.error)}`,
    );
  }
  const status = typeof result.status === "number" ? result.status : 1;
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (status !== 0 || result.timedOut) {
    const fallbackErrorClass = normalizeToolErrorClass(options.errorClass, "semantic_refresh_failed");
    const rawFailure = result.timedOut
      ? `contextweaver index timed out after ${String(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)}ms`
      : stderr || stdout || `contextweaver index exited with code ${String(status)}`;
    const classified = classifyContextWeaverFailure(rawFailure, fallbackErrorClass);
    throw createError(
      classified.errorClass,
      classified.message,
      {
        status,
        raw_message: truncateText(stripAnsi(rawFailure), MAX_WARNING_CHARS),
      },
    );
  }
}

async function runContextWeaverWithRefresh(params) {
  const {
    execRef,
    args,
    rootPath,
    refreshMode,
    timeoutMs,
    env,
    cwd,
    errorClass,
  } = params;
  if (refreshMode === "force") {
    await runContextWeaverIndex(execRef, rootPath, {
      timeoutMs,
      env,
      cwd,
      errorClass: "semantic_refresh_failed",
    });
  }
  try {
    return await runContextWeaver(execRef, args, {
      timeoutMs,
      env,
      cwd,
      errorClass,
    });
  } catch (error) {
    const normalizedErrorClass = normalizeToolErrorClass(error?.errorClass, errorClass);
    if (refreshMode === "auto" && shouldRetryWithRefresh(normalizedErrorClass)) {
      await runContextWeaverIndex(execRef, rootPath, {
        timeoutMs,
        env,
        cwd,
        errorClass: "semantic_refresh_failed",
      });
      return runContextWeaver(execRef, args, {
        timeoutMs,
        env,
        cwd,
        errorClass,
      });
    }
    throw error;
  }
}

function createContextWeaverLocalFailure(error, fallbackErrorClass) {
  const rawFailure = error instanceof Error ? error.message : String(error);
  const classified = classifyContextWeaverFailure(rawFailure, fallbackErrorClass);
  return createError(
    classified.errorClass,
    classified.message,
    {
      raw_message: truncateText(stripAnsi(rawFailure), MAX_WARNING_CHARS),
    },
  );
}

async function runContextWeaverLocalIndex(localApi, rootPath, options = {}) {
  const autoConfirm = String(process.env.GROBOT_CONTEXTWEAVER_AUTO_INDEX_CONFIRM ?? "").trim() === "1";
  try {
    await localApi.runIndexCommand({
      rootPath,
      yes: autoConfirm ? true : undefined,
      isInteractive: false,
    });
  } catch (error) {
    throw createContextWeaverLocalFailure(
      error,
      normalizeToolErrorClass(options.errorClass, "semantic_refresh_failed"),
    );
  }
}

async function runContextWeaverLocalSearch(localApi, params) {
  try {
    await localApi.ensureSearchableProject(params.rootPath);
    return await localApi.retrieveCodeContext({
      repoPath: params.rootPath,
      informationRequest: params.query,
      technicalTerms: params.technicalTerms.length > 0 ? params.technicalTerms : undefined,
    });
  } catch (error) {
    throw createContextWeaverLocalFailure(
      error,
      normalizeToolErrorClass(params.errorClass, "semantic_search_failed"),
    );
  }
}

async function runContextWeaverLocalPromptContext(localApi, params) {
  try {
    return await localApi.buildPromptContext({
      prompt: params.prompt,
      repoPath: params.rootPath,
      explicitPaths: params.explicitPaths,
      explicitSymbols: params.explicitSymbols,
    });
  } catch (error) {
    throw createContextWeaverLocalFailure(
      error,
      normalizeToolErrorClass(params.errorClass, "prompt_enhancer_failed"),
    );
  }
}

async function runContextWeaverLocalWithRefresh(params) {
  const {
    localApi,
    rootPath,
    refreshMode,
    runOperation,
    errorClass,
  } = params;
  if (refreshMode === "force") {
    await runContextWeaverLocalIndex(localApi, rootPath, {
      errorClass: "semantic_refresh_failed",
    });
  }
  try {
    return await runOperation();
  } catch (error) {
    const normalizedErrorClass = normalizeToolErrorClass(error?.errorClass, errorClass);
    if (refreshMode === "auto" && shouldRetryWithRefresh(normalizedErrorClass)) {
      await runContextWeaverLocalIndex(localApi, rootPath, {
        errorClass: "semantic_refresh_failed",
      });
      return runOperation();
    }
    throw error;
  }
}

async function runSemanticSearch(payload, timeoutMs) {
  const query = String(payload.query ?? "").trim();
  if (!query) {
    throw createError("semantic_invalid_request", "semantic-search requires query");
  }
  const technicalTerms = toStringArray(payload.technicalTerms, 32);
  const perSourceLimit = toPositiveInt(payload.perSourceLimit, 6, 50);
  const maxSegments = toPositiveInt(payload.maxSegments, 24, 200);
  const sourceConcurrency = toPositiveInt(payload.sourceConcurrency, DEFAULT_SOURCE_CONCURRENCY, MAX_SOURCE_CONCURRENCY);
  const refreshMode = normalizeRefreshMode(payload.refresh, "auto");
  const sourceRoots = resolveSourceRoots(payload);
  if (sourceRoots.length === 0) {
    throw createError("semantic_no_source_available", "no source roots provided");
  }

  const env = buildContextWeaverEnv(sourceRoots);
  const runtime = await resolveContextWeaverRuntime(env);
  const sourceStats = [];
  const matches = [];
  const warnings = [];
  if (runtime.warning) {
    warnings.push(runtime.warning);
  }
  const errorClasses = [];
  const sourceResults = await mapWithConcurrency(sourceRoots, sourceConcurrency, async (sourceRoot) => {
    const { source, rootPath } = sourceRoot;
    if (!existsSync(rootPath)) {
      return {
        sourceStat: {
          source,
          root_path: rootPath,
          status: "skipped",
          count: 0,
        },
        matches: [],
        warnings: [`skip ${source}: root not found (${rootPath})`],
        errorClass: "",
      };
    }
    try {
      const args = [
        "search",
        "--repo-path",
        rootPath,
        "--information-request",
        query,
        "--format",
        "json",
      ];
      if (technicalTerms.length > 0) {
        args.push("--technical-terms", technicalTerms.join(","));
      }
      const result = runtime.mode === "local"
        ? await runContextWeaverLocalWithRefresh({
          localApi: runtime.localApi,
          rootPath,
          refreshMode,
          errorClass: "semantic_search_failed",
          runOperation: () => runContextWeaverLocalSearch(runtime.localApi, {
            rootPath,
            query,
            technicalTerms,
            errorClass: "semantic_search_failed",
          }),
        })
        : await runContextWeaverWithRefresh({
          execRef: runtime.execRef,
          args,
          rootPath,
          refreshMode,
          timeoutMs,
          env,
          cwd: rootPath,
          errorClass: "semantic_search_failed",
        });
      const files = Array.isArray(result.files) ? result.files : [];
      const flattened = [];
      for (const file of files) {
        if (!isRecord(file)) {
          continue;
        }
        const filePath = String(file.path ?? "").trim();
        const normalizedFilePath = normalizeContextWeaverPath(rootPath, filePath);
        const segments = Array.isArray(file.segments) ? file.segments : [];
        for (const segment of segments) {
          if (!isRecord(segment)) {
            continue;
          }
          flattened.push({
            source,
            root_path: rootPath,
            path: normalizedFilePath,
            start_line: toPositiveInt(segment.startLine, 1, 10 ** 8),
            end_line: toPositiveInt(segment.endLine, 1, 10 ** 8),
            score: normalizeSemanticScore(segment.score),
            breadcrumb: String(segment.breadcrumb ?? ""),
            text: truncateText(String(segment.text ?? ""), MAX_EVIDENCE_TEXT_CHARS),
          });
        }
      }
      flattened.sort((left, right) => right.score - left.score);
      const selected = flattened.slice(0, perSourceLimit);
      return {
        sourceStat: {
          source,
          root_path: rootPath,
          status: "ok",
          count: selected.length,
          semantic_count: selected.length,
        },
        matches: selected,
        warnings: [],
        errorClass: "",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorClass = normalizeToolErrorClass(error?.errorClass, "semantic_search_failed");
      return {
        sourceStat: {
          source,
          root_path: rootPath,
          status: "error",
          error_class: errorClass,
          count: 0,
        },
        matches: [],
        warnings: [`source ${source} failed: ${truncateText(message, MAX_WARNING_CHARS)}`],
        errorClass,
      };
    }
  });

  for (const row of sourceResults) {
    sourceStats.push(row.sourceStat);
    matches.push(...row.matches);
    warnings.push(...row.warnings);
    if (row.errorClass) {
      errorClasses.push(row.errorClass);
    }
  }

  const okCount = sourceStats.filter((row) => row.status === "ok").length;
  if (okCount === 0) {
    const errorClass = pickDominantErrorClass(errorClasses, "semantic_search_failed");
    throw createError(
      errorClass,
      warnings.join("; ") || "semantic search failed for all sources",
    );
  }

  const selectedMatches = rankSemanticMatches(matches, maxSegments);
  return {
    tool: "semantic_search",
    query,
    count: selectedMatches.length,
    source_stats: sourceStats,
    matches: selectedMatches,
    warnings,
    duration_ms: 0,
  };
}

async function runPromptEnhancer(payload, timeoutMs) {
  const prompt = String(payload.prompt ?? "").trim();
  if (!prompt) {
    throw createError("semantic_invalid_request", "prompt-enhancer requires prompt");
  }
  const explicitPaths = toStringArray(payload.explicitPaths, 32);
  const explicitSymbols = toStringArray(payload.explicitSymbols, 32);
  const maxEvidence = toPositiveInt(payload.maxEvidence, 16, 200);
  const sourceConcurrency = toPositiveInt(payload.sourceConcurrency, DEFAULT_SOURCE_CONCURRENCY, MAX_SOURCE_CONCURRENCY);
  const refreshMode = normalizeRefreshMode(payload.refresh, "auto");
  const sourceRoots = resolveSourceRoots(payload);
  if (sourceRoots.length === 0) {
    throw createError("semantic_no_source_available", "no source roots provided");
  }

  const env = buildContextWeaverEnv(sourceRoots);
  const runtime = await resolveContextWeaverRuntime(env);
  const technicalTerms = new Set();
  const topPaths = [];
  const evidence = [];
  const sourceStats = [];
  const warnings = [];
  if (runtime.warning) {
    warnings.push(runtime.warning);
  }
  const errorClasses = [];
  let language = "en";
  const sourceResults = await mapWithConcurrency(sourceRoots, sourceConcurrency, async (sourceRoot) => {
    const { source, rootPath } = sourceRoot;
    if (!existsSync(rootPath)) {
      return {
        sourceStat: {
          source,
          root_path: rootPath,
          status: "skipped",
        },
        evidence: [],
        topPaths: [],
        technicalTerms: [],
        warnings: [`skip ${source}: root not found (${rootPath})`],
        errorClass: "",
        language: "",
      };
    }
    try {
      const args = [
        "prompt-context",
        prompt,
        "--repo-path",
        rootPath,
        "--format",
        "json",
      ];
      if (explicitPaths.length > 0) {
        args.push("--paths", explicitPaths.join(","));
      }
      if (explicitSymbols.length > 0) {
        args.push("--symbols", explicitSymbols.join(","));
      }
      const result = runtime.mode === "local"
        ? await runContextWeaverLocalWithRefresh({
          localApi: runtime.localApi,
          rootPath,
          refreshMode,
          errorClass: "prompt_enhancer_failed",
          runOperation: () => runContextWeaverLocalPromptContext(runtime.localApi, {
            prompt,
            rootPath,
            explicitPaths,
            explicitSymbols,
            errorClass: "prompt_enhancer_failed",
          }),
        })
        : await runContextWeaverWithRefresh({
          execRef: runtime.execRef,
          args,
          rootPath,
          refreshMode,
          timeoutMs,
          env,
          cwd: rootPath,
          errorClass: "prompt_enhancer_failed",
        });

      const languageHint = typeof result.language === "string" && result.language.trim()
        ? result.language.trim()
        : "";
      const termRows = toStringArray(result.technicalTerms, 32);
      const retrieval = isRecord(result.retrieval) ? result.retrieval : {};
      const pathRows = toStringArray(retrieval.topPaths, 64)
        .map((rawPath) => normalizeContextWeaverPath(rootPath, rawPath))
        .map((normalizedPath) => `[${source}] ${normalizedPath}`);
      const evidenceRows = [];
      const rawEvidence = Array.isArray(retrieval.evidence) ? retrieval.evidence : [];
      for (const row of rawEvidence) {
        if (!isRecord(row)) {
          continue;
        }
        const normalizedPath = normalizeContextWeaverPath(rootPath, String(row.path ?? ""));
        evidenceRows.push({
          source,
          root_path: rootPath,
          path: normalizedPath,
          start_line: toPositiveInt(row.startLine, 1, 10 ** 8),
          end_line: toPositiveInt(row.endLine, 1, 10 ** 8),
          score: normalizeSemanticScore(row.score),
          breadcrumb: String(row.breadcrumb ?? ""),
          text: truncateText(String(row.text ?? ""), MAX_EVIDENCE_TEXT_CHARS),
        });
      }
      const retrievalStatus = String(retrieval.status ?? "ok").trim() || "ok";
      const normalizedRetrievalStatus = retrievalStatus.toLowerCase();
      const retrievalWarnings = [];
      const retrievalError = typeof retrieval.error === "string" ? retrieval.error.trim() : "";
      if (retrievalError || normalizedRetrievalStatus !== "ok") {
        const rawFailure = retrievalError || `contextweaver retrieval status=${retrievalStatus}`;
        const classified = classifyContextWeaverFailure(rawFailure, "prompt_enhancer_failed");
        retrievalWarnings.push(`source ${source} retrieval failed: ${truncateText(classified.message, MAX_WARNING_CHARS)}`);
        return {
          sourceStat: {
            source,
            root_path: rootPath,
            status: "error",
            error_class: classified.errorClass,
          },
          evidence: [],
          topPaths: [],
          technicalTerms: [],
          warnings: retrievalWarnings,
          errorClass: classified.errorClass,
          language: languageHint,
        };
      }
      return {
        sourceStat: {
          source,
          root_path: rootPath,
          status: "ok",
        },
        evidence: evidenceRows,
        topPaths: pathRows,
        technicalTerms: termRows,
        warnings: retrievalWarnings,
        errorClass: "",
        language: languageHint,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorClass = normalizeToolErrorClass(error?.errorClass, "prompt_enhancer_failed");
      return {
        sourceStat: {
          source,
          root_path: rootPath,
          status: "error",
          error_class: errorClass,
        },
        evidence: [],
        topPaths: [],
        technicalTerms: [],
        warnings: [`source ${source} failed: ${truncateText(message, MAX_WARNING_CHARS)}`],
        errorClass,
        language: "",
      };
    }
  });

  for (const row of sourceResults) {
    sourceStats.push(row.sourceStat);
    evidence.push(...row.evidence);
    topPaths.push(...row.topPaths);
    warnings.push(...row.warnings);
    for (const term of row.technicalTerms) {
      technicalTerms.add(term);
    }
    if (row.language && row.language.trim()) {
      language = row.language;
    }
    if (row.errorClass) {
      errorClasses.push(row.errorClass);
    }
  }

  const okCount = sourceStats.filter((row) => {
    const status = String(row.status ?? "").trim().toLowerCase();
    return status === "ok";
  }).length;
  if (okCount === 0) {
    const errorClass = pickDominantErrorClass(errorClasses, "prompt_enhancer_failed");
    throw createError(
      errorClass,
      warnings.join("; ") || "prompt enhancer failed for all sources",
    );
  }

  evidence.sort((left, right) => right.score - left.score);
  const selectedEvidence = evidence.slice(0, maxEvidence);
  const dedupTopPaths = [];
  const topPathSeen = new Set();
  for (const row of topPaths) {
    const normalized = String(row ?? "").trim();
    if (!normalized || topPathSeen.has(normalized)) {
      continue;
    }
    topPathSeen.add(normalized);
    dedupTopPaths.push(normalized);
    if (dedupTopPaths.length >= maxEvidence) {
      break;
    }
  }
  const contextLines = [];
  contextLines.push("[Enhanced Context]");
  contextLines.push(`language=${language}`);
  contextLines.push(`technical_terms=${Array.from(technicalTerms).join(", ") || "<none>"}`);
  for (const item of selectedEvidence.slice(0, 8)) {
    const location = `${item.path}:L${String(item.start_line)}-${String(item.end_line)}`;
    contextLines.push(`- [${item.source}] ${location} score=${item.score.toFixed(3)}`);
  }

  return {
    tool: "prompt_enhancer",
    language,
    technical_terms: Array.from(technicalTerms),
    top_paths: dedupTopPaths,
    evidence: selectedEvidence,
    context_block: contextLines.join("\n"),
    source_stats: sourceStats,
    warnings,
    duration_ms: 0,
  };
}

function runMock(command, payload) {
  if (command === "semantic-search") {
    return {
      tool: "semantic_search",
      query: String(payload.query ?? ""),
      count: 1,
      source_stats: [{ source: "code", root_path: String(process.cwd()), status: "ok", count: 1 }],
      matches: [{
        source: "code",
        root_path: String(process.cwd()),
        path: "src/main.ts",
        start_line: 10,
        end_line: 20,
        score: 0.91,
        breadcrumb: "main > handler",
        text: "mock semantic search result",
      }],
      warnings: [],
      duration_ms: 0,
    };
  }
  return {
    tool: "prompt_enhancer",
    language: "en",
    technical_terms: ["mockTerm"],
    top_paths: ["[code] src/main.ts"],
    evidence: [{
      source: "code",
      root_path: String(process.cwd()),
      path: "src/main.ts",
      start_line: 10,
      end_line: 20,
      score: 0.87,
      breadcrumb: "main > handler",
      text: "mock prompt enhancer evidence",
    }],
    context_block: "[Enhanced Context]\nlanguage=en\ntechnical_terms=mockTerm",
    source_stats: [{ source: "code", root_path: String(process.cwd()), status: "ok" }],
    warnings: [],
    duration_ms: 0,
  };
}

async function runMain(argv) {
  const startedAt = Date.now();
  const { command, payload, timeoutMs } = parseArgs(argv);
  if (command !== "semantic-search" && command !== "prompt-enhancer") {
    throw createError("semantic_invalid_request", `unsupported bridge command: ${command}`);
  }
  const useMock = String(process.env.GROBOT_CONTEXTWEAVER_BRIDGE_MOCK ?? "").trim() === "1";
  const result = useMock
    ? runMock(command, payload)
    : command === "semantic-search"
      ? await runSemanticSearch(payload, timeoutMs)
      : await runPromptEnhancer(payload, timeoutMs);
  result.duration_ms = Date.now() - startedAt;
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

runMain(process.argv.slice(2)).catch((error) => {
  const errorClass = typeof error?.errorClass === "string" && error.errorClass.trim()
    ? error.errorClass.trim()
    : "semantic_search_failed";
  const message = error instanceof Error ? error.message : String(error);
  const payload = {
    error_class: errorClass,
    message,
  };
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
});
