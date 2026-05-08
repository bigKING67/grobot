import { type RuntimeProviderCandidate } from "../turn/contract";

type RuntimeProviderControlContext = {
  providerName: string;
  source: string;
};

type ThrowProviderConfigError = (
  field: string,
  detail: string,
  context: RuntimeProviderControlContext,
) => never;

function normalizePositiveInt(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function normalizePositiveNumber(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

export function normalizeProviderPositiveInt(input: {
  raw: number | undefined;
  field: string;
  context: RuntimeProviderControlContext;
  throwConfigError: ThrowProviderConfigError;
}): number | undefined {
  if (input.raw === undefined) {
    return undefined;
  }
  const normalized = normalizePositiveInt(input.raw);
  if (typeof normalized !== "number") {
    input.throwConfigError(
      input.field,
      `${input.field} must be a positive integer`,
      input.context,
    );
  }
  return normalized;
}

export function normalizeProviderPositiveNumber(input: {
  raw: number | undefined;
  field: string;
  context: RuntimeProviderControlContext;
  throwConfigError: ThrowProviderConfigError;
}): number | undefined {
  if (input.raw === undefined) {
    return undefined;
  }
  const normalized = normalizePositiveNumber(input.raw);
  if (typeof normalized !== "number") {
    input.throwConfigError(
      input.field,
      `${input.field} must be a positive number`,
      input.context,
    );
  }
  return normalized;
}

export function resolveProviderCandidateControls(input: {
  provider: {
    priority?: number;
    weight?: number;
    unitCost?: number;
    maxInFlight?: number;
    requestsPerMinute?: number;
    burst?: number;
  };
  providerMaxInFlightDefault: number | undefined;
  providerRequestsPerMinuteDefault: number | undefined;
  providerBurstDefault: number | undefined;
  context: RuntimeProviderControlContext;
  throwConfigError: ThrowProviderConfigError;
}): Pick<
  RuntimeProviderCandidate,
  "priority" | "weight" | "unitCost" | "maxInFlight" | "requestsPerMinute" | "burst"
> {
  const requestsPerMinute =
    normalizeProviderPositiveInt({
      raw: input.provider.requestsPerMinute,
      field: "provider-requests-per-minute",
      context: input.context,
      throwConfigError: input.throwConfigError,
    }) ?? input.providerRequestsPerMinuteDefault;
  return {
    priority: normalizeProviderPositiveInt({
      raw: input.provider.priority,
      field: "provider-priority",
      context: input.context,
      throwConfigError: input.throwConfigError,
    }),
    weight: normalizeProviderPositiveNumber({
      raw: input.provider.weight,
      field: "provider-weight",
      context: input.context,
      throwConfigError: input.throwConfigError,
    }),
    unitCost: normalizeProviderPositiveNumber({
      raw: input.provider.unitCost,
      field: "provider-unit-cost",
      context: input.context,
      throwConfigError: input.throwConfigError,
    }),
    maxInFlight:
      normalizeProviderPositiveInt({
        raw: input.provider.maxInFlight,
        field: "provider-max-inflight",
        context: input.context,
        throwConfigError: input.throwConfigError,
      }) ?? input.providerMaxInFlightDefault,
    requestsPerMinute,
    burst:
      normalizeProviderPositiveInt({
        raw: input.provider.burst,
        field: "provider-burst",
        context: input.context,
        throwConfigError: input.throwConfigError,
      }) ??
      input.providerBurstDefault ??
      requestsPerMinute,
  };
}
