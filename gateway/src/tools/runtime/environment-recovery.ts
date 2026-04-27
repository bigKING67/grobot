export interface EnvironmentRecoveryPlanCore<
  ErrorCode extends string = string,
  Action extends string = string,
> {
  errorCode: ErrorCode;
  action: Action;
  retryAllowed: false;
  commands: string[];
}

export function stringField(
  record: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function stringListField(
  record: Record<string, unknown> | undefined,
  key: string,
): string[] {
  const value = record?.[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

export function stringEnumField<T extends string>(
  record: Record<string, unknown> | undefined,
  key: string,
  allowed: ReadonlySet<string>,
): T | undefined {
  const value = record?.[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return allowed.has(trimmed) ? trimmed as T : undefined;
}

export function buildEnvironmentRecoveryCore<
  ErrorCode extends string,
  Action extends string,
>(input: {
  errorCode: ErrorCode;
  action: Action;
  commands: string[];
}): EnvironmentRecoveryPlanCore<ErrorCode, Action> {
  return {
    errorCode: input.errorCode,
    action: input.action,
    retryAllowed: false,
    commands: [...input.commands],
  };
}

export function formatEnvironmentCommands(
  plan: EnvironmentRecoveryPlanCore,
): string {
  return plan.commands.map((command) => `\`${command}\``).join(", then ");
}

export function formatPipeList(value: readonly string[]): string {
  return value.length > 0 ? value.join("|") : "<none>";
}

export function formatEnvironmentRecoveryCoreFields(
  plan: EnvironmentRecoveryPlanCore | null | undefined,
  extraFields: readonly string[] = [],
): string {
  if (!plan) {
    return "<none>";
  }
  return [
    `code=${plan.errorCode}`,
    `action=${plan.action}`,
    `retry_allowed=${plan.retryAllowed ? "true" : "false"}`,
    ...extraFields,
    `commands=${formatPipeList(plan.commands)}`,
  ].join(" ");
}

export function serializeEnvironmentRecoveryCorePlan(
  plan: EnvironmentRecoveryPlanCore | null | undefined,
): Record<string, unknown> | null {
  if (!plan) {
    return null;
  }
  return {
    error_code: plan.errorCode,
    action: plan.action,
    retry_allowed: plan.retryAllowed,
    commands: [...plan.commands],
  };
}
