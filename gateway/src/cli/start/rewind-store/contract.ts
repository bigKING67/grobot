import { type ChatHistoryMessage } from "../session-history";

export const REWIND_STORE_VERSION = 1;
export const REWIND_SUMMARY_DEFAULT_LIMIT = 8;

export type RewindFileBeforeKind = "absent" | "file";

export interface RewindFileRecord {
  path: string;
  before_kind: RewindFileBeforeKind;
  backup_rel_path?: string;
  before_hash?: string;
  before_size_bytes?: number;
}

export interface RewindCheckpointRecord {
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

export interface FileSnapshot {
  exists: boolean;
  hash?: string;
  sizeBytes: number;
  bytes?: Buffer;
}

export interface TurnRewindCaptureInternal {
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

export interface RewindCloneResult {
  copiedCheckpoints: number;
  copiedBackupFiles: number;
  failedBackupFiles: number;
}

export interface RewindRestoreInput {
  sessionKey: string;
  checkpointId?: string;
  mode: Exclude<RewindRestoreMode, "summarize">;
  fileFilter?: readonly string[];
  setHistoryMessages(rows: ChatHistoryMessage[]): void;
  persistHistoryState(): Promise<void>;
}

export interface RewindCloneInput {
  sourceSessionKey: string;
  targetSessionKey: string;
}

export interface BeginTurnRewindCaptureInput {
  sessionKey: string;
  userText: string;
  historyBefore: ChatHistoryMessage[];
}

export interface CommitTurnRewindCaptureInput {
  capture: TurnRewindCaptureToken | undefined;
  assistantText: string;
  historyAfter: ChatHistoryMessage[];
}

export interface CreateRunStartRewindStoreInput {
  workDir: string;
}

export interface RunStartRewindStore {
  beginTurnCapture(input: BeginTurnRewindCaptureInput): TurnRewindCaptureToken;
  commitTurnCapture(input: CommitTurnRewindCaptureInput): Promise<void>;
  listCheckpoints(sessionKey: string, limit?: number): RewindCheckpointSummary[];
  formatCheckpointSummary(sessionKey: string, limit?: number): string;
  restoreCheckpoint(input: RewindRestoreInput): Promise<RewindRestoreResult>;
  cloneSessionCheckpoints(input: RewindCloneInput): RewindCloneResult;
}
