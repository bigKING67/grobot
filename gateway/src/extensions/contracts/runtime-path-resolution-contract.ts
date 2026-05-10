import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isCliStringOptionInputError,
  type OptionValue,
} from "../../cli/cli-args";
import {
  resolveConfigTomlPath,
  resolveHomeDir,
  resolveProjectRoot,
  resolveProjectTomlPath,
  resolveWorkDir,
} from "../../cli/services/runtime-paths";
import {
  isRuntimeRepoRootPathInputError,
  resolveRuntimeBinaryPath,
} from "../../tools/runtime/runtime-binary-path";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected=${String(expected)} actual=${String(actual)}`);
  }
}

function writeProjectToml(root: string, marker: string): string {
  const path = resolve(root, ".grobot", "project.toml");
  mkdirSync(resolve(root, ".grobot"), { recursive: true });
  writeFileSync(path, `name = "${marker}"\n`, "utf8");
  return path;
}

function captureStringOptionErrorCode(callback: () => unknown): string | null {
  try {
    callback();
    return null;
  } catch (error) {
    if (isCliStringOptionInputError(error)) {
      return error.code;
    }
    throw error;
  }
}

function captureRuntimeRepoRootErrorCode(callback: () => unknown): string | null {
  try {
    callback();
    return null;
  } catch (error) {
    if (isRuntimeRepoRootPathInputError(error)) {
      return error.code;
    }
    throw error;
  }
}

function withEnv<T>(key: string, value: string, callback: () => T): T {
  const previous = process.env[key];
  process.env[key] = value;
  try {
    return callback();
  } finally {
    if (typeof previous === "string") {
      process.env[key] = previous;
    } else {
      delete process.env[key];
    }
  }
}

function resolvePath(input: {
  options?: Record<string, OptionValue>;
  workDir: string;
  projectRoot: string;
  homeDir: string;
}): string | undefined {
  return resolveProjectTomlPath(
    input.options ?? {},
    input.workDir,
    input.projectRoot,
    input.homeDir,
  );
}

function main(): void {
  const root = resolve(
    "/tmp",
    `grobot-runtime-paths-${String(process.pid)}-${String(Date.now())}`,
  );
  const homeDir = resolve(root, "home");
  const devRepoRoot = resolve(root, "dev-repo");
  const isolatedProjectRoot = resolve(root, "isolated-project");
  const isolatedWorkDir = resolve(root, "isolated-work");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(isolatedProjectRoot, { recursive: true });
  mkdirSync(isolatedWorkDir, { recursive: true });

  const devRepoProjectToml = writeProjectToml(devRepoRoot, "dev-repo");
  const previousDevRepoRoot = process.env.GROBOT_TS_DEV_REPO_ROOT;
  process.env.GROBOT_TS_DEV_REPO_ROOT = devRepoRoot;

  try {
    const explicitIsolated = resolvePath({
      options: { "project-root": isolatedProjectRoot },
      workDir: isolatedProjectRoot,
      projectRoot: isolatedProjectRoot,
      homeDir,
    });

    const projectOnlyRoot = resolve(root, "project-only");
    const projectOnlyToml = writeProjectToml(projectOnlyRoot, "project-only");
    const explicitProjectToml = resolvePath({
      options: { "project-root": projectOnlyRoot },
      workDir: projectOnlyRoot,
      projectRoot: projectOnlyRoot,
      homeDir,
    });

    const workOnlyProjectRoot = resolve(root, "work-only-project");
    const workOnlyWorkDir = resolve(root, "work-only-workdir");
    mkdirSync(workOnlyProjectRoot, { recursive: true });
    const workOnlyToml = writeProjectToml(workOnlyWorkDir, "work-only");
    const explicitWorkToml = resolvePath({
      options: { "project-root": workOnlyProjectRoot },
      workDir: workOnlyWorkDir,
      projectRoot: workOnlyProjectRoot,
      homeDir,
    });

    const bothProjectRoot = resolve(root, "both-project");
    const bothWorkDir = resolve(root, "both-workdir");
    const bothProjectToml = writeProjectToml(bothProjectRoot, "both-project");
    writeProjectToml(bothWorkDir, "both-workdir");
    const explicitBothToml = resolvePath({
      options: { "project-root": bothProjectRoot },
      workDir: bothWorkDir,
      projectRoot: bothProjectRoot,
      homeDir,
    });

    const implicitDevRepoFallback = resolvePath({
      workDir: isolatedWorkDir,
      projectRoot: isolatedProjectRoot,
      homeDir,
    });

    const payload = {
      explicit_project_root_isolates_dev_repo_config: explicitIsolated === undefined,
      explicit_project_root_prefers_project_toml: explicitProjectToml === projectOnlyToml,
      explicit_project_root_reads_distinct_workdir_toml: explicitWorkToml === workOnlyToml,
      explicit_project_root_prefers_project_over_workdir_toml: explicitBothToml === bothProjectToml,
      implicit_project_root_allows_dev_repo_fallback: implicitDevRepoFallback === devRepoProjectToml,
      empty_project_root_rejected:
        captureStringOptionErrorCode(() => resolveProjectRoot({ "project-root": "" }, homeDir)) === "invalid_project_root",
      missing_work_dir_value_rejected:
        captureStringOptionErrorCode(() => resolveWorkDir({ "work-dir": true }, isolatedProjectRoot, homeDir)) === "invalid_work_dir",
      empty_project_toml_rejected:
        captureStringOptionErrorCode(() => resolvePath({
          options: { "project-toml": "" },
          workDir: isolatedWorkDir,
          projectRoot: isolatedProjectRoot,
          homeDir,
        })) === "invalid_project_toml",
      empty_config_path_rejected:
        captureStringOptionErrorCode(() => resolveConfigTomlPath({ config: "" }, homeDir, {
          workDir: isolatedWorkDir,
          projectRoot: isolatedProjectRoot,
        })) === "invalid_config",
      empty_home_dir_rejected:
        captureStringOptionErrorCode(() => resolveHomeDir({ "home-dir": "" })) === "invalid_home_dir",
      empty_env_config_rejected: withEnv(
        "GROBOT_CONFIG",
        "",
        () => captureStringOptionErrorCode(() => resolveConfigTomlPath({}, homeDir, {
          workDir: isolatedWorkDir,
          projectRoot: isolatedProjectRoot,
        })) === "invalid_config",
      ),
      empty_env_home_rejected: withEnv(
        "GROBOT_HOME",
        "   ",
        () => captureStringOptionErrorCode(() => resolveHomeDir({})) === "invalid_home",
      ),
      empty_project_toml_repo_root_env_rejected: withEnv(
        "GROBOT_TS_DEV_REPO_ROOT",
        "",
        () => captureStringOptionErrorCode(() => resolvePath({
          workDir: isolatedWorkDir,
          projectRoot: isolatedProjectRoot,
          homeDir,
        })) === "invalid_ts_dev_repo_root",
      ),
      whitespace_project_toml_repo_root_env_rejected: withEnv(
        "GROBOT_TS_DEV_REPO_ROOT",
        "   ",
        () => captureStringOptionErrorCode(() => resolvePath({
          workDir: isolatedWorkDir,
          projectRoot: isolatedProjectRoot,
          homeDir,
        })) === "invalid_ts_dev_repo_root",
      ),
      empty_ts_dev_repo_root_rejected:
        captureRuntimeRepoRootErrorCode(() => resolveRuntimeBinaryPath({
          env: { GROBOT_TS_DEV_REPO_ROOT: "" },
          cwd: isolatedProjectRoot,
          platform: "darwin",
        })) === "invalid_ts_dev_repo_root",
      whitespace_ts_dev_repo_root_rejected:
        captureRuntimeRepoRootErrorCode(() => resolveRuntimeBinaryPath({
          env: { GROBOT_TS_DEV_REPO_ROOT: "   " },
          cwd: isolatedProjectRoot,
          platform: "darwin",
        })) === "invalid_ts_dev_repo_root",
      ts_dev_repo_root_trims_and_resolves_runtime_path:
        resolveRuntimeBinaryPath({
          env: { GROBOT_TS_DEV_REPO_ROOT: ` ${devRepoRoot}/ ` },
          cwd: isolatedProjectRoot,
          platform: "darwin",
        }) === `${devRepoRoot}/runtime/target/debug/grobot-runtime`,
    };

    assertEqual(
      payload.explicit_project_root_isolates_dev_repo_config,
      true,
      "explicit --project-root must not inherit dev repo project.toml",
    );
    assertEqual(
      payload.explicit_project_root_prefers_project_toml,
      true,
      "explicit --project-root should read projectRoot project.toml",
    );
    assertEqual(
      payload.explicit_project_root_reads_distinct_workdir_toml,
      true,
      "explicit --project-root should still read a distinct workDir project.toml",
    );
    assertEqual(
      payload.explicit_project_root_prefers_project_over_workdir_toml,
      true,
      "projectRoot project.toml should win over workDir when both exist",
    );
    assertEqual(
      payload.implicit_project_root_allows_dev_repo_fallback,
      true,
      "implicit project root should keep TS dev repo fallback",
    );
    assertEqual(payload.empty_project_root_rejected, true, "empty --project-root should fail closed");
    assertEqual(payload.missing_work_dir_value_rejected, true, "missing --work-dir value should fail closed");
    assertEqual(payload.empty_project_toml_rejected, true, "empty --project-toml should fail closed");
    assertEqual(payload.empty_config_path_rejected, true, "empty --config should fail closed");
    assertEqual(payload.empty_home_dir_rejected, true, "empty --home-dir should fail closed");
    assertEqual(payload.empty_env_config_rejected, true, "empty GROBOT_CONFIG should fail closed");
    assertEqual(payload.empty_env_home_rejected, true, "empty GROBOT_HOME should fail closed");
    assertEqual(
      payload.empty_project_toml_repo_root_env_rejected,
      true,
      "empty GROBOT_TS_DEV_REPO_ROOT should fail closed during project.toml discovery",
    );
    assertEqual(
      payload.whitespace_project_toml_repo_root_env_rejected,
      true,
      "whitespace GROBOT_TS_DEV_REPO_ROOT should fail closed during project.toml discovery",
    );
    assertEqual(
      payload.empty_ts_dev_repo_root_rejected,
      true,
      "empty GROBOT_TS_DEV_REPO_ROOT should fail closed",
    );
    assertEqual(
      payload.whitespace_ts_dev_repo_root_rejected,
      true,
      "whitespace GROBOT_TS_DEV_REPO_ROOT should fail closed",
    );
    assertEqual(
      payload.ts_dev_repo_root_trims_and_resolves_runtime_path,
      true,
      "non-empty GROBOT_TS_DEV_REPO_ROOT should trim and resolve runtime path",
    );

    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } finally {
    if (typeof previousDevRepoRoot === "string") {
      process.env.GROBOT_TS_DEV_REPO_ROOT = previousDevRepoRoot;
    } else {
      delete process.env.GROBOT_TS_DEV_REPO_ROOT;
    }
  }
}

main();
