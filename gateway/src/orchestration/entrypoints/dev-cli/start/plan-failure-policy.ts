import { type SessionProviderRuntimeState } from "./session-registry";

export type PlanFailurePhase = "planning" | "applying";
export type PlanFailureAction = "fail" | "degrade";

export interface PlanFailureDecision {
  action: PlanFailureAction;
  reason: string;
  providerName?: string;
  errorClass?: string;
  hint?: string;
}

interface RecentProviderFailure {
  providerName: string;
  errorClass: string;
  failedAtMs: number;
}

interface ResolvePlanFailureDecisionInput {
  phase: PlanFailurePhase;
  exitCode: number;
  providerStates: readonly SessionProviderRuntimeState[];
  nowMs?: number;
  failureStateStalenessMs?: number;
}

const DEFAULT_FAILURE_STATE_STALENESS_MS = 2 * 60 * 1_000;
const PLANNING_SEMANTIC_DEGRADE_CLASSES = new Set([
  "semantic_index_config_invalid",
  "semantic_index_confirmation_required",
  "semantic_index_required",
  "semantic_config_missing",
]);

function toIsoTimestampMs(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function resolveRecentProviderFailure(
  providerStates: readonly SessionProviderRuntimeState[],
  minFailedAtMs: number,
): RecentProviderFailure | undefined {
  let latest: RecentProviderFailure | undefined;
  for (const state of providerStates) {
    const errorClass = state.last_error_class?.trim();
    const failedAtIso = state.last_failed_at?.trim();
    if (!errorClass || !failedAtIso) {
      continue;
    }
    const failedAtMs = toIsoTimestampMs(failedAtIso);
    if (typeof failedAtMs !== "number" || failedAtMs < minFailedAtMs) {
      continue;
    }
    if (!latest || failedAtMs > latest.failedAtMs) {
      latest = {
        providerName: state.provider_name,
        errorClass,
        failedAtMs,
      };
    }
  }
  return latest;
}

function formatSemanticDegradeHint(errorClass: string): string {
  switch (errorClass) {
    case "semantic_index_config_invalid":
      return "fix cwconfig.json includePatterns, then rerun `cw index <repo-path>`.";
    case "semantic_index_confirmation_required":
      return "run `cw index <repo-path>` and complete the confirmation flow.";
    case "semantic_index_required":
      return "initialize semantic index with `cw index <repo-path>` first.";
    case "semantic_config_missing":
      return "check retrieval api_key/base_url settings and network reachability.";
    default:
      return "check semantic index and retrieval configuration.";
  }
}

export function resolvePlanFailureDecision(
  input: ResolvePlanFailureDecisionInput,
): PlanFailureDecision {
  const nowMs = typeof input.nowMs === "number" ? input.nowMs : Date.now();
  const failureStateStalenessMs = typeof input.failureStateStalenessMs === "number"
    ? Math.max(0, Math.floor(input.failureStateStalenessMs))
    : DEFAULT_FAILURE_STATE_STALENESS_MS;
  const minFailedAtMs = nowMs - failureStateStalenessMs;
  const recentFailure = resolveRecentProviderFailure(input.providerStates, minFailedAtMs);
  const providerName = recentFailure?.providerName;
  const errorClass = recentFailure?.errorClass;

  if (
    input.phase === "planning"
    && recentFailure
    && PLANNING_SEMANTIC_DEGRADE_CLASSES.has(recentFailure.errorClass)
  ) {
    return {
      action: "degrade",
      reason: "planning_semantic_context_unavailable",
      providerName: recentFailure.providerName,
      errorClass: recentFailure.errorClass,
      hint: formatSemanticDegradeHint(recentFailure.errorClass),
    };
  }

  if (recentFailure) {
    return {
      action: "fail",
      reason: "provider_runtime_failure",
      providerName,
      errorClass,
    };
  }

  return {
    action: "fail",
    reason: input.exitCode === 0 ? "turn_unknown_failure" : "turn_exit_code_failure",
  };
}
