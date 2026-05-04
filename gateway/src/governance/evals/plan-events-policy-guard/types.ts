import type { PolicyGateField } from "./constants";

export type JsonObject = Record<string, unknown>;

export interface ParsedCliArgs {
  policyPath: string;
  reportPath: string;
  printJson: boolean;
}

export interface LoadedPolicy {
  schema: string;
  schema_version: number;
  profile: string;
  gates: {
    min_events_count: number;
    min_sessions_count: number;
    min_plan_mode_entered_count: number;
    min_plan_created_count: number;
    min_plan_progress_appended_count: number;
    max_invalid_lines: number;
    max_missing_files: number;
    max_review_failed_rate: number | null;
    max_guard_denied_rate: number | null;
    max_quality_guard_blocked_rate: number | null;
    max_idempotent_hit_rate: number | null;
    max_policy_fail_rate: number | null;
    max_unknown_phase_rate: number | null;
    max_stale_recovery_count: number | null;
  };
}

export interface PolicyEnvOverrideResult {
  policy: LoadedPolicy;
  overrides: JsonObject;
  scope: {
    allow_source: "default_all" | "env";
    allow_fields: PolicyGateField[];
    deny_source: "default_none" | "env";
    deny_fields: PolicyGateField[];
  };
}

export interface PolicyOverrideScope {
  allow: Set<PolicyGateField> | null;
  deny: Set<PolicyGateField>;
}
