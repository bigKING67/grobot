import { resolveExecutionPlaneConfig } from "../../../execution-plane";
import { buildSessionKey } from "../../../../models/session-key";
import { hasFlag, OptionValue, readOptionString } from "../cli-args";
import { probeProviderModels, readProviderSnapshotFromToml } from "../provider-probe";
import { resolveRuntimeBinaryPath, runRuntimeHealthcheck } from "../runtime-health";
import { maskSecret } from "../services/redaction";
import {
  basenameFromPath,
  resolveConfigTomlPath,
  resolveHomeDir,
  resolveProjectRoot,
  resolveProjectTomlPath,
  resolveWorkDir,
} from "../services/runtime-paths";
import {
  parsePlatform,
  parseScope,
  resolveSessionPlatformOption,
  resolveSessionScopeOption,
  resolveSessionSubjectOption,
} from "../start/session-options";

export async function runStatus(options: Record<string, OptionValue>): Promise<number> {
  const homeDir = resolveHomeDir(options);
  const projectRoot = resolveProjectRoot(options, homeDir);
  const workDir = resolveWorkDir(options, projectRoot, homeDir);
  const projectTomlPath = resolveProjectTomlPath(options, workDir, projectRoot, homeDir);
  const configTomlPath = resolveConfigTomlPath(options, homeDir);
  const projectName = readOptionString(options, "project") ?? basenameFromPath(workDir);
  const sessionScopeRaw = resolveSessionScopeOption(options);
  const sessionSubject = resolveSessionSubjectOption(options) ?? process.env.USER ?? "user";
  const providerOverride = readOptionString(options, "provider");
  const projectProviderSnapshot = readProviderSnapshotFromToml(
    configTomlPath,
    projectName,
    workDir,
    homeDir,
    providerOverride,
  );
  const providerName = providerOverride ??
    process.env.GROBOT_PROVIDER ??
    projectProviderSnapshot?.providerName ??
    "<auto>";
  const modelName = readOptionString(options, "model") ??
    process.env.GROBOT_MODEL ??
    projectProviderSnapshot?.provider?.model ??
    "<auto>";
  const baseUrl = readOptionString(options, "base-url") ??
    process.env.GROBOT_BASE_URL ??
    projectProviderSnapshot?.provider?.baseUrl ??
    "<auto>";
  const apiKey = readOptionString(options, "api-key") ??
    process.env.GROBOT_API_KEY ??
    projectProviderSnapshot?.provider?.apiKey;
  const sessionPreview = buildSessionKey({
    platform: parsePlatform(resolveSessionPlatformOption(options)),
    tenant: readOptionString(options, "tenant") ?? projectName,
    scope: parseScope(sessionScopeRaw),
    subject: sessionSubject,
  });
  const executionPlane = resolveExecutionPlaneConfig({
    gatewayImplArg: readOptionString(options, "gateway-impl"),
    runtimeImplArg: readOptionString(options, "runtime-impl"),
    shadowModeArg: hasFlag(options, "shadow-mode"),
    noShadowModeArg: hasFlag(options, "no-shadow-mode"),
    projectTomlPath,
  });

  process.stdout.write("status: ok\n");
  process.stdout.write("engine: ts-dev-cli\n");
  process.stdout.write(`home: ${homeDir}\n`);
  process.stdout.write(`project_root: ${projectRoot}\n`);
  process.stdout.write(`work_dir: ${workDir}\n`);
  process.stdout.write(`config_toml: ${configTomlPath ?? "<not-found>"}\n`);
  process.stdout.write(`project_toml: ${projectTomlPath ?? "<not-found>"}\n`);
  process.stdout.write(`project: ${projectName}\n`);
  process.stdout.write(`provider: ${providerName}\n`);
  if (projectProviderSnapshot?.source) {
    process.stdout.write(`provider_source: ${projectProviderSnapshot.source}\n`);
  }
  process.stdout.write(`model: ${modelName}\n`);
  process.stdout.write(`base_url: ${baseUrl}\n`);
  process.stdout.write(`api_key: ${maskSecret(apiKey)}\n`);
  process.stdout.write(`session_scope: ${parseScope(sessionScopeRaw)}\n`);
  process.stdout.write(`session_subject: ${sessionSubject}\n`);
  process.stdout.write(`session_preview: ${sessionPreview}\n`);
  process.stdout.write(
    `execution: gateway=${executionPlane.gatewayImpl}(${executionPlane.gatewayImplSource}) runtime=${executionPlane.runtimeImpl}(${executionPlane.runtimeImplSource}) shadow=${executionPlane.shadowMode ? "on" : "off"}(${executionPlane.shadowModeSource})\n`,
  );

  if (executionPlane.runtimeImpl === "rust") {
    const runtimeBinaryPath = resolveRuntimeBinaryPath();
    const health = runRuntimeHealthcheck(runtimeBinaryPath);
    process.stdout.write(
      `runtime_health: ${health.ok ? "ok" : "warn"} (${runtimeBinaryPath}) ${health.detail}\n`,
    );
  }
  if (hasFlag(options, "probe")) {
    const probeBaseUrl = readOptionString(options, "base-url") ??
      process.env.GROBOT_BASE_URL ??
      projectProviderSnapshot?.provider?.baseUrl;
    const probeApiKey = readOptionString(options, "api-key") ??
      process.env.GROBOT_API_KEY ??
      projectProviderSnapshot?.provider?.apiKey;
    const probeModel = readOptionString(options, "model") ??
      process.env.GROBOT_MODEL ??
      projectProviderSnapshot?.provider?.model;
    if (!probeBaseUrl || !probeApiKey) {
      process.stdout.write("probe: skipped (missing base_url/api_key)\n");
      return 2;
    }
    const probe = await probeProviderModels(probeBaseUrl, probeApiKey, probeModel);
    process.stdout.write(`probe: ${probe.state} ${probe.detail}\n`);
    if (typeof probe.httpStatus === "number" && probe.httpStatus > 0) {
      process.stdout.write(`probe_http_status: ${probe.httpStatus}\n`);
    }
    if (typeof probe.modelCount === "number") {
      process.stdout.write(`probe_model_count: ${probe.modelCount}\n`);
    }
    if (typeof probe.selectedModel === "string" && probe.selectedModel.length > 0) {
      process.stdout.write(
        `probe_selected_model: ${probe.selectedModel} (${probe.selectedFound ? "found" : "missing"})\n`,
      );
    }
    if (probe.state !== "ok") {
      return 1;
    }
  }
  return 0;
}
