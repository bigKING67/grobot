import { resolveExecutionPlaneConfig } from "../../orchestration/execution-plane";
import { buildSessionKey } from "../../models/session-key";
import { hasFlag, type OptionValue, readOptionString } from "../cli-args";
import { readProviderPoolFromToml } from "../provider-probe";
import {
  basenameFromPath,
  resolveConfigTomlPath,
  resolveExperiencePoolPath,
  resolveLegacyExperiencePoolPath,
  resolveHomeDir,
  resolveInterruptStorePath,
  resolveProjectStateRoot,
  resolveProjectRoot,
  resolveProjectTomlPath,
  resolveWorkDir,
} from "../services/runtime-paths";
import { resolveMcpInstructionRuntime } from "../services/mcp-instruction-pack";
import {
  resolveContextEngineConfig,
  type ContextEngineConfig,
} from "../../tools/context";
import { createRunStartSessionStore } from "./session-store";
import { sessionRegistryFilePath } from "./session-registry";
import {
  resolveForkSession,
  parsePlatform,
  parseScope,
  resolveHandoffAutoOnExit,
  resolveHandoffRecentTurns,
  resolveHistoryTurns,
  resolveResumeAllRequested,
  resolveResumeLastRequested,
  resolveResumeRequested,
  resolveResumeSelector,
  resolveResumeSessionAt,
  resolveRewindMode,
  resolveRewindRequested,
  resolveRewindSelector,
  resolveRewindFiles,
  resolveSessionPlatformOption,
  resolveSessionScopeOption,
  resolveSessionSubjectOption,
} from "./session-options";
import { buildHandoffPath } from "./handoff-file";
import {
  resolveExperiencePublishMode,
  resolveExperienceRecallLimit,
  resolveExperienceTeam,
} from "./context/experience-options";
import {
  readKimiSearchRoutingPolicyFromProjectToml,
  resolveRuntimeModelConfig,
} from "./context/runtime-model-config";
import { resolveRuntimeToolContext } from "./context/runtime-tool-context";
import { readStatusLineConfigFromProjectToml } from "./context/status-line-config";

export type {
  ResolvedRuntimeToolContext,
  RuntimeToolContextDiagnostics,
} from "./context/runtime-tool-context";

export function resolveRunStartContext(options: Record<string, OptionValue>) {
  const homeDir = resolveHomeDir(options);
  const projectRoot = resolveProjectRoot(options, homeDir);
  const workDir = resolveWorkDir(options, projectRoot, homeDir);
  const projectStateRoot = resolveProjectStateRoot(workDir);
  const projectTomlPath = resolveProjectTomlPath(
    options,
    workDir,
    projectRoot,
    homeDir,
  );
  const configTomlPath = resolveConfigTomlPath(options, homeDir, {
    workDir,
    projectRoot,
  });
  const projectName =
    readOptionString(options, "project") ?? basenameFromPath(workDir);
  const providerOverride = readOptionString(options, "provider");
  const providerPoolSnapshot = readProviderPoolFromToml(
    configTomlPath,
    projectName,
    workDir,
    homeDir,
    providerOverride,
  );
  const runtimeModelConfig = resolveRuntimeModelConfig(
    options,
    providerPoolSnapshot
      ? {
          source: providerPoolSnapshot.source,
          providers: providerPoolSnapshot.providers,
        }
      : undefined,
  );
  const contextEngineConfig: ContextEngineConfig = resolveContextEngineConfig({
    projectTomlPath,
    runtimeModelConfig: runtimeModelConfig.modelConfig,
  });
  const historyTurns = resolveHistoryTurns(options);
  const handoffRecentTurns = resolveHandoffRecentTurns(options);
  const handoffAutoOnExit = resolveHandoffAutoOnExit(options);
  const resumeRequested = resolveResumeRequested(options);
  const resumeLastRequested = resolveResumeLastRequested(options);
  const resumeAllRequested = resolveResumeAllRequested(options);
  const resumeSelector = resolveResumeSelector(options);
  const rewindRequested = resolveRewindRequested(options);
  const rewindSelector = resolveRewindSelector(options);
  const rewindMode = resolveRewindMode(options);
  const forkSession = resolveForkSession(options);
  const resumeSessionAt = resolveResumeSessionAt(options);
  const rewindFiles = resolveRewindFiles(options);
  const handoffPath = buildHandoffPath(projectRoot);
  const interruptStorePath = resolveInterruptStorePath(projectStateRoot);
  const experiencePoolPathRaw = process.env.GROBOT_EXPERIENCE_POOL_PATH?.trim();
  const experienceLegacyPoolPath = resolveLegacyExperiencePoolPath(homeDir);
  const experienceTeam = resolveExperienceTeam(options);
  const subject =
    resolveSessionSubjectOption(options) ?? process.env.USER ?? "user";
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
  const experiencePoolPath =
    experiencePoolPathRaw && experiencePoolPathRaw.length > 0
      ? experiencePoolPathRaw
      : resolveExperiencePoolPath(projectStateRoot, {
          tenant: sessionNamespace.tenant,
          team: experienceTeam,
          user: sessionNamespace.subject,
        });
  const sessionNamespaceKey = buildSessionKey(sessionNamespace);
  const sessionRegistryFilePathValue = sessionRegistryFilePath(
    projectStateRoot,
    sessionNamespaceKey,
  );
  const sessionStore = createRunStartSessionStore({
    options,
    projectTomlPath,
    homeDir: projectStateRoot,
    sessionNamespaceKey,
    historyTurns,
  });
  const kimiSearchRoutingPolicy =
    readKimiSearchRoutingPolicyFromProjectToml(projectTomlPath);
  const statusLineConfig = readStatusLineConfigFromProjectToml(projectTomlPath);
  const mcpInstructionRuntime = resolveMcpInstructionRuntime({
    homeDir,
    workDir,
    projectTomlPath,
  });
  const runtimeToolContextResolution = resolveRuntimeToolContext(
    workDir,
    projectTomlPath,
  );

  return {
    homeDir,
    projectRoot,
    workDir,
    projectTomlPath,
    configTomlPath,
    projectName,
    historyTurns,
    handoffRecentTurns,
    handoffAutoOnExit,
    resumeRequested,
    resumeLastRequested,
    resumeAllRequested,
    resumeSelector,
    rewindRequested,
    rewindSelector,
    rewindMode,
    forkSession,
    resumeSessionAt,
    rewindFiles,
    handoffPath,
    interruptStorePath,
    experiencePoolPath,
    experienceLegacyPoolPath,
    experienceTeam,
    experiencePublishMode: resolveExperiencePublishMode(),
    experienceRecallLimit: resolveExperienceRecallLimit(),
    subject,
    executionPlane,
    sessionNamespaceKey,
    sessionRegistryFilePathValue,
    sessionStore,
    runtimeModelConfig: runtimeModelConfig.modelConfig,
    runtimeProviderChain: runtimeModelConfig.providerChain,
    runtimeFailoverConfig: runtimeModelConfig.failoverConfig,
    runtimeModelConfigSource: runtimeModelConfig.modelConfigSource,
    contextEngineConfig,
    runtimeToolContext: runtimeToolContextResolution.context,
    runtimeToolContextDiagnostics: runtimeToolContextResolution.diagnostics,
    kimiSearchRoutingPolicy,
    statusLineConfig,
    mcpInstructionPromptPrefix: mcpInstructionRuntime.promptPrefix,
    mcpInstructionServerNames: mcpInstructionRuntime.loadedServerNames,
    mcpInstructionEvents: mcpInstructionRuntime.events,
    mcpInstructionStrictFailure: mcpInstructionRuntime.strictFailure,
  };
}
