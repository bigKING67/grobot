import { readFileSync } from "node:fs";
import { resolveExecutionPlaneConfig } from "../../../execution-plane";
import { buildSessionKey } from "../../../../models/session-key";
import { hasFlag, OptionValue, readOptionString } from "../cli-args";
import { probeProviderModels, readProviderSnapshotFromToml } from "../provider-probe";
import { resolveRuntimeBinaryPath, runRuntimeHealthcheck } from "../runtime-health";
import { maskSecret } from "../services/redaction";
import {
  basenameFromPath,
  resolveConfigTomlPath,
  resolveHomeDir,
  resolveProjectRoot,
  resolveProjectTomlPath,
  resolveWorkDir,
} from "../services/runtime-paths";
import {
  parsePlatform,
  parseScope,
  resolveSessionPlatformOption,
  resolveSessionScopeOption,
  resolveSessionSubjectOption,
} from "../start/session-options";

const DEFAULT_RUNTIME_ENABLED_TOOLS = [
  "list",
  "glob",
  "search",
  "read",
  "write",
  "edit",
  "bash",
  "mcp_servers",
  "mcp_call",
];

function stripInlineComment(rawLine: string): string {
  const hashIndex = rawLine.indexOf("#");
  if (hashIndex < 0) {
    return rawLine;
  }
  return rawLine.slice(0, hashIndex);
}

function parseTomlStringArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }
  const content = trimmed.slice(1, -1).trim();
  if (content.length === 0) {
    return [];
  }
  const items: string[] = [];
  for (const part of content.split(",")) {
    const value = part.trim();
    if (!value.startsWith("\"") || !value.endsWith("\"")) {
      continue;
    }
    const normalized = value.slice(1, -1).trim();
    if (normalized.length === 0) {
      continue;
    }
    items.push(normalized);
  }
  return items;
}

function readToolsAllowlistFromProjectToml(projectTomlPath?: string): string[] {
  if (!projectTomlPath) {
    return [];
  }
  let raw = "";
  try {
    raw = readFileSync(projectTomlPath, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split(/\r?\n/);
  let inToolsSection = false;
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      inToolsSection = sectionMatch[1] === "tools";
      continue;
    }
    if (!inToolsSection) {
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch || kvMatch[1] !== "allow") {
      continue;
    }
    return parseTomlStringArray(kvMatch[2]);
  }
  return [];
}

function resolveRuntimeToolContextPreview(projectTomlPath: string | undefined): {
  enabledTools: string[];
  bashAllowlist: string[];
  maxToolRounds: number;
} {
  const maxToolRoundsRaw = process.env.GROBOT_MAX_TOOL_ROUNDS;
  const parsedMaxToolRounds =
    typeof maxToolRoundsRaw === "string" && /^\d+$/.test(maxToolRoundsRaw.trim())
      ? Number.parseInt(maxToolRoundsRaw.trim(), 10)
      : undefined;
  const maxToolRounds =
    typeof parsedMaxToolRounds === "number" && Number.isFinite(parsedMaxToolRounds)
      ? Math.min(Math.max(parsedMaxToolRounds, 1), 32)
      : 8;
  const bashAllowlist = readToolsAllowlistFromProjectToml(projectTomlPath);
  return {
    enabledTools: [...DEFAULT_RUNTIME_ENABLED_TOOLS],
    bashAllowlist,
    maxToolRounds,
  };
}

export async function runStatus(options: Record<string, OptionValue>): Promise<number> {
  const homeDir = resolveHomeDir(options);
  const projectRoot = resolveProjectRoot(options, homeDir);
  const workDir = resolveWorkDir(options, projectRoot, homeDir);
  const projectTomlPath = resolveProjectTomlPath(options, workDir, projectRoot, homeDir);
  const configTomlPath = resolveConfigTomlPath(options, homeDir, { workDir, projectRoot });
  const configSource =
    configTomlPath == null
      ? "none"
      : configTomlPath.startsWith(`${workDir}/.grobot/`)
        ? "project_work_dir"
        : configTomlPath.startsWith(`${projectRoot}/.grobot/`)
          ? "project_root"
          : configTomlPath.startsWith(`${homeDir}/`)
            ? "home"
            : "custom";
  const projectName = readOptionString(options, "project") ?? basenameFromPath(workDir);
  const sessionScopeRaw = resolveSessionScopeOption(options);
  const sessionSubject = resolveSessionSubjectOption(options) ?? process.env.USER ?? "user";
  const providerOverride = readOptionString(options, "provider");
  const projectProviderSnapshot = readProviderSnapshotFromToml(
    configTomlPath,
    projectName,
    workDir,
    homeDir,
    providerOverride,
  );
  const providerName = providerOverride ??
    process.env.GROBOT_PROVIDER ??
    projectProviderSnapshot?.providerName ??
    "<auto>";
  const modelName = readOptionString(options, "model") ??
    process.env.GROBOT_MODEL ??
    projectProviderSnapshot?.provider?.model ??
    "<auto>";
  const baseUrl = readOptionString(options, "base-url") ??
    process.env.GROBOT_BASE_URL ??
    projectProviderSnapshot?.provider?.baseUrl ??
    "<auto>";
  const apiKey = readOptionString(options, "api-key") ??
    process.env.GROBOT_API_KEY ??
    projectProviderSnapshot?.provider?.apiKey;
  const sessionPreview = buildSessionKey({
    platform: parsePlatform(resolveSessionPlatformOption(options)),
    tenant: readOptionString(options, "tenant") ?? projectName,
    scope: parseScope(sessionScopeRaw),
    subject: sessionSubject,
  });
  const executionPlane = resolveExecutionPlaneConfig({
    gatewayImplArg: readOptionString(options, "gateway-impl"),
    runtimeImplArg: readOptionString(options, "runtime-impl"),
    shadowModeArg: hasFlag(options, "shadow-mode"),
    noShadowModeArg: hasFlag(options, "no-shadow-mode"),
    projectTomlPath,
  });
  const runtimeToolContextPreview = resolveRuntimeToolContextPreview(projectTomlPath);

  process.stdout.write("status: ok\n");
  process.stdout.write("engine: ts-dev-cli\n");
  process.stdout.write(`home: ${homeDir}\n`);
  process.stdout.write(`project_root: ${projectRoot}\n`);
  process.stdout.write(`work_dir: ${workDir}\n`);
  process.stdout.write(`config_toml: ${configTomlPath ?? "<not-found>"}\n`);
  process.stdout.write(`config_source: ${configSource}\n`);
  process.stdout.write(`project_toml: ${projectTomlPath ?? "<not-found>"}\n`);
  process.stdout.write(`project: ${projectName}\n`);
  process.stdout.write(`provider: ${providerName}\n`);
  if (projectProviderSnapshot?.source) {
    process.stdout.write(`provider_source: ${projectProviderSnapshot.source}\n`);
  }
  process.stdout.write(`model: ${modelName}\n`);
  process.stdout.write(`base_url: ${baseUrl}\n`);
  process.stdout.write(`api_key: ${maskSecret(apiKey)}\n`);
  process.stdout.write(`session_scope: ${parseScope(sessionScopeRaw)}\n`);
  process.stdout.write(`session_subject: ${sessionSubject}\n`);
  process.stdout.write(`session_preview: ${sessionPreview}\n`);
  process.stdout.write(
    `execution: gateway=${executionPlane.gatewayImpl}(${executionPlane.gatewayImplSource}) runtime=${executionPlane.runtimeImpl}(${executionPlane.runtimeImplSource}) shadow=${executionPlane.shadowMode ? "on" : "off"}(${executionPlane.shadowModeSource})\n`,
  );
  process.stdout.write("runtime_tool_context: enabled (start-default)\n");
  process.stdout.write(`runtime_tool_work_dir: ${workDir}\n`);
  process.stdout.write(
    `runtime_tool_enabled_tools: ${runtimeToolContextPreview.enabledTools.join(",")}\n`,
  );
  process.stdout.write(
    `runtime_tool_bash_allowlist: ${runtimeToolContextPreview.bashAllowlist.length > 0 ? runtimeToolContextPreview.bashAllowlist.join(",") : "<empty>"}\n`,
  );
  process.stdout.write(`runtime_tool_max_tool_rounds: ${runtimeToolContextPreview.maxToolRounds}\n`);

  if (executionPlane.runtimeImpl === "rust") {
    const runtimeBinaryPath = resolveRuntimeBinaryPath();
    const health = runRuntimeHealthcheck(runtimeBinaryPath);
    process.stdout.write(
      `runtime_health: ${health.ok ? "ok" : "warn"} (${runtimeBinaryPath}) ${health.detail}\n`,
    );
  }
  if (hasFlag(options, "probe")) {
    const probeBaseUrl = readOptionString(options, "base-url") ??
      process.env.GROBOT_BASE_URL ??
      projectProviderSnapshot?.provider?.baseUrl;
    const probeApiKey = readOptionString(options, "api-key") ??
      process.env.GROBOT_API_KEY ??
      projectProviderSnapshot?.provider?.apiKey;
    const probeModel = readOptionString(options, "model") ??
      process.env.GROBOT_MODEL ??
      projectProviderSnapshot?.provider?.model;
    if (!probeBaseUrl || !probeApiKey) {
      process.stdout.write("probe: skipped (missing base_url/api_key)\n");
      return 2;
    }
    const probe = await probeProviderModels(probeBaseUrl, probeApiKey, probeModel);
    process.stdout.write(`probe: ${probe.state} ${probe.detail}\n`);
    if (typeof probe.httpStatus === "number" && probe.httpStatus > 0) {
      process.stdout.write(`probe_http_status: ${probe.httpStatus}\n`);
    }
    if (typeof probe.modelCount === "number") {
      process.stdout.write(`probe_model_count: ${probe.modelCount}\n`);
    }
    if (typeof probe.selectedModel === "string" && probe.selectedModel.length > 0) {
      process.stdout.write(
        `probe_selected_model: ${probe.selectedModel} (${probe.selectedFound ? "found" : "missing"})\n`,
      );
    }
    if (typeof probe.resolvedModel === "string" && probe.resolvedModel.length > 0) {
      process.stdout.write(
        `probe_resolved_model: ${probe.resolvedModel}${probe.autoSelected ? " (auto)" : ""}\n`,
      );
    }
    if (probe.state !== "ok") {
      return 1;
    }
  }
  return 0;
}
