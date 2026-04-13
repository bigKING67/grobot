import { type IncomingMessage, type ServerResponse } from "node:http";
import {
  type MemoryBatchLifecycleResult,
  type MemoryLifecycleResult,
  type MemoryListOptions,
  type MemoryMutationResult,
  type MemoryScope,
  type MemoryStoreRuntime,
} from "../services/memory-lifecycle";

export interface ExecutionPlaneState {
  gatewayImpl: string;
  runtimeImpl: string;
  shadowMode: boolean;
  gatewayImplSource: string;
  runtimeImplSource: string;
  shadowModeSource: string;
}

export interface ConfigReadPolicyState {
  configuredPolicy: string;
  configuredSource: string;
  effectivePolicy: string;
  reason: string;
}

export type QueryParams = Record<string, string[]>;

export interface ManagementRoutesContext {
  projectName: string;
  workDir: string;
  projectTomlPath?: string;
  managementToken?: string;
  memoryStorePath: string;
  memoryStoreKey: string;
  getReloadCount: () => number;
  getExecutionPlane: () => ExecutionPlaneState;
  getConfigTomlPath: () => string | undefined;
  getConfigReadPolicy: () => ConfigReadPolicyState;
  getMemoryStoreRuntime: () => MemoryStoreRuntime;
  getMemorySessionCount: () => number;
  readMaskedFile: (path: string | undefined) => string | undefined;
  listMemoryRows: (sessionId: string, options: MemoryListOptions) => Record<string, unknown>[];
  importMemoryRows: (
    sessionId: string,
    scope: MemoryScope,
    rawRecords: unknown,
    source: string | undefined,
    dryRun: boolean,
  ) => MemoryMutationResult;
  forgetMemoryRows: (
    sessionId: string,
    scope: MemoryScope,
    ids: string[],
    reason: string | undefined,
    dryRun: boolean,
  ) => MemoryMutationResult;
  runMemoryLifecycle: (sessionId: string, scope: MemoryScope, dryRun: boolean) => MemoryLifecycleResult;
  runMemoryLifecycleAcrossSessions: (options: {
    scope: MemoryScope;
    dryRun: boolean;
    sessions: string[];
    sessionPrefixes: string[];
    limit: number;
  }) => MemoryBatchLifecycleResult;
  persistMemoryStore: () => Promise<void>;
  reloadRuntimeState: () => Promise<void>;
  applyMcpReset: (targetServer?: string) => Record<string, unknown>;
  setInterruptFlag: (sessionId: string, ttlSecs: number) => void;
  writeJson: (response: ServerResponse, statusCode: number, payload: Record<string, unknown>) => void;
  parseBearerToken: (headers: IncomingMessage["headers"]) => string | undefined;
  parseQueryParams: (rawUrl: string) => QueryParams;
  queryParamStr: (query: QueryParams, key: string, defaultValue?: string) => string;
  queryParamBool: (query: QueryParams, key: string, defaultValue: boolean) => boolean;
  queryParamInt: (query: QueryParams, key: string, defaultValue: number, minimum: number, maximum: number) => number;
  queryParamCursor: (
    query: QueryParams,
    key?: string,
    maximum?: number,
  ) => {
    cursor: number;
    error?: string;
  };
  readBody: (request: IncomingMessage) => Promise<string>;
  readHeaderValue: (headers: IncomingMessage["headers"], key: string) => string | undefined;
  parseJsonObjectBody: (rawBody: string) =>
    | {
        ok: true;
        body: Record<string, unknown>;
      }
    | {
        ok: false;
        detail: string;
      };
  parseBodyBool: (raw: unknown, defaultValue: boolean) => boolean;
  utf8ByteLength: (value: string) => number;
}
