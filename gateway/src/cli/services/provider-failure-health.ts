import { type SessionProviderRuntimeState } from "../start/session-registry";

export type ProviderStickyBypassReason =
  | "last_error_nonretryable"
  | "last_error_exhausted";

export interface ProviderLastErrorHealth {
  scorePenalty: number;
  reason?: string;
  stickyBypassReason?: ProviderStickyBypassReason;
}

export function recordBooleanField(
  value: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const raw = value?.[key];
  return typeof raw === "boolean" ? raw : undefined;
}

export function recordFiniteNumberField(
  value: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const raw = value?.[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return undefined;
  }
  return raw;
}

function recordStringField(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const raw = value?.[key];
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function hasAttemptsExhausted(errorData: Record<string, unknown> | undefined): boolean {
  const attempt = recordFiniteNumberField(errorData, "attempt");
  const maxAttempts = recordFiniteNumberField(errorData, "max_attempts");
  if (typeof attempt !== "number" || typeof maxAttempts !== "number") {
    return false;
  }
  return maxAttempts > 0 && attempt >= maxAttempts;
}

export function isTransientProviderHttpStatus(status: number | undefined): boolean {
  if (typeof status !== "number") {
    return false;
  }
  const normalized = Math.trunc(status);
  return normalized === 408
    || normalized === 425
    || normalized === 429
    || normalized === 500
    || normalized === 502
    || normalized === 503
    || normalized === 504;
}

function normalizeErrorKind(state: SessionProviderRuntimeState | undefined): string | undefined {
  const diagnosticKind = recordStringField(state?.last_error_data, "diagnostic_kind");
  if (diagnosticKind) {
    return diagnosticKind;
  }
  const errorClass = state?.last_error_class?.trim();
  return errorClass && errorClass.length > 0 ? errorClass : undefined;
}

function isConfigBlocker(errorKind: string | undefined): boolean {
  return errorKind === "config_missing"
    || errorKind === "config_invalid"
    || errorKind === "semantic_config_missing"
    || errorKind === "semantic_index_config_invalid";
}

function isProviderTransportError(errorKind: string | undefined): boolean {
  return errorKind === "upstream_connect_failed"
    || errorKind === "upstream_timeout"
    || errorKind === "upstream_request_failed"
    || errorKind === "upstream_response_read_failed";
}

export function resolveProviderLastErrorHealth(
  state: SessionProviderRuntimeState | undefined,
): ProviderLastErrorHealth {
  const errorKind = normalizeErrorKind(state);
  const errorData = state?.last_error_data;
  const retryable = recordBooleanField(errorData, "retryable");
  const httpStatus = recordFiniteNumberField(errorData, "http_status");
  const status = typeof httpStatus === "number" ? Math.trunc(httpStatus) : undefined;
  const attemptsExhausted = hasAttemptsExhausted(errorData);

  if (!errorKind && !errorData) {
    return { scorePenalty: 0 };
  }
  if (isConfigBlocker(errorKind)) {
    return {
      scorePenalty: 1200,
      reason: `config_blocker:${errorKind ?? "unknown"}`,
      stickyBypassReason: "last_error_nonretryable",
    };
  }
  if (status === 401 || status === 403 || status === 404) {
    return {
      scorePenalty: 1200,
      reason: `provider_auth_http_${String(status)}`,
      stickyBypassReason: "last_error_nonretryable",
    };
  }
  if (retryable === false) {
    return {
      scorePenalty: 800,
      reason: "last_error_nonretryable",
      stickyBypassReason: "last_error_nonretryable",
    };
  }
  if (attemptsExhausted) {
    return {
      scorePenalty: 700,
      reason: "last_error_exhausted",
      stickyBypassReason: "last_error_exhausted",
    };
  }
  if (retryable === true && isTransientProviderHttpStatus(status)) {
    return {
      scorePenalty: 150,
      reason: `retryable_http_${String(status)}`,
    };
  }
  if (retryable === true && isProviderTransportError(errorKind)) {
    return {
      scorePenalty: 120,
      reason: `retryable_transport:${errorKind ?? "unknown"}`,
    };
  }
  if (typeof status === "number" && status >= 400 && status < 500) {
    return {
      scorePenalty: 600,
      reason: `provider_client_http_${String(status)}`,
    };
  }
  if (errorKind) {
    return {
      scorePenalty: 80,
      reason: `last_error:${errorKind}`,
    };
  }
  return {
    scorePenalty: 80,
    reason: "last_error_unknown",
  };
}
