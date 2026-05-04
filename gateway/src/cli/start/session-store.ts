import { OptionValue } from "../cli-args";
import { resolveMemoryStoreRuntime } from "../services/memory-store-config";
import { redisGetJson, redisSetJson } from "../services/redis-client";
import { createSessionStoreController } from "../services/session-store";
import {
  normalizeHistoryMessages,
  trimHistoryMessages,
  type ChatHistoryMessage,
} from "./session-history";
import {
  HISTORY_STORE_VERSION,
  loadHistoryMessages,
  loadSessionRegistry,
  normalizeSessionRegistryPayload,
  saveHistoryMessages,
  saveSessionRegistry,
  type SessionRegistryPayload,
} from "./session-registry";

const MEMORY_STORE_REDIS_TTL_SECS = 14 * 24 * 60 * 60;

function nowIsoUtc(): string {
  return new Date().toISOString();
}

function sessionRegistryRedisKey(namespaceKey: string): string {
  return `grobot:ts-dev-cli:session-registry:v1:${encodeURIComponent(namespaceKey)}`;
}

function sessionHistoryRedisKey(sessionKey: string): string {
  return `grobot:ts-dev-cli:session-history:v1:${encodeURIComponent(sessionKey)}`;
}

interface CreateRunStartSessionStoreInput {
  options: Record<string, OptionValue>;
  projectTomlPath: string | undefined;
  homeDir: string;
  sessionNamespaceKey: string;
  historyTurns: number;
}

export function createRunStartSessionStore({
  options,
  projectTomlPath,
  homeDir,
  sessionNamespaceKey,
  historyTurns,
}: CreateRunStartSessionStoreInput) {
  return createSessionStoreController<SessionRegistryPayload, ChatHistoryMessage>({
    runtime: resolveMemoryStoreRuntime(options, projectTomlPath),
    redisTtlSecs: MEMORY_STORE_REDIS_TTL_SECS,
    sessionRegistryRedisKey: sessionRegistryRedisKey(sessionNamespaceKey),
    sessionRegistryFromRedisPayload: (payload) =>
      normalizeSessionRegistryPayload(payload ?? {}, sessionNamespaceKey),
    sessionRegistryToRedisPayload: (payload) =>
      normalizeSessionRegistryPayload(payload, sessionNamespaceKey) as unknown as Record<string, unknown>,
    loadSessionRegistryFromFile: () => loadSessionRegistry(homeDir, sessionNamespaceKey),
    saveSessionRegistryToFile: (payload) =>
      saveSessionRegistry(homeDir, sessionNamespaceKey, normalizeSessionRegistryPayload(payload, sessionNamespaceKey)),
    historyRedisKey: (activeSessionKey) => sessionHistoryRedisKey(activeSessionKey),
    historyFromRedisPayload: (payload) =>
      trimHistoryMessages(normalizeHistoryMessages(payload.messages), historyTurns),
    historyToRedisPayload: (activeSessionKey, rows) => ({
      version: HISTORY_STORE_VERSION,
      session_key: activeSessionKey,
      updated_at: nowIsoUtc(),
      messages: trimHistoryMessages(rows, historyTurns),
    }),
    loadHistoryFromFile: (activeSessionKey) => loadHistoryMessages(homeDir, activeSessionKey, historyTurns),
    saveHistoryToFile: (activeSessionKey, rows) =>
      saveHistoryMessages(homeDir, activeSessionKey, trimHistoryMessages(rows, historyTurns), historyTurns),
    redisGetJson,
    redisSetJson,
  });
}
