import { resolveExecutionPlaneConfig, type ExecutionPlaneConfig } from "../../../execution-plane";
import { OptionValue } from "../cli-args";
import { resolveConfigReadPolicy, type ResolvedConfigReadPolicy } from "../services/management-config";
import { resolveMemoryStoreRuntime } from "../services/memory-store-config";
import { resolveConfigTomlPath } from "../services/runtime-paths";
import { redisGetJson } from "../services/redis-client";
import {
  loadMemoryStoreRuntimeState,
  replaceMemoryRecordsBySession,
  type MemoryStoreRuntime,
} from "./memory-store-runtime";

interface ExecutionPlaneConfigInput {
  gatewayImplArg?: string;
  runtimeImplArg?: string;
  shadowModeArg?: boolean;
  noShadowModeArg?: boolean;
  projectTomlPath?: string;
}

interface ReloadRunServeRuntimeStateInput {
  options: Record<string, OptionValue>;
  homeDir: string;
  bindHost: string;
  projectTomlPath: string | undefined;
  executionPlaneInput: ExecutionPlaneConfigInput;
  memoryStoreKey: string;
  memoryStorePath: string;
  memoryRecordsBySession: Map<string, Record<string, unknown>[]>;
}

export interface ReloadRunServeRuntimeStateResult {
  executionPlane: ExecutionPlaneConfig;
  configTomlPath: string | undefined;
  configReadPolicy: ResolvedConfigReadPolicy;
  memoryStoreRuntime: MemoryStoreRuntime;
}

export async function reloadRunServeRuntimeState(
  input: ReloadRunServeRuntimeStateInput,
): Promise<ReloadRunServeRuntimeStateResult> {
  const executionPlane = resolveExecutionPlaneConfig(input.executionPlaneInput);
  const configTomlPath = resolveConfigTomlPath(input.options, input.homeDir);
  const configReadPolicy = resolveConfigReadPolicy(input.options, input.bindHost, configTomlPath);
  const reloadedMemoryState = await loadMemoryStoreRuntimeState({
    runtimeInput: resolveMemoryStoreRuntime(input.options, input.projectTomlPath),
    memoryStoreKey: input.memoryStoreKey,
    memoryStorePath: input.memoryStorePath,
    redisGetJson,
  });
  replaceMemoryRecordsBySession(input.memoryRecordsBySession, reloadedMemoryState.store);
  return {
    executionPlane,
    configTomlPath,
    configReadPolicy,
    memoryStoreRuntime: reloadedMemoryState.runtime,
  };
}
