import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeHistoryMessages } from "../session/history";
import {
  REWIND_STORE_VERSION,
  type RewindCheckpointRecord,
  type RewindCheckpointSummary,
  type RewindFileRecord,
} from "./contract";
import { normalizeRelativePath, rewindLogPath } from "./paths";

export function appendJsonLine(path: string, payload: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(payload)}\n`, "utf8");
}

export function parseCheckpointRecord(raw: unknown): RewindCheckpointRecord | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const checkpointId = typeof record.checkpoint_id === "string"
    ? record.checkpoint_id.trim()
    : "";
  const sessionKey = typeof record.session_key === "string"
    ? record.session_key.trim()
    : "";
  const createdAt = typeof record.created_at === "string"
    ? record.created_at.trim()
    : "";
  if (!checkpointId || !sessionKey || !createdAt) {
    return undefined;
  }
  const userText = typeof record.user_text === "string" ? record.user_text : "";
  const assistantText = typeof record.assistant_text === "string" ? record.assistant_text : "";
  const historyBefore = Array.isArray(record.history_before)
    ? normalizeHistoryMessages(record.history_before)
    : [];
  const historyBeforeCount = typeof record.history_before_count === "number"
    && Number.isFinite(record.history_before_count)
    ? Math.max(0, Math.floor(record.history_before_count))
    : historyBefore.length;
  const historyAfterCount = typeof record.history_after_count === "number"
    && Number.isFinite(record.history_after_count)
    ? Math.max(0, Math.floor(record.history_after_count))
    : historyBeforeCount + 2;
  const changedFiles: RewindFileRecord[] = [];
  if (Array.isArray(record.changed_files)) {
    for (const item of record.changed_files) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const row = item as Record<string, unknown>;
      const pathValue = typeof row.path === "string"
        ? normalizeRelativePath(row.path)
        : undefined;
      if (!pathValue) {
        continue;
      }
      const beforeKind = row.before_kind === "file" ? "file" : "absent";
      const backupRelPath = typeof row.backup_rel_path === "string"
        ? row.backup_rel_path.trim()
        : undefined;
      const beforeHash = typeof row.before_hash === "string"
        ? row.before_hash.trim()
        : undefined;
      const beforeSizeBytes = typeof row.before_size_bytes === "number"
        && Number.isFinite(row.before_size_bytes)
        ? Math.max(0, Math.floor(row.before_size_bytes))
        : undefined;
      changedFiles.push({
        path: pathValue,
        before_kind: beforeKind,
        backup_rel_path: backupRelPath && backupRelPath.length > 0 ? backupRelPath : undefined,
        before_hash: beforeHash && beforeHash.length > 0 ? beforeHash : undefined,
        before_size_bytes: beforeSizeBytes,
      });
    }
  }
  return {
    version: typeof record.version === "number" ? Math.floor(record.version) : REWIND_STORE_VERSION,
    checkpoint_id: checkpointId,
    session_key: sessionKey,
    created_at: createdAt,
    user_text: userText,
    assistant_text: assistantText,
    history_before: historyBefore,
    history_before_count: historyBeforeCount,
    history_after_count: historyAfterCount,
    changed_files: changedFiles,
  };
}

export function loadCheckpointRecords(
  workDir: string,
  sessionKey: string,
): RewindCheckpointRecord[] {
  const path = rewindLogPath(workDir, sessionKey);
  if (!existsSync(path)) {
    return [];
  }
  const raw = readFileSync(path, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const rows: RewindCheckpointRecord[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      const record = parseCheckpointRecord(parsed);
      if (record && record.session_key === sessionKey) {
        rows.push(record);
      }
    } catch {
      // ignore malformed lines to keep rewind log forward-tolerant
    }
  }
  return rows;
}

export function buildCheckpointSummary(
  record: RewindCheckpointRecord,
): RewindCheckpointSummary {
  return {
    checkpointId: record.checkpoint_id,
    createdAt: record.created_at,
    userText: record.user_text,
    assistantText: record.assistant_text,
    historyBeforeCount: record.history_before_count,
    historyAfterCount: record.history_after_count,
    changedFilesCount: record.changed_files.length,
  };
}
