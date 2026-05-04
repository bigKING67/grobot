import { isObject } from "./cli-args.mjs";
import { parseOptionalBool } from "./booleans.mjs";

export function resolveExecutionPlaneConfigScenario(payload) {
  const envGateway = "GROBOT_GATEWAY_IMPL";
  const envRuntime = "GROBOT_RUNTIME_IMPL";
  const envShadow = "GROBOT_SHADOW_MODE";
  const projectToml = isObject(payload.project_toml) ? payload.project_toml : {};
  const execution = isObject(projectToml.execution) ? projectToml.execution : {};
  const projectGateway = typeof execution.gateway_impl === "string" ? execution.gateway_impl : "ts";
  const projectRuntime = typeof execution.runtime_impl === "string" ? execution.runtime_impl : "rust";
  const projectShadow = typeof execution.shadow_mode === "boolean" ? execution.shadow_mode : false;
  const projectConfig = {
    gateway_impl: projectGateway,
    runtime_impl: projectRuntime,
    shadow_mode: projectShadow,
    gateway_impl_source: "project_toml:execution.gateway_impl",
    runtime_impl_source: "project_toml:execution.runtime_impl",
    shadow_mode_source: "project_toml:execution.shadow_mode"
  };
  const envBlock = isObject(payload.env) ? payload.env : {};
  const envGatewayRaw = envBlock[envGateway];
  const envRuntimeRaw = envBlock[envRuntime];
  const envShadowRaw = envBlock[envShadow];
  const envShadowParsed = parseOptionalBool(envShadowRaw);
  const envConfig = {
    gateway_impl: typeof envGatewayRaw === "string" ? envGatewayRaw : projectGateway,
    runtime_impl: typeof envRuntimeRaw === "string" ? envRuntimeRaw : projectRuntime,
    shadow_mode: envShadowParsed !== null ? envShadowParsed : projectShadow,
    gateway_impl_source: typeof envGatewayRaw === "string" ? `env:${envGateway}` : "project_toml:execution.gateway_impl",
    runtime_impl_source: typeof envRuntimeRaw === "string" ? `env:${envRuntime}` : "project_toml:execution.runtime_impl",
    shadow_mode_source: envShadowParsed !== null ? `env:${envShadow}` : "project_toml:execution.shadow_mode"
  };
  const cliBlock = isObject(payload.cli) ? payload.cli : {};
  const cliShadow = parseOptionalBool(cliBlock.shadow_mode);
  const cliConfig = {
    gateway_impl: typeof cliBlock.gateway_impl === "string" ? cliBlock.gateway_impl : String(envConfig.gateway_impl),
    runtime_impl: typeof cliBlock.runtime_impl === "string" ? cliBlock.runtime_impl : String(envConfig.runtime_impl),
    shadow_mode: cliShadow !== null ? cliShadow : Boolean(envConfig.shadow_mode),
    gateway_impl_source: typeof cliBlock.gateway_impl === "string" ? "cli" : String(envConfig.gateway_impl_source),
    runtime_impl_source: typeof cliBlock.runtime_impl === "string" ? "cli" : String(envConfig.runtime_impl_source),
    shadow_mode_source: cliShadow !== null ? "cli" : String(envConfig.shadow_mode_source)
  };
  return {
    project_config: projectConfig,
    env_config: envConfig,
    cli_config: cliConfig,
    env_names: {
      gateway_impl: envGateway,
      runtime_impl: envRuntime,
      shadow_mode: envShadow
    }
  };
}

export function buildManagementStatusScenario(payload) {
  const executionPlaneRaw = isObject(payload.execution_plane) ? payload.execution_plane : {};
  const sourcesRaw = isObject(executionPlaneRaw.sources) ? executionPlaneRaw.sources : {};
  return {
    status_payload: {
      execution_plane: {
        gateway_impl: String(executionPlaneRaw.gateway_impl ?? "ts"),
        runtime_impl: String(executionPlaneRaw.runtime_impl ?? "rust"),
        shadow_mode: Boolean(executionPlaneRaw.shadow_mode),
        sources: {
          gateway_impl: String(sourcesRaw.gateway_impl ?? "project_toml:execution.gateway_impl"),
          runtime_impl: String(sourcesRaw.runtime_impl ?? "project_toml:execution.runtime_impl"),
          shadow_mode: String(sourcesRaw.shadow_mode ?? "project_toml:execution.shadow_mode")
        }
      }
    }
  };
}
