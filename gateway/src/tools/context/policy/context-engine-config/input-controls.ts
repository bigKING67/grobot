import {
  type ContextCompressionProfile,
  type ContextPromptQualityGuardAdaptiveMode,
  type PromptCompactionStage,
} from "../../types";
import {
  DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST,
  DEFAULT_PROMPT_QUALITY_GUARD_MAX_FLOOR_STAGE,
} from "./defaults";
import {
  parseBooleanToken,
  parseContextCompressionProfile,
  parseNumberToken,
  parsePromptQualityGuardMaxFloorStage,
  parseStringListToken,
  normalizePromptQualityGuardAdaptiveMode,
} from "./normalize";
import {
  ContextEngineConfigInputError,
  type TomlOverrides,
} from "./types";

interface ControlContext {
  source: string;
}

interface EnvControlInput<T> {
  envKey: string;
  field: string;
  parse: (raw: string, field: string, context: ControlContext) => T;
}

interface TomlControlInput<T> {
  toml: TomlOverrides;
  key: keyof TomlOverrides;
  field: string;
  source: string;
  validate: (value: T, field: string, context: ControlContext) => T;
}

function throwContextEngineConfigError(
  field: string,
  detail: string,
  context: ControlContext,
): never {
  throw new ContextEngineConfigInputError(
    field,
    `${detail} (source=${context.source})`,
  );
}

function hasEnvValue(envKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(process.env, envKey);
}

export function assertContextEngineTomlParseErrors(toml: TomlOverrides): void {
  const first = toml.errors?.[0];
  if (!first) {
    return;
  }
  throwContextEngineConfigError(first.field, first.detail, {
    source: "project_toml",
  });
}

function resolveEnvControl<T>(input: EnvControlInput<T>): T | undefined {
  if (!hasEnvValue(input.envKey)) {
    return undefined;
  }
  const raw = process.env[input.envKey];
  if (raw === undefined || raw.trim().length === 0) {
    throwContextEngineConfigError(
      input.field,
      `${input.field} must not be empty`,
      { source: `env:${input.envKey}` },
    );
  }
  return input.parse(raw, input.field, { source: `env:${input.envKey}` });
}

function resolveExplicitSource(input: {
  envKey?: string;
  toml: TomlOverrides;
  tomlKey: keyof TomlOverrides;
}): string | undefined {
  if (input.envKey && hasEnvValue(input.envKey)) {
    return `env:${input.envKey}`;
  }
  if (input.toml.sourceKeys?.has(String(input.tomlKey))) {
    return "project_toml";
  }
  return undefined;
}

function resolveTomlControl<T>(input: TomlControlInput<T>): T | undefined {
  if (!input.toml.sourceKeys?.has(String(input.key))) {
    return undefined;
  }
  const value = input.toml[input.key] as T | undefined;
  if (value === undefined) {
    return undefined;
  }
  return input.validate(value, input.field, { source: input.source });
}

export function resolveStringEnumControl<T extends string>(input: {
  envKey?: string;
  envField: string;
  toml: TomlOverrides;
  tomlKey: keyof TomlOverrides;
  tomlField: string;
  tomlSource?: string;
  fallback: T;
  parse: (raw: string | undefined) => T | undefined;
  detail: string;
}): T {
  const parse = (raw: string, field: string, context: ControlContext): T => {
    const parsed = input.parse(raw);
    if (!parsed) {
      throwContextEngineConfigError(field, input.detail, context);
    }
    return parsed;
  };
  const envValue = input.envKey
    ? resolveEnvControl({
        envKey: input.envKey,
        field: input.envField,
        parse,
      })
    : undefined;
  if (envValue !== undefined) {
    return envValue;
  }
  const tomlValue = resolveTomlControl<T>({
    toml: input.toml,
    key: input.tomlKey,
    field: input.tomlField,
    source: input.tomlSource ?? "project_toml",
    validate: (value, field, context) => parse(value, field, context),
  });
  return tomlValue ?? input.fallback;
}

export function resolveProfileControl(input: {
  toml: TomlOverrides;
  fallback: ContextCompressionProfile;
}): ContextCompressionProfile {
  return resolveStringEnumControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PROFILE",
    envField: "context-engine-profile",
    toml: input.toml,
    tomlKey: "profile",
    tomlField: "context-engine-profile",
    fallback: input.fallback,
    parse: parseContextCompressionProfile,
    detail: "context-engine-profile must be balanced, aggressive, or conservative",
  });
}

export function resolveBooleanControl(input: {
  envKey?: string;
  envField: string;
  toml: TomlOverrides;
  tomlKey: keyof TomlOverrides;
  tomlField: string;
  fallback: boolean;
}): boolean {
  const parse = (raw: string, field: string, context: ControlContext): boolean => {
    const parsed = parseBooleanToken(raw);
    if (typeof parsed !== "boolean") {
      throwContextEngineConfigError(field, `${field} must be boolean`, context);
    }
    return parsed;
  };
  const envValue = input.envKey
    ? resolveEnvControl({
        envKey: input.envKey,
        field: input.envField,
        parse,
      })
    : undefined;
  if (envValue !== undefined) {
    return envValue;
  }
  const tomlValue = resolveTomlControl<boolean>({
    toml: input.toml,
    key: input.tomlKey,
    field: input.tomlField,
    source: "project_toml",
    validate: (value) => value,
  });
  return tomlValue ?? input.fallback;
}

function parseNumber(raw: string, field: string, context: ControlContext): number {
  const parsed = parseNumberToken(raw);
  if (typeof parsed !== "number") {
    throwContextEngineConfigError(field, `${field} must be a number`, context);
  }
  return parsed;
}

function validateIntegerRange(input: {
  value: number;
  field: string;
  min: number;
  max: number;
  allowZero?: boolean;
  context: ControlContext;
}): number {
  const normalized = Math.floor(input.value);
  const min = input.allowZero ? 0 : input.min;
  if (
    !Number.isFinite(input.value) ||
    !Number.isSafeInteger(normalized) ||
    normalized !== input.value ||
    normalized < min ||
    normalized > input.max
  ) {
    throwContextEngineConfigError(
      input.field,
      `${input.field} must be an integer between ${String(min)} and ${String(input.max)}`,
      input.context,
    );
  }
  return normalized;
}

export function assertContextEngineTokenBudgetControl(input: {
  contextWindowTokens: number;
  contextWindowSource?: string;
  reservedOutputTokens: number;
  reservedOutputSource?: string;
  safetyMarginTokens: number;
  safetyMarginSource?: string;
}): void {
  const effective =
    input.contextWindowTokens
    - input.reservedOutputTokens
    - input.safetyMarginTokens;
  if (effective >= 1_024) {
    return;
  }
  const source = input.contextWindowSource
    ?? input.reservedOutputSource
    ?? input.safetyMarginSource
    ?? "derived";
  throw new ContextEngineConfigInputError(
    "context-engine-effective-window",
    `context-engine-effective-window must be at least 1024 after reserved output and safety margin (source=${source})`,
  );
}

export function assertContextEngineAutoCompactLimitControl(input: {
  autoCompactTokenLimit: number;
  autoCompactSource?: string;
  effectiveWindowTokens: number;
}): void {
  if (
    !input.autoCompactSource
    || input.autoCompactTokenLimit <= input.effectiveWindowTokens
  ) {
    return;
  }
  throw new ContextEngineConfigInputError(
    "context-engine-auto-compact-token-limit",
    `context-engine-auto-compact-token-limit must be less than or equal to effective context window ${String(input.effectiveWindowTokens)} (source=${input.autoCompactSource})`,
  );
}

export function assertContextEngineThresholdOrder(input: {
  proactiveRatio: number;
  proactiveSource?: string;
  forcedRatio: number;
  forcedSource?: string;
  hardRatio: number;
  hardSource?: string;
}): void {
  if (input.forcedRatio <= input.proactiveRatio) {
    const source = input.forcedSource ?? input.proactiveSource ?? "derived";
    throw new ContextEngineConfigInputError(
      "context-engine-forced-ratio",
      `context-engine-forced-ratio must be greater than context-engine-proactive-ratio (source=${source})`,
    );
  }
  if (input.hardRatio <= input.forcedRatio) {
    const source = input.hardSource ?? input.forcedSource ?? "derived";
    throw new ContextEngineConfigInputError(
      "context-engine-hard-ratio",
      `context-engine-hard-ratio must be greater than context-engine-forced-ratio (source=${source})`,
    );
  }
}

export function resolveIntegerControl(input: {
  envKey?: string;
  envField: string;
  toml: TomlOverrides;
  tomlKey: keyof TomlOverrides;
  tomlField: string;
  fallback: number;
  min: number;
  max: number;
  allowZero?: boolean;
}): number {
  const parse = (raw: string, field: string, context: ControlContext): number =>
    validateIntegerRange({
      value: parseNumber(raw, field, context),
      field,
      min: input.min,
      max: input.max,
      allowZero: input.allowZero,
      context,
    });
  const envValue = input.envKey
    ? resolveEnvControl({
        envKey: input.envKey,
        field: input.envField,
        parse,
      })
    : undefined;
  if (envValue !== undefined) {
    return envValue;
  }
  const tomlValue = resolveTomlControl<number>({
    toml: input.toml,
    key: input.tomlKey,
    field: input.tomlField,
    source: "project_toml",
    validate: (value, field, context) =>
      validateIntegerRange({
        value,
        field,
        min: input.min,
        max: input.max,
        allowZero: input.allowZero,
        context,
      }),
  });
  return tomlValue ?? input.fallback;
}

export function resolveIntegerControlSource(input: {
  envKey?: string;
  toml: TomlOverrides;
  tomlKey: keyof TomlOverrides;
}): string | undefined {
  return resolveExplicitSource(input);
}

export function resolveRatioControl(input: {
  envKey?: string;
  envField: string;
  toml: TomlOverrides;
  tomlKey: keyof TomlOverrides;
  tomlField: string;
  fallback: number;
  min: number;
  max: number;
}): number {
  const validate = (value: number, field: string, context: ControlContext): number => {
    if (!Number.isFinite(value) || value < input.min || value > input.max) {
      throwContextEngineConfigError(
        field,
        `${field} must be a number between ${String(input.min)} and ${String(input.max)}`,
        context,
      );
    }
    return value;
  };
  const envValue = input.envKey
    ? resolveEnvControl({
        envKey: input.envKey,
        field: input.envField,
        parse: (raw, field, context) => validate(parseNumber(raw, field, context), field, context),
      })
    : undefined;
  if (envValue !== undefined) {
    return envValue;
  }
  const tomlValue = resolveTomlControl<number>({
    toml: input.toml,
    key: input.tomlKey,
    field: input.tomlField,
    source: "project_toml",
    validate,
  });
  return tomlValue ?? input.fallback;
}

export function resolveRatioControlSource(input: {
  envKey?: string;
  toml: TomlOverrides;
  tomlKey: keyof TomlOverrides;
}): string | undefined {
  return resolveExplicitSource(input);
}

export function resolveAdaptiveModeAllowlistControl(input: {
  toml: TomlOverrides;
  fallback?: ContextPromptQualityGuardAdaptiveMode[];
}): ContextPromptQualityGuardAdaptiveMode[] {
  const fallback = input.fallback
    ?? DEFAULT_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST;
  const validate = (
    raw: string[] | undefined,
    field: string,
    context: ControlContext,
  ): ContextPromptQualityGuardAdaptiveMode[] => {
    if (!Array.isArray(raw) || raw.length === 0) {
      throwContextEngineConfigError(
        field,
        `${field} must include at least one of harden or relax`,
        context,
      );
    }
    const normalized = normalizeAdaptiveModeAllowlist(raw, field, context);
    if (normalized.length === 0) {
      throwContextEngineConfigError(
        field,
        `${field} must include harden, relax, or both`,
        context,
      );
    }
    return normalized;
  };
  const envValue = resolveEnvControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_ADAPTIVE_MODE_ALLOWLIST",
    field: "context-engine-prompt-quality-guard-adaptive-mode-allowlist",
    parse: (raw, field, context) => validate(parseStringListToken(raw), field, context),
  });
  if (envValue !== undefined) {
    return envValue;
  }
  const tomlValue = resolveTomlControl<ContextPromptQualityGuardAdaptiveMode[]>({
    toml: input.toml,
    key: "promptQualityGuardAdaptiveModeAllowlist",
    field: "context-engine-prompt-quality-guard-adaptive-mode-allowlist",
    source: "project_toml",
    validate,
  });
  return tomlValue ?? [...fallback];
}

export function resolvePromptQualityGuardMaxFloorStageControl(input: {
  toml: TomlOverrides;
  fallback?: PromptCompactionStage;
}): PromptCompactionStage {
  return resolveStringEnumControl({
    envKey: "GROBOT_CONTEXT_ENGINE_PROMPT_QUALITY_GUARD_MAX_FLOOR_STAGE",
    envField: "context-engine-prompt-quality-guard-max-floor-stage",
    toml: input.toml,
    tomlKey: "promptQualityGuardMaxFloorStage",
    tomlField: "context-engine-prompt-quality-guard-max-floor-stage",
    fallback: input.fallback ?? DEFAULT_PROMPT_QUALITY_GUARD_MAX_FLOOR_STAGE,
    parse: parsePromptQualityGuardMaxFloorStage,
    detail: "context-engine-prompt-quality-guard-max-floor-stage must be proactive, forced, or minimal",
  });
}

function normalizeAdaptiveModeAllowlist(
  raw: string[],
  field: string,
  context: ControlContext,
): ContextPromptQualityGuardAdaptiveMode[] {
  const unique = new Set<ContextPromptQualityGuardAdaptiveMode>();
  for (const value of raw) {
    const normalized = normalizePromptQualityGuardAdaptiveMode(value);
    if (!normalized) {
      throwContextEngineConfigError(
        field,
        `${field} must include only harden or relax`,
        context,
      );
    }
    unique.add(normalized);
  }
  return Array.from(unique.values());
}
