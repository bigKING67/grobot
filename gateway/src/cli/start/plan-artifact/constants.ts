import type { PlanQualityGuardPolicy } from "./types";

export const PLAN_ARTIFACT_INDEX_VERSION = 2;
export const PLAN_PROGRESS_SECTION = "## Progress Log";
export const PLAN_LOCK_WAIT_MS = 20;
export const PLAN_LOCK_TIMEOUT_MS = 4_000;
export const PLAN_LOCK_STALE_MS = 30_000;
export const PLAN_EVENTS_DEFAULT_MAX_BYTES = 1_048_576;
export const PLAN_EVENTS_DEFAULT_ROTATE_KEEP = 5;
export const PLAN_APPLY_STALE_DEFAULT_MS = 10 * 60 * 1000;
export const PLAN_QUALITY_GUARD_POLICY_SCHEMA = "plan_quality_guard_policy";
export const PLAN_QUALITY_GUARD_POLICY_VERSION = 1;
export const PLAN_QUALITY_GUARD_POLICY_PROFILE_ENV = "GROBOT_PLAN_QUALITY_GUARD_PROFILE";
export const PLAN_QUALITY_GUARD_POLICY_PATH_ENV = "GROBOT_PLAN_QUALITY_GUARD_POLICY_PATH";
export const PLAN_BENCHMARK_CODEX_PATH_ENV = "GROBOT_PLAN_BENCHMARK_CODEX_PATH";
export const PLAN_BENCHMARK_CLAUDE_PATH_ENV = "GROBOT_PLAN_BENCHMARK_CLAUDE_PATH";
export const PLAN_BENCHMARK_GENERIC_AGENT_PATH_ENV = "GROBOT_PLAN_BENCHMARK_GENERIC_AGENT_PATH";
export const PLAN_BENCHMARK_PRESET_PROFILE_ENV = "GROBOT_PLAN_BENCHMARK_PRESET_PROFILE";
export const PLAN_BENCHMARK_PRESET_POLICY_PATH_ENV = "GROBOT_PLAN_BENCHMARK_PRESET_POLICY_PATH";
export const PLAN_BENCHMARK_PRESET_POLICY_SCHEMA = "plan_quality_benchmark_preset_policy";
export const PLAN_BENCHMARK_PRESET_POLICY_VERSION = 1;
export const PLAN_BENCHMARK_PRESET_DEFAULT_PROFILE = "prod";
export const PLAN_BENCHMARK_PRESET_POLICY_FILE_PREFIX = "plan_quality_benchmark_preset.";
export const PLAN_BENCHMARK_PRESET_POLICY_FILE_SUFFIX = ".json";
export const PLAN_BENCHMARK_NO_HINT = "no_hint_available";
export const PLAN_QUALITY_GUARD_DEFAULT_PROFILE = "prod";
export const PLAN_QUALITY_GUARD_POLICY_EVALS_RELATIVE = "gateway/evals";
export const PLAN_QUALITY_GUARD_POLICY_FILE_PREFIX = "plan_quality_guard_policy.";
export const PLAN_QUALITY_GUARD_POLICY_FILE_SUFFIX = ".json";
export const PLAN_BENCHMARK_DEFAULT_CODEX_PATHS = [
  "/Users/gaoqian/Documents/sixseven/tools/all/src/commands.ts",
  "/Users/gaoqian/Documents/sixseven/tools/all/src/commands/help/help.tsx",
] as const;
export const PLAN_BENCHMARK_DEFAULT_CLAUDE_PATHS = [
  "/Users/gaoqian/Documents/sixseven/tools/all/src/services/api/claude.ts",
  "/Users/gaoqian/Documents/sixseven/tools/all/src/services/claudeAiLimits.ts",
] as const;
export const PLAN_BENCHMARK_DEFAULT_GENERIC_AGENT_PATHS = [
  "/Users/gaoqian/Documents/sixseven/codeproject/GenericAgent/memory/plan_sop.md",
  "/Users/gaoqian/Documents/sixseven/codeproject/GenericAgent/memory/autonomous_operation_sop/task_planning.md",
] as const;
export const DEFAULT_PLAN_QUALITY_GUARD_POLICY: PlanQualityGuardPolicy = {
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
export const PROPOSED_PLAN_OPEN_TAG = "<proposed_plan>";
export const PROPOSED_PLAN_CLOSE_TAG = "</proposed_plan>";
export const REQUIRED_PLAN_SECTIONS = [
  "Goal",
  "Scope In",
  "Scope Out",
  "Milestones",
  "Validation",
  "Risk & Rollback",
] as const;
