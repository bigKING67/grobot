export type BrowserEnvironmentRecoveryErrorCode =
  | "NO_EXTENSION"
  | "NO_SESSION"
  | "TRANSPORT_UNAVAILABLE";

export type BrowserEnvironmentRecoveryAction =
  | "setup_and_doctor"
  | "reconnect_session_and_doctor"
  | "start_hub_and_doctor";

export interface BrowserEnvironmentRecoveryPlan {
  errorCode: BrowserEnvironmentRecoveryErrorCode;
  action: BrowserEnvironmentRecoveryAction;
  retryAllowed: false;
  commands: string[];
}

const BROWSER_ENVIRONMENT_ERROR_CODES = new Set<string>([
  "NO_EXTENSION",
  "NO_SESSION",
  "TRANSPORT_UNAVAILABLE",
]);

export function browserEnvironmentErrorCode(
  errorData: Record<string, unknown> | undefined,
): BrowserEnvironmentRecoveryErrorCode | undefined {
  const value = errorData?.error_code;
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return BROWSER_ENVIRONMENT_ERROR_CODES.has(trimmed)
    ? trimmed as BrowserEnvironmentRecoveryErrorCode
    : undefined;
}

export function buildBrowserEnvironmentRecoveryPlan(input: {
  errorClass: string | null | undefined;
  errorData: Record<string, unknown> | undefined;
}): BrowserEnvironmentRecoveryPlan | null {
  if (input.errorClass !== "browser_backend_result_error") {
    return null;
  }
  const errorCode = browserEnvironmentErrorCode(input.errorData);
  if (errorCode === "NO_EXTENSION") {
    return {
      errorCode,
      action: "setup_and_doctor",
      retryAllowed: false,
      commands: ["grobot browser setup", "grobot browser doctor"],
    };
  }
  if (errorCode === "NO_SESSION") {
    return {
      errorCode,
      action: "reconnect_session_and_doctor",
      retryAllowed: false,
      commands: ["grobot browser hub start", "grobot browser doctor"],
    };
  }
  if (errorCode === "TRANSPORT_UNAVAILABLE") {
    return {
      errorCode,
      action: "start_hub_and_doctor",
      retryAllowed: false,
      commands: ["grobot browser hub start", "grobot browser doctor"],
    };
  }
  return null;
}

export function formatBrowserEnvironmentRecoveryPlan(
  plan: BrowserEnvironmentRecoveryPlan | null | undefined,
): string {
  if (!plan) {
    return "<none>";
  }
  return [
    `code=${plan.errorCode}`,
    `action=${plan.action}`,
    `retry_allowed=${plan.retryAllowed ? "true" : "false"}`,
    `commands=${plan.commands.join("|")}`,
  ].join(" ");
}
