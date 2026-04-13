import { resolveExecutionPlaneConfig } from "../../../execution-plane";
import { type OptionValue } from "../cli-args";
import { createMemoryOperations } from "../services/memory-lifecycle";
import { resolveConfigReadPolicy } from "../services/management-config";
import { resolveMemoryStoreRuntime } from "../services/memory-store-config";
import { redisGetJson, redisSetJson } from "../services/redis-client";
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
  const initialMemoryState = await loadMemoryStoreRuntimeState({
    runtimeInput: resolveMemoryStoreRuntime(input.options, context.projectTomlPath),
    memoryStoreKey: context.memoryStoreKey,
    memoryStorePath: context.memoryStorePath,
    redisGetJson,
  });
  const memoryRecordsBySession = initialMemoryState.store;
  const runtimeState = createRunServeRuntimeState({
    initialExecutionPlane: resolveExecutionPlaneConfig(context.executionPlaneInput),
    initialConfigTomlPath: context.configTomlPath,
    initialConfigReadPolicy: resolveConfigReadPolicy(input.options, context.bind.host, context.configTomlPath),
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
    memoryOperations,
    persistMemoryStore,
    applyMcpReset,
  });

  return {
    runtimeState,
    managementRoutesContext,
  };
}
