import type { ProjectProviderSnapshot, ProviderProbeResult } from "../provider-probe";
import { probeProviderModels } from "../provider-probe";

export type StatusProviderProbeResult = Omit<ProviderProbeResult, "state"> & {
  state: ProviderProbeResult["state"] | "skipped";
};

export interface ResolveStatusProviderProbeInput {
  requested: boolean;
  baseUrlFromCli?: string;
  baseUrlFromEnv?: string;
  apiKeyFromCli?: string;
  apiKeyFromEnv?: string;
  modelFromCli?: string;
  modelFromEnv?: string;
  projectProviderSnapshot?: ProjectProviderSnapshot;
}

export interface StatusProviderProbeResolution {
  probeResult?: StatusProviderProbeResult;
  exitCode: number;
}

export async function resolveStatusProviderProbe(
  input: ResolveStatusProviderProbeInput,
): Promise<StatusProviderProbeResolution> {
  if (!input.requested) {
    return { exitCode: 0 };
  }

  const probeBaseUrl = input.baseUrlFromCli ??
    input.baseUrlFromEnv ??
    input.projectProviderSnapshot?.provider?.baseUrl;
  const probeApiKey = input.apiKeyFromCli ??
    input.apiKeyFromEnv ??
    input.projectProviderSnapshot?.provider?.apiKey;
  const probeModel = input.modelFromCli ??
    input.modelFromEnv ??
    input.projectProviderSnapshot?.provider?.model;

  if (!probeBaseUrl || !probeApiKey) {
    return {
      probeResult: {
        state: "skipped",
        detail: "(missing base_url/api_key)",
      },
      exitCode: 2,
    };
  }

  const probe = await probeProviderModels(probeBaseUrl, probeApiKey, probeModel);
  return {
    probeResult: {
      state: probe.state,
      detail: probe.detail,
      httpStatus: probe.httpStatus,
      modelCount: probe.modelCount,
      selectedModel: probe.selectedModel,
      selectedFound: probe.selectedFound,
      resolvedModel: probe.resolvedModel,
      autoSelected: probe.autoSelected,
    },
    exitCode: probe.state === "ok" ? 0 : 1,
  };
}

export function serializeStatusProviderProbe(
  probeResult: StatusProviderProbeResult | undefined,
): Record<string, unknown> | null {
  if (probeResult == null) {
    return null;
  }
  return {
    state: probeResult.state,
    detail: probeResult.detail,
    http_status: probeResult.httpStatus ?? null,
    model_count: probeResult.modelCount ?? null,
    selected_model: probeResult.selectedModel ?? null,
    selected_found: probeResult.selectedFound ?? null,
    resolved_model: probeResult.resolvedModel ?? null,
    auto_selected: probeResult.autoSelected ?? null,
  };
}

export function formatStatusProviderProbeLines(
  probeResult: StatusProviderProbeResult,
): string[] {
  const lines = [`probe: ${probeResult.state} ${probeResult.detail}`];
  if (typeof probeResult.httpStatus === "number" && probeResult.httpStatus > 0) {
    lines.push(`probe_http_status: ${probeResult.httpStatus}`);
  }
  if (typeof probeResult.modelCount === "number") {
    lines.push(`probe_model_count: ${probeResult.modelCount}`);
  }
  if (typeof probeResult.selectedModel === "string" && probeResult.selectedModel.length > 0) {
    lines.push(
      `probe_selected_model: ${probeResult.selectedModel} (${probeResult.selectedFound ? "found" : "missing"})`,
    );
  }
  if (typeof probeResult.resolvedModel === "string" && probeResult.resolvedModel.length > 0) {
    lines.push(
      `probe_resolved_model: ${probeResult.resolvedModel}${probeResult.autoSelected ? " (auto)" : ""}`,
    );
  }
  return lines;
}
