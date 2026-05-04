export const MEMORY_SCOPE_AUTO = "auto";
export const MEMORY_SCOPE_USER = "user";
export const MEMORY_SCOPE_GROUP = "group";
export const MEMORY_SCOPE_ORG = "org";

export const MEMORY_KIND_EPISODIC = "episodic";
export const MEMORY_KIND_SEMANTIC = "semantic";
export const MEMORY_KIND_PREFERENCE = "preference";
export const MEMORY_KIND_POLICY = "policy";

export const MEMORY_CLASSIFICATION_PUBLIC = "public";
export const MEMORY_CLASSIFICATION_INTERNAL = "internal";
export const MEMORY_CLASSIFICATION_RESTRICTED = "restricted";
export const MEMORY_CLASSIFICATION_SECRET = "secret";

export const MEMORY_STATE_ACTIVE = "active";
export const MEMORY_STATE_ARCHIVED = "archived";
export const MEMORY_LEVEL_L1 = "L1";
export const MEMORY_LEVEL_L2 = "L2";
export const MEMORY_LEVEL_L3 = "L3";
export const MEMORY_LEVEL_L4 = "L4";

export const MANAGEMENT_MEMORY_CURSOR_MAX = 200_000;
export const MANAGEMENT_MEMORY_FETCH_MAX = 50_000;
export const MANAGEMENT_MEMORY_IMPORT_MAX_BODY_BYTES = 1024 * 1024;
export const MANAGEMENT_MEMORY_MUTATION_BATCH_LIMIT = 200;
export const MANAGEMENT_MEMORY_BATCH_MAX_SESSIONS = 200;

export type MemoryStoreBackend = "file" | "redis";

export interface MemoryStoreRuntime {
  backend: MemoryStoreBackend;
  requestedBackend: MemoryStoreBackend;
  source: string;
  redisUrl?: string;
  fallbackReason?: string;
  strictRedis?: boolean;
}

export type MemoryScope =
  | typeof MEMORY_SCOPE_AUTO
  | typeof MEMORY_SCOPE_USER
  | typeof MEMORY_SCOPE_GROUP
  | typeof MEMORY_SCOPE_ORG;

export type MemoryKind =
  | typeof MEMORY_KIND_EPISODIC
  | typeof MEMORY_KIND_SEMANTIC
  | typeof MEMORY_KIND_PREFERENCE
  | typeof MEMORY_KIND_POLICY;

export type MemoryClassification =
  | typeof MEMORY_CLASSIFICATION_PUBLIC
  | typeof MEMORY_CLASSIFICATION_INTERNAL
  | typeof MEMORY_CLASSIFICATION_RESTRICTED
  | typeof MEMORY_CLASSIFICATION_SECRET;

export type MemoryState = typeof MEMORY_STATE_ACTIVE | typeof MEMORY_STATE_ARCHIVED;
export type MemoryLevel =
  | typeof MEMORY_LEVEL_L1
  | typeof MEMORY_LEVEL_L2
  | typeof MEMORY_LEVEL_L3
  | typeof MEMORY_LEVEL_L4;

export interface MemoryEvidenceRef {
  trace_id?: string;
  turn_id?: string;
  tool_call_id?: string;
  source?: string;
}

export const MEMORY_SCOPES: readonly MemoryScope[] = [
  MEMORY_SCOPE_AUTO,
  MEMORY_SCOPE_USER,
  MEMORY_SCOPE_GROUP,
  MEMORY_SCOPE_ORG,
];

export const MEMORY_KINDS: readonly MemoryKind[] = [
  MEMORY_KIND_EPISODIC,
  MEMORY_KIND_SEMANTIC,
  MEMORY_KIND_PREFERENCE,
  MEMORY_KIND_POLICY,
];

export const MEMORY_CLASSIFICATIONS: readonly MemoryClassification[] = [
  MEMORY_CLASSIFICATION_PUBLIC,
  MEMORY_CLASSIFICATION_INTERNAL,
  MEMORY_CLASSIFICATION_RESTRICTED,
  MEMORY_CLASSIFICATION_SECRET,
];

export const MEMORY_LEVELS: readonly MemoryLevel[] = [
  MEMORY_LEVEL_L1,
  MEMORY_LEVEL_L2,
  MEMORY_LEVEL_L3,
  MEMORY_LEVEL_L4,
];

export interface MemoryListOptions {
  includeArchived: boolean;
  includeRestricted: boolean;
  includeSecret: boolean;
  kindFilter?: MemoryKind;
  classificationFilter?: MemoryClassification;
  queryText?: string;
}

export interface MemoryMutationResult {
  ok: boolean;
  result: Record<string, unknown>;
}

export interface MemoryLifecycleResult {
  ok: boolean;
  lines: string[];
}

export interface MemoryBatchLifecycleResult {
  status: "ok" | "partial";
  requestedCount: number;
  successCount: number;
  failedCount: number;
  actions: Record<"promote" | "decay" | "archive", number>;
  scanned: number;
  changed: number;
  discoveryTruncated: boolean;
  results: Array<Record<string, unknown>>;
}

export interface MemoryOperations {
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
}
