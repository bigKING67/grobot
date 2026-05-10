import { resolveExecutionPlaneConfig } from "../../orchestration/execution-plane";
import { type OptionValue } from "../cli-args";
import { createMemoryOperations } from "../services/memory-lifecycle";
import { resolveConfigReadPolicy } from "../services/management-config";
import { resolveMemoryStoreRuntime } from "../services/memory-store-config";
import {
  resolveExperiencePoolPath,
  resolveLegacyExperiencePoolPath,
  resolveLegacyMemoryStorePath,
} from "../services/runtime-paths";
import { redisGetJson, redisSetJson } from "../services/redis-client";
import { createExperiencePoolRuntime } from "../services/experience-pool-runtime";
import {
  readExperiencePoolPathOverrideFromEnv,
  readExperiencePublishModeFromEnv,
  readExperienceRecallLimitFromEnv,
  readExperienceTeamFromEnv,
  resolveExperiencePoolPathOverride,
  resolveExperiencePublishMode,
  resolveExperienceRecallLimit,
  resolveExperienceTeam,
} from "../services/experience-controls";
import { type ManagementRoutesContext } from "./management-routes";
import { type MCPRuntimeState } from "./mcp-runtime";
import {
  loadMemoryStoreRuntimeState,
  persistMemoryStoreRuntimeState,
} from "./memory-store-runtime";
import { createRunServeMcpReset } from "./run-serve-mcp-reset";
import { type RunServeContext } from "./run-serve-context";
import { createRunServeRouteContext } from "./run-serve-route-context";
import { reloadRunServeRuntimeState } from "./run-serve-reload";
import { createRunServeRuntimeState, type RunServeRuntimeState } from "./run-serve-runtime-state";

const MEMORY_STORE_REDIS_TTL_SECS = 14 * 24 * 60 * 60;

interface CreateRunServeWireInput {
  options: Record<string, OptionValue>;
  context: RunServeContext;
  mcpSessions: Set<string>;
  mcpServerStates: Map<string, MCPRuntimeState>;
}

export interface RunServeWire {
  runtimeState: RunServeRuntimeState;
  managementRoutesContext: ManagementRoutesContext;
}

export async function createRunServeWire(input: CreateRunServeWireInput): Promise<RunServeWire> {
  const context = input.context;
  const initialConfigReadPolicy = resolveConfigReadPolicy(
    input.options,
    context.bind.host,
    context.configTomlPath,
  );
  const initialMemoryState = await loadMemoryStoreRuntimeState({
    runtimeInput: resolveMemoryStoreRuntime(input.options, context.projectTomlPath),
    memoryStoreKey: context.memoryStoreKey,
    memoryStorePath: context.memoryStorePath,
    memoryStoreLegacyPath: resolveLegacyMemoryStorePath(context.homeDir),
    redisGetJson,
  });
  const memoryRecordsBySession = initialMemoryState.store;
  const runtimeState = createRunServeRuntimeState({
    initialExecutionPlane: resolveExecutionPlaneConfig(context.executionPlaneInput),
    initialConfigTomlPath: context.configTomlPath,
    initialConfigReadPolicy,
    initialMemoryStoreRuntime: initialMemoryState.runtime,
    reloadState: async () =>
      reloadRunServeRuntimeState({
        options: input.options,
        homeDir: context.homeDir,
        bindHost: context.bind.host,
        projectTomlPath: context.projectTomlPath,
        executionPlaneInput: context.executionPlaneInput,
        memoryStoreKey: context.memoryStoreKey,
        memoryStorePath: context.memoryStorePath,
        memoryRecordsBySession,
      }),
  });

  const persistMemoryStore = async (): Promise<void> => {
    await persistMemoryStoreRuntimeState({
      runtime: runtimeState.getMemoryStoreRuntime(),
      memoryStoreKey: context.memoryStoreKey,
      memoryStorePath: context.memoryStorePath,
      memoryRecordsBySession,
      redisSetJson,
      redisTtlSecs: MEMORY_STORE_REDIS_TTL_SECS,
    });
  };

  const memoryOperations = createMemoryOperations(memoryRecordsBySession);
  const experiencePoolPathOverride = resolveExperiencePoolPathOverride();
  const experienceTeam = resolveExperienceTeam();
  const experiencePublishMode = resolveExperiencePublishMode();
  const experienceRecallLimit = resolveExperienceRecallLimit();
  const experiencePoolPath =
    typeof experiencePoolPathOverride === "string"
      ? experiencePoolPathOverride
      : resolveExperiencePoolPath(context.projectStateRoot, {
        tenant: context.projectName,
        team: experienceTeam,
        user: process.env.USER ?? "server",
      });
  const experiencePoolRuntime = createExperiencePoolRuntime({
    poolPath: experiencePoolPath,
    legacyPoolPath: resolveLegacyExperiencePoolPath(context.homeDir),
    publishMode: experiencePublishMode,
    recallLimit: experienceRecallLimit,
    teamDefault: experienceTeam,
  });
  const applyMcpReset = createRunServeMcpReset({
    mcpSessions: input.mcpSessions,
    mcpServerStates: input.mcpServerStates,
  });
  const managementRoutesContext = createRunServeRouteContext({
    projectName: context.projectName,
    workDir: context.workDir,
    projectTomlPath: context.projectTomlPath,
    managementToken: context.managementToken,
    memoryStorePath: context.memoryStorePath,
    memoryStoreKey: context.memoryStoreKey,
    interruptStorePath: context.interruptStorePath,
    memoryRecordsBySession,
    runtimeState,
    routeDecisionInput: context.routeDecisionInput,
    memoryOperations,
    experiencePoolRuntime,
    persistMemoryStore,
    applyMcpReset,
  });

  return {
    runtimeState,
    managementRoutesContext,
  };
}

export function validateRunServeExperienceControlInputs(): void {
  readExperienceTeamFromEnv();
  readExperiencePoolPathOverrideFromEnv();
  readExperiencePublishModeFromEnv();
  readExperienceRecallLimitFromEnv();
}
