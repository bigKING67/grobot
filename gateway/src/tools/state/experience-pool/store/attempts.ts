import {
  MAX_ATTEMPT_HISTORY,
} from "./constants";
import {
  type ExperienceAttemptOutcome,
  type ExperienceAttemptRecord,
  type ExperienceAttemptStage,
  type ExperienceProviderFailureDiagnostics,
} from "../types";
import { compactWhitespace, nowIso } from "./utils";

export function parseAttemptStage(raw: unknown): ExperienceAttemptStage {
  if (
    raw === "planning"
    || raw === "implementation"
    || raw === "verification"
    || raw === "runtime"
    || raw === "unknown"
  ) {
    return raw;
  }
  return "unknown";
}

export function parseOptionalAttemptStage(raw: unknown): ExperienceAttemptStage | undefined {
  if (
    raw === "planning"
    || raw === "implementation"
    || raw === "verification"
    || raw === "runtime"
    || raw === "unknown"
  ) {
    return raw;
  }
  return undefined;
}

function parseAttemptOutcome(raw: unknown): ExperienceAttemptOutcome {
  return raw === "failure" ? "failure" : "success";
}

function compactDiagnosticsString(value: unknown, maxLength = 120): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = compactWhitespace(value);
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function finiteDiagnosticsInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

export function parseProviderFailureDiagnostics(raw: unknown): ExperienceProviderFailureDiagnostics | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const diagnostics: ExperienceProviderFailureDiagnostics = {};
  const providerName = compactDiagnosticsString(record.providerName ?? record.provider_name ?? record.provider, 80);
  const diagnosticKind = compactDiagnosticsString(record.diagnosticKind ?? record.diagnostic_kind, 120);
  const source = compactDiagnosticsString(record.source, 120);
  const stage = compactDiagnosticsString(record.stage, 120);
  const providerKind = compactDiagnosticsString(record.providerKind ?? record.provider_kind, 80);
  const model = compactDiagnosticsString(record.model, 120);
  const upstreamErrorKind = compactDiagnosticsString(record.upstreamErrorKind ?? record.upstream_error_kind, 120);
  const httpStatus = finiteDiagnosticsInt(record.httpStatus ?? record.http_status);
  const attempt = finiteDiagnosticsInt(record.attempt);
  const maxAttempts = finiteDiagnosticsInt(record.maxAttempts ?? record.max_attempts);
  const retryable = record.retryable;
  if (providerName) {
    diagnostics.providerName = providerName;
  }
  if (diagnosticKind) {
    diagnostics.diagnosticKind = diagnosticKind;
  }
  if (source) {
    diagnostics.source = source;
  }
  if (stage) {
    diagnostics.stage = stage;
  }
  if (providerKind) {
    diagnostics.providerKind = providerKind;
  }
  if (model) {
    diagnostics.model = model;
  }
  if (upstreamErrorKind) {
    diagnostics.upstreamErrorKind = upstreamErrorKind;
  }
  if (typeof httpStatus === "number") {
    diagnostics.httpStatus = httpStatus;
  }
  if (typeof attempt === "number") {
    diagnostics.attempt = attempt;
  }
  if (typeof maxAttempts === "number") {
    diagnostics.maxAttempts = maxAttempts;
  }
  if (typeof retryable === "boolean") {
    diagnostics.retryable = retryable;
  }
  return Object.keys(diagnostics).length > 0 ? diagnostics : undefined;
}

export function parseAttemptRecord(raw: unknown): ExperienceAttemptRecord | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const capturedAt = typeof record.capturedAt === "string" && record.capturedAt.trim().length > 0
    ? record.capturedAt
    : nowIso();
  const outcome = parseAttemptOutcome(record.outcome);
  const stage = parseAttemptStage(record.stage);
  return {
    capturedAt,
    outcome,
    stage,
    providerName: typeof record.providerName === "string" ? compactWhitespace(record.providerName).slice(0, 64) : undefined,
    verificationPass: typeof record.verificationPass === "boolean" ? record.verificationPass : undefined,
    traceId: typeof record.traceId === "string" ? compactWhitespace(record.traceId).slice(0, 128) : undefined,
    strategy: typeof record.strategy === "string" ? compactWhitespace(record.strategy).slice(0, 220) : undefined,
    errorClass: typeof record.errorClass === "string" ? compactWhitespace(record.errorClass).slice(0, 120) : undefined,
    errorMessage: typeof record.errorMessage === "string" ? compactWhitespace(record.errorMessage).slice(0, 220) : undefined,
    toolContext: typeof record.toolContext === "string" ? compactWhitespace(record.toolContext).slice(0, 160) : undefined,
    providerFailureDiagnostics: parseProviderFailureDiagnostics(
      record.providerFailureDiagnostics ?? record.provider_failure_diagnostics,
    ),
  };
}

export function normalizeAttemptHistory(rows: readonly ExperienceAttemptRecord[]): ExperienceAttemptRecord[] {
  const normalized = rows
    .map((row) => ({
      ...row,
      capturedAt: typeof row.capturedAt === "string" && row.capturedAt.trim().length > 0
        ? row.capturedAt
        : nowIso(),
      outcome: (row.outcome === "failure" ? "failure" : "success") as ExperienceAttemptOutcome,
      stage: parseAttemptStage(row.stage),
      providerName: row.providerName ? compactWhitespace(row.providerName).slice(0, 64) : undefined,
      verificationPass: typeof row.verificationPass === "boolean" ? row.verificationPass : undefined,
      traceId: row.traceId ? compactWhitespace(row.traceId).slice(0, 128) : undefined,
      strategy: row.strategy ? compactWhitespace(row.strategy).slice(0, 220) : undefined,
      errorClass: row.errorClass ? compactWhitespace(row.errorClass).slice(0, 120) : undefined,
      errorMessage: row.errorMessage ? compactWhitespace(row.errorMessage).slice(0, 220) : undefined,
      toolContext: row.toolContext ? compactWhitespace(row.toolContext).slice(0, 160) : undefined,
      providerFailureDiagnostics: parseProviderFailureDiagnostics(row.providerFailureDiagnostics),
    }))
    .filter((row) => Boolean(row.capturedAt))
    .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))
    .slice(0, MAX_ATTEMPT_HISTORY);
  return normalized;
}

export function appendAttempt(
  history: readonly ExperienceAttemptRecord[],
  attempt: ExperienceAttemptRecord,
): ExperienceAttemptRecord[] {
  return normalizeAttemptHistory([attempt, ...history]);
}

export function computeRecoverySuccessCount(history: readonly ExperienceAttemptRecord[]): number {
  if (history.length <= 1) {
    return 0;
  }
  const timeline = [...history].reverse();
  let previous: ExperienceAttemptOutcome | undefined;
  let recovered = 0;
  for (const row of timeline) {
    if (previous === "failure" && row.outcome === "success") {
      recovered += 1;
    }
    previous = row.outcome;
  }
  return recovered;
}

export function computeConsecutiveFailureCount(history: readonly ExperienceAttemptRecord[]): number {
  let count = 0;
  for (const row of history) {
    if (row.outcome !== "failure") {
      break;
    }
    count += 1;
  }
  return count;
}
