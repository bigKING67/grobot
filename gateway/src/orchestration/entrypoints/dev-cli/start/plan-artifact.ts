import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { removeTrailingSlashes } from "../services/runtime-paths";

export type PlanArtifactStatus =
  | "draft"
  | "blocked"
  | "review_failed"
  | "ready"
  | "approved"
  | "applying"
  | "apply_failed"
  | "applied"
  | "discarded";

export interface PlanArtifactEntry {
  plan_id: string;
  seq: number;
  title: string;
  task_slug: string;
  filename: string;
  status: PlanArtifactStatus;
  created_at: string;
  updated_at: string;
  reviewed_at?: string;
  review_fail_count?: number;
  blocked_count?: number;
  apply_started_at?: string;
  approved_at?: string;
  approved_hash?: string;
  approval_ticket_id?: string;
  approved_snapshot_path?: string;
  approved_by?: string;
  apply_failed_at?: string;
  applied_at?: string;
  discarded_at?: string;
}

export interface PlanArtifactIndex {
  version: number;
  session_id: string;
  active_plan_id?: string;
  updated_at: string;
  entries: PlanArtifactEntry[];
}

export interface CreatedPlanArtifact {
  index: PlanArtifactIndex;
  entry: PlanArtifactEntry;
  planPath: string;
  sessionPlanDir: string;
}

export interface ActivePlanArtifact {
  index: PlanArtifactIndex;
  entry: PlanArtifactEntry;
  planPath: string;
  content: string;
  sessionPlanDir: string;
}

export interface PlanArtifactEvent {
  at: string;
  event: string;
  session_id: string;
  plan_id?: string;
  source?: "cli" | "bridge" | "system";
  detail?: string;
  status_from?: PlanArtifactStatus;
  status_to?: PlanArtifactStatus;
}

export interface PlanLatestFailureDiagnostic {
  at: string;
  event: string;
  planId?: string;
  detail?: string;
  exitCode?: number;
  policyAction?: "fail" | "degrade";
  policyReason?: string;
  diagnosticCode?: string;
  providerName?: string;
  errorClass?: string;
  reviewBlocked?: boolean;
  findingsCount?: number;
}

export interface PlanLatestVerificationDiagnostic {
  at: string;
  event: "plan_verification_pending" | "plan_verification_passed" | "plan_verification_failed";
  planId?: string;
  detail?: string;
  status: "pending" | "passed" | "failed";
}

export interface PlanReviewFinding {
  code: string;
  section?: string;
  message: string;
}

export interface PlanReviewResult {
  ok: boolean;
  blocked: boolean;
  findings: PlanReviewFinding[];
  checked_at: string;
}

export interface PlanQualitySummary {
  score: number;
  grade: "A" | "B" | "C" | "D" | "E";
  findingCount: number;
  blocked: boolean;
  recommendation: string;
  rewriteHints: string[];
}

export interface PlanQualityTrendSummary {
  trend: "up" | "down" | "flat" | "none";
  previousPlanId?: string;
  previousScore?: number;
  deltaFromPrevious?: number;
}

export interface PlanQualityGuardSummary {
  level: "healthy" | "watch" | "critical";
  regressionStreak: number;
  reason: string;
}

export type PlanQualityGuardMode = "off" | "warn" | "strict";

export interface PlanQualityRepairAction {
  id: string;
  priority: "p0" | "p1" | "p2";
  title: string;
  command: string;
  rationale: string;
}

export interface PlanQualityBenchmarkCandidate {
  label: string;
  content: string;
  sourcePath?: string;
}

export interface PlanQualityBenchmarkRow {
  rank: number;
  label: string;
  sourcePath?: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "E";
  findingCount: number;
  blocked: boolean;
  guardLevel: "healthy" | "watch" | "critical";
  guardReason: string;
  repairActionCount: number;
  topHint: string;
  topRepairAction: string;
}

export interface PlanQualityBenchmarkResult {
  rows: PlanQualityBenchmarkRow[];
  winner: PlanQualityBenchmarkRow;
}

export interface PlanQualityBenchmarkPresetCandidate {
  label: string;
  path: string;
}

export interface PlanQualityBenchmarkPresetResolution {
  preset: "generic" | "core";
  candidates: PlanQualityBenchmarkPresetCandidate[];
  missingLabels: string[];
  policySource: "builtin_default" | "workdir_profile" | "cwd_profile" | "env_path" | "invalid_fallback";
  policyPath?: string;
  policyWarning?: string;
}

export interface PlanQualityBenchmarkEventDetailInput {
  comparedCount: number;
  winnerLabel: string;
  winnerScore: number;
  winnerGrade: "A" | "B" | "C" | "D" | "E";
  winnerTopHint?: string;
  winnerTopRepairAction?: string;
  runnerUpLabel?: string;
  runnerUpScore?: number;
  winnerLeadScore?: number;
  preset?: string;
  guardMode?: PlanQualityGuardMode;
  guardPolicyProfile?: string;
  assertBest?: string;
  assertPassed?: boolean;
  assertActual?: string;
}

export interface PlanQualityBenchmarkHistoryRun {
  at: string;
  planId?: string;
  comparedCount: number;
  winnerLabel: string;
  winnerScore: number;
  winnerGrade: "A" | "B" | "C" | "D" | "E";
  winnerTopHint?: string;
  winnerTopRepairAction?: string;
  runnerUpLabel?: string;
  runnerUpScore?: number;
  winnerLeadScore?: number;
  preset?: string;
  guardMode?: PlanQualityGuardMode;
  guardPolicyProfile?: string;
  assertBest?: string;
  assertPassed?: boolean;
  assertActual?: string;
}

export interface PlanQualityBenchmarkHistorySummary {
  totalRuns: number;
  recentRuns: PlanQualityBenchmarkHistoryRun[];
  latestWinnerLabel?: string;
  latestWinnerScore?: number;
  latestWinnerGrade?: "A" | "B" | "C" | "D" | "E";
  latestWinnerTopHint?: string;
  latestWinnerTopRepairAction?: string;
  latestWinnerLeadScore?: number;
  latestRunAt?: string;
  winnerChangedFromPrevious?: boolean;
  winnerSequence: string[];
  winnerReasonSequence: string[];
  winnerSwitchCount: number;
  scoreTrend: "up" | "down" | "flat" | "none";
  deltaFromPrevious?: number;
  assertCount: number;
  assertPassCount: number;
  assertFailCount: number;
  assertPassRate?: number;
}

export interface PlanQualityBenchmarkSemanticCorrelation {
  level: "none" | "watch" | "high";
  reason: string;
}

export interface PlanQualityBenchmarkHealthSummary {
  score: number;
  level: "good" | "watch" | "risk";
  reason: string;
  components: {
    trend: number;
    stability: number;
    assertion: number;
    semantic: number;
  };
}

export interface PlanQualityBenchmarkRecommendation {
  action: string;
  reason: string;
}

export interface PlanQualityGuardPolicy {
  schema: "plan_quality_guard_policy";
  schema_version: 1;
  profile: string;
  defaults: {
    mode: PlanQualityGuardMode;
  };
  thresholds: {
    critical_score: number;
    watch_score: number;
    severe_drop_delta: number;
    critical_regression_streak: number;
    watch_on_trend_down: boolean;
  };
}

type PlanQualityGuardPolicySource =
  | "builtin_default"
  | "workdir_profile"
  | "cwd_profile"
  | "env_path"
  | "invalid_fallback";

export interface ResolvedPlanQualityGuardPolicy {
  policy: PlanQualityGuardPolicy;
  source: PlanQualityGuardPolicySource;
  policyPath?: string;
  warning?: string;
}

export interface PlanApprovalResult {
  approved: boolean;
  entry?: PlanArtifactEntry;
  planHash?: string;
  ticketId?: string;
  snapshotPath?: string;
}

const PLAN_ARTIFACT_INDEX_VERSION = 2;
const PLAN_PROGRESS_SECTION = "## Progress Log";
const PLAN_LOCK_WAIT_MS = 20;
const PLAN_LOCK_TIMEOUT_MS = 4_000;
const PLAN_LOCK_STALE_MS = 30_000;
const PLAN_EVENTS_DEFAULT_MAX_BYTES = 1_048_576;
const PLAN_EVENTS_DEFAULT_ROTATE_KEEP = 5;
const PLAN_APPLY_STALE_DEFAULT_MS = 10 * 60 * 1000;
const PLAN_QUALITY_GUARD_POLICY_SCHEMA = "plan_quality_guard_policy";
const PLAN_QUALITY_GUARD_POLICY_VERSION = 1;
const PLAN_QUALITY_GUARD_POLICY_PROFILE_ENV = "GROBOT_PLAN_QUALITY_GUARD_PROFILE";
const PLAN_QUALITY_GUARD_POLICY_PATH_ENV = "GROBOT_PLAN_QUALITY_GUARD_POLICY_PATH";
const PLAN_BENCHMARK_CODEX_PATH_ENV = "GROBOT_PLAN_BENCHMARK_CODEX_PATH";
const PLAN_BENCHMARK_CLAUDE_PATH_ENV = "GROBOT_PLAN_BENCHMARK_CLAUDE_PATH";
const PLAN_BENCHMARK_GENERIC_AGENT_PATH_ENV = "GROBOT_PLAN_BENCHMARK_GENERIC_AGENT_PATH";
const PLAN_BENCHMARK_PRESET_PROFILE_ENV = "GROBOT_PLAN_BENCHMARK_PRESET_PROFILE";
const PLAN_BENCHMARK_PRESET_POLICY_PATH_ENV = "GROBOT_PLAN_BENCHMARK_PRESET_POLICY_PATH";
const PLAN_BENCHMARK_PRESET_POLICY_SCHEMA = "plan_quality_benchmark_preset_policy";
const PLAN_BENCHMARK_PRESET_POLICY_VERSION = 1;
const PLAN_BENCHMARK_PRESET_DEFAULT_PROFILE = "prod";
const PLAN_BENCHMARK_PRESET_POLICY_FILE_PREFIX = "plan_quality_benchmark_preset.";
const PLAN_BENCHMARK_PRESET_POLICY_FILE_SUFFIX = ".json";
const PLAN_BENCHMARK_NO_HINT = "no_hint_available";
const PLAN_QUALITY_GUARD_DEFAULT_PROFILE = "prod";
const PLAN_QUALITY_GUARD_POLICY_EVALS_RELATIVE = "gateway/evals";
const PLAN_QUALITY_GUARD_POLICY_FILE_PREFIX = "plan_quality_guard_policy.";
const PLAN_QUALITY_GUARD_POLICY_FILE_SUFFIX = ".json";
const PLAN_BENCHMARK_DEFAULT_CODEX_PATHS = [
  "/Users/gaoqian/Documents/sixseven/tools/all/src/commands.ts",
  "/Users/gaoqian/Documents/sixseven/tools/all/src/commands/help/help.tsx",
] as const;
const PLAN_BENCHMARK_DEFAULT_CLAUDE_PATHS = [
  "/Users/gaoqian/Documents/sixseven/tools/all/src/services/api/claude.ts",
  "/Users/gaoqian/Documents/sixseven/tools/all/src/services/claudeAiLimits.ts",
] as const;
const PLAN_BENCHMARK_DEFAULT_GENERIC_AGENT_PATHS = [
  "/Users/gaoqian/Documents/sixseven/codeproject/GenericAgent/memory/plan_sop.md",
  "/Users/gaoqian/Documents/sixseven/codeproject/GenericAgent/memory/autonomous_operation_sop/task_planning.md",
] as const;

interface PlanQualityBenchmarkPresetPolicy {
  schema: "plan_quality_benchmark_preset_policy";
  schema_version: 1;
  profile: string;
  presets: {
    generic: {
      candidates: Array<{
        label: string;
        path: string;
      }>;
    };
    core: {
      candidates: Array<{
        label: string;
        path: string;
      }>;
    };
  };
}

interface ResolvedPlanQualityBenchmarkPresetPolicy {
  policy: PlanQualityBenchmarkPresetPolicy;
  source: "builtin_default" | "workdir_profile" | "cwd_profile" | "env_path" | "invalid_fallback";
  policyPath?: string;
  warning?: string;
}
const DEFAULT_PLAN_QUALITY_GUARD_POLICY: PlanQualityGuardPolicy = {
  schema: "plan_quality_guard_policy",
  schema_version: 1,
  profile: PLAN_QUALITY_GUARD_DEFAULT_PROFILE,
  defaults: {
    mode: "warn",
  },
  thresholds: {
    critical_score: 55,
    watch_score: 70,
    severe_drop_delta: 15,
    critical_regression_streak: 2,
    watch_on_trend_down: true,
  },
};
const SLEEP_SIGNAL = new Int32Array(new SharedArrayBuffer(4));
const PROPOSED_PLAN_OPEN_TAG = "<proposed_plan>";
const PROPOSED_PLAN_CLOSE_TAG = "</proposed_plan>";
const REQUIRED_PLAN_SECTIONS = [
  "Goal",
  "Scope In",
  "Scope Out",
  "Milestones",
  "Validation",
  "Risk & Rollback",
] as const;

function nowIsoUtc(): string {
  return new Date().toISOString();
}

function removeDangerousChars(value: string): string {
  return value
    .replace(/[`*_#<>{}\[\]()|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeSegment(raw: string, fallback: string, maxLen = 64): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "");
  const finalValue = normalized.length > 0 ? normalized : fallback;
  return finalValue.slice(0, Math.max(1, maxLen));
}

function compactSingleLine(raw: string, maxLen: number): string {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLen) {
    return compact;
  }
  return `${compact.slice(0, Math.max(1, maxLen)).trimEnd()}…`;
}

function dirname(path: string): string {
  const normalized = removeTrailingSlashes(path);
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function writeFileAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.floor(Math.random() * 65_536).toString(16)}`;
  writeFileSync(tempPath, content, "utf8");
  try {
    renameSync(tempPath, path);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // ignore temp cleanup errors
    }
    throw error;
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (typeof raw !== "string") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseOptionalNonNegativeInt(raw: string | undefined): number | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function parseOptionalFiniteNumber(raw: string | undefined): number | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function resolveCandidatePath(workDir: string, rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed.startsWith("/")) {
    return resolvePath(trimmed);
  }
  return resolvePath(workDir, trimmed);
}

function resolveExistingCandidatePath(workDir: string, rawPath: string | undefined): string | undefined {
  if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
    return undefined;
  }
  const resolved = resolveCandidatePath(workDir, rawPath);
  if (!existsSync(resolved)) {
    return undefined;
  }
  return resolved;
}

function resolveCandidatePathFromFallbacks(
  workDir: string,
  fallbackPaths: readonly string[],
): string | undefined {
  for (const fallbackPath of fallbackPaths) {
    const resolved = resolveExistingCandidatePath(workDir, fallbackPath);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

function resolveCandidatePathFromFallbacksOrFirst(
  workDir: string,
  fallbackPaths: readonly string[],
): string | undefined {
  const existing = resolveCandidatePathFromFallbacks(workDir, fallbackPaths);
  if (existing) {
    return existing;
  }
  const first = fallbackPaths[0];
  if (!first) {
    return undefined;
  }
  return resolveCandidatePath(workDir, first);
}

function resolveConfiguredCandidatePath(input: {
  workDir: string;
  envName: string;
  fallbackPaths: readonly string[];
}): string | undefined {
  const envRaw = process.env[input.envName];
  if (typeof envRaw === "string" && envRaw.trim().length > 0) {
    return resolveCandidatePath(input.workDir, envRaw.trim());
  }
  return resolveCandidatePathFromFallbacksOrFirst(input.workDir, input.fallbackPaths);
}

function pushPresetCandidate(
  candidates: PlanQualityBenchmarkPresetCandidate[],
  missingLabels: string[],
  input: {
    label: string;
    path?: string;
  },
): void {
  if (input.path) {
    candidates.push({
      label: input.label,
      path: input.path,
    });
    return;
  }
  missingLabels.push(input.label);
}

function resolveBenchmarkPresetProfile(raw: string | undefined): string {
  if (typeof raw !== "string") {
    return PLAN_BENCHMARK_PRESET_DEFAULT_PROFILE;
  }
  const normalized = sanitizeSegment(raw, PLAN_BENCHMARK_PRESET_DEFAULT_PROFILE, 32);
  return normalized.length > 0 ? normalized : PLAN_BENCHMARK_PRESET_DEFAULT_PROFILE;
}

function parseBenchmarkPresetCandidate(
  raw: unknown,
  fieldName: string,
): {
  label: string;
  path: string;
} {
  if (!isRecord(raw)) {
    throw new Error(`policy field ${fieldName}[] must be object`);
  }
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  const path = typeof raw.path === "string" ? raw.path.trim() : "";
  if (!label) {
    throw new Error(`policy field ${fieldName}[].label must be non-empty string`);
  }
  if (!path) {
    throw new Error(`policy field ${fieldName}[].path must be non-empty string`);
  }
  return {
    label,
    path,
  };
}

function parseBenchmarkPresetCandidates(
  raw: unknown,
  fieldName: string,
): Array<{
  label: string;
  path: string;
}> {
  if (!Array.isArray(raw)) {
    throw new Error(`policy field ${fieldName} must be array`);
  }
  return raw.map((item) => parseBenchmarkPresetCandidate(item, fieldName));
}

function buildDefaultPlanQualityBenchmarkPresetPolicy(
  profile: string,
  workDir: string,
): PlanQualityBenchmarkPresetPolicy {
  const codexPath = resolveConfiguredCandidatePath({
    workDir,
    envName: PLAN_BENCHMARK_CODEX_PATH_ENV,
    fallbackPaths: PLAN_BENCHMARK_DEFAULT_CODEX_PATHS,
  });
  const claudePath = resolveConfiguredCandidatePath({
    workDir,
    envName: PLAN_BENCHMARK_CLAUDE_PATH_ENV,
    fallbackPaths: PLAN_BENCHMARK_DEFAULT_CLAUDE_PATHS,
  });
  const genericPath = resolveConfiguredCandidatePath({
    workDir,
    envName: PLAN_BENCHMARK_GENERIC_AGENT_PATH_ENV,
    fallbackPaths: PLAN_BENCHMARK_DEFAULT_GENERIC_AGENT_PATHS,
  });
  return {
    schema: PLAN_BENCHMARK_PRESET_POLICY_SCHEMA,
    schema_version: PLAN_BENCHMARK_PRESET_POLICY_VERSION,
    profile,
    presets: {
      generic: {
        candidates: genericPath
          ? [
            {
              label: "generic_agent",
              path: genericPath,
            },
          ]
          : [],
      },
      core: {
        candidates: [
          codexPath
            ? {
              label: "codex_baseline",
              path: codexPath,
            }
            : undefined,
          claudePath
            ? {
              label: "claude_baseline",
              path: claudePath,
            }
            : undefined,
          genericPath
            ? {
              label: "generic_agent",
              path: genericPath,
            }
            : undefined,
        ].filter((item): item is { label: string; path: string } => Boolean(item)),
      },
    },
  };
}

function parsePlanQualityBenchmarkPresetPolicy(raw: string): PlanQualityBenchmarkPresetPolicy {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error("policy root must be object");
  }
  if (parsed.schema !== PLAN_BENCHMARK_PRESET_POLICY_SCHEMA) {
    throw new Error(`policy schema must be ${PLAN_BENCHMARK_PRESET_POLICY_SCHEMA}`);
  }
  if (parsed.schema_version !== PLAN_BENCHMARK_PRESET_POLICY_VERSION) {
    throw new Error(`policy schema_version must be ${String(PLAN_BENCHMARK_PRESET_POLICY_VERSION)}`);
  }
  if (typeof parsed.profile !== "string" || parsed.profile.trim().length === 0) {
    throw new Error("policy field profile must be non-empty string");
  }
  const presetsRaw = parsed.presets;
  if (!isRecord(presetsRaw)) {
    throw new Error("policy field presets must be object");
  }
  const genericRaw = presetsRaw.generic;
  const coreRaw = presetsRaw.core;
  if (!isRecord(genericRaw) || !isRecord(coreRaw)) {
    throw new Error("policy field presets.generic/core must be object");
  }
  return {
    schema: PLAN_BENCHMARK_PRESET_POLICY_SCHEMA,
    schema_version: PLAN_BENCHMARK_PRESET_POLICY_VERSION,
    profile: resolveBenchmarkPresetProfile(parsed.profile),
    presets: {
      generic: {
        candidates: parseBenchmarkPresetCandidates(genericRaw.candidates, "presets.generic.candidates"),
      },
      core: {
        candidates: parseBenchmarkPresetCandidates(coreRaw.candidates, "presets.core.candidates"),
      },
    },
  };
}

function resolvePlanQualityBenchmarkPresetPolicyCandidates(
  workDir: string,
  profile: string,
): Array<{
  source: "workdir_profile" | "cwd_profile" | "env_path";
  path: string;
}> {
  const candidates: Array<{
    source: "workdir_profile" | "cwd_profile" | "env_path";
    path: string;
  }> = [];
  const envPathRaw = process.env[PLAN_BENCHMARK_PRESET_POLICY_PATH_ENV];
  if (typeof envPathRaw === "string" && envPathRaw.trim().length > 0) {
    candidates.push({
      source: "env_path",
      path: resolvePath(envPathRaw.trim()),
    });
  }
  const filename = `${PLAN_BENCHMARK_PRESET_POLICY_FILE_PREFIX}${profile}${PLAN_BENCHMARK_PRESET_POLICY_FILE_SUFFIX}`;
  candidates.push({
    source: "workdir_profile",
    path: resolvePath(workDir, PLAN_QUALITY_GUARD_POLICY_EVALS_RELATIVE, filename),
  });
  const cwdCandidate = resolvePath(process.cwd(), PLAN_QUALITY_GUARD_POLICY_EVALS_RELATIVE, filename);
  if (!candidates.some((item) => item.path === cwdCandidate)) {
    candidates.push({
      source: "cwd_profile",
      path: cwdCandidate,
    });
  }
  return candidates;
}

function resolvePlanQualityBenchmarkPresetPolicy(args: {
  workDir: string;
}): ResolvedPlanQualityBenchmarkPresetPolicy {
  const profile = resolveBenchmarkPresetProfile(process.env[PLAN_BENCHMARK_PRESET_PROFILE_ENV]);
  const fallbackPolicy = buildDefaultPlanQualityBenchmarkPresetPolicy(profile, args.workDir);
  const candidates = resolvePlanQualityBenchmarkPresetPolicyCandidates(args.workDir, profile);
  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) {
      if (candidate.source === "env_path") {
        return {
          policy: fallbackPolicy,
          source: "invalid_fallback",
          policyPath: candidate.path,
          warning: `benchmark preset policy path not found: ${candidate.path}`,
        };
      }
      continue;
    }
    try {
      const policy = parsePlanQualityBenchmarkPresetPolicy(readFileSync(candidate.path, "utf8"));
      return {
        policy,
        source: candidate.source,
        policyPath: candidate.path,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        policy: fallbackPolicy,
        source: "invalid_fallback",
        policyPath: candidate.path,
        warning: `invalid benchmark preset policy at ${candidate.path}: ${message}`,
      };
    }
  }
  return {
    policy: fallbackPolicy,
    source: "builtin_default",
  };
}

export function resolvePlanQualityBenchmarkPreset(args: {
  workDir: string;
  presetRaw: string;
}): PlanQualityBenchmarkPresetResolution | undefined {
  const presetInput = args.presetRaw.trim().toLowerCase();
  const preset = presetInput === "all" ? "core" : presetInput;
  if (preset !== "generic" && preset !== "core") {
    return undefined;
  }
  const policyRuntime = resolvePlanQualityBenchmarkPresetPolicy({
    workDir: args.workDir,
  });
  const candidates: PlanQualityBenchmarkPresetCandidate[] = [];
  const missingLabels: string[] = [];
  const presetCandidates = preset === "generic"
    ? policyRuntime.policy.presets.generic.candidates
    : policyRuntime.policy.presets.core.candidates;
  for (const item of presetCandidates) {
    let candidatePath = item.path;
    if (item.label === "codex_baseline") {
      const envRaw = process.env[PLAN_BENCHMARK_CODEX_PATH_ENV];
      if (typeof envRaw === "string" && envRaw.trim().length > 0) {
        candidatePath = envRaw.trim();
      }
    } else if (item.label === "claude_baseline") {
      const envRaw = process.env[PLAN_BENCHMARK_CLAUDE_PATH_ENV];
      if (typeof envRaw === "string" && envRaw.trim().length > 0) {
        candidatePath = envRaw.trim();
      }
    } else if (item.label === "generic_agent") {
      const envRaw = process.env[PLAN_BENCHMARK_GENERIC_AGENT_PATH_ENV];
      if (typeof envRaw === "string" && envRaw.trim().length > 0) {
        candidatePath = envRaw.trim();
      }
    }
    const resolvedPath = resolveCandidatePath(args.workDir, candidatePath);
    pushPresetCandidate(candidates, missingLabels, {
      label: item.label,
      path: existsSync(resolvedPath) ? resolvedPath : undefined,
    });
  }
  return {
    preset,
    candidates,
    missingLabels,
    policySource: policyRuntime.source,
    policyPath: policyRuntime.policyPath,
    policyWarning: policyRuntime.warning,
  };
}

function extractDetailToken(
  detail: string,
  key: string,
): string | undefined {
  const pattern = new RegExp(`(?:^|\\s)${key}=([^\\s]+)`);
  const matched = pattern.exec(detail);
  const value = matched?.[1]?.trim();
  if (!value) {
    return undefined;
  }
  return value;
}

function parseDetailBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "yes" || value === "true") {
    return true;
  }
  if (value === "no" || value === "false") {
    return false;
  }
  return undefined;
}

function sessionPlanDir(workDir: string, sessionId: string): string {
  const root = removeTrailingSlashes(workDir);
  const safeSessionId = sanitizeSegment(sessionId, "main", 64);
  return `${root}/.grobot/plans/${safeSessionId}`;
}

function planLockPath(workDir: string, sessionId: string): string {
  return `${sessionPlanDir(workDir, sessionId)}/.plan-artifact.lock`;
}

function sleepBlocking(ms: number): void {
  Atomics.wait(SLEEP_SIGNAL, 0, 0, ms);
}

function lockAgeMs(lockPath: string, nowMs: number): number | undefined {
  try {
    const stats = statSync(lockPath);
    return nowMs - stats.mtimeMs;
  } catch {
    return undefined;
  }
}

function withSessionPlanLock<T>(workDir: string, sessionId: string, task: () => T): T {
  mkdirSync(sessionPlanDir(workDir, sessionId), { recursive: true });
  const lockPath = planLockPath(workDir, sessionId);
  const deadline = Date.now() + PLAN_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      mkdirSync(lockPath, { recursive: false });
      break;
    } catch (error) {
      const errno = error as Error & { code?: string };
      if (errno.code !== "EEXIST") {
        throw error;
      }
      const nowMs = Date.now();
      const age = lockAgeMs(lockPath, nowMs);
      if (typeof age === "number" && age > PLAN_LOCK_STALE_MS) {
        try {
          rmSync(lockPath, { recursive: true, force: true });
        } catch {
          // ignore stale-lock cleanup errors; retry acquisition
        }
      }
      if (nowMs >= deadline) {
        throw new Error(`plan artifact lock timeout: ${lockPath}`);
      }
      sleepBlocking(PLAN_LOCK_WAIT_MS);
    }
  }
  try {
    return task();
  } finally {
    try {
      rmSync(lockPath, { recursive: true, force: true });
    } catch {
      // ignore lock cleanup errors
    }
  }
}

function planIndexPath(workDir: string, sessionId: string): string {
  return `${sessionPlanDir(workDir, sessionId)}/index.json`;
}

function activePlanPath(workDir: string, sessionId: string): string {
  return `${sessionPlanDir(workDir, sessionId)}/ACTIVE.md`;
}

function planEventsPath(workDir: string, sessionId: string): string {
  return `${sessionPlanDir(workDir, sessionId)}/events.jsonl`;
}

function rotatePlanEventsIfNeeded(path: string): void {
  const maxBytes = parsePositiveInt(process.env.GROBOT_PLAN_EVENTS_MAX_BYTES, PLAN_EVENTS_DEFAULT_MAX_BYTES);
  const rotateKeep = Math.max(1, parsePositiveInt(process.env.GROBOT_PLAN_EVENTS_ROTATE_KEEP, PLAN_EVENTS_DEFAULT_ROTATE_KEEP));
  if (!existsSync(path)) {
    return;
  }
  let size = 0;
  try {
    const stats = statSync(path) as unknown as { size?: number };
    size = typeof stats.size === "number" ? stats.size : 0;
  } catch {
    return;
  }
  if (size < maxBytes) {
    return;
  }
  for (let index = rotateKeep - 1; index >= 1; index -= 1) {
    const source = `${path}.${String(index)}`;
    const target = `${path}.${String(index + 1)}`;
    if (!existsSync(source)) {
      continue;
    }
    try {
      renameSync(source, target);
    } catch {
      // ignore best-effort rotation failures
    }
  }
  try {
    renameSync(path, `${path}.1`);
  } catch {
    // ignore rotation failures and continue writing current file
  }
}

function appendPlanEventUnlocked(
  workDir: string,
  sessionId: string,
  event: Omit<PlanArtifactEvent, "at" | "session_id"> & {
    at?: string;
    session_id?: string;
  },
): PlanArtifactEvent {
  const record: PlanArtifactEvent = {
    at: event.at ?? nowIsoUtc(),
    event: event.event,
    session_id: event.session_id ?? sessionId,
    plan_id: event.plan_id,
    source: event.source,
    detail: event.detail,
    status_from: event.status_from,
    status_to: event.status_to,
  };
  const path = planEventsPath(workDir, sessionId);
  const serialized = `${JSON.stringify(record)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  rotatePlanEventsIfNeeded(path);
  const appendWrite = writeFileSync as unknown as (
    path: string,
    data: string,
    options: { encoding: "utf8"; flag: string },
  ) => void;
  appendWrite(path, serialized, { encoding: "utf8", flag: "a" });
  return record;
}

export function loadLatestPlanFailureDiagnostic(
  workDir: string,
  sessionId: string,
  options?: {
    planId?: string;
  },
): PlanLatestFailureDiagnostic | undefined {
  const path = planEventsPath(workDir, sessionId);
  const raw = readText(path);
  if (!raw) {
    return undefined;
  }
  const lines = raw.split(/\r?\n/);
  const targetPlanId = options?.planId?.trim();
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      continue;
    }
    const record = parsed as Record<string, unknown>;
    const event = typeof record.event === "string" ? record.event.trim() : "";
    if (
      event !== "plan_turn_failed"
      && event !== "plan_turn_degraded"
      && event !== "plan_apply_failed"
      && event !== "plan_review_failed"
    ) {
      continue;
    }
    const planId = typeof record.plan_id === "string" ? record.plan_id.trim() : "";
    if (targetPlanId && planId && planId !== targetPlanId) {
      continue;
    }
    const detail = typeof record.detail === "string" ? record.detail.trim() : "";
    const policyActionRaw = extractDetailToken(detail, "policy_action");
    const policyAction = policyActionRaw === "fail" || policyActionRaw === "degrade"
      ? policyActionRaw
      : undefined;
    const exitCode = parseOptionalNonNegativeInt(extractDetailToken(detail, "exit_code"));
    const findingsCount = parseOptionalNonNegativeInt(extractDetailToken(detail, "findings_count"));
    return {
      at: typeof record.at === "string" ? record.at : nowIsoUtc(),
      event,
      planId: planId || undefined,
      detail: detail || undefined,
      exitCode,
      policyAction,
      policyReason: extractDetailToken(detail, "policy_reason"),
      diagnosticCode: extractDetailToken(detail, "diagnostic_code"),
      providerName: extractDetailToken(detail, "provider"),
      errorClass: extractDetailToken(detail, "class") ?? extractDetailToken(detail, "error_class"),
      reviewBlocked: parseDetailBoolean(extractDetailToken(detail, "review_blocked")),
      findingsCount,
    };
  }
  return undefined;
}

function resolveVerificationStatusFromEvent(
  event: "plan_verification_pending" | "plan_verification_passed" | "plan_verification_failed",
  detail: string,
): "pending" | "passed" | "failed" {
  const token = extractDetailToken(detail, "verification_status");
  if (token === "pending" || token === "passed" || token === "failed") {
    return token;
  }
  if (event === "plan_verification_passed") {
    return "passed";
  }
  if (event === "plan_verification_failed") {
    return "failed";
  }
  return "pending";
}

export function loadLatestPlanVerificationDiagnostic(
  workDir: string,
  sessionId: string,
  options?: {
    planId?: string;
  },
): PlanLatestVerificationDiagnostic | undefined {
  const path = planEventsPath(workDir, sessionId);
  const raw = readText(path);
  if (!raw) {
    return undefined;
  }
  const lines = raw.split(/\r?\n/);
  const targetPlanId = options?.planId?.trim();
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      continue;
    }
    const record = parsed as Record<string, unknown>;
    const eventRaw = typeof record.event === "string" ? record.event.trim() : "";
    if (
      eventRaw !== "plan_verification_pending"
      && eventRaw !== "plan_verification_passed"
      && eventRaw !== "plan_verification_failed"
    ) {
      continue;
    }
    const event = eventRaw;
    const planId = typeof record.plan_id === "string" ? record.plan_id.trim() : "";
    if (targetPlanId && planId && planId !== targetPlanId) {
      continue;
    }
    const detail = typeof record.detail === "string" ? record.detail.trim() : "";
    return {
      at: typeof record.at === "string" ? record.at : nowIsoUtc(),
      event,
      planId: planId || undefined,
      detail: detail || undefined,
      status: resolveVerificationStatusFromEvent(event, detail),
    };
  }
  return undefined;
}

function encodeDetailValue(raw: string): string {
  return encodeURIComponent(raw.trim());
}

function decodeDetailValue(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  if (!raw.trim()) {
    return undefined;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseBenchmarkGrade(raw: string | undefined): "A" | "B" | "C" | "D" | "E" | undefined {
  if (raw === "A" || raw === "B" || raw === "C" || raw === "D" || raw === "E") {
    return raw;
  }
  return undefined;
}

function parseAssertPassed(raw: string | undefined): boolean | undefined {
  if (!raw) {
    return undefined;
  }
  if (raw === "yes" || raw === "true" || raw === "1") {
    return true;
  }
  if (raw === "no" || raw === "false" || raw === "0") {
    return false;
  }
  return undefined;
}

function roundRateTo4(value: number): number {
  return Number(value.toFixed(4));
}

function clampPercentageScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 100) {
    return 100;
  }
  return Math.round(value);
}

function parseBenchmarkHistoryRun(record: Record<string, unknown>): PlanQualityBenchmarkHistoryRun | undefined {
  const detail = typeof record.detail === "string" ? record.detail.trim() : "";
  if (!detail) {
    return undefined;
  }
  const comparedCount = parseOptionalNonNegativeInt(extractDetailToken(detail, "compared"));
  const winnerLabel = decodeDetailValue(extractDetailToken(detail, "winner"))?.trim();
  const winnerScore = parseOptionalFiniteNumber(extractDetailToken(detail, "winner_score"));
  const winnerGrade = parseBenchmarkGrade(extractDetailToken(detail, "winner_grade"));
  if (
    typeof comparedCount !== "number"
    || !winnerLabel
    || typeof winnerScore !== "number"
    || !winnerGrade
  ) {
    return undefined;
  }
  const guardModeRaw = extractDetailToken(detail, "guard_mode");
  const guardMode = guardModeRaw === "off" || guardModeRaw === "warn" || guardModeRaw === "strict"
    ? guardModeRaw
    : undefined;
  const winnerTopHint = decodeDetailValue(extractDetailToken(detail, "winner_top_hint"))?.trim();
  const winnerTopRepairAction = decodeDetailValue(extractDetailToken(detail, "winner_top_repair"))?.trim();
  const runnerUpLabel = decodeDetailValue(extractDetailToken(detail, "runner_up"))?.trim();
  const runnerUpScore = parseOptionalFiniteNumber(extractDetailToken(detail, "runner_up_score"));
  const winnerLeadScore = parseOptionalFiniteNumber(extractDetailToken(detail, "winner_lead_score"));
  const planId = typeof record.plan_id === "string" ? record.plan_id.trim() : "";
  return {
    at: typeof record.at === "string" ? record.at : nowIsoUtc(),
    planId: planId || undefined,
    comparedCount,
    winnerLabel,
    winnerScore,
    winnerGrade,
    winnerTopHint: winnerTopHint && winnerTopHint.length > 0 ? winnerTopHint : undefined,
    winnerTopRepairAction: winnerTopRepairAction && winnerTopRepairAction.length > 0
      ? winnerTopRepairAction
      : undefined,
    runnerUpLabel: runnerUpLabel && runnerUpLabel.length > 0 ? runnerUpLabel : undefined,
    runnerUpScore: typeof runnerUpScore === "number" ? runnerUpScore : undefined,
    winnerLeadScore: typeof winnerLeadScore === "number" ? winnerLeadScore : undefined,
    preset: decodeDetailValue(extractDetailToken(detail, "preset")),
    guardMode,
    guardPolicyProfile: decodeDetailValue(extractDetailToken(detail, "guard_profile")),
    assertBest: decodeDetailValue(extractDetailToken(detail, "assert_expected")),
    assertPassed: parseAssertPassed(extractDetailToken(detail, "assert_passed")),
    assertActual: decodeDetailValue(extractDetailToken(detail, "assert_actual")),
  };
}

export function buildPlanQualityBenchmarkEventDetail(
  input: PlanQualityBenchmarkEventDetailInput,
): string {
  const comparedCount = Math.max(0, Math.floor(input.comparedCount));
  const winnerLabel = input.winnerLabel.trim().length > 0
    ? input.winnerLabel.trim()
    : "unknown";
  const tokens = [
    `compared=${String(comparedCount)}`,
    `winner=${encodeDetailValue(winnerLabel)}`,
    `winner_score=${String(input.winnerScore)}`,
    `winner_grade=${input.winnerGrade}`,
  ];
  if (input.guardMode) {
    tokens.push(`guard_mode=${input.guardMode}`);
  }
  const preset = input.preset?.trim();
  if (preset) {
    tokens.push(`preset=${encodeDetailValue(preset)}`);
  }
  const guardPolicyProfile = input.guardPolicyProfile?.trim();
  if (guardPolicyProfile) {
    tokens.push(`guard_profile=${encodeDetailValue(guardPolicyProfile)}`);
  }
  const winnerTopHint = input.winnerTopHint?.trim();
  if (winnerTopHint) {
    tokens.push(`winner_top_hint=${encodeDetailValue(winnerTopHint)}`);
  }
  const winnerTopRepairAction = input.winnerTopRepairAction?.trim();
  if (winnerTopRepairAction) {
    tokens.push(`winner_top_repair=${encodeDetailValue(winnerTopRepairAction)}`);
  }
  const runnerUpLabel = input.runnerUpLabel?.trim();
  if (runnerUpLabel) {
    tokens.push(`runner_up=${encodeDetailValue(runnerUpLabel)}`);
  }
  if (typeof input.runnerUpScore === "number" && Number.isFinite(input.runnerUpScore)) {
    tokens.push(`runner_up_score=${String(input.runnerUpScore)}`);
  }
  if (typeof input.winnerLeadScore === "number" && Number.isFinite(input.winnerLeadScore)) {
    tokens.push(`winner_lead_score=${String(input.winnerLeadScore)}`);
  }
  const assertBest = input.assertBest?.trim();
  if (assertBest) {
    tokens.push(`assert_expected=${encodeDetailValue(assertBest)}`);
  }
  if (typeof input.assertPassed === "boolean") {
    tokens.push(`assert_passed=${input.assertPassed ? "yes" : "no"}`);
  }
  const assertActual = input.assertActual?.trim();
  if (assertActual) {
    tokens.push(`assert_actual=${encodeDetailValue(assertActual)}`);
  }
  return tokens.join(" ");
}

function buildWinnerReasonToken(run: PlanQualityBenchmarkHistoryRun): string {
  const label = run.winnerLabel;
  const reason = run.winnerTopHint ?? run.winnerTopRepairAction ?? "";
  if (!reason) {
    return label;
  }
  return `${label}:${compactSingleLine(reason, 40)}`;
}

function resolveBenchmarkWinnerTopHint(run: PlanQualityBenchmarkHistoryRun | undefined): string | undefined {
  if (!run) {
    return undefined;
  }
  const hint = run.winnerTopHint?.trim();
  if (hint) {
    return hint;
  }
  const repairHint = run.winnerTopRepairAction?.trim();
  if (repairHint) {
    return repairHint;
  }
  return PLAN_BENCHMARK_NO_HINT;
}

export function loadPlanQualityBenchmarkHistory(
  workDir: string,
  sessionId: string,
  options?: {
    limit?: number;
  },
): PlanQualityBenchmarkHistorySummary {
  const limit = typeof options?.limit === "number" && options.limit > 0
    ? Math.floor(options.limit)
    : 5;
  const path = planEventsPath(workDir, sessionId);
  const raw = readText(path);
  if (!raw) {
    return {
      totalRuns: 0,
      recentRuns: [],
      winnerSequence: [],
      winnerReasonSequence: [],
      winnerSwitchCount: 0,
      scoreTrend: "none",
      assertCount: 0,
      assertPassCount: 0,
      assertFailCount: 0,
    };
  }
  const lines = raw.split(/\r?\n/);
  const runs: PlanQualityBenchmarkHistoryRun[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      continue;
    }
    const record = parsed as Record<string, unknown>;
    const event = typeof record.event === "string" ? record.event.trim() : "";
    if (event !== "plan_benchmark_run") {
      continue;
    }
    const run = parseBenchmarkHistoryRun(record);
    if (run) {
      runs.push(run);
    }
  }
  if (runs.length === 0) {
    return {
      totalRuns: 0,
      recentRuns: [],
      winnerSequence: [],
      winnerReasonSequence: [],
      winnerSwitchCount: 0,
      scoreTrend: "none",
      assertCount: 0,
      assertPassCount: 0,
      assertFailCount: 0,
    };
  }
  const latest = runs[0];
  const previous = runs[1];
  let scoreTrend: "up" | "down" | "flat" | "none" = "none";
  let deltaFromPrevious: number | undefined;
  let winnerChangedFromPrevious: boolean | undefined;
  if (latest && previous) {
    deltaFromPrevious = latest.winnerScore - previous.winnerScore;
    if (deltaFromPrevious >= 1) {
      scoreTrend = "up";
    } else if (deltaFromPrevious <= -1) {
      scoreTrend = "down";
    } else {
      scoreTrend = "flat";
    }
    winnerChangedFromPrevious = latest.winnerLabel !== previous.winnerLabel;
  }
  let assertCount = 0;
  let assertPassCount = 0;
  let assertFailCount = 0;
  let winnerSwitchCount = 0;
  for (let index = 0; index < runs.length - 1; index += 1) {
    const current = runs[index];
    const next = runs[index + 1];
    if (!current || !next) {
      continue;
    }
    if (current.winnerLabel !== next.winnerLabel) {
      winnerSwitchCount += 1;
    }
  }
  for (const run of runs) {
    if (!run.assertBest) {
      continue;
    }
    assertCount += 1;
    if (run.assertPassed === true) {
      assertPassCount += 1;
    } else if (run.assertPassed === false) {
      assertFailCount += 1;
    }
  }
  return {
    totalRuns: runs.length,
    recentRuns: runs.slice(0, limit),
    latestWinnerLabel: latest.winnerLabel,
    latestWinnerScore: latest.winnerScore,
    latestWinnerGrade: latest.winnerGrade,
    latestWinnerTopHint: resolveBenchmarkWinnerTopHint(latest),
    latestWinnerTopRepairAction: latest.winnerTopRepairAction,
    latestWinnerLeadScore: latest.winnerLeadScore,
    latestRunAt: latest.at,
    winnerChangedFromPrevious,
    winnerSequence: runs.slice(0, limit).map((run) => run.winnerLabel),
    winnerReasonSequence: runs.slice(0, limit).map((run) => buildWinnerReasonToken(run)),
    winnerSwitchCount,
    scoreTrend,
    deltaFromPrevious,
    assertCount,
    assertPassCount,
    assertFailCount,
    assertPassRate: assertCount > 0 ? roundRateTo4(assertPassCount / assertCount) : undefined,
  };
}

function hasSemanticFailureSignal(latestFailure: PlanLatestFailureDiagnostic | undefined): boolean {
  if (!latestFailure) {
    return false;
  }
  if (typeof latestFailure.diagnosticCode === "string" && latestFailure.diagnosticCode.startsWith("PLAN_SEMANTIC_")) {
    return true;
  }
  if (typeof latestFailure.errorClass === "string" && latestFailure.errorClass.startsWith("semantic_")) {
    return true;
  }
  if (typeof latestFailure.policyReason === "string" && latestFailure.policyReason.includes("semantic")) {
    return true;
  }
  return false;
}

export function evaluatePlanQualityBenchmarkSemanticCorrelation(args: {
  latestFailure?: PlanLatestFailureDiagnostic;
  history: PlanQualityBenchmarkHistorySummary;
}): PlanQualityBenchmarkSemanticCorrelation {
  const semanticSignal = hasSemanticFailureSignal(args.latestFailure);
  if (!semanticSignal) {
    return {
      level: "none",
      reason: "no_semantic_failure_signal",
    };
  }
  const trend = args.history.scoreTrend;
  const switched = Boolean(args.history.winnerChangedFromPrevious)
    || args.history.winnerSwitchCount >= 1;
  const benchmarkSparse = args.history.totalRuns < 2;
  const tokens = [
    `diagnostic=${args.latestFailure?.diagnosticCode ?? "unknown"}`,
    `trend=${trend}`,
    `winner_switched=${switched ? "yes" : "no"}`,
    `runs=${String(args.history.totalRuns)}`,
  ];
  if (benchmarkSparse) {
    return {
      level: "watch",
      reason: `${tokens.join(" ")} evidence=low`,
    };
  }
  if (trend === "down" || switched) {
    return {
      level: "high",
      reason: `${tokens.join(" ")} evidence=aligned`,
    };
  }
  return {
    level: "watch",
    reason: `${tokens.join(" ")} evidence=partial`,
  };
}

function resolveBenchmarkTrendComponentScore(trend: PlanQualityBenchmarkHistorySummary["scoreTrend"]): number {
  if (trend === "up") {
    return 95;
  }
  if (trend === "flat") {
    return 82;
  }
  if (trend === "down") {
    return 38;
  }
  return 68;
}

function resolveBenchmarkSemanticComponentScore(
  semanticCorrelation: PlanQualityBenchmarkSemanticCorrelation["level"],
): number {
  if (semanticCorrelation === "high") {
    return 35;
  }
  if (semanticCorrelation === "watch") {
    return 70;
  }
  return 100;
}

export function evaluatePlanQualityBenchmarkHealth(args: {
  history: PlanQualityBenchmarkHistorySummary;
  semanticCorrelation: PlanQualityBenchmarkSemanticCorrelation["level"];
}): PlanQualityBenchmarkHealthSummary {
  if (args.history.totalRuns <= 0) {
    return {
      score: 65,
      level: "watch",
      reason: "benchmark_insufficient_runs total_runs=0",
      components: {
        trend: 68,
        stability: 68,
        assertion: 70,
        semantic: resolveBenchmarkSemanticComponentScore(args.semanticCorrelation),
      },
    };
  }
  const trend = resolveBenchmarkTrendComponentScore(args.history.scoreTrend);
  const transitionCount = Math.max(1, args.history.totalRuns - 1);
  const switchRate = args.history.winnerSwitchCount / transitionCount;
  const stability = args.history.totalRuns <= 1
    ? 68
    : clampPercentageScore((1 - switchRate) * 100);
  const assertion = args.history.assertCount <= 0
    ? 70
    : clampPercentageScore(
      (typeof args.history.assertPassRate === "number"
        ? args.history.assertPassRate
        : args.history.assertPassCount / args.history.assertCount) * 100,
    );
  const semantic = resolveBenchmarkSemanticComponentScore(args.semanticCorrelation);
  const score = clampPercentageScore(
    trend * 0.3
      + stability * 0.25
      + assertion * 0.25
      + semantic * 0.2,
  );
  const level: "good" | "watch" | "risk" = score >= 82
    ? "good"
    : score >= 60
      ? "watch"
      : "risk";
  return {
    score,
    level,
    reason: [
      `trend=${args.history.scoreTrend}`,
      `trend_score=${String(trend)}`,
      `stability_score=${String(stability)}`,
      `assertion_score=${String(assertion)}`,
      `semantic_score=${String(semantic)}`,
      `runs=${String(args.history.totalRuns)}`,
      `assert_count=${String(args.history.assertCount)}`,
      `switch_count=${String(args.history.winnerSwitchCount)}`,
    ].join(" "),
    components: {
      trend,
      stability,
      assertion,
      semantic,
    },
  };
}

export function resolvePlanQualityBenchmarkRecommendation(args: {
  history: PlanQualityBenchmarkHistorySummary;
  semanticCorrelation: PlanQualityBenchmarkSemanticCorrelation["level"];
  health: PlanQualityBenchmarkHealthSummary;
}): PlanQualityBenchmarkRecommendation {
  if (args.semanticCorrelation === "high" && args.history.scoreTrend === "down") {
    return {
      action: "检查 benchmark 基线映射（内部诊断）",
      reason: "semantic_correlation=high and benchmark_trend=down; verify baseline path mapping before score assertions",
    };
  }
  if (args.history.totalRuns < 2) {
    return {
      action: "补充 benchmark 基线样本（内部诊断）",
      reason: "benchmark_history_insufficient; run preset benchmark to establish baseline",
    };
  }
  if (args.health.level === "risk") {
    return {
      action: "确认 benchmark 优胜者预期（内部诊断）",
      reason: "benchmark_health=risk; enforce baseline winner and inspect degraded dimensions",
    };
  }
  if (args.health.level === "watch") {
    return {
      action: "复核 benchmark 可读性与策略一致性（内部诊断）",
      reason: "benchmark_health=watch; validate candidate readability and policy alignment before next run",
    };
  }
  if (args.history.assertCount > 0 && args.history.assertPassCount < args.history.assertCount) {
    return {
      action: "收紧 benchmark 断言预期（内部诊断）",
      reason: "benchmark_assert_pass_rate_below_100; tighten expected winner guard",
    };
  }
  return {
    action: "none",
    reason: "benchmark_health_good",
  };
}

export function appendPlanEvent(
  workDir: string,
  sessionId: string,
  event: Omit<PlanArtifactEvent, "at" | "session_id"> & {
    at?: string;
    session_id?: string;
  },
): PlanArtifactEvent {
  return withSessionPlanLock(workDir, sessionId, () =>
    appendPlanEventUnlocked(workDir, sessionId, event));
}

function buildDefaultIndex(sessionId: string): PlanArtifactIndex {
  return {
    version: PLAN_ARTIFACT_INDEX_VERSION,
    session_id: sessionId,
    updated_at: nowIsoUtc(),
    entries: [],
  };
}

function normalizeStatus(raw: unknown): PlanArtifactStatus {
  if (raw === "blocked") {
    return "blocked";
  }
  if (raw === "review_failed") {
    return "review_failed";
  }
  if (raw === "ready") {
    return "ready";
  }
  if (raw === "approved") {
    return "approved";
  }
  if (raw === "applying") {
    return "applying";
  }
  if (raw === "apply_failed") {
    return "apply_failed";
  }
  if (raw === "applied") {
    return "applied";
  }
  if (raw === "discarded") {
    return "discarded";
  }
  return "draft";
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.max(0, Math.floor(value));
  return normalized;
}

function normalizeEntry(raw: Record<string, unknown>): PlanArtifactEntry | undefined {
  const planId = typeof raw.plan_id === "string" ? raw.plan_id.trim() : "";
  const seq = typeof raw.seq === "number" && Number.isFinite(raw.seq) ? Math.max(1, Math.floor(raw.seq)) : 0;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const taskSlug = typeof raw.task_slug === "string" ? raw.task_slug.trim() : "";
  const filename = typeof raw.filename === "string" ? raw.filename.trim() : "";
  if (!planId || seq <= 0 || !title || !taskSlug || !filename) {
    return undefined;
  }
  const createdAt = normalizeOptionalString(raw.created_at) ?? nowIsoUtc();
  const updatedAt = normalizeOptionalString(raw.updated_at) ?? createdAt;
  return {
    plan_id: planId,
    seq,
    title,
    task_slug: taskSlug,
    filename,
    status: normalizeStatus(raw.status),
    created_at: createdAt,
    updated_at: updatedAt,
    reviewed_at: normalizeOptionalString(raw.reviewed_at),
    review_fail_count: normalizeOptionalCount(raw.review_fail_count),
    blocked_count: normalizeOptionalCount(raw.blocked_count),
    apply_started_at: normalizeOptionalString(raw.apply_started_at),
    approved_at: normalizeOptionalString(raw.approved_at),
    approved_hash: normalizeOptionalString(raw.approved_hash),
    approval_ticket_id: normalizeOptionalString(raw.approval_ticket_id),
    approved_snapshot_path: normalizeOptionalString(raw.approved_snapshot_path),
    approved_by: normalizeOptionalString(raw.approved_by),
    apply_failed_at: normalizeOptionalString(raw.apply_failed_at),
    applied_at: normalizeOptionalString(raw.applied_at),
    discarded_at: normalizeOptionalString(raw.discarded_at),
  };
}

function normalizeIndex(raw: Record<string, unknown> | undefined, sessionId: string): PlanArtifactIndex {
  if (!raw) {
    return buildDefaultIndex(sessionId);
  }
  const entriesRaw = Array.isArray(raw.entries) ? raw.entries : [];
  const entries: PlanArtifactEntry[] = [];
  for (const item of entriesRaw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    const normalized = normalizeEntry(item as Record<string, unknown>);
    if (normalized) {
      entries.push(normalized);
    }
  }
  const activePlanIdRaw = typeof raw.active_plan_id === "string" ? raw.active_plan_id.trim() : "";
  const activePlanId = activePlanIdRaw.length > 0 ? activePlanIdRaw : undefined;
  const updatedAt = normalizeOptionalString(raw.updated_at) ?? nowIsoUtc();
  return {
    version: PLAN_ARTIFACT_INDEX_VERSION,
    session_id: sessionId,
    active_plan_id: activePlanId,
    updated_at: updatedAt,
    entries,
  };
}

function writeIndex(workDir: string, sessionId: string, index: PlanArtifactIndex): void {
  const normalized: PlanArtifactIndex = {
    ...index,
    version: PLAN_ARTIFACT_INDEX_VERSION,
    updated_at: nowIsoUtc(),
  };
  writeFileAtomic(planIndexPath(workDir, sessionId), `${JSON.stringify(normalized, undefined, 2)}\n`);
}

function planPathFromEntry(workDir: string, sessionId: string, entry: PlanArtifactEntry): string {
  return `${sessionPlanDir(workDir, sessionId)}/${entry.filename}`;
}

function syncActiveFile(workDir: string, sessionId: string, content: string): void {
  writeFileAtomic(activePlanPath(workDir, sessionId), content);
}

function buildPlanId(): string {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear().toString().padStart(4, "0"),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");
  const random = Math.floor(Math.random() * 65536).toString(16).padStart(4, "0");
  return `p${stamp}-${random}`;
}

function buildApprovalTicketId(): string {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((item) => item.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function nextSeq(index: PlanArtifactIndex): number {
  let maxSeq = 0;
  for (const item of index.entries) {
    if (item.seq > maxSeq) {
      maxSeq = item.seq;
    }
  }
  return maxSeq + 1;
}

function buildPlanMarkdown(args: {
  title: string;
  goal: string;
  sessionId: string;
  planId: string;
  seq: number;
}): string {
  const createdAt = nowIsoUtc();
  const safeGoal = removeDangerousChars(args.goal);
  return [
    `# ${removeDangerousChars(args.title)}`,
    "",
    `- session_id: ${args.sessionId}`,
    `- plan_id: ${args.planId}`,
    `- seq: ${String(args.seq)}`,
    `- status: draft`,
    `- created_at: ${createdAt}`,
    `- updated_at: ${createdAt}`,
    "",
    "## Goal",
    "",
    safeGoal,
    "",
    "## Scope In",
    "",
    "- __REQUIRED__: 具体改动范围（模块/文件）。",
    "",
    "## Scope Out",
    "",
    "- __REQUIRED__: 明确不改动范围。",
    "",
    "## Context Snapshot",
    "",
    "- __REQUIRED__: 当前实现现状、关键约束、依赖。",
    "",
    "## Milestones",
    "",
    "1. [ ] __REQUIRED__: 里程碑名称",
    "   - 完成判据: __REQUIRED__",
    "   - 验证: __REQUIRED__",
    "   - 回退: __REQUIRED__",
    "",
    "## Validation",
    "",
    "- __REQUIRED__: 验证命令与预期结果。",
    "",
    "## Risk & Rollback",
    "",
    "- 风险: __REQUIRED__",
    "- 回退: __REQUIRED__",
    "",
    "## Decision Log",
    "",
    `- ${createdAt} 初始化计划。`,
    "",
    PLAN_PROGRESS_SECTION,
    "",
    `- ${createdAt} 创建计划工件。`,
    "",
  ].join("\n");
}

function stripMarkdownNoise(sectionBody: string): string[] {
  return sectionBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter((line) => line.length > 0);
}

function extractSection(markdown: string, sectionTitle: string): string | undefined {
  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexp = new RegExp(`(^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`);
  const match = regexp.exec(markdown);
  if (!match) {
    return undefined;
  }
  return match[2] ?? "";
}

function findPlaceholder(text: string): string | undefined {
  const placeholders = [
    "__REQUIRED__",
    "待补充",
    "TBD",
    "TODO",
    "请补充",
    "to be filled",
  ];
  for (const token of placeholders) {
    if (text.toLowerCase().includes(token.toLowerCase())) {
      return token;
    }
  }
  return undefined;
}

function hasUnresolvedQuestion(text: string): boolean {
  return (
    /\[ASK\]/i.test(text) ||
    /待确认|待决定/i.test(text) ||
    /\?\?/g.test(text)
  );
}

export function extractLatestProposedPlanBlock(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const blocks: string[] = [];
  let activeBlockLines: string[] | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === PROPOSED_PLAN_OPEN_TAG) {
      activeBlockLines = [];
      continue;
    }
    if (trimmed === PROPOSED_PLAN_CLOSE_TAG) {
      const candidate = activeBlockLines?.join("\n").trim();
      if (candidate) {
        blocks.push(candidate);
      }
      activeBlockLines = undefined;
      continue;
    }
    if (activeBlockLines) {
      activeBlockLines.push(line);
    }
  }
  const unterminatedCandidate = activeBlockLines?.join("\n").trim();
  if (unterminatedCandidate) {
    blocks.push(unterminatedCandidate);
  }
  if (blocks.length === 0) {
    return undefined;
  }
  return blocks[blocks.length - 1];
}

function hasSectionHeading(markdown: string, matcher: RegExp): boolean {
  const lines = markdown.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trimStart().startsWith("##")) {
      continue;
    }
    if (matcher.test(line)) {
      return true;
    }
  }
  return false;
}

function extractSectionByHeadingMatcher(markdown: string, matcher: RegExp): string | undefined {
  const lines = markdown.split(/\r?\n/);
  let collecting = false;
  const bodyLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("##")) {
      if (collecting) {
        break;
      }
      if (matcher.test(trimmed)) {
        collecting = true;
      }
      continue;
    }
    if (collecting) {
      bodyLines.push(line);
    }
  }
  return collecting ? bodyLines.join("\n") : undefined;
}

function hasAllRequiredPlanSections(markdown: string): boolean {
  return REQUIRED_PLAN_SECTIONS.every((sectionName) =>
    typeof extractSection(markdown, sectionName) === "string"
  );
}

function sectionHasListItem(sectionBody: string): boolean {
  return sectionBody
    .split(/\r?\n/)
    .some((line) => /^\s*(?:[-*]|\d+\.)\s+\S/.test(line));
}

function normalizePlanFieldValue(line: string): string {
  const cleaned = line
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .trim();
  const colonIndex = cleaned.search(/[:：]/);
  if (colonIndex >= 0) {
    return cleaned.slice(colonIndex + 1).trim();
  }
  return cleaned;
}

function isVaguePlanFieldValue(valueRaw: string): boolean {
  const value = valueRaw
    .trim()
    .replace(/[。.!！]+$/g, "")
    .trim()
    .toLowerCase();
  if (!value || value.length <= 4) {
    return true;
  }
  return /^(none|n\/a|na|low|minor|unknown|tbd|todo|无|暂无|没有|低|较低|低风险|可控|待定|待补充|按需处理|手动处理|回滚|回退|恢复|revert|rollback)$/.test(value);
}

const VALIDATION_COMMAND_PATTERN =
  /(`[^`]+`|\b(?:npm|pnpm|yarn|bun|cargo|go|pytest|python|node|npx|tsx|deno|make|bash|sh|curl|script|uv|docker|psql|sqlite3|mysql|kubectl)\b|\.\/|\/[A-Za-z0-9._/-]+|手工验证|人工验证|manual verification|manual test|browser check|浏览器验证|截图对比)/i;
const VALIDATION_EXPECTED_RESULT_PATTERN =
  /(预期|expected|expect|通过|passes?|green|成功|should|assert|断言|结果|输出|exit\s*0|exit code\s*0|无报错|不出现)/i;

function hasConcreteValidationSignal(sectionBody: string): boolean {
  return sectionBody
    .split(/\r?\n/)
    .some((line) => VALIDATION_COMMAND_PATTERN.test(line));
}

function hasValidationExpectedResult(sectionBody: string): boolean {
  return VALIDATION_EXPECTED_RESULT_PATTERN.test(sectionBody);
}

function reviewProposedPlanContent(proposedPlanContent: string): PlanReviewResult {
  const findings: PlanReviewFinding[] = [];
  const checkedAt = nowIsoUtc();
  const normalized = proposedPlanContent.trim();
  if (hasAllRequiredPlanSections(normalized)) {
    return reviewStructuredPlanContent(normalized);
  }
  if (!normalized) {
    findings.push({
      code: "proposed_plan_empty",
      section: "proposed_plan",
      message: "提取到的 <proposed_plan> 为空。",
    });
  }
  const placeholder = findPlaceholder(normalized);
  if (placeholder) {
    findings.push({
      code: "placeholder_detected",
      section: "proposed_plan",
      message: `计划仍含占位词(${placeholder})。`,
    });
  }
  if (hasUnresolvedQuestion(normalized)) {
    findings.push({
      code: "unresolved_question",
      section: "proposed_plan",
      message: "计划存在未决问题，需先澄清。",
    });
  }
  if (normalized.length > 0 && normalized.length < 120) {
    findings.push({
      code: "proposed_plan_too_short",
      section: "proposed_plan",
      message: "计划内容过短，无法支撑可执行实现。",
    });
  }
  const hasSummary = hasSectionHeading(normalized, /^##\s*(summary|概要|概述|摘要)\b/i);
  const hasKeyChanges = hasSectionHeading(
    normalized,
    /^##\s*(key changes?|implementation changes?|重要变更|实现变更)\b/i,
  );
  const hasTestPlan = hasSectionHeading(
    normalized,
    /^##\s*(test plan|tests?|test cases?|验证计划|测试计划|测试用例)\b/i,
  );
  const hasAssumptions = hasSectionHeading(
    normalized,
    /^##\s*(assumptions?|默认假设|假设)\b/i,
  );
  if (!hasSummary) {
    findings.push({
      code: "proposed_plan_missing_section",
      section: "Summary",
      message: "缺少 Summary 章节。",
    });
  }
  if (!hasKeyChanges) {
    findings.push({
      code: "proposed_plan_missing_section",
      section: "Key Changes",
      message: "缺少 Key Changes/Implementation Changes 章节。",
    });
  }
  if (!hasTestPlan) {
    findings.push({
      code: "proposed_plan_missing_section",
      section: "Test Plan",
      message: "缺少 Test Plan/Tests 章节。",
    });
  } else {
    const testPlan = extractSectionByHeadingMatcher(
      normalized,
      /^##\s*(test plan|tests?|test cases?|验证计划|测试计划|测试用例)\b/i,
    ) ?? "";
    if (!hasConcreteValidationSignal(testPlan)) {
      findings.push({
        code: "validation_missing_command",
        section: "Test Plan",
        message: "Test Plan 缺少可执行命令或明确的手工验证步骤。",
      });
    }
    if (!hasValidationExpectedResult(testPlan)) {
      findings.push({
        code: "validation_missing_expected_result",
        section: "Test Plan",
        message: "Test Plan 缺少预期结果。",
      });
    }
  }
  if (!hasAssumptions) {
    findings.push({
      code: "proposed_plan_missing_section",
      section: "Assumptions",
      message: "缺少 Assumptions 章节。",
    });
  }
  const blocked = findings.some((item) => item.code === "unresolved_question");
  const ok = findings.length === 0;
  return {
    ok,
    blocked,
    findings,
    checked_at: checkedAt,
  };
}

function reviewStructuredPlanContent(planContent: string): PlanReviewResult {
  const findings: PlanReviewFinding[] = [];
  const checkedAt = nowIsoUtc();
  const sectionMap = new Map<string, string>();

  for (const sectionName of REQUIRED_PLAN_SECTIONS) {
    const body = extractSection(planContent, sectionName);
    if (typeof body !== "string") {
      findings.push({
        code: "missing_section",
        section: sectionName,
        message: `缺少必填章节: ${sectionName}`,
      });
      continue;
    }
    sectionMap.set(sectionName, body);
    const normalizedLines = stripMarkdownNoise(body);
    if (normalizedLines.length === 0) {
      findings.push({
        code: "empty_section",
        section: sectionName,
        message: `章节内容为空: ${sectionName}`,
      });
      continue;
    }
    const placeholder = findPlaceholder(normalizedLines.join("\n"));
    if (placeholder) {
      findings.push({
        code: "placeholder_detected",
        section: sectionName,
        message: `章节仍含占位词(${placeholder}): ${sectionName}`,
      });
    }
    if (hasUnresolvedQuestion(normalizedLines.join("\n"))) {
      findings.push({
        code: "unresolved_question",
        section: sectionName,
        message: `章节存在未决问题，需先澄清: ${sectionName}`,
      });
    }
  }

  const goal = sectionMap.get("Goal");
  if (typeof goal === "string") {
    const goalText = stripMarkdownNoise(goal).join(" ");
    if (goalText.length > 0 && goalText.length < 16) {
      findings.push({
        code: "goal_too_vague",
        section: "Goal",
        message: "Goal 过短，缺少可判断的目标行为变化。",
      });
    }
  }

  for (const sectionName of ["Scope In", "Scope Out"] as const) {
    const sectionBody = sectionMap.get(sectionName);
    if (typeof sectionBody === "string" && !sectionHasListItem(sectionBody)) {
      findings.push({
        code: sectionName === "Scope In" ? "scope_in_missing_items" : "scope_out_missing_items",
        section: sectionName,
        message: `${sectionName} 至少需要 1 条明确列表项。`,
      });
    }
  }

  const milestones = sectionMap.get("Milestones");
  if (typeof milestones === "string") {
    const milestoneLines = milestones.split("\n").filter((line) => /^\s*\d+\.\s+/.test(line));
    if (milestoneLines.length === 0) {
      findings.push({
        code: "milestones_missing_items",
        section: "Milestones",
        message: "Milestones 至少需要 1 条编号里程碑。",
      });
    }
    if (!/完成判据/.test(milestones)) {
      findings.push({
        code: "milestones_missing_done_criteria",
        section: "Milestones",
        message: "Milestones 缺少“完成判据”。",
      });
    }
    if (!/验证/.test(milestones)) {
      findings.push({
        code: "milestones_missing_validation",
        section: "Milestones",
        message: "Milestones 缺少“验证”。",
      });
    }
    if (!/回退/.test(milestones)) {
      findings.push({
        code: "milestones_missing_rollback",
        section: "Milestones",
        message: "Milestones 缺少“回退”。",
      });
    }
  }

  const validation = sectionMap.get("Validation");
  if (typeof validation === "string") {
    const hasValidationItems = validation
      .split("\n")
      .some((line) => /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line));
    if (!hasValidationItems) {
      findings.push({
        code: "validation_missing_items",
        section: "Validation",
        message: "Validation 至少需要 1 条可执行验证项。",
      });
    }
    if (hasValidationItems && !hasConcreteValidationSignal(validation)) {
      findings.push({
        code: "validation_missing_command",
        section: "Validation",
        message: "Validation 缺少真实命令或明确的手工验证步骤。",
      });
    }
    if (hasValidationItems && !hasValidationExpectedResult(validation)) {
      findings.push({
        code: "validation_missing_expected_result",
        section: "Validation",
        message: "Validation 缺少预期结果。",
      });
    }
  }

  const riskRollback = sectionMap.get("Risk & Rollback");
  if (typeof riskRollback === "string") {
    const normalizedLines = stripMarkdownNoise(riskRollback);
    const riskLines = normalizedLines.filter((line) => /^(风险|risk)\s*[:：]/i.test(line));
    const rollbackLines = normalizedLines.filter((line) =>
      /^(回退|rollback|roll back|revert|restore)\s*[:：]/i.test(line)
    );
    if (riskLines.length === 0) {
      findings.push({
        code: "risk_missing_item",
        section: "Risk & Rollback",
        message: "Risk & Rollback 缺少明确“风险:”条目。",
      });
    } else if (riskLines.some((line) => isVaguePlanFieldValue(normalizePlanFieldValue(line)))) {
      findings.push({
        code: "risk_too_vague",
        section: "Risk & Rollback",
        message: "风险描述过于空泛，需要写出具体失败面。",
      });
    }
    if (rollbackLines.length === 0) {
      findings.push({
        code: "rollback_missing_item",
        section: "Risk & Rollback",
        message: "Risk & Rollback 缺少明确“回退:”条目。",
      });
    } else if (rollbackLines.some((line) => isVaguePlanFieldValue(normalizePlanFieldValue(line)))) {
      findings.push({
        code: "rollback_too_vague",
        section: "Risk & Rollback",
        message: "回退描述过于空泛，需要写出可执行恢复动作。",
      });
    }
  }

  const blocked = findings.some((item) => item.code === "unresolved_question");
  const ok = findings.length === 0;
  return {
    ok,
    blocked,
    findings,
    checked_at: checkedAt,
  };
}

export function reviewPlanContent(planContent: string): PlanReviewResult {
  const proposedPlan = extractLatestProposedPlanBlock(planContent);
  if (proposedPlan) {
    return reviewProposedPlanContent(proposedPlan);
  }
  return reviewStructuredPlanContent(planContent);
}

function scorePenaltyForFindingCode(code: string): number {
  switch (code) {
    case "proposed_plan_empty":
      return 40;
    case "unresolved_question":
      return 35;
    case "missing_section":
    case "proposed_plan_missing_section":
      return 20;
    case "placeholder_detected":
      return 18;
    case "empty_section":
      return 15;
    case "proposed_plan_too_short":
      return 12;
    case "milestones_missing_items":
    case "milestones_missing_done_criteria":
    case "milestones_missing_validation":
    case "milestones_missing_rollback":
    case "validation_missing_items":
    case "validation_missing_command":
    case "validation_missing_expected_result":
    case "risk_missing_item":
    case "rollback_missing_item":
      return 10;
    case "goal_too_vague":
    case "scope_in_missing_items":
    case "scope_out_missing_items":
    case "risk_too_vague":
    case "rollback_too_vague":
      return 8;
    default:
      return 8;
  }
}

function toPlanQualityGrade(score: number): "A" | "B" | "C" | "D" | "E" {
  if (score >= 90) {
    return "A";
  }
  if (score >= 80) {
    return "B";
  }
  if (score >= 65) {
    return "C";
  }
  if (score >= 50) {
    return "D";
  }
  return "E";
}

function rewriteHintForFinding(finding: PlanReviewFinding): string | undefined {
  switch (finding.code) {
    case "missing_section":
    case "proposed_plan_missing_section":
      return `补齐章节 ${finding.section ?? "global"}，并写明可执行条目`;
    case "placeholder_detected":
      return `移除占位词并补齐 ${finding.section ?? "global"} 的具体实现内容`;
    case "unresolved_question":
      return `先澄清未决问题，再重新评审 ${finding.section ?? "global"}`;
    case "milestones_missing_done_criteria":
      return "每个里程碑增加“完成判据”";
    case "milestones_missing_validation":
      return "每个里程碑增加“验证”步骤与命令";
    case "milestones_missing_rollback":
      return "每个里程碑增加“回退”预案";
    case "validation_missing_items":
      return "Validation 至少补 1 条可执行命令与预期结果";
    case "validation_missing_command":
      return "Validation 补真实命令，或写明手工验证步骤";
    case "validation_missing_expected_result":
      return "Validation 补每条验证的预期结果";
    case "risk_missing_item":
    case "risk_too_vague":
      return "Risk & Rollback 写具体风险，而不是“低/无/可控”";
    case "rollback_missing_item":
    case "rollback_too_vague":
      return "Risk & Rollback 写可执行回退动作";
    case "goal_too_vague":
      return "Goal 写清楚目标行为变化和完成状态";
    case "scope_in_missing_items":
    case "scope_out_missing_items":
      return `补齐 ${finding.section ?? "Scope"} 的明确列表项`;
    case "proposed_plan_too_short":
      return "补充关键改动、验证计划和风险回退，避免过短计划";
    default:
      return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePolicyInt(
  raw: unknown,
  fieldName: string,
  options: {
    min: number;
    max: number;
  },
): number {
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new Error(`policy field ${fieldName} must be int`);
  }
  if (raw < options.min || raw > options.max) {
    throw new Error(`policy field ${fieldName} must be within [${String(options.min)}, ${String(options.max)}]`);
  }
  return raw;
}

function parsePolicyBoolean(raw: unknown, fieldName: string): boolean {
  if (typeof raw !== "boolean") {
    throw new Error(`policy field ${fieldName} must be boolean`);
  }
  return raw;
}

function parsePolicyMode(raw: unknown, fieldName: string): PlanQualityGuardMode {
  if (typeof raw !== "string") {
    throw new Error(`policy field ${fieldName} must be string`);
  }
  const mode = resolvePlanQualityGuardMode(raw, "warn");
  if (mode === "warn" && raw.trim().toLowerCase() !== "warn") {
    throw new Error(`policy field ${fieldName} must be off|warn|strict`);
  }
  return mode;
}

function cloneDefaultPlanQualityGuardPolicy(profile: string): PlanQualityGuardPolicy {
  return {
    ...DEFAULT_PLAN_QUALITY_GUARD_POLICY,
    profile,
    defaults: {
      ...DEFAULT_PLAN_QUALITY_GUARD_POLICY.defaults,
    },
    thresholds: {
      ...DEFAULT_PLAN_QUALITY_GUARD_POLICY.thresholds,
    },
  };
}

function resolvePolicyProfile(raw: string | undefined): string {
  const fallback = PLAN_QUALITY_GUARD_DEFAULT_PROFILE;
  if (typeof raw !== "string") {
    return fallback;
  }
  const normalized = sanitizeSegment(raw, fallback, 32);
  return normalized.length > 0 ? normalized : fallback;
}

function parsePlanQualityGuardPolicy(raw: string): PlanQualityGuardPolicy {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error("policy root must be object");
  }
  if (parsed.schema !== PLAN_QUALITY_GUARD_POLICY_SCHEMA) {
    throw new Error(`policy schema must be ${PLAN_QUALITY_GUARD_POLICY_SCHEMA}`);
  }
  if (parsed.schema_version !== PLAN_QUALITY_GUARD_POLICY_VERSION) {
    throw new Error(`policy schema_version must be ${String(PLAN_QUALITY_GUARD_POLICY_VERSION)}`);
  }
  if (typeof parsed.profile !== "string" || parsed.profile.trim().length === 0) {
    throw new Error("policy field profile must be non-empty string");
  }
  const defaultsRaw = parsed.defaults;
  if (!isRecord(defaultsRaw)) {
    throw new Error("policy field defaults must be object");
  }
  const thresholdsRaw = parsed.thresholds;
  if (!isRecord(thresholdsRaw)) {
    throw new Error("policy field thresholds must be object");
  }
  const criticalScore = parsePolicyInt(thresholdsRaw.critical_score, "thresholds.critical_score", {
    min: 0,
    max: 100,
  });
  const watchScore = parsePolicyInt(thresholdsRaw.watch_score, "thresholds.watch_score", {
    min: 0,
    max: 100,
  });
  if (watchScore < criticalScore) {
    throw new Error("policy thresholds.watch_score must be >= thresholds.critical_score");
  }
  return {
    schema: PLAN_QUALITY_GUARD_POLICY_SCHEMA,
    schema_version: PLAN_QUALITY_GUARD_POLICY_VERSION,
    profile: sanitizeSegment(parsed.profile, PLAN_QUALITY_GUARD_DEFAULT_PROFILE, 32),
    defaults: {
      mode: parsePolicyMode(defaultsRaw.mode, "defaults.mode"),
    },
    thresholds: {
      critical_score: criticalScore,
      watch_score: watchScore,
      severe_drop_delta: parsePolicyInt(thresholdsRaw.severe_drop_delta, "thresholds.severe_drop_delta", {
        min: 1,
        max: 100,
      }),
      critical_regression_streak: parsePolicyInt(
        thresholdsRaw.critical_regression_streak,
        "thresholds.critical_regression_streak",
        {
          min: 1,
          max: 10,
        },
      ),
      watch_on_trend_down: parsePolicyBoolean(thresholdsRaw.watch_on_trend_down, "thresholds.watch_on_trend_down"),
    },
  };
}

function resolvePlanQualityGuardPolicyCandidates(
  workDir: string,
  profile: string,
): { source: PlanQualityGuardPolicySource; path: string }[] {
  const filename = `${PLAN_QUALITY_GUARD_POLICY_FILE_PREFIX}${profile}${PLAN_QUALITY_GUARD_POLICY_FILE_SUFFIX}`;
  const candidates: { source: PlanQualityGuardPolicySource; path: string }[] = [];
  const envPathRaw = process.env[PLAN_QUALITY_GUARD_POLICY_PATH_ENV];
  if (typeof envPathRaw === "string" && envPathRaw.trim().length > 0) {
    candidates.push({
      source: "env_path",
      path: resolvePath(envPathRaw.trim()),
    });
  }
  candidates.push({
    source: "workdir_profile",
    path: resolvePath(workDir, PLAN_QUALITY_GUARD_POLICY_EVALS_RELATIVE, filename),
  });
  const cwdCandidate = resolvePath(process.cwd(), PLAN_QUALITY_GUARD_POLICY_EVALS_RELATIVE, filename);
  if (!candidates.some((item) => item.path === cwdCandidate)) {
    candidates.push({
      source: "cwd_profile",
      path: cwdCandidate,
    });
  }
  return candidates;
}

export function resolvePlanQualityGuardPolicy(args: {
  workDir: string;
}): ResolvedPlanQualityGuardPolicy {
  const profile = resolvePolicyProfile(process.env[PLAN_QUALITY_GUARD_POLICY_PROFILE_ENV]);
  const fallbackPolicy = cloneDefaultPlanQualityGuardPolicy(profile);
  const candidates = resolvePlanQualityGuardPolicyCandidates(args.workDir, profile);
  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) {
      if (candidate.source === "env_path") {
        return {
          policy: fallbackPolicy,
          source: "invalid_fallback",
          policyPath: candidate.path,
          warning: `policy override path not found: ${candidate.path}`,
        };
      }
      continue;
    }
    try {
      const parsed = parsePlanQualityGuardPolicy(readFileSync(candidate.path, "utf8"));
      return {
        policy: parsed,
        source: candidate.source,
        policyPath: candidate.path,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        policy: fallbackPolicy,
        source: "invalid_fallback",
        policyPath: candidate.path,
        warning: `invalid policy at ${candidate.path}: ${message}`,
      };
    }
  }
  return {
    policy: fallbackPolicy,
    source: "builtin_default",
  };
}

export function evaluatePlanQuality(planContent: string): PlanQualitySummary {
  const review = reviewPlanContent(planContent);
  const penalty = review.findings.reduce((total, finding) => total + scorePenaltyForFindingCode(finding.code), 0);
  const score = Math.max(0, 100 - Math.min(95, penalty));
  const grade = toPlanQualityGrade(score);
  const rewriteHints = review.findings
    .map((item) => rewriteHintForFinding(item))
    .filter((item): item is string => typeof item === "string")
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 4);
  const recommendation = review.ok
    ? "质量达标，可进入审批或执行阶段"
    : review.blocked
      ? "存在阻断项，先澄清未决问题再继续"
      : "建议先修复高优先级 findings，再重新评审";
  return {
    score,
    grade,
    findingCount: review.findings.length,
    blocked: review.blocked,
    recommendation,
    rewriteHints,
  };
}

function priorityRank(priority: PlanQualityRepairAction["priority"]): number {
  if (priority === "p0") {
    return 0;
  }
  if (priority === "p1") {
    return 1;
  }
  return 2;
}

function compactRepairActions(actions: PlanQualityRepairAction[]): PlanQualityRepairAction[] {
  const deduped = new Map<string, PlanQualityRepairAction>();
  for (const action of actions) {
    if (!deduped.has(action.id)) {
      deduped.set(action.id, action);
    }
  }
  return [...deduped.values()]
    .sort((left, right) => {
      const priorityDelta = priorityRank(left.priority) - priorityRank(right.priority);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return left.title.localeCompare(right.title);
    })
    .slice(0, 6);
}

function summarizeMissingSections(findings: readonly PlanReviewFinding[]): string[] {
  const sections: string[] = [];
  for (const finding of findings) {
    if (
      finding.code !== "missing_section"
      && finding.code !== "proposed_plan_missing_section"
      && finding.code !== "empty_section"
    ) {
      continue;
    }
    const section = finding.section?.trim();
    if (!section) {
      continue;
    }
    if (!sections.includes(section)) {
      sections.push(section);
    }
  }
  return sections;
}

function hasAnyFindingCode(findings: readonly PlanReviewFinding[], codes: readonly string[]): boolean {
  return findings.some((item) => codes.includes(item.code));
}

function resolveMilestoneRepairHint(findings: readonly PlanReviewFinding[]): string {
  const parts: string[] = [];
  if (hasAnyFindingCode(findings, ["milestones_missing_items"])) {
    parts.push("补里程碑条目");
  }
  if (hasAnyFindingCode(findings, ["milestones_missing_done_criteria"])) {
    parts.push("补完成判据");
  }
  if (hasAnyFindingCode(findings, ["milestones_missing_validation"])) {
    parts.push("补验证步骤");
  }
  if (hasAnyFindingCode(findings, ["milestones_missing_rollback"])) {
    parts.push("补回退预案");
  }
  return parts.join(" + ");
}

export function buildPlanQualityRepairActions(args: {
  planContent: string;
  quality: PlanQualitySummary;
  trend: PlanQualityTrendSummary;
  guard: PlanQualityGuardSummary;
}): PlanQualityRepairAction[] {
  const review = reviewPlanContent(args.planContent);
  const actions: PlanQualityRepairAction[] = [];
  const missingSections = summarizeMissingSections(review.findings);
  if (missingSections.length > 0) {
    const sections = missingSections.join("、");
    actions.push({
      id: "repair_sections",
      priority: "p0",
      title: `补齐关键章节（${sections}）`,
      command: `直接补充当前计划：补齐 ${sections}，并给出可执行条目`,
      rationale: "缺失或空章节会显著拉低质量分，并导致审批风险升高",
    });
  }
  if (hasAnyFindingCode(review.findings, ["unresolved_question"])) {
    actions.push({
      id: "resolve_unresolved_questions",
      priority: "p0",
      title: "先消除未决问题再推进",
      command: "直接补充当前计划：先明确未决问题答案，再回写 Goal / Scope / Risk",
      rationale: "未决问题属于阻断类风险，未澄清不应进入审批/执行",
    });
  }
  if (hasAnyFindingCode(review.findings, ["placeholder_detected"])) {
    actions.push({
      id: "remove_placeholders",
      priority: "p1",
      title: "移除占位词并替换为真实步骤",
      command: "直接补充当前计划：移除 __REQUIRED__ / TODO，并写具体实现与验收",
      rationale: "占位文本会触发质量扣分并削弱计划可执行性",
    });
  }
  if (hasAnyFindingCode(review.findings, ["scope_in_missing_items", "scope_out_missing_items", "goal_too_vague"])) {
    actions.push({
      id: "repair_goal_scope",
      priority: "p1",
      title: "补清目标与范围边界",
      command: "直接补充当前计划：把 Goal 写成可判断的行为变化，并为 Scope In/Out 各列具体条目",
      rationale: "目标与范围不清会让执行阶段自行猜边界",
    });
  }
  const milestoneRepairHint = resolveMilestoneRepairHint(review.findings);
  if (milestoneRepairHint.length > 0) {
    actions.push({
      id: "repair_milestones",
      priority: "p1",
      title: "修复里程碑结构完整性",
      command: `直接补充当前计划：为每个里程碑补“完成判据 + 验证 + 回退”；当前缺口：${milestoneRepairHint}`,
      rationale: "里程碑缺少完成判据/验证/回退会直接降低执行可靠性",
    });
  }
  if (hasAnyFindingCode(review.findings, [
    "validation_missing_items",
    "validation_missing_command",
    "validation_missing_expected_result",
  ])) {
    actions.push({
      id: "repair_validation",
      priority: "p1",
      title: "补齐 Validation 可执行命令与预期结果",
      command: "直接补充当前计划：增加真实验证命令或手工验证步骤，并写明每条预期结果",
      rationale: "缺少可执行验证与预期结果时，计划无法形成闭环验收",
    });
  }
  if (hasAnyFindingCode(review.findings, [
    "risk_missing_item",
    "risk_too_vague",
    "rollback_missing_item",
    "rollback_too_vague",
  ])) {
    actions.push({
      id: "repair_risk_rollback",
      priority: "p1",
      title: "补具体风险与回退动作",
      command: "直接补充当前计划：把 Risk & Rollback 改成“风险: 具体失败面 / 回退: 可执行恢复动作”",
      rationale: "空泛风险会让审批看起来通过，但 apply 阶段缺少可恢复路径",
    });
  }
  if (hasAnyFindingCode(review.findings, ["proposed_plan_too_short", "proposed_plan_empty"])) {
    actions.push({
      id: "expand_plan_detail",
      priority: "p2",
      title: "扩充计划细节深度",
      command: "直接补充当前计划：补关键改动、验证矩阵、风险与回退边界",
      rationale: "过短计划通常缺少可执行细节，容易在 apply 阶段失败",
    });
  }
  if (actions.length === 0 && args.guard.level !== "healthy") {
    actions.push({
      id: "guard_watch_reinforce",
      priority: args.guard.level === "critical" ? "p0" : "p1",
      title: "针对 guard 风险做定向加固",
      command: "直接补充当前计划：补充本轮降分原因与改进动作，再重新评审",
      rationale: `当前 guard=${args.guard.level}，建议先提升计划稳定性`,
    });
  }
  if (actions.length === 0 && args.trend.trend === "down") {
    actions.push({
      id: "trend_down_recover",
      priority: "p2",
      title: "回补较上轮退化的细节",
      command: "直接补充当前计划：对比上轮计划，补齐被删减的验证与回退项",
      rationale: "质量趋势下滑时应先恢复关键细节，再推进审批",
    });
  }
  if (actions.length === 0 && args.quality.score < 80) {
    actions.push({
      id: "raise_quality_baseline",
      priority: "p2",
      title: "提高计划质量基线",
      command: "直接补充当前计划：补依赖边界、执行步骤与回归验证",
      rationale: "当前质量分仍有提升空间，建议先优化后审批",
    });
  }
  return compactRepairActions(actions);
}

function benchmarkGuardLevelRank(level: "healthy" | "watch" | "critical"): number {
  if (level === "healthy") {
    return 0;
  }
  if (level === "watch") {
    return 1;
  }
  return 2;
}

export function evaluatePlanQualityBenchmark(args: {
  workDir: string;
  sessionId: string;
  candidates: readonly PlanQualityBenchmarkCandidate[];
  policy?: PlanQualityGuardPolicy;
}): PlanQualityBenchmarkResult {
  if (args.candidates.length === 0) {
    throw new Error("benchmark requires at least one candidate");
  }
  const policy = args.policy ?? DEFAULT_PLAN_QUALITY_GUARD_POLICY;
  const rows = args.candidates.map((candidate) => {
    const quality = evaluatePlanQuality(candidate.content);
    const trend: PlanQualityTrendSummary = {
      trend: "none",
    };
    const guard = evaluatePlanQualityGuard({
      workDir: args.workDir,
      sessionId: args.sessionId,
      currentPlanId: `benchmark:${candidate.label}`,
      quality,
      trend,
      policy,
      historyScope: "none",
    });
    const repairActions = buildPlanQualityRepairActions({
      planContent: candidate.content,
      quality,
      trend,
      guard,
    });
    return {
      rank: 0,
      label: candidate.label,
      sourcePath: candidate.sourcePath,
      score: quality.score,
      grade: quality.grade,
      findingCount: quality.findingCount,
      blocked: quality.blocked,
      guardLevel: guard.level,
      guardReason: guard.reason,
      repairActionCount: repairActions.length,
      topHint: quality.rewriteHints[0] ?? "",
      topRepairAction: repairActions[0]?.title ?? "",
    } satisfies PlanQualityBenchmarkRow;
  });
  const sorted = [...rows].sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }
    const guardDelta = benchmarkGuardLevelRank(left.guardLevel) - benchmarkGuardLevelRank(right.guardLevel);
    if (guardDelta !== 0) {
      return guardDelta;
    }
    if (left.findingCount !== right.findingCount) {
      return left.findingCount - right.findingCount;
    }
    return left.label.localeCompare(right.label);
  });
  const ranked = sorted.map((row, index) => ({
    ...row,
    rank: index + 1,
  }));
  return {
    rows: ranked,
    winner: ranked[0],
  };
}

export function evaluatePlanQualityTrend(args: {
  workDir: string;
  sessionId: string;
  currentPlanId: string;
  currentScore: number;
}): PlanQualityTrendSummary {
  const index = loadPlanArtifactIndex(args.workDir, args.sessionId);
  const sorted = [...index.entries].sort((left, right) => {
    if (left.seq !== right.seq) {
      return right.seq - left.seq;
    }
    return right.updated_at.localeCompare(left.updated_at);
  });
  for (const entry of sorted) {
    if (entry.plan_id === args.currentPlanId) {
      continue;
    }
    const content = readText(planPathFromEntry(args.workDir, args.sessionId, entry));
    if (typeof content !== "string" || content.trim().length === 0) {
      continue;
    }
    const previousQuality = evaluatePlanQuality(content);
    const delta = args.currentScore - previousQuality.score;
    const trend = delta >= 5
      ? "up"
      : delta <= -5
        ? "down"
        : "flat";
    return {
      trend,
      previousPlanId: entry.plan_id,
      previousScore: previousQuality.score,
      deltaFromPrevious: delta,
    };
  }
  return {
    trend: "none",
  };
}

export function evaluatePlanQualityGuard(args: {
  workDir: string;
  sessionId: string;
  currentPlanId: string;
  quality: PlanQualitySummary;
  trend: PlanQualityTrendSummary;
  policy?: PlanQualityGuardPolicy;
  historyScope?: "session_window" | "none";
}): PlanQualityGuardSummary {
  const policy = args.policy ?? DEFAULT_PLAN_QUALITY_GUARD_POLICY;
  const scoreSeries: number[] = [args.quality.score];
  if (args.historyScope !== "none") {
    const index = loadPlanArtifactIndex(args.workDir, args.sessionId);
    const sorted = [...index.entries].sort((left, right) => {
      if (left.seq !== right.seq) {
        return right.seq - left.seq;
      }
      return right.updated_at.localeCompare(left.updated_at);
    });
    for (const entry of sorted) {
      if (entry.plan_id === args.currentPlanId) {
        continue;
      }
      const content = readText(planPathFromEntry(args.workDir, args.sessionId, entry));
      if (typeof content !== "string" || content.trim().length === 0) {
        continue;
      }
      scoreSeries.push(evaluatePlanQuality(content).score);
      if (scoreSeries.length >= 6) {
        break;
      }
    }
  }
  let regressionStreak = 0;
  for (let indexScore = 0; indexScore < scoreSeries.length - 1; indexScore += 1) {
    const delta = scoreSeries[indexScore] - scoreSeries[indexScore + 1];
    if (delta <= -5) {
      regressionStreak += 1;
      continue;
    }
    break;
  }
  const delta = args.trend.deltaFromPrevious;
  const severeDrop = typeof delta === "number" && delta <= (-1 * policy.thresholds.severe_drop_delta);
  if (args.quality.blocked) {
    return {
      level: "critical",
      regressionStreak,
      reason: "存在阻断项，需先解除阻断再审批/执行",
    };
  }
  if (args.quality.score < policy.thresholds.critical_score) {
    return {
      level: "critical",
      regressionStreak,
      reason: `质量分仅 ${String(args.quality.score)}，低于安全阈值 ${String(policy.thresholds.critical_score)}`,
    };
  }
  if (regressionStreak >= policy.thresholds.critical_regression_streak) {
    return {
      level: "critical",
      regressionStreak,
      reason: `质量已连续 ${String(regressionStreak)} 轮明显下降（阈值 ${String(policy.thresholds.critical_regression_streak)}）`,
    };
  }
  if (severeDrop) {
    return {
      level: "critical",
      regressionStreak,
      reason: `较上轮显著下降 ${String(Math.abs(delta ?? 0))} 分（阈值 ${String(policy.thresholds.severe_drop_delta)}）`,
    };
  }
  if (args.quality.score < policy.thresholds.watch_score) {
    return {
      level: "watch",
      regressionStreak,
      reason: `质量分 ${String(args.quality.score)} 低于目标阈值 ${String(policy.thresholds.watch_score)}`,
    };
  }
  if (policy.thresholds.watch_on_trend_down && args.trend.trend === "down") {
    return {
      level: "watch",
      regressionStreak,
      reason: "较上轮出现质量下降，建议先补关键细节",
    };
  }
  return {
    level: "healthy",
    regressionStreak,
    reason: "质量稳定，可继续推进审批与执行",
  };
}

export function resolvePlanQualityGuardMode(
  raw: string | undefined,
  fallback: PlanQualityGuardMode = DEFAULT_PLAN_QUALITY_GUARD_POLICY.defaults.mode,
): PlanQualityGuardMode {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "off" || normalized === "disabled" || normalized === "0" || normalized === "false") {
    return "off";
  }
  if (normalized === "strict" || normalized === "enforce" || normalized === "hard") {
    return "strict";
  }
  if (normalized === "warn" || normalized === "1" || normalized === "true" || normalized === "enabled") {
    return "warn";
  }
  return fallback;
}

function clearApprovalFields(entry: PlanArtifactEntry): PlanArtifactEntry {
  return {
    ...entry,
    approved_hash: undefined,
    approval_ticket_id: undefined,
    approved_snapshot_path: undefined,
    approved_by: undefined,
  };
}

export function loadPlanArtifactIndex(workDir: string, sessionId: string): PlanArtifactIndex {
  const raw = readJsonObject(planIndexPath(workDir, sessionId));
  return normalizeIndex(raw, sessionId);
}

export function createPlanArtifact(workDir: string, sessionId: string, goal: string): CreatedPlanArtifact {
  return withSessionPlanLock(workDir, sessionId, () => {
    const index = loadPlanArtifactIndex(workDir, sessionId);
    const seq = nextSeq(index);
    const planId = buildPlanId();
    const title = compactSingleLine(goal, 96);
    const taskSlug = sanitizeSegment(goal, "plan-task", 48);
    const filename = `${String(seq).padStart(3, "0")}-${taskSlug}--${planId}.md`;
    const entry: PlanArtifactEntry = {
      plan_id: planId,
      seq,
      title,
      task_slug: taskSlug,
      filename,
      status: "draft",
      created_at: nowIsoUtc(),
      updated_at: nowIsoUtc(),
    };
    const planPath = planPathFromEntry(workDir, sessionId, entry);
    const markdown = buildPlanMarkdown({
      title,
      goal,
      sessionId,
      planId,
      seq,
    });
    writeFileAtomic(planPath, markdown);
    syncActiveFile(workDir, sessionId, markdown);
    const nextIndex: PlanArtifactIndex = {
      ...index,
      active_plan_id: planId,
      entries: [...index.entries, entry],
      updated_at: nowIsoUtc(),
    };
    writeIndex(workDir, sessionId, nextIndex);
    appendPlanEventUnlocked(workDir, sessionId, {
      event: "plan_created",
      plan_id: planId,
      source: "system",
      status_to: "draft",
      detail: "plan artifact created",
    });
    return {
      index: nextIndex,
      entry,
      planPath,
      sessionPlanDir: sessionPlanDir(workDir, sessionId),
    };
  });
}

export function loadActivePlanArtifact(workDir: string, sessionId: string): ActivePlanArtifact | undefined {
  const index = loadPlanArtifactIndex(workDir, sessionId);
  const activePlanId = index.active_plan_id;
  if (!activePlanId) {
    return undefined;
  }
  const entry = index.entries.find((item) => item.plan_id === activePlanId);
  if (!entry) {
    return undefined;
  }
  const planPath = planPathFromEntry(workDir, sessionId, entry);
  const content = readText(planPath);
  if (typeof content !== "string") {
    return undefined;
  }
  syncActiveFile(workDir, sessionId, content);
  return {
    index,
    entry,
    planPath,
    content,
    sessionPlanDir: sessionPlanDir(workDir, sessionId),
  };
}

export function appendPlanProgressNote(workDir: string, sessionId: string, planId: string, note: string): {
  updated: boolean;
  planPath?: string;
} {
  return withSessionPlanLock(workDir, sessionId, () => {
    const index = loadPlanArtifactIndex(workDir, sessionId);
    const entryIndex = index.entries.findIndex((item) => item.plan_id === planId);
    if (entryIndex < 0) {
      return { updated: false };
    }
    const entry = index.entries[entryIndex];
    const planPath = planPathFromEntry(workDir, sessionId, entry);
    const current = readText(planPath);
    if (typeof current !== "string") {
      return { updated: false };
    }
    const timestamp = nowIsoUtc();
    const safeNote = removeDangerousChars(note);
    const progressLine = `- ${timestamp} ${safeNote}`;
    let updatedContent = current;
    if (current.includes(PLAN_PROGRESS_SECTION)) {
      updatedContent = `${current.trimEnd()}\n${progressLine}\n`;
    } else {
      updatedContent = `${current.trimEnd()}\n\n${PLAN_PROGRESS_SECTION}\n\n${progressLine}\n`;
    }
    writeFileAtomic(planPath, updatedContent);
    syncActiveFile(workDir, sessionId, updatedContent);

    const nextStatus: PlanArtifactStatus =
      entry.status === "applied" || entry.status === "discarded"
        ? entry.status
        : "draft";
    const invalidatedApproval = Boolean(entry.approved_hash || entry.approval_ticket_id);
    const updatedEntry: PlanArtifactEntry = clearApprovalFields({
      ...entry,
      status: nextStatus,
      updated_at: timestamp,
    });
    const nextEntries = [...index.entries];
    nextEntries[entryIndex] = updatedEntry;
    writeIndex(workDir, sessionId, {
      ...index,
      entries: nextEntries,
      active_plan_id: planId,
      updated_at: timestamp,
    });
    appendPlanEventUnlocked(workDir, sessionId, {
      event: "plan_progress_appended",
      plan_id: planId,
      source: "system",
      detail: safeNote,
    });
    if (invalidatedApproval) {
      appendPlanEventUnlocked(workDir, sessionId, {
        event: "plan_approval_invalidated",
        plan_id: planId,
        source: "system",
        detail: "plan content changed after approval metadata existed",
      });
    }
    return { updated: true, planPath };
  });
}

export function replacePlanArtifactContent(
  workDir: string,
  sessionId: string,
  planId: string,
  nextContentRaw: string,
  options?: {
    source?: "cli" | "bridge" | "system";
    detail?: string;
  },
): {
  updated: boolean;
  replaced: boolean;
  planPath?: string;
} {
  return withSessionPlanLock(workDir, sessionId, () => {
    const index = loadPlanArtifactIndex(workDir, sessionId);
    const entryIndex = index.entries.findIndex((item) => item.plan_id === planId);
    if (entryIndex < 0) {
      return { updated: false, replaced: false };
    }
    const entry = index.entries[entryIndex];
    const planPath = planPathFromEntry(workDir, sessionId, entry);
    const nextContent = nextContentRaw.trim();
    if (!nextContent) {
      return { updated: false, replaced: false, planPath };
    }
    const currentContent = readText(planPath);
    if (typeof currentContent !== "string") {
      return { updated: false, replaced: false, planPath };
    }
    if (currentContent.trim() === nextContent) {
      syncActiveFile(workDir, sessionId, currentContent);
      return { updated: true, replaced: false, planPath };
    }

    const timestamp = nowIsoUtc();
    const persistedContent = `${nextContent}\n`;
    writeFileAtomic(planPath, persistedContent);
    syncActiveFile(workDir, sessionId, persistedContent);

    const invalidatedApproval = Boolean(
      entry.approved_hash || entry.approval_ticket_id || entry.approved_snapshot_path,
    );
    const nextStatus: PlanArtifactStatus =
      entry.status === "applied" || entry.status === "discarded"
        ? entry.status
        : "draft";
    const updatedEntry: PlanArtifactEntry = clearApprovalFields({
      ...entry,
      status: nextStatus,
      updated_at: timestamp,
    });
    const nextEntries = [...index.entries];
    nextEntries[entryIndex] = updatedEntry;
    writeIndex(workDir, sessionId, {
      ...index,
      entries: nextEntries,
      active_plan_id: planId,
      updated_at: timestamp,
    });
    appendPlanEventUnlocked(workDir, sessionId, {
      event: "plan_content_replaced",
      plan_id: planId,
      source: options?.source ?? "system",
      detail:
        options?.detail ??
        `replaced plan content chars=${String(nextContent.length)}`,
    });
    if (invalidatedApproval) {
      appendPlanEventUnlocked(workDir, sessionId, {
        event: "plan_approval_invalidated",
        plan_id: planId,
        source: options?.source ?? "system",
        detail: "plan content replaced after approval metadata existed",
      });
    }
    return { updated: true, replaced: true, planPath };
  });
}

export function recordPlanReviewResult(
  workDir: string,
  sessionId: string,
  planId: string,
  review: PlanReviewResult,
  source: "cli" | "bridge" | "system" = "system",
): PlanArtifactEntry | undefined {
  return withSessionPlanLock(workDir, sessionId, () => {
    const index = loadPlanArtifactIndex(workDir, sessionId);
    const entryIndex = index.entries.findIndex((item) => item.plan_id === planId);
    if (entryIndex < 0) {
      return undefined;
    }
    const current = index.entries[entryIndex];
    const timestamp = nowIsoUtc();
    const nextStatus: PlanArtifactStatus = review.ok
      ? "ready"
      : review.blocked
        ? "blocked"
        : "review_failed";
    const nextEntry: PlanArtifactEntry = clearApprovalFields({
      ...current,
      status: nextStatus,
      reviewed_at: timestamp,
      review_fail_count: review.ok ? current.review_fail_count : (current.review_fail_count ?? 0) + 1,
      blocked_count: review.blocked ? (current.blocked_count ?? 0) + 1 : current.blocked_count,
      updated_at: timestamp,
    });
    const nextEntries = [...index.entries];
    nextEntries[entryIndex] = nextEntry;
    writeIndex(workDir, sessionId, {
      ...index,
      entries: nextEntries,
      active_plan_id: planId,
      updated_at: timestamp,
    });
    appendPlanEventUnlocked(workDir, sessionId, {
      event: review.ok ? "plan_review_passed" : "plan_review_failed",
      plan_id: planId,
      source,
      status_from: current.status,
      status_to: nextStatus,
      detail: review.ok
        ? "plan review passed"
        : [
          `review_blocked=${review.blocked ? "yes" : "no"}`,
          `findings_count=${String(review.findings.length)}`,
          `findings=${review.findings.map((item) => `${item.code}:${item.section ?? "global"}`).join(",")}`,
        ].join(" "),
    });
    return nextEntry;
  });
}

export function approvePlanArtifact(
  workDir: string,
  sessionId: string,
  planId: string,
  options?: {
    approvedBy?: string;
    source?: "cli" | "bridge" | "system";
  },
): PlanApprovalResult {
  return withSessionPlanLock(workDir, sessionId, () => {
    const index = loadPlanArtifactIndex(workDir, sessionId);
    const entryIndex = index.entries.findIndex((item) => item.plan_id === planId);
    if (entryIndex < 0) {
      return { approved: false };
    }
    const current = index.entries[entryIndex];
    const planPath = planPathFromEntry(workDir, sessionId, current);
    const content = readText(planPath);
    if (typeof content !== "string") {
      return { approved: false };
    }
    const timestamp = nowIsoUtc();
    const planHash = createHash("sha256").update(content).digest("hex");
    const ticketId = buildApprovalTicketId();
    const snapshotName = `${String(current.seq).padStart(3, "0")}-approved-${current.plan_id}-${ticketId.slice(0, 8)}.md`;
    const snapshotPath = `${sessionPlanDir(workDir, sessionId)}/${snapshotName}`;
    writeFileAtomic(snapshotPath, content);

    const nextEntry: PlanArtifactEntry = {
      ...current,
      status: "approved",
      approved_at: timestamp,
      approved_hash: planHash,
      approval_ticket_id: ticketId,
      approved_snapshot_path: snapshotPath,
      approved_by: options?.approvedBy?.trim() || "system",
      updated_at: timestamp,
    };
    const nextEntries = [...index.entries];
    nextEntries[entryIndex] = nextEntry;
    writeIndex(workDir, sessionId, {
      ...index,
      entries: nextEntries,
      active_plan_id: planId,
      updated_at: timestamp,
    });
    appendPlanEventUnlocked(workDir, sessionId, {
      event: "plan_approved",
      plan_id: planId,
      source: options?.source ?? "system",
      status_from: current.status,
      status_to: "approved",
      detail: `ticket=${ticketId} hash=${planHash.slice(0, 12)}`,
    });
    return {
      approved: true,
      entry: nextEntry,
      planHash,
      ticketId,
      snapshotPath,
    };
  });
}

export function updatePlanArtifactStatus(
  workDir: string,
  sessionId: string,
  planId: string,
  status: PlanArtifactStatus,
): PlanArtifactEntry | undefined {
  return withSessionPlanLock(workDir, sessionId, () => {
    const index = loadPlanArtifactIndex(workDir, sessionId);
    const entryIndex = index.entries.findIndex((item) => item.plan_id === planId);
    if (entryIndex < 0) {
      return undefined;
    }
    const timestamp = nowIsoUtc();
    const current = index.entries[entryIndex];
    const nextEntry: PlanArtifactEntry = {
      ...current,
      status,
      updated_at: timestamp,
      reviewed_at:
        status === "ready" || status === "blocked" || status === "review_failed"
          ? timestamp
          : current.reviewed_at,
      apply_started_at: status === "applying" ? timestamp : current.apply_started_at,
      approved_at: status === "approved" ? timestamp : current.approved_at,
      apply_failed_at: status === "apply_failed" ? timestamp : current.apply_failed_at,
      applied_at: status === "applied" ? timestamp : current.applied_at,
      discarded_at: status === "discarded" ? timestamp : current.discarded_at,
    };
    const nextEntries = [...index.entries];
    nextEntries[entryIndex] = nextEntry;
    const nextIndex: PlanArtifactIndex = {
      ...index,
      entries: nextEntries,
      active_plan_id: status === "applied" || status === "discarded" ? undefined : planId,
      updated_at: timestamp,
    };
    writeIndex(workDir, sessionId, nextIndex);
    appendPlanEventUnlocked(workDir, sessionId, {
      event: "plan_status_changed",
      plan_id: planId,
      source: "system",
      status_from: current.status,
      status_to: status,
      detail: `transition ${current.status}->${status}`,
    });
    return nextEntry;
  });
}

export function recoverStaleApprovedPlan(
  workDir: string,
  sessionId: string,
  options?: {
    source?: "cli" | "bridge" | "system";
    staleAfterMs?: number;
    expectedPlanId?: string;
  },
): {
  recovered: boolean;
  entry?: PlanArtifactEntry;
  stale_ms?: number;
} {
  return withSessionPlanLock(workDir, sessionId, () => {
    const index = loadPlanArtifactIndex(workDir, sessionId);
    const targetPlanId = options?.expectedPlanId ?? index.active_plan_id;
    if (!targetPlanId) {
      return { recovered: false };
    }
    const entryIndex = index.entries.findIndex((item) => item.plan_id === targetPlanId);
    if (entryIndex < 0) {
      return { recovered: false };
    }
    const current = index.entries[entryIndex];
    if (current.status !== "approved" && current.status !== "applying") {
      return { recovered: false };
    }
    const staleAfterMs = Math.max(
      1_000,
      options?.staleAfterMs ??
        parsePositiveInt(process.env.GROBOT_PLAN_APPLY_STALE_MS, PLAN_APPLY_STALE_DEFAULT_MS),
    );
    const startedAt = current.apply_started_at ?? current.approved_at ?? current.updated_at;
    const startedAtMs = Date.parse(startedAt);
    if (!Number.isFinite(startedAtMs)) {
      return { recovered: false };
    }
    const staleMs = Date.now() - startedAtMs;
    if (staleMs < staleAfterMs) {
      return { recovered: false };
    }
    const timestamp = nowIsoUtc();
    const nextEntry: PlanArtifactEntry = {
      ...current,
      status: "apply_failed",
      updated_at: timestamp,
      apply_failed_at: timestamp,
    };
    const nextEntries = [...index.entries];
    nextEntries[entryIndex] = nextEntry;
    const nextIndex: PlanArtifactIndex = {
      ...index,
      entries: nextEntries,
      active_plan_id: targetPlanId,
      updated_at: timestamp,
    };
    writeIndex(workDir, sessionId, nextIndex);
    appendPlanEventUnlocked(workDir, sessionId, {
      event: "plan_recovered_stale_apply",
      plan_id: targetPlanId,
      source: options?.source ?? "system",
      status_from: current.status,
      status_to: "apply_failed",
      detail: `stale_ms=${String(staleMs)}`,
    });
    appendPlanEventUnlocked(workDir, sessionId, {
      event: "plan_status_changed",
      plan_id: targetPlanId,
      source: options?.source ?? "system",
      status_from: current.status,
      status_to: "apply_failed",
      detail: `transition ${current.status}->apply_failed stale_recovery stale_ms=${String(staleMs)}`,
    });
    return {
      recovered: true,
      entry: nextEntry,
      stale_ms: staleMs,
    };
  });
}

export function buildPlanApplyPrompt(input: {
  approvedPlanContent: string;
  approvedHash: string;
  ticketId: string;
  extra?: string;
}): string {
  const lines = [
    "[Approved Plan Execution]",
    "",
    "Plan approval:",
    `- ticket: ${input.ticketId}`,
    `- sha256: ${input.approvedHash}`,
    "",
    "Execution contract:",
    "- Implement only the approved plan below.",
    "- Treat the approved snapshot as the source of truth.",
    "- Do not silently expand scope beyond Scope In or ignore Scope Out.",
    "- If current files conflict with the approved plan, stop and return to plan mode with the conflict.",
    "- Keep implementation and validation aligned with the plan's Milestones and Validation sections.",
    "- After implementation, report changed files, validation commands, results, and unresolved risks.",
    "",
    "Plan to implement:",
    "<approved_plan>",
    input.approvedPlanContent.trim(),
    "</approved_plan>",
  ];
  const extraText = input.extra?.trim();
  if (extraText) {
    lines.push("");
    lines.push("Additional user instruction:");
    lines.push(extraText);
  }
  return lines.join("\n");
}
