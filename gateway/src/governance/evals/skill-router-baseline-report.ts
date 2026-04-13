import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const ZERO_SHA = "0000000000000000000000000000000000000000";
const TSX_PACKAGE = "tsx@4.20.6";

type JsonObject = Record<string, unknown>;

interface ParsedCliArgs {
  eventName: string;
  prBaseSha: string;
  beforeSha: string;
  repoRoot: string;
  outputPath: string;
  githubOutputPath: string | undefined;
  pythonBin: string;
  printJson: boolean;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized || normalized === ZERO_SHA) {
    return undefined;
  }
  return normalized;
}

export function resolveBaseSha(input: {
  eventName: string;
  prBaseSha: unknown;
  beforeSha: unknown;
}): string | undefined {
  if (input.eventName === "pull_request") {
    return normalizeOptionalText(input.prBaseSha);
  }
  return normalizeOptionalText(input.beforeSha);
}

function dirname(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  return normalized.slice(0, slash);
}

function removeTrailingSlashes(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function pathJoin(base: string, relative: string): string {
  const trimmedBase = removeTrailingSlashes(base);
  const trimmedRelative = relative.replace(/^[\\/]+/, "");
  return `${trimmedBase}/${trimmedRelative}`;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/");
}

function resolvePathFromRepoRoot(repoRoot: string, path: string): string {
  if (isAbsolutePath(path)) {
    return path;
  }
  return pathJoin(repoRoot, path);
}

function runCapture(command: string[]): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  if (command.length === 0) {
    return { exitCode: 1, stdout: "", stderr: "empty command" };
  }
  const result = spawnSync(command[0], command.slice(1), {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
  });
  const status = typeof result.status === "number" ? result.status : 1;
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  return { exitCode: status, stdout, stderr };
}

function writeGithubOutput(path: string, available: boolean): void {
  mkdirSync(dirname(path), { recursive: true });
  const previous = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, `${previous}available=${available ? "true" : "false"}\n`, "utf8");
}

function parseArgs(argv: string[]): ParsedCliArgs {
  let eventName = "";
  let prBaseSha = "";
  let beforeSha = "";
  let repoRoot = ".";
  let outputPath = "gateway/evals/data/skill_router_ci_report.base.json";
  let githubOutputPath: string | undefined;
  let pythonBin = "python3";
  let printJson = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--event-name") {
      eventName = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--pr-base-sha") {
      prBaseSha = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--before-sha") {
      beforeSha = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--repo-root") {
      repoRoot = argv[index + 1] ?? ".";
      index += 1;
      continue;
    }
    if (token === "--output") {
      outputPath = argv[index + 1] ?? outputPath;
      index += 1;
      continue;
    }
    if (token === "--github-output") {
      githubOutputPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--python-bin") {
      pythonBin = argv[index + 1] ?? pythonBin;
      index += 1;
      continue;
    }
    if (token === "--print-json") {
      printJson = true;
      continue;
    }
  }

  return {
    eventName,
    prBaseSha,
    beforeSha,
    repoRoot,
    outputPath,
    githubOutputPath,
    pythonBin,
    printJson,
  };
}

interface BuildBaselineInput {
  eventName: string;
  prBaseSha: string;
  beforeSha: string;
  repoRoot: string;
  outputPath: string;
  pythonBin: string;
  policyRelPath?: string;
  evalRelPath?: string;
}

function randomSuffix(): string {
  return `${Date.now()}-${Math.abs(Math.trunc(Math.random() * 1_000_000))}`;
}

export function buildSkillRouterBaselineReport(input: BuildBaselineInput): JsonObject {
  const baseSha = resolveBaseSha({
    eventName: input.eventName,
    prBaseSha: input.prBaseSha,
    beforeSha: input.beforeSha,
  });
  if (!baseSha) {
    return { available: false, reason: "no_base_sha", base_sha: null };
  }

  const repoRoot = removeTrailingSlashes(input.repoRoot);
  const outputPath = resolvePathFromRepoRoot(repoRoot, input.outputPath);
  const policyRelPath = input.policyRelPath ?? "gateway/evals/skill_router_policy.ci.json";
  const evalRelPath = input.evalRelPath ?? "gateway/src/governance/evals/skill-router-eval.ts";
  const worktreeDir = `/tmp/grobot-skill-router-base-${randomSuffix()}`;

  const addResult = runCapture(["git", "-C", repoRoot, "worktree", "add", "--detach", worktreeDir, baseSha]);
  if (addResult.exitCode !== 0) {
    return {
      available: false,
      reason: "worktree_add_failed",
      base_sha: baseSha,
      stderr: addResult.stderr.trim(),
    };
  }

    try {
      const evalPath = pathJoin(worktreeDir, evalRelPath);
      const policyPath = pathJoin(worktreeDir, policyRelPath);
      if (!existsSync(evalPath) || !existsSync(policyPath)) {
        return {
          available: false,
        reason: "required_files_missing",
        base_sha: baseSha,
      };
    }

    mkdirSync(dirname(outputPath), { recursive: true });
    const evalCommand: string[] = [];
    const normalizedEvalPath = evalPath.toLowerCase();
    if (normalizedEvalPath.endsWith(".ts")) {
      evalCommand.push("npx", "--yes", "--package", TSX_PACKAGE, "tsx", evalPath);
    } else if (normalizedEvalPath.endsWith(".js")) {
      evalCommand.push("node", evalPath);
    } else {
      evalCommand.push(input.pythonBin, evalPath);
    }
    evalCommand.push("--policy", policyPath, "--print-json", "--output", outputPath);
    const runResult = runCapture(evalCommand);
    const available = existsSync(outputPath);
    return {
      available,
      reason: available ? "output_present" : "output_missing",
      base_sha: baseSha,
      eval_returncode: runResult.exitCode,
      eval_stderr: runResult.stderr.trim(),
    };
  } finally {
    runCapture(["git", "-C", repoRoot, "worktree", "remove", "--force", worktreeDir]);
  }
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  let result: JsonObject;
  try {
    result = buildSkillRouterBaselineReport({
      eventName: args.eventName,
      prBaseSha: args.prBaseSha,
      beforeSha: args.beforeSha,
      repoRoot: args.repoRoot,
      outputPath: args.outputPath,
      pythonBin: args.pythonBin,
    });
  } catch (error) {
    result = {
      available: false,
      reason: "runtime_error",
      error: String(error),
    };
  }

  if (args.githubOutputPath && args.githubOutputPath.trim().length > 0) {
    writeGithubOutput(args.githubOutputPath.trim(), result.available === true);
  }
  if (args.printJson) {
    process.stdout.write(`${JSON.stringify(result, undefined, 0)}\n`);
  }
  return 0;
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (typeof entry !== "string") {
    return true;
  }
  const normalized = entry.replace(/\\/g, "/");
  return (
    normalized.endsWith("/skill-router-baseline-report.ts") ||
    normalized.endsWith("/skill-router-baseline-report.js")
  );
}

if (isDirectExecution()) {
  process.exitCode = main();
}
