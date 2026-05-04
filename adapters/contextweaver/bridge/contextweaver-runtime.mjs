import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEFAULT_TIMEOUT_MS,
  MAX_WARNING_CHARS,
  createError,
  isRecord,
  normalizeToolErrorClass,
  shouldRetryWithRefresh,
  stripAnsi,
  truncateText,
} from "./common.mjs";
import { applyContextWeaverEnvToProcess } from "./retrieval-config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..", "..", "..");
const contextWeaverLocalApiCache = new Map();

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

export async function resolveContextWeaverRuntime(env) {
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

export function classifyContextWeaverFailure(rawText, fallbackErrorClass) {
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

export async function runContextWeaverWithRefresh(params) {
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

export async function runContextWeaverLocalSearch(localApi, params) {
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

export async function runContextWeaverLocalPromptContext(localApi, params) {
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

export async function runContextWeaverLocalWithRefresh(params) {
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
