export interface BridgeApplyFailurePolicyDecision {
  policyAction: "fail";
  policyReason: "provider_runtime_failure" | "bridge_apply_exec_timeout" | "bridge_apply_exec_failed";
  diagnosticCode:
    | "BRIDGE_SEMANTIC_CONTEXT_UNAVAILABLE"
    | "BRIDGE_PROVIDER_RUNTIME_FAILURE"
    | "BRIDGE_APPLY_EXEC_TIMEOUT"
    | "BRIDGE_APPLY_EXEC_FAILED";
  errorClass?: string;
  providerName?: string;
}

const ERROR_CLASS_PATTERNS = [
  /\bclass=([a-zA-Z0-9_:-]+)\b/,
  /\berror_class=([a-zA-Z0-9_:-]+)\b/,
  /\berrorClass=([a-zA-Z0-9_:-]+)\b/,
];

const PROVIDER_PATTERNS = [
  /\bprovider=([a-zA-Z0-9._:-]+)\b/,
  /\bprovider_name=([a-zA-Z0-9._:-]+)\b/,
  /\bproviderName=([a-zA-Z0-9._:-]+)\b/,
];
const SEMANTIC_RUNTIME_ERROR_CLASSES = new Set([
  "semantic_index_config_invalid",
  "semantic_index_confirmation_required",
  "semantic_index_required",
  "semantic_config_missing",
]);

function normalizeToken(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractErrorClass(detail: string): string | undefined {
  for (const pattern of ERROR_CLASS_PATTERNS) {
    const matched = pattern.exec(detail);
    const value = normalizeToken(matched?.[1]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function extractProviderName(detail: string): string | undefined {
  for (const pattern of PROVIDER_PATTERNS) {
    const matched = pattern.exec(detail);
    const value = normalizeToken(matched?.[1]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function resolveBridgeApplyFailurePolicy(detailRaw: string): BridgeApplyFailurePolicyDecision {
  const detail = String(detailRaw ?? "");
  const errorClass = extractErrorClass(detail);
  const providerName = extractProviderName(detail);
  if (errorClass) {
    const diagnosticCode = SEMANTIC_RUNTIME_ERROR_CLASSES.has(errorClass)
      ? "BRIDGE_SEMANTIC_CONTEXT_UNAVAILABLE"
      : "BRIDGE_PROVIDER_RUNTIME_FAILURE";
    return {
      policyAction: "fail",
      policyReason: "provider_runtime_failure",
      diagnosticCode,
      errorClass,
      providerName,
    };
  }
  if (/timeout|timed out/i.test(detail)) {
    return {
      policyAction: "fail",
      policyReason: "bridge_apply_exec_timeout",
      diagnosticCode: "BRIDGE_APPLY_EXEC_TIMEOUT",
      providerName,
    };
  }
  return {
    policyAction: "fail",
    policyReason: "bridge_apply_exec_failed",
    diagnosticCode: "BRIDGE_APPLY_EXEC_FAILED",
    providerName,
  };
}
