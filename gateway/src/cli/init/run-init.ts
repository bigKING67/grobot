import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { OptionValue, hasFlag } from "../cli-args";
import { resolveHomeDir, resolveProjectRoot } from "../services/runtime-paths";
import { resolveRepoRoot } from "../services/repo-root";

function runScript(scriptPath: string, args: string[]): number {
  const run = spawnSync("bash", [scriptPath, ...args], {
    encoding: "utf8",
  });
  if (typeof run.stdout === "string" && run.stdout.length > 0) {
    process.stdout.write(run.stdout);
  }
  if (typeof run.stderr === "string" && run.stderr.length > 0) {
    process.stderr.write(run.stderr);
  }
  if (run.error) {
    process.stderr.write(`error: failed to run ${scriptPath}: ${String(run.error)}\n`);
    return 1;
  }
  return typeof run.status === "number" ? run.status : 1;
}

function printInitUsageHint(): void {
  process.stderr.write("hint: use one mode: `grobot init --global` or `grobot init --project`.\n");
  process.stderr.write("hint: optional for project mode: `--project-root <dir>`, `--hooks-samples`.\n");
}

export async function runInit(options: Record<string, OptionValue>): Promise<number> {
  const globalMode = hasFlag(options, "global");
  const projectMode = hasFlag(options, "project");
  if ((globalMode && projectMode) || (!globalMode && !projectMode)) {
    process.stderr.write("error: `grobot init` requires exactly one of `--global` or `--project`.\n");
    printInitUsageHint();
    return 2;
  }

  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    process.stderr.write("error: cannot resolve grobot source repo root for init bootstrap.\n");
    process.stderr.write("hint: run from grobot source checkout or ensure GROBOT_TS_DEV_REPO_ROOT is set.\n");
    return 2;
  }

  if (globalMode) {
    const homeDir = resolveHomeDir(options);
    const scriptPath = `${repoRoot}/scripts/install-local.sh`;
    if (!existsSync(scriptPath)) {
      process.stderr.write(`error: bootstrap script not found: ${scriptPath}\n`);
      return 2;
    }
    return runScript(scriptPath, [
      "--bootstrap-only",
      "--no-profile",
      "--no-browser-native-setup",
      "--home",
      homeDir,
    ]);
  }

  const homeDir = resolveHomeDir(options);
  const projectRoot = resolveProjectRoot(options, homeDir);
  const hooksSamples = hasFlag(options, "hooks-samples");
  const scriptPath = `${repoRoot}/scripts/bootstrap-project.sh`;
  if (!existsSync(scriptPath)) {
    process.stderr.write(`error: project bootstrap script not found: ${scriptPath}\n`);
    return 2;
  }
  const args = ["--project-root", projectRoot];
  if (hooksSamples) {
    args.push("--hooks-samples");
  }
  return runScript(scriptPath, args);
}
