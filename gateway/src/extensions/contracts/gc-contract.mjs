import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

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

function createTempDir(prefix) {
  return mkdtempSync(resolve(tmpdir(), `${prefix}-`));
}

async function runRepoCommand(repoRoot, argv, env = {}, timeoutMs = 120_000) {
  const child = spawn(argv[0], argv.slice(1), {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
      GROBOT_ALLOW_TS_DEV_CLI: "1",
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
  return await new Promise((resolveResult) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveResult({
        exit_code: code ?? 1,
        signal_code: signal ?? null,
        stdout,
        stderr,
      });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolveResult({
        exit_code: 1,
        signal_code: null,
        stdout,
        stderr: `${stderr}${String(error)}`,
      });
    });
  });
}

function hasStableTextError(result, code, detailPart) {
  return result.stderr.includes(`error: ${code}:`)
    && result.stderr.includes(detailPart);
}

function hasStableJsonError(result, code, field) {
  try {
    const payload = JSON.parse(result.stdout);
    return payload?.status === "error"
      && payload?.error === code
      && payload?.field === field
      && typeof payload?.detail === "string";
  } catch {
    return false;
  }
}

async function runGcInputValidation(options) {
  const args = createGcValidationArgs(options);
  const cliValidation = await runGcCliInputValidationFromArgs(args);
  const envValidation = await runGcEnvInputValidationFromArgs(args);
  const tomlValidation = await runGcTomlInputValidationFromArgs(args);
  return {
    ...cliValidation,
    ...envValidation,
    ...tomlValidation,
    hides_top_level_fatal:
      cliValidation.hides_top_level_fatal
      && envValidation.hides_top_level_fatal
      && tomlValidation.hides_top_level_fatal,
    invalid_inputs_do_not_emit_gc_summary:
      cliValidation.invalid_inputs_do_not_emit_gc_summary
      && envValidation.invalid_inputs_do_not_emit_gc_summary
      && tomlValidation.invalid_inputs_do_not_emit_gc_summary,
  };
}

function createGcValidationArgs(options) {
  const repoRoot = requireOption(options, "repo-root");
  const homeDir = createTempDir("grobot-gc-home");
  const workDir = createTempDir("grobot-gc-work");
  const configDir = resolve(workDir, ".grobot");
  const invalidConfig = resolve(configDir, "config.toml");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    invalidConfig,
    [
      "[storage.cleanup]",
      "retention_days = \"soon\"",
      "keep_recent_sessions = 40",
      "keep_recent_plans_per_session = 12",
      "",
    ].join("\n"),
    "utf8",
  );

  const commonArgs = [
    "./grobot",
    "gc",
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
    "--ts-dev-cli",
    "--home",
    homeDir,
    "--work-dir",
    workDir,
  ];
  const validConfig = resolve(repoRoot, "packages/templates/config.toml.example");
  return {
    commonArgs,
    repoRoot,
    validConfig,
  };
}

function outputText(...results) {
  return results.flatMap((result) => [result.stdout, result.stderr]).join("\n");
}

function gcPayloadFooter(combinedOutput, invalidResults) {
  return {
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    invalid_inputs_do_not_emit_gc_summary: invalidResults.every(
      (result) => !result.stdout.includes("[gc] totals"),
    ),
  };
}

async function runGcCliInputValidation(options) {
  return await runGcCliInputValidationFromArgs(createGcValidationArgs(options));
}

async function runGcCliInputValidationFromArgs(args) {
  const { commonArgs, repoRoot, validConfig } = args;
  const invalidRetention = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--config",
    validConfig,
    "--retention-days",
    "nope",
  ]);
  const zeroRetention = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--config",
    validConfig,
    "--retention-days",
    "0",
    "--json",
  ]);
  const overSessions = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--config",
    validConfig,
    "--keep-recent-sessions",
    "2001",
  ]);
  const missingPlans = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--config",
    validConfig,
    "--keep-recent-plans-per-session",
  ]);
  const invalidScope = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--config",
    validConfig,
    "--scope",
    "workspace",
  ]);
  const combinedOutput = outputText(
    invalidRetention,
    zeroRetention,
    overSessions,
    missingPlans,
    invalidScope,
  );
  return {
    invalid_retention_exit_code: invalidRetention.exit_code,
    invalid_retention_has_stable_error: hasStableTextError(
      invalidRetention,
      "invalid_retention_days",
      "retention-days must be an integer between 1 and 3650",
    ),
    zero_retention_exit_code: zeroRetention.exit_code,
    zero_retention_has_json_error: hasStableJsonError(
      zeroRetention,
      "invalid_retention_days",
      "retention-days",
    ),
    over_sessions_exit_code: overSessions.exit_code,
    over_sessions_has_stable_error: hasStableTextError(
      overSessions,
      "invalid_keep_recent_sessions",
      "keep-recent-sessions must be an integer between 1 and 2000",
    ),
    missing_plans_exit_code: missingPlans.exit_code,
    missing_plans_has_stable_error: hasStableTextError(
      missingPlans,
      "invalid_keep_recent_plans_per_session",
      "keep-recent-plans-per-session must be an integer between 1 and 500",
    ),
    invalid_scope_exit_code: invalidScope.exit_code,
    invalid_scope_has_stable_error: hasStableTextError(
      invalidScope,
      "invalid_scope",
      "scope must be global, project, all",
    ),
    ...gcPayloadFooter(combinedOutput, [
      invalidRetention,
      zeroRetention,
      overSessions,
      missingPlans,
      invalidScope,
    ]),
  };
}

async function runGcEnvInputValidation(options) {
  return await runGcEnvInputValidationFromArgs(createGcValidationArgs(options));
}

async function runGcEnvInputValidationFromArgs(args) {
  const { commonArgs, repoRoot, validConfig } = args;
  const emptyCliCacheRoot = await runRepoCommand(
    repoRoot,
    [
      ...commonArgs,
      "--config",
      validConfig,
      "--scope",
      "global",
    ],
    {
      GROBOT_TS_DEV_CLI_CACHE_ROOT: "   ",
    },
  );
  const emptyGroupCacheRoot = await runRepoCommand(
    repoRoot,
    [
      ...commonArgs,
      "--config",
      validConfig,
      "--scope",
      "global",
    ],
    {
      GROBOT_TS_DEV_CACHE_ROOT: "",
    },
  );
  const combinedOutput = outputText(emptyCliCacheRoot, emptyGroupCacheRoot);
  const payload = {
    empty_cli_cache_root_exit_code: emptyCliCacheRoot.exit_code,
    empty_cli_cache_root_has_stable_error: hasStableTextError(
      emptyCliCacheRoot,
      "invalid_ts_dev_cli_cache_root",
      "ts-dev-cli-cache-root must be a non-empty path",
    ),
    empty_group_cache_root_exit_code: emptyGroupCacheRoot.exit_code,
    empty_group_cache_root_has_stable_error: hasStableTextError(
      emptyGroupCacheRoot,
      "invalid_ts_dev_cache_root",
      "ts-dev-cache-root must be a non-empty path",
    ),
    ...gcPayloadFooter(combinedOutput, [emptyCliCacheRoot, emptyGroupCacheRoot]),
  };
  if (
    payload.empty_cli_cache_root_exit_code !== 2
    || payload.empty_cli_cache_root_has_stable_error !== true
    || payload.empty_group_cache_root_exit_code !== 2
    || payload.empty_group_cache_root_has_stable_error !== true
  ) {
    throw new Error("empty gc cache root env controls must fail closed");
  }
  return payload;
}

async function runGcTomlInputValidation(options) {
  return await runGcTomlInputValidationFromArgs(createGcValidationArgs(options));
}

async function runGcTomlInputValidationFromArgs(args) {
  const { commonArgs, repoRoot, validConfig } = args;
  const invalidToml = await runRepoCommand(repoRoot, commonArgs);
  const validDefault = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--config",
    validConfig,
    "--json",
  ]);
  let validPayload = {};
  try {
    validPayload = JSON.parse(validDefault.stdout);
  } catch {
    validPayload = {};
  }

  return {
    invalid_toml_exit_code: invalidToml.exit_code,
    invalid_toml_has_stable_error: hasStableTextError(
      invalidToml,
      "invalid_retention_days",
      "retention-days must be an integer between 1 and 3650",
    ),
    valid_default_exit_code: validDefault.exit_code,
    valid_default_policy_matches_template:
      validPayload?.policy?.retentionDays === 30
      && validPayload?.policy?.keepRecentSessions === 40
      && validPayload?.policy?.keepRecentPlansPerSession === 12,
    ...gcPayloadFooter(outputText(invalidToml, validDefault), [invalidToml]),
  };
}

async function runCli(argv) {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "gc-input-validation": {
      const payload = await runGcInputValidation(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "gc-cli-input-validation": {
      const payload = await runGcCliInputValidation(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "gc-env-input-validation": {
      const payload = await runGcEnvInputValidation(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "gc-toml-input-validation": {
      const payload = await runGcTomlInputValidation(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
if (entryScript.includes("gc-contract.mjs")) {
  runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`gc-contract fatal: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
