import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

function parseArgs(argv) {
  const command = argv[0] ?? "";
  if (!command) {
    throw new Error("missing command");
  }
  const options = new Map();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`unknown argument: ${token}`);
    }
    const value = argv[index + 1] ?? "";
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    options.set(token.slice(2), value);
    index += 1;
  }
  return { command, options };
}

function requireOption(options, key) {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

async function runRepoCommand(repoRoot, argv, env = {}, timeoutMs = 120_000) {
  const child = spawn(argv[0], argv.slice(1), {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({
        exit_code: code ?? 1,
        signal_code: signal ?? null,
        stdout,
        stderr,
      });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({
        exit_code: 1,
        signal_code: null,
        stdout,
        stderr: `${stderr}${String(error)}`,
      });
    });
  });
}

async function runConfigControlsRejectFlow(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const bind = requireOption(options, "bind");
  const commonArgs = [
    "./grobot",
    "serve",
    "--work-dir",
    workDir,
    "--gateway-impl",
    "ts",
    "--ts-dev-cli",
    "--runtime-impl",
    "rust",
    "--bind",
    bind,
  ];
  const makeConfigTomlCase = async (suffix, configTomlLines) => {
    const caseRoot = `${workDir}/config-controls-${suffix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 100000).toString(36)}`;
    mkdirSync(caseRoot, { recursive: true });
    const configPath = `${caseRoot}/config.toml`;
    writeFileSync(
      configPath,
      [
        "[management]",
        ...configTomlLines,
        "",
      ].join("\n"),
      "utf8",
    );
    return await runRepoCommand(repoRoot, [
      ...commonArgs,
      "--config",
      configPath,
    ]);
  };
  const invalidConfigReadPolicy = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--config-read-policy",
    "open",
  ]);
  const missingConfigReadPolicy = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--config-read-policy",
  ]);
  const invalidSessionStore = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--session-store",
    "postgres",
  ]);
  const invalidRedisFallback = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--session-store",
    "redis",
    "--allow-redis-fallback",
    "maybe",
  ]);
  const invalidRedisUrl = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--session-store",
    "redis",
    "--redis-url",
    "http://127.0.0.1:6379",
  ]);
  const invalidEnvSessionStore = await runRepoCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_SESSION_STORE: "sqlite",
    },
  );
  const invalidEnvConfigReadPolicy = await runRepoCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_CONFIG_READ_POLICY: "open",
    },
  );
  const invalidConfigPolicyTrailing = await makeConfigTomlCase(
    "config-policy-trailing",
    ['config_read_policy = "auto" trailing'],
  );
  const invalidExperiencePublishMode = await runRepoCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_EXPERIENCE_PUBLISH_MODE: "always",
    },
  );
  const invalidExperienceRecallLimit = await runRepoCommand(
    repoRoot,
    commonArgs,
    {
      GROBOT_EXPERIENCE_RECALL_LIMIT: "7",
    },
  );
  const combinedOutput = [
    invalidConfigReadPolicy.stdout,
    invalidConfigReadPolicy.stderr,
    missingConfigReadPolicy.stdout,
    missingConfigReadPolicy.stderr,
    invalidSessionStore.stdout,
    invalidSessionStore.stderr,
    invalidRedisFallback.stdout,
    invalidRedisFallback.stderr,
    invalidRedisUrl.stdout,
    invalidRedisUrl.stderr,
    invalidEnvSessionStore.stdout,
    invalidEnvSessionStore.stderr,
    invalidEnvConfigReadPolicy.stdout,
    invalidEnvConfigReadPolicy.stderr,
    invalidConfigPolicyTrailing.stdout,
    invalidConfigPolicyTrailing.stderr,
    invalidExperiencePublishMode.stdout,
    invalidExperiencePublishMode.stderr,
    invalidExperienceRecallLimit.stdout,
    invalidExperienceRecallLimit.stderr,
  ].join("\n");
  return {
    invalid_config_policy_exit_code: invalidConfigReadPolicy.exit_code,
    invalid_config_policy_has_stable_error:
      invalidConfigReadPolicy.stderr.includes("error: invalid_config_read_policy:")
      && invalidConfigReadPolicy.stderr.includes("config-read-policy must be auto, public, auth, or disabled"),
    missing_config_policy_exit_code: missingConfigReadPolicy.exit_code,
    missing_config_policy_has_stable_error:
      missingConfigReadPolicy.stderr.includes("error: invalid_config_read_policy:")
      && missingConfigReadPolicy.stderr.includes("config-read-policy must be auto, public, auth, or disabled"),
    invalid_session_store_exit_code: invalidSessionStore.exit_code,
    invalid_session_store_has_stable_error:
      invalidSessionStore.stderr.includes("error: invalid_session_store:")
      && invalidSessionStore.stderr.includes("session-store must be file, redis, or auto"),
    invalid_redis_fallback_exit_code: invalidRedisFallback.exit_code,
    invalid_redis_fallback_has_stable_error:
      invalidRedisFallback.stderr.includes("error: invalid_allow_redis_fallback:")
      && invalidRedisFallback.stderr.includes("allow-redis-fallback must be boolean"),
    invalid_redis_url_exit_code: invalidRedisUrl.exit_code,
    invalid_redis_url_has_stable_error:
      invalidRedisUrl.stderr.includes("error: invalid_redis_url:")
      && invalidRedisUrl.stderr.includes("redis-url must be a redis:// or rediss:// URL"),
    invalid_env_session_store_exit_code: invalidEnvSessionStore.exit_code,
    invalid_env_session_store_has_stable_error:
      invalidEnvSessionStore.stderr.includes("error: invalid_session_store:")
      && invalidEnvSessionStore.stderr.includes("session-store must be file, redis, or auto"),
    invalid_env_config_policy_exit_code: invalidEnvConfigReadPolicy.exit_code,
    invalid_env_config_policy_has_stable_error:
      invalidEnvConfigReadPolicy.stderr.includes("error: invalid_config_read_policy:")
      && invalidEnvConfigReadPolicy.stderr.includes("config-read-policy must be auto, public, auth, or disabled"),
    invalid_config_policy_trailing_exit_code: invalidConfigPolicyTrailing.exit_code,
    invalid_config_policy_trailing_has_stable_error:
      invalidConfigPolicyTrailing.stderr.includes("error: invalid_config_read_policy:")
      && invalidConfigPolicyTrailing.stderr.includes("config-read-policy must be auto, public, auth, or disabled"),
    invalid_experience_publish_mode_exit_code: invalidExperiencePublishMode.exit_code,
    invalid_experience_publish_mode_has_stable_error:
      invalidExperiencePublishMode.stderr.includes("error: invalid_experience_publish_mode:")
      && invalidExperiencePublishMode.stderr.includes("experience-publish-mode must be auto or off"),
    invalid_experience_recall_limit_exit_code: invalidExperienceRecallLimit.exit_code,
    invalid_experience_recall_limit_has_stable_error:
      invalidExperienceRecallLimit.stderr.includes("error: invalid_experience_recall_limit:")
      && invalidExperienceRecallLimit.stderr.includes("experience-recall-limit must be an integer between 1 and 6"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    ready_not_reached:
      !combinedOutput.includes("Management server listening")
      && !combinedOutput.includes("/api/v1/status"),
  };
}

async function runCli(argv) {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "config-controls-reject-flow": {
      const payload = await runConfigControlsRejectFlow(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
if (entryScript.includes("management-config-contract.mjs")) {
  runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`management-config-contract fatal: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
