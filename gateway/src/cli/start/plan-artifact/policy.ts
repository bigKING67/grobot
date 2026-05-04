import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import {
  DEFAULT_PLAN_QUALITY_GUARD_POLICY,
  PLAN_QUALITY_GUARD_DEFAULT_PROFILE,
  PLAN_QUALITY_GUARD_POLICY_EVALS_RELATIVE,
  PLAN_QUALITY_GUARD_POLICY_FILE_PREFIX,
  PLAN_QUALITY_GUARD_POLICY_FILE_SUFFIX,
  PLAN_QUALITY_GUARD_POLICY_PATH_ENV,
  PLAN_QUALITY_GUARD_POLICY_PROFILE_ENV,
  PLAN_QUALITY_GUARD_POLICY_SCHEMA,
  PLAN_QUALITY_GUARD_POLICY_VERSION,
} from "./constants";
import { resolvePlanQualityGuardMode } from "./guard";
import { sanitizeSegment } from "./fs-utils";
import type {
  PlanQualityGuardMode,
  PlanQualityGuardPolicy,
  PlanQualityGuardPolicySource,
  ResolvedPlanQualityGuardPolicy,
} from "./types";

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
