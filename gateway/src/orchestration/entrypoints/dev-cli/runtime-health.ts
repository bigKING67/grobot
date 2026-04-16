import { spawnSync } from "node:child_process";

function removeTrailingSlashes(value: string): string {
  if (/^[\\/]+$/.test(value)) {
    return value.startsWith("\\") ? "\\" : "/";
  }
  return value.replace(/[\\/]+$/, "");
}

export function resolveRuntimeBinaryPath(): string {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRuntimeJsonRpcResult(stdout: string): {
  ok: boolean;
  detail: string;
  result?: Record<string, unknown>;
} {
  const firstLine = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) {
    return { ok: false, detail: "empty_stdout" };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(firstLine);
  } catch (error) {
    return { ok: false, detail: `json_parse_failed: ${String(error)}` };
  }
  if (!isRecord(payload)) {
    return { ok: false, detail: "invalid_json_payload" };
  }
  if (isRecord(payload.error)) {
    const errorCode = payload.error.code;
    const errorMessage = payload.error.message;
    return {
      ok: false,
      detail: `jsonrpc_error code=${String(errorCode)} message=${String(errorMessage)}`,
    };
  }
  const result = payload.result;
  if (!isRecord(result)) {
    return { ok: false, detail: "missing_result" };
  }
  return { ok: true, detail: "ok", result };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }
    rows.push(normalized);
  }
  return rows;
}

function dedupeStringArray(items: string[]): string[] {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const item of items) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    rows.push(normalized);
  }
  return rows;
}

export function buildToolsManifestFingerprint(toolNames: string[], defaultEnabledTools: string[]): string {
  const normalizedToolNames = [...dedupeStringArray(toolNames)].sort();
  const normalizedDefaultEnabledTools = [...dedupeStringArray(defaultEnabledTools)].sort();
  const payload = JSON.stringify({
    tool_names: normalizedToolNames,
    default_enabled_tools: normalizedDefaultEnabledTools,
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

export function runRuntimeHealthcheck(runtimeBinaryPath: string): {
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
  const parsed = parseRuntimeJsonRpcResult(String(run.stdout || ""));
  if (!parsed.ok || !parsed.result) {
    return { ok: false, detail: parsed.detail };
  }
  const status = parsed.result.status;
  if (status !== "ok") {
    return { ok: false, detail: `runtime_status=${String(status)}` };
  }
  return { ok: true, detail: "runtime.health=ok" };
}

export function runRuntimeToolsDescribe(runtimeBinaryPath: string): {
  ok: boolean;
  detail: string;
  toolNames: string[];
  defaultEnabledTools: string[];
  manifestFingerprint: string;
} {
  const input = JSON.stringify({
    jsonrpc: "2.0",
    id: "tools-describe-1",
    method: "runtime.tools.describe",
    params: {},
  });
  const run = spawnSync(runtimeBinaryPath, [], {
    input: `${input}\n`,
    encoding: "utf8",
    timeout: 4_000,
    maxBuffer: 1_048_576,
  });
    if (run.error) {
      return {
        ok: false,
        detail: `spawn_failed: ${String(run.error)}`,
        toolNames: [],
        defaultEnabledTools: [],
        manifestFingerprint: buildToolsManifestFingerprint([], []),
      };
    }
    if (run.status !== 0) {
      return {
        ok: false,
        detail: `exit_status_${String(run.status)} stderr=${String(run.stderr || "").trim()}`,
        toolNames: [],
        defaultEnabledTools: [],
        manifestFingerprint: buildToolsManifestFingerprint([], []),
      };
    }
  const parsed = parseRuntimeJsonRpcResult(String(run.stdout || ""));
    if (!parsed.ok || !parsed.result) {
      return {
        ok: false,
        detail: parsed.detail,
        toolNames: [],
        defaultEnabledTools: [],
        manifestFingerprint: buildToolsManifestFingerprint([], []),
      };
    }

    const defaultEnabledTools = dedupeStringArray(normalizeStringArray(parsed.result.default_enabled_tools));
    const rawTools = parsed.result.tools;
    const toolNames: string[] = [];
  if (Array.isArray(rawTools)) {
    for (const row of rawTools) {
      if (!isRecord(row) || !isRecord(row.function)) {
        continue;
      }
      const name = row.function.name;
      if (typeof name !== "string") {
        continue;
      }
      const normalized = name.trim();
      if (!normalized) {
        continue;
      }
        toolNames.push(normalized);
      }
    }
    const uniqueToolNames = dedupeStringArray(toolNames);
    const manifestFingerprint = buildToolsManifestFingerprint(uniqueToolNames, defaultEnabledTools);
    if (uniqueToolNames.length === 0) {
      return {
        ok: false,
        detail: "runtime_tools_describe_missing_tools",
        toolNames: uniqueToolNames,
        defaultEnabledTools,
        manifestFingerprint,
      };
    }
    if (defaultEnabledTools.length === 0) {
      return {
        ok: false,
        detail: "runtime_tools_describe_missing_default_enabled_tools",
        toolNames: uniqueToolNames,
        defaultEnabledTools,
        manifestFingerprint,
      };
    }
    const toolNameSet = new Set(uniqueToolNames);
    const unknownDefaultEnabled = defaultEnabledTools.filter((toolName) => !toolNameSet.has(toolName));
    if (unknownDefaultEnabled.length > 0) {
      return {
        ok: false,
        detail: `runtime_tools_describe_invalid_default_enabled_tools:${unknownDefaultEnabled.join(",")}`,
        toolNames: uniqueToolNames,
        defaultEnabledTools,
        manifestFingerprint,
      };
    }
    return {
      ok: true,
      detail: "runtime.tools.describe=ok",
      toolNames: uniqueToolNames,
      defaultEnabledTools,
      manifestFingerprint,
    };
  }
