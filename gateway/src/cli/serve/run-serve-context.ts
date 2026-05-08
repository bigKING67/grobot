import { hasFlag, OptionValue, readOptionString } from "../cli-args";
import { buildSessionKey } from "../../models/session-key";
import {
  readProviderPoolFromToml,
} from "../provider-probe";
import { readManagementTokenFromToml } from "../services/management-config";
import {
  basenameFromPath,
  resolveConfigTomlPath,
  resolveHomeDir,
  resolveInterruptStorePath,
  resolveMemoryStorePath,
  resolveProjectStateRoot,
  resolveProjectRoot,
  resolveProjectTomlPath,
  resolveWorkDir,
} from "../services/runtime-paths";
import { parseBind, type BindConfig } from "./bind-config";
import { memoryStoreRedisKey } from "./memory-store-runtime";
import {
  parsePlatform,
  parseScope,
  resolveSessionPlatformOption,
  resolveSessionScopeOption,
  resolveSessionSubjectOption,
} from "../start/session/options";
import {
  resolveRouteDecisionRuntimeSnapshot,
  type RouteDecisionSummary,
} from "../status/route-status";
import { parseRequiredPositiveInt } from "../status/option-parsing";
import { type Platform, type SessionScope } from "../../models/types";

interface ExecutionPlaneConfigInput {
  gatewayImplArg?: string;
  runtimeImplArg?: string;
  shadowModeArg?: boolean;
  noShadowModeArg?: boolean;
  projectTomlPath?: string;
}

export interface RunServeContext {
  options: Record<string, OptionValue>;
  homeDir: string;
  projectRoot: string;
  workDir: string;
  projectTomlPath: string | undefined;
  configTomlPath: string | undefined;
  bind: BindConfig;
  projectName: string;
  managementToken: string | undefined;
  routeDecisionInput: RunServeRouteDecisionInput;
  executionPlaneInput: ExecutionPlaneConfigInput;
  projectStateRoot: string;
  interruptStorePath: string;
  memoryStorePath: string;
  memoryStoreKey: string;
}

export interface RunServeRouteDecisionInput {
  homeDir: string;
  projectStateRoot: string;
  projectName: string;
  workDir: string;
  configTomlPath: string | undefined;
  providerOverrideFromCli?: string;
  providerOverrideFromEnv?: string;
  hasDirectRuntimeOverride: boolean;
  circuitFailures: number;
  circuitCooldownSecs: number;
  session: {
    platform: string | undefined;
    tenant: string;
    scope: string | undefined;
    subject: string;
  };
}

export class RunServeRouteDecisionInputError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(code: string, field: string, detail: string) {
    super(detail);
    this.name = "RunServeRouteDecisionInputError";
    this.code = code;
    this.field = field;
  }
}

export function isRunServeRouteDecisionInputError(
  error: unknown,
): error is RunServeRouteDecisionInputError {
  return error instanceof RunServeRouteDecisionInputError;
}

function resolveHasDirectRuntimeOverride(options: Record<string, OptionValue>): boolean {
  return Boolean(readOptionString(options, "base-url"))
    || Boolean(process.env.GROBOT_BASE_URL)
    || Boolean(readOptionString(options, "api-key"))
    || Boolean(process.env.GROBOT_API_KEY)
    || Boolean(readOptionString(options, "model"))
    || Boolean(process.env.GROBOT_MODEL);
}

function resolveRouteDecisionPlatform(
  override: string | undefined,
  fallback: string | undefined,
): Platform {
  if (override === undefined) {
    return parsePlatform(fallback);
  }
  const normalized = override.trim().toLowerCase();
  if (normalized === "feishu" || normalized === "telegram") {
    return normalized;
  }
  throw new RunServeRouteDecisionInputError(
    "invalid_session_platform",
    "platform",
    "platform must be one of: feishu, telegram",
  );
}

function resolveRouteDecisionScope(
  override: string | undefined,
  fallback: string | undefined,
): SessionScope {
  if (override === undefined) {
    return parseScope(fallback);
  }
  const normalized = override.trim().toLowerCase();
  if (normalized === "dm" || normalized === "group") {
    return normalized;
  }
  throw new RunServeRouteDecisionInputError(
    "invalid_session_scope",
    "session-scope",
    "session-scope must be one of: dm, group",
  );
}

function resolveRouteDecisionSessionSegment(input: {
  override: string | undefined;
  fallback: string;
  field: "tenant" | "session-subject";
}): string {
  const value = (input.override ?? input.fallback).trim();
  if (value.length === 0) {
    throw new RunServeRouteDecisionInputError(
      input.field === "tenant" ? "invalid_session_tenant" : "invalid_session_subject",
      input.field,
      `${input.field} must be non-empty`,
    );
  }
  if (value.includes(":")) {
    throw new RunServeRouteDecisionInputError(
      input.field === "tenant" ? "invalid_session_tenant" : "invalid_session_subject",
      input.field,
      `${input.field} must not contain ':'`,
    );
  }
  return value;
}

export function resolveRunServeRouteDecision(
  input: RunServeRouteDecisionInput,
  overrides?: {
    platform?: string;
    tenant?: string;
    scope?: string;
    subject?: string;
  },
): RouteDecisionSummary {
  const providerPoolSnapshot = readProviderPoolFromToml(
    input.configTomlPath,
    input.projectName,
    input.workDir,
    input.homeDir,
    input.providerOverrideFromCli,
  );
  const sessionNamespaceKey = buildSessionKey({
    platform: resolveRouteDecisionPlatform(overrides?.platform, input.session.platform),
    tenant: resolveRouteDecisionSessionSegment({
      override: overrides?.tenant,
      fallback: input.session.tenant,
      field: "tenant",
    }),
    scope: resolveRouteDecisionScope(overrides?.scope, input.session.scope),
    subject: resolveRouteDecisionSessionSegment({
      override: overrides?.subject,
      fallback: input.session.subject,
      field: "session-subject",
    }),
  });
  return resolveRouteDecisionRuntimeSnapshot({
    projectStateRoot: input.projectStateRoot,
    sessionNamespaceKey,
    providerOverride: input.providerOverrideFromCli,
    providerEnv: input.providerOverrideFromEnv,
    providerPoolSnapshot: providerPoolSnapshot
      ? {
          source: providerPoolSnapshot.source,
          providerName: providerPoolSnapshot.providerName,
          providers: providerPoolSnapshot.providers.map((provider) => ({
            name: provider.name,
          })),
        }
      : undefined,
    hasDirectRuntimeOverride: input.hasDirectRuntimeOverride,
    circuitFailures: input.circuitFailures,
    circuitCooldownSecs: input.circuitCooldownSecs,
  });
}

export function resolveRunServeContext(options: Record<string, OptionValue>): RunServeContext {
  const homeDir = resolveHomeDir(options);
  const projectRoot = resolveProjectRoot(options, homeDir);
  const workDir = resolveWorkDir(options, projectRoot, homeDir);
  const projectStateRoot = resolveProjectStateRoot(workDir);
  const projectTomlPath = resolveProjectTomlPath(options, workDir, projectRoot, homeDir);
  const configTomlPath = resolveConfigTomlPath(options, homeDir, { workDir, projectRoot });
  const bind = parseBind(readOptionString(options, "bind"));
  const projectName = readOptionString(options, "project") ?? basenameFromPath(workDir);
  const sessionSubject = resolveSessionSubjectOption(options) ?? process.env.USER ?? "user";
  const providerOverrideFromCli = readOptionString(options, "provider");
  const managementToken =
    readOptionString(options, "management-token") ??
    process.env.GROBOT_MANAGEMENT_TOKEN ??
    readManagementTokenFromToml(configTomlPath);
  const executionPlaneInput: ExecutionPlaneConfigInput = {
    gatewayImplArg: readOptionString(options, "gateway-impl"),
    runtimeImplArg: readOptionString(options, "runtime-impl"),
    shadowModeArg: hasFlag(options, "shadow-mode"),
    noShadowModeArg: hasFlag(options, "no-shadow-mode"),
    projectTomlPath,
  };
  const routeDecisionInput: RunServeRouteDecisionInput = {
    homeDir,
    projectStateRoot,
    projectName,
    workDir,
    configTomlPath,
    providerOverrideFromCli,
    providerOverrideFromEnv: process.env.GROBOT_PROVIDER,
    hasDirectRuntimeOverride: resolveHasDirectRuntimeOverride(options),
    circuitFailures: parseRequiredPositiveInt(readOptionString(options, "circuit-failures"), 2),
    circuitCooldownSecs: parseRequiredPositiveInt(readOptionString(options, "circuit-cooldown-secs"), 30),
    session: {
      platform: resolveSessionPlatformOption(options),
      tenant: readOptionString(options, "tenant") ?? projectName,
      scope: resolveSessionScopeOption(options),
      subject: sessionSubject,
    },
  };
  const interruptStorePath = resolveInterruptStorePath(projectStateRoot);
  const memoryStorePath = resolveMemoryStorePath(projectStateRoot);
  const memoryStoreKey = memoryStoreRedisKey(projectName, workDir);

  return {
    options,
    homeDir,
    projectRoot,
    workDir,
    projectTomlPath,
    configTomlPath,
    bind,
    projectName,
    managementToken,
    routeDecisionInput,
    executionPlaneInput,
    projectStateRoot,
    interruptStorePath,
    memoryStorePath,
    memoryStoreKey,
  };
}
