import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { removeTrailingSlashes } from "./runtime-paths";
export {
  type ExperienceSchedulerConfig,
} from "./experience-scheduler-config";
import { type ExperienceSchedulerConfig } from "./experience-scheduler-config";

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

function nowIso(): string {
  return new Date().toISOString();
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
  throw new RangeError("invalid_experience_scheduler_task_repeat: repeat must be daily, weekday, weekly, monthly, once, every_<n>h, or every_<n>d");
}

function resolveTaskMaxDelayHours(raw: unknown, defaultMaxDelayHours: number): number {
  if (raw === undefined) {
    return defaultMaxDelayHours;
  }
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 1 || raw > 24) {
    throw new RangeError("invalid_experience_scheduler_task_max_delay_hours: max_delay_hours must be an integer between 1 and 24");
  }
  return raw;
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
  const maxDelayHours = resolveTaskMaxDelayHours(raw.max_delay_hours, defaultMaxDelayHours);
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
      let normalized: SchedulerTaskConfig;
      try {
        normalized = normalizeTaskConfig(parsedTask, config.defaultMaxDelayHours);
      } catch (error) {
        const message = `task=${taskId} config_error=${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(message);
        appendSchedulerLog(config.logPath, "error", message);
        continue;
      }
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
      let cooldownMs: number;
      try {
        cooldownMs = parseRepeatCooldown(repeat);
      } catch (error) {
        result.skipped += 1;
        const message = `task=${taskId} config_error=${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(message);
        appendSchedulerLog(config.logPath, "error", message);
        continue;
      }
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
