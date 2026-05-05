import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { removeTrailingSlashes } from "./runtime-paths";

type SchedulerTaskRepeat = "daily" | "weekday" | "weekly" | "monthly" | "once" | `every_${number}h` | `every_${number}d`;

interface SchedulerTaskConfig {
  enabled: boolean;
  repeat: SchedulerTaskRepeat | string;
  schedule: string;
  prompt: string;
  maxDelayHours: number;
}

interface SchedulerTaskFile {
  enabled?: unknown;
  repeat?: unknown;
  schedule?: unknown;
  prompt?: unknown;
  max_delay_hours?: unknown;
}

export interface ExperienceSchedulerConfig {
  enabled: boolean;
  intervalMs: number;
  tasksDir: string;
  doneDir: string;
  logPath: string;
  defaultMaxDelayHours: number;
}

export interface ExperienceSchedulerTrigger {
  taskId: string;
  taskPath: string;
  repeat: string;
  schedule: string;
  prompt: string;
  reportPath: string;
}

export interface ExperienceSchedulerTickResult {
  checked: number;
  skipped: number;
  triggered: ExperienceSchedulerTrigger[];
  errors: string[];
}

export interface ExperienceSchedulerExecutionReport {
  status: "success" | "failed";
  exitCode: number;
  reason?: string;
  finishedAt?: string;
}

export interface ExperienceSchedulerRuntime {
  getConfig(): ExperienceSchedulerConfig;
  tick(now?: Date): ExperienceSchedulerTickResult;
  writeDoneReport(trigger: ExperienceSchedulerTrigger, report: ExperienceSchedulerExecutionReport): void;
}

interface ResolveExperienceSchedulerConfigInput {
  workDir: string;
  projectTomlPath?: string;
}

function nowIso(): string {
  return new Date().toISOString();
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

function parseProjectSchedulerConfig(projectTomlPath: string | undefined): Partial<ExperienceSchedulerConfig> {
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
  const resolved: Partial<ExperienceSchedulerConfig> = {};
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
    const key = kv[1];
    const value = kv[2];
    if (key === "enabled") {
      const parsed = parseTomlBool(value);
      if (typeof parsed === "boolean") {
        resolved.enabled = parsed;
      }
      continue;
    }
    if (key === "interval_ms") {
      const parsed = parseTomlInt(value);
      if (typeof parsed === "number") {
        resolved.intervalMs = parsed;
      }
      continue;
    }
    if (key === "interval_secs") {
      const parsed = parseTomlInt(value);
      if (typeof parsed === "number") {
        resolved.intervalMs = parsed * 1_000;
      }
      continue;
    }
    if (key === "tasks_dir") {
      const parsed = parseTomlString(value);
      if (parsed) {
        resolved.tasksDir = parsed;
      }
      continue;
    }
    if (key === "done_dir") {
      const parsed = parseTomlString(value);
      if (parsed) {
        resolved.doneDir = parsed;
      }
      continue;
    }
    if (key === "log_path") {
      const parsed = parseTomlString(value);
      if (parsed) {
        resolved.logPath = parsed;
      }
      continue;
    }
    if (key === "default_max_delay_hours") {
      const parsed = parseTomlInt(value);
      if (typeof parsed === "number") {
        resolved.defaultMaxDelayHours = parsed;
      }
    }
  }
  return resolved;
}

function clampInt(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  const normalized = Math.floor(value);
  return Math.min(maximum, Math.max(minimum, normalized));
}

function formatDateToken(input: Date): string {
  const year = input.getFullYear();
  const month = String(input.getMonth() + 1).padStart(2, "0");
  const day = String(input.getDate()).padStart(2, "0");
  const hour = String(input.getHours()).padStart(2, "0");
  const minute = String(input.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}_${hour}${minute}`;
}

function parseDateToken(raw: string): Date | undefined {
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$/);
  if (!match) {
    return undefined;
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);
  if (![year, month, day, hour, minute].every((value) => Number.isFinite(value))) {
    return undefined;
  }
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function escapeRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseScheduleMinutes(raw: string): number | undefined {
  const match = raw.trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return undefined;
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return undefined;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return undefined;
  }
  return hour * 60 + minute;
}

function parseRepeatCooldown(rawRepeat: string): number {
  const repeat = rawRepeat.trim().toLowerCase();
  if (repeat === "once") {
    return 9_999 * 24 * 60 * 60 * 1_000;
  }
  if (repeat === "daily" || repeat === "weekday") {
    return 20 * 60 * 60 * 1_000;
  }
  if (repeat === "weekly") {
    return 6 * 24 * 60 * 60 * 1_000;
  }
  if (repeat === "monthly") {
    return 27 * 24 * 60 * 60 * 1_000;
  }
  const custom = repeat.match(/^every_(\d+)([hd])$/);
  if (custom) {
    const value = Number.parseInt(custom[1], 10);
    const unit = custom[2];
    if (Number.isFinite(value) && value > 0) {
      if (unit === "h") {
        return value * 60 * 60 * 1_000;
      }
      if (unit === "d") {
        return value * 24 * 60 * 60 * 1_000;
      }
    }
  }
  return 20 * 60 * 60 * 1_000;
}

function appendSchedulerLog(logPath: string, level: "info" | "warn" | "error", message: string): void {
  const dir = resolve(logPath, "..");
  mkdirSync(dir, { recursive: true });
  const line = `${nowIso()} ${level.toUpperCase()} ${message}\n`;
  let previous = "";
  if (existsSync(logPath)) {
    try {
      previous = readFileSync(logPath, "utf8");
    } catch {
      previous = "";
    }
  }
  writeFileSync(logPath, `${previous}${line}`, "utf8");
}

function buildTaskPrompt(taskId: string, prompt: string, reportPath: string): string {
  return [
    `[Scheduled Task] ${taskId}`,
    `[Report Path] ${reportPath}`,
    "",
    "Read scheduled_task_sop first, then run this task:",
    "",
    prompt,
    "",
    `Write the execution report to ${reportPath}.`,
  ].join("\n");
}

function normalizeTaskConfig(raw: SchedulerTaskFile, defaultMaxDelayHours: number): SchedulerTaskConfig {
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : false;
  const repeat = typeof raw.repeat === "string" && raw.repeat.trim().length > 0 ? raw.repeat.trim() : "daily";
  const schedule = typeof raw.schedule === "string" && raw.schedule.trim().length > 0 ? raw.schedule.trim() : "00:00";
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  const maxDelayHours = typeof raw.max_delay_hours === "number" && Number.isFinite(raw.max_delay_hours)
    ? clampInt(raw.max_delay_hours, 1, 24)
    : defaultMaxDelayHours;
  return {
    enabled,
    repeat,
    schedule,
    prompt,
    maxDelayHours,
  };
}

function getLastRunAt(doneDir: string, taskId: string): Date | undefined {
  if (!existsSync(doneDir)) {
    return undefined;
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(doneDir);
  } catch {
    return undefined;
  }
  const matcher = new RegExp(`^(\\d{4}-\\d{2}-\\d{2}_\\d{4})_${escapeRegex(taskId)}\\.md$`);
  let latest: Date | undefined;
  for (const entry of entries) {
    const match = entry.match(matcher);
    if (!match || typeof match[1] !== "string") {
      continue;
    }
    const parsed = parseDateToken(match[1]);
    if (!parsed) {
      continue;
    }
    if (!latest || parsed.getTime() > latest.getTime()) {
      latest = parsed;
    }
  }
  return latest;
}

export function resolveExperienceSchedulerConfig(input: ResolveExperienceSchedulerConfigInput): ExperienceSchedulerConfig {
  const defaults: ExperienceSchedulerConfig = {
    enabled: false,
    intervalMs: 120_000,
    tasksDir: `${removeTrailingSlashes(input.workDir)}/.grobot/scheduler/tasks`,
    doneDir: `${removeTrailingSlashes(input.workDir)}/.grobot/scheduler/done`,
    logPath: `${removeTrailingSlashes(input.workDir)}/.grobot/scheduler/scheduler.log`,
    defaultMaxDelayHours: 6,
  };
  const fromProject = parseProjectSchedulerConfig(input.projectTomlPath);
  const merged: ExperienceSchedulerConfig = {
    enabled: typeof fromProject.enabled === "boolean" ? fromProject.enabled : defaults.enabled,
    intervalMs: clampInt(
      typeof fromProject.intervalMs === "number" ? fromProject.intervalMs : defaults.intervalMs,
      10_000,
      86_400_000,
    ),
    tasksDir: normalizeSchedulerPath(fromProject.tasksDir ?? defaults.tasksDir, input.workDir),
    doneDir: normalizeSchedulerPath(fromProject.doneDir ?? defaults.doneDir, input.workDir),
    logPath: normalizeSchedulerPath(fromProject.logPath ?? defaults.logPath, input.workDir),
    defaultMaxDelayHours: clampInt(
      typeof fromProject.defaultMaxDelayHours === "number"
        ? fromProject.defaultMaxDelayHours
        : defaults.defaultMaxDelayHours,
      1,
      24,
    ),
  };
  const envEnabled = parseEnvBool(process.env.GROBOT_EXPERIENCE_SCHEDULER_ENABLED);
  if (typeof envEnabled === "boolean") {
    merged.enabled = envEnabled;
  }
  const envIntervalMs = parseEnvInt(process.env.GROBOT_EXPERIENCE_SCHEDULER_INTERVAL_MS);
  if (typeof envIntervalMs === "number") {
    merged.intervalMs = clampInt(envIntervalMs, 10_000, 86_400_000);
  }
  const envTasksDir = process.env.GROBOT_EXPERIENCE_SCHEDULER_TASKS_DIR;
  if (typeof envTasksDir === "string" && envTasksDir.trim().length > 0) {
    merged.tasksDir = normalizeSchedulerPath(envTasksDir, input.workDir);
  }
  const envDoneDir = process.env.GROBOT_EXPERIENCE_SCHEDULER_DONE_DIR;
  if (typeof envDoneDir === "string" && envDoneDir.trim().length > 0) {
    merged.doneDir = normalizeSchedulerPath(envDoneDir, input.workDir);
  }
  const envLogPath = process.env.GROBOT_EXPERIENCE_SCHEDULER_LOG_PATH;
  if (typeof envLogPath === "string" && envLogPath.trim().length > 0) {
    merged.logPath = normalizeSchedulerPath(envLogPath, input.workDir);
  }
  const envDefaultMaxDelayHours = parseEnvInt(process.env.GROBOT_EXPERIENCE_SCHEDULER_DEFAULT_MAX_DELAY_HOURS);
  if (typeof envDefaultMaxDelayHours === "number") {
    merged.defaultMaxDelayHours = clampInt(envDefaultMaxDelayHours, 1, 24);
  }
  return merged;
}

export function createExperienceSchedulerRuntime(
  config: ExperienceSchedulerConfig,
): ExperienceSchedulerRuntime {
  const tick = (now = new Date()): ExperienceSchedulerTickResult => {
    const result: ExperienceSchedulerTickResult = {
      checked: 0,
      skipped: 0,
      triggered: [],
      errors: [],
    };
    if (!config.enabled) {
      return result;
    }
    if (!existsSync(config.tasksDir)) {
      return result;
    }
    mkdirSync(config.doneDir, { recursive: true });
    let entries: string[] = [];
    try {
      entries = readdirSync(config.tasksDir)
        .filter((entry) => entry.endsWith(".json"))
        .sort((left, right) => left.localeCompare(right));
    } catch (error) {
      const message = `scheduler read tasks dir failed: ${String(error)}`;
      result.errors.push(message);
      appendSchedulerLog(config.logPath, "error", message);
      return result;
    }
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    for (const entry of entries) {
      result.checked += 1;
      const taskId = entry.slice(0, -5);
      const taskPath = `${removeTrailingSlashes(config.tasksDir)}/${entry}`;
      let rawTask = "";
      try {
        rawTask = readFileSync(taskPath, "utf8");
      } catch (error) {
        const message = `task=${taskId} read_error=${String(error)}`;
        result.errors.push(message);
        appendSchedulerLog(config.logPath, "error", message);
        continue;
      }
      let parsedTask: SchedulerTaskFile;
      try {
        parsedTask = JSON.parse(rawTask) as SchedulerTaskFile;
      } catch (error) {
        const message = `task=${taskId} json_parse_error=${String(error)}`;
        result.errors.push(message);
        appendSchedulerLog(config.logPath, "error", message);
        continue;
      }
      const normalized = normalizeTaskConfig(parsedTask, config.defaultMaxDelayHours);
      if (!normalized.enabled) {
        result.skipped += 1;
        continue;
      }
      if (!normalized.prompt) {
        result.skipped += 1;
        appendSchedulerLog(config.logPath, "warn", `task=${taskId} skipped reason=empty_prompt`);
        continue;
      }
      const schedMinutes = parseScheduleMinutes(normalized.schedule);
      if (typeof schedMinutes !== "number") {
        result.skipped += 1;
        const message = `task=${taskId} invalid_schedule=${normalized.schedule}`;
        result.errors.push(message);
        appendSchedulerLog(config.logPath, "error", message);
        continue;
      }
      const repeat = normalized.repeat.trim().toLowerCase();
      if (repeat === "weekday" && now.getDay() >= 6) {
        result.skipped += 1;
        continue;
      }
      if (nowMinutes < schedMinutes) {
        result.skipped += 1;
        continue;
      }
      if (nowMinutes - schedMinutes > normalized.maxDelayHours * 60) {
        result.skipped += 1;
        appendSchedulerLog(
          config.logPath,
          "info",
          `task=${taskId} skipped reason=max_delay_exceeded schedule=${normalized.schedule} max_delay_hours=${String(normalized.maxDelayHours)}`,
        );
        continue;
      }
      const lastRunAt = getLastRunAt(config.doneDir, taskId);
      const cooldownMs = parseRepeatCooldown(repeat);
      if (lastRunAt && now.getTime() - lastRunAt.getTime() < cooldownMs) {
        result.skipped += 1;
        continue;
      }
      const reportPath = `${removeTrailingSlashes(config.doneDir)}/${formatDateToken(now)}_${taskId}.md`;
      const prompt = buildTaskPrompt(taskId, normalized.prompt, reportPath);
      result.triggered.push({
        taskId,
        taskPath,
        repeat: normalized.repeat,
        schedule: normalized.schedule,
        prompt,
        reportPath,
      });
      appendSchedulerLog(
        config.logPath,
        "info",
        `task=${taskId} trigger repeat=${normalized.repeat} schedule=${normalized.schedule} report=${reportPath}`,
      );
    }
    return result;
  };

  const writeDoneReport = (trigger: ExperienceSchedulerTrigger, report: ExperienceSchedulerExecutionReport): void => {
    const finishedAt = report.finishedAt?.trim() || nowIso();
    const lines = [
      `# Scheduled Task Report`,
      ``,
      `- task_id: ${trigger.taskId}`,
      `- status: ${report.status}`,
      `- exit_code: ${String(report.exitCode)}`,
      `- repeat: ${trigger.repeat}`,
      `- schedule: ${trigger.schedule}`,
      `- finished_at: ${finishedAt}`,
      report.reason ? `- reason: ${report.reason}` : undefined,
      ``,
      `## Prompt`,
      ``,
      "```text",
      trigger.prompt,
      "```",
      "",
    ].filter((line): line is string => typeof line === "string");
    mkdirSync(resolve(trigger.reportPath, ".."), { recursive: true });
    writeFileSync(trigger.reportPath, `${lines.join("\n")}\n`, "utf8");
  };

  return {
    getConfig: () => ({ ...config }),
    tick,
    writeDoneReport,
  };
}
