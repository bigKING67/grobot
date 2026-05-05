import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function writeMcpInstructionProjectToml(workDir, options = {}) {
  const strict = options.strict === true;
  const grobotDir = `${workDir}/.grobot`;
  mkdirSync(grobotDir, { recursive: true });
  writeFileSync(
    `${grobotDir}/project.toml`,
    [
      "schema_version = 1",
      'mode = "mvp"',
      "",
      "[mcp.instructions]",
      "enabled = true",
      'scope = "project_first"',
      `strict = ${strict ? "true" : "false"}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function writeProjectMcpRegistry(workDir) {
  const grobotDir = `${workDir}/.grobot`;
  mkdirSync(grobotDir, { recursive: true });
  writeFileSync(
    `${grobotDir}/mcp.toml`,
    [
      "[[servers]]",
      'name = "grok-search"',
      'command = "uvx"',
      "args = [\"--version\"]",
      "enabled = true",
      "",
    ].join("\n"),
    "utf8",
  );
}

function writeRulePack(path, content) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

export function runStartMcpInstructionEventsFlow(context) {
  const {
    repoRoot,
    createTempDir,
    buildSmokeConfig,
    writeConfig,
    runCommand,
  } = context;
  const workDir = createTempDir("grobot-mcp-instruction-work");
  const homeDir = createTempDir("grobot-mcp-instruction-home");
  const config = writeConfig(buildSmokeConfig(workDir));
  const projectRulePath = `${workDir}/.grobot/rules/mcp/grok-search.md`;
  const globalRulePath = `${homeDir}/rules/mcp/grok-search.md`;

  writeMcpInstructionProjectToml(workDir);
  writeProjectMcpRegistry(workDir);
  writeRulePack(projectRulePath, "PROJECT_GROK_SEARCH_RULE\n");
  writeRulePack(globalRulePath, "GLOBAL_GROK_SEARCH_RULE\n");

  const baseArgs = [
    "./grobot",
    "start",
    "--project",
    "grobot",
    "--project-root",
    workDir,
    "--work-dir",
    workDir,
    "--home",
    homeDir,
    "--config",
    config.configPath,
    "--gateway-impl",
    "ts",
    "--runtime-impl",
    "rust",
    "--session-subject",
    "mcp-instruction-user",
  ];

  const projectResult = runCommand(
    repoRoot,
    [...baseArgs, "--message", "mcp instruction pack project source smoke"],
    {
      GROBOT_STARTUP_DIAGNOSTICS: "1",
    },
  );

  writeRulePack(projectRulePath, "\n");
  writeRulePack(globalRulePath, "GLOBAL_GROK_SEARCH_RULE\n");
  const fallbackResult = runCommand(
    repoRoot,
    [...baseArgs, "--message", "mcp instruction pack fallback source smoke"],
    {
      GROBOT_STARTUP_DIAGNOSTICS: "1",
    },
  );

  writeRulePack(projectRulePath, "\n");
  writeRulePack(globalRulePath, "\n");
  const missingResult = runCommand(
    repoRoot,
    [...baseArgs, "--message", "mcp instruction pack missing smoke"],
    {
      GROBOT_STARTUP_DIAGNOSTICS: "1",
    },
  );

  writeMcpInstructionProjectToml(workDir, { strict: true });
  const strictFailureResult = runCommand(
    repoRoot,
    [...baseArgs, "--message", "mcp instruction strict failure smoke"],
  );

  return {
    project_exit_code: projectResult.exit_code,
    fallback_exit_code: fallbackResult.exit_code,
    missing_exit_code: missingResult.exit_code,
    strict_failure_exit_code: strictFailureResult.exit_code,
    project_pack_loaded_project: projectResult.stderr.includes(
      "event=pack_loaded server=grok-search source=project",
    ),
    project_prompt_injected: projectResult.stderr.includes(
      "event=prompt_injected servers=grok-search",
    ),
    fallback_used: fallbackResult.stderr.includes(
      "event=fallback_used server=grok-search from=project to=global",
    ),
    fallback_pack_loaded_global: fallbackResult.stderr.includes(
      "event=pack_loaded server=grok-search source=global",
    ),
    fallback_prompt_injected: fallbackResult.stderr.includes(
      "event=prompt_injected servers=grok-search",
    ),
    missing_pack_event: missingResult.stderr.includes(
      "event=pack_missing server=grok-search strict=false",
    ),
    missing_prompt_injected: missingResult.stderr.includes("event=prompt_injected"),
    strict_failure_seen: missingResult.stderr.includes("event=strict_failure"),
    strict_failure_human_surface:
      strictFailureResult.stderr.includes("MCP instruction load failed")
      && strictFailureResult.stderr.includes("Strict mode requires instruction packs for all enabled MCP servers.")
      && strictFailureResult.stderr.includes("mcp.instructions.strict"),
    strict_failure_avoids_machine_surface:
      !strictFailureResult.stderr.includes("[governance:mcp-instruction]")
      && !strictFailureResult.stderr.includes("event=strict_failure")
      && !strictFailureResult.stderr.includes("reason="),
  };
}
