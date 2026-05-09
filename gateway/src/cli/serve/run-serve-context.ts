import {
  hasFlag,
  OptionValue,
  readExplicitOptionalNonEmptyString,
  readOptionString,
} from "../cli-args";
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
  resolveRouteDecisionRuntimeSnapshot,
  type RouteDecisionSummary,
} from "../status/route-status";
import { buildRouteDecisionSessionKey } from "../status/route-namespace";
import { parseExplicitRequiredPositiveIntOption } from "../status/option-parsing";
import { resolveCliRouteNamespace } from "../status/route-namespace-options";

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

function resolveHasDirectRuntimeOverride(options: Record<string, OptionValue>): boolean {
  return Boolean(readExplicitOptionalNonEmptyString(options, "base-url"))
    || Boolean(process.env.GROBOT_BASE_URL)
    || Boolean(readExplicitOptionalNonEmptyString(options, "api-key"))
    || Boolean(process.env.GROBOT_API_KEY)
    || Boolean(readExplicitOptionalNonEmptyString(options, "model"))
    || Boolean(process.env.GROBOT_MODEL);
}

function hasOption(options: Record<string, OptionValue>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(options, key);
}

export function resolveRunServeRouteDecision(
  input: RunServeRouteDecisionInput,
  overrides?: {
    platform?: string;
    platformProvided?: boolean;
    tenant?: string;
    tenantProvided?: boolean;
    scope?: string;
    scopeProvided?: boolean;
    subject?: string;
    subjectProvided?: boolean;
  },
): RouteDecisionSummary {
  const providerPoolSnapshot = readProviderPoolFromToml(
    input.configTomlPath,
    input.projectName,
    input.workDir,
    input.homeDir,
    input.providerOverrideFromCli,
  );
  const sessionNamespaceKey = buildRouteDecisionSessionKey({
    platform: {
      value: overrides?.platform,
      fallback: input.session.platform,
      provided: overrides?.platformProvided,
    },
    tenant: {
      value: overrides?.tenant,
      fallback: input.session.tenant,
      provided: overrides?.tenantProvided,
    },
    scope: {
      value: overrides?.scope,
      fallback: input.session.scope,
      provided: overrides?.scopeProvided,
    },
    subject: {
      value: overrides?.subject,
      fallback: input.session.subject,
      provided: overrides?.subjectProvided,
    },
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
  const bind = parseBind(readOptionString(options, "bind"), hasOption(options, "bind"));
  const projectName = readExplicitOptionalNonEmptyString(options, "project") ?? basenameFromPath(workDir);
  const { sessionNamespace } = resolveCliRouteNamespace({
    options,
    projectName,
    defaultSubject: process.env.USER ?? "user",
  });
  const providerOverrideFromCli = readExplicitOptionalNonEmptyString(options, "provider");
  const managementToken =
    readExplicitOptionalNonEmptyString(options, "management-token") ??
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
    circuitFailures: parseExplicitRequiredPositiveIntOption({
      options,
      key: "circuit-failures",
      fallbackValue: 2,
    }),
    circuitCooldownSecs: parseExplicitRequiredPositiveIntOption({
      options,
      key: "circuit-cooldown-secs",
      fallbackValue: 30,
    }),
    session: {
      platform: sessionNamespace.platform,
      tenant: sessionNamespace.tenant,
      scope: sessionNamespace.scope,
      subject: sessionNamespace.subject,
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
