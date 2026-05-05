import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { removeTrailingSlashes } from "../services/runtime-paths";
import { normalizeHistoryMessages } from "./session/history";
import {
  REWIND_STORE_VERSION,
  REWIND_SUMMARY_DEFAULT_LIMIT,
  type BeginTurnRewindCaptureInput,
  type CommitTurnRewindCaptureInput,
  type CreateRunStartRewindStoreInput,
  type FileSnapshot,
  type RewindCheckpointRecord,
  type RewindCheckpointSummary,
  type RewindCloneInput,
  type RewindCloneResult,
  type RewindFileRecord,
  type RewindRestoreInput,
  type RewindRestoreResult,
  type RunStartRewindStore,
  type TurnRewindCaptureToken,
} from "./rewind-store/contract";
import { filterFilesByInput } from "./rewind-store/filter";
import { isGitRepository, listDirtyPaths } from "./rewind-store/git";
import {
  appendJsonLine,
  buildCheckpointSummary,
  loadCheckpointRecords,
} from "./rewind-store/records";
import {
  normalizeRelativePath,
  rewindLogPath,
  safeWorkspacePath,
  sanitizeSessionKey,
  sessionsRoot,
} from "./rewind-store/paths";
import {
  readGitHeadSnapshot,
  readWorkspaceFileSnapshot,
} from "./rewind-store/snapshots";
import { buildCheckpointSummaryText } from "./rewind-store/summary";
import { buildCheckpointId, compactSingleLine, nowIsoUtc } from "./rewind-store/time";

export type {
  RewindCheckpointSummary,
  RewindCloneResult,
  RewindRestoreMode,
  RewindRestoreResult,
  RunStartRewindStore,
  TurnRewindCaptureToken,
} from "./rewind-store/contract";

export function createRunStartRewindStore(
  input: CreateRunStartRewindStoreInput,
): RunStartRewindStore {
  const baseWorkDir = removeTrailingSlashes(resolve(input.workDir));

  const beginTurnCapture = (args: BeginTurnRewindCaptureInput): TurnRewindCaptureToken => {
    const gitAvailable = isGitRepository(baseWorkDir);
    const dirtyPaths = gitAvailable ? listDirtyPaths(baseWorkDir) : [];
    const beforeSnapshots = new Map<string, FileSnapshot>();
    for (const pathValue of dirtyPaths) {
      beforeSnapshots.set(pathValue, readWorkspaceFileSnapshot(baseWorkDir, pathValue));
    }
    return {
      __brand: "turn_rewind_capture_token",
      value: {
        sessionKey: args.sessionKey,
        userText: args.userText,
        historyBefore: [...args.historyBefore],
        gitAvailable,
        dirtyPathsBefore: new Set(dirtyPaths),
        beforeSnapshots,
      },
    };
  };

  const commitTurnCapture = async (args: CommitTurnRewindCaptureInput): Promise<void> => {
    const capture = args.capture?.value;
    if (!capture) {
      return;
    }
    const changedFiles: RewindFileRecord[] = [];
    const dirtyAfter = capture.gitAvailable ? listDirtyPaths(baseWorkDir) : [];
    const dirtyAfterSet = new Set(dirtyAfter);
    const candidatePaths = new Set<string>([
      ...Array.from(capture.dirtyPathsBefore.values()),
      ...dirtyAfter,
    ]);
    const checkpointId = buildCheckpointId();
    const root = sessionsRoot(baseWorkDir);
    const backupBaseDir = `${root}/rewind-backups/${sanitizeSessionKey(capture.sessionKey)}/${checkpointId}`;
    for (const pathValue of Array.from(candidatePaths.values()).sort((left, right) =>
      left.localeCompare(right)
    )) {
      const beforeFromSnapshot = capture.beforeSnapshots.get(pathValue);
      let beforeState: FileSnapshot | undefined;
      if (beforeFromSnapshot) {
        const afterSnapshot = readWorkspaceFileSnapshot(baseWorkDir, pathValue);
        const changed =
          beforeFromSnapshot.exists !== afterSnapshot.exists
          || (beforeFromSnapshot.exists
            && afterSnapshot.exists
            && beforeFromSnapshot.hash !== afterSnapshot.hash);
        if (!changed) {
          continue;
        }
        beforeState = beforeFromSnapshot;
      } else if (dirtyAfterSet.has(pathValue)) {
        beforeState = readGitHeadSnapshot(baseWorkDir, pathValue);
      } else {
        continue;
      }
      const row: RewindFileRecord = {
        path: pathValue,
        before_kind: beforeState.exists ? "file" : "absent",
      };
      if (beforeState.exists && beforeState.bytes) {
        const backupPath = join(backupBaseDir, ...pathValue.split("/"));
        mkdirSync(dirname(backupPath), { recursive: true });
        writeFileSync(backupPath, beforeState.bytes);
        row.backup_rel_path = normalizeRelativePath(relative(root, backupPath)) ?? undefined;
        row.before_hash = beforeState.hash;
        row.before_size_bytes = beforeState.sizeBytes;
      }
      changedFiles.push(row);
    }
    const checkpoint: RewindCheckpointRecord = {
      version: REWIND_STORE_VERSION,
      checkpoint_id: checkpointId,
      session_key: capture.sessionKey,
      created_at: nowIsoUtc(),
      user_text: compactSingleLine(capture.userText, 220),
      assistant_text: compactSingleLine(args.assistantText, 220),
      history_before: normalizeHistoryMessages(capture.historyBefore),
      history_before_count: capture.historyBefore.length,
      history_after_count: args.historyAfter.length,
      changed_files: changedFiles,
    };
    appendJsonLine(rewindLogPath(baseWorkDir, capture.sessionKey), checkpoint as unknown as Record<string, unknown>);
  };

  const listCheckpoints = (
    sessionKey: string,
    limit?: number,
  ): RewindCheckpointSummary[] => {
    const records = loadCheckpointRecords(baseWorkDir, sessionKey);
    const maxRows = typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? Math.max(1, Math.floor(limit))
      : REWIND_SUMMARY_DEFAULT_LIMIT;
    return records
      .map((record) => buildCheckpointSummary(record))
      .reverse()
      .slice(0, maxRows);
  };

  const formatCheckpointSummary = (
    sessionKey: string,
    limit?: number,
  ): string =>
    buildCheckpointSummaryText(sessionKey, listCheckpoints(sessionKey, limit));

  const restoreCheckpoint = async (
    args: RewindRestoreInput,
  ): Promise<RewindRestoreResult> => {
    const checkpoints = loadCheckpointRecords(baseWorkDir, args.sessionKey);
    if (checkpoints.length === 0) {
      throw new Error("no rewind checkpoints available");
    }
    const checkpoint = args.checkpointId
      ? checkpoints.find((item) => item.checkpoint_id === args.checkpointId)
      : checkpoints[checkpoints.length - 1];
    if (!checkpoint) {
      throw new Error(`rewind checkpoint not found: ${args.checkpointId}`);
    }
    const restoredFiles: string[] = [];
    let restoredCode = false;
    if (args.mode === "both" || args.mode === "code") {
      const filtered = filterFilesByInput(checkpoint.changed_files, args.fileFilter);
      for (const fileRow of filtered.selected) {
        const targetPath = safeWorkspacePath(baseWorkDir, fileRow.path);
        if (!targetPath) {
          continue;
        }
        if (fileRow.before_kind === "absent") {
          rmSync(targetPath, { force: true, recursive: false });
          restoredFiles.push(fileRow.path);
          continue;
        }
        if (!fileRow.backup_rel_path) {
          continue;
        }
        const backupPath = resolve(
          sessionsRoot(baseWorkDir),
          fileRow.backup_rel_path,
        );
        if (!existsSync(backupPath)) {
          continue;
        }
        mkdirSync(dirname(targetPath), { recursive: true });
        copyFileSync(backupPath, targetPath);
        restoredFiles.push(fileRow.path);
      }
      restoredCode = restoredFiles.length > 0;
    }
    let restoredConversation = false;
    if (args.mode === "both" || args.mode === "conversation") {
      args.setHistoryMessages(checkpoint.history_before);
      await args.persistHistoryState();
      restoredConversation = true;
    }
    return {
      checkpointId: checkpoint.checkpoint_id,
      mode: args.mode,
      restoredConversation,
      restoredCode,
      restoredFiles,
      skippedFiles: filterFilesByInput(checkpoint.changed_files, args.fileFilter).skipped,
    };
  };

  const cloneSessionCheckpoints = (args: RewindCloneInput): RewindCloneResult => {
    const sourceSessionKey = args.sourceSessionKey.trim();
    const targetSessionKey = args.targetSessionKey.trim();
    if (!sourceSessionKey || !targetSessionKey || sourceSessionKey === targetSessionKey) {
      return {
        copiedCheckpoints: 0,
        copiedBackupFiles: 0,
        failedBackupFiles: 0,
      };
    }
    const sourceRecords = loadCheckpointRecords(baseWorkDir, sourceSessionKey);
    if (sourceRecords.length === 0) {
      return {
        copiedCheckpoints: 0,
        copiedBackupFiles: 0,
        failedBackupFiles: 0,
      };
    }
    const targetRecords = loadCheckpointRecords(baseWorkDir, targetSessionKey);
    const usedCheckpointIds = new Set<string>(
      targetRecords.map((item) => item.checkpoint_id),
    );
    const root = sessionsRoot(baseWorkDir);
    const targetSessionKeySafe = sanitizeSessionKey(targetSessionKey);
    let copiedCheckpoints = 0;
    let copiedBackupFiles = 0;
    let failedBackupFiles = 0;
    for (const sourceRecord of sourceRecords) {
      let targetCheckpointId = sourceRecord.checkpoint_id;
      while (usedCheckpointIds.has(targetCheckpointId)) {
        targetCheckpointId = buildCheckpointId();
      }
      usedCheckpointIds.add(targetCheckpointId);
      const nextChangedFiles: RewindFileRecord[] = sourceRecord.changed_files.map((fileRow) => {
        if (fileRow.before_kind !== "file" || !fileRow.backup_rel_path) {
          return { ...fileRow };
        }
        const sourceBackupPath = resolve(root, fileRow.backup_rel_path);
        if (!existsSync(sourceBackupPath)) {
          failedBackupFiles += 1;
          return {
            ...fileRow,
            backup_rel_path: undefined,
          };
        }
        const targetBackupPath = join(
          root,
          "rewind-backups",
          targetSessionKeySafe,
          targetCheckpointId,
          ...fileRow.path.split("/"),
        );
        mkdirSync(dirname(targetBackupPath), { recursive: true });
        copyFileSync(sourceBackupPath, targetBackupPath);
        copiedBackupFiles += 1;
        return {
          ...fileRow,
          backup_rel_path: normalizeRelativePath(relative(root, targetBackupPath)) ?? undefined,
        };
      });
      const clonedRecord: RewindCheckpointRecord = {
        ...sourceRecord,
        checkpoint_id: targetCheckpointId,
        session_key: targetSessionKey,
        changed_files: nextChangedFiles,
      };
      appendJsonLine(
        rewindLogPath(baseWorkDir, targetSessionKey),
        clonedRecord as unknown as Record<string, unknown>,
      );
      copiedCheckpoints += 1;
    }
    return {
      copiedCheckpoints,
      copiedBackupFiles,
      failedBackupFiles,
    };
  };

  return {
    beginTurnCapture,
    commitTurnCapture,
    listCheckpoints,
    formatCheckpointSummary,
    restoreCheckpoint,
    cloneSessionCheckpoints,
  };
}
