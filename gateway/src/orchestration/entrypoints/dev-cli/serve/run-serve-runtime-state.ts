import { type ExecutionPlaneConfig } from "../../../execution-plane";
import { type ResolvedConfigReadPolicy } from "../services/management-config";
import { type MemoryStoreRuntime } from "./memory-store-runtime";
import { type ReloadRunServeRuntimeStateResult } from "./run-serve-reload";

interface CreateRunServeRuntimeStateInput {
  initialExecutionPlane: ExecutionPlaneConfig;
  initialConfigTomlPath: string | undefined;
  initialConfigReadPolicy: ResolvedConfigReadPolicy;
  initialMemoryStoreRuntime: MemoryStoreRuntime;
  reloadState(): Promise<ReloadRunServeRuntimeStateResult>;
}

export interface RunServeRuntimeState {
  getExecutionPlane(): ExecutionPlaneConfig;
  getConfigTomlPath(): string | undefined;
  getConfigReadPolicy(): ResolvedConfigReadPolicy;
  getMemoryStoreRuntime(): MemoryStoreRuntime;
  getReloadCount(): number;
  reloadRuntimeState(): Promise<void>;
}

export function createRunServeRuntimeState(input: CreateRunServeRuntimeStateInput): RunServeRuntimeState {
  let executionPlane = input.initialExecutionPlane;
  let configTomlPath = input.initialConfigTomlPath;
  let configReadPolicy = input.initialConfigReadPolicy;
  let memoryStoreRuntime = input.initialMemoryStoreRuntime;
  let reloadCount = 0;

  const reloadRuntimeState = async (): Promise<void> => {
    const reloaded = await input.reloadState();
    executionPlane = reloaded.executionPlane;
    configTomlPath = reloaded.configTomlPath;
    configReadPolicy = reloaded.configReadPolicy;
    memoryStoreRuntime = reloaded.memoryStoreRuntime;
    reloadCount += 1;
  };

  return {
    getExecutionPlane: (): ExecutionPlaneConfig => executionPlane,
    getConfigTomlPath: (): string | undefined => configTomlPath,
    getConfigReadPolicy: (): ResolvedConfigReadPolicy => configReadPolicy,
    getMemoryStoreRuntime: (): MemoryStoreRuntime => memoryStoreRuntime,
    getReloadCount: (): number => reloadCount,
    reloadRuntimeState,
  };
}
