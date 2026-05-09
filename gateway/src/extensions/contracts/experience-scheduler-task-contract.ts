import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createExperienceSchedulerRuntime,
  type ExperienceSchedulerConfig,
} from "../../cli/services/experience-scheduler";

const tempRoot = resolve(
  process.cwd(),
  ".grobot",
  "tmp",
  `grobot-exp-scheduler-contract-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
);
mkdirSync(tempRoot, { recursive: true });

function buildConfig(name: string): ExperienceSchedulerConfig {
  const root = resolve(tempRoot, name);
  const tasksDir = resolve(root, "tasks");
  const doneDir = resolve(root, "done");
  mkdirSync(tasksDir, { recursive: true });
  return {
    enabled: true,
    intervalMs: 120_000,
    tasksDir,
    doneDir,
    logPath: resolve(root, "scheduler.log"),
    defaultMaxDelayHours: 6,
  };
}

function writeTask(config: ExperienceSchedulerConfig, taskId: string, payload: unknown): void {
  writeFileSync(
    resolve(config.tasksDir, `${taskId}.json`),
    `${JSON.stringify(payload, undefined, 2)}\n`,
    "utf8",
  );
}

try {
  const validConfig = buildConfig("valid");
  writeTask(validConfig, "valid-task", {
    enabled: true,
    repeat: "daily",
    schedule: "01:00",
    prompt: "Run validated scheduler task.",
    max_delay_hours: 3,
  });
  const validRuntime = createExperienceSchedulerRuntime(validConfig);
  const validTick = validRuntime.tick(new Date(2026, 0, 1, 2, 0, 0, 0));

  const invalidDelayConfig = buildConfig("invalid-delay");
  writeTask(invalidDelayConfig, "zero-delay", {
    enabled: true,
    repeat: "daily",
    schedule: "01:00",
    prompt: "This task must not be clamped into a valid delay.",
    max_delay_hours: 0,
  });
  writeTask(invalidDelayConfig, "fraction-delay", {
    enabled: true,
    repeat: "daily",
    schedule: "01:00",
    prompt: "This task must not be floored into a valid delay.",
    max_delay_hours: 1.5,
  });
  const invalidDelayRuntime = createExperienceSchedulerRuntime(invalidDelayConfig);
  const invalidDelayTick = invalidDelayRuntime.tick(new Date(2026, 0, 1, 2, 0, 0, 0));
  const invalidDelayLog = existsSync(invalidDelayConfig.logPath)
    ? readFileSync(invalidDelayConfig.logPath, "utf8")
    : "";

  const invalidRepeatConfig = buildConfig("invalid-repeat");
  writeTask(invalidRepeatConfig, "typo-repeat", {
    enabled: true,
    repeat: "sometimes",
    schedule: "01:00",
    prompt: "This task must not silently use a daily cooldown.",
  });
  const invalidRepeatRuntime = createExperienceSchedulerRuntime(invalidRepeatConfig);
  const invalidRepeatTick = invalidRepeatRuntime.tick(new Date(2026, 0, 1, 2, 0, 0, 0));
  const invalidRepeatLog = existsSync(invalidRepeatConfig.logPath)
    ? readFileSync(invalidRepeatConfig.logPath, "utf8")
    : "";

  const payload = {
    valid_task_triggered: validTick.triggered.length === 1
      && validTick.triggered[0]?.taskId === "valid-task",
    invalid_delay_tasks_rejected:
      invalidDelayTick.triggered.length === 0
      && invalidDelayTick.errors.length === 2
      && invalidDelayTick.errors.every((item) =>
        item.includes("invalid_experience_scheduler_task_max_delay_hours")
      ),
    invalid_delay_errors_logged:
      invalidDelayLog.includes("invalid_experience_scheduler_task_max_delay_hours")
      && invalidDelayLog.includes("zero-delay")
      && invalidDelayLog.includes("fraction-delay"),
    invalid_repeat_task_rejected:
      invalidRepeatTick.triggered.length === 0
      && invalidRepeatTick.skipped === 1
      && invalidRepeatTick.errors.length === 1
      && invalidRepeatTick.errors[0]?.includes("invalid_experience_scheduler_task_repeat"),
    invalid_repeat_error_logged:
      invalidRepeatLog.includes("invalid_experience_scheduler_task_repeat")
      && invalidRepeatLog.includes("typo-repeat"),
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
