import { type MemoryOperations } from "../services/memory-lifecycle";
import { setInterruptFlag } from "../services/interrupt-store";
import { GLOBAL_TURN_GATE } from "../../orchestration/orchestrator/turn-gate";
import { maskRedisUrl } from "../services/memory-store-config";
import { readMaskedFile } from "../services/redaction";
import { type ExperiencePoolRuntime } from "../services/experience-pool-runtime";
import {
  parseBearerToken,
  parseBodyBool,
  parseJsonObjectBody,
  parseQueryParams,
  queryParamBool,
  queryParamCursor,
  queryParamInt,
  queryParamStr,
  readBody,
  readHeaderValue,
  utf8ByteLength,
  writeJson,
} from "./http-utils";
import { type ManagementRoutesContext } from "./management-routes";
import { type RunServeRuntimeState } from "./run-serve-runtime-state";

interface CreateRunServeRouteContextInput {
  projectName: string;
  workDir: string;
  projectTomlPath: string | undefined;
  managementToken: string | undefined;
  memoryStorePath: string;
  memoryStoreKey: string;
  interruptStorePath: string;
  memoryRecordsBySession: Map<string, Record<string, unknown>[]>;
  runtimeState: RunServeRuntimeState;
  memoryOperations: MemoryOperations;
  experiencePoolRuntime: ExperiencePoolRuntime;
  persistMemoryStore(): Promise<void>;
  applyMcpReset(targetServer?: string): Record<string, unknown>;
}

export function createRunServeRouteContext(
  input: CreateRunServeRouteContextInput,
): ManagementRoutesContext {
  return {
    projectName: input.projectName,
    workDir: input.workDir,
    projectTomlPath: input.projectTomlPath,
    managementToken: input.managementToken,
    memoryStorePath: input.memoryStorePath,
    memoryStoreKey: input.memoryStoreKey,
    getReloadCount: input.runtimeState.getReloadCount,
    getExecutionPlane: input.runtimeState.getExecutionPlane,
    getConfigTomlPath: input.runtimeState.getConfigTomlPath,
    getConfigReadPolicy: input.runtimeState.getConfigReadPolicy,
    getMemoryStoreRuntime: () => {
      const runtime = input.runtimeState.getMemoryStoreRuntime();
      return {
        ...runtime,
        redisUrl: maskRedisUrl(runtime.redisUrl),
      };
    },
    getMemorySessionCount: () => input.memoryRecordsBySession.size,
    getExperiencePoolState: () => ({
      path: input.experiencePoolRuntime.getPath(),
      publishMode: input.experiencePoolRuntime.getPublishMode(),
      recallLimit: input.experiencePoolRuntime.getRecallLimit(),
      teamDefault: input.experiencePoolRuntime.getTeamDefault(),
      recordCount: input.experiencePoolRuntime.getRecordCount(),
      updatedAt: input.experiencePoolRuntime.getUpdatedAt(),
    }),
    searchExperienceRecords: input.experiencePoolRuntime.searchRecords,
    listExperienceRecords: input.experiencePoolRuntime.listRecords,
    getExperienceRecord: input.experiencePoolRuntime.getRecordById,
    setExperienceRecordState: input.experiencePoolRuntime.setRecordState,
    readMaskedFile,
    listMemoryRows: input.memoryOperations.listMemoryRows,
    importMemoryRows: input.memoryOperations.importMemoryRows,
    forgetMemoryRows: input.memoryOperations.forgetMemoryRows,
    runMemoryLifecycle: input.memoryOperations.runMemoryLifecycle,
    runMemoryLifecycleAcrossSessions: input.memoryOperations.runMemoryLifecycleAcrossSessions,
    persistMemoryStore: input.persistMemoryStore,
    reloadRuntimeState: input.runtimeState.reloadRuntimeState,
    applyMcpReset: input.applyMcpReset,
    setInterruptFlag: (sessionId, ttlSecs) => {
      setInterruptFlag(input.interruptStorePath, sessionId, ttlSecs);
    },
    forceEndTurnGate: (sessionId) => {
      GLOBAL_TURN_GATE.forceEnd(sessionId);
    },
    writeJson,
    parseBearerToken,
    parseQueryParams,
    queryParamStr,
    queryParamBool,
    queryParamInt,
    queryParamCursor,
    readBody,
    readHeaderValue,
    parseJsonObjectBody,
    parseBodyBool,
    utf8ByteLength,
  };
}
