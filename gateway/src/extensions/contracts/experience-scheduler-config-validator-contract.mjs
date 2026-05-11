import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnTsxSync } from "./_shared/run-tsx-script.mjs";

const ENV_FIXTURES = Object.freeze([
  {
    name: "env-boolean",
    env: { GROBOT_EXPERIENCE_SCHEDULER_ENABLED: "maybe" },
    code: "invalid_experience_scheduler_enabled",
    field: "experience-scheduler-enabled",
    detail: "experience-scheduler-enabled must be boolean",
    source: "env:GROBOT_EXPERIENCE_SCHEDULER_ENABLED",
  },
  {
    name: "env-interval-syntax",
    env: { GROBOT_EXPERIENCE_SCHEDULER_INTERVAL_MS: "10000ms" },
    code: "invalid_experience_scheduler_interval_ms",
    field: "experience-scheduler-interval-ms",
    detail: "experience-scheduler-interval-ms must be an integer between 10000 and 86400000",
    source: "env:GROBOT_EXPERIENCE_SCHEDULER_INTERVAL_MS",
  },
  {
    name: "env-interval-range",
    env: { GROBOT_EXPERIENCE_SCHEDULER_INTERVAL_MS: "9999" },
    code: "invalid_experience_scheduler_interval_ms",
    field: "experience-scheduler-interval-ms",
    detail: "experience-scheduler-interval-ms must be an integer between 10000 and 86400000",
    source: "env:GROBOT_EXPERIENCE_SCHEDULER_INTERVAL_MS",
  },
  {
    name: "env-tasks-dir",
    env: { GROBOT_EXPERIENCE_SCHEDULER_TASKS_DIR: "   " },
    code: "invalid_experience_scheduler_tasks_dir",
    field: "experience-scheduler-tasks-dir",
    detail: "experience-scheduler-tasks-dir must not be empty",
    source: "env:GROBOT_EXPERIENCE_SCHEDULER_TASKS_DIR",
  },
  {
    name: "env-default-delay",
    env: { GROBOT_EXPERIENCE_SCHEDULER_DEFAULT_MAX_DELAY_HOURS: "25" },
    code: "invalid_experience_scheduler_default_max_delay_hours",
    field: "experience-scheduler-default-max-delay-hours",
    detail: "experience-scheduler-default-max-delay-hours must be an integer between 1 and 24",
    source: "env:GROBOT_EXPERIENCE_SCHEDULER_DEFAULT_MAX_DELAY_HOURS",
  },
]);

const TOML_FIXTURES = Object.freeze([
  {
    name: "toml-boolean",
    lines: ["enabled = maybe"],
    code: "invalid_experience_scheduler_enabled",
    field: "experience-scheduler-enabled",
    detail: "experience-scheduler-enabled must be boolean",
  },
  {
    name: "toml-interval",
    lines: ["interval_ms = 0"],
    code: "invalid_experience_scheduler_interval_ms",
    field: "experience-scheduler-interval-ms",
    detail: "experience-scheduler-interval-ms must be an integer between 10000 and 86400000",
  },
  {
    name: "toml-interval-secs",
    lines: ["interval_secs = 9"],
    code: "invalid_experience_scheduler_interval_secs",
    field: "experience-scheduler-interval-secs",
    detail: "experience-scheduler-interval-secs must be an integer between 10 and 86400",
  },
  {
    name: "toml-path",
    lines: ['log_path = ""'],
    code: "invalid_experience_scheduler_log_path",
    field: "experience-scheduler-log-path",
    detail: "experience-scheduler-log-path must not be empty",
  },
  {
    name: "toml-default-delay",
    lines: ["default_max_delay_hours = 0"],
    code: "invalid_experience_scheduler_default_max_delay_hours",
    field: "experience-scheduler-default-max-delay-hours",
    detail: "experience-scheduler-default-max-delay-hours must be an integer between 1 and 24",
  },
]);

function writeProjectToml(root, name, lines = []) {
  const projectTomlPath = resolve(root, `${name}.toml`);
  writeFileSync(
    projectTomlPath,
    [
      "schema_version = 1",
      'mode = "mvp"',
      "",
      "[experience.scheduler]",
      ...lines,
      "",
    ].join("\n"),
    "utf8",
  );
  return projectTomlPath;
}

function runValidatorBatch(repoRoot, fixtures) {
  const script = [
    "const schedulerModule = await import('./gateway/src/cli/services/experience-scheduler-config.ts');",
    "const schedulerConfig = schedulerModule.default ?? schedulerModule;",
    "const { isExperienceSchedulerConfigInputError, resolveExperienceSchedulerConfig } = schedulerConfig;",
    "if (typeof isExperienceSchedulerConfigInputError !== 'function' || typeof resolveExperienceSchedulerConfig !== 'function') {",
    "  throw new Error('experience-scheduler-config.ts must expose production validator functions');",
    "}",
    `const fixtures = ${JSON.stringify(fixtures)};`,
    "const baseEnvKeys = [",
    "  'GROBOT_EXPERIENCE_SCHEDULER_ENABLED',",
    "  'GROBOT_EXPERIENCE_SCHEDULER_INTERVAL_MS',",
    "  'GROBOT_EXPERIENCE_SCHEDULER_TASKS_DIR',",
    "  'GROBOT_EXPERIENCE_SCHEDULER_DONE_DIR',",
    "  'GROBOT_EXPERIENCE_SCHEDULER_LOG_PATH',",
    "  'GROBOT_EXPERIENCE_SCHEDULER_DEFAULT_MAX_DELAY_HOURS',",
    "];",
    "const originalEnv = Object.fromEntries(baseEnvKeys.map((key) => [key, process.env[key]]));",
    "const results = [];",
    "for (const fixture of fixtures) {",
    "  for (const key of baseEnvKeys) delete process.env[key];",
    "  for (const [key, value] of Object.entries(fixture.env ?? {})) process.env[key] = String(value);",
    "  try {",
    "    const config = resolveExperienceSchedulerConfig({ workDir: fixture.workDir, projectTomlPath: fixture.projectTomlPath });",
    "    results.push({ name: fixture.name, status: 'ok', config });",
    "  } catch (error) {",
    "    if (!isExperienceSchedulerConfigInputError(error)) throw error;",
    "    results.push({ name: fixture.name, status: 'error', code: error.code, field: error.field, message: error.message });",
    "  }",
    "}",
    "for (const key of baseEnvKeys) {",
    "  if (originalEnv[key] === undefined) delete process.env[key];",
    "  else process.env[key] = originalEnv[key];",
    "}",
    "console.log(JSON.stringify({ status: 'ok', results }));",
  ].join("\n");
  const completed = spawnTsxSync("-", [], {
    cwd: repoRoot,
    input: script,
  });
  assert.equal(completed.status, 0, `validator failed\nstdout:\n${completed.stdout}\nstderr:\n${completed.stderr}`);
  const tail = String(completed.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  assert.equal(typeof tail, "string", "validator stdout must contain JSON");
  const payload = JSON.parse(tail);
  assert.equal(payload.status, "ok", "validator batch must complete");
  assert.equal(Array.isArray(payload.results), true, "validator batch must return result array");
  return new Map(payload.results.map((result) => [result.name, result]));
}

function assertInvalid(results, fixture, source = "project_toml") {
  const payload = results.get(fixture.name);
  assert.equal(payload.status, "error", fixture.name);
  assert.equal(payload.code, fixture.code, fixture.name);
  assert.equal(payload.field, fixture.field, fixture.name);
  assert.equal(String(payload.message).includes(fixture.detail), true, fixture.name);
  assert.equal(String(payload.message).includes(`source=${source}`), true, fixture.name);
  return payload.code;
}

function main() {
  const repoRoot = process.cwd();
  const root = mkdtempSync(resolve(tmpdir(), "experience-scheduler-config-validator-"));
  try {
    const validProjectTomlPath = writeProjectToml(root, "valid-boundary", [
      "enabled = false",
      "interval_ms = 10000",
      'tasks_dir = ".grobot/scheduler/tasks"',
      'done_dir = ".grobot/scheduler/done"',
      'log_path = ".grobot/scheduler/scheduler.log"',
      "default_max_delay_hours = 24",
    ]);
    const fixtures = [
      ...ENV_FIXTURES.map((fixture) => ({
        name: fixture.name,
        workDir: root,
        projectTomlPath: undefined,
        env: fixture.env,
      })),
      ...TOML_FIXTURES.map((fixture) => ({
        name: fixture.name,
        workDir: root,
        projectTomlPath: writeProjectToml(root, fixture.name, fixture.lines),
      })),
      {
        name: "valid-boundary",
        workDir: root,
        projectTomlPath: validProjectTomlPath,
      },
    ];
    const results = runValidatorBatch(repoRoot, fixtures);
    const rejectedCodes = [
      ...ENV_FIXTURES.map((fixture) => assertInvalid(results, fixture, fixture.source)),
      ...TOML_FIXTURES.map((fixture) => assertInvalid(results, fixture)),
    ];
    const validPayload = results.get("valid-boundary");
    assert.equal(validPayload.status, "ok");
    assert.equal(validPayload.config.enabled, false);
    assert.equal(validPayload.config.intervalMs, 10_000);
    assert.equal(validPayload.config.defaultMaxDelayHours, 24);
    assert.equal(validPayload.config.tasksDir.endsWith("/.grobot/scheduler/tasks"), true);
    assert.equal(validPayload.config.doneDir.endsWith("/.grobot/scheduler/done"), true);
    assert.equal(validPayload.config.logPath.endsWith("/.grobot/scheduler/scheduler.log"), true);
    process.stdout.write(`${JSON.stringify({
      status: "ok",
      rejected_count: rejectedCodes.length,
      unique_error_count: new Set(rejectedCodes).size,
      valid_boundary: true,
    })}\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main();
