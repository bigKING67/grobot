import { mkdirSync, writeFileSync } from "node:fs";

function writeSchedulerProjectToml(workDir, lines) {
  const grobotDir = `${workDir}/.grobot`;
  mkdirSync(grobotDir, { recursive: true });
  writeFileSync(
    `${grobotDir}/project.toml`,
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
}

export function runStartInvalidExperienceSchedulerControlsRejectFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    hasStartBannerMarker,
  } = context;

  const makeCase = (suffix, options = {}) => {
    const workDir = createTempDir(`grobot-start-invalid-experience-scheduler-${suffix}`);
    if (Array.isArray(options.projectTomlLines)) {
      writeSchedulerProjectToml(workDir, options.projectTomlLines);
    }
    const config = writeConfig(buildSmokeConfig(workDir));
    return runCommand(
      repoRoot,
      [
        "./grobot",
        "start",
        "--project",
        "grobot",
        "--work-dir",
        workDir,
        "--config",
        config.configPath,
        "--gateway-impl",
        "ts",
        "--runtime-impl",
        "rust",
        "--session-subject",
        `start-invalid-experience-scheduler-${suffix}-user`,
        "--message",
        "invalid experience scheduler config should not reach runtime",
      ],
      options.env,
    );
  };

  const invalidEnvBooleanResult = makeCase(
    "env-boolean",
    { env: { GROBOT_EXPERIENCE_SCHEDULER_ENABLED: "maybe" } },
  );
  const invalidEnvIntervalSyntaxResult = makeCase(
    "env-interval-syntax",
    { env: { GROBOT_EXPERIENCE_SCHEDULER_INTERVAL_MS: "10000ms" } },
  );
  const invalidEnvIntervalRangeResult = makeCase(
    "env-interval-range",
    { env: { GROBOT_EXPERIENCE_SCHEDULER_INTERVAL_MS: "9999" } },
  );
  const invalidEnvTasksDirResult = makeCase(
    "env-tasks-dir",
    { env: { GROBOT_EXPERIENCE_SCHEDULER_TASKS_DIR: "   " } },
  );
  const invalidEnvDefaultDelayResult = makeCase(
    "env-default-delay",
    { env: { GROBOT_EXPERIENCE_SCHEDULER_DEFAULT_MAX_DELAY_HOURS: "25" } },
  );
  const invalidTomlBooleanResult = makeCase(
    "toml-boolean",
    { projectTomlLines: ["enabled = maybe"] },
  );
  const invalidTomlIntervalResult = makeCase(
    "toml-interval",
    { projectTomlLines: ["interval_ms = 0"] },
  );
  const invalidTomlIntervalSecsResult = makeCase(
    "toml-interval-secs",
    { projectTomlLines: ["interval_secs = 9"] },
  );
  const invalidTomlPathResult = makeCase(
    "toml-path",
    { projectTomlLines: ['log_path = ""'] },
  );
  const invalidTomlDefaultDelayResult = makeCase(
    "toml-default-delay",
    { projectTomlLines: ["default_max_delay_hours = 0"] },
  );
  const validBoundaryResult = makeCase(
    "valid-boundary",
    {
      env: {
        GROBOT_EXPERIENCE_SCHEDULER_ENABLED: "off",
        GROBOT_EXPERIENCE_SCHEDULER_INTERVAL_MS: "10000",
        GROBOT_EXPERIENCE_SCHEDULER_TASKS_DIR: ".grobot/scheduler/tasks",
        GROBOT_EXPERIENCE_SCHEDULER_DONE_DIR: ".grobot/scheduler/done",
        GROBOT_EXPERIENCE_SCHEDULER_LOG_PATH: ".grobot/scheduler/scheduler.log",
        GROBOT_EXPERIENCE_SCHEDULER_DEFAULT_MAX_DELAY_HOURS: "24",
      },
    },
  );
  const combinedOutput = [
    invalidEnvBooleanResult.stdout,
    invalidEnvBooleanResult.stderr,
    invalidEnvIntervalSyntaxResult.stdout,
    invalidEnvIntervalSyntaxResult.stderr,
    invalidEnvIntervalRangeResult.stdout,
    invalidEnvIntervalRangeResult.stderr,
    invalidEnvTasksDirResult.stdout,
    invalidEnvTasksDirResult.stderr,
    invalidEnvDefaultDelayResult.stdout,
    invalidEnvDefaultDelayResult.stderr,
    invalidTomlBooleanResult.stdout,
    invalidTomlBooleanResult.stderr,
    invalidTomlIntervalResult.stdout,
    invalidTomlIntervalResult.stderr,
    invalidTomlIntervalSecsResult.stdout,
    invalidTomlIntervalSecsResult.stderr,
    invalidTomlPathResult.stdout,
    invalidTomlPathResult.stderr,
    invalidTomlDefaultDelayResult.stdout,
    invalidTomlDefaultDelayResult.stderr,
  ].join("\n");
  return {
    invalid_env_boolean_exit_code: invalidEnvBooleanResult.exit_code,
    invalid_env_boolean_has_stable_error:
      invalidEnvBooleanResult.stderr.includes("error: invalid_experience_scheduler_enabled:")
      && invalidEnvBooleanResult.stderr.includes("experience-scheduler-enabled must be boolean")
      && invalidEnvBooleanResult.stderr.includes("source=env:GROBOT_EXPERIENCE_SCHEDULER_ENABLED"),
    invalid_env_interval_syntax_exit_code: invalidEnvIntervalSyntaxResult.exit_code,
    invalid_env_interval_syntax_has_stable_error:
      invalidEnvIntervalSyntaxResult.stderr.includes("error: invalid_experience_scheduler_interval_ms:")
      && invalidEnvIntervalSyntaxResult.stderr.includes("experience-scheduler-interval-ms must be an integer between 10000 and 86400000")
      && invalidEnvIntervalSyntaxResult.stderr.includes("source=env:GROBOT_EXPERIENCE_SCHEDULER_INTERVAL_MS"),
    invalid_env_interval_range_exit_code: invalidEnvIntervalRangeResult.exit_code,
    invalid_env_interval_range_has_stable_error:
      invalidEnvIntervalRangeResult.stderr.includes("error: invalid_experience_scheduler_interval_ms:")
      && invalidEnvIntervalRangeResult.stderr.includes("experience-scheduler-interval-ms must be an integer between 10000 and 86400000"),
    invalid_env_tasks_dir_exit_code: invalidEnvTasksDirResult.exit_code,
    invalid_env_tasks_dir_has_stable_error:
      invalidEnvTasksDirResult.stderr.includes("error: invalid_experience_scheduler_tasks_dir:")
      && invalidEnvTasksDirResult.stderr.includes("experience-scheduler-tasks-dir must not be empty"),
    invalid_env_default_delay_exit_code: invalidEnvDefaultDelayResult.exit_code,
    invalid_env_default_delay_has_stable_error:
      invalidEnvDefaultDelayResult.stderr.includes("error: invalid_experience_scheduler_default_max_delay_hours:")
      && invalidEnvDefaultDelayResult.stderr.includes("experience-scheduler-default-max-delay-hours must be an integer between 1 and 24"),
    invalid_toml_boolean_exit_code: invalidTomlBooleanResult.exit_code,
    invalid_toml_boolean_has_stable_error:
      invalidTomlBooleanResult.stderr.includes("error: invalid_experience_scheduler_enabled:")
      && invalidTomlBooleanResult.stderr.includes("experience-scheduler-enabled must be boolean")
      && invalidTomlBooleanResult.stderr.includes("source=project_toml"),
    invalid_toml_interval_exit_code: invalidTomlIntervalResult.exit_code,
    invalid_toml_interval_has_stable_error:
      invalidTomlIntervalResult.stderr.includes("error: invalid_experience_scheduler_interval_ms:")
      && invalidTomlIntervalResult.stderr.includes("experience-scheduler-interval-ms must be an integer between 10000 and 86400000"),
    invalid_toml_interval_secs_exit_code: invalidTomlIntervalSecsResult.exit_code,
    invalid_toml_interval_secs_has_stable_error:
      invalidTomlIntervalSecsResult.stderr.includes("error: invalid_experience_scheduler_interval_secs:")
      && invalidTomlIntervalSecsResult.stderr.includes("experience-scheduler-interval-secs must be an integer between 10 and 86400"),
    invalid_toml_path_exit_code: invalidTomlPathResult.exit_code,
    invalid_toml_path_has_stable_error:
      invalidTomlPathResult.stderr.includes("error: invalid_experience_scheduler_log_path:")
      && invalidTomlPathResult.stderr.includes("experience-scheduler-log-path must not be empty"),
    invalid_toml_default_delay_exit_code: invalidTomlDefaultDelayResult.exit_code,
    invalid_toml_default_delay_has_stable_error:
      invalidTomlDefaultDelayResult.stderr.includes("error: invalid_experience_scheduler_default_max_delay_hours:")
      && invalidTomlDefaultDelayResult.stderr.includes("experience-scheduler-default-max-delay-hours must be an integer between 1 and 24"),
    valid_boundary_exit_code: validBoundaryResult.exit_code,
    valid_boundary_reached_runtime:
      validBoundaryResult.stderr.includes("Turn failed")
      || validBoundaryResult.stderr.includes("Upstream connection failed"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}
