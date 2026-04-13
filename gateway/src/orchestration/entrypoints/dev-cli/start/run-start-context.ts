import { resolveExecutionPlaneConfig } from "../../../execution-plane";
import { type RuntimeModelConfig } from "../../../../models/types";
import { buildSessionKey } from "../../../../models/session-key";
import { hasFlag, OptionValue, readOptionString } from "../cli-args";
import { readProviderSnapshotFromToml } from "../provider-probe";
import {
  basenameFromPath,
  resolveConfigTomlPath,
  resolveHomeDir,
  resolveInterruptStorePath,
  resolveProjectRoot,
  resolveProjectTomlPath,
  resolveWorkDir,
} from "../services/runtime-paths";
import { createRunStartSessionStore } from "./run-start-session-store";
import { sessionRegistryFilePath } from "./session-registry";
import {
  parsePlatform,
  parseScope,
  resolveHandoffAutoOnExit,
  resolveHandoffRecentTurns,
  resolveHistoryTurns,
  resolveSessionPlatformOption,
  resolveSessionScopeOption,
  resolveSessionSubjectOption,
} from "./session-options";
import { buildHandoffPath } from "./run-start-io";

interface ResolvedRuntimeModelConfig {
  modelConfig?: RuntimeModelConfig;
  modelConfigSource: {
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: string;
  };
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function resolveRuntimeModelConfig(
  options: Record<string, OptionValue>,
  fallback: { baseUrl?: string; apiKey?: string; model?: string },
): ResolvedRuntimeModelConfig {
  const baseUrlFromCli = readOptionString(options, "base-url");
  const apiKeyFromCli = readOptionString(options, "api-key");
  const modelFromCli = readOptionString(options, "model");
  const timeoutFromCli = readOptionString(options, "runtime-http-timeout-ms");

  const baseUrl = baseUrlFromCli ?? process.env.GROBOT_BASE_URL ?? fallback.baseUrl;
  const apiKey = apiKeyFromCli ?? process.env.GROBOT_API_KEY ?? fallback.apiKey;
  const model = modelFromCli ?? process.env.GROBOT_MODEL ?? fallback.model;
  const timeoutMs = parseOptionalPositiveInt(
    timeoutFromCli ?? process.env.GROBOT_RUNTIME_HTTP_TIMEOUT_MS,
  );

  const source = {
    baseUrl: baseUrlFromCli ? "cli:base-url" : process.env.GROBOT_BASE_URL ? "env:GROBOT_BASE_URL" : fallback.baseUrl ? "config_toml:provider.base_url" : "unset",
    apiKey: apiKeyFromCli ? "cli:api-key" : process.env.GROBOT_API_KEY ? "env:GROBOT_API_KEY" : fallback.apiKey ? "config_toml:provider.api_key" : "unset",
    model: modelFromCli ? "cli:model" : process.env.GROBOT_MODEL ? "env:GROBOT_MODEL" : fallback.model ? "config_toml:provider.model" : "unset",
    timeoutMs: timeoutFromCli ? "cli:runtime-http-timeout-ms" : process.env.GROBOT_RUNTIME_HTTP_TIMEOUT_MS ? "env:GROBOT_RUNTIME_HTTP_TIMEOUT_MS" : "unset",
  };

  const modelConfig: RuntimeModelConfig = {};
  if (typeof baseUrl === "string" && baseUrl.trim().length > 0) {
    modelConfig.baseUrl = baseUrl.trim();
  }
  if (typeof apiKey === "string" && apiKey.trim().length > 0) {
    modelConfig.apiKey = apiKey.trim();
  }
  if (typeof model === "string" && model.trim().length > 0) {
    modelConfig.model = model.trim();
  }
  if (typeof timeoutMs === "number") {
    modelConfig.timeoutMs = timeoutMs;
  }

  return {
    modelConfig: Object.keys(modelConfig).length > 0 ? modelConfig : undefined,
    modelConfigSource: source,
  };
}

export function resolveRunStartContext(options: Record<string, OptionValue>) {
  const homeDir = resolveHomeDir(options);
  const projectRoot = resolveProjectRoot(options, homeDir);
  const workDir = resolveWorkDir(options, projectRoot, homeDir);
  const projectTomlPath = resolveProjectTomlPath(options, workDir, projectRoot, homeDir);
  const configTomlPath = resolveConfigTomlPath(options, homeDir);
  const projectName = readOptionString(options, "project") ?? basenameFromPath(workDir);
  const providerOverride = readOptionString(options, "provider");
  const providerSnapshot = readProviderSnapshotFromToml(
    configTomlPath,
    projectName,
    workDir,
    homeDir,
    providerOverride,
  );
  const runtimeModelConfig = resolveRuntimeModelConfig(options, {
    baseUrl: providerSnapshot?.provider?.baseUrl,
    apiKey: providerSnapshot?.provider?.apiKey,
    model: providerSnapshot?.provider?.model,
  });
  const historyTurns = resolveHistoryTurns(options);
  const handoffRecentTurns = resolveHandoffRecentTurns(options);
  const handoffAutoOnExit = resolveHandoffAutoOnExit(options);
  const handoffPath = buildHandoffPath(projectRoot);
  const interruptStorePath = resolveInterruptStorePath(homeDir);
  const subject = resolveSessionSubjectOption(options) ?? process.env.USER ?? "user";
  const executionPlane = resolveExecutionPlaneConfig({
    gatewayImplArg: readOptionString(options, "gateway-impl"),
    runtimeImplArg: readOptionString(options, "runtime-impl"),
    shadowModeArg: hasFlag(options, "shadow-mode"),
    noShadowModeArg: hasFlag(options, "no-shadow-mode"),
    projectTomlPath,
  });

  const sessionNamespace = {
    platform: parsePlatform(resolveSessionPlatformOption(options)),
    tenant: readOptionString(options, "tenant") ?? projectName,
    scope: parseScope(resolveSessionScopeOption(options)),
    subject,
  } as const;
  const sessionNamespaceKey = buildSessionKey(sessionNamespace);
  const sessionRegistryFilePathValue = sessionRegistryFilePath(homeDir, sessionNamespaceKey);
  const sessionStore = createRunStartSessionStore({
    options,
    projectTomlPath,
    homeDir,
    sessionNamespaceKey,
    historyTurns,
  });

  return {
    homeDir,
    projectRoot,
    workDir,
    projectName,
    historyTurns,
    handoffRecentTurns,
    handoffAutoOnExit,
    handoffPath,
    interruptStorePath,
    subject,
    executionPlane,
    sessionNamespaceKey,
    sessionRegistryFilePathValue,
    sessionStore,
    runtimeModelConfig: runtimeModelConfig.modelConfig,
    runtimeModelConfigSource: runtimeModelConfig.modelConfigSource,
  };
}
