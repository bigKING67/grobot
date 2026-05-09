import { type MemoryOperations } from "../services/memory-lifecycle";
import { setInterruptFlag } from "../services/interrupt-store";
import { GLOBAL_TURN_GATE } from "../../orchestration/orchestrator/turn-gate";
import { maskRedisUrl } from "../services/memory-store-config";
import { readMaskedFile } from "../services/redaction";
import { type ExperiencePoolRuntime } from "../services/experience-pool-runtime";
import {
  parseBearerToken,
  parseJsonObjectBody,
  parseQueryParams,
  readBody,
  readHeaderValue,
  utf8ByteLength,
  writeJson,
} from "./http-utils";
import { type ManagementRoutesContext } from "./management-routes";
import {
  resolveRunServeRouteDecision,
  type RunServeRouteDecisionInput,
} from "./run-serve-context";
import { isRouteDecisionNamespaceInputError } from "../status/route-namespace";
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
  routeDecisionInput: RunServeRouteDecisionInput;
  memoryOperations: MemoryOperations;
  experiencePoolRuntime: ExperiencePoolRuntime;
  persistMemoryStore(): Promise<void>;
  applyMcpReset(targetServer?: string): Record<string, unknown>;
}

function queryParamFirstRaw(query: Record<string, string[]>, key: string): string | undefined {
  const values = query[key];
  if (Array.isArray(values) && values.length > 0) {
    const value = values[0];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function queryParamFirstRawAny(
  query: Record<string, string[]>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = queryParamFirstRaw(query, key);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
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
    getRouteDecision: (query) => {
      const platform = queryParamFirstRaw(query, "platform");
      const scope = queryParamFirstRawAny(query, ["session-scope", "scope"]);
      const tenant = queryParamFirstRaw(query, "tenant");
      const subject = queryParamFirstRawAny(query, ["session-subject", "subject"]);
      try {
        return {
          ok: true,
          value: resolveRunServeRouteDecision(
            {
              ...input.routeDecisionInput,
              configTomlPath: input.runtimeState.getConfigTomlPath(),
            },
            {
              platform,
              platformProvided: Object.prototype.hasOwnProperty.call(query, "platform"),
              tenant,
              tenantProvided: Object.prototype.hasOwnProperty.call(query, "tenant"),
              scope,
              scopeProvided: Object.prototype.hasOwnProperty.call(query, "session-scope")
                || Object.prototype.hasOwnProperty.call(query, "scope"),
              subject,
              subjectProvided: Object.prototype.hasOwnProperty.call(query, "session-subject")
                || Object.prototype.hasOwnProperty.call(query, "subject"),
            },
          ),
        };
      } catch (error) {
        if (isRouteDecisionNamespaceInputError(error)) {
          return {
            ok: false,
            error: error.code,
            field: error.field,
            detail: error.message,
          };
        }
        return {
          ok: false,
          error: "route_decision_unavailable",
          field: "route_decision",
          detail: String(error),
        };
      }
    },
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
    readBody,
    readHeaderValue,
    parseJsonObjectBody,
    utf8ByteLength,
  };
}
