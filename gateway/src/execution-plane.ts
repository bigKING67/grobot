import { readFileSync } from "node:fs";
import { GatewayImpl, RuntimeImpl } from "./types";

export const ENV_EXECUTION_GATEWAY_IMPL = "GROBOT_GATEWAY_IMPL";
export const ENV_EXECUTION_RUNTIME_IMPL = "GROBOT_RUNTIME_IMPL";
export const ENV_EXECUTION_SHADOW_MODE = "GROBOT_SHADOW_MODE";

const DEFAULT_GATEWAY_IMPL: GatewayImpl = "ts";
const DEFAULT_RUNTIME_IMPL: RuntimeImpl = "rust";
const DEFAULT_SHADOW_MODE = false;

export interface ExecutionPlaneConfig {
  gatewayImpl: GatewayImpl;
  runtimeImpl: RuntimeImpl;
  shadowMode: boolean;
  gatewayImplSource: string;
  runtimeImplSource: string;
  shadowModeSource: string;
}

interface ResolveExecutionPlaneOptions {
  gatewayImplArg?: string;
  runtimeImplArg?: string;
  shadowModeArg?: boolean;
  noShadowModeArg?: boolean;
  projectTomlPath?: string;
}

interface ProjectExecutionConfig {
  gatewayImplRaw?: string;
  runtimeImplRaw?: string;
  shadowModeRaw?: string;
  sourcePath?: string;
}

function parseGatewayImpl(value: string | undefined): GatewayImpl | undefined {
  if (value === "ts") {
    return value;
  }
  return undefined;
}

function parseRuntimeImpl(value: string | undefined): RuntimeImpl | undefined {
  if (value === "rust") {
    return value;
  }
  return undefined;
}

function parseBool(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "on" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "off" || normalized === "no") {
    return false;
  }
  return undefined;
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

function parseProjectExecutionConfig(rawToml: string): ProjectExecutionConfig {
  const lines = rawToml.split(/\r?\n/);
  let inExecutionSection = false;
  const project: ProjectExecutionConfig = {};
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      inExecutionSection = sectionMatch[1] === "execution";
      continue;
    }
    if (!inExecutionSection) {
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kvMatch) {
      continue;
    }
    const key = kvMatch[1];
    const value = parseTomlString(kvMatch[2]);
    if (!value) {
      continue;
    }
    if (key === "gateway_impl") {
      project.gatewayImplRaw = value;
      continue;
    }
    if (key === "runtime_impl") {
      project.runtimeImplRaw = value;
      continue;
    }
    if (key === "shadow_mode") {
      project.shadowModeRaw = value;
    }
  }
  return project;
}

function readProjectExecutionConfig(projectTomlPath?: string): ProjectExecutionConfig {
  if (!projectTomlPath) {
    return {};
  }
  try {
    const raw = readFileSync(projectTomlPath, "utf8");
    const parsed = parseProjectExecutionConfig(raw);
    parsed.sourcePath = projectTomlPath;
    return parsed;
  } catch {
    return {};
  }
}

export function resolveExecutionPlaneConfig(
  options: ResolveExecutionPlaneOptions = {},
): ExecutionPlaneConfig {
  const projectConfig = readProjectExecutionConfig(options.projectTomlPath);
  let gatewayImpl = DEFAULT_GATEWAY_IMPL;
  let runtimeImpl = DEFAULT_RUNTIME_IMPL;
  let shadowMode = DEFAULT_SHADOW_MODE;
  let gatewayImplSource = "default";
  let runtimeImplSource = "default";
  let shadowModeSource = "default";

  const projectGateway = parseGatewayImpl(projectConfig.gatewayImplRaw);
  if (projectGateway) {
    gatewayImpl = projectGateway;
    gatewayImplSource = projectConfig.sourcePath
      ? `project_toml:${projectConfig.sourcePath}`
      : "project_toml";
  }
  const envGateway = parseGatewayImpl(process.env[ENV_EXECUTION_GATEWAY_IMPL]);
  if (envGateway) {
    gatewayImpl = envGateway;
    gatewayImplSource = `env:${ENV_EXECUTION_GATEWAY_IMPL}`;
  }
  const cliGateway = parseGatewayImpl(options.gatewayImplArg);
  if (cliGateway) {
    gatewayImpl = cliGateway;
    gatewayImplSource = "cli";
  }

  const projectRuntime = parseRuntimeImpl(projectConfig.runtimeImplRaw);
  if (projectRuntime) {
    runtimeImpl = projectRuntime;
    runtimeImplSource = projectConfig.sourcePath
      ? `project_toml:${projectConfig.sourcePath}`
      : "project_toml";
  }
  const envRuntime = parseRuntimeImpl(process.env[ENV_EXECUTION_RUNTIME_IMPL]);
  if (envRuntime) {
    runtimeImpl = envRuntime;
    runtimeImplSource = `env:${ENV_EXECUTION_RUNTIME_IMPL}`;
  }
  const cliRuntime = parseRuntimeImpl(options.runtimeImplArg);
  if (cliRuntime) {
    runtimeImpl = cliRuntime;
    runtimeImplSource = "cli";
  }

  const projectShadow = parseBool(projectConfig.shadowModeRaw);
  if (typeof projectShadow === "boolean") {
    shadowMode = projectShadow;
    shadowModeSource = projectConfig.sourcePath
      ? `project_toml:${projectConfig.sourcePath}`
      : "project_toml";
  }
  const envShadow = parseBool(process.env[ENV_EXECUTION_SHADOW_MODE]);
  if (typeof envShadow === "boolean") {
    shadowMode = envShadow;
    shadowModeSource = `env:${ENV_EXECUTION_SHADOW_MODE}`;
  }
  if (options.shadowModeArg) {
    shadowMode = true;
    shadowModeSource = "cli";
  } else if (options.noShadowModeArg) {
    shadowMode = false;
    shadowModeSource = "cli";
  }

  return {
    gatewayImpl,
    runtimeImpl,
    shadowMode,
    gatewayImplSource,
    runtimeImplSource,
    shadowModeSource,
  };
}
