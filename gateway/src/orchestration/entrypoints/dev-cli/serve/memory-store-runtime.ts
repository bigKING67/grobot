import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export type MemoryStoreBackend = "file" | "redis";

export interface MemoryStoreRuntime {
  backend: MemoryStoreBackend;
  requestedBackend: MemoryStoreBackend;
  source: string;
  redisUrl?: string;
  fallbackReason?: string;
}

interface MemoryStorePayload {
  version: number;
  sessions: Record<string, Record<string, unknown>[]>;
}

function dirname(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

export function loadMemoryStore(path: string): Map<string, Record<string, unknown>[]> {
  const map = new Map<string, Record<string, unknown>[]>();
  if (!existsSync(path)) {
    return map;
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return map;
    }
    const sessions = (parsed as Record<string, unknown>).sessions;
    if (typeof sessions !== "object" || sessions === null) {
      return map;
    }
    for (const [sessionId, rows] of Object.entries(sessions as Record<string, unknown>)) {
      if (!Array.isArray(rows)) {
        continue;
      }
      const normalizedRows: Record<string, unknown>[] = [];
      for (const row of rows) {
        if (typeof row !== "object" || row === null || Array.isArray(row)) {
          continue;
        }
        normalizedRows.push({ ...(row as Record<string, unknown>) });
      }
      map.set(sessionId, normalizedRows);
    }
    return map;
  } catch {
    return map;
  }
}

export function saveMemoryStore(path: string, sessions: Map<string, Record<string, unknown>[]>): void {
  const payload: MemoryStorePayload = {
    version: 1,
    sessions: {},
  };
  for (const [sessionId, rows] of sessions.entries()) {
    payload.sessions[sessionId] = rows.map((row) => ({ ...row }));
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload)}\n`, "utf8");
}

export function memoryStoreRedisKey(projectName: string, workDir: string): string {
  return `grobot:ts-dev-cli:memory-store:v1:${projectName}:${encodeURIComponent(workDir)}`;
}

export function decodeMemoryStorePayload(payload: Record<string, unknown>): Map<string, Record<string, unknown>[]> {
  const map = new Map<string, Record<string, unknown>[]>();
  const sessions = payload.sessions;
  if (typeof sessions !== "object" || sessions === null) {
    return map;
  }
  for (const [sessionId, rows] of Object.entries(sessions as Record<string, unknown>)) {
    if (!Array.isArray(rows)) {
      continue;
    }
    const normalizedRows: Record<string, unknown>[] = [];
    for (const row of rows) {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        continue;
      }
      normalizedRows.push({ ...(row as Record<string, unknown>) });
    }
    map.set(sessionId, normalizedRows);
  }
  return map;
}

export function encodeMemoryStorePayload(sessions: Map<string, Record<string, unknown>[]>): MemoryStorePayload {
  const payload: MemoryStorePayload = {
    version: 1,
    sessions: {},
  };
  for (const [sessionId, rows] of sessions.entries()) {
    payload.sessions[sessionId] = rows.map((row) => ({ ...row }));
  }
  return payload;
}

export function replaceMemoryRecordsBySession(
  targetStore: Map<string, Record<string, unknown>[]>,
  nextStore: Map<string, Record<string, unknown>[]>,
): void {
  targetStore.clear();
  for (const [sessionId, rows] of nextStore.entries()) {
    targetStore.set(
      sessionId,
      rows.map((row) => ({ ...row })),
    );
  }
}

export async function loadMemoryStoreRuntimeState(args: {
  runtimeInput: MemoryStoreRuntime;
  memoryStoreKey: string;
  memoryStorePath: string;
  memoryStoreLegacyPath?: string;
  redisGetJson: (redisUrl: string, key: string) => Promise<Record<string, unknown> | undefined>;
}): Promise<{
  runtime: MemoryStoreRuntime;
  store: Map<string, Record<string, unknown>[]>;
}> {
  const { runtimeInput, memoryStoreKey, memoryStorePath, memoryStoreLegacyPath, redisGetJson } = args;
  const loadFileStoreWithLegacy = (): Map<string, Record<string, unknown>[]> => {
    const primary = loadMemoryStore(memoryStorePath);
    if (primary.size > 0 || !memoryStoreLegacyPath) {
      return primary;
    }
    const legacy = loadMemoryStore(memoryStoreLegacyPath);
    if (legacy.size > 0) {
      saveMemoryStore(memoryStorePath, legacy);
    }
    return legacy;
  };
  if (runtimeInput.backend === "redis" && runtimeInput.redisUrl) {
    try {
      const payload = await redisGetJson(runtimeInput.redisUrl, memoryStoreKey);
      return {
        runtime: runtimeInput,
        store: payload ? decodeMemoryStorePayload(payload) : new Map<string, Record<string, unknown>[]>(),
      };
    } catch (error) {
      return {
        runtime: {
          ...runtimeInput,
          backend: "file",
          fallbackReason: `redis bootstrap failed, fallback to file: ${String(error)}`,
        },
        store: loadFileStoreWithLegacy(),
      };
    }
  }
  return {
    runtime: runtimeInput,
    store: loadFileStoreWithLegacy(),
  };
}

export async function persistMemoryStoreRuntimeState(args: {
  runtime: MemoryStoreRuntime;
  memoryStoreKey: string;
  memoryStorePath: string;
  memoryRecordsBySession: Map<string, Record<string, unknown>[]>;
  redisSetJson: (redisUrl: string, key: string, payload: Record<string, unknown>, ttlSecs: number) => Promise<void>;
  redisTtlSecs: number;
}): Promise<void> {
  const { runtime, memoryStoreKey, memoryStorePath, memoryRecordsBySession, redisSetJson, redisTtlSecs } = args;
  if (runtime.backend === "redis" && runtime.redisUrl) {
    await redisSetJson(
      runtime.redisUrl,
      memoryStoreKey,
      encodeMemoryStorePayload(memoryRecordsBySession) as unknown as Record<string, unknown>,
      redisTtlSecs,
    );
    return;
  }
  saveMemoryStore(memoryStorePath, memoryRecordsBySession);
}
