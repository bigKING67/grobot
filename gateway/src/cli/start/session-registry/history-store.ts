import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  dirname,
  fileReadable,
  historyStoreFilePath,
  resolveHistoryStoreReadPath,
} from "./paths";
import { nowIsoUtc } from "./scalars";
import {
  ChatHistoryMessage,
  normalizeHistoryMessages,
  trimHistoryMessages,
} from "../session/history";
import { HISTORY_STORE_VERSION } from "./types";

export function loadHistoryMessages(
  homeDir: string,
  sessionKey: string,
  maxTurns: number,
): {
  messages: ChatHistoryMessage[];
  source: "store" | "empty";
  warnings: string[];
} {
  const resolved = resolveHistoryStoreReadPath(homeDir, sessionKey);
  const warnings: string[] = [...resolved.warnings];
  const sourcePath = resolved.path;
  if (!fileReadable(sourcePath)) {
    return {
      messages: [],
      source: "empty",
      warnings,
    };
  }
  try {
    const raw = JSON.parse(readFileSync(sourcePath, "utf8")) as unknown;
    if (typeof raw !== "object" || raw === null) {
      return {
        messages: [],
        source: "empty",
        warnings: [`history payload is invalid object (${sourcePath})`],
      };
    }
    const payload = raw as Record<string, unknown>;
    const messages = trimHistoryMessages(normalizeHistoryMessages(payload.messages), maxTurns);
    return {
      messages,
      source: messages.length > 0 ? "store" : "empty",
      warnings,
    };
  } catch (error) {
    warnings.push(`history parse failed (${sourcePath}): ${String(error)}`);
    return {
      messages: [],
      source: "empty",
      warnings,
    };
  }
}

export function saveHistoryMessages(
  homeDir: string,
  sessionKey: string,
  historyMessages: ChatHistoryMessage[],
  maxTurns: number,
): string[] {
  const warnings: string[] = [];
  const path = historyStoreFilePath(homeDir, sessionKey);
  const normalized = trimHistoryMessages(historyMessages, maxTurns);
  const payload = {
    version: HISTORY_STORE_VERSION,
    session_key: sessionKey,
    updated_at: nowIsoUtc(),
    messages: normalized,
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(payload, undefined, 2)}\n`, "utf8");
  } catch (error) {
    warnings.push(`history write failed (${path}): ${String(error)}`);
  }
  return warnings;
}
