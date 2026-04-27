import {
  buildEnvironmentRecoveryCore,
  formatEnvironmentCommands,
  formatEnvironmentRecoveryCoreFields,
  stringEnumField,
  type EnvironmentRecoveryPlanCore,
} from "./environment-recovery";

export type BrowserEnvironmentRecoveryErrorCode =
  | "NO_EXTENSION"
  | "NO_SESSION"
  | "TRANSPORT_UNAVAILABLE";

export type BrowserEnvironmentRecoveryAction =
  | "setup_and_doctor"
  | "reconnect_session_and_doctor"
  | "start_hub_and_doctor";

export type BrowserEnvironmentRecoveryPlan =
  EnvironmentRecoveryPlanCore<BrowserEnvironmentRecoveryErrorCode, BrowserEnvironmentRecoveryAction>;

const BROWSER_ENVIRONMENT_ERROR_CODES = new Set<string>([
  "NO_EXTENSION",
  "NO_SESSION",
  "TRANSPORT_UNAVAILABLE",
]);

export function browserEnvironmentErrorCode(
  errorData: Record<string, unknown> | undefined,
): BrowserEnvironmentRecoveryErrorCode | undefined {
  return stringEnumField<BrowserEnvironmentRecoveryErrorCode>(
    errorData,
    "error_code",
    BROWSER_ENVIRONMENT_ERROR_CODES,
  );
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
      ...buildEnvironmentRecoveryCore({
        errorCode,
        action: "setup_and_doctor",
        commands: ["grobot browser setup", "grobot browser doctor"],
      }),
    };
  }
  if (errorCode === "NO_SESSION") {
    return {
      ...buildEnvironmentRecoveryCore({
        errorCode,
        action: "reconnect_session_and_doctor",
        commands: ["grobot browser hub start", "grobot browser doctor"],
      }),
    };
  }
  if (errorCode === "TRANSPORT_UNAVAILABLE") {
    return {
      ...buildEnvironmentRecoveryCore({
        errorCode,
        action: "start_hub_and_doctor",
        commands: ["grobot browser hub start", "grobot browser doctor"],
      }),
    };
  }
  return null;
}

export function formatBrowserEnvironmentRecoveryPlan(
  plan: BrowserEnvironmentRecoveryPlan | null | undefined,
): string {
  return formatEnvironmentRecoveryCoreFields(plan);
}

export function browserEnvironmentRecoveryActionInstruction(
  plan: BrowserEnvironmentRecoveryPlan | null | undefined,
): string | undefined {
  if (!plan) {
    return undefined;
  }
  return [
    `Ask the user to repair the browser environment with ${formatEnvironmentCommands(plan)};`,
    "do not retry the browser tool until `grobot browser doctor` confirms the environment is ready.",
  ].join(" ");
}

export function browserEnvironmentRecoveryFixInstruction(input: {
  plan: BrowserEnvironmentRecoveryPlan | null | undefined;
  toolName: string;
}): string | undefined {
  const { plan, toolName } = input;
  if (!plan) {
    return undefined;
  }
  const commands = formatEnvironmentCommands(plan);
  if (plan.errorCode === "NO_EXTENSION") {
    return `Browser environment fix: Do not retry ${toolName} automatically. Ask the user to run ${commands}; retry only after the browser extension is connected.`;
  }
  if (plan.errorCode === "NO_SESSION") {
    return `Browser environment fix: Do not retry ${toolName} automatically. Ask the user to open or reconnect a browser session, then run ${commands}; retry only after \`grobot browser doctor\` confirms the session is ready.`;
  }
  if (plan.errorCode === "TRANSPORT_UNAVAILABLE") {
    return `Browser environment fix: Do not retry ${toolName} automatically. Ask the user to run ${commands}; retry only after the browser transport is available.`;
  }
  return undefined;
}
