import { CliStringOptionInputError } from "../../cli-args";
import { CliNumericOptionInputError } from "../../status/option-parsing";
import { resolveMemoryStrategyProfile } from "../memory-strategy-profile";

const MEMORY_MAINTENANCE_DEFAULT_INTERVAL_MS = 5 * 60 * 1_000;
const MEMORY_MAINTENANCE_MIN_INTERVAL_MS = 15_000;
const MEMORY_MAINTENANCE_MAX_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const PROMPT_QUALITY_WINDOW_DEFAULT_SIZE = 20;
const PROMPT_QUALITY_WINDOW_MAX_SIZE = 200;

export interface StartEnvControls {
  memoryMaintenanceEnabled: boolean;
  memoryMaintenanceIntervalMs: number;
  promptQualityWindowSize: number;
}

type EnvMap = Record<string, string | undefined>;

function parseStartEnvFlag(input: {
  env: EnvMap;
  envKey: string;
  field: string;
  fallbackValue: boolean;
}): boolean {
  const raw = input.env[input.envKey];
  if (raw === undefined || raw.trim().length === 0) {
    return input.fallbackValue;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new CliStringOptionInputError(
    input.field,
    `${input.field} must be one of: 1, true, yes, on, 0, false, no, off`,
  );
}

function parseStartEnvInt(input: {
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
    throw new CliNumericOptionInputError(
      input.field,
      `${input.field} must be an integer between ${String(input.min)} and ${String(input.max)}`,
    );
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed < input.min || parsed > input.max) {
    throw new CliNumericOptionInputError(
      input.field,
      `${input.field} must be an integer between ${String(input.min)} and ${String(input.max)}`,
    );
  }
  return parsed;
}

export function resolveStartEnvControls(
  env: EnvMap = process.env,
): StartEnvControls {
  resolveMemoryStrategyProfile({
    envProfile: env.GROBOT_MEMORY_STRATEGY_PROFILE,
    activeSessionKey: "",
    activeSessionPreview: undefined,
  });
  return {
    memoryMaintenanceEnabled: parseStartEnvFlag({
      env,
      envKey: "GROBOT_MEMORY_MAINTENANCE_ENABLED",
      field: "memory-maintenance-enabled",
      fallbackValue: true,
    }),
    memoryMaintenanceIntervalMs: parseStartEnvInt({
      env,
      envKey: "GROBOT_MEMORY_MAINTENANCE_INTERVAL_MS",
      field: "memory-maintenance-interval-ms",
      fallbackValue: MEMORY_MAINTENANCE_DEFAULT_INTERVAL_MS,
      min: MEMORY_MAINTENANCE_MIN_INTERVAL_MS,
      max: MEMORY_MAINTENANCE_MAX_INTERVAL_MS,
    }),
    promptQualityWindowSize: parseStartEnvInt({
      env,
      envKey: "GROBOT_CONTEXT_GRAPH_CACHE_WINDOW_SIZE",
      field: "context-graph-cache-window-size",
      fallbackValue: PROMPT_QUALITY_WINDOW_DEFAULT_SIZE,
      min: 1,
      max: PROMPT_QUALITY_WINDOW_MAX_SIZE,
    }),
  };
}
