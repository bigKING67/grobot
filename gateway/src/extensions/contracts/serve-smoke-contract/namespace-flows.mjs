import { spawn } from "node:child_process";

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

function requireOption(options, key) {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

export async function runServeInvalidNamespaceRejectFlow(options) {
  const repoRoot = requireOption(options, "repo-root");
  const workDir = requireOption(options, "work-dir");
  const bind = requireOption(options, "bind");
  const commonArgs = [
    "./grobot",
    "serve",
    "--project",
    "grobot",
    "--work-dir",
    workDir,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
    "--bind",
    bind,
  ];
  const invalidTenantResult = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--tenant",
    "bad:tenant",
  ]);
  const invalidPlatformResult = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--platform",
    "discord",
  ]);
  const invalidScopeResult = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--session-scope",
    "room",
  ]);
  const invalidBindResult = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--bind",
    "not-a-bind",
  ]);
  const missingBindValueResult = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--bind",
  ]);
  const emptySubjectResult = await runRepoCommand(repoRoot, [
    ...commonArgs,
    "--session-subject",
    "",
  ]);
  const combinedOutput = [
    invalidTenantResult.stdout,
    invalidTenantResult.stderr,
    invalidPlatformResult.stdout,
    invalidPlatformResult.stderr,
    invalidScopeResult.stdout,
    invalidScopeResult.stderr,
    invalidBindResult.stdout,
    invalidBindResult.stderr,
    missingBindValueResult.stdout,
    missingBindValueResult.stderr,
    emptySubjectResult.stdout,
    emptySubjectResult.stderr,
  ].join("\n");
  return {
    invalid_tenant_exit_code: invalidTenantResult.exit_code,
    invalid_tenant_has_stable_error:
      invalidTenantResult.stderr.includes("error: invalid_session_tenant:")
      && invalidTenantResult.stderr.includes("tenant must not contain ':'"),
    invalid_platform_exit_code: invalidPlatformResult.exit_code,
    invalid_platform_has_stable_error:
      invalidPlatformResult.stderr.includes("error: invalid_session_platform:")
      && invalidPlatformResult.stderr.includes("platform must be one of: feishu, telegram"),
    invalid_scope_exit_code: invalidScopeResult.exit_code,
    invalid_scope_has_stable_error:
      invalidScopeResult.stderr.includes("error: invalid_session_scope:")
      && invalidScopeResult.stderr.includes("session-scope must be one of: dm, group"),
    invalid_bind_exit_code: invalidBindResult.exit_code,
    invalid_bind_has_stable_error:
      invalidBindResult.stderr.includes("error: invalid_bind:")
      && invalidBindResult.stderr.includes("bind must be host:port"),
    missing_bind_value_exit_code: missingBindValueResult.exit_code,
    missing_bind_value_has_stable_error:
      missingBindValueResult.stderr.includes("error: invalid_bind:")
      && missingBindValueResult.stderr.includes("bind must be host:port"),
    empty_subject_exit_code: emptySubjectResult.exit_code,
    empty_subject_has_stable_error:
      emptySubjectResult.stderr.includes("error: invalid_session_subject:")
      && emptySubjectResult.stderr.includes("session-subject must be non-empty"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_serve_banner: combinedOutput.includes("management api:"),
  };
}
