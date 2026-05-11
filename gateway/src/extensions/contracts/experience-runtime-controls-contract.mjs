import { spawnSync } from "node:child_process";
import {
  buildStartSmokeFlowContext,
} from "./start-smoke-contract/context.mjs";
import {
  parseArgs,
  requireOption,
} from "./start-smoke-contract/helpers.mjs";

function runRepoCommand(repoRoot, argv, env = {}, timeoutMs = 120_000) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    exit_code: typeof result.status === "number" ? result.status : 1,
    signal_code: result.signal ?? null,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

function hasStableError(result, code, detail) {
  return result.stderr.includes(`error: ${code}:`)
    && result.stderr.includes(detail);
}

function createBoundaryControlArgs(options) {
  const repoRoot = requireOption(options, "repo-root");
  const context = buildStartSmokeFlowContext(repoRoot);
  const workDir = context.createTempDir("grobot-experience-runtime-controls-work");
  const config = context.writeConfig(context.buildSmokeConfig(workDir));
  const startCommonArgs = [
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
    "experience-runtime-controls-user",
    "--message",
    "invalid experience runtime controls should not reach runtime",
  ];
  const serveCommonArgs = [
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
    "127.0.0.1:0",
  ];
  return {
    context,
    repoRoot,
    serveCommonArgs,
    startCommonArgs,
  };
}

function runStartBoundaryControlsRejectFlow(options) {
  const teamControls = runStartTeamBoundaryControlsRejectFlow(options);
  const configControls = runStartConfigBoundaryControlsRejectFlow(options);
  return {
    ...teamControls,
    ...configControls,
    hides_top_level_fatal:
      teamControls.hides_top_level_fatal
      && configControls.hides_top_level_fatal,
    start_banner_not_reached:
      teamControls.start_banner_not_reached
      && configControls.start_banner_not_reached,
  };
}

function runStartTeamBoundaryControlsRejectFlow(options) {
  const { context, repoRoot, startCommonArgs } = createBoundaryControlArgs(options);
  const startEmptyTeam = runRepoCommand(repoRoot, startCommonArgs, {
    GROBOT_TEAM: "",
  });
  const startMissingTeamOption = runRepoCommand(repoRoot, [
    ...startCommonArgs,
    "--team",
  ]);
  const startEmptyTeamOption = runRepoCommand(repoRoot, [
    ...startCommonArgs,
    "--team",
    "",
  ]);
  const combinedOutput = [
    startEmptyTeam.stdout,
    startEmptyTeam.stderr,
    startMissingTeamOption.stdout,
    startMissingTeamOption.stderr,
    startEmptyTeamOption.stdout,
    startEmptyTeamOption.stderr,
  ].join("\n");

  return {
    start_empty_team_exit_code: startEmptyTeam.exit_code,
    start_empty_team_has_stable_error: hasStableError(
      startEmptyTeam,
      "invalid_team",
      "team must be a non-empty string",
    ),
    start_missing_team_option_exit_code: startMissingTeamOption.exit_code,
    start_missing_team_option_has_stable_error: hasStableError(
      startMissingTeamOption,
      "invalid_team",
      "team must be a non-empty string",
    ),
    start_empty_team_option_exit_code: startEmptyTeamOption.exit_code,
    start_empty_team_option_has_stable_error: hasStableError(
      startEmptyTeamOption,
      "invalid_team",
      "team must be a non-empty string",
    ),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    start_banner_not_reached: !context.hasStartBannerMarker(combinedOutput),
  };
}

function runStartConfigBoundaryControlsRejectFlow(options) {
  const { context, repoRoot, startCommonArgs } = createBoundaryControlArgs(options);
  const startEmptyPoolPath = runRepoCommand(repoRoot, startCommonArgs, {
    GROBOT_EXPERIENCE_POOL_PATH: "   ",
  });
  const startEmptyPublishMode = runRepoCommand(repoRoot, startCommonArgs, {
    GROBOT_EXPERIENCE_PUBLISH_MODE: "",
  });
  const startEmptyRecallLimit = runRepoCommand(repoRoot, startCommonArgs, {
    GROBOT_EXPERIENCE_RECALL_LIMIT: "   ",
  });
  const combinedOutput = [
    startEmptyPoolPath.stdout,
    startEmptyPoolPath.stderr,
    startEmptyPublishMode.stdout,
    startEmptyPublishMode.stderr,
    startEmptyRecallLimit.stdout,
    startEmptyRecallLimit.stderr,
  ].join("\n");

  return {
    start_empty_pool_path_exit_code: startEmptyPoolPath.exit_code,
    start_empty_pool_path_has_stable_error: hasStableError(
      startEmptyPoolPath,
      "invalid_experience_pool_path",
      "experience-pool-path must be a non-empty string",
    ),
    start_empty_publish_mode_exit_code: startEmptyPublishMode.exit_code,
    start_empty_publish_mode_has_stable_error: hasStableError(
      startEmptyPublishMode,
      "invalid_experience_publish_mode",
      "experience-publish-mode must be auto or off",
    ),
    start_empty_recall_limit_exit_code: startEmptyRecallLimit.exit_code,
    start_empty_recall_limit_has_stable_error: hasStableError(
      startEmptyRecallLimit,
      "invalid_experience_recall_limit",
      "experience-recall-limit must be an integer between 1 and 6",
    ),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    start_banner_not_reached: !context.hasStartBannerMarker(combinedOutput),
  };
}

function runServeBoundaryControlsRejectFlow(options) {
  const { repoRoot, serveCommonArgs } = createBoundaryControlArgs(options);
  const serveEmptyTeam = runRepoCommand(repoRoot, serveCommonArgs, {
    GROBOT_TEAM: "",
  });
  const serveEmptyPoolPath = runRepoCommand(repoRoot, serveCommonArgs, {
    GROBOT_EXPERIENCE_POOL_PATH: "",
  });
  const serveEmptyPublishMode = runRepoCommand(repoRoot, serveCommonArgs, {
    GROBOT_EXPERIENCE_PUBLISH_MODE: "   ",
  });
  const serveEmptyRecallLimit = runRepoCommand(repoRoot, serveCommonArgs, {
    GROBOT_EXPERIENCE_RECALL_LIMIT: "",
  });
  const combinedOutput = [
    serveEmptyTeam.stdout,
    serveEmptyTeam.stderr,
    serveEmptyPoolPath.stdout,
    serveEmptyPoolPath.stderr,
    serveEmptyPublishMode.stdout,
    serveEmptyPublishMode.stderr,
    serveEmptyRecallLimit.stdout,
    serveEmptyRecallLimit.stderr,
  ].join("\n");

  return {
    serve_empty_team_exit_code: serveEmptyTeam.exit_code,
    serve_empty_team_has_stable_error: hasStableError(
      serveEmptyTeam,
      "invalid_team",
      "team must be a non-empty string",
    ),
    serve_empty_pool_path_exit_code: serveEmptyPoolPath.exit_code,
    serve_empty_pool_path_has_stable_error: hasStableError(
      serveEmptyPoolPath,
      "invalid_experience_pool_path",
      "experience-pool-path must be a non-empty string",
    ),
    serve_empty_publish_mode_exit_code: serveEmptyPublishMode.exit_code,
    serve_empty_publish_mode_has_stable_error: hasStableError(
      serveEmptyPublishMode,
      "invalid_experience_publish_mode",
      "experience-publish-mode must be auto or off",
    ),
    serve_empty_recall_limit_exit_code: serveEmptyRecallLimit.exit_code,
    serve_empty_recall_limit_has_stable_error: hasStableError(
      serveEmptyRecallLimit,
      "invalid_experience_recall_limit",
      "experience-recall-limit must be an integer between 1 and 6",
    ),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    serve_ready_not_reached:
      !combinedOutput.includes("Management server listening")
      && !combinedOutput.includes("/api/v1/status"),
  };
}

function runBoundaryControlsRejectFlow(options) {
  const startControls = runStartBoundaryControlsRejectFlow(options);
  const serveControls = runServeBoundaryControlsRejectFlow(options);
  return {
    ...startControls,
    ...serveControls,
    hides_top_level_fatal:
      startControls.hides_top_level_fatal
      && serveControls.hides_top_level_fatal,
  };
}

function runCli(argv) {
  const { command, options } = parseArgs(argv);
  switch (command) {
    case "boundary-controls-reject-flow": {
      const payload = runBoundaryControlsRejectFlow(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "start-boundary-controls-reject-flow": {
      const payload = runStartBoundaryControlsRejectFlow(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "start-team-boundary-controls-reject-flow": {
      const payload = runStartTeamBoundaryControlsRejectFlow(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "start-config-boundary-controls-reject-flow": {
      const payload = runStartConfigBoundaryControlsRejectFlow(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    case "serve-boundary-controls-reject-flow": {
      const payload = runServeBoundaryControlsRejectFlow(options);
      process.stdout.write(`${JSON.stringify(payload)}\n`);
      return 0;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

const entryScript = process.argv[1] ?? "";
if (entryScript.includes("experience-runtime-controls-contract.mjs")) {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`experience-runtime-controls-contract fatal: ${String(error)}\n`);
    process.exitCode = 1;
  }
}
