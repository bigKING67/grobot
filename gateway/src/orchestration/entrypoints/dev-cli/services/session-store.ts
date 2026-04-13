export type SessionStoreBackend = "file" | "redis";

export interface SessionStoreRuntime {
  backend: SessionStoreBackend;
  requestedBackend: SessionStoreBackend;
  source: string;
  redisUrl?: string;
  fallbackReason?: string;
}

export interface LoadedSessionRegistryState<TSessionRegistryPayload> {
  registry: TSessionRegistryPayload;
  warnings: string[];
}

export interface LoadedHistoryMessagesState<THistoryMessage> {
  messages: THistoryMessage[];
  source: "store" | "empty";
  warnings: string[];
}

export interface SessionStoreController<TSessionRegistryPayload, THistoryMessage> {
  getRuntime(): SessionStoreRuntime;
  loadSessionRegistryState(): Promise<LoadedSessionRegistryState<TSessionRegistryPayload>>;
  saveSessionRegistryState(payload: TSessionRegistryPayload): Promise<string[]>;
  loadHistoryMessagesState(sessionKey: string): Promise<LoadedHistoryMessagesState<THistoryMessage>>;
  saveHistoryMessagesState(sessionKey: string, rows: THistoryMessage[]): Promise<string[]>;
}

export interface CreateSessionStoreControllerOptions<TSessionRegistryPayload, THistoryMessage> {
  runtime: SessionStoreRuntime;
  redisTtlSecs: number;
  sessionRegistryRedisKey: string;
  sessionRegistryFromRedisPayload(payload: Record<string, unknown> | undefined): TSessionRegistryPayload;
  sessionRegistryToRedisPayload(payload: TSessionRegistryPayload): Record<string, unknown>;
  loadSessionRegistryFromFile(): LoadedSessionRegistryState<TSessionRegistryPayload>;
  saveSessionRegistryToFile(payload: TSessionRegistryPayload): string[];
  historyRedisKey(sessionKey: string): string;
  historyFromRedisPayload(payload: Record<string, unknown>): THistoryMessage[];
  historyToRedisPayload(sessionKey: string, rows: THistoryMessage[]): Record<string, unknown>;
  loadHistoryFromFile(sessionKey: string): LoadedHistoryMessagesState<THistoryMessage>;
  saveHistoryToFile(sessionKey: string, rows: THistoryMessage[]): string[];
  redisGetJson(redisUrl: string, key: string): Promise<Record<string, unknown> | undefined>;
  redisSetJson(redisUrl: string, key: string, payload: Record<string, unknown>, ttlSecs: number): Promise<void>;
}

export function createSessionStoreController<TSessionRegistryPayload, THistoryMessage>(
  options: CreateSessionStoreControllerOptions<TSessionRegistryPayload, THistoryMessage>,
): SessionStoreController<TSessionRegistryPayload, THistoryMessage> {
  let runtime = { ...options.runtime };

  const fallbackToFile = (reason: string): string[] => {
    if (runtime.backend === "file") {
      return [];
    }
    runtime = {
      ...runtime,
      backend: "file",
      fallbackReason: reason,
    };
    return [`session store fallback to file: ${reason}`];
  };

  const loadSessionRegistryState = async (): Promise<LoadedSessionRegistryState<TSessionRegistryPayload>> => {
    if (runtime.backend === "redis" && runtime.redisUrl) {
      try {
        const payload = await options.redisGetJson(runtime.redisUrl, options.sessionRegistryRedisKey);
        return {
          registry: options.sessionRegistryFromRedisPayload(payload),
          warnings: [],
        };
      } catch (error) {
        const fallbackWarnings = fallbackToFile(`redis registry read failed: ${String(error)}`);
        const fileState = options.loadSessionRegistryFromFile();
        return {
          registry: fileState.registry,
          warnings: [...fallbackWarnings, ...fileState.warnings],
        };
      }
    }
    return options.loadSessionRegistryFromFile();
  };

  const saveSessionRegistryState = async (payload: TSessionRegistryPayload): Promise<string[]> => {
    if (runtime.backend === "redis" && runtime.redisUrl) {
      try {
        await options.redisSetJson(
          runtime.redisUrl,
          options.sessionRegistryRedisKey,
          options.sessionRegistryToRedisPayload(payload),
          options.redisTtlSecs,
        );
        return [];
      } catch (error) {
        const warnings = fallbackToFile(`redis registry write failed: ${String(error)}`);
        const fileWarnings = options.saveSessionRegistryToFile(payload);
        return [...warnings, ...fileWarnings];
      }
    }
    return options.saveSessionRegistryToFile(payload);
  };

  const loadHistoryMessagesState = async (sessionKey: string): Promise<LoadedHistoryMessagesState<THistoryMessage>> => {
    if (runtime.backend === "redis" && runtime.redisUrl) {
      const historyKey = options.historyRedisKey(sessionKey);
      try {
        const payload = await options.redisGetJson(runtime.redisUrl, historyKey);
        if (!payload) {
          return {
            messages: [],
            source: "empty",
            warnings: [],
          };
        }
        const messages = options.historyFromRedisPayload(payload);
        return {
          messages,
          source: messages.length > 0 ? "store" : "empty",
          warnings: [],
        };
      } catch (error) {
        const warnings = fallbackToFile(`redis history read failed: ${String(error)}`);
        const fileState = options.loadHistoryFromFile(sessionKey);
        return {
          messages: fileState.messages,
          source: fileState.source,
          warnings: [...warnings, ...fileState.warnings],
        };
      }
    }
    return options.loadHistoryFromFile(sessionKey);
  };

  const saveHistoryMessagesState = async (sessionKey: string, rows: THistoryMessage[]): Promise<string[]> => {
    if (runtime.backend === "redis" && runtime.redisUrl) {
      const historyKey = options.historyRedisKey(sessionKey);
      try {
        await options.redisSetJson(
          runtime.redisUrl,
          historyKey,
          options.historyToRedisPayload(sessionKey, rows),
          options.redisTtlSecs,
        );
        return [];
      } catch (error) {
        const warnings = fallbackToFile(`redis history write failed: ${String(error)}`);
        const fileWarnings = options.saveHistoryToFile(sessionKey, rows);
        return [...warnings, ...fileWarnings];
      }
    }
    return options.saveHistoryToFile(sessionKey, rows);
  };

  return {
    getRuntime: () => ({ ...runtime }),
    loadSessionRegistryState,
    saveSessionRegistryState,
    loadHistoryMessagesState,
    saveHistoryMessagesState,
  };
}
