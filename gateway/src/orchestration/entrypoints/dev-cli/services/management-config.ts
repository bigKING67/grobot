import { readFileSync } from "node:fs";
import { OptionValue, readOptionString } from "../cli-args";

const CONFIG_READ_POLICY_AUTO = "auto";
const CONFIG_READ_POLICY_PUBLIC = "public";
const CONFIG_READ_POLICY_AUTH = "auth";
const CONFIG_READ_POLICY_DISABLED = "disabled";

type ConfigReadPolicy =
  | typeof CONFIG_READ_POLICY_AUTO
  | typeof CONFIG_READ_POLICY_PUBLIC
  | typeof CONFIG_READ_POLICY_AUTH
  | typeof CONFIG_READ_POLICY_DISABLED;

export interface ResolvedConfigReadPolicy {
  configuredPolicy: ConfigReadPolicy;
  configuredSource: string;
  effectivePolicy: Exclude<ConfigReadPolicy, "auto">;
  reason: string;
}

function fileReadable(path: string): boolean {
  try {
    const content = readFileSync(path, "utf8");
    return content.length >= 0;
  } catch {
    return false;
  }
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
    if (kvMatch[1] !== "config_read_policy") {
      continue;
    }
    return parseTomlString(kvMatch[2]);
  }
  return undefined;
}

function parseManagementTokenFromToml(rawToml: string): string | undefined {
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
    if (kvMatch[1] !== "token") {
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

export function readManagementTokenFromToml(configTomlPath?: string): string | undefined {
  if (!configTomlPath || !fileReadable(configTomlPath)) {
    return undefined;
  }
  try {
    const raw = readFileSync(configTomlPath, "utf8");
    const token = parseManagementTokenFromToml(raw);
    if (typeof token === "string" && token.trim().length > 0) {
      return token.trim();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function resolveConfigReadPolicy(
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
