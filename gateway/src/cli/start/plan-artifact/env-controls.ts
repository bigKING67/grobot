import {
  PLAN_APPLY_STALE_DEFAULT_MS,
  PLAN_EVENTS_DEFAULT_MAX_BYTES,
  PLAN_EVENTS_DEFAULT_ROTATE_KEEP,
} from "./constants";

const PLAN_EVENTS_MAX_BYTES_MIN = 1_024;
const PLAN_EVENTS_MAX_BYTES_MAX = 100 * 1_024 * 1_024;
const PLAN_EVENTS_ROTATE_KEEP_MIN = 1;
const PLAN_EVENTS_ROTATE_KEEP_MAX = 100;
const PLAN_APPLY_STALE_MS_MIN = 1_000;
const PLAN_APPLY_STALE_MS_MAX = 24 * 60 * 60 * 1_000;

export class PlanArtifactControlInputError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(field: string, detail: string) {
    super(detail);
    this.name = "PlanArtifactControlInputError";
    this.code = `invalid_${field.replace(/-/g, "_")}`;
    this.field = field;
  }
}

export function isPlanArtifactControlInputError(
  error: unknown,
): error is PlanArtifactControlInputError {
  return error instanceof PlanArtifactControlInputError;
}

export interface PlanArtifactEnvControls {
  eventsMaxBytes: number;
  eventsRotateKeep: number;
  applyStaleMs: number;
}

type EnvMap = Record<string, string | undefined>;

function parsePlanArtifactEnvInt(input: {
  env: EnvMap;
  envKey: string;
  field: string;
  fallbackValue: number;
  min: number;
  max: number;
}): number {
  const raw = input.env[input.envKey];
  if (raw === undefined || raw.trim().length === 0) {
    return input.fallbackValue;
  }
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new PlanArtifactControlInputError(
      input.field,
      `${input.field} must be an integer between ${String(input.min)} and ${String(input.max)}`,
    );
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed < input.min || parsed > input.max) {
    throw new PlanArtifactControlInputError(
      input.field,
      `${input.field} must be an integer between ${String(input.min)} and ${String(input.max)}`,
    );
  }
  return parsed;
}

export function resolvePlanArtifactEnvControls(
  env: EnvMap = process.env,
): PlanArtifactEnvControls {
  return {
    eventsMaxBytes: parsePlanArtifactEnvInt({
      env,
      envKey: "GROBOT_PLAN_EVENTS_MAX_BYTES",
      field: "plan-events-max-bytes",
      fallbackValue: PLAN_EVENTS_DEFAULT_MAX_BYTES,
      min: PLAN_EVENTS_MAX_BYTES_MIN,
      max: PLAN_EVENTS_MAX_BYTES_MAX,
    }),
    eventsRotateKeep: parsePlanArtifactEnvInt({
      env,
      envKey: "GROBOT_PLAN_EVENTS_ROTATE_KEEP",
      field: "plan-events-rotate-keep",
      fallbackValue: PLAN_EVENTS_DEFAULT_ROTATE_KEEP,
      min: PLAN_EVENTS_ROTATE_KEEP_MIN,
      max: PLAN_EVENTS_ROTATE_KEEP_MAX,
    }),
    applyStaleMs: parsePlanArtifactEnvInt({
      env,
      envKey: "GROBOT_PLAN_APPLY_STALE_MS",
      field: "plan-apply-stale-ms",
      fallbackValue: PLAN_APPLY_STALE_DEFAULT_MS,
      min: PLAN_APPLY_STALE_MS_MIN,
      max: PLAN_APPLY_STALE_MS_MAX,
    }),
  };
}
