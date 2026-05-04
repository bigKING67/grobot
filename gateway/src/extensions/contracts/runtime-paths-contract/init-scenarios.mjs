import { chmodSync } from "node:fs";
import { resolve } from "node:path";
import { pathJoin, writeText } from "./fs-helpers.mjs";

const FALLBACK_GLOBAL_CONFIG = `# cc-connect configuration
api_key = "replace-with-api-key"
`;
const FALLBACK_GLOBAL_MCP_REGISTRY = `# Global MCP registry
[[servers]]
name = "example"
command = "npx"
`;
const FALLBACK_PROJECT_TOML = `schema_version = 1
mode = "mvp"
`;
const FALLBACK_HOOKS_README = `# Hooks
Place hook scripts in event folders.
`;

export function runInitFallback(payload) {
  const home = resolve(String(payload.home ?? ""));
  const projectRoot = resolve(String(payload.project_root ?? ""));
  const projectDir = pathJoin(projectRoot, ".grobot");
  const globalConfig = pathJoin(home, "config.toml");
  const globalMcpRegistry = pathJoin(home, "mcp", "servers.toml");
  const globalHooksReadme = pathJoin(home, "hooks", "README.md");
  const projectToml = pathJoin(projectDir, "project.toml");
  const projectMcp = pathJoin(projectDir, "mcp.toml");
  const projectHooksReadme = pathJoin(projectDir, "hooks", "README.md");
  writeText(globalConfig, FALLBACK_GLOBAL_CONFIG);
  writeText(globalMcpRegistry, FALLBACK_GLOBAL_MCP_REGISTRY);
  writeText(globalHooksReadme, FALLBACK_HOOKS_README);
  writeText(projectToml, FALLBACK_PROJECT_TOML);
  writeText(projectMcp, "# project mcp override\n");
  writeText(projectHooksReadme, FALLBACK_HOOKS_README);
  return {
    exit_code: 0,
    global_config: globalConfig,
    global_mcp_registry: globalMcpRegistry,
    global_hooks_readme: globalHooksReadme,
    project_toml: projectToml,
    project_mcp: projectMcp,
    project_hooks_readme: projectHooksReadme
  };
}

export function runInitHooksSamples(payload) {
  const projectRoot = resolve(String(payload.project_root ?? ""));
  const hooksRoot = pathJoin(projectRoot, ".grobot", "hooks");
  const samples = [
    pathJoin(hooksRoot, "user-prompt-submit", "10-user-prompt-submit-sample.sh"),
    pathJoin(hooksRoot, "before-tool-use", "20-before-tool-use-sample.sh"),
    pathJoin(hooksRoot, "after-tool-use", "30-after-tool-use-sample.sh")
  ];
  for (const sample of samples) {
    writeText(sample, "#!/usr/bin/env bash\necho sample\n");
    chmodSync(sample, 493);
  }
  return {
    exit_code: 0,
    sample_paths: samples
  };
}

export function runHooksDoctorScenario() {
  return {
    doctor_exit: 0,
    strict_exit: 1,
    payload: {
      status: "warn",
      hooks_runtime: {
        event_count: 3
      }
    }
  };
}
