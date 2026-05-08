import { mkdirSync, writeFileSync } from "node:fs";

function writeMcpInstructionProjectToml(workDir, lines) {
  const grobotDir = `${workDir}/.grobot`;
  mkdirSync(grobotDir, { recursive: true });
  writeFileSync(
    `${grobotDir}/project.toml`,
    [
      "schema_version = 1",
      'mode = "mvp"',
      "",
      "[mcp.instructions]",
      ...lines,
      "",
    ].join("\n"),
    "utf8",
  );
}

function writeProjectMcpRegistry(workDir, lines) {
  const grobotDir = `${workDir}/.grobot`;
  mkdirSync(grobotDir, { recursive: true });
  writeFileSync(
    `${grobotDir}/mcp.toml`,
    [
      "[[servers]]",
      ...lines,
      "",
    ].join("\n"),
    "utf8",
  );
}

export function runStartInvalidMcpInstructionControlsRejectFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
    hasStartBannerMarker,
  } = context;

  const makeCase = (suffix, options = {}) => {
    const workDir = createTempDir(`grobot-start-invalid-mcp-instruction-${suffix}`);
    if (Array.isArray(options.projectTomlLines)) {
      writeMcpInstructionProjectToml(workDir, options.projectTomlLines);
    }
    if (Array.isArray(options.registryLines)) {
      writeProjectMcpRegistry(workDir, options.registryLines);
    }
    const config = writeConfig(buildSmokeConfig(workDir));
    return runCommand(repoRoot, [
      "./grobot",
      "start",
      "--project",
      "grobot",
      "--project-root",
      workDir,
      "--work-dir",
      workDir,
      "--config",
      config.configPath,
      "--gateway-impl",
      "ts",
      "--runtime-impl",
      "rust",
      "--session-subject",
      `start-invalid-mcp-instruction-${suffix}-user`,
      "--message",
      "invalid mcp instruction config should not reach runtime",
    ]);
  };

  const invalidEnabledResult = makeCase(
    "enabled",
    { projectTomlLines: ["enabled = maybe"] },
  );
  const invalidStrictResult = makeCase(
    "strict",
    { projectTomlLines: ["strict = yes"] },
  );
  const invalidScopeResult = makeCase(
    "scope",
    { projectTomlLines: ['scope = "workspace"'] },
  );
  const invalidScopeSyntaxResult = makeCase(
    "scope-syntax",
    { projectTomlLines: ['scope = "project_first" trailing'] },
  );
  const invalidServerNameResult = makeCase(
    "server-name",
    {
      projectTomlLines: ["enabled = true"],
      registryLines: ['name = ""', 'command = "uvx"', "enabled = true"],
    },
  );
  const invalidServerEnabledResult = makeCase(
    "server-enabled",
    {
      projectTomlLines: ["enabled = true"],
      registryLines: ['name = "grok-search"', 'command = "uvx"', "enabled = maybe"],
    },
  );
  const validDisabledBoundaryResult = makeCase(
    "valid-disabled-boundary",
    {
      projectTomlLines: [
        "enabled = false",
        'scope = "global_only"',
        "strict = false",
      ],
      registryLines: ['name = "grok-search"', 'command = "uvx"', "enabled = false"],
    },
  );

  const combinedOutput = [
    invalidEnabledResult.stdout,
    invalidEnabledResult.stderr,
    invalidStrictResult.stdout,
    invalidStrictResult.stderr,
    invalidScopeResult.stdout,
    invalidScopeResult.stderr,
    invalidScopeSyntaxResult.stdout,
    invalidScopeSyntaxResult.stderr,
    invalidServerNameResult.stdout,
    invalidServerNameResult.stderr,
    invalidServerEnabledResult.stdout,
    invalidServerEnabledResult.stderr,
  ].join("\n");

  return {
    invalid_enabled_exit_code: invalidEnabledResult.exit_code,
    invalid_enabled_has_stable_error:
      invalidEnabledResult.stderr.includes("error: invalid_mcp_instructions_enabled:")
      && invalidEnabledResult.stderr.includes("mcp-instructions-enabled must be boolean")
      && invalidEnabledResult.stderr.includes("source=project_toml"),
    invalid_strict_exit_code: invalidStrictResult.exit_code,
    invalid_strict_has_stable_error:
      invalidStrictResult.stderr.includes("error: invalid_mcp_instructions_strict:")
      && invalidStrictResult.stderr.includes("mcp-instructions-strict must be boolean"),
    invalid_scope_exit_code: invalidScopeResult.exit_code,
    invalid_scope_has_stable_error:
      invalidScopeResult.stderr.includes("error: invalid_mcp_instructions_scope:")
      && invalidScopeResult.stderr.includes("mcp-instructions-scope must be project_first, project_only, or global_only"),
    invalid_scope_syntax_exit_code: invalidScopeSyntaxResult.exit_code,
    invalid_scope_syntax_has_stable_error:
      invalidScopeSyntaxResult.stderr.includes("error: invalid_mcp_instructions_scope:")
      && invalidScopeSyntaxResult.stderr.includes("mcp-instructions-scope must be project_first, project_only, or global_only"),
    invalid_server_name_exit_code: invalidServerNameResult.exit_code,
    invalid_server_name_has_stable_error:
      invalidServerNameResult.stderr.includes("error: invalid_mcp_server_name:")
      && invalidServerNameResult.stderr.includes("mcp-server-name must be a non-empty string")
      && invalidServerNameResult.stderr.includes("source=mcp_registry:"),
    invalid_server_enabled_exit_code: invalidServerEnabledResult.exit_code,
    invalid_server_enabled_has_stable_error:
      invalidServerEnabledResult.stderr.includes("error: invalid_mcp_server_enabled:")
      && invalidServerEnabledResult.stderr.includes("mcp-server-enabled must be boolean")
      && invalidServerEnabledResult.stderr.includes("source=mcp_registry:"),
    valid_disabled_boundary_exit_code: validDisabledBoundaryResult.exit_code,
    valid_disabled_boundary_reached_runtime:
      validDisabledBoundaryResult.stderr.includes("Turn failed")
      || validDisabledBoundaryResult.stderr.includes("Upstream connection failed"),
    hides_top_level_fatal: !combinedOutput.includes("fatal error"),
    has_start_banner: hasStartBannerMarker(combinedOutput),
  };
}
