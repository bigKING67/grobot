import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import {
  PLAN_BENCHMARK_CLAUDE_PATH_ENV,
  PLAN_BENCHMARK_CODEX_PATH_ENV,
  PLAN_BENCHMARK_DEFAULT_CLAUDE_PATHS,
  PLAN_BENCHMARK_DEFAULT_CODEX_PATHS,
  PLAN_BENCHMARK_DEFAULT_GENERIC_AGENT_PATHS,
  PLAN_BENCHMARK_GENERIC_AGENT_PATH_ENV,
  PLAN_BENCHMARK_PRESET_DEFAULT_PROFILE,
  PLAN_BENCHMARK_PRESET_POLICY_FILE_PREFIX,
  PLAN_BENCHMARK_PRESET_POLICY_FILE_SUFFIX,
  PLAN_BENCHMARK_PRESET_POLICY_PATH_ENV,
  PLAN_BENCHMARK_PRESET_POLICY_SCHEMA,
  PLAN_BENCHMARK_PRESET_POLICY_VERSION,
  PLAN_BENCHMARK_PRESET_PROFILE_ENV,
  PLAN_QUALITY_GUARD_POLICY_EVALS_RELATIVE,
} from "./constants";
import {
  resolveCandidatePath,
  sanitizeSegment,
} from "./fs-utils";
import type {
  PlanQualityBenchmarkPresetCandidate,
  PlanQualityBenchmarkPresetResolution,
} from "./types";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
