import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { removeTrailingSlashes } from "../services/runtime-paths";
import { normalizeHistoryMessages, type ChatHistoryMessage } from "./session-history";

const REWIND_STORE_VERSION = 1;
const REWIND_SUMMARY_DEFAULT_LIMIT = 8;

type RewindFileBeforeKind = "absent" | "file";

interface RewindFileRecord {
  path: string;
  before_kind: RewindFileBeforeKind;
  backup_rel_path?: string;
  before_hash?: string;
  before_size_bytes?: number;
}

interface RewindCheckpointRecord {
  version: number;
  checkpoint_id: string;
  session_key: string;
  created_at: string;
  user_text: string;
  assistant_text: string;
  history_before: ChatHistoryMessage[];
  history_before_count: number;
  history_after_count: number;
  changed_files: RewindFileRecord[];
}

interface FileSnapshot {
  exists: boolean;
  hash?: string;
  sizeBytes: number;
  bytes?: Buffer;
}

interface TurnRewindCaptureInternal {
  sessionKey: string;
  userText: string;
  historyBefore: ChatHistoryMessage[];
  gitAvailable: boolean;
  dirtyPathsBefore: Set<string>;
  beforeSnapshots: Map<string, FileSnapshot>;
}

export interface TurnRewindCaptureToken {
  __brand: "turn_rewind_capture_token";
  value: TurnRewindCaptureInternal;
}

export type RewindRestoreMode = "both" | "conversation" | "code" | "summarize";

export interface RewindCheckpointSummary {
  checkpointId: string;
  createdAt: string;
  userText: string;
  assistantText: string;
  historyBeforeCount: number;
  historyAfterCount: number;
  changedFilesCount: number;
}

export interface RewindRestoreResult {
  checkpointId: string;
  mode: RewindRestoreMode;
  restoredConversation: boolean;
  restoredCode: boolean;
  restoredFiles: string[];
  skippedFiles: string[];
}

interface RewindRestoreInput {
  sessionKey: string;
  checkpointId?: string;
  mode: Exclude<RewindRestoreMode, "summarize">;
  fileFilter?: readonly string[];
  setHistoryMessages(rows: ChatHistoryMessage[]): void;
  persistHistoryState(): Promise<void>;
}

interface BeginTurnRewindCaptureInput {
  sessionKey: string;
  userText: string;
  historyBefore: ChatHistoryMessage[];
}

interface CommitTurnRewindCaptureInput {
  capture: TurnRewindCaptureToken | undefined;
  assistantText: string;
  historyAfter: ChatHistoryMessage[];
}

interface CreateRunStartRewindStoreInput {
  workDir: string;
}

function nowIsoUtc(): string {
  return new Date().toISOString();
}

function hashBuffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeSessionKey(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function compactSingleLine(raw: string, maxChars: number): string {
  const normalized = raw.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  if (maxChars <= 1) {
    return normalized.slice(0, 1);
  }
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function normalizeRelativePath(input: string): string | undefined {
  const cleaned = input.replace(/\\/g, "/").replace(/^\.\/+/g, "");
  if (!cleaned || cleaned === ".") {
    return undefined;
  }
  const normalized = cleaned
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
  if (!normalized || normalized.startsWith("..") || normalized.includes("/../")) {
    return undefined;
  }
  return normalized;
}

function sessionsRoot(workDir: string): string {
  return `${removeTrailingSlashes(workDir)}/.grobot/sessions`;
}

function rewindLogPath(workDir: string, sessionKey: string): string {
  return `${sessionsRoot(workDir)}/${sanitizeSessionKey(sessionKey)}.rewind.jsonl`;
}

function safeWorkspacePath(workDir: string, pathValue: string): string | undefined {
  if (!pathValue || isAbsolute(pathValue)) {
    return undefined;
  }
  const normalizedRelative = normalizeRelativePath(pathValue);
  if (!normalizedRelative) {
    return undefined;
  }
  const workspaceRoot = removeTrailingSlashes(resolve(workDir));
  const absolutePath = resolve(workspaceRoot, normalizedRelative);
  const normalizedAbsolute = normalize(absolutePath);
  if (
    normalizedAbsolute !== workspaceRoot
    && !normalizedAbsolute.startsWith(`${workspaceRoot}/`)
  ) {
    return undefined;
  }
  return normalizedAbsolute;
}

function parseNullSeparatedPathList(buffer: Buffer): string[] {
  const raw = buffer.toString("utf8");
  const entries = raw.split("\0");
  const paths: string[] = [];
  for (const entry of entries) {
    const normalized = normalizeRelativePath(entry);
    if (!normalized) {
      continue;
    }
    if (!paths.includes(normalized)) {
      paths.push(normalized);
    }
  }
  return paths;
}

function runGitBuffer(workDir: string, args: string[]): {
  ok: boolean;
  stdout: Buffer;
  stderr: string;
} {
  const completed = spawnSync("git", args, {
    cwd: workDir,
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = completed.stdout instanceof Buffer
    ? completed.stdout
    : Buffer.from(String(completed.stdout ?? ""), "utf8");
  const stderr = completed.stderr instanceof Buffer
    ? completed.stderr.toString("utf8")
    : String(completed.stderr ?? "");
  return {
    ok: completed.status === 0,
    stdout,
    stderr,
  };
}

function isGitRepository(workDir: string): boolean {
  const probe = runGitBuffer(workDir, ["rev-parse", "--is-inside-work-tree"]);
  return probe.ok && probe.stdout.toString("utf8").trim() === "true";
}

function listDirtyPaths(workDir: string): string[] {
  const tracked = runGitBuffer(workDir, ["diff", "--name-only", "-z", "HEAD", "--"]);
  const untracked = runGitBuffer(workDir, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const paths = new Set<string>();
  if (tracked.ok) {
    for (const entry of parseNullSeparatedPathList(tracked.stdout)) {
      paths.add(entry);
    }
  }
  if (untracked.ok) {
    for (const entry of parseNullSeparatedPathList(untracked.stdout)) {
      paths.add(entry);
    }
  }
  return Array.from(paths.values()).sort((left, right) => left.localeCompare(right));
}

function readWorkspaceFileSnapshot(workDir: string, relativePath: string): FileSnapshot {
  const absolutePath = safeWorkspacePath(workDir, relativePath);
  if (!absolutePath || !existsSync(absolutePath)) {
    return {
      exists: false,
      sizeBytes: 0,
    };
  }
  const bytes = readFileSync(absolutePath);
  return {
    exists: true,
    bytes,
    hash: hashBuffer(bytes),
    sizeBytes: bytes.length,
  };
}

function readGitHeadSnapshot(workDir: string, relativePath: string): FileSnapshot {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (!normalizedPath) {
    return {
      exists: false,
      sizeBytes: 0,
    };
  }
  const output = runGitBuffer(workDir, ["show", `HEAD:${normalizedPath}`]);
  if (!output.ok) {
    return {
      exists: false,
      sizeBytes: 0,
    };
  }
  const bytes = output.stdout;
  return {
    exists: true,
    bytes,
    hash: hashBuffer(bytes),
    sizeBytes: bytes.length,
  };
}

function appendJsonLine(path: string, payload: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(payload)}\n`, "utf8");
}

function parseCheckpointRecord(raw: unknown): RewindCheckpointRecord | undefined {
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

function loadCheckpointRecords(workDir: string, sessionKey: string): RewindCheckpointRecord[] {
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

function buildCheckpointSummary(record: RewindCheckpointRecord): RewindCheckpointSummary {
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

function filterFilesByInput(
  changedFiles: readonly RewindFileRecord[],
  fileFilter?: readonly string[],
): {
  selected: RewindFileRecord[];
  skipped: string[];
} {
  if (!Array.isArray(fileFilter) || fileFilter.length === 0) {
    return {
      selected: [...changedFiles],
      skipped: [],
    };
  }
  const normalizedFilter = new Set<string>();
  for (const item of fileFilter) {
    const normalized = normalizeRelativePath(item);
    if (normalized) {
      normalizedFilter.add(normalized);
    }
  }
  if (normalizedFilter.size === 0) {
    return {
      selected: [],
      skipped: changedFiles.map((item) => item.path),
    };
  }
  const selected: RewindFileRecord[] = [];
  const skipped: string[] = [];
  for (const item of changedFiles) {
    if (normalizedFilter.has(item.path)) {
      selected.push(item);
    } else {
      skipped.push(item.path);
    }
  }
  return {
    selected,
    skipped,
  };
}

function buildCheckpointSummaryText(
  sessionKey: string,
  summaries: readonly RewindCheckpointSummary[],
): string {
  const lines: string[] = [];
  lines.push(`[rewind] session=${sessionKey} checkpoints=${String(summaries.length)}`);
  if (summaries.length === 0) {
    lines.push("[rewind] no checkpoints available.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }
  for (const row of summaries) {
    lines.push(
      `- ${row.checkpointId} | ${row.createdAt} | files=${String(row.changedFilesCount)} | history=${String(
        row.historyBeforeCount,
      )}->${String(row.historyAfterCount)} | user=${compactSingleLine(row.userText, 72)}`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildCheckpointId(): string {
  const now = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `rw_${now}_${random}`;
}

export interface RunStartRewindStore {
  beginTurnCapture(input: BeginTurnRewindCaptureInput): TurnRewindCaptureToken;
  commitTurnCapture(input: CommitTurnRewindCaptureInput): Promise<void>;
  listCheckpoints(sessionKey: string, limit?: number): RewindCheckpointSummary[];
  formatCheckpointSummary(sessionKey: string, limit?: number): string;
  restoreCheckpoint(input: RewindRestoreInput): Promise<RewindRestoreResult>;
}

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

  return {
    beginTurnCapture,
    commitTurnCapture,
    listCheckpoints,
    formatCheckpointSummary,
    restoreCheckpoint,
  };
}
