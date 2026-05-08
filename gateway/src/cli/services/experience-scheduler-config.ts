import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { removeTrailingSlashes } from "./runtime-paths";

export interface ExperienceSchedulerConfig {
  enabled: boolean;
  intervalMs: number;
  tasksDir: string;
  doneDir: string;
  logPath: string;
  defaultMaxDelayHours: number;
}

interface ExperienceSchedulerConfigFieldError {
  field: string;
  detail: string;
}

interface ProjectExperienceSchedulerConfig extends Partial<ExperienceSchedulerConfig> {
  errors?: ExperienceSchedulerConfigFieldError[];
}

interface ResolveExperienceSchedulerConfigInput {
  workDir: string;
  projectTomlPath?: string;
}

export class ExperienceSchedulerConfigInputError extends Error {
  readonly code: string;
  readonly field: string;

  constructor(field: string, detail: string) {
    super(detail);
    this.name = "ExperienceSchedulerConfigInputError";
    this.code = `invalid_${field.replace(/-/g, "_")}`;
    this.field = field;
  }
}

export function isExperienceSchedulerConfigInputError(
  error: unknown,
): error is ExperienceSchedulerConfigInputError {
  return error instanceof ExperienceSchedulerConfigInputError;
}

function stripInlineComment(line: string): string {
  let inQuote = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inQuote = !inQuote;
      continue;
    }
    if (char === "#" && !inQuote) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseTomlBool(raw: string): boolean | undefined {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}

function parseTomlInt(raw: string): number | undefined {
  const normalized = raw.trim();
  if (!/^-?\d+$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function parseTomlString(raw: string): string | undefined {
  const match = raw.trim().match(/^"([^"]*)"$/);
  if (!match || typeof match[1] !== "string") {
    return undefined;
  }
  return match[1];
}

function parseEnvBool(raw: string | undefined): boolean | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseEnvInt(raw: string | undefined): number | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim();
  if (!/^-?\d+$/.test(normalized)) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function hasEnvValue(envKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(process.env, envKey);
}

function throwSchedulerConfigError(
  field: string,
  detail: string,
  source: string,
): never {
  throw new ExperienceSchedulerConfigInputError(
    field,
    `${detail} (source=${source})`,
  );
}

function pushProjectConfigError(
  config: ProjectExperienceSchedulerConfig,
  field: string,
  detail: string,
): void {
  if (!config.errors) {
    config.errors = [];
  }
  config.errors.push({ field, detail });
}

function assertProjectConfigParseErrors(
  config: ProjectExperienceSchedulerConfig,
): void {
  const first = config.errors?.[0];
  if (!first) {
    return;
  }
  throwSchedulerConfigError(first.field, first.detail, "project_toml");
}

function assertIntRange(input: {
  value: number;
  field: string;
  detailName: string;
  min: number;
  max: number;
  source: string;
}): number {
  if (
    !Number.isSafeInteger(input.value) ||
    input.value < input.min ||
    input.value > input.max
  ) {
    throwSchedulerConfigError(
      input.field,
      `${input.detailName} must be an integer between ${String(input.min)} and ${String(input.max)}`,
      input.source,
    );
  }
  return input.value;
}

function assertSchedulerPath(input: {
  value: string;
  field: string;
  detailName: string;
  source: string;
}): string {
  const trimmed = input.value.trim();
  if (trimmed.length === 0) {
    throwSchedulerConfigError(
      input.field,
      `${input.detailName} must not be empty`,
      input.source,
    );
  }
  return trimmed;
}

function readEnvBoolControl(envKey: string, field: string): boolean | undefined {
  if (!hasEnvValue(envKey)) {
    return undefined;
  }
  const raw = process.env[envKey];
  if (raw === undefined || raw.trim().length === 0) {
    throwSchedulerConfigError(field, `${field} must not be empty`, `env:${envKey}`);
  }
  const parsed = parseEnvBool(raw);
  if (typeof parsed !== "boolean") {
    throwSchedulerConfigError(field, `${field} must be boolean`, `env:${envKey}`);
  }
  return parsed;
}

function readEnvIntControl(input: {
  envKey: string;
  field: string;
  min: number;
  max: number;
}): number | undefined {
  if (!hasEnvValue(input.envKey)) {
    return undefined;
  }
  const raw = process.env[input.envKey];
  if (raw === undefined || raw.trim().length === 0) {
    throwSchedulerConfigError(
      input.field,
      `${input.field} must not be empty`,
      `env:${input.envKey}`,
    );
  }
  const parsed = parseEnvInt(raw);
  if (typeof parsed !== "number") {
    throwSchedulerConfigError(
      input.field,
      `${input.field} must be an integer between ${String(input.min)} and ${String(input.max)}`,
      `env:${input.envKey}`,
    );
  }
  return assertIntRange({
    value: parsed,
    field: input.field,
    detailName: input.field,
    min: input.min,
    max: input.max,
    source: `env:${input.envKey}`,
  });
}

function readEnvPathControl(envKey: string, field: string): string | undefined {
  if (!hasEnvValue(envKey)) {
    return undefined;
  }
  const raw = process.env[envKey];
  if (raw === undefined) {
    throwSchedulerConfigError(field, `${field} must not be empty`, `env:${envKey}`);
  }
  return assertSchedulerPath({
    value: raw,
    field,
    detailName: field,
    source: `env:${envKey}`,
  });
}

function normalizeSchedulerPath(value: string, workDir: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return removeTrailingSlashes(workDir);
  }
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) {
    return removeTrailingSlashes(trimmed);
  }
  return removeTrailingSlashes(resolve(workDir, trimmed));
}

function readProjectBoolControl(
  config: ProjectExperienceSchedulerConfig,
  raw: string,
  field: string,
): boolean | undefined {
  const parsed = parseTomlBool(raw);
  if (typeof parsed !== "boolean") {
    pushProjectConfigError(config, field, `${field} must be boolean`);
  }
  return parsed;
}

function readProjectIntControl(
  config: ProjectExperienceSchedulerConfig,
  raw: string,
  field: string,
  detail?: string,
): number | undefined {
  const parsed = parseTomlInt(raw);
  if (typeof parsed !== "number") {
    pushProjectConfigError(config, field, detail ?? `${field} must be an integer`);
  }
  return parsed;
}

function readProjectPathControl(
  config: ProjectExperienceSchedulerConfig,
  raw: string,
  field: string,
): string | undefined {
  const parsed = parseTomlString(raw);
  if (typeof parsed !== "string") {
    pushProjectConfigError(config, field, `${field} must be a string`);
    return undefined;
  }
  if (parsed.trim().length === 0) {
    pushProjectConfigError(config, field, `${field} must not be empty`);
    return undefined;
  }
  return parsed;
}

function parseProjectSchedulerConfig(projectTomlPath: string | undefined): ProjectExperienceSchedulerConfig {
  if (!projectTomlPath || !existsSync(projectTomlPath)) {
    return {};
  }
  let raw = "";
  try {
    raw = readFileSync(projectTomlPath, "utf8");
  } catch {
    return {};
  }
  const lines = raw.split(/\r?\n/);
  let inSchedulerSection = false;
  const resolved: ProjectExperienceSchedulerConfig = {};
  for (const rawLine of lines) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      inSchedulerSection = sectionMatch[1] === "experience.scheduler";
      continue;
    }
    if (!inSchedulerSection) {
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kv) {
      continue;
    }
    applyProjectSchedulerConfigKey(resolved, kv[1], kv[2]);
  }
  return resolved;
}

function applyProjectSchedulerConfigKey(
  resolved: ProjectExperienceSchedulerConfig,
  key: string,
  value: string,
): void {
  if (key === "enabled") {
    const parsed = readProjectBoolControl(
      resolved,
      value,
      "experience-scheduler-enabled",
    );
    if (typeof parsed === "boolean") {
      resolved.enabled = parsed;
    }
    return;
  }
  if (key === "interval_ms") {
    const parsed = readProjectIntControl(
      resolved,
      value,
      "experience-scheduler-interval-ms",
      "experience-scheduler-interval-ms must be an integer between 10000 and 86400000",
    );
    if (typeof parsed === "number") {
      resolved.intervalMs = parsed;
    }
    return;
  }
  if (key === "interval_secs") {
    const parsed = readProjectIntControl(
      resolved,
      value,
      "experience-scheduler-interval-secs",
      "experience-scheduler-interval-secs must be an integer between 10 and 86400",
    );
    if (typeof parsed === "number") {
      resolved.intervalMs = assertIntRange({
        value: parsed,
        field: "experience-scheduler-interval-secs",
        detailName: "experience-scheduler-interval-secs",
        min: 10,
        max: 86_400,
        source: "project_toml",
      }) * 1_000;
    }
    return;
  }
  if (key === "tasks_dir") {
    const parsed = readProjectPathControl(
      resolved,
      value,
      "experience-scheduler-tasks-dir",
    );
    if (typeof parsed === "string") {
      resolved.tasksDir = parsed;
    }
    return;
  }
  if (key === "done_dir") {
    const parsed = readProjectPathControl(
      resolved,
      value,
      "experience-scheduler-done-dir",
    );
    if (typeof parsed === "string") {
      resolved.doneDir = parsed;
    }
    return;
  }
  if (key === "log_path") {
    const parsed = readProjectPathControl(
      resolved,
      value,
      "experience-scheduler-log-path",
    );
    if (typeof parsed === "string") {
      resolved.logPath = parsed;
    }
    return;
  }
  if (key === "default_max_delay_hours") {
    const parsed = readProjectIntControl(
      resolved,
      value,
      "experience-scheduler-default-max-delay-hours",
      "experience-scheduler-default-max-delay-hours must be an integer between 1 and 24",
    );
    if (typeof parsed === "number") {
      resolved.defaultMaxDelayHours = parsed;
    }
  }
}

export function resolveExperienceSchedulerConfig(
  input: ResolveExperienceSchedulerConfigInput,
): ExperienceSchedulerConfig {
  const defaults: ExperienceSchedulerConfig = {
    enabled: false,
    intervalMs: 120_000,
    tasksDir: `${removeTrailingSlashes(input.workDir)}/.grobot/scheduler/tasks`,
    doneDir: `${removeTrailingSlashes(input.workDir)}/.grobot/scheduler/done`,
    logPath: `${removeTrailingSlashes(input.workDir)}/.grobot/scheduler/scheduler.log`,
    defaultMaxDelayHours: 6,
  };
  const fromProject = parseProjectSchedulerConfig(input.projectTomlPath);
  assertProjectConfigParseErrors(fromProject);
  const merged: ExperienceSchedulerConfig = {
    enabled: typeof fromProject.enabled === "boolean" ? fromProject.enabled : defaults.enabled,
    intervalMs: typeof fromProject.intervalMs === "number"
      ? assertIntRange({
          value: fromProject.intervalMs,
          field: "experience-scheduler-interval-ms",
          detailName: "experience-scheduler-interval-ms",
          min: 10_000,
          max: 86_400_000,
          source: "project_toml",
        })
      : defaults.intervalMs,
    tasksDir: normalizeSchedulerPath(fromProject.tasksDir ?? defaults.tasksDir, input.workDir),
    doneDir: normalizeSchedulerPath(fromProject.doneDir ?? defaults.doneDir, input.workDir),
    logPath: normalizeSchedulerPath(fromProject.logPath ?? defaults.logPath, input.workDir),
    defaultMaxDelayHours: typeof fromProject.defaultMaxDelayHours === "number"
      ? assertIntRange({
          value: fromProject.defaultMaxDelayHours,
          field: "experience-scheduler-default-max-delay-hours",
          detailName: "experience-scheduler-default-max-delay-hours",
          min: 1,
          max: 24,
          source: "project_toml",
        })
      : defaults.defaultMaxDelayHours,
  };
  applyEnvExperienceSchedulerConfig(merged, input.workDir);
  return merged;
}

function applyEnvExperienceSchedulerConfig(
  merged: ExperienceSchedulerConfig,
  workDir: string,
): void {
  const envEnabled = readEnvBoolControl(
    "GROBOT_EXPERIENCE_SCHEDULER_ENABLED",
    "experience-scheduler-enabled",
  );
  if (typeof envEnabled === "boolean") {
    merged.enabled = envEnabled;
  }
  const envIntervalMs = readEnvIntControl({
    envKey: "GROBOT_EXPERIENCE_SCHEDULER_INTERVAL_MS",
    field: "experience-scheduler-interval-ms",
    min: 10_000,
    max: 86_400_000,
  });
  if (typeof envIntervalMs === "number") {
    merged.intervalMs = envIntervalMs;
  }
  const envTasksDir = readEnvPathControl(
    "GROBOT_EXPERIENCE_SCHEDULER_TASKS_DIR",
    "experience-scheduler-tasks-dir",
  );
  if (typeof envTasksDir === "string") {
    merged.tasksDir = normalizeSchedulerPath(envTasksDir, workDir);
  }
  const envDoneDir = readEnvPathControl(
    "GROBOT_EXPERIENCE_SCHEDULER_DONE_DIR",
    "experience-scheduler-done-dir",
  );
  if (typeof envDoneDir === "string") {
    merged.doneDir = normalizeSchedulerPath(envDoneDir, workDir);
  }
  const envLogPath = readEnvPathControl(
    "GROBOT_EXPERIENCE_SCHEDULER_LOG_PATH",
    "experience-scheduler-log-path",
  );
  if (typeof envLogPath === "string") {
    merged.logPath = normalizeSchedulerPath(envLogPath, workDir);
  }
  const envDefaultMaxDelayHours = readEnvIntControl({
    envKey: "GROBOT_EXPERIENCE_SCHEDULER_DEFAULT_MAX_DELAY_HOURS",
    field: "experience-scheduler-default-max-delay-hours",
    min: 1,
    max: 24,
  });
  if (typeof envDefaultMaxDelayHours === "number") {
    merged.defaultMaxDelayHours = envDefaultMaxDelayHours;
  }
}
