import { readFileSync } from "node:fs";
import { resolveExecutionPlaneConfig } from "../../../execution-plane";
import { buildSessionKey } from "../../../../models/session-key";
import { hasFlag, OptionValue, readOptionString } from "../cli-args";
import { probeProviderModels, readProviderSnapshotFromToml } from "../provider-probe";
import {
  buildToolsManifestFingerprint,
  resolveRuntimeBinaryPath,
  runRuntimeHealthcheck,
  runRuntimeToolsDescribe,
} from "../runtime-health";
import { maskSecret } from "../services/redaction";
import { buildDefaultRuntimeEnabledTools } from "../../../../tools/runtime/default-enabled-tools";
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

function resolveRuntimeToolContextPreview(projectTomlPath: string | undefined, runtimeBinaryPath?: string): {
  enabledTools: string[];
  enabledToolsSource: "runtime.tools.describe" | "start-default";
  enabledToolsSourceDetail?: string;
  manifestFingerprint: string;
  manifestToolCount: number;
  manifestDefaultEnabledCount: number;
  bashAllowlist: string[];
  maxToolRounds: number;
  noToolFallbackMode: "off" | "safe" | "strict";
  maxRecoveryRounds: number;
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
  const noToolFallbackModeRaw = process.env.GROBOT_NO_TOOL_FALLBACK_MODE?.trim().toLowerCase();
  const noToolFallbackMode = noToolFallbackModeRaw === "off"
    || noToolFallbackModeRaw === "safe"
    || noToolFallbackModeRaw === "strict"
    ? noToolFallbackModeRaw
    : "safe";
  const maxRecoveryRoundsRaw = process.env.GROBOT_MAX_RECOVERY_ROUNDS;
  const parsedMaxRecoveryRounds =
    typeof maxRecoveryRoundsRaw === "string" && /^\d+$/.test(maxRecoveryRoundsRaw.trim())
      ? Number.parseInt(maxRecoveryRoundsRaw.trim(), 10)
      : undefined;
  const maxRecoveryRounds =
    typeof parsedMaxRecoveryRounds === "number" && Number.isFinite(parsedMaxRecoveryRounds)
      ? Math.min(Math.max(parsedMaxRecoveryRounds, 0), 8)
      : 2;
  const described = runtimeBinaryPath ? runRuntimeToolsDescribe(runtimeBinaryPath) : undefined;
  const hasRuntimeDefaultEnabledTools = Boolean(
    described?.ok && Array.isArray(described.defaultEnabledTools) && described.defaultEnabledTools.length > 0,
  );
  const enabledTools = hasRuntimeDefaultEnabledTools && described
    ? [...described.defaultEnabledTools]
    : buildDefaultRuntimeEnabledTools();
  const manifestToolNames = hasRuntimeDefaultEnabledTools && described
    ? [...described.toolNames]
    : [...enabledTools];
  const manifestFingerprint = hasRuntimeDefaultEnabledTools && described
    ? described.manifestFingerprint
    : `fallback:${buildToolsManifestFingerprint(manifestToolNames, enabledTools)}`;
  const enabledToolsSource = hasRuntimeDefaultEnabledTools
    ? "runtime.tools.describe"
    : "start-default";
  const bashAllowlist = readToolsAllowlistFromProjectToml(projectTomlPath);
  return {
    enabledTools,
    enabledToolsSource,
    enabledToolsSourceDetail:
      enabledToolsSource === "start-default" && described && described.detail
        ? described.detail
        : undefined,
    manifestFingerprint,
    manifestToolCount: manifestToolNames.length,
    manifestDefaultEnabledCount: enabledTools.length,
    bashAllowlist,
    maxToolRounds,
    noToolFallbackMode,
    maxRecoveryRounds,
  };
}

export async function runStatus(options: Record<string, OptionValue>): Promise<number> {
  const outputJson = hasFlag(options, "json");
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
  const runtimeBinaryPath = executionPlane.runtimeImpl === "rust" ? resolveRuntimeBinaryPath() : undefined;
  const runtimeToolContextPreview = resolveRuntimeToolContextPreview(projectTomlPath, runtimeBinaryPath);
  const parsedScope = parseScope(sessionScopeRaw);
  const maskedApiKey = maskSecret(apiKey);
  const runtimeHealth =
    executionPlane.runtimeImpl === "rust" && runtimeBinaryPath
      ? runRuntimeHealthcheck(runtimeBinaryPath)
      : undefined;

  let probeResult:
    | {
      state: string;
      detail: string;
      httpStatus?: number;
      modelCount?: number;
      selectedModel?: string;
      selectedFound?: boolean;
      resolvedModel?: string;
      autoSelected?: boolean;
    }
    | undefined;
  let exitCode = 0;
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
      probeResult = {
        state: "skipped",
        detail: "(missing base_url/api_key)",
      };
      exitCode = 2;
    } else {
      const probe = await probeProviderModels(probeBaseUrl, probeApiKey, probeModel);
      probeResult = {
        state: probe.state,
        detail: probe.detail,
        httpStatus: probe.httpStatus,
        modelCount: probe.modelCount,
        selectedModel: probe.selectedModel,
        selectedFound: probe.selectedFound,
        resolvedModel: probe.resolvedModel,
        autoSelected: probe.autoSelected,
      };
      if (probe.state !== "ok") {
        exitCode = 1;
      }
    }
  }

  if (outputJson) {
    const payload: Record<string, unknown> = {
      status: "ok",
      engine: "ts-dev-cli",
      home: homeDir,
      project_root: projectRoot,
      work_dir: workDir,
      config_toml: configTomlPath ?? null,
      config_source: configSource,
      project_toml: projectTomlPath ?? null,
      project: projectName,
      provider: providerName,
      provider_source: projectProviderSnapshot?.source ?? null,
      model: modelName,
      base_url: baseUrl,
      api_key: maskedApiKey,
      session_scope: parsedScope,
      session_subject: sessionSubject,
      session_preview: sessionPreview,
      execution: {
        gateway_impl: executionPlane.gatewayImpl,
        gateway_impl_source: executionPlane.gatewayImplSource,
        runtime_impl: executionPlane.runtimeImpl,
        runtime_impl_source: executionPlane.runtimeImplSource,
        shadow_mode: executionPlane.shadowMode,
        shadow_mode_source: executionPlane.shadowModeSource,
      },
      runtime_tools: {
        context: "enabled",
        enabled_tools_source: runtimeToolContextPreview.enabledToolsSource,
        enabled_tools_source_detail: runtimeToolContextPreview.enabledToolsSourceDetail ?? null,
        manifest_fingerprint: runtimeToolContextPreview.manifestFingerprint,
        manifest_tool_count: runtimeToolContextPreview.manifestToolCount,
        manifest_default_enabled_count: runtimeToolContextPreview.manifestDefaultEnabledCount,
        work_dir: workDir,
        enabled_tools: runtimeToolContextPreview.enabledTools,
        bash_allowlist: runtimeToolContextPreview.bashAllowlist,
        max_tool_rounds: runtimeToolContextPreview.maxToolRounds,
        no_tool_fallback_mode: runtimeToolContextPreview.noToolFallbackMode,
        max_recovery_rounds: runtimeToolContextPreview.maxRecoveryRounds,
      },
      runtime_health:
        runtimeHealth && runtimeBinaryPath
          ? {
            ok: runtimeHealth.ok,
            detail: runtimeHealth.detail,
            binary_path: runtimeBinaryPath,
            overlap_guard_metrics: runtimeHealth.overlapGuardMetrics
              ? {
                blocked_total: runtimeHealth.overlapGuardMetrics.blockedTotal,
                blocked_search: runtimeHealth.overlapGuardMetrics.blockedSearch,
                blocked_semantic: runtimeHealth.overlapGuardMetrics.blockedSemantic,
                recorded_broad_search: runtimeHealth.overlapGuardMetrics.recordedBroadSearch,
                recorded_broad_semantic: runtimeHealth.overlapGuardMetrics.recordedBroadSemantic,
                tracked_turn_keys: runtimeHealth.overlapGuardMetrics.trackedTurnKeys,
                tracked_turn_order: runtimeHealth.overlapGuardMetrics.trackedTurnOrder,
                max_turn_keys: runtimeHealth.overlapGuardMetrics.maxTurnKeys,
              }
              : null,
          }
          : null,
      probe:
        probeResult == null
          ? null
          : {
            state: probeResult.state,
            detail: probeResult.detail,
            http_status: probeResult.httpStatus ?? null,
            model_count: probeResult.modelCount ?? null,
            selected_model: probeResult.selectedModel ?? null,
            selected_found: probeResult.selectedFound ?? null,
            resolved_model: probeResult.resolvedModel ?? null,
            auto_selected: probeResult.autoSelected ?? null,
          },
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return exitCode;
  }

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
  process.stdout.write(`api_key: ${maskedApiKey}\n`);
  process.stdout.write(`session_scope: ${parsedScope}\n`);
  process.stdout.write(`session_subject: ${sessionSubject}\n`);
  process.stdout.write(`session_preview: ${sessionPreview}\n`);
  process.stdout.write(
    `execution: gateway=${executionPlane.gatewayImpl}(${executionPlane.gatewayImplSource}) runtime=${executionPlane.runtimeImpl}(${executionPlane.runtimeImplSource}) shadow=${executionPlane.shadowMode ? "on" : "off"}(${executionPlane.shadowModeSource})\n`,
  );
  process.stdout.write(`runtime_tool_context: enabled (${runtimeToolContextPreview.enabledToolsSource})\n`);
  process.stdout.write(
    `runtime_tool_enabled_tools_source: ${runtimeToolContextPreview.enabledToolsSource}\n`,
  );
  if (runtimeToolContextPreview.enabledToolsSourceDetail) {
    process.stdout.write(
      `runtime_tool_enabled_tools_source_detail: ${runtimeToolContextPreview.enabledToolsSourceDetail}\n`,
    );
  }
  process.stdout.write(
    `runtime_tool_manifest_fingerprint: ${runtimeToolContextPreview.manifestFingerprint}\n`,
  );
  process.stdout.write(
    `runtime_tool_manifest_tool_count: ${runtimeToolContextPreview.manifestToolCount}\n`,
  );
  process.stdout.write(
    `runtime_tool_manifest_default_enabled_count: ${runtimeToolContextPreview.manifestDefaultEnabledCount}\n`,
  );
  process.stdout.write(`runtime_tool_work_dir: ${workDir}\n`);
  process.stdout.write(
    `runtime_tool_enabled_tools: ${runtimeToolContextPreview.enabledTools.join(",")}\n`,
  );
  process.stdout.write(
    `runtime_tool_bash_allowlist: ${runtimeToolContextPreview.bashAllowlist.length > 0 ? runtimeToolContextPreview.bashAllowlist.join(",") : "<empty>"}\n`,
  );
  process.stdout.write(`runtime_tool_max_tool_rounds: ${runtimeToolContextPreview.maxToolRounds}\n`);
  process.stdout.write(`runtime_tool_no_tool_fallback_mode: ${runtimeToolContextPreview.noToolFallbackMode}\n`);
  process.stdout.write(`runtime_tool_max_recovery_rounds: ${runtimeToolContextPreview.maxRecoveryRounds}\n`);

  if (runtimeHealth && runtimeBinaryPath) {
    process.stdout.write(
      `runtime_health: ${runtimeHealth.ok ? "ok" : "warn"} (${runtimeBinaryPath}) ${runtimeHealth.detail}\n`,
    );
    if (runtimeHealth.overlapGuardMetrics) {
      process.stdout.write(
        `runtime_overlap_guard: blocked_total=${runtimeHealth.overlapGuardMetrics.blockedTotal} blocked_search=${runtimeHealth.overlapGuardMetrics.blockedSearch} blocked_semantic=${runtimeHealth.overlapGuardMetrics.blockedSemantic} recorded_broad_search=${runtimeHealth.overlapGuardMetrics.recordedBroadSearch} recorded_broad_semantic=${runtimeHealth.overlapGuardMetrics.recordedBroadSemantic} tracked_turn_keys=${runtimeHealth.overlapGuardMetrics.trackedTurnKeys}/${runtimeHealth.overlapGuardMetrics.maxTurnKeys}\n`,
      );
    }
  }
  if (probeResult) {
    process.stdout.write(`probe: ${probeResult.state} ${probeResult.detail}\n`);
    if (typeof probeResult.httpStatus === "number" && probeResult.httpStatus > 0) {
      process.stdout.write(`probe_http_status: ${probeResult.httpStatus}\n`);
    }
    if (typeof probeResult.modelCount === "number") {
      process.stdout.write(`probe_model_count: ${probeResult.modelCount}\n`);
    }
    if (typeof probeResult.selectedModel === "string" && probeResult.selectedModel.length > 0) {
      process.stdout.write(
        `probe_selected_model: ${probeResult.selectedModel} (${probeResult.selectedFound ? "found" : "missing"})\n`,
      );
    }
    if (typeof probeResult.resolvedModel === "string" && probeResult.resolvedModel.length > 0) {
      process.stdout.write(
        `probe_resolved_model: ${probeResult.resolvedModel}${probeResult.autoSelected ? " (auto)" : ""}\n`,
      );
    }
  }
  return exitCode;
}
